/* The News and the catalogue without the computer. When the computer can't be reached, the phone does the looking up
   itself, straight from the same public sources (science newsrooms' RSS feeds, Google News, Wikipedia and Wikidata,
   Open Library, AniList). What the computer last sent is kept too, and shown when the web can't give an answer.
   Android fetches anything (no CORS); an iPhone can only ask sites that allow it (Wikipedia, Wikidata, Open Library,
   AniList): its News desks show the computer's last copy instead. */
const Online = (() => {
  const UA_OK = !!(window.Android && Android.webget);           // the Android app: any site
  const PX = (k) => `https://phys.org/rss-feed/${k}-news/`, SD = (k) => `https://www.sciencedaily.com/rss/${k}.xml`;
  // research journals, each in its topic (as on the computer: news.py)
  const J = { prl: "https://feeds.aps.org/rss/recent/prl.xml", nphys: "https://www.nature.com/nphys.rss", quanta: "https://api.quantamagazine.org/feed/",
    apjl: "https://iopscience.iop.org/journal/rss/2041-8205", natastron: "https://www.nature.com/natastron.rss", cell: "https://www.cell.com/cell/current.rss",
    elife: "https://elifesciences.org/rss/recent.xml", plosbio: "https://journals.plos.org/plosbiology/feed/atom", nejm: "https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss",
    lancet: "https://www.thelancet.com/rssfeed/lancet_current.xml", jama: "https://jamanetwork.com/rss/site_3/67.xml", natmed: "https://www.nature.com/nm.rss",
    plosmed: "https://journals.plos.org/plosmedicine/feed/atom", nclimate: "https://www.nature.com/nclimate.rss", sciadv: "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=sciadv",
    nchem: "https://www.nature.com/nchem.rss", natmi: "https://www.nature.com/natmachintell.rss", science: "https://www.science.org/rss/news_current.xml" };
  const SCIENCE = [
    ["labs", "Straight from the labs", ["https://news.mit.edu/rss/research", "https://www.nih.gov/news-releases/feed.xml", "https://www.nasa.gov/news-release/feed/",
      "https://www.esa.int/rssfeed/Our_Activities/Space_Science", "https://news.harvard.edu/gazette/section/science-technology/feed/", "https://www.cam.ac.uk/news/feed"]],
    ["physics", "Physics", [PX("physics"), SD("matter_energy"), J.prl, J.nphys, J.quanta]], ["space", "Space", [PX("space"), SD("space_time"), J.apjl, J.natastron]],
    ["life", "Life & biology", [PX("biology"), SD("plants_animals"), J.cell, J.elife, J.plosbio]],
    ["health", "Health & medicine", ["https://medicalxpress.com/rss-feed/", SD("health_medicine"), J.nejm, J.lancet, J.jama, J.natmed, J.plosmed]],
    ["earth", "Earth & climate", [PX("earth"), SD("earth_climate"), J.nclimate, J.sciadv]], ["chem", "Chemistry & materials", [PX("chemistry"), PX("nanotech"), J.nchem]],
    ["tech", "Technology & computing", [PX("technology"), SD("computers_math"), J.natmi, J.science]],
  ];
  // (a journal's name for its stories: their links only say the publisher)
  const FEED_NAME = { [J.prl]: "Physical Review Letters", [J.nphys]: "Nature Physics", [J.quanta]: "Quanta Magazine", [J.apjl]: "Astrophysical Journal Letters",
    [J.natastron]: "Nature Astronomy", [J.cell]: "Cell", [J.elife]: "eLife", [J.plosbio]: "PLOS Biology", [J.nejm]: "NEJM", [J.lancet]: "The Lancet", [J.jama]: "JAMA",
    [J.natmed]: "Nature Medicine", [J.plosmed]: "PLOS Medicine", [J.nclimate]: "Nature Climate Change", [J.sciadv]: "Science Advances", [J.nchem]: "Nature Chemistry",
    [J.natmi]: "Nature Machine Intelligence", [J.science]: "Science" };
  const OUTLET = { "phys.org": "Phys.org", "techxplore.com": "Tech Xplore", "medicalxpress.com": "Medical Xpress", "sciencedaily.com": "ScienceDaily", "mit.edu": "MIT News", "nih.gov": "NIH",
    "nasa.gov": "NASA", "esa.int": "ESA", "harvard.edu": "Harvard Gazette", "cam.ac.uk": "University of Cambridge" };
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  /* ---------------- fetching from the web ---------------- */
  async function web(url, { method = "GET", body = "", headers = null, json = false } = {}) {
    let status, text, final = url;
    if (UA_OK) {
      const r = await bridge("webget", method, url, body, headers ? JSON.stringify(headers) : "");
      status = r.status; text = r.text; final = r.route || url;
      if (!status) throw Object.assign(new Error("No internet connection."), { offline: true });
    } else {
      let res;
      try { res = await fetch(url, { method, body: method === "POST" ? body : undefined, headers: headers || undefined }); }
      catch (e) { throw Object.assign(new Error(navigator.onLine ? "That site can't be reached from here." : "No internet connection."), { offline: true }); }
      status = res.status; text = await res.text(); final = res.url || url;
    }
    if (status >= 400) throw new Error(`The site answered ${status}.`);
    return json ? JSON.parse(text) : { text, url: final };
  }

  /* ---------------- what the computer last sent (kept per question) ---------------- */
  const KEEP = /^\/sync\/(news\/(science|local)|cat\/(promos|browse|subjects|search|byauthor|info|series|authors))/;
  const keyOf = (path) => "nc-" + (path.length > 120 ? path.slice(0, 80) + Array.from(path).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) : path).replace(/[^a-z0-9]+/gi, "_") + ".json";
  function remember(method, path, data) {
    if (method !== "GET" || !KEEP.test(path)) return;
    try { store(keyOf(path.replace(/[?&]fresh=1/, "")), { at: now(), data }); } catch (e) {}
    if (path.startsWith("/sync/news/local") && data && data.place) store("newsplace.json", data.place);
  }
  const recalled = (path) => { const c = load(keyOf(path.replace(/[?&]fresh=1/, "")), null); return c && c.data; };

  /* ---------------- RSS ---------------- */
  const text1 = (s, n = 320) => { const t = String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); const d = document.createElement("textarea"); d.innerHTML = t; const v = d.value; return v.length <= n ? v : v.slice(0, n).replace(/\s+\S*$/, "") + "…"; };
  const outlet = (link) => { let h = ""; try { h = new URL(link).hostname.replace(/^www\./, ""); } catch (e) {} return Object.entries(OUTLET).find(([k]) => h === k || h.endsWith("." + k))?.[1] || h; };
  const feedCache = new Map();
  async function feed(url, fresh) {
    const hit = feedCache.get(url);
    if (hit && !fresh && now() - hit.at < 1800) return hit.items;
    const { text } = await web(url);
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const items = [];
    // RSS 2.0, RSS 1.0 (most journals) and Atom (PLOS)
    for (const it of doc.querySelectorAll("item, entry")) {
      const get = (...sels) => { for (const s of sels) { const v = it.getElementsByTagName(s)[0]?.textContent; if (v) return v; } return ""; };
      let title = text1(get("title"), 300);
      const al = [...it.getElementsByTagName("link")].find((l) => l.getAttribute("href") && (l.getAttribute("rel") || "alternate") === "alternate");
      const link = (get("link").trim() || (al ? al.getAttribute("href") : "")).trim();
      if (!title || !link) continue;
      const source = get("source").trim();
      if (source && title.endsWith(" - " + source)) title = title.slice(0, -source.length - 3);
      let img = "";
      for (const tag of ["media:content", "media:thumbnail", "enclosure"]) {
        for (const el of it.getElementsByTagName(tag)) if (el.getAttribute("url") && (tag !== "enclosure" || (el.getAttribute("type") || "image").startsWith("image"))) img = el.getAttribute("url");
        if (img) break;
      }
      if (!img) { const m = /<img[^>]+src="([^"]+)"/.exec(get("description") + get("content:encoded")); img = m ? m[1] : ""; }
      const when = Date.parse(get("pubDate", "dc:date", "published", "updated")) / 1000 || 0;
      items.push({ title, link, source: source || FEED_NAME[url] || outlet(link), by: text1(get("dc:creator", "name"), 80), date: when,
        summary: url.includes("news.google.com") ? "" : text1(get("description", "summary", "content")), image: img.replace("/csz/news/tmb/", "/csz/news/800a/") });
    }
    feedCache.set(url, { at: now(), items });
    return items;
  }
  async function many(urls, limit = 40, mix = false, fresh = false) {
    const lists = await Promise.all(urls.map((u) => feed(u, fresh).catch(() => [])));
    let order;
    if (mix) { const ls = lists.map((l) => [...l].sort((a, b) => b.date - a.date)); order = []; for (let i = 0; ls.some((l) => i < l.length); i++) for (const l of ls) if (l[i]) order.push(l[i]); }
    else order = lists.flat().sort((a, b) => b.date - a.date);
    const seen = new Set(), out = [];
    for (const s of order) { const k = norm(s.title).slice(0, 80); if (!seen.has(k)) { seen.add(k); out.push(s); } }
    return out.slice(0, limit);
  }

  /* ---------------- the News ---------------- */
  async function science(fresh) {
    if (!UA_OK) throw new Error("");
    const sections = await Promise.all(SCIENCE.map(async ([key, label, urls]) => ({ key, label, items: await many(urls, 30, true, fresh) })));
    if (!sections.some((s) => s.items.length)) throw new Error("The newsrooms can't be reached right now.");
    return { sections };
  }
  const gnews = (q, days) => "https://news.google.com/rss/search?" + new URLSearchParams({ q: q + (days ? ` when:${days}d` : ""), hl: "en-US", gl: "US", ceid: "US:en" });
  const KINDS = [["vote", /\bvot(e|es|ed|ing)\b|approv|passes|passed|rejects?|ballot|referendum/], ["ordinance", /ordinance|bylaw|zoning|code amendment|regulation|\bban\b/],
    ["meeting", /meeting|hearing|session|town hall|forum|agenda|workshop/], ["election", /election|candidate|primary|runoff|campaign/], ["budget", /budget|tax|bond|funding|millage|spending/]];
  const EVENT = /exhibit|exhibition|museum|gallery|festival|\bfest\b|\bfair\b(?! to)|farmers.? market|market day|art walk|open house|workshop|meetup|gathering|celebrat|parade|concert series|free concert|block party|cleanup|volunteer|lecture|book (talk|signing)|reading series|screening|film series|things to do|this weekend|weekend guide|events? (this|calendar|guide)|halloween|holiday (market|lights)|trunk.or.treat|5k|run\/walk|library program|story ?time|class(es)? at/;
  const NOT_EVENT = /\b(tour (dates|of north america)|world series|nfl|nba|mlb|nhl|arrest|shooting|crash|lawsuit|dies|killed|obituary|stock|earnings|opinion|open letter|fair to|photos:|recap|editorial)\b|^photos/;
  const place = () => load("newsplace.json", null) || { county: "", state: "", city: "", country: "United States", seat: "" };
  async function local(fresh) {
    const p = place();
    if (!p.county) return { place: p, sections: [] };
    if (!UA_OK) throw new Error("");
    const { county, state, country } = p, city = p.city || p.seat, st = state ? ` "${state}"` : "";
    const civic = "(ordinance OR vote OR council OR commissioners OR meeting OR hearing OR budget OR election OR approves)";
    const where = city ? `("${city}" OR "${county}")` : `"${county}"`;
    const evq = [gnews(`${where}${st} (exhibit OR exhibition OR museum OR gallery) opens`, 30), gnews(`${where}${st} (festival OR "farmers market" OR "art walk" OR "block party" OR parade OR fair)`, 21),
      gnews(`${where}${st} ("things to do" OR "this weekend" OR "events this week")`, 10), gnews(`${where}${st} (workshop OR lecture OR "open house" OR volunteer OR "library" OR meetup)`, 21)];
    const plan = [["county", county, [gnews(`"${county}"${st} ${civic}`, 30), gnews(`"${county}" (commissioners OR "commissioners court" OR "board of supervisors")`, 30)]]];
    if (city) plan.push(["city", city, [gnews(`"${city}"${st} ("city council" OR mayor OR ordinance OR "city hall" OR vote OR meeting)`, 30)]]);
    if (state) plan.push(["state", state, [gnews(`("${state} Legislature" OR "${state} governor" OR "${state} Senate" OR "${state} House" OR "${state} lawmakers" OR "state lawmakers" OR "${state} attorney general") -firm -litigator -lawyers`, 7)]]);
    if (country) plan.push(["country", country, [gnews(/^(united states|usa|us|u\.s\.)$/i.test(country) ? '(Congress OR Senate OR "White House" OR "Supreme Court" OR "House votes")' : `"${country}" (parliament OR government OR minister OR vote)`, 3)]]);
    const [ev, ...got] = await Promise.all([many(evq, 80, false, fresh), ...plan.map(([, , qs]) => many(qs, 24, false, fresh))]);
    const events = ev.filter((s) => { const t = s.title.toLowerCase(); return !NOT_EVENT.test(t) && EVENT.test(t); }).slice(0, 24).map((s) => ({ ...s, kind: "event" }));
    const out = [{ key: "events", label: `Things to do around ${city || county}`, items: events }], shown = new Set(events.map((s) => s.link));
    plan.forEach(([key, label], i) => {
      const items = got[i].filter((s) => !shown.has(s.link));
      items.forEach((s) => { shown.add(s.link); s.kind = (KINDS.find(([, rx]) => rx.test(s.title.toLowerCase())) || [""])[0]; });
      out.push({ key, label, items });
    });
    if (!out.some((s) => s.items.length)) throw new Error("The news can't be reached right now.");
    return { place: p, sections: out };
  }
  async function setPlace(d) {
    let county = String(d.county || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const state = String(d.state || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!county) throw new Error("Type the name of your county.");
    if (!/county|parish|borough/i.test(county)) county += " County";
    let seat = "";
    if (!String(d.city || "").trim()) {
      try {           // the county seat from Wikidata (P36)
        const s = await web("https://www.wikidata.org/w/api.php?" + new URLSearchParams({ action: "wbsearchentities", search: state ? `${county}, ${state}` : county, language: "en", format: "json", limit: 1, origin: "*" }), { json: true });
        const qid = s.search && s.search[0] && s.search[0].id;
        const e = qid && (await web(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json?origin=*`, { json: true })).entities[qid];
        const sid = e && (((e.claims || {}).P36 || [])[0] || {}).mainsnak?.datavalue?.value?.id;
        if (sid) seat = ((await web(`https://www.wikidata.org/wiki/Special:EntityData/${sid}.json?origin=*`, { json: true })).entities[sid].labels.en?.value || "").replace(/,.*$/, "");
      } catch (e) {}
    }
    const p = { county, state, city: String(d.city || "").trim().slice(0, 60), country: String(d.country || "United States").trim().slice(0, 60) || "United States", seat };
    store("newsplace.json", p);
    queue("POST", "/sync/news/place", d);              // (the computer learns it too, next time it's reached)
    return p;
  }
  /* a story, for reading in the Gazette: its paragraphs (the box on the page with the most text in it) */
  async function realUrl(link) {
    if (!link.includes("news.google.com")) return link;
    try {
      const gid = new URL(link).pathname.replace(/\/$/, "").split("/").pop();
      const page = (await web(`https://news.google.com/rss/articles/${gid}`)).text;
      const sg = /data-n-a-sg="([^"]+)"/.exec(page), ts = /data-n-a-ts="([^"]+)"/.exec(page);
      if (!sg || !ts) return link;
      const inner = ["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], gid, Number(ts[1]), sg[1]];
      const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", JSON.stringify(inner), null, "generic"]]]));
      const res = (await web("https://news.google.com/_/DotsSplashUi/data/batchexecute", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } })).text;
      return JSON.parse(JSON.parse(res.split("\n\n")[1])[0][2])[1] || link;
    } catch (e) { return link; }
  }
  async function article(link) {
    if (!UA_OK) throw new Error("Stories open in the browser while the computer is off");
    const url = await realUrl(link);
    const { text, url: final } = await web(url);
    const doc = new DOMParser().parseFromString(text, "text/html");
    const meta = (k) => doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute("content") || "";
    doc.querySelectorAll("script:not([type='application/ld+json']), style, noscript, nav, header, footer, aside, form, button, svg, figcaption, iframe").forEach((x) => x.remove());
    doc.querySelectorAll("[class*=comment], [class*=related], [class*=newsletter], [class*=promo], [class*=share], [class*=social], [class*=advert], [class*=sidebar], [class*=subscribe]").forEach((x) => x.remove());
    const JUNK = /^(advertisement|subscribe|sign up|related|read more|share this|follow us|copyright|©|image|photo:|credit:)|newsletter|cookie|all rights reserved/i;
    const score = new Map();
    const blocks = [...doc.querySelectorAll("p, h2, h3, blockquote, li")].map((el) => ({ el, t: el.tagName.toLowerCase(), x: el.textContent.replace(/\s+/g, " ").trim() }))
      .filter((b) => b.x && !JUNK.test(b.x.slice(0, 60)) && (b.x.length > 50 || b.t === "h2" || b.t === "h3"));
    for (const b of blocks) { let a = b.el.parentElement; for (let i = 0; a && i < 4; i++, a = a.parentElement) score.set(a, (score.get(a) || 0) + (b.t === "p" ? b.x.length : b.x.length / 3) / (1 + i)); }
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let out = blocks.filter((b) => !best || best.contains(b.el)).map(({ t, x }) => ({ t, x }));
    if (out.reduce((n, b) => n + b.x.length, 0) < 600) {
      for (const s of doc.querySelectorAll("script[type='application/ld+json']")) {
        try { const d = JSON.parse(s.textContent); for (const o of Array.isArray(d) ? d : d["@graph"] || [d]) if (o && o.articleBody && o.articleBody.length > 600) { out = o.articleBody.split(/\n+/).map((x) => ({ t: "p", x: x.trim() })).filter((b) => b.x); break; } } catch (e) {}
      }
    }
    const title = meta("og:title"), seen = new Set();
    return { url: final, title, site: meta("og:site_name") || outlet(final), by: meta("author"), date: meta("article:published_time"), image: meta("og:image") || meta("twitter:image"),
      dek: meta("og:description"), blocks: out.filter((b) => { const k = b.x.slice(0, 80); if (seen.has(k) || b.x === title) return false; seen.add(k); return true; }).slice(0, 120) };
  }

  /* ---------------- the catalogue ---------------- */
  const WP = "https://en.wikipedia.org/w/api.php?";
  const BOOKISH = /\b(novel|novella|book|memoir|collection|graphic novel|comic|manga|poetry|poems|non-?fiction|biography|autobiography|essays?|anthology|trilogy)\b/i;
  const NEVER_BOOK = /\b(character|franchise|film series|fashion|exhibition|imprint|bookstore|literary award)\b|\((?:character|franchise)\)/i;
  const NOT_BOOK = /\b(film|television|tv series|video game|franchise|character|album|song|band|novelist|writer|author|poet|journalist|publisher|award|magazine|podcast)\b/i;
  const FITS = {
    book: (d, t) => BOOKISH.test(d) && !(NOT_BOOK.test(d) && !/\b(novel|book)\b/i.test(d)) && !NEVER_BOOK.test(d + " " + t),
    comic: (d) => /\b(comic|graphic novel)\b/i.test(d) && !/\bcharacter\b/i.test(d),
    movie: (d) => /\bfilm\b/i.test(d) && !/\b(series|festival|director|actor|actress|studio)\b/i.test(d),
    tv: (d) => /\b(television|tv) (series|show|programme|program|miniseries)\b|\bseries\b.*\b(netflix|hbo|hulu|apple tv|prime video|disney)/i.test(d),
    animation: (d) => /\banimated\b|\banime\b/i.test(d),
  };
  const INFOBOX = { book: 'hastemplate:"Infobox book"', comic: 'hastemplate:"Infobox comic book title"', movie: 'hastemplate:"Infobox film"', tv: 'hastemplate:"Infobox television"', animation: 'hastemplate:"Infobox animanga"' };
  const fromPage = (cat, pg) => {
    const desc = (pg.description || "").trim();
    if (!(FITS[cat] || FITS.book)(desc, pg.title) || /^(list|bibliography|works) of\b/i.test(pg.title)) return null;
    const m = /\bby\s+(.+?)\s*$/.exec(desc), y = /\b(1[5-9]\d\d|20\d\d)\b/.exec(desc);
    return { title: pg.title.replace(/\s*\([^)]*\b(?:novel|book|novella|comics?|memoir|series|collection|stories|poems|manga|film|TV series|miniseries)\b[^)]*\)$/i, ""),
      authors: m ? [m[1]] : [], year: y ? Number(y[1]) : null, cover: (pg.thumbnail || {}).source || "", blurb: desc, wiki: pg.title,
      link: pg.fullurl || "https://en.wikipedia.org/wiki/" + encodeURIComponent(pg.title.replace(/ /g, "_")) };
  };
  async function wpSearch(cat, q, { sort = "incoming_links_desc", offset = 0, limit = 40 } = {}) {
    const p = { action: "query", format: "json", formatversion: "2", origin: "*", generator: "search", gsrsearch: q, gsrlimit: Math.min(50, limit), gsrnamespace: 0,
      prop: "pageimages|description|info", piprop: "thumbnail", pilicense: "any", pithumbsize: 320, inprop: "url" };
    if (sort !== "relevance") p.gsrsort = sort;
    if (offset) p.gsroffset = offset;
    const d = await web(WP + new URLSearchParams(p), { json: true });
    return ((d.query || {}).pages || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map((pg) => fromPage(cat, pg)).filter(Boolean);
  }
  async function wpPages(cat, titles) {
    const out = [];
    for (let i = 0; i < titles.length; i += 50) {
      const d = await web(WP + new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", titles: titles.slice(i, i + 50).join("|"), redirects: 1,
        prop: "pageimages|description|info", piprop: "thumbnail", pilicense: "any", pithumbsize: 320, inprop: "url" }), { json: true });
      out.push(...((d.query || {}).pages || []));
    }
    return out;
  }
  // new releases (the last six months) with a Wikipedia article, the most linked-to first
  const TYPES = { book: "wd:Q7725634 wd:Q8261 wd:Q571 wd:Q47461344", comic: "wd:Q725377 wd:Q1004 wd:Q14406742", movie: "wd:Q11424", tv: "wd:Q5398426", animation: "wd:Q202866 wd:Q581714" };
  async function recent(cat) {
    const since = new Date(Date.now() - 183 * 86400e3).toISOString().slice(0, 10);
    const q = `SELECT ?item ?date ?authorLabel ?article ?links WHERE {
      VALUES ?type { ${TYPES[cat] || TYPES.book} } ?item wdt:P31 ?type ; p:P577 ?ds .
      ?ds psv:P577 [ wikibase:timeValue ?date ; wikibase:timePrecision ?prec ] .
      FILTER(?prec >= 10 && ?date >= "${since}T00:00:00Z"^^xsd:dateTime && ?date <= NOW())
      ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . ?item wikibase:sitelinks ?links .
      OPTIONAL { ?item wdt:${cat === "movie" || cat === "tv" || cat === "animation" ? "P57" : "P50"} ?author }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?links) LIMIT 200`;
    const rows = (await web("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { json: true })).results.bindings;
    const by = new Map();
    for (const r of rows) {
      const t = decodeURIComponent(r.article.value.split("/").pop()).replace(/_/g, " ");
      const b = by.get(t) || { t, authors: [], date: r.date.value.slice(0, 10), links: Number(r.links?.value || 0) };
      const a = r.authorLabel?.value; if (a && !/^Q\d+$/.test(a) && !b.authors.includes(a)) b.authors.push(a);
      by.set(t, b);
    }
    const pages = new Map((await wpPages(cat, [...by.keys()])).map((p) => [p.title, p]));
    const out = [];
    for (const b of by.values()) {
      const pg = pages.get(b.t) || { title: b.t };
      const it = fromPage(cat, { ...pg, description: pg.description || ({ book: "book", comic: "comic", movie: "film", tv: "television series", animation: "animated" }[cat]) });
      if (!it) continue;
      out.push({ ...it, authors: b.authors.length ? b.authors : it.authors, year: Number(b.date.slice(0, 4)), released: b.date, links: b.links,
        why: "Out " + new Date(b.date + "T12:00:00").toLocaleDateString([], { month: "short", year: "numeric" }) });
    }
    return out.sort((a, b) => b.links - a.links).slice(0, 80);
  }
  // when Wikidata's query service is busy (it often is): Wikipedia's articles on this year's and last year's releases
  async function recentWP(cat) {
    const y = new Date().getFullYear(), seen = new Set(), out = [];
    const CAT = { book: "novels", comic: "comics debuts", movie: "films", tv: "American television series debuts", animation: "animated films" };
    for (const yy of [y, y - 1]) {
      for (const it of await wpSearch(cat, `incategory:"${yy} ${CAT[cat] || CAT.book}"`, { limit: 50 }).catch(() => [])) {
        if (!seen.has(norm(it.title))) { seen.add(norm(it.title)); out.push({ ...it, year: it.year || yy, why: `Out ${it.year || yy}` }); }
      }
    }
    if (!out.length) throw new Error("The catalogues can't be reached right now.");
    return out;
  }
  const newCache = new Map();
  async function fresh(cat) {
    const hit = newCache.get(cat);
    if (hit && now() - hit.at < 6 * 3600) return hit.items;
    let items;
    try { items = await recent(cat); if (!items.length) throw new Error(""); } catch (e) { items = await recentWP(cat); }
    newCache.set(cat, { at: now(), items });
    return items;
  }
  // manga: AniList
  async function anilist(query, variables) {
    const body = JSON.stringify({ query, variables });
    return (await web("https://graphql.anilist.co", { method: "POST", body, headers: { "Content-Type": "application/json", Accept: "application/json" }, json: true })).data;
  }
  const AL_FIELDS = "id title { romaji english } startDate { year } coverImage { large } description(asHtml: false) averageScore staff(perPage: 2, sort: RELEVANCE) { nodes { name { full } } } siteUrl";
  const fromAL = (m) => ({ title: m.title.english || m.title.romaji, authors: (m.staff?.nodes || []).map((n) => n.name.full), year: m.startDate?.year || null, cover: m.coverImage?.large || "",
    blurb: text1(m.description || "", 400), link: m.siteUrl, al: String(m.id), rating: m.averageScore ? m.averageScore / 10 : null });
  async function manga(sort, search, genre) {
    const d = await anilist(`query ($s: [MediaSort], $q: String, $g: String) { Page(perPage: 40) { media(type: MANGA, sort: $s, search: $q, genre: $g, isAdult: false) { ${AL_FIELDS} } } }`,
      { s: [sort], ...(search ? { q: search } : {}), ...(genre ? { g: genre } : {}) });
    return d.Page.media.map(fromAL);
  }
  const OL = "https://openlibrary.org";
  async function olSearch(q, limit = 30) {
    const d = await web(`${OL}/search.json?` + new URLSearchParams({ q, limit, fields: "key,title,author_name,first_publish_year,cover_i,isbn" }), { json: true });
    return (d.docs || []).filter((x) => x.title).map((x) => ({ title: x.title, authors: (x.author_name || []).slice(0, 3), year: x.first_publish_year || null,
      cover: x.cover_i ? `https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg` : "", isbn: (x.isbn || []).find((i) => i.length === 13) || (x.isbn || [""])[0], link: x.key ? OL + x.key : "" }));
  }
  // what's already on your shelves or wishlist: marked like the computer marks it
  function mark(list) {
    const have = new Map();
    for (const it of Object.values(S.items)) have.set(norm(it.title), it.has_file || it.physical ? "owned" : it.wanted ? "wanted" : "");
    return list.map((r) => ({ ...r, have: r.have || have.get(norm(r.title)) || "" }));
  }
  const MANGA_AISLES = [["trending", "Trending", "TRENDING_DESC"], ["popular", "All-time favourites", "POPULARITY_DESC"], ["Action"], ["Romance"], ["Fantasy"], ["Comedy"], ["Drama"], ["Horror"], ["Mystery"], ["Slice of Life"], ["Sports"]];
  const WP_AISLES = { book: ["Fantasy", "Science fiction", "Mystery", "Thriller", "Romance", "Historical", "Horror", "Biography", "History", "Science"], movie: ["Action", "Comedy", "Drama", "Horror", "Science fiction", "Animated", "Documentary"],
    tv: ["Drama", "Comedy", "Crime", "Science fiction", "Fantasy", "Documentary", "Reality"], comic: ["Superhero", "Fantasy", "Horror", "Science fiction", "Crime"], animation: ["Anime", "Animated film", "Animated series"] };
  const subjects = (cat) => cat === "manga" ? MANGA_AISLES.map(([k, l]) => ({ key: k, label: l || k })) : [{ key: "new", label: "New" }, ...(WP_AISLES[cat] || WP_AISLES.book).map((k) => ({ key: k, label: k }))];

  async function catalogue(what, q) {
    const cat = q.get("cat") || "book";
    if (what === "subjects") return subjects(cat);
    if (what === "promos") return { items: mark(cat === "manga" ? await manga("TRENDING_DESC") : await fresh(cat)) };
    if (what === "browse") {
      const sub = q.get("subject") || "new";
      if (cat === "manga") { const a = MANGA_AISLES.find((x) => x[0] === sub); return { items: mark(await manga(a && a[2] ? a[2] : "POPULARITY_DESC", null, a && a[2] ? null : sub)) }; }
      if (sub === "new" || sub === "trending") return { items: mark(await fresh(cat)) };
      return { items: mark(await wpSearch(cat, `${sub} ${INFOBOX[cat] || INFOBOX.book}`)) };
    }
    if (what === "search") {
      const s = q.get("q") || "";
      if (cat === "manga") return mark(await manga("SEARCH_MATCH", s));
      if (cat === "book") { try { return mark(await olSearch(s)); } catch (e) {} }
      return mark(await wpSearch(cat, `${s} ${INFOBOX[cat] || INFOBOX.book}`, { sort: "relevance", limit: 30 }));
    }
    if (what === "byauthor") return { items: mark(await olSearch(`author:"${q.get("name") || ""}"`, 60)) };
    if (what === "info") {
      const t = q.get("wiki") || q.get("title");
      try {
        const d = await web(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, "_"))}`, { json: true });
        return { intro: d.extract || "", links: d.content_urls ? [{ label: "Wikipedia", url: d.content_urls.mobile?.page || d.content_urls.desktop.page }] : [] };
      } catch (e) { return {}; }
    }
    if (what === "reviews" || what === "series" || what === "authors") return what === "reviews" ? {} : { items: [] };
    throw new Error("");
  }

  /* ---------------- things only the computer can do: kept until it's reached ---------------- */
  const QUEUE = /^\/sync\/(cat\/wish|news\/save|news\/place)$/;
  function queue(method, path, body) {
    const q = load("netqueue.json", []);
    q.push({ method, path, body, at: now() });
    store("netqueue.json", q.slice(-200));
  }
  async function flush() {
    const q = load("netqueue.json", []);
    if (!q.length) return;
    const left = [];
    for (const x of q) {
      if (left.length) { left.push(x); continue; }
      const r = await bridge("request", x.method, x.path, JSON.stringify(x.body || {}));
      if (!r.status) left.push(x);
    }
    store("netqueue.json", left);
    // the wishes kept here meanwhile: the computer's real ones arrive with the next sync
    if (left.length < q.length) { for (const [id, it] of Object.entries(S.items)) if (it._local) delete S.items[id]; saveLibrary(true); setTimeout(() => sync(), 500); }
  }

  /* the computer couldn't be reached (or this phone isn't paired): answer here if this is something the web can answer */
  const handles = (method, path) => /^\/sync\/(news\/(science|local|article)|cat\/(promos|browse|subjects|search|byauthor|info|reviews|series|authors)|potd|define)\b/.test(path) || (method === "POST" && QUEUE.test(path.split("?")[0]));
  async function answer(method, path, body) {
    const [p, qs] = path.split("?"), q = new URLSearchParams(qs || ""), fresh = q.has("fresh");
    if (method === "POST" && p === "/sync/news/place") return setPlace(body || {});
    if (method === "POST" && QUEUE.test(p)) {
      queue(method, p, body);
      if (p === "/sync/cat/wish") wishHere(body);
      return { ok: true, queued: true };
    }
    try {
      let d;
      if (p === "/sync/news/science") d = await science(fresh);
      else if (p === "/sync/news/local") d = await local(fresh);
      else if (p === "/sync/news/article") d = await article(q.get("url") || "");
      else if (p === "/sync/potd") d = await potd();
      else if (p === "/sync/define") d = await define(q.get("w") || "");
      else d = await catalogue(p.split("/").pop(), q);
      return d;
    } catch (e) {
      const kept = recalled(path);
      if (kept) return p === "/sync/news/local" ? { ...kept, place: place().county ? place() : kept.place } : kept;
      if (p === "/sync/news/local" && !place().county) return { place: place(), sections: [] };
      throw new Error(e.message || (UA_OK ? "Can't reach the internet right now." : "This needs your computer (it isn't reachable right now)."));
    }
  }
  // a wish made while the computer is off: on this phone's wishlist straight away (the computer adds it for real)
  function wishHere(r) {
    const id = -Date.now();
    S.items[id] = { id, title: r.title, authors: r.authors || [], year: r.year, kind: { manga: "graphic", comic: "graphic", movie: "movie", tv: "tv" }[r.cat] || "book", wanted: 1, has_file: 0, has_cover: 0, added_at: now(), _local: true };
    saveLibrary(true);
  }
  /* the readers' dictionary straight from Wiktionary (each word kept on the phone once looked up, for offline) */
  async function define(word) {
    word = word.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").slice(0, 60);
    const kept = load("dictionary.json", {});
    if (kept[word.toLowerCase()]) return kept[word.toLowerCase()];
    const strip = (h) => { const el = document.createElement("div"); el.innerHTML = h || ""; return el.textContent.replace(/\s+/g, " ").trim(); };
    const url = (w) => "https://en.wiktionary.org/wiki/" + encodeURIComponent(w.replace(/ /g, "_"));
    let out = { word, senses: [], url: url(word) };
    for (const w of [...new Set([word.toLowerCase(), word, word[0].toUpperCase() + word.slice(1)])]) {
      let data;
      try { data = await web("https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(w.replace(/ /g, "_")), { json: true }); }
      catch (e) { if (/404/.test(e.message)) continue; throw e; }
      const senses = (data.en || []).slice(0, 4).map((sec) => ({ pos: sec.partOfSpeech || "", defs: (sec.definitions || []).map((d) => ({ d: strip(d.definition).slice(0, 400),
        ex: strip(((d.parsedExamples || [])[0] || {}).example || (d.examples || [])[0] || "").slice(0, 240) })).filter((x) => x.d).slice(0, 4) })).filter((s) => s.defs.length);
      const real = senses.filter((s) => s.pos !== "Symbol");          // (language codes and the like, only if there's nothing else)
      if (senses.length) { out = { word: w, senses: real.length ? real : senses, url: url(w) }; break; }
    }
    const keys = Object.keys(kept);
    if (keys.length > 400) delete kept[keys[0]];
    kept[word.toLowerCase()] = out;
    store("dictionary.json", kept);
    return out;
  }
  async function potd() {
    const d = new Date(), iso = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    const feed = await web(`https://en.wikipedia.org/api/rest_v1/feed/featured/${iso}`, { json: true });
    const f = feed.image, a = feed.tfa, out = {};
    if (f) Object.assign(out, { img: (f.thumbnail || f.image || {}).source, title: f.title, desc: text1(f.description?.text || "", 200), artist: text1(f.artist?.text || "", 60), license: f.license?.type || "", page: f.file_page });
    if (a && a.extract) out.article = { title: a.titles?.normalized || a.title || "", about: a.description || "", text: a.extract.slice(0, 1400), img: a.thumbnail?.source || "", page: a.content_urls?.mobile?.page || "" };
    try { out.quote = await quoteOfTheDay(d); } catch (e) {}
    return out;
  }
  /* Wikiquote's quote of the day: {text, by, page} */
  async function quoteOfTheDay(d) {
    const page = `Wikiquote:Quote_of_the_day/${d.toLocaleString("en-US", { month: "long" })}_${d.getDate()},_${d.getFullYear()}`;
    const r = await web("https://en.wikiquote.org/w/api.php?" + new URLSearchParams({ action: "parse", page, prop: "text", format: "json", formatversion: 2, origin: "*" }), { json: true });
    const doc = new DOMParser().parseFromString(r.parse.text, "text/html");
    const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    const m = /“\s*(.+?)\s*”\s*[—–]\s*(.+?)\s*$/s.exec(text);
    if (!m) return null;
    const q = m[1];
    return { text: q.slice(0, 900), by: m[2].slice(0, 120), page: "https://en.wikiquote.org/wiki/" + encodeURIComponent(m[2].replace(/ /g, "_")) };
  }

  return { handles, answer, remember, flush };
})();
