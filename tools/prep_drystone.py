# 干砌石墙的细节纹理（public/textures/detail/drystone.webp，512×512，一个平铺单元 2 m）：
#   R/G = 法线 XY（OpenGL 约定），B = 明暗细节（0.5 为平均），格式与 tools/prep_detail.py 的其他层一样。
# 喜马拉雅、峡湾的田埂墙是不用灰浆的干砌墙：大小不一的石块大致成层，石缝是黑的（阴影），每块石头深浅不同、
# 中间微微鼓起。照片纹理（拉布登孜遗址）是灰浆砌的，缝是浅色的，叠在墙上像抹灰，所以单独程序生成一层。
# 平铺：每一层的高度加起来正好 2 m，每层石块的长度加起来正好 2 m，噪声用 FFT 生成（本身就是周期的）。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/prep_drystone.py

import os

import numpy as np
from PIL import Image

OUT = 'public/textures/detail/drystone.webp'
SIZE = 512
TILE = 2.0  # 米
PX = TILE / SIZE
rng = np.random.default_rng(20261108)


def periodic_noise(size, scale_px, seed):
    """周期噪声：白噪声在频域里按 1/f 衰减、截掉比 scale_px 小的细节"""
    r = np.random.default_rng(seed)
    w = r.standard_normal((size, size))
    f = np.fft.fft2(w)
    ky = np.fft.fftfreq(size)[:, None]
    kx = np.fft.fftfreq(size)[None, :]
    k = np.sqrt(kx * kx + ky * ky)
    filt = np.exp(-(k * scale_px) ** 2) / np.maximum(k, 1.0 / size)
    filt[0, 0] = 0
    n = np.real(np.fft.ifft2(f * filt))
    return (n - n.mean()) / (n.std() + 1e-9)


def main():
    # 层（行）：高 0.16～0.30 m，归一化到正好 2 m
    hs = []
    while sum(hs) < TILE:
        hs.append(rng.uniform(0.16, 0.30))
    hs = np.array(hs) * (TILE / sum(hs))
    y_edges = np.concatenate([[0.0], np.cumsum(hs)])
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    ym = (yy + 0.5) * PX
    xm = (xx + 0.5) * PX
    # 石块轮廓不规则：距离场上叠两层噪声
    warp = periodic_noise(SIZE, 10, 1) * 0.011 + periodic_noise(SIZE, 3, 2) * 0.004
    sdist = np.full((SIZE, SIZE), 1.0)
    tone = np.zeros((SIZE, SIZE))
    dome = np.zeros((SIZE, SIZE))
    sid = np.zeros((SIZE, SIZE), dtype=np.int32)
    k = 0
    for r in range(len(hs)):
        y0, y1 = y_edges[r], y_edges[r + 1]
        ls = []
        while sum(ls) < TILE:
            ls.append(rng.uniform(0.15, 0.66))
        ls = np.array(ls) * (TILE / sum(ls))
        off = rng.uniform(0, TILE)
        x_edges = (np.concatenate([[0.0], np.cumsum(ls)]) + off)
        row = (ym >= y0) & (ym < y1)
        # 相邻两层的石块稍微伸进对方一点，层与层之间不是一条直缝
        for i in range(len(ls)):
            a, b = x_edges[i], x_edges[i + 1]
            # 每块石头高矮不一、上下错开一点（不是砖）
            hh = (y1 - y0) / 2 * rng.uniform(0.78, 1.0)
            cx, cy = (a + b) / 2, (y0 + y1) / 2 + rng.uniform(-0.3, 0.3) * ((y1 - y0) / 2 - hh + 0.02)
            hw = (b - a) / 2
            # 周期距离（x 方向绕一圈）
            dx0 = (xm - cx + TILE / 2) % TILE - TILE / 2
            dy0 = ym - cy
            # 每块石头歪一点（±7°），不是一排排摆正的砖
            th = rng.uniform(-0.12, 0.12)
            dx = dx0 * np.cos(th) + dy0 * np.sin(th)
            dy = -dx0 * np.sin(th) + dy0 * np.cos(th)
            rad = min(hw, hh) * rng.uniform(0.3, 0.75)
            qx = np.abs(dx) - (hw - rad)
            qy = np.abs(dy) - (hh - rad)
            d = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - rad
            d = d + warp
            near = np.abs(dy0) < hh + 0.1
            m = near & (d < sdist)
            sdist[m] = d[m]
            sid[m] = k
            t = rng.normal(0, 1)
            tone[m] = t
            # 鼓起：离边越远越高，每块石头高低不一
            dome[m] = np.clip(-d[m] / (min(hw, hh) * 0.9), 0, 1) ** 0.6 * rng.uniform(0.6, 1.0)
            k += 1
        del row
    gap = 0.009  # 缝的半宽（米）
    inside = sdist < -gap
    edge = np.clip((-sdist - gap) / 0.03, 0, 1)
    fine = periodic_noise(SIZE, 1.5, 3)
    grain = periodic_noise(SIZE, 4, 4)
    lichen = np.clip(periodic_noise(SIZE, 18, 5) - 1.2, 0, 1)
    # 高度：石面鼓起 + 粗糙；缝里是深的
    h = np.where(inside, 0.55 + 0.45 * dome + 0.035 * grain + 0.012 * fine, 0.0)
    # 明暗：每块石头一个基调，边上发暗，缝里很黑，零星的地衣斑
    lum = 0.5 + 0.075 * tone + 0.03 * grain + 0.02 * fine
    lum = lum * (0.7 + 0.3 * edge) + 0.06 * lichen
    lum = np.where(inside, lum, 0.08 + 0.06 * np.clip(-sdist / gap, 0, 1))
    # 法线（OpenGL）：高度图的梯度（周期差分）
    s = 2.6
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * s
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * s
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1.0)
    nx = -gx * nz
    ny = gy * nz  # 图像 y 向下，OpenGL 法线的 y 向上
    arr = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    arr[..., 0] = np.clip((nx * 0.5 + 0.5) * 255 + 0.5, 0, 255)
    arr[..., 1] = np.clip((ny * 0.5 + 0.5) * 255 + 0.5, 0, 255)
    arr[..., 2] = np.clip(lum * 255 + 0.5, 0, 255)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    Image.fromarray(arr, 'RGB').save(OUT, 'WEBP', quality=88, method=6)
    print(OUT, f'{os.path.getsize(OUT) / 1e3:.0f} KB', 'stones', k, 'lum mean', float(lum.mean()))


if __name__ == '__main__':
    main()
