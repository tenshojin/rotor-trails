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
save(colorize(a, (0.34, 0.19, 0.12), 1.35), 'sugi_weathered')  # 风化杉板（鞆之浦町家的红褐色竖板）
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

# ---- 其他地图的建筑（挪威木屋 / 夏尔巴石屋 / 寺院 / 土坯房）
a = load('distressed_painted_planks')
save(colorize(a, (0.83, 0.66, 0.22), 0.9, 0.9), 'yellow_planks')  # 挪威黄色木屋
save(colorize(a, (0.36, 0.47, 0.54), 0.9, 0.9), 'bluegrey_planks')  # 灰蓝木屋
a = load('japanese_cedar_planks')
save(colorize(a, (0.13, 0.09, 0.065), 1.35), 'tar_planks')  # 涂焦油的木板（木板教堂、船屋）
save(colorize(a, (0.40, 0.29, 0.19), 1.2), 'raw_planks')  # 未上漆的木板（高脚屋、码头）
save(colorize(a, (0.52, 0.49, 0.44), 1.1), 'grey_planks')  # 风吹日晒成银灰色的旧木板（船屋）
a = load('grey_roof_tiles')
save(colorize(a, (0.10, 0.10, 0.11), 1.3), 'black_tiles')  # 挪威常见的黑色釉面瓦
a = load('corrugated_iron')
save(colorize(a, (0.16, 0.30, 0.55), 0.9, 0.85), 'corr_blue')  # 夏尔巴民居的彩色铁皮屋顶
save(colorize(a, (0.20, 0.42, 0.26), 0.9, 0.85), 'corr_green')
save(colorize(a, (0.55, 0.14, 0.10), 0.9, 0.85), 'corr_red')
save(colorize(a, (0.80, 0.80, 0.78), 0.8, 0.85), 'corr_white')  # 集装箱、科考站外壳
a = load('rabdentse_ruins_wall')
save(colorize(a, (0.86, 0.85, 0.82), 0.7, 0.85), 'stone_whitewash')  # 刷白的石墙
a = load('clay_plaster')
save(colorize(a, (0.66, 0.50, 0.36), 0.9), 'adobe_tan')  # 土坯（棕褐）
save(colorize(a, (0.76, 0.60, 0.44), 0.9), 'adobe_light')
save(colorize(a, (0.47, 0.13, 0.12), 0.8), 'plaster_maroon')  # 寺院的绛红色墙
a = load('thatch_roof_angled')
save(colorize(a, (0.56, 0.45, 0.29), 1.0, 0.85), 'thatch_warm')  # 棕榈叶茅草（偏暖的干草色）


def shingles():
    """涂焦油的鱼鳞状木瓦（木板教堂屋面）：程序生成漫反射 + 法线 + 粗糙度。一张 = 8 列 × 6 行，上下左右无缝。
    纹理 v 向上 = 沿屋面向屋脊；木瓦尖头朝下（朝屋檐）。"""
    S = 1024
    cols, rows = 8, 6
    cw, rh = S / cols, S / rows
    rng = np.random.default_rng(5)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.floor(yy / rh)
    fy = (yy / rh) % 1.0
    ext = 0.32

    def cols_of(ri):
        u = xx / cw + (ri % 2) * 0.5
        return u % 1.0, np.floor(u) % cols

    cxa, cia = cols_of(r - 1)
    cov = fy < ext * (1 - np.abs(2 * cxa - 1))  # 上一行木瓦的尖头盖住本行顶部
    cxb, cib = cols_of(r)
    rid = np.where(cov, (r - 1) % rows, r)
    cx = np.where(cov, cxa, cxb)
    ci = np.where(cov, cia, cib)
    t = np.where(cov, fy + 1.0, fy)
    v = t / (1.0 + ext * (1 - np.abs(2 * cx - 1)))
    edge = np.minimum(cx, 1 - cx)
    gap = np.clip(edge / 0.035, 0, 1)
    h = (0.2 + 0.8 * v) * (0.55 + 0.45 * gap)
    tone = rng.random((rows, cols)).astype(np.float32)
    phase = rng.random((rows, cols)).astype(np.float32)
    ri = rid.astype(int) % rows
    cj = ci.astype(int) % cols
    tn = tone[ri, cj]
    grain = np.sin((cx * 9.0 + phase[ri, cj] * 6.0 + np.sin(v * 3.0 + phase[ri, cj] * 9) * 0.6) * np.pi * 2) * 0.5 + 0.5
    base = np.array([0.13, 0.095, 0.07], np.float32)
    light = (0.7 + 0.6 * tn) * (0.88 + 0.12 * grain) * (0.75 + 0.25 * (1 - v ** 6)) * (0.45 + 0.55 * gap)
    col = base[None, None, :] * light[..., None]
    # 少数被日晒褪色的木瓦（偏灰褐）
    fade = (tn > 0.82)[..., None] * np.array([0.05, 0.045, 0.04], np.float32)[None, None, :]
    save(col + fade, 'tar_shingles')
    k = 5.0
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * k
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * k
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray((n * 127.5 + 127.5).clip(0, 255).astype(np.uint8)).save(os.path.join(T, 'tar_shingles_nor_gl_1024.jpg'), quality=92)
    rough = 0.55 + 0.3 * (1 - gap) + 0.12 * grain
    Image.fromarray((rough.clip(0, 1) * 255).astype(np.uint8), 'L').save(os.path.join(T, 'tar_shingles_rough_1024.jpg'), quality=90)
    print('ok tar_shingles')


shingles()
