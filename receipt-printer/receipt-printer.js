// Comically Large Mail-a-Masterpiece — pick a drawing from Supabase, render a
// 384px-wide black-and-white receipt-style template, and ship it as a PNG via
// a pre-filled Gmail compose tab (with clipboard copy + file download).

// ---------- Layout constants ----------
// 25:57 portrait canvas (base 200×456, multiples of 8). SCALE oversamples
// so the 1-bit threshold has antialiased source pixels to bite into.
const SCALE         = 3;
const CANVAS_W      = 200 * SCALE;   // 600 — width / 8 = 75 bytes/row
const CANVAS_H      = 456 * SCALE;   // 1368
const BYTES_PER_ROW = CANVAS_W / 8;

// Stacked layout: top band | drawing box | caption band.
const TOP_BAND_H  = 84  * SCALE;
const BOX_TOP     = 96  * SCALE;
const BOX_BOTTOM  = 332 * SCALE;
const BOX_LEFT    = 4   * SCALE;
const BOX_RIGHT   = 196 * SCALE;
const BOX_PAD     = 4   * SCALE;
const CAPTION_TOP = 340 * SCALE;

const FALLBACK_CAPTION = "A MASTERPIECE, UNSIGNED.";

const SPEECH_BUBBLE_SRC = "../assets/speech-bubble.png";
const SPEECH_BUBBLE_MAX_W = 78  * SCALE;
const SPEECH_BUBBLE_MAX_H = 72  * SCALE;
const SPEECH_BUBBLE_RIGHT = 196 * SCALE;
const SPEECH_BUBBLE_TOP   = 6   * SCALE;
let speechBubbleImg = null;

// ---------- DOM handles ----------
const gridEl         = document.getElementById("grid");
const statusEl       = document.getElementById("status");
const templateCanvas = document.getElementById("templateCanvas");
const previewCanvas  = document.getElementById("previewCanvas");
const ditherToggle   = document.getElementById("ditherToggle");
const emailBtn       = document.getElementById("emailBtn");
const downloadBtn    = document.getElementById("downloadBtn");
const toInput        = document.getElementById("toInput");
const subjectInput   = document.getElementById("subjectInput");
const bodyInput      = document.getElementById("bodyInput");
const byteCountEl    = document.getElementById("byteCount");
const emailStatusEl  = document.getElementById("emailStatus");

// ---------- State ----------
let drawings     = [];
let currentItem  = null;
let currentIndex = -1;
let currentPngBlob = null;

// ---------- Status ----------
function setStatus(text) {
  if (!text) {
    statusEl.classList.add("hidden");
    statusEl.textContent = "";
    return;
  }
  statusEl.classList.remove("hidden");
  statusEl.textContent = text;
}

function setEmailStatus(text) {
  emailStatusEl.textContent = text || "";
}

// ---------- Fetch ----------
async function loadDrawings() {
  const api = window.ComicallyLargeDrawings;
  if (!api || typeof api.listDrawings !== "function") {
    setStatus("Supabase not configured. Edit env/config.js to start picking drawings.");
    return;
  }

  try {
    const items = await api.listDrawings({ limit: 200 });
    drawings = items;
    if (items.length === 0) {
      setStatus("No drawings yet. Finish a round of the game to fill this list.");
      gridEl.innerHTML = "";
      return;
    }
    setStatus("");
    renderGrid();
  } catch (err) {
    console.error("[mail-a-masterpiece] loadDrawings failed:", err);
    setStatus("Couldn't reach Supabase. Check env/config.js and bucket permissions.");
  }
}

// ---------- Grid ----------
function renderGrid() {
  gridEl.innerHTML = "";
  drawings.forEach((item, i) => {
    const img = new Image();
    // CORS must be set BEFORE src so the image is fetched with the right headers.
    img.crossOrigin = "anonymous";
    img.className = "thumb";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = item.caption || item.prompt || `drawing #${i + 1}`;
    img.dataset.index = String(i);
    img.src = item.url;
    img.addEventListener("click", () => selectDrawing(item, i));
    gridEl.appendChild(img);
  });
}

async function selectDrawing(item, index) {
  currentItem = item;
  currentIndex = index;
  for (const el of gridEl.querySelectorAll(".thumb.selected")) {
    el.classList.remove("selected");
  }
  const chosen = gridEl.querySelector(`.thumb[data-index="${index}"]`);
  if (chosen) chosen.classList.add("selected");

  try {
    await renderTemplate(item, index);
    await updateOutput();
    emailBtn.disabled = false;
    downloadBtn.disabled = false;

    // Seed subject from caption so the email matches the drawing.
    const caption = (item.caption || FALLBACK_CAPTION).toString();
    subjectInput.value = caption.charAt(0).toUpperCase() + caption.slice(1).toLowerCase();
  } catch (err) {
    console.error("[mail-a-masterpiece] renderTemplate failed:", err);
    setStatus("Couldn't load that drawing. Try another.");
  }
}

// ---------- Template composition ----------
async function renderTemplate(item, index) {
  const ctx = templateCanvas.getContext("2d");
  // Smooth scaling gives the 1-bit threshold a higher-fidelity source
  // (esp. for the speech-bubble raster), which reads as "less pixelated".
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Background
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Top band: #NNNN label (left) + "COMICALLY LARGE" speech bubble (right)
  const label = "#" + String(index + 1).padStart(4, "0");
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold ${22 * SCALE}px "imaginaryfriend-bb", sans-serif`;
  ctx.fillText(label, 8 * SCALE, 44 * SCALE);

  drawSpeechBubble(ctx);

  // Drawing box
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2 * SCALE;
  ctx.strokeRect(BOX_LEFT, BOX_TOP, BOX_RIGHT - BOX_LEFT, BOX_BOTTOM - BOX_TOP);

  // Load and draw the selected image, letterboxed inside the box.
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = item.url;
  await img.decode();

  const innerLeft   = BOX_LEFT + BOX_PAD;
  const innerTop    = BOX_TOP + BOX_PAD;
  const innerRight  = BOX_RIGHT - BOX_PAD;
  const innerBottom = BOX_BOTTOM - BOX_PAD;
  const innerW = innerRight - innerLeft;
  const innerH = innerBottom - innerTop;

  const scale = Math.min(innerW / img.naturalWidth, innerH / img.naturalHeight);
  const drawW = Math.max(1, Math.floor(img.naturalWidth * scale));
  const drawH = Math.max(1, Math.floor(img.naturalHeight * scale));
  const drawX = innerLeft + Math.floor((innerW - drawW) / 2);
  const drawY = innerTop + Math.floor((innerH - drawH) / 2);
  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  // Caption band
  const captionRaw = (item.caption || FALLBACK_CAPTION).toString().toUpperCase();
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold ${16 * SCALE}px "imaginaryfriend-bb", sans-serif`;

  const lines = wrapText(ctx, captionRaw, CANVAS_W - 16 * SCALE, 3);
  const lineH = 20 * SCALE;
  const blockH = lines.length * lineH;
  const bandH = CANVAS_H - CAPTION_TOP;
  const firstBaseline = CAPTION_TOP + Math.floor((bandH - blockH) / 2) + 16 * SCALE;
  lines.forEach((line, i) => {
    ctx.fillText(line, CANVAS_W / 2, firstBaseline + i * lineH);
  });
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const trial = current ? current + " " + word : word;
    if (ctx.measureText(trial).width <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // If we ran out of space and still have words, truncate last line with ellipsis.
  if (lines.length === maxLines) {
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) {
      let last = lines[lines.length - 1];
      while (ctx.measureText(last + "…").width > maxWidth && last.length > 0) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last + "…";
    }
  }
  return lines.length ? lines : [""];
}

function drawSpeechBubble(ctx) {
  if (!speechBubbleImg) return;
  const scale = Math.min(
    SPEECH_BUBBLE_MAX_W / speechBubbleImg.naturalWidth,
    SPEECH_BUBBLE_MAX_H / speechBubbleImg.naturalHeight
  );
  const w = Math.max(1, Math.round(speechBubbleImg.naturalWidth  * scale));
  const h = Math.max(1, Math.round(speechBubbleImg.naturalHeight * scale));
  const x = SPEECH_BUBBLE_RIGHT - w;
  const y = SPEECH_BUBBLE_TOP;
  ctx.drawImage(speechBubbleImg, x, y, w, h);
}

// ---------- Monochrome conversion ----------
function canvasToMonochrome(canvas, { dither }) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, W, H);

  // Alpha-composite over white, convert to grayscale (0..255, black=0).
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    const r = data[i]     * a + 255 * (1 - a);
    const g = data[i + 1] * a + 255 * (1 - a);
    const b = data[i + 2] * a + 255 * (1 - a);
    gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const bits = new Uint8Array(H * BYTES_PER_ROW);

  if (dither) {
    // Floyd-Steinberg on the mutable gray buffer.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const oldV = gray[idx];
        const newV = oldV < 128 ? 0 : 255;
        const err  = oldV - newV;
        if (newV === 0) {
          bits[y * BYTES_PER_ROW + (x >> 3)] |= (1 << (7 - (x & 7)));
        }
        if (x + 1 < W)                gray[idx + 1]       += err * 7 / 16;
        if (y + 1 < H) {
          if (x > 0)                  gray[idx + W - 1]   += err * 3 / 16;
                                       gray[idx + W]       += err * 5 / 16;
          if (x + 1 < W)              gray[idx + W + 1]   += err * 1 / 16;
        }
      }
    }
  } else {
    // Hard threshold at 128.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (gray[y * W + x] < 128) {
          bits[y * BYTES_PER_ROW + (x >> 3)] |= (1 << (7 - (x & 7)));
        }
      }
    }
  }

  return { bits, width: W, height: H };
}

// ---------- Preview ----------
function renderMonoPreview(bits, W, H) {
  previewCanvas.width = W;
  previewCanvas.height = H;
  const ctx = previewCanvas.getContext("2d");
  const id = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const bit = (bits[y * BYTES_PER_ROW + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = bit ? 0 : 255;
      const o = (y * W + x) * 4;
      id.data[o] = v;
      id.data[o + 1] = v;
      id.data[o + 2] = v;
      id.data[o + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
}

function previewToPngBlob() {
  return new Promise((resolve, reject) => {
    previewCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob returned null"));
    }, "image/png");
  });
}

// ---------- Wire-up ----------
async function updateOutput() {
  if (!currentItem) return;
  const { bits, width, height } = canvasToMonochrome(templateCanvas, { dither: ditherToggle.checked });
  renderMonoPreview(bits, width, height);
  currentPngBlob = await previewToPngBlob();
  byteCountEl.textContent = `${currentPngBlob.size.toLocaleString()} bytes (${width}×${height} PNG)`;
  setEmailStatus("");
}

function pngFilename() {
  const base = currentIndex >= 0 ? `comically-large-${String(currentIndex + 1).padStart(4, "0")}` : "comically-large";
  return `${base}.png`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyImageToClipboard(blob) {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch (err) {
    console.warn("[mail-a-masterpiece] clipboard image write failed:", err);
    return false;
  }
}

function openGmailCompose({ to, subject, body }) {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (to)      params.set("to", to);
  if (subject) params.set("su", subject);
  if (body)    params.set("body", body);
  const url = `https://mail.google.com/mail/?${params.toString()}`;
  window.open(url, "_blank", "noopener");
}

ditherToggle.addEventListener("change", () => {
  if (currentItem) updateOutput();
});

downloadBtn.addEventListener("click", () => {
  if (!currentPngBlob) return;
  triggerDownload(currentPngBlob, pngFilename());
});

emailBtn.addEventListener("click", async () => {
  if (!currentPngBlob) return;

  const copied = await copyImageToClipboard(currentPngBlob);
  triggerDownload(currentPngBlob, pngFilename());

  openGmailCompose({
    to: toInput.value.trim(),
    subject: subjectInput.value.trim() || "A masterpiece, unsigned.",
    body: bodyInput.value,
  });

  setEmailStatus(copied
    ? "Image copied — paste with Ctrl+V in Gmail."
    : "PNG downloaded — drop it into Gmail as an attachment.");
});

(async function init() {
  // Size the offscreen template canvas to the oversampled render grid.
  templateCanvas.width = CANVAS_W;
  templateCanvas.height = CANVAS_H;

  // Wait for imaginaryfriend-bb to load so canvas text renders in the right face.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) { /* non-fatal */ }
  }
  // Preload the speech bubble asset so it's ready when the first template renders.
  try {
    const img = new Image();
    img.src = SPEECH_BUBBLE_SRC;
    await img.decode();
    speechBubbleImg = img;
  } catch (err) {
    console.warn("[mail-a-masterpiece] speech bubble asset failed to load:", err);
  }
  await loadDrawings();
})();
