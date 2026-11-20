/* Babel as the phone's home screen (Android): the Add-ons tab (every other app on the phone, to open from here),
   apps pinned to the Bulletin, the Home button, the sleep screen, and Settings → This phone (home screen, browser,
   sleep screen). The iPhone web app has none of this (Safari can't open other apps or be a home screen). */
(() => {
  if (typeof A === "undefined" || !A || !A.apps || (typeof WEB !== "undefined" && WEB)) {
    window.AddOns = null; window.Sleep = null;
    const t = document.querySelector('#tabs [data-tab="apps"]'); if (t) t.remove();      // (no Add-ons tab where it can't open apps)
    return;
  }

  /* ---------------------------------------------------------------- the phone's apps */
  const cfg = Object.assign({ pins: [], view: "grid" }, load("addons.json", {}));
  const saveCfg = () => store("addons.json", cfg);
  let list = null, q = "", menuFor = null;
  const key = (a) => a.pkg + "/" + a.cls;
  function apps(fresh) {
    if (!list || fresh) { try { list = JSON.parse(A.apps()); } catch (e) { list = []; } list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })); }
    return list;
  }
  const icon = (a) => `/appicon?p=${encodeURIComponent(a.pkg)}&c=${encodeURIComponent(a.cls)}`;
  const tile = (a, cls = "ao-app") => `<button class="${cls}" data-app="${esc(key(a))}" title="${esc(a.label)}"><span class="ao-ic"><img src="${icon(a)}" alt="" loading="lazy" decoding="async"></span><b>${esc(a.label)}</b></button>`;
  const pinned = () => { const all = apps(); return cfg.pins.map((k) => all.find((a) => key(a) === k)).filter(Boolean); };
  const theme = () => document.documentElement.dataset.theme;
  const heads = { wordtown: ["Add-ons", "Everything else on your phone, open from Word Town"], gruvbox: ["~/add-ons", "ls -a /phone/apps"], galaxy: ["Add-ons", "Every other world on this phone"], eink: ["Add-ons", "The other apps on this phone"] };

  function render(v) {
    const all = apps();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = all.filter((a) => words.every((w) => a.label.toLowerCase().includes(w) || a.pkg.toLowerCase().includes(w)));
    const [title, sub] = heads[theme()] || heads.wordtown;
    let body = "";
    if (!q && cfg.pins.length) body += `<h3 class="ao-h">📌 Pinned to Home</h3><div class="ao-grid ao-pins">${pinned().map((a) => tile(a)).join("")}</div>${cfg.view === "grid" ? `<h3 class="ao-h">All apps</h3>` : ""}`;
    let cur = "";
    for (const a of hit) {
      const L = /^[a-z]/i.test(a.label) ? a.label[0].toUpperCase() : "#";
      if (cfg.view === "grid") { if (!cur) { body += `<div class="ao-grid">`; cur = "?"; } body += tile(a); continue; }      // (the grid: one run, A to Z)
      if (L !== cur && !q) { body += `${cur ? "</div>" : ""}<h3 class="ao-h ao-letter">${L}</h3><div class="ao-grid">`; cur = L; }
      else if (!cur && q) { body += `<div class="ao-grid">`; cur = "?"; }
      body += tile(a);
    }
    if (cur) body += "</div>";
    if (!hit.length) body += `<p class="empty">${q ? "No app matches." : "No other apps found."}</p>`;
    v.innerHTML = `<div class="ao ao-v-${cfg.view}">
      <header class="ao-top"><div><h2>${esc(title)}</h2><small>${esc(sub)} · ${all.length} apps</small></div>
        <button class="btn sm" data-ao-view type="button" aria-label="Grid or list">${cfg.view === "grid" ? "☰ List" : "▦ Grid"}</button></header>
      <div class="searchrow ao-search"><input id="aoQ" type="search" placeholder="Find an app" value="${esc(q)}" autocomplete="off"></div>
      ${body}
      <p class="hint ao-tip">Hold an app to pin it to Home (the “On this phone” page) or see its settings.${A.isDefault && !A.isDefault("home") ? ` <button class="linkish" data-default="home" type="button">Make Babel your home screen…</button>` : ""}</p>
      ${menuFor ? menuHtml(menuFor) : ""}</div>`;
    const inp = $("#aoQ");
    inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; render(v); const n = $("#aoQ"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
  }
  function menuHtml(k) {
    const a = apps().find((x) => key(x) === k);
    if (!a) return "";
    const on = cfg.pins.includes(k);
    return `<div class="ao-shade" data-ao-close></div><div class="ao-menu" role="dialog"><div class="ao-menu-h">${tile(a, "ao-app ao-big")}</div>
      <button class="btn" data-ao-pin="${esc(k)}" type="button">${on ? "Unpin from Home" : "📌 Pin to Home"}</button>
      <button class="btn" data-ao-info="${esc(a.pkg)}" type="button">ⓘ App settings (uninstall, permissions)</button>
      <button class="btn" data-ao-close type="button">Cancel</button></div>`;
  }
  /* the apps you pinned, along the top of Home's "On this phone" page */
  // pinned apps | a bar | the app you opened last (from Babel), marked Recent | All apps
  function dock() {
    // (the newest app you opened that isn't pinned: a pinned app is already there)
    const p = pinned(), all = apps(), recents = cfg.recents || (cfg.recent ? [cfg.recent] : []);
    const r = recents.filter((k) => !cfg.pins.includes(k)).map((k) => all.find((x) => key(x) === k)).find(Boolean);
    if (!p.length && !r) return "";
    return `<nav class="ao-dock" aria-label="Pinned and recent apps">${p.map((a) => tile(a, "ao-app ao-dockapp")).join("")}
      ${r ? `${p.length ? `<span class="ao-bar" aria-hidden="true"></span>` : ""}<span class="ao-recent">${tile(r, "ao-app ao-dockapp")}<i>Recent</i></span>` : ""}
      <span class="ao-bar" aria-hidden="true"></span><button class="ao-app ao-dockapp ao-more" data-go-tab="apps" type="button"><span class="ao-ic">⊞</span><b>All apps</b></button></nav>`;
  }
  function launch(k) {
    const a = apps().find((x) => key(x) === k);
    if (!a) { apps(true); return toast("That app isn't on the phone any more"); }
    if (!A.launchApp(a.pkg, a.cls)) { apps(true); return toast(`Couldn't open ${a.label}`); }
    // the apps you opened, newest first (the dock's Recent spot shows the newest one that isn't pinned)
    const rec = [k, ...(cfg.recents || (cfg.recent ? [cfg.recent] : [])).filter((x) => x !== k)].slice(0, 12);
    if (JSON.stringify(rec) !== JSON.stringify(cfg.recents)) { cfg.recents = rec; delete cfg.recent; saveCfg(); }
  }

  // taps: open; hold: the menu (pin, settings)
  let holdT = null, held = false;
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest?.("[data-app]");
    if (!b) return;
    held = false;
    clearTimeout(holdT);
    holdT = setTimeout(() => { held = true; menuFor = b.dataset.app; if (navigator.vibrate) navigator.vibrate(12); if (S.tab === "apps") render($("#view")); else openMenuOver(); }, 480);
  }, true);
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) => document.addEventListener(t, () => clearTimeout(holdT), true));
  document.addEventListener("scroll", () => clearTimeout(holdT), true);
  function openMenuOver() {        // (held on the Bulletin's dock)
    let m = $("#aoMenuOver");
    if (!m) { m = document.createElement("div"); m.id = "aoMenuOver"; m.className = "ao"; document.body.appendChild(m); }
    m.innerHTML = menuHtml(menuFor);
  }
  function closeMenu() { menuFor = null; const m = $("#aoMenuOver"); if (m) m.remove(); if (S.tab === "apps") render($("#view")); }
  document.addEventListener("click", (e) => {
    const t = e.target;
    const app = t.closest?.("[data-app]");
    if (app) { e.stopImmediatePropagation(); e.preventDefault(); if (held) { held = false; return; } if (t.closest(".ao-menu")) return; return launch(app.dataset.app); }
    if (t.closest?.("[data-ao-close]")) return closeMenu();
    const pin = t.closest?.("[data-ao-pin]");
    if (pin) {
      const k = pin.dataset.aoPin, i = cfg.pins.indexOf(k);
      if (i >= 0) cfg.pins.splice(i, 1); else cfg.pins.push(k);
      saveCfg(); toast(i >= 0 ? "Unpinned" : "Pinned to Home (On this phone)"); closeMenu();
      if (S.tab === "home") render();
      return;
    }
    const inf = t.closest?.("[data-ao-info]"); if (inf) { A.appInfo(inf.dataset.aoInfo); return closeMenu(); }
    if (t.closest?.("[data-ao-view]")) { cfg.view = cfg.view === "grid" ? "list" : "grid"; saveCfg(); return render($("#view")); }
    const gt = t.closest?.("[data-go-tab]"); if (gt) return setTab(gt.dataset.goTab);
    const df = t.closest?.("[data-default]"); if (df) return A.askDefault(df.dataset.default);
    const ds = t.closest?.("[data-default-set]"); if (ds) return A.defaultSettings(ds.dataset.defaultSet);
    if (t.closest?.("[data-dream-set]")) return A.dreamSettings();
    if (t.closest?.("[data-sleep-preview]")) return Sleep.show(true);
    const so = t.closest?.("[data-sleep]");
    if (so) { const [k, val] = so.dataset.sleep.split(":"); Sleep.cfg[k] = k === "on" ? val === "1" : Number(val); Sleep.save(); return render(); }
  }, true);

  /* ---------------------------------------------------------------- Settings → This phone */
  function settingsPanel() {
    const home = A.isDefault("home"), web = A.isDefault("browser"), dream = A.isDream && A.isDream(), c = Sleep.cfg;
    const secs = (s) => s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
    const chips = (k, vals, fmt) => vals.map((x) => `<button data-sleep="${k}:${x}" class="${c[k] === x ? "on" : ""}">${fmt(x)}</button>`).join("");
    return `<div class="panel ph-panel"><h3>This phone</h3>
      <div class="ph-row"><span><b>⌂ Home screen</b><small>${home ? "Babel is your home screen: the Home button opens the Bulletin, and your apps are on the Add-ons tab." : "Make Babel what the Home button opens: the Bulletin, with your apps on the Add-ons tab."}</small></span>
        ${home ? `<button class="btn sm" data-default-set="home" type="button">Switch back…</button>` : `<button class="btn sm primary" data-default="home" type="button">Use Babel</button>`}</div>
      <div class="ph-row"><span><b>◍ Browser</b><small>${web ? "Links from other apps open on Babel's Browser tab." : "Open links from other apps (messages, email…) on Babel's Browser tab."}</small></span>
        ${web ? `<button class="btn sm" data-default-set="browser" type="button">Change…</button>` : `<button class="btn sm primary" data-default="browser" type="button">Use Babel</button>`}</div>
      <h4 class="pick-h">☾ Sleep screen <small>a clock and what you're reading, in your theme</small></h4>
      <div class="chips"><b class="chip-lbl">Sleep screen</b><button data-sleep="on:1" class="${c.on ? "on" : ""}">On</button><button data-sleep="on:0" class="${c.on ? "" : "on"}">Off</button></div>
      ${c.on ? `<div class="chips"><b class="chip-lbl">Comes on after</b>${chips("after", [30, 60, 120, 300], secs)}</div>
      <div class="chips"><b class="chip-lbl">Screen off after</b>${chips("stay", [60, 120, 300, 900, 0], (x) => x ? secs(x) : "Never")}</div>
      <p class="hint">Shown when you leave Babel idle (not while a book, video or web page is open). While the phone charges it stays on.</p>` : ""}
      <div class="ph-row"><span><b>⚡ While charging</b><small>${dream ? "Babel's sleep screen is the phone's screen saver." : "Pick “Babel's Library” as the phone's screen saver to see it whenever the phone charges, even with Babel closed."}</small></span>
        <button class="btn sm" data-dream-set type="button">${dream ? "Change…" : "Set up…"}</button></div>
      <div class="btns"><button class="btn" data-sleep-preview type="button">☾ Preview the sleep screen</button></div></div>`;
  }

  /* ---------------------------------------------------------------- the sleep screen (shown in the app) */
  const Sleep = {
    cfg: Object.assign({ on: true, after: 60, stay: 120 }, load("sleep.json", {})),
    up: false, t: null, offT: null, last: Date.now(), away: false,
    save() { store("sleep.json", this.cfg); this.poke(); },
    // (not over a book, a video, a web page or a pairing code you're typing)
    busy() {
      if (Reader.open) return true;
      if (typeof Media !== "undefined" && Media.owner) return true;
      if ((S.tab === "browser" || S.tab === "mail") && document.documentElement.classList.contains("bw-on")) return true;
      const f = document.activeElement;
      return !!(f && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName));
    },
    arm() {
      clearTimeout(this.t);
      const ok = this.cfg.on && !this.away && !this.up && !this.busy();
      A.holdAwake(!!ok);            // (the phone's own timeout would turn the screen off first)
      if (ok) this.t = setTimeout(() => (this.busy() ? this.arm() : this.show()), this.cfg.after * 1000);
    },
    poke() { this.last = Date.now(); if (this.up) this.hide(); else this.arm(); },
    show(preview) {
      if (this.up) return;
      this.up = true;
      clearTimeout(this.t);
      if (S.tab === "browser" && A.browserHide) A.browserHide();
      if (S.tab === "mail" && A.widgetsHide) A.widgetsHide();
      let f = $("#sleepFrame");
      if (!f) { f = document.createElement("iframe"); f.id = "sleepFrame"; f.className = "sleep-frame"; f.setAttribute("title", "Sleep screen"); document.body.appendChild(f); }
      if (window.Widget) Widget.update();
      f.src = "sleep.html?inapp=1&t=" + Date.now();
      f.hidden = false;
      let bat = {}; try { bat = JSON.parse(A.battery()); } catch (e) {}
      A.holdAwake(false);
      // charging, or "never": stays on; otherwise on for a while, then the phone turns the screen off as usual
      const hold = !!bat.charging || !this.cfg.stay || !!preview;
      A.sleeping(true, true);
      clearTimeout(this.offT);
      if (!hold) this.offT = setTimeout(() => { if (this.up) A.sleeping(true, false); }, this.cfg.stay * 1000);
    },
    hide() {
      if (!this.up) return;
      this.up = false;
      clearTimeout(this.offT);
      const f = $("#sleepFrame"); if (f) { f.hidden = true; f.src = "about:blank"; }
      A.sleeping(false, false);
      if ((S.tab === "browser" || S.tab === "mail") && window.placeBrowser) placeBrowser();
      this.arm();
    },
  };
  addEventListener("message", (e) => { if (e.data && e.data.babel === "wake") Sleep.poke(); });
  let lastLocal = 0;
  ["pointerdown", "keydown", "wheel"].forEach((t) => document.addEventListener(t, () => { const n = Date.now(); if (Sleep.up || n - lastLocal > 2000) { lastLocal = n; Sleep.poke(); } }, true));
  document.addEventListener("focusin", () => Sleep.arm());
  document.addEventListener("focusout", () => setTimeout(() => Sleep.arm(), 50));

  /* ---------------------------------------------------------------- what the phone tells the page */
  const N = window.Native;
  N.poke = () => Sleep.poke();
  // the Home button (Babel is the home screen): the Bulletin, with anything open put away
  N.homeButton = () => {
    Sleep.hide();
    if (window.PageKeys && PageKeys.cancel) PageKeys.cancel();
    if (Reader.open && Reader.close) Reader.close();
    menuFor = null; const m = $("#aoMenuOver"); if (m) m.remove();
    if (!$("#sheet").hidden && typeof closeSheet === "function") closeSheet();
    if (typeof W !== "undefined") { W.tab = "bulletin"; store("hometab.json", W.tab); }
    setTab("home");
  };
  N.roleChanged = () => { if (S.tab === "settings" || S.tab === "apps") render(); };
  const resume0 = N.onResume, pause0 = N.onPause;
  N.onResume = () => {
    if (resume0) resume0();
    Sleep.away = false; Sleep.poke();
    setTimeout(() => { const n = list ? list.length : -1; apps(true); if ((S.tab === "apps" && list.length !== n) || S.tab === "settings" || (S.tab === "home" && typeof W !== "undefined" && W.tab === "phone" && !Reader.open && $("#sheet").hidden)) render(); }, 300);   // (Home: the dock's Recent app)   // (an app installed or removed meanwhile)
  };
  N.onPause = () => { if (pause0) pause0(); Sleep.away = true; clearTimeout(Sleep.t); A.holdAwake(false); if (Sleep.up) Sleep.hide(); clearTimeout(Sleep.t); A.holdAwake(false); };

  window.AddOns = { render, dock, settingsPanel, apps };
  window.Sleep = Sleep;
  setTimeout(() => Sleep.arm(), 1500);
})();
