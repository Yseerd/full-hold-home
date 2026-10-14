/* 输入和界面层。像素画画在 640×360 的缓冲上整数放大；界面文字在放大后的画布上用高分辨率直接画（和 M0 运行页一样）。
   界面是即时模式：每帧调用 button() 就画按钮并返回这一帧有没有被点。坐标一律用 640×360 的基准坐标。 */
(function (G) {
  'use strict';
  const U = G.U;
  /* ---------------- 输入 ---------------- */
  const In = G.In = { down: {}, pressed: {}, released: {}, mouse: { x: -1, y: -1, down: false, pressed: false, released: false, right: false }, typed: [] };
  const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
  addEventListener('keydown', e => { G.Sfx && G.Sfx.unlock(); if (block.has(e.code)) e.preventDefault(); if (!e.repeat) { In.pressed[e.code] = true; } In.down[e.code] = true; });
  addEventListener('keyup', e => { In.down[e.code] = false; In.released[e.code] = true; });
  addEventListener('blur', () => { In.down = {}; });
  In.key = c => !!In.down[c];
  In.hit = (...cs) => cs.some(c => In.pressed[c]);
  In.consume = (...cs) => cs.forEach(c => { In.pressed[c] = false; }); // 这一帧已经用掉了，别让同一下按键再点到界面上的按钮
  In.axis = () => ({ x: (In.key('KeyD') || In.key('ArrowRight') ? 1 : 0) - (In.key('KeyA') || In.key('ArrowLeft') ? 1 : 0), y: (In.key('KeyS') || In.key('ArrowDown') ? 1 : 0) - (In.key('KeyW') || In.key('ArrowUp') ? 1 : 0) });
  In.endFrame = () => { In.pressed = {}; In.released = {}; In.mouse.pressed = false; In.mouse.released = false; In.mouse.rpressed = false; };
  In.bindCanvas = function (cv, view) {
    const pos = e => { const r = cv.getBoundingClientRect(), dpr = cv.width / r.width; In.mouse.x = ((e.clientX - r.left) * dpr - view.ox) / view.k; In.mouse.y = ((e.clientY - r.top) * dpr - view.oy) / view.k; };
    cv.addEventListener('mousemove', pos);
    cv.addEventListener('mousedown', e => { G.Sfx && G.Sfx.unlock(); pos(e); if (e.button === 2) { In.mouse.rpressed = true; return; } In.mouse.down = true; In.mouse.pressed = true; });
    addEventListener('mouseup', e => { if (e.button === 2) return; In.mouse.down = false; In.mouse.released = true; });
    cv.addEventListener('contextmenu', e => e.preventDefault());
  };

  /* ---------------- 界面 ---------------- */
  const UI = G.UI = { k: 2, ox: 0, oy: 0, g: null, hotId: null, toasts: [], floaters: [], banner: null };
  const SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Source Han Sans SC",sans-serif';
  const SERIF = '"Songti SC","STSong","Noto Serif SC","Source Han Serif SC",serif';
  UI.C = { panel: 'rgba(24,18,14,0.86)', panel2: 'rgba(40,30,22,0.92)', brass: '#c8963e', brassL: '#f0d38a', fg: '#ece6da', muted: '#a59d90', red: '#e0574a', redBg: 'rgba(120,20,16,0.88)', green: '#8fd06a', blue: '#7fb3e6', gold: '#f0c050', ink: '#1b1209' };
  const X = v => UI.ox + v * UI.k, Y = v => UI.oy + v * UI.k;
  /* 这一帧屏幕上画了哪些按钮、头顶的「E」提示、底下的提示条（自动演示照着屏幕上写的东西玩） */
  UI.seen = { buttons: [], prompts: [], hints: [] };
  UI.begin = function (g, view) { UI.g = g; UI.k = view.k; UI.ox = view.ox; UI.oy = view.oy; UI.cursor = 'default'; UI.seen = { buttons: [], prompts: [], hints: [] }; };
  UI.font = (size, { bold = false, serif = false } = {}) => `${bold ? '700 ' : '400 '}${Math.round(size * UI.k)}px ${serif ? SERIF : SANS}`;
  UI.text = function (s, x, y, o = {}) {
    const g = UI.g, size = o.size || 7; g.save(); g.font = UI.font(size, o); g.textAlign = o.align || 'left'; g.textBaseline = o.base || 'alphabetic';
    if (o.alpha != null) g.globalAlpha = o.alpha;
    const tx = X(x), ty = Y(y);
    if (o.shadow !== false) { g.fillStyle = o.shadowColor || 'rgba(10,6,4,0.85)'; g.fillText(s, tx + Math.max(1, UI.k * 0.5), ty + Math.max(1, UI.k * 0.5)); }
    g.fillStyle = o.color || UI.C.fg; g.fillText(s, tx, ty); g.restore();
  };
  UI.measure = (s, size = 7, o = {}) => { const g = UI.g; g.save(); g.font = UI.font(size, o); const w = g.measureText(s).width / UI.k; g.restore(); return w; };
  UI.rr = function (x, y, w, h, r) { const g = UI.g; x = X(x); y = Y(y); w *= UI.k; h *= UI.k; r *= UI.k; g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  UI.panel = function (x, y, w, h, o = {}) { const g = UI.g; g.save(); UI.rr(x, y, w, h, o.r ?? 4); g.fillStyle = o.fill || UI.C.panel; g.fill(); if (o.stroke !== false) { g.strokeStyle = o.stroke || UI.C.brass; g.lineWidth = Math.max(1, UI.k * (o.lw || 1)); g.stroke(); } g.restore(); };
  UI.rect = function (x, y, w, h, fill) { const g = UI.g; g.fillStyle = fill; g.fillRect(X(x), Y(y), w * UI.k, h * UI.k); };
  UI.line = function (x0, y0, x1, y1, col, lw = 1, dash) { const g = UI.g; g.save(); g.strokeStyle = col; g.lineWidth = lw * UI.k; if (dash) g.setLineDash(dash.map(d => d * UI.k)); g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); g.restore(); };
  UI.strokeRect = function (x, y, w, h, col, lw = 1, dash) { const g = UI.g; g.save(); g.strokeStyle = col; g.lineWidth = lw * UI.k; if (dash) g.setLineDash(dash.map(d => d * UI.k)); g.strokeRect(X(x), Y(y), w * UI.k, h * UI.k); g.restore(); };
  UI.circle = function (x, y, r, fill, stroke, lw = 1) { const g = UI.g; g.beginPath(); g.arc(X(x), Y(y), r * UI.k, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw * UI.k; g.stroke(); } };
  UI.img = function (im, x, y, s = 1, o = {}) { if (!im) return; const img = im.img || im, g = UI.g; g.save(); g.imageSmoothingEnabled = false; if (o.alpha != null) g.globalAlpha = o.alpha; g.drawImage(img, X(x), Y(y), img.width * s * UI.k, img.height * s * UI.k); g.restore(); };
  UI.bar = function (x, y, w, h, frac, col, bg = 'rgba(0,0,0,0.5)') { UI.rect(x, y, w, h, bg); UI.rect(x, y, w * U.clamp(frac, 0, 1), h, col); };
  UI.hover = (x, y, w, h) => { const m = G.In.mouse; return m.x >= x && m.x < x + w && m.y >= y && m.y < y + h; };
  UI.clicked = (x, y, w, h) => G.In.mouse.released && UI.hover(x, y, w, h) && UI._downIn && UI._downIn[0] >= x && UI._downIn[0] < x + w && UI._downIn[1] >= y && UI._downIn[1] < y + h;
  UI.button = function (x, y, w, h, label, o = {}) {
    const hov = UI.hover(x, y, w, h) && !o.disabled, C = UI.C;
    const fill = o.disabled ? 'rgba(60,52,44,0.7)' : o.primary ? (hov ? '#e2b25a' : C.brass) : o.danger ? (hov ? '#b33c30' : '#8e2b22') : (hov ? 'rgba(90,66,40,0.95)' : 'rgba(52,38,26,0.92)');
    UI.panel(x, y, w, h, { fill, stroke: o.disabled ? '#5c5045' : o.primary ? '#f6d48a' : C.brass, r: o.r ?? 3 });
    UI.text(label, x + w / 2, y + h / 2 + (o.size || 7) * 0.36, { size: o.size || 7, align: 'center', bold: !!o.primary, color: o.disabled ? '#857a6e' : o.primary ? C.ink : C.fg, shadow: !o.primary });
    if (hov) UI.cursor = 'pointer';
    UI.seen.buttons.push({ x, y, w, h, label, id: o.id || null, disabled: !!o.disabled, primary: !!o.primary, danger: !!o.danger });
    const hit =!o.disabled && (UI.clicked(x, y, w, h) || (o.key && G.In.hit(...[].concat(o.key))));
    if (hit) G.Sfx.play('click');
    return hit;
  };
  UI.endFrame = function () { if (G.In.mouse.pressed) UI._downIn = [G.In.mouse.x, G.In.mouse.y]; if (G.In.mouse.released) setTimeout(() => { UI._downIn = null; }, 0); };
  UI.trackDown = function () { if (G.In.mouse.pressed) UI._downIn = [G.In.mouse.x, G.In.mouse.y]; };

  /* 热度火苗图标 */
  UI.flame = function (x, y, on, s = 1) { const g = UI.g; g.save(); g.fillStyle = on ? '#ffb43a' : 'rgba(255,255,255,0.15)'; g.beginPath(); g.ellipse(X(x), Y(y), 3 * s * UI.k, 4.5 * s * UI.k, 0, 0, 7); g.fill(); if (on) { g.fillStyle = '#fff1b0'; g.beginPath(); g.ellipse(X(x), Y(y + 1.2 * s), 1.4 * s * UI.k, 2.2 * s * UI.k, 0, 0, 7); g.fill(); } g.restore(); };

  /* 飘字、提示条、横幅 */
  UI.float = (x, y, text, color = '#ffe08a', o = {}) => UI.floaters.push({ x, y, y0: y, text, color, t: 0, life: o.life || 1.2, size: o.size || 7, vy: o.vy ?? -14, world: o.world || null });
  UI.toast = (text, color = UI.C.fg, life = 2.4) => { UI.toasts.push({ text, color, t: 0, life }); if (UI.toasts.length > 4) UI.toasts.shift(); };
  UI.showBanner = (title, sub, color = UI.C.gold, life = 3, y) => { UI.banner = { title, sub, color, t: 0, life, y }; };
  UI.step = function (dt) {
    for (const f of UI.floaters) { f.t += dt; f.y += f.vy * dt; } UI.floaters = UI.floaters.filter(f => f.t < f.life);
    for (const t of UI.toasts) t.t += dt; UI.toasts = UI.toasts.filter(t => t.t < t.life);
    if (UI.banner) { UI.banner.t += dt; if (UI.banner.t > UI.banner.life) UI.banner = null; }
  };
  UI.drawFloaters = function (cam) {
    for (const f of UI.floaters) {
      const a = f.t < f.life * 0.7 ? 1 : 1 - (f.t - f.life * 0.7) / (f.life * 0.3);
      let x = f.x, y = f.y;
      if (f.world && cam) { if (cam.toScreen) { const p = cam.toScreen(f.x, f.y0 ?? f.y); x = p[0]; y = p[1] + (f.y - (f.y0 ?? f.y)); } else { x -= cam.x; y -= cam.y; } } // 镜头会缩放的场景：世界坐标换成屏幕坐标，往上飘的那段按屏幕算
      UI.text(f.text, x, y, { size: f.size, align: 'center', color: f.color, bold: true, alpha: a });
    }
  };
  UI.drawFx = function () {
    UI.toasts.forEach((t, i) => { const a = t.t < 0.2 ? t.t / 0.2 : t.t > t.life - 0.4 ? (t.life - t.t) / 0.4 : 1; const w = UI.measure(t.text, 7) + 20; UI.g.save(); UI.g.globalAlpha = a; UI.panel(320 - w / 2, 44 + i * 18, w, 15, { fill: 'rgba(24,18,14,0.82)', stroke: 'rgba(200,150,62,0.6)' }); UI.text(t.text, 320, 54.5 + i * 18, { size: 7, align: 'center', color: t.color }); UI.g.restore(); });
    if (UI.banner) { const b = UI.banner, a = b.t < 0.25 ? b.t / 0.25 : b.t > b.life - 0.5 ? Math.max(0, (b.life - b.t) / 0.5) : 1, s = 1 + Math.max(0, 0.25 - b.t) * 1.2; UI.g.save(); UI.g.globalAlpha = a; const by = b.y ?? 40; UI.panel(170, by, 300, b.sub ? 54 : 38, { fill: 'rgba(24,14,8,0.88)', stroke: b.color, lw: 1.5, r: 6 }); UI.text(b.title, 320, by + 26, { size: 18 * s, align: 'center', color: b.color, bold: true, serif: true }); if (b.sub) UI.text(b.sub, 320, by + 44, { size: 7.5, align: 'center', color: UI.C.fg }); UI.g.restore(); }
  };
  UI.hint = function (text, o = {}) { if (!text) return; UI.seen.hints.push(text); const w = UI.measure(text, 7) + 22, y = o.y ?? 336; UI.panel(320 - w / 2, y, w, 16, { fill: 'rgba(24,18,14,0.8)', stroke: o.stroke || 'rgba(200,150,62,0.7)' }); UI.text(text, 320, y + 11, { size: 7, align: 'center', color: o.color || UI.C.fg }); };
  UI.keycap = function (label, x, y) { const w = Math.max(10, UI.measure(label, 6) + 6); UI.panel(x, y, w, 10, { fill: '#2d241c', stroke: '#c8963e', r: 2 }); UI.text(label, x + w / 2, y + 7.5, { size: 6, align: 'center', bold: true, color: '#f0d38a', shadow: false }); return w; };
  /* 头顶的「E」提示 */
  UI.prompt = function (x, y, key, label) { UI.seen.prompts.push({ x, y, key, label }); let w = UI.measure(label, 6.5) + 18; UI.panel(x - w / 2, y - 12, w, 12, { fill: 'rgba(24,18,14,0.85)', stroke: 'rgba(240,211,138,0.8)', r: 3 }); UI.keycap(key, x - w / 2 + 2, y - 11); UI.text(label, x - w / 2 + 15, y - 3.5, { size: 6.5, color: UI.C.fg }); };
  UI.goodsDot = function (k, x, y, r = 2.2) { UI.circle(x, y, r, k === 'mat' ? G.D.MAT.color : (G.D.GOODS[k] || {}).color || '#ccc', 'rgba(0,0,0,0.6)', 0.5); };
})(window.G);
