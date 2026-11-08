# 【目前游戏里不用】2026-11-08 用户要求人物模型先全部撤下（之后另想办法），public/models 里已经没有这个模型；脚本留作参考。
# 飞行员用的贴图：
#   pilot_suit_diffuse_1024.jpg：飞行服布纹换成设定图里的灰绿色（原来的 suit_diffuse 太暗，材质颜色只能往暗里乘）
#   kneeboard_paper.png：护膝板上夹的检查单，内容和游戏里超仿真的启动检查单一样
# 颜色取自 MOSS-Image 生成的设定图 art/src/ref/pilot/sheet_s11.png（tools 里的取色见 docs/development.md）。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/pilot_textures.py
# 字体：Windows 自带的 Noto Sans SC（SIL Open Font License），只用来画进贴图，不随游戏分发。

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TEX = 'art/out/tex'
FONT = r'C:\Windows\Fonts\NotoSansSC-VF.ttf'


def srgb(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def suit():
    src = np.asarray(Image.open(os.path.join(TEX, 'suit_diffuse_1024.jpg')).convert('RGB')).astype(np.float64) / 255
    L = lin(src).mean(2)
    detail = L / L.mean()
    # 设定图里飞行服受光面和背光面的中间值（线性）：约 (0.20, 0.24, 0.20)，反照率取稍暗一点
    target = np.array([0.172, 0.205, 0.138])
    out = srgb(np.clip(detail[..., None] ** 0.8 * target[None, None], 0, 1))
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(os.path.join(TEX, 'pilot_suit_diffuse_1024.jpg'), quality=92)


ITEMS = [
    ('旋翼刹车', 'ROTOR BRAKE', '松开'),
    ('燃油阀', 'FUEL VALVE', '打开'),
    ('电瓶', 'BATT', '开'),
    ('防撞灯', 'A-COL', '开'),
    ('燃油泵', 'FUEL P', '开'),
    ('发动机主开关', 'ENG', 'IDLE · N1 68%'),
    ('发电机', 'GEN', '开'),
    ('皮托加温', 'PITOT', '开'),
    ('增稳', 'SAS', '开'),
    ('发动机主开关', 'ENG', 'FLIGHT · NR 100%'),
]
SHUT = [('总距', 'COLLECTIVE', '放到底'), ('发动机主开关', 'ENG', 'IDLE 2 分钟'), ('发动机主开关', 'ENG', 'OFF'), ('旋翼刹车', 'ROTOR BRAKE', '拉上'), ('电瓶', 'BATT', '关')]


def paper():
    W, H = 640, 980
    im = Image.new('RGB', (W, H), (238, 236, 228))
    d = ImageDraw.Draw(im)
    f_title = ImageFont.truetype(FONT, 34)
    f_sub = ImageFont.truetype(FONT, 20)
    f_item = ImageFont.truetype(FONT, 24)
    f_small = ImageFont.truetype(FONT, 18)
    ink = (28, 30, 34)
    grey = (120, 122, 126)
    d.rectangle((28, 120, W - 28, 128), fill=ink)
    d.text((32, 40), 'RT-7  启动检查单', font=f_title, fill=ink)
    d.text((34, 88), 'STARTUP CHECKLIST · 冷舱', font=f_sub, fill=grey)
    y = 150
    for i, (zh, en, act) in enumerate(ITEMS):
        d.text((34, y), f'{i + 1:>2}.', font=f_item, fill=ink)
        d.text((80, y), zh, font=f_item, fill=ink)
        d.text((80 + 26 * len(zh) + 10, y + 4), en, font=f_small, fill=grey)
        tw = d.textlength(act, font=f_item)
        d.text((W - 34 - tw, y), act, font=f_item, fill=ink)
        y += 44
        d.line((34, y - 6, W - 34, y - 6), fill=(196, 194, 186), width=1)
    y += 16
    d.rectangle((28, y, W - 28, y + 5), fill=ink)
    y += 18
    d.text((32, y), '关车 SHUTDOWN', font=f_sub, fill=ink)
    y += 40
    for i, (zh, en, act) in enumerate(SHUT):
        d.text((34, y), f'{i + 1:>2}.', font=f_item, fill=ink)
        d.text((80, y), zh, font=f_item, fill=ink)
        tw = d.textlength(act, font=f_item)
        d.text((W - 34 - tw, y), act, font=f_item, fill=ink)
        y += 42
        d.line((34, y - 6, W - 34, y - 6), fill=(196, 194, 186), width=1)
    # 铅笔记的频率和风：纸上手写的一行，斜一点
    note = Image.new('L', (W, 90), 0)
    nd = ImageDraw.Draw(note)
    nd.text((40, 20), 'TWR 118.70   风 270/12', font=ImageFont.truetype(FONT, 30), fill=200)
    note = note.rotate(-3, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))
    pencil = Image.new('RGB', (W, 90), (70, 72, 80))
    im.paste(pencil, (0, H - 110), note)
    # 纸面的不平和手摸过的灰
    rng = np.random.default_rng(3)
    a = np.asarray(im).astype(np.float64)
    n = rng.standard_normal((H // 8, W // 8))
    n = np.asarray(Image.fromarray(((n - n.min()) / np.ptp(n) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)).astype(np.float64) / 255
    a *= (0.95 + 0.06 * n)[..., None]
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(TEX, 'kneeboard_paper.png'))


if __name__ == '__main__':
    suit()
    paper()
    print('ok')
