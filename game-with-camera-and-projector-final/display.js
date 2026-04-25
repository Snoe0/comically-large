// Audience-facing screen. Picks the prompt, runs the scroller animation,
// plays the countdown video, then steps aside (timer + prompt label only)
// while the floor projection takes over for drawing. At the end, shows the
// final framed result built from the canvas snapshot the game page sends.

let PROMPTS = [];

const FRAME_IMAGES = [
  "../assets/pictureframesAsset 1 1.png",
  "../assets/pictureframesAsset 3 1.png",
  "../assets/pictureframesAsset 4 1.png",
];

let chosenPrompt = null;
let roundId = 0;

const OPTION_HEIGHT = 96;
const TOTAL_TIME = 60;

const promptLabel      = document.getElementById("promptLabel");
const promptOverlay    = document.getElementById("promptOverlay");
const countdownOverlay = document.getElementById("countdownOverlay");
const captionOverlay   = document.getElementById("captionOverlay");
const captionText      = document.getElementById("captionText");
const frameImg         = document.getElementById("frameImg");
const finalCanvas      = document.getElementById("finalDrawingCanvas");
const timerDisplay     = document.querySelector(".timer-display");
const video            = document.getElementById("countdownVideo");

function renderTimer(t) {
  const mins = Math.floor(t / 60);
  const secs = t % 60;
  timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
}
renderTimer(TOTAL_TIME);

function setBodyPhase(phase) {
  // Drives which static elements (timer, prompt label) are visible via CSS.
  document.body.dataset.phase = phase;
}

function hideAllOverlays() {
  promptOverlay.classList.add("hidden");
  promptOverlay.classList.remove("fade-out");
  promptOverlay.style.display = "";
  countdownOverlay.classList.add("hidden");
  captionOverlay.classList.add("hidden");
}

function showPromptOverlayFresh() {
  promptOverlay.classList.remove("hidden", "fade-out");
  promptOverlay.style.display = "";
}

// ─── Prompt scroller ─────────────────────────────────────────────────────────
function runPromptSelect() {
  const myRound = ++roundId;
  chosenPrompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  setBodyPhase("prompt");
  hideAllOverlays();
  showPromptOverlayFresh();
  promptLabel.classList.remove("visible");
  Sync.send("phase", { phase: "prompt" });

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
          if (myRound !== roundId) return;
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
  setBodyPhase("countdown");
  Sync.send("phase", { phase: "countdown" });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (myRound !== roundId) return;
    countdownOverlay.classList.add("hidden");
    enterPlay();
  };
  video.addEventListener("ended", finish, { once: true });
  video.addEventListener("error", finish, { once: true });
  setTimeout(finish, 30000);

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

// ─── Play phase ──────────────────────────────────────────────────────────────
function enterPlay() {
  setBodyPhase("play");
  hideAllOverlays();
  promptLabel.textContent = chosenPrompt?.text || "";
  promptLabel.classList.add("visible");
  renderTimer(TOTAL_TIME);
  Sync.send("phase", { phase: "play", prompt: chosenPrompt });
}

// ─── End phase: render received snapshot framed ──────────────────────────────
function showFramedResult(dataUrl, prompt) {
  setBodyPhase("end");
  hideAllOverlays();
  promptLabel.classList.remove("visible");

  frameImg.src = FRAME_IMAGES[Math.floor(Math.random() * FRAME_IMAGES.length)];

  const img = new Image();
  img.onload = () => {
    finalCanvas.width  = img.naturalWidth || 800;
    finalCanvas.height = img.naturalHeight || 600;
    const ctx = finalCanvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    ctx.drawImage(img, 0, 0, finalCanvas.width, finalCanvas.height);
  };
  img.src = dataUrl;

  captionText.textContent = prompt?.caption || "";
  captionOverlay.classList.remove("hidden");
}

// ─── Sync wiring ─────────────────────────────────────────────────────────────
Sync.on("tick", (msg) => {
  if (typeof msg.timeLeft === "number") renderTimer(msg.timeLeft);
});

Sync.on("final", (msg) => {
  if (!msg.dataUrl) return;
  showFramedResult(msg.dataUrl, msg.prompt || chosenPrompt);
});

Sync.on("restart", () => {
  if (!PROMPTS.length) return;
  runPromptSelect();
});

// If a game page boots after we did, it pings us — re-announce so it knows,
// and re-broadcast our current phase so the new page can skip straight into
// the right state instead of sitting idle forever mid-round.
Sync.on("game-loading", () => {
  Sync.send("display-ready");
  const phase = document.body.dataset.phase;
  if (phase === "play" && chosenPrompt) {
    Sync.send("phase", { phase: "play", prompt: chosenPrompt });
  } else if (phase === "prompt" || phase === "countdown") {
    Sync.send("phase", { phase });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (!PROMPTS.length) return;
    Sync.send("restart");
    runPromptSelect();
  }
});

// ─── Kick off ────────────────────────────────────────────────────────────────
fetch("../prompts.json")
  .then((r) => r.json())
  .then((data) => { PROMPTS = data; })
  .catch((err) => { console.error("Failed to load prompts.json:", err); })
  .finally(() => {
    Sync.send("display-ready");
    runPromptSelect();
  });
