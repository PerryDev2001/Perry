/* ---------- Admin dashboard ---------- */
// Only signed-in admins (a document in the "admins" collection) get past the gate.
// firestore.rules enforce the same check on every admin action.
(async () => {
const SDK = window.FIREBASE_SDK;
const gate = document.getElementById("gate");
const dash = document.getElementById("dash");

const toLogin = (reason) => location.replace(`login.html${reason ? `?${reason}=1` : ""}`);

let A, F;
try {
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  A = await import(`${SDK}/firebase-auth.js`);
  F = await import(`${SDK}/firebase-firestore.js`);
  initializeApp(window.FIREBASE_CONFIG);
} catch (err) {
  console.error(err);
  gate.querySelector("p").textContent = "Couldn't load the dashboard. Check your connection.";
  return;
}

const auth = A.getAuth();
const db = F.getFirestore();
const {
  collection, doc, getDoc, setDoc, addDoc, deleteDoc, query, orderBy, limit, startAfter,
  getDocs, onSnapshot, serverTimestamp, getCountFromServer, where, updateDoc, writeBatch,
} = F;

/* ---------- Helpers ---------- */
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;   // textContent: never HTML
  return node;
};

const svg = (paths, cls = "icon") => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = paths;   // fixed markup, never user text
  return s;
};

const TRASH = '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>';

const NO_FLAGS = /Windows/.test(navigator.userAgent);
const flag = (code) =>
  /^[A-Z]{2}$/.test(code || "") ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
const place = (code, name) => (code ? (NO_FLAGS ? `${code}${name ? ` · ${name}` : ""}` : `${flag(code)} ${name || code}`) : "");

const ago = (date) => {
  if (!date) return "just now";
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const fullDate = (date) =>
  date ? date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

const shortDate = (date) =>
  date ? date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—";

const initialAvatar = (name) => {
  const a = el("span", "avatar", [...(name || "A")][0].toUpperCase());
  a.setAttribute("aria-hidden", "true");
  return a;
};

const photoAvatar = () => {
  const a = el("span", "avatar");
  const img = el("img");
  img.src = "img/ppl.jpg";
  img.alt = "";
  a.append(img);
  a.setAttribute("aria-hidden", "true");
  return a;
};

const setMessage = (node, text, kind = "error") => {
  node.textContent = text;
  node.dataset.kind = kind;
  node.hidden = !text;
};

const errText = (err, action) =>
  err && err.code === "permission-denied"
    ? `Couldn't ${action}: the Firestore rules don't allow it. Publish the latest rules.`
    : `Couldn't ${action}. Please try again.`;

// Short preview of a text for confirmation messages
const snippet = (text, n = 60) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/* ---------- Notifications ---------- */
const toast = (() => {
  const node = document.getElementById("toast");
  let timer = 0;
  return (text, kind = "ok") => {
    node.textContent = text;
    node.dataset.kind = kind;
    node.hidden = false;
    requestAnimationFrame(() => node.classList.add("is-shown"));
    clearTimeout(timer);
    timer = setTimeout(() => {
      node.classList.remove("is-shown");
      setTimeout(() => { if (!node.classList.contains("is-shown")) node.hidden = true; }, 250);
    }, 2600);
  };
})();

window.showToast = (text) => toast(text);

/* ---------- Delete confirmation ---------- */
// Every delete goes through this dialog: it says exactly what will be removed, Cancel is the
// default, Escape/backdrop cancel, buttons lock while deleting, and it only closes when the
// delete really succeeded (errors stay in the dialog).
const confirmDelete = (() => {
  const dialog = document.getElementById("confirmDialog");
  const titleEl = document.getElementById("confirmTitle");
  const descEl = document.getElementById("confirmDesc");
  const noteEl = document.getElementById("confirmNote");
  const errorEl = document.getElementById("confirmError");
  const cancelBtn = document.getElementById("confirmCancel");
  const okBtn = document.getElementById("confirmOk");
  const okLabel = document.getElementById("confirmOkLabel");
  let job = null;
  let busy = false;
  let opener = null;

  const setBusy = (on) => {
    busy = on;
    okBtn.disabled = on;
    cancelBtn.disabled = on;
    okBtn.classList.toggle("is-loading", on);
    okLabel.textContent = on ? "Deleting…" : (job?.confirmLabel || "Delete");
    dialog.setAttribute("aria-busy", String(on));
  };

  const close = () => { if (!busy) dialog.close(); };
  cancelBtn.addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });            // Escape
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });        // backdrop
  dialog.addEventListener("close", () => {
    job = null;
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  });

  okBtn.addEventListener("click", async () => {
    if (!job || busy) return;
    const current = job;
    setBusy(true);
    errorEl.hidden = true;
    try {
      await current.onConfirm();
      setBusy(false);
      dialog.close();
      toast(current.done || "Deleted");
    } catch (err) {
      console.error(err);
      setBusy(false);
      errorEl.textContent = errText(err, "delete it");
      errorEl.hidden = false;
      okBtn.focus();
    }
  });

  return (opts) => {
    job = opts;
    opener = opts.opener || document.activeElement;
    titleEl.textContent = opts.title || "Delete item?";
    descEl.textContent = opts.message || "This can't be undone.";
    noteEl.textContent = opts.note || "";
    noteEl.hidden = !opts.note;
    errorEl.hidden = true;
    setBusy(false);
    if (!dialog.open) dialog.showModal();
    cancelBtn.focus();   // the safe choice is the default
  };
})();

// Delete button: subtle red, opens the confirmation (never deletes on the first click)
const deleteButton = ({
  onConfirm, iconOnly = false, className = "",
  title = "Delete item?", message = "This can't be undone.", note = "", confirmLabel = "Delete", done = "Deleted",
}) => {
  const b = el("button", `btn btn-sm ${iconOnly ? "btn-icon btn-delete-icon" : "btn-delete"} ${className}`.trim());
  b.type = "button";
  const label = title.replace(/\?$/, "");
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(svg(TRASH));
  if (!iconOnly) b.append(el("span", "", "Delete"));
  b.addEventListener("click", () => confirmDelete({ onConfirm, title, message, note, confirmLabel, done, opener: b }));
  return b;
};

/* ---------- Admin gate ---------- */
const user = await new Promise((resolve) => {
  const stop = A.onAuthStateChanged(auth, (u) => { stop(); resolve(u); });
});

if (!user || user.isAnonymous) { toLogin(); return; }

try {
  const adminDoc = await getDoc(doc(db, "admins", user.uid));
  if (!adminDoc.exists()) {
    await A.signOut(auth);
    toLogin("denied");
    return;
  }
} catch (err) {
  console.error(err);
  gate.querySelector("p").textContent = "Couldn't check admin access. Publish the latest Firestore rules, then reload.";
  return;
}

gate.hidden = true;
dash.hidden = false;
document.getElementById("whoami").textContent = user.email || "Signed in";

A.onAuthStateChanged(auth, (u) => { if (!u) toLogin(); });
document.getElementById("signOut").addEventListener("click", async () => {
  await A.signOut(auth);
  toLogin();
});

/* ---------- Theme ---------- */
document.getElementById("themeBtn").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("calling-card-theme", next); } catch { /* ignore */ }
});

/* ---------- Mobile drawer ---------- */
const menuBtn = document.getElementById("menuBtn");
const overlay = document.getElementById("sidebarOverlay");
const openMenu = () => {
  dash.classList.add("is-menu-open");
  overlay.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
};
const closeMenu = () => {
  dash.classList.remove("is-menu-open");
  menuBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => { if (!dash.classList.contains("is-menu-open")) overlay.hidden = true; }, 250);
};
menuBtn.addEventListener("click", openMenu);
overlay.addEventListener("click", closeMenu);
document.getElementById("sidebarClose").addEventListener("click", closeMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

/* ---------- Tabs (#overview, #posts, …) ---------- */
const TITLES = { overview: "Overview", posts: "Posts", messages: "Messages", inbox: "Private messages", submissions: "Anonymous posts", comments: "Comments", visitors: "Visitors", profile: "Profile" };
const loaded = new Set();

const showTab = () => {
  const name = TITLES[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
  for (const a of document.querySelectorAll("[data-tab]")) {
    const on = a.dataset.tab === name;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.getElementById("crumb").textContent = TITLES[name];
  document.title = `${TITLES[name]} — Dashboard`;
  closeMenu();
  if (!loaded.has(name)) {
    loaded.add(name);
    loaders[name]?.();
  }
  if (name === "messages") chat.scrollToEnd();
  window.scrollTo({ top: 0 });
};

/* ---------- Generic paged list ---------- */
const pagedList = ({ name, listEl, moreBtn, order, pageSize = 25, render, emptyText, emptyTag = "li" }) => {
  const ref = collection(db, name);
  let last = null;
  let count = 0;

  const load = async () => {
    moreBtn.disabled = true;
    try {
      const parts = [orderBy(order, "desc")];
      if (last) parts.push(startAfter(last));
      parts.push(limit(pageSize));
      const snap = await getDocs(query(ref, ...parts));
      if (!last) listEl.replaceChildren();
      if (!snap.docs.length && !count) listEl.append(el(emptyTag, `empty${emptyTag === "div" ? " pad" : ""}`, emptyText));
      for (const d of snap.docs) listEl.append(render(d));
      count += snap.docs.length;
      last = snap.docs[snap.docs.length - 1] || last;
      moreBtn.hidden = snap.docs.length < pageSize;
    } catch (err) {
      console.error(err);
      listEl.replaceChildren(el(emptyTag, `empty${emptyTag === "div" ? " pad" : ""}`, errText(err, `load ${name}`)));
    } finally {
      moreBtn.disabled = false;
    }
  };

  moreBtn.addEventListener("click", load);
  return load;
};

const removeRow = (row) => {
  row.classList.add("is-removed");
  setTimeout(() => row.remove(), 250);
};

const listRow = (d, { title, sub, body, time, avatar, del = {} }) => {
  const li = el("li", "row");
  li.append(avatar || initialAvatar(title));
  const main = el("div", "row-main");
  const head = el("div", "row-head");
  head.append(el("strong", "", title));
  if (sub) head.append(el("span", "muted", sub));
  main.append(head);
  if (body) main.append(el("p", "row-body", body));
  main.append(el("span", "row-time", time));
  li.append(main);
  const actions = el("div", "row-actions");
  actions.append(deleteButton({ ...del, onConfirm: async () => { await deleteDoc(d.ref); removeRow(li); } }));
  li.append(actions);
  return li;
};

/* ---------- Overview ---------- */
const countInto = async (name, id) => {
  const node = document.getElementById(id);
  try {
    const snap = await getCountFromServer(collection(db, name));
    node.textContent = snap.data().count.toLocaleString();
  } catch {
    node.textContent = "—";
  }
};

const miniItem = (d) => {
  const v = d.data();
  const li = el("li", "mini");
  li.append(v.admin ? photoAvatar() : initialAvatar(v.name || "Anonymous"));
  const main = el("div", "mini-main");
  main.append(el("strong", "", v.name || "Anonymous"), el("span", "muted", v.text || ""));
  li.append(main, el("span", "row-time", ago(v.createdAt?.toDate?.())));
  return li;
};

const miniInto = async (name, id) => {
  const listEl = document.getElementById(id);
  try {
    const snap = await getDocs(query(collection(db, name), orderBy("createdAt", "desc"), limit(5)));
    listEl.replaceChildren(...(snap.docs.length ? snap.docs.map(miniItem) : [el("li", "empty", "Nothing yet.")]));
  } catch (err) {
    listEl.replaceChildren(el("li", "empty", errText(err, "load")));
  }
};

/* ---------- Messages: live chat ---------- */
/* ---------- Sending helpers (outbox.js) ---------- */
// A refused write whose message is already saved (an earlier try got through) counts as sent
const alreadySaved = async (ref, err) => {
  if (!err || err.code !== "permission-denied") return false;
  try { return (await getDoc(ref)).exists(); } catch { return false; }
};
const failNote = (err) => (err && err.code === "permission-denied"
  ? "A message wasn't sent: Firebase refused it. Check the Firestore rules, then tap Retry."
  : "A message wasn't sent. Check your connection and tap Retry.");

// "Sending…" or "Not sent · Retry · Remove" under a message
const statusLine = (id, status) => {
  const line = el("div", "t-status");
  if (status === "failed") {
    line.append(el("span", "t-status-text", "Not sent"));
    const retry = el("button", "t-status-btn", "Retry");
    retry.type = "button";
    retry.dataset.retry = id;
    const remove = el("button", "t-status-btn", "Remove");
    remove.type = "button";
    remove.dataset.discard = id;
    line.append(retry, remove);
  } else {
    line.append(el("span", "t-status-text", "Sending…"));
  }
  return line;
};
// Messages in the order they were sent (confirmed, sending and failed ones together)
const sentAt = (d) => {
  if (d.outbox) return d.outbox.at;
  const t = d.data({ serverTimestamps: "estimate" }).createdAt;
  return (t && t.toMillis && t.toMillis()) || (t && t.toDate && t.toDate().getTime()) || 0;
};
const statusOf = (d) => (d.outbox
  ? (d.outbox.status === "failed" ? "failed" : "sending")
  : (d.metadata && d.metadata.hasPendingWrites ? "sending" : ""));

/* ---------- Replies (quote a specific message) ---------- */
// The reply bar above a send box; the quote is saved with the message
const makeReplyBar = (form, input, scrollEl) => {
  const bar = el("div", "reply-bar");
  bar.hidden = true;
  const icon = el("span", "reply-bar-icon");
  icon.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';   // fixed markup
  const textBox = el("div", "reply-bar-text");
  const who = el("strong", "reply-bar-who");
  const snippet = el("span", "reply-bar-snippet");
  textBox.append(who, snippet);
  const close = el("button", "btn btn-ghost btn-icon btn-sm reply-bar-close");
  close.type = "button";
  close.setAttribute("aria-label", "Cancel reply");
  close.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';   // fixed markup
  bar.append(icon, textBox, close);
  form.before(bar);

  let target = null;
  const clear = () => { target = null; bar.hidden = true; };
  close.addEventListener("click", () => { clear(); input.focus(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && target) { e.stopPropagation(); clear(); } });
  return {
    set: (t) => {
      target = t;
      who.textContent = `Replying to ${t.name}`;
      snippet.textContent = t.text;
      // Keep the newest messages in view while the bar takes some room
      const stick = scrollEl && scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
      bar.hidden = false;
      if (stick) scrollEl.scrollTop = scrollEl.scrollHeight;
      input.focus();
    },
    quote: () => (target ? {
      id: String(target.id).slice(0, 40),
      name: String(target.name === "yourself" ? "" : target.name || "").slice(0, 60),
      text: String(target.text || "").slice(0, 140),
      uid: String(target.uid || "").slice(0, 128),
    } : null),
    clear,
  };
};

// "X replied to Y" + the quoted message (tap it to jump to the original)
const replyQuote = (m, { own, senderName, senderUid }) => {
  const r = m.replyTo;
  const mine = Boolean(r.uid) && (r.uid === user.uid || r.uid === "admin");
  const toSelf = Boolean(r.uid) && r.uid === senderUid;
  const who = own ? "You" : senderName;
  const whom = toSelf ? (own ? "yourself" : "themselves") : mine ? "you" : (r.name || "a message");
  const wrap = el("div", "msg-reply");
  const label = el("span", "msg-reply-label");
  label.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';   // fixed markup
  label.append(` ${who} replied to ${whom}`);
  const quote = el("button", "msg-quote", r.text);
  quote.type = "button";
  quote.dataset.jump = r.id;
  quote.title = "Show the original message";
  wrap.append(label, quote);
  return wrap;
};

const jumpTo = (listEl, id) => {
  const target = listEl.querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!target) { toast("The original message isn't loaded here", "error"); return; }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("is-flash");
  void target.offsetWidth;
  target.classList.add("is-flash");
  setTimeout(() => target.classList.remove("is-flash"), 1400);
};

/* ---------- Message reactions (shared with the public page: reactions.js) ---------- */
const rxFs = { collection, doc, query, limit, onSnapshot, setDoc, deleteDoc, serverTimestamp };
const rxMe = () => ({ uid: user.uid, name: profileName, admin: true });
const makeRx = (path, onError) => (window.createReactions
  ? window.createReactions({ fs: rxFs, db, path, me: rxMe, ensureMe: async () => rxMe(), onError })
  : null);

const chat = (() => {
  const scrollEl = document.getElementById("chatScroll");
  const thread = document.getElementById("chatThread");
  const moreBtn = document.getElementById("chatMore");
  const countEl = document.getElementById("chatCount");
  const form = document.getElementById("adminChatForm");
  const input = document.getElementById("adminChatInput");
  const send = document.getElementById("adminChatSend");
  const msg = document.getElementById("adminChatMessage");
  const navBadge = document.getElementById("navMessages");
  const ref = collection(db, "messages");
  const PAGE = 60;
  const GAP = 10 * 60 * 1000;

  let live = [];
  let older = [];
  let hasOlder = false;
  let started = false;
  let seen = null;   // ids seen while the tab was open
  let chatRx = null;
  let outbox = null;

  const nearBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  const scrollToEnd = () => requestAnimationFrame(() => { scrollEl.scrollTop = scrollEl.scrollHeight; });

  const stamp = (date) => {
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return time;
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  };

  const isMine = (m) => Boolean(m.admin && m.uid === user.uid);
  const key = (m) => (m.admin ? `admin:${m.uid}` : `${m.name}|${m.device}|${m.country}`);

  const render = () => {
    const live1 = new Set(live.map((d) => d.id));
    const docs = [...older.filter((d) => !live1.has(d.id)).slice().reverse(), ...live.slice().reverse()];
    // Your messages still on their way
    if (outbox) {
      const ids = new Set(docs.map((d) => d.id));
      for (const m of outbox.list()) {
        if (ids.has(m.id)) continue;
        docs.push({ id: m.id, ref: null, outbox: m, data: () => ({ name: profileName, text: m.text, admin: true, uid: user.uid, replyTo: m.meta.replyTo || null, createdAt: { toDate: () => new Date(m.at) } }) });
      }
      docs.sort((x, y) => sentAt(x) - sentAt(y));
    }
    if (!docs.length) {
      thread.replaceChildren(el("li", "empty center", "No messages yet."));
      moreBtn.hidden = true;
      return;
    }
    const items = [];
    let prev = null;
    docs.forEach((d, i) => {
      const m = d.data({ serverTimestamps: "estimate" });
      const date = m.createdAt?.toDate?.() || new Date();
      if (!prev || date - prev.date >= GAP || prev.date.toDateString() !== date.toDateString()) {
        items.push(el("li", "t-time", stamp(date)));
      }
      const next = docs[i + 1]?.data({ serverTimestamps: "estimate" });
      const nextDate = next?.createdAt?.toDate?.() || new Date();
      const first = !prev || prev.key !== key(m) || date - prev.date >= GAP;
      const last = !next || key(next) !== key(m) || nextDate - date >= GAP;

      const li = el("li", "t-msg");
      li.dataset.mid = d.id;
      if (isMine(m)) li.classList.add("is-mine");
      if (m.admin) li.classList.add("is-admin");
      if (!first) li.classList.add("is-cont");
      if (last) li.classList.add("is-last");

      li.append(m.admin ? photoAvatar() : initialAvatar(m.name || "Anonymous"));

      const body = el("div", "t-body");
      if (first) {
        const meta = el("div", "t-meta");
        meta.append(el("strong", "", m.admin ? (m.name || profileName) : (m.name || "Anonymous")));
        const where = [m.device, place(m.country, m.countryName)].filter(Boolean).join(" · ");
        if (where) meta.append(el("span", "", where));
        body.append(meta);
      }
      if (m.replyTo && m.replyTo.text) {
        body.append(replyQuote(m, { own: isMine(m), senderName: m.admin ? (m.name || profileName) : (m.name || "Anonymous"), senderUid: m.uid || "" }));
      }
      const row = el("div", "t-bubble-row");
      const text = el("p", "t-text", m.text);
      text.title = fullDate(date);
      const status = statusOf(d);
      if (status) {
        li.classList.add(status === "failed" ? "is-failed" : "is-pending");
        row.append(text);
      } else {
        row.append(text, deleteButton({
          iconOnly: true,
          className: "t-del",
          title: "Delete message?",
          message: `“${snippet(m.text)}” from ${m.admin ? "you" : (m.name || "Anonymous")} will be removed from the Community Chat for everyone.`,
          note: "This can't be undone.",
          done: "Message deleted",
          onConfirm: async () => { await deleteDoc(d.ref); },
        }));
      }
      body.append(row);
      if (status) body.append(statusLine(d.id, status));
      li.append(body);
      if (chatRx && !status) {
        const senderName = isMine(m) ? "yourself" : (m.admin ? (m.name || profileName) : (m.name || "Anonymous"));
        chatRx.decorate(li, body, d.id, {
          who: senderName,
          copyText: m.text,
          onReply: () => reply.set({ id: d.id, name: senderName, text: m.text, uid: m.uid || "" }),
        });
      }
      items.push(li);
      prev = { date, key: key(m) };
    });
    thread.replaceChildren(...items);
    moreBtn.hidden = !hasOlder;
  };

  const refreshCount = () =>
    getCountFromServer(ref).then((s) => { countEl.textContent = `${s.data().count.toLocaleString()} messages`; }).catch(() => {});

  const start = () => {
    if (started) return;
    started = true;
    chatRx = makeRx(["chatReactions"], (err) => setMessage(msg, errText(err, "react")));
    if (chatRx) chatRx.start();
    onSnapshot(
      query(ref, orderBy("createdAt", "desc"), limit(PAGE)),
      { includeMetadataChanges: true },
      (snap) => {
        const stick = nearBottom() || !live.length;
        live = snap.docs;
        if (!older.length) hasOlder = snap.docs.length === PAGE;
        const gone = new Set(snap.docChanges().filter((c) => c.type === "removed").map((c) => c.doc.id));
        if (gone.size) older = older.filter((d) => !gone.has(d.id));

        // Unread badge in the sidebar while you're on another tab
        const onTab = !document.querySelector('[data-panel="messages"]').hidden;
        if (seen === null || onTab) seen = new Set(live.map((d) => d.id));
        const fresh = live.filter((d) => !seen.has(d.id) && !isMine(d.data())).length;
        navBadge.hidden = !fresh;
        navBadge.textContent = fresh > 9 ? "9+" : String(fresh);

        render();
        refreshCount();
        if (stick) scrollToEnd();
      },
      (err) => thread.replaceChildren(el("li", "empty center", errText(err, "load messages")))
    );
  };

  moreBtn.addEventListener("click", async () => {
    const oldest = (older.length ? older : live).at(-1);
    if (!oldest) return;
    moreBtn.disabled = true;
    const before = scrollEl.scrollHeight;
    try {
      const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), startAfter(oldest), limit(PAGE)));
      older = older.concat(snap.docs);
      hasOlder = snap.docs.length === PAGE;
      render();
      scrollEl.scrollTop += scrollEl.scrollHeight - before;   // keep your place
    } catch (err) {
      console.error(err);
    } finally {
      moreBtn.disabled = false;
    }
  });

  // Composer: sends as the admin profile
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    send.disabled = !input.value.trim();
  };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  // Sending: instant, in order, retryable (outbox.js)
  outbox = window.createOutbox ? window.createOutbox({
    key: "admin-community",
    maxLength: 500,
    newId: () => doc(ref).id,
    onChange: () => {
      render();
      scrollToEnd();
      const failed = outbox.list().find((m) => m.status === "failed");
      if (failed) setMessage(msg, failNote(failed.error));
    },
    write: async (id, text, meta) => {
      const mref = doc(ref, id);
      try {
        await setDoc(mref, {
          name: profileName.slice(0, 60), text, admin: true, uid: user.uid,
          ...(meta && meta.replyTo ? { replyTo: meta.replyTo } : {}),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        if (await alreadySaved(mref, err)) return;
        throw err;
      }
    },
  }) : null;

  const reply = makeReplyBar(form, input, scrollEl);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!outbox) return;
    const res = outbox.send(input.value, { replyTo: reply.quote() });
    if (!res.ok) {
      const why = window.outboxRefusal(res);
      if (why) setMessage(msg, why);
      return;   // keep what you typed
    }
    reply.clear();
    input.value = "";
    grow();
    setMessage(msg, navigator.onLine ? "" : "You're offline. Your message will send when you're back online.");
    scrollToEnd();
    input.focus();
  });

  thread.addEventListener("click", (e) => {
    const q = e.target.closest("[data-jump]");
    if (q) { jumpTo(thread, q.dataset.jump); return; }
    const retry = e.target.closest("[data-retry]");
    const remove = e.target.closest("[data-discard]");
    if (!outbox || (!retry && !remove)) return;
    if (retry) outbox.retry(retry.dataset.retry);
    else outbox.discard(remove.dataset.discard);
    setMessage(msg, "");
  });

  return {
    start,
    scrollToEnd,
    markSeen: () => { seen = new Set(live.map((d) => d.id)); navBadge.hidden = true; },
  };
})();

/* ---------- Private messages (one conversation per visitor) ---------- */
const inbox = (() => {
  const card = document.getElementById("dmCard");
  const listEl = document.getElementById("dmThreadList");
  const countEl = document.getElementById("dmThreadCount");
  const placeholder = document.getElementById("dmPlaceholder");
  const openEl = document.getElementById("dmOpen");
  const headAvatar = document.getElementById("dmHeadAvatar");
  const headName = document.getElementById("dmHeadName");
  const headSub = document.getElementById("dmHeadSub");
  const headActions = document.getElementById("dmHeadActions");
  const scrollEl = document.getElementById("dmScroll");
  const threadEl = document.getElementById("dmThread");
  const form = document.getElementById("dmForm");
  const input = document.getElementById("dmInput");
  const send = document.getElementById("dmSend");
  const msg = document.getElementById("dmMessage");
  const navBadge = document.getElementById("navInbox");
  const GAP = 10 * 60 * 1000;

  let threads = [];
  let openId = null;
  let unsubMsgs = null;
  let started = false;
  let dmRx = null;
  let lastMsgDocs = [];
  let outbox = null;
  const lastAlert = new Map();   // conversation id -> time of the last message we alerted about
  let primed = false;

  // A visitor wrote: sound, tab title count, system notification (in the background), notice
  const alertAdmin = (id, v) => {
    const who = v.name || "Anonymous";
    if (window.Notify) {
      window.Notify.ping();
      window.Notify.system({
        title: `New private message from ${who}`,
        body: v.lastText || "",
        tag: `dm-${id}`,
        onClick: () => { location.hash = "#inbox"; open(id); },
      });
    }
    if (document.visibilityState === "visible") toast(`New private message from ${who}`, "msg");
  };

  // "Turn on" notifications (asked once, only when the browser hasn't decided yet)
  const notifyBar = document.getElementById("dmNotifyBar");
  const syncNotify = () => { notifyBar.hidden = !window.Notify || window.Notify.permission() !== "default"; };
  document.getElementById("dmNotify").addEventListener("click", async () => {
    const result = window.Notify ? await window.Notify.ask() : "unsupported";
    syncNotify();
    toast(result === "granted" ? "Notifications are on" : "Notifications are off in this browser", result === "granted" ? "ok" : "error");
  });
  syncNotify();

  const ms = (t) => t?.toDate?.()?.getTime?.() || 0;
  const isUnread = (v) => v.lastFrom === "visitor" && ms(v.updatedAt) > ms(v.adminReadAt);
  const onTab = () => !document.querySelector('[data-panel="inbox"]').hidden;
  const scrollToEnd = () => requestAnimationFrame(() => { scrollEl.scrollTop = scrollEl.scrollHeight; });

  const stamp = (date) => {
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return date.toDateString() === new Date().toDateString()
      ? time
      : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  };

  const markRead = (id) => {
    const t = threads.find((d) => d.id === id);
    if (t && isUnread(t.data())) updateDoc(t.ref, { adminReadAt: serverTimestamp() }).catch((err) => console.warn(err));
  };

  const renderThreads = () => {
    const unread = threads.filter((d) => isUnread(d.data())).length;
    navBadge.hidden = !unread;
    navBadge.textContent = unread > 9 ? "9+" : String(unread);
    if (window.Notify) window.Notify.setCount(unread);
    countEl.textContent = threads.length ? `${threads.length}${unread ? ` · ${unread} unread` : ""}` : "";

    if (!threads.length) {
      listEl.replaceChildren(el("li", "empty pad", "No private messages yet. Visitors can start one from the chat on your page."));
      return;
    }
    listEl.replaceChildren(...threads.map((d) => {
      const v = d.data({ serverTimestamps: "estimate" });
      const li = el("li");
      const b = el("button", "dm-thread");
      b.type = "button";
      if (d.id === openId) b.classList.add("is-active");
      if (isUnread(v)) b.classList.add("is-unread");
      const main = el("span", "dm-thread-main");
      const top = el("span", "dm-thread-top");
      top.append(el("strong", "", v.name || "Anonymous"), el("span", "row-time", ago(v.updatedAt?.toDate?.())));
      main.append(top, el("span", "dm-thread-last", `${v.lastFrom === "admin" ? "You: " : ""}${v.lastText || ""}`));
      b.append(initialAvatar(v.name || "Anonymous"), main);
      if (isUnread(v)) b.append(el("span", "dm-unread-dot"));
      b.addEventListener("click", () => open(d.id));
      li.append(b);
      return li;
    }));
  };

  const renderMessages = (serverDocs, v) => {
    // Your replies still on their way (for this conversation)
    const ids = new Set(serverDocs.map((d) => d.id));
    const docs = [...serverDocs, ...(outbox ? outbox.list() : [])
      .filter((m) => m.meta.thread === openId && !ids.has(m.id))
      .map((m) => ({ id: m.id, outbox: m, data: () => ({ from: "admin", text: m.text, replyTo: m.meta.replyTo || null, createdAt: { toDate: () => new Date(m.at) } }) }))]
      .sort((x, y) => sentAt(x) - sentAt(y));
    if (!docs.length) {
      threadEl.replaceChildren(el("li", "empty center", "No messages in this conversation."));
      return;
    }
    const items = [];
    let prev = null;
    docs.forEach((d, i) => {
      const m = d.data({ serverTimestamps: "estimate" });
      const date = m.createdAt?.toDate?.() || new Date();
      if (!prev || date - prev.date >= GAP || prev.date.toDateString() !== date.toDateString()) {
        items.push(el("li", "t-time", stamp(date)));
      }
      const next = docs[i + 1]?.data({ serverTimestamps: "estimate" });
      const nextDate = next?.createdAt?.toDate?.() || new Date();
      const first = !prev || prev.from !== m.from || date - prev.date >= GAP;
      const last = !next || next.from !== m.from || nextDate - date >= GAP;
      const mineMsg = m.from === "admin";

      const li = el("li", "t-msg");
      li.dataset.mid = d.id;
      if (mineMsg) li.classList.add("is-mine", "is-admin");
      if (!first) li.classList.add("is-cont");
      if (last) li.classList.add("is-last");
      li.append(mineMsg ? photoAvatar() : initialAvatar(v.name || "Anonymous"));
      const body = el("div", "t-body");
      if (first) {
        const meta = el("div", "t-meta");
        meta.append(el("strong", "", mineMsg ? profileName : (v.name || "Anonymous")));
        body.append(meta);
      }
      if (m.replyTo && m.replyTo.text) {
        body.append(replyQuote(m, { own: mineMsg, senderName: v.name || "Anonymous", senderUid: mineMsg ? "admin" : openId }));
      }
      const row = el("div", "t-bubble-row");
      const text = el("p", "t-text", m.text);
      text.title = fullDate(date);
      row.append(text);
      body.append(row);
      const status = statusOf(d);
      if (status) {
        li.classList.add(status === "failed" ? "is-failed" : "is-pending");
        body.append(statusLine(d.id, status));
      }
      li.append(body);
      if (dmRx && !status) {
        const senderName = mineMsg ? "yourself" : (v.name || "Anonymous");
        dmRx.decorate(li, body, d.id, {
          who: senderName,
          copyText: m.text,
          onReply: () => reply.set({ id: d.id, name: senderName, text: m.text, uid: mineMsg ? "admin" : openId }),
        });
      }
      items.push(li);
      prev = { date, from: m.from };
    });
    threadEl.replaceChildren(...items);
  };

  const fillHead = (d) => {
    const v = d.data();
    headAvatar.replaceChildren(initialAvatar(v.name || "Anonymous"));
    headName.textContent = v.name || "Anonymous";
    headSub.textContent = [v.device, place(v.country, v.countryName)].filter(Boolean).join(" · ") || "Private conversation";
  };

  const close = () => {
    if (unsubMsgs) unsubMsgs();
    unsubMsgs = null;
    if (reply) reply.clear();
    if (dmRx) dmRx.stop();
    dmRx = null;
    openId = null;
    card.classList.remove("is-open");
    openEl.hidden = true;
    placeholder.hidden = false;
    renderThreads();
  };

  const open = (id) => {
    const t = threads.find((d) => d.id === id);
    if (!t) return;
    if (unsubMsgs) unsubMsgs();
    if (reply && openId !== id) reply.clear();
    lastMsgDocs = [];
    if (dmRx) dmRx.stop();
    dmRx = makeRx(["dms", id, "reactions"], (err) => setMessage(msg, errText(err, "react")));
    if (dmRx) dmRx.start();
    openId = id;
    card.classList.add("is-open");
    placeholder.hidden = true;
    openEl.hidden = false;
    fillHead(t);
    setMessage(msg, "");
    threadEl.replaceChildren(el("li", "empty center", "Loading…"));
    const who = t.data().name || "Anonymous";
    headActions.replaceChildren(deleteButton({
      iconOnly: true,
      title: "Delete conversation?",
      message: `Your whole private conversation with ${who} will be deleted.`,
      note: "All of its messages and reactions are removed permanently, for you and for them. If they write again, a new conversation starts.",
      confirmLabel: "Delete conversation",
      done: "Conversation deleted",
      onConfirm: async () => {
        for (const sub of ["messages", "reactions"]) {
          const snap = await getDocs(collection(db, "dms", id, sub));
          for (const m of snap.docs) await deleteDoc(m.ref);
        }
        await deleteDoc(doc(db, "dms", id));
        close();
      },
    }));
    unsubMsgs = onSnapshot(
      query(collection(db, "dms", id, "messages"), orderBy("createdAt", "asc"), limit(300)),
      { includeMetadataChanges: true },
      (snap) => {
        const cur = threads.find((d) => d.id === id);
        lastMsgDocs = snap.docs;
        renderMessages(snap.docs, (cur || t).data());
        scrollToEnd();
        if (onTab()) markRead(id);
      },
      (err) => threadEl.replaceChildren(el("li", "empty center", errText(err, "load this conversation")))
    );
    renderThreads();
    markRead(id);
    if (matchMedia("(hover: hover)").matches) input.focus({ preventScroll: true });
  };

  const start = () => {
    if (started) return;
    started = true;
    onSnapshot(
      query(collection(db, "dms"), orderBy("updatedAt", "desc"), limit(100)),
      (snap) => {
        threads = snap.docs;
        // Alert for conversations with a new visitor message since the dashboard loaded
        for (const d of threads) {
          const v = d.data();
          const t = ms(v.updatedAt);
          const prev = lastAlert.get(d.id);
          lastAlert.set(d.id, t);
          if (!primed || v.lastFrom !== "visitor" || !t) continue;
          if (prev !== undefined && t <= prev) continue;
          const reading = openId === d.id && onTab() && window.Notify && window.Notify.isWatching();
          if (!reading) alertAdmin(d.id, v);
        }
        primed = true;
        if (openId) {
          const cur = threads.find((d) => d.id === openId);
          if (!cur) close();
          else {
            fillHead(cur);
            if (onTab()) markRead(openId);
          }
        }
        renderThreads();
      },
      (err) => listEl.replaceChildren(el("li", "empty pad", errText(err, "load private messages")))
    );
  };

  document.getElementById("dmBack").addEventListener("click", close);

  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    send.disabled = !input.value.trim();
  };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  // Sending: instant, in order, retryable (outbox.js)
  outbox = window.createOutbox ? window.createOutbox({
    key: "admin-private",
    maxLength: 1000,
    newId: () => doc(collection(db, "dms")).id,
    onChange: () => {
      if (openId) {
        const cur = threads.find((d) => d.id === openId);
        if (cur) renderMessages(lastMsgDocs, cur.data());
        scrollToEnd();
      }
      const failed = outbox.list().find((m) => m.status === "failed" && m.meta.thread === openId);
      if (failed) setMessage(msg, failNote(failed.error));
    },
    write: async (id, text, meta) => {
      const threadRef = doc(db, "dms", meta.thread);
      const mref = doc(threadRef, "messages", id);
      try {
        const batch = writeBatch(db);
        batch.set(mref, { from: "admin", text, ...(meta.replyTo ? { replyTo: meta.replyTo } : {}), createdAt: serverTimestamp() });
        batch.update(threadRef, {
          lastText: text.slice(0, 120),
          lastFrom: "admin",
          updatedAt: serverTimestamp(),
          adminReadAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        if (await alreadySaved(mref, err)) return;
        throw err;
      }
    },
  }) : null;

  const reply = makeReplyBar(form, input, scrollEl);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!outbox || !openId) return;
    const res = outbox.send(input.value, { thread: openId, replyTo: reply.quote() });
    if (!res.ok) {
      const why = window.outboxRefusal(res);
      if (why) setMessage(msg, why);
      return;   // keep what you typed
    }
    reply.clear();
    input.value = "";
    grow();
    setMessage(msg, navigator.onLine ? "" : "You're offline. Your reply will send when you're back online.");
    scrollToEnd();
    input.focus();
  });

  threadEl.addEventListener("click", (e) => {
    const q = e.target.closest("[data-jump]");
    if (q) { jumpTo(threadEl, q.dataset.jump); return; }
    const retry = e.target.closest("[data-retry]");
    const remove = e.target.closest("[data-discard]");
    if (!outbox || (!retry && !remove)) return;
    if (retry) outbox.retry(retry.dataset.retry);
    else outbox.discard(remove.dataset.discard);
    setMessage(msg, "");
  });

  return { start, markOpenRead: () => { if (openId) markRead(openId); } };
})();

/* ---------- Anonymous posts: visitors' posts waiting for approval ---------- */
const CHECK = '<path d="m5 12.5 4.5 4.5L19 7.5"/>';
const EYE_OFF = '<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>';

const submissions = (() => {
  const listEl = document.getElementById("submissionList");
  const navBadge = document.getElementById("navSubmissions");
  const pendingCount = document.getElementById("subPendingCount");
  const approvedCount = document.getElementById("subApprovedCount");
  const segBtns = [...document.querySelectorAll("[data-filter]")];
  let filter = "pending";
  let docs = [];
  let started = false;

  const time = (d) => d.data().createdAt?.toDate?.()?.getTime?.() || 0;

  const statusButton = (d, status, label, icon, cls) => {
    const b = el("button", `btn btn-sm ${cls}`);
    b.type = "button";
    b.append(svg(icon), el("span", "", label));
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await updateDoc(d.ref, { status, reviewedAt: serverTimestamp() });
      } catch (err) {
        console.error(err);
        b.disabled = false;
        alert(errText(err, "update the post"));
      }
    });
    return b;
  };

  const row = (d) => {
    const v = d.data();
    const approved = v.status === "approved";
    const li = el("li", "row");
    li.append(initialAvatar(v.name || "Anonymous"));
    const main = el("div", "row-main");
    const head = el("div", "row-head");
    head.append(el("strong", "", v.name || "Anonymous"));
    const sub = [v.device, place(v.country, v.countryName)].filter(Boolean).join(" · ");
    if (sub) head.append(el("span", "muted", sub));
    head.append(el("span", `badge ${approved ? "badge-brand" : "badge-warn"}`, approved ? "Approved" : "Pending"));
    main.append(head, el("p", "row-body", v.text || ""), el("span", "row-time", fullDate(v.createdAt?.toDate?.())));
    li.append(main);

    const actions = el("div", "row-actions row-actions-stack");
    actions.append(approved
      ? statusButton(d, "pending", "Unpublish", EYE_OFF, "btn-outline")
      : statusButton(d, "approved", "Approve", CHECK, "btn-primary"));
    actions.append(deleteButton({
      title: "Delete post?",
      message: `${v.name || "Anonymous"}'s post “${snippet(v.text)}” will be deleted.`,
      note: approved
        ? "It's live on your page now and will disappear for everyone. This can't be undone."
        : "It was never shown on your page. This can't be undone.",
      done: "Post deleted",
      onConfirm: async () => { await deleteDoc(d.ref); },
    }));
    li.append(actions);
    return li;
  };

  const render = () => {
    const pending = docs.filter((d) => d.data().status !== "approved");
    const approved = docs.filter((d) => d.data().status === "approved");
    pendingCount.textContent = pending.length.toLocaleString();
    approvedCount.textContent = approved.length.toLocaleString();
    navBadge.textContent = pending.length > 99 ? "99+" : String(pending.length);
    navBadge.hidden = !pending.length;
    const shown = filter === "approved" ? approved : pending;
    listEl.replaceChildren(...(shown.length
      ? shown.map(row)
      : [el("li", "empty", filter === "approved" ? "No approved posts yet." : "No posts waiting for review.")]));
  };

  for (const b of segBtns) {
    b.addEventListener("click", () => {
      filter = b.dataset.filter;
      for (const x of segBtns) {
        const on = x === b;
        x.classList.toggle("is-active", on);
        x.setAttribute("aria-selected", String(on));
      }
      render();
    });
  }

  const start = () => {
    if (started) return;
    started = true;
    onSnapshot(
      collection(db, "submissions"),
      (snap) => { docs = snap.docs.slice().sort((a, b) => time(b) - time(a)); render(); },
      (err) => {
        console.error(err);
        listEl.replaceChildren(el("li", "empty", errText(err, "load anonymous posts")));
      }
    );
  };

  return { start };
})();

/* ---------- IP location (approximate, from the free GeoJS service) ---------- */
const MAP_PIN = '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>';

const ipLocation = (() => {
  const dialog = document.getElementById("ipDialog");
  const ipEl = document.getElementById("ipDialogIp");
  const body = document.getElementById("ipDialogBody");
  const cache = new Map();
  let current = "";

  const lookup = (ip) => {
    if (!cache.has(ip)) {
      cache.set(ip, fetch(`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch((err) => { cache.delete(ip); throw err; }));
    }
    return cache.get(ip);
  };

  const field = (label, value) => {
    const row = el("div", "geo-row");
    row.append(el("dt", "", label), el("dd", "", value || "—"));
    return row;
  };

  const show = (ip, visit, g) => {
    const lat = parseFloat(g.latitude);
    const lon = parseFloat(g.longitude);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
    const place2 = [g.city, g.region, g.country].filter(Boolean).join(", ");

    const head = el("div", "geo-place");
    head.append(svg(MAP_PIN), el("strong", "", place2 || "Location unknown"));

    const list = el("dl", "geo-list");
    list.append(
      field("City", g.city),
      field("Region", g.region),
      field("Country", g.country ? `${g.country}${g.country_code ? ` (${g.country_code})` : ""}` : ""),
      field("Network", g.organization_name || g.organization),
      field("Time zone", g.timezone),
      field("Device", visit.device),
      field("Accuracy", g.accuracy ? `about ${g.accuracy} km` : "")
    );

    const parts = [head];
    if (hasPoint) {
      // OpenStreetMap preview around the point
      const d = 0.08;
      const map = el("iframe", "geo-map");
      map.title = `Map near ${place2 || ip}`;
      map.referrerPolicy = "no-referrer";
      map.src = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}`;
      parts.push(map);
    }
    parts.push(list);

    const note = el("p", "geo-note", "Approximate: an IP shows roughly where the internet provider connects (often the city), not an exact address.");
    parts.push(note);

    if (hasPoint) {
      const actions = el("div", "geo-actions");
      const gm = el("a", "btn btn-outline btn-sm");
      gm.href = `https://www.google.com/maps?q=${lat},${lon}`;
      gm.target = "_blank";
      gm.rel = "noopener noreferrer";
      gm.append(svg(MAP_PIN), el("span", "", "Open in Google Maps"));
      actions.append(gm);
      parts.push(actions);
    }
    body.replaceChildren(...parts);
  };

  const open = (ip, visit) => {
    current = ip;
    ipEl.textContent = ip;
    body.replaceChildren(el("p", "empty", "Looking up location…"));
    if (!dialog.open) dialog.showModal();
    lookup(ip)
      .then((g) => { if (current === ip) show(ip, visit, g); })
      .catch((err) => {
        console.error(err);
        if (current === ip) body.replaceChildren(el("p", "empty", "Couldn't look up this IP right now. Try again in a moment."));
      });
  };

  document.getElementById("ipDialogClose").addEventListener("click", () => dialog.close());
  // Click outside the box closes it
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { current = ""; });

  return { open };
})();

/* ---------- Loaders per tab ---------- */
const loaders = {
  overview() {
    countInto("visits", "countVisitors");
    countInto("messages", "countMessages");
    countInto("comments", "countComments");
    countInto("posts", "countPosts");
    countInto("dms", "countDms");
    getCountFromServer(query(collection(db, "submissions"), where("status", "==", "pending")))
      .then((s) => { document.getElementById("countPending").textContent = s.data().count.toLocaleString(); })
      .catch(() => { document.getElementById("countPending").textContent = "—"; });
    miniInto("comments", "ovComments");
    miniInto("messages", "ovMessages");
  },

  messages() {
    chat.start();
  },

  submissions() {
    submissions.start();
  },

  inbox() {
    inbox.start();
  },

  comments() {
    const wrap = document.getElementById("commentGroups");
    const HEART = '<path d="M12 20.5s-7.5-4.6-9.6-9.2C.9 7.9 3 4 6.8 4c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3-2.1 4.6-9.6 9.2-9.6 9.2Z"/>';
    const BUBBLE = '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>';
    const CHEV = '<path d="m6 9 6 6 6-6"/>';
    const time = (x) => x.createdAt?.toDate?.()?.getTime?.() || 0;

    // One card per post: preview, likes (expandable), and its comments
    const group = (post) => {
      const card = el("article", "card post-group");

      const head = el("div", "pg-head");
      const label = el("span", `badge ${post.id === "pinned" ? "badge-brand" : "badge-outline"}`, post.id === "pinned" ? "Pinned" : (post.date ? shortDate(post.date) : "Post"));
      const text = el("p", "pg-text", post.text || "(no text)");
      head.append(label, text);

      const stats = el("div", "pg-stats");
      const likeBtn = el("button", "chip");
      likeBtn.type = "button";
      likeBtn.setAttribute("aria-expanded", "false");
      const likeLabel = el("span", "", "0 likes");
      likeBtn.append(svg(HEART), likeLabel, svg(CHEV, "icon chip-chev"));
      const commentChip = el("span", "chip chip-static");
      const commentLabel = el("span", "", "0 comments");
      commentChip.append(svg(BUBBLE), commentLabel);
      stats.append(likeBtn, commentChip);

      const likePanel = el("ul", "like-list");
      likePanel.hidden = true;
      likeBtn.addEventListener("click", () => {
        likePanel.hidden = !likePanel.hidden;
        likeBtn.setAttribute("aria-expanded", String(!likePanel.hidden));
      });

      const list = el("ul", "list pg-comments");
      list.append(el("li", "empty", "Loading comments…"));

      card.append(head, stats, likePanel, list);

      onSnapshot(
        query(collection(db, "likes"), where("post", "==", post.id)),
        (snap) => {
          const n = snap.size;
          likeLabel.textContent = `${n.toLocaleString()} ${n === 1 ? "like" : "likes"}`;
          const docs = snap.docs.slice().sort((a, b) => time(b.data()) - time(a.data()));
          likePanel.replaceChildren(...(docs.length
            ? docs.map((d) => {
              const v = d.data();
              const li = el("li", "like-row");
              li.append(svg(HEART, "icon like-heart"), el("span", "", v.device || "Unknown device"), el("span", "row-time", ago(v.createdAt?.toDate?.())));
              return li;
            })
            : [el("li", "empty", "No likes yet.")]));
        },
        (err) => { likeLabel.textContent = "Likes unavailable"; console.warn(err); }
      );

      onSnapshot(
        query(collection(db, "comments"), where("post", "==", post.id)),
        (snap) => {
          const n = snap.size;
          commentLabel.textContent = `${n.toLocaleString()} ${n === 1 ? "comment" : "comments"}`;
          const docs = snap.docs.slice().sort((a, b) => time(b.data()) - time(a.data()));   // newest first
          list.replaceChildren(...(docs.length
            ? docs.map((d) => {
              const c = d.data();
              return listRow(d, {
                title: c.name || "Anonymous",
                sub: [c.device, place(c.country, c.countryName)].filter(Boolean).join(" · "),
                body: c.text,
                time: `${fullDate(c.createdAt?.toDate?.())}${c.editedAt ? " · edited" : ""}`,
                del: {
                  title: "Delete comment?",
                  message: `${c.name || "Anonymous"}'s comment “${snippet(c.text)}” will be removed for everyone.`,
                  note: "This can't be undone.",
                  done: "Comment deleted",
                },
              });
            })
            : [el("li", "empty", "No comments on this post yet.")]));
        },
        (err) => list.replaceChildren(el("li", "empty", errText(err, "load comments")))
      );

      return card;
    };

    (async () => {
      const profile = await loadProfile();
      const posts = [{ id: "pinned", text: profile.bioRef ? `${profile.bio} — ${profile.bioRef}` : profile.bio, date: null }];
      try {
        const snap = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc")));
        for (const d of snap.docs) posts.push({ id: d.id, text: d.data().text, date: d.data().createdAt?.toDate?.() });
      } catch (err) {
        console.error(err);
      }
      try {
        const subs = await getDocs(query(collection(db, "submissions"), where("status", "==", "approved")));
        for (const d of subs.docs) {
          const v = d.data();
          posts.push({ id: d.id, text: `${v.name || "Anonymous"}: ${v.text}`, date: v.createdAt?.toDate?.() });
        }
      } catch (err) {
        console.error(err);
      }
      const [pinned, ...rest] = posts;
      rest.sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));
      wrap.replaceChildren(...[pinned, ...rest].map(group));
    })();
  },

  visitors: pagedList({
    name: "visits",
    listEl: document.getElementById("visitorList"),
    moreBtn: document.getElementById("visitorMore"),
    order: "lastSeen",
    pageSize: 40,
    emptyTag: "div",
    emptyText: "No visitors recorded yet.",
    render: (d) => {
      const v = d.data();
      const row = el("div", "tr");
      const device = el("div", "td-device");
      device.append(initialAvatar(v.device || "?"), el("span", "", v.device || "Unknown device"));
      // IP address (admin-only collection, same ID as the visit)
      const ip = el("span", "td-ip", "…");
      getDoc(doc(db, "visitIps", d.id))
        .then((s) => {
          if (!s.exists()) {
            ip.textContent = "—";
            ip.title = "Recorded before IPs were saved";
            return;
          }
          // Click the IP to see roughly where it is
          const addr = s.data().ip;
          const b = el("button", "ip-btn");
          b.type = "button";
          b.title = "Show location";
          b.append(el("span", "", addr), svg(MAP_PIN));
          b.addEventListener("click", () => ipLocation.open(addr, v));
          ip.replaceChildren(b);
        })
        .catch(() => { ip.textContent = "—"; });
      row.append(
        device,
        ip,
        el("span", "td-muted td-loc", place(v.country, v.countryName) || "—"),
        el("span", "td-muted td-first", shortDate(v.createdAt?.toDate?.())),
        el("span", "td-muted td-last", ago(v.lastSeen?.toDate?.()))
      );
      return row;
    },
  }),

  posts() {
    // Pinned post: pin / unpin (saved in site/pinned; missing means pinned)
    const PIN = '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 15v6"/>';
    const UNPIN = '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 15v6M3 3l18 18"/>';
    const pinRef = doc(db, "site", "pinned");
    const pinBtn = document.getElementById("pinToggle");
    const pinState = document.getElementById("pinnedState");
    const pinText = document.getElementById("pinnedText");
    const pinBadge = document.getElementById("pinnedBadge");
    let isPinned = true;

    loadProfile().then((p) => { pinText.textContent = p.bioRef ? `${p.bio} — ${p.bioRef}` : p.bio; });

    onSnapshot(
      pinRef,
      (snap) => {
        isPinned = !snap.exists() || snap.data().pinned !== false;
        pinBtn.disabled = false;
        pinBtn.replaceChildren(svg(isPinned ? UNPIN : PIN), el("span", "", isPinned ? "Unpin" : "Pin to top"));
        pinState.textContent = isPinned
          ? "Shown at the top of your page, above every other post."
          : "Unpinned: shown as a normal post, below your other posts.";
        pinBadge.textContent = isPinned ? "Pinned" : "Not pinned";
        pinBadge.className = `badge ${isPinned ? "badge-brand" : "badge-muted"}`;
      },
      (err) => { pinState.textContent = errText(err, "load the pinned setting"); }
    );

    pinBtn.addEventListener("click", async () => {
      pinBtn.disabled = true;
      try {
        await setDoc(pinRef, { pinned: !isPinned, updatedAt: serverTimestamp() });
      } catch (err) {
        console.error(err);
        alert(errText(err, isPinned ? "unpin the post" : "pin the post"));
      } finally {
        pinBtn.disabled = false;
      }
    });

    const listEl = document.getElementById("postList");
    const countEl = document.getElementById("postCount");
    onSnapshot(
      query(collection(db, "posts"), orderBy("createdAt", "desc")),
      (snap) => {
        countEl.textContent = `${snap.size} ${snap.size === 1 ? "post" : "posts"} on your profile.`;
        if (!snap.size) { listEl.replaceChildren(el("li", "empty", "No posts yet. Write your first one above.")); return; }
        listEl.replaceChildren(...snap.docs.map((d) => {
          const p = d.data({ serverTimestamps: "estimate" });
          return listRow(d, {
            title: profileName,
            avatar: photoAvatar(),
            body: p.text,
            time: fullDate(p.createdAt?.toDate?.()),
            del: {
              title: "Delete post?",
              message: `Your post “${snippet(p.text)}” will be removed from your page for everyone.`,
              note: "Its likes and comments won't be shown anymore. This can't be undone.",
              done: "Post deleted",
            },
          });
        }));
      },
      (err) => listEl.replaceChildren(el("li", "empty", errText(err, "load posts")))
    );
  },

  profile() {
    fillProfileForm();
  },
};

// Opening the Messages tab clears its badge
window.addEventListener("hashchange", () => {
  if (location.hash === "#messages") chat.markSeen();
  if (location.hash === "#inbox") inbox.markOpenRead();
});

/* ---------- Posts: write ---------- */
const postForm = document.getElementById("postForm");
const postText = document.getElementById("postText");
const postSubmit = document.getElementById("postSubmit");
const postMsg = document.getElementById("postMessage");
const postHint = document.getElementById("postHint");

const updatePostHint = () => {
  const left = 5000 - postText.value.length;
  postHint.textContent = left < 500 ? `${left} characters left` : "";
};
postText.addEventListener("input", updatePostHint);

postForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = postText.value.trim();
  if (!text) { setMessage(postMsg, "Write something first."); return; }
  postSubmit.disabled = true;
  postSubmit.textContent = "Publishing…";
  try {
    await addDoc(collection(db, "posts"), { text, createdAt: serverTimestamp() });
    postText.value = "";
    updatePostHint();
    setMessage(postMsg, "Published! It's now on your profile page.", "ok");
    setTimeout(() => setMessage(postMsg, ""), 3500);
  } catch (err) {
    console.error(err);
    setMessage(postMsg, errText(err, "publish"));
  } finally {
    postSubmit.disabled = false;
    postSubmit.textContent = "Publish";
  }
});

/* ---------- Profile ---------- */
const DEFAULT_PROFILE = {
  name: "Perry Philip Lozano",
  role: "Software Developer",
  bio: "“Commit your work to the LORD, and your plans will be established.”",
  bioRef: "Proverbs 16:3",
};
let profileName = DEFAULT_PROFILE.name;
const profileRef = doc(db, "site", "profile");

const pf = {
  form: document.getElementById("profileForm"),
  name: document.getElementById("profileName"),
  role: document.getElementById("profileRole"),
  bio: document.getElementById("profileBio"),
  bioRef: document.getElementById("profileBioRef"),
  submit: document.getElementById("profileSubmit"),
  msg: document.getElementById("profileMessage"),
};

const applySide = (p) => {
  profileName = p.name || DEFAULT_PROFILE.name;
  document.getElementById("sideName").textContent = profileName;
};

const loadProfile = async () => {
  try {
    const snap = await getDoc(profileRef);
    return { ...DEFAULT_PROFILE, ...(snap.exists() ? snap.data() : {}) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
};

const fillProfileForm = async () => {
  const p = await loadProfile();
  pf.name.value = p.name;
  pf.role.value = p.role;
  pf.bio.value = p.bio;
  pf.bioRef.value = p.bioRef;
};

pf.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    name: pf.name.value.trim(),
    role: pf.role.value.trim(),
    bio: pf.bio.value.trim(),
    bioRef: pf.bioRef.value.trim(),
  };
  if (!data.name) { setMessage(pf.msg, "Your name can't be empty."); return; }
  pf.submit.disabled = true;
  pf.submit.textContent = "Saving…";
  try {
    await setDoc(profileRef, { ...data, updatedAt: serverTimestamp() });
    applySide(data);
    setMessage(pf.msg, "Saved! Your profile page is updated.", "ok");
    setTimeout(() => setMessage(pf.msg, ""), 3500);
  } catch (err) {
    console.error(err);
    setMessage(pf.msg, errText(err, "save your profile"));
  } finally {
    pf.submit.disabled = false;
    pf.submit.textContent = "Save changes";
  }
});

/* ---------- Start ---------- */
loadProfile().then(applySide);
chat.start();            // live badge for new messages, even on other tabs
submissions.start();     // live badge for posts waiting for review
inbox.start();           // live badge for unread private messages
window.addEventListener("hashchange", showTab);
showTab();
})();
