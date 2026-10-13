/* 主循环：固定 60 Hz 逻辑，像素画在 640×360 缓冲上画好后整数放大（关平滑），界面文字再用高分辨率画在上面。
   零件动画按每秒 12 帧量化（G.Game.f12）。 */
(function (G) {
  'use strict';
  const W = 640, H = 360, U = G.U, In = G.In, UI = G.UI;
  const Game = G.Game = { st: null, scene: null, sceneName: '', t: 0, f12: 0, scenes: {}, paused: false, fade: null, debug: {} };
  let cv, g, buf, bg; const view = { k: 2, ox: 0, oy: 0 };

  function resize() {
    const dpr = window.devicePixelRatio || 1; cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr); cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    view.k = Math.max(1, Math.floor(Math.min(cv.width / W, cv.height / H))); view.ox = (cv.width - W * view.k) >> 1; view.oy = (cv.height - H * view.k) >> 1;
  }
  Game.reg = (name, sc) => { Game.scenes[name] = sc; sc.name = name; };
  /* 切场景：先淡出，再进新场景，再淡入。kind: 'black' | 'white'（俯冲转场） */
  Game.go = function (name, params = {}, { fade = 0.35, kind = 'black' } = {}) {
    if (Game.fade && Game.fade.phase === 'out') return;
    const doIt = () => { const prev = Game.scene; if (prev && prev.exit) prev.exit(); Game.scene = Game.scenes[name]; Game.sceneName = name; G.UI.floaters = []; G.UI.banner = null; if (Game.scene.enter) Game.scene.enter(params); };
    if (!fade) { doIt(); return; }
    Game.fade = { phase: 'out', t: 0, d: fade, kind, cb: doIt };
  };
  Game.save = () => { if (Game.st) G.S.save(Game.st); };

  function frame(dtReal) {
    if (Game.hook) Game.hook(dtReal); // 自动演示（demo.html）在这里按键、点鼠标：和玩家的输入走同一条路
    UI.step(dtReal);
    if (Game.fade) { const F = Game.fade; F.t += dtReal; if (F.phase === 'out' && F.t >= F.d) { F.cb(); F.phase = 'in'; F.t = 0; } else if (F.phase === 'in' && F.t >= F.d) Game.fade = null; }
    if (In.hit('Escape') && Game.sceneName !== 'title' && (Game.paused || !(Game.scene && Game.scene.blockEsc && Game.scene.blockEsc()))) { Game.paused = !Game.paused; In.consume('Escape'); }
    const sc = Game.scene;
    if (!Game.paused && !(Game.fade && Game.fade.phase === 'out')) {
      Game.t += dtReal; Game.f12 = Math.floor(Game.t * 12);
      if (sc && sc.update) sc.update(dtReal);
    }
    bg.setTransform(1, 0, 0, 1, 0, 0); bg.imageSmoothingEnabled = false;
    if (sc && sc.draw) sc.draw(bg, Game.f12);
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0b0a0d'; g.fillRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = false; g.drawImage(buf, view.ox, view.oy, W * view.k, H * view.k);
    g.save(); g.beginPath(); g.rect(view.ox, view.oy, W * view.k, H * view.k); g.clip();
    UI.begin(g, view);
    if (In.mouse.pressed) UI._downIn = [In.mouse.x, In.mouse.y];
    UI.drawFloaters(sc && sc.cam);
    if (sc && sc.ui) sc.ui(UI);
    UI.drawFx();
    if (Game.paused) pauseMenu();
    if (Game.fade) { const F = Game.fade, a = F.phase === 'out' ? F.t / F.d : 1 - F.t / F.d; g.fillStyle = F.kind === 'white' ? `rgba(255,250,235,${U.clamp(a, 0, 1)})` : `rgba(8,6,10,${U.clamp(a, 0, 1)})`; g.fillRect(view.ox, view.oy, W * view.k, H * view.k); }
    g.restore();
    cv.style.cursor = UI.cursor;
    if (In.mouse.released) UI._downIn = null;
    In.endFrame();
  }
  function pauseMenu() {
    UI.rect(0, 0, 640, 360, 'rgba(8,6,10,0.6)'); UI.panel(240, 110, 160, 132, { r: 6 });
    UI.text('暂停', 320, 134, { size: 12, align: 'center', serif: true, bold: true, color: UI.C.brassL });
    if (UI.button(260, 146, 120, 20, '继续', { primary: true, key: 'Enter' })) Game.paused = false;
    if (UI.button(260, 172, 120, 20, G.Sfx.on ? '音效：开' : '音效：关')) { G.Sfx.on = !G.Sfx.on; G.Sfx.hum(false); }
    if (Game.sceneName === 'shmup') UI.text('副本里不能存档退出：先打完这一场', 320, 212, { size: 6.5, align: 'center', color: UI.C.muted });
    else if (UI.button(260, 198, 120, 20, '存档并回到标题')) { Game.save(); Game.paused = false; G.Sfx.hum(false); Game.go('title'); }
    UI.text('Esc 继续', 320, 234, { size: 6, align: 'center', color: UI.C.muted });
  }

  /* ---------------- 标题 ---------------- */
  Game.reg('title', {
    enter() { this.t = 0; this.save = G.S.load(); G.Sfx.hum(false); },
    update(dt) { this.t += dt; },
    draw(g, f) {
      const I = G.SPR.island; g.drawImage(I.bgImg, 0, 0);
      const x = 470 + Math.sin(this.t * 0.4) * 30, y = 30 + Math.sin(this.t * 0.7) * 4;
      G.Art.drawShip(g, I.ships.beast, x, y, f, { n: 6, hold: 1, deck: ['spice', 'wine', 'tea', 'spice', 'wine', 'gear'], crates: I.crates });
      g.fillStyle = 'rgba(10,8,14,0.35)'; g.fillRect(0, 0, 640, 360);
    },
    ui(u) {
      u.text('满舱而归', 60, 96, { size: 34, serif: true, bold: true, color: u.C.brassL });
      u.text('拼船，把货堆满甲板，活着飞回家，开夜市卖掉。', 62, 116, { size: 8.5, color: u.C.fg });
      u.text('核心切片 · 第 1 段（单人，开发版界面只有中文）', 62, 130, { size: 6.5, color: u.C.muted });
      const s = this.save;
      if (s && s.v === 1) { if (u.button(62, 150, 150, 22, `继续（第 ${s.day} 天）`, { primary: true, key: 'Enter' })) { Game.st = s; Game.resume(); } if (u.button(62, 178, 150, 20, '重新开始')) Game.newGame(); }
      else if (u.button(62, 150, 150, 22, '开始', { primary: true, key: ['Enter', 'Space'] })) Game.newGame();
      u.text('WASD / 方向键 移动　E 互动　Q 扔货　空格 冲刺　Esc 暂停', 62, 330, { size: 6.5, color: u.C.muted });
      u.text('美术：hi-bit 路线（分零件生成 + 代码拼装 + 零件分层动画），见 核心切片设计.md', 62, 342, { size: 6, color: 'rgba(165,157,144,0.8)' });
    },
  });
  Game.newGame = function () { G.S.wipe(); Game.st = G.S.newGame(); Game.go('map', { opening: true }); };
  Game.resume = function () {
    const st = Game.st;
    if (st.phase === 'sea' && st.mapPos) Game.go('map', { resume: true });
    else if (st.flags.tut === 'opening') Game.go('map', { opening: true });
    else { if (st.phase === 'night') st.phase = 'day'; Game.go('island', {}); }
  };

  /* ---------------- 启动 ---------------- */
  async function boot() {
    cv = document.getElementById('screen'); g = cv.getContext('2d'); buf = document.createElement('canvas'); buf.width = W; buf.height = H; bg = buf.getContext('2d');
    resize(); addEventListener('resize', resize); In.bindCanvas(cv, view);
    G.SPR = await G.Art.load(window.SPRITES);
    document.getElementById('loading')?.remove();
    const q = new URLSearchParams(location.search);
    Game.go(q.get('scene') || 'title', {}, { fade: 0.2 });
    if (q.get('test')) G.Test && G.Test.init(q);
    Game.speed = U.clamp(Math.round(+q.get('speed') || 1), 1, 16); // 开发用：?speed=4 每画一帧跑 4 帧逻辑（无头试跑快进）
    let last = performance.now();
    const loop = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; for (let i = 0; i < Game.speed; i++) { try { frame(dt); } catch (e) { console.error(e); Game.lastError = String(e.stack || e); } } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  Game.view = view; Game.W = W; Game.H = H;
  addEventListener('load', boot);
})(window.G);
