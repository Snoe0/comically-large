// Shared BroadcastChannel layer between display.html (audience) and the game
// pages (index.html / dual.html). Same-machine only — no network. Both pages
// must be loaded from the same origin for messages to flow.
(function () {
  const CHANNEL = "comically-large";
  const ch = new BroadcastChannel(CHANNEL);
  const handlers = new Map(); // type -> Set<fn>

  ch.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== "object" || !msg.type) return;
    const set = handlers.get(msg.type);
    if (!set) return;
    for (const fn of set) {
      try { fn(msg); } catch (err) { console.warn("[sync] handler error:", err); }
    }
  };

  window.Sync = {
    channel: CHANNEL,
    send(type, payload) {
      ch.postMessage({ type, ...(payload || {}) });
    },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
  };
})();
