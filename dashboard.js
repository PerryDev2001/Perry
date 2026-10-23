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
  getDocs, onSnapshot, serverTimestamp, getCountFromServer,
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

// Two-step delete button ("Delete" → "Confirm") with a trash icon
const deleteButton = ({ onConfirm, iconOnly = false, className = "" }) => {
  const b = el("button", `btn btn-sm ${iconOnly ? "btn-icon btn-ghost" : "btn-destructive-ghost"} ${className}`);
  b.type = "button";
  b.setAttribute("aria-label", "Delete");
  const label = el("span", "", iconOnly ? "" : "Delete");
  b.append(svg(TRASH), label);
  let timer = 0;
  b.addEventListener("click", async () => {
    if (!b.classList.contains("is-confirm")) {
      b.classList.add("is-confirm");
      if (!iconOnly) { label.textContent = "Confirm"; b.classList.add("btn-destructive"); }
      b.setAttribute("aria-label", "Click again to delete");
      timer = setTimeout(() => {
        b.classList.remove("is-confirm", "btn-destructive");
        if (!iconOnly) label.textContent = "Delete";
        b.setAttribute("aria-label", "Delete");
      }, 4000);
      return;
    }
    clearTimeout(timer);
    b.disabled = true;
    try {
      await onConfirm();
    } catch (err) {
      console.error(err);
      b.disabled = false;
      alert(errText(err, "delete it"));
    }
  });
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
const TITLES = { overview: "Overview", posts: "Posts", messages: "Messages", comments: "Comments", visitors: "Visitors", profile: "Profile" };
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

const listRow = (d, { title, sub, body, time, avatar }) => {
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
  actions.append(deleteButton({ onConfirm: async () => { await deleteDoc(d.ref); removeRow(li); } }));
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
      if (isMine(m)) li.classList.add("is-mine");
      if (m.admin) li.classList.add("is-admin");
      if (!first) li.classList.add("is-cont");
      if (last) li.classList.add("is-last");

      li.append(m.admin ? photoAvatar() : initialAvatar(m.name || "Anonymous"));

      const body = el("div", "t-body");
      if (first) {
        const meta = el("div", "t-meta");
        meta.append(el("strong", "", m.admin ? (m.name || profileName) : (m.name || "Anonymous")));
        if (m.admin) meta.append(el("span", "badge badge-brand", "Admin"));
        const where = [m.device, place(m.country, m.countryName)].filter(Boolean).join(" · ");
        if (where) meta.append(el("span", "", where));
        body.append(meta);
      }
      const row = el("div", "t-bubble-row");
      const text = el("p", "t-text", m.text);
      text.title = fullDate(date);
      row.append(text, deleteButton({
        iconOnly: true,
        className: "t-del",
        onConfirm: async () => { await deleteDoc(d.ref); },
      }));
      body.append(row);
      li.append(body);
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
    onSnapshot(
      query(ref, orderBy("createdAt", "desc"), limit(PAGE)),
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+\n/g, "\n").trim().slice(0, 500);
    if (!text) return;
    send.disabled = true;
    try {
      await addDoc(ref, { name: profileName.slice(0, 60), text, admin: true, uid: user.uid, createdAt: serverTimestamp() });
      input.value = "";
      setMessage(msg, "");
      scrollToEnd();
    } catch (err) {
      console.error(err);
      setMessage(msg, errText(err, "send"));
    } finally {
      grow();
      input.focus();
    }
  });

  return {
    start,
    scrollToEnd,
    markSeen: () => { seen = new Set(live.map((d) => d.id)); navBadge.hidden = true; },
  };
})();

/* ---------- Loaders per tab ---------- */
const loaders = {
  overview() {
    countInto("visits", "countVisitors");
    countInto("messages", "countMessages");
    countInto("comments", "countComments");
    countInto("posts", "countPosts");
    miniInto("comments", "ovComments");
    miniInto("messages", "ovMessages");
  },

  messages() {
    chat.start();
  },

  comments: pagedList({
    name: "comments",
    listEl: document.getElementById("commentList"),
    moreBtn: document.getElementById("commentMore"),
    order: "createdAt",
    emptyText: "No comments yet.",
    render: (d) => {
      const c = d.data();
      return listRow(d, {
        title: c.name || "Anonymous",
        sub: [c.device, place(c.country, c.countryName)].filter(Boolean).join(" · "),
        body: c.text,
        time: `${fullDate(c.createdAt?.toDate?.())}${c.editedAt ? " · edited" : ""}`,
      });
    },
  }),

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
      row.append(
        device,
        el("span", "td-muted td-loc", place(v.country, v.countryName) || "—"),
        el("span", "td-muted td-first", shortDate(v.createdAt?.toDate?.())),
        el("span", "td-muted td-last", ago(v.lastSeen?.toDate?.()))
      );
      return row;
    },
  }),

  posts() {
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
window.addEventListener("hashchange", () => { if (location.hash === "#messages") chat.markSeen(); });

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
window.addEventListener("hashchange", showTab);
showTab();
})();
