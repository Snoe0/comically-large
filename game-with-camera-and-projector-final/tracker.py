"""
Comically Large Paintbrush — Camera Tracker (final, mode-switching)
====================================================================
Tracks bright/colored objects via webcam — pencil count is set at runtime by
the game over HTTP. Applies a perspective warp to map the physical canvas
corners into a normalized 4:3 coordinate space, and exposes the result over a
tiny HTTP server so the game can poll it.

In dual (2-player) mode, the canvas is split down the middle in warped
coordinates: any centroid with normalized x < 0.5 is reported as player 1,
any centroid with normalized x ≥ 0.5 is reported as player 2. Color is
NOT used to distinguish players — a single tracking mode/color is enough.

Usage
-----
  python tracker.py

Controls (OpenCV window)
------------------------
  C          — enter corner-selection mode (click 4 corners of the canvas
               in order: top-left, top-right, bottom-right, bottom-left)
  B          — enter button-region calibration. Buttons calibrated belong to
               whichever mode the tracker is currently in (solo or dual);
               each mode keeps its own independent set of regions.
                 solo (1 player): large, medium, small, undo
                 dual (2 player): p1_large/medium/small/undo,
                                  p2_large/medium/small/undo
               Hold a pencil over a calibrated region to trigger it.
  M          — cycle tracking mode: BRIGHT | RED | GREEN | BLUE | CUSTOM
  [ / ]      — decrease / increase brightness/HSV threshold
  R          — reset all strokes (sends reset event to game)
  Q / ESC    — quit

  CUSTOM mode only:
    Left-click   — sample color under cursor → set pencil color
    (Right-click is unused. In dual mode, side-of-canvas determines which
     centroid becomes player 1 vs 2, so a single color sample suffices.)

HTTP endpoint (default port 5050)
----------------------------------
  GET  /state   →  JSON snapshot (polling, kept for compatibility):
                   {
                     "p1": {"x": 0-1, "y": 0-1, "active": bool},
                     "p2": {"x": 0-1, "y": 0-1, "active": bool},
                     "reset": bool,
                     "buttons": [name, ...]
                   }
  GET  /events  →  text/event-stream. One `data: <same JSON>` message per
                   tracker frame, pushed as soon as it's available. This is
                   what the game consumes.
  POST /mode    →  {"players": 1} or {"players": 2}. Sets how many pencils
                   the tracker looks for and which button-region set is live.
                   The game pages each POST this on load and again on the
                   1/2 mode-switch keys.
  GET  /health  →  {"ok": true}
"""

import cv2
import numpy as np
import json
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

try:
    import pyrealsense2 as rs
    _HAS_REALSENSE = True
except ImportError:
    _HAS_REALSENSE = False

# ── Config ────────────────────────────────────────────────────────────────────
PORT        = 5050
CAMERA_IDX  = 3                    # Only used when USE_REALSENSE is False
FLIP_H      = False
ROTATE_180  = True                 # Camera is physically mounted upside down
WINDOW_NAME = "CLPbrush Tracker  |  C=corners  M=mode  [/]=threshold  R=reset  Q=quit"

# ── RealSense config ──────────────────────────────────────────────────────────
# The D455 exposes its IR imagers only through the librealsense SDK, NOT through
# OpenCV's VideoCapture. Use pyrealsense2 to pull the left-IR stream directly.
USE_REALSENSE       = True
RS_IR_INDEX         = 1            # 1 = left IR imager, 2 = right IR imager
# USB 2.1 limits the D455 to a subset of stream modes — 1280x720 is not available
# over USB 2 even for IR-only. 640x480@30 is a well-documented USB 2 IR mode
# (~74 Mbps, well under the ~280 Mbps USB 2.1 ceiling).
RS_WIDTH            = 640
RS_HEIGHT           = 480
RS_FPS              = 30
RS_EMITTER_ENABLED  = False        # D455's dot projector — off = clean passive IR
# Manual exposure forces the scene dark so only the IR LED punches through.
# Auto-exposure fights you here — it brightens the whole frame and lights up
# every reflection. Start low (~500 µs) and raise if the LED itself is too dim.
RS_AUTO_EXPOSURE    = False
RS_EXPOSURE_US      = 2000         # microseconds; typical useful range ~100–8000
RS_GAIN             = 24           # 16 = minimum on D455 IR

MODES = ["BRIGHT", "RED", "GREEN", "BLUE", "CUSTOM"]

# ── Shared state (thread-safe via lock) ────────────────────────────────────────
_lock  = threading.Lock()
# Pulsed whenever state changes, so the SSE /events handler can wake and push
# a new frame instead of timer-polling. Single-consumer: if multiple clients
# connect, one will win the wait() each tick and the others may miss frames
# — fine for the local game, which is the only intended consumer.
_state_bumped = threading.Event()
_state = {
    "p1":      {"x": 0.5, "y": 0.5, "active": False},
    "p2":      {"x": 0.5, "y": 0.5, "active": False},
    "reset":   False,
    "buttons": [],   # button names fired this tick; consumed by get_state()
}
# Pencils to track: 1 (solo) or 2 (dual). The game page POSTs /mode on load
# and on every 1/2 key press, so this flips at runtime.
_num_players = 2
_corners     = []
_mode        = "BRIGHT"
_thresh      = 80
_hue_tol     = 15

# CUSTOM mode: a single HSV color range. Player 1 vs 2 is determined by
# which side of the canvas midline a centroid falls on, not by color.
_c1_low  = np.array([100, 150, 100])   # default blue-ish
_c1_high = np.array([130, 255, 255])
_c1_set  = False                        # True once user has clicked a color

# ── Button region calibration ──────────────────────────────────────────────────
# Each button gets its own perspective transform built from 4 camera-pixel
# corners (which may be a trapezoid due to camera angle).  A centroid is
# "inside" a button when its warped coordinate lands in the unit square [0,1]².
# Fires immediately on the first frame the point enters; won't re-fire until
# the point leaves and re-enters.
# Each mode keeps its own independent button-region set. Calibrating one
# does not overwrite the other, so the operator can press B in solo mode,
# calibrate 4 buttons, swap to dual mode, calibrate 8 more, and both sets
# survive subsequent mode swaps for the rest of the session.
BUTTON_NAMES_SOLO = ["large", "medium", "small", "undo"]
BUTTON_NAMES_DUAL = [
    "p1_large", "p1_medium", "p1_small", "p1_undo",
    "p2_large", "p2_medium", "p2_small", "p2_undo",
]
_button_regions_solo = {}          # name → (M_btn, cam_corners)
_button_regions_dual = {}
_button_locked_solo  = {n: False for n in BUTTON_NAMES_SOLO}
_button_locked_dual  = {n: False for n in BUTTON_NAMES_DUAL}

_button_setup_mode  = False
_button_setup_idx   = 0           # index into the active BUTTON_NAMES_* list
_button_setup_pts   = []          # corners clicked so far for current button (up to 4)

def _active_button_names():
    return BUTTON_NAMES_SOLO if _num_players == 1 else BUTTON_NAMES_DUAL

def _active_button_regions():
    return _button_regions_solo if _num_players == 1 else _button_regions_dual

def _active_button_locked():
    return _button_locked_solo if _num_players == 1 else _button_locked_dual

# Latest frame shared with mouse callback for color picking
_last_frame  = None
_corner_mode = False

def get_state():
    with _lock:
        s = {
            "p1":      dict(_state["p1"]),
            "p2":      dict(_state["p2"]),
            "reset":   _state["reset"],
            "buttons": list(_state["buttons"]),
        }
        _state["reset"]   = False
        _state["buttons"] = []
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
                    active = 0.0 <= nx <= 1.0 and 0.0 <= ny <= 1.0
                else:
                    h, w   = frame_shape[:2]
                    nx, ny = cx / w, cy / h
                    active = True
                _state[key]["x"]      = nx
                _state[key]["y"]      = ny
                _state[key]["active"] = active
            else:
                _state[key]["active"] = False
    _state_bumped.set()

def _point_in_button(M_btn, cx, cy):
    """Return True if (cx, cy) maps into the unit square via M_btn."""
    v = np.array([[[cx, cy]]], dtype="float32")
    r = cv2.perspectiveTransform(v, M_btn)
    u, v_ = float(r[0, 0, 0]), float(r[0, 0, 1])
    return 0.0 <= u <= 1.0 and 0.0 <= v_ <= 1.0

def check_button_hits(raw_centroids):
    """Fire a button the instant a centroid enters its region. Re-arms on exit."""
    regions = _active_button_regions()
    locked  = _active_button_locked()
    if not regions:
        return
    with _lock:
        for name, (M_btn, _) in regions.items():
            inside = any(
                c and _point_in_button(M_btn, c[0], c[1])
                for c in raw_centroids
            )
            if inside:
                if not locked[name]:
                    _state["buttons"].append(name)
                    locked[name] = True
                    _state_bumped.set()
            else:
                locked[name] = False

def set_reset():
    with _lock:
        _state["reset"] = True
    _state_bumped.set()

# ── HTTP server ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        # Browser preflight for the cross-origin POST /mode call from the game.
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path.startswith("/mode"):
            global _num_players
            length = int(self.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(self.rfile.read(length).decode() or "{}")
                requested = int(payload.get("players"))
            except (ValueError, TypeError, json.JSONDecodeError):
                self.send_response(400); self._cors_headers(); self.end_headers()
                return
            if requested not in (1, 2):
                self.send_response(400); self._cors_headers(); self.end_headers()
                return
            with _lock:
                prev = _num_players
                _num_players = requested
                if requested == 1 and prev == 2:
                    # Stop drawing the now-orphan P2 cursor in the game.
                    _state["p2"]["active"] = False
            _state_bumped.set()
            print(f"[MODE] players={requested} (was {prev})")
            body = json.dumps({"players": requested}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors_headers()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self._cors_headers(); self.end_headers()

    def do_GET(self):
        if self.path.startswith("/state"):
            body = json.dumps(get_state()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/events"):
            # Server-Sent Events stream. Blocks on _state_bumped so we push
            # exactly one frame per tracker update instead of timer-polling.
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            try:
                # Send an initial snapshot so the client has state before the
                # next capture frame arrives.
                body = json.dumps(get_state()).encode()
                self.wfile.write(b"data: " + body + b"\n\n")
                self.wfile.flush()
                while True:
                    # Wait for the next state change; fall through every 15s
                    # to write a keepalive comment so intermediaries don't
                    # close the idle connection.
                    if _state_bumped.wait(timeout=15.0):
                        _state_bumped.clear()
                        body = json.dumps(get_state()).encode()
                        self.wfile.write(b"data: " + body + b"\n\n")
                    else:
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
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
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[HTTP] Serving on http://localhost:{PORT}")
    server.serve_forever()

# ── Perspective warp helpers ───────────────────────────────────────────────────
def order_corners(pts):
    # Sort the 4 points clockwise by angle from their centroid, then rotate so
    # the point closest to the top-left of the bounding box is first. This is
    # robust for any convex quadrilateral; the simpler sum/diff heuristic
    # collapses to 3 unique points when the quad is rotated enough that one
    # corner minimizes both (x+y) and (y-x) — producing a triangle instead of
    # a quad after polylines draws it.
    pts    = np.array(pts, dtype="float32")
    center = pts.mean(axis=0)
    # In image coordinates (y-axis points down), ascending atan2 sorts
    # clockwise: TL ~ -3pi/4, TR ~ -pi/4, BR ~ pi/4, BL ~ 3pi/4.
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    ordered = pts[np.argsort(angles)]
    tl_idx  = int(np.argmin(ordered.sum(axis=1)))
    return np.roll(ordered, -tl_idx, axis=0)

def build_transform(corners_px, out_w=800, out_h=600):
    # Use the clicked order as-is (TL, TR, BR, BL). This lets the user
    # freely assign any physical corner as "top-left" — e.g. clicking the
    # physical bottom-right first rotates the whole coordinate space so
    # that corner maps to (0, 0) in the normalized output.
    src = np.array(corners_px, dtype="float32")
    dst = np.array([[0,0],[out_w,0],[out_w,out_h],[0,out_h]], dtype="float32")
    return cv2.getPerspectiveTransform(src, dst), out_w, out_h

# ── Masking ───────────────────────────────────────────────────────────────────
def _clean(mask):
    # 3x3 kernel (was 5x5) so a small, round IR point isn't eroded away by the
    # opening step on frames where it's only a handful of pixels wide.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
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
MIN_CONTOUR_AREA = 5   # was 30; small IR points flicker out above that

def find_centroid(mask):
    """Return (cx, cy) of largest contour, or None."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < MIN_CONTOUR_AREA:
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
        if cv2.contourArea(c) < MIN_CONTOUR_AREA:
            break
        M = cv2.moments(c)
        if M["m00"] == 0:
            continue
        results.append((int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"])))
    while len(results) < 2:
        results.append(None)
    return results[0], results[1]

def find_n_centroids(mask, n=4):
    """Return up to n centroids of the largest contours, sorted by area desc.

    Used by the dual-mode side-based assignment so a stray reflection on the
    wrong side of the canvas can't mask a real pencil on the correct side
    (unlike find_two_centroids, which would just return the top two by area).
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    out = []
    for c in contours[:n]:
        if cv2.contourArea(c) < MIN_CONTOUR_AREA:
            break
        M = cv2.moments(c)
        if M["m00"] == 0:
            continue
        out.append((int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"])))
    return out

def assign_by_side(centroids, M_warp, out_w):
    """Pick the largest centroid on each side of the warped midline (x=0.5).

    `centroids` is assumed to be sorted by area descending. Returns
    (c_left, c_right); either may be None if no centroid landed on that side.
    Centroids whose warped x lies outside [0,1] still get assigned to
    whichever side they fall toward — set_points() downstream will mark them
    inactive based on bounds, which is the correct behavior.
    """
    c_left = None
    c_right = None
    for cx, cy in centroids:
        v  = np.array([[[cx, cy]]], dtype="float32")
        r  = cv2.perspectiveTransform(v, M_warp)
        nx = float(r[0, 0, 0]) / out_w
        if nx < 0.5 and c_left is None:
            c_left = (cx, cy)
        elif nx >= 0.5 and c_right is None:
            c_right = (cx, cy)
        if c_left is not None and c_right is not None:
            break
    return c_left, c_right

# ── Mouse callback ─────────────────────────────────────────────────────────────
def on_mouse(event, x, y, flags, param):
    global _corners, _corner_mode
    global _c1_low, _c1_high, _c1_set, _last_frame
    global _button_setup_mode, _button_setup_idx, _button_setup_pts

    # Canvas corner-selection mode takes priority
    if _corner_mode:
        if event == cv2.EVENT_LBUTTONDOWN and len(_corners) < 4:
            _corners.append((x, y))
            print(f"  Corner {len(_corners)}: ({x}, {y})")
            if len(_corners) == 4:
                _corner_mode = False
                print("[CORNERS] All 4 set — perspective correction active.")
        return

    # Button region setup mode — collect 4 corners per button. Buttons go
    # into whichever set (solo or dual) matches the tracker's current mode.
    if _button_setup_mode:
        if event == cv2.EVENT_LBUTTONDOWN:
            _button_setup_pts.append((x, y))
            names   = _active_button_names()
            regions = _active_button_regions()
            name    = names[_button_setup_idx]
            n = len(_button_setup_pts)
            print(f"  [{name}] Corner {n}/4: ({x}, {y})")
            if n == 4:
                src = order_corners(_button_setup_pts)
                dst = np.array([[0,0],[1,0],[1,1],[0,1]], dtype="float32")
                M_btn = cv2.getPerspectiveTransform(src, dst)
                regions[name] = (M_btn, [tuple(p) for p in src.astype(int).tolist()])
                print(f"  [{name}] Region set from corners: {_button_setup_pts}")
                _button_setup_pts = []
                _button_setup_idx += 1
                if _button_setup_idx >= len(names):
                    _button_setup_mode = False
                    _button_setup_idx  = 0
                    print("[BUTTONS] All button regions calibrated.")
                else:
                    print(f"  Next: click 4 corners for [{names[_button_setup_idx]}]")
        return

    # CUSTOM mode: sample color under cursor. Single sample — side-of-canvas
    # decides which player a centroid belongs to in dual mode.
    if _mode == "CUSTOM" and _last_frame is not None:
        if event == cv2.EVENT_LBUTTONDOWN:
            hsv = cv2.cvtColor(_last_frame, cv2.COLOR_BGR2HSV)
            h, s, v = hsv[y, x]
            _c1_low  = np.array([max(0,   int(h) - 15), max(0,   int(s) - 60), max(0,   int(v) - 60)])
            _c1_high = np.array([min(179, int(h) + 15), 255, 255])
            _c1_set  = True
            print(f"[CUSTOM] Pencil color -> H={h} S={s} V={v}")

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

# ── Capture layer ─────────────────────────────────────────────────────────────
class RealsenseCapture:
    """
    Minimal cv2.VideoCapture-compatible wrapper around a pyrealsense2 pipeline
    that delivers the D455's left (or right) IR stream as a 3-channel BGR frame.
    Only the methods used by main() are implemented: isOpened, read, set, release.

    Self-heals against the common "stereo module is wedged and never delivers
    frames" state by issuing a hardware_reset() and retrying once.
    """
    def __init__(self, ir_index=1, width=1280, height=720, fps=30, emitter_enabled=False):
        self._opened         = False
        self._ir_index       = ir_index
        self._width          = width
        self._height         = height
        self._fps            = fps
        self._emitter        = emitter_enabled
        self._pipeline       = None

        if not self._start_and_probe():
            print("[RS] First start produced no frames — resetting device and retrying.")
            self._hardware_reset()
            if not self._start_and_probe():
                print("[ERROR] RealSense stereo module not delivering frames after reset.")
                return

        self._opened = True
        print(f"[RS] Streaming IR {ir_index} @ {width}x{height} {fps}fps")

    def _start_and_probe(self):
        """Start the pipeline and verify that at least one IR frame arrives."""
        self._pipeline = rs.pipeline()
        cfg = rs.config()
        # IR-only over USB 2.1 — depth stream omitted to stay under bandwidth.
        cfg.enable_stream(
            rs.stream.infrared, self._ir_index,
            self._width, self._height, rs.format.y8, self._fps,
        )
        try:
            profile = self._pipeline.start(cfg)
        except RuntimeError as e:
            print(f"[RS] pipeline.start failed: {e}")
            self._pipeline = None
            return False

        # The IR dot projector, exposure, and gain all live on the depth sensor.
        try:
            depth_sensor = profile.get_device().first_depth_sensor()
            if depth_sensor.supports(rs.option.emitter_enabled):
                depth_sensor.set_option(rs.option.emitter_enabled, 1.0 if self._emitter else 0.0)
                print(f"[RS] IR emitter: {'ON' if self._emitter else 'OFF'}")

            # Auto-exposure will brighten the room and light up every reflection,
            # which is exactly what we *don't* want when hunting a point source.
            # Force manual exposure low so only the IR LED itself punches through.
            if depth_sensor.supports(rs.option.enable_auto_exposure):
                depth_sensor.set_option(
                    rs.option.enable_auto_exposure,
                    1.0 if RS_AUTO_EXPOSURE else 0.0,
                )
                print(f"[RS] IR auto-exposure: {'ON' if RS_AUTO_EXPOSURE else 'OFF'}")
            if not RS_AUTO_EXPOSURE:
                if depth_sensor.supports(rs.option.exposure):
                    depth_sensor.set_option(rs.option.exposure, float(RS_EXPOSURE_US))
                    print(f"[RS] IR exposure: {RS_EXPOSURE_US} us")
                if depth_sensor.supports(rs.option.gain):
                    depth_sensor.set_option(rs.option.gain, float(RS_GAIN))
                    print(f"[RS] IR gain: {RS_GAIN}")
        except Exception as e:
            print(f"[RS] Could not configure IR sensor options: {e}")

        # Probe: one frame must actually arrive, or we consider the start a failure.
        try:
            frames = self._pipeline.wait_for_frames(timeout_ms=3000)
            if frames.get_infrared_frame(self._ir_index):
                return True
            print("[RS] Probe frameset contained no IR frame.")
        except RuntimeError as e:
            print(f"[RS] Probe wait_for_frames failed: {e}")

        try:
            self._pipeline.stop()
        except Exception:
            pass
        self._pipeline = None
        return False

    def _hardware_reset(self):
        """Reset the D455 and wait for it to re-enumerate."""
        try:
            ctx = rs.context()
            devs = ctx.query_devices()
            if len(devs) == 0:
                return
            devs[0].hardware_reset()
        except Exception as e:
            print(f"[RS] hardware_reset raised: {e}")
            return

        # Wait for re-enumeration
        for i in range(20):
            time.sleep(0.5)
            if len(rs.context().query_devices()) > 0:
                time.sleep(0.5)  # settle
                return
        print("[RS] Device did not re-enumerate within 10s after reset.")

    def isOpened(self):
        return self._opened

    def read(self):
        if not self._opened:
            return False, None
        try:
            frames = self._pipeline.wait_for_frames(timeout_ms=2000)
        except RuntimeError:
            return False, None
        ir = frames.get_infrared_frame(self._ir_index)
        if not ir:
            return False, None
        y8 = np.asanyarray(ir.get_data())
        # Convert to BGR so the existing HSV/threshold pipeline works unchanged.
        return True, cv2.cvtColor(y8, cv2.COLOR_GRAY2BGR)

    def set(self, *_args, **_kwargs):
        # No-op: resolution/FPS are fixed at pipeline start. Kept for API parity
        # with cv2.VideoCapture so main() doesn't need to branch.
        return True

    def release(self):
        if self._opened:
            try:
                self._pipeline.stop()
            except Exception:
                pass
            self._opened = False


def open_capture():
    """Return a capture object — RealSense if configured and available, else OpenCV."""
    if USE_REALSENSE:
        if not _HAS_REALSENSE:
            print("[ERROR] USE_REALSENSE=True but pyrealsense2 is not installed.")
            print("        Run: pip install pyrealsense2")
            return None
        cap = RealsenseCapture(
            ir_index=RS_IR_INDEX,
            width=RS_WIDTH,
            height=RS_HEIGHT,
            fps=RS_FPS,
            emitter_enabled=RS_EMITTER_ENABLED,
        )
        if not cap.isOpened():
            print("[ERROR] Could not start RealSense pipeline. Is the D455 plugged in?")
            return None
        return cap

    cap = cv2.VideoCapture(CAMERA_IDX)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open camera {CAMERA_IDX}")
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    return cap


# ── Main loop ──────────────────────────────────────────────────────────────────
def main():
    global _corners, _corner_mode, _mode, _thresh, _last_frame
    global _button_setup_mode, _button_setup_idx, _button_setup_pts, _button_regions

    t = threading.Thread(target=run_server, daemon=True)
    t.start()

    cap = open_capture()
    if cap is None:
        return

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, 1280, 720)
    cv2.setMouseCallback(WINDOW_NAME, on_mouse)

    M_warp = None
    out_w  = 800
    out_h  = 600

    print("\n=== Comically Large Paintbrush — Tracker (final, mode-switching) ===")
    print(f"  HTTP state endpoint: http://localhost:{PORT}/state")
    print(f"  POST mode endpoint:  http://localhost:{PORT}/mode  body={{\"players\":1|2}}")
    print("  C = select canvas corners (4 clicks)")
    print("  B = calibrate button regions (per current mode: 4 in solo, 8 in dual)")
    print("  M = cycle tracking mode")
    print("  In CUSTOM mode: left-click samples pencil color (side -> player)")
    print("  Q / ESC = quit\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[WARN] Frame grab failed, retrying…")
            time.sleep(0.05)
            continue

        if ROTATE_180:
            frame = cv2.rotate(frame, cv2.ROTATE_180)
        if FLIP_H:
            frame = cv2.flip(frame, 1)

        _last_frame = frame   # expose to mouse callback
        display     = frame.copy()

        # Rebuild warp matrix when corners become available
        if len(_corners) == 4 and M_warp is None:
            M_warp, out_w, out_h = build_transform(_corners)

        # ── Track ─────────────────────────────────────────────────────────────
        # All modes use a single mask. In dual mode we look for several
        # centroids and assign them to p1/p2 by which side of the warped
        # canvas (x=0.5) they fall on, instead of by area or color.
        if _mode == "CUSTOM":
            mask = make_hsv_mask(frame, _c1_low, _c1_high)
        else:
            mask = make_mask(frame, _mode, _thresh, _hue_tol)
        disp_mask = mask

        if _num_players == 1:
            c1 = find_centroid(mask)
            c2 = None
        else:
            if M_warp is not None:
                # Side-based assignment: largest centroid on each half wins.
                candidates = find_n_centroids(mask, n=4)
                c1, c2 = assign_by_side(candidates, M_warp, out_w)
            else:
                # No canvas warp yet → no midline to compare against. Fall
                # back to the legacy "biggest two by area" behavior so the
                # operator still sees crosshairs while calibrating corners.
                c1, c2 = find_two_centroids(mask)

        set_points(c1, c2, M_warp, out_w, out_h, frame.shape)
        check_button_hits([c1, c2] if _num_players == 2 else [c1])

        # ── Retrieve normalised coords for display labels ──────────────────────
        with _lock:
            s1, s2 = dict(_state["p1"]), dict(_state["p2"])

        # ── Draw crosshairs ────────────────────────────────────────────────────
        lbl1 = f"P1 ({s1['x']:.3f}, {s1['y']:.3f})" if c1 else "P1"
        draw_crosshair(display, c1, P1_COLOR,  lbl1)
        if _num_players == 2:
            lbl2 = f"P2 ({s2['x']:.3f}, {s2['y']:.3f})" if c2 else "P2"
            draw_crosshair(display, c2, P2_COLOR,  lbl2)

        # ── Canvas corners & outline ───────────────────────────────────────────
        for i, pt in enumerate(_corners):
            cv2.circle(display, pt, 8, (0, 200, 255), -1)
            label_txt = ["TL","TR","BR","BL"][i] if len(_corners) == 4 else str(i + 1)
            cv2.putText(display, label_txt, (pt[0]+10, pt[1]-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)

        if len(_corners) == 4:
            # Draw the outline in clicked order so the quadrilateral visually
            # matches the perspective mapping (TL -> TR -> BR -> BL).
            pts = np.array(_corners, dtype=np.int32)
            cv2.polylines(display, [pts], True, (0, 200, 255), 2)
            # In dual mode, also draw the midline (warped x=0.5) so the
            # operator can see which side a pencil will be assigned to.
            if _num_players == 2 and M_warp is not None:
                try:
                    inv = np.linalg.inv(M_warp)
                    top    = np.array([[[0.5 * out_w, 0.0]]],          dtype="float32")
                    bottom = np.array([[[0.5 * out_w, float(out_h)]]], dtype="float32")
                    tp = cv2.perspectiveTransform(top,    inv)[0, 0]
                    bp = cv2.perspectiveTransform(bottom, inv)[0, 0]
                    cv2.line(display,
                             (int(tp[0]), int(tp[1])),
                             (int(bp[0]), int(bp[1])),
                             (180, 180, 255), 2, cv2.LINE_AA)
                except np.linalg.LinAlgError:
                    pass

        # ── Button region overlays ────────────────────────────────────────────
        active_regions = _active_button_regions()
        active_locked  = _active_button_locked()
        for name, (_, cam_corners) in active_regions.items():
            color = (255, 200, 0) if active_locked.get(name) else (0, 255, 200)
            pts = np.array(cam_corners, dtype=np.int32)
            cv2.polylines(display, [pts], True, color, 2)
            cx = int(sum(p[0] for p in cam_corners) / 4)
            cy = int(sum(p[1] for p in cam_corners) / 4)
            cv2.putText(display, name, (cx - 30, cy + 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA)

        if _button_setup_mode:
            names = _active_button_names()
            name  = names[_button_setup_idx]
            n     = len(_button_setup_pts)
            cv2.putText(display,
                        f"BUTTON SETUP [{_button_setup_idx+1}/{len(names)}] {name}  —  Click corner {n+1}/4",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 255, 120), 2)
            for pt in _button_setup_pts:
                cv2.circle(display, pt, 6, (0, 255, 120), -1)

        if _corner_mode:
            cv2.putText(display,
                        f"CLICK CORNER {len(_corners)+1}/4  (TL -> TR -> BR -> BL)",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 120, 255), 2)

        # ── CUSTOM mode color-swatch overlay ──────────────────────────────────
        if _mode == "CUSTOM":
            cv2.putText(display,
                        "CUSTOM: Left-click samples pencil color (side -> player)",
                        (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (200, 200, 0), 2)
            draw_color_swatch(display, _c1_low, _c1_high,
                              "Pencil" + (" (set)" if _c1_set else " (default)"),
                              20, 70, _c1_set)

        # ── HUD ───────────────────────────────────────────────────────────────
        warp_str  = "ON" if M_warp is not None else "OFF (press C)"
        names     = _active_button_names()
        regions   = _active_button_regions()
        btn_str   = f"{len(regions)}/{len(names)} set"
        mode_str  = "SOLO (1p)" if _num_players == 1 else "DUAL (2p)"
        hud = [
            f"Players: {mode_str}  |  Mode: {_mode}  |  Threshold: {_thresh}",
            f"Perspective warp: {warp_str}  |  Buttons: {btn_str}",
            f"HTTP: localhost:{PORT}/state  |  POST /mode {{\"players\":1|2}}",
            "C=corners  B=buttons  M=mode  [/]=thresh  R=reset  Q=quit",
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
            print("[CORNERS] Click 4 corners: TL -> TR -> BR -> BL")
        elif key == ord('m'):
            _mode = MODES[(MODES.index(_mode) + 1) % len(MODES)]
            print(f"[MODE] {_mode}")
        elif key == ord('['):
            _thresh = max(0, _thresh - 10)
            print(f"[THRESH] {_thresh}")
        elif key == ord(']'):
            _thresh = min(255, _thresh + 10)
            print(f"[THRESH] {_thresh}")
        elif key == ord('b'):
            # Calibrate buttons for whichever mode the tracker is currently in.
            # The other mode's regions are left untouched.
            names   = _active_button_names()
            regions = _active_button_regions()
            locked  = _active_button_locked()
            regions.clear()
            for n in names:
                locked[n] = False
            _button_setup_mode = True
            _button_setup_idx  = 0
            _button_setup_pts  = []
            mode_label = "SOLO" if _num_players == 1 else "DUAL"
            print(f"[BUTTONS] {mode_label} setup mode — click 4 corners for [{names[0]}]")
        elif key == ord('r'):
            set_reset()
            print("[RESET] Sent reset to game.")

    cap.release()
    cv2.destroyAllWindows()
    print("[DONE]")

if __name__ == "__main__":
    main()
