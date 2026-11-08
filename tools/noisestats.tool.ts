// 噪声贴图各通道的坡度统计（水面细波纹按这个把淡掉的起伏折算进粗糙度）：
// npx vitest run --config vitest.tools.config.ts tools/noisestats.tool.ts --silent=false
import { it } from 'vitest';
import { getNoiseTexture } from '../src/render/textures';

it('noise slope stats', () => {
  const tex = getNoiseTexture();
  const N = 256;
  const data = tex.image.data as Uint8Array;
  const at = (x: number, y: number, c: number): number => data[((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4 + c] / 255;
  for (const [c, name] of [[1, 'g'], [3, 'a']] as Array<[number, string]>) {
    // 和水面着色器一样：uv 步长 e = 0.004（约 1 个纹素），中心差分 / (2e)
    let s = 0;
    let m = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const gx = (at(x + 1, y, c) - at(x - 1, y, c)) / (2 * 0.004 * 1.024);
        s += gx * gx;
        m += at(x, y, c);
      }
    m /= N * N;
    let v = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) v += (at(x, y, c) - m) ** 2;
    v /= N * N;
    console.log(`${name}: 每个方向的 uv 坡度 RMS ${Math.sqrt(s / (N * N)).toFixed(2)}，数值标准差 ${Math.sqrt(v).toFixed(3)}，均值 ${m.toFixed(3)}`);
  }
});
