/* 船坞：看船的侧面，把模块拖进亮着的空位，右边的数值当场变化；出航检查没有红项，「出航」才亮。
   模块装、卸、换都不花钱；造新模块、升品质花金币和船材。 */
(function (G) {
  'use strict';
  const D = G.D, S = G.S, U = G.U, A = G.Art, In = G.In, Game = G.Game;
  const BOX = 20;
  const sc = {};
  sc.enter = function () {
    this.st = Game.st; this.hand = null; this.build = false; this.flash = []; this.sinkT = 0; this.lastFull = null; this.t = 0; this.steam = A.Pool(); this.puffs = A.Pool();
    const ss = S.stats(S.ship(this.st)); this.lastTierFull = ss.tierFull;
  };
  sc.ship = function () { return S.ship(this.st); };
  sc.layout = function () {
    const ship = this.ship(), Sp = G.SPR.dock.ships[ship.hull], H = D.HULLS[ship.hull];
    const ox = Math.round(300 - Sp.w / 2), oy = Math.round(258 - Sp.hullBottom);
    const boxes = [];
    const B = Sp.balloons[Sp.balloons.length - 1];
    for (let i = 0; i < H.top; i++) { const span = B.w * 0.62, x = ox + B.x + B.w / 2 - span / 2 + (H.top === 1 ? span / 2 : span * i / (H.top - 1)) - BOX / 2; boxes.push({ g: 'top', i, x: Math.round(x), y: Math.round(oy + B.y + B.h * 0.5 - BOX / 2) }); }
    const hx0 = ox + Sp.hullX + Sp.hullW * 0.2, hx1 = ox + Sp.hullX + Sp.hullW * 0.74, rows = H.hold > 6 ? 2 : 1, per = Math.ceil(H.hold / rows), hy0 = oy + Sp.deckY + 10;
    for (let i = 0; i < H.hold; i++) { const r = Math.floor(i / per), c = i % per, w = (hx1 - hx0), x = hx0 + (per === 1 ? w / 2 : w * c / (per - 1)) - BOX / 2; boxes.push({ g: 'hold', i, x: Math.round(x), y: Math.round(hy0 + r * (BOX + 4)) }); }
    const can = Sp.parts.cannon; for (let i = 0; i < H.bow; i++) boxes.push({ g: 'bow', i, x: Math.round(ox + can.x + can.w / 2 - BOX / 2), y: Math.round(oy + can.y - BOX - 2) });
    for (let i = 0; i < H.pair; i++) boxes.push({ g: 'pair', i, x: Math.round(ox + Sp.hullX + Sp.hullW * 0.84 - BOX / 2), y: Math.round(oy + Sp.hullBottom - BOX - 10) });
    const en = Sp.parts.engine; for (let i = 0; i < H.tail; i++) boxes.push({ g: 'tail', i, x: Math.round(ox + en.x + en.w * 0.45 - BOX / 2 + i * (BOX + 3) - (H.tail - 1) * (BOX + 3) / 2), y: Math.round(oy + en.y + en.h + 4) });
    return { Sp, ox, oy, boxes };
  };
  const fits = (m, g) => D.MODULES[m.type].slots.includes(g);

  sc.update = function (dt) {
    this.t += dt; this.steam.step(dt); this.puffs.step(dt); this.sinkT = Math.max(0, this.sinkT - dt * 2);
    if (In.hit('Escape') && this.hand) { this.returnHand(); In.consume('Escape'); }
    if (In.mouse.rpressed && this.hand) this.returnHand();
  };
  sc.returnHand = function () { if (!this.hand) return; this.st.modules.push(this.hand); this.hand = null; G.Sfx.play('click'); };
  sc.install = function (box) {
    const ship = this.ship(), arr = ship.slots[box.g], cur = arr[box.i], st = this.st;
    if (this.hand) {
      if (!fits(this.hand, box.g)) { G.Sfx.play('deny'); G.UI.toast(`${D.MODULES[this.hand.type].name}只能装在「${D.MODULES[this.hand.type].slots.map(s => D.SLOT_NAMES[s]).join('、')}」`, '#ffb0a0'); return; }
      if (this.hand.type === 'gun' && box.g === 'bow' && S.allMods(ship).some(m => m.type === 'gun' && m !== cur)) { G.Sfx.play('deny'); G.UI.toast('每艘船只能装 1 门主炮'); return; }
      arr[box.i] = this.hand; this.hand = cur || null; G.Sfx.play('install');
      for (let i = 0; i < 6; i++) this.puffs.add({ x: box.x + BOX / 2, y: box.y + BOX / 2, vx: (U.R() - 0.5) * 60, vy: (U.R() - 0.5) * 60, r: 1.2, age: 0, life: 0.35 });
    } else if (cur) {
      if (cur.type === 'container') { const after = S.stats(ship).holdCap - D.MODULES.container.val[cur.q]; if (ship.hold.length > after) { G.Sfx.play('deny'); G.UI.toast('货舱里还有没卸的货，不能卸这个货柜'); return; } }
      arr[box.i] = null; this.hand = cur; G.Sfx.play('click');
    }
    this.afterChange();
  };
  sc.afterChange = function () {
    const ship = this.ship(), ss = S.stats(ship); ship.hp = ss.hpMax; // 船在家里：装上装甲板，船体值上限变了也是满的（回家免费修满）
    if (ss.tierFull !== this.lastTierFull) { if (ss.tierFull < this.lastTierFull) { this.sinkT = 1; G.Sfx.play('thud'); } G.UI.float(300, 120, `满载速度档 ${D.TIERS[this.lastTierFull].name} → ${D.TIERS[ss.tierFull].name}`, ss.tierFull < this.lastTierFull ? '#ffb08a' : '#b8f0a0', { life: 1.6 }); this.lastTierFull = ss.tierFull; }
    const st = this.st; if (st.flags.tut === 'dock' && !ss.red.length && ss.gun && ss.topN >= 3) { st.flags.tut = 'launch'; G.UI.showBanner('木筏装好了！', '点右下角「出航」', '#ffd24c', 3); G.Sfx.play('fanfare'); }
  };
  sc.kit = function (ship, extra = []) { return S.kit(this.st, ship, this.hand ? extra.concat([this.hand]) : extra); }; // 手里拿着的也算有
  /* 一键装好：照推荐装法，从仓库里挑品质最好的装上；缺的白色模块钱和船材够补齐就一起造了（按钮上写着花多少），不够就只装仓库里有的 */
  sc.autoFit = function () {
    if (this.hand) this.returnHand();
    const ship = this.ship(), st = this.st, rec = D.HULLS[ship.hull].rec, sl = ship.slots, kit = this.kit(ship);
    if (kit.n && kit.can) { for (const [t, k] of Object.entries(kit.missing)) for (let i = 0; i < k; i++) st.modules.push(S.mod(t, 0)); st.gold -= kit.gold; st.mat -= kit.mat; G.Sfx.play('coin'); G.UI.toast(`造了 ${kit.n} 件白色模块：${kit.gold} 金 + ${kit.mat} 船材`); }
    const take = (type) => { let bi = -1; st.modules.forEach((m, i) => { if (m.type === type && (bi < 0 || m.q > st.modules[bi].q)) bi = i; }); return bi < 0 ? null : st.modules.splice(bi, 1)[0]; };
    // 先把装着的都卸回仓库（货舱有货时货柜不动）
    for (const g of Object.keys(sl)) sl[g] = sl[g].map(m => { if (!m) return null; if (m.type === 'container' && ship.hold.length) return m; st.modules.push(m); return null; });
    const put = (g, type) => { const i = sl[g].indexOf(null); if (i < 0) return false; const m = take(type); if (!m) return false; sl[g][i] = m; return true; };
    // 先装要紧的（驾驶舱、引擎、炮、顶上的气囊），再装舱里的货柜和气囊
    for (const g of ['hold', 'tail', 'bow', 'top', 'pair']) for (const t of rec[g]) if (g !== 'hold' || t === 'cockpit') put(g, t);
    for (const t of rec.hold) if (t !== 'cockpit' && !put('hold', t)) put('hold', t === 'container' ? 'balloon' : 'container');
    // 升力不够（蓝色货柜更能装、也更重）：把货柜换成气囊，没有气囊就卸掉
    let guard = 0; while (S.stats(ship).red.some(r => r.startsWith('升力')) && guard++ < 14) { const i = sl.hold.findLastIndex(m => m && m.type === 'container'); if (i < 0) break; st.modules.push(sl.hold[i]); sl.hold[i] = null; put('hold', 'balloon'); }
    G.Sfx.play('install'); this.afterChange(); Game.save();
  };
  /* 造驮兽货船：照「换底模」，现在这艘船上的模块按位置搬过去（放不下的回仓库），舱里的货也跟着搬 */
  sc.buildBeast = function () {
    const st = this.st, c = D.HULLS.beast.cost, from = this.ship();
    const b = { id: 'beast', hull: 'beast', name: '驮兽货船', slots: S.emptySlots('beast'), hp: 150, hold: [], deck: [] };
    for (const g of Object.keys(from.slots)) from.slots[g].forEach((m, i) => { if (!m) return; if (i < b.slots[g].length) b.slots[g][i] = m; else st.modules.push(m); from.slots[g][i] = null; });
    b.hold = from.hold; b.deck = from.deck; from.hold = []; from.deck = [];
    st.gold -= c[0]; st.mat -= c[1]; st.ships.push(b); st.active = st.ships.length - 1; b.hp = S.stats(b).hpMax;
    this.lastTierFull = S.stats(b).tierFull; G.Sfx.play('fanfare');
    G.UI.showBanner('驮兽货船造好了', `${from.name}上的模块搬过来了；点「一键装好」补齐推荐装法：甲板能堆 6 箱`, '#ffd24c', 3.5); Game.save();
  };
  /* 船坞里底下那行建议：有红项先「一键装好」；钱和船材够造驮兽并补齐模块时建议造；平时「出航」 */
  sc.advice = function (ss) {
    const st = this.st, ship = this.ship(), kit = this.kit(ship);
    if (ss.red.length) return kit.n && !kit.can ? `出航检查有红项，模块也不够：去「造模块」补，或者换回别的船` : '出航检查有红项：点「一键装好」';
    if (!st.ships.some(s => s.hull === 'beast')) {
      const c = D.HULLS.beast.cost, bg = S.beastGoal(st), g = bg.gold, m = bg.mat;
      if (st.gold >= g && st.mat >= m) return `钱和船材够了：可以造驮兽货船（${c[0]} 金 + ${c[1]} 船材），再「一键装好」补模块（约 ${bg.kit.gold} 金 + ${bg.kit.mat} 船材）`;
      if (st.gold >= c[0] * 0.5) return `攒着造驮兽货船：连补模块一共约 ${g} 金 + ${m} 船材（船材靠打海盗、捞残骸，铁桅镇也卖）　现在点「出航」`;
    }
    if (kit.n && kit.can && ss.yellow.length) return `还能按推荐装法补 ${kit.n} 件模块（「一键装好」：${kit.gold} 金 + ${kit.mat} 船材），或者直接「出航」`;
    return '装好了：点「出航」';
  };

  sc.draw = function (g, f) {
    const L = this.layout(), ship = this.ship(), ss = S.stats(ship), Dk = G.SPR.dock;
    g.drawImage(Dk.bgImg, 0, 0);
    const empty = !S.allMods(ship).length;
    if (ss.engines && U.R() < 0.3) this.steam.add({ x: L.ox + L.Sp.chim.x, y: L.oy + L.Sp.chim.y, vx: -6, vy: -10, r: 1.2, age: 0, life: 1.4 });
    this.steam.each(p => A.blob(g, p.x, p.y, p.r + p.age * 2, A.STEAM.slice(Math.min(2, (p.age / 0.5) | 0))));
    A.drawShip(g, L.Sp, L.ox, L.oy, f, { n: ss.topN, gun: !!ss.gun, engine: ss.engines > 0, hold: ss.holdCap ? ship.hold.length / ss.holdCap : 0, deck: ship.deck.map(i => i.k), crates: Dk.crates, dy: Math.round(Math.sin(this.sinkT * Math.PI) * 4), bob: empty ? 0 : 1 });
    this.puffs.each(p => A.R(g, A.FIRE[Math.min(3, (p.age / p.life * 4) | 0)], p.x, p.y, 1, 1));
  };

  sc.ui = function (u) {
    const st = this.st, ship = this.ship(), ss = S.stats(ship), L = this.layout(), C = u.C, Dk = G.SPR.dock, H = D.HULLS[ship.hull];
    G.Hud.top(u, st, '船坞');
    // 船的切换和造底模
    let tx = 240; st.ships.forEach((sh, i) => { const on = i === st.active; if (u.button(tx, 10, 76, 18, `${D.HULLS[sh.hull].name}`, { primary: on })) { if (!on) { if (this.hand) this.returnHand(); st.active = i; this.lastTierFull = S.stats(sh).tierFull; } } tx += 80; });
    if (!st.ships.some(s => s.hull === 'beast')) { const c = D.HULLS.beast.cost, can = st.gold >= c[0] && st.mat >= c[1]; if (u.button(tx, 10, 150, 18, `造驮兽货船 ${c[0]} 金 + ${c[1]} 船材`, { disabled: !can, id: 'beast' })) { if (this.hand) this.returnHand(); this.buildBeast(); } }
    // 位置框
    const hov = L.boxes.find(b => u.hover(b.x, b.y, BOX, BOX));
    for (const b of L.boxes) {
      const m = ship.slots[b.g][b.i], ok = this.hand && fits(this.hand, b.g), pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
      u.panel(b.x, b.y, BOX, BOX, { fill: m ? 'rgba(24,18,14,0.55)' : ok ? `rgba(240,200,90,${0.25 + 0.25 * pulse})` : 'rgba(24,18,14,0.35)', stroke: m ? D.Q[m.q].color : ok ? '#ffe08a' : 'rgba(240,211,138,0.5)', r: 2, lw: ok ? 1.5 : 1 });
      if (m) u.img(Dk.icons[m.type], b.x + BOX / 2 - Dk.icons[m.type].w / 2, b.y + BOX / 2 - Dk.icons[m.type].h / 2, 1);
      if (u.clicked(b.x, b.y, BOX, BOX) || (this.hand && G.In.mouse.released && this.dragging && u.hover(b.x, b.y, BOX, BOX))) this.install(b);
    }
    const lab = (g, t) => { const bs = L.boxes.filter(b => b.g === g); if (!bs.length) return; const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); u.text(t, x - 3, y + 8, { size: 6, align: 'right', color: '#f0d38a' }); };
    lab('top', '顶'); lab('hold', '舱'); lab('bow', '船头'); lab('pair', '两舷'); lab('tail', '尾');
    if (hov && !this.hand) { const m = ship.slots[hov.g][hov.i]; this.tip(u, hov.x + BOX + 4, hov.y, m ? this.modDesc(m) : [`${D.SLOT_NAMES[hov.g]} · 空位`, '能装：' + D.MOD_ORDER.filter(t => D.MODULES[t].slots.includes(hov.g)).map(t => D.MODULES[t].name).join('、')]); }
    this.statsPanel(u, ss, ship, H);
    this.inventory(u);
    // 手里拿着的模块跟着鼠标
    if (this.hand) { const ic = Dk.icons[this.hand.type], m = In.mouse; u.img(ic, m.x - ic.w / 2, m.y - ic.h / 2, 1.2); u.text(`${D.Q[this.hand.q].name}色${D.MODULES[this.hand.type].name}`, m.x + 12, m.y + 14, { size: 6.5, color: D.Q[this.hand.q].color }); }
    if (In.mouse.released) this.dragging = false;
    if (st.flags.tut === 'dock') u.hint('把下面仓库里的模块拖到亮着的空位：驾驶舱和货柜进「舱」，气囊上「顶」，炮装「船头」，引擎装「尾」', { y: 262 });
    else if (!this.hand) u.hint(this.advice(ss), { y: 262 });
  };
  sc.modDesc = function (m) { const M = D.MODULES[m.type]; return [`${D.Q[m.q].name}色${M.name}`, `${M.unit} ${m.type === 'gun' ? '×' + M.val[m.q] : M.val[m.q]}　重 ${M.w}`, M.desc, '装在：' + M.slots.map(s => D.SLOT_NAMES[s]).join('、')]; };
  sc.tip = function (u, x, y, lines) { const w = Math.max(...lines.map(l => u.measure(l, 6.5))) + 12, h = lines.length * 10 + 6; x = Math.min(x, 636 - w); u.panel(x, y, w, h, { fill: 'rgba(16,12,10,0.95)', r: 3 }); lines.forEach((l, i) => u.text(l, x + 6, y + 11 + i * 10, { size: 6.5, color: i ? u.C.fg : u.C.brassL, bold: !i })); };

  sc.statsPanel = function (u, ss, ship, H) {
    const C = u.C, x = 498, y = 36, w = 136; const st = this.st;
    u.panel(x, y, w, 222, { fill: 'rgba(24,18,14,0.88)' });
    u.text(`${D.HULLS[ship.hull].name}（${H.tier}）`, x + 8, y + 15, { size: 8, bold: true, color: C.brassL });
    { const pp = S.powerParts(ship, ss.hpMax), pw = pp.guns + pp.hull; u.text(`战力 ${pw}`, x + w - 8, y + 15, { size: 7.5, bold: true, align: 'right', color: '#f0d38a' }); if (u.hover(x + w - 44, y + 6, 40, 12)) this.tip(u, x - 150, y + 20, [`战力 ${pw} = 炮 ${pp.guns} + 船体值 ${ss.hpMax} ÷ 10`, `推荐战力：内圈 ${D.POWER.rec.inner}，边境 ${D.POWER.rec.border}`, '不低于推荐绿色，七成以上黄色，再低红色', '路上挨了打，船体值掉了，战力也跟着掉']); } // 「7 战斗和掉落 · 推荐战力和难度」
    const row = (i, a, b, col) => { u.text(a, x + 8, y + 32 + i * 13, { size: 6.5, color: C.muted }); u.text(b, x + w - 8, y + 32 + i * 13, { size: 7, align: 'right', color: col || C.fg, bold: true }); };
    row(0, '升力 / 满载重量', `${ss.lift} / ${ss.fullW}`, ss.lift >= ss.fullW ? '#b8f0a0' : '#ff9a8a');
    row(1, '推力', String(ss.thrust));
    row(2, '推重比 空舱 → 满载', ss.engines ? `${ss.twrEmpty.toFixed(2)} → ${ss.twrFull.toFixed(2)}` : '—');
    row(3, '速度档', ss.engines ? `${D.TIERS[ss.tierEmpty].name} → ${D.TIERS[ss.tierFull].name}` : '—', ss.tierFull === 0 ? '#ffb08a' : C.fg);
    row(4, '货舱', `${ss.holdCap} 格`);
    row(5, '甲板能堆', `${ss.deckCap}（位 ${ss.deckSlots}）`, ss.deckCap ? '#ffd27a' : C.muted);
    row(6, '船体值', `${Math.ceil(ship.hp)} / ${ss.hpMax}`);
    row(7, '主炮', ss.gun ? `${D.Q[ss.gun.q].name}色连发炮` : '没有', ss.gun ? C.fg : '#ffd27a');
    let yy = y + 140; u.text('出航检查', x + 8, yy, { size: 6.5, color: C.muted });
    if (!ss.red.length && !ss.yellow.length) u.text('✓ 没问题', x + 8, yy + 12, { size: 6.5, color: '#b8f0a0' });
    ss.red.concat(ss.yellow).slice(0, 4).forEach((r, i) => { const red = i < ss.red.length; u.text((red ? '✗ ' : '! ') + r, x + 8, yy + 12 + i * 10, { size: 5.8, color: red ? '#ff9a8a' : '#ffd27a' }); });
    u.text(`每格货重 1，升力余量 ${Math.max(0, ss.lift - ss.fullW)} 决定甲板能堆几箱`, x + 8, y + 196, { size: 5.2, color: C.muted });
    const kit = this.kit(ship), fitLabel = kit.n && kit.can && st.flags.tut !== 'dock' ? `一键装好 ${kit.gold}金` : '一键装好';
    if (u.button(x + 8, y + 202, 58, 16, fitLabel, { disabled: st.flags.tut === 'dock', id: 'autofit', size: kit.n && kit.can ? 6 : 7 })) this.autoFit();
    if (u.button(x + 70, y + 202, 58, 16, '离开船坞')) { if (this.hand) this.returnHand(); Game.go('island', { fromDock: true }); }
    const red = ss.red.length > 0;
    if (u.button(x, y + 226, w, 26, red ? '出航（有红项）' : '出航', { primary: !red, disabled: red, size: 10 })) {
      if (this.hand) this.returnHand();
      if (st.flags.tut === 'launch' || st.flags.tut === 'dock') st.flags.tut = 'buy';
      ship.hp = ss.hpMax; Game.save(); Game.go('island', { launch: true });
    }
  };
  sc.inventory = function (u) {
    const st = this.st, C = u.C, Dk = G.SPR.dock, x0 = 8, y0 = 276, w = 484;
    u.panel(x0, y0, w, 78, { fill: 'rgba(24,18,14,0.9)' });
    u.text(`仓库里的模块（${st.modules.length}）`, x0 + 8, y0 + 12, { size: 7, bold: true, color: C.brassL });
    u.text('点一下拿起来，再点位置装上；右键放回', x0 + 110, y0 + 12, { size: 6, color: C.muted });
    if (u.button(x0 + w - 70, y0 + 3, 64, 13, this.build ? '收起造模块' : '造模块', { size: 6.5 })) this.build = !this.build;
    // 按种类和品质归组
    const groups = []; for (const t of D.MOD_ORDER) for (let q = 2; q >= 0; q--) { const ms = st.modules.filter(m => m.type === t && m.q === q); if (ms.length) groups.push({ t, q, ms }); }
    if (!this.build) {
      groups.forEach((gr, i) => { const x = x0 + 8 + i * 34, y = y0 + 20; if (x > x0 + w - 34) return; u.panel(x, y, 30, 30, { fill: 'rgba(52,38,26,0.9)', stroke: D.Q[gr.q].color, r: 3 }); const ic = Dk.icons[gr.t]; u.img(ic, x + 15 - ic.w / 2, y + 13 - ic.h / 2, 1); u.text(`×${gr.ms.length}`, x + 28, y + 28, { size: 6, align: 'right', bold: true }); u.text(D.MODULES[gr.t].name, x + 15, y + 40, { size: 5.5, align: 'center', color: C.muted });
        if (u.hover(x, y, 30, 30)) this.tip(u, x, y - 46, this.modDesc(gr.ms[0]));
        if (G.In.mouse.pressed && u.hover(x, y, 30, 30) && !this.hand) { this.hand = gr.ms[gr.ms.length - 1]; st.modules.splice(st.modules.indexOf(this.hand), 1); this.dragging = true; G.Sfx.play('click'); } });
      if (!groups.length) u.text('空的。点「造模块」用金币和船材造白色模块。', x0 + 8, y0 + 40, { size: 6.5, color: C.muted });
      if (this.hand) {
        const h = this.hand, M = D.MODULES[h.type], bx = x0 + 300, by = y0 + 20;
        if (h.q < 1) { const c = D.upgradeCost(h.type, h.q), can = st.gold >= c[0] && st.mat >= c[1]; if (u.button(bx, by, 176, 15, `升到蓝色：${c[0]} 金 + ${c[1]} 船材（${M.unit} ${M.val[0]}→${M.val[1]}）`, { disabled: !can, size: 6 })) { st.gold -= c[0]; st.mat -= c[1]; h.q = 1; G.Sfx.play('coin'); Game.save(); } }
        else if (h.q < 2) u.text('升金色要 1 块云晶（风暴带才有），这一段没有', bx, by + 10, { size: 6, color: C.muted });
        if (u.button(bx, by + 19, 176, 15, `拆成船材 +${D.scrapValue(h.q)}`, { size: 6 })) { st.mat += D.scrapValue(h.q); this.hand = null; G.Sfx.play('pick'); Game.save(); }
        if (u.clicked(x0, y0, 290, 78) && !this.dragging) this.returnHand();
      }
    } else {
      D.MOD_ORDER.forEach((t, i) => { const M = D.MODULES[t], x = x0 + 8 + (i % 4) * 118, y = y0 + 20 + Math.floor(i / 4) * 27, can = st.gold >= M.cost[0] && st.mat >= M.cost[1];
        u.panel(x, y, 112, 24, { fill: 'rgba(52,38,26,0.9)', r: 3 }); const ic = Dk.icons[t]; u.img(ic, x + 4, y + 12 - ic.h / 2, 0.8);
        u.text(M.name, x + 24, y + 10, { size: 6.5, bold: true }); u.text(`${M.cost[0]} 金 + ${M.cost[1]}`, x + 24, y + 20, { size: 5.5, color: C.muted });
        if (u.button(x + 80, y + 4, 28, 16, '造', { disabled: !can, size: 6.5 })) { st.gold -= M.cost[0]; st.mat -= M.cost[1]; st.modules.push(S.mod(t, 0)); G.Sfx.play('install'); Game.save(); } });
    }
  };
  sc.blockEsc = function () { return !!this.hand; };
  sc.smooth = true; // view.js
  Game.reg('dock', sc);
})(window.G);
