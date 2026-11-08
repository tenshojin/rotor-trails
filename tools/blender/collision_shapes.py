# 模型的碰撞箱：把模型切成小方块（体素）、把里面填实，再贪心地拼成几个盒子。
# 一个大盒子罩住整条船会有“空气墙”（甲板上方、桅杆两边），拼几个盒子贴着外形走。
# 结果写成 src/world/modelShapes.ts（模型自己的坐标：x 沿长边、y 向上、z 横向，单位米）。
# 运行：blender -b --factory-startup --python tools/blender/collision_shapes.py -- src/world/modelShapes.ts
# 要加模型：把名字写进下面的 MODELS（glb 文件 → [(模型名, 最多几个盒子)]）。

import math
import os
import sys

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(ROOT, 'src', 'world', 'modelShapes.ts')

MODELS = {
    'public/models/props_japan.glb': [
        ('ferry_jp', 10), ('boat_0', 8), ('car_white', 3), ('car_silver', 3), ('car_blue', 3), ('car_red', 3),
        ('van_white', 3), ('van_grey', 3), ('kei_truck', 3), ('bollard', 1), ('quay_seg', 3), ('pier_seg', 6),
        ('street_lamp', 3), ('light_mast', 3), ('fish_boxes', 3), ('net_a', 3), ('net_b', 3), ('torii', 8),
        ('pallets_a', 3), ('pallets_b', 3), ('forklift', 8),
    ],
    'public/models/props_amazon.glb': [('river_boat', 8)],
    'public/models/props_training.glb': [('plane_fly', 8)],
}
# 这些模型和上面某个模型的形状一模一样（只是颜色不同）
ALIAS = {'boat_1': 'boat_0', 'boat_2': 'boat_0', 'boat_3': 'boat_0', 'boat_f0': 'boat_0', 'boat_f1': 'boat_0', 'boat_f2': 'boat_0', 'plane_a': 'plane_fly'}

FILL = 0.7  # 一个盒子里至少七成是实的


def triangles(root):
    """模型所有网格的三角形（glTF 坐标：x、y 上、z），形状 (n, 3, 3)"""
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    stack = [root]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n = len(me.vertices)
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(n, 3)
        M = np.array(o.matrix_world)
        co = co @ M[:3, :3].T + M[:3, 3]
        tri = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get('vertices', tri)
        ev.to_mesh_clear()
        t = co[tri.reshape(-1, 3)]
        # Blender (x, y, z) → glTF (x, z, -y)
        out.append(np.stack([t[..., 0], t[..., 2], -t[..., 1]], axis=-1))
    return np.concatenate(out) if out else np.zeros((0, 3, 3), np.float32)


def bary(n):
    pts = [(i / n, j / n) for i in range(n + 1) for j in range(n + 1 - i)]
    return np.array(pts, np.float32)


def voxelize(tris, v):
    lo = tris.reshape(-1, 3).min(0) - 2 * v
    hi = tris.reshape(-1, 3).max(0) + 2 * v
    dims = np.ceil((hi - lo) / v).astype(int) + 1
    surf = np.zeros(dims, bool)
    A, B, C = tris[:, 0], tris[:, 1], tris[:, 2]
    edge = np.maximum(np.linalg.norm(B - A, axis=1), np.maximum(np.linalg.norm(C - A, axis=1), np.linalg.norm(C - B, axis=1)))
    ns = np.clip(np.ceil(edge / (v * 0.45)).astype(int), 1, 400)
    for n in np.unique(ns):
        sel = ns == n
        w = bary(int(n))
        a, b = w[:, 0], w[:, 1]
        for k in range(0, int(sel.sum()), 2000):
            idx = np.nonzero(sel)[0][k:k + 2000]
            P = A[idx, None, :] + a[None, :, None] * (B - A)[idx, None, :] + b[None, :, None] * (C - A)[idx, None, :]
            ijk = np.floor((P.reshape(-1, 3) - lo) / v).astype(int)
            surf[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    return surf, lo


def dilate(m):
    d = m.copy()
    d[1:] |= m[:-1]
    d[:-1] |= m[1:]
    d[:, 1:] |= m[:, :-1]
    d[:, :-1] |= m[:, 1:]
    d[:, :, 1:] |= m[:, :, :-1]
    d[:, :, :-1] |= m[:, :, 1:]
    return d


def fill(surf):
    """填实：外面一圈往里漫，漫不到的就是里面。先把表面加厚一层，堵住小缝"""
    wall = dilate(surf)
    ext = np.zeros_like(surf)
    ext[0, :, :] = ext[-1, :, :] = True
    ext[:, 0, :] = ext[:, -1, :] = True
    ext[:, :, 0] = ext[:, :, -1] = True
    ext &= ~wall
    while True:
        grown = dilate(ext) & ~wall
        if grown.sum() == ext.sum():
            break
        ext = grown
    solid = ~ext
    # 加厚的那层还回去：实心部分往里收一层，原来的表面留着
    inner = ~dilate(~solid)
    return inner | surf


def grow(solid, rem, seed):
    """从一个种子往六个方向长，长到再长一层就不够实为止。返回盒子和盖住了多少还没盖住的方块"""
    i0 = i1 = seed[0]
    j0 = j1 = seed[1]
    k0 = k1 = seed[2]
    X, Y, Z = solid.shape
    while True:
        best = None
        for d in range(6):
            if d == 0 and i0 > 0:
                lay = (slice(i0 - 1, i0), slice(j0, j1 + 1), slice(k0, k1 + 1))
            elif d == 1 and i1 < X - 1:
                lay = (slice(i1 + 1, i1 + 2), slice(j0, j1 + 1), slice(k0, k1 + 1))
            elif d == 2 and j0 > 0:
                lay = (slice(i0, i1 + 1), slice(j0 - 1, j0), slice(k0, k1 + 1))
            elif d == 3 and j1 < Y - 1:
                lay = (slice(i0, i1 + 1), slice(j1 + 1, j1 + 2), slice(k0, k1 + 1))
            elif d == 4 and k0 > 0:
                lay = (slice(i0, i1 + 1), slice(j0, j1 + 1), slice(k0 - 1, k0))
            elif d == 5 and k1 < Z - 1:
                lay = (slice(i0, i1 + 1), slice(j0, j1 + 1), slice(k1 + 1, k1 + 2))
            else:
                continue
            s = solid[lay]
            if s.mean() < FILL:
                continue
            # 主要看能新盖住多少；已经盖住的实心只用来打破平局（不然会长出一个和前面差不多的盒子）
            gain = rem[lay].sum() + 0.02 * s.sum()
            if best is None or gain > best[0]:
                best = (gain, d)
        if best is None:
            break
        d = best[1]
        if d == 0:
            i0 -= 1
        elif d == 1:
            i1 += 1
        elif d == 2:
            j0 -= 1
        elif d == 3:
            j1 += 1
        elif d == 4:
            k0 -= 1
        else:
            k1 += 1
    box = (i0, i1, j0, j1, k0, k1)
    return box, rem[i0:i1 + 1, j0:j1 + 1, k0:k1 + 1].sum()


def boxes_for(tris, kmax):
    ext = tris.reshape(-1, 3).max(0) - tris.reshape(-1, 3).min(0)
    v = float(np.clip(ext.max() / 56, 0.06, 0.45))
    surf, lo = voxelize(tris, v)
    solid = fill(surf)
    rem = solid.copy()
    total = solid.sum()
    out = []
    rng = np.random.default_rng(7)
    while len(out) < kmax and rem.sum() > total * 0.01:
        pts = np.argwhere(rem)
        cand = pts[rng.choice(len(pts), size=min(48, len(pts)), replace=False)]
        best = None
        for c in cand:
            b, g = grow(solid, rem, c)
            # 主要盖新的：一个盒子大半都是前面盖过的，就是重复的盒子（船身弧线边上的一条条缝），分数打折
            vol = (b[1] - b[0] + 1) * (b[3] - b[2] + 1) * (b[5] - b[4] + 1)
            score = g * (0.25 + 0.75 * g / vol)
            if best is None or score > best[2]:
                best = (b, g, score)
        (i0, i1, j0, j1, k0, k1), g, _ = best
        # 小到几乎没有的就不要了（但驾驶台、烟囱这种体积不大、撞得到的东西要留着）
        if g < max(total * 0.0005, 6):
            break
        rem[i0:i1 + 1, j0:j1 + 1, k0:k1 + 1] = False
        bmin = lo + np.array([i0, j0, k0]) * v
        bmax = lo + np.array([i1 + 1, j1 + 1, k1 + 1]) * v
        out.append(((bmin + bmax) / 2, (bmax - bmin) / 2))
    # 盒子不能比模型本身大：夹回模型的包围盒
    mlo = tris.reshape(-1, 3).min(0)
    mhi = tris.reshape(-1, 3).max(0)
    fixed = []
    for c, h in out:
        a = np.maximum(c - h, mlo)
        b = np.minimum(c + h, mhi)
        fixed.append(((a + b) / 2, np.maximum((b - a) / 2, 0.03)))
    left = rem.sum() / max(1, total)
    return fixed, v, left


def main():
    lines = []
    report = []
    for glb, names in MODELS.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, glb))
        objs = {o.name: o for o in bpy.data.objects}
        for name, kmax in names:
            root = objs.get(name)
            if root is None:
                print('MISSING', glb, name)
                continue
            tris = triangles(root)
            if not len(tris):
                print('EMPTY', name)
                continue
            bx, v, left = boxes_for(tris, kmax)
            lo = tris.reshape(-1, 3).min(0)
            hi = tris.reshape(-1, 3).max(0)
            report.append(f'{name}: {len(bx)} 个盒子，体素 {v:.2f} m，没盖住 {left * 100:.1f}%，包围盒 {np.round(lo, 2)} ~ {np.round(hi, 2)}')
            rows = ', '.join('[' + ', '.join(f'{x:.2f}' for x in (*c, *h)) + ']' for c, h in bx)
            lines.append(f'  {name}: [{rows}],')
    for a, b in ALIAS.items():
        lines.append(f"  {a}: SHAPES_{b},")
    head = [
        '// 由 tools/blender/collision_shapes.py 生成，不要手改（改了模型就重新跑一遍）。',
        '// 模型的碰撞箱：模型自己的坐标（x 沿长边、y 向上、z 横向，米），每个盒子 [中心 x, y, z, 半长 x, y, z]。',
        '// 用在：只放了 Blender 模型、没有自己的碰撞体的道具（PropBuilder.endModel），和会动的船、车、飞机（sim/movers.ts）。',
        '',
        'export type ShapeBox = readonly [number, number, number, number, number, number];',
        '',
    ]
    # 别名要引用同一份数组：先把被引用的单独定义出来
    body = []
    named = {}
    for ln in lines:
        key = ln.strip().split(':')[0]
        named[key] = ln
    consts = []
    for b in sorted(set(ALIAS.values())):
        if b in named:
            arr = named[b].split(': ', 1)[1].rstrip(',')
            consts.append(f'const SHAPES_{b}: ShapeBox[] = {arr};')
            named[b] = f'  {b}: SHAPES_{b},'
    body.append('export const MODEL_SHAPES: Readonly<Record<string, readonly ShapeBox[]>> = {')
    for ln in lines:
        key = ln.strip().split(':')[0]
        body.append(named.get(key, ln))
    body.append('};')
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(head + consts + [''] + body) + '\n')
    print('\n'.join(report))
    print('WROTE', OUT)


main()
