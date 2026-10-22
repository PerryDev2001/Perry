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
    const next = theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", `Switch to ${next} theme`);
  };

  applyTheme(getStored() || (systemPrefersDark.matches ? "dark" : "light"));

  toggle.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    setStored(next);
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
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const INTERACTIVE = "a, button, [role='button'], input, textarea, select, summary, label";
  const DOT_SIZE = 10;
  const BURST_COUNT = 8;
  const MAX_SPEED = 5;
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
    pressed: false, visible: false, active: false,
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

  const ambient = Array.from({ length: AMBIENT_COUNT }, () => {
    // Mostly small dots, a few larger ones
    const size = 3 + Math.pow(Math.random(), 2.2) * 8;

    const heading = Math.random() * Math.PI * 2;
    const speed = (0.3 + Math.random() * 0.6) * (1 - size / 22);
    const x = Math.random() * W;
    const y = Math.random() * H;

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
    };
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
  const captured = [];

  const updateAmbient = (f, t, lerp) => {
    const hasTarget = state.visible;
    const R = state.overInteractive ? 340 : state.overCard ? 300 : 260;   // magnet reach

    // Heart size, with a gentle heartbeat
    const beat = 1 + 0.05 * Math.pow(Math.max(Math.sin(t * 2.6), 0), 6);
    const scale = HEART_SCALE * beat * (state.pressed ? 0.85 : 1);

    // Magnet influence (0 = free, 1 = fully attracted)
    captured.length = 0;
    for (const p of ambient) {
      p.influence = 0;
      if (!hasTarget) continue;
      const d = Math.hypot(state.dx - p.x, state.dy - p.y);
      if (d < R) {
        const u = 1 - d / R;
        p.influence = u * u * (3 - 2 * u);   // smoothstep
        if (p.influence > 0.02) {
          // Order around the cursor, starting from the top (the heart's dip)
          p.order = (Math.atan2(p.y - state.dy, p.x - state.dx) + Math.PI / 2 + TAU) % TAU;
          captured.push(p);
        }
      }
    }

    // Spread captured particles evenly along the heart outline, keeping their order
    captured.sort((a, b) => a.order - b.order);
    const n = captured.length;
    for (let i = 0; i < n; i++) {
      const pt = heartPoint(((i + 0.5) / n) * TAU, scale);
      captured[i].tx = state.dx + pt.x;
      captured[i].ty = state.dy + pt.y;
    }

    for (const p of ambient) {
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
        const k = 0.012 * influence * state.kScale;
        p.vx += (p.tx - p.x) * k * f;
        p.vy += (p.ty - p.y) * k * f;

        const damp = Math.pow(1 - 0.14 * influence, f);
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

  const drawAmbient = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = tone;

    for (const p of ambient) {
      ctx.globalAlpha = p.alpha;
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
    const kTarget = state.overInteractive ? 1.6 : state.overCard ? 1.25 : 1;
    state.kScale += (kTarget - state.kScale) * lerp(0.06);

    if (state.visible) {
      // Main dot
      state.dx += (state.mx - state.dx) * lerp(0.35);
      state.dy += (state.my - state.dy) * lerp(0.35);
      const scaleTarget = state.pressed ? 0.75 : state.overInteractive ? 1.8 : 1;
      state.dScale += (scaleTarget - state.dScale) * lerp(0.2);
      dot.style.transform =
        `translate3d(${state.dx - DOT_SIZE / 2}px, ${state.dy - DOT_SIZE / 2}px, 0) scale(${state.dScale})`;
    }

    updateAmbient(f, t, lerp);
    drawAmbient();
  };

  /* ---------- Events ---------- */
  const onMove = (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    state.mx = e.clientX;
    state.my = e.clientY;

    if (!state.visible) {
      snap();
      state.visible = true;
      root.classList.add("has-custom-cursor");
      layer.classList.add("is-visible");
    }

    const target = e.target;
    state.overInteractive = !!(target.closest && target.closest(INTERACTIVE));
    state.overCard = !!(target.closest && target.closest(".hero"));
    dot.classList.toggle("is-active", state.overInteractive);
  };

  const onDown = (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    state.pressed = true;
    spawnClick(e.clientX, e.clientY);
  };

  const onUp = () => { state.pressed = false; };

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

  const sync = () => (finePointer.matches && !reduceMotion.matches ? enable() : disable());
  sync();
  finePointer.addEventListener("change", sync);
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
