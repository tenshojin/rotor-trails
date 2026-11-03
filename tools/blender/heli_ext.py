# RT-7 外观（座舱外壳以外的部分）：后机身、发动机/减速器整流罩、排气管、主旋翼（星形桨毂 + 三片桨叶）、
# 尾梁、平尾（带端板）、垂尾（上下）、尾桨、滑橇、天线、防线缆切割器、货钩、灯。参照 H125/AS350 的外形比例。
# 运行：blender -b --factory-startup --python tools/blender/heli_ext.py -- public/models/heli_ext.glb [--preview 目录]
#
# 节点约定（src/render/heliModel.ts 依赖）：
#   main_rotor  主旋翼（原点在桨毂，绕 Z 轴 = 游戏 y 轴转动），其下 blades 为桨叶网格
#   tail_rotor  尾桨（原点在尾桨轴，绕 X 轴转动）
# 尺寸与 src/config/flight.ts 的 HELI 一致：旋翼半径 5.3 m、桨毂高 1.75 m、尾桨 Y=-7.15 Z=1.1 半径 0.75、
# 滑橇半跨 1.15、前端 Y=1.45、后端 Y=-1.5、底面 Z=-1.32。

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import heli_shape as HS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/models/heli_ext.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
PAINT = K.material('cp_paint', 0xe9eaeb, rough=0.32, coat=0.3)
DARK = K.material('cp_paint_dark', 0x1f2a3a, rough=0.36, coat=0.3)
STRIPE = K.material('cp_paint_stripe', 0xc0281e, rough=0.34, coat=0.3)
METAL = K.material('ext_metal', 0x8a8f95, rough=0.35, metal=0.9)
DMETAL = K.material('ext_darkmetal', 0x2e3136, rough=0.45, metal=0.7)
BLADE = K.material('ext_blade', 0x25282c, rough=0.5, metal=0.2)
BLADE_TIP = K.material('ext_blade_tip', 0xe8c21c, rough=0.45)
GRILLE = K.material('ext_grille', 0x1a1b1d, rough=0.7)
EXHAUST = K.material('ext_exhaust', 0x4a4038, rough=0.55, metal=0.6)
SKID = K.material('ext_skid', 0x8c9095, rough=0.3, metal=0.85)
RUBBER = K.material('ext_rubber', 0x151515, rough=0.9)
LIGHT_R = K.material('ext_light_red', 0xff2a1a, rough=0.2, emit=0xff2010, emit_strength=1.5)
LIGHT_G = K.material('ext_light_green', 0x30ff60, rough=0.2, emit=0x20ff50, emit_strength=1.5)
LIGHT_W = K.material('ext_light_white', 0xffffff, rough=0.2, emit=0xffffff, emit_strength=1.2)

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


def loft(name, ys, point, NT=96, cap_end=True, section=None):
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
    ob = K.mesh_obj(name, verts, faces, PAINT)
    K.fix_normals(ob)
    K.shade(ob, 55)
    return ob


# ------------------------------------------------------------------ 后机身
ys = [-1.32 - 0.05 * i for i in range(31)]
rear = loft('rear', ys, HS.rear_point, NT=160, section=HS.rear_section)
livery(rear)
PARTS.append(rear)

# 尾梁（圆锥管，略上翘）
nb = 40
ys = [HS.BOOM_Y0 + (HS.BOOM_Y1 - HS.BOOM_Y0) * i / nb for i in range(nb + 1)]


def boom_point(y, t):
    k = (y - HS.BOOM_Y0) / (HS.BOOM_Y1 - HS.BOOM_Y0)
    r = HS.BOOM_R0 + (HS.BOOM_R1 - HS.BOOM_R0) * k
    zc = HS.BOOM_Z0 + (HS.BOOM_Z1 - HS.BOOM_Z0) * k
    return Vector((r * math.cos(t), y, zc + r * math.sin(t)))


boom = loft('boom', ys, boom_point, NT=40)
# 尾梁：上半白色、下半深灰蓝，侧面红色细线
me = boom.data
me.materials.clear()
for m in LIVERY:
    me.materials.append(m)
for p in me.polygons:
    k = (p.center.y - HS.BOOM_Y0) / (HS.BOOM_Y1 - HS.BOOM_Y0)
    zc = HS.BOOM_Z0 + (HS.BOOM_Z1 - HS.BOOM_Z0) * k
    dz = p.center.z - zc
    p.material_index = 1 if dz < -0.06 else (2 if dz < 0.0 else 0)
PARTS.append(boom)

# ------------------------------------------------------------------ 发动机/减速器整流罩（座舱顶部后方）


def cowl_point(y, t):
    # y：0.55（前端）→ -2.75（后端）
    k = (0.55 - y) / 3.3
    W = 0.30 + 0.28 * math.sin(math.pi * min(1.0, k * 1.15)) ** 0.6
    top = 1.18 + 0.32 * math.sin(math.pi * min(1.0, k * 1.05)) ** 0.5
    bot = 0.86 - 0.05 * k
    W = max(0.08, W * (1 - max(0.0, k - 0.9) * 6))
    return HS.superellipse(W, top, bot, 2.6, y, t)


ys = [0.55 - 3.3 * i / 60 for i in range(61)]
cowl = loft('cowl', ys, cowl_point, NT=48)
K.shade(cowl, 60)
PARTS.append(cowl)
# 进气格栅（两侧）、排气管（右后方，向后上方）
for sx in (-1, 1):
    g = K.box('intake', (0.04, 0.55, 0.22), (sx * 0.56, -0.75, 1.15), GRILLE)
    PARTS.append(g)
ex = K.tube_path('exhaust', K.round_path([(0.28, -2.2, 1.18), (0.36, -2.65, 1.26), (0.38, -2.85, 1.42)], 0.2), 0.13, EXHAUST, seg=16)
PARTS.append(ex)
# 减速器整流罩与主轴
PARTS.append(K.cylinder('mast_fair', 0.32, 0.25, (0, 0, 1.42), PAINT, 24, r2=0.2))
PARTS.append(K.cylinder('mast', 0.09, 0.4, (0, 0, 1.57), DMETAL, 16))

# ------------------------------------------------------------------ 主旋翼（星形桨毂 + 三片桨叶）
rotor_parts = []
rotor_parts.append(K.cylinder('hub', 0.2, 0.16, (0, 0, 0), DMETAL, 24))
blades = []
R = 5.3
for k in range(3):
    a = 2 * math.pi * k / 3
    rot = Matrix.Rotation(a, 4, 'Z')
    # 星形臂 + 桨叶根部套筒
    arm = K.box(f'arm{k}', (0.6, 0.14, 0.06), (0.42, 0, 0), DMETAL)
    K.bake_transform(arm)
    arm.data.transform(rot)
    rotor_parts.append(arm)
    sleeve = K.cylinder(f'sleeve{k}', 0.06, 0.6, (0, 0, 0), METAL, 12, rot=(0, math.pi / 2, 0))
    K.bake_transform(sleeve)
    sleeve.data.transform(Matrix.Translation((0.9, 0, 0)))
    sleeve.data.transform(rot)
    rotor_parts.append(sleeve)
    # 桨叶：翼型截面（前缘圆、后缘尖），弦长 0.35 m，带少量扭转
    n = 24
    verts, faces = [], []
    prof = [(0.0, 0.0), (0.02, 0.018), (0.08, 0.03), (0.2, 0.034), (0.45, 0.024), (0.75, 0.01), (1.0, 0.0), (0.75, -0.006), (0.45, -0.012), (0.2, -0.016), (0.08, -0.016), (0.02, -0.01)]
    for i in range(n + 1):
        r = 1.15 + (R - 1.15) * i / n
        tw = math.radians(8 - 10 * i / n)
        c = 0.35
        for (u, v) in prof:
            x = (u - 0.25) * c
            z = v * c
            xr = x * math.cos(tw) - z * math.sin(tw)
            zr = x * math.sin(tw) + z * math.cos(tw)
            verts.append((r, -xr, zr))
    m = len(prof)
    for i in range(n):
        for j in range(m):
            j2 = (j + 1) % m
            faces.append((i * m + j, i * m + j2, (i + 1) * m + j2, (i + 1) * m + j))
    faces.append(tuple(range(m - 1, -1, -1)))
    faces.append(tuple(n * m + j for j in range(m)))
    bl = K.mesh_obj(f'blade{k}', verts, faces, BLADE)
    K.fix_normals(bl)
    K.shade(bl, 40)
    bl.data.transform(rot)
    blades.append(bl)
    # 桨尖黄色警示带
    tip = K.box(f'tip{k}', (0.25, 0.36, 0.05), (R - 0.15, 0, 0.002), BLADE_TIP)
    K.bake_transform(tip)
    tip.data.transform(rot)
    blades.append(tip)
rotor_hub = K.join(rotor_parts, 'main_rotor_hub')
rotor_blades = K.join(blades, 'blades')
main_rotor = bpy.data.objects.new('main_rotor', None)
bpy.context.scene.collection.objects.link(main_rotor)
main_rotor.location = (0, 0, 1.75)
for o in (rotor_hub, rotor_blades):
    o.parent = main_rotor

# ------------------------------------------------------------------ 平尾、垂尾、尾桨
st = K.box('stab', (2.2, 0.5, 0.06), (0, -5.55, 0.66), PAINT)
K.add_bevel(st, 0.02, 2)
PARTS.append(st)
for sx in (-1, 1):
    ep = K.box('endplate', (0.05, 0.45, 0.5), (sx * 1.1, -5.6, 0.72), STRIPE)
    K.add_bevel(ep, 0.015, 2)
    PARTS.append(ep)
    PARTS.append(K.sphere('nav', 0.05, (sx * 1.13, -5.4, 0.66), LIGHT_G if sx > 0 else LIGHT_R, 10, 6))
# 上垂尾（后掠）与下垂尾（带尾撬）
fin_up = [(-6.55, 0.78), (-6.95, 0.80), (-7.35, 1.75), (-7.05, 1.78)]
fin_lo = [(-6.65, 0.62), (-7.0, 0.62), (-7.25, 0.05), (-7.05, 0.04)]
for nm, poly, m in (('fin_up', fin_up, STRIPE), ('fin_lo', fin_lo, PAINT)):
    fv = [(-0.04, y, z) for y, z in poly] + [(0.04, y, z) for y, z in poly]
    f = K.mesh_obj(nm, fv, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], m)
    K.fix_normals(f)
    PARTS.append(f)
PARTS.append(K.tube_path('tailskid', [(0, -7.12, 0.08), (0, -7.4, 0.02)], 0.025, METAL, seg=8))
PARTS.append(K.sphere('beacon_tail', 0.06, (0, -7.12, 1.82), LIGHT_R, 10, 6))
PARTS.append(K.sphere('pos_tail', 0.05, (0, -7.08, 0.78), LIGHT_W, 10, 6))
# 尾桨减速器
PARTS.append(K.cylinder('tr_gear', 0.11, 0.22, (-0.12, -7.15, 1.1), DMETAL, 16, rot=(0, math.pi / 2, 0)))
tr_parts = []
tr_parts.append(K.cylinder('tr_hub', 0.07, 0.12, (0, 0, 0), DMETAL, 12, rot=(0, math.pi / 2, 0)))
for k in range(2):
    b = K.box(f'tr_blade{k}', (0.02, 0.14, 0.72), (0, 0, 0.42), BLADE)
    K.bake_transform(b)
    b.data.transform(Matrix.Rotation(math.pi * k, 4, 'X'))
    tr_parts.append(b)
    t = K.box(f'tr_tip{k}', (0.022, 0.142, 0.1), (0, 0, 0.72), BLADE_TIP)
    K.bake_transform(t)
    t.data.transform(Matrix.Rotation(math.pi * k, 4, 'X'))
    tr_parts.append(t)
tail_rotor_mesh = K.join(tr_parts, 'tail_rotor_mesh')
tail_rotor = bpy.data.objects.new('tail_rotor', None)
bpy.context.scene.collection.objects.link(tail_rotor)
tail_rotor.location = (-0.32, -7.15, 1.1)
tail_rotor_mesh.parent = tail_rotor

# ------------------------------------------------------------------ 滑橇
S_HALF, S_FRONT, S_REAR, S_Z = 1.15, 1.45, -1.5, -1.32
for sx in (-1, 1):
    x = sx * S_HALF
    pts = K.round_path([(x, S_REAR - 0.25, S_Z + 0.05), (x, S_FRONT + 0.15, S_Z + 0.05), (x, S_FRONT + 0.55, S_Z + 0.32)], 0.3)
    PARTS.append(K.tube_path(f'skid{sx}', pts, 0.045, SKID, seg=12))
    PARTS.append(K.tube_path(f'shoe{sx}', [(x, S_REAR, S_Z + 0.005), (x, S_FRONT, S_Z + 0.005)], 0.03, DMETAL, seg=8))
for y in (1.0, -1.05):
    # 拱形横管：从机腹两侧弯到滑橇
    pts = K.round_path([(-S_HALF, y, S_Z + 0.08), (-0.95, y, -0.95), (0.95, y, -0.95), (S_HALF, y, S_Z + 0.08)], 0.35)
    PARTS.append(K.tube_path(f'cross{y}', pts, 0.05, SKID, seg=12))
    for sx in (-1, 1):
        PARTS.append(K.box('mount', (0.16, 0.12, 0.1), (sx * 0.62, y, -0.93), DMETAL))
# 登机踏板
for sx in (-1, 1):
    PARTS.append(K.box('step', (0.25, 0.38, 0.03), (sx * 1.02, 0.95, -1.06), DMETAL))

# ------------------------------------------------------------------ 细节：天线、空速管、防线缆切割器、货钩、灯
PARTS.append(K.box('antenna1', (0.02, 0.18, 0.32), (0, -1.9, 1.38), DMETAL))
PARTS.append(K.box('antenna2', (0.02, 0.14, 0.25), (0, -0.6, -1.0), DMETAL))
PARTS.append(K.tube_path('pitot', [(0.0, 1.62, 0.86), (0.0, 2.05, 0.88)], 0.012, METAL, seg=8))
# 上切割器（风挡顶部前方）与下切割器（机头下方）
PARTS.append(K.tube_path('wsps_up', [(0, 1.45, 0.92), (0, 1.62, 1.18)], 0.02, DMETAL, seg=6))
PARTS.append(K.box('wsps_up_blade', (0.02, 0.18, 0.06), (0, 1.62, 1.2), METAL))
PARTS.append(K.tube_path('wsps_lo', [(0, 2.25, -0.72), (0, 2.35, -1.05)], 0.02, DMETAL, seg=6))
PARTS.append(K.box('hook', (0.12, 0.2, 0.12), (0, -0.2, -1.0), DMETAL))
PARTS.append(K.sphere('beacon_belly', 0.06, (0, -1.6, -0.72), LIGHT_R, 10, 6))
PARTS.append(K.sphere('landing_light', 0.09, (0, 2.1, -0.66), LIGHT_W, 12, 6))

# ------------------------------------------------------------------ 合并导出
body = K.join([p for p in PARTS], 'ext_body')
K.shade(body, 50)
roots = [body, main_rotor, tail_rotor]

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    cam = K.camera('cam', (7.5, 7.0, 3.2), (0, -1.5, 0.6), fov_deg=50)
    K.render(os.path.join(PREVIEW, 'ext.png'), cam, (1200, 800), samples=48)

objs = [body, main_rotor, rotor_hub, rotor_blades, tail_rotor, tail_rotor_mesh]
K.export_glb(OUT, objs)
print('EXPORTED', OUT)
