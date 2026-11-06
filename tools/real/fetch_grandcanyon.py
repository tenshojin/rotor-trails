# 下载大峡谷的真实高程和航拍影像（只取需要的范围，走 USGS 官方的 ImageServer）。
# 运行：python -I tools/real/fetch_grandcanyon.py art/src/real/grandcanyon
# 已经下好的块会跳过，中断了重新跑就行。
#
# 来源（都是美国政府公有领域数据，使用时注明来源）：
#   高程：USGS 3D Elevation Program（3DEP）
#   影像：USDA National Agriculture Imagery Program（NAIP），经 USGS The National Map 分发
#
# 投影：NAD83 / UTM 12N（EPSG:26912）。网格的北就是游戏里的 -z。

import json
import math
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = sys.argv[1] if len(sys.argv) > 1 else 'art/src/real/grandcanyon'
os.makedirs(OUT, exist_ok=True)

DEM = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'

# 地图中心：南缘和科罗拉多河之间
LAT0, LON0 = 36.085, -112.095
# 三层的边长（米）和格数：高程按格点取，影像按像素取
CORE = 10240.0
MID = 40960.0
FAR = 163840.0


def utm12(lat, lon):
    """经纬度 → UTM 12N（GRS80），克吕格级数，厘米级"""
    a = 6378137.0
    f = 1 / 298.257222101
    k0 = 0.9996
    lon0 = math.radians(-111.0)
    e2 = f * (2 - f)
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    al = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16, 13 * n ** 2 / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    phi = math.radians(lat)
    lam = math.radians(lon) - lon0
    e = math.sqrt(e2)
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi = math.atan2(t, math.cos(lam))
    eta = math.asinh(math.sin(lam) / math.sqrt(1 + t * t))
    E = eta + sum(al[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    N = xi + sum(al[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    return 500000 + k0 * A * E, k0 * A * N


E0, N0 = (round(v / 10) * 10 for v in utm12(LAT0, LON0))


def tiles(total, n):
    """把 total 个像素尽量平均切成 n 段，返回 (起点, 长度)"""
    out = []
    at = 0
    for i in range(n):
        ln = total // n + (1 if i < total % n else 0)
        out.append((at, ln))
        at += ln
    return out


def job_list():
    jobs = []
    # 高程：网格点在像元中心，所以范围比地图外扩半格
    for name, size, samples, n in (('core', CORE, 4097, 3), ('mid', MID, 2049, 2), ('far', FAR, 1025, 1)):
        cell = size / (samples - 1)
        x0 = E0 - size / 2 - cell / 2
        y1 = N0 + size / 2 + cell / 2
        for r, (py, ph) in enumerate(tiles(samples, n)):
            for c, (px, pw) in enumerate(tiles(samples, n)):
                bbox = (x0 + px * cell, y1 - (py + ph) * cell, x0 + (px + pw) * cell, y1 - py * cell)
                q = dict(bbox=','.join(f'{v:.3f}' for v in bbox), bboxSR=26912, imageSR=26912, size=f'{pw},{ph}', format='tiff', pixelType='F32', noData=-9999, interpolation='RSP_BilinearInterpolation', f='image')
                jobs.append((f'dem_{name}_{r}{c}.tif', DEM, q, dict(px=px, py=py, w=pw, h=ph, total=samples, cell=cell)))
    # 影像：像素铺满整个范围
    for name, size, px_total, n in (('core', CORE, 8192, 4), ('mid', MID, 4096, 2), ('far', FAR, 2048, 1)):
        m = size / px_total
        x0 = E0 - size / 2
        y1 = N0 + size / 2
        for r, (py, ph) in enumerate(tiles(px_total, n)):
            for c, (px, pw) in enumerate(tiles(px_total, n)):
                bbox = (x0 + px * m, y1 - (py + ph) * m, x0 + (px + pw) * m, y1 - py * m)
                q = dict(bbox=','.join(f'{v:.3f}' for v in bbox), bboxSR=26912, imageSR=26912, size=f'{pw},{ph}', format='jpg', compressionQuality=92, interpolation='RSP_BilinearInterpolation', f='image')
                jobs.append((f'naip_{name}_{r}{c}.jpg', NAIP, q, dict(px=px, py=py, w=pw, h=ph, total=px_total, cell=m)))
    return jobs


lock = threading.Lock()
done = [0]


def fetch(job, total):
    name, url, q, _ = job
    path = os.path.join(OUT, name)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        with lock:
            done[0] += 1
        return 0
    full = url + '?' + urllib.parse.urlencode(q)
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
                print(f'{done[0]}/{total} {name} {len(data) / 1e6:.1f} MB {time.time() - t0:.0f}s', flush=True)
            return len(data)
        except Exception as e:  # noqa: BLE001
            print(f'retry {attempt + 1} {name}: {e}', flush=True)
            time.sleep(8 * (attempt + 1))
    print(f'FAILED {name}', flush=True)
    return 0


def main():
    jobs = job_list()
    with open(os.path.join(OUT, 'grid.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(center=[LAT0, LON0], utm=[E0, N0], epsg=26912, core=CORE, mid=MID, far=FAR, tiles={j[0]: j[3] for j in jobs}), f, indent=0)
    print('中心 UTM', E0, N0, '共', len(jobs), '块', flush=True)
    # 高程和小图先下，马上能开始处理；并发 3：别给公共服务添麻烦
    with ThreadPoolExecutor(max_workers=3) as ex:
        sizes = list(ex.map(lambda j: fetch(j, len(jobs)), jobs))
    print('完成', round(sum(sizes) / 1e6, 1), 'MB', flush=True)


if __name__ == '__main__':
    main()
