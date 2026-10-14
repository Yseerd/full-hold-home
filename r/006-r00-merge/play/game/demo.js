/* 自动演示（demo.html 用，index.html 不载入）：点一下，机器人从标题开始自己玩。
   一局 = 切片的整条线：开场的木筏 → 装船、进货、打海盗、开夜市 → 攒钱造驮兽货船 → 第一次开驮兽回家、开完夜市（最多 6 天）。
   玩完从暂停菜单「存档并回到标题」，再点「重新开始」开下一局。按 Esc 停，之后你可以接着玩。?days=N 改成固定玩 N 天。
   机器人只用玩家能用的操作：键盘（WASD、E、Q、空格、Shift、Esc）和鼠标（移过去、按下、松开），写进和真按键同一个 G.In。
   它照屏幕上写着的东西玩：底下一行提示和目标箭头、头顶的「E」提示、按钮上的字、客人头上的气泡、飞来的子弹（就地开打的横版战斗里躲子弹、对准敌船用 G.Test.battleKeys，只读画面上的东西）。
   不改存档、不调用游戏里改状态的函数、不另给它路线和打法。它卡住、站着不动、没事可做的地方，记进 Demo.log，那是游戏要修的地方。 */
(function (G) {
  'use strict';
  const U = G.U, D = G.D, S = G.S, Game = G.Game, In = G.In, UI = G.UI;
  const q = new URLSearchParams(location.search);
  const FIXED_DAYS = Math.max(0, +q.get('days') || 0), MAX_DAYS = 6;
  const Demo = G.Demo = { on: false, stopped: false, run: 0, doing: '', log: [], idle: {}, runs: [], t: 0, seq: 0 };
  const log = (kind, msg, extra) => { const e = { seq: ++Demo.seq, t: Math.round(Demo.t * 10) / 10, run: Demo.run, day: Game.st ? Game.st.day : 0, scene: Game.sceneName, kind, msg, ...(extra || {}) }; Demo.log.push(e); if (Demo.log.length > 400) Demo.log.shift(); console.log('[demo] ' + JSON.stringify(e)); };

  /* ---------------- 输入：和真键盘、真鼠标走同一条路 ---------------- */
  const I = { held: new Set(), was: new Set(), tap: new Set(), mx: 320, my: 200, press: false, release: false };
  function push() {
    const want = new Set([...I.held, ...I.tap]);
    for (const c of want) { if (!In.down[c]) In.pressed[c] = true; In.down[c] = true; }
    for (const c of I.was) if (!want.has(c)) { In.down[c] = false; In.released[c] = true; }
    I.was = want; I.tap.clear();
    In.mouse.x = I.mx; In.mouse.y = I.my;
    if (I.press) { In.mouse.down = true; In.mouse.pressed = true; I.press = false; }
    if (I.release) { In.mouse.down = false; In.mouse.released = true; I.release = false; }
  }
  function releaseAll() { for (const c of I.was) { In.down[c] = false; In.released[c] = true; } I.was.clear(); I.held.clear(); In.mouse.down = false; }

  /* 一串动作（鼠标挪过去、按下、松开、按一下键、等一会儿）；排着的时候不再想别的 */
  const Q = [];
  function runQueue(dt) {
    while (Q.length) {
      const a = Q[0];
      if (a.t === 'wait') { a.s -= dt; if (a.s > 0) return true; Q.shift(); continue; }
      if (a.t === 'move') { const d = Math.hypot(a.x - I.mx, a.y - I.my), v = 700 * dt; if (d > v) { I.mx += (a.x - I.mx) / d * v; I.my += (a.y - I.my) / d * v; return true; } I.mx = a.x; I.my = a.y; Q.shift(); return true; }
      if (a.t === 'press') { I.press = true; Q.shift(); return true; }
      if (a.t === 'release') { I.release = true; Q.shift(); return true; }
      if (a.t === 'tap') { I.tap.add(a.code); Q.shift(); return true; }
      if (a.t === 'fn') { Q.shift(); a.f(); continue; }
    }
    return false;
  }
  const wait = s => Q.push({ t: 'wait', s });
  const clickAt = (x, y, pre = 0.4) => { wait(pre); Q.push({ t: 'move', x, y }, { t: 'wait', s: 0.06 }, { t: 'press' }, { t: 'release' }, { t: 'wait', s: 0.12 }); };
  const clickBtn = (b, pre) => { log('click', b.label); clickAt(b.x + b.w / 2, b.y + b.h / 2, pre); };
  const tap = (code, pre = 0) => { if (pre) wait(pre); Q.push({ t: 'tap', code }, { t: 'wait', s: 0.05 }); };
  const then = f => Q.push({ t: 'fn', f });

  /* 屏幕上看得见的东西（上一帧画出来的） */
  const btns = () => UI.seen.buttons;
  const btn = test => btns().find(b => !b.disabled && (typeof test === 'function' ? test(b) : b.label === test || b.id === test));
  const prompt = label => UI.seen.prompts.find(p => p.label === label);
  const promptStarts = s => UI.seen.prompts.find(p => p.label.startsWith(s));
  const hint = s => UI.seen.hints.some(h => h.includes(s));

  let idleWhy = null, waitWhy = null;
  const say = s => { if (Demo.doing !== s) { Demo.doing = s; } };
  const idle = why => { idleWhy = why; };
  const waiting = why => { waitWhy = why; };

  /* ---------------- 走路（空岛、夜市）：照着能走的地方找路 ---------------- */
  const CELL = 4;
  function findPath(ok, sx, sy, tx, ty) {
    const W = 640 / CELL, H = 360 / CELL, idx = (x, y) => y * W + x, pass = new Map();
    const can = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const k = idx(x, y); if (!pass.has(k)) { const cx = x * CELL + 2, cy = y * CELL + 2; pass.set(k, ok(cx, cy) && ok(cx - 1.5, cy) && ok(cx + 1.5, cy) && ok(cx, cy - 1.5) && ok(cx, cy + 1.5)); } return pass.get(k); }; // 格子中心四周留 1.5 像素：路不贴着东西的边走（贴着走会顶在灌木、桶的角上蹭）
    const snap = (px, py) => { const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL); if (can(cx, cy)) return [cx, cy]; for (let r = 1; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (can(cx + dx, cy + dy)) return [cx + dx, cy + dy]; return null; };
    const s = snap(sx, sy), t = snap(tx, ty); if (!s || !t) return null;
    const open = [[0, s[0], s[1]]], g = new Map([[idx(s[0], s[1]), 0]]), from = new Map(); let n = 0;
    while (open.length && n++ < 20000) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, x, y] = open.splice(bi, 1)[0];
      if (x === t[0] && y === t[1]) { const out = [[tx, ty]]; let k = idx(x, y); while (from.has(k)) { k = from.get(k); out.unshift([(k % W) * CELL + 2, Math.floor(k / W) * CELL + 2]); } out.shift(); return smooth(ok, sx, sy, out); }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy; if (!can(nx, ny) || (dx && dy && (!can(x + dx, y) || !can(x, y + dy)))) continue;
        if (!ok((x + dx / 3) * CELL + 2, (y + dy / 3) * CELL + 2) || !ok((x + dx * 2 / 3) * CELL + 2, (y + dy * 2 / 3) * CELL + 2)) continue; // 两格之间也要走得通（细的栅栏比一格还窄）
        const ng = g.get(idx(x, y)) + (dx && dy ? 1.414 : 1), k = idx(nx, ny);
        if (ng < (g.get(k) ?? 1e9)) { g.set(k, ng); from.set(k, idx(x, y)); open.push([ng + Math.hypot(t[0] - nx, t[1] - ny), nx, ny]); }
      }
    }
    return null;
  }
  function smooth(ok, sx, sy, pts) { // 看得见就直走
    const clear = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2); for (let i = 1; i < n; i++) { const t = i / n; if (!ok(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; } return true; };
    const out = []; let cur = [sx, sy], i = 0;
    while (i < pts.length) { let j = pts.length - 1; while (j > i && !clear(cur, pts[j])) j--; out.push(pts[j]); cur = pts[j]; i = j + 1; }
    return out;
  }
  const walker = { key: '', path: null, t: 0, lx: 0, ly: 0, still: 0 };
  /* 往 (x,y) 走一帧；到了返回 true */
  function walkTo(cap, ok, x, y, near = 3) {
    if (Math.hypot(x - cap.x, y - cap.y) <= near) { walker.path = null; return true; }
    const key = Math.round(x) + ',' + Math.round(y);
    walker.t -= 1 / 60;
    if (walker.key !== key || !walker.path || walker.t <= 0 || walker.still > 0.4) { walker.key = key; walker.path = findPath(ok, cap.x, cap.y, x, y) || [[x, y]]; walker.t = 1.5; walker.still = 0; }
    let w = walker.path[0]; while (w && Math.hypot(w[0] - cap.x, w[1] - cap.y) < 2.5 && walker.path.length > 1) { walker.path.shift(); w = walker.path[0]; }
    const dx = w[0] - cap.x, dy = w[1] - cap.y;
    if (dx > 1.2) I.held.add('KeyD'); if (dx < -1.2) I.held.add('KeyA'); if (dy > 1.2) I.held.add('KeyS'); if (dy < -1.2) I.held.add('KeyW');
    if (Math.hypot(cap.x - walker.lx, cap.y - walker.ly) < 0.05) walker.still += 1 / 60; else walker.still = 0;
    walker.lx = cap.x; walker.ly = cap.y;
    return false;
  }

  /* ---------------- 各场景 ---------------- */
  const B = {};
  B.title = function () {
    const b = btn('重新开始') || btn('开始'); if (!b) return idle('标题上没有按钮');
    say('开新的一局'); clickBtn(b, 1.4); then(() => { Demo.run++; Demo.runT0 = Demo.t; Demo.ending = false; Demo.beastDay = 0; log('run', `第 ${Demo.run} 局开始`); });
  };
  B.pause = function () {
    const b = Demo.ending ? btn('存档并回到标题') : btn('继续'); if (b) clickBtn(b, 0.8); else idle('暂停菜单里没有能点的');
  };

  /* 大地图：照目标箭头飞；头顶出现目标的「E」就按 E；被盯上快追上了扔货 */
  let throwCD = 0, chaseSeen = null;
  B.map = function (sc, dt) {
    const st = Game.st, sea = Game.sea; throwCD -= dt;
    if (sc.battle) return B.battle(sc.battle);
    if (sc.modal) return mapModal(sc);
    const gl = sc.goalNow; if (!gl) return idle('地图上没有目标');
    say(gl.text);
    // 被盯上：教学说扔就扔一箱；快追上了再扔
    if (sea.chase) {
      if (chaseSeen !== sea.chase) { chaseSeen = sea.chase; Demo.threw = false; log('chase', '被盯上', { cargo: S.cargoValue(sc.ship) }); }
      const c = sea.chase, told = hint('按 Q 扔一箱货') && !Demo.threw, late = c.t < 2.6 && !c.queue.some(d => !d.gone);
      if ((told || late) && throwCD <= 0 && S.nextThrow(sc.ship)) { tap('KeyQ'); throwCD = 1.1; Demo.threw = true; log('throw', '扔一箱货', { left: Math.round(c.t * 10) / 10 }); }
    }
    if (sc.salv && gl.kind === 'wreck') { const moving = Math.hypot(sea.vx, sea.vy) > 20; return waiting(moving ? '停船打捞' : '打捞中'); }
    if (gl.act && prompt(gl.act)) { if (gl.kind === 'town') Demo.buy = gl.buy ? { ...gl.buy, done: 0, town: gl.town.id } : null; tap('KeyE'); log('act', gl.act); return wait(0.2); }
    const dx = gl.x - sea.x, dy = gl.y - sea.y, d = Math.hypot(dx, dy);
    if (d < 18 && gl.kind !== 'safe') return idle('到了目标旁边，却没有「' + (gl.act || '') + '」的 E 提示');
    const ax = Math.abs(dx) > Math.max(8, Math.abs(dy) * 0.4), ay = Math.abs(dy) > Math.max(8, Math.abs(dx) * 0.4);
    if (ax) I.held.add(dx > 0 ? 'KeyD' : 'KeyA'); if (ay) I.held.add(dy > 0 ? 'KeyS' : 'KeyW');
    if (d > 420 && !sea.chase && !sc.opening) I.held.add('ShiftLeft'); // 远路按住 Shift 快进
  };
  function mapModal(sc) {
    const m = sc.modal, ship = sc.ship, ss = S.stats(ship);
    if (m.type === 'town') {
      const b = Demo.buy, row = b && btn('buy1:' + b.k);
      if (b && row && b.done < b.n) { say(`买${D.itemName(b.k)}（${b.done + 1}/${b.n}）`); clickBtn(row, b.done ? 0.25 : 0.7); b.done++; return; }
      const out = btn('离港（E）'); if (out) { say('离港'); Demo.buy = null; clickBtn(out, 0.6); return; }
      return idle('城镇里没有能点的');
    }
    if (m.type === 'caught') { const fight = ship.hp >= ss.hpMax * 0.6, b = btn(fight ? '开战' : '认栽'); say(fight ? '被追上了：开战' : '被追上了：认栽'); if (b) { log('caught', b.label, { hp: ship.hp }); clickBtn(b, 1.2); } return; }
    if (m.type === 'yield') { const b = btn('交出这些，让它走'); if (b) { say('交出挑好的货'); clickBtn(b, 1.2); } else idle('认栽：凑不够 20%，交不出去'); return; }
    idle('地图上的弹窗不认识：' + m.type);
  }

  /* 就地开打的横版战斗：自动开火，躲飞来的子弹、对准敌船那一行；箱子飞出来就去接；技能满了按 E；打完点「继续航行」 */
  B.battle = function (b) {
    if (b.phase === 'panel') { const c = btn('继续航行'); say('战后面板：继续航行'); if (c) { log('battle', '打完', { loot: b.loot.length, hp: Math.round(b.ship.hp), hits: b.hits, kills: b.stats.kills, caught: b.stats.caught, lost: b.stats.lost, secs: Math.round(b.tFight) }); clickBtn(c, 1.6); } return; }
    if (b.phase === 'down') { const c = btn('就留这件'); say('被击落：留最值钱的那件'); if (c) { log('down', '被击落'); clickBtn(c, 1.8); } return; }
    if (b.phase !== 'fight' && b.phase !== 'clear') return waiting(b.phase === 'in' ? '镜头推近' : b.phase === 'out' ? '穿云，镜头拉回' : '被击落');
    say(b.phase === 'clear' ? '接箱子' : '躲子弹，对准敌船');
    const k = G.Test.battleKeys(); if (!k) return waiting('战斗');
    for (const c of k.keys) I.held.add(c);
    if (k.dash) I.tap.add('Space');
    if (k.skill) I.tap.add('KeyE');
  };

  /* 空岛：照底下的提示走去那个建筑，按 E；弹窗按里面的按钮 */
  B.island = function (sc) {
    if (sc.arrive || sc.launch) return waiting(sc.arrive ? '回家卸货' : '出航');
    if (sc.modal) return islandModal(sc);
    const st = Game.st;
    const over = FIXED_DAYS ? st.day > FIXED_DAYS : st.day > MAX_DAYS || (Demo.beastDay && st.day > Demo.beastDay);
    if (over) { say('这一局玩完了：回标题开下一局'); Demo.ending = true; tap('Escape', 1.5); return; }
    const gl = sc.goalNow; if (!gl) return idle('空岛上没有提示');
    say(gl.text);
    const spot = G.Island.SPOTS.find(s => s.id === gl.spot); if (!spot) return idle('提示没说去哪');
    if (prompt(spot.label)) { tap('KeyE', 0.3); log('act', spot.label); return; }
    walkTo(sc.cap, G.Island.okDay, spot.x, spot.y, 3);
  };
  function islandModal(sc) {
    const st = Game.st, m = sc.modal;
    if (m.type === 'board') {
      const b = st.board;
      if (!b.accepted && b.orders.length) { // 订单没交上不罚：接一张，先接仓库里货已经够的
        const have = o => Object.entries(o.need).every(([k, n]) => st.warehouse.filter(i => i.k === k).length >= n);
        const i = Math.max(0, b.orders.findIndex(have)), ob = btn('order:' + i);
        if (ob) { say('接下大客户订单'); clickBtn(ob, 1.6); return; }
      }
      const c = btn('关上（E）'); if (c) { say('看完告示板'); clickBtn(c, 1.4); } return;
    }
    if (m.type === 'store') { const c = btn('关上（E）'); if (c) clickBtn(c, 1); return; }
    if (m.type === 'sleep') { const c = btn('睡觉'); if (c) { say('睡觉'); clickBtn(c, 1); } return; }
    if (m.type === 'prep') { const o = btn('敲铃开市'); if (o) { say('摆好摊，敲铃开市'); clickBtn(o, 1.6); return; } const c = btn('先不开（E）'); if (c) { log('idle', '开不了市'); clickBtn(c, 1); } return; }
    idle('空岛弹窗不认识：' + m.type);
  }

  /* 船坞：新手按提示把模块一件件装上；之后照底下那行建议：建议造驮兽才造，有红项或建议补模块就「一键装好」，再「出航」 */
  B.dock = function (sc) {
    const st = Game.st, ship = S.ship(st), ss = S.stats(ship), L = sc.layout();
    if (st.flags.tut === 'dock') {
      say('把模块装回木筏');
      const fits = (m, g) => D.MODULES[m.type].slots.includes(g);
      if (sc.hand) { const box = L.boxes.find(b => !ship.slots[b.g][b.i] && fits(sc.hand, b.g)); if (!box) return idle('手里的模块没地方装'); clickAt(box.x + 10, box.y + 10, 0.25); return; }
      const groups = []; for (const t of D.MOD_ORDER) for (let qq = 2; qq >= 0; qq--) { const ms = st.modules.filter(m => m.type === t && m.q === qq); if (ms.length) groups.push({ t, m: ms[ms.length - 1] }); }
      const gi = groups.findIndex(gr => L.boxes.some(b => !ship.slots[b.g][b.i] && fits(gr.m, b.g)));
      if (gi < 0) return idle('教学：模块装不上了');
      const x = 8 + 8 + gi * 34 + 15, y = 276 + 20 + 15; wait(0.35); Q.push({ t: 'move', x, y }, { t: 'wait', s: 0.1 }, { t: 'press' }, { t: 'release' }, { t: 'wait', s: 0.1 });
      return;
    }
    // 照底下那行建议做：建议造驮兽才造；有红项或建议补模块就「一键装好」（同一艘船一天只点一次，点了还红就是卡住）
    const beast = btn('beast');
    if (beast && hint('可以造驮兽货船')) { say('钱够了：造驮兽货船'); log('beast', '造驮兽货船', { gold: st.gold, mat: st.mat }); clickBtn(beast, 1.2); return; }
    const fit = btn('autofit'), key = Demo.run + ':' + st.active + ':' + st.day + ':' + st.ships.length;
    if (fit && Demo.fitFor !== key && (ss.red.length || hint('一键装好'))) { Demo.fitFor = key; say('一键装好'); clickBtn(fit, 1); return; }
    if (ss.red.length) return idle('出航检查有红项：' + ss.red.join('；'));
    const go = btn('出航'); if (go) { say('出航'); clickBtn(go, 1.2); return; }
    idle('船坞里没有能点的');
  };

  /* 夜市：看客人头上要什么，去那个摊位按 E 拿，回柜台按 E 递 */
  B.market = function (sc) {
    if (sc.card) { const b = btn(x => x.label.startsWith('睡觉')); say('打烊：睡觉'); if (b) { log('night', '打烊', { income: sc.card.income, served: sc.res.served, left: sc.res.left, secs: Math.round(sc.t), idle: Math.round(Demo.nightIdle || 0), firstIdle: Math.round((Demo.firstIdle || 0) * 10) / 10 }); clickBtn(b, 2.5); } return; }
    if (sc.busy > 0) return waiting('拿货');
    const MK = G.Market, ok = MK.okNight, C = MK.COUNTER, cap = sc.cap;
    const big = sc.custs.find(c => c.big && c.state === 'queue');
    if (sc.carry.length || (big && sc.order)) {
      say(sc.carry.length ? `递货（${sc.carry.length} 单）` : '把订单的货交给大客户');
      if (promptStarts('递货') || prompt('把订单的货交给大客户')) { if (prompt('把订单的货交给大客户')) log('order', '交订单'); tap('KeyE'); return; }
      walkTo(cap, ok, C.x, C.y, 3); return;
    }
    const first = sc.custs.filter(c => c.state === 'queue' && !c.big && c.want).sort((a, b) => a.t0 - b.t0)[0];
    if (first) {
      const s = sc.stalls.find(s => s.k === first.want); if (!s) return idle('客人要的货没有摊位');
      say(`去拿${D.GOODS[s.k].name}`);
      if (sc.nearStall() === s && promptStarts('拿' + D.GOODS[s.k].name)) { tap('KeyE'); return; }
      walkTo(cap, ok, s.x, s.y, 3); return;
    }
    say('等客人'); if (!walkTo(cap, ok, C.x, C.y, 3)) return; idle('等客人');
  };

  /* ---------------- 每帧 ---------------- */
  let lastScene = '', lastDay = 0, lastSig = '', stuckT = 0;
  function sig() {
    const st = Game.st, sc = Game.scene, n = Game.sceneName; if (!st || !sc) return n;
    const sh = S.ship(st), a = [n, st.day, st.phase, st.flags.tut, st.gold, st.mat, sh.hold.length, sh.deck.length, st.warehouse.length, st.modules.length, Math.round(sh.hp), Game.paused];
    if (n === 'map' && Game.sea) a.push(Math.round(Game.sea.x / 24), Math.round(Game.sea.y / 24), sc.modal && sc.modal.type, sc.salv ? sc.salv.w.items.length : -1, Game.sea.chase ? 1 : 0);
    if (n === 'island') a.push(Math.round(sc.cap.x / 6), Math.round(sc.cap.y / 6), sc.modal && sc.modal.type, !!sc.arrive);
    if (n === 'market') a.push(Math.round(sc.cap.x / 6), Math.round(sc.cap.y / 6), sc.res.served, sc.res.left, sc.custs.length, sc.carry.length, !!sc.card);
    if (n === 'map' && sc.battle) { const b = sc.battle; a.push(b.phase, b.en.length, Math.round(b.en.reduce((s, e) => s + e.hp, 0)), b.wave, b.crates.length, Math.round(b.pl.x / 8), Math.round(b.pl.y / 8)); }
    if (n === 'dock') a.push(S.allMods(sh).length, !!sc.hand, st.ships.length, st.active);
    return a.join('|');
  }
  function think(dt) {
    I.held.clear(); idleWhy = null; waitWhy = null;
    if (runQueue(dt)) return;
    if (Game.fade) return waiting('转场');
    if (Game.paused) return B.pause();
    const f = B[Game.sceneName]; if (f) f(Game.scene, dt); else idle('不认识的场景');
  }
  function track(dt) {
    Demo.t += dt;
    const n = Game.sceneName, st = Game.st;
    if (n !== lastScene) { log('scene', `${lastScene || '—'} → ${n}`); lastScene = n; }
    if (st && st.day !== lastDay) { if (lastDay && st.day > lastDay) log('day', `第 ${st.day} 天`, { gold: st.gold, mat: st.mat, rep: st.rep, stars: st.stars }); lastDay = st.day; }
    if (n === 'map' && st && !Demo.beastDay && S.ship(st).hull === 'beast') { Demo.beastDay = st.day; log('beast', '第一次开驮兽货船出航'); }
    if (idleWhy) { const k = n + '：' + idleWhy; Demo.idle[k] = (Demo.idle[k] || 0) + dt; }
    if (n === 'market') { const sc = Game.scene; if (sc.t < 0.1) { Demo.nightIdle = 0; Demo.firstIdle = 0; } if (idleWhy) { Demo.nightIdle += dt; if (!sc.res.served) Demo.firstIdle += dt; } }
    // 卡住：12 秒里什么都没变
    const s = sig(); if (s !== lastSig) { lastSig = s; stuckT = 0; } else stuckT += dt;
    if (stuckT > 12) { stuckT = 0; log('stuck', '12 秒没有进展', { doing: Demo.doing, idle: idleWhy, wait: waitWhy, hints: UI.seen.hints, prompts: UI.seen.prompts.map(p => p.label), buttons: UI.seen.buttons.filter(b => !b.disabled).map(b => b.label), sig: s }); }
    if (n === 'title' && Demo.ending) { Demo.ending = false; const r = { run: Demo.run, secs: Math.round(Demo.t - (Demo.runT0 || 0)), days: st ? st.day - 1 : 0, gold: st ? st.gold : 0, mat: st ? st.mat : 0, stars: st ? st.stars : 0, beast: Demo.beastDay || 0 }; Demo.runs.push(r); log('run', `第 ${Demo.run} 局结束`, r); }
  }
  Game.hook = function (dt) {
    if (!Demo.on) return;
    try { think(dt); } catch (e) { Q.length = 0; I.held.clear(); if (!Demo.err) { Demo.err = String(e.stack || e); log('error', '机器人出错：' + e.message); } }
    push(); track(dt); cursor();
  };

  /* ---------------- 页面：点一下开始、Esc 停、角落的小牌子、机器人的鼠标 ---------------- */
  let tag, arrow, cover;
  function cursor() {
    if (!arrow) return; const v = Game.view, dpr = window.devicePixelRatio || 1;
    arrow.style.transform = `translate(${(v.ox + I.mx * v.k) / dpr}px, ${(v.oy + I.my * v.k) / dpr}px)`;
    tag.textContent = `自动演示 · 第 ${Math.max(1, Demo.run)} 局 · 按 Esc 停`;
  }
  function start() {
    if (Demo.on || Demo.stopped) return;
    G.Sfx && G.Sfx.unlock();
    Demo.on = true; cover.remove(); arrow.style.display = 'block'; tag.style.display = 'block';
    log('start', '开始自动演示');
  }
  function stop() {
    Demo.on = false; Demo.stopped = true; Q.length = 0; releaseAll(); arrow.style.display = 'none';
    tag.textContent = '演示停了：现在由你来玩（刷新页面重新演示）'; setTimeout(() => { tag.style.display = 'none'; }, 5000);
    log('stop', '按了 Esc');
  }
  // 演示时挡住真键盘和真鼠标（除了 Esc），免得和机器人抢
  const guard = e => {
    if (!Demo.on) return;
    if (e.type === 'keydown' && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stop(); return; }
    e.stopImmediatePropagation(); if (e.type.startsWith('key')) e.preventDefault();
  };
  for (const ev of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'contextmenu']) addEventListener(ev, guard, true);
  addEventListener('load', () => {
    const css = document.createElement('style');
    css.textContent = `#demoCover{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(8,6,10,.55);color:#f0d38a;font:600 22px "PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.08em;cursor:pointer;z-index:5;text-align:center;padding:0 16px}
#demoCover small{font-size:14px;font-weight:400;color:#ece6da;letter-spacing:.02em}
#demoTag{position:fixed;left:10px;bottom:8px;padding:4px 10px;border:1px solid #c8963e;border-radius:4px;background:rgba(24,18,14,.82);color:#f0d38a;font:12px "PingFang SC","Microsoft YaHei",sans-serif;z-index:4;display:none;pointer-events:none}
#demoArrow{position:fixed;left:0;top:0;width:18px;height:24px;z-index:3;display:none;pointer-events:none}`;
    document.head.appendChild(css);
    cover = document.createElement('div'); cover.id = 'demoCover';
    cover.innerHTML = `<div>点一下，开始自动演示</div><small>机器人从标题开始自己玩：一局从开场的木筏玩到第一次开驮兽货船回家开完夜市（最多 ${FIXED_DAYS || MAX_DAYS} 天），玩完接着开下一局。按 Esc 停。</small>`;
    tag = document.createElement('div'); tag.id = 'demoTag';
    arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arrow.id = 'demoArrow'; arrow.setAttribute('viewBox', '0 0 18 24');
    arrow.innerHTML = '<path d="M1 1 L1 19 L6 14 L9.5 22 L12.5 20.6 L9 13 L16 13 Z" fill="#fff8e0" stroke="#1b1209" stroke-width="1.5" stroke-linejoin="round"/>';
    document.body.append(cover, tag, arrow);
    cover.addEventListener('click', start);
  });
})(window.G);
