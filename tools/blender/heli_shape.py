# RT-7 机身外形（驾驶舱外壳与外观模型共用，保证前后舱段严丝合缝）。
# Blender 坐标：X 右、Y 前（机头）、Z 上，原点 = 重心（主旋翼轴线）。参照 H125/AS350 的外形比例。

import math

from mathutils import Vector

# 座舱段截面：(Y, 半宽 W, 顶 Zt, 底 Zb, 超椭圆指数 e)
STATIONS = [
    (-1.32, 0.84, 0.80, -0.80, 3.0),
    (-1.00, 0.92, 0.92, -0.92, 3.3),
    (0.00, 0.94, 0.95, -0.95, 3.5),
    (0.80, 0.94, 0.95, -0.95, 3.4),
    (1.20, 0.925, 0.91, -0.95, 3.1),
    (1.60, 0.875, 0.74, -0.93, 2.8),
    (1.95, 0.76, 0.50, -0.88, 2.5),
    (2.20, 0.585, 0.26, -0.76, 2.25),
    (2.36, 0.36, 0.04, -0.57, 2.1),
    (2.445, 0.12, -0.12, -0.39, 2.0),
]
Y_TIP = 2.47
Z_TIP = -0.255

# 后机身（行李舱/发动机舱下方）：从座舱后壁收窄到尾梁根部
REAR_STATIONS = [
    (-1.32, 0.84, 0.80, -0.80, 3.0),
    (-1.70, 0.80, 0.84, -0.70, 2.9),
    (-2.15, 0.62, 0.86, -0.38, 2.5),
    (-2.55, 0.42, 0.84, 0.05, 2.2),
    (-2.85, 0.31, 0.80, 0.30, 2.0),
]

# 尾梁：从根部（Y=-2.85）到尾端（Y=-7.05），圆截面，略微上翘
BOOM_Y0, BOOM_Y1 = -2.85, -7.05
BOOM_R0, BOOM_R1 = 0.27, 0.15
BOOM_Z0, BOOM_Z1 = 0.55, 0.78


def _interp(st, y):
    if y <= st[0][0]:
        return st[0][1:]
    if y >= st[-1][0]:
        return st[-1][1:]
    for i in range(len(st) - 1):
        if st[i][0] <= y <= st[i + 1][0]:
            break
    p0 = st[max(0, i - 1)]
    p1, p2 = st[i], st[i + 1]
    p3 = st[min(len(st) - 1, i + 2)]
    t = (y - p1[0]) / (p2[0] - p1[0])
    out = []
    for k in range(1, 5):
        # 非均匀 Catmull-Rom（按 Y 间距缩放切线）
        h = p2[0] - p1[0]
        m1 = (p2[k] - p0[k]) / (p2[0] - p0[0]) * h if p2[0] != p0[0] else 0
        m2 = (p3[k] - p1[k]) / (p3[0] - p1[0]) * h if p3[0] != p1[0] else 0
        t2, t3 = t * t, t * t * t
        out.append((2 * t3 - 3 * t2 + 1) * p1[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[k] + (t3 - t2) * m2)
    return out


def section(y):
    return _interp(STATIONS, y)


def rear_section(y):
    # 站位按 Y 递减排列：转成递增再插值
    return _interp(sorted(REAR_STATIONS), y)


def spow(x, p):
    return math.copysign(abs(x) ** p, x)


def superellipse(W, Zt, Zb, e, y, t):
    zc, H = (Zt + Zb) / 2, (Zt - Zb) / 2
    return Vector((W * spow(math.cos(t), 2 / e), y, zc + H * spow(math.sin(t), 2 / e)))


def ring_point(y, t):
    W, Zt, Zb, e = section(y)
    return superellipse(W, Zt, Zb, e, y, t)


def rear_point(y, t):
    W, Zt, Zb, e = rear_section(y)
    return superellipse(W, Zt, Zb, e, y, t)


# 涂装分色线的高度（Z）：腹部深色上沿、红色腰线上下沿
LIVERY_Z = (-0.45, -0.13, 0.0)


def ring_ts(W, Zt, Zb, e, NT):
    """一圈截面的参数 t（均匀分布），但把离分色线最近的点吸附到分色线上，使涂装边界是平滑的边环。"""
    ts = [2 * math.pi * i / NT for i in range(NT)]
    zc, H = (Zt + Zb) / 2, (Zt - Zb) / 2
    used = set()
    for z in LIVERY_Z:
        q = (z - zc) / H
        if abs(q) >= 0.98:
            continue
        s = math.copysign(abs(q) ** (e / 2), q)  # sin t
        a = math.asin(max(-1.0, min(1.0, s)))
        for t in (a % (2 * math.pi), (math.pi - a) % (2 * math.pi)):
            i = round(t / (2 * math.pi) * NT) % NT
            if i in used:
                continue
            used.add(i)
            ts[i] = t
    return ts


def livery_slot(center):
    """涂装：0 = 白色，1 = 腹部深灰蓝，2 = 红色腰线。按面中心的位置决定。"""
    z = center.z
    if z < -0.45:
        return 1
    if -0.13 < z < 0.0 and center.y < 2.15:
        return 2
    return 0
