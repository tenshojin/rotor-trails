# 烘焙后处理：把 art/out/cockpit_ao.png 变成游戏用的 public/models/cockpit_ao.jpg。
# 外表面统一指向贴图里留白的一小块（见 cockpit.py），这里涂成白色；再略微模糊，压掉采样噪点。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/blender/ao_finish.py

from PIL import Image, ImageDraw, ImageFilter

im = Image.open('art/out/cockpit_ao.png').convert('L')
W, H = im.size
im = im.filter(ImageFilter.GaussianBlur(1.1))
SPLIT = 0.42
x, y = int(0.9985 * W), int((1 - (SPLIT - 0.003)) * H)
ImageDraw.Draw(im).rectangle([x - 6, y - 6, x + 6, y + 6], fill=255)
im.save('public/models/cockpit_ao.jpg', quality=86)
print(im.size)
