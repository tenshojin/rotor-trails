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


def ferry(name):
    """车客渡轮（濑户内海常见的小型渡轮）：蓝色船底、白色船身、两层客舱、驾驶台、烟囱、救生艇、尾部跳板。"""
    parts = []
    L, W = 46.0, 11.0
    white = F('ferry_white', 0xeceeec, rough=0.42)
    navy = F('ferry_navy', 0x223c6e, rough=0.4)
    red = F('ferry_red', 0xb2261e, rough=0.45)
    glass = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
    grey = F('ferry_grey', 0x6c7178, rough=0.55, metal=0.2)
    parts.append(hull_loft('hull_lo', L, W, -1.6, 2.6, navy, z0=-1.6, z1=1.0))
    parts.append(hull_loft('hull_up', L, W, -1.6, 2.6, white, z0=1.0))
    parts.append(BK.bx('car_deck', (L * 0.86, W * 0.9, 0.2), (-1.5, 0, 2.5), grey, uv=False))
    parts.append(BK.bx('stripe_a', (L * 0.72, 0.05, 0.3), (-2, W / 2 - 0.02, 1.9), red, uv=False))
    parts.append(BK.bx('stripe_b', (L * 0.72, 0.05, 0.3), (-2, -W / 2 + 0.02, 1.9), red, uv=False))
    # 舷墙开口（车辆甲板的侧窗）
    for sy in (-1, 1):
        for i in range(8):
            parts.append(BK.bx(f'port{sy}{i}', (2.4, 0.05, 1.0), (-15 + i * 4, sy * (W / 2 - 0.25), 3.6), glass, uv=False))
    parts.append(K.box('deck1', (L * 0.6, W - 1.4, 3.0), (-3, 0, 4.1), white, bevel=0.15))
    parts.append(BK.bx('win1a', (L * 0.56, W - 1.36, 1.0), (-3, 0, 4.5), glass, uv=False))
    parts.append(K.box('deck2', (L * 0.34, W - 2.4, 2.6), (2, 0, 6.8), white, bevel=0.12))
    parts.append(BK.bx('win2', (L * 0.31, W - 2.36, 0.9), (2, 0, 7.1), glass, uv=False))
    # 驾驶台：向两舷伸出的翼台
    parts.append(K.box('bridge', (4.2, W - 0.8, 2.3), (9.0, 0, 9.0), white, bevel=0.12))
    parts.append(BK.bx('bridge_glass', (4.24, W - 0.76, 0.95), (9.0, 0, 9.4), glass, uv=False))
    parts.append(K.box('bridge_top', (4.8, W - 0.2, 0.2), (9.0, 0, 10.25), white, bevel=0.05))
    # 烟囱、桅杆、雷达
    parts.append(K.box('funnel', (3.0, 1.7, 3.4), (-8.0, 0, 9.5), white, bevel=0.3))
    parts.append(BK.bx('funnel_band', (3.04, 1.74, 0.7), (-8.0, 0, 10.2), red, uv=False))
    parts.append(BK.cyl('mast', 0.12, 5.0, (6.5, 0, 12.5), white, 8, uv=False))
    parts.append(BK.bx('radar', (1.8, 0.2, 0.14), (6.5, 0, 13.0), grey, uv=False))
    # 救生艇（橙色）
    orange = F('lifeboat', 0xe8701e, rough=0.45)
    for sy in (-1, 1):
        for x in (-12.0, -4.0):
            parts.append(K.sphere(f'raft{sy}{x}', 0.8, (x, sy * (W / 2 - 1.2), 6.0), orange, 12, 8, (2.6, 1, 0.8)))
    # 栏杆
    for sy in (-1, 1):
        parts.append(BK.bx(f'rail{sy}', (L * 0.56, 0.05, 0.06), (-3, sy * (W / 2 - 0.6), 6.45), grey, uv=False))
    # 尾部跳板
    ramp = K.box('ramp', (0.25, 6.5, 5.2), (-L / 2 - 0.1, 0, 4.9), grey, bevel=0.05)
    parts.append(ramp)
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
    return roots
