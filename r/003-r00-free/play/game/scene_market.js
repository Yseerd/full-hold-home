/* 夜市：客人从码头一个接一个走到柜台，头上写着要什么；船长跑去摊位按 E 拿货（一次最多两位客人的），回柜台按 E 递给他们。
   5 秒内递到小费 +20%，10 秒内 +10%；耐心 15 秒，耗光就走。打烊结算把口碑拆开写。 */
(function (G) {
  'use strict';
  const D = G.D, S = G.S, U = G.U, A = G.Art, In = G.In, Game = G.Game, MK = D.MARKET;
  const R = U.R;
  /* 摊位（夜市背景图上的五个摊子；集市 1 级开放三个），柜台、排队位、码头 */
  /* 摊位的交互点（船长站的地方）挪到摊位正前面一点：以前有几个站在摊位底线后面，有了前后遮挡会被摊位挡住。挪了 2–11 像素，离柜台的远近几乎不变 */
  const STALLS = [
    { id: 'blue', x: 257, y: 145, box: [236, 104, 42, 34], lv: 1 },
    { id: 'green', x: 309, y: 151, box: [288, 108, 42, 36], lv: 1 },
    { id: 'red', x: 210, y: 155, box: [190, 112, 40, 34], lv: 1 },
    { id: 'orange', x: 181, y: 183, box: [162, 138, 38, 28], lv: 2 },
    { id: 'purple', x: 344, y: 183, box: [323, 138, 43, 36], lv: 2 },
  ];
  const COUNTER = { x: 265, y: 166, box: [238, 170, 54, 21] };
  const QUEUE = [[262, 198], [276, 198], [248, 199], [290, 199]];
  const ASIDE = [[310, 186], [322, 184], [334, 186], [316, 192], [328, 191], [340, 192]];
  /* 客人从码头走过来的路：沿着石板路，从码头台阶上来、走两块田中间的那条草地、从栅栏的缺口进集市（以前直线穿过田和栅栏；拉近镜头以后看得出来）。
     长了约一成三，第一位客人敲铃时从第 4 个点出发，到柜台的路和以前差不多长 */
  const PATH = [[560, 186], [497.6, 193.3], [465.1, 172.2], [444, 153.1], [413.4, 148.5], [384.7, 160], [379, 170.3], [363.6, 186.8], [318, 196]];
  const PATH_HEAD = 3;
  /* 客人走路 56 → 62 像素/秒：路绕了约一成，走快一成，从码头走到柜台的时间和以前一样 */
  const WAITL = [[360, 190], [368, 182], [374, 175], [379, 168], [382, 161], [386, 154], [392, 150], [400, 148]]; // 柜台前排满了：在来的路上排成一队（以前站在树丛里）
  const MarketAPI = G.Market = {};

  const stallsFor = st => STALLS.filter(s => s.lv <= st.marketLevel);
  const tagRank = t => t === 'heap' ? 2 : t === 'full' ? 1 : 0;
  MarketAPI.groups = function (items) { const m = new Map(); for (const it of items) { if (!D.GOODS[it.k]) continue; const key = it.k + '|' + (it.tag || '') + '|' + (it.sea ? 1 : 0); if (!m.has(key)) m.set(key, { k: it.k, tag: it.tag || null, sea: !!it.sea, n: 0 }); m.get(key).n++; } return [...m.values()].sort((a, b) => D.GOODS_ORDER.indexOf(a.k) - D.GOODS_ORDER.indexOf(b.k) || tagRank(b.tag) - tagRank(a.tag)); };
  /* 订单要的货：够就自动留出来（先留海货） */
  MarketAPI.reserve = function (st) {
    const o = st.board.accepted; if (!o) return null;
    const pool = st.warehouse.slice(), res = [];
    for (const [k, n] of Object.entries(o.need)) { const cand = pool.filter(i => i.k === k).sort((a, b) => (b.sea ? 1 : 0) - (a.sea ? 1 : 0)); if (cand.length < n) return { ok: false, items: [] }; for (let i = 0; i < n; i++) { res.push(cand[i]); pool.splice(pool.indexOf(cand[i]), 1); } }
    return { ok: true, items: res };
  };
  MarketAPI.autoPrep = function (st) {
    const rsv = MarketAPI.reserve(st), reserved = new Set(rsv && rsv.ok ? rsv.items : []);
    const avail = st.warehouse.filter(i => !reserved.has(i) && D.GOODS[i.k]);
    const types = D.GOODS_ORDER.filter(k => avail.some(i => i.k === k)).sort((a, b) => { const v = k => avail.filter(i => i.k === k).length * D.GOODS[k].base * D.GOODS[k].far * (st.board.hot.includes(k) ? 1.3 : 1); return v(b) - v(a); });
    const ss = stallsFor(st);
    return { stalls: ss.map((s, i) => ({ id: s.id, k: types[i] || null })), rsv, reservedSet: reserved };
  };
  MarketAPI.prepUI = function (u, st, prep) {
    const C = u.C, ss = stallsFor(st), rsv = prep.rsv;
    const avail = st.warehouse.filter(i => !prep.reservedSet.has(i) && D.GOODS[i.k]);
    u.panel(120, 40, 400, 272, { fill: 'rgba(36,26,18,0.97)', r: 6 });
    u.text('傍晚 · 摆摊', 320, 62, { size: 13, bold: true, serif: true, align: 'center', color: C.brassL });
    u.text('每个摊位摆一种货，从仓库自动补货。客人跟着货来：摊上几箱就来几位客人。离柜台越近，跑一趟越快。', 320, 76, { size: 6, align: 'center', color: C.muted });
    const dist = s => Math.round(U.dist(s.x, s.y, COUNTER.x, COUNTER.y));
    prep.stalls.forEach((p, i) => {
      const s = ss[i], x = 136 + i * 126, y = 86, n = p.k ? avail.filter(it => it.k === p.k).length : 0;
      u.panel(x, y, 118, 92, { fill: 'rgba(60,44,30,0.9)', stroke: p.k && st.board.hot.includes(p.k) ? '#ffb43a' : C.brass });
      u.text(`${['蓝', '绿', '红', '橙', '紫'][STALLS.indexOf(s)]}摊位 · 离柜台 ${dist(s)}`, x + 59, y + 12, { size: 6.5, align: 'center', color: C.muted });
      if (p.k) { u.img(G.SPR.night.crates[p.k], x + 59 - 10, y + 18, 2); u.text(`${D.GOODS[p.k].name} × ${n}`, x + 59, y + 50, { size: 8, bold: true, align: 'center' }); const g = D.GOODS[p.k]; u.text(`约 ${Math.round(g.base * g.far * (st.board.hot.includes(p.k) ? 1.3 : 1) * (1 + st.stars * 0.05))} 金${st.board.hot.includes(p.k) ? ' · 今晚热门' : ''}`, x + 59, y + 61, { size: 6, align: 'center', color: st.board.hot.includes(p.k) ? '#ffb43a' : '#ffe08a' }); }
      else u.text('空着', x + 59, y + 44, { size: 8, align: 'center', color: C.muted });
      if (u.button(x + 14, y + 68, 90, 16, '换一种货', { size: 6.5 })) { const types = [null, ...D.GOODS_ORDER.filter(k => avail.some(it => it.k === k))]; let j = types.indexOf(p.k); for (let t = 0; t < types.length; t++) { j = (j + 1) % types.length; if (!types[j] || !prep.stalls.some(q => q !== p && q.k === types[j])) break; } p.k = types[j]; }
    });
    const lock = STALLS.filter(s => s.lv > st.marketLevel).length; if (lock) u.text(`另外 ${lock} 个摊位要集市 2 级（升级集市这一段还没做）`, 320, 190, { size: 6, align: 'center', color: C.muted });
    const left = D.GOODS_ORDER.filter(k => avail.some(it => it.k === k) && !prep.stalls.some(p => p.k === k));
    if (left.length) u.text(`没摆上的：${left.map(k => D.GOODS[k].name + '×' + avail.filter(i => i.k === k).length).join('、')}（留在仓库）`, 320, 202, { size: 6.5, align: 'center', color: '#ffd27a' });
    const o = st.board.accepted;
    if (o) u.text(rsv && rsv.ok ? `订单：${o.who} 要的货已经留好（${rsv.items.length} 箱），她第一个来，你在柜台按 E 交货` : `订单：${o.who} 要的货还不够，今晚交不了（期限第 ${o.due} 天）`, 320, 216, { size: 6.5, align: 'center', color: rsv && rsv.ok ? '#b8f0a0' : C.muted });
    const crates = U.sum(prep.stalls.map(p => p.k ? avail.filter(i => i.k === p.k).length : 0));
    const canOpen = crates > 0 || (rsv && rsv.ok);
    u.text(canOpen ? `今晚 ${crates} 箱货，会来 ${crates} 位客人${rsv && rsv.ok ? '，加 1 位大客户' : ''}` : '摊位上一箱货都没有，也没有备齐货的订单：开不了市，只能直接睡觉', 320, 234, { size: 7, align: 'center', color: canOpen ? C.fg : '#ffb0a0' });
    if (u.button(220, 248, 200, 26, '敲铃开市', { primary: true, disabled: !canOpen, size: 10 })) return 'open';
    if (u.button(270, 282, 100, 18, '先不开（E）', { key: ['KeyE', 'Escape'] })) return 'close';
    return null;
  };

  /* ---------------- 夜市场景 ---------------- */
  const IV = G.IsleView;
  const sc = { smooth: true };
  sc.enter = function (p) {
    const st = this.st = Game.st; st.phase = 'night'; this.N = G.SPR.night;
    const prep = p.prep || MarketAPI.autoPrep(st);
    this.stalls = stallsFor(st).map((s, i) => ({ ...s, k: prep.stalls[i] ? prep.stalls[i].k : null, items: [] }));
    const reserved = prep.reservedSet || new Set();
    for (const s of this.stalls) if (s.k) { s.items = st.warehouse.filter(i => i.k === s.k && !reserved.has(i)).sort((a, b) => tagRank(b.tag) - tagRank(a.tag)); }
    // 摊上的货仍留在仓库里（存档里），卖出去那一刻才从仓库扣：中途退出不丢货
    this.order = prep.rsv && prep.rsv.ok ? { o: st.board.accepted, items: prep.rsv.items } : null;
    this.total = U.sum(this.stalls.map(s => s.items.length));
    this.cap = G.Walk.make(COUNTER.x, COUNTER.y - 4); this.carry = []; this.busy = 0;
    this.Z = IV.sets.night.Z; this.view = IV.camera('night'); IV.stepCam(this.view, 0, false, this.cap.x * this.Z, this.cap.y * this.Z - 40, true);
    this.cam = { toScreen: (x, y) => this.view.toScreen(x * this.Z, y * this.Z) }; // 飘字用逻辑坐标（640×360 那套），换到屏幕上
    this.custs = []; this.spawned = 0; this.spawnedNormal = 0; this.lesson = false; this.nextT = 0.4; this.t = 0; this.done = false; this.card = null; // 每晚从头数（以前没清零：第 2 晚起客人来不了，开市就打烊）
    this.res = { stall: 0, tips: 0, order: 0, repGold: 0, townGold: 0, slowSea: 0, served: 0, left: 0, heap: 0, full: 0, fast: 0 };
    this.coins = A.Pool(); this.bell = 1.2; G.Sfx.play('bell');
    this.pairLesson = st.flags.nights === 1 && !st.flags.twoOrderHint;
    if (this.order) this.spawn(true);
    Game.save();
  };
  sc.exit = function () { if (this.st.phase === 'night') this.st.phase = 'day'; };
  /* 能走的地方：isle_layout.js 里夜市那套（摊位、柜台、木桶只挡它们的底，摊位后面能走过去、会被挡住） */
  let okNightFn = null; const okNight = (x, y) => (okNightFn || (okNightFn = G.IsleView.okFn('night')))(x, y);

  MarketAPI.okNight = okNight; MarketAPI.STALLS = STALLS; MarketAPI.COUNTER = COUNTER;

  sc.interval = function () { const st = this.st; let base = Math.max(4, MK.interval - 0.5 * st.stars); if (st.flags.nights >= 2) base = Math.min(base, 5); return base * MK.slice * (0.5 + R()); };
  sc.spawn = function (big, want) {
    const head = this.spawned === 0 ? PATH_HEAD : 0; // 敲铃的时候，第一位客人已经走上栈桥了（不用干等他从码头走过来）
    const kinds = this.N.cust.length, c = { id: this.spawned++, big: !!big, img: big ? 3 : Math.floor(R() * 3), x: PATH[head][0], y: PATH[head][1], path: PATH.slice(head + 1).map(p => p.slice()), state: 'walk', pat: big ? 999 : MK.patience, t0: 0, want: want || null, face: -1, moving: true };
    if (!big) this.spawnedNormal = (this.spawnedNormal || 0) + 1;
    this.custs.push(c); return c;
  };
  /* 客人想要摊位上的一种货：热门是 2 倍机会；还没被点完的才点 */
  sc.pickWant = function () {
    const avail = this.stalls.filter(s => s.k && s.items.length - this.custs.filter(c => c.want === s.k && ['walk', 'queue', 'pier'].includes(c.state)).length > 0); // 已经拿了货（wait）的客人，那箱货已经离开摊位，不再算占用
    if (!avail.length) return null;
    const w = avail.map(s => [s.k, this.st.board.hot.includes(s.k) ? 2 : 1]); return S.rweight(this.st, w);
  };

  sc.update = function (dt) {
    const st = this.st; this.t += dt; this.coins.step(dt); this.bell = Math.max(0, this.bell - dt);
    IV.stepCam(this.view, dt, In.key('Tab'), this.cap.x * this.Z, this.cap.y * this.Z - 40); // 镜头跟着船长，按住 Tab 看全岛
    if (this.card) { for (const c of this.custs) this.walkC(c, dt); this.custs = this.custs.filter(c => c.path.length); return; } // 打烊卡后面，买完的客人照样走回码头
    // 来客。路上一个人都没有时，下一位马上从码头出发：以前平均隔 6 秒才来、再走 5 秒，船长差不多一半时间站在柜台后面没事做
    this.nextT -= dt;
    if (this.nextT > 0.3 && !this.custs.some(c => !c.big && (c.state === 'walk' || c.state === 'pier'))) this.nextT = 0.3;
    if (this.nextT <= 0 && (this.spawnedNormal || 0) < this.total) {
      const pairS = this.pairLesson && (this.spawnedNormal || 0) === 0 && this.stalls.find(s => s.items.length >= 2); // 没有一个摊位有两箱就不教，照常来客（以前这里会一直不来人）
      if (pairS) { const a = this.spawn(false, pairS.k); const b = this.spawn(false, pairS.k); b.x = a.x + 10; b.y = a.y; b.path = a.path.map(p => [p[0] + 8, p[1] + 2]); this.lesson = true; }
      else { const k = this.pickWant(); if (k) this.spawn(false, k); else this.spawnedNormal = this.total; }
      this.nextT = this.interval() / Math.max(1, 1); // 岛上有几个玩家就再除以几（切片单人）
    }
    this.idleCounter = !this.custs.some(c => c.state === 'queue' || c.state === 'wait');
    // 排队位
    const queued = this.custs.filter(c => c.state === 'queue' || c.slot != null && c.state === 'walk');
    for (const c of this.custs) {
      if (c.state === 'walk' && !c.path.length) {
        if (c.slot == null) { const used = new Set(this.custs.filter(o => o.slot != null && (o.state === 'queue' || o.state === 'walk')).map(o => o.slot)); let free = -1; for (let i = 0; i < 4; i++) if (!used.has(i)) { free = i; break; } if (c.big && !used.has(0)) free = 0; if (free >= 0) { c.slot = free; c.path = [QUEUE[free].slice()]; } else { const wi = this.custs.filter(o => o.state === 'pier').length; c.state = 'pier'; c.path = [WAITL[Math.min(WAITL.length - 1, wi)].slice()]; } }
        else { c.state = 'queue'; c.t0 = this.t; if (!c.want && !c.big) c.want = this.pickWant(); if (!c.want && !c.big) { c.state = 'leave'; c.path = PATH.slice().reverse().map(p => p.slice()); } }
      }
      if (c.state === 'pier') { const used = new Set(this.custs.filter(o => o.slot != null && (o.state === 'queue' || o.state === 'walk')).map(o => o.slot)); for (let i = 0; i < 4; i++) if (!used.has(i)) { c.slot = i; c.state = 'walk'; c.path = [[318, 196], QUEUE[i].slice()]; break; } }
      this.walkC(c, dt);
      // 耐心
      if ((c.state === 'queue' || c.state === 'wait') && !c.big) { const left = c.pat - (this.t - c.t0); if (left <= 0) this.leave(c); }
    }
    this.custs = this.custs.filter(c => !(c.state === 'gone'));
    for (const c of this.custs) if ((c.state === 'paid' || c.state === 'leave') && !c.path.length) c.state = 'gone';
    // 船长
    if (this.busy > 0) { this.busy -= dt; this.cap.moving = false; } else G.Walk.update(this.cap, dt, 50, okNight);
    if (In.hit('KeyE') && this.busy <= 0) { In.consume('KeyE'); this.act(); }
    // 打烊：客人都来过、也都递完或走掉
    const allSpawned = (this.spawnedNormal || 0) >= this.total;
    if (allSpawned && !this.custs.some(c => !['gone', 'paid', 'leave'].includes(c.state)) && !this.card && this.t > 2) this.close(); // 都递完或走掉就打烊，不用等最后一位走出画面
  };
  // 柜台前没人排队、也没人等货时，往柜台走的客人快步走过来（不让船长干站着；船长忙的时候照常慢慢走）
  sc.walkC = function (c, dt) { if (c.path.length) { const hurry = c.state === 'walk' && this.idleCounter ? 2.5 : 1, [tx, ty] = c.path[0], d = U.dist(c.x, c.y, tx, ty), sp = 62 * hurry * dt; if (d <= sp) { c.x = tx; c.y = ty; c.path.shift(); } else { c.x += (tx - c.x) / d * sp; c.y += (ty - c.y) / d * sp; c.face = tx < c.x ? -1 : 1; } c.moving = true; } else c.moving = false; };
  sc.leave = function (c) {
    // 船长已经拿了他的货：货回到摊位
    const ci = this.carry.findIndex(x => x.c === c); if (ci >= 0) { const it = this.carry[ci]; it.stall.items.unshift(it.item); this.carry.splice(ci, 1); }
    c.state = 'leave'; c.slot = null; c.path = PATH.slice().reverse().map(p => p.slice()); c.path.unshift([c.x + 8, c.y + 4]);
    this.res.left++; G.Sfx.play('leave'); G.UI.float(c.x, c.y - 30, '等不及，走了', '#ff9a8a', { world: true });
  };
  sc.nearStall = function () { let b = null, bd = 18; for (const s of this.stalls) { const d = U.dist(this.cap.x, this.cap.y, s.x, s.y); if (d < bd) { bd = d; b = s; } } return b; };
  sc.nearCounter = function () { return U.dist(this.cap.x, this.cap.y, COUNTER.x, COUNTER.y) < 20; };
  sc.act = function () {
    const st = this.st, s = this.nearStall();
    if (s && s.k) {
      if (this.carry.length >= 2) { G.UI.toast('一次最多拿两位客人的货'); G.Sfx.play('deny'); return; }
      const want = this.custs.filter(c => c.state === 'queue' && !c.big && c.want === s.k).sort((a, b) => a.t0 - b.t0).slice(0, 2 - this.carry.length);
      if (!want.length) { G.UI.toast(s.items.length ? `柜台前没人要${D.GOODS[s.k].name}` : '这个摊位卖空了'); G.Sfx.play('deny'); return; }
      for (const c of want) { const item = s.items.shift(); if (!item) break; this.carry.push({ c, item, stall: s }); c.state = 'wait'; const used = new Set(this.custs.filter(o => o.state === 'wait' && o.aside != null).map(o => o.aside)); let a = 0; while (used.has(a)) a++; c.aside = a; c.slot = null; c.path = [ASIDE[a % ASIDE.length].slice()]; }
      if (want.length === 2 && !st.flags.twoOrderHint) { st.flags.twoOrderHint = true; G.UI.toast('一次拿了两单：跑一趟顶两趟', '#b8f0a0'); }
      this.busy = 0.35; G.Sfx.play('pick'); return;
    }
    if (this.nearCounter()) {
      const big = this.custs.find(c => c.big && c.state === 'queue');
      if (big && this.order) { this.deliverOrder(big); return; }
      if (!this.carry.length) { G.UI.toast('先去摊位拿货（客人头上写着要什么）'); G.Sfx.play('deny'); return; }
      for (const x of this.carry) this.pay(x);
      this.carry = []; this.busy = 0.25; return;
    }
  };
  sc.pay = function (x) {
    const st = this.st, c = x.c, it = x.item, el = this.t - c.t0;
    const wi = st.warehouse.indexOf(it); if (wi >= 0) st.warehouse.splice(wi, 1);
    const price = S.nightPrice(st, it), tipR = el <= MK.tipFast[0] ? MK.tipFast[1] : el <= MK.tipMid[0] ? MK.tipMid[1] : 0, tip = price * tipR, total = Math.round(price + tip);
    st.gold += total; this.res.stall += price; this.res.tips += tip; this.res.served++;
    if (it.tag === 'heap') this.res.heap++; else if (it.tag === 'full') this.res.full++;
    if (it.sea) { if (el <= 10) this.res.repGold += price + tip; else this.res.slowSea++; } else this.res.townGold += price + tip;
    if (tipR >= 0.2) this.res.fast++;
    c.state = 'paid'; c.aside = null; c.path = [[c.x + 10, c.y + 6], ...PATH.slice().reverse().map(p => p.slice())];
    G.Sfx.play(tipR ? 'tip' : 'coin');
    G.UI.float(c.x, c.y - 30, `+${total}${tipR ? `（小费 +${Math.round(tipR * 100)}%）` : ''}${it.tag ? (it.tag === 'heap' ? ' 冒尖' : ' 满舱') : ''}`, tipR ? '#ffe08a' : '#f0ead8', { life: 1.5, world: true });
    for (let i = 0; i < 6; i++) this.coins.add({ x: c.x, y: c.y - 20, vx: (R() - 0.5) * 40, vy: -30 - R() * 30, g: 120, age: 0, life: 0.7 });
  };
  sc.deliverOrder = function (c) {
    const st = this.st, o = this.order; const pay = Math.round(U.sum(o.items.map(it => S.nightPrice(st, it, { hot: false }))) * MK.orderMult);
    for (const it of o.items) { const wi = st.warehouse.indexOf(it); if (wi >= 0) st.warehouse.splice(wi, 1); }
    st.gold += pay; this.res.order += pay; for (const it of o.items) if (it.sea) this.res.repGold += pay / o.items.length;
    st.board.accepted = null; this.order = null; c.state = 'paid'; c.path = PATH.slice().reverse().map(p => p.slice());
    G.Sfx.play('fanfare'); G.UI.float(c.x, c.y - 34, `订单 +${pay}`, '#ffd24c', { life: 2, size: 9, world: true });
  };
  sc.close = function () {
    const st = this.st, r = this.res;
    // 没卖掉的货本来就还在仓库里，标和戳都还在
    const rep = Math.floor(r.repGold / 100); const before = st.stars; st.rep += rep;
    while (st.stars < MK.stars.length && st.rep >= MK.stars[st.stars]) st.stars++;
    this.card = { rep, before, after: st.stars, income: Math.round(r.stall + r.tips + r.order) };
    st.flags.nights++; if (st.flags.tut === 'market') st.flags.tut = 'free';
    G.Sfx.play('win'); Game.save();
  };

  sc.draw = function (g, f) {
    const st = this.st, ents = [], open = new Set(this.stalls.map(a => a.id));
    // 码头上停着的船
    ents.push({ y: 188, draw: (g, V) => { const ship = S.ship(st), Sp = V.spr.ships[ship.hull], ss = S.stats(ship), x = 566 * V.m - Sp.w / 2, y = 188 * V.m - Sp.hullBottom; A.drawShip(g, Sp, x, y, f, { n: ss.topN, gun: !!ss.gun, engine: ss.engines > 0 }); return [x - 20, y - 4, x + Sp.w + 4, y + Sp.h + 4]; } });
    // 人（客人、船长）和遮挡一起按 y 排：走到摊位、柜台、灯柱后面会被挡住
    for (const c of this.custs) ents.push({ y: c.y, draw: (g, V) => IV.walker(g, V, c, V.spr.cust[c.img].img, f) });
    const cap = this.cap, e = { y: cap.y, draw: (g, V) => { e.box = IV.walker(g, V, cap, V.spr.capA.img, f, { carry: this.carry.map(x => x.item.k), crates: V.spr.crates }); }, sil: (g, V) => IV.walkerSil(g, V, cap, V.sil.capA, f) };
    ents.push(e);
    ents.push({ y: 1e6, draw: (g, V) => this.coins.each(p => A.R(g, p.age < 0.35 ? '#ffe36a' : '#e0a030', p.x * V.m, p.y * V.m, 2 * V.m, 2 * V.m)) });
    // 摊位上的货：画在摊位那块遮挡上面（摊位挡住人的时候，货也在）
    const extra = {};
    for (const s of this.stalls) if (s.k) extra[s.id] = (g, V) => { const ci = V.spr.crates[s.k], m = V.m, n = Math.min(4, s.items.length); for (let i = 0; i < n; i++) g.drawImage(ci.img, G.Px.s((s.box[0] + 6 + (i % 2) * 11 + (i > 1 ? 5 : 0)) * m), G.Px.s((s.box[1] + s.box[3] - 16 - Math.floor(i / 2) * 8) * m)); };
    // 描边：开着的摊位和柜台；走近的那个、手里有货时的柜台、客人在等的摊位描粗
    const hot = new Set(), ns = this.nearStall(); if (ns) hot.add(ns.id); if (this.nearCounter() || this.carry.length || this.custs.some(c => c.big && c.state === 'queue')) hot.add('counter');
    const acts = new Set([...open, 'counter']);
    const dark = new Set(STALLS.filter(s => !open.has(s.id)).map(s => s.id)); // 没开放的摊位盖上暗色
    IV.render(g, 'night', this.view, ents, { hot, acts, dark, extra });
    Game.debug.track = { scene: 'market', bg: [this.view.tx * G.Px.k, this.view.ty * G.Px.k], obj: [this.view.sx(cap.x * this.Z) * G.Px.k, this.view.sy(cap.y * this.Z) * G.Px.k] };
  };
  sc.ui = function (u) {
    const st = this.st, C = u.C, N = this.N, cam = this.view, Z = this.Z, sx = x => cam.sx(x * Z), sy = y => cam.sy(y * Z);
    G.Hud.top(u, st, '夜市');
    for (const s of this.stalls) { if (!s.k) continue; const hot = st.board.hot.includes(s.k); u.text(`${D.GOODS[s.k].name} ${s.items.length}`, sx(s.x), cam.sy(s.box[1] * Z - 4), { size: 6.5, align: 'center', bold: true, color: hot ? '#ffb43a' : '#fff3d0' }); }
    for (const c of this.custs) {
      if (c.state !== 'queue' && c.state !== 'wait') continue;
      const x = sx(c.x), y = cam.sy(c.y * Z - 74) + 8;
      if (c.big) { u.panel(x - 30, y - 16, 60, 18, { fill: 'rgba(255,248,230,0.95)', stroke: '#f0c050', r: 3 }); u.text(`订单 ${Object.entries(this.order ? this.order.o.need : {}).map(([k, n]) => D.GOODS[k].name + n).join(' ')}`, x, y - 4, { size: 5.5, align: 'center', color: '#3a2a10', shadow: false }); u.text('★ 大客户', x, y + 4, { size: 5.5, align: 'center', color: '#f0c050', bold: true }); continue; }
      const left = 1 - (this.t - c.t0) / c.pat, el = this.t - c.t0;
      u.panel(x - 8, y - 12, 16, 14, { fill: c.state === 'wait' ? 'rgba(220,240,210,0.95)' : 'rgba(255,250,240,0.95)', stroke: c.state === 'wait' ? '#6aa050' : '#8a6a33', r: 3 });
      if (c.want) u.img(N.crates[c.want], x - N.crates[c.want].w / 2, y - 11, 1);
      u.bar(x - 8, y + 4, 16, 2, left, el <= 5 ? '#8fd06a' : el <= 10 ? '#f0c050' : '#e0574a');
    }
    // 提示
    const s = this.nearStall();
    if (!this.card && this.busy <= 0) {
      const px = sx(this.cap.x), py = cam.sy(this.cap.y * Z - 74) - (this.carry.length ? 18 * cam.zoom : 0); // 提示写在船长头顶
      if (s && s.k) { const n = this.custs.filter(c => c.state === 'queue' && !c.big && c.want === s.k).length; u.prompt(px, py, 'E', n ? `拿${D.GOODS[s.k].name}（${Math.min(n, 2 - this.carry.length)} 位客人）` : `${D.GOODS[s.k].name}：现在没人要`); }
      else if (this.nearCounter()) { const big = this.custs.find(c => c.big && c.state === 'queue'); u.prompt(px, py, 'E', big ? '把订单的货交给大客户' : this.carry.length ? `递货（${this.carry.length} 单）` : '柜台'); }
    }
    if (!this.card) IV.tabHint(u, this.view);
    if (!this.card) {
      const first = st.flags.nights === 0, waiting = (this.spawnedNormal || 0) < this.total ? this.total - (this.spawnedNormal || 0) : 0;
      u.panel(500, 36, 132, 50, { fill: 'rgba(24,18,14,0.85)' });
      u.text(`今晚收入 ${Math.round(this.res.stall + this.res.tips + this.res.order)}`, 508, 50, { size: 7, color: '#ffe08a', bold: true });
      u.text(`递出 ${this.res.served}　走掉 ${this.res.left}`, 508, 63, { size: 6.5 }); u.text(`还没来的客人 ${waiting}`, 508, 76, { size: 6.5, color: C.muted });
      u.hint(this.lesson && !st.flags.twoOrderHint ? '两位客人要同一种货：去那个摊位按一次 E 就能一起拿' : first ? '客人头上写着要什么：去那个摊位按 E 拿货，回柜台按 E 递给他。5 秒内递到小费 +20%' : '一次最多拿两位客人的货；耐心条变红就快走了');
    }
    if (this.card) this.cardUI(u);
  };
  sc.cardUI = function (u) {
    const st = this.st, C = u.C, r = this.res, k = this.card;
    u.rect(0, 0, 640, 360, 'rgba(8,6,10,0.5)');
    u.panel(150, 30, 340, 300, { fill: 'rgba(36,24,14,0.97)', stroke: '#f0c050', lw: 1.5, r: 6 });
    u.text('打烊', 320, 56, { size: 16, bold: true, serif: true, align: 'center', color: '#ffd24c' });
    u.text(`第 ${st.day} 天　今晚收入 ${U.fmt(k.income)} 金`, 320, 74, { size: 9, align: 'center', color: '#ffe08a', bold: true });
    const row = (i, a, b, col) => { u.text(a, 172, 98 + i * 14, { size: 7, color: C.muted }); u.text(b, 468, 98 + i * 14, { size: 7.5, align: 'right', color: col || C.fg, bold: true }); };
    row(0, '摊位', U.fmt(r.stall)); row(1, `小费（${r.fast} 位 5 秒内递到）`, U.fmt(r.tips), '#ffe08a'); row(2, '大客户订单', r.order ? U.fmt(r.order) : '—'); row(3, `卖出 ${r.served} 箱（冒尖 ${r.heap}、满舱 ${r.full}）　走掉 ${r.left} 位`, '');
    u.line(170, 150, 470, 150, 'rgba(240,211,138,0.4)');
    u.text('口碑（只有海上打来、捞来的货涨口碑）', 172, 166, { size: 7, color: C.brassL, bold: true });
    row(6, `10 秒内递出的海货 ${U.fmt(r.repGold)} 金`, `+${k.rep}`, '#f0c050');
    row(7, `城里的货 ${U.fmt(r.townGold)} 金：卖钱，不涨口碑`, '+0', C.muted);
    if (r.slowSea) row(8, `慢了的海货 ${r.slowSea} 箱（超过 10 秒，没算进去）`, '', '#ffb08a');
    if (st.flags.nights === 1) u.text('只有海上打来、捞来的货涨口碑：下次多带点打来的货', 320, 236, { size: 7, align: 'center', color: '#ffd27a', bold: true });
    const nx = D.MARKET.stars[st.stars]; u.text(`口碑 ${Math.floor(st.rep)}${nx ? ` / ${nx}　离下一颗星还差 ${Math.max(0, nx - Math.floor(st.rep))}` : ''}　星级 ${'★'.repeat(st.stars) || '零星'}`, 320, 270, { size: 7, align: 'center', color: '#f0c050' });
    if (k.after > k.before) u.text(`升到 ${k.after} 星！售价 +5%，客人来得更密`, 320, 284, { size: 8, align: 'center', bold: true, color: '#ffd24c' });
    u.text('今晚最佳店员：你', 320, 298, { size: 6.5, align: 'center', color: C.muted });
    if (u.button(250, 304, 140, 20, `睡觉（第 ${st.day + 1} 天）`, { primary: true, key: ['Enter', 'KeyE'] })) { S.endDay(st, true); st.flags.boardSeen = false; Game.save(); Game.go('island', { fromMarket: true }, { fade: 0.9 }); }
  };
  sc.blockEsc = function () { return !!this.card; };
  Game.reg('market', sc);
})(window.G);
