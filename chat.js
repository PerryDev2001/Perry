/* ---------- Public chat (Firebase Firestore) ---------- */
// A classic script (not type="module") so it also runs when index.html is opened
// straight from disk; Firebase itself is loaded with dynamic import() from Google's CDN.
(async () => {
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const statusBox = document.getElementById("chatStatus");

let initializeApp, getAnalytics, isSupported;
let getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getCountFromServer;
let doc, getDoc, setDoc, updateDoc, getDocs, startAfter, deleteDoc;
let getAuth, signInAnonymously, onAuthStateChanged;
try {
  ({ initializeApp } = await import(`${SDK}/firebase-app.js`));
  ({ getAnalytics, isSupported } = await import(`${SDK}/firebase-analytics.js`));
  ({ getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getCountFromServer,
     doc, getDoc, setDoc, updateDoc, getDocs, startAfter, deleteDoc } =
    await import(`${SDK}/firebase-firestore.js`));
  ({ getAuth, signInAnonymously, onAuthStateChanged } = await import(`${SDK}/firebase-auth.js`));
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
  // The IP is only used in memory (to make a one-way visitor code); it's never saved anywhere
  countryPromise = fetch("https://get.geojs.io/v1/ip/country.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => ({
      code: String(d.country || "").slice(0, 2).toUpperCase(),
      name: String(d.name || "").slice(0, 56),
      ip: String(d.ip || ""),
    }))
    .catch(() => ({ code: "", name: "", ip: "" }));
  return countryPromise;
};

const flag = (code) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
const NO_FLAGS = /Windows/.test(navigator.userAgent);

/* ---------- Rendering ---------- */
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

const GROUP_GAP_MS = 5 * 60 * 1000;   // messages closer than this from one sender are grouped

// Same colour for the same name, every time
const hueFor = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};

// Messages that are only 1–3 emoji are shown big, without a bubble
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;
const isJumbo = (text) => {
  if (!EMOJI_ONLY.test(text) || !/\p{Extended_Pictographic}/u.test(text)) return false;
  const chars = segmenter ? [...segmenter.segment(text.replace(/\s/g, ""))].length : [...text.replace(/\s/g, "")].length;
  return chars <= 3;
};

const TIME_GAP_MS = 10 * 60 * 1000;   // show a centered time when messages are this far apart

// "5:40 PM", "Yesterday 5:40 PM", "Mon 5:40 PM" or "Oct 20, 5:40 PM"
const stampLabel = (date) => {
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return time;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  if (today - date < 6 * 86400000) return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
};


const senderKey = (id, m) => (mine.has(id) ? "me" : `${m.name}|${m.device}|${m.country}`);

const renderMessage = (id, m, { first, last }) => {
  const own = mine.has(id);
  const date = m.createdAt?.toDate?.();
  const name = m.name || "Anonymous";

  const item = el("li", "msg");
  if (own) item.classList.add("is-mine");
  if (!first) item.classList.add("is-cont");
  if (last) item.classList.add("is-last");
  if (!firstLoad && !rendered.has(id)) item.classList.add("is-new");

  // Avatar (others only), shown on the last message of a group
  if (!own) {
    const avatar = el("span", "msg-avatar", [...name][0].toUpperCase());
    avatar.style.setProperty("--h", hueFor(name));
    avatar.setAttribute("aria-hidden", "true");
    item.append(avatar);
  }

  const body = el("div", "msg-body");

  if (first && !own) {
    const meta = el("div", "msg-meta");
    meta.append(el("span", "msg-name", name));
    if (m.device) meta.append(el("span", "msg-origin", m.device));
    if (m.country) {
      // Windows can't draw flag emoji, so show the country code there instead
      const tag = NO_FLAGS ? el("span", "msg-country", m.country) : el("span", "msg-flag", flag(m.country));
      if (m.countryName) tag.title = m.countryName;
      meta.append(tag);
    }
    body.append(meta);
  }

  const text = el("p", "msg-text", m.text);
  if (isJumbo(m.text)) item.classList.add("is-jumbo");
  if (date) text.title = date.toLocaleString() + (m.countryName ? ` · ${m.countryName}` : "");
  body.append(text);

  item.append(body);
  return item;
};

const renderList = (docs) => {
  const frag = document.createDocumentFragment();
  let prevDate = null;

  docs.forEach((d, i) => {
    const m = d.data({ serverTimestamps: "estimate" });
    const date = m.createdAt?.toDate?.() || new Date();
    const day = date.toDateString();

    if (!prevDate || date - prevDate >= TIME_GAP_MS || prevDate.toDateString() !== day) {
      frag.append(el("li", "chat-time", stampLabel(date)));
    }
    prevDate = date;

    const prev = docs[i - 1];
    const next = docs[i + 1];
    const sameAs = (other) => {
      if (!other) return false;
      const o = other.data({ serverTimestamps: "estimate" });
      const od = o.createdAt?.toDate?.() || new Date();
      return senderKey(other.id, o) === senderKey(d.id, m) &&
        Math.abs(od - date) < GROUP_GAP_MS &&
        od.toDateString() === day;
    };

    frag.append(renderMessage(d.id, m, { first: !sameAs(prev), last: !sameAs(next) }));
  });

  list.replaceChildren(frag);
};

// "Latest messages" card on the profile page
const recentMessagesEl = document.getElementById("recentMessages");
const relTime = (date) => {
  if (!date) return "now";
  const sec = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (sec < 60) return "now";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  if (sec < 604800) return `${Math.round(sec / 86400)}d`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const renderRecentMessages = (docs) => {
  if (!recentMessagesEl) return;
  const latest = docs.slice(-4).reverse();
  if (!latest.length) {
    recentMessagesEl.replaceChildren(el("li", "mini-empty", "No messages yet. Be the first to say hi! 👋"));
    return;
  }
  recentMessagesEl.replaceChildren(...latest.map((d) => {
    const m = d.data({ serverTimestamps: "estimate" });
    const own = mine.has(d.id);
    const name = own ? "You" : (m.name || "Anonymous");
    const li = el("li", "mini-item");
    const avatar = el("span", "mini-avatar", [...name][0].toUpperCase());
    avatar.style.setProperty("--h", hueFor(m.name || "Anonymous"));
    avatar.setAttribute("aria-hidden", "true");
    const main = el("div", "mini-main");
    main.append(el("span", "mini-title", name), el("span", "mini-sub", m.text));
    li.append(avatar, main, el("span", "mini-time", relTime(m.createdAt?.toDate?.())));
    return li;
  }));
};

const setStatus = (text) => {
  statusEl.textContent = text;
  statusEl.hidden = !text;
};

const isOpen = () => !panel.hidden;

const fabFloat = document.getElementById("chatFab");
const fabBadge = document.getElementById("chatFabBadge");

const setBadge = () => {
  const label = unread > 9 ? "9+" : String(unread);
  badge.hidden = unread === 0;
  badge.textContent = label;
  if (fabBadge) {
    fabBadge.hidden = unread === 0;
    fabBadge.textContent = label;
  }
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

    renderList(docs);
    renderRecentMessages(docs);
    for (const d of docs) rendered.add(d.id);

    if (!docs.length) list.append(el("li", "chat-empty", "No messages yet. Say hi! 👋"));
    setStatus("");
    firstLoad = false;
    if (stick) scrollToBottom();
  },
  (err) => {
    console.error(err);
    list.replaceChildren(el("li", "chat-empty", "Messages can't be shown right now."));
    if (recentMessagesEl) recentMessagesEl.replaceChildren(el("li", "mini-empty", "Messages can't be shown right now."));
    setStatus(err.code === "permission-denied"
      ? "Chat isn't set up yet (Firestore rules)."
      : "Couldn't load the chat. Check your connection.");
  }
);

/* ---------- Emoji picker ---------- */
const picker = document.getElementById("emojiPicker");
const pickerTabs = document.getElementById("emojiTabs");
const pickerGrid = document.getElementById("emojiGrid");
const emojiBtn = document.getElementById("emojiToggle");

const EMOJI = [
  { icon: "🕘", label: "Recent", list: [] },
  { icon: "😀", label: "Smileys", list: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖".split(" ") },
  { icon: "❤️", label: "Hearts", list: "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 🩷 🩵 🩶 ❤️‍🔥 ❤️‍🩹 💕 💞 💓 💗 💖 💘 💝 💟 ❣️ 💔 💌 💋 😻 🥰 😍 😘 💐 🌹".split(" ") },
  { icon: "👋", label: "Gestures", list: "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💪 🫡 🙋 🙆 🙅 🤷 🤦 🙇".split(" ") },
  { icon: "🐶", label: "Nature", list: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳 🦈 🌸 🌼 🌻 🌺 🌷 🍀 🌿 🌵 🌴 🍁 🌈 ☀️ 🌙 ⭐ 🌟 ✨ ⚡ 🔥 💧 🌊 ❄️ ☃️".split(" ") },
  { icon: "🍔", label: "Food", list: "🍎 🍓 🍒 🍑 🥭 🍍 🍌 🍉 🍇 🥑 🍅 🌽 🥕 🍞 🧀 🍳 🥓 🍔 🍟 🍕 🌭 🌮 🌯 🍜 🍝 🍣 🍱 🍚 🍛 🍤 🍙 🍰 🎂 🧁 🍩 🍪 🍫 🍬 🍭 🍦 ☕ 🧋 🍵 🥤 🍺 🍻 🥂 🍷".split(" ") },
  { icon: "⚽", label: "Activities", list: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 🏆 🥇 🎯 🎮 🕹️ 🎲 🧩 🎨 🎬 🎤 🎧 🎸 🎹 🥁 🎉 🎊 🎈 🎁 🎀 🪄 🏃 🚴 🏊 🧘 💃 🕺".split(" ") },
  { icon: "💡", label: "Objects", list: "💻 🖥️ ⌨️ 🖱️ 📱 📷 🎥 💡 🔦 📚 📖 ✏️ 📝 📌 📎 ✂️ 🔒 🔑 🧠 💼 🗂️ 📅 ⏰ ⌛ 💰 💎 🛠️ ⚙️ 🧪 🚀 ✈️ 🚗 🏠 🌍 🗺️ ✅ ❌ ⚠️ ❓ ❗ 💯 🔔 🎵 💬 💭 👀 🙈 🙉 🙊".split(" ") },
];

const RECENT_MAX = 24;
EMOJI[0].list = store.get("chat-emoji-recent", []);

let activeCat = EMOJI[0].list.length ? 0 : 1;

const insertAtCaret = (str) => {
  const start = textInput.selectionStart ?? textInput.value.length;
  const end = textInput.selectionEnd ?? textInput.value.length;
  const next = textInput.value.slice(0, start) + str + textInput.value.slice(end);
  if (next.length > MAX_TEXT) return;
  textInput.value = next;
  const caret = start + str.length;
  textInput.setSelectionRange(caret, caret);
  textInput.dispatchEvent(new Event("input"));
};

const remember = (emoji) => {
  const recent = [emoji, ...EMOJI[0].list.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  EMOJI[0].list = recent;
  store.set("chat-emoji-recent", recent);
};

const renderGrid = () => {
  const cat = EMOJI[activeCat];
  pickerGrid.replaceChildren();
  pickerGrid.setAttribute("aria-label", cat.label);
  if (!cat.list.length) {
    pickerGrid.append(el("p", "emoji-empty", "Emoji you use will show up here."));
    return;
  }
  for (const emoji of cat.list) {
    const b = el("button", "emoji", emoji);
    b.type = "button";
    b.setAttribute("aria-label", emoji);
    pickerGrid.append(b);
  }
};

const renderTabs = () => {
  pickerTabs.replaceChildren(
    ...EMOJI.map((cat, i) => {
      const t = el("button", "emoji-tab", cat.icon);
      t.type = "button";
      t.setAttribute("role", "tab");
      t.setAttribute("aria-label", cat.label);
      t.setAttribute("aria-selected", String(i === activeCat));
      t.dataset.cat = i;
      return t;
    })
  );
};

pickerTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".emoji-tab");
  if (!tab) return;
  activeCat = +tab.dataset.cat;
  renderTabs();
  renderGrid();
  pickerGrid.scrollTop = 0;
});

pickerGrid.addEventListener("click", (e) => {
  const b = e.target.closest(".emoji");
  if (!b) return;
  const emoji = b.textContent;
  insertAtCaret(emoji);
  remember(emoji);
  b.animate([{ transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 250, easing: "ease-out" });
});

const pickerOpen = () => !picker.hidden;

const openPicker = () => {
  if (EMOJI[0].list.length && activeCat === 1 && !picker.dataset.seen) activeCat = 0;
  picker.dataset.seen = "1";
  renderTabs();
  renderGrid();
  picker.hidden = false;
  requestAnimationFrame(() => picker.classList.add("is-open"));
  emojiBtn.setAttribute("aria-expanded", "true");
  emojiBtn.classList.add("is-active");
};

const closePicker = () => {
  picker.classList.remove("is-open");
  picker.hidden = true;
  emojiBtn.setAttribute("aria-expanded", "false");
  emojiBtn.classList.remove("is-active");
};

emojiBtn.addEventListener("click", () => {
  if (pickerOpen()) closePicker(); else openPicker();
  if (window.matchMedia("(hover: hover)").matches) textInput.focus();
});

// Close the picker when clicking elsewhere
document.addEventListener("pointerdown", (e) => {
  if (pickerOpen() && !picker.contains(e.target) && !emojiBtn.contains(e.target)) closePicker();
});

/* ---------- Composer state: counter + send button ---------- */
const countEl = document.getElementById("chatCount");
const composeEl = document.getElementById("chatCompose");
const likeBtn = document.getElementById("chatLike");

// Empty box + heart button = send a 💚
likeBtn.addEventListener("click", () => {
  textInput.value = "💚";
  updateComposer();
  form.requestSubmit();
});
const updateComposer = () => {
  const len = textInput.value.length;
  const left = MAX_TEXT - len;
  countEl.hidden = left > 100;
  countEl.textContent = String(left);
  countEl.classList.toggle("is-low", left <= 20);
  const ready = textInput.value.trim().length > 0;
  sendBtn.disabled = !ready;
  sendBtn.classList.toggle("is-ready", ready);
  composeEl.classList.toggle("has-text", ready);
};
textInput.addEventListener("input", updateComposer);
updateComposer();

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
    updateComposer();
    closePicker();
    setStatus("");
    scrollToBottom();
  } catch (err) {
    console.error(err);
    setStatus(err.code === "permission-denied"
      ? "Couldn't send: the chat isn't set up yet (Firestore rules)."
      : "Couldn't send. Please try again.");
  } finally {
    updateComposer();
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

const close = (restoreFocus = true) => {
  panel.classList.remove("is-open");
  fab.setAttribute("aria-expanded", "false");
  fab.classList.remove("is-active");
  closePicker();
  setTimeout(() => { if (!panel.classList.contains("is-open")) panel.hidden = true; }, 250);
  if (restoreFocus) fab.focus({ preventScroll: true });
};

// Clicking / tapping anywhere outside the chat collapses it
document.addEventListener("pointerdown", (e) => {
  if (!isOpen()) return;
  const t = e.target;
  if (panel.contains(t)) return;
  // The buttons that open the chat handle their own clicks
  if (t.closest && t.closest("#chatToggle, #chatFab, [data-open-chat]")) return;
  close(false);
});

fab.addEventListener("click", () => (isOpen() ? close() : open()));
if (fabFloat) fabFloat.addEventListener("click", () => (isOpen() ? close() : open()));
document.querySelectorAll("[data-open-chat]").forEach((b) => b.addEventListener("click", () => {
  if (!isOpen()) open();
  else textInput.focus();
}));
closeBtn.addEventListener("click", () => close());
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (pickerOpen()) closePicker();
  else if (isOpen()) close();
});
/* ---------- Visitors (who viewed the page) ---------- */
const visitsRef = collection(db, "visits");
const VISITS_PAGE = 20;            // visitors per page

const vBtn = document.getElementById("viewersToggle");
const vPanel = document.getElementById("viewersPanel");
const vList = document.getElementById("viewersList");
const vTotal = document.getElementById("viewersTotal");
const vCount = document.getElementById("viewersCount");
const vLabel = document.getElementById("viewersLabel");

const myVisits = new Set(store.get("visit-mine", []));
let totalViews = null;

const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

let shownViews = 0;
let countAnim = 0;

// The number counts up to the new total
const showTotal = () => {
  if (totalViews === null) return;
  vCount.classList.remove("is-loading");
  vLabel.textContent = totalViews === 1 ? "visitor" : "visitors";
  vTotal.textContent = `${totalViews.toLocaleString()} unique ${totalViews === 1 ? "visitor" : "visitors"} · most recent first`;
  vBtn.setAttribute("aria-label", `${totalViews.toLocaleString()} visitors. See who viewed this page`);
  document.querySelectorAll("[data-visitor-count]").forEach((n) => { n.textContent = totalViews.toLocaleString(); });
  document.querySelectorAll("[data-visitor-label]").forEach((n) => { n.textContent = totalViews === 1 ? "visitor" : "visitors"; });

  cancelAnimationFrame(countAnim);
  const from = shownViews;
  const to = totalViews;
  const start = performance.now();
  const dur = from === 0 ? 1100 : 500;
  const step = (now) => {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    shownViews = Math.round(from + (to - from) * eased);
    vCount.textContent = compact(shownViews);
    if (p < 1) countAnim = requestAnimationFrame(step);
  };
  countAnim = requestAnimationFrame(step);
};

const ago = (date) => {
  if (!date) return "just now";
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const DEVICE_ICONS = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

const deviceKind = (device = "") => {
  if (/iPad|tablet/i.test(device)) return "tablet";
  if (/PC|Mac|Chromebook|Linux|Unknown/i.test(device)) return "computer";
  return "phone";
};

let liveDocs = [];        // first page, kept live
let olderDocs = [];       // pages loaded with "Load more"
let hasMore = false;
let loadingMore = false;

const allVisitDocs = () => {
  const live = new Set(liveDocs.map((d) => d.id));
  return [...liveDocs, ...olderDocs.filter((d) => !live.has(d.id))];
};

const moreFooter = (shown) => {
  const li = el("li", "viewers-more");
  if (totalViews !== null) li.append(el("span", "viewers-shown", `Showing ${shown.toLocaleString()} of ${totalViews.toLocaleString()}`));
  if (hasMore) {
    const b = el("button", "viewers-more-btn", loadingMore ? "Loading…" : "Load more");
    b.type = "button";
    b.disabled = loadingMore;
    li.append(b);
  }
  return li;
};

const renderVisits = () => {
  const docs = allVisitDocs();
  if (!docs.length) {
    vList.replaceChildren(el("li", "viewers-empty", "No visitors recorded yet."));
    return;
  }
  const items = docs.map((d) => {
    const v = d.data({ serverTimestamps: "estimate" });
    const date = (v.lastSeen || v.createdAt)?.toDate?.();
    const firstSeen = v.createdAt?.toDate?.();
    const item = el("li", "viewer");

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("class", "viewer-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = DEVICE_ICONS[deviceKind(v.device)];   // fixed markup, never user text

    const info = el("div", "viewer-info");
    const name = el("span", "viewer-device", v.device || "Unknown device");
    if (myVisits.has(d.id)) name.append(el("span", "viewer-you", "You"));
    info.append(name);
    if (v.country) {
      const where = el("span", "viewer-where",
        NO_FLAGS ? `${v.country}${v.countryName ? ` · ${v.countryName}` : ""}` : `${flag(v.country)} ${v.countryName || v.country}`);
      info.append(where);
    }

    const when = el("time", "viewer-time", ago(date));
    if (date) {
      when.dateTime = date.toISOString();
      when.title = `Last visit: ${date.toLocaleString()}` + (firstSeen ? `\nFirst visit: ${firstSeen.toLocaleString()}` : "");
    }

    item.append(icon, info, when);
    return item;
  });
  vList.replaceChildren(...items, moreFooter(docs.length));
};

// Next page of older visitors
const loadMore = async () => {
  if (loadingMore || !hasMore) return;
  const docs = allVisitDocs();
  const cursor = docs[docs.length - 1];
  if (!cursor) return;
  loadingMore = true;
  renderVisits();
  try {
    const snap = await getDocs(query(visitsRef, orderBy("lastSeen", "desc"), startAfter(cursor), limit(VISITS_PAGE)));
    olderDocs = olderDocs.concat(snap.docs);
    hasMore = snap.docs.length === VISITS_PAGE;
  } catch (err) {
    console.error(err);
  } finally {
    loadingMore = false;
    renderVisits();
  }
};

vList.addEventListener("click", (e) => {
  if (e.target.closest(".viewers-more-btn")) loadMore();
});

// Infinite scroll: load the next page when reaching the bottom of the list
vList.addEventListener("scroll", () => {
  if (vList.scrollHeight - vList.scrollTop - vList.clientHeight < 60) loadMore();
}, { passive: true });

// Profile: overlapping circles of recent visitors + "Recent visitors" card
const faceStack = document.getElementById("faceStack");
const recentVisitorsEl = document.getElementById("recentVisitors");

const deviceSvg = (device, cls) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = DEVICE_ICONS[deviceKind(device)];   // fixed markup, never user text
  return svg;
};

const renderProfileVisitors = (docs) => {
  if (faceStack) {
    const faces = docs.slice(0, 6).map((d, i) => {
      const v = d.data({ serverTimestamps: "estimate" });
      const face = el("span", "face");
      face.style.setProperty("--h", (hueFor(d.id) + i * 67) % 360);
      face.append(deviceSvg(v.device, "icon"));
      return face;
    });
    if (totalViews !== null && totalViews > faces.length) {
      faces.push(el("span", "face face-more", `+${compact(totalViews - faces.length)}`));
    }
    faceStack.replaceChildren(...faces);
  }

  if (recentVisitorsEl) {
    const latest = docs.slice(0, 5);
    if (!latest.length) {
      recentVisitorsEl.replaceChildren(el("li", "mini-empty", "No visitors recorded yet."));
      return;
    }
    recentVisitorsEl.replaceChildren(...latest.map((d) => {
      const v = d.data({ serverTimestamps: "estimate" });
      const li = el("li", "mini-item");
      const avatar = el("span", "mini-avatar is-device");
      avatar.append(deviceSvg(v.device, "icon"));
      const main = el("div", "mini-main");
      const title = el("span", "mini-title", v.device || "Unknown device");
      if (myVisits.has(d.id)) title.append(" ", el("span", "viewer-you", "You"));
      const where = v.country
        ? (NO_FLAGS ? `${v.country}${v.countryName ? ` · ${v.countryName}` : ""}` : `${flag(v.country)} ${v.countryName || v.country}`)
        : "";
      main.append(title, el("span", "mini-sub", where));
      li.append(avatar, main, el("span", "mini-time", ago((v.lastSeen || v.createdAt)?.toDate?.())));
      return li;
    }));
  }
};

// One-way code for an IP address (SHA-256), so the real IP is never stored or shown
const VISITOR_SALT = "perry-calling-card:v1";
const hashIp = async (ip) => {
  if (!ip || !(window.crypto && crypto.subtle)) return "";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VISITOR_SALT + ip));
  return "ip-" + [...new Uint8Array(bytes)].slice(0, 20).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const randomKey = () =>
  "b-" + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Each visitor is one document. The key is, in order of preference:
//  1. the key this browser already used (so a changed IP doesn't create a duplicate)
//  2. a one-way code of the IP (so other browsers on the same IP don't either)
//  3. a random key for this browser (if the IP lookup failed)
// A first visit creates the document; later visits only refresh "lastSeen" (at most once a day).
const recordVisit = async () => {
  const today = new Date().toDateString();
  if (store.get("visit-day", "") === today) return;
  try {
    const [device, country] = await Promise.all([detectDevice(), detectCountry()]);
    const key = store.get("visit-key", "") || (await hashIp(country.ip)) || randomKey();
    const ref = doc(visitsRef, key);

    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, { lastSeen: serverTimestamp() });
    } else {
      await setDoc(ref, {
        device: device.slice(0, 40),
        country: country.code,
        countryName: country.name,
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      });
    }

    store.set("visit-key", key);
    store.set("visit-day", today);
    myVisits.add(key);
    store.set("visit-mine", [...myVisits].slice(-30));
  } catch (err) {
    console.warn("Visit not recorded:", err.code || err);
  }
};

// Total number of views (counted on the server), then kept up to date live
getCountFromServer(visitsRef)
  .then((snap) => { totalViews = snap.data().count; showTotal(); renderVisits(); renderProfileVisitors(liveDocs); })
  .catch(() => {
    vTotal.textContent = "Recent visitors";
    vCount.classList.remove("is-loading");
    vCount.textContent = "";
    vLabel.textContent = "visitors";
  });

let visitsLoaded = false;
onSnapshot(
  query(visitsRef, orderBy("lastSeen", "desc"), limit(VISITS_PAGE)),
  (snap) => {
    if (visitsLoaded && totalViews !== null) {
      // A returning visitor also shows up as "added", so re-count on the server instead
      getCountFromServer(visitsRef).then((c) => { totalViews = c.data().count; showTotal(); renderVisits(); }).catch(() => {});
    }
    visitsLoaded = true;
    liveDocs = snap.docs;
    if (!olderDocs.length) hasMore = snap.docs.length === VISITS_PAGE;
    renderVisits();
    renderProfileVisitors(snap.docs);
  },
  (err) => {
    console.error(err);
    vList.replaceChildren(el("li", "viewers-empty",
      err.code === "permission-denied" ? "Visitors aren't set up yet (Firestore rules)." : "Couldn't load visitors."));
    if (recentVisitorsEl) recentVisitorsEl.replaceChildren(el("li", "mini-empty", "Visitors can't be shown right now."));
  }
);

recordVisit();

// Keep the "5m ago" labels fresh while the list is open
setInterval(() => { if (!vPanel.hidden) renderVisits(); }, 60 * 1000);

const vOpen = () => !vPanel.hidden;
const openViewers = () => {
  vPanel.hidden = false;
  requestAnimationFrame(() => vPanel.classList.add("is-open"));
  vBtn.setAttribute("aria-expanded", "true");
  renderVisits();
};
const closeViewers = () => {
  vPanel.classList.remove("is-open");
  vBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => { if (!vPanel.classList.contains("is-open")) vPanel.hidden = true; }, 200);
};

vBtn.addEventListener("click", () => (vOpen() ? closeViewers() : openViewers()));
document.addEventListener("pointerdown", (e) => {
  if (vOpen() && !vPanel.contains(e.target) && !vBtn.contains(e.target)) closeViewers();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && vOpen()) closeViewers();
});

/* ---------- Comments on the pinned post (own collection, separate from the chat) ---------- */
// Each commenter gets a private anonymous Firebase sign-in, so only the browser that wrote a
// comment can edit or delete it (enforced by firestore.rules).
const commentsRef = collection(db, "comments");
const COMMENTS_PAGE = 20;
const MAX_COMMENT = 300;
const COMMENT_COOLDOWN_MS = 5000;
const POST_ID = "pinned";

const cSection = document.getElementById("comments");
const cList = document.getElementById("commentList");
const cMore = document.getElementById("commentsMore");
const cForm = document.getElementById("commentForm");
const cName = document.getElementById("commentName");
const cText = document.getElementById("commentText");
const cSend = document.getElementById("commentSend");
const cStatus = document.getElementById("commentStatus");
const cCount = document.getElementById("commentCount");
const cBadge = document.getElementById("commentsBadge");
const cChars = document.getElementById("commentChars");
const cToggle = document.getElementById("postComment");
const cMe = document.getElementById("commentMe");

if (cSection && cList && cForm) {
  const auth = getAuth(app);
  let myUid = null;
  const legacyMine = new Set(store.get("comment-mine", []));   // comments posted before sign-in existed

  const ensureSignedIn = async () => {
    if (auth.currentUser) return auth.currentUser;
    const cred = await signInAnonymously(auth);
    return cred.user;
  };

  let liveComments = [];     // newest page, kept live
  let olderComments = [];    // pages loaded with "View earlier comments"
  let moreComments = false;
  let commentTotal = null;
  let lastComment = 0;
  let commentsLoaded = false;
  let editingId = null;      // comment being edited
  let confirmingId = null;   // comment waiting for "Delete?" confirmation

  const setCStatus = (text) => {
    cStatus.textContent = text;
    cStatus.hidden = !text;
  };

  const explain = (err, action) => {
    const code = (err && err.code) || "";
    if (code === "auth/configuration-not-found") {
      return "Comments need Firebase Authentication: open Authentication in the Firebase console, click Get started, then turn on Anonymous.";
    }
    if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
      return "Comments need Anonymous sign-in turned on in Firebase (Authentication → Sign-in method → Anonymous).";
    }
    if (code === "auth/unauthorized-domain") {
      return `This website address isn't allowed yet: add "${location.hostname}" in Firebase (Authentication → Settings → Authorized domains).`;
    }
    if (code === "auth/operation-not-supported-in-this-environment" || location.protocol === "file:") {
      return "Commenting needs the page to be opened from a website (http/https), not as a file on your computer.";
    }
    if (err && err.code === "permission-denied") {
      return `Couldn't ${action}: the Firestore rules don't allow it yet.`;
    }
    return `Couldn't ${action}. Please try again.`;
  };

  // Name is shared with the chat ("chat-name")
  cName.value = store.get("chat-name", "");
  const showMe = () => {
    const n = cName.value.trim() || "Anonymous";
    cMe.textContent = [...n][0].toUpperCase();
    cMe.style.setProperty("--h", hueFor(n));
  };
  showMe();
  cName.addEventListener("input", showMe);
  if (nameInput) nameInput.addEventListener("change", () => { cName.value = nameInput.value.trim(); showMe(); });
  cName.addEventListener("change", () => {
    const n = cName.value.trim().slice(0, MAX_NAME);
    store.set("chat-name", n);
    if (nameInput) nameInput.value = n;
  });

  const showCount = () => {
    const n = commentTotal || 0;
    cBadge.textContent = n.toLocaleString();
    if (!n) { cCount.hidden = true; return; }
    cCount.hidden = false;
    cCount.textContent = `${n.toLocaleString()} ${n === 1 ? "comment" : "comments"}`;
  };

  const refreshCount = () =>
    getCountFromServer(commentsRef).then((s) => { commentTotal = s.data().count; showCount(); }).catch(() => {});

  const isMine = (d, c) => (c.uid && myUid && c.uid === myUid) || (!c.uid && legacyMine.has(d.id));
  const canManage = (c) => Boolean(c.uid && myUid && c.uid === myUid);
  let siteAdmin = false;   // signed in as an admin (email account listed in /admins)

  const iconSvg = (paths, cls = "icon") => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = paths;   // fixed markup, never user text
    return svg;
  };

  const actionBtn = (label, action, id) => {
    const b = el("button", `comment-action${action === "delete" ? " is-danger" : ""}`, label);
    b.type = "button";
    b.dataset.action = action;
    b.dataset.id = id;
    return b;
  };

  const renderComment = (d) => {
    const c = d.data({ serverTimestamps: "estimate" });
    const name = c.name || "Anonymous";
    const date = c.createdAt?.toDate?.();
    const mine = isMine(d, c);

    const li = el("li", "comment");
    li.dataset.id = d.id;
    if (mine) li.classList.add("is-mine");
    if (commentsLoaded && !rendered.has("c:" + d.id)) li.classList.add("is-new");

    const avatar = el("span", "comment-avatar", [...name][0].toUpperCase());
    avatar.style.setProperty("--h", hueFor(name));
    avatar.setAttribute("aria-hidden", "true");

    const body = el("div", "comment-body");
    const bubble = el("div", "comment-bubble");

    const head = el("div", "comment-head");
    head.append(el("span", "comment-author", name));
    if (mine) head.append(el("span", "viewer-you", "You"));
    if (c.device || c.country) {
      const chip = el("span", "comment-device");
      if (c.device) {
        chip.append(iconSvg(DEVICE_ICONS[deviceKind(c.device)]), el("span", "", c.device));
      }
      if (c.country) chip.append(el("span", "comment-flag", NO_FLAGS ? c.country : flag(c.country)));
      if (c.countryName) chip.title = c.countryName;
      head.append(chip);
    }
    bubble.append(head);

    if (editingId === d.id) {
      // Inline editor
      const editor = el("textarea", "comment-edit");
      editor.value = c.text;
      editor.maxLength = MAX_COMMENT;
      editor.rows = 2;
      editor.setAttribute("aria-label", "Edit your comment");
      editor.dataset.id = d.id;
      bubble.append(editor);
      bubble.classList.add("is-editing");
      requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); });
    } else {
      bubble.append(el("p", "comment-text-body", c.text));
    }

    const meta = el("div", "comment-meta");
    const when = el("time", "comment-time", relTime(date));
    if (date) { when.dateTime = date.toISOString(); when.title = date.toLocaleString(); }
    meta.append(when);
    if (c.editedAt) meta.append(el("span", "comment-edited", "Edited"));

    if (editingId === d.id) {
      meta.append(actionBtn("Save", "save", d.id), actionBtn("Cancel", "cancel", d.id));
    } else if (confirmingId === d.id) {
      meta.append(el("span", "comment-confirm", "Delete this comment?"),
        actionBtn("Delete", "delete-yes", d.id), actionBtn("Cancel", "cancel", d.id));
    } else {
      meta.append(actionBtn("Reply", "reply", d.id));
      if (canManage(c)) meta.append(actionBtn("Edit", "edit", d.id), actionBtn("Delete", "delete", d.id));
      else if (siteAdmin) meta.append(actionBtn("Delete", "delete", d.id));
      // Posted before edit/delete existed: there's no owner to check, so it can't be changed
      else if (mine && !c.uid) {
        const note = el("span", "comment-edited", "Posted before editing was added");
        note.title = "Older comments have no owner ID, so they can't be edited or deleted from the site.";
        meta.append(note);
      }
    }

    body.append(bubble, meta);
    li.append(avatar, body);
    return li;
  };

  const allComments = () => {
    const live = new Set(liveComments.map((d) => d.id));
    // Oldest first, like a conversation
    return [...olderComments.filter((d) => !live.has(d.id)).slice().reverse(), ...liveComments.slice().reverse()];
  };

  const findComment = (id) => allComments().find((d) => d.id === id);

  const renderComments = () => {
    const all = allComments();
    if (!all.length) {
      const empty = el("li", "comment-empty");
      empty.append(
        iconSvg('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.3 9.3 0 0 1-3.6-.7L3 21l1.6-4.6A8 8 0 0 1 3 11.5 8.6 8.6 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5Z"/>', "icon comment-empty-icon"),
        el("strong", "", "No comments yet"),
        el("span", "", "Be the first to say something nice 💚")
      );
      cList.replaceChildren(empty);
    } else {
      cList.replaceChildren(...all.map(renderComment));
      for (const d of all) rendered.add("c:" + d.id);
    }
    cMore.hidden = !moreComments;
  };

  onAuthStateChanged(auth, async (user) => {
    myUid = user ? user.uid : null;
    siteAdmin = false;
    if (user && !user.isAnonymous) {
      try { siteAdmin = (await getDoc(doc(db, "admins", user.uid))).exists(); } catch { siteAdmin = false; }
    }
    if (commentsLoaded) renderComments();
  });

  onSnapshot(
    query(commentsRef, orderBy("createdAt", "desc"), limit(COMMENTS_PAGE)),
    (snap) => {
      liveComments = snap.docs;
      // Deleted comments must disappear from older pages too
      const gone = new Set(snap.docChanges().filter((ch) => ch.type === "removed").map((ch) => ch.doc.id));
      if (gone.size) olderComments = olderComments.filter((d) => !gone.has(d.id));
      if (!olderComments.length) moreComments = snap.docs.length === COMMENTS_PAGE;
      if (editingId && !findComment(editingId)) editingId = null;
      renderComments();
      commentsLoaded = true;
      refreshCount();
    },
    (err) => {
      console.error(err);
      cList.replaceChildren(el("li", "comment-empty",
        err.code === "permission-denied" ? "Comments aren't set up yet (Firestore rules)." : "Comments can't be shown right now."));
    }
  );

  cMore.addEventListener("click", async () => {
    const oldest = (olderComments.length ? olderComments : liveComments).at(-1);
    if (!oldest) return;
    cMore.disabled = true;
    try {
      const snap = await getDocs(query(commentsRef, orderBy("createdAt", "desc"), startAfter(oldest), limit(COMMENTS_PAGE)));
      olderComments = olderComments.concat(snap.docs);
      moreComments = snap.docs.length === COMMENTS_PAGE;
      renderComments();
    } catch (err) {
      console.error(err);
    } finally {
      cMore.disabled = false;
    }
  });

  /* Reply / edit / delete */
  const saveEdit = async (id) => {
    const editor = cList.querySelector(`.comment-edit[data-id="${CSS.escape(id)}"]`);
    if (!editor) return;
    const text = editor.value.replace(/\s+\n/g, "\n").trim().slice(0, MAX_COMMENT);
    const current = findComment(id);
    if (!text) { setCStatus("A comment can't be empty. Use Delete to remove it."); return; }
    if (current && text === current.data().text) { editingId = null; renderComments(); return; }
    editor.disabled = true;
    try {
      await ensureSignedIn();
      await updateDoc(doc(commentsRef, id), { text, editedAt: serverTimestamp() });
      editingId = null;
      setCStatus("");
    } catch (err) {
      console.error(err);
      editor.disabled = false;
      setCStatus(explain(err, "save your edit"));
    }
  };

  cList.addEventListener("click", async (e) => {
    const b = e.target.closest(".comment-action");
    if (!b) return;
    const { action, id } = b.dataset;
    const d = findComment(id);

    if (action === "reply" && d) {
      const name = d.data().name || "Anonymous";
      const mention = `@${name} `;
      if (!cText.value.startsWith(mention)) cText.value = mention + cText.value;
      cText.dispatchEvent(new Event("input"));
      cText.focus();
      cText.setSelectionRange(cText.value.length, cText.value.length);
      cForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (action === "edit") { editingId = id; confirmingId = null; renderComments(); return; }
    if (action === "delete") { confirmingId = id; editingId = null; renderComments(); return; }
    if (action === "cancel") { editingId = null; confirmingId = null; setCStatus(""); renderComments(); return; }
    if (action === "save") { saveEdit(id); return; }

    if (action === "delete-yes") {
      b.disabled = true;
      try {
        await ensureSignedIn();
        await deleteDoc(doc(commentsRef, id));
        confirmingId = null;
        setCStatus("");
      } catch (err) {
        console.error(err);
        b.disabled = false;
        setCStatus(explain(err, "delete the comment"));
      }
    }
  });

  // Editor keys: Enter saves, Escape cancels
  cList.addEventListener("keydown", (e) => {
    const editor = e.target.closest(".comment-edit");
    if (!editor) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(editor.dataset.id); }
    if (e.key === "Escape") { e.stopPropagation(); editingId = null; renderComments(); }
  });

  /* Open / close the comment section (it stays on the post — no chat) */
  const openComments = (focus) => {
    cSection.hidden = false;
    requestAnimationFrame(() => cSection.classList.add("is-open"));
    cToggle.setAttribute("aria-expanded", "true");
    cToggle.classList.add("is-active");
    if (focus) cText.focus({ preventScroll: true });
    cSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const closeComments = () => {
    cSection.classList.remove("is-open");
    cSection.hidden = true;
    cToggle.setAttribute("aria-expanded", "false");
    cToggle.classList.remove("is-active");
  };

  cToggle.addEventListener("click", () => {
    if (cSection.hidden) openComments(true);
    else cText.focus();
  });
  cCount.addEventListener("click", () => (cSection.hidden ? openComments(false) : closeComments()));

  /* Composer */
  const growComment = () => {
    cText.style.height = "auto";
    cText.style.height = `${Math.min(cText.scrollHeight, 120)}px`;
    cSend.disabled = !cText.value.trim();
    const left = MAX_COMMENT - cText.value.length;
    cChars.hidden = left > 50;
    cChars.textContent = String(left);
    cChars.classList.toggle("is-low", left <= 10);
  };
  cText.addEventListener("input", growComment);
  cText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      cForm.requestSubmit();
    }
  });

  // Quick emoji buttons insert at the cursor
  cForm.querySelector(".comment-quick")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-emoji]");
    if (!b) return;
    const emoji = b.dataset.emoji;
    const start = cText.selectionStart ?? cText.value.length;
    const end = cText.selectionEnd ?? cText.value.length;
    const next = cText.value.slice(0, start) + emoji + cText.value.slice(end);
    if (next.length > MAX_COMMENT) return;
    cText.value = next;
    cText.setSelectionRange(start + emoji.length, start + emoji.length);
    cText.focus();
    growComment();
    b.animate([{ transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 250, easing: "ease-out" });
  });

  cForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = cText.value.replace(/\s+\n/g, "\n").trim().slice(0, MAX_COMMENT);
    if (!text) return;

    const wait = COMMENT_COOLDOWN_MS - (Date.now() - lastComment);
    if (wait > 0) {
      setCStatus(`Please wait ${Math.ceil(wait / 1000)}s before commenting again.`);
      return;
    }

    const name = cName.value.trim().slice(0, MAX_NAME);
    store.set("chat-name", name);
    if (nameInput) nameInput.value = name;

    cSend.disabled = true;
    try {
      const [user, device, country] = await Promise.all([ensureSignedIn(), detectDevice(), detectCountry()]);
      await addDoc(commentsRef, {
        post: POST_ID,
        uid: user.uid,
        name,
        text,
        device: device.slice(0, 40),
        country: country.code,
        countryName: country.name,
        createdAt: serverTimestamp(),
      });
      lastComment = Date.now();
      cText.value = "";
      setCStatus("");
    } catch (err) {
      console.error(err);
      setCStatus(explain(err, "post your comment"));
    } finally {
      growComment();
    }
  });

  // Keep "5m" style times fresh (not while editing)
  setInterval(() => { if (!cSection.hidden && !editingId) renderComments(); }, 60 * 1000);
}
/* ---------- Profile + posts managed from the admin dashboard ---------- */
const DEFAULT_PROFILE = {
  name: "Perry Philip Lozano",
  role: "Software Developer",
  bio: "“Commit your work to the LORD, and your plans will be established.”",
  bioRef: "Proverbs 16:3",
};
let siteProfile = { ...DEFAULT_PROFILE };

const setText = (selector, text) => {
  for (const node of document.querySelectorAll(selector)) node.textContent = text;
};

const applyProfile = (p) => {
  siteProfile = { ...DEFAULT_PROFILE, ...p };
  const { name, role, bio, bioRef } = siteProfile;
  const first = name.split(/\s+/)[0] || name;

  document.title = role ? `${name} — ${role}` : name;
  setText(".brand-text strong, #name, .post-author, [data-profile-name]", name);
  setText(".brand-text small, .profile-role", role);
  setText(".intro-list li:first-child strong", role);
  setText(".bio p", bio);
  setText(".bio cite", bioRef);
  setText("#chatTitle", `Chat with ${first}`);

  const pinned = document.querySelector(".post:not(.dyn-post) .post-text");
  if (pinned) pinned.textContent = bioRef ? `${bio} — ${bioRef}` : bio;

  for (const sel of [".brand-text small", ".profile-role"]) {
    for (const n of document.querySelectorAll(sel)) n.hidden = !role;
  }
};

onSnapshot(
  doc(db, "site", "profile"),
  (snap) => { if (snap.exists()) applyProfile(snap.data()); },
  (err) => console.warn("Profile not loaded:", err.code || err)
);

// Posts (newest first) above the pinned post
const postsFeed = document.getElementById("postsFeed");
const postDate = (date) => {
  if (!date) return "Just now";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }) +
    " at " + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const renderPost = (d) => {
  const p = d.data({ serverTimestamps: "estimate" });
  const date = p.createdAt?.toDate?.();

  const article = el("article", "card post dyn-post");
  const head = el("header", "post-head");
  const avatar = el("img", "post-avatar");
  avatar.src = document.querySelector(".profile-avatar")?.getAttribute("src") || "img/ppl.jpg";
  avatar.alt = "";
  avatar.width = 40;
  avatar.height = 40;
  const who = el("div");
  const meta = el("p", "post-meta");
  const time = el("time", "", relTime(date) === "now" ? "Just now" : postDate(date));
  if (date) { time.dateTime = date.toISOString(); time.title = date.toLocaleString(); }
  meta.append(time);
  who.append(el("p", "post-author", siteProfile.name), meta);
  head.append(avatar, who);

  article.append(head, el("p", "post-text", p.text));
  return article;
};

if (postsFeed) {
  onSnapshot(
    query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(20)),
    (snap) => postsFeed.replaceChildren(...snap.docs.map(renderPost)),
    (err) => console.warn("Posts not loaded:", err.code || err)
  );
}

})();
