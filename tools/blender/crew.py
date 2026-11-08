# 【目前游戏里不用】2026-11-08 用户要求人物模型先全部撤下（之后另想办法），游戏只加载 crate.py 导出的货箱；这个脚本留作参考。
# 停机坪地勤和货箱：把 crew_sdf.py 雕好的身体、手臂减面，加上安全帽和耳罩，再做一个木货箱，导出 public/models/crew.glb。
# 运行：blender -b --factory-startup --python tools/blender/crew.py -- public/models/crew.glb art/out/crew [--preview 预览目录]
# 样子照 MOSS-Image 生成的设定图 art/src/ref/crew/sheet_s21.png。
#
# 游戏里的约定（src/render/padLife.ts 依赖）：
#   crew_body：脚在原点，脸朝 +Y（导出后是 -Z）；crew_arm_R / crew_arm_L：肩关节在原点，手臂朝下垂；crate：底面中心在原点，1.1 米见方。
#   颜色都在顶点色里，四个网格共用一种材质：一张图十几个人、几堆货也只要四次实例绘制。

import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_GLB = argv[0] if argv else 'public/models/crew.glb'
SRC = argv[1] if len(argv) > 1 else 'art/out/crew'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
MAT = K.material('crew', 0xffffff, rough=0.78)
nt = MAT.node_tree
vc = nt.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
nt.links.new(vc.outputs['Color'], nt.nodes.get('Principled BSDF').inputs['Base Color'])

HEAD_C = Vector((0.0, 0.025, 1.615))


def lin(r, g, b):
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return (f(r), f(g), f(b), 1.0)


WHITE = lin(0.90, 0.90, 0.88)
GREY = lin(0.34, 0.36, 0.40)
BLACK = lin(0.05, 0.05, 0.055)


def set_color(ob, rgba):
    me = ob.data
    ca = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', list(rgba) * len(me.vertices))
    return ob


def load_part(name, target_tris):
    d = np.load(os.path.join(SRC, name + '.npz'))
    v, q, col = d['v'], d['q'], d['col']
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.tolist(), [], q.tolist())
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(MAT)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.concatenate([col, np.ones((len(col), 1), np.float32)], 1).ravel())
    ratio = target_tris / (len(q) * 2)
    if ratio < 1:
        m = ob.modifiers.new('dec', 'DECIMATE')
        m.ratio = ratio
        m.use_collapse_triangulate = True
        K.apply_mods(ob)
    # （apply_mods 会换掉网格数据，重新取）
    ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
    return ob


def mesh_from_bm(name, bm, rgba):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(MAT)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    return set_color(ob, rgba)


def ellipsoid(name, c, r, rgba, seg=24, rings=12, zmin=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * r[0], v.co.y * r[1], v.co.z * r[2])) + Vector(c)
    if zmin is not None:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zmin), plane_no=(0, 0, 1), clear_inner=True)
    return mesh_from_bm(name, bm, rgba)


def cyl_x(name, c, r, depth, rgba, seg=20):
    """沿 X 轴的圆柱（耳罩）"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r * 0.92, depth=depth)
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((z, y, x)) + Vector(c)
    return mesh_from_bm(name, bm, rgba)


def slab(name, outline, z0, z1, rgba):
    """平面轮廓拉成薄板（帽檐）"""
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    n = len(outline)
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for i in range(n):
        bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
    return mesh_from_bm(name, bm, rgba)


# ------------------------------------------------------------------ 人
body = load_part('body', 7000)
vest = load_part('vest', 4200)
arm_R = load_part('arm_R', 1900)
arm_L = load_part('arm_L', 1900)

# 安全帽：帽顶 + 一圈帽檐，前面伸出来一块（设定图里是带帽檐的白色安全帽）
hc = HEAD_C
dome = ellipsoid('hat_dome', hc + Vector((0, -0.004, 0.030)), (0.107, 0.126, 0.100), WHITE, seg=32, rings=16, zmin=hc.z + 0.012)
# 帽顶中间一道棱
rib = ellipsoid('hat_rib', hc + Vector((0, -0.004, 0.032)), (0.016, 0.127, 0.102), WHITE, seg=16, rings=12, zmin=hc.z + 0.07)
outline = []
for i in range(48):
    a = 2 * math.pi * i / 48
    ca, sa = math.cos(a), math.sin(a)
    # 前面（+Y）伸出 6 厘米的帽檐，两边和后面只是窄窄一圈
    front = max(0.0, sa) ** 3
    rx = 0.118 + 0.012 * front
    ry = (0.136 if sa < 0 else 0.136 + 0.060 * front)
    outline.append((ca * rx, -0.004 + sa * ry))
brim = slab('hat_brim', outline, hc.z + 0.010, hc.z + 0.018, WHITE)
for v in brim.data.vertices:
    v.co.x += hc.x
    v.co.y += hc.y
    # 帽檐往前微微下垂
    if v.co.y > hc.y + 0.12:
        v.co.z -= (v.co.y - hc.y - 0.12) * 0.25
# 耳罩：灰色的罩壳 + 黑色软垫，罩壳上一根臂插进帽子侧面
muffs = []
for s in (-1, 1):
    muffs.append(cyl_x(f'muff_{s}', hc + Vector((s * 0.100, 0.012, -0.018)), 0.043, 0.036, GREY))
    muffs.append(cyl_x(f'pad_{s}', hc + Vector((s * 0.080, 0.012, -0.018)), 0.040, 0.012, BLACK))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.010, v.co.y * 0.016, v.co.z * 0.060)) + hc + Vector((s * 0.112, 0.012, 0.030))
    muffs.append(mesh_from_bm(f'muffarm_{s}', bm, BLACK))
hat = K.join([dome, rib, brim] + muffs, 'hat')
crew_body = K.join([body, vest, hat], 'crew_body')
arm_R.name = 'crew_arm_R'
arm_L.name = 'crew_arm_L'

# ------------------------------------------------------------------ 木货箱（和游戏里用的 crate.glb 同一个）
import crate as CR  # noqa: E402
crate = CR.build_crate(MAT)

for ob in (crew_body, arm_R, arm_L, crate):
    K.uv_box(ob, 1 / 0.5)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    # 摆两个姿势：手垂着、举过头顶
    def place_arms(dx, up):
        for ob, s in ((arm_R, 1), (arm_L, -1)):
            c = ob.copy()
            c.data = ob.data
            bpy.context.collection.objects.link(c)
            c.location = (dx + s * 0.205, 0, 1.42)
            c.rotation_euler = (0, -s * up, 0)
    b2 = crew_body.copy()
    bpy.context.collection.objects.link(b2)
    b2.location = (0.9, 0, 0)
    place_arms(0.0, 0.08)
    place_arms(0.9, 2.6)
    arm_R.hide_render = True
    arm_L.hide_render = True
    crate.location = (-1.4, 0.3, 0)
    K.render(os.path.join(PREVIEW, 'crew_front.png'), K.camera('c1', (0.2, 4.2, 1.3), (0.25, 0, 0.95), fov_deg=40), (1200, 900), samples=48)
    K.render(os.path.join(PREVIEW, 'crew_face.png'), K.camera('c2', (0.25, 1.1, 1.65), (0.0, 0, 1.55), fov_deg=30), (900, 900), samples=48)
    K.render(os.path.join(PREVIEW, 'crew_back.png'), K.camera('c3', (-1.0, -3.5, 1.6), (0.2, 0, 0.95), fov_deg=40), (1200, 900), samples=48)
    crate.location = (0, 0, 0)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o is not crate and o.name.startswith(('crew', 'arm')):
            o.hide_render = True

K.export_glb(OUT_GLB, [crew_body, arm_R, arm_L, crate], qpos=14, qnorm=10)
print('EXPORTED', OUT_GLB, [len(o.data.polygons) for o in (crew_body, arm_R, arm_L, crate)])
