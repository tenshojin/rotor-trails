# 下载大峡谷核心区的 30 厘米航拍（NAIP 原始分辨率），给 prep_hires.py 切块用。
# 运行：python -I tools/real/fetch_hires.py <目录>        整个核心区的可见光，约 360 MB
#      python -I tools/real/fetch_hires.py <目录> nir    整个核心区的近红外（0.6 米一格），约 65 MB，找影子用
# 已经下好的块会跳过，中断了重新跑就行。下载前要先问过用户。
#
# 来源：USDA National Agriculture Imagery Program（NAIP）2023，经 USGS The National Map 分发，美国政府公有领域数据。
# 按原始的 0.3 米一格取，不让服务缩放：0.3 → 0.3125 的双线性是一格一个相位，清晰度会 24 像素一个周期地起伏。
# 缩放放到 prep_hires.py 里用好一点的滤波做。
# JPEG 质量 85：影子里提亮五倍也看不出块，比 92 小三成。
#
# 投影：NAD83 / UTM 12N（EPSG:26912），和底片一样，服务不用重投影。

import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = sys.argv[1]
NIR = len(sys.argv) > 2 and sys.argv[2] == 'nir'
os.makedirs(OUT, exist_ok=True)

NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'

# 地图中心（和 fetch_grandcanyon.py 算出来的一样），世界坐标 x 向东、z 向南
E0, N0 = 401430.0, 3993930.0
CORE = 10240.0
# 下载块：640 米，四周多取一点，缩放滤波要用到块外面的像素
BLOCK = 640.0
PAD = 1.8
SRC = 0.3
QUALITY = 85
# 近红外只用来找影子：0.6 米一格够了，边在 prep_hires.py 里贴到可见光上
NIR_CELL = 0.6
NIR_QUALITY = 80


def job(name, x0, z0, size, band=None):
    """x0, z0 是块的西北角（世界坐标）"""
    cell = SRC if band is None else NIR_CELL
    px = int(round((size + 2 * PAD) / cell))
    span = px * cell
    # 块的中心对准要的范围
    cx = E0 + x0 + size / 2
    cy = N0 - z0 - size / 2
    bbox = (cx - span / 2, cy - span / 2, cx + span / 2, cy + span / 2)
    q = dict(bbox=','.join(f'{v:.3f}' for v in bbox), bboxSR=26912, imageSR=26912, size=f'{px},{px}', format='jpg', compressionQuality=QUALITY if band is None else NIR_QUALITY, interpolation='RSP_NearestNeighbor' if band is None else 'RSP_BilinearInterpolation', f='image')
    if band is not None:
        q['bandIds'] = band
    return name, q, dict(x0=x0, z0=z0, size=size, px=px, cell=cell)


def job_list():
    jobs = []
    n = int(CORE / BLOCK)
    for r in range(n):
        for c in range(n):
            x0 = -CORE / 2 + c * BLOCK
            z0 = -CORE / 2 + r * BLOCK
            jobs.append(job(f'{"n" if NIR else "b"}_{r:02d}_{c:02d}.jpg', x0, z0, BLOCK, 3 if NIR else None))
    return jobs


lock = threading.Lock()
done = [0]


def fetch(j, total):
    name, q, _ = j
    path = os.path.join(OUT, name)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        with lock:
            done[0] += 1
        return os.path.getsize(path)
    full = NAIP + '?' + urllib.parse.urlencode(q)
    for attempt in range(6):
        try:
            t0 = time.time()
            req = urllib.request.Request(full, headers={'User-Agent': 'rotor-trails-terrain-fetch/1.0'})
            with urllib.request.urlopen(req, timeout=400) as r:
                data = r.read()
                kind = r.headers.get('Content-Type', '')
            # 服务出错时返回的是 JSON 或网页，不能当成图片存下来
            if len(data) < 1000 or 'json' in kind or 'html' in kind:
                raise RuntimeError(f'{kind} {data[:200]!r}')
            with open(path + '.part', 'wb') as f:
                f.write(data)
            os.replace(path + '.part', path)
            with lock:
                done[0] += 1
                print(f'{done[0]}/{total} {name} {len(data) / 1e6:.2f} MB {time.time() - t0:.0f}s', flush=True)
            return len(data)
        except Exception as e:  # noqa: BLE001
            print(f'retry {attempt + 1} {name}: {e}', flush=True)
            time.sleep(8 * (attempt + 1))
    print(f'FAILED {name}', flush=True)
    return 0


def main():
    jobs = job_list()
    index = os.path.join(OUT, 'grid.json')
    old = json.load(open(index, encoding='utf-8')) if os.path.exists(index) else {}
    old.update({j[0]: j[2] for j in jobs})
    with open(index, 'w', encoding='utf-8') as f:
        json.dump(old, f, indent=0)
    print('共', len(jobs), '块', flush=True)
    # 并发 3：别给公共服务添麻烦
    with ThreadPoolExecutor(max_workers=3) as ex:
        sizes = list(ex.map(lambda j: fetch(j, len(jobs)), jobs))
    print('完成', round(sum(sizes) / 1e6, 1), 'MB', flush=True)


if __name__ == '__main__':
    main()
