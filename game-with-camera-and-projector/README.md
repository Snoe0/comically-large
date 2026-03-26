# Comically Large Paintbrush — Camera Tracker

## What this adds

A Python + OpenCV script (`tracker.py`) that:
1. Opens your webcam
2. Lets you click the **4 corners of the physical canvas** so the image is
   perspective-corrected (handles projector and camera both being off-axis)
3. Tracks a bright or colored object in real-time
4. Streams the normalized (0–1, 0–1) position over a tiny local HTTP server
5. The updated `game.js` polls that server and draws strokes on the matching
   player's half of the canvas

---

## Quick start

### 1. Run the tracker

```bash
python tracker.py
```

A webcam window opens.

### 2. Calibrate the canvas corners

Press **C** in the webcam window, then click **exactly 4 corners** of the
physical canvas in this order:

```
  Top-Left → Top-Right → Bottom-Right → Bottom-Left
```

Yellow dots and a border will confirm the selection.  
From this point all coordinates are perspective-corrected — the camera does
not need to be directly above the canvas.

### 3. Choose your tracking mode

Press **M** to cycle through:

| Mode     | Tracks                                      | Good for                         |
|----------|---------------------------------------------|----------------------------------|
| BRIGHT   | Brightest region in frame                   | Infrared LEDs, white ball, torch |
| RED      | Red-ish objects                             | Red foam tip                     |
| GREEN    | Green-ish objects                           | Tennis ball, green foam          |
| BLUE     | Blue-ish objects                            | Blue foam tip                    |
| CUSTOM   | Whatever HSV range you set in the script    | Anything else                    |

Use **[** and **]** to adjust the brightness threshold when in BRIGHT mode.

The top-right corner of the webcam window shows a live **mask preview** so
you can see exactly what the tracker sees.

### 4. Open the game

Open `index.html` in a browser (must be on the same machine as the tracker,
or on the local network with the tracker URL updated).

A status bar at the bottom of the game shows:
- `📷 Tracker connected` — polling is working
- `📷 Tracker offline` — Python script isn't running; mouse still works

---

## File overview

```
tracker.py   ← run this with Python
game.js      ← updated; polls tracker, otherwise identical behaviour
index.html   ← unchanged (same as before)
```

---

## How the coordinate mapping works

```
Physical canvas (any perspective)
        ↓  (click 4 corners in tracker window)
OpenCV getPerspectiveTransform
        ↓
Normalised 0–1 space matching the 4:3 canvas aspect ratio
        ↓  (HTTP GET /state)
game.js maps  x*800, y*600  → kaplay pixel coordinates
        ↓
Stroke drawn on correct player's half
```

The left half of the canvas (x < 0.5) → Player 1 (red)  
The right half (x ≥ 0.5) → Player 2 (blue)

---

## Testing without the pencil prototype

Any high-contrast object works for now:

- **Bright mode** — a phone flashlight, a white ball on a dark floor, or a
  small torch pointed down
- **RED/GREEN/BLUE** — a coloured ball, foam block, or piece of tape on your
  finger
- **CUSTOM** — edit `CUSTOM_HSV_LOW` / `CUSTOM_HSV_HIGH` at the top of
  `tracker.py` for any specific colour

---

## When you get the IR camera + pencil prototype

1. Set tracking mode to **BRIGHT** (IR LEDs appear as the brightest region)
2. If needed, add an IR-pass filter range in `make_mask()` — IR cameras
   typically saturate the LED spot, so BRIGHT mode should work out of the box
3. The pen-lift detection (active=false when no bright region is visible)
   naturally handles "pen up / pen down" since the LEDs only fire when the
   ball is rolling

---

## Projector calibration (physical setup)

The projector doesn't need to be calibrated in software for drawing to look
correct — the canvas corners you clicked in the tracker window define the
coordinate space, and the game's canvas is projected to fill exactly that
rectangle.  

If the projection is geometrically distorted (keystone), use the projector's
built-in keystone correction or OS-level display geometry tools to align the
game window with the physical rectangle before playing.

---

## Controls (tracker window)

| Key  | Action                              |
|------|-------------------------------------|
| C    | Re-select canvas corners            |
| M    | Cycle tracking mode                 |
| [    | Decrease brightness threshold       |
| ]    | Increase brightness threshold       |
| R    | Reset — clears all strokes in game  |
| Q / ESC | Quit                           |
