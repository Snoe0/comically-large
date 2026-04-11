# Comically Large Paintbrush — SOLO

Single-player fork of [`../game-with-camera-and-projector/`](../game-with-camera-and-projector/).

One pencil, the full canvas, strokes rendered in black. Same prompt → countdown →
90-second timer → framed-result flow as the two-player version.

## What's different from the two-player version

| | Two-player | Solo |
|---|---|---|
| Players | 2 (left / right halves) | 1 (full canvas) |
| Divider line | yes, at x = 400 | removed |
| Stroke colors | red (P1), blue (P2) | black |
| Tracker output | `{p1, p2, reset, buttons}` | `{p1, reset, buttons}` |
| Sidebar buttons | 2×(large/medium/small/undo) | large/medium/small/undo |
| Button names over HTTP | `p1_large`, `p2_large`, … | `large`, `medium`, `small`, `undo` |

## Quick start

### 1. Run the tracker

```bash
python tracker.py
```

The webcam window opens.

### 2. Calibrate the canvas corners

Press **C** in the webcam window, then click the 4 corners of the physical canvas in order:

```
  Top-Left → Top-Right → Bottom-Right → Bottom-Left
```

Yellow dots and a border confirm the selection. From here, all coordinates are
perspective-corrected.

### 3. Choose a tracking mode

Press **M** to cycle: **BRIGHT** / RED / GREEN / BLUE / CUSTOM.

| Mode     | Tracks                                      | Good for                         |
|----------|---------------------------------------------|----------------------------------|
| BRIGHT   | Brightest region in frame                   | IR LEDs, white ball, flashlight  |
| RED      | Red-ish objects                             | Red foam tip                     |
| GREEN    | Green-ish objects                           | Tennis ball, green foam          |
| BLUE     | Blue-ish objects                            | Blue foam tip                    |
| CUSTOM   | HSV range you pick by left-clicking a color | Anything else                    |

Use **[** and **]** to adjust the brightness threshold in BRIGHT mode. The
top-right of the webcam window shows a live mask preview.

### 4. Open the game

Open `index.html` in a browser (same machine as the tracker, or same LAN with
the tracker URL updated in `game.js`).

A status pill at the bottom shows:
- `📷 Tracker connected | P(x,y) ●/○` — polling works
- `📷 Tracker offline — drawing with mouse only` — mouse still works

## Optional: sidebar button calibration

Press **B** in the tracker window and click 4 corners for each of the 4 buttons
in this order:

```
  large → medium → small → undo
```

After calibration, dwelling the pencil over a button region fires it — the
solo game's sidebar reacts as if you clicked.

## File overview

```
tracker.py   ← single-pencil tracker
game.js      ← single-player game
index.html   ← one sidebar
style.css    ← unchanged from two-player (flex layout collapses naturally)
```

Shared assets (`../assets/comic-countdown.mp4`, `../assets/pictureframes*.png`)
are referenced relative to the repo root and are not duplicated.

## Controls (tracker window)

| Key     | Action                              |
|---------|-------------------------------------|
| C       | Re-select canvas corners            |
| B       | Calibrate 4 sidebar button regions  |
| M       | Cycle tracking mode                 |
| [       | Decrease brightness threshold       |
| ]       | Increase brightness threshold       |
| R       | Reset — clears all strokes          |
| Q / ESC | Quit                                |

## Controls (game window)

| Key     | Action                              |
|---------|-------------------------------------|
| Space   | Restart (from the framed end screen)|
