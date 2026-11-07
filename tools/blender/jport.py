# 日本小港口的模型（参照濑户内海沿岸的渔港、轮渡码头）：瓦楞铁皮仓库、港口悬臂吊、车客渡轮、消波块（四脚锥）、
# 防波堤灯塔、岸壁、栈桥、轻型卡车、鱼箱、渔网堆、路灯。props_japan.py 调用。

import math
import random

from mathutils import Matrix, Vector

import bkit as K
import bldkit as BK

M = BK.mat
F = BK.flat


def shed(name, wall, roof, W=22.0, L=40.0, H=9.0, doors=3):
    """港口仓库：瓦楞铁皮墙、混凝土墙裙、缓坡双坡屋顶、临水一侧的卷帘门、高窗、雨水管、屋脊通风器。
    W 沿 X（+X 朝水面），L 沿 Y。"""
    parts = []
    rise = W * 0.1
    parts.append(BK.bx('walls', (W, L, H), (0, 0, H / 2), M(wall)))
    parts.append(BK.bx('plinth', (W + 0.16, L + 0.16, 1.25), (0, 0, 0.625), M('concrete')))
    objs, _lines, _eaves = BK.roof_gable('roof', L, W, rise, 0.55, 0.45, 0.14, M(roof), H)
    gw = [BK.gable_wall('gw_a', L, W, rise, H, M(wall), x_side=1), BK.gable_wall('gw_b', L, W, rise, H, M(wall), x_side=-1)]
    BK.rotate_all(objs + gw, math.pi / 2)
    parts += objs + gw
    grey = F('door_grey', 0xaeb2b6, rough=0.5, metal=0.3)
    trim = F('shed_trim', 0x3a3e44, rough=0.55)
    for i in range(doors):
        y = (i - (doors - 1) / 2) * (L / doors)
        parts.append(BK.bx(f'door{i}', (0.12, 5.6, 4.8), (W / 2 + 0.06, y, 2.4), grey, uv=False))
        parts.append(BK.bx(f'door_box{i}', (0.5, 6.0, 0.6), (W / 2 + 0.25, y, 5.1), trim, uv=False))
        for k in range(7):
            parts.append(BK.bx(f'slat{i}_{k}', (0.03, 5.6, 0.05), (W / 2 + 0.135, y, 0.6 + k * 0.62), trim, uv=False))
    glass = F('shed_glass', 0x2a3540, rough=0.15, metal=0.4)
    for sx in (-1, 1):
        for i in range(int(L / 6)):
            y = -L / 2 + 3 + i * 6
            parts.append(BK.bx(f'win{sx}{i}', (0.08, 3.4, 0.9), (sx * (W / 2 + 0.04), y, H - 1.2), glass, uv=False))
    # 雨水管、屋檐天沟、屋脊通风器
    for sx in (-1, 1):
        parts.append(BK.bx(f'gutter{sx}', (0.2, L + 0.8, 0.16), (sx * (W / 2 + 0.5), 0, H - 0.1), trim, uv=False))
        for y in (-L / 2 + 1, L / 2 - 1):
            parts.append(K.cylinder(f'pipe{sx}{y}', 0.07, H, (sx * (W / 2 + 0.16), y, H / 2), trim, 8))
    for i in range(int(L / 9)):
        y = -L / 2 + 4.5 + i * 9
        parts.append(BK.bx(f'vent{i}', (1.1, 2.0, 0.5), (0, y, H + rise + 0.25), trim, uv=False))
    return BK.model(name, parts)[0]


def jib_crane(name):
    """港口悬臂吊：立柱 + 回转机房 + 桁架悬臂，比集装箱龙门吊小得多，渔港和小码头常见。"""
    parts = []
    blue = F('crane_blue', 0x2f5f8f, rough=0.45, metal=0.3)
    white = F('crane_white', 0xdedfdc, rough=0.5, metal=0.2)
    grey = F('crane_grey', 0x4a4e54, rough=0.6, metal=0.3)
    parts.append(BK.cyl('base', 2.2, 0.8, (0, 0, 0.4), M('concrete'), 24))
    parts.append(BK.cyl('column', 1.05, 13.0, (0, 0, 7.3), blue, 20, r2=0.8, uv=False))
    parts.append(BK.cyl('ring', 1.5, 0.6, (0, 0, 14.0), grey, 24, uv=False))
    parts.append(K.box('house', (6.4, 3.2, 3.0), (-1.2, 0, 15.8), white, bevel=0.1))
    parts.append(K.box('counter', (2.0, 2.8, 2.2), (-5.0, 0, 15.6), grey, bevel=0.08))
    parts.append(K.box('cab', (1.9, 1.8, 2.3), (2.6, 1.9, 15.5), white, bevel=0.1))
    parts.append(BK.bx('cab_glass', (1.92, 1.82, 1.0), (2.6, 1.9, 16.0), F('glass_dark', 0x1c252d, rough=0.08, metal=0.5), uv=False))
    # 桁架悬臂（三根弦杆 + 腹杆），根部在机房前方，向上仰约 20°
    a0 = Vector((1.2, 0, 16.6))
    d = Vector((math.cos(math.radians(20)), 0, math.sin(math.radians(20))))
    n = Vector((-d.z, 0, d.x))
    Ln = 27.0
    p0 = [a0 + Vector((0, 0.9, 0)), a0 + Vector((0, -0.9, 0)), a0 + n * 1.3]
    tip = a0 + d * Ln + n * 0.2
    for i, p in enumerate(p0):
        parts.append(K.tube_path(f'chord{i}', [p, tip], 0.11, blue, seg=8))
    seg = 11
    for k in range(seg):
        t0 = k / seg
        t1 = (k + 0.5) / seg
        a = [p.lerp(tip, t0) for p in p0]
        b = [p.lerp(tip, t1) for p in p0]
        parts.append(K.tube_path(f'w{k}a', [a[0], b[2]], 0.05, blue, seg=6))
        parts.append(K.tube_path(f'w{k}b', [a[1], b[2]], 0.05, blue, seg=6))
        parts.append(K.tube_path(f'w{k}c', [a[0], a[1]], 0.05, blue, seg=6))
    # 拉索、吊钩
    top = Vector((-1.2, 0, 21.8))
    parts.append(K.tube_path('mast', [Vector((-1.2, 0, 17.0)), top], 0.14, blue, seg=8))
    parts.append(K.tube_path('tie_a', [top, tip], 0.03, grey, seg=5))
    parts.append(K.tube_path('tie_b', [top, Vector((-5.4, 0, 16.6))], 0.03, grey, seg=5))
    hook = tip + Vector((-1.4, 0, -11.0))
    parts.append(K.tube_path('wire', [tip + Vector((-1.4, 0, -0.4)), hook], 0.02, grey, seg=5))
    parts.append(K.box('block', (0.5, 0.3, 0.8), tuple(hook), F('crane_yellow', 0xe0b020, rough=0.45), bevel=0.05))
    return BK.model(name, parts)[0]


def hull_loft(name, L, W, keel, top, m, bow0=0.7, z0=None, z1=None, n=30, prof=8):
    """船体放样：x 从船尾到船首，首部收窄并上扬，截面下窄上宽。z0..z1 只取这一段高度（用来分色）；不给 z1 时到舷边。"""
    lo = keel if z0 is None else z0
    verts, faces = [], []
    for i in range(n + 1):
        t = i / n
        x = -L / 2 + L * t
        bow = max(0.0, (t - bow0) / (1 - bow0))
        half = W / 2 * (1 - bow ** 1.9 * 0.97)
        hi = z1 if z1 is not None else top + 1.5 * bow ** 2
        for sy in (1, -1):
            for j in range(prof + 1):
                z = lo + (hi - lo) * j / prof
                k = min(1.0, max(0.0, (z - keel) / (top - keel)))
                verts.append((x, sy * half * (0.62 + 0.38 * k ** 0.5), z))
    col = 2 * (prof + 1)
    for i in range(n):
        for j in range(prof):
            a = i * col + j
            b = a + col
            faces.append((a, b, b + 1, a + 1))
            a2 = a + prof + 1
            b2 = a2 + col
            faces.append((a2, a2 + 1, b2 + 1, b2))
    ob = K.mesh_obj(name, verts, faces, m, smooth=40)
    K.fix_normals(ob)
    return ob


def _round_nose(x0, x1, half, nose, n=12):
    """舱室的平面：两边笔直，前头（+X）是圆的，逆时针。"""
    out = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        out.append((x1 - nose + nose * math.cos(a), half * math.sin(a)))
    return out + [(x0, half), (x0, -half)]


def _deck(name, x0, x1, half, z0, z1, m, nose=3.0):
    return K.prism(name, _round_nose(x0, x1, half, nose), z0, z1, m, smooth=40)


def _rail(parts, tag, pts, m, h=1.05, step=1.9):
    """栏杆：沿折线一根根立柱，上面两道横杆。pts：[(x, y, z)]"""
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        n = max(1, round(math.dist(a, b) / step))
        for i in range(n + 1):
            t = i / n
            q = [a[j] + (b[j] - a[j]) * t for j in range(3)]
            parts.append(BK.bx(f'{tag}p{k}_{i}', (0.05, 0.05, h), (q[0], q[1], q[2] + h / 2), m, uv=False))
        for f in (1.0, 0.55):
            parts.append(BK.stick(f'{tag}r{k}_{f}', (a[0], a[1], a[2] + h * f), (b[0], b[1], b[2] + h * f), 0.024, m, seg=4))


def ferry(name, hull=0x223c6e, band=0xb2261e):
    """车客渡轮（小型近海渡轮）：船身下半截上色，白色的车辆甲板舱、两层客舱、圆头驾驶台、椭圆烟囱、
    吊艇架、栏杆、尾部跳板。船头朝 +X。"""
    parts = []
    L, W = 46.0, 11.0
    H = W / 2
    white = F('ferry_white', 0xeceeec, rough=0.42)
    side = F('ferry_hull', hull, rough=0.4)
    red = F('ferry_band', band, rough=0.45)
    anti = F('ferry_antifoul', 0x6e2a22, rough=0.6)
    glass = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
    grey = F('ferry_grey', 0x6c7178, rough=0.55, metal=0.2)
    deckc = F('ferry_deck', 0x7a7f7c, rough=0.75)
    dark = F('ferry_dark', 0x14181c, rough=0.6)
    black = F('ferry_black', 0x17181a, rough=0.5)
    orange = F('lifeboat', 0xe8701e, rough=0.45)
    # 船体：水线下防污漆、船身色、护舷、白色上半截，一条色带顺着船形走到船头
    parts.append(hull_loft('hull_af', L, W, -1.6, 2.6, anti, z0=-1.6, z1=0.3))
    parts.append(hull_loft('hull_lo', L, W, -1.6, 2.6, side, z0=0.3, z1=1.15))
    parts.append(hull_loft('hull_up', L, W, -1.6, 2.6, white, z0=1.15))
    parts.append(hull_loft('rub', L, W + 0.16, -1.6, 2.6, grey, z0=1.15, z1=1.3))
    parts.append(hull_loft('band', L, W + 0.04, -1.6, 2.6, red, z0=1.8, z1=2.1))
    # 船艏柱：放样的两舷在这里合拢，留着缝看得见里面
    parts.append(BK.stick('stem_lo', (L / 2 + 0.02, 0, -1.4), (L / 2 + 0.02, 0, 1.15), 0.2, side, seg=8))
    parts.append(BK.stick('stem_hi', (L / 2 + 0.02, 0, 1.15), (L / 2 + 0.02, 0, 4.1), 0.2, white, seg=8))
    # 车辆甲板舱：圆头，两舷成排的开口
    parts.append(_deck('casing', -22.0, 14.5, H - 0.3, 2.6, 5.4, white, 4.2))
    parts.append(BK.bx('car_deck', (35.0, W - 0.9, 0.12), (-4.5, 0, 2.62), deckc, uv=False))
    for sy in (-1, 1):
        for i in range(9):
            parts.append(BK.bx(f'port{sy}{i}', (2.6, 0.06, 1.25), (-19.5 + i * 3.6, sy * (H - 0.29), 4.05), dark, uv=False))
    # 客舱甲板：比下面宽一圈，走得了人
    parts.append(_deck('deck_a', -23.0, 15.4, H - 0.08, 5.4, 5.56, white, 4.6))
    parts.append(_deck('deck_a_top', -22.9, 15.3, H - 0.16, 5.56, 5.58, deckc, 4.5))
    parts.append(_deck('cabin', -14.0, 10.6, H - 1.3, 5.58, 7.85, white, 3.4))
    parts.append(_deck('cabin_nose', 6.2, 10.63, H - 1.285, 6.3, 7.3, glass, 3.4))
    for sy in (-1, 1):
        for i in range(10):
            parts.append(BK.bx(f'win{sy}{i}', (1.45, 0.06, 1.0), (-12.8 + i * 1.95, sy * (H - 1.29), 6.8), glass, uv=False))
        parts.append(BK.bx(f'door{sy}', (1.0, 0.06, 2.0), (-13.3 + 20.2, sy * (H - 1.29), 6.6), grey, uv=False))
    parts.append(BK.bx('cabin_back', (0.06, W - 3.0, 1.0), (-14.0, 0, 6.8), glass, uv=False))
    # 上层：休息室和驾驶台
    parts.append(_deck('deck_b', -15.0, 11.3, H - 1.0, 7.85, 8.0, white, 3.6))
    parts.append(_deck('upper', -6.0, 7.4, H - 2.2, 8.0, 10.0, white, 2.6))
    for sy in (-1, 1):
        for i in range(5):
            parts.append(BK.bx(f'uwin{sy}{i}', (1.5, 0.06, 0.95), (-4.8 + i * 2.05, sy * (H - 2.19), 9.05), glass, uv=False))
    parts.append(_deck('bridge', 1.4, 8.2, H - 2.0, 10.0, 12.2, white, 2.3))
    parts.append(_deck('bridge_glass', 4.5, 8.24, H - 1.97, 10.95, 11.9, glass, 2.3))
    parts.append(_deck('bridge_roof', 0.9, 8.7, H - 1.7, 12.2, 12.36, white, 2.5))
    # 驾驶台两边伸出去的翼台
    parts.append(BK.bx('wing', (2.0, W - 0.3, 0.14), (5.2, 0, 10.05), white, uv=False))
    for sy in (-1, 1):
        parts.append(BK.bx(f'wing_side{sy}', (2.0, 0.06, 1.05), (5.2, sy * (H - 0.18), 10.6), white, uv=False))
        parts.append(BK.bx(f'wing_end{sy}', (0.06, 2.6, 1.05), (6.2, sy * (H - 1.45), 10.6), white, uv=False))
    # 烟囱：椭圆、往上收，一道色带，顶上是黑的
    for nm, h, z, r, r2, m in (('funnel', 3.9, 9.95, 1.02, 0.9, white), ('funnel_band', 0.75, 10.75, 0.985, 0.95, red), ('funnel_top', 0.5, 11.68, 0.925, 0.9, black)):
        ob = BK.cyl(nm, r + (0.02 if nm != 'funnel' else 0), h, (-9.5, 0, z), m, 18, r2=r2 + (0.02 if nm != 'funnel' else 0), uv=False)
        K.map_verts(ob, lambda v: (-9.5 + (v[0] + 9.5) * 1.6, v[1], v[2]))
        parts.append(ob)
    # 桅杆、雷达、喇叭
    parts.append(BK.cyl('mast', 0.11, 4.0, (3.0, 0, 14.3), white, 8, r2=0.05, uv=False))
    parts.append(BK.bx('yard', (0.1, 2.6, 0.08), (3.0, 0, 15.2), white, uv=False))
    parts.append(BK.cyl('radar_post', 0.14, 0.5, (5.8, 0, 12.6), grey, 8, uv=False))
    parts.append(BK.bx('radar', (0.22, 2.0, 0.14), (5.8, 0, 12.95), grey, uv=False))
    # 救生艇挂在吊艇架上，气胀救生筏的白罐子放在栏杆边
    for sy in (-1, 1):
        for x in (-12.0, -3.0):
            parts.append(K.sphere(f'raft{sy}{x}', 0.75, (x, sy * (H - 0.75), 8.95), orange, 12, 8, (3.0, 1, 0.8)))
            parts.append(K.box(f'raft_top{sy}{x}', (2.6, 1.0, 0.3), (x, sy * (H - 0.75), 9.45), white, bevel=0.1))
            for dx in (-1.7, 1.7):
                parts.append(K.tube_path(f'davit{sy}{x}{dx}', [(x + dx, sy * (H - 2.0), 8.0), (x + dx, sy * (H - 1.7), 9.7), (x + dx, sy * (H - 0.75), 10.1)], 0.06, grey, seg=5))
        for x in (-18.0, -16.6):
            parts.append(BK.cyl(f'can{sy}{x}', 0.34, 1.15, (x, sy * (H - 0.75), 5.95), white, 10, rot=(math.pi / 2, 0, 0), uv=False))
    # 栏杆
    for sy in (-1, 1):
        _rail(parts, f'ra{sy}', [(-22.6, sy * (H - 0.22), 5.58), (11.6, sy * (H - 0.22), 5.58)], grey)
        _rail(parts, f'rb{sy}', [(-14.6, sy * (H - 1.14), 8.0), (8.0, sy * (H - 1.14), 8.0)], grey)
    _rail(parts, 'rc', [(-22.6, H - 0.22, 5.58), (-22.6, -H + 0.22, 5.58)], grey)
    _rail(parts, 'rd', [(-14.6, H - 1.14, 8.0), (-14.6, -H + 1.14, 8.0)], grey)
    # 前甲板：锚机、系缆桩，栏杆顺着船头收上去
    # （甲板板子照着船头的宽度和舷弧收：方板子的角会戳到船体外面）
    fv, ff = [], []
    xs = [12.0 + i * 0.9 for i in range(13)]
    for x in xs:
        bow = max(0.0, ((x + L / 2) / L - 0.7) / 0.3)
        hw = H * (1 - bow ** 1.9 * 0.97) - 0.04
        z = 2.5 + 1.5 * bow ** 2
        fv += [(x, -hw, z), (x, 0.0, z - 0.1), (x, hw, z)]
    for i in range(len(xs) - 1):
        for j in range(2):
            a = i * 3 + j
            ff.append((a, a + 3, a + 4, a + 1))
    fore = K.mesh_obj('fore_deck', fv, ff, deckc, smooth=40)
    K.fix_normals(fore)
    parts.append(fore)
    parts.append(BK.bx('windlass', (1.0, 2.4, 0.8), (17.0, 0, 3.4), grey, uv=False, bevel=0.06))
    for sy in (-1, 1):
        parts.append(BK.cyl(f'gypsy{sy}', 0.42, 0.4, (17.0, sy * 1.5, 3.45), black, 12, rot=(math.pi / 2, 0, 0), uv=False))
        for x in (15.6, 19.4):
            parts.append(BK.cyl(f'bitt{sy}{x}', 0.16, 0.6, (x, sy * 2.2, 3.3), black, 10, uv=False))
        for x in (-20.0, -8.0):
            parts.append(BK.cyl(f'abitt{sy}{x}', 0.16, 0.5, (x, sy * (H - 0.8), 5.82), black, 10, uv=False))
        # 船头的栏杆：照着船体放样的宽度和舷弧走
        pts = []
        for x in (14.5, 16.5, 18.5, 20.5, 22.0):
            t = (x + L / 2) / L
            bow = max(0.0, (t - 0.7) / 0.3)
            pts.append((x, sy * (H * (1 - bow ** 1.9 * 0.97) - 0.2), 2.6 + 1.5 * bow ** 2))
        _rail(parts, f'rbow{sy}', pts, grey, step=1.4)
        # 锚：贴在船头两舷
        t = (18.5 + L / 2) / L
        bow = (t - 0.7) / 0.3
        hw = H * (1 - bow ** 1.9 * 0.97)
        parts.append(BK.bx(f'anchor{sy}', (0.5, 0.14, 0.7), (18.5, sy * (hw + 0.02), 2.0), black, uv=False, rz=sy * -0.24))
    # 尾部跳板：竖着收起来，有防滑筋和两边的吊杆
    parts.append(K.box('ramp', (0.25, 6.5, 5.2), (-L / 2 - 0.1, 0, 4.9), grey, bevel=0.05))
    for i in range(7):
        parts.append(BK.bx(f'rib{i}', (0.08, 6.3, 0.09), (-L / 2 - 0.26, 0, 2.8 + i * 0.7), black, uv=False))
    for sy in (-1, 1):
        parts.append(BK.bx(f'ramp_post{sy}', (0.5, 0.5, 6.2), (-L / 2 + 0.5, sy * 3.7, 5.6), white, uv=False))
        parts.append(BK.stick(f'ramp_arm{sy}', (-L / 2 + 0.6, sy * 3.7, 8.4), (-L / 2 - 0.12, sy * 3.1, 7.2), 0.09, grey, seg=6))
    return BK.model(name, parts)[0]


def _tetra(name, m, s, rot, pos, parts):
    ls = [Vector((0, 0, 1)), Vector((0.943, 0, -0.333)), Vector((-0.471, 0.816, -0.333)), Vector((-0.471, -0.816, -0.333))]
    for i, d in enumerate(ls):
        c = K.cylinder(f'{name}{i}', 0.62 * s, 1.5 * s, (0, 0, 0.75 * s), m, 6, r2=0.34 * s)
        K.bake_transform(c)
        c.data.transform(Matrix.Translation(Vector(pos)) @ rot @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4())
        parts.append(c)


def tetrapods(name, length=40.0, depth=9.0, seed=5):
    """消波块（四脚锥）堆：日本海岸最常见的景观之一。沿 X 铺一段。"""
    rng = random.Random(seed)
    parts = []
    m = M('concrete')
    nx, ny = int(length / 2.6), int(depth / 2.4)
    for layer in range(2):
        for i in range(nx):
            for j in range(ny - layer):
                x = -length / 2 + (i + 0.5) * length / nx + rng.uniform(-0.5, 0.5)
                y = -depth / 2 + (j + 0.5 + layer * 0.5) * 2.4 + rng.uniform(-0.4, 0.4)
                z = 0.5 + layer * 1.5 + (ny - j) * 0.55 + rng.uniform(-0.2, 0.2)
                rot = Matrix.Rotation(rng.uniform(0, 6.28), 4, 'Z') @ Matrix.Rotation(rng.uniform(-0.7, 0.7), 4, 'X') @ Matrix.Rotation(rng.uniform(-0.7, 0.7), 4, 'Y')
                _tetra(f't{layer}_{i}_{j}', m, rng.uniform(0.85, 1.1), rot, (x, y, z), parts)
    for p in parts:
        BK.uv_world(p, 2.7)
    return BK.model(name, parts)[0]


def harbor_light(name, hexc):
    """防波堤头上的灯塔：入港时红灯在右、绿 / 白灯在左。"""
    parts = []
    col = F(f'light_{name}', hexc, rough=0.45)
    white = F('paint_white2', 0xecece8, rough=0.5)
    parts.append(BK.cyl('base', 2.0, 1.0, (0, 0, 0.5), M('concrete'), 20))
    parts.append(BK.cyl('tower', 1.2, 6.6, (0, 0, 4.3), col, 18, r2=0.8, uv=False))
    parts.append(BK.cyl('band', 1.05, 0.7, (0, 0, 4.4), white, 18, r2=1.0, uv=False))
    parts.append(BK.cyl('gallery', 1.2, 0.14, (0, 0, 7.7), F('rail_dark', 0x2a2d31, rough=0.5), 18, uv=False))
    parts.append(BK.cyl('lantern', 0.55, 1.0, (0, 0, 8.3), F('lamp_glass', 0xf2f2e6, rough=0.1), 12, uv=False))
    parts.append(BK.cyl('cap', 0.7, 0.4, (0, 0, 9.0), col, 12, r2=0.15, uv=False))
    return BK.model(name, parts)[0]


def quay_seg(name, length=40.0):
    """岸壁一段（沿 Y）：混凝土墙 + 压顶、橡胶护舷、系船柱、爬梯。原点 = 岸壁外沿的地面高度处，+X 朝水面。"""
    parts = []
    # 墙体往陆地一侧铺 9 m：地形在这一带从陆地掉到水下，由这块顶板盖住。
    # 顶面和港区地面的水泥一个颜色，临水的墙面被海水泡得深一些
    top = F('quay_top', 0x8f8e88, rough=0.85)
    side = F('quay_side', 0x5f605e, rough=0.9)
    cap = F('quay_cap', 0xa3a29b, rough=0.8)
    parts.append(BK.bx('wall', (9.0, length, 8.96), (-4.5, 0, -4.48), top, uv=False))
    parts.append(BK.bx('wall_face', (0.08, length, 8.6), (0.03, 0, -4.4), side, uv=False))
    parts.append(BK.bx('cap', (1.4, length, 0.36), (-0.7, 0, 0.1), cap, uv=False))
    black = F('rubber_black', 0x1c1c1e, rough=0.8)
    iron = F('bollard', 0x35383c, rough=0.45, metal=0.4)
    for i in range(int(length / 10)):
        y = -length / 2 + 5 + i * 10
        parts.append(K.box(f'fender{i}', (0.45, 1.3, 2.6), (0.2, y, -1.5), black, bevel=0.14))
    for i in range(int(length / 20)):
        y = -length / 2 + 10 + i * 20
        parts.append(K.cylinder(f'bollard{i}', 0.23, 0.55, (-0.7, y, 0.55), iron, 12))
        parts.append(K.cylinder(f'bollard_h{i}', 0.33, 0.08, (-0.7, y, 0.84), iron, 12))
    for z in range(-5, 1):
        parts.append(BK.bx(f'lad{z}', (0.06, 0.5, 0.05), (0.03, 3.0, z * 0.4), iron, uv=False))
    return BK.model(name, parts)[0]


def pier_seg(name, length=20.0, width=10.0):
    """栈桥一段（沿 X）：混凝土桥面、两侧护轮槛、方桩与横梁、橡胶护舷。原点 = 桥面中线，桥面高 0。"""
    parts = []
    top = F('quay_top', 0x8f8e88, rough=0.85)
    side = F('quay_side', 0x5f605e, rough=0.9)
    cap = F('quay_cap', 0xa3a29b, rough=0.8)
    parts.append(BK.bx('deck', (length, width, 0.6), (0, 0, -0.3), top, uv=False))
    for sy in (-1, 1):
        parts.append(BK.bx(f'curb{sy}', (length, 0.3, 0.3), (0, sy * (width / 2 - 0.15), 0.15), cap, uv=False))
        parts.append(K.box(f'fender{sy}', (2.0, 0.4, 1.3), (0, sy * (width / 2 + 0.15), -0.7), F('rubber_black', 0x1c1c1e, rough=0.8), bevel=0.1))
        parts.append(K.cylinder(f'bol{sy}', 0.2, 0.5, (length / 4, sy * (width / 2 - 0.5), 0.25), F('bollard', 0x35383c, rough=0.45, metal=0.4), 10))
    for x in (-length / 2 + 2.5, length / 2 - 2.5):
        parts.append(BK.bx(f'beam{x}', (1.0, width, 0.8), (x, 0, -1.0), side, uv=False))
        for y in (-width / 2 + 0.9, 0.0, width / 2 - 0.9):
            parts.append(BK.bx(f'pile{x}{y}', (0.7, 0.7, 8.0), (x, y, -5.0), side, uv=False))
    return BK.model(name, parts)[0]


def kei_truck(name):
    """轻型卡车（日本到处都是的白色小货车）。"""
    parts = []
    white = F('truck_white', 0xe8e8e4, rough=0.35)
    dark = F('truck_dark', 0x1e2024, rough=0.5)
    parts.append(K.box('cab', (1.3, 1.45, 1.3), (1.05, 0, 1.15), white, bevel=0.12))
    parts.append(BK.bx('win', (1.32, 1.47, 0.5), (1.1, 0, 1.45), F('glass_dark', 0x1c252d, rough=0.08, metal=0.5), uv=False))
    parts.append(BK.bx('bed', (2.0, 1.45, 0.12), (-0.6, 0, 0.72), white, uv=False))
    for sy in (-1, 1):
        parts.append(BK.bx(f'gate{sy}', (2.0, 0.05, 0.32), (-0.6, sy * 0.71, 0.94), white, uv=False))
        for x in (1.05, -0.9):
            parts.append(K.cylinder(f'wheel{sy}{x}', 0.28, 0.18, (x, sy * 0.66, 0.28), dark, 12, rot=(math.pi / 2, 0, 0)))
    parts.append(BK.bx('tail', (0.05, 1.45, 0.32), (-1.6, 0, 0.94), white, uv=False))
    parts.append(BK.bx('chassis', (3.2, 1.2, 0.2), (0.0, 0, 0.5), dark, uv=False))
    return BK.model(name, parts)[0]


def fish_boxes(name, seed=2):
    """鱼箱堆：蓝色塑料箱码在托盘上。"""
    rng = random.Random(seed)
    parts = []
    blue = F('crate_blue', 0x2f6fb0, rough=0.5)
    wood = F('pallet', 0x8a7350, rough=0.8)
    for py, px in ((0, 0), (1.5, 0.2), (0.3, 1.6)):
        parts.append(BK.bx(f'pal{py}{px}', (1.2, 1.2, 0.14), (px, py, 0.07), wood, uv=False))
        h = rng.randint(3, 7)
        for k in range(h):
            for a, b in ((-0.3, -0.25), (0.3, -0.25), (-0.3, 0.25), (0.3, 0.25)):
                parts.append(BK.bx(f'c{py}{px}{k}{a}{b}', (0.56, 0.46, 0.24), (px + a, py + b, 0.27 + k * 0.25), blue, uv=False))
    return BK.model(name, parts)[0]


def net_pile(name, hexc, seed=3):
    """渔网堆：一团不规则的网和浮标绳。"""
    rng = random.Random(seed)
    m = F(f'net_{name}', hexc, rough=0.9)
    parts = []
    for i in range(7):
        c = K.sphere(f'n{i}', rng.uniform(0.6, 1.1), (rng.uniform(-1.3, 1.3), rng.uniform(-0.9, 0.9), 0.25), m, 10, 6, (1.3, 1, 0.45))
        parts.append(c)
    for i in range(10):
        parts.append(K.sphere(f'f{i}', 0.1, (rng.uniform(-1.6, 1.6), rng.uniform(-1, 1), rng.uniform(0.2, 0.55)), F('float_yellow', 0xe8c430, rough=0.5), 8, 5))
    return BK.model(name, parts)[0]


def street_lamp(name):
    """港区路灯。"""
    parts = []
    g = F('lamp_grey', 0x70757a, rough=0.5, metal=0.5)
    parts.append(BK.cyl('pole', 0.11, 9.0, (0, 0, 4.5), g, 8, r2=0.07, uv=False))
    parts.append(K.tube_path('arm', K.round_path([(0, 0, 8.9), (0, 0, 9.3), (1.4, 0, 9.5)], 0.3), 0.05, g, seg=6))
    parts.append(K.box('head', (0.7, 0.26, 0.12), (1.6, 0, 9.48), g, bevel=0.03))
    return BK.model(name, parts)[0]


def car(name, body_hex, van=False):
    """停在港区的小汽车（普通家用车 / 厢式小货车）。沿 +X 为车头。"""
    parts = []
    body = F(f'car_{body_hex:06x}', body_hex, rough=0.28, metal=0.25)
    dark = F('truck_dark', 0x1e2024, rough=0.5)
    glass = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
    L_, W_ = (3.9, 1.65) if van else (4.3, 1.72)
    parts.append(K.box('lower', (L_, W_, 0.62), (0, 0, 0.62), body, bevel=0.1))
    if van:
        parts.append(K.box('upper', (L_ - 0.5, W_ - 0.1, 0.92), (-0.2, 0, 1.36), body, bevel=0.12))
        parts.append(BK.bx('glass', (L_ - 0.42, W_ - 0.06, 0.42), (-0.2, 0, 1.46), glass, uv=False))
    else:
        parts.append(K.box('upper', (2.25, W_ - 0.16, 0.56), (-0.25, 0, 1.18), body, bevel=0.14))
        parts.append(BK.bx('glass', (2.33, W_ - 0.12, 0.34), (-0.25, 0, 1.2), glass, uv=False))
    for sy in (-1, 1):
        for x in (L_ * 0.31, -L_ * 0.31):
            parts.append(K.cylinder(f'wheel{sy}{x}', 0.31, 0.2, (x, sy * (W_ / 2 - 0.08), 0.31), dark, 14, rot=(math.pi / 2, 0, 0)))
    lamp = F('car_lamp', 0xe8e4d8, rough=0.2)
    tail = F('car_tail', 0x8e1612, rough=0.3)
    for sy in (-1, 1):
        parts.append(BK.bx(f'hl{sy}', (0.04, 0.34, 0.14), (L_ / 2 + 0.01, sy * 0.56, 0.76), lamp, uv=False))
        parts.append(BK.bx(f'tl{sy}', (0.04, 0.3, 0.16), (-L_ / 2 - 0.01, sy * 0.58, 0.76), tail, uv=False))
    return BK.model(name, parts)[0]


def forklift(name):
    """叉车：黄色车身、门架、货叉。"""
    parts = []
    y = F('fork_yellow', 0xd8a51c, rough=0.42)
    d = F('truck_dark', 0x1e2024, rough=0.5)
    g = F('lamp_grey', 0x70757a, rough=0.5, metal=0.5)
    parts.append(K.box('body', (1.9, 1.15, 0.85), (-0.2, 0, 0.72), y, bevel=0.1))
    parts.append(BK.bx('weight', (0.55, 1.15, 0.8), (-1.15, 0, 0.72), d, uv=False))
    for sy in (-1, 1):
        for x, z in ((0.5, 1.75), (-0.75, 1.75)):
            parts.append(BK.bx(f'post{sy}{x}', (0.06, 0.06, 1.2), (x, sy * 0.48, z), d, uv=False))
    parts.append(BK.bx('roof', (1.4, 1.06, 0.06), (-0.12, 0, 2.36), d, uv=False))
    for sy in (-1, 1):
        parts.append(BK.bx(f'mast{sy}', (0.1, 0.09, 2.5), (1.02, sy * 0.36, 1.3), g, uv=False))
        parts.append(BK.bx(f'fork{sy}', (1.05, 0.11, 0.05), (1.58, sy * 0.3, 0.18), g, uv=False))
        parts.append(K.cylinder(f'w{sy}', 0.33, 0.24, (0.55, sy * 0.52, 0.33), d, 14, rot=(math.pi / 2, 0, 0)))
        parts.append(K.cylinder(f'wr{sy}', 0.28, 0.2, (-0.8, sy * 0.52, 0.28), d, 14, rot=(math.pi / 2, 0, 0)))
    return BK.model(name, parts)[0]


def light_mast(name):
    """港区高杆灯：25 米的杆子，顶上一圈投光灯。"""
    parts = []
    g = F('lamp_grey', 0x70757a, rough=0.5, metal=0.5)
    d = F('shed_trim', 0x3a3e44, rough=0.55)
    parts.append(BK.cyl('foot', 0.72, 0.9, (0, 0, 0.45), M('concrete'), 14))
    parts.append(BK.cyl('pole', 0.3, 24.0, (0, 0, 12.6), g, 10, r2=0.13, uv=False))
    parts.append(BK.cyl('ring', 1.1, 0.14, (0, 0, 24.5), d, 16, uv=False))
    for i in range(6):
        a = i * math.pi / 3
        parts.append(K.box(f'head{i}', (0.5, 0.62, 0.3), (math.cos(a) * 0.95, math.sin(a) * 0.95, 24.25), d, bevel=0.03, rot=(0, 0, a)))
    return BK.model(name, parts)[0]


def pallets(name, seed=4):
    """托盘堆：木托盘和裹着膜的货。"""
    rnd = random.Random(seed)
    parts = []
    wood = F('pallet_wood', 0x9c7c52, rough=0.8)
    goods = [F('goods_a', 0xc8c4b8, rough=0.55), F('goods_b', 0x6f8aa0, rough=0.5), F('goods_c', 0xa8804e, rough=0.7)]
    for i in range(6):
        x = (i % 3 - 1) * 1.35 + rnd.uniform(-0.06, 0.06)
        y = (i // 3 - 0.5) * 1.3 + rnd.uniform(-0.06, 0.06)
        parts.append(BK.bx(f'p{i}', (1.2, 1.2, 0.14), (x, y, 0.07), wood, uv=False))
        h = rnd.uniform(0.6, 1.3)
        parts.append(K.box(f'g{i}', (1.1, 1.1, h), (x, y, 0.14 + h / 2), rnd.choice(goods), bevel=0.04))
    return BK.model(name, parts)[0]


def bollard(name):
    """系船柱"""
    d = F('bollard', 0x2a2c30, rough=0.5, metal=0.4)
    parts = [BK.cyl('b', 0.22, 0.75, (0, 0, 0.38), d, 12, r2=0.17, uv=False), BK.cyl('t', 0.3, 0.08, (0, 0, 0.78), d, 12, uv=False)]
    return BK.model(name, parts)[0]


def terminal(name):
    """渡轮候船楼：两层，混凝土 + 玻璃幕墙，门前有雨棚。W 沿 X（+X 朝水面），L 沿 Y。"""
    W, L_, H = 14.0, 34.0, 8.2
    parts = []
    glass = F('term_glass', 0x31424e, rough=0.1, metal=0.6)
    alu = F('alu', 0xb9bdc2, rough=0.35, metal=0.8)
    white = F('term_white', 0xd9d8d2, rough=0.6)
    trim = F('term_blue', 0x2c4f78, rough=0.45)
    parts.append(BK.bx('body', (W, L_, H), (0, 0, H / 2), M('concrete')))
    parts.append(BK.bx('roof', (W + 0.8, L_ + 0.8, 0.5), (0, 0, H + 0.25), white, uv=False))
    parts.append(BK.bx('band', (W + 0.84, L_ + 0.84, 0.26), (0, 0, H + 0.1), trim, uv=False))
    # 临水一面：一二层玻璃幕墙和竖框
    for z, h in ((2.0, 3.0), (5.9, 2.8)):
        parts.append(BK.bx(f'gl{z}', (0.1, L_ - 3, h), (W / 2 + 0.05, 0, z), glass, uv=False))
        for i in range(17):
            y = -(L_ - 3) / 2 + i * (L_ - 3) / 16
            parts.append(BK.bx(f'mu{z}{i}', (0.14, 0.09, h), (W / 2 + 0.08, y, z), alu, uv=False))
        parts.append(BK.bx(f'tr{z}', (0.16, L_ - 3, 0.1), (W / 2 + 0.08, 0, z + h / 2), alu, uv=False))
    # 陆侧：一排窗
    for i in range(10):
        y = -L_ / 2 + 2.6 + i * 3.2
        parts.append(BK.bx(f'bw{i}', (0.08, 2.0, 1.3), (-W / 2 - 0.04, y, 5.8), glass, uv=False))
        parts.append(BK.bx(f'bl{i}', (0.08, 2.0, 1.3), (-W / 2 - 0.04, y, 2.2), glass, uv=False))
    # 门前雨棚与柱子
    parts.append(BK.bx('canopy', (4.4, L_ * 0.55, 0.22), (W / 2 + 2.2, 0, 3.9), white, uv=False))
    for y in (-8, -2.7, 2.7, 8):
        parts.append(BK.cyl(f'col{y}', 0.14, 3.8, (W / 2 + 4.0, y, 1.9), alu, 10, uv=False))
    # 屋顶的设备和栏杆
    parts.append(BK.bx('ac', (3.4, 7.0, 1.2), (-1.5, 4, H + 1.1), F('shed_trim', 0x3a3e44, rough=0.55), uv=False))
    parts.append(BK.bx('tower', (3.6, 3.6, 2.6), (2.0, -9, H + 1.6), white, uv=False))
    return BK.model(name, parts)[0]


def build_all():
    roots = []
    roots.append(shed('pshed_a', 'corr_blue', 'iron'))
    roots.append(shed('pshed_b', 'corr_white', 'corr_blue'))
    roots.append(shed('pshed_c', 'corr_green', 'iron'))
    roots.append(shed('pshed_d', 'corr_white', 'iron', doors=2))
    roots.append(jib_crane('jib_crane'))
    roots.append(ferry('ferry_jp'))
    roots.append(tetrapods('tetrapods'))
    roots.append(harbor_light('hlight_r', 0xb8231c))
    roots.append(harbor_light('hlight_g', 0x2f8a52))
    roots.append(quay_seg('quay_seg'))
    roots.append(pier_seg('pier_seg'))
    roots.append(kei_truck('kei_truck'))
    roots.append(fish_boxes('fish_boxes'))
    roots.append(net_pile('net_a', 0x2c4a40))
    roots.append(net_pile('net_b', 0xa8552c, seed=9))
    roots.append(street_lamp('street_lamp'))
    roots.append(car('car_white', 0xe6e6e2))
    roots.append(car('car_silver', 0x9aa0a6))
    roots.append(car('car_blue', 0x2a4a72))
    roots.append(car('car_red', 0x8c2a24))
    roots.append(car('van_white', 0xdedfd8, van=True))
    roots.append(car('van_grey', 0x6c7278, van=True))
    roots.append(forklift('forklift'))
    roots.append(light_mast('light_mast'))
    roots.append(pallets('pallets_a'))
    roots.append(pallets('pallets_b', seed=11))
    roots.append(bollard('bollard'))
    roots.append(terminal('ferry_terminal'))
    return roots
