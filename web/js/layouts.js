/* The library's layouts (the compass at the end of the kinds row): the fan deck, shelves, a list, a manga page and
   gacha cards. Each one is handed the same cards (a series is one card: its next volume, with
   the series' count) and their group labels; a card opens its item (data-item) or its series (data-lay-series). */
const LibLayouts = window.LibLayouts = (() => {
  const LIST = [
    ["deck", "Fan deck", "Paper cards pinned at one corner, flipped one at a time", "🃏"],
    ["shelves", "Shelves", "Covers on shelves by group, like the computer", "📚"],
    ["list", "List", "One line each: cover, title, where you are", "☰"],
    ["panels", "Manga page", "Panels, screentone and speech bubbles, read right to left", "💥"],
    ["gacha", "Gacha", "Character cards with a holo shine, a progress bar each, and a Summon button", "✨"],
  ];
  const has = (k) => LIST.some((l) => l[0] === k);
  const cur = () => (has(S.libLayout) ? S.libLayout : document.documentElement.classList.contains("dex") ? "shelves" : "deck");

  const st = (it) => W.status(it);             // ["new"|"now"|"done"|"hold"|"dropped", label]
  const title = (it, s) => (s ? it.series : it.kind === "tv" ? it.series || it.title : it.title) || "Untitled";
  const sub = (it, s) => (s ? `${s.n} in the series · next: ${it.series_index ? "#" + +it.series_index + " " : ""}${it.title || ""}` : byline(it) || "");
  const open = (it, s) => (s ? `data-lay-series="${it.id}"` : `data-item="${it.id}"`);
  const bar = (it) => { const p = pct(it); return p > 1 ? `<span class="ll-bar"><i style="width:${p}%"></i></span>` : ""; };
  const groupsOf = (flat, labels) => { const g = []; flat.forEach((it, i) => { const l = labels[i] || ""; if (!g.length || g[g.length - 1][0] !== l) g.push([l, []]); g[g.length - 1][1].push(it); }); return g; };
  const no = (n) => String(n).padStart(3, "0");

  const R = {
    shelves(flat, labels, stacks) {
      return `<div class="ll ll-shelves">${groupsOf(flat, labels).map(([g, list]) => `<section><h3>${esc(g || "Everything")}<small>${list.length}</small></h3><div class="ll-grid">${list.map((it) => {
        const s = stacks[it.id], [k, lab] = st(it);
        return `<button class="ll-card st-${k} ${s ? "stack" : ""}" ${open(it, s)}><span class="ll-cov">${cover(it, false)}${s ? `<i class="ll-n">${s.n}</i>` : ""}</span>${bar(it)}
          <b>${esc(title(it, s))}</b><small>${esc(sub(it, s))}</small>${k !== "new" ? `<em class="ll-st">${esc(lab)}</em>` : ""}</button>`;
      }).join("")}</div></section>`).join("")}</div>`;
    },
    list(flat, labels, stacks) {
      return `<div class="ll ll-list">${groupsOf(flat, labels).map(([g, list]) => `<h3>${esc(g || "Everything")}<small>${list.length}</small></h3>${list.map((it) => {
        const s = stacks[it.id], [k, lab] = st(it), p = pct(it);
        return `<button class="ll-row st-${k}" ${open(it, s)}><span class="ll-cov">${cover(it, false)}</span><span class="ll-t"><b>${esc(title(it, s))}</b><small>${esc(sub(it, s))}</small></span>
          <span class="ll-r">${k !== "new" ? `<em>${esc(lab)}</em>` : ""}${p > 1 && p < 98 ? `<small>${p}%</small>` : ""}</span></button>`;
      }).join("")}`).join("")}</div>`;
    },
    // a manga page: panels of different sizes, screentone, a speech bubble for each title, read right to left
    panels(flat, labels, stacks) {
      const fx = ["ドン!", "ゴゴゴ", "バン!", "ザワ…", "キラ", "ドキ!"];
      return `<div class="ll ll-manga">${flat.map((it, i) => { const s = stacks[it.id], k = st(it)[0];
        return `<button class="mg-panel p${i % 7}" ${open(it, s)}>${cover(it, false)}<span class="mg-bubble">${esc(title(it, s))}</span>${k === "now" ? `<span class="mg-fx">${fx[i % fx.length]}</span>` : k === "done" ? `<span class="mg-fx done">完</span>` : ""}</button>`; }).join("")}</div>`;
    },
    // gacha: character cards (a rarer frame the further you've got), a progress bar, a holo sweep, and a Summon that pulls something unstarted
    gacha(flat, labels, stacks) {
      const tier = (it) => { const k = st(it)[0], p = pct(it); return k === "done" ? 5 : p >= 50 ? 4 : k === "now" || p > 1 ? 3 : 2; };
      return `<div class="ll ll-gacha"><div class="gc-bar"><b>BANNER: YOUR SHELVES</b><button class="gc-pull" data-gacha-pull>✦ Summon ×1</button></div>
        <div class="gc-grid">${flat.map((it) => { const s = stacks[it.id], n = tier(it), p = st(it)[0] === "done" ? 100 : Math.round(pct(it)); return `<button class="gc-card s${n}" ${open(it, s)} data-gc="${it.id}"><span class="gc-art">${cover(it, false)}</span><span class="gc-holo"></span>
          <span class="gc-prog"><i style="width:${p}%"></i><em>${p ? p + "%" : "NEW"}</em></span><b>${esc(title(it, s))}</b></button>`; }).join("")}</div></div>`;
    },
  };

  function html(flat, labels, stacks) {
    const k = cur();
    if (k === "deck") return null;            // (the deck draws itself)
    const lim = S.limit || 60, cut = flat.length > lim;
    const shown = cut ? flat.slice(0, lim) : flat;
    return R[k](shown, labels.slice(0, shown.length), stacks) + (cut ? `<button class="btn more" id="more">Show more (${flat.length - lim} more)</button>` : "");
  }
  // the compass: a round button at the end of the kinds row, opening the list of layouts
  const compass = () => `<span class="ll-compass"><button id="libCompass" aria-label="Layout" title="Layout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3z" fill="currentColor" stroke-linejoin="round"/></svg></button>
    <span class="ll-menu" hidden>${LIST.map(([k, n, d, z]) => `<button data-lay="${k}" class="${cur() === k ? "on" : ""}"><i>${z}</i><span><b>${esc(n)}</b><small>${esc(d)}</small></span></button>`).join("")}</span></span>`;
  document.addEventListener("click", (e) => {
    const t = e.target;
    const sr = t.closest("[data-lay-series]");
    if (sr) { const s = Deck.stacks[sr.dataset.laySeries]; if (s) Deck.openSeries(s); return; }
    if (t.closest("#libCompass")) { const m = document.querySelector(".ll-menu"); if (m) m.hidden = !m.hidden; return; }
    const ly = t.closest("[data-lay]"); if (ly) { S.libLayout = ly.dataset.lay; saveState(); return render(); }
    if (!t.closest(".ll-menu")) document.querySelectorAll(".ll-menu").forEach((m) => (m.hidden = true));
    if (t.closest("[data-gacha-pull]")) {        // a pull: something you haven't started, with a flash
      const cards = [...document.querySelectorAll(".gc-card")], fresh = cards.filter((c) => c.classList.contains("s2"));
      const pick = (fresh.length ? fresh : cards)[Math.floor(Math.random() * (fresh.length || cards.length))];
      if (!pick) return;
      document.querySelectorAll(".gc-card.pulled").forEach((c) => c.classList.remove("pulled"));
      pick.scrollIntoView({ block: "center", behavior: "smooth" });
      pick.classList.add("pulled");
      toast("✦ You pulled: " + pick.querySelector("b").textContent);
    }
  });
  return { LIST, html, compass, cur };
})();
