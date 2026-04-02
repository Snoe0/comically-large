"""
Comically Large Paintbrush — Camera Tracker
============================================
Tracks up to TWO bright/colored objects via webcam, applies a perspective
warp to map the physical canvas corners into a normalized 4:3 coordinate
space, and exposes the result over a tiny HTTP server so the game can
poll it.

Usage
-----
  python tracker.py

Controls (OpenCV window)
------------------------
  C          — enter corner-selection mode (click 4 corners of the canvas
               in order: top-left, top-right, bottom-right, bottom-left)
  M          — cycle tracking mode: BRIGHT | RED | GREEN | BLUE | CUSTOM
  [ / ]      — decrease / increase brightness/HSV threshold
  R          — reset all strokes (sends reset event to game)
  Q / ESC    — quit

  CUSTOM mode only:
    Left-click   — sample color under cursor → set Pencil 1 color
    Right-click  — sample color under cursor → set Pencil 2 color

HTTP endpoint (default port 5050)
----------------------------------
  GET /state   →  {
                    "p1": {"x": 0-1, "y": 0-1, "active": bool},
                    "p2": {"x": 0-1, "y": 0-1, "active": bool},
                    "reset": bool
                  }
  GET /health  →  {"ok": true}
"""

import cv2
import numpy as np
import json
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# ── Config ────────────────────────────────────────────────────────────────────
PORT        = 5050
CAMERA_IDX  = 0
FLIP_H      = False
WINDOW_NAME = "CLPbrush Tracker  |  C=corners  M=mode  [/]=threshold  R=reset  Q=quit"

MODES = ["BRIGHT", "RED", "GREEN", "BLUE", "CUSTOM"]

# ── Shared state (thread-safe via lock) ────────────────────────────────────────
_lock  = threading.Lock()
_state = {
    "p1":    {"x": 0.5, "y": 0.5, "active": False},
    "p2":    {"x": 0.5, "y": 0.5, "active": False},
    "reset": False,
}
_corners     = []
_mode        = "BRIGHT"
_thresh      = 200
_hue_tol     = 15

# Custom mode: two independent HSV color ranges
_c1_low  = np.array([100, 150, 100])   # Pencil 1 (blue-ish default)
_c1_high = np.array([130, 255, 255])
_c2_low  = np.array([35,  100,  80])   # Pencil 2 (green-ish default)
_c2_high = np.array([85,  255, 255])
_c1_set  = False                        # True once user has clicked a color
_c2_set  = False

# Latest frame shared with mouse callback for color picking
_last_frame  = None
_corner_mode = False

def get_state():
    with _lock:
        s = {
            "p1":    dict(_state["p1"]),
            "p2":    dict(_state["p2"]),
            "reset": _state["reset"],
        }
        _state["reset"] = False
    return s

def set_points(c1, c2, M_warp, out_w, out_h, frame_shape):
    """Convert two optional pixel centroids to normalised state."""
    with _lock:
        for key, centroid in (("p1", c1), ("p2", c2)):
            if centroid:
                cx, cy = centroid
                if M_warp is not None:
                    v  = np.array([[[cx, cy]]], dtype="float32")
                    r  = cv2.perspectiveTransform(v, M_warp)
                    nx = float(r[0, 0, 0]) / out_w
                    ny = float(r[0, 0, 1]) / out_h
                    nx = max(0.0, min(1.0, nx))
                    ny = max(0.0, min(1.0, ny))
                    active = True
                else:
                    h, w   = frame_shape[:2]
                    nx, ny = cx / w, cy / h
                    active = True
                _state[key]["x"]      = nx
                _state[key]["y"]      = ny
                _state[key]["active"] = active
            else:
                _state[key]["active"] = False

def set_reset():
    with _lock:
        _state["reset"] = True

# ── HTTP server ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path.startswith("/state"):
            body = json.dumps(get_state()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/health"):
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

def run_server():
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[HTTP] Serving on http://localhost:{PORT}")
    server.serve_forever()

# ── Perspective warp helpers ───────────────────────────────────────────────────
def order_corners(pts):
    pts  = np.array(pts, dtype="float32")
    s    = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    return np.array([
        pts[np.argmin(s)],
        pts[np.argmin(diff)],
        pts[np.argmax(s)],
        pts[np.argmax(diff)],
    ], dtype="float32")

def build_transform(corners_px, out_w=800, out_h=600):
    src = order_corners(corners_px)
    dst = np.array([[0,0],[out_w,0],[out_w,out_h],[0,out_h]], dtype="float32")
    return cv2.getPerspectiveTransform(src, dst), out_w, out_h

# ── Masking ───────────────────────────────────────────────────────────────────
def _clean(mask):
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,   kernel)
    mask   = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel)
    return mask

def make_mask(frame, mode, thresh, hue_tol):
    """Return a binary mask for BRIGHT / RED / GREEN / BLUE modes."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    if mode == "BRIGHT":
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
    elif mode == "RED":
        lo1 = np.array([0,   120,  70]);  hi1 = np.array([10,  255, 255])
        lo2 = np.array([170, 120,  70]);  hi2 = np.array([180, 255, 255])
        mask = cv2.bitwise_or(cv2.inRange(hsv, lo1, hi1), cv2.inRange(hsv, lo2, hi2))
    elif mode == "GREEN":
        mask = cv2.inRange(hsv, np.array([40,  70, 70]), np.array([80,  255, 255]))
    elif mode == "BLUE":
        mask = cv2.inRange(hsv, np.array([100, 80, 70]), np.array([130, 255, 255]))
    else:
        mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    return _clean(mask)

def make_hsv_mask(frame, low, high):
    """Return a binary mask for an arbitrary HSV range."""
    hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, low, high)
    return _clean(mask)

# ── Centroid detection ────────────────────────────────────────────────────────
def find_centroid(mask):
    """Return (cx, cy) of largest contour, or None."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 30:
        return None
    M = cv2.moments(c)
    if M["m00"] == 0:
        return None
    return int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"])

def find_two_centroids(mask):
    """Return (c1, c2) — the two largest contour centroids, or None each."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    results  = []
    for c in contours[:2]:
        if cv2.contourArea(c) < 30:
            break
        M = cv2.moments(c)
        if M["m00"] == 0:
            continue
        results.append((int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"])))
    while len(results) < 2:
        results.append(None)
    return results[0], results[1]

# ── Mouse callback ─────────────────────────────────────────────────────────────
def on_mouse(event, x, y, flags, param):
    global _corners, _corner_mode
    global _c1_low, _c1_high, _c2_low, _c2_high, _c1_set, _c2_set, _last_frame

    # Corner-selection mode takes priority
    if _corner_mode:
        if event == cv2.EVENT_LBUTTONDOWN and len(_corners) < 4:
            _corners.append((x, y))
            print(f"  Corner {len(_corners)}: ({x}, {y})")
            if len(_corners) == 4:
                _corner_mode = False
                print("[CORNERS] All 4 set — perspective correction active.")
        return

    # CUSTOM mode: sample color under cursor
    if _mode == "CUSTOM" and _last_frame is not None:
        if event == cv2.EVENT_LBUTTONDOWN:
            hsv = cv2.cvtColor(_last_frame, cv2.COLOR_BGR2HSV)
            h, s, v = hsv[y, x]
            _c1_low  = np.array([max(0,   int(h) - 15), max(0,   int(s) - 60), max(0,   int(v) - 60)])
            _c1_high = np.array([min(179, int(h) + 15), 255, 255])
            _c1_set  = True
            print(f"[CUSTOM] Pencil 1 color → H={h} S={s} V={v}")
        elif event == cv2.EVENT_RBUTTONDOWN:
            hsv = cv2.cvtColor(_last_frame, cv2.COLOR_BGR2HSV)
            h, s, v = hsv[y, x]
            _c2_low  = np.array([max(0,   int(h) - 15), max(0,   int(s) - 60), max(0,   int(v) - 60)])
            _c2_high = np.array([min(179, int(h) + 15), 255, 255])
            _c2_set  = True
            print(f"[CUSTOM] Pencil 2 color → H={h} S={s} V={v}")

# ── Drawing helpers ────────────────────────────────────────────────────────────
P1_COLOR = (0, 255, 80)    # green
P2_COLOR = (0, 200, 255)   # cyan

def draw_crosshair(display, centroid, color, label):
    if centroid is None:
        return
    cx, cy = centroid
    cv2.circle(display, (cx, cy), 14, color, 3)
    cv2.circle(display, (cx, cy),  4, color, -1)
    cv2.putText(display, label, (cx + 18, cy - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

def draw_color_swatch(display, low, high, label, x, y, set_flag):
    """Draw a small filled rectangle showing the midpoint of the HSV range."""
    h = int((int(low[0]) + int(high[0])) / 2)
    s = int((int(low[1]) + int(high[1])) / 2)
    v = int((int(low[2]) + int(high[2])) / 2)
    swatch_hsv = np.array([[[h, s, v]]], dtype=np.uint8)
    swatch_bgr = cv2.cvtColor(swatch_hsv, cv2.COLOR_HSV2BGR)[0, 0].tolist()
    border_col = (200, 200, 200) if not set_flag else (255, 255, 255)
    cv2.rectangle(display, (x, y), (x + 28, y + 28), swatch_bgr, -1)
    cv2.rectangle(display, (x, y), (x + 28, y + 28), border_col, 2)
    cv2.putText(display, label, (x + 33, y + 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(display, label, (x + 33, y + 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30, 30, 30), 1, cv2.LINE_AA)

# ── Main loop ──────────────────────────────────────────────────────────────────
def main():
    global _corners, _corner_mode, _mode, _thresh, _last_frame

    t = threading.Thread(target=run_server, daemon=True)
    t.start()

    cap = cv2.VideoCapture(CAMERA_IDX)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open camera {CAMERA_IDX}")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, 1280, 720)
    cv2.setMouseCallback(WINDOW_NAME, on_mouse)

    M_warp = None
    out_w  = 800
    out_h  = 600

    print("\n=== Comically Large Paintbrush — Tracker (dual-point) ===")
    print(f"  HTTP state endpoint: http://localhost:{PORT}/state")
    print("  C = select canvas corners")
    print("  M = cycle tracking mode")
    print("  In CUSTOM mode: left-click = Pencil 1 color, right-click = Pencil 2 color")
    print("  Q / ESC = quit\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[WARN] Frame grab failed, retrying…")
            time.sleep(0.05)
            continue

        if FLIP_H:
            frame = cv2.flip(frame, 1)

        _last_frame = frame   # expose to mouse callback
        display     = frame.copy()

        # Rebuild warp matrix when corners become available
        if len(_corners) == 4 and M_warp is None:
            M_warp, out_w, out_h = build_transform(_corners)

        # ── Track ─────────────────────────────────────────────────────────────
        if _mode == "CUSTOM":
            mask1    = make_hsv_mask(frame, _c1_low, _c1_high)
            mask2    = make_hsv_mask(frame, _c2_low, _c2_high)
            c1       = find_centroid(mask1)
            c2       = find_centroid(mask2)
            disp_mask = cv2.bitwise_or(mask1, mask2)
        else:
            mask      = make_mask(frame, _mode, _thresh, _hue_tol)
            c1, c2    = find_two_centroids(mask)
            disp_mask = mask

        set_points(c1, c2, M_warp, out_w, out_h, frame.shape)

        # ── Retrieve normalised coords for display labels ──────────────────────
        with _lock:
            s1, s2 = dict(_state["p1"]), dict(_state["p2"])

        # ── Draw crosshairs ────────────────────────────────────────────────────
        lbl1 = f"P1 ({s1['x']:.3f}, {s1['y']:.3f})" if c1 else "P1"
        lbl2 = f"P2 ({s2['x']:.3f}, {s2['y']:.3f})" if c2 else "P2"
        draw_crosshair(display, c1, P1_COLOR,  lbl1)
        draw_crosshair(display, c2, P2_COLOR,  lbl2)

        # ── Canvas corners & outline ───────────────────────────────────────────
        for i, pt in enumerate(_corners):
            cv2.circle(display, pt, 8, (0, 200, 255), -1)
            label_txt = ["TL","TR","BR","BL"][i] if len(_corners) == 4 else str(i + 1)
            cv2.putText(display, label_txt, (pt[0]+10, pt[1]-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)

        if len(_corners) == 4:
            pts = order_corners(_corners).astype(int)
            cv2.polylines(display, [pts], True, (0, 200, 255), 2)

        if _corner_mode:
            cv2.putText(display,
                        f"CLICK CORNER {len(_corners)+1}/4  (TL → TR → BR → BL)",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 120, 255), 2)

        # ── CUSTOM mode color-swatch overlay ──────────────────────────────────
        if _mode == "CUSTOM":
            cv2.putText(display,
                        "CUSTOM: Left-click=Pencil1  Right-click=Pencil2",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (200, 200, 0), 2)
            draw_color_swatch(display, _c1_low, _c1_high,
                              "Pencil 1" + (" (set)" if _c1_set else " (default)"),
                              20, 70, _c1_set)
            draw_color_swatch(display, _c2_low, _c2_high,
                              "Pencil 2" + (" (set)" if _c2_set else " (default)"),
                              20, 110, _c2_set)

        # ── HUD ───────────────────────────────────────────────────────────────
        warp_str = "ON" if M_warp is not None else "OFF (press C)"
        hud = [
            f"Mode: {_mode}  |  Threshold: {_thresh}",
            f"Perspective warp: {warp_str}",
            f"HTTP: localhost:{PORT}/state",
            "C=corners  M=mode  [/]=thresh  R=reset  Q=quit",
        ]
        for i, line in enumerate(hud):
            cv2.putText(display, line, (10, display.shape[0]-20-i*26),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 2, cv2.LINE_AA)
            cv2.putText(display, line, (10, display.shape[0]-20-i*26),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30,30,30),  1, cv2.LINE_AA)

        # ── Mask preview (top-right) ───────────────────────────────────────────
        mh, mw   = 120, 160
        mask_rgb = cv2.cvtColor(disp_mask, cv2.COLOR_GRAY2BGR)
        mask_sm  = cv2.resize(mask_rgb, (mw, mh))
        display[10:10+mh, display.shape[1]-mw-10:display.shape[1]-10] = mask_sm
        cv2.putText(display, "MASK", (display.shape[1]-mw-10+4, 8+mh),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180,180,255), 1)

        cv2.imshow(WINDOW_NAME, display)

        # ── Key handling ──────────────────────────────────────────────────────
        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), 27):
            break
        elif key == ord('c'):
            _corners     = []
            M_warp       = None
            _corner_mode = True
            print("[CORNERS] Click 4 corners: TL → TR → BR → BL")
        elif key == ord('m'):
            _mode = MODES[(MODES.index(_mode) + 1) % len(MODES)]
            print(f"[MODE] {_mode}")
        elif key == ord('['):
            _thresh = max(0, _thresh - 10)
            print(f"[THRESH] {_thresh}")
        elif key == ord(']'):
            _thresh = min(255, _thresh + 10)
            print(f"[THRESH] {_thresh}")
        elif key == ord('r'):
            set_reset()
            print("[RESET] Sent reset to game.")

    cap.release()
    cv2.destroyAllWindows()
    print("[DONE]")

if __name__ == "__main__":
    main()
