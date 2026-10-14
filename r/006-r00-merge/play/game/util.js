/* 通用小工具：数学、随机数、缓动。全部挂在 window.G 上，不用打包器，直接 <script> 引入。 */
window.G = window.G || {};
(function (G) {
  'use strict';
  const U = G.U = {};
  U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.ease = t => t * t * (3 - 2 * t);
  U.easeIn = t => t * t;
  U.easeOut = t => 1 - (1 - t) * (1 - t);
  U.approach = (v, target, step) => v < target ? Math.min(target, v + step) : Math.max(target, v - step);
  U.sum = a => a.reduce((s, v) => s + v, 0);
  U.fmt = n => Math.round(n).toLocaleString('zh-CN');
  /* 可存档的随机数（mulberry32）：主机权威、同一个种子重开同一场 */
  U.rng = function (seed) {
    let s = seed >>> 0;
    const f = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.int = (a, b) => a + Math.floor(f() * (b - a + 1));
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    f.range = (a, b) => a + f() * (b - a);
    f.chance = p => f() < p;
    f.weighted = (items, wf) => { const ws = items.map(wf), tot = U.sum(ws); let r = f() * tot; for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; };
    f.state = () => s; f.seed = v => { s = v >>> 0; };
    return f;
  };
  U.R = U.rng((Date.now() ^ 0x5bd1e995) >>> 0); // 表现用（粒子等），不进存档
  U.pointInPoly = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside; } return inside; };
})(window.G);
