/* ---------- Outbox: instant, safe message sending (public page + dashboard) ---------- */
// The page clears the box and shows the message right away; the outbox then writes it to
// Firebase in the background, one at a time and in order.
//  • Every message gets its own ID before it is written, so a retry can never create a copy.
//  • A failed message keeps its text and can be retried or removed.
//  • Offline: messages wait in order and go out when the connection is back.
//  • Spam guards: empty / too long messages are refused, the same text sent again within
//    2 seconds is ignored, and a rate limit (shared by all tabs of this browser) kicks in
//    only for clearly excessive sending. firestore.rules enforce a server-side limit too.
(() => {
  const LIMITS = {
    burst: { count: 8, ms: 10 * 1000 },    // at most 8 messages in 10 seconds
    minute: { count: 30, ms: 60 * 1000 },  // and 30 in a minute
  };
  const MIN_GAP_MS = 600;                  // spacing between writes (the server requires 0.5 s)
  const SAME_TEXT_MS = 2000;               // repeated identical text within this time is ignored

  const readTimes = (key) => {
    try {
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(list) ? list.filter((t) => Date.now() - t < LIMITS.minute.ms) : [];
    } catch {
      return [];
    }
  };
  const writeTimes = (key, list) => {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* private mode: per-tab only */ }
  };

  // key: names the conversation (for the rate limit); write(id, text, meta, attempt): saves one
  // message and resolves once Firebase accepted it; newId(): a new Firestore document ID.
  window.createOutbox = ({ key, maxLength, write, newId, onChange }) => {
    const items = [];   // { id, text, meta, status: "queued" | "sending" | "failed", at, attempt, error }
    const rateKey = `send-times:${key}`;
    let running = false;
    let lastWriteAt = 0;

    const changed = () => { if (onChange) onChange(); };

    const pump = async () => {
      if (running) return;
      const next = items.find((m) => m.status === "queued");
      if (!next) return;
      running = true;
      const wait = Math.max(0, lastWriteAt + MIN_GAP_MS - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      next.status = "sending";
      changed();
      lastWriteAt = Date.now();
      try {
        await write(next.id, next.text, next.meta, next.attempt);
        items.splice(items.indexOf(next), 1);   // the live listener now shows the real message
      } catch (err) {
        console.error(err);
        next.status = "failed";
        next.error = err;
        next.attempt += 1;
      }
      running = false;
      changed();
      pump();
    };

    const send = (raw, meta = {}) => {
      const text = String(raw ?? "").replace(/[ \t]+\n/g, "\n").trim();
      if (!text) return { ok: false, reason: "empty" };
      if (text.length > maxLength) return { ok: false, reason: "long", max: maxLength };

      const now = Date.now();
      // A repeated Enter / double click on the same text: already on its way
      if (items.some((m) => m.text === text && m.status !== "failed" && now - m.at < SAME_TEXT_MS)) {
        return { ok: true, duplicate: true };
      }

      const times = readTimes(rateKey);
      const recent = times.filter((t) => now - t < LIMITS.burst.ms).length;
      if (recent >= LIMITS.burst.count || times.length >= LIMITS.minute.count) {
        const oldest = recent >= LIMITS.burst.count
          ? times.filter((t) => now - t < LIMITS.burst.ms)[0] + LIMITS.burst.ms
          : times[0] + LIMITS.minute.ms;
        return { ok: false, reason: "rate", retryIn: Math.max(1, Math.ceil((oldest - now) / 1000)) };
      }
      times.push(now);
      writeTimes(rateKey, times);

      const item = { id: newId(), text, meta, status: "queued", at: now, attempt: 0, error: null };
      items.push(item);
      changed();
      pump();
      return { ok: true, id: item.id };
    };

    const retry = (id) => {
      const m = items.find((x) => x.id === id);
      if (!m || m.status !== "failed") return;
      m.status = "queued";
      m.error = null;
      changed();
      pump();
    };

    const discard = (id) => {
      const i = items.findIndex((x) => x.id === id && x.status === "failed");
      if (i >= 0) items.splice(i, 1);
      changed();
    };

    return {
      send,
      retry,
      discard,
      list: () => items.slice(),
      get: (id) => items.find((x) => x.id === id) || null,
    };
  };

  // Shared message for a refused send
  window.outboxRefusal = (res) => {
    if (!res || res.ok) return "";
    if (res.reason === "rate") return "You're sending messages too quickly. Please try again in a moment.";
    if (res.reason === "long") return `Messages can be up to ${res.max} characters.`;
    return "";
  };
})();
