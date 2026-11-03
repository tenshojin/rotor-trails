# 日本民居（参照鞆之浦传统町家实拍照片，维基共享资源）：近景 / 中景 / 远景三级模型。
#   近景 LOD0：几何本瓦屋面（筒瓦垄、平瓦沟、每行台阶、瓦当与唐草瓦）、叠瓦屋脊 + 鬼瓦 + 鸟衾、斜脊 + 隅鬼、
#     露出的椽子与屋面板、檐沟与落水管、花岗岩条石台基（逐块）、竖向杉板下墙 + 压条、白灰泥上墙 + 柱梁（真壁）、
#     格子推拉门 + 踏石、出格子窗、二层格子窗 / 虫笼窗、铝合金推拉窗 + 雨户箱、后门、浴室窗防盗格、窗帘、
#     室外空调机与管线、燃气瓶、热水器、电表、门牌与信箱、盆栽、电视天线、卫星锅、二层晾衣阳台。
#   中景 LOD1：贴图平板屋面（瓦格子贴图 + 由瓦面高度场算出的法线）、简化屋脊、墙面分区贴图、门窗简化。
#   远景 LOD2：墙体与屋面体块。
# 坐标：X 右、Y 前（门所在的一面 = 游戏局部 -z）、Z 上。尺寸与 src/world/props/japan.ts 的碰撞体一致：
#   一层：墙 0~3 m（台基 0.5 m），四坡屋顶 h=2.2、出檐 0.75、屋脊比 0.45；
#   二层：一层同上（屋顶换成绕二层一圈的下屋），二层墙 w×0.75、d×0.8、高 3 m，四坡屋顶 h=2.0、出檐 0.7、屋脊比 0.4。

import math
import random

from mathutils import Vector

import bkit as K
import bldkit as BK
import jparts as J

ZUP = Vector((0, 0, 1))
ZB, ZT = 0.5, 3.0  # 台基顶、一层墙顶
_M = {}


def mats():
    if _M:
        return _M
    M, F = BK.mat, BK.flat
    _M.update(
        tile=K.material('j_kawara', tex=f'{BK.TEX}/kawara_cells_diffuse_1024.jpg', rough=0.55, metal=0.1),
        flat=M('kawara_flat'),
        ibushi=F('ibushi', 0x5b6067, rough=0.45, metal=0.25),
        plaster=M('plaster'),
        board=M('sugi'),
        sugi=M('sugi'),
        yakisugi=M('yakisugi'),
        timber=M('yakisugi'),
        granite=M('granite'),
        shoji=F('shoji', 0xe9e3d1, rough=0.9),
        kumiko=M('sugi'),
        dark=F('interior', 0x15120f, rough=1.0),
        glass=F('glass_dark', 0x1c252d, rough=0.08, metal=0.5),
        frosted=F('glass_frost', 0xa7afb2, rough=0.35, metal=0.1),
        alu=F('alu', 0xb9bdc2, rough=0.35, metal=0.8),
        bronze=F('alu_bronze', 0x4d443b, rough=0.4, metal=0.7),
        amado=F('paint_white', 0xe6e1d4, rough=0.55),
        gutter=F('gutter', 0x4e4f51, rough=0.45, metal=0.35),
        white=F('paint_white', 0xe6e1d4, rough=0.55),
        ivory=F('paint_white', 0xe6e1d4, rough=0.55),
        propane=F('propane', 0xaeb2b4, rough=0.4, metal=0.4),
        steel=F('propane', 0xaeb2b4, rough=0.4, metal=0.4),
        leaf=F('leaf', 0x3d5a2a, rough=0.9),
        pot=M('sugi'),
        curtain=[F('curtain', 0xd6ccb4, rough=0.95)],
        concrete=M('granite'),
    )
    return _M


# ------------------------------------------------------------------ 墙面局部坐标


def fb(name, F, half, u0, u1, z0, z1, n0, n1, m):
    """墙面局部坐标的长方体：u 沿墙（BK.AX 的 u 轴），z 高度，n 朝外（0 = 墙面）；half = 墙面到中心的距离。"""
    u, nv = BK.AX[F]
    c = nv * (half + (n0 + n1) / 2) + u * ((u0 + u1) / 2) + ZUP * ((z0 + z1) / 2)
    size = (abs(u.x) * (u1 - u0) + abs(nv.x) * (n1 - n0), abs(u.y) * (u1 - u0) + abs(nv.y) * (n1 - n0), z1 - z0)
    return BK.bx(name, size, tuple(c), m, uv=m.name.startswith('b_'))


def wpt(F, half, u, z, n):
    """墙面局部坐标 → 世界坐标点。"""
    uu, nv = BK.AX[F]
    return nv * (half + n) + uu * u + ZUP * z


def wall_face(name, F, half, length, z0, z1, zsplit, openings, m_lo, m_hi, thick=0.10):
    """一面墙去掉开口后分成若干长方体（外表面在墙线；下段杉板凸出 12 mm）。openings: [(u0, u1, z0, z1)]"""
    us = sorted({-length / 2, length / 2, *[o[0] for o in openings], *[o[1] for o in openings]})
    us = [x for x in us if -length / 2 - 1e-6 <= x <= length / 2 + 1e-6]
    parts = []
    for i in range(len(us) - 1):
        a, b = us[i], us[i + 1]
        if b - a < 1e-3:
            continue
        mid = (a + b) / 2
        blocked = sorted((o[2], o[3]) for o in openings if o[0] < mid < o[1])
        free, cur = [], z0
        for za, zb in blocked:
            if za > cur:
                free.append((cur, min(za, z1)))
            cur = max(cur, zb)
        if cur < z1:
            free.append((cur, z1))
        for za, zb in free:
            for lo, hi, m, nn in ((za, min(zb, zsplit), m_lo, 0.012), (max(za, zsplit), zb, m_hi, 0.0)):
                if hi - lo > 1e-3:
                    parts.append(fb(f'{name}_{i}_{lo:.2f}', F, half, a, b, lo, hi, -thick, nn, m))
    return parts


def frame_posts(name, F, half, length, z0, z1, zsplit, openings, mt, step=1.82):
    """真壁：灰泥段的柱（转角 + 每 1.82 m + 开口两侧）、上下横梁；杉板段的压条（每 0.4 m）与顶部见切り。"""
    T = mt['timber']
    parts = []
    xs = set()
    k = 1
    while -length / 2 + k * step < length / 2 - 0.5:
        xs.add(-length / 2 + k * step)
        k += 1
    for o in openings:
        if o[3] > zsplit + 0.2:
            xs.add(o[0] - 0.055)
            xs.add(o[1] + 0.055)
    xs = sorted(xs)
    for i, x in enumerate(xs):
        # 柱不穿过开口
        segs = [(zsplit, z1)]
        for o in openings:
            if o[0] - 0.05 < x < o[1] + 0.05:
                segs = [(a, min(b, o[2])) for a, b in segs if min(b, o[2]) - a > 0.05] + [(max(a, o[3]), b) for a, b in segs if b - max(a, o[3]) > 0.05]
        for a, b in segs:
            parts.append(fb(f'{name}_p{i}_{a:.1f}', F, half, x - 0.055, x + 0.055, a, b, 0.0, 0.018, T))
    parts.append(fb(f'{name}_beam', F, half, -length / 2, length / 2, z1 - 0.2, z1, 0.0, 0.03, T))  # 桁
    parts.append(fb(f'{name}_trim', F, half, -length / 2, length / 2, zsplit - 0.02, zsplit + 0.045, 0.0, 0.03, T))  # 见切り
    if zsplit - z0 > 0.2:
        x = -length / 2 + 0.2
        while x < length / 2 - 0.1:
            if not any(o[0] - 0.03 < x < o[1] + 0.03 and o[2] < zsplit for o in openings):
                parts.append(fb(f'{name}_bt{int(x * 100)}', F, half, x - 0.014, x + 0.014, z0 + 0.02, zsplit - 0.02, 0.0, 0.032, T))
            x += 0.4
    return parts


def stone_base(name, F, half, length, mt, rnd, skip=(), z1=ZB, corner=0.1):
    """花岗岩条石台基：两层，块长 0.55~1.15 m，块间 12 mm 缝，倒角。skip：门口等不放石块的 u 区间。"""
    parts = []
    G = mt['granite']
    u_lo, u_hi = -length / 2 - corner, length / 2 + corner
    hz = z1 / 2
    for course in range(2):
        za, zb = course * hz, (course + 1) * hz
        x = u_lo - (rnd.uniform(0.2, 0.5) if course else 0.0)
        while x < u_hi - 0.02:
            ln = rnd.uniform(0.55, 1.15)
            a, b = max(x, u_lo), min(x + ln, u_hi)
            x += ln
            if b - a < 0.15:
                continue
            for s0, s1 in skip:
                if a < s1 and b > s0:
                    # 与门口重叠的部分切掉
                    if a < s0:
                        b = s0
                    elif b > s1:
                        a = s1
                    else:
                        a = b
            if b - a < 0.12:
                continue
            u, nv = BK.AX[F]
            c = nv * (half + (-0.15 + 0.10) / 2) + u * ((a + b) / 2) + ZUP * ((za + zb) / 2)
            size = (abs(u.x) * (b - a - 0.012) + abs(nv.x) * 0.25, abs(u.y) * (b - a - 0.012) + abs(nv.y) * 0.25, zb - za - 0.012)
            ob = K.box(f'{name}_{course}_{int(a * 100)}', size, tuple(c), G)
            K.add_bevel(ob, 0.014, 1)
            K.apply_mods(ob)
            K.bake_transform(ob)
            BK.uv_world(ob)
            parts.append(ob)
    return parts


# ------------------------------------------------------------------ 门窗


def shoji(name, F, half, u0, u1, z0, z1, n, mt):
    """障子：纸面 + 木格（组子）。"""
    p = [fb(name + '_pp', F, half, u0, u1, z0, z1, n - 0.004, n, mt['shoji'])]
    nx = max(2, round((u1 - u0) / 0.3))
    nz = max(2, round((z1 - z0) / 0.27))
    for i in range(1, nx):
        x = u0 + (u1 - u0) * i / nx
        p.append(fb(f'{name}_kv{i}', F, half, x - 0.008, x + 0.008, z0, z1, n, n + 0.012, mt['kumiko']))
    for i in range(1, nz):
        z = z0 + (z1 - z0) * i / nz
        p.append(fb(f'{name}_kh{i}', F, half, u0, u1, z - 0.008, z + 0.008, n, n + 0.012, mt['kumiko']))
    return p


def koshido(name, F, half, u0, u1, z0, z1, mt):
    """玄关格子推拉门（两扇，前后两条轨道）+ 门框 + 门前踏石。"""
    T = mt['timber']
    p = [fb(name + '_head', F, half, u0 - 0.05, u1 + 0.05, z1, z1 + 0.08, -0.10, 0.015, T),
         fb(name + '_sill', F, half, u0, u1, z0 - 0.05, z0, -0.10, 0.02, T)]
    for a in (u0 - 0.05, u1):
        p.append(fb(name + f'_jb{a:.1f}', F, half, a, a + 0.05, z0 - 0.05, z1, -0.10, 0.015, T))
    lw = (u1 - u0) / 2 + 0.02
    for li, (a, b, n0, n1) in enumerate(((u0, u0 + lw, -0.045, -0.02), (u1 - lw, u1, -0.08, -0.055))):
        nm = f'{name}_l{li}'
        p += [fb(nm + '_s0', F, half, a, a + 0.042, z0, z1, n0, n1, T), fb(nm + '_s1', F, half, b - 0.042, b, z0, z1, n0, n1, T),
              fb(nm + '_rt', F, half, a, b, z1 - 0.05, z1, n0, n1, T), fb(nm + '_rb', F, half, a, b, z0, z0 + 0.11, n0, n1, T)]
        for zz in (z0 + (z1 - z0) * 0.34, z0 + (z1 - z0) * 0.68):
            p.append(fb(nm + f'_nk{zz:.2f}', F, half, a, b, zz - 0.015, zz + 0.015, n0 - 0.006, n0 + 0.004, T))
        x = a + 0.042 + 0.02
        i = 0
        while x < b - 0.042 - 0.012:
            p.append(fb(f'{nm}_k{i}', F, half, x - 0.008, x + 0.008, z0 + 0.11, z1 - 0.05, n0 + 0.004, n1, T))
            x += 0.04
            i += 1
        p.append(fb(nm + '_paper', F, half, a + 0.04, b - 0.04, z0 + 0.11, z1 - 0.05, n0 - 0.004, n0, mt['shoji']))
    # 踏石（沓脱石）
    p.append(fb(name + '_step', F, half, u0 + 0.12, u1 - 0.12, 0.0, z0 - 0.05, 0.02, 0.62, mt['granite']))
    return p


def degoshi(name, F, half, u0, u1, z0, z1, mt):
    """出格子：凸出墙面 24 cm 的木格子窗（竖格 3 cm，间距 6.2 cm），上有小檐，里面是障子。"""
    T = mt['timber']
    D = 0.24
    p = [fb(name + '_bot', F, half, u0 - 0.06, u1 + 0.06, z0 - 0.06, z0, -0.02, D + 0.03, T),
         fb(name + '_top', F, half, u0 - 0.06, u1 + 0.06, z1, z1 + 0.05, -0.02, D + 0.03, T)]
    for a in (u0 - 0.06, u1 + 0.02):
        p.append(fb(name + f'_cp{a:.1f}', F, half, a, a + 0.04, z0, z1, D - 0.04, D, T))
    k = max(4, round((u1 - u0) / 0.062))
    for i in range(k + 1):
        x = u0 + (u1 - u0) * i / k
        p.append(fb(f'{name}_k{i}', F, half, x - 0.015, x + 0.015, z0, z1, D - 0.045, D, T))
    for a in (u0 - 0.055, u1 + 0.025):
        for nn in (0.03, 0.09, 0.15):
            p.append(fb(f'{name}_sk{a:.1f}_{nn}', F, half, a, a + 0.03, z0, z1, nn, nn + 0.03, T))
    for zz in (z0 + (z1 - z0) * 0.22, z0 + (z1 - z0) * 0.78):
        p.append(fb(name + f'_nk{zz:.2f}', F, half, u0, u1, zz - 0.02, zz + 0.02, D - 0.075, D - 0.045, T))
    # 小檐（铜板，向外倾斜）
    u, nv = BK.AX[F]
    a = wpt(F, half, (u0 + u1) / 2, z1 + 0.2, -0.01)
    b = wpt(F, half, (u0 + u1) / 2, z1 + 0.08, D + 0.12)
    dn = (b - a)
    p.append(J.obox(name + '_hood', (a + b) / 2, u, dn, dn.cross(u), (u1 - u0) + 0.24, dn.length, 0.025, mt['gutter']))
    p += shoji(name + '_sj', F, half, u0, u1, z0, z1, -0.06, mt)
    return p


def koshimado(name, F, half, u0, u1, z0, z1, mt):
    """二层格子窗（与墙面齐平的木格子，后面障子）。"""
    T = mt['timber']
    p = [fb(name + '_h', F, half, u0 - 0.05, u1 + 0.05, z1, z1 + 0.06, -0.06, 0.035, T),
         fb(name + '_s', F, half, u0 - 0.05, u1 + 0.05, z0 - 0.06, z0, -0.06, 0.045, T)]
    for a in (u0 - 0.05, u1):
        p.append(fb(name + f'_j{a:.1f}', F, half, a, a + 0.05, z0, z1, -0.06, 0.035, T))
    k = max(4, round((u1 - u0) / 0.085))
    for i in range(1, k):
        x = u0 + (u1 - u0) * i / k
        p.append(fb(f'{name}_k{i}', F, half, x - 0.017, x + 0.017, z0, z1, -0.005, 0.035, T))
    for zz in (z0 + (z1 - z0) / 3, z0 + (z1 - z0) * 2 / 3):
        p.append(fb(name + f'_nk{zz:.2f}', F, half, u0, u1, zz - 0.015, zz + 0.015, -0.025, -0.005, T))
    p += shoji(name + '_sj', F, half, u0, u1, z0, z1, -0.07, mt)
    return p


def mushiko(name, F, half, u0, u1, z0, z1, mt):
    """虫笼窗：白灰泥抹成的粗竖格（町家二层），格后是暗的室内。"""
    PL = mt['plaster']
    p = []
    k = max(3, round((u1 - u0) / 0.14))
    for i in range(1, k):
        x = u0 + (u1 - u0) * i / k
        p.append(fb(f'{name}_b{i}', F, half, x - 0.038, x + 0.038, z0, z1, -0.08, -0.005, PL))
    # 窗口一圈略凸的灰泥边
    for a, b, c, d in ((u0 - 0.06, u1 + 0.06, z1, z1 + 0.06), (u0 - 0.06, u1 + 0.06, z0 - 0.06, z0), (u0 - 0.06, u0, z0, z1), (u1, u1 + 0.06, z0, z1)):
        p.append(fb(name + f'_r{a:.1f}{c:.1f}', F, half, a, b, c, d, -0.02, 0.02, PL))
    return p


def alu(name, F, half, u0, u1, z0, z1, mt, rnd, frame='alu', glass='glass', amado=None, bars=False, curtain=True):
    """铝合金推拉窗（两扇）+ 窗台水切 + 窗帘；可选雨户箱（amado='L'/'R'，带上下轨道）与防盗格（bars）。"""
    A = mt[frame]
    p = []
    for a, b, c, d in ((u0, u1, z1 - 0.04, z1), (u0, u1, z0, z0 + 0.04), (u0, u0 + 0.04, z0, z1), (u1 - 0.04, u1, z0, z1)):
        p.append(fb(name + f'_f{a:.2f}{c:.2f}', F, half, a, b, c, d, -0.08, -0.01, A))
    p.append(fb(name + '_ws', F, half, u0 - 0.02, u1 + 0.02, z0 - 0.035, z0, -0.02, 0.045, A))
    mid = (u0 + u1) / 2
    for si, (a, b, n0) in enumerate(((u0 + 0.04, mid + 0.02, -0.035), (mid - 0.02, u1 - 0.04, -0.06))):
        p.append(fb(name + f'_g{si}', F, half, a, b, z0 + 0.04, z1 - 0.04, n0 - 0.004, n0, mt[glass]))
        for x0, x1 in ((a, a + 0.03), (b - 0.03, b)):
            p.append(fb(name + f'_st{si}{x0:.2f}', F, half, x0, x1, z0 + 0.04, z1 - 0.04, n0 - 0.012, n0 + 0.008, A))
        for zz0, zz1 in ((z0 + 0.04, z0 + 0.075), (z1 - 0.075, z1 - 0.04)):
            p.append(fb(name + f'_rl{si}{zz0:.2f}', F, half, a, b, zz0, zz1, n0 - 0.012, n0 + 0.008, A))
    if curtain and glass == 'glass':
        cm = rnd.choice(mt['curtain'])
        cw = (u1 - u0) * rnd.uniform(0.25, 0.55)
        if rnd.random() < 0.5:
            p.append(fb(name + '_ct', F, half, u0 + 0.05, u0 + 0.05 + cw, z0 + 0.06, z1 - 0.03, -0.12, -0.1, cm))
        else:
            p.append(fb(name + '_ct', F, half, u1 - 0.05 - cw, u1 - 0.05, z0 + 0.06, z1 - 0.03, -0.12, -0.1, cm))
    if amado:
        bw = (u1 - u0) / 2 + 0.08
        a, b = (u1 + 0.03, u1 + 0.03 + bw) if amado == 'R' else (u0 - 0.03 - bw, u0 - 0.03)
        p.append(fb(name + '_tb', F, half, a, b, z0 - 0.09, z1 + 0.1, 0.0, 0.15, mt['amado']))
        k = int(bw / 0.12)
        for i in range(1, k):
            x = a + bw * i / k
            p.append(fb(name + f'_rb{i}', F, half, x - 0.008, x + 0.008, z0 - 0.07, z1 + 0.08, 0.15, 0.157, mt['amado']))
        lo, hi = min(a, u0) - 0.02, max(b, u1) + 0.02
        p.append(fb(name + '_ra', F, half, lo, hi, z1 + 0.02, z1 + 0.085, 0.0, 0.11, A))
        p.append(fb(name + '_rb', F, half, lo, hi, z0 - 0.095, z0 - 0.04, 0.0, 0.11, A))
    if bars:
        k = max(3, round((u1 - u0) / 0.1))
        for i in range(1, k):
            x = u0 + (u1 - u0) * i / k
            p.append(fb(name + f'_bar{i}', F, half, x - 0.01, x + 0.01, z0 - 0.02, z1 + 0.02, 0.05, 0.07, A))
        for zz in (z0 - 0.04, z1 + 0.01):
            p.append(fb(name + f'_bh{zz:.2f}', F, half, u0 - 0.04, u1 + 0.04, zz, zz + 0.03, 0.03, 0.075, A))
    return p


def alu_door(name, F, half, u0, u1, z0, z1, mt, frame='bronze'):
    """后门（勝手口）：铝框门 + 上半磨砂玻璃 + 把手 + 小雨棚 + 混凝土踏步。"""
    A = mt[frame]
    p = []
    for a, b, c, d in ((u0, u1, z1 - 0.045, z1), (u0, u0 + 0.045, z0, z1), (u1 - 0.045, u1, z0, z1)):
        p.append(fb(name + f'_f{a:.2f}{c:.2f}', F, half, a, b, c, d, -0.08, 0.0, A))
    p.append(fb(name + '_leaf', F, half, u0 + 0.045, u1 - 0.045, z0, z1 - 0.045, -0.05, -0.03, A))
    p.append(fb(name + '_gl', F, half, u0 + 0.12, u1 - 0.12, z0 + (z1 - z0) * 0.5, z1 - 0.15, -0.03, -0.026, mt['frosted']))
    p.append(fb(name + '_hd', F, half, u1 - 0.17, u1 - 0.1, z0 + 0.92, z0 + 0.96, -0.03, 0.03, mt['steel']))
    u, nv = BK.AX[F]
    a = wpt(F, half, (u0 + u1) / 2, z1 + 0.32, 0.0)
    b = wpt(F, half, (u0 + u1) / 2, z1 + 0.2, 0.6)
    dn = b - a
    p.append(J.obox(name + '_aw', (a + b) / 2, u, dn, dn.cross(u), (u1 - u0) + 0.4, dn.length, 0.03, mt['alu']))
    p.append(fb(name + '_stp', F, half, u0 - 0.1, u1 + 0.1, 0.0, z0 - 0.18, 0.0, 0.45, mt['concrete']))
    return p


# ------------------------------------------------------------------ 设备与生活细节


def ac_unit(name, F, half, u, mt, z_in=2.3):
    """室外空调机（落地，两块垫块）+ 冷媒管装饰罩沿墙上到 z_in 处入墙。"""
    W = mt['white']
    p = [fb(name + '_bk0', F, half, u - 0.35, u - 0.25, 0.0, 0.1, 0.12, 0.42, mt['concrete']),
         fb(name + '_bk1', F, half, u + 0.25, u + 0.35, 0.0, 0.1, 0.12, 0.42, mt['concrete']),
         fb(name + '_body', F, half, u - 0.4, u + 0.4, 0.1, 0.66, 0.12, 0.41, W)]
    c = wpt(F, half, u - 0.1, 0.38, 0.41)
    nv = BK.AX[F][1]
    p.append(K.tube_path(name + '_fan', [c - nv * 0.004, c + nv * 0.006], 0.2, mt['dark'], seg=20))
    for rr in (0.2, 0.13):
        p.append(_ring(name + f'_g{rr}', c + nv * 0.01, nv, rr, 0.007, W))
    p.append(K.tube_path(name + '_hub', [c + nv * 0.006, c + nv * 0.016], 0.06, W, seg=16))
    p.append(fb(name + '_gv', F, half, u - 0.105, u - 0.095, 0.18, 0.58, 0.41, 0.425, W))
    p.append(fb(name + '_gh', F, half, u - 0.3, u + 0.1, 0.375, 0.385, 0.41, 0.425, W))
    p.append(fb(name + '_side', F, half, u + 0.17, u + 0.36, 0.16, 0.6, 0.41, 0.418, mt['steel']))
    # 管线罩：从机器侧面到墙，再沿墙上去
    p.append(fb(name + '_d0', F, half, u + 0.4, u + 0.47, 0.35, 0.42, 0.0, 0.3, mt['ivory']))
    p.append(fb(name + '_d1', F, half, u + 0.4, u + 0.47, 0.35, z_in, 0.0, 0.06, mt['ivory']))
    return p


def _ring(name, c, axis, r, t, m, seg=24):
    pts = []
    a1 = Vector((axis.y, -axis.x, 0)).normalized() if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    a2 = axis.cross(a1).normalized()
    for k in range(seg + 1):
        a = 2 * math.pi * k / seg
        pts.append(c + (a1 * math.cos(a) + a2 * math.sin(a)) * r)
    return K.tube_path(name, pts, t, m, seg=5, cap=False)


def propane(name, F, half, u, mt):
    """燃气瓶两只（50 kg 瓶，高 1.25 m）+ 护罩 + 固定链 + 混凝土垫 + 小表。"""
    G = mt['propane']
    p = [fb(name + '_pad', F, half, u - 0.45, u + 0.45, 0.0, 0.05, 0.1, 0.55, mt['concrete'])]
    for i, du in enumerate((-0.2, 0.2)):
        c = wpt(F, half, u + du, 0.05, 0.32)
        p.append(K.cylinder(name + f'_b{i}', 0.185, 1.05, tuple(c + ZUP * 0.525), G, 18))
        p.append(K.sphere(name + f'_t{i}', 0.185, tuple(c + ZUP * 1.05), G, 18, 8, scale=(1, 1, 0.55)))
        p.append(K.cylinder(name + f'_cap{i}', 0.1, 0.16, tuple(c + ZUP * 1.2), G, 14))
        p.append(K.cylinder(name + f'_ft{i}', 0.17, 0.05, tuple(c + ZUP * 0.025), mt['steel'], 18))
    nv = BK.AX[F][1]
    uu = BK.AX[F][0]
    for z in (0.75,):
        a = wpt(F, half, u - 0.42, z, 0.0)
        p.append(K.tube_path(name + '_chain', [a, a + nv * 0.5, a + nv * 0.5 + uu * 0.84, a + uu * 0.84], 0.008, mt['steel'], seg=5))
    p.append(fb(name + '_gm', F, half, u + 0.5, u + 0.72, 0.9, 1.15, 0.0, 0.14, mt['ivory']))
    return p


def water_heater(name, F, half, u, mt):
    p = [fb(name + '_b', F, half, u - 0.24, u + 0.24, 1.0, 1.65, 0.0, 0.24, mt['ivory']),
         fb(name + '_ex', F, half, u - 0.12, u + 0.12, 1.5, 1.6, 0.24, 0.255, mt['dark'])]
    for i, du in enumerate((-0.12, 0.0, 0.12)):
        a = wpt(F, half, u + du, 1.0, 0.12)
        p.append(K.tube_path(name + f'_p{i}', [a, a - ZUP * 0.5], 0.016, mt['ivory'] if i else mt['steel'], seg=6))
    p.append(fb(name + '_cv', F, half, u - 0.2, u + 0.2, 0.5, 0.55, 0.0, 0.2, mt['ivory']))
    return p


def meter(name, F, half, u, z, mt, z_top):
    p = [fb(name + '_b', F, half, u - 0.09, u + 0.09, z, z + 0.26, 0.0, 0.11, mt['steel']),
         fb(name + '_g', F, half, u - 0.06, u + 0.06, z + 0.1, z + 0.22, 0.11, 0.115, mt['glass'])]
    a = wpt(F, half, u, z + 0.26, 0.04)
    p.append(K.tube_path(name + '_cd', [a, wpt(F, half, u, z_top, 0.04)], 0.014, mt['ivory'], seg=6))
    return p


def plants(name, F, half, u, mt, rnd, n=3):
    """门口的盆栽：木花箱 / 圆盆 + 几团大小不一的叶簇（不再是一个绿球）。"""
    p = []
    for i in range(n):
        uu = u + (i - (n - 1) / 2) * 0.42 + rnd.uniform(-0.05, 0.05)
        r = rnd.uniform(0.13, 0.19)
        h = rnd.uniform(0.2, 0.3)
        c = wpt(F, half, uu, 0.0, 0.35 + rnd.uniform(-0.05, 0.08))
        p.append(K.cylinder(name + f'_pot{i}', r, h, tuple(c + ZUP * h / 2), mt['pot'], 12, r2=r * 0.8))
        top = c + ZUP * h
        k = rnd.randint(4, 7)
        tall = rnd.uniform(0.25, 0.7)
        for j in range(k):
            a = rnd.uniform(0, 2 * math.pi)
            rr = rnd.uniform(0.0, r * 0.9)
            fr = rnd.uniform(0.07, 0.13) * (1.4 if j == 0 else 1.0)
            q = top + Vector((math.cos(a) * rr, math.sin(a) * rr, rnd.uniform(0.04, tall)))
            p.append(K.sphere(name + f'_lf{i}_{j}', fr, tuple(q), mt['leaf'], 8, 5, scale=(1, 1, rnd.uniform(0.7, 1.1))))
    return p


def hip_z(x, y, w, d, h, ridge, z0, lift=0.13):
    """四坡屋顶瓦面在 (x, y) 处的大致高度（屋面板平面 + 瓦厚）。"""
    rw = (w / 2) * ridge
    ky = abs(y) / (d / 2)
    kx = (abs(x) - rw) / (w / 2 - rw) if abs(x) > rw else 0.0
    return z0 + h * (1 - max(ky, kx)) + lift


def tv_antenna(name, base, mt, rnd, zfun):
    """屋顶八木电视天线：桅杆 + 横杆 + 振子 + 四根拉线（拉到屋面上）。"""
    S = mt['steel']
    top = base + ZUP * 2.3
    p = [K.tube_path(name + '_m', [base, top], 0.018, S, seg=6)]
    yaw = rnd.uniform(0, math.pi)
    d = Vector((math.cos(yaw), math.sin(yaw), 0))
    s = Vector((-d.y, d.x, 0))
    for zz, ln, ne in ((2.15, 1.5, 9), (1.75, 0.9, 6)):
        c = base + ZUP * zz
        p.append(K.tube_path(name + f'_bm{zz}', [c - d * ln * 0.45, c + d * ln * 0.55], 0.012, S, seg=5))
        for k in range(ne):
            q = c - d * ln * 0.4 + d * (ln * 0.9 * k / (ne - 1))
            half_l = 0.28 - 0.015 * k if zz > 2 else 0.2 - 0.01 * k
            p.append(K.tube_path(name + f'_e{zz}{k}', [q - s * half_l, q + s * half_l], 0.005, S, seg=4, cap=False))
    for k in range(4):
        a = yaw + math.pi / 4 + k * math.pi / 2
        gx, gy = base.x + math.cos(a) * 1.5, base.y + math.sin(a) * 1.5
        g = Vector((gx, gy, zfun(gx, gy)))
        p.append(K.tube_path(name + f'_gw{k}', [base + ZUP * 1.5, g], 0.004, S, seg=3, cap=False))
    return p


def bs_dish(name, F, half, u, z, mt):
    """卫星天线（BS 锅）：抛物面 + 支架 + 高频头。"""
    nv = BK.AX[F][1]
    uu = BK.AX[F][0]
    c = wpt(F, half, u, z, 0.45)
    p = [K.tube_path(name + '_arm', [wpt(F, half, u, z - 0.15, 0.0), c - nv * 0.05 - ZUP * 0.1], 0.02, mt['white'], seg=6)]
    dish = K.sphere(name + '_dish', 0.24, (0, 0, 0), mt['white'], 16, 8, scale=(1, 1, 0.22))
    aim = (nv + uu * 0.4 + ZUP * 0.75).normalized()
    dish.rotation_euler = ZUP.rotation_difference(aim).to_euler()
    dish.location = c
    K.bake_transform(dish)
    p.append(dish)
    p.append(K.tube_path(name + '_lnb', [c, c + aim * 0.35], 0.012, mt['white'], seg=5))
    p.append(K.cylinder(name + '_lh', 0.035, 0.08, tuple(c + aim * 0.37), mt['dark'], 10))
    return p


# ------------------------------------------------------------------ 屋顶附属：椽子、檐沟、落水管


def rafters(name, infos, polys, ov, mt, spacing=0.45):
    """檐下露出的椽子（垂木）：每坡沿顺坡方向，从檐口到墙线；靠近转角处截到斜脊下的隅木为止。"""
    T = mt['timber']
    p = []
    for si, (info, poly) in enumerate(zip(infos, polys)):
        A, eu, ev, n, Wu = (info[k] for k in ('A', 'eu', 'ev', 'n', 'Wu'))
        hz = math.hypot(ev.x, ev.y)
        vw = ov / max(0.3, hz)  # 檐口到墙线的坡长
        pts = [Vector(q) for q in poly]
        # 左右两条边（斜脊或侧边）在 (u, v) 平面上的直线
        uv = [((q - A).dot(eu), (q - A).dot(ev)) for q in pts]
        left, right = uv[-1], uv[2]

        def v_lim(u):
            lim = vw
            if left[0] > 1e-3 and u < left[0]:
                lim = min(lim, u * left[1] / left[0])
            if Wu - right[0] > 1e-3 and u > right[0]:
                lim = min(lim, (Wu - u) * right[1] / (Wu - right[0]))
            return lim

        k = int(Wu / spacing)
        for i in range(k + 1):
            u = (Wu - k * spacing) / 2 + i * spacing
            ve = v_lim(u)
            if ve < 0.08:
                continue
            c = A + eu * u + ev * (ve / 2) - n * 0.03
            p.append(J.obox(f'{name}_{si}_{i}', c, eu, ev, n, 0.045, ve, 0.055, T))
        # 隅木（沿左侧斜脊）
        if left[0] > 1e-3:
            hd = (pts[-1] - A).normalized()
            lh = vw / max(0.2, hd.dot(ev))
            c = A + hd * (lh / 2) - n * 0.05
            side = hd.cross(n).normalized()
            p.append(J.obox(f'{name}_sumi{si}', c, side, hd, side.cross(hd), 0.1, lh, 0.11, T))
    return p


def gutter_loop(name, corners, mt, out=0.03, drop=0.025, r=0.06):
    """绕屋檐一圈的半圆檐沟（转角斜接）+ 每 0.9 m 一个吊钩。corners：檐口四角（屋面板底面所在平面，逆时针）。"""
    G = mt['gutter']
    cen = sum((Vector(c) for c in corners), Vector()) / len(corners)
    path = []
    for c in corners:
        c = Vector(c)
        o = Vector((c.x - cen.x, c.y - cen.y, 0))
        # 角点沿两边的外法线外移：对矩形取对角方向 × √2
        ox = Vector((math.copysign(1, o.x), 0, 0))
        oy = Vector((0, math.copysign(1, o.y), 0))
        path.append(c + (ox + oy) * out - ZUP * drop)
    th = 0.006
    prof = [(r * math.cos(a), r * math.sin(a)) for a in [math.pi + math.pi * k / 8 for k in range(9)]]
    prof += [((r - th) * math.cos(a), (r - th) * math.sin(a)) for a in [2 * math.pi - math.pi * k / 8 for k in range(9)]]
    prof += [(r + 0.008, 0.004), (r + 0.008, -0.008)]  # 外沿卷边
    parts = [J.sweep(name, path, prof, G, cyclic=True, smooth=50)]
    for i in range(len(path)):
        a, b = path[i], path[(i + 1) % len(path)]
        L = (b - a).length
        d = (b - a).normalized()
        k = int(L / 0.9)
        s = Vector((d.y, -d.x, 0))
        for j in range(1, k):
            q = a + d * (L * j / k)
            parts.append(J.obox(f'{name}_hk{i}_{j}', q + ZUP * 0.004, d, s, ZUP, 0.018, 2 * r + 0.03, 0.006, G))
    return parts, path


def downpipe(name, gpt, wall_pt, out_dir, mt, z_end=0.12, r=0.03):
    """落水管：檐沟底 → 集水斗 → 呼び樋斜向墙面 → 沿墙竖直向下 → 底部弯头。"""
    G = mt['gutter']
    g0 = Vector(gpt) - ZUP * 0.07
    w = Vector(wall_pt)
    pts = [g0, g0 - ZUP * 0.12, Vector((w.x, w.y, g0.z - 0.12 - 0.6)), Vector((w.x, w.y, z_end + 0.12)), Vector((w.x, w.y, z_end)) + out_dir * 0.18]
    p = [J.obox(name + '_hd', g0 + ZUP * 0.03, Vector((1, 0, 0)), Vector((0, 1, 0)), ZUP, 0.13, 0.11, 0.1, G),
         K.tube_path(name, K.round_path(pts, 0.12, 5), r, G, seg=10)]
    z = g0.z - 0.6
    while z > z_end + 0.6:
        p.append(K.cylinder(name + f'_c{int(z * 10)}', r + 0.008, 0.025, (w.x, w.y, z), G, 10))
        z -= 1.0
    return p


# ------------------------------------------------------------------ 布局


def layout(two, style, W, D):
    """各面开口与设备的位置（u 沿 BK.AX 的 u 轴，以墙中点为 0）。返回 dict。"""
    sx = W / 8.5
    a = style == 'plaster'
    fr = 'alu' if a else 'bronze'
    L = {}
    if a:
        front = [('koshido', -2.45 * sx, 1.8, 0.15, 2.05), ('degoshi', 1.4 * sx, 2.6, 0.95, 2.15)]
    else:
        front = [('degoshi', -2.0 * sx, 2.4, 0.95, 2.15), ('koshido', 2.1 * sx, 1.8, 0.15, 2.05)]
    L['+Y'] = front
    L['-Y'] = [('alu', 2.5 * sx, 1.7, 1.2, 2.3, dict(amado='L', frame=fr)), ('door', -0.55 * sx, 0.78, 0.6, 2.3, dict(frame=fr)),
               ('alu', -2.15 * sx, 0.7, 1.6, 2.2, dict(glass='frosted', bars=True, curtain=False, frame=fr))]
    L['+X'] = [('alu', 0.8, 1.6, 1.2, 2.3, dict(amado='R', frame=fr))]
    L['-X'] = [('alu', -1.6, 0.6, 1.6, 2.2, dict(glass='frosted', bars=True, curtain=False, frame=fr)), ('alu', 1.2, 1.5, 1.2, 2.3, dict(frame=fr))]
    if two:
        L2 = {}
        w2 = W * 0.75
        L2['+Y'] = [('koshimado' if a else 'mushiko', 0.0, min(3.2, w2 * 0.55), 4.15, 5.15)]
        L2['-Y'] = [('alu', -1.25 * sx, 1.6, 3.75, 5.55, dict(frame=fr)), ('alu', 1.25 * sx, 1.6, 3.75, 5.55, dict(frame=fr))]
        L2['+X'] = [('alu', 0.0, 1.2, 4.2, 5.2, dict(frame=fr))]
        L2['-X'] = [('alu', 0.3, 0.9, 4.3, 5.1, dict(frame=fr, amado='L'))]
        L['2F'] = L2
    return L


def _rects(ops):
    return [(c - w / 2, c + w / 2, z0, z1) for (_k, c, w, z0, z1, *_r) in ops]


def build_opening(name, F, half, op, mt, rnd):
    kind, c, w, z0, z1 = op[:5]
    kw = op[5] if len(op) > 5 else {}
    u0, u1 = c - w / 2, c + w / 2
    if kind == 'koshido':
        return koshido(name, F, half, u0, u1, z0, z1, mt)
    if kind == 'degoshi':
        return degoshi(name, F, half, u0, u1, z0, z1, mt)
    if kind == 'koshimado':
        return koshimado(name, F, half, u0, u1, z0, z1, mt)
    if kind == 'mushiko':
        return mushiko(name, F, half, u0, u1, z0, z1, mt)
    if kind == 'door':
        return alu_door(name, F, half, u0, u1, z0, z1, mt, frame=kw.get('frame', 'bronze'))
    return alu(name, F, half, u0, u1, z0, z1, mt, rnd, **kw)


def walls_floor(name, W, D, z0, z1, zsplit, ops_by_side, style, mt, rnd, base=True, skip_door=True):
    """一层（或二层）四面墙：墙体分块、柱梁 / 压条、门窗；可选台基与室内暗盒。"""
    parts = []
    lo = mt['sugi'] if style == 'plaster' else mt['yakisugi']
    hi = mt['plaster']
    for F, half, length in (('+Y', D / 2, W), ('-Y', D / 2, W), ('+X', W / 2, D - 0.2), ('-X', W / 2, D - 0.2)):
        ops = ops_by_side.get(F, [])
        rects = _rects(ops)
        full = W if F in ('+Y', '-Y') else D
        parts += wall_face(f'{name}_w{F}', F, half, length, z0, z1, zsplit, rects, lo, hi)
        parts += frame_posts(f'{name}_fp{F}', F, half, full, z0, z1, zsplit, rects, mt)
        for i, op in enumerate(ops):
            parts += build_opening(f'{name}_o{F}{i}', F, half, op, mt, rnd)
        if base:
            skip = [(r[0] - 0.05, r[1] + 0.05) for r, op in zip(rects, ops) if op[0] == 'koshido' and skip_door]
            parts += stone_base(f'{name}_sb{F}', F, half, length, mt, rnd, skip=skip, corner=0.1 if F in ('+Y', '-Y') else -0.05)
    # 四角的通柱（盖住两面墙的接缝，下段杉板的转角也由它收口）
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(BK.bx(f'{name}_cp{sx}{sy}', (0.15, 0.15, z1 - z0), (sx * (W / 2 - 0.045), sy * (D / 2 - 0.045), (z0 + z1) / 2), mt['timber']))
    # 室内暗盒（透过门窗看到的是暗的室内，而不是墙背面）
    parts.append(BK.bx(name + '_in', (W - 0.22, D - 0.22, z1 - z0 + (z0 - 0.12 if base else 0.0)), (0, 0, (z1 + (0.12 if base else z0)) / 2), mt['dark'], uv=False))
    return parts


# ------------------------------------------------------------------ 三级模型


def lod0(name, two, style, W=8.5, D=7.0):
    mt = mats()
    rnd = random.Random(name)
    lay = layout(two, style, W, D)
    zsplit = ZB + (0.45 if style == 'plaster' else 1.75)
    parts = walls_floor(name + '_f1', W, D, ZB, ZT, zsplit, lay, style, mt, rnd)
    # 生活细节
    a = style == 'plaster'
    parts += ac_unit(name + '_ac', '+X', W / 2, -1.9 if a else -2.2, mt)
    parts += propane(name + '_lp', '-Y', D / 2, -3.3 * W / 8.5, mt)
    parts += water_heater(name + '_wh', '-Y', D / 2, 0.25 * W / 8.5, mt)
    parts += meter(name + '_em', '+X', W / 2, 2.95, 1.45, mt, ZT - 0.2)
    door = next(op for op in lay['+Y'] if op[0] == 'koshido')
    dc = door[1]
    side = 1 if dc < 0 else -1
    parts.append(fb(name + '_nm', '+Y', D / 2, dc + side * 1.05 - 0.05, dc + side * 1.05 + 0.05, 1.45, 1.7, 0.0, 0.02, mt['board']))
    parts.append(fb(name + '_mb', '+Y', D / 2, dc + side * 1.05 - 0.16, dc + side * 1.05 + 0.16, 1.0, 1.32, 0.0, 0.12, mt['gutter']))
    parts += plants(name + '_pl', '+Y', D / 2, dc + side * 1.6, mt, rnd, n=3)
    if not two:
        roof, corners, infos = J.hip_roof(name + '_r', W, D, 2.2, 0.75, 0.45, ZT, dict(tile=mt['tile'], ibushi=mt['ibushi'], mendo=mt['plaster'], board=mt['board']))
        parts += roof
        polys = _hip_polys(W, D, 2.2, 0.75, 0.45, ZT)
        parts += rafters(name + '_rf', infos, polys, 0.75, mt)
        g, gpath = gutter_loop(name + '_gt', corners, mt)
        parts += g
        # 落水管：前左、后右两角
        for i, (ci, F, half, uu) in enumerate(((0, '-X', W / 2, -D / 2 + 0.12), (2, '+X', W / 2, -D / 2 + 0.12))):
            wall = wpt(F, half, uu, 0.0, 0.07)
            gp = gpath[ci].lerp(gpath[(ci + 1) % 4], 0.04)
            out_dir = BK.AX[F][1]
            parts += downpipe(name + f'_dp{i}', gp, wall, out_dir, mt)
        # 入口雨棚（庇）：几何瓦单坡 + 腕木
        parts += door_hood(name + '_hood', door[1], door[2], mt, D)
        if style == 'plaster':
            parts += tv_antenna(name + '_tv', Vector((0.7, -0.6, hip_z(0.7, -0.6, W, D, 2.2, 0.45, ZT))), mt, rnd, lambda x, y: hip_z(x, y, W, D, 2.2, 0.45, ZT))
    else:
        w2, d2 = W * 0.75, D * 0.8
        # 下屋：绕二层一圈的单坡瓦顶
        X0, Y0, X1, Y1 = w2 / 2, d2 / 2, W / 2 + 0.75, D / 2 + 0.75
        zl, zh = 2.75, 3.35
        quads = [((-X1, -Y1, zl), (X1, -Y1, zl), (X0, -Y0, zh), (-X0, -Y0, zh)),
                 ((X1, -Y1, zl), (X1, Y1, zl), (X0, Y0, zh), (X0, -Y0, zh)),
                 ((X1, Y1, zl), (-X1, Y1, zl), (-X0, Y0, zh), (X0, Y0, zh)),
                 ((-X1, Y1, zl), (-X1, -Y1, zl), (-X0, -Y0, zh), (-X0, Y0, zh))]
        rm = dict(tile=mt['tile'], ibushi=mt['ibushi'], mendo=mt['plaster'], board=mt['board'])
        pr, pinfos = J.lean_roof(name + '_pr', quads, rm, flashing=mt['gutter'])
        parts += pr
        parts += rafters(name + '_prf', pinfos, quads, 0.75, mt)
        g, gpath = gutter_loop(name + '_gt', [Vector(q[0]) for q in quads], mt)
        parts += g
        for i, (ci, F, half, uu) in enumerate(((0, '-X', W / 2, -D / 2 + 0.12), (2, '+X', W / 2, -D / 2 + 0.12))):
            wall = wpt(F, half, uu, 0.0, 0.07)
            gp = gpath[ci].lerp(gpath[(ci + 1) % 4], 0.04)
            parts += downpipe(name + f'_dp{i}', gp, wall, BK.AX[F][1], mt)
        # 二层
        lay2 = lay['2F']
        parts += walls_floor(name + '_f2', w2, d2, ZT, ZT + 3.0, ZT + 0.2, lay2, 'plaster', mt, rnd, base=False)
        roof, corners2, infos2 = J.hip_roof(name + '_r', w2, d2, 2.0, 0.7, 0.4, ZT + 3.0, rm)
        parts += roof
        parts += rafters(name + '_rf', infos2, _hip_polys(w2, d2, 2.0, 0.7, 0.4, ZT + 3.0), 0.7, mt)
        g2, gpath2 = gutter_loop(name + '_gt2', corners2, mt)
        parts += g2
        # 上层落水管：沿二层墙角下到下屋屋面
        for i, (ci, F, uu) in enumerate(((1, '+X', d2 / 2 - 0.12), (3, '-X', d2 / 2 - 0.12))):
            wall = wpt(F, w2 / 2, uu, 0.0, 0.07)
            gp = gpath2[ci].lerp(gpath2[(ci + 1) % 4], 0.04)
            parts += downpipe(name + f'_dq{i}', gp, wall, BK.AX[F][1], mt, z_end=3.62)
        # 二层后侧晾衣阳台（栏杆立在下屋屋面上）+ 晾衣竿
        parts += balcony(name + '_bal', w2, d2, mt)
        if style == 'wood':
            parts += bs_dish(name + '_bs', '-Y', d2 / 2, w2 * 0.38, 5.3, mt)
        else:
            parts += tv_antenna(name + '_tv', Vector((0.6, -0.5, hip_z(0.6, -0.5, w2, d2, 2.0, 0.4, ZT + 3.0))), mt, rnd, lambda x, y: hip_z(x, y, w2, d2, 2.0, 0.4, ZT + 3.0))
    return parts


def _hip_polys(w, d, h, ov, ridge, z0):
    hw, hd = w / 2 + ov, d / 2 + ov
    rw = (w / 2) * ridge
    ze = z0 - ov * h / (d / 2)
    A, B, C, Dd = Vector((-hw, -hd, ze)), Vector((hw, -hd, ze)), Vector((hw, hd, ze)), Vector((-hw, hd, ze))
    R1, R2 = Vector((-rw, 0, z0 + h)), Vector((rw, 0, z0 + h))
    return [[A, B, R2, R1], [B, C, R2], [C, Dd, R1, R2], [Dd, A, R1]]


def door_hood(name, c, w, mt, D):
    """玄关雨棚：贴墙的几何瓦单坡（两侧袖瓦）+ 两根腕木与斜撑。"""
    F, half = '+Y', D / 2
    hw = w / 2 + 0.4
    zt, proj, drop = 2.42, 0.85, 0.22
    q = [wpt(F, half, c - hw, zt - drop, proj), wpt(F, half, c + hw, zt - drop, proj), wpt(F, half, c + hw, zt, 0.0), wpt(F, half, c - hw, zt, 0.0)]
    rm = dict(tile=mt['tile'], ibushi=mt['ibushi'], mendo=mt['plaster'], board=mt['board'])
    parts, infos = J.lean_roof(name, [q], rm, hips=False, flashing=mt['gutter'])
    info = infos[0]
    parts.append(J.edge_roll(name + '_sl', q[0], q[3], info, mt['ibushi']))
    parts.append(J.edge_roll(name + '_sr', q[1], q[2], info, mt['ibushi']))
    T = mt['timber']
    for i, du in enumerate((-hw + 0.25, hw - 0.25)):
        parts.append(fb(name + f'_ud{i}', F, half, c + du - 0.04, c + du + 0.04, zt - drop - 0.17, zt - drop - 0.05, 0.0, proj - 0.05, T))
        a = wpt(F, half, c + du, zt - drop - 0.7, 0.0)
        b = wpt(F, half, c + du, zt - drop - 0.13, proj * 0.6)
        parts.append(K.tube_path(name + f'_br{i}', [a, b], 0.03, T, seg=6))
    parts.append(fb(name + '_fas', F, half, c - hw, c + hw, zt - drop - 0.14, zt - drop - 0.02, proj - 0.06, proj, T))
    return parts


def balcony(name, w2, d2, mt):
    """二层背面的晾衣阳台：立在下屋屋面上的铝栏杆 + 两根晾衣竿。"""
    A = mt['alu']
    F, half = '-Y', d2 / 2
    p = []
    n0 = 0.7
    z0, z1 = 3.6, 4.55
    for u in (-1.9, -0.95, 0.0, 0.95, 1.9):
        p.append(fb(name + f'_post{u}', F, half, u - 0.025, u + 0.025, z0 - 0.3, z1, n0, n0 + 0.05, A))
    p.append(fb(name + '_top', F, half, -1.95, 1.95, z1 - 0.04, z1 + 0.01, n0 - 0.01, n0 + 0.06, A))
    p.append(fb(name + '_bot', F, half, -1.95, 1.95, z0, z0 + 0.04, n0, n0 + 0.05, A))
    x = -1.9
    while x < 1.9:
        p.append(fb(name + f'_bl{int(x * 100)}', F, half, x - 0.01, x + 0.01, z0 + 0.04, z1 - 0.04, n0 + 0.015, n0 + 0.035, A))
        x += 0.11
    p.append(fb(name + '_deck', F, half, -1.95, 1.95, z0 - 0.06, z0, 0.02, n0 + 0.05, mt['steel']))
    for side in (-1.9, 1.9):
        p.append(fb(name + f'_hk{side}', F, half, side - 0.02, side + 0.02, z1, z1 + 0.5, n0 - 0.3, n0 - 0.26, A))
    for i, nn in enumerate((n0 - 0.28, n0 - 0.1)):
        a = wpt(F, half, -2.1, z1 + 0.48 - i * 0.04, nn)
        b = wpt(F, half, 2.1, z1 + 0.48 - i * 0.04, nn)
        p.append(K.tube_path(name + f'_pole{i}', [a, b], 0.016, mt['steel'], seg=6))
    return p


def lod1(name, two, style, W=8.5, D=7.0):
    """中景：墙体分区贴图 + 简化门窗 + 平板瓦屋面（瓦格子贴图 + 法线）+ 简化屋脊。"""
    mt = mats()
    p = [BK.bx(name + '_base', (W + 0.2, D + 0.2, ZB), (0, 0, ZB / 2), mt['granite'])]
    zsplit = ZB + (0.45 if style == 'plaster' else 1.75)
    lo = mt['sugi'] if style == 'plaster' else mt['yakisugi']
    p.append(BK.bx(name + '_lo', (W + 0.024, D + 0.024, zsplit - ZB), (0, 0, (ZB + zsplit) / 2), lo))
    p.append(BK.bx(name + '_hi', (W, D, ZT - zsplit), (0, 0, (zsplit + ZT) / 2), mt['plaster']))
    p.append(BK.bx(name + '_bm', (W + 0.06, D + 0.06, 0.2), (0, 0, ZT - 0.1), mt['timber']))
    lay = layout(two, style, W, D)
    for F, half in (('+Y', D / 2), ('-Y', D / 2), ('+X', W / 2), ('-X', W / 2)):
        for i, op in enumerate(lay.get(F, [])):
            p += _simple_opening(f'{name}_o{F}{i}', F, half, op, mt)
    rm = mt['flat']
    if not two:
        p += _flat_hip(name + '_r', W, D, 2.2, 0.75, 0.45, ZT, mt)
    else:
        w2, d2 = W * 0.75, D * 0.8
        p += BK.lean_ring(name + '_pr', w2 / 2, d2 / 2, 3.35 + 0.1, W / 2 + 0.75, D / 2 + 0.75, 2.75 + 0.1, 0.06, rm)
        p.append(BK.bx(name + '_hi2', (w2, d2, 3.0), (0, 0, ZT + 1.5), mt['plaster']))
        p.append(BK.bx(name + '_bm2', (w2 + 0.06, d2 + 0.06, 0.2), (0, 0, ZT + 2.9), mt['timber']))
        for F, half in (('+Y', d2 / 2), ('-Y', d2 / 2), ('+X', w2 / 2), ('-X', w2 / 2)):
            for i, op in enumerate(lay['2F'].get(F, [])):
                p += _simple_opening(f'{name}_p{F}{i}', F, half, op, mt)
        p += _flat_hip(name + '_r', w2, d2, 2.0, 0.7, 0.4, ZT + 3.0, mt)
    return p


def _flat_hip(name, w, d, h, ov, ridge, z0, mt):
    objs, lines, eaves = BK.roof_hip(name, w, d, h, ov, ridge, 0.16, mt['flat'], z0)
    for i, (a, b) in enumerate(lines):
        r = 0.15 if i == 0 else 0.11
        objs.append(J.sweep(f'{name}_rg{i}', [a + ZUP * 0.16, b + ZUP * 0.16], J.rect(-r, r, -0.06, r * 1.6), mt['ibushi']))
        objs.append(J.sweep(f'{name}_rw{i}', [a + ZUP * 0.16, b + ZUP * 0.16], J.rect(-r - 0.02, r + 0.02, -0.08, 0.0), mt['plaster']))
    R1, R2 = lines[0]
    e = (R2 - R1).normalized()
    for pnt, sgn in ((R1, -1), (R2, 1)):
        c = pnt + e * sgn * 0.12 + ZUP * 0.42
        objs.append(J.obox(f'{name}_oni{sgn}', c, e.cross(ZUP), e, ZUP, 0.55, 0.1, 0.55, mt['ibushi']))
    return objs


def _simple_opening(name, F, half, op, mt):
    kind, c, w, z0, z1 = op[:5]
    kw = op[5] if len(op) > 5 else {}
    u0, u1 = c - w / 2, c + w / 2
    T = mt['timber']
    if kind in ('koshido', 'degoshi', 'koshimado'):
        proj = 0.24 if kind == 'degoshi' else 0.0
        p = [fb(name + '_bg', F, half, u0, u1, z0, z1, -0.01 + proj, 0.006 + proj, mt['shoji'])]
        k = max(3, round((u1 - u0) / 0.12))
        for i in range(k + 1):
            x = u0 + (u1 - u0) * i / k
            p.append(fb(f'{name}_k{i}', F, half, x - 0.02, x + 0.02, z0, z1, proj, proj + 0.03, T))
        p.append(fb(name + '_t', F, half, u0 - 0.05, u1 + 0.05, z1, z1 + 0.06, -0.01, proj + 0.04, T))
        p.append(fb(name + '_b', F, half, u0 - 0.05, u1 + 0.05, z0 - 0.06, z0, -0.01, proj + 0.04, T))
        return p
    if kind == 'mushiko':
        p = [fb(name + '_bg', F, half, u0, u1, z0, z1, -0.01, 0.004, mt['dark'])]
        k = max(3, round((u1 - u0) / 0.14))
        for i in range(1, k):
            x = u0 + (u1 - u0) * i / k
            p.append(fb(f'{name}_b{i}', F, half, x - 0.04, x + 0.04, z0, z1, -0.01, 0.012, mt['plaster']))
        return p
    A = mt[kw.get('frame', 'alu')]
    g = mt['frosted'] if kw.get('glass') == 'frosted' or kind == 'door' else mt['glass']
    p = [fb(name + '_g', F, half, u0, u1, z0, z1, -0.01, 0.004, g)]
    for a, b, cz, dz in ((u0 - 0.04, u1 + 0.04, z1, z1 + 0.04), (u0 - 0.04, u1 + 0.04, z0 - 0.04, z0), (u0 - 0.04, u0, z0, z1), (u1, u1 + 0.04, z0, z1)):
        p.append(fb(name + f'_f{a:.2f}{cz:.2f}', F, half, a, b, cz, dz, -0.01, 0.03, A))
    if kw.get('amado'):
        bw = w / 2 + 0.08
        a, b = (u1 + 0.03, u1 + 0.03 + bw) if kw['amado'] == 'R' else (u0 - 0.03 - bw, u0 - 0.03)
        p.append(fb(name + '_tb', F, half, a, b, z0 - 0.09, z1 + 0.1, 0.0, 0.15, mt['amado']))
    return p


def lod2(name, two, style, W=8.5, D=7.0):
    """远景：墙体 + 屋面体块（共用中景材质）。"""
    mt = mats()
    lo = mt['sugi'] if style == 'plaster' else mt['yakisugi']
    zsplit = ZB + (0.45 if style == 'plaster' else 1.75)
    p = [BK.bx(name + '_lo', (W, D, zsplit), (0, 0, zsplit / 2), lo, uv=True),
         BK.bx(name + '_hi', (W, D, ZT - zsplit), (0, 0, (zsplit + ZT) / 2), mt['plaster'])]
    if not two:
        objs, _l, _e = BK.roof_hip(name + '_r', W, D, 2.2, 0.75, 0.45, 0.14, mt['flat'], ZT)
        p += objs
    else:
        w2, d2 = W * 0.75, D * 0.8
        p += BK.lean_ring(name + '_pr', w2 / 2, d2 / 2, 3.45, W / 2 + 0.75, D / 2 + 0.75, 2.85, 0.06, mt['flat'])
        p.append(BK.bx(name + '_hi2', (w2, d2, 3.0), (0, 0, ZT + 1.5), mt['plaster']))
        objs, _l, _e = BK.roof_hip(name + '_r', w2, d2, 2.0, 0.7, 0.4, 0.14, mt['flat'], ZT + 3.0)
        p += objs
    return p
