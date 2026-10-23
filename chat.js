/* ---------- Community Chat (Firebase Firestore) ---------- */
// A classic script (not type="module") so it also runs when index.html is opened
// straight from disk; Firebase itself is loaded with dynamic import() from Google's CDN.
(async () => {
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const statusBox = document.getElementById("chatStatus");

let initializeApp, getAnalytics, isSupported;
let getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getCountFromServer, where;
let doc, getDoc, setDoc, updateDoc, getDocs, startAfter, deleteDoc;
let getAuth, signInAnonymously, onAuthStateChanged;
try {
  ({ initializeApp } = await import(`${SDK}/firebase-app.js`));
  ({ getAnalytics, isSupported } = await import(`${SDK}/firebase-analytics.js`));
  ({ getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getCountFromServer, where,
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

// Signed in as an admin? Then chat messages go out as the admin's profile (photo, name, badge).
let chatAdminUid = null;
let lastMessageDocs = [];
const profilePhoto = () => document.querySelector(".profile-avatar")?.getAttribute("src") || "img/ppl.jpg";
const profileNameNow = () => document.getElementById("name")?.textContent.trim() || "Perry Philip Lozano";

const HISTORY = 100;          // messages loaded
const MAX_TEXT = 500;
const MAX_NAME = 24;
const COOLDOWN_MS = 3000;     // between sends

/* ---------- Elements ---------- */
const fab = document.getElementById("chatToggle") || document.createElement("button");   // removed from the page
const panel = document.getElementById("chatPanel");
const closeBtn = document.getElementById("chatClose");
const list = document.getElementById("chatList");
const statusEl = document.getElementById("chatStatus");
const form = document.getElementById("chatForm");
const nameInput = document.getElementById("chatName");
const textInput = document.getElementById("chatText");
const sendBtn = document.getElementById("chatSend");
const badge = document.getElementById("chatBadge") || document.createElement("span");   // removed from the page

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
  // The IP is saved only in "visitIps", which only admins can read (never shown on the public page)
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
let dmUnread = 0;   // unread private replies from the owner

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


const isOwnMsg = (id, m) => mine.has(id) || Boolean(m.admin && chatAdminUid && m.uid === chatAdminUid);
const senderKey = (id, m) => (isOwnMsg(id, m) ? "me" : m.admin ? "admin" : `${m.name}|${m.device}|${m.country}`);

const renderMessage = (id, m, { first, last, own = isOwnMsg(id, m), rx = null }) => {
  const date = m.createdAt?.toDate?.();
  const name = m.admin ? (m.name || profileNameNow()) : (m.name || "Anonymous");

  const item = el("li", "msg");
  if (own) item.classList.add("is-mine");
  if (!first) item.classList.add("is-cont");
  if (last) item.classList.add("is-last");
  if (!firstLoad && !rendered.has(id)) item.classList.add("is-new");

  // Avatar (others only), shown on the last message of a group
  if (m.admin) item.classList.add("is-admin");
  if (!own) {
    let avatar;
    if (m.admin) {
      avatar = el("span", "msg-avatar is-photo");
      const img = el("img");
      img.src = profilePhoto();
      img.alt = "";
      avatar.append(img);
    } else {
      avatar = el("span", "msg-avatar", [...name][0].toUpperCase());
      avatar.style.setProperty("--h", hueFor(name));
    }
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
  if (rx) rx.decorate(item, body, id);   // reaction badges + react button
  return item;
};

const renderList = (docs, target = list, ownOf = isOwnMsg, rx = chatRx) => {
  const frag = document.createDocumentFragment();
  let prevDate = null;
  const keyOf = (id, m) => (ownOf(id, m) ? "me" : m.admin ? "admin" : `${m.name}|${m.device}|${m.country}`);

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
      return keyOf(other.id, o) === keyOf(d.id, m) &&
        Math.abs(od - date) < GROUP_GAP_MS &&
        od.toDateString() === day;
    };

    frag.append(renderMessage(d.id, m, { first: !sameAs(prev), last: !sameAs(next), own: ownOf(d.id, m), rx }));
  });

  target.replaceChildren(frag);
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
  const total = unread + dmUnread;
  const label = total > 9 ? "9+" : String(total);
  badge.hidden = total === 0;
  badge.textContent = label;
  if (fabBadge) {
    fabBadge.hidden = total === 0;
    fabBadge.textContent = label;
  }
};

onSnapshot(
  query(messagesRef, orderBy("createdAt", "desc"), limit(HISTORY)),
  (snap) => {
    const stick = firstLoad || nearBottom();
    const docs = snap.docs.slice().reverse();
    lastMessageDocs = docs;

    if (!firstLoad && !isOpen()) {
      for (const d of docs) if (!rendered.has(d.id) && !isOwnMsg(d.id, d.data())) unread++;
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

// The same picker for any other text box (comments, posts). Shares the "Recent" list.
const SMILEY_SVG = '<svg class="icon icon-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 18a5.5 5.5 0 0 1-5-3.2h10A5.5 5.5 0 0 1 12 18Z"/></svg>';

const buildEmojiPicker = ({ input, max }) => {
  const toggle = el("button", "chat-emoji-btn");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Add emoji");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = SMILEY_SVG;   // fixed markup

  const box = el("div", "emoji-picker inline-emoji-picker");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Choose an emoji");
  box.hidden = true;
  const tabs = el("div", "emoji-tabs");
  tabs.setAttribute("role", "tablist");
  const grid = el("div", "emoji-grid");
  box.append(tabs, grid);

  let cat = EMOJI[0].list.length ? 0 : 1;
  const drawTabs = () => {
    tabs.replaceChildren(...EMOJI.map((cg, i) => {
      const t = el("button", "emoji-tab", cg.icon);
      t.type = "button";
      t.setAttribute("role", "tab");
      t.setAttribute("aria-label", cg.label);
      t.setAttribute("aria-selected", String(i === cat));
      t.dataset.cat = i;
      return t;
    }));
  };
  const drawGrid = () => {
    const cg = EMOJI[cat];
    grid.setAttribute("aria-label", cg.label);
    if (!cg.list.length) {
      grid.replaceChildren(el("p", "emoji-empty", "Emoji you use will show up here."));
      return;
    }
    grid.replaceChildren(...cg.list.map((emoji) => {
      const b = el("button", "emoji", emoji);
      b.type = "button";
      b.setAttribute("aria-label", emoji);
      return b;
    }));
  };
  const isOpen = () => !box.hidden;
  const open = () => {
    if (EMOJI[0].list.length && !box.dataset.seen) cat = 0;
    box.dataset.seen = "1";
    drawTabs();
    drawGrid();
    box.hidden = false;
    void box.offsetWidth;
    box.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.classList.add("is-active");
  };
  const close = () => {
    box.classList.remove("is-open");
    box.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove("is-active");
  };

  toggle.addEventListener("click", () => {
    if (isOpen()) close(); else open();
    if (matchMedia("(hover: hover)").matches) input.focus();
  });
  tabs.addEventListener("click", (e) => {
    const t = e.target.closest(".emoji-tab");
    if (!t) return;
    cat = +t.dataset.cat;
    drawTabs();
    drawGrid();
    grid.scrollTop = 0;
  });
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".emoji");
    if (!b) return;
    const emoji = b.textContent;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const next = input.value.slice(0, start) + emoji + input.value.slice(end);
    if (next.length > max) return;
    input.value = next;
    input.setSelectionRange(start + emoji.length, start + emoji.length);
    input.dispatchEvent(new Event("input"));
    remember(emoji);
    b.animate([{ transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 250, easing: "ease-out" });
  });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !box.contains(e.target) && !toggle.contains(e.target)) close();
  });

  return { toggle, picker: box, close };
};

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

  if (chatMode === "private" && !chatAdminUid) {
    await sendPrivate(text, name);
    return;
  }

  sendBtn.disabled = true;
  try {
    let ref;
    if (chatAdminUid) {
      ref = await addDoc(messagesRef, {
        name: profileNameNow().slice(0, 60),
        text,
        admin: true,
        uid: chatAdminUid,
        createdAt: serverTimestamp(),
      });
    } else {
      const [device, country] = await Promise.all([detectDevice(), detectCountry()]);
      ref = await addDoc(messagesRef, {
        name,
        text,
        device: device.slice(0, 40),
        country: country.code,
        countryName: country.name,
        createdAt: serverTimestamp(),
      });
    }
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

/* ---------- Admin in the chat ---------- */
const adminNote = el("p", "chat-admin-note");
adminNote.hidden = true;
form.prepend(adminNote);

onAuthStateChanged(getAuth(app), async (u) => {
  chatAdminUid = null;
  if (u && !u.isAnonymous) {
    try { if ((await getDoc(doc(db, "admins", u.uid))).exists()) chatAdminUid = u.uid; } catch { /* not an admin */ }
  }
  form.classList.toggle("is-admin", Boolean(chatAdminUid));
  adminNote.hidden = !chatAdminUid;
  if (chatAdminUid) {
    adminNote.replaceChildren(
      el("span", "", "Sending as "),
      el("strong", "", profileNameNow())
    );
  }
  if (lastMessageDocs.length) renderList(lastMessageDocs);
  // Signed in as the admin: private chats are answered from the dashboard
  const modes = document.getElementById("chatModes");
  if (modes) modes.hidden = Boolean(chatAdminUid);
  if (chatAdminUid && chatMode === "private") setMode("public");
});

/* ---------- Open / close ---------- */
const open = () => {
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("is-open"));
  fab.setAttribute("aria-expanded", "true");
  fab.classList.add("is-active");
  unread = 0;
  if (chatMode === "private") markDmSeen();
  setBadge();
  if (chatMode === "private") dmList.scrollTop = dmList.scrollHeight;
  else scrollToBottom();
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
  if (t.closest && t.closest("#chatToggle, #chatFab, [data-open-chat], .rx-pop")) return;
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
/* ---------- Message reactions (reactions.js) ---------- */
// Community Chat reactions are public; private-chat reactions live inside that private chat.
const rxAuth = getAuth(app);
const rxFs = { collection, doc, query, limit, onSnapshot, setDoc, deleteDoc, serverTimestamp };
const rxMe = () => {
  const u = rxAuth.currentUser;
  if (!u) return null;
  const owner = Boolean(chatAdminUid && u.uid === chatAdminUid);
  return { uid: u.uid, admin: owner, name: owner ? profileNameNow() : (nameInput.value.trim() || "Anonymous") };
};
const rxEnsure = async () => {
  if (rxAuth.authStateReady) await rxAuth.authStateReady();
  if (!rxAuth.currentUser) await signInAnonymously(rxAuth);
  return rxMe();
};
const rxError = (err) => setStatus(err && err.code === "permission-denied"
  ? "Couldn't react: reactions aren't set up yet (Firestore rules)."
  : explainComment(err, "react"));
const makeRx = (path) => (window.createReactions
  ? window.createReactions({ fs: rxFs, db, path, me: rxMe, ensureMe: rxEnsure, onError: rxError })
  : null);
const chatRx = makeRx(["chatReactions"]);
if (chatRx) chatRx.start();
let dmRx = null;
onAuthStateChanged(rxAuth, () => { if (chatRx) chatRx.refresh(); if (dmRx) dmRx.refresh(); });

/* ---------- Private chat with the owner ---------- */
// One conversation per visitor in "dms/{their anonymous sign-in id}". firestore.rules let only
// that visitor and admins read or write it, so nobody else can see these messages.
const dmList = document.getElementById("dmList");
const dmNote = document.getElementById("dmNote");
const dmDot = document.getElementById("dmDot");
const chatSub = document.querySelector(".chat-sub");
const modeBtns = [...document.querySelectorAll("[data-chat-mode]")];
const dmAuth = getAuth(app);
const MAX_DM = 1000;

let chatMode = "public";
let dmDocs = [];
let dmUid = null;
let dmUnsub = null;
let dmLoaded = false;

const dmTime = (d) => {
  const t = d.data({ serverTimestamps: "estimate" }).createdAt;
  return t?.toMillis?.() ?? t?.toDate?.()?.getTime?.() ?? 0;
};
const firstName = () => profileNameNow().split(/\s+/)[0] || "the owner";

const renderDm = () => {
  for (const n of document.querySelectorAll("[data-first-name]")) n.textContent = firstName();
  if (!dmDocs.length) {
    const empty = el("li", "chat-empty dm-empty");
    empty.append(
      el("strong", "", `Message ${firstName()} privately`),
      el("span", "", "Only the two of you can read this conversation. 🔒")
    );
    dmList.replaceChildren(empty);
    return;
  }
  // Same bubbles as the public chat: the owner's replies show their photo
  const docs = dmDocs.map((d) => ({
    id: d.id,
    data: (opts) => {
      const v = d.data(opts);
      const admin = v.from === "admin";
      return { ...v, admin, name: admin ? profileNameNow() : (nameInput.value.trim() || "You") };
    },
  }));
  renderList(docs, dmList, (id, m) => !m.admin, dmRx);
  for (const d of dmDocs) rendered.add(d.id);
};

const markDmSeen = () => {
  const latest = dmDocs.reduce((t, d) => Math.max(t, dmTime(d)), 0);
  if (latest > store.get("dm-seen", 0)) store.set("dm-seen", latest);
  dmUnread = 0;
  dmDot.hidden = true;
  setBadge();
};

const countDmUnread = () => {
  const seen = store.get("dm-seen", 0);
  dmUnread = dmDocs.filter((d) => d.data().from === "admin" && dmTime(d) > seen).length;
  dmDot.hidden = !dmUnread;
  setBadge();
};

const watchDm = (uid) => {
  if (dmUid === uid) return;
  if (dmUnsub) dmUnsub();
  dmUnsub = null;
  dmUid = uid;
  dmDocs = [];
  dmLoaded = false;
  if (dmRx) dmRx.stop();
  dmRx = uid ? makeRx(["dms", uid, "reactions"]) : null;
  if (dmRx) dmRx.start();
  renderDm();
  if (!uid) return;
  dmUnsub = onSnapshot(
    query(collection(db, "dms", uid, "messages"), orderBy("createdAt", "asc"), limit(300)),
    (snap) => {
      const stick = !dmLoaded || dmList.scrollHeight - dmList.scrollTop - dmList.clientHeight < 80;
      dmDocs = snap.docs;
      dmLoaded = true;
      renderDm();
      if (isOpen() && chatMode === "private") markDmSeen();
      else countDmUnread();
      if (stick) dmList.scrollTop = dmList.scrollHeight;
    },
    (err) => {
      console.warn("Private messages not loaded:", err.code || err);
      dmList.replaceChildren(el("li", "chat-empty", err.code === "permission-denied"
        ? "Private messages aren't set up yet (Firestore rules)."
        : "Private messages can't be shown right now."));
    }
  );
};

// Only visitors (anonymous sign-in) have a private chat here; the admin uses the dashboard
onAuthStateChanged(dmAuth, (u) => watchDm(u && u.isAnonymous ? u.uid : null));

const setMode = (mode) => {
  chatMode = mode === "private" ? "private" : "public";
  const priv = chatMode === "private";
  for (const b of modeBtns) {
    const on = b.dataset.chatMode === chatMode;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
  }
  list.hidden = priv;
  dmList.hidden = !priv;
  dmNote.hidden = !priv;
  panel.classList.toggle("is-private", priv);
  if (chatSub) chatSub.textContent = priv ? `Private · only you and ${firstName()}` : "Community Chat · Active now";
  textInput.placeholder = priv ? `Message ${firstName()} privately…` : "Aa";
  textInput.maxLength = priv ? MAX_DM : MAX_TEXT;
  setStatus("");
  store.set("chat-mode", chatMode);
  if (priv) {
    renderDm();
    if (isOpen()) markDmSeen();
    requestAnimationFrame(() => { dmList.scrollTop = dmList.scrollHeight; });
  } else {
    scrollToBottom();
  }
};

for (const b of modeBtns) b.addEventListener("click", () => {
  setMode(b.dataset.chatMode);
  if (window.matchMedia("(hover: hover)").matches) textInput.focus();
});

const sendPrivate = async (text, name) => {
  sendBtn.disabled = true;
  try {
    let u = dmAuth.currentUser;
    if (u && !u.isAnonymous) {
      setStatus("You're signed in as the admin. Reply to private messages from the dashboard.");
      return;
    }
    if (!u) u = (await signInAnonymously(dmAuth)).user;
    watchDm(u.uid);

    const [device, country] = await Promise.all([detectDevice(), detectCountry()]);
    const threadRef = doc(db, "dms", u.uid);
    await addDoc(collection(threadRef, "messages"), { from: "visitor", text: text.slice(0, MAX_DM), createdAt: serverTimestamp() });
    await setDoc(threadRef, {
      name: name || "Anonymous",
      device: device.slice(0, 40),
      country: country.code,
      countryName: country.name,
      lastText: text.slice(0, 120),
      lastFrom: "visitor",
      updatedAt: serverTimestamp(),
    }, { merge: true });

    lastSent = Date.now();
    textInput.value = "";
    autoGrow();
    closePicker();
    setStatus("");
    dmList.scrollTop = dmList.scrollHeight;
  } catch (err) {
    console.error(err);
    setStatus(err.code === "permission-denied"
      ? "Couldn't send: private messages aren't set up yet (Firestore rules)."
      : explainComment(err, "send your message"));
  } finally {
    updateComposer();
    textInput.focus();
  }
};

renderDm();
if (store.get("chat-mode", "public") === "private") setMode("private");

/* ---------- Visitors (who viewed the page) ---------- */
const visitsRef = collection(db, "visits");
const VISITS_PAGE = 20;            // visitors per page

const vBtn = document.getElementById("viewersToggle") || document.createElement("button");   // removed from the page
const vPanel = document.getElementById("viewersPanel") || document.createElement("section");   // removed from the page
const vList = document.getElementById("viewersList") || document.createElement("ol");   // removed from the page
const vTotal = document.getElementById("viewersTotal") || document.createElement("span");   // removed from the page
const vCount = document.getElementById("viewersCount") || document.createElement("span");   // removed from the page
const vLabel = document.getElementById("viewersLabel") || document.createElement("span");   // removed from the page

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

// One-way code of things that stay the same for a device (model, screen, time zone, CPU),
// so the same phone is recognised even in another browser, a private tab or after clearing data
const deviceFingerprint = async (device) => {
  if (!(window.crypto && crypto.subtle)) return "";
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* ignore */ }
  const traits = [device, `${w}x${h}`, Math.round((window.devicePixelRatio || 1) * 100), screen.colorDepth,
    zone, navigator.maxTouchPoints || 0, navigator.hardwareConcurrency || 0].join("|");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VISITOR_SALT + "fp|" + traits));
  return [...new Uint8Array(bytes)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Robots, link previews, automated/headless browsers and local testing aren't visitors
const isNotAVisitor = () =>
  navigator.webdriver === true ||
  /bot|crawl|spider|slurp|headless|lighthouse|preview|externalhit|vercel|pingdom|uptime/i.test(navigator.userAgent) ||
  location.protocol === "file:" ||
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

// Each visitor is one document. To find it, in order:
//  1. the key this browser already used
//  2. a visit with the same device fingerprint (same phone, new browser / private tab / new IP)
//  3. a one-way code of the IP, or a random key if the IP lookup failed (a new visitor)
// A first visit creates the document (the count goes up by one). Every later visit from the
// same device only moves its "last visit" time; it is never counted again.
const VISIT_REFRESH_MS = 5 * 60 * 1000;   // refresh "last visit" at most every 5 minutes
const recordVisit = async () => {
  if (isNotAVisitor()) return;
  if (Date.now() - store.get("visit-last", 0) < VISIT_REFRESH_MS) return;
  try {
    const [device, country] = await Promise.all([detectDevice(), detectCountry()]);
    const fp = await deviceFingerprint(device);

    let key = store.get("visit-key", "");
    if (!key && fp) {
      const same = await getDocs(query(visitsRef, where("fp", "==", fp), limit(1)));
      if (!same.empty) key = same.docs[0].id;
    }
    if (!key) key = (await hashIp(country.ip)) || randomKey();
    const ref = doc(visitsRef, key);

    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, fp ? { lastSeen: serverTimestamp(), fp } : { lastSeen: serverTimestamp() });
    } else {
      await setDoc(ref, {
        device: device.slice(0, 40),
        country: country.code,
        countryName: country.name,
        ...(fp ? { fp } : {}),
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      });
    }

    // IP address: kept in a separate, admin-only collection (the public visitor list never has it)
    if (country.ip) {
      try {
        await setDoc(doc(db, "visitIps", key), { ip: country.ip.slice(0, 45), updatedAt: serverTimestamp() });
      } catch (err) {
        console.warn("Visitor IP not saved:", err.code || err);
      }
    }

    store.set("visit-key", key);
    store.set("visit-last", Date.now());
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

/* ---------- Comments: one thread per post (the pinned post + every dashboard post) ---------- */
// All comments live in the "comments" collection with a "post" field ("pinned" or a post id).
// Each commenter gets a private anonymous Firebase sign-in, so only the browser that wrote a
// comment can edit or delete it; admins can delete any comment (enforced by firestore.rules).
const commentsRef = collection(db, "comments");
const COMMENTS_STEP = 20;
const MAX_COMMENT = 300;
const COMMENT_COOLDOWN_MS = 5000;

const commentAuth = getAuth(app);
let commentUid = null;
let commentAdmin = false;
let lastComment = 0;
const legacyMine = new Set(store.get("comment-mine", []));   // comments posted before sign-in existed
const threads = new Map();   // postId -> thread controller

const ensureCommentUser = async () => commentAuth.currentUser || (await signInAnonymously(commentAuth)).user;

const explainComment = (err, action) => {
  const code = (err && err.code) || "";
  if (code === "auth/configuration-not-found") return "Likes and comments need Firebase Authentication (Authentication → Get started, then turn on Anonymous).";
  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") return "Likes and comments need Anonymous sign-in turned on in Firebase (Authentication → Sign-in method).";
  if (code === "auth/unauthorized-domain") return `Add "${location.hostname}" in Firebase → Authentication → Settings → Authorized domains.`;
  if (code === "auth/operation-not-supported-in-this-environment" || location.protocol === "file:") return "Likes and comments need the page to be opened from a website (http/https), not as a file.";
  if (code === "permission-denied") return `Couldn't ${action}: the Firestore rules don't allow it yet.`;
  return `Couldn't ${action}. Please try again.`;
};

const commentIcon = (paths, cls = "icon") => {
  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("viewBox", "0 0 24 24");
  svgEl.setAttribute("class", cls);
  svgEl.setAttribute("aria-hidden", "true");
  svgEl.innerHTML = paths;   // fixed markup, never user text
  return svgEl;
};

// Builds the comment section markup for one post
const buildCommentSection = (postId) => {
  const section = el("section", "comments");
  section.dataset.comments = postId;
  section.setAttribute("aria-label", "Comments");
  section.hidden = true;

  const head = el("div", "comments-head");
  const title = el("h3", "comments-title", "Comments");
  const badge = el("span", "comments-badge", "0");
  title.append(badge);
  const sort = el("span", "comments-sort");
  sort.append(commentIcon('<path d="M7 4v16M3 16l4 4 4-4M14 6h7M14 11h5M14 16h3"/>'), "Oldest first");
  head.append(title, sort);

  const more = el("button", "comments-more");
  more.type = "button";
  more.hidden = true;
  more.append(commentIcon('<path d="m6 15 6-6 6 6"/>'), "View earlier comments");

  const list = el("ul", "comment-list");
  list.append(el("li", "comment-empty", "Loading comments…"));

  const form = el("form", "comment-form");
  form.autocomplete = "off";
  const me = el("span", "comment-me", "?");
  me.setAttribute("aria-hidden", "true");
  const box = el("div", "comment-box");
  const nameRow = el("label", "comment-name-row");
  const nameInput2 = el("input", "comment-name");
  nameInput2.type = "text";
  nameInput2.maxLength = 24;
  nameInput2.placeholder = "Anonymous";
  nameInput2.autocomplete = "nickname";
  nameRow.append(el("span", "", "Commenting as"), nameInput2, commentIcon('<path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/>', "icon comment-name-pen"));
  const compose = el("div", "comment-compose");
  const text = el("textarea", "comment-text");
  text.rows = 1;
  text.maxLength = MAX_COMMENT;
  text.placeholder = "Write a comment…";
  text.setAttribute("aria-label", "Write a comment");
  const chars = el("span", "comment-count");
  chars.hidden = true;
  const send = el("button", "comment-send");
  send.type = "submit";
  send.disabled = true;
  send.setAttribute("aria-label", "Post comment");
  send.append(commentIcon('<path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2Z"/>', "icon icon-fill"));
  // Emoji picker, the same as the chat's
  const emoji = buildEmojiPicker({ input: text, max: MAX_COMMENT });
  emoji.toggle.classList.add("comment-emoji-btn");
  emoji.picker.classList.add("comment-emoji-picker");
  compose.append(text, emoji.toggle, chars, send);
  box.append(nameRow, emoji.picker, compose);
  form.append(me, box);

  const status = el("p", "comment-status");
  status.setAttribute("role", "status");
  status.hidden = true;

  section.append(head, more, list, form, status);
  return { section, badge, more, list, form, me, nameInput: nameInput2, text, chars, send, status, emoji };
};

/* ---------- Confirmation for destructive actions (same behaviour as the dashboard) ---------- */
// Cancel is the default; Escape and the backdrop cancel; buttons lock while working; it only
// closes once the action really succeeded (errors stay in the dialog).
const confirmDialog = (() => {
  const root = el("div", "confirm-backdrop");
  root.hidden = true;
  const box = el("div", "confirm-box");
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "confirmTitle");
  box.setAttribute("aria-describedby", "confirmDesc");
  const icon = el("span", "confirm-icon");
  icon.append(commentIcon('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>'));
  const title = el("h2", "confirm-title");
  title.id = "confirmTitle";
  const desc = el("p", "confirm-desc");
  desc.id = "confirmDesc";
  const note = el("p", "confirm-note");
  const error = el("p", "confirm-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = el("div", "confirm-actions");
  const cancel = el("button", "confirm-btn confirm-cancel", "Cancel");
  cancel.type = "button";
  const ok = el("button", "confirm-btn confirm-ok");
  ok.type = "button";
  const okLabel = el("span", "", "Delete");
  const spin = el("span", "confirm-spinner");
  spin.setAttribute("aria-hidden", "true");
  ok.append(spin, okLabel);
  actions.append(cancel, ok);
  const text = el("div", "confirm-text");
  text.append(title, desc, note, error);
  const head = el("div", "confirm-head");
  head.append(icon, text);
  box.append(head, actions);
  root.append(box);
  document.body.append(root);

  let job = null;
  let busy = false;
  let opener = null;

  const setBusy = (on) => {
    busy = on;
    ok.disabled = on;
    cancel.disabled = on;
    ok.classList.toggle("is-loading", on);
    okLabel.textContent = on ? "Deleting…" : (job?.confirmLabel || "Delete");
    box.setAttribute("aria-busy", String(on));
  };

  const hide = () => {
    if (busy) return;
    root.classList.remove("is-open");
    root.hidden = true;
    job = null;
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  };

  cancel.addEventListener("click", hide);
  root.addEventListener("click", (e) => { if (e.target === root) hide(); });
  document.addEventListener("keydown", (e) => {
    if (root.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();   // don't also close the dialog underneath
      hide();
    } else if (e.key === "Tab") {
      const f = [cancel, ok].filter((b) => !b.disabled);
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }, true);

  ok.addEventListener("click", async () => {
    if (!job || busy) return;
    const current = job;
    setBusy(true);
    error.hidden = true;
    try {
      await current.onConfirm();
      setBusy(false);
      hide();
      if (current.done && window.showToast) window.showToast(current.done);
    } catch (err) {
      console.error(err);
      setBusy(false);
      error.textContent = current.explain ? current.explain(err) : "Couldn't do that. Please try again.";
      error.hidden = false;
      ok.focus();
    }
  });

  return {
    open: (opts) => {
      job = opts;
      opener = document.activeElement;
      title.textContent = opts.title || "Delete item?";
      desc.textContent = opts.message || "";
      note.textContent = opts.note || "";
      note.hidden = !opts.note;
      error.hidden = true;
      setBusy(false);
      document.body.append(root);   // on top of any other pop-up
      root.hidden = false;
      void root.offsetWidth;
      root.classList.add("is-open");
      cancel.focus({ preventScroll: true });   // the safe choice is the default
    },
  };
})();

/* ---------- Post dialog: comments and "liked by" open in a pop-up ---------- */
// One shared dialog. Clicking outside it (which covers the post's buttons), the X, or Escape closes it.
const postDialog = (() => {
  const root = el("div", "post-dialog");
  root.hidden = true;
  const panel = el("div", "post-dialog-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const closeBtn = el("button", "post-dialog-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.append(commentIcon('<path d="M18 6 6 18M6 6l12 12"/>'));
  const body = el("div", "post-dialog-body");
  panel.append(closeBtn, body);
  root.append(panel);
  document.body.append(root);

  let current = null;   // { key, onClose }
  let returnFocus = null;
  let downOutside = false;

  const hide = () => {
    if (!current) return;
    const c = current;
    current = null;
    root.classList.remove("is-open");
    document.documentElement.classList.remove("has-post-dialog");
    setTimeout(() => { if (!current) { root.hidden = true; body.replaceChildren(); } }, 240);
    c.onClose?.();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  };

  const show = ({ key, label, content, onClose }) => {
    if (current) { const c = current; current = null; c.onClose?.(); }
    else returnFocus = document.activeElement;
    current = { key, onClose };
    panel.setAttribute("aria-label", label);
    body.replaceChildren(content);
    body.scrollTop = 0;
    root.hidden = false;
    document.documentElement.classList.add("has-post-dialog");
    void root.offsetWidth;   // let the opening transition run
    root.classList.add("is-open");
  };

  // Only a press that starts and ends outside the panel closes it (dragging out of a textarea doesn't)
  root.addEventListener("pointerdown", (e) => { downOutside = !panel.contains(e.target); });
  root.addEventListener("click", (e) => {
    if (downOutside && !panel.contains(e.target)) hide();
    downOutside = false;
  });
  closeBtn.addEventListener("click", hide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) { e.preventDefault(); hide(); }
  });

  return { show, hide, body, is: (key) => Boolean(current && current.key === key) };
})();

const createThread = (postId) => {
  const ui = buildCommentSection(postId);
  let docs = [];
  let shown = COMMENTS_STEP;
  let loaded = false;
  let editingId = null;
  let confirmingId = null;
  const seen = new Set();

  const setStatus2 = (t) => { ui.status.textContent = t; ui.status.hidden = !t; };

  // Name (shared with the chat and all other threads)
  const showMe = () => {
    const n = ui.nameInput.value.trim() || "Anonymous";
    ui.me.textContent = [...n][0].toUpperCase();
    ui.me.style.setProperty("--h", hueFor(n));
  };
  ui.nameInput.value = store.get("chat-name", "");
  showMe();
  ui.nameInput.addEventListener("input", showMe);
  ui.nameInput.addEventListener("change", () => {
    const n = ui.nameInput.value.trim().slice(0, MAX_NAME);
    store.set("chat-name", n);
    if (nameInput) nameInput.value = n;
    for (const t of threads.values()) t.syncName(n);
  });

  const isMine = (d, c) => (c.uid && commentUid && c.uid === commentUid) || (!c.uid && legacyMine.has(d.id));
  const canManage = (c) => Boolean(c.uid && commentUid && c.uid === commentUid);

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
    const mineC = isMine(d, c);

    const li = el("li", "comment");
    li.dataset.id = d.id;
    if (mineC) li.classList.add("is-mine");
    if (loaded && !seen.has(d.id)) li.classList.add("is-new");

    const avatar = el("span", "comment-avatar", [...name][0].toUpperCase());
    avatar.style.setProperty("--h", hueFor(name));
    avatar.setAttribute("aria-hidden", "true");

    const body = el("div", "comment-body");
    const bubble = el("div", "comment-bubble");
    const headEl = el("div", "comment-head");
    headEl.append(el("span", "comment-author", name));
    if (mineC) headEl.append(el("span", "viewer-you", "You"));
    if (c.device || c.country) {
      const chip = el("span", "comment-device");
      if (c.device) chip.append(commentIcon(DEVICE_ICONS[deviceKind(c.device)]), el("span", "", c.device));
      if (c.country) chip.append(el("span", "comment-flag", NO_FLAGS ? c.country : flag(c.country)));
      if (c.countryName) chip.title = c.countryName;
      headEl.append(chip);
    }
    bubble.append(headEl);

    if (editingId === d.id) {
      const editor = el("textarea", "comment-edit");
      editor.value = c.text;
      editor.maxLength = MAX_COMMENT;
      editor.rows = 2;
      editor.dataset.id = d.id;
      editor.setAttribute("aria-label", "Edit your comment");
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
      else if (commentAdmin) meta.append(actionBtn("Delete", "delete", d.id));
      else if (mineC && !c.uid) {
        const note = el("span", "comment-edited", "Posted before editing was added");
        note.title = "Older comments have no owner ID, so they can't be edited or deleted from the site.";
        meta.append(note);
      }
    }

    body.append(bubble, meta);
    li.append(avatar, body);
    return li;
  };

  const showCount = () => {
    const n = docs.length;
    ui.badge.textContent = n.toLocaleString();
    for (const b of document.querySelectorAll(`[data-comment-count="${CSS.escape(postId)}"]`)) {
      b.hidden = !n;
      b.textContent = `${n.toLocaleString()} ${n === 1 ? "comment" : "comments"}`;
    }
  };

  const render = () => {
    const visible = docs.slice(Math.max(0, docs.length - shown));   // newest N, oldest first
    if (!docs.length) {
      const empty = el("li", "comment-empty");
      empty.append(
        commentIcon('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.3 9.3 0 0 1-3.6-.7L3 21l1.6-4.6A8 8 0 0 1 3 11.5 8.6 8.6 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5Z"/>', "icon comment-empty-icon"),
        el("strong", "", "No comments yet"),
        el("span", "", "Be the first to say something nice 💚")
      );
      ui.list.replaceChildren(empty);
    } else {
      ui.list.replaceChildren(...visible.map(renderComment));
    }
    for (const d of visible) seen.add(d.id);
    ui.more.hidden = docs.length <= shown;
    showCount();
  };

  const find = (id) => docs.find((d) => d.id === id);

  // Live comments for this post (sorted on the device, so no extra Firestore index is needed)
  onSnapshot(
    query(commentsRef, where("post", "==", postId)),
    (snap) => {
      docs = snap.docs.slice().sort((a, b) => {
        const ta = a.data({ serverTimestamps: "estimate" }).createdAt?.toMillis?.() ?? a.data({ serverTimestamps: "estimate" }).createdAt?.toDate?.().getTime() ?? 0;
        const tb = b.data({ serverTimestamps: "estimate" }).createdAt?.toMillis?.() ?? b.data({ serverTimestamps: "estimate" }).createdAt?.toDate?.().getTime() ?? 0;
        return ta - tb;
      });
      if (editingId && !find(editingId)) editingId = null;
      render();
      loaded = true;
    },
    (err) => {
      console.error(err);
      ui.list.replaceChildren(el("li", "comment-empty",
        err.code === "permission-denied" ? "Comments aren't set up yet (Firestore rules)." : "Comments can't be shown right now."));
    }
  );

  ui.more.addEventListener("click", () => { shown += COMMENTS_STEP; render(); });

  const saveEdit = async (id) => {
    const editor = ui.list.querySelector(`.comment-edit[data-id="${CSS.escape(id)}"]`);
    if (!editor) return;
    const t = editor.value.replace(/\s+\n/g, "\n").trim().slice(0, MAX_COMMENT);
    const current = find(id);
    if (!t) { setStatus2("A comment can't be empty. Use Delete to remove it."); return; }
    if (current && t === current.data().text) { editingId = null; render(); return; }
    editor.disabled = true;
    try {
      await ensureCommentUser();
      await updateDoc(doc(commentsRef, id), { text: t, editedAt: serverTimestamp() });
      editingId = null;
      setStatus2("");
    } catch (err) {
      console.error(err);
      editor.disabled = false;
      setStatus2(explainComment(err, "save your edit"));
    }
  };

  ui.list.addEventListener("click", async (e) => {
    const b = e.target.closest(".comment-action");
    if (!b) return;
    const { action, id } = b.dataset;
    const d = find(id);
    if (action === "reply" && d) {
      const mention = `@${d.data().name || "Anonymous"} `;
      if (!ui.text.value.startsWith(mention)) ui.text.value = mention + ui.text.value;
      ui.text.dispatchEvent(new Event("input"));
      ui.text.focus();
      ui.text.setSelectionRange(ui.text.value.length, ui.text.value.length);
      ui.form.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (action === "edit") { editingId = id; confirmingId = null; render(); return; }
    if (action === "delete" && d) {
      const cd = d.data();
      const own = canManage(cd);
      editingId = null;
      render();
      confirmDialog.open({
        title: "Delete comment?",
        message: own
          ? `Your comment “${String(cd.text || "").slice(0, 60)}${String(cd.text || "").length > 60 ? "…" : ""}” will be removed for everyone.`
          : `${cd.name || "Anonymous"}'s comment will be removed for everyone.`,
        note: "This can't be undone.",
        done: "Comment deleted",
        explain: (err) => explainComment(err, "delete the comment"),
        onConfirm: async () => {
          await ensureCommentUser();
          await deleteDoc(doc(commentsRef, id));
        },
      });
      return;
    }
    if (action === "cancel") { editingId = null; confirmingId = null; setStatus2(""); render(); return; }
    if (action === "save") { saveEdit(id); return; }
    if (action === "delete-yes") {
      b.disabled = true;
      try {
        await ensureCommentUser();
        await deleteDoc(doc(commentsRef, id));
        confirmingId = null;
        setStatus2("");
      } catch (err) {
        console.error(err);
        b.disabled = false;
        setStatus2(explainComment(err, "delete the comment"));
      }
    }
  });

  ui.list.addEventListener("keydown", (e) => {
    const editor = e.target.closest(".comment-edit");
    if (!editor) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(editor.dataset.id); }
    if (e.key === "Escape") { e.stopPropagation(); editingId = null; render(); }
  });

  // Composer
  const grow = () => {
    ui.text.style.height = "auto";
    ui.text.style.height = `${Math.min(ui.text.scrollHeight, 120)}px`;
    ui.send.disabled = !ui.text.value.trim();
    const left = MAX_COMMENT - ui.text.value.length;
    ui.chars.hidden = left > 50;
    ui.chars.textContent = String(left);
    ui.chars.classList.toggle("is-low", left <= 10);
  };
  ui.text.addEventListener("input", grow);
  ui.text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ui.form.requestSubmit(); }
  });

  ui.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = ui.text.value.replace(/\s+\n/g, "\n").trim().slice(0, MAX_COMMENT);
    if (!t) return;
    const wait = COMMENT_COOLDOWN_MS - (Date.now() - lastComment);
    if (wait > 0) { setStatus2(`Please wait ${Math.ceil(wait / 1000)}s before commenting again.`); return; }

    const name = ui.nameInput.value.trim().slice(0, MAX_NAME);
    store.set("chat-name", name);
    if (nameInput) nameInput.value = name;

    ui.send.disabled = true;
    try {
      const [u, device, country] = await Promise.all([ensureCommentUser(), detectDevice(), detectCountry()]);
      await addDoc(commentsRef, {
        post: postId,
        uid: u.uid,
        name,
        text: t,
        device: device.slice(0, 40),
        country: country.code,
        countryName: country.name,
        createdAt: serverTimestamp(),
      });
      lastComment = Date.now();
      ui.emoji.close();
      ui.text.value = "";
      setStatus2("");
    } catch (err) {
      console.error(err);
      setStatus2(explainComment(err, "post your comment"));
    } finally {
      grow();
    }
  });

  return {
    section: ui.section,
    render,
    syncName: (n) => { ui.nameInput.value = n; showMe(); },
    open: (focus) => {
      const mark = (on) => {
        for (const b of document.querySelectorAll(`[data-comment-btn="${CSS.escape(postId)}"]`)) {
          b.setAttribute("aria-expanded", String(on));
          b.classList.toggle("is-active", on);
        }
      };
      ui.section.hidden = false;
      ui.section.classList.add("is-open");
      postDialog.show({
        key: `comments:${postId}`,
        label: "Comments",
        content: ui.section,
        onClose: () => { mark(false); ui.emoji.close(); editingId = null; confirmingId = null; setStatus2(""); },
      });
      mark(true);
      render();
      // Newest comments are at the bottom, next to the comment box
      postDialog.body.scrollTop = postDialog.body.scrollHeight;
      if (focus && !matchMedia("(pointer: coarse)").matches) ui.text.focus({ preventScroll: true });
    },
    close: () => { if (postDialog.is(`comments:${postId}`)) postDialog.hide(); },
    isOpen: () => postDialog.is(`comments:${postId}`),
  };
};

// One thread per post, kept across re-renders of the posts feed
const commentThread = (postId) => {
  if (!threads.has(postId)) threads.set(postId, createThread(postId));
  return threads.get(postId);
};

// The Comment button and the "N comments" link open the thread in the dialog (or close it if open)
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-comment-btn], [data-comment-count]");
  if (!btn || btn.closest(".post-dialog")) return;
  const t = commentThread(btn.dataset.commentBtn || btn.dataset.commentCount);
  if (t.isOpen()) t.close();
  else t.open(btn.hasAttribute("data-comment-btn"));
});

// Signed in? (anonymous for visitors, email for admins)
onAuthStateChanged(commentAuth, async (u) => {
  commentUid = u ? u.uid : null;
  commentAdmin = false;
  if (u && !u.isAnonymous) {
    try { commentAdmin = (await getDoc(doc(db, "admins", u.uid))).exists(); } catch { commentAdmin = false; }
  }
  for (const t of threads.values()) t.render();
});

// The chat's name box keeps the comment boxes in sync
if (nameInput) nameInput.addEventListener("change", () => {
  for (const t of threads.values()) t.syncName(nameInput.value.trim());
});

// Pinned post thread (shown in the dialog, so its old in-page slot isn't needed)
document.querySelector('[data-comments-slot="pinned"]')?.remove();
commentThread("pinned").render();

/* ---------- Likes: one per device, saved in Firestore ---------- */
// Each browser gets an invisible anonymous sign-in (no account). A like is the document
// "likes/{postId}_{that id}", so a device can like a post once and un-like it again.
const likesRef = collection(db, "likes");
const likeAuth = getAuth(app);
let likeUid = likeAuth.currentUser ? likeAuth.currentUser.uid : null;
const likeState = new Map();   // postId -> { docs: [], unsub }

const HEART_PATH = "M12 20.5s-7.5-4.6-9.6-9.2C.9 7.9 3 4 6.8 4c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3-2.1 4.6-9.6 9.2-9.6 9.2Z";

const likeId = (postId, uid) => `${postId}_${uid}`;

const renderLikes = (postId) => {
  const st = likeState.get(postId);
  const docs = st ? st.docs : [];
  const count = docs.length;
  const mine = Boolean(likeUid && docs.some((d) => d.data().uid === likeUid));

  for (const btn of document.querySelectorAll(`[data-like-btn="${CSS.escape(postId)}"]`)) {
    btn.setAttribute("aria-pressed", String(mine));
    btn.setAttribute("aria-label", mine ? "Unlike" : "Like");
  }

  for (const stats of document.querySelectorAll(`[data-like-stats="${CSS.escape(postId)}"]`)) {
    stats.replaceChildren();
    stats.removeAttribute("title");
    stats.classList.toggle("is-clickable", count > 0);
    if (!count) {
      stats.removeAttribute("role");
      stats.removeAttribute("tabindex");
      stats.removeAttribute("aria-label");
      continue;
    }
    // Anyone can open the list of who liked it
    stats.setAttribute("role", "button");
    stats.tabIndex = 0;
    stats.setAttribute("aria-label", "See who liked this");

    const dot = el("span", "like-dot");
    dot.innerHTML = `<svg class="icon icon-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;   // fixed markup
    const others = count - (mine ? 1 : 0);
    const text = mine
      ? (others ? `You and ${others.toLocaleString()} ${others === 1 ? "other" : "others"}` : "You liked this")
      : `${count.toLocaleString()} ${count === 1 ? "like" : "likes"}`;
    stats.append(dot, text);

    stats.title = "See who liked this";
  }

  if (postDialog.is(`likes:${postId}`)) fillLikers(postId);
};

// "Liked by" list in the dialog
const likers = (() => {
  const wrap = el("section", "likers");
  const head = el("div", "comments-head");
  const title = el("h3", "comments-title", "Liked by");
  const badge = el("span", "comments-badge", "0");
  title.append(badge);
  head.append(title);
  const list = el("ul", "liker-list");
  wrap.append(head, list);
  return { wrap, badge, list };
})();

// Device name -> brand, type and logo (for the "Liked by" list)
const BRAND_LOGOS = {
  apple: '<path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4 1-1.4 1.4-2.7 1.4-2.8 0 0-2.5-1-2.5-4.1ZM14 5.3c.7-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3Z"/>',
  windows: '<path d="M3 5.6 10.4 4.6v7H3zM11.4 4.4 21 3v8.6h-9.6zM3 12.4h7.4v7.1L3 18.4zM11.4 12.4H21V21l-9.6-1.4z"/>',
  android: '<path d="M17.5 9.6 19.3 6.5a.6.6 0 0 0-1.1-.6l-1.8 3.2a11 11 0 0 0-8.8 0L5.8 5.9a.6.6 0 0 0-1.1.6l1.8 3.1A10.4 10.4 0 0 0 1.2 18h21.6a10.4 10.4 0 0 0-5.3-8.4ZM7.2 15.1a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm9.6 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z"/>',
  chrome: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.6"/><path d="M12 8.4h8.6M8.9 13.8 4.6 6.3M15.1 13.8l-4.3 7.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  linux: '<path d="M12 2.5c-2.2 0-3.6 1.8-3.6 4.4 0 1.5.3 2.3-.6 3.6-1.2 1.6-2.6 3.6-2.6 6 0 .6.1 1.1.3 1.6-.9.4-1.8 1-1.4 1.9.5 1 2.4.6 3.6 1.4.9.6 1.6.6 2.2.1.6-.4 1.4-.6 2.1-.6s1.5.2 2.1.6c.6.5 1.3.5 2.2-.1 1.2-.8 3.1-.4 3.6-1.4.4-.9-.5-1.5-1.4-1.9.2-.5.3-1 .3-1.6 0-2.4-1.4-4.4-2.6-6-.9-1.3-.6-2.1-.6-3.6 0-2.6-1.4-4.4-3.6-4.4Zm-1.5 4a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Zm3 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6ZM12 9.2l1.6.9-1.6 1-1.6-1Z"/>',
};

const deviceInfo = (device = "") => {
  const d = device.trim() || "Unknown device";
  if (/^iPhone/i.test(d)) return { name: d, brand: "Apple", type: "Phone · iOS", logo: "apple", tone: "apple" };
  if (/^iPad/i.test(d)) return { name: d, brand: "Apple", type: "Tablet · iPadOS", logo: "apple", tone: "apple" };
  if (/^Mac/i.test(d)) return { name: d, brand: "Apple", type: "Computer · macOS", logo: "apple", tone: "apple" };
  if (/Windows/i.test(d)) return { name: d, brand: "Microsoft", type: "Computer · Windows", logo: "windows", tone: "windows" };
  if (/Chromebook/i.test(d)) return { name: d, brand: "Google", type: "Laptop · ChromeOS", logo: "chrome", tone: "google" };
  if (/Linux/i.test(d)) return { name: d, brand: "Linux", type: "Computer", logo: "linux", tone: "plain" };
  if (/^Unknown/i.test(d)) return { name: d, brand: "Unknown brand", type: "Device", logo: null, tone: "plain" };
  if (/^Android/i.test(d)) return { name: d, brand: "Android", type: "Phone · Android", logo: "android", tone: "android" };
  // Android phones are saved as "Brand Model" (e.g. "Samsung SM-A515F")
  const known = BRANDS.map(([, b]) => b).find((b) => d.toLowerCase().startsWith(b.toLowerCase()));
  const brand = known || d.split(/\s+/)[0];
  const tone = { Samsung: "samsung", Google: "google", Xiaomi: "xiaomi", OPPO: "oppo", vivo: "vivo", realme: "realme", Huawei: "huawei" }[brand] || "android";
  return { name: d, brand, type: "Phone · Android", logo: "android", tone };
};

const fillLikers = (postId) => {
  const st = likeState.get(postId);
  const docs = (st ? st.docs : []).slice().sort((a, b) => {
    const t = (d) => d.data({ serverTimestamps: "estimate" }).createdAt?.toDate?.()?.getTime?.() || 0;
    return t(b) - t(a);   // newest first
  });
  likers.badge.textContent = docs.length.toLocaleString();
  if (!docs.length) {
    likers.list.replaceChildren(el("li", "comment-empty", "No likes yet."));
    return;
  }
  likers.list.replaceChildren(...docs.map((d) => {
    const v = d.data({ serverTimestamps: "estimate" });
    const info = deviceInfo(v.device);
    const date = v.createdAt?.toDate?.();
    const li = el("li", "liker");

    // Brand logo tile, with the device type in the corner and a heart badge
    const icon = el("span", `liker-icon tone-${info.tone}`);
    icon.title = `${info.brand} · ${info.type}`;
    icon.append(info.logo
      ? commentIcon(BRAND_LOGOS[info.logo], "icon icon-fill liker-logo")
      : commentIcon(DEVICE_ICONS[deviceKind(info.name)], "icon liker-logo"));
    const kind = el("span", "liker-kind");
    kind.append(commentIcon(DEVICE_ICONS[deviceKind(info.name)]));
    const heart = el("span", "liker-heart");
    heart.append(commentIcon(`<path d="${HEART_PATH}"/>`, "icon icon-fill"));
    icon.append(kind, heart);

    const text = el("span", "liker-text");
    const name = el("span", "liker-name");
    name.append(el("span", "liker-device", info.name));
    if (likeUid && v.uid === likeUid) name.append(el("span", "viewer-you", "You"));
    const sub = el("span", "liker-sub");
    sub.append(el("strong", "", info.brand), ` · ${info.type}`);
    text.append(name, sub);

    const when = el("time", "liker-time", relTime(date));
    if (date) { when.dateTime = date.toISOString(); when.title = date.toLocaleString(); }
    li.append(icon, text, when);
    return li;
  }));
};

const openLikers = (postId) => {
  fillLikers(postId);
  postDialog.show({ key: `likes:${postId}`, label: "Liked by", content: likers.wrap });
};

document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-like-stats].is-clickable");
  if (s) openLikers(s.dataset.likeStats);
});
document.addEventListener("keydown", (e) => {
  const s = e.target.closest?.("[data-like-stats].is-clickable");
  if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openLikers(s.dataset.likeStats); }
});

// Start listening to a post's likes (once per post)
const watchLikes = (postId) => {
  if (likeState.has(postId)) { renderLikes(postId); return; }
  const st = { docs: [], unsub: null };
  likeState.set(postId, st);
  st.unsub = onSnapshot(
    query(likesRef, where("post", "==", postId)),
    (snap) => { st.docs = snap.docs; renderLikes(postId); },
    (err) => {
      console.warn("Likes not loaded:", err.code || err);
      window.showToast?.(explainComment(err, "load likes"));
    }
  );
};

onAuthStateChanged(likeAuth, (u) => {
  likeUid = u ? u.uid : null;
  for (const id of likeState.keys()) renderLikes(id);
});

const likeBusy = new Set();
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-like-btn]");
  if (!btn) return;
  const postId = btn.dataset.likeBtn;
  if (likeBusy.has(postId)) return;
  likeBusy.add(postId);

  const wasLiked = btn.getAttribute("aria-pressed") === "true";
  // Show it straight away; the live listener confirms it
  btn.setAttribute("aria-pressed", String(!wasLiked));
  if (!wasLiked) {
    const r = btn.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent("hearts:burst", {
      detail: { x: r.left + r.width / 2, y: r.top + r.height / 2, count: 10, speed: 3 },
    }));
  }

  try {
    const u = likeAuth.currentUser || (await signInAnonymously(likeAuth)).user;
    likeUid = u.uid;
    const ref = doc(likesRef, likeId(postId, u.uid));
    if (wasLiked) {
      await deleteDoc(ref);
    } else {
      const device = await detectDevice();
      await setDoc(ref, { post: postId, uid: u.uid, device: device.slice(0, 40), createdAt: serverTimestamp() });
    }
  } catch (err) {
    console.error(err);
    btn.setAttribute("aria-pressed", String(wasLiked));
    renderLikes(postId);
    window.showToast?.(explainComment(err, wasLiked ? "remove your like" : "save your like"));
  } finally {
    likeBusy.delete(postId);
  }
});

watchLikes("pinned");

/* ---------- Visitor posts: anyone can post; the admin approves them first ---------- */
// Saved in "submissions" as "pending". Only approved ones are shown (firestore.rules agree).
const submissionsRef = collection(db, "submissions");
const MAX_POST = 1000;
const POST_COOLDOWN_MS = 60 * 1000;

const composer = (() => {
  const wrap = el("section", "composer-sheet");
  wrap.setAttribute("aria-label", "Create post");

  const head = el("div", "comments-head");
  head.append(el("h3", "comments-title", "Create post"));
  const note = el("p", "composer-note");
  note.append(commentIcon('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
    el("span", "", "Posts are reviewed before they appear on the page."));

  const form = el("form", "composer-form");
  form.noValidate = true;
  form.autocomplete = "off";

  // Name (required)
  const nameField = el("label", "composer-field");
  const nameLabel = el("span", "composer-label", "Name");
  nameLabel.append(el("span", "composer-req", " *"));
  const nameIn = el("input", "composer-input");
  nameIn.type = "text";
  nameIn.maxLength = MAX_NAME;
  nameIn.required = true;
  nameIn.placeholder = "Your name";
  nameIn.autocomplete = "nickname";
  nameField.append(nameLabel, nameIn);

  // Caption (required) with the emoji picker
  const capField = el("div", "composer-field");
  const capLabel = el("label", "composer-label", "Caption");
  capLabel.append(el("span", "composer-req", " *"));
  capLabel.htmlFor = "composerCaption";
  const capBox = el("div", "composer-caption");
  const cap = el("textarea", "composer-textarea");
  cap.id = "composerCaption";
  cap.rows = 4;
  cap.maxLength = MAX_POST;
  cap.required = true;
  cap.placeholder = "What's on your mind?";
  const emoji = buildEmojiPicker({ input: cap, max: MAX_POST });
  emoji.picker.classList.add("composer-emoji-picker");
  const capFoot = el("div", "composer-caption-foot");
  const count = el("span", "composer-count", `0 / ${MAX_POST}`);
  capFoot.append(emoji.toggle, count);
  capBox.append(cap, capFoot);
  capField.append(capLabel, emoji.picker, capBox);

  const status = el("p", "comment-status composer-status");
  status.setAttribute("role", "status");
  status.hidden = true;

  const submit = el("button", "btn btn-primary composer-submit");
  submit.type = "submit";
  submit.append(commentIcon('<path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2Z"/>', "icon icon-fill"), el("span", "", "Submit for review"));
  form.append(nameField, capField, status, submit);

  // "Sent" state
  const done = el("div", "composer-done");
  done.hidden = true;
  const doneIcon = el("span", "composer-done-icon");
  doneIcon.append(commentIcon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'));
  const doneTitle = el("h4", "", "Sent for review");
  const doneText = el("p", "");
  const doneBtn = el("button", "btn btn-secondary", "Close");
  doneBtn.type = "button";
  done.append(doneIcon, doneTitle, doneText, doneBtn);

  wrap.append(head, note, form, done);

  const setStatus = (t) => { status.textContent = t; status.hidden = !t; };
  const showCount = () => {
    count.textContent = `${cap.value.length} / ${MAX_POST}`;
    count.classList.toggle("is-low", MAX_POST - cap.value.length <= 50);
  };
  const grow = () => {
    cap.style.height = "auto";
    cap.style.height = `${Math.min(Math.max(cap.scrollHeight, 104), 260)}px`;
  };
  cap.addEventListener("input", () => { showCount(); grow(); cap.removeAttribute("aria-invalid"); setStatus(""); });
  nameIn.addEventListener("input", () => { nameIn.removeAttribute("aria-invalid"); setStatus(""); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameIn.value.trim().slice(0, MAX_NAME);
    const text = cap.value.replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_POST);
    if (!name) { nameIn.setAttribute("aria-invalid", "true"); setStatus("Please enter your name."); nameIn.focus(); return; }
    if (!text) { cap.setAttribute("aria-invalid", "true"); setStatus("Please write a caption."); cap.focus(); return; }
    const wait = POST_COOLDOWN_MS - (Date.now() - store.get("post-last", 0));
    if (wait > 0) { setStatus(`Please wait ${Math.ceil(wait / 1000)}s before posting again.`); return; }

    submit.disabled = true;
    setStatus("");
    try {
      const [u, device, country] = await Promise.all([ensureCommentUser(), detectDevice(), detectCountry()]);
      await addDoc(submissionsRef, {
        name,
        text,
        uid: u.uid,
        device: device.slice(0, 40),
        country: country.code,
        countryName: country.name,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      store.set("post-last", Date.now());
      store.set("chat-name", name);
      emoji.close();
      cap.value = "";
      showCount();
      grow();
      const first = (siteProfile.name || "").split(/\s+/)[0] || "the owner";
      doneText.textContent = `Thanks, ${name}! Your post will show on the page once ${first} approves it.`;
      form.hidden = true;
      note.hidden = true;
      done.hidden = false;
      doneBtn.focus({ preventScroll: true });
    } catch (err) {
      console.error(err);
      setStatus(explainComment(err, "send your post"));
    } finally {
      submit.disabled = false;
    }
  });

  doneBtn.addEventListener("click", () => postDialog.hide());

  const open = () => {
    form.hidden = false;
    note.hidden = false;
    done.hidden = true;
    setStatus("");
    if (!nameIn.value) nameIn.value = store.get("chat-name", "");
    showCount();
    postDialog.show({ key: "composer", label: "Create post", content: wrap, onClose: () => emoji.close() });
    grow();
    if (!matchMedia("(pointer: coarse)").matches) (nameIn.value ? cap : nameIn).focus({ preventScroll: true });
  };

  return { open };
})();

// "Create post" card on the page
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-open-composer]")) composer.open();
});
{
  const me = document.getElementById("composerMe");
  const showMe = () => {
    if (!me) return;
    const n = store.get("chat-name", "") || "?";
    me.textContent = [...n][0].toUpperCase();
    me.style.setProperty("--h", hueFor(n));
  };
  showMe();
  window.addEventListener("storage", showMe);
  document.addEventListener("change", (e) => { if (e.target.matches?.(".composer-input, .chat-name, .comment-name")) setTimeout(showMe); });
}

/* ---------- Profile + posts managed from the admin dashboard ---------- */
const DEFAULT_PROFILE = {
  name: "Perry Philip Lozano",
  role: "",
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
  setText("[data-role]", role);
  setText(".bio p", bio);
  setText(".bio cite", bioRef);
  setText("#chatTitle", `Chat with ${first}`);

  const pinned = document.querySelector(".post:not(.dyn-post) .post-text");
  if (pinned) pinned.textContent = bioRef ? `${bio} — ${bioRef}` : bio;

  // No role set: hide its spots (the Intro line too)
  for (const n of document.querySelectorAll("[data-role]")) (n.closest(".intro-list li") || n).hidden = !role;

  // Remember it, so the next visit shows the right text straight away
  store.set("site-profile", { name, role, bio, bioRef });
};

onSnapshot(
  doc(db, "site", "profile"),
  (snap) => applyProfile(snap.exists() ? snap.data() : {}),
  (err) => {
    console.warn("Profile not loaded:", err.code || err);
    applyProfile(store.get("site-profile", {}));
  }
);

// Posts (newest first) above the pinned post
const postsFeed = document.getElementById("postsFeed");
const postDate = (date) => {
  if (!date) return "Just now";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }) +
    " at " + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const renderPost = (d, kind = "admin") => {
  const p = d.data({ serverTimestamps: "estimate" });
  const date = p.createdAt?.toDate?.();

  const visitor = kind === "community";
  const article = el("article", `card post dyn-post${visitor ? " is-community" : ""}`);
  const head = el("header", "post-head");
  let avatar;
  if (visitor) {
    // Visitor posts: a letter avatar in the name's colour
    const n = p.name || "Anonymous";
    avatar = el("span", "post-avatar post-avatar-letter", [...n][0].toUpperCase());
    avatar.style.setProperty("--h", hueFor(n));
    avatar.setAttribute("aria-hidden", "true");
  } else {
    avatar = el("img", "post-avatar");
    avatar.src = document.querySelector(".profile-avatar")?.getAttribute("src") || "img/ppl.jpg";
    avatar.alt = "";
    avatar.width = 40;
    avatar.height = 40;
  }
  const who = el("div");
  const meta = el("p", "post-meta");
  const time = el("time", "", relTime(date) === "now" ? "Just now" : postDate(date));
  if (date) { time.dateTime = date.toISOString(); time.title = date.toLocaleString(); }
  meta.append(time);
  if (visitor) {
    const tag = el("span", "post-tag");
    tag.append(commentIcon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'), el("span", "", "Community"));
    meta.append(" · ", tag);
  }
  who.append(el("p", "post-author", visitor ? (p.name || "Anonymous") : siteProfile.name), meta);
  head.append(avatar, who);

  article.append(head, el("p", "post-text", p.text));

  // Likes (one per device) for this post
  const stats = el("div", "post-stats");
  const likes = el("span", "post-likes");
  likes.dataset.likeStats = d.id;
  const commentCount = el("button", "post-comment-count");
  commentCount.type = "button";
  commentCount.dataset.commentCount = d.id;
  commentCount.hidden = true;
  stats.append(likes, commentCount);
  const actions = el("div", "post-actions");
  const like = el("button", "post-action");
  like.type = "button";
  like.dataset.likeBtn = d.id;
  like.setAttribute("aria-pressed", "false");
  like.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;   // fixed markup
  like.append(" Like");
  const comment = el("button", "post-action");
  comment.type = "button";
  comment.dataset.commentBtn = d.id;
  comment.setAttribute("aria-expanded", "false");
  comment.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.3 9.3 0 0 1-3.6-.7L3 21l1.6-4.6A8 8 0 0 1 3 11.5 8.6 8.6 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5Z"/></svg>';   // fixed markup
  comment.append(" Comment");
  actions.append(like, comment);

  // This post's comment thread (kept alive across re-renders; it opens in the dialog)
  const thread = commentThread(d.id);
  article.append(stats, actions);
  queueMicrotask(() => { watchLikes(d.id); thread.render(); });
  return article;
};

if (postsFeed) {
  let adminPosts = [];
  let visitorPosts = [];
  const stamp = (d) => {
    const ts = d.data({ serverTimestamps: "estimate" }).createdAt;
    return ts?.toMillis?.() ?? ts?.toDate?.()?.getTime?.() ?? 0;
  };
  const drawFeed = () => {
    const items = [
      ...adminPosts.map((d) => ({ d, kind: "admin" })),
      ...visitorPosts.map((d) => ({ d, kind: "community" })),
    ].sort((a, b) => stamp(b.d) - stamp(a.d));
    postsFeed.replaceChildren(...items.map(({ d, kind }) => renderPost(d, kind)));
  };

  onSnapshot(
    query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(20)),
    (snap) => { adminPosts = snap.docs; drawFeed(); },
    (err) => console.warn("Posts not loaded:", err.code || err)
  );

  // Only approved visitor posts (sorted here, so no extra Firestore index is needed)
  onSnapshot(
    query(submissionsRef, where("status", "==", "approved"), limit(50)),
    (snap) => { visitorPosts = snap.docs; drawFeed(); },
    (err) => console.warn("Visitor posts not loaded:", err.code || err)
  );
}

// Pinned post: the admin can unpin it. Unpinned, it loses the "Pinned" label and
// sits below the other posts (it has no date, so it counts as the oldest).
{
  const pinnedPost = document.getElementById("pinnedPost");
  if (pinnedPost && postsFeed) {
    onSnapshot(
      doc(db, "site", "pinned"),
      (snap) => {
        const pinned = !snap.exists() || snap.data().pinned !== false;
        pinnedPost.classList.toggle("is-unpinned", !pinned);
        pinnedPost.setAttribute("aria-label", pinned ? "Pinned post" : "Post");
        if (pinned) postsFeed.before(pinnedPost);
        else postsFeed.after(pinnedPost);
      },
      (err) => console.warn("Pinned setting not loaded:", err.code || err)
    );
  }
}

})();
