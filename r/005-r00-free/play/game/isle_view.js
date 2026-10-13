/* 空岛和夜市共用的画法：照星露谷拼（design.md「2 空岛」：四分之三俯视，图块铺地，镜头跟着船长，只看得到身边一片，按住 Tab 拉远看全岛）。
   - 不再是一整张背景图：地面用图块铺（草地、石板路、泥地、木板，16 像素一格），岛边（前崖面）和岛底单独一层；
     每栋建筑、每棵树、每个摊位、栅栏、灯、木桶、长椅都是单独的透明零件（isle_layout.js 摆位置）。
   - 前后：人和零件按脚底的 y 排序画；被挡住的地方就是零件本身的轮廓（透明的地方不挡人），看不到方框。
     侧墙往后退的房子、斜着往里延伸的栅栏按列切开，每一列按占地的前沿排。树、房子、摊位挡住船长时变半透明；别的挡住时画淡淡的剪影。
   - 两套像素格，都是 hi-bit 构建从源图直接缩的（assets/sprites.js 的 isleL / isleS），各自一套色板：
     走动镜头用 isleL（1 个世界像素 = 画面 1 个像素），按住 Tab 拉到全岛那一刻换成 isleS（拉的途中用 isleL、最近邻）。
   - 夜市在同一座岛上：同一套零件和地面在载入时调暗（月光的蓝），再按灯的位置点亮（一圈一圈的，像素风的光），灯罩和亮着的窗户保持原色，
     灯头上再加一点发光；人和船按站的地方的光上色。
   - 能交互的东西（建筑、柜台、摊位、告示板）沿零件的轮廓描一圈金边；走近了或者是现在该去的地方，描边变粗、一闪一闪。
   坐标：逻辑坐标（能走的范围、交互点、船长和客人的位置）是 640×360 那套，世界像素 = 逻辑 × Z（= 3）；全岛那套图的像素 = 逻辑坐标。 */
(function (G) {
  'use strict';
  const U = G.U, A = G.Art, Px = G.Px;
  const IV = G.IsleView = {};
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const cx2 = c => c.getContext('2d', { willReadFrequently: true });
  const dataOf = img => { const c = mk(img.width, img.height), g = cx2(c); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
  const canvasOf = id => { const c = mk(id.width, id.height); c.getContext('2d').putImageData(id, 0, 0); return c; };

  /* ---------- 平滑噪声：格边、岛边做一点不规则（查表的值噪声，载入时算一次） ---------- */
  function vnoise(seed, cell) {
    const N = 256, T = new Float32Array(N * N); let s = seed >>> 0; for (let i = 0; i < T.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; T[i] = s / 4294967296 * 2 - 1; }
    return (x, y) => { x /= cell; y /= cell; const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
      const x0 = xi & 255, y0 = yi & 255, x1 = (xi + 1) & 255, y1 = (yi + 1) & 255, a = T[y0 * N + x0], b = T[y0 * N + x1], c = T[y1 * N + x0], d = T[y1 * N + x1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
  }
  /* 色板里最近的颜色（边线、影子归到这一场景的色板里） */
  function palSnap(pal) { const memo = new Map(); return (r, g, b) => { const key = (r << 16) | (g << 8) | b; let o = memo.get(key); if (o) return o; let bi = 0, bd = 1e9; for (let j = 0; j < pal.length; j++) { const p = pal[j], e = (r - p[0]) ** 2 * 2 + (g - p[1]) ** 2 * 4 + (b - p[2]) ** 2 * 3; if (e < bd) { bd = e; bi = j; } } o = pal[bi]; memo.set(key, o); return o; }; }
  /* 夜里那一套的色板：调暗、点灯以后的颜色一起做 k-means（和构建时一样按亮度取初值），再把每个像素归到最近的颜色。同一场景一套色板 */
  function kmeans(pts, k, iters = 8) {
    pts.sort((a, b) => (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
    let cent = []; for (let i = 0; i < k; i++) cent.push(pts[Math.floor((i + 0.5) / k * pts.length)].slice());
    for (let it = 0; it < iters; it++) { const sum = cent.map(() => [0, 0, 0, 0]); for (const p of pts) { let b = 0, bd = 1e9; for (let i = 0; i < k; i++) { const c = cent[i], e = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (e < bd) { bd = e; b = i; } } const S = sum[b]; S[0] += p[0]; S[1] += p[1]; S[2] += p[2]; S[3]++; } cent = cent.map((c, i) => sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c); }
    return cent.map(c => c.map(Math.round));
  }
  function quantizeData(d, snap) { for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; const c = snap(d[i] | 0, d[i + 1] | 0, d[i + 2] | 0); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; } }
  /* 多边形里最靠前（y 最大）的那条边在 x 处的 y：按列排前后时，每一列用占地的前沿当底线 */
  function frontAt(poly, x) {
    const xs = poly.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs); x = U.clamp(x, x0 + 0.01, x1 - 0.01);
    let best = -1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[j], [bx, by] = poly[i]; if ((ax <= x && bx >= x) || (bx <= x && ax >= x)) { const t = bx === ax ? 0 : (x - ax) / (bx - ax); best = Math.max(best, ay + (by - ay) * t); } }
    return best;
  }
  function rasterPolys(polys, W, H, s, fill = 1, into = null) {
    const c = mk(W, H), g = cx2(c); g.fillStyle = '#fff';
    for (const poly of polys) { g.beginPath(); poly.forEach(([x, y], i) => i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)); g.closePath(); g.fill(); }
    const d = g.getImageData(0, 0, W, H).data, m = into || new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] >= 128) m[i] = fill; return m;
  }
  const distSeg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? U.clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0; return Math.hypot(px - ax - dx * t, py - ay - dy * t); };

  /* ---------- 夜里的光 ---------- */
  const AMB = [0.27, 0.31, 0.55], CAP = [1.0, 0.88, 0.72];
  /* 灯光的颜色：红多、绿少、几乎不加蓝（月光的蓝不再往上加），所以离灯远的那一圈是中性的暗色，近处才暖 */
  const LT = { lamp: { R: 136, I: 1.0, c: [1.05, 0.62, 0.1], re: 7, halo: 16 }, lantern: { R: 100, I: 0.9, c: [1.05, 0.6, 0.1], re: 6, halo: 11 }, win: { R: 50, I: 0.55, c: [1.0, 0.7, 0.2], re: 10, halo: 0 } };
  /* 光按格子登记，查的时候只看附近的几盏 */
  function lightGrid(lights, W, H, cell) {
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1, cells = Array.from({ length: cols * rows }, () => []);
    for (const l of lights) { const r = l.R + 2; for (let cy = Math.max(0, Math.floor((l.y - r) / cell)); cy <= Math.min(rows - 1, Math.floor((l.y + r) / cell)); cy++) for (let cx = Math.max(0, Math.floor((l.x - r) / cell)); cx <= Math.min(cols - 1, Math.floor((l.x + r) / cell)); cx++) cells[cy * cols + cx].push(l); }
    const none = [];
    return { lights, near: (x, y) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell); return cx < 0 || cy < 0 || cx >= cols || cy >= rows ? none : cells[cy * cols + cx]; } };
  }
  /* 一个点的光：ambient（月光）+ 附近每盏灯，一圈一圈地（四档）；地面上 hp = 0，零件上 hp = 离地多高 */
  function lightAt(LG, px, py, base, hp, out, dither) {
    let r = AMB[0], g = AMB[1], b = AMB[2];
    for (const l of LG.near(px, base)) {
      const dx = px - l.x, dy = (base - l.y) * 1.35, dh = (hp - l.h) * 0.6, d2 = dx * dx + dy * dy + dh * dh; if (d2 >= l.R2) continue;
      const f = Math.pow(1 - Math.sqrt(d2) / l.R, 1.5), q = Math.round(f * 5 + (dither ? ((((px | 0) + (py | 0)) & 1) ? 0.05 : -0.05) : 0)) / 5 * l.I; if (q <= 0) continue;
      r += l.c[0] * q; g += l.c[1] * q; b += l.c[2] * q;
    }
    out = out || [0, 0, 0]; out[0] = r < CAP[0] ? r : CAP[0]; out[1] = g < CAP[1] ? g : CAP[1]; out[2] = b < CAP[2] ? b : CAP[2]; return out;
  }
  /* 灯头上的发光（加亮叠上去，一圈一圈） */
  function haloSprite(r) { r = Math.max(2, Math.round(r)); const c = mk(r * 2, r * 2), g = c.getContext('2d'); for (const [k, a] of [[1, 0.07], [0.7, 0.12], [0.42, 0.2]]) { g.fillStyle = `rgba(255,150,60,${a})`; const rr = r * k; for (let j = -Math.ceil(rr); j < Math.ceil(rr); j++) { const w = Math.round(Math.sqrt(Math.max(0, rr * rr - (j + 0.5) ** 2))); if (w > 0) g.fillRect(r - w, r + j, w * 2, 1); } } return c; }

  /* ---------- 夜里给人、船、货箱上色（按站的地方的光；同一档的光缓存一张） ---------- */
  const tintCache = new WeakMap();
  function tinted(img, L, snap) {
    const key = ((L[0] * 24) | 0) * 10000 + ((L[1] * 24) | 0) * 100 + ((L[2] * 24) | 0);
    let m = tintCache.get(img); if (!m) tintCache.set(img, m = new Map());
    let c = m.get(key); if (c) return c;
    c = mk(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${Math.round(L[0] * 255)},${Math.round(L[1] * 255)},${Math.round(L[2] * 255)})`; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'destination-in'; g.drawImage(img, 0, 0);
    if (snap) { const id = g.getImageData(0, 0, c.width, c.height); quantizeData(id.data, snap); g.globalCompositeOperation = 'source-over'; g.putImageData(id, 0, 0); } // 归到夜里那套色板
    if (m.size > 48) m.clear(); m.set(key, c); return c;
  }
  /* 画人、货箱时用：这一帧在夜里就换成上了色的那张 */
  IV.img = (V, img) => V.L ? tinted(img, V.L, V.snap) : img;
  /* 摊位上的货这类画在零件上的东西：按它自己的位置（这套图的像素）上色 */
  IV.lit = (V, img, x, base, hp = 0) => V.LG ? tinted(img, lightAt(V.LG, x, base, base, hp), V.snap) : img;
  const shipCache = new WeakMap();
  IV.ship = (V, Sp) => {
    if (!V.L) return Sp; const key = ((V.L[0] * 24) | 0) * 10000 + ((V.L[1] * 24) | 0) * 100 + ((V.L[2] * 24) | 0);
    let m = shipCache.get(Sp); if (!m) shipCache.set(Sp, m = new Map()); let o = m.get(key); if (o) return o;
    const parts = {}; for (const k in Sp.parts) parts[k] = { ...Sp.parts[k], img: tinted(Sp.parts[k].img, V.L, V.snap) };
    o = { ...Sp, parts, balloons: Sp.balloons.map(b => b && { ...b, img: tinted(b.img, V.L, V.snap) }) }; if (m.size > 8) m.clear(); m.set(key, o); return o;
  };

  /* ---------- 载入时做一次：铺地面、接岛边和岛底、摆零件（切列、描边、夜里的样子）、能走的范围 ---------- */
  IV.prepare = function () {
    const t0 = performance.now(), L = G.IsleLayout, Z = L.Z, K = L.KINDS;
    const big = G.SPR.isleL, small = G.SPR.isleS;
    /* 地面的格子：16 像素一格，每格一种地（按格子中心落在哪块地里定） */
    const CELL = 16, cols = Math.ceil(L.W / CELL), rows = Math.ceil(L.H / CELL), ids = new Uint8Array(cols * rows);
    const TID = { grass: 1, dirt: 2, cobble: 3, plank: 4 }, TNAME = [null, 'grass', 'dirt', 'cobble', 'plank'];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL; let t = U.pointInPoly(x, y, L.island) ? 1 : 0;
      for (const f of L.terrain) { let inside = false; if (f.poly) inside = U.pointInPoly(x, y, f.poly); else if (f.path) { for (let i = 0; i < f.path.length - 1 && !inside; i++) inside = distSeg(x, y, ...f.path[i], ...f.path[i + 1]) <= f.w / 2; } if (inside) t = TID[f.t]; }
      ids[r * cols + c] = t;
    }
    const islandM = rasterPolys([L.island], L.W, L.H, 1);
    const nA = vnoise(7, 22), nB = vnoise(19, 22), nC = vnoise(31, 7), nD = vnoise(43, 7);
    const warp = (x, y) => [x + nA(x, y) * 6 + nC(x, y) * 1.6, y + nB(x, y) * 6 + nD(x, y) * 1.6];
    /* 一个点是哪种地：格子中心之间按双线性插值（> 0.5 算这一种），格子的角就是圆的、斜着的边是斜的，不是一格一格的台阶；优先级 木板 > 石板 > 泥地 > 草 */
    const memb = (t, x, y) => { const fx = x / CELL - 0.5, fy = y / CELL - 0.5, c0 = Math.floor(fx), r0 = Math.floor(fy), ax = fx - c0, ay = fy - r0; const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows || ids[r * cols + c] !== t) ? 0 : 1;
      return at(c0, r0) * (1 - ax) * (1 - ay) + at(c0 + 1, r0) * ax * (1 - ay) + at(c0, r0 + 1) * (1 - ax) * ay + at(c0 + 1, r0 + 1) * ax * ay; };
    const terrainAt = (wx, wy) => { const [x, y] = warp(wx, wy), xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= L.W || yi >= L.H || !islandM[yi * L.W + xi]) return 0; for (const t of [4, 3, 2]) if (memb(t, x, y) > 0.5) return t; return 1; };
    /* 草地上大块的深浅（不然一大片一个绿太平）：低频噪声，交界处棋盘格抖一下，颜色归到色板里 */
    const gA = vnoise(77, 110), gB = vnoise(91, 34), grassTone = (x, y) => gA(x, y) + gB(x, y) * 0.45;

    const mkView = (spr, s) => {
      const V = { spr, s, m: Z * s, small: s < 1, W: Math.round(L.W * s), H: Math.round(L.H * s) };
      const snap = palSnap(spr.pal);
      /* 零件：位置、占地、按列切、轮廓（不透明的像素）、描边 */
      V.props = []; V.groundProps = [];
      for (const pr of L.props) {
        const kd = K[pr.k] || {}, im = spr.props[pr.k]; if (!im) continue;
        const w = im.w, h = im.h, bx = pr.x * s, by = pr.y * s, x0 = Math.round(bx - w / 2), y0 = Math.round(by - h);
        const p = { id: pr.id || null, k: pr.k, act: pr.act || null, nact: pr.nact || null, lv: pr.lv || 0, x0, y0, x1: x0 + w, y1: y0 + h, w, h, base: by, img: im.img, fa: 1, kd };
        if (kd.ground) { V.groundProps.push(p); continue; }
        const dat = dataOf(im.img); p.dat = dat; p.mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) p.mask[i] = dat.data[i * 4 + 3] > 0 ? 1 : 0;
        p.foot = (kd.foot || [[-0.4, -0.1], [0.4, -0.1], [0.4, 0], [-0.4, 0]]).map(([fx, fy]) => [bx + fx * w, by + fy * h]);
        /* 每一列的底线：切列的零件用占地的前沿，别的就是脚底 */
        p.colBase = new Float32Array(w); for (let i = 0; i < w; i++) p.colBase[i] = kd.slices ? frontAt(p.foot, x0 + i + 0.5) : by;
        if (kd.slices && !V.small) {
          p.slices = []; const sw = kd.slices;
          for (let sx = 0; sx < w; sx += sw) { const ww = Math.min(sw, w - sx); let any = false; for (let j = 0; j < h && !any; j++) for (let i = sx; i < sx + ww; i++) if (p.mask[j * w + i]) { any = true; break; } if (!any) continue; p.slices.push({ sx, sw: ww, base: frontAt(p.foot, x0 + sx + ww / 2) }); }
          p.slices[p.slices.length - 1].last = true;
        }
        /* 描边：沿零件的轮廓往外一圈一圈（平时：里面亮金、外面深棕；走近 / 该去的时候：三圈，一闪一闪） */
        if (pr.act || pr.nact) {
          const P = V.small ? 2 : 3, W2 = w + P * 2, H2 = h + P * 2, m0 = new Uint8Array(W2 * H2); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m0[(j + P) * W2 + i + P] = p.mask[j * w + i];
          const dil = m => { const o = new Uint8Array(W2 * H2); for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const i = y * W2 + x; o[i] = m[i] || (x > 0 && m[i - 1]) || (x < W2 - 1 && m[i + 1]) || (y > 0 && m[i - W2]) || (y < H2 - 1 && m[i + W2]) ? 1 : 0; } return o; };
          const d1 = dil(m0), d2 = dil(d1), d3 = dil(d2), ring = (a, b) => a.map((v, i) => v && !b[i] ? 1 : 0), r1 = ring(d1, m0), r2 = ring(d2, d1), r3 = ring(d3, d2);
          const paint = layers => { const c = mk(W2, H2), g = c.getContext('2d'), id = g.createImageData(W2, H2), d = id.data; for (const [m, col] of layers) { const R = parseInt(col.slice(1, 3), 16), Gg = parseInt(col.slice(3, 5), 16), B = parseInt(col.slice(5, 7), 16); for (let i = 0; i < m.length; i++) if (m[i]) { d[i * 4] = R; d[i * 4 + 1] = Gg; d[i * 4 + 2] = B; d[i * 4 + 3] = 255; } } g.putImageData(id, 0, 0); return c; };
          p.ring = { x0: x0 - P, y0: y0 - P, idle: V.small ? paint([[r1, '#ffd86a']]) : paint([[r2, '#3a2410'], [r1, '#ffd86a']]), hot: paint([[r3, '#b85a1c'], [r2, '#ffb43a'], [r1, '#fff4c8']]) };
        }
        /* 灯（夜里用）：位置是零件里的点，往下落到脚底那条线上当「地上的位置」，离地多高照算 */
        p.lights = (kd.lights || []).map(([fx, fy, type]) => { const T = LT[type]; return { type, x: bx + fx * w, y: by, h: -fy * h, ix: w / 2 + fx * w, iy: h + fy * h, R: T.R * s, R2: (T.R * s) ** 2, I: T.I, c: T.c, re: T.re * s, halo: T.halo * s }; });
        V.props.push(p);
      }
      V.props.sort((a, b) => a.base - b.base);

      /* 地面：每个像素看它落在哪一格（格边按噪声挪一点，看起来不是一格一格的方块），从对应的图块里取颜色（图块按世界坐标平铺） */
      const W = V.W, H = V.H, tex = {}; for (const n of ['grass', 'cobble', 'dirt', 'plank']) tex[n] = dataOf(spr.tiles[n].img);
      const gid = new Uint8Array(W * H), out = new ImageData(W, H), d = out.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = terrainAt((x + 0.5) / s, (y + 0.5) / s); if (!t) continue; gid[y * W + x] = t;
        const T = tex[TNAME[t]], P = T.width, k = ((y % P) * P + (x % P)) * 4, o = (y * W + x) * 4; d[o] = T.data[k]; d[o + 1] = T.data[k + 1]; d[o + 2] = T.data[k + 2]; d[o + 3] = 255;
        if (t === 1) { const v = grassTone((x + 0.5) / s, (y + 0.5) / s), dz = ((x + y) & 1) ? 0.03 : -0.03; if (v > 0.42 + dz) { const c = snap(d[o] * 0.84 | 0, d[o + 1] * 0.86 | 0, d[o + 2] * 0.8 | 0); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; } else if (v < -0.5 + dz) { const c = snap(Math.min(255, d[o] * 1.1 + 6) | 0, Math.min(255, d[o + 1] * 1.06 + 4) | 0, d[o + 2] * 0.92 | 0); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; } }
      }
      /* 边：路、泥地、木板挨着草的那一圈描深色；岛边往里一圈压暗，外面一圈深色描边 */
      const avg = n => { const D = tex[n].data; let r = 0, g = 0, b = 0, c = 0; for (let i = 0; i < D.length; i += 4) { r += D[i]; g += D[i + 1]; b += D[i + 2]; c++; } return [r / c, g / c, b / c]; };
      const edgeCol = [null, null, ...['dirt', 'cobble', 'plank'].map(n => { const a = avg(n); return snap(a[0] * 0.42 | 0, a[1] * 0.4 | 0, a[2] * 0.4 | 0); })];
      const rimOf = (r, g, b) => snap(r * 0.62 | 0, g * 0.62 | 0, b * 0.66 | 0), outline = snap(36, 40, 30);
      const put = (o, c) => { d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; };
      const edits = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, t = gid[i], n4 = [gid[i - 1], gid[i + 1], gid[i - W], gid[i + W]];
        if (t) { if (n4.includes(0)) edits.push([i, rimOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])]); else if (t > 1 && n4.includes(1)) edits.push([i, edgeCol[t]]); }
        else if (n4.some(v => v)) edits.push([i, outline]);
      }
      for (const [i, c] of edits) put(i * 4, c);
      /* 零件脚下的影子（光从左上来，影子往右下偏一点；压暗地面，归到色板里） */
      for (const p of V.props) {
        const sh = p.kd.shadow; if (sh === 0 || p.lv > 1) continue; const rx = (sh || 0.4) * p.w, ry = Math.max(1.5, Math.min(14 * s, 0.1 * p.w)), cx = (p.x0 + p.x1) / 2 + 0.05 * p.w, cy = p.base - ry * 0.35;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) { if (y < 0 || y >= H) continue; const yy = (y + 0.5 - cy) / ry, hw = rx * Math.sqrt(Math.max(0, 1 - yy * yy)); for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) { if (x < 0 || x >= W) continue; const i = y * W + x; if (!gid[i]) continue; const o = i * 4; put(o, snap(d[o] * 0.7 | 0, d[o + 1] * 0.7 | 0, d[o + 2] * 0.74 | 0)); } }
      }
      const groundC = canvasOf(out);
      /* 合成：岛底 → 地面 → 前崖面（沿着岛面的下沿一列一列接，草沿盖住地面的边）→ 栈桥 */
      const C = mk(W, H), cg = C.getContext('2d'); cg.imageSmoothingEnabled = false;
      { const u = spr.under, ux = Math.round(L.under.x * s - u.w / 2), uy = Math.round(L.under.y * s); cg.drawImage(u.img, ux, uy); }
      cg.drawImage(groundC, 0, 0);
      { const cl = spr.cliff, lip = Math.round(L.cliff.lip * s); for (let x = 0; x < W; x++) { let yb = -1; for (let y = H - 1; y >= 0; y--) if (gid[y * W + x]) { yb = y; break; } if (yb < 0) continue; cg.drawImage(cl.img, x % cl.w, 0, 1, cl.h, x, yb - lip, 1, cl.h); } }
      for (const p of V.groundProps) cg.drawImage(p.img, p.x0, p.y0);
      V.ground = C; V.gid = gid;
      /* 每一行从哪到哪是不透明的（地面、岛边、岛底）：画云海时这一段不用画（全分辨率画布上，云海和地面各铺一遍满屏很费） */
      { const d2 = cg.getImageData(0, 0, W, H).data, sa = new Int16Array(H), sb = new Int16Array(H); for (let y = 0; y < H; y++) { let a = -1, b = -2, best = 0, run = -1; for (let x = 0; x <= W; x++) { const op = x < W && d2[(y * W + x) * 4 + 3] === 255; if (op && run < 0) run = x; if (!op && run >= 0) { if (x - run > best) { best = x - run; a = run; b = x - 1; } run = -1; } } sa[y] = a; sb[y] = b; } V.spanA = sa; V.spanB = sb; }
      /* 云海（在岛的下面，跟着镜头慢一点挪）：原图 + 左右翻过来的一张接成左右无缝 */
      { const c = spr.clouds, st = mk(c.w * 2, c.h), g = st.getContext('2d'); g.drawImage(c.img, 0, 0); g.save(); g.translate(c.w * 2, 0); g.scale(-1, 1); g.drawImage(c.img, 0, 0); g.restore(); V.clouds = st; }
      V.sil = {}; for (const n of ['capA', 'capB']) V.sil[n] = silhouette(spr[n].img);
      return V;
    };
    const Bv = mkView(big, 1), Sv = mkView(small, 1 / Z);

    /* 夜里：同一套零件和地面调暗、点灯（每个零件按它站的位置算一张夜里的样子；灯罩、亮着的窗户保持原色） */
    const nightOf = (V) => {
      const N = { ...V, night: true, props: [], halos: [] }, lights = V.props.filter(p => !p.lv || p.lv <= 1).flatMap(p => p.lights); // 集市 1 级：2 级的摊位不在岛上，它的灯也不点
      const LG = N.LG = lightGrid(lights, V.W, V.H, Math.round(64 * V.s) || 16), Lc = [0, 0, 0];
      /* 地面 */
      const groundD = (() => { const g = cx2(V.ground), id = g.getImageData(0, 0, V.W, V.H), d = id.data, W = V.W; for (let y = 0; y < V.H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; if (!d[o + 3]) continue; lightAt(LG, x + 0.5, y + 0.5, y + 0.5, 0, Lc, true); d[o] *= Lc[0]; d[o + 1] *= Lc[1]; d[o + 2] *= Lc[2]; } return id; })();
      const propD = [];
      /* 零件 */
      for (const p of V.props) {
        const q = { ...p, fa: 1 }, w = p.w, h = p.h, src = p.dat.data, id = new ImageData(w, h), d = id.data;
        const em = new Uint8Array(w * h); for (const l of p.lights) { const rr = l.re; for (let j = Math.max(0, Math.floor(l.iy - rr)); j < Math.min(h, Math.ceil(l.iy + rr)); j++) for (let i = Math.max(0, Math.floor(l.ix - rr)); i < Math.min(w, Math.ceil(l.ix + rr)); i++) { if ((i - l.ix) ** 2 + (j - l.iy) ** 2 > rr * rr) continue; const k = (j * w + i) * 4, lum = src[k] * 0.3 + src[k + 1] * 0.59 + src[k + 2] * 0.11; if (src[k + 3] && (lum > 205 || (lum > (l.type === 'win' ? 110 : 130) && src[k] > src[k + 1] * 1.08 && src[k] > src[k + 2] * 1.55))) em[j * w + i] = 1; } } // 只留暖色的亮像素（灯焰、亮着的窗玻璃），旁边米色的墙照样调暗
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const k = (j * w + i) * 4; if (!src[k + 3]) continue; d[k + 3] = src[k + 3];
          if (em[j * w + i]) { d[k] = Math.min(255, src[k] * 1.08); d[k + 1] = Math.min(255, src[k + 1] * 1.04); d[k + 2] = src[k + 2]; continue; }
          const base = p.colBase[i], py = p.y0 + j + 0.5; lightAt(LG, p.x0 + i + 0.5, py, base, Math.max(0, base - py), Lc, true);
          d[k] = src[k] * Lc[0]; d[k + 1] = src[k + 1] * Lc[1]; d[k + 2] = src[k + 2] * Lc[2];
        }
        propD.push(id); N.props.push(q);
        for (const l of p.lights) if (l.halo) N.halos.push({ x: l.x, y: l.y - l.h, r: Math.round(l.halo), lv: p.lv });
      }
      N.haloSpr = {}; for (const hl of N.halos) if (!N.haloSpr[hl.r]) N.haloSpr[hl.r] = haloSprite(hl.r);
      /* 云海：没有灯，只调暗 */
      const cloudD = (() => { const c = mk(V.clouds.width, V.clouds.height), g = cx2(c); g.drawImage(V.clouds, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(56,66,128)'; g.fillRect(0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height); })();
      /* 夜里那一套的色板（96 色）：地面、零件、云海一起抽样做 k-means，再全部归色；人和船上色时也归到这套 */
      { const pts = [], add = (d, step) => { for (let i = 0; i < d.length; i += 4 * step) if (d[i + 3]) pts.push([d[i], d[i + 1], d[i + 2]]); };
        add(groundD.data, V.small ? 11 : 97); for (const d of propD) add(d.data, V.small ? 5 : 29); add(cloudD.data, V.small ? 41 : 211);
        N.pal = kmeans(pts, 96, 6); N.snap = palSnap(N.pal);
        quantizeData(groundD.data, N.snap); N.ground = canvasOf(groundD); propD.forEach((d, i) => { quantizeData(d.data, N.snap); N.props[i].img = canvasOf(d); }); quantizeData(cloudD.data, N.snap); N.clouds = canvasOf(cloudD); }
      return N;
    };
    const sets = {
      day: { key: 'day', Z, W: L.W, H: L.H, night: false, big: Bv, small: Sv },
      night: { key: 'night', Z, W: L.W, H: L.H, night: true, big: nightOf(Bv), small: nightOf(Sv) },
    };
    IV.sets = sets; IV.L = L;
    for (const S of [sets.day, sets.night]) for (const V of [S.big, S.small]) for (const p of V.props) if (p.ring) { p.ring.idleT = ringTiles(p.ring.idle); p.ring.hotT = ringTiles(p.ring.hot); }
    IV.buildWalk(1);
    IV.prepMs = Math.round(performance.now() - t0);
    return sets;
  };
  function silhouette(img) { const c = mk(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#ffe2a8'; g.fillRect(0, 0, c.width, c.height); return c; }

  /* ---------- 能不能走：能走的范围（世界像素一格），减掉零件的占地（集市几级就有几个摊位） ---------- */
  IV.buildWalk = function (level) {
    const L = IV.L, m = rasterPolys(L.walk, L.W, L.H, 1);
    const feet = IV.sets.day.big.props.filter(p => !p.lv || p.lv <= level).map(p => p.foot);
    rasterPolys(feet.concat(L.noWalk), L.W, L.H, 1, 0, m);
    IV.walkM = m; IV.walkLevel = level;
    for (const S of [IV.sets.day, IV.sets.night]) for (const V of [S.big, S.small]) bake(V, level);
  };
  /* 烘好的一层：地面（含岛边、岛底、栈桥）+ 全部零件，按和画的时候一样的顺序（切列的按列）叠好。
     每帧先整块画它，零件只在「后面有人、后面有重画过的东西、或者正在变半透明」时才在自己的位置重画一次：
     不然全分辨率画布上每帧把几十个零件一个个放大画一遍，4K 下一帧要多花好几毫秒 */
  function itemsOf(V, level, slices) { const items = []; for (const p of V.props) { if (p.lv && p.lv > level) continue; if (slices && p.slices) for (const sl of p.slices) items.push({ k: sl.base, p, sl }); else items.push({ k: p.base, p }); } return items.sort((a, b) => a.k - b.k); }
  function drawItem(g, it) { const p = it.p; if (it.sl) g.drawImage(p.img, it.sl.sx, 0, it.sl.sw, p.h, p.x0 + it.sl.sx, p.y0, it.sl.sw, p.h); else g.drawImage(p.img, p.x0, p.y0); }
  /* 平时的描边（不闪的那种）也烘进去，透明度固定 RING_A；走近 / 该去的那个才每帧画（一闪一闪） */
  const RING_A = 0.8;
  function bake(V, level) {
    const c = mk(V.W, V.H), g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(V.ground, 0, 0);
    const items = itemsOf(V, level, true); for (const p of V.props) if (p.ring && (V.night ? p.nact : p.act) && !(p.lv && p.lv > level)) items.push({ k: p.base - 0.5, ring: p });
    items.sort((a, b) => a.k - b.k);
    for (const it of items) { if (it.ring) { g.globalAlpha = RING_A; g.drawImage(it.ring.ring.idle, it.ring.ring.x0, it.ring.ring.y0); g.globalAlpha = 1; } else drawItem(g, it); }
    V.baked = c;
  }
  /* 描边图大多是透明的：切成 32 像素的小块，只留有描边的那些块来画 */
  function ringTiles(c) { const T = 32, d = cx2(c).getImageData(0, 0, c.width, c.height).data, out = []; for (let y = 0; y < c.height; y += T) for (let x = 0; x < c.width; x += T) { const w = Math.min(T, c.width - x), h = Math.min(T, c.height - y); let any = false; for (let j = y; j < y + h && !any; j++) for (let i = x; i < x + w; i++) if (d[(j * c.width + i) * 4 + 3]) { any = true; break; } if (any) out.push([x, y, w, h]); } return out; }
  IV.okFn = function (key, extra) { return (x, y) => { const L = IV.L, X = Math.floor(x * L.Z), Y = Math.floor(y * L.Z); if (X < 0 || Y < 0 || X >= L.W || Y >= L.H || !IV.walkM[Y * L.W + X]) return false; return !(extra && extra(x, y)); }; };

  /* ---------- 镜头：走动时 zoom = 1（一个世界像素 = 画面一个像素）；按住 Tab 拉到全岛 ---------- */
  IV.camera = function (key) { const S = IV.sets[key]; const c = new G.Cam({ w: S.W, h: S.H }); c.zMin = Math.min(G.Game.W / S.W, G.Game.H / S.H); c.zt = 0; return c; };
  /* zt：0 = 走动镜头，1 = 全岛；ease 过去，0.3 秒拉完 */
  IV.stepCam = function (cam, dt, wantOut, tx, ty, snap) {
    cam.zt = U.approach(cam.zt, wantOut ? 1 : 0, dt / 0.3);
    const e = U.ease(cam.zt); cam.zoom = 1 + (cam.zMin - 1) * e;
    if (snap) cam.snapTo(tx, ty); else cam.follow(tx, ty, dt);
  };
  /* 这一帧用哪套图：全岛那一刻用 isleS（清清楚楚），拉远拉近的途中用 isleL（最近邻） */
  IV.setFor = function (key, cam) { const S = IV.sets[key]; return cam.zt >= 1 ? S.small : S.big; };
  /* 一个交互点的零件合起来的框（世界像素）：名字写在它顶上、画面外的箭头指过去 */
  IV.actBox = function (key, act, level = 1) {
    const S = IV.sets[key], ps = S.big.props.filter(p => (S.night ? p.nact : p.act) === act && (!p.lv || p.lv <= level)); if (!ps.length) return null;
    const x0 = Math.min(...ps.map(p => p.x0)), y0 = Math.min(...ps.map(p => p.y0)), x1 = Math.max(...ps.map(p => p.x1)), y1 = Math.max(...ps.map(p => p.y1));
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  };
  IV.prop = (key, id) => IV.sets[key].big.props.find(p => p.id === id);

  /* 零件的轮廓盖没盖住这个框（按不透明的像素抽查一格一格的点） */
  function covers(p, box, need = 2) {
    const [bx0, by0, bx1, by1] = box, x0 = Math.max(bx0, p.x0), x1 = Math.min(bx1, p.x1), y0 = Math.max(by0, p.y0), y1 = Math.min(by1, p.y1); if (x1 <= x0 || y1 <= y0) return false;
    let n = 0; for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) { const x = Math.floor(bx0 + (bx1 - bx0) * (i + 0.5) / 4 - p.x0), y = Math.floor(by0 + (by1 - by0) * (j + 0.5) / 6 - p.y0); if (x >= 0 && y >= 0 && x < p.w && y < p.h && p.mask[y * p.w + x]) { if (++n >= need) return true; } }
    return false;
  }
  /* 零件在这个 x 上是不是排在 key 后面（画在人前面） */
  const inFront = (p, x, key) => { if (!p.slices) return p.base > key; const i = Math.floor(x - p.x0); return (i >= 0 && i < p.w ? p.colBase[i] : p.base) > key; };

  /* ---------- 画：云海 → 地面 → （零件、描边和人按脚底的 y 排序）→ 被挡住的船长剪影 → 夜里灯头的光 ---------- */
  /* ents：[{ x, y: 逻辑坐标（脚）, draw(g, V) → 画到的框（这套图的像素）, sil?: 船长剪影, lit?: false 夜里不上色, bb?: 逻辑坐标的大致范围（画面外就不画） }]。
     o.hot：要描粗边的交互点；o.acts：哪些交互点描边（不给 = 全部）；o.extra：{零件 id: (g, V, p) => {}} 画在这个零件上面的东西（摊位上的货）；
     o.level：集市几级（摊位几个）；o.over(g, V)：最上面一层（夜市的串灯） */
  IV.render = function (g, key, cam, ents, o = {}) {
    const S = IV.sets[key], V = IV.setFor(key, cam), Z = S.Z, m = V.m, s = V.s, night = S.night, lvl = o.level || 1;
    cam.begin(g); if (V.small) { g.save(); g.scale(Z, Z); Px.u *= Z; }
    g.imageSmoothingEnabled = false; // 拉远拉近那 0.3 秒也用最近邻（平滑缩放在 4K 画布上一帧要几十毫秒）
    const vl = (-cam.tx / cam.zoom) * s, vt = (-cam.ty / cam.zoom) * s, vw = G.Game.W / cam.zoom * s, vh = G.Game.H / cam.zoom * s;
    /* 云海：跟着镜头只挪一半多一点（远），再慢慢飘。被岛盖住的那一段不画：按 24 像素一条横带，每条只画岛左边、右边露出来的那两块 */
    { const C = V.clouds, ox = Math.round((cam.cx * s - V.W / 2) * 0.45 + G.Game.t * 3 * s), oy = Math.round((cam.cy * s - V.H / 2) * 0.45);
      const pat = V.cpat || (V.cpat = g.createPattern(C, 'repeat')); pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy])); g.fillStyle = pat;
      const B = Math.max(8, Math.round(24 * s)), x0 = Math.floor(vl) - 1, x1 = Math.ceil(vl + vw) + 1, y0 = Math.floor(vt) - 1, y1 = Math.ceil(vt + vh) + 1;
      for (let y = y0; y < y1; y += B) { const ye = Math.min(y1, y + B); let A = -1e9, Bb = 1e9; for (let r = Math.max(0, y); r < Math.min(V.H, ye); r++) { const a = V.spanA[r], b = V.spanB[r]; if (a < 0) { A = 1e9; Bb = -1e9; break; } A = Math.max(A, a); Bb = Math.min(Bb, b); } if (y < 0 || ye > V.H) { A = 1e9; Bb = -1e9; }
        if (A > Bb) { g.fillRect(x0, y, x1 - x0, ye - y); continue; }
        if (A > x0) g.fillRect(x0, y, Math.min(A, x1) - x0, ye - y); if (Bb + 1 < x1) g.fillRect(Math.max(Bb + 1, x0), y, x1 - Math.max(Bb + 1, x0), ye - y); } }
    /* 烘好的那一层（地面 + 零件）：只取画面里那一块 */
    const L0 = Math.max(0, Math.floor(vl) - 2), T0 = Math.max(0, Math.floor(vt) - 2), W0 = Math.min(V.W - L0, Math.ceil(vw) + 4), H0 = Math.min(V.H - T0, Math.ceil(vh) + 4);
    if (W0 > 0 && H0 > 0) g.drawImage(V.baked, L0, T0, W0, H0, L0, T0, W0, H0);
    if (o.under) o.under(g, V);
    /* 树、房子、摊位挡住船长：变半透明（按上一帧船长的框，0.15 秒淡过去） */
    const cb = S.capBox && S.capBox.v === V ? S.capBox : null;
    for (const p of V.props) { if (!p.kd.fade) continue; const want = cb && !V.small && inFront(p, (cb.b[0] + cb.b[2]) / 2, cb.k) && covers(p, cb.b) ? 0.42 : 1; p.fa = U.approach(p.fa, want, 0.09); }
    /* 正在变半透明的零件：烘好的那层里它是实的，先把它那一块换回不带零件的地面（岛外的地方先补云），这一块里的零件都按顺序重画 */
    const dirty = [];
    for (const p of V.props) { if (p.fa >= 1 || (p.lv && p.lv > lvl)) continue; if (p.x1 < vl || p.x0 > vl + vw || p.y1 < vt || p.y0 > vt + vh) continue;
      const r = p.ring, x0 = Math.max(0, (r ? r.x0 : p.x0) - 1), y0 = Math.max(0, (r ? r.y0 : p.y0) - 1), x1 = Math.min(V.W, (r ? r.x0 + r.idle.width : p.x1) + 1), y1 = Math.min(V.H, (r ? r.y0 + r.idle.height : p.y1) + 1); if (x1 <= x0 || y1 <= y0) continue; // 连描边一起换回地面
      g.fillRect(x0, y0, x1 - x0, y1 - y0); /* fillStyle 还是云海 */ g.drawImage(V.ground, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0); dirty.push([x0, y0, x1, y1]); }
    const list = [];
    for (const p of V.props) {
      if (p.lv && p.lv > lvl) continue;
      if (p.x1 < vl - 4 || p.x0 > vl + vw + 4 || p.y1 < vt - 4 || p.y0 > vt + vh + 4) continue;
      if (!V.small && p.slices) for (const sl of p.slices) list.push({ k: sl.base, p, sl, b: [p.x0 + sl.sx, p.y0, p.x0 + sl.sx + sl.sw, p.y1] }); else list.push({ k: p.base, p, b: [p.x0, p.y0, p.x1, p.y1] });
      const act = night ? p.nact : p.act;
      if (act && p.ring) list.push({ k: p.base - 0.5, ring: p, act, show: !o.acts || o.acts.has(act) });
    }
    for (const e of ents) list.push({ k: e.y * m + (e.dk || 0), e });
    list.sort((a, b) => a.k - b.k);
    const t = G.Game.t, pulse = 0.5 + 0.5 * Math.sin(t * 5.5), Lc = [0, 0, 0];
    /* drawn：这一帧在烘好的那层上面又画过的东西的框（人、船、货箱、重画的零件、描边）。排在它们后面（更靠前）、又和它们重叠的零件要重画，才能盖在上面 */
    const drawn = dirty.slice(), hit = (b, own) => { for (const d of drawn) if (d.own !== own && d[2] > b[0] && d[0] < b[2] && d[3] > b[1] && d[1] < b[3]) return true; return false; };
    let cap = null;
    for (const it of list) {
      if (it.p) {
        const p = it.p, redraw = p.fa < 1 || hit(it.b, p);
        if (redraw) { if (p.fa < 1) g.globalAlpha = p.fa; drawItem(g, it); g.globalAlpha = 1; drawn.push(it.b); }
        if (o.extra && o.extra[p.id] && (!it.sl || it.sl.last)) { if (p.fa < 1) g.globalAlpha = p.fa; o.extra[p.id](g, V, p); g.globalAlpha = 1; drawn.push([p.x0, p.y0, p.x1, p.y1]); } // 摊位上的货跟着摊位一起变半透明
      } else if (it.ring) {
        /* 平时的描边已经烘在那一层里：只有被这一帧重画过的东西盖到的那几块要补画；走近 / 该去的那个整圈每帧画（一闪一闪） */
        const p = it.ring, hot = it.show && o.hot && o.hot.has(it.act), R = p.ring;
        if (hot) { g.globalAlpha = (0.7 + 0.3 * pulse) * (p.fa < 1 ? 0.6 : 1); for (const [x, y, w, h] of R.hotT) { const X = R.x0 + x, Y = R.y0 + y; if (X + w < vl || X > vl + vw || Y + h < vt || Y > vt + vh) continue; g.drawImage(R.hot, x, y, w, h, X, Y, w, h); const b = [X, Y, X + w, Y + h]; b.own = p; drawn.push(b); } }
        else if (it.show) { g.globalAlpha = RING_A * (p.fa < 1 ? 0.6 : 1); for (const [x, y, w, h] of R.idleT) { const X = R.x0 + x, Y = R.y0 + y, b = [X, Y, X + w, Y + h]; if (X + w < vl || X > vl + vw || Y + h < vt || Y > vt + vh || !hit(b, p)) continue; g.drawImage(R.idle, x, y, w, h, X, Y, w, h); b.own = p; drawn.push(b); } }
        g.globalAlpha = 1;
      } else {
        const e = it.e; if (e.bb && (e.bb[2] * m < vl || e.bb[0] * m > vl + vw || e.bb[3] * m < vt || e.bb[1] * m > vt + vh)) continue; // 画面外的船不画（绳子一个像素一个像素画，挺费）
        V.L = night && e.lit !== false ? lightAt(V.LG, (e.x ?? 320) * m, e.y * m, e.y * m, 30 * s, Lc) : null;
        /* 栈桥上停着的船挡住船长：也变半透明（按上一帧船的框；画船时用 V.ea 当透明度） */
        let F = null; if (e.fid) { const E = S.ef || (S.ef = {}); F = E[e.fid] || (E[e.fid] = { a: 1, box: null, v: null }); let want = 1; if (cb && !V.small && it.k > cb.k && F.box && F.v === V) { const [a0, b0, a1, b1] = F.box, [c0, d0, c1, d1] = cb.b, ix = Math.max(0, Math.min(a1, c1) - Math.max(a0, c0)), iy = Math.max(0, Math.min(b1, d1) - Math.max(b0, d0)); if (ix * iy > 0.35 * (c1 - c0) * (d1 - d0)) want = 0.45; } F.a = U.approach(F.a, want, 0.09); V.ea = F.a < 0.99 ? F.a : undefined; }
        const bx = e.draw(g, V); V.L = null; V.ea = undefined;
        if (F && Array.isArray(bx)) { F.box = bx; F.v = V; }
        if (e.sil && Array.isArray(bx)) { e.box = bx; cap = { e, b: bx, k: it.k }; }
        drawn.push(Array.isArray(bx) ? bx : e.box || [-1e9, -1e9, 1e9, 1e9]); // 不知道画到哪的（粒子）：当成整个画面，排在它后面的零件都重画
      }
    }
    S.capBox = cap ? { b: cap.b, k: cap.k, v: V } : null;
    /* 被挡住的船长：只在挡住他的那些零件的轮廓里，画一个淡淡的剪影（半透明的那些本来就看得见他，不再画） */
    if (cap && cap.e.sil) {
      const [bx0, by0, bx1, by1] = cap.b, cover = list.filter(q => q.p && q.p.fa > 0.9 && q.k > cap.k && (q.sl ? (q.p.x0 + q.sl.sx < bx1 && q.p.x0 + q.sl.sx + q.sl.sw > bx0) : true) && covers(q.p, cap.b, 1));
      /* 只挡住腿（柜台、栅栏、长椅）不画；大半个人都被挡住才画 */
      let hid = 0; for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) { const x = bx0 + (bx1 - bx0) * (i + 0.5) / 4, y = by0 + (by1 - by0) * (j + 0.5) / 6; if (cover.some(q => { const X = Math.floor(x - q.p.x0), Y = Math.floor(y - q.p.y0); return X >= 0 && Y >= 0 && X < q.p.w && Y < q.p.h && q.p.mask[Y * q.p.w + X]; })) hid++; }
      if (cover.length && hid >= 11) {
        const X = Math.floor(bx0), Y = Math.floor(by0), w = Math.ceil(bx1) - X + 1, h = Math.ceil(by1) - Y + 1, c = IV._silC || (IV._silC = mk(64, 64)); if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
        const sg = c.getContext('2d'); sg.imageSmoothingEnabled = false; sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, c.width, c.height);
        for (const q of cover) { if (q.sl) sg.drawImage(q.p.img, q.sl.sx, 0, q.sl.sw, q.p.h, q.p.x0 + q.sl.sx - X, q.p.y0 - Y, q.sl.sw, q.p.h); else sg.drawImage(q.p.img, q.p.x0 - X, q.p.y0 - Y); }
        sg.globalCompositeOperation = 'source-in'; sg.save(); sg.translate(-X, -Y); cap.e.sil(sg, V); sg.restore(); sg.globalCompositeOperation = 'source-over';
        g.globalAlpha = 0.32; g.drawImage(c, 0, 0, w, h, X, Y, w, h); g.globalAlpha = 1;
      }
    }
    /* 夜里：灯头、灯罩上加一点发光 */
    if (night) { g.globalCompositeOperation = 'lighter'; for (const hl of V.halos) { if (hl.lv && hl.lv > lvl) continue; if (hl.x + hl.r < vl || hl.x - hl.r > vl + vw || hl.y + hl.r < vt || hl.y - hl.r > vt + vh) continue; g.drawImage(V.haloSpr[hl.r], Math.round(hl.x - hl.r), Math.round(hl.y - hl.r)); } g.globalCompositeOperation = 'source-over'; }
    if (o.over) o.over(g, V);
    if (V.small) { g.restore(); Px.u /= Z; }
    g.imageSmoothingEnabled = false;
    cam.end(g);
  };

  /* 整座岛（全岛那套图，不带人）：标题画面用 */
  IV.snapshot = function (key = 'day', level = 1) {
    const S = IV.sets[key], V = S.small, c = mk(V.W, V.H), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    for (let y = 0; y < V.H; y += V.clouds.height) for (let x = 0; x < V.W; x += V.clouds.width) g.drawImage(V.clouds, x, y);
    g.drawImage(V.baked, 0, 0);
    return c;
  };

  /* ---------- 小工具：按这套图画人（走路一颠一颠、转身翻转、脚下影子；夜里按站的地方的光上色） ---------- */
  IV.walker = function (g, V, w, img, f, o = {}) {
    const m = V.m, step = w.moving ? (Math.floor(f / 3) % 2) : 0, x = w.x * m - img.width / 2, y = w.y * m - img.height - step * Math.max(1, Math.round(m / 2));
    A.oval(g, w.x * m, w.y * m, img.width * 0.42, 2 * m / 1.5, 'rgba(20,12,10,0.35)');
    A.drawImg(g, IV.img(V, img), x, y, w.face < 0);
    if (o.carry && o.carry.length) o.carry.forEach((c, i) => { const ci = o.crates[c] || o.crates.mat; g.drawImage(IV.img(V, ci.img), Px.s(w.x * m - ci.w / 2 + (i - (o.carry.length - 1) / 2) * (ci.w - 2)), Px.s(y - ci.h - 1 - i * ci.h * 0.4)); });
    return [x, y - (o.carry && o.carry.length ? 7 * m : 0), x + img.width, w.y * m];
  };
  /* 剪影：和 walker 同一个位置 */
  IV.walkerSil = function (g, V, w, sil, f) { const m = V.m, step = w.moving ? (Math.floor(f / 3) % 2) : 0, x = w.x * m - sil.width / 2, y = w.y * m - sil.height - step * Math.max(1, Math.round(m / 2)); A.drawImg(g, sil, x, y, w.face < 0); };

  /* 右下角一行小字「按住 Tab 看全岛」，按过一次就不再写 */
  IV.tabHint = function (u, cam) { if (G.In.key('Tab')) IV.tabSeen = true; if (!IV.tabSeen && cam.zt <= 0) u.text('按住 Tab 看全岛', 632, 352, { size: 6, align: 'right', color: 'rgba(240,230,210,0.6)' }); };
  /* 画面外的目标：画面边上一个小箭头 + 名字（镜头只看身边一片，要去的建筑常常不在画面里） */
  IV.edgeArrow = function (u, cam, wx, wy, label) {
    const sx = cam.sx(wx), sy = cam.sy(wy), M = 22;
    if (sx > M && sx < 640 - M && sy > 40 && sy < 330) return false;
    const cx = 320, cy = 185, dx = sx - cx, dy = sy - cy, s = Math.min((320 - M) / Math.max(1e-6, Math.abs(dx)), (150 - M) / Math.max(1e-6, Math.abs(dy))), ex = cx + dx * s, ey = cy + dy * s, a = Math.atan2(dy, dx);
    const g = u.g, k = u.k; g.save(); g.translate(u.ox + ex * k, u.oy + ey * k); g.rotate(a); g.fillStyle = '#ffe08a'; g.strokeStyle = '#1b1209'; g.lineWidth = k; g.beginPath(); g.moveTo(8 * k, 0); g.lineTo(-4 * k, -6 * k); g.lineTo(-1 * k, 0); g.lineTo(-4 * k, 6 * k); g.closePath(); g.stroke(); g.fill(); g.restore();
    const lx = U.clamp(ex - Math.cos(a) * 18, 30, 610), ly = U.clamp(ey - Math.sin(a) * 14 + 3, 44, 328);
    u.text(label, lx, ly, { size: 7, align: 'center', bold: true, color: '#ffe08a' });
    return true;
  };
})(window.G);
