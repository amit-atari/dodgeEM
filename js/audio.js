/* Dodge 'Em Beyond - audio.js
 * DE.AudioEngine: WebAudio synth SFX, a file music player (one reused
 * HTMLAudioElement, because fetch/decodeAudioData fails on file://) and a
 * synth FM sequencer fallback. See docs/ARCHITECTURE.md.
 */
(function () {
  'use strict';

  var DE = (window.DE = window.DE || {});

  /* ===================== MUSIC TRACK LIST =====================
   * Filled in by the music agent. Each entry:
   *   {
   *     title:   'Track Title',
   *     artist:  'Artist Name',
   *     file:    'assets/music/xyz.mp3',   // relative to index.html
   *     license: 'CC0' | 'CC-BY 4.0' | ...,
   *     source:  'https://where-it-came-from',
   *     role:    'arena' | 'road' | 'title'
   *   }
   * Role selection:
   *   arena -> played on levelStart, picked by level: arena[(level - 1) % arena.length]
   *   road  -> played on roadStart,  picked by level: road[(level - 1) % road.length]
   *   title -> v2 has no title screen; kept in the list but currently unused.
   * A role with no entries (or whose files fail to load) falls back to the
   * built-in synth sequencer. v2 modes: 'ready' is silent; 'over' keeps the
   * current music playing, ducked, and it's restored on the next 'play'.
   * All tracks are CC0 1.0; see assets/music/CREDITS.md.
   */
  DE.TRACKS = DE.TRACKS || [];
  if (!DE.TRACKS.length) {
    DE.TRACKS.push(
      { title: 'Level 1', artist: 'Juhani Junkala', file: 'assets/music/arena-01-junkala-level-1.mp3', license: 'CC0 1.0', source: 'https://opengameart.org/content/5-chiptunes-action', role: 'arena' },
      { title: 'Electro', artist: 'Pro Sensory', file: 'assets/music/arena-02-prosensory-electro.mp3', license: 'CC0 1.0', source: 'https://opengameart.org/content/electro', role: 'arena' },
      { title: 'Level 3', artist: 'Juhani Junkala', file: 'assets/music/arena-03-junkala-level-3.mp3', license: 'CC0 1.0', source: 'https://opengameart.org/content/5-chiptunes-action', role: 'arena' },
      { title: 'Neon Hyperdrive', artist: 'Adiutorium', file: 'assets/music/arena-04-adiutorium-neon-hyperdrive.mp3', license: 'CC0 1.0', source: 'https://opengameart.org/content/neon-hyperdrive', role: 'arena' },
      { title: 'Slipstream', artist: 'cinameng', file: 'assets/music/road-cinameng-slipstream.mp3', license: 'CC0 1.0', source: 'https://opengameart.org/content/slipstream', role: 'road' },
      { title: 'Synthwave 421k', artist: 'The Cynic Project', file: 'assets/music/title-cynic-project-synthwave-421k.mp3', license: 'CC0 1.0', source: 'https://opengameart.org/content/calm-relax-1-synthwave-421k', role: 'title' }
    );
  }

  /* ===================== CONSTANTS ===================== */
  var MUSIC_VOL = 0.45;        // HTMLAudioElement volume
  var SYNTH_VOL = 0.3;         // synth music bus gain
  var DUCK = 0.35;             // music level multiplier while ducked ('over')
  var DUCK_LP = 900;           // synth bus low-pass cutoff while ducked (Hz)
  var SFX_VOL = 0.55;
  var FADE_SEC = 0.6;          // total crossfade (half out, half in)
  var LS_KEY = 'dodgeem.musicOn';

  var SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31]; // pentatonic
  var BASS = [0, null, 0, 12, null, 0, 7, null, 0, null, 0, 10, null, 7, 5, 3];
  var LEAD = [12, null, 15, null, 19, null, 15, null, 12, null, 10, null, 7, null, 10, null];
  var LEAD_B = [19, null, 17, 15, null, 12, null, 15, 17, null, 19, null, 22, null, 19, null];
  var ROOTS = [45, 41, 43, 40, 38, 46, 42, 44]; // one root per level (cycles)
  var SYNTH_ARENA = [
    '01 · Head On At Midnight',
    '03 · Four Ways Home',
    '04 · Inward',
    '05 · Between Stations'
  ];
  var SYNTH_ROAD = '02 · Offramp Lullaby';
  var SILENCE = '— · Silence';

  function mhz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // Tiny silent WAV (1 sample) as a data URI, used to prime the <audio>
  // element inside the first gesture on iOS when no file track is loaded yet.
  function silentWav() {
    try {
      var b = [];
      var w32 = function (v) { b.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); };
      var w16 = function (v) { b.push(v & 255, (v >> 8) & 255); };
      var str = function (s) { for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i)); };
      str('RIFF'); w32(38); str('WAVE'); str('fmt '); w32(16); w16(1); w16(1);
      w32(8000); w32(16000); w16(2); w16(16); str('data'); w32(2); w16(0);
      return 'data:audio/wav;base64,' + btoa(String.fromCharCode.apply(null, b));
    } catch (e) { return ''; }
  }

  var BEYOND_TRACK_LEVEL = 4; // arena track index used for INFINITY (Neon Hyperdrive)

  /* ===================== ENGINE ===================== */
  function AudioEngine() {
    // Music always starts ON when the game opens. (It used to remember "off" forever, so one
    // accidental M press made the game silent on every visit.) M / the button still toggle it.
    this.musicOn = true;
    try { window.localStorage.removeItem(LS_KEY); } catch (e) { /* storage blocked */ }

    this.nowPlaying = SYNTH_ARENA[0];
    this.unlocked = false;
    this.paused = false;
    this.mode = 'ready';
    this.ducked = false;
    this.level = 1;

    // WebAudio (created on first unlock)
    this.ac = null;
    this.master = null;
    this.sfxBus = null;
    this.musBus = null;
    this.noiseBuf = null;

    // Synth sequencer
    this.synthActive = false;
    this.synthRole = 'arena';
    this.synthLevel = 1;
    this.nextNote = 0;
    this.step = 0;
    this.bar = 0;
    this._schedTimer = 0;

    // File music
    this.el = null;
    this.fileActive = false;
    this.track = null;        // current DE.TRACKS entry
    this._failed = {};        // file -> true once it errors
    this._fadeTimer = 0;
    this._switchId = 0;
    this._needsPlay = false;  // play() was blocked; retry on next gesture
    this._priming = false;
    this._want = { role: 'arena', level: 1 };

    var self = this;
    try {
      if (typeof Audio !== 'undefined') {
        var el = new Audio();
        el.loop = true;
        el.preload = 'auto';
        el.volume = 0;
        el.setAttribute('playsinline', '');
        el.addEventListener('error', function () { self._onFileError(); });
        this.el = el;
      }
    } catch (e) { this.el = null; }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) self._resumeCtx();
    });
  }

  /* ---------- public API ---------- */

  AudioEngine.prototype.attach = function (game) {
    var self = this;
    this.game = game;
    var st = game && game.state;
    if (st) {
      this.mode = st.mode || 'ready';
      this.level = st.level || 1;
      this.paused = !!st.paused;
    }
    var ev = game.events;
    var on = function (name, fn) { ev.on(name, function (p) { try { fn(p || {}); } catch (e) { /* never break the game */ } }); };

    on('mode', function (p) { self._onMode(p.mode); });
    on('levelStart', function (p) {
      self.level = p.level || self.level;
      var g = self.game && self.game.state;
      if (self.mode === 'play') self._select('arena', g && g.cfg && g.cfg.layout === 'beyond' ? BEYOND_TRACK_LEVEL : self.level);
    });
    on('roadStart', function (p) {
      self.level = p.level || self.level;
      if (self.mode === 'play') self._select('road', self.level);
    });
    on('pause', function (p) { self._setPaused(!!p.paused); });

    on('turn', function () { if (self._sfxOk()) self.sfxTurn(); });
    on('dot', function (p) { if (self._sfxOk()) self.sfxDot(p.combo || 1); });
    on('combo', function (p) { if (self._sfxOk()) self.sfxCombo(p.mult || 2); });
    on('near', function () { if (self._sfxOk()) self.sfxNear(); });
    on('crash', function (p) { if (self._sfxOk()) self.sfxCrash(); });
    on('clear', function () { if (self._sfxOk()) self.sfxArp([0, 7, 12, 19, 24], 0.08); });
    on('shatter', function () { if (self._sfxOk()) self.sfxShatter(); });
    on('breakout', function () { if (self._sfxOk()) self.sfxBreakout(); });
    on('levelComplete', function () { self.sfxVictory(); });
    on('gameOver', function (p) { if (self.ac) { if (p.won) self.sfxVictory(); else self.sfxGameOver(); } });

    this._onMode(this.mode, true);
  };

  AudioEngine.prototype.unlock = function () {
    if (this.unlocked) {
      // Cheap path: recover from iOS interruptions / tab switches.
      this._resumeCtx();
      if (this._needsPlay && this.fileActive && this._canPlay()) {
        this._playEl();
        this._fade(this._fileVol(), FADE_SEC / 2);
      }
      return;
    }
    this.unlocked = true;
    this._initCtx();
    this._resumeCtx();
    if (this.ac) {
      try {
        var buf = this.ac.createBuffer(1, 1, 22050);
        var src = this.ac.createBufferSource();
        src.buffer = buf;
        src.connect(this.ac.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
    }
    if (this.el) {
      if (this.fileActive && this.track) {
        if (this._canPlay()) {
          this._playEl();
          this._fade(this._fileVol(), FADE_SEC / 2);
        }
      } else if (DE.TRACKS.length) {
        this._primeEl();
      }
    }
    this._applySynthGain();
  };

  AudioEngine.prototype.toggleMusic = function () {
    this.musicOn = !this.musicOn;
    this.unlock();
    if (this.fileActive) {
      if (this.musicOn) {
        if (this._canPlay()) { this._playEl(); this._fade(this._fileVol(), FADE_SEC / 2); }
      } else {
        this._fadeOutAndPause(FADE_SEC / 2);
      }
    }
    this._applySynthGain();
    return this.musicOn;
  };

  /* ---------- state / selection ---------- */

  AudioEngine.prototype._rolesFor = function (role) {
    var out = [];
    var list = DE.TRACKS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].role === role && list[i].file) out.push(list[i]);
    }
    return out;
  };

  AudioEngine.prototype._pick = function (role, level) {
    var list = this._rolesFor(role);
    if (!list.length) return null;
    var start = role === 'title' ? 0 : ((level - 1) % list.length + list.length) % list.length;
    for (var k = 0; k < list.length; k++) {
      var t = list[(start + k) % list.length];
      if (!this._failed[t.file]) return t;
    }
    return null;
  };

  // v2 modes: 'ready' = silent frozen board (music starts with the first
  // press); 'play' = full music; 'over' = keep the current music, ducked,
  // under the gameOver sting. It is restored (not restarted) on the next 'play'.
  AudioEngine.prototype._onMode = function (mode, initial) {
    this.mode = mode || this.mode;
    if (this.mode === 'play') {
      this._setDuck(false);
      var st = this.game && this.game.state;
      // levels alternate arena / road; tracks are chosen by arena number
      var lvl = (st && st.cfg && st.cfg.arenaNo) || this.level;
      var road = st && st.phase === 'road';
      this.hadPlay = true;
      var beyond = st && st.cfg && st.cfg.layout === 'beyond' && !road;
      // level 3 (INFINITY) gets the most energetic arena track, "Neon Hyperdrive" (4th arena track)
      this._select(road ? 'road' : 'arena', beyond ? BEYOND_TRACK_LEVEL : lvl);
    } else if (this.mode === 'over') {
      this._setDuck(true);
    } else if (this.hadPlay) {
      // 'ready' between levels (waiting for a press): keep the music, ducked
      this._setDuck(true);
    } else {
      // 'ready' (or anything unknown): silent, but show what will play.
      this._stopMusic();
      var t = this._pick('arena', 1);
      if (t) this._setNowPlaying(t);
      else this.nowPlaying = SYNTH_ARENA[0];
    }
  };

  AudioEngine.prototype._fileVol = function () {
    return MUSIC_VOL * (this.ducked ? DUCK : 1);
  };

  AudioEngine.prototype._setDuck = function (on) {
    if (this.ducked === on) return;
    this.ducked = on;
    if (this.fileActive && this.el && !this.el.paused) this._fade(this._fileVol(), on ? 0.25 : 0.4);
    this._applySynthGain();
  };

  AudioEngine.prototype._select = function (role, level) {
    this._want = { role: role, level: level };
    var t = this._pick(role, level);
    if (t) this._playFile(t);
    else this._playSynth(role, level);
  };

  AudioEngine.prototype._canPlay = function () {
    return this.unlocked && this.musicOn && !this.paused;
  };

  AudioEngine.prototype._sfxOk = function () {
    return !!this.ac && this.mode === 'play' && !this.paused;
  };

  /* ---------- file music ---------- */

  AudioEngine.prototype._fade = function (target, secs, done) {
    var el = this.el;
    if (this._fadeTimer) {
      clearInterval(this._fadeTimer);
      this._fadeTimer = 0;
      // A newer fade must never swallow an older fade's callback (e.g. the track swap that runs
      // after a fade-out): finish it now, then let this fade take over from the current volume.
      var pending = this._fadeDone;
      this._fadeDone = null;
      if (pending) {
        pending();
        if (this._fadeTimer) { clearInterval(this._fadeTimer); this._fadeTimer = 0; this._fadeDone = null; }
      }
    }
    if (!el) { if (done) done(); return; }
    var from = el.volume;
    var steps = Math.max(1, Math.round((secs * 1000) / 30));
    var i = 0;
    var self = this;
    this._fadeDone = done || null;
    this._fadeTimer = setInterval(function () {
      i++;
      var v = from + (target - from) * (i / steps);
      try { el.volume = Math.max(0, Math.min(1, v)); } catch (e) { /* iOS: volume is read-only */ }
      if (i >= steps) {
        clearInterval(self._fadeTimer);
        self._fadeTimer = 0;
        var d = self._fadeDone;
        self._fadeDone = null;
        if (d) d();
      }
    }, 30);
  };

  AudioEngine.prototype._fadeOutAndPause = function (secs, done) {
    var el = this.el;
    if (!el) { if (done) done(); return; }
    if (el.paused) {
      try { el.volume = 0; } catch (e) { /* ignore */ }
      if (done) done();
      return;
    }
    this._fade(0, secs, function () {
      try { el.pause(); } catch (e) { /* ignore */ }
      if (done) done();
    });
  };

  AudioEngine.prototype._playEl = function () {
    var el = this.el;
    if (!el) return;
    var self = this;
    var track = this.track;
    this._needsPlay = false;
    try { el.muted = false; } catch (e) { /* ignore */ }
    var p;
    try { p = el.play(); } catch (e) { p = null; }
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) {
        var name = err && err.name;
        if (name === 'NotAllowedError') {
          self._needsPlay = true;         // retry on the next gesture
        } else if (name === 'NotSupportedError') {
          if (track && self.track === track) self._onFileError();
        }
        // AbortError: src changed / paused mid-load; ignore.
      });
    }
  };

  AudioEngine.prototype._primeEl = function () {
    var el = this.el;
    var uri = silentWav();
    if (!el || !uri || this.fileActive) return;
    var self = this;
    this._priming = true;
    try {
      el.src = uri;
      el.volume = 0;
      var p = el.play();
      var after = function () {
        self._priming = false;
        if (!self.fileActive) { try { el.pause(); } catch (e) { /* ignore */ } }
      };
      if (p && typeof p.then === 'function') p.then(after, after);
      else after();
    } catch (e) { this._priming = false; }
  };

  AudioEngine.prototype._playFile = function (track) {
    var el = this.el;
    if (!el) { this._playSynth(this._want.role, this._want.level); return; }

    this._stopSynth();
    this._setNowPlaying(track);

    if (this.fileActive && this.track === track) {
      if (this._canPlay()) {
        if (el.paused) this._playEl();
        this._fade(this._fileVol(), FADE_SEC / 2);
      }
      return;
    }

    var wasPlaying = this.fileActive && !el.paused;
    this.fileActive = true;
    this.track = track;
    var id = ++this._switchId;
    var self = this;
    var swap = function () {
      if (id !== self._switchId) return;
      try {
        el.pause();
        el.volume = 0;
        el.src = track.file;
        el.loop = true;
        el.load();
      } catch (e) { self._onFileError(); return; }
      if (self._canPlay()) {
        self._playEl();
        self._fade(self._fileVol(), FADE_SEC / 2);
      }
    };
    if (wasPlaying) this._fade(0, FADE_SEC / 2, swap);
    else swap();
  };

  AudioEngine.prototype._onFileError = function () {
    if (this._priming || !this.fileActive || !this.track) return;
    this._failed[this.track.file] = true;
    this.fileActive = false;
    this.track = null;
    this._switchId++;
    try { this.el.pause(); } catch (e) { /* ignore */ }
    // Re-run selection: tries the next track of the role, else the synth.
    var w = this._want;
        this._select(w.role, w.level);
  };

  AudioEngine.prototype._stopFile = function () {
    if (!this.fileActive) return;
    this.fileActive = false;
    this.track = null;
    this._switchId++;
    this._fadeOutAndPause(FADE_SEC / 2);
  };

  AudioEngine.prototype._stopMusic = function () {
    this._stopFile();
    this._stopSynth();
    this.nowPlaying = SILENCE;
  };

  AudioEngine.prototype._setNowPlaying = function (track) {
    var idx = (DE.TRACKS || []).indexOf(track);
    var s = track.title || 'Untitled';
    if (track.artist) s += ' — ' + track.artist;
    this.nowPlaying = s;
  };

  /* ---------- pause ---------- */

  AudioEngine.prototype._setPaused = function (paused) {
    this.paused = paused;
    if (paused) {
      if (this.ac && this.ac.state === 'running') {
        try { var p = this.ac.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
      }
      if (this.el && !this.el.paused) { try { this.el.pause(); } catch (e) { /* ignore */ } }
    } else {
      this._resumeCtx();
      if (this.fileActive && this._canPlay()) {
        this._playEl();
        this._fade(this._fileVol(), 0.2);
      }
    }
  };

  /* ---------- WebAudio setup ---------- */

  AudioEngine.prototype._initCtx = function () {
    if (this.ac) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ac = new AC();
      var master = ac.createGain();
      master.gain.value = 0.8;
      var comp = ac.createDynamicsCompressor ? ac.createDynamicsCompressor() : null;
      if (comp) { master.connect(comp); comp.connect(ac.destination); }
      else master.connect(ac.destination);

      var sfx = ac.createGain();
      sfx.gain.value = SFX_VOL;
      sfx.connect(master);

      var mus = ac.createGain();
      mus.gain.value = 0;
      var lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000;
      mus.connect(lp);
      lp.connect(master);
      this.musFilter = lp;

      var nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      var d = nb.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      this.ac = ac;
      this.master = master;
      this.sfxBus = sfx;
      this.musBus = mus;
      this.noiseBuf = nb;
      this.nextNote = ac.currentTime + 0.1;

      var self = this;
      this._schedTimer = setInterval(function () { self._sched(); }, 25);
    } catch (e) {
      this.ac = null;
    }
  };

  AudioEngine.prototype._resumeCtx = function () {
    var ac = this.ac;
    if (!ac || this.paused || !this.unlocked) return;
    if (ac.state === 'suspended' || ac.state === 'interrupted') {
      try { var p = ac.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
    }
  };

  /* ---------- synth primitives ---------- */

  AudioEngine.prototype.tone = function (type, f0, f1, dur, vol, when, dest) {
    var ac = this.ac;
    if (!ac) return;
    var t = when || ac.currentTime;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.03);
  };

  AudioEngine.prototype.nz = function (dur, vol, f0, f1, type, dest, when) {
    var ac = this.ac;
    if (!ac) return;
    var t = when || ac.currentTime;
    var s = ac.createBufferSource();
    s.buffer = this.noiseBuf;
    var f = ac.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxBus);
    s.start(t);
    s.stop(t + dur + 0.03);
  };

  /* ---------- SFX ---------- */

  AudioEngine.prototype.sfxTurn = function () { this.tone('triangle', 300, 600, 0.07, 0.16); };

  AudioEngine.prototype.sfxDot = function (combo) {
    var n = SCALE[Math.max(0, Math.min(combo - 1, SCALE.length - 1))];
    var f = 523 * Math.pow(2, n / 12);
    this.tone('square', f, 0, 0.07, 0.1);
    this.tone('sine', f * 2, 0, 0.05, 0.04);
  };

  AudioEngine.prototype.sfxCombo = function (mult) {
    if (!this.ac) return;
    var t = this.ac.currentTime;
    var f = 659 * Math.pow(2, Math.min(mult, 8) * 2 / 12);
    this.tone('square', f, 0, 0.08, 0.08, t);
    this.tone('square', f * 1.5, 0, 0.14, 0.08, t + 0.07);
    this.tone('triangle', f * 2, f * 2.02, 0.2, 0.06, t + 0.07);
  };

  AudioEngine.prototype.sfxNear = function () { this.tone('sine', 1300, 1900, 0.1, 0.12); };

  AudioEngine.prototype.sfxCrash = function () {
    this.nz(0.6, 0.7, 2400, 120, 'lowpass');
    this.tone('sawtooth', 220, 40, 0.5, 0.22);
    this.tone('square', 110, 30, 0.9, 0.12); // v2: every crash ends the run
  };

  AudioEngine.prototype.sfxShatter = function () {
    this.nz(1.1, 0.6, 6000, 300, 'bandpass');
    this.tone('square', 880, 110, 0.8, 0.1);
  };

  AudioEngine.prototype.sfxArp = function (notes, gap) {
    if (!this.ac) return;
    var t = this.ac.currentTime;
    for (var i = 0; i < notes.length; i++) {
      this.tone('square', 523 * Math.pow(2, notes[i] / 12), 0, 0.14, 0.1, t + i * gap);
    }
  };

  // level complete fanfare: rising arpeggio, then a bright held chord
  AudioEngine.prototype.sfxVictory = function () {
    if (!this.ac || this.paused) return;
    var t0 = this.ac.currentTime, self = this;
    [0, 4, 7, 12, 7, 12, 16].forEach(function (n, i) {
      self.tone('square', 523 * Math.pow(2, n / 12), 0, 0.14, 0.11, t0 + i * 0.09);
    });
    [12, 16, 19, 24].forEach(function (n) {
      self.tone('triangle', 523 * Math.pow(2, n / 12), 0, 0.9, 0.08, t0 + 0.66);
    });
  };

  AudioEngine.prototype.sfxBreakout = function () {
    this.sfxArp([0, 4, 7, 12, 16], 0.06);
    this.nz(0.5, 0.25, 800, 5000, 'bandpass');
  };

  AudioEngine.prototype.sfxGameOver = function () {
    var ac = this.ac;
    if (!ac) return;
    var t = ac.currentTime + 0.15;
    var base = 392; // G4
    var notes = [0, -1, -2];
    for (var i = 0; i < notes.length; i++) {
      var f = base * Math.pow(2, notes[i] / 12);
      this.tone('triangle', f, f * 0.985, 0.36, 0.16, t + i * 0.4);
      this.tone('square', f / 2, 0, 0.3, 0.04, t + i * 0.4);
    }
    // Final long note with a sagging vibrato.
    try {
      var t4 = t + 1.2, dur = 1.3;
      var f4 = base * Math.pow(2, -3 / 12);
      var o = ac.createOscillator(), g = ac.createGain();
      var lfo = ac.createOscillator(), lg = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f4, t4);
      o.frequency.exponentialRampToValueAtTime(f4 * 0.94, t4 + dur);
      lfo.frequency.value = 5.5;
      lg.gain.setValueAtTime(0.0001, t4);
      lg.gain.exponentialRampToValueAtTime(f4 * 0.02, t4 + 0.4);
      lfo.connect(lg);
      lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t4);
      g.gain.exponentialRampToValueAtTime(0.18, t4 + 0.02);
      g.gain.setTargetAtTime(0.0001, t4 + dur * 0.55, dur * 0.18);
      o.connect(g);
      g.connect(this.sfxBus);
      o.start(t4); lfo.start(t4);
      o.stop(t4 + dur + 0.2); lfo.stop(t4 + dur + 0.2);
      this.tone('square', f4 / 2, f4 / 2.1, dur, 0.05, t4);
    } catch (e) { /* ignore */ }
  };

  /* ---------- synth music (FM sequencer) ---------- */

  AudioEngine.prototype._playSynth = function (role, level) {
    this._stopFile();
    this.synthActive = true;
    this.synthRole = role === 'road' ? 'road' : 'arena';
    this.synthLevel = level || 1;
    this.nowPlaying = this.synthRole === 'road'
      ? SYNTH_ROAD
      : SYNTH_ARENA[(this.synthLevel - 1) % SYNTH_ARENA.length];
    this._applySynthGain();
  };

  AudioEngine.prototype._stopSynth = function () {
    if (!this.synthActive) return;
    this.synthActive = false;
    this._applySynthGain();
  };

  AudioEngine.prototype._applySynthGain = function () {
    if (!this.ac || !this.musBus) return;
    var on = this.synthActive && this.musicOn;
    var target = on ? SYNTH_VOL * (this.ducked ? DUCK : 1) : 0;
    try {
      var g = this.musBus.gain, t = this.ac.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(target, t, FADE_SEC / 4);
      if (this.musFilter) {
        var fq = this.musFilter.frequency;
        fq.cancelScheduledValues(t);
        fq.setValueAtTime(fq.value, t);
        fq.setTargetAtTime(this.ducked ? DUCK_LP : 18000, t, 0.12);
      }
    } catch (e) { /* ignore */ }
  };

  AudioEngine.prototype._fm = function (f, t, dur, vol, ratio) {
    var ac = this.ac;
    var c = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
    c.frequency.value = f;
    m.frequency.value = f * (ratio || 2);
    mg.gain.setValueAtTime(f * 3, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.2, t + dur);
    m.connect(mg);
    mg.connect(c.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    c.connect(g);
    g.connect(this.musBus);
    c.start(t); m.start(t);
    c.stop(t + dur + 0.03); m.stop(t + dur + 0.03);
  };

  AudioEngine.prototype._kick = function (t) {
    var ac = this.ac;
    var o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    g.connect(this.musBus);
    o.start(t);
    o.stop(t + 0.2);
  };

  AudioEngine.prototype._sched = function () {
    var ac = this.ac;
    if (!ac || ac.state !== 'running') return;
    var now = ac.currentTime;
    // Resync after throttling (background tab) or a long suspend.
    if (this.nextNote < now - 0.1) this.nextNote = now + 0.05;
    if (!this.synthActive || this.paused) { this.nextNote = Math.max(this.nextNote, now + 0.05); return; }

    var lvl = this.synthLevel;
    var road = this.synthRole === 'road';
    var bpm = Math.min(136, 112 + 3 * (lvl - 1)) + (road ? 6 : 0);
    var spb = 60 / bpm / 4;
    var root = ROOTS[(lvl - 1) % ROOTS.length] + (road ? 5 : 0);
    var lead = (this.bar % 4 === 3 && lvl >= 3) ? LEAD_B : LEAD;
    var playNotes = this.musicOn;

    while (this.nextNote < now + 0.12) {
      var t = this.nextNote, s = this.step;
      if (playNotes) {
        var n = BASS[s];
        if (n !== null) this._fm(mhz(root + n), t, 0.2, 0.5);
        if (s % 4 === 0) this._kick(t);
        if (s % 4 === 2) this.nz(0.04, 0.15, 8000, 0, 'highpass', this.musBus, t);
        if (lvl >= 4 && s % 2 === 1) this.nz(0.02, 0.05, 10000, 0, 'highpass', this.musBus, t);
        var ln = lead[s];
        if ((road || lvl >= 2) && ln !== null) this._fm(mhz(root + 12 + ln), t, 0.12, 0.12, road ? 3 : 2);
      }
      this.nextNote += spb;
      this.step = (s + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  };

  DE.AudioEngine = AudioEngine;
})();
