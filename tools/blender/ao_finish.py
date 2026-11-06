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

# 舱内光照图：同一套 UV。外表面指到的那一小块涂白（外面不受舱内遮挡）
gi = Image.open('art/out/cockpit_gi.png').convert('RGB').filter(ImageFilter.GaussianBlur(0.8))
W2, H2 = gi.size
x, y = int(0.9985 * W2), int((1 - (SPLIT - 0.003)) * H2)
ImageDraw.Draw(gi).rectangle([x - 4, y - 4, x + 4, y + 4], fill=(255, 255, 255))
gi.save('public/models/cockpit_gi.jpg', quality=88)
print(gi.size)
