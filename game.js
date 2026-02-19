kaplay({
  canvas: document.getElementById("gameCanvas"),
  width: 800,
  height: 600,
  background: [255, 255, 255],
  stretch: true,
  letterbox: true,
});

const LINE_SPACING = 32;
const LINE_COLOR = [173, 216, 250];
const MARGIN_COLOR = [230, 100, 100];
const DIVIDER_X = width() / 2;

// Per-player state
const playerState = {
  1: { brushSize: 8, opacity: 1, halftone: "none", strokes: [] },
  2: { brushSize: 8, opacity: 1, halftone: "none", strokes: [] },
};

let currentStroke = null;

// --- Draw ruled paper lines ---
function drawRuledLines() {
  for (let y = LINE_SPACING; y < height(); y += LINE_SPACING) {
    drawLine({
      p1: vec2(0, y),
      p2: vec2(width(), y),
      width: 1,
      color: rgb(...LINE_COLOR),
    });
  }
  drawLine({
    p1: vec2(60, 0),
    p2: vec2(60, height()),
    width: 2,
    color: rgb(...MARGIN_COLOR),
  });
  drawLine({
    p1: vec2(width() - 60, 0),
    p2: vec2(width() - 60, height()),
    width: 2,
    color: rgb(...MARGIN_COLOR),
  });
}

// --- Split canvas divider ---
function drawDivider() {
  drawLine({
    p1: vec2(DIVIDER_X, 0),
    p2: vec2(DIVIDER_X, height()),
    width: 2,
    color: rgb(120, 120, 140),
  });
}

// --- Timer + squiggly line animation ---
const TOTAL_TIME = 180; // 3 minutes in seconds
let timeLeft = TOTAL_TIME;

// Set up the SVG wave path to animate with the timer
const wavePath = document.querySelector(".wave path");
const pathLength = wavePath.getTotalLength();
wavePath.style.strokeDasharray = pathLength;
wavePath.style.strokeDashoffset = pathLength; // fully hidden at start

// Prompt text
const promptLabel = add([
  text("Draw: A Cat!", { size: 28 }),
  pos(width() / 2, 30),
  anchor("top"),
  color(233, 69, 96),
  fixed(),
  z(10),
]);

// Timer text
const timerLabel = add([
  text("3:00", { size: 22 }),
  pos(width() / 2, 68),
  anchor("top"),
  color(80, 80, 80),
  fixed(),
  z(10),
]);

// Countdown timer — also drives the wave draw-in
const timerInterval = setInterval(() => {
  timeLeft--;
  if (timeLeft <= 0) {
    timeLeft = 0;
    clearInterval(timerInterval);
  }
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  timerLabel.text = `${mins}:${secs.toString().padStart(2, "0")}`;

  // Update wave: elapsed fraction reveals that much of the path
  const elapsed = (TOTAL_TIME - timeLeft) / TOTAL_TIME;
  wavePath.style.strokeDashoffset = pathLength * (1 - elapsed);
}, 1000);

// --- Clamp a point to a side of the canvas ---
function clampToSide(point, side) {
  const x = side === "left"
    ? Math.min(point.x, DIVIDER_X - 1)
    : Math.max(point.x, DIVIDER_X + 1);
  return vec2(x, point.y);
}

// --- Halftone drawing helpers ---
function drawHalftoneSegment(p1, p2, strokeWidth, col, opacity, halftone) {
  const a = opacity * 255;
  const c = rgb(col[0], col[1], col[2]);

  if (halftone === "none") {
    drawLine({ p1, p2, width: strokeWidth, color: c, opacity, cap: "round" });
    return;
  }

  // For halftone modes, draw dots/lines along the stroke segment
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.5) return;

  const spacing = halftone === "dots" ? 4 : 3;
  const steps = Math.max(1, Math.floor(dist / spacing));

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = p1.x + dx * t;
    const cy = p1.y + dy * t;

    if (halftone === "dots") {
      // Draw a dot pattern: only draw if position falls on grid
      const gx = Math.round(cx / 5) * 5;
      const gy = Math.round(cy / 5) * 5;
      const gridDist = Math.abs(cx - gx) + Math.abs(cy - gy);
      if (gridDist < 3) {
        drawCircle({
          pos: vec2(gx, gy),
          radius: Math.min(strokeWidth / 3, 3),
          color: c,
          opacity,
        });
      }
    } else if (halftone === "lines") {
      // Horizontal hatching — only draw on certain Y lines
      const lineY = Math.round(cy / 4) * 4;
      if (Math.abs(cy - lineY) < 1.5) {
        drawLine({
          p1: vec2(cx - strokeWidth / 2, lineY),
          p2: vec2(cx + strokeWidth / 2, lineY),
          width: 1.5,
          color: c,
          opacity,
        });
      }
    } else if (halftone === "cross") {
      // Crosshatch — horizontal + vertical lines
      const lineY = Math.round(cy / 5) * 5;
      const lineX = Math.round(cx / 5) * 5;
      if (Math.abs(cy - lineY) < 1.5) {
        drawLine({
          p1: vec2(cx - strokeWidth / 2, lineY),
          p2: vec2(cx + strokeWidth / 2, lineY),
          width: 1,
          color: c,
          opacity,
        });
      }
      if (Math.abs(cx - lineX) < 1.5) {
        drawLine({
          p1: vec2(lineX, cy - strokeWidth / 2),
          p2: vec2(lineX, cy + strokeWidth / 2),
          width: 1,
          color: c,
          opacity,
        });
      }
    }
  }
}

function drawHalftoneCircle(center, radius, col, opacity, halftone) {
  const c = rgb(col[0], col[1], col[2]);
  if (halftone === "none") {
    drawCircle({ pos: center, radius, color: c, opacity });
    return;
  }
  // For single-point strokes with halftone, just draw a small filled circle
  drawCircle({ pos: center, radius, color: c, opacity: opacity * 0.5 });
}

// --- Mouse drawing ---
onMousePress(() => {
  const mp = mousePos();
  const side = mp.x < DIVIDER_X ? "left" : "right";
  const player = side === "left" ? 1 : 2;
  const strokeColor = player === 1 ? [231, 76, 60] : [52, 152, 219];

  currentStroke = {
    points: [clampToSide(mp, side)],
    color: strokeColor,
    size: playerState[player].brushSize,
    opacity: playerState[player].opacity,
    halftone: playerState[player].halftone,
    side,
    player,
  };
  playerState[player].strokes.push(currentStroke);
});

onMouseMove(() => {
  if (isMouseDown() && currentStroke) {
    const mp = mousePos();
    const onCorrectSide = currentStroke.side === "left"
      ? mp.x < DIVIDER_X
      : mp.x >= DIVIDER_X;
    if (onCorrectSide) {
      currentStroke.points.push(mp);
    }
  }
});

onMouseRelease(() => {
  currentStroke = null;
});

// --- Render ---
onDraw(() => {
  drawRuledLines();
  drawDivider();

  const allStrokes = [
    ...playerState[1].strokes,
    ...playerState[2].strokes,
  ];

  for (const stroke of allStrokes) {
    if (stroke.points.length === 1) {
      drawHalftoneCircle(
        stroke.points[0],
        stroke.size / 2,
        stroke.color,
        stroke.opacity,
        stroke.halftone,
      );
      continue;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      drawHalftoneSegment(
        stroke.points[i - 1],
        stroke.points[i],
        stroke.size,
        stroke.color,
        stroke.opacity,
        stroke.halftone,
      );
    }
  }
});

// --- Sidebar button wiring ---

// Brush size
document.querySelectorAll(".size-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const player = btn.dataset.player;
    const size = Number(btn.dataset.size);
    playerState[player].brushSize = size;
    btn.closest(".size-buttons").querySelectorAll(".size-btn").forEach((b) => {
      b.classList.remove("active");
    });
    btn.classList.add("active");
  });
});

// Halftone
document.querySelectorAll(".halftone-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const player = btn.dataset.player;
    playerState[player].halftone = btn.dataset.halftone;
    btn.closest(".halftone-buttons").querySelectorAll(".halftone-btn").forEach((b) => {
      b.classList.remove("active");
    });
    btn.classList.add("active");
  });
});

// Undo
document.querySelectorAll(".undo-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const player = btn.dataset.player;
    playerState[player].strokes.pop();
  });
});
