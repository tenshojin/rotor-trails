# 树叶图集（带透明通道，2048×2048，4×4 格，每格 512）：用 PIL 程序绘制叶簇，供 Blender 树模型的叶片卡使用。
#   第 0 行：阔叶、松针（黑松针叶团）、云杉枝、热带大叶
#   第 1 行：白桦叶、刺柏、灌木、远景树冠体块（不透明）
#   第 2 行：棕榈叶（占两格宽）、白桦树皮（第 2 格）、矮松
#   第 3 行：犹他刺柏、干旱区的矮灌丛、南缘树冠体块（不透明）、（空）
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/leaf_atlas.py art/out/trees

import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'art/out/trees'
os.makedirs(OUT, exist_ok=True)
S = 1024  # 绘制尺寸（输出时缩小一半）
rnd = random.Random(7)


def jitter(c, k=0.12):
    f = 1 + (rnd.random() - 0.5) * 2 * k
    return tuple(max(0, min(255, int(v * f))) for v in c)


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)


def leaf_poly(cx, cy, length, width, ang, tip=0.0):
    """卵形叶片的多边形（叶柄在 (cx,cy)，朝 ang 方向长出）。"""
    pts = []
    n = 14
    for i in range(n + 1):
        t = i / n
        w = width * math.sin(math.pi * t) ** 0.8 * (1 - tip * t)
        pts.append((t * length, w / 2))
    for i in range(n, -1, -1):
        t = i / n
        w = width * math.sin(math.pi * t) ** 0.8 * (1 - tip * t)
        pts.append((t * length, -w / 2))
    ca, sa = math.cos(ang), math.sin(ang)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]


def cluster(kind, greens, n, size_rng, width_k, twig=(70, 52, 34)):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    # 细枝
    for _ in range(9):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.18, 0.42) * S
        d.line([(c, c), (c + math.cos(a) * r, c + math.sin(a) * r)], fill=twig + (255,), width=6)
    # 叶片：先画暗的（簇内部），后画亮的（表层）
    leaves = []
    for _ in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        r = (rnd.random() ** 0.6) * S * 0.42
        x, y = c + math.cos(a) * r, c + math.sin(a) * r
        L = rnd.uniform(*size_rng) * S
        leaves.append((r, x, y, L, a + rnd.uniform(-0.9, 0.9)))
    leaves.sort(key=lambda v: -v[0])  # 外圈先画
    for i, (r, x, y, L, ang) in enumerate(leaves):
        base = rnd.choice(greens)
        k = 0.62 + 0.5 * (i / len(leaves))
        col = jitter(shade(base, k), 0.1)
        poly = leaf_poly(x, y, L, L * width_k, ang, 0.2 if kind == 'tropical' else 0.0)
        d.polygon(poly, fill=col + (255,))
        # 叶脉
        ca, sa = math.cos(ang), math.sin(ang)
        if L > S * 0.06:
            d.line([(x, y), (x + ca * L * 0.9, y + sa * L * 0.9)], fill=shade(col, 0.75) + (255,), width=3)
    return im


def needles(greens, tufts, length, spread):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    for _ in range(6):
        a = rnd.uniform(0, 2 * math.pi)
        d.line([(c, c), (c + math.cos(a) * S * 0.38, c + math.sin(a) * S * 0.38)], fill=(66, 48, 32, 255), width=10)
    for t in range(tufts):
        a = rnd.uniform(0, 2 * math.pi)
        r = (rnd.random() ** 0.5) * S * 0.4
        x, y = c + math.cos(a) * r, c + math.sin(a) * r
        k = 0.6 + 0.6 * t / tufts
        for _ in range(28):
            b = rnd.uniform(0, 2 * math.pi)
            L = length * S * rnd.uniform(0.6, 1.0)
            col = jitter(shade(rnd.choice(greens), k), 0.1)
            d.line([(x, y), (x + math.cos(b) * L, y + math.sin(b) * L * spread)], fill=col + (255,), width=4)
    return im


def spruce_branch(greens):
    """一根完整的云杉枝：从左边的枝根长到右边的枝梢。
    轮廓是羽毛状的三角形：主枝两侧一级小枝，小枝上再分二级，针叶贴着小枝朝前长，枝梢是嫩绿色。
    不能画成实心的长方形：树冠的轮廓全靠这些缺口。"""
    W = S * 2
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    wood = (58, 42, 30, 255)
    y0 = W * 0.5

    def needle_line(x0, y_0, x1, y1, density, ln, tip_k):
        """沿一根小枝画针叶：朝枝梢方向斜着长，靠近枝梢颜色变浅"""
        dx, dy = x1 - x0, y1 - y_0
        L = math.hypot(dx, dy) or 1
        ux, uy = dx / L, dy / L
        n = int(L * density)
        for k in range(n):
            t = k / max(1, n - 1)
            px, py = x0 + dx * t, y_0 + dy * t
            for sgn in (-1, 1):
                a = sgn * rnd.uniform(0.45, 0.95)
                ca, sa = math.cos(a), math.sin(a)
                vx, vy = ux * ca - uy * sa, ux * sa + uy * ca
                nl = ln * rnd.uniform(0.75, 1.2)
                # 老针叶深，枝梢的新针叶浅一些、偏黄
                g = rnd.choice(greens)
                f = 0.5 + 0.55 * rnd.random() + tip_k * t * 0.9
                col = shade(g, f)
                if tip_k > 0 and t > 0.7:
                    col = (min(255, int(col[0] * 1.4)), min(255, int(col[1] * 1.22)), col[2])
                d.line([(px, py), (px + vx * nl, py + vy * nl)], fill=col + (255,), width=3)

    # 主枝微微弯曲
    pts = [(W * (0.02 + 0.94 * t), y0 + math.sin(t * 2.2) * W * 0.012) for t in [i / 24 for i in range(25)]]
    for a, c in zip(pts, pts[1:]):
        d.line([a, c], fill=wood, width=11)
    n1 = 25
    for i in range(n1):
        t = (i + 0.3) / n1
        bx, by = pts[int(t * 24)]
        # 三角形的外包络：枝根宽，枝梢窄，再加一点随机
        L = W * 0.40 * (1 - t) ** 0.72 * rnd.uniform(0.72, 1.08) + W * 0.02
        for sgn in (-1, 1):
            ang = sgn * rnd.uniform(0.62, 1.05)
            cx, cy = bx + math.cos(ang) * L, by + math.sin(ang) * L
            d.line([(bx, by), (cx, cy)], fill=wood, width=6)
            needle_line(bx, by, cx, cy, 0.24, W * 0.016, 0.0)
            # 二级小枝
            m = max(2, int(L / (W * 0.038)))
            for k in range(1, m):
                s = k / m
                sx, sy = bx + (cx - bx) * s, by + (cy - by) * s
                l2 = L * 0.34 * (1 - s) ** 0.6 * rnd.uniform(0.7, 1.15) + W * 0.012
                for s2 in (-1, 1):
                    a2 = ang + s2 * rnd.uniform(0.55, 0.95)
                    ex, ey = sx + math.cos(a2) * l2, sy + math.sin(a2) * l2
                    d.line([(sx, sy), (ex, ey)], fill=wood, width=3)
                    needle_line(sx, sy, ex, ey, 0.30, W * 0.0125, 1.0)
    return im.resize((S, S), Image.LANCZOS)


def palm_frond(greens):
    im = Image.new('RGBA', (S * 2, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y0 = S * 0.5
    d.line([(0, y0), (S * 2, y0)], fill=(120, 110, 70, 255), width=12)
    for i in range(70):
        x = S * 2 * (0.04 + 0.94 * i / 70)
        L = S * 0.46 * math.sin(math.pi * (0.1 + 0.9 * i / 70)) ** 0.7
        for sgn in (-1, 1):
            col = jitter(shade(rnd.choice(greens), 0.75 + 0.35 * rnd.random()), 0.1)
            poly = leaf_poly(x, y0, L, 22, sgn * math.radians(62) + math.radians(8), 0.6)
            d.polygon(poly, fill=col + (255,))
    return im


def birch_bark():
    im = Image.new('RGBA', (S, S), (226, 222, 210, 255))
    d = ImageDraw.Draw(im)
    for _ in range(140):
        x = rnd.uniform(0, S)
        y = rnd.uniform(0, S)
        w = rnd.uniform(20, 120)
        h = rnd.uniform(4, 14)
        d.ellipse([x, y, x + w, y + h], fill=(40, 36, 32, 255))
    for _ in range(400):
        x = rnd.uniform(0, S)
        y = rnd.uniform(0, S)
        d.line([(x, y), (x + rnd.uniform(10, 60), y)], fill=(180, 174, 160, 255), width=2)
    return im.filter(ImageFilter.GaussianBlur(1.2))


atlas = Image.new('RGBA', (S * 4, S * 4), (0, 0, 0, 0))
GREEN = [(62, 94, 44), (76, 108, 50), (52, 82, 38), (88, 116, 56), (70, 96, 40)]
PINE = [(46, 78, 44), (56, 90, 50), (40, 68, 40)]
SPRUCE = [(36, 64, 44), (44, 74, 50), (30, 56, 38)]
TROP = [(46, 92, 40), (58, 106, 44), (38, 78, 34), (70, 116, 50), (52, 92, 34)]
BIRCH = [(108, 134, 62), (122, 146, 70), (94, 122, 54)]
JUNI = [(84, 104, 74), (96, 116, 82), (74, 92, 66)]
SHRUB = [(84, 108, 60), (100, 120, 66), (72, 96, 54)]
# 叶子要小而多：一张卡两米多宽，叶子画大了近看就是一把绿色的纸片
atlas.paste(cluster('broad', GREEN, 620, (0.026, 0.05), 0.55), (0, 0))
atlas.paste(needles(PINE, 70, 0.1, 1.0), (S, 0))
atlas.paste(spruce_branch(SPRUCE), (S * 2, 0))
atlas.paste(cluster('tropical', TROP, 170, (0.07, 0.13), 0.42), (S * 3, 0))
atlas.paste(cluster('birch', BIRCH, 560, (0.02, 0.036), 0.7), (0, S))
atlas.paste(needles(JUNI, 90, 0.055, 1.0), (S, S))
atlas.paste(cluster('shrub', SHRUB, 520, (0.022, 0.042), 0.6), (S * 2, S))
atlas.paste(palm_frond(TROP), (0, S * 2))
atlas.paste(birch_bark(), (S * 2, S * 2))


def foliage_mass():
    """远景树冠体块（不透明）：大量小叶片铺满，供最远一级细节的简化树冠使用。"""
    im = Image.new('RGBA', (S, S), (52, 82, 40, 255))
    d = ImageDraw.Draw(im)
    for i in range(1400):
        x, y = rnd.uniform(0, S), rnd.uniform(0, S)
        L = rnd.uniform(18, 46)
        col = jitter(shade(rnd.choice(GREEN), 0.55 + 0.6 * rnd.random()), 0.1)
        d.polygon(leaf_poly(x, y, L, L * 0.55, rnd.uniform(0, 2 * math.pi)), fill=col + (255,))
    return im


atlas.paste(foliage_mass(), (S * 3, S))


def pinyon_tufts(greens):
    """矮松：针叶又短又硬，一撮一撮挤在小枝头上，撮和撮之间露着枝和缝"""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    tips = []
    for _ in range(9):
        a = rnd.uniform(0, 2 * math.pi)
        x, y = c, c
        for k in range(5):
            a += rnd.uniform(-0.5, 0.5)
            L = rnd.uniform(0.05, 0.1) * S
            nx, ny = x + math.cos(a) * L, y + math.sin(a) * L
            d.line([(x, y), (nx, ny)], fill=(58, 44, 34, 255), width=max(3, 12 - k * 2))
            x, y = nx, ny
            tips.append((x, y))
            if rnd.random() < 0.5:
                b = a + rnd.choice((-1, 1)) * rnd.uniform(0.5, 1.0)
                tips.append((x + math.cos(b) * L * 0.8, y + math.sin(b) * L * 0.8))
    rnd.shuffle(tips)
    for t, (x, y) in enumerate(tips):
        k = 0.55 + 0.75 * t / len(tips)
        for _ in range(46):
            b = rnd.uniform(0, 2 * math.pi)
            L = 0.052 * S * rnd.uniform(0.5, 1.0)
            col = jitter(shade(rnd.choice(greens), k), 0.1)
            d.line([(x, y), (x + math.cos(b) * L, y + math.sin(b) * L)], fill=col + (255,), width=3)
    return im


def juniper_sprays(greens):
    """犹他刺柏：鳞叶贴着小枝长，一根根像细绳，再分成小叉，缠成一团蓬松的灰绿色。偶尔有几颗蓝灰色的果子"""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2

    def spray(x, y, a, L, w, depth, k):
        n = rnd.randint(3, 5)
        for _ in range(n):
            a += rnd.uniform(-0.32, 0.32)
            nx, ny = x + math.cos(a) * L, y + math.sin(a) * L
            col = jitter(shade(rnd.choice(greens), k), 0.1)
            d.line([(x, y), (nx, ny)], fill=col + (255,), width=int(w))
            x, y = nx, ny
            if depth > 0 and rnd.random() < 0.8:
                spray(x, y, a + rnd.choice((-1, 1)) * rnd.uniform(0.45, 0.95), L * 0.72, max(3, w * 0.8), depth - 1, k * rnd.uniform(0.92, 1.1))

    for i in range(34):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.random() ** 0.6 * S * 0.34
        spray(c + math.cos(a) * r, c + math.sin(a) * r, a + rnd.uniform(-0.7, 0.7), S * 0.04, 8, 3, 0.62 + 0.6 * i / 34)
    for _ in range(26):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.random() ** 0.5 * S * 0.4
        x, y = c + math.cos(a) * r, c + math.sin(a) * r
        q = rnd.uniform(5, 8)
        d.ellipse([x - q, y - q, x + q, y + q], fill=(106, 118, 132, 255))
    return im


def scrub_twigs(greens):
    """峡谷里的黑灌木：一蓬细硬的枝，发灰发黑，叶子小得几乎看不见"""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2

    def twig(x, y, a, L, w, depth):
        for _ in range(3):
            a += rnd.uniform(-0.45, 0.45)
            nx, ny = x + math.cos(a) * L, y + math.sin(a) * L
            d.line([(x, y), (nx, ny)], fill=jitter((46, 40, 34), 0.15) + (255,), width=int(w))
            x, y = nx, ny
            if depth > 0:
                twig(x, y, a + rnd.choice((-1, 1)) * rnd.uniform(0.4, 1.1), L * 0.68, max(2, w * 0.7), depth - 1)
            else:
                for _ in range(5):
                    b = rnd.uniform(0, 2 * math.pi)
                    q = rnd.uniform(4, 10)
                    d.ellipse([x + math.cos(b) * q - 5, y + math.sin(b) * q - 4, x + math.cos(b) * q + 5, y + math.sin(b) * q + 4], fill=jitter(rnd.choice(greens), 0.14) + (255,))

    for _ in range(16):
        twig(c, c, rnd.uniform(0, 2 * math.pi), S * 0.07, 9, 3)
    return im


def rim_mass():
    """南缘树冠体块（不透明）：灰绿的树冠，比别的地图的树冠暗、灰、斑驳"""
    im = Image.new('RGBA', (S, S), (60, 72, 54, 255))
    d = ImageDraw.Draw(im)
    for _ in range(2600):
        x, y = rnd.uniform(0, S), rnd.uniform(0, S)
        L = rnd.uniform(16, 42)
        col = jitter(shade(rnd.choice(RIMG), 0.5 + 0.7 * rnd.random()), 0.1)
        d.polygon(leaf_poly(x, y, L, L * 0.5, rnd.uniform(0, 2 * math.pi)), fill=col + (255,))
    return im


PINY = [(50, 64, 46), (60, 72, 50), (42, 56, 42), (66, 76, 50)]
UJUN = [(82, 92, 68), (92, 100, 74), (72, 82, 62), (98, 104, 76)]
SCRB = [(76, 84, 58), (92, 96, 66), (64, 72, 52)]
RIMG = [(84, 98, 72), (98, 110, 80), (70, 86, 66), (60, 78, 58)]
atlas.paste(pinyon_tufts(PINY), (S * 3, S * 2))
atlas.paste(juniper_sprays(UJUN), (0, S * 3))
atlas.paste(scrub_twigs(SCRB), (S, S * 3))
atlas.paste(rim_mass(), (S * 2, S * 3))
atlas = atlas.resize((2048, 2048), Image.LANCZOS)


def bleed(im):
    """透明区域填上附近叶片的颜色（透明度仍为 0）：游戏里缩小采样（mipmap）时叶片边缘不会混进黑色而发暗。"""
    import numpy as np
    from scipy.ndimage import gaussian_filter
    arr = np.asarray(im).astype(np.float32) / 255.0
    al = arr[..., 3]
    rgb = arr[..., :3]
    fill = np.broadcast_to((rgb * al[..., None]).sum((0, 1)) / max(al.sum(), 1e-6), rgb.shape).copy()
    for r in (64, 16, 4):
        pa = gaussian_filter(al, r)
        pm = np.stack([gaussian_filter(rgb[..., c] * al, r) for c in range(3)], -1)
        ok = pa > 0.02
        fill[ok] = pm[ok] / pa[ok][..., None]
    out = np.where(al[..., None] > 0, rgb, fill)
    return Image.fromarray(np.clip(np.concatenate([out, al[..., None]], -1) * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')


atlas = bleed(atlas)
atlas.save(os.path.join(OUT, 'leaves.png'))
print('ok', OUT)
