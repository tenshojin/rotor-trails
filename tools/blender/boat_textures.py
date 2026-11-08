# 船壳贴图：白漆、顶上一道色带、锈迹和水痕、水线上的污渍，船首两侧写船名和登记号。
# 贴图坐标和 hullkit.Hull.topside 一致：右舷（+Y）占左半张、船首在 u=0；左舷占右半张、船首在 u=1；v 从水线到舷边。
# 照 MOSS-Image 生成的参考图（art/src/ref/vehicles/fish_s31.png、fish_s32.png）画：白色玻璃钢船身、锈迹往下流、
# 船首两侧有船名。运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/boat_textures.py
# 字体：Windows 自带的 Noto Sans JP / SC（SIL Open Font License），只画进贴图，不随游戏分发。

import os
import random
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TEX = 'art/out/tex'
FONT_JP = r'C:\Windows\Fonts\NotoSansJP-VF.ttf'
W, H = 2048, 512
# 渔船的长度、船首处舷侧（水线到舷边）的高度：和 boats.py 的船体参数一致
L_BOAT = 13.0
BOW_TOPSIDE = 1.62

# 名字、登记号、色带颜色、舷侧颜色（sRGB）。日本：白色舷侧配一道色带，“丸”结尾的船名、县名缩写 + 数字的登记号；
# 峡湾：挪威渔港常见的整片红、蓝、白舷侧，顶上一道白带，挪威式的登记号
BOATS = {
    'boat_0': ('第八 光栄丸', 'HS2-3108', (36, 84, 150), None),
    'boat_1': ('第二 幸福丸', 'HS1-2245', (26, 110, 92), None),
    'boat_2': ('大漁丸', 'OY3-0716', (150, 40, 34), None),
    'boat_3': ('第五 宝生丸', 'HS2-1520', (30, 60, 110), None),
    'boat_f0': ('HAVBRIS', 'M-123-HØ', (236, 236, 232), (168, 40, 32)),
    'boat_f1': ('NORDLYS', 'M-48-A', (236, 236, 232), (36, 72, 124)),
    'boat_f2': ('SKARVEN', 'M-207-S', (40, 40, 44), (226, 228, 224)),
}


def hull_tex(key, name, reg, band, topside):
    rng = random.Random(key)
    nrng = np.random.default_rng(zlib.crc32(key.encode()))
    base = np.ones((H, W, 3), np.float64) * np.array(topside or (232, 232, 232), np.float64)
    # 大块的发黄、发灰
    n = nrng.standard_normal((H // 32, W // 32))
    n = np.asarray(Image.fromarray(((n - n.min()) / np.ptp(n) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float64) / 255
    base *= (0.94 + 0.07 * n)[..., None]
    base[..., 2] *= 0.985
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # 舷边下面一道色带（上沿 v=1 在图的最上面）
    d.rectangle((0, 0, W, int(H * 0.085)), fill=band)
    d.rectangle((0, int(H * 0.085), W, int(H * 0.095)), fill=(40, 40, 42))
    # 锈迹：从排水孔和挂轮胎的地方往下流
    rust = Image.new('L', (W, H), 0)
    rd = ImageDraw.Draw(rust)
    # 排水孔：舷墙下面一排，锈迹从这里往下流（每个孔一两道）
    scuppers = [rng.uniform(0, W) for _ in range(14)]
    for _ in range(30):
        x = rng.choice(scuppers) + rng.uniform(-6, 6)
        y0 = rng.uniform(0.10, 0.16) * H
        length = rng.uniform(0.15, 0.6) * H
        w = rng.uniform(2, 7)
        for k in range(12):
            t = k / 12
            rd.line((x + rng.uniform(-1.5, 1.5), y0 + length * t, x + rng.uniform(-1.5, 1.5), y0 + length * (t + 0.09)), fill=int(150 * (1 - t) ** 1.4), width=int(w * (1 - 0.5 * t)) + 1)
    rust = rust.filter(ImageFilter.GaussianBlur(2.2))
    rust_col = Image.new('RGB', (W, H), (128, 82, 48))
    im.paste(rust_col, (0, 0), rust)
    # 水线上的绿褐色污渍（v=0 在图的最下面）
    grime = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(grime)
    for x in range(0, W, 3):
        h = rng.uniform(0.03, 0.08) * H
        gd.line((x, H, x, H - h), fill=int(rng.uniform(80, 150)), width=3)
    grime = grime.filter(ImageFilter.GaussianBlur(4))
    im.paste(Image.new('RGB', (W, H), (92, 96, 70)), (0, 0), grime)
    # 船名和登记号：右舷在左半张（船首在左边），左舷在右半张（船首在右边）。
    # 贴图横向是整条船长、纵向只是舷高，字要按两个方向每米多少像素的比例横向压扁，画到船身上才是正常比例
    ppm_u = (W / 2) / L_BOAT
    ppm_v = H / BOW_TOPSIDE
    is_jp = any(ord(c) > 0x2E80 for c in name)
    name_h = int(0.44 * ppm_v)
    reg_h = int(0.20 * ppm_v)
    for half in (0, 1):
        x0 = half * W // 2
        for text, hpx, top_m, fwd_m in ((name, name_h, 0.52, 1.15), (reg, reg_h, 1.0, 1.25)):
            f = ImageFont.truetype(FONT_JP, hpx)
            try:
                f.set_variation_by_name('Bold')
            except (OSError, ValueError):
                pass
            tw = int(ImageDraw.Draw(Image.new('L', (1, 1))).textlength(text, font=f)) + 8
            lay = Image.new('L', (tw, int(hpx * 1.35)), 0)
            ImageDraw.Draw(lay).text((4, 0), text, font=f, fill=255)
            lay = lay.resize((max(1, int(tw * ppm_u / ppm_v)), lay.height), Image.LANCZOS)
            # 离船首 fwd_m 米开始往船尾写（右舷：船首在 u=0；左舷：船首在 u=W）
            if half == 0:
                px = int(x0 + fwd_m * ppm_u)
            else:
                px = int(x0 + W // 2 - fwd_m * ppm_u - lay.width)
            py = int((top_m - 0.12) * ppm_v)
            ink = (24, 26, 30) if sum(topside or (232, 232, 232)) > 400 else (238, 238, 232)
            im.paste(Image.new('RGB', lay.size, ink), (px, py), lay)
    im = im.filter(ImageFilter.GaussianBlur(0.4))
    os.makedirs(TEX, exist_ok=True)
    im.save(os.path.join(TEX, f'hull_{key}.jpg'), quality=88)


# 渡轮：船身颜色、色带颜色、船名（虚构）、船名颜色
FERRIES = {
    'ferry_jp': ((34, 60, 110), (178, 38, 30), 'フェリーあさなぎ', (240, 240, 236)),
    'ferry_no': ((29, 32, 36), (200, 162, 60), 'MF FJORDGLIMT', (240, 240, 236)),
}
FERRY_L = 46.0
FERRY_TOPSIDE = 3.9


def ferry_tex(key, hull, band, name, ink):
    """渡轮的船身：深色底、一道色带、船首两侧白色船名、一点水痕。坐标约定同渔船（右舷左半张、船首在 u=0）"""
    FW, FH = 4096, 512
    rng = random.Random(key)
    nrng = np.random.default_rng(zlib.crc32(key.encode()))
    base = np.ones((FH, FW, 3)) * np.array(hull, np.float64)
    n = nrng.standard_normal((FH // 32, FW // 32))
    n = np.asarray(Image.fromarray(((n - n.min()) / np.ptp(n) * 255).astype(np.uint8)).resize((FW, FH), Image.BICUBIC)).astype(np.float64) / 255
    base *= (0.93 + 0.1 * n)[..., None]
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    ppm_u = (FW / 2) / FERRY_L
    ppm_v = FH / FERRY_TOPSIDE
    # 色带：舷边往下 2.0 米处一道 0.28 米宽（船名写在护舷材和色带之间）
    y0 = int(2.0 * ppm_v)
    d.rectangle((0, y0, FW, y0 + int(0.28 * ppm_v)), fill=band)
    # 水痕：从舷边的排水口往下的浅色条
    streak = Image.new('L', (FW, FH), 0)
    sd = ImageDraw.Draw(streak)
    for _ in range(40):
        x = rng.uniform(0, FW)
        sd.line((x, rng.uniform(0.02, 0.1) * FH, x + rng.uniform(-2, 2), rng.uniform(0.3, 0.8) * FH), fill=int(rng.uniform(25, 60)), width=int(rng.uniform(2, 5)))
    streak = streak.filter(ImageFilter.GaussianBlur(2.5))
    im.paste(Image.new('RGB', (FW, FH), (170, 160, 140)), (0, 0), streak)
    f = ImageFont.truetype(FONT_JP, int(0.95 * ppm_v))
    try:
        f.set_variation_by_name('Bold')
    except (OSError, ValueError):
        pass
    tw = int(ImageDraw.Draw(Image.new('L', (1, 1))).textlength(name, font=f)) + 8
    lay = Image.new('L', (tw, int(0.95 * ppm_v * 1.35)), 0)
    ImageDraw.Draw(lay).text((4, 0), name, font=f, fill=255)
    lay = lay.resize((max(1, int(tw * ppm_u / ppm_v)), lay.height), Image.LANCZOS)
    for half in (0, 1):
        x0 = half * FW // 2
        px = int(x0 + 5.5 * ppm_u) if half == 0 else int(x0 + FW // 2 - 5.5 * ppm_u - lay.width)
        im.paste(Image.new('RGB', lay.size, ink), (px, int(0.78 * ppm_v)), lay)
    im.save(os.path.join(TEX, f'hull_{key}.jpg'), quality=88)


RIVER_L = 26.0
RIVER_TOPSIDE = 1.9


def river_tex(key='river_boat', name='COMANDANTE SOUZA II', port='MANAUS - AM'):
    """亚马孙河船的木船身（参考图 art/src/ref/vehicles/river_s38.png、river_s39.png）：白漆木板、横向板缝、
    掉漆露出的木头、两道蓝色护舷条、靠水线发黄发锈，船首两侧写船名、船尾写船籍港"""
    FW, FH = 4096, 512
    rng = random.Random(key)
    nrng = np.random.default_rng(zlib.crc32(key.encode()))
    ppm_u = (FW / 2) / RIVER_L
    ppm_v = FH / RIVER_TOPSIDE
    base = np.ones((FH, FW, 3)) * np.array((228, 226, 216), np.float64)
    n = nrng.standard_normal((FH // 16, FW // 64))
    n = np.asarray(Image.fromarray(((n - n.min()) / np.ptp(n) * 255).astype(np.uint8)).resize((FW, FH), Image.BICUBIC)).astype(np.float64) / 255
    base *= (0.9 + 0.12 * n)[..., None]
    im = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    # 掉漆：一块块露出的灰褐色木头
    peel = Image.new('L', (FW, FH), 0)
    pd = ImageDraw.Draw(peel)
    for _ in range(260):
        x, y = rng.uniform(0, FW), rng.uniform(0.15, 1.0) * FH
        w, h = rng.uniform(4, 30), rng.uniform(2, 9)
        pd.ellipse((x, y, x + w, y + h), fill=int(rng.uniform(120, 230)))
    peel = peel.filter(ImageFilter.GaussianBlur(1.2))
    im.paste(Image.new('RGB', (FW, FH), (128, 112, 92)), (0, 0), peel)
    # 板缝：每 0.17 米一道
    step = 0.17 * ppm_v
    y = step
    while y < FH:
        d.line((0, y, FW, y), fill=(92, 88, 80), width=2)
        y += step
    # 两道蓝色护舷条的位置涂成蓝（几何体也有，贴图上再压一道深色边）
    for top_m, h_m in ((0.05, 0.12), (0.55, 0.10)):
        d.rectangle((0, int(top_m * ppm_v), FW, int((top_m + h_m) * ppm_v)), fill=(36, 112, 170))
    # 水线附近：锈褐色的污渍往上渗
    grime = Image.new('L', (FW, FH), 0)
    gd = ImageDraw.Draw(grime)
    for x in range(0, FW, 4):
        h = rng.uniform(0.12, 0.32) * FH
        gd.line((x, FH, x, FH - h), fill=int(rng.uniform(90, 200)), width=4)
    grime = grime.filter(ImageFilter.GaussianBlur(6))
    im.paste(Image.new('RGB', (FW, FH), (118, 84, 58)), (0, 0), grime)
    f = ImageFont.truetype(FONT_JP, int(0.30 * ppm_v))
    try:
        f.set_variation_by_name('Bold')
    except (OSError, ValueError):
        pass
    for text, fwd, top in ((name, 1.6, 0.78), (port, None, 0.82)):
        tw = int(ImageDraw.Draw(Image.new('L', (1, 1))).textlength(text, font=f)) + 8
        lay = Image.new('L', (tw, int(0.30 * ppm_v * 1.35)), 0)
        ImageDraw.Draw(lay).text((4, 0), text, font=f, fill=255)
        lay = lay.resize((max(1, int(tw * ppm_u / ppm_v)), lay.height), Image.LANCZOS)
        for half in (0, 1):
            x0 = half * FW // 2
            if fwd is not None:
                px = int(x0 + fwd * ppm_u) if half == 0 else int(x0 + FW // 2 - fwd * ppm_u - lay.width)
            else:
                # 船籍港写在船尾
                px = int(x0 + FW // 2 - 1.2 * ppm_u - lay.width) if half == 0 else int(x0 + 1.2 * ppm_u)
            im.paste(Image.new('RGB', lay.size, (30, 70, 120)), (px, int(top * ppm_v)), lay)
    im.save(os.path.join(TEX, f'hull_{key}.jpg'), quality=88)


if __name__ == '__main__':
    river_tex()
    for k, (nm, reg, band, topside) in BOATS.items():
        hull_tex(k, nm, reg, band, topside)
    for k, (hull, band, nm, ink) in FERRIES.items():
        ferry_tex(k, hull, band, nm, ink)
    print('ok', len(BOATS) + len(FERRIES))
