// Comically Large Gallery — pulls drawings from Supabase and scrolls them
// through picture frames that mirror the end-of-game overlay.

const FRAME_IMAGES = [
  "../assets/pictureframesAsset 1 1.png",
  "../assets/pictureframesAsset 3 1.png",
  "../assets/pictureframesAsset 4 1.png",
];

// Placeholder captions for drawings that were uploaded without a metadata row.
const FALLBACK_CAPTION = "A masterpiece, unsigned.";

// Scroll speed in px/sec. The track scrolls right-to-left (translateX decreases).
const SCROLL_SPEED = 55;

// Poll Supabase this often for new drawings so the wall stays live.
const REFRESH_MS = 60_000;

const trackEl  = document.getElementById("galleryTrack");
const statusEl = document.getElementById("galleryStatus");
const countEl  = document.getElementById("galleryCount");

let drawings   = [];  // [{path, url, caption, prompt, createdAt}]
let paused     = false;
let lastTick   = null;
let offset     = 0;
let trackWidth = 0;

function setStatus(text) {
  if (!text) {
    statusEl.classList.add("hidden");
    statusEl.textContent = "";
    return;
  }
  statusEl.classList.remove("hidden");
  statusEl.textContent = text;
}

function pickFrame(index) {
  return FRAME_IMAGES[index % FRAME_IMAGES.length];
}

function buildSlide(item, index) {
  const slide = document.createElement("div");
  slide.className = "gallery-slide";

  const wrap = document.createElement("div");
  wrap.className = "frame-wrap";

  const frame = document.createElement("img");
  frame.className = "frame-img";
  frame.src = pickFrame(index);
  frame.alt = "";

  const drawing = document.createElement("img");
  drawing.className = "frame-drawing";
  drawing.src = item.url;
  drawing.alt = item.caption || item.prompt || "drawing";
  drawing.loading = "lazy";
  drawing.decoding = "async";

  wrap.appendChild(drawing);
  wrap.appendChild(frame);

  const plaque = document.createElement("div");
  plaque.className = "plaque";
  const caption = document.createElement("div");
  caption.className = "caption-text";
  caption.textContent = item.caption || FALLBACK_CAPTION;
  plaque.appendChild(caption);
  if (item.prompt) {
    const prompt = document.createElement("span");
    prompt.className = "prompt-text";
    prompt.textContent = `"${item.prompt}"`;
    plaque.appendChild(prompt);
  }

  slide.appendChild(wrap);
  slide.appendChild(plaque);
  return slide;
}

function renderTrack() {
  trackEl.innerHTML = "";
  if (drawings.length === 0) return;

  // Duplicate the list so the track can loop seamlessly when it wraps.
  const doubled = drawings.concat(drawings);
  for (let i = 0; i < doubled.length; i++) {
    trackEl.appendChild(buildSlide(doubled[i], i));
  }

  // Wait a tick for layout, then measure one copy's width to know when to wrap.
  requestAnimationFrame(() => {
    // The first half is one full pass; its width is what we loop on.
    const totalWidth = trackEl.scrollWidth;
    trackWidth = totalWidth / 2;
    offset = 0;
    trackEl.style.transform = "translateX(0px)";
  });
}

function step(now) {
  if (lastTick == null) lastTick = now;
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  if (!paused && trackWidth > 0) {
    offset += SCROLL_SPEED * dt;
    if (offset >= trackWidth) offset -= trackWidth;
    trackEl.style.transform = `translateX(${-offset}px)`;
  }
  requestAnimationFrame(step);
}

async function loadDrawings() {
  const api = window.ComicallyLargeDrawings;
  if (!api || typeof api.listDrawings !== "function") {
    setStatus("Supabase not configured. Edit env/config.js to start showing drawings.");
    return;
  }

  try {
    const items = await api.listDrawings({ limit: 200 });
    drawings = items;
    countEl.textContent = `${items.length} drawing${items.length === 1 ? "" : "s"}`;
    if (items.length === 0) {
      setStatus("No drawings yet. Finish a round of the game to fill this wall.");
      trackEl.innerHTML = "";
      trackWidth = 0;
      return;
    }
    setStatus("");
    renderTrack();
  } catch (err) {
    console.error("[gallery] loadDrawings failed:", err);
    setStatus("Couldn't reach Supabase. Check env/config.js and bucket permissions.");
  }
}

// Pause/resume on spacebar (matches the "press space to restart" vibe in-game).
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    paused = !paused;
  }
});

// Refresh periodically so new drawings appear on the wall without a reload.
setInterval(loadDrawings, REFRESH_MS);

loadDrawings();
requestAnimationFrame(step);
