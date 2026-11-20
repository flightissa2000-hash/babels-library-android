/* The journal on the phone: the same reading/watching log as the computer's Journal (status, finish date, score for
   films, and dated review entries), changed here and sent back on the next sync. */
const Journal = (() => {
  const STATUS = [["reading", "Reading"], ["next", "Up next"], ["finished", "Finished"], ["hold", "On hold"], ["dropped", "Dropped"]];
  // the words for each kind: you read a book, watch a film or a show, play a game
  const DOING = { movie: "Watching", show: "Watching", game: "Playing", other: "In progress" };
  const stList = (kind) => STATUS.map(([k, n]) => [k, k === "reading" ? (kind === undefined ? "In progress" : DOING[kind] || "Reading") : n]);
  const stName = (st, kind) => stList(kind).find((s) => s[0] === st)?.[1];
  const SCORED = (kind) => kind === "movie" || kind === "show";
  const KIND_ICON = { book: "📖", movie: "🎬", show: "📺", game: "🎮", other: "✦", writing: "✍" };
  const KIND_ORDER = ["book", "movie", "show", "game", "other"];
  const KIND_PLURAL = { book: "Books", movie: "Films", show: "Shows", game: "Games", other: "Notes" };
  /* two notebooks, as on the computer: the review journal, and the writing notebook (ideas, drafts, and the quick
     notes put into it). The writing notebook's pages are log rows of kind "writing". */
  /* three pages: Now (what you're in the middle of, with one-tap buttons), Log (everything, with the filters) and
     Write (the writing notebook and quick notes). Now and Log are the review journal; Write is the writing notebook. */
  let PAGE = load("jpage.json", null) || (load("jbook.json", "reviews") === "writing" ? "write" : "now");
  if (!["now", "log", "write"].includes(PAGE)) PAGE = "now";
  const setPage = (p) => { PAGE = p; store("jpage.json", PAGE); };
  const W = () => PAGE === "write";
  let scoring = null;     // (Now) the card whose score chips are open
  let confirming = null, confirmT = 0;     // (Now) the card asking "tap again to confirm"
  const inBook = (l) => (l.kind === "writing") === W();
  const cid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const today = () => new Date().toISOString().slice(0, 10);
  let openId = null;      // the log row on screen
  let openKey = null;     // ...and what else finds it again once a sync gives it the computer's id (its item, title)

  function jop(op) {
    S.jops.push({ ...op, ts: now() });
    saveOps(); saveLibrary(true);
    clearTimeout(jop.t); jop.t = setTimeout(() => sync(), 3000);
  }
  const logById = (id) => S.log.find((l) => String(l.id) === String(id));
  // the open row: by its id, or, when a sync just swapped the phone's temporary row for the computer's, by its item
  function openLog() {
    if (openId == null) return null;
    let l = logById(openId);
    if (!l && openKey) {
      l = (openKey.item_id && S.log.find((x) => x.item_id === openKey.item_id))
        || S.log.find((x) => x.kind === openKey.kind && x.title === openKey.title && !String(x.id).startsWith("c:"));
      if (l) openId = l.id;
    }
    return l || null;
  }
  // after a sync: the computer's ids for rows made here (the open one keeps working)
  function remap(made) {
    if (openId != null && String(openId).startsWith("c:") && made && made[String(openId).slice(2)] != null) openId = made[String(openId).slice(2)];
  }
  const entriesOf = (l) => Object.values(S.journal).filter((j) => String(j.log_id) === String(l.id)).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  const statusOf = (l) => l.status || (l.finished ? "finished" : "");
  const fmtDay = (d) => { if (!d) return ""; const t = new Date(d + "T12:00:00"); return isNaN(t) ? d : t.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };
  // a library item's log row, made here if it doesn't exist yet
  function forItem(it) {
    const k = it.kind === "tv" ? String(it.series || "").toLowerCase() : null;
    let l = S.log.find((x) => x.item_id === it.id) || (k && S.log.find((x) => x.kind === "show" && String(x.title).toLowerCase() === k));
    if (!l) {
      const c = cid();
      l = { id: "c:" + c, item_id: it.id, title: it.kind === "tv" ? it.series || it.title : it.title, kind: it.kind === "movie" ? "movie" : it.kind === "tv" ? "show" : "book", status: "", score: null, finished: null, entries: 0 };
      S.log.push(l);
      jop({ op: "log", item_id: it.id, log_cid: c, fields: {} });
    }
    return l;
  }
  // a change to the row: by its id on the computer, or (still only here) through the item or the phone's id for it
  function setFields(l, fields) {
    Object.assign(l, fields);
    if (fields.finished && !fields.status) l.status = "finished";
    const ref = String(l.id).startsWith("c:") ? (l.item_id ? { item_id: l.item_id, log_cid: String(l.id).slice(2) } : { log_cid: String(l.id).slice(2) }) : { log_id: l.id };
    jop({ op: "log", ...ref, fields });
  }

  // the status picked on an item's own page (tap the one it has to take it off)
  function setStatus(it, k) {
    const l = forItem(it), cur = statusOf(l);
    if (cur === k) return setFields(l, { status: "", ...(k === "finished" ? { finished: null } : {}) });
    setFields(l, { status: k, ...(k === "finished" && !l.finished ? { finished: today() } : {}) });
  }
  const key = (l) => (l.finished ? "1" + l.finished : statusOf(l) === "reading" ? "2" : "0");

  // what the Ticket stubs style draws (the ADMITTED stamp, the punched score, the ticket line); other styles hide them
  const xNo = (t) => { let h = 7; for (const c of String(t || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return String(h % 100000).padStart(5, "0"); };
  function extras(l) {
    const st = statusOf(l), sc = SCORED(l.kind) && l.score != null ? +l.score : null;
    return `<span class="jx jx-stamp" data-st="${st || "none"}"${st === "finished" ? ' data-t="Admitted"' : ""}>${esc(st === "finished" ? "Finished" : stName(st, l.kind) || "")}</span>
      ${sc != null ? `<span class="jx jx-holes">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<i class="${n <= sc ? "on" : ""}"></i>`).join("")}</span>` : ""}
      <span class="jx jx-admit">${esc({ movie: "Admit one", show: "Admit one · series", game: "1 token", book: "Library slip", other: "Note" }[l.kind] || "Slip")} · No. ${xNo(l.title)}</span>`;
  }
  const seg = () => `<div class="seg j-books j-pages">${[["now", "◐ Now"], ["log", "📔 Log"], ["write", "✍ Write"]].map(([k, n]) => `<button data-jpage="${k}" class="${PAGE === k ? "on" : ""}">${n}</button>`).join("")}</div>`;

  /* Now: what you're reading, watching or playing, and what's up next, as big cards with the buttons you use most */
  function nowCard(l) {
    const it = l.item_id && S.items[l.item_id], st = statusOf(l), ents = entriesOf(l), last = ents[ents.length - 1];
    const p = it ? pct(it) : 0, id = esc(l.id);
    const kindName = { book: "Book", movie: "Film", show: "TV show", game: "Game", other: "Note" }[l.kind] || "";
    // the first button says where it stands (Reading, Watching, Up next); tap it and it asks, tap again to confirm
    const asking = confirming === String(l.id);
    const stateBtn = st === "next"
      ? `<button class="btn sm jn-state ${asking ? "ask" : ""}" data-jq="state" data-jid="${id}">${asking ? "▶ Start it? Tap to confirm" : "⏳ Up next"}</button>`
      : `<button class="btn sm jn-state ${asking ? "ask" : ""}" data-jq="state" data-jid="${id}">${asking ? "✓ Finished? Tap to confirm" : `● ${esc(stName("reading", l.kind))}`}</button>`;
    const acts = st === "next"
      ? `${stateBtn}<button class="btn sm" data-jq="drop-next" data-jid="${id}">Not now</button>`
      : `${stateBtn}${SCORED(l.kind) ? `<button class="btn sm" data-jq="score" data-jid="${id}">★ ${l.score != null ? +l.score : "Score"}</button>` : ""}<button class="btn sm" data-jq="hold" data-jid="${id}">⏸ On hold</button>`;
    const lbl = kindName + (st === "reading" ? ` · ${stName("reading", l.kind)}` : st === "next" ? " · Up next" : "");
    return `<div class="jn-card jn-${st} k-${l.kind}" style="--c:${colorFor(l)}">${extras(l)}<button class="jn-cov" data-log="${id}">${logCover(l, it)}</button>
      <div class="jn-t"><small class="jn-k">${esc(lbl)}</small>
        <button class="jn-title" data-log="${id}">${esc(l.title)}</button>
        ${p > 1 && p < 100 ? `<span class="jn-p"><i style="width:${p}%"></i></span><small class="jn-pp">${p}%</small>` : ""}
        ${last ? `<span class="jn-q">“${esc(last.body.slice(0, 90))}${last.body.length > 90 ? "…" : ""}”</span>` : ""}
        <div class="jn-acts">${acts}<button class="btn sm" data-log="${id}" aria-label="Write about it">✎</button></div>
        ${scoring === String(l.id) ? `<div class="jn-score">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button data-jscore="${n}" data-jid="${id}" class="${+l.score === n ? "on" : ""}">${n}</button>`).join("")}${l.score != null ? `<button data-jscore="" data-jid="${id}">✕</button>` : ""}</div>` : ""}</div></div>`;
  }
  function renderNow(v) {
    const mine = S.log.filter((l) => l.kind !== "writing");
    const by = (k) => mine.filter((l) => statusOf(l) === k).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const now = by("reading"), next = by("next");
    const kinds = new Set(now.map((l) => l.kind));
    const tk = S.jstyle === "tickets";
    const head = tk ? "Now showing" : kinds.size === 1 ? `${stName("reading", [...kinds][0])} now` : "In progress";
    const nextHead = tk ? "Coming soon" : "Up next";

    const year = new Date().getFullYear(), done = mine.filter((l) => String(l.finished || "").startsWith(year)).length;
    v.innerHTML = `<div class="jv jn">${seg()}
      ${tk ? `<div class="tk-marquee"><i class="tk-bulbs"></i><b>Babel's Picture House</b><span><em>${now.length}</em> now showing <s>·</s> <em>${next.length}</em> coming soon <s>·</s> <em>${done}</em> seen in ${year}</span><i class="tk-bulbs"></i></div>`
        : `<div class="jn-sum"><span><b>${now.length}</b> in progress</span><span><b>${next.length}</b> up next</span><span><b>${done}</b> finished in ${year}</span></div>`}
      <h3 class="j-month">${esc(head)}</h3>
      ${now.length ? now.map(nowCard).join("") : `<p class="empty">Nothing in progress. Open something in the Library, or ＋ Add below.</p>`}
      ${next.length ? `<h3 class="j-month">${nextHead}</h3>${next.map(nowCard).join("")}` : ""}
      <button class="btn jn-add" id="jNew">＋ Add something to the journal</button>
      <p class="hint jn-tip">Everything else (finished, on hold, dropped) and the filters are on the Log page.</p></div>`;
  }

  function render(v) {
    if (PAGE === "now") return renderNow(v);
    const words = S.jq.toLowerCase().split(/\s+/).filter(Boolean);
    const kinds = KIND_ORDER.filter((k) => S.log.some((l) => inBook(l) && l.kind === k));
    if (!W() && S.jkind !== "all" && !kinds.includes(S.jkind)) S.jkind = "all";
    const rows = S.log.filter((l) => inBook(l) && (W() || ((S.jkind === "all" || l.kind === S.jkind) && (S.jstatus === "all" || statusOf(l) === S.jstatus))) && words.every((w) => String(l.title).toLowerCase().includes(w)))
      // reading now first, then the most recently finished, then the rest (the writing notebook: last written in first)
      .sort((a, b) => (W() ? 0 : key(b).localeCompare(key(a))) || (b.updated_at || 0) - (a.updated_at || 0));
    const year = new Date().getFullYear();
    const done = S.log.filter((l) => String(l.finished || "").startsWith(year));
    let html = "", cur = "";
    for (const l of rows.slice(0, S.limit)) {
      const g = W() ? "Pages" : l.finished ? new Date(l.finished + "T12:00:00").toLocaleDateString([], { month: "long", year: "numeric" }) : statusOf(l) === "reading" ? (S.jkind === "all" ? "In progress" : `${stName("reading", S.jkind)} now`) : "No date";
      if (g !== cur) { html += `${cur ? "</div>" : ""}<h3 class="j-month">${esc(g)}</h3><div class="list">`; cur = g; }
      html += rowHtml(l);
    }
    if (cur) html += "</div>";
    const qn = quick();
    v.innerHTML = `<div class="jv">${seg()}
      ${W() ? `<div class="jw-top"><button class="jw-quick" id="qNote" title="Quick notes: stay on this phone only"><span class="jw-mic">🎙</span><span><b>Quick note</b><small>Hold to say one · tap to see them${qn.length ? ` (${qn.length})` : ""}</small></span></button></div>
        <p class="hint j-wsub">Ideas, drafts, plans, and your quick notes once you put them here. The same notebook as the computer's.</p>` : `<div class="panel j-year"><b>${year}</b><span>${done.filter((l) => l.kind === "book").length} books · ${done.filter((l) => l.kind === "movie").length} films · ${done.filter((l) => l.kind === "show").length} shows finished</span></div>
      ${kinds.length > 1 ? `<div class="chips j-kinds">${[["all", "All types"], ...kinds.map((k) => [k, `${KIND_ICON[k]} ${KIND_PLURAL[k]}`])].map(([k, n]) => `<button data-jkind="${k}" class="${S.jkind === k ? "on" : ""}">${n}</button>`).join("")}</div>` : ""}
      <div class="chips">${[["all", "All"], ...stList(S.jkind === "all" ? undefined : S.jkind)].map(([k, n]) => `<button data-jstatus="${k}" class="${S.jstatus === k ? "on" : ""}">${n}</button>`).join("")}</div>`}
      <div class="searchrow j-tools"><input id="jq" type="search" placeholder="${W() ? "Search your notebook" : "Search your journal"}" value="${esc(S.jq)}">
        <button class="btn" id="jNew">＋ ${W() ? "New page" : "New"}</button></div>
      <div id="jList">${html || `<p class="empty">${S.jq || (!W() && (S.jkind !== "all" || S.jstatus !== "all")) ? "Nothing matches." : W() ? "No pages yet. ＋ New starts one; ✎ Quick notes can be put here too." : "Your journal is empty. Books and films you review on the computer show up here too."}</p>`}
      ${rows.length > S.limit ? `<button class="btn more" id="more">Show more</button>` : ""}</div></div>`;
  }
  // a journal entry's picture: its own cover (chosen in the journal) first, then the library's, then its kind's icon
  function logCover(l, it, style = "") {
    if (l.cover_v && /^\d+$/.test(String(l.id)))
      return `<span class="cov" style="--c:${colorFor(l)};${style}"><img alt="" src="/net/sync/log/${l.id}/cover?v=${l.cover_v}" onerror="this.parentNode.classList.add('nocov');this.remove()"><span class="ph">${esc(l.title)}</span></span>`;
    return it ? cover(it, false) : `<span class="cov j-ico" style="--c:${colorFor(l)};${style}"><span class="ph"${style ? ' style="font-size:2rem"' : ""}>${KIND_ICON[l.kind] || "✦"}</span></span>`;
  }
  // choose a cover: search posters, book covers and game boxes by the title, a picture's web address, or one from the phone
  function coverPicker(l) {
    if (!/^\d+$/.test(String(l.id))) return toast("Sync first: the computer hasn't got this entry yet");
    const w = document.createElement("div");
    w.className = "keep-ask j-cpick";
    w.innerHTML = `<div class="ka-card" role="dialog"><h3>A cover for “${esc(l.title)}”</h3>
      <form class="j-cp-row" data-cps><input name="q" value="${esc(l.title)}" placeholder="search for it…" autocomplete="off"><button class="btn primary">Search</button></form>
      <div class="j-cp-grid"><p class="hint">Looking…</p></div>
      <form class="j-cp-row" data-cpu><input name="u" inputmode="url" placeholder="or paste a picture's web address" autocomplete="off"><button class="btn">Use</button></form>
      <div class="ka-row"><label class="btn">📷 A picture on this phone<input type="file" accept="image/*" hidden></label>
        ${l.cover_v ? `<button class="btn danger" data-cpoff>Take the cover off</button>` : ""}<button class="btn" data-x>Cancel</button></div></div>`;
    const grid = w.querySelector(".j-cp-grid");
    let found = [];
    const search = async (q) => {
      grid.innerHTML = `<p class="hint">Looking…</p>`;
      try { found = await api("GET", `/sync/log/covers?kind=${encodeURIComponent(l.kind)}&q=${encodeURIComponent(q)}`); }
      catch (e) { grid.innerHTML = `<p class="hint">${esc(e.offline ? "Choosing a cover needs the computer." : e.message)}</p>`; return; }
      grid.innerHTML = found.length ? found.map((c, i) => `<button class="j-cp-hit" data-cp="${i}"><img loading="lazy" alt="" src="${esc(c.img)}" onerror="this.closest('button').remove()"><b>${esc(c.title)}</b><small>${esc(c.sub || "")}</small></button>`).join("")
        : `<p class="hint">Nothing found. Try other words, or paste a picture's address.</p>`;
    };
    const choose = async (body) => {
      w.querySelector(".ka-card").classList.add("busy");
      try {
        const r = await api("POST", `/sync/log/${l.id}/cover`, body);
        l.cover_v = r.cover_v;
        saveLibrary(true);
        w.remove();
        toast(body.remove ? "Cover taken off" : "Cover saved");
        open(l.id);
      } catch (e) { w.querySelector(".ka-card").classList.remove("busy"); toast(e.offline ? "Choosing a cover needs the computer" : e.message); }
    };
    w.addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.target.matches("[data-cps]")) search(e.target.q.value.trim());
      else if (e.target.u.value.trim()) choose({ url: e.target.u.value.trim() });
    });
    w.addEventListener("click", (e) => {
      const h = e.target.closest("[data-cp]");
      if (h) return choose({ url: found[Number(h.dataset.cp)].img });
      if (e.target.closest("[data-cpoff]")) return choose({ remove: true });
      if (e.target.closest("[data-x]") || e.target === w) w.remove();
    });
    w.querySelector("input[type=file]").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      // (a phone photo can be large: sent as a JPEG no wider than 1000px)
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => {
        const k = Math.min(1, 1000 / img.width), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        choose({ data: c.toDataURL("image/jpeg", 0.88) });
      };
      img.onerror = () => toast("That picture couldn't be opened");
      img.src = url;
    });
    document.body.append(w);
    search(l.title);
  }

  function rowHtml(l) {
    const it = l.item_id && S.items[l.item_id];
    const ents = entriesOf(l), n = ents.length || l.entries || 0, st = statusOf(l);
    const last = ents[ents.length - 1];
    // the ribbon, the last thing you wrote and the day are always there; each journal style shows what it needs
    return `<button class="row j-row st-${st || "none"} k-${l.kind}" data-log="${esc(l.id)}" style="--c:${colorFor(l)};--h:${74 + (xNo(l.title) % 22)}%">${extras(l)}${logCover(l, it)}
      <span class="t"><b>${esc(l.title)}</b><small>${[st && st !== "finished" ? stName(st, l.kind) : "", l.finished ? fmtDay(l.finished) : "", n ? `${n} ${n === 1 ? "entry" : "entries"}` : ""].filter(Boolean).map(esc).join(" · ")}</small>
        ${last ? `<span class="j-quote">${esc(last.body.slice(0, 140))}${last.body.length > 140 ? "…" : ""}</span>` : ""}</span>
      ${l.kind === "writing" ? "" : `<em class="j-rib">${esc(stName(st, l.kind) || "In journal")}</em>`}
      ${SCORED(l.kind) && l.score != null ? `<span class="badge j-score">${+l.score}</span>` : ""}</button>`;
  }

  function open(id) {
    const l = logById(id);
    if (!l) return;
    openId = l.id;
    openKey = { item_id: l.item_id, kind: l.kind, title: l.title };
    const it = l.item_id && S.items[l.item_id];
    const st = statusOf(l);
    const ents = entriesOf(l);
    const sh = $("#sheet");
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(l.title)}</h2></div>
      <div class="it-body" style="padding-top:14px">
        <div class="j-head">${it && !l.cover_v ? `<button class="card" data-item="${it.id}" style="width:96px">${cover(it, false)}</button>` : `<button class="card" data-jcover style="width:96px">${logCover(l, it, "width:96px")}</button>`}
          <div><h3>${esc(l.title)}</h3><p class="hint">${esc({ book: "Book", movie: "Film", show: "TV show", game: "Game", other: "Other", writing: "Writing notebook" }[l.kind] || "")}${it ? " · in your library" : ""}</p>
            <button class="btn sm" data-jcover>🖼 ${l.cover_v || it?.has_cover ? "Change the cover" : "Add a cover"}</button></div></div>
        ${l.kind === "writing" ? "" : `<div class="chips j-status">${stList(l.kind).map(([k, n]) => `<button data-jset="${k}" class="${st === k ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="j-fields">
          <label class="field"><span>Finished on</span><input type="date" id="jFin" value="${esc(l.finished || "")}"></label>
          ${SCORED(l.kind) ? `<label class="field"><span>My score (out of 10)</span><input type="number" id="jScore" min="0" max="10" step="0.5" value="${l.score ?? ""}" placeholder="–"></label>` : ""}
        </div>`}
        <h3 style="margin:16px 0 6px">${l.kind === "writing" ? "Entries" : "Review"}</h3>
        ${ents.map((e) => `<div class="note j-entry" data-entry="${esc(e.id)}"><small class="hint">${new Date((e.created_at || 0) * 1000).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</small>
          <div class="j-body">${esc(e.body)}</div><div class="btns" style="margin:6px 0 0"><button class="btn sm" data-jedit="${esc(e.id)}">Edit</button><button class="btn sm danger" data-jdel="${esc(e.id)}">Delete</button></div></div>`).join("") || `<p class="hint">No entries yet.</p>`}
        <textarea id="jText" rows="5" placeholder="${l.kind === "writing" ? "Write… (adds a dated entry)" : "What did you think? (adds a dated entry)"}"></textarea>
        <div class="btns"><button class="btn mic" data-dict-for="#jText" aria-label="Dictate (hold to talk, or tap)">🎙</button><button class="btn primary" id="jAdd">Add entry</button>${!["movie", "writing"].includes(l.kind) && st !== "finished" ? `<button class="btn" id="jDone">Finished it today</button>` : ""}</div>
      </div>`;
    sh.hidden = false;
    sh.scrollTop = 0;
  }
  /* Quick notes: dated scraps for the moment (a page number, a name, a time). They live only on this phone, in their
     own file, until "Put them in the writing notebook" makes them dated entries on its "Quick notes" page (synced). */
  const quick = () => load("quicknotes.json", []);
  const saveQuick = (list) => store("quicknotes.json", list);
  function openQuick(quiet) {
    openId = null;
    const list = quick();
    const sh = $("#sheet");
    let html = "", cur = "";
    for (const n of [...list].reverse()) {          // newest first, grouped by day
      const d = new Date(n.at * 1000).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
      if (d !== cur) { html += `<h3 class="j-month">${esc(d)}</h3>`; cur = d; }
      html += `<div class="note j-entry qn-entry"><small class="hint">${new Date(n.at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
        <div class="j-body">${esc(n.body)}</div><div class="btns" style="margin:6px 0 0"><button class="btn sm mic" data-qdict="${esc(n.id)}" aria-label="Keep dictating into this note">🎙 Keep dictating</button><button class="btn sm" data-qedit="${esc(n.id)}">Edit</button><button class="btn sm danger" data-qdel="${esc(n.id)}">Delete</button></div></div>`;
    }
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>Quick notes</h2></div>
      <div class="it-body" style="padding-top:14px">
        <p class="hint">For things you need now. They stay on this phone until you put them in the writing notebook (then they're on the computer too). Hold ✎ Quick (or 🎙) to say a note instead.</p>
        <textarea id="qText" rows="4" placeholder="Jot it down…"></textarea>
        <div class="btns"><button class="btn primary" id="qAdd">Add note</button>${list.length ? `<button class="btn" id="qCollect">📓 Put them in the writing notebook</button><button class="btn danger" id="qClear">Clear all quick notes</button>` : ""}</div>
        ${html || `<p class="empty">No quick notes.</p>`}
      </div>
      <button class="mic qn-fab" data-dict-for="#qText" aria-label="Dictate: hold to talk, or tap to start and stop">🎙</button>`;
    sh.hidden = false;
    sh.scrollTop = 0;
    if (!quiet) setTimeout(() => $("#qText")?.focus(), 80);
  }

  /* dictation (dictate.js): what a 🎙 button speaks into */
  function micTarget(mic) {
    if (mic.dataset.qdict) {                    // "keep dictating": more words at the end of that quick note
      const id = mic.dataset.qdict, n = quick().find((x) => x.id === id), body = mic.closest(".qn-entry")?.querySelector(".j-body");
      if (!n || !body) return null;
      const base = n.body;
      body.classList.add("live");
      return {
        capFirst: /[.!?]$/.test(base.trim()),
        onText: (t) => { body.textContent = base + " " + t; },
        onEnd: (t) => {
          const list = quick(), x = list.find((y) => y.id === id);
          if (x && t) { x.body = base + " " + t; saveQuick(list); }
          openQuick(true);
        },
      };
    }
    const sel = mic.dataset.dictFor;
    const ta = sel === "near" ? mic.closest(".j-entry")?.querySelector("textarea") : $(sel);
    if (!ta) return null;
    const box = Dictate.intoBox(ta);
    // the big Quick notes microphone: said into an empty box, it's saved as a note straight away (one hand, no reaching)
    if (mic.classList.contains("qn-fab") && !ta.value.trim())
      box.onEnd = (t) => { if (t) { saveQuick([...quick(), { id: cid(), body: t, at: now() }]); toast("Quick note saved"); openQuick(true); window.render(); } };
    return box;
  }
  /* hold ✎ Quick: Quick notes open and listen until you let go; what you said becomes a new quick note */
  let skipQuickClick = false;
  function holdQuick(btn) {
    let timer = setTimeout(() => {
      timer = 0;
      skipQuickClick = true;
      openQuick(true);
      Dictate.begin({
        btn, hold: true,
        onText: (t) => { const ta = $("#qText"); if (ta) ta.value = t; },
        onEnd: (t) => {
          if (t) { saveQuick([...quick(), { id: cid(), body: t, at: now() }]); toast("Quick note saved"); }
          if (!$("#sheet").hidden && $("#qText")) openQuick(true);
          window.render();                       // (the count on the button)
        },
      });
    }, 400);
    const up = () => {
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      if (timer) { clearTimeout(timer); return; }        // just a tap: the click opens Quick notes as usual
      Dictate.end();
    };
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
  }
  document.addEventListener("pointerdown", (e) => {
    const mic = e.target.closest?.("[data-dict-for], [data-qdict]");
    if (mic) { e.preventDefault(); return Dictate.press(mic, () => micTarget(mic)); }
    const q = e.target.closest?.("#qNote");
    if (q) { e.preventDefault(); holdQuick(q); }
  });

  function newLog() {
    const sh = $("#sheet");
    if (W()) {
      sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>A new page</h2></div>
        <div class="it-body" style="padding-top:14px">
          <label class="field"><span>What's it about?</span><input id="nTitle" placeholder="An idea, a plan, a draft, a trip…"></label>
          <button class="btn primary" id="nMake" data-writing>Add the page</button></div>`;
      sh.hidden = false;
      return setTimeout(() => $("#nTitle")?.focus(), 80);
    }
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>New journal entry</h2></div>
      <div class="it-body" style="padding-top:14px">
        <label class="field"><span>Title</span><input id="nTitle" placeholder="A book, film, show or game"></label>
        <label class="field"><span>What is it?</span><select id="nKind"><option value="book">Book</option><option value="movie">Film</option><option value="show">TV show</option><option value="game">Game</option><option value="other">✦ A note (not media)</option></select></label>
        <div class="chips" id="nStatus">${stList("book").map(([k, n]) => `<button data-nstatus="${k}" class="${k === "reading" ? "on" : ""}">${n}</button>`).join("")}</div>
        <button class="btn primary" id="nMake">Add to journal</button></div>`;
    sh.hidden = false;
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (Dictate.active && t.closest("#jAdd, #qAdd, [data-jsave], [data-jcancel], [data-qsave], [data-close]")) Dictate.end();     // done with that box
    const js = t.closest("[data-jstatus]"); if (js) { S.jstatus = js.dataset.jstatus; S.limit = 60; return window.render(); }
    const jk = t.closest("[data-jkind]"); if (jk) { S.jkind = jk.dataset.jkind; S.limit = 60; return window.render(); }
    const jp = t.closest("[data-jpage]"); if (jp) { setPage(jp.dataset.jpage); scoring = null; S.jq = ""; S.limit = 60; $("#view").scrollTop = 0; return window.render(); }
    // (Now) the one-tap buttons on a card
    const qa = t.closest("[data-jq]");
    if (qa) {
      const l = logById(qa.dataset.jid); if (!l) return;
      const a = qa.dataset.jq;
      if (a === "state") {
        if (confirming !== String(l.id)) {       // first tap: ask (it forgets after a few seconds)
          confirming = String(l.id); clearTimeout(confirmT);
          confirmT = setTimeout(() => { confirming = null; if (S.tab === "journal" && PAGE === "now") window.render(); }, 6000);
          return window.render();
        }
        confirming = null; clearTimeout(confirmT);
        if (statusOf(l) === "next") { setFields(l, { status: "reading" }); toast(`${l.title}: ${stName("reading", l.kind).toLowerCase()}`); }
        else { setFields(l, { status: "finished", finished: l.finished || today() }); toast(`✓ ${l.title}: finished`); }
        return window.render();
      }
      confirming = null;
      if (a === "done") { setFields(l, { status: "finished", finished: l.finished || today() }); toast(`✓ ${l.title}: finished`); }
      else if (a === "hold") { setFields(l, { status: "hold" }); toast(`${l.title}: on hold`); }
      else if (a === "start") { setFields(l, { status: "reading" }); toast(`${l.title}: ${stName("reading", l.kind).toLowerCase()}`); }
      else if (a === "drop-next") { setFields(l, { status: "" }); toast(`${l.title}: off Up next`); }
      else if (a === "score") { scoring = scoring === String(l.id) ? null : String(l.id); }
      return window.render();
    }
    const sc = t.closest("[data-jscore]");
    if (sc) { const l = logById(sc.dataset.jid); if (l) { setFields(l, { score: sc.dataset.jscore === "" ? null : Number(sc.dataset.jscore) }); scoring = null; toast(sc.dataset.jscore ? `★ ${sc.dataset.jscore} for ${l.title}` : "Score taken off"); } return window.render(); }
    if (t.closest("#qCollect")) {          // the quick notes become dated entries on the writing notebook's "Quick notes" page
      const list = quick();
      if (!list.length) return;
      let l = S.log.find((x) => x.kind === "writing" && x.title === "Quick notes");
      if (!l) {
        const c = cid(), fields = { title: "Quick notes", kind: "writing", status: "" };
        l = { id: "c:" + c, ...fields, score: null, finished: null, entries: 0, updated_at: now() };
        S.log.push(l);
        jop({ op: "log_new", cid: c, fields });
      }
      const ref = String(l.id).startsWith("c:") ? { log_cid: String(l.id).slice(2) } : { log_id: l.id };
      for (const n of list) {
        const c = cid();
        S.journal["c:" + c] = { id: "c:" + c, log_id: l.id, body: n.body, created_at: n.at, updated_at: now() };
        jop({ op: "entry_add", cid: c, ...ref, body: n.body, created_at: n.at });
      }
      l.updated_at = now();
      saveQuick([]);
      toast(`${list.length} quick ${list.length === 1 ? "note" : "notes"} put in the writing notebook`);
      setPage("write");
      return open(l.id);
    }
    const lg = t.closest("[data-log]"); if (lg) return open(lg.dataset.log);
    if (t.closest("[data-jcover]") && openId != null) { const l = openLog(); if (l) coverPicker(l); return; }
    if (t.closest("#jNew")) return newLog();
    if (t.closest("#qNote")) { if (skipQuickClick) { skipQuickClick = false; return; } return openQuick(); }
    if (t.closest("#qAdd")) {
      const body = $("#qText").value.trim();
      if (!body) return toast("Write something first.");
      saveQuick([...quick(), { id: cid(), body, at: now() }]);
      return openQuick();
    }
    const qd = t.closest("[data-qdel]");
    if (qd) { saveQuick(quick().filter((n) => n.id !== qd.dataset.qdel)); return openQuick(); }
    // Edit: the note becomes a text box (with 🎙 to dictate into it), Save or Cancel
    const qe = t.closest("[data-qedit]");
    if (qe) {
      const n = quick().find((x) => x.id === qe.dataset.qedit), box = qe.closest(".qn-entry");
      if (!n || !box) return;
      box.querySelector(".j-body").outerHTML = `<textarea rows="${Math.min(10, n.body.split("\n").length + 3)}" class="j-editbox">${esc(n.body)}</textarea>`;
      box.querySelector(".btns").innerHTML = `<button class="btn sm mic" data-dict-for="near" aria-label="Dictate (hold to talk, or tap)">🎙</button><button class="btn primary sm" data-qsave="${esc(n.id)}">Save</button><button class="btn sm" data-qcancel>Cancel</button>`;
      const ta = box.querySelector("textarea");
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      return;
    }
    const qs = t.closest("[data-qsave]");
    if (qs) {
      const body = qs.closest(".qn-entry").querySelector("textarea").value.trim();
      if (!body) return toast("An empty note: use Delete instead.");
      const list = quick(), n = list.find((x) => x.id === qs.dataset.qsave);
      if (n) { n.body = body; saveQuick(list); toast("Quick note saved"); }
      return openQuick(true);
    }
    if (t.closest("[data-qcancel]")) { if (Dictate.active) Dictate.end(); return openQuick(true); }
    if (t.closest("#qClear")) {
      if (confirm("Clear all quick notes? Your journal entries aren't touched.")) { saveQuick([]); toast("Quick notes cleared"); openQuick(); }
      return;
    }
    const ns = t.closest("[data-nstatus]"); if (ns) { $$("[data-nstatus]").forEach((b) => b.classList.toggle("on", b === ns)); return; }
    if (t.closest("#nMake")) {
      const title = $("#nTitle").value.trim();
      if (!title) return toast("Give it a title.");
      const kind = t.closest("#nMake").hasAttribute("data-writing") ? "writing" : $("#nKind").value;
      const other = kind === "other" || kind === "writing";        // a note about anything: no reading status
      const c = cid(), status = other ? "" : $("[data-nstatus].on")?.dataset.nstatus || "reading";
      const fields = { title, kind, status, finished: status === "finished" ? today() : null };
      S.log.push({ id: "c:" + c, ...fields, score: null, entries: 0, updated_at: now() });
      jop({ op: "log_new", cid: c, fields });
      return open("c:" + c);
    }
    const l = openLog();
    if (!l || $("#sheet").hidden) return;
    const set = t.closest("[data-jset]");
    if (set) { const k = set.dataset.jset; setFields(l, { status: k, ...(k === "finished" && !l.finished ? { finished: today() } : {}) }); return open(l.id); }
    if (t.closest("#jDone")) { setFields(l, { status: "finished", finished: today() }); return open(l.id); }
    if (t.closest("#jAdd")) {
      const body = $("#jText").value.trim();
      if (!body) return toast("Write something first.");
      const c = cid();
      S.journal["c:" + c] = { id: "c:" + c, log_id: l.id, body, created_at: now(), updated_at: now() };
      const ref = String(l.id).startsWith("c:") ? { log_cid: String(l.id).slice(2), item_id: l.item_id } : { log_id: l.id };
      jop({ op: "entry_add", cid: c, ...ref, body, created_at: now() });
      return open(l.id);
    }
    const ed = t.closest("[data-jedit]");
    if (ed) {
      const en = S.journal[ed.dataset.jedit];
      const box = ed.closest(".j-entry");
      box.innerHTML = `<textarea rows="6" class="j-editbox">${esc(en.body)}</textarea><div class="btns"><button class="btn sm mic" data-dict-for="near" aria-label="Dictate (hold to talk, or tap)">🎙</button><button class="btn primary sm" data-jsave="${esc(en.id)}">Save</button><button class="btn sm" data-jcancel>Cancel</button></div>`;
      return;
    }
    if (t.closest("[data-jcancel]")) return open(l.id);
    const sv = t.closest("[data-jsave]");
    if (sv) {
      const en = S.journal[sv.dataset.jsave], body = sv.closest(".j-entry").querySelector("textarea").value.trim();
      if (!body) return toast("An empty entry: use Delete instead.");
      en.body = body; en.updated_at = now();
      if (String(en.id).startsWith("c:")) { const op = S.jops.find((o) => o.cid === String(en.id).slice(2)); if (op) op.body = body; saveOps(); }
      else jop({ op: "entry_edit", id: en.id, body });
      return open(l.id);
    }
    const del = t.closest("[data-jdel]");
    if (del && confirm("Delete this entry? (On the computer too.)")) {
      const id = del.dataset.jdel;
      delete S.journal[id];
      if (String(id).startsWith("c:")) { S.jops = S.jops.filter((o) => o.cid !== id.slice(2)); saveOps(); saveLibrary(true); }
      else jop({ op: "entry_del", id: Number(id) });
      return open(l.id);
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "nKind") { const s = $("#nStatus"); if (s) { s.hidden = e.target.value === "other"; const rd = s.querySelector("[data-nstatus=reading]"); if (rd) rd.textContent = stName("reading", e.target.value); } return; }
    const l = openLog();
    if (!l) return;
    if (e.target.id === "jFin") setFields(l, { finished: e.target.value || null, ...(e.target.value ? { status: "finished" } : {}) });
    if (e.target.id === "jScore") setFields(l, { score: e.target.value === "" ? null : Math.max(0, Math.min(10, Number(e.target.value))) });
  });
  document.addEventListener("input", (e) => {
    // typing a search: only the list below changes. The box itself is never replaced (a phone keyboard partway
    // through a word loses it when its box is swapped for a new one)
    if (e.target.id === "jq") {
      S.jq = e.target.value; clearTimeout(render.t);
      render.t = setTimeout(() => { const box = document.createElement("div"); render(box); const l = $("#jList"), n = box.querySelector("#jList"); if (l && n) l.replaceWith(n); }, 250);
    }
  });

  return { render, open, forItem, remap, setStatus, statusOf, STATUS, quick: openQuick, isOpen: () => openId != null && !$("#sheet").hidden, close: () => { openId = null; openKey = null; } };
})();
