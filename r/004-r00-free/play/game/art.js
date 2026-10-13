/* 美术运行时：按 hi-bit 路线「零件分层做动画」。所有像素画都来自 assets/sprites.js（构建页从 美术/零件 处理出来）。
   画法照 pixel-character-design 技能 hi-bit 路线的运行页（美术/零件/runtime.html）改：
   气囊 → 绳子 → 引擎 → 螺旋桨 → 货堆 → 甲板货 → 炮 → 船身 → 船首像；螺旋桨 4 帧压扁，气囊比船身慢半拍，12 fps。 */
(function (G) {
  'use strict';
  const A = G.Art = {};
  const U = G.U;
  A.STEAM = ['#f3f6f9', '#dce2ea', '#b8c0cc', '#8f97a8'];
  A.FIRE = ['#fff4b8', '#ffd24c', '#ff9a2e', '#d4571e'];
  A.RED = ['#ffb0a0', '#e0574a', '#a8302e', '#6e1d1c'];
  A.ROPE = ['#a68a5c', '#7d6440', '#5a4630', '#3a2c1c'];

  /* ---------- 载入：把 SPRITES 里的 dataURL 变成 Image，保持同样的结构 ---------- */
  A.load = async function (S) {
    const jobs = [];
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === 'string' && v.startsWith('data:image')) {
          const img = new Image(); jobs.push(new Promise(ok => { img.onload = ok; img.onerror = ok; }));
          img.src = v; o[k + 'Img'] = img; if (k === 'src') o.img = img;
        } else if (typeof v === 'object') walk(v);
      }
    };
    walk(S); await Promise.all(jobs); return S;
  };

  const R = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  A.R = R;
  A.rope = function (g, x0, y0, x1, y1, sag, cols = A.ROPE) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) { const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sag); R(g, cols[(i >> 1) % 3], x, y); R(g, cols[3], x + 1, y + 1); }
  };
  A.blob = function (g, x, y, r, cols) {
    r = Math.max(0.5, r); const rr = Math.ceil(r);
    for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) { const d = i * i + j * j; if (d > r * r) continue; const c = cols[Math.min(cols.length - 1, Math.floor((j + r) / (2 * r + 0.01) * cols.length * 0.9))]; R(g, c, x + i, y + j); }
  };
  A.Pool = function () {
    const a = [];
    return { list: a, add(p) { a.push(p); return p; }, step(dt = 1) { for (const p of a) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.age += dt; } for (let i = a.length - 1; i >= 0; i--) if (a[i].age >= a[i].life) a.splice(i, 1); }, each(f) { a.forEach(f); }, clear() { a.length = 0; } };
  };

  /* ---------- 甲板货：舱满以后一层层堆在货堆上，金字塔形；绳网捆住，冒尖时最上面一层露在网外 ---------- */
  A.deckLayout = function (S, n, cw, ch) {
    const P = S.parts.cargo, W = P.w, out = [];
    if (!n) return out;
    const Rmax = U.clamp(Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2), 1, Math.max(1, Math.min(4, Math.floor(1.1 * W / (cw - 1)))));
    const prof = S.pileTop, c0 = Math.floor(W * 0.2), c1 = Math.ceil(W * 0.8);
    let top = 1e9; for (let x = c0; x < c1; x++) top = Math.min(top, prof[x]);
    const base = P.y + top + 2 - ch; // 第一层压在货堆最高处，往下藏 2 像素
    let left = n, row = 0;
    while (left > 0 && row < 8) {
      const cap = Math.max(1, Rmax - row), m = Math.min(left, cap), rw = m * (cw - 1) + 1, x0 = Math.round(P.x + W / 2 - rw / 2);
      for (let i = 0; i < m; i++) out.push({ x: x0 + i * (cw - 1), y: base - row * (ch - 1), row });
      left -= m; row++;
    }
    return out;
  };

  /* 画一艘拼好的侧面船。o: n 顶上气囊节数, gun, engine, eagle, hold(0–1), deck:[货种], crates:{货种:图}, bob, f(12fps 帧), flip, flash, dy,
     ph 浮动的相位（几艘船别一起浮）, gunDx 炮往后坐几像素（开火的后坐力） */
  A.drawShip = function (g, S, ox, oy, f, o = {}) {
    const ph = o.ph || 0, bob = o.bob ?? 1, by = Math.round(Math.sin(f / 12 * 2.2 + ph) * bob) + (o.dy || 0), bb = Math.round(Math.sin(f / 12 * 2.2 - 0.7 + ph) * bob) + (o.dy || 0), P = S.parts;
    let tg = g, tmp = null;
    if (o.flash || o.flip || o.alpha != null) { tmp = A._tmp(S.w + 40, S.h + 40); tg = tmp.getContext('2d'); tg.clearRect(0, 0, tmp.width, tmp.height); }
    const X = tmp ? 20 : Math.round(ox), Y = tmp ? 20 : Math.round(oy);
    const put = (p, dy = by) => { if (p) tg.drawImage(p.img, X + p.x, Y + p.y + dy); };
    const n = o.n ?? (S.balloons.length - 1), B = n > 0 ? S.balloons[Math.min(n, S.balloons.length - 1)] : null;
    if (B) {
      put(B, bb);
      for (const h of B.hang) for (const dx of S.ropeSpread) { let tx = h.x + dx; if (tx < S.ropeX[0] || tx > S.ropeX[1]) continue; A.rope(tg, X + h.x, Y + h.y + bb, X + tx, Y + S.deckY + by, Math.max(1, 2 * S.scale)); }
    }
    if (o.engine !== false) {
      put(P.engine);
      const p = P.prop, s = [1, 0.62, 0.16, 0.62][(f >> 0) % 4], hh = Math.max(1, Math.round(p.h * s));
      tg.drawImage(p.img, 0, 0, p.w, p.h, X + p.x, Y + p.y + by + Math.round((p.h - hh) / 2), p.w, hh);
    }
    const hold = o.hold ?? 0;
    let pileDy = 0;
    if (hold > 0 || (o.deck && o.deck.length)) {
      const c = P.cargo, vis = hold > 0 ? 0.25 + 0.75 * U.clamp(hold, 0, 1) : 0.1; pileDy = Math.round(c.h * (0.13 + 0.42 * (1 - vis)));
      const visH = Math.min(c.h, Math.round(c.h * 0.95) - pileDy);
      if (visH > 0) tg.drawImage(c.img, 0, 0, c.w, visH, X + c.x, Y + c.y + by + pileDy, c.w, visH);
    }
    if (o.deck && o.deck.length && o.crates) {
      const any = o.crates[o.deck[0]] || Object.values(o.crates)[0], cw = any.w, ch = any.h;
      const L = A.deckLayout(S, o.deck.length, cw, ch);
      const rows = L.length ? L[L.length - 1].row + 1 : 0;
      L.forEach((s, i) => { const k = o.deck[i], im = o.crates[k] || any, x = X + s.x, y = Y + s.y + by + pileDy; tg.drawImage(im.img, x, y); });
      if (rows >= 2) { // 绳网：捆住除最上面一层以外的箱子（冒尖露在网外）
        const inNet = L.filter(s => s.row <= rows - 2);
        const x0 = Math.min(...inNet.map(s => s.x)), x1 = Math.max(...inNet.map(s => s.x)) + cw - 1, yt = Math.min(...inNet.map(s => s.y)) + by + pileDy + 1, yb = Math.max(...inNet.map(s => s.y)) + ch + by + pileDy - 1;
        const N = ['#c9ad7a', '#9a7d50', '#7a6040', '#3a2c1c'];
        A.rope(tg, X + x0, Y + yt, X + x1, Y + yt, 0, N);
        if (cw >= 12) { const mid = Math.round((yt + yb) / 2); A.rope(tg, X + x0, Y + mid, X + x1, Y + mid, 0, N); A.rope(tg, X + x0, Y + yt, X + x1, Y + yb, 0, N); A.rope(tg, X + x1, Y + yt, X + x0, Y + yb, 0, N); }
        A.rope(tg, X + x0, Y + yt, X + x0 - 1, Y + yb + 2, 0, N); A.rope(tg, X + x1, Y + yt, X + x1 + 1, Y + yb + 2, 0, N);
      }
    }
    if (o.gun !== false && P.cannon) { if (o.gunDx) tg.drawImage(P.cannon.img, X + P.cannon.x - Math.round(o.gunDx), Y + P.cannon.y + by); else put(P.cannon); }
    put(P.hull);
    if (P.eagle && o.eagle !== false) put(P.eagle);
    if (tmp) {
      if (o.flash) { tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = `rgba(255,255,255,${o.flash})`; tg.fillRect(0, 0, tmp.width, tmp.height); tg.globalCompositeOperation = 'source-over'; }
      g.save(); if (o.alpha != null) g.globalAlpha = o.alpha;
      if (o.flip) { g.translate(Math.round(ox) + S.w, 0); g.scale(-1, 1); g.drawImage(tmp, -20, Math.round(oy) - 20); }
      else g.drawImage(tmp, Math.round(ox) - 20, Math.round(oy) - 20);
      g.restore();
    }
    return { by, pileDy };
  };
  const tmps = new Map();
  A._tmp = (w, h) => { const key = w + 'x' + h; let c = tmps.get(key); if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; tmps.set(key, c); } return c; };

  /* 货种的印记：箱子中间一块货色（小图上原来的印记缩没了，代码补一块颜色） */
  A.MARK = { tea: ['#9ee07a', '#4d8a3a'], gear: ['#f2e2b8', '#9a8a6a'], wine: ['#c08ae8', '#6a3a90'], spice: ['#ff7a5a', '#a8302e'], mat: ['#8cc0ff', '#3a5a90'] };
  A.crateMark = function (g, k, x, y, w, h) { const m = A.MARK[k]; if (!m) return; const s = w >= 14 ? 3 : 2, cx = Math.round(x + w / 2 - s / 2), cy = Math.round(y + h / 2 - s / 2); g.fillStyle = m[1]; g.fillRect(cx, cy + 1, s, s); g.fillStyle = m[0]; g.fillRect(cx, cy, s, s); };
  /* 甲板货箱在船上的世界坐标（被打飞时从这里飞出去） */
  A.deckCratePos = function (S, ox, oy, deckN, i, crates) {
    const any = Object.values(crates)[0]; const L = A.deckLayout(S, deckN, any.w, any.h); const s = L[i] || L[L.length - 1];
    return s ? { x: ox + s.x + any.w / 2, y: oy + s.y + any.h / 2 } : { x: ox + S.parts.cargo.x + S.parts.cargo.w / 2, y: oy + S.parts.cargo.y };
  };

  /* 闪白一张图（被击中） */
  A.drawFlash = function (g, img, x, y, a, flip) {
    const t = A._tmp(img.width, img.height), c = t.getContext('2d'); c.clearRect(0, 0, t.width, t.height); c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-atop'; c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect(0, 0, t.width, t.height); c.globalCompositeOperation = 'source-over';
    g.save(); if (flip) { g.translate(Math.round(x) + img.width, 0); g.scale(-1, 1); g.drawImage(t, 0, 0, img.width, img.height, 0, Math.round(y), img.width, img.height); } else g.drawImage(t, 0, 0, img.width, img.height, Math.round(x), Math.round(y), img.width, img.height); g.restore();
  };
  A.drawImg = function (g, im, x, y, flip) { if (!im) return; const img = im.img || im; if (flip) { g.save(); g.translate(Math.round(x) + img.width, 0); g.scale(-1, 1); g.drawImage(img, 0, Math.round(y)); g.restore(); } else g.drawImage(img, Math.round(x), Math.round(y)); };
})(window.G);
