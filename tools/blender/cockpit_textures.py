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


PAINT = (50, 49, 48)  # 中性深灰略偏暖：舱内主要是天空的蓝光，底色偏冷的话整块仪表板会发蓝


def build_decal():
    import random

    random.seed(7)
    img = Image.new('RGB', (DW, DH), PAINT)
    # 粉末喷涂的细微斑驳
    noise = Image.effect_noise((DW // 16, DH // 16), 18).resize((DW, DH), Image.BICUBIC)
    img = Image.composite(img, Image.new('RGB', (DW, DH), (44, 43, 42)), noise.point(lambda p: 128 + (p - 128) // 2))
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
    # 右侧四个键：字印在键上方；屏幕下方六个键：字直接印在键帽上（键帽用这张贴图）
    for i, s in enumerate(['MAP', 'NAV', 'D>', 'MENU']):
        label(d, G['u'] + 0.054 + (i % 2) * 0.022, G['v'] + 0.006 - (i // 2) * 0.013 + 0.0062, s, 0.0024)
    for i, s in enumerate(['RNG-', 'RNG+', 'PG<', 'PG>', 'ENT', 'CLR']):
        cu, cv = G['u'] - 0.045 + i * 0.018, G['v'] - 0.031
        rect(d, cu, cv, 0.015, 0.009, (34, 34, 37), radius=0.001)
        label(d, cu, cv, s, 0.0023, col=(220, 220, 214))
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
    for tv, s in zip(S['toggles'], S['labels']):
        label(d, S['u'], tv + 0.0155, s, 0.0028, col=(25, 25, 25))
    label(d, S['u'], S['toggles'][2] - 0.0155, 'OFF  SLOW  FAST', 0.0021, col=(25, 25, 25))
    # 左侧设备
    E = L.ELT
    rect(d, E['u'], E['v'], E['w'], E['h'], (20, 20, 22), radius=0.002)
    label(d, E['u'], E['v'] + 0.028, 'ELT', 0.0045, weight='Bold')
    label(d, E['u'] + 0.012, E['v'] + 0.010, 'ON', 0.0025)
    label(d, E['u'] + 0.012, E['v'] - 0.002, 'ARM', 0.0025)
    label(d, E['u'] + 0.012, E['v'] - 0.014, 'OFF', 0.0025)
    R2 = L.RADIO
    rect(d, R2['u'], R2['v'], R2['w'], R2['h'], (21, 21, 23), radius=0.005)
    for i, s in enumerate(['SWAP', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'MON']):
        rect(d, R2['u'] - 0.065 + i * 0.019, R2['v'] - 0.019, 0.013, 0.008, (40, 40, 43), radius=0.002)
        label(d, R2['u'] - 0.065 + i * 0.019, R2['v'] - 0.0115 + 0.0, s, 0.0020, col=(190, 190, 184))
    for i in range(9):  # 散热格栅
        rect(d, R2['u'] + 0.077, R2['v'] + 0.018 - i * 0.0045, 0.050, 0.0022, (8, 8, 9))
    H = L.HELISAFE
    rect(d, H['u'], H['v'], H['w'], H['h'], (30, 31, 33), radius=0.003)
    rect(d, H['u'] - 0.012, H['v'] + 0.006, 0.100, 0.020, (10, 12, 11), radius=0.001)
    label(d, H['u'] + 0.058, H['v'] - 0.010, 'MARK', 0.0024)
    label(d, H['u'] - 0.060, H['v'] + 0.024, 'FLIGHT TRACKER', 0.0024)
    # 音频面板
    A2 = L.AUDIO
    rect(d, A2['u'], A2['v'], A2['w'], A2['h'], (24, 24, 26), radius=0.003)
    label(d, A2['u'] - 0.052, A2['v'] + 0.030, 'AUDIO', 0.0030)
    for i, s in enumerate(A2['labels']):
        cu = A2['u'] - 0.046 + (i % A2['cols']) * 0.0205
        cv = A2['v'] + 0.009 - (i // A2['cols']) * 0.029
        label(d, cu, cv + 0.0115, s, 0.0023, col=(200, 200, 194))
    label(d, A2['u'] + 0.052, A2['v'] - 0.030, 'VOL', 0.0024)
    # 应答机
    X = L.XPDR
    rect(d, X['u'], X['v'], X['w'], X['h'], (23, 23, 25), radius=0.003)
    rect(d, X['u'] - 0.010, X['v'] + 0.004, 0.106, 0.026, (24, 14, 6), radius=0.001)
    label(d, X['u'] - 0.080, X['v'] + 0.019, 'XPDR', 0.0028)
    for i, a in enumerate(('OFF', 'SBY', 'ON', 'ALT')):
        ang = math.radians(-60 + i * 40)
        label(d, X['u'] + 0.076 + 0.0118 * math.sin(ang), X['v'] + 0.004 + 0.0118 * math.cos(ang), a, 0.0018)
    for i, s in enumerate(['IDT', 'VFR', '+', '-', 'CLR']):
        label(d, X['u'] - 0.044 + i * 0.022, X['v'] - 0.0235, s, 0.0021, col=(180, 180, 174))
    # 断路器：每个一个标签和一圈白环
    Cb = L.CB
    for i, s in enumerate(Cb['labels']):
        cu = Cb['u'] - 0.081 + (i % Cb['cols']) * Cb['du']
        cv = Cb['v'] + 0.016 - (i // Cb['cols']) * Cb['dv']
        label(d, cu, cv + 0.012, s, 0.0022, col=(214, 214, 208))
    label(d, Cb['u'], Cb['v'] + 0.043, 'CIRCUIT BREAKERS', 0.0028, col=(190, 190, 184))
    # 翘板开关
    for Ro in (L.ROCKERS, L.ROCKERS2):
        for i, s in enumerate(Ro['labels']):
            label(d, Ro['u'] - Ro['du'] * (Ro['n'] - 1) / 2 + i * Ro['du'], Ro['v'] + 0.0245, s, 0.0026)
    # 发动机主开关的三挡
    Eg = L.ENG_MAIN
    label(d, Eg['u'], Eg['v'] + 0.0385, 'ENG MAIN', 0.0030, weight='Bold')
    for a, s in zip(Eg['angles'], Eg['labels']):
        r = Eg['r'] * 1.72
        label(d, Eg['u'] + r * math.sin(math.radians(a)) * 1.08, Eg['v'] + r * math.cos(math.radians(a)), s, 0.0024)
    # 小时计
    Hb = L.HOBBS
    rect(d, Hb['u'], Hb['v'], Hb['w'], Hb['h'], (10, 10, 11), radius=0.001)
    label(d, Hb['u'], Hb['v'] + 0.021, 'HOURS', 0.0026)
    # 打码机标签（白字黑底的小胶条）：真飞机上到处都是
    for (u, v, s) in [(-0.262, -0.112, 'CLOCK'), (-0.252, -0.238, 'STBY HDG'), (0.182, -0.122, 'IAS'), (0.372, -0.122, 'ALT'), (0.190, -0.327, 'TURN'), (0.378, -0.327, 'VS')]:
        w_ = 0.0052 * len(s) * 0.7 + 0.006
        rect(d, u, v, w_, 0.0075, (8, 8, 9), radius=0.0006)
        label(d, u, v, s, 0.0036, col=(226, 226, 220), weight='Regular')
    pl = L.PLACARD
    rect(d, pl['u'], pl['v'], pl['w'], pl['h'], (236, 236, 232), radius=0.001)
    for i, s in enumerate(pl['lines']):
        label(d, pl['u'], pl['v'] + pl['h'] / 2 - 0.009 - i * 0.0095, s, 0.0036, col=(25, 25, 25), weight='Regular')
    for (u, v, s, h, a) in L.LABELS:
        label(d, u, v, s, h, a)
    # 电子姿态仪下方的同步钮文字、仪表名小字
    img = img.resize((DW // 2, DH // 2), Image.LANCZOS)
    img.save(os.path.join(OUT, 'panel_decal.png'))


def build_placards():
    """舱内标牌图集（4 × 4 格，每格 2:1）：红底白字警示、黑底白字插孔牌、白底黑字说明牌、罗盘校正卡。"""
    CW, CH = 1024, 512  # 每格绘制尺寸（输出时缩小一半）
    img = Image.new('RGB', (CW * 4, CH * 4), (40, 40, 40))
    d = ImageDraw.Draw(img)

    def cell(name):
        c, r = L.PLACARDS[name]
        return c * CW, r * CH

    def plate(name, bg, fg, lines, border=None, size=110):
        x, y = cell(name)
        d.rounded_rectangle([x + 8, y + 8, x + CW - 8, y + CH - 8], radius=36, fill=bg)
        if border:
            d.rounded_rectangle([x + 30, y + 30, x + CW - 30, y + CH - 30], radius=24, outline=border, width=10)
        n = len(lines)
        for i, (t, sz) in enumerate(lines):
            f = font(sz or size, 'Bold')
            d.text((x + CW / 2, y + CH / 2 + (i - (n - 1) / 2) * (sz or size) * 1.25), t, font=f, fill=fg, anchor='mm')

    plate('roof_warn', (196, 30, 26), (250, 250, 245), [('CAUTION', 120), ('DO NOT LEAN', 90), ('ON ROOF WINDOW', 90)], border=(250, 250, 245))
    plate('pilot', (16, 16, 18), (236, 236, 230), [('PILOT', 170)], border=(236, 236, 230))
    plate('copilot', (16, 16, 18), (236, 236, 230), [('COPILOT', 150)], border=(236, 236, 230))
    plate('no_smoking', (236, 236, 232), (20, 20, 20), [('NO SMOKING', 120), ('FASTEN SEAT BELTS', 90)])
    plate('exit', (196, 30, 26), (250, 250, 245), [('EMERGENCY EXIT', 110), ('PULL HANDLE', 90)])
    plate('fire_ext', (196, 30, 26), (250, 250, 245), [('FIRE', 150), ('EXTINGUISHER', 110)])
    plate('door_open', (20, 20, 22), (242, 196, 40), [('OPEN       ', 170)])
    x, y = cell('door_open')
    d.polygon([(x + 860, y + 196), (x + 960, y + 256), (x + 860, y + 316)], fill=(242, 196, 40))  # 箭头（字体里没有箭头符号）
    d.rectangle([x + 790, y + 236, x + 870, y + 276], fill=(242, 196, 40))
    plate('floor_load', (236, 236, 232), (20, 20, 20), [('MAX FLOOR LOAD', 100), ('600 kg/m²', 110)])
    plate('belts', (236, 236, 232), (20, 20, 20), [('SEAT BELT', 110), ('MUST BE FASTENED', 90)])
    plate('headset', (16, 16, 18), (236, 236, 230), [('HEADSET', 150)])
    plate('caution_rotor', (242, 196, 40), (20, 20, 20), [('WATCH', 120), ('ROTOR BLADES', 110)], border=(20, 20, 20))
    # 磁罗盘的刻度带（窗口里看到的一段）：黑底白字，每 10° 一条刻度，每 30° 一个数字
    x, y = cell('compass_drum')
    d.rectangle([x, y, x + CW, y + CH], fill=(14, 14, 15))
    for k in range(-16, 17):
        px = x + CW / 2 + k * 32
        d.line([px, y + 150, px, y + (250 if k % 3 == 0 else 205)], fill=(236, 236, 228), width=7 if k % 3 == 0 else 4)
    for k, t in ((-9, '33'), (-6, 'N'), (-3, '3'), (0, '6'), (3, 'E'), (6, '12'), (9, '15'), (12, 'S')):
        d.text((x + CW / 2 + k * 32 * 1.0, y + 340), t, font=font(120, 'Bold'), fill=(236, 236, 228), anchor='mm')
    # 急救包标志：绿底白十字
    x, y = cell('first_aid')
    d.rounded_rectangle([x + 8, y + 8, x + CW - 8, y + CH - 8], radius=36, fill=(34, 104, 72))
    d.rectangle([x + 150, y + 200, x + 330, y + 312], fill=(245, 245, 240))
    d.rectangle([x + 184, y + 166, x + 296, y + 346], fill=(245, 245, 240))
    d.text((x + 660, y + CH / 2), 'FIRST AID', font=font(110, 'Bold'), fill=(245, 245, 240), anchor='mm')
    # 罗盘校正卡：两行表格
    x, y = cell('compass_card')
    d.rectangle([x + 8, y + 8, x + CW - 8, y + CH - 8], fill=(238, 236, 228))
    f = font(58, 'SemiBold')
    heads = ['FOR', 'N', '30', '60', 'E', '120', '150']
    vals = ['STEER', '358', '28', '57', '88', '121', '152']
    heads2 = ['FOR', 'S', '210', '240', 'W', '300', '330']
    vals2 = ['STEER', '182', '213', '242', '271', '298', '331']
    for row, items in enumerate((heads, vals, heads2, vals2)):
        for i, t in enumerate(items):
            d.text((x + 95 + i * 128 + (40 if i else 0), y + 70 + row * 110), t, font=f, fill=(20, 20, 20), anchor="mm")
    for row in range(1, 4):
        d.line([x + 20, y + 15 + row * 110, x + CW - 20, y + 15 + row * 110], fill=(20, 20, 20), width=4)
    img = img.resize((CW * 2, CH * 2), Image.LANCZOS)
    img.save(os.path.join(OUT, 'placards.png'))


def build_pedestal():
    """中央操纵台四块面板上的字：竖着排在一张图里，每块的比例和实物一样"""
    W = 2048
    plates = L.PED_PLATES
    hs = [int(W * h / w) for _, w, h in plates]
    img = Image.new('RGB', (W, sum(hs)), (24, 24, 26))
    d = ImageDraw.Draw(img)
    y0 = 0
    for (name, w, h), H in zip(plates, hs):
        k = W / w

        def put(x, y, s, size, col=(214, 214, 208)):
            d.text((W / 2 + x * k, y0 + H / 2 - y * k), s, font=font(int(size * k * 1.35), 'SemiBold'), fill=col, anchor='mm')

        d.rectangle([0, y0, W, y0 + H - 1], outline=(60, 60, 62), width=3)
        if name == 'audio':
            for i, s in enumerate(L.PED_AUDIO):
                put(-0.066 + (i % 7) * 0.019, 0.012 - (i // 7) * 0.020 + 0.0072, s, 0.0026)
            put(0.075, 0.0125, 'VOL', 0.0026)
        elif name == 'toggles':
            for i, s in enumerate(L.PED_TOGGLES):
                put(-0.084 + i * 0.024, 0.0165, s, 0.0028)
                put(-0.084 + i * 0.024, -0.0165, 'OFF', 0.0022, (150, 150, 146))
        elif name == 'knobs':
            for i, s in enumerate(L.PED_KNOBS):
                put(-0.08 + i * 0.04, 0.0205, s, 0.0030)
                for a in range(7):
                    ang = math.radians(-130 + a * 260 / 6)
                    r0, r1 = 0.0135, 0.0155
                    cx, cy = W / 2 + (-0.08 + i * 0.04) * k, y0 + H / 2
                    d.line([cx + r0 * k * math.sin(ang), cy - r0 * k * math.cos(ang), cx + r1 * k * math.sin(ang), cy - r1 * k * math.cos(ang)], fill=(214, 214, 208), width=4)
        else:
            for i, s in enumerate(L.PED_TESTS):
                put(-0.07 + i * 0.07, 0.0175, s, 0.0030)
        y0 += H
    img = img.resize((1024, img.height // 2), Image.LANCZOS)
    img.save(os.path.join(OUT, 'pedestal.png'))


if __name__ == '__main__':
    build_atlas()
    build_decal()
    build_placards()
    build_pedestal()
    print('ok', OUT)
