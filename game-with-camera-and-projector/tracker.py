"""
Comically Large Paintbrush — Camera Tracker
============================================
Tracks a bright/colored object via webcam, applies a perspective warp
to map the physical canvas corners into a normalized 4:3 coordinate
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

HTTP endpoint (default port 5050)
----------------------------------
  GET /state   →  {"x": 0.0-1.0, "y": 0.0-1.0, "active": bool, "reset": bool}
  GET /health  →  {"ok": true}

  x/y are normalized 0-1 within the warped canvas rectangle.
  active=true while the tracked point is visible.
  reset=true once after R is pressed (auto-clears after one read).
"""

import cv2
import numpy as np
import json
import threading
import time
import math
from http.server import HTTPServer, BaseHTTPRequestHandler

# ── Config ────────────────────────────────────────────────────────────────────
PORT        = 5050
CAMERA_IDX  = 0          # change if your webcam isn't device 0
FLIP_H      = False      # set True if image is mirrored
WINDOW_NAME = "CLPbrush Tracker  |  C=corners  M=mode  [/]=threshold  R=reset  Q=quit"

# Tracking modes
MODES = ["BRIGHT", "RED", "GREEN", "BLUE", "CUSTOM"]

# Default HSV range for CUSTOM mode (edit to your object's color)
CUSTOM_HSV_LOW  = np.array([100, 150, 100])   # blue-ish by default
CUSTOM_HSV_HIGH = np.array([130, 255, 255])

# ── Shared state (thread-safe via lock) ────────────────────────────────────────
_lock    = threading.Lock()
_state   = {"x": 0.5, "y": 0.5, "active": False, "reset": False}
_corners = []            # list of up to 4 (x,y) pixel tuples
_mode    = "BRIGHT"
_thresh  = 200           # brightness threshold (0-255) for BRIGHT mode
_hue_tol = 15            # ±hue tolerance for color modes

def get_state():
    with _lock:
        s = dict(_state)
        _state["reset"] = False   # consume reset flag
    return s

def set_point(nx, ny, active):
    with _lock:
        _state["x"]      = float(nx)
        _state["y"]      = float(ny)
        _state["active"] = bool(active)

def set_reset():
    with _lock:
        _state["reset"] = True

# ── HTTP server ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass   # silence request logs

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
    """Return corners as [TL, TR, BR, BL] regardless of click order."""
    pts  = np.array(pts, dtype="float32")
    s    = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    return np.array([
        pts[np.argmin(s)],    # TL
        pts[np.argmin(diff)], # TR
        pts[np.argmax(s)],    # BR
        pts[np.argmax(diff)], # BL
    ], dtype="float32")

def build_transform(corners_px, out_w=800, out_h=600):
    src = order_corners(corners_px)
    dst = np.array([[0,0],[out_w,0],[out_w,out_h],[0,out_h]], dtype="float32")
    return cv2.getPerspectiveTransform(src, dst), out_w, out_h

def warp_point(pt, M, out_w, out_h):
    """Transform a single pixel point through perspective matrix M → (nx, ny)."""
    v = np.array([[[pt[0], pt[1]]]], dtype="float32")
    r = cv2.perspectiveTransform(v, M)
    nx = float(r[0,0,0]) / out_w
    ny = float(r[0,0,1]) / out_h
    return nx, ny

# ── Color/brightness masking ───────────────────────────────────────────────────
def make_mask(frame, mode, thresh, hue_tol):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    if mode == "BRIGHT":
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
    elif mode == "RED":
        lo1 = np.array([0,     120, 70])
        hi1 = np.array([10,    255,255])
        lo2 = np.array([170,   120, 70])
        hi2 = np.array([180,   255,255])
        mask = cv2.bitwise_or(cv2.inRange(hsv, lo1, hi1),
                               cv2.inRange(hsv, lo2, hi2))
    elif mode == "GREEN":
        mask = cv2.inRange(hsv, np.array([40,  70, 70]),
                                np.array([80, 255,255]))
    elif mode == "BLUE":
        mask = cv2.inRange(hsv, np.array([100, 80, 70]),
                                np.array([130,255,255]))
    elif mode == "CUSTOM":
        mask = cv2.inRange(hsv, CUSTOM_HSV_LOW, CUSTOM_HSV_HIGH)
    else:
        mask = np.zeros(frame.shape[:2], dtype=np.uint8)

    # Clean up noise
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5,5))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)
    mask   = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel)
    return mask

def find_centroid(mask):
    """Return (cx, cy) of largest contour in mask, or None."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL,
                                        cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c  = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 30:
        return None
    M  = cv2.moments(c)
    if M["m00"] == 0:
        return None
    return int(M["m10"]/M["m00"]), int(M["m01"]/M["m00"])

# ── Mouse callback (corner selection) ─────────────────────────────────────────
_corner_mode = False

def on_mouse(event, x, y, flags, param):
    global _corners, _corner_mode
    if not _corner_mode:
        return
    if event == cv2.EVENT_LBUTTONDOWN:
        if len(_corners) < 4:
            _corners.append((x, y))
            print(f"  Corner {len(_corners)}: ({x}, {y})")
            if len(_corners) == 4:
                _corner_mode = False
                print("[CORNERS] All 4 set — perspective correction active.")

# ── Main loop ──────────────────────────────────────────────────────────────────
def main():
    global _corners, _corner_mode, _mode, _thresh

    # Start HTTP server in background thread
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

    M_warp  = None
    out_w   = 800
    out_h   = 600

    print("\n=== Comically Large Paintbrush — Tracker ===")
    print(f"  HTTP state endpoint: http://localhost:{PORT}/state")
    print("  Press C in the window to select canvas corners.")
    print("  Press M to cycle tracking mode.")
    print("  Press Q or ESC to quit.\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[WARN] Frame grab failed, retrying…")
            time.sleep(0.05)
            continue

        if FLIP_H:
            frame = cv2.flip(frame, 1)

        display = frame.copy()

        # ── Rebuild warp matrix when corners change ──────────────────────────
        if len(_corners) == 4 and M_warp is None:
            M_warp, out_w, out_h = build_transform(_corners)

        # ── Track ─────────────────────────────────────────────────────────────
        mask     = make_mask(frame, _mode, _thresh, _hue_tol)
        centroid = find_centroid(mask)

        if centroid:
            cx, cy = centroid
            if M_warp is not None:
                nx, ny   = warp_point((cx, cy), M_warp, out_w, out_h)
                nx        = max(0.0, min(1.0, nx))
                ny        = max(0.0, min(1.0, ny))
                in_canvas = 0.0 <= nx <= 1.0 and 0.0 <= ny <= 1.0
            else:
                h, w     = frame.shape[:2]
                nx, ny   = cx/w, cy/h
                in_canvas = True

            set_point(nx, ny, in_canvas)
            cv2.circle(display, (cx, cy), 14, (0,255,0), 3)
            cv2.circle(display, (cx, cy),  4, (0,255,0), -1)
            label = f"({nx:.3f}, {ny:.3f})"
            cv2.putText(display, label, (cx+18, cy-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0,255,0), 2)
        else:
            set_point(0.5, 0.5, False)

        # ── Draw corners & canvas outline ─────────────────────────────────────
        for i, pt in enumerate(_corners):
            col = [(0,200,255),(0,200,255),(0,200,255),(0,200,255)]
            cv2.circle(display, pt, 8, col[i], -1)
            cv2.putText(display, ["TL","TR","BR","BL"][i] if len(_corners)==4
                        else str(i+1),
                        (pt[0]+10, pt[1]-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,200,255), 2)

        if len(_corners) == 4:
            pts = order_corners(_corners).astype(int)
            cv2.polylines(display, [pts], True, (0,200,255), 2)

        if _corner_mode:
            cv2.putText(display,
                        f"CLICK CORNER {len(_corners)+1}/4  (TL → TR → BR → BL)",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,120,255), 2)

        # ── HUD ───────────────────────────────────────────────────────────────
        warp_str = "ON" if M_warp is not None else "OFF (press C to set corners)"
        hud = [
            f"Mode: {_mode}  |  Threshold: {_thresh}",
            f"Perspective warp: {warp_str}",
            f"HTTP: localhost:{PORT}/state",
            "C=corners  M=mode  [/]=thresh  R=reset  Q=quit",
        ]
        for i, line in enumerate(hud):
            cv2.putText(display, line, (10, display.shape[0]-20-i*26),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 2,
                        cv2.LINE_AA)
            cv2.putText(display, line, (10, display.shape[0]-20-i*26),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30,30,30), 1,
                        cv2.LINE_AA)

        # Small mask preview (top-right corner)
        mh, mw   = 120, 160
        mask_rgb = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
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
            print("[CORNERS] Click 4 corners in the webcam window: TL → TR → BR → BL")
        elif key == ord('m'):
            idx   = (MODES.index(_mode) + 1) % len(MODES)
            _mode = MODES[idx]
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
