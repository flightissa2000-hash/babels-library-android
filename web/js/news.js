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

  /* ---- the Physics desk: open-access papers, letters and reviews from the field's most-cited journals, newest first
     (from OpenAlex, the open catalogue of research; no account or key). Impact = OpenAlex's two-year mean citations
     per paper, close to a journal's impact factor. Nature, Science and their open siblings: only their physics. */
  const JOURNALS = [
    ["0034-6861", "Reviews of Modern Physics", "Rev. Mod. Phys.", 60.2, "review"], ["1749-4885", "Nature Photonics", "Nat. Photon.", 27.4],
    ["2160-3308", "Physical Review X", "PRX", 21.6], ["2047-7538", "Light: Science & Applications", "Light Sci. Appl.", 20.2],
    ["0370-1573", "Physics Reports", "Phys. Rep.", 19.5, "review"], ["2691-3399", "PRX Quantum", "PRX Quantum", 18.7],
    ["0034-4885", "Reports on Progress in Physics", "Rep. Prog. Phys.", 16.8, "review"], ["2056-6387", "npj Quantum Information", "npj Quantum Inf.", 13.5],
    ["1745-2473", "Nature Physics", "Nat. Phys.", 12.7], ["0031-9007", "Physical Review Letters", "PRL", 12.0, "letter"],
    ["2334-2536", "Optica", "Optica", 10.9], ["2521-327X", "Quantum", "Quantum", 10.6], ["2399-3650", "Communications Physics", "Commun. Phys.", 7.0],
    ["2470-0010", "Physical Review D", "PRD", 6.9], ["1029-8479", "Journal of High Energy Physics", "JHEP", 6.3],
    ["0370-2693", "Physics Letters B", "Phys. Lett. B", 5.8, "letter"], ["1434-6044", "The European Physical Journal C", "EPJ C", 5.8],
    ["2643-1564", "Physical Review Research", "PR Research", 5.2], ["2469-9950", "Physical Review B", "PRB", 4.5],
    ["2469-9926", "Physical Review A", "PRA", 3.7], ["1367-2630", "New Journal of Physics", "New J. Phys.", 3.6],
  ];
  const BROAD = [["0036-8075", "Science", "Science", 22.3], ["0028-0836", "Nature", "Nature", 21.5], ["2041-1723", "Nature Communications", "Nat. Commun.", 20.7], ["2375-2548", "Science Advances", "Sci. Adv.", 16.6]];
  const JBY = {};
  for (const j of [...JOURNALS, ...BROAD]) JBY[j[0]] = j;
  // (by ISSN: the catalogue spells some names oddly, "Physical review. B")
  const jOf = (w) => { const src = w.primary_location?.source || {}; for (const i of [src.issn_l, ...(src.issn || [])]) if (i && JBY[i]) return JBY[i]; return null; };
  const PHYS_KEEP = "physics.json";
  /* what the desk focuses on: All physics, or a topic you set: a whole field ("Condensed Matter Physics"), one of the
     catalogue's research topics ("Theoretical and Computational Physics"), or papers that mention some words
     ("chiral spin"). Kept on the phone: physics-focus.json {list:[{key,label,kind,id,term}], cur} */
  const PHF = () => { const f = load("physics-focus.json", null) || {}; return { list: Array.isArray(f.list) ? f.list : [], cur: f.cur || "all" }; };
  const savePHF = (f) => store("physics-focus.json", f);
  const focusOf = (f = PHF()) => f.list.find((x) => x.key === f.cur) || null;
  // titles and abstracts can carry the journal's maths markup ("$${\rm Co}_3$$", "<sub>"): shown as plain text
  const tex = (t) => String(t || "").replace(/<[^>]+>/g, "").replace(/\$+/g, "").replace(/\\(mathrm|rm|text|mathit|it|bf|mathbf|left|right)\s*/g, "").replace(/\\([a-zA-Z]+)/g, "$1").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  const focusFilter = (fc) => !fc ? "" : fc.kind === "subfield" ? `,primary_topic.subfield.id:${fc.id}` : fc.kind === "topic" ? `,topics.id:${fc.id}`
    : `,title_and_abstract.search:${encodeURIComponent(String(fc.term).replace(/[,|:]/g, " ").trim())}`;
  async function physicsFetch(fc) {
    const days = fc ? 120 : 45;          // (a topic has fewer papers: it looks further back)
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const sel = "id,doi,title,type,publication_date,primary_location,primary_topic,best_oa_location,authorships,abstract_inverted_index";
    const q = (issns, extra, n, from = since) => `https://api.openalex.org/works?filter=primary_location.source.issn:${issns.join("|")},is_oa:true,from_publication_date:${from},type:article|review|letter${extra}&sort=publication_date:desc&per_page=${n}&select=${sel}`;
    const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`The paper catalogue answered ${r.status}`); return (await r.json()).results || []; };
    const isTop = (j) => j[3] >= 10 && !j[4], isRev = (j) => j[4] === "review";
    const halfYear = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const all = [...JOURNALS, ...BROAD].map((j) => j[0]);
    const fx = focusFilter(fc);
    // in groups, so the busiest journals (PRB, PRA…) don't crowd out the others, and reviews (which come slowly) are
    // looked for over half a year; Nature, Science and their siblings: only their physics
    const groups = await Promise.all(fc ? [
      get(q(JOURNALS.map((j) => j[0]), fx, 150)),
      get(q(BROAD.map((j) => j[0]), fx + ",primary_topic.field.id:31", 60)),
    ] : [
      get(q(JOURNALS.filter(isTop).map((j) => j[0]), "", 100)),
      get(q(JOURNALS.filter((j) => !isTop(j) && !isRev(j)).map((j) => j[0]), "", 80)),
      get(q(BROAD.map((j) => j[0]), ",primary_topic.field.id:31", 60)),
      get(q(JOURNALS.filter(isRev).map((j) => j[0]), "", 30, halfYear)),
    ]);
    const reviews = await get(`https://api.openalex.org/works?filter=primary_location.source.issn:${all.join("|")},is_oa:true,from_publication_date:${halfYear},type:review${fx}&sort=publication_date:desc&per_page=30&select=${sel}`).catch(() => []);
    const seen = new Set(), out = [];
    for (const w of [...groups.flat(), ...reviews]) {
      const j = jOf(w);
      if (!j || !w.title || seen.has(w.id)) continue;
      seen.add(w.id);
      // the abstract comes as word → positions; put it back in order
      let abs = "";
      if (w.abstract_inverted_index) { const words = []; for (const [k, ps] of Object.entries(w.abstract_inverted_index)) for (const i of ps) words[i] = k; abs = words.filter(Boolean).join(" "); }
      const oa = w.best_oa_location || {};
      const kind = j[4] === "review" || w.type === "review" ? "review" : j[4] === "letter" || w.type === "letter" ? "letter" : "paper";
      const sf = w.primary_topic?.subfield || {};
      out.push({ id: w.id, title: tex(w.title), kind, journal: j[1], short: j[2], impact: j[3], date: w.publication_date,
        field: sf.display_name || "Other physics", fieldId: String(sf.id || "").split("/").pop(), topic: w.primary_topic?.display_name || "",
        authors: (w.authorships || []).map((x) => x.author?.display_name).filter(Boolean), abstract: tex(abs).slice(0, 4000),
        link: oa.landing_page_url || w.doi || "", pdf: oa.pdf_url || "", doi: w.doi || "" });
    }
    return { at: Date.now(), days, items: out };
  }
  const phAgo = (d) => { const t = new Date(d + "T12:00:00"), days = Math.round((Date.now() - t) / 86400000); return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 31 ? `${days} days ago` : t.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const phCard = (x) => {
    const i = shown.push({ paper: x }) - 1;
    const who = x.authors.length ? x.authors[0].split(" ").slice(-1)[0] + (x.authors.length > 1 ? " et al." : "") : "";
    return `<button class="nz-card noimg ph-card k-${x.kind}" data-nz-open="${i}"><span class="nz-kind ph-j">${esc(x.short)}${x.kind !== "paper" ? ` · ${x.kind === "review" ? "Review" : "Letter"}` : ""}</span><b>${esc(x.title)}</b><small>${esc([who, phAgo(x.date)].filter(Boolean).join(" · "))}</small></button>`;
  };
  async function renderPhysics(v, fill) {
    const f = PHF(), fc = focusOf(f), key = fc ? fc.key : "all";
    if (!N.physBy) N.physBy = load(PHYS_KEEP, null) || {};
    if (N.physBy.items) N.physBy = {};          // (the first version kept one list)
    const have = N.physBy[key];
    const stale = !have || N.fresh || Date.now() - (have.at || 0) > 3 * 3600000 || (have.items.length && !have.items[0].field);   // (an older copy, before fields)
    if (stale && N.physBusy !== key) {
      N.physBusy = key; N.physErr = "";
      physicsFetch(fc).then((d) => { N.physBy[key] = d; const keep = {}; for (const k of ["all", ...f.list.map((x) => x.key)]) if (N.physBy[k]) keep[k] = N.physBy[k]; store(PHYS_KEEP, keep); })
        .catch((e) => { N.physErr = e.message; })
        .finally(() => { N.physBusy = null; N.fresh = false; if (S.tab === "news" && N.desk === "physics" && $("#sheet").hidden && (PHF().cur || "all") === (fc ? fc.key : "all")) render(v); });
    }
    // 🔍 in the corner: type words and the desk searches for papers that mention them (✕ goes back to all of physics)
    const chips = N.phSearching ? `<form class="ph-search" id="phSearch"><input id="phQ" type="search" placeholder="Search physics papers: chiral spin, graphene…" value="${esc(fc && fc.kind === "keyword" ? fc.term : "")}" autocomplete="off" enterkeyhint="search"><button class="btn sm primary">Search</button><button class="btn sm" type="button" data-ph-cancel aria-label="Close the search">✕</button></form>` : "";
    const tools = `<button class="btn sm ph-glass" data-ph-search type="button" aria-label="Search papers">🔍</button><button class="btn sm" data-nz-refresh aria-label="Fetch again">↻</button>`;
    if (N.phSearching) setTimeout(() => { const q = $("#phQ"); if (q && document.activeElement !== q) q.focus(); }, 60);
    if (!have) return fill(chips + `<div class="nz-where"><span>${fc ? `Searching for <b>${esc(fc.kind === "keyword" ? "“" + fc.term + "”" : fc.label)}</b>…` : "&nbsp;"}</span>${fc ? `<button class="btn sm" data-ph-clear aria-label="Back to all of physics">✕</button>` : ""}${tools}</div>` + (N.physErr ? note(`Couldn't reach the paper catalogue (${esc(N.physErr)}). <button class="btn sm" data-nz-refresh>Try again</button>`) : note(fc ? `Looking for open-access papers on ${esc(fc.label)}…` : "Collecting the latest open-access physics…")));
    shown = [];
    const bar = `<div class="nz-where"><span>${fc ? `${fc.kind === "keyword" ? "Papers mentioning " : ""}<b>${esc(fc.kind === "keyword" ? "“" + fc.term + "”" : fc.label)}</b>, last ${have.days || 45} days` : `Open access from <b>${JOURNALS.length + BROAD.length} leading journals</b>, last ${have.days || 45} days, newest first`}</span>${fc ? `<button class="btn sm" data-ph-clear aria-label="Back to all of physics">✕</button>` : ""}${tools}</div>`;
    // a row for each field, the fields with the most new papers first; newest first in each (tap a field's name to focus on it)
    const by = new Map();
    for (const x of have.items) { const g = by.get(x.field) || { id: x.fieldId, items: [] }; g.items.push(x); by.set(x.field, g); }
    const rows = [...by].sort((a, b) => b[1].items.length - a[1].items.length).map(([name, g]) => {
      const allIn = g.items.sort((a, b) => (b.date || "").localeCompare(a.date || "")), items = allIn.slice(0, fc ? 80 : 30);
      const rv = allIn.filter((x) => x.kind === "review").length, lt = allIn.filter((x) => x.kind === "letter").length;
      const sub = [`${allIn.length} paper${allIn.length === 1 ? "" : "s"}${allIn.length > items.length ? ` (newest ${items.length} here)` : ""}`, rv ? `${rv} review${rv === 1 ? "" : "s"}` : "", lt ? `${lt} letter${lt === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
      const canFocus = g.id && !(fc && fc.kind === "subfield" && fc.id === g.id);
      return `<section class="nz-row r-ph-field"><h2>${canFocus ? `<button class="ph-fh" data-ph-field="${esc(g.id)}" data-ph-name="${esc(name)}">` : "<span>"}<small>${esc(sub)}</small>${esc(name)}${canFocus ? ` <i>focus ›</i></button>` : "</span>"}</h2><div class="nz-strip">${items.map(phCard).join("")}</div></section>`;
    }).join("");
    fill(chips + bar + rows + (have.items.length ? "" : note(fc && fc.kind === "keyword" ? `No open-access papers mention “${esc(fc.term)}” lately. Try other words (🔍).` : "Nothing here lately.")) + `<p class="hint ph-src">From OpenAlex, the open catalogue of research: ${JOURNALS.length + BROAD.length} well-cited physics journals (and the physics in Nature, Science and their open siblings). Every paper here is free to read.</p>`);
  }
  function readPaper(x) {
    const sh = $("#sheet");
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(x.short)}</h2></div>
      <div class="it-body nz-read ph-read"><p class="nz-kick">${esc(x.journal)} · ${esc({ review: "Review", letter: "Letter", paper: "Research paper" }[x.kind])} · ${esc(new Date(x.date + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }))}</p>
        <h1>${esc(x.title)}</h1>
        ${x.authors.length ? `<p class="nz-rby">${esc(x.authors.slice(0, 8).join(", "))}${x.authors.length > 8 ? ` and ${x.authors.length - 8} more` : ""}</p>` : ""}
        <div class="btns nz-rbtns">${x.link ? `<button class="btn sm primary" data-go-url="${esc(x.link)}">Read it (free) ↗</button>` : ""}${x.pdf && x.pdf !== x.link ? `<button class="btn sm" data-go-url="${esc(x.pdf)}">PDF ↗</button>` : ""}${x.doi && x.doi !== x.link ? `<button class="btn sm" data-go-url="${esc(x.doi)}">Journal page ↗</button>` : ""}</div>
        <h3>Abstract</h3><div class="nz-text">${x.abstract ? `<p>${esc(x.abstract)}</p>` : `<p class="hint">The catalogue has no abstract for this one: “Read it” opens the paper.</p>`}</div>
        <p class="hint">Impact of ${esc(x.journal)}: ${x.impact} citations per recent paper.</p></div>`;
    sh.hidden = false; sh.scrollTop = 0;
  }

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
    // dressed like the catalogue (it shares the Newsstand tab with it): the masthead's last word swaps the two
    const flip = window.__pressFlip; window.__pressFlip = false;
    const head = `<div class="ct-head nz-head"><header class="ct-mast">
        <div class="ct-issue"><span>${esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</span><span>Delivered daily · free</span></div>
        <h1><small>Babel's</small> Daily <button class="ct-swap${flip ? " flip" : ""}" data-press="catalogue" type="button" aria-label="Gazette. Tap for the catalogue">Gazette</button></h1>
        <div class="ct-strap">★ All the news that fits ★ Tap Gazette for the catalogue ★</div></header>
      <nav class="ct-views">${[["science", "Science desk", "#8fc7d9", "Desk A"], ["local", "Local desk", "#f08a6b", "Desk B"], ["physics", "Physics papers", "#b9a3e8", "Desk C"]].map(([k, n, c, d]) => `<button data-nz-desk="${k}" class="${N.desk === k ? "on" : ""}" style="--tab:${c}"><i>${d}</i><b>${n}</b></button>`).join("")}</nav></div>`;
    const fill = (html) => { if (id === N.seq && S.tab === "news") v.innerHTML = head + html; };
    if (N.desk === "physics") return renderPhysics(v, fill);
    if (N.desk === "science") {
      if (!N.sci && !N.fresh && Online.recall("/sync/news/science")) { N.sci = Online.recall("/sync/news/science"); N.sciAt = 0; }
      if (N.sci && !N.fresh && (!N.sciAt || (N.sciAt > 1 && Date.now() - N.sciAt > 900000))) { N.sciAt = 1; api("GET", "/sync/news/science").then((d) => { const was = JSON.stringify(N.sci); N.sci = d; N.sciAt = Date.now(); if (JSON.stringify(d) !== was && S.tab === "news" && N.desk === "science" && $("#sheet").hidden) render(v); }).catch(() => { N.sciAt = 0; }); }
      if (!N.sci) { fill(note("The presses are rolling…")); try { N.sci = await api("GET", "/sync/news/science" + (N.fresh ? "?fresh=1" : "")); N.fresh = false; N.sciAt = Date.now(); } catch (e) { return fill(note(esc(e.message))); } }
      shown = [];
      fill(`<div class="nz-where"><span>The <b>Science desk</b></span><button class="btn sm" data-nz-refresh>↻</button></div>` + N.sci.sections.map((s) => row(s.key, s.label, "", s.items)).join(""));
      return;
    }
    if (!N.loc && !N.fresh && !N.moved && Online.recall("/sync/news/local")) { N.loc = Online.recall("/sync/news/local"); N.locAt = 0; }
    if (N.loc && !N.fresh && (!N.locAt || (N.locAt > 1 && Date.now() - N.locAt > 900000))) { N.locAt = 1; api("GET", "/sync/news/local").then((d) => { const was = JSON.stringify(N.loc); N.loc = d; N.locAt = Date.now(); if (JSON.stringify(d) !== was && S.tab === "news" && N.desk === "local" && $("#sheet").hidden && !N.editing) render(v); }).catch(() => { N.locAt = 0; }); }
    if (!N.loc) { fill(note("Calling the newsroom…")); try { N.loc = await api("GET", "/sync/news/local" + (N.fresh ? "?fresh=1" : "")); N.fresh = false; N.moved = false; N.locAt = Date.now(); } catch (e) { return fill(note(esc(e.message))); } }
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
    const pr = t.closest("[data-press]"); if (pr) { window.__pressFlip = true; return setTab(pr.dataset.press); }      // (the Newsstand: News ⇄ catalogue)
    const d = t.closest("[data-nz-desk]"); if (d) { N.desk = d.dataset.nzDesk; N.editing = false; return render($("#view")); }
    const o = t.closest("[data-nz-open]"); if (o) { const it = shown[Number(o.dataset.nzOpen)]; return it && it.paper ? readPaper(it.paper) : read(it); }
    // the Physics desk's topics: pick one, add one (looked up, then picked), take one off
    const fh = t.closest("[data-ph-field]");
    if (fh) { const f = PHF(), key = "s:" + fh.dataset.phField; if (!f.list.some((y) => y.key === key)) f.list.push({ key, label: fh.dataset.phName, kind: "subfield", id: fh.dataset.phField, term: "" }); f.cur = key; savePHF(f); $("#view").scrollTop = 0; return render($("#view")); }
    if (t.closest("[data-ph-search]")) { N.phSearching = !N.phSearching; return render($("#view")); }
    if (t.closest("[data-ph-cancel]")) { N.phSearching = false; return render($("#view")); }
    if (t.closest("[data-ph-clear]")) { const f = PHF(); f.cur = "all"; savePHF(f); N.phSearching = false; return render($("#view")); }
    if (t.closest("[data-nz-edit]")) { N.editing = true; return render($("#view")); }
    if (t.closest("[data-nz-cancel]")) { N.editing = false; return render($("#view")); }
    // ↻: this desk's stories fetched again (not the half-hour-old copies)
    if (t.closest("[data-nz-refresh]")) { if (N.desk === "science") N.sci = null; else if (N.desk === "physics") { N.physErr = ""; N.physBusy = null; } else N.loc = null; N.fresh = true; return render($("#view")); }
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
    if (e.target.id === "phSearch") {
      e.preventDefault();
      const term = $("#phQ").value.trim();
      if (!term) return;
      const f = PHF(), key = "k:" + term.toLowerCase();
      f.list = [{ key, label: term, kind: "keyword", id: "", term }, ...f.list.filter((y) => y.key !== key && y.kind === "keyword")].slice(0, 8);
      f.cur = key; savePHF(f); N.phSearching = false; N.physErr = "";
      return render($("#view"));
    }
    if (e.target.id !== "nzPlace") return;
    e.preventDefault();
    const f = e.target, b = f.querySelector(".btn.primary");
    b.disabled = true; b.textContent = "Finding your county…";
    try {
      await api("POST", "/sync/news/place", { county: f.county.value, state: f.state.value, city: f.city.value, country: f.country.value });
      N.editing = false; N.loc = null; N.locAt = 0; N.moved = true; render($("#view"));
    } catch (err) { b.disabled = false; b.textContent = "Start delivery"; toast(err.message); }
  });
  return { render, read };
})();
