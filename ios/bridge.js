/* Babel's Library on iPhone and iPad: the same app as on Android (web/), with this standing in for the Java bridge
   (window.Android). It loads the app's saved state from IndexedDB first, then starts the app's own scripts.
     storage     state files in IndexedDB (kv); files kept for offline in 8 MB pieces (store.js)
     network     always through the computer's away-from-home address (net.js)
     the rest    the service worker (sw.js) serves files, covers and comic pages; Safari does the browsing, its
                 speech recognition the dictation, Web Push the News notifications */
(() => {
  const APP_SCRIPTS = __APP_SCRIPTS__;
  const kv = new Map();
  const files = {};               // name -> size, finished files only
  const dls = {};                 // download id -> {item, name, title, total, done, state}
  const ups = [];                 // files going to the computer
  let free = 0, lock = null, objUrl = null;
  const isIPad = /iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const done = (id, status, text, extra) => window.Native && window.Native.done(id, status, text == null ? "" : String(text), extra == null ? "" : String(extra));
  const say = (m) => window.toast && window.toast(m);
  const saveKv = (k, v) => { kv.set(k, v); DB.put("kv", k, v).catch((e) => console.error("save", k, e)); };
  const persistDls = () => saveKv("downloads-ios.json", JSON.stringify(dls));
  Net.onMoved = (url) => {        // the tunnel's address changed: remember it for next time
    try { const st = JSON.parse(kv.get("state.json") || "{}"); if (st.conn) { st.conn.remote = url; saveKv("state.json", JSON.stringify(st)); } } catch (e) {}
  };

  async function estimate() {
    try { const e = await navigator.storage.estimate(); free = Math.max(0, (e.quota || 0) - (e.usage || 0)); } catch (e) { free = 0; }
  }

  /* ---------------------------------------------------------------- downloads (resumable, piece by piece) */
  let running = false;
  async function runDownloads() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const d = Object.values(dls).find((x) => ["waiting", "running", "paused"].includes(x.state));
        if (!d) break;
        try { await fetchFile(d); } catch (e) { console.error("download", d.name, e); d.state = "failed"; persistDls(); }
        if (d.state === "paused") await new Promise((ok) => { const t = setTimeout(ok, 6000); addEventListener("online", () => { clearTimeout(t); ok(); }, { once: true }); });
      }
    } finally { running = false; }
  }
  async function fetchFile(d) {
    d.state = "running";
    let rec = (await DB.get("files", d.name)) || { name: d.name, size: d.total || 0, type: mimeOf(d.name), pieces: 0, done: false };
    for (;;) {
      if (d.state === "cancelled") return;
      const start = rec.pieces * PIECE;
      if (rec.size && start >= rec.size) break;
      const r = await Net.call("GET", "/sync/file/" + d.item, null, 180000, { Range: `bytes=${start}-${start + PIECE - 1}` });
      if (d.state === "cancelled") return;
      if (r.status === 206 || r.status === 200) {
        const cr = /\/(\d+)\s*$/.exec(r.res.headers.get("content-range") || "");
        if (cr) rec.size = Number(cr[1]);
        const b = await r.res.blob().catch(() => null);
        if (!b) { d.state = "paused"; return; }
        if (r.status === 200) {              // (the whole file at once: cut it into pieces)
          rec.size = b.size;
          for (let i = 0, k = 0; i < b.size || k === 0; i += PIECE, k++) { await DB.putPiece(d.name + "#" + k, b.slice(i, i + PIECE)); rec.pieces = k + 1; }
        } else {
          await DB.putPiece(d.name + "#" + rec.pieces, b);
          rec.pieces++;
        }
        rec.type = rec.type || r.res.headers.get("content-type") || mimeOf(d.name);
        d.total = rec.size; d.done = Math.min(rec.size, rec.pieces * PIECE);
        await DB.put("files", d.name, rec);
        persistDls();
        if (r.status === 200 || d.done >= rec.size) break;
        continue;
      }
      if (r.status === 416) break;
      if (r.status >= 400) { d.state = "failed"; persistDls(); return; }
      d.state = "paused"; persistDls();     // no connection: carry on later from here
      return;
    }
    rec.done = true;
    await DB.put("files", d.name, rec);
    files[d.name] = rec.size;
    d.state = "done"; d.done = rec.size;
    persistDls();
    estimate();
  }

  /* ---------------------------------------------------------------- uploads ("Add files" → the computer) */
  async function sendUpload(u) {
    u.state = "sending";
    let tries = 0;
    const q = () => `/sync/upload?u=${u.id}&name=${encodeURIComponent(u.name)}&total=${u.total}&offset=${u.sent}`;
    while (u.sent < u.total) {
      if (u.state === "cancelled") return;
      const r = await Net.call("POST", q(), u.file.slice(u.sent, u.sent + PIECE), 300000, { "Content-Type": "application/octet-stream" });
      let o = null;
      try { o = r.res ? await r.res.json() : null; } catch (e) {}
      if (u.state === "cancelled") return;
      if (r.status === 200 && o && !o.error) { u.sent = Math.min(u.total, u.sent + PIECE); tries = 0; u.state = "sending"; continue; }
      if (r.status === 200 && o && o.error === "offset") { u.sent = o.have || 0; continue; }
      if (r.status === 400 && o) { u.state = "failed"; u.msg = o.error || "refused"; return; }
      if (++tries > 40) { u.state = "failed"; u.msg = r.status ? `The computer refused it (${r.status}).` : "Can't reach your computer."; return; }
      u.state = "retrying";
      await new Promise((ok) => setTimeout(ok, Math.min(30000, 1500 * tries)));
      const h = await Net.call("GET", `/sync/upload?u=${u.id}`, null, 20000);
      try { if (h.status === 200) u.sent = (await h.res.json()).have || u.sent; } catch (e) {}
    }
    u.state = "done";
  }
  async function runUploads() {
    for (const u of ups) if (u.state === "waiting") await sendUpload(u);
  }

  /* ---------------------------------------------------------------- dictation (Safari's speech recognition) */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, wantRec = false;
  const heard = (type, text) => window.Native && window.Native.dictation && window.Native.dictation({ type, text });
  function listen() {
    rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => heard("state", "listening");
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (t) heard(e.results[i].isFinal ? "final" : "partial", t);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { wantRec = false; heard("error", "Allow the microphone and Speech Recognition for this app (iPhone Settings → Safari or the app) to dictate."); }
    };
    rec.onend = () => { if (wantRec) setTimeout(() => { if (wantRec) try { listen(); } catch (err) { heard("state", "off"); } }, 150); else heard("state", "off"); };   // (restarts through pauses)
    rec.start();
  }

  /* ---------------------------------------------------------------- News notifications (Web Push) */
  async function pushOn(on) {
    const reg = await navigator.serviceWorker.ready;
    if (!on) {
      const s = await reg.pushManager.getSubscription();
      if (s) await s.unsubscribe().catch(() => {});
      await Net.call("POST", "/sync/push/subscribe", JSON.stringify({ sub: null }));
      return true;
    }
    if (!reg.pushManager || !window.Notification) { say("Add this app to your Home Screen first (Share → Add to Home Screen), then switch this on there."); return false; }
    if ((await Notification.requestPermission()) !== "granted") { say("Notifications are off for this app: switch them on in iPhone Settings → Notifications."); return false; }
    const k = await Net.call("GET", "/sync/push/key", null, 20000);
    if (k.status !== 200) { say("Couldn't reach your computer: try again when it's on."); return false; }
    const key = (await k.res.json()).key;
    const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (key.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    const r = await Net.call("POST", "/sync/push/subscribe", JSON.stringify({ sub: sub.toJSON() }));
    if (r.status !== 200) { say("Couldn't tell your computer: try again when it's on."); return false; }
    return true;
  }
  /* a News notification tapped: the event, with Share and Open */
  async function showEvents(items) {
    for (const it of (items || []).slice(0, 4)) {
      if (!it || !it.link) continue;
      const when = it.date ? new Date(it.date * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
      const a = await window.askKeep(it.title || "A new event", [when, it.source].filter(Boolean).join(" · ") || "A new event in the News",
        [["Share…", "share"], ["Open", "open"], ["Close", null]]);
      if (a === "share") {
        try { await navigator.share({ title: it.title, text: it.title + (when ? ` (${when})` : ""), url: it.link }); }
        catch (e) { if (e.name !== "AbortError") { navigator.clipboard?.writeText(it.link); say("Link copied"); } }
      } else if (a === "open") window.open(it.link, "_blank", "noopener");
    }
  }

  /* ---------------------------------------------------------------- the bridge itself */
  window.Android = {
    web: true,
    load: (name) => kv.get(name) || "",
    save: (name, data) => { saveKv(name, data); return true; },
    setConn: (json) => { try { Net.set(JSON.parse(json)); } catch (e) {} },
    route: () => Net.via,
    remoteNow: () => Net.remote,
    request(id, method, path, body) {
      Net.call(method, path, body || null).then(async (r) => {
        if (!r.status) return done(id, 0, r.error || "offline", "");
        done(id, r.status, await r.res.text(), Net.via);
      });
    },
    /* pairing: with no address given, the code itself says where the computer is (it posts its away-from-home
       address to a topic made from the code; it can take a few seconds to appear) */
    pair(id, base, body) {
      (async () => {
        if (!base) {
          const topic = await Net.pairTopic(JSON.parse(body).code);
          for (let i = 0; i < 8 && !base; i++) { base = await Net.lookup(topic); if (!base) await new Promise((ok) => setTimeout(ok, 2500)); }
          if (!base) return done(id, 0, "Couldn't find your computer from that code. Check that “Reach this library from anywhere” is on in its Settings → Phone, and make a new code.", "");
        }
        const t = Net.token;
        Net.token = "";
        const r = await Net.once(base, "POST", "/sync/pair", body, 30000);
        Net.token = t;
        if (!r.status) return done(id, 0, "Couldn't reach your computer at " + base, "");
        if (r.status === 200) Net.remote = base;
        done(id, r.status, await r.res.text(), base);
      })();
    },
    hello(id, base) { Net.once(base, "GET", "/sync/hello", null, 8000).then(async (r) => done(id, r.status, r.status ? await r.res.text() : r.error, "")); },
    discover(id) { setTimeout(() => done(id, 200, "[]", ""), 0); },
    deviceName: () => (isIPad ? "iPad" : "iPhone"),
    network: () => (navigator.onLine ? "other" : "none"),

    // files kept on this device
    files: () => JSON.stringify(files),
    deleteFile(name) {
      delete files[name];
      DB.removeFile(name).then(estimate).catch(() => {});
      navigator.serviceWorker.controller?.postMessage({ forget: name });
      return true;
    },
    freeSpace: () => free,
    openWith(name) {              // "Open in another app": the share sheet, with the file
      DB.blob(name).then(async (b) => {
        if (!b) return say("The file isn't on this device.");
        const f = new File([b], name, { type: b.type });
        try {
          if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f] });
          else window.open(URL.createObjectURL(b), "_blank");
        } catch (e) { if (e.name !== "AbortError") window.open(URL.createObjectURL(b), "_blank"); }
      });
      return true;
    },

    // files going to the computer
    uploads: () => JSON.stringify(ups.map(({ file, ...u }) => u)),
    cancelUpload(id) { const u = ups.find((x) => x.id === id); if (u) { u.state = "cancelled"; Net.call("DELETE", "/sync/upload?u=" + id, null); } },
    dismissUpload(id) { const i = ups.findIndex((x) => x.id === id); if (i >= 0) ups.splice(i, 1); },
    retryUpload(id) { const u = ups.find((x) => x.id === id); if (u) { u.state = "waiting"; u.msg = ""; runUploads(); } },
    pickFiles() {
      const inp = document.createElement("input");
      inp.type = "file"; inp.multiple = true;
      inp.onchange = () => {
        for (const f of inp.files) ups.push({ id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: f.name, total: f.size, sent: 0, state: "waiting", msg: "", file: f });
        runUploads();
      };
      inp.click();
    },

    // passwords: Safari's own (iCloud Keychain) fill them in on websites
    importPasswords() {}, passwordCount: () => 0, clearPasswords() {},

    // the browser: Safari does the browsing; this keeps the start page's history and bookmarks
    bookmarks: () => kv.get("bookmarks.json") || "[]",
    setBookmarks: (json) => saveKv("bookmarks.json", json),
    browserHistory: () => kv.get("history.json") || "[]",
    setBrowserHistory: (json) => { saveKv("history.json", json); return true; },
    setBrowserTheme() {},
    openBrowser(url) {
      if (!url) return;
      // words typed on the start page are a search (DuckDuckGo), an address without https:// gets one; the same
      // as the Android browser does (otherwise Safari took the words for a page of this site: GitHub's 404)
      const t = String(url).trim();
      if (!/^https?:\/\//i.test(t)) url = !/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) ? "https://" + t : "https://duckduckgo.com/?q=" + encodeURIComponent(t);
      try {
        const h = JSON.parse(kv.get("history.json") || "[]");
        h.push({ url, title: url.replace(/^https?:\/\/(www\.)?/, ""), t: Math.floor(Date.now() / 1000) });
        saveKv("history.json", JSON.stringify(h.slice(-2000)));
      } catch (e) {}
      window.open(url, "_blank", "noopener");
    },
    updateAdblock(id) { setTimeout(() => done(id, 200, "0", ""), 0); },
    adblockAge: () => Math.floor(Date.now() / 1000),

    // players
    mediaUrl: () => "",
    async mediaUrlAsync(name) {
      const b = await DB.blob(name);
      if (!b) return "";
      if (objUrl) URL.revokeObjectURL(objUrl);
      return (objUrl = URL.createObjectURL(b));
    },
    keepAwake(on) {
      if (!navigator.wakeLock) return;
      if (on) navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
      else if (lock) { lock.release().catch(() => {}); lock = null; }
    },

    // downloads from the computer
    download(id, itemId, name, title) {
      const dl = Date.now() * 10 + Math.floor(Math.random() * 10);
      let total = 0;
      try { total = S.items[itemId].file_size || 0; } catch (e) {}      // (the app's own state, a global of app.js)
      dls[dl] = { item: itemId, name, title, total, done: 0, state: "waiting" };
      persistDls();
      setTimeout(() => { done(id, 200, String(dl), "remote"); runDownloads(); }, 0);
    },
    downloads(idsJson) {
      const out = {};
      for (const k of JSON.parse(idsJson || "[]")) {
        const d = dls[k];
        if (!d) continue;
        out[k] = { state: d.state === "running" ? "running" : d.state, done: d.done, total: d.total, reason: 0 };
        if (d.state === "done" || d.state === "failed" || d.state === "cancelled") { delete dls[k]; persistDls(); }
      }
      return JSON.stringify(out);
    },
    cancelDownload(dl) {
      const d = dls[dl];
      if (!d) return;
      d.state = "cancelled";
      DB.removeFile(d.name).catch(() => {});
      delete dls[dl]; persistDls();
    },

    // dictation into notes
    dictateStart() {
      if (!SR) { heard("error", "Dictation isn't available here: update iOS, or use the keyboard's 🎙."); return; }
      wantRec = true;
      try { listen(); } catch (e) { heard("error", String(e.message || e)); }
    },
    dictateStop() { wantRec = false; try { rec && rec.stop(); } catch (e) {} },

    // News notifications
    newsAlerts: () => kv.get("newsalerts.json") === "true",
    setNewsAlerts(on) {
      pushOn(on).then((ok) => { saveKv("newsalerts.json", String(on && ok)); if (on && !ok) { const c = document.querySelector("#newsAlerts"); if (c) c.checked = false; } })
        .catch((e) => { say("Couldn't switch notifications: " + (e.message || e)); const c = document.querySelector("#newsAlerts"); if (c) c.checked = false; });
    },
  };

  /* ---------------------------------------------------------------- the iPhone's own ways */
  // leaving and coming back to the app (Android tells the page from Java)
  document.addEventListener("visibilitychange", () => {
    if (!window.Native) return;
    if (document.hidden) window.Native.onPause && window.Native.onPause();
    else { window.Native.onResume && window.Native.onResume(); if (lock && window.Reader && Reader.open) Android.keepAwake(true); }
  });
  navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data && e.data.news) showEvents(e.data.news); });

  // in Safari (not yet on the Home Screen): how to install it, once (the Home Screen app keeps its own storage)
  function installTip() {
    if (navigator.standalone || matchMedia("(display-mode: standalone)").matches) return;
    try { if (localStorage.getItem("babel.installTip")) return; } catch (e) {}
    const t = document.createElement("div");
    t.className = "ios-tip";
    t.innerHTML = `<b>Put Babel's Library on your Home Screen</b><span>Tap <i class="ios-share"></i> Share below, then <b>Add to Home Screen</b>, and open it from there. It works offline and can send News notifications; pair it there (it keeps its own copy of your library).</span><button aria-label="Close">✕</button>`;
    t.querySelector("button").onclick = () => { t.remove(); try { localStorage.setItem("babel.installTip", "1"); } catch (e) {} };
    document.body.append(t);
  }

  async function boot() {
    try { for (const [k, v] of await DB.all("kv")) kv.set(k, v); } catch (e) { console.error("storage", e); }
    try { for (const [k, f] of await DB.all("files")) if (f && f.done) files[k] = f.size; } catch (e) {}
    try { Object.assign(dls, JSON.parse(kv.get("downloads-ios.json") || "{}")); } catch (e) {}
    for (const d of Object.values(dls)) if (d.state === "running") d.state = "paused";
    try { const st = JSON.parse(kv.get("state.json") || "{}"); Net.set(st.conn); } catch (e) {}
    navigator.storage?.persist?.().catch(() => {});        // (asks iOS not to clear the files kept for offline)
    await estimate();
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("sw.js");
        await navigator.serviceWorker.ready;
        // the first time, the page must be under the worker before the readers ask it for files
        if (!navigator.serviceWorker.controller) await new Promise((ok) => { navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }); setTimeout(ok, 3000); });
      } catch (e) { console.error("service worker", e); }
    }
    for (const src of APP_SCRIPTS) {
      await new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.body.append(s); });
    }
    installTip();
    runDownloads();
    const m = /#news=([^&]+)/.exec(location.hash);
    if (m) { history.replaceState(null, "", location.pathname); try { setTimeout(() => showEvents(JSON.parse(decodeURIComponent(m[1]))), 800); } catch (e) {} }
  }
  boot().catch((e) => { document.body.insertAdjacentHTML("beforeend", `<p style="padding:20px">Couldn't start: ${String(e.message || e)}</p>`); });
})();
