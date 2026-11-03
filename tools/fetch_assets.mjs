// 下载美术原始素材（Poly Haven CC0 材质 + 维基共享资源参照照片）到 art/src/。
// 用法：node tools/fetch_assets.mjs        已存在的文件会跳过。
import fs from 'node:fs';
import path from 'node:path';

const SRC = JSON.parse(fs.readFileSync('tools/assets/sources.json', 'utf8'));
const OUT = 'art/src';
const UA = 'RotorTrails-asset-fetch/1.0 (personal game project)';

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return 'skip';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(file + '.part', buf);
      fs.renameSync(file + '.part', file);
      return buf.length;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 2000 * attempt));
    }
  }
}

const jobs = [];
const ph = SRC.polyhaven;
for (const id of Object.keys(ph.textures)) {
  jobs.push(async () => {
    const r = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`${id}: files API HTTP ${r.status}`);
    const files = await r.json();
    let bytes = 0;
    for (const m of ph.maps) {
      const f = files[m]?.[ph.resolution]?.jpg;
      if (!f) throw new Error(`${id}: 没有 ${m} ${ph.resolution} jpg`);
      const n = await download(f.url, path.join(OUT, 'polyhaven', id, `${id}_${m.toLowerCase()}_${ph.resolution}.jpg`));
      if (typeof n === 'number') bytes += n;
    }
    return `${id} ${(bytes / 1e6).toFixed(1)} MB`;
  });
}
for (const [name, p] of Object.entries(SRC.reference.photos)) {
  jobs.push(async () => {
    const url = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(p.commons);
    const n = await download(url, path.join(OUT, 'reference', name));
    return `${name} ${typeof n === 'number' ? (n / 1e6).toFixed(1) + ' MB' : n}`;
  });
}

let i = 0;
let failed = 0;
async function worker() {
  while (i < jobs.length) {
    const job = jobs[i++];
    try {
      console.log(await job());
    } catch (e) {
      failed++;
      console.error('失败：' + e.message);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(failed ? `完成，但有 ${failed} 项失败` : '全部完成');
process.exit(failed ? 1 : 0);
