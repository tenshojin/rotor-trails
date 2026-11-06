# 网页端画面调研（2026-11-06）

这份文档记下调研过什么、用了什么、没用什么和原因。

## 开源项目

| 项目 | 是什么 | 结论 |
| --- | --- | --- |
| [Hillaire 2020](https://diglib.eg.org/items/8a3e5350-18b3-46bd-9274-3add5af88c75/full) | 虚幻 5、Bevy 用的物理大气算法（透过率、多次散射、天空三张查找表） | **采用**，自己实现在 `src/render/skyModel.ts`。太阳在一局里不动，表在 CPU 上算一次，不需要新依赖 |
| [takram three-geospatial](https://github.com/takram-design-engineering/three-geospatial) | three.js 的物理大气和体积云（MIT，大气的 WebGPU 版已完成，云还在做） | 面向地球尺度的地理数据，要换掉现有的雾和云。算法思路一样，没有引入 |
| [webgpu-sky-atmosphere](https://awesome.ecosyste.ms/projects/github.com%2Fjolifantobambla%2Fwebgpu-sky-atmosphere) | Hillaire 算法的 WebGPU 实现（MIT） | 可以作为对照。它按帧在显卡上算，这里用不到 |
| [GT7 色调映射](https://blog.selfshadow.com/publications/s2025-shading-course/) | Polyphony Digital 在 SIGGRAPH 2025 公开的算法和 MIT 示例代码；BeamNG 已经换用 | **采用**，移植到 `src/render/toneMap.ts`，同帧对比 Neutral、AgX、ACES 后选定 |
| [Khronos PBR Neutral](https://khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products) | 之前在用，为商品展示设计 | 换掉。Khronos 自己也建议强 HDR 场景用电影式映射 |
| three.js r187 自带节点 | `TAAUNode`（时间超分）、`FSR1Node`、`Lut3DNode`、`GodraysNode`、`TileShadowNode`、`SSGINode`、`SSSNode` 等 | SSGI / SSS 之前试过（见 `docs/progress.md` 阶段 O）；超分见下文 |
| [Bevy](https://docs.rs/bevy) | Rust 引擎，能编译到 WebGPU，带物理大气、PCSS（实验性）、多种色调映射 | 拿来当算法参考，不能直接用在 three.js 里 |
| [pmndrs/drei soft shadows](https://github.com/pmndrs/drei/blob/master/src/core/softShadows.tsx)、[PCSS 示例](https://gkjohnson.github.io/threejs-sandbox/pcss/index.html) | WebGL 上的软阴影 | 都是 GLSL，不能用在 WebGPU 节点材质上。太阳的角直径只有 0.53°，飞行视角下半影只有几厘米到十几厘米，收益很小，改做接触阴影 |
| [Tzathas 2024](https://diglib.eg.org/handle/10.1111/cgf15033)、[Schott 2023](https://history.siggraph.org/?p=132308) | 河流功率法则的地形生成 | 思路**采用**，自己实现在 `src/world/fluvial.ts` |

## 舱内光照

舱内不用实时全局光照。机舱的几何是固定的，天光怎么从窗户进来、怎么在内饰之间反弹，用 Blender Cycles 烘焙一次就够了（`K.bake_light`，2048²，5 秒）：世界是白的，上半球亮度 1、下半球 0.35，存平方根。游戏里乘上当时的天空颜色，所以时段和天气变了也对。环境贴图的遮蔽也用它，不然环境贴图不知道头顶有舱顶。

## 真实地形

程序生成的山再怎么调，形状都是算法的味道；换成测绘数据之后，大场面一下就对了。这张图里最值钱的三件事：

1. **去光照要留余地**。照片除以算出来的光照，影子边缘会留亮边。算出来的影子只当候选，照片上真够暗才算。
2. **高程比影像更值得信**。2.5 米的激光测绘连岩坎都有，远处的细节基本靠法线。影像在陡坡上被拉长，七十度以上就别用了。
3. **低空是短板**。1.25 米一个像素飞到 30 米就糊了，要靠细节贴图、立体的树和灌木顶上。细节贴图在大面积崖壁上一格一格的重复非常显眼，只能用在很近的地方。

## DLSS 5

调研后决定不做。DLSS 走的是 DirectX / Vulkan 原生接口，网页接不了；[NVIDIA 的文章](https://developer.nvidia.com/blog/whats-new-for-game-developers-dlss-5-with-3d-guided-neural-rendering-nvidia-ace-updates-and-new-rtx-kit-capabilities/)里也没有公开的 SDK。网上那个浏览器演示不是官方的，来源和授权都不清楚。浏览器里能做的是时间超分：设置里的“渲染分辨率”低于 100% 时走 three.js 的 `TAAUNode`。
