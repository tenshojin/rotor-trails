# 飞行员身上的硬东西：头盔（外壳、面罩罩壳、面罩、包边、麦克风、下巴带）、护膝板、背心的扣子。
# 软的（脸、衣服、背心）在 pilot_sdf.py 里用距离场雕；这些要边缘干净的零件直接在 Blender 里建。
# 样子照 MOSS-Image 生成的参考图：art/src/ref/pilot/helmet_s5.png、face_s7.png、sheet_s11.png、knee_s10.png。
#
# 坐标：Blender 世界坐标（X 右、Y 前、Z 上，米），和 pilot_sdf.py 相同。头盔先在“头的局部坐标”里建
# （原点是头的中心 HEAD_C），最后平移过去。

import math

import bmesh
import bpy
from mathutils import Vector

HEAD_C = Vector((0.45, 0.945, 0.415))

# ------------------------------------------------------------------ 外壳的参数曲面
RX = 0.127
CEN = Vector((0.0, -0.008, 0.016))
BROW = 0.056  # 面窗上沿（离头中心的高度）
OPEN_W = 0.069  # 面窗半宽
OPEN_R = 0.026  # 面窗上角的圆角


def _ry(az):
    return 0.148 + 0.002 * math.cos(az)


def _rz(el):
    return 0.155 + 0.005 * math.sin(el)


def _dir(az, el):
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def ear_bump(az, el):
    """两侧的耳罩：外壳上鼓起来的一块圆台（设定图里是两个明显的圆包）"""
    b = 0.0
    d0 = _dir(az, el)
    for s in (-1, 1):
        d = math.acos(max(-1.0, min(1.0, d0.dot(_dir(s * math.pi / 2, -0.30)))))
        t = max(0.0, min(1.0, (0.43 - d) / 0.09))
        b += 0.016 * t * t * (3 - 2 * t)
    return b


def shell_point(az, el, out=0.0):
    """外壳表面上的点和法线。az：从正前方往右为正；el：仰角"""
    ca, sa, ce, se = math.cos(az), math.sin(az), math.cos(el), math.sin(el)
    ry, rz = _ry(az), _rz(el)
    p = Vector((RX * sa * ce, ry * ca * ce, rz * se)) + CEN
    n = Vector((sa * ce / RX, ca * ce / ry, se / rz)).normalized()
    return p + n * (ear_bump(az, el) + out), n


def _in_opening(p):
    """面窗：正面一个圆角矩形（在 x-z 平面上看），从眉毛一直开到下面"""
    if p.y < 0.02:
        return False
    qx = abs(p.x) - (OPEN_W - OPEN_R)
    qz = p.z - (BROW - OPEN_R)
    out = math.hypot(max(qx, 0.0), max(qz, 0.0)) + min(max(qx, qz), 0.0) - OPEN_R
    return out < 0


def _bottom(az):
    """外壳下沿的高度：两侧耳罩最低，后颈稍高"""
    z = -0.092 - 0.006 * math.cos(2 * az) + 0.004 * math.cos(az)
    return math.asin(max(-0.99, min(0.99, (z - CEN.z) / 0.150)))


def el_min(az):
    """这条经线上外壳从哪里开始（下沿或者面窗的边）"""
    lo = _bottom(az)
    # 从上往下找第一个落进面窗的点
    el = 1.2
    while el > lo:
        if _in_opening(shell_point(az, el)[0]):
            # 往回细找边界
            a, b = el, el + 0.02
            for _ in range(20):
                m = (a + b) / 2
                if _in_opening(shell_point(az, m)[0]):
                    a = m
                else:
                    b = m
            return max(lo, b)
        el -= 0.02
    return lo


# ------------------------------------------------------------------ 网格小工具
def grid_patch(name, fn, nu, nv, closed_u=False, mat=None):
    """参数面片：fn(u, v) -> Vector，u、v 都在 0..1"""
    bm = bmesh.new()
    rows = []
    cols = nu if closed_u else nu + 1
    for j in range(nv + 1):
        row = []
        for i in range(cols):
            row.append(bm.verts.new(fn(i / nu, j / nv)))
        rows.append(row)
    for j in range(nv):
        for i in range(nu):
            a = rows[j][i]
            b = rows[j][(i + 1) % cols] if closed_u else rows[j][i + 1]
            c = rows[j + 1][(i + 1) % cols] if closed_u else rows[j + 1][i + 1]
            d = rows[j + 1][i]
            bm.faces.new((a, b, c, d))
    return _to_obj(name, bm, mat), rows


def _to_obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat:
        me.materials.append(mat)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    return ob


def _apply(ob):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        for m in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


def solidify(ob, thick, offset=-1.0, even=True):
    m = ob.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = thick
    m.offset = offset
    m.use_even_offset = even
    m.use_quality_normals = True
    _apply(ob)


def fix_normals(ob, inside=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def tube(name, pts, r, mat, seg=12, cap=True):
    """沿折线的圆管（麦克风杆、包边）"""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    prev_side = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_side is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            side = t.cross(ref).normalized()
        else:
            side = (prev_side - t * prev_side.dot(t)).normalized()
        prev_side = side
        up = t.cross(side).normalized()
        ring = [bm.verts.new(p + (side * math.cos(2 * math.pi * k / seg) + up * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    ob = _to_obj(name, bm, mat)
    fix_normals(ob)
    return ob


def loop_tube(name, pts, r, mat, seg=10):
    """闭合的圆管（面窗一圈的橡胶包边）"""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        out = (p - CEN).normalized()
        side = (out - t * out.dot(t)).normalized()
        up = t.cross(side).normalized()
        rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / seg) + up * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
    for i in range(n):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    ob = _to_obj(name, bm, mat)
    fix_normals(ob)
    return ob


def band(name, pts, width, thick, mat, normal_fn):
    """贴着表面走的一条扁带（下巴带、后颈带、护膝板的绑带）。normal_fn(p) 给出那里朝外的方向"""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rows = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = normal_fn(p)
        nrm = (nrm - t * nrm.dot(t)).normalized()
        side = t.cross(nrm).normalized() * (width / 2)
        rows.append([bm.verts.new(p + side), bm.verts.new(p - side), bm.verts.new(p - side + nrm * thick), bm.verts.new(p + side + nrm * thick)])
    for a, b in zip(rows, rows[1:]):
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[-1])
    ob = _to_obj(name, bm, mat)
    fix_normals(ob)
    return ob


def disc(name, center, normal, r, h, mat, seg=20):
    """贴在表面上的小圆柱（转轴旋钮、按扣）"""
    n = Vector(normal).normalized()
    ref = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    a = n.cross(ref).normalized()
    b = n.cross(a).normalized()
    c = Vector(center)
    bm = bmesh.new()
    bot = [bm.verts.new(c + (a * math.cos(2 * math.pi * k / seg) + b * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)]
    top = [bm.verts.new(c + n * h + (a * math.cos(2 * math.pi * k / seg) + b * math.sin(2 * math.pi * k / seg)) * r * 0.86) for k in range(seg)]
    for k in range(seg):
        bm.faces.new((bot[k], bot[(k + 1) % seg], top[(k + 1) % seg], top[k]))
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    ob = _to_obj(name, bm, mat)
    fix_normals(ob)
    return ob


def ellipsoid(name, center, radii, mat, axis=None, seg=20, rings=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    if axis is not None:
        q = Vector(axis).to_track_quat('Y', 'Z')
        for v in bm.verts:
            v.co = q @ v.co
    for v in bm.verts:
        v.co += Vector(center)
    return _to_obj(name, bm, mat)


def rbox(name, center, half, mat, rot_z=0.0, bevel=0.003, uv_top=False):
    """圆角盒子（护膝板、扣子）。uv_top：顶面按 x、y 铺满一张贴图（检查单的纸）"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * half[0] * 2, v.co.y * half[1] * 2, v.co.z * half[2] * 2))
    if uv_top:
        uv = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            for lp in f.loops:
                lp[uv].uv = (lp.vert.co.x / (2 * half[0]) + 0.5, lp.vert.co.y / (2 * half[1]) + 0.5)
    ob = _to_obj(name, bm, mat)
    if bevel > 0:
        m = ob.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = 3
        m.limit_method = 'NONE'
        _apply(ob)
    ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
    c, s = math.cos(rot_z), math.sin(rot_z)
    for v in ob.data.vertices:
        x, y, z = v.co
        v.co = Vector((x * c - y * s, x * s + y * c, z)) + Vector(center)
    return ob


def to_head(ob):
    """头的局部坐标 → 世界坐标"""
    for v in ob.data.vertices:
        v.co += HEAD_C
    ob.data.update()
    return ob


# ------------------------------------------------------------------ 头盔
def build_helmet(M):
    """M：材质表，要有 plh_shell、plh_black、plh_visor、plh_rubber、plh_foam。返回物体列表（已在世界坐标）"""
    objs = []
    NU, NV = 176, 44
    azs = [-math.pi + 2 * math.pi * i / NU for i in range(NU)]
    lows = [el_min(a) for a in azs]
    TOP = 1.45

    def sfn(u, v):
        i = int(round(u * NU)) % NU
        e = lows[i] + (TOP - lows[i]) * v
        return shell_point(azs[i], e)[0]

    shell, rows = grid_patch('helmet_shell', sfn, NU, NV, closed_u=True, mat=M['plh_shell'])
    # 头顶：最后一圈收到一个点
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    bm.verts.ensure_lookup_table()
    ring = bm.verts[len(bm.verts) - NU:]
    pole = bm.verts.new(shell_point(0.0, math.pi / 2)[0])
    for k in range(NU):
        bm.faces.new((ring[k], ring[(k + 1) % NU], pole))
    bm.to_mesh(shell.data)
    bm.free()
    fix_normals(shell)
    rim = [shell_point(azs[i], lows[i], -0.0055)[0] for i in range(NU)]
    solidify(shell, 0.011, -1.0)
    shell.data.polygons.foreach_set('use_smooth', [True] * len(shell.data.polygons))
    objs.append(shell)
    # 面窗和下沿一圈的橡胶包边
    objs.append(loop_tube('helmet_trim', rim, 0.0068, M['plh_rubber']))

    # 面罩罩壳：眉毛上面一条黑色的弧带，两头到转轴；中间一道往上走的滑轨
    def housing_lo(az):
        a = abs(az)
        return 0.27 - 0.24 * (a / 1.2) ** 2

    def hfn(u, v):
        az = -1.22 + 2.44 * u
        lo = housing_lo(az) - 0.02
        hi = lo + 0.20 - 0.07 * (abs(az) / 1.22) ** 2
        return shell_point(az, lo + (hi - lo) * v, 0.0035)[0]

    hous, _ = grid_patch('helmet_housing', hfn, 64, 8, mat=M['plh_black'])
    fix_normals(hous)
    solidify(hous, 0.0075, 1.0, even=False)
    objs.append(hous)

    def rfn(u, v):
        az = -0.11 + 0.22 * u
        return shell_point(az, 0.40 + 0.62 * v, 0.004)[0]

    rail, _ = grid_patch('helmet_rail', rfn, 6, 14, mat=M['plh_black'])
    fix_normals(rail)
    solidify(rail, 0.009, 1.0, even=False)
    objs.append(rail)
    p, n = shell_point(0.0, 0.78, 0.013)
    objs.append(rbox('helmet_slider', p, (0.017, 0.012, 0.022), M['plh_black'], bevel=0.003))

    # 面罩：烟色，放下来盖到鼻梁中间
    VA = 1.06

    def vlo(az):
        # 中间盖到鼻梁中间（设定图 face_s7），往两边翘到颧骨
        return -0.150 + 0.24 * (abs(az) / VA) ** 1.6

    def vhi(az):
        # 上沿藏在罩壳下面；两头再窄也留一点高度，不能收成一个点
        return max(housing_lo(az) + 0.03, vlo(az) + 0.05)

    def vfn(u, v):
        az = -VA + 2 * VA * u
        lo, hi = vlo(az), vhi(az)
        return shell_point(az, lo + (hi - lo) * v, 0.0135)[0]

    visor, vrows = grid_patch('helmet_visor', vfn, 72, 18, mat=M['plh_visor'])
    fix_normals(visor)
    solidify(visor, 0.0032, 1.0, even=False)
    objs.append(visor)
    # 面罩下沿也包一道细边（透着光的时候能看出厚度）
    vedge = [shell_point(-VA + 2 * VA * i / 72, vlo(-VA + 2 * VA * i / 72), 0.0150)[0] for i in range(73)]
    objs.append(tube('helmet_visor_edge', vedge, 0.0019, M['plh_black'], seg=8))

    # 两侧的转轴旋钮
    for s in (-1, 1):
        p, n = shell_point(s * 1.22, 0.06, 0.006)
        objs.append(disc(f'helmet_pivot_{s}', p, n, 0.017, 0.010, M['plh_black']))
        objs.append(disc(f'helmet_pivot_cap_{s}', p + n * 0.010, n, 0.008, 0.004, M['plh_metal']))
    # 按扣：一圈小黑点
    for k, (az, el) in enumerate([(0.42, 0.55), (-0.42, 0.55), (1.0, 0.62), (-1.0, 0.62), (1.62, 0.20), (-1.62, 0.20), (2.2, -0.25), (-2.2, -0.25)]):
        p, n = shell_point(az, el, 0.0)
        objs.append(disc(f'helmet_snap_{k}', p, n, 0.0062, 0.003, M['plh_black'], seg=12))

    # 后颈的黑色绑带：贴着后面的下沿
    nape = [shell_point(a, _bottom(a) + 0.07, 0.002)[0] for a in [math.pi - 1.25 + 2.5 * k / 30 for k in range(31)]]
    objs.append(band('helmet_nape', nape, 0.030, 0.004, M['plh_black'], lambda p: (p - CEN).normalized()))
    # 后面的通话插头
    p, n = shell_point(math.pi, _bottom(math.pi) + 0.02, 0.006)
    objs.append(rbox('helmet_plug', p + Vector((0, -0.004, -0.012)), (0.011, 0.008, 0.016), M['plh_black'], bevel=0.003))

    # 下巴带：两边耳罩下面兜过下巴
    chin = [(-0.098, 0.012, -0.090), (-0.074, 0.040, -0.102), (-0.038, 0.066, -0.110), (0.0, 0.077, -0.1135), (0.038, 0.066, -0.110), (0.074, 0.040, -0.102), (0.098, 0.012, -0.090)]
    objs.append(band('helmet_chinstrap', chin, 0.017, 0.0028, M['plh_black'], lambda p: Vector((p.x * 0.6, p.y * 0.4, p.z)).normalized()))
    for s in (-1, 1):
        objs.append(rbox(f'helmet_strapclip_{s}', (s * 0.090, 0.024, -0.098), (0.008, 0.012, 0.010), M['plh_black'], bevel=0.002))

    # 麦克风：左边耳罩前面伸出来，弯到嘴角前面；海绵套
    base, n = shell_point(-1.42, -0.40, 0.012)
    boom = [base, base + Vector((0.004, 0.030, -0.012)), Vector((-0.112, 0.068, -0.082)), Vector((-0.080, 0.100, -0.084)), Vector((-0.046, 0.116, -0.074)), Vector((-0.030, 0.121, -0.069))]
    objs.append(tube('helmet_boom', boom, 0.0033, M['plh_black'], seg=10))
    objs.append(disc('helmet_boom_mount', base - n * 0.004, n, 0.013, 0.012, M['plh_black']))
    objs.append(ellipsoid('helmet_mic', (-0.022, 0.123, -0.067), (0.0125, 0.0155, 0.0125), M['plh_foam'], axis=(0.75, 0.30, 0.25)))

    for ob in objs:
        to_head(ob)
    return objs


# ------------------------------------------------------------------ 护膝板（右大腿上面）
def build_kneeboard(M, thigh_a, thigh_b):
    """thigh_a、thigh_b：右大腿骨头的两端。板子顺着大腿方向，绑在大腿上面"""
    a, b = Vector(thigh_a), Vector(thigh_b)
    ax = (b - a).normalized()
    yaw = math.atan2(ax.x, ax.y)
    c = a + (b - a) * 0.60
    top = c.z + 0.073
    center = Vector((c.x, c.y, top))
    objs = [rbox('knee_board', center, (0.072, 0.112, 0.0045), M['pl_kneeboard'], rot_z=-yaw, bevel=0.004)]
    # 纸：一张检查单，用参考图做贴图
    paper = rbox('knee_paper', center + Vector((0, -0.006, 0.005)), (0.064, 0.098, 0.0008), M['pl_paper'], rot_z=-yaw, bevel=0.0, uv_top=True)
    objs.append(paper)
    # 夹子：靠膝盖那头
    clip_c = center + Vector((math.sin(yaw), math.cos(yaw), 0)) * 0.094 + Vector((0, 0, 0.008))
    objs.append(rbox('knee_clip', clip_c, (0.040, 0.012, 0.0045), M['metal'], rot_z=-yaw, bevel=0.003))
    # 松紧绑带：绕大腿一圈（只做露在外面的大半圈）
    mid = a + (b - a) * 0.52
    side = Vector((math.cos(yaw), -math.sin(yaw), 0))
    pts = []
    for k in range(17):
        t = -1.25 + 2.5 * k / 16
        # 大腿的横截面大约是半径 7 厘米的圆，顶上被板子压平
        r = 0.077
        pts.append(mid + side * (math.sin(t) * r) + Vector((0, 0, math.cos(t) * r - 0.004)))
    objs.append(band('knee_strap', pts, 0.026, 0.0028, M['strap'], lambda p: (p - mid - ax * (p - mid).dot(ax)).normalized()))
    return objs


# ------------------------------------------------------------------ 背心和腰带上的金属扣
def build_vest_hardware(M, seat_x=0.45):
    objs = []
    for s in (-1, 1):
        # 肩带上的调节扣（胸口高度）
        objs.append(rbox(f'vest_adj_{s}', (seat_x + s * 0.090, 1.046, 0.122), (0.024, 0.006, 0.014), M['metal'], rot_z=s * 0.30, bevel=0.003))
        objs.append(rbox(f'vest_adj_bar_{s}', (seat_x + s * 0.090, 1.051, 0.122), (0.019, 0.003, 0.004), M['strap'], rot_z=s * 0.30, bevel=0.0015))
    # 腰带正中的插扣
    objs.append(rbox('belt_buckle', (seat_x, 1.052, -0.112), (0.034, 0.008, 0.020), M['strap'], bevel=0.004))
    objs.append(rbox('belt_buckle_face', (seat_x, 1.059, -0.112), (0.026, 0.002, 0.013), M['metal'], bevel=0.002))
    return objs
