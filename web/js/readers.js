/* The readers and players. Positions are saved in the same form the computer's reader uses, so you can stop on
   one and carry on from the same place on the other:
   EPUB: the CFI · PDF and comics: the page number (from 1) · video and audio: seconds. */
Object.assign(window.Reader, (() => {
  let R = null;            // the open item and its reader
  const AUDIO = /^(mp3|flac|m4a|aac|ogg|opus|wav)$/i, VIDEO = /^(mp4|m4v|webm|mov|mkv)$/i;

  function shell(it, extra = "") {
    const el = $("#reader");
    el.innerHTML = `<div class="r-bar"><button data-r-close>‹</button><h2>${esc(it.title)}</h2>${extra}<time class="r-clock"></time></div>
      <div class="r-stage" id="rStage"></div>
      <div class="r-foot" id="rFoot"><span id="rPos"></span></div>`;
    el.hidden = false;
    el.classList.remove("calm");
    tick();
    el.querySelector("[data-r-close]").onclick = close;
    return $("#rStage");
  }

  /* where you are: kept on the item at once, sent to the computer every few seconds and when you close */
  function save(loc, progress) {
    if (!R) return;
    R.pending = { last_location: String(loc), progress: Math.max(0, Math.min(1, progress || 0)) };
    Object.assign(R.it, R.pending);
    if (!R.saveT) R.saveT = setTimeout(saveNow, 5000);
  }
  function saveNow() {
    if (!R) return;
    clearTimeout(R.saveT); R.saveT = null;
    if (R.pending) { change(R.it.id, { ...R.pending, opened_at: now() }); R.pending = null; }
  }

  async function start(it) {
    if (!it) return;
    if (!onPhone(it)) return toast("Get the file from your computer first.");
    if (R) close();
    const name = fileName(it), url = "/local/" + encodeURIComponent(name), ext = (it.file_type || "").toLowerCase();
    R = { it, name, url, ext };
    window.Reader.open = true;
    if (A) A.keepAwake(true);
    change(it.id, { opened_at: now() });
    try {
      if (ext === "pdf") await pdf();
      else if (ext === "epub") await epub();
      else if (ext === "cbz") await comic();
      else if (VIDEO.test(ext)) video();
      else if (AUDIO.test(ext)) audio();
      else unsupported(`This app can't show ${ext.toUpperCase()} files itself.`);
    } catch (e) {
      console.error(e);
      unsupported(`Couldn't open the file (${e.message || e}).`);
    }
  }
  function unsupported(msg) {
    const st = shell(R.it);
    st.innerHTML = `<div class="r-msg"><p>${esc(msg)}</p><p class="hint" style="color:#bbb">Another app on your phone may be able to open it.</p>
      <button class="btn primary" id="rWith">${WEB ? "Share / open in another app" : "Open in another app"}</button></div>`;
    $("#rWith").onclick = () => { if (!A.openWith(R.name)) toast("No app on the phone can open this kind of file."); };
  }
  function close() {
    if (!R) return;
    saveNow();
    try { R.cleanup && R.cleanup(); } catch (e) {}
    R = null;
    window.Reader.open = false;
    if (A) A.keepAwake(false);
    const el = $("#reader");
    el.hidden = true; el.innerHTML = "";
    if (!$("#sheet").hidden && S.sheetId) openSheet(S.sheetId); else render();   // the item page shows the new position
    sync();
  }

  /* taps: left and right thirds turn the page (swapped for right-to-left manga), the middle shows the bars;
     a sideways swipe turns too */
  function bindTurns(target, step) {
    let x0 = null, y0 = null, t0 = 0;
    target.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
    target.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - t0 < 700) { e.preventDefault(); step(dx < 0 ? "right" : "left", true); }
    });
    target.addEventListener("click", (e) => {
      const w = target.clientWidth || innerWidth, x = e.clientX - target.getBoundingClientRect().left;
      if (x < w * 0.3) step("left"); else if (x > w * 0.7) step("right"); else $("#reader").classList.toggle("calm");
    });
  }
  const rtl = () => R.it.direction === "rtl";
  // which way a tap/swipe goes: right side = next for left-to-right, previous for right-to-left
  const dirOf = (side) => ((side === "right") !== rtl() ? 1 : -1);
  function footSlider(count, cur, go) {
    const f = $("#rFoot");
    const label = ($("#rPos") || {}).textContent || `${cur} / ${count}`;
    f.innerHTML = `<span id="rPos">${esc(label)}</span><input type="range" id="rSlide" min="1" max="${count}" value="${cur}" ${rtl() ? 'style="direction:rtl"' : ""}>`;
    $("#rSlide").onchange = (e) => go(Number(e.target.value));
  }

  /* ---------------- page by page, or one long scroll: the ⇅ button switches (remembered per kind of file) */
  const modeOf = (key) => (S.readMode || {})[key] || "pages";
  function modeButton(key) {
    return `<button id="rMode" title="${modeOf(key) === "scroll" ? "Page by page" : "Scroll"}">${modeOf(key) === "scroll" ? "▤" : "⇅"}</button>`;
  }
  function bindMode(key) {
    const b = $("#rMode");
    if (b) b.onclick = (e) => {
      e.stopPropagation();
      S.readMode = { ...(S.readMode || {}), [key]: modeOf(key) === "scroll" ? "pages" : "scroll" };
      saveState();
      saveNow();
      const it = R.it;
      start(it);
      toast(modeOf(key) === "scroll" ? "Scrolling" : "Page by page");
    };
  }
  /* the scrolling view for PDFs and comics: every page in one column, drawn as it comes near the screen and let go
     when it's far away; the position is saved as "page:fraction-of-page" like the computer's scrolling view */
  function scrollView(st, count, aspect, fill, empty) {
    st.classList.add("scroll");
    const pages = [];
    for (let i = 1; i <= count; i++) {
      const d = document.createElement("div");
      d.className = "pgh";
      d.dataset.n = i;
      d.style.aspectRatio = String(aspect);
      st.appendChild(d);
      pages.push(d);
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = Number(e.target.dataset.n);
        if (e.isIntersecting && !e.target.dataset.full) { e.target.dataset.full = "1"; fill(e.target, n); }
        else if (!e.isIntersecting && e.target.dataset.full) { delete e.target.dataset.full; empty(e.target, n); }
      }
    }, { root: st, rootMargin: "150% 0px" });
    pages.forEach((p) => io.observe(p));
    const where = () => {
      const y = st.scrollTop + 1;
      let lo = 0, hi = pages.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pages[mid].offsetTop <= y) lo = mid; else hi = mid - 1; }
      const p = pages[lo], frac = Math.max(0, Math.min(0.999, (y - p.offsetTop) / (p.offsetHeight || 1)));
      return { n: lo + 1, frac };
    };
    let t = null;
    st.addEventListener("scroll", () => {
      if (t) return;
      t = requestAnimationFrame(() => {
        t = null;
        const { n, frac } = where();
        $("#rPos").textContent = `${n} / ${count}`;
        const sl = $("#rSlide"); if (sl && document.activeElement !== sl) sl.value = n;
        save(frac > 0.01 ? `${n}:${frac.toFixed(3)}` : n, count > 1 ? (n - 1) / (count - 1) : 1);
      });
    });
    const go = (n, frac = 0) => { const p = pages[Math.min(count, Math.max(1, n)) - 1]; st.scrollTop = p.offsetTop + frac * p.offsetHeight; };
    st.addEventListener("click", () => $("#reader").classList.toggle("calm"));
    const [n0, f0] = String(R.it.last_location || "1").split(":");
    requestAnimationFrame(() => go(parseInt(n0) || 1, parseFloat(f0) || 0));
    $("#rPos").textContent = `${parseInt(n0) || 1} / ${count}`;
    R.cleanup = ((prev) => () => { io.disconnect(); prev && prev(); })(R.cleanup);
    return go;
  }

  /* ---------------- PDF */
  async function pdf() {
    const st = shell(R.it, `${modeButton("pdf")}<button id="rFit" title="Fit width / whole page">↔</button>`);
    bindMode("pdf");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    // pdf.js normally fetches from its worker, but Android only serves the app's files to the page itself: the page
    // fetches the byte ranges pdf.js asks for and hands them over (big manga PDFs never load whole)
    const part = (s, e) => fetch(`/part/${encodeURIComponent(R.name)}?s=${s}&e=${e}`);
    const head = await part(0, 65536);
    const total = Number(head.headers.get("x-file-size"));
    const first = new Uint8Array(await head.arrayBuffer());
    const transport = new pdfjsLib.PDFDataRangeTransport(total, first);
    transport.requestDataRange = (begin, end) => {
      part(begin, end).then((r) => r.arrayBuffer())
        .then((b) => transport.onDataRange(begin, new Uint8Array(b))).catch((e) => console.error("pdf range", e));
    };
    const doc = await pdfjsLib.getDocument({ range: transport, length: total, rangeChunkSize: 1 << 20, disableAutoFetch: true }).promise;
    R.cleanup = () => doc.destroy();
    const n = doc.numPages;
    if (modeOf("pdf") === "scroll") {
      $("#rFit").hidden = true;
      const vp1 = (await doc.getPage(1)).getViewport({ scale: 1 });
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const go = scrollView(st, n, vp1.width / vp1.height, async (box, num) => {
        const pg = await doc.getPage(num);
        if (!box.dataset.full || !R) return;
        const v1 = pg.getViewport({ scale: 1 });
        box.style.aspectRatio = String(v1.width / v1.height);
        const vp = pg.getViewport({ scale: (st.clientWidth / v1.width) * dpr });
        const c = document.createElement("canvas");
        c.width = vp.width; c.height = vp.height;
        await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        if (box.dataset.full) { box.innerHTML = ""; box.appendChild(c); }
      }, (box) => { box.innerHTML = ""; });
      footSlider(n, parseInt(R.it.last_location) || 1, (p) => go(p));
      return;
    }
    let page = Math.min(n, Math.max(1, parseInt(R.it.last_location) || 1)), busy = 0;
    let canvas = document.createElement("canvas");
    st.appendChild(canvas);
    // each page is drawn off screen (the next two ahead of time) and swapped in when it's finished: no white page
    // between turns (clearing the canvas and redrawing it showed one, very visibly on big manga scans)
    const drawn = new Map();
    const draw = (num) => {
      const fitw = st.classList.contains("fitw");
      const key = num + (fitw ? "w" : "p") + st.clientWidth + "x" + st.clientHeight;
      if (!drawn.has(key)) drawn.set(key, (async () => {
        const pg = await doc.getPage(num);
        const vp1 = pg.getViewport({ scale: 1 });
        const scale = fitw ? st.clientWidth / vp1.width : Math.min(st.clientWidth / vp1.width, st.clientHeight / vp1.height);
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const vp = pg.getViewport({ scale: scale * dpr });
        const c = document.createElement("canvas");
        c.width = vp.width; c.height = vp.height;
        c.style.width = vp.width / dpr + "px"; c.style.height = vp.height / dpr + "px";
        await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        return c;
      })());
      if (drawn.size > 6) drawn.delete(drawn.keys().next().value);
      return drawn.get(key);
    };
    const show = async (p) => {
      page = Math.min(n, Math.max(1, p));
      const my = ++busy;
      const c = await draw(page);
      if (my !== busy || !R) return;
      if (c !== canvas) { canvas.replaceWith(c); canvas = c; }
      for (const k of [page + 1, page + 2, page - 1]) if (k >= 1 && k <= n) draw(k);
      const fitw = st.classList.contains("fitw");
      if (fitw) st.scrollTop = 0;
      $("#rPos").textContent = `${page} / ${n}`;
      const sl = $("#rSlide"); if (sl) sl.value = page;
      save(page, n > 1 ? (page - 1) / (n - 1) : 1);
    };
    footSlider(n, page, show);
    bindTurns(st, (side, swipe) => show(page + dirOf(side, swipe)));
    $("#rFit").onclick = (e) => { e.stopPropagation(); st.classList.toggle("fitw"); show(page); };
    if (R.it.kind === "article") st.classList.add("fitw");
    addEventListener("resize", R.onResize = () => show(page));
    const prev = R.cleanup; R.cleanup = () => { removeEventListener("resize", R.onResize); prev(); };
    await show(page);
  }

  /* ---------------- comics (CBZ): pages come straight out of the zip, one at a time */
  async function comic() {
    const st = shell(R.it, `${modeButton("comic")}<button id="rFit" title="Fit width / whole page">↔</button>`);
    bindMode("comic");
    const base = "/comic/" + encodeURIComponent(R.name) + "/";
    const { count } = await (await fetch(base + "count")).json();
    if (!count) throw new Error("no pages found");
    if (modeOf("comic") === "scroll") {
      $("#rFit").hidden = true;
      const first = new Image();
      first.src = base + 0;
      await first.decode().catch(() => {});
      const go = scrollView(st, count, (first.naturalWidth || 2) / (first.naturalHeight || 3), (box, num) => {
        const im = document.createElement("img");
        im.className = "pg";
        im.alt = "";
        im.onload = () => { box.style.aspectRatio = String(im.naturalWidth / im.naturalHeight); };
        im.src = base + (num - 1);
        box.innerHTML = "";
        box.appendChild(im);
      }, (box) => { box.innerHTML = ""; });
      footSlider(count, parseInt(R.it.last_location) || 1, (p) => go(p));
      return;
    }
    let page = Math.min(count, Math.max(1, parseInt(R.it.last_location) || 1));
    let img = document.createElement("img");
    img.className = "pg"; img.alt = "";
    st.appendChild(img);
    // pages around the one you're on are fetched and decoded ahead, and a page only goes on screen once it's ready
    // (setting the src straight away showed a blank white page while the next one loaded)
    const cache = new Map();
    const get = (n) => {
      if (n < 1 || n > count) return null;
      if (!cache.has(n)) { const im = new Image(); im.src = base + (n - 1); cache.set(n, { im, ready: im.decode().catch(() => {}) }); }
      return cache.get(n);
    };
    const warm = () => {
      for (const n of [page + 1, page + 2, page + 3, page - 1]) get(n);
      for (const n of [...cache.keys()]) if (n < page - 3 || n > page + 5) cache.delete(n);
    };
    let want = 0;
    const show = async (p) => {
      page = Math.min(count, Math.max(1, p));
      const n = ++want, c = get(page);
      await c.ready;
      if (n !== want) return;            // turned again while it loaded
      if (img !== c.im) { c.im.className = "pg"; c.im.alt = ""; img.replaceWith(c.im); img = c.im; }   // the decoded page itself goes on screen: no blank frame
      warm();
      if (st.classList.contains("fitw")) st.scrollTop = 0;
      $("#rPos").textContent = `${page} / ${count}`;
      const sl = $("#rSlide"); if (sl) sl.value = page;
      save(page, count > 1 ? (page - 1) / (count - 1) : 1);
    };
    footSlider(count, page, show);
    bindTurns(st, (side, swipe) => show(page + dirOf(side, swipe)));
    $("#rFit").onclick = (e) => { e.stopPropagation(); st.classList.toggle("fitw"); };
    show(page);
  }

  /* ---------------- EPUB */
  async function epub() {
    const st = shell(R.it, modeButton("epub"));
    bindMode("epub");
    const scrolling = modeOf("epub") === "scroll";
    const box = document.createElement("div");
    box.className = "r-epub";
    st.appendChild(box);
    const th = ((window.THEMES || {})[document.documentElement.dataset.theme] || {}).reader || { bg: "#fff", ink: "#222", font: "serif" };
    $("#reader").style.background = th.bg;
    const data = await (await fetch(R.url)).arrayBuffer();
    const book = ePub(data);
    // scrolling: each chapter is one long page, and swiping on past its end brings the next one;
    // pages: one screen at a time
    const rend = book.renderTo(box, scrolling ? { width: "100%", height: "100%", flow: "scrolled-doc", allowScriptedContent: false }
      : { width: "100%", height: "100%", flow: "paginated", spread: "none", allowScriptedContent: false });
    rend.themes.default({ body: { background: th.bg + " !important", color: th.ink + " !important", "font-family": th.font, "line-height": "1.6", padding: "0 6px !important" },
      // the book's own colours would fight the theme (dark text on a dark page): the theme's ink wins everywhere
      "p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, em, strong, b, i, small, sup, sub, dd, dt": { color: th.ink + " !important", background: "transparent !important" },
      a: { color: th.ink + " !important", "text-decoration-color": "currentColor" }, img: { "max-width": "100% !important" } });
    R.cleanup = () => { try { book.destroy(); } catch (e) {} $("#reader").style.background = ""; };
    const cfi = String(R.it.last_location || "");
    await rend.display(cfi.startsWith("epubcfi") ? cfi : undefined);
    let ready = false;
    rend.on("relocated", (loc) => {
      const pct = book.locations.length() ? book.locations.percentageFromCfi(loc.start.cfi) : null;
      $("#rPos").textContent = pct != null ? Math.round(pct * 100) + "%" : "";
      if (ready || pct != null) save(loc.start.cfi, pct ?? R.it.progress ?? 0);
      ready = true;
    });
    if (scrolling) {          // scrolling turns no pages: a tap shows or hides the bars
      rend.on("click", (e) => { if (!String(e.view.getSelection()).trim()) $("#reader").classList.toggle("calm"); });
      // epub.js doesn't say where you are while you scroll: ask it once the scrolling stops
      const sc = box.querySelector(".epub-container");
      let t = null;
      const atEnd = () => sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
      const atTop = () => sc.scrollTop <= 2;
      const more = document.createElement("button");
      more.className = "btn sm r-next";
      more.textContent = "Next chapter ▾";
      more.hidden = true;
      st.appendChild(more);
      more.onclick = (e) => { e.stopPropagation(); turn(1); };
      async function turn(d) {
        more.hidden = true;
        await (d > 0 ? rend.next() : rend.prev());
        sc.scrollTop = d > 0 ? 0 : sc.scrollHeight;     // back from the next chapter: you were at the end of this one
      }
      if (sc) sc.addEventListener("scroll", () => {
        more.hidden = !atEnd();
        clearTimeout(t);
        t = setTimeout(() => {
          try {
            const loc = rend.currentLocation();
            if (loc && loc.start) rend.emit("relocated", loc);
          } catch (e) {}
        }, 400);
      });
      // swiping on past the end of a chapter (or back past its start) goes to the next (or previous) one
      let y0 = null, wasEnd = false, wasTop = false;
      // a chapter shorter than the screen can't scroll: the button shows straight away
      const showMore = () => { more.hidden = !(atEnd() && sc.scrollHeight >= 0); };
      rend.on("rendered", () => setTimeout(showMore, 300));
      setTimeout(showMore, 300);
      // the swipe is watched inside each chapter's own page (epub.js doesn't pass touches on)
      const onStart = (e) => { y0 = e.changedTouches[0].screenY; wasEnd = atEnd(); wasTop = atTop(); };
      const onEnd = (e) => {
        if (y0 == null) return;
        const dy = e.changedTouches[0].screenY - y0;
        y0 = null;
        if (dy < -60 && wasEnd && atEnd()) turn(1);
        else if (dy > 60 && wasTop && atTop()) turn(-1);
      };
      const watch = (contents) => {
        contents.document.addEventListener("touchstart", onStart, { passive: true });
        contents.document.addEventListener("touchend", onEnd, { passive: true });
      };
      rend.hooks.content.register(watch);
      rend.getContents().forEach(watch);           // the chapter already showing
      sc.addEventListener("touchstart", onStart, { passive: true });   // and the space below a short chapter
      sc.addEventListener("touchend", onEnd, { passive: true });
      book.ready.then(() => book.locations.generate(1200)).then(() => { if (R && rend.location) rend.emit("relocated", rend.location); }).catch(() => {});
      return;
    }
    const step = (side, swipe) => (dirOf(side, swipe) > 0 ? rend.next() : rend.prev());
    let x0 = null;
    rend.on("touchstart", (e) => { x0 = e.changedTouches[0].screenX; });
    rend.on("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].screenX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? "right" : "left", true);
    });
    rend.on("click", (e) => {
      if (window.getSelection && String(e.view.getSelection()).trim()) return;
      const w = box.clientWidth, x = ((e.clientX % w) + w) % w;
      if (x < w * 0.3) step("left"); else if (x > w * 0.7) step("right"); else $("#reader").classList.toggle("calm");
    });
    // percentages need the book's locations, worked out in the background
    book.ready.then(() => book.locations.generate(1200)).then(() => { if (R && rend.location) rend.emit("relocated", rend.location); }).catch(() => {});
  }

  /* ---------------- video */
  function video() {
    const it = R.it;
    const st = shell(it);
    $("#reader").classList.add("calm");
    const skip = (s) => `<button class="v-skip" data-vskip="${s}">${s < 0 ? `↺ ${-s}` : `${s} ↻`}</button>`;
    st.innerHTML = `<div class="v-box"><video class="r-media" controls playsinline autoplay preload="metadata"></video><span class="v-flash" id="vFlash"></span></div>
      <div class="v-skips">${[-30, -15, -5].map(skip).join("")}<span class="v-gap"></span>${[5, 15, 30].map(skip).join("")}</div>`;
    const v = st.querySelector("video");
    // skipping: the buttons, or a double tap on the left or right half of the picture (10 s)
    const jump = (s) => {
      if (!v.duration) return;
      v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + s));
      const f = $("#vFlash");
      f.textContent = (s > 0 ? "+" : "−") + Math.abs(s) + " s";
      f.className = "v-flash on " + (s > 0 ? "r" : "l");
      clearTimeout(jump.t); jump.t = setTimeout(() => (f.className = "v-flash"), 600);
    };
    st.querySelector(".v-skips").onclick = (e) => { const b = e.target.closest("[data-vskip]"); if (b) jump(Number(b.dataset.vskip)); };
    let lastTap = 0;
    v.addEventListener("click", (e) => {
      const now = Date.now();
      if (now - lastTap < 300) { e.preventDefault(); const r = v.getBoundingClientRect(); jump(e.clientX < r.left + r.width / 2 ? -10 : 10); lastTap = 0; }
      else lastTap = now;
    });
    let resumed = false, lastSave = 0;
    v.addEventListener("loadedmetadata", () => {
      const t = parseFloat(it.last_location) || 0;
      if (!resumed && t > 5 && t < v.duration - 10) v.currentTime = t;
      resumed = true;
    });
    v.addEventListener("timeupdate", () => {
      if (v.duration && Math.abs(v.currentTime - lastSave) > 10) { lastSave = v.currentTime; save(v.currentTime.toFixed(0), v.currentTime / v.duration); }
      $("#rPos").textContent = "";
    });
    v.addEventListener("pause", () => { if (v.duration) { save(v.currentTime.toFixed(0), v.currentTime / v.duration); saveNow(); } });
    v.addEventListener("ended", () => {
      save(v.duration.toFixed(0), 1);
      change(it.id, { watched: 1, watched_at: now(), progress: 1, last_location: String(Math.round(v.duration)) });
      const next = nextEpisode(it);
      if (next) { toast(`Next: ${next.title}`); setTimeout(() => R && R.it === it && start(next), 1500); }
    });
    v.addEventListener("error", () => { if (R && R.it === it) unsupported("This video's format can't be played inside the app."); });
    v.addEventListener("click", (e) => { if (e.target === v) $("#reader").classList.toggle("calm"); });
    v.src = (A && A.mediaUrl(R.name)) || R.url;
    // (the iPhone app hands the player the stored file itself: Safari seeks in it far more reliably)
    if (A && A.mediaUrlAsync) A.mediaUrlAsync(R.name).then((u) => { if (u && R && R.it === it) { const t = parseFloat(it.last_location) || 0; v.src = u; if (t > 5) v.addEventListener("loadedmetadata", () => { if (t < v.duration - 10) v.currentTime = t; }, { once: true }); } });
    R.cleanup = () => { v.pause(); v.removeAttribute("src"); v.load(); };
  }
  function nextEpisode(it) {
    if (it.kind !== "tv") return null;
    const eps = Object.values(S.items).filter((x) => x.kind === "tv" && x.series === it.series && onPhone(x))
      .sort((a, b) => (a.season || 1) - (b.season || 1) || (a.episode || 0) - (b.episode || 0));
    return eps[eps.indexOf(it) + 1] || null;
  }

  /* ---------------- music: plays on through the album's tracks that are on the phone */
  function audio() {
    const it = R.it;
    const st = shell(it);
    const album = Object.values(S.items).filter((x) => x.kind === "music" && x.album && x.album === it.album && onPhone(x))
      .sort((a, b) => (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0));
    st.innerHTML = `<div class="r-audio">${cover(it, false)}<div style="text-align:center"><b>${esc(it.title)}</b><br><small style="color:#bbb">${esc(byline(it))}</small></div>
      <audio controls autoplay preload="metadata"></audio>
      ${album.length > 1 ? `<small style="color:#bbb">Track ${album.indexOf(it) + 1} of ${album.length} on this phone</small>` : ""}</div>`;
    const a = st.querySelector("audio");
    a.addEventListener("loadedmetadata", () => { const t = parseFloat(it.last_location) || 0; if (t > 5 && t < a.duration - 5) a.currentTime = t; });
    a.addEventListener("timeupdate", () => { if (a.duration) save(a.currentTime.toFixed(0), a.currentTime / a.duration); });
    a.addEventListener("ended", () => {
      save(Math.round(a.duration), 1);
      const nx = album[album.indexOf(it) + 1];
      if (nx) start(nx);
    });
    a.src = (A && A.mediaUrl(R.name)) || R.url;
    if (A && A.mediaUrlAsync) A.mediaUrlAsync(R.name).then((u) => { if (u && R && R.it === it) a.src = u; });
    R.cleanup = () => { a.pause(); a.removeAttribute("src"); a.load(); };
  }

  return { start, close, saveNow };
})());
