# 下载大峡谷中西部的 1 米激光测绘（266 MB）。
# 运行：python -I tools/real/fetch_lidar.py art/src/real/grandcanyon/lidar
#
# 为什么要单独下：fetch_grandcanyon.py 走的 3DEP 在线服务在这一块只有 10 米的数据，
# 补上这一块的项目 AZ_NWGrandCanyonNP_D25 是 2026 年 10 月才发布的，服务里还没有。
# 来源：USGS 3D Elevation Program（美国政府公有领域数据）。文件不进仓库。

import os
import sys
import urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'art/src/real/grandcanyon/lidar'
BASE = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/AZ_NWGrandCanyonNP_D25/TIFF/'
FILES = ['USGS_1M_12_x39y400_AZ_NWGrandCanyonNP_D25.tif', 'USGS_1M_12_x40y400_AZ_NWGrandCanyonNP_D25.tif']

os.makedirs(OUT, exist_ok=True)
for name in FILES:
    path = os.path.join(OUT, name)
    if os.path.exists(path) and os.path.getsize(path) > 1000000:
        print('已有', name)
        continue
    req = urllib.request.Request(BASE + name, headers={'User-Agent': 'rotor-trails-terrain-fetch/1.0'})
    with urllib.request.urlopen(req, timeout=600) as r, open(path + '.part', 'wb') as f:
        got = 0
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
            got += len(b)
    os.replace(path + '.part', path)
    print(name, round(got / 1e6, 1), 'MB', flush=True)
print('完成')
