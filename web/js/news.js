/* The News on the phone: the computer's Babel Gazette, passed through the computer. Each desk is a stack of rows you
   swipe sideways (Science by subject; Local: things to do first, then county, city, state, country). A story opens in a
   reader here; ⤓ Keep has the computer file it in the library as an article. */
const NewsTab = (() => {
  const N = { desk: "science", sci: null, loc: null, editing: false, seq: 0 };
  const KIND = { vote: "Vote", ordinance: "Ordinance", meeting: "Meeting", election: "Election", budget: "Budget", event: "Event" };
  const LEVEL = { events: "Out & about", county: "County", city: "City", state: "State", country: "Country" };
  const ago = (t) => { if (!t) return ""; const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.round(s / 60)) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : s < 172800 ? "yesterday" : Math.round(s / 86400) + " days ago"; };
  const note = (t) => `<p class="empty">${t}</p>`;
  let shown = [];

  const card = (s) => {
    const i = shown.push(s) - 1;
    return `<button class="nz-card ${s.image ? "" : "noimg"}" data-nz-open="${i}">${s.image ? `<span class="nz-pic"><img loading="lazy" alt="" src="${esc(s.image)}" onerror="this.parentElement.remove()"></span>` : ""}
      ${s.kind ? `<span class="nz-kind k-${s.kind}">${KIND[s.kind] || s.kind}</span>` : ""}<b>${esc(s.title)}</b><small>${esc(s.source)}${s.date ? " · " + ago(s.date) : ""}</small></button>`;
  };
  const row = (key, label, sub, items) => `<section class="nz-row r-${key}"><h2>${sub ? `<small>${esc(sub)}</small>` : ""}${esc(label)}</h2>
      ${items.length ? `<div class="nz-strip">${items.map(card).join("")}</div>` : note("Nothing here right now.")}</section>`;

  async function render(v) {
    const id = ++N.seq;
    shown = [];
    const head = `<div class="nz-mast"><b>The Babel Gazette</b><small>${esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</small>
      <div class="nz-desks"><button data-nz-desk="science" class="${N.desk === "science" ? "on" : ""}">Science</button><button data-nz-desk="local" class="${N.desk === "local" ? "on" : ""}">Local</button></div></div>`;
    if (!S.conn.token) { v.innerHTML = head + note("Pair with your computer first (Settings)."); return; }
    const fill = (html) => { if (id === N.seq && S.tab === "news") v.innerHTML = head + html; };
    if (N.desk === "science") {
      if (!N.sci) { fill(note("The presses are rolling…")); try { N.sci = await api("GET", "/sync/news/science" + (N.fresh ? "?fresh=1" : "")); N.fresh = false; } catch (e) { return fill(note(esc(e.message))); } }
      shown = [];
      fill(`<div class="nz-where"><span>The <b>Science desk</b></span><button class="btn sm" data-nz-refresh>↻</button></div>` + N.sci.sections.map((s) => row(s.key, s.label, "", s.items)).join(""));
      return;
    }
    if (!N.loc) { fill(note("Calling the newsroom…")); try { N.loc = await api("GET", "/sync/news/local" + (N.fresh ? "?fresh=1" : "")); N.fresh = false; } catch (e) { return fill(note(esc(e.message))); } }
    const p = N.loc.place;
    if (!p.county || N.editing) {
      fill(`<form class="panel nz-place" id="nzPlace"><h3>Where's home?</h3><p class="hint">Your county and state: you'll get things to do around town, the county board, the city council, the statehouse and the national news.</p>
        <label class="field"><span>County</span><input name="county" value="${esc(p.county)}" placeholder="Pinellas County" required></label>
        <label class="field"><span>State</span><input name="state" value="${esc(p.state)}" placeholder="Florida"></label>
        <label class="field"><span>City (optional: the county seat otherwise)</span><input name="city" value="${esc(p.city)}" placeholder="${esc(p.seat || "St. Petersburg")}"></label>
        <label class="field"><span>Country</span><input name="country" value="${esc(p.country || "United States")}"></label>
        <div class="btns"><button class="btn primary">Start delivery</button>${p.county ? `<button type="button" class="btn" data-nz-cancel>Cancel</button>` : ""}</div></form>`);
      return;
    }
    shown = [];
    fill(`<div class="nz-where"><span>Covering <b>${esc([p.county, p.city || p.seat, p.state].filter(Boolean).join(" · "))}</b></span><button class="btn sm" data-nz-edit>Change</button><button class="btn sm" data-nz-refresh>↻</button></div>`
      + N.loc.sections.map((s) => row(s.key, s.label, LEVEL[s.key], s.items)).join(""));
  }

  /* reading a story here, in the sheet */
  async function read(s) {
    const sh = $("#sheet");
    const bar = (u) => `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(s.source)}</h2></div>
      <div class="btns nz-rbtns"><button class="btn sm" data-nz-keep="${esc(u)}">⤓ Keep</button><button class="btn sm" data-go-url="${esc(u)}">Open the original ↗</button></div>`;
    sh.innerHTML = bar(s.link) + `<div class="it-body nz-read"><h1>${esc(s.title)}</h1>${note("Setting the type…")}</div>`;
    sh.hidden = false; sh.scrollTop = 0;
    try {
      const a = await api("GET", "/sync/news/article?" + new URLSearchParams({ url: s.link }));
      if (sh.hidden) return;
      const text = a.blocks.map((b) => b.t === "h2" || b.t === "h3" ? `<h3>${esc(b.x)}</h3>` : b.t === "blockquote" ? `<blockquote>${esc(b.x)}</blockquote>` : `<p>${esc(b.x)}</p>`).join("");
      const short = a.blocks.reduce((n, b) => n + b.x.length, 0) < 900;
      sh.innerHTML = bar(a.url) + `<div class="it-body nz-read"><p class="nz-kick">${esc(a.site || s.source)}${s.date ? " · " + ago(s.date) : ""}</p><h1>${esc(a.title || s.title)}</h1>
        ${a.dek ? `<p class="nz-dek">${esc(a.dek)}</p>` : ""}${a.by ? `<p class="nz-rby">By ${esc(a.by)}</p>` : ""}
        ${a.image ? `<img class="nz-hero" alt="" src="${esc(a.image)}" onerror="this.remove()">` : ""}<div class="nz-text">${text}</div>
        ${short ? `<p class="nz-more">${a.blocks.length ? "That's all the site lets through here." : "This site doesn't let its stories be read outside its pages."} <button class="btn sm" data-go-url="${esc(a.url)}">Read it there ↗</button></p>` : ""}</div>`;
    } catch (e) {
      const b = sh.querySelector(".nz-read"); if (b) b.insertAdjacentHTML("beforeend", `<p class="nz-more">Couldn't fetch the story (${esc(e.message)}). <button class="btn sm" data-go-url="${esc(s.link)}">Read it there ↗</button></p>`);
    }
  }

  document.addEventListener("click", async (e) => {
    const t = e.target;
    const d = t.closest("[data-nz-desk]"); if (d) { N.desk = d.dataset.nzDesk; N.editing = false; return render($("#view")); }
    const o = t.closest("[data-nz-open]"); if (o) return read(shown[Number(o.dataset.nzOpen)]);
    if (t.closest("[data-nz-edit]")) { N.editing = true; return render($("#view")); }
    if (t.closest("[data-nz-cancel]")) { N.editing = false; return render($("#view")); }
    // ↻: this desk's stories fetched again (not the half-hour-old copies)
    if (t.closest("[data-nz-refresh]")) { if (N.desk === "science") N.sci = null; else N.loc = null; N.fresh = true; return render($("#view")); }
    const k = t.closest("[data-nz-keep]");
    if (k) {
      const days = await askKeep("Keep this story?", "Save it in your library for good, or for 30 days (you'll be asked before it's removed).", [["For good", 0], ["For 30 days", 30]]);
      if (days == null) return;
      k.disabled = true; k.textContent = "Saving…";
      try { await api("POST", "/sync/news/save", { url: k.dataset.nzKeep, days: days || null }); k.textContent = "✓ Kept"; toast("Saving to your library: it'll be under Articles after the next sync"); }
      catch (err) { k.disabled = false; k.textContent = "⤓ Keep"; toast(err.message); }
    }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "nzPlace") return;
    e.preventDefault();
    const f = e.target, b = f.querySelector(".btn.primary");
    b.disabled = true; b.textContent = "Finding your county…";
    try {
      await api("POST", "/sync/news/place", { county: f.county.value, state: f.state.value, city: f.city.value, country: f.country.value });
      N.editing = false; N.loc = null; render($("#view"));
    } catch (err) { b.disabled = false; b.textContent = "Start delivery"; toast(err.message); }
  });
  return { render };
})();
