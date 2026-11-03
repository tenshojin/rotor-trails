// 打印每张地图的任务/路线/天气摘要（用于编写文档）：npx vitest run --config vitest.tools.config.ts tools/mapinfo.tool.ts --silent=false
import { it } from 'vitest';
import { MAPS } from '../src/maps/index';
import '../src/maps/all';

it('mapinfo', () => {
  for (const m of MAPS) {
    const lines: string[] = [];
    lines.push(`## ${m.id} ${m.name}（${m.subtitle}）难度 ${m.difficulty} 预计 ${m.estMinutes.join('–')} 分钟 尺寸 ${m.size} m 海拔偏移 ${m.altitudeOffset}`);
    lines.push('主线: ' + m.mission.main.map((o, i) => `${i + 1}.${o.title}[${o.kind}]`).join(' / '));
    lines.push('可选: ' + m.mission.optional.map((o) => `${o.title}[${o.kind}]`).join(' / '));
    m.legs.forEach((l, i) => {
      if (l.paths.length > 1) lines.push(`路线选择 航段${i + 1}→${l.to}: ` + l.paths.map((p) => `${p.label}（${p.tag}）`).join(' vs '));
    });
    lines.push('天气: ' + m.weathers.map((w) => `${w.label}(${w.id})`).join('、'));
    lines.push('停机坪: ' + m.pads.map((p) => `${p.name}[${p.kind}]`).join('、'));
    lines.push('补给: ' + m.pickups.map((p) => `${p.kind}@${p.note ?? ''}`).join('、'));
    lines.push('风区: ' + m.windZones.map((z) => `${z.name}(${z.kind})`).join('、'));
    lines.push('地标: ' + m.landmarks.map((l) => l.name).join('、') + ` · 检查点 ${m.nodes.filter((n) => n.checkpoint).length} 个 · 航点 ${m.nodes.length} 个`);
    console.log(lines.join('\n'));
  }
});
