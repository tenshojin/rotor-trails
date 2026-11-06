# 飞行员的身体：用有符号距离场“雕刻”，再抽成网格。
# 手指、手掌、袖口、衣褶、拉链和口袋都写成距离函数，比方块拼起来自然得多，也不需要任何外部模型。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/pilot_sdf.py art/out/pilot
# 输出 parts.npz + skeleton.json，再由 tools/blender/pilot.py 在 Blender 里绑骨骼、上材质、导出 glb。
#
# 坐标：Blender 世界坐标（X 右、Y 前、Z 上，单位米），和 cockpit.py 相同。绑定姿势就是坐在机长位、手握杆的样子。

import json
import math
import os
import sys

import numpy as np
from scipy import ndimage

OUT = sys.argv[1] if len(sys.argv) > 1 else 'art/out/pilot'
ONLY = sys.argv[2].split(',') if len(sys.argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
F32 = np.float32
rng = np.random.default_rng(7)


def V(*a):
    return np.array(a, dtype=np.float64)


def unit(v):
    return v / np.linalg.norm(v)


# ------------------------------------------------------------------ 距离函数
class Grid:
    def __init__(self, lo, hi, h):
        self.lo = np.array(lo, dtype=np.float64)
        self.h = h
        n = np.ceil((np.array(hi) - self.lo) / h).astype(int) + 1
        ax = [self.lo[i] + np.arange(n[i], dtype=np.float64) * h for i in range(3)]
        self.x, self.y, self.z = np.meshgrid(ax[0].astype(F32), ax[1].astype(F32), ax[2].astype(F32), indexing='ij', sparse=True)
        self.shape = tuple(n)


def smin(a, b, k):
    """平滑并集：k 是圆角的大小"""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def d_cone(g, a, b, r0, r1):
    """两端半径不同的圆柱（圆头）"""
    ab = b - a
    L2 = float(ab @ ab)
    t = ((g.x - a[0]) * ab[0] + (g.y - a[1]) * ab[1] + (g.z - a[2]) * ab[2]) / L2
    t = np.clip(t, 0, 1)
    dx = g.x - (a[0] + ab[0] * t)
    dy = g.y - (a[1] + ab[1] * t)
    dz = g.z - (a[2] + ab[2] * t)
    return np.sqrt(dx * dx + dy * dy + dz * dz) - (r0 + (r1 - r0) * t)


def d_ellipsoid(g, c, r, R=None):
    """椭球。R 的三列是椭球的三个轴"""
    dx, dy, dz = g.x - c[0], g.y - c[1], g.z - c[2]
    if R is not None:
        dx, dy, dz = (dx * R[0, 0] + dy * R[1, 0] + dz * R[2, 0], dx * R[0, 1] + dy * R[1, 1] + dz * R[2, 1], dx * R[0, 2] + dy * R[1, 2] + dz * R[2, 2])
    k0 = np.sqrt((dx / r[0]) ** 2 + (dy / r[1]) ** 2 + (dz / r[2]) ** 2)
    k1 = np.sqrt((dx / r[0] ** 2) ** 2 + (dy / r[1] ** 2) ** 2 + (dz / r[2] ** 2) ** 2)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-6)


def d_box(g, c, half, R, round_):
    dx, dy, dz = g.x - c[0], g.y - c[1], g.z - c[2]
    lx = dx * R[0, 0] + dy * R[1, 0] + dz * R[2, 0]
    ly = dx * R[0, 1] + dy * R[1, 1] + dz * R[2, 1]
    lz = dx * R[0, 2] + dy * R[1, 2] + dz * R[2, 2]
    qx = np.abs(lx) - (half[0] - round_)
    qy = np.abs(ly) - (half[1] - round_)
    qz = np.abs(lz) - (half[2] - round_)
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
    return out + np.minimum(np.maximum(np.maximum(qx, qy), qz), 0) - round_


def limb_coords(g, a, b, ref):
    """以 a→b 为轴的坐标：t 沿轴 0..1，th 绕轴的角度（ref 方向是 0），r 离轴的距离"""
    ax = unit(b - a)
    L = np.linalg.norm(b - a)
    u = unit(ref - ax * (ref @ ax))
    v = np.cross(ax, u)
    dx, dy, dz = g.x - a[0], g.y - a[1], g.z - a[2]
    t = (dx * ax[0] + dy * ax[1] + dz * ax[2]) / L
    pu = dx * u[0] + dy * u[1] + dz * u[2]
    pv = dx * v[0] + dy * v[1] + dz * v[2]
    return t, np.arctan2(pv, pu), np.sqrt(pu * pu + pv * pv)


def folds(t, th, n, amp, spots):
    """布料的褶皱：几道斜着绕过肢体的棱，集中在关节附近。spots = [(沿肢体的位置, 宽度, 朝向角)]"""
    f = np.zeros(np.broadcast_shapes(t.shape, th.shape), dtype=F32)
    for t0, w, a0 in spots:
        for _ in range(n):
            freq = rng.uniform(7, 15)
            slant = rng.uniform(-1.4, 1.4)
            ph = rng.uniform(0, 1)
            u = t * freq + th / (2 * math.pi) * slant * 2 + ph
            ridge = 1 - np.abs(np.sin(np.pi * u)) ** 0.55
            mask = np.exp(-(((t - t0) / w) ** 2)) * (0.45 + 0.55 * np.cos(th - a0 + rng.uniform(-0.8, 0.8)))
            f += (ridge * mask * rng.uniform(0.5, 1)).astype(F32)
    return amp * f / math.sqrt(n)


def lumps(shape, sigma, amp):
    """低频的不平：布料不是光滑的管子"""
    n = rng.standard_normal(tuple(max(4, s // 3) for s in shape)).astype(F32)
    n = ndimage.gaussian_filter(n, sigma / 3)
    n /= max(1e-6, np.abs(n).max())
    return ndimage.zoom(n, [s / m for s, m in zip(shape, n.shape)], order=1)[: shape[0], : shape[1], : shape[2]] * amp


def panel(t, th, t0, t1, a, b, raise_, soft=0.012):
    """肢体上的一块补片（口袋）：比周围高一点，边上有一道缝"""
    e = 1.0
    m = np.clip((t - t0) / soft, 0, 1) * np.clip((t1 - t) / soft, 0, 1) * np.clip((th - a) / (soft * 6), 0, 1) * np.clip((b - th) / (soft * 6), 0, 1)
    return raise_ * m * e


# ------------------------------------------------------------------ 抽网格（surface nets）
def surface_nets(F, lo, h):
    s = F < 0
    nx, ny, nz = F.shape
    corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    anyin = np.zeros((nx - 1, ny - 1, nz - 1), bool)
    allin = np.ones_like(anyin)
    for i, j, k in corners:
        c = s[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k]
        anyin |= c
        allin &= c
    mixed = anyin & ~allin
    ci = np.argwhere(mixed)
    ids = np.full(mixed.shape, -1, np.int32)
    ids[tuple(ci.T)] = np.arange(len(ci), dtype=np.int32)
    acc = np.zeros((len(ci), 3))
    cnt = np.zeros(len(ci))
    edges = [((0, 0, 0), (1, 0, 0)), ((0, 1, 0), (1, 1, 0)), ((0, 0, 1), (1, 0, 1)), ((0, 1, 1), (1, 1, 1)),
             ((0, 0, 0), (0, 1, 0)), ((1, 0, 0), (1, 1, 0)), ((0, 0, 1), (0, 1, 1)), ((1, 0, 1), (1, 1, 1)),
             ((0, 0, 0), (0, 0, 1)), ((1, 0, 0), (1, 0, 1)), ((0, 1, 0), (0, 1, 1)), ((1, 1, 0), (1, 1, 1))]
    for p, q in edges:
        a = F[ci[:, 0] + p[0], ci[:, 1] + p[1], ci[:, 2] + p[2]]
        b = F[ci[:, 0] + q[0], ci[:, 1] + q[1], ci[:, 2] + q[2]]
        m = (a < 0) != (b < 0)
        t = np.where(m, a / np.where(m, a - b, 1), 0)
        pos = np.array(p)[None] + (np.array(q) - np.array(p))[None] * t[:, None]
        acc[m] += pos[m]
        cnt[m] += 1
    verts = (ci + acc / np.maximum(cnt, 1)[:, None]) * h + lo
    quads = []
    # 每条穿过表面的网格边，周围四个格子连成一个四边形
    for axis in range(3):
        o = [(axis + 1) % 3, (axis + 2) % 3]
        sl0 = [slice(0, n - 1) if d == axis else slice(1, n - 1) for d, n in enumerate(F.shape)]
        sl1 = [slice(1, n) if d == axis else slice(1, n - 1) for d, n in enumerate(F.shape)]
        cross = s[tuple(sl0)] != s[tuple(sl1)]
        idx = np.argwhere(cross)
        if not len(idx):
            continue
        idx[:, o[0]] += 1
        idx[:, o[1]] += 1
        flip = s[tuple(idx.T)]

        def cell(du, dv):
            c = idx.copy()
            c[:, o[0]] -= du
            c[:, o[1]] -= dv
            return ids[tuple(c.T)]

        a, b, c, d = cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)
        q = np.stack([a, b, c, d], 1)
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    quads = np.concatenate(quads)
    quads = quads[(quads >= 0).all(1)]
    return verts, quads


def smooth_mesh(v, q, n=2, k=0.5):
    """拉普拉斯平滑：去掉体素台阶"""
    nb = np.zeros_like(v)
    cnt = np.zeros(len(v))
    for _ in range(n):
        nb[:] = 0
        cnt[:] = 0
        for i in range(4):
            a, b = q[:, i], q[:, (i + 1) % 4]
            np.add.at(nb, a, v[b])
            np.add.at(nb, b, v[a])
            np.add.at(cnt, a, 1)
            np.add.at(cnt, b, 1)
        v = v + (nb / np.maximum(cnt, 1)[:, None] - v) * k
    return v


# ------------------------------------------------------------------ 骨架
UPPER = 0.30
FORE = 0.268
HAND_R = dict(  # 右手的手掌局部坐标：x 指尖方向，y 手背方向，z 小指方向（拇指在 -z）
    index=dict(mcp=V(0.097, 0.000, -0.029), seg=(0.044, 0.027, 0.021), r=(0.0105, 0.0098, 0.0090, 0.0078), splay=-4),
    middle=dict(mcp=V(0.103, 0.002, -0.008), seg=(0.049, 0.031, 0.022), r=(0.0108, 0.0100, 0.0092, 0.0080), splay=-1),
    ring=dict(mcp=V(0.098, 0.001, 0.014), seg=(0.045, 0.029, 0.022), r=(0.0102, 0.0095, 0.0088, 0.0076), splay=2),
    pinky=dict(mcp=V(0.089, -0.003, 0.034), seg=(0.036, 0.022, 0.019), r=(0.0092, 0.0085, 0.0078, 0.0068), splay=6),
)
THUMB = dict(cmc=V(0.026, -0.012, -0.030), seg=(0.046, 0.034, 0.029), d=[V(0.60, -0.36, -0.71), V(0.76, -0.42, -0.50), V(0.88, -0.44, -0.20)], r=(0.0150, 0.0125, 0.0110, 0.0092))
# 绑定时手指的弯曲（度）：半握
BIND_FLEX = (28, 34, 20)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def finger_joints(f, flex=BIND_FLEX):
    """手掌局部坐标里，这根手指的四个关节点"""
    pts = [f['mcp']]
    d = unit(V(math.cos(math.radians(f['splay'])), 0, math.sin(math.radians(f['splay']))))
    a = 0.0
    for L, fl in zip(f['seg'], flex):
        a += math.radians(fl)
        # 绕手掌的 z 轴往手心弯：x → -y
        dd = V(d[0] * math.cos(a), -math.sin(a), d[2] * math.cos(a))
        pts.append(pts[-1] + unit(dd) * L)
    return pts


def thumb_joints():
    pts = [THUMB['cmc']]
    for L, d in zip(THUMB['seg'], THUMB['d']):
        pts.append(pts[-1] + unit(d) * L)
    return pts


def solve_elbow(s, w, pole):
    """两节手臂：肩 s、腕 w、肘往 pole 方向弯"""
    d = np.linalg.norm(w - s)
    d = min(d, UPPER + FORE - 1e-3)
    a = (UPPER ** 2 - FORE ** 2 + d ** 2) / (2 * d)
    h = math.sqrt(max(0.0, UPPER ** 2 - a ** 2))
    ax = unit(w - s)
    p = pole - s
    u = unit(p - ax * (p @ ax))
    return s + ax * a + u * h


def frame(x, up_hint):
    """手的坐标系：x 指尖方向，y 手背方向；up_hint 是手背大致朝向。返回三列 x, y, z"""
    x = unit(x)
    y = unit(up_hint - x * (up_hint @ x))
    return np.stack([x, y, np.cross(x, y)], 1)


SEAT_X = 0.45
EYE = V(SEAT_X, 1.00, 0.42)
# 肩、髋
SHOULDER = {'R': V(0.650, 0.905, 0.165), 'L': V(0.250, 0.905, 0.165)}
HIP = {'R': V(0.540, 0.965, -0.235), 'L': V(0.360, 0.965, -0.235)}
KNEE = {'R': V(0.600, 1.398, -0.232), 'L': V(0.300, 1.398, -0.232)}
ANKLE = {'R': V(0.572, 1.625, -0.640), 'L': V(0.328, 1.625, -0.640)}
# 手握杆的位置（右手周期变距握把，左手总距手柄），见 cockpit.py 的 cyclic_v2 / collective_v2
GRIP_R = V(SEAT_X, 1.362, -0.076)
GRIP_L = V(0.200, 1.222, -0.341)
# 手的朝向：右手从后面握住竖着的杆，拇指朝上；左手从上方握住几乎水平的手柄
HANDF = {
    'R': frame(V(-0.40, 0.90, 0.10), V(0.93, 0.32, 0.10)),
    'L': frame(V(0.62, 0.72, -0.12), V(-0.30, 0.10, 0.95)),
}
# 杆的中心在手掌局部坐标里的位置（握拳时手指围成的圈）
GRIP_LOCAL = V(0.084, -0.038, 0.0)


def wrist_of(side):
    g = GRIP_R if side == 'R' else GRIP_L
    return g - HANDF[side] @ GRIP_LOCAL


def hand_point(side, p):
    """手掌局部 → 世界。左手是右手的镜像（z 反号）"""
    q = np.array(p, dtype=np.float64)
    if side == 'L':
        q = q * V(1, 1, -1)
    return wrist_of(side) + HANDF[side] @ q


def skeleton():
    b = {}

    def add(name, parent, head, tail):
        b[name] = dict(parent=parent, head=[float(x) for x in head], tail=[float(x) for x in tail])

    pelvis = V(SEAT_X, 0.945, -0.235)
    chest = V(SEAT_X, 0.905, 0.135)
    add('pelvis', None, pelvis, pelvis + V(0, -0.01, 0.12))
    add('spine', 'pelvis', pelvis + V(0, -0.01, 0.12), chest)
    for s in 'RL':
        sh = SHOULDER[s]
        w = wrist_of(s)
        el = solve_elbow(sh, w, sh + V(0.16 if s == 'R' else -0.16, 0.02, -0.4))
        add(f'upper_{s}', 'spine', sh, el)
        add(f'fore_{s}', f'upper_{s}', el, w)
        mid = hand_point(s, HAND_R['middle']['mcp'])
        add(f'hand_{s}', f'fore_{s}', w, mid)
        for nm, f in HAND_R.items():
            pts = finger_joints(f)
            prev = f'hand_{s}'
            for i in range(3):
                add(f'{nm}{i + 1}_{s}', prev, hand_point(s, pts[i]), hand_point(s, pts[i + 1]))
                prev = f'{nm}{i + 1}_{s}'
        pts = thumb_joints()
        prev = f'hand_{s}'
        for i in range(3):
            add(f'thumb{i + 1}_{s}', prev, hand_point(s, pts[i]), hand_point(s, pts[i + 1]))
            prev = f'thumb{i + 1}_{s}'
        add(f'thigh_{s}', 'pelvis', HIP[s], KNEE[s])
        add(f'shin_{s}', f'thigh_{s}', KNEE[s], ANKLE[s])
        add(f'foot_{s}', f'shin_{s}', ANKLE[s], ANKLE[s] + V(0, 0.14, 0.03))
    return b


def bone_seg(b, name):
    return np.array(b[name]['head']), np.array(b[name]['tail'])


def weights_for(v, b, names, power=6.0, floor=0.004):
    """每个顶点按到骨头线段的距离分权重，最多四根。power 越大关节处的过渡越窄"""
    d = np.zeros((len(v), len(names)))
    for i, n in enumerate(names):
        a, c = bone_seg(b, n)
        ab = c - a
        t = np.clip(((v - a) @ ab) / (ab @ ab), 0, 1)
        d[:, i] = np.linalg.norm(v - (a + t[:, None] * ab), axis=1)
    w = 1 / np.maximum(d, floor) ** power
    order = np.argsort(-w, axis=1)[:, :4]
    rows = np.arange(len(v))[:, None]
    top = w[rows, order]
    top /= top.sum(1, keepdims=True)
    top[top < 0.01] = 0
    top /= top.sum(1, keepdims=True)
    return order.astype(np.int32), top.astype(np.float32)


# ------------------------------------------------------------------ 手
def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def glove_colors(v):
    """手套的颜色（顶点色）：手背是浅色阻燃布，手心、指腹和指尖是棕色软皮，腕带和袖筒是深一点的布。
    手指按它自己的弯曲方向分内外，不是简单地看手掌的上下：握拳时指尖是朝手背那边翻过来的。"""
    palm = sstep(0.0015, -0.0035, v[:, 1])
    best = np.full(len(v), np.inf)
    side = palm.copy()
    segs = []
    for nm, f in HAND_R.items():
        p = finger_joints(f)
        segs += [(p[i], p[i + 1], f['r'][i], i == 2, None) for i in range(3)]
    t = thumb_joints()
    pad = unit(V(0.30, -0.62, 0.72))
    segs += [(t[i], t[i + 1], THUMB['r'][i], i == 2, pad) for i in range(3)]
    for a, b_, r, tip, pd in segs:
        ab = b_ - a
        L2 = ab @ ab
        tt = np.clip(((v - a) @ ab) / L2, 0, 1)
        off = v - (a + tt[:, None] * ab)
        dist = np.linalg.norm(off, axis=1)
        d = unit(ab)
        want = pd if pd is not None else V(0, -1, 0)
        pal = unit(want - d * (want @ d))
        s = sstep(-0.42, 0.28, (off @ pal) / r)
        if tip:
            # 指尖一圈都是皮
            s = np.maximum(s, sstep(0.45, 0.72, tt))
        m = dist < best
        near = dist < r * 1.9
        side = np.where(m & near, s, side)
        best = np.where(m, dist, best)
    back = V(0.310, 0.300, 0.235)
    leather = V(0.215, 0.145, 0.085)
    strap = V(0.115, 0.110, 0.092)
    cuff = V(0.255, 0.245, 0.195)
    c = back[None] * (1 - side[:, None]) + leather[None] * side[:, None]
    # 手背指根的护垫和掌心的磨损：颜色深一点
    k = sstep(-0.004, -0.010, v[:, 0] - 0.0)
    c = c * (1 - k[:, None]) + cuff[None] * k[:, None]
    band = sstep(0.0135, 0.0115, np.abs(v[:, 0] + 0.016))
    c = c * (1 - band[:, None]) + strap[None] * band[:, None]
    return c.astype(np.float32)


def build_hand(side, b):
    """手套：手背是织物，手心和指腹是皮革。网格在手掌局部算（精度高），最后摆到世界坐标"""
    h = 0.00125
    g = Grid((-0.075, -0.075, -0.098), (0.205, 0.048, 0.070), h)
    # 手掌和手腕
    I3 = np.eye(3)
    palm = d_box(g, V(0.056, -0.002, 0.002), V(0.052, 0.0150, 0.0425), I3, 0.0125)
    wrist = d_ellipsoid(g, V(-0.006, -0.002, 0.0), V(0.050, 0.0215, 0.0325))
    d = smin(palm, wrist, 0.018)
    # 手掌肌肉：大鱼际、小鱼际、掌根
    d = smin(d, d_ellipsoid(g, V(0.042, -0.016, -0.028), V(0.036, 0.017, 0.020)), 0.010)
    d = smin(d, d_ellipsoid(g, V(0.044, -0.014, 0.031), V(0.040, 0.014, 0.014)), 0.010)
    # 手指：互相之间不融合，每根都和手掌圆滑相接
    fingers = None
    for nm, f in HAND_R.items():
        pts = finger_joints(f)
        fd = None
        for i in range(3):
            c = d_cone(g, pts[i], pts[i + 1], f['r'][i], f['r'][i + 1])
            fd = c if fd is None else smin(fd, c, 0.0016)
        # 指关节处微微鼓起
        for i in (1, 2):
            fd = smin(fd, d_ellipsoid(g, pts[i], V(f['r'][i] * 1.08, f['r'][i] * 1.08, f['r'][i] * 1.1)), 0.002)
        fingers = fd if fingers is None else np.minimum(fingers, fd)
    d = smin(d, fingers, 0.0052)
    # 拇指
    t = thumb_joints()
    td = None
    for i in range(3):
        c = d_cone(g, t[i], t[i + 1], THUMB['r'][i], THUMB['r'][i + 1])
        td = c if td is None else smin(td, c, 0.003)
    d = smin(d, td, 0.010)
    # 掌骨在手背上的起伏
    for nm, f in HAND_R.items():
        d = smin(d, d_cone(g, V(0.03, 0.009, f['mcp'][2] * 0.6), f['mcp'] + V(-0.002, 0.008, 0), 0.0045, 0.0062), 0.006)
        # 指根关节的护垫（手套上一块加厚）
        d = smin(d, d_ellipsoid(g, f['mcp'] + V(0.002, 0.0095, 0), V(0.0115, 0.0052, 0.0098)), 0.0032)
    # 手套的袖筒：比手腕大一圈，往后张开
    cuffy = (g.y + 0.001) * 1.42
    cz = g.z
    r = np.sqrt(cuffy ** 2 + cz ** 2)
    xx = np.clip((-0.012 - g.x) / 0.030, 0, 1)
    cuff = (r - (0.0315 + 0.0030 * xx)) * 0.72
    cuff = np.maximum(cuff, np.maximum(g.x + 0.006, -(g.x + 0.042)))
    d = smin(d, cuff, 0.006)
    # 魔术贴腕带：绕手腕一圈的带子 + 手背上一块搭扣
    strap = (np.abs(g.x + 0.016) - 0.0115)
    r2 = np.sqrt(((g.y + 0.001) * 1.42) ** 2 + g.z ** 2)
    d = np.minimum(d, np.maximum(strap, (r2 - 0.0339) * 0.72))
    d = smin(d, d_box(g, V(-0.016, 0.0222, -0.006), V(0.0118, 0.0034, 0.024), I3, 0.0018), 0.0012)
    # 缝线：手指两侧、手背和手心的分界
    F = d
    # 掌心的皮革补片比周围高一点
    sy = g.y
    F = F - 0.00045 * (np.clip((-0.002 - sy) / 0.004, 0, 1) * (g.x > 0.0))
    v, q = surface_nets(F, g.lo, h)
    v = smooth_mesh(v, q, 3, 0.45)
    col = glove_colors(v)
    zone = np.zeros(len(v), np.int32)
    if side == 'L':
        v = v * V(1, 1, -1)
        q = q[:, ::-1]
    w = wrist_of(side)
    vw = w + v @ HANDF[side].T
    names = [f'hand_{side}', f'fore_{side}'] + [f'{n}{i}_{side}' for n in list(HAND_R) + ['thumb'] for i in (1, 2, 3)]
    idx, wt = weights_for(vw, b, names, power=7.0, floor=0.0035)
    # 手掌的主体别被手指根部的骨头拉走
    return dict(v=vw, q=q, zone=zone, bones=names, idx=idx, wt=wt, mats=['glove'], col=col)


# ------------------------------------------------------------------ 手臂
def arm_radius(t):
    return np.interp(t, [0, 0.5, 1], [0.052, 0.047, 0.041])


def build_arm(side, b):
    h = 0.0032
    s, e = bone_seg(b, f'upper_{side}')
    _, w = bone_seg(b, f'fore_{side}')
    lo = np.minimum(np.minimum(s, e), w) - 0.09
    hi = np.maximum(np.maximum(s, e), w) + 0.09
    g = Grid(lo, hi, h)
    up = d_cone(g, s, e, 0.058, 0.046)
    fo = d_cone(g, e, w - unit(w - e) * 0.006, 0.0465, 0.0365)
    d = smin(up, fo, 0.016)
    # 肩头：圆一点，和上身接上
    d = smin(d, d_ellipsoid(g, s + V(0, 0, 0.004), V(0.066, 0.066, 0.058)), 0.02)
    out = V(1.0 if side == 'R' else -1.0, 0, 0)
    t1, th1, _ = limb_coords(g, s, e, out)
    t2, th2, _ = limb_coords(g, e, w, V(0, 0, -1))
    # 上臂和小臂的布料褶皱：肘窝最密，袖口堆起来
    wrinkle = folds(t1, th1, 5, 0.0150, [(0.92, 0.22, math.pi), (0.1, 0.2, 0.0)]) * (t1 < 1.1) * (t1 > -0.1)
    wrinkle2 = folds(t2, th2, 6, 0.0140, [(0.08, 0.22, math.pi), (0.95, 0.20, 0.0), (0.6, 0.3, 1.0)]) * (t2 > -0.1) * (t2 < 1.1)
    F = d - np.maximum(wrinkle, wrinkle2) - lumps(g.shape, 9.0, 0.0030)
    # 左上臂的笔袋
    if side == 'L':
        F = F - panel(t1, th1, 0.42, 0.72, -1.0, 0.7, 0.0035)
    # 袖口：缝一圈松紧
    cuffband = np.exp(-(((t2 - 0.955) / 0.022) ** 2)) * (t2 < 1.1)
    F = F - 0.0022 * cuffband
    v, q = surface_nets(F, g.lo, h)
    v = smooth_mesh(v, q, 2, 0.5)
    names = [f'upper_{side}', f'fore_{side}', 'spine', f'hand_{side}']
    idx, wt = weights_for(v, b, names, power=5.0, floor=0.02)
    return dict(v=v, q=q, zone=np.zeros(len(v), np.int32), bones=names, idx=idx, wt=wt, mats=['suit'])


# ------------------------------------------------------------------ 上身
def build_torso(b):
    h = 0.0042
    g = Grid((SEAT_X - 0.33, 0.70, -0.42), (SEAT_X + 0.33, 1.20, 0.30), h)
    # 一叠椭圆：每个高度上的中心和半宽、半厚
    zs = np.array([-0.40, -0.30, -0.20, -0.08, 0.05, 0.14, 0.205, 0.26])
    cy = np.array([0.965, 0.955, 0.935, 0.925, 0.915, 0.905, 0.900, 0.910])
    ra = np.array([0.150, 0.185, 0.182, 0.158, 0.178, 0.192, 0.165, 0.070])
    rb = np.array([0.100, 0.130, 0.128, 0.112, 0.128, 0.122, 0.100, 0.062])
    z = g.z.astype(np.float64)
    c = np.interp(z, zs, cy)
    a = np.interp(z, zs, ra)
    bb = np.interp(z, zs, rb)
    dx = g.x - SEAT_X
    dy = g.y - c
    k = np.sqrt((dx / a) ** 2 + (dy / bb) ** 2)
    d = (k - 1) * np.minimum(a, bb)
    d = smax(d, (g.z - 0.27), 0.03)
    d = smax(d, (-0.40 - g.z), 0.02)
    d = d.astype(F32)
    # 衣服：胸前的褶皱、腰带下的堆积
    tz = (z - (-0.40)) / 0.67
    th = np.arctan2(dx, dy)
    F = d - folds(tz, th, 7, 0.0130, [(0.30, 0.17, 0.0), (0.62, 0.22, 0.6), (0.62, 0.22, -0.6)]) - lumps(g.shape, 9.0, 0.0030)
    # 拉链：中线上一道细棱，两边压进去一点
    zip_ = np.exp(-((dx / 0.0035) ** 2)) * (dy > 0)
    gut = np.exp(-((dx / 0.012) ** 2)) * (dy > 0)
    F = F - 0.0016 * zip_ + 0.0012 * gut
    # 胸前两个口袋
    for sx in (-1, 1):
        px = dx * sx
        m = np.clip((px - 0.040) / 0.004, 0, 1) * np.clip((0.135 - px) / 0.004, 0, 1) * np.clip((g.z - 0.015) / 0.004, 0, 1) * np.clip((0.125 - g.z) / 0.004, 0, 1) * (dy > 0)
        F = F - 0.0032 * m
        # 袋盖
        m2 = np.clip((px - 0.036) / 0.003, 0, 1) * np.clip((0.139 - px) / 0.003, 0, 1) * np.clip((g.z - 0.098) / 0.003, 0, 1) * np.clip((0.132 - g.z) / 0.003, 0, 1) * (dy > 0)
        F = F - 0.0022 * m2
    # 腰带
    belt = np.exp(-(((z + 0.135) / 0.020) ** 2))
    F = F - (0.0030 * belt).astype(F32)
    v, q = surface_nets(F.astype(F32), g.lo, h)
    v = smooth_mesh(v, q, 2, 0.5)
    names = ['pelvis', 'spine']
    idx, wt = weights_for(v, b, names, power=3.0, floor=0.03)
    return dict(v=v, q=q, zone=np.zeros(len(v), np.int32), bones=names, idx=idx, wt=wt, mats=['suit'])


# ------------------------------------------------------------------ 腿和靴子
def build_leg(side, b):
    h = 0.0040
    hip, kn = bone_seg(b, f'thigh_{side}')
    _, an = bone_seg(b, f'shin_{side}')
    lo = np.minimum(np.minimum(hip, kn), an) - 0.12
    hi = np.maximum(np.maximum(hip, kn), an) + 0.12
    g = Grid(lo, hi, h)
    th_ = d_cone(g, hip + V(0, -0.03, 0.01), kn + V(0, -0.012, -0.004), 0.084, 0.054)
    sh = d_cone(g, kn + V(0, 0.002, -0.006), an + V(0, -0.012, 0.028), 0.0525, 0.044)
    d = smin(th_, sh, 0.016)
    # 膝盖骨
    d = smin(d, d_ellipsoid(g, kn + V(0, 0.022, 0.016), V(0.043, 0.036, 0.040)), 0.012)
    # 小腿肚
    mid = kn * 0.62 + an * 0.38 + V(0, -0.022, -0.008)
    d = smin(d, d_ellipsoid(g, mid, V(0.052, 0.050, 0.09)), 0.03)
    out = V(1.0 if side == 'R' else -1.0, 0, 0.0)
    t1, a1, _ = limb_coords(g, hip, kn, out)
    t2, a2, _ = limb_coords(g, kn, an, out)
    F = d - np.maximum(folds(t1, a1, 7, 0.0170, [(0.90, 0.24, math.pi / 2), (0.05, 0.24, -math.pi / 2), (0.55, 0.30, 0.0)]) * (t1 < 1.1) * (t1 > -0.2),
                       folds(t2, a2, 6, 0.0160, [(0.08, 0.24, -math.pi / 2), (0.92, 0.18, 0.0)]) * (t2 > -0.1) * (t2 < 1.1)) - lumps(g.shape, 9.0, 0.0030)
    # 大腿外侧的口袋和袋盖
    F = F - panel(t1, a1, 0.34, 0.72, -0.72, 0.72, 0.0048)
    F = F - panel(t1, a1, 0.30, 0.42, -0.80, 0.80, 0.0030)
    # 小腿外侧的长条口袋
    F = F - panel(t2, a2, 0.18, 0.62, -0.46, 0.46, 0.0040)
    v, q = surface_nets(F, g.lo, h)
    v = smooth_mesh(v, q, 2, 0.5)
    names = [f'thigh_{side}', f'shin_{side}', 'pelvis', f'foot_{side}']
    idx, wt = weights_for(v, b, names, power=5.0, floor=0.02)
    return dict(v=v, q=q, zone=np.zeros(len(v), np.int32), bones=names, idx=idx, wt=wt, mats=['suit'])


def build_boot(side, b):
    h = 0.0026
    an = np.array(b[f'foot_{side}']['head'])
    x = an[0]
    # 鞋底这条线：脚跟踩在地板上，前掌抬起来踩着脚蹬
    heel = V(x, 1.585, -0.742)
    ball = V(x, 1.748, -0.640)
    toe = V(x, 1.815, -0.594)
    lo = (x - 0.09, 1.50, -0.80)
    hi = (x + 0.09, 1.86, -0.46)
    g = Grid(lo, hi, h)
    foot = d_cone(g, heel + V(0, 0.022, 0.024), ball + V(0, -0.012, 0.022), 0.043, 0.041)
    d = smin(foot, d_cone(g, ball + V(0, -0.012, 0.022), toe + V(0, -0.024, 0.008), 0.042, 0.032), 0.015)
    # 脚背到脚踝
    d = smin(d, d_cone(g, ball + V(0, -0.040, 0.046), an + V(0, 0.014, -0.006), 0.034, 0.044), 0.026)
    # 靴筒
    shaft_top = an + V(0, -0.034, 0.100)
    d = smin(d, d_cone(g, an, shaft_top, 0.048, 0.050), 0.014)
    # 鞋底：斜着切平
    n = unit(np.cross(toe - heel, V(1, 0, 0)))
    if n[2] < 0:
        n = -n
    plane = -((g.x - heel[0]) * n[0] + (g.y - heel[1]) * n[1] + (g.z - heel[2]) * n[2]) + 0.0
    d = smax(d, plane - 0.0025, 0.004)
    sole = np.maximum(smax(foot - 0.005, plane - 0.0005, 0.002), -(plane + 0.0125))
    # 鞋底比鞋面宽一点，花纹靠法线贴图
    sole_d = np.maximum(d_cone(g, heel + V(0, 0.010, 0.0), toe + V(0, -0.012, 0.0), 0.049, 0.040), np.maximum(-plane - 0.0125, plane - 0.002))
    F = np.minimum(d, sole_d)
    # 靴筒口的软垫一圈
    t, a, r = limb_coords(g, an, shaft_top, V(1, 0, 0))
    F = F - 0.0022 * np.exp(-(((t - 0.96) / 0.05) ** 2)) * (r < 0.09)
    # 鞋带：脚背上几道
    tl, al, rl = limb_coords(g, ball + V(0, -0.040, 0.046), an + V(0, 0.014, -0.006), V(0, 0.6, 0.8))
    F = F - 0.0018 * (np.abs(np.sin(tl * 26)) ** 6) * (np.abs(al) < 0.5) * (tl > 0.05) * (tl < 0.98)
    v, q = surface_nets(F.astype(F32), g.lo, h)
    v = smooth_mesh(v, q, 2, 0.4)
    # 分区：鞋面 / 鞋底
    pl = -((v[:, 0] - heel[0]) * n[0] + (v[:, 1] - heel[1]) * n[1] + (v[:, 2] - heel[2]) * n[2])
    zone = (pl > -0.0005).astype(np.int32)
    names = [f'foot_{side}', f'shin_{side}']
    idx, wt = weights_for(v, b, names, power=4.0, floor=0.03)
    return dict(v=v, q=q, zone=zone, bones=names, idx=idx, wt=wt, mats=['boot', 'sole'])


# ------------------------------------------------------------------ 头盔（只有外面的镜头看得到）
def build_head(b):
    h = 0.0036
    c = V(SEAT_X, 0.945, 0.415)
    g = Grid(c - 0.17, c + 0.17, h)
    shell = d_ellipsoid(g, c + V(0, -0.012, 0.018), V(0.112, 0.133, 0.122))
    # 下巴和耳罩
    d = smin(shell, d_ellipsoid(g, c + V(0, 0.016, -0.095), V(0.075, 0.085, 0.060)), 0.02)
    for sx in (-1, 1):
        d = smin(d, d_ellipsoid(g, c + V(sx * 0.098, -0.012, -0.032), V(0.030, 0.056, 0.060)), 0.012)
    d = smin(d, d_cone(g, c + V(0, -0.02, -0.11), c + V(0, -0.03, -0.17), 0.058, 0.062), 0.02)
    # 面窗：前面切一个斜面，里面放一块深色的护目镜
    open_ = d_ellipsoid(g, c + V(0, 0.126, -0.030), V(0.093, 0.056, 0.070))
    d = smax(d, -open_, 0.010)
    F = np.minimum(d, d_ellipsoid(g, c + V(0, 0.056, 0.0), V(0.092, 0.082, 0.078)))
    v, q = surface_nets(F, g.lo, h)
    v = smooth_mesh(v, q, 2, 0.5)
    n = (v - c)
    zone = ((n[:, 1] > 0.06) & (n[:, 2] > -0.1) & (np.abs(n[:, 0]) < 0.092) & (n[:, 2] < 0.075)).astype(np.int32)
    names = ['spine']
    return dict(v=v, q=q, zone=zone, bones=names, idx=np.zeros((len(v), 1), np.int32), wt=np.ones((len(v), 1), np.float32), mats=['helmet', 'visor'])


def main():
    b = skeleton()
    with open(os.path.join(OUT, 'skeleton.json'), 'w', encoding='utf-8') as f:
        json.dump(b, f, ensure_ascii=False, indent=0)
    parts = {}
    jobs = [('hand_R', lambda: build_hand('R', b)), ('hand_L', lambda: build_hand('L', b)), ('arm_R', lambda: build_arm('R', b)), ('arm_L', lambda: build_arm('L', b)),
            ('torso', lambda: build_torso(b)), ('leg_R', lambda: build_leg('R', b)), ('leg_L', lambda: build_leg('L', b)), ('boot_R', lambda: build_boot('R', b)), ('boot_L', lambda: build_boot('L', b)),
            ('head', lambda: build_head(b))]
    for name, fn in jobs:
        if ONLY and name not in ONLY:
            continue
        p = fn()
        parts[name] = p
        print(name, 'verts', len(p['v']), 'quads', len(p['q']))
        np.savez_compressed(os.path.join(OUT, name + '.npz'), v=p['v'].astype(np.float32), q=p['q'].astype(np.int32), zone=p['zone'], idx=p['idx'], wt=p['wt'],
                            bones=np.array(p['bones']), mats=np.array(p['mats']), col=p.get('col', np.zeros((0, 3), np.float32)))
    print('ok')


if __name__ == '__main__':
    main()
