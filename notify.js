/* ---------- New-message alerts (public page + dashboard) ---------- */
// Used for private messages: a soft sound, a count in the tab title, and a system
// notification when the page is in the background (only after the person allows it).
// They work while the page is open in a tab; nothing runs once it's closed.
(() => {
  const supported = "Notification" in window;
  let audio = null;

  // Browsers only allow sound after the person has interacted with the page once
  const unlock = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      if (audio.state === "suspended") audio.resume();
    } catch { /* no sound */ }
  };
  document.addEventListener("pointerdown", unlock, { once: true, capture: true });
  document.addEventListener("keydown", unlock, { once: true, capture: true });

  // Two short soft tones
  const ping = () => {
    if (!audio || audio.state !== "running") return;
    try {
      const t = audio.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const start = t + i * 0.11;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
        osc.connect(gain).connect(audio.destination);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    } catch { /* no sound */ }
  };

  // "(2) Title" while there's something unread
  const PREFIX = /^\(\d+\+?\)\s/;
  let count = 0;
  const applyTitle = () => {
    const base = document.title.replace(PREFIX, "");
    const next = count ? `(${count > 9 ? "9+" : count}) ${base}` : base;
    if (document.title !== next) document.title = next;
  };
  // Keep the count when the page changes its own title
  const titleEl = document.querySelector("title");
  if (titleEl) new MutationObserver(applyTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });

  const permission = () => (supported ? Notification.permission : "unsupported");

  const ask = async () => {
    if (!supported) return "unsupported";
    if (Notification.permission !== "default") return Notification.permission;
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  };

  // System notification: only when the page isn't in front (otherwise the page shows it itself)
  const system = ({ title, body = "", icon = "img/ppl.jpg", tag = "private-message", onClick }) => {
    if (!supported || Notification.permission !== "granted") return false;
    if (document.visibilityState === "visible" && document.hasFocus()) return false;
    try {
      const n = new Notification(title, { body: String(body).slice(0, 140), icon, tag, renotify: true });
      n.onclick = () => {
        window.focus();
        if (onClick) onClick();
        n.close();
      };
      return true;
    } catch {
      return false;   // some phones only allow notifications from installed apps
    }
  };

  window.Notify = {
    ping,
    system,
    ask,
    permission,
    supported,
    setCount: (n) => { count = Math.max(0, n | 0); applyTitle(); },
    isWatching: () => document.visibilityState === "visible" && document.hasFocus(),
  };
})();
