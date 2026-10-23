/* ---------- Admin sign in ---------- */
(async () => {
const SDK = window.FIREBASE_SDK;
const form = document.getElementById("loginForm");
const email = document.getElementById("loginEmail");
const password = document.getElementById("loginPassword");
const submit = document.getElementById("loginSubmit");
const message = document.getElementById("loginMessage");
const forgot = document.getElementById("forgotPassword");
const toggle = document.getElementById("passwordToggle");
const label = submit.querySelector(".btn-label");

// Theme toggle (same setting as the public page)
document.getElementById("themeBtn")?.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("calling-card-theme", next); } catch { /* ignore */ }
});

const setLoading = (on) => {
  submit.disabled = on;
  submit.classList.toggle("is-loading", on);
  label.textContent = on ? "Signing in…" : "Sign in";
};

const show = (text, kind = "error") => {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
};

toggle.addEventListener("click", () => {
  const visible = password.type === "text";
  password.type = visible ? "password" : "text";
  toggle.setAttribute("aria-pressed", String(!visible));
  toggle.setAttribute("aria-label", visible ? "Show password" : "Hide password");
});

if (location.protocol === "file:") {
  show("Sign-in only works when the site is opened from a web address (http/https), not as a file.");
}
if (new URLSearchParams(location.search).get("denied")) {
  show("That account isn't an admin.");
}

let auth, signIn, signOutFn, onAuth, resetPassword, db, docFn, getDocFn;
try {
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const a = await import(`${SDK}/firebase-auth.js`);
  const f = await import(`${SDK}/firebase-firestore.js`);
  const app = initializeApp(window.FIREBASE_CONFIG);
  auth = a.getAuth(app);
  signIn = a.signInWithEmailAndPassword;
  signOutFn = a.signOut;
  onAuth = a.onAuthStateChanged;
  resetPassword = a.sendPasswordResetEmail;
  db = f.getFirestore(app);
  docFn = f.doc;
  getDocFn = f.getDoc;
} catch (err) {
  console.error(err);
  show("Couldn't load sign-in. Check your connection.");
  return;
}

const isAdmin = async (user) => {
  const snap = await getDocFn(docFn(db, "admins", user.uid));
  return snap.exists();
};

// Already signed in as an admin? Go straight to the dashboard.
onAuth(auth, async (user) => {
  if (!user || user.isAnonymous) return;
  try {
    if (await isAdmin(user)) location.replace("dashboard.html");
  } catch { /* stay on the form */ }
});

const explain = (err) => {
  switch (err && err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Wrong email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/operation-not-allowed":
      return "Email/Password sign-in isn't turned on in Firebase yet (Authentication → Sign-in method).";
    case "auth/configuration-not-found":
      return "Firebase Authentication isn't set up yet (Authentication → Get started).";
    case "auth/unauthorized-domain":
      return `Add "${location.hostname}" to Firebase → Authentication → Settings → Authorized domains.`;
    case "auth/network-request-failed":
      return "Network error. Check your connection.";
    default:
      return "Couldn't sign in. Please try again.";
  }
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show("");
  if (!email.value.trim() || !password.value) {
    show("Enter your email and password.");
    return;
  }
  setLoading(true);
  try {
    const { user } = await signIn(auth, email.value.trim(), password.value);
    if (await isAdmin(user)) {
      location.replace("dashboard.html");
      return;
    }
    await signOutFn(auth);
    show("That account isn't an admin. Ask the owner to add it to the admins list.");
  } catch (err) {
    console.error(err);
    show(err.code === "permission-denied"
      ? "Signed in, but the admin check was blocked. Publish the latest Firestore rules."
      : explain(err));
  } finally {
    setLoading(false);
  }
});

forgot.addEventListener("click", async () => {
  const value = email.value.trim();
  if (!value) {
    show("Type your email above first, then click “Forgot password?”.");
    email.focus();
    return;
  }
  try {
    await resetPassword(auth, value);
    show("If that email has an account, a reset link is on its way.", "ok");
  } catch (err) {
    console.error(err);
    show(explain(err));
  }
});
})();
