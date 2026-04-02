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
  letterbox: true,
});

const LINE_SPACING = 32;
const LINE_COLOR   = [173, 216, 250];
const MARGIN_COLOR = [230, 100, 100];
const DIVIDER_X    = width() / 2;

const playerState = {
  1: { brushSize: 8, opacity: 1, halftone: "none", strokes: [] },
  2: { brushSize: 8, opacity: 1, halftone: "none", strokes: [] },
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

// ─── Timer + wave ─────────────────────────────────────────────────────────────
const TOTAL_TIME = 180;
let timeLeft     = TOTAL_TIME;

const wavePath   = document.querySelector(".wave path");
const pathLength = wavePath.getTotalLength();
wavePath.style.strokeDasharray  = pathLength;
wavePath.style.strokeDashoffset = pathLength;

const promptLabel = add([
  text("Draw: A Cat!", { size:28 }),
  pos(width()/2, 30),
  anchor("top"),
  color(233,69,96),
  fixed(), z(10),
]);

const timerLabel = add([
  text("3:00", { size:22 }),
  pos(width()/2, 68),
  anchor("top"),
  color(80,80,80),
  fixed(), z(10),
]);

const timerInterval = setInterval(() => {
  timeLeft--;
  if (timeLeft <= 0) { timeLeft = 0; clearInterval(timerInterval); }
  const mins = Math.floor(timeLeft/60);
  const secs = timeLeft % 60;
  timerLabel.text = `${mins}:${secs.toString().padStart(2,"0")}`;
  const elapsed = (TOTAL_TIME-timeLeft)/TOTAL_TIME;
  wavePath.style.strokeDashoffset = pathLength*(1-elapsed);
}, 1000);

// ─── Canvas side helpers ──────────────────────────────────────────────────────
function clampToSide(point, side) {
  const x = side==="left"
    ? Math.min(point.x, DIVIDER_X-1)
    : Math.max(point.x, DIVIDER_X+1);
  return vec2(x, point.y);
}

// ─── Halftone drawing ─────────────────────────────────────────────────────────
function drawHalftoneSegment(p1,p2,strokeWidth,col,opacity,halftone) {
  const c = rgb(col[0],col[1],col[2]);
  if (halftone==="none") {
    drawLine({p1,p2,width:strokeWidth,color:c,opacity,cap:"round"});
    return;
  }
  const dx=p2.x-p1.x, dy=p2.y-p1.y;
  const dist=Math.sqrt(dx*dx+dy*dy);
  if (dist<0.5) return;
  const spacing=halftone==="dots"?4:3;
  const steps=Math.max(1,Math.floor(dist/spacing));
  for (let s=0;s<=steps;s++) {
    const t=s/steps, cx=p1.x+dx*t, cy=p1.y+dy*t;
    if (halftone==="dots") {
      const gx=Math.round(cx/5)*5, gy=Math.round(cy/5)*5;
      if (Math.abs(cx-gx)+Math.abs(cy-gy)<3)
        drawCircle({pos:vec2(gx,gy),radius:Math.min(strokeWidth/3,3),color:c,opacity});
    } else if (halftone==="lines") {
      const lineY=Math.round(cy/4)*4;
      if (Math.abs(cy-lineY)<1.5)
        drawLine({p1:vec2(cx-strokeWidth/2,lineY),p2:vec2(cx+strokeWidth/2,lineY),width:1.5,color:c,opacity});
    } else if (halftone==="cross") {
      const lineY=Math.round(cy/5)*5, lineX=Math.round(cx/5)*5;
      if (Math.abs(cy-lineY)<1.5)
        drawLine({p1:vec2(cx-strokeWidth/2,lineY),p2:vec2(cx+strokeWidth/2,lineY),width:1,color:c,opacity});
      if (Math.abs(cx-lineX)<1.5)
        drawLine({p1:vec2(lineX,cy-strokeWidth/2),p2:vec2(lineX,cy+strokeWidth/2),width:1,color:c,opacity});
    }
  }
}

function drawHalftoneCircle(center,radius,col,opacity,halftone) {
  const c=rgb(col[0],col[1],col[2]);
  if (halftone==="none") { drawCircle({pos:center,radius,color:c,opacity}); return; }
  drawCircle({pos:center,radius,color:c,opacity:opacity*0.5});
}

// ─── Mouse drawing (unchanged) ────────────────────────────────────────────────
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
    halftone:playerState[player].halftone,
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

  const gx = point.x * width();
  const gy = point.y * height();
  const pt = vec2(gx, gy);

  const player = playerOverride;
  const strokeColor = player === 1 ? [231,76,60] : [52,152,219];

  if (!trackerStroke[player]) {
    trackerStroke[player] = {
      points: [pt],
      color:  strokeColor,
      size:   playerState[player].brushSize,
      opacity: playerState[player].opacity,
      halftone: playerState[player].halftone,
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
  drawRuledLines();
  drawDivider();

  const allStrokes = [...playerState[1].strokes, ...playerState[2].strokes];
  for (const stroke of allStrokes) {
    if (stroke.points.length===1) {
      drawHalftoneCircle(stroke.points[0],stroke.size/2,stroke.color,stroke.opacity,stroke.halftone);
      continue;
    }
    for (let i=1;i<stroke.points.length;i++) {
      drawHalftoneSegment(stroke.points[i-1],stroke.points[i],stroke.size,stroke.color,stroke.opacity,stroke.halftone);
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

// ─── Sidebar buttons (unchanged) ──────────────────────────────────────────────
document.querySelectorAll(".size-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const player=btn.dataset.player, size=Number(btn.dataset.size);
    playerState[player].brushSize=size;
    btn.closest(".size-buttons").querySelectorAll(".size-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
  });
});


document.querySelectorAll(".halftone-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const player=btn.dataset.player;
    playerState[player].halftone=btn.dataset.halftone;
    btn.closest(".halftone-buttons").querySelectorAll(".halftone-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.querySelectorAll(".undo-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const player=btn.dataset.player;
    playerState[player].strokes.pop();
  });
});
