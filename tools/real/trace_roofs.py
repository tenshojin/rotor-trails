# 半自动描屋顶：人在 30 厘米影像上给种子点（看着图点一下屋顶），程序按颜色从种子长出轮廓，套上最小外接矩形。
# 灰色屋顶和路面颜色接近，全自动分不开；有了种子就只要回答“这一块长到哪儿”。
# 阈值从紧到松试，取第一个面积合理、够方的。两面坡只长出向阳的半边时，往暗的一边补全（那一侧要不绿、够平）。
# 已经手描过的房子（maps/grandcanyonBuildings.ts）跳过。
#
# 运行：python -I tools/real/trace_roofs.py <瓦片目录> tools/real/roof_seeds.json src/maps/grandcanyonBuildings.ts > houses.txt
# 输出是 grandcanyonBuildings.ts 里的一行行：[中心 x, 中心 z, 长, 宽, 转角, 檐口高, 屋脊比檐口高多少]
# 种子表 roof_seeds.json：每一片 {box: [x0, x1, z0, z1], scale: 看图时一个像素几米, radius: 长多远（米）, seeds: [[图上 x, 图上 y], ...]}

import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ni
from scipy.spatial import ConvexHull

TILES, SEEDS, DONE = sys.argv[1:4]
ix = json.load(open(os.path.join(TILES, 'index.json')))
TILE, N, PX = ix['tile'], ix['n'], ix['px']
HALF = TILE * N / 2
SC = TILE / PX
_cache = {}


def mosaic(x0, x1, z0, z1):
    W = int((x1 - x0) / SC)
    H = int((z1 - z0) / SC)
    im = Image.new('RGB', (W, H))
    for r in range(int((z0 + HALF) // TILE), int((z1 + HALF) // TILE) + 1):
        for c in range(int((x0 + HALF) // TILE), int((x1 + HALF) // TILE) + 1):
            p = os.path.join(TILES, str(r), f'{c}.webp')
            if os.path.exists(p):
                im.paste(Image.open(p).convert('RGB'), (round((c * TILE - HALF - x0) / SC), round((r * TILE - HALF - z0) / SC)))
    return np.asarray(im).astype(np.float32)


def min_rect(pts):
    hp = pts[ConvexHull(pts).vertices]
    best = None
    for i in range(len(hp)):
        e = hp[(i + 1) % len(hp)] - hp[i]
        ang = np.arctan2(e[1], e[0])
        c, s = np.cos(ang), np.sin(ang)
        u = hp[:, 0] * c + hp[:, 1] * s
        v = -hp[:, 0] * s + hp[:, 1] * c
        A = (u.max() - u.min()) * (v.max() - v.min())
        if best is None or A < best[0]:
            cu, cv = (u.max() + u.min()) / 2, (v.max() + v.min()) / 2
            best = (A, u.max() - u.min(), v.max() - v.min(), ang, cu * c - cv * s, cu * s + cv * c)
    return best


def grow(a, L, c1, c2, px0, py0, R, x0, z0):
    H, W = L.shape
    ya, yb = max(0, py0 - R), min(H, py0 + R)
    xa, xb = max(0, px0 - R), min(W, px0 + R)
    w = 4
    m0 = (np.median(c1[py0 - w:py0 + w, px0 - w:px0 + w]), np.median(c2[py0 - w:py0 + w, px0 - w:px0 + w]), np.median(L[py0 - w:py0 + w, px0 - w:px0 + w]))
    dc = np.hypot(c1[ya:yb, xa:xb] - m0[0], c2[ya:yb, xa:xb] - m0[1])
    dl = np.abs(L[ya:yb, xa:xb] - m0[2])
    best = None
    for tc, tl in ((5, 20), (7, 26), (9, 32), (11, 38), (13, 46)):
        lab, _ = ni.label(ni.binary_opening((dc < tc) & (dl < tl), iterations=2))
        k = lab[py0 - ya, px0 - xa]
        if k == 0:
            d = ni.distance_transform_edt(lab == 0, return_indices=True)[1]
            k = lab[d[0][py0 - ya, px0 - xa], d[1][py0 - ya, px0 - xa]]
        if k == 0:
            continue
        m = ni.binary_fill_holes(ni.binary_closing(lab == k, iterations=3))
        ys, xs = np.nonzero(m)
        if len(xs) < 40:
            continue
        rA, rw, rd, ang, cx, cz = min_rect(np.stack([xs + xa, ys + ya], 1).astype(np.float64) * SC)
        fill = m.sum() * SC * SC / max(rA, 1)
        if rd > rw:
            ang += np.pi / 2
        o = dict(x=x0 + cx, z=z0 + cz, w=max(rw, rd), d=min(rw, rd), rot=float(np.degrees(ang)) % 180, fill=float(fill))
        good = 55 <= rA <= 700 and fill >= 0.66 and o['d'] >= 5
        score = (1 if good else 0, fill * min(1, rA / 90))
        if best is None or score > best[0]:
            best = (score, o)
        if good and rA >= 90:
            break
    return best[1] if best else None


def pixel(x, z):
    c = int((x + HALF) // TILE)
    r = int((z + HALF) // TILE)
    if (r, c) not in _cache:
        p = os.path.join(TILES, str(r), f'{c}.webp')
        _cache[(r, c)] = np.asarray(Image.open(p).convert('RGB')).astype(np.float32) if os.path.exists(p) else None
    t = _cache[(r, c)]
    return None if t is None else t[min(PX - 1, int((z + HALF - r * TILE) / SC)), min(PX - 1, int((x + HALF - c * TILE) / SC))]


def strip(o, side):
    """矩形短边方向上挨着的一条，像不像屋顶的另一半：明暗起伏、绿的比例"""
    r = math.radians(o['rot'])
    c, s = math.cos(r), math.sin(r)
    vals = [pixel(o['x'] + c * u * o['w'] - s * side * v * o['d'], o['z'] + s * u * o['w'] + c * side * v * o['d']) for u in np.linspace(-0.4, 0.4, 13) for v in np.linspace(0.65, 1.35, 7)]
    a = np.array([p for p in vals if p is not None])
    return float(a.mean(1).std()), float(((a[:, 1] > a[:, 0]) & (a[:, 1] > a[:, 2] * 1.1)).mean())


old = [tuple(float(v) for v in m.groups()) for m in re.finditer(r'\[(-?\d+), (-?\d+), (\d+), (\d+), (-?\d+), [\d.]+, [\d.]+\]', open(DONE, encoding='utf-8').read())]
found = []
for part in json.load(open(SEEDS, encoding='utf-8')):
    x0, x1, z0, z1 = part['box']
    a = mosaic(x0, x1, z0, z1)
    sm = ni.gaussian_filter(a, (0.8, 0.8, 0))
    L = sm.mean(2)
    c1 = sm[..., 0] - sm[..., 1]
    c2 = sm[..., 1] - sm[..., 2]
    R = int(part.get('radius', 16) / SC)
    k = part.get('scale', 0.5) / SC
    skip = set(part.get('skip', []))
    for i, (sx, sy) in enumerate(part['seeds']):
        o = None if i in skip else grow(a, L, c1, c2, int(sx * k), int(sy * k), R, x0, z0)
        if o and o['fill'] >= 0.55:
            found.append(o)

out = []
for o in found:
    if o['w'] / max(o['d'], 1) > 2.3 and o['d'] < 11:
        a, b = strip(o, 1), strip(o, -1)
        side = 1 if a[0] + a[1] * 60 < b[0] + b[1] * 60 else -1
        st, gr = a if side == 1 else b
        if st < 34 and gr < 0.3:
            r = math.radians(o['rot'])
            o['x'] -= math.sin(r) * side * o['d'] / 2
            o['z'] += math.cos(r) * side * o['d'] / 2
            o['d'] *= 2
    if any(math.hypot(o['x'] - q[0], o['z'] - q[1]) < (q[2] + q[3]) / 3 + 3 for q in old):
        continue
    if any(math.hypot(o['x'] - q['x'], o['z'] - q['z']) < 6 for q in out):
        continue
    if o['w'] > 60 or o['w'] * o['d'] < 45:
        continue
    out.append(o)
for o in out:
    eave = 5.6 if o['w'] > 24 else 3.4
    ridge = round(min(3, 0.14 * o['d'] + 0.6), 1)
    print(f"  [{round(o['x'])}, {round(o['z'])}, {round(o['w'])}, {round(o['d'])}, {round(o['rot']) if o['rot'] <= 90 else round(o['rot']) - 180}, {eave}, {ridge}],")
