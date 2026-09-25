/* Dodge 'Em Beyond - render.js
 * DE.Renderer: the glyph canvas renderer and all visual effects.
 * Contract: docs/ARCHITECTURE.md. Reads game.state, never writes it.
 *
 * Coordinate mapping (owned here):
 *   arena  : px = cx + x * L, py = cy + y * L   (lane units, centre 0,0)
 *   road   : px = x * W,      py = laneY(laneIndex)
 */
(function () {
  'use strict';

  var DE = (window.DE = window.DE || {});

  var RAMP = ' .·:-=+*#%▒▓█';
  var BURST_CHARS = RAMP.slice(6); // '+*#%▒▓█'
  var DIRS = ['up', 'right', 'down', 'left'];
  var ARROW = { up: '▲', down: '▼', left: '◀', right: '▶' };
  var FONT_STACK = '"JetBrains Mono", ui-monospace, Consolas, monospace';
  var MAX_CELLS = 7000;
  var MAX_PARTS = 900;
  var TAU = Math.PI * 2;

  /* ---------- pixel sprites (ported from the prototype) ---------- */
  var TOP = ['..XX..', '.XXXX.', 'XoXXoX', 'XXXXXX', 'XXXXXX', 'X.XX.X'];
  function rot(g) {
    var out = [];
    for (var r = 0; r < g.length; r++) {
      var row = '';
      for (var c = 0; c < g.length; c++) row += g[g.length - 1 - c][r];
      out.push(row);
    }
    return out;
  }
  var ROTS = [TOP]; // index = facing (0 up, 1 right, 2 down, 3 left); rot() is clockwise
  for (var ri = 1; ri < 4; ri++) ROTS.push(rot(ROTS[ri - 1]));
  var SIDE_R = ['..XXXX..', '.XXoXXX.', 'XXXXXXXX', 'XXXXXXXX', '.O....O.'];
  var SIDE_L = SIDE_R.map(function (r) { return r.split('').reverse().join(''); });

  /* ---------- colour keys: quantised hsl, cached strings ---------- */
  // key = (s * 101 + l) * 120 + hue/3
  function ck(h, s, l) {
    h = h % 360;
    if (h < 0) h += 360;
    var lq = l < 0 ? 0 : l > 100 ? 100 : l | 0;
    return (s * 101 + lq) * 120 + ((h / 3) | 0);
  }
  var styleCache = new Map();
  function styleOf(key) {
    var s = styleCache.get(key);
    if (s === undefined) {
      var hq = key % 120, rest = (key / 120) | 0, lq = rest % 101, sat = (rest / 101) | 0;
      s = 'hsl(' + hq * 3 + ',' + sat + '%,' + lq + '%)';
      styleCache.set(key, s);
    }
    return s;
  }
  var WHITE_KEY = ck(0, 0, 100);
  // Negative keys are fixed (non-hsl) colours, resolved lazily.
  var DOT_KEY = -1, DOT_HI_KEY = -2;
  function fixedStyle(key) {
    return key === DOT_HI_KEY ? '#FFF6C8' : (DE.COLORS && DE.COLORS.dot) || '#FFD23F';
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ===================== Renderer ===================== */
  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = null;
    this.unsub = [];
    this.parts = [];
    this.floats = [];
    this.buckets = new Map();
    this.active = [];
    this.spriteCache = {};
    this.reduce = false;
    var self = this;
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduce = mq.matches;
      var onChange = function (e) { self.reduce = e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) { /* ignore */ }
    try {
      if (document.fonts && document.fonts.load) {
        document.fonts.load('12px "JetBrains Mono"');
        document.fonts.load('800 12px "JetBrains Mono"');
      }
    } catch (e2) { /* ignore */ }
    this.resize(canvas.clientWidth || 300, canvas.clientHeight || 150);
  }

  /* ---------- layout ---------- */
  Renderer.prototype.resize = function (cssW, cssH) {
    var W = (this.W = Math.max(1, cssW || 1));
    var H = (this.H = Math.max(1, cssH || 1));
    var small = Math.min(W, H) < 700 || W * H < 600000;
    var dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    this.canvas.width = Math.max(1, Math.round(W * dpr));
    this.canvas.height = Math.max(1, Math.round(H * dpr));

    // cell size: bigger on phones, total cells <= ~MAX_CELLS
    var aspect = 1.625;
    var cw = W < 600 ? 7 : W > 1300 ? 9 : 8;
    cw = Math.max(cw, Math.sqrt((W * H) / (MAX_CELLS * aspect)));
    cw = Math.ceil(cw * 2) / 2;
    var chh = cw * aspect;
    while (Math.ceil(W / cw) * Math.ceil(H / chh) > MAX_CELLS) { cw += 0.5; chh = cw * aspect; }
    this.cw = cw;
    this.chh = chh;
    this.cols = Math.ceil(W / cw);
    this.rows = Math.ceil(H / chh);
    this.fontPx = cw * 1.44;

    // arena square
    var portrait = H > W * 1.1;
    var S = Math.max(40, Math.min(W * (portrait ? 0.9 : 0.94), (H - 56) * 0.94));
    this.HH = S / 2;
    this.L = S / 10;
    this.cx = W / 2;
    this.cy = H / 2 + Math.min(24, H * 0.03);

    // road
    this.laneGap = Math.max(chh * 3.4, Math.min(H * 0.065, W * 0.14));
    this.roadY0 = H * 0.56;

    // fonts
    this.fGlyph = this.fontPx + 'px ' + FONT_STACK;
    this.fDot = '800 ' + (this.fontPx * 2.7).toFixed(1) + 'px ' + FONT_STACK;
    this.fRoadDot = '800 ' + (this.fontPx * 2.7).toFixed(1) + 'px ' + FONT_STACK;
    this.hintPx = Math.max(14, this.L * 0.55);
    this.fHint = '800 ' + this.hintPx.toFixed(1) + 'px ' + FONT_STACK;
    this.exitPx = Math.max(13, this.L * 0.5);
    this.fExit = '800 ' + this.exitPx.toFixed(1) + 'px ' + FONT_STACK;
    this.fFloat = '800 ' + Math.max(12, this.fontPx * 1.3).toFixed(1) + 'px ' + FONT_STACK;
    this.labelPx = Math.max(14, this.fontPx * 1.8);

    this.spriteCache = {};
    this.buildGrid();
  };

  Renderer.prototype.laneY = function (i) {
    return this.roadY0 + i * this.laneGap;
  };

  // Precompute the static arena classification of every cell.
  Renderer.prototype.buildGrid = function () {
    var cols = this.cols, rows = this.rows, n = cols * rows;
    var cw = this.cw, chh = this.chh, cx = this.cx, cy = this.cy, HH = this.HH, L = this.L;
    var type = (this.gType = new Int8Array(n));   // -1 none, 0..4 wall k, 5 island fill
    var side = (this.gSide = new Uint8Array(n));
    var inside = (this.gIn = new Uint8Array(n));
    var sa = (this.gSin = new Float32Array(n));
    var ca = (this.gCos = new Float32Array(n));
    var hv = (this.gHash = new Float32Array(n));
    var thrX = cw * 0.55, thrY = chh * 0.55, gapH = L * (DE.GAP_HALF || 0.75);
    var hash = DE.hash;
    for (var r = 0; r < rows; r++) {
      var y = (r + 0.5) * chh - cy, ay = Math.abs(y);
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        var x = (c + 0.5) * cw - cx, ax = Math.abs(x);
        var d = Math.max(ax, ay), vert = ax >= ay;
        var kf = (HH - d) / L, k = Math.round(kf);
        var h = hash(c, r);
        hv[i] = h;
        type[i] = -1;
        side[i] = vert ? (x > 0 ? 1 : 3) : (y < 0 ? 0 : 2);
        inside[i] = d < HH ? 1 : 0;
        var ang = Math.atan2(y, x) + Math.PI;
        sa[i] = Math.sin(ang);
        ca[i] = Math.cos(ang);
        if (k >= 0 && k <= 4 && Math.abs(kf - k) * L < (vert ? thrX : thrY)) {
          var along = vert ? ay : ax;
          var isGap = k >= 1 && k <= 3 && along < gapH;
          if (!isGap) type[i] = k;
        } else if (d < HH - 4 * L - thrY) {
          if (h < 0.5) type[i] = 5;
        }
      }
    }
    this.buildCloverGrid();
  };

  // Cloverleaf: four loops (walls at half-size 2.5 / 1.5 / 0.5 lanes around each centre).
  // cType: -1 none, 0 outer wall, 1 lane divider, 2 island edge, 5 island fill.
  // cSide/cLoop mark outer-boundary cells (for the breaking wall); cAlong = 0 at a side's midpoint, 1 at its corner.
  Renderer.prototype.buildCloverGrid = function () {
    var cols = this.cols, rows = this.rows, n = cols * rows;
    var cw = this.cw, chh = this.chh, cx = this.cx, cy = this.cy, L = this.L;
    var type = (this.cType = new Int8Array(n));
    var cside = (this.cSide = new Uint8Array(n));
    var cloop = (this.cLoop = new Uint8Array(n));
    var along = (this.cAlong = new Float32Array(n));
    var CL = DE.CLOVER, thrX = cw * 0.55, thrY = chh * 0.55, gapH = L * (DE.GAP_HALF || 0.75);
    if (!CL) return;
    for (var r = 0; r < rows; r++) {
      var wy = ((r + 0.5) * chh - cy) / L;
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c, wx = ((c + 0.5) * cw - cx) / L;
        type[i] = -1;
        cside[i] = 255;
        var loop = (wx >= 0 ? 1 : 0) + (wy >= 0 ? 2 : 0), ctr = CL.centers[loop];
        cloop[i] = loop;
        var lx = wx - ctr[0], ly = wy - ctr[1], ax = Math.abs(lx), ay = Math.abs(ly);
        var d = Math.max(ax, ay), vert = ax >= ay, sd = vert ? (lx > 0 ? 1 : 3) : (ly < 0 ? 0 : 2);
        var thr = (vert ? thrX : thrY) / L, al = vert ? ay : ax;
        along[i] = al / 2.5;
        var walls = [2.5, 1.5, 0.5];
        for (var k = 0; k < 3; k++) {
          if (Math.abs(d - walls[k]) >= thr) continue;
          var gap = false;
          if (k === 1) gap = al * L < gapH;                               // lane change gaps
          if (k === 0 && CL.NEIGH[loop][sd]) gap = al * L < gapH;          // shared wall: hop to the next loop
          if (!gap) {
            type[i] = k;
            if (k === 0 && !CL.NEIGH[loop][sd]) cside[i] = sd;
          }
          break;
        }
        if (type[i] === -1 && d < 0.5 - thr && DE.hash(c, r) < 0.5) type[i] = 5;
      }
    }
  };

  /* ---------- batched glyph drawing ---------- */
  Renderer.prototype.put = function (key, ch, x, y) {
    var b = this.buckets.get(key);
    if (b === undefined) {
      b = { style: key < 0 ? fixedStyle(key) : styleOf(key), x: [], y: [], c: [], n: 0 };
      this.buckets.set(key, b);
    }
    if (b.n === 0) this.active.push(b);
    var n = b.n;
    b.x[n] = x;
    b.y[n] = y;
    b.c[n] = ch;
    b.n = n + 1;
  };

  Renderer.prototype.flush = function () {
    var ctx = this.ctx, act = this.active;
    for (var i = 0; i < act.length; i++) {
      var b = act[i];
      ctx.fillStyle = b.style;
      var xs = b.x, ys = b.y, cs = b.c;
      for (var j = 0, n = b.n; j < n; j++) ctx.fillText(cs[j], xs[j], ys[j]);
      b.n = 0;
    }
    act.length = 0;
    if (this.buckets.size > 6000) this.buckets.clear(); // safety valve
  };

  /* ---------- sprites (pre-rendered, one drawImage + optional glow) ---------- */
  Renderer.prototype.getSprite = function (id, grid, px, body, dark) {
    var key = id + '|' + px.toFixed(2) + '|' + body;
    var cv = this.spriteCache[key];
    if (cv) return cv;
    var dpr = this.dpr;
    var gw = grid[0].length, gh = grid.length;
    cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(gw * px * dpr));
    cv.height = Math.max(1, Math.ceil(gh * px * dpr));
    var c2 = cv.getContext('2d');
    for (var r = 0; r < gh; r++) {
      for (var c = 0; c < gw; c++) {
        var ch = grid[r][c];
        if (ch === '.') continue;
        c2.fillStyle = ch === 'X' ? body : ch === 'w' ? '#FFF3B0' : dark;
        var x0 = Math.round(c * px * dpr), y0 = Math.round(r * px * dpr);
        var x1 = Math.round((c + 1) * px * dpr), y1 = Math.round((r + 1) * px * dpr);
        c2.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
    }
    cv._w = gw * px;
    cv._h = gh * px;
    this.spriteCache[key] = cv;
    return cv;
  };

  Renderer.prototype.sprite = function (id, grid, x, y, px, body, dark, glow, blur) {
    var cv = this.getSprite(id, grid, px, body, dark);
    var ctx = this.ctx, w = cv._w, h = cv._h;
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = (blur || 14) * this.dpr;
    }
    ctx.drawImage(cv, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    if (glow) ctx.shadowBlur = 0;
  };

  /* ---------- event wiring / effects ---------- */
  Renderer.prototype.attach = function (game) {
    for (var i = 0; i < this.unsub.length; i++) this.unsub[i]();
    this.unsub = [];
    this.game = game;
    if (!game || !game.events) return;
    var self = this, ev = game.events;
    this.unsub.push(ev.on('dot', function (p) {
      var q = self.toPx(p);
      self.burst(q[0], q[1], 5, 45, 60, '·+*');
    }));
    this.unsub.push(ev.on('crash', function (p) {
      var q = self.toPx(p);
      if (p && p.space === 'road') self.burst(q[0], q[1], 40, 320, 220);
      else self.burst(q[0], q[1], 46, 10, 240);
    }));
    this.unsub.push(ev.on('clear', function (p) {
      var list = (p && p.enemies) || [];
      for (var j = 0; j < list.length; j++) {
        var q = self.toPx({ space: 'arena', x: list[j].x, y: list[j].y });
        self.burst(q[0], q[1], 40, 320, 220);
      }
    }));
    this.unsub.push(ev.on('shatter', function (p) { self.shatter(p ? p.side : 0); }));
    this.unsub.push(ev.on('float', function (p) {
      if (!p) return;
      var q = self.toPx(p);
      // score pop-ups fly up and drift apart so several in a row (e.g. +10 +20 +30) stay readable
      var sc = clamp(self.L / 50, 0.7, 1.6), recent = 0;
      for (var k = 0; k < self.floats.length; k++) if (self.floats[k].life > 0.9) recent++;
      self.floats.push({
        x: q[0] + (recent % 3 - 1) * self.fontPx * 1.5, y: q[1] - self.fontPx * 1.2,
        vx: (Math.random() * 2 - 1) * 35 * sc + (p.space === 'road' ? 25 * sc : 0), vy: -(95 + Math.random() * 30) * sc,
        txt: String(p.text), col: p.color || DE.COLORS.dot, life: 1.3, max: 1.3
      });
    }));
    this.unsub.push(ev.on('roadStart', function () { self.parts.length = 0; }));
    this.unsub.push(ev.on('levelStart', function () { self.parts.length = 0; self.floats.length = 0; }));
    this.unsub.push(ev.on('levelComplete', function (p) { self.celebrate(p ? p.level : 1, p && p.final); }));
  };

  Renderer.prototype.toPx = function (p) {
    if (!p) return [this.W / 2, this.H / 2];
    if (p.space === 'road') return [(p.x || 0) * this.W, this.laneY(p.y || 0)];
    var cam = this.cam || { x: 0, y: 0 };
    return [this.cx + ((p.x || 0) - cam.x) * this.L, this.cy + ((p.y || 0) - cam.y) * this.L];
  };

  Renderer.prototype.burst = function (x, y, n, hue, spd, chars) {
    chars = chars || BURST_CHARS;
    var scale = clamp(this.L / 50, 0.6, 1.8);
    for (var i = 0; i < n && this.parts.length < MAX_PARTS; i++) {
      var a = Math.random() * TAU, v = (0.3 + Math.random()) * spd * scale;
      this.parts.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        ch: chars[(Math.random() * chars.length) | 0],
        key: ck(hue + Math.random() * 40, 95, 65),
        life: 0.5 + Math.random() * 0.8
      });
    }
  };

  Renderer.prototype.shatter = function (sideIdx) {
    var st = this.game && this.game.state;
    var cfg = (st && st.cfg) || { hue: 185, range: 90 };
    var vec = DE.EXIT_VEC[sideIdx] || [0, -1];
    var cloverA = st && st.arena && st.arena.layout === 'clover' && this.cType;
    var cols = this.cols, rows = this.rows, type = cloverA ? this.cType : this.gType, side = cloverA ? this.cSide : this.gSide;
    var exLoop = cloverA ? st.arena.exitLoop : -1, cLoopA = this.cLoop;
    var cw = this.cw, chh = this.chh;
    var scale = clamp(this.L / 50, 0.6, 1.8);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        if (type[i] !== 0 || side[i] !== sideIdx || (cloverA && cLoopA[i] !== exLoop)) continue;
        if (this.parts.length >= MAX_PARTS) return;
        var sp = (80 + Math.random() * 320) * scale;
        this.parts.push({
          x: (c + 0.5) * cw, y: (r + 0.5) * chh,
          vx: vec[0] * sp + (Math.random() - 0.5) * 160 * scale,
          vy: vec[1] * sp + (Math.random() - 0.5) * 160 * scale,
          ch: RAMP[8 + ((Math.random() * 5) | 0)],
          key: ck(cfg.hue + Math.random() * cfg.range, 95, 65),
          life: 1 + Math.random() * 1.4
        });
      }
    }
  };

  /* ---------- level complete celebration: balloons, confetti, streamers, banner ---------- */
  var CELE_COLORS = ['#FF3DA8', '#3DE0FF', '#FFD23F', '#FF8A3D', '#A6FF3D', '#8B5CFF'];
  var CELE_DUR = 3.2;
  Renderer.prototype.celebrate = function (level, final) {
    var W = this.W, H = this.H, s = clamp(Math.min(W, H) / 600, 0.6, 1.6);
    var few = this.reduce ? 0.4 : 1;
    var c = { t: 0, level: level, final: !!final, s: s, balloons: [], confetti: [], streamers: [] };
    if (final) few *= 1.6; // the finale gets more of everything
    var i, n = Math.round(14 * few);
    for (i = 0; i < n; i++) {
      c.balloons.push({
        x: W * (0.06 + 0.88 * (i + Math.random() * 0.8) / n), y: H + Math.random() * H * 0.45 + 30 * s,
        r: (18 + Math.random() * 14) * s, vy: -(110 + Math.random() * 90) * s,
        ph: Math.random() * TAU, col: CELE_COLORS[i % CELE_COLORS.length]
      });
    }
    n = Math.round(170 * few);
    for (i = 0; i < n; i++) {
      c.confetti.push({
        x: Math.random() * W, y: -Math.random() * H * 0.6 - 10,
        vx: (Math.random() - 0.5) * 60 * s, vy: (90 + Math.random() * 140) * s,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 10,
        w: (4 + Math.random() * 5) * s, h: (8 + Math.random() * 7) * s,
        col: CELE_COLORS[(Math.random() * CELE_COLORS.length) | 0]
      });
    }
    n = Math.round(9 * few);
    for (i = 0; i < n; i++) {
      c.streamers.push({
        x: W * (i + 0.5) / n + (Math.random() - 0.5) * 40 * s, y: -H * (0.2 + Math.random() * 0.5),
        vy: (120 + Math.random() * 80) * s, amp: (10 + Math.random() * 14) * s, ph: Math.random() * TAU,
        len: H * (0.28 + Math.random() * 0.2), col: CELE_COLORS[(i + 2) % CELE_COLORS.length]
      });
    }
    this.cele = c;
  };

  Renderer.prototype.updateCelebration = function (dt) {
    var c = this.cele;
    if (!c) return;
    c.t += dt;
    if (c.t > CELE_DUR) { this.cele = null; return; }
    var i;
    for (i = 0; i < c.balloons.length; i++) { var b = c.balloons[i]; b.y += b.vy * dt; b.x += Math.sin(c.t * 2 + b.ph) * 12 * c.s * dt; }
    for (i = 0; i < c.confetti.length; i++) {
      var f = c.confetti[i];
      f.x += (f.vx + Math.sin(c.t * 3 + f.rot) * 30 * c.s) * dt; f.y += f.vy * dt; f.rot += f.vr * dt;
    }
    for (i = 0; i < c.streamers.length; i++) c.streamers[i].y += c.streamers[i].vy * dt;
  };

  Renderer.prototype.drawCelebration = function () {
    var c = this.cele;
    if (!c) return;
    var ctx = this.ctx, dpr = this.dpr, W = this.W, H = this.H, s = c.s, t = c.t, i;
    var alpha = clamp((CELE_DUR - t) / 0.6, 0, 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // soft dim so the banner pops
    ctx.globalAlpha = 0.28 * alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    // streamers: wavy ribbons falling from the top
    ctx.lineCap = 'round';
    for (i = 0; i < c.streamers.length; i++) {
      var st = c.streamers[i];
      ctx.strokeStyle = st.col;
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      for (var k = 0; k <= 24; k++) {
        var yy = st.y + (k / 24) * st.len, xx = st.x + Math.sin(k * 0.55 + t * 5 + st.ph) * st.amp;
        if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    // confetti
    for (i = 0; i < c.confetti.length; i++) {
      var f = c.confetti[i];
      if (f.y < -20 || f.y > H + 20) continue;
      var cs = Math.cos(f.rot), sn = Math.sin(f.rot);
      ctx.setTransform(cs * dpr, sn * dpr, -sn * dpr * Math.abs(Math.cos(t * 4 + f.rot)), cs * dpr * Math.abs(Math.cos(t * 4 + f.rot)), f.x * dpr, f.y * dpr);
      ctx.fillStyle = f.col;
      ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // balloons: body, shine, knot, string
    for (i = 0; i < c.balloons.length; i++) {
      var b = c.balloons[i];
      if (b.y < -b.r * 4) continue;
      ctx.strokeStyle = 'rgba(238,234,246,.55)';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.r * 1.25);
      ctx.quadraticCurveTo(b.x + Math.sin(t * 3 + b.ph) * b.r * 0.6, b.y + b.r * 2.2, b.x, b.y + b.r * 3.2);
      ctx.stroke();
      ctx.fillStyle = b.col;
      ctx.beginPath();
      ctx.moveTo(b.x - b.r * 0.18, b.y + b.r * 1.32);
      ctx.lineTo(b.x + b.r * 0.18, b.y + b.r * 1.32);
      ctx.lineTo(b.x, b.y + b.r * 1.12);
      ctx.fill();
      ctx.beginPath();
      if (ctx.ellipse) ctx.ellipse(b.x, b.y, b.r, b.r * 1.2, 0, 0, TAU);
      else ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath();
      if (ctx.ellipse) ctx.ellipse(b.x - b.r * 0.38, b.y - b.r * 0.45, b.r * 0.2, b.r * 0.32, -0.5, 0, TAU);
      else ctx.arc(b.x - b.r * 0.38, b.y - b.r * 0.45, b.r * 0.22, 0, TAU);
      ctx.fill();
    }
    // banner: bounces in, multicolour, glowing
    var pop = t < 0.45 ? 1 + 0.35 * Math.sin((t / 0.45) * Math.PI) * (1 - t / 0.45) : 1;
    var inS = clamp(t / 0.25, 0, 1);
    var fs = clamp(W / 11, 22, 72);
    ctx.translate(W / 2, H * 0.4);
    ctx.scale(pop * inS, pop * inS);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + fs.toFixed(1) + 'px "Rubik Mono One", "Arial Black", Impact, sans-serif';
    var title = c.final ? 'YOU MADE IT OUT!' : 'LEVEL COMPLETE!';
    var tw = ctx.measureText(title).width;
    if (tw > W * 0.92) { var k2 = (W * 0.92) / tw; ctx.scale(k2, k2); }
    var g = ctx.createLinearGradient(-tw / 2, 0, tw / 2, 0);
    g.addColorStop(0, '#3DE0FF'); g.addColorStop(0.35, '#8B5CFF'); g.addColorStop(0.65, '#FF3DA8'); g.addColorStop(1, '#FFD23F');
    ctx.shadowColor = '#FF3DA8';
    ctx.shadowBlur = 24 * dpr;
    ctx.fillStyle = g;
    ctx.fillText(title, 0, 0);
    ctx.shadowBlur = 0;
    ctx.font = '800 ' + (fs * 0.32).toFixed(1) + 'px ' + FONT_STACK;
    ctx.fillStyle = '#FFD23F';
    ctx.fillText(c.final ? '★  ALL ' + DE.FINAL_LEVEL + ' LEVELS CLEARED  ·  +1000  ★' : '★  LEVEL ' + c.level + ' CLEARED  ·  +250  ★', 0, fs * 0.85);
    ctx.restore();
  };

  Renderer.prototype.update = function (dt) {
    this.updateCelebration(dt);
    // On the game-over board, debris lingers: slower decay and stronger drag.
    var over = !!(this.game && this.game.state && this.game.state.mode === 'over');
    var decay = over ? dt * 0.35 : dt;
    var parts = this.parts, damp = Math.pow(over ? 0.95 : 0.985, dt * 60), n = 0, i;
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= damp;
      p.vy *= damp;
      p.life -= decay;
      if (p.life > 0) parts[n++] = p;
    }
    parts.length = n;
    var fl = this.floats;
    n = 0;
    for (i = 0; i < fl.length; i++) {
      var f = fl[i];
      f.x += (f.vx || 0) * dt;
      f.y += (f.vy !== undefined ? f.vy : -30) * dt;
      if (f.vy !== undefined) f.vy *= Math.pow(0.35, dt); // rises fast, then slows and fades
      f.life -= dt;
      if (f.life > 0) fl[n++] = f;
    }
    fl.length = n;
  };

  /* ---------- frame ---------- */
  Renderer.prototype.render = function (state) {
    var ctx = this.ctx, dpr = this.dpr, W = this.W, H = this.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = DE.COLORS.ground;
    ctx.fillRect(0, 0, W, H);
    if (!state || !state.cfg) return;

    if (state.shake > 0 && !this.reduce) {
      var m = state.shake * 10;
      ctx.setTransform(dpr, 0, 0, dpr, (Math.random() - 0.5) * m * dpr, (Math.random() - 0.5) * m * dpr);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = this.fGlyph;

    var onRoad = state.phase === 'road' && state.road;
    if (onRoad) this.drawRoad(state);
    else if (state.arena) this.drawArena(state);

    // particles
    var parts = this.parts;
    if (parts.length) {
      ctx.font = this.fGlyph;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        ctx.globalAlpha = clamp(p.life / 1.1, 0, 1);
        ctx.fillStyle = styleOf(p.key);
        ctx.fillText(p.ch, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    }
    // floats
    var fl = this.floats;
    if (fl.length) {
      ctx.font = this.fFloat;
      for (var j = 0; j < fl.length; j++) {
        var f = fl[j];
        ctx.globalAlpha = clamp(f.life / 0.6, 0, 1);
        var age = (f.max || 1.1) - f.life, pop = age < 0.15 ? 0.6 + age / 0.15 * 0.6 : 1.2 - Math.min(0.2, (age - 0.15)); // quick pop, then settle
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale(pop, pop);
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillText(f.txt, 1.5, 1.5); // shadow keeps it readable on any background
        ctx.fillStyle = f.col;
        ctx.fillText(f.txt, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // game over: dim the frozen board so the DOM result card reads on top
    if (state.mode === 'over') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // fade from black
    var fa = 0, pt = state.pt || 0;
    if (onRoad) fa = Math.max(0, 1 - pt / 0.4, state.mode === 'ready' ? 0 : (pt - (state.road.dur + 1.9)) / 0.5);
    else if (state.phase === 'arena') fa = Math.max(0, 1 - pt / 0.5);
    if (fa > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = clamp(fa, 0, 1);
      ctx.fillStyle = DE.COLORS.ground;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    this.drawCelebration();
  };

  /* ---------- arena ---------- */
  Renderer.prototype.drawArena = function (state) {
    if (state.arena && state.arena.layout === 'beyond') { this.drawBeyond(state); return; }
    this.cam = { x: 0, y: 0 };
    var ctx = this.ctx, C = state.cfg, A = state.arena, t = state.t || 0;
    var cols = this.cols, rows = this.rows, cw = this.cw, chh = this.chh;
    var cx = this.cx, cy = this.cy, L = this.L, HH = this.HH;
    var clover = A.layout === 'clover' && this.cType;
    var type = clover ? this.cType : this.gType, side = this.gSide, inside = this.gIn, sa = this.gSin, ca = this.gCos, hv = this.gHash;
    var cSide = this.cSide, cLoop = this.cLoop, cAlong = this.cAlong, exitLoop = A.exitLoop;
    var hash = DE.hash, vnoise = DE.vnoise;

    var exitSide = C.exitSide, broken = !!A.broken;
    var clearing = state.phase === 'clear';
    // wall crack progress: the exit wall cracks from its midpoint outward as dots are eaten
    var crack = A.total ? 1 - A.dotsLeft / A.total : 0;
    var crackReach = crack * 1.08;
    var exitPulse = 58 + 12 * Math.sin(t * 3);
    var flick = clearing && (((t * 14) | 0) % 2 === 0);
    var cosT = Math.cos(t * 0.6), sinT = Math.sin(t * 0.6), halfR = C.range * 0.5;
    var drift = this.reduce ? 0.03 : 0.14;
    var fx = 0.07 * (cw / 8), fy = 0.11 * (chh / 13);
    var ox = t * drift, oy = -t * drift * 0.3;
    var twk = (t * 3) | 0;
    var islandKey = ck(C.hue + C.range, 55, 13);
    var twinkleKey = ck(C.hue, 40, 30);

    for (var r = 0; r < rows; r++) {
      var py = (r + 0.5) * chh;
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c, ty = type[i], pxx = (c + 0.5) * cw;
        if (ty >= 0 && ty <= 4) {
          var exitWall = ty === 0 && (clover ? cSide[i] === exitSide && cLoop[i] === exitLoop : side[i] === exitSide);
          if (!(exitWall && broken)) {
            var hue = C.hue + (sa[i] * cosT + ca[i] * sinT) * halfR + halfR * (ty / 4);
            var h = hv[i];
            var sat = C.greyWalls ? 0 : 100; // level 1: solid grey walls
            if (exitWall && clearing) {
              if (flick) this.put(WHITE_KEY, '%', pxx, py);
              else this.put(ck(hue, sat, 82), '▒', pxx, py);
            } else if (exitWall) {
              // distance from the side midpoint along the wall: 0 at the middle, 1 at the corners
              var along = clover ? cAlong[i] : (exitSide === 1 || exitSide === 3 ? Math.abs(py - cy) : Math.abs(pxx - cx)) / HH;
              var dmg = crackReach - along; // > 0: this cell is cracked
              if (along < GATE_HALF && !clover) {
                // a golden gate: bars across the middle of the wall that will open, glowing brighter as it cracks
                var vertWall = exitSide === 1 || exitSide === 3;
                var bar = ((vertWall ? r : c) % 2 === 0) ? (vertWall ? '╫' : '╪') : (vertWall ? '║' : '═');
                this.put(ck(44, 95, 50 + crack * 28 + (hash(i, (t * 8) | 0) < 0.06 ? 14 : 0)), bar, pxx, py);
              } else if (dmg > 0) {
                var stage = dmg > 0.5 ? 3 : dmg > 0.25 ? 2 : 1;
                var jitter = h < 0.15 * stage;
                var gl = stage === 3 ? (jitter ? ' ' : '░') : stage === 2 ? (jitter ? '░' : '▒') : (jitter ? '▒' : '▓');
                if (gl !== ' ') this.put(ck(hue, sat, 62 + stage * 8 + (hash(i, (t * 10) | 0) < 0.08 ? 12 : 0)), gl, pxx, py);
              } else {
                this.put(ck(hue, sat, C.greyWalls ? exitPulse + 16 : exitPulse), C.greyWalls || h < 0.7 ? '█' : '▓', pxx, py); // the wall that will break glows brighter
              }
            } else {
              // cloverleaf: each loop gets its own shade of the palette
              var lh = clover ? hue + (cLoop[i] - 1.5) * 16 : hue;
              if (C.greyWalls) this.put(ck(0, 0, 52 + ty * 2), '█', pxx, py);
              else this.put(ck(lh, 95, 56 + ty * 3), h < 0.7 ? '█' : h < 0.92 ? '▓' : '▒', pxx, py);
            }
            continue;
          }
        } else if (ty === 5) {
          this.put(islandKey, '▒', pxx, py);
          continue;
        }
        // animated noise background (dimmer inside the lanes)
        var n = vnoise(c * fx + ox, r * fy + oy);
        if (n > 0.6) {
          var q = (n - 0.6) / 0.4;
          var li = inside[i] ? 9 + q * 10 : 16 + q * 38;
          this.put(ck(C.hue + n * 90, 65, li), RAMP[1 + Math.min(5, (q * 6) | 0)], pxx, py);
        } else if (hash(c, r + twk) < 0.004) {
          this.put(twinkleKey, '.', pxx, py);
        }
      }
    }
    this.flush();

    // dots, snapped to the glyph grid
    var dots = A.dots;
    if (dots) {
      ctx.font = this.fDot;
      var tk = (t * 4) | 0;
      for (var k = 0; k < dots.length; k++) {
        var lane = dots[k];
        if (!lane) continue;
        for (var j = 0; j < lane.length; j++) {
          var d = lane[j];
          if (d.e) continue;
          var p = d.x !== undefined ? [d.x, d.y] : DE.lanePos(k, d.u);
          var gc = Math.floor((cx + p[0] * L) / cw), gr = Math.floor((cy + p[1] * L) / chh);
          if (A.dotsLeft <= 5) this.put(tk % 2 ? DOT_HI_KEY : DOT_KEY, '◆', (gc + 0.5) * cw, (gr + 0.5) * chh); // last few: easy to spot
          else this.put(hash(gc, gr + tk) < 0.1 ? DOT_HI_KEY : DOT_KEY, '•', (gc + 0.5) * cw, (gr + 0.5) * chh);
        }
      }
      this.flush();
    }

    this.drawHint(state);
    this.drawExit(state);
    if (!broken && !clover && state.phase === 'arena') this.drawGateLabel(state);

    // cars
    var spx = Math.max(1.6, L * 0.08);
    var en = A.enemies || [];
    for (var e = 0; e < en.length; e++) {
      var o = en[e];
      var f = o.facing | 0;
      this.sprite('t' + f, ROTS[f], cx + o.x * L, cy + o.y * L, spx, DE.COLORS.enemy, DE.COLORS.enemyDark, 'rgba(255,61,168,.6)');
    }
    var P = A.player;
    if (P) {
      var pxC = cx + P.x * L, pyC = cy + P.y * L, pf = P.facing | 0;
      var held = !!state.held && state.mode === 'play';
      if (held) this.drawExhaust(pxC, pyC, pf, spx, t);
      var blink = P.inv > 0 && (((t * 14) | 0) % 2 === 0);
      if (!blink) {
        this.sprite('t' + pf, ROTS[pf], pxC, pyC, spx, DE.COLORS.player, DE.COLORS.playerDark,
          held ? 'rgba(255,160,90,1)' : 'rgba(255,138,61,.9)', held ? 26 : 14);
      }
      if (!P.exit) this.drawReady(state, P, pxC, pyC); // ring always on: tells the player car from the pink ones
    }
    ctx.font = this.fGlyph;
  };

  /* ---------- Beyond: a pale, calm Claude FM-style field with no walls ---------- */
  var GLITTER = ['*', '+', '✧', '·', '✦'];
  var GATE_HALF = 0.28; // share of the breaking wall (from its midpoint) drawn as a gate
  var GLITTER_HUES = [42, 330, 190, 28, 280];
  Renderer.prototype.drawBeyond = function (state) {
    var ctx = this.ctx, A = state.arena, t = state.t || 0, W = this.W, H = this.H;
    var cw = this.cw, chh = this.chh, cols = this.cols, rows = this.rows, L = this.L;
    var bd = DE.BEYOND.bound, edge = bd + 0.45, vnoise = DE.vnoise, hash = DE.hash;
    // camera: follow the player, but never show more than a little past the world's edge
    var P0 = A.player, cam = this.cam || (this.cam = { x: 0, y: 0 });
    var hvw = (W / 2) / L, hvh = (H / 2) / L, room = bd + 1.2;
    var tx = hvw >= room ? 0 : clamp(P0.x, -(room - hvw), room - hvw);
    var ty = hvh >= room ? 0 : clamp(P0.y, -(room - hvh), room - hvh);
    if (state.pt < 0.1 || state.mode === 'ready') { cam.x = tx; cam.y = ty; }
    else { cam.x += (tx - cam.x) * 0.12; cam.y += (ty - cam.y) * 0.12; }
    var cx = this.cx - cam.x * L, cy = this.cy - cam.y * L; // screen position of the world origin
    var drift = this.reduce ? 0.03 : 0.12;
    ctx.fillStyle = '#EBE8DF';
    ctx.fillRect(0, 0, W, H);
    var thr = Math.max(cw, chh) * 0.55 / L;
    for (var r = 0; r < rows; r++) {
      var py = (r + 0.5) * chh, wy = (py - cy) / L;
      for (var c = 0; c < cols; c++) {
        var pxx = (c + 0.5) * cw, wx = (pxx - cx) / L, d = Math.max(Math.abs(wx), Math.abs(wy));
        var n = vnoise((wx) * 0.55 + t * drift, (wy) * 0.9 - t * drift * 0.4); // anchored to the world, so it scrolls with the camera
        if (Math.abs(d - edge) < thr * 1.4) {                 // glittering edge of the world
          var tw = hash(c, r + ((t * 6) | 0)), gi = (hash(r, c) * 5) | 0;
          var glit = GLITTER[gi], hueG = GLITTER_HUES[(c + r + ((t * 2) | 0)) % GLITTER_HUES.length];
          if (tw < 0.18) this.put(ck(hueG, 95, 58), '✦', pxx, py);          // bright twinkle
          else if (tw < 0.55) this.put(ck(hueG, 80, 66), glit, pxx, py);     // shimmer
          else this.put(ck(40, 30, 70), '·', pxx, py);
        } else if (d > edge) {                                // beyond the edge: denser dither
          if (n > 0.42) this.put(ck(35, 8, 70 - (n - 0.42) * 50), RAMP[2 + Math.min(8, ((n - 0.42) * 16) | 0)], pxx, py);
        } else if (n > 0.7) {                                 // drifting glyph clouds on the field
          this.put(ck(35, 10, 74 - (n - 0.7) * 50), '.:·-'[Math.min(3, ((n - 0.7) * 12) | 0)], pxx, py);
        }
      }
    }
    this.flush();

    // stars
    var stars = (A.dots && A.dots[0]) || [], pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.save();
    ctx.font = '800 ' + (this.fontPx * 2.9).toFixed(1) + 'px ' + FONT_STACK;
    ctx.shadowColor = '#FFB020';
    ctx.shadowBlur = (6 + 6 * pulse) * this.dpr;
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      if (st.e) continue;
      ctx.fillStyle = (i + ((t * 2) | 0)) % 5 === 0 ? '#F5A623' : '#D98A0B';
      ctx.fillText('✦', cx + st.x * L, cy + st.y * L);
    }
    ctx.restore();

    // the light: a pulsing portal once every star is collected
    if (A.broken && A.exitPoint) {
      var ex = cx + A.exitPoint.x * L, ey = cy + A.exitPoint.y * L;
      ctx.save();
      for (var k = 0; k < 4; k++) {
        var ph = ((t * 0.8 + k / 4) % 1);
        ctx.globalAlpha = 1 - ph;
        ctx.strokeStyle = k % 2 ? '#FFFFFF' : DE.COLORS.player;
        ctx.lineWidth = Math.max(2, L * 0.08);
        ctx.beginPath();
        ctx.arc(ex, ey, L * (0.3 + ph * 1.1), 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = DE.COLORS.player;
      ctx.shadowBlur = 24 * this.dpr;
      ctx.beginPath();
      ctx.arc(ex, ey, L * 0.32, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = this.fExit;
      ctx.fillStyle = '#B4531C';
      var ly = ey + (A.exitPoint.y > 0 ? -L * 1.5 : L * 1.5);
      ctx.fillText('INFINITY', ex, ly);
      ctx.restore();
    }

    // cars
    var spx = Math.max(1.6, L * 0.08), en = A.enemies || [];
    for (var e = 0; e < en.length; e++) {
      var o = en[e], f = o.facing | 0;
      this.spriteAt(o.angle, f, cx + o.x * L, cy + o.y * L, spx, DE.COLORS.enemy, DE.COLORS.enemyDark, 'rgba(255,61,168,.5)', 14);
      this.edgeMarker(cx + o.x * L, cy + o.y * L, DE.COLORS.enemy);
    }
    if (A.broken && A.exitPoint) this.edgeMarker(cx + A.exitPoint.x * L, cy + A.exitPoint.y * L, DE.COLORS.player);
    var P = A.player;
    if (P && !P.exit) {
      var pxC = cx + P.x * L, pyC = cy + P.y * L, pf = P.facing | 0;
      var blink = P.inv > 0 && (((t * 14) | 0) % 2 === 0);
      if (!blink) this.spriteAt(P.angle, pf, pxC, pyC, spx, DE.COLORS.player, DE.COLORS.playerDark, 'rgba(255,138,61,.9)', 14);
      this.drawReady(state, P, pxC, pyC);
    }
    ctx.font = this.fGlyph;
  };

  // Car sprite turned to any angle (radians, 0 = right); falls back to the 4-way facing.
  Renderer.prototype.spriteAt = function (angle, facing, x, y, px, body, dark, glow, blur) {
    if (angle === undefined || angle === null) { this.sprite('t' + facing, ROTS[facing], x, y, px, body, dark, glow, blur); return; }
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2); // the base sprite faces up
    this.sprite('t0', ROTS[0], 0, 0, px, body, dark, glow, blur);
    ctx.restore();
  };

  // Outside the closed gate: "EXIT" plus a 5-step meter that fills as dots are eaten.
  Renderer.prototype.drawGateLabel = function (state) {
    var A = state.arena, ctx = this.ctx, L = this.L, HH = this.HH, s = state.cfg.exitSide, v = DE.EXIT_VEC[s];
    var done = Math.round(5 * (1 - A.dotsLeft / Math.max(1, A.total)));
    var fs = this.exitPx, room = s === 0 ? this.cy - HH : s === 1 ? this.W - this.cx - HH : s === 2 ? this.H - this.cy - HH : this.cx - HH;
    var d = HH + Math.min(L * 1.3, Math.max(fs * 1.2, room * 0.55));
    var x = clamp(this.cx + v[0] * d, fs * 2, this.W - fs * 2), y = clamp(this.cy + v[1] * d, fs * 2.2, this.H - fs * 1.2);
    var pulse = 0.55 + 0.45 * Math.sin((state.t || 0) * 3);
    ctx.save();
    // door frame around the gate so it reads as a door that will open
    var half = GATE_HALF * HH, thick = Math.max(this.cw, this.chh) * 1.1;
    var gx = this.cx + v[0] * HH, gy = this.cy + v[1] * HH;
    var fw = v[0] ? thick : half * 2, fh = v[0] ? half * 2 : thick;
    ctx.strokeStyle = 'rgba(255,200,60,' + (0.55 + 0.4 * pulse).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2, L * 0.06);
    ctx.shadowColor = '#FFB020';
    ctx.shadowBlur = 14 * this.dpr;
    ctx.strokeRect(gx - fw / 2, gy - fh / 2, fw, fh);
    ctx.shadowBlur = 0;
    ctx.font = this.fExit;
    ctx.fillStyle = 'rgba(255,200,60,' + (0.45 + 0.4 * pulse).toFixed(3) + ')';
    ctx.shadowColor = '#FFB020';
    ctx.shadowBlur = 10 * this.dpr;
    ctx.fillText('EXIT', x, y - fs * 0.45);
    ctx.shadowBlur = 0;
    ctx.font = this.fGlyph;
    ctx.fillStyle = '#FFD23F';
    ctx.fillText('▰▰▰▰▰'.slice(0, done) + '▱▱▱▱▱'.slice(0, 5 - done), x, y + fs * 0.55);
    ctx.restore();
  };

  // A small arrow on the screen edge pointing at something that is off screen.
  Renderer.prototype.edgeMarker = function (x, y, color) {
    var W = this.W, H = this.H, m = 22, top = 64;
    if (x >= 0 && x <= W && y >= top - 20 && y <= H) return;
    var cx = W / 2, cy = (H + top) / 2, dx = x - cx, dy = y - cy;
    var k = Math.min((W / 2 - m) / Math.max(1e-6, Math.abs(dx)), ((H - top) / 2 - m) / Math.max(1e-6, Math.abs(dy)));
    var ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx), ctx = this.ctx;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-7, -8);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // Flickering exhaust glyphs behind the arena car while the button is held.
  Renderer.prototype.drawExhaust = function (x, y, facing, spx, t) {
    var ctx = this.ctx, v = DE.EXIT_VEC[facing]; // facing index matches EXIT_VEC direction
    var bx = -v[0], by = -v[1], base = spx * 4.2, step = this.cw * 1.05;
    var seed = (t * 20) | 0;
    ctx.font = this.fGlyph;
    for (var i = 0; i < 3; i++) {
      var hv = DE.hash(seed, i);
      if (hv < 0.2) continue;
      ctx.globalAlpha = (0.85 - i * 0.22) * (0.6 + 0.4 * hv);
      ctx.fillStyle = i === 0 ? '#FFD23F' : DE.COLORS.player;
      var j = (hv - 0.5) * spx * 1.5;
      ctx.fillText(hv < 0.55 ? '*' : hv < 0.8 ? '+' : '·', x + bx * (base + i * step) + by * j, y + by * (base + i * step) + bx * j);
    }
    ctx.globalAlpha = 1;
  };

  // Pulsing ring around the player car, always on (player vs enemy at a glance).
  // In the 'ready' state it also shows the word HOLD just outside the lane.
  Renderer.prototype.drawReady = function (state, P, x, y) {
    var ctx = this.ctx, t = state.t || 0, L = this.L, W = this.W, H = this.H;
    var held = !!state.held;
    var wave = this.reduce ? 0 : Math.sin(t * 5);
    var r0 = L * 0.52 * (held ? 0.7 : 1 + 0.12 * wave);
    ctx.save();
    ctx.strokeStyle = DE.COLORS.player;
    ctx.shadowColor = DE.COLORS.player;
    ctx.shadowBlur = 12 * this.dpr;
    ctx.lineWidth = Math.max(2, L * 0.06);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, r0, 0, TAU);
    ctx.stroke();
    if (!this.reduce && !held) {
      // expanding ripple
      var ph = (t * 0.9) % 1;
      ctx.globalAlpha = 0.6 * (1 - ph);
      ctx.lineWidth = Math.max(1, L * 0.035);
      ctx.beginPath();
      ctx.arc(x, y, r0 * (1 + ph * 0.9), 0, TAU);
      ctx.stroke();
    }
    if (state.mode !== 'ready') { ctx.restore(); return; }
    // HOLD label: outside the outer lane, facing out from the car's side
    var fs = Math.max(18, L * 0.62);
    ctx.font = '800 ' + fs.toFixed(1) + 'px ' + FONT_STACK;
    var tw = ctx.measureText('START').width;
    var v = DE.EXIT_VEC[DE.sideOf(P.u)];
    var off = L * 0.85 + (v[0] ? tw / 2 + fs * 0.3 : fs * 0.75);
    var lx = x + v[0] * off, ly = y + v[1] * off;
    var fits = lx - tw / 2 > 4 && lx + tw / 2 < W - 4 && ly - fs / 2 > 60 && ly + fs / 2 < H - 4;
    if (!fits) {
      // no room outside (tight screen edge): put it just inside, toward the centre
      off = L * 0.55 + (v[0] ? tw / 2 + fs * 0.3 : fs * 0.75);
      lx = x - v[0] * off;
      ly = y - v[1] * off;
    }
    lx = clamp(lx, tw / 2 + 4, W - tw / 2 - 4);
    ly = clamp(ly, fs, H - fs * 0.6);
    ctx.globalAlpha = held ? 1 : 0.7 + 0.3 * (0.5 + 0.5 * wave);
    ctx.fillStyle = DE.COLORS.player;
    ctx.shadowBlur = 16 * this.dpr;
    ctx.fillText('START', lx, ly);
    ctx.restore();
  };

  // Rule 4: the hint shows where the car WILL go at the next gap given state.held.
  Renderer.prototype.drawHint = function (state) {
    var A = state.arena, hint = A.hint;
    if (!hint || (state.mode !== 'play' && state.mode !== 'ready')) return;
    var ctx = this.ctx, t = state.t || 0, L = this.L, cx = this.cx, cy = this.cy, dpr = this.dpr;
    var a = clamp(hint.alpha == null ? 1 : hint.alpha, 0, 1);
    if (a <= 0) return;
    var opts = hint.options || [];
    var P = A.player;
    var wave = this.reduce ? 0 : Math.sin(t * 6);
    var scale = 1 + 0.14 * wave;

    // target of the cue: the active arrow, or the stay marker at the car's lane
    var tx = null, ty = null, glyph = '■', i, p;
    if (hint.stay) {
      if (P) {
        p = hint.sx !== undefined ? [hint.sx, hint.sy] : DE.lanePos(Math.round(P.laneF || 0), hint.m);
        tx = cx + p[0] * L;
        ty = cy + p[1] * L;
      }
    } else {
      for (i = 0; i < opts.length; i++) {
        if (!opts[i].active) continue;
        p = opts[i].x !== undefined ? [opts[i].x, opts[i].y] : DE.lanePos(opts[i].lane, hint.m);
        tx = cx + p[0] * L;
        ty = cy + p[1] * L;
        glyph = ARROW[opts[i].dir] || '•';
      }
    }


    // inactive options: faint
    ctx.font = this.fHint;
    ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.28).toFixed(3) + ')';
    for (i = 0; i < opts.length; i++) {
      if (opts[i].active && !hint.stay) continue;
      p = opts[i].x !== undefined ? [opts[i].x, opts[i].y] : DE.lanePos(opts[i].lane, hint.m);
      ctx.fillText(ARROW[opts[i].dir] || '•', cx + p[0] * L, cy + p[1] * L);
    }
    if (tx === null) return;

    // active arrow (or stay marker): bright orange, glowing, gently scaling
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);
    if (hint.stay) ctx.font = '800 ' + (this.hintPx * 0.7).toFixed(1) + 'px ' + FONT_STACK;
    ctx.fillStyle = 'rgba(255,150,70,' + a.toFixed(3) + ')';
    ctx.shadowColor = DE.COLORS.player;
    ctx.shadowBlur = (16 + 8 * (0.5 + 0.5 * wave)) * dpr;
    ctx.fillText(glyph, 0, 0);
    ctx.restore();
  };

  Renderer.prototype.drawExit = function (state) {
    var A = state.arena;
    if (!A.broken || (A.player && A.player.exit)) return;
    var ctx = this.ctx, t = state.t || 0, L = this.L, HH = this.HH, cx = this.cx, cy = this.cy;
    var W = this.W, H = this.H, s = state.cfg.exitSide, vec = DE.EXIT_VEC[s];
    var vx = vec[0], vy = vec[1], fs = this.exitPx;
    if (A.exitPoint) { // shift the whole marker sideways to the wall that broke
      cx += (A.exitPoint.x - vx * DE.HALF) * L;
      cy += (A.exitPoint.y - vy * DE.HALF) * L;
    }
    var pulse = 0.55 + 0.45 * Math.sin(t * 8);
    var arrow = ARROW[DIRS[s]];
    var margin = s === 0 ? cy - HH : s === 1 ? W - cx - HH : s === 2 ? H - cy - HH : cx - HH;
    ctx.font = this.fExit;
    var arrowStyle = 'rgba(61,224,255,' + pulse.toFixed(3) + ')';

    if (margin >= L * 2.4) {
      // roomy: chain of arrows then the label (prototype layout)
      ctx.fillStyle = arrowStyle;
      for (var i = 0; i < 3; i++) {
        var dd = HH + L * (0.8 + i * 0.7);
        ctx.fillText(arrow, cx + vx * dd, cy + vy * dd);
      }
      var ld = Math.min(HH + L * 3.2, HH + margin - fs);
      ctx.fillStyle = DE.COLORS.exit;
      ctx.fillText('EXIT', clamp(cx + vx * ld, fs * 1.6, W - fs * 1.6), clamp(cy + vy * ld, fs, H - fs));
      return;
    }
    // compact (tight margin, e.g. portrait phones): keep everything on-screen
    var d2 = HH + Math.max(margin * 0.5, fs * 0.6);
    var x = clamp(cx + vx * d2, fs * 0.7, W - fs * 0.7);
    var y = clamp(cy + vy * d2, fs * 0.7, H - fs * 0.7);
    if (s === 0 || s === 2) {
      var tw = ctx.measureText('EXIT').width;
      ctx.fillStyle = arrowStyle;
      ctx.fillText(arrow, x - tw / 2 - fs, y);
      ctx.fillText(arrow, x + tw / 2 + fs, y);
      ctx.fillStyle = DE.COLORS.exit;
      ctx.fillText('EXIT', x, y);
    } else {
      var lh = fs * 1.05, word = 'EXIT';
      var top = y - lh * 2.5;
      ctx.fillStyle = arrowStyle;
      ctx.fillText(arrow, x, top);
      ctx.fillText(arrow, x, top + lh * 5);
      ctx.fillStyle = DE.COLORS.exit;
      for (var k = 0; k < 4; k++) ctx.fillText(word[k], x, top + lh * (k + 1));
    }
  };

  /* ---------- road ---------- */
  // One skyline cell. col = scrolled column, w = building width (incl. a 1-column street),
  // maxH = tallest building in rows, seed picks the layer, up = rows above the horizon.
  // Returns null for sky, else { ch, l (lightness offset), win (lit window) }.
  function building(col, w, maxH, seed, up) {
    var id = Math.floor(col / w), off = col - id * w;
    if (off >= w - 1) return null;                       // the street between buildings
    var h = 2 + Math.floor(DE.hash(id, seed) * (maxH - 1));
    if (up > h) return null;
    if (up === h) return { ch: off === 0 || off === w - 2 ? '▄' : '▀', l: 6, win: false };  // roof line
    if (off === 0 || off === w - 2) return { ch: '█', l: 2, win: false };                   // side walls
    if (up % 2 === 0 && off % 2 === 1) {                                                     // windows
      var lit = DE.hash(id * 31 + off, up + seed) < 0.28;
      return { ch: lit ? '▪' : '·', l: 0, win: lit };
    }
    return { ch: '▓', l: -4, win: false };
  }

  Renderer.prototype.drawRoad = function (state) {
    // level 2 is drawn in plain greys (no neon); dots and cars keep their colours
    var greyRoad = !!(state.cfg && state.cfg.greyRoad);
    var rc = function (h, sat, l) { return ck(h, greyRoad ? 0 : sat, l); };
    var ctx = this.ctx, R = state.road, t = state.t || 0, pt = state.pt || 0;
    var cur = state.cfg, next = state.nextCfg || state.cfg;
    var cols = this.cols, rows = this.rows, cw = this.cw, chh = this.chh, W = this.W, H = this.H;
    var hash = DE.hash, vnoise = DE.vnoise;
    var gap = this.laneGap;
    var y0 = this.laneY(0);
    var hr = Math.floor((y0 - gap * 0.7) / chh);
    var s = (R.scroll || 0) * (this.reduce ? 4 : 9);
    var dur = R.dur || DE.ROAD.duration;
    var kk = clamp(pt / dur, 0, 1);
    var bottomLane = this.laneY(2) + gap * 0.59;
    var div0 = y0 + gap * 0.5, div1 = this.laneY(1) + gap * 0.5, halfC = chh * 0.5;
    var dh = next.hue - cur.hue;

    // per-column hue shift cur -> next
    var colHue = this.colHue;
    if (!colHue || colHue.length !== cols) colHue = this.colHue = new Float32Array(cols);
    for (var c0 = 0; c0 < cols; c0++) colHue[c0] = cur.hue + dh * clamp((c0 / cols) * 0.5 + kk * 0.9, 0, 1);

    var sCloud = s * 0.15, sStar = (s * 0.05) | 0, sGrass = s * 3.2, sGrassHash = Math.floor(s * 6.4);
    var sGround = s * 2, sDash = Math.floor(s * 6), sRoad = s * 1.2;
    var gH = H - bottomLane + 1;
    var CLOUD = RAMP.slice(1, 8); // ' .·:-=+' minus the space
    // city skyline above the road: two parallax layers of glyph buildings scrolling past
    var sFar = Math.floor(s * 0.35), sNear = Math.floor(s * 0.8);
    var farMax = Math.max(2, Math.floor(hr * 0.85)), nearMax = Math.max(2, Math.floor(hr * 0.6));

    for (var r = 0; r < rows; r++) {
      var py = (r + 0.5) * chh;
      var zone; // 0 sky, 1 horizon, 2 ground, 3 divider, 4 road
      if (r < hr) zone = 0;
      else if (r === hr) zone = 1;
      else if (py > bottomLane) zone = 2;
      else if (Math.abs(py - div0) < halfC || Math.abs(py - div1) < halfC) zone = 3;
      else zone = 4;
      var dG = zone === 2 ? (py - bottomLane) / gH : 0;
      for (var c = 0; c < cols; c++) {
        var hue = colHue[c], x = (c + 0.5) * cw, n;
        if (zone === 0) {
          var up = hr - r; // rows above the horizon (1 = just above it)
          var bn = building(c + sNear, 9, nearMax, 7, up);
          if (bn) { this.put(rc(bn.win ? 45 : 220, bn.win ? 80 : 8, bn.win ? 62 : bn.l + 30), bn.ch, x, py); continue; }
          var bf = building(c + sFar, 6, farMax, 3, up);
          if (bf) { this.put(rc(bf.win ? 45 : 220, bf.win ? 60 : 6, bf.win ? 44 : bf.l + 14), bf.ch, x, py); continue; }
          n = vnoise(c * 0.09 + sCloud, r * 0.35);
          if (n > 0.66 && vnoise(c * 0.3 + sCloud, r * 0.9 + 5) > 0.35) {
            var q = (n - 0.66) / 0.34;
            this.put(rc(hue + 30, 60, 38 + q * 35), CLOUD[Math.min(6, (q * 7) | 0)], x, py);
          } else if (hash(c + sStar, r) < 0.004) {
            this.put(rc(hue, 40, 45), '·', x, py);
          }
        } else if (zone === 1) {
          this.put(rc(hue, 90, 62), '=', x, py);
        } else if (zone === 2) {
          var grass = vnoise(c * 0.45 + sGrass, 1.7) * 0.5 + 0.2;
          if (dG > 1 - grass) {
            this.put(rc(hue - 10, 85, 12 + (1 - dG) * 50), hash(c + sGrassHash, r) < 0.5 ? '█' : '▓', x, py);
          } else {
            n = vnoise(c * 0.2 + sGround, r * 1.1);
            if (n > 0.5) this.put(rc(hue, 80, 22 + n * 20), RAMP[3 + Math.min(9, ((n - 0.5) * 14) | 0)], x, py);
          }
        } else if (zone === 3) {
          if ((c + sDash) % 6 < 3) this.put(rc(hue, 70, 45), '-', x, py);
        } else {
          n = vnoise(c * 0.1 + sRoad, r * 0.9);
          if (n > 0.72) this.put(rc(hue, 60, 14 + n * 10), RAMP[2 + Math.min(10, ((n - 0.72) * 12) | 0)], x, py);
        }
      }
    }
    this.flush();

    // obstacles
    var px = Math.max(2, gap * 0.1);
    var obs = R.obs || [];
    ctx.font = this.fRoadDot;
    ctx.fillStyle = DE.COLORS.dot;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (o.kind === 'dot') ctx.fillText('•', o.x * W, this.laneY(o.lane));
    }
    for (var j = 0; j < obs.length; j++) {
      var ob = obs[j];
      if (ob.kind !== 'dot') this.sprite('sl', SIDE_L, ob.x * W, this.laneY(ob.laneF != null ? ob.laneF : ob.lane), px, DE.COLORS.enemy, DE.COLORS.enemyDark);
    }

    // player car
    var laneF = R.laneF != null ? R.laneF : R.lane;
    var carX = Math.min(DE.ROAD.playerX * W, -40 + pt * W * 0.5);
    var carY = this.laneY(laneF) + (this.reduce ? 0 : Math.sin(t * 14) * 1.2);
    ctx.font = this.fGlyph;
    ctx.fillStyle = 'rgba(255,210,63,.7)';
    for (var e = 1; e < 5; e++) ctx.fillText(e % 2 ? '=' : '-', carX - px * 5 - e * cw * 1.2, carY + px * 1.5);
    var held = !!state.held && state.mode === 'play';
    if (held) {
      var seed = (t * 20) | 0;
      for (var hx = 0; hx < 3; hx++) {
        var hv = hash(seed, hx + 7);
        if (hv < 0.25) continue;
        ctx.globalAlpha = 0.9 - hx * 0.25;
        ctx.fillStyle = hx === 0 ? '#FFD23F' : DE.COLORS.player;
        ctx.fillText(hv < 0.6 ? '*' : '+', carX - px * 4.6 - hx * cw * 0.9, carY + (hv - 0.5) * px * 2);
      }
      ctx.globalAlpha = 1;
    }
    this.sprite('sr', SIDE_R, carX, carY, px, DE.COLORS.player, DE.COLORS.playerDark,
      held ? 'rgba(255,160,90,1)' : 'rgba(255,138,61,.8)', held ? 24 : 14);

    // next level label
    if (pt > dur) {
      var label = 'NEXT: LEVEL ' + ((state.level | 0) + 1) + ' · ' + next.name;
      var fsz = this.labelPx;
      ctx.font = '800 ' + fsz.toFixed(1) + 'px ' + FONT_STACK;
      var w = ctx.measureText(label).width;
      if (w > W - 32) {
        fsz = Math.max(9, (fsz * (W - 32)) / w);
        ctx.font = '800 ' + fsz.toFixed(1) + 'px ' + FONT_STACK;
      }
      ctx.fillStyle = '#fff';
      ctx.fillText(label, W / 2, Math.max(H * 0.28, 64));
    }
    ctx.font = this.fGlyph;
  };

  DE.Renderer = Renderer;
})();
