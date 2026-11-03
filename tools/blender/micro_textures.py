# 驾驶舱材质的微细节贴图（四方连续，1024×1024）：art/out/tex/<名字>_{diffuse,nor_gl,rough}_1024.jpg
#   grain    舱内饰板的皮纹（细小的鹅卵石状凸起）
#   ribmat   橡胶地垫（平行凸棱 + 细微磨损）
#   felt     顶板黑色绒布（细密纤维噪声）
#   seatmesh 防撞座椅的网布（斜向编织）
#   brushed  拉丝金属（单向细纹）
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/micro_textures.py

import os

import numpy as np
from PIL import Image

OUT = 'art/out/tex'
N = 1024
rng = np.random.default_rng(11)


def save_rgb(arr, name):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{name}_1024.jpg'), quality=92)


def save_l(arr, name):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), 'L').save(os.path.join(OUT, f'{name}_1024.jpg'), quality=92)


def band_noise(lo, hi, n=N):
    """四方连续的带通噪声（频域滤波），lo/hi 为每张贴图上的周期数。"""
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx * fx + fy * fy)
    spec = np.fft.fft2(rng.standard_normal((n, n)))
    mask = np.exp(-((np.log(np.maximum(r, 1e-3)) - np.log((lo * hi) ** 0.5)) / (0.5 * np.log(hi / lo) + 1e-6)) ** 2)
    mask[0, 0] = 0
    out = np.real(np.fft.ifft2(spec * mask))
    return (out - out.mean()) / (out.std() + 1e-9)


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def voronoi_f1(cells, n=N):
    """四方连续的 Voronoi 距离场（每个格子一个随机点），返回到最近点的距离（以格子尺寸为单位）。"""
    g = np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing='ij'), -1).reshape(-1, 2) + rng.random((cells * cells, 2))
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) * (cells / n)
    best = np.full((n, n), 9.0, np.float32)
    for (px, py) in g:
        dx = np.abs(xx - px)
        dy = np.abs(yy - py)
        dx = np.minimum(dx, cells - dx)
        dy = np.minimum(dy, cells - dy)
        best = np.minimum(best, np.sqrt(dx * dx + dy * dy))
    return best


os.makedirs(OUT, exist_ok=True)

# ---- 皮纹：Voronoi 鹅卵石 + 细噪声
v = voronoi_f1(48)
pebble = np.clip(1.0 - v * 1.35, 0, 1) ** 0.7
h = pebble + 0.15 * band_noise(120, 400)
save_rgb(normal_from_height(h, 2.2), 'grain_nor_gl')
save_l(0.62 + 0.10 * (1 - pebble) + 0.04 * band_noise(30, 120), 'grain_rough')

# ---- 橡胶地垫：每张 32 条凸棱 + 磨损
y = np.mgrid[0:N, 0:N][0].astype(np.float32)
rib = np.clip(np.sin(y / N * 32 * 2 * np.pi) * 1.6, -1, 1) * 0.5 + 0.5
wear = band_noise(4, 20) * 0.5 + 0.5
h = rib * (0.9 + 0.1 * band_noise(100, 300)) - 0.15 * wear
save_rgb(normal_from_height(h, 3.0), 'ribmat_nor_gl')
save_l(0.86 - 0.18 * np.clip(wear - 0.55, 0, 1) - 0.05 * rib, 'ribmat_rough')
base = np.array([0.075, 0.076, 0.08])
save_rgb(base[None, None, :] * (0.85 + 0.15 * rib[..., None]) * (0.9 + 0.25 * np.clip(wear[..., None] - 0.5, 0, 1)), 'ribmat_diffuse')

# ---- 黑色绒布
fib = band_noise(200, 500)
clump = band_noise(8, 40)
save_rgb(np.stack([0.035 + 0.008 * fib + 0.006 * clump] * 3, -1), 'felt_diffuse')
save_rgb(normal_from_height(fib * 0.6 + clump * 0.3, 1.0), 'felt_nor_gl')
save_l(0.95 + 0.03 * fib, 'felt_rough')

# ---- 座椅网布：斜向编织（两组斜线）
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
a = np.sin((xx + yy) / N * 96 * np.pi)
b = np.sin((xx - yy) / N * 96 * np.pi)
weave = (np.maximum(a, 0) * (b > 0) + np.maximum(b, 0) * (a <= 0))
h = weave + 0.2 * band_noise(150, 400)
save_rgb(normal_from_height(h, 2.5), 'seatmesh_nor_gl')
save_l(0.9 - 0.12 * weave, 'seatmesh_rough')
save_rgb(np.stack([0.05 + 0.03 * weave] * 3, -1) * np.array([1.0, 1.0, 1.05]), 'seatmesh_diffuse')

# ---- 拉丝金属：沿 x 方向的细纹
br = np.zeros((N, N), np.float32)
for k in range(3):
    line = rng.standard_normal(N).astype(np.float32)
    br += np.repeat(line[:, None], N, 1) * (0.5 ** k)
br = (br - br.mean()) / br.std()
save_rgb(normal_from_height(br * 0.4, 1.0), 'brushed_nor_gl')
save_l(0.32 + 0.06 * br, 'brushed_rough')
print('ok', OUT)
