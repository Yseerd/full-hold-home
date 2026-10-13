/* 空岛和夜市共用的画法（design.md「2 空岛」：镜头跟着自己的船长，只看得到身边一片，走到哪看到哪，按住 Tab 拉远看全岛）。
   - 两套图：走动时用大图（isleL / nightL，1672×941，和源图一样大，画面里看得到岛宽的约 38%）；按住 Tab 拉到全岛时用 640 宽的那套（拉的途中用大图、最近邻）。
     两套都是 hi-bit 构建从源图直接缩出来的，像素格各自和背景一样大。
   - 前后遮挡：isle_layout.js 里手画的每块遮挡，从背景里剪出来，和人一起按「脚 / 底线」的 y 排序画：人在它后面就被它盖住。
     被挡住的那部分，船长画一个淡淡的剪影，走到房子后面也知道自己在哪。
   - 能交互的东西（建筑、摊位、柜台、告示板）沿轮廓描一圈金边；走近了、或者是现在该去的地方，描边变粗、一闪一闪。
   坐标：逻辑坐标（能走的范围、交互点、船长和客人的位置）还是以前 640×360 那套，不动玩法；画的时候大图 ×Z（=1672/640）。 */
(function (G) {
  'use strict';
  const U = G.U, A = G.Art, Px = G.Px;
  const IV = G.IsleView = {};
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  const cx2 = c => c.getContext('2d', { willReadFrequently: true });

  /* ---------- 载入时做一次：剪遮挡、算描边 ---------- */
  function polyMask(poly, x0, y0, w, h) {
    const c = mk(w, h), g = cx2(c); g.fillStyle = '#fff'; g.beginPath(); poly.forEach(([x, y], i) => i ? g.lineTo(x - x0, y - y0) : g.moveTo(x - x0, y - y0)); g.closePath(); g.fill();
    const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0; return m;
  }
  function dilate(m, w, h) { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ? 1 : 0; } return o; }
  function paint(masks, w, h) { const c = mk(w, h), g = cx2(c), id = g.createImageData(w, h), d = id.data; for (const [m, col] of masks) { const r = parseInt(col.slice(1, 3), 16), gg = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16); for (let i = 0; i < m.length; i++) if (m[i]) { d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; } } g.putImageData(id, 0, 0); return c; }
  /* 一套图（大 / 小）上的全部遮挡和描边。s：布局坐标（大图像素）× s = 这套图的像素 */
  function buildSet(bgImg, lay, s) {
    const occ = [];
    for (const o of lay.occ) {
      const poly = o.poly.map(([x, y]) => [x * s, y * s]);
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      const x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys)), x1 = Math.ceil(Math.max(...xs)), y1 = Math.ceil(Math.max(...ys)), w = x1 - x0, h = y1 - y0;
      const m = polyMask(poly, x0, y0, w, h), cut = mk(w, h), g = cx2(cut);
      g.drawImage(bgImg, -x0, -y0); const id = g.getImageData(0, 0, w, h); for (let i = 0; i < m.length; i++) if (!m[i]) id.data[i * 4 + 3] = 0; g.putImageData(id, 0, 0);
      const dark = mk(w, h), dg = dark.getContext('2d'); dg.drawImage(cut, 0, 0); dg.globalCompositeOperation = 'source-atop'; dg.fillStyle = 'rgba(16,12,30,0.62)'; dg.fillRect(0, 0, w, h); // 没开放的摊位：盖上暗色
      occ.push({ id: o.id, act: o.act || null, base: o.base * s, x0, y0, x1, y1, poly, cut, dark });
    }
    /* 描边：同一个交互点的几块合起来描一圈（外面先 1 像素亮金，走近时再往外加 1 像素橙金） */
    const rings = {};
    for (const act of [...new Set(occ.filter(o => o.act).map(o => o.act))]) {
      const ps = occ.filter(o => o.act === act), x0 = Math.min(...ps.map(p => p.x0)) - 3, y0 = Math.min(...ps.map(p => p.y0)) - 3, x1 = Math.max(...ps.map(p => p.x1)) + 3, y1 = Math.max(...ps.map(p => p.y1)) + 3, w = x1 - x0, h = y1 - y0;
      const m = new Uint8Array(w * h); for (const p of ps) { const pm = polyMask(p.poly, x0, y0, w, h); for (let i = 0; i < m.length; i++) if (pm[i]) m[i] = 1; }
      /* 平时：里面一圈亮金、外面一圈深棕（深浅两圈，亮的背景、暗的背景上都看得出来）；走近 / 该去的时候：两圈亮的 + 外面一圈橙金，一闪一闪 */
      const d1 = dilate(m, w, h), d2 = dilate(d1, w, h), d3 = dilate(d2, w, h), r1 = d1.map((v, i) => v && !m[i] ? 1 : 0), r2 = d2.map((v, i) => v && !d1[i] ? 1 : 0), r3 = d3.map((v, i) => v && !d2[i] ? 1 : 0);
      rings[act] = { x0, y0, w, h, base: Math.max(...ps.map(p => p.base)), idle: paint([[r2, '#3a2410'], [r1, '#ffd86a']], w, h), hot: paint([[r3, '#b85a1c'], [r2, '#ffb43a'], [r1, '#fff4c8']], w, h) };
    }
    return { occ, rings };
  }
  IV.prepare = function () {
    const out = {};
    for (const [key, bigK, smallK] of [['day', 'isleL', 'island'], ['night', 'nightL', 'night']]) {
      const lay = G.IsleLayout[key], big = G.SPR[bigK], small = G.SPR[smallK], Z = big.z;
      out[key] = { Z, W: big.w, H: big.h, big: { ...buildSet(big.bgImg, lay, 1), spr: big, bg: big.bgImg, m: Z, small: false }, small: { ...buildSet(small.bgImg, lay, 1 / Z), spr: small, bg: small.bgImg, m: 1, small: true } };
      // 能走的范围、挡路的：换成逻辑坐标（640×360 那套）
      const L = p => p.map(([x, y]) => [x / Z, y / Z]);
      out[key].walk = L(lay.walk); out[key].block = lay.block.map(L);
    }
    for (const k in out) for (const v of ['big', 'small']) { const S = out[k][v]; S.sil = {}; for (const n of ['capA', 'capB']) S.sil[n] = silhouette(S.spr[n].img); }
    IV.sets = out;
    return out;
  };
  function silhouette(img) { const c = mk(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#ffe2a8'; g.fillRect(0, 0, c.width, c.height); return c; }

  /* ---------- 能不能走：在能走的范围里，不在挡路的东西上 ---------- */
  IV.okFn = function (key, extra) { return (x, y) => { const S = IV.sets[key]; if (!U.pointInPoly(x, y, S.walk)) return false; for (const b of S.block) if (U.pointInPoly(x, y, b)) return false; return !(extra && extra(x, y)); }; };

  /* ---------- 镜头：走动时 zoom = 1（大图一像素 = 画面一像素）；按住 Tab 拉到全岛 ---------- */
  IV.camera = function (key) { const S = IV.sets[key]; const c = new G.Cam({ w: S.W, h: S.H }); c.zMin = Math.min(G.Game.W / S.W, G.Game.H / S.H); c.zt = 0; return c; };
  /* zt：0 = 走动镜头，1 = 全岛；ease 过去，0.3 秒拉完 */
  IV.stepCam = function (cam, dt, wantOut, tx, ty, snap) {
    cam.zt = U.approach(cam.zt, wantOut ? 1 : 0, dt / 0.3);
    const e = U.ease(cam.zt); cam.zoom = 1 + (cam.zMin - 1) * e;
    if (snap) cam.snapTo(tx, ty); else cam.follow(tx, ty, dt);
  };
  /* 这一帧用哪套图：全岛那一刻用 640 宽的（清清楚楚），拉远拉近的途中用大图（最近邻） */
  IV.setFor = function (key, cam) { const S = IV.sets[key]; return cam.zt >= 1 ? S.small : S.big; };

  /* ---------- 画：背景 → （遮挡和人按 y 排序）→ 被挡住的船长剪影 ---------- */
  /* ents：[{ y: 逻辑 y（脚）, draw(g, V), box?: [x0,y0,x1,y1]（画的单位）, sil?: 剪影图名 }]。
     o.hot：要描粗边的交互点 id 集合；o.acts：哪些交互点要描边（null = 全部）；o.dark：要盖暗色的遮挡 id；o.extra：{遮挡 id: (g,V)=>{}} 画在这块遮挡上面的东西（摊位上的货） */
  IV.render = function (g, key, cam, ents, o = {}) {
    const S = IV.sets[key], V = IV.setFor(key, cam), Z = S.Z, m = V.m;
    cam.begin(g); if (V.small) { g.save(); g.scale(Z, Z); Px.u *= Z; }
    g.imageSmoothingEnabled = false; // 拉远拉近那 0.3 秒也用最近邻（'high' 平滑每帧重采样整张大图，无头里一帧 90 毫秒；双线性也要 30 毫秒）
    /* 背景只取画面里那一块来画 */
    { const sc = V.small ? 1 / Z : 1, l = Math.max(0, Math.floor((-cam.tx / cam.zoom) * sc) - 2), t = Math.max(0, Math.floor((-cam.ty / cam.zoom) * sc) - 2), w = Math.min(V.bg.width - l, Math.ceil(G.Game.W / cam.zoom * sc) + 4), h = Math.min(V.bg.height - t, Math.ceil(G.Game.H / cam.zoom * sc) + 4);
      if (w > 0 && h > 0) g.drawImage(V.bg, l, t, w, h, l, t, w, h); }
    if (o.under) o.under(g, V);
    const list = [];
    for (const oc of V.occ) list.push({ k: oc.base, oc });
    for (const act in V.rings) if (!o.acts || o.acts.has(act)) list.push({ k: V.rings[act].base + 0.01, ring: V.rings[act], act });
    for (const e of ents) list.push({ k: e.y * m + (e.dk || 0), e });
    list.sort((a, b) => a.k - b.k);
    const t = G.Game.t, pulse = 0.5 + 0.5 * Math.sin(t * 5.5), drawn = [];
    for (const it of list) {
      if (it.oc) {
        /* 遮挡就是背景本身的一块：只有它后面已经画了人（框重叠）、或者要盖暗色 / 上面要摆货时才需要重画，别的时候画了也一样，省掉 */
        const oc = it.oc, dk = o.dark && o.dark.has(oc.id), ex = o.extra && o.extra[oc.id];
        if (!dk && !ex && !drawn.some(b => b[2] > oc.x0 && b[0] < oc.x1 && b[3] > oc.y0 && b[1] < oc.y1)) continue;
        if (!cam.sees(oc.x0 * (V.small ? Z : 1), oc.y0 * (V.small ? Z : 1), oc.x1 * (V.small ? Z : 1), oc.y1 * (V.small ? Z : 1))) continue;
        g.drawImage(dk ? oc.dark : oc.cut, oc.x0, oc.y0); if (ex) ex(g, V); continue;
      }
      else if (it.ring) {
        const r = it.ring, hot = o.hot && o.hot.has(it.act), sc2 = V.small ? Z : 1; if (!cam.sees(r.x0 * sc2, r.y0 * sc2, (r.x0 + r.w) * sc2, (r.y0 + r.h) * sc2)) continue;
        g.globalAlpha = hot ? 0.7 + 0.3 * pulse : 0.72 + 0.12 * Math.sin(t * 2.2); g.drawImage(hot ? r.hot : r.idle, r.x0, r.y0); g.globalAlpha = 1;
      }
      else { const bx = it.e.draw(g, V); drawn.push(Array.isArray(bx) ? bx : it.e.box || [-1e9, -1e9, 1e9, 1e9]); } // draw 返回画到的框（人、船、货箱），后面的遮挡只在框重叠时重画
    }
    /* 被挡住的船长：只在挡住他的那几块遮挡里，画一个淡淡的剪影 */
    for (const it of list) {
      const e = it.e; if (!e || !e.sil || !e.box) continue;
      const [bx0, by0, bx1, by1] = e.box, cover = list.filter(q => q.oc && q.k > it.k && q.oc.x1 > bx0 && q.oc.x0 < bx1 && q.oc.y1 > by0 && q.oc.y0 < by1);
      if (!cover.length) continue;
      g.save(); g.beginPath(); for (const q of cover) q.oc.poly.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.clip();
      g.globalAlpha = 0.3; e.sil(g, V); g.restore();
    }
    if (V.small) { g.restore(); Px.u /= Z; }
    g.imageSmoothingEnabled = false;
    cam.end(g);
  };

  /* ---------- 小工具：按这套图画人（走路一颠一颠、转身翻转、脚下影子） ---------- */
  IV.walker = function (g, V, w, img, f, o = {}) {
    const m = V.m, step = w.moving ? (Math.floor(f / 3) % 2) : 0, x = w.x * m - img.width / 2, y = w.y * m - img.height - step * Math.max(1, Math.round(m));
    A.oval(g, w.x * m, w.y * m, img.width * 0.42, 2 * m, 'rgba(20,12,10,0.35)');
    A.drawImg(g, img, x, y, w.face < 0);
    if (o.carry && o.carry.length) o.carry.forEach((c, i) => { const ci = o.crates[c] || o.crates.mat; g.drawImage(ci.img, Px.s(w.x * m - ci.w / 2 + (i - (o.carry.length - 1) / 2) * (ci.w - 2)), Px.s(y - ci.h - 1 - i * 2 * m)); });
    return [x, y - (o.carry && o.carry.length ? 20 * m : 0), x + img.width, w.y * m];
  };
  /* 剪影：和 walker 同一个位置 */
  IV.walkerSil = function (g, V, w, sil, f) { const m = V.m, step = w.moving ? (Math.floor(f / 3) % 2) : 0, x = w.x * m - sil.width / 2, y = w.y * m - sil.height - step * Math.max(1, Math.round(m)); A.drawImg(g, sil, x, y, w.face < 0); };

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
