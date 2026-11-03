# RT-7 驾驶舱建模（参照 H125 / AS350 实机照片）。
# 运行：blender -b --factory-startup --python tools/blender/cockpit.py -- <输出 glb> <贴图目录> [--preview 预览目录] [--bake] [--blend 保存路径]
#
# 输出的 glTF 节点约定（游戏 src/render/cockpit.ts 依赖这些名字）：
#   ndl_<仪表>_<角色>  指针/刻度盘（原点 = 转轴，绕仪表板法线转动），extras.axis = 游戏坐标里的转轴
#   scr_<名字>         动态屏幕（UV 0..1，游戏里换成 Canvas 贴图）
#   ctl_cyclic / ctl_collective / ctl_pedal_l / ctl_pedal_r  操纵机构（原点 = 转轴/滑动基点）
#   glass_*            窗玻璃（游戏里换成带雨滴效果的玻璃材质）

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import cockpit_layout as L  # noqa: E402
import cockpit_soft as Q  # noqa: E402
import heli_shape as HS  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_GLB = argv[0] if argv else 'public/models/cockpit.glb'
TEX = argv[1] if len(argv) > 1 else 'art/out/cockpit_tex'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
BLEND = argv[argv.index('--blend') + 1] if '--blend' in argv else None
DO_BAKE = '--bake' in argv
PH = 'art/src/polyhaven'

K.reset()

# ------------------------------------------------------------------ 材质
M = {}


def mats():
    M['panel'] = K.material('cp_panelfront', 0x808080, rough=0.62, tex=os.path.join(TEX, 'panel_decal.png'))
    M['gauge'] = K.material('cp_gauges', 0x808080, rough=0.38, tex=os.path.join(TEX, 'gauges.png'))
    M['overlay'] = K.material('cp_gauge_overlay', 0x808080, rough=0.4, tex=os.path.join(TEX, 'gauges.png'), alpha='tex')
    # 黑色件不能用接近 0 的反照率：真实的黑塑料、黑皮革反射率也有 2~4%，太低会在画面上变成一块没有细节的剪影
    M['black'] = K.material('cp_black', 0x202123, rough=0.42)
    M['knob'] = K.material('cp_knob', 0x1c1c1e, rough=0.5)
    M['metal'] = K.material('cp_metal', 0x9a9ea3, rough=0.32, metal=1.0)
    M['dmetal'] = K.material('cp_darkmetal', 0x3a3c40, rough=0.4, metal=0.8)
    M['needle'] = K.material('cp_needle', 0xf3f3ec, rough=0.45)
    M['orange'] = K.material('cp_needle_orange', 0xf08a24, rough=0.45)
    M['gglass'] = K.material('cp_gauge_glass', 0xffffff, rough=0.03, alpha=0.08)
    tx = 'art/out/tex/'
    # 舱内饰板：浅灰色、带细小皮纹（参照 AS350 机舱 360° 全景照片）。皮纹是 2 mm 左右的细颗粒，法线强度要低，
    # 否则在阳光下会变成一层粗糙的拉毛墙面
    grain = dict(normal=tx + 'grain_nor_gl_1024.jpg', rough_tex=tx + 'grain_rough_1024.jpg')
    M['glare'] = K.material('cp_glare', 0x808080, rough=1.0, tex=tx + 'leather_diffuse_1024.jpg', normal_strength=0.3, **grain)
    M['lining'] = K.material('cp_lining', 0x808080, rough=1.0, tex=tx + 'lining_diffuse_1024.jpg', normal_strength=0.22, **grain)
    M['lining_d'] = K.material('cp_lining_dark', 0x808080, rough=1.0, tex=tx + 'liningd_diffuse_1024.jpg', normal_strength=0.25, **grain)
    M['trim'] = K.material('cp_trim', 0x3b3c3f, rough=0.46)
    M['felt'] = K.material('cp_felt', 0x808080, rough=1.0, tex=tx + 'felt_diffuse_1024.jpg', normal=tx + 'felt_nor_gl_1024.jpg', rough_tex=tx + 'felt_rough_1024.jpg', normal_strength=0.4)
    M['seal'] = K.material('cp_seal', 0x232427, rough=0.6)
    M['gap'] = K.material('cp_gap', 0x0d0d0e, rough=0.9)
    M['seatmesh'] = K.material('cp_seatmesh', 0x808080, rough=1.0, tex=tx + 'seatmesh_diffuse_1024.jpg', normal=tx + 'seatmesh_nor_gl_1024.jpg', rough_tex=tx + 'seatmesh_rough_1024.jpg', normal_strength=0.5)
    M['leather'] = K.material('cp_leather', 0x808080, rough=1.0, tex=tx + 'leather_diffuse_1024.jpg', normal=tx + 'grain_nor_gl_1024.jpg', rough_tex=tx + 'leather_rough_1024.jpg', normal_strength=0.32)
    M['brushed'] = K.material('cp_brushed', 0xa7abb0, rough=1.0, metal=1.0, normal=tx + 'brushed_nor_gl_1024.jpg', rough_tex=tx + 'brushed_rough_1024.jpg', normal_strength=0.4)
    M['placard'] = K.material('cp_placard', 0x808080, rough=0.5, tex=os.path.join(TEX, 'placards.png'))
    M['paint'] = K.material('cp_paint', 0xe9eaeb, rough=0.32, coat=0.3)
    M['paint_dark'] = K.material('cp_paint_dark', 0x1f2a3a, rough=0.36, coat=0.3)
    M['paint_stripe'] = K.material('cp_paint_stripe', 0xc0281e, rough=0.34, coat=0.3)
    M['floor'] = K.material('cp_floor', 0x808080, rough=1.0, tex=tx + 'ribmat_diffuse_1024.jpg', normal=tx + 'ribmat_nor_gl_1024.jpg', rough_tex=tx + 'ribmat_rough_1024.jpg')
    M['frame'] = K.material('cp_seatframe', 0x8b8e92, rough=0.42, metal=0.7)
    M['rubber'] = K.material('cp_rubber', 0x262627, rough=0.85)
    M['strap'] = K.material('cp_strap', 0x45443f, rough=0.85)
    M['red'] = K.material('cp_red', 0xc21d16, rough=0.35)
    M['yellow'] = K.material('cp_yellow', 0xe6b416, rough=0.4)
    M['lens'] = K.material('cp_lens', 0xd8d4c8, rough=0.3)
    M['pouch'] = K.material('cp_pouch', 0x2f6a4a, rough=0.72)
    M['lamp_y'] = K.material('cp_lamp_amber', 0xffb020, rough=0.2, emit=0xffa018, emit_strength=0.6)
    M['glass'] = K.material('glass_clear', 0xffffff, rough=0.02, alpha=0.06)
    M['glass_roof'] = K.material('glass_roof', 0x2aa69e, rough=0.02, alpha=0.42)  # 照片里顶窗是青绿色
    for s in ('vemd1', 'vemd2', 'ai', 'gps', 'ann'):
        M['scr_' + s] = K.material('scr_' + s, 0x05070a, rough=0.15, emit=0x0b1420, emit_strength=1.0)


mats()

# ------------------------------------------------------------------ 仪表板坐标系
T = math.radians(L.PANEL_TILT)
PU = Vector((1, 0, 0))
PV = Vector((0, math.sin(T), math.cos(T)))
PN = Vector((0, -math.cos(T), math.sin(T)))  # 朝向驾驶员
PO = Vector(L.PANEL_ORIGIN)


def PW(u, v, w=0.0):
    return PO + PU * u + PV * v + PN * w


def to_panel(co):
    d = Vector(co) - PO
    return d.dot(PU), d.dot(PV), d.dot(PN)


U0, U1, V0, V1 = -L.PANEL_HALF_W, L.PANEL_HALF_W, -0.52, 0.0
PAINT_UV = ((0.5 - U0) / (U1 - U0) * 0 + 0.47, 0.03)  # 仪表板漆面（印刷图左下空白处）
BLACK_UV = ((L.ANNUNCIATOR['u'] - U0) / (U1 - U0), (L.ANNUNCIATOR['v'] - V0) / (V1 - V0))


def decal_uv(ob, side=PAINT_UV, min_dot=0.6):
    def f(co, n):
        if n.dot(PN) > min_dot:
            u, v, _ = to_panel(co)
            return ((u - U0) / (U1 - U0), (v - V0) / (V1 - V0))
        return side

    return K.uv_from_fn(ob, f)


def panel_obj(name, verts_uvw, faces, mat, smooth=0):
    """用仪表板局部坐标 (u, v, w) 建网格。"""
    return K.mesh_obj(name, [PW(*p) for p in verts_uvw], faces, mat, smooth=smooth)


def panel_box(name, u, v, w, h, w0, w1, mat, bevel=0.0, side=BLACK_UV):
    ob = K.box(name, (w, h, w1 - w0), (0, 0, 0), mat)
    K.map_verts(ob, lambda c: PW(u + c[0], v + c[1], (w0 + w1) / 2 + c[2]))
    if bevel:
        K.add_bevel(ob, bevel, 2)
        K.apply_mods(ob)
    if mat is M['panel']:
        decal_uv(ob, side)
    return ob


def lathe(name, profile, center_uv, w_base, mat, seg=48, smooth=40):
    """绕仪表板法线旋转的回转体。profile：[(r, w)]，w 为相对 w_base 的高度。"""
    u, v = center_uv
    verts, faces = [], []
    n = len(profile)
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for r, w in profile:
            verts.append(PW(u + r * math.cos(a), v + r * math.sin(a), w_base + w))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(n - 1):
            faces.append((i * n + j, i2 * n + j, i2 * n + j + 1, i * n + j + 1))
    ob = K.mesh_obj(name, verts, faces, mat, smooth=None)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)  # 轴心处的重合点
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    K.shade(ob, smooth)
    return ob


def panel_disc(name, u, v, r, w, mat, seg=48):
    verts = [PW(u, v, w)] + [PW(u + r * math.cos(2 * math.pi * i / seg), v + r * math.sin(2 * math.pi * i / seg), w) for i in range(seg)]
    faces = [(0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)]
    return K.mesh_obj(name, verts, faces, mat, smooth=0)


def panel_quad(name, u, v, w_, h, w, mat):
    verts = [PW(u - w_ / 2, v - h / 2, w), PW(u + w_ / 2, v - h / 2, w), PW(u + w_ / 2, v + h / 2, w), PW(u - w_ / 2, v + h / 2, w)]
    ob = K.mesh_obj(name, verts, [(0, 1, 2, 3)], mat, smooth=0)
    uv = K.uv_layer(ob)
    for li, t in zip(range(4), [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[li].uv = t
    return ob


STATIC = []  # 静态部件（最后按材质合并、烘焙 AO）
BANDS = []  # 窗框、门缝这类细长的环：不进 AO 贴图（展开后碎成很多小岛，烘出来边缘参差不齐），按材质合并单独导出
DYNAMIC = []  # 指针、屏幕、操纵杆、玻璃等需要单独控制的部件


def S(ob):
    STATIC.append(ob)
    return ob


def D(ob, **extras):
    for k, v in extras.items():
        ob[k] = v
    DYNAMIC.append(ob)
    return ob


# ------------------------------------------------------------------ 机身外壳（截面放样）
# 截面数据与插值见 heli_shape.py（与外观模型共用）
STATIONS, Y_TIP, Z_TIP = HS.STATIONS, HS.Y_TIP, HS.Z_TIP
section, spow, ring_point = HS.section, HS.spow, HS.ring_point


def shell_surface(name, mat_list, inset=0.0):
    ys = []
    y = STATIONS[0][0]
    while y < 2.44:
        ys.append(y)
        y += 0.03 if y < 1.0 else 0.015
    ys.append(2.445)
    NT = 160
    verts, faces = [], []
    for y in ys:
        # 涂装分色线处吸附一圈顶点（边界平滑，不出现锯齿）
        for t in HS.ring_ts(*section(y), NT):
            verts.append(ring_point(y, t))
    nr = len(ys)
    for r in range(nr - 1):
        for i in range(NT):
            i2 = (i + 1) % NT
            faces.append((r * NT + i, r * NT + i2, (r + 1) * NT + i2, (r + 1) * NT + i))
    tip = len(verts)
    verts.append(Vector((0, Y_TIP, Z_TIP)))
    last = (nr - 1) * NT
    for i in range(NT):
        faces.append((last + i, last + (i + 1) % NT, tip))
    # 后端封口（客舱后壁）
    rc = len(verts)
    W, Zt, Zb, e = section(ys[0])
    verts.append(Vector((0, ys[0], (Zt + Zb) / 2)))
    for i in range(NT):
        faces.append(((i + 1) % NT, i, rc))
    ob = K.mesh_obj(name, verts, faces, None, smooth=None)
    for m in mat_list:
        ob.data.materials.append(m)
    K.fix_normals(ob)
    if inset:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.normal_update()
        for v in bm.verts:
            v.co -= v.normal * inset
        bm.to_mesh(ob.data)
        bm.free()
    K.shade(ob, 50)
    return ob


C_REF = Vector((0.0, 1.05, 0.15))


def azel_dir(az, el):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))


def cone_cutter(name, poly, r0=0.35, r1=2.2):
    dirs = [azel_dir(a, e) for a, e in poly]
    dc = sum(dirs, Vector()).normalized()
    n = len(dirs)
    verts = [C_REF + d * r0 for d in dirs] + [C_REF + d * r1 for d in dirs] + [C_REF + dc * r0, C_REF + dc * r1]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        faces.append((2 * n, j, i))
        faces.append((2 * n + 1, n + i, n + j))
    ob = K.mesh_obj(name, verts, faces, None)
    K.fix_normals(ob)
    return ob


def round_poly(pts, r, steps=5):
    """二维多边形倒圆角。"""
    out = []
    n = len(pts)
    for i in range(n):
        a, b, c = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        d1, d2 = (a - b), (c - b)
        rr = min(r, d1.length * 0.45, d2.length * 0.45)
        p1, p2 = b + d1.normalized() * rr, b + d2.normalized() * rr
        for k in range(steps + 1):
            t = k / steps
            q = p1 * (1 - t) ** 2 + b * 2 * t * (1 - t) + p2 * t * t
            out.append((q.x, q.y))
    return out


def poly_area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def prism_cutter(name, poly2d, axis, a0, a1):
    if poly_area(poly2d) < 0:
        poly2d = poly2d[::-1]
    return K.prism(name, poly2d, a0, a1, None, axis=axis)


def mirror_az(poly):
    return [(-a, e) for a, e in poly][::-1]


def mirror_x(poly):
    return [(-x, y) for x, y in poly][::-1]


# 风挡（从 C_REF 看的方位角、高度角）。外缘留出约 8 cm 的门柱，上缘与顶窗之间留出约 10 cm 的横梁，
# 否则两个窗洞的边几乎重合，窗框会互相穿插；中柱约 4 cm 宽。转角处的短线段让圆角平滑后仍然紧凑。
WINDSCREEN = [(0.9, -4), (0.9, -6.5), (4, -6.6), (16, -7), (30, -12), (41, -24), (48, -40), (57, -43), (62.5, -24), (64.5, 0), (64, 22), (57, 40), (39, 52), (20, 57), (4, 58.4), (0.9, 58.6), (0.9, 54), (0.9, 30), (0.9, 10)]
DOOR = [(0.34, -0.26), (1.34, -0.26), (1.35, 0.18), (1.20, 0.74), (0.34, 0.76)]
REAR = [(-0.98, -0.16), (0.12, -0.16), (0.12, 0.74), (-0.98, 0.71)]
ROOF = [(0.11, 0.78), (0.56, 0.78), (0.58, 1.26), (0.11, 1.36)]
CHIN = [(0.10, 1.93), (0.56, 1.93), (0.50, 2.30), (0.10, 2.33)]


def door_poly():
    return round_poly(DOOR, 0.08)


def rear_poly():
    return round_poly(REAR, 0.08)


def roof_poly(side):
    return round_poly(ROOF if side > 0 else mirror_x(ROOF), 0.09)


def chin_poly(side):
    return round_poly(CHIN if side > 0 else mirror_x(CHIN), 0.08)


def window_cutters():
    cs = []
    for side in (1, -1):
        sfx = 'R' if side > 0 else 'L'
        ws = WINDSCREEN if side > 0 else mirror_az(WINDSCREEN)
        cs.append(('ws_' + sfx, cone_cutter('cut_ws_' + sfx, round_poly_az(ws)), 'clear'))
        cs.append(('door_' + sfx, prism_cutter('cut_door_' + sfx, door_poly(), 'X', 0.4 * side, 1.6 * side), 'clear'))
        cs.append(('rear_' + sfx, prism_cutter('cut_rear_' + sfx, rear_poly(), 'X', 0.4 * side, 1.6 * side), 'clear'))
        cs.append(('roof_' + sfx, prism_cutter('cut_roof_' + sfx, roof_poly(side), 'Z', 0.55, 1.5), 'roof'))
        cs.append(('chin_' + sfx, prism_cutter('cut_chin_' + sfx, chin_poly(side), 'Z', -1.3, -0.42), 'clear'))
    return cs


def round_poly_az(poly, iters=3):
    """风挡轮廓（方位角、高度角）用切角法磨圆：折线变成光滑曲线，窗框才不会一节一节地拐弯。"""
    pts = list(poly)
    for _ in range(iters):
        out = []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            out.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
            out.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
        pts = out
    return pts


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def build_shell():
    shell = shell_surface('shell', [M['paint'], M['lining']])
    K.add_solidify(shell, 0.032, -1.0, mat_offset=1, rim_offset=1)
    K.apply_mods(shell)
    cutters = window_cutters()
    for _, c, _kind in cutters:
        K.boolean(shell, c, 'DIFFERENCE', 'MANIFOLD')
    K.apply_mods(shell)
    # 涂装：外表面（材质 0）按位置分成白色、腹部深灰蓝、红色腰线；
    # 开窗切口的截面（布尔运算新生成的面，位于壳体厚度之内）改成黑色橡胶，与窗口密封条连成一体
    me = shell.data
    me.materials.append(M['paint_dark'])
    me.materials.append(M['paint_stripe'])
    me.materials.append(M['seal'])
    slots = {0: 0, 1: len(me.materials) - 3, 2: len(me.materials) - 2}
    seal_slot = len(me.materials) - 1
    outer = shell_surface('outer_ref', [M['paint']])
    om = outer.data
    obvh = BVHTree.FromPolygons([v.co.copy() for v in om.vertices], [p.vertices[:] for p in om.polygons])
    K.delete(outer)
    for poly in me.polygons:
        if poly.material_index == 0:
            hit = obvh.find_nearest(poly.center)
            if hit[0] is not None and hit[3] > 0.004:
                poly.material_index = seal_slot
            else:
                poly.material_index = slots[HS.livery_slot(poly.center)]
    # 玻璃：外表面向内 6 mm，取窗口范围（略大）内的面
    glass = {}
    surf = shell_surface('glass_src', [M['glass']], inset=0.006)
    me = surf.data
    for name, c, kind in cutters:
        sel = []
        if name.startswith('ws_'):
            poly = round_poly_az(WINDSCREEN if name.endswith('R') else mirror_az(WINDSCREEN))
            for p in me.polygons:
                d = (p.center - C_REF).normalized()
                az = math.degrees(math.atan2(d.x, d.y))
                el = math.degrees(math.asin(max(-1, min(1, d.z))))
                hit = point_in_poly(az, el, poly)
                if not hit:
                    for vi in p.vertices:
                        dv = (me.vertices[vi].co - C_REF).normalized()
                        if point_in_poly(math.degrees(math.atan2(dv.x, dv.y)), math.degrees(math.asin(max(-1, min(1, dv.z)))), poly):
                            hit = True
                            break
                if hit and p.normal.dot(d) > 0.2:
                    sel.append(p.index)
        else:
            side = 1 if name.endswith('R') else -1
            if name.startswith('door'):
                poly, ax = door_poly(), 'X'
            elif name.startswith('rear'):
                poly, ax = rear_poly(), 'X'
            elif name.startswith('roof'):
                poly, ax = roof_poly(side), 'Z'
            else:
                poly, ax = chin_poly(side), 'Z'

            def pick(co):
                if ax == 'X':
                    return co.x * side > 0.4 and point_in_poly(co.y, co.z, poly)
                if name.startswith('roof'):
                    return co.z > 0.55 and point_in_poly(co.x, co.y, poly)
                return -1.3 < co.z < -0.42 and point_in_poly(co.x, co.y, poly)

            for p in me.polygons:
                if pick(p.center) or any(pick(me.vertices[vi].co) for vi in p.vertices):
                    if ax == 'X' and abs(p.normal.x) < 0.3:
                        continue
                    sel.append(p.index)
        if not sel:
            continue
        bm = bmesh.new()
        bm.from_mesh(me)
        keep = set(sel)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
        g = K.bm_to_obj('glass_' + name, bm, M['glass_roof'] if kind == 'roof' else M['glass'], smooth=50)
        glass[name] = g
    K.delete(surf)
    for _, c, _ in cutters:
        K.delete(c)
    return shell, glass


# ------------------------------------------------------------------ 仪表板
def panel_outline():
    W, B = L.PANEL_HALF_W, L.PANEL_BOTTOM
    r = 0.03
    pts = []
    for k in range(5):  # 左下圆角
        a = math.radians(180 + 90 * k / 4)
        pts.append((-W + r + r * math.cos(a), B + r + r * math.sin(a)))
    for k in range(5):  # 右下圆角
        a = math.radians(270 + 90 * k / 4)
        pts.append((W - r + r * math.cos(a), B + r + r * math.sin(a)))
    n = 48
    for k in range(n + 1):  # 顶边弧（右 → 左）
        u = W - 2 * W * k / n
        pts.append((u, L.panel_top(u)))
    return pts


def build_panel():
    holes = []
    for g in L.GAUGES:
        holes.append(K.circle(g['d'] / 2 + 0.0015, 48, g['u'], g['v'])[::-1])
    A = L.AI
    holes.append([(x + A['u'], y + A['v']) for x, y in K.rounded_rect(A['w'] + 0.004, A['h'] + 0.004, 0.004)][::-1])
    face = K.cdt_face('panel_face', panel_outline(), holes, M['panel'])
    K.extrude_flat(face, 0.004)
    K.map_verts(face, lambda c: PW(c[0], c[1], c[2]))
    decal_uv(face, PAINT_UV)
    S(face)
    # 仪表板背板（防止从缝隙看穿）
    back = K.cdt_face('panel_back', panel_outline(), [], M['black'])
    K.map_verts(back, lambda c: PW(c[0], c[1], -0.03))
    K.fix_normals(back)
    S(back)
    # 螺丝
    for i, (u, v) in enumerate(L.screw_positions()):
        S(lathe(f'screw{i}', [(0.0, 0.0018), (0.0018, 0.0016), (0.0026, 0.0008), (0.0027, 0.0)], (u, v), 0.004, M['metal'], seg=12, smooth=60))
    # 圆形仪表
    slots = {k: i for i, k in enumerate(['asi', 'alt', 'vsi', 'turn', 'card', 'overlay', 'nr', 'clock'])}

    def slot_rect(k):
        i = slots[k]
        return ((i % 4) / 4, 1 - (i // 4 + 1) / 2, (i % 4 + 1) / 4, 1 - (i // 4) / 2)

    for g in L.GAUGES:
        gid, u, v, d = g['id'], g['u'], g['v'], g['d']
        R = d / 2
        ri, ro = R + 0.0012, R + 0.0075
        # 照片里的表框很厚：凸出仪表板约 1.5 cm，内圈带倒角
        S(lathe(f'bezel_{gid}', [(ri, -0.009), (ri, 0.011), (ri + 0.0025, 0.0145), (ro - 0.003, 0.0152), (ro, 0.0128), (ro, 0.004)], (u, v), 0.0, M['black'], seg=64))
        if gid in ('alt', 'hsi', 'hdg2'):
            # 左下角的调节旋钮（气压 / 航向游标）
            S(lathe(f'adj_{gid}', [(0.0, 0.024), (0.0062, 0.0235), (0.0072, 0.020), (0.0072, 0.008), (0.0052, 0.006), (0.0052, 0.0)],
                    (u - R * 0.92, v - R * 0.92), 0.004, M['knob'], seg=20))
        if gid == 'nr':
            S(lathe('nr_test', [(0.0, 0.016), (0.004, 0.0155), (0.0045, 0.0)], (u, v - R - 0.012), 0.004, M['knob'], seg=14))
        for cu, cv in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            k = (d + 0.008) / 2 - 0.0045
            S(lathe(f'gscrew_{gid}_{cu}{cv}', [(0.0, 0.0014), (0.0015, 0.0012), (0.002, 0.0)], (u + cu * k, v + cv * k), 0.004, M['dmetal'], seg=10, smooth=60))
        kind = {'asi': 'asi', 'alt': 'alt', 'vsi': 'vsi', 'turn': 'turn', 'nr': 'nr', 'clock': 'clock', 'hsi': 'card', 'hdg2': 'card'}[gid]
        face = panel_disc(f'face_{gid}', u, v, R + 0.0016, -0.009, M['gauge'], 64)
        K.uv_disc(face, PW(u, v, -0.009), PU, PV, R / 0.98, slot_rect(kind))
        if kind == 'card':
            # 刻度盘随航向转动
            D(face, axis=list(game_vec(PN)), gauge=gid, role='card')
            face.name = f'ndl_{gid}_card'
            K.set_origin(face, PW(u, v, -0.009))
            ov = panel_disc(f'overlay_{gid}', u, v, R, -0.0065, M['overlay'], 64)
            K.uv_disc(ov, PW(u, v, -0.0065), PU, PV, R / 0.98, slot_rect('overlay'))
            S(ov)
        else:
            S(face)
        # 表盘玻璃（嵌在表框里）
        D(panel_disc(f'gglass_{gid}', u, v, ri, 0.0105, M['gglass'], 48), role='gauge_glass')
        # 指针
        for nd in needles_for(gid, R):
            D(nd, axis=list(game_vec(PN)), gauge=gid)
    # 电子姿态仪：方形屏幕 + 外框
    A = L.AI
    frame = K.cdt_face('ai_frame', K.rounded_rect(A['frame_w'], A['frame_h'], 0.005),
                       [K.rounded_rect(A['w'] + 0.002, A['h'] + 0.002, 0.003)[::-1]], M['black'])
    K.extrude_flat(frame, 0.009)
    K.map_verts(frame, lambda c: PW(A['u'] + c[0], A['v'] + c[1], c[2]))
    S(frame)
    D(panel_quad('scr_ai', A['u'], A['v'], A['w'] + 0.003, A['h'] + 0.003, -0.002, M['scr_ai']), role='screen')
    # 顶部 PITCH SYNC 拨片 + 右下角旋钮
    S(panel_box('ai_sync', A['u'], A['v'] + A['frame_h'] / 2 + 0.004, 0.030, 0.008, 0.004, 0.012, M['black'], bevel=0.002))
    S(lathe('ai_knob', [(0.0, 0.016), (0.0050, 0.0155), (0.006, 0.006), (0.006, 0.0)], (A['u'] + 0.030, A['v'] - 0.045), 0.004, M['knob'], seg=20))


def game_vec(v):
    """Blender 方向 → 游戏坐标方向"""
    return (v.x, v.z, -v.y)


def needle_mesh(name, length, tail, w0, w1, mat, w_level, u, v, tip_w=None, angle=0.0):
    """以仪表中心为原点、指向 12 点的扁平指针（厚 0.7 mm）。"""
    tip_w = tip_w if tip_w is not None else w1 * 0.4
    pts2 = [(-w0 / 2, -tail), (w0 / 2, -tail), (w1 / 2, length * 0.75), (tip_w / 2, length), (-tip_w / 2, length), (-w1 / 2, length * 0.75)]
    ca, sa = math.cos(angle), math.sin(angle)
    th = 0.0007
    verts = []
    for z in (0.0, th):
        for x, y in pts2:
            xr, yr = x * ca + y * sa, -x * sa + y * ca
            verts.append(PW(u + xr, v + yr, w_level + z))
    n = len(pts2)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    ob = K.mesh_obj(name, verts, faces, mat, smooth=0)
    K.fix_normals(ob)
    return ob


def needles_for(gid, R):
    g = next(x for x in L.GAUGES if x['id'] == gid)
    u, v = g['u'], g['v']
    w = -0.0045
    out = []

    def cap(name, r):
        return lathe(name, [(0.0, 0.0025), (r * 0.8, 0.0024), (r, 0.0012), (r, 0.0)], (u, v), w, M['black'], seg=20)

    if gid in ('asi', 'vsi', 'nr'):
        nd = needle_mesh(f'ndl_{gid}_main', R * 0.86, R * 0.22, R * 0.07, R * 0.055, M['needle'], w, u, v)
        out.append(nd)
    elif gid == 'alt':
        out.append(needle_mesh('ndl_alt_100', R * 0.88, R * 0.2, R * 0.05, R * 0.04, M['needle'], w + 0.0008, u, v))
        out.append(needle_mesh('ndl_alt_1000', R * 0.55, R * 0.12, R * 0.10, R * 0.09, M['needle'], w, u, v, tip_w=R * 0.02))
    elif gid == 'clock':
        out.append(needle_mesh('ndl_clock_hour', R * 0.5, R * 0.1, R * 0.08, R * 0.07, M['needle'], w, u, v))
        out.append(needle_mesh('ndl_clock_min', R * 0.8, R * 0.12, R * 0.06, R * 0.05, M['needle'], w + 0.0008, u, v))
        out.append(needle_mesh('ndl_clock_sec', R * 0.88, R * 0.25, R * 0.025, R * 0.02, M['orange'], w + 0.0016, u, v))
    elif gid == 'turn':
        out.append(needle_mesh('ndl_turn_needle', R * 0.62, R * 0.05, R * 0.10, R * 0.08, M['needle'], w, u, v))
        # 侧滑小球：原点在仪表中心，绕轴转动即沿弧形管移动
        ball = K.sphere('ndl_turn_ball', R * 0.065, (0, 0, 0), M['black'], 16, 8)
        K.map_verts(ball, lambda c: tuple(PW(u, v - R * 0.42, w + 0.002) + PU * c[0] + PV * c[1] + PN * c[2]))
        out.append(ball)
    for nd in out:
        K.set_origin(nd, PW(u, v, w))
        nd.name = nd.name  # 保留名字
    if gid not in ('turn',):
        S(cap(f'cap_{gid}', R * 0.08))
    return out


def build_units():
    # VEMD
    V = L.VEMD
    S(panel_box('vemd_body', V['u'], V['v'], V['w'], V['h'], 0.004, 0.022, M['panel'], bevel=0.003))
    for i, scr in enumerate(V['screens']):
        D(panel_quad(f'scr_vemd{i + 1}', scr['u'], scr['v'], scr['w'], scr['h'], 0.0223, M[f'scr_vemd{i + 1}']), role='screen')
    n = len(V['keys'])
    for i in range(n):
        kv = V['v'] + V['h'] / 2 - 0.030 - i * (V['h'] - 0.05) / (n - 1)
        S(panel_box(f'vemd_key{i}', V['keys_u'], kv, 0.028, 0.0145, 0.022, 0.0265, M['panel'], bevel=0.0012))
    # GPS
    G = L.GPS
    S(panel_box('gps_body', G['u'], G['v'], G['w'], G['h'], 0.004, 0.026, M['panel'], bevel=0.003))
    sc = G['screen']
    D(panel_quad('scr_gps', sc['u'], sc['v'], sc['w'], sc['h'], 0.0263, M['scr_gps']), role='screen')
    for cu in (-0.066, 0.066):
        S(lathe(f'gps_knob_o{cu}', [(0.0, 0.010), (0.0095, 0.0098), (0.0105, 0.004), (0.0105, 0.0)], (G['u'] + cu, G['v'] - 0.016), 0.026, M['knob'], seg=28))
        S(lathe(f'gps_knob_i{cu}', [(0.0, 0.019), (0.0062, 0.0185), (0.0068, 0.010), (0.0068, 0.0)], (G['u'] + cu, G['v'] - 0.016), 0.026, M['knob'], seg=24))
    for i in range(6):
        S(panel_box(f'gps_btn{i}', G['u'] - 0.045 + i * 0.018, G['v'] - 0.031, 0.013, 0.007, 0.026, 0.029, M['black'], bevel=0.001))
    for i in range(4):
        S(panel_box(f'gps_sbtn{i}', G['u'] + 0.054 + (i % 2) * 0.022, G['v'] + 0.006 - (i // 2) * 0.013, 0.016, 0.008, 0.026, 0.029, M['black'], bevel=0.001))
    # 电台（较厚的挂装电台）
    R2 = L.RADIO
    S(panel_box('radio_body', R2['u'], R2['v'], R2['w'], R2['h'], 0.004, 0.042, M['panel'], bevel=0.005))
    S(panel_box('radio_mount', R2['u'] - R2['w'] / 2 - 0.012, R2['v'], 0.03, 0.05, 0.004, 0.030, M['black'], bevel=0.003))
    S(lathe('radio_knob', [(0.0, 0.012), (0.007, 0.0115), (0.0075, 0.0), ], (R2['u'] - 0.098, R2['v'] + 0.012), 0.042, M['knob'], seg=20))
    for i in range(7):
        S(panel_box(f'radio_btn{i}', R2['u'] - 0.065 + i * 0.019, R2['v'] - 0.019, 0.012, 0.007, 0.042, 0.0445, M['black'], bevel=0.001))
    # 话筒线：从电台右下绕到地板
    p0 = PW(R2['u'] - 0.12, R2['v'] - 0.02, 0.03)
    S(K.tube_path('radio_cord', K.round_path([p0, p0 + Vector((-0.05, -0.03, -0.12)), p0 + Vector((-0.08, -0.12, -0.25)), p0 + Vector((-0.10, -0.25, -0.45))], 0.06), 0.0035, M['rubber'], seg=8))
    H = L.HELISAFE
    S(panel_box('helisafe', H['u'], H['v'], H['w'], H['h'], 0.004, 0.020, M['panel'], bevel=0.002))
    S(panel_box('helisafe_btn', H['u'] + 0.058, H['v'] + 0.004, 0.012, 0.012, 0.020, 0.026, M['black'], bevel=0.002))
    E = L.ELT
    S(panel_box('elt', E['u'], E['v'], E['w'], E['h'], 0.004, 0.018, M['panel'], bevel=0.002))
    S(panel_box('elt_sw', E['u'] - 0.004, E['v'] - 0.002, 0.008, 0.016, 0.018, 0.030, M['red'], bevel=0.001))
    # 照明旋钮
    for i, k in enumerate(L.KNOBS):
        S(lathe(f'knob{i}', [(0.0, 0.016), (0.0072, 0.0155), (0.0082, 0.012), (0.0085, 0.003), (0.0095, 0.0025), (0.0095, 0.0)], (k['u'], k['v']), 0.004, M['knob'], seg=24))
        S(panel_box(f'knob_mark{i}', k['u'], k['v'] + 0.0045, 0.0012, 0.004, 0.0195, 0.0201, M['needle']))
    # 告警灯板（动态屏）
    A = L.ANNUNCIATOR
    S(panel_box('ann_frame', A['u'], A['v'], A['w'] + 0.008, A['h'] + 0.008, 0.004, 0.009, M['black'], bevel=0.0015))
    D(panel_quad('scr_ann', A['u'], A['v'], A['w'], A['h'], 0.0092, M['scr_ann']), role='screen')
    RP = L.REG_PLATE
    S(panel_box('reg_plate', RP['u'], RP['v'], RP['w'], RP['h'], 0.004, 0.0055, M['panel']))
    # 应急开关：黑色底座 + 红色拨杆 + 护盖
    E = L.EMER_SW
    S(panel_box('emer_base', E['u'], E['v'], 0.030, 0.044, 0.004, 0.010, M['black'], bevel=0.004))
    S(panel_box('emer_lever', E['u'], E['v'] + 0.004, 0.009, 0.018, 0.010, 0.030, M['red'], bevel=0.002))
    for su in (-0.011, 0.011):
        S(panel_box(f'emer_guard{su}', E['u'] + su, E['v'], 0.003, 0.034, 0.010, 0.034, M['black'], bevel=0.001))
    # 右缘开关条
    SW = L.SWITCH_STRIP
    S(panel_box('sw_strip', SW['u'], SW['v'], SW['w'], SW['h'], 0.004, 0.007, M['panel'], bevel=0.0015))
    for i, tv in enumerate(SW['toggles']):
        S(lathe(f'sw_nut{i}', [(0.0, 0.004), (0.0052, 0.004), (0.0052, 0.0)], (SW['u'], tv), 0.007, M['metal'], seg=6, smooth=0))
        bat = K.cylinder(f'sw_bat{i}', 0.0016, 0.020, (0, 0, 0), M['metal'], 10, r2=0.0024)
        K.bake_transform(bat)
        K.map_verts(bat, lambda c, tv=tv: tuple(PW(SW['u'], tv, 0.011) + Matrix.Rotation(math.radians(-70), 3, PU) @ (PU * c[0] + PN * c[1] + PV * (c[2] + 0.009) * 1.0) - PV * 0.0))
        S(bat)
    S(lathe('sw_lamp', [(0.0, 0.007), (0.003, 0.0065), (0.0042, 0.004), (0.0045, 0.0)], (SW['u'], SW['lamp']), 0.007, M['lamp_y'], seg=16))


# ------------------------------------------------------------------ 遮光罩
# 参照照片：罩檐沿仪表板顶边与两侧包住仪表板，向驾驶员方向伸出约 20 cm；
# 右侧一直包到仪表板底部，左侧只包到时钟高度；后沿是包皮革的卷边。
HOOD_LEFT_END = -0.21
HOOD_RIGHT_END = -0.47


def hood_outline(n=72):
    """罩檐根部沿仪表板外缘的曲线（仪表板局部 u, v），从左翼底端 → 顶边 → 右翼底端。"""
    W = L.PANEL_HALF_W + 0.012
    top_l = L.panel_top(-L.PANEL_HALF_W) + 0.006
    pts = []
    k = 10
    for i in range(k):  # 左翼（竖直向上）
        pts.append((-W, HOOD_LEFT_END + (top_l - HOOD_LEFT_END) * i / k))
    m = n - 2 * k
    for i in range(m + 1):  # 顶边
        u = -W + 2 * W * i / m
        pts.append((u, L.panel_top(max(-L.PANEL_HALF_W, min(L.PANEL_HALF_W, u))) + 0.006))
    top_r = pts[-1][1]
    for i in range(1, k + 1):  # 右翼（竖直向下）
        pts.append((W, top_r + (HOOD_RIGHT_END - top_r) * i / k))
    return pts


def build_glare():
    pts = hood_outline()
    n = len(pts)
    # 每个点：外法线（仪表板平面内）、伸出深度、外翻量
    rows = []
    for i, (u, v) in enumerate(pts):
        a = Vector(pts[max(0, i - 1)])
        b = Vector(pts[min(n - 1, i + 1)])
        t = (b - a).normalized()
        mo = Vector((-t.y, t.x))  # 行进方向左侧 = 外侧
        top = v > -0.17
        # 顶部伸出最深，翼部向下逐渐变浅
        depth = 0.205 - 0.04 * abs(u) / 0.53 if top else 0.205 - 0.04 - 0.16 * min(1.0, (-0.17 - v) / 0.30)
        flare = 0.04 if top else 0.025
        rows.append((u, v, mo, depth, flare))
    M_ = 14
    verts, faces = [], []
    lip = []
    for (u, v, mo, depth, flare) in rows:
        base = PW(u, v, 0.0)
        m3 = PU * mo.x + PV * mo.y
        for j in range(M_ + 1):
            t = -0.6 + 1.6 * j / M_  # t<0：向前（风挡方向）延伸的顶板/侧板；t>0：伸向驾驶员的罩檐
            if t < 0:
                p = base + m3 * (0.006 + flare) - PN * (0.32 * -t) - Vector((0, 0, 0.03 * -t))
            else:
                bulge = math.sin(math.pi * t) * 0.012
                p = base + m3 * (0.006 + flare * math.sin(math.pi / 2 * t) ** 0.7 + bulge) + PN * (depth * t)
            verts.append(p)
        lip.append(verts[-1])
    for i in range(n - 1):
        for j in range(M_):
            a = i * (M_ + 1) + j
            faces.append((a, a + 1, a + M_ + 2, a + M_ + 1))
    hood = K.mesh_obj('glare_hood', verts, faces, M['glare'], smooth=70)
    K.fix_normals(hood)
    K.add_solidify(hood, 0.010, 1.0)
    K.apply_mods(hood)
    K.shade(hood, 70)
    S(hood)
    # 后沿软包卷边（沿罩檐边缘的细管）+ 两翼底端封头
    S(K.tube_path('glare_roll', lip, 0.0085, M['glare'], seg=12))
    # 罩檐内侧的几个黑色卡扣（照片中可见）
    for k_, (u, v) in enumerate([(-0.30, -0.105), (-0.05, -0.012), (0.20, -0.04), (0.42, -0.098)]):
        p = PW(u, v, 0.09) + (PV * 0.045)
        S(K.box(f'hood_clip{k_}', (0.03, 0.012, 0.008), tuple(p), M['knob'], bevel=0.002))


# ------------------------------------------------------------------ 中央操纵台（基座）
def build_pedestal():
    prof = [(1.70, -0.405), (1.665, -0.53), (1.42, -0.645), (1.30, -0.70), (1.30, -0.78), (1.84, -0.78), (1.84, -0.405)]
    ped = K.prism('pedestal', prof, -0.13, 0.13, M['lining_d'], axis='X')
    K.add_bevel(ped, 0.006, 2)
    S(ped)
    # 音频控制面板（竖直面）
    n = Vector((0, -1, 0.29)).normalized()
    up = n.cross(Vector((1, 0, 0))).normalized() * -1
    c0 = Vector((0.0, 1.675, -0.468))

    def at(x, y, z):
        return tuple(c0 + Vector((1, 0, 0)) * x + up * y + n * z)

    ap = K.box('audio_panel', (0.17, 0.052, 0.012), (0, 0, 0), M['black'])
    K.map_verts(ap, lambda c: at(c[0], c[1], c[2] + 0.006))
    S(ap)
    for r in range(2):
        for i in range(7):
            b = K.box(f'audio_btn{r}{i}', (0.016, 0.009, 0.004), (0, 0, 0), M['dmetal'] if r == 0 else M['knob'])
            K.map_verts(b, lambda c, r=r, i=i: at(-0.066 + i * 0.019 + c[0], 0.012 - r * 0.020 + c[1], 0.013 + c[2]))
            S(b)
    kn = K.cylinder('audio_knob', 0.007, 0.012, (0, 0, 0), M['knob'], 20)
    K.map_verts(kn, lambda c: at(0.075 + c[0], 0.0 + c[1], 0.018 + c[2]))
    S(kn)
    # 斜面：应答机、开关组
    n2 = Vector((0, -0.115, 0.245)).normalized()
    n2 = Vector((0, -(0.645 - 0.53), (1.665 - 1.42))).normalized()
    n2 = Vector((0, -n2.z, n2.y)) if n2.y > 0 else n2
    along = Vector((0, 1.42 - 1.665, -0.645 + 0.53)).normalized()  # 沿斜面向下
    base = Vector((0, 1.60, -0.565))
    nrm = Vector((1, 0, 0)).cross(along).normalized()
    if nrm.z < 0:
        nrm = -nrm

    def at2(x, s, z):
        return tuple(base + Vector((1, 0, 0)) * x + along * s + nrm * z)

    units = [(0.0, 0.03, 0.20, 0.05), (0.0, 0.095, 0.20, 0.06), (0.0, 0.17, 0.22, 0.07)]
    for k, (x, s, w, h) in enumerate(units):
        b = K.box(f'ped_unit{k}', (w, h, 0.012), (0, 0, 0), M['black'])
        K.map_verts(b, lambda c, x=x, s=s: at2(x + c[0], s + c[1], 0.006 + c[2]))
        K.add_bevel(b, 0.002, 1)
        S(b)
    for k in range(5):
        kn = K.cylinder(f'ped_knob{k}', 0.0085 if k % 2 else 0.006, 0.02, (0, 0, 0), M['knob'], 18)
        K.map_verts(kn, lambda c, k=k: at2(-0.08 + k * 0.04 + c[0], 0.095 + c[1], 0.022 + c[2]))
        S(kn)
    for k in range(8):
        t = K.cylinder(f'ped_toggle{k}', 0.0018, 0.018, (0, 0, 0), M['metal'], 8)
        K.map_verts(t, lambda c, k=k: at2(-0.084 + k * 0.024 + c[0], 0.03 + c[1] * 0.3 + c[2] * 0.25, 0.020 + c[2] * 0.9))
        S(t)


# ------------------------------------------------------------------ 地板、脚蹬、操纵杆
def wall_x(bvh, y, z, side):
    hit = bvh.ray_cast(Vector((0.0, y, z)), Vector((side, 0, 0)))
    return hit[0].x if hit[0] is not None else None


PILOT_EXTRA = []  # 随机长座椅一起左右移动的总距杆底座


def build_floor_controls(bvh):
    # 地板：沿舱壁的实际宽度放样（方盒子会从机身下侧穿出去），橡胶地垫的凸棱横向
    rows = []
    y = -1.05
    while y < 1.86:
        rows.append((y, wall_x(bvh, y, -0.78, 1) or 0.7, wall_x(bvh, y, -0.78, -1) or -0.7))
        y += 0.03
    verts, faces = [], []
    for i, (y, xr, xl) in enumerate(rows):
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            verts.append((xl + (xr - xl) * t, y, -0.78))
        if i:
            a, b = (i - 1) * 5, i * 5
            for k in range(4):
                faces.append((a + k, a + k + 1, b + k + 1, b + k))
    fl = K.mesh_obj('floor', verts, faces, M['floor'], smooth=0)
    K.uv_box(fl, 1 / 0.45)
    S(fl)
    # 前舱地台（脚蹬区域，留出下视窗）
    hw = (wall_x(bvh, 1.90, -0.76, 1) or 0.6) - 0.004
    S(K.prism('pedal_deck', [(1.80, -0.80), (1.95, -0.80), (1.95, -0.74), (1.80, -0.76)], -hw, hw, M['lining_d'], axis='X'))
    # 脚蹬（驾驶员）
    for nm, dx in (('ctl_pedal_l', -0.12), ('ctl_pedal_r', 0.12)):
        x = 0.45 + dx
        pivot = Vector((x, 1.80, -0.76))
        arm = K.box(nm + '_arm', (0.025, 0.025, 0.20), (x, 1.80, -0.66), M['dmetal'], bevel=0.004)
        plate = K.box(nm + '_plate', (0.085, 0.018, 0.15), (x, 1.775, -0.60), M['rubber'], bevel=0.005, rot=(math.radians(-18), 0, 0))
        ped = K.join([arm, plate], nm)
        K.set_origin(ped, pivot)
        D(ped, role='pedal')
    # 周期变距杆、总距杆（新版握把，见 cyclic_v2 / collective_v2）
    base = Vector((0.45, 1.30, -0.78))
    D(cyclic_v2(base), role='cyclic')
    piv = Vector((0.20, 0.72, -0.50))
    D(collective_v2(piv), role='collective')
    PILOT_EXTRA.append(K.cylinder('col_hinge', 0.03, 0.06, (piv.x, piv.y, piv.z), M['dmetal'], 18, rot=(0, math.radians(90), 0)))
    PILOT_EXTRA.append(K.cylinder('col_friction', 0.016, 0.03, (piv.x + 0.045, piv.y, piv.z), M['knob'], 18, rot=(0, math.radians(90), 0)))
    PILOT_EXTRA.append(rbox('col_box', (0.08, 0.30, 0.20), (0.20, 0.70, -0.65), M['lining_d'], 0.012, 2))


# ------------------------------------------------------------------ 座椅
def strap(name, pts, width, thick=0.004):
    pts = [Vector(p) for p in pts]
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, -1, 0.3))).normalized() * (width / 2)
        nrm = t.cross(side).normalized() * thick
        for s in (side, -side):
            verts.append(p + s)
            verts.append(p + s + nrm)
    n = len(pts)
    for i in range(n - 1):
        a, b = i * 4, (i + 1) * 4
        faces += [(a, b, b + 2, a + 2), (a + 1, a + 3, b + 3, b + 1), (a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3)]
    ob = K.mesh_obj(name, verts, faces, M['strap'], smooth=30)
    K.fix_normals(ob)
    return ob


def build_seats():
    pilot = K.join(seat_v3('seat_r', 0.45) + PILOT_EXTRA, 'seat_pilot')
    K.set_origin(pilot, Vector((0.45, 1.0, -0.78)))
    D(pilot, role='seat')
    for p in seat_v3('seat_l', -0.45):
        S(p)
    # 灭火瓶（左座前侧，参照照片）
    ex = K.cylinder('ext_body', 0.045, 0.28, (-0.69, 1.20, -0.52), M['red'], 24, bevel=0.015)
    S(ex)
    S(K.cylinder('ext_head', 0.02, 0.06, (-0.69, 1.20, -0.35), M['dmetal'], 14))
    S(K.box('ext_handle', (0.02, 0.09, 0.012), (-0.69, 1.22, -0.315), M['knob'], bevel=0.004))
    for z in (-0.60, -0.44):
        S(K.torus(f'ext_strap{z}', 0.048, 0.006, (-0.69, 1.20, z), M['dmetal'], 24, 6))


# ------------------------------------------------------------------ 顶部操纵台、罗盘、耳机
def on_frame(frame, ob):
    """把在原点建好的部件放到局部坐标系 frame 里。"""
    K.apply_mods(ob)
    K.bake_transform(ob)
    ob.data.transform(frame)
    return ob


def build_overhead(bvh):
    """顶部操纵盒（参照照片：在风挡上沿正中、顶窗之间的前端）：两排断路器、红色指示灯、出风格栅、燃油切断与旋翼刹车手柄。
    外壳是一块贴着舱顶的软边盒，顺着舱顶的坡度前低后高。"""
    h0 = bvh.ray_cast(Vector((0, 1.18, 0.3)), Vector((0, 0, 1)))
    h1 = bvh.ray_cast(Vector((0, 1.46, 0.3)), Vector((0, 0, 1)))
    ax = (h0[0] - h1[0]).normalized()  # 沿舱顶向后
    nz = Vector((1, 0, 0)).cross(ax).normalized()
    if nz.z > 0:
        nz = -nz
    o = (h0[0] + h1[0]) / 2
    fr = Q.frame_at(o, Vector((1, 0, 0)), ax, nz)
    T = 0.056
    S(Q.pad('ovh_console', fr, 0.215, 0.33, T, 0.02, [M['lining_d']], tiles=[0.12], p=7.0, q=3.2, nu=14, nv=18))

    def at(x, y, z):
        return fr @ Matrix.Translation(Vector((x, y, z)))

    S(on_frame(at(0, 0, T + 0.001), K.box('ovh_panel', (0.176, 0.265, 0.004), (0, 0, 0), M['black'], bevel=0.0015)))
    for i in range(2):  # 两排断路器：黑色按钮 + 白色标记环
        for j in range(6):
            x, y = -0.07 + j * 0.028, 0.098 - i * 0.034
            S(on_frame(at(x, y, T + 0.0045), K.cylinder(f'cb{i}{j}', 0.0052, 0.007, (0, 0, 0), M['dmetal'], 14)))
            S(on_frame(at(x, y, T + 0.0085), K.cylinder(f'cbk{i}{j}', 0.0036, 0.008, (0, 0, 0), M['knob'], 12, bevel=0.0008)))
    S(on_frame(at(0.066, -0.112, T + 0.004), K.cylinder('ovh_lamp', 0.0065, 0.004, (0, 0, 0), M['red'], 16, bevel=0.001)))
    for k in range(7):  # 出风格栅
        S(on_frame(at(0.0, -0.060 - k * 0.0085, T + 0.0035), K.box(f'ovh_vent{k}', (0.052, 0.0036, 0.0032), (0, 0, 0), M['knob'])))
    # 燃油切断手柄（红）与旋翼刹车手柄（黄）：细拉杆在滑槽里，端头是彩色握手
    for nm, x, mat in (('fuel_lever', 0.058, M['red']), ('rotor_brake', -0.058, M['yellow'])):
        S(on_frame(at(x, -0.012, T + 0.0025), K.box(nm + '_slot', (0.010, 0.105, 0.002), (0, 0, 0), M['gap'])))
        y0 = 0.006 if x > 0 else -0.03
        a = fr @ Vector((x, y0, T + 0.003))
        b = fr @ Vector((x, y0 - 0.006, T + 0.036))
        S(K.tube_path(nm + '_rod', [a, b], 0.0032, M['brushed'], seg=10))
        S(on_frame(at(x, y0 - 0.006, T + 0.042) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), K.cylinder(nm, 0.0085, 0.036, (0, 0, 0), mat, 16, bevel=0.003)))
    # 风挡中柱顶端的磁罗盘：黑色圆筒壳 + 悬挂支架，视窗里是刻度带和橙色基准线，下面挂校正卡
    post = bvh.ray_cast(Vector((0, 1.05, 0.15)), azel_dir(0, 26))[0]
    aim = (Vector(L.EYE) - post).normalized()
    side = Vector((0, 0, 1)).cross(aim).normalized()
    up = aim.cross(side).normalized()
    c = post + aim * 0.095 - up * 0.01
    cf = Q.frame_at(c, side, up, aim)  # 局部 z 朝向驾驶员

    def on_c(x, y, z, rot=None):
        return cf @ Matrix.Translation(Vector((x, y, z))) @ (rot if rot else Matrix.Identity(4))

    S(on_frame(on_c(0, 0, -0.022), K.cylinder('compass_body', 0.034, 0.058, (0, 0, 0), M['black'], 32, bevel=0.008)))
    S(on_frame(on_c(0, 0, 0.0075), K.torus('compass_bezel', 0.0295, 0.0035, (0, 0, 0), M['black'], 32, 8)))
    S(on_frame(on_c(0, 0, 0.0035), K.cylinder('compass_back', 0.0265, 0.002, (0, 0, 0), M['gap'], 24)))
    S(placard('plc_compass_drum', 'compass_drum', c + aim * 0.0046, side, aim, 0.046, 0.023))
    S(on_frame(on_c(0, 0, 0.0075), K.box('compass_line', (0.0014, 0.030, 0.0012), (0, 0, 0), M['orange'])))
    S(K.sphere('compass_dome', 0.0285, tuple(c + aim * 0.0055), M['gglass'], 20, 10, (1, 1, 0.35)))
    S(K.tube_path('compass_arm', K.round_path([c - aim * 0.05 + up * 0.012, c - aim * 0.075 + up * 0.016, post + up * 0.018], 0.02), 0.006, M['black'], seg=10))
    S(rbox('compass_foot', (0.03, 0.022, 0.03), tuple(post + up * 0.018 + aim * 0.006), M['trim'], 0.004, 1))
    # 校正卡：挂在罗盘下方的一块薄板
    cc = c - up * 0.066 - aim * 0.012
    S(on_frame(Q.frame_at(cc, side, up, aim), K.box('compass_cardback', (0.086, 0.046, 0.003), (0, 0, 0), M['black'], bevel=0.001)))
    S(placard('plc_compass', 'compass_card', cc + aim * 0.0016, side, aim, 0.08, 0.04))
    S(K.tube_path('compass_cardhook', [cc + up * 0.02, c - up * 0.03], 0.0016, M['black'], seg=6))


# ------------------------------------------------------------------ 高精度细节（参照 AS350 机舱 360° 全景与 F-HGRU 驾驶舱照片）
from mathutils.bvhtree import BVHTree  # noqa: E402


def placard(name, kind, center, u_dir, n_dir, w, h):
    """贴在表面上的标牌（标牌图集里的一格），离表面 1.5 mm。"""
    c, u, n = Vector(center), Vector(u_dir).normalized(), Vector(n_dir).normalized()
    v = n.cross(u).normalized()
    c = c + n * 0.0015
    verts = [c - u * w / 2 - v * h / 2, c + u * w / 2 - v * h / 2, c + u * w / 2 + v * h / 2, c - u * w / 2 + v * h / 2]
    ob = K.mesh_obj(name, verts, [(0, 1, 2, 3)], M['placard'], smooth=0)
    u0, v0, u1, v1 = L.placard_uv(kind)
    uv = K.uv_layer(ob)
    for li, t in zip(range(4), [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
        uv.data[li].uv = t
    return ob


def inner_bvh(inset):
    """未开窗的机身内表面（向内 inset 米）及其 BVH，用于把密封条、顶板贴到舱壁上。"""
    ob = shell_surface('inner_ref', [M['felt']], inset=inset)
    me = ob.data
    bvh = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [p.vertices[:] for p in me.polygons])
    return ob, bvh


def resample(poly, step, closed=True):
    """二维折线按固定步长加密（让沿曲面的密封条贴合舱壁，而不是直线穿过）。"""
    out = []
    n = len(poly)
    for i in range(n if closed else n - 1):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        k = max(1, int((b - a).length / step))
        for j in range(k):
            p = a.lerp(b, j / k)
            out.append((p.x, p.y))
    return out


# 窗框截面（b：向窗洞中心为正，n：朝舱内为正，单位米）：
# 外圈是从舱壁微微抬起的饰条，里圈是压在玻璃上的橡胶条，最后一段一直伸到玻璃面，把开窗的切口盖住
TRIM_PROFILE = [(-0.036, -0.0012), (-0.033, 0.0026), (-0.026, 0.0046), (-0.012, 0.0054), (-0.0055, 0.0040), (-0.0035, 0.0018)]
RUBBER_PROFILE = [(-0.0048, 0.0012), (-0.0030, 0.0052), (0.0010, 0.0070), (0.0060, 0.0062), (0.0088, 0.0030), (0.0098, -0.0040), (0.0098, -0.0270)]


def inward(p):
    """舱壁上一点朝向舱内的大致方向。"""
    return Vector((0.0, min(p.y, 1.6), 0.0)) - p


def build_frames(bvh):
    """每个窗洞一圈窗框：饰条 + 橡胶条（沿舱壁扫掠截面，路径平滑过，不随网格抖动）。"""
    loops = []
    for side in (1, -1):
        sfx = 'R' if side > 0 else 'L'
        ws = round_poly_az(WINDSCREEN if side > 0 else mirror_az(WINDSCREEN))
        pts = []
        for az, el in resample(ws, 0.7):
            hit = bvh.ray_cast(C_REF, azel_dir(az, el))
            if hit[0] is not None:
                pts.append(hit[0])
        loops.append(('ws_' + sfx, pts))
        for nm, poly in (('door', door_poly()), ('rear', rear_poly())):
            pts = []
            for y, z in resample(poly, 0.012):
                hit = bvh.ray_cast(Vector((0.0, y, z)), Vector((side, 0, 0)))
                if hit[0] is not None:
                    pts.append(hit[0])
            loops.append((f'{nm}_{sfx}', pts))
        pts = []
        for x, y in resample(roof_poly(side), 0.012):
            hit = bvh.ray_cast(Vector((x, y, 0.2)), Vector((0, 0, 1)))
            if hit[0] is not None:
                pts.append(hit[0])
        loops.append(('roof_' + sfx, pts))
        pts = []
        for x, y in resample(chin_poly(side), 0.012):
            hit = bvh.ray_cast(Vector((x, y, -0.3)), Vector((0, 0, -1)))
            if hit[0] is not None:
                pts.append(hit[0])
        loops.append(('chin_' + sfx, pts))
    for name, pts in loops:
        if len(pts) < 8:
            continue
        path, ns = Q.surface_loop(bvh, pts, 0.011, 6, inward)
        BANDS.append(Q.sweep_ring('trim_' + name, path, ns, TRIM_PROFILE, M['trim']))
        BANDS.append(Q.sweep_ring('seal_' + name, path, ns, RUBBER_PROFILE, M['seal']))


def in_windscreen(p, margin=2.0):
    d = (p - C_REF).normalized()
    az = math.degrees(math.atan2(d.x, d.y))
    el = math.degrees(math.asin(max(-1, min(1, d.z))))
    for poly in (round_poly_az(WINDSCREEN), round_poly_az(mirror_az(WINDSCREEN))):
        if point_in_poly(az, el, poly):
            return True
        # 边缘附近也算（留出密封条的位置）
        for da, de in ((margin, 0), (-margin, 0), (0, margin), (0, -margin)):
            if point_in_poly(az + da, el + de, poly):
                return True
    return False


def in_roof_window(p, margin=0.018):
    """p 是否在顶窗窗洞里（或贴着边）。"""
    for side in (1, -1):
        poly = roof_poly(side)
        for dx, dy in ((0, 0), (margin, 0), (-margin, 0), (0, margin), (0, -margin)):
            if point_in_poly(p.x + dx, p.y + dy, poly):
                return True
    return False


def roof_ray(x, y):
    return Vector((x, y, 0.2)), Vector((0, 0, 1))


def build_roof_felt(bvh):
    """两块顶窗之间的黑色绒面顶板（向前一直铺到风挡上沿），上面是驾驶员 / 副驾驶耳机插孔与螺旋耳机线。"""
    def keep(p):
        return not in_windscreen(p, 0.55) and not in_roof_window(p, 0.012)

    S(Q.wall_panel('roof_felt', bvh, roof_ray, (0.0, 1.02), (0.094, 0.36), 0.03, 0.0028, 0.006, M['felt'], tile=0.25))
    S(Q.wall_panel('roof_header', bvh, roof_ray, (0.0, 1.46), (0.62, 0.235), 0.07, 0.0028, 0.006, M['felt'], step=0.009, tile=0.25, keep=keep))
    # 耳机插孔 + 标牌 + 螺旋线
    for sx, kind in ((0.062, 'pilot'), (-0.062, 'copilot')):
        hit = bvh.ray_cast(Vector((sx, 1.08, 0.3)), Vector((0, 0, 1)))
        if hit[0] is None:
            continue
        p, n = hit[0] - Vector((0, 0, 0.006)), -hit[1].normalized()
        if n.z > 0:
            n = -n
        jack = K.cylinder(f'jack_{kind}', 0.0085, 0.012, (0, 0, 0), M['dmetal'], 16)
        K.bake_transform(jack)
        rot = Vector((0, 0, 1)).rotation_difference(-n).to_matrix().to_4x4()
        jack.data.transform(rot)
        jack.data.transform(Matrix.Translation(p - n * 0.004))
        S(jack)
        S(placard(f'plc_{kind}', kind, p + Vector((0, -0.045, 0)), (1, 0, 0) if n.z < 0 else (-1, 0, 0), n, 0.050, 0.025))
        # 螺旋耳机线：从插孔垂下约 30 cm，末端插头
        start = p - n * 0.012
        pts = []
        coils, length = 34, 0.30
        sway = Vector((sx * 0.8, -0.25, 0)).normalized()
        for k in range(coils * 10 + 1):
            t = k / (coils * 10)
            c = start + Vector((0, 0, -length * t)) + sway * 0.05 * math.sin(math.pi * t)
            th = 2 * math.pi * coils * t
            pts.append(c + Vector((math.cos(th), math.sin(th), 0)) * 0.010 * min(1.0, t * 12))
        S(K.tube_path(f'cord_{kind}', pts, 0.0026, M['knob'], seg=6))
        end = pts[-1]
        S(K.cylinder(f'plug_{kind}', 0.006, 0.05, (end.x, end.y, end.z - 0.025), M['knob'], 12))
    # 顶窗后缘的红色警示牌（照片里两侧各一块，贴在顶窗后面的舱顶上）
    for sx in (1, -1):
        hit = bvh.ray_cast(Vector((sx * 0.40, 0.70, 0.3)), Vector((0, 0, 1)))
        if hit[0] is not None:
            n = -hit[1].normalized()
            if n.z > 0:
                n = -n
            S(placard(f'plc_roofwarn{sx}', 'roof_warn', hit[0], (-1, 0, 0), n, 0.085, 0.042))


def build_cabin_placards(bvh):
    """舱内其他标牌：禁烟、应急出口、安全带、地板载荷。"""
    S(placard('plc_nosmoke', 'no_smoking', (0.0, 0.62, 0.9105), (1, 0, 0), (0, 0, -1), 0.10, 0.05))
    for side in (1, -1):
        hit = bvh.ray_cast(Vector((0.0, 1.19, -0.40)), Vector((side, 0, 0)))
        if hit[0] is not None:
            S(placard(f'plc_exit{side}', 'exit', hit[0] - Vector((side * 0.0135, 0, 0)), (0, -side, 0), (-side, 0, 0), 0.09, 0.045))


def rbox(name, size, center, mat, bevel, segs=3, rot=(0, 0, 0)):
    """圆角方块（倒角后烘焙变换）。"""
    ob = K.box(name, size, center, mat, bevel=bevel, segs=segs, rot=rot)
    K.apply_mods(ob)
    K.bake_transform(ob)
    return ob


def bump(c, width, height):
    """两侧隆起：从接缝 c 向外 width 米内鼓起 height 米。"""
    def f(x, y):
        d = (abs(x) - c) / width
        return height * math.sin(math.pi * min(max(d, 0.0), 1.0))
    return f


def seat_v3(prefix, x, harness=True):
    """防撞座椅（参照 AS350 机舱全景）：皮革包边的软垫、网布中心插片、缝线下陷、两侧隆起的护翼；
    复合材料椅壳、独立头枕、铝管框架、四点式安全带与旋转锁扣。回头时这是视野里最大的东西，所以用软垫曲面而不是方块。"""
    parts = []
    mats2 = [M['leather'], M['seatmesh']]
    tiles = [0.09, 0.10]
    tilt = math.radians(12)
    R = Vector((1, 0, 0))
    Up = Vector((0, -math.sin(tilt), math.cos(tilt)))
    Fw = Vector((0, math.cos(tilt), math.sin(tilt)))
    H = Vector((x, 0.815, -0.30))  # 靠背与坐垫相接处

    def bf(u, f):
        return Q.frame_at(H + Up * u + Fw * f, R, Up, Fw)

    # 靠背：中间网布插片，两侧皮革护翼隆起，肩部一道横向缝线
    cx, top, bot = 0.118, 0.20, -0.235
    wing = bump(cx, 0.105, 0.030)

    def back_shape(px, py):
        return wing(px, py) + 0.008 * math.cos(min(abs(px) / cx, 1.0) * math.pi / 2)

    parts.append(Q.pad(prefix + '_back', bf(0.325, 0.012), 0.45, 0.65, 0.043, 0.02, mats2,
                       lambda px, py: 1 if abs(px) < cx and bot < py < top else 0, tiles,
                       vseams=(-cx, cx), hseams=(bot, top), shape=back_shape, taper=0.05, bulge=0.1, seam_d=0.007))
    parts.append(Q.pad(prefix + '_shell', bf(0.325, -0.016), 0.478, 0.69, 0.012, 0.044, [M['lining_d']], tiles=[0.12], p=6.0, q=2.2, taper=0.05, nu=16, nv=22))
    # 头枕
    hf = bf(0.76, 0.05)
    parts.append(Q.pad(prefix + '_head', hf, 0.27, 0.165, 0.042, 0.03, mats2,
                       lambda px, py: 1 if abs(px) < 0.075 and abs(py) < 0.040 else 0, tiles,
                       vseams=(-0.075, 0.075), hseams=(-0.040, 0.040), bulge=0.25, seam_d=0.005, nu=16, nv=14))
    for sx in (-1, 1):  # 头枕支杆
        a = H + Up * 0.635 + Fw * 0.006 + R * (sx * 0.075)
        parts.append(K.tube_path(prefix + f'_hpost{sx}', [a, H + Up * 0.74 + Fw * 0.03 + R * (sx * 0.075)], 0.0065, M['brushed'], seg=10))
        parts.append(K.tube_path(prefix + f'_hcol{sx}', [a, a + Up * 0.016], 0.0105, M['knob'], seg=10))
    # 坐垫：前缘下卷，两侧隆起
    pc, ps = math.cos(math.radians(4)), math.sin(math.radians(4))
    pf = Q.frame_at(Vector((x, 1.05, -0.355)), R, Vector((0, pc, ps)), Vector((0, -ps, pc)))
    pwing = bump(cx, 0.105, 0.026)

    def pan_shape(px, py):
        return pwing(px, py) + 0.006 * math.cos(min(abs(px) / cx, 1.0) * math.pi / 2) - 0.02 * Q.smooth01((py - 0.14) / 0.10)

    parts.append(Q.pad(prefix + '_pan', pf, 0.46, 0.50, 0.05, 0.028, mats2,
                       lambda px, py: 1 if abs(px) < cx and -0.17 < py < 0.17 else 0, tiles,
                       vseams=(-cx, cx), hseams=(-0.17, 0.17), shape=pan_shape, bulge=0.08, seam_d=0.006))
    parts.append(Q.pad(prefix + '_pan_tub', pf @ Matrix.Translation(Vector((0, 0, -0.026))), 0.478, 0.51, 0.012, 0.03, [M['lining_d']], tiles=[0.12], p=6.0, q=2.2, nu=16, nv=18))
    # 铝管框架（两侧弯管 + 前后横梁 + 地板滑轨）
    for sx in (-1, 1):
        fx = x + sx * 0.255
        pts = K.round_path([(fx, 1.28, -0.78), (fx, 1.22, -0.42), (fx, 0.86, -0.40), (fx, 0.80, -0.05), (fx, 0.76, 0.20)], 0.06)
        parts.append(K.tube_path(prefix + f'_tube{sx}', pts, 0.014, M['frame'], seg=12))
        parts.append(K.tube_path(prefix + f'_leg{sx}', [(fx, 0.88, -0.78), (fx, 0.90, -0.42)], 0.013, M['frame'], seg=12))
        # 吸能支柱（斜向的阻尼筒）
        parts.append(K.tube_path(prefix + f'_strut{sx}', [(fx - sx * 0.02, 1.20, -0.76), (fx - sx * 0.02, 0.98, -0.45)], 0.018, M['dmetal'], seg=12))
        parts.append(rbox(prefix + f'_rail{sx}', (0.035, 0.62, 0.022), (x + sx * 0.255, 1.04, -0.776), M['brushed'], 0.004, 1))
        for k in range(6):  # 滑轨上的定位孔
            parts.append(rbox(prefix + f'_hole{sx}{k}', (0.012, 0.016, 0.004), (x + sx * 0.255, 0.80 + k * 0.09, -0.764), M['knob'], 0.002, 1))
    parts.append(K.tube_path(prefix + '_xbar', [(x - 0.255, 1.22, -0.43), (x + 0.255, 1.22, -0.43)], 0.012, M['frame'], seg=12))
    parts.append(K.tube_path(prefix + '_xbar2', [(x - 0.255, 0.90, -0.43), (x + 0.255, 0.90, -0.43)], 0.012, M['frame'], seg=12))
    if harness:
        for sx in (-1, 1):
            def P(u, f, xo):
                return H + Up * u + Fw * f + R * (sx * xo)

            # 肩带从靠背顶端翻过来，顺着靠垫垂到坐垫上
            pts = K.round_path([P(0.66, -0.012, 0.075), P(0.668, 0.03, 0.078), P(0.635, 0.072, 0.082), P(0.42, 0.078, 0.09), P(0.20, 0.076, 0.078), P(0.075, 0.086, 0.055), (x + sx * 0.04, 0.985, -0.272)], 0.03, 4)
            parts.append(strap(prefix + f'_sh{sx}', pts, 0.046, 0.0035))
            ad = H + Up * 0.34 + Fw * 0.083 + R * (sx * 0.09)
            parts.append(on_frame(Q.frame_at(ad, -R, Up, Fw), K.box(prefix + f'_adj{sx}', (0.054, 0.032, 0.008), (0, 0, 0), M['brushed'], bevel=0.003)))
            lp = K.round_path([(x + sx * 0.236, 0.90, -0.335), (x + sx * 0.205, 0.955, -0.268), (x + sx * 0.12, 1.01, -0.268), (x + sx * 0.042, 1.03, -0.262)], 0.03, 4)
            parts.append(strap(prefix + f'_lap{sx}', lp, 0.046, 0.0035))
        # 旋转式快卸锁扣（圆盘）
        bm = Matrix.Translation(Vector((x, 1.035, -0.258))) @ Matrix.Rotation(math.radians(14), 4, 'X')
        parts.append(on_frame(bm, K.cylinder(prefix + '_buckle', 0.042, 0.014, (0, 0, 0), M['brushed'], 32, bevel=0.004)))
        parts.append(on_frame(bm @ Matrix.Translation(Vector((0, 0, 0.010))), K.cylinder(prefix + '_buckle_knob', 0.022, 0.010, (0, 0, 0), M['knob'], 24, bevel=0.002)))
        parts.append(strap(prefix + '_crotch', [(x, 1.16, -0.30), (x, 1.10, -0.272), (x, 1.06, -0.262)], 0.04, 0.0035))
    for p in parts:
        K.apply_mods(p)
        K.bake_transform(p)
        if p.data.uv_layers.get('UVMap') is None:
            K.uv_box(p, 1 / 0.3)
    return parts


def bellows(name, base, r0, r1, h, folds, mat):
    """波纹防尘套（操纵杆根部）。"""
    prof = []
    n = folds * 2
    for i in range(n + 1):
        t = i / n
        r = r0 + (r1 - r0) * t
        prof.append((r * (1.0 if i % 2 == 0 else 0.86), h * t))
    verts, faces = [], []
    seg = 28
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for r, z in prof:
            verts.append(Vector(base) + Vector((r * math.cos(a), r * math.sin(a), z)))
    m = len(prof)
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(m - 1):
            faces.append((i * m + j, i2 * m + j, i2 * m + j + 1, i * m + j + 1))
    ob = K.mesh_obj(name, verts, faces, mat, smooth=50)
    K.fix_normals(ob)
    return ob


def cyclic_v2(base):
    """周期变距杆：微弯的黑色杆身 + 人体工学握把（顶部四向配平帽、前扳机、侧面按钮）+ 根部波纹套。"""
    parts = [bellows('cyc_boot', base, 0.065, 0.024, 0.13, 6, M['rubber'])]
    stick_pts = K.round_path([base + Vector((0, 0, 0.05)), base + Vector((0, 0.02, 0.35)), base + Vector((0, 0.06, 0.56)), base + Vector((0, 0.05, 0.62))], 0.08)
    parts.append(K.tube_path('cyc_stick', stick_pts, 0.0135, M['dmetal'], seg=16))
    parts.append(K.tube_path('cyc_collar', [base + Vector((0, 0.05, 0.605)), base + Vector((0, 0.05, 0.63))], 0.0175, M['brushed'], seg=20))
    # 握把：沿杆身的回转体（截面略扁），前倾 8°
    gc = base + Vector((0, 0.05, 0.63))
    prof = [(0.0170, 0.0), (0.0190, 0.02), (0.0215, 0.05), (0.0225, 0.08), (0.0210, 0.10), (0.0235, 0.115), (0.0240, 0.13), (0.0200, 0.145), (0.0, 0.15)]
    seg = 32
    verts, faces = [], []
    R = Matrix.Rotation(math.radians(-8), 3, 'X')
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for r, z in prof:
            local = Vector((r * math.cos(a) * 0.92, r * math.sin(a) * 1.08, z))
            verts.append(gc + R @ local)
    m = len(prof)
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(m - 1):
            faces.append((i * m + j, i2 * m + j, i2 * m + j + 1, i * m + j + 1))
    grip = K.mesh_obj('cyc_grip', verts, faces, M['knob'], smooth=50)
    bm = bmesh.new()
    bm.from_mesh(grip.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(grip.data)
    bm.free()
    K.fix_normals(grip)
    parts.append(grip)
    top = gc + R @ Vector((0, 0, 0.142))
    hat = K.cylinder('cyc_hat', 0.0065, 0.008, (top.x, top.y - 0.004, top.z + 0.004), M['dmetal'], 16)
    parts.append(hat)
    for k in range(4):  # 配平帽的十字凸纹
        a = math.pi / 2 * k
        parts.append(K.box(f'cyc_hat_r{k}', (0.010 if k % 2 == 0 else 0.002, 0.002 if k % 2 == 0 else 0.010, 0.003), (top.x, top.y - 0.004, top.z + 0.009), M['dmetal']))
    trig = K.box('cyc_trig', (0.012, 0.010, 0.032), (0, 0, 0), M['knob'], bevel=0.004)
    K.apply_mods(trig)
    K.bake_transform(trig)
    trig.data.transform(Matrix.Translation(gc + R @ Vector((0, 0.026, 0.095))) @ Matrix.Rotation(math.radians(-20), 4, 'X'))
    parts.append(trig)
    for k, (dx, col, zz) in enumerate(((-0.022, 'red', 0.118), (0.022, 'knob', 0.118), (-0.016, 'dmetal', 0.135))):
        b = K.cylinder(f'cyc_btn{k}', 0.0045, 0.008, (0, 0, 0), M[col], 12)
        K.bake_transform(b)
        b.data.transform(Matrix.Translation(gc + R @ Vector((dx, -0.004, zz))) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
        parts.append(b)
    cyc = K.join(parts, 'ctl_cyclic')
    K.set_origin(cyc, base + Vector((0, 0, 0.06)))
    return cyc


def collective_v2(piv):
    """总距杆：黑色杆身 + 橡胶握把 + 端部开关盒（三个拨动开关、两个按钮、着陆灯摇臂开关）+ 根部阻尼旋钮。"""
    parts = [K.tube_path('col_lever', [piv, piv + Vector((0, 0.42, 0.075))], 0.016, M['dmetal'], seg=16)]
    hc = piv + Vector((0, 0.50, 0.089))
    handle = K.cylinder('col_grip', 0.021, 0.13, (hc.x, hc.y, hc.z), M['rubber'], 24, rot=(math.radians(-80), 0, 0))
    parts.append(handle)
    for k in range(7):  # 握把上的防滑环
        rr = K.torus(f'col_ring{k}', 0.0215, 0.0016, (0, 0, 0), M['rubber'], 24, 6)
        K.bake_transform(rr)
        rr.data.transform(Matrix.Translation(hc + Vector((0, -0.05 + k * 0.016, -0.009 + k * 0.0028))) @ Matrix.Rotation(math.radians(-80), 4, 'X'))
        parts.append(rr)
    head = K.box('col_head', (0.056, 0.064, 0.05), (0, 0, 0), M['knob'], bevel=0.009, segs=3)
    K.apply_mods(head)
    K.bake_transform(head)
    head.data.transform(Matrix.Translation(hc + Vector((0, 0.088, 0.014))) @ Matrix.Rotation(math.radians(10), 4, 'X'))
    parts.append(head)
    for k, dx in enumerate((-0.016, 0.0, 0.016)):  # 拨动开关
        parts.append(K.cylinder(f'col_tg_nut{k}', 0.0042, 0.004, (hc.x + dx, hc.y + 0.08, hc.z + 0.041), M['brushed'], 6))
        bat = K.cylinder(f'col_tg{k}', 0.0016, 0.014, (hc.x + dx, hc.y + 0.078, hc.z + 0.049), M['brushed'], 8, r2=0.0024, rot=(math.radians(-25), 0, 0))
        parts.append(bat)
    for k, dx in enumerate((-0.012, 0.012)):
        parts.append(K.cylinder(f'col_btn{k}', 0.005, 0.006, (hc.x + dx, hc.y + 0.105, hc.z + 0.036), M['red'] if k == 0 else M['dmetal'], 14))
    rocker = K.box('col_rocker', (0.012, 0.022, 0.008), (hc.x + 0.03, hc.y + 0.09, hc.z + 0.016), M['dmetal'], bevel=0.003)
    parts.append(rocker)
    col = K.join(parts, 'ctl_collective')
    K.set_origin(col, piv)
    return col


# ------------------------------------------------------------------ 舱门与舱壁内饰
GAP_PROFILE = [(-0.0018, 0.0006), (0.0018, 0.0006)]
FRONT_DOOR = [(0.29, -0.745), (1.40, -0.745), (1.405, 0.18), (1.24, 0.805), (0.29, 0.825)]
REAR_DOOR = [(-1.08, -0.745), (0.19, -0.745), (0.19, 0.825), (-1.08, 0.80)]


def door_ray(side):
    def f(y, z):
        return Vector((0.0, y, z)), Vector((side, 0, 0))
    return f


def wall_point(bvh, y, z, side, off=0.0):
    """舱壁上 (y, z) 处的点（off 为离开舱壁的距离）和朝舱内的法线。"""
    hit = bvh.ray_cast(Vector((0.0, y, z)), Vector((side, 0, 0)))
    n = hit[1].normalized()
    if n.x * side > 0:
        n = -n
    return hit[0] + n * off, n


def wall_frame(bvh, y, z, side, off=0.0):
    """舱壁上的局部坐标系：面对舱壁时 x 向右、y 向上，z 朝舱内。"""
    p, n = wall_point(bvh, y, z, side, off)
    x = Vector((0, 0, 1)).cross(n).normalized()
    return Q.frame_at(p, x, n.cross(x), n)


def build_headset(bvh):
    """挂在左侧 B 柱挂钩上的耳机。"""
    y, z, side = 0.24, 0.68, -1
    fr = wall_frame(bvh, y, z, side, 0.034)
    hook = wall_frame(bvh, y, z + 0.082, side, 0.010)
    S(on_frame(hook, K.cylinder('hs_hook_base', 0.012, 0.006, (0, 0, 0), M['dmetal'], 14)))
    S(K.tube_path('hs_hook', K.round_path([hook @ Vector((0, 0, 0)), hook @ Vector((0, 0, 0.03)), hook @ Vector((0, 0.012, 0.036))], 0.008), 0.0035, M['dmetal'], seg=8))
    S(on_frame(fr, K.torus('hs_band', 0.085, 0.008, (0, 0, 0), M['knob'], 24, 8, arc=(math.radians(10), math.radians(170)))))
    for sx in (-1, 1):
        S(on_frame(fr @ Matrix.Translation(Vector((sx * 0.085, -0.03, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), K.cylinder(f'hs_cup{sx}', 0.042, 0.036, (0, 0, 0), M['knob'], 24, bevel=0.012)))
    S(K.tube_path('hs_boom', K.round_path([fr @ Vector((0.10, -0.04, 0)), fr @ Vector((0.11, -0.09, 0.04)), fr @ Vector((0.07, -0.13, 0.05))], 0.03), 0.0032, M['knob'], seg=8))
    a = fr @ Vector((-0.10, -0.05, 0))
    S(K.tube_path('hs_cord', K.round_path([a, wall_point(bvh, 0.20, 0.30, side, 0.03)[0], wall_point(bvh, 0.205, -0.20, side, 0.02)[0], wall_point(bvh, 0.21, -0.72, side, 0.02)[0]], 0.1), 0.0026, M['knob'], seg=6))


def build_cabin_trim(bvh):
    """舱门与舱壁：门缝、门下部饰板、扶手、门袋、门把手、B 柱护板与拉手、地板门槛条。"""
    for side in (1, -1):
        sfx = 'R' if side > 0 else 'L'
        ray = door_ray(side)

        def panel(nm, c, h, r, lift, rim, mat, **kw):
            S(Q.wall_panel(f'{nm}_{sfx}', bvh, ray, c, h, r, lift, rim, mat, **kw))

        for nm, poly in (('front', FRONT_DOOR), ('rear', REAR_DOOR)):
            pts = []
            for y, z in resample(round_poly(poly, 0.06), 0.012):
                hit = bvh.ray_cast(Vector((0.0, y, z)), Vector((side, 0, 0)))
                if hit[0] is not None:
                    pts.append(hit[0])
            path, ns = Q.surface_loop(bvh, pts, 0.013, 5, inward)
            BANDS.append(Q.sweep_ring(f'gap_{nm}_{sfx}', path, ns, GAP_PROFILE, M['gap']))
        # 前门：下部饰板、扶手、门袋
        panel('door_lo', (0.835, -0.515), (0.50, 0.205), 0.04, 0.012, 0.012, M['lining_d'])
        panel('door_arm', (0.70, -0.352), (0.27, 0.03), 0.026, 0.038, 0.024, M['leather'], tile=0.09)
        panel('door_pocket', (0.72, -0.585), (0.27, 0.095), 0.03, 0.032, 0.022, M['seatmesh'], tile=0.10, crown=0.006)
        panel('door_band', (0.72, -0.492), (0.27, 0.011), 0.008, 0.036, 0.006, M['strap'])
        # 后门：下部饰板、门袋
        panel('rdoor_lo', (-0.405, -0.515), (0.53, 0.205), 0.04, 0.012, 0.012, M['lining_d'])
        panel('rdoor_arm', (-0.18, -0.352), (0.28, 0.03), 0.026, 0.034, 0.024, M['leather'], tile=0.09)
        # B 柱护板
        panel('bpillar', (0.24, 0.04), (0.041, 0.765), 0.022, 0.009, 0.010, M['lining_d'])
        # 门内把手：凹槽 + L 形拉杆（把手在门的后部，铰链在前）
        for nm, y in (('hdl_f', 0.45), ('hdl_r', 0.03)):
            z = -0.425
            panel(nm + '_cup', (y, z), (0.058, 0.021), 0.014, 0.0137, 0.0035, M['black'])

            def wp(dy, off, z=z, y=y):
                return wall_point(bvh, y + dy, z, side, off)[0]

            S(K.tube_path(f'{nm}_lever_{sfx}', K.round_path([wp(-0.042, 0.012), wp(-0.042, 0.032), wp(0.046, 0.036)], 0.012), 0.0052, M['brushed'], seg=10))
        # 紧急抛门手柄（红）
        S(on_frame(wall_frame(bvh, 1.19, -0.455, side, 0.022), K.box(f'jett_{sfx}', (0.075, 0.015, 0.012), (0, 0, 0), M['red'], bevel=0.004)))
        # B 柱拉手
        pts = [wall_point(bvh, 0.24, z, side, o)[0] for z, o in ((0.55, 0.010), (0.545, 0.044), (0.335, 0.044), (0.33, 0.010))]
        S(K.tube_path(f'grab_{sfx}', K.round_path(pts, 0.022), 0.0095, M['rubber'], seg=12))
        # 门槛条
        xw = wall_x(bvh, 0.85, -0.78, side)
        S(rbox(f'sill_{sfx}', (0.055, 1.08, 0.005), (xw - side * 0.0275, 0.85, -0.7775), M['brushed'], 0.0015, 1))
        for k in range(7):
            S(K.cylinder(f'sill_s{sfx}{k}', 0.0032, 0.0012, (xw - side * 0.0275, 0.37 + k * 0.16, -0.7746), M['dmetal'], 8))
    build_headset(bvh)


def bench_seat(prefix, x):
    """后排座位：皮革软垫 + 网布插片，安全带。"""
    parts = []
    mats2 = [M['leather'], M['seatmesh']]
    tiles = [0.09, 0.10]
    cx = 0.125
    R = Vector((1, 0, 0))
    c5, s5 = math.cos(math.radians(5)), math.sin(math.radians(5))
    pf = Q.frame_at(Vector((x, -0.735, -0.395)), R, Vector((0, c5, s5)), Vector((0, -s5, c5)))
    pw = bump(cx, 0.09, 0.016)

    def pan_shape(px, py):
        return pw(px, py) + 0.006 * math.cos(min(abs(px) / cx, 1.0) * math.pi / 2) - 0.018 * Q.smooth01((py - 0.13) / 0.11)

    parts.append(Q.pad(prefix + '_pan', pf, 0.468, 0.50, 0.055, 0.03, mats2,
                       lambda px, py: 1 if abs(px) < cx and -0.17 < py < 0.16 else 0, tiles,
                       vseams=(-cx, cx), hseams=(-0.17, 0.16), shape=pan_shape, bulge=0.08, seam_d=0.006))
    t = math.radians(8)
    Up = Vector((0, -math.sin(t), math.cos(t)))
    Fw = Vector((0, math.cos(t), math.sin(t)))
    O = Vector((x, -0.955, -0.025))
    bw = bump(cx, 0.09, 0.016)

    def back_shape(px, py):
        return bw(px, py) + 0.007 * math.cos(min(abs(px) / cx, 1.0) * math.pi / 2)

    parts.append(Q.pad(prefix + '_back', Q.frame_at(O, R, Up, Fw), 0.468, 0.60, 0.048, 0.02, mats2,
                       lambda px, py: 1 if abs(px) < cx and -0.20 < py < 0.17 else 0, tiles,
                       vseams=(-cx, cx), hseams=(-0.20, 0.17), shape=back_shape, taper=0.02, bulge=0.1, seam_d=0.006))
    hf = Q.frame_at(O + Up * 0.405 - Fw * 0.002, R, Up, Fw)
    parts.append(Q.pad(prefix + '_head', hf, 0.25, 0.15, 0.036, 0.022, mats2,
                       lambda px, py: 1 if abs(px) < 0.07 and abs(py) < 0.035 else 0, tiles,
                       vseams=(-0.07, 0.07), hseams=(-0.035, 0.035), bulge=0.2, seam_d=0.0045, nu=14, nv=12))
    # 肩带（从后舱壁的卷收器斜着下来）+ 腰带 + 锁扣
    sgn = 1 if x >= 0 else -1
    pts = K.round_path([O + Up * 0.345 + R * (sgn * 0.17) + Fw * 0.03, O + Up * 0.30 + R * (sgn * 0.15) + Fw * 0.072, O + Up * 0.02 + R * (sgn * 0.02) + Fw * 0.076, O + Up * -0.20 - R * (sgn * 0.12) + Fw * 0.08, O + Up * -0.28 - R * (sgn * 0.20) + Fw * 0.10], 0.05, 3)
    parts.append(strap(prefix + '_shoulder', pts, 0.046, 0.0035))
    for sx in (-1, 1):
        lp = K.round_path([(x + sx * 0.225, -0.93, -0.335), (x + sx * 0.18, -0.74, -0.318), (x + sx * 0.06, -0.60, -0.322)], 0.04, 3)
        parts.append(strap(prefix + f'_lap{sx}', lp, 0.044, 0.0035))
    parts.append(rbox(prefix + '_buckle', (0.05, 0.06, 0.012), (x, -0.585, -0.318), M['brushed'], 0.003, 1))
    for p in parts:
        K.apply_mods(p)
        K.bake_transform(p)
        if p.data.uv_layers.get('UVMap') is None:
            K.uv_box(p, 1 / 0.3)
    return parts


def build_rear_cabin(bvh):
    """后舱：后舱壁（靠垫、标牌、急救包）、三人长椅、顶板（顶灯与出风口）。"""
    yb = -1.045
    W_, Zt, Zb, e = section(yb)
    zc = (Zt + Zb) / 2
    outline = []
    for i in range(96):
        q = ring_point(yb, 2 * math.pi * i / 96)
        outline.append((q.x * 0.972, zc + (q.z - zc) * 0.972))
    S(K.prism('bulkhead', outline, yb - 0.02, yb, M['lining'], axis='Y'))
    BX, BY, BZ = (-1, 0, 0), (0, 0, 1), (0, 1, 0)  # 后舱壁上的局部坐标系（面朝机头）
    S(Q.pad('bulk_pad', Q.frame_at((0.0, yb, 0.585), BX, BY, BZ), 1.34, 0.36, 0.024, 0.002, [M['lining_d']], tiles=[0.12], vseams=(-0.24, 0.24), p=8.0, q=2.0, bulge=0.2, seam_d=0.006, nu=30, nv=12))
    S(placard('plc_belts', 'belts', (0.0, yb + 0.0265, 0.59), BX, BZ, 0.12, 0.06))
    # 急救包
    S(Q.pad('firstaid', Q.frame_at((-0.50, yb + 0.022, 0.595), BX, BY, BZ), 0.27, 0.17, 0.05, 0.002, [M['pouch']], tiles=[0.2], p=6.0, q=2.4, bulge=0.15, nu=14, nv=10))
    S(placard('plc_firstaid', 'first_aid', (-0.50, yb + 0.0735, 0.595), BX, BZ, 0.09, 0.045))
    for x in (-0.48, 0.0, 0.48):
        for p in bench_seat(f'bench{x}', x):
            S(p)
    S(rbox('bench_base', (1.50, 0.44, 0.34), (0, -0.76, -0.61), M['lining_d'], 0.012, 2))
    S(placard('plc_floor', 'floor_load', (0.0, -0.5385, -0.56), BX, BZ, 0.10, 0.05))
    # 顶板
    S(Q.wall_panel('roof_aft', bvh, roof_ray, (0.0, -0.18), (0.34, 0.845), 0.06, 0.008, 0.014, M['lining_d'], step=0.03))

    def ceil_frame(x, y, off):
        hit = bvh.ray_cast(Vector((x, y, 0.2)), Vector((0, 0, 1)))
        return Q.frame_at(hit[0] - Vector((0, 0, off)), (1, 0, 0), (0, -1, 0), (0, 0, -1))

    for i, (x, y) in enumerate(((-0.19, -0.45), (0.19, -0.45), (0.0, 0.40))):
        fr = ceil_frame(x, y, 0.0075)
        S(Q.pad(f'dome_b{i}', fr, 0.175, 0.085, 0.006, 0.002, [M['trim']], tiles=[0.2], p=6.0, nu=10, nv=8))
        S(Q.pad(f'dome_l{i}', fr @ Matrix.Translation(Vector((0, 0, 0.003))), 0.145, 0.058, 0.011, 0.001, [M['lens']], tiles=[0.2], p=6.0, nu=10, nv=8))
    for i, (x, y) in enumerate(((-0.17, 0.22), (0.17, 0.22), (-0.21, -0.80), (0.21, -0.80), (-0.09, -0.80), (0.09, -0.80))):
        fr = ceil_frame(x, y, 0.0075)
        S(on_frame(fr @ Matrix.Translation(Vector((0, 0, 0.003))), K.cylinder(f'vent_r{i}', 0.027, 0.006, (0, 0, 0), M['trim'], 24, bevel=0.002)))
        S(K.sphere(f'vent_b{i}', 0.0205, tuple(fr @ Vector((0, 0, 0.004))), M['knob'], 16, 10, (1, 1, 0.75)))
        S(on_frame(fr @ Matrix.Translation(Vector((0, 0, 0.0185))), K.cylinder(f'vent_n{i}', 0.0085, 0.008, (0, 0, 0), M['gap'], 12)))


# ------------------------------------------------------------------ 主流程
build_panel()
build_units()
build_glare()
build_pedestal()
ref, BVH = inner_bvh(0.032)
build_floor_controls(BVH)
build_seats()
build_overhead(BVH)
build_frames(BVH)
build_roof_felt(BVH)
build_cabin_placards(BVH)
build_cabin_trim(BVH)
build_rear_cabin(BVH)
K.delete(ref)
shell, glass = build_shell()
for g in glass.values():
    D(g, role='window')
S(shell)

# 合并静态部件：按材质分组
bpy.context.view_layer.update()
# 没有贴图坐标的部件统一按世界坐标三向投影（饰板皮纹、绒布、网布等法线贴图需要 UV）
for ob in STATIC:
    if ob.data.uv_layers.get('UVMap') is None:
        K.uv_box(ob, 1 / 0.12)
by_mat = {}
for ob in STATIC:
    K.apply_mods(ob)
    by_mat.setdefault(ob.data.materials[0].name if len(ob.data.materials) == 1 else '__multi__' + ob.name, []).append(ob)
static = []
for k, obs in by_mat.items():
    static.append(K.join(obs, 'st_' + k.replace('__multi__', '')))
by_band = {}
for ob in BANDS:
    by_band.setdefault(ob.data.materials[0].name, []).append(ob)
bands = [K.join(obs, 'band_' + k) for k, obs in by_band.items()]

if DO_BAKE:
    # 全部静态部件合成一个物体（多材质），生成第二套 UV，烘焙环境光遮蔽（游戏里作为 aoMap，uv 通道 1）
    import time

    t0 = time.time()
    # 会动的机长座椅和操纵杆也要有遮蔽（否则它们在阴影里发亮）：先并进来一起展 UV、烘焙，烘完再分出去
    moving = []
    for ob in [o for o in DYNAMIC if o.name in ('seat_pilot', 'ctl_cyclic', 'ctl_collective', 'ctl_pedal_l', 'ctl_pedal_r')]:
        vg = ob.vertex_groups.new(name=ob.name)
        vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
        moving.append((ob.name, ob.matrix_world.translation.copy(), dict(ob.items())))
        DYNAMIC.remove(ob)
        static.append(ob)
    whole = K.join(static, 'cockpit_static')
    static = [whole]
    AO_WEIGHT = {'cp_paint': 0.02, 'cp_paint_dark': 0.02, 'cp_paint_stripe': 0.02, 'cp_lining': 0.8, 'cp_floor': 0.6, 'cp_lining_dark': 0.9,
                 'cp_panelfront': 3.0, 'cp_gauges': 2.0, 'cp_black': 1.6, 'cp_knob': 1.6, 'cp_glare': 1.0,
                 'cp_felt': 0.6, 'cp_seatmesh': 1.0, 'cp_leather': 1.0, 'cp_brushed': 0.9, 'cp_placard': 0.5}
    K.smart_uv(whole, 'AO', angle=60.0, margin=0.0015, weight=lambda n: AO_WEIGHT.get(n, 1.0))
    lay = whole.data.uv_layers['AO']
    us = [d.uv[0] for d in lay.data]
    vs = [d.uv[1] for d in lay.data]
    print('UV', round(time.time() - t0, 1), 's', 'range', round(min(us), 3), round(max(us), 3), round(min(vs), 3), round(max(vs), 3),
          'mats', [m.name if m else None for m in whole.data.materials])
    ao_png = os.path.abspath('art/out/cockpit_ao.png')
    K.bake_ao(whole, ao_png, size=4096, samples=96, distance=0.35)
    print('BAKED', ao_png, round(time.time() - t0, 1), 's')
    for name, origin, props in moving:
        before = set(bpy.context.scene.objects)
        K.select_only(whole)
        whole.vertex_groups.active = whole.vertex_groups[name]
        with bpy.context.temp_override(active_object=whole, object=whole, selected_objects=[whole], selected_editable_objects=[whole]):
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='DESELECT')
            bpy.ops.object.vertex_group_select()
            bpy.ops.mesh.separate(type='SELECTED')
            bpy.ops.object.mode_set(mode='OBJECT')
        ob = next(o for o in bpy.context.scene.objects if o not in before)
        ob.name = name
        ob.data.name = name
        ob.vertex_groups.clear()
        K.set_origin(ob, origin)
        for k, v in props.items():
            ob[k] = v
        DYNAMIC.append(ob)
    whole.vertex_groups.clear()

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.55, -0.35, 0.75), sun_strength=4.5)
    eye = Vector(L.EYE)
    cam = K.camera('cam_pilot', eye, eye + Vector((-0.12, 1.0, -0.42)), fov_deg=75)
    K.render(os.path.join(PREVIEW, 'pilot.png'), cam, (1280, 720), samples=64)
    cam2 = K.camera('cam_photo', (-0.42, 1.02, 0.10), (0.10, 1.72, -0.12), fov_deg=60)
    K.render(os.path.join(PREVIEW, 'photo_match.png'), cam2, (1200, 900), samples=64, exposure=0.8)
    cam3 = K.camera('cam_cabin', (0.0, -0.55, 0.45), (0.15, 1.6, -0.15), fov_deg=80)
    K.render(os.path.join(PREVIEW, 'cabin.png'), cam3, (1280, 720), samples=64, exposure=0.5)
    cam4 = K.camera('cam_roof', (0.18, 0.92, 0.30), (0.0, 1.45, 0.95), fov_deg=82)
    K.render(os.path.join(PREVIEW, 'roof.png'), cam4, (1280, 720), samples=64, exposure=0.6)
    cam5 = K.camera('cam_seat', (0.95, 1.55, 0.10), (0.30, 1.05, -0.35), fov_deg=60)
    K.render(os.path.join(PREVIEW, 'seat.png'), cam5, (1280, 720), samples=64, exposure=0.5)

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))

K.export_glb(OUT_GLB, static + bands + DYNAMIC)
print('EXPORTED', OUT_GLB, 'static', len(static), 'dynamic', len(DYNAMIC))
