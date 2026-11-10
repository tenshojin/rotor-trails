// 超仿真教学：从冷舱到关车，再到发动机空中停车。和基础教学一样一步只教一件事、每一步都看真实状态。
// 不一样的地方：这里没有悬停辅助，HUD 是收起来的，要看的数字写在教学卡片上；要动的控件外面亮一圈，
// 第 4 课专门讲为什么飞机总想往右转（见 docs/design.md“反扭矩”）。

import { ENGINE } from '../sim/systems';
import type { GameSession } from '../sim/session';
import { clamp01, padDist, turned, type Lesson, type StepState } from './tutorial';
import { tr } from '../i18n';

const sys = (s: GameSession) => s.sys!;
const on = (s: GameSession, key: string) => sys(s).c[key] > 0.5;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 偏航角速度（度/秒，向右为正），平滑过的。用 st.b 存状态 */
function yawRate(s: GameSession, st: StepState, dt: number): number {
  st.b += (turned(s, st) / dt - st.b) * Math.min(1, dt * 6);
  return st.b;
}

/** 稳住：条件成立时累计，不成立时往回退，不是一下清零（键盘飞起来总要抖一下） */
function hold(st: StepState, dt: number, ok: boolean, seconds: number): number {
  st.t = Math.max(0, st.t + (ok ? dt : -dt * 0.6));
  return clamp01(st.t / seconds);
}

const engine = (s: GameSession) => tr`N1 <b>${Math.round(sys(s).n1)}%</b> · 排气温度 <b>${Math.round(sys(s).tot)} ℃</b> · 旋翼 <b>${pct(s.flight.nr)}</b>`;
const hoverNums = (s: GameSession) => tr`离地 <b>${s.agl.toFixed(1)} m</b> · 地速 <b>${s.groundSpeed.toFixed(1)} m/s</b> · 升降 <b>${s.body.vel.y.toFixed(1)} m/s</b> · 扭矩 <b>${pct(s.flight.telemetry.torque)}</b>`;
const flightNums = (s: GameSession) => tr`空速 <b>${Math.round(s.flight.telemetry.airspeed)} m/s</b> · 离地 <b>${Math.round(s.agl)} m</b> · 升降 <b>${s.body.vel.y.toFixed(1)} m/s</b> · 扭矩 <b>${pct(s.flight.telemetry.torque)}</b> · 旋翼 <b>${pct(s.flight.nr)}</b>`;

export const SIM_LESSONS: Lesson[] = [
  {
    title: tr('鼠标和座舱'),
    sub: tr('鼠标不再转头，它是你的手和眼睛'),
    parts: [],
    allow: 'none',
    steps: [
      {
        id: 'simWelcome',
        title: tr('欢迎来到超仿真'),
        text: () => tr('这里<b>没有悬停、没有高度保持</b>，按钮和仪表都是真的。全部学完大约 20 分钟。'),
        why: () => tr('撞了不算失败，会回到这一课的开头。基础教学里“松手就停住”的习惯这里不管用了。'),
        manual: true,
      },
      {
        id: 'simLook',
        title: tr('转头'),
        text: () => tr('把鼠标移到屏幕<b>左边缘</b>，视线往左转；再移到<b>右边缘</b>。越靠边转得越快。'),
        why: () => tr('鼠标在画面中间时什么都不会动，这样才能腾出手去点开关。'),
        check: (_s, st, _dt, c) => {
          st.a = Math.max(st.a, c.yaw);
          st.b = Math.max(st.b, -c.yaw);
          return (clamp01(st.a / 0.45) + clamp01(st.b / 0.45)) / 2;
        },
        stuck: () => tr('鼠标要贴到屏幕最边上，停一会儿。'),
      },
      {
        id: 'simCenter',
        title: tr('看回前方'),
        text: (k) => tr`按一下 <kbd>${k('center')}</kbd>，视线回到正前方。`,
        keys: ['center'],
        check: (_s, _st, _dt, c) => (Math.abs(c.yaw) < 0.1 ? 1 : 0),
      },
      {
        id: 'simPoint',
        title: tr('指一指'),
        text: () => tr('把鼠标<b>指向</b>亮着光圈的 <b>BATT</b> 开关，不要点。名字、说明和当前状态会显示出来。'),
        why: () => tr('指着只是在看名称和读数，点下去才会按。'),
        control: 'rk_batt',
        check: (_s, st, dt, c) => hold(st, dt, c.hover === 'rk_batt', 0.5),
        stuck: () => tr('光圈在仪表板下方。把鼠标移到屏幕下边缘低头找。'),
      },
      {
        id: 'simPanel',
        title: tr('两个手柄'),
        text: () => tr('黄色手柄是<b>旋翼刹车</b>，红色手柄是<b>燃油切断阀</b>。现在都在飞行位置，不用动。'),
        why: () => tr('起动前要确认：刹车没松旋翼转不动，燃油阀关着发动机点不着。'),
        manual: true,
      },
    ],
  },
  {
    title: tr('冷舱启动'),
    sub: tr('亲手把一架断电的飞机叫醒'),
    parts: [],
    allow: 'none',
    steps: [
      {
        id: 'simBatt',
        title: tr('接通电瓶'),
        text: () => tr('点一下 <b>BATT</b>。整架飞机的电都从这里来。'),
        why: () => tr('仪表和告警灯会亮起来。'),
        control: 'rk_batt',
        check: (s) => (on(s, 'batt') ? 1 : 0),
      },
      {
        id: 'simAcol',
        title: tr('打开防撞灯'),
        text: () => tr('点 <b>A-COL</b>：机顶的红灯开始闪。'),
        why: () => tr('告诉地面上的人：这架飞机要起动了，离旋翼远点。'),
        control: 'rk_acol',
        check: (s) => (on(s, 'acol') ? 1 : 0),
      },
      {
        id: 'simFuelP',
        title: tr('打开燃油泵'),
        text: () => tr('点 <b>FUEL P</b>，等油压升起来。'),
        why: () => tr('发动机自己的泵要转起来才有油压，起动时全靠这台电动泵。'),
        control: 'rk_fuelP',
        check: (s) => (on(s, 'fuelP') ? 0.5 : 0) + (sys(s).fuelPress > 0.7 ? 0.5 : 0),
      },
      {
        id: 'simIdle',
        title: tr('起动发动机'),
        text: () => tr('左键点 <b>ENG MAIN</b>，转到 <b>IDLE</b>。看着 N1 往上爬，等它稳在 68%。'),
        why: () => tr('起动机先带着发动机转，N1 过 12% 点火。排气温度会冲高一下，超过 865 ℃ 就是热起动，发动机要受伤。'),
        control: 'eng_main',
        live: engine,
        check: (s) => (sys(s).c.engMain >= 1 ? 0.1 + 0.9 * clamp01(sys(s).n1 / (ENGINE.idleN1 - 1)) : 0),
      },
      {
        id: 'simGen',
        title: tr('接通发电机'),
        text: () => tr('点 <b>GEN</b>。从现在起是发电机在供电，顺便给电瓶充电。'),
        control: 'rk_gen',
        check: (s) => (sys(s).genOnline ? 1 : 0),
      },
      {
        id: 'simPitot',
        title: tr('皮托加温'),
        text: () => tr('点 <b>PITOT</b>。'),
        why: () => tr('空速表靠机头那根小管子测风。冷天和雨里不加温，管口结冰，空速表就会骗你。'),
        control: 'rk_pitot',
        check: (s) => (on(s, 'pitot') ? 1 : 0),
      },
      {
        id: 'simSasOn0',
        title: tr('打开增稳'),
        text: (k) => tr`点 <b>SAS</b>，快捷键是 <kbd>${k('hover')}</kbd>。`,
        why: () => tr('增稳替你压住抖动、守住航向。用键盘飞一定要开，第 4 课会让你关掉它感受一下。'),
        control: 'rk_sas',
        check: (s) => (on(s, 'sas') ? 1 : 0),
      },
      {
        id: 'simFlightPos',
        title: tr('升到飞行转速'),
        text: () => tr('再左键点 <b>ENG MAIN</b>，转到 <b>FLIGHT</b>。等旋翼到 100%。'),
        why: () => tr('调速器会把旋翼转速守在 100%，发动机功率跟着你提的总距走。'),
        control: 'eng_main',
        live: engine,
        check: (s) => (sys(s).c.engMain >= 2 ? 0.1 + 0.9 * clamp01((s.flight.nr - 0.3) / 0.67) : 0),
      },
      {
        id: 'simStarted',
        title: tr('发动机启动完成'),
        text: () => tr('这 8 步就是真实的启动程序。以后不想手动做，可以点左上角检查单的<b>自动完成</b>。'),
        manual: true,
      },
    ],
  },
  {
    title: tr('离地和悬停'),
    sub: tr('没有辅助，靠自己把飞机停在空中'),
    parts: [],
    allow: 'all',
    park: 'T-start',
    steps: [
      {
        id: 'simCollective',
        title: tr('总距杆'),
        text: (k) => tr`<kbd>${k('up')}</kbd> 把总距往上提，<kbd>${k('down')}</kbd> 往下放。<b>松手它就停在那里</b>，不会回中。`,
        why: () => tr('总距就是旋翼的“油门”：提得越多升力越大，发动机出力也越大。'),
        manual: true,
        anchor: true,
      },
      {
        id: 'simLight',
        title: tr('慢慢提'),
        text: (k) => tr`按住 <kbd>${k('up')}</kbd>，看扭矩往上走。机身变轻了，滑橇上的重量越来越少。`,
        why: () => tr('慢一点。一下提太多，飞机会像弹簧一样蹿上去。'),
        keys: ['up'],
        live: hoverNums,
        check: (s) => clamp01((1 - s.gear.weightOnSkids) / 0.6),
      },
      {
        id: 'simOffGround',
        title: tr('离地'),
        text: (k) => tr`再提一点点，离地 <b>2 米</b>。一离地就松开 <kbd>${k('up')}</kbd>。`,
        keys: ['up'],
        live: hoverNums,
        check: (s) => clamp01(s.agl / 2),
        stuck: (k) => tr`按住 <kbd>${k('up')}</kbd>，看到“离地”开始变大就松手。`,
      },
      {
        id: 'simHold',
        title: tr('稳住'),
        text: (k) => tr`停在离地 <b>2~15 米</b>，地速 3 m/s 以下，坚持 <b>8 秒</b>。高度用 <kbd>${k('up')}</kbd><kbd>${k('down')}</kbd>，位置用 <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd><kbd>${k('strafeLeft')}</kbd><kbd>${k('strafeRight')}</kbd>，都是<b>点一下</b>。`,
        why: () => tr('飞机对你的操作有延迟。看到它开始动就要轻轻往回带，等动起来了再按就晚了。'),
        keys: ['forward', 'back', 'strafeLeft', 'strafeRight'],
        live: hoverNums,
        check: (s, st, dt) => hold(st, dt, s.agl > 1.2 && s.agl < 18 && s.groundSpeed < 3.5, 8),
        stuck: (k, s) => (s.groundSpeed >= 3.5 ? tr('地速太快了：往飞机走的反方向点几下。') : s.agl >= 18 ? tr`太高了，点 <kbd>${k('down')}</kbd>。` : tr`太低了，点 <kbd>${k('up')}</kbd>。`),
      },
    ],
  },
  {
    title: tr('反扭矩'),
    sub: tr('为什么直升机总想往右转'),
    parts: [],
    allow: 'all',
    jump: true,
    place: { x: 0, z: 140, agl: 45, heading: 0 },
    steps: [
      {
        id: 'simTorqueWhy',
        title: tr('为什么总想往右转'),
        text: () => tr('从上往下看，主旋翼是<b>逆时针</b>转的。发动机用力把旋翼往左拧，旋翼就用同样大的力把机身往右拧：<b>机头往右走</b>，这叫反扭矩。'),
        why: (k) => tr`尾巴上的小旋翼就是顶这个力的。<kbd>${k('left')}</kbd><kbd>${k('right')}</kbd> 是脚蹬，控制尾桨推力的大小。`,
        manual: true,
        anchor: true,
      },
      {
        id: 'simSasOff',
        title: tr('关掉增稳'),
        text: (k) => tr`增稳一直在替你踩脚蹬。按一下 <kbd>${k('hover')}</kbd> 把它关掉，亲自感受。`,
        keys: ['hover'],
        control: 'rk_sas',
        check: (s) => (on(s, 'sas') ? 0 : 1),
      },
      {
        id: 'simFeel',
        title: tr('放手看它转'),
        text: () => tr('<b>松开所有按键</b>，盯着地平线：机头自己往右转。等它转过 <b>40°</b>。'),
        why: () => tr('这就是你在超仿真里感觉到的那股力。真飞行员的左脚一直踩着，从不放松。'),
        live: (s) => tr`扭矩 <b>${pct(s.flight.telemetry.torque)}</b> · 总距 <b>${pct(s.flight.collective)}</b>`,
        check: (s, st) => {
          st.a += turned(s, st);
          return clamp01(st.a / 40);
        },
      },
      {
        id: 'simStopYaw',
        title: tr('踩左脚蹬'),
        text: (k) => tr`<b>点按</b> <kbd>${k('left')}</kbd>，一下一下把机头停住，踩过了就点 <kbd>${k('right')}</kbd> 往回。转动小于 5°/秒，坚持 3 秒。`,
        why: () => tr('悬停大约要踩 10% 的左脚蹬。增稳关着时脚蹬<b>踩到哪里就留在哪里</b>，松手也还顶着，这和真飞机一样。'),
        keys: ['left', 'right'],
        live: (s) => tr`脚蹬 <b>${pct(s.flight.telemetry.pedal)}</b>（负数是左脚）`,
        check: (s, st, dt) => {
          const r = yawRate(s, st, dt);
          return hold(st, dt, Math.abs(r) < 5, 3);
        },
        stuck: (k) => tr`每次只点一下，等一秒看机头的反应再点。飞机有惯性，反应比手慢。一直按着 <kbd>${k('left')}</kbd> 就蹬过头了。`,
      },
      {
        id: 'simMoreTorque',
        title: tr('多提总距，右转更猛'),
        text: (k) => tr`按住 <kbd>${k('up')}</kbd> 提一点总距，看机头：它又开始往右了。`,
        why: () => tr('总距一动扭矩就变，所以每次提放总距都要配脚蹬。这也是飞行员手脚要一起动的原因。'),
        keys: ['up'],
        live: (s) => tr`扭矩 <b>${pct(s.flight.telemetry.torque)}</b>`,
        check: (s, st, dt) => {
          const r = yawRate(s, st, dt);
          return hold(st, dt, r > 3, 0.6);
        },
      },
      {
        id: 'simSasBack',
        title: tr('打开增稳'),
        text: (k) => tr`按 <kbd>${k('hover')}</kbd> 把增稳打开，飞机马上稳下来。`,
        why: () => tr('平时飞都开着它。但它不替你飞：电没了、断路器拔了，它就没了，右转的力马上回来。'),
        keys: ['hover'],
        control: 'rk_sas',
        check: (s) => (sys(s).sasActive ? 1 : 0),
      },
    ],
  },
  {
    title: tr('前飞和转弯'),
    sub: tr('穿过平移升力，用坡度转弯'),
    parts: [],
    allow: 'all',
    jump: true,
    place: { x: -72, z: 900, agl: 130, heading: 0 },
    steps: [
      {
        id: 'simPush',
        title: tr('推杆前进'),
        text: (k) => tr`按住 <kbd>${k('forward')}</kbd> 压低机头，空速到 <b>15 m/s</b>。别压太多，机头低 5~10° 就够。`,
        why: () => tr('旋翼的力往前倾，一部分就变成了推力。压得越多，升力就少一点，飞机会往下掉。'),
        keys: ['forward'],
        anchor: true,
        live: flightNums,
        check: (s) => clamp01(s.flight.telemetry.forwardAirspeed / 15),
      },
      {
        id: 'simEtl',
        title: tr('穿过抖动'),
        text: () => tr('继续加速到 <b>30 m/s</b>。8~12 m/s 的时候机身抖一阵，那是好事。'),
        why: () => tr('旋翼飞出了自己吹下去的气流，升力突然变大，这叫平移升力。这时飞机会往上飘，要放一点总距。'),
        live: flightNums,
        check: (s) => clamp01(s.flight.telemetry.forwardAirspeed / 30),
      },
      {
        id: 'simLevel',
        title: tr('平飞'),
        text: (k) => tr`保持 25 m/s 以上，用 <kbd>${k('up')}</kbd><kbd>${k('down')}</kbd> 把升降压到 ±2 m/s，坚持 <b>6 秒</b>。按一下 <kbd>${k('trim')}</kbd> 配平，手就不用一直按着杆了。`,
        keys: ['trim'],
        live: flightNums,
        check: (s, st, dt) => hold(st, dt, s.flight.telemetry.forwardAirspeed > 24 && Math.abs(s.body.vel.y) < 2.2, 6),
      },
      {
        id: 'simBank',
        title: tr('压坡度转弯'),
        text: (k) => tr`有了速度，<kbd>${k('left')}</kbd><kbd>${k('right')}</kbd> 不再是脚蹬，而是压坡度。向任一边转过 <b>90°</b>，坡度别超过 30°。`,
        why: () => tr('速度快时靠倾斜转弯，垂尾自己把机头带过去。坡度一大升力就不够，要提一点总距。'),
        keys: ['left', 'right'],
        live: flightNums,
        check: (s, st) => {
          const d = Math.abs(turned(s, st));
          if (s.flight.telemetry.forwardAirspeed > 15) st.a += d;
          return clamp01(st.a / 90);
        },
      },
      {
        id: 'simFlare',
        title: tr('抬头减速'),
        text: (k) => tr`按住 <kbd>${k('back')}</kbd> 抬起机头，把地速减到 <b>5 m/s</b> 以下。`,
        why: () => tr('抬头时旋翼兜住了风，飞机会往上飘，同时放一点总距。'),
        keys: ['back'],
        live: flightNums,
        check: (s, st) => {
          st.a = Math.max(st.a, s.groundSpeed, 6);
          return s.groundSpeed < 5 ? 1 : 0.95 * clamp01((st.a - s.groundSpeed) / (st.a - 5));
        },
      },
      {
        id: 'simHoverAgain',
        title: tr('重新悬停'),
        text: () => tr('稳住：地速 3 m/s 以下，升降 ±1.5 m/s，坚持 <b>3 秒</b>。'),
        live: hoverNums,
        check: (s, st, dt) => hold(st, dt, s.groundSpeed < 3.2 && Math.abs(s.body.vel.y) < 1.6, 3),
      },
    ],
  },
  {
    title: tr('进近和降落'),
    sub: tr('慢慢飞过去，稳稳放下来'),
    parts: [],
    allow: 'all',
    jump: true,
    place: { x: -260, z: 180, agl: 55, heading: 0 },
    steps: [
      {
        id: 'simSeePad',
        title: tr('找到降落坪'),
        text: () => tr('正前方地上标着 H 的就是降落坪。这一课要落在它上面。'),
        why: () => tr('坪上的黄圈是接地圈，飞到圈的正上方再下降。'),
        manual: true,
        anchor: true,
      },
      {
        id: 'simApproach',
        title: tr('飞过去'),
        text: () => tr('向 H 飞，一边飞一边减速。到坪前 <b>60 米</b> 时地速要低于 <b>10 m/s</b>，离地 20 米左右。'),
        why: () => tr('别等到了头顶才刹车，要像坐滑梯一样，速度和高度一起慢慢减下来。'),
        live: (s) => tr`离坪 <b>${Math.round(padDist(s))} m</b> · ${hoverNums(s)}`,
        check: (s, st) => {
          const d = padDist(s);
          st.a = Math.max(st.a, d, 70);
          return d < 60 && s.groundSpeed < 10 ? 1 : 0.95 * clamp01((st.a - d) / (st.a - 60));
        },
        stuck: (k, s) => (padDist(s) < 80 && s.groundSpeed >= 10 ? tr`太快了，按住 <kbd>${k('back')}</kbd>。` : tr('把 H 放在风挡正中，一直往前飞。')),
      },
      {
        id: 'simVrs',
        title: tr('小心涡环'),
        text: () => tr('下降时要记住一条：<b>不要几乎不动地快速往下掉</b>。下降超过 4 m/s 又没有前进速度，旋翼会掉进自己吹下去的气流里，提总距也没有用。'),
        why: () => tr('出现了就往前推杆，飞出去就好了。所以下降要慢，或者带着一点前进速度。'),
        manual: true,
      },
      {
        id: 'simOverPad',
        title: tr('停到坪的上空'),
        text: () => tr('悬停在坪的正上方：离坪中心 <b>8 米</b> 以内，地速 2 m/s 以下，坚持 <b>2 秒</b>。'),
        live: (s) => tr`离坪中心 <b>${padDist(s).toFixed(1)} m</b> · ${hoverNums(s)}`,
        check: (s, st, dt) => hold(st, dt, padDist(s) < 8 && s.groundSpeed < 2.2, 2),
      },
      {
        id: 'simTouch',
        title: tr('接地'),
        text: (k) => tr`点 <kbd>${k('down')}</kbd> 慢慢放总距，下降不要超过 <b>2 m/s</b>。接地后继续放总距，直到飞机完全坐稳。`,
        why: () => tr('离地 1 米左右地面效应会把飞机托一下，这时不要慌，再放一点。'),
        keys: ['down'],
        live: hoverNums,
        check: (s) => (s.settledPad === 'T-final' ? 1 : 0.9 * clamp01(1 - s.agl / 20)),
        stuck: (k, s) => (s.gear.contactCount > 0 && padDist(s) > 10 ? tr`落在坪外了。按 <kbd>${k('up')}</kbd> 离地，飞回坪的上空再落一次。` : tr`继续点 <kbd>${k('down')}</kbd>，接地后把总距放到底。`),
      },
    ],
  },
  {
    title: tr('关车'),
    sub: tr('让发动机凉下来，把飞机交回去'),
    parts: [],
    allow: 'lift',
    park: 'T-final',
    steps: [
      {
        id: 'simColDown',
        title: tr('总距放到底'),
        text: (k) => tr`按住 <kbd>${k('down')}</kbd>，把总距放到 0。`,
        keys: ['down'],
        anchor: true,
        live: (s) => tr`总距 <b>${pct(s.flight.collective)}</b>`,
        check: (s) => clamp01(1.05 - s.flight.collective * 2),
      },
      {
        id: 'simBackIdle',
        title: tr('回到慢车'),
        text: () => tr('<b>右键</b>点 ENG MAIN，转回 <b>IDLE</b>。'),
        why: () => tr('左键往前拧，右键往回拧。'),
        control: 'eng_main',
        live: engine,
        check: (s) => (sys(s).c.engMain === 1 ? 1 : 0),
      },
      {
        id: 'simCool',
        title: tr('冷却'),
        text: () => tr('等 <b>15 秒</b>，让发动机的温度降下来。'),
        why: () => tr('刚飞完涡轮非常烫，直接关车会伤轴承。真机要等 30 秒以上。'),
        live: engine,
        check: (s, st, dt) => {
          st.t += dt;
          return clamp01(st.t / 15);
        },
      },
      {
        id: 'simEngOff',
        title: tr('关车'),
        text: () => tr('<b>右键</b>点 ENG MAIN，转到 <b>OFF</b>。'),
        control: 'eng_main',
        live: engine,
        check: (s) => (sys(s).c.engMain === 0 ? 1 : 0),
      },
      {
        id: 'simBrake',
        title: tr('刹住旋翼'),
        text: () => tr('等旋翼转速掉到 <b>40%</b> 以下，点黄色的 <b>旋翼刹车</b> 手柄。'),
        why: () => tr('转速太高时刹车会把刹车片烧掉。'),
        control: 'rotor_brake',
        live: engine,
        check: (s) => (s.flight.nr < 0.41 && !on(s, 'rotorBrake') ? 1 : 0.9 * clamp01((1 - s.flight.nr) / 0.6)),
      },
      {
        id: 'simPowerOff',
        title: tr('断电'),
        text: () => tr('依次关掉 <b>GEN</b>、<b>FUEL P</b>、<b>A-COL</b>，最后关 <b>BATT</b>。'),
        control: (s) => (on(s, 'gen') ? 'rk_gen' : on(s, 'fuelP') ? 'rk_fuelP' : on(s, 'acol') ? 'rk_acol' : on(s, 'batt') ? 'rk_batt' : null),
        check: (s) => ['gen', 'fuelP', 'acol', 'batt'].filter((k) => !on(s, k)).length / 4,
      },
    ],
  },
  {
    title: tr('空中停车'),
    sub: tr('进阶：发动机没了，靠自转安全落地'),
    parts: [],
    allow: 'all',
    jump: true,
    place: { x: -72, z: 900, agl: 320, heading: 0, speed: 34 },
    steps: [
      {
        id: 'simAutoWhy',
        title: tr('发动机停了怎么办'),
        text: () => tr('直升机没有发动机也能落地：放下总距往下滑，风从下往上吹过桨盘，把旋翼吹着转，这叫<b>自转</b>。'),
        why: () => tr('这时候旋翼转速就是你的全部本钱：下滑时攒着，最后那几秒花掉，把飞机托住。'),
        manual: true,
        anchor: true,
      },
      {
        id: 'simCut',
        title: tr('关掉发动机'),
        text: () => tr('<b>右键</b>点 ENG MAIN 两下，转到 <b>OFF</b>。这是练习，下一步要马上放总距。'),
        control: 'eng_main',
        live: flightNums,
        check: (s) => (sys(s).c.engMain === 0 ? 1 : 0),
      },
      {
        id: 'simDump',
        quick: true,
        title: tr('马上放总距！'),
        text: (k) => tr`按住 <kbd>${k('down')}</kbd> 把总距放到底。两秒之内不放，旋翼转速就回不来了。`,
        why: () => tr('真飞行员的反应时间只有一两秒，所以起飞后左手一直放在总距上。'),
        keys: ['down'],
        live: flightNums,
        check: (s) => clamp01(1.1 - s.flight.collective * 5),
      },
      {
        id: 'simGlide',
        quick: true,
        title: tr('保持下滑'),
        text: (k) => tr`保持空速 <b>30 m/s</b> 左右，旋翼 <b>90~105%</b>。转速太高提一点总距，太低放一点。对准前方的跑道，用 <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd> 守住空速，一直到离地 <b>35 米</b>。`,
        live: flightNums,
        check: (s) => clamp01(1 - (s.agl - 34) / 266),
      },
      {
        id: 'simFlareAuto',
        quick: true,
        title: tr('拉平'),
        text: (k) => tr`按住 <kbd>${k('back')}</kbd> 抬头 <b>15° 左右</b>，把速度和下沉一起减下来，一直到离地 <b>5 米</b>。别抬太多，尾桨会打到地面。`,
        why: () => tr('抬头让风把旋翼吹得更快，转速又攒回来一点，最后一下就靠它。'),
        keys: ['back'],
        live: flightNums,
        check: (s) => clamp01((34 - s.agl) / 29.5),
      },
      {
        id: 'simCushion',
        title: tr('缓冲'),
        text: (k) => tr`<b>现在！</b>按住 <kbd>${k('up')}</kbd> 提总距，用转速把飞机托住，同时点 <kbd>${k('forward')}</kbd> 放平机头。`,
        why: () => tr('只有一次机会：提早了转速掉光，提晚了来不及。顺着滑橇方向滑着落地是可以的，别横着。'),
        keys: ['up'],
        live: flightNums,
        check: (s) => (s.gear.contactCount >= 2 && s.groundSpeed < 8 ? 1 : 0.9 * clamp01(1 - s.agl / 5)),
      },
    ],
  },
];
