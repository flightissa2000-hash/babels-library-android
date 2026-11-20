/* The library's two layouts (the 📌 | ▤ switch in the library's header): a corkboard of pinned polaroids, and a
   sortable table. Each is handed the same cards (a series is one card: its next volume, with the series' count) and
   their group labels; a card opens its item (data-item) or its series (data-lay-series). */
const LibLayouts = window.LibLayouts = (() => {
  const LIST = [["cork", "Corkboard", "Pinned polaroids with stamps", "📌"], ["table", "Table", "A sortable table: tap a heading to sort by it", "▤"]];
  const has = (k) => LIST.some((l) => l[0] === k);
  const cur = () => (has(S.libLayout) ? S.libLayout : "cork");

  const st = (it) => W.status(it);             // ["new"|"now"|"done"|"hold"|"dropped", label]
  const title = (it, s) => (s ? it.series : it.kind === "tv" ? it.series || it.title : it.title) || "Untitled";
  const sub = (it, s) => (s ? `${s.n} in the series · next: ${it.series_index ? "#" + +it.series_index + " " : ""}${it.title || ""}` : byline(it) || "");
  const open = (it, s) => (s ? `data-lay-series="${it.id}"` : `data-item="${it.id}"`);
  const bar = (it) => { const p = pct(it); return p > 1 ? `<span class="ll-bar"><i style="width:${p}%"></i></span>` : ""; };
  const groupsOf = (flat, labels) => { const g = []; flat.forEach((it, i) => { const l = labels[i] || ""; if (!g.length || g[g.length - 1][0] !== l) g.push([l, []]); g[g.length - 1][1].push(it); }); return g; };
  const hsh = (x) => { let h = 0; for (const c of String(x)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const named = (it, s) => esc(title(it, s)) + (s ? ` <i class="ll-sn">${s.n}</i>` : "");
  const no = (n) => String(n).padStart(3, "0");

  const R = {
    table(flat, labels, stacks) {
      const k = S.libTableSort || "", dir = S.libTableDir || 1;
      const cols = [["title", "Title"], ["year", "Year"], ["status", "Status"], ["progress", "%"]];
      const val = (it) => ({ title: title(it, stacks[it.id]).toLowerCase(), year: parseInt(it.year) || 0, status: st(it)[0], progress: pct(it) })[k];
      const rows = (list) => (k ? [...list].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; }) : list);
      return `<div class="ll ll-table"><div class="lq-head">${cols.map(([c, n]) => `<button data-lq-sort="${c}" class="${k === c ? "on" : ""}">${n}${k === c ? (dir > 0 ? " ▲" : " ▼") : ""}</button>`).join("")}</div>
        ${groupsOf(flat, labels).map(([g, list]) => `<h3>${esc(g || "Everything")}<small>${list.length}</small></h3>${rows(list).map((it) => { const s = stacks[it.id], [sk, lab] = st(it), p = sk === "done" ? 100 : pct(it);
          return `<button class="lq-row" ${open(it, s)}><span class="lq-t"><b>${named(it, s)}</b><small>${esc(byline(it) || "")}</small></span><span class="lq-y">${esc(it.year || "")}</span><span class="lq-s s-${sk}">${sk === "new" ? "" : esc(lab)}</span><span class="lq-p">${p ? p + "%" : ""}</span></button>`; }).join("")}`).join("")}</div>`;
    },
    cork(flat, labels, stacks) {
      const pins = ["#d9534f", "#f0ad4e", "#5bc0de", "#5cb85c"];
      return `<div class="ll ll-cork">${groupsOf(flat, labels).map(([g, list]) => `<h3 class="lc-tape">${esc(g || "Everything")}</h3><div class="lc-pins">${list.map((it) => {
        const s = stacks[it.id], k = st(it)[0];
        return `<button class="lc-pol" ${open(it, s)} style="--r:${(hsh(it.id + "r") % 9) - 4}deg;--pin:${pins[hsh(it.id) % 4]}"><span class="lc-photo">${cover(it, false)}</span><span class="lc-scrawl">${named(it, s)}</span>${k === "done" ? `<span class="lc-stamp">READ</span>` : k === "next" ? `<span class="lc-stamp next">NEXT</span>` : ""}</button>`;
      }).join("")}</div>`).join("")}</div>`;
    },
  };

  function html(flat, labels, stacks) {
    const k = cur();
    const lim = S.limit || 60, cut = flat.length > lim;
    const shown = cut ? flat.slice(0, lim) : flat;
    return R[k](shown, labels.slice(0, shown.length), stacks) + (cut ? `<button class="btn more" id="more">Show more (${flat.length - lim} more)</button>` : "");
  }
  // the switch in the header: 📌 corkboard | ▤ table
  const compass = () => `<span class="lh-lay" role="group" aria-label="Layout">${LIST.map(([k, n, d, z]) => `<button data-lay="${k}" class="${cur() === k ? "on" : ""}" aria-label="${esc(n)}" title="${esc(n)}">${z}</button>`).join("")}</span>`;
  document.addEventListener("click", (e) => {
    const t = e.target;
    const sr = t.closest("[data-lay-series]");
    if (sr) { const s = Deck.stacks[sr.dataset.laySeries]; if (s) Deck.openSeries(s); return; }
    const ly = t.closest("[data-lay]"); if (ly) { S.libLayout = ly.dataset.lay; saveState(); return render(); }
    const ts = t.closest("[data-lq-sort]"); if (ts) { const k = ts.dataset.lqSort; S.libTableDir = S.libTableSort === k ? -(S.libTableDir || 1) : 1; S.libTableSort = k; return render(); }
  });
  return { LIST, html, compass, cur };
})();

/* sky.js (shared with the computer) speaks the computer's helpers: these are the phone's versions of them */
window.seriesTogether ||= (items) => {
  const by = new Map();
  for (const it of items) if (inSeries(it)) { const k = seriesKey(it.series); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
  const out = [], done = new Set();
  for (const it of items) { if (!inSeries(it)) { out.push(it); continue; } const k = seriesKey(it.series); if (done.has(k)) continue; done.add(k); out.push(...by.get(k).sort(seriesOrder)); }
  return out;
};
window.seriesRuns ||= (items) => { const runs = []; for (const it of items) { const l = runs[runs.length - 1]; if (l && inSeries(it) && inSeries(l[0]) && seriesKey(l[0].series) === seriesKey(it.series)) l.push(it); else runs.push([it]); } return runs; };
window.lvStatus ||= (it) => { const [k, w] = W.status(it); return { k: k === "now" ? "reading" : k === "dropped" ? "hold" : k, w: k === "new" ? "" : w }; };
window.pctOf ||= (it) => pct(it);
window.coverHTML ||= (it) => cover(it, false);
window.authorLine ||= (it) => byline(it) || "";
window.openDrawer ||= (id) => openSheet(id);
