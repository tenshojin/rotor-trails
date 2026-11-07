# 岩石浮雕图：岩壁放大以后还是岩壁——把真实岩面（Poly Haven，CC0）的法线放到几十、上百米的尺度上，
# 断裂面、裂缝都是真的，比程序化噪声像得多。可平铺。两张：
#   rock_relief.webp：有层理的悬崖（cliff_side），沉积岩用
#   rock_relief_block.webp：被节理切成一块块的岩体（aerial_rocks_02），花岗岩、片麻岩这种块状的岩石用。
#     它们没有层理，上面那张转个角度贴上去，几十米外看是一笔笔的刷痕；这张是大大小小的平面、硬棱、巨石和碎石
#   R/G = 法线 XY，B = 高度（由法线积分得到），A = 凹处（裂缝、岩层下面的阴影，1 = 最深）
# 上下翻转过：贴图的行号向上增长，三平面投影时世界 y 直接当 v，岩层的上下才是对的。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/prep_relief.py

import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

N = 1024


def bake(src, out):
    n = Image.open(src).convert('RGB').resize((N, N), Image.LANCZOS)
    n = np.flipud(np.asarray(n, dtype=np.float64) / 255.0)
    nx = n[..., 0] * 2 - 1
    ny = n[..., 1] * 2 - 1
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0.02, 1))

    # 法线 → 高度（Frankot-Chellappa：频域里解泊松方程，贴图是平铺的，边界条件正好是周期的）
    p = -nx / nz
    q = -ny / nz
    wx = np.fft.fftfreq(N)[None, :] * 2 * np.pi
    wy = np.fft.fftfreq(N)[:, None] * 2 * np.pi
    den = wx * wx + wy * wy
    den[0, 0] = 1
    Hf = (-1j * wx * np.fft.fft2(p) - 1j * wy * np.fft.fft2(q)) / den
    Hf[0, 0] = 0
    H = np.real(np.fft.ifft2(Hf))
    # 去掉最低频（积分的漂移），只留岩面起伏
    H = H - gaussian_filter(H, 180, mode='wrap')
    lo, hi = np.percentile(H, [0.5, 99.5])
    H = np.clip((H - lo) / (hi - lo), 0, 1)

    cav = np.zeros_like(H)
    for s, w in ((2, 0.55), (6, 0.5), (18, 0.4)):
        b = gaussian_filter(H, s, mode='wrap')
        cav += np.clip((b - H) * 9.0, 0, 1) * w
    A = np.clip(cav, 0, 1)

    img = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, H, A], -1)
    img = np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(out, quality=92, method=6, exact=True)

    # 预览：从上方打光（第 0 行在下面，翻回来看）
    L = np.array([-0.4, 0.75, 0.55])
    L = L / np.linalg.norm(L)
    shade = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1) * (1 - A * 0.6)
    os.makedirs('tmp', exist_ok=True)
    name = os.path.basename(out).split('.')[0]
    Image.fromarray((np.flipud(shade) * 255).astype(np.uint8)).save(f'tmp/{name}_preview.png')
    print(out, os.path.getsize(out) // 1024, 'KB')


bake('art/src/polyhaven/cliff_side/cliff_side_nor_gl_2k.jpg', 'public/textures/rock_relief.webp')
bake('art/src/polyhaven/aerial_rocks_02/aerial_rocks_02_nor_gl_2k.jpg', 'public/textures/rock_relief_block.webp')
