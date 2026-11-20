// 卡顿探针：截图工具（tools/shot.mjs）的 "preloadFile" 用它，在页面最先执行。
// 记下主线程的长任务（PerformanceObserver longtask）、两帧之间超过 50 ms 的间隔、加载界面上每一步的文字；
// window.__perf.summary() 按加载步骤汇总：长任务总长、最长一次、超过 200 ms 的各是哪一步。用法见 docs/development.md

(() => {
  const P = (window.__perf = { lt: [], gaps: [], marks: [] });
  const label = () => {
    const l = document.querySelector('.llabel');
    if (l) return l.textContent;
    const s = document.querySelector('.screen');
    return s ? 'screen:' + s.className : 'none';
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) P.lt.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  let last = performance.now();
  const raf = (t) => {
    const d = t - last;
    if (d > 50) P.gaps.push([Math.round(last), Math.round(d), label()]);
    last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  let prev = '';
  const mo = () => {
    const l = label();
    if (l !== prev) { P.marks.push([Math.round(performance.now()), l]); prev = l; }
  };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(mo).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  P.summary = () => {
    const phase = (t) => { let p = 'start'; for (const [mt, l] of P.marks) { if (mt <= t) p = l; else break; } return p; };
    const by = {};
    for (const [s, d] of P.lt) { const k = phase(s); (by[k] ??= { n: 0, total: 0, max: 0 }); by[k].n++; by[k].total += d; by[k].max = Math.max(by[k].max, d); }
    return { now: Math.round(performance.now()), state: window.__app?.state, backend: window.__app?.view?.gpuInfo?.().backend, longTotal: P.lt.reduce((a, b) => a + b[1], 0), longMax: Math.max(0, ...P.lt.map((x) => x[1])), byPhase: by, marks: P.marks.map(([t, l]) => `${t} ${l}`), big: P.lt.filter((x) => x[1] > 200).map(([s, d]) => `${s}+${d} @${phase(s)}`) };
  };
})();
