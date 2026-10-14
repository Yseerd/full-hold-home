/* 大地图：自由飞、热度、被盯上和扔货、城镇进货、巡逻船、残骸、回家。侧面船只左右翻转，不旋转。
   开战不切场景：就在这里推近镜头打横版战斗（game/battle.js），打完船还在开打前的位置。 */
(function (G) {
  'use strict';
  const D = G.D, S = G.S, U = G.U, A = G.Art, In = G.In, Game = G.Game, M = D.MAP;
  const sc = { cam: { x: 0, y: 0 } };
  const R = U.R;
  const regionAt = x => x < M.borderX ? 'inner' : 'border';
  const DOCK = { dx: 96, dy: -4 }; // 空岛码头相对岛中心
  const homeDock = () => ({ x: M.home.x + DOCK.dx, y: M.home.y + DOCK.dy });
  const safeAt = (x, y) => U.dist(x, y, M.home.x, M.home.y) < M.safeR + 60 || M.towns.some(t => U.dist(x, y, t.x, t.y) < M.safeR);

  sc.enter = function (p = {}) {
    const st = this.st = Game.st; st.phase = 'sea';
    this.ship = S.ship(st); this.SP = G.SPR.map;
    const sea = Game.sea || (Game.sea = {});
    this.opening = !!p.opening;
    if (p.opening) Object.assign(sea, { x: 1240, y: 930, vx: -20, vy: 0, face: -1, drops: [], chase: null, cool: 0, t: 0 });
    else if (p.launch) { const d = homeDock(); Object.assign(sea, { x: d.x + 70, y: d.y - 16, vx: 40, vy: 0, face: 1, drops: [], chase: null, cool: 12, t: 0 }); st.log.voyages++; }
    else if (p.resume && st.mapPos) Object.assign(sea, { x: st.mapPos.x, y: st.mapPos.y, vx: 0, vy: 0, face: 1, drops: [], chase: null, cool: 8, t: 0 });
    if (!(p.opening || p.launch || (p.resume && st.mapPos)) && sea.x == null) { const d = homeDock(); Object.assign(sea, { x: d.x + 70, y: d.y - 16 }); }
    for (const [k, v] of Object.entries({ vx: 0, vy: 0, face: 1, drops: [], chase: null, cool: 8, t: 0 })) if (sea[k] == null) sea[k] = v;
    this.sea = sea; this.modal = null; this.salv = null; this.ff = false; this.plan = null; this.goalNow = null; this.battle = null; this.towNext = false;
    this.steam = A.Pool(); this.fire = A.Pool(); this.wake = A.Pool(); this.red = A.Pool(); this.sparks = A.Pool();
    this.lastTier = S.stats(this.ship).tier; this.dip = 0; this.saveT = 0; this.alarmT = 0;
    this.script = p.opening ? { t: 0, stage: 0 } : null;
    if (p.after) this.afterBattle(p.after);
    this.snapCam();
    G.Sfx.hum(true, 1);
    Game.save();
    if (p.resume && st.battle) G.Battle.resume(this); // 上次在仗里退出：10 秒内重开这一场，否则按被击落算
  };
  sc.exit = function () { G.Sfx.hum(false); this.battle = null; this.st.mapPos = { x: this.sea.x, y: this.sea.y }; };
  sc.snapCam = function () { this.cam.x = U.clamp(this.sea.x - 320, 0, M.w - 640); this.cam.y = U.clamp(this.sea.y - 190, 0, M.h - 360); };

  /* 打完了（穿云遮满的那一刻）：打赢了就把那艘巡逻船 / 追兵从地图上拿掉 */
  sc.afterBattle = function (r) {
    const W = this.st.world;
    if (r.won) {
      if (r.patrolId) { const p = W.patrols.find(q => q.id === r.patrolId); if (p) { p.alive = false; if (p.kind === 'guard' && W.sunk) { W.sunk.guardBeaten = true; UI_toast('守货的海盗被打跑了：停在沉船旁边就能捞'); } } }
      if (r.chase) this.sea.chase = null;
    }
    this.sea.cool = 15;
  };
  const UI_toast = (t, c) => G.UI.toast(t, c);

  /* ---------------- 每帧 ---------------- */
  sc.update = function (dt) {
    const st = this.st, sea = this.sea, ship = this.ship, ss = S.stats(ship);
    if (this.towNext) { this.towNext = false; Game.go('island', { towed: true }, { fade: 0.4 }); return; }
    if (this.battle) { this.battle.update(dt); return; } // 就地开打：这时候大地图停住，战斗自己走
    if (this.modal) { this.updateModal(dt); return; }
    sea.t += dt; this.saveT += dt; if (this.saveT > 5) { this.saveT = 0; st.mapPos = { x: sea.x, y: sea.y }; Game.save(); }
    const region = regionAt(sea.x);
    /* 快进：去过的航段按住 Shift 3 倍速；被盯上、在捞残骸、靠近目标时不行 */
    const near = this.nearest();
    const canFF = !sea.chase && !this.salv && !this.opening && (!near || near.d > 170);
    this.ff = canFF && (In.key('ShiftLeft') || In.key('ShiftRight'));
    const k = this.ff ? 3 : 1, tdt = dt * k;
    /* 开船：带一点惯性，越重起步越慢 */
    const ax = In.axis(), len = Math.hypot(ax.x, ax.y) || 1, sp = M.speed * D.TIERS[ss.tier].map * k;
    const tx = ax.x / len * sp, ty = ax.y / len * sp * 0.85, acc = (1.6 + 1.4 * U.clamp(ss.twr - 0.6, 0, 1)) * dt;
    sea.vx += (tx - sea.vx) * Math.min(1, acc * (ax.x ? 1 : 0.8)); sea.vy += (ty - sea.vy) * Math.min(1, acc * (ax.y ? 1 : 0.8));
    sea.x = U.clamp(sea.x + sea.vx * dt, 60, M.w - 60); sea.y = U.clamp(sea.y + sea.vy * dt, 60, M.h - 40);
    if (sea.vx < -6) sea.face = -1; else if (sea.vx > 6) sea.face = 1;
    G.Sfx.hum(true, 0.8 + 0.25 * ss.tier + (this.ff ? 0.4 : 0));
    /* 速度档变了：掉档时船身往下一沉，一声闷响 */
    if (ss.tier !== this.lastTier) { const down = ss.tier < this.lastTier; G.UI.float(sea.x, sea.y - 40, `速度档 ${D.TIERS[this.lastTier].name} → ${D.TIERS[ss.tier].name}`, down ? '#ffb08a' : '#b8f0a0', { world: true, life: 1.6 }); if (down) { this.dip = 1; G.Sfx.play('thud'); } else G.Sfx.play('pick'); this.lastTier = ss.tier; }
    this.dip = Math.max(0, this.dip - dt * 2.2);
    /* 粒子：蒸汽、热度火苗、航迹（越满越粗） */
    this.particles(dt, ss);
    /* 巡逻船慢慢绕着锚点转 */
    for (const p of st.world.patrols) { if (!p.alive) continue; p.t += dt * 0.12; const nx = p.ax + Math.cos(p.t) * 70, ny = p.ay + Math.sin(p.t * 1.3) * 26; p.face = nx < p.x ? -1 : 1; p.x = nx; p.y = ny; }
    /* 扔出去的箱子往下掉，落到云上漂着 */
    for (const d of sea.drops) { if (d.fall > 0) { d.fall -= dt; d.y += d.vy * dt; d.vy += 140 * dt; d.x += d.vx * dt; } d.t = (d.t || 0) + dt; }
    sea.drops = sea.drops.filter(d => !d.gone && d.t < 30);
    /* 捞残骸：停在旁边，每 4 秒捞 1 箱 */
    this.updateSalvage(dt);
    /* 扔货：按住 Q 一箱一箱往外扔 */
    this.throwT = (this.throwT || 0) - dt;
    if (In.key('KeyQ') && this.throwT <= 0) this.throwOne();
    /* 被盯上 */
    if (this.script) this.updateScript(dt);
    this.updateChase(tdt, dt, ss, region);
    if (!sea.chase && !this.opening) this.rollTarget(tdt, ss, region);
    this.goalNow = this.goal();
    /* 互动 */
    if (In.hit('KeyE') && near && near.d < near.r) { In.consume('KeyE'); this.interact(near); }
    if (In.hit('KeyE') && this.salv && (!near || near.kind !== 'wreck')) this.salv = null;
    /* 镜头：跟着船，往前看一点 */
    const cx = U.clamp(sea.x - 320 + sea.vx * 0.6, 0, M.w - 640), cy = U.clamp(sea.y - 190 + sea.vy * 0.5, 0, M.h - 360);
    this.cam.x += (cx - this.cam.x) * Math.min(1, dt * 4); this.cam.y += (cy - this.cam.y) * Math.min(1, dt * 4);
  };

  sc.particles = function (dt, ss) {
    const sea = this.sea, Sp = this.SP.ships[this.ship.hull], o = this.shipOrigin(), f = 60 * dt;
    const ch = { x: o.x + (sea.face < 0 ? Sp.w - Sp.chim.x : Sp.chim.x), y: o.y + Sp.chim.y };
    if (R() < 0.35 * f) this.steam.add({ x: ch.x, y: ch.y - 1, vx: -sea.face * 6 - sea.vx * 0.2, vy: -9, r: 0.8, age: 0, life: 1.6 });
    const heat = S.heat(this.ship);
    if (heat > 0 && R() < heat * 0.28 * f) this.fire.add({ x: ch.x + (R() - 0.5) * 3, y: ch.y, vx: -sea.face * 5 + (R() - 0.5) * 6, vy: -12 - R() * 8, age: 0, life: 0.5 + heat * 0.12 });
    const sp = Math.hypot(sea.vx, sea.vy), load = (this.ship.hold.length + this.ship.deck.length) / Math.max(1, ss.holdCap + ss.deckCap);
    if (sp > 10 && R() < 0.5 * f) { const sx = o.x + (sea.face > 0 ? 10 : Sp.w - 10), sy = o.y + Sp.hullBottom - 6; this.wake.add({ x: sx, y: sy + (R() - 0.5) * 4, vx: -sea.vx * 0.15, vy: 2, r: 1 + load * 2.2, age: 0, life: 1.1 + load * 0.6 }); }
    this.steam.step(dt); this.fire.step(dt); this.wake.step(dt); this.red.step(dt); this.sparks.step(dt);
  };
  sc.loadOff = function () { const ss = S.stats(this.ship), load = (this.ship.hold.length + this.ship.deck.length) / Math.max(1, ss.holdCap + ss.deckCap); return this.dip * 4 + load * 5; }; // 越满飞得越低
  sc.shipOrigin = function () { const Sp = this.SP.ships[this.ship.hull]; return { x: G.Px.s(this.sea.x - Sp.w / 2), y: G.Px.s(this.sea.y - Sp.h / 2 + this.loadOff()) }; }; // 位置对齐到物理像素，船一帧一帧匀速地走（view.js）

  /* 附近能按 E 的东西 */
  sc.nearest = function () {
    const sea = this.sea, st = this.st, out = [];
    const hd = homeDock(); out.push({ kind: 'home', x: hd.x, y: hd.y, d: U.dist(sea.x, sea.y, hd.x, hd.y), r: 92, label: '进港回家' });
    if (!this.opening) {
      for (const t of M.towns) out.push({ kind: 'town', town: t, x: t.x, y: t.y, d: U.dist(sea.x, sea.y, t.x, t.y), r: 125, label: '靠港 · ' + t.name });
      for (const p of st.world.patrols) if (p.alive) out.push({ kind: 'patrol', p, x: p.x, y: p.y, d: U.dist(sea.x, sea.y, p.x, p.y), r: 78, label: p.kind === 'guard' ? '开战 · 守货的海盗' : p.kind === 'scooper' ? '开战 · 抢你货的海盗' : '开战 · 海盗巡逻船' });
      for (const w of st.world.wrecks) if (w.items.length) out.push({ kind: 'wreck', w, x: w.x, y: w.y, d: U.dist(sea.x, sea.y, w.x, w.y), r: 64, label: this.salv && this.salv.w === w ? '停止打捞' : '打捞残骸' });
      const sk = st.world.sunk; if (sk && sk.guardBeaten && sk.items.length) out.push({ kind: 'wreck', w: sk, sunk: true, x: sk.x, y: sk.y, d: U.dist(sea.x, sea.y, sk.x, sk.y), r: 64, label: this.salv && this.salv.w === sk ? '停止打捞' : '打捞沉货' });
    }
    out.sort((a, b) => a.d / a.r - b.d / b.r);
    return out[0] || null;
  };

  sc.interact = function (n) {
    const st = this.st;
    if (this.sea.chase && n.kind !== 'home') { G.UI.toast('被盯上了，先甩掉它', '#ffb0a0'); G.Sfx.play('deny'); return; }
    if (n.kind === 'home') { if (this.sea.chase && !this.opening) { G.UI.toast('还被盯着：先进安全圈甩掉它', '#ffb0a0'); return; } this.salv = null; Game.go('island', { arrive: true }, { fade: 0.45 }); return; }
    if (n.kind === 'town') { this.modal = { type: 'town', town: n.town }; G.Sfx.play('click'); Game.save(); return; }
    if (n.kind === 'patrol') { this.startBattle({ kind: n.p.kind === 'guard' ? 'guard' : 'patrol', patrolId: n.p.id, cargo: n.p.cargo, region: n.p.r }); return; }
    if (n.kind === 'wreck') { if (this.salv && this.salv.w === n.w) { this.salv = null; return; } this.salv = { w: n.w, t: 0, sunk: !!n.sunk }; G.Sfx.play('click'); }
  };
  /* 开战：不切场景，镜头就地推近打横版战斗（game/battle.js）；打完镜头拉回，船还在这里 */
  sc.startBattle = function (b) {
    this.salv = null; this.modal = null; this.ff = false;
    this.battle = G.Battle.create(this, b);
  };
  sc.inBattle = function () { return !!(this.battle && this.battle.inBattle()); };

  sc.updateSalvage = function (dt) {
    const s = this.salv; if (!s) return;
    const sea = this.sea, d = U.dist(sea.x, sea.y, s.w.x, s.w.y);
    if (d > 80) { this.salv = null; G.UI.toast('离开了残骸'); return; }
    if (Math.hypot(sea.vx, sea.vy) > 22) { s.t = Math.max(0, s.t - dt); return; } // 要停下来才捞得动
    s.t += dt; const need = s.sunk ? 2 : 4;
    if (s.t >= need) {
      s.t = 0; const it = s.w.items[0]; if (!it) { this.salv = null; return; }
      const where = S.addCargo(this.ship, it);
      if (!where) { G.UI.toast('货舱和甲板都满了，捞不起来', '#ffb0a0'); G.Sfx.play('deny'); this.salv = null; return; }
      s.w.items.shift(); this.st.log.crates++;
      G.UI.float(sea.x, sea.y - 34, `+1 ${D.itemName(it.k)}${where === 'deck' ? '（上甲板）' : ''}`, where === 'deck' ? '#ffd27a' : '#e8f0ff', { world: true });
      G.Sfx.play('catch');
      if (!s.w.items.length) { this.salv = null; G.UI.toast(s.sunk ? '沉货捞完了' : '残骸捞空了'); if (s.sunk) this.st.world.sunk = null; }
    }
  };

  /* 扔一箱：海盗停下来捞，每扔基础价 50 金的货，追的计时 +1 秒 */
  sc.throwOne = function () {
    const ship = this.ship, nx = S.nextThrow(ship);
    if (!nx) { if (In.hit('KeyQ')) { G.UI.toast('没有能扔的货箱'); G.Sfx.play('deny'); } return; }
    const wasFull = S.holdFull(ship);
    const it = (nx.where === 'deck' ? ship.deck : ship.hold).splice(nx.i, 1)[0];
    if (nx.where === 'hold' && wasFull) G.UI.toast('舱不满了：满舱和冒尖都没了', '#ffb0a0');
    this.throwT = 0.38; G.Sfx.play('throw');
    const o = this.shipOrigin(), Sp = this.SP.ships[ship.hull], sea = this.sea;
    const sternX = sea.face < 0 ? o.x + Sp.w - 14 : o.x + 14; // 从船尾往后抛
    const drop = { x: sternX, y: o.y + Sp.parts.cargo.y, vx: -sea.face * 46 + sea.vx * 0.2, vy: -34, fall: 0.6, item: it };
    sea.drops.push(drop);
    const secs = D.baseValue(it) / 50;
    if (sea.chase) { sea.chase.t += secs; sea.chase.queue.push(drop); G.UI.float(sea.x, sea.y - 46, `追兵 +${secs.toFixed(1)} 秒`, '#ffd27a', { world: true }); }
    else G.UI.float(sea.x, sea.y - 46, `扔掉 1 箱${D.itemName(it.k)}`, '#d8d0c4', { world: true });
  };

  /* 平均多久被盯上一次（按热度和区域），快进时也按 3 倍走 */
  sc.rollTarget = function (tdt, ss, region) {
    const sea = this.sea; sea.cool = Math.max(0, sea.cool - tdt);
    if (sea.cool > 0 || safeAt(sea.x, sea.y)) return;
    const heat = S.heat(this.ship), mean = D.TARGET_MEAN[region][heat] * D.SLICE_TIME; if (!mean) return;
    const rate = (this.salv ? 2 : 1) / mean;
    if (R() < rate * tdt) this.spawnChaser(12, region);
  };
  sc.spawnChaser = function (T, region) {
    const sea = this.sea, ang = Math.atan2(-sea.vy || 0.01, -(sea.vx || sea.face * 10)) + (R() - 0.5) * 0.8;
    sea.chase = { x: sea.x + Math.cos(ang) * 340, y: sea.y + Math.sin(ang) * 220, t: T, T, queue: [], cargo: [], face: 1, region, scoopT: 0 };
    this.ff = false; G.Sfx.play('alarm'); this.alarmT = 1.2;
    G.UI.toast('海盗盯上你了！按住 Q 扔货拖住它，飞进安全圈或比它快就能甩掉', '#ffb0a0', 4);
  };
  sc.updateChase = function (tdt, dt, ss, region) {
    const sea = this.sea, c = sea.chase; if (!c) return;
    this.alarmT = Math.max(0, this.alarmT - dt);
    /* 甩掉：速度档比它高（海盗是「中」），或者进了安全圈 */
    const escaped = ss.tier > 1 ? '比它快，甩掉了！' : safeAt(sea.x, sea.y) ? '进了安全圈，海盗放弃了' : null;
    if (escaped) { this.endChase(escaped); return; }
    c.t -= tdt * (this.salv ? 2 : 1);
    // 先去捞扔下的货，捞完再追。追的时候守在你身后，计时越少贴得越近：一眼看出还剩多久
    const target = c.queue.find(d => !d.gone && d.fall <= 0);
    const side = c.x >= sea.x ? 1 : -1, want = 92 + 250 * U.clamp(c.t / c.T, 0, 1.4);
    let gx = sea.x + side * want, gy = sea.y + (c.y > sea.y ? 8 : -8);
    if (target) { gx = target.x; gy = target.y - 10; }
    const d = U.dist(c.x, c.y, gx, gy), spd = target ? 120 : 150;
    if (d > 2) { c.x += (gx - c.x) / d * Math.min(d, spd * tdt); c.y += (gy - c.y) / d * Math.min(d, spd * tdt); }
    c.face = target ? (target.x < c.x ? -1 : 1) : (sea.x < c.x ? -1 : 1);
    if (target && d < 14) { c.scoopT += tdt; if (c.scoopT > 0.5) { target.gone = true; c.cargo.push(target.item); c.scoopT = 0; G.Sfx.play('pick'); G.UI.float(c.x, c.y - 30, '海盗在捞货', '#ffd8cc', { world: true }); } } else c.scoopT = 0;
    if (R() < 0.6) this.red.add({ x: c.x - c.face * 52, y: c.y - 4 + (R() - 0.5) * 4, vx: -c.face * 24, vy: -2, r: 1.4, age: 0, life: 1.2 });
    if (c.t <= 0 && !target) this.caught();
  };
  sc.endChase = function (msg) {
    const sea = this.sea, c = sea.chase; sea.chase = null; sea.cool = 25; G.Sfx.play('win'); G.UI.toast(msg, '#b8f0a0');
    if (c.cargo.length) { // 捞了货的海盗停在原地，甲板上只有你扔的货；当天打掉它就能拿回来
      this.st.world.patrols.push({ id: 's' + Date.now(), x: c.x, y: c.y, ax: c.x, ay: c.y, r: c.region, cargo: c.cargo.concat([{ k: 'mat', sea: true }]), alive: true, kind: 'scooper', t: 0 });
      G.UI.toast('捞了你货的海盗停在原地：今天打掉它，货就回来', '#ffd27a', 4);
    }
    if (this.script && this.script.stage < 3) this.script.stage = 3;
  };
  sc.caught = function () {
    if (this.opening) { // 开场：不打仗，海盗抢走 1 箱就走
      const ship = this.ship, nx = S.nextThrow(ship); let msg = '海盗追上来，看你穷，骂了一声走了';
      if (nx) { const it = (nx.where === 'deck' ? ship.deck : ship.hold).splice(nx.i, 1)[0]; msg = `海盗追上来抢走了 1 箱${D.itemName(it.k)}`; }
      this.sea.chase = null; G.Sfx.play('hit'); G.UI.toast(msg, '#ffb0a0', 4); this.script.stage = 3; return;
    }
    this.modal = { type: 'caught' }; G.Sfx.play('alarm'); this.st.log.caught++;
  };

  /* ---------------- 开场 60 秒：堆满、被追、扔货、活着回家 ---------------- */
  sc.updateScript = function (dt) {
    const s = this.script; s.t += dt;
    if (s.stage === 0 && s.t > 1.4) { s.stage = 1; this.spawnChaser(7.5, 'inner'); }
    if (s.stage === 1 && this.ship.deck.length < 2) s.stage = 2;
  };

  /* ---------------- 弹窗：被追上二选一、认栽、城镇 ---------------- */
  sc.updateModal = function (dt) { /* 世界停住 */ };

  sc.leaveTown = function () { this.modal = null; Game.save(); };

  /* ---------------- 画 ---------------- */
  sc.draw = function (g, f) {
    if (this.battle && this.battle.draw(g, f)) return; // 战斗时由战斗来画（推近 / 拉回时它也借用下面的 drawWorld）
    const P = G.Px.s, cam = this.cam, sea = this.sea;
    this.drawWorld(g, f, cam.x, cam.y);
    { const o = this.shipOrigin(), k = G.Px.k, cx = P(cam.x), cy = P(cam.y); Game.debug.track = { scene: 'map', bg: [-cx * k, -cy * k], obj: [(o.x - cx) * k, (o.y - cy) * k] }; } // tools/smooth.mjs 量顺不顺用
    if (this.ff) { g.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 14; i++) { const y = (i * 53 + Math.floor(sea.t * 400) * 7) % 360, x = (i * 97 + Math.floor(sea.t * 30)) % 640; g.fillRect(x, y, 18, 1); } }
  };
  /* 画世界：镜头左上角在 (camX, camY)（世界坐标）。镜头只对齐到物理像素（view.js），不再取整到 640×360 的格子：云海一帧一帧匀速地挪。
     战斗推近和拉回时，外面套一层缩放来画（这时 G.Px.u 也跟着乘上缩放，见 battle.js 的 drawMapZoom） */
  sc.drawWorld = function (g, f, camX, camY) {
    const P = G.Px.s, cx = P(camX), cy = P(camY), sea = this.sea, SP = this.SP, st = this.st;
    this.drawSea(g, cx, cy);
    g.save(); g.translate(-cx, -cy);
    // 安全圈
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (const c of [{ x: M.home.x, y: M.home.y, r: M.safeR + 60 }, ...M.towns.map(t => ({ x: t.x, y: t.y, r: M.safeR }))]) { const n = Math.round(c.r / 7); for (let i = 0; i < n; i++) { if (i % 2) continue; const a = i / n * Math.PI * 2 + sea.t * 0.02; const x = c.x + Math.cos(a) * c.r, y = c.y + Math.sin(a) * c.r * 0.62; if (x < cx - 4 || x > cx + 644 || y < cy - 4 || y > cy + 364) continue; g.fillRect(Math.round(x), Math.round(y), 2, 1); } }
    for (const [x, y, i] of M.islets) { const im = SP.islets[i]; if (x + im.w < cx || x - im.w > cx + 640) continue; g.drawImage(im.img, Math.round(x - im.w / 2), P(y - im.h / 2 + Math.sin(sea.t * 0.5 + x) * 1.5)); }
    const home = SP.home; g.drawImage(home.img, Math.round(M.home.x - home.w / 2), Math.round(M.home.y - home.h / 2));
    for (const t of M.towns) { const im = SP.towns[t.spr]; g.drawImage(im.img, Math.round(t.x - im.w / 2), Math.round(t.y - im.h / 2)); }
    for (const w of st.world.wrecks) if (w.items.length) this.drawWreck(g, w, f);
    if (st.world.sunk && st.world.sunk.items.length) this.drawWreck(g, st.world.sunk, f, true);
    for (const d of sea.drops) if (!d.gone) { const im = SP.crates[d.item.k] || SP.crates.mat; g.drawImage(im.img, P(d.x - im.w / 2), P(d.y - im.h / 2 + (d.fall <= 0 ? Math.sin(d.t * 3) : 0))); }
    // 船按 y 排序
    const list = [];
    for (const p of st.world.patrols) if (p.alive) list.push({ y: p.y, draw: () => this.drawPirate(g, p, f, false) });
    if (sea.chase) list.push({ y: sea.chase.y, draw: () => this.drawPirate(g, sea.chase, f, true) });
    list.push({ y: sea.y, draw: () => this.drawPlayer(g, f) });
    list.sort((a, b) => a.y - b.y).forEach(o => o.draw());
    this.fire.each(p => A.R(g, A.FIRE[Math.min(3, (p.age / p.life * 4) | 0)], p.x, p.y, 1, 1));
    g.restore();
  };
  sc.drawSea = function (g, cx, cy) {
    const T = this.SP.tiles, tw = T.w, th = T.h, b0 = M.borderX - M.band / 2, b1 = M.borderX + M.band / 2;
    for (let tx = Math.floor(cx / tw); tx * tw < cx + 640; tx++) for (let ty = Math.floor(cy / th); ty * th < cy + 360; ty++) {
      const x = tx * tw - cx, y = ty * th - cy, m = ((tx % 2) + 2) % 2 === 1;
      const x0 = tx * tw, x1 = x0 + tw;
      if (x1 <= b0) g.drawImage(m ? T.innerMImg : T.innerImg, x, y);
      else if (x0 >= b1) g.drawImage(m ? T.borderMImg : T.borderImg, x, y);
      else { g.drawImage(m ? T.innerMImg : T.innerImg, x, y); const im = m ? T.borderMImg : T.borderImg; for (let s = 0; s < tw; s += 8) { const wx = x0 + s, a = U.clamp((wx - b0) / (b1 - b0), 0, 1); if (a <= 0) continue; g.globalAlpha = a; g.drawImage(im, s, 0, 8, th, x + s, y, 8, th); } g.globalAlpha = 1; }
    }
  };
  sc.drawPlayer = function (g, f) {
    const sea = this.sea, ship = this.ship, Sp = this.SP.ships[ship.hull], ss = S.stats(ship), o = this.shipOrigin();
    const load = (ship.hold.length + ship.deck.length) / Math.max(1, ss.holdCap + ss.deckCap);
    // 影子：越满飞得越低，影子越近
    const alt = 14 + 18 * (1 - load); A.oval(g, sea.x, o.y + Sp.hullBottom + alt, Sp.hullW * 0.42, 4, 'rgba(40,40,80,0.18)');
    this.wake.each(p => A.blob(g, p.x, p.y, p.r * (1 - p.age / p.life * 0.4), ['#ffffff', '#eef2f8', '#d8e0ec']));
    this.steam.each(p => A.blob(g, p.x, p.y, p.r + p.age * 1.6, A.STEAM.slice(Math.min(2, (p.age / 0.6) | 0))));
    A.drawShip(g, Sp, o.x, o.y, f, { n: ss.topN, gun: !!ss.gun, engine: ss.engines > 0, hold: ss.holdCap ? ship.hold.length / ss.holdCap : 0, deck: ship.deck.map(i => i.k), crates: this.SP.crates, flip: sea.face < 0 });
  };
  sc.drawPirate = function (g, p, f, chasing) {
    const im = this.SP.pirate, x = G.Px.s(p.x - im.w / 2), y = G.Px.s(p.y - im.h / 2 + Math.sin(f / 12 * 2 + p.x) * 1), flip = (p.face || 1) < 0;
    A.oval(g, p.x, y + im.h + 16, im.w * 0.38, 3.5, 'rgba(40,40,80,0.16)');
    if (chasing) this.red.each(q => A.blob(g, q.x, q.y, q.r + q.age * 1.4, A.RED.slice(Math.min(2, (q.age / 0.4) | 0))));
    A.drawImg(g, im, x, y, flip);
    // 海盗的货看得见：甲板上堆着它的货箱
    const goods = (p.cargo || []).filter(c => c.k !== 'mod'), cw = this.SP.crates.tea.w;
    goods.forEach((c, i) => { const row = i < 3 ? 0 : 1, col = row ? i - 3 : i, n = row ? goods.length - 3 : Math.min(3, goods.length); const bx = x + im.w * 0.5 - n * (cw - 1) / 2 + col * (cw - 1), by = y + Math.round(im.h * 0.62) - cw * (row + 1) + 2; const ci = this.SP.crates[c.k] || this.SP.crates.mat; g.drawImage(ci.img, G.Px.s(flip ? x + im.w - (bx - x) - cw : bx), G.Px.s(by)); });
    if ((p.cargo || []).some(c => c.k === 'mod')) { const q = p.cargo.find(c => c.k === 'mod').q; g.fillStyle = q === 2 ? '#ffd24c' : q === 1 ? '#8cc8ff' : '#f0ead8'; const gx = x + Math.round(im.w * 0.66), gy = y + Math.round(im.h * 0.56) - 4; g.fillRect(gx, gy, 3, 3); if ((f >> 1) % 2) { g.fillRect(gx - 1, gy + 1, 5, 1); g.fillRect(gx + 1, gy - 1, 1, 5); } }
  };
  sc.drawWreck = function (g, w, f, sunk) {
    const im = this.SP.wreck, x = G.Px.s(w.x - im.w / 2), y = G.Px.s(w.y - im.h / 2 + Math.sin(f / 12 + w.x) * 1);
    g.save(); if (sunk) g.globalAlpha = 0.75; g.drawImage(im.img, x, y); g.restore();
    w.items.slice(0, 4).forEach((it, i) => { const ci = this.SP.crates[it.k] || this.SP.crates.mat; g.drawImage(ci.img, x + 12 + i * 9, y + im.h - 6 + (i % 2) * 3 + Math.round(Math.sin(f / 12 * 1.5 + i))); });
  };

  /* ---------------- 界面 ---------------- */
  sc.ui = function (u) {
    const st = this.st, sea = this.sea, ship = this.ship, ss = S.stats(ship), cam = this.cam, C = u.C;
    if (this.battle && this.battle.phase !== 'panel') { this.battle.ui(u); return; }
    // 城镇名字
    for (const t of M.towns) { const x = t.x - cam.x, y = t.y - cam.y - 52; if (x > -60 && x < 700 && y > -20 && y < 380) { u.text(t.name, x, y, { size: 8, align: 'center', bold: true, serif: true, color: '#fff3d0' }); u.text(t.region === 'inner' ? '内圈 · 城镇' : '边境 · 城镇', x, y + 9, { size: 5.5, align: 'center', color: '#e8dcc8' }); } }
    { const sk = st.world.sunk; if (sk && sk.items.length) { const x = sk.x - cam.x, y = sk.y - cam.y - 22; if (x > -60 && x < 700 && y > -20 && y < 380) { u.text(sk.name || '你的沉船', x, y, { size: 7, align: 'center', bold: true, color: '#c8e0ff' }); u.text(sk.guardBeaten ? `还沉着 ${sk.items.length} 件：停在旁边按 E 捞` : `沉着 ${sk.items.length} 件 · 第 ${sk.until} 天结束前有效 · 先打跑守货的海盗`, x, y + 9, { size: 5.5, align: 'center', color: '#e8f0ff' }); } } }
    { const x = M.home.x - cam.x, y = M.home.y - cam.y - 70; if (x > -60 && x < 700 && y > -20 && y < 380) u.text('空岛 · 家', x, y, { size: 8, align: 'center', bold: true, serif: true, color: '#fff3d0' }); }
    // 互动提示
    const n = this.modal || this.battle ? null : this.nearest();
    if (n && n.d < n.r) {
      u.prompt(n.x - cam.x, n.y - cam.y + (n.kind === 'patrol' ? 50 : n.kind === 'wreck' ? 40 : -30), 'E', n.label);
      if (n.kind === 'patrol') { const pw = G.Battle.powerLine(n.p.r); u.text(pw.text, n.x - cam.x, n.y - cam.y + 59, { size: 6.5, bold: true, align: 'center', color: pw.tone.c }); } // 开打前看得见：推荐战力和你的战力，按差距标绿黄红
    }
    if (this.salv) { const s = this.salv, x = s.w.x - cam.x, y = s.w.y - cam.y + 24, moving = Math.hypot(sea.vx, sea.vy) > 22; u.bar(x - 20, y, 40, 3, s.t / (s.sunk ? 2 : 4), '#ffd27a'); u.text(moving ? '停下来才捞得动' : `打捞中 · 还剩 ${s.w.items.length} 箱`, x, y + 11, { size: 6, align: 'center', color: moving ? '#ffb0a0' : C.fg }); }
    // 巡逻船头上的货单
    for (const p of st.world.patrols) if (p.alive) { const x = p.x - cam.x, y = p.y - cam.y - this.SP.pirate.h / 2 - 4; if (x < -40 || x > 680 || y < -10 || y > 380) continue; const goods = p.cargo.filter(c => c.k !== 'mod'), md = p.cargo.find(c => c.k === 'mod'); const txt = goods.map(c => D.itemName(c.k)).join('、') + (md ? `、${D.Q[md.q].name}色${D.MODULES[md.type].name}` : ''); u.text(txt, x, y - 8, { size: 5.5, align: 'center', color: p.kind === 'patrol' ? '#ffd8cc' : '#ffe08a' }); const pw = G.Battle.powerLine(p.r); u.text(`推荐战力 ${pw.rec}`, x, y, { size: 5.5, bold: true, align: 'center', color: pw.tone.c }); }
    this.hud(u, ss);
    this.minimap(u);
    this.objective(u);
    if (sea.chase && !this.modal) {
      const c = sea.chase, a = this.alarmT > 0 && (Game.f12 % 2) ? 0.6 : 1;
      u.panel(458, 74, 172, 40, { fill: C.redBg, stroke: C.red }); u.text(`被盯上　${String(Math.max(0, Math.ceil(c.t))).padStart(2, '0')} 秒`, 470, 91, { size: 10, bold: true, color: '#ffd8cc', alpha: a });
      u.text(c.queue.some(d => !d.gone && d.fall <= 0) ? '它停下来捞你扔的货了' : (ss.tier > 1 ? '' : '你不比它快：扔货拖时间，或飞进安全圈'), 470, 106, { size: 6, color: '#ffe8e0' });
      const k = u.keycap('Q', 300, 304); u.text('按住扔货（先扔甲板上最便宜的）', 300 + k + 4, 312, { size: 7, color: '#ffe8e0' });
    }
    if (this.ff) u.text('» 快进 ×3', 320, 72, { size: 8, align: 'center', bold: true, color: '#fff3d0' });
    if (this.modal) this.modalUI(u, ss);
    if (this.battle) this.battle.ui(u); // 战后面板
  };
  sc.hud = function (u, ss) {
    const st = this.st, ship = this.ship, C = u.C, hp = ship.hp, heat = S.heat(ship), val = S.cargoValue(ship);
    u.panel(8, 8, 178, 74);
    u.text(`第 ${st.day} 天 · 白天 · ${D.HULLS[ship.hull].name}`, 16, 20, { size: 7, color: C.brassL, bold: true });
    u.text('船体值', 16, 33, { size: 6.5, color: C.muted }); u.bar(46, 28, 84, 5, hp / ss.hpMax, hp / ss.hpMax > 0.4 ? '#8fd06a' : '#e0574a'); u.text(`${Math.ceil(hp)} / ${ss.hpMax}`, 134, 33, { size: 6.5 });
    u.text('热度', 16, 46, { size: 6.5, color: C.muted }); for (let i = 0; i < 3; i++) u.flame(50 + i * 9, 43.5, i < heat, 0.9);
    u.text('速度', 86, 46, { size: 6.5, color: C.muted }); u.text(D.TIERS[ss.tier].name, 108, 46.5, { size: 8, bold: true, color: ss.tier === 2 ? '#b8f0a0' : ss.tier === 1 ? C.fg : '#ffb08a' }); u.text(`推重比 ${ss.twr.toFixed(2)}`, 124, 46, { size: 5.5, color: C.muted });
    const full = S.holdFull(ship);
    u.text('货舱', 16, 60, { size: 6.5, color: C.muted }); u.text(`${ship.hold.length}/${ss.holdCap}`, 36, 60.5, { size: 7.5, bold: true, color: full ? '#ffd27a' : C.fg });
    u.text('甲板', 62, 60, { size: 6.5, color: C.muted }); u.text(`${ship.deck.length}/${ss.deckCap}`, 82, 60.5, { size: 7.5, bold: true, color: ship.deck.length ? '#ffd27a' : C.fg });
    u.text(`货值 ${val}`, 108, 60, { size: 6.5, color: C.muted });
    if (full) u.text(ship.deck.length ? '冒尖' : '满舱', 160, 60.5, { size: 7, bold: true, color: '#ffd27a' });
    const pw = G.Battle.powerLine(regionAt(this.sea.x)), pp = S.powerParts(ship);
    u.text('战力', 16, 74, { size: 6.5, color: C.muted }); u.text(String(pw.pw), 36, 74.5, { size: 7.5, bold: true, color: pw.tone.c });
    u.text(`炮 ${pp.guns} + 船体值 ${pp.hull}　这片推荐 ${pw.rec}`, 56, 74, { size: 6, color: C.muted }); u.text(pw.tone.word, 178, 74.5, { size: 6.5, bold: true, align: 'right', color: pw.tone.c });
  };
  sc.minimap = function (u) {
    const st = this.st, sea = this.sea, x0 = 516, y0 = 8, w = 116, h = w * M.h / M.w, s = w / M.w, C = u.C;
    u.panel(x0 - 3, y0 - 3, w + 6, h + 6, { fill: 'rgba(24,18,14,0.75)' });
    u.rect(x0, y0, M.borderX * s, h, 'rgba(110,150,200,0.45)'); u.rect(x0 + M.borderX * s, y0, w - M.borderX * s, h, 'rgba(200,160,110,0.45)');
    u.text('内圈', x0 + 3, y0 + h - 3, { size: 5, color: '#e8f0ff' }); u.text('边境', x0 + w - 3, y0 + h - 3, { size: 5, align: 'right', color: '#fff0d8' });
    u.circle(x0 + M.home.x * s, y0 + M.home.y * s, 3, '#8fd06a', '#1b1209');
    for (const t of M.towns) { u.circle(x0 + t.x * s, y0 + t.y * s, 2.5, '#f0d38a', '#1b1209'); u.text(t.name[0], x0 + t.x * s, y0 + t.y * s - 4, { size: 5, align: 'center', color: '#fff3d0' }); }
    for (const wk of st.world.wrecks) if (wk.items.length) u.rect(x0 + wk.x * s - 1.5, y0 + wk.y * s - 1.5, 3, 3, '#c8c0b0');
    if (st.world.sunk && st.world.sunk.items.length) u.text('⚓', x0 + st.world.sunk.x * s, y0 + st.world.sunk.y * s + 2, { size: 6, align: 'center', color: '#c8e0ff' });
    for (const p of st.world.patrols) if (p.alive) u.circle(x0 + p.x * s, y0 + p.y * s, 1.8, '#e0574a');
    if (sea.chase && (Game.f12 % 2)) u.circle(x0 + sea.chase.x * s, y0 + sea.chase.y * s, 2.4, '#ff3020');
    const gl = this.goalNow; if (gl && !this.modal && (Game.f12 % 4) < 3) u.circle(x0 + gl.x * s, y0 + gl.y * s, 3.6, null, '#ffe08a', 1); // 建议去的地方
    u.circle(x0 + sea.x * s, y0 + sea.y * s, 2.4, '#ffffff', '#1b1209');
  };
  /* ---------------- 现在该去哪：目标箭头 + 底下一行提示 ----------------
     新手几步照教学走；之后每趟都给一条建议航线：按今晚热门、手上的订单、舱位和钱，挑「值钱 ÷ 路程」最划算的那一处
     （城镇进货、看得见货的巡逻船、残骸、自己的沉船），舱满了、船体值少了、附近没东西了就指回家。被盯上时指最近的安全圈。
     只是建议：玩家想去哪都行。目标定下来以后不来回跳，做完或做不成了才换下一处。 */
  const SAFE = () => [{ x: M.home.x, y: M.home.y, r: M.safeR + 60, name: '空岛' }, ...M.towns.map(t => ({ x: t.x, y: t.y, r: M.safeR, name: t.name }))];
  const patrolAct = p => p.kind === 'guard' ? '开战 · 守货的海盗' : p.kind === 'scooper' ? '开战 · 抢你货的海盗' : '开战 · 海盗巡逻船';
  sc.goal = function () {
    const st = this.st, sea = this.sea, ship = this.ship, ss = S.stats(ship), tut = st.flags.tut, W = st.world;
    const hd = homeDock(), H = { x: hd.x, y: hd.y, kind: 'home', act: '进港回家' };
    if (this.opening) return { ...H, text: this.script.stage < 1 ? 'WASD / 方向键 开船：往左飞回家（空岛）' : this.script.stage < 3 ? '按 Q 扔一箱货：海盗会停下来捞，你就多几秒' : '飞到空岛的码头，按 E 进港' };
    if (sea.chase) {
      const z = SAFE().sort((a, b) => (U.dist(sea.x, sea.y, a.x, a.y) - a.r) - (U.dist(sea.x, sea.y, b.x, b.y) - b.r))[0];
      return { x: z.x, y: z.y, kind: 'safe', text: `被盯上了：飞进${z.name}的安全圈就甩掉它；快被追上就按住 Q 扔货拖时间` };
    }
    if (tut === 'buy') { const t = M.towns[0]; return { x: t.x, y: t.y, kind: 'town', town: t, act: '靠港 · ' + t.name, buy: { k: 'tea', n: Math.max(0, S.space(ship).hold) }, text: '去晴岚港买茶叶（飞到城镇旁边按 E 靠港）' }; }
    if (tut === 'fight') { const p = W.patrols.filter(p => p.alive && p.r === 'inner').sort((a, b) => U.dist(sea.x, sea.y, a.x, a.y) - U.dist(sea.x, sea.y, b.x, b.y))[0]; if (p) return { x: p.x, y: p.y, kind: 'patrol', p, act: patrolAct(p), text: '打一艘海盗巡逻船：它甲板上的货就是战利品（飞过去按 E）' }; }
    if (tut === 'fight' || tut === 'home') return { ...H, text: '舱满了就回家：飞回空岛按 E 进港' };
    const sp = S.space(ship), room = Math.max(0, sp.hold) + Math.max(0, sp.deck);
    if (ship.hp < ss.hpMax * 0.35) { this.plan = null; return { ...H, text: '船体值不多了，回家修（回家免费修满）' }; }
    if (room <= 0) { this.plan = null; return { ...H, text: S.holdFull(ship) && ship.deck.length ? '满载冒尖！活着飞回家' : '满载！活着飞回家' }; }
    let c = this.plan && this.planOk(this.plan) ? this.plan : null;
    if (!c) c = this.plan = this.pickPlan();
    if (c) return Object.assign(c, this.planPos(c));
    return { ...H, text: S.holdFull(ship) ? '舱满了：回家「满舱而归」' : (ship.hold.length + ship.deck.length ? '附近没什么可捞的了：回家开市' : '今天没什么可做的了：回家') };
  };
  sc.planPos = function (c) { return c.p ? { x: c.p.x, y: c.p.y } : c.w ? { x: c.w.x, y: c.w.y } : { x: c.town.x, y: c.town.y }; };
  /* 一个建议还做得成吗 */
  sc.planOk = function (c) {
    const st = this.st, W = st.world, ship = this.ship, sp = S.space(ship), room = Math.max(0, sp.hold) + Math.max(0, sp.deck), ss = S.stats(ship);
    if (room <= 0) return false;
    if (c.kind === 'patrol') return c.p.alive && W.patrols.includes(c.p) && ship.hp >= ss.hpMax * (c.p.r === 'border' ? 0.6 : 0.45);
    if (c.kind === 'wreck') return c.w.items.length > 0 && (!c.sunk || W.sunk === c.w);
    if (c.kind === 'town') { const left = W.stock[c.town.id + ':' + c.buy.k] ?? 0, s = c.town.sells.find(s => s.k === c.buy.k); return left > 0 && st.gold >= s.price && !(W.bought || {})[c.town.id]; }
    return false;
  };
  /* 挑下一处，照「中期的一天」：舱里还留得出接战利品的空，就先打附近看得见货的巡逻船、捞附近的残骸（海货今晚卖得贵、还涨口碑，船材攒着造船）；
     剩下的舱位去城镇进货补满（今晚热门、订单要的优先）；钱够造驮兽只差船材时先去买船材；都比一比「值多少 ÷ 要花几秒（路程 + 打仗 / 打捞 / 靠港）」 */
  sc.pickPlan = function () {
    const st = this.st, W = st.world, sea = this.sea, ship = this.ship, ss = S.stats(ship), sp = S.space(ship), room = Math.max(0, sp.hold) + Math.max(0, sp.deck);
    const v = M.speed * D.TIERS[ss.tier].map, secs = o => U.dist(sea.x, sea.y, o.x, o.y) / v, full = S.holdFull(ship);
    const bg = S.beastGoal(st), matNeed = !!bg && st.mat < bg.mat; // 攒着造驮兽：船材不够
    const nightP = k => { const g = D.GOODS[k]; return g ? g.base * g.far * (st.board.hot.includes(k) ? D.MARKET.hotMult : 1) * (1 + st.stars * D.MARKET.starBonus) : 0; };
    const seaV = it => it.k === 'mat' ? 50 * (matNeed ? 2 : 1) : it.k === 'mod' ? D.baseValue(it) : nightP(it.k) * 1.3; // 海货：今晚的卖价，再算上口碑
    const acc = st.board.accepted, have = k => st.warehouse.filter(i => i.k === k).length + ship.hold.concat(ship.deck).filter(i => i.k === k).length;
    const orderNeed = k => acc && acc.need[k] ? Math.max(0, acc.need[k] - have(k)) : 0;
    const goodsTxt = items => [...new Set(items.filter(i => i.k !== 'mod').map(i => D.itemName(i.k)))].join('、');
    const grab = [], buy = [];
    for (const p of W.patrols) {
      if (!p.alive || !(ship.hp >= ss.hpMax * (p.r === 'border' ? 0.6 : 0.45))) continue;
      const val = U.sum(p.cargo.map(seaV)) + (p.kind === 'guard' && W.sunk ? U.sum(W.sunk.items.map(seaV)) : 0);
      const text = p.kind === 'guard' ? '打跑守货的海盗，再停在你的沉船旁边按 E 捞回来' : p.kind === 'scooper' ? `打掉捞了你货的海盗：货就回来（${goodsTxt(p.cargo)}）` : `打${p.r === 'border' ? '边境的' : ''}海盗巡逻船：它甲板上有${goodsTxt(p.cargo)}（飞过去按 E）`;
      grab.push({ kind: 'patrol', p, act: patrolAct(p), val, go: secs(p), t: secs(p) + 40, text });
    }
    for (const w of W.wrecks) if (w.items.length) { const n = Math.min(room, w.items.length); grab.push({ kind: 'wreck', w, act: '打捞残骸', val: U.sum(w.items.slice(0, n).map(seaV)), go: secs(w), t: secs(w) + 4 * n, text: `捞残骸：停在旁边按 E，每 4 秒捞 1 箱（还有 ${w.items.length} 箱）` }); }
    if (W.sunk && W.sunk.guardBeaten && W.sunk.items.length) { const w = W.sunk, n = Math.min(room, w.items.length); grab.push({ kind: 'wreck', w, sunk: true, act: '打捞沉货', val: U.sum(w.items.slice(0, n).map(seaV)) * 1.5, go: secs(w), t: secs(w) + 2 * n, text: `捞你的沉货：停在旁边按 E（还有 ${w.items.length} 件）` }); }
    for (const t of M.towns) {
      if ((W.bought || {})[t.id]) continue;
      for (const s of t.sells) {
        const left = W.stock[t.id + ':' + s.k] ?? 0;
        if (s.k === 'mat') { // 钱够造驮兽、只差船材：去铁桅镇买
          const n = matNeed ? Math.min(left, room, Math.ceil((bg.mat - st.mat) / 10)) : 0;
          if (n > 0 && st.gold >= bg.gold + n * s.price) buy.push({ kind: 'town', town: t, act: '靠港 · ' + t.name, buy: { k: 'mat', n }, val: n * 200, go: secs(t), t: secs(t) + 6, text: `去${t.name}买船材：钱够造驮兽货船了，还差 ${bg.mat - st.mat} 船材` });
          continue;
        }
        const n = Math.min(left, room, Math.floor(st.gold / s.price)); if (n <= 0) continue;
        const need = orderNeed(s.k), hot = st.board.hot.includes(s.k), gain = nightP(s.k) - s.price;
        const g = D.GOODS[s.k], orderP = g.base * g.far * (1 + st.stars * D.MARKET.starBonus) * D.MARKET.orderMult; // 订单按不算热门的卖价 ×1.5 付
        const val = gain * n + Math.min(need, n) * Math.max(0, orderP - nightP(s.k));
        const why = need ? `订单要 ${need} 箱` : hot ? '今晚热门' : `夜市约 ${Math.round(nightP(s.k))} 金`;
        buy.push({ kind: 'town', town: t, act: '靠港 · ' + t.name, buy: { k: s.k, n }, val, go: secs(t), t: secs(t) + 6, text: `去${t.name}买${D.GOODS[s.k].name}（${why}）：飞到城镇旁边按 E 靠港` });
      }
    }
    const best = list => list.filter(c => c.val > 0).sort((a, b) => b.val / b.t - a.val / a.t)[0] || null;
    // 舱满了只顺路往甲板上堆：远的就不去了，先回家
    if (full) return best(grab.concat(buy).filter(c => c.go < 10));
    // 钱够造驮兽、只差船材：先去买船材（这时候它是唯一卡住的东西）
    const matBuy = buy.find(c => c.buy.k === 'mat'); if (matBuy) return matBuy;
    // 先打、先捞：附近（半分钟航程以内）有、舱里也留得出两格接战利品
    const near = best(grab.filter(c => c.go < 30)); if (near && room >= 2) return near;
    // 再进货把舱补满；钱不够进货就去远一点的地方打、捞
    return best(buy) || best(grab);
  };
  sc.objective = function (u) {
    const sea = this.sea, gl = this.goalNow || (this.goalNow = this.goal());
    const tgt = gl, txt = gl.text;
    if (txt) u.hint(txt);
    if (tgt) {
      const cam = this.cam, sx = tgt.x - cam.x, sy = tgt.y - cam.y;
      if (sx < 10 || sx > 630 || sy < 10 || sy > 350) {
        const cx = 320, cy = 180, a = Math.atan2(sy - cy, sx - cx), ex = U.clamp(cx + Math.cos(a) * 400, 22, 618), ey = U.clamp(cy + Math.sin(a) * 400, 82, 318);
        const g = u.g, k = u.k; g.save(); g.translate(u.ox + ex * k, u.oy + ey * k); g.rotate(a); g.fillStyle = '#f0d38a'; g.strokeStyle = '#1b1209'; g.lineWidth = k; g.beginPath(); g.moveTo(8 * k, 0); g.lineTo(-5 * k, -6 * k); g.lineTo(-2 * k, 0); g.lineTo(-5 * k, 6 * k); g.closePath(); g.fill(); g.stroke(); g.restore();
        const secs = Math.round(U.dist(sea.x, sea.y, tgt.x, tgt.y) / M.speed);
        u.text(`${secs} 秒`, ex - Math.cos(a) * 16, ey - Math.sin(a) * 14 + 2, { size: 6, align: 'center', color: '#fff3d0' });
      }
    }
  };

  sc.modalUI = function (u, ss) {
    const m = this.modal, C = u.C, st = this.st, ship = this.ship;
    u.rect(0, 0, 640, 360, 'rgba(8,6,10,0.45)');
    if (m.type === 'caught') {
      const val = S.cargoValue(ship), need = Math.ceil(val * 0.2);
      u.panel(170, 100, 300, 150, { fill: 'rgba(30,12,10,0.95)', stroke: C.red, lw: 1.5, r: 6 });
      u.text('被追上了！', 320, 126, { size: 14, bold: true, serif: true, align: 'center', color: '#ffd8cc' });
      u.text('时间停住了：开战，还是认栽？', 320, 142, { size: 7, align: 'center', color: C.fg });
      u.text(`船体值 ${Math.ceil(ship.hp)} / ${ss.hpMax}　货值 ${val}`, 320, 156, { size: 6.5, align: 'center', color: C.muted });
      if (u.button(186, 168, 128, 34, '开战', { danger: true, size: 9 })) { const c = this.sea.chase; this.modal = null; this.startBattle({ kind: 'chase', region: c.region, cargo: c.cargo.concat([{ k: 'mat', sea: true }]), chase: true }); }
      { const pw = G.Battle.powerLine(this.sea.chase ? this.sea.chase.region : regionAt(this.sea.x)); u.text(`推荐战力 ${pw.rec} · 你 ${pw.pw}`, 250, 198, { size: 6, bold: true, align: 'center', color: pw.tone.c }); } // 写在「开战」上
      u.text('花船体值保货：只掉 1 箱船材', 250, 214, { size: 6, align: 'center', color: '#ffd8cc' });
      if (u.button(326, 168, 128, 34, '认栽', { size: 9 })) { this.modal = { type: 'yield', pick: this.yieldPick() }; }
      u.text(`交出货值的 20%（至少 ${need}），自己挑`, 390, 214, { size: 6, align: 'center', color: C.muted });
      u.text('想让它停下来，下次早点扔货', 320, 238, { size: 6, align: 'center', color: C.muted });
    } else if (m.type === 'yield') {
      const items = ship.deck.map((it, i) => ({ it, where: 'deck', i })).concat(ship.hold.map((it, i) => ({ it, where: 'hold', i })));
      const val = S.cargoValue(ship), need = val * 0.2, picked = items.filter((o, j) => m.pick.has(j)), sum = U.sum(picked.map(o => D.baseValue(o.it)));
      u.panel(130, 60, 380, 240, { fill: 'rgba(24,18,14,0.96)', r: 6 });
      u.text('认栽：挑出要交的货', 320, 82, { size: 11, bold: true, serif: true, align: 'center', color: C.brassL });
      u.text(`要交够货值的 20%：${Math.ceil(need)}　已挑 ${sum}`, 320, 96, { size: 7, align: 'center', color: sum >= need ? '#b8f0a0' : '#ffd8cc' });
      items.forEach((o, j) => { const col = j % 4, row = Math.floor(j / 4), x = 146 + col * 88, y = 106 + row * 22; const on = m.pick.has(j); u.panel(x, y, 82, 18, { fill: on ? 'rgba(140,40,30,0.9)' : 'rgba(52,38,26,0.9)', stroke: on ? C.red : C.brass, r: 3 }); const ci = G.SPR.map.crates[o.it.k] || G.SPR.map.crates.mat; u.img(ci, x + 4, y + 5, 1); u.text(`${D.itemName(o.it.k === 'mod' ? 'mod:' + o.it.type : o.it.k)}${o.where === 'deck' ? '·甲板' : ''}`, x + 15, y + 12, { size: 6.5 }); u.text(String(D.baseValue(o.it)), x + 78, y + 12, { size: 6, align: 'right', color: C.muted }); if (u.clicked(x, y, 82, 18)) { on ? m.pick.delete(j) : m.pick.add(j); G.Sfx.play('click'); } });
      if (u.button(250, 270, 140, 20, '交出这些，让它走', { primary: true, disabled: sum < need && sum < val })) {
        const del = { deck: [], hold: [] }; items.forEach((o, j) => { if (m.pick.has(j)) del[o.where].push(o.i); });
        if (del.hold.length && S.holdFull(ship)) G.UI.toast('交了舱里的货：满舱和冒尖都没了', '#ffb0a0');
        ship.deck = ship.deck.filter((_, i) => !del.deck.includes(i)); ship.hold = ship.hold.filter((_, i) => !del.hold.includes(i));
        this.sea.chase = null; this.sea.cool = 25; this.modal = null; G.UI.toast('海盗拿了货，扬长而去'); Game.save();
      }
      if (u.button(140, 270, 80, 20, '还是开战')) this.modal = { type: 'caught' };
    } else if (m.type === 'town') this.townUI(u, ss, m.town);
  };

  /* 认栽时默认先替你挑好：从最便宜的往上凑，刚好够 20%（可以再点着改） */
  sc.yieldPick = function () {
    const ship = this.ship, items = ship.deck.concat(ship.hold), need = S.cargoValue(ship) * 0.2, order = items.map((it, j) => j).sort((a, b) => D.baseValue(items[a]) - D.baseValue(items[b]));
    const pick = new Set(); let sum = 0;
    for (const j of order) { if (sum >= need) break; pick.add(j); sum += D.baseValue(items[j]); }
    for (const j of [...pick].sort((a, b) => D.baseValue(items[b]) - D.baseValue(items[a]))) if (sum - D.baseValue(items[j]) >= need) { pick.delete(j); sum -= D.baseValue(items[j]); }
    return pick;
  };
  sc.townUI = function (u, ss, t) {
    const st = this.st, ship = this.ship, C = u.C, sp = S.space(ship);
    u.panel(150, 56, 340, 236, { fill: 'rgba(24,18,14,0.96)', r: 6 });
    u.text(t.name, 320, 80, { size: 14, bold: true, serif: true, align: 'center', color: C.brassL });
    u.text('城镇只买不卖：货只有运回自家夜市才变成钱。城里的货印着城镇的戳，卖钱一样，不涨口碑。', 320, 94, { size: 6, align: 'center', color: C.muted });
    u.text(`金币 ${U.fmt(st.gold)}　船材 ${st.mat}　货舱空 ${Math.max(0, sp.hold)}　甲板空 ${Math.max(0, sp.deck)}`, 320, 108, { size: 7, align: 'center' });
    t.sells.forEach((s, i) => {
      const y = 122 + i * 42, key = t.id + ':' + s.k, left = st.world.stock[key] ?? 0, name = s.k === 'mat' ? '船材（1 箱 10 个）' : D.GOODS[s.k].name;
      u.panel(166, y, 308, 36, { fill: 'rgba(52,38,26,0.9)', r: 4 });
      const ci = G.SPR.map.crates[s.k] || G.SPR.map.crates.mat; u.img(ci, 176, y + 9, 2);
      u.text(name, 196, y + 15, { size: 8, bold: true }); u.text(`${s.price} 金 / 箱　今天还剩 ${left}`, 196, y + 28, { size: 6.5, color: C.muted });
      if (s.k !== 'mat') { const g = D.GOODS[s.k]; u.text(`夜市约 ${Math.round(g.base * g.far)}`, 330, y + 28, { size: 6.5, color: '#b8f0a0' }); }
      const can = left > 0 && st.gold >= s.price && (sp.hold + sp.deck) > 0;
      if (u.button(368, y + 8, 40, 20, '买 1', { disabled: !can, id: 'buy1:' + s.k })) this.buy(t, s, 1);
      if (u.button(412, y + 8, 54, 20, '装满舱', { disabled: !can || sp.hold <= 0, id: 'fill:' + s.k })) this.buy(t, s, Math.max(0, sp.hold));
    });
    u.text('舱满了再买 1 箱就堆上甲板（冒尖 +30%，但挨打先飞）。船材每箱占 1 格，回家卸进材料堆（1 箱 = 10 个）', 320, 122 + t.sells.length * 42 + 8, { size: 6, align: 'center', color: C.muted });
    if (u.button(260, 262, 120, 22, '离港（E）', { primary: true, key: ['KeyE', 'Escape'] })) this.leaveTown();
  };
  sc.buy = function (t, s, n) {
    const st = this.st, ship = this.ship, key = t.id + ':' + s.k; let got = 0;
    while (n-- > 0 && st.world.stock[key] > 0 && st.gold >= s.price) {
      const it = { k: s.k, sea: false, src: t.name }; const where = S.addCargo(ship, it); if (!where) break; if (where === 'deck') G.UI.float(this.sea.x, this.sea.y - 40, '堆上甲板', '#ffd27a', { world: true });
      st.gold -= s.price; st.world.stock[key]--; got++;
    }
    if (got) { G.Sfx.play('coin'); G.UI.toast(`买了 ${got} 箱${s.k === 'mat' ? '船材' : D.GOODS[s.k].name}`); if (st.flags.tut === 'buy') st.flags.tut = 'fight'; (st.world.bought || (st.world.bought = {}))[t.id] = true; } else { G.Sfx.play('deny'); G.UI.toast('装不下了，或者钱不够'); }
  };

  sc.blockEsc = function () { return !!this.modal || !!(this.battle && this.battle.blockEsc()); };
  sc.smooth = true; // 直接画在全分辨率画布上，镜头和船对齐到物理像素（view.js）；就地开打的横版战斗也画在这上面
  Game.reg('map', sc);
})(window.G);
