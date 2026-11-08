# 各地图共用的小型设施模型：拱顶机库、集装箱、储油罐。每张地图的 props_<地图>.py 都把它们导出到自己的模型库里，
# src/world/props/common.ts 用 beginModel 放置（模型缺失时退回程序几何体）。

import math

import bkit as K
import bldkit as BK

M = BK.mat
F = BK.flat


def hangar(name, wall='corr_white', W=24.0, L=30.0, H=9.0):
    """拱顶机库：瓦楞钢板的半圆拱顶、混凝土墙裙、正面（+Y）四扇推拉门与高窗。"""
    parts = []
    rise = W * 0.28
    iron = M(wall)
    trim = F('hangar_trim', 0x3d4147, rough=0.55)
    door = F('hangar_door', 0x8c9196, rough=0.5, metal=0.3)
    for sx in (-1, 1):
        parts.append(BK.bx(f'side{sx}', (0.3, L, H), (sx * W / 2, 0, H / 2), iron))
    parts.append(BK.bx('back', (W, 0.3, H), (0, -L / 2, H / 2), iron))
    parts.append(BK.bx('plinth', (W + 0.3, L + 0.3, 1.1), (0, 0, 0.55), M('concrete')))
    # 拱顶（圆弧截面沿 Y 拉伸，UV 按弧长展开）
    n = 22
    verts, faces = [], []
    arc = 0.0
    pts = []
    for i in range(n + 1):
        t = math.pi * i / n
        pts.append((-math.cos(t) * (W / 2 + 0.3), H - 0.1 + math.sin(t) * rise))
    for i, (x, z) in enumerate(pts):
        verts += [(x, -L / 2 - 0.5, z), (x, L / 2 + 0.5, z)]
        if i:
            a = (i - 1) * 2
            faces.append((a, a + 2, a + 3, a + 1))
    roof = K.mesh_obj('roof', verts, faces, iron, smooth=None)
    K.fix_normals(roof)
    tile = BK.tile_of(roof)
    uv = K.uv_layer(roof)
    me = roof.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            k = math.atan2(v.z - (H - 0.1), -v.x) * (W / 2)
            uv.data[li].uv = (v.y / tile, k / tile)
    K.add_solidify(roof, 0.14, 0)
    K.apply_mods(roof)
    K.shade(roof, 50)
    parts.append(roof)
    # 山墙（圆弧 + 直边）
    outline = [(-W / 2, H)] + [(-math.cos(math.pi * i / n) * W / 2, H - 0.1 + math.sin(math.pi * i / n) * rise) for i in range(1, n)] + [(W / 2, H)]
    for nm, y in (('gable_f', L / 2 - 0.15), ('gable_b', -L / 2 + 0.15)):
        g = K.prism(nm, outline, y - 0.15, y + 0.15, iron, axis='Y', smooth=0)
        BK.uv_world(g)
        parts.append(g)
    # 正面：四扇推拉门 + 上方的导轨与高窗
    dw = W / 4
    for i in range(4):
        x = -W / 2 + dw * (i + 0.5)
        parts.append(BK.bx(f'door{i}', (dw - 0.1, 0.12, H - 1.7), (x, L / 2 + 0.06, (H - 1.7) / 2 + 0.1), door, uv=False))
        for k in range(1, 5):
            parts.append(BK.bx(f'rib{i}_{k}', (dw - 0.1, 0.03, 0.05), (x, L / 2 + 0.135, k * (H - 1.7) / 5 + 0.1), trim, uv=False))
    parts.append(BK.bx('rail', (W + 0.4, 0.3, 0.35), (0, L / 2 + 0.2, H - 1.4), trim, uv=False))
    glass = F('hangar_glass', 0x2a3540, rough=0.15, metal=0.4)
    for i in range(6):
        parts.append(BK.bx(f'win{i}', (2.6, 0.06, 1.1), (-W / 2 + 2.2 + i * (W - 4.4) / 5, L / 2 + 0.03, H + rise * 0.36), glass, uv=False))
    # 骨架露在外面：一榀榀拱肋压着屋面，下到墙上是壁柱；一段一段的侧窗、屋脊上的通风帽
    bays = 6
    for i in range(bays + 1):
        y = -L / 2 + 0.1 + (L - 0.2) * i / bays
        arc = [(-math.cos(math.pi * k / n) * (W / 2 + 0.46), y, H - 0.1 + math.sin(math.pi * k / n) * (rise + 0.16)) for k in range(n + 1)]
        parts.append(K.tube_path(f'arch{i}', arc, 0.1, trim, seg=5))
        for sx in (-1, 1):
            parts.append(BK.bx(f'pier{i}{sx}', (0.24, 0.34, H - 1.0), (sx * (W / 2 + 0.26), y, 1.1 + (H - 1.1) / 2), trim, uv=False))
    for i in range(bays):
        y = -L / 2 + (L / bays) * (i + 0.5)
        for sx in (-1, 1):
            parts.append(BK.bx(f'swin{i}{sx}', (0.08, L / bays - 1.5, 1.05), (sx * (W / 2 + 0.17), y, H - 1.5), glass, uv=False))
            parts.append(BK.bx(f'sill{i}{sx}', (0.16, L / bays - 1.3, 0.09), (sx * (W / 2 + 0.2), y, H - 2.08), door, uv=False))
    for y in (-L * 0.3, 0.0, L * 0.3):
        parts.append(BK.cyl(f'vent{y}', 0.5, 0.7, (0, y, H + rise + 0.4), door, 12, uv=False))
        parts.append(BK.cyl(f'vent_cap{y}', 0.72, 0.16, (0, y, H + rise + 0.92), trim, 12, r2=0.3, uv=False))
    # 侧门、雨棚、落水管
    parts.append(BK.bx('side_door', (0.1, 1.2, 2.25), (W / 2 + 0.2, -L / 4, 2.2), door, uv=False))
    parts.append(BK.bx('side_canopy', (1.1, 1.9, 0.1), (W / 2 + 0.7, -L / 4, 3.5), trim, uv=False))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(BK.cyl(f'pipe{sx}{sy}', 0.07, H - 0.2, (sx * (W / 2 + 0.42), sy * (L / 2 - 0.5), H / 2), trim, 8, uv=False))
    # 背面的百叶
    for k in range(5):
        parts.append(BK.bx(f'louvre{k}', (3.2, 0.1, 0.1), (0, -L / 2 - 0.02, H + rise * 0.15 + k * 0.3), trim, uv=False))
    return BK.model(name, parts)[0]


def container(name, wall):
    """20 英尺集装箱：瓦楞侧板、角柱、门端的锁杆。原点在底面中心，长边沿 Y。"""
    parts = []
    L, W, H = 6.06, 2.44, 2.6
    parts.append(BK.bx('box', (W, L, H), (0, 0, H / 2), M(wall)))
    frame = F('box_frame', 0x34373b, rough=0.6, metal=0.2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(BK.bx(f'post{sx}{sy}', (0.14, 0.14, H), (sx * (W / 2 - 0.05), sy * (L / 2 - 0.05), H / 2), frame, uv=False))
        parts.append(BK.bx(f'rail_t{sx}', (0.12, L, 0.12), (sx * (W / 2 - 0.04), 0, H - 0.06), frame, uv=False))
        parts.append(BK.bx(f'rail_b{sx}', (0.12, L, 0.14), (sx * (W / 2 - 0.04), 0, 0.07), frame, uv=False))
    for k in (-0.75, -0.3, 0.3, 0.75):
        parts.append(K.cylinder(f'bar{k}', 0.025, H - 0.3, (k, L / 2 + 0.03, H / 2), frame, 6))
    return BK.model(name, parts)[0]


def tank(name):
    """储油罐：涂白的钢罐、一道道环缝、锥形顶、外面绕一圈爬梯和顶上的栏杆。r = 5、h = 8（游戏里按参数缩放）。"""
    parts = []
    r, h = 5.0, 8.0
    white = F('tank_white', 0xdedfd8, rough=0.45, metal=0.2)
    grey = F('tank_grey', 0x70757a, rough=0.5, metal=0.4)
    parts.append(BK.cyl('base', r + 0.6, 0.4, (0, 0, 0.2), M('concrete'), 32))
    parts.append(BK.cyl('shell', r, h, (0, 0, h / 2 + 0.3), white, 40, uv=False))
    for k in range(1, 4):
        parts.append(K.torus(f'seam{k}', r + 0.01, 0.025, (0, 0, 0.3 + k * h / 4), grey, 40, 5))
    parts.append(BK.cyl('roof', r, 1.1, (0, 0, h + 0.85), white, 40, r2=0.5, uv=False))
    parts.append(K.torus('rail', r - 0.1, 0.03, (0, 0, h + 1.5), grey, 40, 5))
    for i in range(16):
        a = 2 * math.pi * i / 16
        parts.append(K.cylinder(f'post{i}', 0.025, 1.2, ((r - 0.1) * math.cos(a), (r - 0.1) * math.sin(a), h + 0.9), grey, 6))
    pts = []
    for i in range(61):
        t = i / 60
        a = -1.0 + t * 2.6
        pts.append(((r + 0.3) * math.cos(a), (r + 0.3) * math.sin(a), 0.4 + t * (h + 0.1)))
    parts.append(K.tube_path('stair_o', pts, 0.04, grey, seg=6))
    parts.append(K.tube_path('stair_i', [(p[0] * 0.97, p[1] * 0.97, p[2] + 0.9) for p in pts], 0.03, grey, seg=6))
    return BK.model(name, parts)[0]


# ------------------------------------------------------------------ 渔船（参考长度 13 m，游戏按长度等比缩放）
def fishing_boat(name, hull_hex):
    """近海渔船：照 MOSS-Image 参考图重建的版本在 boats.py（真正的船体型线、驾驶室、桅杆、渔具、船名）"""
    import boats
    return boats.fishing_boat(name, hull_hex)


def build_all():
    roots = [hangar('hangar_a'), hangar('hangar_b', 'corr_blue'), tank('tank_a')]
    for i, w in enumerate(('corr_blue', 'corr_red', 'corr_green', 'corr_white')):
        roots.append(container(f'container_{i}', w))
    return roots
