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

let drawings     = [];  // [{path, url, caption, prompt, createdAt}]
let paused       = false;
let lastTick     = null;
let offset       = 0;   // current translateX magnitude (track moves left by this much)
let appendCursor = 0;   // next drawings[] index to drop onto the right of the track
let slideIndex   = 0;   // monotonic counter for frame selection, so adjacent slides differ

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

function currentGap() {
  const cs = getComputedStyle(trackEl);
  return parseFloat(cs.columnGap || cs.gap) || 0;
}

function appendNext() {
  if (drawings.length === 0) return;
  const item = drawings[appendCursor % drawings.length];
  trackEl.appendChild(buildSlide(item, slideIndex));
  appendCursor++;
  slideIndex++;
}

function renderTrack() {
  trackEl.innerHTML = "";
  appendCursor = 0;
  slideIndex = 0;
  offset = 0;
  trackEl.style.transform = "translateX(0px)";
  if (drawings.length === 0) return;

  // Just drop one slide in as a seed; step() will fill the viewport on the
  // first frame once layout has resolved.
  appendNext();
}

function step(now) {
  if (lastTick == null) lastTick = now;
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  if (!paused && trackEl.children.length > 0) {
    offset += SCROLL_SPEED * dt;

    // Drop slides that have fully scrolled past the left edge. Each removal
    // shifts the remaining slides left in layout space by their width + gap,
    // so we subtract the same amount from offset to hold the visuals still.
    const gap = currentGap();
    let first = trackEl.firstElementChild;
    while (first && first.offsetLeft + first.offsetWidth - offset < -10) {
      const shrink = first.offsetWidth + gap;
      trackEl.removeChild(first);
      offset -= shrink;
      first = trackEl.firstElementChild;
    }

    // Keep adding slides until the rightmost one sits beyond the viewport
    // plus a small buffer, so new content is ready before it's needed.
    const viewportWidth = trackEl.parentElement.clientWidth;
    let last = trackEl.lastElementChild;
    let safety = 0;
    while (last && last.offsetLeft + last.offsetWidth - offset < viewportWidth + 200 && safety++ < 50) {
      appendNext();
      last = trackEl.lastElementChild;
    }

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
    const hadSlides = trackEl.children.length > 0;
    drawings = items;
    countEl.textContent = `${items.length} drawing${items.length === 1 ? "" : "s"}`;
    if (items.length === 0) {
      setStatus("No drawings yet. Finish a round of the game to fill this wall.");
      trackEl.innerHTML = "";
      return;
    }
    setStatus("");
    // On refresh, don't wipe the track — slides already on screen keep
    // scrolling, and newly appended ones will pull from the updated list.
    if (!hadSlides) renderTrack();
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
