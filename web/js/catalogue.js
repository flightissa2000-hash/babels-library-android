/* The catalogue on the phone: the computer's Discover (new releases, browse the aisles, search, everything by an
   author, your wishlist), passed through the computer (it does the looking up and keeps the covers). */
const Catalogue = (() => {
  const C = { cat: "book", view: "new", q: "", subject: "", subjects: {}, results: null, who: "", seq: 0 };
  const DEPTS = [["book", "Books"], ["manga", "Manga"], ["comic", "Comics"], ["movie", "Films"], ["tv", "TV"], ["animation", "Animation"]];
  const VIEWS = [["new", "New"], ["browse", "Browse"], ["search", "Search"], ["wish", "Wishlist"]];
  const get = (path, params) => api("GET", `/sync/cat/${path}?${new URLSearchParams({ cat: C.cat, ...params })}`);
  const coverSrc = (r) => "/catcover?" + new URLSearchParams({ u: /^https:\/\//.test(r.cover || "") ? r.cover : "", isbn: r.isbn || "", t: r.title || "", a: (r.authors || [])[0] || "" });
  const wished = () => Object.values(S.items).filter((i) => i.wanted && !i.has_file);
  let shown = [];       // the cards on screen, for opening one

  function card(r, i) {
    const tag = r.have === "owned" ? `<span class="ct-tag got">On your shelf</span>` : r.have === "wanted" ? `<span class="ct-tag got">✓ Wanted</span>` : `<button class="ct-tag" data-ct-want="${i}">＋ Want</button>`;
    return `<div class="ct-card ${r.have ? "have-" + r.have : ""}"><button class="ct-cov" data-ct-info="${i}"><img loading="lazy" alt="" src="${esc(coverSrc(r))}" onerror="this.remove()"><span>${esc((r.title || "?").slice(0, 40))}</span></button>
      <b>${esc(r.title)}</b><small>${esc([(r.authors || [])[0], r.year].filter(Boolean).join(" · "))}</small>${r.series ? `<small class="ct-ser">${esc(r.series)}${r.index != null ? " #" + +r.index : ""}</small>` : ""}${tag}</div>`;
  }
  const grid = (list) => { shown = list; return `<div class="ct-grid">${list.map(card).join("")}</div>`; };
  const note = (t) => `<p class="empty">${t}</p>`;

  function render(v) {
    const head = `<div class="ct-head"><div class="ct-mast"><small>Babel's</small><b>Big ${esc(DEPTS.find((d) => d[0] === C.cat)[1].replace(/s$/, "").replace("Film", "Film"))} Catalogue</b></div>
      <div class="chips ct-depts">${DEPTS.map(([k, n]) => `<button data-ct-cat="${k}" class="${C.cat === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="ct-views">${VIEWS.map(([k, n]) => `<button data-ct-view="${k}" class="${C.view === k ? "on" : ""}">${n}${k === "wish" && wished().length ? ` <i>${wished().length}</i>` : ""}</button>`).join("")}</div></div>`;
    if (!S.conn.token) { v.innerHTML = head + note("Pair with your computer first (Settings)."); return; }
    const id = ++C.seq;
    const fill = (html) => { if (id === C.seq && S.tab === "catalogue") { const b = $("#ctBody"); if (b) b.innerHTML = html; } };
    if (C.view === "search") {
      v.innerHTML = head + `<form class="searchrow" id="ctSearch"><input id="ctQ" type="search" placeholder="A title, an author…" value="${esc(C.q)}" autocomplete="off"><button class="btn primary">Find</button></form><div id="ctBody">${C.results ? (C.results.length ? grid(C.results) : note("Nothing by that name. Try fewer words.")) : note("Search the catalogues. Anything you want goes on your wishlist on the computer too.")}</div>`;
      return;
    }
    if (C.view === "wish") {
      const w = wished();
      v.innerHTML = head + `<div id="ctBody">${w.length ? `<div class="list">${w.map((i) => `<button class="row" data-item="${i.id}">${cover(i, false)}<span class="t"><b>${esc(i.title)}</b><small>${esc(byline(i))}</small></span></button>`).join("")}</div>` : note("Your wishlist is empty. Tap ＋ Want on anything in the catalogue.")}</div>`;
      return;
    }
    if (C.view === "who") {
      v.innerHTML = head + `<div class="ct-who"><b>Everything by ${esc(C.who)}</b><small>The ones on your shelves are marked.</small></div><div id="ctBody">${note("Looking through the catalogues…")}</div>`;
      get("byauthor", { name: C.who }).then((r) => fill(r.items.length ? grid(r.items) : note("Nothing more found."))).catch((e) => fill(note(esc(e.message))));
      return;
    }
    if (C.view === "browse") {
      const subs = C.subjects[C.cat];
      v.innerHTML = head + `<div class="chips ct-aisles" id="ctAisles">${subs ? subs.map((x) => `<button data-ct-sub="${esc(x.key)}" class="${x.key === C.subject ? "on" : ""}">${esc(x.label)}</button>`).join("") : ""}</div><div id="ctBody">${note("Stocking the shelves…")}</div>`;
      if (!subs) {
        get("subjects", {}).then((s) => { C.subjects[C.cat] = s; if (!s.some((x) => x.key === C.subject)) C.subject = s[0]?.key || "trending"; if (id === C.seq) render(v); }).catch((e) => fill(note(esc(e.message))));
        return;
      }
      if (!subs.some((x) => x.key === C.subject)) C.subject = subs[0]?.key || "trending";
      live(() => get("browse", { subject: C.subject }), fill, id);
      return;
    }
    v.innerHTML = head + `<div id="ctBody">${note("Fetching what's new…")}</div>`;
    live(() => get("promos", {}), fill, id);
  }
  // lists the computer is still filling in ("pending") are asked for again until they're done
  async function live(fetcher, fill, id, n = 0) {
    try {
      const r = await fetcher();
      if (id !== C.seq) return;
      fill(r.items.length ? grid(r.items) + (r.pending ? note("More arriving…") : "") : r.pending ? note("Fetching…") : note(r.error ? esc(r.error) : "Nothing here right now."));
      if (r.pending && n < 12) setTimeout(() => live(fetcher, fill, id, n + 1), 3500);
    } catch (e) { fill(note(esc(e.message))); }
  }

  async function info(r) {
    const sh = $("#sheet");
    const who = (r.authors || []).join(", ");
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(r.title)}</h2></div>
      <div class="it-body ct-info"><div class="ct-info-top"><span class="ct-big"><img alt="" src="${esc(coverSrc(r))}" onerror="this.remove()"></span>
        <div><h3>${esc(r.title)}</h3><p>${esc([who, r.year].filter(Boolean).join(" · "))}</p>${r.series ? `<p class="hint">${esc(r.series)}${r.index != null ? " #" + +r.index : ""}</p>` : ""}
        <p id="ctRating" class="hint">${r.rating ? "★ " + (+r.rating).toFixed(1) : ""}</p>
        ${r.have === "owned" ? `<p class="badge">On your shelf</p>` : r.have === "wanted" ? `<p class="badge">✓ On your wishlist</p>` : `<button class="btn primary" data-ct-want="${shown.indexOf(r)}">＋ Add to wishlist</button>`}</div></div>
        <div id="ctAbout">${r.blurb ? `<p>${esc(r.blurb)}</p>` : `<p class="hint">Looking it up…</p>`}</div>
        <div class="btns" id="ctLinks">${who ? `<button class="btn" data-ct-author="${esc((r.authors || [])[0])}">More by ${esc((r.authors || [])[0])}</button>` : ""}</div></div>`;
    sh.hidden = false; sh.scrollTop = 0;
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

  async function want(r, btn) {
    try {
      await api("POST", "/sync/cat/wish", r);
      r.have = "wanted";
      if (btn) btn.outerHTML = `<span class="ct-tag got">✓ Wanted</span>`;
      toast("Added to your wishlist");
      sync();
    } catch (e) { toast(e.message); }
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const c = t.closest("[data-ct-cat]"); if (c) { C.cat = c.dataset.ctCat; C.results = null; if (C.view === "who") C.view = "new"; return render($("#view")); }
    const vw = t.closest("[data-ct-view]"); if (vw) { C.view = vw.dataset.ctView; return render($("#view")); }
    const sb = t.closest("[data-ct-sub]"); if (sb) { C.subject = sb.dataset.ctSub; return render($("#view")); }
    const inf = t.closest("[data-ct-info]"); if (inf) return info(shown[Number(inf.dataset.ctInfo)]);
    const w = t.closest("[data-ct-want]"); if (w) { const r = shown[Number(w.dataset.ctWant)]; if (r) want(r, w); return; }
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
  return { render, byAuthor, show, want, coverSrc };
})();
