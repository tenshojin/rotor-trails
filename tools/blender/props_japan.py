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
import jlandmarks as JL  # noqa: E402

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


# ------------------------------------------------------------------ 电线杆（日本乡村的混凝土电杆，参照实拍：灰色锥形混凝土杆、
# 顶部两层钢腕金 + 白色瓷绝缘子、柱上变压器、防犯灯、脚踏螺栓、编号牌）。
# 高度 12 m；腕金沿局部 X（游戏里垂直于道路），电线挂点：高压 3 根（10.75 m，x = -0.65 / 0 / 0.65），
# 低压 / 通信 2 根（7.2 m 与 6.4 m，x = 0.25），与 src/world/props/japan.ts 的 POLE 常量一致。
def denchu(name, transformer):
    CON = M('concrete')
    STEEL = F('pole_steel', 0x6d7176, rough=0.45, metal=0.6)
    PORC = F('porcelain', 0xe9ecec, rough=0.25)
    CAN = F('trans_grey', 0x9aa1a6, rough=0.4, metal=0.3)
    LAMP = F('lamp_led', 0xf4f6f0, rough=0.2, emit=0xfff8e8, emit_strength=0.6)
    TAG = F('pole_tag', 0xd9d3c0, rough=0.7)
    for lod in range(3):
        nm = name if lod == 0 else f'{name}@{lod}'
        parts = [BK.cyl(nm + '_pole', 0.19, 12.0, (0, 0, 6.0), CON, (16, 10, 6)[lod], r2=0.12)]
        if lod < 2:
            for z, ln in ((10.75, 1.8), (9.95, 1.5)):
                parts.append(BK.bx(nm + f'_arm{z}', (ln, 0.07, 0.07), (0, 0.16, z), STEEL, uv=False))
                if lod == 0:
                    # 腕金撑铁（斜撑）
                    for sx in (-1, 1):
                        parts.append(K.tube_path(nm + f'_br{z}{sx}', [(sx * ln * 0.35, 0.16, z - 0.02), (0, 0.16, z - 0.55)], 0.015, STEEL, seg=5))
                    for x in ((-0.65, 0.0, 0.65) if z > 10 else (-0.55, 0.55)):
                        for k in range(3):
                            parts.append(BK.cyl(nm + f'_ins{z}{x}{k}', 0.055 - k * 0.008, 0.045, (x, 0.16, z + 0.06 + k * 0.05), PORC, 10, uv=False))
            # 低压 / 通信线的挂钩
            for z in (7.2, 6.4):
                parts.append(BK.bx(nm + f'_hk{z}', (0.5, 0.05, 0.05), (0.2, 0.0, z), STEEL, uv=False))
            if transformer:
                # 柱上变压器（两台）+ 托架 + 引下线
                parts.append(BK.bx(nm + '_tb', (0.12, 0.9, 0.1), (0, 0.45, 8.6), STEEL, uv=False))
                for i, (x, r, h) in enumerate(((-0.28, 0.24, 0.85), (0.3, 0.2, 0.7))):
                    parts.append(BK.cyl(nm + f'_tr{i}', r, h, (x, 0.62, 8.2), CAN, (14, 8)[lod], uv=False))
                    parts.append(BK.cyl(nm + f'_tl{i}', r + 0.02, 0.05, (x, 0.62, 8.2 + h / 2 + 0.02), CAN, (14, 8)[lod], uv=False))
                    if lod == 0:
                        parts.append(K.tube_path(nm + f'_ld{i}', [(x, 0.62, 8.2 + h / 2), (x * 0.9, 0.3, 9.9)], 0.012, F('cable_black', 0x1d1f21, rough=0.6), seg=5))
                # 防犯灯：短臂 + LED 灯头
                parts.append(K.tube_path(nm + '_la', [(0, 0.12, 5.2), (0, 0.9, 5.45)], 0.025, STEEL, seg=6))
                parts.append(BK.bx(nm + '_lh', (0.16, 0.36, 0.08), (0, 1.0, 5.42), LAMP, uv=False))
        if lod == 0:
            # 脚踏螺栓：从 2.4 m 起左右交替
            z = 2.4
            k = 0
            while z < 11.3:
                a = (k % 2) * math.pi + math.pi / 2
                r0 = 0.19 - (z / 12.0) * 0.07
                parts.append(K.tube_path(nm + f'_st{k}', [(math.cos(a) * r0, math.sin(a) * r0, z), (math.cos(a) * (r0 + 0.2), math.sin(a) * (r0 + 0.2), z)], 0.011, STEEL, seg=5))
                z += 0.45
                k += 1
            # 编号牌
            parts.append(BK.bx(nm + '_tag', (0.12, 0.012, 0.3), (0, -0.19, 1.8), TAG, uv=False))
        root, _ = BK.model(nm, parts)
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
denchu('denchu_a', False)
denchu('denchu_b', True)
torii()
# 五重塔、拜殿：三级细节；灯塔、常夜灯：各一个实例，只做近景
for lod in range(3):
    ROOTS.append(JL.pagoda(lod))
    ROOTS.append(JL.shrine(lod))
ROOTS.append(JL.lighthouse())
ROOTS.append(JL.joyato())
for i, c in enumerate(HULL_COLORS):
    boat(f'boat_{i}', c)

# 每个模型沿 X 方向排开（仅用于预览；导出的子网格相对各自的根节点）
for i, r in enumerate(ROOTS):
    r.location = (0, 0, 0)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    shots = {'pagoda': ((24, -30, 10), (0, 0, 14)), 'pagoda_eave': ((9, -11, 3.5), (0, 0, 7.5)), 'shrine': ((11, -16, 5), (0, 0, 3.5)), 'shrine_front': ((2, -11, 2.2), (0, -4, 3.2)), 'lighthouse': ((11, -15, 25), (0, 0, 21.5)), 'joyato': ((6, -8, 4), (0, 0, 4.5))}
    for nm, (cam_p, tgt) in shots.items():
        target = nm.split('_')[0] if nm not in [r.name for r in ROOTS] else nm
        for r in ROOTS:
            for c in [r] + list(r.children):
                c.hide_render = r.name != target
        cam = K.camera('cam_' + nm, cam_p, tgt, fov_deg=50)
        K.render(os.path.join(PREVIEW, nm + '.png'), cam, (900, 600), samples=48)
    for r in ROOTS:
        for c in [r] + list(r.children):
            c.hide_render = False

BK.export(OUT, ROOTS)
print('EXPORTED', OUT, len(ROOTS), 'models')
