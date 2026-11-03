# 地形材质：Poly Haven 2K 原图 → 游戏用 1024 WebP（public/textures/terrain/）。
#   <id>_c.webp  颜色（sRGB）
#   <id>_n.webp  R/G = 法线 XY（OpenGL 约定），B = 粗糙度
#   manifest.json 每张材质的平均颜色（线性空间）与平铺尺寸（米），着色器据此做色调匹配与缩放
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/prep_terrain.py

import json
import os

import numpy as np
from PIL import Image

SRC = 'art/src/polyhaven'
OUT = 'public/textures/terrain'
SIZE = 1024

# 近处一个平铺单元对应的地面尺寸（米）。航拍类材质按实物尺寸，地面/岩壁类适当放大（从空中看不会显得太碎）
TILE = {
    'aerial_grass_rock': 15.0,
    'forest_ground_04': 4.5,
    'coast_sand_01': 10.0,
    'brown_mud_02': 3.2,
    'rock_face': 7.0,
    'cliff_side': 9.0,
    'snow_field_aerial': 45.0,
    'dry_ground_01': 7.0,
    'cracked_red_ground': 5.5,
    'gravelly_sand': 6.5,
    'forest_leaves_02': 4.5,
    'red_laterite_soil_stones': 4.5,
    'mossy_rock': 7.0,
    'aerial_rocks_02': 30.0,
    'rocky_terrain_02': 40.0,
}


def srgb_to_lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    total = 0
    for tid, tile in TILE.items():
        base = os.path.join(SRC, tid, tid)
        c = Image.open(f'{base}_diffuse_2k.jpg').convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        n = Image.open(f'{base}_nor_gl_2k.jpg').convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        r = Image.open(f'{base}_rough_2k.jpg').convert('L').resize((SIZE, SIZE), Image.LANCZOS)
        nr = Image.merge('RGB', (n.getchannel('R'), n.getchannel('G'), r))
        cp = os.path.join(OUT, f'{tid}_c.webp')
        npth = os.path.join(OUT, f'{tid}_n.webp')
        c.save(cp, 'WEBP', quality=84, method=6)
        nr.save(npth, 'WEBP', quality=90, method=6)
        arr = srgb_to_lin(np.asarray(c, dtype=np.float32) / 255.0)
        mean = arr.reshape(-1, 3).mean(axis=0)
        manifest[tid] = {'mean': [round(float(x), 5) for x in mean], 'tile': tile}
        sz = os.path.getsize(cp) + os.path.getsize(npth)
        total += sz
        print(f'{tid:26s} {sz / 1e6:.2f} MB  mean {manifest[tid]["mean"]}')
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, indent=1)
    print(f'total {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
