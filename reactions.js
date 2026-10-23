/* ---------- Message reactions (Community Chat + private messages) ---------- */
// Shared by the public page (chat.js) and the dashboard (dashboard.js). Each person has at
// most one reaction per message, saved as "{message id}_{their uid}": picking the same emoji
// again removes it, picking another one changes it. firestore.rules enforce the same.
(() => {
  const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
  const LONG_PRESS_MS = 450;
  const REPLY_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
  const COPY_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
  const MORE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></svg>';
  const SMILEY_PLUS =
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5a8.5 8.5 0 1 1-8-8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/><path d="M19 2.5v5M16.5 5h5"/></svg>';

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;   // textContent: never HTML
    return n;
  };

  /* ----- One small picker per page ----- */
  let pop = null;
  let popFor = null;   // { ctl, msgId, anchor, opener }

  const closePop = () => {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (popFor?.opener) popFor.opener.setAttribute("aria-expanded", "false");
    popFor = null;
  };

  const place = () => {
    if (!popFor) return;
    const r = popFor.anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const ht = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.top - ht - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - ht - 8);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(8, top))}px`;
  };

  const renderPop = () => {
    if (!popFor) return;
    const { ctl, msgId } = popFor;
    const list = ctl.listFor(msgId);
    const mine = ctl.myUid();
    const myEmoji = list.find((r) => r.uid === mine)?.emoji;

    const bar = h("div", "rx-bar");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Reactions");
    for (const e of EMOJIS) {
      const b = h("button", "rx-pick", e);
      b.type = "button";
      const on = e === myEmoji;
      if (on) b.classList.add("is-selected");
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", on ? `Remove ${e}` : `React ${e}`);
      b.addEventListener("click", () => {
        ctl.toggle(msgId, e);
        closePop();
      });
      bar.append(b);
    }

    const parts = [bar];

    // Reply / Copy (the only way on phones, where there's no hover)
    const opts = ctl.optsFor(msgId);
    if (opts && (opts.onReply || opts.copyText)) {
      const acts = h("div", "rx-actions");
      if (opts.onReply) {
        const b = h("button", "rx-act");
        b.type = "button";
        b.innerHTML = REPLY_ICON;   // fixed markup
        b.append(h("span", "", "Reply"));
        b.addEventListener("click", () => { closePop(); opts.onReply(); });
        acts.append(b);
      }
      if (opts.copyText) {
        const b = h("button", "rx-act");
        b.type = "button";
        b.innerHTML = COPY_ICON;   // fixed markup
        b.append(h("span", "", "Copy"));
        b.addEventListener("click", async () => {
          closePop();
          try {
            await navigator.clipboard.writeText(opts.copyText);
            if (window.showToast) window.showToast("Copied");
          } catch { /* clipboard blocked */ }
        });
        acts.append(b);
      }
      parts.push(acts);
    }

    if (list.length) {
      // Who reacted
      const who = h("div", "rx-who");
      who.append(h("p", "rx-who-title", `Reactions · ${list.length}`));
      const ul = h("ul");
      for (const r of list) {
        const li = h("li");
        const isMe = r.uid === mine;
        li.append(h("span", "rx-emoji", r.emoji), h("span", "rx-name", isMe ? "You" : (r.name || "Anonymous")));
        if (isMe) li.append(h("span", "rx-hint", "Tap it again to remove"));
        else if (r.admin) li.append(h("span", "rx-hint", "Owner"));
        ul.append(li);
      }
      who.append(ul);
      parts.push(who);
    }
    pop.replaceChildren(...parts);
    place();
  };

  const openPop = (ctl, msgId, anchor, opener) => {
    if (!pop) {
      pop = h("div", "rx-pop");
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "React to message");
      pop.hidden = true;
      document.body.append(pop);
    }
    if (popFor && popFor.ctl === ctl && popFor.msgId === msgId && !pop.hidden) { closePop(); return; }
    closePop();
    popFor = { ctl, msgId, anchor, opener };
    if (opener) opener.setAttribute("aria-expanded", "true");
    pop.hidden = false;
    renderPop();
    pop.querySelector(".rx-pick.is-selected, .rx-pick")?.focus({ preventScroll: true });
  };

  document.addEventListener("pointerdown", (e) => {
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target) || e.target.closest?.(".rx-add")) return;
    closePop();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop && !pop.hidden) { e.stopPropagation(); closePop(); } }, true);
  // Scrolling or resizing keeps the picker next to its message (it closes once the message is out of view)
  const follow = (e) => {
    if (!pop || pop.hidden || !popFor || (e && pop.contains(e.target))) return;
    const r = popFor.anchor.getBoundingClientRect();
    if (!popFor.anchor.isConnected || r.bottom < 0 || r.top > window.innerHeight) closePop();
    else place();
  };
  window.addEventListener("resize", follow);
  document.addEventListener("scroll", follow, true);

  /* ----- A reactions controller for one conversation ----- */
  // fs: Firestore functions. path: where the reactions live. me(): who is reacting now
  // ({ uid, name, admin } or null). ensureMe(): signs in if needed and returns me().
  window.createReactions = ({ fs, db, path, me, ensureMe, onError }) => {
    const { collection, doc, query, limit, onSnapshot, setDoc, deleteDoc, serverTimestamp } = fs;
    const ref = collection(db, ...path);
    const scope = path.join("/");
    let byMsg = new Map();
    let unsub = null;
    const optsByMsg = new Map();   // message id -> { onReply, copyText }

    const listFor = (id) => byMsg.get(id) || [];
    const myUid = () => me()?.uid || null;

    const fillRow = (row) => {
      const id = row.dataset.rx;
      const list = listFor(id);
      row.hidden = !list.length;
      if (!list.length) { row.replaceChildren(); return; }
      const groups = new Map();
      for (const r of list) {
        if (!groups.has(r.emoji)) groups.set(r.emoji, []);
        groups.get(r.emoji).push(r);
      }
      const mine = myUid();
      row.replaceChildren(...[...groups].sort((a, b) => b[1].length - a[1].length).map(([emoji, people]) => {
        const chip = h("button", "rx-chip");
        chip.type = "button";
        const isMine = people.some((p) => p.uid === mine);
        if (isMine) chip.classList.add("is-mine");
        chip.append(h("span", "rx-emoji", emoji));
        if (people.length > 1) chip.append(h("span", "rx-count", String(people.length)));
        const names = people.map((p) => (p.uid === mine ? "You" : (p.name || "Anonymous"))).join(", ");
        chip.title = names;
        chip.setAttribute("aria-label", `${emoji} ${people.length}: ${names}${isMine ? " (click to remove yours)" : ""}`);
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          // Chip = toggle that emoji; press and hold (phones) = see who reacted
          ctl.toggle(id, emoji);
        });
        chip.addEventListener("contextmenu", (e) => { e.preventDefault(); openPop(ctl, id, row); });
        return chip;
      }));
    };

    const refresh = () => {
      for (const row of document.querySelectorAll(".rx-row")) if (row.dataset.rxScope === scope) fillRow(row);
      if (popFor && popFor.ctl === ctl && pop && !pop.hidden) renderPop();
    };

    const toggle = async (msgId, emoji) => {
      let who;
      try {
        who = await ensureMe();
      } catch (err) {
        console.error(err);
        onError?.(err);
        return;
      }
      if (!who) return;
      const id = `${msgId}_${who.uid}`;
      const before = listFor(msgId);
      const current = before.find((r) => r.uid === who.uid);
      const removing = Boolean(current && current.emoji === emoji);
      const others = before.filter((r) => r.uid !== who.uid);

      // Show it straight away; the live listener confirms it
      byMsg.set(msgId, removing ? others : [...others, { id, msg: msgId, uid: who.uid, emoji, name: who.name, admin: Boolean(who.admin), t: Date.now() }]);
      refresh();
      try {
        if (removing) await deleteDoc(doc(ref, id));
        else {
          await setDoc(doc(ref, id), {
            msg: msgId,
            uid: who.uid,
            emoji,
            name: String(who.name || "Anonymous").slice(0, 60),
            admin: Boolean(who.admin),
            createdAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.error(err);
        byMsg.set(msgId, before);
        refresh();
        onError?.(err);
      }
    };

    const start = () => {
      if (unsub) return;
      unsub = onSnapshot(
        query(ref, limit(2000)),
        (snap) => {
          const next = new Map();
          for (const d of snap.docs) {
            const v = d.data({ serverTimestamps: "estimate" });
            if (!v.msg || !EMOJIS.includes(v.emoji)) continue;
            const t = v.createdAt?.toMillis?.() ?? v.createdAt?.toDate?.()?.getTime?.() ?? 0;
            if (!next.has(v.msg)) next.set(v.msg, []);
            next.get(v.msg).push({ id: d.id, ...v, t });
          }
          for (const list of next.values()) list.sort((a, b) => a.t - b.t);
          byMsg = next;
          refresh();
        },
        (err) => console.warn("Reactions not loaded:", err.code || err)
      );
    };

    const stop = () => {
      if (unsub) unsub();
      unsub = null;
      byMsg = new Map();
      if (popFor && popFor.ctl === ctl) closePop();
    };

    // Adds the reaction badges under a message and the actions beside it (react, reply, more).
    // item: the message row, body: the column holding the bubble.
    // opts: { onReply(), copyText, who } — Reply / Copy for this message.
    const decorate = (item, body, msgId, opts = {}) => {
      optsByMsg.set(msgId, opts);
      const row = h("div", "rx-row");
      row.dataset.rx = msgId;
      row.dataset.rxScope = scope;
      fillRow(row);
      body.append(row);

      const actions = h("div", "msg-actions");
      const add = h("button", "rx-add msg-act");
      add.type = "button";
      add.dataset.tip = "React";
      add.setAttribute("aria-label", "React to this message");
      add.setAttribute("aria-haspopup", "dialog");
      add.setAttribute("aria-expanded", "false");
      add.innerHTML = SMILEY_PLUS;   // fixed markup
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        openPop(ctl, msgId, body, add);
      });
      actions.append(add);

      if (opts.onReply) {
        const reply = h("button", "msg-act");
        reply.type = "button";
        reply.dataset.tip = "Reply";
        reply.setAttribute("aria-label", `Reply to message${opts.who ? ` from ${opts.who}` : ""}`);
        reply.innerHTML = REPLY_ICON;   // fixed markup
        reply.addEventListener("click", (e) => { e.stopPropagation(); opts.onReply(); });
        actions.append(reply);
      }

      if (opts.copyText) {
        const more = h("button", "rx-add msg-act");
        more.type = "button";
        more.dataset.tip = "More";
        more.setAttribute("aria-label", "More actions");
        more.setAttribute("aria-haspopup", "dialog");
        more.setAttribute("aria-expanded", "false");
        more.innerHTML = MORE_ICON;   // fixed markup
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          openPop(ctl, msgId, body, more);
        });
        actions.append(more);
      }
      item.append(actions);

      // Phones and tablets: press and hold the message
      let timer = 0;
      let sx = 0;
      let sy = 0;
      const cancel = () => { clearTimeout(timer); timer = 0; };
      item.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" || e.target.closest(".rx-chip, .rx-add, button")) return;
        sx = e.clientX;
        sy = e.clientY;
        timer = setTimeout(() => {
          timer = 0;
          if (navigator.vibrate) navigator.vibrate(12);
          openPop(ctl, msgId, body, add);
        }, LONG_PRESS_MS);
      });
      item.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
      item.addEventListener("pointerup", cancel);
      item.addEventListener("pointercancel", cancel);
      item.addEventListener("pointerleave", cancel);
      item.addEventListener("contextmenu", (e) => { if (matchMedia("(pointer: coarse)").matches) e.preventDefault(); });
    };

    const optsFor = (id) => optsByMsg.get(id) || null;
    const ctl = { start, stop, decorate, toggle, listFor, myUid, refresh, optsFor };
    return ctl;
  };
})();
