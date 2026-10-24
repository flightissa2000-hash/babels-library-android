/* The journal on the phone: the same reading/watching log as the computer's Journal (status, finish date, score for
   films, and dated review entries), changed here and sent back on the next sync. */
const Journal = (() => {
  const STATUS = [["reading", "Reading"], ["finished", "Finished"], ["hold", "On hold"], ["dropped", "Dropped"]];
  const KIND_ICON = { book: "📖", movie: "🎬", show: "📺", game: "🎮", other: "✦" };
  const cid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const today = () => new Date().toISOString().slice(0, 10);
  let openId = null;      // the log row on screen

  function jop(op) {
    S.jops.push({ ...op, ts: now() });
    saveOps(); saveLibrary(true);
    clearTimeout(jop.t); jop.t = setTimeout(() => sync(), 3000);
  }
  const logById = (id) => S.log.find((l) => String(l.id) === String(id));
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

  const key = (l) => (l.finished ? "1" + l.finished : statusOf(l) === "reading" ? "2" : "0");

  function render(v) {
    const words = S.jq.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = S.log.filter((l) => (S.jstatus === "all" || statusOf(l) === S.jstatus) && words.every((w) => String(l.title).toLowerCase().includes(w)))
      // reading now first, then the most recently finished, then the rest
      .sort((a, b) => key(b).localeCompare(key(a)) || (b.updated_at || 0) - (a.updated_at || 0));
    const year = new Date().getFullYear();
    const done = S.log.filter((l) => String(l.finished || "").startsWith(year));
    let html = "", cur = "";
    for (const l of rows.slice(0, S.limit)) {
      const g = l.finished ? new Date(l.finished + "T12:00:00").toLocaleDateString([], { month: "long", year: "numeric" }) : statusOf(l) === "reading" ? "Reading now" : "No date";
      if (g !== cur) { html += `${cur ? "</div>" : ""}<h3 class="j-month">${esc(g)}</h3><div class="list">`; cur = g; }
      html += rowHtml(l);
    }
    if (cur) html += "</div>";
    const qn = quick();
    v.innerHTML = `<div class="jv"><div class="panel j-year"><b>${year}</b><span>${done.filter((l) => l.kind === "book").length} books · ${done.filter((l) => l.kind === "movie").length} films · ${done.filter((l) => l.kind === "show").length} shows finished</span></div>
      <div class="chips">${[["all", "All"], ...STATUS].map(([k, n]) => `<button data-jstatus="${k}" class="${S.jstatus === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="searchrow j-tools"><input id="jq" type="search" placeholder="Search your journal" value="${esc(S.jq)}">
        <button class="btn qn-btn" id="qNote" title="Quick notes: stay on this phone only">✎ Quick${qn.length ? ` <i>${qn.length}</i>` : ""}</button><button class="btn" id="jNew">＋ New</button></div>
      ${html || `<p class="empty">${S.jq ? "Nothing matches." : "Your journal is empty. Books and films you review on the computer show up here too."}</p>`}
      ${rows.length > S.limit ? `<button class="btn more" id="more">Show more</button>` : ""}</div>`;
  }
  function rowHtml(l) {
    const it = l.item_id && S.items[l.item_id];
    const ents = entriesOf(l), n = ents.length || l.entries || 0, st = statusOf(l);
    const last = ents[ents.length - 1];
    // the ribbon, the last thing you wrote and the day are always there; each journal style shows what it needs
    return `<button class="row j-row st-${st || "none"}" data-log="${esc(l.id)}">${it ? cover(it, false) : `<span class="cov j-ico" style="--c:${colorFor(l)}"><span class="ph">${KIND_ICON[l.kind] || "✦"}</span></span>`}
      <span class="t"><b>${esc(l.title)}</b><small>${[st && st !== "finished" ? STATUS.find((s) => s[0] === st)?.[1] : "", l.finished ? fmtDay(l.finished) : "", n ? `${n} ${n === 1 ? "entry" : "entries"}` : ""].filter(Boolean).map(esc).join(" · ")}</small>
        ${last ? `<span class="j-quote">${esc(last.body.slice(0, 140))}${last.body.length > 140 ? "…" : ""}</span>` : ""}</span>
      <em class="j-rib">${esc(STATUS.find((s) => s[0] === st)?.[1] || "In journal")}</em>
      ${l.kind === "movie" && l.score != null ? `<span class="badge j-score">${+l.score}</span>` : ""}</button>`;
  }

  function open(id) {
    const l = logById(id);
    if (!l) return;
    openId = l.id;
    const it = l.item_id && S.items[l.item_id];
    const st = statusOf(l);
    const ents = entriesOf(l);
    const sh = $("#sheet");
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(l.title)}</h2></div>
      <div class="it-body" style="padding-top:14px">
        <div class="j-head">${it ? `<button class="card" data-item="${it.id}" style="width:96px">${cover(it, false)}</button>` : `<span class="cov j-ico" style="--c:${colorFor(l)};width:96px"><span class="ph" style="font-size:2rem">${KIND_ICON[l.kind] || "✦"}</span></span>`}
          <div><h3>${esc(l.title)}</h3><p class="hint">${esc({ book: "Book", movie: "Film", show: "TV show", game: "Game", other: "Other" }[l.kind] || "")}${it ? " · in your library" : ""}</p></div></div>
        <div class="chips j-status">${STATUS.map(([k, n]) => `<button data-jset="${k}" class="${st === k ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="j-fields">
          <label class="field"><span>Finished on</span><input type="date" id="jFin" value="${esc(l.finished || "")}"></label>
          ${l.kind === "movie" ? `<label class="field"><span>My score (out of 10)</span><input type="number" id="jScore" min="0" max="10" step="0.5" value="${l.score ?? ""}" placeholder="–"></label>` : ""}
        </div>
        <h3 style="margin:16px 0 6px">Review</h3>
        ${ents.map((e) => `<div class="note j-entry" data-entry="${esc(e.id)}"><small class="hint">${new Date((e.created_at || 0) * 1000).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</small>
          <div class="j-body">${esc(e.body)}</div><div class="btns" style="margin:6px 0 0"><button class="btn sm" data-jedit="${esc(e.id)}">Edit</button><button class="btn sm danger" data-jdel="${esc(e.id)}">Delete</button></div></div>`).join("") || `<p class="hint">No entries yet.</p>`}
        <textarea id="jText" rows="5" placeholder="What did you think? (adds a dated entry)"></textarea>
        <div class="btns"><button class="btn mic" data-dict-for="#jText" aria-label="Dictate (hold to talk, or tap)">🎙</button><button class="btn primary" id="jAdd">Add entry</button>${l.kind !== "movie" && st !== "finished" ? `<button class="btn" id="jDone">Finished it today</button>` : ""}</div>
      </div>`;
    sh.hidden = false;
    sh.scrollTop = 0;
  }
  /* Quick notes: dated scraps for the moment (a page number, a name, a time). They live only on this phone, in their
     own file: never synced, never in the computer's journal, and "Clear all" clears only them. */
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
        <p class="hint">For things you need now but not later. They stay on this phone only and aren't sent to your computer. Hold ✎ Quick (or 🎙) to say a note instead.</p>
        <textarea id="qText" rows="4" placeholder="Jot it down…"></textarea>
        <div class="btns"><button class="btn primary" id="qAdd">Add note</button>${list.length ? `<button class="btn danger" id="qClear">Clear all quick notes</button>` : ""}</div>
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
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>New journal entry</h2></div>
      <div class="it-body" style="padding-top:14px">
        <label class="field"><span>Title</span><input id="nTitle" placeholder="A book, film, show or game"></label>
        <label class="field"><span>What is it?</span><select id="nKind"><option value="book">Book</option><option value="movie">Film</option><option value="show">TV show</option><option value="game">Game</option><option value="other">✦ A note (not media)</option></select></label>
        <div class="chips" id="nStatus">${STATUS.map(([k, n]) => `<button data-nstatus="${k}" class="${k === "reading" ? "on" : ""}">${n}</button>`).join("")}</div>
        <button class="btn primary" id="nMake">Add to journal</button></div>`;
    sh.hidden = false;
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (Dictate.active && t.closest("#jAdd, #qAdd, [data-jsave], [data-jcancel], [data-qsave], [data-close]")) Dictate.end();     // done with that box
    const js = t.closest("[data-jstatus]"); if (js) { S.jstatus = js.dataset.jstatus; S.limit = 60; return window.render(); }
    const lg = t.closest("[data-log]"); if (lg) return open(lg.dataset.log);
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
      const other = $("#nKind").value === "other";        // a note about anything: no reading status
      const c = cid(), status = other ? "" : $("[data-nstatus].on")?.dataset.nstatus || "reading";
      const fields = { title, kind: $("#nKind").value, status, finished: status === "finished" ? today() : null };
      S.log.push({ id: "c:" + c, ...fields, score: null, entries: 0, updated_at: now() });
      jop({ op: "log_new", cid: c, fields });
      return open("c:" + c);
    }
    const l = openId != null && logById(openId);
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
    if (e.target.id === "nKind") { const s = $("#nStatus"); if (s) s.hidden = e.target.value === "other"; return; }
    const l = openId != null && logById(openId);
    if (!l) return;
    if (e.target.id === "jFin") setFields(l, { finished: e.target.value || null, ...(e.target.value ? { status: "finished" } : {}) });
    if (e.target.id === "jScore") setFields(l, { score: e.target.value === "" ? null : Math.max(0, Math.min(10, Number(e.target.value))) });
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "jq") { S.jq = e.target.value; clearTimeout(render.t); render.t = setTimeout(() => { const pos = e.target.selectionStart; window.render(); const q = $("#jq"); q.focus(); q.setSelectionRange(pos, pos); }, 250); }
  });

  return { render, open, forItem, isOpen: () => openId != null && !$("#sheet").hidden, close: () => { openId = null; } };
})();
