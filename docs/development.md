# 开发说明

玩家看的介绍在 [README](../README.md)，这里是构建、测试、素材和部署。

- 纯前端静态网站：TypeScript + Vite + three.js（WebGPU 渲染器，不支持 WebGPU 的浏览器自动退回 WebGL2）+ Rapier 物理（WebAssembly），无后端、无在线 AI、无付费接口
- 驾驶舱、直升机外观、五张地图的建筑与 10 种树木都用本仓库里的 Blender 脚本建模（对照维基共享资源上的真实照片，照片只作参照、不随游戏分发）；地形与建筑使用 [Poly Haven](https://polyhaven.com) 的 CC0 照片材质；地形高度、天空、水面、仪表画面与音效为程序生成

接手优化记录见 [2026-11-05 接手优化记录](optimization-2026-11-05.md)：三轮代码审计、检查点与暂停修复、设置和渲染工作量优化、资源失败回收、Blender 停机坪细节及可重复验收工具。

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 20.x 中的 20.19.0 及以上版本，或 22.12.0 及更高版本；不支持 21.x（开发时使用 24.x）
- 桌面浏览器并开启硬件加速。推荐支持 WebGPU 的最新版 Chrome / Edge（Safari 26、Windows 上的 Firefox 也支持）；只支持 WebGL2 的浏览器同样能玩，画面效果相同、帧率略低

### 安装与运行

Windows 本地已安装依赖时，可直接双击 `Start-RotorTrails.cmd`。每次启动都会检查并构建当前源码，然后在固定地址 `http://127.0.0.1:4185/` 打开浏览器，避免误运行旧构建。游玩时保留启动窗口；关闭窗口或按 Ctrl+C 即可结束服务。重复启动时若端口已占用，请打开已运行的游戏，或先关闭旧启动窗口；不会自动换端口，以免浏览器把进度保存在另一地址下。

只检查环境并构建、不启动服务或打开浏览器，可运行 `Start-RotorTrails.cmd --check`；成功返回 0，失败返回非零状态。

```bash
npm install
```

```bash
npm run dev
```

然后在浏览器打开终端里显示的地址（默认 http://localhost:5173 ）。第一次进入建议先玩「飞行训练」。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（热更新） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行全部自动化测试（Vitest，约 15 秒） |
| `npm run build` | 类型检查 + 生产构建，输出到 `dist/` |
| `npm run preview` | 在 http://localhost:4173 预览生产构建 |
| `npm run mapviz` | 生成地图俯视图并检查所有航线净空（输出到 `tmp/maps/`） |
| `npm run regress` | 跨平台完整航线与天气验收（46 种情形，失败返回非零状态） |
| `npm run regress:recovery` | 六张地图 × 两种检查点恢复：坠毁后恢复并完成主线（12 种情形） |
| `npm run shots -- tools/steps/docs_shots.json docs/screenshots` | 用无头 Chrome 自动截图（需先 `npm run preview`） |

自动驾驶回归只通过飞行员输入驾驶，验证正式地图的航线和天气组合，以及坠毁后的任务恢复。以下入口支持 Windows、macOS 和 Linux，运行时间取决于机器性能：

```text
npm run regress
npm run regress:recovery
```

旧版 `tools/regress.sh` 仍可在 Git Bash 等环境中使用。

显卡被别的程序占满的时候不要跑截图（这台机器蓝屏过）。流程和画面可以先在 CPU 上看：网址加 `backend=webgl`，截图工具用软件渲染，几十秒进图，一秒一两帧，画质固定是低。只看界面（不进 3D）也用它。

```bash
CHROME_EXTRA_ARGS="--disable-gpu --use-angle=swiftshader" node tools/shot.mjs <步骤文件> <输出目录>
```

软件 WebGPU（`--enable-unsafe-webgpu --enable-features=Vulkan,WebGPUService --use-webgpu-adapter=swiftshader --disable-gpu-sandbox --disable-gpu-compositing`，不要加 `--use-angle=swiftshader`）能拿到适配器，但主菜单的预编译超过 9 分钟，基本用不了。WGSL 编不编得过还是要真显卡看。

单独跑一张地图（bash 语法；PowerShell 中先执行 `$env:MAP="himalaya"; $env:PATHS="0,1"`）：

```bash
MAP=himalaya PATHS=0,1 npx vitest run --config vitest.tools.config.ts tools/autorun.tool.ts --silent=false
```

## 真实地形（重新生成）

地形数据已经生成好提交在 `public/real/` 下。要换地方或者重新处理：

```bash
python -I tools/real/fetch_grandcanyon.py art/src/real/grandcanyon
python -I tools/real/prep_grandcanyon.py art/src/real/grandcanyon public/real/grandcanyon --sun 100 41
```

第一步从 USGS The National Map 下载约 230 MB（放在 `art/src/real/`，不进仓库）。外圈是后来换细的（10 米高程、5 米影像），已有旧数据的话单独下到一个子目录，`prep_grandcanyon.py` 看到 `mid10` 就用它：`python -I tools/real/fetch_grandcanyon.py art/src/real/grandcanyon/mid10 mid`。第二步大约十五分钟，内存要留 8 GB，要有 numpy、scipy、Pillow。`--sun` 是拍摄时的太阳方位和高度，不写就从照片和高程里自动拟合。

30 厘米影像是单独的两步，核心区全部下载约 425 MB（下载前先问过用户），切块 4 个进程约二十五分钟，内存 5 GB 以内（全图的中间结果用半精度、一条一条算，机器上常有别的大程序在跑），成品 241 MB：

```bash
python -I tools/real/fetch_hires.py art/src/real/grandcanyon/hi30
python -I tools/real/fetch_hires.py art/src/real/grandcanyon/hi30 nir
python -I tools/real/prep_hires.py art/src/real/grandcanyon/hi30 public/real/grandcanyon/core.webp ../rotor-trails-tiles/grandcanyon/hi
```

成品放在单独的仓库 [rotor-trails-tiles](https://github.com/tenshojin/rotor-trails-tiles)，用 GitHub Pages 发布（`src/maps/grandcanyon.ts` 的 `hi`）。放在这个仓库的话，每次推送都要多传 241 MB，重新生成一次仓库就多一份。那个仓库只有数据，重新生成以后可以把历史压掉。本机开发也是读线上的（Pages 允许跨域），读不到就退回 1.25 米。

`prep_hires.py` 要在 `prep_grandcanyon.py` 之后跑：颜色跟着 `core.webp`，还会把 `trees.dat` 里的树挪到树冠上（原始位置留在下载目录的 `trees_orig.dat`；`prep_grandcanyon.py` 重跑过的话要删掉它）。`--rows`、`--cols` 只做一部分，试参数用；`--again` 只重新切块，第一遍的结果还在 `_work` 里。

第二步生成高程、影像、岩层色表、树，还有核心区和外圈的辅助图（`sky_river.webp`、`sky_river_mid.webp`）和地面散布的疏密图（`scatter.webp`）。跑完看一下 `public/real/grandcanyon/meta.json` 的 `bases`，要和 `src/maps/grandcanyon.ts` 里每层的 `base` 一样：河面压平之后最低点可能变，差一米整张图的高度都错（`tests/real-data.test.ts` 会查）。

在线服务在地图中西部（x -5000 ~ -1000，z -5000 ~ 1800）只有 10 米的高程，提交的数据已经换成了 1 米的激光测绘。重新生成时要在第二步之前多跑一步，下载 266 MB，同样不进仓库：

```bash
python -I tools/real/fetch_lidar.py art/src/real/grandcanyon/lidar
```

村里的住宅是半自动描的。种子点在 `tools/real/roof_seeds.json`（看着 30 厘米影像点屋顶），程序长出轮廓，输出贴进 `src/maps/grandcanyonBuildings.ts`：

```bash
python -I tools/real/trace_roofs.py ../rotor-trails-tiles/grandcanyon/hi tools/real/roof_seeds.json src/maps/grandcanyonBuildings.ts
```

`prep_grandcanyon.py` 的 `merge_lidar` 看到这个目录里有 `.tif` 就会换上去；没有这一步，这一块会退回服务里的 10 米数据。

改了 `tools/blender/leaf_atlas.py` 的颜色要重新生成 `public/models/trees.glb`，步骤见下一节。

## 美术素材（重新生成）

模型与贴图已经生成好并提交在 `public/` 下，平时不需要重新生成。修改建模脚本后的重新生成步骤（需要 Blender 4.x / 5.x，以及装有 Pillow、NumPy、SciPy 的 Python 3）：

1. `node tools/fetch_assets.mjs`：按 [tools/assets/sources.json](../tools/assets/sources.json) 下载 Poly Haven 材质与参照照片到 `art/src/`（不进仓库）
2. `python tools/prep_textures.py <材质id>:1024 …`、`python tools/prep_terrain.py`、`python tools/prep_detail.py`、`python tools/prep_drystone.py`（干砌石墙的细节层，程序生成）：缩放、转换贴图
3. `python tools/blender/tex_variants.py`、`python tools/blender/jtex.py`、`python tools/blender/leaf_atlas.py art/out/trees`（程序画的图集），再 `python -I tools/blender/leaf_photo_atlas.py art/src/ref/leaves art/out/trees/leaves.png`（换成照片叶簇，见下面“树叶照片”）、`python tools/blender/cockpit_textures.py art/out/cockpit_tex`：颜色变体、木瓦、日式瓦格子 / 花岗岩、叶片图集、仪表盘面
4. `blender -b --factory-startup --python tools/blender/<脚本>.py -- public/models/<文件>.glb [--preview 预览目录]`：脚本有 `cockpit.py`（另需贴图目录与 `--bake`）、`heli_ext.py`、`trees.py`、`props_japan.py`、`props_fjord.py`、`props_himalaya.py`、`props_amazon.py`、`props_canyon.py`，用法写在各脚本开头
   座舱还要烘焙环境光遮蔽：`blender ... tools/blender/cockpit.py -- public/models/cockpit.glb art/out/cockpit_tex --bake`，然后运行 `tools/blender/ao_finish.py` 生成 `public/models/cockpit_ao.jpg`。
   货箱：`blender ... tools/blender/crate.py -- public/models/crate.glb`。
   碰撞箱：改了模型（尤其是会动的船、车、飞机，和只放模型不带碰撞体的道具）以后跑 `blender -b --factory-startup --python tools/blender/collision_shapes.py -- src/world/modelShapes.ts`，要加模型就写进脚本里的 `MODELS`；`npx vitest run --config vitest.tools.config.ts tools/uncollided.tool.ts --silent=false` 列出每张图还摸不到的模型（码头、栈桥、鸟居是误报：碰撞面不在模型原点上）。
   树叶照片（`art/src/ref/leaves/`，不进仓库）：`python D:\ComfyUI\gen.py image "<描述>. Botanical flat lay photograph, top-down view, isolated on a pure white background, soft even diffuse studio light, no shadows, sharp focus, high detail, natural colors" --size 1024x1024 --seed <种子> --force --out art/src/ref/leaves/<名字>.png`。名字、种子、描述：broad 101 日本常绿橡树小枝（九片有光泽的椭圆叶）、pine 102 黑松短枝（成对的长针叶放射状）、spruce 103 挪威云杉枝梢（横放）、trop 104 热带雨林小枝（六片大叶、滴水尖）、birch 105 白桦小枝（十片锯齿三角叶）、juniper 106 刺柏小枝、shrub 107 冬青小枝、palm 108 椰子叶（1792×1024，横放、叶柄在左）、pinyon 109 矮松小枝、ujuni 110 犹他刺柏小枝（带浅蓝浆果）、scrub 111 山艾小枝。
   飞行员和地勤：**目前游戏里没有**（2026-11-08 用户要求人物模型先全部撤下，之后另想办法）。脚本还在（`pilot_textures.py`、`pilot_sdf.py`、`pilot_gear.py`、`pilot.py`；`crew_sdf.py`、`crew.py`），代码里的 `PilotBody` 也在，只是不再加载。
   船、车、飞机：先 `python tools/blender/boat_textures.py`（渔船、渡轮、河船的船身贴图：船名、锈迹、木板），再跑 `props_japan.py`、`props_fjord.py`、`props_amazon.py`、`props_training.py`。这几个脚本里的渔船、渡轮、河船在 `boats.py`（船体放样工具 `hullkit.py`），小汽车、轻卡、加油车在 `cars.py`，轻型飞机在 `planes.py`。

### 人物和交通工具：MOSS-Image 参考图 + Blender 建模

渔船、渡轮、河船、港区的车、训练场的小飞机和加油车，都是先用本机的 MOSS-Image（`D:\ComfyUI\gen.py`，用法见那边的 `docs/默认用法.md`）生成设定图，再在 Blender 里照着建模的。飞行员和地勤当时也是这样建的，2026-11-08 已从游戏里撤下，下面关于人物的步骤留作参考：

1. 生成参考图（存到 `art/src/ref/`，不进仓库）：
   - 飞行员三视图 `pilot/sheet_s11…s44.png`（1792×1024，种子 11/22/33/44），提示词要点：正面、左侧、背面三视图，A 字站姿，三十出头的东亚男性，白色飞行头盔（深色面罩、左侧麦克风），灰绿连体飞行服（斜拉链胸袋、大腿和小腿口袋），黑色网眼背心和胸袋，棕褐色皮手套，棕色系带靴，浅灰背景、均匀棚光
   - 细节：头盔四视图 `helmet_s5/s6`、面罩放下的脸 `face_s7/s8`、手套 `glove_s9`、护膝板 `knee_s10`
   - 地勤三视图 `crew/sheet_s21…s23.png`：藏青工作服、橙色反光背心（灰色反光条）、带帽檐的白色安全帽和耳罩、白棉手套、橙色指挥棒
   - 交通工具 `vehicles/`（1792×1024）：近海渔船 `fish_s31/s32`、车客渡轮 `ferry_s33/s34`、轻卡 `kei_s35`、高顶轻型车 `car_s36/s37`、亚马孙河船 `river_s38/s39`、上单翼轻型飞机 `plane_s40`、机场加油车 `fuel_s41`；提示词要点是“设定图、侧面 / 四分之三 / 顶视、浅灰背景、无文字”
2. 从参考图上取色（各脚本里的颜色都注明了来源），按三视图的比例和结构建模：软的东西（身体、衣服褶皱、背心、手套、脸）用 numpy 距离场雕刻（`pilot_sdf.py`、`crew_sdf.py`），要边缘干净的硬件（头盔外壳、面罩罩壳和滑轨、面罩、转轴、麦克风、下巴带、安全帽、耳罩、货箱）在 Blender 里用参数曲面和盒子建（`pilot_gear.py`、`crew.py`）。
3. 预览：`--preview` 在 Blender 里渲染正面、四分之三侧面、全身和第一人称几张，和参考图并排对比。

约定（等人物模型回来时用）：飞行员头上的零件材质名都以 `plh_` 开头，游戏在第一人称时按这个前缀把它们藏起来（摄像机在头里面）；第一人称看得到的零件绝不能用这个前缀。没有飞行员时，超仿真里点控件直接生效（`App.useControl`）。

没有用本机的 Hunyuan3D-2（图生 3D）：它的许可第 3 条 c 款不允许在欧盟、英国、韩国使用、分发或展示它生成的结果，而游戏是全世界都能打开的网页。

模型文件缺失或加载失败时，游戏会退回程序生成的几何体，仍然可以玩。

机身涂装（注册号、接缝、铆钉、风化都在这张图里）：`python tools/blender/heli_livery.py public/models <Inter 字体路径>`，只用 Pillow 和 numpy，不用 Blender。默认读 Blender 自带的 `datafiles/fonts/Inter.woff2`。改了 `heli_shape.py` 或门窗的位置，要对着正投影看一下接缝还对不对得上。

停机坪灯具与固定环可单独生成：`blender -b --factory-startup --python tools/blender/pad_fixtures.py -- public/models/pad_fixtures.glb --preview tmp/pad-fixtures`。游戏按材质批量绘制这些部件，灯光位置跟随停机坪朝向。

## 部署到 GitHub Pages

本仓库已开启 GitHub Pages：每次推送到 `main`，工作流通过检查后自动部署到 https://tenshojin.github.io/rotor-trails/ 。

仓库里的 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) 在每次推送到 `main` 时自动执行类型检查、测试和构建；构建产物使用相对路径（`base: './'`），可以放在任何子路径下（例如 `https://<用户名>.github.io/rotor-trails/`）。

在自己的仓库（例如复刻后）开启发布的步骤：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
2. 仓库 **Settings → Secrets and variables → Actions → Variables** 新建变量 `DEPLOY_PAGES`，值为 `true`（或在 Actions 页面手动运行一次 “CI / Pages” 工作流）
3. 等待工作流完成，在 Pages 设置页查看网址

> 注意：**私有仓库**使用 GitHub Pages 需要付费方案（GitHub Pro / Team / Enterprise）。免费账号需要把仓库改为公开才能启用 Pages——是否公开由仓库所有者决定。

也可以把 `npm run build` 生成的 `dist/` 目录上传到任意静态网站托管服务；不能直接双击打开 `dist/index.html`（浏览器不允许从本地文件加载模块）。

## 目录结构

```
src/
  core/        数学、噪声、固定步长推进器
  config/      飞行参数与三档辅助（集中配置）
  sim/         仿真：飞行模型、物理（Rapier）、起落架、风、天气、损伤、Buff、任务、导航、评分、自动驾驶
  maps/        五张地图 + 训练场（数据驱动：地形函数、站点、航点、航段、任务、天气、风区）
  world/       世界生成：高度场、建筑与道具、植被
  render/      渲染：地形、水、天空、树、建筑、座舱、仪表、导航标记、天气特效
  game/        应用状态机、输入、设置、存档、教学
  ui/          HUD、菜单与样式
  audio/       程序化音效（旋翼、发动机、风、雨、告警）
tests/         自动化测试（Vitest）
public/
  models/      Blender 导出的模型（驾驶舱、直升机外观、各地图建筑、树木）
  textures/    地形照片材质、建筑细节贴图
tools/         地图俯视图、航线净空、自动驾驶回归、截图等开发工具
  blender/     Blender 建模脚本（驾驶舱、直升机、建筑、树木）与贴图生成脚本
  assets/      美术素材来源清单（Poly Haven 材质、参照照片及其作者与许可）
docs/          设计文档、进度、测试报告、截图
```

## 文档

- [docs/design.md](design.md)：设计与技术方案
- [docs/progress.md](progress.md)：开发进度与已知问题
- [docs/test-report.md](test-report.md)：测试报告（区分自动化测试、自动驾驶验证与尚未进行的真人试玩）
- [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md)：第三方开源库许可
