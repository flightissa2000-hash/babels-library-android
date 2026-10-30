/* The readers and players, with what the computer's reader has: highlights and notes (four colours), pins
   anywhere on a page, bookmarks, contents and "go to page", one page / two pages / scrolling, the text size of
   books, zoom on pages and pictures, reading direction for manga, subtitles and episodes for TV, and listening
   to a book's audiobook with the sentence being read lit up.
   Positions and notes are saved in the same form as the computer's, so either one carries on from the other:
   EPUB: the CFI · PDF and comics: the page number (from 1, ":fraction" when scrolling) · video and audio: seconds. */
Object.assign(window.Reader, (() => {
  let R = null;            // the open item and its reader
  const AUDIO = /^(mp3|flac|m4a|aac|ogg|opus|wav)$/i, VIDEO = /^(mp4|m4v|webm|mov|mkv)$/i, COMIC = /^(cbz|cbr|cb7|cbt)$/i;
  const HLV = { yellow: "--hl-yellow", green: "--hl-green", blue: "--hl-blue", pink: "--hl-pink" };
  const HLF = { yellow: "#ffe36e", green: "#9be58d", blue: "#8cc8ff", pink: "#ff9ccf" };
  const hl = (c) => getComputedStyle(document.documentElement).getPropertyValue(HLV[c] || HLV.yellow).trim() || HLF[c] || HLF.yellow;
  const isPin = (a) => a.locator && a.locator.type === "pin";
  const isBm = (a) => a.locator && a.locator.type === "bookmark";
  const anns = () => (R ? Ann.of(R.it.id) : []);
  const pageOf = (a) => { const l = a.locator || {}; return l.page || (l.rects || [{}])[0].p || 0; };

  /* ---------------- the screen around the pages */
  function shell(it, kind) {
    const el = $("#reader");
    const book = ["pdf", "epub", "comic"].includes(kind), vid = kind === "video";
    const t = (k, ic, label, extra = "") => `<button data-rt="${k}" aria-label="${label}" title="${label}" ${extra}>${ic}</button>`;
    const tools = book ? [t("toc", "☰", "Contents"), t("mark", "🔖", "Bookmark this page"), t("pin", "📍", "Drop a pin"),
        t("notes", `✎<i id="rNoteN"></i>`, "Notes and highlights"), t("view", "Aa", "Layout"),
        (kind === "pdf" || kind === "epub") && it.audio_status === "ready" ? t("listen", "🎧", "Listen to the audiobook") : ""].join("")
      : vid ? [t("prevEp", "⏮", "Previous episode"), t("toc", "☰", "Episodes"), t("nextEp", "⏭", "Next episode"), t("view", "CC", "Subtitles and audio")].join("") : "";
    el.innerHTML = `<div class="r-bar"><button class="r-back" data-r-close aria-label="Close">‹</button><h2>${esc(vid && it.kind === "tv" ? [it.series, `S${it.season || 1}E${it.episode ?? "?"}`].filter(Boolean).join(" · ") : it.title)}</h2>
        <span class="r-tools">${tools}</span><time class="r-clock"></time></div>
      <div class="r-stage" id="rStage"></div>
      <div class="r-foot" id="rFoot"><span id="rPos"></span></div>
      <div class="r-pop" id="rPop" hidden>${Object.keys(HLV).map((c) => `<button data-hl="${c}" style="background:${hl(c)}" aria-label="Highlight ${c}"></button>`).join("")}<button data-hl="note" class="r-pop-note">✎ Note</button></div>
      <div class="r-sheet" id="rSheet" hidden></div><div class="r-light" id="rLight" hidden></div>`;
    el.hidden = false;
    el.classList.remove("calm", "pin-mode");
    $("#rPop").addEventListener("pointerdown", (e) => e.preventDefault());     // (keeps the text selected)
    tick();
    paintCount();
    return $("#rStage");
  }
  function paintCount() { const n = anns().length; const b = $("#rNoteN"); if (b) b.textContent = n ? n : ""; }
  function bar(on) { $("#reader")?.classList.toggle("calm", on === undefined ? undefined : !on); }

  /* where you are: kept on the item at once, sent to the computer every few seconds and when you close */
  function save(loc, progress) {
    if (!R) return;
    R.pending = { last_location: String(loc), progress: Math.max(0, Math.min(1, progress || 0)) };
    Object.assign(R.it, R.pending);
    if (!R.saveT) R.saveT = setTimeout(saveNow, 5000);
    paintMark();
  }
  function saveNow() {
    if (!R) return;
    clearTimeout(R.saveT); R.saveT = null;
    if (R.pending) { change(R.it.id, { ...R.pending, opened_at: now() }); R.pending = null; }
  }

  async function start(it) {
    if (!it) return;
    if (it.kind === "music" && window.Jukebox) return Jukebox.playItem(it);       // songs play in the jukebox (it keeps going)
    if (!onPhone(it)) return toast("Get the file from your computer first.");
    if (R) close(true);
    const name = fileName(it), url = "/local/" + encodeURIComponent(name), ext = (it.file_type || "").toLowerCase();
    const kind = ext === "pdf" ? "pdf" : ext === "epub" ? "epub" : COMIC.test(ext) ? "comic" : VIDEO.test(ext) ? "video" : AUDIO.test(ext) ? "audio" : "other";
    R = { it, name, url, ext, kind, active: null, pinMode: false };
    window.Reader.open = true;
    if (A) A.keepAwake(true);
    if (window.PageKeys) PageKeys.capture(["pdf", "epub", "comic"].includes(kind));      // (the page-turn buttons: books only)
    change(it.id, { opened_at: now() });
    try {
      if (kind === "pdf") await pdf();
      else if (kind === "epub") await epub();
      else if (kind === "comic") await comic();
      else if (kind === "video") video();
      else if (kind === "audio") audio();
      else unsupported(`This app can't show ${ext.toUpperCase()} files itself.`);
    } catch (e) {
      console.error(e);
      if (R && R.it === it) unsupported(`Couldn't open the file (${e.message || e}).`);
    }
  }
  function unsupported(msg) {
    const st = shell(R.it, "other");
    st.innerHTML = `<div class="r-msg"><p>${esc(msg)}</p><p class="hint" style="color:#bbb">Another app on your phone may be able to open it.</p>
      <button class="btn primary" id="rWith">${WEB ? "Share / open in another app" : "Open in another app"}</button></div>`;
    $("#rWith").onclick = () => { if (!A.openWith(R.name)) toast("No app on the phone can open this kind of file."); };
  }
  function close(switching) {
    if (!R) return;
    saveNow();
    stopListening();
    try { R.cleanup && R.cleanup(); } catch (e) {}
    R = null;
    window.Reader.open = false;
    if (A) A.keepAwake(false);
    if (window.PageKeys) PageKeys.capture(false);
    const el = $("#reader");
    el.hidden = true; el.innerHTML = "";
    if (switching === true) return;
    if (!$("#sheet").hidden && S.sheetId) openSheet(S.sheetId); else render();   // the item page shows the new position
    sync();
  }

  /* taps: left and right thirds turn the page (swapped for right-to-left manga), the middle shows the bars;
     a sideways swipe turns too */
  function bindTurns(target, step) {
    let x0 = null, y0 = null, t0 = 0;
    target.addEventListener("touchstart", (e) => { if (e.touches.length > 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
    target.addEventListener("touchend", (e) => {
      if (x0 == null || busyHere(e)) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - t0 < 700) { e.preventDefault(); step(dx < 0 ? "right" : "left", true); }
    });
    target.addEventListener("click", (e) => {
      if (busyHere(e)) return;
      const w = target.clientWidth || innerWidth, x = e.clientX - target.getBoundingClientRect().left;
      if (x < w * 0.3) step("left"); else if (x > w * 0.7) step("right"); else bar();
    });
  }
  // (pins, highlights, the zoom button, pin mode and selected text don't turn pages)
  const busyHere = (e) => !R || R.pinMode || !!e.target.closest?.(".pin,.hl,.pz,.r-pop") || String(getSelection()).trim().length > 0;
  const rtl = () => R.it.direction === "rtl";
  const dirOf = (side) => ((side === "right") !== rtl() ? 1 : -1);
  function footSlider(count, cur, go) {
    const f = $("#rFoot");
    const label = ($("#rPos") || {}).textContent || `${cur} / ${count}`;
    f.innerHTML = `<span id="rPos">${esc(label)}</span><input type="range" id="rSlide" min="1" max="${count}" value="${cur}" ${rtl() ? 'style="direction:rtl"' : ""}><span id="rAb"></span>`;
    $("#rSlide").onchange = (e) => go(Number(e.target.value));
  }

  /* ---------------- layouts: one page, two pages side by side, or one long scroll (remembered per kind of file) */
  const modeOf = (key) => { const m = (S.readMode || {})[key] || "pages"; return m === "double" && key === "video" ? "pages" : m; };
  function setMode(key, m) {
    S.readMode = { ...(S.readMode || {}), [key]: m };
    saveState(); saveNow();
    const it = R.it;
    start(it);
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
      pauseFollow();
      if (t) return;
      t = requestAnimationFrame(() => {
        t = null;
        const { n, frac } = where();
        R.cur = n;
        $("#rPos").textContent = `${n} / ${count}`;
        const sl = $("#rSlide"); if (sl && document.activeElement !== sl) sl.value = n;
        save(frac > 0.01 ? `${n}:${frac.toFixed(3)}` : n, count > 1 ? (n - 1) / (count - 1) : 1);
      });
    });
    const go = (n, frac = 0) => { const p = pages[Math.min(count, Math.max(1, n)) - 1]; st.scrollTop = p.offsetTop + frac * p.offsetHeight; };
    st.addEventListener("click", (e) => { if (!busyHere(e)) bar(); });
    const [n0, f0] = String(R.it.last_location || "1").split(":");
    R.cur = parseInt(n0) || 1;
    requestAnimationFrame(() => go(parseInt(n0) || 1, parseFloat(f0) || 0));
    $("#rPos").textContent = `${parseInt(n0) || 1} / ${count}`;
    R.cleanup = ((prev) => () => { io.disconnect(); prev && prev(); })(R.cleanup);
    return go;
  }
  // like a book: the first page on its own, then pairs (2–3, 4–5…)
  const spreadFor = (n, total, double) => { if (!double || n === 1) return [n]; const s = n % 2 === 0 ? n : n - 1; return s + 1 <= total ? [s, s + 1] : [s]; };

  /* ---------------- pins, highlights and the selection's colours (shared by PDF and comic pages) */
  function pinNo(a) { return sortAnns().filter(isPin).indexOf(a) + 1; }
  function drawPins(layer, page) {
    if (!layer) return;
    layer.innerHTML = anns().filter((a) => isPin(a) && a.locator.page === page).map((a) =>
      `<button class="pin ${a.id === R.active ? "on" : ""}" data-pin="${esc(a.id)}" style="left:${a.locator.x * 100}%;top:${a.locator.y * 100}%;--pin:${hl(a.color)}"><span>${pinNo(a)}</span></button>`).join("");
  }
  const coords = (e, el) => { const b = el.getBoundingClientRect(); return { x: Math.min(.99, Math.max(.01, (e.clientX - b.left) / b.width)), y: Math.min(.99, Math.max(.01, (e.clientY - b.top) / b.height)) }; };
  function newAnn(body) {
    const a = Ann.add(R.it.id, body);
    R.active = a.id;
    redraw(); paintCount();
    return a;
  }
  /* a pin: in pin mode, a tap on a page drops one (then its note opens); drag a pin to move it, tap it to read it */
  function bindPins(st) {
    st.addEventListener("click", (e) => {
      if (!R || !R.pinMode) return;
      const pg = e.target.closest("[data-page]");
      if (!pg || e.target.closest(".pin")) return;
      e.stopPropagation();
      const a = newAnn({ locator: { type: "pin", page: Number(pg.dataset.page), ...coords(e, pg) } });
      pinMode(false);
      notesSheet(a.id, true);
    }, true);
    st.addEventListener("pointerdown", (e) => {
      const pin = e.target.closest(".pin");
      if (!pin) return;
      e.preventDefault(); e.stopPropagation();
      const a = anns().find((x) => String(x.id) === pin.dataset.pin), pg = pin.closest("[data-page]");
      if (!a || !pg) return;
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      pin.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        moved = true;
        const c = coords(ev, pg);
        pin.style.left = c.x * 100 + "%"; pin.style.top = c.y * 100 + "%";
      };
      const up = (ev) => {
        pin.removeEventListener("pointermove", move); pin.removeEventListener("pointerup", up);
        if (moved) Ann.edit(a, { locator: { ...a.locator, ...coords(ev, pg) } });
        else notesSheet(a.id);
      };
      pin.addEventListener("pointermove", move); pin.addEventListener("pointerup", up);
    });
    st.addEventListener("click", (e) => { const h = e.target.closest(".hl"); if (h) { e.stopPropagation(); notesSheet(h.dataset.ann); } });
  }
  function pinMode(on) {
    R.pinMode = on;
    $("#reader").classList.toggle("pin-mode", on);
    $("#reader [data-rt=pin]")?.classList.toggle("on", on);
    if (R.kind === "epub") drawEpubPins();
    if (on) toast(R.kind === "comic" ? "Tap a page to pin a note there" : "Tap anywhere on the page to drop a pin");
  }

  /* the colours that come up for selected text */
  function showPop(x, y) {
    const p = $("#rPop");
    p.hidden = false;
    const w = p.offsetWidth || 230, h = p.offsetHeight || 46;
    p.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + "px";
    p.style.top = Math.max(60, Math.min(innerHeight - h - 70, y + 16)) + "px";
  }
  const hidePop = () => { const p = $("#rPop"); if (p) p.hidden = true; };
  function fromPending(color) {
    const p = R.pending_hl;
    hidePop();
    if (!p) return;
    R.pending_hl = null;
    try { (p.win || window).getSelection().removeAllRanges(); } catch (e) {}
    const a = newAnn({ quote: p.quote, color: color === "note" ? "yellow" : color, locator: p.locator });
    if (color === "note") notesSheet(a.id, true);
  }

  /* ---------------- PDF */
  async function pdf() {
    const st = shell(R.it, "pdf");
    const m = modeOf("pdf");
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
    R.doc = doc; R.n = doc.numPages;
    R.cleanup = () => doc.destroy();
    const n = doc.numPages, dpr = Math.min(3, window.devicePixelRatio || 1);
    const graphic = R.it.kind === "graphic";
    /* one page: the picture, the text (invisible, for selecting), highlights, pins and the sentence being read aloud */
    const pageBox = async (num, w, h) => {
      const pg = await doc.getPage(num);
      const v1 = pg.getViewport({ scale: 1 });
      const scale = Math.max(0.2, h ? Math.min(w / v1.width, h / v1.height) : w / v1.width);
      const vp = pg.getViewport({ scale });
      const box = document.createElement("div");
      box.className = "pp"; box.dataset.page = num;
      box.style.width = vp.width + "px"; box.style.height = vp.height + "px";
      box.style.setProperty("--scale-factor", scale);
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      const tl = document.createElement("div"); tl.className = "textLayer";
      box.append(c, tl);
      box.insertAdjacentHTML("beforeend", `<div class="hl-layer"></div><div class="tts-layer"></div><div class="pin-layer"></div><button class="pz" data-zoom="${num}" aria-label="Zoom">⤢</button>`);
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      if (!graphic) pdfjsLib.renderTextLayer({ textContentSource: pg.streamTextContent(), container: tl, viewport: vp, textDivs: [] }).promise.catch(() => {});
      drawPdfAnns(box);
      return box;
    };
    R.drawAll = () => $$("#rStage .pp").forEach(drawPdfAnns);
    R.zoom = async (num) => {
      const pg = await doc.getPage(num);
      const v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(5, 2400 / v1.width) });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      lightbox(c.toDataURL("image/jpeg", 0.92), `Page ${num}`);
    };
    bindPins(st);
    st.addEventListener("click", (e) => { const z = e.target.closest(".pz"); if (z) { e.stopPropagation(); R.zoom(Number(z.dataset.zoom)); } }, true);
    R.toc = async () => {
      let outline = null;
      try { outline = await doc.getOutline(); } catch (e) {}
      R.dests = [];
      const row = (o, d) => { const k = R.dests.push(o.dest) - 1; return `<button class="toc-row" data-toc-dest="${k}" style="--d:${d}">${esc((o.title || "").trim() || "Untitled")}</button>${(o.items || []).map((x) => row(x, d + 1)).join("")}`; };
      return (outline && outline.length ? `<h4>Chapters</h4><div class="toc-tree">${outline.map((o) => row(o, 0)).join("")}</div>` : "") + pageGrid(n);
    };
    R.dest = async (k) => { try { const dest = R.dests[k]; const d = typeof dest === "string" ? await doc.getDestination(dest) : dest; R.go((await doc.getPageIndex(d[0])) + 1); } catch (e) { toast("That entry doesn't point to a page."); } };
    R.here = () => ({ page: R.cur || 1 });
    R.onPageHere = (a) => (R.shown || [R.cur]).includes(a.locator.page);
    if (m === "scroll") {
      const vp1 = (await doc.getPage(1)).getViewport({ scale: 1 });
      R.go = scrollView(st, n, vp1.width / vp1.height, async (holder, num) => {
        const box = await pageBox(num, holder.clientWidth || st.clientWidth, 0);
        if (!holder.dataset.full || !R) return;
        holder.style.aspectRatio = box.style.width && `${parseFloat(box.style.width)} / ${parseFloat(box.style.height)}`;
        holder.replaceChildren(box);
      }, (holder) => { holder.innerHTML = ""; });
      footSlider(n, parseInt(R.it.last_location) || 1, (p) => R.go(p));
      R.shown = null;
      return;
    }
    const double = m === "double";
    let page = Math.min(n, Math.max(1, parseInt(R.it.last_location) || 1)), busy = 0;
    const spread = document.createElement("div");
    spread.className = "pspread";
    st.appendChild(spread);
    // every page is drawn off screen (the next ones ahead of time) and swapped in when it's ready: no white page
    // between turns
    const drawn = new Map();
    const draw = (num, count) => {
      const fitw = st.classList.contains("fitw");
      const W = (st.clientWidth - (count > 1 ? 4 : 0)) / count, H = fitw ? 0 : st.clientHeight;
      const key = `${num}:${Math.round(W)}x${Math.round(H)}`;
      if (!drawn.has(key)) drawn.set(key, pageBox(num, W, H));
      if (drawn.size > 8) drawn.delete(drawn.keys().next().value);
      return drawn.get(key);
    };
    const show = async (p) => {
      const nums = spreadFor(Math.min(n, Math.max(1, p)), n, double);
      page = nums[0]; R.cur = page; R.shown = nums;
      const my = ++busy;
      const boxes = await Promise.all(nums.map((k) => draw(k, nums.length)));
      if (my !== busy || !R) return;
      spread.replaceChildren(...(rtl() ? [...boxes].reverse() : boxes));
      boxes.forEach(drawPdfAnns);
      const ahead = spreadFor(nums[nums.length - 1] + 1, n, double), back = nums[0] > 1 ? spreadFor(nums[0] - 1, n, double) : [];
      for (const k of [...ahead, ...back]) if (k >= 1 && k <= n) draw(k, ahead.includes(k) ? ahead.length : back.length);
      if (st.classList.contains("fitw")) st.scrollTop = 0;
      $("#rPos").textContent = `${nums.join("–")} / ${n}`;
      const sl = $("#rSlide"); if (sl) sl.value = page;
      save(page, n > 1 ? (nums[nums.length - 1] - 1) / (n - 1) : 1);
      abRetry();
    };
    R.go = show;
    R.step = (d) => show(d > 0 ? R.shown[R.shown.length - 1] + 1 : page - (double && page > 2 ? 2 : 1));
    footSlider(n, page, show);
    bindTurns(st, (side) => { pauseFollow(); R.step(dirOf(side)); });
    if (R.it.kind === "article" && !double) st.classList.add("fitw");
    R.refit = () => { drawn.clear(); show(page); };
    addEventListener("resize", R.refit);
    const prev = R.cleanup; R.cleanup = () => { removeEventListener("resize", R.refit); prev(); };
    await show(page);
  }
  function drawPdfAnns(box) {
    if (!box || !R) return;
    const num = Number(box.dataset.page), layer = box.querySelector(".hl-layer");
    if (layer) layer.innerHTML = anns().filter((a) => !isPin(a) && !isBm(a)).flatMap((a) => (a.locator.rects || []).filter((r) => r.p === num).map((r) =>
      `<i class="hl ${a.id === R.active ? "on" : ""}" data-ann="${esc(a.id)}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;background:${hl(a.color)}"></i>`)).join("");
    drawPins(box.querySelector(".pin-layer"), num);
    if (anns().some((a) => isBm(a) && a.locator.page === num)) { if (!box.querySelector(".bm-flag")) box.insertAdjacentHTML("beforeend", `<i class="bm-flag"></i>`); }
    else box.querySelector(".bm-flag")?.remove();
  }
  // selected text on a PDF page: its rectangles, as fractions of the page (the computer's form)
  function pdfSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const startPage = range.startContainer.parentElement?.closest(".pp");
    if (!startPage) return null;
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!quote) return null;
    const boxes = $$("#rStage .pp").map((p) => ({ p, b: p.getBoundingClientRect() }));
    const rects = [];
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      const hit = boxes.find(({ b }) => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom);
      if (!hit) continue;
      const b = hit.b, r = { p: Number(hit.p.dataset.page), x: (cr.left - b.left) / b.width, y: (cr.top - b.top) / b.height, w: cr.width / b.width, h: cr.height / b.height };
      const prev = rects.find((q) => q.p === r.p && Math.abs(q.y - r.y) < r.h * 0.5 && r.x <= q.x + q.w + 0.01 && r.x + r.w >= q.x - 0.01);
      if (prev) { const x2 = Math.max(prev.x + prev.w, r.x + r.w); prev.x = Math.min(prev.x, r.x); prev.w = x2 - prev.x; prev.h = Math.max(prev.h, r.h); }
      else rects.push(r);
    }
    if (!rects.length) return null;
    const all = range.getClientRects(), lr = all[all.length - 1];
    return { quote, locator: { page: rects[0].p, rects }, at: { x: lr.left + lr.width / 2, y: lr.bottom } };
  }
  document.addEventListener("selectionchange", () => {
    if (!R || R.kind !== "pdf") return;
    clearTimeout(R.selT);
    R.selT = setTimeout(() => {
      const s = pdfSelection();
      if (!s) { if (!$("#rPop")?.matches(":active")) hidePop(); return; }
      R.pending_hl = { ...s, win: window };
      showPop(s.at.x, s.at.y);
    }, 350);
  });
  const pageGrid = (count) => `<h4>Pages</h4><form class="toc-go" data-toc-goform><input type="number" min="1" max="${count}" inputmode="numeric" placeholder="Go to page (1–${count})"><button class="btn sm">Go</button></form>
    <div class="toc-pages">${Array.from({ length: count }, (_, i) => `<button class="toc-pg ${i + 1 === R.cur ? "on" : ""}" data-toc-page="${i + 1}">${i + 1}</button>`).join("")}</div>`;

  /* ---------------- comics (CBZ: pages straight out of the zip, one at a time; CBR, CB7, CBT: unpacked here) */
  let archiveLib = null;
  async function comicSource() {
    if (R.ext === "cbz") {
      const base = "/comic/" + encodeURIComponent(R.name) + "/";
      const { count } = await (await fetch(base + "count")).json();
      return { count, url: async (i) => base + i };
    }
    archiveLib ||= import(new URL("vendor/libarchive/libarchive.js", location.href).href).then((m) => { m.Archive.init({ workerUrl: new URL("vendor/libarchive/worker-bundle.js", location.href).href }); return m.Archive; });
    const Archive = await archiveLib;
    const blob = await (await fetch(R.url)).blob();
    const arc = await Archive.open(new File([blob], R.name));
    const full = (e) => (e.path || "") + e.file.name;
    const nat = (a, b) => full(a).localeCompare(full(b), undefined, { numeric: true, sensitivity: "base" });
    const list = (await arc.getFilesArray()).filter((e) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(e.file.name) && !full(e).startsWith("__MACOSX") && !e.file.name.startsWith(".")).sort(nat);
    const urls = new Map();
    R.cleanup = ((prev) => () => { for (const u of urls.values()) u.then((x) => URL.revokeObjectURL(x)); prev && prev(); })(R.cleanup);
    return { count: list.length, url: (i) => { if (!urls.has(i)) urls.set(i, list[i].file.extract().then((f) => URL.createObjectURL(f))); return urls.get(i); } };
  }
  async function comic() {
    const st = shell(R.it, "comic");
    const m = modeOf("comic");
    const src = await comicSource();
    const count = src.count;
    if (!count) throw new Error("no pages found");
    R.n = count;
    const pageEl = (i) => { const d = document.createElement("div"); d.className = "cp"; d.dataset.page = i + 1; d.innerHTML = `<img class="pg" alt=""><div class="pin-layer"></div><button class="pz" data-zoom="${i}" aria-label="Zoom">⤢</button>`; return d; };
    bindPins(st);
    R.zoom = async (i) => lightbox(await src.url(i), `Page ${i + 1}`);
    st.addEventListener("click", (e) => { const z = e.target.closest(".pz"); if (z) { e.stopPropagation(); R.zoom(Number(z.dataset.zoom)); } }, true);
    R.drawAll = () => $$("#rStage .cp").forEach((el) => { drawPins(el.querySelector(".pin-layer"), Number(el.dataset.page)); el.classList.toggle("bm", anns().some((a) => isBm(a) && a.locator.page === Number(el.dataset.page))); });
    R.toc = async () => pageGrid(count);
    R.here = () => ({ page: R.cur || 1 });
    R.onPageHere = (a) => (R.shown || [R.cur]).includes(a.locator.page);
    if (m === "scroll") {
      const first = new Image();
      first.src = await src.url(0);
      await first.decode().catch(() => {});
      R.go = scrollView(st, count, (first.naturalWidth || 2) / (first.naturalHeight || 3), async (box, num) => {
        const el = pageEl(num - 1);
        const im = el.querySelector("img");
        im.onload = () => { box.style.aspectRatio = String(im.naturalWidth / im.naturalHeight); };
        im.src = await src.url(num - 1);
        box.replaceChildren(el);
        R.drawAll();
      }, (box) => { box.innerHTML = ""; });
      footSlider(count, parseInt(R.it.last_location) || 1, (p) => R.go(p));
      return;
    }
    const double = m === "double";
    const stage = document.createElement("div");
    stage.className = "cspread" + (double ? " two" : "");
    st.appendChild(stage);
    let page = Math.min(count, Math.max(1, parseInt(R.it.last_location) || 1));
    // pages around the one you're on are fetched and decoded ahead, and a page only goes on screen once it's ready
    const cache = new Map();
    const get = (n) => {
      if (n < 1 || n > count) return null;
      if (!cache.has(n)) { const el = pageEl(n - 1), im = el.querySelector("img"); cache.set(n, { el, ready: src.url(n - 1).then((u) => { im.src = u; return im.decode(); }).catch(() => {}) }); }
      return cache.get(n);
    };
    let want = 0;
    const show = async (p) => {
      const nums = spreadFor(Math.min(count, Math.max(1, p)), count, double);
      page = nums[0]; R.cur = page; R.shown = nums;
      const k = ++want, cs = nums.map(get);
      await Promise.all(cs.map((c) => c.ready));
      if (k !== want || !R) return;            // turned again while it loaded
      stage.replaceChildren(...(rtl() ? [...cs].reverse() : cs).map((c) => c.el));
      R.drawAll();
      for (const n2 of [nums[nums.length - 1] + 1, nums[nums.length - 1] + 2, nums[nums.length - 1] + 3, nums[0] - 1]) get(n2);
      for (const n2 of [...cache.keys()]) if (n2 < page - 4 || n2 > page + 6) cache.delete(n2);
      if (st.classList.contains("fitw")) st.scrollTop = 0;
      $("#rPos").textContent = `${nums.join("–")} / ${count}`;
      const sl = $("#rSlide"); if (sl) sl.value = page;
      save(page, count > 1 ? (nums[nums.length - 1] - 1) / (count - 1) : 1);
    };
    R.go = show;
    R.step = (d) => show(d > 0 ? R.shown[R.shown.length - 1] + 1 : page - (double && page > 2 ? 2 : 1));
    footSlider(count, page, show);
    bindTurns(st, (side) => R.step(dirOf(side)));
    show(page);
  }

  /* ---------------- EPUB */
  async function epub() {
    const st = shell(R.it, "epub");
    const m = modeOf("epub"), scrolling = m === "scroll";
    const box = document.createElement("div");
    box.className = "r-epub";
    st.appendChild(box);
    const th = S.eink ? { bg: "#fff", ink: "#000", font: "Georgia, serif" } : ((window.THEMES || {})[document.documentElement.dataset.theme] || {}).reader || { bg: "#fff", ink: "#222", font: "serif" };   // (e-reader mode: black on white)
    $("#reader").style.background = th.bg;
    const data = await (await fetch(R.url)).arrayBuffer();
    const book = ePub(data);
    R.book = book;
    // scrolling: each chapter is one long page, and swiping on past its end brings the next one;
    // pages: one screen (or two side by side) at a time
    const rend = book.renderTo(box, scrolling ? { width: "100%", height: "100%", flow: "scrolled-doc", allowScriptedContent: false, ignoreClass: "ink-pin" }
      : { width: "100%", height: "100%", flow: "paginated", spread: m === "double" ? "always" : "none", minSpreadWidth: 0, allowScriptedContent: false, ignoreClass: "ink-pin" });
    R.rend = rend;
    rend.themes.default({ body: { background: th.bg + " !important", color: th.ink + " !important", "font-family": th.font, "line-height": "1.6", padding: "0 6px !important" },
      // the book's own colours would fight the theme (dark text on a dark page): the theme's ink wins everywhere
      "p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, em, strong, b, i, small, sup, sub, dd, dt": { color: th.ink + " !important", background: "transparent !important" },
      a: { color: th.ink + " !important", "text-decoration-color": "currentColor" }, img: { "max-width": "100% !important" } });
    rend.themes.fontSize((S.readFont || 100) + "%");
    R.cleanup = () => { try { book.destroy(); } catch (e) {} $("#reader").style.background = ""; };
    rend.hooks.content.register((contents) => {
      const d = contents.document;
      const s = d.createElement("style");
      s.textContent = `.ink-pin{position:absolute;z-index:5;width:24px;height:24px;margin:-26px 0 0 -12px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid rgba(0,0,0,.65);box-shadow:0 2px 6px rgba(0,0,0,.4);font:700 11px/20px sans-serif;text-align:center;color:#111}
        .ink-pin span{display:inline-block;transform:rotate(45deg)} .ink-pin.on{outline:3px solid #fff}`;
      d.head.append(s);
      d.addEventListener("click", (e) => {
        const pin = e.target.closest?.(".ink-pin");
        if (pin) { e.preventDefault(); e.stopPropagation(); notesSheet(pin.dataset.ann); return; }
        if (R && R.pinMode) { e.preventDefault(); e.stopPropagation(); return epubPinAt(contents, e); }
        const img = e.target.closest?.("img") || (e.target.tagName === "image" ? e.target : null);
        if (img) { const u = img.currentSrc || img.src || img.getAttribute("href") || img.getAttributeNS("http://www.w3.org/1999/xlink", "href"); if (u) { e.preventDefault(); e.stopPropagation(); lightbox(u, img.alt || ""); } }
      }, true);
      setTimeout(() => drawEpubPins(contents), 50);
    });
    const label = () => {
      try {
        const href = rend.currentLocation()?.start?.href;
        const flat = (items) => items.flatMap((i) => [i, ...flat(i.subitems || [])]);
        const hit = flat(book.navigation?.toc || []).find((t) => href && t.href.split("#")[0].endsWith(href.split("/").pop()));
        return hit ? hit.label.trim() : "";
      } catch (e) { return ""; }
    };
    R.label = label;
    const cfi = String(R.it.last_location || "");
    await rend.display(cfi.startsWith("epubcfi") ? cfi : undefined);
    for (const a of anns()) addEpubHl(a);
    let ready = false;
    rend.on("relocated", (loc) => {
      R.loc = loc;
      const pct = book.locations.length() ? book.locations.percentageFromCfi(loc.start.cfi) : null;
      $("#rPos").textContent = [label(), pct != null ? Math.round(pct * 100) + "%" : ""].filter(Boolean).join(" · ");
      if (ready || pct != null) save(loc.start.cfi, pct ?? R.it.progress ?? 0);
      ready = true;
      setTimeout(() => drawEpubPins(), 60);
    });
    rend.on("selected", (cfiRange, contents) => {
      if (R.pinMode) return;
      const sel = contents.window.getSelection();
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      if (!quote) return;
      const rr = sel.getRangeAt(0).getBoundingClientRect(), fr = contents.document.defaultView.frameElement.getBoundingClientRect();
      R.pending_hl = { quote, locator: { cfi: cfiRange, label: label() }, win: contents.window };
      showPop(fr.left + rr.left + rr.width / 2, fr.top + rr.bottom);
    });
    rend.on("markClicked", (cfiRange, data) => { if (data && data.id) notesSheet(data.id); });
    R.go = (target) => rend.display(target).then(() => setTimeout(() => drawEpubPins(), 60));
    R.toc = async () => {
      try { await book.loaded.navigation; } catch (e) {}
      const toc = book.navigation?.toc || [];
      const here = (rend.currentLocation()?.start?.href || "").split("/").pop();
      const row = (t, d) => `<button class="toc-row ${here && t.href.split("#")[0].split("/").pop() === here ? "on" : ""}" data-toc-href="${esc(t.href)}" style="--d:${d}">${esc((t.label || "").trim() || "Untitled section")}</button>${(t.subitems || []).map((x) => row(x, d + 1)).join("")}`;
      return `<h4>Chapters</h4><div class="toc-tree">${toc.length ? toc.map((t) => row(t, 0)).join("") : book.spine.spineItems.filter((x) => x.linear !== "no").map((x, i) => `<button class="toc-row" data-toc-href="${esc(x.href)}">Section ${i + 1}</button>`).join("")}</div>`;
    };
    R.here = () => { const l = R.loc || rend.currentLocation(); return l && l.start ? { cfi: l.start.cfi, label: label() } : null; };
    R.onPageHere = (a) => {
      const l = R.loc || rend.currentLocation();
      if (!l || !l.start || !a.locator.cfi) return false;
      try { const c = new ePub.CFI(); return c.compare(a.locator.cfi, l.start.cfi) >= 0 && c.compare(a.locator.cfi, l.end.cfi) <= 0; } catch (e) { return a.locator.cfi === l.start.cfi; }
    };
    R.drawAll = () => { for (const a of anns()) addEpubHl(a); drawEpubPins(); };
    if (scrolling) {          // scrolling turns no pages: a tap shows or hides the bars
      rend.on("click", (e) => { if (!String(e.view.getSelection()).trim() && !R.pinMode) bar(); });
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
      R.step = turn;
      if (sc) sc.addEventListener("scroll", () => {
        pauseFollow();
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
      const showMore = () => { more.hidden = !(atEnd() && sc.scrollHeight >= 0); };
      rend.on("rendered", () => setTimeout(showMore, 300));
      setTimeout(showMore, 300);
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
    const step = (side, swipe) => { pauseFollow(); return dirOf(side, swipe) > 0 ? rend.next() : rend.prev(); };
    R.step = (d) => (d > 0 ? rend.next() : rend.prev());
    let x0 = null;
    rend.on("touchstart", (e) => { x0 = e.changedTouches[0].screenX; });
    rend.on("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].screenX - x0;
      x0 = null;
      if (Math.abs(dx) > 50 && !String(e.view?.getSelection?.() || "").trim()) step(dx < 0 ? "right" : "left", true);
    });
    rend.on("click", (e) => {
      if (R.pinMode || (window.getSelection && String(e.view.getSelection()).trim())) return;
      const w = box.clientWidth, x = ((e.clientX % w) + w) % w;
      if (x < w * 0.3) step("left"); else if (x > w * 0.7) step("right"); else bar();
    });
    // percentages need the book's locations, worked out in the background
    book.ready.then(() => book.locations.generate(1200)).then(() => { if (R && rend.location) rend.emit("relocated", rend.location); }).catch(() => {});
  }
  function addEpubHl(a) {
    if (!R || !R.rend || !a.locator || !a.locator.cfi || isPin(a) || isBm(a)) return;
    try { R.rend.annotations.remove(a.locator.cfi, "highlight"); } catch (e) {}
    try { R.rend.annotations.highlight(a.locator.cfi, { id: a.id }, () => notesSheet(a.id), "ink-hl", { fill: hl(a.color), "fill-opacity": a.id === R.active ? "0.6" : "0.4", "mix-blend-mode": "multiply" }); } catch (e) {}
  }
  function epubPinAt(contents, e) {
    const d = contents.document;
    let range = d.caretRangeFromPoint ? d.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (!range && d.caretPositionFromPoint) { const p = d.caretPositionFromPoint(e.clientX, e.clientY); if (p) { range = d.createRange(); range.setStart(p.offsetNode, p.offset); } }
    if (!range) return;
    const node = range.startContainer;
    if (node.nodeType === 3 && range.startOffset < node.length) range.setEnd(node, range.startOffset + 1);
    let cfi;
    try { cfi = contents.cfiFromRange(range, "ink-pin"); } catch (err) { return; }
    const a = newAnn({ locator: { type: "pin", cfi, label: R.label ? R.label() : "" } });
    pinMode(false);
    notesSheet(a.id, true);
  }
  function drawEpubPins(contents) {
    if (!R || !R.rend) return;
    for (const c of contents ? [contents] : (R.rend.getContents() || [])) {
      const d = c.document;
      if (!d || !d.body) continue;
      d.querySelectorAll(".ink-pin").forEach((x) => x.remove());
      if (getComputedStyle(d.body).position === "static") d.body.style.position = "relative";
      for (const a of anns().filter((x) => isPin(x) && x.locator.cfi)) {
        let r;
        try { r = c.range(a.locator.cfi, "ink-pin")?.getBoundingClientRect(); } catch (e) { continue; }
        if (!r || (!r.width && !r.height && !r.left)) continue;
        const b = d.body.getBoundingClientRect(), p = d.createElement("div");
        p.className = "ink-pin" + (a.id === R.active ? " on" : "");
        p.dataset.ann = a.id;
        p.style.cssText = `left:${r.left - b.left}px;top:${r.top - b.top}px;background:${hl(a.color)}`;
        p.innerHTML = `<span>${pinNo(a)}</span>`;
        d.body.append(p);
      }
    }
  }

  /* ---------------- notes, highlights, pins and bookmarks: the sheet that lists them */
  function sortAnns() {
    return anns().sort((a, b) => {
      const la = a.locator || {}, lb = b.locator || {};
      if (R.kind !== "epub") return (pageOf(a) - pageOf(b)) || ((la.y ?? (la.rects || [{}])[0].y ?? 0) - (lb.y ?? (lb.rects || [{}])[0].y ?? 0)) || (a.created_at - b.created_at);
      if (la.cfi && lb.cfi) { try { return new ePub.CFI().compare(la.cfi, lb.cfi); } catch (e) {} }
      return (a.created_at || 0) - (b.created_at || 0);
    });
  }
  function redraw() { if (R && R.drawAll) R.drawAll(); paintCount(); paintMark(); }
  function sheet(html, cls = "") {
    const s = $("#rSheet");
    s.className = "r-sheet " + cls;
    s.innerHTML = `<div class="rs-grip" data-rs-close></div>${html}`;
    s.hidden = false;
    bar(true);
    return s;
  }
  const closeSheet = () => { const s = $("#rSheet"); if (s) s.hidden = true; };
  function notesSheet(focusId, edit) {
    if (!R) return;
    R.active = focusId != null ? (anns().find((a) => String(a.id) === String(focusId)) || {}).id ?? null : R.active;
    redraw();
    const list = sortAnns();
    const where = (a) => { const l = a.locator || {}; return pageOf(a) ? `p. ${pageOf(a)}` : l.label || ""; };
    const what = (a) => (isPin(a) ? `📍 Pin ${pinNo(a)}` : isBm(a) ? "🔖 Bookmark" : a.quote ? "Highlight" : "Note");
    const s = sheet(`<div class="rs-head"><b>Notes and highlights</b><span class="hint">${list.length || ""}</span><button class="btn sm" data-rs-close>Done</button></div>
      <div class="rs-body">${list.length ? list.map((a) => `<div class="rn ${a.id === R.active ? "on" : ""}" data-rn="${esc(a.id)}" style="--hl:${hl(a.color)}">
          <div class="rn-top"><small>${esc([what(a), where(a)].filter(Boolean).join(" · "))}</small>
            <span class="rn-colors">${Object.keys(HLV).map((c) => `<button data-rn-color="${c}" class="${a.color === c ? "on" : ""}" style="background:${hl(c)}" aria-label="${c}"></button>`).join("")}</span>
            <button class="rn-del" data-rn-del aria-label="Delete">🗑</button></div>
          ${a.quote ? `<blockquote data-rn-go>${esc(a.quote)}</blockquote>` : `<button class="rn-go" data-rn-go>Go there ›</button>`}
          <input class="rn-title" value="${esc(a.title || "")}" placeholder="Title (optional)">
          <div class="rn-noterow"><textarea class="rn-note" rows="2" placeholder="${isPin(a) ? "Write a comment…" : "Write a note…"}">${esc(a.note || "")}</textarea><button class="mic" data-rn-mic aria-label="Dictate">🎙</button></div></div>`).join("")
        : `<p class="hint">Select text to highlight it (press and hold on a word, then drag), tap 📍 to pin a note anywhere on a page, or 🔖 to bookmark it. They're saved with your library, so the computer has them too.</p>`}</div>`, "notes");
    const el = focusId != null && s.querySelector(`[data-rn="${CSS.escape(String(R.active))}"]`);
    if (el) { el.scrollIntoView({ block: "center" }); if (edit) setTimeout(() => el.querySelector(".rn-note")?.focus(), 250); }
  }
  function jumpTo(a) {
    const l = a.locator || {};
    closeSheet();
    R.active = a.id;
    if (l.cfi && R.go && R.kind === "epub") return R.go(l.cfi);
    const p = pageOf(a);
    if (p && R.go) { R.go(p, Math.max(0, (l.y ?? (l.rects || [{}])[0].y ?? 0) - 0.1)); setTimeout(redraw, 300); }
  }
  /* 🔖: a bookmark on the page you're on (or off again) */
  const marksHere = () => (R && R.onPageHere ? anns().filter((a) => isBm(a) && R.onPageHere(a)) : []);
  function paintMark() { const b = $("#reader [data-rt=mark]"); if (b) b.classList.toggle("on", marksHere().length > 0); }
  function toggleMark() {
    if (!R || !R.here) return;
    const here = marksHere();
    if (here.length) { here.forEach((a) => Ann.del(a)); toast("Bookmark removed"); }
    else {
      const h = R.here();
      if (!h) return;
      const colors = Object.keys(HLV), n = anns().filter(isBm).length;
      Ann.add(R.it.id, { title: h.page ? `p. ${h.page}` : h.label || "Bookmark", color: colors[n % colors.length], locator: { type: "bookmark", ...h } });
      toast("Page bookmarked");
    }
    redraw();
  }

  /* ---------------- ☰ contents (chapters, pages, bookmarks; episodes for TV) */
  async function tocSheet() {
    if (!R || !R.toc) return;
    const s = sheet(`<div class="rs-head"><b>${R.kind === "video" ? "Episodes" : "Contents"}</b><button class="btn sm" data-rs-close>Done</button></div><div class="rs-body"><p class="hint">Loading…</p></div>`, "toc");
    const marks = anns().filter(isBm);
    const html = (marks.length ? `<h4>Bookmarks</h4><div class="toc-tree">${sortAnns().filter(isBm).map((a) => `<button class="toc-row bm" data-toc-ann="${esc(a.id)}" style="--bm:${hl(a.color)}">🔖 ${esc(a.title || a.locator.label || `p. ${a.locator.page}`)}</button>`).join("")}</div>` : "") + await R.toc();
    if (!s.hidden && R) { s.querySelector(".rs-body").innerHTML = html; s.querySelector(".toc-row.on, .toc-pg.on")?.scrollIntoView({ block: "center" }); }
  }

  /* ---------------- Aa: layout, text size, direction; subtitles and audio for video */
  function viewSheet() {
    if (!R) return;
    const key = R.kind;
    if (key === "video") return trackSheet();
    const m = modeOf(key), b = (k, n, d) => `<button class="vs-mode ${m === k ? "on" : ""}" data-vs-mode="${k}"><b>${n}</b><small>${d}</small></button>`;
    const pdfComic = key === "comic" || (key === "pdf" && R.it.kind === "graphic");
    sheet(`<div class="rs-head"><b>Layout</b><button class="btn sm" data-rs-close>Done</button></div><div class="rs-body">
      <div class="vs-modes">${b("pages", "One page", "Tap or swipe to turn")}${b("double", "Two pages", "Side by side, like an open book")}${b("scroll", "Scrolling", "One long page")}</div>
      ${key === "epub" ? `<label class="vs-row">Text size <input type="range" min="70" max="180" step="5" value="${S.readFont || 100}" data-vs-font><b data-vs-fontv>${S.readFont || 100}%</b></label>` : ""}
      ${key !== "epub" && m !== "scroll" ? `<label class="vs-row check"><input type="checkbox" data-vs-fitw ${$("#rStage").classList.contains("fitw") ? "checked" : ""}> Fit the width (scroll down the page)</label>` : ""}
      ${pdfComic ? `<label class="vs-row check"><input type="checkbox" data-vs-rtl ${rtl() ? "checked" : ""}> Right to left (manga)</label>` : ""}
      </div>`, "view");
  }

  /* ---------------- zoom: a page or picture full screen; pinch or double-tap to zoom, drag to look around */
  function lightbox(src, cap) {
    const lb = $("#rLight");
    lb.innerHTML = `<img alt=""><span class="lb-cap">${esc(cap || "")}</span><button class="lb-x" aria-label="Close">✕</button>`;
    lb.hidden = false;
    const img = lb.querySelector("img");
    img.src = src;
    let z = 1, x = 0, y = 0, pts = new Map(), last = null, lastTap = 0;
    const apply = () => { img.style.transform = `translate(${x}px,${y}px) scale(${z})`; };
    lb.querySelector(".lb-x").onclick = () => { lb.hidden = true; lb.innerHTML = ""; };
    lb.onpointerdown = (e) => {
      if (e.target.closest(".lb-x")) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); lb.setPointerCapture(e.pointerId); last = null;
      if (pts.size === 1 && Date.now() - lastTap < 300) { z = z > 1.2 ? 1 : 2.5; if (z === 1) x = y = 0; apply(); }
      lastTap = Date.now();
    };
    lb.onpointermove = (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (last) z = Math.max(1, Math.min(8, z * d / last));
        last = d;
      } else if (z > 1) { x += e.clientX - prev.x; y += e.clientY - prev.y; }
      apply();
    };
    lb.onpointerup = lb.onpointercancel = (e) => { pts.delete(e.pointerId); last = null; };
  }

  /* ---------------- 🎧 the book's audiobook (made on the computer), with the sentence being read lit up.
     It plays from the chapter you're reading; turn pages yourself and it stops following for a while. */
  let followPause = 0, abNav = false;
  const pauseFollow = () => { if (!abNav) followPause = Date.now() + 12000; };
  const normT = (s) => (s || "").replace(/[­​]/g, "").replace(/\s+/g, " ").trim();
  async function listen() {
    if (R.ab && R.ab.audio) { const a = R.ab.audio; if (a.paused) a.play(); else a.pause(); return; }
    let m;
    try { m = await api("GET", `/sync/item/${R.it.id}/audiobook`); } catch (e) { return toast(e.offline ? "Listening needs your computer: it streams the audiobook." : "This book has no audiobook yet."); }
    let ch = 0, t = 0;
    if (R.kind === "epub") {
      const href = (R.rend.currentLocation()?.start?.href || "").split("/").pop();
      ch = Math.max(0, m.chapters.findIndex((c) => (c.sentences || []).some((s) => (s.href || "").split("/").pop() === href)));
    } else m.chapters.forEach((c, i) => { if ((c.page || 1) <= (R.cur || 1)) ch = i; });
    try { const p = JSON.parse(R.it.audio_pos || "{}"); if (p.ch === ch) t = p.t || 0; } catch (e) {}
    const audio = new Audio();
    R.ab = { m, ch, audio, last: null };
    const at = $("#rAb") || $("#rFoot").appendChild(Object.assign(document.createElement("span"), { id: "rAb" }));
    const load = async (c, from) => {
      R.ab.ch = c; at.textContent = "🎧 Loading…";
      // (the chapter comes whole from the computer, so it seeks smoothly even through the away-from-home address)
      const r = await fetch(`/net/sync/item/${R.it.id}/audio/${c}`);
      if (!r.ok || !R || !R.ab) { if (R && R.ab) { at.textContent = ""; toast("Couldn't reach your computer for the audiobook."); stopListening(); } return; }
      if (R.ab.url) URL.revokeObjectURL(R.ab.url);
      R.ab.url = URL.createObjectURL(await r.blob());
      audio.src = R.ab.url;
      audio.currentTime = from || 0;
      audio.play().catch(() => {});
    };
    audio.ontimeupdate = () => {
      if (!R || !R.ab) return;
      const c = m.chapters[R.ab.ch];
      at.textContent = `🎧 ${(c && c.title) || "Chapter " + (R.ab.ch + 1)} · ${Math.floor(audio.currentTime / 60)}:${String(Math.floor(audio.currentTime % 60)).padStart(2, "0")}${audio.paused ? " ▶" : " ❚❚"}`;
      if (Math.abs((R.ab.saved || 0) - audio.currentTime) > 10) { R.ab.saved = audio.currentTime; change(R.it.id, { audio_pos: JSON.stringify({ ch: R.ab.ch, t: audio.currentTime, done: false }) }); }
      const k = (c.sentences || []).findIndex((s) => audio.currentTime >= s.t0 - 0.05 && audio.currentTime < s.t1 + 0.25);
      if (k >= 0 && R.ab.last !== R.ab.ch + ":" + k) { R.ab.last = R.ab.ch + ":" + k; sentence(c.sentences[k]); }
    };
    audio.onpause = audio.onplay = () => { $("#reader [data-rt=listen]")?.classList.toggle("on", !audio.paused); audio.ontimeupdate(); };
    audio.onended = () => { if (R && R.ab && R.ab.ch + 1 < m.chapters.length) load(R.ab.ch + 1, 0); };
    at.onclick = () => (audio.paused ? audio.play() : audio.pause());
    load(ch, t);
  }
  function stopListening() {
    if (!R || !R.ab) return;
    const a = R.ab.audio;
    if (a) { change(R.it.id, { audio_pos: JSON.stringify({ ch: R.ab.ch, t: a.currentTime || 0, done: false }) }); a.pause(); a.removeAttribute("src"); }
    if (R.ab.url) URL.revokeObjectURL(R.ab.url);
    if (R.ab.cfi && R.rend) try { R.rend.annotations.remove(R.ab.cfi, "highlight"); } catch (e) {}
    R.ab = null;
  }
  const abRetry = () => { if (R && R.ab) R.ab.last = null; };
  function findRange(root, text) {
    const want = normT(text);
    if (!want) return null;
    const w = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let flat = "", map = [], sp = true;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.parentElement && n.parentElement.closest("script,style,.ink-pin,sup")) continue;
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i++) {
        let ch = v[i];
        if (ch === "­" || ch === "​") continue;
        if (/\s/.test(ch)) { if (sp) continue; ch = " "; sp = true; } else sp = false;
        flat += ch; map.push([n, i]);
      }
    }
    let at = flat.indexOf(want), len = want.length;
    if (at < 0) { at = flat.indexOf(want.slice(0, 48)); len = Math.min(want.length, flat.length - at); }
    if (at < 0) return null;
    const a = map[at], b = map[Math.min(map.length - 1, at + len - 1)], r = root.ownerDocument.createRange();
    r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1);
    return r;
  }
  async function sentence(s) {
    if (!R || !R.ab) return;
    const follow = Date.now() > followPause;
    if (R.kind === "epub") {
      const href = (s.href || "").split("/").pop();
      const c = R.rend.getContents().find((x) => (R.book.spine.get(x.sectionIndex)?.href || "").split("/").pop() === href);
      if (!c) {
        if (!follow) return;
        const sec = R.book.spine.spineItems.find((x) => x.href.split("/").pop() === href);
        if (sec) { abNav = true; await R.rend.display(sec.href); abNav = false; R.ab && (R.ab.last = null); }
        return;
      }
      const range = findRange(c.document.body, s.text);
      if (!range) return;
      let cfi;
      try { cfi = c.cfiFromRange(range); } catch (e) { return; }
      if (R.ab.cfi) try { R.rend.annotations.remove(R.ab.cfi, "highlight"); } catch (e) {}
      R.ab.cfi = cfi;
      R.rend.annotations.highlight(cfi, {}, null, "tts-hl", { fill: "rgb(255, 210, 64)", "fill-opacity": "0.45", "mix-blend-mode": "multiply" });
      if (follow && !R.onPageHere({ locator: { cfi } }) && modeOf("epub") !== "scroll") { abNav = true; await R.rend.display(cfi); abNav = false; }
    } else if (R.kind === "pdf") {
      const box = $(`#rStage .pp[data-page="${s.page || 1}"]`);
      if (!box) { if (follow && R.go) { abNav = true; R.go(s.page || 1); abNav = false; } return; }
      const tl = box.querySelector(".textLayer"), layer = box.querySelector(".tts-layer");
      $$("#rStage .tts-layer").forEach((l) => (l.innerHTML = ""));
      const range = tl && tl.childNodes.length ? findRange(tl, s.text) : null;
      if (!range) { R.ab.last = null; return; }
      const b = box.getBoundingClientRect();
      layer.innerHTML = [...range.getClientRects()].filter((r) => r.width > 1).map((r) => `<i style="left:${r.left - b.left}px;top:${r.top - b.top}px;width:${r.width}px;height:${r.height}px"></i>`).join("");
    }
  }

  /* ---------------- video */
  function video() {
    const it = R.it;
    const st = shell(it, "video");
    $("#reader").classList.add("calm");
    const skip = (s) => `<button class="v-skip" data-vskip="${s}">${s < 0 ? `↺ ${-s}` : `${s} ↻`}</button>`;
    st.innerHTML = `<div class="v-box"><video class="r-media" controls playsinline autoplay preload="metadata"></video><span class="v-flash" id="vFlash"></span></div>
      <div class="v-skips">${[-30, -10, -5].map(skip).join("")}<span class="v-gap"></span>${[5, 10, 30].map(skip).join("")}</div>`;
    const v = st.querySelector("video");
    R.video = v;
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
    let lastTap = 0, tapT = null;
    v.addEventListener("click", (e) => {
      const t = Date.now();
      if (t - lastTap < 300) { e.preventDefault(); clearTimeout(tapT); const r = v.getBoundingClientRect(); jump(e.clientX < r.left + r.width / 2 ? -10 : 10); lastTap = 0; }
      else { lastTap = t; clearTimeout(tapT); tapT = setTimeout(() => bar(), 320); }      // one tap: the bar and the skip buttons
    });
    // the phone's media notification (and the lock screen): play/pause, 10 s back and on, ✕
    const label = it.kind === "tv" ? [it.series, epLabel(it)].filter(Boolean).join(" · ") : [(it.authors || [])[0], it.year].filter(Boolean).join(" · ");
    const me = {
      command(cmd) {
        if (cmd === "toggle") v.paused ? v.play().catch(() => {}) : v.pause();
        else if (cmd === "play") v.play().catch(() => {});
        else if (cmd === "pause") v.pause();
        else if (cmd === "fwd" || cmd === "next") jump(10);
        else if (cmd === "back" || cmd === "prev") jump(-10);
        else if (cmd === "stop") { v.pause(); Media.hide(me); }
      },
    };
    const note = () => { if (R && R.it === it) Media.show(me, { title: it.title || "", artist: label, kind: "video", playing: !v.paused }); };
    v.addEventListener("play", () => { note(); if (window.Jukebox) Jukebox.pauseForVideo(); });
    v.addEventListener("pause", () => { note(); bar(true); });
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: it.title || "", artist: label });
        navigator.mediaSession.setActionHandler("play", () => v.play()); navigator.mediaSession.setActionHandler("pause", () => v.pause());
        navigator.mediaSession.setActionHandler("seekbackward", () => jump(-10)); navigator.mediaSession.setActionHandler("seekforward", () => jump(10));
      } catch (e) {}
    }
    let resumed = false, lastSave = 0;
    const resume = () => {
      const t = parseFloat(it.last_location) || 0;
      if (!resumed && t > 5 && t < v.duration - 10) v.currentTime = t;
      resumed = true;
    };
    v.addEventListener("loadedmetadata", resume);
    v.addEventListener("timeupdate", () => {
      if (v.duration && Math.abs(v.currentTime - lastSave) > 10) { lastSave = v.currentTime; save(v.currentTime.toFixed(0), v.currentTime / v.duration); }
      $("#rPos").textContent = "";
    });
    v.addEventListener("pause", () => { if (v.duration) { save(v.currentTime.toFixed(0), v.currentTime / v.duration); saveNow(); } });
    const sib = siblings(it), nx = sib[sib.findIndex((x) => x.id === it.id) + 1];
    v.addEventListener("ended", () => {
      save(v.duration.toFixed(0), 1);
      change(it.id, { watched: 1, watched_at: now(), progress: 1, last_location: String(Math.round(v.duration)) });
      if (!nx) return;
      // up next, after a short countdown (or straight away, or not at all)
      const box = document.createElement("div");
      box.className = "up-next";
      let n = 8;
      box.innerHTML = `<small>Up next</small><b>${esc((nx.kind === "tv" ? epLabel(nx) + " · " : "") + nx.title)}</b><span class="un-c">Playing in ${n} s</span>
        <span class="btns"><button class="btn primary sm" data-un="go">Play now</button><button class="btn sm" data-un="stop">Cancel</button></span>`;
      st.append(box);
      const t = setInterval(() => { n--; box.querySelector(".un-c").textContent = `Playing in ${n} s`; if (n <= 0) { clearInterval(t); if (R && R.it === it) start(nx); } }, 1000);
      box.onclick = (e) => { const b = e.target.closest("[data-un]"); if (!b) return; clearInterval(t); if (b.dataset.un === "go") start(nx); else box.remove(); };
      R.cleanup = ((prev) => () => { clearInterval(t); prev && prev(); })(R.cleanup);
    });
    v.addEventListener("error", () => { if (R && R.it === it && !v.src.startsWith("blob:")) unsupported("This video's format can't be played inside the app."); });
    v.src = (A && A.mediaUrl(R.name)) || R.url;
    // (the iPhone app hands the player the stored file itself: Safari seeks in it far more reliably)
    if (A && A.mediaUrlAsync) A.mediaUrlAsync(R.name).then((u) => { if (u && R && R.it === it) { resumed = false; v.src = u; } });
    R.cleanup = ((prev) => () => { v.pause(); v.removeAttribute("src"); v.load(); Media.hide(me); prev && prev(); })(R.cleanup);
    R.toc = async () => {
      const list = siblings(it);
      return list.length ? `<div class="toc-tree">${list.map((e) => `<button class="toc-row ep ${e.id === it.id ? "on" : ""} ${onPhone(e) ? "" : "off"}" data-toc-item="${e.id}"><span class="ep-c">${esc(epLabel(e))}</span><span class="ep-t">${esc(e.title || "")}</span>${e.watched ? "<span>✓</span>" : e.progress > 0.02 ? `<span>${Math.round(e.progress * 100)}%</span>` : ""}</button>`).join("")}</div>
        <p class="hint">Episodes that aren't on the phone are greyed: get them from the computer first.</p>` : `<p class="hint">This isn't part of a show or film series.</p>`;
    };
    subtitles(it, v);
  }
  const epLabel = (e) => (e.kind === "tv" ? `S${e.season || 1} · E${e.episode ?? "?"}` : e.year || "");
  function siblings(it) {
    const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    let list = [];
    if (it.kind === "tv") list = Object.values(S.items).filter((x) => x.kind === "tv" && key(x.series) === key(it.series));
    else if (it.series) list = Object.values(S.items).filter((x) => x.kind === "movie" && x.series === it.series);
    list = list.filter((x) => x.has_file).sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode ?? 1e9) - (b.episode ?? 1e9) || (a.series_index || 0) - (b.series_index || 0) || (parseInt(a.year) || 0) - (parseInt(b.year) || 0));
    return list.length > 1 ? list : [];
  }
  function episode(d) {
    const list = siblings(R.it), i = list.findIndex((x) => x.id === R.it.id);     // (by id: a sync brings new copies of the items)
    for (let k = i + d; k >= 0 && k < list.length; k += d) if (onPhone(list[k])) return start(list[k]);
    toast(d > 0 ? "No later episode on the phone." : "No earlier episode on the phone.");
  }
  /* subtitles: the computer lists and converts them; they're kept on the phone for watching offline later */
  async function subtitles(it, v) {
    let got = load(`subs-${it.id}.json`, null);
    if (!got) {
      try {
        const info = await api("GET", `/sync/item/${it.id}/tracks`);
        const subs = [];
        for (const t of (info.subtitles || []).filter((x) => x.supported)) {
          const r = await fetch(`/net/sync/item/${it.id}/subs/${t.id}.vtt`);
          if (r.ok) subs.push({ id: t.id, label: t.label, lang: t.lang, default: t.default, vtt: await r.text() });
        }
        got = { audio: info.audio || [], subs, unsupported: (info.subtitles || []).filter((x) => !x.supported).length };
        store(`subs-${it.id}.json`, got);
      } catch (e) { got = { audio: [], subs: [], offline: true }; }
    }
    if (!R || R.it !== it) return;
    R.tracks = got;
    for (const s of got.subs) {
      const tr = document.createElement("track");
      tr.kind = "subtitles"; tr.label = s.label; tr.srclang = (s.lang || "und").slice(0, 3); tr.dataset.sid = s.id;
      tr.src = URL.createObjectURL(new Blob([s.vtt], { type: "text/vtt" }));
      v.appendChild(tr);
    }
    const pref = trackPref(it);
    const want = pref.subLang === "off" ? "off" : (got.subs.find((t) => t.lang === pref.subLang && t.label === pref.subLabel) || got.subs.find((t) => t.lang === pref.subLang) || (pref.subLang ? null : got.subs.find((t) => t.default)) || {}).id || "off";
    setTimeout(() => pickSub(want), 300);
    const pickAudioPref = () => {
      if (!v.audioTracks || v.audioTracks.length < 2 || !pref.audioLang) return;
      const i = got.audio.findIndex((a) => a.lang === pref.audioLang);
      if (i >= 0 && i < v.audioTracks.length) [...v.audioTracks].forEach((a, j) => { a.enabled = j === i; });
    };
    v.addEventListener("loadedmetadata", pickAudioPref);
  }
  const trackKey = (it) => "tracks-" + (it.series ? "s-" + String(it.series).toLowerCase().replace(/[^a-z0-9]+/g, "") : "i" + it.id);
  const trackPref = (it) => (S.trackPrefs || {})[trackKey(it)] || {};
  const setTrackPref = (it, p) => { S.trackPrefs = { ...(S.trackPrefs || {}), [trackKey(it)]: { ...trackPref(it), ...p } }; saveState(); };
  function pickSub(sid) {
    const v = R && R.video;
    if (!v) return;
    [...v.textTracks].forEach((tt, j) => { const el = v.querySelectorAll("track")[j]; tt.mode = el && el.dataset.sid === sid ? "showing" : "disabled"; });
    R.sub = sid;
  }
  function trackSheet() {
    const g = R.tracks || { audio: [], subs: [] }, v = R.video;
    const multi = v && v.audioTracks && v.audioTracks.length > 1;
    sheet(`<div class="rs-head"><b>Subtitles and audio</b><button class="btn sm" data-rs-close>Done</button></div><div class="rs-body">
      <h4>Subtitles</h4><div class="vs-list"><button class="vs-opt ${(R.sub || "off") === "off" ? "on" : ""}" data-vs-sub="off">Off</button>${g.subs.map((s) => `<button class="vs-opt ${R.sub === s.id ? "on" : ""}" data-vs-sub="${esc(s.id)}">${esc(s.label)}</button>`).join("")}</div>
      ${!g.subs.length ? `<p class="hint">${g.offline ? "Subtitles come from your computer: open this once while it can be reached, and they're kept for offline." : g.unsupported ? "This file's subtitles are pictures (PGS/VobSub), which can't be shown yet." : "This video has no subtitles."}</p>` : ""}
      <h4>Audio</h4>${multi ? `<div class="vs-list">${[...v.audioTracks].map((t, i) => `<button class="vs-opt ${t.enabled ? "on" : ""}" data-vs-audio="${i}">${esc((g.audio[i] || {}).label || t.label || t.language || "Track " + (i + 1))}</button>`).join("")}</div>`
        : `<p class="hint">${g.audio.length > 1 ? `${g.audio.map((a) => esc(a.label)).join(", ")}: ${WEB ? "this player plays the file's first one." : "this phone's player plays the file's first one."}` : esc((g.audio[0] || {}).label || "One audio track")}</p>`}</div>`, "view");
  }

  /* ---------------- music: plays on through the album's tracks that are on the phone */
  function audio() {
    const it = R.it;
    const st = shell(it, "audio");
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

  /* ---------------- the reader's buttons and sheets */
  document.addEventListener("click", (e) => {
    if (!R) return;
    const t = e.target;
    if (t.closest("[data-r-close]")) return close();
    const rt = t.closest("[data-rt]");
    if (rt) {
      e.stopPropagation();
      const k = rt.dataset.rt;
      if (k === "toc") return tocSheet();
      if (k === "notes") return notesSheet();
      if (k === "view") return viewSheet();
      if (k === "pin") return pinMode(!R.pinMode);
      if (k === "mark") return toggleMark();
      if (k === "listen") return listen();
      if (k === "prevEp") return episode(-1);
      if (k === "nextEp") return episode(1);
    }
    const h = t.closest("[data-hl]"); if (h) { e.preventDefault(); return fromPending(h.dataset.hl); }
    if (t.closest("[data-rs-close]")) return closeSheet();
    const s = t.closest("#rSheet");
    if (!s) return;
    const row = t.closest("[data-rn]"), a = row && anns().find((x) => String(x.id) === row.dataset.rn);
    if (a) {
      const c = t.closest("[data-rn-color]");
      if (c) { Ann.edit(a, { color: c.dataset.rnColor }); row.style.setProperty("--hl", hl(a.color)); row.querySelectorAll("[data-rn-color]").forEach((b) => b.classList.toggle("on", b === c)); redraw(); return; }
      if (t.closest("[data-rn-del]")) {
        const keep = { ...a };
        Ann.del(a); redraw(); notesSheet();
        const u = document.createElement("button");
        u.className = "btn sm rs-undo"; u.textContent = "Undo delete";
        u.onclick = () => { Ann.add(R.it.id, { title: keep.title, note: keep.note, quote: keep.quote, color: keep.color, locator: keep.locator }); redraw(); notesSheet(); };
        s.querySelector(".rs-head")?.insertBefore(u, s.querySelector(".rs-head [data-rs-close]"));
        setTimeout(() => u.remove(), 6000);
        return;
      }
      if (t.closest("[data-rn-go]")) return jumpTo(a);
      const mic = t.closest("[data-rn-mic]");
      if (mic) { const ta = row.querySelector(".rn-note"); return Dictate.press(mic, () => ({ ...Dictate.intoBox(ta), onEnd: () => Ann.edit(a, { note: ta.value }) }), e); }
      if (R.active !== a.id) { R.active = a.id; s.querySelectorAll(".rn").forEach((x) => x.classList.toggle("on", x === row)); redraw(); }
      return;
    }
    const pg = t.closest("[data-toc-page]"); if (pg) { closeSheet(); return R.go(Number(pg.dataset.tocPage)); }
    const hr = t.closest("[data-toc-href]"); if (hr) { closeSheet(); return R.go(hr.dataset.tocHref); }
    const de = t.closest("[data-toc-dest]"); if (de) { closeSheet(); return R.dest(Number(de.dataset.tocDest)); }
    const ta = t.closest("[data-toc-ann]"); if (ta) { const x = anns().find((y) => String(y.id) === ta.dataset.tocAnn); if (x) jumpTo(x); return; }
    const ti = t.closest("[data-toc-item]");
    if (ti) { const x = S.items[ti.dataset.tocItem]; if (!x || x.id === R.it.id) return closeSheet(); if (!onPhone(x)) return toast("Get this episode from your computer first."); return start(x); }
    const md = t.closest("[data-vs-mode]"); if (md) return setMode(R.kind, md.dataset.vsMode);
    const sb = t.closest("[data-vs-sub]");
    if (sb) { pickSub(sb.dataset.vsSub); const tr = (R.tracks.subs || []).find((x) => x.id === sb.dataset.vsSub); setTrackPref(R.it, { subLang: tr ? tr.lang : "off", subLabel: tr ? tr.label : null }); return trackSheet(); }
    const au = t.closest("[data-vs-audio]");
    if (au && R.video && R.video.audioTracks) { const i = Number(au.dataset.vsAudio), at = R.video.currentTime; [...R.video.audioTracks].forEach((x, j) => { x.enabled = j === i; }); R.video.currentTime = at; setTrackPref(R.it, { audioLang: ((R.tracks.audio || [])[i] || {}).lang || null }); return trackSheet(); }
  });
  document.addEventListener("input", (e) => {
    if (!R) return;
    const row = e.target.closest("[data-rn]"), a = row && anns().find((x) => String(x.id) === row.dataset.rn);
    if (a && e.target.matches(".rn-title, .rn-note")) {
      clearTimeout(a._t);
      const f = e.target.matches(".rn-title") ? "title" : "note", v = e.target.value;
      a._t = setTimeout(() => Ann.edit(a, { [f]: v }), 400);
    }
    if (e.target.matches("[data-vs-font]")) {
      S.readFont = Number(e.target.value);
      $("[data-vs-fontv]").textContent = S.readFont + "%";
      R.rend && R.rend.themes.fontSize(S.readFont + "%");
      clearTimeout(R.fontT); R.fontT = setTimeout(() => { saveState(); drawEpubPins(); }, 500);
    }
  });
  document.addEventListener("change", (e) => {
    if (!R) return;
    if (e.target.matches("[data-vs-fitw]")) { $("#rStage").classList.toggle("fitw", e.target.checked); R.refit ? R.refit() : R.go && R.go(R.cur || 1); }
    if (e.target.matches("[data-vs-rtl]")) { change(R.it.id, { direction: e.target.checked ? "rtl" : "ltr" }); saveNow(); const it = R.it; closeSheet(); start(it); }
  });
  document.addEventListener("submit", (e) => {
    if (!R || !e.target.matches("[data-toc-goform]")) return;
    e.preventDefault();
    const n = Number(e.target.querySelector("input").value);
    if (n) { closeSheet(); R.go(n); }
  });

  /* a page-turn button: a page on, or back; a book that scrolls moves a screenful, and on into the next chapter at its end */
  function pageKey(d) {
    if (!R || !$("#rSheet")?.hidden || !$("#rLight")?.hidden) return;      // (not under a sheet)
    const sc = [...document.querySelectorAll("#reader .epub-container, #rStage")].find((e) => e.scrollHeight > e.clientHeight + 4);
    if (sc) {
      const end = d > 0 ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4 : sc.scrollTop <= 2;
      if (!end) { sc.scrollBy({ top: d * sc.clientHeight * 0.88, behavior: S.eink ? "auto" : "smooth" }); return; }
    }
    if (R.step) R.step(d);
  }

  return {
    start, close, saveNow, pageKey,
    // the computer gave a note its own number: carry on showing it as the same note
    renamed(from, to) { if (R && R.active === from) R.active = to; if (R && !$("#rSheet")?.hidden) redraw(); },
    get busy() { return !!(R && (!$("#rSheet")?.hidden || !$("#rLight")?.hidden)); },
    back() {
      if (!R) return false;
      if (!$("#rLight").hidden) { $("#rLight").hidden = true; return true; }
      if (!$("#rSheet").hidden) { closeSheet(); return true; }
      if (R.pinMode) { pinMode(false); return true; }
      close(); return true;
    },
  };
})());
