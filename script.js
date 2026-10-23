/* ---------- Theme reveal (shared by the clip-path and the hearts) ---------- */
// The new theme grows as a circle out of the theme button until it reaches the
// farthest corner (lower-left). The clip-path and the hearts riding its edge use
// the same timing curve, so they stay in step.
const ThemeReveal = {
  duration: 1300,
  easing: "cubic-bezier(0.65, 0, 0.35, 1)",                                     // easeInOutCubic in CSS
  ease: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),   // ...and in JS

  // Circle centre and the radius needed to cover the whole screen from there
  geometry(button) {
    const r = button.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const W = window.innerWidth;
    const H = window.innerHeight;
    return { cx, cy, maxR: Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) };
  },

  radius(progress, maxR) {
    return this.ease(progress) * maxR;
  },
};

/* ---------- Profile text from the last visit ---------- */
// The name, role and bio live in Firestore. Until it answers, show what this browser saw last
// time (first-time visitors see a short shimmer where the role goes).
(() => {
  let p = null;
  try { p = JSON.parse(localStorage.getItem("site-profile") || "null"); } catch { /* ignore */ }
  if (!p || typeof p !== "object") return;
  const set = (sel, text) => { for (const n of document.querySelectorAll(sel)) n.textContent = text; };
  if (p.name) {
    set(".brand-text strong, #name, .post-author, [data-profile-name]", p.name);
    document.title = p.role ? `${p.name} — ${p.role}` : p.name;
  }
  set("[data-role]", p.role || "");
  for (const n of document.querySelectorAll("[data-role]")) (n.closest(".intro-list li") || n).hidden = !p.role;
  if (typeof p.bio === "string") {
    set(".bio p", p.bio);
    set(".bio cite", p.bioRef || "");
    const pinned = document.querySelector("#pinnedPost .post-text");
    if (pinned) pinned.textContent = p.bioRef ? `${p.bio} — ${p.bioRef}` : p.bio;
  }
})();

/* ---------- Theme ---------- */
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById("themeToggle");
  const STORAGE_KEY = "calling-card-theme";
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  const getStored = () => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  };
  const setStored = (value) => {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
  };

  const applyTheme = (theme) => {
    root.setAttribute("data-theme", theme);
    toggle.setAttribute("aria-checked", String(theme === "dark"));   // switch is "on" in dark mode
  };

  applyTheme(getStored() || (systemPrefersDark.matches ? "dark" : "light"));

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Ask the heart particles (set up below) to do things
  const hearts = (type, detail) => window.dispatchEvent(new CustomEvent(`hearts:${type}`, { detail }));

  toggle.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setStored(next);
    toggle.setAttribute("aria-checked", String(next === "dark"));   // knob starts sliding right away

    if (reduceMotion.matches) {
      applyTheme(next);
      return;
    }

    const { cx, cy, maxR } = ThemeReveal.geometry(toggle);
    hearts("burst", { x: cx, y: cy, count: 14, speed: 3.5 });

    if (!document.startViewTransition) {
      applyTheme(next);     // falls back to the CSS colour fade
      hearts("sweep", { cx, cy, maxR });
      return;
    }

    // The new theme grows as a circle from the button to the lower-left corner;
    // a ring of hearts rides its edge the whole way
    root.classList.add("theme-switching");
    const vt = document.startViewTransition(() => applyTheme(next));
    vt.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxR}px at ${cx}px ${cy}px)`] },
        { duration: ThemeReveal.duration, easing: ThemeReveal.easing, pseudoElement: "::view-transition-new(root)" }
      );
      // The old page dims and eases back slightly as it's covered
      root.animate(
        [
          { filter: "brightness(1)", transform: "scale(1)", transformOrigin: `${cx}px ${cy}px` },
          { filter: "brightness(0.85)", transform: "scale(0.985)", transformOrigin: `${cx}px ${cy}px` },
        ],
        { duration: ThemeReveal.duration, easing: "ease-in", pseudoElement: "::view-transition-old(root)" }
      );
      hearts("sweep", { cx, cy, maxR });
    }).catch(() => {});
    vt.finished.finally(() => root.classList.remove("theme-switching"));
  });

  systemPrefersDark.addEventListener("change", (e) => {
    if (!getStored()) applyTheme(e.matches ? "dark" : "light");
  });
})();

/* ---------- Cursor dot + floating heart particles ---------- */
(() => {
  const layer = document.getElementById("cursorLayer");
  const dot = document.getElementById("cursorDot");
  const ambientLayer = document.getElementById("ambientLayer");
  if (!layer || !dot || !ambientLayer) return;

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const INTERACTIVE = "a, button, [role='button'], input, textarea, select, summary, label";
  const TIP_X = 5, TIP_Y = 3;                    // arrow tip inside its 24px box
  const BURST_COUNT = 8;
  const MAX_SPEED = 5;
  const JOIN_AT = 0.3;                           // pull strength at which a heart joins for good
  const MAX_JOINED = 40;                         // hearts in a complete cursor heart
  const SPAWN_EVERY = 0.05;                      // s between hearts added to fill gaps
  const LIFE_MIN = 6, LIFE_MAX = 14;             // s each floating heart lives before being reborn
  const FADE_IN = 1.2, FADE_OUT = 1.5;           // s
  const RELEASE_AT = 220;                        // px: hearts left this far behind let go
  const SPAWN_MAX_SPEED = 3;                     // px/frame: only fill the heart when the cursor is nearly still
  const HEART_SCALE = 4.6;                       // cursor heart size (~150px wide)

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  let W = window.innerWidth;
  let H = window.innerHeight;

  const state = {
    mx: 0, my: 0,
    dx: 0, dy: 0, dScale: 1,
    kScale: 1,
    last: 0, raf: 0,
    overCard: false, overInteractive: false,
    pressed: false, visible: false, active: false, touching: false,
  };

  /* ---------- Floating heart particles (canvas) ---------- */
  const AMBIENT_COUNT = clamp(Math.round((W * H) / 12000), 48, 120);

  const canvas = document.createElement("canvas");
  ambientLayer.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const sizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  sizeCanvas();

  // Particle color comes from the theme's --pt token
  let tone = "#e11d48";
  const readTone = () => {
    tone = getComputedStyle(root).getPropertyValue("--pt").trim() || "#e11d48";
  };
  readTone();
  new MutationObserver(readTone).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  const makeParticle = (x = Math.random() * W, y = Math.random() * H, extra = false) => {
    // Mostly small dots, a few larger ones
    const size = 3 + Math.pow(Math.random(), 2.2) * 8;

    const heading = Math.random() * Math.PI * 2;
    const speed = (0.3 + Math.random() * 0.6) * (1 - size / 22);

    return {
      size,
      alpha: 0.55 + Math.random() * 0.4,
      x, y,
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
      heading, speed,
      phase: Math.random() * Math.PI * 2,
      wander: 0.15 + Math.random() * 0.2,        // how fast the heading meanders
      influence: 0, order: 0, tx: 0, ty: 0,      // heart-formation state
      joined: false, lockMix: 0,
      extra,                                     // added to fill the cursor heart
      fade: 0,                                   // fades in when born, out when it ends
      life: LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN),   // s
      age: 0,
    };
  };

  // Short-lived hearts that pop out and fade (theme switch)
  const makeBurst = (x, y, speed) => {
    const p = makeParticle(x, y);
    const a = Math.random() * TAU;
    const v = speed * (0.4 + Math.random() * 0.8);
    p.burst = true;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v;
    p.life = 1.1 + Math.random() * 1.1;
    return p;
  };

  window.addEventListener("hearts:burst", (e) => {
    if (!state.active) return;
    const { x, y, count = 1, speed = 2 } = e.detail || {};
    for (let i = 0; i < count && ambient.length < AMBIENT_COUNT + 260; i++) {
      ambient.push(makeBurst(x, y, speed));
    }
  });

  // Theme sweep: a ring of hearts rides the edge of the growing circle
  const sweep = { active: false, start: 0, progress: 0, radius: 0, cx: 0, cy: 0, maxR: 0, riders: [] };

  window.addEventListener("hearts:sweep", (e) => {
    if (!state.active) return;
    // A sweep already running: let its riders go first
    for (const p of sweep.riders) releaseRider(p);

    const d = (e && e.detail) || {};
    sweep.cx = d.cx ?? W;
    sweep.cy = d.cy ?? 0;
    sweep.maxR = d.maxR ?? Math.hypot(W, H);
    sweep.active = true;
    sweep.start = performance.now();
    sweep.progress = 0;
    sweep.radius = 0;

    const n = 64;
    sweep.riders = Array.from({ length: n }, (_, i) => {
      const p = makeParticle(sweep.cx, sweep.cy);
      p.rider = true;
      p.fade = 0;
      p.angle = (i / n) * TAU + (Math.random() - 0.5) * 0.08;
      p.spin = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.08);   // slow drift along the ring
      p.bob = 2 + Math.random() * 5;            // px it bobs around the edge
      ambient.push(p);
      return p;
    });
  });

  // Rider leaves the edge: spills outward softly and fades
  function releaseRider(p) {
    p.rider = false;
    p.burst = true;
    p.age = 0.12;                                // already faded in
    p.life = 0.9 + Math.random() * 0.8;
    const a = p.angle ?? Math.PI * 0.75;
    const v = 0.6 + Math.random() * 1.4;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v;
  }

  const onScreen = (x, y) => x > -30 && x < W + 30 && y > -30 && y < H + 30;

  const updateSweep = (now, t, lerp) => {
    if (!sweep.active) return;
    const progress = Math.min((now - sweep.start) / ThemeReveal.duration, 1);
    const radius = ThemeReveal.radius(progress, sweep.maxR);
    sweep.progress = progress;
    sweep.radius = radius;

    for (const p of sweep.riders) {
      p.angle += p.spin * (1 / 60);
      const r = radius + Math.sin(t * 5 + p.phase) * p.bob;
      p.x = sweep.cx + Math.cos(p.angle) * r;
      p.y = sweep.cy + Math.sin(p.angle) * r;
      p.fade += (1 - p.fade) * lerp(0.25);
    }

    // Sparkle trail just inside the edge (only where it's on screen)
    if (progress < 1) {
      for (let i = 0, made = 0; i < 12 && made < 3; i++) {
        const a = Math.random() * TAU;
        const r = Math.max(radius - Math.random() * 18, 0);
        const x = sweep.cx + Math.cos(a) * r;
        const y = sweep.cy + Math.sin(a) * r;
        if (!onScreen(x, y)) continue;
        const b = makeBurst(x, y, 0.5);
        b.life = 0.6 + Math.random() * 0.6;
        ambient.push(b);
        made++;
      }
    } else {
      for (const p of sweep.riders) releaseRider(p);
      sweep.riders = [];
      sweep.active = false;
    }
  };

  // Stagger the starting ages so hearts are born and fade at different times
  const ambient = Array.from({ length: AMBIENT_COUNT }, () => {
    const p = makeParticle();
    p.age = Math.random() * p.life;
    return p;
  });

  const snap = () => {
    state.dx = state.mx;
    state.dy = state.my;
  };

  /* ---------- Click ripple + burst ---------- */
  const spawnClick = (x, y) => {
    const ring = document.createElement("span");
    ring.className = "cursor-ripple";
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    layer.appendChild(ring);
    ring.animate(
      [
        { transform: "translate(-50%, -50%) scale(0.3)", opacity: 0.55 },
        { transform: "translate(-50%, -50%) scale(2.6)", opacity: 0 },
      ],
      { duration: 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    ).onfinish = () => ring.remove();

    for (let i = 0; i < BURST_COUNT; i++) {
      const speck = document.createElement("span");
      speck.className = "cursor-burst";
      speck.style.left = `${x}px`;
      speck.style.top = `${y}px`;
      layer.appendChild(speck);
      const a = (i / BURST_COUNT) * Math.PI * 2 + Math.random() * 0.6;
      const d = 20 + Math.random() * 18;
      speck.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 0.9 },
          {
            transform: `translate(-50%, -50%) translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0.2)`,
            opacity: 0,
          },
        ],
        { duration: 520 + Math.random() * 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      ).onfinish = () => speck.remove();
    }

    // Gentle shockwave for nearby floating particles
    ambient.forEach((p) => {
      const ox = p.x - x;
      const oy = p.y - y;
      const d = Math.hypot(ox, oy) || 0.001;
      if (d < 180) {
        const push = (1 - d / 180) * 3;
        p.vx += (ox / d) * push;
        p.vy += (oy / d) * push;
      }
    });
  };

  /* ---------- Floating particle update ---------- */
  // Point on a heart outline (classic parametric heart), centred on 0,0.
  // a = 0 is the top dip; increasing a runs clockwise on screen.
  const heartPoint = (a, s) => {
    const sa = Math.sin(a);
    return {
      x: 16 * sa * sa * sa * s,
      y: (-(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) - 2.5) * s,
    };
  };
  const TAU = Math.PI * 2;

  const updateAmbient = (f, t, lerp) => {
    const hasTarget = state.visible;
    const R = state.overInteractive ? 190 : state.overCard ? 170 : 150;   // magnet reach

    // Heart size, with a gentle heartbeat
    const beat = 1 + 0.05 * Math.pow(Math.max(Math.sin(t * 2.6), 0), 6);
    const scale = HEART_SCALE * beat * (state.pressed ? 0.85 : 1);

    // How fast the cursor is moving (smoothed, px per frame)
    if (hasTarget) {
      const moved = Math.hypot(state.dx - (state.pdx ?? state.dx), state.dy - (state.pdy ?? state.dy)) / Math.max(f, 0.5);
      state.cspeed = (state.cspeed || 0) + (moved - (state.cspeed || 0)) * lerp(0.15);
    }
    state.pdx = state.dx;
    state.pdy = state.dy;

    // Magnet influence (0 = free, 1 = fully attracted)
    const members = [];
    let joined = 0;
    for (const p of ambient) if (p.joined) joined++;

    for (const p of ambient) {
      p.influence = 0;
      if (p.burst || p.rider) continue;   // theme-switch hearts ignore the magnet
      if (!hasTarget) {
        // Cursor gone / finger lifted: everyone is released
        p.joined = false;
        p.lockMix = 0;
        continue;
      }

      const d = Math.hypot(state.dx - p.x, state.dy - p.y);
      let influence = 0;
      if (d < R) {
        const u = 1 - d / R;
        influence = u * u * (3 - 2 * u);   // smoothstep
      }

      // Left far behind (cursor moved away): let go instead of chasing it
      if (p.joined && d > RELEASE_AT) {
        p.joined = false;
        p.lockMix = 0;
        joined--;
      }

      // Pulled in close enough: join the heart and stay
      if (!p.joined && influence > JOIN_AT && joined < MAX_JOINED) {
        p.joined = true;
        joined++;
      }
      if (p.joined) {
        p.lockMix += (1 - p.lockMix) * lerp(0.04);
        influence = Math.max(influence, p.lockMix);
      }

      p.influence = influence;
      if (influence > 0.02) {
        // Position around the cursor, starting from the top (the heart's dip)
        p.order = (Math.atan2(p.y - state.dy, p.x - state.dx) + Math.PI / 2 + TAU) % TAU;
        if (p.joined) {
          members.push(p);
        } else {
          // Not a member yet: drawn toward the nearest part of the outline
          const pt = heartPoint(p.order, scale);
          p.tx = state.dx + pt.x;
          p.ty = state.dy + pt.y;
        }
      }
    }

    // Add new hearts into the biggest empty gap until the outline is complete
    const settled = hasTarget && (state.cspeed || 0) < SPAWN_MAX_SPEED;
    state.spawnClock = settled ? (state.spawnClock || 0) + f / 60 : 0;
    while (settled && joined < MAX_JOINED && state.spawnClock >= SPAWN_EVERY) {
      state.spawnClock -= SPAWN_EVERY;

      let gapAt = Math.random() * TAU;
      if (members.length) {
        members.sort((a, b) => a.order - b.order);
        let best = -1;
        for (let i = 0; i < members.length; i++) {
          const from = members[i].order;
          const to = i + 1 < members.length ? members[i + 1].order : members[0].order + TAU;
          if (to - from > best) { best = to - from; gapAt = (from + best / 2) % TAU; }
        }
      }

      // Appear just outside the gap and glide in
      const pt = heartPoint(gapAt, scale * 1.2);
      const p = makeParticle(state.dx + pt.x, state.dy + pt.y, true);
      p.vx = p.vy = 0;
      p.joined = true;
      p.lockMix = 0.5;
      p.influence = 1;
      p.order = gapAt;
      ambient.push(p);
      members.push(p);
      joined++;
    }

    // Spread members evenly along the heart outline, keeping their order
    members.sort((a, b) => a.order - b.order);
    const n = members.length;
    for (let i = 0; i < n; i++) {
      const pt = heartPoint(((i + 0.5) / n) * TAU, scale);
      members[i].tx = state.dx + pt.x;
      members[i].ty = state.dy + pt.y;
    }

    // Life cycle: hearts keep fading in and out all over the page
    for (let i = ambient.length - 1; i >= 0; i--) {
      const p = ambient[i];
      if (p.rider) continue;   // riders are driven by the theme sweep

      if (p.burst) {
        // Pop in fast, fade out, then go
        p.age += f / 60;
        p.fade = clamp(Math.min(p.age / 0.12, (p.life - p.age) / 0.8), 0, 1);
        if (p.age >= p.life) ambient.splice(i, 1);
        continue;
      }

      if (p.extra) {
        // Extras fade in while in the cursor heart and fade out (then go) once released
        p.fade += ((p.joined ? 1 : 0) - p.fade) * lerp(p.joined ? 0.12 : 0.03);
        if (!p.joined && p.fade < 0.01) ambient.splice(i, 1);
        continue;
      }

      p.age += f / 60;
      // Hearts held in the cursor heart don't age out
      if (p.joined) p.age = Math.min(p.age, p.life - FADE_OUT);

      if (p.age >= p.life) {
        // Reborn somewhere new
        Object.assign(p, makeParticle());
        continue;
      }
      p.fade = clamp(Math.min(p.age / FADE_IN, (p.life - p.age) / FADE_OUT), 0, 1);
    }

    for (const p of ambient) {
      if (p.rider) continue;
      // Smoothly meandering heading (continuous, no per-frame randomness)
      const heading = p.heading + Math.sin(t * p.wander + p.phase) * 1.2;
      const influence = p.influence;

      // Free drift, fading out as the magnet takes over
      const drift = 1 - influence;
      const tvx = Math.cos(heading) * p.speed;
      const tvy = Math.sin(heading) * p.speed;
      const blend = lerp(0.02 * drift);
      p.vx += (tvx - p.vx) * blend;
      p.vy += (tvy - p.vy) * blend;

      // Spring toward its slot on the heart outline
      if (influence > 0.02) {
        const k = 0.006 * influence * state.kScale;
        p.vx += (p.tx - p.x) * k * f;
        p.vy += (p.ty - p.y) * k * f;

        const damp = Math.pow(1 - 0.1 * influence, f);
        p.vx *= damp;
        p.vy *= damp;
      }

      // Soft speed limit (eases down instead of clipping)
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAX_SPEED) {
        const k = 1 - lerp(0.2) * (1 - MAX_SPEED / sp);
        p.vx *= k;
        p.vy *= k;
      }

      p.x += p.vx * f;
      p.y += p.vy * f;

      // Wrap around the viewport edges
      if (p.x < -60) p.x = W + 60; else if (p.x > W + 60) p.x = -60;
      if (p.y < -60) p.y = H + 60; else if (p.y > H + 60) p.y = -60;
    }
  };

  /* ---------- Floating particle draw ---------- */
  // Unit heart outline (classic parametric heart), centred and ~1 unit wide
  const HEART = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    return {
      x: (16 * Math.sin(a) ** 3) / 32,
      y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 32 - 0.08,
    };
  });

  const drawHeart = (x, y, w) => {
    ctx.beginPath();
    ctx.moveTo(x + HEART[0].x * w, y + HEART[0].y * w);
    for (let i = 1; i < HEART.length; i++) ctx.lineTo(x + HEART[i].x * w, y + HEART[i].y * w);
    ctx.closePath();
    ctx.fill();
  };

  // Soft glowing ring along the edge of the circle while the theme changes
  const drawSweepGlow = () => {
    if (!sweep.active || sweep.radius < 1) return;
    ctx.save();
    ctx.globalAlpha = 0.75 * Math.sin(Math.PI * Math.min(sweep.progress * 1.1, 1));   // fades in and out
    ctx.strokeStyle = tone;
    ctx.lineWidth = 2;
    ctx.shadowColor = tone;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(sweep.cx, sweep.cy, sweep.radius, 0, TAU);
    ctx.stroke();
    ctx.restore();
  };

  const drawAmbient = () => {
    ctx.clearRect(0, 0, W, H);
    drawSweepGlow();
    ctx.fillStyle = tone;

    for (const p of ambient) {
      ctx.globalAlpha = p.alpha * p.fade;
      drawHeart(p.x, p.y, Math.max(p.size * 1.6, 7));
    }
    ctx.globalAlpha = 1;
  };

  /* ---------- Animation loop ---------- */
  const tick = (now) => {
    state.raf = requestAnimationFrame(tick);

    const dt = Math.min((now - state.last) / 1000 || 0.016, 0.05);
    state.last = now;
    const f = dt * 60;           // 1 at 60fps
    const t = now / 1000;
    const lerp = (rate) => 1 - Math.pow(1 - rate, f);

    // Hover-based magnetism strength
    const kTarget = state.overInteractive ? 1.3 : state.overCard ? 1.1 : 1;
    state.kScale += (kTarget - state.kScale) * lerp(0.06);

    if (state.visible) {
      // Arrow cursor: sits exactly on the pointer (no lag), shrinks a little when pressed
      state.dx = state.mx;
      state.dy = state.my;
      const scaleTarget = state.pressed ? 0.86 : state.overInteractive ? 1.08 : 1;
      state.dScale += (scaleTarget - state.dScale) * lerp(0.3);
      dot.style.transform =
        `translate3d(${state.dx - TIP_X}px, ${state.dy - TIP_Y}px, 0) scale(${state.dScale})`;
    }

    updateSweep(now, t, lerp);
    updateAmbient(f, t, lerp);
    drawAmbient();
  };

  /* ---------- Events ---------- */
  const isTouch = (e) => !!e.pointerType && e.pointerType !== "mouse";

  const onMove = (e) => {
    const touch = isTouch(e);
    // Touch/pen only attract the hearts while the finger is down
    if (touch && !state.touching) return;
    state.mx = e.clientX;
    state.my = e.clientY;

    if (!state.visible) {
      snap();
      state.visible = true;
      if (!touch) root.classList.add("has-custom-cursor");
      layer.classList.add("is-visible");
    }
    layer.classList.toggle("is-touch", touch);

    const target = e.target;
    state.overInteractive = !!(target.closest && target.closest(INTERACTIVE));
    state.overCard = !!(target.closest && target.closest(".card, .profile-head, .cover"));
    dot.classList.toggle("is-active", state.overInteractive);
  };

  const inChat = (e) => !!(e.target && e.target.closest && e.target.closest(".chat, .viewers, .topbar, .post-dialog"));

  const onDown = (e) => {
    // Touches in the chat are for scrolling and typing, not for the hearts
    if (isTouch(e) && inChat(e)) return;
    if (isTouch(e)) {
      state.touching = true;
      onMove(e);
    }
    state.pressed = true;
    spawnClick(e.clientX, e.clientY);
  };

  const onUp = (e) => {
    state.pressed = false;
    // Lifting the finger releases the hearts
    if (state.touching && (!e || isTouch(e))) {
      state.touching = false;
      state.visible = false;
    }
  };

  const onLeave = () => {
    state.visible = false;
    state.pressed = false;
    layer.classList.remove("is-visible");
  };

  const onResize = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    sizeCanvas();
  };

  /* ---------- Enable / disable ---------- */
  const enable = () => {
    if (state.active) return;
    state.active = true;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    window.addEventListener("resize", onResize);
    root.addEventListener("mouseleave", onLeave);
    ambientLayer.classList.add("is-visible");
    state.last = performance.now();
    state.raf = requestAnimationFrame(tick);
  };

  const disable = () => {
    if (!state.active) return;
    state.active = false;
    state.visible = false;
    cancelAnimationFrame(state.raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("blur", onUp);
    window.removeEventListener("resize", onResize);
    root.removeEventListener("mouseleave", onLeave);
    root.classList.remove("has-custom-cursor");
    layer.classList.remove("is-visible");
    ambientLayer.classList.remove("is-visible");
    ctx.clearRect(0, 0, W, H);
    layer.querySelectorAll(".cursor-ripple, .cursor-burst").forEach((n) => n.remove());
  };

  // Runs on every device (mouse and touch); only reduced-motion turns it off
  const sync = () => (reduceMotion.matches ? disable() : enable());
  sync();
  reduceMotion.addEventListener("change", sync);
})();
/* ---------- Portrait tilt ---------- */
(() => {
  const portrait = document.getElementById("portrait");
  if (!portrait) return;
  const frame = portrait.querySelector(".portrait-frame");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const MAX_TILT = 8;   // degrees

  portrait.addEventListener("pointermove", (e) => {
    if (!finePointer.matches || reduceMotion.matches) return;
    const r = portrait.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    frame.style.setProperty("--rx", `${(x * MAX_TILT).toFixed(2)}deg`);
    frame.style.setProperty("--ry", `${(-y * MAX_TILT).toFixed(2)}deg`);
  });

  portrait.addEventListener("pointerleave", () => {
    frame.style.setProperty("--rx", "0deg");
    frame.style.setProperty("--ry", "0deg");
  });
})();

/* ---------- Pinned post: Share ---------- */
// (Likes are saved in Firestore, one per device — see chat.js)
(() => {
  const shareBtn = document.getElementById("postShare");
  if (!shareBtn) return;

  // Small message at the bottom of the screen
  let toastTimer = 0;
  const toast = (text) => {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.append(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => el.classList.add("is-shown"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-shown"), text.length > 40 ? 6000 : 2200);
  };
  window.showToast = toast;

  shareBtn.addEventListener("click", async () => {
    const url = location.href.split("#")[0];
    if (navigator.share) {
      try { await navigator.share({ title: document.title, url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast(url);
    }
  });
})();

/* ---------- Fixed top bar: compact mode + section highlight ---------- */
(() => {
  const bar = document.getElementById("topbar");
  const name = document.getElementById("name");
  if (!bar || !name) return;

  // Compact once the profile name has scrolled under the bar
  const updateCompact = () => {
    bar.classList.toggle("is-compact", name.getBoundingClientRect().bottom < bar.offsetHeight);
  };

  const links = [...document.querySelectorAll("a[data-section]")];
  const indicator = bar.querySelector(".top-indicator");
  const ids = ["posts", "about", "photos"];
  const sections = ids.map((id) => document.getElementById(id)).filter(Boolean);

  // Slide the pill behind the active link in the bar
  const moveIndicator = () => {
    const active = bar.querySelector(".top-link.is-active");
    if (!active || !indicator) return;
    indicator.style.setProperty("--x", `${active.offsetLeft - 4}px`);
    indicator.style.setProperty("--w", `${active.offsetWidth}px`);
  };

  let current = "posts";
  const setActive = (id) => {
    current = id;
    for (const l of links) {
      const on = l.dataset.section === id;
      l.classList.toggle("is-active", on);
      if (on) l.setAttribute("aria-current", "page");
      else l.removeAttribute("aria-current");
    }
    moveIndicator();
  };

  // Clicking a section link highlights it straight away
  let lockedUntil = 0;
  for (const l of links) {
    l.addEventListener("click", () => {
      setActive(l.dataset.section);
      lockedUntil = performance.now() + 900;   // ignore scroll updates while it scrolls there
    });
  }

  // On stacked (one-column) layouts, follow the section being read
  const stacked = window.matchMedia("(max-width: 900px)");
  let ticking = false;
  const onScroll = () => {
    updateCompact();
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!stacked.matches || performance.now() < lockedUntil) return;
      const line = 120;
      let best = null;
      for (const s of sections) {
        const top = s.getBoundingClientRect().top;
        if (top <= line && (!best || top > best.top)) best = { id: s.id, top };
      }
      const id = best ? best.id : sections[0]?.id;
      if (id && id !== current) setActive(id);
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", moveIndicator);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
  setActive(current);
  updateCompact();
})();
