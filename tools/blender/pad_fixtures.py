"""Low-profile helipad perimeter lamp and recessed tie-down ring.

Original geometry, no downloaded assets. Dimensions are in metres.
blender -b --factory-startup --python tools/blender/pad_fixtures.py -- public/models/pad_fixtures.glb --preview tmp/pad-fixtures
The three material batches are instanced across every pad at runtime.
"""
import math
import os
import sys
import bpy

sys.path.insert(0, os.path.dirname(__file__))
import bkit as K

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
output = args[0] if args else 'public/models/pad_fixtures.glb'
preview = args[args.index('--preview') + 1] if '--preview' in args else None
K.reset()

yellow = K.material('pad_housing', 0xbba345, rough=0.48, metal=0.45)
steel = K.material('pad_steel', 0x59636b, rough=0.43, metal=0.8)
lens = K.material('pad_lens', 0x8adbb0, rough=0.16, metal=0.1, emit=0x50e697, emit_strength=0.35)

# An inset base plate, tapered weatherproof housing, raised lens and fixing bolts.
body = [K.cylinder('base', 0.19, 0.025, (0, 0, 0.015), yellow, 32, bevel=0.004),
        K.cylinder('housing', 0.135, 0.08, (0, 0, 0.065), yellow, 32, r2=0.105, bevel=0.005),
        K.torus('bezel', 0.106, 0.012, (0, 0, 0.109), yellow, 32, 6)]
for i in range(4):
    a = math.pi * 0.25 + i * math.pi / 2
    x, y = math.cos(a) * 0.155, math.sin(a) * 0.155
    body.append(K.cylinder('bolt', 0.014, 0.012, (x, y, 0.035), yellow, 6))
housing = K.join(body, 'lamp_housing')
glass = K.join([K.sphere('lens', 0.10, (0, 0, 0.113), lens, 24, 10, scale=(1, 1, 0.58))], 'lamp_lens')

# A flush mounting plate and a low loop: decorative only, outside the skid area.
tie = [K.cylinder('socket', 0.16, 0.018, (0, 0, 0.011), steel, 24),
       K.torus('loop', 0.085, 0.014, (0, 0, 0.035), steel, 24, 6, rot=(math.radians(16), 0, 0))]
for x in (-0.115, 0.115):
    tie.append(K.cylinder('fastener', 0.013, 0.012, (x, 0, 0.026), steel, 6))
ring = K.join(tie, 'tie_ring')
objects = [housing, glass, ring]
# Export in local origin; the renderer places each named part independently.
K.export_glb(output, objects, draco=True)
print('PAD_FIXTURES', os.path.getsize(output), 'bytes', sum(len(o.data.polygons) for o in objects), 'faces')

if preview:
    os.makedirs(preview, exist_ok=True)
    ring.location.x = 0.55
    ground = K.box('display_ground', (3, 3, 0.1), (0.2, 0, -0.065), K.material('preview_ground', 0x414b53, rough=0.85))
    K.world_sky(strength=0.7, sun_strength=3)
    cam = K.camera('preview', (1.0, 1.2, 0.85), (0.2, 0, 0.05), lens_mm=55)
    K.render(os.path.join(preview, 'fixtures.png'), cam, (1200, 800), samples=32)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(preview, 'fixtures.blend')))
