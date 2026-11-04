# 美国西南峡谷地图的建筑模型（参照：陶斯印第安村落的土坯房、西部铁路木水塔、多叶片抽水风车等常见样式）。
# 运行：blender -b --factory-startup --python tools/blender/props_canyon.py -- public/models/props_canyon.glb [--preview 目录]
# 尺寸与 src/world/props/canyon.ts 的碰撞体一致（土坯房按游戏里的宽/长缩放）。

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import bldkit as BK  # noqa: E402
import common_props as CP  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/models/props_canyon.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
M = BK.mat
F = BK.flat
GLASS = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
STEEL = F('steel_galv', 0x9aa0a6, rough=0.45, metal=0.8)
DARKSTEEL = F('steel_dark', 0x2c2d2f, rough=0.5, metal=0.6)
WHITE = F('paint_white', 0xeeeeea, rough=0.5)
CHILE = F('chile_red', 0xa81c14, rough=0.5)
DOORS = {'turquoise': F('door_turq', 0x2a8a8a, rough=0.5), 'blue': F('door_blue', 0x2a5aa0, rough=0.5), 'green': F('door_green', 0x3a6a3a, rough=0.5)}
ROOTS = []


def parapet(parts, W, D, z, h, m, t=0.35):
    """平屋顶四周的女儿墙（土坯，边角圆润，高度略有起伏）。"""
    for i, (sz, c) in enumerate((((W, t, h), (0, -D / 2 + t / 2, z + h / 2)), ((W, t, h + 0.08), (0, D / 2 - t / 2, z + h / 2 + 0.04)),
                                 ((t, D - 2 * t, h + 0.05), (W / 2 - t / 2, 0, z + h / 2 + 0.02)), ((t, D - 2 * t, h - 0.04), (-W / 2 + t / 2, 0, z + h / 2 - 0.02)))):
        parts.append(BK.bx(f'parapet{i}', sz, c, m, bevel=0.1))


def vigas(parts, W, y, z, n, out=0.55, r=0.13):
    """从墙里伸出来的圆木梁头（vigas）。y 为墙面位置（正负表示朝向）。"""
    s = 1 if y > 0 else -1
    for i in range(n):
        x = -W / 2 + W * (i + 0.5) / n
        parts.append(BK.cyl('viga', r, out + 0.3, (x, y + s * (out - 0.3) / 2, z), M('bark'), 10, rot=(math.pi / 2, 0, 0)))


def swin(name, center, w, h, facing, frame):
    """土坯墙上的小窗：彩漆木框 + 上方木过梁。"""
    obs = BK.window(name, center, w, h, facing, frame, GLASS, depth=0.1, frame=0.08, mullion=True)
    obs.append(BK.wbox(name + 'l', center, facing, 0, h / 2 + 0.18, 0.06, w + 0.6, 0.2, 0.18, M('rawplank'), uv=True))
    return obs


# ------------------------------------------------------------------ 土坯房
def adobe(name, wall, door, ladder):
    """参考尺寸：9 × 7.5 m（X × Y），墙高 3.6 m，女儿墙到 4.05 m；正面（门）在 -Y（游戏局部 +z）。"""
    W, D, H = 9.0, 7.5, 3.6
    wm = M(wall)
    parts = [BK.bx('body', (W, D, H), (0, 0, H / 2), wm, bevel=0.18)]
    parapet(parts, W, D, H - 0.05, 0.45, wm)
    parts.append(BK.bx('roof', (W - 0.6, D - 0.6, 0.08), (0, 0, H + 0.02), F('roof_earth', 0x7a6048, rough=0.95), uv=False))
    vigas(parts, W, -D / 2, H - 0.4, 6)
    vigas(parts, W, D / 2, H - 0.4, 6)
    # 排水木槽（canales）
    for x in (-W * 0.3, W * 0.25):
        parts.append(BK.bx('canale', (0.26, 0.8, 0.16), (x, -D / 2 - 0.35, H + 0.12), M('rawplank')))
    fy = -D / 2 - 0.01
    dc = DOORS[door]
    parts.append(BK.wbox('door', (W * 0.2, fy, 1.05), '-Y', 0, 0, 0.0, 1.0, 0.06, 2.1, dc))
    parts.append(BK.wbox('door_frame', (W * 0.2, fy, 1.1), '-Y', 0, 0, 0.02, 1.2, 0.05, 2.25, M('rawplank'), uv=True))
    parts.append(BK.wbox('door_lintel', (W * 0.2, fy, 2.35), '-Y', 0, 0, 0.08, 1.7, 0.25, 0.2, M('rawplank'), uv=True))
    for i, x in enumerate((-W * 0.25, W * 0.42)):
        parts += swin(f'wf{i}', (x, fy, 1.6), 0.8, 0.8, '-Y', dc)
    parts += swin('ws1', (W / 2 + 0.01, 0.8, 1.6), 0.7, 0.8, '+X', dc)
    parts += swin('ws2', (-W / 2 - 0.01, -0.6, 1.6), 0.7, 0.8, '-X', dc)
    parts += swin('wb', (-1.0, D / 2 + 0.01, 1.6), 0.8, 0.8, '+Y', dc)
    # 门边挂的一串红辣椒（ristra）
    for k in range(7):
        s = K.sphere('chile', 0.07, (W * 0.2 + 0.85, fy - 0.08, 2.0 - k * 0.13), CHILE, 8, 5, scale=(1, 1, 1.9))
        K.bake_transform(s)
        parts.append(s)
    # 屋顶上的圆润土坯烟囱
    parts.append(BK.cyl('chimney', 0.38, 1.0, (-W * 0.3, D * 0.22, H + 0.5), wm, 14))
    parts.append(BK.cyl('chimney_top', 0.42, 0.12, (-W * 0.3, D * 0.22, H + 1.05), wm, 14))
    if ladder:
        # 靠在侧墙上通往屋顶的木梯（陶斯村落的典型样子）
        x = W / 2 + 0.7
        for s in (-1, 1):
            parts.append(BK.stick('ladder', (x + 0.5, s * 0.32, -0.05), (x - 0.35, s * 0.36, H + 1.2), 0.05, M('bark'), seg=6))
        for k in range(1, 9):
            t = k / 9.5
            xx = x + 0.5 - 0.85 * t
            parts.append(BK.stick('rung', (xx, -0.34, (H + 1.25) * t), (xx, 0.34, (H + 1.25) * t), 0.03, M('bark'), seg=5))
    root, _ = BK.model(name, parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 游客中心
def visitor_center():
    """与程序几何体一致：主体 26 × 14 × 4.4 m（X × Y），女儿墙；左后部（-X、+Y）高出一截的采光塔楼；
    正面（-Y）带木柱门廊、大玻璃窗与玻璃门。"""
    W, D, H = 26.0, 14.0, 4.4
    wm = M('adobe_light')
    parts = [BK.bx('body', (W, D, H), (0, 0, H / 2), wm, bevel=0.2)]
    parapet(parts, W, D, H - 0.05, 0.55, wm, 0.4)
    parts.append(BK.bx('roof', (W - 0.8, D - 0.8, 0.08), (0, 0, H + 0.02), F('roof_earth', 0x7a6048, rough=0.95), uv=False))
    parts.append(BK.bx('tower', (6.0, 6.0, 2.6), (-9.0, 3.0, H + 1.3), wm, bevel=0.15))
    parapet(parts, 6.0, 6.0, H + 2.55, 0.4, wm, 0.3)
    for i, x in enumerate((-10.5, -9.0, -7.5)):
        parts += swin(f'tw{i}', (x, 0.0 - 0.01, H + 1.4), 0.9, 1.0, '-Y', F('frame_wood', 0x5a3a22, rough=0.6))
    vigas(parts, W, D / 2, H - 0.45, 12)
    # 正面：大玻璃窗带（竖梃）+ 中央双玻璃门
    fy = -D / 2 - 0.01
    for i in range(-4, 5):
        if i == 0:
            continue
        parts += BK.window(f'gw{i}', (i * 2.1, fy, 1.7), 1.9, 2.2, '-Y', F('frame_bronze', 0x3a3028, rough=0.4, metal=0.5), GLASS, depth=0.12, frame=0.08, mullion=False)
    parts += BK.window('entry', (0, fy, 1.4), 2.4, 2.6, '-Y', F('frame_bronze', 0x3a3028, rough=0.4, metal=0.5), GLASS, depth=0.12, frame=0.1, mullion=True)
    # 门廊（portal）：木柱 + 托木 + 圆木梁 + 平顶
    py = -D / 2 - 2.6
    for x in range(-12, 13, 3):
        parts.append(BK.cyl('post', 0.17, 3.3, (x, py, 1.65), M('rawplank'), 10))
        parts.append(BK.bx('corbel', (1.0, 0.3, 0.25), (x, py, 3.38), M('rawplank')))
    parts.append(BK.bx('beam', (W + 0.6, 0.35, 0.35), (0, py, 3.66), M('bark')))
    for x in range(-12, 13, 1):
        parts.append(BK.cyl('pviga', 0.09, 3.0, (x + 0.5, py / 2 - D / 4 - 0.2, 3.9), M('bark'), 8, rot=(math.pi / 2, 0, 0)))
    parts.append(BK.bx('proof', (W + 0.8, 2.9, 0.16), (0, py + 1.2, 4.06), F('roof_earth', 0x7a6048, rough=0.95), uv=False))
    parts.append(BK.bx('pfloor', (W + 1.0, 3.2, 0.15), (0, py + 1.3, 0.07), M('concrete')))
    # 门前的木制指示牌
    for s in (-1, 1):
        parts.append(BK.cyl('signpost', 0.1, 2.0, (6.5 + s * 1.3, py - 4.0, 1.0), M('bark'), 8))
    parts.append(BK.bx('sign', (2.9, 0.12, 0.9), (6.5, py - 4.0, 1.7), M('rawplank')))
    parts.append(BK.bx('sign_txt', (2.3, 0.02, 0.35), (6.5, py - 4.07, 1.75), F('sign_cream', 0xe8dcc0, rough=0.6), uv=False))
    # 屋顶空调机组
    for x in (4.0, 9.0):
        parts.append(BK.bx('hvac', (1.6, 1.2, 1.0), (x, 2.0, H + 0.5), F('hvac', 0xc8c4bc, rough=0.5, metal=0.3), uv=False))
    root, _ = BK.model('visitor_center', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 木水塔
def water_tower():
    """与程序几何体一致：四根斜木柱（底 ±2.9 m，顶 ±1.9 m）撑到 10 m，木桶罐（半径 3 m、高 5 m）+ 锥形铁皮顶到约 16.8 m。"""
    parts = []
    tm = M('greyplank')

    def leg(sx, sy, z):
        r = 2.9 - 1.0 * z / 10
        return Vector((sx * r, sy * r, z))

    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for sx, sy in corners:
        parts.append(BK.stick('leg', leg(sx, sy, -0.3), leg(sx, sy, 10), 0.17, M('rawplank'), seg=4))
        parts.append(BK.bx('pier', (0.7, 0.7, 0.5), (sx * 2.9, sy * 2.9, 0.1), M('concrete')))
    for z in (3.5, 7.0, 9.8):
        for c in range(4):
            a, b = corners[c], corners[(c + 1) % 4]
            parts.append(BK.stick('girt', leg(*a, z), leg(*b, z), 0.1, M('rawplank'), seg=4))
    for z0, z1 in ((0.3, 3.5), (3.5, 7.0), (7.0, 9.8)):
        for c in range(4):
            a, b = corners[c], corners[(c + 1) % 4]
            parts.append(BK.stick('rod', leg(*a, z0), leg(*b, z1), 0.025, DARKSTEEL, seg=4))
            parts.append(BK.stick('rod', leg(*b, z0), leg(*a, z1), 0.025, DARKSTEEL, seg=4))
    parts.append(BK.bx('deck', (6.2, 6.2, 0.25), (0, 0, 10.1), M('rawplank')))
    # 桶罐：竖向木板（贴图木纹沿 v 方向）+ 四道铁箍
    tank = K.cylinder('tank', 3.0, 5.0, (0, 0, 12.7), tm, 32)
    K.bake_transform(tank)
    K.uv_from_fn(tank, lambda co, n: (math.atan2(co.y, co.x) * 3.0 / 1.2, co.z / 1.2))
    parts.append(tank)
    for z in (10.7, 11.9, 13.1, 14.3):
        parts.append(K.torus('hoop', 3.03, 0.035, (0, 0, z), DARKSTEEL, 48, 6))
    roof = K.cylinder('roof', 3.35, 1.7, (0, 0, 15.2 + 0.85), M('iron'), 32, r2=0.15)
    K.bake_transform(roof)
    K.uv_from_fn(roof, lambda co, n: (math.atan2(co.y, co.x) * 2.0, (3.35 - math.hypot(co.x, co.y)) / 1.2))
    parts.append(roof)
    parts.append(K.sphere('finial', 0.2, (0, 0, 17.05), DARKSTEEL, 10, 6))
    # 出水管 + 帆布水嘴、检修梯
    parts.append(BK.stick('spout_pipe', (2.2, 0, 10.2), (3.4, 0, 9.4), 0.18, DARKSTEEL, seg=10))
    parts.append(BK.stick('spout', (3.4, 0, 9.4), (3.6, 0, 7.2), 0.14, F('canvas', 0x5a5446, rough=0.9), seg=10))
    for s in (-1, 1):
        parts.append(BK.stick('ladder', (-3.0 + 0.05, s * 0.3, 10.2), (-3.05, s * 0.3, 15.2), 0.035, DARKSTEEL, seg=5))
    for k in range(1, 12):
        z = 10.2 + k * 0.42
        parts.append(BK.stick('rung', (-3.05, -0.3, z), (-3.05, 0.3, z), 0.022, DARKSTEEL, seg=4))
    root, _ = BK.model('water_tower', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 多叶片抽水风车
def windmill():
    """与程序几何体一致：四腿钢塔（底 ±1.2 m 收到顶 ±0.2 m，高 11 m），风轮半径 2.4 m（中心 11.5 m）朝 -Y，
    尾舵伸向 +Y；塔下一个圆形镀锌水槽。"""
    parts = []

    def leg(sx, sy, z):
        r = 1.2 - 1.0 * z / 11
        return Vector((sx * r, sy * r, z))

    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for sx, sy in corners:
        parts.append(BK.stick('leg', leg(sx, sy, -0.2), leg(sx, sy, 11.0), 0.06, STEEL, seg=4))
        parts.append(BK.bx('footing', (0.4, 0.4, 0.3), (sx * 1.2, sy * 1.2, 0.0), M('concrete')))
    levels = (0.2, 2.8, 5.4, 7.8, 10.0)
    for z in levels[1:]:
        for c in range(4):
            a, b = corners[c], corners[(c + 1) % 4]
            parts.append(BK.stick('girt', leg(*a, z), leg(*b, z), 0.035, STEEL, seg=4))
    for z0, z1 in zip(levels, levels[1:]):
        for c in range(4):
            a, b = corners[c], corners[(c + 1) % 4]
            parts.append(BK.stick('brace', leg(*a, z0), leg(*b, z1), 0.018, STEEL, seg=4))
            parts.append(BK.stick('brace', leg(*b, z0), leg(*a, z1), 0.018, STEEL, seg=4))
    parts.append(BK.cyl('platform', 0.75, 0.06, (0, 0, 10.1), M('rawplank'), 16))
    # 机头（齿轮箱）、轮毂、风轮（18 片扭转的镀锌叶片 + 内外两道轮圈 + 辐条）
    hz = 11.5
    parts.append(BK.bx('gearbox', (0.45, 0.9, 0.5), (0, 0.15, hz - 0.05), STEEL, uv=False))
    parts.append(BK.cyl('hub', 0.16, 0.5, (0, -0.4, hz), STEEL, 12, rot=(math.pi / 2, 0, 0), uv=False))
    yb = -0.55
    for i in range(18):
        a = 2 * math.pi * i / 18
        da = 0.13
        pts = []
        for r, tw in ((0.95, 0.5), (2.4, 0.3)):
            for s in (-1, 1):
                ang = a + s * da * (2.4 / r) ** 0.25
                pts.append(Vector((math.cos(ang) * r, yb + s * tw * 0.35, hz + math.sin(ang) * r)))
        blade = K.mesh_obj('blade', [pts[0], pts[1], pts[3], pts[2]], [(0, 1, 2, 3)], STEEL, smooth=0)
        K.add_solidify(blade, 0.012, 0)
        parts.append(blade)
    for r in (0.95, 2.38):
        parts.append(K.torus('rim', r, 0.025, (0, yb, hz), STEEL, 48, 5, rot=(math.pi / 2, 0, 0)))
    for i in range(6):
        a = 2 * math.pi * i / 6
        parts.append(BK.stick('spoke', (0, yb + 0.15, hz), (math.cos(a) * 0.95, yb, hz + math.sin(a) * 0.95), 0.02, STEEL, seg=4))
    # 尾舵
    parts.append(BK.stick('tail_boom', (0, 0.5, hz), (0, 2.6, hz + 0.1), 0.04, STEEL, seg=5))
    parts.append(BK.stick('tail_brace', (0, 0.5, hz - 0.3), (0, 2.3, hz + 0.05), 0.02, STEEL, seg=4))
    parts.append(BK.bx('vane', (0.03, 1.5, 1.0), (0, 3.0, hz + 0.15), STEEL, uv=False))
    # 抽水杆、出水管与水槽
    parts.append(BK.stick('pump_rod', (0, 0, hz - 0.3), (0, 0, 0.9), 0.025, DARKSTEEL, seg=5))
    parts.append(BK.stick('pipe', (0, 0, 0.9), (1.9, -1.9, 0.75), 0.05, DARKSTEEL, seg=6))
    parts.append(BK.cyl('tank', 1.5, 0.7, (2.4, -2.4, 0.35), STEEL, 32, uv=False))
    parts.append(BK.cyl('water', 1.45, 0.02, (2.4, -2.4, 0.62), F('tank_water', 0x2a3a3a, rough=0.05, metal=0.3), 32, uv=False))
    root, _ = BK.model('windmill', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 科考站
def container(parts, name, size, center, m, door_end=1, windows=2, facing='-Y'):
    """集装箱改造的模块房：波纹铁皮外壳 + 端门（锁杆）+ 侧窗 + 空调外机。size = (长 X, 宽 Y, 高 Z)。"""
    L, Wd, H = size
    cx, cy, cz = center
    parts.append(BK.bx(name, size, center, m))
    parts.append(BK.bx(name + '_frame', (L + 0.06, Wd + 0.06, 0.12), (cx, cy, cz + H / 2 - 0.06), DARKSTEEL, uv=False))
    parts.append(BK.bx(name + '_base', (L + 0.06, Wd + 0.06, 0.15), (cx, cy, cz - H / 2 + 0.07), DARKSTEEL, uv=False))
    ex = cx + door_end * (L / 2 + 0.01)
    fe = '+X' if door_end > 0 else '-X'
    for k in (-1, 1):
        parts.append(BK.wbox(name + '_bar', (ex, cy, cz), fe, k * 0.4, 0, 0.04, 0.05, 0.05, H - 0.3, DARKSTEEL))
    fy = cy + (Wd / 2 + 0.01) * (1 if facing == '+Y' else -1)
    for i in range(windows):
        x = cx - L / 2 + L * (i + 0.5) / windows
        parts += BK.window(name + f'_w{i}', (x, fy, cz + 0.2), 1.0, 0.8, facing, WHITE, GLASS, depth=0.06, frame=0.06, mullion=False)
    parts.append(BK.wbox(name + '_ac', (cx + L * 0.35, fy, cz - 0.6), facing, 0, 0, 0.2, 0.8, 0.35, 0.55, F('ac_unit', 0xd8d4cc, rough=0.5, metal=0.3)))


def research_station():
    """与程序几何体一致（游戏坐标 (x, z) → Blender (x, -z)）：北侧一排 4 个模块（y=+6），南侧长模块（4, -5）、
    大模块（-6, -6），太阳能板阵列（y=-12），水罐（13, 3），通信天线杆（-15, -2），旗杆（6, 9）。"""
    parts = []
    mats = [M('corr_white'), M('corr_white'), M('corr_blue')]
    for i in range(4):
        container(parts, f'mod{i}', (6.0, 3.0, 2.9), (-10 + i * 7, 6.0, 1.45), mats[i % 3], door_end=1 if i % 2 else -1, facing='-Y')
    container(parts, 'long', (12.0, 3.0, 2.9), (4.0, -5.0, 1.45), M('corr_white'), door_end=1, windows=4, facing='+Y')
    container(parts, 'lab', (6.0, 6.0, 3.0), (-6.0, -6.0, 1.5), M('corr_white'), door_end=-1, windows=2, facing='+Y')
    # 模块之间的木栈道与台阶
    parts.append(BK.bx('boardwalk', (26.0, 2.4, 0.15), (-1.5, 0.5, 0.35), M('rawplank')))
    for x in (-10.0, -3.0, 4.0, 11.0):
        parts.append(BK.bx('steps', (1.2, 0.9, 0.3), (x, 3.9, 0.15), M('rawplank')))
    # 屋顶卫星天线
    parts.append(BK.cyl('dish_mast', 0.05, 0.8, (5.0, -5.0, 3.3), DARKSTEEL, 8, uv=False))
    dish = K.sphere('dish', 0.7, (5.0, -5.3, 3.8), WHITE, 16, 8, scale=(1, 0.3, 1))
    K.bake_transform(dish)
    parts.append(dish)
    # 太阳能板阵列（倾斜的板 + 支架）
    for i in range(4):
        x = -12.0 + i * 3.2
        p = K.box('panel', (2.8, 1.8, 0.06), (x, -12.0, 1.62), F('pv', 0x16223a, rough=0.3), rot=(math.radians(22), 0, 0))
        K.bake_transform(p)
        parts.append(p)
        for dx in (-1.1, 1.1):
            parts.append(BK.stick('pv_leg', (x + dx, -11.4, 0), (x + dx, -11.4, 1.95), 0.04, STEEL, seg=4))
            parts.append(BK.stick('pv_leg', (x + dx, -12.6, 0), (x + dx, -12.6, 1.25), 0.04, STEEL, seg=4))
    # 水罐（白色立式罐 + 爬梯）
    parts.append(BK.cyl('tank', 1.8, 6.0, (13.0, 3.0, 3.0), F('tank_white', 0xe2ded6, rough=0.5), 32, uv=False))
    parts.append(BK.cyl('tank_top', 1.9, 0.5, (13.0, 3.0, 6.25), F('tank_white', 0xe2ded6, rough=0.5), 32, r2=0.6, uv=False))
    for s in (-1, 1):
        parts.append(BK.stick('tladder', (14.83, 3.0 + s * 0.25, 0.0), (14.83, 3.0 + s * 0.25, 6.0), 0.03, DARKSTEEL, seg=4))
    # 通信天线杆（细长桁架 + 鞭状天线）
    for k in range(3):
        a = 2 * math.pi * k / 3
        p0 = (-15.0 + math.cos(a) * 0.25, -2.0 + math.sin(a) * 0.25, 0.0)
        p1 = (-15.0 + math.cos(a) * 0.12, -2.0 + math.sin(a) * 0.12, 13.5)
        parts.append(BK.stick('mast', p0, p1, 0.035, STEEL, seg=4))
    for z in range(1, 14):
        parts.append(K.torus('mast_ring', 0.24 - z * 0.009, 0.012, (-15.0, -2.0, z), STEEL, 10, 4))
    parts.append(BK.stick('whip', (-15.0, -2.0, 13.5), (-15.0, -2.0, 14.3), 0.02, DARKSTEEL, seg=4))
    # 旗杆
    parts.append(BK.cyl('flagpole', 0.06, 6.6, (6.0, 9.0, 3.3), STEEL, 8, uv=False))
    root, _ = BK.model('research_station', parts)
    ROOTS.append(root)


adobe('adobe_a', 'adobe', 'turquoise', False)
adobe('adobe_b', 'adobe', 'blue', True)
adobe('adobe_c', 'adobe_light', 'green', True)
visitor_center()
water_tower()
windmill()
research_station()

for r in ROOTS:
    r.location = (0, 0, 0)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    K.box('ground', (200, 200, 0.1), (0, 0, -0.05), K.material('ground', 0xb08a64, rough=0.95))
    shots = {'adobe_b': ((12, -12, 5), (0, 0, 2.0)), 'visitor_center': ((24, -30, 9), (0, -3, 2.5)),
             'water_tower': ((14, -16, 9), (0, 0, 9)), 'windmill': ((8, -12, 7), (0, 0, 7)),
             'research_station': ((24, -30, 14), (0, 0, 1.5))}
    for nm, (cam_p, tgt) in shots.items():
        for r in ROOTS:
            for c in [r] + list(r.children):
                c.hide_render = r.name != nm
        cam = K.camera('cam_' + nm, cam_p, tgt, fov_deg=50)
        K.render(os.path.join(PREVIEW, nm + '.png'), cam, (900, 600), samples=48)
    for r in ROOTS:
        for c in [r] + list(r.children):
            c.hide_render = False
    bpy.data.objects.remove(bpy.data.objects['ground'])

ROOTS += CP.build_all()
BK.export(OUT, ROOTS)
print('EXPORTED', OUT, len(ROOTS), 'models')
