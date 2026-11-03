# 树叶图集（带透明通道，2048×2048，4×4 格，每格 512）：用 PIL 程序绘制叶簇，供 Blender 树模型的叶片卡使用。
#   第 0 行：阔叶、松针（黑松针叶团）、云杉枝、热带大叶
#   第 1 行：白桦叶、刺柏、灌木、远景树冠体块（不透明）
#   第 2 行：棕榈叶（占两格宽）、白桦树皮（第 2 格）、（空）
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
    """下垂的云杉枝：中间一根枝条，两侧鱼骨状的针叶小枝。"""
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for row in range(3):
        y0 = S * (0.2 + 0.3 * row)
        d.line([(S * 0.05, y0), (S * 0.95, y0 + S * 0.04)], fill=(70, 50, 34, 255), width=9)
        for i in range(22):
            x = S * (0.07 + 0.86 * i / 22) + rnd.uniform(-8, 8)
            yy = y0 + S * 0.04 * i / 22
            L = S * 0.12 * (1 - 0.55 * i / 22) + S * 0.03
            for sgn in (-1, 1):
                ang = sgn * rnd.uniform(0.9, 1.25)
                ex, ey = x + math.cos(ang) * L * 0.6, yy + math.sin(ang) * L
                d.line([(x, yy), (ex, ey)], fill=(70, 50, 34, 255), width=4)
                # 小枝上密集、方向随机的短针叶
                for j in range(60):
                    t = rnd.random()
                    px, py = x + (ex - x) * t, yy + (ey - yy) * t
                    b = rnd.uniform(0, 2 * math.pi)
                    nl = rnd.uniform(10, 22)
                    col = jitter(shade(rnd.choice(greens), 0.65 + 0.5 * rnd.random()), 0.12)
                    d.line([(px, py), (px + math.cos(b) * nl, py + math.sin(b) * nl)], fill=col + (255,), width=5)
    return im


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
GREEN = [(70, 112, 48), (88, 128, 56), (60, 98, 42), (98, 136, 62)]
PINE = [(46, 78, 44), (56, 90, 50), (40, 68, 40)]
SPRUCE = [(36, 64, 44), (44, 74, 50), (30, 56, 38)]
TROP = [(48, 104, 40), (62, 122, 46), (40, 88, 34), (74, 132, 54)]
BIRCH = [(118, 150, 66), (132, 162, 74), (104, 138, 58)]
JUNI = [(84, 104, 74), (96, 116, 82), (74, 92, 66)]
SHRUB = [(84, 108, 60), (100, 120, 66), (72, 96, 54)]
atlas.paste(cluster('broad', GREEN, 120, (0.07, 0.12), 0.55), (0, 0))
atlas.paste(needles(PINE, 70, 0.1, 1.0), (S, 0))
atlas.paste(spruce_branch(SPRUCE), (S * 2, 0))
atlas.paste(cluster('tropical', TROP, 46, (0.16, 0.26), 0.42), (S * 3, 0))
atlas.paste(cluster('birch', BIRCH, 150, (0.045, 0.07), 0.7), (0, S))
atlas.paste(needles(JUNI, 90, 0.055, 1.0), (S, S))
atlas.paste(cluster('shrub', SHRUB, 140, (0.05, 0.09), 0.6), (S * 2, S))
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
