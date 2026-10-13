/* 游戏状态：存档就是这一个对象（纯 JSON）。所有改动都走这里的函数，以后接联机时这些函数就是主机上的指令。 */
(function (G) {
  'use strict';
  const D = G.D, U = G.U;
  const S = G.S = {};
  const SAVE_KEY = window.MCG_SAVE_KEY || 'mcg-slice-save-v1'; // demo.html 用另一个存档位，不碰玩家自己的存档
  let uid = 1;
  const mod = (type, q = 0) => ({ uid: uid++, type, q });
  S.mod = mod;

  S.emptySlots = h => { const H = D.HULLS[h]; return { top: Array(H.top).fill(null), hold: Array(H.hold).fill(null), bow: Array(H.bow).fill(null), pair: Array(H.pair).fill(null), tail: Array(H.tail).fill(null) }; };

  S.newGame = function (seed = (Date.now() & 0x7fffffff)) {
    const st = {
      v: 1, seed, rng: seed, day: 1, phase: 'morning', gold: 200, mat: 30, rep: 0, stars: 0,
      dockLevel: 2, marketLevel: 1, warehouseCap: 40,
      warehouse: [], modules: [],
      ships: [{ id: 'raft', hull: 'raft', name: '木筏', slots: S.emptySlots('raft'), hp: 100, hold: [], deck: [] }],
      active: 0,
      board: { hot: ['wine', 'gear'], orders: [], accepted: null },
      world: { patrols: [], wrecks: [], sunk: null, stock: {}, chasers: [] },
      flags: { tut: 'opening', firstBattle: true, deckHint: false, twoOrderHint: false, nights: 0 },
      log: { voyages: 0, caught: 0, crates: 0, best: 0 },
      uidNext: 1,
    };
    // 开场：阿爷留下的旧木筏，舱里 4 箱茶叶，甲板上 2 箱香料
    const raft = st.ships[0], sl = raft.slots;
    sl.hold = [mod('cockpit'), mod('container'), mod('container')]; sl.top = [mod('balloon'), mod('balloon'), mod('balloon')]; sl.bow = [mod('gun')]; sl.tail = [mod('engine')];
    for (let i = 0; i < 4; i++) raft.hold.push({ k: 'tea', sea: false, src: '晴岚港' });
    for (let i = 0; i < 2; i++) raft.deck.push({ k: 'spice', sea: true, src: null });
    S.rollBoard(st, true); S.refreshWorld(st);
    return st;
  };

  /* ---------------- 随机数（存在存档里） ---------------- */
  S.rand = function (st) { const r = U.rng(st.rng); const v = r(); st.rng = r.state(); return v; };
  S.rint = (st, a, b) => a + Math.floor(S.rand(st) * (b - a + 1));
  S.rpick = (st, arr) => arr[Math.floor(S.rand(st) * arr.length)];
  S.rweight = (st, pairs) => { const tot = U.sum(pairs.map(p => p[1])); let r = S.rand(st) * tot; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[pairs.length - 1][0]; };

  /* ---------------- 船的数值（「两条规矩」） ---------------- */
  S.ship = st => st.ships[st.active];
  S.allMods = ship => Object.values(ship.slots).flat().filter(Boolean);
  S.stats = function (ship) {
    const H = D.HULLS[ship.hull], mods = S.allMods(ship), sl = ship.slots;
    const v = m => D.MODULES[m.type].val[m.q];
    const of = t => mods.filter(m => m.type === t);
    const lift = U.sum(of('balloon').map(v)), modW = U.sum(mods.map(m => D.MODULES[m.type].w));
    const holdCap = U.sum(of('container').map(v)), deckSlots = H.deck + U.sum(of('net').map(v));
    const fullW = H.self + modW + holdCap, thrust = U.sum(of('engine').map(v));
    let deckCap = Math.max(0, Math.min(deckSlots, lift - fullW));
    while (deckCap > 0 && thrust / (fullW + deckCap) < 0.6) deckCap--; // 甲板货不能让推重比低于 0.6
    const cargo = ship.hold.length + ship.deck.length, curW = H.self + modW + cargo;
    const twr = thrust / curW, twrEmpty = thrust / (H.self + modW), twrFull = thrust / fullW;
    const gun = sl.bow.find(m => m && m.type === 'gun');
    const s = {
      lift, modW, holdCap, deckSlots, deckCap, fullW, thrust, curW, twr, twrEmpty, twrFull, tier: D.tierOf(twr), tierEmpty: D.tierOf(twrEmpty), tierFull: D.tierOf(twrFull),
      hpMax: H.hp + U.sum(of('armor').map(v)), cockpits: of('cockpit').length, engines: of('engine').length, gun: gun || null, dmg: gun ? v(gun) : 0.5,
      charge: of('cockpit').length ? D.MODULES.cockpit.val[of('cockpit')[0].q] : 0, topN: sl.top.filter(m => m && m.type === 'balloon').length,
      red: [], yellow: [],
    };
    if (s.cockpits !== 1) s.red.push(s.cockpits ? '驾驶舱只能装 1 个' : '没装驾驶舱');
    if (lift < fullW) s.red.push(`升力不够满载重量，差 ${fullW - lift}`);
    if (!s.engines) s.red.push('一个引擎都没有');
    else if (twrFull < 0.6) s.red.push(`满载推重比 ${twrFull.toFixed(2)}，低于 0.6`);
    if (!gun) s.yellow.push('船头没有主炮：副本里只有一门半伤害的小炮');
    if (s.engines && s.tierFull === 0) s.yellow.push('满载是「慢」');
    return s;
  };

  /* 推荐装法（D.HULLS[..].rec）还缺哪些模块：仓库里的 + 这艘船上装着的 + extra 都算有；补齐要多少金币和船材 */
  S.kit = function (st, ship, extra = []) {
    const rec = D.HULLS[ship.hull].rec, need = {}, have = {};
    for (const g in rec) for (const t of rec[g]) need[t] = (need[t] || 0) + 1;
    for (const m of st.modules.concat(S.allMods(ship), extra)) have[m.type] = (have[m.type] || 0) + 1;
    const missing = {}; let gold = 0, mat = 0, n = 0;
    for (const t of D.MOD_ORDER) { const k = Math.max(0, (need[t] || 0) - (have[t] || 0)); if (k) { missing[t] = k; gold += k * D.MODULES[t].cost[0]; mat += k * D.MODULES[t].cost[1]; n += k; } }
    return { missing, gold, mat, n, can: st.gold >= gold && st.mat >= mat };
  };
  /* 造驮兽货船（现在这艘船的模块搬过去）再补齐推荐装法，一共要多少；已经有了返回 null */
  S.beastGoal = function (st) {
    if (st.ships.some(s => s.hull === 'beast')) return null;
    const c = D.HULLS.beast.cost, k = S.kit(st, { hull: 'beast', slots: S.emptySlots('beast') }, S.allMods(S.ship(st)));
    return { gold: c[0] + k.gold, mat: c[1] + k.mat, kit: k };
  };

  /* ---------------- 货舱 ---------------- */
  S.value = items => U.sum(items.map(D.baseValue));
  S.cargoValue = ship => S.value(ship.hold) + S.value(ship.deck);
  S.heat = ship => D.heatOf(S.cargoValue(ship));
  S.space = ship => { const s = S.stats(ship); return { hold: s.holdCap - ship.hold.length, deck: s.deckCap - ship.deck.length }; };
  /* 先进舱，舱满了自动堆上甲板；都满了返回 null */
  S.addCargo = function (ship, item) { const sp = S.space(ship); if (sp.hold > 0) { ship.hold.push(item); return 'hold'; } if (sp.deck > 0) { ship.deck.push(item); return 'deck'; } return null; };
  S.holdFull = ship => { const s = S.stats(ship); return s.holdCap > 0 && ship.hold.length >= s.holdCap; };
  /* 扔货的顺序：只扔货箱和船材箱；先扔甲板上的，甲板里先扔最便宜的；甲板空了才扔舱里的 */
  S.nextThrow = function (ship) {
    const ok = it => it.k !== 'mod';
    const cheapest = arr => { let bi = -1; arr.forEach((it, i) => { if (ok(it) && (bi < 0 || D.baseValue(it) < D.baseValue(arr[bi]))) bi = i; }); return bi; };
    let i = cheapest(ship.deck); if (i >= 0) return { where: 'deck', i };
    i = cheapest(ship.hold); if (i >= 0) return { where: 'hold', i };
    return null;
  };

  /* ---------------- 夜市价钱 ---------------- */
  S.nightPrice = function (st, it, { hot = true } = {}) {
    const g = D.GOODS[it.k]; if (!g) return 0;
    const isHot = hot && st.board.hot.includes(it.k);
    return g.base * g.far * (isHot ? D.MARKET.hotMult : 1) * (1 + st.stars * D.MARKET.starBonus + (it.tag ? D.MARKET.tagBonus[it.tag] : 0));
  };

  /* ---------------- 告示板：今晚热门两种、两张大客户订单 ---------------- */
  S.rollBoard = function (st, first) {
    const pool = st.stars >= 1 ? ['tea', 'gear', 'wine', 'spice'] : ['tea', 'gear', 'wine', 'spice'];
    if (!first) { if (st.day === 2) st.board.hot = ['wine', 'spice']; else { const a = S.rpick(st, pool); let b = S.rpick(st, pool); while (b === a) b = S.rpick(st, pool); st.board.hot = [a, b]; } }
    const ordPool = st.stars >= 1 ? ['tea', 'gear', 'wine', 'spice'] : ['tea', 'gear'];
    st.board.orders = [0, 1].map(i => {
      const a = S.rpick(st, ordPool); let b = S.rpick(st, ordPool); let guard = 0; while (b === a && guard++ < 10) b = S.rpick(st, ordPool);
      const tot = S.rint(st, first ? 2 : 3, first ? 3 : 6), na = Math.max(1, Math.ceil(tot / 2)), nb = Math.max(1, tot - na);
      const due = first ? st.day + 1 : st.day + S.rint(st, 0, 1);
      return { who: S.rpick(st, D.ORDER_NAMES), need: a === b ? { [a]: na + nb } : { [a]: na, [b]: nb }, due };
    });
  };

  /* ---------------- 世界：每天刷新巡逻船、残骸，城镇补货 ---------------- */
  S.lootGood = (st, r) => S.rweight(st, D.LOOT[r]);
  S.refreshWorld = function (st) {
    const W = st.world, M = D.MAP;
    W.stock = {}; for (const t of M.towns) for (const s of t.sells) W.stock[t.id + ':' + s.k] = s.n;
    W.patrols = M.patrols.map((p, i) => {
      const cargo = [{ k: S.lootGood(st, p.r), sea: true }, { k: 'mat', sea: true }];
      const mods = S.rand(st) < 0.2 ? [{ k: 'mod', type: S.rpick(st, D.MOD_ORDER), q: S.rweight(st, D.MOD_DROP_Q[p.r]), sea: true }] : [];
      return { id: 'p' + i, x: p.x, y: p.y, ax: p.x, ay: p.y, r: p.r, cargo: cargo.concat(mods), alive: true, kind: 'patrol', t: S.rand(st) * 10 };
    });
    W.wrecks = M.wrecks.map((w, i) => { const n = S.rint(st, 2, 4), items = []; for (let j = 0; j < n; j++) items.push(S.rand(st) < 0.7 ? { k: S.lootGood(st, w.r), sea: true } : { k: 'mat', sea: true }); return { id: 'w' + i, x: w.x, y: w.y, r: w.r, items }; });
    W.chasers = []; W.bought = {};
    if (W.sunk && W.sunk.until < st.day) W.sunk = null;
    if (W.sunk) W.patrols.push({ id: 'sunk', x: W.sunk.x + 60, y: W.sunk.y - 30, ax: W.sunk.x + 60, ay: W.sunk.y - 30, r: W.sunk.r, cargo: [], alive: !W.sunk.guardBeaten, kind: 'guard', t: 0 });
  };
  /* 一天结束：夜市打烊（board=true）或直接睡觉（board=false，告示板不换） */
  S.endDay = function (st, board) {
    st.day++; st.phase = 'morning';
    if (board) S.rollBoard(st);
    if (st.board.accepted && st.board.accepted.due < st.day) st.board.accepted = null; // 期限内没交上，订单消失，没有惩罚
    S.refreshWorld(st);
    for (const sh of st.ships) sh.hp = S.stats(sh).hpMax;
  };

  /* ---------------- 回家：卸货、打满舱和冒尖标 ---------------- */
  S.unload = function (st) {
    const ship = S.ship(st), full = S.holdFull(ship), res = { full, heap: 0, hold: 0, deck: 0, mat: 0, mods: 0, goods: [], value: S.cargoValue(ship) };
    const tag = (it, t) => { if (full && D.GOODS[it.k]) it.tag = t; };
    for (const it of ship.hold) tag(it, 'full');
    for (const it of ship.deck) { tag(it, 'heap'); if (full && D.GOODS[it.k]) res.heap++; }
    const all = ship.hold.concat(ship.deck), keep = [];
    for (const it of all) {
      if (it.k === 'mat') { st.mat += 10; res.mat++; continue; }
      if (it.k === 'mod') { st.modules.push(mod(it.type, it.q)); res.mods++; continue; }
      if (st.warehouse.length >= st.warehouseCap) { keep.push(it); continue; }
      st.warehouse.push(it); res.goods.push(it);
    }
    res.hold = ship.hold.length; res.deck = ship.deck.length;
    ship.hold = keep; ship.deck = [];
    ship.hp = S.stats(ship).hpMax; // 回空岛免费修满
    st.log.best = Math.max(st.log.best, res.value);
    return res;
  };

  S.save = function (st) { try { st.uidNext = uid; localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) { } };
  S.load = function () { try { const s = localStorage.getItem(SAVE_KEY); if (!s) return null; const st = JSON.parse(s); uid = Math.max(uid, st.uidNext || 1000); return st; } catch (e) { return null; } };
  S.wipe = function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } };
})(window.G);
