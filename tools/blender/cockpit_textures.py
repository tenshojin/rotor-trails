# 驾驶舱贴图（PIL）：仪表盘面图集 + 仪表板正面印刷图（文字、标牌、各设备面板颜色）。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/cockpit_textures.py art/out/cockpit_tex
# 全部图案在 2 倍分辨率下绘制再缩小，边缘平滑。

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
import cockpit_layout as L  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'art/out/cockpit_tex'
os.makedirs(OUT, exist_ok=True)
FONTS = 'C:/Windows/Fonts/'


def font(size, weight='Bold', narrow=False):
    if narrow:
        return ImageFont.truetype(FONTS + ('ARIALNB.TTF' if weight == 'Bold' else 'ARIALN.TTF'), size)
    f = ImageFont.truetype(FONTS + 'bahnschrift.ttf', size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


WHITE = (236, 236, 230)
GREEN = (40, 178, 72)
YELLOW = (242, 196, 40)
RED = (226, 52, 40)
FACE = (14, 14, 15)

# ---------------------------------------------------------------- 仪表盘面图集
SLOT = 1024  # 绘制尺寸（输出 512）
SLOTS = ['asi', 'alt', 'vsi', 'turn', 'card', 'overlay', 'nr', 'clock']


def new_face(alpha=False):
    img = Image.new('RGBA', (SLOT, SLOT), (0, 0, 0, 0) if alpha else FACE + (255,))
    if not alpha:
        # 轻微径向渐变（表盘中心略亮）
        g = Image.radial_gradient('L').resize((SLOT, SLOT))
        shade = Image.new('RGBA', (SLOT, SLOT), (40, 40, 42, 255))
        img = Image.composite(img, shade, g.point(lambda p: min(255, 120 + p)))
    return img, ImageDraw.Draw(img)


C = SLOT / 2
R = SLOT * 0.49  # 表盘可见半径


def polar(r, ang_deg):
    """角度：0 = 12 点，顺时针"""
    a = math.radians(ang_deg)
    return (C + r * math.sin(a), C - r * math.cos(a))


def tick(d, ang, r0, r1, w, col=WHITE):
    d.line([polar(r0, ang), polar(r1, ang)], fill=col, width=int(w))


def arc(d, r, w, a0, a1, col):
    # PIL 的 arc 角度：0 = 3 点、顺时针
    box = [C - r, C - r, C + r, C + r]
    d.arc(box, a0 - 90, a1 - 90, fill=col, width=int(w))


def text(d, xy, s, f, col=WHITE, anchor='mm'):
    d.text(xy, s, font=f, fill=col, anchor=anchor)


def face_asi():
    img, d = new_face()
    # 0–180 kt 映射到 0°–320°，40 kt 以下压缩
    def ang(kt):
        return kt / 180 * 320 if kt <= 40 else 40 / 180 * 320 + (kt - 40) / 140 * (320 - 40 / 180 * 320) * 1.0

    arc(d, R * 0.90, R * 0.07, ang(20), ang(130), GREEN)
    arc(d, R * 0.90, R * 0.07, ang(130), ang(150), YELLOW)
    tick(d, ang(150), R * 0.80, R * 0.98, R * 0.035, RED)
    for kt in range(0, 181, 5):
        major = kt % 20 == 0
        tick(d, ang(kt), R * (0.80 if major else 0.87), R * 0.98, R * (0.025 if major else 0.014))
    f = font(int(R * 0.15), narrow=True)
    for kt in (0, 40, 60, 80, 100, 120, 140, 160):
        text(d, polar(R * 0.62, ang(kt)), str(kt), f)
    text(d, (C, C - R * 0.30), 'AIRSPEED', font(int(R * 0.10)))
    text(d, (C, C + R * 0.30), 'KNOTS', font(int(R * 0.10)))
    return img


def face_alt():
    img, d = new_face()
    for i in range(50):
        major = i % 5 == 0
        tick(d, i * 7.2, R * (0.80 if major else 0.88), R * 0.98, R * (0.028 if major else 0.014))
    f = font(int(R * 0.20), narrow=True)
    for n in range(10):
        text(d, polar(R * 0.64, n * 36), str(n), f)
    text(d, (C - R * 0.16, C - R * 0.30), 'ALT', font(int(R * 0.11)))
    text(d, (C + R * 0.06, C + R * 0.28), '100 FEET', font(int(R * 0.07)))
    # 气压窗
    d.rectangle([C + R * 0.30, C - R * 0.08, C + R * 0.62, C + R * 0.08], fill=(0, 0, 0), outline=(90, 90, 90), width=4)
    text(d, (C + R * 0.46, C), '1013', font(int(R * 0.11), narrow=True))
    # 低空斜纹标记
    for k in range(5):
        x = C - R * 0.62 + k * R * 0.05
        d.line([(x, C + R * 0.22), (x + R * 0.04, C + R * 0.12)], fill=WHITE, width=5)
    return img


def face_vsi():
    img, d = new_face()
    # 0 在 9 点钟；上升向上（顺时针），±2000 ft/min 各 170°
    def ang(v):
        # 零点附近刻度放大（非线性），与游戏里的指针换算一致
        k = min(1.0, abs(v) / 2000) ** 0.85
        return -90 + math.copysign(170 * k, v)

    for v in range(-2000, 2001, 100):
        major = v % 500 == 0
        tick(d, ang(v), R * (0.80 if major else 0.88), R * 0.98, R * (0.028 if major else 0.014))
    f = font(int(R * 0.17), narrow=True)
    for v in (0, 500, 1000, 1500, 2000):
        text(d, polar(R * 0.64, ang(v)), str(v // 100) if v else '0', f)
        if v:
            text(d, polar(R * 0.64, ang(-v)), str(v // 100), f)
    text(d, (C + R * 0.30, C - R * 0.24), 'UP', font(int(R * 0.09)))
    text(d, (C + R * 0.30, C + R * 0.24), 'DN', font(int(R * 0.09)))
    text(d, (C + R * 0.05, C - R * 0.04), 'VERTICAL SPEED', font(int(R * 0.075)))
    text(d, (C + R * 0.05, C + R * 0.08), '100 FEET PER MINUTE', font(int(R * 0.06)))
    return img


def face_turn():
    img, d = new_face()
    # 标准转弯率标记（左右各 20°）+ 中央竖线
    for a in (-20, 0, 20):
        tick(d, a, R * 0.62, R * 0.92, R * (0.05 if a else 0.03))
    text(d, polar(R * 0.70, -45), 'L', font(int(R * 0.18)))
    text(d, polar(R * 0.70, 45), 'R', font(int(R * 0.18)))
    text(d, (C, C + R * 0.66), '2 MIN TURN', font(int(R * 0.08)))
    # 侧滑球管（下半部弧形玻璃管）
    pts = []
    for i in range(41):
        a = -32 + i * 64 / 40
        pts.append(polar(R * 0.42, 180 + a))
    d.line(pts, fill=(170, 160, 120), width=int(R * 0.17), joint='curve')
    d.line(pts, fill=(28, 26, 22), width=int(R * 0.13), joint='curve')
    for a in (-6, 6):
        tick(d, 180 + a, R * 0.33, R * 0.52, 5, (30, 30, 30))
    return img


def face_card():
    """航向刻度盘（随航向旋转）"""
    img, d = new_face()
    for deg in range(0, 360, 5):
        major = deg % 10 == 0
        tick(d, deg, R * (0.80 if major else 0.87), R * 0.97, R * (0.022 if major else 0.012))
    f = font(int(R * 0.15), narrow=True)
    names = {0: 'N', 90: 'E', 180: 'S', 270: 'W'}
    for deg in range(0, 360, 30):
        s = names.get(deg, str(deg // 10))
        # 数字朝向圆心（随刻度盘旋转）
        lay = Image.new('RGBA', (int(R * 0.4), int(R * 0.3)), (0, 0, 0, 0))
        ImageDraw.Draw(lay).text((lay.width / 2, lay.height / 2), s, font=f, fill=WHITE if deg % 90 else (250, 210, 60), anchor='mm')
        lay = lay.rotate(-deg, resample=Image.BICUBIC, expand=True)
        x, y = polar(R * 0.62, deg)
        img.alpha_composite(lay, (int(x - lay.width / 2), int(y - lay.height / 2)))
    return img


def face_overlay():
    """航向仪固定层：机头符号、航向基准线、45° 标记（透明背景）"""
    img, d = new_face(alpha=True)
    for a in (0, 45, 90, 135, 180, 225, 270, 315):
        x0, y0 = polar(R * 0.99, a)
        x1, y1 = polar(R * (0.86 if a else 0.80), a)
        d.line([(x0, y0), (x1, y1)], fill=(250, 140, 40, 255) if a == 0 else WHITE + (255,), width=10 if a == 0 else 6)
    # 飞机符号
    w = R * 0.05
    d.polygon([(C, C - R * 0.42), (C + w, C - R * 0.30), (C + w, C - R * 0.08), (C + R * 0.36, C + R * 0.05), (C + R * 0.36, C + R * 0.13),
               (C + w, C + R * 0.06), (C + w, C + R * 0.30), (C + R * 0.13, C + R * 0.38), (C + R * 0.13, C + R * 0.44), (C, C + R * 0.40),
               (C - R * 0.13, C + R * 0.44), (C - R * 0.13, C + R * 0.38), (C - w, C + R * 0.30), (C - w, C + R * 0.06),
               (C - R * 0.36, C + R * 0.13), (C - R * 0.36, C + R * 0.05), (C - w, C - R * 0.08), (C - w, C - R * 0.30)],
              fill=(245, 245, 240, 255))
    return img


def face_nr():
    img, d = new_face()
    # 250–450 rpm 映射到 -150°–150°；绿区 360–410，红线 420
    def ang(rpm):
        return -150 + (rpm - 250) / 200 * 300

    arc(d, R * 0.90, R * 0.08, ang(360), ang(410), GREEN)
    tick(d, ang(420), R * 0.78, R * 0.98, R * 0.04, RED)
    tick(d, ang(320), R * 0.78, R * 0.98, R * 0.04, RED)
    for rpm in range(250, 451, 10):
        major = rpm % 50 == 0
        tick(d, ang(rpm), R * (0.80 if major else 0.88), R * 0.98, R * (0.03 if major else 0.016))
    f = font(int(R * 0.17), narrow=True)
    for rpm in (250, 300, 350, 400, 450):
        text(d, polar(R * 0.60, ang(rpm)), str(rpm), f)
    text(d, (C, C + R * 0.42), 'NR', font(int(R * 0.12)))
    text(d, (C, C + R * 0.60), 'RPM', font(int(R * 0.08)))
    return img


def face_clock():
    img, d = new_face()
    for m in range(60):
        major = m % 5 == 0
        tick(d, m * 6, R * (0.82 if major else 0.90), R * 0.98, R * (0.035 if major else 0.016))
    f = font(int(R * 0.20), narrow=True)
    for h in range(1, 13):
        text(d, polar(R * 0.66, h * 30), str(h), f)
    return img


def build_atlas():
    faces = dict(asi=face_asi(), alt=face_alt(), vsi=face_vsi(), turn=face_turn(), card=face_card(), overlay=face_overlay(), nr=face_nr(), clock=face_clock())
    atlas = Image.new('RGBA', (SLOT * 4, SLOT * 2), (0, 0, 0, 255))
    for i, k in enumerate(SLOTS):
        f = faces[k]
        if k != 'overlay':
            # 圆形外的部分涂成表盘黑（避免 UV 边缘采到透明）
            m = Image.new('L', (SLOT, SLOT), 0)
            ImageDraw.Draw(m).ellipse([C - R, C - R, C + R, C + R], fill=255)
            bg = Image.new('RGBA', (SLOT, SLOT), FACE + (255,))
            f = Image.composite(f, bg, m)
        atlas.paste(f, ((i % 4) * SLOT, (i // 4) * SLOT))
    atlas = atlas.resize((2048, 1024), Image.LANCZOS)
    atlas.save(os.path.join(OUT, 'gauges.png'))


# ---------------------------------------------------------------- 仪表板正面印刷图
DW, DH = 8192, 4096  # 绘制尺寸（输出 4096×2048）
U0, U1 = -L.PANEL_HALF_W, L.PANEL_HALF_W
V0, V1 = -0.52, 0.0
PPM = DW / (U1 - U0)  # 每米像素


def P(u, v):
    return ((u - U0) * PPM, (V1 - v) * PPM)


def rect(d, u, v, w, h, fill, outline=None, width=0, radius=0.0):
    x0, y0 = P(u - w / 2, v + h / 2)
    x1, y1 = P(u + w / 2, v - h / 2)
    d.rounded_rectangle([x0, y0, x1, y1], radius=radius * PPM, fill=fill, outline=outline, width=int(width * PPM) if width else 0)


def label(d, u, v, s, h, align='c', col=WHITE, weight='SemiBold'):
    f = font(int(h * PPM * 1.35), weight)
    d.text(P(u, v), s, font=f, fill=col, anchor={'c': 'mm', 'l': 'lm', 'r': 'rm'}[align])


PAINT = (43, 45, 49)


def build_decal():
    import random

    random.seed(7)
    img = Image.new('RGB', (DW, DH), PAINT)
    # 粉末喷涂的细微斑驳
    noise = Image.effect_noise((DW // 16, DH // 16), 18).resize((DW, DH), Image.BICUBIC)
    img = Image.composite(img, Image.new('RGB', (DW, DH), (37, 39, 42)), noise.point(lambda p: 128 + (p - 128) // 2))
    d = ImageDraw.Draw(img)
    # 分区接缝
    for u in (-0.112, 0.106):
        d.line([P(u, -0.02), P(u, L.PANEL_BOTTOM)], fill=(24, 25, 27), width=int(0.0012 * PPM))
    d.line([P(-0.112, -0.335), P(-0.52, -0.335)], fill=(24, 25, 27), width=int(0.0012 * PPM))

    # 仪表方形外框（黑色安装框）
    for g in L.GAUGES:
        s = g['d'] + 0.008
        rect(d, g['u'], g['v'], s, s, (18, 18, 19), radius=0.006)
    # 电子姿态仪框
    rect(d, L.AI['u'], L.AI['v'], L.AI['frame_w'], L.AI['frame_h'], (20, 20, 21), radius=0.004)
    # VEMD 前面板与按键文字
    V = L.VEMD
    rect(d, V['u'], V['v'], V['w'], V['h'], (22, 22, 24), radius=0.004)
    n = len(V['keys'])
    for i, k in enumerate(V['keys']):
        kv = V['v'] + V['h'] / 2 - 0.030 - i * (V['h'] - 0.05) / (n - 1)
        rect(d, V['keys_u'], kv, 0.030, 0.016, (34, 34, 37), radius=0.002)
        label(d, V['keys_u'], kv, k, 0.0036, col=(220, 220, 214))
    # GPS 前面板
    G = L.GPS
    rect(d, G['u'], G['v'], G['w'], G['h'], (24, 24, 26), radius=0.004)
    gl = ['COM', 'VLOC', 'CDI', 'OBS', 'MSG', 'FPL', 'PROC']
    for i, s in enumerate(gl):
        label(d, G['u'] + 0.054 + (i % 2) * 0.022, G['v'] + 0.022 - (i // 2) * 0.013, s, 0.0028)
    label(d, G['u'] - 0.060, G['v'] + 0.030, 'GPS', 0.0034)
    label(d, G['u'] + 0.002, G['v'] + 0.033, 'VFR ONLY', 0.0026)
    # 照明旋钮刻度
    for k in L.KNOBS:
        for i in range(7):
            a = math.radians(-130 + i * 260 / 6)
            r0, r1 = 0.0115, 0.0135
            d.line([P(k['u'] + r0 * math.sin(a), k['v'] + r0 * math.cos(a)), P(k['u'] + r1 * math.sin(a), k['v'] + r1 * math.cos(a))], fill=WHITE, width=int(0.0007 * PPM))
    # 告警灯板底（黑）
    A = L.ANNUNCIATOR
    rect(d, A['u'], A['v'], A['w'] + 0.006, A['h'] + 0.006, (12, 12, 13), radius=0.002)
    # 机号牌
    R_ = L.REG_PLATE
    rect(d, R_['u'], R_['v'], R_['w'], R_['h'], (16, 16, 17), outline=(120, 120, 120), width=0.0006, radius=0.002)
    label(d, R_['u'], R_['v'], R_['text'], 0.0062, weight='Bold')
    # EMER SW 底座（黑色圆形护盖）
    E = L.EMER_SW
    x0, y0 = P(E['u'] - 0.018, E['v'] + 0.026)
    x1, y1 = P(E['u'] + 0.018, E['v'] - 0.026)
    d.rounded_rectangle([x0, y0, x1, y1], radius=0.016 * PPM, fill=(16, 16, 17))
    # 右缘开关条（浅灰金属板）
    S = L.SWITCH_STRIP
    rect(d, S['u'], S['v'], S['w'], S['h'], (178, 178, 172), radius=0.003)
    for tv, s in zip(S['toggles'], ['NAV', 'STROBE', 'LDG']):
        label(d, S['u'], tv + 0.016, s, 0.0028, col=(25, 25, 25))
    # 左侧设备
    E = L.ELT
    rect(d, E['u'], E['v'], E['w'], E['h'], (20, 20, 22), radius=0.002)
    label(d, E['u'], E['v'] + 0.028, 'ELT', 0.0045, weight='Bold')
    label(d, E['u'] + 0.012, E['v'] + 0.006, 'ON', 0.0025)
    label(d, E['u'] + 0.012, E['v'] - 0.010, 'ARM', 0.0025)
    R2 = L.RADIO
    rect(d, R2['u'], R2['v'], R2['w'], R2['h'], (21, 21, 23), radius=0.005)
    rect(d, R2['u'] - 0.010, R2['v'] + 0.008, 0.080, 0.028, (150, 160, 150), radius=0.002)
    label(d, R2['u'] - 0.010, R2['v'] + 0.012, 'CH 03  122.800', 0.0042, col=(30, 36, 30), weight='Regular')
    label(d, R2['u'] - 0.010, R2['v'] + 0.001, 'SQL 3    PWR H', 0.0030, col=(30, 36, 30), weight='Regular')
    for i in range(7):
        rect(d, R2['u'] - 0.065 + i * 0.019, R2['v'] - 0.019, 0.013, 0.008, (40, 40, 43), radius=0.002)
    for i in range(9):  # 散热格栅
        rect(d, R2['u'] + 0.077, R2['v'] + 0.018 - i * 0.0045, 0.050, 0.0022, (8, 8, 9))
    H = L.HELISAFE
    rect(d, H['u'], H['v'], H['w'], H['h'], (30, 31, 33), radius=0.003)
    rect(d, H['u'] - 0.012, H['v'] + 0.006, 0.100, 0.020, (70, 200, 110), radius=0.001)
    label(d, H['u'] - 0.012, H['v'] + 0.006, 'TRACKING   GPS 3D', 0.0040, col=(20, 70, 35), weight='Regular')
    label(d, H['u'] - 0.060, H['v'] + 0.024, 'FLIGHT TRACKER', 0.0024)
    pl = L.PLACARD
    rect(d, pl['u'], pl['v'], pl['w'], pl['h'], (236, 236, 232), radius=0.001)
    for i, s in enumerate(pl['lines']):
        label(d, pl['u'], pl['v'] + pl['h'] / 2 - 0.009 - i * 0.0095, s, 0.0036, col=(25, 25, 25), weight='Regular')
    for (u, v, s, h, a) in L.LABELS:
        label(d, u, v, s, h, a)
    # 电子姿态仪下方的同步钮文字、仪表名小字
    img = img.resize((DW // 2, DH // 2), Image.LANCZOS)
    img.save(os.path.join(OUT, 'panel_decal.png'))


if __name__ == '__main__':
    build_atlas()
    build_decal()
    print('ok', OUT)
