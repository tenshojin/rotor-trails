# 亚马孙雨林地图的建筑模型（参照：马瑙斯港的客运木船、河岸高脚屋（palafita）照片，维基共享资源）。
# 运行：blender -b --factory-startup --python tools/blender/props_amazon.py -- public/models/props_amazon.glb [--preview 目录]
# 尺寸与 src/world/props/amazon.ts 的碰撞体一致（高脚屋按游戏里的宽/长缩放，观测塔按高度缩放）。

import math
import os
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import bldkit as BK  # noqa: E402
import common_props as CP  # noqa: E402
import tents as T  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/models/props_amazon.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
M = BK.mat
F = BK.flat
WHITE = F('paint_white', 0xeeeeea, rough=0.5)
BLUE = F('paint_blue', 0x1f5fa8, rough=0.5)
RED = F('paint_red', 0x8a2a20, rough=0.6)
GLASS = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
DARK = F('opening_dark', 0x14110e, rough=0.9)
STEEL = F('steel_galv', 0x9aa0a6, rough=0.45, metal=0.8)
RUBBER = F('tyre', 0x1a1a1a, rough=0.85)
HAMMOCK = [F('hammock_r', 0xc8402a, rough=0.9), F('hammock_y', 0xe0b030, rough=0.9), F('hammock_g', 0x3a8a4a, rough=0.9), F('hammock_b', 0x3a6ab0, rough=0.9)]
ROOTS = []


# ------------------------------------------------------------------ 高脚屋
def stilt_hut(name, wood):
    """参考尺寸：墙 7.5 × 8.5 m（X × Y），木桩高 2.2 m（桩埋入地下 1.5 m），墙高 2.6 m，陡峭的茅草两坡顶（屋脊沿 Y）；
    正面（门、前廊、梯子）在 -Y（游戏局部 +z，与程序几何体的门一致）。"""
    W, L, S = 7.5, 8.5, 2.2
    pm = M(wood)
    parts = []
    for x in (-W / 2 + 0.4, 0.0, W / 2 - 0.4):
        for y in (-L / 2 - 1.0, -L / 2 + 0.4, L / 2 - 0.4):
            parts.append(BK.cyl('stilt', 0.17, S + 1.5, (x + 0.05 * (y > 0), y, (S - 1.5) / 2), M('bark'), 8))
    # 地板（前面多出 1.6 m 的前廊）与地板下的横梁
    parts.append(BK.bx('floor', (W + 0.8, L + 1.8, 0.18), (0, -0.7, S + 0.09), pm))
    for y in (-L / 2 - 1.0, -L / 2 + 0.4, L / 2 - 0.4):
        parts.append(BK.bx('joist', (W + 0.6, 0.2, 0.24), (0, y, S - 0.12), M('bark')))
    # 木板墙（门、窗开口用深色板表示）+ 撑开的木窗板
    z0 = S + 0.18
    parts.append(BK.bx('walls', (W, L, 2.6), (0, 0, z0 + 1.3), pm))
    fy = -L / 2 - 0.01
    parts.append(BK.wbox('door', (0.6, fy, z0 + 0.95), '-Y', 0, 0, 0.0, 0.95, 0.03, 1.9, DARK))
    parts.append(BK.wbox('door_frame', (0.6, fy, z0 + 1.0), '-Y', 0, 0, 0.02, 1.15, 0.04, 2.05, M('bark')))
    for facing, fx, ys in (('+X', W / 2 + 0.01, (-2.0, 1.8)), ('-X', -W / 2 - 0.01, (-1.5, 2.0))):
        for y in ys:
            c = (fx, y, z0 + 1.45)
            parts.append(BK.wbox('win', c, facing, 0, 0, 0.0, 1.1, 0.03, 0.8, DARK))
            # 向上撑开的窗板
            u, n = BK.AX[facing]
            top = Vector(c) + Vector((0, 0, 0.42))
            sh = K.mesh_obj('shutter', [top - u * 0.6, top + u * 0.6, top + u * 0.6 + n * 0.7 + Vector((0, 0, 0.2)), top - u * 0.6 + n * 0.7 + Vector((0, 0, 0.2))], [(0, 1, 2, 3)], pm, smooth=0)
            K.add_solidify(sh, 0.04, 0)
            BK.uv_world(sh)
            parts.append(sh)
    parts.append(BK.wbox('fwin', (-2.2, fy, z0 + 1.45), '-Y', 0, 0, 0.0, 1.0, 0.03, 0.8, DARK))
    # 前廊栏杆
    for x in (-W / 2 - 0.3, -W / 4, W / 4, W / 2 + 0.3):
        parts.append(BK.stick('post', (x, -L / 2 - 1.5, z0), (x, -L / 2 - 1.5, z0 + 1.0), 0.05, M('bark'), seg=6))
    for z in (z0 + 0.5, z0 + 1.0):
        parts.append(BK.stick('rail', (-W / 2 - 0.3, -L / 2 - 1.5, z), (-0.5, -L / 2 - 1.5, z), 0.035, M('bark'), seg=5))
        parts.append(BK.stick('rail', (1.6, -L / 2 - 1.5, z), (W / 2 + 0.3, -L / 2 - 1.5, z), 0.035, M('bark'), seg=5))
    # 梯子（从地面到前廊）
    for s in (-1, 1):
        parts.append(BK.stick('ladder', (0.55 + s * 0.3, -L / 2 - 2.6, -0.05), (0.55 + s * 0.3, -L / 2 - 1.55, z0), 0.045, M('bark'), seg=5))
    for k in range(1, 6):
        t = k / 6
        y = -L / 2 - 2.6 + 1.05 * t
        parts.append(BK.stick('rung', (0.2, y, z0 * t), (0.9, y, z0 * t), 0.03, M('bark'), seg=5))
    # 茅草屋顶（屋脊沿 Y：在原点建好后转 90°）
    roof = []
    RH = 2.9
    objs, lines, eaves = BK.roof_gable('roof', L + 1.6, W, RH, 1.0, 0.0, 0.3, M('thatch_warm'), z0 + 2.6, cx=-0.8)
    roof += objs
    a, b = lines[0]
    roof.append(BK.stick('ridge', a + Vector((0, 0, 0.3)), b + Vector((0, 0, 0.3)), 0.22, M('thatch_warm'), seg=8))
    for side in (-1, 1):
        g = BK.gable_wall(f'gable{side}', L, W, RH, z0 + 2.6, pm, x_side=side)
        roof.append(g)
    BK.rotate_all(roof, math.pi / 2)
    parts += roof
    root, _ = BK.model(name, parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 客运木船（参照马瑙斯港的河船）
def river_boat():
    """亚马孙河船：照 MOSS-Image 参考图重建的版本在 boats.py（木板船身、两层甲板、吊床、驾驶室），船头朝 -X"""
    import boats
    ROOTS.append(boats.river_boat('river_boat'))


def canoe(name, m):
    """长 6 m（Y）、宽 0.9 m、高 0.5 m 的独木舟：U 形截面沿长度渐收，两头微翘；座板两块、船桨一支。"""
    n, k = 16, 10
    verts = []
    for i in range(n + 1):
        t = -1 + 2 * i / n
        w = 0.45 * max(0.05, 1 - abs(t) ** 3.2) ** 0.55
        d = 0.42 * max(0.15, 1 - abs(t) ** 5)
        top = 0.5 + 0.12 * abs(t) ** 3
        for j in range(k + 1):
            a = math.pi + math.pi * j / k
            verts.append((math.cos(a) * w, t * 3.0, top + math.sin(a) * d))
    faces = []
    for i in range(n):
        for j in range(k):
            a = i * (k + 1) + j
            faces.append((a, a + 1, a + k + 2, a + k + 1))
    hull = K.mesh_obj(name + '_hull', verts, faces, m, smooth=40)
    K.add_solidify(hull, 0.05, 1)
    K.apply_mods(hull)
    if m.name.startswith('b_'):
        BK.uv_world(hull)
    parts = [hull]
    for y in (-1.2, 1.1):
        parts.append(BK.bx('seat', (0.8, 0.22, 0.04), (0, y, 0.38), M('rawplank')))
    parts.append(BK.stick('paddle', (-0.2, -0.4, 0.45), (0.25, 1.3, 0.55), 0.025, M('rawplank'), seg=5))
    pb = K.sphere('blade', 0.2, (0.3, 1.45, 0.56), M('rawplank'), 8, 5, scale=(0.5, 1.4, 0.12))
    K.bake_transform(pb)
    parts.append(pb)
    root, _ = BK.model(name, parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 林冠观测塔
def canopy_tower():
    """参考高度 50 m（按游戏里的 h 缩放）：四根钢管立柱（底部 ±3 m 收到顶部 ±1.8 m），每层水平撑 + 交叉斜撑，
    一侧之字形钢梯，顶部木平台（7 × 7 m）带栏杆和绿色铁皮四坡顶。"""
    H = 50.0
    parts = []
    lv = 10

    def leg(sx, sy, t):
        r = 3.0 - 1.2 * t
        return Vector((sx * r, sy * r, H * t))

    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for sx, sy in corners:
        parts.append(BK.stick('leg', leg(sx, sy, 0) - Vector((0, 0, 0.5)), leg(sx, sy, 1), 0.14, STEEL, seg=8))
        parts.append(BK.bx('footing', (0.9, 0.9, 0.6), (sx * 3.0, sy * 3.0, 0.0), M('concrete')))
    for i in range(1, lv + 1):
        t0, t1 = (i - 1) / lv, i / lv
        for c in range(4):
            a, b = corners[c], corners[(c + 1) % 4]
            parts.append(BK.stick('hbrace', leg(*a, t1), leg(*b, t1), 0.06, STEEL, seg=5))
            parts.append(BK.stick('xbrace', leg(*a, t0), leg(*b, t1), 0.04, STEEL, seg=4))
            parts.append(BK.stick('xbrace', leg(*b, t0), leg(*a, t1), 0.04, STEEL, seg=4))
    # 之字形钢梯（沿 -Y 面内侧）与每层的小平台
    for i in range(lv):
        t0, t1 = i / lv, (i + 1) / lv
        r0, r1 = 3.0 - 1.2 * t0 - 0.6, 3.0 - 1.2 * t1 - 0.6
        s = 1 if i % 2 == 0 else -1
        a = Vector((-s * r0 * 0.8, -r0, H * t0 + 0.1))
        b = Vector((s * r1 * 0.8, -r1, H * t1))
        for off in (-0.35, 0.35):
            parts.append(BK.stick('stringer', a + Vector((0, off, 0)), b + Vector((0, off, 0)), 0.04, STEEL, seg=4))
        parts.append(BK.stick('handrail', a + Vector((0, -0.4, 1.0)), b + Vector((0, -0.4, 1.0)), 0.025, STEEL, seg=4))
        parts.append(BK.bx('landing', (1.0, 0.9, 0.06), (b.x, b.y, b.z), F('grating', 0x6a7076, rough=0.6, metal=0.6), uv=False))
    # 顶部平台、栏杆、四坡铁皮顶
    zt = H
    parts.append(BK.bx('platform', (7.0, 7.0, 0.3), (0, 0, zt + 0.15), M('rawplank')))
    parts.append(BK.bx('platform_frame', (7.1, 7.1, 0.2), (0, 0, zt - 0.05), STEEL, uv=False))
    for c in range(4):
        a, b = corners[c], corners[(c + 1) % 4]
        pa, pb = Vector((a[0] * 3.45, a[1] * 3.45, zt + 0.3)), Vector((b[0] * 3.45, b[1] * 3.45, zt + 0.3))
        for z in (0.55, 1.1):
            parts.append(BK.stick('prail', pa + Vector((0, 0, z)), pb + Vector((0, 0, z)), 0.04, STEEL, seg=5))
        for k in range(7):
            p = pa.lerp(pb, k / 6)
            parts.append(BK.stick('ppost', p, p + Vector((0, 0, 1.1)), 0.035, STEEL, seg=5))
    for sx, sy in corners:
        parts.append(BK.stick('rpost', (sx * 3.3, sy * 3.3, zt + 0.3), (sx * 3.3, sy * 3.3, zt + 2.7), 0.07, STEEL, seg=6))
    objs, _, _ = BK.roof_hip('troof', 7.0, 7.0, 1.4, 0.4, 0.0, 0.06, M('corr_green'), zt + 2.7)
    parts += objs
    root, _ = BK.model('canopy_tower', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 木板栈桥、浮动码头
def _planks(name, x0, x1, half_w, z_top, rng, mats, width=0.19, gap=0.013, thick=0.045, ragged=0.0):
    """横铺的木板（沿 X 一块挨一块，每块横跨 ±half_w）：宽窄、高低、新旧略有不同，个别板子短一截"""
    parts = []
    x = x0
    while x < x1 - 0.05:
        w = width * rng.uniform(0.85, 1.12)
        w = min(w, x1 - x)
        hw = half_w * (1 - rng.uniform(0, ragged)) if ragged else half_w
        off = rng.uniform(-0.03, 0.03)
        c = Vector((x + w / 2, off, z_top - thick / 2 + rng.uniform(-0.006, 0.004)))
        b = BK.bx(name, (w, 2 * hw, thick), tuple(c), rng.choice(mats))
        # 每块板绕自己的中心微微翘一点（bx 已经把位置烘进网格，不能直接设物体的旋转）
        rot = Euler((rng.uniform(-0.012, 0.012), rng.uniform(-0.01, 0.01), rng.uniform(-0.008, 0.008))).to_matrix()
        K.map_verts(b, lambda v, rot=rot, c=c: tuple(c + rot @ (Vector(v) - c)))
        parts.append(b)
        x += w + gap
    return parts


def _pile(name, x, y, z0, z1, wl, r, bark, slime):
    """原木桩：水面以下发黑、长青苔，水面以上是树皮"""
    parts = []
    if wl > z0:
        parts.append(BK.cyl(name + '_wet', r * 1.02, wl - z0 + 0.12, (x, y, (z0 + wl + 0.12) / 2), slime, 8))
    parts.append(BK.cyl(name, r, z1 - max(z0, wl), (x, y, (max(z0, wl) + z1) / 2), bark, 8))
    return parts


def jetty():
    """营地的木板栈桥：长 14 m（X，-1 → 13）、宽 2.2 m，板面在原点上方 0.08 m（游戏里原点 = 水面上方 0.75 m）。
    桩在 x = 0、3.25、6.5、9.75、13，横向 ±1.0 m（与 src/world/props/amazon.ts 的碰撞体一致）。"""
    import random
    rng = random.Random(7)
    wl = -0.75
    # 风吹日晒的旧木板以灰为主，偶尔一块新换的（混太多颜色会像一排琴键）
    planks = [M('greyplank')] * 3 + [M('rawplank')]
    bark = M('bark')
    slime = F('pile_slime', 0x2c3022, rough=0.7)
    parts = _planks('plank', -1.0, 13.0, 1.1, 0.08, rng, planks, ragged=0.04)
    # 两根纵梁 + 每对桩上的横梁
    for y in (-0.85, 0.85):
        parts.append(BK.bx('stringer', (14.0, 0.1, 0.15), (6.0, y, -0.04), M('rawplank')))
    xs = [0.0, 3.25, 6.5, 9.75, 13.0]
    for x in xs:
        parts.append(BK.bx('cap', (0.14, 2.3, 0.14), (x, 0, -0.19), M('rawplank')))
        for y in (-1.0, 1.0):
            top = 0.42 if x == xs[-1] else 0.06
            parts += _pile('pile', x, y, -3.5, top, wl, 0.11, bark, slime)
    # 两对桩之间的斜撑（水面上露出一截）
    for i in (0, 2):
        a, b = xs[i], xs[i + 1]
        for y in (-1.0, 1.0):
            parts.append(BK.stick('brace', (a, y * 1.06, -0.25), (b, y * 1.06, -1.3), 0.05, bark, seg=6))
    # 尽头的系船桩上绕着的缆绳
    for y in (-1.0, 1.0):
        ring = K.torus('rope_ring', 0.135, 0.018, (13.0, y, 0.3), None, seg=14, seg2=5)
        ring.data.materials.append(F('rope', 0xa8946a, rough=0.9))
        parts.append(ring)
    parts.append(BK.stick('rope', (13.0, 1.0, 0.27), (11.2, 2.0, -0.62), 0.016, F('rope', 0xa8946a, rough=0.9), seg=5))
    root, _ = BK.model('jetty_wood', parts)
    ROOTS.append(root)


def float_dock():
    """浮动码头（亚马孙河上的 flutuante）：长 30 m（X，0 → 30）、宽 4 m，木板甲板架在三根大原木浮筒上，
    甲板面高 0.7 m（原点 = 水面）。外侧（游戏局部 +z，Blender -Y）在 x = 3、9、15、21、27 有导向桩穿过甲板边，
    与 src/world/props/amazon.ts 的碰撞体位置一致；外沿挂旧轮胎护舷，系船缆绕在桩上。"""
    import random
    rng = random.Random(11)
    L, HW = 30.0, 2.0
    planks = [M('greyplank')] * 3 + [M('rawplank')]
    bark = M('bark')
    slime = F('pile_slime', 0x2c3022, rough=0.7)
    log = M('bark')
    parts = _planks('deck', 0.0, L, HW, 0.7, rng, planks, width=0.22, gap=0.015, thick=0.05, ragged=0.03)
    # 甲板下的龙骨（横向枕木）与浮筒原木
    for k in range(int(L / 1.5) + 1):
        x = min(L - 0.08, 0.08 + k * 1.5)
        parts.append(BK.bx('sleeper', (0.14, 2 * HW + 0.1, 0.14), (x, 0, 0.58), M('rawplank')))
    for y in (-1.35, 0.0, 1.35):
        for seg in range(3):
            x0 = seg * 10.0
            c = BK.cyl('float_log', 0.34 + rng.uniform(-0.03, 0.03), 9.6, (x0 + 5.0, y + rng.uniform(-0.05, 0.05), 0.17), log, 12, rot=(0, math.pi / 2, 0))
            parts.append(c)
            # 浮筒吃水线以下发黑
            w = BK.cyl('float_wet', 0.352, 9.62, (x0 + 5.0, y, 0.17), slime, 12, rot=(0, math.pi / 2, 0))
            K.map_verts(w, lambda v: (v[0], v[1], min(v[2], 0.02)))
            parts.append(w)
    # 导向桩（外侧）与护舷轮胎
    tyre = F('fender_tyre', 0x1b1b1b, rough=0.85)
    for x in (3.0, 9.0, 15.0, 21.0, 27.0):
        parts += _pile('guide_pile', x, -1.7, -3.0, 1.6, 0.0, 0.2, bark, slime)
        parts.append(BK.bx('pile_hoop', (0.5, 0.5, 0.08), (x, -1.7, 0.74), F('hoop_steel', 0x4c4f52, rough=0.5, metal=0.7)))
    for x in (6.0, 12.0, 18.0, 24.0):
        t = K.torus('fender', 0.32, 0.11, (x, -HW - 0.12, 0.42), tyre, seg=16, seg2=8, rot=(math.pi / 2, 0, 0))
        parts.append(t)
    # 系船缆（从甲板上的木桩绕到导向桩）
    rope = F('rope', 0xa8946a, rough=0.9)
    for x in (2.2, 14.2, 26.2):
        parts.append(BK.cyl('bitt', 0.08, 0.45, (x, -1.1, 0.92), M('rawplank'), 8))
        parts.append(BK.stick('mooring', (x, -1.1, 1.05), (x + 0.8, -1.7, 1.2), 0.018, rope, seg=5))
    # 靠岸那头的跳板
    parts.append(BK.bx('gangway', (2.4, 1.2, 0.06), (-1.0, 0.6, 0.6), M('greyplank'), rz=0.0))
    root, _ = BK.model('dock_float', parts)
    ROOTS.append(root)


stilt_hut('stilt_hut_a', 'rawplank')
stilt_hut('stilt_hut_b', 'greyplank')
river_boat()
canoe('canoe_wood', M('rawplank'))
canoe('canoe_blue', F('canoe_blue', 0x2a5a8a, rough=0.6))
canopy_tower()
jetty()
float_dock()
# 科考营地的帆布屋脊帐篷（颜色与 src/world/props/amazon.ts 的 tent 一致）
for k, c in enumerate((0x515c46, 0x7d6e50, 0x4b5a63, 0x724c34)):
    ROOTS.append(T.ridge_tent(f'tent_ridge_{k}', c))

for r in ROOTS:
    r.location = (0, 0, 0)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    K.box('ground', (200, 200, 0.1), (0, 0, -0.05), K.material('ground', 0x6f7a52, rough=0.95))
    shots = {'stilt_hut_a': ((11, -14, 6), (0, 0, 3.5)), 'river_boat': ((-26, -22, 9), (0, 0, 3)),
             'canoe_wood': ((3, -4, 2.5), (0, 0, 0.3)), 'canopy_tower': ((30, -40, 56), (0, 0, 46))}
    for nm, (cam_p, tgt) in shots.items():
        for r in ROOTS:
            for c in [r] + list(r.children):
                c.hide_render = r.name != nm
        cam = K.camera('cam_' + nm, cam_p, tgt, fov_deg=50)
        K.render(os.path.join(PREVIEW, nm + '.png'), cam, (900, 600), samples=48)
    for r in ROOTS:
        for c in [r] + list(r.children):
            c.hide_render = False
    bpy.data.objects.remove(bpy.data.objects['ground'])

ROOTS += CP.build_all()
BK.export(OUT, ROOTS)
print('EXPORTED', OUT, len(ROOTS), 'models')
