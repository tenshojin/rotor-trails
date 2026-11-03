# 把座舱（含机身外壳）与外观两个 GLB 一起导入，渲染整机预览图。
# 运行：blender -b --factory-startup --python tools/blender/preview_heli.py -- <输出目录>

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'art/out/heli_preview'
K.reset()
for f in ('public/models/cockpit.glb', 'public/models/heli_ext.glb'):
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(f))
# glTF 是 Y 上坐标，导入后 Blender 会转回 Z 上
K.world_sky(1.0, sun_dir=(0.45, -0.5, 0.75), sun_strength=4.5)
ground = K.box('ground', (60, 60, 0.1), (0, 0, -1.40), K.material('ground', 0x7a7a72, rough=0.9))
os.makedirs(OUT, exist_ok=True)
views = {
    'heli_34front': ((7.0, 8.5, 2.2), (0, 0.3, 0.2)),
    'heli_side': ((11.5, -2.5, 1.2), (0, -2.4, 0.4)),
    'heli_34rear': ((-8.0, -11.0, 3.4), (0, -2.0, 0.6)),
}
for nm, (p, t) in views.items():
    cam = K.camera('cam_' + nm, p, t, fov_deg=48)
    K.render(os.path.join(OUT, nm + '.png'), cam, (1200, 800), samples=64)
print('DONE')
