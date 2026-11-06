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

## 能不能接入 DLSS 5

**结论：网页版接不了，桌面版目前也接不了，要等 NVIDIA 放出 SDK。**

- [NVIDIA 的开发者文章](https://developer.nvidia.com/blog/whats-new-for-game-developers-dlss-5-with-3d-guided-neural-rendering-nvidia-ace-updates-and-new-rtx-kit-capabilities/)说 DLSS 5 是管线最后一步的神经渲染，输入是画面颜色和运动向量，在 RTX 50 系（含笔记本）本地运行。文章里没有 SDK、Streamline 或引擎插件的集成说明，只有登记接收更新的入口。
- 公开的 [Streamline](https://github.com/NVIDIA-RTX/Streamline/releases) 走的是 DirectX / Vulkan 原生接口，我查到的公开开发者插件停在 [DLSS 4.5](https://wccftech.com/nvidia-dlss-4-5-streamline-plugin-rtx-neural-texture-compression-sdk-available-game-devs/)。
- 浏览器的 WebGPU 碰不到显卡驱动里的 DLSS 接口，网页也不能加载本地动态库。
- 有人做了[在浏览器里跑 DLSS 5 的演示](https://www.tweaktown.com/news/113613/a-modder-got-dlss-5-running-inside-a-web-browser/index.html)，但不是官方的，报道里说它可能用了泄露的二进制或提取的权重，只能看模型，速度也不够玩游戏。来源和授权都不清楚，**不能用**。

### 以后想接的路线

1. 在 NVIDIA 开发者网站登记接收 DLSS 更新（要用你自己的账号，许可条款也要你自己看和接受）。
2. 等 SDK 公开后，做一个 Windows 桌面版外壳：用 Dawn（Chrome 的 WebGPU 实现）跑现在的渲染代码，从外壳里拿到 D3D12 纹理交给 Streamline。Electron 现成的共享纹理接口是[导入成 VideoFrame](https://github-redirect.dependabot.com/electron/electron/pull/42001)，不能直接接到 WebGPU，所以外壳要自己写原生部分。
3. 游戏这边要提供的数据已经有：线性 HDR 颜色、运动向量和深度。

### 现在能做的

浏览器里最接近的是 three.js 的 `TAAUNode`（时间超分）。这台电脑 1080p 极高画质每帧约 8~9 ms，暂时不缺性能；DLSS 5 真正吸引人的是光照和材质的观感，这部分这一轮用物理大气、GT7 色调映射和实时环境光来提升。
