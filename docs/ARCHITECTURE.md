# Architecture contract

> **Current game (latest user requests override everything below):**
> - **Double press (square arena):** a second press of the same direction within `DOUBLE_SEC` = 0.35 s (keys or taps) sets `dirBuf.double`, so the next gap moves 2 lanes (`_steps`). The slide speed scales with the lane distance, and the hint shows the 2-lane target.
> - **All levels unlocked:** `state.checkpoint` is always `DE.FINAL_LEVEL`, and the saved checkpoint key is gone. The LEVELS menu "Start from level 1" button (`resetProgress`) only resets the current level.
> - **Modes, not levels (user-facing):** the UI says MODE 1 · RETRO, MODE 2 · BEYOND and MODE 3 · INFINITY (HUD, card, MODES menu, "Start from mode 1", result card, "NEXT: MODE"). Internally it is still `level`.
> - **Finish celebration:** "FINISHED!" with a white flash, two shockwave rings (orange, pink) and a burst of multi-colour glyph shards. There are no balloons, confetti or ribbons. The subtitle is "MODE n · NAME · +250", or "ALL 3 MODES · +1000" for the final.
> - **Connected journey:** `renderer.arriveK(state)` (0..1) starts when the celebration ends. The road car drives in from the left and speeds off to the right after `road.dur`. In INFINITY the car drives in from beyond the left edge. Mode 1 still exits through its gate.
> - **INFINITY edge:** a solid grey wall (`█`, one cell thick), like level 1. The glitter was removed.
> - **Crisp walls on short screens:** each wall lands on exactly one glyph row or column (the cell whose span contains depth k·L), so walls never double up. On short screens the glyph cell shrinks until a lane gets at least 3.3 rows (cell cap ×1.8). At `max-height: 500px` the now-playing chip is hidden so the HUD stays one row.
> - **INFINITY look:** a dark ground with grey drifting glyphs, like levels 1 and 2 (the pale Claude FM field was dropped at the user's request). It keeps the glittering edge, gold stars and the orange/white portal. Player and hunters use the same colours as the other levels, and the HUD is never switched to the pale style.
> - **Playfield below the HUD:** boot measures how far the HUD (`.hud .tl`, `.hud .tr`) reaches into the stage (it wraps to 2 rows on narrow screens) and passes it as `renderer.resize(w, h, hudBottom)`. `hudTop` is set from it, and the arena, INFINITY camera centre and road (`roadY0`) all start below it. A ResizeObserver also watches the HUD parts.
> - **Device rules (user request): only PHONES are special.** `DE.isPhone()` is true for a touch-primary device whose smaller screen side is under 600 px. Computers, touch-screen laptops and **tablets** behave the same: square level 1 (`playAspect()` returns 1), the normal INFINITY world, no automatic fullscreen and no rotate screen. Phones get screen-shaped levels, automatic fullscreen with a landscape lock, and the rotate screen. Tablets and phones both get touch controls and touch tips.
> - **Screen-shaped levels:** the renderer reports `playAspect()` and the game calls `setAspect()` on each resize. Level 1 is a **rectangle**: `DE.arenaDims(aspect)` gives `hx`/`hy` with the short side at 5 lanes, up to 12. `DE.rectPos` and `DE.rectSide` keep the gaps at `MIDS` and the speed constant on every side, and dots are shared out by side length. A level waiting in `ready` refits when the screen changes shape; a level in progress keeps its shape. The renderer's `useLayout(hx, hy)` fits the arena edge to edge under the HUD, using depth-based wall cells (`min(HX-|x|, HY-|y|)`). INFINITY's world is `bx`×`by` (wider on wide screens) with a zoom of about 13 lanes tall. The DPR cap on small screens is now 2.5, for sharpness.
> - **Level 2 extras:** some rooftops have network masts whose red tip light blinks hard on and off (each mast on its own beat), and there is a moon with craters over the city.
> - **iPad / iPhone fullscreen:** Safari always leaves browser fullscreen on a swipe down (an Apple gesture pages cannot block). On iOS, outside Home Screen mode, the fullscreen button shows a tip in `#toast` (`ui.tip`) explaining Share → Add to Home Screen. In Home Screen mode (`DE.isStandalone()`) the fullscreen button is hidden. `DE.isIOS()` also detects iPadOS (a Mac user agent with touch).
> - **Home-screen app:** `manifest.webmanifest` (display fullscreen, orientation landscape) plus `assets/icon.svg`. "Add to Home Screen" on tablets and phones gives true fullscreen without the browser's swipe-to-exit.
> - **Landscape only on phones and tablets:** `#rotate` covers the screen on `(pointer: coarse) and (orientation: portrait)` and asks you to rotate the device. Turning upright during play pauses the game. The first touch goes fullscreen (documentElement) and calls `screen.orientation.lock('landscape')`, which works on Android and is ignored on iOS.
> - **Fullscreen on tablets:** `html, body` have `touch-action: none`, and a non-passive document `touchmove` handler blocks browser pan and pull-to-refresh (except inside scrollable cards and menus). If fullscreen is lost anyway (the iPad / Samsung system swipe-down), the game pauses and the next touch re-requests fullscreen, unless the player left fullscreen on purpose with the button or F key (`input.wantFs = false`).
> - **Touch:** on touch pointers during play, a swipe of 26 px or more steers in the swipe direction, while a tap steers from the car toward the finger on release. In INFINITY, touch uses a floating joystick: the base sits where the finger lands, and sliding more than 10 px steers the way the finger moves. The base follows the finger past a 55 px radius, and `renderer.joy` draws it. A tap with no movement heads toward that spot. The mouse still drags toward the pointer. The level card shows touch tips (`LEVEL_TIPS_TOUCH`) on coarse-pointer devices.
> - **Score pop-ups** rise and drift apart, with a pop-in scale and a shadow. On the road, a dot trail pays +10, +20 … +50.
> - **Replay rule:** dying replays the same level. Only winning moves on, and after the final level a win restarts at level 1. The level being played is saved under `dodgeem-beyond-current` and reopened on page load; it is capped by the checkpoint, which stays the furthest unlocked level (used by the LEVELS menu).
> - **Look and music per level:** level 1 has grey walls (`cfg.greyWalls`) and level 2 a grey road (`cfg.greyRoad`, via `rc()` in `drawRoad`) with a scrolling two-layer glyph city skyline above it (`building()` in render.js: far layer 6 cols wide at 0.35× scroll, near layer 9 cols wide at 0.8× scroll, occasional lit windows). Music: L1 plays arena track 1, L2 the road track, L3 "Neon Hyperdrive" (`BEYOND_TRACK_LEVEL = 4`). Music always starts ON at page load; the off state is no longer remembered.
> - **Level names:** 1 = RETRO (the square arena), 2 = BEYOND (the dodge road), 3 = INFINITY (free roam; the portal is labelled INFINITY). Internally the level-3 layout is still called `'beyond'`.
> - **Audio fix:** `_fade` now completes a superseded fade's `done` callback. Before, a second track selection during a fade-out cancelled the track swap, so the name changed but the old file kept playing.
> - **Three levels.** `DE.FINAL_LEVEL = 3`. Level 1 is The Square (tuned easy: 14 dots, pink car speed 0.45, `cfg.chase` 0.2; solid grey walls; the breaking wall has a golden gate, door frame, "EXIT" label and meter). Level 2 is Offramp: a 30 s dodge road where about 35% of the pink cars swerve lanes once, never blocking all three lanes. Level 3 is **Beyond**, the final level. Finishing level 3 plays a "YOU MADE IT OUT!" celebration, then shows the result card with `won: true`; "play again" starts from level 1. The Cloverleaf code remains, unused.
> - **Controls:** W A S D / arrows or tap/click point where you want to go. In arenas the car turns at the next gap toward the tapped side of the car. On the road, tapping above or below the car changes lane. Space/Enter only start, restart or resume. Nothing steers on its own, except that **once every dot or star is collected the car drives itself out** through the open gate or into the light, at 1.8× speed. The player always drives counter-clockwise; there are no U-turns.
> - **Beyond** (`layout: 'beyond'`): a 16×16-lane pale field (`DE.BEYOND.bound = 8`) with a camera that follows the player (`renderer.cam`; `toPx` and the pointer mapping use it). The edge is glittering. There are 20 stars. Over the run time (`game.runT`), the player speeds up by +1.2%/s up to 1.8×, and hunters speed up by +0.4%/s up to 1.3×. New hunters come faster the longer you take: the first after 8 s, then gaps of 7.4, 6.8 … down to 4 s, up to 8 hunters. Each spawns in the corner farthest from the player. Off-screen hunters and the light get edge arrows. Movement is free-hand: `steerTo(dx, dy, quiet)` sets a target heading and the car turns smoothly (7 rad/s). Holding and dragging a finger or mouse steers continuously, and two keys give a diagonal. Sprites rotate to any angle.
> - Cars are about 20% smaller and dots about 30% bigger. `index.html` loads the files with `?v=N` cache-busting; bump N on every change.

> **v2: the Five Rules override anything below that conflicts with them.** Read this section first.

## v2 · The Five Rules (from the MSN player research, required by the product owner)
1. **One input, works on a mouse.** The whole game is controlled by one held button. It could be a mouse button held anywhere on the stage, a finger held anywhere on the stage, or any key held (Space, Enter, arrows, WASD, …). No D-pad, no directional keys, no boost.
2. **Board first, menu never.** Opening the page shows the live level-1 arena at once. There is no title screen, no menu and no loader. The first press starts the run.
3. **No lives, no energy, no login.** One crash ends the run. There are no hearts in the HUD.
4. **No tutorial needed.** No instruction toasts or text. The game teaches through play: at every gap, a glowing arrow shows where the car *will* go given what you are doing right now. In the `ready` state only, a pulsing in-world "HOLD" cue sits next to the player car.
5. **Losing is an invitation.** An arena should take about 30–40 s (`DOTS_PER_LANE` is now `[16,12,9,5]`, 42 dots). After a crash, the board stays on screen with a small result card (score, best, level, "so close" detail). One press restarts at once from level 1, after a 0.45 s guard.

### v2 controls (single input)
- **Arena:** at every gap (side midpoint), the car moves **one lane inward if the button is held**, or **one lane outward if it is released**. It can't go past lane 3 or lane 0. A 0.1 s grace applies: if the held state changes within 0.1 s after passing a gap, re-decide that gap. Releasing therefore drifts you out, which is also how you escape once the wall breaks. The exit happens automatically when you reach the exit side on lane 0, so there is no assist timer.
- **Road:** while the button is held, `road.laneF` moves toward lane 0 (top) at about 3.5 lanes/s. While it is released, it moves toward lane 2 (bottom). Collisions use `Math.round(laneF)`. The road lasts `DE.ROAD.duration` = 10 s, then 2.4 s of outro.
- **Levels alternate** (these user requests override rules 2 and 4 where they conflict). Odd levels are arenas and even levels are roads (dodge levels with traffic; never all three lanes blocked). `levelConfig(level)` returns `kind: 'arena' | 'road'` and `arenaNo`, and difficulty and audio tracks scale by `arenaNo`. `levelStart` and `roadStart` payloads carry `level: arenaNo`.
- **Between levels:** `_completeLevel()` emits `levelComplete {level, kind, score}`. The renderer then plays about 3.2 s of balloons, confetti, streamers and a "LEVEL COMPLETE!" banner, and audio plays a fanfare. The next level loads in `mode: 'ready'` and ignores presses until `game.celebrating()` is false (2.4 s). Then the DOM level card `#sLevel` shows that level's controls, and any press starts it. In `ready`, `pt` is capped at 1.
- **Level select:** the `#bLevels` HUD button (or the L key) opens `#sLevels`, a grid of levels 1..max(8, checkpoint), locked above the checkpoint. `game.selectLevel(n)` jumps to a level and `game.resetProgress()` resets the checkpoint to 1. While `ui.menuOpen` is true, stage presses and keys other than Esc/L are swallowed.
- **Cloverleaf (level 3, arena 2, `cfg.layout === 'clover'`):** four loops centred at `DE.CLOVER.centers` (TL, TR, BL, BR). Each has 2 lanes at half-size `2 - lane`, with walls at 2.5/1.5/0.5. Positions come from `DE.cloverPos(loop, laneF, u)`. The shared inner walls have a gap at each side midpoint, and `DE.CLOVER.NEIGH[loop][side]` gives the linked loop/side. Moving "outward" from lane 0 at a shared-wall gap hops into the neighbour loop. The car keeps its screen direction, so `player.dir` flips, and it glides across via `tw/twx/twy`. Two pink guards stay in loops TR and BL and chase the player's lane only while the player is in their loop. There are 32 dots, +100 for each cleared loop. The breaking wall is the outer wall of `arena.exitLoop` on `cfg.exitSide`; `arena.exitPoint` gives its midpoint. Dots, hint options (`x`, `y`) and the stay marker (`sx`, `sy`) carry world positions, and the renderer uses them when present. The renderer precomputes `cType/cSide/cLoop/cAlong` alongside the square grid.
- **Nothing moves on its own (user request):** in hold mode, holding for at least `TAP_SEC` steers inward at gaps (road: up). A tap (a shorter press) sets `game.tapQ` and moves one lane outward at the next gap where that's possible (cloverleaf: hops loops; dropped after 3 gaps). On the road, a tap drops one lane. Idle keeps the lane, and letting go after a hold keeps the lane reached. The escape phase has no auto drift either.
- **Single direction (user request):** the player always drives counter-clockwise (`player.dir` stays -1). There are no U-turns, and hopping loops does not reverse direction. The opposite key does nothing.
- **Hint:** arrows only. The car-to-arrow trail line was removed (user request).
- **Cloverleaf is tuned easy:** 1 slow guard (speed 0.5, in the BR loop, chase odds 0.35) and 24 dots.
- **Cloverleaf hold mode (superseded by the tap rule above):** releasing never hops by itself (an idle car stays in its loop). A tap (press shorter than `TAP_SEC` = 0.3 s) sets `game.hopTap`, which hops at the next shared-wall gap (dropped after 2 gaps) and lights that gap's hint. Holding still means the inner lane.
- **WASD queue:** a tapped direction stays queued until the next gap where it applies (dropped after `QUEUE_GAPS` = 2 misses), and lights that gap's hint at once. An opposite key U-turns, unless the visible next gap offers that direction (`_gapOffers`), in which case it queues the turn.
- **Keyboard directions are screen-absolute** (user request): W/↑ = up, A/← = left, S/↓ = down, D/→ = right, all on the screen. At a gap, the key pointing toward a neighbouring lane moves the car there, and a key along the direction of travel does nothing. (The earlier car-relative `turnL`/`turnR` confused players. The code path still exists but no key maps to it.) While switching lanes, `player.facing` points into the gap so the car visibly turns; the lane slide speed is 7 lanes/s.
- **The road has no traffic.** It is a safe breather with dot trails only, so a finished level can never be lost on the way to the next one.
- **Checkpoint:** `state.checkpoint` is the furthest level reached, stored in localStorage under `dodgeem-beyond-level`. Page load, restart and new runs all begin at the checkpoint. Score still resets to 0 each run.
- **Player ring:** the pulsing orange ring around the player car is always drawn (not only in `ready`), so the player never gets confused with an enemy.
- There is no boost. Speed rises per level, plus about +1.5% per 10 s within a run.
- **Laptop extra (W A S D / arrow keys):** `game.dirDown(dir)` / `game.dirUp(dir)` switch the game to direction mode (`game.dirMode = true`). At a gap on side s, `DE.INWARD[s]` moves in, `DE.OUTWARD[s]` moves out, and no key keeps the lane (during escape, no key drifts outward). Taps are buffered for 0.55 s and the 0.1 s grace applies. On the road, up/down move one lane per tap. Any mouse, touch or Space press (`down()`) switches back to hold mode. The hint's `active`/`stay` always reflect whichever mode is live. Every other key is still the single hold button.

### v2 Game API changes
- `mode` is `'ready' | 'play' | 'over'`; there is no `'title'` and no attract mode. `ready` is the frozen level-1 board shown on load. Cars don't move, the ambient background animates, and `hint` is shown for the first gap.
- `game.down()` and `game.up()` replace `press(dir)` / `release(dir)`. `down()` in `ready` starts the run (and counts as a held press). `down()` in `over` restarts after the guard. `setPaused` / `togglePause` stay.
- `state.held` (boolean) is exposed for the renderer and UI.
- `state.lives` and `state.maxLives` are removed. The `crash` payload is `{space, x, y}`. After a 0.5 s freeze, the game emits `mode {mode:'over'}` and `gameOver {score, hi, level, dotsLeft, newBest}`.
- The `toast` event is removed (rule 4). `float` stays for score pop-ups.
- `hint.options` keeps its shape. Exactly one option is `active`: the move that will happen at the next gap given `state.held`. In lane 3 while held, or lane 0 while released, the car stays, so no option is active and `hint.stay = true`.

### v2 DOM changes (index.html)
- Removed: `sTitle`, `bStart`, `hLives`, `pad` and every `[data-dir]` button.
- Kept: `stage`, `cv`, `hLv`, `hScore`, `hHi`, `hDots`, `hNp`, `bMusic`, `bPause`, `bFull`, `sPause`, `sOver`, `oScore`, `oInfo`, `bAgain`. `toast` may stay in the markup but is unused.
- Added: `oBest` (best score line on the result card).
- The entire `#stage` is the input surface. HUD buttons stop propagation. `contextmenu` is prevented and `-webkit-touch-callout: none` is set, so a long-press on mobile does nothing else.
- The result card (`sOver`) must not block the view of the board. Make it compact, centered and semi-transparent. A tap anywhere restarts.

---

Three classic scripts, loaded with `defer` in this order:

```html
<script defer src="js/game.js"></script>
<script defer src="js/render.js"></script>
<script defer src="js/audio.js"></script>
```

`game.js` creates the global namespace `window.DE` and its shared core at the top: config, math, `Emitter`, `lanePos`. `render.js` adds `DE.Renderer`. `audio.js` adds `DE.AudioEngine`. `game.js` boots on `DOMContentLoaded`, which fires after all deferred scripts have run. The boot creates `Game`, `Renderer`, `AudioEngine`, `UI` and `Input` and runs the loop.

Every file wraps itself in an IIFE and only touches the global scope through `window.DE`. Nothing uses ES modules or `fetch`. The game must work from `file://`.

## Shared core (top of `js/game.js`, already written; read-only for other files)

- `DE.HALF = 5`, `DE.LANES = 4`, `DE.MIDS = [0.125, 0.375, 0.625, 0.875]`, `DE.SIDE_NAME`, `DE.INWARD`, `DE.OUTWARD`, `DE.EXIT_VEC`, `DE.DOTS_PER_LANE`, `DE.GAP_HALF = 0.75`
- `DE.PALETTES`, `DE.COLORS`, `DE.ROAD`, `DE.levelConfig(level)`
- `DE.lanePos(laneF, u) -> [x, y]`, `DE.sideOf(u)`
- `DE.clamp`, `DE.hash(x, y)`, `DE.vnoise(x, y)`, `DE.hsl(h, s, l, a?)`, `DE.pad6(n)`
- `DE.Emitter` with `on(name, fn)`, which returns an unsubscribe function, and `emit(name, payload)`

### Arena geometry (lane units)
The arena centre is (0,0). There are four lanes, 0 = outermost and 3 = innermost. Lane k runs around a square of half-size `HALF - (k + 0.5)`. Walls sit at half-size `HALF - k` for k = 0..4. Wall 0 is the outer wall and wall 4 is the edge of the centre island. The perimeter parameter `u ∈ [0,1)` runs **clockwise** from the top-left corner. Side midpoints are `MIDS` (top, right, bottom, left). Walls 1–3 have a gap of half-width `GAP_HALF` around each side midpoint. The player drives counter-clockwise (u decreasing) and enemies drive clockwise.

Sides are indexed 0 = top/NORTH, 1 = right/EAST, 2 = bottom/SOUTH, 3 = left/WEST. Facing is indexed 0 = up, 1 = right, 2 = down, 3 = left.

### Road geometry
`x` is a fraction of the canvas width (0 = left edge, 1 = right edge). Lanes are 0, 1, 2 (0 = far/top, 2 = near/bottom). `laneF` may be fractional while sliding. The player sits at `DE.ROAD.playerX`.

## `DE.Game` (js/game.js)

```js
const game = new DE.Game();
game.state      // read-only for everyone except Game
game.events     // DE.Emitter
game.update(dt) // seconds, already clamped to <= 0.05
game.press(dir) // 'up' | 'down' | 'left' | 'right' | 'space' | 'enter'
game.release(dir)
game.start()    // new game from the title or game-over screen
game.setPaused(bool); game.togglePause()
```

While `mode !== 'play'` (the title and game-over screens), the game plays itself (attract mode), with AI steering in both the arena and the road.

### `game.state` shape
```js
{
  mode: 'title' | 'play' | 'over',
  paused: false,
  level: 1, score: 0, hi: 0, lives: 3, maxLives: 3,
  phase: 'arena' | 'clear' | 'escape' | 'road',
  t: 0,            // total seconds
  pt: 0,           // seconds since the phase began
  shake: 0,        // 0..1, decays; renderer shakes the screen
  combo: 0, mult: 1,
  cfg: {...},      // DE.levelConfig(level): hue, range, name, enemies, enemySpeed, exitSide, playerSpeed
  nextCfg: {...},  // DE.levelConfig(level + 1)
  arena: {
    dots: [[{u, e}], ...4 lanes],   // e = eaten
    dotsLeft: 64,
    broken: false,                  // outer wall on cfg.exitSide is gone
    player: { u, laneF, target, x, y, inv, exit, facing },  // inv = seconds of invulnerability left (blink while > 0)
    enemies: [{ u, laneF, x, y, facing }],
    hint: null | { m, alpha, options: [{ dir, lane, active }] } // arrows to draw at DE.lanePos(lane, m)
  },
  road: null | { lane, laneF, scroll, dur, obs: [{ x, lane, kind: 'car' | 'dot' }] }
}
```

### Events (`game.events.on(name, fn)`)
The `space` field is `'arena'` (x, y in lane units) or `'road'` (x = width fraction, y = lane index).

| name | payload | who listens |
|---|---|---|
| `mode` | `{mode}` | UI, audio |
| `levelStart` | `{level, cfg}` | audio (switch track), UI |
| `roadStart` | `{level}` | audio, UI |
| `turn` | `{}` | audio |
| `dot` | `{combo, mult, space, x, y}` | audio, renderer (sparkle) |
| `combo` | `{mult, space, x, y}` | audio |
| `near` | `{space, x, y}` | audio |
| `crash` | `{space, x, y, livesLeft}` | audio, renderer (burst plus shake) |
| `clear` | `{enemies: [{x, y}]}` | audio, renderer (enemy explosions) |
| `shatter` | `{side}` | audio, renderer (turns the outer wall cells on that side into flying glyphs) |
| `breakout` | `{x, y}` | audio |
| `gameOver` | `{score, hi, level}` | UI, audio |
| `toast` | `{msg, sec}` | UI |
| `float` | `{space, x, y, text, color}` | renderer (floating score text) |
| `pause` | `{paused}` | audio, UI |

## `DE.Renderer` (js/render.js)
```js
const r = new DE.Renderer(canvas);
r.attach(game);      // subscribe to events for effects (particles, floats, shatter)
r.resize(cssW, cssH);
r.update(dt);        // advance particles and floats (not called while paused)
r.render(state);     // draw one frame
```
Owns all visual effects. Game logic never touches pixels.

## `DE.AudioEngine` (js/audio.js)
```js
const a = new DE.AudioEngine();
a.attach(game);
a.unlock();          // call inside every user gesture; idempotent. Creates/resumes AudioContext (iOS-safe)
a.toggleMusic();     // returns true when music is on
a.musicOn            // boolean
a.nowPlaying         // string for the HUD chip, e.g. "01 · Head On At Midnight"
```
`DE.TRACKS` at the top of audio.js lists music files in `assets/music/`. Music plays through one reused `HTMLAudioElement`, because WebAudio decoding needs fetch, which fails on file://. If a track is missing or fails to load, the synth FM sequencer takes over.

## UI + Input (js/game.js)
`UI` updates the HUD from state every 100 ms and shows or hides the screens. `Input` maps the keyboard, the touch pad and swipes to `game.press`/`release`, and calls `audio.unlock()` on every gesture.

## DOM ids (index.html)
| id | purpose |
|---|---|
| `stage` | game container (focusable, `touch-action:none`) |
| `cv` | canvas, fills `stage` |
| `hLv` | level name |
| `hScore`, `hHi` | score and high score (6 digits) |
| `hLives` | hearts |
| `hDots` | dots left / road timer |
| `hNp` | now-playing text |
| `bMusic`, `bPause`, `bFull` | music toggle, pause, fullscreen (hide `bFull` if unsupported) |
| `toast` | message bar (class `on` shows it) |
| `sTitle`, `bStart` | title screen and start button |
| `sOver`, `oScore`, `oInfo`, `bAgain` | game over screen |
| `sPause` | pause screen |
| `pad` | touch controls. Buttons have `data-dir="up|down|left|right|space"`; the class `on` marks a pressed button |

Screens are toggled with the `hidden` attribute.
