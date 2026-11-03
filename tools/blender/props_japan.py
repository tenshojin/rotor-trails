# 日本海湾地图的建筑模型（参照：鞆之浦传统民居、严岛神社海上大鸟居等照片，维基共享资源）。
# 运行：blender -b --factory-startup --python tools/blender/props_japan.py -- public/models/props_japan.glb [--preview 目录]
# 尺寸与 src/world/props/japan.ts 的碰撞体一致（模型按游戏里的宽/深缩放）。

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import bldkit as BK  # noqa: E402
import jhouse as JH  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/models/props_japan.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
M = BK.mat
F = BK.flat
GLASS = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
FRAME = F('alu', 0xb9bdc2, rough=0.35, metal=0.8)
DARKWOOD = F('darkwood', 0x2a1d14, rough=0.75)
RIDGE = F('ridge_tile', 0x3b3f45, rough=0.55)
VERMILION = F('vermilion', 0xd2401e, rough=0.55)
BLACK = F('black_lacquer', 0x16171a, rough=0.45)
WHITE = F('paint_white', 0xeeeeea, rough=0.5)
RED = F('paint_red', 0xb8231c, rough=0.5)
GOLD = F('gold', 0xb89a4c, rough=0.35, metal=0.9)
SHOJI = F('shoji', 0xe8e2d0, rough=0.9)
ROPE = F('rope', 0xc8b78a, rough=0.9)
HULL_COLORS = [0xeeeeea, 0x2f62b0, 0xb8322a, 0x3c8a4a]

ROOTS = []


# ------------------------------------------------------------------ 民居（jhouse.py，参照鞆之浦町家照片）
def jhouse(name, two_story, wall_style, W=8.5, D=7.0):
    """每种民居导出三级：name（近景几何瓦与全部细节）、name@1（中景贴图屋面）、name@2（远景体块）。
    参考尺寸 W×D（X×Y），门在 +Y 面（游戏局部 -z）；游戏里按每栋的宽/深缩放。"""
    for lod, fn in enumerate((JH.lod0, JH.lod1, JH.lod2)):
        nm = name if lod == 0 else f'{name}@{lod}'
        root, _ = BK.model(nm, fn(nm, two_story, wall_style, W, D))
        ROOTS.append(root)


# ------------------------------------------------------------------ 海上大鸟居（两部鸟居，参照严岛神社）
def torii():
    """游戏里：主柱 x=±4.2，半径约 0.6，笠木顶高约 13.5 m，水面下延伸 3 m。原点 = 水面高度。"""
    parts = []
    h = 13.0
    for sx in (-1, 1):
        x = sx * 4.2
        parts.append(BK.cyl('hashira', 0.6, h + 3.0, (x, 0, (h - 3.0) / 2), VERMILION, 24, r2=0.55, uv=False))
        parts.append(BK.cyl('nemaki', 0.66, 0.9, (x, 0, 0.2), BLACK, 24, uv=False))  # 柱脚黑色根卷（水面处）
        # 前后两根稚儿柱（支撑柱）与连接它们的短贯
        for sy in (-1, 1):
            y = sy * 2.3
            parts.append(BK.cyl('sode', 0.34, 9.5, (x, y, 1.8), VERMILION, 18, uv=False))
            parts.append(BK.cyl('sode_cap', 0.4, 0.35, (x, y, 6.7), BLACK, 18, uv=False))
            parts.append(BK.cyl('sode_root', 0.4, 0.6, (x, y, 0.2), BLACK, 18, uv=False))
            for z in (3.0, 5.6):
                parts.append(BK.bx('sode_nuki', (0.32, 2.3, 0.36), (x, y / 2, z), VERMILION, uv=False))
    # 贯（下横梁）：两端伸出柱外
    parts.append(BK.bx('nuki', (11.2, 0.7, 0.75), (0, 0, h - 2.2), VERMILION, uv=False))
    # 额束与匾额
    parts.append(BK.bx('gakuzuka', (0.9, 0.5, 1.2), (0, 0, h - 1.25), VERMILION, uv=False))
    parts.append(BK.bx('gaku', (1.3, 0.12, 1.7), (0, 0.31, h - 1.25), BLACK, uv=False))
    parts.append(BK.bx('gaku_txt', (0.6, 0.02, 1.2), (0, 0.38, h - 1.25), GOLD, uv=False))
    # 岛木（朱红）与笠木（黑色，两端上翘的反り）
    parts.append(BK.bx('shimaki', (13.4, 1.0, 0.6), (0, 0, h - 0.55), VERMILION, uv=False))
    n = 24
    L = 14.6
    verts, faces = [], []
    for i in range(n + 1):
        t = i / n
        x = -L / 2 + L * t
        k = abs(2 * t - 1)
        lift = 0.75 * k ** 2.6  # 两端上翘
        th = 0.55 + 0.25 * k ** 3
        z0 = h - 0.25 + lift
        for (yy, zz) in ((-0.75, z0), (0.75, z0), (0.75, z0 + th), (-0.75, z0 + th)):
            verts.append((x, yy, zz))
    for i in range(n):
        a, b = i * 4, (i + 1) * 4
        for j in range(4):
            j2 = (j + 1) % 4
            faces.append((a + j, b + j, b + j2, a + j2))
    faces.append((0, 3, 2, 1))
    faces.append((n * 4, n * 4 + 1, n * 4 + 2, n * 4 + 3))
    kas = K.mesh_obj('kasagi', verts, faces, BLACK, smooth=30)
    K.fix_normals(kas)
    parts.append(kas)
    root, _ = BK.model('torii', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 五重塔
def pagoda():
    parts = []
    parts.append(BK.bx('base', (13, 13, 1.6), (0, 0, 0.8), M('concrete')))
    parts.append(BK.bx('steps', (3.0, 2.0, 0.8), (0, 7.4, 0.4), M('concrete')))
    y = 1.6
    for k in range(5):
        w = 8.6 - k * 0.9
        fh = 4.2 if k == 0 else 3.2
        parts.append(BK.bx(f'body{k}', (w, w, fh), (0, 0, y + fh / 2), F('pagoda_red', 0x8f2a18, rough=0.6), uv=False))
        # 白色连子窗/门、斗拱层（深色挑檐梁）
        parts.append(BK.bx(f'door{k}', (w * 0.36, 0.06, fh * 0.6), (0, w / 2 + 0.03, y + fh * 0.42), F('pagoda_door', 0x3a2416, rough=0.6), uv=False))
        parts.append(BK.bx(f'bracket{k}', (w + 0.8, w + 0.8, 0.45), (0, 0, y + fh - 0.1), F('bracket', 0x5a2416, rough=0.6), uv=False))
        objs, lines, eaves = BK.roof_hip(f'roof{k}', w + 3.2, w + 3.2, 1.3, 0.6, 0.05, 0.22, M('kawara'), y + fh + 0.15)
        parts += objs
        for i, (a, b) in enumerate(lines[1:]):
            parts.append(BK.ridge_tube(f'hip{k}{i}', a + Vector((0, 0, 0.2)), b + Vector((0, 0, 0.2)), 0.12, RIDGE))
        parts += BK.eave_caps(f'cap{k}_', eaves, 0.4, 0.1, RIDGE)
        y += fh + 1.3
    # 相轮（九轮）
    parts.append(BK.cyl('spire', 0.22, 8.0, (0, 0, y + 4.0), GOLD, 12, r2=0.14, uv=False))
    for i in range(9):
        parts.append(BK.cyl(f'ring{i}', 0.55 - i * 0.02, 0.12, (0, 0, y + 0.8 + i * 0.6), GOLD, 16, uv=False))
    parts.append(K.sphere('hoju', 0.35, (0, 0, y + 8.2), GOLD, 12, 6))
    root, _ = BK.model('pagoda', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 神社拜殿
def shrine():
    parts = []
    parts.append(BK.bx('base', (12, 9, 1.2), (0, 0, 0.6), M('concrete')))
    parts.append(BK.bx('stair', (3.2, 1.4, 0.6), (0, 5.1, 0.3), M('concrete')))
    parts.append(BK.bx('body', (9, 6.5, 3.2), (0, 0, 1.2 + 1.6), F('shrine_wood', 0x7a2a1a, rough=0.6), uv=False))
    for sx in (-1, 0, 1):
        for sy in (-1, 1):
            parts.append(BK.cyl('pillar', 0.2, 3.2, (sx * 4.3, sy * 3.1, 2.8), VERMILION, 12, uv=False))
    parts.append(BK.bx('front', (6.0, 0.08, 2.0), (0, 3.3, 2.4), SHOJI, uv=False))
    parts.append(BK.bx('rope', (5.0, 0.3, 0.3), (0, 3.6, 3.9), ROPE, uv=False))  # 注连绳
    objs, lines, eaves = BK.roof_gable('roof', 9, 6.5, 3.2, 1.4, 1.0, 0.25, M('kawara'), 4.4)
    parts += objs
    a, b = lines[0]
    parts.append(BK.ridge_tube('ridge', a + Vector((0, 0, 0.25)), b + Vector((0, 0, 0.25)), 0.22, RIDGE))
    for sx in (-1, 1):
        parts.append(BK.gable_wall(f'gw{sx}', 9, 6.5, 3.2, 4.4, F('gable_wood', 0x5a2416, rough=0.7), x_side=sx))
    # 千木与鲣木
    for t in (-0.6, -0.2, 0.2, 0.6):
        parts.append(BK.cyl('katsuogi', 0.16, 1.4, (t * 4.5, 0, 7.95), GOLD, 10, rot=(math.pi / 2, 0, 0), uv=False))
    root, _ = BK.model('shrine', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 灯塔
def lighthouse():
    parts = []
    h = 20.0
    parts.append(BK.cyl('plinth', 4.0, 2.0, (0, 0, 1.0), M('concrete'), 32, r2=4.2))
    tower = BK.cyl('tower', 2.6, h, (0, 0, 2 + h / 2), WHITE, 32, r2=1.8, uv=False)
    parts.append(tower)
    for k in range(3):
        r0 = 2.6 - (5 + k * 6 - 2) / h * 0.8
        parts.append(BK.cyl(f'band{k}', r0 + 0.03, 1.0, (0, 0, 5 + k * 6), RED, 32, r2=r0 - 0.01, uv=False))
    parts.append(BK.cyl('door', 0.6, 2.0, (0, 2.45, 3.0), F('lh_door', 0x2f4f6a, rough=0.5), 12, rot=(math.pi / 2, 0, 0), uv=False))
    for z in (8.0, 14.0):
        parts.append(BK.bx(f'win{z}', (0.5, 0.2, 0.9), (0, 2.25 - (z - 2) / h * 0.8, z), GLASS, uv=False))
    parts.append(BK.cyl('gallery', 2.7, 0.35, (0, 0, h + 2.4), F('lh_dark', 0x2a2d31, rough=0.5, metal=0.4), 32, uv=False))
    for i in range(24):
        a = 2 * math.pi * i / 24
        parts.append(BK.cyl(f'rail{i}', 0.03, 1.0, (2.55 * math.cos(a), 2.55 * math.sin(a), h + 3.0), F('lh_rail', 0xd8d8d0, rough=0.4, metal=0.6), 6, uv=False))
    parts.append(K.torus('railtop', 2.55, 0.04, (0, 0, h + 3.5), F('lh_rail', 0xd8d8d0, rough=0.4, metal=0.6), 48, 6))
    parts.append(BK.cyl('lantern', 1.4, 2.6, (0, 0, h + 3.8), F('lh_lamp', 0xfff6d0, rough=0.1, emit=0xfff2c0, emit_strength=2.0), 16, uv=False))
    for i in range(8):
        a = 2 * math.pi * i / 8
        parts.append(BK.cyl(f'mull{i}', 0.05, 2.6, (1.42 * math.cos(a), 1.42 * math.sin(a), h + 3.8), F('lh_dark', 0x2a2d31, rough=0.5, metal=0.4), 6, uv=False))
    parts.append(BK.cyl('cap', 1.8, 1.8, (0, 0, h + 6.0), RED, 24, r2=0.15, uv=False))
    parts.append(BK.cyl('vent', 0.25, 0.5, (0, 0, h + 7.1), F('lh_dark', 0x2a2d31, rough=0.5, metal=0.4), 12, uv=False))
    root, _ = BK.model('lighthouse', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 渔船（参考长度 13 m，游戏按长度等比缩放）
def boat(name, hull_hex):
    parts = []
    L, W = 13.0, 4.2
    hull_m = F(f'hull_{name}', hull_hex, rough=0.4)
    # 船体：船首尖、船尾方的放样（截面为 U 形）
    n = 20
    verts, faces = [], []
    prof = 10
    for i in range(n + 1):
        t = i / n
        x = -L / 2 + L * t
        bow = max(0.0, (t - 0.72) / 0.28)
        half = W / 2 * (1 - bow ** 1.6 * 0.96)
        keel = -1.0 + 0.25 * bow
        top = 1.0 + 0.45 * bow ** 2
        for j in range(prof + 1):
            a = math.pi * j / prof
            y = -half * math.cos(a)
            z = keel + (top - keel) * (1 - math.sin(a) ** 0.55) if 0 < j < prof else top
            z = top if j in (0, prof) else keel * math.sin(a) ** 0.6 + top * (1 - math.sin(a) ** 0.6)
            verts.append((x, y, z))
    for i in range(n):
        for j in range(prof):
            a = i * (prof + 1) + j
            b = a + prof + 1
            faces.append((a, b, b + 1, a + 1))
    stern = [j for j in range(prof + 1)]
    faces.append(tuple(stern[::-1]))
    hull = K.mesh_obj('hull', verts, faces, hull_m, smooth=40)
    K.fix_normals(hull)
    parts.append(hull)
    parts.append(BK.bx('deck', (L * 0.9, W * 0.92, 0.1), (-0.3, 0, 0.95), M('hinoki')))
    parts.append(BK.bx('rail_l', (L * 0.8, 0.08, 0.12), (0, W / 2 - 0.05, 1.05), F('boat_trim', 0x2a2d31, rough=0.5), uv=False))
    parts.append(BK.bx('rail_r', (L * 0.8, 0.08, 0.12), (0, -W / 2 + 0.05, 1.05), F('boat_trim', 0x2a2d31, rough=0.5), uv=False))
    # 驾驶室
    cx = L * 0.12
    parts.append(BK.bx('cabin', (L * 0.28, W * 0.72, 1.8), (cx, 0, 1.9), WHITE, uv=False))
    parts.append(BK.bx('cabin_roof', (L * 0.31, W * 0.78, 0.12), (cx, 0, 2.86), WHITE, uv=False))
    parts.append(BK.bx('cabin_glass', (L * 0.285, W * 0.73, 0.6), (cx, 0, 2.35), GLASS, uv=False))
    # 桅杆、雷达、集鱼灯、救生圈
    parts.append(BK.cyl('mast', 0.08, 3.4, (cx - 0.6, 0, 4.4), WHITE, 8, uv=False))
    parts.append(BK.bx('radar', (1.2, 0.18, 0.12), (cx - 0.6, 0, 5.0), WHITE, uv=False))
    for i in range(6):
        parts.append(K.sphere(f'lamp{i}', 0.16, (-L * 0.32 + i * 1.0, 0, 2.6), F('lamp_glass', 0xf2f2e6, rough=0.1), 10, 6))
    parts.append(BK.bx('lampline', (6.0, 0.04, 0.04), (-L * 0.32 + 2.5, 0, 2.75), F('boat_trim', 0x2a2d31, rough=0.5), uv=False))
    parts.append(K.torus('buoy', 0.32, 0.08, (cx + 0.7, W * 0.36 + 0.05, 1.9), F('buoy', 0xff6a1a, rough=0.5), 20, 8, rot=(math.pi / 2, 0, 0)))
    root, _ = BK.model(name, parts)
    ROOTS.append(root)


jhouse('jhouse_1a', False, 'plaster')
jhouse('jhouse_1b', False, 'wood')
jhouse('jhouse_2a', True, 'plaster')
jhouse('jhouse_2b', True, 'wood')
# 大宅（村里约 15% 的“大户”，游戏里宽深约为普通民居的 1.3 × 1.2 倍）：按大尺寸单独建模，避免瓦垄被拉宽
jhouse('jhouse_2aL', True, 'plaster', 11.0, 8.4)
jhouse('jhouse_2bL', True, 'wood', 11.0, 8.4)
torii()
pagoda()
shrine()
lighthouse()
for i, c in enumerate(HULL_COLORS):
    boat(f'boat_{i}', c)

# 每个模型沿 X 方向排开（仅用于预览；导出的子网格相对各自的根节点）
for i, r in enumerate(ROOTS):
    r.location = (0, 0, 0)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    shots = {'jhouse_2b': ((14, 14, 7), (0, 0, 3.5)), 'jhouse_1a': ((-12, 13, 6), (0, 0, 2.5)), 'torii': ((10, 26, 6), (0, 0, 8)), 'pagoda': ((22, 26, 12), (0, 0, 14)), 'boat_0': ((10, 12, 6), (0, 0, 1.5))}
    for nm, (cam_p, tgt) in shots.items():
        for r in ROOTS:
            for c in [r] + list(r.children):
                c.hide_render = r.name != nm
        cam = K.camera('cam_' + nm, cam_p, tgt, fov_deg=50)
        K.render(os.path.join(PREVIEW, nm + '.png'), cam, (900, 600), samples=48)
    for r in ROOTS:
        for c in [r] + list(r.children):
            c.hide_render = False

BK.export(OUT, ROOTS)
print('EXPORTED', OUT, len(ROOTS), 'models')
