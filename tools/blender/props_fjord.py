# 挪威峡湾地图的建筑模型（参照：博尔贡木板教堂、峡湾村庄的彩色木屋与船屋照片，维基共享资源）。
# 运行：blender -b --factory-startup --python tools/blender/props_fjord.py -- public/models/props_fjord.glb [--preview 目录]
# 尺寸与 src/world/props/fjord.ts 的碰撞体一致（木屋、船屋按游戏里的宽/高/长缩放）。

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
OUT = argv[0] if argv else 'public/models/props_fjord.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
M = BK.mat
F = BK.flat
WHITE = F('trim_white', 0xf0eee8, rough=0.55)
GLASS = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
GUTTER = F('gutter_dark', 0x2c2e31, rough=0.45, metal=0.5)
DOOR = F('door_green', 0x2f4a3c, rough=0.55)
DARK = F('tar_black', 0x16120f, rough=0.7)
IRON = F('iron_black', 0x1b1b1c, rough=0.5, metal=0.6)
ROOTS = []

WALLS = {'red': 'falu', 'white': 'whiteplank', 'yellow': 'yellowplank', 'blue': 'blueplank'}


def nwin(name, center, w, h, facing, trim=WHITE):
    """挪威木屋的白框窗：外框 + 竖梃 + 两道横档（2×3 格）+ 窗套与顶部檐板。"""
    obs = BK.window(name, center, w, h, facing, trim, GLASS, depth=0.08, frame=0.07, mullion=True)
    for k in (1, 2):
        obs.append(BK.wbox(name + 'h', center, facing, 0, -h / 2 + h * k / 3, 0.03, w, 0.05, 0.04, trim))
    for s in (-1, 1):
        obs.append(BK.wbox(name + 'c', center, facing, s * (w / 2 + 0.13), 0, 0.02, 0.12, 0.04, h + 0.3, trim))
    obs.append(BK.wbox(name + 't', center, facing, 0, h / 2 + 0.2, 0.05, w + 0.5, 0.12, 0.1, trim))
    return obs


def gable_trim(parts, L, W, RH, H, ov_side, ov_gable, m=WHITE, r=0.07):
    """山墙檐板（沿两端坡顶边的白色封檐板）与屋檐下的封檐板。"""
    slope = RH / (W / 2)
    ze = H - ov_side * slope
    for sx in (-1, 1):
        x = sx * (L / 2 + ov_gable)
        for sy in (-1, 1):
            parts.append(BK.stick('rake', (x, sy * (W / 2 + ov_side), ze - 0.05), (x, 0, H + RH - 0.02), r, m, seg=4))
    for sy in (-1, 1):
        parts.append(BK.stick('fascia', (-L / 2 - ov_gable, sy * (W / 2 + ov_side), ze - 0.06), (L / 2 + ov_gable, sy * (W / 2 + ov_side), ze - 0.06), r, m, seg=4))


# ------------------------------------------------------------------ 木屋
def nhouse(name, wall, roof):
    """参考尺寸：长 10 m（屋脊方向）、宽 7.5 m、墙顶高 5 m（含 0.5 m 基座），屋顶高 0.45 × 宽。
    建模时屋脊沿 X、正门在 +X 山墙，最后整体转 90°（屋脊沿 Y、门朝 +Y = 游戏局部 -z）。"""
    L, W, H, P = 10.0, 7.5, 5.0, 0.5
    RH = W * 0.45
    wm = M(WALLS[wall])
    parts = [BK.bx('plinth', (L + 0.12, W + 0.12, P), (0, 0, P / 2), M('concrete'))]
    parts.append(BK.bx('wall', (L, W, H - P), (0, 0, P + (H - P) / 2), wm))
    for side in (-1, 1):
        parts.append(BK.gable_wall(f'gable{side}', L, W, RH, H, wm, x_side=side))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(BK.bx('corner', (0.17, 0.17, H - P), (sx * (L / 2 + 0.02), sy * (W / 2 + 0.02), P + (H - P) / 2), WHITE, uv=False))
    # 两侧长墙：一层三扇大窗、二层三扇小窗
    for fy, facing in ((W / 2 + 0.01, '+Y'), (-W / 2 - 0.01, '-Y')):
        for i, x in enumerate((-3.0, 0.0, 3.0)):
            parts += nwin(f'w1{facing}{i}', (x, fy, P + 1.35), 0.9, 1.25, facing)
            parts += nwin(f'w2{facing}{i}', (x, fy, P + 3.35), 0.8, 0.95, facing)
    # 正面山墙（+X）：门 + 台阶 + 窗；二层两窗；山尖小窗
    fx = L / 2 + 0.01
    door_y = -1.6
    parts.append(BK.wbox('door', (fx, door_y, P + 1.05), '+X', 0, 0, 0.02, 1.0, 0.06, 2.1, DOOR))
    for s in (-1, 1):
        parts.append(BK.wbox('door_c', (fx, door_y, P + 1.05), '+X', s * 0.6, 0, 0.04, 0.14, 0.05, 2.3, WHITE))
    parts.append(BK.wbox('door_t', (fx, door_y, P + 2.3), '+X', 0, 0, 0.06, 1.5, 0.14, 0.12, WHITE))
    parts.append(BK.wbox('door_knob', (fx, door_y, P + 1.0), '+X', 0.35, 0, 0.08, 0.06, 0.06, 0.06, IRON))
    parts.append(BK.bx('step', (0.9, 1.6, 0.25), (fx + 0.45, door_y, P - 0.12), M('concrete')))
    parts.append(BK.bx('step2', (0.5, 1.6, 0.25), (fx + 0.25, door_y, P + 0.1), M('concrete')))
    parts += nwin('wf1', (fx, 1.6, P + 1.35), 0.9, 1.25, '+X')
    for y in (-1.5, 1.5):
        parts += nwin(f'wf2{y}', (fx, y, P + 3.35), 0.8, 0.95, '+X')
    parts += nwin('wfa', (fx, 0, H + 1.05), 0.6, 0.75, '+X')
    # 背面山墙（-X）
    bx_ = -L / 2 - 0.01
    for y in (-1.6, 1.6):
        parts += nwin(f'wb1{y}', (bx_, y, P + 1.35), 0.9, 1.25, '-X')
        parts += nwin(f'wb2{y}', (bx_, y, P + 3.35), 0.8, 0.95, '-X')
    # 屋顶：黑色釉面瓦（带屋脊瓦）或草皮（带压草木条）
    ov_side, ov_gable = 0.45, 0.35
    if roof == 'turf':
        objs, lines, eaves = BK.roof_gable('roof', L, W, RH, ov_side, ov_gable, 0.32, M('turf'), H)
        parts += objs
        slope = RH / (W / 2)
        ze = H - ov_side * slope
        for sy in (-1, 1):
            # 屋檐处挡住草皮的木条（torvvol）
            parts.append(BK.stick('torvvol', (-L / 2 - ov_gable, sy * (W / 2 + ov_side - 0.1), ze + 0.32), (L / 2 + ov_gable, sy * (W / 2 + ov_side - 0.1), ze + 0.32), 0.1, DARK, seg=6))
    else:
        objs, lines, eaves = BK.roof_gable('roof', L, W, RH, ov_side, ov_gable, 0.14, M('blacktile'), H)
        parts += objs
        a, b = lines[0]
        parts.append(BK.ridge_tube('ridge', a + Vector((0, 0, 0.12)), b + Vector((0, 0, 0.12)), 0.13, F('ridge_black', 0x18191b, rough=0.35)))
    gable_trim(parts, L, W, RH, H, ov_side, ov_gable)
    # 烟囱（白灰泥 + 黑色铁皮帽）
    cx = -L * 0.22
    parts.append(BK.bx('chimney', (0.62, 0.62, 2.1), (cx, 0.0, H + RH - 0.3), M('plaster')))
    parts.append(BK.bx('chimney_cap', (0.8, 0.8, 0.08), (cx, 0.0, H + RH + 0.78), IRON, uv=False))
    # 檐沟与落水管
    slope = RH / (W / 2)
    ze = H - ov_side * slope
    for sy in (-1, 1):
        y = sy * (W / 2 + ov_side + 0.06)
        parts.append(BK.stick('gutter', (-L / 2 - ov_gable, y, ze - 0.12), (L / 2 + ov_gable, y, ze - 0.12), 0.07, GUTTER, seg=8))
        yw = sy * (W / 2 + 0.1)
        parts.append(K.tube_path('down', [(L / 2 - 0.1, y, ze - 0.12), (L / 2 - 0.1, y, ze - 0.35), (L / 2 - 0.1, yw, ze - 0.6), (L / 2 - 0.1, yw, P + 0.1)], 0.045, GUTTER, seg=6))
    BK.rotate_all(parts, math.pi / 2)
    root, _ = BK.model(name, parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 船屋（naust）
def boathouse(name, wall_m):
    """参考尺寸：长 10 m、宽 6 m、墙高 5 m，屋顶高 2.6 m；下部 2.2 m 石砌基座伸到水里。大门在朝水的山墙（+Y）。"""
    L, W, H, RH = 10.0, 6.0, 5.0, 2.6
    parts = [BK.bx('base', (L + 0.3, W + 0.3, 2.4), (0, 0, -1.0), M('stonewall'))]
    parts.append(BK.bx('wall', (L, W, H - 0.2), (0, 0, 0.2 + (H - 0.2) / 2), wall_m))
    for side in (-1, 1):
        parts.append(BK.gable_wall(f'gable{side}', L, W, RH, H, wall_m, x_side=side))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(BK.bx('corner', (0.16, 0.16, H - 0.2), (sx * (L / 2 + 0.02), sy * (W / 2 + 0.02), 0.2 + (H - 0.2) / 2), WHITE, uv=False))
    fx = L / 2 + 0.01
    # 双开大门（深色木板 + 白框 + Z 形斜撑）
    for s in (-1, 1):
        parts.append(BK.wbox('door', (fx, s * 0.82, 2.0), '+X', 0, 0, 0.03, 1.6, 0.08, 3.6, M('tarplank'), uv=True))
        parts.append(BK.wbox('brace_t', (fx, s * 0.82, 3.3), '+X', 0, 0, 0.09, 1.5, 0.05, 0.14, WHITE))
        parts.append(BK.wbox('brace_b', (fx, s * 0.82, 0.7), '+X', 0, 0, 0.09, 1.5, 0.05, 0.14, WHITE))
    for (y0, z0, y1, z1) in ((-1.55, 0.75, -0.1, 3.25), (1.55, 0.75, 0.1, 3.25)):
        parts.append(BK.stick('brace_d', (fx + 0.1, y0, z0), (fx + 0.1, y1, z1), 0.05, WHITE, seg=4))
    for s in (-1, 1):
        parts.append(BK.wbox('door_c', (fx, s * 1.72, 2.0), '+X', 0, 0, 0.05, 0.16, 0.06, 3.8, WHITE))
    parts.append(BK.wbox('door_t', (fx, 0, 3.95), '+X', 0, 0, 0.06, 3.6, 0.14, 0.16, WHITE))
    # 阁楼小门
    parts.append(BK.wbox('loft', (fx, 0, H + 0.7), '+X', 0, 0, 0.03, 0.9, 0.06, 1.0, M('tarplank'), uv=True))
    parts.append(BK.wbox('loft_c', (fx, 0, H + 0.7), '+X', 0, 0, 0.04, 1.1, 0.04, 1.2, WHITE))
    for facing, fy in (('+Y', W / 2 + 0.01), ('-Y', -W / 2 - 0.01)):
        parts += nwin('sw' + facing, (-1.5, fy, 2.8), 0.7, 0.6, facing)
    objs, lines, eaves = BK.roof_gable('roof', L, W, RH, 0.35, 0.3, 0.14, M('blacktile'), H)
    parts += objs
    a, b = lines[0]
    parts.append(BK.ridge_tube('ridge', a + Vector((0, 0, 0.12)), b + Vector((0, 0, 0.12)), 0.12, F('ridge_black', 0x18191b, rough=0.35)))
    gable_trim(parts, L, W, RH, H, 0.35, 0.3)
    # 系船柱与木栈板
    parts.append(BK.bx('ramp', (3.0, 3.6, 0.2), (fx + 1.5, 0, -0.1), M('rawplank')))
    for y in (-1.6, 1.6):
        parts.append(BK.cyl('bollard', 0.14, 0.9, (fx + 2.7, y, 0.25), DARK, 10, uv=False))
    BK.rotate_all(parts, math.pi / 2)
    root, _ = BK.model(name, parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 木板教堂（参照博尔贡木板教堂）
def dragon(name, base, d, up=1.3, length=1.7):
    """屋脊龙头：从山墙顶端向外上方伸出、末端卷曲的曲杆。"""
    b = Vector(base)
    d = Vector(d).normalized()
    pts = [b + d * (length * t) + Vector((0, 0, up * t ** 1.7)) for t in (0.0, 0.3, 0.6, 0.85, 1.0)]
    tip = pts[-1]
    pts += [tip + d * 0.22 + Vector((0, 0, 0.22)), tip + d * 0.1 + Vector((0, 0, 0.42))]
    return K.tube_path(name, pts, 0.1, DARK, seg=8)


def stave_church():
    """碰撞体：底层 10 × 14 × 6 m，上层 7 × 8 m（6.5–11.5 m），塔 4 × 4 m（13–16 m），尖顶到约 27 m。
    建模时教堂沿 X（西门在 +X），最后转 90°（西门朝 +Y）。"""
    parts = []
    SH = M('shingle')
    TP = M('tarplank')
    # 石砌地基
    parts.append(BK.bx('found', (14.4, 10.4, 0.5), (0, 0, 0.25), M('stonewall')))
    # 外圈回廊（svalgang）：低矮木墙 + 一排拱形小开口 + 单坡木瓦屋面
    X1, Y1 = 7.0, 5.0
    for (sz, c) in (((14.0, 0.25, 1.9), (0, Y1 - 0.12, 1.45)), ((14.0, 0.25, 1.9), (0, -Y1 + 0.12, 1.45)),
                    ((0.25, 10.0, 1.9), (X1 - 0.12, 0, 1.45)), ((0.25, 10.0, 1.9), (-X1 + 0.12, 0, 1.45))):
        parts.append(BK.bx('sval', sz, c, TP))
    for i in range(16):
        x = -6.0 + i * 0.8
        for sy in (-1, 1):
            parts.append(BK.bx('arc', (0.36, 0.08, 0.55), (x, sy * (Y1 + 0.02), 1.75), DARK, uv=False))
            parts.append(BK.cyl('arc_top', 0.18, 0.08, (x, sy * (Y1 + 0.02), 2.02), DARK, 10, rot=(math.pi / 2, 0, 0), uv=False))
    parts += BK.lean_ring('sval_roof', 6.0, 4.0, 3.9, X1 + 0.35, Y1 + 0.35, 2.25, 0.12, SH)
    # 侧廊墙（主体外墙）与侧廊屋面
    parts.append(BK.bx('aisle', (12.0, 8.0, 5.0), (0, 0, 0.5 + 2.5), TP))
    parts += BK.lean_ring('aisle_roof', 4.6, 2.9, 7.4, 6.35, 4.35, 5.3, 0.12, SH)
    # 中殿高墙（clerestory）与陡峭的两坡屋面
    CL, CW, CZ = 9.2, 5.8, 10.6
    parts.append(BK.bx('clere', (CL, CW, CZ - 5.0), (0, 0, 5.0 + (CZ - 5.0) / 2), TP))
    for side in (-1, 1):
        parts.append(BK.gable_wall(f'cgable{side}', CL, CW, 4.6, CZ, TP, x_side=side))
    objs, lines, eaves = BK.roof_gable('croof', CL, CW, 4.6, 0.35, 0.3, 0.12, SH, CZ)
    parts += objs
    a, b = lines[0]
    parts.append(BK.ridge_tube('cridge', a + Vector((0, 0, 0.1)), b + Vector((0, 0, 0.1)), 0.1, DARK))
    # 中殿高处的小圆窗
    for x in (-3.0, -1.0, 1.0, 3.0):
        for sy in (-1, 1):
            parts.append(BK.cyl('oculus', 0.16, 0.06, (x, sy * (CW / 2 + 0.02), 9.4), DARK, 12, rot=(math.pi / 2, 0, 0), uv=False))
    # 山墙顶的龙头（两端各一对）与十字架
    top = CZ + 4.6
    for sx in (-1, 1):
        x = sx * (CL / 2 + 0.3)
        for sy in (-1, 1):
            parts.append(dragon('dragon', (x, sy * 0.15, top - 0.3), (sx * 0.85, sy * 0.5, 0)))
        parts.append(BK.bx('cross_v', (0.12, 0.12, 1.3), (x - sx * 0.2, 0, top + 0.6), DARK, uv=False))
        parts.append(BK.bx('cross_h', (0.12, 0.8, 0.12), (x - sx * 0.2, 0, top + 0.85), DARK, uv=False))
    # 屋脊中央的塔：两层小屋面 + 钟楼 + 六角尖顶
    parts.append(BK.bx('tower', (2.6, 2.6, 4.2), (0, 0, 14.0), TP))
    objs, _, _ = BK.roof_hip('troof1', 2.6, 2.6, 1.3, 0.55, 0.0, 0.1, SH, 16.1)
    parts += objs
    parts.append(BK.bx('belfry', (1.7, 1.7, 1.6), (0, 0, 17.6), TP))
    for (dx, dy) in ((0.86, 0), (-0.86, 0), (0, 0.86), (0, -0.86)):
        parts.append(BK.bx('louver', (0.9 if dy else 0.06, 0.06 if dy else 0.9, 0.9), (dx, dy, 17.6), DARK, uv=False))
    objs, _, _ = BK.roof_hip('troof2', 1.7, 1.7, 0.9, 0.45, 0.0, 0.1, SH, 18.4)
    parts += objs
    spire = K.cylinder('spire', 0.95, 7.2, (0, 0, 19.0 + 3.6), SH, 6, r2=0.04)
    K.bake_transform(spire)
    BK.uv_world(spire, 1.1)
    parts.append(spire)
    parts.append(BK.bx('vane_v', (0.06, 0.06, 1.1), (0, 0, 26.7), IRON, uv=False))
    parts.append(BK.bx('vane', (0.6, 0.04, 0.3), (0.25, 0, 26.9), IRON, uv=False))
    # 东端圣坛与半圆后殿（圆锥顶 + 小圆塔）
    parts.append(BK.bx('chancel', (3.2, 5.0, 4.6), (-8.4, 0, 0.5 + 2.3), TP))
    objs, lines2, _ = BK.roof_gable('chroof', 3.2, 5.0, 2.8, 0.3, 0.0, 0.12, SH, 5.1, cx=-8.4)
    parts += objs
    parts.append(BK.cyl('apse', 2.0, 4.0, (-10.0, 0, 0.5 + 2.0), TP, 16))
    apse_roof = K.cylinder('apse_roof', 2.35, 2.2, (-10.0, 0, 4.5 + 1.1), SH, 16, r2=0.7)
    K.bake_transform(apse_roof)
    BK.uv_world(apse_roof, 1.1)
    parts.append(apse_roof)
    parts.append(BK.cyl('apse_tower', 0.7, 1.4, (-10.0, 0, 7.2), TP, 12))
    apse_spire = K.cylinder('apse_spire', 0.85, 2.6, (-10.0, 0, 7.9 + 1.3), SH, 12, r2=0.03)
    K.bake_transform(apse_spire)
    BK.uv_world(apse_spire, 1.1)
    parts.append(apse_spire)
    # 西门门廊：小两坡顶 + 雕花门框
    parts.append(BK.bx('porch', (1.6, 2.6, 2.6), (X1 + 0.6, 0, 0.5 + 1.3), TP))
    objs, _, _ = BK.roof_gable('proof', 1.6, 2.6, 1.6, 0.25, 0.25, 0.1, SH, 3.1, cx=X1 + 0.6)
    parts += objs
    parts.append(BK.bx('portal', (0.08, 1.2, 2.0), (X1 + 1.42, 0, 0.5 + 1.0), DARK, uv=False))
    for s in (-1, 1):
        parts.append(BK.cyl('portal_col', 0.12, 2.2, (X1 + 1.44, s * 0.75, 0.5 + 1.1), F('carved', 0x2a1f17, rough=0.8), 8, uv=False))
    parts.append(dragon('pdragon', (X1 + 1.45, 0, 4.6), (1, 0, 0), up=0.5, length=0.7))
    BK.rotate_all(parts, math.pi / 2)
    root, _ = BK.model('stave_church', parts)
    ROOTS.append(root)


for wall in WALLS:
    for roof in ('tile', 'turf'):
        nhouse(f'nhouse_{wall}_{roof}', wall, roof)
boathouse('boathouse_red', M('falu'))
boathouse('boathouse_grey', M('greyplank'))
stave_church()

for r in ROOTS:
    r.location = (0, 0, 0)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    K.box('ground', (200, 200, 0.1), (0, 0, -0.05), K.material('ground', 0x6f7a52, rough=0.95))
    shots = {'nhouse_red_tile': ((13, 15, 7), (0, 0, 3.5)), 'nhouse_white_turf': ((-14, 13, 8), (0, 0, 3.5)),
             'nhouse_yellow_tile': ((15, -10, 6), (0, 0, 3)), 'boathouse_red': ((9, 16, 5), (0, 0, 2.5)),
             'stave_church': ((22, 24, 10), (0, 0, 10))}
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
