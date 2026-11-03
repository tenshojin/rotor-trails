# 日式传统建筑部件（参照鞆之浦町家实拍照片，维基共享资源；照片只在浏览器里看，不进仓库）：
#   本瓦屋面：圆筒瓦（丸瓦）一垄垄顺坡而下，垄间是浅凹的平瓦沟，每一行瓦都有一道台阶；
#   檐口：每垄筒瓦端头一个圆形瓦当（巴瓦，带圆形家纹浮雕），垄间是唐草瓦的前沿；
#   屋脊：白色面户灰泥 + 多层熨斗瓦（宽窄交替，形成横向线条）+ 冠瓦（每节有接缝），两端鬼瓦与向外上挑的鸟衾；
#   以及沿折线扫掠截面的通用工具（屋脊、檐沟、压条、落水管等都用它）。
# 坐标与 bldkit 相同：X 右、Y 前、Z 上，单位米。瓦的尺寸与 jtex.py 的贴图格子一致。

import math

import bmesh
from mathutils import Matrix, Vector

import bkit as K

P, L, R = 0.30, 0.30, 0.075  # 垄距、行距、筒瓦半径
DEPTH, STEP = 0.02, 0.018  # 平瓦沟深、每行台阶高
LIP = 0.08  # 贴图里每格底部的“瓦前沿”区域
CELLS = 16  # 贴图一张 = 16 × 16 格
ZUP = Vector((0, 0, 1))
_C45 = math.cos(math.pi / 4)
# 一个周期内的采样（从平瓦沟中心起算）：沟中心、筒瓦脚、45°、顶、45°、筒瓦脚
OFFS = [0.0, P / 2 - R, P / 2 - R * _C45, P / 2, P / 2 + R * _C45, P / 2 + R]


def hprof(o):
    """周期内偏移 o 处的瓦面高度（相对瓦底面）。"""
    c = P / 2
    dc = abs(o - c)
    if dc < R - 1e-9:
        return math.sqrt(R * R - dc * dc)
    e = min(1.0, (dc - R) / (c - R))
    return -DEPTH * math.sin(math.pi * 0.5 * e) ** 2


# ------------------------------------------------------------------ 通用几何


def obox(name, c, ax, ay, az, sx, sy, sz, m):
    """沿任意正交轴 (ax, ay, az) 摆放的长方体，c 为中心。"""
    c = Vector(c)
    ax, ay, az = Vector(ax).normalized(), Vector(ay).normalized(), Vector(az).normalized()
    verts = []
    for dz in (-0.5, 0.5):
        for dy in (-0.5, 0.5):
            for dx in (-0.5, 0.5):
                verts.append(c + ax * (dx * sx) + ay * (dy * sy) + az * (dz * sz))
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    ob = K.mesh_obj(name, verts, faces, m, smooth=0)
    K.fix_normals(ob)
    return ob


def rect(s0, s1, t0, t1):
    return [(s0, t0), (s1, t0), (s1, t1), (s0, t1)]


def semi(r, t0, n=8, flat=0.9):
    """半圆截面（底边在 t0）：用于冠瓦、袖瓦。"""
    return [(r * math.cos(math.pi * k / n), t0 + r * flat * math.sin(math.pi * k / n)) for k in range(n + 1)]


def sweep(name, path, prof, m, up=ZUP, cyclic=False, caps=True, smooth=None):
    """截面 prof（[(s, t)]，s = 水平侧向，t = 垂直于路径的“上”）沿折线 path 扫掠。
    拐角处截面位于角平分面上，并在弯曲平面内按 1/cos(半角) 放大，保证宽度不变（檐沟转角不会变窄）。"""
    path = [Vector(p) for p in path]
    n = len(path)
    rings = []
    for i in range(n):
        if cyclic:
            t0 = (path[i] - path[i - 1]).normalized()
            t1 = (path[(i + 1) % n] - path[i]).normalized()
        else:
            t0 = (path[i] - path[i - 1]).normalized() if i > 0 else None
            t1 = (path[i + 1] - path[i]).normalized() if i < n - 1 else None
        t = t1 if t0 is None else t0 if t1 is None else (t0 + t1).normalized()
        s = t.cross(up)
        if s.length < 1e-6:
            s = t.cross(Vector((1, 0, 0)))
        s.normalize()
        u = s.cross(t).normalized()
        k, bax = 1.0, None
        if t0 is not None and t1 is not None:
            bax = t0.cross(t1)
            if bax.length > 1e-6:
                bax.normalize()
                k = 1.0 / max(0.25, t0.dot(t))
            else:
                bax = None
        ring = []
        for ps, pt in prof:
            o = s * ps + u * pt
            if bax is not None:
                ob_ = bax * o.dot(bax)
                o = ob_ + (o - ob_) * k
            ring.append(path[i] + o)
        rings.append(ring)
    mm = len(prof)
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(n if cyclic else n - 1):
        i2 = (i + 1) % n
        for j in range(mm):
            j2 = (j + 1) % mm
            faces.append((i * mm + j, i * mm + j2, i2 * mm + j2, i2 * mm + j))
    if caps and not cyclic:
        faces.append(tuple(range(mm - 1, -1, -1)))
        faces.append(tuple((n - 1) * mm + j for j in range(mm)))
    ob = K.mesh_obj(name, verts, faces, m)
    K.fix_normals(ob)
    K.shade(ob, smooth if smooth else 0)
    return ob


def path_len(path):
    return sum((Vector(path[i + 1]) - Vector(path[i])).length for i in range(len(path) - 1))


def path_at(path, s):
    """折线上弧长 s 处的点与切线。"""
    acc = 0.0
    for i in range(len(path) - 1):
        a, b = Vector(path[i]), Vector(path[i + 1])
        seg = (b - a).length
        if acc + seg >= s or i == len(path) - 2:
            t = (s - acc) / seg if seg > 0 else 0.0
            return a.lerp(b, max(0.0, min(1.0, t))), (b - a).normalized()
        acc += seg
    return Vector(path[-1]), (Vector(path[-1]) - Vector(path[-2])).normalized()


def frame_matrix(pos, fwd, up=ZUP):
    """局部坐标 → 世界：局部 +Y = fwd（水平化），+Z = 上，+X = fwd × 上。"""
    f = Vector((fwd.x, fwd.y, 0)).normalized()
    x = f.cross(up).normalized()
    M = Matrix((x, f, up)).transposed().to_4x4()
    M.translation = Vector(pos)
    return M


def place(objs, M):
    for o in objs:
        K.bake_transform(o)
        o.data.transform(M)
    return objs


# ------------------------------------------------------------------ 本瓦屋面


def slope_frame(poly):
    """坡面局部坐标：A = 檐口起点，eu 沿檐口，ev 顺坡向上，n 为坡面法线（朝上）。"""
    pts = [Vector(p) for p in poly]
    A, B = pts[0], pts[1]
    eu = (B - A).normalized()
    far = max(pts[2:], key=lambda p: (p - A).cross(eu).length)
    n = (B - A).cross(far - A).normalized()
    if n.z < 0:
        n = -n
    ev = n.cross(eu).normalized()
    return A, eu, ev, n


def tile_slope(name, poly, m, lift=0.075, phase=None, skirt=0.035, clip_edges=None):
    """一块坡面的几何本瓦。poly：坡面多边形（屋面板底面所在平面），第 0→1 条边是檐口；
    其余边（或 clip_edges 指定的边）用过该边的竖直平面裁切。瓦底面在屋面板底面上方 lift 处。
    返回（物体, 檐口信息 dict）。UV：一格 = 一垄 × 一行，对应 kawara_cells 贴图的 1/16。"""
    pts = [Vector(p) for p in poly]
    A, eu, ev, n = slope_frame(pts)
    Wu = (pts[1] - pts[0]).length
    vmax = max((p - A).dot(ev) for p in pts)
    uc = Wu / 2 if phase is None else phase  # 平瓦沟中心对齐檐口中点 → 左右对称
    k0 = math.floor(-uc / P) - 1
    k1 = math.ceil((Wu - uc) / P) + 1
    cols = []
    for k in range(k0, k1 + 1):
        for o in OFFS:
            cols.append((uc + k * P + o, hprof(o), (k * P + o) / (CELLS * P)))
    nk = int(math.ceil(vmax / L)) + 1
    rows = [(0.0, -skirt, 0.0, True), (0.0, STEP, LIP, False)]
    for k in range(1, nk + 1):
        rows.append((k * L, 0.0, float(k), False))
        rows.append((k * L, STEP, k + LIP, False))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    grid = []
    for v, g, vt, flat in rows:
        row = []
        for u, h, ut in cols:
            hh = (0.0 if flat else h) + g + lift
            row.append((bm.verts.new(A + eu * u + ev * v + n * hh), ut, vt / CELLS))
        grid.append(row)
    for i in range(len(grid) - 1):
        for j in range(len(cols) - 1):
            quad = (grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])
            f = bm.faces.new([q[0] for q in quad])
            for loop, q in zip(f.loops, quad):
                loop[uvl].uv = (q[1], q[2])
    cen = sum(pts, Vector()) / len(pts)
    for i in (clip_edges if clip_edges is not None else range(1, len(pts))):
        p0, p1 = pts[i], pts[(i + 1) % len(pts)]
        nrm = (p1 - p0).cross(ZUP)
        if nrm.length < 1e-6:
            continue
        nrm.normalize()
        if (cen - p0).dot(nrm) > 0:
            nrm = -nrm
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=p0, plane_no=nrm, clear_outer=True)
    ob = K.bm_to_obj(name, bm, m, smooth=50)
    return ob, dict(A=A, eu=eu, ev=ev, n=n, Wu=Wu, uc=uc, lift=lift)


def eave_ends(name, info, m, margin=0.12, crest=True):
    """檐口：每垄筒瓦端头的圆形瓦当（巴瓦）+ 垄间唐草瓦前沿（一条连续的板）。"""
    A, eu, ev, n, Wu, uc, lift = (info[k] for k in ('A', 'eu', 'ev', 'n', 'Wu', 'uc', 'lift'))
    objs = []
    k0 = math.floor(-uc / P) - 1
    k1 = math.ceil((Wu - uc) / P) + 1
    for k in range(k0, k1 + 1):
        u = uc + k * P + P / 2
        if u < margin or u > Wu - margin:
            continue
        c = A + eu * u + n * (lift + STEP * 0.5)
        objs.append(K.tube_path(f'{name}_d{k}', [c + ev * 0.02, c - ev * 0.018], R * 1.16, m, seg=10))
        if crest:
            objs.append(K.tube_path(f'{name}_c{k}', [c - ev * 0.016, c - ev * 0.028], R * 0.6, m, seg=8))
    # 唐草瓦前沿：垂在瓦底下 5 cm，略向外
    objs.append(obox(f'{name}_kara', A + eu * (Wu / 2) - ev * 0.004 + n * (lift - 0.012), eu, ev, n, Wu, 0.026, 0.058, m))
    return objs


def edge_roll(name, a, b, info, m, r=0.085):
    """坡面侧边（山墙边 / 雨棚两侧）的袖瓦：沿边的一条半圆筒瓦。a→b 为屋面板底面上的边。"""
    n, lift = info['n'], info['lift']
    off = n * (lift - 0.01)
    return sweep(name, [Vector(a) + off, Vector(b) + off], semi(r, 0.0, 8, 0.95), m, up=n, smooth=50)


def ridge_stack(name, path, layers, w, m_tile, m_mendo=None, lt=0.045, cap_r=0.085, joints=True):
    """叠瓦屋脊：面户灰泥（白）+ 熨斗瓦若干层（宽窄交替）+ 冠瓦（每 0.3 m 一道接缝）。
    path：屋脊底线（瓦面上），截面垂直于路径（斜脊也一样）。返回部件列表与脊顶高度。"""
    hw = w / 2
    objs = []
    if m_mendo is not None:
        # 面户灰泥：只从筒瓦之间的沟里露出一小块一小块的白
        objs.append(sweep(name + '_mendo', path, rect(-(hw - 0.012), hw - 0.012, -0.06, 0.031), m_mendo))
    top = 0.03 + layers * lt
    objs.append(sweep(name + '_core', path, rect(-(hw - 0.03), hw - 0.03, -0.02, top), m_tile))
    for i in range(layers):
        ww = hw if i % 2 == 0 else hw - 0.02
        t0 = 0.03 + i * lt
        objs.append(sweep(f'{name}_n{i}', path, rect(-ww, ww, t0, t0 + lt - 0.011), m_tile))
    objs.append(sweep(name + '_cap', path, semi(cap_r, top - 0.012, 8, 0.9), m_tile, smooth=50))
    if joints:
        total = path_len(path)
        s = 0.3
        while s < total - 0.1:
            p, t = path_at(path, s)
            objs.append(sweep(f'{name}_j{int(s * 100)}', [p - t * 0.018, p + t * 0.018], semi(cap_r + 0.011, top - 0.016, 8, 0.9), m_tile, smooth=50))
            s += 0.3
    return objs, top


def offset_poly(pts, d):
    """逆时针多边形向内偏移 d（斜接）。"""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((-e1.y, e1.x)), Vector((-e2.y, e2.x))  # 左侧 = 内侧
        nb = (n1 + n2)
        if nb.length < 1e-6:
            nb = n1
        nb.normalize()
        k = d / max(0.35, nb.dot(n1))
        q = p1 + nb * k
        out.append((q.x, q.y))
    return out


# 鬼瓦轮廓（右半边，从底部中央逆时针到顶部中央；宽 0.62、高 0.58，底部中央的拱口跨在屋脊上）
_ONI_R = [(0.0, 0.14), (0.11, 0.12), (0.155, 0.075), (0.165, 0.0), (0.31, 0.0), (0.305, 0.06), (0.262, 0.15),
          (0.232, 0.25), (0.225, 0.35), (0.262, 0.385), (0.268, 0.44), (0.235, 0.475), (0.205, 0.485),
          (0.165, 0.53), (0.10, 0.565), (0.0, 0.58)]
ONI_OUTLINE = _ONI_R + [(-x, z) for x, z in reversed(_ONI_R[1:-1])]


def onigawara(name, pos, out, m, s=1.0, busuma=True, busuma_angle=28.0, busuma_len=0.55):
    """鬼瓦：pos = 底边中点（屋脊端头、脊底高度），out = 朝外的水平方向。
    正面有圆形家纹（两圈浮雕），顶上伸出鸟衾（向外上挑的筒瓦，端头也有瓦当）。"""
    th = 0.10
    parts = [K.prism(name, ONI_OUTLINE, -th / 2, th / 2, m, axis='Y')]
    # 正面一圈凸起的边框（外轮廓减去向内偏移 4 cm 的轮廓）
    inner = offset_poly(ONI_OUTLINE, 0.04)
    rim = K.cdt_face(name + '_rim', ONI_OUTLINE, [list(reversed(inner))], m)
    K.extrude_flat(rim, 0.022)
    K.map_verts(rim, lambda co: (co[0], th / 2 - 0.002 + co[2], co[1]))
    K.fix_normals(rim)
    parts.append(rim)
    cz = 0.355
    parts.append(K.tube_path(name + '_mon', [Vector((0, th / 2, cz)), Vector((0, th / 2 + 0.04, cz))], 0.085, m, seg=16))
    parts.append(K.tube_path(name + '_mon2', [Vector((0, th / 2 + 0.03, cz)), Vector((0, th / 2 + 0.055, cz))], 0.05, m, seg=14))
    if busuma:
        a = math.radians(busuma_angle)
        d = Vector((0, math.cos(a), math.sin(a)))
        p0 = Vector((0, -0.10, 0.50))
        p1 = p0 + d * busuma_len
        parts.append(K.tube_path(name + '_bus', [p0, p1], 0.058, m, seg=12))
        parts.append(K.tube_path(name + '_busd', [p1 - d * 0.02, p1 + d * 0.02], 0.074, m, seg=14))
        parts.append(K.tube_path(name + '_busc', [p1 + d * 0.015, p1 + d * 0.03], 0.042, m, seg=12))
    M = frame_matrix(pos, Vector(out)) @ Matrix.Scale(s, 4)
    return place(parts, M)


# ------------------------------------------------------------------ 屋顶组装


def hip_roof(name, w, d, h, ov, ridge, z0, mats, cx=0.0, cy=0.0, lift=0.075, board=0.045,
             main_layers=5, hip_layers=3, oni_s=1.0, hip_oni_s=0.55, sori=0.10):
    """几何本瓦的四坡屋顶（与 bldkit.roof_hip 同一套几何参数，便于与碰撞体一致）。
    mats：tile（kawara_cells）、ibushi（脊瓦 / 瓦当 / 鬼瓦）、mendo（白灰泥）、board（屋面板，檐下可见）。
    返回（部件列表, 檐口四角, 坡面信息列表）。"""
    hw, hd = w / 2 + ov, d / 2 + ov
    rw = (w / 2) * ridge
    slope = h / (d / 2)
    ze = z0 - ov * slope
    A = Vector((cx - hw, cy - hd, ze))
    B = Vector((cx + hw, cy - hd, ze))
    C = Vector((cx + hw, cy + hd, ze))
    D = Vector((cx - hw, cy + hd, ze))
    R1 = Vector((cx - rw, cy, z0 + h))
    R2 = Vector((cx + rw, cy, z0 + h))
    polys = [('S', [A, B, R2, R1]), ('E', [B, C, R2]), ('N', [C, D, R1, R2]), ('W', [D, A, R1])]
    parts, infos = [], []
    for tag, poly in polys:
        # 屋面板（檐下看得到的底板）
        _, eu, ev, n = slope_frame(poly)
        bp = [p + n * 0.0 for p in poly]
        top = [p + n * board for p in poly]
        nv = len(poly)
        f = [tuple(range(nv)), tuple(range(nv, 2 * nv))] + [(i, (i + 1) % nv, nv + (i + 1) % nv, nv + i) for i in range(nv)]
        ob = K.mesh_obj(f'{name}_bd{tag}', bp + top, f, mats['board'], smooth=0)
        K.fix_normals(ob)
        K.uv_box(ob, 1 / 1.2)
        parts.append(ob)
        t, info = tile_slope(f'{name}_t{tag}', poly, mats['tile'], lift=lift)
        parts.append(t)
        parts += eave_ends(f'{name}_e{tag}', info, mats['ibushi'])
        infos.append(info)
    # 隅棟（四条斜脊）：从檐口角到屋脊端
    base = lift + 0.06
    hip_lines = [(A, R1), (B, R2), (C, R2), (D, R1)]
    for i, (a, b) in enumerate(hip_lines):
        da = (b - a)
        # 斜脊底线：沿两坡交线，抬到瓦面高度；下端略缩进，留出隅鬼的位置
        a2 = a + da.normalized() * 0.18
        objs, _ = ridge_stack(f'{name}_hip{i}', [a2 + ZUP * base, b + ZUP * base], hip_layers, 0.26, mats['ibushi'], mats['mendo'], lt=0.04, cap_r=0.075)
        parts += objs
        out = Vector((a.x - b.x, a.y - b.y, 0)).normalized()
        parts += onigawara(f'{name}_honi{i}', a2 + ZUP * (base - 0.05) - out * 0.02, out, mats['ibushi'], s=hip_oni_s, busuma=False)
    # 大棟：两端略上翘（反り），端头鬼瓦 + 鸟衾
    ext = 0.12
    e = (R2 - R1).normalized() if rw > 0 else Vector((1, 0, 0))
    a, b = R1 - e * ext, R2 + e * ext
    nseg = 12
    path = []
    half = (b - a).length / 2
    for k in range(nseg + 1):
        p = a.lerp(b, k / nseg)
        x = abs(k / nseg - 0.5) * 2  # 0 中间 → 1 端头
        lift_end = sori * max(0.0, (x - 0.55) / 0.45) ** 2 if half > 0.6 else 0.0
        path.append(p + ZUP * (base + 0.02 + lift_end))
    objs, top = ridge_stack(f'{name}_ridge', path, main_layers, 0.30, mats['ibushi'], mats['mendo'])
    parts += objs
    for end, sgn in ((path[0], -1), (path[-1], 1)):
        parts += onigawara(f'{name}_oni{sgn}', end - ZUP * 0.06 + e * sgn * 0.03, e * sgn, mats['ibushi'], s=oni_s)
    return parts, [A, B, C, D], infos


def lean_roof(name, quads, mats, lift=0.07, board=0.04, hips=True, hip_layers=2, flashing=None):
    """绕墙一圈（或单面）的单坡屋面（下屋 / 庇）：quads = [(外沿左, 外沿右, 内沿右, 内沿左)]。
    四角斜接处做小斜脊；内沿贴墙处做雨押え（flashing 材质的金属压条）。"""
    parts, infos = [], []
    for i, q in enumerate(quads):
        q = [Vector(p) for p in q]
        _, eu, ev, n = slope_frame(q)
        top = [p + n * board for p in q]
        f = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        ob = K.mesh_obj(f'{name}_bd{i}', q + top, f, mats['board'], smooth=0)
        K.fix_normals(ob)
        K.uv_box(ob, 1 / 1.2)
        parts.append(ob)
        t, info = tile_slope(f'{name}_t{i}', q, mats['tile'], lift=lift)
        parts.append(t)
        parts += eave_ends(f'{name}_e{i}', info, mats['ibushi'])
        infos.append(info)
        if flashing is not None:
            # 雨押え：贴墙竖立的金属压条，下沿压住最上一行瓦
            a, b = q[3], q[2]
            out_h = Vector((-ev.x, -ev.y, 0)).normalized()
            zt = (lift + R + STEP) / max(0.3, n.z)
            mid = (a + b) / 2 + ZUP * (zt + 0.03) + out_h * 0.016
            parts.append(obox(f'{name}_fl{i}', mid, (b - a).normalized(), out_h, ZUP, (b - a).length, 0.03, 0.16, flashing))
    if hips and len(quads) > 1:
        base = lift + 0.05
        for i, q in enumerate(quads):
            a, b = Vector(q[0]), Vector(q[3])  # 外沿左角 → 内沿左角（与上一面共用的斜接线）
            objs, _ = ridge_stack(f'{name}_hip{i}', [a + ZUP * base, b + ZUP * base], hip_layers, 0.22, mats['ibushi'], mats['mendo'], lt=0.038, cap_r=0.068, joints=True)
            parts += objs
            out = Vector((a.x - b.x, a.y - b.y, 0)).normalized()
            parts.append(K.tube_path(f'{name}_hipd{i}', [a + ZUP * (base + 0.08) - out * 0.0, a + ZUP * (base + 0.08) + out * 0.05], 0.08, mats['ibushi'], seg=12))
    return parts, infos
