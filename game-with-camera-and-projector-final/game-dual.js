// ─── Prompt & Caption data ───────────────────────────────────────────────────
// Prompts are loaded from ../prompts.json so both games share a single
// editable source. Populated before runPromptSelect() runs for the first time.
let PROMPTS = [];

const FRAME_IMAGES = [
  "../assets/pictureframesAsset 1 1.png",
  "../assets/pictureframesAsset 3 1.png",
  "../assets/pictureframesAsset 4 1.png",
];

let chosenPrompt = null;
let gameStarted  = false;
let gameEnded    = false;
// Incremented on every new round. Stale callbacks from earlier rounds compare
// against this to bail out, preventing timers/state from stacking on restart.
let roundId      = 0;

// Follower mode flag — see game-solo.js for the rationale.
let isFollower = false;

// ─── Prompt select animation (scrolling list) ────────────────────────────────
const OPTION_HEIGHT = 96; // must match .prompt-option height in CSS (px)

function runPromptSelect() {
  const myRound = ++roundId;
  chosenPrompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

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
          if (myRound !== roundId) return; // a newer round has started; bail
          startCountdownAfterPrompt(myRound);
        }, 5000);
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
function startCountdownAfterPrompt(myRound) {
  const promptOverlay    = document.getElementById("promptOverlay");
  const countdownOverlay = document.getElementById("countdownOverlay");
  const readyOverlay     = document.getElementById("readyOverlay");
  const video            = document.getElementById("countdownVideo");

  // Show "Players, get your pencils ready!" for 2.5s before the countdown.
  if (readyOverlay) {
    promptOverlay.style.display = "none";
    readyOverlay.classList.remove("hidden");
    setTimeout(() => {
      if (myRound !== roundId) return;
      readyOverlay.classList.add("hidden");
      beginCountdown();
    }, 2500);
  } else {
    beginCountdown();
  }

  function beginCountdown() {

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (myRound !== roundId) return; // stale round, do not start the game
    countdownOverlay.classList.add("hidden");
    startGame();
  };
  video.addEventListener("ended", finish, { once: true });
  video.addEventListener("error", finish, { once: true });
  setTimeout(finish, 30000); // hard fallback

  const beginPlayback = () => {
    countdownOverlay.classList.remove("hidden");
    try { video.currentTime = 0; } catch (_) {}
    try { video.playbackRate = 1.3; } catch (_) {}
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
}

// ─── Tracker config ──────────────────────────────────────────────────────────
const TRACKER_EVENTS_URL = "http://localhost:5050/events";
const ACTIVE_RADIUS  = 20;   // px — minimum movement to consider a stroke point new
const DROPOUT_MS     = 500; // close a tracker stroke after this long with no active point
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
const TOTAL_TIME = 60;
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
  clearInterval(timerInterval); // defensive: never stack intervals
  timeLeft = TOTAL_TIME;
  renderTimer();
  Sync.send("tick", { timeLeft });
  timerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      timeLeft = 0;
      clearInterval(timerInterval);
      endGame();
    }
    renderTimer();
    Sync.send("tick", { timeLeft });
  }, 1000);
}

function startGame() {
  gameStarted = true;
  startTimer();
}

function endGame() {
  if (gameEnded) return;
  gameEnded = true;
  setTimeout(() => {
    if (isFollower) {
      sendFinalSnapshot();
      enterIdle();
    } else {
      showFramedResult();
    }
  }, 400);
}

function sendFinalSnapshot() {
  // Recolor strokes to black for the framed result, same as showFramedResult().
  for (const p of [1, 2]) {
    for (const stroke of playerState[p].strokes) stroke.color = [0, 0, 0];
  }
  // Give the renderer one frame to redraw with the new colors before snapshotting.
  requestAnimationFrame(() => {
    const srcCanvas = document.getElementById("gameCanvas");
    const tmp = document.createElement("canvas");
    tmp.width  = srcCanvas.width;
    tmp.height = srcCanvas.height;
    const ctx = tmp.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    try { ctx.drawImage(srcCanvas, 0, 0, tmp.width, tmp.height); } catch (_) {}
    let dataUrl = "";
    try { dataUrl = tmp.toDataURL("image/png"); } catch (_) {}
    Sync.send("final", { dataUrl, prompt: chosenPrompt });
    uploadFinalDrawing(tmp, chosenPrompt);
  });
}

function enterIdle() {
  document.body.classList.add("idle");
}
function enterPlayFromMessage(prompt) {
  chosenPrompt = prompt;
  document.body.classList.remove("idle");
  // Reset stroke state for the new round.
  playerState[1].strokes = [];
  playerState[2].strokes = [];
  trackerStroke[1] = null;
  trackerStroke[2] = null;
  currentStroke = null;
  trackerCurrentStroke = null;
  gameEnded = false;
  startGame();
}

function showFramedResult() {
  const captionOverlay = document.getElementById("captionOverlay");
  const captionText    = document.getElementById("captionText");
  const frameImg       = document.getElementById("frameImg");
  const finalCanvas    = document.getElementById("finalDrawingCanvas");

  frameImg.src = FRAME_IMAGES[Math.floor(Math.random() * FRAME_IMAGES.length)];

  // Recolor every existing stroke to black; the render loop will redraw them.
  for (const p of [1, 2]) {
    for (const stroke of playerState[p].strokes) stroke.color = [0, 0, 0];
  }

  captionText.textContent = chosenPrompt?.caption || "";

  // Wait one frame so kaplay re-renders the strokes in black before we
  // snapshot the canvas into the framed result.
  requestAnimationFrame(() => {
    const srcCanvas = document.getElementById("gameCanvas");
    finalCanvas.width  = srcCanvas.width;
    finalCanvas.height = srcCanvas.height;
    const ctx = finalCanvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    try {
      ctx.drawImage(srcCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
    } catch (_) {}

    captionOverlay.classList.remove("hidden");

    // Push the final drawing to the gallery. Non-blocking; failures are logged.
    uploadFinalDrawing(finalCanvas, chosenPrompt);
  });
}

function uploadFinalDrawing(canvas, prompt) {
  const api = window.ComicallyLargeDrawings;
  if (!api || typeof api.uploadDrawing !== "function") return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    api.uploadDrawing(blob, {
      caption: prompt?.caption || "",
      prompt:  prompt?.text    || "",
    }).catch(err => console.warn("[gallery upload] failed:", err));
  }, "image/png");
}

// ─── Canvas side helpers ──────────────────────────────────────────────────────
function clampToSide(point, side) {
  const x = side==="left"
    ? Math.min(point.x, DIVIDER_X-1)
    : Math.max(point.x, DIVIDER_X+1);
  return vec2(x, point.y);
}

// ─── Mouse drawing ────────────────────────────────────────────────────────────
onMousePress(() => {
  if (!gameStarted || gameEnded) return;
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
  if (!isMouseDown() || !currentStroke || !gameStarted || gameEnded) return;
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

let trackerP1         = { x:0.5, y:0.5, active:false };
let trackerP2         = { x:0.5, y:0.5, active:false };

// Stroke-per-player for the tracker (separate from mouse strokes)
const trackerStroke       = { 1: null, 2: null };
const trackerLastActiveAt = { 1: 0,    2: 0    }; // performance.now() of last drawable frame

function handleTrackerPoint(point, playerOverride) {
  const player = playerOverride;

  // Phase gating: outside of active play, always close immediately.
  if (!gameStarted || gameEnded) {
    trackerStroke[player] = null;
    return;
  }

  const rawGx = point.x * width();
  const gy    = point.y * height();
  const onCorrectSide = player === 1 ? rawGx < DIVIDER_X : rawGx >= DIVIDER_X;
  const inBounds      = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  const drawable      = point.active && inBounds && onCorrectSide;

  if (!drawable) {
    // Dropout tolerance: keep the stroke open until we've been untracked
    // for DROPOUT_MS. Then close it so the next sighting starts a new line.
    if (trackerStroke[player] &&
        performance.now() - trackerLastActiveAt[player] > DROPOUT_MS) {
      trackerStroke[player] = null;
    }
    return;
  }

  // If this player was untracked longer than DROPOUT_MS, break the stroke so
  // the next sighting starts a new line instead of connecting across the gap.
  const now = performance.now();
  if (trackerStroke[player] && now - trackerLastActiveAt[player] > DROPOUT_MS) {
    trackerStroke[player] = null;
  }
  trackerLastActiveAt[player] = now;

  const pt          = vec2(rawGx, gy);
  const strokeColor = player === 1 ? [231,76,60] : [52,152,219];

  if (!trackerStroke[player]) {
    trackerStroke[player] = {
      points: [pt],
      color:  strokeColor,
      size:   playerState[player].brushSize,
      opacity: playerState[player].opacity,
      side: player === 1 ? "left" : "right",
      player,
      smooth: true,      // tracker strokes render with Chaikin smoothing
      _smoothed: null,   // cached smoothed points
      _smoothedLen: 0,   // raw-points length the cache was built for
    };
    playerState[player].strokes.push(trackerStroke[player]);
  } else {
    const last = trackerStroke[player].points.at(-1);
    const dx = pt.x - last.x, dy = pt.y - last.y;
    if (dx*dx + dy*dy > 4) {
      trackerStroke[player].points.push(pt);
      trackerStroke[player]._smoothed = null; // invalidate cache
    }
  }
}

function applyTrackerFrame(data) {
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
}

// Subscribe to the tracker's SSE stream. EventSource auto-reconnects on
// drop, so if the Python script isn't running (or restarts), the browser
// will keep trying silently in the background.
function connectTracker() {
  const es = new EventSource(TRACKER_EVENTS_URL);
  es.onmessage = (ev) => {
    try {
      applyTrackerFrame(JSON.parse(ev.data));
    } catch (_) { /* malformed frame — skip */ }
  };
  // onerror fires on disconnect; EventSource handles reconnection itself
  // so we don't need to do anything here.
}
connectTracker();

// ─── Mode signalling ─────────────────────────────────────────────────────────
// Tell the tracker how many pencils to look for. Fire-and-forget: if the
// tracker isn't up yet, the browser just ignores the failure.
const NUM_PLAYERS = 2;
const TRACKER_MODE_URL = "http://localhost:5050/mode";
function setTrackerMode(players) {
  return fetch(TRACKER_MODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ players }),
  }).catch(() => {});
}
setTrackerMode(NUM_PLAYERS);

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
  if (!gameEnded) drawDivider();

  const allStrokes = [...playerState[1].strokes, ...playerState[2].strokes];
  for (const stroke of allStrokes) {
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

    drawLines({
      pts: renderPoints,
      width: stroke.size,
      color: c,
      opacity: stroke.opacity,
      cap: "round",
      join: "round",
    });
  }

  // Tracker cursor crosshairs — P1 (green) and P2 (cyan)
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

// ─── Restart on spacebar from end screen ─────────────────────────────────────
function restartGame() {
  // Reset state flags
  gameStarted = false;
  gameEnded   = false;

  // Clear strokes
  playerState[1].strokes = [];
  playerState[2].strokes = [];
  playerState[1].brushSize = 16;
  playerState[2].brushSize = 16;
  currentStroke        = null;
  trackerCurrentStroke = null;
  trackerStroke[1]     = null;
  trackerStroke[2]     = null;

  // Reset timer
  clearInterval(timerInterval);
  timeLeft = TOTAL_TIME;
  renderTimer();

  // Hide end-screen overlay
  document.getElementById("captionOverlay").classList.add("hidden");

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

// ─── Mode-switch keys ────────────────────────────────────────────────────────
// 1 = solo, 2 = dual (this page). Either key always produces a fresh game in
// the chosen mode — restart in place when we're already on the target page,
// navigate otherwise.
function switchMode(targetPlayers, targetPage) {
  setTrackerMode(targetPlayers);
  const path = window.location.pathname;
  const here =
    path.endsWith(targetPage) ||
    (targetPage === "index.html" && path.endsWith("/"));
  if (here) {
    restartGame();
  } else {
    window.location.href = targetPage;
  }
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Digit1") {
    e.preventDefault();
    switchMode(1, "index.html");
  } else if (e.code === "Digit2") {
    e.preventDefault();
    switchMode(2, "dual.html");
  } else if (e.code === "Space") {
    e.preventDefault();
    if (isFollower) {
      Sync.send("restart");
      gameStarted = false;
      gameEnded   = false;
      playerState[1].strokes = [];
      playerState[2].strokes = [];
      currentStroke = null;
      trackerCurrentStroke = null;
      trackerStroke[1] = null;
      trackerStroke[2] = null;
      clearInterval(timerInterval);
      timeLeft = TOTAL_TIME;
      renderTimer();
      enterIdle();
    } else {
      restartGame();
    }
  }
});

// ─── Follower-mode message wiring ────────────────────────────────────────────
Sync.on("phase", (msg) => {
  if (!isFollower) return;
  if (msg.phase === "play" && msg.prompt) {
    enterPlayFromMessage(msg.prompt);
  } else if (msg.phase === "prompt" || msg.phase === "countdown") {
    enterIdle();
  }
});

Sync.on("restart", () => {
  if (!isFollower) return;
  gameStarted = false;
  gameEnded   = false;
  playerState[1].strokes = [];
  playerState[2].strokes = [];
  currentStroke = null;
  trackerCurrentStroke = null;
  trackerStroke[1] = null;
  trackerStroke[2] = null;
  clearInterval(timerInterval);
  timeLeft = TOTAL_TIME;
  renderTimer();
  enterIdle();
});

// ─── Kick off ────────────────────────────────────────────────────────────────
// See game-solo.js for the rationale on the boot race.
document.body.classList.add("idle");
document.getElementById("promptOverlay")?.classList.add("hidden");

function startStandalone() {
  document.body.classList.remove("idle");
  document.getElementById("promptOverlay")?.classList.remove("hidden");
  fetch("../prompts.json")
    .then((r) => r.json())
    .then((data) => { PROMPTS = data; })
    .catch((err) => { console.error("Failed to load prompts.json:", err); })
    .finally(() => { runPromptSelect(); });
}

let kickedOff = false;
const offDisplayReady = Sync.on("display-ready", () => {
  if (kickedOff) return;
  kickedOff = true;
  isFollower = true;
  Sync.send("game-ready", { mode: "dual" });
  enterIdle();
});
Sync.send("game-loading", { mode: "dual" });
setTimeout(() => {
  if (kickedOff) return;
  kickedOff = true;
  offDisplayReady();
  startStandalone();
}, 2000);
