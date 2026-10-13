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
      if (Game.sceneName === 'shmup') Object.assign(o, { en: sc.en.length, eb: sc.eb.length, state: sc.state, panel: !!sc.panel, down: !!sc.downModal, loot: sc.loot.length, crates: sc.crates.length });
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
