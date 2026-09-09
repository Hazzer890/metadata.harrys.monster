// Ambient wave-grid canvas — pointer-reactive flowing lines.
// Vanilla port of React Bits' <Waves/> (Perlin-noise line field), reshaped to
// match this site: fixed full-viewport #field canvas, theme-aware line colour,
// DPR-crisp, tab-hidden pause. Reduced motion → no animation (the CSS body
// gradient + blobs show through the transparent canvas).
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var canvas = document.getElementById('field');
  if (!canvas || reduceMotion) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* ---- Perlin noise (from React Bits Waves) ---- */
  function Grad(x, y, z) { this.x = x; this.y = y; this.z = z; }
  Grad.prototype.dot2 = function (x, y) { return this.x * x + this.y * y; };

  function Noise(seed) {
    this.grad3 = [
      new Grad(1, 1, 0), new Grad(-1, 1, 0), new Grad(1, -1, 0), new Grad(-1, -1, 0),
      new Grad(1, 0, 1), new Grad(-1, 0, 1), new Grad(1, 0, -1), new Grad(-1, 0, -1),
      new Grad(0, 1, 1), new Grad(0, -1, 1), new Grad(0, 1, -1), new Grad(0, -1, -1)
    ];
    this.p = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
    this.perm = new Array(512);
    this.gradP = new Array(512);
    var s = seed;
    if (s > 0 && s < 1) s *= 65536;
    s = Math.floor(s);
    if (s < 256) s |= s << 8;
    for (var i = 0; i < 256; i++) {
      var v = (i & 1) ? (this.p[i] ^ (s & 255)) : (this.p[i] ^ ((s >> 8) & 255));
      this.perm[i] = this.perm[i + 256] = v;
      this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12];
    }
  }
  Noise.prototype.fade = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };
  Noise.prototype.lerp = function (a, b, t) { return (1 - t) * a + t * b; };
  Noise.prototype.perlin2 = function (x, y) {
    var X = Math.floor(x), Y = Math.floor(y);
    x -= X; y -= Y; X &= 255; Y &= 255;
    var n00 = this.gradP[X + this.perm[Y]].dot2(x, y);
    var n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1);
    var n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y);
    var n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1);
    var u = this.fade(x);
    return this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), this.fade(y));
  };
  var noise = new Noise(Math.random());

  /* ---- Line colour ---- */
  var lineColor = 'rgba(59, 91, 219, 0.24)';

  /* ---- Tuned wave params (React Bits' "nice" preset) ---- */
  var cfg = {
    waveSpeedX: 0.01, waveSpeedY: 0.045, waveAmpX: 25, waveAmpY: 40,
    friction: 0.59, tension: 0.005, maxCursorMove: 110, xGap: 10, yGap: 26
  };

  var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var lines = [];
  var mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, v: 0, vs: 0, a: 0, set: false };

  function setSize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setLines() {
    lines = [];
    var oWidth = W + 200, oHeight = H + 30;
    var totalLines = Math.ceil(oWidth / cfg.xGap);
    var totalPoints = Math.ceil(oHeight / cfg.yGap);
    var xStart = (W - cfg.xGap * totalLines) / 2;
    var yStart = (H - cfg.yGap * totalPoints) / 2;
    for (var i = 0; i <= totalLines; i++) {
      var pts = [];
      for (var j = 0; j <= totalPoints; j++) {
        pts.push({
          x: xStart + cfg.xGap * i,
          y: yStart + cfg.yGap * j,
          wave: { x: 0, y: 0 },
          cursor: { x: 0, y: 0, vx: 0, vy: 0 }
        });
      }
      lines.push(pts);
    }
  }

  function movePoints(time) {
    for (var li = 0; li < lines.length; li++) {
      var pts = lines[li];
      for (var pi = 0; pi < pts.length; pi++) {
        var p = pts[pi];
        var move = noise.perlin2(
          (p.x + time * cfg.waveSpeedX) * 0.002,
          (p.y + time * cfg.waveSpeedY) * 0.0015
        ) * 12;
        p.wave.x = Math.cos(move) * cfg.waveAmpX;
        p.wave.y = Math.sin(move) * cfg.waveAmpY;

        var dx = p.x - mouse.sx, dy = p.y - mouse.sy;
        var dist = Math.hypot(dx, dy), l = Math.max(175, mouse.vs);
        if (dist < l) {
          var sp = 1 - dist / l;
          var f = Math.cos(dist * 0.001) * sp;
          p.cursor.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00065;
          p.cursor.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00065;
        }

        p.cursor.vx += (0 - p.cursor.x) * cfg.tension;
        p.cursor.vy += (0 - p.cursor.y) * cfg.tension;
        p.cursor.vx *= cfg.friction;
        p.cursor.vy *= cfg.friction;
        p.cursor.x += p.cursor.vx * 2;
        p.cursor.y += p.cursor.vy * 2;
        p.cursor.x = Math.min(cfg.maxCursorMove, Math.max(-cfg.maxCursorMove, p.cursor.x));
        p.cursor.y = Math.min(cfg.maxCursorMove, Math.max(-cfg.maxCursorMove, p.cursor.y));
      }
    }
  }

  function moved(p, withCursor) {
    var x = p.x + p.wave.x + (withCursor ? p.cursor.x : 0);
    var y = p.y + p.wave.y + (withCursor ? p.cursor.y : 0);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }

  function drawLines() {
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    for (var li = 0; li < lines.length; li++) {
      var points = lines[li];
      var p1 = moved(points[0], false);
      ctx.moveTo(p1.x, p1.y);
      for (var idx = 0; idx < points.length; idx++) {
        var isLast = idx === points.length - 1;
        p1 = moved(points[idx], !isLast);
        var p2 = moved(points[idx + 1] || points[points.length - 1], !isLast);
        ctx.lineTo(p1.x, p1.y);
        if (isLast) ctx.moveTo(p2.x, p2.y);
      }
    }
    ctx.stroke();
  }

  function tick(t) {
    mouse.sx += (mouse.x - mouse.sx) * 0.1;
    mouse.sy += (mouse.y - mouse.sy) * 0.1;
    var dx = mouse.x - mouse.lx, dy = mouse.y - mouse.ly;
    var d = Math.hypot(dx, dy);
    mouse.v = d;
    mouse.vs += (d - mouse.vs) * 0.1;
    mouse.vs = Math.min(100, mouse.vs);
    mouse.lx = mouse.x;
    mouse.ly = mouse.y;
    mouse.a = Math.atan2(dy, dx);

    movePoints(t);
    drawLines();
    raf = requestAnimationFrame(tick);
  }

  function updateMouse(x, y) {
    mouse.x = x;
    mouse.y = y;
    if (!mouse.set) {
      mouse.sx = mouse.x; mouse.sy = mouse.y;
      mouse.lx = mouse.x; mouse.ly = mouse.y;
      mouse.set = true;
    }
  }

  var raf = null;
  function start() { if (!raf) raf = requestAnimationFrame(tick); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  window.addEventListener('mousemove', function (e) { updateMouse(e.clientX, e.clientY); });
  window.addEventListener('touchmove', function (e) {
    var touch = e.touches[0];
    updateMouse(touch.clientX, touch.clientY);
  }, { passive: true });

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { setSize(); setLines(); }, 150);
  });

  setSize();
  setLines();
  start();
})();
