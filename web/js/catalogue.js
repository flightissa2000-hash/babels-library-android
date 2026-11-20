/* The catalogue on the phone: the computer's Discover, laid out the same way (a mail-order catalogue: tap the red word
   in the masthead, "Big BOOK Catalogue", for the next department; Dept. A to E plus your shopping list), passed
   through the computer (it does the looking up and keeps the covers). */
const Catalogue = (() => {
  const C = { cat: "book", view: "new", q: "", subject: "", subjects: {}, results: null, who: "", seq: 0 };
  // the departments, as on the computer: tap the word in the masthead for the next one
  const DEPTS = [["book", "Book", "books"], ["manga", "Manga", "manga"], ["comic", "Comic", "comics"], ["movie", "Movie", "films"], ["tv", "TV", "shows"], ["animation", "Animation", "animation"]];
  const VIEWS = [["new", "Hot off the press", "#f08a6b"], ["browse", "Browse the stacks", "#8fc7d9"], ["search", "Search", "#9fd18b"],
    ["series", "Complete the set", "#f2b06b"], ["authors", "More by your authors", "#b9a3e8"], ["wish", "My shopping list", "#f2d27a"]];
  const dept = () => DEPTS.find((d) => d[0] === C.cat) || DEPTS[0];
  const views = () => C.cat === "book" ? VIEWS : VIEWS.filter(([k]) => ["new", "browse", "search", "wish"].includes(k));
  const itemNo = (t) => { let h = 7; for (const c of String(t || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `${(h % 9000) + 1000}-${String.fromCharCode(65 + (h % 26))}`; };
  const thisYear = new Date().getFullYear();
  let flip = false;      // (the word turns over when it changes)
  function nextCat() {
    C.cat = DEPTS[(DEPTS.findIndex((d) => d[0] === C.cat) + 1) % DEPTS.length][0];
    C.results = null;
    if (!views().some(([k]) => k === C.view)) C.view = "new";
    flip = true;
    render($("#view"));
  }

  const pathOf = (path, params) => `/sync/cat/${path}?${new URLSearchParams({ cat: C.cat, ...params })}`;
  const get = (path, params) => api("GET", pathOf(path, params));
  // what came last time (kept on the phone), shown at once while the fresh copy is fetched
  const kept = (path, params) => (typeof Online !== "undefined" && Online.recall(pathOf(path, params))) || null;
  const fresh = {};        // path → when it was last fetched this session (fetched again only after 10 minutes)
  const coverSrc = (r) => "/catcover?" + new URLSearchParams({ u: /^https:\/\//.test(r.cover || "") ? r.cover : "", isbn: r.isbn || "", t: r.title || "", a: (r.authors || [])[0] || "" });
  const wished = () => Object.values(S.items).filter((i) => i.wanted && !i.has_file);
  let shown = [];       // the cards on screen, for opening one

  // a catalogue entry, like the computer's: the cover (stamped if it's yours or wanted, a NEW! burst if it's from this
  // year or last), its item number, and a price-tag button for your shopping list
  function card(r) {
    let i = shown.indexOf(r); if (i < 0) { shown.push(r); i = shown.length - 1; }
    const isNew = r.year && +r.year >= thisYear - 1;
    const tag = r.have === "owned" ? `<span class="ct-tag got">In your library</span>` : r.have === "wanted" ? `<span class="ct-tag got">✓ On your list</span>` : `<button class="ct-tag" data-ct-want="${i}">＋ Add to list</button>`;
    return `<div class="ct-card ${r.have ? "have-" + r.have : ""}">${r.have === "owned" ? "" : `<button class="ct-x" data-ct-ignore="${i}" aria-label="Not for me: don't show it again">✕</button>`}${r.why ? `<div class="ct-why">${esc(r.why)}</div>` : ""}
      <button class="ct-cov" data-ct-info="${i}"><img loading="lazy" alt="" src="${esc(coverSrc(r))}" onerror="this.remove()"><span>${esc((r.title || "?").slice(0, 40))}</span>
        ${isNew ? `<i class="ct-new">New!</i>` : ""}${r.have === "owned" ? `<i class="ct-stamp">On your shelf</i>` : r.have === "wanted" ? `<i class="ct-stamp want">Wanted</i>` : ""}</button>
      <span class="ct-no">No. ${itemNo(r.title)}${r.index != null ? ` · ${r.cat === "manga" || r.cat === "comic" ? "Vol." : "Book"} ${+r.index}` : ""}${r.rating ? ` · ★ ${(+r.rating).toFixed(1)}` : ""}</span>
      <b>${esc(r.title)}</b><small>${esc([(r.authors || [])[0], r.year].filter(Boolean).join(" · ")) || "&nbsp;"}</small>${r.series ? `<small class="ct-ser">${esc(r.series)}${r.index != null ? " #" + +r.index : ""}</small>` : ""}
      <span class="ct-foot">${tag}<button class="ct-peek" data-ct-info="${i}">More info →</button></span></div>`;
  }
  const grid = (list) => { shown = []; return `<div class="ct-grid">${list.map(card).join("")}</div>`; };
  // Hot off the press, in the computer's parts: sequels, your authors, bestsellers…
  function promoGrid(list) {
    shown = [];
    const parts = [["sequel", "Sequels just out"], ["author", "New from your authors"], ["nyt", "New York Times bestsellers"], ["hardcover", "Readers' favourites this season"], ["new", "Everything new this season"]];
    const known = new Set(parts.map((p) => p[0]));
    let html = parts.map(([k, h]) => { const l = list.filter((x) => x.kind_promo === k); return l.length ? `<h2 class="ct-h2"><span>${h}</span></h2><div class="ct-grid">${l.map(card).join("")}</div>` : ""; }).join("");
    const rest = list.filter((x) => !known.has(x.kind_promo));
    if (rest.length) html += `${html ? `<h2 class="ct-h2"><span>More</span></h2>` : ""}<div class="ct-grid">${rest.map(card).join("")}</div>`;
    return html;
  }
  // (Complete the set, More by your authors) a section for each series or author, with its own grid
  const sections = (list) => { shown = []; return list.map(([h, sub, items]) => `<section class="ct-sec"><div class="ct-sech"><b>${esc(h)}</b><small>${esc(sub)}</small></div><div class="ct-grid">${items.map(card).join("")}</div></section>`).join(""); };
  const note = (t) => `<p class="empty ct-none">${t}</p>`;

  function render(v) {
    const [, word, noun] = dept(), nextNoun = DEPTS[(DEPTS.findIndex((d) => d[0] === C.cat) + 1) % DEPTS.length][2];
    const season = ["Winter", "Spring", "Summer", "Fall"][Math.floor(new Date().getMonth() / 3)];
    const head = `<div class="ct-head"><header class="ct-mast">
        <div class="ct-issue"><span>${season} ${thisYear} edition</span><span>Mail-order ${esc(noun)} · browse free</span></div>
        <h1><small>Babel's</small> Big <button class="ct-word${flip ? " flip" : ""}" data-ct-next type="button" aria-label="Showing ${esc(noun)}. Tap for ${esc(nextNoun)}">${esc(word)}</button> <button class="ct-swap" data-press="news" type="button" aria-label="Catalogue. Tap for the News">Catalogue</button></h1>
        <div class="ct-strap">★ Tap ${esc(word)} for ${esc(nextNoun)} ★ Tap Catalogue for the News ★</div></header>
      <nav class="ct-views">${views().map(([k, n, col], i) => `<button data-ct-view="${k}" class="${C.view === k || (C.view === "who" && k === "authors") ? "on" : ""}" style="--tab:${col}"><i>${k === "wish" ? "Yours" : `Dept. ${"ABCDE"[i]}`}</i><b>${n}</b>${k === "wish" && wished().length ? `<span class="ct-count">${wished().length}</span>` : ""}</button>`).join("")}</nav></div>`;
    flip = false;
    if (window.__pressFlip) { window.__pressFlip = false; requestAnimationFrame(() => { const w = document.querySelector(".ct-swap"); if (w) w.classList.add("flip"); }); }
    // (the open department's tab scrolled into sight: the row is wider than the phone)
    requestAnimationFrame(() => { const o = document.querySelector(".ct-views .on"); if (o) o.parentElement.scrollLeft = Math.max(0, o.offsetLeft - 30); });
    const id = ++C.seq;
    const fill = (html) => { if (id === C.seq && S.tab === "catalogue") { const b = $("#ctBody"); if (b) b.innerHTML = html; } };
    if (C.view === "search") {
      const hint = { animation: "an anime, a cartoon…", book: "a title, an author, an ISBN…", manga: "a manga, manhwa or manhua…", comic: "a comic or graphic novel…", movie: "a film…", tv: "a TV series…" }[C.cat];
      const where = { animation: "AniList's anime and Wikipedia's animated series and films", book: "the world's book catalogues", manga: "AniList's catalogue of manga, manhwa and manhua", comic: "Wikipedia's comics", movie: "Wikipedia's films", tv: "Wikipedia's TV series" }[C.cat];
      v.innerHTML = head + `<form class="ct-order" id="ctSearch"><label><span>Order form · I'm looking for</span><input id="ctQ" type="search" placeholder="${esc(hint)}" value="${esc(C.q)}" autocomplete="off"></label><button>Find it ⟶</button></form>
        <div id="ctBody">${C.results ? (C.results.length ? grid(C.results) : note("Nothing in the catalogue by that name. Try fewer words.")) : note(`Search ${where}. Anything you fancy goes on your shopping list, here and on the computer.`)}</div>`;
      return;
    }
    if (C.view === "wish") {
      const w = wished();
      const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      v.innerHTML = head + `<div id="ctBody"><div class="ct-pad"><div class="ct-pad-top"><b>Shopping list</b><span>${esc(today)}</span></div>
        ${w.length ? `<ol>${w.map((i) => `<li><button data-item="${i.id}"><b>${esc(i.title)}</b><small>${esc(byline(i))}</small></button></li>`).join("")}</ol><div class="ct-pad-total">${w.length} to get</div>`
          : `<p class="ct-pad-empty">Nothing on the list yet!<br><small>Browse the departments and tap “＋ Add to list”.</small></p>`}</div>
        <p class="ct-lead">Wanted things sit on your shelves with a WANTED stamp. When you add the real one, it takes the wanted one's place.</p></div>`;
      return;
    }
    if (C.view === "who") {
      v.innerHTML = head + `<div class="ct-promo"><b>Everything by ${esc(C.who)}</b><span>All we could find. The ones on your shelves are stamped; add the rest to your list.</span></div><div id="ctBody">${note("Looking through the catalogues…")}</div>`;
      get("byauthor", { name: C.who }).then((r) => fill(r.items.length ? grid(r.items) : note(`Nothing more by ${esc(C.who)} in the catalogues we can reach.`))).catch((e) => fill(note(esc(e.message))));
      return;
    }
    if (C.view === "series" || C.view === "authors") {
      const ser = C.view === "series";
      v.innerHTML = head + `<p class="ct-lead">${ser ? "Complete the set! The books missing from each series on your shelves. Series you already have in full aren't shown." : "If you liked them, you'll like these. More from the authors you read most."}</p><div id="ctBody">${note("Looking through the catalogues…")}</div>`;
      const paintList = (r) => ser
        ? sections((r.items || []).map((g) => [g.series, `${(g.authors || []).join(", ")}${(g.have || []).length ? ` · you own no. ${g.have.map((x) => +x).join(", ")}` : ""}`, g.missing || []]))
          + (r.items && r.items.length ? "" : r.pending ? note("Fetching…") : note(r.complete ? "You have every book of every series we know about!" : "No series on your shelves yet."))
        : sections((r.items || []).map((a) => [a.author, `${a.books.length} more ${a.books.length === 1 ? "book" : "books"}`, a.books]))
          + (r.items && r.items.length ? "" : r.pending ? note("Fetching…") : note("Nothing more found by your authors yet."));
      const view = C.view;
      const go = async (n = 0) => {
        try {
          const r = await api("GET", `/sync/cat/${view}`);
          if (id !== C.seq) return;
          fill(paintList(r) + (r.pending && r.items && r.items.length ? note("More arriving…") : ""));
          if (r.pending && n < 12) setTimeout(() => go(n + 1), 3500);
        } catch (e) { fill(note(esc(e.message))); }
      };
      go();
      return;
    }
    if (C.view === "browse") {
      const subs = C.subjects[C.cat];
      v.innerHTML = head + `<p class="ct-lead">Something completely different. Wander the aisles; ${esc(noun)} already on your shelves are left out.</p>
        <div class="ct-aisles" id="ctAisles">${subs ? subs.map((x, n) => `<button data-ct-sub="${esc(x.key)}" class="${x.key === C.subject ? "on" : ""}"><i>Aisle ${n + 1}</i>${esc(x.label)}</button>`).join("") : ""}</div>
        ${subs ? `<div class="ct-restock"><span>This aisle restocks itself weekly</span><button class="btn sm" data-ct-restock>↻ Refresh</button></div>` : ""}<div id="ctBody">${note("Stocking the shelves…")}</div>`;
      if (!subs && kept("subjects", {})) C.subjects[C.cat] = kept("subjects", {});
      if (!subs && C.subjects[C.cat]) { render(v); get("subjects", {}).then((s) => { C.subjects[C.cat] = s; }).catch(() => {}); return; }
      if (!subs) {
        get("subjects", {}).then((s) => { C.subjects[C.cat] = s; if (!s.some((x) => x.key === C.subject)) C.subject = s[0]?.key || "trending"; if (id === C.seq) render(v); }).catch((e) => fill(note(esc(e.message))));
        return;
      }
      if (!subs.some((x) => x.key === C.subject)) C.subject = subs[0]?.key || "trending";
      quick("browse", { subject: C.subject }, fill, id);
      return;
    }
    const promoLine = { animation: "New anime and animated series and films, from this year and last", book: "Notable books from the last six months, starting with sequels and new books from your authors",
      manga: "The manga everyone's reading right now", comic: "Comics and graphic novels from this year and last", movie: "Films released this year and last", tv: "Shows that premiered this year and last" }[C.cat];
    v.innerHTML = head + `<div class="ct-promo"><b>${["movie", "tv", "animation"].includes(C.cat) ? "Now showing!" : "Hot off the press!"}</b><span>${esc(promoLine)}</span></div><div id="ctBody">${note("Fetching what's new…")}</div>`;
    quick("promos", {}, fill, id, promoGrid);
  }
  // a list: last time's at once (if there was one), then the computer's fresh one only if it's different
  function quick(path, params, fill, id, make = grid) {
    const p = pathOf(path, params), old = kept(path, params);
    let shownJson = "";
    if (old && old.items && old.items.length) { fill(make(old.items)); shownJson = JSON.stringify(old.items); }
    if (shownJson && fresh[p] && Date.now() - fresh[p] < 600000) return;
    live(() => get(path, params).then((r) => { fresh[p] = Date.now(); return r; }), fill, id, 0, shownJson, make);
  }
  // lists the computer is still filling in ("pending") are asked for again until they're done
  async function live(fetcher, fill, id, n = 0, same = "", make = grid) {
    try {
      const r = await fetcher();
      if (id !== C.seq) return;
      if (same && !r.pending && r.items && r.items.length && JSON.stringify(r.items) === same) return;      // (nothing new: the cards stay as they are)
      if (same && !r.items?.length) return;
      fill(r.items.length ? make(r.items) + (r.pending ? note("More arriving…") : "") : r.pending ? note("Fetching…") : note(r.error ? esc(r.error) : "Nothing here right now."));
      if (r.pending && n < 12) setTimeout(() => live(fetcher, fill, id, n + 1, "", make), 3500);
    } catch (e) { if (!same) fill(note(esc(e.message))); }
  }
  // fetched ahead (after a sync), so the catalogue opens with its covers and lists already here
  async function warm() {
    for (const [path, params] of [["promos", {}], ["subjects", {}]]) {
      const p = pathOf(path, params);
      if (fresh[p] && Date.now() - fresh[p] < 600000) continue;
      try { const r = await get(path, params); fresh[p] = Date.now();
        for (const x of (r.items || []).slice(0, 18)) { const im = new Image(); im.src = coverSrc(x); } } catch (e) { return; }
    }
  }

  async function info(r) {
    const sh = $("#sheet");
    const who = (r.authors || []).join(", ");
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(r.title)}</h2></div>
      <div class="it-body ct-info"><div class="ct-info-top"><span class="ct-big"><img alt="" src="${esc(coverSrc(r))}" onerror="this.remove()"></span>
        <div><h3>${esc(r.title)}</h3><p>${esc([who, r.year].filter(Boolean).join(" · "))}</p>${r.series ? `<p class="hint">${esc(r.series)}${r.index != null ? " #" + +r.index : ""}</p>` : ""}
        <p id="ctRating" class="hint">${r.rating ? "★ " + (+r.rating).toFixed(1) : ""}</p>
        ${r.have === "owned" ? `<p class="badge">On your shelf</p>` : r.have === "wanted" ? `<p class="badge">✓ On your list</p>` : `<button class="btn primary" data-ct-want="${shown.indexOf(r)}">＋ Add to list</button>`}</div></div>
        <div id="ctAbout">${r.blurb ? `<p>${esc(r.blurb)}</p>` : `<p class="hint">Looking it up…</p>`}</div>
        <div id="ctSeries"></div>
        <div class="btns" id="ctLinks">${who ? `<button class="btn" data-ct-author="${esc((r.authors || [])[0])}">More by ${esc((r.authors || [])[0])}</button>` : ""}</div></div>`;
    sh.hidden = false; sh.scrollTop = 0;
    seriesOf(r);
    try {
      const d = await get("info", { title: r.title, author: (r.authors || [])[0] || "", wiki: r.wiki || "", isbn: r.isbn || "", link: r.link || "", al: r.al || "", form: r.form || "" });
      if ($("#sheet").hidden || !$("#ctAbout")) return;
      const about = d.intro || d.description || r.blurb;
      if (about) $("#ctAbout").innerHTML = about.split(/\n{2,}|\n/).filter((x) => x.trim()).map((x) => `<p>${esc(x)}</p>`).join("");
      if (d.rating) $("#ctRating").textContent = "★ " + (+d.rating).toFixed(1) + (d.ratings ? ` · ${(+d.ratings).toLocaleString()} ratings` : "");
      const links = [...(d.read || []).map((l) => ({ ...l, label: "📖 Read on " + l.label })), ...(d.links || []), ...(r.link ? [{ label: "See it online", url: r.link }] : [])];
      $("#ctLinks").insertAdjacentHTML("beforeend", links.slice(0, 4).map((l) => `<button class="btn" data-go-url="${esc(l.url)}">${esc(l.label)} ↗</button>`).join(""));
    } catch (e) { if ($("#ctAbout") && !r.blurb) $("#ctAbout").innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  // part of a series: every book in it, in order (this one marked; yours and the ones you want too); tap one for its info
  async function seriesOf(r) {
    if (!["book", "manga", "comic"].includes(C.cat)) return;
    let s;
    try { s = await get("seriesof", { title: r.title, author: (r.authors || [])[0] || "", series: r.series || "", index: r.index ?? "" }); } catch (e) { return; }
    const box = $("#ctSeries");
    if (!box || $("#sheet").hidden || !s || !s.books) return;
    const norm = (t) => String(t || "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, "");
    const here = (x) => (s.index != null && +x.index === +s.index) || norm(x.title) === norm(r.title);
    const start = shown.length;
    shown.push(...s.books.map((x) => ({ ...x, cat: C.cat, series: s.series })));
    if (!r.series) { const h = box.closest(".ct-info")?.querySelector(".ct-info-top .hint"); if (!h) box.closest(".ct-info")?.querySelector(".ct-info-top h3")?.insertAdjacentHTML("afterend", `<p class="hint">${esc(s.series)}${s.index != null ? " #" + +s.index : ""}</p>`); }
    box.innerHTML = `<h3 class="ct-ser-h"><small class="ct-ser-k">Part of a series</small>${esc(s.series)} <small>${s.books.length} books</small></h3>
      <div class="ct-ser-row">${s.books.map((x, i) => `<button class="ct-ser-b ${here(x) ? "here" : ""}" data-ct-info="${start + i}">
        <span class="ct-ser-c">${x.cover ? `<img loading="lazy" alt="" src="${esc(x.cover)}" onerror="this.remove()">` : ""}<i>${esc(x.title)}</i></span>
        <b>${x.index != null ? "#" + +x.index + " " : ""}${esc(x.title)}</b><small>${[x.year, x.have === "owned" ? "✓ yours" : x.have === "wanted" ? "wanted" : here(x) ? "this one" : ""].filter(Boolean).join(" · ")}</small></button>`).join("")}</div>`;
  }

  async function want(r, btn) {
    try {
      const res = await api("POST", "/sync/cat/wish", r);
      r.have = "wanted";
      if (btn) btn.outerHTML = `<span class="ct-tag got">✓ On your list</span>`;
      toast(res.queued ? "On your shopping list (the computer gets it next time it's reached)" : "Added to your shopping list");
      sync();
    } catch (e) { toast(e.message); }
  }
  // ✕ on a card: not for me (the computer stops showing it, here and there)
  async function ignore(r, btn) {
    const el = btn && btn.closest(".ct-card");
    try {
      await api("POST", "/sync/cat/ignore", { title: r.title });
      if (el) { el.classList.add("gone"); setTimeout(() => el.remove(), 260); }
      toast("Won't show that one again");
    } catch (e) { toast(e.offline ? "Needs your computer to hide things" : e.message); }
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-ct-next]")) return nextCat();
    const vw = t.closest("[data-ct-view]"); if (vw) { C.view = vw.dataset.ctView; return render($("#view")); }
    const sb = t.closest("[data-ct-sub]"); if (sb) { C.subject = sb.dataset.ctSub; return render($("#view")); }
    // ↻ in Browse: the computer restocks this aisle (new things you haven't been shown); without it, the list is fetched again
    const rs = t.closest("[data-ct-restock]");
    if (rs) {
      const id = ++C.seq, b = $("#ctBody");
      rs.disabled = true; rs.textContent = "Restocking…";
      if (b) b.innerHTML = note("Restocking the shelves…");
      const fill = (html) => { if (id === C.seq && S.tab === "catalogue") { const x = $("#ctBody"); if (x) x.innerHTML = html; } rs.disabled = false; rs.textContent = "↻ Refresh"; };
      let first = true;
      return live(() => first ? (first = false, api("POST", `/sync/cat/restock?${new URLSearchParams({ cat: C.cat, subject: C.subject })}`).catch(() => get("browse", { subject: C.subject })))
        : get("browse", { subject: C.subject }), fill, id);
    }
    const inf = t.closest("[data-ct-info]"); if (inf) return info(shown[Number(inf.dataset.ctInfo)]);
    const w = t.closest("[data-ct-want]"); if (w) { const r = shown[Number(w.dataset.ctWant)]; if (r) want(r, w); return; }
    const ig = t.closest("[data-ct-ignore]"); if (ig) { const r = shown[Number(ig.dataset.ctIgnore)]; if (r) ignore(r, ig); return; }
    const au = t.closest("[data-ct-author]"); if (au) { closeSheet(); return byAuthor(au.dataset.ctAuthor, au.dataset.ctKind || (C.cat === "manga" || C.cat === "comic" ? C.cat : "book")); }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "ctSearch") return;
    e.preventDefault();
    C.q = $("#ctQ").value.trim();
    if (!C.q) return;
    $("#ctBody").innerHTML = note("Searching…");
    try { C.results = await get("search", { q: C.q }); } catch (err) { return ($("#ctBody").innerHTML = note(esc(err.message))); }
    render($("#view"));
  });

  /* everything by an author (from a book's page, or "More by…") */
  function byAuthor(name, cat = "book") {
    C.cat = ["book", "manga", "comic"].includes(cat) ? cat : "book";
    C.view = "who"; C.who = name;
    setTab("catalogue");
  }
  // (the Bulletin's Hot Off the Press opens its posters here)
  const show = (r) => { if (!shown.includes(r)) shown = [r]; return info(r); };
  return { render, byAuthor, show, want, coverSrc, warm };
})();
