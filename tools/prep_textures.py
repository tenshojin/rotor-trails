# 把 Poly Haven 2K 原始材质缩成游戏/建模用的尺寸（art/out/tex/<id>_<map>_<size>.jpg）。
# 运行：D:/ComfyUI/venv/Scripts/python.exe tools/prep_textures.py [id:尺寸 ...]
# 不带参数时处理 DEFAULT 列表；已存在且比源文件新的输出会跳过。

import os
import sys

from PIL import Image

SRC = 'art/src/polyhaven'
OUT = 'art/out/tex'
DEFAULT = ['poly_wool_herringbone:1024']
MAPS = ['diffuse', 'nor_gl', 'rough']


def prep(tex_id, size):
    os.makedirs(OUT, exist_ok=True)
    done = []
    for m in MAPS:
        src = os.path.join(SRC, tex_id, f'{tex_id}_{m}_2k.jpg')
        dst = os.path.join(OUT, f'{tex_id}_{m}_{size}.jpg')
        if not os.path.exists(src):
            print('缺少源文件', src)
            continue
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            done.append(dst)
            continue
        im = Image.open(src)
        im = im.convert('L' if m == 'rough' else 'RGB')
        if im.width != size:
            im = im.resize((size, size), Image.LANCZOS)
        im.save(dst, quality=90 if m == 'nor_gl' else 86, optimize=True)
        done.append(dst)
    return done


if __name__ == '__main__':
    items = sys.argv[1:] or DEFAULT
    for it in items:
        tid, size = it.split(':') if ':' in it else (it, '1024')
        for p in prep(tid, int(size)):
            print(p, f'{os.path.getsize(p) / 1e6:.2f} MB')
