# 树叶图集（照片版，4096×4096，4×4 格，每格 1024）：叶片、针叶来自本机 MOSS-Image 生成的白底小枝照片
# （art/src/ref/leaves/*.png，提示词见 docs/development.md），抠掉白底后在这里拼成叶簇：
#   · 一格是一团叶簇：十几根缩小的小枝随便散在中间、大致朝外，先画的压暗一点（被外面的叶子挡住光）；
#     不围成整齐的一圈：那样每张叶卡都是一朵一样的花，满树重复
#   · 云杉、棕榈的格子是一整根枝（左边枝根、右边枝梢），和 leaf_atlas.py 画的布局一样，trees.py 不用改；
#   · 远景体块、白桦树皮这几格照旧用 leaf_atlas.py 画的（先跑它，这里在它的结果上替换）；
#   · 每格的平均颜色对齐原来那格：各地图调好的树色（treeView.ts 的 leafTint、逐棵颜色）不变。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/leaf_photo_atlas.py art/src/ref/leaves art/out/trees/leaves.png

import math
import os
import random
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'art/src/ref/leaves'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'art/out/trees/leaves.png'
BASE = os.path.join(os.path.dirname(OUT), 'leaves_drawn.png')
N = 4096
C = N // 4


def keyed(name):
    """白底照片 → 带透明通道的小枝（去掉白边：半透明处按白色背景反解出原色），裁到内容的包围盒"""
    im = np.asarray(Image.open(os.path.join(SRC, name + '.png')).convert('RGB')).astype(np.float32)
    d = 255.0 - im.min(axis=2)
    # 离白色多远：浅灰的影子（d < 32）算背景，叶子边缘慢慢过渡（门槛低了叶子外面一圈发亮的晕）
    a = np.clip((d - 32.0) / 48.0, 0.0, 1.0)
    a = a * a * (3 - 2 * a)
    W = 255.0
    k = np.maximum(a, 1e-3)[..., None]
    rgb = np.clip((im - (1 - a[..., None]) * W) / k, 0, 255)
    out = np.dstack([rgb, a * 255.0]).astype(np.uint8)
    ys, xs = np.nonzero(a > 0.05)
    out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return Image.fromarray(out, 'RGBA')


def dim(im, f):
    a = np.asarray(im).astype(np.float32)
    a[..., :3] *= f
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def bare(sp, frac):
    """裁掉小枝靠根的一段光杆（浅色的树皮在叶簇中间聚成一团白），裁口往上渐隐，不留一道硬边"""
    im = sp.crop((0, 0, sp.width, int(sp.height * (1 - frac))))
    a = np.asarray(im).astype(np.float32)
    h = a.shape[0]
    ramp = np.clip((h - 1 - np.arange(h)) / max(1.0, h * 0.1), 0, 1)
    a[..., 3] *= ramp[:, None]
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def cluster(sprigs, n, seed, reach=0.47, inner=0.0, spin=0.0, base_frac=0.92, cut=0.1):
    """一团叶簇：n 根小枝枝根朝中心转一圈（照片里枝根在下面）。reach：枝梢伸到格子半径的几成；cut：裁掉根部几成"""
    rng = random.Random(seed)
    sprigs = [bare(sp, cut) for sp in sprigs]
    cell = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    order = []
    for i in range(n):
        ang = 2 * math.pi * i / n + rng.uniform(-0.25, 0.25) + spin
        order.append((rng.random(), ang, i))
    # 先画里层（压暗、小一点），再画外层
    layers = [(0.78, 0.82, True), (1.0, 1.0, False)]
    for scale_k, bright, under in layers:
        for _, ang, i in sorted(order):
            sp = sprigs[i % len(sprigs)]
            L = C * reach * scale_k * rng.uniform(0.85, 1.05)
            s = L / sp.height
            im = sp.resize((max(2, int(sp.width * s)), max(2, int(sp.height * s))), Image.LANCZOS)
            if under:
                im = dim(im, 0.62)
            elif bright != 1.0:
                im = dim(im, bright)
            # 照片里枝根朝下（+y），转到朝中心：先转，再把枝根放到离中心 inner 的地方
            deg = -math.degrees(ang) - 90 + rng.uniform(-12, 12)
            rot = im.rotate(deg, resample=Image.BICUBIC, expand=True)
            # 枝根在原图底边中间：转过去之后的位置
            bx, by = im.width / 2, im.height * base_frac
            cx, cy = im.width / 2, im.height / 2
            t = math.radians(-deg)
            rx = (bx - cx) * math.cos(t) - (by - cy) * math.sin(t)
            ry = (bx - cx) * math.sin(t) + (by - cy) * math.cos(t)
            px = C / 2 + math.cos(ang) * inner * C - (rot.width / 2 + rx)
            py = C / 2 + math.sin(ang) * inner * C - (rot.height / 2 + ry)
            cell.alpha_composite(rot, (int(px), int(py)))
    return cell


def scatter(sprigs, n, seed, size=(0.28, 0.38), spread=0.21, cut=0.1, toward=0.0):
    """一团叶簇：n 根缩小的小枝，中心随便落在格子中间的一个圆里，朝向随便（不是整整齐齐围一圈：
    那样每张叶卡都是一朵一样的花，满树重复；也不是枝根都朝中心：中间会空出一个洞）。
    先画的压暗一点，算是被后画的（外面的）叶子挡住了光"""
    rng = random.Random(seed)
    sprigs = [bare(sp, cut) for sp in sprigs]
    cell = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    for k in range(n):
        sp = sprigs[k % len(sprigs)]
        r = spread * math.sqrt(rng.random()) * C
        th = rng.uniform(0, 2 * math.pi)
        # toward > 0：枝梢稍微偏向外面
        ang = rng.uniform(0, 360) * (1 - toward) + (-math.degrees(th) - 90) * toward
        L = C * rng.uniform(*size)
        s = L / sp.height
        im = sp.resize((max(2, int(sp.width * s)), max(2, int(sp.height * s))), Image.LANCZOS)
        if rng.random() < 0.5:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im = dim(im, (0.62 + 0.38 * k / max(1, n - 1)) * rng.uniform(0.93, 1.05))
        rot = im.rotate(ang, resample=Image.BICUBIC, expand=True)
        px = C / 2 + math.cos(th) * r - rot.width / 2
        py = C / 2 + math.sin(th) * r - rot.height / 2
        cell.alpha_composite(rot, (int(px), int(py)))
    return cell


def spray(sp, flip=False):
    """一整根枝横着放满一格（左边枝根）"""
    im = sp.transpose(Image.FLIP_LEFT_RIGHT) if flip else sp
    if im.height > im.width:
        im = im.rotate(-90, expand=True)
    s = min(C * 0.98 / im.width, C * 0.9 / im.height)
    im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    cell = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    cell.alpha_composite(im, ((C - im.width) // 2, (C - im.height) // 2))
    return cell


def tame(cell, knee=1.2, keep=0.35):
    """压掉照片里棚灯打出来的反光和发白的叶脉：亮度超过叶面平均 knee 倍的部分只留 keep，颜色往叶面平均色靠。
    游戏里还会再打一次高光，照片自带的反光留着，整片雨林泛银白色，像花叶植物"""
    a = np.asarray(cell).astype(np.float32)
    w = a[..., 3] / 255.0
    rgb = a[..., :3]
    L = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    m = (L * w).sum() / max(1e-3, w.sum())
    mc = (rgb * w[..., None]).sum((0, 1)) / max(1e-3, w.sum())
    top = m * knee
    over = np.maximum(L - top, 0)
    Lnew = np.minimum(L, top) + over * keep
    k = np.where(L > 1e-3, Lnew / np.maximum(L, 1e-3), 1.0)
    rgb = rgb * k[..., None]
    # 压下来的那些地方，颜色也往叶面的平均色靠一点（白叶脉不再是白的）
    t = np.clip(over / np.maximum(m, 1.0), 0, 1)[..., None] * 0.6
    rgb = rgb * (1 - t) + (mc * (Lnew / max(m, 1.0))[..., None]) * t
    a[..., :3] = rgb
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def match(cell, ref):
    """平均颜色对齐原来那一格（按透明度加权）"""
    a = np.asarray(cell).astype(np.float32)
    r = np.asarray(ref).astype(np.float32)
    wa = a[..., 3:4] / 255.0
    wr = r[..., 3:4] / 255.0
    ma = (a[..., :3] * wa).sum((0, 1)) / max(1e-3, wa.sum())
    mr = (r[..., :3] * wr).sum((0, 1)) / max(1e-3, wr.sum())
    gain = np.clip(mr / np.maximum(ma, 1.0), 0.5, 2.0)
    a[..., :3] *= gain
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def main():
    if not os.path.exists(BASE):
        os.replace(OUT, BASE)
    base = Image.open(BASE).convert('RGBA').resize((N, N), Image.LANCZOS)
    atlas = base.copy()
    S = {n: keyed(n) for n in ['broad', 'pine', 'spruce', 'trop', 'birch', 'juniper', 'shrub', 'palm', 'pinyon', 'ujuni', 'scrub']}

    def put(col, row, cell, w=1, shine=True):
        ref = base.crop((col * C, row * C, (col + w) * C, (row + 1) * C))
        clear = Image.new('RGBA', (w * C, C), (0, 0, 0, 0))
        atlas.paste(clear, (col * C, row * C))
        atlas.alpha_composite(match(tame(cell) if shine else cell, ref), (col * C, row * C))

    put(0, 0, scatter([S['broad']], 24, 1, size=(0.3, 0.42), spread=0.27))
    put(1, 0, scatter([S['pine']], 14, 2, size=(0.34, 0.46), spread=0.24, cut=0.3))
    put(2, 0, spray(S['spruce']))
    put(3, 0, scatter([S['trop']], 17, 4, size=(0.34, 0.46), spread=0.25))
    put(0, 1, scatter([S['birch']], 26, 5, size=(0.28, 0.4), spread=0.27))
    put(1, 1, scatter([S['juniper']], 22, 6, size=(0.32, 0.44), spread=0.26))
    put(2, 1, scatter([S['shrub']], 22, 7, size=(0.3, 0.42), spread=0.26, cut=0.2))
    # 棕榈叶占两格宽
    palm = S['palm']
    s = min(2 * C * 0.98 / palm.width, C * 0.92 / palm.height)
    pim = palm.resize((int(palm.width * s), int(palm.height * s)), Image.LANCZOS)
    pc = Image.new('RGBA', (2 * C, C), (0, 0, 0, 0))
    pc.alpha_composite(pim, ((2 * C - pim.width) // 2, (C - pim.height) // 2))
    put(0, 2, pc, 2)
    put(3, 3, scatter([S['pinyon']], 17, 9, size=(0.32, 0.44), spread=0.26))
    put(0, 3, scatter([S['ujuni']], 22, 10, size=(0.3, 0.42), spread=0.26))
    put(1, 3, scatter([S['scrub']], 22, 11, size=(0.3, 0.42), spread=0.26))
    atlas.save(OUT)
    print('WROTE', OUT, atlas.size)


main()
