/* ---------- Emoji picker (shared by the public page and the dashboard) ---------- */
// Native emoji (the device's own: Apple, Google, Microsoft…), so emoji look the same in the
// picker, in sent messages and in reactions. Categories, search, recently used, skin tones.
(() => {
  // [emoji, search words]
  const CATEGORIES = [
    { id: "smileys", icon: "😀", label: "Smileys & emotion", items: [
      ["😀", "grinning smile happy"], ["😃", "smiley happy joy"], ["😄", "smile happy laugh"], ["😁", "grin beaming"],
      ["😆", "laughing squint"], ["😅", "sweat smile relief"], ["🤣", "rofl rolling laughing"], ["😂", "joy tears laughing lol haha"],
      ["🙂", "slight smile"], ["😉", "wink"], ["😊", "blush smile happy"], ["😇", "halo angel innocent"],
      ["🥰", "love hearts adore"], ["😍", "heart eyes love"], ["🤩", "star struck excited"], ["😘", "kiss blow love"],
      ["😗", "kissing"], ["😚", "kissing closed eyes"], ["😙", "kissing smiling"], ["🥲", "smile tear grateful"],
      ["😋", "yum delicious tongue"], ["😛", "tongue out"], ["😜", "wink tongue silly"], ["🤪", "zany crazy goofy"],
      ["😝", "squint tongue"], ["🤗", "hug hugging"], ["🤭", "hand over mouth giggle oops"], ["🤫", "shush quiet secret"],
      ["🤔", "thinking hmm"], ["🤐", "zipper mouth secret"], ["🤨", "raised eyebrow skeptical"], ["😐", "neutral"],
      ["😑", "expressionless"], ["😶", "no mouth silent"], ["😏", "smirk"], ["😒", "unamused meh"],
      ["🙄", "eye roll"], ["😬", "grimace awkward"], ["😮‍💨", "exhale sigh relief"], ["🤥", "lying pinocchio"],
      ["😌", "relieved calm"], ["😔", "pensive sad"], ["😪", "sleepy"], ["🤤", "drool"],
      ["😴", "sleeping zzz tired"], ["😷", "mask sick"], ["🤒", "thermometer sick fever"], ["🤕", "bandage hurt"],
      ["🤢", "nauseated sick"], ["🤮", "vomit sick"], ["🥵", "hot sweat heat"], ["🥶", "cold freezing"],
      ["🥴", "woozy dizzy"], ["😵", "dizzy knocked"], ["🤯", "mind blown exploding"], ["🤠", "cowboy"],
      ["🥳", "party celebrate birthday"], ["🥸", "disguise"], ["😎", "cool sunglasses"], ["🤓", "nerd geek"],
      ["🧐", "monocle curious"], ["😕", "confused"], ["😟", "worried"], ["🙁", "frown sad"],
      ["😮", "open mouth wow surprised"], ["😯", "hushed surprised"], ["😲", "astonished shocked"], ["😳", "flushed embarrassed"],
      ["🥺", "pleading puppy eyes please"], ["🥹", "holding back tears touched"], ["😦", "frowning open mouth"], ["😧", "anguished"],
      ["😨", "fearful scared"], ["😰", "anxious sweat"], ["😥", "sad relieved"], ["😢", "cry sad tear"],
      ["😭", "sob crying loud"], ["😱", "scream fear shocked"], ["😖", "confounded"], ["😣", "persevere"],
      ["😞", "disappointed"], ["😓", "downcast sweat"], ["😩", "weary tired"], ["😫", "tired exhausted"],
      ["🥱", "yawn bored sleepy"], ["😤", "triumph huff steam"], ["😡", "pouting angry mad"], ["😠", "angry mad"],
      ["🤬", "cursing swearing angry"], ["😈", "smiling devil evil"], ["👿", "angry devil imp"], ["💀", "skull dead"],
      ["💩", "poop pile"], ["🤡", "clown"], ["👻", "ghost boo"], ["👽", "alien ufo"], ["🤖", "robot bot"],
    ] },
    { id: "hearts", icon: "❤️", label: "Hearts & love", items: [
      ["❤️", "red heart love"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"],
      ["💙", "blue heart"], ["💜", "purple heart"], ["🤎", "brown heart"], ["🖤", "black heart"],
      ["🤍", "white heart"], ["🩷", "pink heart"], ["🩵", "light blue heart"], ["🩶", "grey heart"],
      ["❤️‍🔥", "heart on fire passion"], ["❤️‍🩹", "mending heart healing"], ["💕", "two hearts love"], ["💞", "revolving hearts"],
      ["💓", "beating heart"], ["💗", "growing heart"], ["💖", "sparkling heart"], ["💘", "heart arrow cupid"],
      ["💝", "heart ribbon gift"], ["💟", "heart decoration"], ["❣️", "heart exclamation"], ["💔", "broken heart"],
      ["💌", "love letter"], ["💋", "kiss mark lips"], ["😻", "cat heart eyes"], ["💐", "bouquet flowers"], ["🌹", "rose flower"],
    ] },
    { id: "people", icon: "👋", label: "Hands & people", items: [
      ["👋", "wave hello hi bye"], ["🤚", "raised back of hand"], ["🖐️", "hand fingers splayed"], ["✋", "raised hand stop high five"],
      ["🖖", "vulcan salute"], ["👌", "ok perfect"], ["🤌", "pinched fingers"], ["🤏", "pinching small"],
      ["✌️", "peace victory"], ["🤞", "crossed fingers luck"], ["🫰", "hand index thumb crossed money"], ["🤟", "love you gesture"],
      ["🤘", "rock on horns"], ["🤙", "call me shaka"], ["👈", "point left"], ["👉", "point right"],
      ["👆", "point up"], ["👇", "point down"], ["☝️", "index up"], ["🫵", "point at you"],
      ["👍", "thumbs up like yes good"], ["👎", "thumbs down dislike no"], ["✊", "raised fist"], ["👊", "punch fist bump"],
      ["🤛", "left fist"], ["🤜", "right fist"], ["👏", "clap applause"], ["🙌", "raising hands praise hooray"],
      ["🫶", "heart hands love"], ["👐", "open hands"], ["🤲", "palms up"], ["🤝", "handshake deal"],
      ["🙏", "pray please thanks folded hands"], ["✍️", "writing"], ["💪", "flexed biceps strong muscle"], ["🫡", "salute"],
      ["🙋", "raising hand"], ["🙆", "ok gesture"], ["🙅", "no gesture"], ["🤷", "shrug idk"],
      ["🤦", "facepalm"], ["🙇", "bow sorry"], ["💃", "dancer dance"], ["🕺", "man dancing"],
      ["🏃", "running run"], ["🚴", "biking cycling"], ["🏊", "swimming swim"], ["🧘", "yoga meditate"],
      ["👀", "eyes look"], ["🙈", "see no evil monkey"], ["🙉", "hear no evil monkey"], ["🙊", "speak no evil monkey"],
    ] },
    { id: "nature", icon: "🌿", label: "Animals & nature", items: [
      ["🐶", "dog puppy"], ["🐱", "cat kitten"], ["🐭", "mouse"], ["🐹", "hamster"], ["🐰", "rabbit bunny"],
      ["🦊", "fox"], ["🐻", "bear"], ["🐼", "panda"], ["🐨", "koala"], ["🐯", "tiger"], ["🦁", "lion"],
      ["🐮", "cow"], ["🐷", "pig"], ["🐸", "frog"], ["🐵", "monkey"], ["🐔", "chicken"], ["🐧", "penguin"],
      ["🐦", "bird"], ["🐤", "chick"], ["🦄", "unicorn"], ["🐝", "bee honey"], ["🦋", "butterfly"],
      ["🐢", "turtle"], ["🐍", "snake"], ["🐙", "octopus"], ["🐬", "dolphin"], ["🐳", "whale"], ["🦈", "shark"],
      ["🌸", "cherry blossom flower"], ["🌼", "blossom flower"], ["🌻", "sunflower"], ["🌺", "hibiscus flower"],
      ["🌷", "tulip flower"], ["🍀", "clover luck"], ["🌿", "herb leaf plant"], ["🌵", "cactus"], ["🌴", "palm tree beach"],
      ["🍁", "maple leaf autumn"], ["🌈", "rainbow"], ["☀️", "sun sunny"], ["🌙", "moon night"], ["⭐", "star"],
      ["🌟", "glowing star"], ["✨", "sparkles"], ["⚡", "lightning zap"], ["🔥", "fire lit hot"], ["💧", "droplet water"],
      ["🌊", "wave ocean sea"], ["❄️", "snowflake cold"], ["☃️", "snowman winter"],
    ] },
    { id: "food", icon: "🍔", label: "Food & drink", items: [
      ["🍎", "apple"], ["🍓", "strawberry"], ["🍒", "cherries"], ["🍑", "peach"], ["🥭", "mango"],
      ["🍍", "pineapple"], ["🍌", "banana"], ["🍉", "watermelon"], ["🍇", "grapes"], ["🥑", "avocado"],
      ["🍅", "tomato"], ["🌽", "corn"], ["🥕", "carrot"], ["🍞", "bread"], ["🧀", "cheese"],
      ["🍳", "egg cooking breakfast"], ["🥓", "bacon"], ["🍔", "burger hamburger"], ["🍟", "fries"], ["🍕", "pizza"],
      ["🌭", "hot dog"], ["🌮", "taco"], ["🌯", "burrito"], ["🍜", "noodles ramen"], ["🍝", "spaghetti pasta"],
      ["🍣", "sushi"], ["🍱", "bento"], ["🍚", "rice"], ["🍛", "curry rice"], ["🍤", "shrimp tempura"],
      ["🍙", "rice ball onigiri"], ["🍰", "cake shortcake"], ["🎂", "birthday cake"], ["🧁", "cupcake"], ["🍩", "donut doughnut"],
      ["🍪", "cookie"], ["🍫", "chocolate"], ["🍬", "candy"], ["🍭", "lollipop"], ["🍦", "ice cream"],
      ["☕", "coffee hot"], ["🧋", "bubble milk tea boba"], ["🍵", "tea"], ["🥤", "soda drink cup"], ["🍺", "beer"],
      ["🍻", "cheers beers"], ["🥂", "clink glasses toast champagne"], ["🍷", "wine"],
    ] },
    { id: "activities", icon: "⚽", label: "Activities", items: [
      ["⚽", "soccer football ball"], ["🏀", "basketball"], ["🏈", "american football"], ["⚾", "baseball"], ["🎾", "tennis"],
      ["🏐", "volleyball"], ["🏓", "ping pong table tennis"], ["🏸", "badminton"], ["🥊", "boxing glove"], ["🏆", "trophy winner"],
      ["🥇", "gold medal first"], ["🎯", "bullseye target"], ["🎮", "video game controller"], ["🕹️", "joystick game"], ["🎲", "dice game"],
      ["🧩", "puzzle"], ["🎨", "art palette paint"], ["🎬", "clapper movie film"], ["🎤", "microphone sing karaoke"], ["🎧", "headphones music"],
      ["🎸", "guitar"], ["🎹", "piano keyboard"], ["🥁", "drum"], ["🎉", "party popper celebrate tada"], ["🎊", "confetti ball"],
      ["🎈", "balloon birthday"], ["🎁", "gift present"], ["🎀", "ribbon bow"], ["🪄", "magic wand"],
    ] },
    { id: "objects", icon: "💡", label: "Objects & symbols", items: [
      ["💻", "laptop computer"], ["🖥️", "desktop computer"], ["⌨️", "keyboard"], ["🖱️", "mouse computer"], ["📱", "phone mobile"],
      ["📷", "camera photo"], ["🎥", "movie camera video"], ["💡", "light bulb idea"], ["🔦", "flashlight"], ["📚", "books study"],
      ["📖", "book open read"], ["✏️", "pencil"], ["📝", "memo note write"], ["📌", "pin pushpin"], ["📎", "paperclip"],
      ["✂️", "scissors cut"], ["🔒", "lock locked private"], ["🔑", "key"], ["🧠", "brain smart"], ["💼", "briefcase work"],
      ["🗂️", "folders"], ["📅", "calendar date"], ["⏰", "alarm clock"], ["⌛", "hourglass time"], ["💰", "money bag"],
      ["💎", "gem diamond"], ["🛠️", "tools"], ["⚙️", "gear settings"], ["🧪", "test tube science"], ["🚀", "rocket launch"],
      ["✈️", "airplane travel"], ["🚗", "car"], ["🏠", "house home"], ["🌍", "globe earth world"], ["🗺️", "map"],
      ["✅", "check done yes"], ["❌", "cross no wrong"], ["⚠️", "warning"], ["❓", "question"], ["❗", "exclamation"],
      ["💯", "hundred perfect"], ["🔔", "bell notification"], ["🎵", "music note"], ["💬", "speech bubble chat"], ["💭", "thought bubble"],
    ] },
  ];

  // Emoji that come in skin tones (shown with the chosen tone)
  const TONEABLE = new Set("👋 🤚 🖐 ✋ 🖖 👌 🤌 🤏 ✌ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍ 💪 🙋 🙆 🙅 🤷 🤦 🙇 💃 🕺 🏃 🚴 🏊 🧘".split(" "));
  const TONES = [
    { mod: "", label: "Default", color: "#ffcc4d" },
    { mod: "🏻", label: "Light", color: "#f7dece" },
    { mod: "🏼", label: "Medium-light", color: "#f3d2a2" },
    { mod: "🏽", label: "Medium", color: "#d5ab88" },
    { mod: "🏾", label: "Medium-dark", color: "#af7e57" },
    { mod: "🏿", label: "Dark", color: "#7c533e" },
  ];
  const withTone = (e, mod) => {
    if (!mod) return e;
    const base = e.replace(/️/g, "");
    return TONEABLE.has(base) ? base + mod : e;
  };

  const ALL = CATEGORIES.flatMap((c) => c.items.map(([e, words]) => ({ e, words: `${words} ${c.label}`.toLowerCase() })));

  // Shared settings (all pickers on the page)
  const RECENT_KEY = "chat-emoji-recent";
  const TONE_KEY = "emoji-tone";
  const RECENT_MAX = 24;
  const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const recent = () => (Array.isArray(read(RECENT_KEY, [])) ? read(RECENT_KEY, []) : []);
  const remember = (e) => write(RECENT_KEY, [e, ...recent().filter((x) => x !== e)].slice(0, RECENT_MAX));
  let toneMod = TONES.some((t) => t.mod === read(TONE_KEY, "")) ? read(TONE_KEY, "") : "";

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const SMILEY = '<svg class="icon icon-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 18a5.5 5.5 0 0 1-5-3.2h10A5.5 5.5 0 0 1 12 18Z"/></svg>';
  const SEARCH = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  // input: the text box; max: its length limit; toggle: an existing button (optional)
  window.createEmojiPicker = ({ input, max = 1000, toggle: existingToggle = null } = {}) => {
    const toggle = existingToggle || h("button", "chat-emoji-btn");
    if (!existingToggle) {
      toggle.type = "button";
      toggle.innerHTML = SMILEY;   // fixed markup
    }
    toggle.setAttribute("aria-label", "Add emoji");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "dialog");

    const box = h("div", "emoji-picker");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Choose an emoji");
    box.hidden = true;

    const searchWrap = h("label", "emoji-search");
    searchWrap.innerHTML = SEARCH;   // fixed markup
    const search = h("input");
    search.type = "search";
    search.placeholder = "Search emoji";
    search.setAttribute("aria-label", "Search emoji");
    search.autocomplete = "off";
    search.spellcheck = false;
    searchWrap.append(search);

    const tabs = h("div", "emoji-tabs");
    tabs.setAttribute("role", "tablist");
    const title = h("p", "emoji-section-title");
    const grid = h("div", "emoji-grid");
    grid.setAttribute("role", "grid");

    const foot = h("div", "emoji-foot");
    const toneRow = h("div", "emoji-tones");
    toneRow.setAttribute("role", "radiogroup");
    toneRow.setAttribute("aria-label", "Skin tone");
    foot.append(h("span", "emoji-foot-label", "Skin tone"), toneRow);

    box.append(searchWrap, tabs, title, grid, foot);

    let cat = recent().length ? "recent" : "smileys";

    const drawTabs = () => {
      const all = [{ id: "recent", icon: "🕘", label: "Recently used" }, ...CATEGORIES];
      tabs.replaceChildren(...all.map((c) => {
        const t = h("button", "emoji-tab", c.icon);
        t.type = "button";
        t.setAttribute("role", "tab");
        t.setAttribute("aria-label", c.label);
        t.title = c.label;
        t.setAttribute("aria-selected", String(!search.value.trim() && c.id === cat));
        t.dataset.cat = c.id;
        return t;
      }));
    };

    const button = (e) => {
      const shown = withTone(e, toneMod);
      const b = h("button", "emoji", shown);
      b.type = "button";
      b.dataset.emoji = shown;
      b.setAttribute("aria-label", shown);
      return b;
    };

    const drawGrid = () => {
      const q = search.value.trim().toLowerCase();
      let list;
      if (q) {
        const words = q.split(/\s+/);
        list = ALL.filter((x) => words.every((w) => x.words.split(" ").some((k) => k.startsWith(w)))).map((x) => x.e);
        title.textContent = list.length ? `Results for “${search.value.trim()}”` : "";
      } else if (cat === "recent") {
        list = recent();
        title.textContent = "Recently used";
      } else {
        const c = CATEGORIES.find((x) => x.id === cat) || CATEGORIES[0];
        list = c.items.map(([e]) => e);
        title.textContent = c.label;
      }
      if (!list.length) {
        grid.replaceChildren(h("p", "emoji-empty", q ? "No emoji found" : "Emoji you use will show up here."));
      } else {
        grid.replaceChildren(...list.map(button));
      }
      grid.scrollTop = 0;
    };

    const drawTones = () => {
      toneRow.replaceChildren(...TONES.map((t) => {
        const b = h("button", "emoji-tone");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(t.mod === toneMod));
        b.setAttribute("aria-label", `${t.label} skin tone`);
        b.title = t.label;
        b.style.setProperty("--tone", t.color);
        b.dataset.mod = t.mod;
        return b;
      }));
    };

    const isOpen = () => !box.hidden;
    const open = () => {
      search.value = "";
      if (recent().length && !box.dataset.seen) cat = "recent";
      box.dataset.seen = "1";
      drawTabs();
      drawGrid();
      drawTones();
      box.hidden = false;
      void box.offsetWidth;
      box.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.classList.add("is-active");
      // Computers: type to search right away (phones keep the keyboard closed)
      if (matchMedia("(hover: hover) and (pointer: fine)").matches) search.focus({ preventScroll: true });
    };
    const close = () => {
      if (!isOpen()) return;
      box.classList.remove("is-open");
      box.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.classList.remove("is-active");
    };

    toggle.addEventListener("click", () => {
      if (isOpen()) { close(); input.focus({ preventScroll: true }); }
      else open();
    });
    tabs.addEventListener("click", (e) => {
      const t = e.target.closest(".emoji-tab");
      if (!t) return;
      cat = t.dataset.cat;
      search.value = "";
      drawTabs();
      drawGrid();
    });
    search.addEventListener("input", () => { drawTabs(); drawGrid(); });
    toneRow.addEventListener("click", (e) => {
      const b = e.target.closest(".emoji-tone");
      if (!b) return;
      toneMod = b.dataset.mod;
      write(TONE_KEY, toneMod);
      drawTones();
      drawGrid();
    });
    grid.addEventListener("click", (e) => {
      const b = e.target.closest(".emoji");
      if (!b) return;
      const emoji = b.dataset.emoji;
      const limit = input.maxLength > 0 ? input.maxLength : max;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      const next = input.value.slice(0, start) + emoji + input.value.slice(end);
      if (next.length > limit) return;
      input.value = next;
      input.setSelectionRange(start + emoji.length, start + emoji.length);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      remember(emoji);
      b.animate([{ transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 200, easing: "ease-out" });
    });
    // Enter in the search picks the first result
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = grid.querySelector(".emoji");
        if (first) first.click();
      }
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        input.focus({ preventScroll: true });
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (isOpen() && !box.contains(e.target) && !toggle.contains(e.target)) close();
    });

    return { toggle, picker: box, open, close, isOpen };
  };
})();
