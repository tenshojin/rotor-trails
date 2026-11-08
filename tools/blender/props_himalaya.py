# 尼泊尔高山地图的建筑模型（参照：丹波切寺（Tengboche）、昆布地区夏尔巴石屋与白塔照片，维基共享资源）。
# 运行：blender -b --factory-startup --python tools/blender/props_himalaya.py -- public/models/props_himalaya.glb [--preview 目录]
# 尺寸与 src/world/props/himalaya.ts 的碰撞体一致（石屋按游戏里的宽/高/长缩放，玛尼墙按长度缩放）。

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402
import bldkit as BK  # noqa: E402
import common_props as CP  # noqa: E402
import tents as T  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'public/models/props_himalaya.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

K.reset()
M = BK.mat
F = BK.flat
GLASS = F('glass_dark', 0x1c252d, rough=0.08, metal=0.5)
BLACK = F('paint_black', 0x141414, rough=0.6)
GOLD = F('gold', 0xc8a050, rough=0.3, metal=0.9)
RED = F('paint_red', 0x9a2418, rough=0.55)
YELLOW = F('paint_yellow', 0xd8a028, rough=0.55)
WOOD = F('wood_dark', 0x4a3424, rough=0.7)
FRAMES = {'blue': F('frame_blue', 0x2a5a9a, rough=0.5), 'green': F('frame_green', 0x2f7a4a, rough=0.5),
          'brown': F('frame_brown', 0x6a3a1e, rough=0.55)}
STONE_GREY = F('roof_stone', 0x77736c, rough=0.95)
ROOTS = []


def twin(name, center, w, h, facing, frame):
    """藏式窗：彩漆木窗框（田字格）+ 外侧黑色梯形窗套（下宽上窄）+ 窗顶两层彩色短椽。"""
    c = Vector(center)
    obs = BK.window(name, center, w, h, facing, frame, GLASS, depth=0.08, frame=0.08, mullion=True)
    obs.append(BK.wbox(name + 'h', center, facing, 0, 0, 0.03, w, 0.05, 0.05, frame))
    u, n = BK.AX[facing]
    bw, tw = w + 0.75, w + 0.4
    z0, z1 = c.z - h / 2 - 0.28, c.z + h / 2 + 0.16
    o = c + n * 0.012
    pts = [o - u * bw / 2 + Vector((0, 0, z0 - c.z)), o + u * bw / 2 + Vector((0, 0, z0 - c.z)),
           o + u * tw / 2 + Vector((0, 0, z1 - c.z)), o - u * tw / 2 + Vector((0, 0, z1 - c.z))]
    trap = K.mesh_obj(name + '_trap', pts, [(0, 1, 2, 3)], BLACK, smooth=0)
    K.add_solidify(trap, 0.02, 0)
    obs.append(trap)
    obs.append(BK.wbox(name + 'l1', center, facing, 0, h / 2 + 0.25, 0.07, w + 0.55, 0.14, 0.1, frame))
    obs.append(BK.wbox(name + 'l2', center, facing, 0, h / 2 + 0.36, 0.11, w + 0.7, 0.22, 0.1, RED))
    return obs


def roof_stones(parts, L, W, RH, H, ov, n=5):
    """压在铁皮屋顶上的石块（喜马拉雅地区防风的做法）。"""
    slope = RH / (W / 2)
    for sy in (-1, 1):
        for i in range(n):
            x = -L / 2 + L * (i + 0.5) / n
            y = sy * (W / 2 + ov - 0.5)
            z = H - (ov - 0.5) * slope + 0.12
            s = K.sphere('rstone', 0.28, (x + (i % 2) * 0.3, y, z), STONE_GREY, 8, 5, scale=(1.2, 0.9, 0.55))
            K.bake_transform(s)
            parts.append(s)


# ------------------------------------------------------------------ 夏尔巴石屋
def stone_house(name, wall_style, roof):
    """参考尺寸：7.5 × 8.5 m（X × Y），墙顶 4.5 m；一层石砌、二层石墙（或刷白），低坡彩色铁皮屋顶（屋脊沿 X），
    正面在 -Y（游戏局部 +z，与程序几何体的窗户一侧一致）。"""
    L, W, H = 7.5, 8.5, 4.5
    RH = 1.1
    lower = M('stonewall')
    upper = M('stone_white') if wall_style == 'white' else M('stonewall')
    frame = FRAMES['blue' if roof != 'corr_blue' else 'green']
    parts = [BK.bx('wall_lo', (L, W, 2.3), (0, 0, 1.15), lower)]
    parts.append(BK.bx('wall_hi', (L - 0.02, W - 0.02, H - 2.3), (0, 0, 2.3 + (H - 2.3) / 2), upper))
    parts.append(BK.bx('floor_beam', (L + 0.08, W + 0.08, 0.14), (0, 0, 2.3), WOOD, uv=False))
    for side in (-1, 1):
        parts.append(BK.gable_wall(f'gable{side}', L, W, RH, H, upper, x_side=side))
    fy = -W / 2 - 0.01
    # 正面：二层三扇大窗、一层两扇小窗 + 门（彩漆门框、小雨棚）
    for i, x in enumerate((-2.3, 0.0, 2.3)):
        parts += twin(f'wu{i}', (x, fy, 3.35), 1.05, 1.0, '-Y', frame)
    for i, x in enumerate((-2.4, 2.4)):
        parts += twin(f'wl{i}', (x, fy, 1.3), 0.6, 0.6, '-Y', frame)
    parts.append(BK.wbox('door', (0.0, fy, 1.05), '-Y', 0, 0, 0.03, 1.0, 0.07, 2.0, frame))
    parts.append(BK.wbox('door_frame', (0.0, fy, 1.1), '-Y', 0, 0, 0.05, 1.3, 0.05, 2.25, RED))
    parts.append(BK.wbox('door_lintel', (0.0, fy, 2.3), '-Y', 0, 0, 0.12, 1.7, 0.24, 0.12, WOOD))
    parts.append(BK.bx('step', (1.6, 0.8, 0.25), (0, fy - 0.4, 0.12), M('stonewall')))
    # 侧面与背面的窗
    for facing, x in (('+X', L / 2 + 0.01), ('-X', -L / 2 - 0.01)):
        parts += twin('ws' + facing, (x, 0.8, 3.35), 0.8, 0.85, facing, frame)
    parts += twin('wb', (1.2, W / 2 + 0.01, 3.35), 0.8, 0.85, '+Y', frame)
    # 低坡铁皮屋顶 + 封檐木板 + 压顶石
    ov = 0.55
    objs, lines, eaves = BK.roof_gable('roof', L, W, RH, ov, 0.4, 0.06, M(roof), H)
    parts += objs
    a, b = lines[0]
    parts.append(BK.stick('ridge', a + Vector((0, 0, 0.07)), b + Vector((0, 0, 0.07)), 0.08, M(roof), seg=4))
    slope = RH / (W / 2)
    for sy in (-1, 1):
        y = sy * (W / 2 + ov)
        parts.append(BK.stick('fascia', (-L / 2 - 0.4, y, H - ov * slope - 0.05), (L / 2 + 0.4, y, H - ov * slope - 0.05), 0.06, WOOD, seg=4))
    roof_stones(parts, L, W, RH, H, ov)
    # 铁皮烟囱 + 屋顶经幡杆
    parts.append(BK.cyl('flue', 0.1, 1.4, (L * 0.28, 0.9, H + RH * 0.75 + 0.4), F('flue', 0x55524c, rough=0.5, metal=0.6), 10, uv=False))
    parts.append(BK.cyl('flagpole', 0.04, 3.2, (-L * 0.3, 0.3, H + RH * 0.8 + 1.4), WOOD, 6, uv=False))
    parts.append(BK.bx('flag', (0.04, 0.5, 1.6), (-L * 0.3, 0.3 + 0.27, H + RH * 0.8 + 2.0), F('flag_white', 0xe8e4d8, rough=0.9), uv=False))
    root, _ = BK.model(name, parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 白塔（佛塔）
def chorten():
    """与程序几何体一致：三层方形台基（9 m 宽）、覆钵（球心 7.5 m）、塔颈方台（10.6 m，四面画佛眼）、
    十三层金色相轮、伞盖与宝顶（约 17 m）。"""
    W = M('plaster')
    parts = [BK.bx('base0', (9.2, 9.2, 0.4), (0, 0, 0.2), M('stonewall'))]
    parts.append(BK.bx('base1', (9.0, 9.0, 1.6), (0, 0, 0.4 + 0.8), W, bevel=0.05))
    parts.append(BK.bx('base2', (8.0, 8.0, 1.2), (0, 0, 2.0 + 0.6), W, bevel=0.05))
    parts.append(BK.bx('base3', (7.0, 7.0, 1.3), (0, 0, 3.2 + 0.65), W, bevel=0.05))
    for z in (2.0, 3.2, 4.5):
        parts.append(BK.bx('ledge', (9.1 - (z - 2.0) * 0.8, 9.1 - (z - 2.0) * 0.8, 0.1), (0, 0, z), F('ledge_grey', 0x9a968e, rough=0.8), uv=False))
    dome = K.sphere('bumpa', 3.6, (0, 0, 7.4), W, 32, 16, scale=(1, 1, 0.85))
    K.bake_transform(dome)
    BK.uv_world(dome)
    parts.append(dome)
    # 覆钵正面的佛龛
    parts.append(BK.wbox('niche', (0, -3.45, 6.9), '-Y', 0, 0, 0.0, 1.0, 0.3, 1.3, F('niche', 0x2a2420, rough=0.9)))
    parts.append(BK.wbox('niche_frame', (0, -3.45, 6.9), '-Y', 0, 0, 0.04, 1.3, 0.2, 1.6, GOLD))
    # 塔颈方台（harmika）与四面佛眼
    parts.append(BK.bx('harmika', (2.2, 2.2, 1.4), (0, 0, 10.6), W, bevel=0.03))
    parts.append(BK.bx('harmika_top', (2.6, 2.6, 0.25), (0, 0, 11.42), GOLD, uv=False))
    for facing, (dx, dy) in (('-Y', (0, -1.1)), ('+Y', (0, 1.1)), ('+X', (1.1, 0)), ('-X', (-1.1, 0))):
        c = (dx, dy, 10.65)
        for s in (-1, 1):
            parts.append(BK.wbox('eye', c, facing, s * 0.45, 0.08, 0.01, 0.42, 0.03, 0.14, BLACK))
            parts.append(BK.wbox('iris', c, facing, s * 0.45, 0.08, 0.025, 0.14, 0.02, 0.12, F('iris_blue', 0x2a4a8a, rough=0.5)))
            parts.append(BK.wbox('brow', c, facing, s * 0.45, 0.36, 0.01, 0.5, 0.03, 0.06, BLACK))
        parts.append(BK.wbox('nose', c, facing, 0, -0.32, 0.01, 0.1, 0.03, 0.34, F('nose_red', 0xc0402a, rough=0.5)))
    # 十三层相轮
    z = 11.55
    for i in range(13):
        r = 0.95 - i * 0.045
        parts.append(BK.cyl(f'ring{i}', r, 0.32, (0, 0, z + 0.16), GOLD, 20, r2=r - 0.06, uv=False))
        z += 0.34
    parts.append(BK.cyl('parasol', 0.75, 0.22, (0, 0, z + 0.11), GOLD, 20, r2=0.2, uv=False))
    parts.append(K.sphere('finial', 0.22, (0, 0, z + 0.55), GOLD, 12, 8))
    parts.append(BK.cyl('tip', 0.08, 0.9, (0, 0, z + 1.1), GOLD, 8, r2=0.01, uv=False))
    root, _ = BK.model('chorten', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 寺院（参照丹波切寺）
def monastery():
    """与程序几何体一致：主殿 22 × 16 × 8 m（白墙 + 顶部绛红色边玛墙带），上层经堂 12 × 9 × 4 m（绛红墙），
    金顶（四坡，13 × 10 × 3 m）与宝顶；左侧（-X）石砌僧舍 8 × 10 × 6 m。正面在 -Y（游戏局部 +z）。"""
    parts = [BK.bx('found', (22.6, 16.6, 0.6), (0, 0, 0.3), M('stonewall'))]
    parts.append(BK.bx('hall', (22, 16, 7.4), (0, 0, 0.6 + 3.7), M('plaster')))
    parts.append(BK.bx('penbe', (22.3, 16.3, 0.85), (0, 0, 8.0 - 0.43), M('maroon')))
    parts.append(BK.bx('cornice', (22.6, 16.6, 0.18), (0, 0, 8.05), WOOD, uv=False))
    # 边玛墙带上的金色圆饰
    for x in (-7.5, 0.0, 7.5):
        parts.append(BK.cyl('mirror', 0.32, 0.06, (x, -8.17, 7.57), GOLD, 16, rot=(math.pi / 2, 0, 0), uv=False))
    # 正面：两层窗 + 中央柱廊大门
    fy = -8.01
    for x in (-9.0, -6.0, 6.0, 9.0):
        parts += twin(f'wf1{x}', (x, fy, 2.6), 1.0, 1.2, '-Y', FRAMES['brown'])
        parts += twin(f'wf2{x}', (x, fy, 5.6), 1.1, 1.3, '-Y', FRAMES['brown'])
    parts += twin('wf2c', (0, fy, 5.6), 1.6, 1.3, '-Y', FRAMES['brown'])
    # 门廊：四根红柱 + 彩绘横梁 + 小屋檐
    for x in (-2.4, -0.8, 0.8, 2.4):
        parts.append(BK.cyl('col', 0.2, 3.6, (x, fy - 1.6, 0.6 + 1.8), RED, 12, uv=False))
        parts.append(BK.bx('col_cap', (0.6, 0.5, 0.25), (x, fy - 1.6, 4.3), YELLOW, uv=False))
    parts.append(BK.bx('beam', (5.6, 0.5, 0.45), (0, fy - 1.6, 4.6), FRAMES['green'], uv=False))
    parts.append(BK.bx('beam2', (5.8, 0.6, 0.25), (0, fy - 1.6, 4.95), RED, uv=False))
    parts.append(BK.slab('porch_roof', [(-3.2, fy - 2.4, 5.0), (3.2, fy - 2.4, 5.0), (3.2, fy, 5.6), (-3.2, fy, 5.6)], 0.12, M('corr_red')))
    parts.append(BK.bx('porch_floor', (6.4, 2.4, 0.3), (0, fy - 1.2, 0.75), M('stonewall')))
    parts.append(BK.wbox('door', (0, fy, 2.3), '-Y', 0, 0, 0.03, 2.0, 0.08, 3.2, RED))
    parts.append(BK.wbox('door_frame', (0, fy, 2.4), '-Y', 0, 0, 0.05, 2.5, 0.06, 3.5, YELLOW))
    for s in (-1, 1):
        parts.append(BK.wbox('door_ring', (s * 0.35, fy, 2.2), '-Y', 0, 0, 0.1, 0.16, 0.05, 0.16, GOLD))
    for i in range(5):
        parts.append(BK.bx('stair', (4.0, 0.4, 0.15), (0, fy - 2.6 - i * 0.4, 0.6 - i * 0.15), M('stonewall')))
    # 两侧与背面的窗
    for facing, x in (('+X', 11.01), ('-X', -11.01)):
        for y in (-4.5, 0.0, 4.5):
            parts += twin(f'ws{facing}{y}', (x, y, 5.6), 1.0, 1.2, facing, FRAMES['brown'])
    for x in (-6.0, 0.0, 6.0):
        parts += twin(f'wb{x}', (x, 8.01, 5.6), 1.0, 1.2, '+Y', FRAMES['brown'])
    # 上层经堂：绛红墙 + 一排白框窗
    parts.append(BK.bx('upper', (12, 9, 4.0), (0, 0, 8.0 + 2.0), M('maroon')))
    parts.append(BK.bx('upper_cornice', (12.4, 9.4, 0.2), (0, 0, 12.0), WOOD, uv=False))
    for x in (-4.0, -1.35, 1.35, 4.0):
        parts += twin(f'wu{x}', (x, -4.51, 10.1), 1.1, 1.3, '-Y', F('frame_white', 0xe8e4dc, rough=0.5))
    for facing, x in (('+X', 6.01), ('-X', -6.01)):
        parts += twin(f'wus{facing}', (x, 0, 10.1), 1.1, 1.3, facing, F('frame_white', 0xe8e4dc, rough=0.5))
    # 金顶（四坡）+ 屋脊宝顶（gyaltsen）+ 四角金饰
    objs, lines, eaves = BK.roof_hip('groof', 12, 9, 3.0, 0.5, 0.3, 0.1, GOLD, 12.0)
    parts += objs
    R1, R2 = lines[0]
    parts.append(BK.ridge_tube('gridge', R1 + Vector((0, 0, 0.1)), R2 + Vector((0, 0, 0.1)), 0.12, GOLD))
    parts.append(BK.cyl('gyaltsen', 0.45, 1.6, (0, 0, 15.0 + 0.8), GOLD, 16, r2=0.3, uv=False))
    parts.append(BK.cyl('gyaltsen_top', 0.55, 0.3, (0, 0, 16.75), GOLD, 16, r2=0.15, uv=False))
    parts.append(K.sphere('gyaltsen_ball', 0.25, (0, 0, 17.15), GOLD, 12, 8))
    for p in eaves:
        parts.append(BK.cyl('corner_orn', 0.12, 0.7, (p.x, p.y, p.z + 0.35), GOLD, 8, r2=0.03, uv=False))
    # 左侧石砌僧舍（低坡红色铁皮顶）
    sx, sy = -16.0, -4.0
    parts.append(BK.bx('quarters', (8, 10, 6), (sx, sy, 3.0), M('stonewall')))
    # 屋脊沿僧舍长边（Y）：在原点建好（屋脊沿 X）后转 90° 再移到僧舍上方
    objs, _, _ = BK.roof_gable('qroof', 10, 8, 1.0, 0.4, 0.4, 0.06, M('corr_red'), 6.0)
    BK.rotate_all(objs, math.pi / 2)
    for o in objs:
        o.data.transform(Matrix.Translation((sx, sy, 0)))
    parts += objs
    for y in (-7.0, -4.0, -1.0):
        parts += twin(f'wq{y}', (sx - 4.01, sy - 3 + (y + 4.0), 4.0), 0.8, 0.9, '-X', FRAMES['green'])
    for x in (-18.0, -14.0):
        parts += twin(f'wqf{x}', (x, sy - 5.01, 4.0), 0.8, 0.9, '-Y', FRAMES['green'])
    root, _ = BK.model('monastery', parts)
    ROOTS.append(root)


# ------------------------------------------------------------------ 玛尼墙
def mani_wall():
    """参考长度 24 m（按游戏里的 len 缩放）、高 1.6 m、宽 2 m：干砌石墙，两侧嵌刻字的玛尼石板，顶上一排平石。"""
    L = 24.0
    parts = [BK.bx('core', (L, 2.0, 1.5), (0, 0, 0.75), M('stonewall'))]
    slab_m = F('mani_slab', 0x5a5852, rough=0.85)
    text_m = F('mani_text', 0xd8d4c8, rough=0.8)
    for sy, facing in ((1, '+Y'), (-1, '-Y')):
        x = -L / 2 + 0.7
        i = 0
        while x < L / 2 - 0.6:
            w = 0.9 + (i % 3) * 0.2
            c = (x + w / 2, sy * 1.0, 0.85 + (i % 2) * 0.08)
            parts.append(BK.wbox('slab', c, facing, 0, 0, 0.04, w, 0.08, 0.7 + (i % 2) * 0.15, slab_m))
            for k in range(3):
                parts.append(BK.wbox('txt', c, facing, -w * 0.3 + k * w * 0.3, 0.05, 0.085, w * 0.18, 0.01, 0.32, text_m))
            x += w + 0.15
            i += 1
    for i in range(12):
        x = -L / 2 + 1.0 + i * 2.0
        parts.append(BK.bx('cap', (1.7, 1.9, 0.18), (x, 0, 1.6 + (i % 2) * 0.03), M('stonewall'), rz=0.04 * ((i % 3) - 1)))
    root, _ = BK.model('mani_wall', parts)
    ROOTS.append(root)


stone_house('stone_house_a', 'bare', 'corr_blue')
stone_house('stone_house_b', 'bare', 'corr_red')
stone_house('stone_house_c', 'white', 'corr_green')
stone_house('stone_house_d', 'white', 'corr_blue')
chorten()
monastery()
mani_wall()
# 冰川营地的高山圆顶帐篷（颜色与 src/world/props/himalaya.ts 的 tentCamp 一致）
for k, c in enumerate((0xb9622f, 0xc9a43e, 0x3f6688, 0xa64a3a)):
    ROOTS.append(T.dome_tent(f'tent_dome_{k}', c))

for r in ROOTS:
    r.location = (0, 0, 0)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    K.world_sky(1.0, sun_dir=(0.5, -0.6, 0.7), sun_strength=4.0)
    K.box('ground', (200, 200, 0.1), (0, 0, -0.05), K.material('ground', 0x8a8070, rough=0.95))
    shots = {'stone_house_a': ((10, -13, 6), (0, 0, 2.5)), 'stone_house_c': ((-11, -12, 7), (0, 0, 2.5)),
             'chorten': ((12, -16, 7), (0, 0, 7)), 'monastery': ((22, -32, 14), (-3, 0, 6)), 'mani_wall': ((10, -12, 4), (0, 0, 1))}
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
