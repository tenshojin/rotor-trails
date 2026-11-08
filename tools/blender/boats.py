# 船：近海渔船（日本、峡湾共用）。照 MOSS-Image 生成的参考图 art/src/ref/vehicles/fish_s31.png、fish_s32.png 建：
# 船首高高翘起、往外飘，白色船身配浅蓝色船底，两道护舷条，驾驶室在船中偏后（带框的窗、侧门、顶棚），
# 桅杆上有横桁、航行灯、雷达罩、天线和吊着的橙色浮球；后甲板堆着渔网和缆绳，两舷挂着旧轮胎。
# 船身贴图（白漆、色带、锈迹、船名）由 boat_textures.py 先生成。
#
# 坐标：Blender（船首朝 +X，原点在水线面的船中），和旧的 common_props.fishing_boat 一致（vessels.ts 按 bow: 1 用）。

import math
import random

import bmesh
import bpy
from mathutils import Vector, noise

import bkit as K
import bldkit as BK
import hullkit as HK

F = BK.flat
TEX = 'art/out/tex'


def _mesh(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    return ob


def strip(name, a_pts, b_pts, mat):
    """两条折线之间的一条带子（舷墙内侧）"""
    bm = bmesh.new()
    A = [bm.verts.new(p) for p in a_pts]
    B = [bm.verts.new(p) for p in b_pts]
    for i in range(len(A) - 1):
        bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
    ob = _mesh(name, bm, mat)
    ob.data.polygons.foreach_set('use_smooth', [False] * len(ob.data.polygons))
    return ob


def lumpy(name, center, size, mat, seed=0, amp=0.18, sub=3):
    """一堆软东西（渔网）：压扁的球，表面按噪声起伏"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector((seed * 3.1, seed * 1.7, seed * 0.9))
    for v in bm.verts:
        p = v.co.copy()
        n = noise.noise(p * 2.2 + off) * 0.6 + noise.noise(p * 5.0 + off) * 0.3
        r = 1.0 + amp * n
        v.co = Vector((p.x * size[0] * r, p.y * size[1] * r, max(-0.05, p.z) * size[2] * r)) + Vector(center)
    return _mesh(name, bm, mat)


# 每条船的船底颜色（舷侧的颜色、色带、船名在 boat_textures.py 里）：日本的浅蓝浅绿，挪威的暗红防污漆
BOOT = {'boat_0': 0x5f9ec8, 'boat_1': 0x4f9a78, 'boat_2': 0x6aa6d2, 'boat_3': 0x4a86c0, 'boat_f0': 0x5a2622, 'boat_f1': 0x5a2622, 'boat_f2': 0x24272b}


def fishing_boat(name, hull_hex):
    """近海渔船，船长 13 m、宽 3.6 m。hull_hex：没有登记在 BOOT 里的船用它当船底颜色"""
    hull_hex = BOOT.get(name, hull_hex)
    rng = random.Random(name)
    hull = HK.Hull(L=13.0, B=3.6, T=0.9, fb_aft=1.05, fb_fwd=2.05, rake=2.0, deadrise_aft=14, deadrise_fwd=40, flare=0.28, transom=0.80, entry=0.42)
    white = F('boat_white', 0xe6e8e6, rough=0.45)
    trim = F('boat_trim', 0x2a2d31, rough=0.5)
    glass = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
    steel = F('boat_steel', 0x8c9196, rough=0.4, metal=0.8)
    tyre = F('tyre', 0x141414, rough=0.85)
    rope = F('rope_tan', 0x9a8460, rough=0.9)
    deckm = F('boat_deck', 0x7a6248, rough=0.75)
    orange = F('buoy_orange', 0xe2581c, rough=0.55)
    netm = F('net_green', 0x2c4f44, rough=0.95)
    boot = F(f'boot_{name}', hull_hex, rough=0.5)
    top_m = K.material(f'hull_{name}', 0xffffff, rough=0.45, tex=f'{TEX}/hull_{name}.jpg')
    parts = []
    top, bot = hull.split_mesh('hull', zb=0.12, mat_top=top_m, mat_bot=boot)
    K.fix_normals(top)
    K.fix_normals(bot)
    parts += [top, bot]
    # 方尾：船尾截面封起来
    sec = hull.section(hull.x0, 16)
    pts = [Vector((hull.x0, y, z)) for y, z in sec] + [Vector((hull.x0, -y, z)) for y, z in reversed(sec)]
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-4)
    vs = [v for v in vs if v.is_valid]
    try:
        bm.faces.new(vs[::-1])
    except ValueError:
        pass
    parts.append(_mesh('transom', bm, white))
    # 甲板：舷边往下 0.55 m（舷墙的高度），船首那段甲板跟着往上翘
    BULW = 0.55
    deck = hull.deck('deck', inset=0.06, drop=BULW, mat=deckm, x_from=hull.x0 + 0.04, x_to=hull.bow_s - 0.55)
    parts.append(deck)
    # 舷墙内侧（从甲板到舷边）和顶上的压条
    for side in (1, -1):
        hi = hull.rail_path(side, hull.x0 + 0.04, hull.bow_s - 0.55, up=0.0, inset=0.07, n=36)
        lo = [p - Vector((0, 0, BULW - 0.03)) for p in hull.rail_path(side, hull.x0 + 0.04, hull.bow_s - 0.55, up=0.0, inset=0.09, n=36)]
        parts.append(strip(f'bulw_in{side}', lo, hi, white))
        cap = hull.rail_path(side, hull.x0 + 0.02, hull.bow_s - 0.02, up=0.02, inset=0.02, n=40)
        parts.append(K.tube_path(f'cap{side}', cap, 0.05, trim, seg=6))
        # 两道护舷条：贴着船身外面，跟着舷弧走
        # （下面那道在离船首 3.6 米处停下，不压船名）
        for dz, r, fwd in ((-0.30, 0.045, 1.2), (-0.72, 0.04, 3.6)):
            line = []
            for i in range(41):
                x = hull.x0 + 0.1 + (hull.bow_s - hull.x0 - fwd) * i / 40
                zs = hull.sheer(x)
                z = zs + dz
                zk = hull.keel(x)
                y = hull.y_at(x, z, hull.bow_x(z, zs), zk, zs)
                line.append(Vector((x, side * (y + 0.02), z)))
            parts.append(K.tube_path(f'strake{side}{dz}', line, r, white, seg=6))
    # 船尾的横板（舷墙在船尾封口）
    ys, zs_ = hull.deck_outline(hull.x0 + 0.05, 0.05)
    parts.append(BK.bx('stern_bulw', (0.08, 2 * ys, BULW), (hull.x0 + 0.06, 0, zs_ - BULW / 2 + 0.02), white, uv=False))
    # ---- 驾驶室：船中偏后，前面三扇窗、两侧各两扇、后面一扇，右舷一扇门
    hx, hw_, hl, hh = -1.1, 2.1, 2.6, 1.85
    dz0 = hull.sheer(hx) - BULW
    cab = BK.bx('cab', (hl, hw_, hh), (hx, 0, dz0 + hh / 2), white, uv=False, bevel=0.06)
    parts.append(cab)
    for k, dy in enumerate((-0.62, 0.0, 0.62)):
        parts += BK.window(f'wf{k}', (hx + hl / 2, dy, dz0 + hh - 0.55), 0.5, 0.48, '+X', trim, glass, depth=0.05, frame=0.04, mullion=False)
    for s, face in ((1, '+Y'), (-1, '-Y')):
        for k, dx in enumerate((0.55, -0.15)):
            parts += BK.window(f'ws{s}{k}', (hx + dx, s * hw_ / 2, dz0 + hh - 0.55), 0.5, 0.42, face, trim, glass, depth=0.05, frame=0.04, mullion=False)
    parts += BK.window('wb', (hx - hl / 2, 0.45, dz0 + hh - 0.55), 0.55, 0.42, '-X', trim, glass, depth=0.05, frame=0.04, mullion=False)
    parts.append(BK.wbox('door', (hx, hw_ / 2, dz0), '+Y', -0.65, 0.95, 0.02, 0.62, 0.04, 1.6, F('boat_door', 0xd6d8d6, rough=0.5)))
    parts.append(BK.wbox('door_h', (hx, hw_ / 2, dz0), '+Y', -0.9, 0.95, 0.05, 0.05, 0.05, 0.14, steel))
    # 顶棚：四周挑出一点，前面再多挑出一块遮阳
    roof_z = dz0 + hh
    parts.append(BK.bx('roof', (hl + 0.24, hw_ + 0.2, 0.08), (hx + 0.06, 0, roof_z + 0.04), white, uv=False, bevel=0.03))
    parts.append(BK.bx('visor', (0.32, hw_ + 0.2, 0.05), (hx + hl / 2 + 0.2, 0, roof_z - 0.03), white, uv=False, bevel=0.015))
    # 顶棚上的栏杆
    rz = roof_z + 0.08
    for s in (1, -1):
        parts.append(K.tube_path(f'rrail{s}', [(hx - hl / 2 + 0.05, s * (hw_ / 2), rz + 0.32), (hx + hl / 2 - 0.05, s * (hw_ / 2), rz + 0.32)], 0.02, steel, seg=5))
        for dx in (-hl / 2 + 0.05, 0, hl / 2 - 0.05):
            parts.append(BK.stick(f'rpost{s}{dx}', (hx + dx, s * hw_ / 2, rz), (hx + dx, s * hw_ / 2, rz + 0.32), 0.018, steel, seg=5))
    # 探照灯、雷达罩
    parts.append(BK.cyl('searchlight', 0.11, 0.18, (hx + hl / 2 - 0.25, -0.55, rz + 0.12), steel, 12, rot=(0, math.pi / 2, 0), uv=False))
    parts.append(BK.stick('radar_post', (hx + 0.5, 0, rz), (hx + 0.5, 0, rz + 0.45), 0.04, steel, seg=6))
    parts.append(BK.cyl('radar', 0.32, 0.2, (hx + 0.5, 0, rz + 0.55), F('radar_white', 0xf0f0ec, rough=0.4), 20, uv=False))
    # 桅杆：横桁两头红绿航行灯，顶上白灯；两根鞭状天线；吊着一个橙色浮球
    mx_ = hx - 0.6
    parts.append(BK.stick('mast', (mx_, 0, rz), (mx_, 0, rz + 3.1), 0.06, white, seg=8))
    parts.append(BK.stick('yard', (mx_, -0.7, rz + 2.35), (mx_, 0.7, rz + 2.35), 0.035, white, seg=6))
    parts.append(BK.bx('nav_g', (0.1, 0.08, 0.12), (mx_, 0.72, rz + 2.45), F('nav_green', 0x1e9a46, rough=0.3), uv=False))
    parts.append(BK.bx('nav_r', (0.1, 0.08, 0.12), (mx_, -0.72, rz + 2.45), F('nav_red', 0xb8261e, rough=0.3), uv=False))
    parts.append(BK.cyl('nav_w', 0.06, 0.14, (mx_, 0, rz + 3.18), F('nav_white', 0xf4f2e6, rough=0.2), 10, uv=False))
    parts.append(BK.cyl('beacon', 0.07, 0.12, (mx_ + 0.15, 0, rz + 2.95), F('beacon', 0xe0901c, rough=0.3), 10, uv=False))
    for s in (1, -1):
        parts.append(BK.stick(f'whip{s}', (hx - 0.9, s * 0.8, rz), (hx - 0.95, s * 0.86, rz + 2.6), 0.012, F('antenna', 0xe8e8e4, rough=0.4), seg=4))
    parts.append(K.sphere('buoy_hang', 0.2, (mx_ + 0.35, 0.45, rz + 1.6), orange, 14, 10, scale=(1, 1, 1.35)))
    parts.append(BK.stick('buoy_line', (mx_ + 0.35, 0.45, rz + 1.85), (mx_, 0.5, rz + 2.35), 0.008, rope, seg=4))
    # 支索：桅顶到船首、船尾的细钢索
    bow_dz = hull.sheer(hull.bow_s - 0.7)
    parts.append(BK.stick('stay_f', (mx_, 0, rz + 3.0), (hull.bow_s - 0.8, 0, bow_dz + 0.1), 0.008, steel, seg=4))
    parts.append(BK.stick('stay_a', (mx_, 0, rz + 2.8), (hull.x0 + 0.6, 0, hull.sheer(hull.x0) + 0.4), 0.008, steel, seg=4))
    # ---- 后甲板：一堆渔网（上面点着浮子）、绞网机、缆绳卷、鱼箱
    ax_ = hull.x0 + 2.4
    adz = hull.sheer(ax_) - BULW
    parts.append(lumpy('net', (ax_, 0.1, adz), (1.35, 1.15, 0.55), netm, seed=len(name), amp=0.22))
    for k in range(16):
        a = 2 * math.pi * k / 16 + rng.uniform(-0.15, 0.15)
        r = rng.uniform(0.6, 1.05)
        p = (ax_ + math.cos(a) * r * 1.1, 0.1 + math.sin(a) * r * 0.95, adz + 0.42 * (1 - (r / 1.15) ** 2) + 0.1)
        parts.append(K.sphere(f'float{k}', 0.07, p, orange if k % 3 else white, 8, 6))
    parts.append(BK.cyl('net_drum', 0.42, 1.8, (hull.x0 + 0.75, 0, adz + 0.75), F('drum_blue', 0x2f5f86, rough=0.6), 16, rot=(math.pi / 2, 0, 0), uv=False))
    for s in (1, -1):
        parts.append(BK.bx(f'drum_frame{s}', (0.12, 0.08, 0.85), (hull.x0 + 0.75, s * 0.95, adz + 0.42), steel, uv=False))
    for k in range(3):
        cx = ax_ + 1.6 + (k % 2) * 0.1
        cy = -1.0 + k * 0.32
        for t in range(4):
            parts.append(K.torus(f'coil{k}_{t}', 0.26 - t * 0.01, 0.035, (cx, cy, adz + 0.04 + t * 0.06), rope, 18, 6))
    fish = F('fishbox_blue', 0x2f6fb0, rough=0.5)
    for k, (dx, dy, dz) in enumerate(((0, 0, 0), (0, 0.45, 0), (0.05, 0.2, 0.26))):
        parts.append(BK.bx(f'fbox{k}', (0.62, 0.42, 0.24), (hx - hl / 2 - 0.6 + dx, -0.6 + dy, dz0 + 0.12 + dz), fish, uv=False, bevel=0.02))
    # ---- 船首：缆桩、锚机，几个浮球
    fx = hull.bow_s - 2.6
    fdz = hull.sheer(fx) - BULW
    parts.append(BK.cyl('windlass', 0.18, 0.5, (fx, 0, fdz + 0.25), steel, 14, rot=(math.pi / 2, 0, 0), uv=False))
    parts.append(BK.cyl('bitt', 0.08, 0.35, (fx + 0.8, 0, hull.sheer(fx + 0.8) - BULW + 0.17), steel, 10, uv=False))
    for k in range(4):
        parts.append(K.sphere(f'buoy{k}', 0.22, (fx - 0.8 - k * 0.45, rng.uniform(-0.8, 0.8), fdz + 0.22), orange, 12, 8))
    # ---- 两舷挂的旧轮胎（护舷），用绳子吊在舷边
    for s in (1, -1):
        for k, x in enumerate((-3.6, -1.0, 1.6)):
            ys, zsd = hull.deck_outline(x, 0.0)
            zc = zsd - 0.55
            zk = hull.keel(x)
            yh = hull.y_at(x, zc, hull.bow_x(zc, hull.sheer(x)), zk, hull.sheer(x))
            parts.append(K.torus(f'tyre{s}{k}', 0.28, 0.1, (x, s * (yh + 0.12), zc), tyre, 16, 8, rot=(math.pi / 2, 0, 0)))
            parts.append(BK.stick(f'tline{s}{k}', (x, s * (yh + 0.12), zc + 0.36), (x, s * (ys - 0.03), zsd + 0.02), 0.012, rope, seg=4))
    return BK.model(name, parts)[0]


# ------------------------------------------------------------------ 小工具
def railing(name, pts, h, m, post_every=1.5, r=0.024):
    """沿折线的栏杆：一根扶手、一根中间横杆、一排立柱"""
    pts = [Vector(p) for p in pts]
    up = Vector((0, 0, 1))
    parts = [K.tube_path(name + '_t', [p + up * h for p in pts], r, m, seg=5),
             K.tube_path(name + '_m', [p + up * (h * 0.5) for p in pts], r * 0.8, m, seg=5)]
    segs = list(zip(pts, pts[1:]))
    total = sum((b - a).length for a, b in segs)
    n = max(2, int(total / post_every))
    for k in range(n + 1):
        d = total * k / n
        acc = 0.0
        p = pts[-1]
        for a, b in segs:
            L = (b - a).length
            if acc + L >= d - 1e-6:
                p = a + (b - a) * ((d - acc) / max(L, 1e-6))
                break
            acc += L
        parts.append(BK.stick(f'{name}_p{k}', tuple(p), tuple(p + up * h), r, m, seg=4))
    return parts


def ellipse_prism(name, cx, cy, rx, ry, z0, z1, m, n=28):
    pts = [(cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]
    return K.prism(name, pts, z0, z1, m, smooth=40)


# ------------------------------------------------------------------ 车客渡轮
def ferry(name, hull_hex=0x223c6e, band_hex=0xb2261e):
    """小型车客渡轮，船长 46 m、宽 11 m，船首朝 +X。照 MOSS-Image 参考图 art/src/ref/vehicles/ferry_s33.png 建：
    藏青（峡湾那条是黑色）船身配一道色带，白色客舱一排窗，上面是开放甲板和栏杆，驾驶台在前部带两翼，
    烟囱在后部，两条橙色救生艇，船尾竖着跳板。船身贴图（色带、船名）由 boat_textures.py 生成。"""
    key = 'ferry_no' if hull_hex == 0x1d2024 else 'ferry_jp'
    hull = HK.Hull(L=46.0, B=11.0, T=2.0, fb_aft=3.3, fb_fwd=4.5, rake=4.2, deadrise_aft=6, deadrise_fwd=30, flare=0.55, transom=0.96, entry=0.33)
    white = F('ferry_white', 0xeceeec, rough=0.42)
    anti = F('ferry_antifoul', 0x6e2a22, rough=0.6)
    glass = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
    grey = F('ferry_grey', 0x6c7178, rough=0.55, metal=0.2)
    deckc = F('ferry_deck', 0x7a7f7c, rough=0.75)
    deck_green = F('ferry_deck_green', 0x4e6e5a, rough=0.8)
    hullc = F('ferry_hullc', hull_hex, rough=0.4)
    black = F('ferry_black', 0x17181a, rough=0.5)
    red = F('ferry_band', band_hex, rough=0.45)
    navy = F('ferry_funnel_blue', 0x1f3d7a, rough=0.45)
    orange = F('lifeboat', 0xe8701e, rough=0.45)
    steel = F('ferry_steel', 0x9aa0a6, rough=0.4, metal=0.7)
    top_m = K.material(f'hull_{key}', 0xffffff, rough=0.42, tex=f'{TEX}/hull_{key}.jpg')
    parts = []
    top, bot = hull.split_mesh('fhull', zb=0.25, nx=64, nb=5, nt=12, mat_top=top_m, mat_bot=anti)
    K.fix_normals(top)
    K.fix_normals(bot)
    parts += [top, bot]
    # 方尾（船身颜色）
    sec = hull.section(hull.x0, 16)
    bm = bmesh.new()
    vs = [bm.verts.new((hull.x0, y, z)) for y, z in sec] + [bm.verts.new((hull.x0, -y, z)) for y, z in reversed(sec)]
    bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-4)
    vs = [v for v in vs if v.is_valid]
    try:
        bm.faces.new(vs[::-1])
    except ValueError:
        pass
    parts.append(_mesh('ftransom', bm, hullc))
    # 主甲板：在舷边那一圈
    parts.append(hull.deck('fdeck', inset=0.08, drop=0.02, nx=48, mat=deck_green))
    # 舷边一圈护栏（前甲板、两舷走道）和一道灰色护舷材
    for s in (1, -1):
        parts += railing(f'frail{s}', hull.rail_path(s, hull.x0 + 0.3, hull.bow_s - 0.6, up=0.0, inset=0.15, n=40), 1.0, white, post_every=1.8)
        line = []
        for i in range(41):
            x = hull.x0 + 0.2 + (hull.bow_s - hull.x0 - 3.0) * i / 40
            zs = hull.sheer(x)
            z = zs - 0.55
            y = hull.y_at(x, z, hull.bow_x(z, zs), hull.keel(x), zs)
            line.append(Vector((x, s * (y + 0.06), z)))
        parts.append(K.tube_path(f'frub{s}', line, 0.12, grey, seg=6))
    # ---- 客舱：白色，两舷一排窗，前端收窄
    z0, z1 = 3.15, 6.5
    outline = [(-20.5, -4.85), (11.0, -4.85), (13.6, -4.0), (14.9, -2.4), (15.3, 0.0), (14.9, 2.4), (13.6, 4.0), (11.0, 4.85), (-20.5, 4.85)]
    parts.append(K.prism('saloon', outline, z0, z1, white, smooth=30))
    parts.append(K.prism('saloon_roof', [(x, y * 1.03) for x, y in outline], z1, z1 + 0.18, deckc, smooth=30))
    for s, face in ((1, '+Y'), (-1, '-Y')):
        for k in range(15):
            x = -17.2 + k * 1.95
            parts += BK.window(f'sw{s}{k}', (x, s * 4.85, 4.75), 1.15, 0.72, face, black, glass, depth=0.05, frame=0.05, mullion=False)
        parts.append(BK.wbox(f'sdoor{s}', (-19.4, s * 4.85, z0), face, 0.0, 1.3, 0.02, 0.9, 0.05, 2.0, F('ferry_door', 0xd8dad8, rough=0.5)))
    for k, y in enumerate((-1.6, -0.55, 0.55, 1.6)):
        parts += BK.window(f'swf{k}', (15.0, y, 4.75), 0.85, 0.72, '+X', black, glass, depth=0.05, frame=0.05, mullion=False)
    # 顶层开放甲板的栏杆
    rail_pts = [(x, y * 1.03, z1 + 0.18) for x, y in outline]
    parts += railing('deckrail', rail_pts, 1.05, white, post_every=1.6)
    # ---- 驾驶台：前部再高一层，前窗一排，两翼伸到船宽
    bx0, bx1, by = 10.4, 14.2, 4.2
    bz = z1 + 0.18
    parts.append(BK.bx('bridge', (bx1 - bx0, 2 * by, 2.75), ((bx0 + bx1) / 2, 0, bz + 1.375), white, uv=False, bevel=0.08))
    for k, y in enumerate((-3.2, -1.6, 0.0, 1.6, 3.2)):
        parts += BK.window(f'bwf{k}', (bx1, y, bz + 1.75), 1.35, 1.0, '+X', black, glass, depth=0.06, frame=0.05, mullion=False)
    for s, face in ((1, '+Y'), (-1, '-Y')):
        for k, x in enumerate((bx1 - 0.9, bx0 + 1.0)):
            parts += BK.window(f'bws{s}{k}', (x, s * by, bz + 1.75), 1.0, 0.9, face, black, glass, depth=0.06, frame=0.05, mullion=False)
        wy0, wy1 = by, 5.45
        parts.append(BK.bx(f'wing{s}', (2.2, wy1 - wy0, 0.12), (bx1 - 1.1, s * (wy0 + wy1) / 2, bz + 1.0), white, uv=False))
        parts += railing(f'wingrail{s}', [(bx1 - 2.2, s * wy1, bz + 1.06), (bx1, s * wy1, bz + 1.06), (bx1, s * wy0, bz + 1.06)], 1.0, white, post_every=1.0)
    broof = bz + 2.75
    parts.append(BK.bx('bridge_roof', (bx1 - bx0 + 0.5, 2 * by + 0.4, 0.14), ((bx0 + bx1) / 2 + 0.15, 0, broof + 0.07), white, uv=False, bevel=0.03))
    # 桅杆：雷达、航行灯、天线
    mx_ = (bx0 + bx1) / 2 - 0.4
    parts.append(BK.stick('fmast', (mx_, 0, broof), (mx_, 0, broof + 4.2), 0.12, white, seg=8))
    parts.append(BK.bx('fyard', (0.3, 2.6, 0.12), (mx_, 0, broof + 2.6), white, uv=False))
    parts.append(BK.bx('radar_bar', (0.25, 2.8, 0.18), (mx_ + 0.4, 0, broof + 1.4), black, uv=False))
    parts.append(BK.cyl('radar_base', 0.25, 0.35, (mx_ + 0.4, 0, broof + 1.15), white, 12, uv=False))
    parts.append(BK.cyl('fnav_w', 0.12, 0.25, (mx_, 0, broof + 4.35), F('nav_white', 0xf4f2e6, rough=0.2), 10, uv=False))
    parts.append(BK.bx('fnav_g', (0.2, 0.15, 0.22), (bx1 - 0.6, 5.5, bz + 1.6), F('nav_green', 0x1e9a46, rough=0.3), uv=False))
    parts.append(BK.bx('fnav_r', (0.2, 0.15, 0.22), (bx1 - 0.6, -5.5, bz + 1.6), F('nav_red', 0xb8261e, rough=0.3), uv=False))
    for s in (1, -1):
        parts.append(BK.stick(f'fwhip{s}', (bx0 + 0.6, s * 3.0, broof), (bx0 + 0.5, s * 3.2, broof + 3.0), 0.025, white, seg=4))
    # ---- 烟囱：椭圆截面，从上往下黑、红、蓝三道
    fx = -12.4
    zf0, zf1 = bz, z1 + 4.6
    parts.append(ellipse_prism('funnel', fx, 0, 1.9, 1.15, zf0, zf1 - 1.6, white))
    parts.append(ellipse_prism('funnel_blue', fx, 0, 1.92, 1.17, zf1 - 1.6, zf1 - 1.25, navy))
    parts.append(ellipse_prism('funnel_red', fx, 0, 1.92, 1.17, zf1 - 1.25, zf1 - 0.5, red))
    parts.append(ellipse_prism('funnel_black', fx, 0, 1.92, 1.17, zf1 - 0.5, zf1, black))
    for s in (1, -1):
        parts.append(BK.cyl(f'exhaust{s}', 0.22, 0.6, (fx - 0.4, s * 0.45, zf1 + 0.3), black, 10, uv=False))
    # ---- 救生艇：两舷各一条，吊在艇架上；甲板边上一排救生筏筒
    for s in (1, -1):
        cy = s * 4.1
        parts.append(K.sphere(f'lifeboat{s}', 1.0, (4.6, cy, z1 + 1.35), orange, 20, 12, scale=(3.0, 1.05, 0.62)))
        parts.append(K.sphere(f'lb_top{s}', 1.0, (4.6, cy, z1 + 1.62), F('lb_canopy', 0xf2f2ee, rough=0.5), 20, 10, scale=(2.6, 0.9, 0.45)))
        for dx in (2.3, 6.9):
            parts.append(BK.stick(f'davit{s}{dx}', (dx, s * 4.7, bz), (dx, s * 4.4, z1 + 2.6), 0.1, white, seg=6))
            parts.append(BK.stick(f'davith{s}{dx}', (dx, s * 4.4, z1 + 2.6), (dx, cy * 0.92, z1 + 2.5), 0.08, white, seg=6))
        for k in range(5):
            parts.append(BK.cyl(f'raft{s}{k}', 0.32, 1.25, (-6.0 - k * 1.45, s * 4.55, z1 + 0.62), F('raft_white', 0xe9eae6, rough=0.45), 12, rot=(0, math.pi / 2, 0), uv=False))
    # ---- 船尾跳板：竖起来的钢板，两边的吊柱
    ramp_z = hull.sheer(hull.x0)
    parts.append(BK.bx('ramp', (0.4, 7.2, 5.0), (hull.x0 - 0.35, 0, ramp_z + 2.45), hullc, uv=False, bevel=0.05))
    for k in range(6):
        parts.append(BK.bx(f'ramp_rib{k}', (0.12, 7.0, 0.14), (hull.x0 - 0.6, 0, ramp_z + 0.5 + k * 0.8), black, uv=False))
    for s in (1, -1):
        parts.append(BK.bx(f'ramp_post{s}', (0.7, 0.7, 6.4), (hull.x0 + 0.6, s * 4.3, ramp_z + 3.2), white, uv=False, bevel=0.05))
        parts.append(BK.stick(f'ramp_wire{s}', (hull.x0 + 0.4, s * 4.0, ramp_z + 6.2), (hull.x0 - 0.5, s * 3.4, ramp_z + 4.8), 0.03, steel, seg=4))
    # ---- 前甲板：锚机、缆桩、旗杆
    fdz = hull.sheer(18.0)
    for s in (1, -1):
        parts.append(BK.cyl(f'windlass{s}', 0.45, 0.8, (18.0, s * 1.4, fdz + 0.5), grey, 14, rot=(math.pi / 2, 0, 0), uv=False))
        for k in range(3):
            x = -4.0 + k * 12.0
            parts.append(BK.cyl(f'bollard{s}{k}', 0.18, 0.5, (x, s * 5.0, hull.sheer(x) + 0.25), black, 10, uv=False))
    jx = hull.bow_s - 0.8
    parts.append(BK.stick('jackstaff', (jx, 0, hull.sheer(jx)), (jx, 0, hull.sheer(jx) + 2.2), 0.05, white, seg=5))
    return BK.model(name, parts)[0]


# ------------------------------------------------------------------ 亚马孙河船
def hammock(name, a, b, sag, width, colors, rng):
    """一张吊床：两头挂在立柱上，中间往下垂，彩色条纹（每条一种颜色，拼成一张）"""
    parts = []
    a, b = Vector(a), Vector(b)
    ax = (b - a)
    side = ax.cross(Vector((0, 0, 1))).normalized()
    n = 10
    k = len(colors)
    for c_i, col in enumerate(colors):
        bm = bmesh.new()
        rows = []
        for i in range(n + 1):
            t = i / n
            p = a + ax * t
            drop = sag * (1 - (2 * t - 1) ** 2)
            w = width * (0.25 + 0.75 * math.sin(math.pi * t))
            lo = -w / 2 + w * c_i / k
            hi = -w / 2 + w * (c_i + 1) / k
            # 布兜成弧：两边比中间高一点
            def z_at(s):
                return p.z - drop + 0.12 * (2 * s / max(w, 1e-3)) ** 2 * w
            rows.append([bm.verts.new(p + side * lo + Vector((0, 0, z_at(lo) - p.z))), bm.verts.new(p + side * hi + Vector((0, 0, z_at(hi) - p.z)))])
        for r0, r1 in zip(rows, rows[1:]):
            bm.faces.new((r0[0], r1[0], r1[1], r0[1]))
        ob = _mesh(f'{name}_{c_i}', bm, col)
        ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
        parts.append(ob)
    return parts


def river_boat(name='river_boat'):
    """亚马孙河上的客船（recreio），船长 26 m、宽 6.8 m。照 MOSS-Image 参考图 art/src/ref/vehicles/river_s38.png、
    river_s39.png 建：白漆木板船身、两道蓝色护舷条；下层白色木板客舱一排小窗；上层开敞的客舱甲板，白栏杆、立柱、
    挂满彩色吊床；平顶；前部顶上一个小驾驶室和旗杆。船身贴图由 boat_textures.py 生成。
    旧模型船头朝 -X（amazon.ts 的 vessels 没写 bow，按 -1 用），这里建好后整体转 180°。"""
    rng = random.Random(name)
    hull = HK.Hull(L=26.0, B=6.8, T=1.0, fb_aft=1.55, fb_fwd=2.35, rake=1.2, deadrise_aft=8, deadrise_fwd=26, flare=0.22, transom=0.84, entry=0.30)
    white = F('rb_white', 0xe6e4da, rough=0.6)
    blue = F('rb_blue', 0x2a74b0, rough=0.5)
    sky = F('rb_roof', 0xd8dee0, rough=0.6)
    plank = F('rb_plank', 0x8a7458, rough=0.8)
    glass = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
    red = F('rb_red', 0x6a2e24, rough=0.6)
    tyre = F('tyre', 0x141414, rough=0.85)
    orange = F('lifering', 0xe0601c, rough=0.5)
    yellow = F('rb_wheel', 0xd8a830, rough=0.5)
    top_m = K.material('hull_river_boat', 0xffffff, rough=0.6, tex=f'{TEX}/hull_river_boat.jpg')
    parts = []
    top, bot = hull.split_mesh('rhull', zb=0.15, nx=60, nb=5, nt=12, mat_top=top_m, mat_bot=red)
    K.fix_normals(top)
    K.fix_normals(bot)
    parts += [top, bot]
    sec = hull.section(hull.x0, 16)
    bm = bmesh.new()
    vs = [bm.verts.new((hull.x0, y, z)) for y, z in sec] + [bm.verts.new((hull.x0, -y, z)) for y, z in reversed(sec)]
    bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-4)
    vs = [v for v in vs if v.is_valid]
    try:
        bm.faces.new(vs[::-1])
    except ValueError:
        pass
    parts.append(_mesh('rtransom', bm, white))
    # 甲板、两道蓝色护舷条、舷边的压条
    parts.append(hull.deck('rdeck', inset=0.06, drop=0.32, nx=50, mat=plank))
    for s in (1, -1):
        parts.append(K.tube_path(f'rcap{s}', hull.rail_path(s, hull.x0 + 0.05, hull.bow_s - 0.1, up=0.02, inset=0.0, n=44), 0.06, blue, seg=6))
        line = []
        for i in range(41):
            x = hull.x0 + 0.1 + (hull.bow_s - hull.x0 - 0.6) * i / 40
            zs = hull.sheer(x)
            z = zs - 0.6
            y = hull.y_at(x, z, hull.bow_x(z, zs), hull.keel(x), zs)
            line.append(Vector((x, s * (y + 0.03), z)))
        parts.append(K.tube_path(f'rrub{s}', line, 0.055, blue, seg=6))
    deck_z = hull.sheer(0.0) - 0.32
    # ---- 下层客舱：白色木板墙，一排小窗，中间两扇门，顶上一道蓝边
    x0, x1, hw = -10.5, 8.8, 2.9
    wall_h = 2.15
    parts.append(BK.bx('lower_cabin', (x1 - x0, 2 * hw, wall_h), ((x0 + x1) / 2, 0, deck_z + wall_h / 2), white, uv=False))
    parts.append(BK.bx('lower_trim', (x1 - x0 + 0.06, 2 * hw + 0.06, 0.12), ((x0 + x1) / 2, 0, deck_z + wall_h - 0.06), blue, uv=False))
    for s, face in ((1, '+Y'), (-1, '-Y')):
        for k in range(10):
            x = x0 + 1.2 + k * 1.85
            if abs(x - 0.0) < 0.9:
                parts.append(BK.wbox(f'rdoor{s}', (x, s * hw, deck_z), face, 0.0, 0.95, 0.02, 0.8, 0.04, 1.85, F('rb_door', 0x6a5a48, rough=0.7)))
                continue
            parts += BK.window(f'rw{s}{k}', (x, s * hw, deck_z + 1.35), 0.55, 0.42, face, white, glass, depth=0.04, frame=0.04, mullion=False)
        parts.append(K.torus(f'ring_low{s}', 0.28, 0.06, (x0 + 6.5, s * (hw + 0.07), deck_z + 1.3), orange, 18, 8, rot=(math.pi / 2, 0, 0)))
    # 前后两头的墙（朝前、朝后）
    parts += BK.window('rwf', (x1, -0.9, deck_z + 1.35), 0.6, 0.45, '+X', white, glass, depth=0.04, frame=0.04, mullion=False)
    parts += BK.window('rwf2', (x1, 0.9, deck_z + 1.35), 0.6, 0.45, '+X', white, glass, depth=0.04, frame=0.04, mullion=False)
    # ---- 上层甲板：地板伸到舷边，立柱撑着平顶，四周白栏杆，柱子之间挂吊床
    up_z = deck_z + wall_h + 0.05
    uhw = 3.2
    ux0, ux1 = -11.0, 9.3
    parts.append(BK.bx('upper_floor', (ux1 - ux0, 2 * uhw, 0.12), ((ux0 + ux1) / 2, 0, up_z + 0.06), plank, uv=False))
    parts.append(BK.bx('upper_edge', (ux1 - ux0 + 0.05, 2 * uhw + 0.05, 0.1), ((ux0 + ux1) / 2, 0, up_z - 0.02), blue, uv=False))
    roof_z = up_z + 2.35
    posts_x = [ux0 + 0.3 + k * 2.25 for k in range(10)]
    for s in (1, -1):
        for x in posts_x:
            parts.append(BK.bx(f'post{s}{x:.1f}', (0.12, 0.12, roof_z - up_z), (x, s * (uhw - 0.1), (up_z + roof_z) / 2), white, uv=False))
        parts += railing(f'urail{s}', [(ux0 + 0.1, s * (uhw - 0.08), up_z + 0.12), (ux1 - 0.1, s * (uhw - 0.08), up_z + 0.12)], 0.95, white, post_every=1.1)
    parts += railing('urail_f', [(ux1 - 0.1, -(uhw - 0.08), up_z + 0.12), (ux1 - 0.1, uhw - 0.08, up_z + 0.12)], 0.95, white, post_every=1.1)
    parts += railing('urail_a', [(ux0 + 0.1, -(uhw - 0.08), up_z + 0.12), (ux0 + 0.1, uhw - 0.08, up_z + 0.12)], 0.95, white, post_every=1.1)
    parts.append(BK.bx('roof', (ux1 - ux0 + 0.6, 2 * uhw + 0.5, 0.12), ((ux0 + ux1) / 2, 0, roof_z + 0.06), sky, uv=False))
    parts.append(BK.bx('roof_edge', (ux1 - ux0 + 0.62, 2 * uhw + 0.52, 0.08), ((ux0 + ux1) / 2, 0, roof_z), blue, uv=False))
    # 吊床：横着挂在两舷的柱子之间、也顺着船挂在相邻的柱子之间
    pal = [F('hm_red', 0xc0302a, rough=0.9), F('hm_yellow', 0xe0b030, rough=0.9), F('hm_green', 0x2e8a4a, rough=0.9),
           F('hm_blue', 0x2a5aa8, rough=0.9), F('hm_orange', 0xe07030, rough=0.9), F('hm_purple', 0x7a3a8a, rough=0.9)]
    for k in range(len(posts_x) - 1):
        for s in (1, -1):
            if rng.random() < 0.75:
                xa, xb = posts_x[k] + 0.1, posts_x[k + 1] - 0.1
                cols = [pal[(k + j + (s > 0)) % len(pal)] for j in range(3)]
                parts += hammock(f'hm{k}{s}', (xa, s * (uhw - 0.35 - rng.uniform(0, 0.6)), roof_z - 0.25), (xb, s * (uhw - 0.5 - rng.uniform(0, 0.6)), roof_z - 0.35),
                                 rng.uniform(0.75, 1.0), 0.75, cols, rng)
    # ---- 顶上前部的小驾驶室、旗杆、舵轮装饰
    wx0, wx1, ww = 5.6, 8.4, 1.5
    wh = 1.75
    parts.append(BK.bx('wheelhouse', (wx1 - wx0, 2 * ww, wh), ((wx0 + wx1) / 2, 0, roof_z + 0.12 + wh / 2), white, uv=False))
    parts.append(BK.bx('wh_roof', (wx1 - wx0 + 0.3, 2 * ww + 0.3, 0.1), ((wx0 + wx1) / 2, 0, roof_z + 0.12 + wh + 0.05), sky, uv=False))
    for k, y in enumerate((-0.75, 0.0, 0.75)):
        parts += BK.window(f'whf{k}', (wx1, y, roof_z + 0.12 + wh - 0.6), 0.55, 0.5, '+X', blue, glass, depth=0.04, frame=0.04, mullion=False)
    for s, face in ((1, '+Y'), (-1, '-Y')):
        parts += BK.window(f'whs{s}', ((wx0 + wx1) / 2, s * ww, roof_z + 0.12 + wh - 0.6), 0.8, 0.5, face, blue, glass, depth=0.04, frame=0.04, mullion=False)
    parts.append(K.torus('wheel_ring', 0.55, 0.05, (wx0 + 0.6, 0, roof_z + 0.12 + wh + 0.7), yellow, 24, 8, rot=(math.pi / 2, 0, 0)))
    for k in range(8):
        a = math.pi * k / 8
        parts.append(BK.stick(f'wheel_spoke{k}', (wx0 + 0.6, -math.cos(a) * 0.68, roof_z + 0.12 + wh + 0.7 + math.sin(a) * 0.68),
                              (wx0 + 0.6, math.cos(a) * 0.68, roof_z + 0.12 + wh + 0.7 - math.sin(a) * 0.68), 0.03, yellow, seg=5))
    fx = wx0 - 0.4
    parts.append(BK.stick('flagpole', (fx, 0, roof_z + 0.12 + wh), (fx, 0, roof_z + 0.12 + wh + 2.4), 0.04, F('rb_pole', 0x8a6a40, rough=0.7), seg=6))
    for k, c in enumerate((0x2a8a3a, 0xe8c030, 0x2a4aa0)):
        parts.append(BK.bx(f'flag{k}', (0.9, 0.02, 0.18), (fx - 0.47, 0, roof_z + 0.12 + wh + 2.25 - k * 0.18), F(f'rb_flag{k}', c, rough=0.8), uv=False))
    # ---- 船头：挂着的旧轮胎、缆桩；栏杆上的救生圈
    for s in (1, -1):
        bx_ = hull.bow_s - 2.2
        ys, zs = hull.deck_outline(bx_, 0.0)
        z = zs - 0.5
        y = hull.y_at(bx_, z, hull.bow_x(z, hull.sheer(bx_)), hull.keel(bx_), hull.sheer(bx_))
        parts.append(K.torus(f'rtyre{s}', 0.3, 0.1, (bx_, s * (y + 0.12), z), tyre, 16, 8, rot=(math.pi / 2, 0, 0)))
        parts.append(K.torus(f'ring_up{s}', 0.28, 0.06, (ux0 + 7.0, s * (uhw + 0.02), up_z + 0.8), orange, 18, 8, rot=(math.pi / 2, 0, 0)))
    parts.append(BK.cyl('rbitt', 0.12, 0.45, (hull.bow_s - 1.2, 0, hull.sheer(hull.bow_s - 1.2) - 0.1), F('ferry_black', 0x17181a, rough=0.5), 10, uv=False))
    root, outs = BK.model(name, parts)
    # 船头朝 -X（和旧模型一致）
    from mathutils import Matrix
    R = Matrix.Rotation(math.pi, 4, 'Z')
    for o in outs:
        o.data.transform(R)
        o.data.update()
    return root
