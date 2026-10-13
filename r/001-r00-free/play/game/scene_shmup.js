/* 副本：竖版射击，只有三个键（移动、技能、冲刺），自动开火。歼灭关。
   手感底线：判定点小且固定；被打中后 1 秒无敌；敌弹速度有上限；弹幕是画面上最清楚的东西。
   被打中一次甲板上掉 1 箱，10 秒内飞过去能接回；敌船被击毁时它甲板上的货箱飞出来，往你这边漂 1 秒，10 秒内碰到就接住。 */
(function (G) {
  'use strict';
  const D = G.D, S = G.S, U = G.U, A = G.Art, In = G.In, Game = G.Game;
  const R = U.R;
  const FX0 = 176, FW = 288, FX1 = FX0 + FW, FH = 360;
  const EB_COLS = ['#5a0f12', '#e0402a', '#ffb070', '#fff4e0'];
  const sc = {};

  sc.enter = function (p) {
    const st = this.st = Game.st; this.P = p; this.ship = S.ship(st); this.ss = S.stats(this.ship); this.SP = G.SPR.shmup;
    this.region = p.region || 'inner'; this.mult = D.ENEMY_MULT[this.region];
    this.first = st.flags.firstBattle;
    const sp = this.SP.ship;
    this.pl = { x: FX0 + FW / 2, y: FH + 60, vx: 0, vy: 0, inv: 1.5, dash: 0, dcd: 0, fire: 0, mz: 0, flash: 0, shake: 0, dead: false, w: sp.w, h: sp.h, trail: [] };
    this.bul = []; this.eb = []; this.en = []; this.crates = []; this.loot = []; this.sparks = A.Pool(); this.puffs = A.Pool();
    this.t = 0; this.scroll = 0; this.gauge = 0; this.skill = 0; this.wave = 0; this.waves = this.makeWaves(p); this.state = 'intro'; this.endT = 0; this.hits = 0;
    this.stats = { shot: 0, caught: 0, flown: 0, lost: 0, kills: 0 };
    this.panel = null; this.downModal = null;
    G.Sfx.play('alarm');
  };

  /* 波次：手工表（切片做默认装法：瞄准连发、扇形；精英打环形） */
  sc.makeWaves = function (p) {
    const border = this.region === 'border';
    const cargo = (p.cargo || []).slice();
    let waves;
    if (p.kind === 'chase') waves = [[{ x: 0.3, k: 'aim' }, { x: 0.7, k: 'aim' }], [{ x: 0.5, k: 'fan' }]];
    else if (p.kind === 'guard') waves = [[{ x: 0.25, k: 'aim' }, { x: 0.75, k: 'fan' }], [{ x: 0.5, k: 'ring', elite: true }]];
    else if (border) waves = [[{ x: 0.2, k: 'aim' }, { x: 0.5, k: 'fan' }, { x: 0.8, k: 'aim' }], [{ x: 0.3, k: 'fan' }, { x: 0.7, k: 'aim' }, { x: 0.5, k: 'ring', elite: true }]];
    else waves = [[{ x: 0.3, k: 'aim' }, { x: 0.7, k: 'aim' }], [{ x: 0.2, k: 'fan' }, { x: 0.5, k: 'aim' }, { x: 0.8, k: 'fan' }]];
    // 敌船甲板上的货：货箱给最后一波里最壮的那艘，船材给第一波的，模块给精英或最后一艘
    const last = waves[waves.length - 1], big = last.find(e => e.elite) || last[Math.floor(last.length / 2)];
    big.cargo = []; for (const it of cargo) { if (it.k === 'mat' && waves[0][0] !== big) { (waves[0][0].cargo = waves[0][0].cargo || []).push(it); } else big.cargo.push(it); }
    return waves;
  };
  sc.spawnWave = function () {
    const w = this.waves[this.wave]; if (!w) return;
    w.forEach((e, i) => {
      const im = e.elite ? this.SP.elite : this.SP.pirate, hp = (e.elite ? 70 : 20) * this.mult;
      this.en.push({ x: FX0 + FW * e.x, y: -im.h / 2 - 10 - i * 16, ty: 46 + (i % 2) * 34 + (e.elite ? 10 : 0), k: e.k, elite: !!e.elite, hp, hpMax: hp, im, t: R() * 2, fireT: 1.4 + R() * 1.2, phase: R() * 6, flash: 0, cargo: e.cargo || [], ax: FX0 + FW * e.x });
    });
    this.wave++;
  };

  sc.update = function (dt) {
    if (this.downModal || this.panel) { if (this.downModal) this.updateDown(dt); return; }
    const pl = this.pl, ss = this.ss; this.t += dt; this.scroll += dt * 26;
    this.sparks.step(dt); this.puffs.step(dt);
    if (this.state === 'intro') { pl.y += (FH - 70 - pl.y) * Math.min(1, dt * 3.5); if (this.t > 0.9) { this.state = 'fight'; this.spawnWave(); } }
    if (this.state === 'fight' || this.state === 'clear') this.updatePlayer(dt);
    if (this.state === 'fight' && !this.en.length) { if (this.wave < this.waves.length) this.spawnWave(); else { this.state = 'clear'; this.endT = 0; G.Sfx.play('win'); G.UI.showBanner('歼灭！', this.crates.some(c => !c.caught) ? '把还在飘的箱子接住' : '', '#ffd24c', 1.8); } }
    if (this.state === 'clear') { this.endT += dt; const live = this.crates.some(c => !c.done); if ((!live && this.endT > 1.2) || this.endT > 6) this.finish(true); }
    this.updateEnemies(dt); this.updateBullets(dt); this.updateCrates(dt);
    pl.flash = Math.max(0, pl.flash - dt); pl.shake = Math.max(0, pl.shake - dt);
  };
  sc.updatePlayer = function (dt) {
    const pl = this.pl, ss = this.ss; if (pl.dead) return;
    const ax = In.axis(), l = Math.hypot(ax.x, ax.y) || 1, base = 128 * D.TIERS[ss.tier].shmup;
    pl.dcd = Math.max(0, pl.dcd - dt); pl.inv = Math.max(0, pl.inv - dt);
    if (In.hit('Space', 'KeyK') && pl.dcd <= 0) { pl.dash = 0.16; pl.dcd = 0.9; pl.dx = ax.x || ax.y ? ax.x / l : 0; pl.dy = ax.x || ax.y ? ax.y / l : -1; pl.inv = Math.max(pl.inv, 0.26); G.Sfx.play('dash'); }
    let vx = ax.x / l * base, vy = ax.y / l * base;
    if (pl.dash > 0) { pl.dash -= dt; vx = pl.dx * base * 3.2; vy = pl.dy * base * 3.2; pl.trail.push({ x: pl.x, y: pl.y, t: 0.25 }); }
    pl.x = U.clamp(pl.x + vx * dt, FX0 + 10, FX1 - 10); pl.y = U.clamp(pl.y + vy * dt, 30, FH - 22);
    for (const tr of pl.trail) tr.t -= dt; pl.trail = pl.trail.filter(t => t.t > 0);
    // 自动开火：连发炮两个炮口轮流打
    pl.fire -= dt; const gun = ss.gun, rate = gun ? (this.skill > 0 ? 18 : 9) : 5;
    if (pl.fire <= 0) {
      pl.fire = 1 / rate; pl.mz ^= 1; const dmg = (gun ? ss.dmg : 0.5) * (this.skill > 0 ? 1.5 : 1);
      if (this.skill > 0) { for (const a of [-0.24, -0.1, 0, 0.1, 0.24]) this.bul.push({ x: pl.x + a * 20, y: pl.y - pl.h / 2 + 4, vx: Math.sin(a) * 420, vy: -Math.cos(a) * 420, dmg }); }
      else this.bul.push({ x: pl.x + (gun ? (pl.mz ? 4 : -4) : 0), y: pl.y - pl.h / 2 + 4, vx: 0, vy: -400, dmg });
      G.Sfx.play('shoot');
    }
    // 技能「铜雨」：清掉屏幕上的敌弹，2.4 秒五道弹流
    this.skill = Math.max(0, this.skill - dt);
    if (In.hit('KeyE', 'KeyJ') && this.gauge >= 100 && gun) { this.gauge = 0; this.skill = 2.4; G.Sfx.play('skill'); for (const b of this.eb) this.sparkAt(b.x, b.y, 2); this.eb = []; G.UI.float(pl.x, pl.y - 40, '铜雨！', '#ffe08a', { size: 10 }); }
    else if (In.hit('KeyE', 'KeyJ') && !gun) G.UI.toast('没装主炮：没有技能');
  };
  sc.hitbox = function () { return { x: this.pl.x, y: this.pl.y - 2 }; };

  sc.updateEnemies = function (dt) {
    const pl = this.pl, hb = this.hitbox(), sp = this.region === 'border' ? 1.15 : 1;
    for (const e of this.en) {
      e.t += dt; e.flash = Math.max(0, e.flash - dt);
      if (e.y < e.ty) e.y += Math.max(20, (e.ty - e.y) * 2.2) * dt;
      else { e.x = U.clamp(e.ax + Math.sin(e.t * 0.7 + e.phase) * (FW * 0.28), FX0 + 16, FX1 - 16); e.y = e.ty + Math.sin(e.t * 1.1 + e.phase) * 8; }
      if (e.y > 10) { e.fireT -= dt; if (e.fireT <= 0) this.enemyFire(e, sp); }
      if (e.burst > 0) { e.burstT -= dt; if (e.burstT <= 0) { e.burst--; e.burstT = 0.13; const ox = e.x, oy = e.y + e.im.h * 0.35, a = Math.atan2(hb.y - oy, hb.x - ox), v = Math.min(SPD_CAP, 92 * sp); this.eb.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2.5, g: false }); } }
      // 撞上敌船 ×2
      if (!pl.dead && pl.inv <= 0 && Math.abs(hb.x - e.x) < e.im.w * 0.4 && Math.abs(hb.y - e.y) < e.im.h * 0.42) this.hurt(2);
    }
  };
  const SPD_CAP = 140;
  sc.enemyFire = function (e, sp) {
    const pl = this.pl, hb = this.hitbox(), ang = Math.atan2(hb.y - e.y, hb.x - e.x), ox = e.x, oy = e.y + e.im.h * 0.35;
    const shot = (a, v) => this.eb.push({ x: ox, y: oy, vx: Math.cos(a) * Math.min(SPD_CAP, v * sp), vy: Math.sin(a) * Math.min(SPD_CAP, v * sp), r: 2.5, g: false });
    if (e.k === 'aim') { e.burst = 3; e.burstT = 0; e.fireT = 1.9 + R() * 0.6; }
    else if (e.k === 'fan') { for (let i = -2; i <= 2; i++) shot(Math.PI / 2 + i * 0.22, 74); e.fireT = 2.3 + R() * 0.5; }
    else if (e.k === 'ring') { const n = 12, off = e.t; for (let i = 0; i < n; i++) shot(off + i * Math.PI * 2 / n, 62); shot(ang, 100); e.fireT = 2.4; }
  };
  sc.updateBullets = function (dt) {
    const pl = this.pl, hb = this.hitbox();
    for (const b of this.bul) { b.x += b.vx * dt; b.y += b.vy * dt; for (const e of this.en) if (!b.hit && Math.abs(b.x - e.x) < e.im.w * 0.45 && Math.abs(b.y - e.y) < e.im.h * 0.45) { b.hit = true; e.hp -= b.dmg; e.flash = 0.06; G.Sfx.play('ehit'); if (R() < 0.4) this.sparkAt(b.x, b.y, 1); if (e.hp <= 0) this.kill(e); } }
    this.bul = this.bul.filter(b => !b.hit && b.y > -10 && b.x > FX0 - 10 && b.x < FX1 + 10);
    for (const b of this.eb) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      const d = U.dist(b.x, b.y, hb.x, hb.y);
      if (!pl.dead && d < 2.6 + b.r * 0.6) { if (pl.inv <= 0) { b.dead = true; this.hurt(1); } }
      else if (!pl.dead && !b.g && d < 13) { b.g = true; this.gauge = Math.min(100, this.gauge + 2.2 * (1 + this.ss.charge / 100)); G.Sfx.play('graze'); this.sparks.add({ x: b.x, y: b.y, vx: 0, vy: -10, age: 0, life: 0.2, c: '#fff4c0' }); }
    }
    this.eb = this.eb.filter(b => !b.dead && b.y < FH + 10 && b.y > -20 && b.x > FX0 - 10 && b.x < FX1 + 10);
  };
  sc.kill = function (e) {
    this.en.splice(this.en.indexOf(e), 1); this.stats.kills++; this.gauge = Math.min(100, this.gauge + 6);
    G.Sfx.play('boom'); for (let i = 0; i < 22; i++) this.sparks.add({ x: e.x + (R() - 0.5) * e.im.w, y: e.y + (R() - 0.5) * e.im.h * 0.6, vx: (R() - 0.5) * 140, vy: (R() - 0.5) * 140, age: 0, life: 0.35 + R() * 0.3 });
    for (let i = 0; i < 8; i++) this.puffs.add({ x: e.x + (R() - 0.5) * 16, y: e.y + (R() - 0.5) * 30, vx: (R() - 0.5) * 20, vy: 12, r: 3, age: 0, life: 0.9 });
    // 它甲板上的货飞出来，往你这边漂 1 秒
    for (const it of e.cargo) {
      if (it.k === 'mod') { this.loot.push(it); G.UI.float(e.x, e.y, `${D.Q[it.q].name}色${D.MODULES[it.type].name}（自动拾取）`, D.Q[it.q].color, { life: 1.8 }); continue; }
      const a = Math.atan2(this.pl.y - e.y, this.pl.x - e.x) + (R() - 0.5) * 0.8;
      this.crates.push({ x: e.x, y: e.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, t: 0, item: it, rot: 0, auto: this.first });
      if (this.first) G.UI.float(e.x, e.y + 20, '第一场：箱子自己飞上船', '#b8f0a0', { life: 1.8 });
      else if (!this.st.flags.catchHint) { this.st.flags.catchHint = true; G.UI.toast('箱子飞出来了：飞过去接住（10 秒内，没接住就掉进云海）', '#ffd27a', 4); }
      this.stats.flown++;
    }
  };
  sc.hurt = function (mult) {
    const pl = this.pl, ship = this.ship, dmg = D.HIT_DMG[this.region] * mult;
    ship.hp = Math.max(0, ship.hp - dmg); pl.inv = 1.0; pl.flash = 0.12; pl.shake = 0.5; this.hits++;
    G.Sfx.play('hit'); for (let i = 0; i < 12; i++) this.sparks.add({ x: pl.x + (R() - 0.5) * 10, y: pl.y + (R() - 0.5) * 20, vx: (R() - 0.5) * 120, vy: (R() - 0.5) * 120, age: 0, life: 0.3 });
    G.UI.float(pl.x, pl.y - 30, `-${dmg}`, '#ff8a7a');
    // 甲板上掉 1 箱，飞出船外
    if (ship.deck.length) { const it = ship.deck.pop(), side = R() < 0.5 ? -1 : 1; this.crates.push({ x: pl.x + side * 8, y: pl.y - 6, vx: side * (60 + R() * 40), vy: -50 - R() * 30, t: 0, item: it, rot: 0, own: true }); this.stats.flown++; G.UI.float(pl.x, pl.y - 44, `甲板上的${D.itemName(it.k)}飞出去了！`, '#ffd27a', { life: 1.6 }); }
    if (ship.hp <= 0) this.die();
  };
  sc.updateCrates = function (dt) {
    const pl = this.pl, hb = this.hitbox();
    for (const c of this.crates) {
      if (c.done) continue; c.t += dt;
      if (c.auto && c.t > 0.5) { const d = U.dist(c.x, c.y, pl.x, pl.y); c.x += (pl.x - c.x) * Math.min(1, dt * 5); c.y += (pl.y - c.y) * Math.min(1, dt * 5); if (d < 8) this.catchCrate(c); continue; }
      if (c.t < 1) { c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 1 - dt * 1.5; c.vy *= 1 - dt * 1.5; } else { c.y += 16 * dt; c.x += Math.sin(c.t * 2) * 6 * dt; }
      if (c.t % 0.25 < dt) c.rot = (c.rot + 1) % 4;
      c.x = U.clamp(c.x, FX0 + 6, FX1 - 6);
      if (!pl.dead && Math.abs(c.x - pl.x) < pl.w / 2 + 4 && Math.abs(c.y - pl.y) < pl.h / 2) this.catchCrate(c);
      else if (c.t > 10 || c.y > FH + 10) { c.done = true; this.stats.lost++; G.Sfx.play('lost'); G.UI.float(c.x, Math.min(c.y, FH - 20), '掉进云海', '#c8c0d8'); }
    }
    this.crates = this.crates.filter(c => !c.done);
  };
  sc.catchCrate = function (c) { c.done = true; this.loot.push(c.item); this.stats.caught++; G.Sfx.play('catch'); G.UI.float(c.x, c.y - 10, `接住 ${D.itemName(c.item.k)}`, '#b8f0a0'); this.puffs.add({ x: c.x, y: c.y, vx: 0, vy: -10, r: 2, age: 0, life: 0.4 }); };
  sc.sparkAt = function (x, y, n) { for (let i = 0; i < n * 3; i++) this.sparks.add({ x, y, vx: (R() - 0.5) * 80, vy: (R() - 0.5) * 80, age: 0, life: 0.2 }); };

  /* ---------------- 结束：战后面板 ---------------- */
  sc.finish = function (won) {
    if (this.panel) return;
    const ship = this.ship, ss = S.stats(ship);
    for (const c of this.crates) if (!c.done) { this.stats.lost++; } this.crates = [];
    ship.hp = Math.max(1, ship.hp - Math.round(ss.hpMax * 0.05)); // 每场副本出来固定磨掉 5%，最低留 1
    // 战利品先进舱，舱满了自动堆上甲板；放不下的列出来
    const over = []; for (const it of this.loot) if (!S.addCargo(ship, it)) over.push(it);
    this.panel = { over, won };
    // 默认推荐扔「每格最便宜」的：放不下的里面有比船上更贵的，就互换
    let guard = 0; while (over.length && guard++ < 40) { const oi = over.reduce((b, it, k) => D.baseValue(it) > D.baseValue(over[b]) ? k : b, 0); if (!this.keepOver(oi, true)) break; }
    this.st.flags.firstBattle = false; this.st.log.crates += this.stats.caught;
    if (['buy', 'fight'].includes(this.st.flags.tut)) this.st.flags.tut = 'home';
    G.UI.banner = null;
    Game.save();
  };
  /* 留下一件放不下的货：换掉船上最便宜的那件（auto 时只在更值钱时才换） */
  sc.keepOver = function (oi, auto) {
    const ship = this.ship, p = this.panel, it = p.over[oi]; let where = null, j = -1, v = 1e9;
    for (const w of ['hold', 'deck']) ship[w].forEach((x, k) => { const bv = D.baseValue(x); if (bv < v) { v = bv; where = w; j = k; } });
    if (!where || (auto && v >= D.baseValue(it))) return false;
    p.over[oi] = ship[where][j]; ship[where][j] = it; return true;
  };
  sc.leave = function () {
    const p = this.panel, ship = this.ship;
    if (p.over.length) G.UI.toast(`扔掉了 ${p.over.length} 件放不下的`, '#d8d0c4');
    Game.save();
    Game.go('map', { after: { won: p.won, patrolId: this.P.patrolId, chase: this.P.kind === 'chase' } }, { fade: 0.3 });
  };

  /* ---------------- 被击落：留下哪一件 ---------------- */
  sc.die = function () {
    const pl = this.pl; pl.dead = true; G.Sfx.play('boom');
    for (let i = 0; i < 40; i++) this.sparks.add({ x: pl.x + (R() - 0.5) * 20, y: pl.y + (R() - 0.5) * 40, vx: (R() - 0.5) * 200, vy: (R() - 0.5) * 200, age: 0, life: 0.6 });
    const ship = this.ship, items = ship.hold.concat(ship.deck, this.loot, this.crates.filter(c => c.own).map(c => c.item));
    this.crates = []; this.eb = [];
    const best = items.reduce((b, it, i) => (b < 0 || D.baseValue(it) > D.baseValue(items[b])) ? i : b, -1);
    this.downModal = { items, pick: best, t: 10 };
  };
  sc.updateDown = function (dt) { const m = this.downModal; m.t -= dt; this.sparks.step(dt); if (m.t <= 0) this.sink(); };
  sc.sink = function () {
    const st = this.st, m = this.downModal, ship = this.ship;
    const keep = m.pick >= 0 ? m.items[m.pick] : null, rest = m.items.filter((_, i) => i !== m.pick).sort((a, b) => D.baseValue(b) - D.baseValue(a));
    const sunk = rest.filter((_, i) => i % 2 === 0);
    ship.hold = keep ? [keep] : []; ship.deck = [];
    if (sunk.length && m.items.length > 1) { const pos = st.mapPos || { x: 1200, y: 1000 }; st.world.sunk = { x: pos.x, y: pos.y + 40, r: this.region, items: sunk, until: st.day + 1, guardBeaten: false, name: '你的沉船' }; st.world.patrols.push({ id: 'sunk', x: pos.x + 60, y: pos.y + 10, ax: pos.x + 60, ay: pos.y + 10, r: this.region, cargo: [], alive: true, kind: 'guard', t: 0 }); }
    this.downModal = null; st.phase = 'day'; Game.save();
    G.UI.toast(sunk.length ? `一半的货沉在原地（${sunk.length} 件），明天结束前打赢守货的海盗能捞回来` : '货都没了', '#ffd8cc', 5);
    Game.go('island', { towed: true }, { fade: 0.8 });
  };

  /* ---------------- 画 ---------------- */
  sc.draw = function (g, f) {
    const SP = this.SP, pl = this.pl, sh = pl.shake > 0 ? ((f % 2) ? 2 : -2) : 0;
    g.fillStyle = '#16121c'; g.fillRect(0, 0, 640, 360);
    const bh = SP.bgH, off = Math.floor(this.scroll % bh);
    g.save(); g.beginPath(); g.rect(FX0, 0, FW, FH); g.clip(); g.translate(sh, 0);
    for (let y = off - bh; y < FH; y += bh) g.drawImage(SP.bgImg, FX0, y);
    this.puffs.each(p => A.blob(g, p.x, p.y, p.r + p.age * 6, ['#f0eef4', '#cfcbd8', '#a8a2b8']));
    // 敌船
    for (const e of this.en) {
      const x = Math.round(e.x - e.im.w / 2), y = Math.round(e.y - e.im.h / 2);
      if (e.flash > 0) A.drawFlash(g, e.im.img, x, y, 0.75); else g.drawImage(e.im.img, x, y);
      if (e.cargo.some(c => c.k !== 'mod')) { const c = e.cargo.find(c => c.k !== 'mod'); const ci = SP.crates[c.k] || SP.crates.mat; g.drawImage(ci.img, Math.round(e.x - ci.w / 2), y + 6); }
      if (e.cargo.some(c => c.k === 'mod')) { g.fillStyle = (f >> 1) % 2 ? '#ffd24c' : '#fff4b0'; g.fillRect(Math.round(e.x) - 1, y + e.im.h - 18, 3, 3); }
      if (e.hp < e.hpMax) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y - 4, e.im.w, 2); g.fillStyle = e.elite ? '#ffb43a' : '#e0574a'; g.fillRect(x, y - 4, Math.round(e.im.w * e.hp / e.hpMax), 2); }
    }
    // 我们的子弹（黄铜色）
    for (const b of this.bul) { g.fillStyle = '#7a4a10'; g.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 4, 3, 8); g.fillStyle = '#ffd24c'; g.fillRect(Math.round(b.x), Math.round(b.y) - 4, 1, 7); }
    // 货箱
    for (const c of this.crates) { const ci = SP.crates[c.item.k] || SP.crates.mat, blink = c.t > 7 && (f % 2); if (blink) continue; g.save(); g.translate(Math.round(c.x), Math.round(c.y)); g.rotate(c.rot * Math.PI / 2); g.drawImage(ci.img, -Math.round(ci.w / 2), -Math.round(ci.h / 2)); g.restore(); g.strokeStyle = c.own ? 'rgba(255,220,120,0.9)' : 'rgba(255,255,255,0.7)'; g.strokeRect(Math.round(c.x - ci.w / 2) - 1.5, Math.round(c.y - ci.h / 2) - 1.5, ci.w + 3, ci.h + 3); }
    // 玩家
    if (!pl.dead) {
      for (const t of pl.trail) { g.globalAlpha = t.t * 2; g.drawImage(SP.ship.img, Math.round(t.x - pl.w / 2), Math.round(t.y - pl.h / 2)); } g.globalAlpha = 1;
      const x = Math.round(pl.x - pl.w / 2), y = Math.round(pl.y - pl.h / 2), blink = pl.inv > 0 && this.state !== 'intro' && (f % 2);
      if (!blink) { if (pl.flash > 0) A.drawFlash(g, SP.ship.img, x, y, 0.8); else g.drawImage(SP.ship.img, x, y); }
      // 甲板上的货也看得见
      const deck = this.ship.deck, ci = SP.crates.tea; deck.slice(0, 8).forEach((it, i) => { const im = SP.crates[it.k] || SP.crates.mat, side = i % 2 ? 1 : -1, row = Math.floor(i / 2); g.drawImage(im.img, Math.round(pl.x + side * (pl.w / 2 - 2) - im.w / 2), Math.round(pl.y - 10 + row * (im.h - 1))); });
      if (this.skill > 0) { g.fillStyle = `rgba(255,220,120,${0.25 + 0.15 * Math.sin(this.t * 30)})`; g.fillRect(x - 3, y - 3, pl.w + 6, 4); }
      const hb = this.hitbox(); g.fillStyle = '#1b1209'; g.fillRect(Math.round(hb.x) - 2, Math.round(hb.y) - 2, 5, 5); g.fillStyle = '#fff8e0'; g.fillRect(Math.round(hb.x) - 1, Math.round(hb.y) - 1, 3, 3);
    }
    // 敌弹最后画：画面上最清楚的东西
    for (const b of this.eb) { const x = Math.round(b.x), y = Math.round(b.y); g.fillStyle = EB_COLS[0]; g.fillRect(x - 3, y - 2, 7, 5); g.fillRect(x - 2, y - 3, 5, 7); g.fillStyle = EB_COLS[1]; g.fillRect(x - 2, y - 2, 5, 5); g.fillStyle = EB_COLS[2]; g.fillRect(x - 1, y - 1, 3, 3); g.fillStyle = EB_COLS[3]; g.fillRect(x, y - 1, 1, 1); }
    this.sparks.each(p => A.R(g, p.c || A.FIRE[Math.min(3, (p.age / p.life * 4) | 0)], p.x, p.y, 2, 2));
    g.restore();
    // 两边的框
    g.fillStyle = '#2a2018'; g.fillRect(FX0 - 3, 0, 3, 360); g.fillRect(FX1, 0, 3, 360); g.fillStyle = '#c8963e'; g.fillRect(FX0 - 1, 0, 1, 360); g.fillRect(FX1, 0, 1, 360);
  };
  sc.ui = function (u) {
    const C = u.C, ship = this.ship, ss = this.ss, pl = this.pl;
    const name = this.P.kind === 'chase' ? '追兵战' : this.P.kind === 'guard' ? '守货的海盗' : '遭遇战';
    u.text(`${name} · ${this.region === 'inner' ? '内圈' : '边境'}`, 88, 26, { size: 10, bold: true, serif: true, align: 'center', color: C.brassL });
    u.text('船体值', 16, 48, { size: 6.5, color: C.muted }); u.bar(16, 52, 140, 6, ship.hp / ss.hpMax, ship.hp / ss.hpMax > 0.4 ? '#8fd06a' : '#e0574a'); u.text(`${Math.ceil(ship.hp)} / ${ss.hpMax}`, 156, 48, { size: 6.5, align: 'right' });
    u.text(`被打中一次 -${D.HIT_DMG[this.region]}，撞船 ×2`, 16, 70, { size: 6, color: C.muted });
    u.text(`甲板货 ${ship.deck.length} 箱`, 16, 88, { size: 7, color: ship.deck.length ? '#ffd27a' : C.fg, bold: true }); u.text('被打中先飞出去一箱，10 秒内飞过去接', 16, 99, { size: 5.8, color: C.muted });
    u.text(`接住的战利品 ${this.loot.length}`, 16, 118, { size: 7, bold: true });
    this.loot.slice(0, 12).forEach((it, i) => { const ci = this.SP.crates[it.k] || this.SP.crates.mat; if (it.k === 'mod') u.text('◆', 20 + (i % 6) * 22, 136 + Math.floor(i / 6) * 16, { size: 8, color: D.Q[it.q].color }); else u.img(ci, 16 + (i % 6) * 22, 126 + Math.floor(i / 6) * 16, 1); });
    u.text(`飞出 ${this.stats.flown}　接住 ${this.stats.caught}　掉了 ${this.stats.lost}`, 16, 172, { size: 6, color: C.muted });
    // 右边：技能、冲刺
    const x = 480; u.text('技能「铜雨」', x, 48, { size: 7, bold: true, color: ss.gun ? C.brassL : C.muted }); u.bar(x, 53, 140, 6, this.gauge / 100, this.gauge >= 100 ? '#ffd24c' : '#c8963e');
    u.text(this.gauge >= 100 ? '满了：按 E 清弹 + 五道弹流' : '擦弹（子弹贴身飞过）和击落充能', x, 70, { size: 6, color: this.gauge >= 100 ? '#ffe08a' : C.muted });
    u.text('冲刺', x, 90, { size: 7, bold: true }); u.bar(x + 24, 85, 60, 4, 1 - pl.dcd / 0.9, '#8cc8ff'); u.text('空格：短冲刺，途中无敌', x, 102, { size: 6, color: C.muted });
    u.text(`敌船 ${this.en.length}　第 ${Math.min(this.wave, this.waves.length)} / ${this.waves.length} 波`, x, 124, { size: 7 });
    u.text(`速度档 ${D.TIERS[ss.tier].name}（副本移速 ×${D.TIERS[ss.tier].shmup}）`, x, 140, { size: 6, color: C.muted });
    u.text('自动开火　判定点是船中间的小白点', x, 330, { size: 6, color: C.muted }); u.text('WASD 移动　空格 冲刺　E 技能', x, 342, { size: 6, color: C.muted });
    if (this.first && this.state === 'fight' && this.t < 6) u.hint('自动开火：只管躲子弹。判定点是船中间的小白点。敌船甲板上的货会飞出来');
    if (this.panel) this.panelUI(u);
    if (this.downModal) this.downUI(u);
  };
  sc.panelUI = function (u) {
    const C = u.C, p = this.panel, ship = this.ship, ss = S.stats(ship), st = this.st;
    u.rect(0, 0, 640, 360, 'rgba(8,6,10,0.55)');
    u.panel(120, 26, 400, 310, { fill: 'rgba(30,22,14,0.97)', r: 6 });
    u.text(p.won ? '打赢了' : '撤出来了', 320, 50, { size: 14, bold: true, serif: true, align: 'center', color: '#ffd24c' });
    u.text(`接住 ${this.stats.caught} 箱，掉进云海 ${this.stats.lost} 箱　船体值 ${Math.ceil(ship.hp)} / ${ss.hpMax}（出副本磨掉 5%）`, 320, 64, { size: 6.5, align: 'center', color: C.muted });
    const chip = (it, x, y, on) => { const ci = G.SPR.map.crates[it.k] || G.SPR.map.crates.mat; u.panel(x, y, 52, 16, { fill: on ? 'rgba(120,80,30,0.95)' : 'rgba(52,38,26,0.9)', stroke: it.tag ? '#ffd27a' : C.brass, r: 3 }); if (it.k === 'mod') u.text('◆', x + 6, y + 11, { size: 7, color: D.Q[it.q].color }); else u.img(ci, x + 3, y + 4, 1); u.text(it.k === 'mod' ? D.MODULES[it.type].name : D.itemName(it.k), x + 13, y + 11, { size: 6 }); u.text(String(D.baseValue(it)), x + 49, y + 11, { size: 5, align: 'right', color: C.muted }); return u.clicked(x, y, 52, 16); };
    u.text(`舱 ${ship.hold.length} / ${ss.holdCap}`, 140, 84, { size: 8, bold: true, color: S.holdFull(ship) ? '#ffd27a' : C.fg });
    ship.hold.forEach((it, i) => { if (chip(it, 140 + (i % 4) * 56, 90 + Math.floor(i / 4) * 19, false)) this.move('hold', i); });
    u.text(`甲板 ${ship.deck.length} / ${ss.deckCap}`, 140, 196, { size: 8, bold: true, color: ship.deck.length ? '#ffd27a' : C.fg });
    ship.deck.forEach((it, i) => { if (chip(it, 140 + (i % 4) * 56, 202 + Math.floor(i / 4) * 19, true)) this.move('deck', i); });
    u.text('点一下在舱和甲板之间挪（满了就互换）', 140, 254, { size: 6, color: C.muted });
    if (!st.flags.deckHint && ss.deckCap > 0) u.text('把贵货拖上甲板：今晚多卖三成，但挨打时先飞出去', 140, 266, { size: 6.5, color: '#ffd27a', bold: true });
    if (p.over.length) {
      u.text('放不下的：会扔掉', 380, 84, { size: 8, bold: true, color: '#ffb0a0' });
      p.over.forEach((it, i) => { if (chip(it, 380, 90 + i * 19, false)) { if (this.keepOver(i, false)) G.Sfx.play('click'); } });
      u.text('点一件：留下它，换掉船上最便宜的', 380, 90 + p.over.length * 19 + 10, { size: 5.5, color: C.muted });
    }
    if (u.button(250, 300, 140, 24, '继续航行', { primary: true, key: ['Enter', 'KeyE'] })) { st.flags.deckHint = true; this.leave(); }
  };
  sc.move = function (from, i) {
    const ship = this.ship, ss = S.stats(ship), to = from === 'hold' ? 'deck' : 'hold', cap = to === 'deck' ? ss.deckCap : ss.holdCap;
    const A2 = ship[from], B2 = ship[to];
    if (B2.length < cap) { B2.push(A2.splice(i, 1)[0]); }
    else if (B2.length) { const j = B2.reduce((b, it, k) => (D.baseValue(it) < D.baseValue(B2[b]) ? k : b), 0); const t = A2[i]; A2[i] = B2[j]; B2[j] = t; }
    else return;
    G.Sfx.play('click');
  };
  sc.downUI = function (u) {
    const C = u.C, m = this.downModal;
    u.rect(0, 0, 640, 360, 'rgba(30,6,6,0.6)');
    u.panel(140, 50, 360, 260, { fill: 'rgba(30,14,10,0.97)', stroke: C.red, lw: 1.5, r: 6 });
    u.text('被击落了', 320, 76, { size: 15, bold: true, serif: true, align: 'center', color: '#ffd8cc' });
    u.text(`留下哪一件？（${Math.ceil(m.t)} 秒后自动留最值钱的）`, 320, 92, { size: 7.5, align: 'center' });
    u.text('其余的一半沉在原地，明天结束前打赢守货的海盗能捞回来；船免费拖回家修好，装着的模块不会丢', 320, 104, { size: 6, align: 'center', color: C.muted });
    m.items.forEach((it, i) => { const x = 160 + (i % 5) * 64, y = 114 + Math.floor(i / 5) * 22, on = i === m.pick, ci = G.SPR.map.crates[it.k] || G.SPR.map.crates.mat; u.panel(x, y, 60, 18, { fill: on ? 'rgba(160,110,30,0.95)' : 'rgba(52,38,26,0.9)', stroke: on ? '#ffd24c' : C.brass, r: 3 }); if (it.k === 'mod') u.text('◆', x + 6, y + 12, { size: 7, color: D.Q[it.q].color }); else u.img(ci, x + 4, y + 5, 1); u.text(it.k === 'mod' ? D.MODULES[it.type].name : D.itemName(it.k), x + 14, y + 12, { size: 6.5 }); u.text(String(D.baseValue(it)), x + 56, y + 12, { size: 5.5, align: 'right', color: C.muted }); if (u.clicked(x, y, 60, 18)) { m.pick = i; G.Sfx.play('click'); } });
    if (!m.items.length) u.text('货舱是空的', 320, 150, { size: 8, align: 'center', color: C.muted });
    if (u.button(250, 280, 140, 22, '就留这件', { primary: true, key: ['Enter', 'KeyE'] })) this.sink();
  };
  sc.blockEsc = function () { return !!(this.panel || this.downModal); };
  Game.reg('shmup', sc);
})(window.G);
