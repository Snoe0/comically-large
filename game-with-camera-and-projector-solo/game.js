// ─── Prompt & Caption data ───────────────────────────────────────────────────
const PROMPTS = [
  { text: "A pig on the moon",                 caption: "1936: Pigs did it first." },
  { text: "Wizards ordering coffee",           caption: "Double-shot, extra enchantment." },
  { text: "Fish out of water",                 caption: "Gills optional, panic mandatory." },
  { text: "The biggest fish to fry",           caption: "Bigger boat. Bigger pan." },
  { text: "A bug in a rug",                    caption: "Cozy. Suspiciously cozy." },
  { text: "Hit the nail on the head",          caption: "Ouch. But accurate." },
  { text: "Salt and pepper dancing together",  caption: "A seasoned romance." },
  { text: "Dog Fight",                         caption: "Winner takes the bone." },
  { text: "Walter gets ice cream",             caption: "Walter earned this." },
  { text: "Under the weather",                 caption: "Forecast: 100% blanket." },
  { text: "As easy as big juicy pie",          caption: "A slice above the rest." },
  { text: "Spilt milk",                        caption: "No crying. House rules." },
  { text: "Wild goose on the loose",           caption: "Honk if you've seen him." },
  { text: "The elephant in the room",          caption: "We are NOT going to talk about it." },
  { text: "A giant destroying a village",      caption: "Rent was too high anyway." },
];

const FRAME_IMAGES = [
  "../assets/pictureframesAsset 1 1.png",
  "../assets/pictureframesAsset 3 1.png",
  "../assets/pictureframesAsset 4 1.png",
];

let chosenPrompt = null;
let gameStarted  = false;
let gameEnded    = false;

// ─── Prompt select animation (scrolling list) ────────────────────────────────
const OPTION_HEIGHT = 96; // must match .prompt-option height in CSS (px)

function runPromptSelect() {
  chosenPrompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  // Pre-populate the top-left prompt label (stays hidden until startGame()).
  const promptLabel = document.getElementById("promptLabel");
  if (promptLabel) {
    promptLabel.textContent = chosenPrompt.text;
    promptLabel.classList.remove("visible");
  }

  const scroller = document.getElementById("promptScroller");
  const track    = document.getElementById("promptScrollerTrack");
  track.innerHTML = "";
  track.style.transform = "translateY(0px)";

  const LOOPS = 3;
  const items = [];
  for (let i = 0; i < LOOPS; i++) {
    const shuffled = PROMPTS.slice().sort(() => Math.random() - 0.5);
    for (const p of shuffled) items.push(p.text);
  }
  items.push(chosenPrompt.text);

  for (const t of items) {
    const div = document.createElement("div");
    div.className = "prompt-option";
    div.style.height = OPTION_HEIGHT + "px";
    div.style.lineHeight = OPTION_HEIGHT + "px";
    div.textContent = t;
    track.appendChild(div);
  }

  const go = () => {
    const scrollerHeight = scroller.clientHeight;
    const centerOffset = (scrollerHeight - OPTION_HEIGHT) / 2;

    const finalIndex = items.length - 1;
    const finalY = -(finalIndex * OPTION_HEIGHT) + centerOffset;
    const startY = centerOffset;

    const duration = 3200;
    const startTime = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);

    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const y = startY + (finalY - startY) * ease(t);
      track.style.transform = `translateY(${y}px)`;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        track.style.transform = `translateY(${finalY}px)`;
        const landed = track.children[finalIndex];
        if (landed) landed.classList.add("landed");

        setTimeout(() => {
          startCountdownAfterPrompt();
        }, 900);
      }
    }
    requestAnimationFrame(step);
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(go);
  } else {
    go();
  }
}

// ─── Countdown video ─────────────────────────────────────────────────────────
function startCountdownAfterPrompt() {
  const promptOverlay    = document.getElementById("promptOverlay");
  const countdownOverlay = document.getElementById("countdownOverlay");
  const video            = document.getElementById("countdownVideo");

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    countdownOverlay.classList.add("hidden");
    startGame();
  };
  video.addEventListener("ended", finish, { once: true });
  video.addEventListener("error", finish, { once: true });
  setTimeout(finish, 30000); // hard fallback

  const beginPlayback = () => {
    countdownOverlay.classList.remove("hidden");
    try { video.currentTime = 0; } catch (_) {}
    const p = video.play();
    const afterStart = () => {
      promptOverlay.classList.add("fade-out");
      setTimeout(() => { promptOverlay.style.display = "none"; }, 600);
    };
    if (p && typeof p.then === "function") {
      p.then(afterStart).catch(() => { afterStart(); finish(); });
    } else {
      afterStart();
    }
  };

  if (video.readyState >= 3) {
    beginPlayback();
  } else {
    let readyFired = false;
    const onReady = () => {
      if (readyFired) return;
      readyFired = true;
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("canplay", onReady);
      beginPlayback();
    };
    video.addEventListener("canplaythrough", onReady);
    video.addEventListener("canplay", onReady);
    setTimeout(onReady, 5000);
    try { video.load(); } catch (_) {}
  }
}

// ─── Tracker config ──────────────────────────────────────────────────────────
const TRACKER_URL    = "http://localhost:5050/state";
const POLL_INTERVAL  = 16;   // ms (~60 fps)
const ACTIVE_RADIUS  = 20;   // px — minimum movement to consider a stroke point new
const DROPOUT_MS     = 2000; // close a tracker stroke after this long with no active point
const CHAIKIN_ITERS  = 2;    // smoothing passes (2 ≈ visibly smooth, cheap)

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
const STROKE_COLOR = [0, 0, 0];

const playerState = { brushSize: 16, opacity: 1, strokes: [] };

let currentStroke = null;

// ─── Ruled paper ─────────────────────────────────────────────────────────────
function drawRuledLines() {
  for (let y = LINE_SPACING; y < height(); y += LINE_SPACING) {
    drawLine({ p1: vec2(0,y), p2: vec2(width(),y), width:1, color:rgb(...LINE_COLOR) });
  }
  drawLine({ p1:vec2(60,0),        p2:vec2(60,height()),        width:2, color:rgb(...MARGIN_COLOR) });
  drawLine({ p1:vec2(width()-60,0),p2:vec2(width()-60,height()),width:2, color:rgb(...MARGIN_COLOR) });
}

// ─── Timer ─────────────────────────────────────────────────────────────
const TOTAL_TIME = 90;
let timeLeft     = TOTAL_TIME;

const timerDisplay = document.querySelector(".timer-display");
let timerInterval = null;

function renderTimer() {
  const mins = Math.floor(timeLeft/60);
  const secs = timeLeft % 60;
  timerDisplay.textContent = `${mins}:${secs.toString().padStart(2,"0")}`;
}
renderTimer();

function startTimer() {
  timerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      timeLeft = 0;
      clearInterval(timerInterval);
      endGame();
    }
    renderTimer();
  }, 1000);
}

function startGame() {
  gameStarted = true;
  document.getElementById("promptLabel")?.classList.add("visible");
  startTimer();
}

function endGame() {
  if (gameEnded) return;
  gameEnded = true;
  document.getElementById("promptLabel")?.classList.remove("visible");
  setTimeout(showFramedResult, 400);
}

function showFramedResult() {
  const captionOverlay = document.getElementById("captionOverlay");
  const captionText    = document.getElementById("captionText");
  const frameImg       = document.getElementById("frameImg");
  const finalCanvas    = document.getElementById("finalDrawingCanvas");

  frameImg.src = FRAME_IMAGES[Math.floor(Math.random() * FRAME_IMAGES.length)];

  const srcCanvas = document.getElementById("gameCanvas");
  finalCanvas.width  = srcCanvas.width;
  finalCanvas.height = srcCanvas.height;
  const ctx = finalCanvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  try {
    ctx.drawImage(srcCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
  } catch (_) {}

  captionText.textContent = chosenPrompt?.caption || "";
  captionOverlay.classList.remove("hidden");
}

// ─── Mouse drawing ────────────────────────────────────────────────────────────
onMousePress(() => {
  if (!gameStarted || gameEnded) return;
  currentStroke = {
    points:  [mousePos()],
    color:   STROKE_COLOR,
    size:    playerState.brushSize,
    opacity: playerState.opacity,
  };
  playerState.strokes.push(currentStroke);
});

onMouseMove(() => {
  if (!isMouseDown() || !currentStroke || !gameStarted || gameEnded) return;
  currentStroke.points.push(mousePos());
});

onMouseRelease(() => { currentStroke = null; });

// ─── Tracker polling ──────────────────────────────────────────────────────────
//
// The tracker publishes normalised coords (0-1, 0-1) within the warped canvas.
// We map those to game pixels and build strokes exactly as the mouse
// handler does.

let trackerConnected  = false;
let trackerPointer    = { x:0.5, y:0.5, active:false };

let trackerStroke       = null;
let trackerLastActiveAt = 0;

function handleTrackerPoint(point) {
  // Phase gating: outside of active play, always close immediately.
  if (!gameStarted || gameEnded) {
    trackerStroke = null;
    return;
  }

  const gx = point.x * width();
  const gy = point.y * height();
  const inBounds = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  const drawable = point.active && inBounds;

  if (!drawable) {
    // Dropout tolerance: keep the stroke open until we've been untracked
    // for DROPOUT_MS. Then close it so the next sighting starts a new line.
    if (trackerStroke && performance.now() - trackerLastActiveAt > DROPOUT_MS) {
      trackerStroke = null;
    }
    return;
  }

  // Drawable: refresh the dropout timer and extend (or start) the stroke.
  trackerLastActiveAt = performance.now();

  const pt = vec2(gx, gy);

  if (!trackerStroke) {
    trackerStroke = {
      points: [pt],
      color:  STROKE_COLOR,
      size:   playerState.brushSize,
      opacity: playerState.opacity,
      smooth: true,      // tracker strokes render with Chaikin smoothing
      _smoothed: null,   // cached smoothed points
      _smoothedLen: 0,   // raw-points length the cache was built for
    };
    playerState.strokes.push(trackerStroke);
  } else {
    const last = trackerStroke.points.at(-1);
    const dx = pt.x - last.x, dy = pt.y - last.y;
    if (dx*dx + dy*dy > 4) {
      trackerStroke.points.push(pt);
      trackerStroke._smoothed = null; // invalidate cache
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
      playerState.strokes = [];
      trackerStroke = null;
    }

    // Fire any button presses triggered by dwell in tracker
    if (data.buttons) {
      const sizeMap = { large: "28", medium: "16", small: "8" };
      for (const name of data.buttons) {
        if (name === "undo") {
          document.querySelector(`.undo-btn`)?.click();
        } else if (sizeMap[name]) {
          document.querySelector(`.brush-btn[data-size="${sizeMap[name]}"]`)?.click();
        }
      }
    }

    trackerPointer = data.p1 ?? { x:0.5, y:0.5, active:false };

    handleTrackerPoint(trackerPointer);

  } catch (_) {
    trackerConnected = false;
    trackerStroke = null;
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
    statusEl.textContent = `📷 Tracker connected  |  P(${trackerPointer.x.toFixed(3)},${trackerPointer.y.toFixed(3)}) ${trackerPointer.active?"●":"○"}`;
  } else {
    statusEl.textContent = "📷 Tracker offline — drawing with mouse only";
  }
  statusEl.style.opacity = trackerConnected ? "1" : "0.6";
}, 200);

// ─── Chaikin corner-cutting (polyline smoothing) ─────────────────────────────
function chaikinSmooth(points, iters) {
  if (points.length < 3) return points;
  let pts = points;
  for (let k = 0; k < iters; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push(vec2(0.75*a.x + 0.25*b.x, 0.75*a.y + 0.25*b.y));
      out.push(vec2(0.25*a.x + 0.75*b.x, 0.25*a.y + 0.75*b.y));
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// ─── Render ───────────────────────────────────────────────────────────────────
onDraw(() => {
  for (const stroke of playerState.strokes) {
    const c = rgb(stroke.color[0], stroke.color[1], stroke.color[2]);
    if (stroke.points.length === 1) {
      drawCircle({ pos: stroke.points[0], radius: stroke.size / 2, color: c, opacity: stroke.opacity });
      continue;
    }

    let renderPoints = stroke.points;
    if (stroke.smooth && stroke.points.length >= 3) {
      if (!stroke._smoothed || stroke._smoothedLen !== stroke.points.length) {
        stroke._smoothed    = chaikinSmooth(stroke.points, CHAIKIN_ITERS);
        stroke._smoothedLen = stroke.points.length;
      }
      renderPoints = stroke._smoothed;
    }

    for (let i = 1; i < renderPoints.length; i++) {
      drawLine({ p1: renderPoints[i-1], p2: renderPoints[i], width: stroke.size, color: c, opacity: stroke.opacity, cap: "round" });
    }
  }

  // Tracker cursor crosshair
  if (trackerConnected && trackerPointer.active) {
    const col = rgb(0, 220, 80);
    const gx  = trackerPointer.x * width();
    const gy  = trackerPointer.y * height();
    const r   = 12;
    drawLine({ p1:vec2(gx-r,gy), p2:vec2(gx+r,gy), width:2, color:col, opacity:0.7 });
    drawLine({ p1:vec2(gx,gy-r), p2:vec2(gx,gy+r), width:2, color:col, opacity:0.7 });
    drawCircle({ pos:vec2(gx,gy), radius:5, color:col, opacity:0.8 });
  }
});

// ─── Sidebar buttons ──────────────────────────────────────────────────────────
document.querySelectorAll(".brush-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const size=Number(btn.dataset.size);
    playerState.brushSize=size;
    btn.closest(".brush-size-group").querySelectorAll(".brush-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.querySelectorAll(".undo-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    playerState.strokes.pop();
  });
});

// ─── Restart on spacebar from end screen ─────────────────────────────────────
function restartGame() {
  // Reset state flags
  gameStarted = false;
  gameEnded   = false;

  // Clear strokes
  playerState.strokes = [];
  playerState.brushSize = 16;
  currentStroke  = null;
  trackerStroke  = null;

  // Reset timer
  clearInterval(timerInterval);
  timeLeft = TOTAL_TIME;
  renderTimer();

  // Hide end-screen overlay
  document.getElementById("captionOverlay").classList.add("hidden");

  // Hide the top-left prompt label until the next round starts drawing
  document.getElementById("promptLabel")?.classList.remove("visible");

  // Re-show prompt overlay for the next round
  const promptOverlay = document.getElementById("promptOverlay");
  promptOverlay.classList.remove("fade-out");
  promptOverlay.style.display = "";

  // Reset brush-size button highlights
  document.querySelectorAll(".brush-size-group").forEach(group => {
    group.querySelectorAll(".brush-btn").forEach(b => b.classList.remove("active"));
    const def = group.querySelector('.brush-btn[data-size="16"]');
    if (def) def.classList.add("active");
  });

  // Restart the game sequence
  runPromptSelect();
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && gameEnded) {
    e.preventDefault();
    restartGame();
  }
});

// ─── Kick off ────────────────────────────────────────────────────────────────
runPromptSelect();
