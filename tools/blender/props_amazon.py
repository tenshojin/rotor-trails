# 亚马孙雨林地图的建筑模型（参照：马瑙斯港的客运木船、河岸高脚屋（palafita）照片，维基共享资源）。
# 运行：blender -b --factory-startup --python tools/blender/props_amazon.py -- public/models/props_amazon.glb [--preview 目录]
# 尺寸与 src/world/props/amazon.ts 的碰撞体一致（高脚屋按游戏里的宽/长缩放，观测塔按高度缩放）。

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import bldkit as BK  # noqa: E402
import common_props as CP  # noqa: E402

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


stilt_hut('stilt_hut_a', 'rawplank')
stilt_hut('stilt_hut_b', 'greyplank')
river_boat()
canoe('canoe_wood', M('rawplank'))
canoe('canoe_blue', F('canoe_blue', 0x2a5a8a, rough=0.6))
canopy_tower()

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
