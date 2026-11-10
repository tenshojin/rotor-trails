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

## 多语言（中文、英文、日文）

界面文字在代码里写的就是中文，中文原文同时是查译文的键：

- `tr('已暂停')`：当场翻译。
- `` tr`从最近检查点继续（${label}）` ``：带数值的句子，键是 `从最近检查点继续（{0}）`，译文里用 `{0}`、`{1}` 摆位置（顺序可以换）。
- `tr('关闭@@悬停辅助的状态')`：同一句中文在两个地方要译成不同的词时，`@@` 后面写说明，中文显示时去掉。
- `trKey('五重塔')`：只做标记不翻译。存档里当名字用的地名（地标、景点）在定义处保持中文，显示的地方再 `tr(名字)`。

译文在 `src/i18n/dict/`，按原文出自哪个源文件分表，一行是 `'中文原文': ['English', '日本語']`；值也可以写成函数（英文的单复数）。

语言在启动时定下来（`?lang=zh|en|ja` → 设置里选的 → 浏览器语言，别的语言用英文），换语言要重新加载页面：地图、课程、勋章这些文字是模块加载时就建好的表。所以入口 `src/main.ts` 先 `initI18n()` 再动态加载 `src/boot.ts`；`index.html` 里有一小段脚本按同一套规则先定一次（加载画面的字跟着换），结果放在 `window.__bootLang`。测试环境里一律是中文。

游戏本体是入口定好语言以后才动态加载的，所以构建出来的页面里本来只剩入口一个脚本，three.js、物理引擎和样式表要晚一拍才开始下载。`vite.config.ts` 里的小插件 `preloadGame` 把它们写回 `<head>`（`modulepreload` 只下载不执行，样式表直接链接），和入口同时开始下。`tools/artifact-page.mjs` 也是按这两种标签从 `dist/index.html` 里找样式表和要预加载的分块，改构建配置时两边一起看。

加了或改了界面文字之后：

1. 新的字面量包进 `tr()`；只给开发者看的（`console.warn`、`new Error`）不用包，`tools/i18n-allow.json` 是白名单。
2. `node tools/i18nScan.ts` 看有没有没包起来的中文、缺译文的键、字典里用不到的旧键（加 `--bare`、`--stale` 列出来，`--dump tmp/i18n` 把缺的键按文件写成 JSON）。
3. 在 `src/i18n/dict/` 对应的表里补上英文和日文。
4. `npm test`：`tests/i18n.test.ts` 会查每一句都有两种译文、占位符和 `<b>`、`<kbd>` 这些标记对得上、英文里没有残留的中日文字符。

要注意的：

- 逻辑不要依赖译文（比如按提示开头的两个字判断它是哪一句）：换了语言就失效。
- 句子别用“前半句 + 变量 + 后半句”拼：各种语言的词序不一样，写成一个模板。
- 写死在样式表里的字（竖屏提示）用 `:root[lang='en']`、`:root[lang='ja']` 各补一条。
- 字体按语言分（`:root[lang='ja']` 用日文字体，不然汉字是中文字形）；英文、日文的 HUD 标签比中文长，面板宽度也按语言放宽。
- 改了界面要把三种语言都过一遍：英文一句话常常比中文长一倍。

把三种语言的界面过一遍用 `tools/uiLang.mjs`：一种窗口、一种语言，把主菜单到结算的每个界面打开一遍，查超出窗口、互相压住、被截断的字，记下缺译文的句子和页面报错，并截图。先做一份不会变的构建再跑（跑的时候改 `src` 不会把页面刷新掉）：

```bash
npx vite build --outDir tmp/snapshot
npx vite preview --outDir tmp/snapshot --port 4176 --strictPort
```

```bash
CHROME_EXTRA_ARGS="--disable-gpu --use-angle=swiftshader" node tools/uiLang.mjs en1280 1280 720 en menu,fly,free,tut,credits,sim
CHROME_EXTRA_ARGS="--disable-gpu --use-angle=swiftshader" node tools/uiLang.mjs jaPhone 844 390 ja tut,fly mobile
```

结果在 `tmp/uilang/log.txt`，一行一条：`R` 是排版（`ok`，或者 `OUT` 超出窗口、`OVER` 互相压住、`CLIP` 被截断），`M` 是缺译文的句子数，`E` 是页面报错数。`OVER` 不一定是毛病（暂停菜单后面本来就垫着 HUD，主菜单的语言按钮和标题同在一个大方框里），要对着截图看。一次只开一个浏览器；软件渲染下平板（2 倍像素）一秒不到一帧，一组要十来分钟。

Firefox 用 `tools/ffsmoke.mjs`（无头 Firefox，临时配置目录，WebDriver BiDi 驱动）：

```bash
node tools/ffsmoke.mjs tmp/ff tools/steps/firefox_smoke.json
```

默认是软件渲染（WebGL 走 WARP），不占显卡；显卡空着的时候加环境变量 `FF_GPU=1`、换成 `tools/steps/firefox_gpu.json`，WebGL 用真显卡跑。**Firefox 的 WebGPU 用它测不了**：无头模式下 `requestAdapter()` 拿到的是 `null`（软件适配器、强制开 GPU 进程都试过），游戏在无头 Firefox 里总是退到 WebGL2。所以它测的是 Firefox 的脚本引擎、排版和 WebGL2 这条路；WebGPU 那条路要在真的 Firefox 窗口里打开看。

分享卡片 `public/og.jpg`（发到聊天、社交网站时显示的图）：`python tools/mk_og.py docs/screenshots/04_japan.jpg public/og.jpg`。

## 部署到 GitHub Pages

本仓库已开启 GitHub Pages：每次推送到 `main`，工作流通过检查后自动部署到 https://tenshojin.github.io/rotor-trails/ 。

仓库里的 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) 在每次推送到 `main` 时自动执行类型检查、测试和构建；构建产物使用相对路径（`base: './'`），可以放在任何子路径下（例如 `https://<用户名>.github.io/rotor-trails/`）。

在自己的仓库（例如复刻后）开启发布的步骤：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**
2. 仓库 **Settings → Secrets and variables → Actions → Variables** 新建变量 `DEPLOY_PAGES`，值为 `true`（或在 Actions 页面手动运行一次 “CI / Pages” 工作流）
3. 等待工作流完成，在 Pages 设置页查看网址

> 注意：**私有仓库**使用 GitHub Pages 需要付费方案（GitHub Pro / Team / Enterprise）。免费账号需要把仓库改为公开才能启用 Pages——是否公开由仓库所有者决定。

也可以把 `npm run build` 生成的 `dist/` 目录上传到任意静态网站托管服务；不能直接双击打开 `dist/index.html`（浏览器不允许从本地文件加载模块）。

## 私有试玩页（claude.ai Artifact）

除了 GitHub Pages，还有一份只有所有者能打开的试玩页（claude.ai Artifact「Rotor Trails · 旋翼航迹」）。**每次推送上线后都要同步更新它。**

1. `npm run build`
2. `node tools/artifact-page.mjs tmp/artifact/index.html > tmp/artifact-files.json`：生成完整的 HTML 页面和附属文件清单（`tmp/` 不进仓库）。模型（.glb）转成 base64 文本 `<名字>.glb.txt`（Artifact 不托管 .glb），页面里设 `window.__modelExt = '.txt'`，由 `src/render/gltf.ts` 解码。
3. 发布（每次最多 64 MiB、256 个文件，单个文件不超过 20 MiB）：先发 `models/` 下的文件（约 53 MiB），再发其余文件和 `index.html`，同一次里把旧版本留下、这次没有的文件删掉。
4. 上线前可以在本机按发布后的目录结构摆好（`tmp/artifact-test/`），用 `.claude/launch.json` 里的 `rotor-artifact-test`（端口 4180）跑一遍。

限制：Artifact 只能加载自己的文件，访问别的网站会被拦；大峡谷的中圈影像一个文件 21 MB，超过单个文件的上限，30 厘米影像又放在另一个仓库的网站上，所以试玩页不发布 `real/`，页面里设 `window.__artifact = true`，游戏在这里不列出真实地形的地图。

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
  i18n/        多语言：tr() 和按来源文件分的字典（dict/，中文原文 → [英文, 日文]）
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
