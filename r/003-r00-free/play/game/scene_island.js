/* 空岛（白天）：四分之三俯视，船长走来走去（照星露谷的手感）；回家时船降回泊位、货箱一箱箱滚进仓库；
   告示板、仓库、集市摆摊、睡觉、船坞入口、出航动画。
   画法（镜头只看船长身边一片、按住 Tab 看全岛、前后遮挡、交互描边）在 isle_view.js；能走的范围和手画的遮挡在 isle_layout.js。 */
(function (G) {
  'use strict';
  const D = G.D, S = G.S, U = G.U, A = G.Art, In = G.In, Game = G.Game;
  const R = U.R;

  /* ---------- 船长走路（空岛和夜市共用） ---------- */
  const Walk = G.Walk = {};
  Walk.make = (x, y) => ({ x, y, face: 1, moving: false, t: 0 });
  Walk.update = function (w, dt, speed, ok) {
    const a = In.axis(); let dx = a.x, dy = a.y; const l = Math.hypot(dx, dy); w.moving = l > 0;
    if (!l) return;
    dx = dx / l * speed * dt; dy = dy / l * speed * dt * 0.85;
    /* 被挡住时顺着挡住的东西滑过去（斜栅栏、灯柱、桶、摊位角）：先照以前那样横竖分开走；两个方向都走不动、或者只按了一个方向被挡住时，
       把方向往两边转（20°、35°……80°），找第一个走得通的方向，按同样的步长走。上一帧往哪边转的这一帧先试哪边，所以沿着斜栅栏是匀速滑过去的，不会一顿一顿地蹭 */
    const ox = w.x, oy = w.y;
    if (ok(w.x + dx, w.y + dy)) { w.x += dx; w.y += dy; }
    else if (dx && dy && (ok(w.x + dx, w.y) || ok(w.x, w.y + dy))) { if (ok(w.x + dx, w.y)) w.x += dx; else w.y += dy; }
    else {
      const len = speed * dt, a0 = Math.atan2(dy / 0.85, dx), sides = w.slideSide === -1 ? [-1, 1] : [1, -1];
      /* 走的距离按「推着墙走」算（cos 角度）：绕灯柱这种只偏一点的照常走，顶着几乎正对的墙只慢慢蹭，转过 75° 就停住 */
      const at = (sd, deg) => { const a = a0 + sd * deg * Math.PI / 180, l2 = len * Math.cos(deg * Math.PI / 180); return [w.x + Math.cos(a) * l2, w.y + Math.sin(a) * l2 * 0.85]; }, free = (sd, deg) => ok(...at(sd, deg));
      found: for (const sd of sides) { let lo = 0; for (const deg of [15, 30, 45, 60, 75]) { if (!free(sd, deg)) { lo = deg; continue; } let hi = deg; for (let n = 0; n < 6; n++) { const m = (lo + hi) / 2; if (free(sd, m)) hi = m; else lo = m; } [w.x, w.y] = at(sd, hi); w.slideSide = sd; break found; } } // 找贴着挡住的东西、刚好走得通的那个角度（二分），每帧都一样，滑得匀
    }
    w.moving = w.x !== ox || w.y !== oy || w.moving;
    if (dx < 0) w.face = -1; else if (dx > 0) w.face = 1;
    w.t += dt; if ((w.t * 6 | 0) !== ((w.t - dt) * 6 | 0)) G.Sfx.play('step');
  };
  /* 画人在 isle_view.js（IV.walker）：按大图 / 小图的像素格画，位置对齐到物理像素 */

  /* 岛面能走的地方（脚的位置）：isle_layout.js 里手画的范围，减掉房子、摊位、树干、栅栏、灯柱这些东西的底（载入后才有，见 boot） */
  let okDayFn = null; const okDay = (x, y) => (okDayFn || (okDayFn = G.IsleView.okFn('day')))(x, y);
  G.Island = { okDay };

  const SPOTS = G.Island.SPOTS = [
    { id: 'house', x: 104, y: 156, label: '睡觉（不开夜市，直接过一天）' },
    { id: 'store', x: 182, y: 98, label: '看仓库' },
    { id: 'board', x: 228, y: 224, label: '看告示板' }, // 站在告示板正前面（以前站在两条腿中间，有了遮挡会被板子挡住）
    { id: 'market', x: 268, y: 160, label: '摆摊开市' },
    { id: 'dock', x: 458, y: 162, label: '进船坞' },
  ];
  const PIER = { x: 566, y: 188 };  // 泊位：船身底边落在这里
  const PIER2 = { x: 470, y: 128 }; // 另一艘船停在船坞门口
  const WARE = { x: 182, y: 96 };   // 仓库门
  const ROLL = [[540, 196], [500, 186], [470, 172], [430, 150], [400, 112], [330, 104], [250, 96], [WARE.x, WARE.y]];

  const IV = G.IsleView;
  const sc = { cam: null, smooth: true };
  sc.enter = function (p = {}) {
    const st = this.st = Game.st; st.phase = st.phase === 'sea' ? 'day' : st.phase; if (p.arrive || p.towed) st.phase = 'day';
    this.I = G.SPR.island; this.cap = Walk.make(300, 190); this.modal = null; this.t = 0; this.rolls = []; this.puffs = A.Pool(); this.steam = A.Pool();
    this.arrive = null; this.launch = null;
    if (p.arrive || p.towed) this.startArrive(p);
    if (p.launch) { this.launch = { t: 0 }; this.cap = Walk.make(500, 200); }
    if (p.fromDock) this.cap = Walk.make(458, 168);
    if (p.fromMarket) this.cap = Walk.make(268, 170);
    this.cam = IV.camera('day'); this.Z = IV.sets.day.Z;
    const f = this.focus(); IV.stepCam(this.cam, 0, false, f[0], f[1], true);
    Game.save();
  };
  /* 镜头看哪：平时跟着船长（往上一点，头顶的提示也在画面里）；回家和出航时看着船 */
  sc.focus = function () {
    const Z = this.Z;
    if (this.arrive || this.launch) { const P = this.shipPose(); return [(P.x + P.Sp.w / 2) * Z, (P.y + P.Sp.h / 2) * Z]; }
    return [this.cap.x * Z, this.cap.y * Z - 40];
  };
  sc.startArrive = function (p) {
    const st = this.st, ship = S.ship(st);
    const items = ship.deck.slice().reverse().concat(ship.hold.slice().reverse());
    const res = S.unload(st);
    this.arrive = { t: 0, items, res, towed: !!p.towed, landed: false, rolled: 0 };
    this.cap = Walk.make(PIER.x - 30, PIER.y + 10); this.cap.hidden = true;
    st.log.voyages++;
  };

  sc.update = function (dt) {
    const st = this.st; this.t += dt;
    { const a = this.arrive, f = this.focus(); // 回家时：船落稳以后自动拉远，看货箱一箱箱滚进仓库；完了再拉回船长身边
      const out = In.key('Tab') || (a && a.landed && a.t > 1.75); IV.stepCam(this.cam, dt, out, f[0], f[1]); }
    this.puffs.step(dt); this.steam.step(dt);
    for (const r of this.rolls) { r.t += dt; }
    this.rolls = this.rolls.filter(r => r.t < r.T);
    if (this.arrive) { this.updateArrive(dt); return; }
    if (this.launch) { this.updateLaunch(dt); return; }
    if (this.modal) return;
    Walk.update(this.cap, dt, 64, okDay);
    const sp = this.spot();
    if (sp && In.hit('KeyE')) { In.consume('KeyE'); this.use(sp); }
    if (In.hit('KeyB')) G.UI.toast('建造模式（挪建筑、摆摊位）这一段还没做：见 notes.md');
  };
  sc.spot = function () { let best = null, bd = 22; for (const s of SPOTS) { const d = U.dist(this.cap.x, this.cap.y, s.x, s.y); if (d < bd) { bd = d; best = s; } } return best; };
  sc.use = function (s) {
    const st = this.st; G.Sfx.play('click');
    if (s.id === 'dock') { Game.go('dock', {}); return; }
    if (s.id === 'board') { this.modal = { type: 'board' }; return; }
    if (s.id === 'store') { this.modal = { type: 'store' }; return; }
    if (s.id === 'house') { this.modal = { type: 'sleep' }; return; }
    if (s.id === 'market') { this.modal = { type: 'prep', prep: G.Market.autoPrep(st) }; return; }
  };

  /* 回家：船降回泊位 → 货箱一箱箱滚进仓库 → 满舱而归 / 冒尖而归 → 船长从栈桥走下来 */
  sc.updateArrive = function (dt) {
    const a = this.arrive, st = this.st; a.t += dt;
    if (!a.landed && a.t > 1.4) { a.landed = true; G.Sfx.play('thud'); for (let i = 0; i < 10; i++) this.puffs.add({ x: PIER.x + (R() - 0.5) * 60, y: PIER.y + 2, vx: (R() - 0.5) * 30, vy: -R() * 10, r: 1.5, age: 0, life: 0.8 }); }
    const t0 = 1.7;
    while (a.landed && a.rolled < a.items.length && a.t > t0 + a.rolled * 0.16) { this.rolls.push({ k: a.items[a.rolled].k, t: 0, T: 2.4 }); a.rolled++; G.Sfx.play('pick'); }
    const tEnd = t0 + a.items.length * 0.16 + 1.2;
    if (!a.bannered && a.t > t0 + 0.4) {
      a.bannered = true; const r = a.res;
      if (a.towed) G.UI.showBanner('被拖回家了', '船免费修好；仓库里的货今晚照样能卖', '#c8d8e8', 3.5);
      else if (r.full && r.heap) { G.UI.showBanner('冒尖而归！', `舱里 ${r.hold} 箱 +15%　甲板 ${r.heap} 箱 +30%`, '#ffd24c', 3.8); G.Sfx.play('fanfare'); }
      else if (r.full) { G.UI.showBanner('满舱而归！', `舱里 ${r.hold} 箱今晚 +15%`, '#ffd24c', 3.5); G.Sfx.play('fanfare'); }
      else if (r.hold + r.deck) { G.UI.showBanner('回家了', `舱没装满（${r.hold} 箱）：这趟的货不加成`, '#e8dcc8', 3); G.Sfx.play('win'); }
      else G.UI.showBanner('回家了', '空船回来：船体值修满', '#e8dcc8', 2.5);
      if (r.mat) G.UI.toast(`船材 +${r.mat * 10}（${r.mat} 箱进了材料堆）`); if (r.mods) G.UI.toast(`${r.mods} 件模块进了仓库`);
    }
    if (a.t > tEnd) {
      this.arrive = null; this.cap.hidden = false;
      const tut = st.flags.tut;
      if (tut === 'opening') { // 开场：木筏散了架，只剩底模和一堆模块
        const raft = st.ships[0]; for (const m of S.allMods(raft)) st.modules.push(m); raft.slots = S.emptySlots('raft');
        for (let i = 0; i < 18; i++) this.puffs.add({ x: PIER.x + (R() - 0.5) * 70, y: PIER.y - 20 - R() * 40, vx: (R() - 0.5) * 40, vy: -R() * 20, r: 2, age: 0, life: 1.2 });
        G.Sfx.play('boom'); G.UI.showBanner('木筏散了架', '只剩底模和一堆模块：去船坞把它一块块装回去', '#e8dcc8', 4);
        st.flags.tut = 'dock';
      } else if (['buy', 'fight', 'home'].includes(tut)) st.flags.tut = 'market';
      Game.save();
    }
  };
  sc.updateLaunch = function (dt) {
    const L = this.launch; L.t += dt;
    if (L.t > 0.6 && !L.puffed) { L.puffed = true; G.Sfx.play('throw'); for (let i = 0; i < 14; i++) this.puffs.add({ x: PIER.x + (R() - 0.5) * 50, y: PIER.y - 40 - R() * 30, vx: (R() - 0.5) * 30, vy: -10 - R() * 10, r: 2, age: 0, life: 1 }); }
    if (L.t > 2.6 && !L.gone) { L.gone = true; Game.go('map', { launch: true }, { fade: 0.4 }); }
  };

  /* ---------- 画 ---------- */
  /* 船停在泊位上的位置。V：用哪套图（大图 m = Z，小图 m = 1）；不给就是逻辑坐标（640×360 那套，粒子用） */
  sc.shipPose = function (V) {
    const st = this.st, ship = S.ship(st), m = V ? V.m : 1, Sp = (V ? V.spr : this.I).ships[ship.hull];
    let x = PIER.x * m - Sp.w / 2, y = PIER.y * m - Sp.hullBottom, n = S.stats(ship).topN;
    if (this.arrive) { const t = U.clamp(this.arrive.t / 1.4, 0, 1), e = 1 - (1 - t) * (1 - t); x += (1 - e) * 140 * m; y -= (1 - e) * 110 * m; }
    if (this.launch) { const t = U.clamp((this.launch.t - 0.3) / 2.2, 0, 1); x += t * t * 300 * m; y -= t * t * 160 * m; }
    return { Sp, x, y, n, ship, flying: !!(this.launch || (this.arrive && this.arrive.t < 1.4)) };
  };
  sc.draw = function (g, f) {
    const st = this.st, ents = [];
    // 另一艘船停在船坞门口（排在船坞前面：它停在门口，不是停在房子后面）
    st.ships.forEach((sh, i) => { if (i === st.active) return; ents.push({ y: Math.max(PIER2.y, 154), draw: (g, V) => { const Sp = V.spr.ships[sh.hull], ss = S.stats(sh); const x = PIER2.x * V.m - Sp.w / 2, y = PIER2.y * V.m - Sp.hullBottom; A.drawShip(g, Sp, x, y, f + i * 5, { n: ss.topN, gun: !!ss.gun, engine: ss.engines > 0 }); return [x, y - 4, x + Sp.w, y + Sp.h + 4]; } }); });
    // 泊位上的船（飞着的时候画在最上面）
    const P0 = this.shipPose(), ss = S.stats(P0.ship), emptyRaft = !S.allMods(P0.ship).length;
    if (!this.arrive || this.arrive.t > 0) {
      if (P0.ship.hp > 0) this.steamTick(P0, f);
      ents.push({ y: P0.flying ? 1e6 : PIER.y, draw: (g, V) => {
        const m = V.m, P = this.shipPose(V);
        this.steam.each(p => A.blob(g, p.x * m, p.y * m, (p.r + p.age * 1.4) * m, A.STEAM.slice(Math.min(2, (p.age / 0.5) | 0))));
        const arr = this.arrive, deck = arr && !arr.rolled ? arr.items.filter((_, i) => i < (arr.res.deck)).map(i => i.k) : [];
        A.drawShip(g, P.Sp, P.x, P.y, f, { n: emptyRaft ? 0 : P.n, gun: !!ss.gun, engine: emptyRaft ? false : ss.engines > 0, hold: arr && !arr.rolled ? 1 : 0, deck, crates: V.spr.crates });
        return [P.x - 20 * m, P.y - 30 * m, P.x + P.Sp.w + 10 * m, P.y + P.Sp.h + 4];
      } });
    }
    // 滚进仓库的货箱（一样按 y 排：滚到栅栏、摊位后面会被挡住）
    for (const r of this.rolls) {
      const u = U.clamp(r.t / r.T, 0, 1) * (ROLL.length - 1), i = Math.min(ROLL.length - 2, Math.floor(u)), v = u - i;
      const x = U.lerp(ROLL[i][0], ROLL[i + 1][0], v), y = U.lerp(ROLL[i][1], ROLL[i + 1][1], v), hop = Math.abs(Math.sin(r.t * 9)) * 3;
      ents.push({ y, draw: (g, V) => { const ci = V.spr.crates[r.k] || V.spr.crates.mat, m = V.m, X = x * m - ci.w / 2, Y = (y - hop) * m - ci.h; g.drawImage(ci.img, G.Px.s(X), G.Px.s(Y)); return [X, Y, X + ci.w, Y + ci.h]; } });
    }
    // 落地、起飞时那一鼓蒸汽：大图上半径只放大一半、边散边淡（整倍放大像一颗颗灰球）
    ents.push({ y: 1e6 + 1, draw: (g, V) => { const k = V.small ? 1 : V.m * 0.55; this.puffs.each(p => { g.globalAlpha = U.clamp(1.4 - p.age / p.life * 1.4, 0, 1); A.blob(g, p.x * V.m, p.y * V.m, (p.r + p.age * 3) * k, A.STEAM.slice(Math.min(2, (p.age / 0.4) | 0))); }); g.globalAlpha = 1; } });
    if (!this.cap.hidden) { const cap = this.cap, e = { y: cap.y, draw: (g, V) => { e.box = IV.walker(g, V, cap, V.spr.capA.img, f); }, sil: (g, V) => IV.walkerSil(g, V, cap, V.sil.capA, f) }; ents.push(e); }
    const hot = new Set(); if (!this.arrive && !this.launch && !this.modal) { const sp = this.spot(); if (sp) hot.add(sp.id); if (this.goalNow) hot.add(this.goalNow.spot); }
    IV.render(g, 'day', this.cam, ents, { hot });
    Game.debug.track = { scene: 'island', bg: [this.cam.tx * G.Px.k, this.cam.ty * G.Px.k], obj: [this.cam.sx(this.cap.x * this.Z) * G.Px.k, this.cam.sy(this.cap.y * this.Z) * G.Px.k] }; // tools/smooth.mjs 量顺不顺用
  };
  sc.steamTick = function (P, f) { if (R() < 0.25) { const S2 = P.Sp; this.steam.add({ x: P.x + S2.chim.x, y: P.y + S2.chim.y, vx: -4, vy: -8, r: 0.6, age: 0, life: 1.2 }); } };

  /* ---------- 界面 ---------- */
  const NAMES = { house: '农舍', store: '仓库', board: '告示板', market: '集市', dock: '船坞' };
  sc.ui = function (u) {
    const st = this.st, C = u.C, cam = this.cam, Z = this.Z;
    G.Hud.top(u, st, st.phase === 'morning' ? '早上' : '白天');
    if (!this.arrive && !this.launch && !this.modal) {
      const sp = this.spot(), gl = this.goalNow = this.goal();
      // 建筑的名字写在它描边的顶上；现在该去的那个亮起来加 ▼，不在画面里就在画面边上指过去
      const rings = IV.sets.day.big.rings;
      for (const s of SPOTS) {
        if (s === sp) continue; const r = rings[s.id], on = gl.spot === s.id; if (!r) continue;
        const wx = r.x0 + r.w / 2, wy = r.y0 + 4, sx = cam.sx(wx), sy = cam.sy(wy);
        if (on && IV.edgeArrow(u, cam, wx, r.y0 + r.h / 2, '▼ ' + NAMES[s.id])) continue;
        if (sx < -40 || sx > 680 || sy < -10 || sy > 380) continue;
        u.text((on ? '▼ ' : '') + NAMES[s.id], U.clamp(sx, 24, 616), U.clamp(sy, 44, 330), { size: on ? 7.5 : 6.5, bold: on, align: 'center', color: on ? '#ffe08a' : 'rgba(255,243,208,0.9)' });
      }
      if (sp) u.prompt(cam.sx(this.cap.x * Z), cam.sy(this.cap.y * Z - 74), 'E', sp.label);
      u.hint(gl.text);
      IV.tabHint(u, this.cam);
    }
    if (this.modal) this.modalUI(u);
  };
  /* 现在该做什么：底下一行提示 + 该走去哪个建筑（头顶的名字会亮起来）。早上出航，回来开市；仓库空了就睡觉 */
  sc.goal = function () {
    const st = this.st, t = st.flags.tut;
    if (t === 'dock') return { spot: 'dock', text: '走进右边的船坞（按 E），把木筏一块块装回去' };
    if (t === 'buy' || t === 'fight' || t === 'launch') return { spot: 'dock', text: '去船坞点「出航」' };
    if (t === 'market') return { spot: 'market', text: '到集市广场按 E：摆摊、敲铃开市' };
    const acc = st.board.accepted, ord = acc ? `订单：${acc.who} 要 ${Object.entries(acc.need).map(([k, n]) => D.GOODS[k].name + '×' + n).join('、')}（第 ${acc.due} 天晚上前）　` : '';
    if (st.phase === 'morning' && !st.flags.boardSeen) return { spot: 'board', text: '早上先看告示板：今晚热门和大客户订单' };
    if (st.phase === 'morning') return { spot: 'dock', text: ord + '去船坞出航：进货、打海盗、捞残骸，傍晚回来开市' };
    const prep = G.Market.autoPrep(st), canOpen = prep.stalls.some(p => p.k) || (prep.rsv && prep.rsv.ok);
    if (canOpen) return { spot: 'market', text: ord + '傍晚了：到集市按 E 摆摊、敲铃开市' };
    return { spot: 'house', text: '仓库里没有能卖的货：回农舍睡觉，明天再出海' };
  };
  sc.modalUI = function (u) {
    const m = this.modal, st = this.st, C = u.C;
    u.rect(0, 0, 640, 360, 'rgba(8,6,10,0.45)');
    if (m.type === 'board') { st.flags.boardSeen = true; if (G.Board.ui(u, st)) this.modal = null; }
    else if (m.type === 'store') {
      u.panel(170, 70, 300, 210, { fill: 'rgba(24,18,14,0.96)', r: 6 });
      u.text(`仓库 ${st.warehouse.length} / ${st.warehouseCap}`, 320, 92, { size: 12, bold: true, serif: true, align: 'center', color: C.brassL });
      u.text('放进来就永远安全。舱里的货标「满舱」+15%，甲板上的标「冒尖」+30%。', 320, 106, { size: 6, align: 'center', color: C.muted });
      const groups = G.Market.groups(st.warehouse); let y = 122;
      if (!groups.length) u.text('空的', 320, 140, { size: 8, align: 'center', color: C.muted });
      for (const gr of groups) { u.img(this.I.crates[gr.k], 190, y - 7, 1); u.text(`${D.GOODS[gr.k].name}${gr.tag ? (gr.tag === 'heap' ? ' · 冒尖' : ' · 满舱') : ''}${gr.sea ? ' · 海货' : ' · 城里的货'}`, 204, y, { size: 7 }); u.text(`× ${gr.n}`, 440, y, { size: 7, align: 'right', bold: true }); y += 13; if (y > 240) break; }
      u.text(`材料堆：船材 ${st.mat}　　没装上的模块 ${st.modules.length} 件`, 320, 254, { size: 7, align: 'center', color: C.fg });
      if (u.button(280, 262, 80, 14, '关上（E）', { key: ['KeyE', 'Escape'] })) this.modal = null;
    }
    else if (m.type === 'sleep') {
      u.panel(200, 120, 240, 100, { fill: 'rgba(24,18,14,0.96)', r: 6 });
      u.text('直接睡觉？', 320, 144, { size: 12, bold: true, serif: true, align: 'center', color: C.brassL });
      u.text('不开夜市：日历 +1，不付工钱，告示板不换。', 320, 160, { size: 7, align: 'center' });
      u.text('仓库里的货留着，标都还在。', 320, 172, { size: 6.5, align: 'center', color: C.muted });
      if (u.button(220, 186, 96, 20, '睡觉', { primary: true })) { this.modal = null; S.endDay(st, false); st.flags.boardSeen = false; Game.save(); Game.go('island', { fromMarket: true }, { fade: 0.8 }); G.UI.toast(`第 ${st.day} 天早上`); }
      if (u.button(324, 186, 96, 20, '算了', { key: 'Escape' })) this.modal = null;
    }
    else if (m.type === 'prep') { const r = G.Market.prepUI(u, st, m.prep); if (r === 'close') this.modal = null; else if (r === 'open') { this.modal = null; Game.go('market', { prep: m.prep }, { fade: 0.8 }); } }
  };
  sc.blockEsc = function () { return !!this.modal; };
  Game.reg('island', sc);

  /* ---------- 顶栏（空岛、船坞、夜市共用） ---------- */
  G.Hud = {
    top(u, st, phase) {
      const C = u.C; u.panel(8, 8, 222, 22);
      u.text(`第 ${st.day} 天 · ${phase}`, 16, 22.5, { size: 7.5, bold: true, color: C.brassL });
      u.text(`金币 ${U.fmt(st.gold)}`, 86, 22.5, { size: 7.5, color: '#ffe08a' });
      u.text(`船材 ${st.mat}`, 140, 22.5, { size: 7.5, color: '#b8d0f0' });
      const star = st.stars, next = D.MARKET.stars[star]; u.text(`口碑 ${'★'.repeat(star) || '零星'} ${next ? Math.floor(st.rep) + '/' + next : ''}`, 182, 22.5, { size: 6.5, color: '#f0c050' });
    },
  };

  /* ---------- 告示板：今晚热门、大客户订单 ---------- */
  G.Board = {
    ui(u, st) {
      const C = u.C, b = st.board;
      u.panel(130, 50, 380, 250, { fill: 'rgba(36,26,18,0.97)', r: 6 });
      u.text('告示板', 320, 74, { size: 13, bold: true, serif: true, align: 'center', color: C.brassL });
      u.text('今晚热门（售价 ×1.3，客人点它的机会是别的货的 2 倍）', 150, 94, { size: 7, color: C.muted });
      b.hot.forEach((k, i) => { const x = 160 + i * 150; u.panel(x, 100, 140, 24, { fill: 'rgba(80,40,20,0.8)', stroke: '#ffb43a' }); u.img(G.SPR.island.crates[k], x + 8, 109, 1); u.text(D.GOODS[k].name, x + 20, 115, { size: 8, bold: true }); u.text(`约 ${Math.round(D.GOODS[k].base * D.GOODS[k].far * 1.3)} 金`, x + 132, 115, { size: 6.5, align: 'right', color: '#ffe08a' }); });
      u.text('大客户订单（报酬是普通卖价的 1.5 倍；一次只能接一张，没交上也不罚）', 150, 140, { size: 7, color: C.muted });
      const acc = b.accepted;
      if (acc) { this.card(u, st, acc, 160, 148, true); u.text('已接下。货备齐了，开市时会自动留出来，大客户第一个来。', 320, 214, { size: 6.5, align: 'center', color: '#b8f0a0' }); }
      else b.orders.forEach((o, i) => { const x = 140 + i * 186; this.card(u, st, o, x, 148, false); if (u.button(x + 50, 200, 80, 16, '接下', { id: 'order:' + i })) { b.accepted = o; b.orders = []; G.Sfx.play('coin'); G.Game.save(); } });
      const nx = D.MARKET.stars[st.stars];
      u.text(`口碑 ${Math.floor(st.rep)}${nx ? ' / ' + nx + ' 到下一颗星' : ''}　星级 ${st.stars}　只有海上打来、捞来的货涨口碑`, 320, 244, { size: 6.5, align: 'center', color: '#f0c050' });
      u.text('悬赏榜（独眼杰克等首领）这一段还没做', 320, 258, { size: 6, align: 'center', color: C.muted });
      return u.button(280, 272, 80, 18, '关上（E）', { key: ['KeyE', 'Escape'] });
    },
    card(u, st, o, x, y, wide) {
      const C = u.C, w = wide ? 320 : 176; u.panel(x, y, w, 48, { fill: 'rgba(60,44,30,0.9)', stroke: C.brass });
      u.text(o.who, x + 8, y + 13, { size: 8, bold: true, color: C.brassL });
      u.text(o.due === st.day ? '今晚要' : `第 ${o.due} 天晚上前`, x + w - 8, y + 13, { size: 6.5, align: 'right', color: o.due === st.day ? '#ffb08a' : C.muted });
      let xx = x + 8; for (const [k, n] of Object.entries(o.need)) { u.img(G.SPR.island.crates[k], xx, y + 19, 1); u.text(`${D.GOODS[k].name} ×${n}`, xx + 9, y + 25.5, { size: 7 }); xx += 62; }
      const have = Object.entries(o.need).every(([k, n]) => st.warehouse.filter(i => i.k === k).length >= n);
      const pay = Math.round(U.sum(Object.entries(o.need).map(([k, n]) => n * D.GOODS[k].base * D.GOODS[k].far * (1 + st.stars * 0.05))) * D.MARKET.orderMult);
      u.text(`报酬约 ${pay} 金`, x + 8, y + 40, { size: 6.5, color: '#ffe08a' }); u.text(have ? '仓库里货够了' : '货还不够', x + w - 8, y + 40, { size: 6.5, align: 'right', color: have ? '#b8f0a0' : C.muted });
    },
  };
})(window.G);
