# Rotor Trails — press kit

Everything a writer, curator or awards judge needs in one place. All text and images in this folder and in `docs/screenshots/` may be used in coverage of the game.

## Fact sheet

| | |
| --- | --- |
| **Title** | Rotor Trails（旋翼航迹） |
| **Genre** | First-person helicopter flight sim |
| **Platform** | Web browser (desktop, tablet, phone). Nothing to install |
| **Play** | https://tenshojin.github.io/rotor-trails/ |
| **Price** | Free. No ads, no accounts, no tracking |
| **Players** | Single player |
| **Languages** | English, Japanese, Simplified Chinese |
| **Input** | Keyboard and mouse, gamepad, touch |
| **Developer** | TIANCHENG JIN (solo, self-published) |
| **First public version** | November 2026 |
| **Technology** | TypeScript, three.js (WebGPU with a WebGL2 fallback), Rapier physics |
| **Source** | https://github.com/tenshojin/rotor-trails |
| **Contact** | https://github.com/tenshojin/rotor-trails/issues |

## One line

A first-person helicopter sim that runs in a browser tab: fly missions over five hand-built maps, drift across the real Grand Canyon, or start a cold aircraft with 135 working switches.

## One paragraph

Rotor Trails puts you in the right-hand seat of a light helicopter and lets you fly it straight from a web page. Five mission maps (a Japanese bay, a red-rock canyon, the Amazon, a Norwegian fjord and a Himalayan pass) ask for careful flying rather than speed: deliver supplies, hover over a boat to lower a crate, land on a monastery pad at 3,450 m. Free Flight removes the goals entirely and adds the Grand Canyon, rebuilt from U.S. Geological Survey elevation data and 2023 aerial imagery, 41 km on a side. And for players who want the real thing, Full Sim turns every assist off: you start the turbine by hand, hold the torque with your own feet, and learn to land without an engine.

## What makes it different

- **It is a web page.** No download, no launcher, no account. A link is the whole installation, and it works on a phone.
- **It flies with weight.** Lift tilts with the airframe, wind pushes you sideways, thin air at altitude takes your power away. Assists steady the aircraft but never cancel physics.
- **Nothing is timed.** Missions are scored on how well you fly: airframe condition, collisions and the quality of the final landing.
- **A real place.** The Grand Canyon map is not generated: every butte and rock layer is where it stands in reality, with 30 cm imagery streaming in as you fly low.
- **A cockpit that works.** In Full Sim, 135 buttons, switches, knobs and breakers do what they do in the aircraft, from a cold start to an autorotation.
- **A world that moves.** Ferries, fishing boats, cars, birds and a light aircraft in the circuit share the map, and everything you can see you can also hit.
- **Weather you can read.** Windsocks, flags, smoke, trees, whitecaps and the slant of the rain all show the same wind that is pushing the aircraft.
- **Made to be looked at.** Photo Mode, a cinematic replay camera, four times of day, fog, snow, lightning and an aurora over the fjord.
- **Made almost entirely from code.** Terrain, sky, water, instruments and all sound are generated; the cockpit, buildings and trees are modeled by scripts in the repository. The only bought-in assets are CC0 photo materials.

## Modes

| Mode | What it is |
| --- | --- |
| Missions | Five maps, each with four main objectives, two optional ones and a choice of routes |
| Free Flight | Any map, any time of day and weather, auto-cruise from sight to sight, places to discover |
| Flight School | 7 basic lessons (about 10 minutes) and 8 Full Sim lessons (about 20 minutes) |
| Full Sim | Cold start, no assists, working cockpit, autorotation |
| Photo Mode and Replay | Free camera, focal length, exposure, blur, looks; the last four minutes replayed by a cinematic camera |

## Screenshots

All captured in the game, in a browser. Files are in [`docs/screenshots/`](../screenshots/). Captures that show the interface exist in three languages: English in [`docs/screenshots/en/`](../screenshots/en/), Japanese in [`docs/screenshots/ja/`](../screenshots/ja/), and Chinese in the main folder. The Photo Mode captures have no interface on them.

| File | Shows |
| --- | --- |
| `04_japan.jpg` | Sunrise over the coast of Seto Bay from the cockpit |
| `05_canyon.jpg` | Red Rock Canyon |
| `06_amazon.jpg` | Rainforest Bend |
| `07_fjord.jpg` | Mistbay Fjord |
| `08_himalaya.jpg` | Snowfield Pass |
| `09_weather_fog.jpg` | Dense fog |
| `21_storm_night.jpg` | A rainstorm at night |
| `15_photo_canyon.jpg`, `16_photo_sea.jpg`, `17_photo_fjord.jpg` | Photo Mode |
| `18_night_aurora.jpg` | Aurora over the fjord |
| `19_night_sky.jpg` | Stars over the Grand Canyon |
| `20_snow_fjord.jpg` | Snow in the fjord |
| `22_canyon_wall.jpg`, `23_canyon_gorge.jpg`, `24_canyon_village.jpg` | The Grand Canyon: cliffs, the Inner Gorge, the South Rim village |
| `13_landing_assist.jpg`, `14_damage_critical.jpg`, `16_results.jpg` | Interface: landing aid, damage, results |
| `en/01_main_menu.jpg`, `en/02_map_select.jpg`, `en/03_briefing.jpg` | Interface: main menu, map select, mission briefing (also in `ja/`) |
| `25_credits.jpg` | The credits: an auto-cruise flight over Seto Bay at dusk while the names roll |

Social card (1200 × 630): [`public/og.jpg`](../../public/og.jpg).

## Requirements

- A current desktop browser. Chrome or Edge with hardware acceleration is recommended; WebGPU is used when available and WebGL2 otherwise.
- A dedicated graphics card for the higher quality levels. Quality is chosen automatically on first launch and can be changed in Settings.
- First load is about 2 MB, plus 17–21 MB of models and textures per map, cached by the browser afterwards. The Grand Canyon downloads about 90 MB the first time.

## Credits

- Design, code, modeling scripts and sound: TIANCHENG JIN, working with AI coding assistants.
- Elevation data for the Grand Canyon: USGS 3D Elevation Program. Imagery: USDA National Agriculture Imagery Program, 2023, via USGS The National Map. U.S. Government public-domain data, courtesy of the U.S. Geological Survey.
- Photo materials: [Poly Haven](https://polyhaven.com) (CC0).
- Libraries: three.js (MIT), Rapier (Apache-2.0). Full list in [THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md).

## Other languages

**日本語（ひとこと）**：ブラウザのタブで動く、一人称視点のヘリコプターシム。5 つのマップでミッションをこなし、実測データで再現したグランドキャニオンを自由に飛び、135 個のスイッチが動くコックピットでコールドスタートから操縦できます。無料、インストール不要。

**简体中文（一句话）**：开在浏览器标签页里的第一人称拟真直升机。五张地图的任务，用真实测绘数据做的大峡谷，135 个开关都能按的冷舱启动。免费，不用安装。
