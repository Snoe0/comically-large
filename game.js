const container = document.querySelector(".canvas-container");

kaplay({
  canvas: document.getElementById("gameCanvas"),
  width: container.clientWidth,
  height: container.clientHeight,
  background: [255, 255, 255],
  stretch: true,
  letterbox: false,
});

const LINE_SPACING = 32;
const LINE_COLOR = [173, 216, 250];
const MARGIN_COLOR = [230, 100, 100];
const DIVIDER_X = width() / 2;

// Per-player state
const playerState = {
  1: { brushSize: 8, strokes: [] },
  2: { brushSize: 8, strokes: [] },
};

let currentStroke = null;

// --- Draw ruled paper lines ---
function drawRuledLines() {
  // Horizontal blue lines
  for (let y = LINE_SPACING; y < height(); y += LINE_SPACING) {
    drawLine({
      p1: vec2(0, y),
      p2: vec2(width(), y),
      width: 1,
      color: rgb(...LINE_COLOR),
    });
  }
  // Red margin lines on each side
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

// Prompt display
add([
  text("Draw: A Cat!", { size: 28 }),
  pos(width() / 2, 30),
  anchor("top"),
  color(233, 69, 96),
  fixed(),
  z(10),
]);

// Timer display
add([
  text("3:00", { size: 22 }),
  pos(width() / 2, 68),
  anchor("top"),
  color(80, 80, 80),
  fixed(),
  z(10),
]);

// --- Clamp a point to a side of the canvas ---
function clampToSide(point, side) {
  const x = side === "left"
    ? Math.min(point.x, DIVIDER_X - 1)
    : Math.max(point.x, DIVIDER_X + 1);
  return vec2(x, point.y);
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
    side,
    player,
  };
  playerState[player].strokes.push(currentStroke);
});

onMouseMove(() => {
  if (isMouseDown() && currentStroke) {
    const clamped = clampToSide(mousePos(), currentStroke.side);
    currentStroke.points.push(clamped);
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
      drawCircle({
        pos: stroke.points[0],
        radius: stroke.size / 2,
        color: rgb(...stroke.color),
      });
      continue;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      drawLine({
        p1: stroke.points[i - 1],
        p2: stroke.points[i],
        width: stroke.size,
        color: rgb(...stroke.color),
        cap: "round",
      });
    }
  }
});

// --- Sidebar button wiring ---
document.querySelectorAll(".size-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const player = btn.dataset.player;
    const size = Number(btn.dataset.size);
    playerState[player].brushSize = size;

    // Update active state within this player's sidebar
    btn.closest(".size-buttons").querySelectorAll(".size-btn").forEach((b) => {
      b.classList.remove("active");
    });
    btn.classList.add("active");
  });
});

document.querySelectorAll(".undo-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const player = btn.dataset.player;
    playerState[player].strokes.pop();
  });
});
