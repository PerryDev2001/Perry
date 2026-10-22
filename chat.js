/* ---------- Public chat (Firebase Firestore) ---------- */
// A classic script (not type="module") so it also runs when index.html is opened
// straight from disk; Firebase itself is loaded with dynamic import() from Google's CDN.
(async () => {
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const statusBox = document.getElementById("chatStatus");

let initializeApp, getAnalytics, isSupported;
let getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp;
try {
  ({ initializeApp } = await import(`${SDK}/firebase-app.js`));
  ({ getAnalytics, isSupported } = await import(`${SDK}/firebase-analytics.js`));
  ({ getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } =
    await import(`${SDK}/firebase-firestore.js`));
} catch (err) {
  console.error(err);
  if (statusBox) { statusBox.textContent = "Couldn't load the chat. Check your connection."; statusBox.hidden = false; }
  return;
}

// Web config is public by design; access is controlled by firestore.rules
const firebaseConfig = {
  apiKey: "AIzaSyDMOzTwiSR-SoC_GBDrgO1p0QykN4V_K34",
  authDomain: "chat-6bd7a.firebaseapp.com",
  projectId: "chat-6bd7a",
  storageBucket: "chat-6bd7a.firebasestorage.app",
  messagingSenderId: "756417357830",
  appId: "1:756417357830:web:84fa2f52b38ed0ec53bb87",
  measurementId: "G-6LYPQCZM7H",
};

const app = initializeApp(firebaseConfig);
isSupported().then((ok) => ok && getAnalytics(app)).catch(() => {});
const db = getFirestore(app);
const messagesRef = collection(db, "messages");

const HISTORY = 100;          // messages loaded
const MAX_TEXT = 500;
const MAX_NAME = 24;
const COOLDOWN_MS = 3000;     // between sends

/* ---------- Elements ---------- */
const fab = document.getElementById("chatToggle");
const panel = document.getElementById("chatPanel");
const closeBtn = document.getElementById("chatClose");
const list = document.getElementById("chatList");
const statusEl = document.getElementById("chatStatus");
const form = document.getElementById("chatForm");
const nameInput = document.getElementById("chatName");
const textInput = document.getElementById("chatText");
const sendBtn = document.getElementById("chatSend");
const badge = document.getElementById("chatBadge");

/* ---------- Small storage helpers ---------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const mine = new Set(store.get("chat-mine", []));
nameInput.value = store.get("chat-name", "");
nameInput.addEventListener("change", () => store.set("chat-name", nameInput.value.trim().slice(0, MAX_NAME)));

/* ---------- Device (brand / model) ---------- */
const BRANDS = [
  [/^(SM-|Galaxy)/i, "Samsung"],
  [/^Pixel/i, "Google"],
  [/^RMX/i, "realme"],
  [/^(CPH|PH[A-Z]\d)/i, "OPPO"],
  [/^(Redmi|POCO|Mi |M\d{4}|2\d{3}[A-Z0-9]{3,})/i, "Xiaomi"],
  [/^(vivo|V\d{4})/i, "vivo"],
  [/^Infinix/i, "Infinix"],
  [/^TECNO/i, "TECNO"],
  [/^(HUAWEI|[A-Z]{3}-[AL]X\d)/i, "Huawei"],
  [/^(moto|Motorola|XT\d)/i, "Motorola"],
  [/^(Nokia|TA-\d)/i, "Nokia"],
  [/^(ONEPLUS|CPH\d)/i, "OnePlus"],
  [/^ASUS/i, "ASUS"],
  [/^(LM-|LG)/i, "LG"],
];

const withBrand = (model) => {
  for (const [re, brand] of BRANDS) {
    if (re.test(model)) return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
  }
  return model;
};

const detectDevice = async () => {
  const ua = navigator.userAgent;

  // Chromium browsers can share the exact phone model
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const { platform, model } = await navigator.userAgentData.getHighEntropyValues(["platform", "model"]);
      if (platform === "Android") return model ? withBrand(model.trim()) : "Android phone";
      if (platform === "Windows") return "Windows PC";
      if (platform === "macOS") return "Mac";
      if (platform === "Chrome OS") return "Chromebook";
      if (platform === "Linux") return "Linux PC";
    }
  } catch { /* fall back to the user agent */ }

  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  const android = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
  if (android && android[1] !== "K") return withBrand(android[1].trim());
  if (/Android/.test(ua)) return "Android phone";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux PC";
  return "Unknown device";
};

/* ---------- Country (looked up once, only when sending) ---------- */
let countryPromise = null;
const detectCountry = () => {
  if (countryPromise) return countryPromise;
  const cached = (() => { try { return JSON.parse(sessionStorage.getItem("chat-country")); } catch { return null; } })();
  if (cached) return (countryPromise = Promise.resolve(cached));

  countryPromise = fetch("https://get.geojs.io/v1/ip/country.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => ({ code: String(d.country || "").slice(0, 2).toUpperCase(), name: String(d.name || "").slice(0, 56) }))
    .catch(() => ({ code: "", name: "" }))
    .then((c) => {
      try { sessionStorage.setItem("chat-country", JSON.stringify(c)); } catch { /* ignore */ }
      return c;
    });
  return countryPromise;
};

const flag = (code) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";

/* ---------- Rendering ---------- */
const timeLabel = (date) => {
  if (!date) return "now";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " +
      date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;   // textContent: never HTML
  return node;
};

const rendered = new Set();
let firstLoad = true;
let unread = 0;

const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
const scrollToBottom = () => { list.scrollTop = list.scrollHeight; };

const renderMessage = (id, m) => {
  const item = el("li", "msg");
  if (mine.has(id)) item.classList.add("is-mine");
  if (!firstLoad && !rendered.has(id)) item.classList.add("is-new");

  const meta = el("div", "msg-meta");
  meta.append(el("span", "msg-name", m.name || "Anonymous"), el("span", "msg-time", timeLabel(m.createdAt?.toDate?.())));

  const origin = [m.device, [flag(m.country), m.countryName].filter(Boolean).join(" ")].filter(Boolean).join(" · ");

  item.append(meta, el("p", "msg-text", m.text));
  if (origin) item.append(el("div", "msg-origin", origin));
  return item;
};

const setStatus = (text) => {
  statusEl.textContent = text;
  statusEl.hidden = !text;
};

const isOpen = () => !panel.hidden;

const setBadge = () => {
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? "9+" : String(unread);
};

onSnapshot(
  query(messagesRef, orderBy("createdAt", "desc"), limit(HISTORY)),
  (snap) => {
    const stick = firstLoad || nearBottom();
    const docs = snap.docs.slice().reverse();

    if (!firstLoad && !isOpen()) {
      for (const d of docs) if (!rendered.has(d.id) && !mine.has(d.id)) unread++;
      setBadge();
    }

    const frag = document.createDocumentFragment();
    for (const d of docs) {
      frag.append(renderMessage(d.id, d.data({ serverTimestamps: "estimate" })));
    }
    list.replaceChildren(frag);
    for (const d of docs) rendered.add(d.id);

    if (!docs.length) list.append(el("li", "chat-empty", "No messages yet. Say hi! 👋"));
    setStatus("");
    firstLoad = false;
    if (stick) scrollToBottom();
  },
  (err) => {
    console.error(err);
    list.replaceChildren(el("li", "chat-empty", "Messages can't be shown right now."));
    setStatus(err.code === "permission-denied"
      ? "Chat isn't set up yet (Firestore rules)."
      : "Couldn't load the chat. Check your connection.");
  }
);

/* ---------- Sending ---------- */
let lastSent = 0;

const autoGrow = () => {
  textInput.style.height = "auto";
  textInput.style.height = `${Math.min(textInput.scrollHeight, 120)}px`;
};
textInput.addEventListener("input", autoGrow);

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textInput.value.replace(/\s+\n/g, "\n").trim().slice(0, MAX_TEXT);
  if (!text) return;

  const wait = COOLDOWN_MS - (Date.now() - lastSent);
  if (wait > 0) {
    setStatus(`Slow down a little — wait ${Math.ceil(wait / 1000)}s.`);
    return;
  }

  const name = nameInput.value.trim().slice(0, MAX_NAME);
  store.set("chat-name", name);

  sendBtn.disabled = true;
  try {
    const [device, country] = await Promise.all([detectDevice(), detectCountry()]);
    const ref = await addDoc(messagesRef, {
      name,
      text,
      device: device.slice(0, 40),
      country: country.code,
      countryName: country.name,
      createdAt: serverTimestamp(),
    });
    mine.add(ref.id);
    store.set("chat-mine", [...mine].slice(-200));
    lastSent = Date.now();
    textInput.value = "";
    autoGrow();
    setStatus("");
    scrollToBottom();
  } catch (err) {
    console.error(err);
    setStatus(err.code === "permission-denied"
      ? "Couldn't send: the chat isn't set up yet (Firestore rules)."
      : "Couldn't send. Please try again.");
  } finally {
    sendBtn.disabled = false;
    textInput.focus();
  }
});

/* ---------- Open / close ---------- */
const open = () => {
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("is-open"));
  fab.setAttribute("aria-expanded", "true");
  fab.classList.add("is-active");
  unread = 0;
  setBadge();
  scrollToBottom();
  if (window.matchMedia("(hover: hover)").matches) textInput.focus();
};

const close = () => {
  panel.classList.remove("is-open");
  fab.setAttribute("aria-expanded", "false");
  fab.classList.remove("is-active");
  setTimeout(() => { if (!panel.classList.contains("is-open")) panel.hidden = true; }, 250);
  fab.focus();
};

fab.addEventListener("click", () => (isOpen() ? close() : open()));
closeBtn.addEventListener("click", close);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isOpen()) close();
});
})();
