# 程序道具的细节纹理（public/textures/detail/<名字>.webp，512×512）：
#   R/G = 法线 XY（OpenGL 约定），B = 明暗细节（亮度高通，0.5 为平均）
# 着色器用三平面投影采样，叠加在顶点色上（墙面、混凝土、铁皮、木板不再是纯色块）。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/prep_detail.py

import os

import numpy as np
from PIL import Image, ImageFilter

SRC = 'art/src/polyhaven'
OUT = 'public/textures/detail'
SIZE = 512
LAYERS = {
    'plaster': 'white_plaster_02',
    'concrete': 'concrete_wall_008',
    'corrugated': 'corrugated_iron',
    'planks': 'hinoki_planks',
    # 片石干砌墙（锡金拉布登孜遗址，CC0）：喜马拉雅石屋与石墙、峡湾的石砌地基
    'stone': 'rabdentse_ruins_wall',
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, tid in LAYERS.items():
        base = os.path.join(SRC, tid, tid)
        c = Image.open(f'{base}_diffuse_2k.jpg').convert('L').resize((SIZE, SIZE), Image.LANCZOS)
        n = Image.open(f'{base}_nor_gl_2k.jpg').convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        # 亮度高通：去掉大块明暗，只留细节（大块颜色由顶点色决定）
        L = np.asarray(c, dtype=np.float32) / 255.0
        low = np.asarray(c.filter(ImageFilter.GaussianBlur(SIZE / 16)), dtype=np.float32) / 255.0
        d = np.clip(0.5 + (L - low) * 1.6, 0, 1)
        arr = np.asarray(n, dtype=np.uint8).copy()
        arr[..., 2] = (d * 255 + 0.5).astype(np.uint8)
        p = os.path.join(OUT, f'{name}.webp')
        Image.fromarray(arr, 'RGB').save(p, 'WEBP', quality=88, method=6)
        print(name, f'{os.path.getsize(p) / 1e3:.0f} KB')


if __name__ == '__main__':
    main()
