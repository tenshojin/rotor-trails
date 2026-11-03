# RT-7 外观（座舱外壳以外的部分），参照 H125 / AS350 实机照片（维基共享资源：F-HGRU 主旋翼头、尾桨、正面照；
# AERO 2018 Friedrichshafen 展机）：后机身、发动机 / 减速器整流罩（进气格栅、排气管）、Starflex 主旋翼头
# （星形板、桨叶套筒、频率匹配器、变距拉杆与色标、自动倾斜器、旋翼轴防尘套）、三片桨叶（前缘防磨条、根部色标）、
# 尾梁与传动轴整流罩、翼型平尾与端板、垂尾、两叶跷跷板尾桨与尾减速器、滑橇（横管、耐磨板、踏板）、天线、灯、防线缆切割器、舱门把手与铰链。
# 运行：blender -b --factory-startup --python tools/blender/heli_ext.py -- public/models/heli_ext.glb [--preview 目录]
#
# 节点约定（src/render/heliModel.ts 依赖）：
#   main_rotor  主旋翼（原点在桨毂，绕 Z 轴 = 游戏 y 轴转动），其下 main_rotor_hub 为桨毂、blades 为桨叶网格
#   tail_rotor  尾桨（原点在尾桨轴，绕 X 轴转动），其下 tail_rotor_mesh
# 尺寸与 src/config/flight.ts 的 HELI 一致：旋翼半径 5.3 m、桨毂高 1.75 m、尾桨 Y=-7.15 Z=1.1 半径 0.75、
# 滑橇半跨 1.15、前端 Y=1.45、后端 Y=-1.5、底面 Z=-1.32。

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import heli_shape as HS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/models/heli_ext.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
TX = 'art/out/tex/'

K.reset()
PAINT = K.material('cp_paint', 0xe9eaeb, rough=0.32, coat=0.3)
DARK = K.material('cp_paint_dark', 0x1f2a3a, rough=0.36, coat=0.3)
STRIPE = K.material('cp_paint_stripe', 0xc0281e, rough=0.34, coat=0.3)
METAL = K.material('ext_metal', 0x8a8f95, rough=0.35, metal=0.9)
DMETAL = K.material('ext_darkmetal', 0x2e3136, rough=0.45, metal=0.7)
STAR = K.material('ext_starflex', 0x8d9196, rough=0.5, metal=0.2)       # 照片里星形板、套筒是浅灰色涂层
ELASTO = K.material('ext_elastomer', 0x121314, rough=0.85)
BLADE = K.material('ext_blade', 0x25282c, rough=0.5, metal=0.2)
EROSION = K.material('ext_erosion', 0xb4b8bd, rough=0.22, metal=1.0)  # 桨叶前缘防磨条（不锈钢 / 镍）
TAPE = {'r': K.material('ext_tape_red', 0xc8241c, rough=0.4), 'b': K.material('ext_tape_blue', 0x2456b8, rough=0.4),
        'y': K.material('ext_tape_yellow', 0xe6b416, rough=0.4)}
TR_BLADE = K.material('ext_tr_blade', 0xaeb2b7, rough=0.3, metal=0.9)
WARN_W = K.material('ext_warn_white', 0xeeeeea, rough=0.4)
BLADE_TIP = K.material('ext_blade_tip', 0xe8c21c, rough=0.45)
GRILLE = K.material('ext_grille', 0x45484d, rough=0.45, metal=0.7)
GRILLE_BACK = K.material('ext_grille_back', 0x050505, rough=0.9)
EXHAUST = K.material('ext_exhaust', 0x6a5a4a, rough=0.42, metal=0.85)
SKID = K.material('ext_skid', 0x9a9ea3, rough=0.3, metal=0.85)
TREAD = K.material('ext_tread', 0x5c6066, rough=0.55, metal=0.8)
RUBBER = K.material('ext_rubber', 0x151515, rough=0.9)
LIGHT_R = K.material('ext_light_red', 0xff2a1a, rough=0.2, emit=0xff2010, emit_strength=1.5)
LIGHT_G = K.material('ext_light_green', 0x30ff60, rough=0.2, emit=0x20ff50, emit_strength=1.5)
LIGHT_W = K.material('ext_light_white', 0xffffff, rough=0.2, emit=0xffffff, emit_strength=1.2)
LENS = K.material('ext_lens', 0xdfe6ea, rough=0.05, metal=0.0, alpha=0.5)

PARTS = []  # 静态外观部件
LIVERY = [PAINT, DARK, STRIPE]


def livery(ob):
    """按面中心位置给涂装面分配白/深灰蓝/红三种材质。"""
    me = ob.data
    me.materials.clear()
    for m in LIVERY:
        me.materials.append(m)
    for p in me.polygons:
        p.material_index = HS.livery_slot(p.center)
    return ob


def loft(name, ys, point, NT=96, cap_end=True, section=None, mat=PAINT):
    verts, faces = [], []
    for y in ys:
        ts = HS.ring_ts(*section(y), NT) if section else [2 * math.pi * i / NT for i in range(NT)]
        for t in ts:
            verts.append(point(y, t))
    for r in range(len(ys) - 1):
        for i in range(NT):
            i2 = (i + 1) % NT
            faces.append((r * NT + i, (r + 1) * NT + i, (r + 1) * NT + i2, r * NT + i2))
    if cap_end:
        last = (len(ys) - 1) * NT
        faces.append(tuple(last + i for i in range(NT)))
    ob = K.mesh_obj(name, verts, faces, mat)
    K.fix_normals(ob)
    K.shade(ob, 55)
    return ob


def xform(ob, M):
    K.apply_mods(ob)
    K.bake_transform(ob)
    ob.data.transform(M)
    return ob


AIRFOIL = [(0.0, 0.0), (0.012, 0.016), (0.05, 0.03), (0.12, 0.042), (0.25, 0.048), (0.45, 0.04), (0.65, 0.026), (0.85, 0.011), (1.0, 0.0),
           (0.85, -0.009), (0.65, -0.018), (0.45, -0.026), (0.25, -0.032), (0.12, -0.03), (0.05, -0.022), (0.012, -0.012)]


def wing(name, spans, mat, axis='X', profile=AIRFOIL, cap=True):
    """沿 axis 方向放样的翼型（桨叶、平尾、垂尾）。spans: [(s, 弦长, 扭转度, 厚度比例, 前缘偏移 d, 法向偏移 h)]，
    弦线沿 -Y（前缘朝 +Y），厚度沿 +Z；axis='Z' 时翼展沿 Z（垂尾）。"""
    verts, faces = [], []
    m = len(profile)
    for (s, c, tw, th, d, h) in spans:
        a = math.radians(tw)
        for (u, v) in profile:
            x = (0.25 - u) * c  # 弦向（前缘在 +）
            z = v * c * th
            xr = x * math.cos(a) - z * math.sin(a)
            zr = x * math.sin(a) + z * math.cos(a)
            if axis == 'X':
                verts.append((s, xr + d, zr + h))
            else:  # 垂尾：翼展沿 Z，厚度沿 X
                verts.append((zr + h, xr + d, s))
    n = len(spans)
    for i in range(n - 1):
        for j in range(m):
            j2 = (j + 1) % m
            faces.append((i * m + j, i * m + j2, (i + 1) * m + j2, (i + 1) * m + j))
    if cap:
        faces.append(tuple(range(m - 1, -1, -1)))
        faces.append(tuple((n - 1) * m + j for j in range(m)))
    ob = K.mesh_obj(name, verts, faces, mat)
    K.fix_normals(ob)
    K.shade(ob, 35)
    return ob


# ------------------------------------------------------------------ 后机身与尾梁
ys = [-1.32 - 0.05 * i for i in range(31)]
rear = loft('rear', ys, HS.rear_point, NT=160, section=HS.rear_section)
livery(rear)
PARTS.append(rear)

nb = 48
ys = [HS.BOOM_Y0 + (HS.BOOM_Y1 - HS.BOOM_Y0) * i / nb for i in range(nb + 1)]


def boom_axis(y):
    k = (y - HS.BOOM_Y0) / (HS.BOOM_Y1 - HS.BOOM_Y0)
    return HS.BOOM_R0 + (HS.BOOM_R1 - HS.BOOM_R0) * k, HS.BOOM_Z0 + (HS.BOOM_Z1 - HS.BOOM_Z0) * k


def boom_point(y, t):
    r, zc = boom_axis(y)
    return Vector((r * math.cos(t), y, zc + r * math.sin(t)))


boom = loft('boom', ys, boom_point, NT=48)
me = boom.data
me.materials.clear()
for m in LIVERY:
    me.materials.append(m)
for p in me.polygons:
    r, zc = boom_axis(p.center.y)
    dz = p.center.z - zc
    p.material_index = 1 if dz < -0.06 else (2 if dz < 0.0 else 0)
PARTS.append(boom)
# 尾梁上方的尾桨传动轴整流罩（半圆长条）+ 三个轴承座小鼓包
shaft_pts = []
for i in range(31):
    y = HS.BOOM_Y0 - 0.15 + (HS.BOOM_Y1 + 0.35 - HS.BOOM_Y0) * i / 30
    r, zc = boom_axis(y)
    shaft_pts.append((0, y, zc + r - 0.005))
PARTS.append(K.tube_path('shaft_cover', shaft_pts, 0.055, PAINT, seg=16))
for y in (-3.6, -4.6, -5.6):
    r, zc = boom_axis(y)
    PARTS.append(K.sphere(f'bearing{y}', 0.075, (0, y, zc + r + 0.01), PAINT, 16, 8, scale=(1, 1.6, 0.7)))

# ------------------------------------------------------------------ 发动机 / 减速器整流罩（座舱顶部后方）


def cowl_point(y, t):
    k = (0.55 - y) / 3.3
    W = 0.30 + 0.28 * math.sin(math.pi * min(1.0, k * 1.15)) ** 0.6
    top = 1.18 + 0.32 * math.sin(math.pi * min(1.0, k * 1.05)) ** 0.5
    bot = 0.86 - 0.05 * k
    W = max(0.08, W * (1 - max(0.0, k - 0.9) * 6))
    return HS.superellipse(W, top, bot, 2.6, y, t)


ys = [0.55 - 3.3 * i / 80 for i in range(81)]
cowl = loft('cowl', ys, cowl_point, NT=64)
K.shade(cowl, 60)
PARTS.append(cowl)


def cowl_side(y, z, side):
    """整流罩侧面上 (y, z) 处的表面点与外法线（数值求交）。"""
    best, bt = None, 0.0
    for i in range(720):
        t = 2 * math.pi * i / 720
        p = cowl_point(y, t)
        if p.x * side <= 0:
            continue
        d = abs(p.z - z)
        if best is None or d < best:
            best, bt = d, t
    p = cowl_point(y, bt)
    q = cowl_point(y, bt + 0.01)
    r = cowl_point(y - 0.01, bt)
    n = (q - p).cross(r - p).normalized()
    if n.x * side < 0:
        n = -n
    return p, n


# 进气格栅（照片：整流罩两侧大块黑色网格，带框）
for side in (-1, 1):
    yc, zc = -0.75, 1.17
    p, n = cowl_side(yc, zc, side)
    u = Vector((0, 1, 0))
    v = n.cross(u).normalized()
    if v.z < 0:
        v = -v
    W, H = 0.62, 0.26
    frame = K.box(f'grille_frame{side}', (0.02, W + 0.05, H + 0.05), (0, 0, 0), DMETAL, bevel=0.008)
    back = K.box(f'grille_back{side}', (0.01, W, H), (0, 0, 0), GRILLE_BACK)
    rot = Matrix((n, u, v)).transposed().to_4x4()
    for ob, off in ((frame, 0.006), (back, -0.012)):
        xform(ob, Matrix.Translation(p + n * off) @ rot)
        PARTS.append(ob)
    for i in range(23):  # 竖向格条
        b = K.box(f'gbar{side}{i}', (0.012, 0.006, H), (0, 0, 0), GRILLE)
        xform(b, Matrix.Translation(p + n * 0.004 + u * (-W / 2 + W * (i + 0.5) / 23)) @ rot)
        PARTS.append(b)
    for j in range(7):  # 横向格条
        b = K.box(f'gbarh{side}{j}', (0.010, W, 0.005), (0, 0, 0), GRILLE)
        xform(b, Matrix.Translation(p + n * 0.0 + v * (-H / 2 + H * (j + 0.5) / 7)) @ rot)
        PARTS.append(b)
    # 整流罩检修门的锁扣（两个）
    for dy in (-0.42, 0.42):
        q, nq = cowl_side(yc + dy, zc - 0.13, side)
        PARTS.append(xform(K.box(f'latch{side}{dy}', (0.012, 0.07, 0.025), (0, 0, 0), METAL, bevel=0.004), Matrix.Translation(q + nq * 0.006) @ rot))

# 排气管（右后方，向后上方伸出，带隔热罩与法兰）
ex_pts = K.round_path([(0.22, -2.05, 1.16), (0.32, -2.45, 1.22), (0.40, -2.78, 1.38), (0.43, -2.95, 1.55)], 0.22)
PARTS.append(K.tube_path('exhaust', ex_pts, 0.13, EXHAUST, seg=24))
PARTS.append(K.tube_path('exhaust_lip', [ex_pts[-2], ex_pts[-1]], 0.137, EXHAUST, seg=24, cap=False))
PARTS.append(K.torus('exhaust_flange', 0.14, 0.012, (0.30, -2.40, 1.21), DMETAL, 32, 8, rot=(math.radians(80), 0, math.radians(-12))))
# 主减速器整流罩（前缘下凹的圆罩）与旋翼轴防尘套（黑色波纹）
PARTS.append(K.cylinder('mast_fair', 0.34, 0.22, (0, 0, 1.40), PAINT, 40, r2=0.22))
prof = []
for i in range(13):
    t = i / 12
    prof.append((0.105 * (1.0 if i % 2 == 0 else 0.86) * (1 - 0.25 * t), 1.51 + 0.16 * t))
verts, faces = [], []
for i in range(32):
    a = 2 * math.pi * i / 32
    for r, z in prof:
        verts.append((r * math.cos(a), r * math.sin(a), z))
mm = len(prof)
for i in range(32):
    i2 = (i + 1) % 32
    for j in range(mm - 1):
        faces.append((i * mm + j, i2 * mm + j, i2 * mm + j + 1, i * mm + j + 1))
boot = K.mesh_obj('mast_boot', verts, faces, RUBBER, smooth=50)
K.fix_normals(boot)
PARTS.append(boot)
PARTS.append(K.cylinder('swash_guide', 0.075, 0.12, (0, 0, 1.70), METAL, 24))

# ------------------------------------------------------------------ 主旋翼头（Starflex）与桨叶
rotor_parts = []
blades = []
R = 5.3
Z_STAR = 0.0  # 星形板平面（桨毂原点）
COLORS = ['r', 'b', 'y']
rotor_parts.append(K.cylinder('mast_top', 0.072, 0.30, (0, 0, -0.17), METAL, 24))
rotor_parts.append(K.cylinder('hub_core', 0.12, 0.10, (0, 0, 0.0), STAR, 32, bevel=0.01))
# 顶部圆盘与上面的小盒（照片里是一块浅灰色大圆盘）
rotor_parts.append(K.cylinder('hub_dish', 0.33, 0.035, (0, 0, 0.115), STAR, 48, r2=0.30, bevel=0.008))
rotor_parts.append(K.cylinder('hub_dish_rim', 0.20, 0.06, (0, 0, 0.08), STAR, 32, r2=0.33))
rotor_parts.append(K.box('hub_box', (0.13, 0.09, 0.07), (0.04, 0.0, 0.165), PAINT, bevel=0.01))
rotor_parts.append(K.cylinder('hub_box_eye', 0.025, 0.004, (0.04, -0.046, 0.165), DMETAL, 16, rot=(math.pi / 2, 0, 0)))
# 自动倾斜器（旋转环）+ 剪刀臂
rotor_parts.append(K.cylinder('swash', 0.21, 0.035, (0, 0, -0.26), METAL, 40, bevel=0.006))
rotor_parts.append(K.torus('swash_ring', 0.20, 0.012, (0, 0, -0.24), DMETAL, 40, 8))
rotor_parts.append(xform(K.box('scissor_a', (0.02, 0.10, 0.012), (0, 0, 0), DMETAL), Matrix.Translation((0.10, 0.0, -0.18)) @ Matrix.Rotation(math.radians(35), 4, 'Y')))
rotor_parts.append(xform(K.box('scissor_b', (0.02, 0.10, 0.012), (0, 0, 0), DMETAL), Matrix.Translation((0.10, 0.0, -0.10)) @ Matrix.Rotation(math.radians(-35), 4, 'Y')))
for k in range(3):
    a = 2 * math.pi * k / 3
    rot = Matrix.Rotation(a, 4, 'Z')
    # 星形板的臂（锥形、端部圆角）
    arm = K.prism(f'star{k}', [(0.08, -0.085), (0.34, -0.050), (0.365, -0.02), (0.365, 0.02), (0.34, 0.050), (0.08, 0.085)], -0.03, 0.005, STAR, axis='Z')
    K.add_bevel(arm, 0.006, 2)
    rotor_parts.append(xform(arm, rot))
    # 球面推力轴承（橡胶 / 金属叠层）
    for i in range(5):
        disc = K.cylinder(f'brg{k}{i}', 0.055 - i * 0.003, 0.012, (0, 0, 0), ELASTO if i % 2 == 0 else METAL, 24, rot=(0, math.pi / 2, 0))
        rotor_parts.append(xform(disc, rot @ Matrix.Translation((0.17 + i * 0.012, 0, -0.012))))
    # 桨叶套筒：上下两片夹板（从桨毂一直到桨根）+ 内端连接块
    for zz in (0.032, -0.056):
        plate = K.prism(f'sleeve{k}{zz}', [(0.14, -0.058), (0.60, -0.050), (0.66, -0.035), (0.66, 0.035), (0.60, 0.050), (0.14, 0.058)], zz, zz + 0.016, STAR, axis='Z')
        K.add_bevel(plate, 0.004, 2)
        rotor_parts.append(xform(plate, rot))
    rotor_parts.append(xform(K.box(f'sleeve_blk{k}', (0.05, 0.11, 0.10), (0.14, 0, -0.012), STAR, bevel=0.01), rot))
    # 频率匹配器（黑色橡胶圆柱，连接星形臂端与套筒）
    fa = K.cylinder(f'freq{k}', 0.032, 0.17, (0, 0, 0), ELASTO, 20, bevel=0.006)
    rotor_parts.append(xform(fa, rot @ Matrix.Translation((0.44, -0.07, -0.01)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')))
    for dx in (0.36, 0.52):
        cap = K.cylinder(f'freq_cap{k}{dx}', 0.036, 0.018, (0, 0, 0), METAL, 20)
        rotor_parts.append(xform(cap, rot @ Matrix.Translation((dx, -0.07, -0.01)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')))
    # 桨根螺栓（两颗竖直）
    for dx in (0.575, 0.625):
        rotor_parts.append(xform(K.cylinder(f'bolt{k}{dx}', 0.014, 0.12, (0, 0, 0), METAL, 12), rot @ Matrix.Translation((dx, 0.0, -0.012))))
        rotor_parts.append(xform(K.cylinder(f'nut{k}{dx}', 0.022, 0.016, (0, 0, 0), DMETAL, 6), rot @ Matrix.Translation((dx, 0.0, -0.07))))
    # 变距摇臂（套筒前缘一侧）与变距拉杆（下到自动倾斜器），拉杆上端缠色标
    horn_tip = Vector((0.24, 0.11, -0.04))
    rotor_parts.append(xform(K.box(f'horn{k}', (0.05, 0.11, 0.025), (0, 0, 0), STAR, bevel=0.006), rot @ Matrix.Translation((0.22, 0.07, -0.04))))
    low = Vector((0.20 * math.cos(math.radians(28)), 0.20 * math.sin(math.radians(28)), -0.245))
    a0 = rot @ low
    a1 = rot @ horn_tip
    rotor_parts.append(K.tube_path(f'plink{k}', [a0, a1], 0.010, METAL, seg=10))
    for e in (a0, a1):
        rotor_parts.append(K.sphere(f'rodend{k}', 0.017, tuple(e), DMETAL, 10, 6))
    band = a0.lerp(a1, 0.78)
    d = (a1 - a0).normalized()
    rotor_parts.append(K.tube_path(f'plink_tape{k}', [band - d * 0.02, band + d * 0.02], 0.0125, TAPE[COLORS[k]], seg=10))
    # 桨叶：根部加厚的接头（套筒端）→ 翼型桨叶，弦长 0.35 m，扭转 -10°；前缘防磨条、根部色标、桨尖
    spans = [(0.62, 0.20, 9.0, 2.2, 0.0, -0.012), (0.80, 0.30, 8.6, 1.4, 0.0, -0.012), (1.05, 0.35, 8.0, 1.0, 0.0, -0.01)]
    n = 26
    for i in range(1, n + 1):
        r = 1.05 + (R - 1.05) * i / n
        spans.append((r, 0.35, 8.0 - 10.0 * (r - 1.05) / (R - 1.05), 1.0, 0.0, -0.01))
    bl = wing(f'blade{k}', spans, BLADE)
    bl.data.transform(rot)
    blades.append(bl)
    # 前缘防磨条：沿前缘的一条细金属带（只取翼型前 3 个点构成的窄条）
    es = [(s, c * 1.004, tw, th * 1.05, d, h) for (s, c, tw, th, d, h) in spans[2:]]
    strip = wing(f'erosion{k}', es, EROSION, profile=[(0.05, -0.022), (0.012, -0.012), (0.0, 0.0), (0.012, 0.016), (0.05, 0.03)], cap=False)
    strip.data.transform(rot)
    blades.append(strip)
    tape = wing(f'tape{k}', [(0.95, 0.352, 8.0, 1.06, 0, -0.01), (1.05, 0.352, 8.0, 1.06, 0, -0.01)], TAPE[COLORS[k]])
    tape.data.transform(rot)
    blades.append(tape)
    tipb = wing(f'tip{k}', [(R - 0.22, 0.352, -2.0, 1.06, 0, -0.01), (R - 0.12, 0.352, -2.0, 1.06, 0, -0.01)], BLADE_TIP)
    tipb.data.transform(rot)
    blades.append(tipb)
rotor_hub = K.join(rotor_parts, 'main_rotor_hub')
K.shade(rotor_hub, 40)
rotor_blades = K.join(blades, 'blades')
main_rotor = bpy.data.objects.new('main_rotor', None)
bpy.context.scene.collection.objects.link(main_rotor)
main_rotor.location = (0, 0, 1.75)
for o in (rotor_hub, rotor_blades):
    o.parent = main_rotor

# ------------------------------------------------------------------ 平尾、端板、垂尾、尾撬
# 平尾：翼型截面（倒装弯度），展长 2.2 m、弦长 0.5 m
stab = wing('stab', [(-1.08, 0.50, 0, 1.6, -5.55, 0.66), (0.0, 0.52, 0, 1.6, -5.55, 0.66), (1.08, 0.50, 0, 1.6, -5.55, 0.66)], PAINT,
            profile=[(u, -v) for (u, v) in AIRFOIL])
PARTS.append(stab)
for sx in (-1, 1):
    ep = wing(f'endplate{sx}', [(0.45, 0.46, 0, 0.9, -5.62, sx * 1.10), (0.72, 0.50, 0, 0.9, -5.65, sx * 1.10), (1.02, 0.40, 0, 0.9, -5.72, sx * 1.10)],
              STRIPE, axis='Z')
    PARTS.append(ep)
    PARTS.append(K.sphere(f'nav{sx}', 0.04, (sx * 1.13, -5.38, 0.72), LIGHT_G if sx > 0 else LIGHT_R, 12, 8))
    PARTS.append(K.sphere(f'nav_lens{sx}', 0.05, (sx * 1.13, -5.38, 0.72), LENS, 12, 8, scale=(0.8, 1.2, 1.0)))
# 上垂尾（后掠，红色）与下垂尾（白色，带尾撬）
fin_up = [(0.78, 0.62, 0.0, 0.85, -6.80, 0.0), (1.10, 0.54, 0.0, 0.85, -6.98, 0.0), (1.45, 0.46, 0.0, 0.85, -7.12, 0.0), (1.78, 0.36, 0.0, 0.85, -7.25, 0.0)]
PARTS.append(wing('fin_up', fin_up, STRIPE, axis='Z'))
fin_lo = [(0.62, 0.44, 0.0, 0.85, -6.86, 0.0), (0.35, 0.36, 0.0, 0.85, -6.98, 0.0), (0.06, 0.26, 0.0, 0.85, -7.12, 0.0)]
PARTS.append(wing('fin_lo', fin_lo, PAINT, axis='Z'))
PARTS.append(K.tube_path('tailskid', K.round_path([(0, -7.05, 0.10), (0, -7.25, 0.04), (0, -7.45, 0.05)], 0.1), 0.022, METAL, seg=10))
PARTS.append(K.sphere('beacon_tail', 0.055, (0, -7.26, 1.82), LIGHT_R, 12, 8))
PARTS.append(K.sphere('beacon_tail_lens', 0.07, (0, -7.26, 1.82), LENS, 16, 8, scale=(1, 1, 0.8)))
PARTS.append(K.sphere('pos_tail', 0.04, (0, -7.32, 0.78), LIGHT_W, 10, 6))
# 尾减速器（圆筒 + 圆顶 + 输入轴整流）
PARTS.append(K.cylinder('tgb', 0.105, 0.20, (-0.16, -7.15, 1.10), DMETAL, 24, rot=(0, math.pi / 2, 0), bevel=0.02))
PARTS.append(K.sphere('tgb_dome', 0.10, (-0.06, -7.15, 1.10), DMETAL, 20, 10, scale=(0.6, 1, 1)))
PARTS.append(K.tube_path('tgb_input', [(0, -6.95, 1.0), (-0.08, -7.10, 1.08)], 0.05, DMETAL, seg=14))
PARTS.append(K.box('tr_guard_l', (0.03, 0.08, 0.30), (-0.05, -7.40, 0.55), METAL, bevel=0.01))
# 尾桨：两叶跷跷板，金属桨叶（前缘抛光）、红白警示桨尖、变距十字盘与拉杆
tr_parts = []
tr_parts.append(K.cylinder('tr_hub', 0.06, 0.14, (0, 0, 0), DMETAL, 20, rot=(0, math.pi / 2, 0)))
tr_parts.append(K.box('tr_yoke', (0.05, 0.10, 0.20), (-0.02, 0, 0), METAL, bevel=0.01))
tr_parts.append(K.cylinder('tr_teeter', 0.018, 0.12, (-0.02, 0, 0), METAL, 12, rot=(math.pi / 2, 0, 0)))
spider = K.prism('tr_spider', [(-0.11, -0.012), (0.11, -0.012), (0.11, 0.012), (-0.11, 0.012)], -0.012, 0.012, DMETAL, axis='Z')
tr_parts.append(xform(spider, Matrix.Translation((-0.12, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Rotation(math.pi / 2, 4, 'Z')))
for k in range(2):
    rk = Matrix.Rotation(math.pi * k, 4, 'X')
    # 桨叶：翼展沿 Z（从 0.12 到 0.75），厚度沿 X
    spans = [(0.10, 0.20, 8.0, 1.4, 0.0, 0.0), (0.18, 0.19, 6.0, 1.1, 0.0, 0.0), (0.45, 0.18, 3.0, 1.0, 0.0, 0.0), (0.75, 0.17, 1.0, 0.95, 0.0, 0.0)]
    b = wing(f'tr_blade{k}', spans, TR_BLADE, axis='Z')
    tr_parts.append(xform(b, rk))
    for j, (z0, z1, mat) in enumerate(((0.58, 0.635, STRIPE), (0.635, 0.69, WARN_W), (0.69, 0.75, STRIPE))):
        t = wing(f'tr_tip{k}{j}', [(z0, 0.172, 1.0, 1.02, 0, 0), (z1, 0.172, 1.0, 1.02, 0, 0)], mat, axis='Z')
        tr_parts.append(xform(t, rk))
    tr_parts.append(xform(K.cylinder(f'tr_link{k}', 0.008, 0.12, (0, 0, 0), METAL, 8), rk @ Matrix.Translation((-0.07, 0.07, 0.11)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')))
tail_rotor_mesh = K.join(tr_parts, 'tail_rotor_mesh')
tail_rotor = bpy.data.objects.new('tail_rotor', None)
bpy.context.scene.collection.objects.link(tail_rotor)
tail_rotor.location = (-0.32, -7.15, 1.1)
tail_rotor_mesh.parent = tail_rotor

# ------------------------------------------------------------------ 滑橇：拱形横管、滑管、耐磨板、踏板、地面拖车轮接头
S_HALF, S_FRONT, S_REAR, S_Z = 1.15, 1.45, -1.5, -1.32
for sx in (-1, 1):
    x = sx * S_HALF
    pts = K.round_path([(x, S_REAR - 0.25, S_Z + 0.06), (x, S_FRONT + 0.10, S_Z + 0.05), (x, S_FRONT + 0.48, S_Z + 0.20), (x, S_FRONT + 0.62, S_Z + 0.42)], 0.25)
    PARTS.append(K.tube_path(f'skid{sx}', pts, 0.042, SKID, seg=16))
    PARTS.append(K.box(f'shoe{sx}', (0.05, S_FRONT - S_REAR - 0.3, 0.012), (x, (S_FRONT + S_REAR) / 2, S_Z + 0.008), DMETAL, bevel=0.004))
    for y in (-0.6, 0.6):
        PARTS.append(K.box(f'gh_fit{sx}{y}', (0.07, 0.10, 0.06), (x - sx * 0.05, y, S_Z + 0.08), DMETAL, bevel=0.01))
for yc, arch in ((1.0, 0.36), (-1.05, 0.32)):
    pts = K.round_path([(-S_HALF, yc, S_Z + 0.07), (-1.0, yc, S_Z + 0.30), (-0.80, yc, -0.97), (0.80, yc, -0.97), (1.0, yc, S_Z + 0.30), (S_HALF, yc, S_Z + 0.07)], arch)
    PARTS.append(K.tube_path(f'cross{yc}', pts, 0.048, SKID, seg=16))
    for sx in (-1, 1):
        PARTS.append(K.box(f'mount{sx}{yc}', (0.16, 0.12, 0.09), (sx * 0.62, yc, -0.93), DMETAL, bevel=0.012))
        PARTS.append(K.torus(f'saddle{sx}{yc}', 0.052, 0.012, (sx * S_HALF, yc, S_Z + 0.06), DMETAL, 20, 6, rot=(0, math.pi / 2, 0)))
# 登机踏板（管架 + 防滑踏面）
for sx in (-1, 1):
    x = sx * 1.0
    PARTS.append(K.box(f'step{sx}', (0.24, 0.36, 0.022), (x, 0.92, -1.06), TREAD, bevel=0.004))
    for dy in (-0.14, 0.14):
        PARTS.append(K.tube_path(f'step_arm{sx}{dy}', [(x - sx * 0.10, 0.92 + dy, -1.06), (sx * 0.80, 0.92 + dy, -0.98)], 0.014, SKID, seg=10))
    for i in range(7):
        PARTS.append(K.box(f'tread{sx}{i}', (0.22, 0.012, 0.006), (x, 0.77 + i * 0.05, -1.046), DMETAL))

# ------------------------------------------------------------------ 细节：天线、空速管、外温探头、防线缆切割器、货钩、灯、加油口、舱门把手与铰链
PARTS.append(K.box('vhf_blade', (0.016, 0.16, 0.30), (0, -1.95, 1.43), DMETAL, bevel=0.006))
PARTS.append(K.tube_path('whip', K.round_path([(0, -4.2, 0.80), (0, -4.35, 1.05), (0, -4.65, 1.18)], 0.15), 0.006, DMETAL, seg=6))
PARTS.append(K.box('xpdr', (0.014, 0.10, 0.12), (0.0, -0.6, -1.0), DMETAL, bevel=0.004))
PARTS.append(K.cylinder('gps_puck', 0.06, 0.02, (0, -0.1, 1.42), PAINT, 24, bevel=0.008))
PARTS.append(K.tube_path('pitot', [(0.0, 1.62, 0.86), (0.0, 2.05, 0.88)], 0.012, METAL, seg=10))
PARTS.append(K.tube_path('pitot_mast', [(0.0, 1.62, 0.83), (0.0, 1.70, 0.88)], 0.02, PAINT, seg=10))
# 外温探头：装在座舱顶右前方的外表面上（沿表面法线伸出 6 cm）
_W, _Zt, _Zb, _e = HS.section(1.15)
_best = min(range(720), key=lambda i: abs(HS.superellipse(_W, _Zt, _Zb, _e, 1.15, 2 * math.pi * i / 720).z - 0.80) if HS.superellipse(_W, _Zt, _Zb, _e, 1.15, 2 * math.pi * i / 720).x > 0 else 9)
_p = HS.superellipse(_W, _Zt, _Zb, _e, 1.15, 2 * math.pi * _best / 720)
_n = Vector((_p.x, 0, _p.z - (_Zt + _Zb) / 2)).normalized()
PARTS.append(K.tube_path('oat', [_p - _n * 0.01, _p + _n * 0.06], 0.006, METAL, seg=6))
# 上切割器（风挡顶部）+ 风挡导流条，下切割器（机头下方）
PARTS.append(K.tube_path('wsps_up', [(0, 1.45, 0.92), (0, 1.62, 1.18)], 0.02, DMETAL, seg=8))
cut = K.prism('wsps_up_blade', [(1.52, 1.08), (1.70, 1.20), (1.72, 1.24), (1.50, 1.13)], -0.008, 0.008, METAL, axis='X')
PARTS.append(cut)
for i in range(5):
    PARTS.append(K.box(f'serr{i}', (0.012, 0.02, 0.02), (0, 1.53 + i * 0.035, 1.105 + i * 0.024), METAL))
PARTS.append(K.tube_path('wsps_lo', [(0, 2.25, -0.72), (0, 2.35, -1.05)], 0.02, DMETAL, seg=8))
PARTS.append(K.box('hook', (0.12, 0.2, 0.12), (0, -0.2, -1.0), DMETAL, bevel=0.015))
PARTS.append(K.tube_path('hook_arm', [(0, -0.30, -0.95), (0, -0.10, -1.05)], 0.018, METAL, seg=8))
PARTS.append(K.sphere('beacon_belly', 0.055, (0, -1.6, -0.72), LIGHT_R, 12, 8))
PARTS.append(K.sphere('beacon_belly_lens', 0.07, (0, -1.6, -0.72), LENS, 16, 8, scale=(1, 1, 0.8)))
# 着陆灯（机鼻下方：灯罩 + 反光碗 + 灯泡）
PARTS.append(K.cylinder('ldg_housing', 0.10, 0.06, (0, 2.12, -0.64), DMETAL, 24, rot=(math.radians(70), 0, 0)))
PARTS.append(K.sphere('landing_light', 0.075, (0, 2.15, -0.665), LIGHT_W, 16, 8, scale=(1, 0.5, 1)))
# 加油口（右侧后机身）
PARTS.append(K.cylinder('fuel_cap', 0.05, 0.012, (0.80, -1.55, -0.20), METAL, 24, rot=(0, math.pi / 2, 0)))
# 舱门把手与铰链（贴在机身外表面：用截面函数求表面点）
for side in (-1, 1):
    for (y, z, kind) in ((0.45, 0.02, 'handle'), (1.32, 0.55, 'hinge'), (1.30, -0.22, 'hinge'), (-0.90, 0.05, 'handle')):
        W, Zt, Zb, e = HS.section(y) if y > -1.32 else HS.rear_section(y)
        best, bt = None, 0.0
        for i in range(720):
            t = 2 * math.pi * i / 720
            p = HS.superellipse(W, Zt, Zb, e, y, t)
            if p.x * side <= 0:
                continue
            dd = abs(p.z - z)
            if best is None or dd < best:
                best, bt = dd, t
        p = HS.superellipse(W, Zt, Zb, e, y, bt)
        n = Vector((side, 0, 0))
        if kind == 'handle':
            PARTS.append(K.box(f'handle{side}{y}', (0.03, 0.16, 0.025), (p.x + side * 0.02, y, p.z), METAL, bevel=0.008))
            PARTS.append(K.box(f'handle_base{side}{y}', (0.01, 0.20, 0.05), (p.x + side * 0.004, y, p.z), DMETAL, bevel=0.004))
        else:
            PARTS.append(K.box(f'hinge{side}{y}{z}', (0.025, 0.06, 0.09), (p.x + side * 0.012, y, p.z), METAL, bevel=0.006))

# ------------------------------------------------------------------ 合并导出
body = K.join([p for p in PARTS], 'ext_body')
K.shade(body, 50)
roots = [body, main_rotor, tail_rotor]

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    cam = K.camera('cam', (7.5, 7.0, 3.2), (0, -1.5, 0.6), fov_deg=50)
    K.render(os.path.join(PREVIEW, 'ext.png'), cam, (1200, 800), samples=48)
    cam2 = K.camera('cam_head', (1.25, 1.05, 2.35), (0, 0, 1.70), fov_deg=45)
    K.render(os.path.join(PREVIEW, 'rotor_head.png'), cam2, (1200, 800), samples=64)
    cam3 = K.camera('cam_tail', (-1.6, -6.2, 1.5), (-0.2, -7.1, 1.05), fov_deg=45)
    K.render(os.path.join(PREVIEW, 'tail.png'), cam3, (1200, 800), samples=64)
    cam4 = K.camera('cam_side', (-2.4, -1.4, 1.6), (0, -1.2, 1.15), fov_deg=50)
    K.render(os.path.join(PREVIEW, 'cowl.png'), cam4, (1200, 800), samples=48)

objs = [body, main_rotor, rotor_hub, rotor_blades, tail_rotor, tail_rotor_mesh]
K.export_glb(OUT, objs)
print('EXPORTED', OUT)
