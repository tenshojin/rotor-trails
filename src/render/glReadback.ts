// WebGL2 的读回挪到一帧的开头取。
//
// WebGL 没有真正的异步读回：three.js 先把像素拷进缓冲区、插一个栅栏，等栅栏过了再 getBufferSubData。
// 最后这一步要让主线程等显卡进程把之前发出去的命令全部处理完。three.js 是在 requestAnimationFrame 里轮询栅栏的，
// 轮询排在游戏这一帧的回调后面——这一帧的绘制命令刚发出去，主线程就得等显卡把它们也画完（实测一次 30～50 ms）。
// 这里换成在游戏这一帧开始之前（另一个排在前面的 requestAnimationFrame 回调里）查栅栏、交出结果，
// 要等的只剩上一帧没处理完的尾巴。WebGPU 的读回本来就是异步的，不用这个。

import type * as THREE from 'three/webgpu';

interface WebGLBackendLike {
  isWebGLBackend?: boolean;
  gl?: WebGL2RenderingContext;
  utils?: { _clientWaitAsync?: () => Promise<void> };
}

/** WebGL2 后端：接管 three.js 等栅栏的那一步，返回“帧开头调用”的函数；WebGPU 返回 null */
export function earlyGlReadback(renderer: THREE.WebGPURenderer): (() => void) | null {
  const backend = renderer.backend as unknown as WebGLBackendLike;
  const gl = backend.gl;
  const utils = backend.utils;
  if (!backend.isWebGLBackend || !gl || !utils || typeof utils._clientWaitAsync !== 'function') return null;
  const waits: Array<{ sync: WebGLSync; resolve: () => void; reject: () => void; polls: number }> = [];
  utils._clientWaitAsync = () => {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (!sync) return Promise.reject(new Error('fenceSync failed'));
    return new Promise<void>((resolve, reject) => waits.push({ sync, resolve, reject, polls: 0 }));
  };
  return () => {
    if (!waits.length) return;
    if (gl.isContextLost()) {
      for (const w of waits.splice(0)) w.reject();
      return;
    }
    for (let i = 0; i < waits.length; i++) {
      const w = waits[i];
      w.polls++;
      // 只看状态，不等（WebGL 规定状态只在两个任务之间更新，查一下不会卡）。
      // 兜底：哪个浏览器的状态迟迟不更新，2 秒后改用 three.js 原来的查法，10 秒后直接取（取的时候顶多等一下，结果是对的）
      let done = gl.getSyncParameter(w.sync, gl.SYNC_STATUS) === gl.SIGNALED;
      if (!done && w.polls > 120) {
        const r = gl.clientWaitSync(w.sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
        done = r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED || r === gl.WAIT_FAILED || w.polls > 600;
      }
      if (!done) continue;
      gl.deleteSync(w.sync);
      waits.splice(i--, 1);
      // three.js 接下来的 getBufferSubData 在这个回调结束后马上跑（微任务），那时这一帧还没开始画
      w.resolve();
    }
  };
}
