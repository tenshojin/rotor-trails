# 日本地图的地标精细模型（参照照片：福山明王院五重塔、严岛神社、鞆之浦沼名前神社拜殿、鞆之浦常夜灯、
# 海上保安厅的白色小灯塔；维基共享资源，照片只在浏览器里看，不进仓库）。
#   五重塔：三间见方、朱漆；每层柱头三手先斗栱、地垂木 + 飞檐垂木两重椽、几何本瓦屋面（下四层是绕塔一圈的单坡屋面，
#           顶层是宝形屋顶），二层起每层底部有缘与高栏；顶上相轮（露盘、伏钵、请花、九轮、水烟、龙车、宝珠）。
#   神社拜殿：花岗岩基坛 + 高床与缘、朱漆柱、正面格子户、两侧白壁；入母屋（歇山）本瓦屋顶（大栋、降栋、隅栋、
#           妻面狐格子、破风与悬鱼）；正面向拜（单坡小屋顶，两根向拜柱），铃与铃绪、赛钱箱、注连绳与纸垂。
#   常夜灯：鞆之浦港口的大石灯笼（江户末期），两层石基上的基础、竿、中台、火袋、笠、宝珠。
#   灯塔：白色锥形塔身、灯笼室（深灰框架 + 玻璃）、回廊栏杆、圆顶与避雷针、门廊与小窗。
# 坐标与 bldkit 相同：X 右、Y 前、Z 上；正面朝 -Y（游戏局部 +z）。三级细节：name / name@1 / name@2。

import math

from mathutils import Vector

import bkit as K
import bldkit as BK
import jhouse as JH
import jparts as J

ZUP = Vector((0, 0, 1))
_MT = {}


def mats():
    if _MT:
        return _MT
    F = BK.flat
    mt = dict(JH.mats())
    mt.update(
        verm=F('vermilion', 0xd2401e, rough=0.55),
        verm_dark=F('lm_verm_dark', 0x8f2614, rough=0.6),
        kiguchi=F('lm_kiguchi', 0xe9dcbc, rough=0.6),
        door=F('lm_door', 0xb4301a, rough=0.55),
        bronze=F('lm_bronze', 0x7a6338, rough=0.4, metal=0.85),
        gold=F('gold', 0xb89a4c, rough=0.35, metal=0.9),
        void=F('lm_void', 0x120e0b, rough=1.0),
        renji=F('lm_renji', 0x3d7a66, rough=0.5),
        rope=F('rope', 0xc8b78a, rough=0.9),
        paper=F('lm_paper', 0xf4f2ea, rough=0.8),
        lmwhite=F('lm_white', 0xefefeb, rough=0.45),
        lhdark=F('lh_dark', 0x2a2d31, rough=0.5, metal=0.4),
        lamp=F('lh_lamp', 0xfff6d0, rough=0.1, emit=0xfff2c0, emit_strength=2.0),
        glass=F('glass_dark', 0x1c252d, rough=0.08, metal=0.5),
        roofgrey=F('lm_roofgrey', 0x41464d, rough=0.6),
        wood=F('lm_wood', 0x6a4a30, rough=0.7),
        hinoki=BK.mat('hinoki'),
        kflat=BK.mat('kawara_flat'),
    )
    _MT.update(mt)
    return _MT


def rmats(mt):
    return dict(tile=mt['tile'], ibushi=mt['ibushi'], mendo=mt['plaster'], board=mt['board'])


def ob3(name, c, ax, ay, sx, sy, sz, m):
    """长方体：ax 为长度方向（水平），ay 为宽度方向，z 竖直。"""
    ax = Vector(ax).normalized()
    ay = Vector(ay).normalized()
    ob = J.obox(name, c, ax, ay, ax.cross(ay).normalized() if ax.cross(ay).z > 0 else -ax.cross(ay).normalized(), sx, sy, sz, m)
    # J.obox builds raw faces without UVs. Photo materials need the same metre-
    # scaled projection as BK.bx, including plaster walls and granite steps.
    if m and m.name.startswith('b_'):
        BK.uv_world(ob)
    return ob


SIDES = [(Vector((0, -1, 0)), Vector((1, 0, 0))), (Vector((1, 0, 0)), Vector((0, 1, 0))), (Vector((0, 1, 0)), Vector((-1, 0, 0))), (Vector((-1, 0, 0)), Vector((0, -1, 0)))]


# ====================================================================== 五重塔
P_W = [7.0, 6.4, 5.8, 5.2, 4.6]  # 各层塔身宽（柱心）
P_H = [3.5, 2.6, 2.5, 2.4, 2.4]  # 柱高（地板到头贯顶）
P_OV = [2.5, 2.4, 2.3, 2.2, 2.1]  # 出檐（柱心到檐口）
P_KIDAN = 1.2
P_BRK = 1.05  # 斗栱层高
P_SLOPE = 0.42
P_REACH = 1.3  # 三手先斗栱外伸（丸桁位置）


def pagoda_levels():
    lv = []
    z = P_KIDAN + 0.15
    for k in range(5):
        hw, h, ov = P_W[k] / 2, P_H[k], P_OV[k]
        zf, zw = z, z + h
        zb = zw + P_BRK
        X1 = hw + ov
        ze = zb - (X1 - (hw + P_REACH)) * P_SLOPE
        if k < 4:
            x_in = P_W[k + 1] / 2 + 0.85
            z_in = ze + (X1 - x_in) * P_SLOPE
            z = z_in + 0.25
        else:
            x_in = 0.0
            z_in = ze + X1 * P_SLOPE
        lv.append(dict(k=k, hw=hw, h=h, ov=ov, zf=zf, zw=zw, zb=zb, X1=X1, ze=ze, x_in=x_in, z_in=z_in))
    return lv


def roof_z(L, x):
    """第 L 层屋面（板底）在距中心 x（沿外法线）处的高度。"""
    return L['ze'] + (L['X1'] - x) * P_SLOPE


def bracket_set(name, L, pos, out, side, mt):
    """柱头三手先斗栱：大斗 + 三层向外的肘木（每层端头一个巻斗），最上层托住丸桁。out：外伸方向（单位水平向量）。"""
    p = []
    V = mt['verm']
    zw = L['zw']
    base = Vector(pos)
    p.append(BK.bx(f'{name}_dt', (0.44, 0.44, 0.22), tuple(base + ZUP * (zw + 0.11)), V, uv=False))
    for t in range(1, 4):
        reach = 0.43 * t
        z = zw + 0.22 + (t - 1) * 0.27
        c = base + out * (reach / 2 - 0.05) + ZUP * (z + 0.1)
        p.append(ob3(f'{name}_h{t}', c, out, side, reach + 0.3, 0.16, 0.2, V))
        tip = base + out * (reach + 0.05) + ZUP * (z + 0.26)
        p.append(ob3(f'{name}_m{t}', tip, out, side, 0.26, 0.26, 0.12, V))
        # 横向的肘木（第一、三层）：沿墙方向伸出，承托通肘木
        if t in (1, 3):
            p.append(ob3(f'{name}_x{t}', base + out * reach + ZUP * (z + 0.32), side, out, 1.1, 0.15, 0.18, V))
    return p


def pagoda_storey(name, L, mt, lod):
    k, hw, zf, zw, zb = L['k'], L['hw'], L['zf'], L['zw'], L['zb']
    p = []
    V, W = mt['verm'], mt['plaster']
    cr = 0.18 - 0.01 * k
    us = [-hw, -hw / 3, hw / 3, hw]
    # 柱（三间：每边四根，角柱共用）
    cols = []
    for x in us:
        for y in us:
            if abs(x) == hw or abs(y) == hw:
                cols.append((x, y))
    for i, (x, y) in enumerate(cols):
        p.append(BK.cyl(f'{name}_c{i}', cr, L['h'], (x, y, zf + L['h'] / 2), V, 12 if lod == 0 else 8, uv=False))
    for si, (n, s) in enumerate(SIDES):
        mid = n * hw
        # 头贯、地覆、长押
        p.append(ob3(f'{name}_nuki{si}', mid + ZUP * (zw - 0.15), s, n, 2 * hw + 0.36, 0.2, 0.3, V))
        p.append(ob3(f'{name}_jifuku{si}', mid + ZUP * (zf + 0.1), s, n, 2 * hw, 0.22, 0.2, V))
        p.append(ob3(f'{name}_nage{si}', mid + n * 0.04 + ZUP * (zw - 0.75), s, n, 2 * hw, 0.12, 0.16, V))
        bay = 2 * hw / 3
        for b in range(3):
            u = -hw + bay * (b + 0.5)
            c = mid + s * u - n * 0.06
            hh = L['h'] - 0.55
            zc = zf + 0.2 + hh / 2
            if b == 1:
                # 正中一间：朱漆板门（两扇），门钉
                p.append(ob3(f'{name}_door{si}', c + ZUP * zc, s, n, bay - 0.4, 0.1, hh, mt['door']))
                if lod == 0:
                    p.append(ob3(f'{name}_dmid{si}', c + n * 0.06 + ZUP * zc, s, n, 0.05, 0.04, hh, mt['verm_dark']))
                    for rz in (0.25, 0.5, 0.75):
                        p.append(ob3(f'{name}_drib{si}_{int(rz * 100)}', c + n * 0.06 + ZUP * (zf + 0.2 + hh * rz), s, n, bay - 0.45, 0.03, 0.07, mt['verm_dark']))
            else:
                # 两侧：白壁 + 连子窗
                p.append(ob3(f'{name}_wall{si}_{b}', c + ZUP * zc, s, n, bay - 0.3, 0.1, hh, W))
                if lod == 0:
                    wz = zf + 0.2 + hh * 0.58
                    p.append(ob3(f'{name}_wv{si}_{b}', c + n * 0.06 + ZUP * wz, s, n, bay * 0.62, 0.04, hh * 0.42, mt['void']))
                    p.append(ob3(f'{name}_wf{si}_{b}', c + n * 0.08 + ZUP * wz, s, n, bay * 0.66, 0.05, hh * 0.46, V))
                    for j in range(7):
                        uu = (j - 3) / 3.5 * bay * 0.29
                        p.append(ob3(f'{name}_wr{si}_{b}_{j}', c + s * uu + n * 0.1 + ZUP * wz, s, n, 0.045, 0.05, hh * 0.4, mt['renji']))
    # 斗栱 + 丸桁
    if lod == 0:
        for i, (x, y) in enumerate(cols):
            pos = Vector((x, y, 0))
            if abs(x) == hw and abs(y) == hw:
                outs = [Vector((math.copysign(1, x), 0, 0)), Vector((0, math.copysign(1, y), 0)), Vector((math.copysign(1, x), math.copysign(1, y), 0)).normalized()]
            elif abs(y) == hw:
                outs = [Vector((0, math.copysign(1, y), 0))]
            else:
                outs = [Vector((math.copysign(1, x), 0, 0))]
            for oi, o in enumerate(outs):
                side = Vector((-o.y, o.x, 0))
                p += bracket_set(f'{name}_b{i}_{oi}', L, pos, o, side, mt)
        # 中备（两柱之间的蟇股）：每间中央一块
        for si, (n, s) in enumerate(SIDES):
            for b in range(3):
                u = -hw + (2 * hw / 3) * (b + 0.5)
                p.append(ob3(f'{name}_kaeru{si}_{b}', n * (hw + 0.02) + s * u + ZUP * (zw + 0.35), s, n, 0.5, 0.12, 0.4, V))
    else:
        for si, (n, s) in enumerate(SIDES):
            for t in range(3):
                d = 0.2 + t * 0.43
                p.append(ob3(f'{name}_band{si}_{t}', n * (hw + d) + ZUP * (zw + 0.32 + t * 0.27), s, n, 2 * (hw + d), 0.4, 0.22, V))
    for si, (n, s) in enumerate(SIDES):
        X = hw + P_REACH
        p.append(ob3(f'{name}_gyo{si}', n * X + ZUP * (roof_z(L, X) - 0.16), s, n, 2 * X + 0.2, 0.22, 0.24, V))
    return p


def rafters(name, L, mt):
    """地垂木 + 飞檐垂木（两重椽）与木负、茅负；平行垂木，靠近转角处按对角线截短；四角各一根隅木。"""
    p = []
    V = mt['verm']
    hw, ov, X1 = L['hw'], L['ov'], L['X1']
    xa0, xa1 = hw + 0.2, hw + ov * 0.66
    xb0, xb1 = hw + ov * 0.5, X1 - 0.05
    sp = 0.3
    for si, (n, s) in enumerate(SIDES):
        cnt = int((2 * X1) / sp)
        for i in range(cnt + 1):
            u = -X1 + (2 * X1 - cnt * sp) / 2 + i * sp
            for tier, (x0, x1, dz, w, h) in enumerate(((xa0, xa1, 0.24, 0.11, 0.13), (xb0, xb1, 0.1, 0.09, 0.11))):
                a = max(x0, abs(u) + 0.05)
                if x1 - a < 0.15:
                    continue
                pa = n * a + s * u + ZUP * (roof_z(L, a) - dz)
                pb = n * x1 + s * u + ZUP * (roof_z(L, x1) - dz)
                d = pb - pa
                c = (pa + pb) / 2
                ax = d.normalized()
                p.append(J.obox(f'{name}_r{si}_{tier}_{i}', c, ax, s, ax.cross(s).normalized() * (1 if ax.cross(s).z > 0 else -1), d.length, w, h, V))
                if tier == 1:
                    p.append(J.obox(f'{name}_k{si}_{i}', pb + ax * 0.012, ax, s, ax.cross(s).normalized() * (1 if ax.cross(s).z > 0 else -1), 0.02, w + 0.01, h + 0.01, mt['kiguchi']))
        # 木负、茅负：沿檐口的横板（两端到对角线）
        for x, dz, nm in ((xa1, 0.2, 'kioi'), (X1 - 0.02, 0.04, 'kaya')):
            p.append(ob3(f'{name}_{nm}{si}', n * x + ZUP * (roof_z(L, x) - dz), s, n, 2 * x, 0.12, 0.16, V))
    for ci in range(4):
        sx, sy = (1, -1, 1, -1)[ci], (1, 1, -1, -1)[ci]
        a = Vector((sx * hw, sy * hw, 0))
        b = Vector((sx * X1, sy * X1, 0))
        za = roof_z(L, hw) - 0.18
        zb = roof_z(L, X1) - 0.1
        pa, pb = a + ZUP * za, b + ZUP * zb
        d = pb - pa
        side = Vector((-d.y, d.x, 0)).normalized()
        ax = d.normalized()
        p.append(J.obox(f'{name}_sumi{ci}', (pa + pb) / 2, ax, side, ax.cross(side).normalized() * (1 if ax.cross(side).z > 0 else -1), d.length + 0.2, 0.18, 0.2, V))
    return p


def balcony(name, L, mt):
    """二层起每层底部的缘（木板）与擬宝珠高栏。"""
    p = []
    hw, zf = L['hw'], L['zf']
    o = hw + 0.75
    V = mt['verm']
    for si, (n, s) in enumerate(SIDES):
        p.append(ob3(f'{name}_floor{si}', n * (hw + 0.375) + ZUP * (zf - 0.06), s, n, 2 * o, 0.75, 0.12, mt['hinoki']))
        p.append(ob3(f'{name}_rail{si}', n * o + ZUP * (zf + 0.72), s, n, 2 * o, 0.08, 0.08, V))
        p.append(ob3(f'{name}_rail2{si}', n * o + ZUP * (zf + 0.36), s, n, 2 * o, 0.06, 0.07, V))
        cnt = int(2 * o / 0.95)
        for i in range(cnt + 1):
            u = -o + 2 * o * i / cnt
            p.append(ob3(f'{name}_post{si}_{i}', n * o + s * u + ZUP * (zf + 0.36), s, n, 0.08, 0.08, 0.72, V))
    for ci in range(4):
        sx, sy = (1, -1, 1, -1)[ci], (1, 1, -1, -1)[ci]
        p.append(K.sphere(f'{name}_giboshi{ci}', 0.07, (sx * o, sy * o, zf + 0.84), mt['bronze'], 8, 5))
    return p


def sorin(name, z0, mt, lod):
    """相轮：露盘、伏钵、请花、九轮、水烟、龙车、宝珠（青铜），中间一根擦管。"""
    B = mt['bronze']
    p = [BK.bx(f'{name}_roban', (1.3, 1.3, 0.5), (0, 0, z0 + 0.25), B, uv=False)]
    p.append(K.sphere(f'{name}_fuku', 0.58, (0, 0, z0 + 0.5), B, 16 if lod == 0 else 8, 8, scale=(1, 1, 0.8)))
    p.append(BK.cyl(f'{name}_ukebana', 0.25, 0.32, (0, 0, z0 + 1.05), B, 16, r2=0.6, uv=False))
    p.append(BK.cyl(f'{name}_pole', 0.09, 8.0, (0, 0, z0 + 4.6), B, 8, r2=0.07, uv=False))
    for i in range(9):
        r = 0.56 - i * 0.012
        z = z0 + 1.45 + i * 0.42
        if lod == 0:
            p.append(K.torus(f'{name}_ring{i}', r, 0.055, (0, 0, z), B, 24, 6))
        else:
            p.append(BK.cyl(f'{name}_ring{i}', r, 0.1, (0, 0, z), B, 12, uv=False))
    zs = z0 + 1.45 + 9 * 0.42
    if lod == 0:
        for j in range(4):
            a = j * math.pi / 4
            p.append(BK.bx(f'{name}_suien{j}', (1.05, 0.04, 1.2), (0, 0, zs + 0.75), B, rz=a, uv=False))
    p.append(K.sphere(f'{name}_ryusha', 0.22, (0, 0, zs + 1.55), B, 12, 6))
    p.append(K.sphere(f'{name}_hoju', 0.26, (0, 0, zs + 1.95), B, 12, 6))
    p.append(BK.cyl(f'{name}_hojutip', 0.1, 0.3, (0, 0, zs + 2.3), B, 8, r2=0.0, uv=False))
    return p


def curl(parts, X, Y, A):
    """軒反り：屋檐到转角慢慢往上翘。屋面、椽子都顺着抬，檐中间不动。X、Y：檐口到中心的距离，A：转角抬多高。"""
    for o in parts:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world.copy()
        inv = mw.inverted()
        for v in o.data.vertices:
            w = mw @ v.co
            u, t = abs(w.x) / X, abs(w.y) / Y
            out = max(0.0, (max(u, t) - 0.55) / 0.45)
            w.z += A * out ** 1.6 * min(u, t, 1.0) ** 2.2
            v.co = inv @ w
        o.data.update()


def pagoda(lod):
    mt = mats()
    name = 'pagoda' if lod == 0 else f'pagoda@{lod}'
    rm = rmats(mt)
    p = []
    G = mt['granite']
    # 基坛（花岗岩）与四面石阶
    p.append(BK.bx(f'{name}_kidan', (12.2, 12.2, P_KIDAN), (0, 0, P_KIDAN / 2), G))
    p.append(BK.bx(f'{name}_kidancap', (12.4, 12.4, 0.12), (0, 0, P_KIDAN - 0.06), G))
    for si, (n, s) in enumerate(SIDES):
        for st in range(4):
            h = P_KIDAN * (4 - st) / 4
            p.append(ob3(f'{name}_step{si}_{st}', n * (6.1 + 0.3 * st + 0.15) + ZUP * (h / 2), s, n, 3.0, 0.3, h, G))
    lv = pagoda_levels()
    for L in lv:
        k = L['k']
        nm = f'{name}_s{k}'
        # 地板
        p.append(BK.bx(f'{nm}_floor', (2 * L['hw'] + 0.3, 2 * L['hw'] + 0.3, 0.18), (0, 0, L['zf'] - 0.09), mt['hinoki']))
        p += pagoda_storey(nm, L, mt, lod)
        if k > 0 and lod < 2:
            p += balcony(f'{nm}_bal', L, mt)
        X1 = L['X1']
        start = len(p)
        if lod == 0:
            p += rafters(f'{nm}_raf', L, mt)
            if k < 4:
                xi, zi, ze = L['x_in'], L['z_in'], L['ze']
                quads = []
                for n, s in SIDES:
                    quads.append([tuple(n * X1 - s * X1 + ZUP * ze), tuple(n * X1 + s * X1 + ZUP * ze), tuple(n * xi + s * xi + ZUP * zi), tuple(n * xi - s * xi + ZUP * zi)])
                parts, _ = J.lean_roof(f'{nm}_roof', quads, rm, hips=True, hip_layers=3)
                p += parts
            else:
                z0 = roof_z(L, L['hw'])
                parts, _, _ = J.hip_roof(f'{nm}_roof', 2 * L['hw'], 2 * L['hw'], z0 * 0 + P_SLOPE * L['hw'], L['ov'], 0.04, z0, rm, main_layers=2, hip_layers=3, oni_s=0.5, hip_oni_s=0.6)
                p += parts
        else:
            m = mt['kflat'] if lod == 1 else mt['roofgrey']
            if k < 4:
                p += BK.lean_ring(f'{nm}_roof', L['x_in'], L['x_in'], L['z_in'], X1, X1, L['ze'], 0.22, m)
            else:
                z0 = roof_z(L, L['hw'])
                objs, lines, _ = BK.roof_hip(f'{nm}_roof', 2 * L['hw'], 2 * L['hw'], P_SLOPE * L['hw'], L['ov'], 0.0, 0.22, m, z0)
                p += objs
            # 檐下的椽子层（深色板，远处看出檐有厚度）
            p += BK.lean_ring(f'{nm}_soffit', L['hw'] + 0.2, L['hw'] + 0.2, roof_z(L, L['hw'] + 0.2) - 0.25, X1 - 0.05, X1 - 0.05, L['ze'] - 0.2, 0.08, mt['verm_dark'])
            if lod == 1:
                for ci in range(4):
                    sx, sy = (1, -1, 1, -1)[ci], (1, 1, -1, -1)[ci]
                    a = Vector((sx * X1, sy * X1, L['ze'] + 0.25))
                    b = Vector((sx * L['x_in'], sy * L['x_in'], L['z_in'] + 0.25)) if k < 4 else Vector((0, 0, L['z_in'] + 0.25))
                    p.append(BK.ridge_tube(f'{nm}_hip{ci}', a, b, 0.13, mt['ibushi']))
        curl(p[start:], X1, X1, 0.1 * X1)
    top = lv[4]['z_in']
    p += sorin(f'{name}_sorin', top - 0.05, mt, lod)
    root, _ = BK.model(name, p)
    return root


# ====================================================================== 神社拜殿（入母屋 + 向拜）


def irimoya_roof(name, w, d, ov, slope, z0, mats_, gable=0.45, lift=0.075, board=0.045):
    """入母屋（歇山）本瓦屋顶：大栋沿 X。w、d = 柱心尺寸，ov = 出檐，slope = 坡度，z0 = 柱心线处的屋面高度。
    下半段四坡、上半段在 x = ±xg 处变成两片三角形的妻壁。返回（部件, 妻面信息 [(xg, yg, zg, zr)]）。"""
    X, Y = w / 2 + ov, d / 2 + ov
    ze = z0 - ov * slope
    zr = ze + Y * slope
    zg = ze + (zr - ze) * (1 - gable)
    t = (zg - ze) / slope
    xg, yg = X - t, Y - t
    A, Bp, C, D = Vector((-X, -Y, ze)), Vector((X, -Y, ze)), Vector((X, Y, ze)), Vector((-X, Y, ze))
    GA, GB, GC, GD = Vector((-xg, -yg, zg)), Vector((xg, -yg, zg)), Vector((xg, yg, zg)), Vector((-xg, yg, zg))
    R1, R2 = Vector((-xg, 0, zr)), Vector((xg, 0, zr))
    polys = [('S', [A, Bp, GB, R2, R1, GA]), ('E', [Bp, C, GC, GB]), ('N', [C, D, GD, R1, R2, GC]), ('W', [D, A, GA, GD])]
    parts = []
    for tag, poly in polys:
        _, eu, ev, n = J.slope_frame(poly)
        top = [q + n * board for q in poly]
        nv = len(poly)
        f = [tuple(range(nv)), tuple(range(nv, 2 * nv))] + [(i, (i + 1) % nv, nv + (i + 1) % nv, nv + i) for i in range(nv)]
        ob = K.mesh_obj(f'{name}_bd{tag}', poly + top, f, mats_['board'], smooth=0)
        K.fix_normals(ob)
        K.uv_box(ob, 1 / 1.2)
        parts.append(ob)
        tl, info = J.tile_slope(f'{name}_t{tag}', poly, mats_['tile'], lift=lift)
        parts.append(tl)
        parts += J.eave_ends(f'{name}_e{tag}', info, mats_['ibushi'])
    base = lift + 0.06
    # 隅栋（檐角 → 妻面下角）
    for i, (a, b) in enumerate(((A, GA), (Bp, GB), (C, GC), (D, GD))):
        da = (b - a).normalized()
        a2 = a + da * 0.18
        objs, _ = J.ridge_stack(f'{name}_hip{i}', [a2 + ZUP * base, b + ZUP * base], 3, 0.26, mats_['ibushi'], mats_['mendo'], lt=0.04, cap_r=0.075)
        parts += objs
        out = Vector((a.x - b.x, a.y - b.y, 0)).normalized()
        parts += J.onigawara(f'{name}_honi{i}', a2 + ZUP * (base - 0.05), out, mats_['ibushi'], s=0.55, busuma=False)
    # 降栋（妻面两侧的斜边，从大栋端头下到妻面下角）
    for i, (a, b) in enumerate(((R2, GB), (R2, GC), (R1, GA), (R1, GD))):
        objs, _ = J.ridge_stack(f'{name}_kudari{i}', [a + ZUP * base, b + ZUP * base], 3, 0.26, mats_['ibushi'], mats_['mendo'], lt=0.04, cap_r=0.075)
        parts += objs
    # 大栋（两端鬼瓦）
    e = Vector((1, 0, 0))
    path = [R1 - e * 0.1 + ZUP * (base + 0.02), R2 + e * 0.1 + ZUP * (base + 0.02)]
    objs, _ = J.ridge_stack(f'{name}_ridge', path, 5, 0.3, mats_['ibushi'], mats_['mendo'])
    parts += objs
    for end, sgn in ((path[0], -1), (path[-1], 1)):
        parts += J.onigawara(f'{name}_oni{sgn}', end - ZUP * 0.06 + e * sgn * 0.03, e * sgn, mats_['ibushi'], s=0.9)
    return parts, (xg, yg, zg, zr, ze, X, Y)


def gable_face(name, xg, yg, zg, zr, sgn, mt):
    """妻面：狐格子（竖向格子板）+ 两条破风板 + 顶端悬鱼。sgn = ±1（东 / 西）。"""
    p = []
    x = sgn * (xg - 0.05)
    # 三角形板（深色底）
    verts = [(x, -yg, zg), (x, yg, zg), (x, 0, zr)]
    tri = K.mesh_obj(f'{name}_tri', verts, [(0, 1, 2)], mt['void'], smooth=0)
    K.fix_normals(tri)
    p.append(tri)
    # 狐格子：竖条
    for i in range(1, 12):
        y = -yg + 2 * yg * i / 12
        hh = (zr - zg) * (1 - abs(y) / yg)
        if hh < 0.1:
            continue
        p.append(BK.bx(f'{name}_kg{i}', (0.05, 0.05, hh), (x + sgn * 0.03, y, zg + hh / 2), mt['verm'], uv=False))
    for side in (-1, 1):
        a = Vector((x + sgn * 0.1, side * (yg + 0.25), zg - 0.15))
        b = Vector((x + sgn * 0.1, 0, zr + 0.12))
        d = b - a
        p.append(J.obox(f'{name}_hafu{side}', (a + b) / 2, d.normalized(), Vector((1, 0, 0)), d.normalized().cross(Vector((1, 0, 0))), d.length, 0.08, 0.28, mt['verm_dark']))
    p.append(BK.bx(f'{name}_gegyo', (0.06, 0.55, 0.7), (x + sgn * 0.14, 0, zr - 0.35), mt['gold'], uv=False))
    return p


def shrine(lod):
    mt = mats()
    name = 'shrine' if lod == 0 else f'shrine@{lod}'
    rm = rmats(mt)
    V, G = mt['verm'], mt['granite']
    p = []
    w, d = 9.0, 6.5
    hw, hd = w / 2, d / 2
    zk, zf, zt = 0.9, 1.56, 4.6
    # 基坛（前面多出一块放向拜柱）与正面石阶
    p.append(BK.bx(f'{name}_kidan', (12.0, 11.8, zk), (0, -0.8, zk / 2), G))
    for st in range(3):
        h = zk * (3 - st) / 3
        p.append(BK.bx(f'{name}_step{st}', (3.4, 0.36, h), (0, -6.7 - 0.36 * st - 0.18, h / 2), G))
    # 高床：束、地板、缘与高栏（正面中间留出）
    for x in (-hw, -hw / 2, 0, hw / 2, hw):
        for y in (-hd, 0, hd):
            p.append(BK.cyl(f'{name}_tsuka{x}_{y}', 0.12, zf - zk, (x, y, (zf + zk) / 2), mt['wood'], 8, uv=False))
    p.append(BK.bx(f'{name}_floor', (w + 1.6, d + 1.6, 0.12), (0, 0, zf - 0.06), mt['hinoki']))
    o = (hw + 0.8, hd + 0.8)
    if lod < 2:
        rail = [((-o[0], -o[1]), (-1.6, -o[1])), ((1.6, -o[1]), (o[0], -o[1])), ((o[0], -o[1]), (o[0], o[1])), ((o[0], o[1]), (-o[0], o[1])), ((-o[0], o[1]), (-o[0], -o[1]))]
        for i, (a, b) in enumerate(rail):
            a3, b3 = Vector((a[0], a[1], zf + 0.7)), Vector((b[0], b[1], zf + 0.7))
            p.append(BK.stick(f'{name}_rail{i}', a3, b3, 0.045, V))
            p.append(BK.stick(f'{name}_rail2{i}', a3 - ZUP * 0.35, b3 - ZUP * 0.35, 0.035, V))
            L = (b3 - a3).length
            cnt = max(1, int(L / 0.9))
            for j in range(cnt + 1):
                q = a3.lerp(b3, j / cnt)
                p.append(BK.bx(f'{name}_rp{i}_{j}', (0.08, 0.08, 0.7), (q.x, q.y, zf + 0.35), V, uv=False))
    # 柱与横材
    xs = [-hw + w * i / 5 for i in range(6)]
    ys = [-hd + d * i / 3 for i in range(4)]
    cols = [(x, y) for x in xs for y in ys if abs(x) == hw or abs(y) == hd]
    for i, (x, y) in enumerate(cols):
        p.append(BK.cyl(f'{name}_col{i}', 0.17, zt - zf, (x, y, (zf + zt) / 2), V, 12 if lod == 0 else 8, uv=False))
    for z, hh, nm in ((zt - 0.14, 0.28, 'nuki'), (zf + 0.95, 0.16, 'nage'), (zf + 0.1, 0.2, 'jifuku')):
        p.append(BK.bx(f'{name}_{nm}F', (w + 0.3, 0.2, hh), (0, -hd, z), V, uv=False))
        p.append(BK.bx(f'{name}_{nm}B', (w + 0.3, 0.2, hh), (0, hd, z), V, uv=False))
        p.append(BK.bx(f'{name}_{nm}L', (0.2, d + 0.3, hh), (-hw, 0, z), V, uv=False))
        p.append(BK.bx(f'{name}_{nm}R', (0.2, d + 0.3, hh), (hw, 0, z), V, uv=False))
    # 正面五间：格子户（朱漆格子 + 暗色内里）；两侧与背面：白壁
    bay = w / 5
    for b in range(5):
        x = -hw + bay * (b + 0.5)
        zc = (zf + 0.2 + zt - 0.28) / 2
        hh = zt - 0.28 - (zf + 0.2)
        p.append(BK.bx(f'{name}_fv{b}', (bay - 0.36, 0.06, hh), (x, -hd + 0.06, zc), mt['void'], uv=False))
        if lod == 0:
            for j in range(1, 6):
                p.append(BK.bx(f'{name}_fk{b}_{j}', (0.04, 0.05, hh), (x - (bay - 0.36) / 2 + (bay - 0.36) * j / 6, -hd + 0.02, zc), V, uv=False))
            for j in range(1, 8):
                p.append(BK.bx(f'{name}_fh{b}_{j}', (bay - 0.36, 0.05, 0.04), (x, -hd + 0.02, zf + 0.2 + hh * j / 8), V, uv=False))
    for side, (cx, cy, sx, sy) in enumerate(((0, hd, w - 0.3, 0.12), (-hw, 0, 0.12, d - 0.3), (hw, 0, 0.12, d - 0.3))):
        p.append(BK.bx(f'{name}_wall{side}', (sx, sy, zt - zf - 0.4), (cx, cy, (zf + zt) / 2), mt['plaster']))
    # 柱头斗栱（出组）与桁
    if lod == 0:
        for i, (x, y) in enumerate(cols):
            p.append(BK.bx(f'{name}_dt{i}', (0.36, 0.36, 0.2), (x, y, zt + 0.1), V, uv=False))
            out = Vector((math.copysign(1, x) if abs(x) == hw else 0, math.copysign(1, y) if abs(y) == hd else 0, 0))
            if out.length > 0:
                out.normalize()
                side = Vector((-out.y, out.x, 0))
                p.append(ob3(f'{name}_hj{i}', Vector((x, y, zt + 0.3)) + out * 0.25, out, side, 0.7, 0.14, 0.18, V))
    p.append(BK.bx(f'{name}_ketaF', (w + 1.2, 0.2, 0.22), (0, -hd - 0.6, zt + 0.28), V, uv=False))
    p.append(BK.bx(f'{name}_ketaB', (w + 1.2, 0.2, 0.22), (0, hd + 0.6, zt + 0.28), V, uv=False))
    # 入母屋屋顶
    z0 = zt + 0.85
    slope, ov = 0.62, 1.6
    roof_start = len(p)
    if lod == 0:
        parts, (xg, yg, zg, zr, ze, X, Y) = irimoya_roof(f'{name}_roof', w, d, ov, slope, z0, rm)
        p += parts
        for sgn in (-1, 1):
            p += gable_face(f'{name}_gable{sgn}', xg, yg, zg, zr, sgn, mt)
        # 檐下椽子
        for si, (n, s) in enumerate(SIDES):
            half_w = (w if si % 2 == 0 else d) / 2
            half_o = (d if si % 2 == 0 else w) / 2
            cnt = int(2 * (half_w + ov) / 0.32)
            for i in range(cnt + 1):
                u = -(half_w + ov) + i * 2 * (half_w + ov) / cnt
                a = half_o + 0.05
                lim = half_o + ov - 0.05
                if abs(u) > half_w:
                    # 转角处只在本坡底下（对角线外侧）才有椽子
                    a = max(a, half_o + (abs(u) - half_w) + 0.05)
                if lim - a < 0.2:
                    continue
                pa = n * a + s * u + ZUP * (z0 - (a - half_o) * slope - 0.1)
                pb = n * lim + s * u + ZUP * (z0 - (lim - half_o) * slope - 0.1)
                dd = pb - pa
                ax = dd.normalized()
                up = ax.cross(s).normalized()
                if up.z < 0:
                    up = -up
                p.append(J.obox(f'{name}_raf{si}_{i}', (pa + pb) / 2, ax, s, up, dd.length, 0.08, 0.1, mt['wood']))
    else:
        m = mt['kflat'] if lod == 1 else mt['roofgrey']
        objs, lines, eaves = BK.roof_hip(f'{name}_roof', w, d, slope * hd, ov, 0.55, 0.2, m, z0)
        p += objs
        if lod == 1:
            for i, (a, b) in enumerate(lines):
                p.append(BK.ridge_tube(f'{name}_rt{i}', a + Vector((0, 0, 0.18)), b + Vector((0, 0, 0.18)), 0.15, mt['ibushi']))
    curl(p[roof_start:], hw + ov, hd + ov, 0.42)
    # 向拜：两根向拜柱、虹梁、单坡小屋顶（上沿收在主屋檐下）
    yo, yi, zi, zo = -hd - 3.0, -hd - 0.1, 4.32, 4.32 - 2.9 * 0.25
    for sx in (-1, 1):
        p.append(BK.cyl(f'{name}_kcol{sx}', 0.16, zo - 0.25 - zk, (sx * 2.1, yo + 0.3, (zo - 0.25 + zk) / 2), V, 12, uv=False))
        p.append(BK.bx(f'{name}_kbase{sx}', (0.5, 0.5, 0.25), (sx * 2.1, yo + 0.3, zk + 0.12), G))
        p.append(BK.bx(f'{name}_kbeam{sx}', (0.2, 3.0, 0.3), (sx * 2.1, (yo + yi) / 2 + 0.15, zo - 0.1), V, uv=False))
    p.append(BK.bx(f'{name}_kkoryo', (4.6, 0.24, 0.42), (0, yo + 0.3, zo - 0.35), V, uv=False))
    if lod == 0:
        q = [(-2.5, yo, zo), (2.5, yo, zo), (2.5, yi, zi), (-2.5, yi, zi)]
        parts, _ = J.lean_roof(f'{name}_kohai', [q], rm, hips=False)
        p += parts
        for sx in (-1, 1):
            a, b = Vector((sx * 2.55, yo - 0.1, zo - 0.05)), Vector((sx * 2.55, yi, zi + 0.12))
            dd = b - a
            p.append(J.obox(f'{name}_khafu{sx}', (a + b) / 2, dd.normalized(), Vector((1, 0, 0)), dd.normalized().cross(Vector((1, 0, 0))), dd.length, 0.07, 0.22, mt['verm_dark']))
        # 铃与铃绪、赛钱箱、注连绳与纸垂
        p.append(K.sphere(f'{name}_suzu', 0.2, (0, yo + 1.2, zo - 0.75), mt['gold'], 14, 8))
        p.append(BK.cyl(f'{name}_suzuo', 0.045, 1.9, (0, yo + 1.2, zo - 1.8), mt['rope'], 8, uv=False))
        p.append(BK.cyl(f'{name}_suzuo2', 0.03, 1.9, (0.05, yo + 1.2, zo - 1.8), V, 6, uv=False))
        p.append(BK.bx(f'{name}_saisen', (1.8, 0.65, 0.7), (0, -hd - 0.95, zf + 0.35), mt['wood']))
        for j in range(8):
            p.append(BK.bx(f'{name}_saisen_s{j}', (1.7, 0.05, 0.05), (0, -hd - 0.95 - 0.28 + j * 0.08, zf + 0.72), mt['hinoki'], uv=False))
        pts = [(-2.0, yo + 0.12, zo - 0.62), (-1.0, yo + 0.1, zo - 0.82), (0.0, yo + 0.1, zo - 0.9), (1.0, yo + 0.1, zo - 0.82), (2.0, yo + 0.12, zo - 0.62)]
        p.append(K.tube_path(f'{name}_shime', pts, 0.12, mt['rope'], seg=10))
        for j, x in enumerate((-1.2, -0.4, 0.4, 1.2)):
            zz = zo - 0.86 + 0.08 * abs(x)
            for k in range(3):
                p.append(BK.bx(f'{name}_shide{j}_{k}', (0.12, 0.01, 0.16), (x + (0.04 if k % 2 else -0.04), yo + 0.08, zz - 0.15 - k * 0.15), mt['paper'], uv=False))
    else:
        p.append(BK.slab(f'{name}_kohai', [(-2.5, yo, zo), (2.5, yo, zo), (2.5, yi, zi), (-2.5, yi, zi)], 0.2, mt['kflat'] if lod == 1 else mt['roofgrey']))
    root, _ = BK.model(name, p)
    return root


# ====================================================================== 鞆之浦常夜灯（港口的大石灯笼）


def joyato():
    mt = mats()
    G, S = mt['granite'], mt['stonewall']
    p = []
    p.append(BK.bx('joyato_base1', (4.4, 4.4, 0.7), (0, 0, 0.35), S))
    p.append(BK.bx('joyato_base2', (3.4, 3.4, 0.6), (0, 0, 1.0), G))
    p.append(BK.bx('joyato_kiso', (2.0, 2.0, 0.5), (0, 0, 1.55), G, bevel=0.05))
    p.append(BK.bx('joyato_kiso2', (1.5, 1.5, 0.25), (0, 0, 1.92), G, bevel=0.03))
    p.append(BK.bx('joyato_sao', (0.8, 0.8, 2.4), (0, 0, 3.25), G, bevel=0.03))
    p.append(BK.bx('joyato_chudai', (1.8, 1.8, 0.4), (0, 0, 4.65), G, bevel=0.04))
    p.append(BK.bx('joyato_chudai2', (1.3, 1.3, 0.15), (0, 0, 4.92), G))
    # 火袋：四根石柱 + 木格子窗（里面点着灯）
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(BK.bx(f'joyato_hp{sx}{sy}', (0.24, 0.24, 1.3), (sx * 0.52, sy * 0.52, 5.65), G))
    p.append(BK.bx('joyato_light', (0.8, 0.8, 1.1), (0, 0, 5.6), F_lamp(mt)))
    for si, (n, s) in enumerate(SIDES):
        for j in range(5):
            u = (j - 2) * 0.17
            p.append(ob3(f'joyato_lat{si}_{j}', n * 0.43 + s * u + ZUP * 5.6, s, n, 0.035, 0.04, 1.05, mt['wood']))
        p.append(ob3(f'joyato_latb{si}', n * 0.43 + ZUP * 5.6, s, n, 0.82, 0.04, 0.04, mt['wood']))
    # 笠：上翘的四角（中心低平、四角翘起的四坡）
    verts, faces = [], []
    R = 1.55
    for ring, (r, z) in enumerate(((R, 6.42), (R * 0.82, 6.72), (0.32, 7.2))):
        for i in range(16):
            a = 2 * math.pi * i / 16
            c, s_ = math.cos(a), math.sin(a)
            m = max(abs(c), abs(s_))
            x, y = c / m * r, s_ / m * r
            corner = (abs(abs(c) - abs(s_)) < 0.25)
            verts.append((x, y, z + (0.22 if corner and ring == 0 else 0.0)))
    for ring in range(2):
        for i in range(16):
            a, b = ring * 16 + i, ring * 16 + (i + 1) % 16
            faces.append((a, b, b + 16, a + 16))
    faces.append(tuple(range(32, 48)))
    faces.append(tuple(reversed(range(0, 16))))
    kasa = K.mesh_obj('joyato_kasa', verts, faces, G, smooth=30)
    K.fix_normals(kasa)
    p.append(kasa)
    p.append(BK.bx('joyato_kasa_under', (2.6, 2.6, 0.12), (0, 0, 6.36), G))
    p.append(K.sphere('joyato_ukebana', 0.34, (0, 0, 7.35), G, 12, 6, scale=(1, 1, 0.6)))
    p.append(K.sphere('joyato_hoju', 0.3, (0, 0, 7.75), G, 12, 8))
    p.append(BK.cyl('joyato_tip', 0.12, 0.3, (0, 0, 8.1), G, 8, r2=0.0, uv=False))
    root, _ = BK.model('joyato', p)
    return root


def F_lamp(mt):
    return BK.flat('lm_lantern', 0xffe2a0, rough=0.4, emit=0xffd890, emit_strength=1.4)


# ====================================================================== 灯塔（白色锥形塔身）


def lighthouse():
    mt = mats()
    Wt, D = mt['lmwhite'], mt['lhdark']
    p = []
    h = 20.0
    p.append(BK.cyl('lh_base', 3.6, 2.0, (0, 0, 1.0), BK.mat('concrete'), 32, r2=3.4))
    p.append(BK.cyl('lh_tower', 2.6, h, (0, 0, 2 + h / 2), Wt, 40, r2=1.8, uv=False))
    # 塔身上的检修小窗、门与门廊
    for i, z in enumerate((6.0, 10.5, 15.0)):
        r = 2.6 - (z - 2) / h * 0.8
        a = 0.6 + i * 2.1
        c = Vector((math.cos(a) * r, math.sin(a) * r, z))
        nrm = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-nrm.y, nrm.x, 0))
        p.append(ob3(f'lh_win{i}', c + nrm * 0.02, side, nrm, 0.5, 0.06, 0.8, mt['glass']))
        p.append(ob3(f'lh_winf{i}', c, side, nrm, 0.62, 0.05, 0.92, D))
    p.append(BK.bx('lh_porch', (2.2, 1.6, 2.6), (0, -2.9, 3.3), Wt, uv=False))
    p.append(BK.bx('lh_porch_roof', (2.5, 1.9, 0.15), (0, -2.95, 4.68), D, uv=False))
    p.append(BK.bx('lh_door', (1.0, 0.06, 2.0), (0, -3.72, 3.0), mt['lhdark'], uv=False))
    # 回廊（平台 + 栏杆）
    zg = 2 + h
    p.append(BK.cyl('lh_gallery', 2.75, 0.3, (0, 0, zg + 0.15), D, 40, uv=False))
    p.append(BK.cyl('lh_gallery_under', 2.0, 0.6, (0, 0, zg - 0.3), Wt, 32, r2=2.7, uv=False))
    for i in range(28):
        a = 2 * math.pi * i / 28
        p.append(BK.cyl(f'lh_rail{i}', 0.03, 1.05, (2.62 * math.cos(a), 2.62 * math.sin(a), zg + 0.82), Wt, 6, uv=False))
    p.append(K.torus('lh_railtop', 2.62, 0.045, (0, 0, zg + 1.35), Wt, 56, 6))
    p.append(K.torus('lh_railmid', 2.62, 0.03, (0, 0, zg + 0.85), Wt, 56, 6))
    # 灯笼室：矮墙 + 玻璃 + 竖框 + 灯
    p.append(BK.cyl('lh_lroom_wall', 1.55, 0.8, (0, 0, zg + 0.7), D, 24, uv=False))
    p.append(BK.cyl('lh_glass', 1.45, 2.2, (0, 0, zg + 2.2), mt['glass'], 16, uv=False))
    p.append(BK.cyl('lh_lens', 0.55, 1.2, (0, 0, zg + 2.2), mt['lamp'], 12, uv=False))
    for i in range(10):
        a = 2 * math.pi * i / 10
        p.append(BK.cyl(f'lh_mull{i}', 0.05, 2.2, (1.47 * math.cos(a), 1.47 * math.sin(a), zg + 2.2), D, 6, uv=False))
    p.append(K.torus('lh_ring_lo', 1.48, 0.06, (0, 0, zg + 1.1), D, 32, 6))
    p.append(K.torus('lh_ring_hi', 1.48, 0.06, (0, 0, zg + 3.3), D, 32, 6))
    # 圆顶、通风球、避雷针
    p.append(BK.cyl('lh_dome_rim', 1.7, 0.12, (0, 0, zg + 3.36), D, 24, uv=False))
    p.append(BK.cyl('lh_dome', 1.62, 0.95, (0, 0, zg + 3.9), D, 24, r2=0.35, uv=False))
    p.append(K.sphere('lh_vent', 0.32, (0, 0, zg + 4.3), D, 12, 6))
    p.append(BK.cyl('lh_rod', 0.03, 1.6, (0, 0, zg + 5.3), D, 6, uv=False))
    root, _ = BK.model('lighthouse', p)
    return root
