# 训练场的轻型飞机（虚构机型）：照 MOSS-Image 生成的参考图 art/src/ref/vehicles/plane_s40.png 建。
# 机身按站位放样（超椭圆截面：整流罩、座舱、尾锥），挡风玻璃和侧窗贴着机身表面，机翼、平尾、垂尾用翼型截面放样
# （机翼有上反角、翼尖收圆），翼撑、带整流罩的起落架、双叶螺旋桨、两道蓝色腰线、机身侧面立体的注册号。
#
# 坐标：Blender（机头朝 +Y，原点在地面），和旧的 props_training.plane 一致。

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import bkit as K
import bldkit as BK

F = BK.flat

# 机身站位：(y, 下沿 z, 上沿 z, 半宽)
FUSE = [(4.02, 1.08, 1.42, 0.16), (3.90, 0.95, 1.55, 0.30), (3.60, 0.82, 1.64, 0.43), (3.00, 0.75, 1.76, 0.52), (2.40, 0.72, 1.86, 0.56),
        (1.70, 0.70, 2.04, 0.58), (0.40, 0.72, 2.05, 0.58), (-0.60, 0.80, 1.98, 0.55), (-1.60, 0.98, 1.86, 0.45), (-2.60, 1.15, 1.76, 0.32),
        (-3.60, 1.32, 1.68, 0.18), (-4.20, 1.47, 1.61, 0.06)]
NS = 28  # 截面上的点数


def _interp(y):
    """y 处的截面参数（线性插值）"""
    if y >= FUSE[0][0]:
        return FUSE[0][1:]
    if y <= FUSE[-1][0]:
        return FUSE[-1][1:]
    for a, b in zip(FUSE, FUSE[1:]):
        if a[0] >= y >= b[0]:
            t = (a[0] - y) / (a[0] - b[0])
            return tuple(a[k] + (b[k] - a[k]) * t for k in (1, 2, 3))
    return FUSE[-1][1:]


def fuse_point(y, th, out=0.0):
    """机身表面：th 从右侧水平 0、顶上 π/2、左侧 π、底下 3π/2；超椭圆截面（方一点的圆）"""
    zb, zt, hw = _interp(y)
    zc, hh = (zb + zt) / 2, (zt - zb) / 2
    c, s = math.cos(th), math.sin(th)
    n = 2.6
    x = hw * math.copysign(abs(c) ** (2 / n), c)
    z = hh * math.copysign(abs(s) ** (2 / n), s)
    r = math.hypot(x / max(hw, 1e-3), z / max(hh, 1e-3))
    k = (r + out / max(min(hw, hh), 1e-3)) / max(r, 1e-6)
    return Vector((x * k, y, zc + z * k))


def surface_patch(name, y0, y1, th0, th1, mat, out=0.004, ny=12, nt=10):
    bm = bmesh.new()
    rows = [[bm.verts.new(fuse_point(y0 + (y1 - y0) * i / ny, th0 + (th1 - th0) * j / nt, out)) for j in range(nt + 1)] for i in range(ny + 1)]
    for a, b in zip(rows, rows[1:]):
        for j in range(nt):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    K.fix_normals(ob)
    return ob


def fuselage(mat):
    ys = [FUSE[0][0] - (FUSE[0][0] - FUSE[-1][0]) * (0.5 - 0.5 * math.cos(math.pi * i / 40)) for i in range(41)]
    bm = bmesh.new()
    rows = [[bm.verts.new(fuse_point(y, 2 * math.pi * j / NS)) for j in range(NS)] for y in ys]
    for a, b in zip(rows, rows[1:]):
        for j in range(NS):
            bm.faces.new((a[j], b[j], b[(j + 1) % NS], a[(j + 1) % NS]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    me = bpy.data.meshes.new('fuse')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('fuse', me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    K.fix_normals(ob)
    return ob


def airfoil(c, t, n=14):
    """翼型（NACA 四位数的厚度分布 + 一点弯度）：返回闭合的一圈 [(离前缘多远, 厚度方向)]，
    从后缘经上表面到前缘，再经下表面回到后缘（后缘那一点只出现一次）"""
    def yt(x):
        return 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)

    def cam(x):
        return 0.02 * (1 - (2 * x - 1) ** 2)

    xs = [(1 - math.cos(math.pi * k / n)) / 2 for k in range(n + 1)]  # 0 前缘 … 1 后缘，两头加密
    upper = [(c * x, c * (cam(x) + yt(x))) for x in reversed(xs)]
    lower = [(c * x, c * (cam(x) - yt(x))) for x in xs[1:-1]]
    return upper + lower


def surface_loft(name, sections, mat, cap=True):
    """一串截面（每个是闭合的一圈三维点，点数相同）放样"""
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(rows[0])
    for a, b in zip(rows, rows[1:]):
        for j in range(n):
            bm.faces.new((a[j], b[j], b[(j + 1) % n], a[(j + 1) % n]))
    if cap:
        bm.faces.new(rows[0][::-1])
        bm.faces.new(rows[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    K.fix_normals(ob)
    return ob


def wing_half(name, side, mat):
    """主翼的一半：x 从机身顶上（0.4）到翼尖（5.5），弦长 1.5 → 1.3，上反角 1.7°，最外面 0.3 m 收圆"""
    secs = []
    span = [5.5 * (1 - math.cos(math.pi / 2 * k / 18)) for k in range(19)]
    for x in span:
        t = max(0.0, (x - 0.4) / 5.1)
        c = 1.50 - 0.20 * t
        tip = max(0.0, (x - 5.15) / 0.35)
        c *= 1 - 0.55 * tip ** 2
        le_y = 1.78 - 0.04 * t - (1.5 - c) * 0.15
        z = 2.08 + math.tan(math.radians(1.7)) * max(0.0, x - 0.4)
        thick = 0.13 * (1 - 0.6 * tip)
        sec = []
        for cx, cz in airfoil(c, thick):
            sec.append(Vector((side * x, le_y - cx, z + cz)))
        secs.append(sec)
    return surface_loft(name, secs, mat)


def tail_surface(name, root, tip, t, mat, vertical=False):
    """尾翼：root、tip 是 (前缘点 Vector, 弦长)；平尾沿 x 展开，垂尾沿 z"""
    secs = []
    for k in range(9):
        u = k / 8
        le = root[0] + (tip[0] - root[0]) * u
        c = root[1] + (tip[1] - root[1]) * u
        sec = []
        for cx, cz in airfoil(c, t):
            if vertical:
                sec.append(Vector((cz * 0.9, le.y - cx, le.z)))
            else:
                sec.append(Vector((le.x, le.y - cx, le.z + cz * 0.9)))
        secs.append(sec)
    return surface_loft(name, secs, mat)


def text_mesh(name, text, size, mat, depth=0.004):
    """Blender 自带字体的文字转成网格（注册号）：原点在左下，字面朝 -Y，沿 +X 写"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.extrude = depth
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.convert(target='MESH')
    ob = bpy.data.objects[name] if name in bpy.data.objects else ob
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def plane(name='plane_a', prop=True):
    """四座上单翼轻型飞机：机长约 8.2 m、翼展 11 m、高 2.9 m。prop=False：天上飞的那架不要桨叶（游戏里画一层圆盘）"""
    paint = F('plane_white', 0xeceae4, rough=0.35, metal=0.0)
    stripe = F('plane_stripe', 0x1f4a8a, rough=0.4)
    glass = F('plane_glass', 0x1c252d, rough=0.06, metal=0.6)
    tyre = F('tyre', 0x141414, rough=0.85)
    steel = F('plane_steel', 0xb0b4b8, rough=0.35, metal=0.8)
    black = F('plane_black', 0x1a1b1d, rough=0.5)
    parts = [fuselage(paint)]
    # 挡风玻璃、两侧的门窗和后窗
    parts.append(surface_patch('windshield', 2.45, 1.68, 0.55, math.pi - 0.55, glass, out=0.005))
    for th0, th1, sgn in ((0.28, 1.15, 1), (math.pi - 1.15, math.pi - 0.28, -1)):
        parts.append(surface_patch(f'win_f{sgn}', 1.58, 0.55, th0, th1, glass, out=0.005, ny=8, nt=6))
        parts.append(surface_patch(f'win_r{sgn}', 0.42, -0.42, th0 + 0.06, th1 - 0.04, glass, out=0.005, ny=8, nt=6))
        # 腰线：两道蓝色细带，从整流罩一直到尾巴
        parts.append(surface_patch(f'stripe1{sgn}', 3.7, -4.0, (-0.06 if sgn > 0 else math.pi - 0.06), (0.02 if sgn > 0 else math.pi + 0.06), stripe, out=0.003, ny=30, nt=2))
        parts.append(surface_patch(f'stripe2{sgn}', 3.7, -3.9, (-0.20 if sgn > 0 else math.pi + 0.12), (-0.15 if sgn > 0 else math.pi + 0.17), stripe, out=0.003, ny=30, nt=1))
        # 门缝
        for y in (1.62, 0.5):
            parts.append(surface_patch(f'seam{sgn}{y}', y, y - 0.015, (-0.5 if sgn > 0 else math.pi - 1.0), (1.0 if sgn > 0 else math.pi + 0.5), black, out=0.003, ny=1, nt=8))
    # 主翼、翼撑、翼尖航行灯（左红右绿）
    for side in (1, -1):
        parts.append(wing_half(f'wing{side}', side, paint))
        parts.append(BK.stick(f'strut{side}', (side * 0.52, 0.55, 0.88), (side * 2.75, 0.95, 2.13), 0.04, paint, seg=6))
        tip_z = 2.08 + math.tan(math.radians(1.7)) * 5.1
        parts.append(BK.bx(f'navl{side}', (0.06, 0.18, 0.08), (side * 5.52, 1.55, tip_z), F('nav_green' if side > 0 else 'nav_red', 0x1e9a46 if side > 0 else 0xb8261e, rough=0.3), uv=False))
        # 翼尖一道蓝
        parts.append(BK.bx(f'wtip{side}', (0.35, 1.1, 0.05), (side * 5.25, 1.0, tip_z + 0.09), stripe, uv=False))
    # 平尾、垂尾（后掠）、背鳍
    parts.append(tail_surface('stab_r', (Vector((0.08, -3.50, 1.58)), 1.0), (Vector((1.75, -3.62, 1.58)), 0.72), 0.09, paint))
    parts.append(tail_surface('stab_l', (Vector((-0.08, -3.50, 1.58)), 1.0), (Vector((-1.75, -3.62, 1.58)), 0.72), 0.09, paint))
    parts.append(tail_surface('fin', (Vector((0, -3.15, 1.62)), 1.35), (Vector((0, -3.85, 3.0)), 0.78), 0.10, paint, vertical=True))
    parts.append(tail_surface('fin_stripe', (Vector((0, -3.48, 2.30)), 1.08), (Vector((0, -3.62, 2.52)), 0.98), 0.115, stripe, vertical=True))
    parts.append(BK.cyl('beacon', 0.05, 0.1, (0, -4.25, 3.03), F('beacon_red', 0xc02a20, rough=0.3), 10, uv=False))
    # 起落架：弹簧钢主腿、带整流罩的轮子；前轮
    for side in (1, -1):
        parts.append(BK.stick(f'leg{side}', (side * 0.42, 0.18, 0.80), (side * 1.22, 0.18, 0.30), 0.045, steel, seg=6))
        parts.append(BK.cyl(f'wheel{side}', 0.26, 0.13, (side * 1.25, 0.18, 0.26), tyre, 16, rot=(0, math.pi / 2, 0), uv=False))
        parts.append(K.sphere(f'spat{side}', 1.0, (side * 1.25, 0.12, 0.34), paint, 16, 10, scale=(0.13, 0.42, 0.2)))
    parts.append(BK.stick('nose_leg', (0, 3.1, 0.80), (0, 3.18, 0.30), 0.05, steel, seg=6))
    parts.append(BK.cyl('nose_wheel', 0.21, 0.11, (0, 3.18, 0.22), tyre, 14, rot=(0, math.pi / 2, 0), uv=False))
    parts.append(K.sphere('nose_spat', 1.0, (0, 3.14, 0.30), paint, 14, 8, scale=(0.11, 0.36, 0.17)))
    # 螺旋桨：桨毂整流罩 + 两片桨叶（扭转的薄板，尖上一点黄）
    parts.append(K.sphere('spinner', 0.17, (0, 4.08, 1.25), paint, 14, 8, scale=(1, 1.45, 1)))
    if prop:
        for s in (1, -1):
            bm = bmesh.new()
            rows = []
            for k in range(9):
                r = 0.12 + 0.81 * k / 8
                c = 0.13 - 0.06 * (k / 8) ** 2
                tw = math.radians(28 - 18 * k / 8)
                p0 = Vector((s * r, 4.12, 1.25))
                d = Vector((0, math.cos(tw), s * math.sin(tw))) * c / 2
                rows.append([bm.verts.new(p0 - d), bm.verts.new(p0 + d)])
            for a, b in zip(rows, rows[1:]):
                bm.faces.new((a[0], b[0], b[1], a[1]))
            me = bpy.data.meshes.new(f'blade{s}')
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new(f'blade{s}', me)
            bpy.context.collection.objects.link(ob)
            me.materials.append(black)
            sol = ob.modifiers.new('sol', 'SOLIDIFY')
            sol.thickness = 0.018
            parts.append(ob)
            parts.append(BK.bx(f'bladetip{s}', (0.09, 0.02, 0.07), (s * 0.88, 4.12, 1.25), F('prop_tip', 0xe0b020, rough=0.4), uv=False))
    # 注册号：机身两侧、座舱后面（虚构的瑞士注册号，训练场在阿尔卑斯）
    # 文字物体躺在 XY 平面、字面朝 +Z、沿 +X 写。右舷：字面朝 +X，从外面看往右写就是往机头（+Y）；左舷反过来
    # 字写在客舱后面、腰线下面；机身往后收窄，字板按收窄的角度转一点贴着机身
    for side in (1, -1):
        t = text_mesh(f'reg{side}', 'HB-RTA', 0.30, stripe)
        xs = [v.co.x for v in t.data.vertices]
        Lt = max(xs) - min(xs)
        y_mid = -1.30
        zb, zt, hw = _interp(y_mid)
        hw_f = _interp(y_mid + Lt / 2)[2]
        hw_a = _interp(y_mid - Lt / 2)[2]
        phi = math.atan2(hw_f - hw_a, Lt)
        if side > 0:
            R = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        else:
            R = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        t.data.transform(R)
        t.data.transform(Matrix.Rotation(-side * phi, 4, 'Z'))
        t.data.transform(Matrix.Translation((side * ((hw_f + hw_a) / 2 + 0.014), y_mid, (zb + zt) / 2 - 0.42)))
        parts.append(t)
    return BK.model(name, parts)[0]
