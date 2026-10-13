/* 数据表：数值照设计文档（design.md）抄，切片里压缩过的地方都标了「切片」并写进 notes.md。 */
(function (G) {
  'use strict';
  const D = G.D = {};

  /* 「9 货物和城镇」：基础价、远方系数 */
  D.GOODS = {
    tea: { name: '茶叶', base: 30, far: 1.3, color: '#7fc06a' },
    gear: { name: '齿轮件', base: 40, far: 1.3, color: '#d9c49a' },
    wine: { name: '美酒', base: 70, far: 1.8, color: '#a46ad0' },
    spice: { name: '香料', base: 90, far: 1.8, color: '#e2573f' },
  };
  D.MAT = { name: '船材', base: 30, color: '#6f9fe0' }; // 1 箱 = 10 个；热度按 30 算
  D.GOODS_ORDER = ['tea', 'gear', 'wine', 'spice'];
  D.itemName = k => k === 'mat' ? '船材' : k.startsWith('mod:') ? D.MODULES[k.slice(4).split('.')[0]].name : D.GOODS[k].name;
  D.baseValue = it => it.k === 'mat' ? 30 : it.k === 'mod' ? [20, 100, 400][it.q || 0] : D.GOODS[it.k].base;

  /* 「4 船坞和造船」：模块（切片做 7 种，散射炮、导弹舱留到后面） */
  D.MODULES = {
    cockpit: { name: '驾驶舱', slots: ['hold'], w: 2, cost: [30, 2], val: [0, 10, 20], unit: '技能充能 +%', desc: '每艘船必须正好 1 个' },
    container: { name: '货柜', slots: ['hold'], w: 1, cost: [20, 2], val: [2, 3, 4], unit: '货舱格', desc: '加货舱格数' },
    balloon: { name: '气囊', slots: ['top', 'hold'], w: 1, cost: [20, 2], val: [10, 13, 16], unit: '升力', desc: '加升力' },
    engine: { name: '引擎', slots: ['tail'], w: 3, cost: [60, 5], val: [25, 32, 40], unit: '推力', desc: '加推力' },
    gun: { name: '连发炮', slots: ['bow'], w: 2, cost: [80, 5], val: [1, 1.3, 1.6], unit: '伤害倍率', desc: '主炮，只能装船头；技能「铜雨」' },
    armor: { name: '装甲板', slots: ['bow', 'pair'], w: 3, cost: [50, 5], val: [30, 40, 50], unit: '船体值', desc: '加船体值' },
    net: { name: '货网', slots: ['bow', 'pair'], w: 1, cost: [40, 3], val: [2, 3, 4], unit: '甲板位', desc: '加甲板位' },
  };
  D.MOD_ORDER = ['cockpit', 'container', 'balloon', 'engine', 'gun', 'armor', 'net'];
  D.Q = [{ name: '白', color: '#e8e2d4' }, { name: '蓝', color: '#7fb3e6' }, { name: '金', color: '#f0c050' }];
  D.upgradeCost = (type, q) => { const c = D.MODULES[type].cost; return q === 0 ? [c[0] * 8, 5] : [c[0] * 40, 10]; }; // 蓝升金另要 1 云晶（切片没有云晶，不开放）
  D.scrapValue = q => [2, 6, 15][q];

  /* 底模（切片做木筏和驮兽；试玩版船坞直接 2 级） */
  D.HULLS = {
    raft: { name: '木筏', tier: 'T1', self: 8, hp: 100, top: 3, hold: 3, bow: 1, pair: 0, tail: 1, deck: 2, cost: null },
    beast: { name: '驮兽货船', tier: 'T2', self: 14, hp: 150, top: 6, hold: 12, bow: 1, pair: 1, tail: 2, deck: 6, cost: [1500, 40] },
  };
  D.SLOT_NAMES = { top: '顶', hold: '舱', bow: '舷 · 船头', pair: '舷 · 两舷', tail: '尾' };
  /* 推荐装法（「4 船坞和造船 · 推荐装法」，全白色）：「一键装好」照这个装 */
  const rep = (t, n) => Array(n).fill(t);
  D.HULLS.raft.rec = { top: rep('balloon', 3), hold: ['cockpit', 'container', 'container'], bow: ['gun'], pair: [], tail: ['engine'] };
  D.HULLS.beast.rec = { top: rep('balloon', 6), hold: ['cockpit', ...rep('container', 10), 'balloon'], bow: ['gun'], pair: ['armor'], tail: rep('engine', 2) };

  /* 速度档：推重比 ≥1.2 快，0.9–1.2 中，<0.9 慢 */
  D.TIERS = [{ name: '慢', map: 0.8, shmup: 0.9 }, { name: '中', map: 1.0, shmup: 1.0 }, { name: '快', map: 1.25, shmup: 1.1 }];
  D.tierOf = twr => twr >= 1.2 ? 2 : twr >= 0.9 ? 1 : 0;

  /* 热度（「6 大地图、热度和海盗」）：货舱总价 → 0–3 档；平均多久被盯上（秒，设计值 × 切片压缩） */
  D.HEAT_STEPS = [200, 800, 2000];
  D.heatOf = v => v >= 2000 ? 3 : v >= 800 ? 2 : v >= 200 ? 1 : 0;
  D.SLICE_TIME = 0.25; // 切片：被盯上的平均间隔压到设计值的四分之一（地图航程另压到约三分之一，见 MAP）
  D.TARGET_MEAN = { inner: [0, 0, 600, 300], border: [0, 360, 240, 150] };

  /* 大地图（切片：内圈 + 边境，手工摆的固定地图；航程压缩到设计的约 1/3） */
  D.MAP = {
    w: 3400, h: 1900, speed: 56, borderX: 2100, band: 300, safeR: 330,
    home: { x: 470, y: 980, name: '空岛（家）' },
    towns: [
      { id: 'qinglan', name: '晴岚港', x: 1500, y: 470, region: 'inner', spr: 'qinglan', sells: [{ k: 'tea', n: 8, price: 30 }] },
      { id: 'tiewei', name: '铁桅镇', x: 1330, y: 1520, region: 'inner', spr: 'tiewei', sells: [{ k: 'gear', n: 8, price: 40 }, { k: 'mat', n: 20, price: 50 }] },
      { id: 'shayan', name: '砂岩堡', x: 2950, y: 1080, region: 'border', spr: 'shayan', sells: [{ k: 'wine', n: 6, price: 70 }] },
    ],
    patrols: [{ x: 1080, y: 1060, r: 'inner' }, { x: 1880, y: 900, r: 'inner' }, { x: 2560, y: 560, r: 'border' }, { x: 2620, y: 1480, r: 'border' }],
    wrecks: [{ x: 860, y: 1540, r: 'inner' }, { x: 2380, y: 1180, r: 'border' }, { x: 3120, y: 420, r: 'border' }],
    islets: [[760, 520, 0], [1200, 260, 2], [2050, 1650, 1], [2300, 300, 0], [2800, 1700, 2], [3250, 1400, 1], [600, 1650, 2], [1700, 1250, 0], [3200, 800, 2]],
  };
  /* 货箱里是什么（「7 副本和掉落」） */
  D.LOOT = { inner: [['tea', 40], ['gear', 40], ['spice', 20]], border: [['wine', 40], ['spice', 50], ['gear', 10]] };
  D.MOD_DROP_Q = { inner: [[0, 80], [1, 20]], border: [[0, 40], [1, 50], [2, 10]] };
  D.HIT_DMG = { inner: 5, border: 10 };
  D.ENEMY_MULT = { inner: 1, border: 2 };

  /* 夜市（「3 夜市」） */
  D.MARKET = { patience: 15, tipFast: [5, 0.2], tipMid: [10, 0.1], interval: 6, maxQueue: 4, hotMult: 1.3, starBonus: 0.05, tagBonus: { full: 0.15, heap: 0.3 }, stars: [10, 150, 600, 1300, 2500], orderMult: 1.5 };
  D.MARKET.slice = 0.5; // 切片：摊位离柜台只有设计的一半远（跑一趟 2–3 秒，设计 4–6 秒），来客间隔跟着减半，不然船长一半时间站着等
  D.CUSTOMER_NAMES = ['灰鹦夫人', '铜扣先生', '雾港老板娘', '老钟表匠', '缆绳大叔', '蒸汽婆婆'];
  D.ORDER_NAMES = ['灰鹦夫人', '铜扣先生', '雾港老板娘', '老钟表匠'];
})(window.G);
