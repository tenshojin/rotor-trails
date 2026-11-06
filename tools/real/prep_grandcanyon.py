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


def merge_lidar(core):
    """在线的 3DEP 服务在中西部一大块只有 10 米的数据（1 米的项目 AZ_GrandCanyonNP_2019_B19 没飞到）。
    2026 年新发布的 AZ_NWGrandCanyonNP_D25 补上了这一块，但服务里还没有，要单独下载（tools/real/fetch_lidar.py）。
    这里把 1 米的数据平均到 2.5 米，有数据的地方换上去，边上过渡一下"""
    d = os.path.join(SRC, 'lidar')
    names = sorted(f for f in os.listdir(d) if f.endswith('.tif')) if os.path.isdir(d) else []
    if not names:
        print('  没有单独下载的 1 米数据，用服务里的')
        return core
    n = core.shape[0]
    cell = G['core'] / (n - 1)
    e0 = G['utm'][0] - G['core'] / 2
    n0 = G['utm'][1] + G['core'] / 2
    new = np.zeros_like(core)
    have = np.zeros(core.shape, np.float32)
    ee = e0 + np.arange(n) * cell
    nn = n0 - np.arange(n) * cell
    for name in names:
        im = Image.open(os.path.join(d, name))
        tie = im.tag_v2[33922]
        scale = im.tag_v2[33550]
        a = np.asarray(im, dtype=np.float32)
        print(' ', name, a.shape, '左上', tie[3], tie[4], '格', scale[0], scale[1])
        ok = (a > -500) & (a < 9000)
        # 2.5 米一格：取 3 米的平均，再插值到网格点上
        w = ndimage.uniform_filter(ok.astype(np.float32), 3)
        s = ndimage.uniform_filter(np.where(ok, a, 0).astype(np.float32), 3)
        v = s / np.maximum(w, 1e-3)
        cols = (ee - tie[3]) / scale[0] - 0.5
        rows = (tie[4] - nn) / scale[1] - 0.5
        ci = np.nonzero((cols >= 1) & (cols < a.shape[1] - 2))[0]
        ri = np.nonzero((rows >= 1) & (rows < a.shape[0] - 2))[0]
        if len(ci) == 0 or len(ri) == 0:
            continue
        yy, xx = np.meshgrid(rows[ri], cols[ci], indexing='ij')
        vv = ndimage.map_coordinates(v, [yy, xx], order=1, mode='nearest')
        ww = ndimage.map_coordinates(w, [yy, xx], order=1, mode='nearest')
        sub = (slice(ri[0], ri[-1] + 1), slice(ci[0], ci[-1] + 1))
        take = ww > 0.98
        new[sub] = np.where(take, vv, new[sub])
        have[sub] = np.maximum(have[sub], take.astype(np.float32))
    diff = (new - core)[have > 0.5]
    print('  新数据覆盖', round(float((have > 0.5).mean()), 3), '和原来的高差：中位数', round(float(np.median(diff)), 2), '标准差', round(float(diff.std()), 2))
    # 高差的中位数当系统差，去掉，接缝才对得上。没有新数据的地方 new 是 0，一点都不能混进来，不然地上是一条深沟
    new = np.where(have > 0.5, new - float(np.median(diff)), core)
    t = np.clip(ndimage.distance_transform_edt(have > 0.5).astype(np.float32) * cell / 60.0, 0, 1)
    k = t * t * (3 - 2 * t)
    return (core * (1 - k) + new * k).astype(np.float32)


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


def local_colors(a, hi, sunny, block, nb, lut, step=3):
    """每一块地里、每一层岩石晒着太阳时的颜色。同一层岩石东边红西边灰，全图一张表借过来的颜色不对。
    返回 (块行, 块列, 层, 3)，数据少的地方退回全图的表"""
    H, W = hi.shape
    gb = int(math.ceil(H / block))
    ys, xs = np.nonzero(sunny[::step, ::step])
    ys = ys * step
    xs = xs * step
    bins = np.clip(((hi[ys, xs] - Y0) / (Y1 - Y0) * nb).astype(np.int64), 0, nb - 1)
    idx = ((ys // block) * gb + xs // block) * nb + bins
    n = gb * gb * nb
    cnt = np.bincount(idx, minlength=n).astype(np.float32).reshape(gb, gb, nb)
    sums = np.stack([np.bincount(idx, weights=a[ys, xs, c], minlength=n).astype(np.float32).reshape(gb, gb, nb) for c in range(3)], 3)
    sg = (1.0, 1.0, 1.6)
    cs = ndimage.gaussian_filter(cnt, sg)
    ss = np.stack([ndimage.gaussian_filter(sums[..., c], sg) for c in range(3)], 3)
    pos = (np.arange(nb) + 0.5) / nb * NB - 0.5
    base = np.stack([np.interp(pos, np.arange(NB), lut[:, c]) for c in range(3)], 1).astype(np.float32)
    prior = 12.0
    return (ss + base[None, None] * prior) / (cs[..., None] + prior)


class Colors:
    """附近同一层岩石晒着太阳时的颜色，按像素查"""

    def __init__(self, out, hi, shadow, lut, px_cell):
        self.block = max(16, int(1280 / px_cell))
        self.nb = 170
        self.hi = hi
        self.tab = local_colors(out, hi, shadow < 0.05, self.block, self.nb, lut)

    def at(self, sel):
        b = self.block
        coords = np.stack([(sel[0] + 0.5) / b - 0.5, (sel[1] + 0.5) / b - 0.5, (self.hi[sel] - Y0) / (Y1 - Y0) * self.nb - 0.5])
        return np.stack([ndimage.map_coordinates(self.tab[..., c], coords, order=1, mode='nearest') for c in range(3)], 1).astype(np.float32)


def refine_shadow(shadow, cand, lum0, cols, px_cell):
    """影子的第二道判断：比同一层岩石晒着太阳时暗一大截的也算。
    航线接缝那边是另一天拍的，太阳不一样，半明半暗，只看绝对亮度分不出来"""
    sel = np.nonzero(cand > 0.5)
    # 比灌木大的一片都暗才算：小的暗斑是灌木和沟，不是影子
    soft = ndimage.gaussian_filter(lum0, max(0.7, 4.0 / px_cell))
    rel = soft[sel] / np.maximum(cols.at(sel) @ LUM, 1e-3)
    t = np.clip((0.5 - rel) / (0.5 - 0.3), 0, 1)
    s2 = np.zeros_like(shadow)
    s2[sel] = t * t * (3 - 2 * t)
    return np.maximum(shadow, ndimage.gaussian_filter(s2, max(0.5, 1.2 / px_cell))).astype(np.float32)


def fill_shadows(out, hi, shadow, cols, px_cell):
    """影子里的岩层和沟壑照片上其实都在，只是暗，把它们救回来，不能用模糊的颜色盖掉。
    颜色：影子里红色通道的信号太弱，借附近同一层岩石晒着太阳时的颜色。
    明暗：一百多米以内的起伏全用照片的。只有天光时没有立体的明暗，对比度比晒着的地方低，放大一点。
    细碎的斑点（灌木、碎石）影子里看不见：从紧挨着的晒太阳的地方镜像借过来，
    高度差太多的不借（崖顶的树不能借到崖壁上），镜像借不到的换几个方向再找。"""
    H, W = hi.shape
    lum = np.maximum(out @ LUM, 1e-3).astype(np.float32)
    sunny = shadow < 0.05
    w = np.clip(ndimage.gaussian_filter(ndimage.maximum_filter(shadow, size=3), max(0.6, 1.5 / px_cell)) * 1.25, 0, 1).astype(np.float32)
    sel = np.nonzero(w > 0.004)
    tgt = cols.at(sel)
    tl = np.maximum(tgt @ LUM, 1e-3)
    # 影子里的亮度先对齐到同一层晒着太阳的岩石（谷底看到的天空少，除下来比实际暗），这样影子内外是同一个尺度
    sw = (shadow > 0.8).astype(np.float32)
    big = max(3.0, 120.0 / px_cell)
    full = np.zeros_like(lum)
    full[sel] = tl
    f = (ndimage.gaussian_filter(full * sw, big) + 1e-4) / (ndimage.gaussian_filter(lum * sw, big) + 1e-4)
    lc = lum * (1 + (np.clip(f, 0.5, 2.0) - 1) * shadow * shadow)
    mean = ndimage.gaussian_filter(lc, big)
    real = np.log(np.maximum(ndimage.gaussian_filter(lc, max(0.45, 0.6 / px_cell)), 1e-3) / np.maximum(mean, 1e-3))
    # 影子的边：半影加上重采样有两三个像素，这一圈的亮度不可信，留着是一条细黑线。这里只要平滑的底色
    r = max(1, int(round(3.0 / px_cell)))
    edge = ndimage.maximum_filter(((shadow > 0.03) & (shadow < 0.97)).astype(np.float32), size=2 * r + 1)
    edge = ndimage.gaussian_filter(edge, 1.0)
    real *= 1 - np.clip(edge * 1.4, 0, 1)
    # 晒太阳的地方的斑点（只取十来米以内的尺度）
    hp = np.log(lum) - np.log(np.maximum(ndimage.gaussian_filter(lum, max(1.5, 10.0 / px_cell)), 1e-3))
    near = ndimage.distance_transform_edt(~sunny, return_distances=False, return_indices=True).astype(np.int32)
    py = np.clip(2 * near[0][sel] - sel[0], 0, H - 1)
    px = np.clip(2 * near[1][sel] - sel[1], 0, W - 1)
    del near
    hs = hi[sel]
    good = sunny[py, px] & (np.abs(hi[py, px] - hs) < 70.0)
    mir = np.where(good, hp[py, px], 0.0).astype(np.float32)
    need = ~good
    k = int(round(160 / px_cell))
    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (-1, 1), (1, -1), (-1, -1), (0, 2), (2, 0), (0, -2), (-2, 0), (2, 2), (-2, 2), (2, -2), (-2, -2), (0, 4), (4, 0), (0, -4), (-4, 0)):
        idx = np.nonzero(need)[0]
        if len(idx) == 0:
            break
        qy = np.clip(sel[0][idx] + dy * k, 0, H - 1)
        qx = np.clip(sel[1][idx] + dx * k, 0, W - 1)
        g = sunny[qy, qx] & (np.abs(hi[qy, qx] - hs[idx]) < 45.0)
        mir[idx[g]] = hp[qy[g], qx[g]]
        need[idx[g]] = False
    print('  影子里借不到斑点的比例', round(float(need.mean()), 3))
    # 只有天光时没有立体的明暗，对比度比晒着的地方低，放大一点
    L = mean[sel] * np.exp(np.clip(real[sel], -1.0, 0.8) * 1.6 + np.clip(mir, -0.9, 0.7) * 0.8)
    # 不能比同一层岩石亮太多，也不能暗成一个洞
    L = np.clip(L, tl * 0.22, tl * 1.7)
    ww = w[sel][:, None]
    out[sel] = out[sel] * (1 - ww) + (tgt / tl[:, None]) * L[:, None] * ww
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
    # 背对太阳的坡：一样只信照片，太斜的地方别除得太狠。
    # 只除掉八成：一比一地除，凹凸不平的暗色岩石全被提成一片亮的（高程分不出比格子小的影子），内峡谷的片岩成了土黄色
    c = (np.clip(ndimage.gaussian_filter(c, max(0.5, 3.0 / px_cell)), 0.5, 1.45) ** 0.8).astype(np.float32)
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
    cols = Colors(out, hi, shadow, lut, px_cell)
    shadow = refine_shadow(shadow, cand, lum, cols, px_cell)
    S = (c * (1 - shadow))[..., None] * (1 - ambient[None, None, :]) + ambient[None, None, :]
    out = img / np.maximum(S, 0.05)
    return fill_shadows(out, hi, shadow, cols, px_cell), lut


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
    # 时间戳写 0：内容没变，文件就一个字节都不变，不用往仓库里再存一份
    with open(os.path.join(OUT, name), 'wb') as o, gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=o, mtime=0) as f:
        f.write(raw)
    print(' ', name, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 1), 'MB', 'base', base, 'step', step, 'range', float(h.min()), float(h.max()))
    return base


def curvature(h, size):
    """地球是圆的：一百公里外的山比平面上低将近 800 米。核心区不动（物理和画面要一致），外面按离中心的距离压低"""
    n = h.shape[0]
    x = (np.arange(n, dtype=np.float32) / (n - 1) - 0.5) * size
    r = np.sqrt(x[None, :] ** 2 + x[:, None] ** 2)
    return h - np.maximum(r - G['core'] / 2, 0) ** 2 / (2 * R_EARTH)


# 南缘这一段的地层，高度是加上倾斜之后的（陡坡的高度分布定出来的，和地质资料的厚度对得上）：
# [下边界, 层理的明显程度]。片岩是变质岩，没有水平的层；页岩成坡，层薄而软；石灰岩和砂岩一层层突出来
FORMATIONS = [
    (0, 0.0),        # 毗湿奴片岩
    (1030, 0.9),     # 塔皮茨砂岩
    (1075, 0.3),     # 光明天使页岩（托恩托平台）
    (1250, 0.55),    # 穆阿夫石灰岩
    (1350, 0.5),     # 红墙石灰岩：厚层
    (1490, 1.0),     # 苏派群：一级级的台阶
    (1875, 0.3),     # 赫米特页岩
    (1965, 0.35),    # 科科尼诺砂岩：大块的，横纹少
    (2075, 0.6),     # 托罗维普组
    (2175, 1.0),     # 凯巴布石灰岩
]


def formation_strength(y):
    """每个高度的层理有多明显，层与层之间过渡几米"""
    k = np.zeros_like(y)
    for lo, v in FORMATIONS:
        k = np.where(y >= lo, v, k)
    return ndimage.gaussian_filter1d(k.astype(np.float32), 6.0)


def bedding(total_m, W):
    """一层一层的沉积：每层厚度不一样，明暗也不一样，绝不会等距重复。岩石里最显眼的横纹就是这个。
    返回明暗和硬度：硬的层突出来，软的层缩进去（着色器按它算凹凸）"""
    rs = np.random.default_rng(5)
    y = (np.arange(W) + 0.5) / W * total_m
    out = np.zeros(W, np.float32)
    hard = np.zeros(W, np.float32)
    for mean, amp, ha in ((16.0, 0.10, 0.22), (4.2, 0.075, 0.5), (1.1, 0.05, 0.28)):
        edges = np.cumsum(rs.lognormal(math.log(mean), 0.7, int(total_m / mean * 3)))
        vals = rs.normal(0, 1, len(edges) + 1)
        v = vals[np.searchsorted(edges, y)]
        out += amp * v
        hard += ha * v
    return np.clip(1 + out, 0.62, 1.4), hard


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
    tone, hard = bedding(y1 - y0, W)
    k = formation_strength(y0 + (np.arange(W) + 0.5) / W * (y1 - y0))
    tone = 1 + (tone - 1) * (0.3 + 0.7 * k)
    hard = hard * k
    fine = np.stack([np.interp(pos, np.arange(n), lut[:, c]) for c in range(3)], 1) * tone[:, None]
    # 透明通道放硬度：0.5~1，不到 0 是因为有的解码器会预乘透明度，颜色不能被它带黑
    edge = ndimage.gaussian_filter1d(hard, 0.8)
    alpha = np.clip(0.75 + edge * 0.25, 0.5, 1.0)
    px = np.concatenate([lin_to_srgb(fine), alpha[:, None]], 1)[None, :, :]
    Image.fromarray((px * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'strata.png'))
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


def aux_map(h, river, cell, step, name):
    """辅助图（核心区 5 米一格，外圈 20 米）：R 岩缝和小沟，G 河面，B 看得到的天空。无损：三个通道互不相干，不能有色度抽样"""
    h5 = h[::step, ::step].astype(np.float32)
    cell = step * cell
    sky = sky_view(h5, cell)
    crev = np.clip((ndimage.gaussian_filter(h5, 11.0 / cell) - h5) / 4.0, 0, 1)
    print('  天空可见度', float(sky.min()), float(np.median(sky)), float(sky.max()))
    # G：河边 0→0.5 是水陆交界，再往里 0.5→1 是离岸多远（浅的地方透出河底）
    r5 = river[::step, ::step]
    bank = np.clip(ndimage.distance_transform_edt(r5 > 0.5) * cell / 26.0, 0, 1)
    a = np.stack([crev, r5 * 0.5 + bank * 0.5, sky], 2)[:2048, :2048]
    px = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    # （文件名别叫 aux：那是 Windows 的保留设备名，Git 打不开）
    Image.fromarray(px).save(os.path.join(OUT, name), 'WEBP', lossless=True, quality=60, method=4)
    print(' ', name, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 1), 'MB')


def scatter_map(h, alb, river):
    """镜头周围散布的东西（src/render/realScatter.ts）长在哪儿、长多密。5 米一格：R 灌木，G 碎石，B 枯草。
    灌木：航拍上周围亮、中间暗的小点，比影像的一个像素大不了多少，这里只数一块地里有多少。
    碎石：陡坡下面多，平地上的亮斑是露出来的石灰岩。枯草：平缓的浅色地面。
    路、停车场、房顶是灰的，又平，上面什么都不长"""
    k = 4
    n = alb.shape[0] // k
    lum = alb @ LUM
    blur = ndimage.gaussian_filter(lum, 0.8)
    bg = ndimage.gaussian_filter(lum, 7.0)
    rel = (bg - blur) / np.maximum(bg, 0.02)
    down = lambda a: a[:n * k, :n * k].reshape(n, k, n, k).mean(axis=(1, 3))
    shrub = np.clip(down(np.clip(rel / 0.28, 0, 1)) * 3.2, 0, 1)
    pale = np.clip(down(np.clip(-rel / 0.22, 0, 1)) * 2.4, 0, 1)
    h5 = h[:n * 2:2, :n * 2:2].astype(np.float32)
    cell = 2 * G['core'] / (h.shape[0] - 1)
    gy, gx = np.gradient(h5, cell)
    slope = np.hypot(gx, gy)
    t = lambda a, lo, hi: np.clip((a - lo) / (hi - lo), 0, 1) ** 2 * (3 - 2 * np.clip((a - lo) / (hi - lo), 0, 1))
    rock = np.maximum(t(slope, 0.25, 0.8) * 0.85, pale * 0.7) * (1 - t(slope, 1.5, 2.4)) + 0.05
    grass = (1 - t(slope, 0.2, 0.7)) * (1 - shrub * 0.5) * (0.35 + 0.65 * t(down(lum), 0.1, 0.3))
    shrub = shrub * (1 - t(slope, 1.2, 1.9))
    sat = down((alb.max(axis=2) - alb.min(axis=2)) / np.maximum(alb.max(axis=2), 0.02))
    # 灰的、平的、南缘上的：路、停车场、房顶
    paved = ndimage.gaussian_filter(((sat < 0.17) & (slope < 0.1) & (h5 > 1900)).astype(np.float32), 0.8)
    keep = (1 - np.clip(paved * 1.6, 0, 1)) * (1 - np.clip(river[:n * 2:2, :n * 2:2] * 1.5, 0, 1))
    a = np.stack([shrub * keep, rock * keep, grass * keep], 2)
    # 疏密不用那么精细：16 级，文件小得多
    px = (np.round(np.clip(a, 0, 1) * 15) * 17).astype(np.uint8)
    Image.fromarray(px).save(os.path.join(OUT, 'scatter.webp'), 'WEBP', lossless=True, quality=60, method=4)
    print('  scatter.webp', round(os.path.getsize(os.path.join(OUT, 'scatter.webp')) / 1e6, 1), 'MB', '灌木', float(shrub.mean()), '碎石', float(rock.mean()), '枯草', float(grass.mean()))


def river_mask(h, alb, cell, ref=None):
    """河面：激光测绘把水面压成了平的，谷底又平、又连成一大片的地方就是河。
    只有 10 米数据的地方水面不平，急流那里也不平，靠影像补：河水是一片均匀的橄榄色，比两岸的石头饱和得多，
    又贴着谷底最低的地方。影子里颜色看不出来，只看够不够暗；浅色的沙洲不算"""
    n = alb.shape[0] // 2
    hh = h[:n, :n].astype(np.float32)
    gy, gx = np.gradient(hh, cell)
    slope = np.hypot(gx, gy)
    fine = cell < 5
    # 一块地要多大才算：按面积。外圈 20 米一格，河才四五格宽，开运算不能做多了
    area = lambda m2: m2 / (cell * cell)
    low = hh < float(h.min()) + 60
    m = (slope < 0.012) & low
    if fine:
        m = ndimage.binary_opening(m, iterations=2)
    lab, k = ndimage.label(m)
    size = ndimage.sum(m, lab, np.arange(1, k + 1))
    keep = np.isin(lab, np.nonzero(size > area(18750))[0] + 1)
    # 影像：2.5 米一格，先抹掉水面的波纹
    a = ndimage.gaussian_filter(alb[::2, ::2], (1.5, 1.5, 0))[:n, :n]
    sat = (a[..., 0] - a[..., 2]) / np.maximum(a[..., 0], 0.02)
    lum = a @ LUM
    # （外圈用核心区认出来的河水颜色：外圈的河太窄，自己统计不准）
    s0, l0 = ref if ref else (float(np.median(sat[keep])), float(np.median(lum[keep])))
    # 谷底：一公里范围内的最低点
    st = max(1, int(round(20 / cell)))
    win = int(1000 / (st * cell)) | 1
    floor = ndimage.gaussian_filter(ndimage.minimum_filter(hh[::st, ::st], size=win), max(1.0, 120 / (st * cell)))
    floor = ndimage.zoom(floor, st, order=1)[:n, :n] if st > 1 else floor
    # 河是往下走的：外圈的范围大，高度上限要跟着谷底走，不能用全图最低点
    near = hh < floor + (11 if fine else 16)
    band = (hh < floor + (6 if fine else 9)) & near & (slope < (0.07 if fine else 0.14))
    if fine:
        near &= hh < float(h.min()) + 100
        band &= hh < float(h.min()) + 100
        smooth = ndimage.gaussian_filter(np.abs(lum - ndimage.gaussian_filter(lum, 3)), 3) / np.maximum(lum, 0.02)
        even = smooth < float(np.percentile(smooth[keep], 97)) * 1.3
    else:
        # 外圈还要是谷底本身：台地上的绿地也可能很平、很饱和。整条河都比最低处高不了多少
        deep = (ndimage.gaussian_filter(hh, 600 / cell) - hh > 70) & (hh < float(h.min()) + 260)
        near &= deep
        band &= deep
        even = True
    water = ((sat > s0 * 0.86) & near & even) | (band & ((sat > s0 * 0.62) | (lum < l0 * 0.4)))
    # 外圈的河只有四五格宽，颜色有时认不出来：紧贴一公里内最低处的地方，不看颜色也算
    water = (ndimage.binary_opening(water, iterations=3) if fine else water | ((hh < floor + 3) & deep)) | keep
    lab, k = ndimage.label(water, structure=np.ones((3, 3)))
    size = ndimage.sum(water, lab, np.arange(1, k + 1))
    part = ndimage.binary_closing(np.isin(lab, np.nonzero(size > area(37500))[0] + 1), iterations=5 if fine else 2)
    out = np.zeros(h.shape, np.float32)
    out[:n, :n] = part
    print('  河面', int(part.sum()), '格，高度', float(hh[part].min()), float(hh[part].max()), '分成', int((size > area(37500)).sum()), '段', '饱和度', round(s0, 3))
    return np.clip(ndimage.gaussian_filter(out, 1.2 if fine else 0.6), 0, 1), (s0, l0)


def flatten_river(h, river, cell):
    """水面要平：10 米的数据在河面上也是起伏的。河面上的高度换成沿河平滑过的，岸边过渡"""
    m = (river > 0.5).astype(np.float32)
    sg = 60.0 / cell
    w = ndimage.gaussian_filter(m, sg) + 1e-4
    s = ndimage.gaussian_filter(h * m, sg) / w
    k = np.clip(river * 1.3, 0, 1)
    return (h * (1 - k) + s * k).astype(np.float32)


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
    # 0、4 犹他刺柏，1、5 矮松（两种形状），2 三角叶杨，3 矮灌丛
    two = rs.random(n) < 0.5
    kind = np.where(creek, 2, np.where(rs.random(n) < 0.6, np.where(two, 0, 4), np.where(rs.random(n) < 0.72, np.where(two, 1, 5), 3)))
    size = np.clip(0.75 + dk * 1.6 + rs.normal(0, 0.13, n), 0.6, 1.5)
    size = np.where(creek, size * 1.2, size)
    size = np.where((kind == 1) | (kind == 5), size * 0.92, size)
    # 小的灌木由散布在镜头周围现长（见 src/render/realScatter.ts），这里只留大的：远处也看得到的那些
    most = 40000
    if len(bx) > most:
        pick = np.argsort(-bd)[:most]
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
    with open(os.path.join(OUT, 'trees.dat'), 'wb') as o, gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=o, mtime=0) as f:
        f.write(xz.tobytes())
        f.write(meta.tobytes())
    print('  树', n, '其中溪边', int(creek.sum()), round(os.path.getsize(os.path.join(OUT, 'trees.dat')) / 1e6, 2), 'MB')


def main():
    print('高程')
    core = merge_lidar(fill_nodata(mosaic('dem_core', 4097, 1)))
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
    # 亮度和颜色不再调：航拍的色调本来就是对的。以前提过亮度和饱和度，片岩成了土黄色，林下的土成了柠檬黄
    print('  中位数', float(np.median(a0 @ LUM)), float(np.median(a1 @ LUM)), float(np.median(a2 @ LUM)))
    y0, y1 = 600.0, 2420.0
    strata_lut(core, a0, 1.25, y0, y1)
    river, tone = river_mask(core, a0, 2.5)
    core = flatten_river(core, river, 2.5)
    aux_map(core, river, 2.5, 2, 'sky_river.webp')
    # 外圈也能飞：河不能一出核心区就变回影像上的颜色
    river1, _ = river_mask(mid, a1, 20.0, tone)
    mid = flatten_river(mid, river1, 20.0)
    aux_map(mid, river1, 20.0, 1, 'sky_river_mid.webp')
    find_trees(core, a0, 1.25)
    scatter_map(core, a0, river)
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
