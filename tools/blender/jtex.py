# 日式建筑的程序贴图（全部可无缝平铺）：art/out/tex/
#   kawara_cells_diffuse_1024.jpg  本瓦屋面（近景几何瓦用）：16 × 16 格，每格 = 一垄筒瓦 + 一条平瓦沟 × 一行瓦，
#                                  每块瓦深浅略有不同，沟里有雨水痕，接缝处略暗。
#   kawara_flat_diffuse_1024.jpg / kawara_flat_nor_gl_1024.jpg / kawara_flat_rough_1024.jpg
#                                  中景平板屋面：同样的格子，再加上由瓦面高度场算出的法线和烘进去的明暗，
#                                  远看与近景几何瓦一致。
#   granite_diffuse_1024.jpg       花岗岩条石（台基、踏石）：米灰底色 + 黑云母 / 白长石斑点 + 风化污渍。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/jtex.py
# 尺寸约定与 jparts.py 一致：一格 = 0.30 m（垄距）× 0.30 m（行距），筒瓦半径 0.075 m。

import os

import numpy as np
from PIL import Image

T = 'art/out/tex'
N = 1024
CELLS = 16
CP = N // CELLS  # 每格像素
P, L, R = 0.30, 0.30, 0.075
DEPTH, STEP = 0.02, 0.018
LIP = 0.08  # 每格底部 8% 是瓦的前沿（台阶立面）
rng = np.random.default_rng(20261103)


def save(arr, name, gray=False):
    a = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(a, 'L' if gray else 'RGB').save(os.path.join(T, name), quality=90)
    print('ok', name)


def pnoise(n, scale, aspect=1.0):
    """可平铺的低频噪声（白噪声在频域里低通）：scale = 特征尺寸（像素）。aspect>1 时沿 y 拉长。"""
    w = rng.standard_normal((n, n))
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    f2 = (fx * scale) ** 2 + (fy * scale * aspect) ** 2
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * np.exp(-f2 * 4.0)))
    out -= out.mean()
    return out / (out.std() + 1e-9)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ 本瓦格子
# 纹理坐标：x → 沿檐口（格内 0.5 处是筒瓦中心，0/1 处是平瓦沟中心），y（图像向上）→ 顺坡向上（格内 0 = 该行瓦的下沿）
ys, xs = np.mgrid[0:N, 0:N].astype(np.float64)
gx = (xs + 0.5) / CP
gv = (N - ys - 0.5) / CP  # 图像第 0 行在上，UV 的 v 向上
fx = gx % 1.0
fv = gv % 1.0
course = np.floor(gv).astype(int) % CELLS
rr = R / P  # 筒瓦在格内所占的半宽（0.25）
dx = np.abs(fx - 0.5)
on_roll = dx < rr
roll_idx = np.floor(gx).astype(int) % CELLS
flat_idx = np.floor(gx + 0.5).astype(int) % CELLS  # 平瓦以格边为中心
a_roll = np.clip(dx / rr, 0, 1)  # 0 = 筒瓦顶，1 = 筒瓦脚
e_flat = np.clip((dx - rr) / (0.5 - rr), 0, 1)  # 0 = 筒瓦脚，1 = 沟中心
lip = fv < LIP
fv_s = np.clip((fv - LIP) / (1 - LIP), 0, 1)  # 斜面部分 0..1

# 每块瓦一个色调（亮度 ±7%，少数偏蓝 / 偏褐）
tint_roll = 1 + 0.045 * rng.standard_normal((CELLS, CELLS))
tint_flat = 1 + 0.04 * rng.standard_normal((CELLS, CELLS))
hue_roll = rng.standard_normal((CELLS, CELLS, 3)) * 0.004
hue_flat = rng.standard_normal((CELLS, CELLS, 3)) * 0.0035
t = np.where(on_roll, tint_roll[roll_idx, course], tint_flat[flat_idx, course])
hue = np.where(on_roll[..., None], hue_roll[roll_idx, course], hue_flat[flat_idx, course])

ROLL = np.array([0.40, 0.405, 0.415])
FLAT = np.array([0.33, 0.335, 0.345])
base = np.where(on_roll[..., None], ROLL, FLAT) * t[..., None] + hue

# 雨水痕：沿坡向的竖向条纹，主要在沟里
streak = pnoise(N, 10, aspect=12.0)
streak_w = np.where(on_roll, 0.35, 1.0)
grime = np.clip(streak, -2, 2) * 0.045 * streak_w
# 大块风化斑（几米尺度的明暗起伏）与细颗粒
blot = pnoise(N, 90) * 0.035
grain = rng.standard_normal((N, N)) * 0.018
# 稀疏的浅色地衣 / 盐霜小点（主要在筒瓦顶）
lichen = (pnoise(N, 2.5) > 2.6) & (rng.random((N, N)) < 0.6)
lichen = lichen & (on_roll | (rng.random((N, N)) < 0.3))

# 烘进去的遮挡（近景几何本身有明暗，这里只做轻微的接缝与凹角）
ao_cells = np.ones((N, N))
ao_cells *= np.where(on_roll, 1 - 0.14 * a_roll ** 4, 1 - 0.22 * np.exp(-e_flat * 5.0))
ao_cells *= 1 - 0.20 * smoothstep(0.80, 1.0, fv)  # 被上一行瓦压住的位置
ao_cells *= np.where(lip, 0.86, 1.0)  # 瓦的前沿立面


def compose(ao):
    c = base * ao[..., None] * (1 + grime + blot + grain)[..., None]
    c = np.where(lichen[..., None], c * 0.55 + np.array([0.70, 0.71, 0.64]) * 0.45, c)
    return c


save(compose(ao_cells), 'kawara_cells_diffuse_1024.jpg')

# ------------------------------------------------------------------ 平板屋面（中景）：高度场 → 法线 + 更强的明暗
# 高度（米）：筒瓦半圆 + 平瓦浅沟 + 每行台阶（锯齿）
h_roll = np.sqrt(np.clip(R ** 2 - (dx * P) ** 2, 0, None))
h_flat = -DEPTH * np.sin(np.pi * 0.5 * e_flat) ** 2
H = np.where(on_roll, h_roll, h_flat) + STEP * (1 - fv)
# 前沿立面用一个陡坡近似（像素尺度上本来就接近竖直）
mpp = P / CP  # 每像素米数
gx_ = (np.roll(H, -1, axis=1) - np.roll(H, 1, axis=1)) / (2 * mpp)  # 周期中心差分，保证无缝
gy_ = (np.roll(H, -1, axis=0) - np.roll(H, 1, axis=0)) / (2 * mpp)
# 图像 y 向下为正，换到 UV（v 向上）：dH/dv = -dH/dy
dhdu = gx_
dhdv = -gy_
nrm = np.stack([-dhdu, -dhdv, np.ones_like(H)], -1)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
save(nrm * 0.5 + 0.5, 'kawara_flat_nor_gl_1024.jpg')
ao_flat = ao_cells * np.where(on_roll, 1.0, 0.92) * (1 - 0.18 * smoothstep(0.75, 1.0, fv))
ao_flat *= np.where(on_roll, 1 + 0.10 * (1 - a_roll ** 2), 1.0)  # 筒瓦顶受光
save(compose(ao_flat), 'kawara_flat_diffuse_1024.jpg')
rough = 0.52 + 0.10 * np.where(on_roll, -0.5, 0.6) + grime * 1.5 + blot * 0.8
save(np.clip(rough, 0, 1), 'kawara_flat_rough_1024.jpg', gray=True)

# ------------------------------------------------------------------ 花岗岩（1 m 一个平铺单元）
g_low = pnoise(N, 120) * 0.05 + pnoise(N, 30) * 0.035
G = np.array([0.66, 0.62, 0.56])[None, None, :] * (1 + g_low)[..., None]
# 黑云母：密集的小黑点；白长石：稍大的浅色斑；少量锈色
spots = rng.random((N, N))
mica = pnoise(N, 1.2) > 1.25
G = np.where(mica[..., None], G * 0.38, G)
feld = (pnoise(N, 3.0) > 1.4) & (spots < 0.7)
G = np.where(feld[..., None], G * 0.6 + np.array([0.86, 0.84, 0.80]) * 0.4, G)
rust = pnoise(N, 60) > 2.1
G = np.where(rust[..., None], G * np.array([1.04, 0.97, 0.88]), G)
# 雨水污渍（沿竖向）与细颗粒
G *= (1 + np.clip(pnoise(N, 14, aspect=8.0), -2, 2) * 0.035 + rng.standard_normal((N, N)) * 0.025)[..., None]
# 斑点很细，1024 张存成 WebP 体积大；先缩到 512 再放回 1024 尺寸（文件名不变，材质代码不用改）
G = np.asarray(Image.fromarray((np.clip(G, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS).resize((N, N), Image.BICUBIC), dtype=np.float64) / 255
save(G, 'granite_diffuse_1024.jpg')

# ------------------------------------------------------------------ 碎石院子（1 m 一个平铺单元）：可平铺的 Voronoi 小石子
from scipy.spatial import cKDTree  # noqa: E402

# 抖动网格取点（比纯随机均匀，避免挤成一团的细碎小格）
gn = 84
gy_, gx_ = np.mgrid[0:gn, 0:gn]
pts = (np.stack([gx_.ravel(), gy_.ravel()], -1) + 0.5 + (rng.random((gn * gn, 2)) - 0.5) * 0.85) * (N / gn)
# 平铺：把点复制到 3×3 邻格，查询最近点时边界无缝
tiles = np.concatenate([pts + np.array([dx, dy]) * N for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
tree = cKDTree(tiles)
qy, qx = np.mgrid[0:N, 0:N]
q = np.stack([qx.ravel() + 0.5, qy.ravel() + 0.5], -1)
dist, idx = tree.query(q, k=2)
cell = (idx[:, 0] % len(pts)).reshape(N, N)
d0 = dist[:, 0].reshape(N, N)
edge = (dist[:, 1] - dist[:, 0]).reshape(N, N)
# 每颗石子：灰米色明暗不一，极少量偏暖 / 偏冷；圆顶状受光（中心亮、边缘暗），石缝发黑
tint = 0.62 + 0.42 * rng.random(len(pts))
warm = rng.standard_normal(len(pts)) * 0.03
rad = d0 + edge * 0.5  # 近似的石子半径
dome = np.sqrt(np.clip(1.0 - (d0 / np.maximum(rad, 1.0)) ** 2, 0.0, 1.0))
gap = smoothstep(0.6, 2.2, edge)
lum = 1.2 * tint[cell] * (0.6 + 0.4 * dome) * (0.45 + 0.55 * gap)
Gc = np.stack([lum * (0.60 + warm[cell]), lum * 0.575, lum * (0.54 - warm[cell])], -1)
Gc *= (1 + pnoise(N, 80) * 0.07 + rng.standard_normal((N, N)) * 0.025)[..., None]
# 同花岗岩：缩到 512 再放回（去掉最细的高频，WebP 体积小很多，游戏距离下看不出差别）
Gc = np.asarray(Image.fromarray((np.clip(Gc, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS).resize((N, N), Image.BICUBIC), dtype=np.float64) / 255
save(Gc, 'gravel_diffuse_1024.jpg')
