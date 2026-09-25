/* Dodge 'Em Beyond - game.js
 * Shared core (window.DE), game logic, input, UI controller and boot.
 * See docs/ARCHITECTURE.md for the contract with render.js and audio.js.
 */
(function () {
  'use strict';

  /* ===================== SHARED CORE (read-only for other files) ===================== */
  var DE = (window.DE = window.DE || {});

  DE.HALF = 5;
  DE.LANES = 4;
  DE.MIDS = [0.125, 0.375, 0.625, 0.875];
  DE.SIDE_NAME = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
  DE.INWARD = ['down', 'left', 'up', 'right'];
  DE.OUTWARD = ['up', 'right', 'down', 'left'];
  DE.EXIT_VEC = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  DE.DOTS_PER_LANE = [16, 12, 9, 5]; // full arena from level 3; levels 1-2 use fewer (see levelConfig)
  DE.GAP_HALF = 0.75;

  DE.PALETTES = [
    { hue: 185, range: 95, name: 'THE SQUARE' },
    { hue: 300, range: 90, name: 'SUNSET SQUARE' },
    { hue: 75, range: 100, name: 'ACID SQUARE' },
    { hue: 245, range: 85, name: 'VIOLET SQUARE' }
  ];

  DE.COLORS = {
    ground: '#07060C',
    player: '#FF8A3D',
    playerDark: '#3A1A0A',
    enemy: '#FF3DA8',
    enemyDark: '#3A0620',
    dot: '#FFD23F',
    exit: '#3DE0FF'
  };

  DE.ROAD = { playerX: 0.24, duration: 10, carHalf: 0.035, dotHalf: 0.02 };

  // Levels alternate: odd = arena (clear the dots, break the wall), even = road (dodge the traffic).
  // arenaNo counts arenas: level 1 -> arena 1, level 2 -> road after arena 1, level 3 -> arena 2, ...
  DE.FINAL_LEVEL = 3; // 1 = RETRO (the square), 2 = BEYOND (the road), 3 = INFINITY (final, free roam)
  DE.BEYOND = { stars: 20, bound: 8, speed: 3.8, enemySpeed: 2.1, portalR: 0.9, // world is 16x16 lanes; the camera follows
    speedUp: 0.012, speedMax: 1.8,      // player: +1.2% speed per second, up to 1.8x
    huntUp: 0.004, huntMax: 1.3,        // hunters speed up more slowly (always slower than you)
    spawnFirst: 8, spawnEvery: 8, spawnShrink: 0.6, spawnMin: 4, maxHunters: 8 }; // the longer you take, the faster they come: 8 s, 7.4 s, 6.8 s ... down to 4 s, up to 8 hunters

  DE.levelConfig = function (level) {
    var road = level % 2 === 0;
    var an = road ? level / 2 : (level + 1) / 2;
    var p = DE.PALETTES[(an - 1) % DE.PALETTES.length];
    var beyond = !road && an === 2; // level 3: the finale
    var clover = false;             // Cloverleaf is kept in the code for a future level
    return {
      kind: road ? 'road' : 'arena',
      layout: beyond ? 'beyond' : clover ? 'clover' : 'square',
      greyWalls: !road && an === 1, // level 1: plain solid grey walls instead of neon
      greyRoad: road && an === 1,   // level 2: the road in greys too
      arenaNo: an,
      hue: p.hue,
      range: p.range,
      // level names: 1 RETRO, 2 BEYOND (the road), 3 INFINITY (free roam)
      name: road ? (an === 1 ? 'BEYOND' : 'OFFRAMP ' + an) : beyond ? 'INFINITY' : clover ? 'CLOVERLEAF' : an === 1 ? 'RETRO' : p.name,
      // arena
      enemies: an >= 2 ? 2 : 1,
      enemySpeed: an === 1 ? 0.45 : clover ? 0.5 : Math.min(0.95, 0.55 + 0.06 * (an - 1)),
      chase: an === 1 ? 0.2 : Math.min(0.8, 0.35 + 0.08 * (an - 1)), // how often the pink car steers toward your lane
      exitSide: [1, 0, 3, 2][(an - 1) % 4],
      dotsPerLane: an === 1 ? [6, 4, 3, 1] : an === 2 ? [11, 8, 6, 3] : DE.DOTS_PER_LANE, // 14 / 28 / 42 dots
      playerSpeed: 4.4 * (1 + 0.03 * Math.min(10, an - 1)), // lane units / second
      // road
      roadDur: 30 + 2 * Math.min(5, an - 1),                 // seconds of traffic
      roadGap: Math.max(0.55, 1.0 - 0.08 * (an - 1)),        // seconds between spawns
      roadDouble: an >= 2 ? Math.min(0.45, 0.2 + 0.08 * (an - 2)) : 0, // chance of two cars side by side
      roadSpeed: 0.45 + 0.05 * Math.min(8, an - 1)           // width fractions / second
    };
  };

  // Rectangular arena (level 1 stretches to the screen's shape). hx / hy = outer half-width / half-height
  // in lanes. Every side takes a quarter of u, so the gaps stay at DE.MIDS whatever the shape.
  DE.rectPos = function (hx, hy, laneF, u) {
    var ax = hx - (laneF + 0.5), ay = hy - (laneF + 0.5);
    var p = (((u % 1) + 1) % 1) * 4, s = Math.min(3, Math.floor(p)), f = p - s;
    if (s === 0) return [-ax + 2 * ax * f, -ay];
    if (s === 1) return [ax, -ay + 2 * ay * f];
    if (s === 2) return [ax - 2 * ax * f, ay];
    return [-ax, ay - 2 * ay * f];
  };
  // length of the side that u is on, for lane laneF (top/bottom = width, left/right = height)
  DE.rectSide = function (hx, hy, laneF, u) {
    var s = Math.min(3, Math.floor((((u % 1) + 1) % 1) * 4));
    return 2 * ((s % 2 === 0 ? hx : hy) - (laneF + 0.5));
  };
  // arena half-sizes for a screen aspect (width / height): the short side stays DE.HALF lanes
  DE.arenaDims = function (aspect) {
    var a = aspect > 0 ? aspect : 1, hx = DE.HALF, hy = DE.HALF;
    if (a >= 1) hx = Math.min(DE.HALF * 2.4, DE.HALF * a);
    else hy = Math.min(DE.HALF * 2.4, DE.HALF / a);
    return { hx: Math.round(hx * 2) / 2, hy: Math.round(hy * 2) / 2 };
  };

  DE.lanePos = function (laneF, u) {
    var h = DE.HALF - (laneF + 0.5);
    var p = (((u % 1) + 1) % 1) * 4;
    var s = Math.min(3, Math.floor(p));
    var f = p - s;
    if (s === 0) return [-h + 2 * h * f, -h];
    if (s === 1) return [h, -h + 2 * h * f];
    if (s === 2) return [h - 2 * h * f, h];
    return [-h, h - 2 * h * f];
  };

  // Cloverleaf (level 3): four small loops, each with 2 lanes, sharing their inner walls.
  // Loop i is centred at DE.CLOVER.centers[i]; lane k runs at half-size 2 - k; walls at 2.5, 1.5, 0.5.
  // A gap in a shared wall links lane 0 of two neighbouring loops.
  DE.CLOVER = {
    centers: [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]], // TL, TR, BL, BR
    lanes: 2,
    // NEIGH[loop][side] = [otherLoop, otherSide] for the shared (inner) sides, null on the outer boundary
    NEIGH: [
      [null, [1, 3], [2, 0], null],
      [null, null, [3, 0], [0, 1]],
      [[0, 2], [3, 3], null, null],
      [[1, 2], null, null, [2, 1]]
    ],
    EXIT_LOOP: [1, 3, 2, 0], // which loop's outer wall breaks for exitSide N, E, S, W
    DOTS: [4, 2]             // dots per lane in every loop (24 in total)
  };
  DE.cloverPos = function (loop, laneF, u) {
    var c = DE.CLOVER.centers[loop], h = 2 - laneF;
    var p = (((u % 1) + 1) % 1) * 4, sd = Math.min(3, Math.floor(p)), f = p - sd;
    if (sd === 0) return [c[0] - h + 2 * h * f, c[1] - h];
    if (sd === 1) return [c[0] + h, c[1] - h + 2 * h * f];
    if (sd === 2) return [c[0] + h - 2 * h * f, c[1] + h];
    return [c[0] - h, c[1] + h - 2 * h * f];
  };

  DE.sideOf = function (u) {
    return Math.min(3, Math.floor((((u % 1) + 1) % 1) * 4));
  };

  DE.clamp = function (v, a, b) {
    return Math.max(a, Math.min(b, v));
  };

  DE.hash = function (x, y) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  DE.vnoise = function (x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    xf = xf * xf * (3 - 2 * xf);
    yf = yf * yf * (3 - 2 * yf);
    var a = DE.hash(xi, yi), b = DE.hash(xi + 1, yi), c = DE.hash(xi, yi + 1), d = DE.hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };

  DE.hsl = function (h, s, l, a) {
    return a === undefined
      ? 'hsl(' + (h | 0) + ' ' + s + '% ' + (l | 0) + '%)'
      : 'hsl(' + (h | 0) + ' ' + s + '% ' + (l | 0) + '% / ' + a + ')';
  };

  DE.pad6 = function (n) {
    return String(Math.max(0, n | 0)).padStart(6, '0');
  };

  DE.Emitter = function () {
    this.handlers = {};
  };
  DE.Emitter.prototype.on = function (name, fn) {
    var list = (this.handlers[name] = this.handlers[name] || []);
    list.push(fn);
    return function () {
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  };
  DE.Emitter.prototype.emit = function (name, payload) {
    var list = this.handlers[name];
    if (!list) return;
    for (var i = 0; i < list.length; i++) list[i](payload);
  };

  /* ===================== END SHARED CORE ===================== */

  /* ===================== GAME / INPUT / UI / BOOT (below) ===================== */

  var HI_KEY = 'dodgeem-beyond-hi';
  var TAP_SEC = 0.3;         // hold mode: a press shorter than this is a tap = move outward (cloverleaf: hop loops)
  var DOUBLE_SEC = 0.45;     // a second press of the same direction this fast = jump two lanes
  var QUEUE_GAPS = 2;        // a WASD/arrow tap waits for the next gap where it applies, dropped after this many misses
  var GRACE_SEC = 0.1;      // held state flipping this soon after a gap re-decides that gap
  var HINT_DIST = 2.8;      // lanes: show the turn arrow when the next gap is this close
  var EAT_DIST = 0.45;      // lanes along the track
  var CRASH_DIST = 0.5;     // lanes (tuned down: one crash ends the run)
  var NEAR_DIST = 1.3;
  var NEAR_RESET = 2.5;
  var EXIT_DIST = DE.HALF + 6; // lanes from centre: the exiting car is off screen, road begins
  var DEATH_FREEZE = 0.5;   // seconds between crash and the result card
  var RESTART_GUARD = 0.45; // seconds after game over before a press restarts
  var SWERVE_CHANCE = 0.35; // road: share of pink cars that suddenly change lane once
  var ROAD_SLIDE = 3.5;     // road lanes per second
  var RAMP_PER_SEC = 0.0015; // +1.5% speed per 10 s within a run
  var RAMP_MAX = 1.6;
  var PLAYER_FACING = [3, 0, 1, 2];
  var FACING_OF = { up: 0, right: 1, down: 2, left: 3 };
  var WIN_DELAY = 3.6;      // final celebration before the game-complete card
  var CELEBRATE_SEC = 2.4;  // victory celebration before the next level card
  var LANE_SLIDE = 7;       // lanes per second while turning through a gap
  var ENEMY_FACING = [1, 2, 3, 0];

  function loadHi() {
    try {
      return parseInt(window.localStorage.getItem(HI_KEY) || '0', 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  var CURRENT_KEY = 'dodgeem-beyond-current'; // the level being played (checkpoint = furthest unlocked)
  function loadCurrent() {
    try {
      var v = parseInt(window.localStorage.getItem(CURRENT_KEY) || '1', 10) || 1;
      return Math.max(1, Math.min(DE.FINAL_LEVEL, v));
    } catch (e) {
      return 1;
    }
  }
  function saveCurrent(v) {
    try { window.localStorage.setItem(CURRENT_KEY, String(v)); } catch (e) { /* storage blocked */ }
  }
  function saveHi(v) {
    try {
      window.localStorage.setItem(HI_KEY, String(v));
    } catch (e) { /* storage blocked: ignore */ }
  }
  function wrap01(u) {
    return ((u % 1) + 1) % 1;
  }

  /* ---------------------------------- Game ---------------------------------- */
  function Game() {
    this.events = new DE.Emitter();
    this.lastGap = null;   // { s, t, from, used } the last gap the player passed
    this.dirMode = true;   // every input points at a direction (keys, tap/click toward the car's target)
    this.dirHeld = { up: false, down: false, left: false, right: false, turnL: false, turnR: false };
    this.dirBuf = { dir: null, t: -9, gaps: 0 };
    this.lastDotT = -9;
    this.dying = 0;        // > 0 while frozen after the fatal crash
    this.overT = -9;
    this.runT = 0;         // seconds of play in this run (speed ramp)
    this.celebrateUntil = -9; // presses are ignored until the level-complete celebration ends
    this.state = {
      mode: 'ready',
      paused: false,
      held: false,
      level: 1, score: 0, hi: loadHi(),
      checkpoint: 1,     // runs (and restarts) begin at this level
      phase: 'arena',
      t: 0, pt: 0, shake: 0,
      combo: 0, mult: 1,
      speedMul: 1,
      cfg: DE.levelConfig(1),
      nextCfg: DE.levelConfig(2),
      arena: null,
      road: null
    };
    this.state.checkpoint = DE.FINAL_LEVEL; // every level is unlocked from the start (no unlocking needed)
    this.state.level = Math.min(loadCurrent(), this.state.checkpoint); // reopen on the level you were playing
    this._startLevel(true);
    this.state.pt = 0.5; // no fade-in on the very first frame (board first)
  }

  Game.prototype._emit = function (name, payload) {
    this.events.emit(name, payload);
  };
  Game.prototype._float = function (space, x, y, text, color) {
    this._emit('float', { space: space, x: x, y: y, text: text, color: color || DE.COLORS.dot });
  };
  Game.prototype._addScore = function (n) {
    if (this.state.mode !== 'play') return;
    this.state.score += n;
  };

  Game.prototype._placePlayer = function () {
    if (this.state.arena.layout === 'clover') { this._placeCloverPlayer(); return; }
    var A0 = this.state.arena, P = A0.player;
    var p = DE.rectPos(A0.hx || DE.HALF, A0.hy || DE.HALF, P.laneF, P.u);
    P.x = p[0];
    P.y = p[1];
    var side = DE.sideOf(P.u), slide = P.target - P.laneF;
    // while switching lanes the car visibly turns into the gap, then straightens out
    if (Math.abs(slide) > 0.08) P.facing = FACING_OF[slide > 0 ? DE.INWARD[side] : DE.OUTWARD[side]];
    else P.facing = (P.dir > 0 ? ENEMY_FACING : PLAYER_FACING)[side];
  };
  Game.prototype._placeEnemy = function (e) {
    var A0 = this.state.arena, p = DE.rectPos(A0.hx || DE.HALF, A0.hy || DE.HALF, e.laneF, e.u);
    e.x = p[0];
    e.y = p[1];
    e.facing = ENEMY_FACING[DE.sideOf(e.u)];
  };

  // ---------- flow ----------
  Game.prototype._startArena = function (silent) {
    var S = this.state;
    if (DE.levelConfig(S.level).layout === 'clover') { this._startClover(silent); return; }
    if (DE.levelConfig(S.level).layout === 'beyond') { this._startBeyond(silent); return; }
    S.cfg = DE.levelConfig(S.level);
    S.nextCfg = DE.levelConfig(S.level + 1);
    var dim = DE.arenaDims(this.aspect), hx = dim.hx, hy = dim.hy;
    var dots = [], total = 0;
    for (var k = 0; k < DE.LANES; k++) {
      var n = S.cfg.dotsPerLane[k], lane = [], lw = hx - (k + 0.5), lh = hy - (k + 0.5), per = 4 * (lw + lh);
      // share the lane's dots between its sides by length, so long sides are not bare
      var perSide = [lw, lh, lw, lh].map(function (len) { return Math.max(0, Math.round(n * 2 * len / per)); });
      var diff = n - perSide.reduce(function (a, b) { return a + b; }, 0);
      for (var fix = 0; diff !== 0 && fix < 8; fix++) { var si = fix % 4; if (diff > 0) { perSide[si]++; diff--; } else if (perSide[si] > 0) { perSide[si]--; diff++; } }
      for (var sd = 0; sd < 4; sd++) {
        for (var i = 0; i < perSide[sd]; i++) {
          var u = (sd + (i + 0.5) / perSide[sd]) / 4, pp = DE.rectPos(hx, hy, k, u);
          lane.push({ u: u, e: false, x: pp[0], y: pp[1] });
        }
      }
      dots.push(lane);
      total += lane.length;
    }
    var enemies = [];
    for (var j = 0; j < S.cfg.enemies; j++) {
      enemies.push({ u: (0.05 + j * 0.5) % 1, laneF: j ? 1 : 3, target: j ? 1 : 3, x: 0, y: 0, facing: 1, near: false });
    }
    var ev = DE.EXIT_VEC[S.cfg.exitSide];
    S.arena = {
      hx: hx, hy: hy, // this level's shape, fixed for the whole level
      exitPoint: { x: ev[0] * hx, y: ev[1] * hy },
      dots: dots,
      dotsLeft: total,
      total: total,   // wall crack progress = 1 - dotsLeft / total
      broken: false,
      player: { u: 0.55, laneF: 0, target: 0, x: 0, y: 0, inv: 2.0, exit: false, ex: 0, ey: 0, facing: 0, dir: -1 },
      enemies: enemies,
      hint: null
    };
    S.road = null;
    S.phase = 'arena';
    S.pt = 0;
    S.combo = 0;
    S.mult = 1;
    this.lastGap = null;
    this._placePlayer();
    for (var q = 0; q < enemies.length; q++) this._placeEnemy(enemies[q]);
    if (!silent) this._emit('levelStart', { level: S.level, cfg: S.cfg });
  };

  // Build the board for S.level. wait = show it frozen ('ready') until the player presses.
  Game.prototype._startLevel = function (wait) {
    var S = this.state;
    saveCurrent(S.level);
    this.tapQ = null;
    this._clearQueue();
    var cfg = DE.levelConfig(S.level);
    if (cfg.kind === 'road') this._startRoadLevel();
    else this._startArena(true);
    if (wait) {
      S.mode = 'ready';
      S.held = false;
      this._emit('mode', { mode: 'ready' });
    } else {
      this._emitLevelStart();
    }
    this._updateHint();
  };
  Game.prototype._emitLevelStart = function () {
    var S = this.state;
    if (S.phase === 'road') this._emit('roadStart', { level: S.cfg.arenaNo });
    else this._emit('levelStart', { level: S.cfg.arenaNo, cfg: S.cfg });
  };

  // level finished (arena exit or end of the road): next level, saved as the checkpoint
  Game.prototype._completeLevel = function () {
    var S = this.state;
    this._addScore(250);
    var final = S.level >= DE.FINAL_LEVEL;
    this._emit('levelComplete', { level: S.level, kind: S.cfg.kind, score: S.score, final: final });
    if (final) {
      // the last wall is broken: celebrate, then the "game complete" card
      this._addScore(1000);
      this.winPending = WIN_DELAY;
      return;
    }
    this.celebrateUntil = S.t + CELEBRATE_SEC;
    S.level++;
    this._startLevel(true);
  };

  // ready -> play: the board on screen is already the level, so keep it (no fade)
  Game.prototype._beginRun = function () {
    var S = this.state;
    S.mode = 'play';
    this.runT = 0;
    S.speedMul = 1;
    this._emit('mode', { mode: 'play' });
    this._emitLevelStart();
  };

  // over -> play: fresh level 1
  Game.prototype._newRun = function () {
    var S = this.state;
    S.mode = 'play';
    S.paused = false;
    // dying replays the SAME level; only winning moves on (after the final level: back to level 1)
    S.level = S.won ? 1 : Math.min(S.level, DE.FINAL_LEVEL);
    S.won = false;
    this.winPending = 0;
    S.score = 0;
    S.shake = 0;
    this.dying = 0;
    this.runT = 0;
    S.speedMul = 1;
    this._emit('mode', { mode: 'play' });
    this._startLevel(false);
  };

  // public: restart from the result card (honours the guard)
  Game.prototype.restart = function () {
    var S = this.state;
    if (S.mode === 'over' && S.t - this.overT > RESTART_GUARD) {
      this._newRun();
      return true;
    }
    return false;
  };

  Game.prototype._gameOver = function (won) {
    var S = this.state;
    S.won = !!won;
    var newBest = S.score > S.hi;
    if (newBest) {
      S.hi = S.score;
      saveHi(S.hi);
    }
    S.mode = 'over';
    S.paused = false;
    this.overT = S.t;
    S.arena.hint = null;
    this._emit('mode', { mode: 'over' });
    this._emit('gameOver', {
      score: S.score,
      hi: S.hi,
      level: S.level,
      dotsLeft: S.phase === 'road' ? 0 : S.arena.dotsLeft,
      newBest: newBest,
      won: !!won
    });
  };

  Game.prototype.setPaused = function (v) {
    var S = this.state;
    v = !!v;
    if (S.mode !== 'play' || S.paused === v) return;
    S.paused = v;
    this._emit('pause', { paused: v });
  };
  Game.prototype.togglePause = function () {
    this.setPaused(!this.state.paused);
  };

  // ---------- single input ----------
  Game.prototype.down = function () {
    var S = this.state;
    var was = S.held;
    S.held = true;
    if (!was) this.pressT = S.t;
    // A press that starts, restarts or resumes the game is only that: it must not also
    // count as a tap (move out / hop loops) or a hold (move in) when it is released.
    if (S.mode === 'ready') { this.pressUsed = true; if (!this.celebrating()) this._beginRun(); return; }
    if (S.mode === 'over') { this.pressUsed = true; this.restart(); return; }
    if (S.paused) { this.pressUsed = true; this.setPaused(false); return; }
    if (!was) this._regrace();
  };
  // level select: jump to any unlocked level; it waits on its board for a press
  Game.prototype.selectLevel = function (n) {
    var S = this.state;
    n = Math.max(1, Math.min(S.checkpoint, DE.FINAL_LEVEL, n | 0));
    S.won = false;
    this.winPending = 0;
    S.paused = false;
    S.level = n;
    S.score = 0;
    S.shake = 0;
    this.dying = 0;
    this.celebrateUntil = -9;
    this.runT = 0;
    S.speedMul = 1;
    this._startLevel(true);
    S.pt = 0.5;
  };
  Game.prototype.resetProgress = function () {
    this.state.checkpoint = DE.FINAL_LEVEL; // levels stay unlocked; this just starts over from level 1
    saveCurrent(1);
    this.selectLevel(1);
  };
  DE.MENU_LEVELS = 3; // the whole game: two arenas and the road between them

  // The renderer reports the play area's shape (width / height). The level shown in 'ready' is rebuilt
  // to fit (e.g. after rotating a phone); a level in progress keeps its shape until it ends.
  Game.prototype.setAspect = function (a) {
    if (!(a > 0) || Math.abs(a - (this.aspect || 0)) < 0.02) return;
    this.aspect = a;
    var S = this.state;
    if (S.mode === 'ready' && !this.celebrating() && S.phase !== 'road') {
      var pt = S.pt;
      this._startLevel(true);
      S.pt = pt;
    }
  };

  Game.prototype.celebrating = function () {
    return this.state.t < this.celebrateUntil;
  };
  // hold mode: the button counts as held (steer inward / up) only after TAP_SEC, so a tap never moves you inward
  Game.prototype._holding = function () {
    return this.state.held && !this.pressUsed && this.state.t - (this.pressT || -9) >= TAP_SEC;
  };
  Game.prototype.up = function () {
    var S = this.state;
    var was = S.held;
    S.held = false;
    if (this.pressUsed) { this.pressUsed = false; return; } // that press started the game
    if (S.mode === 'play' && !S.paused && was) {
      var tap = S.t - (this.pressT || -9) < TAP_SEC;
      if (S.phase === 'road' && S.road) {
        // road: a tap drops one lane; letting go after a hold keeps the lane you reached
        var cur = Math.round(S.road.laneF);
        S.road.goalLane = tap ? Math.min(2, cur + 1) : cur;
      } else if (tap) {
        this.tapQ = { gaps: 0 }; // arena: move outward (cloverleaf: hop loops) at the next gap
      }
      this._regrace();
    }
  };

  // ---------- keyboard directions (W A S D / arrows, laptop) ----------
  // Optional second scheme: point at the lane you want. At a gap on side s, DE.INWARD[s]
  // moves in, DE.OUTWARD[s] moves out, anything else keeps the lane.
  Game.prototype.dirDown = function (dir) {
    var S = this.state;
    if (S.mode === 'ready') {
      // the key that starts the level only starts it; it is not queued as a turn
      if (this.celebrating()) return;
      this.dirMode = true; S.held = false; this._clearQueue(); this._beginRun();
      return;
    }
    else if (S.mode === 'over') { this.dirMode = true; S.held = false; this.restart(); return; }
    else if (S.paused) { this.setPaused(false); return; }
    this.dirMode = true;
    S.held = false;
    this.dirHeld[dir] = true;
    if (S.arena && S.arena.layout === 'beyond' && S.phase !== 'road') { this._beyondKeys(); return; }
    // a quick second press of the same direction = jump two lanes. It also counts when the first
    // press was already used at a gap a moment ago (lastTap remembers it).
    var prev = this.lastTap, dbl = !!(prev && prev.dir === dir && S.t - prev.t < DOUBLE_SEC);
    this.lastTap = { dir: dir, t: S.t };
    this.dirBuf = { dir: dir, t: S.t, gaps: 0, double: dbl };
    if (dbl && S.mode === 'play' && S.arena && S.cfg.layout === 'square' && S.phase === 'arena') {
      this._float('arena', S.arena.player.x, S.arena.player.y, 'x2', DE.COLORS.player);
    }
    if (S.phase === 'road' && S.road) {
      var R = S.road;
      // the road car heads right: its left is the upper lane, its right the lower lane
      if (dir === 'up' || dir === 'turnL') R.goalLane = Math.max(0, R.goalLane - 1);
      else if (dir === 'down' || dir === 'turnR') R.goalLane = Math.min(2, R.goalLane + 1);
      return;
    }
    this._regrace();
  };
  Game.prototype.dirUp = function (dir) {
    this.dirHeld[dir] = false;
    var A = this.state.arena;
    if (A && A.layout === 'beyond' && this.state.mode === 'play') this._beyondKeys();
  };
  // hold mode: a tap is spent once it moved the car outward; otherwise it waits one more gap
  Game.prototype._tapAfterGap = function (usedOut) {
    if (!this.tapQ || this.dirMode) return;
    if (usedOut) { this.tapQ = null; return; }
    if (++this.tapQ.gaps >= QUEUE_GAPS + 1) this.tapQ = null;
  };
  Game.prototype._clearQueue = function () {
    this.dirBuf = { dir: null, t: -9, gaps: 0 };
  };
  // after every gap: a tap that was used is spent; one that could not apply waits for the next gap
  Game.prototype._queueAfterGap = function (applied) {
    if (!this.dirMode || !this.dirBuf.dir) return;
    if (applied) { this._clearQueue(); return; }
    this.dirBuf.gaps = (this.dirBuf.gaps || 0) + 1;
    if (this.dirBuf.gaps >= QUEUE_GAPS) this._clearQueue();
  };
  Game.prototype._dirWants = function () {
    var w = {};
    for (var d in this.dirHeld) if (this.dirHeld[d]) w[d] = true;
    if (this.dirBuf.dir) w[this.dirBuf.dir] = true;
    return w;
  };

  // 2 lanes when that direction was double-pressed, else 1
  Game.prototype._steps = function (dir) {
    return this.dirBuf.dir === dir && this.dirBuf.double ? 2 : 1;
  };

  // lane decision at a gap on side s
  Game.prototype._decide = function (from, s) {
    // all dots eaten: the gate is open and the car drives itself out (lane 0, then through the gate)
    if (this.state.phase === 'escape' || this.state.phase === 'clear') return Math.max(0, from - 1);
    if (this.dirMode) {
      var w = this._dirWants(), to = from;
      // A/← and D/→ steer relative to the car: it drives counter-clockwise, so its left is always inward
      if (w.turnL) to = from + 1;
      else if (w.turnR) to = from - 1;
      else if (w[DE.INWARD[s]]) to = from + this._steps(DE.INWARD[s]);
      else if (w[DE.OUTWARD[s]]) to = from - this._steps(DE.OUTWARD[s]);
      return DE.clamp(to, 0, DE.LANES - 1);
    }
    // hold mode: holding = inward, a tap = outward, nothing = keep the lane
    if (this._holding()) return Math.min(DE.LANES - 1, from + 1);
    if (this.tapQ && from > 0) return from - 1;
    return from;
  };

  // held state flipped: if we just passed a gap, re-decide it
  Game.prototype._regrace = function () {
    var S = this.state, g = this.lastGap;
    if (!g || g.used || S.phase === 'road' || S.t - g.t > GRACE_SEC) return;
    var P = S.arena.player;
    if (P.exit) return;
    if (S.arena.layout === 'clover') { this._cloverRegrace(g); return; }
    var nt = this._decide(g.from, g.s);
    g.used = true; // one re-decide per gap
    if (this.dirMode && nt !== g.from) this._clearQueue();
    if (nt !== P.target) {
      P.target = nt;
      this._emit('turn', {});
    }
  };

  // ---------- arena logic ----------
  Game.prototype._playerGap = function (m) {
    var S = this.state, P = S.arena.player, s = DE.MIDS.indexOf(m);
    if (S.phase === 'escape' && P.target === 0 && Math.abs(P.laneF) < 0.05 && s === S.cfg.exitSide) {
      P.exit = true;
      P.u = m;
      P.laneF = 0;
      this._placePlayer();
      P.ex = DE.EXIT_VEC[s][0];
      P.ey = DE.EXIT_VEC[s][1];
      P.facing = S.cfg.exitSide;
      this.lastGap = null;
      this._addScore(300);
      this._emit('breakout', { x: P.x, y: P.y });
      this._float('arena', P.x, P.y, 'BREAKOUT +300', DE.COLORS.exit);
      return;
    }
    var from = P.target, nt = this._decide(from, s);
    if (nt !== from) {
      P.target = nt;
      this._emit('turn', {});
    }
    this._queueAfterGap(nt !== from);
    this._tapAfterGap(nt < from);
    this.lastGap = { s: s, t: S.t, from: from, used: false };
  };

  Game.prototype._enemyGap = function (e) {
    var S = this.state;
    if (Math.random() < S.cfg.chase) {
      var pl = S.arena.player.target;
      if (e.target < pl) e.target++;
      else if (e.target > pl) e.target--;
    }
  };

  Game.prototype._die = function (space, x, y) {
    var S = this.state;
    S.shake = 0.6;
    S.combo = 0;
    S.mult = 1;
    this.dying = DEATH_FREEZE;
    if (S.arena) S.arena.hint = null;
    this._emit('crash', { space: space, x: x, y: y });
  };

  Game.prototype._eat = function () {
    var S = this.state, A = S.arena, P = A.player;
    var k = Math.round(P.laneF);
    if (Math.abs(P.laneF - k) > 0.3) return;
    var lane = A.dots[k];
    for (var i = 0; i < lane.length; i++) {
      var d = lane[i];
      if (d.e) continue;
      if (Math.hypot(d.x - P.x, d.y - P.y) >= EAT_DIST) continue;
      d.e = true;
      A.dotsLeft--;
      S.combo = S.t - this.lastDotT < 1.0 ? S.combo + 1 : 1;
      this.lastDotT = S.t;
      var m = Math.min(5, 1 + Math.floor(S.combo / 6));
      var p = [d.x, d.y];
      if (m > S.mult) {
        this._emit('combo', { mult: m, space: 'arena', x: p[0], y: p[1] });
        this._float('arena', p[0], p[1], 'COMBO x' + m, DE.COLORS.player);
      }
      S.mult = m;
      this._addScore(10 * m);
      this._emit('dot', { combo: S.combo, mult: S.mult, space: 'arena', x: p[0], y: p[1] });
      if (A.dotsLeft <= 0) { this._allClear(); return; }
    }
  };

  Game.prototype._allClear = function () {
    var S = this.state, A = S.arena;
    S.phase = 'clear';
    S.pt = 0;
    var list = [];
    for (var i = 0; i < A.enemies.length; i++) list.push({ x: A.enemies[i].x, y: A.enemies[i].y });
    A.enemies = [];
    this._addScore(500);
    this._emit('clear', { enemies: list });
    this._float('arena', 0, -DE.HALF * 0.2, 'ALL CLEAR +500', DE.COLORS.dot);
  };

  Game.prototype._shatter = function () {
    var S = this.state;
    S.arena.broken = true;
    S.shake = 0.4;
    this._emit('shatter', { side: S.cfg.exitSide, loop: S.arena.exitLoop });
  };

  Game.prototype._updateArena = function (dt) {
    if (this.state.arena.layout === 'clover') { this._updateClover(dt); return; }
    if (this.state.arena.layout === 'beyond') { this._updateBeyond(dt); return; }
    var S = this.state, A = S.arena, P = A.player, C = S.cfg;
    var sp = C.playerSpeed * S.speedMul * (S.phase === 'escape' ? AUTO_EXIT_BOOST : 1); // auto exit: hurry to the gate
    if (!P.exit) {
      var prev = P.u, nu = prev + (P.dir || -1) * (sp * dt) / (4 * DE.rectSide(A.hx, A.hy, P.laneF, P.u));
      for (var i = 0; i < DE.MIDS.length; i++) {
        var m = DE.MIDS[i];
        if ((prev > m && nu <= m) || (prev < m && nu >= m)) {
          this._playerGap(m);
          if (P.exit) break;
        }
      }
      if (!P.exit) {
        P.u = wrap01(nu);
        var slide = LANE_SLIDE * Math.max(1, Math.abs(P.target - P.laneF)); // a 2-lane jump slides twice as fast
        P.laneF += DE.clamp(P.target - P.laneF, -dt * slide, dt * slide);
        this._placePlayer();
        this._eat();
      }
    } else {
      P.x += P.ex * sp * 1.3 * dt;
      P.y += P.ey * sp * 1.3 * dt;
      P.facing = C.exitSide;
      if (Math.abs(P.x) > A.hx + 6 || Math.abs(P.y) > A.hy + 6) { // off screen: level done
        this._completeLevel();
        return;
      }
    }
    for (var j = 0; j < A.enemies.length; j++) {
      var e = A.enemies[j];
      var ep = e.u, enu = ep + (sp * C.enemySpeed * dt) / (4 * DE.rectSide(A.hx, A.hy, e.laneF, e.u));
      for (var q = 0; q < DE.MIDS.length; q++) if (ep < DE.MIDS[q] && enu >= DE.MIDS[q]) this._enemyGap(e);
      e.u = enu % 1;
      e.laneF += DE.clamp(e.target - e.laneF, -dt * 11, dt * 11);
      this._placeEnemy(e);
      if (S.phase !== 'arena') continue;
      var d = Math.hypot(P.x - e.x, P.y - e.y);
      if (d < CRASH_DIST && P.inv <= 0) { this._die('arena', P.x, P.y); return; }
      if (!e.near && d < NEAR_DIST && Math.abs(e.laneF - P.laneF) < 1.3 && P.inv <= 0) {
        e.near = true;
        this._addScore(25);
        this._emit('near', { space: 'arena', x: P.x, y: P.y });
        this._float('arena', P.x, P.y, 'CLOSE! +25', DE.COLORS.exit);
      }
      if (d > NEAR_RESET) e.near = false;
    }
    if (S.phase === 'clear' && S.pt > 0.9) {
      this._shatter();
      S.phase = 'escape';
      S.pt = 0;
    }
  };

  Game.prototype._updateHint = function () {
    var S = this.state, A = S.arena;
    if (!A) return;
    if (A.layout === 'beyond') { A.hint = null; return; } // free roam: no gaps, no arrows
    A.hint = null;
    var P = A.player;
    if (S.mode === 'over' || this.dying > 0 || P.exit || (S.phase !== 'arena' && S.phase !== 'escape')) return;
    if (A.layout === 'clover') { this._hintClover(); return; }
    var nm = -1;
    for (var i = 0; i < DE.MIDS.length; i++) {
      var m = DE.MIDS[i];
      if (P.dir > 0) { if (m > P.u + 0.0005 && (nm < 0 || m < nm)) nm = m; }
      else if (m < P.u - 0.0005 && m > nm) nm = m;
    }
    if (nm < 0) nm = P.dir > 0 ? DE.MIDS[0] : DE.MIDS[3];
    var dist = wrap01(P.dir > 0 ? nm - P.u : P.u - nm) * 4 * DE.rectSide(A.hx, A.hy, P.laneF, P.u);
    var queued = (this.dirMode && !!this.dirBuf.dir) || (!this.dirMode && !!this.tapQ);
    if (dist >= HINT_DIST && !queued) return;
    var s = DE.MIDS.indexOf(nm), k = P.target;
    var nt = this._decide(k, s);
    var options = [], hx = A.hx, hy = A.hy;
    var opt = function (dir, lane, active) { var q = DE.rectPos(hx, hy, lane, nm); return { dir: dir, lane: lane, x: q[0], y: q[1], active: active }; };
    if (k < 3) options.push(opt(DE.INWARD[s], nt === k + 2 ? k + 2 : k + 1, nt === k + 1 || nt === k + 2));
    if (k > 0) options.push(opt(DE.OUTWARD[s], nt === k - 2 ? k - 2 : k - 1, nt === k - 1 || nt === k - 2));
    var st = DE.rectPos(hx, hy, k, nm);
    A.hint = {
      m: nm,
      alpha: queued ? 1 : DE.clamp(1 - dist / HINT_DIST, 0.25, 1),
      options: options,
      stay: nt === k,
      sx: st[0],
      sy: st[1]
    };
  };

  // ---------- road logic ----------
  Game.prototype._startRoadLevel = function () {
    var S = this.state;
    S.cfg = DE.levelConfig(S.level);
    S.nextCfg = DE.levelConfig(S.level + 1);
    // a stub arena keeps shared fields (player.inv, hint, dots) valid for the HUD and renderer
    S.arena = {
      dots: [[], [], [], []], dotsLeft: 0, total: 0, broken: false,
      player: { u: 0, laneF: 0, target: 0, x: 0, y: 0, inv: 1.0, exit: false, ex: 0, ey: 0, facing: 1 },
      enemies: [], hint: null
    };
    S.phase = 'road';
    S.pt = 0;
    S.combo = 0;
    S.mult = 1;
    this.lastGap = null;
    S.road = { lane: 1, laneF: 1, goalLane: 1, scroll: 0, dur: S.cfg.roadDur, obs: [], spawn: 1.0 };
  };

  Game.prototype._spawnRoad = function () {
    var S = this.state, R = S.road, C = S.cfg, x0 = 1.05;
    if (Math.random() < 0.3) {
      var ln = (Math.random() * 3) | 0;
      for (var i = 0; i < 5; i++) R.obs.push({ x: x0 + i * 0.025, lane: ln, kind: 'dot' });
      return;
    }
    var lanes = [0, 1, 2];
    for (var a = lanes.length - 1; a > 0; a--) {
      var b = (Math.random() * (a + 1)) | 0, tmp = lanes[a];
      lanes[a] = lanes[b];
      lanes[b] = tmp;
    }
    // some cars will swerve into a neighbouring lane once, somewhere ahead of the player
    var mk = function (ln) {
      return { x: x0, lane: ln, laneF: ln, kind: 'car', swerveAt: Math.random() < SWERVE_CHANCE ? 0.5 + Math.random() * 0.35 : -1 };
    };
    R.obs.push(mk(lanes[0]));
    // never block all three lanes: at most two cars side by side, always one open lane
    if (Math.random() < C.roadDouble) R.obs.push(mk(lanes[1]));
  };

  // a pink car jumps to a neighbouring lane, unless that would wall off all three lanes
  Game.prototype._swerve = function (R, o) {
    var opts = [o.lane - 1, o.lane + 1].filter(function (l) { return l >= 0 && l <= 2; });
    if (Math.random() < 0.5) opts.reverse();
    for (var i = 0; i < opts.length; i++) {
      var to = opts[i], blocked = {};
      blocked[to] = true;
      for (var j = 0; j < R.obs.length; j++) {
        var b = R.obs[j];
        if (b !== o && b.kind === 'car' && !b.dead && Math.abs(b.x - o.x) < 0.08) blocked[b.lane] = true;
      }
      if (blocked[0] && blocked[1] && blocked[2]) continue;
      var clash = false;
      for (var k = 0; k < R.obs.length; k++) {
        var c = R.obs[k];
        if (c !== o && c.kind === 'car' && c.lane === to && Math.abs(c.x - o.x) < 0.06) clash = true;
      }
      if (clash) continue;
      o.lane = to;
      return;
    }
  };

  Game.prototype._updateRoad = function (dt) {
    var S = this.state, R = S.road, P = S.arena.player;
    var spd = S.cfg.roadSpeed * S.speedMul; // width fractions per second
    R.scroll += dt * S.speedMul;
    var goal = !this.dirMode && this._holding() ? 0 : R.goalLane;
    R.laneF += DE.clamp(goal - R.laneF, -dt * ROAD_SLIDE, dt * ROAD_SLIDE);
    var ln = Math.round(R.laneF);
    if (ln !== R.lane) {
      R.lane = ln;
      this._emit('turn', {});
    }
    if (S.pt < R.dur) {
      R.spawn -= dt;
      if (R.spawn <= 0) {
        this._spawnRoad();
        R.spawn = S.cfg.roadGap * (0.8 + Math.random() * 0.5);
      }
    }
    var px = DE.ROAD.playerX;
    for (var i = 0; i < R.obs.length; i++) {
      var o = R.obs[i];
      o.x -= spd * dt * (o.kind === 'car' ? 1.25 : 1);
      if (o.kind === 'car') {
        if (o.swerveAt > 0 && o.x < o.swerveAt) { this._swerve(R, o); o.swerveAt = -1; }
        o.laneF += DE.clamp(o.lane - o.laneF, -dt * 5, dt * 5);
      }
      if (o.dead || (o.kind === 'car' ? Math.round(o.laneF) : o.lane) !== ln) continue;
      if (o.kind === 'dot' && Math.abs(o.x - px) < DE.ROAD.dotHalf) {
        o.dead = true;
        S.combo = S.t - this.lastDotT < 1.0 ? S.combo + 1 : 1;
        this.lastDotT = S.t;
        // a trail of dots in a row pays more each time: +10, +20, +30, +40, +50
        var pts = 10 * Math.min(5, S.combo);
        this._addScore(pts);
        this._emit('dot', { combo: S.combo, mult: S.mult, space: 'road', x: o.x, y: ln });
        this._float('road', o.x, ln, '+' + pts, DE.COLORS.dot);
      } else if (o.kind === 'car' && Math.abs(o.x - px) < DE.ROAD.carHalf && P.inv <= 0) {
        this._die('road', o.x, ln);
        return;
      }
    }
    R.obs = R.obs.filter(function (ob) { return !ob.dead && ob.x > -0.1; });
    if (S.pt > R.dur + 2.4) this._completeLevel();
  };

  // ---------- update ----------
  Game.prototype.update = function (dt) {
    var S = this.state;
    if (S.paused) return;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(0.05, dt);
    S.t += dt;
    S.pt += dt;
    S.shake = Math.max(0, S.shake - dt);
    if (S.mode === 'ready') { S.pt = Math.min(S.pt, 1); this._updateHint(); return; } // frozen board, hint visible
    if (S.mode === 'over') return;                          // board stays as it was at the crash
    if (this.winPending > 0) {
      this.winPending -= dt;
      if (this.winPending <= 0) { this.winPending = 0; this._gameOver(true); }
      return;
    }
    if (this.dying > 0) {
      this.dying -= dt;
      if (this.dying <= 0) { this.dying = 0; this._gameOver(); }
      return;
    }
    this.runT += dt;
    S.speedMul = Math.min(RAMP_MAX, 1 + RAMP_PER_SEC * this.runT);
    var P = S.arena.player;
    P.inv = Math.max(0, P.inv - dt);
    if (S.phase === 'road') this._updateRoad(dt);
    else this._updateArena(dt);
    this._updateHint();
  };

  /* -------------------------------- Beyond -------------------------------- */
  // The finale: no lanes, no walls. Drive anywhere, collect the stars while two pink cars hunt you,
  // then drive into the light.
  Game.prototype._startBeyond = function (silent) {
    var S = this.state, B = DE.BEYOND;
    S.cfg = DE.levelConfig(S.level);
    S.nextCfg = DE.levelConfig(S.level + 1);
    var a = this.aspect > 0 ? this.aspect : 1;
    var bx = B.bound * Math.max(1, Math.min(2, a)), by = B.bound * Math.max(1, Math.min(2, 1 / a)); // match the screen's shape
    var stars = [], tries = 0;
    while (stars.length < B.stars && tries++ < 2000) {
      var x = (Math.random() * 2 - 1) * (bx - 0.4), y = (Math.random() * 2 - 1) * (by - 0.4);
      if (Math.hypot(x, y) < 2) continue; // keep clear of the start
      var ok = true;
      for (var i = 0; i < stars.length; i++) if (Math.hypot(stars[i].x - x, stars[i].y - y) < 2) { ok = false; break; }
      if (ok) stars.push({ x: x, y: y, e: false, u: 0 });
    }
    var enemies = [
      { x: -(bx - 0.8), y: -(by - 0.8), vx: 1, vy: 0, facing: 1, near: false },
      { x: bx - 0.8, y: by - 0.8, vx: -1, vy: 0, facing: 3, near: false }
    ].slice(0, S.cfg.enemies);
    var side = (Math.random() * 4) | 0, v = DE.EXIT_VEC[side];
    S.arena = {
      layout: 'beyond',
      dots: [stars],
      dotsLeft: stars.length,
      total: stars.length,
      broken: false,                 // true = the portal is open
      bx: bx, by: by,
      exitPoint: { x: v[0] * (bx - 0.6), y: v[1] * (by - 0.6) },
      player: { x: 0, y: 0, hx: 0, hy: -1, tx: 0, ty: -1, angle: -Math.PI / 2, u: 0.55, laneF: 0, target: 0, inv: 2.0, exit: false, facing: 0, dir: -1 },
      enemies: enemies,
      hint: null
    };
    S.road = null;
    S.phase = 'arena';
    S.pt = 0;
    S.combo = 0;
    S.mult = 1;
    this.lastGap = null;
    if (!silent) this._emit('levelStart', { level: S.cfg.arenaNo, cfg: S.cfg });
  };

  var AUTO_EXIT_BOOST = 1.8; // speed while the car drives itself to the open gate
  var BEYOND_TURN = 7; // radians per second the car can turn in Beyond
  var FACE_OF_VEC = function (x, y) { return Math.abs(x) > Math.abs(y) ? (x > 0 ? 1 : 3) : (y > 0 ? 2 : 0); };

  // W A S D / arrows: heading from the keys held (two keys = diagonal); letting go keeps the last heading
  Game.prototype._beyondKeys = function () {
    var H = this.dirHeld, x = (H.right ? 1 : 0) - (H.left ? 1 : 0), y = (H.down ? 1 : 0) - (H.up ? 1 : 0);
    if (x || y) this.steerTo(x, y);
  };
  // tap / click: head toward that point (any angle)
  // quiet = continuous steering (finger / mouse drag): no turn sound every frame
  Game.prototype.steerTo = function (dx, dy, quiet) {
    var A = this.state.arena, P = A && A.player, d = Math.hypot(dx, dy);
    if (!P || A.layout !== 'beyond' || d < 1e-6) return;
    P.tx = dx / d;
    P.ty = dy / d;
    if (!quiet) this._emit('turn', {});
  };

  Game.prototype._updateBeyond = function (dt) {
    var S = this.state, A = S.arena, P = A.player, B = DE.BEYOND, bx = A.bx || B.bound, by = A.by || B.bound;
    var rt = this.runT || 0;
    var sp = B.speed * Math.min(B.speedMax, 1 + B.speedUp * rt);
    // more hunters over time, each from the corner farthest from you
    if (S.phase === 'arena' && A.enemies.length < B.maxHunters && rt >= (A.nextSpawn || B.spawnFirst)) {
      A.spawned = (A.spawned || 0) + 1;
      A.nextSpawn = (A.nextSpawn || B.spawnFirst) + Math.max(B.spawnMin, B.spawnEvery - B.spawnShrink * A.spawned);
      var sx = P.x > 0 ? -(bx - 0.8) : bx - 0.8, sy = P.y > 0 ? -(by - 0.8) : by - 0.8;
      A.enemies.push({ x: sx, y: sy, vx: 0, vy: 0, facing: 0, near: false });
      this._float('arena', P.x, P.y, 'NEW HUNTER!', DE.COLORS.enemy);
    }
    // every star collected: the car drives itself into the light
    if (S.phase === 'escape' && A.exitPoint) {
      var ddx = A.exitPoint.x - P.x, ddy = A.exitPoint.y - P.y, dl = Math.hypot(ddx, ddy) || 1;
      P.tx = ddx / dl;
      P.ty = ddy / dl;
      sp *= AUTO_EXIT_BOOST;
    }
    // free-hand: turn smoothly toward the target heading (curved paths, any angle)
    if (P.tx !== undefined) {
      var cur = Math.atan2(P.hy, P.hx), want = Math.atan2(P.ty, P.tx);
      var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), maxTurn = BEYOND_TURN * dt;
      cur += Math.max(-maxTurn, Math.min(maxTurn, diff));
      P.hx = Math.cos(cur);
      P.hy = Math.sin(cur);
    }
    P.angle = Math.atan2(P.hy, P.hx);
    P.facing = FACE_OF_VEC(P.hx, P.hy);
    // move along the heading, sliding along the edge of the world
    P.x = DE.clamp(P.x + P.hx * sp * dt, -bx, bx);
    P.y = DE.clamp(P.y + P.hy * sp * dt, -by, by);
    // stars
    var stars = A.dots[0];
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      if (st.e || Math.hypot(st.x - P.x, st.y - P.y) > 0.6) continue;
      st.e = true;
      A.dotsLeft--;
      S.combo = S.t - this.lastDotT < 2.5 ? S.combo + 1 : 1;
      this.lastDotT = S.t;
      this._addScore(50);
      this._emit('dot', { combo: S.combo, mult: 1, space: 'arena', x: st.x, y: st.y });
      this._float('arena', st.x, st.y, '+50', DE.COLORS.dot);
      if (A.dotsLeft <= 0) this._allClear();
    }
    // the portal
    if (A.broken && Math.hypot(A.exitPoint.x - P.x, A.exitPoint.y - P.y) < B.portalR) {
      this._addScore(300);
      this._emit('breakout', { x: P.x, y: P.y });
      this._completeLevel();
      return;
    }
    // hunters: steer toward the player with a little wander, bounce off the edge
    for (var j = 0; j < A.enemies.length; j++) {
      var e = A.enemies[j], tx = P.x - e.x, ty = P.y - e.y, td = Math.hypot(tx, ty) || 1;
      var wob = Math.sin(S.t * 1.3 + j * 2.1) * 0.9;
      var wx = tx / td - wob * ty / td, wy = ty / td + wob * tx / td;
      var turn = Math.min(1, dt * 1.6);
      e.vx += (wx - e.vx) * turn;
      e.vy += (wy - e.vy) * turn;
      var vl = Math.hypot(e.vx, e.vy) || 1, es = B.enemySpeed * Math.min(B.huntMax, 1 + B.huntUp * rt);
      e.x += (e.vx / vl) * es * dt;
      e.y += (e.vy / vl) * es * dt;
      if (Math.abs(e.x) > bx) { e.x = DE.clamp(e.x, -bx, bx); e.vx = -e.vx; }
      if (Math.abs(e.y) > by) { e.y = DE.clamp(e.y, -by, by); e.vy = -e.vy; }
      e.facing = FACE_OF_VEC(e.vx, e.vy);
      e.angle = Math.atan2(e.vy, e.vx);
      if (S.phase !== 'arena') continue;
      var d = Math.hypot(P.x - e.x, P.y - e.y);
      if (d < CRASH_DIST + 0.1 && P.inv <= 0) { this._die('arena', P.x, P.y); return; }
      if (!e.near && d < NEAR_DIST && P.inv <= 0) {
        e.near = true;
        this._addScore(25);
        this._emit('near', { space: 'arena', x: P.x, y: P.y });
        this._float('arena', P.x, P.y, 'CLOSE! +25', DE.COLORS.exit);
      }
      if (d > NEAR_RESET) e.near = false;
    }
    if (S.phase === 'clear' && S.pt > 0.9) {
      A.broken = true; // the light opens
      S.phase = 'escape';
      S.pt = 0;
      this._float('arena', A.exitPoint.x, A.exitPoint.y, 'DRIVE INTO THE LIGHT', DE.COLORS.player);
    }
  };

  /* ------------------------------ Cloverleaf ------------------------------ */
  Game.prototype._startClover = function (silent) {
    var S = this.state, CL = DE.CLOVER;
    S.cfg = DE.levelConfig(S.level);
    S.nextCfg = DE.levelConfig(S.level + 1);
    var dots = [], total = 0;
    for (var loop = 0; loop < 4; loop++) {
      for (var k = 0; k < CL.lanes; k++) {
        var n = CL.DOTS[k], lane = [];
        for (var i = 0; i < n; i++) {
          var u = (i + 0.5) / n, p = DE.cloverPos(loop, k, u);
          lane.push({ u: u, e: false, x: p[0], y: p[1], loop: loop, lane: k });
        }
        dots.push(lane);
        total += n;
      }
    }
    var guard = [3, 1, 2]; // start in BR and TR (the player starts in TL); they roam from there
    var enemies = [];
    for (var j = 0; j < S.cfg.enemies; j++) {
      enemies.push({ loop: guard[j], u: 0.1 + 0.3 * j, laneF: j % 2, target: j % 2, dir: 1, x: 0, y: 0, facing: 1, near: false });
    }
    var exitLoop = CL.EXIT_LOOP[S.cfg.exitSide], c = CL.centers[exitLoop], v = DE.EXIT_VEC[S.cfg.exitSide];
    S.arena = {
      layout: 'clover',
      dots: dots,
      dotsLeft: total,
      total: total,
      broken: false,
      exitLoop: exitLoop,
      exitPoint: { x: c[0] + v[0] * 2.5, y: c[1] + v[1] * 2.5 }, // midpoint of the wall that breaks
      player: { loop: 0, u: 0.55, laneF: 0, target: 0, x: 0, y: 0, inv: 2.0, exit: false, ex: 0, ey: 0, facing: 0, dir: -1, tw: 0, twx: 0, twy: 0 },
      enemies: enemies,
      hint: null
    };
    S.road = null;
    S.phase = 'arena';
    S.pt = 0;
    S.combo = 0;
    S.mult = 1;
    this.lastGap = null;
    this.tapQ = null;
    this._placeCloverPlayer();
    for (var q = 0; q < enemies.length; q++) this._placeCloverEnemy(enemies[q]);
    if (!silent) this._emit('levelStart', { level: S.cfg.arenaNo, cfg: S.cfg });
  };

  Game.prototype._placeCloverPlayer = function () {
    var P = this.state.arena.player;
    var p = DE.cloverPos(P.loop, P.laneF, P.u);
    // after hopping loops the car glides across the gap (visual only)
    P.x = p[0] + P.twx * P.tw;
    P.y = p[1] + P.twy * P.tw;
    var side = DE.sideOf(P.u), slide = P.target - P.laneF;
    if (P.tw > 0.2) P.facing = FACING_OF[P.twDir] || P.facing;
    else if (Math.abs(slide) > 0.08) P.facing = FACING_OF[slide > 0 ? DE.INWARD[side] : DE.OUTWARD[side]];
    else P.facing = (P.dir > 0 ? ENEMY_FACING : PLAYER_FACING)[side];
  };
  Game.prototype._placeCloverEnemy = function (e) {
    var p = DE.cloverPos(e.loop, e.laneF, e.u);
    e.x = p[0];
    e.y = p[1];
    e.facing = (e.dir > 0 ? ENEMY_FACING : PLAYER_FACING)[DE.sideOf(e.u)];
  };

  // What happens at a gap on side s: { lane, hop: [loop, side] | null }
  Game.prototype._cloverDecide = function (loop, from, s) {
    var nb = DE.CLOVER.NEIGH[loop][s], max = DE.CLOVER.lanes - 1, wantIn = false, wantOut = false;
    if (this.dirMode) {
      var w = this._dirWants();
      wantIn = !!w[DE.INWARD[s]];
      wantOut = !!w[DE.OUTWARD[s]];
    } else {
      // hold = inner lane; a tap = outer lane or hop; nothing = keep the lane
      wantIn = this._holding();
      wantOut = !wantIn && !!this.tapQ;
    }
    if (wantIn && from < max) return { lane: from + 1, hop: null };
    if (wantOut && from > 0) return { lane: from - 1, hop: null };
    if (wantOut && from === 0 && nb) return { lane: 0, hop: nb };
    return { lane: from, hop: null };
  };

  Game.prototype._cloverHop = function (nb) {
    var P = this.state.arena.player, s = DE.sideOf(P.u);
    var old = DE.cloverPos(P.loop, 0, P.u);
    P.loop = nb[0];
    P.u = DE.MIDS[nb[1]];
    P.laneF = P.target = 0;
    var nw = DE.cloverPos(P.loop, 0, P.u);
    P.twx = old[0] - nw[0];
    P.twy = old[1] - nw[1];
    P.tw = 1;
    P.twDir = DE.OUTWARD[s];
    if (this.dirMode) this._clearQueue();
    this._emit('turn', {});
  };

  Game.prototype._cloverGap = function (m) {
    var S = this.state, A = S.arena, P = A.player, s = DE.MIDS.indexOf(m);
    if (S.phase === 'escape' && P.loop === A.exitLoop && s === S.cfg.exitSide && P.target === 0 && Math.abs(P.laneF) < 0.05) {
      P.exit = true;
      P.u = m;
      P.tw = 0;
      this._placeCloverPlayer();
      P.ex = DE.EXIT_VEC[s][0];
      P.ey = DE.EXIT_VEC[s][1];
      P.facing = s;
      this.lastGap = null;
      this._addScore(300);
      this._emit('breakout', { x: P.x, y: P.y });
      this._float('arena', P.x, P.y, 'BREAKOUT +300', DE.COLORS.exit);
      return true;
    }
    var from = P.target, d = this._cloverDecide(P.loop, from, s);
    this._queueAfterGap(!!d.hop || d.lane !== from);
    this._tapAfterGap(!!d.hop || d.lane < from);
    this.lastGap = { s: s, t: S.t, from: from, used: false, loop: P.loop };
    if (d.hop) { this._cloverHop(d.hop); this.lastGap.used = true; return true; }
    if (d.lane !== from) {
      P.target = d.lane;
      if (this.dirMode) this._clearQueue();
      this._emit('turn', {});
    }
    return false;
  };

  Game.prototype._cloverRegrace = function (g) {
    var P = this.state.arena.player;
    g.used = true;
    if (g.loop !== P.loop) return;
    var d = this._cloverDecide(P.loop, g.from, g.s);
    if (d.hop) { this._cloverHop(d.hop); return; }
    if (d.lane !== P.target) {
      P.target = d.lane;
      this._emit('turn', {});
    }
  };

  Game.prototype._cloverEat = function () {
    var S = this.state, A = S.arena, P = A.player;
    var k = Math.round(P.laneF);
    if (Math.abs(P.laneF - k) > 0.3 || P.tw > 0.3) return;
    var lane = A.dots[P.loop * DE.CLOVER.lanes + k], perim = 8 * (2 - k);
    for (var i = 0; i < lane.length; i++) {
      var d = lane[i];
      if (d.e) continue;
      var du = Math.abs(d.u - P.u);
      du = Math.min(du, 1 - du);
      if (du * perim >= EAT_DIST) continue;
      d.e = true;
      A.dotsLeft--;
      S.combo = S.t - this.lastDotT < 1.0 ? S.combo + 1 : 1;
      this.lastDotT = S.t;
      var m = Math.min(5, 1 + Math.floor(S.combo / 6));
      if (m > S.mult) {
        this._emit('combo', { mult: m, space: 'arena', x: d.x, y: d.y });
        this._float('arena', d.x, d.y, 'COMBO x' + m, DE.COLORS.player);
      }
      S.mult = m;
      this._addScore(10 * m);
      this._emit('dot', { combo: S.combo, mult: S.mult, space: 'arena', x: d.x, y: d.y });
      // a loop you have fully cleared gets a bonus
      var loopLeft = 0;
      for (var kk = 0; kk < DE.CLOVER.lanes; kk++) {
        var ln = A.dots[P.loop * DE.CLOVER.lanes + kk];
        for (var q = 0; q < ln.length; q++) if (!ln[q].e) loopLeft++;
      }
      if (loopLeft === 0 && A.dotsLeft > 0) {
        var c = DE.CLOVER.centers[P.loop];
        this._addScore(100);
        this._float('arena', c[0], c[1], 'LOOP CLEAR +100', DE.COLORS.exit);
      }
      if (A.dotsLeft <= 0) { this._allClear(); return; }
    }
  };

  Game.prototype._updateClover = function (dt) {
    var S = this.state, A = S.arena, P = A.player, C = S.cfg, MIDS = DE.MIDS;
    var sp = C.playerSpeed * S.speedMul;
    P.tw = Math.max(0, P.tw - dt * 7);
    if (!P.exit) {
      var h = 2 - P.laneF, prev = P.u, nu = prev + (P.dir || -1) * (sp * dt) / (8 * h);
      var hopped = false;
      for (var i = 0; i < MIDS.length; i++) {
        var m = MIDS[i];
        if ((prev > m && nu <= m) || (prev < m && nu >= m)) {
          if (this._cloverGap(m)) { hopped = true; break; }
        }
      }
      if (!P.exit) {
        if (!hopped) P.u = wrap01(nu);
        var slide = LANE_SLIDE * Math.max(1, Math.abs(P.target - P.laneF)); // a 2-lane jump slides twice as fast
        P.laneF += DE.clamp(P.target - P.laneF, -dt * slide, dt * slide);
        this._placeCloverPlayer();
        this._cloverEat();
      }
    } else {
      P.x += P.ex * sp * 1.3 * dt;
      P.y += P.ey * sp * 1.3 * dt;
      P.facing = C.exitSide;
      if (Math.abs(P.x) > EXIT_DIST || Math.abs(P.y) > EXIT_DIST) { this._completeLevel(); return; }
    }
    for (var j = 0; j < A.enemies.length; j++) {
      var e = A.enemies[j];
      var he = 2 - e.laneF, ep = e.u, enu = ep + e.dir * (sp * C.enemySpeed * dt) / (8 * he);
      for (var q = 0; q < MIDS.length; q++) {
        var mq = MIDS[q];
        if ((ep < mq && enu >= mq) || (ep > mq && enu <= mq)) {
          // roam: from lane 0 a pink car may hop through a shared-wall gap into the next loop
          var nb = DE.CLOVER.NEIGH[e.loop][q];
          if (nb && e.target === 0 && Math.abs(e.laneF) < 0.05 && Math.random() < (P.loop === nb[0] ? 0.55 : 0.4)) {
            var land = DE.cloverPos(nb[0], 0, MIDS[nb[1]]);
            if (Math.hypot(land[0] - P.x, land[1] - P.y) > 2.5) { // never hop right on top of the player
              e.loop = nb[0];
              enu = MIDS[nb[1]];
              break;
            }
          }
          // in the player's loop it sometimes matches the player's lane; elsewhere it drifts
          if (P.loop === e.loop) { if (Math.random() < 0.35) e.target = P.target; }
          else if (Math.random() < 0.35) e.target = e.target === 1 ? 0 : (Math.random() < 0.4 ? 1 : 0);
        }
      }
      e.u = wrap01(enu);
      e.laneF += DE.clamp(e.target - e.laneF, -dt * LANE_SLIDE, dt * LANE_SLIDE);
      this._placeCloverEnemy(e);
      if (S.phase !== 'arena') continue;
      var d = Math.hypot(P.x - e.x, P.y - e.y);
      if (d < CRASH_DIST && P.inv <= 0) { this._die('arena', P.x, P.y); return; }
      if (!e.near && d < NEAR_DIST && P.inv <= 0) {
        e.near = true;
        this._addScore(25);
        this._emit('near', { space: 'arena', x: P.x, y: P.y });
        this._float('arena', P.x, P.y, 'CLOSE! +25', DE.COLORS.exit);
      }
      if (d > NEAR_RESET) e.near = false;
    }
    if (S.phase === 'clear' && S.pt > 0.9) {
      this._shatter();
      S.phase = 'escape';
      S.pt = 0;
    }
  };

  Game.prototype._hintClover = function () {
    var S = this.state, A = S.arena, P = A.player, MIDS = DE.MIDS;
    var nm = -1;
    for (var i = 0; i < MIDS.length; i++) {
      var m = MIDS[i];
      if (P.dir > 0) { if (m > P.u + 0.0005 && (nm < 0 || m < nm)) nm = m; }
      else if (m < P.u - 0.0005 && m > nm) nm = m;
    }
    if (nm < 0) nm = P.dir > 0 ? MIDS[0] : MIDS[3];
    var dist = wrap01(P.dir > 0 ? nm - P.u : P.u - nm) * 8 * (2 - P.laneF);
    var queued = (this.dirMode && !!this.dirBuf.dir) || (!this.dirMode && !!this.tapQ);
    if (dist >= HINT_DIST && !queued) return;
    var s = MIDS.indexOf(nm), k = P.target, nb = DE.CLOVER.NEIGH[P.loop][s];
    var d = this._cloverDecide(P.loop, k, s), options = [], p;
    if (k < DE.CLOVER.lanes - 1) {
      p = DE.cloverPos(P.loop, k + 1, nm);
      options.push({ dir: DE.INWARD[s], lane: k + 1, x: p[0], y: p[1], active: !d.hop && d.lane === k + 1 });
    }
    if (k > 0) {
      p = DE.cloverPos(P.loop, k - 1, nm);
      options.push({ dir: DE.OUTWARD[s], lane: k - 1, x: p[0], y: p[1], active: !d.hop && d.lane === k - 1 });
    } else if (nb) {
      p = DE.cloverPos(nb[0], 0, MIDS[nb[1]]);
      options.push({ dir: DE.OUTWARD[s], lane: 0, x: p[0], y: p[1], active: !!d.hop, hop: true });
    }
    var st = DE.cloverPos(P.loop, k, nm);
    A.hint = {
      m: nm,
      alpha: queued ? 1 : DE.clamp(1 - dist / HINT_DIST, 0.25, 1),
      options: options,
      stay: !d.hop && d.lane === k,
      sx: st[0],
      sy: st[1]
    };
  };

  DE.Game = Game;

  /* ----------------------------------- UI ----------------------------------- */
  function $(id) {
    return document.getElementById(id);
  }
  function setText(el, txt) {
    if (el && el.textContent !== txt) el.textContent = txt;
  }
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function UI(game, audio) {
    var self = this;
    this.game = game;
    this.audio = audio;
    this.el = {};
    ['stage', 'hLv', 'hScore', 'hHi', 'hDots', 'hNp', 'bMusic', 'bPause', 'bFull',
      'sOver', 'oScore', 'oBest', 'oInfo', 'bAgain', 'sPause', 'sLevel', 'lKind', 'lName', 'lTips', 'sLevels', 'lvGrid', 'bLevels'].forEach(function (id) {
      self.el[id] = $(id);
    });
    this.hudT = 1;

    var ev = game.events;
    ev.on('mode', function () {
      self.screens();
      self.hud();
    });
    ev.on('pause', function () {
      self.screens();
      self.hud();
    });
    ev.on('gameOver', function (p) {
      var S = game.state;
      setText(self.el.oScore, DE.pad6(p.score));
      setText(self.el.oBest, p.newBest ? 'NEW BEST!' : 'BEST ' + DE.pad6(p.hi));
      var info = 'Level ' + p.level + ' · ';
      if (p.won) info = 'GAME COMPLETE! You broke out of all ' + DE.FINAL_LEVEL + ' levels';
      else if (S.phase === 'road') info += 'Crashed on the road';
      else if (p.dotsLeft > 0) info += (p.dotsLeft <= 3 ? 'So close! ' : '') + p.dotsLeft + (p.dotsLeft === 1 ? ' dot left' : ' dots left');
      else info += 'So close to the exit!';
      setText(self.el.oInfo, info);
      if (self.el.sOver) self.el.sOver.classList.toggle('best', !!p.newBest);
    });
    ev.on('levelStart', function () { self.hud(); });
    ev.on('roadStart', function () { self.hud(); });

    // fullscreen support (hidden where unsupported, e.g. iPhone Safari)
    var st = this.el.stage;
    this.fsSupported = !!(st && (st.requestFullscreen || st.webkitRequestFullscreen) &&
      (document.fullscreenEnabled || document.webkitFullscreenEnabled));
    if (this.el.bFull && !this.fsSupported) this.el.bFull.hidden = true;
    var onFs = function () {
      if (self.el.bFull) self.el.bFull.setAttribute('aria-pressed', fsElement() ? 'true' : 'false');
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    this.screens();
    this.hud();
  }

  var LEVEL_TIPS = {
    road: [
      ['↑  W', 'move up a lane'],
      ['↓  S', 'move down a lane'],
      ['TAP', 'tap / click above or below your car'],
      ['GOAL', 'dodge the pink cars, grab the dots']
    ],
    arena: [
      ['W A S D', 'press the way you want to turn (↑ ← ↓ → too)'],
      ['x2', 'press the same key twice quickly (or double-tap) to jump two lanes'],
      ['TAP', 'or tap / click on that side of your car'],
      ['GOAL', 'eat every dot to break the glowing wall']
    ]
  };
  UI.prototype.openLevels = function () {
    var g = this.game, S = g.state, el = this.el, self = this;
    if (!el.sLevels || !el.lvGrid) return;
    this.menuOpen = true;
    if (S.mode === 'play') g.setPaused(true);
    g.up();
    while (el.lvGrid.firstChild) el.lvGrid.removeChild(el.lvGrid.firstChild);
    var count = DE.FINAL_LEVEL;
    for (var n = 1; n <= count; n++) {
      var cfg = DE.levelConfig(n), b = document.createElement('button');
      b.type = 'button';
      b.className = 'lv-btn' + (n === S.level ? ' current' : '');
      b.disabled = n > S.checkpoint;
      b.style.setProperty('--lv-c', 'hsl(' + cfg.hue + ', 95%, 60%)');
      var a = document.createElement('span'), t = document.createElement('span');
      a.className = 'lv-n';
      t.className = 'lv-t';
      a.textContent = 'LEVEL ' + n + ' · ' + (cfg.kind === 'road' ? 'DODGE' : 'ARENA') + (n > S.checkpoint ? ' · 🔒' : '');
      t.textContent = cfg.name;
      b.appendChild(a);
      b.appendChild(t);
      (function (lv) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          self.closeLevels(true);
          g.selectLevel(lv);
          self.screens();
          self.hud();
        });
      })(n);
      el.lvGrid.appendChild(b);
    }
    el.sLevels.hidden = false;
    this.screens();
  };
  UI.prototype.closeLevels = function (picked) {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    if (this.el.sLevels) this.el.sLevels.hidden = true;
    if (!picked) this.game.setPaused(false);
    this.screens();
  };

  // phones / tablets: the same tips in touch terms
  var LEVEL_TIPS_TOUCH = {
    arena: [
      ['SWIPE', 'swipe the way you want to turn'],
      ['TAP', 'or tap on that side of your car'],
      ['x2', 'swipe or tap twice quickly to jump two lanes'],
      ['GOAL', 'eat every dot, then the glowing gate opens']
    ],
    road: [
      ['SWIPE', 'swipe up / down to change lanes'],
      ['TAP', 'or tap above / below your car'],
      ['GOAL', 'dodge the pink cars, grab the dots']
    ],
    beyond: [
      ['SWIPE', 'put a finger anywhere and slide it: the car turns that way'],
      ['TAP', 'or tap a spot and the car heads there'],
      ['GOAL', 'the world is big: find all 20 stars, then drive into the light'],
      ['WATCH', 'the longer you take, the faster new hunters join']
    ]
  };
  LEVEL_TIPS.beyond = [
    ['W A S D', 'drive in ANY direction (two keys = diagonal)'],
    ['DRAG', 'hold and move your finger / mouse: the car follows it'],
    ['GOAL', 'the world is big: find all 20 stars, then drive into the light'],
    ['WATCH', 'the longer you take, the faster new hunters join (up to 8)']
  ];
  LEVEL_TIPS.clover = [
    ['NEW', 'four loops: gaps in the shared walls lead into the next loop'],
    ['W A S D', 'press toward a gap to hop into the next loop'],
    ['TAP', 'or tap / click on that side of your car'],
    ['WATCH', 'the two pink cars roam all four loops'],
    ['GOAL', 'clear every loop, then exit through the glowing wall']
  ];
  UI.prototype.fillLevelCard = function () {
    var S = this.game.state, el = this.el;
    setText(el.lKind, 'LEVEL ' + S.level + ' OF ' + DE.FINAL_LEVEL + (S.phase === 'road' ? ' · DODGE' : ' · ARENA') + (S.level >= DE.FINAL_LEVEL ? ' · FINAL' : ''));
    setText(el.lName, S.cfg.name);
    if (!el.lTips) return;
    var kind = S.phase === 'road' ? 'road' : S.cfg.layout === 'beyond' ? 'beyond' : S.cfg.layout === 'clover' ? 'clover' : 'arena';
    var touchDev = false;
    try { touchDev = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* old browser */ }
    var tips = (touchDev && LEVEL_TIPS_TOUCH[kind]) || LEVEL_TIPS[kind];
    while (el.lTips.firstChild) el.lTips.removeChild(el.lTips.firstChild);
    for (var i = 0; i < tips.length; i++) {
      var li = document.createElement('li'), k = document.createElement('kbd'), t = document.createElement('span');
      k.textContent = tips[i][0];
      t.textContent = tips[i][1];
      li.appendChild(k);
      li.appendChild(t);
      el.lTips.appendChild(li);
    }
  };

  UI.prototype.screens = function () {
    var S = this.game.state, el = this.el;
    if (el.sOver) el.sOver.hidden = S.mode !== 'over';
    // level card: every new level waits for a press (level 1 on first load stays board-first)
    var showLevel = S.mode === 'ready' && (S.phase === 'road' || S.level > 1) && !this.game.celebrating();
    if (el.sLevel) {
      if (showLevel && el.sLevel.hidden) this.fillLevelCard();
      el.sLevel.hidden = !showLevel;
    }
    if (el.sPause) el.sPause.hidden = !(S.mode === 'play' && S.paused) || !!this.menuOpen;
    if (el.bPause) {
      setText(el.bPause, S.paused ? '▶' : 'II');
      el.bPause.setAttribute('aria-label', S.paused ? 'Resume' : 'Pause');
      el.bPause.setAttribute('aria-pressed', S.paused ? 'true' : 'false');
    }
  };

  UI.prototype.hud = function () {
    var S = this.game.state, el = this.el, a = this.audio;
    setText(el.hLv, 'LEVEL ' + S.level + ' · ' + S.cfg.name);
    // Beyond is a pale field: switch the HUD to dark text there
    if (el.stage) el.stage.classList.toggle('pale', S.phase !== 'road' && S.cfg.layout === 'beyond');
    setText(el.hScore, DE.pad6(S.score));
    setText(el.hHi, DE.pad6(Math.max(S.hi, S.score)));
    var dots;
    if (S.phase === 'road' && S.road) {
      var left = S.mode === 'ready' ? S.road.dur : Math.max(0, Math.ceil(S.road.dur - S.pt));
      var gone = Math.round(5 * (1 - left / S.road.dur));
      dots = 'ROAD ' + '▰▰▰▰▰'.slice(0, gone) + '▱▱▱▱▱'.slice(0, 5 - gone) + ' · ' + left + 's';
    }
    else if (S.arena && S.arena.layout === 'beyond') dots = S.arena.broken ? 'THE LIGHT IS OPEN · GO!' : 'STARS ' + (S.arena.total - S.arena.dotsLeft) + ' / ' + S.arena.total + ' · HUNTERS ' + S.arena.enemies.length;
    else if (S.arena && S.arena.broken) dots = 'WALL ▰▰▰▰▰ · EXIT ' + DE.SIDE_NAME[S.cfg.exitSide];
    else if (S.arena) {
      var A = S.arena, done = Math.round(5 * (1 - A.dotsLeft / Math.max(1, A.total)));
      dots = 'WALL ' + '▰▰▰▰▰'.slice(0, done) + '▱▱▱▱▱'.slice(0, 5 - done) + ' · ' + A.dotsLeft + ' LEFT' + (S.mult > 1 ? ' · x' + S.mult : '');
    } else dots = '';
    setText(el.hDots, dots);
    setText(el.hNp, (a && a.nowPlaying) || '');
    setText(el.bMusic, a && a.musicOn ? 'MUSIC ON' : 'MUSIC OFF');
  };

  // called every animation frame
  UI.prototype.frame = function (dt) {
    this.hudT += dt;
    if (this.el.sLevel && this.el.sLevel.hidden && this.game.state.mode === 'ready') this.screens();
    if (this.hudT >= 0.1) {
      this.hudT = 0;
      this.hud();
    }
  };

  UI.prototype.toggleFullscreen = function () {
    if (!this.fsSupported) return;
    var st = this.el.stage;
    try {
      var r;
      if (fsElement()) {
        r = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen();
      } else {
        r = st.requestFullscreen ? st.requestFullscreen() : st.webkitRequestFullscreen && st.webkitRequestFullscreen();
      }
      if (r && typeof r.catch === 'function') r.catch(function () {});
    } catch (e) { /* ignore */ }
  };

  DE.UI = UI;

  /* ---------------------------------- Input --------------------------------- */
  // The whole stage is one button; any key is the same button,
  // except W A S D / arrows, which steer by direction on laptops.
  var DIR_KEYS = {
    // every key points at a SCREEN direction: A = screen left, D = screen right, W = up, S = down
    KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right',
    ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right',
    arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right', up: 'up', left: 'left', down: 'down', right: 'right'
  };
  var PREVENT_KEYS = { ' ': 1, spacebar: 1, arrowup: 1, arrowdown: 1, arrowleft: 1, arrowright: 1, up: 1, down: 1, left: 1, right: 1 };
  var IGNORE_KEYS = { tab: 1, control: 1, alt: 1, meta: 1, os: 1, altgraph: 1, capslock: 1, contextmenu: 1, unidentified: 1 };

  var SWIPE_PX = 26; // finger travel that turns a touch into a swipe
  var JOY_DEAD = 10;  // INFINITY touch joystick: finger travel before it steers (px)
  var JOY_R = 55;     // joystick radius (px); the base follows the finger beyond this

  function isEditable(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }
  function isButton(t) {
    while (t && t.nodeType === 1) {
      if (t.tagName && t.tagName.toLowerCase() === 'button') return true;
      t = t.parentNode;
    }
    return false;
  }

  function Input(game, audio, ui) {
    var self = this;
    this.game = game;
    this.audio = audio;
    this.ui = ui;
    this.pointers = {};  // pointerId -> true
    this.keys = {};      // key id -> true
    var stage = $('stage');

    var unlock = function () {
      try { audio.unlock(); } catch (e) { /* ignore */ }
    };
    ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (n) {
      window.addEventListener(n, unlock, true);
    });

    var focusStage = function () {
      if (!stage) return;
      try { stage.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    };

    // ---- the single button ----
    this.isHeld = function () {
      for (var p in self.pointers) return true;
      for (var k in self.keys) return true;
      return false;
    };
    var add = function (map, id) {
      var was = self.isHeld();
      map[id] = true;
      if (!was) game.down();
    };
    var remove = function (map, id) {
      if (!map[id]) return;
      delete map[id];
      if (!self.isHeld()) game.up();
    };

    // screen direction from the player's car to a pointer event (road: above / below the car)
    this.pointerDir = {};
    var dirFromPointer = function (e) {
      var r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      var S = game.state, R = DE.app && DE.app.renderer, carX = r.width / 2, carY = r.height / 2;
      if (S.phase === 'road' && S.road) {
        carX = DE.ROAD.playerX * r.width;
        if (R && R.laneY) carY = R.laneY(S.road.laneF);
        return py < carY ? 'up' : 'down';
      }
      if (R && R.toPx && S.arena && S.arena.player) {
        var q = R.toPx({ space: 'arena', x: S.arena.player.x, y: S.arena.player.y });
        carX = q[0];
        carY = q[1];
      }
      var dx = px - carX, dy = py - carY;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    };

    // Beyond: steer toward the pointer's spot in the world
    this.dragId = null;
    this.joy = null;
    // show / hide the touch joystick (drawn by the renderer, in stage pixels)
    var showJoy = function (ax, ay, fx, fy) {
      var R0 = DE.app && DE.app.renderer;
      if (!R0) return;
      if (ax === null || ax === undefined) { R0.joy = null; return; }
      var rr = stage.getBoundingClientRect();
      R0.joy = { ax: ax - rr.left, ay: ay - rr.top, fx: fx - rr.left, fy: fy - rr.top, r: JOY_R };
    };
    var steerAt = function (e, quiet) {
      var S0 = game.state, R0 = DE.app && DE.app.renderer;
      if (!(S0.mode === 'play' && !S0.paused && S0.arena && S0.arena.layout === 'beyond' && R0 && R0.L)) return;
      var rr = stage.getBoundingClientRect(), cam = R0.cam || { x: 0, y: 0 };
      var wx = (e.clientX - rr.left - R0.cx) / R0.L + cam.x, wy = (e.clientY - rr.top - R0.cy) / R0.L + cam.y;
      game.steerTo(wx - S0.arena.player.x, wy - S0.arena.player.y, quiet);
    };

    // ---- pointer (mouse, touch, pen) on the whole stage ----
    if (stage) {
      stage.addEventListener('pointerdown', function (e) {
        if (isButton(e.target) || ui.menuOpen) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        focusStage();
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        // tap / click where you want to go: the direction from the player's car to the pointer
        var S0 = game.state, R0 = DE.app && DE.app.renderer;
        if (S0.mode === 'play' && !S0.paused && S0.phase !== 'road' && S0.arena && S0.arena.layout === 'beyond' && R0 && R0.L) {
          var rr = stage.getBoundingClientRect();
          if (e.pointerType !== 'mouse') {
            // touch: a floating joystick where the finger lands; the car turns the way the finger moves
            self.joy = { id: e.pointerId, ax: e.clientX, ay: e.clientY, moved: false, ev: { clientX: e.clientX, clientY: e.clientY } };
            showJoy(e.clientX, e.clientY, e.clientX, e.clientY);
            return;
          }
          self.dragId = e.pointerId; // mouse: keep steering toward the pointer while the button is down
          steerAt(e, false);
          return;
        }
        // touch while playing: wait to see if it is a swipe (direction of the swipe) or a tap
        if (e.pointerType !== 'mouse' && S0.mode === 'play' && !S0.paused) {
          self.touch = { id: e.pointerId, x: e.clientX, y: e.clientY, ev: { clientX: e.clientX, clientY: e.clientY }, done: false };
          return;
        }
        var dir = dirFromPointer(e);
        self.pointerDir['p' + e.pointerId] = dir;
        game.dirDown(dir);
      });
      var end = function (e) {
        var T = self.touch;
        if (T && T.id === e.pointerId) {
          self.touch = null;
          if (!T.done && e.type === 'pointerup') { var td = dirFromPointer(T.ev); game.dirDown(td); game.dirUp(td); } // a tap
          return;
        }
        var id = 'p' + e.pointerId, dir = self.pointerDir[id];
        if (!dir) return;
        delete self.pointerDir[id];
        game.dirUp(dir);
      };
      stage.addEventListener('pointermove', function (e) {
        if (self.dragId === e.pointerId) steerAt(e, true); // free-hand: the car follows the mouse
        var J = self.joy;
        if (J && J.id === e.pointerId) {
          var jx = e.clientX - J.ax, jy = e.clientY - J.ay, jd = Math.hypot(jx, jy);
          if (jd >= JOY_DEAD) {
            J.moved = true;
            game.steerTo(jx, jy, true);
            if (jd > JOY_R) { // the joystick base follows the finger, so it never runs out of room
              J.ax = e.clientX - (jx / jd) * JOY_R;
              J.ay = e.clientY - (jy / jd) * JOY_R;
            }
          }
          showJoy(J.ax, J.ay, e.clientX, e.clientY);
        }
        var T = self.touch;
        if (T && T.id === e.pointerId && !T.done) {
          var dx = e.clientX - T.x, dy = e.clientY - T.y;
          if (Math.hypot(dx, dy) >= SWIPE_PX) { // a swipe: steer the way the finger moved
            T.done = true;
            var sd = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
            game.dirDown(sd);
            game.dirUp(sd);
          }
        }
      });
      var endDrag = function (e) {
        if (self.dragId === e.pointerId) self.dragId = null;
        var J = self.joy;
        if (J && J.id === e.pointerId) {
          self.joy = null;
          showJoy(null);
          if (!J.moved && e.type === 'pointerup') steerAt(J.ev, false); // a plain tap: head toward that spot
        }
      };
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);
      stage.addEventListener('lostpointercapture', end);
      stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      // stop iOS double-tap zoom / long-press selection on the stage
      stage.addEventListener('touchstart', function (e) {
        if (!isButton(e.target) && e.cancelable) e.preventDefault();
      }, { passive: false });
    }

    // ---- keyboard: any key is the button ----
    var musicToggle = function () {
      try { audio.toggleMusic(); } catch (e) { /* ignore */ }
      ui.hud();
    };
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      var k = (e.key || '').toLowerCase();
      if (ui.menuOpen) {
        if (k === 'escape' || k === 'l') ui.closeLevels(false);
        return; // let Tab / Enter work on the level buttons
      }
      if (k === 'l') { ui.openLevels(); return; }
      if (PREVENT_KEYS[k]) e.preventDefault();
      if (e.repeat) return;
      if (k === 'm') { musicToggle(); return; }
      if (k === 'f') { userFs(); return; }
      if (k === 'p' || k === 'escape') { game.togglePause(); return; }
      if (IGNORE_KEYS[k]) return;
      if (k === 'enter' && isButton(e.target)) return; // let Enter activate a focused HUD button
      var dir = DIR_KEYS[e.code] || DIR_KEYS[k];
      if (dir) { game.dirDown(dir); return; }
      // any other key (Space, Enter, ...) only starts, restarts or resumes; it never steers
      if (game.state.mode === 'play' && !game.state.paused) return;
      add(self.keys, e.code || k);
    });
    window.addEventListener('keyup', function (e) {
      var k = (e.key || '').toLowerCase();
      if (PREVENT_KEYS[k]) e.preventDefault();
      var dir = DIR_KEYS[e.code] || DIR_KEYS[k];
      if (dir) { game.dirUp(dir); return; }
      remove(self.keys, e.code || k);
    });

    // ---- phones / tablets: landscape only ----
    // Turning the device upright pauses the game (a "rotate your device" screen covers it).
    // The first touch goes fullscreen and asks the browser to lock landscape (Android; iOS ignores it).
    var portrait = null;
    try { portrait = window.matchMedia('(pointer: coarse) and (orientation: portrait)'); } catch (e) { /* old browser */ }
    var onOrient = function () {
      if (portrait && portrait.matches) { self.releaseAll(); game.setPaused(true); }
    };
    if (portrait) {
      if (portrait.addEventListener) portrait.addEventListener('change', onOrient);
      else if (portrait.addListener) portrait.addListener(onOrient);
    }
    // Block browser swipe gestures page-wide (except inside scrollable cards/menus), so a swipe
    // never scrolls or pulls-to-refresh and drops fullscreen.
    document.addEventListener('touchmove', function (e) {
      var t = e.target, scroller = t && t.closest && t.closest('.card, .lv-grid');
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    // If fullscreen is dropped anyway (e.g. iPad / Samsung "swipe down to exit"), pause, and the next tap restores it.
    var onFsChange = function () {
      if (!(document.fullscreenElement || document.webkitFullscreenElement) && self.wantFs) { self.releaseAll(); game.setPaused(true); }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    stage && stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      if (document.fullscreenElement || document.webkitFullscreenElement) return;
      if (self.wantFs === false) return; // the player left fullscreen on purpose (button / F)
      self.wantFs = true;
      try {
        var root = document.documentElement, fs = document.fullscreenElement || document.webkitFullscreenElement;
        var req = !fs && (root.requestFullscreen || root.webkitRequestFullscreen);
        var lock = function () {
          try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (err) { /* unsupported */ }
        };
        if (req) {
          var p = req.call(root);
          if (p && p.then) p.then(lock, function () {}); else lock();
        } else lock();
      } catch (err) { /* ignore */ }
    }, true);

    // ---- auto pause ----
    window.addEventListener('blur', function () {
      self.releaseAll();
      game.setPaused(true);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        self.releaseAll();
        game.setPaused(true);
      }
    });

    // ---- HUD buttons (stop propagation so they never act as the game button) ----
    var on = function (id, fn) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        fn(e);
      });
      el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    };
    on('bAgain', function () {
      if (game.restart()) focusStage();
    });
    on('bPause', function () { game.togglePause(); });
    on('bMusic', musicToggle);
    // the fullscreen button / F key: leaving fullscreen on purpose must not be undone by the next tap
    var userFs = function () { self.wantFs = !(document.fullscreenElement || document.webkitFullscreenElement); ui.toggleFullscreen(); };
    on('bFull', userFs);
    on('bLevels', function () { if (ui.menuOpen) ui.closeLevels(false); else ui.openLevels(); });
    on('bLvClose', function () { ui.closeLevels(false); });
    on('bLvReset', function () { ui.closeLevels(true); game.resetProgress(); ui.screens(); ui.hud(); });
  }

  Input.prototype.releaseAll = function () {
    this.pointers = {};
    this.keys = {};
    this.pointerDir = {};
    this.touch = null;
    this.joy = null;
    if (DE.app && DE.app.renderer) DE.app.renderer.joy = null;
    for (var d in this.game.dirHeld) this.game.dirUp(d);
    this.game.up();
  };

  DE.Input = Input;

  /* ---------------------------------- Boot ---------------------------------- */
  function makeAudioStub() {
    return {
      musicOn: false,
      nowPlaying: '',
      attach: function () {},
      unlock: function () {},
      toggleMusic: function () { this.musicOn = !this.musicOn; return this.musicOn; }
    };
  }
  function makeRendererStub() {
    return { attach: function () {}, resize: function () {}, update: function () {}, render: function () {} };
  }

  function boot() {
    var game = new Game();
    var cv = $('cv'), stage = $('stage');

    var renderer;
    if (typeof DE.Renderer === 'function') {
      try { renderer = new DE.Renderer(cv); } catch (e) {
        console.error('[DodgeEm] DE.Renderer failed to construct:', e);
      }
    } else {
      console.error('[DodgeEm] DE.Renderer is missing. Is js/render.js loaded (after game.js)?');
    }
    if (!renderer) renderer = makeRendererStub();

    var audio;
    if (typeof DE.AudioEngine === 'function') {
      try { audio = new DE.AudioEngine(); } catch (e) {
        console.error('[DodgeEm] DE.AudioEngine failed to construct:', e);
      }
    } else {
      console.error('[DodgeEm] DE.AudioEngine is missing. Is js/audio.js loaded? Running without sound.');
    }
    if (!audio) audio = makeAudioStub();

    var ui = new UI(game, audio);
    var input = new Input(game, audio, ui);
    try { renderer.attach(game); } catch (e) { console.error('[DodgeEm] renderer.attach failed:', e); }
    try { audio.attach(game); } catch (e) { console.error('[DodgeEm] audio.attach failed:', e); }
    DE.app = { game: game, renderer: renderer, audio: audio, ui: ui, input: input };

    // ---- sizing ----
    var lastW = -1, lastH = -1;
    var doResize = function () {
      var el = stage || cv;
      if (!el) return;
      var r = el.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      try { renderer.resize(w, h); } catch (e) { console.error('[DodgeEm] renderer.resize failed:', e); }
      // level 1 and INFINITY take the screen's shape
      try { if (renderer.playAspect) game.setAspect(renderer.playAspect()); } catch (e) { /* ignore */ }
    };
    if (typeof window.ResizeObserver === 'function' && stage) {
      new window.ResizeObserver(doResize).observe(stage);
    } else {
      window.addEventListener('resize', doResize);
      window.addEventListener('orientationchange', function () {
        doResize();
        setTimeout(doResize, 300);
      });
    }
    doResize();

    // ---- loop ----
    var last = 0, errors = 0;
    var frame = function (now) {
      requestAnimationFrame(frame);
      var dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0;
      last = now;
      try {
        if (!game.state.paused) {
          game.update(dt);
          renderer.update(dt);
        }
        renderer.render(game.state);
        ui.frame(dt);
      } catch (e) {
        if (errors++ < 5) console.error('[DodgeEm] frame error:', e);
      }
    };
    var started = false;
    var go = function () {
      if (started) return;
      started = true;
      doResize();
      requestAnimationFrame(frame);
    };
    if (document.fonts && typeof document.fonts.load === 'function') {
      var fontP;
      try { fontP = document.fonts.load('12px "JetBrains Mono"'); } catch (e) { fontP = null; }
      Promise.race([
        fontP || Promise.resolve(),
        new Promise(function (r) { setTimeout(r, 1200); })
      ]).then(go, go);
    } else {
      go();
    }
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    var booted = false;
    var bootOnce = function () {
      if (booted) return;
      booted = true;
      boot();
    };
    if (document.readyState === 'complete') setTimeout(bootOnce, 0);
    else {
      // DOMContentLoaded fires after all deferred scripts (render.js, audio.js) have run.
      document.addEventListener('DOMContentLoaded', bootOnce);
      window.addEventListener('load', bootOnce); // safety net if DCL already fired
    }
  }
})();
