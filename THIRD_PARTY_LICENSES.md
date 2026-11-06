# 第三方许可（Third-Party Licenses）

Rotor Trails 的游戏代码、地形高度、仪表画面与音效由本项目程序生成；驾驶舱、直升机外观、建筑与树木由本仓库 `tools/blender/` 里的脚本在 Blender 中建模生成。没有使用外部的模型、音频或字体素材。

## 照片材质：Poly Haven（CC0）

地形与建筑表面使用 [Poly Haven](https://polyhaven.com) 的照片材质（漫反射、法线、粗糙度），许可为 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)（公共领域，可商用、可再分发，无需署名；这里仍列出以便追溯）。游戏里使用的是缩小、转换格式或调整颜色后的版本（`public/textures/`，以及嵌在 `public/models/*.glb` 里的贴图）。

游戏里用到的 28 种：aerial_grass_rock、aerial_rocks_02、brown_mud_02、clay_plaster、cliff_side、coast_sand_01、concrete_wall_008、corrugated_iron、cracked_red_ground、distressed_painted_planks、dry_ground_01、forest_ground_04、forest_leaves_02、gravelly_sand、grey_roof_tiles、hinoki_planks、japanese_cedar_planks、mossy_rock、palm_bark、pine_bark、poly_wool_herringbone、rabdentse_ruins_wall、red_laterite_soil_stones、rock_face、rocky_terrain_02、snow_field_aerial、thatch_roof_angled、white_plaster_02（下载清单与脚本见 `tools/assets/sources.json`、`tools/fetch_assets.mjs`；清单里另有几种下载过但最终没有使用）。木板教堂的焦油木瓦贴图为程序生成。

## 建模参照照片（不随游戏分发）

以下照片只在建模时用来对照比例与细节，**不包含在仓库和网站中**：

| 照片（维基共享资源） | 作者 | 许可 | 用途 |
| --- | --- | --- | --- |
| F-HGRU Airbus H125 helicopter cockpit (Ardèche, 2024) | Kakoula10 | CC BY-SA 4.0 | 驾驶舱仪表板布局 |
| AS350 B3 Écureuil – SDIS 04 à Digne-les-Bains（07、08 两张） | X-Javier | CC BY-SA 4.0 | 座椅、风挡、舱门、顶窗结构 |

另外在维基共享资源上浏览查看过（未下载）的建筑照片：博尔贡木板教堂（Borgund Stave Church）、丹波切寺（Tengboche Monastery）、马瑙斯港客运木船（Riverboat, Manaus）、鞆之浦民居与严岛神社大鸟居。模型是按照片里的结构与比例重新建模的，没有使用照片像素。

## 程序库

构建产物（`dist/`，即部署到网页上的文件）中包含以下第三方开源库的代码：

| 库 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | 0.187.0 | MIT | WebGL2 三维渲染 |
| [Rapier](https://github.com/dimforge/rapier.js)（`@dimforge/rapier3d-compat`） | 0.21.0 | Apache-2.0 | 刚体物理与碰撞（WebAssembly） |
| [Draco](https://github.com/google/draco) 解码器（three.js 自带的 `draco_decoder.wasm` / `draco_wasm_wrapper.js` / `draco_decoder.js`，复制到 `public/draco/`） | 随 three.js 0.187.0 | Apache-2.0 | 解压 Draco 压缩的模型几何 |

仅在开发、测试和构建时使用（不包含在构建产物中）：

| 工具 | 版本 | 许可 |
| --- | --- | --- |
| [Vite](https://github.com/vitejs/vite) | 8.3.5 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 7.0.2 | Apache-2.0 |
| [Vitest](https://github.com/vitest-dev/vitest) | 5.1.0 | MIT |
| `@types/three`、`@types/node`（DefinitelyTyped） | 0.187.0 / 24.19.2 | MIT |

地图为虚构地形，只借鉴日本海湾、美国西南峡谷、亚马孙雨林、挪威峡湾、尼泊尔高山的地貌特色，不对应真实地理位置；游戏中出现的国旗图案为简化的几何绘制。

---

## three.js — MIT License

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## Rapier（@dimforge/rapier3d-compat）— Apache License 2.0

Copyright 2020 Dimforge EURL

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2020 Dimforge EURL

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

## 真实地形数据（大峡谷地图）

- 高程：USGS 3D Elevation Program (3DEP)，courtesy of the U.S. Geological Survey。公有领域。
- 航拍影像：USDA National Agriculture Imagery Program (NAIP) 2023，经 USGS The National Map 分发，USDA Farm Production and Conservation Business Center, Geospatial Enterprise Operations。公有领域。
- 下载和处理脚本：`tools/real/`。影像里拍摄时的光照已用高程反算去除，崖壁颜色由影像按高度统计得到。USGS、USDA 与本游戏没有关联，也没有为它背书。
