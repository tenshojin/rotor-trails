# 把 30 厘米航拍切成流式加载的小块（public/real/grandcanyon/hi/），见 docs/design.md 的“30 厘米影像”。
# 运行：python -I tools/real/prep_hires.py <下载目录> <core.webp> <成品目录> [--rows 起 止] [--cols 起 止] [--q 质量] [--jobs 进程数]
#      --rows、--cols 按 640 米的下载块算（0~15），只做一部分的时候用。
#      --again：第一遍的结果还在（<下载目录>/_work），只重新切块。
#
# 每块 512×512，0.3125 米一个像素（现有核心区影像的四分之一），160 米见方。
# RGB：没有影子的地面颜色。A：这个像素在航拍里晒得到太阳的程度（游戏用它挡直射光，见下）。
#
# 大尺度的颜色跟着 core.webp 走（去过光照、补过影子、调过色），不然环形贴图的边上颜色接不上；
# 十来米以内的东西全是 30 厘米原片的。
#
# 影子：照片里的影子分开存，不留在颜色里。
#   留在颜色里的话，三维树的实时影子落上去要暗两层；黄昏太阳到了对面，影子方向还是反的。
#   这里用近红外找影子（树冠在近红外里和地面一样亮，影子全黑，可见光里两个都是暗的）。
#   小块的影子（树和灌木的）：提亮到和旁边晒太阳的地面一样，影子本身写进 A 通道，游戏里只用它挡直射光：
#   和实时影子挡的是同一份光，叠在一起也只暗一层；太阳和拍摄时差太多就不用它。
#   大片的影子（山的）：实时影子自己会画，A 里不写。这一片是两天里某个时候的太阳，和游戏的太阳不一定对得上，
#   写进去就是阳光底下一片黑。颜色和对比度按旁边晒太阳的地方拉回来（统计匹配）：影子里每个通道的信号都在，只是暗。
#   A 只有三档：连续的透明度压缩以后比颜色还大，三档只多一成多。提亮用的是同一份三档的值，
#   所以 颜色 × 光照 在拍摄时的太阳下还是原片的样子，三档的边不会露出来。
#
# 树：地上站着三维的树，照片里的树冠再贴在地上就是一地的贴纸，三维的树和它还对不齐。
#   trees.dat 里的位置是 1.25 米影像上暗斑的中心，也就是树冠和影子一起的中心。这里用近红外（NDVI）
#   找到真正的树冠，把树挪过去；有三维树站着的树冠从照片里抠掉换成地面，它的影子也不要了，实时影子会画。
#   没有三维树的小灌木留在照片里，影子也留着。

import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import gzip
import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

Image.MAX_IMAGE_PIXELS = None

PX = 0.3125
BASE_PX = 1.25
K = 4
HALF = 5120.0
# 下载块：640 米，2048 像素，切成 4×4 块成品
BLOCK = 2048
TILE = 512
PER = BLOCK // TILE
NB = 16
# 树的种类（见 prep_grandcanyon.py 的 find_trees）：树冠半径、树高（米，大小 = 1 时）
TREE_R = [2.6, 3.0, 4.5, 1.25, 2.6, 2.5, 3.8]
TREE_H = [4.5, 6.5, 12.0, 1.3, 4.5, 5.4, 19.5]
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def box(a, r):
    return ndimage.uniform_filter(a, size=2 * r + 1, mode='nearest')


def guided(guide, src, r, eps):
    """导向滤波：让影子的边贴到照片上真实的边"""
    mI = box(guide, r)
    mP = box(src, r)
    cov = box(guide * src, r) - mI * mP
    var = box(guide * guide, r) - mI * mI
    a = cov / (var + eps)
    b = mP - a * mI
    return box(a, r) * guide + box(b, r)


def shrink(a):
    """平均到 1.25 米一格"""
    h, w = a.shape[:2]
    return a.reshape(h // K, K, w // K, K, *a.shape[2:]).mean((1, 3))


def grow(a):
    """放大回 0.3125 米（线性插值，只给平滑的东西用）"""
    if a.ndim == 3:
        return np.stack([grow(a[..., c]) for c in range(a.shape[2])], 2)
    return ndimage.zoom(a, K, order=1, mode='nearest', grid_mode=True).astype(np.float32)


def blur(a, s):
    if a.ndim == 3:
        return np.stack([ndimage.gaussian_filter(a[..., c], s, mode='nearest') for c in range(a.shape[2])], 2)
    return ndimage.gaussian_filter(a, s, mode='nearest')


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def shadow_matte(lin, nir):
    """1 = 影子。近红外里影子是全黑的，地面和树冠都亮；可见光里特别暗的也算（大片影子里的树只有天光，近红外不够黑）"""
    lum = lin @ LUM
    m = np.maximum(1 - smooth(0.075, 0.15, nir), 1 - smooth(0.02, 0.035, lum))
    # 近红外只有 0.6 米一格，边不够利：贴到可见光的边上
    g = np.log(np.maximum(lum, 2e-3)).astype(np.float32)
    return np.clip(guided(g, m, 3, 0.01), 0, 1)


def crown_matte(lin, nir, m):
    """1 = 树冠。NDVI 高的地方；影子里两个波段都是噪点，不算"""
    r = ndimage.gaussian_filter(lin[..., 0], 1.0)
    ndvi = (nir - r) / (nir + r + 0.02)
    return (smooth(0.26, 0.36, ndvi) * (1 - smooth(0.3, 0.7, m))).astype(np.float32)


def split_shadow(ml):
    """1.25 米一格：大片的是地形的影子（core.webp 里补过了），小块的是树影（core.webp 里还是暗的）"""
    s = ml > 0.5
    core = ndimage.binary_opening(s, ndimage.generate_binary_structure(2, 1), iterations=7)
    big = ndimage.binary_propagation(core, mask=s)
    return big, s & ~big


def gains(rl, ml, cl, base, small, sigma_m=8.0):
    """1.25 米一格，返回晒太阳的地方和影子里各自要乘多少（三个通道）。
    大尺度的颜色要和 core.webp 一样。晒太阳和影子分开算：混在一起的话影子的边上一圈全是错的"""
    # core.webp 里树影的地方是暗的：用旁边的地面填上（树冠不算地面），当成提亮的目标
    hole = ndimage.maximum_filter(small.astype(np.float32), size=3)
    keep = (1 - hole) * (1 - cl)
    s0 = 4.0 / BASE_PX
    fill = blur(base * keep[..., None], s0) / np.maximum(blur(keep, s0), 1e-3)[..., None]
    tgt = base * (1 - hole[..., None]) + fill * hole[..., None]
    s = sigma_m / BASE_PX
    lit = np.clip(1 - ml, 0, 1)
    sh = np.clip(ml, 0, 1)

    def ratio(w):
        num = blur(tgt * w[..., None], s)
        den = blur(rl * w[..., None], s)
        return num / np.maximum(den, 1e-4), blur(w, s)

    gl, wl = ratio(lit)
    gs, ws = ratio(sh)
    gl = np.clip(gl, 0.35, 3.0)
    gs = np.clip(gs, 0.8, 16.0)
    # 附近一点晒太阳的地方都没有：只能靠影子自己的比例，反过来也一样
    gl = np.where(wl[..., None] > 0.02, gl, gs / 4)
    gs = np.where(ws[..., None] > 0.02, gs, gl * 4)
    return gl.astype(np.float32), gs.astype(np.float32)


def in_bands(H, band=2048, pad=64):
    """整张图一次算要七八个 G 内存，一条一条算。pad 比模糊的半径大，条和条之间看不出来"""
    for y in range(0, H, band):
        a = max(y - pad, 0)
        b = min(y + band + pad, H)
        yield slice(a, b), slice(y - a, y - a + min(band, H - y)), slice(y, min(y + band, H))


def coarse(a, f=8):
    """平均到 10 米一格：下面的统计都是几十米以上的尺度，全分辨率上模糊要慢几十倍"""
    h, w = a.shape
    return a.reshape(h // f, f, w // f, f).mean((1, 3))


def spread(num, den, scales=(25.0, 80.0, 250.0)):
    """加权平均：先看近处，近处没有数据的地方自动用远一点的（大片影子中间几百米内都没有晒太阳的地方）"""
    a = np.zeros_like(num)
    b = np.zeros_like(num)
    k = 1.0
    for sc in scales:
        s = sc / (BASE_PX * 8)
        a += ndimage.gaussian_filter(num, s, mode='nearest') * k
        b += ndimage.gaussian_filter(den, s, mode='nearest') * k
        k *= 0.05
    return a / np.maximum(b, 1e-6)


def shadow_stats(rl, ml, big, base):
    """大片影子的统计：影子里和旁边晒太阳的地方，每个通道（对数）的平均和起伏。
    要拉到的颜色一半取旁边晒太阳的地方，一半取 core.webp 在这里的颜色（按同一层岩石借的）：
    只看旁边的话，旁边是一片林子，影子里的石头也成了绿的"""
    ws = ml * big
    wl = 1 - ml
    cs = coarse(ws).astype(np.float64)
    cl = coarse(wl).astype(np.float64)
    h, w = cs.shape
    out = [np.zeros((h, w, 3), np.float32) for _ in range(3)]
    for c in range(3):
        log = np.log(np.maximum(rl[..., c].astype(np.float32), 1e-3))
        ms = spread(coarse(log * ws).astype(np.float64), cs)
        mL = spread(coarse(log * wl).astype(np.float64), cl)
        vs = spread(coarse(log * log * ws).astype(np.float64), cs) - ms * ms
        vL = spread(coarse(log * log * wl).astype(np.float64), cl) - mL * mL
        mB = spread(coarse(np.log(np.maximum(base[..., c].astype(np.float32), 1e-3)) * ws).astype(np.float64), cs)
        out[0][..., c] = ms
        out[1][..., c] = 0.5 * mL + 0.5 * mB
        out[2][..., c] = np.clip(np.sqrt(np.maximum(vL, 0) / np.maximum(vs, 1e-4)), 1.0, 1.45)
    up = lambda a: np.stack([ndimage.zoom(a[..., c], 8, order=1, mode='nearest', grid_mode=True) for c in range(3)], 2)
    return [up(a) for a in out]


def unshade(rgb, mb, gl, ms, mL, ratio):
    """把大片影子里的像素按统计拉成晒太阳的样子。mb：这里有多少在影子里。
    一个像素的亮度是晒到的部分和没晒到的部分加起来：影子边上的像素要除这个，直接乘影子的倍数是一圈橙色的边
    （红色在影子里最弱，倍数最大）。颜色噪点多，取平滑的，明暗留原来的"""
    w = mb[..., None]
    g = np.exp(grow(mL) - grow(ms))
    v = rgb / np.maximum((1 - w) / grow(gl) + w / g, 1e-3)
    d = np.clip(np.log(np.maximum(rgb, 1e-3)) - grow(ms), -1.5, 1.5)
    v = v * np.exp((grow(ratio) - 1) * d * w * w)
    l = np.maximum(v @ LUM, 1e-4)
    sm = 0.8 / PX
    soft = blur(v, sm) / np.maximum(blur(l, sm), 1e-4)[..., None] * l[..., None]
    return np.clip(v * (1 - w) + soft * w, 0, 1)


def fill_big(m, lin, big):
    """大片影子里的树只有天光，近红外不够黑：挨着大片影子又暗的像素也算影子。晒着太阳的东西再暗也比这亮"""
    near = grow(ndimage.binary_dilation(big, iterations=2).astype(np.float32))
    return np.maximum(m, near * (1 - smooth(0.035, 0.06, lin @ LUM))).astype(np.float32)


def levels(m):
    """A 通道只存三档"""
    return (np.round(np.clip(ndimage.gaussian_filter(m, 0.8), 0, 1) * 2) / 2).astype(np.float32)


def lifted(rl, ml, gl, gs):
    """1.25 米一格的提亮结果"""
    w = ml[..., None]
    return rl / np.maximum((1 - w) / gl + w / gs, 1e-3)


def chroma_of(ol, cl):
    """平滑的颜色（各通道除以亮度）。影子里的颜色全靠它，要在拼好的整张图上算，块的边上才接得上。
    树冠不算：影子里的地面不能染上绿色"""
    s = 2.0 / BASE_PX
    w = (1 - cl)[..., None] + 0.02
    return (blur(ol * w, s) / np.maximum(blur((ol @ LUM)[..., None] * w, s), 1e-4)).astype(np.float32)


def relight(rgb, m, gl, gs, chroma):
    """去掉影子，大尺度的颜色对上 core.webp。m：三档的影子，gl、gs、chroma：1.25 米一格。返回颜色"""
    L = grow(gl)
    S = grow(gs)
    # 一个像素的亮度是晒到的部分和没晒到的部分加起来，要除的是这个，不是把两个倍数平均
    w = m[..., None]
    out = rgb / np.maximum((1 - w) / L + w / S, 1e-3)
    # 提亮后影子里的颜色是噪点放大出来的：只留明暗，颜色取平滑的
    l = np.maximum(out @ LUM, 1e-4)
    calm = 0.5 * l + 0.5 * blur(l, 0.9)
    deep = m * smooth(3.0, 8.0, S @ LUM)
    lo = l * (1 - deep) + calm * deep
    out = out * (1 - w) + grow(chroma) * lo[..., None] * w
    return np.clip(out, 0, 1)


def fill_ground(col, hole):
    """把洞换成地面：大的颜色取旁边的地面，细碎的东西从洞外面镜像借过来（和 prep_grandcanyon.py 的 fill_shadows 一个办法）"""
    solid = hole > 0.5
    if not solid.any():
        return col
    H, W = solid.shape
    keep = (~ndimage.binary_dilation(solid, iterations=2)).astype(np.float32)
    far, near = ndimage.distance_transform_edt(keep < 0.5, return_indices=True)
    # 洞里先铺上最近的地面再模糊：大的树冠（溪边的三角叶杨）十几米宽，只靠模糊够不到中间。
    # 洞的中间再模糊一点，不然看得出一块块最近的地面
    nearest = col[near[0], near[1]]
    k = smooth(1.5 / PX, 5.0 / PX, far)[..., None]
    low = blur(nearest, 1.6 / PX) * (1 - k) + blur(nearest, 6.0 / PX) * k
    hp = col / np.maximum(blur(col, 2.0 / PX), 1e-3)
    yy, xx = np.nonzero(hole > 0.01)
    py = np.clip(2 * near[0][yy, xx] - yy, 0, H - 1)
    px = np.clip(2 * near[1][yy, xx] - xx, 0, W - 1)
    bad = keep[py, px] < 0.5
    py[bad] = near[0][yy[bad], xx[bad]]
    px[bad] = near[1][yy[bad], xx[bad]]
    w = ndimage.gaussian_filter(hole, 1.0)[yy, xx, None]
    out = col.copy()
    out[yy, xx] = col[yy, xx] * (1 - w) + low[yy, xx] * np.clip(hp[py, px], 0.6, 1.6) * w
    return out


def crisp(col, amount=0.4):
    """航拍本身有点软，低空放大以后更软：明暗加一点锐度，颜色不动"""
    l = np.maximum(col @ LUM, 1e-3)
    return np.clip(col * ((l + (l - blur(l, 1.0)) * amount) / l)[..., None], 0, 1)


def tree_masks(trees, x0, z0, S):
    """这块地里三维树占的地方。trees：世界 x、z，树冠半径，影子长度。x0、z0 是这块地的西北角。返回 (树冠附近, 树冠和影子的范围)"""
    disc = Image.new('L', (S, S), 0)
    cast = Image.new('L', (S, S), 0)
    a = ImageDraw.Draw(disc)
    b = ImageDraw.Draw(cast)
    # 影子朝太阳的反方向（拍摄时方位 100 度），z 向南
    az = math.radians(100)
    dx = -math.sin(az)
    dz = math.cos(az)
    for x, z, r, ln in trees:
        cx = (x - x0) / PX
        cz = (z - z0) / PX
        rr = (r + 0.8) / PX
        a.ellipse((cx - rr, cz - rr, cx + rr, cz + rr), fill=255)
        rs = r / PX
        ex = cx + dx * ln / PX
        ez = cz + dz * ln / PX
        b.line((cx, cz, ex, ez), fill=255, width=int(rs * 2))
        b.ellipse((ex - rs, ez - rs, ex + rs, ez + rs), fill=255)
        b.ellipse((cx - rs, cz - rs, cx + rs, cz + rs), fill=255)
    return np.asarray(disc) > 0, np.asarray(cast) > 0


def drop_tree_shadows(m, cast, big):
    """三维树的影子实时画：和它碰得上的小块影子都不要。大片的影子是山的"""
    lab, n = ndimage.label(m > 0.25)
    if n == 0:
        return m
    hit = np.bincount(lab[cast], minlength=n + 1)
    size = np.bincount(lab.ravel(), minlength=n + 1)
    drop = hit > 0.25 * size
    drop[0] = False
    drop[np.unique(lab[grow(big.astype(np.float32)) > 0.5])] = False
    return np.where(drop[lab], 0.0, m).astype(np.float32)


def read_trees(path):
    raw = open(path, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    n = len(raw) // 6
    xz = np.frombuffer(raw, '<u2', n * 2).reshape(n, 2).astype(np.float64)
    meta = np.frombuffer(raw, np.uint8, n * 2, offset=n * 4).reshape(n, 2)
    return (xz / 65535 - 0.5) * (2 * HALF), meta


def write_trees(path, pos, meta):
    xz = np.round((pos / (2 * HALF) + 0.5) * 65535).clip(0, 65535).astype('<u2')
    with open(path, 'wb') as o, gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=o, mtime=0) as f:
        f.write(xz.tobytes())
        f.write(meta.tobytes())


def snap_trees(pos, cl, x0, z0):
    """把树挪到真正的树冠上。cl：1.25 米一格的树冠，x0、z0 是它的西北角（世界坐标）。一个树冠只站一棵树"""
    c = ndimage.gaussian_filter(cl, 1.0)
    py, px = np.nonzero((ndimage.maximum_filter(c, size=3) == c) & (c > 0.3))
    peaks = np.stack([(px + 0.5) * BASE_PX + x0, (py + 0.5) * BASE_PX + z0], 1)
    print('  树冠', len(peaks), '树', len(pos), flush=True)
    if len(peaks) == 0:
        return pos, np.zeros(len(pos), bool)
    d, i = cKDTree(peaks).query(pos, distance_upper_bound=5.0)
    out = pos.copy()
    moved = np.zeros(len(pos), bool)
    taken = np.zeros(len(peaks), bool)
    for k in np.argsort(d):
        if not np.isfinite(d[k]):
            break
        if taken[i[k]]:
            continue
        taken[i[k]] = True
        out[k] = peaks[i[k]]
        moved[k] = True
    print('  挪上树冠的', int(moved.sum()), '平均挪了', round(float(d[moved].mean()), 2), '米', flush=True)
    return out, moved


def load_block(src, grid, r, c):
    """一个 640 米的下载块：0.3125 米一格的线性 RGB 和近红外"""
    name = f'b_{r:02d}_{c:02d}.jpg'
    t = grid[name]
    w = t['size'] / t['cell']
    l = (t['px'] - w) / 2
    rgb = Image.open(os.path.join(src, name)).convert('RGB').resize((BLOCK, BLOCK), Image.LANCZOS, box=(l, l, l + w, l + w))
    name = f'n_{r:02d}_{c:02d}.jpg'
    t = grid[name]
    w = t['size'] / t['cell']
    l = (t['px'] - w) / 2
    nir = Image.open(os.path.join(src, name)).convert('L').resize((BLOCK, BLOCK), Image.BICUBIC, box=(l, l, l + w, l + w))
    return srgb_to_lin(np.asarray(rgb, np.float32) / 255), srgb_to_lin(np.asarray(nir, np.float32) / 255)


def first_pass(job):
    """1.25 米一格的原片、影子和树冠"""
    src, grid, r, c = job
    rgb, nir = load_block(src, grid, r, c)
    m = shadow_matte(rgb, nir)
    return r, c, shrink(rgb), shrink(m), shrink(crown_matte(rgb, nir, m))


def second_pass(job):
    """切块。大的场（倍数、颜色）在硬盘上，每个进程只读自己那一块"""
    src, grid, r, c, work, out, q, r0, c0 = job
    n = BLOCK // K
    y = (r - r0) * n
    x = (c - c0) * n
    ms = np.load(os.path.join(work, 'ms.npy'), mmap_mode='r')[y:y + n, x:x + n]
    mL = np.load(os.path.join(work, 'mL.npy'), mmap_mode='r')[y:y + n, x:x + n]
    ratio = np.load(os.path.join(work, 'ratio.npy'), mmap_mode='r')[y:y + n, x:x + n]
    gl = np.load(os.path.join(work, 'gl.npy'), mmap_mode='r')[y:y + n, x:x + n]
    gs = np.load(os.path.join(work, 'gs.npy'), mmap_mode='r')[y:y + n, x:x + n]
    ch = np.load(os.path.join(work, 'chroma.npy'), mmap_mode='r')[y:y + n, x:x + n]
    big = np.load(os.path.join(work, 'big.npy'), mmap_mode='r')[y:y + n, x:x + n]
    rgb, nir = load_block(src, grid, r, c)
    big = np.asarray(big)
    m0 = shadow_matte(rgb, nir)
    crown = crown_matte(rgb, nir, m0)
    # 这块地里的三维树（多留一圈：挨着边的树的影子要伸进来）
    t = np.load(os.path.join(work, 'trees.npy'))
    x0 = c * BLOCK * PX - HALF
    z0 = r * BLOCK * PX - HALF
    side = BLOCK * PX
    t = t[(t[:, 0] > x0 - 30) & (t[:, 0] < x0 + side + 30) & (t[:, 1] > z0 - 30) & (t[:, 1] < z0 + side + 30)]
    disc, cast = tree_masks(t, x0, z0, BLOCK)
    m1 = fill_big(m0, rgb, big)
    # 大片的影子单独处理，A 里只有小块的
    zone = grow(ndimage.binary_dilation(big, iterations=3).astype(np.float32))
    zone = ndimage.gaussian_filter(zone, 2.0)
    mb = m1 * zone
    m = levels(drop_tree_shadows(m1 * (1 - zone), cast, big))
    col = relight(rgb, m, np.asarray(gl, np.float32), np.asarray(gs, np.float32), np.asarray(ch, np.float32))
    v = unshade(rgb, mb, np.asarray(gl, np.float32), np.asarray(ms, np.float32), np.asarray(mL, np.float32), np.asarray(ratio, np.float32))
    col = col * (1 - zone[..., None]) + v * zone[..., None]
    hole = np.clip(ndimage.gaussian_filter((crown > 0.3).astype(np.float32) * disc, 1.2) * 1.6, 0, 1)
    col = crisp(fill_ground(col, hole))
    px = (lin_to_srgb(col) * 255 + 0.5).astype(np.uint8)
    alpha = ((1 - m) * 255 + 0.5).astype(np.uint8)
    size = 0
    for j in range(PER):
        for i in range(PER):
            sl = (slice(j * TILE, (j + 1) * TILE), slice(i * TILE, (i + 1) * TILE))
            row = r * PER + j
            col_i = c * PER + i
            d = os.path.join(out, str(row))
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, f'{col_i}.webp')
            Image.fromarray(np.dstack([px[sl], alpha[sl]]), 'RGBA').save(path, 'WEBP', quality=q, alpha_quality=100, method=6, exact=True)
            size += os.path.getsize(path)
    return r, c, size


def write_index(out, sun):
    n = NB * PER
    rows = []
    for j in range(n):
        v = 0
        for i in range(n):
            v = v * 2 + (1 if os.path.exists(os.path.join(out, str(j), f'{i}.webp')) else 0)
        rows.append(f'{v:0{n // 4}x}')
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(tile=TILE * PX, px=TILE, n=n, sun=sun, have=rows), f, indent=0)


def arg(name, default, count=1):
    if name not in sys.argv:
        return default
    i = sys.argv.index(name)
    v = sys.argv[i + 1:i + 1 + count]
    return v[0] if count == 1 else v


def main():
    src, core_path, out = sys.argv[1:4]
    rows = [int(v) for v in arg('--rows', [0, NB - 1], 2)]
    cols = [int(v) for v in arg('--cols', [0, NB - 1], 2)]
    q = int(arg('--q', 60))
    jobs = int(arg('--jobs', 4))
    work = arg('--work', os.path.join(src, '_work'))
    os.makedirs(work, exist_ok=True)
    os.makedirs(out, exist_ok=True)
    grid = json.load(open(os.path.join(src, 'grid.json'), encoding='utf-8'))
    photo = json.load(open(os.path.join(os.path.dirname(core_path), 'meta.json'), encoding='utf-8'))
    r0, r1 = rows
    c0, c1 = cols
    again = '--again' in sys.argv
    if not again:
        n = BLOCK // K
        H = (r1 - r0 + 1) * n
        W = (c1 - c0 + 1) * n
        core = np.asarray(Image.open(core_path).convert('RGB'))[r0 * n:r0 * n + H, c0 * n:c0 * n + W]
        base = np.zeros((H, W, 3), np.float16)
        for full, _, _ in in_bands(H, pad=0):
            base[full] = srgb_to_lin(core[full].astype(np.float32) / 255)
        del core
        # （整张图的中间结果用半精度：机器上常有别的大程序在跑，内存要省着用）
        rl = np.zeros((H, W, 3), np.float16)
        ml = np.zeros((H, W), np.float32)
        cl = np.zeros((H, W), np.float32)
        todo = [(src, grid, r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
        print('第一遍', len(todo), '块', flush=True)
        with ProcessPoolExecutor(jobs) as ex:
            for i, (r, c, a, b, d) in enumerate(ex.map(first_pass, todo)):
                y = (r - r0) * n
                x = (c - c0) * n
                rl[y:y + n, x:x + n] = a
                ml[y:y + n, x:x + n] = b
                cl[y:y + n, x:x + n] = d
                if i % 16 == 15:
                    print(' ', i + 1, flush=True)
        print('树', flush=True)
        # 挪树的起点永远是 prep_grandcanyon.py 写的原始位置，这个工具跑几遍结果都一样
        keep = os.path.join(src, 'trees_orig.dat')
        trees_path = os.path.join(os.path.dirname(core_path), 'trees.dat')
        if not os.path.exists(keep):
            with open(trees_path, 'rb') as a, open(keep, 'wb') as b:
                b.write(a.read())
        pos, meta = read_trees(keep)
        wx0 = c0 * BLOCK * PX - HALF
        wz0 = r0 * BLOCK * PX - HALF
        side_x = (c1 - c0 + 1) * BLOCK * PX
        side_z = (r1 - r0 + 1) * BLOCK * PX
        inside = (pos[:, 0] >= wx0) & (pos[:, 0] < wx0 + side_x) & (pos[:, 1] >= wz0) & (pos[:, 1] < wz0 + side_z)
        snapped, moved = snap_trees(pos[inside], cl, wx0, wz0)
        pos[inside] = snapped
        write_trees(arg('--trees', trees_path), pos, meta)
        # 只有站在树冠上的树才抠照片。没挪的树附近没有树冠，抠了也是白抠
        sel = meta[inside]
        size = sel[:, 1].astype(np.float64) / 100
        rad = np.array(TREE_R)[sel[:, 0]] * size
        ln = np.array(TREE_H)[sel[:, 0]] * size * 1.15
        np.save(os.path.join(work, 'trees.npy'), np.stack([snapped[:, 0], snapped[:, 1], rad, ln], 1)[moved])
        del pos, meta
        print('算倍数', flush=True)
        big, small = split_shadow(ml)
        np.save(os.path.join(work, 'big.npy'), big)
        for name, a in zip(('ms', 'mL', 'ratio'), shadow_stats(rl, ml, big, base)):
            np.save(os.path.join(work, name + '.npy'), a.astype(np.float16))
        gl = np.zeros((H, W, 3), np.float16)
        gs = np.zeros((H, W, 3), np.float16)
        chroma = np.zeros((H, W, 3), np.float16)
        for src_rows, part, dst in in_bands(H):
            r32 = rl[src_rows].astype(np.float32)
            a, b = gains(r32, ml[src_rows], cl[src_rows], base[src_rows].astype(np.float32), small[src_rows])
            gl[dst] = a[part]
            gs[dst] = b[part]
            # 大片影子里的窟窿补上以后，影子的范围和这里不太一样，这里的颜色只要个大概
            chroma[dst] = chroma_of(lifted(r32, ml[src_rows], a, b), cl[src_rows])[part]
        del base, rl, ml, cl, small
        np.save(os.path.join(work, 'gl.npy'), gl)
        np.save(os.path.join(work, 'gs.npy'), gs)
        np.save(os.path.join(work, 'chroma.npy'), chroma)
        del gl, gs, chroma, big
    print('第二遍', flush=True)
    total = 0
    # （--again 用的是整张图算好的结果）
    todo = [(src, grid, r, c, work, out, q, 0 if again else r0, 0 if again else c0) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    with ProcessPoolExecutor(jobs) as ex:
        for i, (r, c, size) in enumerate(ex.map(second_pass, todo)):
            total += size
            if i % 16 == 15:
                print(' ', i + 1, round(total / 1e6, 1), 'MB', flush=True)
    write_index(out, photo['sun'])
    print('完成', round(total / 1e6, 1), 'MB', flush=True)


if __name__ == '__main__':
    main()
