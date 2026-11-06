# 把下载的高程和航拍处理成游戏用的文件。
# 运行：python -I tools/real/prep_grandcanyon.py art/src/real/grandcanyon public/real/grandcanyon [--sun 方位 高度]
#
# 最要紧的一步是去掉影像里的光照。航拍是某天早上拍的，阳面亮、阴面黑全都印在照片上，
# 游戏里的太阳一换位置，影子就对不上。这里用高程算出拍摄时的光照（太阳方向从照片和地形的相关性里反推），
# 把它从照片里除掉，留下岩石本来的颜色（反照率）；光照由游戏实时算。

import gzip
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
SRC = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
G = json.load(open(os.path.join(SRC, 'grid.json'), encoding='utf-8'))
R_EARTH = 6371000.0


def mosaic(prefix, total, channels):
    a = np.zeros((total, total, channels), np.float32) if channels > 1 else np.zeros((total, total), np.float32)
    for name, t in G['tiles'].items():
        if not name.startswith(prefix):
            continue
        im = Image.open(os.path.join(SRC, name))
        p = np.asarray(im.convert('RGB') if channels == 3 else im, dtype=np.float32)
        a[t['py']:t['py'] + t['h'], t['px']:t['px'] + t['w']] = p
    return a


def fill_nodata(h):
    bad = (h < -500) | ~np.isfinite(h)
    print('  无效点', int(bad.sum()))
    if bad.any():
        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        h = h[tuple(idx)]
    return h


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def normals(h, cell):
    """行是南北（第 0 行在北），列是东西。返回东、北、上三个分量"""
    gy, gx = np.gradient(h.astype(np.float32), cell)
    # gy 沿行号增加的方向（向南）
    nx = -gx
    ny = gy
    nz = np.ones_like(h, dtype=np.float32)
    m = 1 / np.sqrt(nx * nx + ny * ny + 1)
    return (nx * m).astype(np.float32), (ny * m).astype(np.float32), (nz * m).astype(np.float32)


def sun_vec(az, el):
    a, e = math.radians(az), math.radians(el)
    return math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)


def cast_shadow(h, cell, az, el):
    """朝太阳方向扫一遍：高度比上游挡光面低的格子在影子里。返回 1 = 照得到（柔和的边）"""
    # 把高度场转到太阳方向沿行的坐标系里，一行一行往下传挡光面
    ang = az  # 太阳在 az 方向：光从那边来，影子往反方向
    rot = ndimage.rotate(h, ang, reshape=True, order=1, mode='nearest', prefilter=False)
    tanE = math.tan(math.radians(el))
    drop = tanE * cell
    S = rot[0].copy()
    lit = np.ones_like(rot, dtype=np.float32)
    for i in range(1, rot.shape[0]):
        S = np.maximum(S - drop, rot[i])
        lit[i] = (rot[i] >= S - 0.5).astype(np.float32)
    back = ndimage.rotate(lit, -ang, reshape=False, order=1, mode='nearest', prefilter=False)
    # 裁回原来的大小
    H, W = h.shape
    y0 = (back.shape[0] - H) // 2
    x0 = (back.shape[1] - W) // 2
    return np.clip(back[y0:y0 + H, x0:x0 + W], 0, 1)


def fit_sun(h, img, cell):
    """搜索太阳方向：让算出来的光照和照片的明暗最相关"""
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lg = np.log(np.maximum(lum, 1e-3))
    # 去掉大尺度的颜色差别（不同岩层），只留明暗
    lg = lg - ndimage.gaussian_filter(lg, 24)
    nx, ny, nz = normals(h, cell)
    best = (-9, 0, 0)
    res = {}
    for el in range(30, 80, 5):
        for az in range(70, 290, 10):
            sx, sy, sz = sun_vec(az, el)
            c = np.maximum(nx * sx + ny * sy + nz * sz, 0)
            s = np.log(0.25 + 0.75 * c)
            s = s - ndimage.gaussian_filter(s, 24)
            r = float(np.corrcoef(s.ravel()[::7], lg.ravel()[::7])[0, 1])
            res[(az, el)] = r
            if r > best[0]:
                best = (r, az, el)
    print('  粗搜', best)
    # 在最好的几个附近加上投影再细搜
    r0, a0, e0 = best
    best = (-9, 0, 0)
    for el in range(e0 - 6, e0 + 7, 3):
        for az in range(a0 - 12, a0 + 13, 4):
            sx, sy, sz = sun_vec(az, el)
            c = np.maximum(nx * sx + ny * sy + nz * sz, 0) * cast_shadow(h, cell, az, el)
            s = np.log(0.2 + 0.8 * c)
            s = s - ndimage.gaussian_filter(s, 24)
            r = float(np.corrcoef(s.ravel()[::7], lg.ravel()[::7])[0, 1])
            if r > best[0]:
                best = (r, az, el)
    print('  细搜', best)
    return best[1], best[2]


def box(a, r):
    return ndimage.uniform_filter(a, size=2 * r + 1, mode='nearest')


def guided(guide, src, r, eps):
    """导向滤波：让算出来的影子边缘贴到照片上真实的影子边缘（高程和照片差几米，直接除会留下亮边）"""
    mI = box(guide, r)
    mP = box(src, r)
    cov = box(guide * src, r) - mI * mP
    var = box(guide * guide, r) - mI * mI
    a = cov / (var + eps)
    b = mP - a * mI
    return box(a, r) * guide + box(b, r)


def shading(h, cell, az, el, ambient):
    """这一层的拍摄光照（三个通道），平地晒着太阳 = 1"""
    nx, ny, nz = normals(h, cell)
    sx, sy, sz = sun_vec(az, el)
    c = np.maximum(nx * sx + ny * sy + nz * sz, 0) / sz
    return np.clip(c, 0, 1.7), cast_shadow(h, cell, az, el)


LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
Y0, Y1, NB = 500.0, 3900.0, 1700
DIP = (-0.004, 0.016)


def elevation_colors(alb, hi, shadow):
    """晒着太阳的地方，每个高度的平均颜色。这里的地层是水平的，同一高度就是同一层岩石"""
    s = 3
    a = alb[::s, ::s]
    hh = hi[::s, ::s]
    ok = shadow[::s, ::s] < 0.1
    b = np.clip(((hh - Y0) / (Y1 - Y0) * NB).astype(np.int32), 0, NB - 1)[ok]
    cnt = np.bincount(b, minlength=NB).astype(np.float64)
    idx = np.arange(NB)
    good = cnt > 40
    lut = np.zeros((NB, 3), np.float32)
    for c in range(3):
        v = np.bincount(b, weights=a[..., c][ok], minlength=NB)
        lut[:, c] = np.interp(idx, idx[good], v[good] / cnt[good])
    return ndimage.gaussian_filter1d(lut, 2.0, axis=0).astype(np.float32)


def fill_shadows(out, hi, shadow, lut, px_cell):
    """影子里只有天光，颜色在照片里已经丢了：颜色借同一高度晒着太阳的岩石，明暗细节留下来"""
    lum = out @ LUM
    sig = max(2.0, 18.0 / px_cell)
    low = ndimage.gaussian_filter(lum, sig)
    detail = np.clip(lum / np.maximum(low, 0.01), 0.55, 1.6).astype(np.float32)
    # 影子里照片几乎没有纹理（信号太弱，压缩时抹掉了）：补一层石头的斑驳，几米到几十米的尺度
    H, W = lum.shape
    rs = np.random.default_rng(3)
    mott = np.zeros((H, W), np.float32)
    for size_m, amp in ((3.0, 0.10), (9.0, 0.11), (28.0, 0.10)):
        q = max(1, int(size_m / px_cell / 2))
        n = rs.standard_normal((H // q + 2, W // q + 2)).astype(np.float32)
        n = ndimage.gaussian_filter(n, 1.0)
        n /= max(1e-6, float(n.std()))
        mott += amp * ndimage.zoom(n, q, order=1)[:H, :W]
    detail *= np.clip(1 + mott, 0.5, 1.6)
    b = np.clip(((hi - Y0) / (Y1 - Y0) * NB).astype(np.int32), 0, NB - 1)
    w = np.clip(ndimage.gaussian_filter(shadow, max(0.6, 1.5 / px_cell)) * 1.25, 0, 1).astype(np.float32)
    for c in range(3):
        out[..., c] = out[..., c] * (1 - w) + lut[:, c][b] * detail * w
    return out


def with_dip(h, size):
    """这层岩石的位置：高度加上地层的倾斜（见 src/maps/grandcanyon.ts 的 dip）"""
    n = h.shape[0]
    x = (np.arange(n, dtype=np.float32) / (n - 1) - 0.5) * size
    return h + DIP[0] * x[None, :] + DIP[1] * x[:, None]


def delight(img, h, cell, px_cell, az, el, ambient, name, lut=None):
    """照片除以光照 → 反照率。img：线性 RGB，分辨率可以比高程高"""
    c, v = shading(h, cell, az, el, ambient)
    # 高程的分辨率补到影像的分辨率
    k = img.shape[0] / h.shape[0]
    if abs(k - 1) > 1e-3:
        c = ndimage.zoom(c, k, order=1)[:img.shape[0], :img.shape[1]]
        v = ndimage.zoom(v, k, order=1)[:img.shape[0], :img.shape[1]]
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    g = np.log(np.maximum(lum, 2e-3)).astype(np.float32)
    # 算出来的影子只当候选范围：这片影像是两天拍的，太阳位置差一点，直接除会把晒着太阳的地方提到过曝。
    # 候选范围往外扩一圈，里面真正够暗的才算影子（范围外的暗处是树和深色的岩石，不是影子）
    grow = max(3, int(round(45 / px_cell)))
    cand = ndimage.maximum_filter((v < 0.5).astype(np.float32), size=2 * grow + 1)
    t = np.clip((0.075 - lum) / (0.075 - 0.032), 0, 1)
    shadow = (cand * t * t * (3 - 2 * t)).astype(np.float32)
    # 影子的边缘贴到照片上真实的边缘
    r = max(2, int(round(3 / px_cell)))
    shadow = np.clip(guided(g, shadow, r, 0.01), 0, 1)
    # 背对太阳的坡：一样只信照片，太斜的地方别除得太狠
    c = np.clip(ndimage.gaussian_filter(c, max(0.5, 3.0 / px_cell)), 0.42, 1.5).astype(np.float32)
    lit = c * (1 - shadow)
    S = lit[..., None] * (1 - ambient[None, None, :]) + ambient[None, None, :]
    out = img / np.maximum(S, 0.05)
    sh = shadow > 0.7
    print(f'  {name}：影子占比', round(float(sh.mean()), 3), '影子里提亮后的亮度中位数', float(np.median(out[sh].mean(axis=1))) if sh.any() else 0, '晒着的', float(np.median(out[shadow < 0.1].mean(axis=1))))
    # 借颜色时也按岩层算（只有核心区：再往外地层不是一个平面了）
    hd = with_dip(h, G['core']) if name == '核心' else h
    hi = hd if abs(k - 1) < 1e-3 else ndimage.zoom(hd.astype(np.float32), k, order=1)[:img.shape[0], :img.shape[1]]
    if lut is None:
        lut = elevation_colors(out, hi, shadow)
    return fill_shadows(out, hi, shadow, lut, px_cell), lut


def save_image(a, name, q):
    rgb = (lin_to_srgb(a) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(rgb).save(os.path.join(OUT, name), 'WEBP', quality=q, method=4)
    print(' ', name, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 1), 'MB')


def save_heights(h, name, step):
    base = math.floor(float(h.min()))
    q = np.round((h.astype(np.float64) - base) / step).astype(np.int32)
    d = np.empty_like(q)
    d[:, 1:] = q[:, 1:] - q[:, :-1]
    d[1:, 0] = q[1:, 0] - q[:-1, 0]
    d[0, 0] = q[0, 0]
    z = np.where(d >= 0, d * 2, -d * 2 - 1)
    assert z.max() < 65536, z.max()
    raw = z.astype('<u2').tobytes()
    with gzip.open(os.path.join(OUT, name), 'wb', compresslevel=9) as f:
        f.write(raw)
    print(' ', name, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 1), 'MB', 'base', base, 'step', step, 'range', float(h.min()), float(h.max()))
    return base


def curvature(h, size):
    """地球是圆的：一百公里外的山比平面上低将近 800 米。核心区不动（物理和画面要一致），外面按离中心的距离压低"""
    n = h.shape[0]
    x = (np.arange(n, dtype=np.float32) / (n - 1) - 0.5) * size
    r = np.sqrt(x[None, :] ** 2 + x[:, None] ** 2)
    return h - np.maximum(r - G['core'] / 2, 0) ** 2 / (2 * R_EARTH)


def bedding(total_m, W):
    """一层一层的沉积：每层厚度不一样，明暗也不一样，绝不会等距重复。岩石里最显眼的横纹就是这个"""
    rs = np.random.default_rng(5)
    y = (np.arange(W) + 0.5) / W * total_m
    out = np.zeros(W, np.float32)
    for mean, amp in ((16.0, 0.10), (4.2, 0.075), (1.1, 0.05)):
        edges = np.cumsum(rs.lognormal(math.log(mean), 0.7, int(total_m / mean * 3)))
        vals = rs.normal(0, 1, len(edges) + 1)
        out += amp * vals[np.searchsorted(edges, y)]
    return np.clip(1 + out, 0.62, 1.4)


def strata_lut(h, alb, px_cell, y0, y1, n=1024):
    """崖壁的颜色按高度排一条：这里的地层几乎是水平的，同一高度就是同一层岩石"""
    k = alb.shape[0] / h.shape[0]
    gy, gx = np.gradient(h.astype(np.float32), G['core'] / (h.shape[0] - 1))
    steep = np.sqrt(gx * gx + gy * gy) > 0.7
    hh = with_dip(h, G['core'])
    a = alb
    if k > 1:
        s = int(round(k))
        a = alb[::s, ::s]
        hh = h[:a.shape[0], :a.shape[1]]
        steep = steep[:a.shape[0], :a.shape[1]]
    b = np.clip(((hh - y0) / (y1 - y0) * n).astype(np.int32), 0, n - 1)
    lut = np.zeros((n, 3))
    cnt = np.bincount(b[steep].ravel(), minlength=n).astype(np.float64)
    for c in range(3):
        lut[:, c] = np.bincount(b[steep].ravel(), weights=a[..., c][steep].ravel(), minlength=n)
    ok = cnt > 30
    idx = np.arange(n)
    for c in range(3):
        lut[:, c] = np.interp(idx, idx[ok], lut[ok, c] / cnt[ok])
    lut = ndimage.gaussian_filter1d(lut, 1.2, axis=0)
    # 贴图比统计出来的表细得多：0.44 米一格，细的层理写在这里（远处靠 mipmap 自然平均掉）
    W = 4096
    pos = (np.arange(W) + 0.5) / W * n - 0.5
    fine = np.stack([np.interp(pos, np.arange(n), lut[:, c]) for c in range(3)], 1) * bedding(y1 - y0, W)[:, None]
    px = (lin_to_srgb(fine)[None, :, :] * 255 + 0.5).astype(np.uint8)
    Image.fromarray(px).save(os.path.join(OUT, 'strata.png'))
    return lut


def blend_edge(inner, outer, size_in, size_out):
    """里面一层的四条边慢慢过渡成外面一层的颜色。着色器里不用再多采一张图"""
    n = inner.shape[0]
    m = outer.shape[0]
    band = int(n * 0.016) + 2
    ax = ((np.arange(n, dtype=np.float32) + 0.5) / n - 0.5) * 2
    d = np.abs(ax)
    t = np.clip((d - 0.97) / (0.998 - 0.97), 0, 1)
    k1 = (t * t * (3 - 2 * t)).astype(np.float32)
    # 里层像素在外层贴图里的位置
    p = ((np.arange(n, dtype=np.float32) + 0.5) / n - 0.5) * (size_in / size_out) * m + m / 2 - 0.5
    strips = [(slice(0, band), slice(None)), (slice(n - band, n), slice(None)), (slice(None), slice(0, band)), (slice(None), slice(n - band, n))]
    for sy, sx in strips:
        yy, xx = np.meshgrid(p[sy], p[sx], indexing='ij')
        k = np.maximum(k1[sy][:, None], k1[sx][None, :])
        for c in range(3):
            o = ndimage.map_coordinates(outer[..., c], [yy, xx], order=1, mode='nearest')
            inner[sy, sx, c] = inner[sy, sx, c] * (1 - k) + o * k


def sharpen(a, sigma, amount):
    """影像重采样到 1.25 米时糊了一点，把细节提回来。只动明暗，颜色不变"""
    l = a @ LUM
    d = l - ndimage.gaussian_filter(l, sigma)
    a *= np.clip(1 + amount * d / np.maximum(l, 0.02), 0.6, 1.6)[..., None]


def calm_river(a, river):
    """河面的颜色：这片影像是两天拍的，水面反光不一样，航线的接缝在水上特别显眼。
    河面上换成沿河平滑过的颜色，白浪还留一点"""
    k = a.shape[0] / river.shape[0]
    m = ndimage.zoom(river, k, order=1)[:a.shape[0], :a.shape[1]].astype(np.float32)
    w = ndimage.gaussian_filter(m, 42) + 1e-4
    for c in range(3):
        blur = ndimage.gaussian_filter(a[..., c] * m, 42) / w
        a[..., c] = a[..., c] * (1 - m * 0.88) + blur * (m * 0.88)


def sky_view(h, cell):
    """每一点看得到多少天空：沿 16 个方向找地平线，余弦加权（平地 = 1，两边都是 45° 的山 = 0.5）。
    峡谷有一千多米深，要看到两公里外"""
    n = h.shape[0]
    acc = np.zeros_like(h, dtype=np.float32)
    dirs = 16
    radii = [5, 10, 20, 40, 80, 160, 320, 640, 1280, 2000]
    for i in range(dirs):
        a = 2 * math.pi * (i + 0.5) / dirs
        dx, dz = math.cos(a), math.sin(a)
        top = np.zeros_like(h, dtype=np.float32)
        for r in radii:
            ox = int(round(dx * r / cell))
            oz = int(round(dz * r / cell))
            if ox == 0 and oz == 0:
                continue
            sh = np.roll(np.roll(h, -oz, axis=0), -ox, axis=1)
            t = (sh - h) / math.hypot(ox * cell, oz * cell)
            np.maximum(top, t, out=top)
        acc += 1 / (1 + top * top)
    return acc / dirs


def aux_map(h, river):
    """一张 5 米一格的辅助图：R 岩缝和小沟，G 河面，B 看得到的天空。无损：三个通道互不相干，不能有色度抽样"""
    h5 = h[::2, ::2].astype(np.float32)
    cell = 2 * G['core'] / (h.shape[0] - 1)
    sky = sky_view(h5, cell)
    crev = np.clip((ndimage.gaussian_filter(h5, 2.2) - h5) / 4.0, 0, 1)
    print('  天空可见度', float(sky.min()), float(np.median(sky)), float(sky.max()))
    a = np.stack([crev, river[::2, ::2], sky], 2)[:2048, :2048]
    px = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    # （文件名别叫 aux：那是 Windows 的保留设备名，Git 打不开）
    Image.fromarray(px).save(os.path.join(OUT, 'sky_river.webp'), 'WEBP', lossless=True, quality=60, method=4)
    print('  sky_river.webp', round(os.path.getsize(os.path.join(OUT, 'sky_river.webp')) / 1e6, 1), 'MB')


def river_mask(h):
    """河面：激光测绘把水面压成了平的。谷底又平、又连成一大片的地方就是河"""
    gy, gx = np.gradient(h.astype(np.float32), G['core'] / (h.shape[0] - 1))
    flat = (np.hypot(gx, gy) < 0.012) & (h < float(h.min()) + 60)
    m = ndimage.binary_opening(flat, iterations=2)
    lab, n = ndimage.label(m)
    size = ndimage.sum(m, lab, np.arange(1, n + 1))
    keep = np.isin(lab, np.nonzero(size > 3000)[0] + 1)
    keep = ndimage.binary_closing(keep, iterations=6)
    print('  河面', int(keep.sum()), '格，高度', float(h[keep].min()), float(h[keep].max()), '分成', int((size > 3000).sum()), '段')
    return np.clip(ndimage.gaussian_filter(keep.astype(np.float32), 1.2), 0, 1)


def find_trees(h, alb, px_cell, limit=150000):
    """从影像里一棵一棵认出树：在周围亮的底色上一团一团的深色。南缘是矮松和刺柏，溪边是三角叶杨。
    位置是真的，大小和种类按高度估计。"""
    lum = alb @ LUM
    blur = ndimage.gaussian_filter(lum, 1.1)
    bg = ndimage.gaussian_filter(lum, 7.0)
    dark = (bg - blur) / np.maximum(bg, 0.02)
    peak = (ndimage.maximum_filter(dark, size=5) == dark) & (dark > 0.14)
    ys, xs = np.nonzero(peak)
    k = alb.shape[0] / (h.shape[0] - 1)
    iy = np.clip((ys / k).astype(np.int32), 1, h.shape[0] - 2)
    ix = np.clip((xs / k).astype(np.int32), 1, h.shape[1] - 2)
    e = h[iy, ix]
    cell = G['core'] / (h.shape[0] - 1)
    slope = np.hypot(h[iy, ix + 1] - h[iy, ix - 1], h[iy + 1, ix] - h[iy - 1, ix]) / (2 * cell)
    g = alb[ys, xs, 1] / np.maximum(alb[ys, xs, 0], 1e-3)
    rim = (e > 1960) & (slope < 0.75)
    creek = (e < 1320) & (g > 1.04) & (slope < 0.5)
    keep = rim | creek
    # 谷里的灌木：航拍上是一个个小黑点，低空飞过时要是一丛丛立着的东西，不能是地上的一块脏
    bush = ~keep & (slope < 1.0) & (dark[ys, xs] > 0.2)
    bx, by = xs[bush], ys[bush]
    bd = dark[by, bx]
    ys, xs, e, g, creek, dk = ys[keep], xs[keep], e[keep], g[keep], creek[keep], dark[ys[keep], xs[keep]]
    rs = np.random.default_rng(11)
    if len(ys) > limit:
        # 留最明显的，再随机抽一点小的，疏密还在
        order = np.argsort(-dk)
        top = order[: int(limit * 0.8)]
        rest = rs.choice(order[int(limit * 0.8):], limit - len(top), replace=False)
        sel = np.concatenate([top, rest])
        ys, xs, e, creek, dk = ys[sel], xs[sel], e[sel], creek[sel], dk[sel]
    n = len(ys)
    kind = np.where(creek, 2, np.where(rs.random(n) < 0.68, 0, np.where(rs.random(n) < 0.62, 1, 3)))
    size = np.clip(0.75 + dk * 1.6 + rs.normal(0, 0.13, n), 0.6, 1.5)
    size = np.where(creek, size * 1.2, size)
    size = np.where(kind == 1, size * 0.72, size)
    if len(bx) > limit:
        pick = np.argsort(-bd)[:limit]
        bx, by, bd = bx[pick], by[pick], bd[pick]
    print('  灌木', len(bx))
    xs = np.concatenate([xs, bx])
    ys = np.concatenate([ys, by])
    kind = np.concatenate([kind, np.full(len(bx), 3)])
    size = np.concatenate([size, np.clip(0.55 + bd * 1.2 + rs.normal(0, 0.1, len(bx)), 0.45, 1.15)])
    creek = np.concatenate([creek, np.zeros(len(bx), bool)])
    n = len(xs)
    half = G['core'] / 2
    x = ((xs + 0.5) * px_cell - half) / G['core'] + 0.5
    z = ((ys + 0.5) * px_cell - half) / G['core'] + 0.5
    xz = np.stack([np.round(x * 65535), np.round(z * 65535)], 1).astype('<u2')
    meta = np.stack([kind, np.round(size * 100)], 1).astype(np.uint8)
    with gzip.open(os.path.join(OUT, 'trees.dat'), 'wb', compresslevel=9) as f:
        f.write(xz.tobytes())
        f.write(meta.tobytes())
    print('  树', n, '其中溪边', int(creek.sum()), round(os.path.getsize(os.path.join(OUT, 'trees.dat')) / 1e6, 2), 'MB')


def main():
    print('高程')
    core = fill_nodata(mosaic('dem_core', 4097, 1))
    mid = fill_nodata(mosaic('dem_mid', 2049, 1))
    far = fill_nodata(mosaic('dem_far', 1025, 1))
    print('  核心', core.min(), core.max(), ' 中圈', mid.min(), mid.max(), ' 远圈', far.min(), far.max())
    print('影像')
    img0 = srgb_to_lin(mosaic('naip_core', 8192, 3) / 255)
    img1 = srgb_to_lin(mosaic('naip_mid', 4096, 3) / 255)
    img2 = srgb_to_lin(mosaic('naip_far', 2048, 3) / 255)
    print('太阳')
    if '--sun' in sys.argv:
        i = sys.argv.index('--sun')
        az, el = float(sys.argv[i + 1]), float(sys.argv[i + 2])
    else:
        # 10 米分辨率的核心区上拟合
        h10 = core[::4, ::4]
        im10 = img0[4::8, 4::8][:h10.shape[0], :h10.shape[1]]
        h10 = h10[:im10.shape[0], :im10.shape[1]]
        az, el = fit_sun(h10, im10, 10.0)
    print('  太阳方位', az, '高度', el)
    # 环境光：影子里的亮度和晒着的亮度之比，三个通道分开（影子里只有蓝天的光，偏蓝）
    h10 = core[::4, ::4]
    im10 = img0[4::8, 4::8][:h10.shape[0], :h10.shape[1]]
    h10 = h10[:im10.shape[0], :im10.shape[1]]
    c, v = shading(h10, 10.0, az, el, None)
    l10 = im10 @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    shade = (v < 0.2) & (l10 < 0.05)
    sunny = (v > 0.9) & (c > 0.8) & (c < 1.2)
    amb = np.array([np.median(im10[..., k][shade]) / np.median(im10[..., k][sunny]) for k in range(3)], np.float32)
    print('  环境光比例', amb, '影子比例', float(shade.mean()))
    amb = np.clip(amb, 0.1, 0.5)
    print('去光照')
    a0, lut = delight(img0, core, 2.5, 1.25, az, el, amb, '核心')
    del img0
    # 外面两层的高度范围更大（比如北缘的森林）：表要重算，只在核心区的高度范围内用核心区的表
    a1, lut1 = delight(img1, mid, 20.0, 10.0, az, el, amb, '中圈')
    del img1
    a2, _ = delight(img2, far, 160.0, 80.0, az, el, amb, '远圈', lut1)
    del img2
    # 让三层的整体亮度对齐到合理的反照率：荒漠岩石大约 0.25~0.35
    # 影像里的颜色比肉眼看到的淡（天空的散射盖了一层），饱和度补回来一点
    for a in (a0, a1, a2):
        l = (a @ LUM)[..., None]
        a[:] = np.maximum(l + (a - l) * 1.22, 0)
    k = 0.215 / float(np.median(a1))
    print('  整体增益', k)
    a0 *= k
    a1 *= k
    a2 *= k
    y0, y1 = 600.0, 2420.0
    strata_lut(core, a0, 1.25, y0, y1)
    river = river_mask(core)
    aux_map(core, river)
    find_trees(core, a0, 1.25)
    calm_river(a0, river)
    sharpen(a0, 1.5, 0.6)
    sharpen(a1, 1.2, 0.35)
    blend_edge(a0, a1, G['core'], G['mid'])
    blend_edge(a1, a2, G['mid'], G['far'])
    print('写文件')
    save_image(a0, 'core.webp', 80)
    save_image(a1, 'mid.webp', 84)
    save_image(a2, 'far.webp', 86)
    # 后缀不用 .gz：有的服务器看到它会自作主张声明内容已压缩
    bases = [save_heights(core, 'core.dem', 0.05), save_heights(curvature(mid, G['mid']), 'mid.dem', 0.1), save_heights(curvature(far, G['far']), 'far.dem', 0.25)]
    json.dump(dict(sun=[az, el], ambient=[float(x) for x in amb], bases=bases, utm=G['utm'], strata=[y0, y1]), open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
    print('完成')


if __name__ == '__main__':
    main()
