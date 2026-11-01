/* The library's layouts (Library → Layout): the fan deck, three plain ones and seven playful ones that borrow the look
   of game menus, manga pages and anime. Each one is handed the same cards (a series is one card: its next volume, with
   the series' count) and their group labels; a card opens its item (data-item) or its series (data-lay-series). */
const LibLayouts = window.LibLayouts = (() => {
  const LIST = [
    ["deck", "Fan deck", "Paper cards pinned at one corner, flipped one at a time", ""],
    ["shelves", "Shelves", "Covers on shelves by group, like the computer", ""],
    ["list", "List", "One line each: cover, title, where you are", ""],
    ["mosaic", "Mosaic", "Just the covers, packed tight", ""],
    ["inventory", "Inventory", "A survival-game backpack: every book an item, rarer the further you've got", "🎒"],
    ["dex", "Field guide", "A pocket monster-catcher's encyclopedia: numbered entries, seen and caught", "📕"],
    ["panels", "Manga page", "Panels, screentone and speech bubbles, read right to left", "💥"],
    ["jrpg", "RPG menu", "A blue-window party menu with a pointing cursor and level bars", "⚔️"],
    ["gacha", "Gacha", "Starred character cards with a holo shine, and a Summon button", "✨"],
    ["vn", "Visual novel", "One at a time, centre stage, with a dialogue box and choices", "💬"],
    ["levels", "World map", "A platformer's level map: each book a stage on a winding path", "🍄"],
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
    mosaic(flat, labels, stacks) {
      return `<div class="ll ll-mosaic">${flat.map((it) => { const s = stacks[it.id]; return `<button class="ll-tile st-${st(it)[0]}" ${open(it, s)} title="${esc(title(it, s))}">${cover(it, false)}${s ? `<i class="ll-n">${s.n}</i>` : ""}${bar(it)}</button>`; }).join("")}</div>`;
    },
    // a backpack grid: the further you've got, the rarer the item (common → uncommon → rare → legendary)
    inventory(flat, labels, stacks) {
      const rar = (it) => { const k = st(it)[0], p = pct(it); return k === "done" ? ["leg", "Legendary"] : p >= 50 ? ["rare", "Rare"] : k === "now" ? ["unc", "Uncommon"] : k === "dropped" ? ["junk", "Junk"] : ["com", "Common"]; };
      const done = flat.filter((it) => st(it)[0] === "done").length;
      return `<div class="ll ll-inv"><div class="inv-head"><b>INVENTORY</b><span>${flat.length} items · ${done} legendary</span><span class="inv-gold">◈ ${flat.length * 25 + done * 100}</span></div>
        <div class="inv-grid">${flat.map((it) => { const s = stacks[it.id], [r, rl] = rar(it); return `<button class="inv-slot r-${r}" ${open(it, s)}>${cover(it, false)}${s ? `<i class="inv-q">×${s.n}</i>` : ""}
          <span class="inv-tip"><b>${esc(title(it, s))}</b><em>${rl}</em></span></button>`; }).join("")}</div></div>`;
    },
    // a monster-catcher's field guide: numbered entries; seen = on your shelves, caught = finished
    dex(flat, labels, stacks) {
      const caught = flat.filter((it) => st(it)[0] === "done").length;
      return `<div class="ll ll-dex"><div class="dex-top"><i class="dex-lens"></i><i class="dex-led r"></i><i class="dex-led y"></i><i class="dex-led g"></i></div>
        <div class="dex-screen"><div class="dex-count"><span>SEEN <b>${flat.length}</b></span><span>CAUGHT <b>${caught}</b></span></div>
        ${flat.map((it, i) => { const s = stacks[it.id], k = st(it)[0]; return `<button class="dex-row ${k === "done" ? "caught" : ""}" ${open(it, s)}><span class="dex-no">No.${no(i + 1)}</span>
          <span class="dex-spr">${cover(it, false)}</span><span class="dex-name">${esc(title(it, s))}</span><span class="dex-ball">${k === "done" ? "●" : k === "now" ? "◐" : "○"}</span></button>`; }).join("")}</div></div>`;
    },
    // a manga page: panels of different sizes, screentone, a speech bubble for each title, read right to left
    panels(flat, labels, stacks) {
      const fx = ["ドン!", "ゴゴゴ", "バン!", "ザワ…", "キラ", "ドキ!"];
      return `<div class="ll ll-manga">${flat.map((it, i) => { const s = stacks[it.id], k = st(it)[0];
        return `<button class="mg-panel p${i % 7}" ${open(it, s)}>${cover(it, false)}<span class="mg-bubble">${esc(title(it, s))}</span>${k === "now" ? `<span class="mg-fx">${fx[i % fx.length]}</span>` : k === "done" ? `<span class="mg-fx done">完</span>` : ""}</button>`; }).join("")}</div>`;
    },
    // a JRPG party menu: blue windows, a pointing cursor, levels and HP bars
    jrpg(flat, labels, stacks) {
      return `<div class="ll ll-jrpg"><div class="rpg-win rpg-head"><span>ITEMS</span><span>${flat.length}</span><span class="rpg-gil">${flat.filter((it) => st(it)[0] === "done").length * 120} G</span></div>
        <div class="rpg-win rpg-list">${flat.map((it) => { const s = stacks[it.id], p = pct(it); return `<button class="rpg-row" ${open(it, s)}><span class="rpg-cur">▶</span><span class="rpg-ic">${cover(it, false)}</span>
          <span class="rpg-name">${esc(title(it, s))}</span><span class="rpg-lv">Lv ${Math.max(1, Math.round(p))}</span><span class="rpg-hp"><i style="width:${Math.max(4, p)}%"></i></span>${s ? `<span class="rpg-x">×${s.n}</span>` : ""}</button>`; }).join("")}</div></div>`;
    },
    // gacha: starred character cards (stars by how far along), a holo sweep, and a Summon that pulls something unread
    gacha(flat, labels, stacks) {
      const stars = (it) => { const k = st(it)[0], p = pct(it); return k === "done" ? 5 : p >= 50 ? 4 : k === "now" ? 3 : 2; };
      return `<div class="ll ll-gacha"><div class="gc-bar"><b>BANNER: YOUR SHELVES</b><button class="gc-pull" data-gacha-pull>✦ Summon ×1</button></div>
        <div class="gc-grid">${flat.map((it) => { const s = stacks[it.id], n = stars(it); return `<button class="gc-card s${n}" ${open(it, s)} data-gc="${it.id}"><span class="gc-art">${cover(it, false)}</span><span class="gc-holo"></span>
          <span class="gc-stars">${"★".repeat(n)}</span><b>${esc(title(it, s))}</b></button>`; }).join("")}</div></div>`;
    },
    // a visual novel: one at a time, the cover centre stage, a dialogue box, and choices
    vn(flat, labels, stacks) {
      const i = Math.min(flat.length - 1, Math.max(0, S.vnI || 0)), it = flat[i], s = stacks[it.id], k = st(it)[0];
      const who = (it.authors || [])[0] || it.album_artist || "Narrator";
      const said = (it.summary || "").trim() || (k === "done" ? "We've been through this story together already… want to go again?" : k === "now" ? "You left off partway. Shall we pick up where we stopped?" : "We haven't met yet. I've been waiting on your shelf for a while, you know.");
      return `<div class="ll ll-vn"><div class="vn-bg">${cover(it, false)}</div><div class="vn-sprite">${cover(it, false)}</div>
        <div class="vn-box"><span class="vn-name">${esc(who)}</span><b class="vn-title">${esc(title(it, s))}</b><p>${esc(said.length > 260 ? said.slice(0, 257) + "…" : said)}</p>
          <div class="vn-choices"><button ${open(it, s)}>▶ ${k === "now" ? "Continue" : k === "done" ? "Read again" : "Begin"}</button><button data-vn="-1" ${i === 0 ? "disabled" : ""}>‹ Back</button><button data-vn="1" ${i >= flat.length - 1 ? "disabled" : ""}>Next ›</button></div>
          <small class="vn-n">${i + 1} / ${flat.length}</small></div></div>`;
    },
    // a platformer's world map: each group a world, each book a stage on a winding dotted path
    levels(flat, labels, stacks) {
      return `<div class="ll ll-map">${groupsOf(flat, labels).map(([g, list], w) => `<section class="wm-world"><h3>WORLD ${w + 1}<small>${esc(g || "Everything")}</small></h3>
        <div class="wm-path">${list.map((it, i) => { const s = stacks[it.id], k = st(it)[0]; return `<button class="wm-node ${k} ${i % 2 ? "dn" : "up"}" ${open(it, s)}><span class="wm-cov">${cover(it, false)}</span>${k === "done" ? `<i class="wm-flag">⚑</i>` : k === "now" ? `<i class="wm-you">★</i>` : ""}
          <small>${w + 1}-${i + 1}</small><b>${esc(title(it, s))}</b></button>`; }).join("")}<span class="wm-castle">🏰</span></div></section>`).join("")}</div>`;
    },
  };

  function html(flat, labels, stacks) {
    const k = cur();
    if (k === "deck") return null;            // (the deck draws itself)
    const lim = S.limit || 60, cut = k !== "vn" && flat.length > lim;
    const shown = cut ? flat.slice(0, lim) : flat;
    return R[k](shown, labels.slice(0, shown.length), stacks) + (cut ? `<button class="btn more" id="more">Show more (${flat.length - lim} more)</button>` : "");
  }
  const picker = () => `<label class="ll-pick"><span>Layout</span><select id="libLayout">${LIST.map(([k, n, , z]) => `<option value="${k}" ${cur() === k ? "selected" : ""}>${z ? z + " " : ""}${esc(n)}</option>`).join("")}</select></label>`;

  document.addEventListener("change", (e) => { if (e.target.id === "libLayout") { S.libLayout = e.target.value; S.vnI = 0; saveState(); render(); } });
  document.addEventListener("click", (e) => {
    const t = e.target;
    const sr = t.closest("[data-lay-series]");
    if (sr) { const s = Deck.stacks[sr.dataset.laySeries]; if (s) Deck.openSeries(s); return; }
    const v = t.closest("[data-vn]"); if (v) { S.vnI = Math.max(0, (S.vnI || 0) + Number(v.dataset.vn)); return render(); }
    if (t.closest("[data-gacha-pull]")) {        // a pull: something you haven't started, with a flash
      const cards = [...document.querySelectorAll(".gc-card")], fresh = cards.filter((c) => !c.classList.contains("s5") && !c.classList.contains("s4") && !c.classList.contains("s3"));
      const pick = (fresh.length ? fresh : cards)[Math.floor(Math.random() * (fresh.length || cards.length))];
      if (!pick) return;
      document.querySelectorAll(".gc-card.pulled").forEach((c) => c.classList.remove("pulled"));
      pick.scrollIntoView({ block: "center", behavior: "smooth" });
      pick.classList.add("pulled");
      toast("✦ You pulled: " + pick.querySelector("b").textContent);
    }
  });
  return { LIST, html, picker, cur };
})();
