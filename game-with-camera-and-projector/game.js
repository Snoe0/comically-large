// ─── Tracker config ──────────────────────────────────────────────────────────
const TRACKER_URL    = "http://localhost:5050/state";
const POLL_INTERVAL  = 16;   // ms (~60 fps)
const ACTIVE_RADIUS  = 20;   // px — minimum movement to consider a stroke point new

kaplay({
  canvas: document.getElementById("gameCanvas"),
  width: 800,
  height: 600,
  background: [255, 255, 255],
  stretch: true,
});

const LINE_SPACING = 32;
const LINE_COLOR   = [173, 216, 250];
const MARGIN_COLOR = [230, 100, 100];
const DIVIDER_X    = width() / 2;

const playerState = {
  1: { brushSize: 16, opacity: 1, strokes: [] },
  2: { brushSize: 16, opacity: 1, strokes: [] },
};

let currentStroke        = null;
let trackerCurrentStroke = null;   // stroke being built by the tracker

// ─── Ruled paper ─────────────────────────────────────────────────────────────
function drawRuledLines() {
  for (let y = LINE_SPACING; y < height(); y += LINE_SPACING) {
    drawLine({ p1: vec2(0,y), p2: vec2(width(),y), width:1, color:rgb(...LINE_COLOR) });
  }
  drawLine({ p1:vec2(60,0),        p2:vec2(60,height()),        width:2, color:rgb(...MARGIN_COLOR) });
  drawLine({ p1:vec2(width()-60,0),p2:vec2(width()-60,height()),width:2, color:rgb(...MARGIN_COLOR) });
}

function drawDivider() {
  drawLine({ p1:vec2(DIVIDER_X,0), p2:vec2(DIVIDER_X,height()), width:2, color:rgb(120,120,140) });
}

// ─── Timer ─────────────────────────────────────────────────────────────
const TOTAL_TIME = 90;
let timeLeft     = TOTAL_TIME;

const timerDisplay = document.querySelector(".timer-display");


const timerInterval = setInterval(() => {
  timeLeft--;
  if (timeLeft <= 0) { timeLeft = 0; clearInterval(timerInterval); }
  const mins = Math.floor(timeLeft/60);
  const secs = timeLeft % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2,"0")}`;
  timerDisplay.textContent = timeStr;
  const elapsed = (TOTAL_TIME-timeLeft)/TOTAL_TIME;
}, 1000);

// ─── Canvas side helpers ──────────────────────────────────────────────────────
function clampToSide(point, side) {
  const x = side==="left"
    ? Math.min(point.x, DIVIDER_X-1)
    : Math.max(point.x, DIVIDER_X+1);
  return vec2(x, point.y);
}

// ─── Mouse drawing ────────────────────────────────────────────────────────────
onMousePress(() => {
  const mp   = mousePos();
  const side = mp.x < DIVIDER_X ? "left" : "right";
  const player = side==="left" ? 1 : 2;
  const strokeColor = player===1 ? [231,76,60] : [52,152,219];
  currentStroke = {
    points:[clampToSide(mp,side)],
    color:strokeColor,
    size:playerState[player].brushSize,
    opacity:playerState[player].opacity,
    side, player,
  };
  playerState[player].strokes.push(currentStroke);
});

onMouseMove(() => {
  if (!isMouseDown() || !currentStroke) return;
  const mp = mousePos();
  const onCorrectSide = currentStroke.side==="left" ? mp.x<DIVIDER_X : mp.x>=DIVIDER_X;
  if (onCorrectSide) currentStroke.points.push(mp);
});

onMouseRelease(() => { currentStroke = null; });

// ─── Tracker polling ──────────────────────────────────────────────────────────
//
// The tracker publishes normalised coords (0-1, 0-1) within the warped canvas.
// We map those to game pixels, determine which half the point is on, and
// build strokes exactly as the mouse handler does.
//
// You can enable tracking for player 1, player 2, or both.
// Right now it's wired to track BOTH halves: the left half of the physical
// canvas drives player 1 and the right half drives player 2.
// (This matches the split-canvas design — two separate pencils each stay on
//  their own side, so each will naturally be in the correct normalised half.)

let trackerConnected  = false;
let trackerP1         = { x:0.5, y:0.5, active:false };
let trackerP2         = { x:0.5, y:0.5, active:false };

// Stroke-per-player for the tracker (separate from mouse strokes)
const trackerStroke = { 1: null, 2: null };

function handleTrackerPoint(point, playerOverride) {
  if (!point.active) {
    trackerStroke[playerOverride] = null;
    return;
  }

  const rawGx = point.x * width();
  const gy    = point.y * height();

  // If the point is off-canvas or on the wrong side, end the stroke — no clamping
  const onCorrectSide = playerOverride === 1 ? rawGx < DIVIDER_X : rawGx >= DIVIDER_X;
  if (!onCorrectSide || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    trackerStroke[playerOverride] = null;
    return;
  }

  const gx = rawGx;
  const pt = vec2(gx, gy);

  const player = playerOverride;
  const strokeColor = player === 1 ? [231,76,60] : [52,152,219];

  if (!trackerStroke[player]) {
    trackerStroke[player] = {
      points: [pt],
      color:  strokeColor,
      size:   playerState[player].brushSize,
      opacity: playerState[player].opacity,
      side: player === 1 ? "left" : "right",
      player,
    };
    playerState[player].strokes.push(trackerStroke[player]);
  } else {
    const last = trackerStroke[player].points.at(-1);
    const dx = pt.x - last.x, dy = pt.y - last.y;
    if (dx*dx + dy*dy > 4) {
      trackerStroke[player].points.push(pt);
    }
  }
}

async function pollTracker() {
  try {
    const res = await fetch(TRACKER_URL, { signal: AbortSignal.timeout(200) });
    if (!res.ok) throw new Error("bad status");
    const data = await res.json();
    trackerConnected = true;

    if (data.reset) {
      playerState[1].strokes = [];
      playerState[2].strokes = [];
      trackerStroke[1] = null;
      trackerStroke[2] = null;
    }

    // Fire any button presses triggered by dwell in tracker
    if (data.buttons) {
      const sizeMap = { large: "28", medium: "16", small: "8" };
      for (const btn of data.buttons) {
        const [pStr, action] = btn.split("_");
        const player = pStr === "p1" ? "1" : "2";
        if (action === "undo") {
          document.querySelector(`.undo-btn[data-player="${player}"]`)?.click();
        } else if (sizeMap[action]) {
          document.querySelector(`.brush-btn[data-player="${player}"][data-size="${sizeMap[action]}"]`)?.click();
        }
      }
    }

    trackerP1 = data.p1 ?? { x:0.5, y:0.5, active:false };
    trackerP2 = data.p2 ?? { x:0.5, y:0.5, active:false };

    handleTrackerPoint(trackerP1, 1);
    handleTrackerPoint(trackerP2, 2);

  } catch (_) {
    trackerConnected = false;
    trackerStroke[1] = null;
    trackerStroke[2] = null;
  }
}

setInterval(pollTracker, POLL_INTERVAL);

// ─── Tracker status overlay (small DOM element) ───────────────────────────────
const statusEl = document.createElement("div");
statusEl.style.cssText = `
  position:fixed; bottom:12px; left:50%; transform:translateX(-50%);
  background:rgba(0,0,0,0.55); color:#fff; font:13px/1.4 monospace;
  padding:5px 14px; border-radius:20px; pointer-events:none; z-index:999;
  transition:opacity .3s;
`;
document.body.appendChild(statusEl);

setInterval(() => {
  if (trackerConnected) {
    const p1s = `P1(${trackerP1.x.toFixed(3)},${trackerP1.y.toFixed(3)}) ${trackerP1.active?"●":"○"}`;
    const p2s = `P2(${trackerP2.x.toFixed(3)},${trackerP2.y.toFixed(3)}) ${trackerP2.active?"●":"○"}`;
    statusEl.textContent = `📷 Tracker connected  |  ${p1s}  |  ${p2s}`;
  } else {
    statusEl.textContent = "📷 Tracker offline — drawing with mouse only";
  }
  statusEl.style.opacity = trackerConnected ? "1" : "0.6";
}, 200);

// ─── Render ───────────────────────────────────────────────────────────────────
onDraw(() => {
  drawDivider();

  const allStrokes = [...playerState[1].strokes, ...playerState[2].strokes];
  for (const stroke of allStrokes) {
    const c = rgb(stroke.color[0], stroke.color[1], stroke.color[2]);
    if (stroke.points.length === 1) {
      drawCircle({ pos: stroke.points[0], radius: stroke.size / 2, color: c, opacity: stroke.opacity });
      continue;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      drawLine({ p1: stroke.points[i-1], p2: stroke.points[i], width: stroke.size, color: c, opacity: stroke.opacity, cap: "round" });
    }
  }

  // Tracker cursor crosshairs — P1 (green) and P2 (cyan)
  if (trackerConnected) {
    const cursors = [
      { dot: trackerP1, col: rgb(0, 220, 80) },
      { dot: trackerP2, col: rgb(0, 200, 255) },
    ];
    for (const { dot, col } of cursors) {
      if (!dot.active) continue;
      const gx = dot.x * width();
      const gy = dot.y * height();
      const r  = 12;
      drawLine({ p1:vec2(gx-r,gy), p2:vec2(gx+r,gy), width:2, color:col, opacity:0.7 });
      drawLine({ p1:vec2(gx,gy-r), p2:vec2(gx,gy+r), width:2, color:col, opacity:0.7 });
      drawCircle({ pos:vec2(gx,gy), radius:5, color:col, opacity:0.8 });
    }
  }
});

// ─── Sidebar buttons ──────────────────────────────────────────────────────────
document.querySelectorAll(".brush-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const player=btn.dataset.player, size=Number(btn.dataset.size);
    playerState[player].brushSize=size;
    btn.closest(".brush-size-group").querySelectorAll(".brush-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.querySelectorAll(".undo-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const player=btn.dataset.player;
    playerState[player].strokes.pop();
  });
});
