/* ---------- All visitors page (Firebase Firestore) ---------- */
// Classic script so it also works when opened straight from disk; Firebase loads from Google's CDN.
(async () => {
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

const rows = document.getElementById("rows");
const range = document.getElementById("range");
const pageInfo = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");

const showMessage = (text) => {
  rows.replaceChildren();
  const tr = document.createElement("tr");
  tr.className = "row-empty";
  const td = document.createElement("td");
  td.colSpan = 5;
  td.textContent = text;
  tr.append(td);
  rows.append(tr);
};

let fs;
try {
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  fs = await import(`${SDK}/firebase-firestore.js`);
  initializeApp({
    apiKey: "AIzaSyDMOzTwiSR-SoC_GBDrgO1p0QykN4V_K34",
    authDomain: "chat-6bd7a.firebaseapp.com",
    projectId: "chat-6bd7a",
    storageBucket: "chat-6bd7a.firebasestorage.app",
    messagingSenderId: "756417357830",
    appId: "1:756417357830:web:84fa2f52b38ed0ec53bb87",
    measurementId: "G-6LYPQCZM7H",
  });
} catch (err) {
  console.error(err);
  showMessage("Couldn't load visitors. Check your connection.");
  return;
}

const { getFirestore, collection, query, orderBy, limit, startAfter, getDocs, getCountFromServer, where, Timestamp } = fs;
const db = getFirestore();
const visitsRef = collection(db, "visits");

const PAGE = 25;

/* ---------- Helpers ---------- */
const NO_FLAGS = /Windows/.test(navigator.userAgent);
const flag = (code) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";

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

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;   // textContent: never HTML
  return node;
};

const ago = (date) => {
  if (!date) return "";
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return "";
};

const fullDate = (date) =>
  date ? date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

const timeCell = (date) => {
  const td = el("td", "cell-time");
  td.append(el("span", "time-main", fullDate(date)));
  const rel = ago(date);
  if (rel) td.append(el("span", "time-rel", rel));
  return td;
};

/* ---------- Summary ---------- */
let total = null;

const countUp = (node, to) => {
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / 900, 1);
    node.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

const startOfToday = Timestamp.fromDate(new Date(new Date().setHours(0, 0, 0, 0)));

const loadStats = async () => {
  try {
    const [all, active, fresh] = await Promise.all([
      getCountFromServer(visitsRef),
      getCountFromServer(query(visitsRef, where("lastSeen", ">=", startOfToday))),
      getCountFromServer(query(visitsRef, where("createdAt", ">=", startOfToday))),
    ]);
    total = all.data().count;
    countUp(document.getElementById("statTotal"), total);
    countUp(document.getElementById("statActive"), active.data().count);
    countUp(document.getElementById("statNew"), fresh.data().count);
    updatePager();
  } catch (err) {
    console.error(err);
  }
};

/* ---------- Pages (cursor based) ---------- */
let page = 0;
const pageStarts = [null];   // cursor to start each page after (null = from the top)
let lastDocOfPage = null;
let pageSize = 0;

const totalPages = () => (total === null ? null : Math.max(1, Math.ceil(total / PAGE)));

const updatePager = () => {
  const pages = totalPages();
  pageInfo.textContent = pages ? `Page ${page + 1} of ${pages}` : `Page ${page + 1}`;
  prevBtn.disabled = page === 0;
  nextBtn.disabled = pageSize < PAGE || (pages !== null && page + 1 >= pages);
  if (pageSize) {
    const from = page * PAGE + 1;
    const to = page * PAGE + pageSize;
    range.textContent = total !== null ? `${from}–${to} of ${total.toLocaleString()}` : `${from}–${to}`;
  } else {
    range.textContent = "";
  }
};

const renderRows = (docs) => {
  rows.replaceChildren(...docs.map((d, i) => {
    const v = d.data();
    const tr = el("tr");

    tr.append(el("td", "col-num", String(page * PAGE + i + 1)));

    const device = el("td", "cell-device");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("class", "device-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = DEVICE_ICONS[deviceKind(v.device)];   // fixed markup, never user text
    const wrap = el("div", "device-wrap");
    wrap.append(icon, el("span", "device-name", v.device || "Unknown device"));
    device.append(wrap);
    tr.append(device);

    const country = el("td", "cell-country");
    if (v.country) {
      country.append(NO_FLAGS ? el("span", "country-code", v.country) : el("span", "country-flag", flag(v.country)));
      country.append(el("span", "country-name", v.countryName || v.country));
    } else {
      country.textContent = "—";
    }
    tr.append(country);

    const first = timeCell(v.createdAt?.toDate?.());
    first.dataset.label = "First visit";
    const last = timeCell(v.lastSeen?.toDate?.());
    last.dataset.label = "Last visit";
    tr.append(first, last);
    return tr;
  }));

  const phones = docs.filter((d) => deviceKind(d.data().device) === "phone").length;
  document.getElementById("statPhones").textContent = docs.length ? `${Math.round((phones / docs.length) * 100)}%` : "–";
};

const loadPage = async (n) => {
  prevBtn.disabled = nextBtn.disabled = true;
  try {
    const parts = [orderBy("lastSeen", "desc")];
    if (pageStarts[n]) parts.push(startAfter(pageStarts[n]));
    parts.push(limit(PAGE));
    const snap = await getDocs(query(visitsRef, ...parts));

    if (!snap.docs.length && n > 0) {   // ran past the end
      updatePager();
      return;
    }

    page = n;
    pageSize = snap.docs.length;
    lastDocOfPage = snap.docs[snap.docs.length - 1] || null;
    pageStarts[n + 1] = lastDocOfPage;

    if (!snap.docs.length) showMessage("No visitors recorded yet.");
    else renderRows(snap.docs);
    updatePager();
    if (n > 0) document.querySelector(".card").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    showMessage(err.code === "permission-denied"
      ? "Visitors aren't set up yet (Firestore rules)."
      : "Couldn't load visitors.");
  }
};

prevBtn.addEventListener("click", () => { if (page > 0) loadPage(page - 1); });
nextBtn.addEventListener("click", () => loadPage(page + 1));

loadStats();
loadPage(0);
})();
