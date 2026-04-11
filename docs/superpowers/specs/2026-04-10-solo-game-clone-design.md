# Solo clone of `game-with-camera-and-projector` — Design

**Date:** 2026-04-10
**Scope:** Fork the existing two-player projector drawing game into a new folder built for one player. No changes to the original folder.

## Goal

Produce a standalone single-player variant of the Comically Large Paintbrush game. One pencil, full canvas, same prompt → countdown → 90-second draw → framed result flow as the original.

## Folder layout

New folder at repo root alongside the existing game:

```
game-with-camera-and-projector-solo/
  tracker.py       ← forked, single-pencil
  game.js          ← forked, no divider, single sidebar, black strokes
  index.html       ← forked, right sidebar removed
  style.css        ← forked, right-sidebar rules removed
  README.md        ← forked, rewritten for solo
```

Shared assets (`../assets/…`, `images/`) remain referenced via the same relative paths. No asset duplication.

## `tracker.py` changes

Fork and strip:

- `_state` keeps `p1`, `reset`, `buttons`. `p2` removed.
- `set_points()` takes a single centroid.
- Custom-mode color picking: left-click sets the pencil color; right-click handler and `_c2_*` globals removed. `_c1_low/_c1_high/_c1_set` kept.
- `BUTTON_NAMES` collapses to `["large", "medium", "small", "undo"]` (4 buttons, no `p1_`/`p2_` prefix). Calibration shortens from 8 corners' worth of clicks to 4 buttons.
- Detection reduced to a single best centroid: brightest region in BRIGHT mode, largest contour in RED/GREEN/BLUE/CUSTOM.
- `/state` JSON: `{"p1": {x,y,active}, "reset": bool, "buttons": [...]}`. `/health` unchanged.
- Docstring, control-hint text, and window title updated to reflect single pencil.
- Config constants (`PORT=5050`, RealSense settings, `FLIP_H`, `MODES`, thresholds) unchanged.

Port stays `5050` — only one tracker runs at a time; the solo game is a standalone build.

## `game.js` changes

- Remove `DIVIDER_X`, `drawDivider()`, and its `onDraw` call.
- `playerState` collapses to a single `{ brushSize: 16, opacity: 1, strokes: [] }` (no `1`/`2` keys).
- Single `trackerStroke`, `trackerLastActiveAt`, `trackerCursor`. `trackerP2` removed.
- `STROKE_COLOR = [0, 0, 0]`. All `player === 1 ? red : blue` branches removed.
- `clampToSide`, `side`, `player`, `onCorrectSide`, and `playerOverride` in `handleTrackerPoint` all removed. Drawable condition reduces to `point.active && inBounds`.
- `pollTracker` reads `data.p1` only and calls `handleTrackerPoint(data.p1)` once per tick.
- End-frame recolor loop deleted (strokes are already black).
- Button-dwell handling updated: selectors drop `[data-player]`, names are now bare `large/medium/small/undo`.
- Tracker cursor render collapses to a single crosshair.
- Status overlay simplifies to `📷 Tracker connected` / `📷 Tracker offline — mouse only`, optionally with the single pointer's coords.
- Prompt select, countdown video, timer, framed result, and spacebar restart — behavior unchanged, references to `playerState[1]`/`[2]` collapsed to the single state.
- `TOTAL_TIME = 90`, `POLL_INTERVAL = 16`, `ACTIVE_RADIUS = 20`, `DROPOUT_MS = 2000`, `CHAIKIN_ITERS = 2` unchanged.

## `index.html` changes

- Prompt overlay, countdown overlay, caption/frame overlay, timer display, background image, canvas element — unchanged.
- `<aside class="sidebar sidebar-right">` block deleted in full (brush trio + undo).
- `<aside class="sidebar sidebar-left">` kept; its buttons lose `data-player="1"` attributes (JS no longer reads them).
- SVG mask ids (`mask-large-left`, etc.) stay. No collision with the deleted right-side ids since they're gone.
- `aria-label`s drop any "left" / "right" wording.

## `style.css` changes

- `.game-layout` switches from 3-column (sidebar / canvas / sidebar) to 2-column (sidebar / canvas). Canvas stays 800×600 to preserve projector-rectangle calibration. Reclaimed right column becomes empty space.
- All `.sidebar-right` rules deleted.
- Overlay, prompt scroller, timer, caption, frame, brush button, undo button, and ruled background rules unchanged.

## Data flow

```
physical pencil
  → IR/color detection (tracker.py) → single centroid
  → perspectiveTransform via canvas corners
  → normalized (x, y) in [0,1]²
  → HTTP GET /state { p1, reset, buttons }
  → game.js pollTracker() @ 16ms
  → handleTrackerPoint(data.p1)
  → drawable = active && inBounds
    → extend/start stroke  OR  close stroke after DROPOUT_MS
  → playerState.strokes[] → onDraw → kaplay canvas
```

Mouse input path is unchanged post-tracker: press starts a stroke, move extends, release closes.

## Error handling

- **Tracker offline:** `fetch` throws/times out → `trackerConnected = false`, open stroke nulled, status overlay shows offline, mouse still works.
- **Tracker active = false:** `handleTrackerPoint` no-ops until `DROPOUT_MS = 2000` elapses, then closes the stroke. Next sighting starts a new one.
- **Out of bounds:** silently ignored — unit-square bounds check is the only spatial gate once `onCorrectSide` is gone.
- **`data.reset` true:** `playerState.strokes = []`, `trackerStroke = null`. Same semantics as original.
- **Countdown video can't load:** 5 s `canplay` timeout → `beginPlayback()`; 30 s hard fallback → `finish()` → `startGame()`. Unchanged.
- **Phase gating:** `handleTrackerPoint` early-returns when `!gameStarted || gameEnded`, so no strokes leak into prompt-select, countdown, or framed-result phases.

## Testing

`game-with-camera-and-projector/tests/` contains only `font-test.html` and `game-webpage.html` — HTML sandboxes, not test suites. Not forked.

Manual verification steps:

1. `python tracker.py` in the new folder — window opens, press C, click 4 canvas corners, confirm yellow dots + border.
2. Open `index.html` — prompt scrolls, countdown video plays, timer starts at 1:30.
3. Draw with mouse across the full canvas — single black stroke, no divider, no color split.
4. With tracker running, wave a bright object — single green crosshair follows, strokes render black.
5. Wait for the timer to end — framed result appears with caption, strokes are black (no recolor visible), spacebar restarts.
6. Confirm the original `game-with-camera-and-projector/` still runs unchanged.

## Out of scope

- No changes to the original two-player folder.
- No asset duplication.
- No change to the projector calibration rectangle (canvas stays 800×600).
- No new prompts, new frame art, or new game modes.
