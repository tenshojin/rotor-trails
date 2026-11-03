# 建筑贴图的颜色变体（保留原图明暗细节，换色相/饱和度）：art/out/tex/<变体>_diffuse_1024.jpg
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/tex_variants.py

import os

import numpy as np
from PIL import Image

T = 'art/out/tex'


def load(tid):
    return np.asarray(Image.open(os.path.join(T, f'{tid}_diffuse_1024.jpg')).convert('RGB'), dtype=np.float32) / 255.0


def save(arr, name):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(T, f'{name}_diffuse_1024.jpg'), quality=88)
    print('ok', name)


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def colorize(src, rgb, contrast=1.0, mix=1.0):
    """按亮度起伏给图像换成指定颜色：输出 = 颜色 × (亮度/平均亮度)^contrast"""
    L = lum(src)
    k = (L / max(1e-3, L.mean())) ** contrast
    out = np.asarray(rgb, dtype=np.float32)[None, None, :] * k[..., None]
    return src * (1 - mix) + out * mix


a = load('japanese_cedar_planks')
save(colorize(a, (0.23, 0.15, 0.10), 1.3), 'yakisugi')  # 炭化杉板（深褐）
save(colorize(a, (0.52, 0.38, 0.24), 1.1), 'cedar_brown')  # 普通杉板（中褐）
a = load('grey_roof_tiles')
save(colorize(a, (0.25, 0.27, 0.30), 1.25), 'kawara')  # 蓝灰瓦（去掉黄色苔藓）
a = load('distressed_painted_planks')
save(colorize(a, (0.50, 0.11, 0.08), 0.9, 0.92), 'falu_red')  # 挪威法伦红木板
save(colorize(a, (0.86, 0.85, 0.80), 0.7, 0.9), 'white_planks')  # 白色木板
save(colorize(a, (0.78, 0.62, 0.26), 0.9, 0.9), 'ochre_planks')  # 赭黄木板
a = load('white_plaster_02')
save(colorize(a, (0.86, 0.85, 0.82), 0.6), 'plaster_white')
a = load('clay_plaster')
save(colorize(a, (0.80, 0.76, 0.68), 0.8), 'plaster_cream')  # 尼泊尔/土坯外墙的浅色灰泥
