// 反馈小窗：源码在作者电脑的 E:\tool\feedback-worker\widget\feedback-widget.js（多个作品共用），改那边再拷过来。
// 里面的中日英文字是小窗自带的（tools/i18n-allow.json 里放行了这个文件）。
/*
 * 作品反馈小窗（不依赖任何库）：冠军伤害计算器、Rotor Trails、亨利酒馆共用。
 * 用法：JimiFeedback.open({ app: 'champions-calc', version: '1.2', page: '速度线', lang: 'zh' })
 *   app：gacha-calc | champions-calc | rotor-trails | henry-tavern
 *   lang：zh | ja | en（不写就看 <html lang>）
 *   onOpen / onClose：游戏可以在这里暂停 / 继续
 *   页面自己也监听 popstate（返回键）的，处理前先看 JimiFeedback.ownsBack()：true 表示这次返回是小窗的，页面别动
 * 写的内容发到 https://feedback.tianchengjin.com/v1/feedback（作者自己的 Cloudflare Worker，转成邮件发给作者）。
 * 打开期间键盘事件不会传给游戏（不会边打字边开飞机）；按返回键 / Esc 关闭。
 * 源码在 E:\tool\feedback-worker\widget\，改这里再拷到各项目。
 */
(function () {
  'use strict';
  // 测试环境（Node）里被引入时什么都不做
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var ENDPOINT = 'https://feedback.tianchengjin.com/v1/feedback';
  var S = {
    zh: { title: '意见反馈', intro: '发现问题、哪里不好用，或者想要什么功能，直接写在这里发给作者。', kinds: { bug: '问题', idea: '建议', other: '其他' }, ph: '想说什么都可以。说清楚在哪个画面、做了什么，作者更好查。', contact: '联系方式（选填：邮箱、QQ、B 站 ID…想收到回复就留一个）', attach: '附一张截图（选填）', noAttach: '不带截图', privacy: '只发给作者的邮箱，不会公开。会自动附上版本号、界面语言、设备类型。', send: '发送给作者', sending: '发送中…', sent: '已发送，谢谢！作者会看每一条反馈。', again: '再写一条', close: '关闭', cool: '刚发过一条，过半分钟再发吧。', offline: '现在没联网。内容已经存在本机，联网后再点发送。', rate: '发得太频繁了，过一会儿再发。', invalid: '内容太长或图片太大，删短一点再试。', fail: '没发出去（网络或服务器的问题）。内容已经存在本机，可以稍后再发，或者点「复制内容」换别的方式告诉作者。', copy: '复制内容', badImg: '这张图片读不出来，换一张试试。' },
    ja: { title: 'ご意見・ご報告', intro: '不具合や使いにくいところ、欲しい機能など、ここに書いて作者に送れます。', kinds: { bug: '不具合', idea: '提案', other: 'その他' }, ph: '何でもどうぞ。どの画面で何をしたか書いてもらえると助かります。', contact: '連絡先（任意：メール・X など。返信が欲しい場合に）', attach: 'スクショを添付（任意）', noAttach: 'スクショを外す', privacy: '作者のメールにだけ届き、公開されません。バージョン・表示言語・端末の種類は自動で添付します。', send: '作者に送る', sending: '送信中…', sent: '送信しました。ありがとうございます！作者がすべて目を通します。', again: 'もう一件書く', close: '閉じる', cool: '送ったばかりです。30 秒ほどしてから送ってください。', offline: 'オフラインです。内容は端末に保存したので、つながってから送信してください。', rate: '送信が多すぎます。少し時間をおいてください。', invalid: '内容が長すぎるか画像が大きすぎます。短くしてもう一度お試しください。', fail: '送信できませんでした（通信またはサーバーの問題）。内容は端末に保存したので、あとで送るか「内容をコピー」して別の方法で作者に伝えてください。', copy: '内容をコピー', badImg: 'この画像は読み込めません。別の画像でお試しください。' },
    en: { title: 'Feedback', intro: 'Found a problem, something awkward, or want a feature? Write it here and it goes straight to the author.', kinds: { bug: 'Problem', idea: 'Idea', other: 'Other' }, ph: 'Anything goes. Saying which screen and what you did helps a lot.', contact: 'Contact (optional: email, X, Discord… if you would like a reply)', attach: 'Attach a screenshot (optional)', noAttach: 'Remove screenshot', privacy: "Goes only to the author's inbox, never public. The version, language and device type are added automatically.", send: 'Send to the author', sending: 'Sending…', sent: 'Sent. Thank you! The author reads every message.', again: 'Write another', close: 'Close', cool: 'You just sent one. Please wait half a minute.', offline: "You're offline. Your text is saved on this device; send it once you're back online.", rate: 'Too many messages. Please try again later.', invalid: 'The text is too long or the image too large. Shorten it and try again.', fail: 'Could not send (network or server problem). Your text is saved here; try again later, or tap "Copy text" and reach the author another way.', copy: 'Copy text', badImg: "Couldn't read that image. Try another one." },
  };
  var CSS =
    '.jmfb{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(5,8,18,.62);font:15px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans","Microsoft YaHei",sans-serif;color:#eef1f8}' +
    '@media(min-width:600px){.jmfb{align-items:center}}' +
    '.jmfb *{box-sizing:border-box}' +
    '.jmfb-p{position:relative;width:100%;max-width:520px;max-height:92vh;overflow:auto;background:#141b2e;border:1px solid rgba(255,255,255,.12);border-radius:22px 22px 0 0;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.5)}' +
    '@media(min-width:600px){.jmfb-p{border-radius:22px}}' +
    '.jmfb h2{margin:0 0 4px;font-size:19px}.jmfb p{margin:0 0 12px}.jmfb .m{color:rgba(238,241,248,.66);font-size:13px}' +
    '.jmfb-x{position:absolute;top:10px;right:10px;background:none;border:0;color:inherit;font-size:20px;padding:6px 10px;cursor:pointer;opacity:.7}' +
    '.jmfb-k{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.jmfb-k button{border:0;border-radius:999px;padding:5px 13px;background:rgba(255,255,255,.08);color:inherit;cursor:pointer;font:inherit;font-size:13px}.jmfb-k button[aria-checked=true]{background:var(--jmfb-a,#e5c07a);color:#1b1404;font-weight:700}' +
    '.jmfb textarea,.jmfb input[type=text]{width:100%;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);color:inherit;border-radius:12px;padding:10px 12px;font:inherit;margin:0 0 4px}.jmfb textarea{min-height:120px;resize:vertical}' +
    '.jmfb label{display:block;margin:6px 0 10px}.jmfb .c{text-align:right;font-size:12px}' +
    '.jmfb-b{border:0;border-radius:12px;padding:9px 18px;font:inherit;font-weight:700;cursor:pointer;background:var(--jmfb-a,#e5c07a);color:#1b1404}.jmfb-b[disabled]{opacity:.5;cursor:default}' +
    '.jmfb-g{border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:6px 12px;background:none;color:inherit;font:inherit;font-size:13px;cursor:pointer}' +
    '.jmfb-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px}.jmfb-r img{width:56px;height:56px;object-fit:cover;border-radius:10px}' +
    '.jmfb-e{color:#ff9b87;font-size:13px;margin:0 0 10px}.jmfb-e button{background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}' +
    '.jmfb .h{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}' +
    // 上面 .jmfb 写了 display:flex，会盖掉 hidden 属性（浏览器自带的 [hidden]{display:none} 优先级更低）：
    // 不写这一条，关掉以后半透明遮罩还盖在页面上、点哪儿都没反应（2026-11-24 亨利酒馆、Rotor Trails 出过）
    '.jmfb[hidden],.jmfb [hidden]{display:none!important}';

  var root, opts, L, image, sending = false, pushed = false, backPending = false;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) {
      if (c) e.appendChild(c);
    });
    return e;
  }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function langOf(o) {
    var l = (o.lang || document.documentElement.lang || 'zh').toLowerCase();
    return l.indexOf('ja') === 0 ? 'ja' : l.indexOf('en') === 0 ? 'en' : 'zh';
  }
  function platform() {
    var ua = navigator.userAgent;
    var os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'other';
    var br = /; wv\)/.test(ua) ? 'App' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'other';
    return os + ' · ' + br + ' · ' + innerWidth + '×' + innerHeight;
  }
  function compress(file, cb) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var s = Math.min(1, 1600 / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      cb(null);
    };
    img.src = url;
  }
  function stop(e) {
    // 打字时不让游戏收到按键（Esc 关窗口除外）
    // 输入法正在选字时按 Esc 是取消选字，不是关窗口（中文 / 日文输入时常用）
    if (e.type === 'keydown' && e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) {
      close();
      e.preventDefault();
    }
    e.stopPropagation();
  }

  function render() {
    var draftKey = 'jmfb:draft:' + opts.app;
    var draft = {};
    try {
      draft = JSON.parse(store(draftKey) || '{}');
    } catch (e) {}
    var kind = 'bug';
    var ta = el('textarea', { placeholder: L.ph, maxlength: '4000', 'aria-label': L.title });
    ta.value = draft.message || opts.message || '';
    var count = el('div', { class: 'm c', text: ta.value.length + ' / 4000' });
    var contact = el('input', { type: 'text', maxlength: '200', autocomplete: 'email' });
    contact.value = draft.contact || '';
    var trap = el('input', { type: 'text', class: 'h', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    var err = el('div', { class: 'jmfb-e', role: 'alert' });
    err.hidden = true;
    var save = function () {
      store(draftKey, JSON.stringify({ message: ta.value, contact: contact.value }));
      count.textContent = ta.value.length + ' / 4000';
      btn.disabled = !ta.value.trim() || sending;
    };
    ta.addEventListener('input', save);
    contact.addEventListener('input', save);
    var kinds = el('div', { class: 'jmfb-k', role: 'radiogroup', 'aria-label': L.title });
    Object.keys(L.kinds).forEach(function (k) {
      var b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(k === kind), text: L.kinds[k] });
      b.addEventListener('click', function () {
        kind = k;
        [].forEach.call(kinds.children, function (x) {
          x.setAttribute('aria-checked', String(x === b));
        });
      });
      kinds.appendChild(b);
    });
    var file = el('input', { type: 'file', accept: 'image/*', hidden: 'hidden' });
    var attachRow = el('div', { class: 'jmfb-r' });
    var drawAttach = function () {
      attachRow.textContent = '';
      if (image) {
        attachRow.appendChild(el('img', { src: image, alt: '' }));
        attachRow.appendChild(el('button', { type: 'button', class: 'jmfb-g', text: L.noAttach, onclick: function () { image = null; drawAttach(); } }));
      } else attachRow.appendChild(el('button', { type: 'button', class: 'jmfb-g', text: L.attach, onclick: function () { file.click(); } }));
      attachRow.appendChild(file);
    };
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      compress(f, function (d) {
        if (!d) return showErr(L.badImg);
        image = d;
        drawAttach();
      });
    });
    drawAttach();
    var btn = el('button', { type: 'submit', class: 'jmfb-b', text: L.send });
    var showErr = function (msg, withCopy) {
      err.textContent = msg + ' ';
      if (withCopy)
        err.appendChild(el('button', { type: 'button', text: L.copy, onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(function () {}); } }));
      err.hidden = false;
    };
    var form = el('form', {}, [kinds, ta, count, el('label', {}, [el('span', { class: 'm', text: L.contact }), contact]), trap, attachRow, el('p', { class: 'm', text: L.privacy }), err, btn]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending || !ta.value.trim()) return;
      var coolKey = 'jmfb:sent:' + opts.app;
      if (Date.now() - Number(store(coolKey) || 0) < 30000) return showErr(L.cool);
      if (!navigator.onLine) return showErr(L.offline);
      sending = true;
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = L.sending;
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: opts.app, kind: kind, message: ta.value.trim(), contact: contact.value.trim(), version: opts.version || '', lang: langOf(opts), page: opts.page || '', platform: platform(), image: image || undefined, website: trap.value, meta: Object.assign({ ua: navigator.userAgent, url: location.href.split('#')[0] }, opts.meta || {}) }),
      })
        .then(function (r) {
          sending = false;
          btn.textContent = L.send;
          if (r.ok) {
            store(coolKey, String(Date.now()));
            store(draftKey, null);
            image = null;
            panel.textContent = '';
            panel.appendChild(el('button', { type: 'button', class: 'jmfb-x', 'aria-label': L.close, text: '✕', onclick: close }));
            panel.appendChild(el('h2', { text: L.title }));
            panel.appendChild(el('p', { text: L.sent }));
            panel.appendChild(el('button', { type: 'button', class: 'jmfb-g', text: L.again, onclick: render }));
            return;
          }
          btn.disabled = false;
          showErr(r.status === 429 ? L.rate : r.status === 400 || r.status === 413 ? L.invalid : L.fail, r.status >= 500);
        })
        .catch(function () {
          sending = false;
          btn.textContent = L.send;
          btn.disabled = false;
          showErr(L.fail, true);
        });
    });
    var panel = root.firstChild;
    panel.textContent = '';
    panel.appendChild(el('button', { type: 'button', class: 'jmfb-x', 'aria-label': L.close, text: '✕', onclick: close }));
    panel.appendChild(el('h2', { text: L.title }));
    panel.appendChild(el('p', { class: 'm', text: L.intro }));
    panel.appendChild(form);
    save();
    setTimeout(function () {
      ta.focus();
    }, 50);
  }

  function onPop() {
    pushed = false;
    close(true);
  }
  function close(fromBack) {
    if (!root || root.hidden) return;
    root.hidden = true;
    window.removeEventListener('popstate', onPop);
    if (pushed && fromBack !== true) {
      pushed = false;
      // 自己退掉打开时垫的那一格。这次 popstate 是小窗的：页面自己的返回处理（例如 Rotor Trails）用 ownsBack() 认出来跳过。
      // 页面的监听比这个先注册、先执行，所以它看到的 backPending 还是 true
      backPending = true;
      var done = function () {
        backPending = false;
        window.removeEventListener('popstate', done);
      };
      window.addEventListener('popstate', done);
      setTimeout(done, 1500);
      history.back();
    }
    if (opts && opts.onClose) opts.onClose();
  }

  /** 页面自己也处理 popstate（返回键）时调用：小窗开着、或小窗刚退掉自己垫的那一格，这次「返回」归小窗，页面别再处理 */
  function ownsBack() {
    return backPending || !!(root && !root.hidden && pushed);
  }

  function open(o) {
    opts = o || {};
    if (!opts.app) opts.app = 'other';
    L = S[langOf(opts)];
    if (!root) {
      document.head.appendChild(el('style', { text: CSS }));
      root = el('div', { class: 'jmfb', role: 'dialog', 'aria-modal': 'true' }, [el('div', { class: 'jmfb-p' })]);
      root.addEventListener('click', function (e) {
        if (e.target === root) close();
      });
      ['keydown', 'keyup', 'keypress', 'wheel'].forEach(function (t) {
        root.addEventListener(t, stop);
      });
      document.body.appendChild(root);
    }
    if (opts.accent) root.style.setProperty('--jmfb-a', opts.accent);
    root.setAttribute('aria-label', L.title);
    root.hidden = false;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    // 手机返回键：先关窗口
    if (opts.history !== false) {
      history.pushState(Object.assign({}, history.state, { jmfb: 1 }), '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    }
    render();
    if (opts.onOpen) opts.onOpen();
  }

  window.JimiFeedback = { open: open, close: close, ownsBack: ownsBack };
})();
