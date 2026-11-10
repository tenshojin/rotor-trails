// 字典：键是中文原文，值是 [英文, 日文]。按原文出自哪个源文件分成几张表（文件名是源文件路径，/ 换成 _）。
// 加了新的界面文字：在对应的表里加一行；tests/i18n.test.ts 会查有没有漏。
// 这里的 import 带 .ts 后缀：检查工具直接用 node 跑这些文件。

import type { Table } from '../index.ts';
import boot from './boot.ts';
import config_flight from './config_flight.ts';
import game_app from './game_app.ts';
import game_medals from './game_medals.ts';
import game_places from './game_places.ts';
import game_save from './game_save.ts';
import game_settings from './game_settings.ts';
import game_simTutorial from './game_simTutorial.ts';
import game_tutorial from './game_tutorial.ts';
import i18n_index from './i18n_index.ts';
import maps_amazon from './maps_amazon.ts';
import maps_canyon from './maps_canyon.ts';
import maps_fjord from './maps_fjord.ts';
import maps_grandcanyon from './maps_grandcanyon.ts';
import maps_himalaya from './maps_himalaya.ts';
import maps_japan from './maps_japan.ts';
import maps_placeNotes from './maps_placeNotes.ts';
import maps_training from './maps_training.ts';
import render_timeOfDay from './render_timeOfDay.ts';
import render_worldView from './render_worldView.ts';
import sim_controls from './sim_controls.ts';
import sim_damage from './sim_damage.ts';
import sim_mission from './sim_mission.ts';
import sim_nav from './sim_nav.ts';
import sim_scoring from './sim_scoring.ts';
import sim_session from './sim_session.ts';
import sim_systems from './sim_systems.ts';
import ui_hud from './ui_hud.ts';
import ui_menus from './ui_menus.ts';
import ui_photoPanel from './ui_photoPanel.ts';
import ui_replayPanel from './ui_replayPanel.ts';
import ui_simPanel from './ui_simPanel.ts';
import ui_touchControls from './ui_touchControls.ts';
import world_worldgen from './world_worldgen.ts';

const ALL: Table = {
  ...boot,
  ...config_flight,
  ...game_app,
  ...game_medals,
  ...game_places,
  ...game_save,
  ...game_settings,
  ...game_simTutorial,
  ...game_tutorial,
  ...i18n_index,
  ...maps_amazon,
  ...maps_canyon,
  ...maps_fjord,
  ...maps_grandcanyon,
  ...maps_himalaya,
  ...maps_japan,
  ...maps_placeNotes,
  ...maps_training,
  ...render_timeOfDay,
  ...render_worldView,
  ...sim_controls,
  ...sim_damage,
  ...sim_mission,
  ...sim_nav,
  ...sim_scoring,
  ...sim_session,
  ...sim_systems,
  ...ui_hud,
  ...ui_menus,
  ...ui_photoPanel,
  ...ui_replayPanel,
  ...ui_simPanel,
  ...ui_touchControls,
  ...world_worldgen,
};

export default ALL;
