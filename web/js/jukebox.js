/* Music on the phone: a jukebox. Albums are its selection strips (one per album, not every song), and a player that
   keeps going while you use the rest of the app: a little bar at the bottom, and the full jukebox window with the
   record turning, shuffle, repeat (all or one) and a queue you can rearrange. Songs on the phone play from the phone;
   the rest stream from the computer when it can be reached. */
const Jukebox = (() => {
  const J = { tracks: [], order: [], pos: 0, shuffle: false, repeat: "off", ...load("jukebox.json", {}) };
  const audio = new Audio();
  audio.preload = "auto";
  let albumsNow = [];
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const keep = () => store("jukebox.json", { tracks: J.tracks, order: J.order, pos: J.pos, shuffle: J.shuffle, repeat: J.repeat });
  const cur = () => S.items[J.tracks[J.order[J.pos]]];
  const shuffled = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const albumKey = (it) => `${(it.album_artist || (it.authors || [])[0] || "Unknown artist").toLowerCase()}|${(it.album || "Singles").toLowerCase()}`;
  const trackOrder = (x, y) => (x.disc || 1) - (y.disc || 1) || (x.track || 999) - (y.track || 999) || String(x.title).localeCompare(String(y.title));

  function albums(items) {
    const m = new Map();
    for (const it of items) {
      if (it.kind !== "music") continue;
      const k = albumKey(it);
      if (!m.has(k)) m.set(k, { key: k, title: it.album || "Singles", artist: it.album_artist || (it.authors || [])[0] || "Unknown artist", year: it.year, tracks: [] });
      const a = m.get(k);
      a.tracks.push(it);
      if (it.has_cover && !a.cover) a.cover = it;
      a.year = a.year || it.year;
    }
    for (const a of m.values()) a.tracks.sort(trackOrder);
    return [...m.values()];
  }
  const playable = (it) => onPhone(it) || !!S.conn.token;

  /* ---------------- the jukebox in the Music area: albums as selection strips, grouped like the library ---------------- */
  function html(groups) {
    const seen = new Set();
    albumsNow = [];
    const sections = [];
    groups.forEach(([name, items], gi) => {
      const list = albums(items).filter((a) => !seen.has(a.key));
      list.forEach((a) => seen.add(a.key));
      if (!list.length) return;
      const letter = String.fromCharCode(65 + (sections.length % 26));
      sections.push(`<div class="jx-row"><span class="jx-rowname"><b>${letter}</b>${esc(name)}</span>${list.map((a, i) => {
        albumsNow.push(a);
        const here = a.tracks.filter(onPhone).length;
        return `<button class="jx-strip" data-jx-album="${albumsNow.length - 1}"><span class="jx-code">${letter}${i + 1}</span>
          <span class="jx-art">${a.cover ? cover(a.cover, false) : `<span class="jx-vinyl"></span>`}</span>
          <span class="jx-t"><b>${esc(a.title)}</b><small>${esc(a.artist)}${a.year ? " · " + esc(a.year) : ""}</small><small>${a.tracks.length} ${a.tracks.length === 1 ? "song" : "songs"}${here && here < a.tracks.length ? ` · ${here} on this phone` : here ? " · on this phone" : ""}</small></span>
          <span class="jx-go" data-jx-playalbum="${albumsNow.length - 1}" aria-label="Play">▶</span></button>`;
      }).join("")}</div>`);
    });
    return `<div class="jukebox"><div class="jx-arch"><span class="jx-neon"></span><b>BABEL</b><small>SELECT-A-SONG</small></div>
      <div class="jx-window" id="jxWindow">${windowHtml()}</div>
      <div class="jx-dial"><button class="btn" data-jx-all>⤨ Shuffle everything</button><button class="btn" data-jx-open>☰ Now playing</button></div>
      <div class="jx-cards">${sections.join("") || `<p class="empty">No music yet.</p>`}</div><div class="jx-grille"></div></div>`;
  }
  function windowHtml() {
    const t = cur();
    if (!t) return `<div class="jx-idle">Pick a record below, or ⤨ shuffle everything</div>`;
    return `<span class="jx-rec ${audio.paused ? "" : "spin"}">${t.has_cover ? cover(t, false) : ""}</span>
      <span class="jx-np"><small>NOW PLAYING</small><b>${esc(t.title)}</b><small>${esc([t.album_artist || (t.authors || [])[0], t.album].filter(Boolean).join(" · "))}</small></span>
      <span class="jx-mini">${controls()}</span>`;
  }
  const controls = (big) => `<button class="jx-b ${J.shuffle ? "on" : ""}" data-jx="shuffle" aria-label="Shuffle">⤨</button><button class="jx-b" data-jx="prev" aria-label="Previous">⏮</button>
    <button class="jx-b jx-play" data-jx="toggle" aria-label="Play or pause">${audio.paused ? "▶" : "❚❚"}</button><button class="jx-b" data-jx="next" aria-label="Next">⏭</button>
    <button class="jx-b ${J.repeat !== "off" ? "on" : ""}" data-jx="repeat" aria-label="Repeat">${J.repeat === "one" ? "🔂" : "🔁"}</button>${big ? "" : ""}`;

  /* an album: its songs, play / shuffle / play next / add to queue */
  function openAlbum(a) {
    const sh = $("#sheet");
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(a.title)}</h2></div>
      <div class="it-body jx-album"><div class="jx-ahead"><span class="jx-art big">${a.cover ? cover(a.cover, false) : `<span class="jx-vinyl"></span>`}</span>
        <div><h3>${esc(a.title)}</h3><p class="hint">${esc(a.artist)}${a.year ? " · " + esc(a.year) : ""} · ${a.tracks.length} songs</p>
        <div class="btns"><button class="btn primary" data-jx-a="play">▶ Play</button><button class="btn" data-jx-a="shuffle">⤨ Shuffle</button></div>
        <div class="btns"><button class="btn sm" data-jx-a="next">Play next</button><button class="btn sm" data-jx-a="queue">＋ Queue</button></div></div></div>
        <ol class="jx-tracks">${a.tracks.map((t, i) => `<li class="${playable(t) ? "" : "off"}"><button class="jx-trk" data-jx-t="${i}"><span class="tn">${t.track || i + 1}</span><span class="tt">${esc(t.title)}</span><span class="td">${t.duration ? fmt(t.duration) : ""}${onPhone(t) ? " 📱" : ""}</span></button>
          <button class="jx-q" data-jx-tq="${i}" aria-label="Add to queue">＋</button></li>`).join("")}</ol>
        ${!S.conn.token ? `<p class="hint">Songs marked 📱 are on this phone; the rest play once the phone is paired with the computer.</p>` : `<p class="hint">📱 on this phone · the rest stream from your computer (home Wi-Fi, or “from anywhere”).</p>`}</div>`;
    sh.hidden = false; sh.scrollTop = 0;
    sh.dataset.jxAlbum = a.key;
    openAlbum.a = a;
  }

  /* the full jukebox window: the record, the controls, the queue */
  function openNow() {
    const sh = $("#sheet"), t = cur();
    const up = J.order.slice(J.pos + 1).map((i, k) => ({ it: S.items[J.tracks[i]], n: J.pos + 1 + k })).filter((x) => x.it);
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>Jukebox</h2></div>
      <div class="it-body jx-now">${t ? `<div class="jx-bigrec ${audio.paused ? "" : "spin"}">${t.has_cover ? cover(t, false) : ""}<i></i></div>
        <h3>${esc(t.title)}</h3><p class="hint">${esc([t.album_artist || (t.authors || [])[0], t.album].filter(Boolean).join(" · "))}</p>
        <input type="range" id="jxSeek" min="0" max="${audio.duration || 0}" step="1" value="${audio.currentTime || 0}"><div class="jx-times"><span id="jxAt">${fmt(audio.currentTime)}</span><span id="jxDur">${fmt(audio.duration)}</span></div>
        <div class="jx-ctl">${controls(true)}</div>` : `<p class="empty">Nothing playing.</p>`}
        <h3 class="jx-qh">Up next${J.shuffle ? " (shuffled)" : ""}${up.length ? `<button class="btn sm" data-jx="clear">Clear</button>` : ""}</h3>
        ${up.length ? `<ol class="jx-queue">${up.map((x) => `<li><button class="jx-qgo" data-jx-jump="${x.n}"><b>${esc(x.it.title)}</b><small>${esc(x.it.album || "")}</small></button>
          <button class="jx-q" data-jx-up="${x.n}" aria-label="Move up">▲</button><button class="jx-q" data-jx-del="${x.n}" aria-label="Remove">✕</button></li>`).join("")}</ol>` : `<p class="hint">Nothing queued. Add albums or songs with ＋.</p>`}
        ${t ? `<div class="btns"><button class="btn danger sm" data-jx="stop">Stop and clear</button></div>` : ""}</div>`;
    sh.hidden = false;
    sh.dataset.jxNow = "1";
  }

  /* ---------------- playing ---------------- */
  function playList(list, start = 0, shuffle = J.shuffle) {
    list = list.filter(playable);
    if (!list.length) return toast(S.conn.token ? "Nothing to play." : "Get these songs onto the phone first (or pair with the computer to stream them).");
    J.tracks = list.map((t) => t.id);
    J.shuffle = shuffle;
    const idx = J.tracks.map((_, i) => i);
    if (shuffle) { const first = start >= 0 ? Math.min(start, idx.length - 1) : Math.floor(Math.random() * idx.length); J.order = [first, ...shuffled(idx.filter((i) => i !== first))]; J.pos = 0; }
    else { J.order = idx; J.pos = Math.max(0, Math.min(start, idx.length - 1)); }
    loadTrack(true);
  }
  function enqueue(list, nextUp) {
    list = list.filter(playable);
    if (!list.length) return;
    if (!cur()) return playList(list, 0, false);
    const base = J.tracks.length;
    J.tracks.push(...list.map((t) => t.id));
    const add = list.map((_, i) => base + i);
    if (nextUp) J.order.splice(J.pos + 1, 0, ...add); else J.order.push(...add);
    changed();
    toast(nextUp ? "Plays next" : `Added ${list.length === 1 ? "“" + list[0].title + "”" : list.length + " songs"} to the queue`);
  }
  async function loadTrack(play) {
    const t = cur();
    if (!t) { audio.pause(); audio.removeAttribute("src"); return changed(); }
    let src = "";
    if (onPhone(t)) src = (A && A.mediaUrl && A.mediaUrl(fileName(t))) || (A && A.mediaUrlAsync ? await A.mediaUrlAsync(fileName(t)) : "") || "/local/" + encodeURIComponent(fileName(t));
    else src = `/net/sync/file/${t.id}`;
    audio.src = src;
    if (play) audio.play().catch(() => {});
    change(t.id, { opened_at: now() });
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.album_artist || (t.authors || [])[0] || "", album: t.album || "" }); } catch (e) {}
    }
    changed();
  }
  function next(auto) {
    if (!J.order.length) return;
    if (auto && J.repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (J.pos < J.order.length - 1) { J.pos++; return loadTrack(true); }
    if (J.repeat === "all") { J.pos = 0; if (J.shuffle) J.order = shuffled(J.order); return loadTrack(true); }
    if (auto) { audio.pause(); changed(); }
  }
  function prev() {
    if (audio.currentTime > 3 || J.pos === 0) { audio.currentTime = 0; return; }
    J.pos--; loadTrack(true);
  }
  function toggle() {
    if (!cur()) return;
    if (!audio.src) return loadTrack(true);
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  }
  function setShuffle(on) {
    J.shuffle = on;
    if (J.order.length) {
      const done = J.order.slice(0, J.pos + 1), rest = J.order.slice(J.pos + 1);
      J.order = [...done, ...(on ? shuffled(rest) : rest.sort((a, b) => a - b))];
    }
    toast(on ? "Shuffle on" : "Shuffle off");
    changed();
  }
  function changed() {
    keep();
    const w = $("#jxWindow"); if (w) w.innerHTML = windowHtml();
    paintBar();
    if (!$("#sheet").hidden && $("#sheet").dataset.jxNow) openNow();
  }
  function paintBar() {
    let b = $("#jxBar");
    const t = cur();
    if (!t) { if (b) b.remove(); document.body.classList.remove("has-jx"); return; }
    if (!b) { b = document.createElement("div"); b.id = "jxBar"; b.className = "jx-bar"; document.body.append(b); }
    document.body.classList.add("has-jx");
    b.innerHTML = `<button class="jx-barinfo" data-jx-open>${t.has_cover ? cover(t, false) : `<span class="jx-vinyl"></span>`}<span><b>${esc(t.title)}</b><small>${esc(t.album_artist || (t.authors || [])[0] || "")}</small></span></button>
      <button class="jx-b" data-jx="prev" aria-label="Previous">⏮</button><button class="jx-b jx-play" data-jx="toggle" aria-label="Play or pause">${audio.paused ? "▶" : "❚❚"}</button><button class="jx-b" data-jx="next" aria-label="Next">⏭</button><i class="jx-barfill" id="jxFill"></i>`;
  }

  audio.addEventListener("ended", () => next(true));
  audio.addEventListener("play", changed);
  audio.addEventListener("pause", changed);
  audio.addEventListener("error", () => { if (cur()) { toast(onPhone(cur()) ? "That song couldn't be played." : "Can't reach your computer to stream that song."); } });
  audio.addEventListener("timeupdate", () => {
    const f = $("#jxFill"); if (f) f.style.width = (audio.duration ? (audio.currentTime / audio.duration) * 100 : 0) + "%";
    const sk = $("#jxSeek");
    if (sk && document.activeElement !== sk) { sk.max = audio.duration || 0; sk.value = audio.currentTime; $("#jxAt").textContent = fmt(audio.currentTime); $("#jxDur").textContent = fmt(audio.duration); }
  });
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", toggle); navigator.mediaSession.setActionHandler("pause", toggle);
      navigator.mediaSession.setActionHandler("nexttrack", () => next()); navigator.mediaSession.setActionHandler("previoustrack", prev);
    } catch (e) {}
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    const go = t.closest("[data-jx-playalbum]");
    if (go) { e.stopPropagation(); const a = albumsNow[Number(go.dataset.jxPlayalbum)]; if (a) playList(a.tracks, 0, J.shuffle); return; }
    const al = t.closest("[data-jx-album]"); if (al) { const a = albumsNow[Number(al.dataset.jxAlbum)]; if (a) openAlbum(a); return; }
    if (t.closest("[data-jx-all]")) { const all = albums(Object.values(S.items)).flatMap((a) => a.tracks); return playList(all, -1, true); }
    if (t.closest("[data-jx-open]")) return openNow();
    const a = openAlbum.a;
    const aa = t.closest("[data-jx-a]");
    if (aa && a) { const k = aa.dataset.jxA; return k === "play" ? playList(a.tracks, 0, false) : k === "shuffle" ? playList(a.tracks, -1, true) : enqueue(a.tracks, k === "next"); }
    const tr = t.closest("[data-jx-t]"); if (tr && a) return playList(a.tracks, Number(tr.dataset.jxT), false);
    const tq = t.closest("[data-jx-tq]"); if (tq && a) return enqueue([a.tracks[Number(tq.dataset.jxTq)]], false);
    const j = t.closest("[data-jx-jump]"); if (j) { J.pos = Number(j.dataset.jxJump); return loadTrack(true); }
    const up = t.closest("[data-jx-up]");
    if (up) { const n = Number(up.dataset.jxUp); if (n > J.pos + 1) { [J.order[n - 1], J.order[n]] = [J.order[n], J.order[n - 1]]; changed(); } return; }
    const dl = t.closest("[data-jx-del]"); if (dl) { J.order.splice(Number(dl.dataset.jxDel), 1); return changed(); }
    const c = t.closest("[data-jx]");
    if (!c) return;
    const k = c.dataset.jx;
    if (k === "toggle") toggle();
    else if (k === "next") next();
    else if (k === "prev") prev();
    else if (k === "shuffle") setShuffle(!J.shuffle);
    else if (k === "repeat") { J.repeat = { off: "all", all: "one", one: "off" }[J.repeat]; toast({ off: "Repeat off", all: "Repeat all", one: "Repeat this song" }[J.repeat]); changed(); }
    else if (k === "clear") { J.order = J.order.slice(0, J.pos + 1); changed(); }
    else if (k === "stop") { J.tracks = []; J.order = []; J.pos = 0; audio.pause(); audio.removeAttribute("src"); changed(); closeSheet(); }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "jxSeek") { audio.currentTime = Number(e.target.value); $("#jxAt").textContent = fmt(audio.currentTime); } });
  // the sheet closing: it's no longer the jukebox window or an album
  new MutationObserver(() => { const sh = $("#sheet"); if (sh && sh.hidden) { delete sh.dataset.jxNow; delete sh.dataset.jxAlbum; } })
    .observe(document.getElementById("sheet") || document.body, { attributes: true, attributeFilter: ["hidden"] });
  setTimeout(paintBar, 500);           // (what was playing when the app closed: ready to carry on)

  /* a song opened from anywhere else (its details, search): plays its album from that song */
  function playItem(it) {
    const a = albums(Object.values(S.items)).find((x) => x.key === albumKey(it));
    const list = a ? a.tracks : [it];
    playList(list, Math.max(0, list.indexOf(it)), false);
  }
  return { html, playItem, openNow };
})();
