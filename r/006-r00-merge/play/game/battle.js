/* 就地开打的横版战斗（design.md「7 战斗和掉落」「画面只做两套」，10 月 13 日定的）。
   不切场景：镜头在大地图上推近（ZB 倍），背景还是这片云海和浮岛，船就是大地图上那艘侧面船，甲板上的货一直看得见；
   打的时候船一直往前飞（镜头在世界里往前移，云海、浮岛、城镇往后退）；打完船穿过一团云（暗切），镜头拉回，船还在开打前的位置。
   敌人成小队来：每一队 2–5 艘战舰，长机带僚机、有队形；最后一队是旗舰（大地图上你开战的那艘海盗船）带护卫小队。
   只有三个键：移动、技能（E）、冲刺（空格）；自动开火。
   战斗坐标：「前方」= +x（船头朝的方向）。船头朝左打的时候，战斗这一层整个左右镜像，背景（世界）不镜像。
   打击感（成品标准，不留到以后）：命中、击毁、技能释放、被打中掉货、接箱子，都有顿帧、震屏、闪白、火花、碎片和声音。
   画法和整个游戏一样走「顺滑」的那套（view.js）：大地图 smooth = true，战斗直接画在全分辨率画布上，坐标还是 640×360 的基准坐标，
   位置用 ps()（= G.Px.s）对齐到物理像素，不再 Math.round 到 640×360 的格子：背景往后退、船和子弹挪动都是一个物理像素一个物理像素地走；
   零件内部的偏移（炮口、货箱、旗杆……）照旧按整像素算，加在对齐好的起点上（按起点取整，跟着船走不抖）。 */
(function (G) {
  'use strict';
  const D = G.D, S = G.S, U = G.U, A = G.Art, In = G.In, Game = G.Game, M = D.MAP;
  const R = U.R;
  const W = 640, H = 360, LB = 10;                 // 画面；推近时上下各出一条 10 像素的黑边
  const IN_T = 0.62, XF_T = 0.22;                  // 推近用多久；推近以后大地图的图和战斗的图交叉淡化多久
  const OUT_COVER = 0.45, OUT_T = 1.4, BANK_HW = 440; // 穿云：第 0.45 秒云把画面遮满（这时换回大地图），1.4 秒镜头拉回原位
  const SPD_CAP = 140;                             // 敌弹速度上限（像素/秒）
  const BT = G.Battle = {};
  const ps = v => G.Px.s(v); // 位置对齐到物理像素（view.js）：代替画图时的 Math.round

  /* ---------------- 数值（切片初始值，试玩再调；border 血量 ×2、弹速 ×1.15、开火间隔 ×0.85） ---------------- */
  const TYPES = {
    wing: { hp: 14, fire: 'single', iv: [1.5, 2.1], spd: 80, name: '僚机', gauge: 6, boom: 1 },
    lead: { hp: 28, fire: 'burst', iv: [2.2, 2.6], spd: 94, name: '长机', gauge: 10, boom: 2 },
    heavy: { hp: 40, fire: 'fan', iv: [2.5, 3.0], spd: 72, name: '重炮艇', gauge: 10, boom: 2 },
    flag: { hp: 90, fire: 'boss', iv: [2.0, 2.3], spd: 64, name: '旗舰', gauge: 20, boom: 3 },
  };
  /* 队形：每一格是 [往后多远, 往旁边多远]（相对长机；「后」= 离你更远的那一侧）。旗舰的护卫在它前面 */
  const FORMS = {
    pair: { name: '梯队', slots: [[0, 0], [46, 44]] },
    vee3: { name: '人字队', slots: [[0, 0], [48, -48], [48, 48]] },
    vee4: { name: '菱形队', slots: [[0, 0], [48, -48], [48, 48], [96, 0]] },
    line3: { name: '横队', slots: [[0, 0], [10, -64], [10, 64]] },
    col3: { name: '纵队', slots: [[0, 0], [60, 0], [120, 0]], then: 'vee3' },
    escort1: { name: '旗舰带护卫', slots: [[0, 0], [-78, 60]] },
    escort2: { name: '旗舰带护卫', slots: [[0, 0], [-74, -64], [-74, 64]] },
  };
  /* 手工波次表（design.md：每个区域、每种炮 2 套，不在现场随机拼；切片只有默认装法）。遭遇战 1–2 支小队、共 3–6 艘，最后一队是旗舰 */
  const SETS = {
    first: [[{ form: 'pair', entry: 'front', ships: ['lead', 'wing'] }, { form: 'escort1', entry: 'front', ships: ['flag', 'wing'], boss: true }]],
    inner: [
      [{ form: 'vee3', entry: 'front', ships: ['lead', 'wing', 'wing'] }, { form: 'escort2', entry: 'front', ships: ['flag', 'wing', 'wing'], boss: true }],
      [{ form: 'line3', entry: 'dive', ships: ['lead', 'wing', 'wing'] }, { form: 'escort1', entry: 'front', ships: ['flag', 'wing'], boss: true }]],
    border: [
      [{ form: 'vee3', entry: 'front', ships: ['heavy', 'wing', 'wing'] }, { form: 'escort2', entry: 'front', ships: ['flag', 'wing', 'wing'], boss: true }],
      [{ form: 'vee4', entry: 'climb', ships: ['lead', 'wing', 'wing', 'wing'] }, { form: 'escort1', entry: 'front', ships: ['flag', 'heavy'], boss: true }]],
    chase: {
      inner: [[{ form: 'col3', entry: 'behind', ships: ['lead', 'wing', 'wing'] }, { form: 'escort1', entry: 'front', ships: ['flag', 'wing'], boss: true }]],
      border: [[{ form: 'col3', entry: 'behind', ships: ['heavy', 'wing', 'wing'] }, { form: 'escort2', entry: 'front', ships: ['flag', 'wing', 'wing'], boss: true }]] },
    guard: {
      inner: [[{ form: 'pair', entry: 'dive', ships: ['lead', 'wing'] }, { form: 'escort2', entry: 'front', ships: ['flag', 'wing', 'wing'], boss: true }]],
      border: [[{ form: 'vee3', entry: 'dive', ships: ['heavy', 'wing', 'wing'] }, { form: 'escort2', entry: 'front', ships: ['flag', 'wing', 'wing'], boss: true }]] },
  };
  BT.SETS = SETS; BT.FORMS = FORMS; BT.TYPES = TYPES;

  /* ---------------- 特效用的像素图（第一次用到时画好，存起来） ---------------- */
  const FIRE = [['#ffffff', '#fffbe8', '#fff1b8'], ['#fff4b8', '#ffd24c', '#ffb43a'], ['#ffd24c', '#ff9a2e', '#e0602a'], ['#ff9a2e', '#d4571e', '#8a3418'], ['#7a5a50', '#5a4448', '#3e3238']];
  const SMOKE = ['#e2dee6', '#bcb6c4', '#948e9e'], DSMOKE = ['#6c6670', '#4e4854', '#36323c'], STEAM = ['#ffffff', '#eef2f8', '#d4dce8'];
  const BRASS = ['#fff6c8', '#ffd24c', '#e0a040', '#8a5a18'];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  /* 像素一个个写进 ImageData 再一次贴上去（比一个像素一个 fillRect 快十倍，第一次用到时不卡） */
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function pixels(w, h, f) { const c = mk(w, h), g = c.getContext('2d'), id = g.createImageData(w, h), d = id.data; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const col = f(x, y); if (!col) continue; const k = (y * w + x) * 4; d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255; } g.putImageData(id, 0, 0); return c; }
  const BALL = new Map();
  function ball(r, cols) {
    r = Math.max(1, Math.round(r)); const key = r + cols[0] + cols[cols.length - 1]; let c = BALL.get(key); if (c) return c;
    const rgb = cols.map(hex);
    c = pixels(r * 2 + 1, r * 2 + 1, (x, y) => { const i = x - r, j = y - r; if (i * i + j * j > r * r + r * 0.6) return null; return rgb[Math.min(cols.length - 1, Math.max(0, Math.floor((j + r * 0.8 + i * 0.25) / (2 * r + 0.01) * cols.length)))]; });
    BALL.set(key, c); return c;
  }
  const drawBall = (g, x, y, r, cols, a = 1) => { if (r < 0.5 || a <= 0) return; const c = ball(r, cols), rr = (c.width - 1) / 2; if (a < 1) g.globalAlpha = a; g.drawImage(c, ps(x - rr), ps(y - rr)); if (a < 1) g.globalAlpha = 1; };
  /* 云团（穿云和前景的云丝）：几个圆叠成一团，光从左上来，四阶明暗 */
  const PUFF = new Map();
  function puff(r, k) {
    r = Math.round(r); const key = r + ':' + k; let c = PUFF.get(key); if (c) return c;
    const rng = U.rng(r * 131 + k * 977 + 7), blobs = [[0, 0, r * 0.72]];
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283 + rng() * 0.7, d = r * (0.34 + rng() * 0.22); blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.62, r * (0.42 + rng() * 0.2)]); }
    const sz = Math.ceil(r * 2.4) + 2, cx = sz / 2, cy = sz / 2;
    const cols = ['#ffffff', '#f7f9fd', '#e9eef6', '#d2dae8', '#b8c4d8'].map(hex);
    c = pixels(sz, sz, (x, y) => {
      let sh = 2; for (const [bx, by, br] of blobs) { const dx = x - cx - bx, dy = y - cy - by; if (dx * dx + dy * dy <= br * br) sh = Math.min(sh, (dy + dx * 0.35 + br) / (2 * br)); }
      return sh > 1.5 ? null : cols[Math.min(cols.length - 1, Math.max(0, Math.floor(sh * cols.length)))];
    });
    PUFF.set(key, c); return c;
  }
  /* 云团图第一次画要几毫秒：开打推近的那半秒里一帧画几张，免得穿云那一下卡一帧 */
  const WARM = []; for (let k = 0; k < 4; k++) { for (const r of [16, 20, 26, 34]) WARM.push([r, k]); for (let i = 0; i < 9; i++) WARM.push([46 + (i * 37 % 20), k]); for (const r of [40, 46, 52, 58]) WARM.push([r, k]); }
  BT.warm = function (n) { while (n-- > 0 && WARM.length) { const [r, k] = WARM.pop(); puff(r, k); } };
  /* 像素圆环（冲击波） */
  function ring(g, x, y, r, col, th = 1) { if (r < 1) return; g.fillStyle = col; const X = ps(x), Y = ps(y), n = Math.max(12, Math.round(r * 6.283 / 1.6)); for (let t = 0; t < th; t++) { const rr = r - t; for (let i = 0; i < n; i++) { const a = i / n * 6.283; g.fillRect(X + Math.round(Math.cos(a) * rr), Y + Math.round(Math.sin(a) * rr), 1, 1); } } } // 圆心对齐到物理像素，圈的形状按整像素
  /* 战斗用的云海图块：左右镜像的那一张在载入后画好（省得 sprites.js 再大一倍） */
  let TILES = null;
  let OFF = null; // 推近完淡出的那张大地图图（整张画布大小），几场仗共用一张，不每场重新开
  function tiles() {
    if (TILES) return TILES; const T = G.SPR.battle.tiles, flip = im => { const c = mk(im.width, im.height), g = c.getContext('2d'); g.translate(im.width, 0); g.scale(-1, 1); g.drawImage(im, 0, 0); return c; };
    TILES = { inner: T.innerImg, border: T.borderImg, innerM: flip(T.innerImg), borderM: flip(T.borderImg), w: T.w, h: T.h }; return TILES;
  }
  const ease = U.ease, lerp = U.lerp, clamp = U.clamp;
  const bez = (p, t) => { const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; return { x: a * p[0].x + b * p[1].x + c * p[2].x, y: a * p[0].y + b * p[1].y + c * p[2].y }; };

  /* ---------------- 开打 ---------------- */
  const P = {};
  BT.create = function (map, p) { const b = Object.create(P); b.init(map, p); return b; };
  P.init = function (map, p) {
    const st = this.st = Game.st; this.map = map; this.sea = map.sea; this.ship = S.ship(st); this.P = p;
    this.SP = G.SPR.battle; this.Z = this.SP.Z; this.Sp = this.SP.ships[this.ship.hull];
    this.region = p.region || (this.sea.x < M.borderX ? 'inner' : 'border');
    this.mult = D.ENEMY_MULT[this.region]; this.bspd = this.region === 'border' ? 1.15 : 1; this.ivMul = this.region === 'border' ? 0.85 : 1;
    this.first = !!st.flags.firstBattle;
    this.seed = (p.seed != null ? p.seed : Math.floor(S.rand(st) * 2147483647)) >>> 0; this.rng = U.rng(this.seed);
    this.rec = S.recPower(this.region); this.pow0 = S.power(this.ship); this.tone = S.powerTone(this.pow0, this.rec);
    this.x0 = this.sea.x; this.y0 = this.sea.y; // 开打前的位置：打完船还在这里
    // 要打的那艘：巡逻船 / 守货的 / 捞了你货的 / 追兵。它就是这一仗的旗舰
    this.tgt = p.kind === 'chase' ? this.sea.chase : (p.patrolId ? st.world.patrols.find(q => q.id === p.patrolId && q.alive) : null);
    let dir = this.sea.face || 1;
    if (this.tgt && p.kind !== 'chase' && Math.abs(this.tgt.x - this.sea.x) > 12) dir = this.tgt.x > this.sea.x ? 1 : -1;
    this.dir = dir; this.sea.face = dir; this.sea.vx = 0; this.sea.vy = 0;
    if (this.tgt) this.tgt.face = this.tgt.x > this.sea.x ? -1 : 1;
    this.kindName = p.kind === 'chase' ? '追兵战' : p.kind === 'guard' ? '遭遇战 · 守货的海盗' : (this.tgt && this.tgt.kind === 'scooper') ? '遭遇战 · 捞了你货的海盗' : '遭遇战 · 海盗巡逻队';
    // 镜头：大地图镜头 cam0（倍数 1）→ 推近以后 camB（倍数 Z）；船在屏幕上从原来的位置挪到战斗的起点
    this.cam0 = { x: map.cam.x, y: map.cam.y };
    this.pMap = { x: this.sea.x - this.cam0.x, y: this.sea.y - this.cam0.y };
    this.pB = { x: dir > 0 ? 150 : W - 150, y: clamp(this.pMap.y, 150, 215) };
    this.camB = { x: this.sea.x - this.pB.x / this.Z, y: this.sea.y - this.pB.y / this.Z };
    this.cam = { x: this.camB.x, y: this.camB.y }; // 战斗里的镜头（世界坐标，画面左上角），一直往前飞
    this.loadOff = map.loadOff();
    const Sp = this.Sp;
    this.pl = { x: 150, y: this.pB.y + this.loadOff * this.Z, vx: 0, vy: 0, inv: 0.6, dash: 0, dcd: 0, dx: 0, dy: 0, fire: 0.6, kick: 0, flash: 0, shake: 0, dead: false, ghosts: [], bounce: 0 };
    this.hbo = { x: Math.round(Sp.hullX + Sp.hullW * 0.5 - Sp.w / 2), y: Math.round(Sp.deckY + (Sp.hullBottom - Sp.deckY) * 0.45 - Sp.h / 2) };
    this.en = []; this.dyingShips = []; this.bul = []; this.eb = []; this.crates = []; this.loot = []; this.squads = [];
    this.fx = { sparks: [], fire: [], smoke: [], rings: [], debris: [], cloth: [], shells: [], muz: [], lines: [], wisps: [], coins: [], steam: [], text: [] };
    this.uid = 0; this.t = 0; this.pt = 0; this.phase = 'in'; this.hitstop = 0; this.slowT = 0; this.shk = { t: 0, amp: 0, d: 1 }; this.redT = 0; this.whiteT = 0;
    this.gauge = 0; this.skill = 0; this.cutin = 0; this.sring = null; this.xf = 0; this.tFight = 0; this.saveT = 0; this.wispT = 1;
    this.stats = { kills: 0, caught: 0, flown: 0, lost: 0 }; this.hits = 0; this.impact = []; this.streak = { n: 0, t: 0 }; this.combo = { n: 0, t: 0 }; this.trays = []; this.hudPop = 0; this.hpShake = 0;
    this.waves = this.makeWaves(p); this.wave = 0; this.nextT = 1.5; this.ban = null; this.ann = null; this.boss = null;
    this.scroll = M.speed * D.TIERS[S.stats(this.ship).tier].map * this.Z; // 船一直往前飞：战斗像素/秒
    // 存档：仗里退出按被击落算；开打 10 秒内掉线就用同一个种子重开这一场（design.md「12 存档」「13 边界情况」）
    const sh = this.ship;
    st.battle = { p: { kind: p.kind, patrolId: p.patrolId || null, cargo: (p.cargo || []).map(i => ({ ...i })), region: this.region, chase: !!p.chase }, seed: this.seed, t: 0, x: this.x0, y: this.y0, pre: { hp: sh.hp, hold: sh.hold.map(i => ({ ...i })), deck: sh.deck.map(i => ({ ...i })) } };
    st.mapPos = { x: this.x0, y: this.y0 };
    G.UI.floaters = [];
    G.Sfx.play('alarm'); G.Sfx.play('whoosh'); G.Sfx.hum(true, 1.15);
    Game.save();
  };
  P.makeWaves = function (p) {
    const set = this.first ? SETS.first : p.kind === 'chase' ? SETS.chase[this.region] : p.kind === 'guard' ? SETS.guard[this.region] : SETS[this.region];
    const waves = JSON.parse(JSON.stringify(set[Math.floor(this.rng() * set.length)]));
    // 它甲板上的货：船材给第一队的长机（第一次击毁就有箱子飞出来），货箱和模块在旗舰甲板上（大地图上看见的那几箱）
    const cargo = (p.cargo || []).map(i => ({ ...i }));
    waves.forEach(w => { w.cargo = w.ships.map(() => []); });
    const bossW = waves[waves.length - 1], first = waves[0];
    for (const it of cargo) { if (it.k === 'mat' && first !== bossW) first.cargo[0].push(it); else bossW.cargo[0].push(it); }
    return waves;
  };

  /* ---------------- 小工具：坐标 ---------------- */
  P.sx = function (x) { return this.dir > 0 ? x : W - x; }; // 战斗坐标 → 屏幕
  P.hitbox = function () { return { x: this.pl.x + this.hbo.x, y: this.pl.y + this.hbo.y }; };
  P.moveSpeed = function () { return 150 * D.TIERS[S.stats(this.ship).tier].battle; };
  P.shipBox = function () { const Sp = this.Sp, pl = this.pl; return { x0: pl.x - Sp.w / 2, x1: pl.x + Sp.w / 2, y0: pl.y - Sp.h / 2, y1: pl.y + Sp.h / 2 }; };
  P.muzzle = function () { const Sp = this.Sp, pl = this.pl; return this.muzzleAt(Math.round(pl.x - Sp.w / 2), Math.round(pl.y - Sp.h / 2)); }; // 逻辑用（子弹从这里出去）：按整像素，和画面分辨率无关
  P.muzzleAt = function (ox, oy) { // 船图左上角在 (ox, oy) 时炮口在哪（画图时传画出来的那个起点）
    const Sp = this.Sp, c = Sp.parts.cannon, ss = S.stats(this.ship);
    if (ss.gun && c) return { x: ox + c.x + c.w, y: oy + c.y + Math.round(c.h * 0.38) };
    return { x: ox + Sp.hullX + Sp.hullW, y: oy + Sp.deckY - 2 };
  };
  /* 敌船的炮口（精灵图里的比例）：拼出来的船按铜炮的位置，旗舰是 pirate.png 上那两门炮 */
  P.muzzlesOf = function (e) {
    const pts = e.type === 'flag' ? [[0.47, 0.55], [0.71, 0.55]] : [[(e.E.parts.cannon.x + e.E.parts.cannon.w) / e.E.w, (e.E.parts.cannon.y + e.E.parts.cannon.h * 0.38) / e.E.h]];
    return pts.map(([u, v]) => ({ x: e.x + e.face * (u * e.w - e.w / 2), y: e.y - e.h / 2 + v * e.h }));
  };
  P.addShake = function (amp, d) { if (amp >= this.shk.amp * (this.shk.t / this.shk.d || 0)) { this.shk.amp = amp; this.shk.t = d; this.shk.d = d; } };
  P.shakeOff = function () { const s = this.shk; if (s.t <= 0) return { x: 0, y: 0 }; const a = s.amp * (s.t / s.d); return { x: Math.round((R() * 2 - 1) * a), y: Math.round((R() * 2 - 1) * a * 0.7) }; };
  P.inBattle = function () { return this.phase !== 'panel'; };
  P.blockEsc = function () { return this.phase !== 'fight' && this.phase !== 'clear'; };

  /* ================================================================ 每帧 ================================================================ */
  BT.timeScale = 1; // 开发用：无头截图时放慢（正式游戏不动它）
  P.update = function (dt) {
    dt *= BT.timeScale; this.t += dt; this.sea.t += dt;
    for (const tr of this.trays) tr.t += dt; this.trays = this.trays.filter(tr => tr.t < tr.life);
    if (this.ban) { this.ban.t += dt; if (this.ban.t > this.ban.life) this.ban = null; }
    if (this.ann) { this.ann.t += dt; if (this.ann.t > this.ann.life) this.ann = null; }
    this.hudPop = Math.max(0, this.hudPop - dt * 4); this.hpShake = Math.max(0, this.hpShake - dt);
    const ph = this.phase;
    if (ph === 'panel') return;
    if (ph === 'down') { this.down.t -= dt; this.stepFx(dt * 0.3); if (this.down.t <= 0) this.sink(); return; }
    BT.warm(ph === 'in' ? 5 : 1);
    if (ph === 'in') { this.pt += dt; this.map.particles(dt, S.stats(this.ship)); if (this.pt >= IN_T) this.startFight(); return; }
    if (ph === 'out') { this.updateOut(dt); return; }
    // 闪白、红边、技能切入、震屏按真实时间走（顿帧时也走，不然一顿就白一大片）
    this.xf = Math.max(0, this.xf - dt); this.cutin = Math.max(0, this.cutin - dt); this.shk.t = Math.max(0, this.shk.t - dt); this.redT = Math.max(0, this.redT - dt); this.whiteT = Math.max(0, this.whiteT - dt);
    // 按键先记下来 0.2 秒：顿帧那几帧里按的冲刺、技能也算
    const bf = this.buf || (this.buf = { dash: 0, skill: 0 }); bf.dash = Math.max(0, bf.dash - dt); bf.skill = Math.max(0, bf.skill - dt);
    if (In.hit('Space', 'KeyK')) bf.dash = 0.2; if (In.hit('KeyE', 'KeyJ')) bf.skill = 0.2;
    // 顿帧：命中、击毁、被打中、放技能的那一下，整个世界停几帧（被击毁的船这几帧是一整个白影）
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    if (this.impact.length) { const im = this.impact; this.impact = []; for (const e of im) this.explode(e); }
    let sdt = dt; if (this.slowT > 0) { this.slowT -= dt; sdt = dt * 0.35; } // 慢动作：旗舰炸了、自己被击落
    this.streak.t = Math.max(0, this.streak.t - dt); if (this.streak.t <= 0) this.streak.n = 0;
    // 船一直往前飞：镜头在世界里往前移（世界坐标），云海和浮岛往后退。推近后先淡入，再慢慢加速
    const ramp = this.phase === 'fight' ? clamp((this.tFight - XF_T) / 0.9, 0, 1) : 1;
    const sp = this.scroll * ramp * (this.skill > 0 ? 1.35 : 1) * (this.pl.dash > 0 ? 1.25 : 1);
    this.cam.x += this.dir * sp / this.Z * sdt;
    if (ph === 'fight' || ph === 'clear') {
      this.tFight += dt; this.saveT += dt;
      if (this.saveT > 2) { this.saveT = 0; if (this.st.battle) { this.st.battle.t = this.tFight; Game.save(); } }
      this.updatePlayer(sdt); this.updateWaves(sdt);
    }
    if (ph === 'dying') { this.pt += dt; this.updateDying(sdt); }
    this.updateEnemies(sdt); this.updateBullets(sdt); this.updateCrates(sdt); this.stepFx(sdt);
    if (ph === 'clear') { this.clearT += dt; const live = this.crates.some(c => !c.done); if ((!live && this.clearT > 1.4) || this.clearT > 10.5) this.startOut(); }
    if (this.combo.t > 0) { this.combo.t -= dt; if (this.combo.t <= 0) this.combo.n = 0; }
  };

  P.startFight = function () {
    this.phase = 'fight'; this.pt = 0; this.xf = XF_T;
    this.map.steam.clear(); this.map.fire.clear(); this.map.wake.clear();
    this.ban = { t: 0, life: 2.6, title: this.kindName, sub: `推荐战力 ${this.rec}　你的战力 ${this.pow0}（${this.tone.word}）`, col: this.tone.c };
    // 旗舰（你开战的那艘）先退到前面去，放出护卫小队；最后一队它自己带着护卫回来
    const T = this.tgt;
    const Z = this.Z, tbx = T ? (T.x - this.camB.x) * Z : 0, tby = T ? (T.y - this.camB.y) * Z : 0, tx = this.dir > 0 ? tbx : W - tbx;
    if (T && tx > -80 && tx < W + 80 && tby > -50 && tby < H + 50) { // 推近以后它还在画面里，才演它退场；不在画面里就直接等最后一队
      const bx = tbx, by = tby, x = tx;
      const e = this.spawnShip('flag', x, by, null, [0, 0], []); e.retreat = true; e.face = x > this.pl.x ? -1 : 1; e.vx = 0;
      e.path = [{ x, y: by }, { x: x + (x < this.pl.x + 60 ? 60 : 120), y: clamp(by < H / 2 ? by - 60 : by + 60, 40, H - 40) }, { x: W + 140, y: clamp(by < H / 2 ? 70 : H - 70, 60, H - 60) }]; e.pathT = 0;
      this.ann = { t: 0, life: 2.2, text: this.P.kind === 'chase' ? '它叫来了同伙！' : '海盗船退到后面，放出护卫小队！' };
    }
    G.Sfx.play('charge');
  };

  /* ---------------- 玩家 ---------------- */
  P.updatePlayer = function (dt) {
    const pl = this.pl, Sp = this.Sp, ss = S.stats(this.ship); if (pl.dead) return;
    const ax = In.axis(), mx = ax.x * this.dir, my = ax.y, l = Math.hypot(mx, my) || 1, spd = this.moveSpeed();
    pl.dcd = Math.max(0, pl.dcd - dt); pl.inv = Math.max(0, pl.inv - dt); pl.kick = Math.max(0, pl.kick - dt); pl.flash = Math.max(0, pl.flash - dt); pl.shake = Math.max(0, pl.shake - dt); pl.bounce = Math.max(0, pl.bounce - dt);
    // 冲刺：0.16 秒，途中无敌 0.26 秒，冷却 0.9 秒
    if (this.buf.dash > 0 && pl.dcd <= 0) {
      this.buf.dash = 0; pl.dash = 0.16; pl.dcd = 0.9; pl.dx = mx || my ? mx / l : 1; pl.dy = mx || my ? my / l : 0; pl.inv = Math.max(pl.inv, 0.26); G.Sfx.play('dash');
      const hb = this.hitbox(); for (let i = 0; i < 8; i++) this.fx.smoke.push({ x: hb.x - pl.dx * 20 + (R() - 0.5) * 16, y: hb.y + (R() - 0.5) * 16, vx: -pl.dx * 60 - this.scroll * 0.5, vy: -pl.dy * 60, r0: 2, r1: 6, t: 0, life: 0.4, cols: STEAM });
    }
    const tvx = mx / l * spd, tvy = my / l * spd, k = Math.min(1, dt * 16);
    pl.vx += (tvx - pl.vx) * k; pl.vy += (tvy - pl.vy) * k;
    if (pl.dash > 0) { pl.dash -= dt; pl.vx = pl.dx * spd * 3.2; pl.vy = pl.dy * spd * 3.2; pl.ghosts.push({ x: pl.x, y: pl.y, t: 0.22 }); }
    pl.x = clamp(pl.x + pl.vx * dt, Sp.w / 2 + 4, 400); pl.y = clamp(pl.y + pl.vy * dt, Sp.h / 2 + LB + 2, H - LB - 2 - Sp.h / 2);
    for (const gh of pl.ghosts) gh.t -= dt; pl.ghosts = pl.ghosts.filter(gh => gh.t > 0);
    // 航迹和引擎蒸汽
    const ox = pl.x - Sp.w / 2, oy = pl.y - Sp.h / 2;
    if (R() < 60 * dt * 0.5) this.fx.steam.push({ x: ox + Sp.chim.x, y: oy + Sp.chim.y - 1, vx: -this.scroll * 0.55 - 8, vy: -14, r0: 1, r1: 4, t: 0, life: 1.1, cols: STEAM });
    if (R() < 60 * dt * 0.7) this.fx.steam.push({ x: ox + 8, y: oy + Sp.hullBottom - 5 + (R() - 0.5) * 4, vx: -this.scroll * 0.9, vy: 3, r0: 2, r1: 3, t: 0, life: 0.9, cols: STEAM, wake: true });
    if (this.ship.hp < ss.hpMax * 0.35 && R() < 60 * dt * 0.35) { const hb = this.hitbox(); this.fx.smoke.push({ x: hb.x + (R() - 0.5) * 30, y: hb.y - 4, vx: -this.scroll * 0.6, vy: -10, r0: 2, r1: 6, t: 0, life: 1.2, cols: DSMOKE }); }
    // 自动开火：连发炮；放技能时五道弹流、射速翻倍、伤害 ×1.5
    pl.fire -= dt; const gun = ss.gun;
    if (pl.fire <= 0) {
      const rate = gun ? (this.skill > 0 ? 16 : 9) : 5; pl.fire = Math.max(pl.fire + 1 / rate, 0.02);
      const dmg = (gun ? ss.dmg : 0.5) * (this.skill > 0 ? 1.5 : 1), mz = this.muzzle(); pl.alt = !pl.alt;
      if (this.skill > 0) for (const a of [-0.2, -0.1, 0, 0.1, 0.2]) this.bul.push({ x: mz.x, y: mz.y, vx: Math.cos(a) * 460, vy: Math.sin(a) * 460, dmg, big: true });
      else this.bul.push({ x: mz.x, y: mz.y + (pl.alt ? 0 : 1), vx: 430, vy: (R() - 0.5) * 8, dmg, big: false });
      pl.kick = 0.05; this.fx.muz.push({ x: mz.x, y: mz.y, t: 0, life: 0.07, big: this.skill > 0, own: true });
      if (pl.alt) this.fx.shells.push({ x: mz.x - 8, y: mz.y - 2, vx: -30 - R() * 30, vy: -50 - R() * 30, t: 0, life: 0.7, s: 0 });
      G.Sfx.play('shoot');
    }
    // 技能「铜雨」：满了按 E
    this.skill = Math.max(0, this.skill - dt);
    if (this.buf.skill > 0) {
      if (this.gauge >= 100 && gun) { this.buf.skill = 0; this.castSkill(); }
      else if (!gun && In.hit('KeyE', 'KeyJ')) G.UI.toast('没装主炮：没有技能');
    }
    if (this.skill > 0 && R() < 60 * dt * 0.6) { const mz = this.muzzle(); this.fx.steam.push({ x: ox + Sp.chim.x, y: oy + Sp.chim.y, vx: -this.scroll * 0.5, vy: -30, r0: 2, r1: 6, t: 0, life: 0.6, cols: STEAM }); this.fx.sparks.push({ x: mz.x, y: mz.y, vx: 40 + R() * 60, vy: (R() - 0.5) * 80, g: 0, t: 0, life: 0.18, c: '#fff4c0' }); }
  };
  P.castSkill = function () {
    const hb = this.hitbox();
    this.gauge = 0; this.skill = 2.4; this.cutin = 0.85; this.hitstop = 0.24; this.whiteT = 0.12; this.addShake(4, 0.35);
    this.sring = { x: hb.x, y: hb.y, r: 6, id: ++this.uid };
    G.Sfx.play('cutin'); G.Sfx.play('skill');
    this.fx.rings.push({ x: hb.x, y: hb.y, r0: 6, r1: 70, t: 0, life: 0.3, col: '#fff4c0', th: 3 });
    for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; this.fx.sparks.push({ x: hb.x, y: hb.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, g: 0, t: 0, life: 0.35, c: i % 2 ? '#ffd24c' : '#fff6c8', big: true }); }
  };

  /* ---------------- 波次和小队 ---------------- */
  P.updateWaves = function (dt) {
    if (this.phase !== 'fight') return;
    this.nextT -= dt;
    const active = this.en.some(e => e.alive && !e.retreat);
    if (active || this.dyingShips.some(d => d.type === 'flag')) return;
    if (this.nextT > 0) return;
    if (this.wave < this.waves.length) { this.spawnWave(this.waves[this.wave++]); this.nextT = 1.3; return; }
    if (!this.en.length && !this.dyingShips.length) this.toClear();
  };
  P.spawnShip = function (type, x, y, sq, slot, cargo) {
    const T = TYPES[type], fl = type === 'flag', E = fl ? null : this.SP.enemies[type];
    const w = fl ? this.SP.flag.w : E.w, h = fl ? this.SP.flag.h : E.h;
    const hp = (fl && this.first ? 64 : T.hp) * this.mult;
    const e = { id: ++this.uid, type, T, E, x, y, vx: 0, vy: 0, w, h, face: -1, hp, hpMax: hp, sq, slot, alive: true, flash: 0, kick: 0, gk: 0,
      fireT: (0.9 + this.rng() * 1.2) * this.ivMul, burst: 0, burstT: 0, t: this.rng() * 6, cargo: cargo || [], smokeT: 0, panic: 0, ph: this.rng() * 6, charge: 0, pat: 0 };
    this.en.push(e); return e;
  };
  P.spawnWave = function (wv) {
    const F = FORMS[wv.form], boss = !!wv.boss;
    const span = Math.max(...F.slots.map(s => Math.abs(s[1]))) + 30;
    const ay = boss ? clamp(this.pl.y, 150, 200) : clamp(130 + this.rng() * 100, LB + span, H - LB - span), ax = boss ? 520 : 470 + this.rng() * 40;
    const pY = this.hitbox().y;
    let path, dur;
    if (wv.entry === 'dive') { path = [{ x: W - 40, y: -80 }, { x: ax + 40, y: ay - 150 }, { x: ax, y: ay }]; dur = 2.3; }
    else if (wv.entry === 'climb') { path = [{ x: W - 40, y: H + 80 }, { x: ax + 40, y: ay + 150 }, { x: ax, y: ay }]; dur = 2.3; }
    else if (wv.entry === 'behind') { const ly = pY > H / 2 ? 70 : H - 70; path = [{ x: -130, y: ly }, { x: W + 80, y: ly }, { x: ax, y: ay }]; dur = 3.2; }
    else { path = [{ x: W + 110, y: ay + (this.rng() - 0.5) * 60 }, { x: ax + 150, y: ay }, { x: ax, y: ay }]; dur = boss ? 2.6 : 2.0; }
    const sq = { id: ++this.uid, F, form: wv.form, members: [], state: 'enter', t: 0, dur, path, anchor: { x: ax, y: ay }, boss, pressT: 5 + this.rng() * 3, press: 0, leaderDead: false };
    const face0 = wv.entry === 'behind' ? 1 : -1;
    wv.ships.forEach((type, i) => {
      const slot = F.slots[i] || [50 * i, 0], x = path[0].x - face0 * slot[0], y = path[0].y + slot[1];
      const e = this.spawnShip(type, x, y, sq, slot, wv.cargo[i]); e.face = face0; e.lead = i === 0; sq.members.push(e);
    });
    sq.leader = sq.members[0]; this.squads.push(sq);
    if (boss) { this.boss = sq.leader; this.ann = { t: 0, life: 2.4, text: `${this.P.kind === 'chase' ? '追兵' : '旗舰'}来了：带着 ${wv.ships.length - 1} 艘护卫` }; G.Sfx.play('charge'); }
    else this.ann = { t: 0, life: 2.4, text: `敌方小队 ${wv.ships.length} 艘：${TYPES[wv.ships[0]].name}带 ${wv.ships.length - 1} 艘僚机（${F.name}）` };
    G.Sfx.play('alarm');
  };
  P.slotTarget = function (L, slot) { return { x: L.x - L.face * slot[0], y: L.y + slot[1] }; };

  P.updateEnemies = function (dt) {
    const hb = this.hitbox(), pl = this.pl;
    for (const sq of this.squads) {
      sq.t += dt; const L = sq.leader;
      if (!L.alive) continue;
      if (sq.state === 'enter') {
        const u = clamp(sq.t / sq.dur, 0, 1), p = bez(sq.path, 1 - (1 - u) * (1 - u));
        L.vx = (p.x - L.x) / Math.max(dt, 1e-3); L.vy = (p.y - L.y) / Math.max(dt, 1e-3); L.x = p.x; L.y = p.y;
        if (L.vx > 30) L.face = 1; else if (L.vx < -4) L.face = -1;
        if (u >= 1) { sq.state = 'hold'; L.face = -1; if (sq.F.then) sq.F = FORMS[sq.F.then]; sq.members.forEach((m, i) => { m.slot = sq.F.slots[i] || m.slot; }); }
      } else {
        // 悬停：在锚点附近慢慢晃；隔一阵整队往前压一下（旗舰不压，它放弹幕）
        sq.pressT -= dt;
        if (!sq.boss && sq.pressT <= 0 && sq.press <= 0) { sq.press = 2.4; sq.pressT = 6 + this.rng() * 3; }
        let ax = sq.anchor.x, ay = sq.anchor.y;
        if (sq.press > 0) { sq.press -= dt; ax = Math.max(330, ax - 130); ay = clamp(hb.y - (L.h * 0.1), LB + 50, H - LB - 50); }
        if (sq.boss) ay = clamp(lerp(ay, hb.y, 0.35), 110, 250);
        const tx = ax + Math.sin(sq.t * 0.55 + L.ph) * 16, ty = ay + Math.sin(sq.t * 0.9 + L.ph) * (sq.boss ? 18 : 26), k = Math.min(1, dt * (sq.press > 0 ? 1.4 : 1.8));
        const nx = L.x + (tx - L.x) * k, ny = L.y + (ty - L.y) * k; L.vx = (nx - L.x) / Math.max(dt, 1e-3); L.vy = (ny - L.y) / Math.max(dt, 1e-3); L.x = nx; L.y = ny; L.face = -1;
      }
    }
    for (const e of this.en) {
      e.t += dt; e.flash = Math.max(0, e.flash - dt); e.kick = Math.max(0, e.kick - dt); e.gk = Math.max(0, e.gk - dt); e.panic = Math.max(0, e.panic - dt);
      // 退场（开打时旗舰退到前面去）
      if (e.retreat) { e.pathT += dt / 1.6; const p = bez(e.path, ease(Math.min(1, e.pathT))); e.vx = (p.x - e.x) / Math.max(dt, 1e-3); e.x = p.x; e.y = p.y; if (e.vx > 20) e.face = 1; if (e.pathT >= 1) e.gone = true; this.trail(e, dt); continue; }
      const sq = e.sq;
      if (sq && sq.leader !== e) {
        if (!sq.leader.alive || e.solo) {
          // 长机没了：僚机乱了阵脚，各自找地方晃、打得更凶
          if (!e.solo) { e.solo = true; e.panic = 1.4; e.anchor = { x: clamp(e.x + 30, 380, 580), y: clamp(e.y, LB + 40, H - LB - 40) }; }
          const tx = e.anchor.x + Math.sin(e.t * 1.1 + e.ph) * 24, ty = e.anchor.y + Math.sin(e.t * 1.6 + e.ph) * 36, k = Math.min(1, dt * 2.2);
          e.vx = (tx - e.x) * k / Math.max(dt, 1e-3); e.x += (tx - e.x) * k; e.y += (ty - e.y) * k; e.face = -1;
        } else {
          const tg = this.slotTarget(sq.leader, e.slot), k = Math.min(1, dt * (sq.state === 'enter' ? 4.5 : 3));
          const nx = e.x + (tg.x - e.x) * k, ny = e.y + (tg.y - e.y) * k + Math.sin(e.t * 2 + e.ph) * 0.15;
          e.vx = (nx - e.x) / Math.max(dt, 1e-3); e.x = nx; e.y = ny; e.face = sq.leader.face;
        }
      }
      this.trail(e, dt);
      // 受伤冒烟：血少于一半冒黑烟，少于四分之一着火
      if (e.hp < e.hpMax * 0.5) { e.smokeT -= dt; if (e.smokeT <= 0) { e.smokeT = e.hp < e.hpMax * 0.25 ? 0.05 : 0.1; this.fx.smoke.push({ x: e.x + (R() - 0.5) * e.w * 0.5, y: e.y + e.h * 0.15, vx: -this.scroll * 0.5 + 20, vy: -12, r0: 2, r1: 5 + e.w / 40, t: 0, life: 0.9, cols: DSMOKE }); if (e.hp < e.hpMax * 0.25) this.fx.fire.push({ x: e.x + (R() - 0.5) * e.w * 0.4, y: e.y + e.h * 0.2, vx: 0, vy: -20, r0: 2, r1: 1, t: 0, life: 0.3, st: 1 }); } }
      // 开火：在画面里、对着你、入场走完大半
      const on = e.x < W - 14 && e.x > 50 && e.y > LB + 8 && e.y < H - LB - 8 && e.face < 0 && !(sq && sq.state === 'enter' && sq.t < sq.dur * 0.7);
      if (on && this.phase === 'fight' && !pl.dead) { e.fireT -= dt; if (e.fireT <= 0) this.enemyFire(e); if (e.charge > 0) { e.charge -= dt; if (e.charge <= 0) this.bossShoot(e); } }
      if (e.burst > 0) { e.burstT -= dt; if (e.burstT <= 0) { e.burst--; e.burstT = e.type === 'flag' ? 0.1 : 0.12; const ms = this.muzzlesOf(e), mz = ms[e.burst % ms.length], a = Math.atan2(hb.y - mz.y, hb.x - mz.x); this.shoot(mz, a, (e.type === 'flag' ? 88 : e.T.spd), 2.5, 's'); this.eMuzzle(e, mz); } }
      // 撞上敌船 ×2
      if (!pl.dead && pl.inv <= 0 && this.phase === 'fight' && Math.abs(hb.x - e.x) < e.w * 0.38 && hb.y > e.y - e.h * 0.05 && hb.y < e.y + e.h * 0.45) this.hurt(2);
    }
    this.en = this.en.filter(e => e.alive && !e.gone);
    this.squads = this.squads.filter(sq => sq.members.some(m => m.alive));
    // 正在炸的旗舰
    for (const d of this.dyingShips) { d.t += dt; d.y += 14 * dt; d.x -= 10 * dt; d.boomT -= dt; if (d.boomT <= 0 && d.t < d.dur) { d.boomT = 0.13; const x = d.x + (R() - 0.5) * d.w * 0.8, y = d.y + (R() - 0.5) * d.h * 0.6; this.boom(x, y, 1.4); this.addShake(3, 0.15); } if (d.t >= d.dur) this.finalBreak(d); }
    this.dyingShips = this.dyingShips.filter(d => d.t < d.dur);
  };
  /* 海盗拖着红色蒸汽尾 */
  P.trail = function (e, dt) { if (R() < 60 * dt * (e.type === 'flag' ? 0.6 : 0.35)) { const sx = e.x - e.face * e.w * 0.47, sy = e.y + e.h * (e.type === 'flag' ? 0.05 : 0.12); this.fx.steam.push({ x: sx, y: sy + (R() - 0.5) * 3, vx: -e.face * 46, vy: -6 + (R() - 0.5) * 8, r0: 1, r1: e.type === 'flag' ? 3 : 2, t: 0, life: 0.5, cols: A.RED.slice(0, 3), fade: true }); } };

  /* ---------------- 敌人开火（敌弹从前方来；判定点小且固定；弹速有上限；首领的每种弹幕都留一条能走的路） ---------------- */
  P.shoot = function (mz, a, v, r, kind) { const s = Math.min(SPD_CAP, v * this.bspd); this.eb.push({ x: mz.x, y: mz.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r, kind, g: false, t: 0 }); };
  P.eMuzzle = function (e, mz) { e.gk = 0.08; this.fx.muz.push({ x: mz.x, y: mz.y, t: 0, life: 0.08, red: true }); this.fx.smoke.push({ x: mz.x - 4, y: mz.y, vx: -this.scroll * 0.3 - 20, vy: -6, r0: 1, r1: 3, t: 0, life: 0.4, cols: SMOKE }); G.Sfx.play('eshoot'); };
  P.enemyFire = function (e) {
    const hb = this.hitbox(), T = e.T, ms = this.muzzlesOf(e), mz = ms[0], aim = Math.atan2(hb.y - mz.y, hb.x - mz.x);
    e.fireT = (T.iv[0] + this.rng() * (T.iv[1] - T.iv[0])) * this.ivMul * (e.panic > 0 || e.solo ? 0.72 : 1);
    if (T.fire === 'single') { const sp3 = e.sq && e.sq.press > 0; for (let i = sp3 ? -1 : 0; i <= (sp3 ? 1 : 0); i++) this.shoot(mz, aim + i * 0.26, T.spd, 2.5, 's'); this.eMuzzle(e, mz); } // 整队往前压的时候僚机打三连散
    else if (T.fire === 'burst') { e.burst = 4; e.burstT = 0; }
    else if (T.fire === 'fan') { for (let i = -2; i <= 2; i++) this.shoot(mz, aim + i * 0.21, T.spd, 2.5, 's'); this.shoot(mz, aim, T.spd * 1.3, 4, 'b'); this.eMuzzle(e, mz); }
    else if (T.fire === 'boss') { e.charge = 0.55; e.chargeP = ['wall', 'burst', 'ring', 'burst'][e.pat++ % 4]; G.Sfx.play('charge'); } // 先蓄力：炮口发光，提醒你
  };
  P.bossShoot = function (e) {
    const hb = this.hitbox(), ms = this.muzzlesOf(e), P2 = e.chargeP;
    if (P2 === 'wall') {
      // 一堵弹墙从前面推过来，留两个 64 像素宽的口子（一个离你不远），走口子就过去了
      const g1 = clamp(hb.y + (this.rng() - 0.5) * 120, 50, H - 50); let g2 = 60 + this.rng() * (H - 120); if (Math.abs(g2 - g1) < 110) g2 = g1 < H / 2 ? g1 + 140 : g1 - 140;
      for (let y = LB + 8; y <= H - LB - 8; y += 15) { if (Math.abs(y - g1) < 32 || Math.abs(y - g2) < 32) continue; this.eb.push({ x: e.x - e.w * 0.4, y, vx: -60 * this.bspd, vy: 0, r: 3, kind: 'b', g: false, t: 0 }); }
      for (const mz of ms) this.eMuzzle(e, mz); this.addShake(2, 0.15);
    } else if (P2 === 'ring') {
      const n = 14, off = e.t * 0.7, c = { x: e.x - e.face * 0, y: e.y + e.h * 0.1 };
      for (let i = 0; i < n; i++) this.shoot(c, off + i * 6.283 / n, 56, 2.5, 's');
      this.shoot(ms[0], Math.atan2(hb.y - ms[0].y, hb.x - ms[0].x), 86, 4, 'b'); for (const mz of ms) this.eMuzzle(e, mz);
    } else { e.burst = 6; e.burstT = 0; }
  };

  /* ---------------- 子弹 ---------------- */
  P.updateBullets = function (dt) {
    const pl = this.pl, hb = this.hitbox(), ss = S.stats(this.ship);
    for (const b of this.bul) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      for (const e of this.en) {
        if (b.hit || !e.alive) continue;
        if (Math.abs(b.x - e.x) < e.w * 0.42 && Math.abs(b.y - e.y) < e.h * 0.42) {
          b.hit = true;
          if (e.retreat) { for (let i = 0; i < 3; i++) this.fx.sparks.push({ x: b.x, y: b.y, vx: -80 - R() * 80, vy: (R() - 0.5) * 160, g: 0, t: 0, life: 0.15, c: '#ffffff' }); G.Sfx.play('ping', { pitch: 1.4 }); } // 退场时打不动：铁皮弹开
          else this.hitEnemy(e, b);
        }
      }
    }
    this.bul = this.bul.filter(b => !b.hit && b.x < W + 20 && b.x > -20 && b.y > -20 && b.y < H + 20);
    // 技能的冲击波：碰到的敌弹变成铜屑飞回船上
    if (this.sring) {
      const s = this.sring; s.r += 1300 * dt;
      for (const b of this.eb) if (!b.dead && Math.hypot(b.x - s.x, b.y - s.y) < s.r) { b.dead = true; this.fx.coins.push({ x: b.x, y: b.y, vx: (R() - 0.5) * 60, vy: -40 - R() * 40, t: 0, life: 0.9 + R() * 0.3 }); }
      for (const e of this.en) if (!e.retreat && e.ring !== s.id && Math.hypot(e.x - s.x, e.y - s.y) < s.r) { e.ring = s.id; this.hitEnemy(e, { dmg: 4, x: e.x - e.w * 0.3, y: e.y, vx: 1 }, true); }
      if (s.r > 760) this.sring = null;
    }
    for (const b of this.eb) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.t += dt;
      if (pl.dead || this.phase !== 'fight') continue;
      const d = Math.hypot(b.x - hb.x, b.y - hb.y);
      if (d < 2.6 + b.r * 0.6) { if (pl.inv <= 0) { b.dead = true; this.hurt(1); } }
      else if (!b.g && d < 14) { b.g = true; this.gauge = Math.min(100, this.gauge + 2.2 * (1 + ss.charge / 100)); G.Sfx.play('graze'); this.fx.sparks.push({ x: b.x, y: b.y, vx: -b.vx * 0.2, vy: -30, g: 0, t: 0, life: 0.18, c: '#ffffff' }); this.gaugeCheck(); }
    }
    this.eb = this.eb.filter(b => !b.dead && b.x > -24 && b.x < W + 40 && b.y > -24 && b.y < H + 24);
  };
  P.gaugeCheck = function () { if (this.gauge >= 100 && !this.fullOnce && S.stats(this.ship).gun) { this.fullOnce = true; G.Sfx.play('full'); this.hudPop = 1; } if (this.gauge < 100) this.fullOnce = false; };
  P.hitEnemy = function (e, b, ring) {
    e.hp -= b.dmg; e.flash = 0.022; e.kick = 0.04; this.gauge = Math.min(100, this.gauge + (ring ? 0 : 0.25)); this.gaugeCheck();
    // 命中：火花往回溅，一个小白圈，叮的一声
    for (let i = 0; i < (b.big ? 5 : 3); i++) this.fx.sparks.push({ x: b.x, y: b.y, vx: -60 - R() * 120, vy: (R() - 0.5) * 140, g: 200, t: 0, life: 0.18 + R() * 0.16, c: R() < 0.5 ? '#fff4c0' : '#ffd24c' });
    this.fx.rings.push({ x: b.x, y: b.y, r0: 1, r1: b.big ? 7 : 5, t: 0, life: 0.1, col: '#ffffff', th: 1 });
    if (R() < 0.45) this.fx.sparks.push({ x: b.x, y: b.y, vx: -30 - R() * 60, vy: -40 - R() * 60, g: 260, t: 0, life: 0.6, c: R() < 0.5 ? '#3a2c24' : '#6a5040', big: true }); // 打下来的铁皮木屑
    G.Sfx.play('ping', { pitch: 0.9 + R() * 0.25 });
    if (e.hp <= 0) this.kill(e);
  };

  /* ---------------- 击毁：顿帧、震屏、闪白、火球、冲击波、碎片、气囊破了布片飘下去、甲板上的货箱飞出来 ---------------- */
  P.kill = function (e) {
    if (!e.alive) return; e.alive = false; this.stats.kills++;
    this.gauge = Math.min(100, this.gauge + e.T.gauge); this.gaugeCheck();
    this.en = this.en.filter(x => x !== e); this.impact.push(e); // 顿帧这几帧画成白影，顿完再炸
    this.streak.n = this.streak.t > 0 ? this.streak.n + 1 : 1; this.streak.t = 2.4;
    if (this.streak.n >= 2) G.UI.float(this.sx(e.x), e.y + e.h / 2 + 12, `连续击落 ×${this.streak.n}`, '#ffb43a', { size: 8 + Math.min(4, this.streak.n), life: 1.2, vy: -8 });
    const sq = e.sq;
    if (e.type === 'flag') {
      this.hitstop = 0.16; this.addShake(5, 0.5); this.whiteT = 0.06; G.Sfx.play('boom2');
      G.UI.float(this.sx(e.x), e.y - e.h / 2 - 10, this.P.kind === 'chase' ? '追兵被击沉！' : '旗舰被击沉！', '#ffd24c', { size: 11, life: 1.8, vy: -10 });
      return;
    }
    const big = e.T.boom;
    this.hitstop = big >= 2 ? 0.08 : 0.05; this.addShake(big >= 2 ? 4 : 3, big >= 2 ? 0.3 : 0.2);
    G.Sfx.play('boom'); G.Sfx.play('pop');
    if (sq && sq.leader === e && sq.members.some(m => m.alive)) { sq.leaderDead = true; G.UI.float(this.sx(e.x), e.y - e.h / 2 - 6, '长机击落！僚机乱了阵脚', '#ffe08a', { size: 8, life: 1.6, vy: -12 }); }
  };
  P.explode = function (e) {
    if (e.type === 'flag') {
      // 旗舰：先连环爆炸、慢动作，再断成几截掉进云海
      this.dyingShips.push({ type: 'flag', x: e.x, y: e.y, w: e.w, h: e.h, face: e.face, t: 0, dur: 1.1, boomT: 0, cargo: e.cargo, ph: e.ph });
      this.slowT = 0.9; this.boom(e.x, e.y, 2.5); return;
    }
    this.boom(e.x, e.y + e.h * 0.1, e.T.boom); this.breakApart(e); this.dropCargo(e);
  };
  P.finalBreak = function (d) {
    const e = { ...d, E: null, type: 'flag', alive: false };
    this.boom(d.x, d.y, 3); this.addShake(6, 0.45); this.whiteT = 0.14; this.hitstop = 0.1; G.Sfx.play('boom2'); G.Sfx.play('pop');
    this.breakApart(e); this.dropCargo(e);
  };
  P.boom = function (x, y, s) {
    const F = this.fx;
    F.rings.push({ x, y, r0: 3, r1: 16 + s * 14, t: 0, life: 0.2 + s * 0.06, col: '#fff6d8', th: s >= 2 ? 2 : 1 });
    F.fire.push({ x, y, vx: 0, vy: 0, r0: 6 + s * 5, r1: 2, t: 0, life: 0.07, st: 0 }); // 爆心先一下发白
    for (let i = 0; i < 2 + s * 2; i++) F.fire.push({ x: x + (R() - 0.5) * 10 * s, y: y + (R() - 0.5) * 7 * s, vx: (R() - 0.5) * 30, vy: -10 - R() * 20, r0: 2, r1: 4 + s * 2.6 + R() * 3, t: -i * 0.035, life: 0.36 + R() * 0.16, st: 0 });
    for (let i = 0; i < 8 + s * 8; i++) { const a = R() * 6.283, v = 60 + R() * 110 * s; F.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, g: 170, t: 0, life: 0.3 + R() * 0.4, c: ['#fff6c8', '#ffd24c', '#ff9a2e'][i % 3] }); }
    for (let i = 0; i < 2 + s * 2; i++) F.smoke.push({ x: x + (R() - 0.5) * 12 * s, y: y + (R() - 0.5) * 8 * s, vx: -this.scroll * 0.45 + (R() - 0.5) * 24, vy: -10 - R() * 12, r0: 3, r1: 6 + s * 3, t: 0.05, life: 1 + R() * 0.6, cols: DSMOKE });
  };
  /* 碎片：拼出来的船拆成气囊（破掉）、两截船身、引擎、炮；旗舰（一整张图）切成上面的气囊和下面三截 */
  P.breakApart = function (e) {
    const F = this.fx, flip = e.face < 0, ox = e.x - e.w / 2, oy = e.y - e.h / 2, sc = this.scroll;
    const piece = (img, sx, sy, sw, sh, px, py, vx, vy) => F.debris.push({ img, sx, sy, sw, sh, x: px, y: py, vx: vx - sc * 0.4, vy, flip, t: 0, life: 2.2, smokeT: 0, a: 0, va: (R() - 0.5) * (sw > 30 ? 2.2 : 6) });
    const wx = (lx, w) => flip ? ox + e.w - lx - w : ox + lx; // 精灵坐标 → 战斗坐标（左上角）
    if (e.type === 'flag') {
      const im = this.SP.flag, bh = Math.round(im.h * 0.5);
      F.debris.push({ pop: true, img: im.img, sx: 0, sy: 0, sw: im.w, sh: bh, x: ox, y: oy, flip, t: 0, life: 0.22, vx: -sc * 0.2, vy: 0 });
      this.tatters(e.x, oy + bh * 0.5, im.w * 0.8, 16);
      const n = 3, cw = Math.ceil(im.w / n);
      for (let i = 0; i < n; i++) { const lx = i * cw; piece(im.img, lx, bh, Math.min(cw, im.w - lx), im.h - bh, wx(lx, Math.min(cw, im.w - lx)), oy + bh, (i - 1) * 40 * (flip ? -1 : 1) + (R() - 0.5) * 20, -40 - R() * 30); }
      return;
    }
    const E = e.E, B = E.balloons[1], Pp = E.parts;
    F.debris.push({ pop: true, img: B.img, sx: 0, sy: 0, sw: B.w, sh: B.h, x: wx(B.x, B.w), y: oy + B.y, flip, t: 0, life: 0.2, vx: -sc * 0.2, vy: -10 });
    this.tatters(e.x, oy + B.y + B.h / 2, B.w * 0.8, 8);
    const hh = Pp.hull, half = Math.round(hh.w / 2);
    piece(hh.img, 0, 0, half, hh.h, wx(hh.x, half), oy + hh.y, -50 - R() * 30, -50 - R() * 30);
    piece(hh.img, half, 0, hh.w - half, hh.h, wx(hh.x + half, hh.w - half), oy + hh.y, 40 + R() * 30, -40 - R() * 30);
    if (Pp.engine) piece(Pp.engine.img, 0, 0, Pp.engine.w, Pp.engine.h, wx(Pp.engine.x, Pp.engine.w), oy + Pp.engine.y, (flip ? 60 : -60), -70);
    if (Pp.cannon) piece(Pp.cannon.img, 0, 0, Pp.cannon.w, Pp.cannon.h, wx(Pp.cannon.x, Pp.cannon.w), oy + Pp.cannon.y, (flip ? -70 : 70), -90);
    for (let i = 0; i < 8; i++) F.sparks.push({ x: e.x + (R() - 0.5) * e.w * 0.5, y: e.y, vx: (R() - 0.5) * 160, vy: -60 - R() * 80, g: 220, t: 0, life: 0.8, c: ['#6a4a2a', '#3a2c1c', '#c8963e'][i % 3], big: true });
  };
  P.tatters = function (x, y, w, n) { for (let i = 0; i < n; i++) this.fx.cloth.push({ x: x + (R() - 0.5) * w, y: y + (R() - 0.5) * 10, vx: (R() - 0.5) * 70 - this.scroll * 0.3, vy: -30 - R() * 50, t: 0, life: 1.6 + R(), ph: R() * 6, w: 2 + (R() * 2 | 0), h: 1 + (R() * 2 | 0), c: R() < 0.7 ? ['#c0302a', '#8a1e1c', '#e0574a'][i % 3] : '#3a2c2c' }); };
  /* 它甲板上的货箱飞出来，往你这边漂 1 秒，10 秒内碰到就接住；模块自动拾取 */
  P.dropCargo = function (e) {
    const hb = this.hitbox();
    for (const it of e.cargo) {
      if (it.k === 'mod') { this.loot.push(it); G.UI.float(this.sx(e.x), e.y - 20, `${D.Q[it.q].name}色${D.MODULES[it.type].name}（自动拾取）`, D.Q[it.q].color, { life: 1.8, size: 7.5 }); this.trays.push({ it, t: 0, life: 0.7, x0: this.sx(e.x), y0: e.y }); continue; }
      const a = Math.atan2(hb.y - e.y, hb.x - e.x) + (R() - 0.5) * 0.9, v = 80 + R() * 40;
      this.crates.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, item: it, rot: 0, rotT: 0, auto: this.first, own: false });
      this.stats.flown++;
      if (this.first) G.UI.float(this.sx(e.x), e.y + 18, '第一场：箱子自己飞上船', '#b8f0a0', { life: 1.8 });
      else if (!this.st.flags.catchHint) { this.st.flags.catchHint = true; G.UI.toast('箱子飞出来了：飞过去接住（10 秒内，没接住就掉进云海）', '#ffd27a', 4); }
    }
  };

  /* ---------------- 被打中：顿帧、震屏、红边、闪白，甲板上最上面那箱飞出去 ---------------- */
  P.hurt = function (mult) {
    const pl = this.pl, ship = this.ship, dmg = D.HIT_DMG[this.region] * mult, hb = this.hitbox();
    ship.hp = Math.max(0, ship.hp - dmg); pl.inv = 1.0; pl.flash = 0.06; pl.shake = 0.3; this.hits++;
    this.hitstop = 0.07; this.addShake(4, 0.3); this.redT = 0.5; this.hpShake = 0.4;
    G.Sfx.play('hit');
    for (let i = 0; i < 14; i++) { const a = R() * 6.283, v = 50 + R() * 130; this.fx.sparks.push({ x: hb.x, y: hb.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, g: 160, t: 0, life: 0.3 + R() * 0.2, c: ['#ffffff', '#ffd24c', '#ff9a2e'][i % 3] }); }
    this.fx.rings.push({ x: hb.x, y: hb.y, r0: 2, r1: 18, t: 0, life: 0.18, col: '#ff8a7a', th: 2 });
    for (let i = 0; i < 3; i++) this.fx.smoke.push({ x: hb.x + (R() - 0.5) * 10, y: hb.y, vx: -this.scroll * 0.5, vy: -14, r0: 2, r1: 6, t: 0, life: 0.8, cols: DSMOKE });
    G.UI.float(this.sx(hb.x), hb.y - 24, `-${dmg}`, '#ff8a7a', { size: 9, life: 1, vy: -18 });
    if (ship.deck.length) {
      const L = this.lastDraw, Sp = this.Sp, n = ship.deck.length;
      const pos = L ? A.deckCratePos(Sp, L.ox, L.oy + L.by + L.pileDy, n, n - 1, this.SP.crates) : { x: hb.x, y: hb.y - 20 };
      const it = ship.deck.pop();
      this.crates.push({ x: pos.x, y: pos.y, vx: -50 - R() * 60, vy: -90 - R() * 40, t: 0, item: it, rot: 0, rotT: 0, own: true });
      this.stats.flown++; G.Sfx.play('snap');
      for (let i = 0; i < 5; i++) this.fx.sparks.push({ x: pos.x, y: pos.y, vx: (R() - 0.5) * 120, vy: -40 - R() * 60, g: 200, t: 0, life: 0.5, c: ['#c9ad7a', '#9a7d50'][i % 2] }); // 绳子崩断
      G.UI.float(this.sx(pos.x), pos.y - 14, `甲板上的${D.itemName(it.k)}飞出去了！`, '#ffd27a', { life: 1.6, size: 7.5 });
    }
    if (ship.hp <= 0) this.die();
  };

  /* ---------------- 货箱：接住 ---------------- */
  P.updateCrates = function (dt) {
    const pl = this.pl, box = this.shipBox();
    for (const c of this.crates) {
      if (c.done) continue;
      if (c.fly) { c.fly.t += dt / 0.2; const u = Math.min(1, c.fly.t), tg = this.catchPoint(); c.x = lerp(c.fly.x, tg.x, ease(u)); c.y = lerp(c.fly.y, tg.y, ease(u)) - Math.sin(u * Math.PI) * 14; if (u >= 1) this.landCrate(c); continue; }
      c.t += dt; c.rotT += dt; if (c.rotT > (c.t < 1.2 ? 0.09 : 0.25)) { c.rotT = 0; c.rot = (c.rot + 1) % 4; }
      if (c.auto && c.t > 0.6) { const tg = this.catchPoint(); c.x += (tg.x - c.x) * Math.min(1, dt * 5); c.y += (tg.y - c.y) * Math.min(1, dt * 5); if (Math.hypot(tg.x - c.x, tg.y - c.y) < 10) this.catchCrate(c); continue; }
      if (c.t < 1) { c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 1 - dt * 1.6; c.vy = c.vy * (1 - dt * 1.6) + (c.own ? 60 : 20) * dt; }
      else { c.x -= 9 * dt; c.y += (Math.sin(c.t * 2) * 7 + 3) * dt; }
      // 靠近就吸过来一点
      const cx = clamp(c.x, box.x0, box.x1), cy = clamp(c.y, box.y0, box.y1), d = Math.hypot(c.x - cx, c.y - cy);
      if (!pl.dead && d < 26 && d > 0) { c.x += (cx - c.x) / d * 70 * dt; c.y += (cy - c.y) / d * 70 * dt; }
      c.y = clamp(c.y, LB + 6, H + 30);
      if (!pl.dead && this.phase !== 'dying' && d < 3) this.catchCrate(c);
      else if (c.t > 10 || c.x < -16 || c.y > H + 16) { c.done = true; this.stats.lost++; G.Sfx.play('poof'); G.Sfx.play('lost'); for (let i = 0; i < 4; i++) this.fx.smoke.push({ x: c.x + (R() - 0.5) * 8, y: Math.min(c.y, H - 14), vx: -this.scroll * 0.4, vy: -6, r0: 3, r1: 7, t: 0, life: 0.7, cols: STEAM }); G.UI.float(this.sx(clamp(c.x, 20, W - 20)), Math.min(c.y, H - 30), '掉进云海', '#c8c0d8'); }
    }
    this.crates = this.crates.filter(c => !c.done);
  };
  P.catchPoint = function () { const Sp = this.Sp, pl = this.pl, c = Sp.parts.cargo; return c ? { x: pl.x - Sp.w / 2 + c.x + c.w / 2, y: pl.y - Sp.h / 2 + c.y + 4 } : { x: pl.x, y: pl.y }; };
  P.catchCrate = function (c) { c.fly = { x: c.x, y: c.y, t: 0 }; };
  P.landCrate = function (c) {
    c.done = true; this.loot.push(c.item); this.stats.caught++; this.pl.bounce = 0.12;
    this.combo.n = this.combo.t > 0 ? this.combo.n + 1 : 1; this.combo.t = 1.6;
    G.Sfx.play('catch', { pitch: Math.pow(1.12, Math.min(6, this.combo.n - 1)) });
    const col = c.item.k === 'mat' ? D.MAT.color : (D.GOODS[c.item.k] || {}).color || '#ffffff';
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; this.fx.sparks.push({ x: c.x, y: c.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 20, g: 60, t: 0, life: 0.4, c: i % 2 ? col : '#ffffff' }); }
    this.fx.rings.push({ x: c.x, y: c.y, r0: 3, r1: 16, t: 0, life: 0.2, col, th: 2 });
    G.UI.float(this.sx(c.x), c.y - 16, `接住 ${D.itemName(c.item.k)}${this.combo.n > 1 ? ' ×' + this.combo.n : ''}`, '#b8f0a0', { size: 8, life: 1.2, vy: -20 });
    this.trays.push({ it: c.item, t: 0, life: 0.7, x0: this.sx(c.x), y0: c.y });
  };

  /* ---------------- 特效每帧 ---------------- */
  P.stepFx = function (dt) {
    const F = this.fx, sc = this.scroll;
    const mv = (arr, f) => { for (const p of arr) { p.t += dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; if (f) f(p); } for (let i = arr.length - 1; i >= 0; i--) if (arr[i].t >= arr[i].life) arr.splice(i, 1); };
    mv(F.sparks, p => { p.vy += (p.g || 0) * dt; });
    mv(F.fire); mv(F.smoke, p => { p.vx *= 1 - dt * 0.5; }); mv(F.steam); mv(F.rings); mv(F.muz);
    mv(F.debris, p => { if (p.pop) return; p.vy += 130 * dt; p.a += p.va * dt; p.smokeT -= dt; if (p.smokeT <= 0) { p.smokeT = 0.1; F.smoke.push({ x: p.x + p.sw / 2, y: p.y + p.sh / 2, vx: -sc * 0.3, vy: -10, r0: 3, r1: 9, t: 0, life: 1.1, cols: DSMOKE }); if (R() < 0.5) F.fire.push({ x: p.x + R() * p.sw, y: p.y + R() * p.sh, vx: 0, vy: -16, r0: 2, r1: 1, t: 0, life: 0.25, st: 1 }); } if (p.y > H + 10 && !p.splashed) { p.splashed = true; for (let i = 0; i < 3; i++) F.smoke.push({ x: p.x + p.sw / 2 + (R() - 0.5) * 16, y: H - 6, vx: -sc * 0.4, vy: -16, r0: 4, r1: 9, t: 0, life: 0.8, cols: STEAM }); } });
    mv(F.cloth, p => { p.vy = Math.min(26, p.vy + 60 * dt); p.vx += Math.sin(p.t * 5 + p.ph) * 40 * dt; });
    mv(F.shells, p => { p.vy += 260 * dt; p.s = (p.s + 1) % 4; });
    mv(F.coins, p => { const hb = this.hitbox(); if (p.t > 0.25) { const k = Math.min(1, dt * 6); p.x += (hb.x - p.x) * k; p.y += (hb.y - 10 - p.y) * k; if (Math.hypot(hb.x - p.x, hb.y - 10 - p.y) < 6) p.t = p.life; } });
    // 速度线（往后飞）和前景的云丝：船一直往前飞
    if (this.phase !== 'down') {
      if (R() < 60 * dt * (this.skill > 0 ? 0.9 : 0.35)) F.lines.push({ x: W + 10, y: LB + R() * (H - LB * 2), len: 10 + R() * 24, vx: -(380 + R() * 220) * (this.skill > 0 ? 1.4 : 1), t: 0, life: 3 });
      this.wispT -= dt; if (this.wispT <= 0) { this.wispT = 1.6 + R() * 2.2; const top = R() < 0.5; F.wisps.push({ x: W + 90, y: top ? LB + 10 + R() * 30 : H - LB - 10 - R() * 30, r: R() < 0.5 ? 26 : 34, k: (R() * 4) | 0, vx: -sc * 1.8, t: 0, life: 9 }); }
    }
    mv(F.lines, p => { if (p.x + p.len < -10) p.t = p.life; }); mv(F.wisps, p => { if (p.x < -120) p.t = p.life; });
  };

  /* ---------------- 打完：歼灭 → 接剩下的箱子 → 穿云、镜头拉回 → 战后面板 ---------------- */
  P.toClear = function () {
    this.phase = 'clear'; this.clearT = 0; G.Sfx.play('win'); G.Sfx.play('fanfare');
    for (const b of this.eb) this.fx.coins.push({ x: b.x, y: b.y, vx: (R() - 0.5) * 60, vy: -40, t: 0, life: 1 }); this.eb = []; // 剩下的敌弹变成铜屑飞回来
    if (this.st.battle) { this.st.battle.cleared = true; Game.save(); } // 已经打赢了：这时候关页面不算被击落
    this.ban = { t: 0, life: 2.2, title: '歼灭！', sub: this.crates.some(c => !c.done && !c.auto) ? '把还在飘的箱子接住' : `接住 ${this.stats.caught} 箱`, col: '#ffd24c', big: true };
  };
  P.startOut = function () { this.phase = 'out'; this.pt = 0; this.covered = false; this.pEnd = { x: this.sx(this.pl.x), y: this.pl.y - this.loadOff * this.Z }; this.bankDir = this.dir; G.Sfx.play('whooshDown'); };
  P.updateOut = function (dt) {
    this.pt += dt; this.stepFx(dt); this.shk.t = Math.max(0, this.shk.t - dt);
    this.cam.x += this.dir * this.scroll / this.Z * dt * clamp(1 - this.pt / OUT_COVER, 0, 1);
    if (!this.covered && this.pt >= OUT_COVER) { this.covered = true; this.commit(); }
    if (this.covered) this.map.particles(dt, S.stats(this.ship));
    if (this.pt >= OUT_T) { this.phase = 'panel'; this.sea.vx = this.dir * 26; G.Sfx.hum(true, 1); }
  };
  /* 结算（穿云遮满的那一刻）：磨损 5%、战利品进舱（舱满自动上甲板）、放不下的进战后面板；把打掉的那艘从大地图上拿掉 */
  P.commit = function () {
    const st = this.st, ship = this.ship, ss = S.stats(ship);
    for (const c of this.crates) if (!c.done) this.stats.lost++; this.crates = [];
    ship.hp = Math.max(1, ship.hp - Math.round(ss.hpMax * 0.05));
    const over = []; for (const it of this.loot) if (!S.addCargo(ship, it)) over.push(it);
    this.panel = { over, won: true };
    let guard = 0; while (over.length && guard++ < 40) { const oi = over.reduce((b, it, k) => D.baseValue(it) > D.baseValue(over[b]) ? k : b, 0); if (!this.keepOver(oi, true)) break; }
    st.flags.firstBattle = false; st.log.crates += this.stats.caught;
    if (['buy', 'fight'].includes(st.flags.tut)) st.flags.tut = 'home';
    st.battle = null;
    this.map.afterBattle({ won: true, patrolId: this.P.patrolId, chase: this.P.kind === 'chase' });
    this.sea.vx = 0; this.sea.vy = 0;
    Game.save();
  };
  P.keepOver = function (oi, auto) {
    const ship = this.ship, p = this.panel, it = p.over[oi]; let where = null, j = -1, v = 1e9;
    for (const w of ['hold', 'deck']) ship[w].forEach((x, k) => { const bv = D.baseValue(x); if (bv < v) { v = bv; where = w; j = k; } });
    if (!where || (auto && v >= D.baseValue(it))) return false;
    p.over[oi] = ship[where][j]; ship[where][j] = it; return true;
  };
  P.move = function (from, i) {
    const ship = this.ship, ss = S.stats(ship), to = from === 'hold' ? 'deck' : 'hold', cap = to === 'deck' ? ss.deckCap : ss.holdCap;
    const A2 = ship[from], B2 = ship[to];
    if (B2.length < cap) B2.push(A2.splice(i, 1)[0]);
    else if (B2.length) { const j = B2.reduce((b, it, k) => (D.baseValue(it) < D.baseValue(B2[b]) ? k : b), 0); const t = A2[i]; A2[i] = B2[j]; B2[j] = t; }
    else return;
    G.Sfx.play('click');
  };
  P.leave = function () {
    const p = this.panel; if (p && p.over.length) G.UI.toast(`扔掉了 ${p.over.length} 件放不下的`, '#d8d0c4');
    this.st.flags.deckHint = true; this.map.battle = null; this.sea.vx = this.dir * 26; Game.save();
  };

  /* ---------------- 被击落：慢动作炸开，留下哪一件 ---------------- */
  P.die = function () {
    const pl = this.pl; if (pl.dead) return; pl.dead = true; this.phase = 'dying'; this.pt = 0; this.slowT = 1.4; this.hitstop = 0.15; this.addShake(6, 0.8); this.whiteT = 0.15;
    G.Sfx.play('boom2'); this.boom(this.hitbox().x, this.hitbox().y, 2.5); this.eb = [];
    const ship = this.ship; for (const it of ship.deck) { const L = this.lastDraw; this.crates.push({ x: (L ? L.ox : pl.x) + this.Sp.w * (0.3 + R() * 0.4), y: pl.y - 10, vx: (R() - 0.5) * 160, vy: -80 - R() * 60, t: 0, item: it, rot: 0, rotT: 0, own: true }); } ship.deck = [];
  };
  P.updateDying = function (dt) {
    const pl = this.pl; pl.y += 22 * dt * (1 + this.pt); this.dieBoomT = (this.dieBoomT || 0) - dt;
    if (this.dieBoomT <= 0 && this.pt < 1.2) { this.dieBoomT = 0.14; const Sp = this.Sp; this.boom(pl.x + (R() - 0.5) * Sp.w * 0.7, pl.y + (R() - 0.3) * Sp.h * 0.5, 1.5); this.addShake(3, 0.15); G.Sfx.play('boom'); }
    if (this.pt > 1.5) {
      this.phase = 'down';
      const ship = this.ship, items = ship.hold.concat(ship.deck, this.loot, this.crates.filter(c => c.own && !c.done).map(c => c.item));
      this.crates = [];
      const best = items.reduce((b, it, i) => (b < 0 || D.baseValue(it) > D.baseValue(items[b])) ? i : b, -1);
      this.down = { items, pick: best, t: 10 };
    }
  };
  /* 留下 1 件，其余按基础价从高到低排，第 1、3、5……件沉在原地（沉货点 + 守货的海盗），其余丢掉；船免费拖回家 */
  BT.sinkCargo = function (st, ship, items, pick, pos, region) {
    const keep = pick >= 0 ? items[pick] : null, rest = items.filter((_, i) => i !== pick).sort((a, b) => D.baseValue(b) - D.baseValue(a));
    const sunk = rest.filter((_, i) => i % 2 === 0);
    ship.hold = keep ? [keep] : []; ship.deck = [];
    if (sunk.length && items.length > 1) {
      st.world.patrols = st.world.patrols.filter(p => p.id !== 'sunk'); // 每个船长同时只有一个沉货点
      st.world.sunk = { x: pos.x, y: pos.y + 40, r: region, items: sunk, until: st.day + 1, guardBeaten: false, name: '你的沉船' };
      st.world.patrols.push({ id: 'sunk', x: pos.x + 60, y: pos.y + 10, ax: pos.x + 60, ay: pos.y + 10, r: region, cargo: [], alive: true, kind: 'guard', t: 0 });
    }
    return { keep, sunk };
  };
  P.sink = function () {
    const st = this.st, m = this.down;
    const r = BT.sinkCargo(st, this.ship, m.items, m.pick, { x: this.x0, y: this.y0 }, this.region);
    st.battle = null; st.phase = 'day'; this.phase = 'gone'; Game.save();
    G.UI.toast(r.sunk.length ? `一半的货沉在原地（${r.sunk.length} 件），明天结束前打赢守货的海盗能捞回来` : '货都没了', '#ffd8cc', 5);
    Game.go('island', { towed: true }, { fade: 0.8 });
  };

  /* ---------------- 读档时还在仗里：开打 10 秒内重开这一场（同一个种子），否则按被击落算（自动留最值钱的那件） ---------------- */
  BT.resume = function (map) {
    const st = Game.st, b = st.battle; if (!b) return false;
    const ship = S.ship(st);
    if (b.cleared) { st.battle = null; map.afterBattle({ won: true, patrolId: b.p.patrolId, chase: b.p.chase }); Game.save(); G.UI.toast('上次打赢了才退出：这一场接住的战利品没来得及装船', '#ffd27a', 3.5); return false; }
    if ((b.t || 0) < 10) {
      ship.hp = b.pre.hp; ship.hold = b.pre.hold; ship.deck = b.pre.deck;
      map.sea.x = b.x; map.sea.y = b.y; map.snapCam(); st.battle = null;
      G.UI.toast('上次开打不到 10 秒就退出了：重开这一场', '#ffd27a', 3.5);
      map.startBattle({ ...b.p, seed: b.seed }); return true;
    }
    const items = ship.hold.concat(ship.deck), best = items.reduce((k, it, i) => (k < 0 || D.baseValue(it) > D.baseValue(items[k])) ? i : k, -1);
    const r = BT.sinkCargo(st, ship, items, best, { x: b.x, y: b.y }, b.p.region);
    st.battle = null; st.phase = 'day'; Game.save();
    G.UI.toast(`上次在仗里退出了：按被击落算${r.keep ? '，留下了 ' + D.itemName(r.keep.k === 'mod' ? 'mod:' + r.keep.type : r.keep.k) : ''}`, '#ffd8cc', 5);
    map.towNext = true; return true; // 在 enter 里不能直接换场景：下一帧再拖回家
  };

  /* ================================================================ 画 ================================================================ */
  /* 推近 / 拉回时用大地图的画法（大地图的零件按镜头倍数放大，只在这不到一秒里），推近以后换成从源图直接缩出来的战斗零件 */
  P.zoomIn = function () { const e = ease(clamp(this.pt / IN_T, 0, 1)), z = 1 + (this.Z - 1) * e, p = { x: lerp(this.pMap.x, this.pB.x, e), y: lerp(this.pMap.y, this.pB.y, e) }; return { z, C: { x: this.sea.x - p.x / z, y: this.sea.y - p.y / z }, e }; };
  P.zoomOut = function () { const u = clamp((this.pt - OUT_COVER) / (OUT_T - OUT_COVER), 0, 1), e = ease(u), z = this.Z + (1 - this.Z) * e, C = { x: lerp(this.camB.x, this.cam0.x, e), y: lerp(this.camB.y, this.cam0.y, e) }, p = { x: lerp(this.pEnd.x, this.pMap.x, e), y: lerp(this.pEnd.y, this.pMap.y, e) }; return { z, C, ship: { x: C.x + p.x / z, y: C.y + p.y / z }, e }; };
  P.drawMapZoom = function (g, f, v) {
    const sea = this.sea, keep = { x: sea.x, y: sea.y }, u0 = G.Px.u;
    if (v.ship) { sea.x = v.ship.x; sea.y = v.ship.y; }
    g.save(); g.scale(v.z, v.z); G.Px.u = u0 * v.z; // 缩放以后一个世界像素 = k × z 个物理像素：位置照样对齐到物理像素（和 G.Cam.begin 一样）
    this.map.drawWorld(g, f, v.C.x, v.C.y);
    g.restore(); G.Px.u = u0;
    sea.x = keep.x; sea.y = keep.y;
  };
  P.draw = function (g, f) {
    const ph = this.phase;
    if (ph === 'panel' || ph === 'gone') return false;
    if (ph === 'in') { const v = this.zoomIn(); this.drawMapZoom(g, f, v); this.drawBars(g, v.e); return true; }
    if (ph === 'out' && this.covered) { const v = this.zoomOut(); this.drawMapZoom(g, f, v); this.drawBank(g); this.drawBars(g, 1 - v.e); return true; }
    this.drawBattle(g, f);
    if (this.xf > 0) { // 推近以后：大地图的图淡出，战斗的图淡入。淡出的那张按画布的真实分辨率画（一个基准像素 = k 个物理像素），贴回来时 1:1。
      // 这 0.22 秒里大地图是停住的、镜头也停在 camB：只在第一帧画一次，之后每帧只贴一次（4K 画布上每帧重画会多出十几毫秒）
      const k = G.Px.k, w = Math.round(W * k), h = Math.round(H * k);
      if (this.offK !== k || !OFF || OFF.width !== w || OFF.height !== h) {
        if (!OFF || OFF.width !== w || OFF.height !== h) OFF = mk(w, h);
        const o = OFF.getContext('2d'); o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h); o.imageSmoothingEnabled = false; o.setTransform(k, 0, 0, k, 0, 0);
        this.drawMapZoom(o, f, { z: this.Z, C: this.camB }); this.offK = k;
      }
      g.globalAlpha = clamp(this.xf / XF_T, 0, 1); g.drawImage(OFF, 0, 0, W, H); g.globalAlpha = 1;
    }
    if (ph === 'out') this.drawBank(g);
    this.drawBars(g, 1);
    return true;
  };
  P.drawBars = function (g, a) { const h = Math.round(LB * clamp(a, 0, 1)); if (h <= 0) return; g.fillStyle = '#0b0a0d'; g.fillRect(0, 0, W, h); g.fillRect(0, H - h, W, h); };

  /* 世界（云海、浮岛、城镇、残骸）：按推近以后的大小，从源图直接缩出来的那一套，跟着镜头往后退。不镜像。
     镜头（世界坐标 × Z）只对齐到物理像素，不取整到 640×360 的格子：云海一帧一帧匀速地往后退（以前一会儿不动、一会儿跳一整格）。
     浮岛、城镇、残骸钉在世界上：先在推近以后的像素格里取整，再减掉镜头，和云海一起挪，不会和云海错开半格 */
  P.drawBg = function (g, f, sh) {
    const SP = this.SP, T = tiles(), Z = this.Z, tw = T.w, th = T.h, st = this.st, t = this.sea.t;
    const ox = ps(this.cam.x * Z) - sh.x, oy = ps(this.cam.y * Z) - sh.y;
    this.bgO = { x: ox, y: oy }; // tools/smooth.mjs 量顺不顺用
    const b0 = (M.borderX - M.band / 2) * Z, b1 = (M.borderX + M.band / 2) * Z;
    for (let tx = Math.floor(ox / tw); tx * tw < ox + W; tx++) for (let ty = Math.floor(oy / th); ty * th < oy + H; ty++) {
      const x = tx * tw - ox, y = ty * th - oy, m = ((tx % 2) + 2) % 2 === 1, x0 = tx * tw, x1 = x0 + tw, inn = m ? T.innerM : T.inner, bor = m ? T.borderM : T.border;
      if (x1 <= b0) g.drawImage(inn, x, y); else if (x0 >= b1) g.drawImage(bor, x, y);
      else { g.drawImage(inn, x, y); for (let s = 0; s < tw; s += 10) { const a = clamp((x0 + s - b0) / (b1 - b0), 0, 1); if (a <= 0) continue; g.globalAlpha = a; g.drawImage(bor, s, 0, 10, th, x + s, y, 10, th); } g.globalAlpha = 1; }
    }
    const X = (v, d = 0) => Math.round(v * Z - d) - ox, Y = (v, d = 0) => Math.round(v * Z - d) - oy, vis = (x, w) => x + w > -4 && x < W + 4; // 世界坐标 → 画面（钉在世界的像素格上）
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (const c of [{ x: M.home.x, y: M.home.y, r: M.safeR + 60 }, ...M.towns.map(q => ({ x: q.x, y: q.y, r: M.safeR }))]) { const n = Math.round(c.r / 7); for (let i = 0; i < n; i += 2) { const a = i / n * Math.PI * 2 + t * 0.02, x = X(c.x + Math.cos(a) * c.r), y = Y(c.y + Math.sin(a) * c.r * 0.62); if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue; g.fillRect(x, y, 3, 1); } }
    for (const [x, y, i] of M.islets) { const im = SP.islets[i], sx = X(x, im.w / 2); if (!vis(sx, im.w)) continue; g.drawImage(im.img, sx, Y(y, im.h / 2) + Math.round(Math.sin(t * 0.5 + x) * 1.5 * Z)); }
    { const im = SP.home, sx = X(M.home.x, im.w / 2); if (vis(sx, im.w)) g.drawImage(im.img, sx, Y(M.home.y, im.h / 2)); }
    for (const q of M.towns) { const im = SP.towns[q.spr], sx = X(q.x, im.w / 2); if (vis(sx, im.w)) g.drawImage(im.img, sx, Y(q.y, im.h / 2)); }
    const wreck = (w, sunk) => { const im = SP.wreck, x = X(w.x, im.w / 2), y = Y(w.y, im.h / 2) + Math.round(Math.sin(f / 12 + w.x)); if (!vis(x, im.w)) return; if (sunk) g.globalAlpha = 0.75; g.drawImage(im.img, x, y); g.globalAlpha = 1; w.items.slice(0, 4).forEach((it, i) => { const ci = SP.crates[it.k] || SP.crates.mat; g.drawImage(ci.img, x + 15 + i * 11, y + im.h - 8 + (i % 2) * 4 + Math.round(Math.sin(f / 12 * 1.5 + i))); }); };
    for (const w of st.world.wrecks) if (w.items.length) wreck(w, false);
    if (st.world.sunk && st.world.sunk.items.length) wreck(st.world.sunk, true);
  };

  P.drawBattle = function (g, f) {
    const sh = this.shakeOff(), F = this.fx;
    this.drawBg(g, f, sh);
    { const k = G.Px.k, pl = this.pl, Sp = this.Sp, sx = ps(pl.x - Sp.w / 2); Game.debug.track = { scene: 'map', bg: [-this.bgO.x * k, -this.bgO.y * k], obj: [(this.dir > 0 ? sx : W - sx - Sp.w) * k, ps(pl.y - Sp.h / 2) * k] }; } // tools/smooth.mjs 量顺不顺用
    g.save(); if (this.dir < 0) { g.translate(W, 0); g.scale(-1, 1); } g.translate(sh.x, sh.y);
    // 后层：航迹、蒸汽、烟
    for (const p of F.steam) { const u = p.t / p.life; drawBall(g, p.x, p.y, lerp(p.r0, p.r1, u), p.cols.slice(Math.min(p.cols.length - 1, (u * 2) | 0)), p.fade ? (1 - u) * 0.85 : p.wake ? 1 - u * 0.6 : 1 - u * 0.4); }
    for (const p of F.smoke) { if (p.t < 0) continue; const u = p.t / p.life; drawBall(g, p.x, p.y, lerp(p.r0, p.r1, ease(Math.min(1, u * 1.4))), p.cols, u < 0.4 ? 0.85 : (1 - u) * 1.4); }
    // 碎片（落进云海）
    for (const p of F.debris) {
      if (p.pop) { const u = p.t / p.life, sx = 1 + u * 0.5, sy = Math.max(0.1, 1 - u * 0.9), w = p.sw * sx, h = p.sh * sy; g.save(); g.translate(ps(p.x + p.sw / 2), ps(p.y + p.sh / 2)); if (p.flip) g.scale(-1, 1); g.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, Math.round(-w / 2), Math.round(-h / 2), Math.round(w), Math.round(h)); g.restore(); continue; }
      const a = p.y > H - 30 ? clamp((H + 20 - p.y) / 50, 0, 1) : 1; if (a <= 0) continue; g.globalAlpha = a;
      g.save(); g.translate(ps(p.x + p.sw / 2), ps(p.y + p.sh / 2)); g.rotate(Math.round(p.a * 8) / 8); if (p.flip) g.scale(-1, 1); g.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, -Math.round(p.sw / 2), -Math.round(p.sh / 2), p.sw, p.sh); g.restore(); g.globalAlpha = 1;
    }
    // 敌船（按 y 排）+ 正在炸的旗舰
    const list = this.en.slice().sort((a, b) => a.y - b.y);
    for (const d of this.dyingShips) this.drawFlag(g, f, d, true);
    for (const e of list) this.drawEnemy(g, f, e);
    for (const e of this.impact) this.drawEnemy(g, f, e, true); // 击毁的那一下：一整个白影
    // 飘着的货箱
    for (const c of this.crates) this.drawCrate(g, f, c);
    // 玩家
    this.drawPlayer(g, f);
    // 我们的子弹（黄铜曳光弹）
    for (const b of this.bul) { const x = ps(b.x), y = ps(b.y); if (b.big) { g.fillStyle = '#7a4a10'; g.fillRect(x - 7, y - 2, 11, 4); g.fillStyle = '#ffd24c'; g.fillRect(x - 6, y - 1, 9, 2); g.fillStyle = '#fff6c8'; g.fillRect(x, y - 1, 3, 2); } else { g.fillStyle = '#7a4a10'; g.fillRect(x - 6, y - 1, 9, 3); g.fillStyle = '#ffd24c'; g.fillRect(x - 5, y, 7, 1); g.fillStyle = '#fff6c8'; g.fillRect(x + 1, y, 2, 1); } }
    // 炮口火光
    for (const p of F.muz) this.drawMuzzle(g, p);
    // 火球、冲击波、火花、布片、弹壳、铜屑
    for (const p of F.fire) { if (p.t < 0) continue; const u = p.t / p.life, st = Math.min(4, (p.st || 0) + Math.floor(u * 4.5)); drawBall(g, p.x, p.y, p.r1 < p.r0 ? lerp(p.r0, p.r1, u) : lerp(p.r0, p.r1, Math.min(1, u * 2.2)), FIRE[st]); }
    for (const p of F.rings) { const u = p.t / p.life; ring(g, p.x, p.y, lerp(p.r0, p.r1, ease(u)), u < 0.5 ? p.col : '#ffffff', p.th || 1); }
    for (const p of F.sparks) { const s = p.big ? 2 : (p.t / p.life < 0.5 ? 2 : 1); g.fillStyle = p.c; g.fillRect(ps(p.x), ps(p.y), s, s); }
    for (const p of F.cloth) { g.fillStyle = p.c; const flip = Math.sin(p.t * 9 + p.ph) > 0; g.fillRect(ps(p.x), ps(p.y), flip ? p.w : p.h, flip ? p.h : p.w); }
    for (const p of F.shells) { g.fillStyle = '#ffd24c'; g.fillRect(ps(p.x), ps(p.y), p.s % 2 ? 2 : 1, p.s % 2 ? 1 : 2); }
    for (const p of F.coins) { g.fillStyle = (p.t * 12 | 0) % 2 ? '#fff6c8' : '#ffd24c'; g.fillRect(ps(p.x) - 1, ps(p.y) - 1, 2, 2); }
    // 敌弹最后画：弹幕永远是画面上最清楚的东西
    for (const b of this.eb) this.drawEB(g, f, b);
    // 判定点：船身中间那个亮点（钉在画出来的船身上）
    if (!this.pl.dead) { const pl = this.pl, Sp = this.Sp, x = ps(pl.x - Sp.w / 2) + Math.round(this.hbo.x + Sp.w / 2), y = ps(pl.y - Sp.h / 2) + Math.round(this.hbo.y + Sp.h / 2) + (pl.bounce > 0 ? 1 : 0); g.fillStyle = '#1b1209'; g.fillRect(x - 2, y - 2, 5, 5); g.fillStyle = (f % 4) < 2 ? '#ffffff' : '#ffe8a0'; g.fillRect(x - 1, y - 1, 3, 3); }
    // 前景：速度线、云丝（比云海飞得快，看得出在往前飞）
    g.fillStyle = 'rgba(255,255,255,0.4)'; for (const p of F.lines) g.fillRect(ps(p.x), ps(p.y), Math.round(p.len), 1);
    g.globalAlpha = 0.32; for (const p of F.wisps) for (let i = 0; i < 3; i++) { const r = [p.r, p.r === 34 ? 26 : 20, p.r === 34 ? 20 : 16][i]; g.drawImage(puff(r, (p.k + i) % 4), ps(p.x + i * p.r * 0.9 - r * 1.2), ps(p.y + (i % 2 ? 4 : -2) - r * 1.2)); } g.globalAlpha = 1; // 前景的薄云丝
    g.restore();
    // 屏幕上的：技能切入、被打中的红边、闪白
    if (this.cutin > 0) this.drawCutin(g);
    if (this.redT > 0) { const a = this.redT / 0.5; for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(200,30,20,${(0.32 - i * 0.05) * a})`; g.fillRect(0, LB + i * 3, W, 3); g.fillRect(0, H - LB - (i + 1) * 3, W, 3); g.fillRect(i * 3, 0, 3, H); g.fillRect(W - (i + 1) * 3, 0, 3, H); } }
    if (this.whiteT > 0) { g.fillStyle = `rgba(255,250,235,${Math.min(0.7, this.whiteT * 6)})`; g.fillRect(0, 0, W, H); }
  };
  P.drawMuzzle = function (g, p) {
    const u = p.t / p.life, x = ps(p.x), y = ps(p.y), d = p.red ? -1 : 1, s = p.big ? 2 : 1;
    const c1 = p.red ? '#ffb070' : '#fff6c8', c2 = p.red ? '#e0402a' : '#ffd24c';
    if (u < 0.5) { g.fillStyle = c2; g.fillRect(x + (d > 0 ? 0 : -6 * s), y - 2 * s, 6 * s, 4 * s); g.fillRect(x + (d > 0 ? 2 : -5) * s, y - 4 * s, 3 * s, 8 * s); g.fillStyle = c1; g.fillRect(x + (d > 0 ? 0 : -4 * s), y - 1, 4 * s, 2 + s); }
    else { g.fillStyle = c2; g.fillRect(x + (d > 0 ? 1 : -4), y - 1, 3, 2); }
  };
  P.drawEB = function (g, f, b) {
    const x = ps(b.x), y = ps(b.y), pulse = (f + (b.t * 12 | 0)) % 2;
    if (b.kind === 'b') { // 大弹：9×9
      g.fillStyle = '#4a0c10'; g.fillRect(x - 4, y - 3, 9, 7); g.fillRect(x - 3, y - 4, 7, 9);
      g.fillStyle = '#e0402a'; g.fillRect(x - 3, y - 3, 7, 7); g.fillStyle = pulse ? '#ffb070' : '#ff8a50'; g.fillRect(x - 2, y - 2, 5, 5); g.fillStyle = '#fff4e0'; g.fillRect(x - 1, y - 2, 2, 2);
    } else {
      g.fillStyle = '#5a0f12'; g.fillRect(x - 3, y - 2, 7, 5); g.fillRect(x - 2, y - 3, 5, 7);
      g.fillStyle = '#e0402a'; g.fillRect(x - 2, y - 2, 5, 5); g.fillStyle = pulse ? '#ffc890' : '#ffb070'; g.fillRect(x - 1, y - 1, 3, 3); g.fillStyle = '#fff4e0'; g.fillRect(x, y - 1, 1, 1);
    }
  };
  P.drawCrate = function (g, f, c) {
    const ci = this.SP.crates[c.item.k] || this.SP.crates.mat, left = 10 - c.t;
    if (!c.fly && left < 3 && (f % 2)) return; // 快掉了：闪
    const cx = ps(c.x), cy = ps(c.y); g.save(); g.translate(cx, cy); if (c.fly) { const s = 1 - Math.min(1, c.fly.t) * 0.4; g.scale(s, s); } g.rotate(c.rot * Math.PI / 2); g.drawImage(ci.img, -Math.round(ci.w / 2), -Math.round(ci.h / 2)); g.restore();
    if (c.fly || c.auto) return;
    // 10 秒倒计时：一圈小点，越少越红
    const n = 12, lit = Math.ceil(clamp(left / 10, 0, 1) * n), r = ci.w / 2 + 4;
    for (let i = 0; i < n; i++) { if (i >= lit) continue; const a = -Math.PI / 2 + i / n * 6.283; g.fillStyle = left < 3 ? '#ff7a6a' : c.own ? '#ffe08a' : '#ffffff'; g.fillRect(cx + Math.round(Math.cos(a) * r), cy + Math.round(Math.sin(a) * r), 1, 1); }
  };
  P.drawEnemy = function (g, f, e, white) {
    if (e.type === 'flag') { if (white) { const im = this.SP.flag; A.drawFlash(g, im.img, ps(e.x - im.w / 2), ps(e.y - im.h / 2), 1, e.face < 0); } else this.drawFlag(g, f, e, false); return; }
    const E = e.E, ox = ps(e.x - E.w / 2) + (e.kick > 0 ? -e.face : 0), oy = ps(e.y - E.h / 2);
    A.drawShip(g, E, ox, oy, f, { n: 1, hold: 0, deck: [], flip: e.face < 0, flash: white ? 1 : e.flash > 0 ? 0.7 : 0, ph: e.ph, gunDx: e.gk > 0 ? 1 : 0 });
    if (white) return;
    if (e.lead && !(e.sq && e.sq.boss)) { // 长机：气囊顶上插一面红三角旗
      const B = E.balloons[1], bx = e.face < 0 ? ox + E.w - (B.x + Math.round(B.w * 0.5)) : ox + B.x + Math.round(B.w * 0.5), by = oy + B.y + Math.round(Math.sin(f / 12 * 2.2 - 0.7 + e.ph));
      g.fillStyle = '#2a1e18'; g.fillRect(bx, by - 8, 1, 8); const wv = (f >> 1) % 2, d = -e.face;
      g.fillStyle = '#e0402a'; for (let i = 0; i < 7; i++) { const hh = Math.max(1, 4 - Math.floor(i / 2)); g.fillRect(bx + d * (i + 1) - (d < 0 ? 0 : 0), by - 8 + (wv && i > 3 ? 1 : 0), 1, hh); }
      g.fillStyle = '#ffb070'; g.fillRect(bx + d, by - 8, 1, 1);
    }
    this.drawEnemyBits(g, f, e, ox, oy);
  };
  P.drawFlag = function (g, f, e, dying) {
    const im = this.SP.flag, x = ps(e.x - im.w / 2) + (e.kick > 0 ? -e.face : 0), y = ps(e.y - im.h / 2) + Math.round(Math.sin(f / 12 * 2 + (e.ph || 0)));
    const flash = dying ? ((f % 2) ? 0.6 : 0) : e.flash > 0 ? 0.7 : 0;
    if (flash) A.drawFlash(g, im.img, x, y, flash, e.face < 0); else A.drawImg(g, im, x, y, e.face < 0);
    // 海盗的货看得见：甲板上堆着它的货箱（和大地图上一样）
    const goods = (e.cargo || []).filter(c => c.k !== 'mod'), cw = this.SP.crates.tea.w, flip = e.face < 0;
    goods.forEach((c, i) => { const row = i < 3 ? 0 : 1, col = row ? i - 3 : i, n = row ? goods.length - 3 : Math.min(3, goods.length); const rx = Math.round(im.w * 0.5 - n * (cw - 1) / 2 + col * (cw - 1)), by = y + Math.round(im.h * 0.62) - cw * (row + 1) + 2; const ci = this.SP.crates[c.k] || this.SP.crates.mat; g.drawImage(ci.img, x + (flip ? im.w - rx - cw : rx), by); }); // 按起点取整：货箱跟着船走，不和船错开半格
    const md = (e.cargo || []).find(c => c.k === 'mod'); if (md) { g.fillStyle = md.q === 2 ? '#ffd24c' : md.q === 1 ? '#8cc8ff' : '#f0ead8'; const gx = flip ? x + im.w - Math.round(im.w * 0.66) - 3 : x + Math.round(im.w * 0.66), gy = y + Math.round(im.h * 0.56) - 4; g.fillRect(gx, gy, 3, 3); if ((f >> 1) % 2) { g.fillRect(gx - 1, gy + 1, 5, 1); g.fillRect(gx + 1, gy - 1, 1, 5); } }
    if (!dying) this.drawEnemyBits(g, f, e, x, y);
  };
  /* 血条、乱了阵脚的「!」、旗舰蓄力时炮口发光 */
  P.drawEnemyBits = function (g, f, e, ox, oy) {
    if (e.hp < e.hpMax && e.type !== 'flag') { const w = Math.min(36, Math.round(e.w * 0.5)), x = ox + Math.round((e.w - w) / 2), y = oy - 4; g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x - 1, y - 1, w + 2, 4); g.fillStyle = e.lead ? '#ffb43a' : '#e0574a'; g.fillRect(x, y, Math.max(1, Math.round(w * e.hp / e.hpMax)), 2); }
    if (e.panic > 0 && (f % 2)) { const x = ox + Math.round(e.w / 2), y = oy - 12; g.fillStyle = '#1b1209'; g.fillRect(x - 2, y - 1, 5, 10); g.fillStyle = '#ffe08a'; g.fillRect(x - 1, y, 3, 5); g.fillRect(x - 1, y + 6, 3, 2); }
    if (e.charge > 0) { for (const mz of this.muzzlesOf(e)) { const r = 2 + Math.round((0.55 - e.charge) * 8) + (f % 2); drawBall(g, mz.x, mz.y, r, ['#fff4e0', '#ffb070', '#e0402a'], 0.9); } }
  };
  P.drawPlayer = function (g, f) {
    const pl = this.pl, Sp = this.Sp, ship = this.ship, ss = S.stats(ship);
    if (this.phase === 'down') return;
    const ox0 = ps(pl.x - Sp.w / 2), oy0 = ps(pl.y - Sp.h / 2), ox = ox0 + (pl.shake > 0 ? ((f % 2) ? 2 : -2) : 0), oy = oy0 + (pl.bounce > 0 ? 1 : 0);
    const opt = { n: ss.topN, gun: !!ss.gun, engine: ss.engines > 0, hold: ss.holdCap ? ship.hold.length / ss.holdCap : 0, deck: ship.deck.map(i => i.k), crates: this.SP.crates };
    for (const gh of pl.ghosts) A.drawShip(g, Sp, ps(gh.x - Sp.w / 2), ps(gh.y - Sp.h / 2), f, { ...opt, alpha: gh.t * 1.6, flash: 0.55 });
    if (pl.dead) { if ((f % 3) && this.pt < 1.3) A.drawShip(g, Sp, ox, oy, f, { ...opt, n: this.pt > 0.5 ? 0 : opt.n, flash: (f % 2) ? 0.7 : 0.2 }); return; }
    const blink = pl.inv > 0 && pl.flash <= 0 && this.phase === 'fight' && (f % 2);
    if (!blink) { const r = A.drawShip(g, Sp, ox, oy, f, { ...opt, flash: pl.flash > 0 ? 0.75 : 0, gunDx: pl.kick > 0 ? 2 : 0 }); this.lastDraw = { ox, oy, by: r.by, pileDy: r.pileDy }; }
    else this.lastDraw = this.lastDraw || { ox, oy, by: 0, pileDy: 0 };
    if (this.skill > 0 && ss.gun) { const mz = this.muzzleAt(ox0, oy0); drawBall(g, mz.x - 1, mz.y, 4 + (f % 2), ['#ffffff', '#fff1b8', '#ffd24c'], 0.85); } // 放技能时炮口一直烧得发白
  };
  /* 技能切入：一条斜着的黄铜带从船那边扫过来，上面是船长半身像（字在界面层） */
  P.drawCutin = function (g) {
    const T = 0.85, u = 1 - this.cutin / T, inn = clamp(u / 0.1, 0, 1), out = clamp((u - 0.78) / 0.22, 0, 1), y0 = 128, hh = 64, slope = 0.35;
    const off = (1 - ease(inn)) * -720 + ease(out) * 760, side = this.dir, X0 = ps(off * side); // 整条带一起挪（对齐到物理像素），斜边的台阶按整像素
    for (let j = 0; j < hh; j++) {
      const sl = (j - hh / 2) * slope, x0 = X0 + Math.round(sl - 40);
      const col = j < 2 || j >= hh - 2 ? '#2a1808' : j < 4 || j >= hh - 4 ? '#fff1b8' : j < 6 || j >= hh - 6 ? '#ffd24c' : j < 18 ? '#e0a040' : j < hh - 16 ? '#c8862e' : '#a86a22';
      g.fillStyle = col; g.fillRect(x0, y0 + j, W + 80, 1);
    }
    g.fillStyle = 'rgba(255,246,200,0.8)'; for (let i = 0; i < 9; i++) { const x = ps((u * 1400 + i * 157) % (W + 200)) - 100; g.fillRect(side > 0 ? x : W - x - 60, y0 + 8 + i * 6, 30 + (i * 13) % 40, 1); }
    // 船长半身像：跟着这条带从船那边一起冲进来，最后先走
    const B = this.SP.bust, bo = (1 - ease(inn)) * -260 + ease(out) * -300, bx = side > 0 ? ps(60 + bo) : ps(W - 60 - B.w - bo), by = y0 + hh - B.h;
    A.drawImg(g, B, bx, by, side < 0);
  };
  /* 穿云：一整团云从船头那边扫到船尾，把画面整个遮住几帧（这时换回大地图），然后镜头拉回 */
  P.drawBank = function (g) {
    const V = (W / 2 + BANK_HW + 400) / OUT_COVER, c0 = W / 2 + V * OUT_COVER, cx = c0 - V * this.pt, c = this.bankDir > 0 ? cx : W - cx;
    const x0 = ps(c - BANK_HW), x1 = x0 + BANK_HW * 2; // 整团云一起挪（对齐到物理像素），里面的云团按整像素摆
    g.fillStyle = '#eef2f8'; g.fillRect(x0, 0, x1 - x0, H);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { const r = 40 + ((i * 7 + j * 11) % 4) * 6, px = 60 + i * ((x1 - x0 - 120) / 4) + ((j % 2) ? 40 : -20), py = -10 + j * 92 + ((i % 2) ? 30 : 0); g.drawImage(puff(r, (i + j) % 4), x0 + Math.round(px - r * 1.2), Math.round(py - r * 1.2)); } // 云团里面也是一团团的
    g.fillStyle = 'rgba(196,208,228,0.45)'; g.fillRect(x0, H - 50, x1 - x0, 50);
    for (let i = 0; i < 9; i++) { const y = -20 + i * 48, k = i % 4, r = 46 + (i * 37 % 20); g.drawImage(puff(r, k), x0 + Math.round(-r * 1.2 + ((i * 29) % 30) - 10), Math.round(y - r * 1.2)); g.drawImage(puff(r, (k + 2) % 4), x1 + Math.round(-r * 1.2 - ((i * 23) % 30) + 10), Math.round(y - r * 1.2 + 20)); }
  };

  /* ================================================================ 界面 ================================================================ */
  P.hudA = function () { const ph = this.phase; if (ph === 'in') return ease(clamp(this.pt / IN_T, 0, 1)); if (ph === 'out') return this.pt < OUT_COVER ? 1 : clamp(1 - (this.pt - OUT_COVER) / 0.3, 0, 1); return 1; };
  P.ui = function (u) {
    const ph = this.phase, C = u.C, g = u.g;
    if (ph === 'panel') { this.panelUI(u); return; }
    if (ph === 'gone') return;
    if (ph === 'out' && this.covered) { const a = clamp((this.pt - OUT_COVER - 0.35) / 0.5, 0, 1); if (a > 0) { g.save(); g.globalAlpha = a; this.map.hud(u, S.stats(this.ship)); this.map.minimap(u); g.restore(); } }
    const a = this.hudA(); if (a <= 0.01) return;
    g.save(); g.globalAlpha = a;
    const ship = this.ship, ss = S.stats(ship), hp = ship.hp, pow = S.power(ship), tone = S.powerTone(pow, this.rec);
    // 左上：船体值、甲板货
    const sx = this.hpShake > 0 ? Math.round((R() - 0.5) * 4) : 0;
    u.panel(8 + sx, 14, 176, 46);
    u.text(this.kindName, 16 + sx, 26, { size: 7, bold: true, color: C.brassL });
    u.text('船体值', 16 + sx, 39, { size: 6.5, color: C.muted }); u.bar(46 + sx, 34, 96, 6, hp / ss.hpMax, hp / ss.hpMax > 0.4 ? '#8fd06a' : ((Game.f12 % 2) ? '#e0574a' : '#ff8a7a')); u.text(`${Math.ceil(hp)} / ${ss.hpMax}`, 178 + sx, 39.5, { size: 6.5, align: 'right' });
    u.text(`甲板货 ${ship.deck.length}`, 16 + sx, 53, { size: 6.5, color: ship.deck.length ? '#ffd27a' : C.fg, bold: true });
    ship.deck.slice(0, 8).forEach((it, i) => u.goodsDot(it.k, 64 + i * 7 + sx, 50.5, 2.3));
    u.text(`被打中 -${D.HIT_DMG[this.region]}，先飞一箱`, 178 + sx, 53, { size: 5.5, align: 'right', color: C.muted });
    // 右上：战力和推荐战力
    u.panel(456, 14, 176, 46);
    u.text('战力', 464, 30, { size: 6.5, color: C.muted }); u.text(String(pow), 486, 31, { size: 11, bold: true, color: tone.c });
    u.text(`推荐 ${this.rec}`, 512, 30, { size: 7, color: C.fg }); u.text(tone.word, 624, 30, { size: 7.5, bold: true, color: tone.c, align: 'right' });
    const nW = this.waves.length, wi = Math.min(this.wave, nW), busy = this.en.some(e => !e.retreat) || this.dyingShips.length > 0, cleared = this.phase === 'fight' ? Math.max(0, wi - (busy ? 1 : 0)) : nW;
    for (let i = 0; i < nW; i++) u.circle(468 + i * 10, 49, 3, i < cleared ? '#ffd24c' : i < wi ? '#e0574a' : 'rgba(255,255,255,0.2)', '#1b1209', 0.6); // 每一队一个点：打完金色、正在打红色
    u.text(this.phase === 'fight' ? `第 ${Math.max(1, wi)} / ${nW} 队 · 敌船 ${this.en.filter(e => !e.retreat).length}` : this.phase === 'clear' ? '歼灭' : '', 492, 51.5, { size: 6.5, color: C.fg });
    // 旗舰血条（最后一队）
    const bs = this.boss; if (bs && bs.alive && this.phase === 'fight') { const w = 200, x = 320 - w / 2, y = 22; u.text(this.P.kind === 'chase' ? '追兵' : '旗舰', x - 4, y + 5, { size: 7, bold: true, align: 'right', color: '#ffd8cc' }); u.rect(x - 1, y - 1, w + 2, 7, 'rgba(0,0,0,0.6)'); u.rect(x, y, w * Math.max(0, bs.hp) / bs.hpMax, 5, bs.hp / bs.hpMax > 0.3 ? '#e0574a' : ((Game.f12 % 2) ? '#ffb43a' : '#e0574a')); }
    // 左下：技能、冲刺
    const gun = !!ss.gun, full = this.gauge >= 100 && gun, pop = 1 + this.hudPop * 0.25;
    u.panel(8, 312, 176, 34);
    u.text(gun ? '技能「铜雨」' : '没装主炮：没有技能', 16, 324, { size: 7, bold: true, color: full ? '#ffe08a' : gun ? C.brassL : C.muted });
    u.bar(16, 329, 112, 6, this.gauge / 100, full ? ((Game.f12 % 2) ? '#fff4b0' : '#ffd24c') : '#c8963e');
    if (full) { u.keycap('E', 132, 327); u.text('放！', 146, 335, { size: 7 * pop, bold: true, color: '#ffe08a' }); } else u.text(`${Math.floor(this.gauge)}%`, 133, 335, { size: 6, color: C.muted });
    u.text('冲刺', 132, 324, { size: 6, color: C.muted }); u.bar(152, 320, 26, 3, 1 - this.pl.dcd / 0.9, this.pl.dcd > 0 ? '#5a7a9a' : '#8cc8ff');
    u.text('擦弹、命中、击毁都充能', 16, 343, { size: 5.5, color: C.muted });
    // 右下：接住的战利品
    u.panel(456, 312, 176, 34);
    const live = this.crates.filter(c => !c.done && !c.fly).length;
    u.text(`战利品 ${this.loot.length}`, 464, 324, { size: 7, bold: true, color: this.hudPop > 0 ? '#ffe08a' : C.fg });
    u.text(`接住 ${this.stats.caught} · 飘着 ${live} · 掉了 ${this.stats.lost}`, 624, 324, { size: 6, align: 'right', color: live ? '#ffd27a' : C.muted });
    this.loot.slice(-14).forEach((it, i) => { if (it.k === 'mod') u.text('◆', 466 + i * 11, 340, { size: 8, color: D.Q[it.q].color }); else { const ci = G.SPR.map.crates[it.k] || G.SPR.map.crates.mat; u.img(ci, 462 + i * 11, 331, 1); } });
    g.restore();
    // 飞进战利品栏的货箱
    for (const tr of this.trays) { const k = ease(Math.min(1, tr.t / tr.life)), x = lerp(tr.x0, 466 + Math.min(13, this.loot.length - 1) * 11, k), y = lerp(tr.y0, 336, k) - Math.sin(k * Math.PI) * 30; if (tr.it.k === 'mod') u.text('◆', x, y, { size: 9, color: D.Q[tr.it.q].color }); else { const ci = G.SPR.map.crates[tr.it.k] || G.SPR.map.crates.mat; u.img(ci, x - 5, y - 5, 1.4 - k * 0.4); } }
    // 技能满了：船头上一个跳动的「E」
    if (full && this.phase === 'fight' && !this.pl.dead) { const mz = this.muzzle(), x = this.sx(mz.x) + this.dir * 6, y = mz.y - 22 - Math.abs(Math.sin(this.t * 6)) * 4; u.keycap('E', x - 5, y); u.text('铜雨', x + 8, y + 8, { size: 6.5, bold: true, color: '#ffe08a' }); }
    // 技能切入的字
    if (this.cutin > 0) { const T = 0.85, uu = 1 - this.cutin / T, al = uu < 0.18 ? uu / 0.18 : uu > 0.78 ? (1 - uu) / 0.22 : 1; const x = this.dir > 0 ? 300 : 340; u.text('铜雨！', x, 168, { size: 26, bold: true, serif: true, align: 'center', color: '#3a1606', alpha: al, shadowColor: 'rgba(255,244,200,0.95)' }); u.text('清掉敌弹 · 五道弹流 · 伤害 ×1.5', x, 184, { size: 7.5, align: 'center', color: '#3a2410', shadow: false, alpha: al }); }
    // 开场横幅（推荐战力，绿黄红）
    if (this.ban) { const b = this.ban, al = b.t < 0.2 ? b.t / 0.2 : b.t > b.life - 0.4 ? Math.max(0, (b.life - b.t) / 0.4) : 1, sc = 1 + Math.max(0, 0.2 - b.t) * 1.5, y = b.big ? 120 : 70;
      g.save(); g.globalAlpha = al; u.panel(190, y, 260, b.big ? 50 : 46, { fill: 'rgba(24,14,8,0.88)', stroke: b.col, lw: 1.5, r: 6 });
      u.text(b.title, 320, y + (b.big ? 28 : 22), { size: (b.big ? 22 : 13) * sc, bold: true, serif: true, align: 'center', color: b.big ? b.col : C.brassL });
      u.text(b.sub, 320, y + (b.big ? 43 : 37), { size: 7.5, align: 'center', color: b.big ? C.fg : b.col, bold: !b.big }); g.restore(); }
    if (this.ann && !this.ban) { const n = this.ann, al = n.t < 0.2 ? n.t / 0.2 : n.t > n.life - 0.4 ? Math.max(0, (n.life - n.t) / 0.4) : 1; u.text(n.text, 320, 76, { size: 8, bold: true, align: 'center', color: '#ffd8cc', alpha: al }); }
    // 第一场的提示
    if (this.first && this.phase === 'fight') {
      if (this.tFight < 8) u.hint('自动开火：WASD 躲子弹，判定点是船身中间的亮点；空格冲刺（途中无敌）', { y: 294 });
      else if (this.crates.some(c => !c.done)) u.hint('敌船甲板上的货飞出来了：第一场自己飞上船，以后要飞过去接', { y: 294 });
    } else if (this.phase === 'clear' && this.crates.some(c => !c.done && !c.auto)) u.hint('还有箱子在飘：飞过去碰到就接住（10 秒内）', { y: 294 });
    if (ph === 'down') this.downUI(u);
  };
  P.panelUI = function (u) {
    const C = u.C, p = this.panel, ship = this.ship, ss = S.stats(ship), st = this.st;
    u.rect(0, 0, 640, 360, 'rgba(8,6,10,0.5)');
    u.panel(120, 26, 400, 310, { fill: 'rgba(30,22,14,0.97)', r: 6 });
    u.text('打赢了', 320, 50, { size: 14, bold: true, serif: true, align: 'center', color: '#ffd24c' });
    u.text(`接住 ${this.stats.caught} 箱，掉进云海 ${this.stats.lost} 箱　被打中 ${this.hits} 次　船体值 ${Math.ceil(ship.hp)} / ${ss.hpMax}（打完磨掉 5%）`, 320, 64, { size: 6.5, align: 'center', color: C.muted });
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
    const pw = S.power(ship), tone = S.powerTone(pw, this.rec);
    u.text(`战力 ${pw}（这片推荐 ${this.rec}，${tone.word}）`, 320, 288, { size: 7, align: 'center', color: tone.c, bold: true });
    if (u.button(250, 300, 140, 24, '继续航行', { primary: true, key: ['Enter', 'KeyE'] })) this.leave();
  };
  P.downUI = function (u) {
    const C = u.C, m = this.down;
    u.rect(0, 0, 640, 360, 'rgba(30,6,6,0.6)');
    u.panel(140, 50, 360, 260, { fill: 'rgba(30,14,10,0.97)', stroke: C.red, lw: 1.5, r: 6 });
    u.text('被击落了', 320, 76, { size: 15, bold: true, serif: true, align: 'center', color: '#ffd8cc' });
    u.text(`留下哪一件？（${Math.ceil(m.t)} 秒后自动留最值钱的）`, 320, 92, { size: 7.5, align: 'center' });
    u.text('其余的一半沉在原地，明天结束前打赢守货的海盗能捞回来；船免费拖回家修好，装着的模块不会丢', 320, 104, { size: 6, align: 'center', color: C.muted });
    m.items.forEach((it, i) => { const x = 160 + (i % 5) * 64, y = 114 + Math.floor(i / 5) * 22, on = i === m.pick, ci = G.SPR.map.crates[it.k] || G.SPR.map.crates.mat; u.panel(x, y, 60, 18, { fill: on ? 'rgba(160,110,30,0.95)' : 'rgba(52,38,26,0.9)', stroke: on ? '#ffd24c' : C.brass, r: 3 }); if (it.k === 'mod') u.text('◆', x + 6, y + 12, { size: 7, color: D.Q[it.q].color }); else u.img(ci, x + 4, y + 5, 1); u.text(it.k === 'mod' ? D.MODULES[it.type].name : D.itemName(it.k), x + 14, y + 12, { size: 6.5 }); u.text(String(D.baseValue(it)), x + 56, y + 12, { size: 5.5, align: 'right', color: C.muted }); if (u.clicked(x, y, 60, 18)) { m.pick = i; G.Sfx.play('click'); } });
    if (!m.items.length) u.text('货舱是空的', 320, 150, { size: 8, align: 'center', color: C.muted });
    if (u.button(250, 280, 140, 22, '就留这件', { primary: true, key: ['Enter', 'KeyE'] })) this.sink();
  };

  /* 给大地图用：推荐战力的小标签（巡逻船旁边、开战按钮上） */
  BT.powerLine = function (region) { const st = Game.st, ship = S.ship(st), pw = S.power(ship), rec = S.recPower(region), tone = S.powerTone(pw, rec); return { pw, rec, tone, text: `推荐战力 ${rec} · 你 ${pw}（${tone.word}）` }; };
})(window.G);
