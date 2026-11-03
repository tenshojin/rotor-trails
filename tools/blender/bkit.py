# Blender 建模小工具库（后台模式 blender -b 下运行，不依赖界面）。
# 坐标约定：Blender X 右、Y 前、Z 上；导出 glTF 时自动转为游戏的 Y 上（游戏 z = -Blender Y）。

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

# ------------------------------------------------------------------ 场景


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc


def collection(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


# ------------------------------------------------------------------ 颜色与材质


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def col(hexv, a=1.0):
    r = ((hexv >> 16) & 255) / 255
    g = ((hexv >> 8) & 255) / 255
    b = (hexv & 255) / 255
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), a)


_IMG = {}


def image(path, colorspace='sRGB'):
    key = (os.path.abspath(path), colorspace)
    if key in _IMG:
        return _IMG[key]
    img = bpy.data.images.load(os.path.abspath(path), check_existing=True)
    img.colorspace_settings.name = colorspace
    _IMG[key] = img
    return img


def material(name, color=0x808080, rough=0.6, metal=0.0, emit=None, emit_strength=1.0, alpha=None,
             tex=None, tex_uv=None, normal=None, normal_strength=1.0, rough_tex=None, coat=0.0, tex_scale=None):
    """Principled BSDF 材质。tex：基础色贴图路径；normal：法线贴图（OpenGL）；rough_tex：粗糙度贴图。"""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = col(color) if isinstance(color, int) else color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
    uvnode = None
    if tex or normal or rough_tex:
        uvnode = nt.nodes.new('ShaderNodeUVMap')
        uvnode.uv_map = tex_uv or 'UVMap'
        src = uvnode.outputs['UV']
        if tex_scale:
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (tex_scale, tex_scale, 1)
            nt.links.new(uvnode.outputs['UV'], mp.inputs['Vector'])
            src = mp.outputs['Vector']
    if tex:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image(tex)
        nt.links.new(src, t.inputs['Vector'])
        if isinstance(color, int) and color != 0xffffff and color != 0x808080:
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(t.outputs['Color'], mix.inputs['A'])
            mix.inputs['B'].default_value = col(color)
            nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        else:
            nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha == 'tex':
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image(normal, 'Non-Color')
        nt.links.new(src, t.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.uv_map = tex_uv or 'UVMap'
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if rough_tex:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image(rough_tex, 'Non-Color')
        nt.links.new(src, t.inputs['Vector'])
        nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = col(emit) if isinstance(emit, int) else emit
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if isinstance(alpha, (int, float)):
        bsdf.inputs['Alpha'].default_value = alpha
    if alpha is not None:
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    return m


# ------------------------------------------------------------------ 网格


def mesh_obj(name, verts, faces, mat=None, coll=None, smooth=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    if mat:
        ob.data.materials.append(mat)
    if smooth is not None:
        shade(ob, smooth)
    return ob


def shade(ob, sharp_angle_deg=35.0):
    """平滑着色 + 超过角度的边保持硬边。sharp_angle_deg=0 → 全部硬边。"""
    me = ob.data
    if sharp_angle_deg <= 0:
        me.shade_flat()
        return ob
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(sharp_angle_deg))
    return ob


def bm_to_obj(name, bm, mat=None, coll=None, smooth=35.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    if mat:
        ob.data.materials.append(mat)
    if smooth is not None:
        shade(ob, smooth)
    return ob


def box(name, size, center=(0, 0, 0), mat=None, bevel=0.0, segs=2, rot=(0, 0, 0), coll=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    ob = bm_to_obj(name, bm, mat, coll, smooth=30)
    ob.rotation_euler = rot
    ob.location = center
    if bevel > 0:
        add_bevel(ob, bevel, segs)
    return ob


def cylinder(name, r, depth, center=(0, 0, 0), mat=None, verts=32, r2=None, bevel=0.0, segs=2, rot=(0, 0, 0), cap=True, coll=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    ob = bm_to_obj(name, bm, mat, coll, smooth=40)
    ob.rotation_euler = rot
    ob.location = center
    if bevel > 0:
        add_bevel(ob, bevel, segs)
    return ob


def sphere(name, r, center=(0, 0, 0), mat=None, seg=24, rings=12, scale=(1, 1, 1), coll=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    ob = bm_to_obj(name, bm, mat, coll, smooth=80)
    ob.location = center
    return ob


def torus(name, R, r, center=(0, 0, 0), mat=None, seg=32, seg2=12, arc=(0.0, 2 * math.pi), rot=(0, 0, 0), coll=None):
    """圆环（可只取一段弧），位于 XY 平面。"""
    a0, a1 = arc
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    n = seg if full else seg + 1
    verts, faces = [], []
    for i in range(n):
        a = a0 + (a1 - a0) * i / seg
        c, s = math.cos(a), math.sin(a)
        for j in range(seg2):
            b = 2 * math.pi * j / seg2
            rr = R + r * math.cos(b)
            verts.append((rr * c, rr * s, r * math.sin(b)))
    rows = seg if full else seg
    for i in range(rows):
        i2 = (i + 1) % n
        for j in range(seg2):
            j2 = (j + 1) % seg2
            faces.append((i * seg2 + j, i2 * seg2 + j, i2 * seg2 + j2, i * seg2 + j2))
    ob = mesh_obj(name, verts, faces, mat, coll, smooth=80)
    ob.rotation_euler = rot
    ob.location = center
    return ob


def tube_path(name, pts, r, mat=None, seg=12, coll=None, cap=True):
    """沿折线（自动圆角由调用方采样）扫掠的圆管。"""
    pts = [Vector(p) for p in pts]
    verts, faces = [], []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = n
        b = t.cross(n)
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append(p + (n * math.cos(a) + b * math.sin(a)) * r)
    for i in range(len(pts) - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((i * seg + j, i * seg + j2, (i + 1) * seg + j2, (i + 1) * seg + j))
    if cap:
        faces.append(tuple(range(seg - 1, -1, -1)))
        last = (len(pts) - 1) * seg
        faces.append(tuple(last + j for j in range(seg)))
    return mesh_obj(name, verts, faces, mat, coll, smooth=60)


def round_path(pts, radius, steps=6):
    """折线拐角倒圆（用于管件）。"""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d1 = (a - b)
        d2 = (c - b)
        r = min(radius, d1.length * 0.45, d2.length * 0.45)
        p1 = b + d1.normalized() * r
        p2 = b + d2.normalized() * r
        for k in range(steps + 1):
            t = k / steps
            # 二次贝塞尔
            out.append(p1 * (1 - t) ** 2 + b * 2 * t * (1 - t) + p2 * t * t)
    out.append(pts[-1])
    return out


def prism(name, outline, z0, z1, mat=None, axis='Z', coll=None, smooth=None):
    """二维多边形（逆时针）沿某轴挤出成柱体。outline：[(a, b)]，axis='Z' 时 (a,b)=(x,y)；'X' 时=(y,z)；'Y' 时=(x,z)。"""
    n = len(outline)

    def P(a, b, c):
        if axis == 'Z':
            return (a, b, c)
        if axis == 'X':
            return (c, a, b)
        return (a, c, b)

    verts = [P(a, b, z0) for a, b in outline] + [P(a, b, z1) for a, b in outline]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    ob = mesh_obj(name, verts, faces, mat, coll)
    # 挤出方向为 X 或 Y 时，按坐标轴手性修正法线朝外
    fix_normals(ob)
    if smooth is not None:
        shade(ob, smooth)
    return ob


def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def rounded_rect(w, h, r, steps=4):
    """以原点为中心的圆角矩形轮廓（逆时针）。"""
    r = min(r, w / 2 - 1e-5, h / 2 - 1e-5)
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(steps + 1):
            a = math.radians(a0 + 90 * k / steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def circle(r, n=32, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def cdt_face(name, outer, holes=(), mat=None, coll=None):
    """带孔的平面多边形（二维，z=0）：约束 Delaunay 三角化。"""
    from mathutils.geometry import delaunay_2d_cdt

    # 外轮廓逆时针、孔顺时针，按“面”传入；输出类型 3 = 约束区域并自动去掉孔洞
    loops = [outer] + list(holes)
    verts = []
    faces_in = []
    for lp in loops:
        base = len(verts)
        verts += [Vector((x, y)) for x, y in lp]
        faces_in.append(list(range(base, base + len(lp))))
    out = delaunay_2d_cdt(verts, [], faces_in, 3, 1e-7)
    vco, _ed, fa = out[0], out[1], out[2]
    return mesh_obj(name, [(v.x, v.y, 0.0) for v in vco], fa, mat, coll, smooth=0)


def map_verts(ob, fn):
    """逐顶点映射（局部坐标 → 新坐标）。"""
    me = ob.data
    for v in me.vertices:
        v.co = Vector(fn(tuple(v.co)))
    me.update()
    return ob


def extrude_flat(ob, depth):
    """把平面网格沿 +Z 挤出成板（底面 z=0，顶面 z=depth）。"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    res = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    vs = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, depth)), verts=vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


# ------------------------------------------------------------------ 修改器


def add_bevel(ob, width, segs=2, angle=40.0, harden=False):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = True
    m.harden_normals = harden
    return m


def add_solidify(ob, thickness, offset=-1.0, mat_offset=0, rim_offset=0):
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    m.material_offset = mat_offset
    m.material_offset_rim = rim_offset
    return m


def add_subsurf(ob, levels=1):
    m = ob.modifiers.new('subsurf', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return m


def boolean(ob, cutter, op='DIFFERENCE', solver='EXACT'):
    m = ob.modifiers.new('bool_' + cutter.name, 'BOOLEAN')
    m.object = cutter
    m.operation = op
    try:
        m.solver = solver
    except TypeError:
        m.solver = 'EXACT'
    return m


def apply_mods(ob):
    """不调用 ops，直接用求值后的网格替换（后台模式下最稳妥）。"""
    if not ob.modifiers:
        return ob
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(eo, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def bake_transform(ob):
    """把物体的位置/旋转/缩放写进网格顶点（物体变换归零）。"""
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def set_origin(ob, p):
    """把物体原点移到世界坐标 p（几何不动）。要求物体没有父级。"""
    bake_transform(ob)
    ob.data.transform(Matrix.Translation(-Vector(p)))
    ob.location = p
    return ob


def delete(ob):
    me = ob.data if ob.type == 'MESH' else None
    bpy.data.objects.remove(ob, do_unlink=True)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


def join(objs, name):
    """合并多个网格物体（保留各自材质）。"""
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    for o in objs:
        apply_mods(o)
        bake_transform(o)
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


# ------------------------------------------------------------------ UV


def uv_layer(ob, name='UVMap'):
    me = ob.data
    return me.uv_layers.get(name) or me.uv_layers.new(name=name)


def uv_from_fn(ob, fn, name='UVMap'):
    """每个面角按 fn(世界坐标, 面法线) 计算 UV。"""
    me = ob.data
    uv = uv_layer(ob, name)
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for poly in me.polygons:
        n = (nm @ poly.normal).normalized()
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = fn(co, n)
    return ob


def uv_box(ob, scale=1.0, name='UVMap'):
    """简单的三向投影 UV（世界坐标，适合有纹理的布料、金属等）。"""
    def f(co, n):
        ax = max(range(3), key=lambda i: abs(n[i]))
        if ax == 0:
            return (co.y * scale, co.z * scale)
        if ax == 1:
            return (co.x * scale, co.z * scale)
        return (co.x * scale, co.y * scale)

    return uv_from_fn(ob, f, name)


def uv_disc(ob, center, u_axis, v_axis, radius, slot_rect, name='UVMap'):
    """圆盘（表盘）UV：映射到图集中的一个方格 slot_rect=(u0, v0, u1, v1)。"""
    c = Vector(center)
    ua, va = Vector(u_axis), Vector(v_axis)
    u0, v0, u1, v1 = slot_rect

    def f(co, n):
        d = co - c
        x = d.dot(ua) / radius * 0.5 + 0.5
        y = d.dot(va) / radius * 0.5 + 0.5
        return (u0 + (u1 - u0) * x, v0 + (v1 - v0) * y)

    return uv_from_fn(ob, f, name)


# ------------------------------------------------------------------ 导出与渲染


def export_glb(path, objs, extras=True, draco=True, qpos=14, qnorm=10, qtex=14, level=6):
    """导出 GLB（贴图转 WebP；默认开启 Draco 几何压缩，游戏里由 public/draco/ 的解码器解压）。
    qpos/qnorm/qtex：位置 / 法线 / 纹理坐标的量化位数（建筑类可以更低，体积更小）。"""
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_extras=extras,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=88,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_draco_mesh_compression_enable=draco,
        export_draco_mesh_compression_level=level,
        export_draco_position_quantization=qpos,
        export_draco_normal_quantization=qnorm,
        export_draco_texcoord_quantization=qtex,
        export_draco_color_quantization=10,
        export_draco_generic_quantization=12,
    )


def use_gpu():
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.refresh_devices()
            devs = [d for d in prefs.devices if d.type == kind]
            if devs:
                for d in prefs.devices:
                    d.use = d.type == kind
                bpy.context.scene.cycles.device = 'GPU'
                return kind
        except Exception:
            continue
    return 'CPU'


def select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def smart_uv(ob, name='AO', angle=66.0, margin=0.002, weight=None):
    """为烘焙生成第二套不重叠 UV（智能投影 + 自动排布）。
    weight(材质名) → 该材质所在 UV 岛的面积比例（例如看不到的外表面给很小的比例，仪表板给更大的比例）。"""
    me = ob.data
    keep = me.uv_layers.active.name if me.uv_layers.active else None
    lay = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    me.uv_layers.active = lay
    select_only(ob)
    with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    if weight:
        _weight_islands(ob, name, weight)
        with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.select_all(action='SELECT')
            bpy.ops.uv.pack_islands(rotate=True, margin=margin)
            bpy.ops.object.mode_set(mode='OBJECT')
    if keep:
        me.uv_layers.active = me.uv_layers[keep]
    return lay


def _weight_islands(ob, uvname, weight):
    """按材质权重缩放每个 UV 岛（之后重新排布时，岛的相对大小就决定了分到的贴图面积）。"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv[uvname]
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        f1, f2 = lf
        same = True
        for v in e.verts:
            l1 = next(lp for lp in f1.loops if lp.vert == v)
            l2 = next(lp for lp in f2.loops if lp.vert == v)
            if (l1[uv].uv - l2[uv].uv).length > 1e-6:
                same = False
                break
        if same:
            a, b = find(f1.index), find(f2.index)
            if a != b:
                parent[a] = b
    islands = {}
    for f in bm.faces:
        islands.setdefault(find(f.index), []).append(f)
    names = [m.name if m else '' for m in me.materials]
    for faces in islands.values():
        w = max(weight(names[f.material_index] if f.material_index < len(names) else '') for f in faces)
        if abs(w - 1.0) < 1e-6:
            continue
        cs = [lp[uv].uv.copy() for f in faces for lp in f.loops]
        c = sum(cs, Vector((0.0, 0.0))) / len(cs)
        k = math.sqrt(w)  # 面积比例 → 边长比例
        for f in faces:
            for lp in f.loops:
                lp[uv].uv = c + (lp[uv].uv - c) * k
    bm.to_mesh(me)
    bm.free()


def bake_ao(ob, path, size=4096, samples=64, distance=0.3, uv='AO', margin=8):
    """把环境光遮蔽烘焙到一张灰度图（使用 uv 指定的第二套 UV）。"""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    use_gpu()
    sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bake_world')
    sc.world.light_settings.distance = distance
    img = bpy.data.images.new('ao_bake', size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    added = []
    for i, mat in enumerate(ob.data.materials):
        if mat is None:  # 空材质槽（合并时带进来的）：补一个默认材质，否则烘焙会失败
            ob.data.materials[i] = material('bake_fallback', 0x202022, rough=0.6)
    for mat in ob.data.materials:
        nt = mat.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        u = nt.nodes.new('ShaderNodeUVMap')
        u.uv_map = uv
        nt.links.new(u.outputs['UV'], n.inputs['Vector'])
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
        added.append((nt, n, u))
    me = ob.data
    keep = me.uv_layers.active.name
    me.uv_layers.active = me.uv_layers[uv]
    sc.render.bake.margin = margin
    select_only(ob)
    with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.bake(type='AO', use_clear=True, margin=margin)
    me.uv_layers.active = me.uv_layers[keep]
    img.filepath_raw = os.path.abspath(path)
    img.file_format = 'PNG'
    img.save()
    for nt, n, u in added:
        nt.nodes.remove(n)
        nt.nodes.remove(u)
    return img


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(name, loc, target, fov_deg=60.0, lens_mm=None):
    cd = bpy.data.cameras.new(name)
    if lens_mm:
        cd.lens = lens_mm
    else:
        cd.lens_unit = 'FOV'
        cd.angle = math.radians(fov_deg)
    cd.clip_start = 0.01
    cam = bpy.data.objects.new(name, cd)
    link(cam)
    cam.location = loc
    look_at(cam, target)
    return cam


def world_sky(strength=1.0, sun_dir=(0.3, 0.6, 0.75), sun_strength=4.0, zenith=0x6f9bd8, horizon=0xdfe8f0):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get('Background')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    # 世界着色器里 Generated 坐标 = 视线方向（z：-1 下 … 1 上），地平线以下取第一个色标
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = col(0x8a8576)
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = col(zenith)
    e = ramp.color_ramp.elements.new(0.04)
    e.color = col(horizon)
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = sun_strength
    ld.angle = math.radians(1.0)
    sun = bpy.data.objects.new('sun', ld)
    link(sun)
    sun.rotation_euler = Vector(sun_dir).normalized().to_track_quat('Z', 'Y').to_euler()
    return w


def render(path, cam, res=(1200, 900), samples=96, engine='CYCLES', exposure=0.0):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = exposure
    if engine == 'CYCLES':
        use_gpu()
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        try:
            sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        except Exception:
            pass
    sc.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
