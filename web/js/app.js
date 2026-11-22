/* Babel's Library for Android: the library, kept in step with Babel's Library on the computer.
   Everything about the library comes from the computer; the phone sends back what you change here (where you are in
   a book or film, progress, watched, favourites, wishlist). Each change carries its time, and the newer one wins. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const A = window.Android || null;   // the Java bridge (missing in a desktop browser preview)
const WEB = !!(A && A.web);         // the iPhone / iPad web app (ios/bridge.js stands in for the Java bridge)
const now = () => Date.now() / 1000;
window.Reader = { open: false };      // filled in by readers.js

/* ---------------------------------------------------------------- saved state */
const S = {
  conn: { lan: "", remote: "", topic: "", token: "", pc: "" },   // the paired computer
  since: 0,            // the computer's clock at the last pull
  lastSync: 0, route: "", syncing: false, syncError: "",
  theme: "", themeChoice: "auto", autoGet: true,
  items: {}, anns: {}, colls: [], log: [], journal: {},
  ops: [],             // changes made here, not yet sent
  jops: [],            // journal changes made here, not yet sent
  readMode: {},        // per kind of file: "pages" or "scroll"
  search: "duckduckgo", jq: "", jstatus: "all", jkind: "all", bq: "",
  uploads: {},         // files on their way to the computer: id -> {name, sent, total, state}
  downloads: {},       // item id -> download id
  dlState: {},         // download id -> {state, done, total}
  files: {},           // name -> size, on the phone
  tab: "home", kind: "all", q: "", sort: "recent", limit: 60,
};
function load(name, fallback) { try { const t = A ? A.load(name) : localStorage.getItem(name); return t ? JSON.parse(t) : fallback; } catch (e) { return fallback; } }
function store(name, obj) { const t = JSON.stringify(obj); if (A) A.save(name, t); else try { localStorage.setItem(name, t); } catch (e) {} }
function saveState() {
  store("state.json", { conn: S.conn, since: S.since, lastSync: S.lastSync, theme: S.theme, themeChoice: S.themeChoice, autoGet: S.autoGet, downloads: S.downloads,
    readMode: S.readMode, search: S.search, nav: S.nav, eink: S.eink, jstyle: S.jstyle, tabsOff: S.tabsOff, blayout: S.blayout, bsecond: S.bsecond, bhome: S.bhome, dexMode: S.dexMode, dexScale: S.dexScale, bulletinPeriod: S.bulletinPeriod, press: S.press,
    area: S.area, kind: S.kind, libLayout: S.libLayout, groupBy: S.groupBy, groupByArea: S.groupByArea, sort: S.sort, coll: S.coll, readFont: S.readFont, readGap: S.readGap });
}
/* ---------------------------------------------------------------- profiles
   The computer keeps the profiles (everyone who uses the library): the phone is logged in as one of them and sees its
   places, notes, journal and Bulletin, and nothing another profile hid. Switching asks the computer (a full sync).
   (Before that, a phone kept its own extra profiles, their progress on the phone only, in progress-<id>.json:
   those are brought to the computer as profiles of their own the first time it answers.) */
const PF = ["progress", "last_location", "watched", "watched_at", "opened_at", "audio_pos"];
const PF0 = { progress: 0, last_location: null, watched: 0, watched_at: null, opened_at: null, audio_pos: null };
const FACES = ["🦉", "🦊", "🐢", "🐙", "🦄", "🐝", "🐸", "🦖", "🐧", "🌵", "🍄", "🚀"];
const Prof = {
  list: [], cur: "main", marks: {}, server: false,
  isMain() { return this.server || this.cur === "main"; },
  me() { return this.list.find((p) => p.id === this.cur) || this.list[0]; },
  load() {
    const sv = load("sprofiles.json", null);
    if (sv && sv.list && sv.list.length) { this.server = true; this.list = sv.list; this.cur = sv.cur; this.marks = {}; return; }
    this.list = load("profiles.json", null) || [{ id: "main", name: "Me", face: "🦉" }];
    this.cur = load("profile.json", "main");
    if (!this.list.some((p) => p.id === this.cur)) this.cur = "main";
    this.marks = this.isMain() ? {} : load(`progress-${this.cur}.json`, {});
  },
  saveList() { store("profiles.json", this.list); store("profile.json", this.cur); },
  apply() {
    for (const it of Object.values(S.items)) {
      if (it._m) { Object.assign(it, it._m); delete it._m; }
      if (this.isMain()) continue;
      it._m = {};
      for (const f of PF) it._m[f] = it[f] ?? null;
      Object.assign(it, PF0, this.marks[it.id] || {});
    }
  },
  // the library as the computer has it (what's saved in library.json), whoever is using the phone
  plain() {
    if (this.isMain()) return S.items;
    const o = {};
    for (const [k, it] of Object.entries(S.items)) o[k] = it._m ? { ...it, ...it._m, _m: undefined } : it;
    return o;
  },
  mark(id, fields) {
    Object.assign(this.marks[id] = this.marks[id] || {}, fields);
    store(`progress-${this.cur}.json`, this.marks);
  },
  /* the computer's answer: its profiles, and which one this phone is */
  fromServer(list, cur) {
    if (!list || !list.length) return;
    // (the phone's own profiles wait in profiles.json until the computer has them, so a failed try is tried again)
    const old = (this.server ? load("profiles.json", null) || [] : this.list).filter((p) => p.id !== "main");
    if (!this.server && !this.isMain()) store("profile-wanted.json", this.cur);       // (the one in use: switched to once it's there)
    if (!this.server && !this.isMain()) { this.cur = "main"; this.marks = {}; this.apply(); }
    const changed = !this.server || this.cur !== cur || JSON.stringify(this.list) !== JSON.stringify(list);
    this.server = true; this.list = list; this.cur = cur;
    store("sprofiles.json", { list, cur });
    if (old.length && !this.migrating) { this.migrating = true; setTimeout(() => this.migrate(old).finally(() => { this.migrating = false; }), 500); }
    if (changed) paintProfile();
  },
  async migrate(old) {
    for (const p of old) {
      try {
        const have = this.list.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
        const id = have ? have.id : (await api("POST", "/sync/profiles", { name: p.name, face: p.face })).profile.id;
        const t = now(), marks = load(`progress-${p.id}.json`, {}), anns = load(`anns-${p.id}.json`, {});
        const ops = [];
        for (const [iid, f] of Object.entries(marks)) for (const [field, value] of Object.entries(f)) ops.push({ id: Number(iid), field, value, ts: t });
        const aops = Object.values(anns).map((a) => ({ op: "add", cid: String(a.id).replace(/^c:/, ""), item_id: a.item_id, title: a.title, note: a.note, quote: a.quote, color: a.color, locator: a.locator }));
        if (ops.length || aops.length) await api("POST", "/sync/push", { ops, aops, now: t, profile: id });
        store(`progress-${p.id}.json`, {}); store(`anns-${p.id}.json`, {});
      } catch (e) { return; }           // (tried again next time)
    }
    store("profiles.json", null);
    const r = await api("GET", "/sync/profiles").catch(() => null);
    if (r) this.fromServer(r.profiles, r.current);
    // the phone was being used as one of its own profiles: it carries on as that profile, now the computer's
    const want = load("profile-wanted.json", null) || load("profile.json", null), was = want && old.find((p) => p.id === want);
    store("profile-wanted.json", null); store("profile.json", null);
    const to = was && this.list.find((x) => x.name.toLowerCase() === was.name.toLowerCase());
    if (to && to.id !== this.cur && !to.locked) this.switchTo(to.id);
  },
  async switchTo(id) {
    if (this.server) {
      if (!S.conn.token) return toast("Pair with the computer first");
      const to = this.list.find((p) => p.id === id);
      let pin;
      if (to && to.locked) {            // (a profile with a PIN: the computer checks it)
        const a = await askPin(`${to.face} ${to.name}'s PIN`, "");
        if (!a) return;
        pin = a.pin;
      }
      if (Reader.open) Reader.close();
      toast("Switching…");
      try {
        await sync();                    // (what this profile changed here goes first)
        await api("POST", "/sync/profile", { id, pin });
      } catch (e) { return toast(e.offline ? "Switching profiles needs the computer (home Wi-Fi or “from anywhere”)" : e.message); }
      this.cur = id; store("sprofiles.json", { list: this.list, cur: id });
      if (A && A.setBookmarks) A.setBookmarks("[]");      // (the browser's bookmarks are the profile's: its own come with the sync)
      renderBrowser.fetched = false;
      S.since = 0; Ann.switched(); loadUnwrapped(); W.sel = 0;
      await sync(true);
      paintProfile(); render();
      return toast(`${this.me().face} ${this.me().name}'s library`);
    }
    if (Reader.open) Reader.close();
    saveLibrary();
    this.cur = id;
    this.saveList();
    this.marks = this.isMain() ? {} : load(`progress-${id}.json`, {});
    this.apply();
    Ann.switched();
    loadUnwrapped();
    W.sel = 0;
    paintProfile();
    render();
    toast(`${this.me().face} ${this.me().name}'s library`);
  },
  // a PIN for the profile this phone is using: set, changed, or taken off (empty)
  async pin() {
    const p = this.me();
    const a = await askPin(p.locked ? `${p.name}'s PIN` : `A PIN for ${p.name}`,
      p.locked ? "Type the new one, or leave it empty to take the PIN off." : "Whoever switches to this profile (on a phone or the computer) will need it. Numbers or a password, 4 or more characters.",
      p.locked ? [["old", "Current PIN"], ["pin", "New PIN (empty: none)"], ["again", "New PIN again"]] : [["pin", "PIN"], ["again", "Again"]], "Save");
    if (!a) return;
    if (a.pin !== a.again) return toast("The two PINs don't match");
    try {
      const r = await api("POST", "/sync/profile", { setpin: a.pin, old: a.old });
      this.fromServer(r.profiles, r.current);
      toast(this.me().locked ? "PIN saved" : "PIN taken off");
      render();
    } catch (e) { toast(e.offline ? "Setting a PIN needs the computer" : e.message); }
  },
  async rename(id, fields) {           // (on the computer's list)
    const r = await api("POST", "/sync/profile", { edit: id, ...fields });
    this.fromServer(r.profiles, r.current);
  },
  async add(name) {
    if (this.server) {
      const r = await api("POST", "/sync/profiles", { name, face: FACES[this.list.length % FACES.length] });
      this.fromServer(r.profiles, this.cur);
      return r.profile;
    }
    const p = { id: "p" + Date.now().toString(36), name, face: FACES[this.list.length % FACES.length] };
    this.list.push(p); this.saveList();
    return p;
  },
  remove(id) {
    if (id === "main") return;
    if (this.cur === id) this.switchTo("main");
    this.list = this.list.filter((p) => p.id !== id); this.saveList();
    store(`progress-${id}.json`, {});
    paintProfile();
  },
};
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("#profChip")) {            // the face in the top bar: whose library is this?
    const id = await askKeep("Who's reading?", "Each profile keeps its own place in every book and film.",
      [...Prof.list.map((p) => [`${p.face}  ${p.name}${p.id === Prof.cur ? "  ✓" : ""}`, p.id]), ["Manage profiles…", "@manage"]]);
    if (id === "@manage") return setTab("settings");
    if (id && id !== Prof.cur) Prof.switchTo(id);
    return;
  }
  const f = t.closest("[data-prof-face]");
  if (f) {
    const p = Prof.list.find((x) => String(x.id) === f.dataset.profFace); p.face = FACES[(FACES.indexOf(p.face) + 1) % FACES.length];
    if (Prof.server) Prof.rename(p.id, { face: p.face }).catch((err) => toast(err.message)); else Prof.saveList();
    paintProfile(); f.textContent = p.face; return;
  }
  const u = t.closest("[data-prof-use]"); if (u) return Prof.switchTo(Prof.server ? Number(u.dataset.profUse) : u.dataset.profUse);
  if (t.closest("[data-prof-pin]")) return Prof.pin();
  const d = t.closest("[data-prof-del]");
  if (d) {
    const p = Prof.list.find((x) => x.id === d.dataset.profDel);
    if (p && confirm(`Remove ${p.name}'s profile? Their progress on this phone is forgotten. (The library itself isn't touched.)`)) { Prof.remove(p.id); paintProfile(); render(); }
  }
});
document.addEventListener("change", (e) => {
  const n = e.target.closest("[data-prof-name]");
  if (!n) return;
  const p = Prof.list.find((x) => String(x.id) === n.dataset.profName);
  if (p) {
    p.name = n.value.trim() || p.name; n.value = p.name;
    if (Prof.server) Prof.rename(p.id, { name: p.name }).catch((err) => toast(err.message)); else Prof.saveList();
    paintProfile();
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "profAdd") return;
  e.preventDefault();
  const name = $("#profNew").value.trim();
  if (!name) return toast("Type a name first");
  let p;
  try { p = await Prof.add(name); } catch (err) { return toast(err.offline ? "Adding a profile needs the computer" : err.message); }
  paintProfile(); render();
  toast(`Added ${p.face} ${p.name}. Tap Use (or the face at the top) to switch.`);
});
function paintProfile() {
  const c = $("#profChip"), p = Prof.me();
  if (c && p) { c.textContent = p.face; c.title = `${p.name} (tap to switch)`; c.hidden = Prof.list.length < 2; }
}

let libTimer = null;
function saveLibrary(soon) {
  clearTimeout(libTimer);
  const go = () => store("library.json", { items: Prof.plain(), anns: S.anns, colls: S.colls, log: S.log, journal: S.journal });
  if (soon) libTimer = setTimeout(go, 1500); else go();
}
function saveOps() { store("ops.json", S.ops); store("jops.json", S.jops); }
(function restore() {
  Object.assign(S, load("state.json", {}));
  if (!load("jstyle-picked.json", null)) { S.jstyle = "tickets"; store("jstyle-picked.json", "tickets"); setTimeout(saveState, 0); }
  Object.assign(S, load("library.json", {}));
  S.ops = load("ops.json", []);
  S.jops = load("jops.json", []);
  Prof.load();
  Prof.apply();
  pushConn();
})();
function pushConn() { if (A) A.setConn(JSON.stringify(S.conn)); }

/* ---------------------------------------------------------------- the bridge's answers */
const waiting = new Map();
let seq = 0;
window.Native = {
  done(id, status, text, route) { const w = waiting.get(id); if (w) { waiting.delete(id); w({ status, text, route }); } },
  onResume() { refreshFiles(); sync(); },
  onPause() { if (Reader.open) Reader.saveNow(); saveLibrary(); },
  onBack() {
    if (window.PageKeys && PageKeys.cancel()) return true;
    if (S.tab === "settings" && S.setPane && S.conn.token && $("#sheet").hidden && !Reader.open) { S.setPane = null; render(); return true; }
    if (Reader.open) return Reader.back();
    if (!$("#sheet").hidden) { closeSheet(); return true; }
    if (S.tab !== "home") { setTab("home"); return true; }
    return false;
  },
};
function bridge(fn, ...args) {
  return new Promise((res) => { const id = "r" + ++seq; waiting.set(id, res); A[fn](id, ...args); });
}
async function api(method, path, body) {
  if (!A) throw new Error("Only works inside the app.");
  const paired = !!S.conn.token, web = typeof Online !== "undefined" && Online.handles(method, path);
  const r = paired ? await bridge("request", method, path, body ? JSON.stringify(body) : "") : { status: 0 };
  if (r.route) S.route = r.route;
  if (!r.status) {
    if (paired) S.route = "";
    if (web) return Online.answer(method, path, body);         // the News and the catalogue: straight from the web
    const e = new Error("Can't reach your computer."); e.offline = true; throw e;
  }
  let data = {};
  try { data = JSON.parse(r.text || "{}"); } catch (e) {}
  if ((r.status === 401 || r.status === 403 || r.status === 404) && web && method === "GET") return Online.answer(method, path, body);     // (a phone the computer no longer knows: the web still answers)
  if (r.status >= 400) { const e = new Error(data.error || `Error ${r.status}`); e.status = r.status; throw e; }
  if (web) Online.remember(method, path, data);
  return data;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800);
}

/* a small question with a few answers (a sheet from the bottom); resolves to the chosen answer's value, or null */
/* a PIN (or password) or two: fields [[name, label], …] → {name: value}, or null if it's dismissed */
function askPin(title, text, fields = [["pin", "PIN"]], ok = "OK") {
  return new Promise((done) => {
    const w = document.createElement("div");
    w.className = "keep-ask";
    w.innerHTML = `<form class="ka-card" role="dialog"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}
      ${fields.map(([n, l]) => `<label class="field pin-field"><span>${esc(l)}</span><input type="password" name="${n}" autocomplete="off" maxlength="64"></label>`).join("")}
      <div class="ka-row"><button class="btn primary">${esc(ok)}</button><button type="button" class="btn" data-x>Cancel</button></div></form>`;
    const end = (v) => { w.remove(); done(v); };
    w.querySelector("form").onsubmit = (e) => { e.preventDefault(); end(Object.fromEntries(fields.map(([n]) => [n, w.querySelector(`[name=${n}]`).value]))); };
    w.onclick = (e) => { if (e.target.closest("[data-x]") || e.target === w) end(null); };
    document.body.append(w);
    w.querySelector("input").focus();
  });
}
function askKeep(title, text, answers) {
  return new Promise((done) => {
    const w = document.createElement("div");
    w.className = "keep-ask";
    w.innerHTML = `<div class="ka-card" role="dialog"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="ka-row">${answers.map(([l, v, cls], i) => `<button class="btn ${cls || ""}" data-i="${i}">${esc(l)}</button>`).join("")}</div></div>`;
    w.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b || e.target === w) { w.remove(); done(b ? answers[Number(b.dataset.i)][1] : null); } };
    document.body.append(w);
  });
}

/* pages kept for 30 days: a few days before one is due, ask whether to delete it or keep it longer */
const EXPIRY = { asking: false, later: {} };
async function checkExpiring() {
  if (EXPIRY.asking || !S.conn.token) return;
  const soon = now() + 3 * 86400;
  const due = Object.values(S.items).filter((it) => it.expires_at && it.expires_at < soon && (EXPIRY.later[it.id] || 0) < Date.now());
  if (!due.length) return;
  EXPIRY.asking = true;
  try {
    for (const it of due) {
      const left = Math.max(0, Math.ceil((it.expires_at - now()) / 86400));
      const a = await askKeep(`“${it.title || "An article"}” is due to be removed`,
        left ? `You kept it for 30 days; that's up in ${left} day${left > 1 ? "s" : ""}. Delete it then, or keep it longer?` : "You kept it for 30 days and the time's up. Delete it now, or keep it longer?",
        [["Keep 30 more days", "extend"], ["Keep for good", "keep"], [left ? "Delete it now" : "Delete it", "delete", "danger"], ["Ask me later", "later"]]);
      if (a == null || a === "later") { EXPIRY.later[it.id] = Date.now() + 6 * 3600e3; continue; }
      try {
        const r = await api("POST", `/sync/item/${it.id}/expire`, { action: a });
        if (a === "delete") delete S.items[it.id]; else it.expires_at = a === "keep" ? null : Math.max(now(), it.expires_at) + 30 * 86400;
        saveLibrary();
        toast(a === "delete" ? `Removed${r.went ? ` (on the computer, the file is in ${r.went})` : ""}` : a === "keep" ? "Kept for good" : "Kept for another 30 days");
        render();
      } catch (e) { toast(e.offline ? "Can't reach your computer: you'll be asked again later" : e.message); EXPIRY.later[it.id] = Date.now() + 3600e3; }
    }
  } finally { EXPIRY.asking = false; }
}

/* ---------------------------------------------------------------- theme */
/* Samsung DeX, or a big screen with a mouse (not the iPhone/iPad app): the computer's layout */
const isDex = () => { if (window.FORCE_DEX || S.dexMode === "on") return true; if (S.dexMode === "off") return false; try { if (A && A.isDex && A.isDex()) return true; } catch (e) {} return !WEB && viewSize()[0] >= 1000 && matchMedia("(pointer: fine)").matches; };
/* the window in dp (not CSS pixels: on DeX the page is scaled up, so its own width is smaller) */
const viewSize = () => { try { const v = A && A.viewDp && A.viewDp(); if (v) { const [w, h] = v.split("x").map(Number); if (w > 0 && h > 0) return [w, h]; } } catch (e) {} return [innerWidth * (fitDex.k || 1), innerHeight * (fitDex.k || 1)]; };
/* DeX on a monitor: the app is drawn bigger as its window grows (a 1080p monitor at the phone's own size reads like small
   print), sized so the page is about 1280 × 760 of its own pixels, never smaller than the phone's scale */
function fitDex() {
  const dex = isDex(), [w, h] = viewSize();
  // (auto: about 1100 × 640 of the page's own pixels; or the size picked in Settings → Look)
  const k = !dex ? 1 : S.dexScale > 0 ? Math.max(.75, Math.min(2.5, S.dexScale)) : Math.max(1, Math.min(2, Math.min(w / 1100, h / 640)));
  const want = k === 1 ? "width=device-width, initial-scale=1, viewport-fit=cover"
    : `width=${Math.round(w / k)}, initial-scale=${k.toFixed(3)}, minimum-scale=${k.toFixed(3)}, maximum-scale=${k.toFixed(3)}, user-scalable=no, viewport-fit=cover`;
  const meta = document.querySelector("meta[name=viewport]");
  if (meta && meta.content !== want) meta.content = want;
  if (fitDex.k !== k) { fitDex.k = k; try { A && A.setZoom && A.setZoom(k); } catch (e) {} }
  document.documentElement.classList.toggle("dex", dex);
  document.documentElement.classList.toggle("dex-narrow", dex && w / k < 1100);
  return dex;
}
addEventListener("resize", () => { const was = document.documentElement.classList.contains("dex"); clearTimeout(fitDex.t); fitDex.t = setTimeout(() => { const d = fitDex(); if (d !== was && S.tab === "library") render(); if (S.tab === "browser" && window.placeBrowser) placeBrowser(); }, 120); });
/* the e-reader theme (phone only): black on white with no motion, picked by itself when E-reader mode is switched on */
if (window.THEMES && !THEMES.eink) THEMES.eink = { name: "E-reader", inspired: "e-ink screens", swatch: ["#ffffff", "#000000", "#777777"],
  spines: ["#222222", "#555555", "#888888", "#3a3a3a", "#6e6e6e", "#9a9a9a"], reader: { bg: "#ffffff", ink: "#000000", font: "Georgia, serif" }, pageTint: "" };
function applyTheme() {
  const k = S.eink ? "eink" : S.themeChoice !== "auto" ? S.themeChoice : S.theme;
  document.documentElement.dataset.theme = window.THEMES && THEMES[k] ? k : "wordtown";
  if (!NAVS.some((n) => n[0] === S.nav)) S.nav = "folders";
  if (!JSTYLES.some((n) => n[0] === S.jstyle)) S.jstyle = "list";
  document.documentElement.dataset.nav = S.nav;
  fitDex();
  document.documentElement.dataset.jstyle = S.jstyle;
  if (!BLAYOUTS.some((b) => b[0] === S.blayout)) S.blayout = "standard";
  document.documentElement.classList.toggle("tabs-off", !!S.tabsOff);
  document.documentElement.classList.toggle("eink", !!S.eink);       // (e-reader screens: no motion, plain black on white)
  document.body.classList.remove("nav-open");
  placeNub();
  if (A && A.setBrowserTheme) {          // the browser screen is native: tell it the theme's colours (and the browser's layout)
    const cs = getComputedStyle(document.documentElement), c = (v) => cs.getPropertyValue(v).trim();
    A.setBrowserTheme(JSON.stringify({ theme: document.documentElement.dataset.theme, layout: S.blayout, second: S.bsecond === "swap" ? "swap" : "split", bg: c("--bg"), surface: c("--surface"), ink: c("--ink"), soft: c("--ink-soft"),
      line: c("--line"), accent: c("--accent"), accentInk: c("--accent-ink"), accent2: c("--accent2") }));
  }
}
/* the orange tab (tabs hidden): see-through, and dragged up or down out of the way; its height is kept (S.nubY, a
   fraction of the screen) and the browser's copy of it sits at the same height */
function placeNub() { document.documentElement.style.setProperty("--nub-y", ((S.nubY || 0.5) * 100).toFixed(2) + "%"); }
/* what the app itself is playing (the jukebox, a video): the phone's media notification, its status bar chip and the
   lock screen show it, with play/pause and skip; their buttons come back here (Native.media) to whoever is playing */
const Media = {
  owner: null, last: "",
  show(owner, st) {
    this.owner = owner;
    const j = JSON.stringify(st);
    if (j === this.last) return;
    this.last = j;
    if (A && A.mediaState) A.mediaState(j);
  },
  hide(owner) {
    if (this.owner !== owner) return;
    this.owner = null; this.last = "";
    if (A && A.mediaState) A.mediaState("");
    if (typeof Jukebox !== "undefined") Jukebox.note();       // (a video closed: the jukebox's song, if any, is shown again)
  },
};
window.Native.media = (cmd) => {
  if (cmd === "ended") { Media.last = ""; return; }          // (the notification went away by itself)
  if (Media.owner) Media.owner.command(cmd);
  else if ((cmd === "stop" || cmd === "pause") && typeof Jukebox !== "undefined") Jukebox.command(cmd);     // (nobody shown: the music still obeys stop)
};
window.Native.nubMoved = (f) => { S.nubY = Math.max(0.06, Math.min(0.94, Number(f) || 0.5)); placeNub(); saveState(); };
(() => {
  let y0 = null, f0 = 0, moved = false;
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#navNub")) return; y0 = e.clientY; f0 = S.nubY || 0.5; moved = false; }, true);
  document.addEventListener("pointermove", (e) => {
    if (y0 === null) return;
    if (!moved && Math.abs(e.clientY - y0) < 8) return;
    moved = true;
    S.nubY = Math.max(0.06, Math.min(0.94, f0 + (e.clientY - y0) / innerHeight));
    placeNub();
  }, true);
  document.addEventListener("pointerup", () => { if (y0 !== null && moved) saveState(); y0 = null; }, true);
  // a drag isn't a tap: the tabs stay hidden
  document.addEventListener("click", (e) => { if (moved && e.target.closest("#navNub")) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
})();
/* full screen: the tabs tuck away; the nub on the right edge (or a swipe in from it) brings them back */
function tabsOff(off) {
  setTimeout(placeBrowser, 320);           // (the browser gets the room the tabs leave, or gives it back)
  S.tabsOff = off;
  document.body.classList.remove("nav-open");
  document.documentElement.classList.toggle("tabs-off", off);
  saveState();
}
(() => {
  let x0 = null;
  document.addEventListener("touchstart", (e) => { const x = e.touches[0].clientX; x0 = S.tabsOff && x > innerWidth - 24 ? x : null; }, { passive: true });
  document.addEventListener("touchmove", (e) => { if (x0 !== null && x0 - e.touches[0].clientX > 40) { x0 = null; tabsOff(false); } }, { passive: true });
})();
/* the two ways to get around (Settings → Look) */
/* the browser's layout (🧭 on the Browser tab), like the computer's: where its controls live. Two calm ones, two wild ones */
const BLAYOUTS = [["standard", "Standard", "The bar along the top"], ["bottom", "Bottom bar", "The bar at the bottom, by your thumb"], ["rail", "Side rail", "Controls down the side"],
  ["orb", "Orb", "No bar: an orb fans out the controls"], ["tv", "TV set", "Websites on a retro telly, knobs and all"]];
/* the Browser tab's start page (🧭 Layout → Start page), like the computer's */
const BHOMES = [["dash", "Dashboard", "Clock, search and your bookmarks"]];        // (the only start page now)
const NAVS = [["folders", "Index cards", "Divider tabs down the right edge, like a card file"], ["drawer", "Side drawer", "A ☰ button opens a big menu from the left"]];
const JSTYLES = [["list", "Clean list", "Covers in rows, grouped by month"], ["notebook", "Notebook", "Lined paper, a red margin, handwriting"],
  ["timeline", "Timeline", "A line down the page; each finish is a stop on it"], ["wall", "Cover wall", "A wall of covers with status ribbons and scores"],
  ["tickets", "Ticket stubs", "Tickets and slips; your score punched in"]];

/* ---------------------------------------------------------------- your changes, sent to the computer */
function change(id, fields) {
  const it = S.items[id];
  if (!it) return;
  if (!Prof.isMain()) {            // another profile: its progress stays on this phone; the rest (favourite, wishlist) is shared
    const mine = Object.fromEntries(Object.entries(fields).filter(([f]) => PF.includes(f)));
    if (Object.keys(mine).length) { Object.assign(it, mine); Prof.mark(id, mine); }
    fields = Object.fromEntries(Object.entries(fields).filter(([f]) => !PF.includes(f)));
    if (!Object.keys(fields).length) return;
  }
  const t = now();
  for (const [f, v] of Object.entries(fields)) {
    it[f] = v;
    it.clock = it.clock || {};
    it.clock[f] = t;
    S.ops = S.ops.filter((o) => !(o.id === id && o.field === f));
    S.ops.push({ id, field: f, value: v, ts: t });
  }
  saveOps();
  saveLibrary(true);
  clearTimeout(change.t);
  change.t = setTimeout(() => sync(), 4000);
}

/* ---------------------------------------------------------------- highlights, notes, pins and bookmarks
   The same notes as the computer's reader (S.anns, synced). Ones made here go in a queue (aops.json) and are sent
   with the next sync; until then they have the phone's own id, "c:…". Another profile's notes stay on this phone. */
const Ann = {
  _mine: null, flying: [],
  queue: load("aops.json", []),
  local() { return this._mine ??= load(`anns-${Prof.cur}.json`, {}); },
  map() { return Prof.isMain() ? S.anns : this.local(); },
  save() { if (Prof.isMain()) { store("aops.json", this.queue); saveLibrary(true); clearTimeout(change.t); change.t = setTimeout(() => sync(), 4000); } else store(`anns-${Prof.cur}.json`, this.local()); },
  of(itemId) { return Object.values(this.map()).filter((a) => a.item_id === itemId); },
  add(itemId, body) {
    const cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const a = { id: "c:" + cid, item_id: itemId, title: "", note: "", quote: "", color: "yellow", locator: {}, created_at: now(), updated_at: now(), ...body };
    this.map()[a.id] = a;
    if (Prof.isMain()) this.queue.push({ op: "add", cid, item_id: itemId, title: a.title, note: a.note, quote: a.quote, color: a.color, locator: a.locator });
    this.save();
    return a;
  },
  edit(a, fields) {
    Object.assign(a, fields, { updated_at: now() });
    if (Prof.isMain()) {
      const add = String(a.id).startsWith("c:") && this.queue.find((o) => o.op === "add" && "c:" + o.cid === a.id && !this.flying.includes(o));
      if (add) Object.assign(add, fields);            // (not sent yet: the change goes with it)
      else {
        const ed = this.queue.find((o) => o.op === "edit" && o.id === a.id);
        if (ed) Object.assign(ed.fields, fields); else this.queue.push({ op: "edit", id: a.id, fields: { ...fields } });
      }
    }
    this.save();
  },
  del(a) {
    delete this.map()[a.id];
    if (Prof.isMain()) {
      if (String(a.id).startsWith("c:") && this.queue.some((o) => o.op === "add" && "c:" + o.cid === a.id && !this.flying.includes(o))) this.queue = this.queue.filter((o) => !(o.op === "add" && "c:" + o.cid === a.id) && o.id !== a.id);
      else { this.queue = this.queue.filter((o) => o.id !== a.id); this.queue.push({ op: "del", id: a.id }); }
    }
    this.save();
  },
  /* saved on the computer: the phone's ids give way to the computer's */
  made(map) {
    for (const [cid, id] of Object.entries(map || {})) {
      const a = S.anns["c:" + cid];
      if (a) { delete S.anns["c:" + cid]; S.anns[id] = { ...a, id }; }
      for (const o of this.queue) if (o.id === "c:" + cid) o.id = id;
      if (window.Reader && Reader.renamed) Reader.renamed("c:" + cid, id);
    }
    store("aops.json", this.queue);
  },
  switched() { this._mine = null; },
};

/* papers and news articles keep their Finished / Up next marks on their own pages, but aren't part of the journal
   (its Log, its Now page or the year's count) */
function inJournal(l) {
  const k = l.item_kind || (l.item_id && S.items[l.item_id] && S.items[l.item_id].kind);
  return k !== "article";
}
/* ---------------------------------------------------------------- sync */
let syncP = null;
function sync(force) {
  if (!S.conn.token) { paintPill(); return Promise.resolve(); }
  if (syncP) return syncP;
  S.syncing = true; paintPill();
  syncP = (async () => {
    try {
      let made = {};
      let since = force ? 0 : S.since;
      if (S.ops.length || S.jops.length || Ann.queue.length) {
        const sending = S.ops.slice(), jsending = S.jops.slice(), asending = Ann.flying = Ann.queue.slice();
        let r;
        try { r = await api("POST", "/sync/push", { ops: sending, jops: jsending, aops: asending, now: now() }); } finally { Ann.flying = []; }
        made = r.made || {};
        // some of ours were older than the computer's (made before this device last heard from it): fetch its newer
        // ones back, or this device would keep showing its old place
        if (r.kept_ours && sending.length && r.now) since = Math.min(since, Math.min(...sending.map((o) => o.ts)) + (r.now - now()) - 5);
        S.ops = S.ops.filter((o) => !sending.includes(o));
        S.jops = S.jops.filter((o) => !jsending.includes(o));
        Ann.queue = Ann.queue.filter((o) => !asending.includes(o));
        Ann.made(r.made_anns);
        saveOps();
      }
      const d = await api("GET", `/sync/pull?since=${since}`);
      await Online.flush();             // (wishes, saved stories and the News's place, made while the computer was off)
      merge(d, made);
      if (Reader.open && Reader.follow) Reader.follow(S.skew || 0);
      // the browser's ad and tracker lists come from the computer too, refreshed weekly
      if (A && A.updateAdblock && now() - A.adblockAge() > 7 * 86400) bridge("updateAdblock");
      S.syncError = "";
      S.lastSync = now();
      saveState();
      setTimeout(checkExpiring, 1500);
      await fetchSent(d.queue || []);
      refreshCopies();
      // the catalogue and the News fetched ahead, a little after a sync (at most every half hour), so they open at once
      if (now() - (sync.warmed || 0) > 1800) { sync.warmed = now(); setTimeout(async () => {
        try { await Catalogue.warm(); } catch (e) {}
        for (const p of ["/sync/news/science", "/sync/news/local"]) { try { await api("GET", p); } catch (e) { break; } }
      }, 5000); }
    } catch (e) {
      S.syncError = e.offline ? "offline" : e.message;
      if (e.status === 401) { S.syncError = "This phone was unpaired on the computer. Pair it again in Settings."; }
    } finally {
      S.syncing = false; syncP = null;
      paintPill();
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && $("#view").contains(document.activeElement);
      if (!Reader.open && $("#sheet").hidden && !typing) render();        // (never under someone typing)
    }
  })();
  return syncP;
}
function merge(d, made = {}) {
  const skew = S.skew = d.now ? d.now - now() : 0;        // (the computer's clock minus ours)
  if (d.full) { S.items = {}; S.anns = {}; S.journal = {}; }
  // journal rows and entries made here and now saved on the computer: drop the phone's temporary copies
  // (the computer's come in below); ones not sent yet stay
  const pendingCids = new Set(S.jops.map((o) => o.cid || o.log_cid).filter(Boolean));
  const localLogs = S.log.filter((l) => String(l.id).startsWith("c:") && pendingCids.has(String(l.id).slice(2)));
  for (const [id, e] of Object.entries(S.journal)) if (String(id).startsWith("c:") && (made[id.slice(2)] || !pendingCids.has(id.slice(2)))) delete S.journal[id];
  if (d.log) S.log = d.log.concat(localLogs);
  Journal.remap(made);
  for (const x of d.deleted || []) {
    if (x.kind === "journal") delete S.journal[x.ref_id];
    if (x.kind === "log") {
      S.log = S.log.filter((l) => l.id !== x.ref_id);
      for (const [id, j] of Object.entries(S.journal)) if (j.log_id === x.ref_id) delete S.journal[id];
    }
  }
  for (const it of d.items || []) {
    const mine = S.items[it.id];
    // keep anything changed here after the computer's copy (sent on the next sync); not an older one it already has
    if (mine) for (const op of S.ops.filter((o) => o.id === it.id)) if (op.ts + skew > ((it.clock || {})[op.field] || 0)) it[op.field] = op.value;
    S.items[it.id] = it;
  }
  for (const a of d.annotations || []) S.anns[a.id] = a;
  for (const x of d.deleted || []) {
    if (x.kind === "item") delete S.items[x.ref_id];
    if (x.kind === "annotation") delete S.anns[x.ref_id];
  }
  S.colls = d.collections || S.colls;
  for (const j of d.journal || []) S.journal[j.id] = j;
  if (d.remote !== undefined && d.remote !== S.conn.remote) { S.conn.remote = d.remote || S.conn.remote; pushConn(); }
  if (d.pc) S.conn.pc = d.pc;
  if (d.theme) { S.theme = d.theme; applyTheme(); }
  S.since = d.now;
  if (d.profiles) Prof.fromServer(d.profiles, d.profile);
  if (d.bulletin_period && d.bulletin_period !== S.bulletinPeriod) { S.bulletinPeriod = d.bulletin_period; saveState(); }
  if (d.bulletin && d.bulletin.week) Bulletin.fromServer(d.bulletin);
  // this profile's website time limits follow it: the computer's list is the one (the first time, this phone's goes up)
  if (A && A.setSiteLimits && "site_limits" in d) {
    if (d.site_limits && typeof d.site_limits === "object") A.setSiteLimits(JSON.stringify(d.site_limits));
    else { let l = {}; try { l = JSON.parse(A.siteLimits()).limits || {}; } catch (e) {} if (Object.keys(l).length) sendLimits(); }
  }
  if (Array.isArray(d.bookmarks) && A && A.setBookmarks) syncBookmarks(d.bookmarks);
  Prof.apply();          // (what just arrived is the computer's progress: another profile's goes back on top)
  saveLibrary();
}
// a reading copy remade on the computer (a better converter): the one on the phone is fetched again (once per new size)
function refreshCopies() {
  if (!A) return;
  refreshFiles();
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem("copy-refreshed") || "{}"); } catch (e) {}
  for (const it of Object.values(S.items)) {
    const have = S.files[fileName(it)];
    if (!isCopy(it) || !it.has_file || !it.file_size || !have || S.downloads[it.id] || have === it.file_size || seen[it.id] === it.file_size) continue;
    seen[it.id] = it.file_size;
    if (WEB) A.deleteFile(fileName(it));          // (the iPhone keeps pieces of the old file; Android replaces it)
    getFile(it, true);
  }
  try { localStorage.setItem("copy-refreshed", JSON.stringify(seen)); } catch (e) {}
}
// files the computer sent ("Send to phone"): fetch them, then tell it they arrived
async function fetchSent(queue) {
  const arrived = [];
  for (const id of queue) {
    const it = S.items[id];
    if (!it) { arrived.push(id); continue; }
    if (onPhone(it)) { arrived.push(id); continue; }
    if (!S.downloads[id] && S.autoGet) await getFile(it, true);
  }
  if (arrived.length) api("POST", "/sync/sent", { ids: arrived }).catch(() => {});
}
setInterval(() => { if (!document.hidden && !Reader.open) sync(); }, 60000);

/* ---------------------------------------------------------------- files on the phone */
const fileName = (it) => `${it.id}.${(it.file_type || "bin").toLowerCase()}`;
const onPhone = (it) => !!S.files[fileName(it)] && !S.downloads[it.id];
/* a paper's reading copy is one of its versions, not a book of its own */
const isCopy = (it) => String(it?.source || "").startsWith("reading-copy:");
const copyOf = (it) => it && !isCopy(it) ? Object.values(S.items).find((x) => x.source === `reading-copy:${it.id}` && x.has_file) : null;
const hereAny = (it) => onPhone(it) || !!(copyOf(it) && onPhone(copyOf(it)));
function whichVersion(it, verb, ok) {
  const c = copyOf(it);
  const opts = [[`Original ${String(it.file_type || "").toUpperCase()}${it.file_size ? " (" + fmtSize(it.file_size) + ")" : ""}`, it],
    [`Reading copy (EPUB${c && c.file_size ? ", " + fmtSize(c.file_size) : ""})`, c]].filter(([, x]) => x && ok(x));
  if (opts.length < 2) return Promise.resolve(opts[0] ? opts[0][1] : null);
  return askKeep(`${verb} which version?`, "The reading copy reflows on small screens, with figures and tables at the end.",
    [...opts.map(([l, x], i) => [l, x, i ? "" : "primary"]), ["Cancel", null]]);
}
function readHere(it) { return whichVersion(it, "Read", onPhone).then((v) => v && Reader.start(v)); }
function refreshFiles() { if (A) try { S.files = JSON.parse(A.files()); } catch (e) {} }
async function getFile(it, quiet) {
  if (!A || !it.has_file) return;
  if (it.file_size && A.freeSpace() < it.file_size + 50e6) return toast("Not enough space on the phone for this file.");
  const r = await bridge("download", it.id, fileName(it), it.title || fileName(it));
  if (r.status !== 200) { if (!quiet) toast(r.text || "Couldn't start the download."); return; }
  S.downloads[it.id] = Number(r.text);
  saveState();
  if (!quiet) toast(`Getting “${it.title}” from your computer…`);
  watchDownloads();
}
/* getting one volume of a series (or episode of a show): which of the others come too? Resolves to the items to
   get (the one tapped first), or null if it's dismissed */
function pickSeries(it) {
  const k = inSeries(it) && seriesKey(it.series);
  const rest = !k ? [] : Object.values(S.items).filter((x) => x.id !== it.id && x.has_file && !isCopy(x) && inSeries(x) && seriesKey(x.series) === k && !onPhone(x) && !S.downloads[x.id]);
  if (!rest.length) return Promise.resolve([it]);
  const all = [it, ...rest].sort(seriesOrder);
  const label = (x) => x.kind === "tv" && x.season != null ? `S${x.season}${x.episode != null ? " E" + x.episode : ""} · ${x.title}` : x.title;
  return new Promise((done) => {
    const w = document.createElement("div");
    w.className = "keep-ask";
    w.innerHTML = `<form class="ka-card sp-card" role="dialog"><h3>Get more of “${esc(it.series)}”?</h3>
      <p>Tick what to bring to the phone now (tick a later one and everything in between comes too). The rest can come later.</p>
      <div class="sp-quick"><button type="button" class="btn sm" data-sp="all">All</button><button type="button" class="btn sm" data-sp="none">Only this one</button></div>
      <div class="sp-list">${all.map((x) => `<label class="sp-row ${x.id === it.id ? "first" : ""}"><input type="checkbox" value="${x.id}" ${x.id === it.id ? "checked" : ""}><span>${esc(label(x))}</span><small>${x.file_size ? fmtSize(x.file_size) : ""}</small></label>`).join("")}</div>
      <div class="ka-row"><button class="btn primary" data-sp-go></button><button type="button" class="btn" data-x>Cancel</button></div></form>`;
    const boxes = [...w.querySelectorAll(".sp-list input")];
    const picked = () => boxes.filter((b) => b.checked).map((b) => S.items[b.value]);
    const paint = () => {
      const p = picked(), size = p.reduce((n, x) => n + (x.file_size || 0), 0);
      const go = w.querySelector("[data-sp-go]");
      go.disabled = !p.length;
      go.textContent = p.length ? `⬇ Get ${p.length === 1 ? "1" : p.length}${size ? " (" + fmtSize(size) + ")" : ""}` : "Tick something to get";
    };
    let last = all.indexOf(it);           // (tick one, then another further down: everything between comes too)
    w.addEventListener("click", (e) => {
      const q = e.target.closest("[data-sp]");
      if (q) { boxes.forEach((b) => (b.checked = q.dataset.sp === "all" || Number(b.value) === it.id)); paint(); }
      if (e.target.closest("[data-x]") || e.target === w) { w.remove(); done(null); }
    });
    w.addEventListener("change", (e) => {
      const i = boxes.indexOf(e.target);
      if (i < 0) return;
      if (e.target.checked && last != null && last !== i && boxes[last].checked) {
        const [a, b] = last < i ? [last, i] : [i, last];
        for (let j = a; j <= b; j++) boxes[j].checked = true;
      }
      last = e.target.checked ? i : null;
      paint();
    });
    w.querySelector("form").onsubmit = (e) => { e.preventDefault(); const p = picked(); w.remove(); done(p.length ? p : null); };
    paint();
    document.body.append(w);
  });
}
async function getFiles(list) {
  const size = list.reduce((n, x) => n + (x.file_size || 0), 0);
  if (A && list.length > 1 && size && A.freeSpace() < size + 50e6) return toast(`Not enough space on the phone for all ${list.length} (${fmtSize(size)}).`);
  for (const x of list) await getFile(x, list.length > 1);
  if (list.length > 1) toast(`Getting ${list.length} from your computer…`);
}
function removeFile(it) {
  if (S.downloads[it.id]) { A.cancelDownload(S.downloads[it.id]); delete S.downloads[it.id]; saveState(); }
  A.deleteFile(fileName(it));
  refreshFiles();
}
let dlTimer = null;
function watchDownloads() {
  clearTimeout(dlTimer);
  const ids = Object.values(S.downloads);
  if (!ids.length || !A) return;
  try { S.dlState = JSON.parse(A.downloads(JSON.stringify(ids))); } catch (e) {}
  let finished = [];
  for (const [itemId, dl] of Object.entries(S.downloads)) {
    const st = S.dlState[dl];
    if (!st || st.state === "done") {
      delete S.downloads[itemId];
      if (st) finished.push(Number(itemId));
    } else if (st.state === "failed") {
      delete S.downloads[itemId];
      toast(`Download of “${(S.items[itemId] || {}).title || "a file"}” failed.`);
    }
  }
  if (finished.length) {
    saveState(); refreshFiles();
    api("POST", "/sync/sent", { ids: finished }).catch(() => {});
    toast(finished.length === 1 ? `“${(S.items[finished[0]] || {}).title}” is on your phone` : `${finished.length} files are on your phone`);
  }
  paintDownloads();
  if (Object.keys(S.downloads).length) dlTimer = setTimeout(watchDownloads, 1000);
}

/* ---------------------------------------------------------------- what's what */
const KINDS = [["all", "All"], ["book", "Books"], ["manga", "Manga"], ["comic", "Comics"], ["article", "Articles"], ["music", "Music"], ["tv", "TV"], ["movie", "Movies"], ["wish", "Wishlist"]];
function kindOf(it) {
  if (it.kind === "graphic") return it.format === "manga" ? "manga" : "comic";
  return it.kind;
}
function matches(it, k) {
  if (k === "all") return !it.wanted || it.has_file;
  if (k === "wish") return it.wanted && !it.has_file;
  return kindOf(it) === k && (!it.wanted || it.has_file);
}
const isVideo = (it) => it.kind === "tv" || it.kind === "movie";
const verb = (it) => (isVideo(it) ? "Watch" : it.kind === "music" ? "Play" : "Read");
const pct = (it) => Math.round(Math.min(1, it.watched ? 1 : it.progress || 0) * 100);
const byline = (it) => it.kind === "tv" ? [it.series, it.season != null ? `S${it.season} · E${it.episode}` : ""].filter(Boolean).join(" · ")
  : it.kind === "music" ? [it.album_artist || (it.authors || [])[0], it.album].filter(Boolean).join(" · ")
  : [(it.authors || []).slice(0, 2).join(", "), it.year].filter(Boolean).join(" · ");
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? Math.round(b / 1e6) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");
function ago(t) {
  const s = now() - t;
  return s < 90 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago";
}
function colorFor(it) {
  const pal = ((window.THEMES || {})[document.documentElement.dataset.theme] || {}).spines || ["#ff6b4a", "#4aa8ff", "#7ccf6b", "#b77cff"];
  let h = 7; for (const c of String(it.title || it.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pal[h % pal.length];
}
function cover(it, withBar = true) {
  const p = pct(it);
  // (a cover that can't be fetched falls back to the title on a coloured cover, like one with no picture)
  return `<span class="cov${it.has_cover ? "" : " nocov"}" style="--c:${colorFor(it)}">${it.has_cover ? `<img loading="lazy" alt="" src="/cover/${it.id}?v=${esc(it.cover_v || 0)}" onerror="this.parentNode.classList.add('nocov');this.remove()">` : ""}
    <span class="ph">${esc(it.title || "")}</span>${withBar && p > 1 ? `<span class="bar"><i style="width:${p}%"></i></span>` : ""}${onPhone(it) ? `<span class="here" title="On this phone">✓</span>` : ""}</span>`;
}
/* New arrivals come gift-wrapped (like the DS's presents): added in the last three weeks and not opened yet.
   The first tap unwraps it; remembered on this phone. */
const UNWRAPPED = new Set();
const unwrappedFile = () => (Prof.cur === "main" || Prof.cur === 1 ? "unwrapped.json" : `unwrapped-${Prof.cur}.json`);     // each profile unwraps its own
function loadUnwrapped() { UNWRAPPED.clear(); for (const id of load(unwrappedFile(), [])) UNWRAPPED.add(id); }
loadUnwrapped();
// only things that arrive after wrapping began count (the computer's import dates can be refreshed by a rescan)
const GIFT_SINCE = (() => { let t = load("giftsince.json", 0); if (!t) store("giftsince.json", t = Math.floor(Date.now() / 1000)); return t; })();
const isGift = (it) => !!it && it.has_file && it.kind !== "music" && !it.opened_at && !(it.progress > 0) && !it.watched
  && (it.added_at || 0) > Math.max(GIFT_SINCE, Date.now() / 1000 - 21 * 86400) && !UNWRAPPED.has(it.id);
const GIFT_WHAT = { book: "a book", graphic: "a comic", article: "an article", movie: "a film", tv: "a TV episode" };
/* the present over the home page's info card: two halves of paper, a ribbon, a bow and a gift tag */
function presentHTML(it) {
  if (!isGift(it)) return "";
  const what = it.kind === "graphic" && it.format === "manga" ? "a manga" : GIFT_WHAT[it.kind] || "something";
  return `<div class="present" data-gift="${it.id}"><i class="p-half l"></i><i class="p-half r"></i><i class="p-rib-v"></i><i class="p-rib-h"></i>
    <span class="p-bow"><i class="lp l"></i><i class="lp r"></i><i class="tl l"></i><i class="tl r"></i><i class="knot"></i></span>
    <span class="p-tag"><i class="p-hole"></i><small>To: you</small><b>It's ${what}!</b><em>tap to unwrap</em></span>
    ${[[10, 14, 0], [86, 18, 0.7], [18, 80, 1.3], [80, 76, 0.4]].map(([x, y, d]) => `<i class="p-sp" style="left:${x}%;top:${y}%;animation-delay:${d}s"></i>`).join("")}<span class="p-fx"></span></div>`;
}
document.addEventListener("click", (e) => {
  const g = e.target.closest(".present");
  if (!g || g.classList.contains("open")) return;
  e.preventDefault(); e.stopPropagation();
  const id = Number(g.dataset.gift);
  UNWRAPPED.add(id);
  store(unwrappedFile(), [...UNWRAPPED].slice(-2000));
  g.classList.add("open");
  setTimeout(() => g.remove(), 1100);
  $$(`[data-gift-card="${id}"]`).forEach((c) => c.classList.remove("wrapped"));
}, true);
const card = (it, sub) => `<button class="card" data-item="${it.id}">${cover(it)}<b>${esc(it.kind === "tv" ? it.series || it.title : it.title)}</b><small>${esc(sub ?? byline(it))}</small></button>`;
function row(it) {
  const dl = S.downloads[it.id] && S.dlState[S.downloads[it.id]];
  const p = pct(it);
  return `<button class="row" data-item="${it.id}">${cover(it, false)}<span class="t"><b>${esc(it.title || "Untitled")}</b><small>${esc(byline(it))}</small>
    ${p > 1 ? `<span class="p"><i style="width:${p}%"></i></span>` : ""}</span>
    ${dl ? `<span class="badge dl">${dl.total > 0 ? Math.round(100 * dl.done / dl.total) + "%" : "…"}</span>` : onPhone(it) ? `<span class="badge">On phone</span>` : ""}</button>`;
}

/* ---------------------------------------------------------------- screens */
function setTab(t) {
  // the Newsstand: the News and the catalogue share one tab (the masthead's last word swaps them); it opens on the one you had
  if (t === "press") t = S.press === "news" ? "news" : "catalogue";
  if (t === "news" || t === "catalogue") { if (S.press !== t) { S.press = t; saveState(); } }
  if (t !== "browser" && A && A.browserHide) { A.browserHide(); document.documentElement.classList.remove("bw-on"); }      // (the browser's page waits, out of sight)
  if (t !== "mail" && A && A.widgetsHide) A.widgetsHide();       // (the Mail tab's widgets are put out of sight)
  S.tab = t; S.limit = 60;
  // a sheet left open (a News story, an item) would sit over the tabs and the browser: another tab closes it
  if (!$("#sheet").hidden) { $("#sheet").hidden = true; Journal.close(); }
  const navT = t === "news" || t === "catalogue" ? "press" : t;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === navT));
  const ic = $(`#tabs [data-tab="${navT}"] b`);
  if (ic) $("#navNubIc").textContent = ic.textContent;     // the open tab's icon on the nub, so you know where you are
  render();
  $("#view").scrollTop = 0;
}
function render() {
  if (window.Widget) Widget.update();       // (the home-screen widget, when what it shows changed)
  // (the Galaxy theme's photo for each tab; not data-tab / data-area, which taps are matched against)
  document.documentElement.dataset.gTab = S.tab; document.documentElement.dataset.gArea = S.area || "books";
  const v = $("#view");
  const items = Object.values(S.items).filter((i) => !isCopy(i));
  if (S.tab === "apps" && window.AddOns) return AddOns.render(v);      // (your apps open whether or not a computer is paired)
  if (S.tab === "mail" && window.MailTab) return MailTab.render(v);       // (so does your mail)
  if (!S.conn.token && S.tab !== "settings") {
    v.innerHTML = `<div class="empty"><h2>Welcome</h2><p>This app shows the library on your computer: your books, manga, comics, articles, music, TV and films, where you are in each one, and anything you've sent to your phone.</p>
      <button class="btn primary" data-go="settings">Pair with your computer</button></div>`;
    return;
  }
  if (S.tab === "home") return renderHome(v, items);
  if (S.tab === "library") return renderLibrary(v, items);
  if (S.tab === "journal") return Journal.render(v);
  if (S.tab === "browser") return renderBrowser(v);
  if (S.tab === "catalogue") return Catalogue.render(v);
  if (S.tab === "news") return NewsTab.render(v);
  if (S.tab === "mail" && window.MailTab) return MailTab.render(v);
  if (S.tab === "phone") return renderPhone(v, items);
  return renderSettings(v);
}

/* ---------------------------------------------------------------- the browser tab: start page and history
   (the browser itself is its own screen, BrowserActivity) */
const WIKI = "https://en.wikipedia.org/w/index.php?search=";
// (the split view's own "other half" page isn't a site you visited)
function history() { try { return JSON.parse(A ? A.browserHistory() : "[]").filter((x) => /^https?:/.test(x.url || "") && !/^https?:\/\/babel\.invalid\//.test(x.url)); } catch (e) { return []; } }
/* The browser lives on this tab (Android): with a page open it fills the room beside the app's tabs, and stays as it
   was while you're on other tabs, until ✕ closes it; then the start page below shows again. */
const browserPage = () => { try { const o = A && !WEB && A.browserOpen && A.browserOpen(); return o ? JSON.parse(o) : null; } catch (e) { return null; } };
function browserRect() {
  let top = 0, right = innerWidth;
  if (document.documentElement.dataset.nav === "drawer") top = Math.round($(".top").getBoundingClientRect().bottom);     // (☰ stays reachable)
  else if (!S.tabsOff) right = Math.round($("#tabs").getBoundingClientRect().left) || innerWidth;
  const cut = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cut")) || 0;      // (the camera hole)
  // tabs hidden: the page has the whole width, and the orange tab floats over it (drawn by the phone, at the same height)
  const nub = !!S.tabsOff;
  const bar = $("#jxBar");      // (the music bar, below the page: its controls stay in reach)
  const bottom = bar ? Math.round(bar.getBoundingClientRect().top) - 6 : innerHeight;
  return { x: 0, y: top, w: right, h: bottom - top, cut, nub, nubY: S.nubY || 0.5 };
}
function placeBrowser() {
  if (S.tab === "mail" && window.MailTab) return MailTab.place();      // (the Mail tab's browser sits in the same room)
  const o = browserPage();
  if (!o || !(o.url || o.alive)) return;
  if (S.tab !== "browser" || !A || !A.browserShow || document.body.classList.contains("nav-open") || Reader.open) { document.documentElement.classList.remove("bw-on"); return A && A.browserHide && A.browserHide(); }
  document.documentElement.classList.add("bw-on");       // (the app behind the page rests: smoother video)
  A.browserShow(JSON.stringify(browserRect()));
}
addEventListener("resize", () => { if (S.tab === "browser" && browserPage()) placeBrowser(); });
window.Native.browserClosed = () => { if (S.tab === "browser") render(); };
/* the profile's bookmarks, as the computer has them; ☆ pressed here while it couldn't be reached is sent now */
/* the profile's website time limits, sent to the computer (so they follow the profile to its other phones) */
function sendLimits() {
  if (!S.conn.token || !Prof.server || !A || !A.siteLimits) return;
  let l = {}; try { l = JSON.parse(A.siteLimits()).limits || {}; } catch (e) {}
  api("POST", "/sync/sitelimits", { limits: l }).catch(() => {});
}
function syncBookmarks(list) {
  let mine = []; try { mine = JSON.parse(A.bookmarks()); } catch (e) {}
  const have = new Set(list.map((b) => b.url));
  const waiting = mine.filter((b) => b.pending && !have.has(b.url));
  A.setBookmarks(JSON.stringify([...list, ...waiting]));
  for (const b of waiting) api("POST", "/sync/bookmarks", { url: b.url, title: b.title || "" }).then((d) => A.setBookmarks(JSON.stringify(d.items || []))).catch(() => {});
}
function renderBrowser(v) {
  const open = browserPage();
  if (open && (open.url || open.alive)) { v.innerHTML = `<div class="bw-hole" id="bwHole"></div>`; return requestAnimationFrame(placeBrowser); }
  if (A && A.browserHide) A.browserHide();
  document.documentElement.classList.remove("bw-on");
  const h = history().reverse();
  const words = S.bq.toLowerCase().split(/\s+/).filter(Boolean);
  const list = h.filter((x) => words.every((w) => (x.url + " " + (x.title || "")).toLowerCase().includes(w)));
  // your bookmarks (☆ in the browser, here or on the computer) are the start page's sites
  let bms = []; try { bms = JSON.parse(A ? A.bookmarks() : "[]"); } catch (e) {}
  const sites = bms.map((b) => { let s = b.site; try { s = s || new URL(b.url).hostname.replace(/^www\./, ""); } catch (e) {} return { url: b.url, title: b.title || s, site: s || "?", id: b.id }; });
  if (!renderBrowser.fetched && S.conn.token) {        // the computer's list is the real one: fetch it once per visit
    renderBrowser.fetched = true;
    api("GET", "/sync/bookmarks").then((d) => { A.setBookmarks(JSON.stringify(d.items || [])); if (S.tab === "browser") render(); }).catch(() => {});
  }
  let html = "", cur = "";
  for (const x of list.slice(0, S.limit)) {
    const d = new Date(x.t * 1000).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    if (d !== cur) { html += `${cur ? "</div>" : ""}<h3 class="j-month">${esc(d)}</h3><div class="list">`; cur = d; }
    html += `<button class="row b-row" data-go-url="${esc(x.url)}"><span class="t"><b>${esc(x.title || x.url)}</b><small>${esc(x.url)}</small></span><small class="hint">${new Date(x.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small><span class="b-del" data-hdel="${esc(x.url)}" data-ht="${x.t}" role="button" aria-label="Remove from history">✕</span></button>`;
  }
  if (cur) html += "</div>";
  const last = h[0], H = "dash";
  const day = esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }));
  const form = (place = "Search, or type an address") => `<form class="bw-search" id="bForm"><span class="bw-mag">⌕</span><input id="bAddr" type="search" placeholder="${esc(place)}" autocomplete="off"></form>`;
  const btns = `<div class="bw-btns"><button class="bw-go" form="bForm"><span class="bd">⌕</span>Search</button><button class="bw-wiki" id="bWiki" type="button"><span class="bd">W</span>Wikipedia</button>
        ${last ? `<button class="bw-again" type="button" data-go-url="${esc(last.url)}" aria-label="Reopen the last page"><span>↺</span></button>` : ""}</div>`;
  const letter = (s) => esc(s.site[0].toUpperCase());
  // the start page: a big clock and the search, where you left off, then your bookmarks
  const host = (s) => esc(s.site.replace(/^www\./, ""));
  const start = `<section class="hm-dash"><div class="hm-clock">${esc(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</div><div class="bw-day">${day}</div>${form()}${btns}
        ${last ? `<button class="hm-resume" type="button" data-go-url="${esc(last.url)}"><small>Pick up where you left off</small><b>${esc(last.title || last.url)}</b></button>` : ""}</section>
      ${sites.length ? `<h3 class="hm-h">Bookmarks <small>${sites.length}</small></h3><div class="hm-dial">${sites.map((s) => `<button class="hm-key" data-go-url="${esc(s.url)}"><i>${letter(s)}</i><span><b>${esc(s.title || s.site)}</b><small>${host(s)}</small></span><span class="bw-unpin" data-unpin="${esc(s.url)}" role="button" aria-label="Remove bookmark">✕</span></button>`).join("")}</div>` : ""}`;
  // the page you left open in the browser (‹ Library or Back keeps it): one tap goes back to it
  v.innerHTML = `<div class="bw-page home-${H}"><div class="bw-top"><button class="btn sm bw-stylebtn" id="bStyle" type="button">🧭 Layout</button></div>
    <div class="bw-stylepick" id="bStylePick" ${S.bPick ? "" : "hidden"}>${WEB ? "" : "<h4>Browser controls</h4>"}${WEB ? "" : BLAYOUTS.map(([k, n, d]) => `<button class="bw-bpick ${S.blayout === k ? "on" : ""}" data-blpick="${k}"><i class="lo lo-${k}"><b></b></i><b>${n}</b><small>${d}</small></button>`).join("")}
      ${WEB ? "" : `<h4>A second page</h4>${[["split", "⧉", "Split", "Two pages, one above the other"], ["swap", "⇄", "Swap", "One page at a time: the button swaps to the other"]].map(([k, g, n, d]) => `<button class="bw-bpick ${(S.bsecond === "swap" ? "swap" : "split") === k ? "on" : ""}" data-bspick="${k}"><i class="so">${g}</i><b>${n}</b><small>${d}</small></button>`).join("")}`}</div>
    ${start}
    <button class="btn bw-histbtn" id="bHist" type="button">🕘 History</button>
    ${sites.length ? "" : `<p class="bw-nobm">No bookmarks yet. Press ☆ on the browser's bar while you're on a page (here or on your computer) and it shows up here.</p>`}
    <p class="hint">${WEB ? "Pages open in Safari (with its own passwords, Reader view and content blockers). Pages you open from here are listed in History." : `Ads and pop-ups blocked. ${S.bsecond === "swap" ? "⇄ on the browser's bar opens a second page and swaps between the two (✕ closes the one you're on)." : "⧉ on the browser's bar splits it in two."} Saved passwords: Settings → Passwords.`}</p>
    <div class="bw-sheet${S.bOpen ? " open" : ""}" id="bSheet">
      <div class="bw-sheet-head"><b>History</b><button class="btn sm" id="bHistClose" type="button" aria-label="Close history">✕</button></div>
      <div class="bw-sheet-body">
        <div class="searchrow"><input id="bq" type="search" placeholder="Search history" value="${esc(S.bq)}"><button class="btn" id="bClear">Clear…</button></div>
        <div class="chips" id="bClearPick" ${S.bSites ? "" : "hidden"}><button data-bclear="hour">Last hour</button><button data-bclear="today">Today</button><button data-bclear="all">All history</button>
          ${WEB ? "" : `<button data-bclear="sites" class="${S.bSites ? "on" : ""}">A website…</button><button data-bclear="cookies">🍪 Cookies &amp; site data</button>`}</div>
        ${S.bSites ? sitesHtml(h) : `${html || `<p class="empty">${S.bq ? "Nothing matches." : "Pages you visit show up here."}</p>`}
        ${list.length > S.limit ? `<button class="btn more" id="more">Show more</button>` : ""}`}
      </div></div>
    <div class="bw-shade${S.bOpen ? " on" : ""}" id="bShade"></div></div>`;
  historySheet();
  $("#bStyle").onclick = () => { S.bPick = !S.bPick; $("#bStylePick").hidden = !S.bPick; };
}
/* passwords: import a CSV export (Java reads, encrypts and stores it, then answers at Native.pwImported) */
window.Native.pwImported = (r) => {
  if (!r) return;
  if (r.error) return toast(r.error);
  toast(`Imported: ${r.added} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ""}. Delete the exported file now: it isn't encrypted.`);
  if (S.tab === "browser" || S.tab === "settings") render();
};
document.addEventListener("click", (e) => {
  if (e.target.closest?.("#pwImport")) return A && A.importPasswords();
  if (e.target.closest?.("#pwClear")) { if (confirm("Remove all the passwords saved on this phone? Your computer's aren't touched.")) { A.clearPasswords(); toast("Passwords removed"); render(); } return; }
  const un = e.target.closest?.("[data-unpin]");
  if (un) {        // a bookmark's ✕: off this phone's list now, and off the computer's
    e.stopImmediatePropagation();
    const url = un.dataset.unpin;
    try { A.setBookmarks(JSON.stringify(JSON.parse(A.bookmarks()).filter((b) => b.url !== url))); } catch (err) {}
    api("POST", "/sync/bookmarks", { url, remove: true }).then((d) => A.setBookmarks(JSON.stringify(d.items || []))).catch(() => {});
    return render();
  }
  const hp = e.target.closest?.("[data-bhpick]");
  if (hp) { S.bhome = hp.dataset.bhpick; S.bPick = false; saveState(); return render(); }
  const sp = e.target.closest?.("[data-bspick]");
  if (sp) { S.bsecond = sp.dataset.bspick; S.bPick = false; toast(S.bsecond === "swap" ? "⇄ on the browser's bar now swaps between two pages" : "⧉ on the browser's bar now splits it in two"); saveState(); applyTheme(); return render(); }
  const b = e.target.closest?.("[data-blpick]");
  if (!b) return;
  S.blayout = b.dataset.blpick; S.bPick = false;
  toast("The browser will open in this layout");
  saveState(); applyTheme(); render();
});
/* history opens from its button as a sheet over the Browser tab; ✕ or a tap outside it puts it away */
function historySheet() {
  const set = (open) => { S.bOpen = open; $("#bSheet").classList.toggle("open", open); $("#bShade").classList.toggle("on", open); };
  $("#bShade").onclick = $("#bHistClose").onclick = () => set(false);
  $("#bHist").onclick = () => set(true);
}
/* privacy: the websites in your history, each one forgotten in one go (its pages, its cookies, what it stored) */
const siteOf = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); if (/^[\d.]+$|^\[|^localhost$/.test(h)) return h; const p = h.split("."); return p.length > 2 && p[p.length - 1].length === 2 && /^(co|com|net|org|ac|or|ne|go)$/.test(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join("."); } catch (e) { return ""; } };
function sitesHtml(h) {
  const by = new Map();
  for (const x of h) { const s = siteOf(x.url); if (!s) continue; const o = by.get(s) || { n: 0, last: 0 }; o.n++; o.last = Math.max(o.last, x.t); by.set(s, o); }
  const words = S.bq.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [...by].filter(([s]) => words.every((w) => s.includes(w))).sort((a, b) => b[1].last - a[1].last)
    .map(([s, o]) => `<div class="row b-site"><span class="t"><b>${esc(s)}</b><small>${o.n} page${o.n === 1 ? "" : "s"} · last ${esc(ago(o.last))}</small></span><button class="btn sm danger" data-forget="${esc(s)}" type="button">Forget</button></div>`).join("");
  return `<p class="hint">Forgetting a website takes its pages off your history and deletes its cookies and what it stored on the phone (you'll be signed out of it).</p><div class="list">${rows || `<p class="empty">No websites in your history.</p>`}</div>`;
}
function forgetSite(site) {
  if (!confirm(`Forget ${site}? Its pages come off your history, and its cookies and saved data are deleted (you'll be signed out of it).`)) return;
  const all = history(), hosts = [...new Set(all.filter((x) => siteOf(x.url) === site).map((x) => { try { return new URL(x.url).hostname; } catch (e) { return ""; } }).filter(Boolean))];
  A.setBrowserHistory(JSON.stringify(all.filter((x) => siteOf(x.url) !== site)));
  if (A.forgetSite) A.forgetSite(site, JSON.stringify(hosts));
  toast(`${site} forgotten`);
  render();
}
document.addEventListener("click", (e) => {
  const d = e.target.closest?.("[data-hdel]");
  if (d) {           // one page off the history
    e.stopImmediatePropagation(); e.preventDefault();
    const u = d.dataset.hdel, t = Number(d.dataset.ht);
    A.setBrowserHistory(JSON.stringify(history().filter((x) => !(x.url === u && x.t === t))));
    return render();
  }
  const f = e.target.closest?.("[data-forget]"); if (f) { e.stopImmediatePropagation(); return forgetSite(f.dataset.forget); }
}, true);
function clearHistory(which) {
  if (which === "sites") { S.bSites = !S.bSites; return render(); }
  if (which === "cookies") {
    if (!confirm("Delete every website's cookies and saved data on this phone? You'll be signed out of websites. Your history and bookmarks stay.")) return;
    A.clearSiteData(JSON.stringify([...new Set(history().map((x) => { try { return new URL(x.url).hostname; } catch (e) { return ""; } }).filter(Boolean))]));
    return toast("Cookies and site data deleted");
  }
  const since = which === "all" ? 0 : which === "today" ? new Date().setHours(0, 0, 0, 0) / 1000 : now() - 3600;
  A.setBrowserHistory(JSON.stringify(history().filter((x) => x.t < since)));
  render();
  toast(which === "all" ? "All history cleared" : "History cleared");
}
/* Home: two pages, swapped with the ⇄ button in the corner: what's on this phone (the wheel), and The Bulletin */
function renderHome(v, items) {
  if (!W.tabs[W.tab]) W.tab = "phone";
  const coming = Object.keys(S.downloads).map((id) => S.items[id]).filter(Boolean);
  const coming2 = coming.length ? `<section class="sec"><h2>Coming from your computer</h2><div class="list" id="dlList">${coming.map(row).join("")}</div></section>` : "";
  if (W.tab === "bulletin") { v.innerHTML = `${uploadsHtml()}${Bulletin.html()}${swapHtml()}`; return Bulletin.after(); }
  // what's on the phone, the things you're in the middle of first, then the newest arrivals
  const here = items.filter((i) => hereAny(i) && i.kind !== "music")
    .sort((a, b) => (b.opened_at || 0) - (a.opened_at || 0) || (b.added_at || 0) - (a.added_at || 0));
  W.list = here.slice(0, 80);
  W.sel = Math.min(W.sel, Math.max(0, W.list.length - 1));
  const thumb = (it) => it.has_cover ? `<img alt="" src="/cover/${it.id}?v=${esc(it.cover_v || 0)}" onerror="this.remove()">` : `<i style="--c:${colorFor(it)}">${esc(W.title(it)[0])}</i>`;
  v.innerHTML = `${uploadsHtml()}${coming2}
    <div class="ss" id="ss">
      <div class="ss-bg" id="ssBg"></div>
      ${window.AddOns ? AddOns.dock() : ""}
      <section class="ss-info" id="ssInfo"></section>
      <div class="ss-stage"><div class="ss-wheel" id="ssWheel">${W.list.map((it, i) => {
        const [st, label] = W.status(it), p = pct(it);
        return `<button class="ss-card ${isGift(it) ? "wrapped" : ""}" data-ss="${i}" data-gift-card="${it.id}"><span class="ss-th">${thumb(it)}</span>
          <span class="ss-t"><b>${esc(W.title(it))}</b><small>${esc(it.kind === "tv" ? `S${it.season || 1} · E${it.episode ?? "?"}` : byline(it))}</small>
          <em class="ss-st st-${st}">${label}</em></span>
          ${p > 1 && p < 100 ? `<span class="ss-prog"><i style="width:${p}%"></i></span>` : ""}</button>`;
      }).join("")}
        ${W.list.length ? "" : `<p class="ss-empty">Nothing on this phone yet. Open something in the Library and tap “⬇ Get from computer”.</p>`}</div></div>
    </div>${swapHtml()}`;
  W.place();
}

/* Home: the computer's TV & Movies wheel, on the phone. Cards fan out down the left; swipe up and down to turn it, tap a
   card to pick it, tap it again to open it. */
const W = {
  sel: 0, list: [], tab: "bulletin",            // (the app opens on the Bulletin)
  tabs: { phone: "On this phone", bulletin: "The Bulletin" },
  title: (it) => (it.kind === "tv" ? it.series || it.title : it.title) || "Untitled",
  kindName: (it) => (it.kind === "graphic" ? (it.format === "manga" ? "Manga" : "Comic") : { book: "Book", article: "Article", tv: "TV series", movie: "Film" }[it.kind] || it.kind),
  /* where you are with it, in words that suit the kind of thing it is (the journal's status wins) */
  status(it) {
    const k = it.kind === "tv" ? String(it.series || "").toLowerCase() : null;
    // (the journal is the main profile's: another profile goes by its own progress)
    const l = !Prof.isMain() ? null : S.log.find((x) => x.item_id === it.id) || (k && S.log.find((x) => x.kind === "show" && String(x.title).toLowerCase() === k));
    const j = l ? l.status || (l.finished ? "finished" : "") : "", p = pct(it);
    if (j === "hold") return ["hold", "On hold"];
    if (j === "dropped") return ["dropped", "Dropped"];
    if (j === "next" && !it.watched && p < 98) return ["next", "Up next"];
    if (it.kind === "tv" || it.kind === "movie") return it.watched || p >= 98 ? ["done", "Watched"] : p > 0 ? ["now", "Now showing"] : ["new", "Not started"];
    if (j === "finished" || p >= 98) return ["done", "Finished"];
    if (j === "reading" || p > 0) return ["now", "Reading"];
    return ["new", it.kind === "article" ? "Unread" : "Not started"];
  },
  place() {
    $$("#ssWheel .ss-card").forEach((c, i) => {
      const d = i - this.sel, a = Math.abs(d);
      c.classList.toggle("on", d === 0);
      c.style.display = a > 7 ? "none" : "";
      // like the computer's wheel: the chosen card sticks out, the others lean back the further away they are
      c.style.transform = `translate(${d === 0 ? 8 : -4 - Math.min(a, 5) * 6}px, calc(${d} * (var(--ss-h) + 8px) - 50%))`;
      c.style.opacity = a > 5 ? 0 : 1 - Math.max(0, a - 3) * 0.25;
      c.style.zIndex = 20 - a;
    });
    const it = this.list[this.sel], info = $("#ssInfo"), bg = $("#ssBg");
    if (!info) return;
    if (!it) { info.innerHTML = ""; bg.style.backgroundImage = "none"; return; }
    bg.style.backgroundImage = it.has_cover ? `url(/cover/${it.id}?v=${it.cover_v || 0})` : "none";
    bg.style.setProperty("--c", colorFor(it));
    const [st, label] = this.status(it), p = pct(it);
    info.innerHTML = `${presentHTML(it)}<span class="ss-cov" data-item="${it.id}">${cover(it, false)}<em class="ss-stamp st-${st}">${label}</em></span>
      <span class="ss-meta"><small class="ss-kind">${esc(this.kindName(it))}</small><b>${esc(this.title(it))}</b>
        <small>${esc(it.kind === "tv" ? `Season ${it.season || 1}, episode ${it.episode ?? "?"}` : byline(it))}</small>
        <span class="ss-bar"><i style="width:${p}%"></i></span><small>${label}${p > 1 && p < 100 ? ` · ${p}%` : ""} · ${this.sel + 1} of ${this.list.length}</small>
        ${it.summary ? `<span class="ss-syn">${esc(it.summary)}</span>` : ""}</span>`;
  },
  move(n) { const s = Math.max(0, Math.min(this.list.length - 1, this.sel + n)); if (s !== this.sel) { this.sel = s; this.place(); } },
  open() { const it = this.list[this.sel]; if (!it) return; if (hereAny(it)) readHere(it); else openSheet(it.id); },
};
(() => {   // swiping the wheel: every 40px of drag is one card
  let y0 = null, moved = false;
  document.addEventListener("touchstart", (e) => { if (e.target.closest("#ssWheel")) { y0 = e.touches[0].clientY; moved = false; } }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    e.preventDefault();
    const dy = e.touches[0].clientY - y0;
    const n = Math.trunc(dy / 40);
    if (n) { W.move(-n); y0 += n * 40; moved = true; }
  }, { passive: false });
  document.addEventListener("touchend", () => { y0 = null; setTimeout(() => (moved = false), 50); });
  document.addEventListener("click", (e) => {
    if (moved && e.target.closest("#ssWheel")) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
})();
/* the swap button, in the same corner on both home pages: it says where it goes next */
function swapHtml() {
  const next = W.tab === "bulletin" ? "phone" : "bulletin";
  // two page tabs at the top of Home, the open one lit (a sideways swipe on Home turns the page too)
  // a switch in the corner: both pages' pictures, the knob slides to the one you're on (a sideways swipe works too)
  const anim = W.swapAnim ? " anim" : ""; W.swapAnim = false;
  return `<button class="hw-sw at-${W.tab === "bulletin" ? "b" : "p"}${anim}" data-hw-tab="${next}" type="button" role="switch" aria-checked="${W.tab === "bulletin"}" aria-label="On this phone or The Bulletin: now ${esc(W.tabs[W.tab])}"><span class="hw-sw-knob" aria-hidden="true"></span><span class="hw-sw-ic">📱</span><span class="hw-sw-ic">📰</span></button>`;
}

/* Home → The Bulletin, the computer's weekly magazine on the phone: this week's challenge as the cover story (finish
   something you're partway through, or revisit something finished long ago), Hot Off the Press from the catalogue,
   Still in the Wrapper (things you own but never opened), and the dailies: Wikipedia's article and Wikiquote's quote of
   the day. Picked once a week,
   and for whoever's profile is in use. */
const Bulletin = (() => {
  const DAY = 86400;
  const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() / 1000; };
  // the challenge lasts a week or a month, per profile (set on the computer or in Settings here, synced); the rest stays weekly
  const monthly = () => S.bulletinPeriod === "month";
  const periodStart = () => { if (!monthly()) return weekStart(); const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000; };
  const word = () => monthly() ? "month" : "week";
  const rng = (seed) => { let a = 0; for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const shuffle = (list, r) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const file = () => `challenge-${Prof.cur}.json`;
  let picks = null, potd;
  const items = () => Object.values(S.items).filter((i) => !isCopy(i));

  function finishedAt(it) {
    const l = Prof.isMain() && S.log.find((x) => x.item_id === it.id);
    const f = l && l.finished ? Date.parse(l.finished) / 1000 : 0;
    return f || it.watched_at || (pct(it) >= 98 ? it.opened_at : 0) || 0;
  }
  /* a series is read in order: whatever volume turns up, the suggestion is the first one on your shelves that you
     haven't finished */
  const firstUnread = (it) => {
    if (!inSeries(it)) return it;
    const k = seriesKey(it.series);
    return items().filter((x) => x.has_file && x.kind === it.kind && inSeries(x) && seriesKey(x.series) === k).sort(seriesOrder)
      .find((x) => W.status(x)[0] !== "done") || it;
  };
  // the challenge: a volume you've started is to be finished, one you haven't is to be started
  function inOrder(it, type, cur, reroll) {
    if (type === "revisit") return [it, type];
    const f = firstUnread(it);
    if (reroll && cur && f.id === cur.id) return [it, type];
    return [f, W.status(f)[0] === "now" ? "finish" : "start"];
  }
  function challenge(reroll = false) {
    const wk = periodStart(), cur = load(file(), null);
    const ci = cur && S.items[cur.id];
    if (cur && cur.week === wk && !reroll && ci && (cur.type === "revisit" || W.status(ci)[0] === "done" || firstUnread(ci) === ci)) return cur;
    const r = rng(Prof.cur + wk + ":" + ((cur && cur.week === wk ? cur.draw : 0) + (reroll ? 1 : 0)));
    const mine = items().filter((i) => i.has_file && ["book", "graphic", "tv", "movie", "article"].includes(i.kind) && !(cur && cur.id === i.id && reroll));
    const started = mine.filter((i) => W.status(i)[0] === "now");
    const long = mine.filter((i) => W.status(i)[0] === "done" && finishedAt(i) && finishedAt(i) < now() - 180 * DAY);
    const fresh = mine.filter((i) => !i.opened_at && W.status(i)[0] === "new");
    // finish what you're partway through; now and then revisit an old favourite or open something never started
    const pools = [["finish", started], ["revisit", long], ["start", fresh]].filter(([, p]) => p.length);
    if (!pools.length) { if (reroll) toast("Nothing else to pick right now: start something and it'll turn up here."); return reroll ? cur : null; }
    let [type, pool] = pools[0];
    if (pools.length > 1 && r() < (reroll ? 0.5 : 0.25)) [type, pool] = pools[1 + Math.floor(r() * (pools.length - 1))];
    const [it, kind] = inOrder(shuffle(pool, r)[0], type, cur, reroll);
    type = kind;
    const c = { week: wk, id: it.id, type, draw: (cur && cur.week === wk ? cur.draw || 0 : 0) + (reroll ? 1 : 0), since: it.opened_at || 0 };
    store(file(), c);
    if (S.conn.token && Prof.server) api("POST", "/sync/bulletin", c).catch(() => {});
    return c;
  }
  /* the computer's copy of this profile's challenge (picked there, or on another phone) */
  function fromServer(b) {
    const cur = load(file(), null);
    if (!cur || b.week > cur.week || (b.week === cur.week && (b.draw || 0) >= (cur.draw || 0))) store(file(), b);
  }
  const done = (c, it) => c.type === "finish" ? W.status(it)[0] === "done" : (it.opened_at || 0) > Math.max(c.week, c.since || 0);

  function html() {
    const wk = weekStart();
    const c = challenge(), it = c && S.items[c.id];
    const when = new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    const issue = Math.max(1, Math.round((wk - Date.UTC(2026, 0, 5) / 1000) / (7 * DAY)) + 1);
    const ch = it ? { it, c, ok: done(c, it), p: pct(it), finish: c.type === "finish", start: c.type === "start", ago: Math.round((now() - finishedAt(it)) / (30 * DAY)) } : null;
    const hook = (x) => x.ok ? (x.finish ? "Done and dusted. Challenge complete." : "Revisited. Challenge complete.")
      : x.finish ? `${x.p}% of the way. One ${word()} to cross the finish line.` : x.start ? `Still in the wrapper. This is the ${word()} to open it.` : `Last read ${x.ago} months ago. Time for a second look?`;
    const head = (x) => x.ok ? "MISSION ACCOMPLISHED" : x.finish ? "THE FINAL STRETCH" : x.start ? "FIRST PAGE" : "THE RETURN";
    const go = (x) => x.ok ? "" : `<button class="btn primary" data-bt-go="${x.it.id}">${isVideo(x.it) ? "▶ Watch it" : x.finish ? "Finish it" : x.start ? "Start it" : "Read it again"}</button>`;
    const by = (x) => [W.kindName(x), byline(x)].filter(Boolean).join(" · ");
    return `<div class="btm">
      <section class="btm-cover ${ch && ch.ok ? "done" : ""}">${ch ? `<div class="btm-bg">${cover(ch.it, false)}</div>` : ""}<div class="btm-sheen"></div>
        <div class="btm-title"><b>BABEL</b><span><i>Issue ${issue}</i><i>${esc(when)}</i></span></div>
        ${ch ? `<div class="btm-burst">${ch.ok ? "DONE!" : ch.finish ? `${ch.p}%<small>there</small>` : ch.start ? "NEW!" : "AGAIN?"}</div>
        <div class="btm-hero" data-item="${ch.it.id}">${cover(ch.it, false)}${ch.ok ? `<span class="bt-stamp">✓<b>Done!</b></span>` : ""}</div>
        <div class="btm-lines"><small>${ch.finish ? `THIS ${word().toUpperCase()}'S CHALLENGE` : ch.start ? "THE DEBUT ISSUE" : "THE REVISIT ISSUE"}</small><em>${head(ch)}</em><h2>${esc(W.title(ch.it))}</h2>
          <p class="btm-by">${esc(by(ch.it))}</p><p class="btm-hook">${esc(hook(ch))}</p>
          ${ch.finish && !ch.ok ? `<div class="btm-meter"><i style="width:${ch.p}%"></i></div>` : ""}
          <div class="btns">${go(ch)}<button class="btn" data-bt-reroll>Pick another</button></div></div>`
        : `<div class="btm-lines"><em>COMING SOON</em><h2>Your next obsession</h2><p class="btm-hook">Start something and next ${word()}'s challenge will be to finish it.</p></div>`}
        <div class="btm-barcode"><i></i><span>0 ${String(issue).padStart(5, "0")} 42</span></div></section>
      <figure class="btm-potd" id="btPotd" hidden></figure>
      <section class="btm-sec btm-hot"><header><small>FROM THE CATALOGUE</small><h3>Hot Off the Press</h3><p>This week's most talked-about finds you don't own yet</p></header>
        <div id="btNew" class="btm-ranks"><p class="hint">${S.conn.token ? "Stopping the presses…" : "Pair with your computer to see the catalogue's picks."}</p></div></section>
      <section class="btm-sec btm-tfa" id="btTfa" hidden></section>
      <section class="btm-sec btm-qotd" id="btQuote" hidden></section>
      <section class="btm-sec btm-wire"><header><small>THE WIRE · WORLD</small><h3>Breaking News</h3><p>The latest from BBC, Al Jazeera, NPR and the Guardian</p>
        <button class="btm-refresh" data-bt-wire-refresh aria-label="Refresh the news">↻</button></header>
        <div id="btWorld" class="btm-wires"><p class="hint">Warming up the wire…</p></div></section>
      <section class="btm-sec btm-labs"><header><small>PRESS RELEASES · SCIENCE</small><h3>From the Labs</h3><p>Fresh from NASA, ESA, NIH, MIT, Harvard and Cambridge</p></header>
        <div id="btLabs" class="btm-wires"><p class="hint">Opening the lab doors…</p></div></section>
    </div>`;
  }
  function after() { paintPicks(); paintPotd(); paintWires(); }
  /* the wires: world news and science press releases (fetched again after half an hour, or with ↻) */
  let wires = null, wiresAt = 0;
  const WIRE_NEW = 2 * 3600;                // newer than this: BREAKING (world) / JUST IN (labs)
  async function paintWires(fresh = false) {
    if (!wires || fresh || now() - wiresAt > 1800) {
      const q = fresh ? "?fresh=1" : "";
      const [w, sci] = await Promise.all([api("GET", "/sync/news/world" + q).catch(() => null), api("GET", "/sync/news/science" + q).catch(() => null)]);
      const labs = sci && (sci.sections || []).find((s) => s.key === "labs");
      if (w || labs) { wires = { world: (w && w.items || []).slice(0, 7), labs: (labs && labs.items || []).slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 5) }; wiresAt = now(); }
    }
    const age = (t) => { const s = now() - t; return s < 3600 ? Math.max(1, Math.round(s / 60)) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; };
    const list = (key, hot) => (wires && wires[key] || []).map((s, i) => `<button class="btm-wire-row${s.image ? "" : " noimg"}" data-bt-story="${key}:${i}">
        <span class="btm-wtext"><span class="btm-wmeta">${s.date && now() - s.date < WIRE_NEW ? `<em class="btm-hot-tag">${hot}</em>` : ""}<small>${esc(s.source || "")}${s.date ? " · " + age(s.date) : ""}</small></span>
        <b>${esc(s.title)}</b></span>${s.image ? `<span class="btm-wpic"><img loading="lazy" alt="" src="${esc(s.image)}" onerror="this.parentNode.remove()"></span>` : ""}</button>`).join("");
    const fill = (id, key, hot, none) => { const b = $(id); if (b) b.innerHTML = list(key, hot) || `<p class="hint">${none}</p>`; };
    fill("#btWorld", "world", "BREAKING", "The wire is quiet: the newsrooms couldn't be reached right now.");
    fill("#btLabs", "labs", "JUST IN", "The labs couldn't be reached right now.");
  }
  async function paintPotd() {
    if (potd === undefined) { potd = null; try { potd = await api("GET", "/sync/potd"); } catch (e) { potd = undefined; } }
    // Wikipedia's featured article and Wikiquote's quote of the day
    const a = potd && potd.article, tf = $("#btTfa");
    if (a && tf) {
      tf.innerHTML = `<header><small>FROM THE ENCYCLOPEDIA</small><h3>Today's Article</h3><p>Wikipedia's featured article of the day</p></header>
        <article class="btm-tfa-page">${a.img ? `<img src="${esc(a.img)}" alt="" onerror="this.remove()">` : ""}<h4>${esc(a.title)}</h4>${a.about ? `<em>${esc(a.about)}</em>` : ""}
          <p>${esc(a.text)}</p><button class="btn" data-go-url="${esc(a.page)}">Read the whole article →</button></article>`;
      tf.hidden = false;
    }
    const q = potd && potd.quote, qb = $("#btQuote");
    if (q && qb) {
      qb.innerHTML = `<header><small>WORDS TO LIVE BY</small><h3>Quote of the Day</h3></header>
        <blockquote class="btm-q"><p>${esc(q.text)}</p><cite data-go-url="${esc(q.page)}">— ${esc(q.by)}</cite></blockquote>`;
      qb.hidden = false;
    }
    const box = $("#btPotd");
    if (!box || !potd || !potd.img) return;
    const img = new Image();
    img.onload = () => {
      if (!box.isConnected) return;
      box.innerHTML = `<span class="btm-potd-tag">PHOTO OF THE DAY</span><img src="${esc(potd.img)}" alt="">
        <figcaption><b>${esc(potd.desc || potd.title)}</b><small>${esc([potd.artist && "📷 " + potd.artist, potd.license].filter(Boolean).join(" · "))} · Wikimedia Commons</small></figcaption>`;
      box.dataset.goUrl = potd.page || "";
      box.hidden = false;
    };
    img.src = potd.img;          // (only shown once the picture itself loads: offline, nothing appears)
  }
  async function paintPicks() {
    if (!S.conn.token) return;
    if (!picks) {
      const cats = ["book", "movie", "manga", "tv", "comic"];
      const got = await Promise.all(cats.map((cat) => api("GET", `/sync/cat/promos?cat=${cat}`).then((x) => (x.items || []).map((i) => ({ ...i, cat: i.cat || cat }))).catch(() => [])));
      const r = rng("new" + weekStart());
      const all = got.flat().filter((x) => x.have !== "owned" && x.have !== "ignored" && x.title);
      if (all.length) picks = shuffle(all, r).slice(0, 6);
    }
    const box = $("#btNew"); if (!box) return;
    const CAT = { book: "Book", movie: "Film", manga: "Manga", tv: "TV", comic: "Comic" };
    const want = (x, i) => x.have === "wanted" ? `<span class="bt-want got">✓ On your list</span>` : `<button class="bt-want" data-bt-want="${i}">＋ Want</button>`;
    box.innerHTML = picks && picks.length ? picks.map((x, i) => `<div class="btm-rank" data-bt-find="${i}"><span class="btm-num">${i + 1}</span>
        <span class="btm-pcov"><img loading="lazy" alt="" src="${esc(Catalogue.coverSrc(x))}" onerror="this.remove()"></span>
        <span class="btm-rinfo"><small>${esc((CAT[x.cat] || "").toUpperCase())}</small><b>${esc(x.title)}</b><span>${esc([(x.authors || [])[0], x.year].filter(Boolean).join(" · "))}</span>${want(x, i)}</span></div>`).join("")
      : `<p class="hint">The catalogue couldn't be reached right now.</p>`;
  }
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-bt-reroll]")) { challenge(true); return render(); }
    if (t.closest("[data-bt-wire-refresh]")) { $("#btWorld").innerHTML = `<p class="hint">Checking the wire…</p>`; return paintWires(true); }
    const sto = t.closest("[data-bt-story]");
    if (sto && wires) { const [k, i] = sto.dataset.btStory.split(":"); const s = wires[k] && wires[k][Number(i)]; if (s) return NewsTab.read(s); }
    const g = t.closest("[data-bt-go]"); if (g) { const it = S.items[g.dataset.btGo]; if (!it) return; return hereAny(it) ? readHere(it) : openSheet(it.id); }
    const w = t.closest("[data-bt-want]");
    if (w && picks) { e.stopPropagation(); return Catalogue.want(picks[Number(w.dataset.btWant)], w); }
    const fd = t.closest("[data-bt-find]"); if (fd && picks) return Catalogue.show(picks[Number(fd.dataset.btFind)]);
  }, true);
  return { html, after, fromServer, done, file, reset: () => { picks = null; } };
})();
/* The home-screen widget (Android): the thing you opened last and this week's challenge, in the theme's colours.
   Told again whenever the page redraws, but only when something it shows has changed. */
window.Widget = (() => {
  let last = "", timer = null;
  const hex = (v) => {            // the native side reads #rrggbb
    const m = String(v).match(/\d+(\.\d+)?/g);
    if (/^#[0-9a-f]{6}$/i.test(v.trim())) return v.trim();
    if (/^#[0-9a-f]{3}$/i.test(v.trim())) return "#" + [...v.trim().slice(1)].map((c) => c + c).join("");
    return m && m.length >= 3 ? "#" + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, "0")).join("") : "";
  };
  function data() {
    const cs = getComputedStyle(document.documentElement), c = (v) => hex(cs.getPropertyValue(v));
    const theme = { key: document.documentElement.dataset.theme, bg: c("--bg"), surface: c("--surface"), ink: c("--ink"), soft: c("--ink-soft"), accent: c("--accent") };
    const all = Object.values(S.items);
    /* a reading copy is shown as its book (its title and cover); the place and the tap are the version read last */
    const origOf = (x) => { if (!isCopy(x)) return x; const o = S.items[String(x.source).slice("reading-copy:".length)]; return o || x; };
    const seen = new Set(), opened = [];
    for (const v of all.filter((i) => i.opened_at && i.kind !== "music").sort((a, b) => b.opened_at - a.opened_at)) {
      const o = origOf(v);
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      opened.push({ v, o });
    }
    const first = opened[0];
    let item = null;
    if (first) {
      const it = first.v, o = first.o, p = pct(it), st = W.status(it)[0];
      item = { id: it.id, cover_id: o.id, title: W.title(o).trim(), by: byline(o), pct: p, has_cover: !!o.has_cover, cover_v: String(o.cover_v || 0), color: colorFor(o),
        label: st === "done" ? "FINISHED" : `CONTINUE ${isVideo(it) ? "WATCHING" : "READING"}`,
        note: it.watched ? "Finished" : p ? `${p}% · ${ago(it.opened_at)}` : `Opened ${ago(it.opened_at)}` };
    }
    const ch = load(Bulletin.file(), null), ci = ch && S.items[ch.id];
    const challenge = ci ? { id: ci.id, text: (Bulletin.done(ch, ci) ? "✓ Challenge complete: " : `This ${S.bulletinPeriod === "month" ? "month" : "week"}: ${ch.type === "finish" ? "finish" : ch.type === "start" ? "start" : "revisit"} `) + W.title(ci) } : null;
    // (the big widget) the next few opened, and a tally
    const recent = opened.slice(1, 5).map(({ v: x, o }) => {
      const p = pct(x);
      return { id: x.id, cover_id: o.id, title: W.title(o).trim(), by: [byline(o), ago(x.opened_at)].filter(Boolean).join(" · "), pct: p, short: x.watched || p >= 98 ? "✓" : p ? p + "%" : "new",
        has_cover: !!o.has_cover, cover_v: String(o.cover_v || 0), color: colorFor(o) };
    });
    const yr = new Date().getFullYear(), since = new Date(yr, 0, 1).getTime() / 1000;
    const doneYr = Prof.isMain() ? S.log.filter((l) => l.finished && inJournal(l) && Date.parse(l.finished) / 1000 >= since).length
      : all.filter((x) => (x.watched_at || 0) >= since).length;
    const going = all.filter((x) => x.has_file && x.kind !== "music" && !isCopy(x) && W.status(x)[0] === "now").length, here = all.filter((x) => !isCopy(x) && hereAny(x)).length;
    const stats = [going && `📖 ${going} reading`, `✓ ${doneYr} finished in ${yr}`, here && `📱 ${here} on phone`].filter(Boolean).join("  ·  ");
    return { theme, item, challenge, recent, stats };
  }
  function update() {
    if (!A || !A.setWidget) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      let d; try { d = JSON.stringify(data()); } catch (e) { return; }
      if (d !== last) { last = d; A.setWidget(d); }
    }, 800);
  }
  // a tap on the widget: open the thing (on the phone: the reader; otherwise its card), or the Bulletin
  // (the id is the version read last: the original or its reading copy, opened as it is, without asking which)
  function open(id) {
    const it = S.items[id];
    if (!it) return setTab("home");
    const orig = isCopy(it) ? S.items[String(it.source).slice("reading-copy:".length)] || it : it;
    if (onPhone(it)) return Reader.start(it);
    if (hereAny(orig)) return readHere(orig);
    openSheet(orig.id);
  }
  function tab(t) {
    if (t === "bulletin") { W.tab = "bulletin"; store("hometab.json", W.tab); }
    if (t === "library" || t === "journal" || t === "browser") return setTab(t);
    if (t === "note") { setTab("journal"); return Journal.quick(); }
    setTab("home");
  }
  return { update, open, tab, data };
})();

/* ---- the library's filters, exactly as on the computer: a section (Books, Articles, Music, TV & Movies), its kinds
   (Books / Manga / Comics; Scientific papers / News stories; TV / Movies), a collection (or the wishlist), Group by,
   Sort, and a search through the same fields. The deck keeps each group together and shows its name on the binder. */
const LIB = {
  areas: [["books", "Books"], ["articles", "Articles"], ["music", "Music"], ["video", "TV & Movies"]],
  kinds: { books: ["book", "graphic"], articles: ["article"], music: ["music"], video: ["tv", "movie"] },
  tabs: { books: [["book", "Books"], ["manga", "Manga"], ["comic", "Comics"]], articles: [["paper", "Scientific papers"], ["news", "News stories"]], video: [["tv", "TV"], ["movie", "Movies"]] },
  groups: {
    music: [["auto", "Albums"], ["genre", "Genre"], ["author", "Artist"], ["year", "Year"]],
    video: [["auto", "Genre"], ["series", "Film series"], ["year", "Year"], ["none", "No grouping"]],
    articles: [["subject", "Subject"], ["journal", "Journal"], ["year", "Year"], ["author", "Author"], ["tag", "Tag"], ["collection", "Collection"]],
    books: [["subject", "Subject"], ["year", "Year"], ["fiction", "Fiction or non-fiction"], ["author", "Author"], ["tag", "Tag"], ["collection", "Collection"]],
  },
  sorts: [["added", "Recently added"], ["opened", "Recently read"], ["title", "Title"], ["author", "Author"], ["year-desc", "Newest first"], ["year-asc", "Oldest first"], ["notes", "Most annotated"]],
  // the computer's subject order (its library classification)
  subjects: ["General Works", "Philosophy, Psychology & Religion", "History", "Geography, Anthropology & Recreation", "Social Sciences", "Political Science", "Law", "Education",
    "Music", "Fine Arts", "Language & Literature", "Science", "Medicine", "Agriculture", "Technology & Engineering", "Military & Naval Science", "Bibliography & Library Science"],
  placeholder: { books: "Search books, authors, series…", articles: "Search articles, authors, journals, tags…", music: "Search songs, albums, artists…", video: "Search shows and films…" },
};
const lastName = (n) => { n = (n || "").trim(); if (n.includes(",")) return n.split(",")[0].trim(); const p = n.split(/\s+/); return p[p.length - 1] || ""; };
const isNewsStory = (it) => it.kind === "article" && (it.source === "web" || (it.source !== "paper" && !it.doi && /news|times|post|guardian|bbc|npr|reuters|apnews|propublica|tribune|herald|gazette|journal\.com|magazine|patch\.com|phys\.org|sciencedaily/i.test((it.url || "") + " " + (it.journal || ""))));
const kindMatches = (it, k) => k === "manga" ? it.kind === "graphic" && it.format === "manga" : k === "comic" ? it.kind === "graphic" && it.format !== "manga"
  : k === "paper" ? it.kind === "article" && !isNewsStory(it) : k === "news" ? isNewsStory(it) : it.kind === k;
const collName = (id) => { const c = (S.colls || []).find((x) => String(x.id) === String(id)); return c ? c.name : "Collection"; };
function libGroupKeys(it, by) {
  switch (by) {
    case "auto": return S.area === "music" ? [it.album || "Singles"] : [it.genre || "Unknown genre"];
    case "subject": return [LIB.subjects.includes(it.subject) ? it.subject : "General Works"];
    case "journal": return [it.journal || "No journal listed"];
    case "genre": return [it.genre || "Unknown genre"];
    case "series": return [it.series || "Not in a series"];
    case "fiction": return [it.fiction === 1 ? "Fiction" : it.fiction === 0 ? "Non-fiction" : "Not yet known"];
    case "year": return [String(it.year || "Undated")];
    case "author": { const a = (it.authors || [])[0] || it.album_artist; return [a ? lastName(a) + (a.includes(",") ? "" : ", " + a.split(/\s+/).slice(0, -1).join(" ")).replace(/, $/, "") : "Unknown author"]; }
    case "tag": return (it.tags && it.tags.length) ? it.tags : ["Untagged"];
    case "collection": return (it.collections || []).length ? it.collections.map(collName) : ["Not in a collection"];
    default: return ["Everything"];
  }
}
const seriesKey = (s) => (s || "").toLowerCase().replace(/^the\s+/, "").replace(/\b(series|trilogy|chronicles?|saga|cycle|novels?|books|universe|sequence|quartet|quintet|duology)\b/g, " ").replace(/[^a-z0-9]+/g, "");
const inSeries = (it) => it.kind !== "article" && !!seriesKey(it.series);
const seriesOrder = (x, y) => (x.series_index ?? 999) - (y.series_index ?? 999) || (parseInt(x.year) || 9999) - (parseInt(y.year) || 9999) || (x.title || "").localeCompare(y.title || "");
function libList() {
  const area = LIB.kinds[S.area] ? S.area : "books";
  const q = S.q.toLowerCase().trim();
  const nn = {};
  for (const a of Object.values(Ann.map())) nn[a.item_id] = (nn[a.item_id] || 0) + 1;
  const list = Object.values(S.items).filter((it) => {
    if (isCopy(it) || !LIB.kinds[area].includes(it.kind)) return false;
    if (S.kind && S.kind !== "all" && !kindMatches(it, S.kind)) return false;
    const wish = it.wanted && !it.has_file;          // (wanted, not owned: only in the Wishlist, never among what's here)
    if (S.coll === "wish") { if (!wish) return false; }
    else if (wish || (S.coll && !(it.collections || []).map(String).includes(String(S.coll)))) return false;
    if (!q) return true;
    const hay = [it.title, (it.authors || []).join(" "), (it.tags || []).join(" "), it.topic, it.genre, it.subject, it.journal, it.year, it.publisher, it.series, it.album, it.album_artist].join(" ").toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
  const by = {
    added: (a, b) => (b.added_at || 0) - (a.added_at || 0),
    opened: (a, b) => (b.opened_at || 0) - (a.opened_at || 0),
    title: (a, b) => (a.title || "").localeCompare(b.title || ""),
    author: (a, b) => lastName((a.authors || [""])[0]).localeCompare(lastName((b.authors || [""])[0])),
    "year-desc": (a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0),
    "year-asc": (a, b) => (parseInt(a.year) || 9999) - (parseInt(b.year) || 9999),
    notes: (a, b) => (nn[b.id] || 0) - (nn[a.id] || 0),
  }[S.sort] || ((a, b) => (b.added_at || 0) - (a.added_at || 0));
  list.sort(by);
  // groups, as the computer makes them: a series stays together, in its own order, under its first book's group
  const g = S.groupBy, map = new Map(), lead = new Map();
  if (!["series", "tag", "collection"].includes(g)) for (const it of list) if (inSeries(it)) { const k = seriesKey(it.series), cur = lead.get(k); if (!cur || seriesOrder(it, cur) < 0) lead.set(k, it); }
  for (const it of list) {
    const keys = inSeries(it) && lead.has(seriesKey(it.series)) ? libGroupKeys(lead.get(seriesKey(it.series)), g) : libGroupKeys(it, g);
    for (const k of keys) { if (!map.has(k)) map.set(k, []); map.get(k).push(it); }
  }
  for (const [k, items] of map) {
    const out = [], seen = new Set();
    for (const it of items) { if (!inSeries(it)) { out.push(it); continue; } const sk = seriesKey(it.series); if (seen.has(sk)) continue; seen.add(sk); out.push(...items.filter((x) => inSeries(x) && seriesKey(x.series) === sk).sort(seriesOrder)); }
    map.set(k, out);
  }
  let groups = [...map.entries()];
  if (g === "year") groups.sort((a, b) => (parseInt(b[0]) || 0) - (parseInt(a[0]) || 0));
  else if (g === "author") groups.sort((a, b) => a[0].localeCompare(b[0]));
  else if (g === "subject") groups.sort((a, b) => LIB.subjects.indexOf(a[0]) - LIB.subjects.indexOf(b[0]));
  else if (g === "series") groups.sort((a, b) => (a[0] === "Not in a series") - (b[0] === "Not in a series") || a[0].localeCompare(b[0]));
  else groups.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return groups;
}
function renderLibrary(v) {
  if (!LIB.kinds[S.area]) S.area = "books";
  const area = S.area, tabs = LIB.tabs[area] || [], gopts = LIB.groups[area];
  if (!gopts.some(([k]) => k === S.groupBy)) S.groupBy = (S.groupByArea || {})[area] || gopts[0][0];
  if (!LIB.sorts.some(([k]) => k === S.sort)) S.sort = "added";
  if (S.kind !== "all" && !tabs.some(([k]) => k === S.kind)) S.kind = "all";
  const groups = libList();
  // a series is one card in the deck (the next one to read on top); tapping it shows all its volumes
  const flat = [], labels = [], stacks = {};
  for (const [name, items] of groups) {
    for (let i = 0; i < items.length;) {
      const it = items[i], k = inSeries(it) ? seriesKey(it.series) : "";
      let j = i + 1;
      if (k) while (j < items.length && inSeries(items[j]) && seriesKey(items[j].series) === k) j++;
      const run = items.slice(i, j);
      if (run.length > 1) {
        const top = run.find((x) => W.status(x)[0] !== "done") || run[0];
        stacks[top.id] = { k, n: run.length, ids: run.map((x) => x.id) };
        flat.push(top); labels.push(name);
      } else { flat.push(it); labels.push(name); }
      i = j;
    }
  }
  Deck.stacks = stacks;      // (read by the deck's cards)
  const lay = area === "music" || !flat.length ? null : LibLayouts.html(flat, labels, stacks);      // (null: the fan deck)
  const opt = (list, cur) => list.map(([k, l]) => `<option value="${esc(k)}" ${String(cur) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const colls = [["", "Everything"], ["wish", "★ Wishlist"], ...(S.colls || []).map((c) => [c.id, c.name])];
  // one compact header: the four shelves as tabs; search with the filters, the layout switch and "send to computer"
  // beside it; the kinds under it; group / sort / collection fold away behind ⚙ (a dot on it when one isn't the usual)
  const AREA_IC = { books: "📚", articles: "📰", music: "🎵", video: "🎬" };
  const custom = S.sort !== "added" || !!S.coll;
  const summary = [gopts.find(([k]) => k === S.groupBy)?.[1], LIB.sorts.find(([k]) => k === S.sort)?.[1], S.coll ? (colls.find(([k]) => String(k) === String(S.coll)) || [, ""])[1] : ""].filter(Boolean).join(" · ");
  v.innerHTML = `${uploadsHtml()}<div class="lh">
    <nav class="lh-areas">${LIB.areas.map(([k, l]) => `<button data-area="${k}" class="${area === k ? "on" : ""}"><i>${AREA_IC[k] || "•"}</i><span>${esc(l)}</span></button>`).join("")}</nav>
    <div class="lh-bar"><label class="lh-search"><i aria-hidden="true">⌕</i><input id="q" type="search" placeholder="Search" aria-label="${esc(LIB.placeholder[area])}" value="${esc(S.q)}"></label>
      <button class="lh-ico ${S.libFilt ? "on" : ""} ${custom ? "dot" : ""}" id="libFilt" type="button" aria-label="Group, sort and collection">⚙</button>
      ${area === "music" ? "" : LibLayouts.compass()}
      <button class="lh-ico" id="sendPc" type="button" aria-label="Send files to your computer">⬆</button></div>
    ${tabs.length ? `<div class="chips lib-kinds lh-kinds"><button data-kind="all" class="${S.kind === "all" ? "on" : ""}">All</button>${tabs.map(([k, l]) => `<button data-kind="${k}" class="${S.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="lh-filters" ${S.libFilt ? "" : "hidden"}><div class="lib-ctl">
      <label><span>Group</span><select id="libGroup">${opt(gopts, S.groupBy)}</select></label>
      <label><span>Sort</span><select id="sort">${opt(LIB.sorts, S.sort)}</select></label>
      <label><span>Collection</span><select id="libColl">${opt(colls, S.coll || "")}</select></label>
    </div></div>
    ${S.libFilt ? "" : `<button class="lh-sum" id="libFiltSum" type="button">${esc(summary)}</button>`}
    </div>
    <div id="libBody">${area === "music" ? Jukebox.html(groups) : flat.length ? (lay ?? Deck.html(flat, labels)) : `<p class="empty">Nothing here.</p>`}</div>`;
  if (flat.length && area !== "music" && lay == null) Deck.mount(flat.length);
}
function renderPhone(v, items) {
  refreshFiles();
  const here = items.filter(hereAny).sort((a, b) => (b.opened_at || 0) - (a.opened_at || 0));
  const used = here.reduce((s, i) => s + (S.files[fileName(i)] || 0), 0);
  const coming = Object.keys(S.downloads).map((id) => S.items[id]).filter(Boolean);
  v.innerHTML = `<div class="panel"><h3>Storage</h3><p class="hint">${here.length} files, ${fmtSize(used)} on the phone · ${A ? fmtSize(A.freeSpace()) : "?"} free</p></div>
    ${coming.length ? `<section class="sec"><h2>Downloading</h2><div class="list" id="dlList">${coming.map(row).join("")}</div></section>` : ""}
    <section class="sec"><h2>On this phone</h2>${here.length ? `<div class="list">${here.map(row).join("")}</div>` : `<p class="hint">Files you get from the computer are kept here so you can read and watch offline.</p>`}</section>`;
}
/* anything coming from the computer: a little pill at the bottom on every tab, with how far along it is; it says
   "all here" when the last one lands and then goes away by itself. Tap it for the Phone page's list. */
let dlPillOut = null;
function paintDlPill() {
  const ids = Object.keys(S.downloads);
  let p = $("#dlPill");
  if (!ids.length) {
    if (p && !p.classList.contains("done")) {
      p.classList.add("done");
      p.innerHTML = `<b>✓</b><span><b>All here</b><small>Ready on this phone</small></span>`;
      clearTimeout(dlPillOut);
      dlPillOut = setTimeout(() => { p.classList.add("out"); setTimeout(() => p.remove(), 400); }, 2500);
    }
    return;
  }
  clearTimeout(dlPillOut);
  if (!p || p.classList.contains("done")) { if (p) p.remove(); p = document.createElement("button"); p.id = "dlPill"; p.className = "dl-pill"; document.body.append(p); }
  let done = 0, total = 0;
  for (const id of ids) {
    const st = S.dlState[S.downloads[id]], it = S.items[id] || {};
    total += (st && st.total > 0 ? st.total : it.file_size) || 0; done += (st && st.done) || 0;
  }
  const pc = total ? Math.min(100, Math.round((100 * done) / total)) : 0;
  const first = S.items[ids[0]] || {}, paused = ids.every((id) => (S.dlState[S.downloads[id]] || {}).state === "paused");
  p.style.setProperty("--p", pc + "%");
  p.innerHTML = `<b class="dl-ring">${total ? pc + "%" : "⬇"}</b><span><b>${ids.length === 1 ? esc(first.title || "Downloading") : `Getting ${ids.length} files`}</b>
    <small>${paused ? "Paused · waiting for a connection" : total ? `${fmtSize(done)} of ${fmtSize(total)}` : "Starting…"}</small></span>`;
}
function paintDownloads() {
  paintDlPill();
  if (typeof Jukebox !== "undefined") Jukebox.paintDl();
  const box = $("#dlList");
  if (box) box.innerHTML = Object.keys(S.downloads).map((id) => S.items[id]).filter(Boolean).map(row).join("");
  const sheetDl = $("#sheet [data-dlbar]");
  if (sheetDl) {
    const it = S.items[sheetDl.dataset.dlbar], st = it && S.dlState[S.downloads[it.id]];
    if (!S.downloads[it?.id]) openSheet(it.id);
    else if (st) { sheetDl.querySelector("i").style.width = (st.total > 0 ? 100 * st.done / st.total : 3) + "%"; sheetDl.nextElementSibling.textContent = st.total > 0 ? `${fmtSize(st.done)} of ${fmtSize(st.total)}${st.state === "paused" ? " · paused (waiting for a connection)" : ""}` : "Starting…"; }
  }
}
/* files going to the computer: sent by the app's background service (it keeps going when you leave the app), which
   this reads every second while anything is on its way */
const ACTIVE = ["waiting", "sending", "retrying"];
/* files going to the computer: with more than one profile, everyone's or this profile's alone? (null: not sending) */
async function uploadPrivacy() {
  if (!Prof.server || Prof.list.length < 2) return false;
  const me = Prof.me();
  const a = await askKeep("Who can see what you send?", `Everyone: every profile sees it. Only me: just ${me.name}, on this phone and the others ${me.name} uses.`,
    [[`🔒 Only me (${me.name})`, "private"], ["Everyone", "public"]]);
  return a == null ? null : a === "private";
}
window.Native = window.Native || {};
// "Babel Resume" (the side key's double press): the last thing opened, opened again (fetched first if it isn't on
// this phone). Waits a moment for the library on a cold start.
Native.resumeLast = (tries = 0) => {
  // (songs aren't it: they play in the jukebox, and the point is the book or film you were in the middle of)
  const last = Object.values(S.items).filter((it) => it.opened_at && it.kind !== "music").sort((a, b) => b.opened_at - a.opened_at)[0];
  if (!last) { if (tries < 10) setTimeout(() => Native.resumeLast(tries + 1), 500); else setTab("home"); return; }
  if (Reader.open && Reader.current() === last.id) return;
  hereAny(last) ? readHere(last) : openSheet(last.id);
};
// (files shared into the app from another app: the phone asks the same question, then they go)
window.Native.askUploadPrivacy = () => uploadPrivacy().then((p) => A.sharedPrivacy(p == null ? "cancel" : p ? "private" : "public"));
/* files already on the phone: looked through for ones in the library (Android: a folder; iPhone: picked files) */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-scan]");
  if (!b) return;
  if (!S.conn.token) return toast("Pair with your computer first (Settings).");
  const st = $("#scanState"); if (st) st.textContent = "Starting…";
  if (b.dataset.scan === "pick" && A.scanPick) return A.scanPick();
  A.scanFolder(b.dataset.scan === "new");
});
Object.assign(window.Native, {
  scanProgress(what, n, of) { const st = $("#scanState"); if (st) st.textContent = of ? `${what} (${n} of ${of})` : what; },
  scanDone(r) {
    const st = $("#scanState");
    if (r.cancelled) { if (st) st.textContent = ""; return; }
    refreshFiles(); saveLibrary(true);
    const msg = r.error ? r.error : !r.found ? "None of those files are in your library." : `${r.found} found in your library: ${r.added} added${r.had ? `, ${r.had} already here` : ""}.`;
    if (st) st.textContent = msg;
    toast(msg); render();
  },
});
function uploadList() { try { return JSON.parse(A ? A.uploads() : "[]"); } catch (e) { return []; } }
function uploadsHtml() {
  const list = uploadList();
  if (!list.length) return "";
  return `<section class="sec" id="upSec"><h2>Going to your computer</h2><div class="list">${list.map((u) => {
    const p = u.total > 0 ? Math.round(100 * u.sent / u.total) : 0;
    const what = u.state === "done" ? "Sent: the computer is adding it to the library" : u.state === "failed" ? "Stopped: " + (u.msg || "")
      : u.state === "cancelled" ? "Cancelled" : u.state === "retrying" ? `${p}% · connection lost, trying again…`
      : u.state === "waiting" ? "Waiting…" : `${p}% · ${fmtSize(u.sent)} of ${fmtSize(u.total)}`;
    const btns = ACTIVE.includes(u.state) ? `<button class="btn sm" data-up-cancel="${esc(u.id)}">Cancel</button>`
      : `${u.state === "failed" || u.state === "cancelled" ? `<button class="btn sm" data-up-retry="${esc(u.id)}">Try again</button>` : ""}<button class="btn sm" data-up-clear="${esc(u.id)}">✕</button>`;
    return `<div class="row up-row"><span class="t"><b>⬆ ${esc(u.name)}</b><small>${esc(what)}</small><span class="p"><i style="width:${u.state === "done" ? 100 : p}%"></i></span></span>${btns}</div>`;
  }).join("")}</div></section>`;
}
let upSeen = {};
function paintUploads() {
  const sec = $("#upSec");
  const html = uploadsHtml();
  if (sec) sec.outerHTML = html || "<span id='upSec'></span>";
  else if (html && (S.tab === "home" || S.tab === "library") && $("#sheet").hidden && !Reader.open) render();
}
setInterval(() => {
  if (!A || !A.uploads) return;
  const list = uploadList();
  for (const u of list) {
    if (upSeen[u.id] && upSeen[u.id] !== u.state) {
      if (u.state === "done") { toast(`“${u.name}” is on your computer`); setTimeout(() => sync(), 5000); }
      if (u.state === "failed") toast(`Couldn't send “${u.name}”: ${u.msg || "error"}`);
    }
    upSeen[u.id] = u.state;
  }
  if (list.length || $("#upSec")) paintUploads();
}, 1000);

/* the app's own clock (the phone's status bar is hidden while you're in the app) */
function tick() {
  const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $$("#clock, .r-clock").forEach((c) => (c.textContent = t));
}
setInterval(tick, 10000);

function paintPill() {
  const p = $("#syncPill");
  const txt = !S.conn.token ? "Not paired" : S.syncing ? "Syncing…" : S.syncError === "offline" ? "Computer offline" : S.syncError ? "Sync problem"
    : S.lastSync ? `${S.route === "remote" ? "Away · " : ""}Synced ${ago(S.lastSync)}` : "Not synced yet";
  p.className = "sync-pill " + (S.syncing ? "busy" : !S.conn.token || S.syncError ? "off" : "ok");
  p.querySelector("span").textContent = txt;
}
setInterval(paintPill, 30000);

/* ---------------------------------------------------------------- settings and pairing */
let found = null;
document.addEventListener("click", (e) => {
  const t = e.target.closest?.("[data-setp]");
  if (!t || S.tab !== "settings") return;
  S.setPane = t.dataset.setp || null;
  if (!S.setPane && !S.conn.token) S.setPane = "menu";      // (unpaired: the back arrow still shows the menu)
  render(); window.scrollTo(0, 0);
});
function renderSettings(v) {
  const paired = !!S.conn.token;
  if (!paired && !S.setPane) S.setPane = "computer";        // (not paired yet: straight to pairing)
  if (S.setPane === "menu") S.setPane = null;
  const theme = (window.THEMES || {})[S.eink ? "eink" : S.themeChoice === "auto" ? S.theme : S.themeChoice];
  let pwN = 0, nLim = 0;
  try { pwN = !WEB && A && A.passwordCount ? A.passwordCount() : 0; } catch (e) {}
  try { nLim = !WEB && A && A.siteLimits ? Object.keys(JSON.parse(A.siteLimits()).limits || {}).length : 0; } catch (e) {}
  // the sections: [key, icon, title, one-line summary, html] (a section with no html isn't there on this device)
  const SECTIONS = [
    ["computer", "💻", "Your computer", paired ? `${S.conn.pc || "Computer"} · ${S.lastSync ? "synced " + ago(S.lastSync) : "not synced yet"}` : "Not paired: tap to pair", () => `
    <div class="panel set-grp"><h3>Your computer</h3>
      ${paired ? `<p><b>${esc(S.conn.pc || "Computer")}</b></p>
        <p class="hint">${S.syncError && S.syncError !== "offline" ? esc(S.syncError) : S.route === "wifi" ? "Connected over Wi-Fi." : S.route === "remote" ? "Connected from away (through the internet)." : "Not reachable right now: the computer is off, or you're away and “Reach this library from anywhere” is off on it."}
        ${S.lastSync ? ` Last synced ${ago(S.lastSync)}.` : ""}</p>
        <div class="btns"><button class="btn primary" id="syncNow">Sync now</button><button class="btn" id="fullSync">Fetch everything again</button><button class="btn danger" id="unpair">Unpair</button></div>
        <p class="hint">Home address: ${esc(S.conn.lan || "?")}${S.conn.remote ? " · away-from-home address known" : ""}</p>`
      : WEB ? `<p class="hint">On the computer, open Babel's Library → Settings → <b>Phone</b>, make sure <b>Reach this library from anywhere</b> is on, then <b>Pair a phone…</b> for a 6-digit code. Type it here: the app finds your computer by itself.</p>
        <div class="field"><label for="code">Pairing code</label><input id="code" class="code" inputmode="numeric" maxlength="7" placeholder="000 000"></div>
        <button class="btn primary" id="pairBtn">Pair</button>
        <details class="web-addr"><summary>Can't find it?</summary><div class="field"><label for="addr">The computer's away-from-home address (https://….trycloudflare.com, shown under the code)</label><input id="addr" inputmode="url" placeholder="https://….trycloudflare.com" value="${esc(S.pairAddr || "")}"></div></details>`
      : `<p class="hint">On the computer, open Babel's Library → Settings → <b>Phone</b> → <b>Pair a phone…</b> to get a 6-digit code. Phone and computer need to be on the same Wi-Fi for this first step.</p>
        <div class="btns"><button class="btn" id="look">Look for my computer</button></div>
        <div class="found" id="found">${found ? found.map((f) => `<button class="row" data-pick="${esc(f.url)}"><span class="t"><b>💻 ${esc(f.name)}</b><small>${esc(f.url)}</small></span></button>`).join("") || `<p class="hint">Didn't find it. Type its address instead (shown under the code on the computer).</p>` : ""}</div>
        <div class="field"><label for="addr">Computer address</label><input id="addr" inputmode="url" placeholder="192.168.1.20" value="${esc(S.pairAddr || "")}"></div>
        <div class="field"><label for="code">Pairing code</label><input id="code" class="code" inputmode="numeric" maxlength="7" placeholder="000 000"></div>
        <button class="btn primary" id="pairBtn">Pair</button>`}
    </div>`],
    ["profiles", "👤", "Profiles", `${Prof.me().face} ${Prof.me().name}${Prof.list.length > 1 ? ` · ${Prof.list.length} profiles` : ""}`, () => `
    <div class="panel set-grp"><h3>Profiles</h3>
      <p class="hint">${Prof.server ? "The library's profiles (kept on the computer): each has its own place in every book and film, its own notes and journal, and doesn't see what the others hid. Switching needs the computer." : `Everyone who uses this phone can have their own place in every book and film. <b>${esc(Prof.list[0].name)}</b> is kept in step with the computer; the others keep their progress on this phone only.`}</p>
      <div class="prof-list">${Prof.list.map((p) => `<div class="prof-row ${p.id === Prof.cur ? "on" : ""}">
        <button class="prof-face" data-prof-face="${p.id}" aria-label="Change the picture">${p.face}</button>
        <span class="prof-who"><input data-prof-name="${p.id}" value="${esc(p.name)}" maxlength="24" aria-label="Name"><small>${Prof.server ? (p.id === Prof.cur ? "This phone" : "") : p.id === "main" ? "Synced with the computer" : "Progress on this phone only"}</small></span>
        ${p.locked ? `<span title="Has a PIN">🔒</span>` : ""}
        ${p.id === Prof.cur ? `<span class="badge">In use</span>` : `<button class="btn sm" data-prof-use="${p.id}">Use</button>`}
        ${p.id !== "main" && !Prof.server ? `<button class="btn sm danger" data-prof-del="${p.id}" aria-label="Remove">✕</button>` : ""}</div>`).join("")}</div>
      ${Prof.server ? `<button class="btn" data-prof-pin>🔑 ${Prof.me().locked ? `Change or remove ${esc(Prof.me().name)}'s PIN` : `Give ${esc(Prof.me().name)} a PIN`}</button>` : ""}
      <form class="prof-add" id="profAdd"><input id="profNew" maxlength="24" placeholder="A name" autocomplete="off"><button class="btn">＋ Add a profile</button></form></div>`],
    ["look", "🎨", "Look", `${S.themeChoice === "auto" && !S.eink ? "Same as the computer" : theme ? theme.name : "Theme"} · ${(NAVS.find((n) => n[0] === S.nav) || NAVS[0])[1]}`, () => `
    <div class="panel set-grp"><h3>Look</h3>
      <label class="check"><input type="checkbox" id="einkOn" ${S.eink ? "checked" : ""}> E-reader mode <small class="hint">(for e-ink screens: switches to the E-reader theme, with no animations or shadows)</small></label>
      <div class="field"><label for="themeSel">Theme</label><select id="themeSel"><option value="auto">Same as the computer</option>${Object.entries(window.THEMES || {}).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}</select></div>
      <h4 class="pick-h">Getting around <small>how you switch between Home, Library, Catalogue…</small></h4>
      <div class="pick-grid">${NAVS.map(([k, n, d, zany]) => `<button class="pick ${S.nav === k ? "on" : ""} ${zany ? "zany" : ""}" data-nav-pick="${k}"><i class="pk pk-${k}"></i><b>${n}</b><small>${d}</small></button>`).join("")}</div>
      ${WEB ? "" : `<h4 class="pick-h">Big screens <small>Samsung DeX, or a tablet with a mouse</small></h4>
      <div class="chips"><b class="chip-lbl">Desktop layout</b>${[["auto", "Auto"], ["on", "On"], ["off", "Off"]].map(([k, n]) => `<button data-dexmode="${k}" class="${(S.dexMode || "auto") === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="chips"><b class="chip-lbl">Size</b>${[[0, "Auto"], [1, "100%"], [1.25, "125%"], [1.5, "150%"], [1.75, "175%"], [2, "200%"]].map(([k, n]) => `<button data-dexscale="${k}" class="${(+S.dexScale || 0) === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <p class="hint">${(() => { const [w, h] = viewSize(); let info = ""; try { info = A.screenInfo ? A.screenInfo() : ""; } catch (e) {} return `This window: ${w} × ${h}. ${isDex() ? `Desktop layout on, drawn at ${Math.round((fitDex.k || 1) * 100)}%.` : "Phone layout."}${info ? ` <small>(${esc(info)})</small>` : ""}`; })()}</p>`}
      <h4 class="pick-h">Journal style</h4>
      <div class="pick-grid three">${JSTYLES.map(([k, n, d]) => `<button class="pick ${S.jstyle === k ? "on" : ""}" data-jstyle-pick="${k}"><i class="pk pk-j-${k}"></i><b>${n}</b><small>${d}</small></button>`).join("")}</div></div>`],
    ["reading", "📖", "Reading & news", `Bulletin challenge, page-turn buttons, news alerts`, () => `
    <div class="panel set-grp"><h3>The Bulletin</h3>
      <div class="chips"><b class="chip-lbl">Challenge lasts</b>${[["week", "A week"], ["month", "A month"]].map(([k, n]) => `<button data-bperiod="${k}" class="${(S.bulletinPeriod || "week") === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <p class="hint">For this profile only, here and on the computer. A month starts on the 1st, a week on Monday.</p></div>
    ${window.PageKeys ? PageKeys.panel().replace('<div class="panel" id="pkPanel">', '<div class="panel set-grp" id="pkPanel">') : ""}
    <div class="panel set-grp"><h3>News</h3>
      <label class="check"><input type="checkbox" id="newsAlerts" ${A && A.newsAlerts && A.newsAlerts() ? "checked" : ""}> Notify me when a new event turns up in the News “Events” section</label>
      <p class="hint">${WEB ? "Works when this app is on your Home Screen (in Safari: Share → Add to Home Screen, then open it from there). The computer looks every few hours and sends the notification; tap it to share or open the event." : "The computer looks every few hours; the phone checks in about once an hour and needs to reach the computer (home Wi-Fi, or “Reach this library from anywhere”). Each notification has Share and Open."}</p></div>`],
    ["files", "📁", "Files", `${Object.keys(S.files).length} files on this ${WEB ? "device" : "phone"}${A && A.freeSpace ? ` · ${fmtSize(A.freeSpace())} free` : ""}`, () => `
    <div class="panel set-grp"><h3>Files on this phone</h3><p class="hint">${Object.keys(S.files).length} files · ${A ? fmtSize(A.freeSpace()) : "?"} free</p>
      <div class="btns"><button class="btn" id="myFiles">See what's on the phone</button></div>
      ${A && A.scanFolder ? `<p class="hint">Already have books, comics, music or films from your library on this ${WEB ? "device (in Files)" : "phone (in Downloads, say)"}? ${WEB ? "Pick them" : "Pick the folder"} and the ones that are in your library are added here, without downloading them again. ${WEB ? "" : "The originals stay where they are."}</p>
        <div class="btns">${WEB ? `<button class="btn" data-scan="new">🔍 Find my files on this device</button>` : `<button class="btn" data-scan="pick">🔍 Pick files…</button><button class="btn" data-scan="new">📁 Look through a folder…</button>${A.scanFolderKnown && A.scanFolderKnown() ? `<button class="btn" data-scan="again">↻ Look again</button>` : ""}`}</div>
        ${WEB ? "" : `<p class="hint">Android doesn't let apps look through all of Downloads: pick the files there (hold one to choose several), or a folder inside it.</p>`}
        <p class="hint" id="scanState"></p>` : ""}</div>
    <div class="panel set-grp"><h3>Files</h3>
      <label class="check"><input type="checkbox" id="autoGet" ${S.autoGet ? "checked" : ""}> Fetch files sent from the computer by itself (Wi-Fi or mobile data)</label></div>`],
    ["browser", "🌐", "Browser", `${pwN} saved password${pwN === 1 ? "" : "s"} · ${nLim ? nLim + " time limit" + (nLim === 1 ? "" : "s") : "no time limits"}`, WEB || !A || !A.siteLimits ? null : () => `
    ${WEB || !A || !A.passwordCount ? "" : (() => { const pwN = A.passwordCount();
      return `<div class="panel set-grp"><h3>🔑 Passwords</h3>
        <p class="hint">${pwN ? `${pwN} saved on this phone, encrypted in its secure keystore. On a site you have one for, 🔑 on the browser's bar fills it in.` : "Import an export from Chrome, Firefox, Edge, Bitwarden, 1Password or LastPass (a .csv file). They're encrypted in this phone's secure keystore, for the browser's 🔑."}</p>
        <div class="btns"><button class="btn" id="pwImport" type="button">Import passwords…</button>${pwN ? `<button class="btn danger" id="pwClear" type="button">Remove all</button>` : ""}</div>
        <p class="hint">Your phone's own password manager (Google, Samsung Pass…) works in the browser too.</p></div>`; })()}
    ${WEB || !A || !A.siteLimits ? "" : (() => {
      let sl = { limits: {}, used: {} };
      try { sl = JSON.parse(A.siteLimits()); } catch (e) {}
      const fmt = (m) => m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
      const rows = Object.entries(sl.limits || {}).map(([d, m]) => { const u = Math.round(((sl.used || {})[d] || 0) / 60);
        return `<div class="row" style="align-items:center;gap:8px;margin:6px 0"><b style="flex:1">${esc(d)}</b><span class="hint">${fmt(u)} of ${fmt(m)} today</span><button class="btn" data-limit-off="${esc(d)}" aria-label="Remove the limit">✕</button></div>`; }).join("");
      return `<div class="panel set-grp"><h3>Browser time limits</h3>
        ${rows || `<p class="hint">No limits yet.</p>`}
        <input id="limSite" placeholder="Website, like youtube.com" style="display:block;width:100%;box-sizing:border-box;margin-top:8px" autocapitalize="off" autocorrect="off" inputmode="url">
        <div class="row" style="gap:8px;align-items:center;margin-top:8px">
          <select id="limMin" style="flex:1">${[15, 30, 45, 60, 90, 120, 180].map((m) => `<option value="${m}" ${m === 60 ? "selected" : ""}>${fmt(m)}</option>`).join("")}</select>
          <button class="btn primary" data-limit-add>Add</button></div>
        <p class="hint">A day's time on a website in the browser: it counts while the site is on screen or playing, and when it runs out the site closes until midnight. These are ${esc(Prof.me().name)}'s limits: each profile has its own${Prof.server ? ", and they follow it to its other phones" : ""}.</p></div>`; })()}`],
    ["phone", "📱", "This phone", "Home screen, default browser, sleep screen", window.AddOns ? () => AddOns.settingsPanel().replace('<div class="panel">', '<div class="panel set-grp">') : null],
  ].filter((x) => x[4]);
  const open = SECTIONS.find((x) => x[0] === S.setPane);
  if (!open) S.setPane = null;
  v.innerHTML = open
    ? `<div class="set-top"><button class="set-back" data-setp="" type="button" aria-label="Back to Settings">‹ Settings</button><h2 class="set-title"><i>${open[1]}</i>${esc(open[2])}</h2></div>${open[4]()}`
    : `<h2 class="set-title set-main">Settings</h2>
      <div class="set-menu">${SECTIONS.map(([k, ic, t, sum]) => `<button class="set-row${k === "computer" && !paired ? " warn" : ""}" data-setp="${k}" type="button"><i>${ic}</i><span><b>${esc(t)}</b><small>${esc(sum)}</small></span><em>›</em></button>`).join("")}</div>
    <p class="hint" style="text-align:center">Babel's Library for ${WEB ? "iPhone & iPad" : "Android"} 1.0${S.ops.length ? ` · ${S.ops.length} change${S.ops.length === 1 ? "" : "s"} waiting to send` : ""}</p>`;
  if ($("#themeSel")) $("#themeSel").value = S.eink ? "eink" : S.themeChoice;
}
async function lookForComputer() {
  found = [];
  $("#found").innerHTML = `<p class="hint">Looking on your Wi-Fi…</p>`;
  const r = await bridge("discover");
  try { found = JSON.parse(r.text || "[]"); } catch (e) { found = []; }
  render();
}
async function pair() {
  let addr = ($("#addr").value || "").trim();
  const code = ($("#code").value || "").replace(/\D/g, "");
  if (!addr && !WEB) return toast("Type the computer's address, or tap Look for my computer.");
  if (code.length !== 6) return toast("The code has 6 digits.");
  if (WEB) { if (addr && !/^https:\/\//.test(addr)) addr = "https://" + addr.replace(/^\w+:\/\//, ""); }   // (empty: found from the code)
  else {
    if (!/^https?:\/\//.test(addr)) addr = "http://" + addr;
    if (!/:\d+$/.test(addr.replace(/^https?:\/\//, ""))) addr += ":8766";
  }
  S.pairAddr = addr;
  const b = $("#pairBtn"); b.disabled = true; b.textContent = "Pairing…";
  const device = load("device.json", null) || { id: "ph-" + Math.random().toString(36).slice(2) + Date.now().toString(36) };
  store("device.json", device);
  const r = await bridge("pair", addr, JSON.stringify({ code, name: A.deviceName(), device: device.id }));
  let d = {};
  try { d = JSON.parse(r.text || "{}"); } catch (e) {}
  if (r.status !== 200) {
    b.disabled = false; b.textContent = "Pair";
    return toast(r.status ? d.error || "Pairing failed." : WEB ? (r.text || "Couldn't find your computer. Is it on, with “Reach this library from anywhere” switched on?") : "Couldn't reach that address. Is the computer on, on the same Wi-Fi?");
  }
  // (the web app always goes through the away-from-home address: an https page can't reach the home Wi-Fi's http one)
  S.conn = WEB ? { lan: "", remote: r.route || addr, topic: d.topic || "", token: d.token, pc: d.pc || "" } : { lan: addr, remote: "", topic: d.topic || "", token: d.token, pc: d.pc || "" };
  S.since = 0; S.items = {}; S.ops = []; saveOps();
  pushConn(); saveState();
  toast(`Paired with ${d.pc}`);
  setTab("home");
  sync(true);
}
function unpair() {
  if (!confirm("Unpair from this computer? The library list is cleared from the phone; downloaded files stay until you remove them.")) return;
  S.conn = { lan: "", remote: "", topic: "", token: "", pc: "" };
  S.items = {}; S.anns = {}; S.since = 0; S.lastSync = 0; S.ops = [];
  pushConn(); saveState(); saveLibrary(); saveOps();
  render();
}

/* ---------------------------------------------------------------- one item */
function openSheet(id) {
  const it = S.items[id];
  if (!it) return;
  S.sheetId = it.id;
  const sh = $("#sheet");
  const rc = copyOf(it), mine = onPhone(it) ? it : rc && onPhone(rc) ? rc : it;
  const here = hereAny(it), dlIt = S.downloads[id] ? it : rc && S.downloads[rc.id] ? rc : it, dl = S.downloads[dlIt.id];
  const more = rc && !(onPhone(it) && onPhone(rc));        // (one version here, the other still on the computer)
  const st = dl && S.dlState[dl];
  const notes = Ann.of(it.id).sort((a, b) => a.created_at - b.created_at);
  const log = Prof.isMain() && S.log.find((l) => l.item_id === it.id || (it.kind === "tv" && l.kind === "show" && String(l.title).toLowerCase() === String(it.series || "").toLowerCase()));
  const entries = log ? Object.values(S.journal).filter((j) => j.log_id === log.id).sort((a, b) => b.created_at - a.created_at) : [];
  const meta = [it.year, it.genre, it.kind === "graphic" ? (it.format === "manga" ? "Manga" : "Comic") : "", it.series && it.kind !== "tv" ? `${it.series}${it.series_index ? " #" + +it.series_index : ""}` : "",
    it.file_type ? it.file_type.toUpperCase() : "", it.file_size ? fmtSize(it.file_size) : ""].filter(Boolean).join(" · ");
  const p = pct(it);
  sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(it.title)}</h2></div>
    <div class="it-head">${cover(it)}<div><h3>${esc(it.title || "Untitled")}</h3><p>${esc(byline(it))}</p><p>${esc(meta)}</p>
      <div class="big-p"><i style="width:${p}%"></i></div><small class="hint">${it.watched ? "Finished" : p ? p + "% · " + (it.opened_at ? ago(it.opened_at) : "") : "Not started"}</small>${Prof.isMain() && S.conn.token ? `<small class="hint it-covhint">Hold the cover to change it</small>` : ""}</div></div>
    <div class="it-body">
      <div class="btns">
        ${here ? `<button class="btn primary" data-open="${it.id}">▶ ${verb(it)}</button>` : ""}
        ${dl ? `<div style="flex:1 1 100%"><div class="dlbar" data-dlbar="${dlIt.id}"><i style="width:${st && st.total > 0 ? 100 * st.done / st.total : 3}%"></i></div><small class="hint">Starting…</small></div><button class="btn sm" data-cancel="${dlIt.id}">Cancel</button>` : ""}
        ${(!here || more) && !dl && it.has_file ? `<button class="btn ${here ? "" : "primary"}" data-get="${it.id}">⬇ Get from computer${!rc && it.file_size ? " (" + fmtSize(it.file_size) + ")" : ""}</button>` : ""}
        ${!it.has_file ? `<span class="hint">${it.wanted ? "On your wishlist." : it.physical ? "A physical copy (no file)." : "No file on the computer."}</span>` : ""}
      </div>
      <div class="btns">
        <button class="btn sm" data-fav="${it.id}">${it.favorite ? "★ Favourite" : "☆ Favourite"}</button>
        ${isVideo(it) ? `<button class="btn sm" data-watched="${it.id}">${it.watched ? "✓ Watched" : "Mark watched"}</button>`
          : it.kind !== "music" ? `<button class="btn sm" data-finish="${it.id}">${p >= 100 ? "✓ Finished" : "Mark finished"}</button>` : ""}
        ${!it.has_file ? `<button class="btn sm" data-wish="${it.id}">${it.wanted ? "Remove from wishlist" : "Add to wishlist"}</button>` : ""}
        ${here ? `<button class="btn sm" data-with="${mine.id}">Open in another app</button><button class="btn sm danger" data-remove="${mine.id}">Remove ${rc && onPhone(it) && onPhone(rc) ? "the original " : ""}from phone</button>${rc && onPhone(it) && onPhone(rc) ? `<button class="btn sm danger" data-remove="${rc.id}">Remove the reading copy</button>` : ""}` : ""}
      </div>
      ${stPick(it, log)}
      ${it.summary ? `<p class="sum">${esc(it.summary)}</p>` : ""}
      ${(it.authors || [])[0] && ["book", "graphic"].includes(it.kind) ? `<div class="btns"><button class="btn sm" data-ct-author="${esc(it.authors[0])}" data-ct-kind="${it.kind === "graphic" ? (it.format === "manga" ? "manga" : "comic") : "book"}">${it.kind === "graphic" ? "More from this author" : "All releases by " + esc(it.authors[0])}</button></div>` : ""}
      <h3 style="margin-top:16px">Your review</h3>
      ${log ? `<p class="hint">${[log.status && log.status !== "finished" ? { reading: isVideo(it) ? "Watching" : "Reading", next: "Up next", hold: "On hold", dropped: "Dropped" }[log.status] : "", log.finished ? "Finished " + log.finished : "", log.kind === "movie" && log.score != null ? `${+log.score}/10` : ""].filter(Boolean).map(esc).join(" · ")}</p>
        ${entries.map((j) => `<div class="note">${esc(j.body)}</div>`).join("")}` : ""}
      <div class="btns"><button class="btn sm" data-journal="${it.id}">✎ ${log ? "Open in journal" : "Write a review"}</button></div>
      ${notes.length ? `<h3 style="margin-top:16px">Notes and highlights (${notes.length})</h3>${notes.map((a) => `<div class="note">${a.quote ? `<q>${esc(a.quote)}</q>` : ""}${esc(a.note || a.title || "")}</div>`).join("")}` : ""}
      ${kinHtml(it)}
      <div id="itFull"><p class="hint" style="margin-top:16px">${S.conn.token ? "Loading the full details from your computer…" : ""}</p></div>
    </div>`;
  sh.hidden = false;
  sh.scrollTop = 0;
  if (dl) watchDownloads();
  if (S.conn.token) fullDetails(it.id);
}
/* a new cover for an item: hold its cover on its page. Search posters and book covers by its title, paste a picture's
   address, or use a photo from the phone; the computer keeps it (and every device gets it on its next sync). */
function itemCoverPicker(it) {
  if (!S.conn.token) return toast("Changing a cover needs the computer");
  const kind = it.kind === "movie" ? "movie" : it.kind === "tv" ? "show" : "book";
  const q0 = [it.kind === "tv" ? it.series || it.title : it.title, ["book", "graphic"].includes(it.kind) ? (it.authors || [])[0] || "" : ""].filter(Boolean).join(" ");
  const w = document.createElement("div");
  w.className = "keep-ask j-cpick";
  w.innerHTML = `<div class="ka-card" role="dialog"><h3>A new cover for “${esc(it.title || "")}”</h3>
    <form class="j-cp-row" data-cps><input name="q" value="${esc(q0)}" placeholder="search for it…" autocomplete="off"><button class="btn primary">Search</button></form>
    <div class="j-cp-grid"><p class="hint">Looking…</p></div>
    <form class="j-cp-row" data-cpu><input name="u" inputmode="url" placeholder="or paste a picture's web address" autocomplete="off"><button class="btn">Use</button></form>
    <div class="ka-row"><label class="btn">📷 A picture on this phone<input type="file" accept="image/*" hidden></label><button class="btn" data-x>Cancel</button></div></div>`;
  const grid = w.querySelector(".j-cp-grid");
  let found = [];
  const search = async (q) => {
    grid.innerHTML = `<p class="hint">Looking…</p>`;
    try { found = await api("GET", `/sync/log/covers?kind=${kind}&q=${encodeURIComponent(q)}`); }
    catch (e) { grid.innerHTML = `<p class="hint">${esc(e.offline ? "Changing a cover needs the computer." : e.message)}</p>`; return; }
    grid.innerHTML = found.length ? found.map((c, i) => `<button class="j-cp-hit" data-cp="${i}"><img loading="lazy" alt="" src="${esc(c.img)}" onerror="this.closest('button').remove()"><b>${esc(c.title)}</b><small>${esc(c.sub || "")}</small></button>`).join("")
      : `<p class="hint">Nothing found. Try other words, or paste a picture's address.</p>`;
  };
  const choose = async (body) => {
    w.querySelector(".ka-card").classList.add("busy");
    try {
      const r = await api("POST", `/sync/item/${it.id}/coverpick`, body);
      if (r.item) Object.assign(S.items[it.id], { has_cover: r.item.has_cover, cover_v: r.item.cover_v, cover_path: r.item.cover_path });
      saveLibrary(true);
      w.remove();
      toast("Cover changed");
      if (S.sheetId === it.id && !$("#sheet").hidden) openSheet(it.id);
      sync();
    } catch (e) { w.querySelector(".ka-card").classList.remove("busy"); toast(e.offline ? "Changing a cover needs the computer" : e.message); }
  };
  w.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.matches("[data-cps]")) search(e.target.q.value.trim());
    else if (e.target.u.value.trim()) choose({ url: e.target.u.value.trim() });
  });
  w.addEventListener("click", (e) => {
    const h = e.target.closest("[data-cp]");
    if (h) return choose({ url: found[Number(h.dataset.cp)].img });
    if (e.target.closest("[data-x]") || e.target === w) w.remove();
  });
  w.querySelector("input[type=file]").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1200 / img.width), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      choose({ data: c.toDataURL("image/jpeg", 0.9) });
    };
    img.onerror = () => toast("That picture couldn't be opened");
    img.src = url;
  });
  document.body.append(w);
  search(q0);
}
// hold an item's cover on its page (half a second) to choose another
document.addEventListener("pointerdown", (e) => {
  const c = e.target.closest?.("#sheet .it-head .cov");
  if (!c || !S.sheetId) return;
  const id = S.sheetId, x = e.clientX, y = e.clientY;
  let timer = setTimeout(() => { timer = 0; c.classList.remove("holding"); if (navigator.vibrate) navigator.vibrate(15); itemCoverPicker(S.items[id]); }, 550);
  c.classList.add("holding");
  const stop = (ev) => {
    if (ev.type === "pointermove" && Math.hypot(ev.clientX - x, ev.clientY - y) < 10) return;
    clearTimeout(timer); c.classList.remove("holding");
    document.removeEventListener("pointerup", stop, true); document.removeEventListener("pointercancel", stop, true); document.removeEventListener("pointermove", stop, true);
  };
  document.addEventListener("pointerup", stop, true); document.addEventListener("pointercancel", stop, true); document.addEventListener("pointermove", stop, true);
});
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.("#sheet .it-head .cov")) e.preventDefault(); });
/* where you are with it: a row of stamps (the journal's status, the same as the computer's); tap one to set it */
function stPick(it, log) {
  if (!Prof.isMain() || it.kind === "music") return "";
  const cur = log ? log.status || (log.finished ? "finished" : "") : "";
  const name = { reading: isVideo(it) ? "Watching" : "Reading", next: "Up next", finished: isVideo(it) ? "Watched" : "Finished", hold: "On hold", dropped: "Dropped" };
  const icon = { next: "⏭", reading: isVideo(it) ? "▶" : "📖", finished: "✓", hold: "⏸", dropped: "✕" };
  return `<div class="st-pick" role="radiogroup" aria-label="Status">${["next", "reading", "finished", "hold", "dropped"].map((k) =>
    `<button class="st-p st-${k}${cur === k ? " on" : ""}" role="radio" aria-checked="${cur === k}" data-stset="${k}" data-id="${it.id}"><i>${icon[k]}</i><span>${name[k]}</span></button>`).join("")}</div>`;
}
/* "More from": the rest of its series on your shelves first; otherwise more by the same author or director */
function kinHtml(it) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const lead = (x) => norm(((x.authors || [])[0] || "").replace(/^(.*),\s*(.*)$/, "$2 $1"));
  const mine = Object.values(S.items).filter((x) => x.id !== it.id && x.has_file && x.kind !== "music" && !isCopy(x));
  let list = [], head = "";
  if (it.series) {
    list = mine.filter((x) => norm(x.series) === norm(it.series) && (it.kind === "tv") === (x.kind === "tv"))
      .sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0) || (a.series_index || 0) - (b.series_index || 0));
    head = it.kind === "tv" ? `More of ${it.series}` : `More from the ${it.series} series`;
  }
  if (!list.length && lead(it)) { list = mine.filter((x) => lead(x) === lead(it) && x.kind !== "tv"); head = `More ${it.kind === "movie" ? "directed by" : "by"} ${byline(it)}`; }
  if (!list.length) return "";
  return `<h3 style="margin-top:16px">${esc(head)}</h3><div class="shelf">${list.slice(0, 16).map((x) => card(x, x.kind === "tv" ? `S${x.season || 1} · E${x.episode ?? "?"}` : [x.series_index ? "#" + +x.series_index : "", x.year].filter(Boolean).join(" · "))).join("")}</div>`;
}
/* which shelf an item is on, and what moving it to another one changes ("paper" and "web" sources settle whether an
   article is a scientific paper or a news story, whatever its address suggests) */
const SHELVES = [["book", "Book"], ["manga", "Manga"], ["comic", "Comic"], ["paper", "Scientific paper"], ["news", "News story"], ["movie", "Film"], ["tv", "TV episode"], ["music", "Music"]];
const SHELF_FIELDS = { book: { kind: "book" }, manga: { kind: "graphic", format: "manga" }, comic: { kind: "graphic", format: "comic" },
  paper: { kind: "article", source: "paper" }, news: { kind: "article", source: "web" }, movie: { kind: "movie" }, tv: { kind: "tv" }, music: { kind: "music" } };
const shelfOf = (d) => d.kind === "graphic" ? (d.format === "manga" ? "manga" : "comic") : d.kind === "article" ? (isNewsStory(d) ? "news" : "paper") : d.kind;
/* the rest of the details, as on the computer: they come from the computer (and edits go straight back to it) */
async function fullDetails(id) {
  const box = $("#itFull");
  let d;
  try { d = await api("GET", `/sync/item/${id}`); } catch (e) { if (box) box.innerHTML = `<p class="hint" style="margin-top:16px">Connect to your computer to see and edit all the details.</p>`; return; }
  if (!box || S.sheetId !== id) return;
  const vid = d.kind === "tv" || d.kind === "movie", media = vid || d.kind === "music";
  const F = (name, label, val, type = "text", full = false) => `<label class="field ${full ? "full" : ""}"><span>${label}</span><input name="${name}" type="${type}" value="${esc(val ?? "")}"></label>`;
  const cites = Object.entries(d.citations || {}).map(([label, c]) => `<div class="cite"><b>${esc(label)}</b><span>${esc(c.text)}</span><button class="btn sm" data-copytext="${esc(c.text)}">Copy</button></div>`).join("");
  box.innerHTML = `
    ${(d.tags || []).length ? `<h3 style="margin-top:16px">Tags</h3><div class="chips">${d.tags.map((t) => `<span class="chip-tag">${esc(t)}</span>`).join("")}</div>` : ""}
    ${d.url ? `<div class="btns"><button class="btn sm" data-go-url="${esc(d.url)}">Visit the web page ↗</button></div>` : ""}
    ${!media && cites ? `<h3 style="margin-top:16px">Citations</h3><div class="cites">${cites}</div>` : ""}
    <h3 style="margin-top:16px">Details</h3>
    <form class="it-form" id="itForm">
      ${Prof.server ? `<label class="check full only-me"><input type="checkbox" name="private" ${d.private_to ? "checked" : ""}><span><b>🔒 Only me</b><small class="hint">(${Prof.list.length > 1 ? "hidden from the other profiles" : "hidden from profiles added later; there's only one now"})</small></span></label>` : ""}
      <label class="field full"><span>Shelf</span><select name="shelf">${SHELVES.map(([k, n]) => `<option value="${k}" ${shelfOf(d) === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      ${F("title", "Title", d.title, "text", true)}
      <label class="field full"><span>${vid ? "Directors / creators" : d.kind === "music" ? "Artists" : "Authors"} (one per line)</span><textarea name="authors" rows="2">${esc((d.authors || []).join("\n"))}</textarea></label>
      ${F("year", "Year", d.year)}
      ${d.kind !== "article" ? F("genre", "Genre", d.genre) : ""}
      ${["book", "graphic", "movie", "tv"].includes(d.kind) ? F("series", "Series", d.series) : ""}
      ${["book", "graphic", "movie"].includes(d.kind) ? F("series_index", "Number in series", d.series_index, "number") : ""}
      ${d.kind === "tv" ? F("season", "Season", d.season, "number") + F("episode", "Episode", d.episode, "number") : ""}
      ${d.kind === "graphic" ? `<label class="field"><span>Format</span><select name="format"><option value="comic">Comic</option><option value="manga" ${d.format === "manga" ? "selected" : ""}>Manga</option></select></label>
        <label class="field"><span>Reading direction</span><select name="direction"><option value="ltr">Left to right</option><option value="rtl" ${d.direction === "rtl" ? "selected" : ""}>Right to left</option></select></label>` : ""}
      ${d.kind === "article" ? F("journal", "Journal", d.journal, "text", true) + F("doi", "DOI", d.doi) : ""}
      ${!media ? F("publisher", "Publisher", d.publisher) + F("isbn", "ISBN", d.isbn) : ""}
      ${F("url", "Web address", d.url, "url", true)}
      ${d.kind !== "music" ? `<label class="field full"><span>${d.kind === "article" ? "Abstract" : "Synopsis"}</span><textarea name="summary" rows="5">${esc(d.summary || "")}</textarea></label>` : ""}
      <label class="field full"><span>Tags (comma separated)</span><input name="tags" value="${esc((d.tags || []).join(", "))}"></label>
    </form>
    <div class="btns it-acts">
      ${["book", "graphic"].includes(d.kind) && !d.has_cover ? `<button class="btn sm" data-act="pullcover">Pull cover</button>` : ""}
      ${["book", "graphic"].includes(d.kind) ? `<button class="btn sm" data-act="hardcover">Pull info from Hardcover</button>` : ""}
      ${vid ? `<button class="btn sm" data-act="poster">Find poster</button>` : ""}
      ${d.file_type === "pdf" && d.kind !== "graphic" ? `<button class="btn sm" data-act="reading-copy">${copyOf(S.items[d.id]) ? "Make the reading copy again" : "Make reading copy"}</button>` : ""}
      <button class="btn sm" data-act="reanalyze">Re-sort and re-tag</button>
      <button class="btn sm danger" data-act="remove">Remove from library</button>
    </div>
    ${d.file_location ? `<p class="hint">On the computer: ${esc(d.file_location)}</p>` : ""}`;
  $("#itForm").addEventListener("change", async (e) => {
    const el = e.target;
    if (el.name === "private") {
      const on = el.checked, it = S.items[id];
      let these = [id];
      if (it && inSeries(it)) {           // one volume of a series (or episode of a show): just this one, or all of it?
        const k = seriesKey(it.series);
        const rest = Object.values(S.items).filter((x) => x.id !== it.id && !isCopy(x) && inSeries(x) && seriesKey(x.series) === k && !!x.private_to !== on);
        if (rest.length) {
          const whole = it.kind === "tv" ? "the whole show" : "the whole series";
          const a = await askKeep(on ? `Hide ${whole}?` : `Show ${whole} again?`, `“${it.series}” has ${rest.length} more ${rest.length > 1 ? "items" : "item"} in the library.`,
            [["Just this one", "one"], [`${whole[0].toUpperCase()}${whole.slice(1)} (${rest.length + 1})`, "all", "primary"]]);
          if (a == null) { el.checked = !on; return; }
          if (a === "all") these = [id, ...rest.map((x) => x.id)];
        }
      }
      try {
        await Promise.all(these.map((x) => api("POST", `/sync/item/${x}/edit`, { private: on })));
        for (const x of these) if (S.items[x]) S.items[x].private_to = on ? Prof.cur : null;
        saveLibrary(true);
        return toast(on ? `${these.length > 1 ? these.length + " items h" : "H"}idden from the other profiles` : `${these.length > 1 ? these.length + " items" : "It"} can be seen by everyone again`);
      } catch (err) { el.checked = !on; return toast(err.message); }
    }
    if (el.name === "shelf") {           // another shelf: Books, Manga, Comics, papers, news stories, films, TV, music
      const f = SHELF_FIELDS[el.value];
      try {
        await api("POST", `/sync/item/${id}/edit`, f);
        if (S.items[id]) { Object.assign(S.items[id], f); saveLibrary(true); }
        toast(`Moved to ${SHELVES.find((x) => x[0] === el.value)[1]}`);
        return fullDetails(id);          // (the fields that suit the new shelf)
      } catch (err) { return toast(err.message); }
    }
    let v = el.value;
    if (el.name === "authors") v = v.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    else if (el.name === "tags") v = v.split(",").map((x) => x.trim()).filter(Boolean);
    else if (el.type === "number") v = v === "" ? null : Number(v);
    try {
      await api("POST", `/sync/item/${id}/edit`, { [el.name]: v });
      if (S.items[id]) { S.items[id][el.name] = v; saveLibrary(true); }
      toast("Saved on your computer");
    } catch (err) { toast(err.message); }
  });
}
document.addEventListener("click", async (e) => {
  const c = e.target.closest("[data-copytext]");
  if (c) { try { await navigator.clipboard.writeText(c.dataset.copytext); toast("Citation copied"); } catch (err) { toast("Couldn't copy"); } return; }
  const a = e.target.closest("[data-act]");
  if (!a || S.sheetId == null) return;
  const id = S.sheetId, act = a.dataset.act;
  if (act === "remove" && !confirm("Remove it from your library? The file stays on the computer.")) return;
  a.disabled = true;
  try {
    await api("POST", `/sync/item/${id}/${act}`, {});
    if (act === "reading-copy") {
      toast("Making a reading copy on your computer…");
      for (let n = 0; n < 300; n++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await api("GET", `/sync/item/${id}/reading-copy`);
        if (st.state === "failed") throw new Error(st.error || "This PDF couldn't be converted.");
        if (st.state === "done") break;
      }
      await sync();
      a.disabled = false;
      return toast("Reading copy made: it's in your library as its own item. Get it from there.");
    }
    toast({ remove: "Removed from your library", pullcover: "Cover found", hardcover: "Info pulled from Hardcover", poster: "Poster found", reanalyze: "Re-sorting on your computer…" }[act]);
    await sync();
    if (act === "remove") return closeSheet();
    openSheet(id);
  } catch (err) { a.disabled = false; toast(err.message); }
});
/* The library as a fan deck of paper cards on a binder, pinned through one corner: the card in front stands upright,
   the next ones fan out behind it, and swiping flips the front card away around its pin (each flick moves a card or
   several; it settles on a card). Tap the front card to open it. */
const Deck = (() => {
  const STEP = 64;                 // swipe distance per card
  const KIND = {
    book: ["BK", "Book", "本"], graphic: ["GN", "Comic", "コミック"], article: ["AR", "Article", "記事"], movie: ["FM", "Film", "映画"],
    tv: ["TV", "Show", "テレビ"], music: ["MU", "Music", "音楽"],
  };
  const BINDER = { books: ["Books", "本"], articles: ["Articles", "記事"], music: ["Music", "音楽"], video: ["TV & Movies", "映像"],
    book: ["Books", "本"], manga: ["Manga", "漫画"], comic: ["Comics", "コミック"], paper: ["Papers", "論文"], news: ["News", "ニュース"], tv: ["TV", "テレビ"], movie: ["Films", "映画"] };
  let n = 0, raf = 0, labels = [];
  const kindOf = (it) => (it.kind === "graphic" && it.format === "manga" ? ["MG", "Manga", "漫画"] : KIND[it.kind] || ["IT", "Item", "資料"]);
  const card = (it, i) => {
    const k = kindOf(it), st = self.stacks[it.id];
    return `<button class="pc ${st ? "stack" : ""}" data-item="${it.id}" ${st ? `data-stack="${it.id}"` : ""} data-i="${i}" hidden style="--c:${colorFor(it)}">
      <i class="pc-eye"></i><small class="pc-code">${k[0]}-${String(it.id).padStart(4, "0")}</small>
      <span class="pc-art">${cover(it)}</span>
      <b class="pc-t">${esc(st ? it.series : it.kind === "tv" ? it.series || it.title : it.title || "Untitled")}</b>
      <small class="pc-s">${esc(st ? `📚 ${st.n} in the series · next: ${it.series_index ? "#" + +it.series_index + " " : ""}${it.title || ""}` : byline(it) || k[2])}</small>
      <span class="pc-foot"><em>${esc(k[1])} · ${esc(k[2])}</em><em>${it.year ? esc(it.year) : ""}</em></span></button>`;
  };
  // (labels: the group each card is in, shown on the binder with that group's count, like the computer's group headings)
  function html(list, groupLabels = []) {
    n = list.length;
    labels = groupLabels;
    const b = BINDER[S.kind !== "all" ? S.kind : S.area] || BINDER.books;
    const coll = S.coll === "wish" ? "Wishlist" : S.coll ? collName(S.coll) : "";
    return `<div class="deck" id="deck"><div class="deck-stage">
        <div class="deck-binder"><span class="db-k">${esc(b[0])} <i>${esc(b[1])}</i></span>${coll ? `<span class="db-c">${esc(coll)}</span>` : ""}<b class="db-n">${n}</b><span class="db-r" id="deckRange"></span>
          <span class="db-g" id="deckGroup"></span></div>
        ${list.map(card).join("")}
        <div class="deck-hint">swipe to flip · tap the card to open</div></div>
      <div class="deck-track">${'<i></i>'.repeat(n)}</div></div>`;
  }
  const key = () => [S.area, S.kind, S.groupBy, S.sort, S.coll, S.q].join("|");
  function paint() {
    raf = 0;
    const d0 = $("#deck");
    if (!d0) return;
    const f = d0.scrollTop / STEP;
    (S.deckAt ||= {})[key()] = Math.round(f);
    const i0 = Math.floor(f);
    $("#deckRange").textContent = `${Math.min(n, i0 + 1)}–${Math.min(n, i0 + 9)}`;
    const gi = Math.min(n - 1, Math.max(0, Math.round(f))), g = labels[gi];
    if (g != null && S.groupBy !== "none") {
      let a = gi, z = gi;
      while (a > 0 && labels[a - 1] === g) a--;
      while (z < n - 1 && labels[z + 1] === g) z++;
      $("#deckGroup").innerHTML = `<b>${esc(g)}</b><small>${gi - a + 1} of ${z - a + 1}</small>`;
    } else $("#deckGroup").textContent = "";
    for (const c of d0.querySelectorAll(".pc")) {
      const i = Number(c.dataset.i), d = i - f;
      if (d < -1 || d > 6) { if (!c.hidden) { c.hidden = true; c.classList.remove("front"); } continue; }
      c.hidden = false;
      let tf, op = 1, sh = 1;
      if (d < 0) {                      // swinging up and away to the right around the pin, gone before it's halfway
        const k = -d;
        if (k > 0.75) { c.hidden = true; c.classList.remove("front"); continue; }
        tf = `rotate(${-k * 72}deg)`;
        op = Math.max(0, 1 - k * 1.45);
      } else {                          // waiting behind on the same pin, each fanned a little further
        tf = `rotate(${d * 3.2}deg)`;
        sh = 1 - Math.min(d, 6) * 0.07;
      }
      c.style.transform = tf;
      c.style.opacity = op.toFixed(2);
      c.style.filter = sh < 1 ? `brightness(${sh.toFixed(2)})` : "";
      c.style.zIndex = String(1000 - i);
      c.classList.toggle("front", Math.abs(d) < 0.5);
    }
  }
  const queue = () => { if (!raf) raf = requestAnimationFrame(paint); };
  function mount() {
    const d = $("#deck");
    // it always comes to rest on a card: once your finger is off and the deck has stopped, it eases onto the nearest
    // (scroll snapping alone sometimes leaves it between two, with a card stuck halfway through its flip)
    let touching = false, still = 0;
    const settle = () => {
      if (touching) return;
      const f = d.scrollTop / STEP, r = Math.round(f);
      if (Math.abs(f - r) > 0.01) d.scrollTo({ top: r * STEP, behavior: "smooth" });
    };
    d.addEventListener("scroll", () => { queue(); clearTimeout(still); still = setTimeout(settle, 160); }, { passive: true });
    d.addEventListener("scrollend", settle);
    d.addEventListener("touchstart", () => { touching = true; }, { passive: true });
    const lift = () => { touching = false; clearTimeout(still); still = setTimeout(settle, 160); };
    d.addEventListener("touchend", lift, { passive: true });
    d.addEventListener("touchcancel", lift, { passive: true });
    d.scrollTop = ((S.deckAt || {})[key()] || 0) * STEP;
    paint();
  }
  // only the card in front opens; the rest are still being flipped past. A series' card opens to its volumes
  document.addEventListener("click", (e) => {
    const c = e.target.closest?.(".pc");
    if (!c) return;
    if (!c.classList.contains("front")) { e.stopPropagation(); e.preventDefault(); return; }
    const st = c.dataset.stack && self.stacks[c.dataset.stack];
    if (st) { e.stopPropagation(); e.preventDefault(); openSeries(st); }
  }, true);
  function openSeries(st) {
    const list = st.ids.map((id) => S.items[id]).filter(Boolean), first = list[0];
    const sh = $("#sheet");
    sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(first.series)}</h2></div>
      <div class="it-body" style="padding-top:14px"><p class="hint">${list.length} in the series · ${list.filter((x) => W.status(x)[0] === "done").length} finished</p>
        <div class="shelf series-shelf">${list.map((x) => `<button class="card ${W.status(x)[0] === "done" ? "seen" : ""}" data-item="${x.id}">${cover(x)}<b>${esc(x.title || "Untitled")}</b><small>${esc([x.series_index ? "#" + +x.series_index : "", x.year, W.status(x)[0] === "done" ? "✓ read" : pct(x) > 1 ? pct(x) + "%" : ""].filter(Boolean).join(" · "))}</small></button>`).join("")}</div></div>`;
    sh.hidden = false;
    sh.scrollTop = 0;
  }
  addEventListener("resize", queue);
  const self = { html, mount, STEP, stacks: {}, openSeries };
  return self;
})();
function closeSheet() { $("#sheet").hidden = true; Journal.close(); render(); }

/* ---------------------------------------------------------------- taps */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("#navHide")) return tabsOff(true);
  if (t.closest("#navNub")) return tabsOff(false);
  if (t.closest("#navMenu")) { document.body.classList.toggle("nav-open"); return placeBrowser(); }     // (the drawer goes over the browser)
  if (t.closest("#navScrim")) { document.body.classList.remove("nav-open"); return placeBrowser(); }
  const tab = t.closest("#tabs [data-tab]"); if (tab) { document.body.classList.remove("nav-open"); return setTab(tab.dataset.tab); }
  const np = t.closest("[data-nav-pick]"); if (np) { S.nav = np.dataset.navPick; saveState(); applyTheme(); return render(); }
  const dm = t.closest("[data-dexmode]"); if (dm) { S.dexMode = dm.dataset.dexmode; saveState(); applyTheme(); return render(); }
  if (t.closest("[data-limit-add]")) {
    const site = ($("#limSite").value || "").trim(), m = +$("#limMin").value || 60;
    if (!site) { toast("Type a website, like youtube.com"); return; }
    A.setSiteLimit(site, m); sendLimits(); toast(`${site} now has ${m >= 60 && m % 60 === 0 ? m / 60 + " h" : m + " min"} a day`); return render();
  }
  const lo = t.closest("[data-limit-off]");
  if (lo) { A.setSiteLimit(lo.dataset.limitOff, 0); sendLimits(); toast(`Limit taken off ${lo.dataset.limitOff}`); return render(); }
  const bp = t.closest("[data-bperiod]");
  if (bp) {
    const p = bp.dataset.bperiod;
    S.bulletinPeriod = p; saveState(); render();
    if (S.conn.token && Prof.server) api("POST", "/sync/bulletin/period", { period: p }).then(() => toast(p === "month" ? "The challenge now lasts a month" : "The challenge now lasts a week")).catch((e) => toast("Saved on this phone; the computer couldn't be reached: " + e.message));
    return;
  }
  const dsc = t.closest("[data-dexscale]"); if (dsc) { S.dexScale = +dsc.dataset.dexscale; saveState(); applyTheme(); setTimeout(render, 250); return render(); }
  const jp = t.closest("[data-jstyle-pick]"); if (jp) { S.jstyle = jp.dataset.jstylePick; saveState(); applyTheme(); return render(); }
  const go = t.closest("[data-go]"); if (go) return setTab(go.dataset.go);
  if (t.closest("#syncPill")) { if (S.conn.token) { sync(); toast("Syncing…"); } else setTab("settings"); return; }
  const ar = t.closest("[data-area]");
  if (ar) {      // a section: its own kinds, and the grouping you last used in it (as on the computer)
    (S.groupByArea ||= {})[S.area] = S.groupBy;
    S.area = ar.dataset.area; S.kind = "all"; S.groupBy = S.groupByArea[S.area] || "";
    saveState(); return render();
  }
  const k = t.closest("[data-kind]"); if (k) { S.kind = k.dataset.kind; S.limit = 60; saveState(); return render(); }
  if (t.closest("#more")) { S.limit += 100; return render(); }
  const item = t.closest("[data-item]"); if (item) return openSheet(Number(item.dataset.item));
  if (t.closest("[data-close]")) return closeSheet();
  const op = t.closest("[data-open]");
  if (op) {
    const x = S.items[op.dataset.open];
    return readHere(x);
  }
  const get = t.closest("[data-get]");
  if (get) {
    const x = S.items[get.dataset.get];
    if (copyOf(x)) return whichVersion(x, "Get", (y) => !onPhone(y) && !S.downloads[y.id]).then((v) => { if (!v) return; get.disabled = true; return getFiles([v]).then(() => openSheet(x.id)); });
    return pickSeries(x).then((list) => {
      if (!list) return;
      get.disabled = true;
      return getFiles(list).then(() => openSheet(Number(get.dataset.get)));
    });
  }
  const can = t.closest("[data-cancel]"); if (can) { removeFile(S.items[can.dataset.cancel]); return openSheet(Number(can.dataset.cancel)); }
  const rem = t.closest("[data-remove]"); if (rem) { if (confirm("Remove the file from this phone? It stays on the computer.")) { removeFile(S.items[rem.dataset.remove]); openSheet(Number(rem.dataset.remove)); } return; }
  const w = t.closest("[data-with]"); if (w) { if (!A.openWith(fileName(S.items[w.dataset.with]))) toast("No app on the phone can open this kind of file."); return; }
  const fav = t.closest("[data-fav]"); if (fav) { const it = S.items[fav.dataset.fav]; change(it.id, { favorite: it.favorite ? 0 : 1 }); return openSheet(it.id); }
  const wish = t.closest("[data-wish]"); if (wish) { const it = S.items[wish.dataset.wish]; change(it.id, { wanted: it.wanted ? 0 : 1 }); return openSheet(it.id); }
  const wa = t.closest("[data-watched]"); if (wa) { const it = S.items[wa.dataset.watched]; change(it.id, it.watched ? { watched: 0 } : { watched: 1, watched_at: now(), progress: 1 }); return openSheet(it.id); }
  const sp = t.closest("[data-stset]");
  if (sp) {
    const it = S.items[sp.dataset.id], k = sp.dataset.stset, on = sp.classList.contains("on");
    Journal.setStatus(it, k);
    if (k === "finished" && !on) change(it.id, isVideo(it) ? { watched: 1, watched_at: now(), progress: 1 } : { progress: 1 });
    toast(on ? "Status taken off" : `Marked ${sp.querySelector("span").textContent.toLowerCase()}`);
    return openSheet(it.id);
  }
  const fin = t.closest("[data-finish]"); if (fin) { const it = S.items[fin.dataset.finish]; change(it.id, { progress: pct(it) >= 100 ? 0 : 1 }); return openSheet(it.id); }
  const sst = t.closest("[data-hw-tab]"); if (sst) { if (sst.dataset.hwTab === W.tab) return; W.swapAnim = true; W.tab = sst.dataset.hwTab; W.sel = 0; store("hometab.json", W.tab); render(); $("#view").scrollTop = 0; return; }
  const ssc = t.closest("[data-ss]"); if (ssc) { const i = Number(ssc.dataset.ss); if (i === W.sel) return W.open(); W.sel = i; return W.place(); }
  const gu = t.closest("[data-go-url]"); if (gu) return A.openBrowser(gu.dataset.goUrl);
  const uc = t.closest("[data-up-cancel]"); if (uc) { A.cancelUpload(uc.dataset.upCancel); toast("Cancelling…"); return; }
  const ur = t.closest("[data-up-retry]"); if (ur) { A.retryUpload(ur.dataset.upRetry); return; }
  const ux = t.closest("[data-up-clear]"); if (ux) { A.dismissUpload(ux.dataset.upClear); paintUploads(); return; }
  if (t.closest("#libFilt, #libFiltSum")) { S.libFilt = !S.libFilt; return render(); }      // (the library's group / sort / collection)
  if (t.closest("#sendPc")) {
    if (!S.conn.token) return toast("Pair with your computer first (Settings).");
    return uploadPrivacy().then((priv) => { if (priv != null) A.pickFiles(priv); });
  }
  if (t.closest("#bClear")) { $("#bClearPick").hidden = !$("#bClearPick").hidden; return; }
  const bc = t.closest("[data-bclear]"); if (bc) return clearHistory(bc.dataset.bclear);
  const jr = t.closest("[data-journal]"); if (jr) { const it = S.items[jr.dataset.journal]; return Journal.open(Journal.forItem(it).id); }
  if (t.closest("#myFiles")) { S.tab = "phone"; return render(); }
  if (t.closest("#dlPill")) { setTab("home"); S.tab = "phone"; return render(); }
  if (t.closest("#look")) return lookForComputer();
  const pick = t.closest("[data-pick]"); if (pick) { $("#addr").value = pick.dataset.pick; S.pairAddr = pick.dataset.pick; $("#code").focus(); return; }
  if (t.closest("#pairBtn")) return pair();
  if (t.closest("#syncNow")) return sync().then(() => render());
  if (t.closest("#fullSync")) return sync(true).then(() => { toast("Library fetched again"); render(); });
  if (t.closest("#unpair")) return unpair();
});
/* search boxes that redraw the page as you type: never while the keyboard is partway through a word (redrawing
   swaps the box for a new one, and the keyboard loses the word); the redraw waits until the word is done */
let composing = false;
document.addEventListener("compositionstart", () => { composing = true; });
document.addEventListener("compositionend", (e) => { composing = false; if (e.target.id === "q" || e.target.id === "bq") e.target.dispatchEvent(new Event("input", { bubbles: true })); });
function redrawKeeping(id) {
  // the library's search: only the results below it are redrawn, so the box (and the word the keyboard is
  // partway through) stays as it is, and the results follow every letter
  if (id === "q" && S.tab === "library" && $("#libBody")) {
    const tmp = document.createElement("div");
    renderLibrary(tmp);
    const body = tmp.querySelector("#libBody");
    if (body) { $("#libBody").replaceWith(body); if (body.querySelector("#deck") && window.Deck && Deck.mount) Deck.mount(body.querySelectorAll("[data-item],[data-lay-series]").length); return; }
  }
  if (composing) return;
  const el = $("#" + id);
  const pos = el ? el.selectionStart : null;
  render();
  const q = $("#" + id);
  if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); }
}
document.addEventListener("input", (e) => {
  if (e.target.id === "bq") { S.bq = e.target.value; clearTimeout(render.b); render.b = setTimeout(() => redrawKeeping("bq"), 250); }
  if (e.target.id === "q") { S.q = e.target.value; clearTimeout(render.t); render.t = setTimeout(() => redrawKeeping("q"), 250); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "sort") { S.sort = e.target.value; saveState(); render(); }
  if (e.target.id === "libGroup") { S.groupBy = e.target.value; (S.groupByArea ||= {})[S.area] = S.groupBy; saveState(); render(); }
  if (e.target.id === "libColl") { S.coll = e.target.value; saveState(); render(); }
  if (e.target.id === "autoGet") { S.autoGet = e.target.checked; saveState(); }
  if (e.target.id === "einkOn") { S.eink = e.target.checked; saveState(); applyTheme(); render(); }
  if (e.target.id === "newsAlerts") {
    const on = e.target.checked;
    // (the phone also switches the computer's watcher on, since that's what finds them)
    if (A && A.setNewsAlerts) A.setNewsAlerts(on);
    toast(on ? "You'll get a notification for new events" : "No more event notifications on this phone");
  }
  if (e.target.id === "themeSel") { S.eink = e.target.value === "eink"; if (!S.eink) S.themeChoice = e.target.value; saveState(); applyTheme(); render(); }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "bForm") return;
  e.preventDefault();
  const v = $("#bAddr").value.trim();
  // (the vending machine takes slot codes: "B2" gets the site in slot B2)
  const m = S.bhome === "vend" && /^([abc])([1-3])$/i.exec(v), s = m && (S.vendSites || [])["abc".indexOf(m[1].toLowerCase()) * 3 + Number(m[2]) - 1];
  if (A) A.openBrowser(s ? s.url : v);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#bWiki")) return;
  const q = $("#bAddr").value.trim();
  if (A) A.openBrowser(q ? WIKI + encodeURIComponent(q) : "https://en.wikipedia.org/");
});

/* ---------------------------------------------------------------- start */
applyTheme();
refreshFiles();
paintProfile();
render();
tick();
paintPill();
if (Object.keys(S.downloads).length) watchDownloads();
sync();

/* Home: a sideways swipe turns between "On this phone" and The Bulletin (as the tabs at the top do); not on things
   that scroll sideways themselves */
(() => {
  let x0 = null, y0 = 0, t0 = 0;
  // (touch events: once the page starts scrolling, pointer events are cancelled, but touches still end)
  document.addEventListener("touchstart", (e) => {
    x0 = null;
    if (e.touches.length !== 1 || S.tab !== "home" || Reader.open || !$("#sheet").hidden || e.target.closest(".ao-dock, .chips, [class*=strip], input, textarea, .hw-sw")) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { capture: true, passive: true });
  document.addEventListener("touchend", (e) => {
    if (x0 === null || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - t0 > 700) return;
    const to = dx < 0 ? "bulletin" : "phone";
    if (to === W.tab) return;
    W.swapAnim = true; W.tab = to; W.sel = 0; store("hometab.json", W.tab); render(); $("#view").scrollTop = 0;
  }, { capture: true, passive: true });
})();
