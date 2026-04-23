# Comically Large Paintbrush — Final (1p / 2p switchable)

This is the consolidated build that ships **both** the single-player and
two-player versions of the game side-by-side, driven by a **single** tracker
that switches pencil count at runtime.

## What's in the folder

```
index.html       ← Single-player page (default landing)
dual.html        ← Two-player split-canvas page
game-solo.js     ← Game logic for the solo page
game-dual.js     ← Game logic for the dual page
style.css        ← Shared styles
tracker.py       ← Unified tracker (1- or 2-pencil at runtime)
images/          ← Shared sidebar/UI assets
```

## Running it

1. `python tracker.py` — opens the OpenCV calibration window.
2. Open `index.html` in a browser (served, e.g., via `python -m http.server`).

The tracker starts in 2-pencil mode by default; whichever HTML page you open
will POST its desired mode to the tracker on load, so the tracker syncs
itself to whichever version of the game is showing.

## Mode-switch keys

Keys work from any phase of the game (prompt scroll, drawing, end screen):

| Key   | Action                                                     |
|-------|------------------------------------------------------------|
| **1** | Restart the game in **single-player** mode (loads `index.html`) |
| **2** | Restart the game in **two-player** mode (loads `dual.html`) |
| Space | Restart the current mode in place                          |

Pressing 1 or 2 always:
1. POSTs `{"players": 1}` or `{"players": 2}` to `http://localhost:5050/mode`
   so the tracker starts (or stops) tracking a second pencil, and
2. Either reloads the matching page if you're already on it, or navigates to
   the other page.

## Tracker calibration

Calibration is **per mode**:

- Press **B** while the tracker is in solo mode (`Players: SOLO (1p)` in the
  HUD) → calibrate **4** buttons (`large`, `medium`, `small`, `undo`).
- Press **B** while in dual mode (`Players: DUAL (2p)`) → calibrate **8**
  buttons (`p1_*` / `p2_*`).

Each set is stored independently and survives mode swaps for the rest of the
session, so you only need to calibrate each mode once.

Canvas-corner calibration (`C`) is shared between modes — the physical
projection area doesn't change.

For the underlying tracker controls, modes, and CUSTOM color picking, see the
sibling folder `../game-with-camera-and-projector/README.md`.
