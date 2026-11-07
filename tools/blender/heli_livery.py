# RT-7 涂装贴图：不走 UV，机身坐标直接投影（src/render/heliLivery.ts 按位置取色），所以分色线和网格的面没有关系，
# 贴多近都是一条光滑的线。这里画的都是“人站在飞机旁边看到的样子”：左舷机头朝左，右舷机头朝右，文字不会反。
#
#   heli_livery.webp    4096 x 3200，400 像素一米：第 0 块左舷、第 1 块右舷（各 1200 行）、第 2 块俯视（800 行）
#   heli_livery_h.webp  2048 x 1600：R 高度（0.5 平、接缝低、铆钉高）、G 粗糙度
#
# 运行：python tools/blender/heli_livery.py public/models <Inter 字体的路径>
# 字体用 Blender 自带的 Inter（SIL OFL，文字烧进贴图，贴图不带字体文件）。

import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/models'
FONT = sys.argv[2] if len(sys.argv) > 2 else r'D:\steam\steamapps\common\Blender\5.2\datafiles\fonts\Inter.woff2'

PPM = 400
Y0, Y1 = 2.56, -7.68
ZT, ZB = 1.88, -1.12
W, H, HT = 4096, 1200, 800
SS = 2

WHITE = np.array([0.85, 0.85, 0.835])
NAVY = np.array([0.075, 0.13, 0.23])
RED = np.array([0.66, 0.135, 0.105])
GOLD = np.array([0.74, 0.58, 0.28])
INK = np.array([0.10, 0.12, 0.17])


def font(size, weight=800):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_axes([32 if size > 60 else 14, weight])
    return f


def catmull(pts, n=24):
    """折线上每段插 n 个点：控制点之间走圆滑的曲线。"""
    p = [np.array(q, float) for q in pts]
    p = [p[0] * 2 - p[1]] + p + [p[-1] * 2 - p[-2]]
    out = []
    for i in range(1, len(p) - 2):
        for t in np.linspace(0, 1, n, endpoint=False):
            a, b, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
            out.append(0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3))
    out.append(p[-2])
    return np.array(out)


def lookup(pts):
    """y → 值的查找表（控制点的 y 从大到小）。"""
    c = catmull(pts, 32)
    y, v = c[::-1, 0], c[::-1, 1]
    return lambda q: np.interp(q, y, v)


def rrect(y0, z0, y1, z1, r):
    """圆角矩形的轮廓。"""
    pts = []
    for cy, cz, a0 in ((y1 - r, z1 - r, 0), (y0 + r, z1 - r, 90), (y0 + r, z0 + r, 180), (y1 - r, z0 + r, 270)):
        for a in np.radians(np.arange(a0, a0 + 91, 15)):
            pts.append((cy + r * np.cos(a), cz + r * np.sin(a)))
    pts.append(pts[0])
    return pts


# ---------------------------------------------------------------- 分色线（侧视，Y 从机头到尾）
belly_top = lookup([(2.6, -0.34), (2.0, -0.40), (1.2, -0.47), (0.2, -0.50), (-0.9, -0.48), (-1.7, -0.33), (-2.3, -0.06), (-2.85, 0.31), (-3.4, 0.40), (-5.0, 0.515), (-7.1, 0.665)])
red_th = lookup([(2.6, 0.02), (2.0, 0.05), (1.2, 0.085), (0.0, 0.10), (-1.0, 0.12), (-1.9, 0.15), (-2.6, 0.12), (-3.4, 0.085), (-5.0, 0.06), (-6.6, 0.03), (-7.05, 0.0)])
GAP = 0.024


def boom_axis(y):
    k = (y + 2.85) / (-7.05 + 2.85)
    return 0.27 + (0.15 - 0.27) * k, 0.55 + (0.78 - 0.55) * k


FIN_UP = [(-6.60, 0.94), (-6.645, 1.0), (-7.16, 1.80), (-7.54, 1.80), (-7.30, 0.94)]
FIN_LO = [(-6.55, 0.625), (-7.30, 0.625), (-7.30, 0.0), (-6.95, 0.0)]


def seam_lines():
    """两侧都有的接缝：(折线, 宽度倍数)"""
    L = []
    # 舱门：门框外一圈
    L.append((rrect(0.25, -0.42, 1.44, 0.87, 0.09), 1.2))
    L.append((rrect(-1.09, -0.42, 0.03, 0.85, 0.09), 1.2))
    # 机腹蒙皮的接缝、机头罩
    L.append(([(1.46, -0.60), (0.3, -0.64), (-1.2, -0.62), (-1.9, -0.47), (-2.4, -0.20)], 1))
    L.append((catmull([(2.20, 0.0), (2.16, -0.3), (2.10, -0.76)], 12).tolist(), 1))
    L.append((rrect(1.68, -0.58, 2.05, -0.40, 0.03), 0.8))
    # 后机身的框和行李舱门
    L.append(([(-1.20, 0.84), (-1.20, -0.86)], 1))
    L.append(([(-2.32, 0.86), (-2.32, -0.20)], 1))
    L.append((rrect(-2.20, -0.26, -1.34, 0.50, 0.07), 1.2))
    L.append(([(-1.20, 0.60), (-2.32, 0.60)], 0.8))
    # 整流罩：根部的折线、前后分块、检修门
    L.append(([(0.72, 0.93), (-1.30, 0.905), (-1.5, 0.815), (-2.1, 0.835), (-2.85, 0.82)], 1.1))
    L.append((catmull([(0.42, 0.95), (0.30, 1.14), (0.10, 1.30), (-0.05, 1.44)], 10).tolist(), 1))
    L.append((rrect(-1.28, 0.93, -0.22, 1.40, 0.05), 1.1))
    L.append((rrect(-2.26, 0.86, -1.36, 1.32, 0.05), 1.1))
    # 尾梁的蒙皮接口
    for y in (-3.0, -3.7, -4.4, -5.1, -5.8, -6.5):
        r, c = boom_axis(y)
        L.append(([(y, c - r), (y, c + r)], 1))
    r0, c0 = boom_axis(-3.0)
    r1, c1 = boom_axis(-7.0)
    L.append(([(-3.0, c0 + r0 * 0.55), (-7.0, c1 + r1 * 0.55)], 0.7))
    # 尾梁末端的检修盖
    r, c = boom_axis(-6.1)
    L.append((rrect(-6.32, c - 0.07, -5.92, c + 0.07, 0.02), 0.8))
    # 垂尾：前缘条、方向舵一样的后段
    L.append(([(-6.78, 0.98), (-7.27, 1.78)], 0.8))
    L.append(([(-7.14, 0.98), (-7.42, 1.78)], 0.8))
    return L


def rivet_rows():
    """铆钉：(起点, 终点, 间距)"""
    R = []
    for y in (-3.0, -3.7, -4.4, -5.1, -5.8, -6.5):
        r, c = boom_axis(y)
        for d in (-0.018, 0.018):
            R.append(((y + d, c - r), (y + d, c + r), 0.032))
    for k in (0.75, 0.3, -0.25):
        r0, c0 = boom_axis(-3.0)
        r1, c1 = boom_axis(-6.5)
        R.append(((-3.0, c0 + r0 * k), (-6.5, c1 + r1 * k), 0.05))
    for y, z0, z1 in ((-1.20, -0.84, 0.82), (-2.32, -0.18, 0.84)):
        for d in (-0.02, 0.02):
            R.append(((y + d, z0), (y + d, z1), 0.05))
    R.append(((1.40, -0.625), (-1.2, -0.645), 0.06))
    R.append(((-1.2, 0.62), (-2.3, 0.62), 0.06))
    R.append(((-1.25, 0.955), (-0.25, 0.955), 0.05))
    R.append(((-2.2, 0.885), (-1.40, 0.885), 0.05))
    R.append(((1.1, 0.965), (-1.0, 0.965), 0.07))
    return R


# ---------------------------------------------------------------- 工具
class Plane:
    """一块画布：世界坐标（Y, Z 或 X）到像素。"""

    def __init__(self, side):
        self.side = side
        self.h = HT if side == 'T' else H

    def px(self, y, v):
        u = (Y0 - y) * PPM
        if self.side == 'R':
            u = W - u
        row = (1.0 - v) * PPM if self.side == 'T' else (ZT - v) * PPM
        return u * SS, row * SS

    def mask(self):
        return Image.new('L', (W * SS, self.h * SS), 0)

    def arr(self, m):
        return np.asarray(m.resize((W, self.h), Image.LANCZOS), dtype=np.float32) / 255.0

    def poly(self, pts):
        m = self.mask()
        ImageDraw.Draw(m).polygon([self.px(*p) for p in pts], fill=255)
        return self.arr(m)

    def lines(self, lines, width):
        m = self.mask()
        d = ImageDraw.Draw(m)
        for pts, k in lines:
            d.line([self.px(*p) for p in pts], fill=255, width=max(1, round(width * k * SS)), joint='curve')
        return self.arr(m)

    def rivets(self, rows, radius):
        m = self.mask()
        d = ImageDraw.Draw(m)
        r = radius * SS
        for a, b, step in rows:
            a, b = np.array(a), np.array(b)
            n = max(2, int(np.linalg.norm(b - a) / step))
            for t in np.linspace(0, 1, n):
                x, y = self.px(*(a + (b - a) * t))
                d.ellipse((x - r, y - r, x + r, y + r), fill=255)
        return self.arr(m)

    def text(self, s, y, z, size, weight=800, rise=0.0, shear=0.0, anchor='mm'):
        """rise：文字基线朝机尾抬高的角度（度），两舷自动反过来。"""
        f = font(size * SS, weight)
        box = f.getbbox(s)
        tw, th = box[2] - box[0], box[3] - box[1]
        pad = int(th * 0.6)
        t = Image.new('L', (tw + pad * 2, th + pad * 2), 0)
        ImageDraw.Draw(t).text((pad - box[0], pad - box[1]), s, font=f, fill=255)
        if shear:
            t = t.transform(t.size, Image.AFFINE, (1, shear, -shear * t.size[1] / 2, 0, 1, 0), Image.BICUBIC)
        a = rise if self.side != 'R' else -rise
        if a:
            t = t.rotate(a, Image.BICUBIC, expand=True)
        m = self.mask()
        x, yy = self.px(y, z)
        m.paste(t, (int(x - t.size[0] / 2), int(yy - t.size[1] / 2)))
        return self.arr(m)

    def trail(self, a, keep=0.992):
        """顺着气流往后拖一条尾巴。"""
        out = a.copy()
        cols = range(1, W) if self.side != 'R' else range(W - 2, -1, -1)
        step = -1 if self.side != 'R' else 1
        for i in cols:
            np.maximum(out[:, i], out[:, i + step] * keep, out=out[:, i])
        return out


def noise(rng, h, w, sx, sy):
    """各向异性的噪声，均值 0.5 左右。"""
    n = rng.random((max(2, int(h / sy) + 2), max(2, int(w / sx) + 2)), dtype=np.float32)
    im = Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def fbm(rng, h, w, base):
    acc = np.zeros((h, w), np.float32)
    amp, tot, s = 1.0, 0.0, base
    for _ in range(5):
        acc += noise(rng, h, w, s, s) * amp
        tot += amp
        amp *= 0.55
        s = max(2, s / 2)
    return acc / tot


def mix(c, col, k):
    return c * (1 - k[..., None]) + np.asarray(col, np.float32) * k[..., None]


def blur(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255.0


def shift(a, dx, dy):
    return np.roll(np.roll(a, dy, 0), dx, 1)


def compose(side, rng):
    P = Plane(side)
    h = P.h
    yy = Y0 - (np.arange(W, dtype=np.float32) + 0.5) / PPM
    if side == 'R':
        yy = yy[::-1]
    zz = ZT - (np.arange(h, dtype=np.float32) + 0.5) / PPM
    Y = np.broadcast_to(yy[None, :], (h, W))
    Z = np.broadcast_to(zz[:, None], (h, W))
    c = np.empty((h, W, 3), np.float32)
    c[:] = WHITE
    rough = np.full((h, W), 0.30, np.float32)
    height = np.full((h, W), 0.5, np.float32)
    bt = belly_top(yy)[None, :]
    th = red_th(yy)[None, :]

    # 分色：边缘按一个像素做反走样
    e = 1.0 / PPM

    def above(line):
        return np.clip((Z - line) / e + 0.5, 0, 1)

    navy = 1 - above(bt)
    red = above(bt + GAP) * (1 - above(bt + GAP + th)) * (th > 0.001)
    g0 = bt + GAP + th + 0.018
    gold = above(g0) * (1 - above(g0 + 0.013)) * (Y > -6.3)
    # 垂尾上下和尾橇段不属于腹部
    lower_fin = P.poly(FIN_LO)
    navy = navy * (1 - lower_fin)
    c = mix(c, NAVY, navy)
    c = mix(c, RED, red)
    c = mix(c, GOLD, gold)
    rough += navy * 0.05
    fin = P.poly(FIN_UP)
    c = mix(c, RED, fin)
    c = mix(c, RED, lower_fin * (Z < 0.2))
    c = mix(c, np.array([0.8, 0.8, 0.78]), lower_fin * ((Z >= 0.2) & (Z < 0.26)))

    # 尾梁末端的警示段
    br, bc = boom_axis(Y)
    tip = (Y < -6.62) & (Y > -7.02) & (Z > bt) & (Z < bc + br + 0.02)
    stripe = (np.floor((Y * 7 + Z * 7)) % 2) == 0
    c = mix(c, RED, (tip & stripe).astype(np.float32) * (1 - fin))

    # 字
    c = mix(c, NAVY, P.text('ROTOR TRAILS', -4.15, 0.655, 62, 800, rise=3.1, shear=0.2))
    c = mix(c, INK, P.text('RT-701', -1.78, 0.30, 84, 700))
    c = mix(c, WHITE * 1.02, P.text('RT-7', -7.25, 1.42, 62, 800, shear=0.15) * fin)
    c = mix(c, RED, P.text('EXIT', 0.46, 0.13, 20, 700))
    c = mix(c, RED, P.text('EXIT', -0.90, 0.19, 20, 700))
    c = mix(c, INK, P.text('NO STEP', -2.62, 0.48, 15, 600))
    c = mix(c, RED, P.text('KEEP CLEAR', -6.15, 0.86, 16, 700, rise=3.1))
    c = mix(c, INK, P.text('BAGGAGE 80 KG MAX', -1.77, 0.08, 14, 600))
    if side == 'R':
        c = mix(c, INK, P.text('JET A-1', -1.55, -0.08 + 0.15, 15, 700))

    # 接缝：里面暗，一边亮一条（漆在边上的倒角）；周围一圈脏
    seams = P.lines(seam_lines(), 2.0)
    riv = P.rivets(rivet_rows(), 1.5)
    if side != 'T':
        c *= (1 - seams * 0.62)[..., None]
        c += (shift(seams, 1, 1) * (1 - seams) * 0.05)[..., None]
        c *= (1 - blur(seams, 3.0) * 0.16)[..., None]
        c *= (1 - riv * 0.20)[..., None]
        c += (shift(riv, 1, 1) * (1 - riv) * 0.035)[..., None]
        height -= seams * 0.42
        height += riv * 0.28
        rough += seams * 0.25

    # 旧漆：大块的色差、细灰
    mott = fbm(rng, h, W, 300) - 0.5
    c *= (1 + mott * 0.05)[..., None]
    c[..., 2] *= 1 - np.clip(fbm(rng, h, W, 512) - 0.45, 0, 1) * 0.04
    dust = noise(rng, h, W, 2, 2)
    c *= (1 + (dust - 0.5) * 0.012)[..., None]

    # 脏东西顺着气流往后拖：每条缝、每颗铆钉后面都有一道淡淡的印子
    flow = noise(rng, h, W, 260, 18)
    src = np.clip(seams + riv * 0.5, 0, 1)
    tr = P.trail(blur(src, 1.0), 0.9945)
    streak = tr * np.clip(flow * 2.6 - 1.25, 0, 1)
    c *= (1 - streak * 0.05)[..., None]
    rough += streak * 0.05
    # 雨水顺着窗角往下流
    rain = noise(rng, h, W, 11, 260)
    wet = np.clip(rain * 4 - 2.75, 0, 1) * np.clip((0.82 - Z) / 0.5, 0, 1) * np.clip((Z + 0.5) / 0.5, 0, 1) * (Y > -2.3)
    c *= (1 - wet * 0.03)[..., None]

    # 机腹：土和油。越低越脏，深色上更明显
    low = np.clip((-0.45 - Z) / 0.5, 0, 1) * (Y > -2.6)
    grime = fbm(rng, h, W, 160) * low * navy
    c += (grime * 0.09)[..., None] * np.array([0.9, 0.82, 0.7], np.float32)
    rough += grime * 0.3

    # 踏板和门槛的磕碰
    scuff = P.mask()
    d = ImageDraw.Draw(scuff)
    for _ in range(90):
        y0 = rng.uniform(0.3, 1.4)
        z0 = rng.uniform(-0.56, -0.40)
        l = rng.uniform(0.01, 0.06)
        a = rng.uniform(-0.5, 0.5)
        d.line([P.px(y0, z0), P.px(y0 + l, z0 + l * a)], fill=int(rng.uniform(70, 200)), width=2)
    sc = P.arr(scuff)
    c = mix(c, [0.62, 0.62, 0.60], sc * 0.5)

    # 排气：右舷尾梁根上一片烟黑；两边的整流罩后缘都有一点油迹
    if side == 'R':
        along = np.clip((-2.7 - Y) / 3.2, 0, 1)
        r, cz = boom_axis(Y)
        spot = np.exp(-(((Z - (cz + r * 0.6 + 0.02)) / (0.10 + along * 0.09)) ** 2)) * (1 - along) ** 1.4 * np.clip((-2.5 - Y) / 0.5, 0, 1)
        soot = spot * (0.58 + 0.42 * fbm(rng, h, W, 120))
        c *= (1 - soot * 0.6)[..., None]
        c = mix(c, [0.25, 0.22, 0.2], soot * 0.12)
        rough += soot * 0.3
    oil = np.exp(-(((Z - (0.80 - (-2.3 - Y) * 0.22)) / 0.05) ** 2)) * np.clip((-2.3 - Y) / 0.3, 0, 1) * np.clip((-3.5 - Y) / -0.9, 0, 1)
    oil *= np.clip(noise(rng, h, W, 200, 3) * 2.4 - 1.0, 0, 1)
    c = mix(c, [0.2, 0.17, 0.13], oil * 0.35)
    return np.clip(c, 0, 1), np.clip(height, 0, 1), np.clip(rough, 0.12, 0.95)


def compose_top(rng):
    P = Plane('T')
    h = HT
    c = np.empty((h, W, 3), np.float32)
    c[:] = WHITE
    rough = np.full((h, W), 0.30, np.float32)
    height = np.full((h, W), 0.5, np.float32)
    # 舱顶、整流罩顶、尾梁顶的接缝
    L = [([(1.20, 0.0), (0.72, 0.0)], 1), ([(0.42, -0.42), (0.42, 0.42)], 1), ([(-1.36, -0.60), (-1.36, 0.60)], 1), ([(-2.26, -0.50), (-2.26, 0.50)], 1),
         ([(-0.22, -0.60), (-0.22, 0.60)], 1), ([(0.42, 0.0), (-3.0, 0.0)], 0.9), ([(0.15, 0.25), (-2.9, 0.25)], 0.7), ([(0.15, -0.25), (-2.9, -0.25)], 0.7)]
    for y in (-3.0, -3.7, -4.4, -5.1, -5.8, -6.5):
        r, _ = boom_axis(y)
        L.append(([(y, -r), (y, r)], 1))
    seams = P.lines(L, 2.0)
    rows = [((0.4, 0.27), (-2.8, 0.27), 0.06), ((0.4, -0.27), (-2.8, -0.27), 0.06)]
    for y in (-3.0, -3.7, -4.4, -5.1, -5.8, -6.5):
        r, _ = boom_axis(y)
        for d in (-0.018, 0.018):
            rows.append(((y + d, -r), (y + d, r), 0.032))
    riv = P.rivets(rows, 1.5)
    c *= (1 - seams * 0.62)[..., None]
    c *= (1 - blur(seams, 3.0) * 0.16)[..., None]
    c *= (1 - riv * 0.2)[..., None]
    c = mix(c, INK, P.text('NO STEP', -1.8, 0.34, 18, 700))
    c = mix(c, INK, P.text('NO STEP', -1.8, -0.34, 18, 700))
    height -= seams * 0.42
    height += riv * 0.28
    rough += seams * 0.25
    c *= (1 + (fbm(rng, h, W, 300) - 0.5) * 0.05)[..., None]
    # 顶上受的灰比侧面多，发动机后面还有烟
    c *= (1 - fbm(rng, h, W, 80) * 0.05)[..., None]
    yy = Y0 - (np.arange(W, dtype=np.float32) + 0.5) / PPM
    xx = 1.0 - (np.arange(h, dtype=np.float32) + 0.5) / PPM
    Y = np.broadcast_to(yy[None, :], (h, W))
    X = np.broadcast_to(xx[:, None], (h, W))
    along = np.clip((-2.7 - Y) / 3.2, 0, 1)
    soot = np.exp(-(((X - 0.14) / (0.14 + along * 0.1)) ** 2)) * (1 - along) ** 1.4 * np.clip((-2.5 - Y) / 0.5, 0, 1)
    c *= (1 - soot * 0.5)[..., None]
    rough += soot * 0.3
    return np.clip(c, 0, 1), np.clip(height, 0, 1), np.clip(rough, 0.12, 0.95)


def main():
    rng = np.random.default_rng(7)
    parts = [compose('L', rng), compose('R', rng), compose_top(rng)]
    col = np.concatenate([p[0] for p in parts], 0)
    hgt = np.concatenate([p[1] for p in parts], 0)
    rgh = np.concatenate([p[2] for p in parts], 0)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray((col * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, 'heli_livery.webp'), quality=90, method=6)
    half = lambda a: Image.fromarray((a * 255 + 0.5).astype(np.uint8)).resize((W // 2, (H * 2 + HT) // 2), Image.BOX)
    r, g = half(hgt), half(rgh)
    Image.merge('RGB', (r, g, Image.new('L', r.size, 0))).save(os.path.join(OUT, 'heli_livery_h.webp'), quality=92, method=6)
    print('ok', col.shape)


main()
