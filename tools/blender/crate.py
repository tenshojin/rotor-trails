# 停机坪上卸下来的木货箱：托盘（三根垫木 + 底板）、四面横着钉的木板（板缝之间留一道缝）、竖着的护角、盖子。
# 颜色都在顶点色里（一种材质），导出 public/models/crate.glb，游戏里 src/render/padLife.ts 实例绘制。
# 运行：blender -b --factory-startup --python tools/blender/crate.py -- public/models/crate.glb
# 坐标：Blender（Z 上），底面中心在原点，1.1 米见方。

import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402


def lin(r, g, b):
    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


def vc_material(name='crate'):
    """顶点色当底色的材质（导出时才会把顶点色写进 glTF）"""
    m = K.material(name, 0xffffff, rough=0.78)
    nt = m.node_tree
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], nt.nodes.get('Principled BSDF').inputs['Base Color'])
    return m


def _board(name, size, center, rgba, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(center)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', list(rgba) * len(me.vertices))
    return ob


def build_crate(mat, name='crate'):
    rng = random.Random(7)
    wood = [lin(0.70 + rng.uniform(-0.05, 0.05), 0.54 + rng.uniform(-0.04, 0.04), 0.34 + rng.uniform(-0.03, 0.03)) for _ in range(40)]
    dark = lin(0.46, 0.34, 0.20)
    parts = []
    W, H = 1.0, 0.86
    for i, x in enumerate((-0.44, 0.0, 0.44)):
        parts.append(_board(f'skid{i}', (0.09, 1.08, 0.10), (x, 0, 0.05), dark, mat))
    parts.append(_board('deck', (1.08, 1.08, 0.025), (0, 0, 0.112), wood[0], mat))
    n = 6
    ph = (H - 0.02) / n
    k = 1
    for i in range(n):
        z = 0.125 + ph * (i + 0.5)
        for (sx, sy, nx, ny) in ((W, 0.022, 0, 1), (W, 0.022, 0, -1), (0.022, W, 1, 0), (0.022, W, -1, 0)):
            parts.append(_board(f'plank{k}', (sx, sy, ph - 0.012), (nx * (W / 2), ny * (W / 2), z), wood[k % len(wood)], mat))
            k += 1
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_board(f'corner{sx}{sy}', (0.07, 0.07, H), (sx * (W / 2 + 0.005), sy * (W / 2 + 0.005), 0.125 + H / 2), dark, mat))
    for i in range(5):
        parts.append(_board(f'lid{i}', (W + 0.04, (W + 0.04) / 5 - 0.01, 0.025), (0, -W / 2 + (i + 0.5) * W / 5, 0.125 + H + 0.012), wood[(i * 7) % len(wood)], mat))
    crate = K.join(parts, name)
    K.uv_box(crate, 1 / 0.5)
    return crate


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0] if argv else 'public/models/crate.glb'
    K.reset()
    c = build_crate(vc_material())
    K.export_glb(out, [c], qpos=14, qnorm=10)
    print('EXPORTED', out, len(c.data.polygons))
