/* 共用的渲染和镜头（让画面顺）。
   以前：所有像素画先画在 640×360 的小缓冲上再整数放大，位置一律取整到这个像素格。4K 画布上一个格子是 6 个物理像素，
   镜头和船每帧要么不动、要么一下跳 6 或 12 个物理像素（帧率是稳的 60，看起来却一顿一顿的）。
   现在：「顺滑」的场景（scene.smooth = true）直接画在全分辨率画布上，坐标还是 640×360 的基准坐标，但位置只对齐到物理像素：
   零件的像素格照样整数放大、清清楚楚，挪动却是一个物理像素一个物理像素地走。
   - G.Px.s(v)：把一个坐标对齐到物理像素（代替以前的 Math.round）。
   - G.Cam：跟人的镜头（平滑跟随、不出界、可以拉远拉近），对齐到物理像素。 */
(function (G) {
  'use strict';
  const U = G.U;
  /* k：这一帧一个基准像素 = 几个物理像素（旧的小缓冲里是 1）；u：当前坐标系里一个单位 = 几个物理像素（镜头缩放以后会变） */
  const Px = G.Px = { k: 1, u: 1 };
  Px.s = v => Math.round(v * Px.u) / Px.u;
  Px.set = (k) => { Px.k = k; Px.u = k; };

  /* 镜头：世界坐标（单位随场景定）→ 屏幕基准坐标（640×360）。zoom = 一个世界单位占几个基准像素。
     中心 cx, cy 跟着目标走（指数平滑，和帧率无关），画面不出世界的边；世界比画面小时居中。 */
  class Cam {
    constructor({ w, h, x = w / 2, y = h / 2, zoom = 1 }) { this.W = w; this.H = h; this.cx = x; this.cy = y; this.zoom = zoom; this.tx = 0; this.ty = 0; }
    get hw() { return G.Game.W / 2 / this.zoom; }
    get hh() { return G.Game.H / 2 / this.zoom; }
    clamp() {
      const hw = this.hw, hh = this.hh;
      this.cx = this.W > hw * 2 ? U.clamp(this.cx, hw, this.W - hw) : this.W / 2;
      this.cy = this.H > hh * 2 ? U.clamp(this.cy, hh, this.H - hh) : this.H / 2;
    }
    snapTo(x, y) { this.cx = x; this.cy = y; this.clamp(); }
    /* rate：每秒追上多少（越大越紧）。0.1 秒内追上大半，停下时不会一顿 */
    follow(x, y, dt, rate = 9) { const a = 1 - Math.exp(-rate * dt); this.cx += (x - this.cx) * a; this.cy += (y - this.cy) * a; this.clamp(); }
    /* 开始画世界：平移对齐到物理像素，再按 zoom 缩放 */
    begin(g) {
      const z = this.zoom, k = Px.k;
      this.tx = Math.round((G.Game.W / 2 - this.cx * z) * k) / k; this.ty = Math.round((G.Game.H / 2 - this.cy * z) * k) / k;
      g.save(); g.translate(this.tx, this.ty); g.scale(z, z); Px.u = k * z;
    }
    end(g) { g.restore(); Px.u = Px.k; }
    /* 世界坐标 → 屏幕基准坐标（界面文字、提示、气泡用） */
    sx(x) { return x * this.zoom + this.tx; }
    sy(y) { return y * this.zoom + this.ty; }
    toScreen(x, y) { return [this.sx(x), this.sy(y)]; }
    /* 这一块（世界坐标）在不在画面里 */
    sees(x0, y0, x1, y1, m = 0) { const l = (0 - this.tx) / this.zoom, t = (0 - this.ty) / this.zoom, r = l + G.Game.W / this.zoom, b = t + G.Game.H / this.zoom; return x1 >= l - m && x0 <= r + m && y1 >= t - m && y0 <= b + m; }
  }
  G.Cam = Cam;

  /* 像素风的椭圆影子：一行一行按世界像素画（直接在高分辨率画布上画 ellipse 会是圆滑的矢量边，和像素画不搭） */
  G.Art = G.Art || {};
  G.Art.oval = function (g, cx, cy, rx, ry, col) {
    g.fillStyle = col; rx = Math.max(1, rx); ry = Math.max(0.5, ry);
    const x0 = Px.s(cx), y0 = Px.s(cy), n = Math.max(1, Math.round(ry));
    for (let j = -n; j < n; j++) { const yy = (j + 0.5) / n, w = Math.round(rx * Math.sqrt(Math.max(0, 1 - yy * yy))); if (w <= 0) continue; g.fillRect(x0 - w, y0 + j, w * 2, 1); }
  };
})(window.G);
