window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errs.push('rej ' + String(e.reason && e.reason.message || e.reason)));
// 检查当前界面：超出窗口、互相压住的文字、被截断的文字
window.__uicheck = (rootSel) => {
  const root = document.querySelector(rootSel || 'body');
  if (!root) return 'no root ' + rootSel;
  const W = innerWidth, H = innerHeight;
  const vis = (e) => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false;
    for (let p = e.parentElement; p; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.display === 'none' || ps.visibility === 'hidden' || +ps.opacity < 0.05) return false; }
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const scroller = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if ((s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowX === 'auto' || s.overflowX === 'scroll') && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p; } return null; };
  const clipAncestor = (e, r) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible') { const q = p.getBoundingClientRect(); if (r.right <= q.left + 1 || r.left >= q.right - 1 || r.bottom <= q.top + 1 || r.top >= q.bottom - 1) return true; } } return false; };
  const leaves = [...root.querySelectorAll('*')].filter((e) => {
    if (e.closest('canvas,svg')) return false;
    const tag = e.tagName;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return (own || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'CANVAS' || tag === 'IMG') && vis(e);
  });
  const name = (e) => { const t = (e.textContent || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 18); return e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '') + (t ? '「' + t + '」' : ''); };
  const out = [];
  const R = new Map(leaves.map((e) => [e, e.getBoundingClientRect()]));
  // 查“互相压住”时，只有字的元素按字实际占的地方算：块级元素的方框占满一行，比字宽得多
  // （主菜单的标题和右上角的语言按钮同在一行，方框叠着，字并没有压住）。按钮、输入框、图还是按整个方框
  const BOXED = { BUTTON: 1, INPUT: 1, SELECT: 1, CANVAS: 1, IMG: 1 };
  // 返回一组方框：一段字折成两行就是两个框（合成一个大框的话，“40” 在上一行末尾、“km/h” 在下一行开头，大框会把中间的东西都算进去）
  const textBox = (e) => {
    if (BOXED[e.tagName]) return [R.get(e)];
    const range = document.createRange();
    range.selectNodeContents(e);
    const rs = [...range.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5);
    if (!rs.length) return [R.get(e)];
    // 自己会截字的元素（说明只留两行的那种）：截掉的几行还是量得到，但屏幕上看不见，按元素自己的方框截一下。
    // 不截字的元素不能这么做：字从方框里溢出去压住旁边的东西，正是要查的
    const cs = getComputedStyle(e);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') return rs;
    const box = R.get(e);
    return rs.map((t) => ({ left: Math.max(t.left, box.left), top: Math.max(t.top, box.top), right: Math.min(t.right, box.right), bottom: Math.min(t.bottom, box.bottom) })).filter((t) => t.right - t.left > 0.5 && t.bottom - t.top > 0.5);
  };
  const T = new Map(leaves.map((e) => [e, textBox(e)]));
  for (const e of leaves) {
    const r = R.get(e);
    if (clipAncestor(e, r)) continue;
    const sc = scroller(e);
    if (!sc && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1)) out.push('OUT ' + name(e) + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
    const s = getComputedStyle(e);
    if (e.tagName !== 'INPUT' && e.tagName !== 'SELECT' && (s.overflow === 'hidden' || s.textOverflow === 'ellipsis' || s.overflowX === 'hidden') && e.scrollWidth > e.clientWidth + 2 && s.whiteSpace === 'nowrap') out.push('CLIP ' + name(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  }
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j];
    if (a.contains(b) || b.contains(a)) continue;
    let ox = 0, oy = 0;
    for (const ra of T.get(a)) for (const rb of T.get(b)) {
      const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (x > 3 && y > 3 && x * y > ox * oy) { ox = x; oy = y; }
    }
    if (ox > 3 && oy > 3) {
      // 两个都在同一个滚动容器外面的才算
      if (clipAncestor(a, R.get(a)) || clipAncestor(b, R.get(b))) continue;
      out.push('OVER ' + name(a) + ' × ' + name(b) + ' ' + Math.round(ox) + 'x' + Math.round(oy));
    }
  }
  return out.length ? out.slice(0, 25).join(' | ') + (out.length > 25 ? ' …+' + (out.length - 25) : '') : 'ok';
};
