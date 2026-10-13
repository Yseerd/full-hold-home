/* 自动试玩用的小钩子（无头 Chrome 里用）。玩家用不到。 */
(function (G) {
  'use strict';
  G.Test = {
    init() { },
    info() {
      const Game = G.Game, st = Game.st, sc = Game.scene || {};
      const o = { scene: Game.sceneName, err: Game.lastError || null, fade: !!Game.fade };
      if (st) { const sh = G.S.ship(st), ss = G.S.stats(sh); Object.assign(o, { day: st.day, gold: st.gold, mat: st.mat, rep: st.rep, stars: st.stars, tut: st.flags.tut, hold: sh.hold.map(i => i.k), deck: sh.deck.map(i => i.k), hp: sh.hp, tier: ss.tier, wh: st.warehouse.length, mods: st.modules.length, phase: st.phase }); }
      if (Game.sceneName === 'map' && Game.sea) Object.assign(o, { x: Math.round(Game.sea.x), y: Math.round(Game.sea.y), chase: Game.sea.chase ? Math.round(Game.sea.chase.t * 10) / 10 : null, modal: sc.modal ? sc.modal.type : null });
      if (Game.sceneName === 'map' && sc.battle) { const b = sc.battle; Object.assign(o, { battle: b.phase, dir: b.dir, en: b.en.length, eb: b.eb.length, wave: b.wave, waves: b.waves.length, loot: b.loot.length, crates: b.crates.length, gauge: Math.round(b.gauge), hits: b.hits, kills: b.stats.kills, caught: b.stats.caught, lost: b.stats.lost }); }
      if (Game.sceneName === 'market') Object.assign(o, { custs: sc.custs.length, served: sc.res.served, left: sc.res.left, card: !!sc.card, carry: sc.carry.length });
      if (Game.sceneName === 'island') Object.assign(o, { cap: [Math.round(sc.cap.x), Math.round(sc.cap.y)], modal: sc.modal ? sc.modal.type : null, arrive: !!sc.arrive });
      return o;
    },
  };
})(window.G);
/* 快速搭场景：开局、木筏装好、站到某处 */
G.Test.setup = function (o = {}) {
  const S = G.S, Game = G.Game; const st = Game.st = S.newGame(o.seed || 12345);
  const raft = st.ships[0]; raft.hold = []; raft.deck = [];
  st.flags.tut = o.tut || 'free'; st.flags.firstBattle = o.firstBattle ?? false; st.flags.nights = o.nights ?? 0;
  if (o.gold != null) st.gold = o.gold; if (o.mat != null) st.mat = o.mat;
  if (o.beast) { const b = { id: 'beast', hull: 'beast', name: '驮兽货船', slots: S.emptySlots('beast'), hp: 150, hold: [], deck: [] }; const sl = b.slots; sl.hold = [S.mod('cockpit'), ...Array(10).fill(0).map(() => S.mod('container')), S.mod('balloon')]; sl.top = Array(6).fill(0).map(() => S.mod('balloon')); sl.bow = [S.mod('gun')]; sl.pair = [S.mod('armor')]; sl.tail = [S.mod('engine'), S.mod('engine')]; b.hp = S.stats(b).hpMax; st.ships.push(b); st.active = 1; }
  for (const [k, n, tag, sea] of (o.cargo || [])) for (let i = 0; i < n; i++) S.addCargo(S.ship(st), { k, sea: sea ?? true, tag });
  for (const [k, n, tag, sea] of (o.ware || [])) for (let i = 0; i < n; i++) st.warehouse.push({ k, sea: sea ?? true, tag });
  if (o.hot) st.board.hot = o.hot;
  if (o.map) { Game.sea = null; st.mapPos = { x: o.map[0], y: o.map[1] }; Game.go(o.scene || 'map', { resume: true }, { fade: 0 }); }
  else Game.go(o.scene || 'island', o.params || {}, { fade: 0 });
  return true;
};
/* 横版战斗里该往哪走（无头试跑和自动演示共用）：看飞来的敌弹，挑一个最安全的方向；没危险时对准敌船（炮口那一行），有箱子就去接。
   只读状态，返回要按的键（已经按船头朝向换成屏幕上的左右）。 */
G.Test.battleKeys = function () {
  const U = G.U, sc = G.Game.scene, b = sc && sc.battle; if (!b || !(b.phase === 'fight' || b.phase === 'clear') || b.pl.dead) return null;
  const pl = b.pl, hb = b.hitbox(), mz = b.muzzle(), spd = b.moveSpeed(), Sp = b.Sp, H = 360;
  const off = { x: hb.x - pl.x, y: hb.y - pl.y }, mzo = mz.y - pl.y, X0 = Sp.w / 2 + 4, X1 = 400, Y0 = Sp.h / 2 + 12, Y1 = H - 12 - Sp.h / 2;
  let tx = 150, ty = pl.y;
  const crate = b.crates.filter(c => !c.done && !c.fly && !c.auto).sort((a, c) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(c.x - pl.x, c.y - pl.y))[0];
  if (crate) { tx = U.clamp(crate.x - 10, X0, X1); ty = crate.y; }
  else { const es = b.en.filter(e => !e.retreat && e.x < 630 && e.x > 0); if (es.length) { const e = es.sort((a, c) => Math.abs(a.y - mzo - pl.y) - Math.abs(c.y - mzo - pl.y))[0]; ty = e.y - mzo; } }
  const DIRS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let best = null;
  for (const [mx, my] of DIRS) {
    const l = Math.hypot(mx, my) || 1, vx = mx / l * spd, vy = my / l * spd; let danger = 0;
    for (let k = 1; k <= 8; k++) {
      const t = k * 0.06, px = U.clamp(pl.x + vx * t, X0, X1) + off.x, py = U.clamp(pl.y + vy * t, Y0, Y1) + off.y;
      for (const e of b.eb) { const d = Math.hypot(e.x + e.vx * t - px, e.y + e.vy * t - py); if (d < 11) danger += (11 - d) * (1.6 - t); }
      for (const e of b.en) if (!e.retreat && Math.abs(px - e.x) < e.w * 0.45 && py > e.y - e.h * 0.1 && py < e.y + e.h * 0.5) danger += 12;
    }
    const fx = U.clamp(pl.x + vx * 0.2, X0, X1), fy = U.clamp(pl.y + vy * 0.2, Y0, Y1);
    const score = danger * 10 + Math.abs(fx - tx) * 0.03 + Math.abs(fy - ty) * 0.06 + (mx || my ? 0.01 : 0);
    if (!best || score < best.score) best = { mx, my, score, danger };
  }
  const keys = [], sx = best.mx * b.dir;
  if (sx > 0) keys.push('KeyD'); if (sx < 0) keys.push('KeyA'); if (best.my > 0) keys.push('KeyS'); if (best.my < 0) keys.push('KeyW');
  return { keys, dash: best.danger > 14 && pl.dcd <= 0, skill: b.gauge >= 100 && b.phase === 'fight' && !!G.S.stats(G.S.ship(G.Game.st)).gun, danger: Math.round(best.danger) };
};
