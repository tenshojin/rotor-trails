# 座舱内饰的几何工具：软垫（座椅、头枕、后排长椅）、窗框截面扫掠、贴舱壁的压制面板。
# 这里只放与具体位置无关的几何函数，部件的位置和材质在 cockpit.py 里决定。

import math

from mathutils import Matrix, Vector

import bkit as K


def smooth01(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def axis_lines(lo, hi, n, seams=(), gw=0.004, edge=True):
    """一条轴上的网格线：基础等分（edge=True 时按正弦向两端加密），每条接缝两侧再加几条线，让接缝的沟能建出来。"""
    c, half = (lo + hi) / 2, (hi - lo) / 2
    ts = []
    for i in range(n + 1):
        t = i / n * 2 - 1
        ts.append(c + half * (math.sin(t * math.pi / 2) if edge else t))
    for s in seams:
        for k in (-3.0, -2.0, -1.3, -0.8, -0.4, 0.0, 0.4, 0.8, 1.3, 2.0, 3.0):
            ts.append(s + k * gw)
    ts = sorted(t for t in ts if lo <= t <= hi)
    out = [ts[0]]
    for t in ts[1:]:
        if t - out[-1] > 0.0009:
            out.append(t)
    out[-1] = hi
    return out


def pad(name, frame, w, h, tf, tb, mats, region=None, tiles=None, p=5.0, q=2.6, bulge=0.0, taper=0.0,
        vseams=(), hseams=(), seam_w=0.0035, seam_d=0.006, shape=None, nu=26, nv=34, smooth=70):
    """软垫：局部 x 右、y 上、z 朝前（坐人的一面），frame 把局部坐标变到世界坐标。
    外形是圆角方形（超椭圆指数 p），前后两面在外缘收成圆边（q 越小边越圆）；bulge 让中间鼓起，taper 让上端收窄；
    vseams / hseams 是竖向 / 横向接缝（缝线处下陷的沟，x 或 y 的位置），shape(x, y) 叠加额外高度（两侧隆起等）；
    region(x, y) 返回每个面用 mats 里第几个材质，tiles[i] 是该材质贴图一格的米数。UV 按表面弧长展开，不会在圆边处拉伸。"""
    xs = axis_lines(-w / 2, w / 2, nu, vseams, seam_w)
    ys = axis_lines(-h / 2, h / 2, nv, hseams, seam_w)
    nx, ny = len(xs), len(ys)
    front, back = [], []
    for x0 in xs:
        cf, cb = [], []
        for y0 in ys:
            X, Y = 2 * x0 / w, 2 * y0 / h
            r = max(abs(X), abs(Y))
            s = (abs(X) ** p + abs(Y) ** p) ** (1 / p) if r > 1e-6 else 1e-6
            k = 1 + (r / s - 1) * r ** 6  # 只在靠外缘的地方把方形收成圆角，里面的网格线（接缝）保持笔直
            X, Y = X * k, Y * k
            s2 = min(1.0, (abs(X) ** p + abs(Y) ** p) ** (1 / p))
            e = max(0.0, 1 - s2 ** q) ** (1 / q)
            x = X * w / 2 * (1 - taper * (Y + 1) / 2)
            y = Y * h / 2
            z = tf * e * (1 + bulge * (1 - X * X) * (1 - Y * Y))
            if shape:
                z += shape(x0, y0) * e
            for c in vseams:
                z -= seam_d * e * math.exp(-((x0 - c) / seam_w) ** 2)
            for c in hseams:
                z -= seam_d * e * math.exp(-((y0 - c) / seam_w) ** 2)
            cf.append(Vector((x, y, z)))
            cb.append(Vector((x, y, -tb * e)))
        front.append(cf)
        back.append(cb)
    verts = [frame @ v for col in front for v in col] + [frame @ v for col in back for v in col]
    off = nx * ny

    def idx(i, j):
        return i * ny + j

    # 镜像的局部坐标系（x × y = -z）要反转面的走向，否则法线朝里：烘焙环境光遮蔽时整块软垫会变成全黑
    flip = frame.to_3x3().determinant() < 0
    faces, fmat = [], []
    for i in range(nx - 1):
        for j in range(ny - 1):
            f0 = (idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1))
            f1 = (off + idx(i, j), off + idx(i, j + 1), off + idx(i + 1, j + 1), off + idx(i + 1, j))
            faces.append(f0[::-1] if flip else f0)
            fmat.append(region((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2) if region else 0)
            faces.append(f1[::-1] if flip else f1)
            fmat.append(0)
    ob = K.mesh_obj(name, verts, faces, mats[0])
    for m in mats[1:]:
        ob.data.materials.append(m)
    me = ob.data
    # 弧长 UV：从中心十字线向外累计三维距离
    i0, j0 = nx // 2, ny // 2
    U = [[0.0] * ny for _ in range(nx)]
    V = [[0.0] * ny for _ in range(nx)]
    for j in range(ny):
        for i in range(i0 + 1, nx):
            U[i][j] = U[i - 1][j] + (front[i][j] - front[i - 1][j]).length
        for i in range(i0 - 1, -1, -1):
            U[i][j] = U[i + 1][j] - (front[i][j] - front[i + 1][j]).length
    for i in range(nx):
        for j in range(j0 + 1, ny):
            V[i][j] = V[i][j - 1] + (front[i][j] - front[i][j - 1]).length
        for j in range(j0 - 1, -1, -1):
            V[i][j] = V[i][j + 1] - (front[i][j] - front[i][j + 1]).length
    uv = K.uv_layer(ob)
    tl = tiles or [0.1] * len(mats)
    for pi, poly in enumerate(me.polygons):
        poly.material_index = fmat[pi]
        t = tl[fmat[pi]]
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            ij = vi if vi < off else vi - off
            uv.data[li].uv = (U[ij // ny][ij % ny] / t, V[ij // ny][ij % ny] / t)
    K.shade(ob, smooth)
    return ob


def frame_at(o, x, y, z):
    """局部坐标轴（世界方向 x, y, z）+ 原点 o → 4×4 矩阵。"""
    return Matrix(((x[0], y[0], z[0], o[0]), (x[1], y[1], z[1], o[1]), (x[2], y[2], z[2], o[2]), (0, 0, 0, 1)))


def resample_loop(pts, step):
    """闭合三维折线按等弧长重新采样。"""
    n = len(pts)
    seg = [(pts[(i + 1) % n] - pts[i]).length for i in range(n)]
    total = sum(seg)
    m = max(8, int(total / step))
    out = []
    i, acc = 0, 0.0
    for k in range(m):
        d = total * k / m
        while acc + seg[i] < d and i < n - 1:
            acc += seg[i]
            i += 1
        out.append(pts[i].lerp(pts[(i + 1) % n], (d - acc) / max(seg[i], 1e-9)))
    return out


def smooth_loop(pts, passes=8):
    """闭合折线平滑（Taubin：一步收缩、一步放大，平滑掉抖动但不让窗框整体变小）。"""
    n = len(pts)
    for _ in range(passes):
        for lam in (0.5, -0.53):
            pts = [p + ((pts[i - 1] + pts[(i + 1) % n]) * 0.5 - p) * lam for i, p in enumerate(pts)]
    return pts


def smooth_vectors(vs, k=4):
    """方向序列的滑动平均（闭合）。"""
    n = len(vs)
    out = []
    for i in range(n):
        s = Vector((0, 0, 0))
        for d in range(-k, k + 1):
            s += vs[(i + d) % n]
        out.append(s.normalized())
    return out


def surface_loop(bvh, pts, step=0.012, passes=8, inward=None):
    """把一圈采样点整理成贴着舱壁的光滑闭合路径：等距重采样 → 平滑 → 投回曲面。返回 (路径点, 朝舱内的法线)。"""
    pts = resample_loop(pts, step)
    pts = smooth_loop(pts, passes)
    out, ns = [], []
    for p in pts:
        hit = bvh.find_nearest(p)
        if hit[0] is None:
            continue
        n = hit[1].normalized()
        if inward is not None and n.dot(inward(hit[0])) < 0:
            n = -n
        out.append(hit[0])
        ns.append(n)
    return out, smooth_vectors(ns, 5)


def sweep_ring(name, pts, ns, profile, mat, smooth=55):
    """沿闭合路径扫掠截面。profile=[(b, n)]：b 指向窗洞中心为正，n 朝舱内为正。
    ns 是每点朝舱内的法线；面的朝向按截面走向自动确定（沿 +b 走时面朝舱内）。"""
    n = len(pts)
    c = sum(pts, Vector((0, 0, 0))) / n
    tang = [(pts[(i + 1) % n] - pts[i - 1]).normalized() for i in range(n)]
    bs = []
    vote = 0.0
    for i in range(n):
        nn = (ns[i] - tang[i] * ns[i].dot(tang[i])).normalized()
        b = nn.cross(tang[i]).normalized()
        bs.append((nn, b))
        vote += b.dot(c - pts[i])
    s = 1.0 if vote > 0 else -1.0
    m = len(profile)
    verts = []
    for i in range(n):
        nn, b = bs[i]
        for (pb, pn) in profile:
            verts.append(pts[i] + b * (pb * s) + nn * pn)
    faces = []
    for i in range(n):
        i2 = (i + 1) % n
        for j in range(m - 1):
            q = (i * m + j, i2 * m + j, i2 * m + j + 1, i * m + j + 1)
            faces.append(q if s > 0 else q[::-1])
    ob = K.mesh_obj(name, verts, faces, mat)
    K.shade(ob, smooth)
    return ob


def sd_rrect(u, v, cu, cv, hu, hv, r):
    """到圆角矩形的有向距离（内部为负）。"""
    qx = abs(u - cu) - hu + r
    qy = abs(v - cv) - hv + r
    return min(max(qx, qy), 0.0) + math.hypot(max(qx, 0.0), max(qy, 0.0)) - r


def wall_panel(name, bvh, ray, center, half, r, lift, rim, mat, step=0.02, tile=0.12, crown=0.0, keep=None):
    """贴舱壁的压制面板：在 (u, v) 平面上是圆角矩形，ray(u, v) 给出射向舱壁的射线；
    面板从舱壁抬起 lift 米，边缘 rim 米内圆滑过渡，crown 让中间再鼓起一点。边缘外的网格沉到舱壁后面，所以交线是干净的曲线。
    keep(点) 为假的网格点会被去掉（用来绕开窗洞，留下的毛边由窗框盖住）。"""
    cu, cv = center
    hu, hv = half
    us = axis_lines(cu - hu - 0.008, cu + hu + 0.008, max(2, int(2 * hu / step)), (cu - hu, cu + hu), rim / 3, edge=False)
    vs = axis_lines(cv - hv - 0.008, cv + hv + 0.008, max(2, int(2 * hv / step)), (cv - hv, cv + hv), rim / 3, edge=False)
    grid = []
    dirs = None
    for u in us:
        col = []
        for v in vs:
            o, d = ray(u, v)
            dirs = d
            hit = bvh.ray_cast(o, d)
            if hit[0] is None or (keep and not keep(hit[0])):
                col.append(None)
                continue
            n = hit[1].normalized()
            if n.dot(d) < 0:
                n = -n
            sd = sd_rrect(u, v, cu, cv, hu, hv, r)
            t = smooth01(-sd / rim)
            hgt = lift * t - 0.0022 * (1 - t) + crown * t * (1 - (2 * (u - cu) / (2 * hu)) ** 2) * (1 - (2 * (v - cv) / (2 * hv)) ** 2)
            col.append(hit[0] - n * hgt)
        grid.append(col)
    verts, index = [], {}
    for i, col in enumerate(grid):
        for j, p in enumerate(col):
            if p is not None:
                index[(i, j)] = len(verts)
                verts.append(p)
    faces = []
    flip = None
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            q = [index.get(k) for k in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
            if None in q:
                continue
            if flip is None:
                a, b, c = verts[q[0]], verts[q[1]], verts[q[3]]
                flip = (b - a).cross(c - a).dot(dirs) > 0
            faces.append(tuple(q[::-1]) if flip else tuple(q))
    ob = K.mesh_obj(name, verts, faces, mat)
    K.shade(ob, 60)
    K.uv_box(ob, 1 / tile)
    return ob
