# 停机坪上的地勤：用距离场雕出身体和手臂，颜色写进顶点色（整个人一种材质，一张图十几个人也只要几次绘制）。
# 样子照 MOSS-Image 生成的设定图 art/src/ref/crew/sheet_s21.png：藏青工作服和工装裤、橙色反光背心（灰色反光条）、
# 黑色安全鞋、白棉手套、橙色指挥棒。安全帽和耳罩在 crew.py 里用 Blender 建。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/crew_sdf.py art/out/crew
# 输出 body.npz、arm_R.npz、arm_L.npz，再由 tools/blender/crew.py 在 Blender 里减面、加安全帽、导出 public/models/crew.glb。
#
# 坐标：Blender（X 右、Y 前（脸朝的方向）、Z 上，米）。身体的原点在两脚中间的地面；手臂的原点在肩关节，手臂朝下垂。

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from pilot_sdf import (F32, V, Grid, d_box, d_cone, d_ellipsoid, folds, limb_coords, lumps, mn, mx, panel,  # noqa: E402
                       sample_at, smax, smin, smooth_mesh, sstep, surface_nets, unit)

OUT = sys.argv[1] if len(sys.argv) > 1 else 'art/out/crew'
os.makedirs(OUT, exist_ok=True)


def lin(r, g, b):
    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return V(f(r), f(g), f(b))


# 颜色（设定图里取的色，转成线性）
NAVY = lin(0.13, 0.17, 0.31)
NAVY_DK = lin(0.09, 0.12, 0.22)
ORANGE = lin(0.95, 0.45, 0.12)
TAPE = lin(0.72, 0.72, 0.70)
SKIN = lin(0.74, 0.55, 0.43)
HAIR = lin(0.06, 0.055, 0.05)
BOOT = lin(0.07, 0.07, 0.075)
SOLE = lin(0.04, 0.04, 0.04)
GLOVE = lin(0.86, 0.85, 0.80)
WAND = lin(0.98, 0.40, 0.08)
WAND_W = lin(0.92, 0.92, 0.90)
GRIP = lin(0.05, 0.05, 0.05)

HIP = 0.88
SHOULDER_Z = 1.42
SHOULDER_X = 0.205
HEAD_C = V(0.0, 0.025, 1.615)


def torso_base(g):
    zs = np.array([0.80, 0.88, 0.98, 1.08, 1.20, 1.30, 1.38, 1.46])
    ra = np.array([0.150, 0.165, 0.158, 0.156, 0.172, 0.182, 0.176, 0.072])
    rb = np.array([0.108, 0.116, 0.110, 0.108, 0.118, 0.120, 0.104, 0.060])
    cy = np.array([-0.005, -0.008, -0.004, 0.000, 0.004, 0.002, -0.008, 0.002])
    z = g.z.astype(np.float64)
    a = np.interp(z, zs, ra)
    b = np.interp(z, zs, rb)
    c = np.interp(z, zs, cy)
    dy = g.y - c
    k = np.sqrt((g.x / a) ** 2 + (dy / b) ** 2)
    d = (k - 1) * np.minimum(a, b)
    d = smax(d, g.z - 1.47, 0.03)
    d = smax(d, 0.78 - g.z, 0.02)
    for s in (-1, 1):
        # 斜方肌：脖子根斜下到肩
        d = smin(d, d_cone(g, V(s * 0.03, -0.004, 1.455), V(s * 0.175, -0.004, 1.418), 0.044, 0.048), 0.035)
    return d.astype(F32), dy


def build_body():
    h = 0.0055
    g = Grid((-0.31, -0.24, -0.01), (0.31, 0.30, 1.76), h)
    body, dy = torso_base(g)
    front = dy > 0
    ax = np.abs(g.x)
    z = g.z
    # ---- 上衣：藏青工作服（拉链、衣摆盖住裤腰、领子）
    th = np.arctan2(g.x, dy)
    tz = (z - 0.8) / 0.67
    under_vest = sstep(0.96, 1.0, z) * sstep(1.34, 1.30, z)
    jacket = body - folds(tz, th, 6, 0.010, [(0.25, 0.2, 0.0), (0.6, 0.25, 0.8), (0.6, 0.25, -0.8)]) * (1 - under_vest) - lumps(g.shape, 7.0, 0.0025)
    jacket = jacket + 0.0012 * np.exp(-((g.x / 0.004) ** 2)) * front
    # 衣摆：下沿往外翻一点
    jacket = jacket - 0.006 * sstep(0.95, 0.90, z) * sstep(0.84, 0.88, z)
    jacket = smax(jacket, 0.86 - z, 0.01).astype(F32)
    # 立领
    gy = g.y - 0.0
    rr = np.sqrt(g.x ** 2 + (gy * 1.05) ** 2)
    zc = 1.475 - 0.02 * np.cos(np.arctan2(g.x, gy))
    collar = mx(np.abs(rr - 0.070) - 0.006, np.abs(z - zc) - 0.024, (np.cos(np.arctan2(g.x, gy)) - 0.90) * 0.05).astype(F32)
    # ---- 反光背心：衣服外面一层，前后片、肩带；灰色反光条两竖一横
    shell = np.abs(body - 0.019) - 0.0045
    r_main = mx(0.985 - z, z - 1.30, ax - 0.180)
    r_strap = mx(ax - 0.135, 0.06 - ax, 1.25 - z)
    vest = smax(shell, mn(r_main, r_strap), 0.003).astype(F32)
    # ---- 裤子：两条腿，外侧工装口袋
    legs = None
    for s in (-1, 1):
        hip = V(s * 0.095, -0.004, HIP)
        kn = V(s * 0.100, 0.014, 0.475)
        an = V(s * 0.104, -0.012, 0.090)
        th_ = d_cone(g, hip, kn, 0.090, 0.060)
        sh_ = d_cone(g, kn, an, 0.058, 0.046)
        d = smin(th_, sh_, 0.03)
        out = V(float(s), 0.0, 0.0)
        t1, a1, _ = limb_coords(g, hip, kn, out)
        t2, a2, _ = limb_coords(g, kn, an, out)
        d = d - np.maximum(folds(t1, a1, 5, 0.012, [(0.95, 0.25, math.pi / 2), (0.5, 0.4, 0.0)]) * (t1 < 1.1) * (t1 > -0.2),
                           folds(t2, a2, 5, 0.012, [(0.05, 0.25, -math.pi / 2), (0.9, 0.2, 0.0)]) * (t2 > -0.1) * (t2 < 1.1))
        d = d - panel(t1, a1, 0.42, 0.78, -0.62, 0.62, 0.008) - panel(t1, a1, 0.40, 0.48, -0.70, 0.70, 0.004)
        # 膝盖上的护膝口袋
        d = d - panel(t2, a2, -0.06, 0.16, -2.3, -0.9, 0.004) if s > 0 else d - panel(t2, a2, -0.06, 0.16, 0.9, 2.3, 0.004)
        legs = d if legs is None else np.minimum(legs, d)
    # 裤腰：接上身
    legs = smin(legs, smax(body + 0.004, z - 0.90, 0.02), 0.04).astype(F32)
    # ---- 安全鞋
    boots = None
    for s in (-1, 1):
        x = s * 0.106
        heel = V(x, -0.07, 0.045)
        toe = V(x, 0.165, 0.040)
        d = d_cone(g, heel, toe, 0.050, 0.045)
        d = smin(d, d_cone(g, V(x, 0.0, 0.07), V(x, -0.01, 0.15), 0.052, 0.050), 0.03)
        d = smax(d, -g.z + 0.0, 0.004)
        boots = d if boots is None else np.minimum(boots, d)
    boots = boots.astype(F32)
    # ---- 脖子和脸（帽子、耳罩在 crew.py 里）
    c = HEAD_C
    head = d_ellipsoid(g, c + V(0, -0.006, 0.008), V(0.074, 0.094, 0.102))
    head = smin(head, d_ellipsoid(g, c + V(0, 0.030, -0.055), V(0.062, 0.064, 0.055)), 0.03)
    head = smin(head, d_ellipsoid(g, c + V(0, 0.078, -0.094), V(0.024, 0.020, 0.021)), 0.015)
    head = smin(head, d_cone(g, c + V(0, 0.088, 0.016), c + V(0, 0.106, -0.024), 0.0085, 0.012), 0.008)
    head = smin(head, d_ellipsoid(g, c + V(0, 0.084, 0.030), V(0.056, 0.014, 0.013)), 0.012)
    for s in (-1, 1):
        head = smin(head, d_ellipsoid(g, c + V(s * 0.048, 0.056, -0.006), V(0.022, 0.019, 0.016)), 0.02)
        head = smax(head, -d_ellipsoid(g, c + V(s * 0.031, 0.085, 0.010), V(0.016, 0.010, 0.009)), 0.006)
    head = smin(head, d_ellipsoid(g, c + V(0, 0.092, -0.056), V(0.022, 0.010, 0.012)), 0.004)
    head = smin(head, d_cone(g, c + V(0, -0.006, -0.06), c + V(0, -0.012, -0.21), 0.052, 0.056), 0.03).astype(F32)
    parts = [jacket, collar, vest, legs, boots, head]
    F = mn(jacket, collar, legs, boots, head)
    v, q = surface_nets(F, g.lo, h)
    v = smooth_mesh(v, q, 2, 0.5)
    vals = np.stack([sample_at(p, g.lo, h, v) for p in parts], 1)
    zone = np.argmin(np.abs(vals), 1)
    col = np.zeros((len(v), 3))
    col[zone == 0] = NAVY
    col[zone == 1] = NAVY_DK
    col[zone == 3] = NAVY
    col[zone == 4] = BOOT
    # 鞋底
    col[(zone == 4) & (v[:, 2] < 0.022)] = SOLE
    # 背心：橙色，两竖一横的反光条（前后都有）
    vz, vx = v[:, 2], np.abs(v[:, 0])
    tape = ((vx > 0.068) & (vx < 0.115) & (vz > 1.035)) | ((vz > 1.005) & (vz < 1.055))
    col[zone == 2] = NAVY
    # 头：皮肤；后脑勺和鬓角露出来的头发；眉毛、眼睛、嘴唇（远处看就是几个暗点，脸才不像假人）
    hz = zone == 5
    p = v - c
    hair = (p[:, 1] < -0.02) & (p[:, 2] > -0.11) | ((np.abs(p[:, 0]) > 0.06) & (p[:, 2] > -0.03) & (p[:, 1] < 0.05))
    fc = np.where(hair[:, None], HAIR, SKIN)
    ax_ = np.abs(p[:, 0])
    brow = np.exp(-(((ax_ - 0.032) / 0.016) ** 2) - (((p[:, 2] - 0.027) / 0.005) ** 2)) * (p[:, 1] > 0.07)
    eye = np.exp(-(((ax_ - 0.031) / 0.010) ** 2) - (((p[:, 2] - 0.010) / 0.005) ** 2)) * (p[:, 1] > 0.07)
    lip = np.exp(-((p[:, 0] / 0.018) ** 4) - (((p[:, 2] + 0.056) / 0.006) ** 2)) * (p[:, 1] > 0.08)
    fc = fc * (1 - np.clip(brow + eye, 0, 1)[:, None] * 0.82) + HAIR * np.clip(brow + eye, 0, 1)[:, None] * 0.82
    fc = fc * (1 - lip[:, None] * 0.5) + lin(0.55, 0.32, 0.28) * lip[:, None] * 0.5
    col[hz] = fc[hz]
    # 背心：橙色，两竖一横的反光条（前后都有）
    vv, vq = surface_nets(vest, g.lo, h)
    vv = smooth_mesh(vv, vq, 2, 0.5)
    vz, vx = vv[:, 2], np.abs(vv[:, 0])
    tape = ((vx > 0.068) & (vx < 0.115) & (vz > 1.035)) | ((vz > 1.005) & (vz < 1.055))
    vcol = np.where(tape[:, None], TAPE, ORANGE)
    return dict(v=v, q=q, col=col.astype(np.float32)), dict(v=vv, q=vq, col=vcol.astype(np.float32))


def build_arm(side):
    """手臂：肩关节在原点，朝下垂，肘稍往前弯；手里握着指挥棒（顺着手臂往前斜一点）"""
    s = 1.0 if side == 'R' else -1.0
    h = 0.0045
    g = Grid((-0.09, -0.10, -1.08), (0.09, 0.25, 0.08), h)
    sh = V(0, 0, 0)
    el = V(0, 0.022, -0.300)
    wr = V(0, 0.050, -0.555)
    d = d_ellipsoid(g, V(0, -0.004, -0.018), V(0.062, 0.066, 0.066))
    d = smin(d, d_cone(g, sh + V(0, 0, -0.02), el, 0.056, 0.046), 0.03)
    d = smin(d, d_cone(g, el, wr, 0.046, 0.038), 0.02)
    out = V(s, 0, 0)
    t1, a1, _ = limb_coords(g, sh, el, out)
    t2, a2, _ = limb_coords(g, el, wr, V(s, 0, 0))
    d = d - np.maximum(folds(t1, a1, 4, 0.010, [(0.9, 0.25, math.pi)]) * (t1 < 1.1) * (t1 > -0.1),
                       folds(t2, a2, 5, 0.010, [(0.1, 0.25, math.pi), (0.9, 0.2, 0.0)]) * (t2 > -0.1) * (t2 < 1.1))
    sleeve = d.astype(F32)
    # 手套：握拳
    fist_c = wr + V(0, 0.018, -0.060)
    glove = d_ellipsoid(g, wr + V(0, 0.006, -0.02), V(0.034, 0.040, 0.036))
    glove = smin(glove, d_ellipsoid(g, fist_c, V(0.036, 0.046, 0.046)), 0.02)
    glove = smin(glove, d_ellipsoid(g, fist_c + V(-s * 0.026, 0.030, 0.008), V(0.014, 0.022, 0.014)), 0.01).astype(F32)
    # 指挥棒：从拳头里穿出来，往前斜
    w0 = fist_c + V(0, 0.000, 0.040)
    w1 = fist_c + V(0, 0.115, -0.385)
    wand = d_cone(g, w0, w1, 0.0185, 0.0175).astype(F32)
    parts = [sleeve, glove, wand]
    F = mn(*parts)
    v, q = surface_nets(F, g.lo, h)
    v = smooth_mesh(v, q, 2, 0.5)
    vals = np.stack([sample_at(p, g.lo, h, v) for p in parts], 1)
    zone = np.argmin(np.abs(vals), 1)
    col = np.zeros((len(v), 3))
    col[zone == 0] = NAVY
    col[zone == 1] = GLOVE
    # 指挥棒：手握的一段黑色，靠头有一道白
    ax_ = unit(w1 - w0)
    t = (v - w0) @ ax_ / np.linalg.norm(w1 - w0)
    wc = np.where((t < 0.22)[:, None], GRIP, np.where(((t > 0.70) & (t < 0.80))[:, None], WAND_W, WAND))
    col[zone == 2] = wc[zone == 2]
    return dict(v=v, q=q, col=col.astype(np.float32))


def main():
    body, vest = build_body()
    for name, p in (('body', body), ('vest', vest), ('arm_R', build_arm('R')), ('arm_L', build_arm('L'))):
        np.savez_compressed(os.path.join(OUT, name + '.npz'), v=p['v'].astype(np.float32), q=p['q'].astype(np.int32), col=p['col'])
        print(name, 'verts', len(p['v']), 'quads', len(p['q']))
    print('ok')


if __name__ == '__main__':
    main()
