# 【目前游戏里不用】2026-11-08 用户要求人物模型先全部撤下（之后另想办法），public/models 里已经没有这个模型；脚本留作参考。
# 飞行员的身体：把 pilot_sdf.py 雕好的网格减面、绑骨骼、上材质，导出 public/models/pilot.glb。
# 运行：blender -b --factory-startup --python tools/blender/pilot.py -- public/models/pilot.glb art/out/pilot [--preview 预览目录 驾驶舱.glb]
#
# 游戏里的约定（src/render/pilot.ts 依赖这些名字）：骨头 pelvis、spine、upper_R、fore_R、hand_R、index1_R…、thigh_R、shin_R、foot_R，L 同理。

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import pilot_gear as PG  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_GLB = argv[0] if argv else 'public/models/pilot.glb'
SRC = argv[1] if len(argv) > 1 else 'art/out/pilot'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
COCKPIT = argv[argv.index('--preview') + 2] if '--preview' in argv and len(argv) > argv.index('--preview') + 2 else None

K.reset()
tx = 'art/out/tex/'
fabric = dict(normal=tx + 'suit_nor_gl_1024.jpg', rough_tex=tx + 'suit_rough_1024.jpg', normal_strength=0.8)
leather = dict(normal=tx + 'grain_nor_gl_1024.jpg', rough_tex=tx + 'leather_rough_1024.jpg', normal_strength=0.55)
# 颜色照 MOSS-Image 生成的设定图（art/src/ref/pilot/sheet_s11.png、sheet_s33.png、helmet_s5.png）取的色。
# 名字以 plh_ 开头的材质只在头上：第一人称时摄像机在头里面，游戏里按这个前缀把它们藏起来。
M = {
    # 飞行服：灰绿色阻燃布（pilot_textures.py 把布纹重新上色）
    'suit': K.material('pl_suit', 0xffffff, rough=1.0, tex=tx + 'pilot_suit_diffuse_1024.jpg', **fabric),
    # 手套：手背棕褐色阻燃布，手心深棕软皮。颜色在顶点色里（分界线是渐变的，减面也不会变成锯齿）
    'glove': K.material('pl_glove', 0x808080, rough=0.52, normal=tx + 'grain_nor_gl_1024.jpg', normal_strength=0.75),
    # 黑色网眼背心和胸袋
    'vest': K.material('pl_vest', 0x808080, rough=0.82, tex=tx + 'seatmesh_diffuse_1024.jpg', normal=tx + 'seatmesh_nor_gl_1024.jpg', normal_strength=0.9),
    # 领口里的 T 恤
    'tee': K.material('pl_tee', 0x34373a, rough=0.95, normal=tx + 'suit_nor_gl_1024.jpg', normal_strength=0.4),
    'boot': K.material('pl_boot', 0x5a3424, rough=0.38, **leather),
    'sole': K.material('pl_sole', 0x15120f, rough=0.85),
    'strap': K.material('pl_strap', 0x1d1e20, rough=0.85),
    'metal': K.material('pl_metal', 0x9a9ea3, rough=0.32, metal=1.0),
    'watch': K.material('pl_watch', 0x101012, rough=0.35),
    'dial': K.material('pl_dial', 0x24282c, rough=0.25),
    # 护膝板：黑色硬板，上面夹一张检查单
    'pl_kneeboard': K.material('pl_kneeboard', 0x18191b, rough=0.6),
    'pl_paper': K.material('pl_paper', 0xffffff, rough=0.9, tex=tx + 'kneeboard_paper.png'),
    # 头上的：脸（颜色在顶点色里）、白色亮面头盔、黑色罩壳、烟色面罩、橡胶包边、麦克风海绵
    'skin': K.material('plh_skin', 0xffffff, rough=0.52),
    'plh_shell': K.material('plh_shell', 0xedeeec, rough=0.20, coat=0.6),
    'plh_black': K.material('plh_black', 0x18181a, rough=0.48),
    'plh_visor': K.material('plh_visor', 0x060708, rough=0.04, coat=1.0),
    'plh_rubber': K.material('plh_rubber', 0x111111, rough=0.85),
    'plh_foam': K.material('plh_foam', 0x141414, rough=1.0),
    'plh_metal': K.material('plh_metal', 0x9a9ea3, rough=0.3, metal=1.0),
}

with open(os.path.join(SRC, 'skeleton.json'), encoding='utf-8') as f:
    SK = json.load(f)

# ------------------------------------------------------------------ 骨架
arm_data = bpy.data.armatures.new('pilot_rig')
rig = bpy.data.objects.new('pilot_rig', arm_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for name, b in SK.items():
    e = arm_data.edit_bones.new(name)
    e.head = Vector(b['head'])
    e.tail = Vector(b['tail'])
    eb[name] = e
for name, b in SK.items():
    if b['parent']:
        eb[name].parent = eb[b['parent']]
bpy.ops.object.mode_set(mode='OBJECT')
rig.select_set(False)

TARGET = {'hand': 16000, 'arm': 26000, 'torso': 42000, 'leg': 28000, 'boot': 7000, 'head': 16000}


def use_vertex_color(mat):
    """让材质用顶点色当底色：导出时才会把顶点色写进 glTF"""
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    a = nt.nodes.new('ShaderNodeVertexColor')
    a.layer_name = 'Col'
    nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])


use_vertex_color(M['glove'])
use_vertex_color(M['skin'])


def load_part(name):
    d = np.load(os.path.join(SRC, name + '.npz'))
    v, q, zone = d['v'], d['q'], d['zone']
    bones = [str(x) for x in d['bones']]
    mats = [str(x) for x in d['mats']]
    idx, wt = d['idx'], d['wt']
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.tolist(), [], q.tolist())
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        me.materials.append(M[m])
    # 面的材质：取四个顶点里最多的分区
    z = zone[q]
    best = np.apply_along_axis(lambda r: np.bincount(r, minlength=4).argmax(), 1, z) if len(mats) > 1 else np.zeros(len(q), int)
    me.polygons.foreach_set('material_index', best.astype(np.int32))
    me.update()
    col = d['col']
    if len(col):
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        rgba = np.concatenate([col, np.ones((len(col), 1), np.float32)], 1)
        ca.data.foreach_set('color', rgba.ravel())
    groups = [ob.vertex_groups.new(name=n) for n in bones]
    # 按骨头、按权重分批写入，比一个一个顶点快得多
    for slot in range(idx.shape[1]):
        for bi, g in enumerate(groups):
            sel = np.nonzero((idx[:, slot] == bi) & (wt[:, slot] > 0))[0]
            if not len(sel):
                continue
            ws = np.round(wt[sel, slot] * 64) / 64
            for w in np.unique(ws):
                if w > 0:
                    g.add(sel[ws == w].tolist(), float(w), 'ADD')
    # 减面：保留骨骼权重和材质边界
    kind = name.split('_')[0]
    ratio = TARGET[kind] / (len(q) * 2)
    if ratio < 1:
        dec = ob.modifiers.new('dec', 'DECIMATE')
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=dec.name)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    K.uv_box(ob, 1 / 0.15)
    return ob


PARTS = [load_part(n) for n in ('hand_R', 'hand_L', 'arm_R', 'arm_L', 'torso', 'leg_R', 'leg_L', 'boot_R', 'boot_L', 'head')]


def skin_all(ob, bone):
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    return ob


def strip(name, pts, width, thick, mat, bone):
    """安全带：沿路径的一条扁带"""
    pts = [Vector(p) for p in pts]
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, -1, 0.25))).normalized() * (width / 2)
        nrm = t.cross(side).normalized() * thick
        for s in (side, -side):
            verts.append(p + s)
            verts.append(p + s + nrm)
    n = len(pts)
    for i in range(n - 1):
        a, b = i * 4, (i + 1) * 4
        faces += [(a, b, b + 2, a + 2), (a + 1, a + 3, b + 3, b + 1), (a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3)]
    ob = K.mesh_obj(name, verts, faces, M[mat], smooth=30)
    K.fix_normals(ob)
    return skin_all(ob, bone)


X0 = 0.45
for sx, nm in ((1, 'R'), (-1, 'L')):
    pts = K.round_path([(X0 + sx * 0.082, 0.81, 0.284), (X0 + sx * 0.086, 0.90, 0.286), (X0 + sx * 0.088, 0.995, 0.236), (X0 + sx * 0.086, 1.058, 0.10), (X0 + sx * 0.070, 1.066, -0.05), (X0 + sx * 0.030, 1.080, -0.195)], 0.05, 5)
    PARTS.append(strip(f'sh_{nm}', pts, 0.048, 0.0035, 'strap', 'spine'))
    lp = K.round_path([(X0 + sx * 0.190, 0.985, -0.262), (X0 + sx * 0.155, 1.058, -0.238), (X0 + sx * 0.075, 1.086, -0.222), (X0 + sx * 0.030, 1.090, -0.212)], 0.04, 4)
    PARTS.append(strip(f'lap_{nm}', lp, 0.048, 0.0035, 'strap', 'pelvis'))
    # 肩带上的调节扣
    ad = K.box(f'adj_{nm}', (0.056, 0.012, 0.03), (X0 + sx * 0.086, 1.046, 0.03), M['metal'], bevel=0.003)
    K.apply_mods(ad)
    PARTS.append(skin_all(ad, 'spine'))
# 旋转式快卸锁扣
bk = K.cylinder('buckle', 0.042, 0.014, (X0, 1.094, -0.206), M['metal'], 32, bevel=0.004, rot=(math.radians(100), 0, 0))
K.apply_mods(bk)
K.bake_transform(bk)
PARTS.append(skin_all(bk, 'pelvis'))
kb = K.cylinder('buckle_knob', 0.022, 0.012, (X0, 1.104, -0.204), M['watch'], 24, bevel=0.002, rot=(math.radians(100), 0, 0))
K.apply_mods(kb)
K.bake_transform(kb)
PARTS.append(skin_all(kb, 'pelvis'))

# 左手腕上的表：贴在小臂末端外侧，跟着小臂走
fa = Vector(SK['fore_L']['head'])
fb = Vector(SK['fore_L']['tail'])
ax = (fb - fa).normalized()
wc = fb - ax * 0.055
outward = ax.cross(Vector((0, 0, 1))).normalized()
top = outward.cross(ax).normalized()
if top.z < 0:
    top = -top
n = top
wpos = wc + n * 0.040
rot = n.to_track_quat('Z', 'Y').to_euler()
case = K.cylinder('watch_case', 0.0205, 0.009, tuple(wpos), M['watch'], 28, bevel=0.0018, rot=tuple(rot))
K.apply_mods(case)
K.bake_transform(case)
PARTS.append(skin_all(case, 'fore_L'))
dial = K.cylinder('watch_dial', 0.0165, 0.0012, tuple(wpos + n * 0.0048), M['dial'], 28, rot=tuple(rot))
K.bake_transform(dial)
PARTS.append(skin_all(dial, 'fore_L'))
band = K.torus('watch_band', 0.041, 0.0028, tuple(wc), M['watch'], 40, 6)
K.bake_transform(band)
band.data.transform(band.matrix_world.inverted())
band.matrix_world = band.matrix_world.Identity(4)
bm = bmesh.new()
bm.from_mesh(band.data)
for v in bm.verts:
    p = v.co
    # 扁一点，贴着手腕
    v.co = wc + outward * (p.x * 0.86) + n * (p.y * 0.78) + ax * (p.z * 3.2)
bm.to_mesh(band.data)
bm.free()
K.fix_normals(band)
PARTS.append(skin_all(band, 'fore_L'))

# 头盔（在 Blender 里建）跟着头；护膝板跟着右大腿；背心和腰带的扣子跟着上身
for ob in PG.build_helmet(M):
    PARTS.append(skin_all(ob, 'head'))
for ob in PG.build_kneeboard(M, SK['thigh_R']['head'], SK['thigh_R']['tail']):
    PARTS.append(skin_all(ob, 'thigh_R'))
for ob in PG.build_vest_hardware(M):
    PARTS.append(skin_all(ob, 'spine'))

for ob in PARTS:
    if ob.data.uv_layers.get('UVMap') is None:
        K.uv_box(ob, 1 / 0.15)
    mod = ob.modifiers.new('rig', 'ARMATURE')
    mod.object = rig
    ob.parent = rig

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    if COCKPIT:
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(COCKPIT))
    K.world_sky(1.0, sun_dir=(0.55, -0.35, 0.75), sun_strength=4.5)
    # 第一人称的几张：和游戏里一样，头上的东西不显示（摄像机在头里面）
    headobs = [o for o in PARTS if o.data.materials and o.data.materials[0].name.startswith('plh_')]
    for o in headobs:
        o.hide_render = True
    eye = Vector((0.45, 1.0, 0.42))
    K.render(os.path.join(PREVIEW, 'p_eye.png'), K.camera('c1', eye, eye + Vector((-0.08, 0.62, -0.78)), fov_deg=78), (1280, 720), samples=48)
    K.render(os.path.join(PREVIEW, 'p_hand.png'), K.camera('c2', (0.82, 1.15, 0.25), (0.45, 1.30, -0.12), fov_deg=38), (1000, 750), samples=48, exposure=0.5)
    K.render(os.path.join(PREVIEW, 'p_left.png'), K.camera('c3', (-0.25, 1.05, 0.12), (0.26, 1.15, -0.32), fov_deg=38), (1000, 750), samples=48, exposure=0.5)
    for o in headobs:
        o.hide_render = False
    K.render(os.path.join(PREVIEW, 'p_side.png'), K.camera('c4', (2.1, 1.05, 0.05), (0.45, 1.1, -0.2), fov_deg=45), (1000, 750), samples=32, exposure=0.8)
    # 从外面看：脸和头盔的正面、四分之三侧面，全身
    hc = PG.HEAD_C
    K.render(os.path.join(PREVIEW, 'p_face.png'), K.camera('c5', hc + Vector((-0.10, 0.62, 0.02)), hc + Vector((0, 0.04, -0.03)), fov_deg=30), (900, 900), samples=64)
    K.render(os.path.join(PREVIEW, 'p_face34.png'), K.camera('c6', hc + Vector((-0.46, 0.44, 0.08)), hc + Vector((0, 0.03, -0.03)), fov_deg=30), (900, 900), samples=64)
    K.render(os.path.join(PREVIEW, 'p_body.png'), K.camera('c7', (-0.45, 2.7, 0.35), (0.45, 1.05, -0.08), fov_deg=40), (1000, 1000), samples=48)

objs = [rig] + PARTS
K.export_glb(OUT_GLB, objs, qpos=14, qnorm=10)
print('EXPORTED', OUT_GLB, 'parts', len(PARTS))
