# 建筑建模工具包（Blender 后台脚本共用）：带照片材质的部件、按真实尺寸展开的 UV、
# 四坡/两坡屋顶（瓦面顺坡方向、屋脊、檐口瓦当）、窗、门、格栅，以及按材质合并后导出为“模型”节点。
#
# 坐标：Blender X 右、Y 前（= 游戏局部 -z，门所在的一面）、Z 上；模型原点 = 地面中心。
# 导出：每个模型是一个空物体（名字 = 模型名），子网格按材质合并，名字为“模型名__材质名”。

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

import bkit as K

TEX = 'art/out/tex'

# 材质：名字 → (漫反射贴图, 法线/粗糙度来源, 一个平铺单元的尺寸（米）, 粗糙度系数, 金属度)
MATS = {
    'kawara': ('kawara', 'grey_roof_tiles', 1.6, 1.0, 0.0),
    'claytile': ('clay_roof_tiles', 'clay_roof_tiles', 2.0, 1.0, 0.0),
    'iron': ('corrugated_iron', 'corrugated_iron', 1.2, 0.8, 0.6),
    'rust': ('rusty_metal_02', 'rusty_metal_02', 1.5, 1.0, 0.4),
    'yakisugi': ('yakisugi', 'japanese_cedar_planks', 1.2, 1.0, 0.0),
    'cedar': ('cedar_brown', 'japanese_cedar_planks', 1.2, 1.0, 0.0),
    'hinoki': ('hinoki_planks', 'hinoki_planks', 1.9, 1.0, 0.0),
    'plaster': ('plaster_white', 'white_plaster_02', 1.5, 1.0, 0.0),
    'plaster_cream': ('plaster_cream', 'clay_plaster', 2.0, 1.0, 0.0),
    'clay': ('clay_plaster', 'clay_plaster', 2.0, 1.0, 0.0),
    'stonewall': ('rabdentse_ruins_wall', 'rabdentse_ruins_wall', 2.0, 1.0, 0.0),
    'falu': ('falu_red', 'distressed_painted_planks', 1.6, 1.0, 0.0),
    'whiteplank': ('white_planks', 'distressed_painted_planks', 1.6, 1.0, 0.0),
    'ochreplank': ('ochre_planks', 'distressed_painted_planks', 1.6, 1.0, 0.0),
    'concrete': ('concrete_wall_008', 'concrete_wall_008', 2.7, 1.0, 0.0),
    'padconcrete': ('hangar_concrete_floor', 'hangar_concrete_floor', 2.0, 1.0, 0.0),
    'diamond': ('metal_plate', 'metal_plate', 0.5, 1.0, 0.7),
    'thatch': ('thatch_roof_angled', 'thatch_roof_angled', 1.1, 1.0, 0.0),
    'thatch_warm': ('thatch_warm', 'thatch_roof_angled', 1.1, 1.0, 0.0),
    'bark': ('pine_bark', 'pine_bark', 2.0, 1.0, 0.0),
    # 峡湾 / 喜马拉雅 / 亚马孙 / 峡谷（颜色变体见 tex_variants.py）
    'yellowplank': ('yellow_planks', 'distressed_painted_planks', 1.6, 1.0, 0.0),
    'blueplank': ('bluegrey_planks', 'distressed_painted_planks', 1.6, 1.0, 0.0),
    'tarplank': ('tar_planks', 'japanese_cedar_planks', 1.2, 1.0, 0.0),
    'rawplank': ('raw_planks', 'japanese_cedar_planks', 1.2, 1.0, 0.0),
    'greyplank': ('grey_planks', 'japanese_cedar_planks', 1.2, 1.0, 0.0),
    'blacktile': ('black_tiles', 'grey_roof_tiles', 1.6, 0.7, 0.0),
    'shingle': ('tar_shingles', 'tar_shingles', 1.1, 1.0, 0.0),
    'turf': ('aerial_grass_rock', 'aerial_grass_rock', 2.5, 1.0, 0.0),
    'corr_blue': ('corr_blue', 'corrugated_iron', 1.2, 0.8, 0.4),
    'corr_green': ('corr_green', 'corrugated_iron', 1.2, 0.8, 0.4),
    'corr_red': ('corr_red', 'corrugated_iron', 1.2, 0.8, 0.4),
    'corr_white': ('corr_white', 'corrugated_iron', 1.2, 0.8, 0.4),
    'stone_white': ('stone_whitewash', 'rabdentse_ruins_wall', 2.0, 1.0, 0.0),
    'adobe': ('adobe_tan', 'clay_plaster', 2.0, 1.0, 0.0),
    'adobe_light': ('adobe_light', 'clay_plaster', 2.0, 1.0, 0.0),
    'maroon': ('plaster_maroon', 'clay_plaster', 2.0, 1.0, 0.0),
    'brick': ('red_sandstone_wall', 'red_sandstone_wall', 2.0, 1.0, 0.0),
    # 日本民居（jtex.py / tex_variants.py 生成）
    'kawara_flat': ('kawara_flat', 'kawara_flat', 4.8, 1.0, 0.15),
    'granite': ('granite', 'concrete_wall_008', 1.0, 1.0, 0.0),
    'sugi': ('sugi_weathered', 'japanese_cedar_planks', 1.2, 1.0, 0.0),
}
TILE = {}

_mats = {}


def mat(name):
    """照片材质（漫反射 + 法线 + 粗糙度）。"""
    if name in _mats:
        return _mats[name]
    diff, base, tile, rmul, metal = MATS[name]
    m = K.material('b_' + name, 0x808080, rough=1.0, metal=metal,
                   tex=f'{TEX}/{diff}_diffuse_1024.jpg',
                   normal=f'{TEX}/{base}_nor_gl_1024.jpg',
                   rough_tex=f'{TEX}/{base}_rough_1024.jpg')
    TILE['b_' + name] = tile
    _mats[name] = m
    return m


def flat(name, color, rough=0.6, metal=0.0, emit=None, alpha=None, emit_strength=1.0):
    """纯色材质（窗框、玻璃、金属件等不需要贴图的部件）。"""
    key = 'f_' + name
    if key in _mats:
        return _mats[key]
    m = K.material(key, color, rough=rough, metal=metal, emit=emit, alpha=alpha, emit_strength=emit_strength)
    _mats[key] = m
    return m


def tile_of(ob):
    m = ob.data.materials[0] if ob.data.materials else None
    return TILE.get(m.name, 1.0) if m else 1.0


def uv_world(ob, tile=None):
    """按真实尺寸的三向投影 UV（一个平铺单元 = tile 米）。"""
    K.bake_transform(ob)
    return K.uv_box(ob, 1.0 / (tile or tile_of(ob)))


def bx(name, size, center, m, rz=0.0, bevel=0.0, uv=True):
    ob = K.box(name, size, center, m, rot=(0, 0, rz))
    if bevel:
        K.add_bevel(ob, bevel, 2)
        K.apply_mods(ob)
    K.bake_transform(ob)
    if uv:
        uv_world(ob)
    return ob


def cyl(name, r, h, center, m, verts=16, r2=None, rot=(0, 0, 0), uv=True, cap=True):
    ob = K.cylinder(name, r, h, center, m, verts, r2=r2, rot=rot, cap=cap)
    K.bake_transform(ob)
    if uv:
        uv_world(ob)
    return ob


def poly_uv(ob, origin, u_axis, v_axis, tile):
    """平面投影 UV（屋面：u 沿檐口、v 沿坡向）。"""
    o, ua, va = Vector(origin), Vector(u_axis).normalized(), Vector(v_axis).normalized()
    return K.uv_from_fn(ob, lambda co, n: ((co - o).dot(ua) / tile, (co - o).dot(va) / tile))


def roof_hip(name, w, d, h, ov, ridge, thick, m, z0, cx=0.0, cy=0.0, droop=0.0):
    """四坡屋顶：w 沿 X，d 沿 Y，h 屋脊高（从墙顶算），ov 出檐，ridge 屋脊长度占比（0 = 攒尖）。
    droop：檐口相对墙顶下垂（出檐部分按坡度延伸）。返回（屋面物体列表, 屋脊/斜脊线段, 檐口折线）。"""
    hw, hd = w / 2 + ov, d / 2 + ov
    rw = (w / 2) * ridge
    slope = h / (d / 2)
    ze = z0 - ov * slope * (1 - droop)  # 出檐部分的檐口高度
    A = Vector((cx - hw, cy - hd, ze))
    B = Vector((cx + hw, cy - hd, ze))
    C = Vector((cx + hw, cy + hd, ze))
    D = Vector((cx - hw, cy + hd, ze))
    R1 = Vector((cx - rw, cy, z0 + h))
    R2 = Vector((cx + rw, cy, z0 + h))
    tile = TILE.get(m.name, 1.6) if m else 1.6
    faces = []
    T = Vector((0, 0, thick))
    # 前后两坡（梯形）与左右两坡（三角形）；每个面单独成物体，便于各自展开顺坡 UV
    quads = [('S', [A, B, R2, R1], B - A), ('N', [C, D, R1, R2], D - C)]
    tris = [('E', [B, C, R2], C - B), ('W', [D, A, R1], A - D)]
    objs = []
    for tag, pts, eave in quads + tris:
        n = len(pts)
        top = [p + T for p in pts]
        verts = pts + top
        f = [tuple(range(n)), tuple(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            f.append((i, j, n + j, n + i))
        ob = K.mesh_obj(f'{name}_{tag}', verts, f, m, smooth=0)
        K.fix_normals(ob)
        # 坡向：从檐口中点指向屋脊
        mid_e = (pts[0] + pts[1]) / 2
        apex = pts[2] if n == 3 else (pts[2] + pts[3]) / 2
        sv = (apex - mid_e)
        poly_uv(ob, pts[0], eave, sv, tile)
        objs.append(ob)
    lines = [(R1, R2), (A, R1), (D, R1), (B, R2), (C, R2)]
    eaves = [A, B, C, D]
    return objs, lines, eaves


def roof_gable(name, w, d, h, ov_side, ov_gable, thick, m, z0, cx=0.0, cy=0.0):
    """两坡屋顶：屋脊沿 X（长 w），坡向 ±Y。返回（屋面, 屋脊线, 檐口点）。"""
    hw = w / 2 + ov_gable
    hd = d / 2 + ov_side
    slope = h / (d / 2)
    ze = z0 - ov_side * slope
    A = Vector((cx - hw, cy - hd, ze))
    B = Vector((cx + hw, cy - hd, ze))
    C = Vector((cx + hw, cy + hd, ze))
    D = Vector((cx - hw, cy + hd, ze))
    R1 = Vector((cx - hw, cy, z0 + h))
    R2 = Vector((cx + hw, cy, z0 + h))
    tile = TILE.get(m.name, 1.6) if m else 1.6
    objs = []
    T = Vector((0, 0, thick))
    for tag, pts, eave in (('S', [A, B, R2, R1], B - A), ('N', [C, D, R1, R2], D - C)):
        verts = pts + [p + T for p in pts]
        f = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        ob = K.mesh_obj(f'{name}_{tag}', verts, f, m, smooth=0)
        K.fix_normals(ob)
        poly_uv(ob, pts[0], eave, ((pts[2] + pts[3]) / 2 - (pts[0] + pts[1]) / 2), tile)
        objs.append(ob)
    return objs, [(R1, R2)], [A, B, C, D]


def gable_wall(name, w, d, h, z0, m, cx=0.0, cy=0.0, x_side=1):
    """山墙三角形（位于 x = cx ± w/2）。"""
    x = cx + x_side * w / 2
    verts = [(x, cy - d / 2, z0), (x, cy + d / 2, z0), (x, cy, z0 + h)]
    ob = K.mesh_obj(name, verts, [(0, 1, 2)], m, smooth=0)
    K.add_solidify(ob, 0.12, 0)
    K.apply_mods(ob)
    uv_world(ob)
    return ob


def ridge_tube(name, a, b, r, m, seg=10):
    return K.tube_path(name, [a, b], r, m, seg=seg)


def eave_caps(name, pts, spacing, r, m, inset=0.0):
    """沿闭合折线（檐口）排一圈圆形瓦当。"""
    obs = []
    n = len(pts)
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        L = (b - a).length
        k = max(1, int(L / spacing))
        d = (b - a).normalized()
        out = Vector((d.y, -d.x, 0))  # 外侧（逆时针时）
        for j in range(k):
            p = a + d * (L * (j + 0.5) / k) - out * inset
            c = K.cylinder(f'{name}{i}_{j}', r, 0.06, (0, 0, 0), m, 8)
            # 瓦当轴线朝外（水平）
            c.rotation_euler = Vector((0, 0, 1)).rotation_difference(out).to_euler()
            c.location = p
            K.bake_transform(c)
            obs.append(c)
    return obs


def window(name, center, w, h, facing, frame_m, glass_m, depth=0.06, lattice=None, frame=0.06, mullion=True):
    """窗：外框 + 玻璃 +（可选）竖向格栅。facing：外法线方向（'+Y' '-Y' '+X' '-X'）。"""
    c = Vector(center)
    ax = {'+Y': (Vector((1, 0, 0)), Vector((0, 1, 0))), '-Y': (Vector((-1, 0, 0)), Vector((0, -1, 0))),
          '+X': (Vector((0, -1, 0)), Vector((1, 0, 0))), '-X': (Vector((0, 1, 0)), Vector((-1, 0, 0)))}[facing]
    u, n = ax
    up = Vector((0, 0, 1))
    obs = []

    def place(ob, du, dz, dn):
        K.bake_transform(ob)
        M = Matrix((u.to_4d(), n.to_4d(), up.to_4d(), (0, 0, 0, 1))).transposed()
        M.translation = c + u * du + up * dz + n * dn
        ob.data.transform(M)
        return ob

    g = K.box(name + '_g', (w, 0.01, h), (0, 0, 0), glass_m)
    obs.append(place(g, 0, 0, 0.0))
    for (du, dz, sw, sh) in ((0, h / 2 + frame / 2, w + 2 * frame, frame), (0, -h / 2 - frame / 2, w + 2 * frame, frame),
                             (-w / 2 - frame / 2, 0, frame, h), (w / 2 + frame / 2, 0, frame, h)):
        f = K.box(name + '_f', (sw, depth, sh), (0, 0, 0), frame_m)
        obs.append(place(f, du, dz, depth / 2 - 0.01))
    if mullion and w > 0.9:
        f = K.box(name + '_m', (frame * 0.6, depth * 0.8, h), (0, 0, 0), frame_m)
        obs.append(place(f, 0, 0, depth / 2 - 0.01))
    # 窗台
    s = K.box(name + '_s', (w + 2 * frame + 0.06, depth + 0.05, 0.04), (0, 0, 0), frame_m)
    obs.append(place(s, 0, -h / 2 - frame - 0.02, depth / 2 + 0.01))
    if lattice:
        lm, spacing, slat = lattice
        k = max(2, int(w / spacing))
        for i in range(k + 1):
            sl = K.box(name + f'_l{i}', (slat, 0.03, h), (0, 0, 0), lm)
            obs.append(place(sl, -w / 2 + w * i / k, 0, depth + 0.02))
        for dz in (-h / 2, h / 2):
            sl = K.box(name + '_lh', (w + slat, 0.035, 0.05), (0, 0, 0), lm)
            obs.append(place(sl, 0, dz, depth + 0.02))
    for o in obs:
        if o.data.materials and o.data.materials[0].name.startswith('b_'):
            uv_world(o)
    return obs


AX = {'+Y': (Vector((1, 0, 0)), Vector((0, 1, 0))), '-Y': (Vector((-1, 0, 0)), Vector((0, -1, 0))),
      '+X': (Vector((0, -1, 0)), Vector((1, 0, 0))), '-X': (Vector((0, 1, 0)), Vector((-1, 0, 0)))}


def wbox(name, center, facing, du, dz, dn, su, sn, sz, m, uv=False):
    """贴在某个墙面上的小方块（窗套、门板等）：du 沿墙面水平、dz 竖直、dn 朝外；su/sn/sz 为对应方向的尺寸。"""
    u, n = AX[facing]
    c = Vector(center) + u * du + n * dn + Vector((0, 0, dz))
    size = (abs(u.x) * su + abs(n.x) * sn, abs(u.y) * su + abs(n.y) * sn, sz)
    return bx(name, size, tuple(c), m, uv=uv)


def slab(name, quad, thick, m):
    """斜面板（单坡屋面一块）：quad = [檐口左, 檐口右, 上沿右, 上沿左]，UV 沿檐口 / 顺坡。"""
    A, B, C, D = [Vector(p) for p in quad]
    T = Vector((0, 0, thick))
    verts = [A, B, C, D, A + T, B + T, C + T, D + T]
    f = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = K.mesh_obj(name, verts, f, m, smooth=0)
    K.fix_normals(ob)
    poly_uv(ob, A, B - A, (C + D) / 2 - (A + B) / 2, TILE.get(m.name, 1.6) if m else 1.6)
    return ob


def lean_ring(name, X0, Y0, z_hi, X1, Y1, z_lo, thick, m):
    """绕墙一圈的单坡屋面（内沿贴墙 ±X0/±Y0 高 z_hi，外沿 ±X1/±Y1 高 z_lo，四角斜接）。"""
    sides = [((-X1, -Y1, z_lo), (X1, -Y1, z_lo), (X0, -Y0, z_hi), (-X0, -Y0, z_hi)),
             ((X1, -Y1, z_lo), (X1, Y1, z_lo), (X0, Y0, z_hi), (X0, -Y0, z_hi)),
             ((X1, Y1, z_lo), (-X1, Y1, z_lo), (-X0, Y0, z_hi), (X0, Y0, z_hi)),
             ((-X1, Y1, z_lo), (-X1, -Y1, z_lo), (-X0, -Y0, z_hi), (-X0, Y0, z_hi))]
    return [slab(f'{name}{i}', q, thick, m) for i, q in enumerate(sides)]


def stick(name, a, b, r, m, seg=6):
    """两点之间的细杆（檐板、栏杆、桁架杆件）。"""
    return K.tube_path(name, [tuple(a), tuple(b)], r, m, seg=seg)


def rotate_all(objs, angle):
    """把一组部件绕 Z 轴旋转（建模时屋脊沿 X，旋转后沿 Y）。UV 不受影响。"""
    R = Matrix.Rotation(angle, 4, 'Z')
    for o in objs:
        if o is None:
            continue
        K.apply_mods(o)
        K.bake_transform(o)
        o.data.transform(R)
    return objs


def model(name, objs, coll=None):
    """把部件按材质合并，挂到名为 name 的空物体下（原点 = 地面中心）。"""
    root = bpy.data.objects.new(name, None)
    (coll or bpy.context.scene.collection).objects.link(root)
    groups = {}
    for o in objs:
        if o is None:
            continue
        K.apply_mods(o)
        K.bake_transform(o)
        key = o.data.materials[0].name if o.data.materials else 'none'
        groups.setdefault(key, []).append(o)
    out = []
    for key, obs in groups.items():
        j = K.join(obs, f'{name}__{key}')
        K.shade(j, 30)
        j.parent = root
        out.append(j)
    return root, out


def export(path, roots):
    """建筑模型导出：位置 12 位（十几米的模型约 3 mm）、法线 9 位、UV 12 位（压缩级别 6：对这类模型比更高级别还小）。"""
    objs = []
    for r in roots:
        objs.append(r)
        objs.extend(r.children)
    K.export_glb(path, objs, qpos=12, qnorm=9, qtex=12, level=6)
