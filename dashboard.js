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

const NO_FLAGS = /Windows/.test(navigator.userAgent);
const flag = (code) =>
  /^[A-Z]{2}$/.test(code || "") ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
const place = (code, name) => (code ? (NO_FLAGS ? `${code}${name ? ` · ${name}` : ""}` : `${flag(code)} ${name || code}`) : "");

const ago = (date) => {
  if (!date) return "";
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const fullDate = (date) =>
  date ? date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const hueFor = (s = "") => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};

const initialAvatar = (name) => {
  const a = el("span", "avatar", [...(name || "A")][0].toUpperCase());
  a.style.setProperty("--h", hueFor(name || "Anonymous"));
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

document.body.classList.remove("is-checking");
gate.hidden = true;
dash.hidden = false;
document.getElementById("whoami").textContent = `Signed in as ${user.email || "admin"}`;

// Signed out somewhere else? Leave.
A.onAuthStateChanged(auth, (u) => { if (!u) toLogin(); });

document.getElementById("signOut").addEventListener("click", async () => {
  await A.signOut(auth);
  toLogin();
});

/* ---------- Tabs (#overview, #posts, …) ---------- */
const tabs = ["overview", "posts", "comments", "messages", "visitors", "profile"];
const loaded = new Set();

const showTab = () => {
  const name = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
  for (const a of document.querySelectorAll("[data-tab]")) {
    const on = a.dataset.tab === name;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (!loaded.has(name)) {
    loaded.add(name);
    loaders[name]?.();
  }
  window.scrollTo({ top: 0 });
};

/* ---------- Generic paged list ---------- */
const pagedList = ({ name, listEl, moreBtn, order, pageSize = 25, render, emptyText }) => {
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
      if (!snap.docs.length && !count) listEl.append(el("li", "empty", emptyText));
      for (const d of snap.docs) listEl.append(render(d, () => { count--; }));
      count += snap.docs.length;
      last = snap.docs[snap.docs.length - 1] || last;
      moreBtn.hidden = snap.docs.length < pageSize;
    } catch (err) {
      console.error(err);
      listEl.replaceChildren(el("li", "empty", errText(err, `load ${name}`)));
    } finally {
      moreBtn.disabled = false;
    }
  };

  moreBtn.addEventListener("click", load);
  return load;
};

// Row with an inline "Delete?" confirmation
const deletableRow = (d, { title, sub, body, time, onDeleted }) => {
  const li = el("li", "row");
  li.append(initialAvatar(title));
  const main = el("div", "row-main");
  const head = el("div", "row-head");
  head.append(el("strong", "", title));
  if (sub) head.append(el("span", "muted", sub));
  main.append(head);
  if (body) main.append(el("p", "row-body", body));
  main.append(el("span", "row-time", time));
  li.append(main);

  const actions = el("div", "row-actions");
  const del = el("button", "btn btn-danger-ghost", "Delete");
  del.type = "button";
  del.addEventListener("click", async () => {
    if (!del.classList.contains("is-confirm")) {
      del.classList.add("is-confirm");
      del.textContent = "Confirm delete";
      setTimeout(() => { del.classList.remove("is-confirm"); del.textContent = "Delete"; }, 4000);
      return;
    }
    del.disabled = true;
    try {
      await deleteDoc(d.ref);
      li.classList.add("is-removed");
      setTimeout(() => li.remove(), 300);
      onDeleted?.();
    } catch (err) {
      console.error(err);
      del.disabled = false;
      del.textContent = "Failed — retry";
      alert(errText(err, "delete it"));
    }
  });
  actions.append(del);
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

const miniInto = async (name, id, toItem) => {
  const listEl = document.getElementById(id);
  try {
    const snap = await getDocs(query(collection(db, name), orderBy("createdAt", "desc"), limit(5)));
    listEl.replaceChildren(...(snap.docs.length ? snap.docs.map(toItem) : [el("li", "empty", "Nothing yet.")]));
  } catch (err) {
    listEl.replaceChildren(el("li", "empty", errText(err, "load")));
  }
};

const miniItem = (d) => {
  const v = d.data();
  const li = el("li", "mini");
  li.append(initialAvatar(v.name || "Anonymous"));
  const main = el("div", "mini-main");
  main.append(el("strong", "", v.name || "Anonymous"), el("span", "muted", v.text || ""));
  li.append(main, el("span", "row-time", ago(v.createdAt?.toDate?.())));
  return li;
};

/* ---------- Loaders per tab ---------- */
const loaders = {
  overview() {
    countInto("visits", "countVisitors");
    countInto("messages", "countMessages");
    countInto("comments", "countComments");
    countInto("posts", "countPosts");
    miniInto("comments", "ovComments", miniItem);
    miniInto("messages", "ovMessages", miniItem);
  },

  comments: pagedList({
    name: "comments",
    listEl: document.getElementById("commentList"),
    moreBtn: document.getElementById("commentMore"),
    order: "createdAt",
    emptyText: "No comments yet.",
    render: (d) => {
      const c = d.data();
      const date = c.createdAt?.toDate?.();
      return deletableRow(d, {
        title: c.name || "Anonymous",
        sub: [c.device, place(c.country, c.countryName)].filter(Boolean).join(" · "),
        body: c.text,
        time: `${fullDate(date)}${c.editedAt ? " · edited" : ""}`,
      });
    },
  }),

  messages: pagedList({
    name: "messages",
    listEl: document.getElementById("messageList"),
    moreBtn: document.getElementById("messageMore"),
    order: "createdAt",
    emptyText: "No messages yet.",
    render: (d) => {
      const m = d.data();
      return deletableRow(d, {
        title: m.name || "Anonymous",
        sub: [m.device, place(m.country, m.countryName)].filter(Boolean).join(" · "),
        body: m.text,
        time: fullDate(m.createdAt?.toDate?.()),
      });
    },
  }),

  visitors: pagedList({
    name: "visits",
    listEl: document.getElementById("visitorList"),
    moreBtn: document.getElementById("visitorMore"),
    order: "lastSeen",
    pageSize: 40,
    emptyText: "No visitors recorded yet.",
    render: (d) => {
      const v = d.data();
      const li = el("li", "row");
      li.append(initialAvatar(v.device || "?"));
      const main = el("div", "row-main");
      const head = el("div", "row-head");
      head.append(el("strong", "", v.device || "Unknown device"));
      const where = place(v.country, v.countryName);
      if (where) head.append(el("span", "muted", where));
      main.append(head,
        el("span", "row-time", `Last visit ${fullDate(v.lastSeen?.toDate?.())} · First visit ${fullDate(v.createdAt?.toDate?.())}`));
      li.append(main);
      return li;
    },
  }),

  posts() {
    const listEl = document.getElementById("postList");
    const countEl = document.getElementById("postCount");
    onSnapshot(
      query(collection(db, "posts"), orderBy("createdAt", "desc")),
      (snap) => {
        countEl.textContent = `${snap.size} ${snap.size === 1 ? "post" : "posts"}`;
        if (!snap.size) { listEl.replaceChildren(el("li", "empty", "No posts yet. Write your first one above.")); return; }
        listEl.replaceChildren(...snap.docs.map((d) => {
          const p = d.data({ serverTimestamps: "estimate" });
          return deletableRow(d, {
            title: profileName,
            sub: "Post",
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
    pf.submit.textContent = "Save profile";
  }
});

/* ---------- Start ---------- */
loadProfile().then(applySide);
window.addEventListener("hashchange", showTab);
showTab();
})();
