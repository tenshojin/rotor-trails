# 分享卡片（og:image，public/og.jpg）：1200×630，用游戏里拍的画面加上标题。
# 用法：python tools/mk_og.py docs/screenshots/04_japan.jpg public/og.jpg
import sys
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
W, H = 1200, 630
im = Image.open(src).convert('RGB')
# 等比缩到宽 1200，再从中间偏上裁出 630 高（座舱仪表在下面，多留天空和海岸）
# （放大一成多再裁：源图顶上有一行 HUD 的小字，裁掉）
s = W * 1.12 / im.width
im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
left = (im.width - W) // 2
top = 72
im = im.crop((left, top, left + W, top + H))

# 左下角压一层从黑到透明的渐变，字才看得清
shade = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(shade)
for y in range(H):
    k = max(0.0, (y - H * 0.45) / (H * 0.55))
    d.line([(0, y), (W, y)], fill=int(205 * k ** 1.6))
dark = Image.new('RGB', (W, H), (4, 9, 14))
im = Image.composite(dark, im, shade)

draw = ImageDraw.Draw(im)
title = ImageFont.truetype(r'C:\Windows\Fonts\seguibl.ttf', 86)
sub = ImageFont.truetype(r'C:\Windows\Fonts\segoeui.ttf', 30)
x, y = 64, H - 190
# 字距拉开一点，和游戏主菜单的标题一个味道
cx = x
for ch in 'ROTOR TRAILS':
    draw.text((cx, y), ch, font=title, fill=(255, 255, 255))
    cx += draw.textlength(ch, font=title) + (30 if ch == ' ' else 9)
draw.text((x + 4, y + 112), 'A first-person helicopter sim in your browser  ·  free, no install', font=sub, fill=(205, 228, 240))
im.save(out, quality=88, optimize=True, progressive=True)
print(im.size)
