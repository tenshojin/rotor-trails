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
# 头的中心（头盔、脸都按它摆；pilot.py 里的头盔用同一个点）
HEAD_C = V(SEAT_X, 0.945, 0.415)
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
    # 头：脖子根到头的中心。脸和头盔都挂在这根骨头上，游戏里可以让飞行员转头
    add('head', 'spine', V(SEAT_X, 0.915, 0.250), HEAD_C)
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
        segs += [(p[i], p[i + 1], f['r'][i], i, None) for i in range(3)]
    t = thumb_joints()
    pad = unit(V(0.30, -0.62, 0.72))
    segs += [(t[i], t[i + 1], THUMB['r'][i], i, pad) for i in range(3)]
    for a, b_, r, seg_i, pd in segs:
        ab = b_ - a
        L2 = ab @ ab
        tt = np.clip(((v - a) @ ab) / L2, 0, 1)
        off = v - (a + tt[:, None] * ab)
        dist = np.linalg.norm(off, axis=1)
        d = unit(ab)
        want = pd if pd is not None else V(0, -1, 0)
        pal = unit(want - d * (want @ d))
        s = sstep(-0.42, 0.28, (off @ pal) / r)
        # 设定图里的手套：指尖和中节一整圈都是深棕皮，手背的布只到第一节
        if seg_i == 2:
            s = np.maximum(s, sstep(0.05, 0.25, tt))
        elif seg_i == 1:
            s = np.maximum(s, sstep(0.45, 0.80, tt))
        if seg_i == 2:
            # 指尖一圈都是皮
            s = np.maximum(s, sstep(0.45, 0.72, tt))
        m = dist < best
        near = dist < r * 1.9
        side = np.where(m & near, s, side)
        best = np.where(m, dist, best)
    # 颜色取自 MOSS-Image 生成的手套参考图（art/src/ref/pilot/glove_s9.png）：整只驼色软皮，手心稍深，
    # 比皮肤更黄、更饱和（皮肤 G/R 约 0.56，这里 0.48），第一人称里一眼看得出是手套
    back = V(0.342, 0.155, 0.055)
    leather = V(0.290, 0.128, 0.044)
    # 腕带上的魔术贴：灰褐色的毛面
    strap = V(0.120, 0.094, 0.070)
    cuff = V(0.310, 0.140, 0.050)
    c = back[None] * (1 - side[:, None]) + leather[None] * side[:, None]
    # 手背和手心的接缝（手指两侧）、指根那道横缝：深一点的缝线
    seam = np.exp(-(((side - 0.5) / 0.10) ** 2))
    knuckle = np.exp(-(((v[:, 0] - 0.074) / 0.0026) ** 2)) * (v[:, 1] > 0.004)
    c = c * (1 - 0.42 * np.maximum(seam, knuckle)[:, None])
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
            # 皮手套比手指粗一圈
            c = d_cone(g, pts[i], pts[i + 1], f['r'][i] * 1.07, f['r'][i + 1] * 1.07)
            fd = c if fd is None else smin(fd, c, 0.0016)
        # 手指两侧凸起的缝线（皮手套的指缝）
        for i in (0, 1):
            ax_ = unit(pts[i + 1] - pts[i])
            for sz in (-1, 1):
                off = V(0, 0, sz * f['r'][i] * 0.97)
                fd = smin(fd, d_cone(g, pts[i] + off + ax_ * 0.002, pts[i + 1] + off * 0.98 - ax_ * 0.001, 0.0011, 0.0010), 0.0012)
            # 手指背面两道顺着手指的缝（参考图 glove_s9 手背上最显眼的就是这个）
            up_ = unit(V(0, 1, 0) - ax_ * ax_[1])
            for sz in (-1, 1):
                off = (up_ * 0.80 + V(0, 0, sz * 0.60)) * f['r'][i] * 1.05
                fd = smin(fd, d_cone(g, pts[i] + off + ax_ * 0.003, pts[i + 1] + off - ax_ * 0.002, 0.0010, 0.0009), 0.0010)
        # 手套在指关节背面堆起的几道皱褶
        for i in (1, 2):
            ax_ = unit(pts[i + 1] - pts[i - 1])
            up_ = unit(V(0, 1, 0) - ax_ * ax_[1])
            for k, off in enumerate((-0.0042, 0.0, 0.0042)):
                cc = pts[i] + ax_ * off + up_ * f['r'][i] * 0.92
                # 横跨手指的一道细棱：手掌坐标里手指的左右方向就是 z
                fd = smin(fd, d_ellipsoid(g, cc, V(0.0016, 0.0016, f['r'][i] * 0.85)), 0.0015)
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
    # 手背是一整块皮，看不到掌骨的起伏；指根关节处一块加厚的护垫
    for nm, f in HAND_R.items():
        d = smin(d, d_ellipsoid(g, f['mcp'] + V(0.002, 0.0095, 0), V(0.0115, 0.0052, 0.0098)), 0.0032)
    # 手套的袖筒：比手腕大一圈，往后张开
    cuffy = (g.y + 0.001) * 1.42
    cz = g.z
    r = np.sqrt(cuffy ** 2 + cz ** 2)
    # 护腕比手腕大一圈、往后张开，盖过袖口
    xx = np.clip((-0.012 - g.x) / 0.045, 0, 1)
    cuff = (r - (0.0335 + 0.0045 * xx)) * 0.72
    cuff = np.maximum(cuff, np.maximum(g.x + 0.006, -(g.x + 0.058)))
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
    # 袖口停在手腕后面 3 厘米：露出手套的护腕和魔术贴
    fo = d_cone(g, e, w - unit(w - e) * 0.048, 0.0465, 0.0380)
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
def mx(*a):
    """好几个距离场取最大（交集）；形状不同的数组会自动广播"""
    out = a[0]
    for x in a[1:]:
        out = np.maximum(out, x)
    return out


def mn(*a):
    out = a[0]
    for x in a[1:]:
        out = np.minimum(out, x)
    return out


def seg_dist2(px, py, p0, p1):
    """平面上点到线段的距离（拉链、缝线用）"""
    ax_, ay_ = p0
    vx, vy = p1[0] - ax_, p1[1] - ay_
    t = np.clip(((px - ax_) * vx + (py - ay_) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.sqrt((px - ax_ - t * vx) ** 2 + (py - ay_ - t * vy) ** 2)


def sample_at(F, lo, h, v):
    """格点上的距离场在顶点处的值（三线性插值）"""
    coords = ((v - np.asarray(lo)) / h).T
    return ndimage.map_coordinates(F, coords, order=1, mode='nearest')


def torso_base(g):
    """上身的形状（不含衣服细节）：一叠椭圆 + 斜方肌、胸肌。设定图里是宽肩、厚胸的身材"""
    zs = np.array([-0.40, -0.30, -0.20, -0.08, 0.05, 0.14, 0.205, 0.26])
    cy = np.array([0.965, 0.955, 0.935, 0.925, 0.915, 0.905, 0.900, 0.910])
    ra = np.array([0.150, 0.182, 0.174, 0.156, 0.180, 0.198, 0.170, 0.068])
    rb = np.array([0.100, 0.128, 0.125, 0.110, 0.128, 0.124, 0.102, 0.060])
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
    for s in (-1, 1):
        # 斜方肌：脖子根斜着下到肩头
        d = smin(d, d_cone(g, V(SEAT_X + s * 0.035, 0.902, 0.245), V(SEAT_X + s * 0.175, 0.900, 0.178), 0.046, 0.050), 0.035)
        # 胸肌：胸口宽一点、厚一点
        d = smin(d, d_ellipsoid(g, V(SEAT_X + s * 0.078, 0.972, 0.098), V(0.082, 0.050, 0.062)), 0.035)
    return d.astype(F32), c, dx, dy, z


def build_torso(b):
    """上身：飞行服（衣领、拉链、斜拉链胸袋）+ 黑色网眼背心（两个胸袋、肩带）+ 腰带。
    样子照 MOSS-Image 生成的设定图（art/src/ref/pilot/sheet_s11.png、sheet_s33.png）"""
    h = 0.0034
    g = Grid((SEAT_X - 0.33, 0.70, -0.42), (SEAT_X + 0.33, 1.20, 0.33), h)
    body, c, dx, dy, z = torso_base(g)
    th = np.arctan2(dx, dy)
    tz = (z - (-0.40)) / 0.67
    front = dy > 0
    adx = np.abs(dx)
    # ---- 飞行服
    suit = body - folds(tz, th, 7, 0.0115, [(0.30, 0.17, 0.0), (0.62, 0.22, 0.6), (0.62, 0.22, -0.6)]) - lumps(g.shape, 9.0, 0.0026)
    # 拉链：中线上一道细棱，两边压进去一点（从衣领的 V 口一直往下）
    zip_ = np.exp(-((dx / 0.0032) ** 2)) * front * (z < 0.232)
    gut = np.exp(-((dx / 0.011) ** 2)) * front * (z < 0.232)
    suit = suit - 0.0017 * zip_ + 0.0011 * gut
    for s in (-1, 1):
        # 胸前的斜拉链口袋：拉链从领口外侧斜着往下，下面一块补片
        p0, p1 = (s * 0.040, 0.168), (s * 0.140, 0.080)
        dseg = seg_dist2(dx, z, p0, p1)
        suit = suit - 0.0017 * np.exp(-((dseg / 0.0024) ** 2)) * front
        below = (z < 0.168 + (dx * s - 0.040) * (0.080 - 0.168) / 0.100) & (z > 0.035) & (dx * s > 0.036) & (dx * s < 0.150)
        suit = suit - 0.0010 * below * front
    # 腰上的松紧：飞行服自带的布腰带
    suit = suit - 0.0024 * np.exp(-(((z + 0.150) / 0.016) ** 2))
    suit = suit.astype(F32)
    # ---- 衣领：脖子根一圈立着的领子，前面开 V 口；里面露一圈灰色 T 恤
    gy = g.y - 0.918
    rr = np.sqrt(dx ** 2 + (gy * 1.05) ** 2)
    thn = np.arctan2(dx, gy)
    zc = 0.262 - 0.024 * np.cos(thn)
    # 领子往外翻一点（越往上越大）
    rcol = 0.074 + 0.10 * np.clip(g.z - zc + 0.024, 0, 0.05)
    collar = mx(np.abs(rr - rcol) - 0.0058, np.abs(g.z - zc - 0.004) - 0.026, (np.cos(thn) - 0.82) * 0.05).astype(F32)
    tee = mx(np.abs(rr - 0.0615) - 0.0042, np.abs(g.z - (zc - 0.010)) - 0.013, -(np.cos(thn) - 0.30) * 0.05).astype(F32)
    # ---- 背心：贴着衣服外面 1 厘米的一层壳，只留背心的范围（前片、后片、腋下、肩带）
    shell = np.abs(body - 0.012) - 0.0048
    r_front = mx(0.068 - adx, adx - 0.190, z - 0.142, -0.135 - z, -(dy + 0.03))
    r_back = mx(adx - 0.172, z - 0.222, -0.135 - z, dy - 0.01)
    r_side = mx(-0.135 - z, z - 0.03, 0.068 - adx)
    r_strap = mx(0.058 - adx, adx - 0.122, 0.10 - z)
    vest = smax(shell, mn(r_front, r_back, r_side, r_strap), 0.003)
    I3 = np.eye(3)
    for s in (-1, 1):
        # 胸袋：贴在背心前片上，跟着身体侧面转 32°；上面一块袋盖
        ang = s * math.radians(32)
        R = rot_z(-ang)
        n = V(math.sin(ang), math.cos(ang), 0)
        base = V(SEAT_X + s * 0.112, 1.0082, -0.02)
        pc = base + n * 0.040
        vest = np.minimum(vest, d_box(g, pc, V(0.040, 0.022, 0.060), R, 0.008))
        vest = np.minimum(vest, d_box(g, pc + n * 0.002 + V(0, 0, 0.050), V(0.043, 0.024, 0.014), R, 0.006))
    vest = vest.astype(F32)
    # ---- 腰带：背心下沿外面一圈尼龙织带
    belt = mx(np.abs(body - 0.0158) - 0.0042, np.abs(z + 0.112) - 0.021).astype(F32)
    parts = [suit, vest, belt, tee, collar]
    F = mn(*parts)
    v, q = surface_nets(F, g.lo, h)
    v = smooth_mesh(v, q, 2, 0.5)
    # 分区：顶点离哪一层最近就是哪种材质（衣领算飞行服）
    vals = np.stack([sample_at(p, g.lo, h, v) for p in parts], 1)
    zone = np.argmin(np.abs(vals), 1).astype(np.int32)
    zone[zone == 4] = 0
    names = ['pelvis', 'spine']
    idx, wt = weights_for(v, b, names, power=3.0, floor=0.03)
    return dict(v=v, q=q, zone=zone, bones=names, idx=idx, wt=wt, mats=['suit', 'vest', 'strap', 'tee'])


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
    # 大腿正面的斜拉链口袋（设定图 s33）：坐着的时候在大腿上面，低头看得到；小腿口袋上一道竖拉链
    top = -math.pi / 2 if side == 'R' else math.pi / 2
    Lth = float(np.linalg.norm(kn - hip))
    Lsh = float(np.linalg.norm(an - kn))
    dz1 = seg_dist2(t1 * Lth, a1 * 0.075, (0.07 * Lth, (top - 0.62) * 0.075), (0.40 * Lth, (top + 0.28) * 0.075))
    F = F - 0.0017 * np.exp(-((dz1 / 0.0026) ** 2)) * (t1 > 0) * (t1 < 1)
    dz2 = seg_dist2(t2 * Lsh, a2 * 0.05, (0.22 * Lsh, 0.0), (0.58 * Lsh, 0.0))
    F = F - 0.0014 * np.exp(-((dz2 / 0.0022) ** 2)) * (t2 > 0) * (t2 < 1)
    # 脚踝的松紧收口（盖在靴筒上）
    F = F - 0.0030 * np.exp(-(((t2 - 0.93) / 0.03) ** 2)) * (t2 < 1.1)
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
    """脸和脖子（头盔在 pilot.py 里用 Blender 建）。照 MOSS-Image 的特写（art/src/ref/pilot/face_s7.png）：
    方下巴、高颧骨、挺直的鼻梁，下巴和上唇一层短胡茬。面罩放下来盖到鼻梁中间，眼睛只做了闭着的眼皮。"""
    h = 0.0015
    c = HEAD_C
    g = Grid(c + V(-0.092, -0.07, -0.235), c + V(0.092, 0.13, 0.115), h)

    def L(x, y, z):
        return c + V(x, y, z)

    I3 = np.eye(3)
    d = d_ellipsoid(g, L(0, -0.005, 0.012), V(0.073, 0.096, 0.102))
    # 下颌：宽、方
    d = smin(d, d_ellipsoid(g, L(0, 0.032, -0.056), V(0.062, 0.066, 0.056)), 0.03)
    for s in (-1, 1):
        d = smin(d, d_ellipsoid(g, L(s * 0.050, 0.012, -0.072), V(0.020, 0.032, 0.024)), 0.022)
        # 颧骨
        d = smin(d, d_ellipsoid(g, L(s * 0.049, 0.058, -0.004), V(0.023, 0.020, 0.016)), 0.020)
    # 下巴
    d = smin(d, d_ellipsoid(g, L(0, 0.080, -0.097), V(0.025, 0.021, 0.022)), 0.016)
    # 眉弓
    d = smin(d, d_ellipsoid(g, L(0, 0.084, 0.032), V(0.058, 0.014, 0.013)), 0.012)
    # 鼻子：鼻梁、鼻头、鼻翼，两个鼻孔
    d = smin(d, d_cone(g, L(0, 0.090, 0.018), L(0, 0.109, -0.022), 0.0085, 0.0115), 0.008)
    d = smin(d, d_ellipsoid(g, L(0, 0.1085, -0.026), V(0.013, 0.012, 0.011)), 0.006)
    for s in (-1, 1):
        d = smin(d, d_ellipsoid(g, L(s * 0.0145, 0.0975, -0.031), V(0.0085, 0.0085, 0.0075)), 0.005)
        d = smax(d, -d_ellipsoid(g, L(s * 0.0075, 0.1035, -0.0365), V(0.0042, 0.0050, 0.0028)), 0.0015)
        # 眼窝和闭着的眼皮（面罩后面）
        d = smax(d, -d_ellipsoid(g, L(s * 0.031, 0.086, 0.011), V(0.017, 0.010, 0.0095)), 0.006)
        d = smin(d, d_ellipsoid(g, L(s * 0.031, 0.079, 0.011), V(0.0135, 0.009, 0.009)), 0.003)
    # 嘴唇、人中、嘴缝
    d = smin(d, d_ellipsoid(g, L(0, 0.0945, -0.0505), V(0.0245, 0.0085, 0.0062)), 0.004)
    d = smin(d, d_ellipsoid(g, L(0, 0.0915, -0.0615), V(0.0215, 0.0090, 0.0072)), 0.004)
    d = smax(d, -d_ellipsoid(g, L(0, 0.1025, -0.0435), V(0.0042, 0.0028, 0.0055)), 0.002)
    d = smax(d, -d_box(g, L(0, 0.103, -0.0558), V(0.0235, 0.012, 0.0007), I3, 0.0005), 0.0008)
    # 脖子和喉结
    d = smin(d, d_cone(g, L(0, -0.006, -0.06), L(0, -0.028, -0.225), 0.054, 0.059), 0.03)
    d = smin(d, d_ellipsoid(g, L(0, 0.038, -0.140), V(0.011, 0.011, 0.016)), 0.012)
    v, q = surface_nets(d.astype(F32), g.lo, h)
    v = smooth_mesh(v, q, 3, 0.45)
    # 皮肤的颜色（顶点色）：底色、嘴唇、胡茬
    p = v - c
    skin = V(0.540, 0.296, 0.188)
    lips = V(0.393, 0.150, 0.120)
    stub = V(0.200, 0.140, 0.125)
    lipm = np.exp(-((p[:, 0] / 0.022) ** 4) - (((p[:, 2] + 0.056) / 0.011) ** 2)) * (p[:, 1] > 0.08)
    beard = (sstep(-0.035, -0.052, p[:, 2]) * sstep(0.035, 0.065, p[:, 1]) + np.exp(-((p[:, 0] / 0.02) ** 2) - (((p[:, 2] + 0.044) / 0.006) ** 2)) * (p[:, 1] > 0.09))
    beard = np.clip(beard, 0, 1) * (1 - lipm) * sstep(-0.140, -0.112, p[:, 2]) * 0.42
    col = skin[None] * (1 - beard[:, None]) + stub[None] * beard[:, None]
    col = col * (1 - lipm[:, None]) + lips[None] * lipm[:, None]
    # 脖子下半截跟着上身走，脸跟着头
    names = ['head', 'spine']
    t = np.clip((p[:, 2] + 0.205) / 0.07, 0, 1)
    idx = np.tile(np.array([[0, 1]], np.int32), (len(v), 1))
    wt = np.stack([t, 1 - t], 1).astype(np.float32)
    return dict(v=v, q=q, zone=np.zeros(len(v), np.int32), bones=names, idx=idx, wt=wt, mats=['skin'], col=col.astype(np.float32))


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
