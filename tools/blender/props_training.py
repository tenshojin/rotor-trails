# 训练场（阿尔卑斯谷地里的小机场）的建筑模型：控制塔、俱乐部木屋、干草棚、轻型飞机（虚构机型）、加油车，
# 外加各地图共用的机库、集装箱、油罐。
# 运行：blender -b --factory-startup --python tools/blender/props_training.py -- public/models/props_training.glb [--preview 目录]

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
OUT = argv[0] if argv else 'public/models/props_training.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
M = BK.mat
F = BK.flat
WHITE = F('trim_white', 0xe8e5dc, rough=0.55)
GLASS = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
IRON = F('iron_black', 0x1b1b1c, rough=0.5, metal=0.6)
STEEL = F('steel_galv', 0x9aa0a6, rough=0.45, metal=0.8)
TIMBER = F('timber_dark', 0x3a2a1c, rough=0.75)
DOOR = F('door_brown', 0x4a3220, rough=0.55)
ROOTS = []


def cwin(name, center, w, h, facing, trim=TIMBER):
    """木窗：外框、竖梃、一道横档、窗台。"""
    obs = BK.window(name, center, w, h, facing, trim, GLASS, depth=0.08, frame=0.07, mullion=True)
    obs.append(BK.wbox(name + 'h', center, facing, 0, 0, 0.03, w, 0.05, 0.05, trim))
    obs.append(BK.wbox(name + 's', center, facing, 0, -h / 2 - 0.05, 0.08, w + 0.24, 0.16, 0.07, trim))
    return obs


# ------------------------------------------------------------------ 控制塔
def tower():
    """小机场的控制塔：两层裙房、方形塔身、外倾的八角玻璃塔台、屋顶上的风向仪和天线。"""
    plaster = M('plaster_cream')
    conc = M('concrete')
    parts = [BK.bx('plinth', (10.2, 7.2, 0.5), (0, 0, 0.25), conc)]
    parts.append(BK.bx('base', (10, 7, 3.6), (0, 0, 2.1), plaster))
    parts.append(BK.bx('base_top', (10.4, 7.4, 0.22), (0, 0, 3.98), conc))
    for i, x in enumerate((-3.4, -1.1, 3.4)):
        parts += cwin(f'wb{i}', (x, 3.51, 2.3), 1.5, 1.3, '+Y', IRON)
        parts += cwin(f'wf{i}', (x, -3.51, 2.3), 1.5, 1.3, '-Y', IRON)
    parts.append(BK.wbox('door', (1.2, 3.51, 1.6), '+Y', 0, 0, 0.02, 1.1, 0.06, 2.2, IRON))
    parts.append(BK.bx('step', (2.0, 1.0, 0.3), (1.2, 4.0, 0.15), conc))
    parts.append(BK.bx('canopy', (2.4, 1.3, 0.12), (1.2, 4.1, 2.95), conc))
    # 塔身：四面竖向的窄窗
    parts.append(BK.bx('shaft', (4.2, 4.2, 9.2), (0, 0, 8.6), plaster))
    for facing, p in (('+Y', (0, 2.11, 0)), ('-Y', (0, -2.11, 0)), ('+X', (2.11, 0, 0)), ('-X', (-2.11, 0, 0))):
        for j, z in enumerate((6.2, 8.6, 11.0)):
            parts += cwin(f's{facing}{j}', (p[0], p[1], z), 0.8, 1.5, facing, IRON)
    # 塔台：底板、外倾的玻璃、竖框、挑檐
    parts.append(BK.cyl('deck', 3.8, 0.34, (0, 0, 13.3), conc, verts=8, uv=False))
    parts.append(BK.cyl('sill', 3.3, 0.9, (0, 0, 13.9), plaster, verts=8, uv=False))
    parts.append(BK.cyl('glass', 3.3, 2.3, (0, 0, 15.5), GLASS, verts=8, r2=3.85, uv=False))
    for i in range(8):
        a = math.pi / 8 + i * math.pi / 4 - math.pi / 8
        c, s = math.cos(a), math.sin(a)
        parts.append(BK.stick('mull', (3.34 * c, 3.34 * s, 14.33), (3.9 * c, 3.9 * s, 16.67), 0.05, IRON, seg=5))
    parts.append(BK.cyl('roof', 4.35, 0.28, (0, 0, 16.8), F('roof_grey', 0x4a4d50, rough=0.5, metal=0.3), verts=8, uv=False))
    parts.append(BK.cyl('roof2', 2.2, 0.7, (0, 0, 17.25), F('roof_grey', 0x4a4d50, rough=0.5, metal=0.3), verts=8, r2=0.5, uv=False))
    # 栏杆（裙房屋顶上）
    for sx in (-1, 1):
        parts.append(BK.stick('rail', (sx * 5.0, -3.5, 5.0), (sx * 5.0, 3.5, 5.0), 0.035, STEEL, seg=5))
        for y in (-3.5, -1.75, 0, 1.75, 3.5):
            parts.append(BK.stick('post', (sx * 5.0, y, 4.1), (sx * 5.0, y, 5.0), 0.03, STEEL, seg=5))
    for sy in (-1, 1):
        parts.append(BK.stick('rail', (-5.0, sy * 3.5, 5.0), (5.0, sy * 3.5, 5.0), 0.035, STEEL, seg=5))
    # 天线、风杯
    parts.append(BK.stick('mast', (1.6, 0.8, 16.9), (1.6, 0.8, 21.0), 0.05, WHITE, seg=6))
    parts.append(BK.stick('mast2', (-1.8, -0.6, 16.9), (-1.8, -0.6, 19.2), 0.035, STEEL, seg=6))
    parts.append(BK.stick('arm', (-2.4, -0.6, 19.2), (-1.2, -0.6, 19.2), 0.02, STEEL, seg=5))
    parts.append(K.sphere('beacon', 0.13, (1.6, 0.8, 21.08), F('beacon_red', 0xb0261c, rough=0.3), 10, 8))
    root, _ = BK.model('tower_a', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 俱乐部木屋
def club():
    """飞行俱乐部：白灰泥底层、木板上层、宽檐两坡屋顶、整面的挑阳台（阿尔卑斯木屋的样子）。屋脊沿 X，正面朝 +Y。"""
    L, W, H, B = 15.0, 9.5, 6.2, 2.9
    RH = W * 0.3
    wood = M('rawplank')
    parts = [BK.bx('plinth', (L + 0.14, W + 0.14, 0.5), (0, 0, 0.25), M('stonewall'))]
    parts.append(BK.bx('low', (L, W, B - 0.5), (0, 0, 0.5 + (B - 0.5) / 2), M('plaster')))
    parts.append(BK.bx('up', (L, W, H - B), (0, 0, B + (H - B) / 2), wood))
    for side in (-1, 1):
        parts.append(BK.gable_wall(f'gable{side}', L, W, RH, H, wood, x_side=side))
    fy = W / 2 + 0.01
    for facing, y in (('+Y', fy), ('-Y', -fy)):
        for i, x in enumerate((-5.4, -2.7, 2.7, 5.4)):
            parts += cwin(f'l{facing}{i}', (x, y, 1.75), 1.25, 1.35, facing)
        for i, x in enumerate((-5.2, -1.8, 1.8, 5.2)):
            parts += cwin(f'u{facing}{i}', (x, y, 4.35), 1.15, 1.35, facing)
    # 正门与门廊
    parts.append(BK.wbox('door', (0, fy, 1.6), '+Y', 0, 0, 0.02, 1.7, 0.06, 2.2, DOOR))
    parts.append(BK.wbox('door_k', (0, fy, 1.6), '+Y', 0, 0, 0.05, 0.05, 0.05, 2.2, TIMBER))
    parts.append(BK.bx('step', (3.0, 1.3, 0.3), (0, fy + 0.65, 0.15), M('concrete')))
    # 挑阳台：楼板、牛腿、木栏杆
    bd = 1.5
    parts.append(BK.bx('bal', (L + 1.0, bd, 0.14), (0, fy + bd / 2, B + 0.02), wood))
    for x in (-6.8, -3.4, 0, 3.4, 6.8):
        parts.append(BK.stick('brace', (x, fy, B - 1.0), (x, fy + bd - 0.2, B - 0.04), 0.07, TIMBER, seg=5))
    parts.append(BK.bx('rail_t', (L + 1.0, 0.09, 0.08), (0, fy + bd, B + 1.05), TIMBER, uv=False))
    parts.append(BK.bx('rail_b', (L + 1.0, 0.07, 0.07), (0, fy + bd, B + 0.2), TIMBER, uv=False))
    n = 62
    for i in range(n + 1):
        x = -(L + 1.0) / 2 + (L + 1.0) * i / n
        parts.append(BK.bx('bal_p', (0.1, 0.03, 0.86), (x, fy + bd, B + 0.62), wood, uv=False))
    # 屋顶：宽檐、木椽头
    ov_side, ov_gable = 1.5, 1.2
    objs, lines, _ = BK.roof_gable('roof', L, W, RH, ov_side, ov_gable, 0.16, M('shingle'), H)
    parts += objs
    slope = RH / (W / 2)
    for i in range(11):
        x = -L / 2 + L * i / 10
        for sy in (-1, 1):
            parts.append(BK.stick('rafter', (x, sy * (W / 2 - 0.1), H + 0.1 * slope), (x, sy * (W / 2 + ov_side - 0.15), H - (ov_side - 0.15) * slope - 0.02), 0.06, TIMBER, seg=4))
    # 烟囱
    parts.append(BK.bx('chimney', (0.8, 0.8, 2.3), (-L * 0.26, 0.5, H + RH - 0.2), M('stonewall')))
    parts.append(BK.bx('chimney_cap', (1.02, 1.02, 0.1), (-L * 0.26, 0.5, H + RH + 0.98), IRON, uv=False))
    root, _ = BK.model('club_a', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 干草棚
def barn():
    """山谷牧场上的干草棚：石头墙基、风吹日晒变黑的木板、宽檐坡顶。屋脊沿 X，门朝 +Y。"""
    L, W, H = 9.0, 6.5, 3.4
    RH = W * 0.36
    wood = M('greyplank')
    parts = [BK.bx('stone', (L + 0.1, W + 0.1, 1.1), (0, 0, 0.55), M('stonewall'))]
    parts.append(BK.bx('wall', (L, W, H - 1.1), (0, 0, 1.1 + (H - 1.1) / 2), wood))
    for side in (-1, 1):
        parts.append(BK.gable_wall(f'gable{side}', L, W, RH, H, wood, x_side=side))
    fy = W / 2 + 0.01
    parts.append(BK.wbox('door', (-1.3, fy, 1.15), '+Y', 0, 0, 0.02, 1.8, 0.06, 2.1, F('door_old', 0x2c2118, rough=0.8)))
    parts.append(BK.wbox('hatch', (2.2, fy, 2.5), '+Y', 0, 0, 0.02, 1.0, 0.05, 0.9, F('door_old', 0x2c2118, rough=0.8)))
    objs, _, _ = BK.roof_gable('roof', L, W, RH, 0.8, 0.6, 0.14, M('shingle'), H)
    parts += objs
    root, _ = BK.model('barn_a', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 轻型飞机
def loft(name, secs, m, n=16):
    """按截面放样机身：secs = [(y, z, 半宽, 半高)]，y 沿机身。"""
    verts, faces = [], []
    for y, z, rw, rh in secs:
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((rw * math.cos(a), y, z + rh * math.sin(a)))
    for j in range(len(secs) - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(m)
    return ob


def plane(name='plane_a', prop=True):
    """四座上单翼轻型飞机：照 MOSS-Image 参考图重建的版本在 planes.py（放样机身、翼型机翼和尾翼、窗、起落架整流罩、注册号）"""
    import planes
    ROOTS.append(planes.plane(name, prop))


# ------------------------------------------------------------------ 加油车
def truck():
    """机场加油车：照 MOSS-Image 参考图重建的版本在 cars.py（驾驶室、椭圆铝罐、控制柜、软管卷盘）"""
    import cars
    ROOTS.append(cars.fuel_truck('truck_fuel'))


tower()
club()
barn()
plane()
plane('plane_fly', False)
truck()

for r in ROOTS:
    r.location = (0, 0, 0)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    K.box('ground', (200, 200, 0.1), (0, 0, -0.05), K.material('ground', 0x6a7a4a, rough=0.95))
    shots = {'tower_a': ((18, 20, 9), (0, 0, 9)), 'club_a': ((14, 18, 6), (0, 0, 3.6)), 'barn_a': ((10, 12, 4), (0, 0, 2.2)), 'plane_a': ((7, 7, 3), (0, 0, 1.4)), 'truck_fuel': ((7, 7, 3), (0, 0, 1.5))}
    for nm, (cam_p, tgt) in shots.items():
        for r in ROOTS:
            for c in [r] + list(r.children):
                c.hide_render = r.name != nm
        cam = K.camera('cam_' + nm, cam_p, tgt, fov_deg=45)
        K.render(os.path.join(PREVIEW, nm + '.png'), cam, (800, 520), samples=32)
    for r in ROOTS:
        for c in [r] + list(r.children):
            c.hide_render = False
    bpy.data.objects.remove(bpy.data.objects['ground'])

ROOTS += CP.build_all()
BK.export(OUT, ROOTS)
print('EXPORTED', OUT, len(ROOTS), 'models')
