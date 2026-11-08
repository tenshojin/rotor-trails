# 营地帐篷：亚马孙科考营地的帆布屋脊帐篷、喜马拉雅冰川营地的高山圆顶帐篷。
# 以前是程序几何体：一个纯色的三棱柱、一个带棱面的半球，近看像玩具。
# 这里的布面是加密的网格，按真帐篷受力的样子变形：
#   · 屋脊帐篷：两根立杆一根脊杆，布从脊杆垂到矮墙，中间往里凹；檐口被拉绳拽住，拉绳之间垂成弧线；
#     门帘卷起来绑在两边，看得见昏暗的帐内（布是单面的，帐内另做一层深色的里子）。
#   · 圆顶帐篷：两根弧形杆在顶上交叉，外帐绷在杆上，杆和杆之间的布往里收；前面是前厅，底边一圈深色防雪裙。
# 接缝、杆套、泥点、日晒褪色写进顶点色（f_vc 材质的颜色就是顶点色，逐顶点可以不一样）。
# 坐标：X = 游戏局部 x（门朝 +X），-Y = 游戏局部 +z，Z 向上；原点 = 地面中心。
# 被 props_amazon.py、props_himalaya.py 调用。

import math

import bkit as K
import bldkit as BK
from mathutils import Vector


def _lin(hexv):
    c = K.col(hexv)
    return (c[0], c[1], c[2])


def _mul(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)


def _mix(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def _vc_obj(name, verts, faces, cols, rough=0.85, metal=0.0, smooth=40):
    """顶点色网格：颜色逐顶点（线性 RGB），粗糙度 / 金属度写进第二套 UV（RM），材质直接用合并后的 f_vc。"""
    ob = K.mesh_obj(name, verts, faces, BK.vc_material(), smooth=smooth)
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly in me.polygons:
        for li in poly.loop_indices:
            c = cols[me.loops[li].vertex_index]
            attr.data[li].color = (c[0], c[1], c[2], 1.0)
    me.uv_layers.new(name='UVMap')
    rm = me.uv_layers.new(name='RM')
    for lp in rm.data:
        lp.uv = (rough, metal)
    return ob


def _grid(rows, cols_, closed=False):
    """rows × cols_ 的四边形网格的面（行优先）。closed：每行首尾相连。"""
    faces = []
    nc = cols_ if closed else cols_ - 1
    for i in range(rows - 1):
        for j in range(nc):
            j1 = (j + 1) % cols_
            faces.append((i * cols_ + j, i * cols_ + j1, (i + 1) * cols_ + j1, (i + 1) * cols_ + j))
    return faces


def _blotch(x, y, z):
    """大片的水渍、晒斑（-1..1 左右的平滑起伏）"""
    return (math.sin(1.7 * x + 0.3) * math.sin(2.3 * z + 1.1) + 0.5 * math.sin(3.1 * x - 2.2 * z + 0.7 + 1.3 * y)) / 1.5


def _line(name, a, b, r, m, seg=4):
    return BK.stick(name, Vector(a), Vector(b), r, m, seg=seg)


def _stake(name, p, away, m, length=0.24, r=0.014):
    """地钉 / 木桩：露出地面一截，顶端朝背离帐篷的方向斜着"""
    d = Vector((away[0], away[1], 0)).normalized()
    top = Vector(p) + Vector((0, 0, length)) + d * (length * 0.35)
    return _line(name, Vector(p) - Vector((0, 0, 0.05)), top, r, m, seg=5)


# ------------------------------------------------------------------ 帆布屋脊帐篷（亚马孙）
def ridge_tent(name, color):
    """长 4.5 m（X）、宽 3.2 m、脊高 2.2 m，与 src/world/props/amazon.ts 的程序几何体同尺寸；门在 +X。
    两侧 0.4 m 的矮墙，屋面从脊杆垂到墙顶。"""
    L, W2, H, E = 4.5, 1.6, 2.2, 0.4
    base = _lin(color)
    mud = _lin(0x6e4630)
    seam = 0.86
    # 沿长度的采样：均匀 26 段，外加接缝（帆布一幅约 0.9 m 宽，竖着缝）两边各一行
    xs = set(round(-L / 2 + L * i / 26, 4) for i in range(27))
    seams = [-L / 2 + 0.9 * k for k in range(1, 5)]
    for s in seams:
        for d in (-0.018, 0.0, 0.018):
            xs.add(round(s + d, 4))
    xs = sorted(xs)

    def profile(u):
        """横截面（y, z, 标记）从 -Y 的墙脚经屋脊到 +Y 的墙脚。u = 沿长度 0..1。"""
        h = H - 0.018 * math.sin(math.pi * u)
        # 檐口被三处拉绳（两头和中间）拽住，之间垂下去
        e = E - 0.045 * abs(math.sin(2 * math.pi * u))
        half = []
        # 墙脚（往外撇一点，被地钉拉着）→ 墙顶
        for k in range(4):
            t = k / 3
            half.append((W2 + 0.07 * (1 - t), e * t, 'wall'))
        # 屋面：墙顶 → 靠近屋脊（12 段）
        top = (0.07, h - 0.07 * (h - e) / W2)
        for k in range(1, 13):
            t = k / 12
            half.append((W2 + (top[0] - W2) * t, e + (top[1] - e) * t, 'roof'))
        # 屋脊搭在脊杆上：圆过去
        for k in range(1, 4):
            a = k / 4
            half.append((top[0] * (1 - a), top[1] + (h - top[1]) * math.sin(a * math.pi / 2), 'ridge'))
        left = [(-y, z, tag) for (y, z, tag) in half]
        right = list(reversed(half))
        return left + [(0.0, h, 'ridge')] + right

    rows = []
    for x in xs:
        u = (x + L / 2) / L
        rows.append((x, u, profile(u)))
    nprof = len(rows[0][2])
    verts, cols, outn = [], [], []
    for x, u, prof in rows:
        for j, (y, z, tag) in enumerate(prof):
            # 屋面中间往里凹：离杆越远、离屋脊和墙顶越远越凹
            sag = 0.0
            if tag == 'roof':
                v = (W2 - abs(y)) / W2
                v = max(0.0, min(1.0, 1 - v))  # 0 = 屋脊附近，1 = 墙顶
                sag = 0.1 * math.sin(math.pi * min(1.0, v * 1.05)) * (0.45 + 0.55 * math.sin(math.pi * u))
            ny, nz = (1.0 if y > 0 else -1.0) * (H - E), W2
            nl = math.hypot(ny, nz)
            yy = y - (ny / nl) * sag
            zz = z - (nz / nl) * sag
            # 细小的不平
            zz += 0.006 * math.sin(7.3 * x + 3.1 * y) * math.sin(5.1 * z + 0.7) * (1 if tag == 'roof' else 0.4)
            verts.append((x, yy, zz))
            # 往外的方向（里子沿它往里退）：墙是水平的，屋面、屋脊按屋面的斜度
            outn.append((0.0, 1.0 if y > 0 else -1.0, 0.0) if tag == 'wall' else (0.0, ny / nl, nz / nl) if abs(y) > 1e-6 else (0.0, 0.0, 1.0))
            c = base
            # 日晒：上面褪色发白一点；泥点：贴地 30 cm 越往下越脏
            c = _mix(c, _mul(_mix(c, (0.6, 0.6, 0.58), 0.35), 1.12), max(0.0, (zz - 0.8) / (H - 0.8)) * 0.45)
            c = _mix(c, mud, max(0.0, 1 - zz / 0.32) * 0.55)
            c = _mul(c, 1 + 0.06 * _blotch(x, yy, zz))
            if tag == 'ridge' or any(abs(x - s) < 0.005 for s in seams):
                c = _mul(c, seam)
            if tag == 'wall' and abs(zz - E) < 0.06:
                c = _mul(c, 0.9)
            cols.append(c)
    # 行 = 沿长度，列 = 沿截面（-Y 墙脚 → 屋脊 → +Y 墙脚）；四边形倒过来绕，法线朝外
    faces = [(f[0], f[3], f[2], f[1]) for f in _grid(len(rows), nprof)]
    shell = _vc_obj(name + '_canvas', verts, faces, cols, rough=0.93)
    parts = [shell]

    # 两头的山墙：后面（-X）整块，前面（+X）门帘卷起绑在两边
    def gable(x0, front):
        prof = rows[0][2] if x0 < 0 else rows[-1][2]
        u = 0.0 if x0 < 0 else 1.0
        pv, pc = [], []
        # 每个轮廓点到山墙底边中点之间插 6 段（轮廓从一边墙脚绕过屋脊到另一边墙脚，从底边中点看过去整块都盖得住），往里凹 4 cm
        cz = 0.0
        ring = [(y, z) for (y, z, _) in prof]
        n = len(ring)
        steps = 6
        for i in range(steps + 1):
            t = i / steps
            for (y, z) in ring:
                py = y * (1 - t)
                pz = z + (cz - z) * t
                inward = 0.045 * math.sin(math.pi * t) * (1 if x0 > 0 else -1)
                pv.append((x0 - inward, py, pz))
                c = _mix(base, mud, max(0.0, 1 - pz / 0.32) * 0.55)
                c = _mul(c, 1 + 0.06 * _blotch(x0, py, pz))
                pc.append(c)
        fcs = []
        for i in range(steps):
            for j in range(n - 1):
                a, b = i * n + j, i * n + j + 1
                c2, d2 = (i + 1) * n + j + 1, (i + 1) * n + j
                fcs.append((a, d2, c2, b) if x0 > 0 else (a, b, c2, d2))
        if front:
            # 门：底宽 1.2 m、到 1.95 m 高的三角形开口。山墙是外轮廓和门边之间的一条带子（按各自的弧长一一对应），门边是直的
            def arclen(pts):
                d = [0.0]
                for k in range(1, len(pts)):
                    d.append(d[-1] + math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
                return [v / d[-1] for v in d]
            door = [(-0.6, 0.0), (0.0, 1.95), (0.6, 0.0)]
            dl = [0.0, 0.5, 1.0]

            def on_door(s):
                k = 0 if s <= 0.5 else 1
                t = (s - dl[k]) / (dl[k + 1] - dl[k])
                return (door[k][0] + (door[k + 1][0] - door[k][0]) * t, door[k][1] + (door[k + 1][1] - door[k][1]) * t)
            sl = arclen(ring)
            pv, pc = [], []
            for i in range(steps + 1):
                t = i / steps
                for k, (y, z) in enumerate(ring):
                    dy, dz = on_door(sl[k])
                    py = y + (dy - y) * t
                    pz = z + (dz - z) * t
                    pv.append((x0 - 0.03 * math.sin(math.pi * t), py, pz))
                    c = _mix(base, mud, max(0.0, 1 - pz / 0.32) * 0.55)
                    pc.append(_mul(c, 1 + 0.06 * _blotch(x0, py, pz)))
            fcs = []
            for i in range(steps):
                for j in range(n - 1):
                    a, b = i * n + j, i * n + j + 1
                    c2, d2 = (i + 1) * n + j + 1, (i + 1) * n + j
                    fcs.append((a, d2, c2, b))
        return _vc_obj(name + ('_front' if front else '_back'), pv, fcs, pc, rough=0.93)

    parts.append(gable(-L / 2, False))
    parts.append(gable(L / 2, True))
    # 卷起来绑在门两边的门帘
    for s in (-1, 1):
        a = Vector((L / 2 + 0.03, s * 0.66, 0.08))
        b = Vector((L / 2 + 0.03, s * 0.06, 1.86))
        roll = K.tube_path(name + '_roll', [a, a.lerp(b, 0.5) + Vector((0.02, s * 0.03, 0)), b], 0.055, None, seg=8)
        parts.append(_recolor(roll, _mul(base, 0.82), 0.93))
        for t in (0.3, 0.72):
            p = a.lerp(b, t)
            tie = K.torus(name + '_tie', 0.06, 0.008, (p.x, p.y, p.z), None, seg=10, seg2=4, rot=(0, math.pi / 2, 0))
            parts.append(_recolor(tie, _lin(0x2a241c), 0.9))
    # 帐内：一层深色的里子（布是单面的，从门口看进去不能是透的）和地布
    inner = []
    ic = []
    for k, (vx, vy, vz) in enumerate(verts):
        n = outn[k]
        inner.append((vx * 0.985, vy - n[1] * 0.035, max(0.02, vz - n[2] * 0.035)))
        ic.append(_mul(base, 0.16))
    ifaces = _grid(len(rows), nprof)
    parts.append(_vc_obj(name + '_inner', inner, ifaces, ic, rough=0.95))
    parts.append(_vc_obj(name + '_floor', [(-L / 2 + 0.05, -W2, 0.02), (L / 2 - 0.05, -W2, 0.02), (L / 2 - 0.05, W2, 0.02), (-L / 2 + 0.05, W2, 0.02)],
                         [(0, 1, 2, 3)], [_lin(0x2b2e24)] * 4, rough=0.9))
    # 后面的里子（前面是门，要看得进去）：朝 +X
    x0 = -L / 2 + 0.07
    back = [(x0, vy, vz) for (_, vy, vz) in inner[:nprof]]
    cen = len(back)
    back.append((x0, 0.0, 0.02))
    fc = [(j + 1, j, cen) for j in range(cen - 1)]
    parts.append(_vc_obj(name + '_innerend', back, fc, [_mul(base, 0.14)] * len(back), rough=0.95))

    # 杆、拉绳、木桩
    wood = BK.flat('tent_pole', 0x5a432c, rough=0.75)
    rope = BK.flat('guy_rope', 0xb2a588, rough=0.9)
    peg = BK.flat('tent_peg', 0x6b5236, rough=0.85)
    for x0 in (-L / 2, L / 2):
        s = 1 if x0 > 0 else -1
        # 立杆在山墙里面一点，杆头的销子从屋脊穿出来
        xp = x0 - s * 0.07
        parts.append(_line(name + '_pole', (xp, 0, 0), (xp, 0, H + 0.1), 0.026, wood, seg=6))
        st = (x0 + s * 1.45, 0, 0)
        parts.append(_line(name + '_guy', (xp, 0, H + 0.07), st, 0.006, rope))
        parts.append(_stake(name + '_peg', st, (s, 0), peg))
    for u in (0.0, 0.5, 1.0):
        x = -L / 2 + L * u
        for s in (-1, 1):
            top = (x, s * W2, E)
            st = (x, s * (W2 + 0.78), 0)
            parts.append(_line(name + '_guy', top, st, 0.005, rope))
            parts.append(_stake(name + '_peg', st, (0, s), peg))
            # 墙脚的地钉
            parts.append(_stake(name + '_peg', (x * 0.98, s * (W2 + 0.08), 0), (0, s), peg, length=0.1, r=0.01))
    return BK.model(name, parts)[0]


def _recolor(ob, c, rough):
    """把一个用 None 材质建的部件换成指定颜色的顶点色（逐顶点同一种颜色）"""
    me = ob.data
    me.materials.clear()
    me.materials.append(BK.vc_material())
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for d in attr.data:
        d.color = (c[0], c[1], c[2], 1.0)
    while len(me.uv_layers) > 0:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap')
    rm = me.uv_layers.new(name='RM')
    for lp in rm.data:
        lp.uv = (rough, 0.0)
    K.shade(ob, 40)
    return ob


# ------------------------------------------------------------------ 高山圆顶帐篷（喜马拉雅）
def dome_tent(name, color):
    """两人四季帐：底 2.3 × 2.1 m（圆角矩形），高 1.25 m，侧壁陡、顶平（抗风雪），前厅往 +X 伸出 0.8 m。
    两根弧形杆沿对角线在顶上交叉（杆在外帐下面，外帐上看得到鼓起的杆套），杆和杆之间的布绷紧往里收。"""
    A, B, H = 1.15, 1.05, 1.25
    base = _lin(color)
    skirt = _lin(0x34363a)
    dirt = _lin(0x6a6258)
    sleeve_c = _mul(base, 0.55)
    # 两根对角交叉的主杆 + 一根左右横跨的顶杆：外帐分成六片，一片片绷紧往里收
    poles = [math.radians(a) for a in (40, 90, 140, 220, 270, 320)]

    def radius(phi):
        # 超椭圆（指数 2.6）：圆角矩形
        c, s_ = abs(math.cos(phi)), abs(math.sin(phi))
        return 1.0 / ((c / A) ** 2.6 + (s_ / B) ** 2.6) ** (1 / 2.6)

    def height(rho):
        return H * max(0.0, 1 - rho ** 2.4) ** 0.6

    def pole_gap(phi):
        """离最近一根杆的角度、所在空档的宽度"""
        p = phi % (2 * math.pi)
        n = len(poles)
        for i in range(n):
            a0 = poles[i]
            a1 = poles[(i + 1) % n] + (2 * math.pi if i == n - 1 else 0)
            q = p if p >= a0 else p + 2 * math.pi
            if a0 <= q < a1:
                return q - a0, a1 - a0
        return 0.0, math.pi / 2

    def fly_point(rho, phi):
        """外帐上的点（没有杆套的凸起）和离杆的角度"""
        d, gap = pole_gap(phi)
        tens = math.sin(math.pi * d / gap) ** 0.75
        sag = 0.13 * (gap / (math.pi / 2)) * tens * math.sin(math.pi * min(1.0, rho)) ** 0.8
        near = min(d, gap - d)
        bump = 0.022 * max(0.0, 1 - near / math.radians(2.6)) * math.sin(math.pi * min(1.0, rho))
        k = sag - bump
        r = radius(phi) * rho
        z = height(rho) - k * 0.8 * (1 - 0.35 * rho)
        rr = max(0.0, r - k * 0.55 * rho)
        return Vector((rr * math.cos(phi), rr * math.sin(phi), max(0.0, z))), near

    def shade_fly(p, near, rho, under_skirt):
        if under_skirt:
            return skirt
        c = _mix(base, _mul(_mix(base, (0.65, 0.65, 0.65), 0.3), 1.1), (p.z / H) ** 2 * 0.35)
        if p.z < 0.3:
            c = _mix(c, dirt, (0.3 - p.z) / 0.2 * 0.3)
        # 杆套：一条深色的带子（顶杆只在顶上那一段）
        if near < math.radians(1.7) and 0.03 < rho < 0.985:
            c = sleeve_c
        return _mul(c, 1 + 0.04 * _blotch(p.x, p.y, p.z))

    # 圈：越靠底越密（侧壁陡）；离地 10 cm 处两圈重合，分开外帐和深色的防雪裙
    NR, NA = 20, 120
    rhos = [1 - (1 - i / NR) ** 1.6 for i in range(1, NR)]
    rhos = [r for r in rhos if r < 0.985]
    r_sk = (1 - (0.10 / H) ** (1 / 0.6)) ** (1 / 2.4)
    rings = [(r, False) for r in rhos] + [(r_sk, False), (r_sk + 1e-5, True), (1.0, True)]
    top = Vector((0.0, 0.0, H))
    verts = [tuple(top)]
    cols = [shade_fly(top, 1.0, 0.0, False)]
    for rho, under in rings:
        for j in range(NA):
            phi = 2 * math.pi * j / NA
            p, near = fly_point(rho, phi)
            if rho >= 1.0:
                p.z = 0.0
            verts.append(tuple(p))
            cols.append(shade_fly(p, near, rho, under))
    faces = [(0, 1 + j, 1 + (j + 1) % NA) for j in range(NA)]
    # 四边形倒过来绕，法线朝外
    faces += [tuple(1 + k for k in (f[0], f[3], f[2], f[1])) for f in _grid(len(rings), NA, closed=True)]
    parts = [_vc_obj(name + '_fly', verts, faces, cols, rough=0.62)]

    # 前厅：从前面两根杆（±40°）之间的外帐上斜着拉到前方 0.8 m 的地钉；中间是拉链门
    NV, NU = 12, 28
    span = math.radians(46)
    vv, vc = [], []
    for i in range(NV + 1):
        t = i / NV
        for j in range(NU + 1):
            phi = -span + 2 * span * j / NU
            w = abs(phi) / span
            # 前厅的布从帐体侧面陡的地方（半高以下）拉出去：拉成直线也比帐体的坡缓，不会钻进帐体
            rho0 = 0.62 + 0.38 * w ** 1.4
            p0, _ = fly_point(rho0, phi)
            ext = 0.8 * max(0.0, math.cos(w * math.pi / 2)) ** 0.85
            gr = radius(phi)
            bot = Vector(((gr + ext) * math.cos(phi), gr * math.sin(phi), 0.0))
            p = p0.lerp(bot, t)
            # 前厅的布也往里收一点；整体往外挪 1.5 cm，不和帐体的布打架
            p.z -= 0.035 * math.sin(math.pi * t) * math.sin(math.pi * j / NU)
            p += Vector((math.cos(phi), math.sin(phi), 0.6)).normalized() * 0.015 * (1 - t)
            if i == NV:
                p.z = 0.0
            vv.append(tuple(p))
            if p.z < 0.1:
                c = skirt
            elif abs(phi) < math.radians(1.0):
                c = _lin(0x202124)  # 拉链
            else:
                c = _mix(base, dirt, max(0.0, (0.3 - p.z) / 0.2) * 0.3)
                c = _mul(c, 1 + 0.04 * _blotch(p.x, p.y, p.z))
            vc.append(c)
    vfaces = [(f[0], f[3], f[2], f[1]) for f in _grid(NV + 1, NU + 1)]
    parts.append(_vc_obj(name + '_vest', vv, vfaces, vc, rough=0.62))

    # 拉绳（杆的中段往外拉）、地钉（铝）
    rope = BK.flat('guy_cord', 0xd8d2c4, rough=0.7)
    peg = BK.flat('alu_peg', 0xa8adb2, rough=0.4, metal=0.8)
    for a in poles:
        p, _ = fly_point(0.62, a)
        R = radius(a) + 0.95
        st = (R * math.cos(a), R * math.sin(a), 0.0)
        parts.append(_line(name + '_guy', tuple(p), st, 0.004, rope))
        parts.append(_stake(name + '_peg', st, (math.cos(a), math.sin(a)), peg, length=0.12, r=0.009))
    vx = radius(0.0) + 0.8
    parts.append(_stake(name + '_peg', (vx, 0, 0), (1, 0), peg, length=0.1, r=0.009))
    for a in poles:
        r = radius(a)
        parts.append(_stake(name + '_peg', (r * math.cos(a), r * math.sin(a), 0), (math.cos(a), math.sin(a)), peg, length=0.08, r=0.008))
    return BK.model(name, parts)[0]
