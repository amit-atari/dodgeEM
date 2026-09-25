# Dodge 'Em Beyond

A reimagining of Atari's Dodge 'Em (1980). You clear the four-lane arena, the outer wall breaks, and you drive out through a playable road segment into the next level. Everything is drawn with text glyphs on a canvas. Only the orange player car is solid pixels. Each level has its own neon hue.

## Hard rules
- Plain **HTML + CSS + vanilla JS**. No libraries, no npm, no build step, no ES modules.
- **Exactly three JS files**: `js/game.js`, `js/render.js`, `js/audio.js`. Don't add a fourth.
- Opening `index.html` directly (file://) must work. That means classic `<script defer>` tags, no `fetch()` of local files, and data inlined in JS.
- Must work on phones (portrait and landscape), tablets and desktop browsers (Chrome, Edge, Firefox, Safari/iOS). Use touch plus keyboard input, pointer events and `touch-action: none` on the game area. Unlock audio on the first gesture.

## Files
- `index.html`: markup, HUD, screens, touch pad
- `css/style.css`: all styling and responsive layout
- `js/game.js`: shared core (`window.DE`: config, math, events), game state and logic, input, HUD/UI controller, boot
- `js/render.js`: `DE.Renderer`, the glyph canvas renderer and visual effects
- `js/audio.js`: `DE.AudioEngine`, synth SFX, the music player for `assets/music/`, and a synth fallback
- `assets/music/`: free-to-use tracks, with licenses in `assets/music/CREDITS.md`
- `docs/ARCHITECTURE.md`: the contract between the files (state shape, events, DOM ids). Read it before changing anything.
- `docs/prototype/`: the original single-file prototypes (reference only)
