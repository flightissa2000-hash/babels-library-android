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
  search: "duckduckgo", jq: "", jstatus: "all", bq: "",
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
    readMode: S.readMode, search: S.search, nav: S.nav, jstyle: S.jstyle, tabsOff: S.tabsOff, blayout: S.blayout, bhome: S.bhome,
    area: S.area, kind: S.kind, groupBy: S.groupBy, groupByArea: S.groupByArea, sort: S.sort, coll: S.coll });
}
/* ---------------------------------------------------------------- profiles
   Several people can share this phone, each with their own place in every book and film. The first profile ("main")
   is the one kept in step with the computer; the others keep their progress on this phone only (progress-<id>.json).
   While another profile is chosen, each item shows that profile's progress and the computer's waits in it._m. */
const PF = ["progress", "last_location", "watched", "watched_at", "opened_at", "audio_pos"];
const PF0 = { progress: 0, last_location: null, watched: 0, watched_at: null, opened_at: null, audio_pos: null };
const FACES = ["🦉", "🦊", "🐢", "🐙", "🦄", "🐝", "🐸", "🦖", "🐧", "🌵", "🍄", "🚀"];
const Prof = {
  list: [], cur: "main", marks: {},
  isMain() { return this.cur === "main"; },
  me() { return this.list.find((p) => p.id === this.cur) || this.list[0]; },
  load() {
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
  switchTo(id) {
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
  add(name) {
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
  if (f) { const p = Prof.list.find((x) => x.id === f.dataset.profFace); p.face = FACES[(FACES.indexOf(p.face) + 1) % FACES.length]; Prof.saveList(); paintProfile(); f.textContent = p.face; return; }
  const u = t.closest("[data-prof-use]"); if (u) return Prof.switchTo(u.dataset.profUse);
  const d = t.closest("[data-prof-del]");
  if (d) {
    const p = Prof.list.find((x) => x.id === d.dataset.profDel);
    if (p && confirm(`Remove ${p.name}'s profile? Their progress on this phone is forgotten. (The library itself isn't touched.)`)) { Prof.remove(p.id); paintProfile(); render(); }
  }
});
document.addEventListener("change", (e) => {
  const n = e.target.closest("[data-prof-name]");
  if (!n) return;
  const p = Prof.list.find((x) => x.id === n.dataset.profName);
  if (p) { p.name = n.value.trim() || p.name; n.value = p.name; Prof.saveList(); paintProfile(); }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "profAdd") return;
  e.preventDefault();
  const name = $("#profNew").value.trim();
  if (!name) return toast("Type a name first");
  const p = Prof.add(name);
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
  const r = await bridge("request", method, path, body ? JSON.stringify(body) : "");
  if (r.route) S.route = r.route;
  if (!r.status) { S.route = ""; const e = new Error("Can't reach your computer."); e.offline = true; throw e; }
  let data = {};
  try { data = JSON.parse(r.text || "{}"); } catch (e) {}
  if (r.status >= 400) { const e = new Error(data.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return data;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800);
}

/* a small question with a few answers (a sheet from the bottom); resolves to the chosen answer's value, or null */
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
function applyTheme() {
  const k = S.themeChoice !== "auto" ? S.themeChoice : S.theme;
  document.documentElement.dataset.theme = window.THEMES && THEMES[k] ? k : "wordtown";
  if (!NAVS.some((n) => n[0] === S.nav)) S.nav = "folders";
  if (!JSTYLES.some((n) => n[0] === S.jstyle)) S.jstyle = "list";
  document.documentElement.dataset.nav = S.nav;
  document.documentElement.dataset.jstyle = S.jstyle;
  if (!BLAYOUTS.some((b) => b[0] === S.blayout)) S.blayout = "standard";
  document.documentElement.classList.toggle("tabs-off", !!S.tabsOff);
  document.body.classList.remove("nav-open");
  placeNub();
  if (A && A.setBrowserTheme) {          // the browser screen is native: tell it the theme's colours (and the browser's layout)
    const cs = getComputedStyle(document.documentElement), c = (v) => cs.getPropertyValue(v).trim();
    A.setBrowserTheme(JSON.stringify({ theme: document.documentElement.dataset.theme, layout: S.blayout, bg: c("--bg"), surface: c("--surface"), ink: c("--ink"), soft: c("--ink-soft"),
      line: c("--line"), accent: c("--accent"), accentInk: c("--accent-ink"), accent2: c("--accent2") }));
  }
}
/* the orange tab (tabs hidden): see-through, and dragged up or down out of the way; its height is kept (S.nubY, a
   fraction of the screen) and the browser's copy of it sits at the same height */
function placeNub() { document.documentElement.style.setProperty("--nub-y", ((S.nubY || 0.5) * 100).toFixed(2) + "%"); }
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
const BHOMES = [["classic", "Classic", "Search card and site tiles"], ["minimal", "Minimal", "One big search, lots of quiet"], ["dash", "Dashboard", "Clock, speed dial, what you read lately"],
  ["orbit", "Constellation", "Your sites orbit the search"], ["vend", "Vending machine", "Pick a site by its slot"]];
const NAVS = [["folders", "Index cards", "Divider tabs down the right edge, like a card file"], ["drawer", "Side drawer", "A ☰ button opens a big menu from the left"]];
const JSTYLES = [["list", "Clean list", "Covers in rows, grouped by month"], ["notebook", "Notebook", "Lined paper, a red margin, handwriting"],
  ["timeline", "Timeline", "A line down the page; each finish is a stop on it"], ["wall", "Cover wall", "A wall of covers with status ribbons and scores"]];

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

/* ---------------------------------------------------------------- sync */
let syncP = null;
function sync(force) {
  if (!S.conn.token) { paintPill(); return Promise.resolve(); }
  if (syncP) return syncP;
  S.syncing = true; paintPill();
  syncP = (async () => {
    try {
      let made = {};
      if (S.ops.length || S.jops.length || Ann.queue.length) {
        const sending = S.ops.slice(), jsending = S.jops.slice(), asending = Ann.flying = Ann.queue.slice();
        let r;
        try { r = await api("POST", "/sync/push", { ops: sending, jops: jsending, aops: asending, now: now() }); } finally { Ann.flying = []; }
        made = r.made || {};
        S.ops = S.ops.filter((o) => !sending.includes(o));
        S.jops = S.jops.filter((o) => !jsending.includes(o));
        Ann.queue = Ann.queue.filter((o) => !asending.includes(o));
        Ann.made(r.made_anns);
        saveOps();
      }
      const d = await api("GET", `/sync/pull?since=${force ? 0 : S.since}`);
      merge(d, made);
      // the browser's ad and tracker lists come from the computer too, refreshed weekly
      if (A && A.updateAdblock && now() - A.adblockAge() > 7 * 86400) bridge("updateAdblock");
      S.syncError = "";
      S.lastSync = now();
      saveState();
      setTimeout(checkExpiring, 1500);
      await fetchSent(d.queue || []);
    } catch (e) {
      S.syncError = e.offline ? "offline" : e.message;
      if (e.status === 401) { S.syncError = "This phone was unpaired on the computer. Pair it again in Settings."; }
    } finally {
      S.syncing = false; syncP = null;
      paintPill();
      if (!Reader.open && $("#sheet").hidden) render();
    }
  })();
  return syncP;
}
function merge(d, made = {}) {
  if (d.full) { S.items = {}; S.anns = {}; S.journal = {}; }
  // journal rows and entries made here and now saved on the computer: drop the phone's temporary copies
  // (the computer's come in below); ones not sent yet stay
  const pendingCids = new Set(S.jops.map((o) => o.cid || o.log_cid).filter(Boolean));
  const localLogs = S.log.filter((l) => String(l.id).startsWith("c:") && pendingCids.has(String(l.id).slice(2)));
  for (const [id, e] of Object.entries(S.journal)) if (String(id).startsWith("c:") && (made[id.slice(2)] || !pendingCids.has(id.slice(2)))) delete S.journal[id];
  if (d.log) S.log = d.log.concat(localLogs);
  for (const x of d.deleted || []) {
    if (x.kind === "journal") delete S.journal[x.ref_id];
    if (x.kind === "log") {
      S.log = S.log.filter((l) => l.id !== x.ref_id);
      for (const [id, j] of Object.entries(S.journal)) if (j.log_id === x.ref_id) delete S.journal[id];
    }
  }
  for (const it of d.items || []) {
    const mine = S.items[it.id];
    // keep anything changed here after the computer's copy (sent on the next sync)
    if (mine) for (const op of S.ops.filter((o) => o.id === it.id)) it[op.field] = op.value;
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
  Prof.apply();          // (what just arrived is the computer's progress: another profile's goes back on top)
  saveLibrary();
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
const unwrappedFile = () => (Prof.isMain() ? "unwrapped.json" : `unwrapped-${Prof.cur}.json`);     // each profile unwraps its own
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
  if (t !== "browser" && A && A.browserHide) A.browserHide();      // (the browser's page waits, out of sight)
  S.tab = t; S.limit = 60;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  const ic = $(`#tabs [data-tab="${t}"] b`);
  if (ic) $("#navNubIc").textContent = ic.textContent;     // the open tab's icon on the nub, so you know where you are
  render();
  $("#view").scrollTop = 0;
}
function render() {
  const v = $("#view");
  const items = Object.values(S.items);
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
  return { x: 0, y: top, w: right, h: innerHeight - top, cut, nub, nubY: S.nubY || 0.5 };
}
function placeBrowser() {
  const o = browserPage();
  if (!o || !(o.url || o.alive)) return;
  if (S.tab !== "browser" || !A || !A.browserShow || document.body.classList.contains("nav-open") || Reader.open) return A && A.browserHide && A.browserHide();
  A.browserShow(JSON.stringify(browserRect()));
}
addEventListener("resize", () => { if (S.tab === "browser" && browserPage()) placeBrowser(); });
window.Native.browserClosed = () => { if (S.tab === "browser") render(); };
function renderBrowser(v) {
  const open = browserPage();
  if (open && (open.url || open.alive)) { v.innerHTML = `<div class="bw-hole" id="bwHole"></div>`; return requestAnimationFrame(placeBrowser); }
  if (A && A.browserHide) A.browserHide();
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
  const pwN = A && A.passwordCount ? A.passwordCount() : 0;
  let html = "", cur = "";
  for (const x of list.slice(0, S.limit)) {
    const d = new Date(x.t * 1000).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    if (d !== cur) { html += `${cur ? "</div>" : ""}<h3 class="j-month">${esc(d)}</h3><div class="list">`; cur = d; }
    html += `<button class="row b-row" data-go-url="${esc(x.url)}"><span class="t"><b>${esc(x.title || x.url)}</b><small>${esc(x.url)}</small></span><small class="hint">${new Date(x.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></button>`;
  }
  if (cur) html += "</div>";
  const last = h[0], H = BHOMES.some((x) => x[0] === S.bhome) ? S.bhome : "classic";
  const day = esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }));
  const form = (place = "Search, or type an address") => `<form class="bw-search" id="bForm"><span class="bw-mag">⌕</span><input id="bAddr" type="search" placeholder="${esc(place)}" autocomplete="off"></form>`;
  const btns = `<div class="bw-btns"><button class="bw-go" form="bForm"><span class="bd">⌕</span>Search</button><button class="bw-wiki" id="bWiki" type="button"><span class="bd">W</span>Wikipedia</button>
        ${last ? `<button class="bw-again" type="button" data-go-url="${esc(last.url)}" aria-label="Reopen the last page"><span>↺</span></button>` : ""}</div>`;
  const letter = (s) => esc(s.site[0].toUpperCase());
  let start;
  if (H === "minimal") {
    // a big quiet search, the date above, one row of small site letters below
    start = `<section class="hm-min"><div class="bw-day">${day}</div>${form("Search or type an address")}${btns}
      ${sites.length ? `<div class="hm-minrow">${sites.map((s) => `<button data-go-url="${esc(s.url)}" aria-label="${esc(s.site)}">${letter(s)}<span class="bw-unpin" data-unpin="${esc(s.url)}" role="button" aria-label="Remove bookmark">✕</span></button>`).join("")}</div>` : ""}</section>`;
  } else if (H === "dash") {
    // a big clock and the search; a speed dial; what you read lately
    start = `<section class="hm-dash"><div class="hm-clock">${esc(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</div><div class="bw-day">${day}</div>${form()}${btns}
        ${last ? `<button class="hm-resume" type="button" data-go-url="${esc(last.url)}"><small>Pick up where you left off</small><b>${esc(last.title || last.url)}</b></button>` : ""}</section>
      ${sites.length ? `<h3 class="hm-h">Bookmarks</h3><div class="hm-dial">${sites.map((s, i) => `<button class="hm-key" data-go-url="${esc(s.url)}"><span class="hm-n">${i + 1}</span><i>${letter(s)}</i><b>${esc(s.title || s.site)}</b><span class="bw-unpin" data-unpin="${esc(s.url)}" role="button" aria-label="Remove bookmark">✕</span></button>`).join("")}</div>` : ""}
      ${h.length ? `<h3 class="hm-h">Lately</h3><div class="hm-lately">${h.slice(0, 5).map((x) => `<button data-go-url="${esc(x.url)}"><b>${esc(x.title || x.url)}</b><small>${esc(x.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48))}</small></button>`).join("")}</div>` : ""}`;
  } else if (H === "orbit") {
    // a starfield: the search glows in the middle like a sun, your sites orbit it
    const ring = (list, cls) => `<div class="hm-ring ${cls}">${list.map((s, i) => `<button class="hm-planet" data-go-url="${esc(s.url)}" style="--a:${(360 / list.length) * i}deg"><span>${letter(s)}</span><b>${esc(s.site)}</b><span class="bw-unpin" data-unpin="${esc(s.url)}" role="button" aria-label="Remove bookmark">✕</span></button>`).join("")}</div>`;
    start = `<section class="hm-sky"><div class="hm-stars"></div>${ring(sites.slice(3, 8), "r2")}${ring(sites.slice(0, 3), "r1")}
      <div class="hm-sun"><div class="bw-day">${day}</div><b class="hm-where">Where to?</b></div></section>
      <section class="hm-skyform">${form("Search the cosmos…")}${btns}</section>`;
  } else if (H === "vend") {
    // a vending machine: your sites behind the glass in lettered slots; the keypad is the search; the coin slot reopens
    const slot = (i) => "ABC"[Math.floor(i / 3)] + ((i % 3) + 1);
    start = `<section class="hm-machine"><div class="hm-sign">SNAX &amp; SITES</div>
      <div class="hm-glass">${sites.slice(0, 9).map((s, i) => `<button class="hm-item" data-go-url="${esc(s.url)}"><span class="hm-snack">${letter(s)}</span><b>${esc(s.site)}</b><i class="hm-coil"></i><em>${slot(i)}</em><span class="bw-unpin" data-unpin="${esc(s.url)}" role="button" aria-label="Remove bookmark">✕</span></button>`).join("") ||`<p class="hint">Sites you visit stock the machine.</p>`}</div>
      <div class="hm-panel"><div class="hm-lcd">${day.toUpperCase()}<br>MAKE A SELECTION</div>${form("Type a code (B2)… or anything")}${btns}
        ${last ? `<button class="hm-coin" type="button" data-go-url="${esc(last.url)}"><i></i>COIN RETURN · reopen last page</button>` : ""}</div>
      <div class="hm-tray">PUSH</div></section>`;
    S.vendSites = sites;
  } else {
    start = `<section class="bw-hero"><div class="bw-day">${day}</div>${form()}${btns}
      ${last ? `<small class="bw-again-tip">↺ reopens ${esc(last.title || last.url)}</small>` : ""}</section>
    ${sites.length ? `<div class="bw-tiles">${sites.map((s) => `<button class="bw-tile" data-go-url="${esc(s.url)}"><span class="ring">${letter(s)}</span><small>${esc(s.site)}</small><span class="bw-unpin" data-unpin="${esc(s.url)}" role="button" aria-label="Remove bookmark">✕</span></button>`).join("")}</div>` : ""}`;
  }
  // the page you left open in the browser (‹ Library or Back keeps it): one tap goes back to it
  v.innerHTML = `<div class="bw-page home-${H}"><div class="bw-top"><button class="btn sm bw-stylebtn" id="bStyle" type="button">🧭 Layout</button></div>
    <div class="bw-stylepick" id="bStylePick" ${S.bPick ? "" : "hidden"}><h4>Start page</h4>${BHOMES.map(([k, n, d]) => `<button class="bw-bpick ${H === k ? "on" : ""}" data-bhpick="${k}"><i class="ho ho-${k}"><b></b></i><b>${n}</b><small>${d}</small></button>`).join("")}
      ${WEB ? "" : "<h4>Browser controls</h4>"}${WEB ? "" : BLAYOUTS.map(([k, n, d]) => `<button class="bw-bpick ${S.blayout === k ? "on" : ""}" data-blpick="${k}"><i class="lo lo-${k}"><b></b></i><b>${n}</b><small>${d}</small></button>`).join("")}</div>
    ${start}
    <button class="btn bw-histbtn" id="bHist" type="button">🕘 History</button>
    ${sites.length ? "" : `<p class="bw-nobm">No bookmarks yet. Press ☆ on the browser's bar while you're on a page (here or on your computer) and it shows up here.</p>`}
    ${WEB ? `<p class="hint">Pages open in Safari (with its own passwords, Reader view and content blockers). Pages you open from here are listed in History.</p>` : `<section class="bw-pw">
      <div><b>🔑 Saved passwords</b><small>${pwN ? `${pwN} saved on this phone, encrypted in its secure keystore. On a site you have one for, 🔑 on the browser's bar fills it in.` : "Import an export from Chrome, Firefox, Edge, Bitwarden, 1Password or LastPass (a .csv file). They're encrypted in this phone's secure keystore."}</small></div>
      <div class="btns"><button class="btn sm" id="pwImport" type="button">Import passwords…</button>${pwN ? `<button class="btn sm danger" id="pwClear" type="button">Remove all</button>` : ""}</div>
    </section>
    <p class="hint">Ads and pop-ups blocked. ⧉ on the browser's bar splits it in two. Your phone's own password manager (Google, Samsung Pass…) works here too.</p>`}
    <div class="bw-sheet${S.bOpen ? " open" : ""}" id="bSheet">
      <div class="bw-sheet-head"><b>History</b><button class="btn sm" id="bHistClose" type="button" aria-label="Close history">✕</button></div>
      <div class="bw-sheet-body">
        <div class="searchrow"><input id="bq" type="search" placeholder="Search history" value="${esc(S.bq)}"><button class="btn" id="bClear">Clear…</button></div>
        <div class="chips" id="bClearPick" hidden><button data-bclear="hour">Last hour</button><button data-bclear="today">Today</button><button data-bclear="all">All history</button></div>
        ${html || `<p class="empty">${S.bq ? "Nothing matches." : "Pages you visit show up here."}</p>`}
        ${list.length > S.limit ? `<button class="btn more" id="more">Show more</button>` : ""}
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
  if (S.tab === "browser") render();
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
function clearHistory(which) {
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
  const here = items.filter((i) => onPhone(i) && i.kind !== "music")
    .sort((a, b) => (b.opened_at || 0) - (a.opened_at || 0) || (b.added_at || 0) - (a.added_at || 0));
  W.list = here.slice(0, 80);
  W.sel = Math.min(W.sel, Math.max(0, W.list.length - 1));
  const thumb = (it) => it.has_cover ? `<img alt="" src="/cover/${it.id}?v=${esc(it.cover_v || 0)}" onerror="this.remove()">` : `<i style="--c:${colorFor(it)}">${esc(W.title(it)[0])}</i>`;
  v.innerHTML = `${uploadsHtml()}${coming2}
    <div class="ss" id="ss">
      <div class="ss-bg" id="ssBg"></div>
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
  sel: 0, list: [], tab: load("hometab.json", "phone"),
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
  open() { const it = this.list[this.sel]; if (!it) return; if (onPhone(it)) Reader.start(it); else openSheet(it.id); },
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
  return `<button class="hw-swap" data-hw-tab="${next}" aria-label="Switch to ${esc(W.tabs[next])}"><span class="hw-swap-lbl"><small>Switch to</small><b>${esc(W.tabs[next])}</b></span><span class="hw-swap-disc"><i>⇄</i></span></button>`;
}

/* Home → The Bulletin, the computer's weekly magazine on the phone: this week's challenge as the cover story (finish
   something you're partway through, or revisit something finished long ago), Hot Off the Press from the catalogue,
   Still in the Wrapper (things you own but never opened) and Lab Notes (papers waiting to be read). Picked once a week,
   and for whoever's profile is in use. */
const Bulletin = (() => {
  const DAY = 86400;
  const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() / 1000; };
  const rng = (seed) => { let a = 0; for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const shuffle = (list, r) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const file = () => `challenge-${Prof.cur}.json`;
  let picks = null, potd;
  const items = () => Object.values(S.items);

  function finishedAt(it) {
    const l = Prof.isMain() && S.log.find((x) => x.item_id === it.id);
    const f = l && l.finished ? Date.parse(l.finished) / 1000 : 0;
    return f || it.watched_at || (pct(it) >= 98 ? it.opened_at : 0) || 0;
  }
  function challenge(reroll = false) {
    const wk = weekStart(), cur = load(file(), null);
    if (cur && cur.week === wk && !reroll && S.items[cur.id]) return cur;
    const r = rng(Prof.cur + wk + ":" + ((cur && cur.week === wk ? cur.draw : 0) + (reroll ? 1 : 0)));
    const mine = items().filter((i) => i.has_file && ["book", "graphic", "tv", "movie", "article"].includes(i.kind) && !(cur && cur.id === i.id && reroll));
    const started = mine.filter((i) => W.status(i)[0] === "now");
    const long = mine.filter((i) => W.status(i)[0] === "done" && finishedAt(i) && finishedAt(i) < now() - 180 * DAY);
    let type = "finish", pool = started;
    if (!pool.length || (long.length && r() < 0.25)) { type = "revisit"; pool = long; }
    if (!pool.length) return null;
    const it = shuffle(pool, r)[0];
    const c = { week: wk, id: it.id, type, draw: (cur && cur.week === wk ? cur.draw || 0 : 0) + (reroll ? 1 : 0), since: it.opened_at || 0 };
    store(file(), c);
    return c;
  }
  const done = (c, it) => c.type === "finish" ? W.status(it)[0] === "done" : (it.opened_at || 0) > Math.max(c.week, c.since || 0);

  function html() {
    const wk = weekStart(), r = rng(Prof.cur + "shelf" + wk);
    const c = challenge(), it = c && S.items[c.id];
    const papers = shuffle(items().filter((i) => i.kind === "article" && i.has_file && !i.opened_at && !isNewsStory(i)), r).slice(0, 4);
    const wrapped = shuffle(items().filter((i) => ["book", "graphic", "movie", "tv"].includes(i.kind) && i.has_file && !i.opened_at && !(it && i.id === it.id)), r).slice(0, 6);
    const when = new Date(wk * 1000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    const issue = Math.max(1, Math.round((wk - Date.UTC(2026, 0, 5) / 1000) / (7 * DAY)) + 1);
    const ch = it ? { it, c, ok: done(c, it), p: pct(it), finish: c.type === "finish", ago: Math.round((now() - finishedAt(it)) / (30 * DAY)) } : null;
    const hook = (x) => x.ok ? (x.finish ? "Done and dusted. Challenge complete." : "Revisited. Challenge complete.")
      : x.finish ? `${x.p}% of the way. One week to cross the finish line.` : `Last read ${x.ago} months ago. Time for a second look?`;
    const head = (x) => x.ok ? "MISSION ACCOMPLISHED" : x.finish ? "THE FINAL STRETCH" : "THE RETURN";
    const go = (x) => x.ok ? "" : `<button class="btn primary" data-bt-go="${x.it.id}">${isVideo(x.it) ? "▶ Watch it" : x.finish ? "Finish it" : "Read it again"}</button>`;
    const by = (x) => [W.kindName(x), byline(x)].filter(Boolean).join(" · ");
    return `<div class="btm">
      <section class="btm-cover ${ch && ch.ok ? "done" : ""}">${ch ? `<div class="btm-bg">${cover(ch.it, false)}</div>` : ""}<div class="btm-sheen"></div>
        <div class="btm-title"><b>BABEL</b><span>Issue ${issue}<br>${esc(when)}</span></div>
        <div class="btm-ribbon">EXCLUSIVE</div>
        ${ch ? `<div class="btm-burst">${ch.ok ? "DONE!" : ch.finish ? `${ch.p}%<small>there</small>` : "AGAIN?"}</div>
        <div class="btm-hero" data-item="${ch.it.id}">${cover(ch.it, false)}${ch.ok ? `<span class="bt-stamp">✓<b>Done!</b></span>` : ""}</div>
        <div class="btm-lines"><small>${ch.finish ? "THIS WEEK'S CHALLENGE" : "THE REVISIT ISSUE"}</small><em>${head(ch)}</em><h2>${esc(W.title(ch.it))}</h2>
          <p class="btm-by">${esc(by(ch.it))}</p><p class="btm-hook">${esc(hook(ch))}</p>
          ${ch.finish && !ch.ok ? `<div class="btm-meter"><i style="width:${ch.p}%"></i></div>` : ""}
          <div class="btns">${go(ch)}<button class="btn" data-bt-reroll>Pick another</button></div></div>`
        : `<div class="btm-lines"><em>COMING SOON</em><h2>Your next obsession</h2><p class="btm-hook">Start something and next week's challenge will be to finish it.</p></div>`}
        <div class="btm-barcode"><i></i><span>0 ${String(issue).padStart(5, "0")} 42</span></div></section>
      <figure class="btm-potd" id="btPotd" hidden></figure>
      <section class="btm-sec btm-hot"><header><small>FROM THE CATALOGUE</small><h3>Hot Off the Press</h3><p>This week's most talked-about finds you don't own yet</p></header>
        <div id="btNew" class="btm-ranks"><p class="hint">${S.conn.token ? "Stopping the presses…" : "Pair with your computer to see the catalogue's picks."}</p></div></section>
      <section class="btm-sec btm-wrap"><header><small>ON YOUR SHELVES</small><h3>Still in the Wrapper</h3><p>Books, comics and films you own but have never opened</p></header>
        ${wrapped.length ? `<div class="btm-velvet">${wrapped.map((x) => `<button class="btm-gem" data-item="${x.id}">${cover(x, false)}<span class="btm-seal">UNOPENED</span><b>${esc(W.title(x))}</b><small>${esc(by(x))}</small></button>`).join("")}</div>`
          : `<p class="hint">You've opened everything on your shelves. Impressive.</p>`}</section>
      <section class="btm-sec btm-lab"><header><small>FIG. 1 · YOUR READING LIST</small><h3>Lab Notes</h3><p>Scientific papers on your desk, still waiting for a read</p></header>
        ${papers.length ? `<div class="btm-figs">${papers.map((a, i) => `<button class="btm-fig" data-item="${a.id}"><span class="btm-fignum">FIG. ${i + 1}</span><b>${esc(a.title)}</b><small>${esc([a.journal, a.year].filter(Boolean).join(" · "))}</small></button>`).join("")}</div>`
          : `<p class="hint">Every paper on your shelves has been read. The lab is quiet.</p>`}</section>
    </div>`;
  }
  function after() { paintPicks(); paintPotd(); }
  async function paintPotd() {
    if (potd === undefined) { potd = null; try { potd = await api("GET", "/sync/potd"); } catch (e) { potd = undefined; } }
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
    const g = t.closest("[data-bt-go]"); if (g) { const it = S.items[g.dataset.btGo]; if (!it) return; return onPhone(it) ? Reader.start(it) : openSheet(it.id); }
    const w = t.closest("[data-bt-want]");
    if (w && picks) { e.stopPropagation(); return Catalogue.want(picks[Number(w.dataset.btWant)], w); }
    const fd = t.closest("[data-bt-find]"); if (fd && picks) return Catalogue.show(picks[Number(fd.dataset.btFind)]);
  }, true);
  return { html, after, reset: () => { picks = null; } };
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
const isNewsStory = (it) => it.kind === "article" && (it.source === "web" || (!it.doi && /news|times|post|guardian|bbc|npr|reuters|apnews|propublica|tribune|herald|gazette|journal\.com|magazine|patch\.com|phys\.org|sciencedaily/i.test((it.url || "") + " " + (it.journal || ""))));
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
    if (!LIB.kinds[area].includes(it.kind)) return false;
    if (S.kind && S.kind !== "all" && !kindMatches(it, S.kind)) return false;
    if (S.coll === "wish") { if (!(it.wanted && !it.has_file)) return false; }
    else if (S.coll && !(it.collections || []).map(String).includes(String(S.coll))) return false;
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
  const flat = [], labels = [];
  for (const [name, items] of groups) for (const it of items) { flat.push(it); labels.push(name); }
  const opt = (list, cur) => list.map(([k, l]) => `<option value="${esc(k)}" ${String(cur) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const colls = [["", "Everything"], ["wish", "★ Wishlist"], ...(S.colls || []).map((c) => [c.id, c.name])];
  v.innerHTML = `${uploadsHtml()}<button class="btn send-pc" id="sendPc">⬆ Send files to your computer</button>
    <div class="lib-areas">${LIB.areas.map(([k, l]) => `<button data-area="${k}" class="${area === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${tabs.length ? `<div class="chips lib-kinds"><button data-kind="all" class="${S.kind === "all" ? "on" : ""}">All</button>${tabs.map(([k, l]) => `<button data-kind="${k}" class="${S.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="searchrow"><input id="q" type="search" placeholder="${esc(LIB.placeholder[area])}" value="${esc(S.q)}"></div>
    <div class="lib-ctl">
      <label><span>Group</span><select id="libGroup">${opt(gopts, S.groupBy)}</select></label>
      <label><span>Sort</span><select id="sort">${opt(LIB.sorts, S.sort)}</select></label>
      <label><span>Collection</span><select id="libColl">${opt(colls, S.coll || "")}</select></label>
    </div>
    ${flat.length ? Deck.html(flat, labels) : `<p class="empty">Nothing here.</p>`}`;
  if (flat.length) Deck.mount(flat.length);
}
function renderPhone(v, items) {
  refreshFiles();
  const here = items.filter(onPhone).sort((a, b) => (b.opened_at || 0) - (a.opened_at || 0));
  const used = here.reduce((s, i) => s + (S.files[fileName(i)] || 0), 0);
  const coming = Object.keys(S.downloads).map((id) => S.items[id]).filter(Boolean);
  v.innerHTML = `<div class="panel"><h3>Storage</h3><p class="hint">${here.length} files, ${fmtSize(used)} on the phone · ${A ? fmtSize(A.freeSpace()) : "?"} free</p></div>
    ${coming.length ? `<section class="sec"><h2>Downloading</h2><div class="list" id="dlList">${coming.map(row).join("")}</div></section>` : ""}
    <section class="sec"><h2>On this phone</h2>${here.length ? `<div class="list">${here.map(row).join("")}</div>` : `<p class="hint">Files you get from the computer are kept here so you can read and watch offline.</p>`}</section>`;
}
function paintDownloads() {
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
function renderSettings(v) {
  const paired = !!S.conn.token;
  v.innerHTML = `
    <div class="panel"><h3>Your computer</h3>
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
    </div>
    <div class="panel"><h3>Profiles</h3>
      <p class="hint">Everyone who uses this phone can have their own place in every book and film. <b>${esc(Prof.list[0].name)}</b> is kept in step with the computer; the others keep their progress on this phone only.</p>
      <div class="prof-list">${Prof.list.map((p) => `<div class="prof-row ${p.id === Prof.cur ? "on" : ""}">
        <button class="prof-face" data-prof-face="${p.id}" aria-label="Change the picture">${p.face}</button>
        <span class="prof-who"><input data-prof-name="${p.id}" value="${esc(p.name)}" maxlength="24" aria-label="Name"><small>${p.id === "main" ? "Synced with the computer" : "Progress on this phone only"}</small></span>
        ${p.id === Prof.cur ? `<span class="badge">In use</span>` : `<button class="btn sm" data-prof-use="${p.id}">Use</button>`}
        ${p.id !== "main" ? `<button class="btn sm danger" data-prof-del="${p.id}" aria-label="Remove">✕</button>` : ""}</div>`).join("")}</div>
      <form class="prof-add" id="profAdd"><input id="profNew" maxlength="24" placeholder="A name" autocomplete="off"><button class="btn">＋ Add a profile</button></form></div>
    <div class="panel"><h3>Files on this phone</h3><p class="hint">${Object.keys(S.files).length} files · ${A ? fmtSize(A.freeSpace()) : "?"} free</p>
      <button class="btn" id="myFiles">See what's on the phone</button></div>
    <div class="panel"><h3>Files</h3>
      <label class="check"><input type="checkbox" id="autoGet" ${S.autoGet ? "checked" : ""}> Fetch files sent from the computer by itself (Wi-Fi or mobile data)</label></div>
    <div class="panel"><h3>News</h3>
      <label class="check"><input type="checkbox" id="newsAlerts" ${A && A.newsAlerts && A.newsAlerts() ? "checked" : ""}> Notify me when a new event turns up in the News “Events” section</label>
      <p class="hint">${WEB ? "Works when this app is on your Home Screen (in Safari: Share → Add to Home Screen, then open it from there). The computer looks every few hours and sends the notification; tap it to share or open the event." : "The computer looks every few hours; the phone checks in about once an hour and needs to reach the computer (home Wi-Fi, or “Reach this library from anywhere”). Each notification has Share and Open."}</p></div>
    <div class="panel"><h3>Look</h3>
      <div class="field"><label for="themeSel">Theme</label><select id="themeSel"><option value="auto">Same as the computer</option>${Object.entries(window.THEMES || {}).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}</select></div>
      <h4 class="pick-h">Getting around <small>how you switch between Home, Library, Catalogue…</small></h4>
      <div class="pick-grid">${NAVS.map(([k, n, d, zany]) => `<button class="pick ${S.nav === k ? "on" : ""} ${zany ? "zany" : ""}" data-nav-pick="${k}"><i class="pk pk-${k}"></i><b>${n}</b><small>${d}</small></button>`).join("")}</div>
      <h4 class="pick-h">Journal style</h4>
      <div class="pick-grid three">${JSTYLES.map(([k, n, d]) => `<button class="pick ${S.jstyle === k ? "on" : ""}" data-jstyle-pick="${k}"><i class="pk pk-j-${k}"></i><b>${n}</b><small>${d}</small></button>`).join("")}</div></div>
    <p class="hint" style="text-align:center">Babel's Library for ${WEB ? "iPhone & iPad" : "Android"} 1.0${S.ops.length ? ` · ${S.ops.length} change${S.ops.length === 1 ? "" : "s"} waiting to send` : ""}</p>`;
  if ($("#themeSel")) $("#themeSel").value = S.themeChoice;
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
  const here = onPhone(it), dl = S.downloads[id];
  const st = dl && S.dlState[dl];
  const notes = Ann.of(it.id).sort((a, b) => a.created_at - b.created_at);
  const log = Prof.isMain() && S.log.find((l) => l.item_id === it.id || (it.kind === "tv" && l.kind === "show" && String(l.title).toLowerCase() === String(it.series || "").toLowerCase()));
  const entries = log ? Object.values(S.journal).filter((j) => j.log_id === log.id).sort((a, b) => b.created_at - a.created_at) : [];
  const meta = [it.year, it.genre, it.kind === "graphic" ? (it.format === "manga" ? "Manga" : "Comic") : "", it.series && it.kind !== "tv" ? `${it.series}${it.series_index ? " #" + +it.series_index : ""}` : "",
    it.file_type ? it.file_type.toUpperCase() : "", it.file_size ? fmtSize(it.file_size) : ""].filter(Boolean).join(" · ");
  const p = pct(it);
  sh.innerHTML = `<div class="sheet-bar"><button class="back" data-close>‹</button><h2>${esc(it.title)}</h2></div>
    <div class="it-head">${cover(it)}<div><h3>${esc(it.title || "Untitled")}</h3><p>${esc(byline(it))}</p><p>${esc(meta)}</p>
      <div class="big-p"><i style="width:${p}%"></i></div><small class="hint">${it.watched ? "Finished" : p ? p + "% · " + (it.opened_at ? ago(it.opened_at) : "") : "Not started"}</small></div></div>
    <div class="it-body">
      <div class="btns">
        ${here ? `<button class="btn primary" data-open="${it.id}">▶ ${verb(it)}</button>` : ""}
        ${!here && dl ? `<div style="flex:1 1 100%"><div class="dlbar" data-dlbar="${it.id}"><i style="width:${st && st.total > 0 ? 100 * st.done / st.total : 3}%"></i></div><small class="hint">Starting…</small></div><button class="btn sm" data-cancel="${it.id}">Cancel</button>` : ""}
        ${!here && !dl && it.has_file ? `<button class="btn primary" data-get="${it.id}">⬇ Get from computer${it.file_size ? " (" + fmtSize(it.file_size) + ")" : ""}</button>` : ""}
        ${!it.has_file ? `<span class="hint">${it.wanted ? "On your wishlist." : it.physical ? "A physical copy (no file)." : "No file on the computer."}</span>` : ""}
      </div>
      <div class="btns">
        <button class="btn sm" data-fav="${it.id}">${it.favorite ? "★ Favourite" : "☆ Favourite"}</button>
        ${isVideo(it) ? `<button class="btn sm" data-watched="${it.id}">${it.watched ? "✓ Watched" : "Mark watched"}</button>`
          : it.kind !== "music" ? `<button class="btn sm" data-finish="${it.id}">${p >= 100 ? "✓ Finished" : "Mark finished"}</button>` : ""}
        ${!it.has_file ? `<button class="btn sm" data-wish="${it.id}">${it.wanted ? "Remove from wishlist" : "Add to wishlist"}</button>` : ""}
        ${here ? `<button class="btn sm" data-with="${it.id}">Open in another app</button><button class="btn sm danger" data-remove="${it.id}">Remove from phone</button>` : ""}
      </div>
      ${it.summary ? `<p class="sum">${esc(it.summary)}</p>` : ""}
      ${(it.authors || [])[0] && ["book", "graphic"].includes(it.kind) ? `<div class="btns"><button class="btn sm" data-ct-author="${esc(it.authors[0])}" data-ct-kind="${it.kind === "graphic" ? (it.format === "manga" ? "manga" : "comic") : "book"}">${it.kind === "graphic" ? "More from this author" : "All releases by " + esc(it.authors[0])}</button></div>` : ""}
      <h3 style="margin-top:16px">Your review</h3>
      ${log ? `<p class="hint">${[log.status && log.status !== "finished" ? { reading: "Reading", hold: "On hold", dropped: "Dropped" }[log.status] : "", log.finished ? "Finished " + log.finished : "", log.kind === "movie" && log.score != null ? `${+log.score}/10` : ""].filter(Boolean).map(esc).join(" · ")}</p>
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
/* "More from": the rest of its series on your shelves first; otherwise more by the same author or director */
function kinHtml(it) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const lead = (x) => norm(((x.authors || [])[0] || "").replace(/^(.*),\s*(.*)$/, "$2 $1"));
  const mine = Object.values(S.items).filter((x) => x.id !== it.id && x.has_file && x.kind !== "music");
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
      <button class="btn sm" data-act="reanalyze">Re-sort and re-tag</button>
      <button class="btn sm danger" data-act="remove">Remove from library</button>
    </div>
    ${d.file_location ? `<p class="hint">On the computer: ${esc(d.file_location)}</p>` : ""}`;
  $("#itForm").addEventListener("change", async (e) => {
    const el = e.target;
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
    const k = kindOf(it);
    return `<button class="pc" data-item="${it.id}" data-i="${i}" hidden style="--c:${colorFor(it)}">
      <i class="pc-eye"></i><small class="pc-code">${k[0]}-${String(it.id).padStart(4, "0")}</small>
      <span class="pc-art">${cover(it)}</span>
      <b class="pc-t">${esc(it.kind === "tv" ? it.series || it.title : it.title || "Untitled")}</b>
      <small class="pc-s">${esc(byline(it) || k[2])}</small>
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
  // only the card in front opens; the rest are still being flipped past
  document.addEventListener("click", (e) => { const c = e.target.closest?.(".pc"); if (c && !c.classList.contains("front")) { e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener("resize", queue);
  return { html, mount, STEP };
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
  const op = t.closest("[data-open]"); if (op) return Reader.start(S.items[op.dataset.open]);
  const get = t.closest("[data-get]"); if (get) { get.disabled = true; return getFile(S.items[get.dataset.get]).then(() => openSheet(Number(get.dataset.get))); }
  const can = t.closest("[data-cancel]"); if (can) { removeFile(S.items[can.dataset.cancel]); return openSheet(Number(can.dataset.cancel)); }
  const rem = t.closest("[data-remove]"); if (rem) { if (confirm("Remove the file from this phone? It stays on the computer.")) { removeFile(S.items[rem.dataset.remove]); openSheet(Number(rem.dataset.remove)); } return; }
  const w = t.closest("[data-with]"); if (w) { if (!A.openWith(fileName(S.items[w.dataset.with]))) toast("No app on the phone can open this kind of file."); return; }
  const fav = t.closest("[data-fav]"); if (fav) { const it = S.items[fav.dataset.fav]; change(it.id, { favorite: it.favorite ? 0 : 1 }); return openSheet(it.id); }
  const wish = t.closest("[data-wish]"); if (wish) { const it = S.items[wish.dataset.wish]; change(it.id, { wanted: it.wanted ? 0 : 1 }); return openSheet(it.id); }
  const wa = t.closest("[data-watched]"); if (wa) { const it = S.items[wa.dataset.watched]; change(it.id, it.watched ? { watched: 0 } : { watched: 1, watched_at: now(), progress: 1 }); return openSheet(it.id); }
  const fin = t.closest("[data-finish]"); if (fin) { const it = S.items[fin.dataset.finish]; change(it.id, { progress: pct(it) >= 100 ? 0 : 1 }); return openSheet(it.id); }
  const sst = t.closest("[data-hw-tab]"); if (sst) { W.tab = sst.dataset.hwTab; W.sel = 0; store("hometab.json", W.tab); render(); $("#view").scrollTop = 0; return; }
  const ssc = t.closest("[data-ss]"); if (ssc) { const i = Number(ssc.dataset.ss); if (i === W.sel) return W.open(); W.sel = i; return W.place(); }
  const gu = t.closest("[data-go-url]"); if (gu) return A.openBrowser(gu.dataset.goUrl);
  const uc = t.closest("[data-up-cancel]"); if (uc) { A.cancelUpload(uc.dataset.upCancel); toast("Cancelling…"); return; }
  const ur = t.closest("[data-up-retry]"); if (ur) { A.retryUpload(ur.dataset.upRetry); return; }
  const ux = t.closest("[data-up-clear]"); if (ux) { A.dismissUpload(ux.dataset.upClear); paintUploads(); return; }
  if (t.closest("#sendPc")) { if (!S.conn.token) return toast("Pair with your computer first (Settings)."); return A.pickFiles(); }
  if (t.closest("#bClear")) { $("#bClearPick").hidden = !$("#bClearPick").hidden; return; }
  const bc = t.closest("[data-bclear]"); if (bc) return clearHistory(bc.dataset.bclear);
  const jr = t.closest("[data-journal]"); if (jr) { const it = S.items[jr.dataset.journal]; return Journal.open(Journal.forItem(it).id); }
  if (t.closest("#myFiles")) { S.tab = "phone"; return render(); }
  if (t.closest("#look")) return lookForComputer();
  const pick = t.closest("[data-pick]"); if (pick) { $("#addr").value = pick.dataset.pick; S.pairAddr = pick.dataset.pick; $("#code").focus(); return; }
  if (t.closest("#pairBtn")) return pair();
  if (t.closest("#syncNow")) return sync().then(() => render());
  if (t.closest("#fullSync")) return sync(true).then(() => { toast("Library fetched again"); render(); });
  if (t.closest("#unpair")) return unpair();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "bq") { S.bq = e.target.value; clearTimeout(render.b); render.b = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = $("#bq"); q.focus(); q.setSelectionRange(pos, pos); }, 250); }
  if (e.target.id === "q") { S.q = e.target.value; clearTimeout(render.t); render.t = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); }, 250); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "sort") { S.sort = e.target.value; saveState(); render(); }
  if (e.target.id === "libGroup") { S.groupBy = e.target.value; (S.groupByArea ||= {})[S.area] = S.groupBy; saveState(); render(); }
  if (e.target.id === "libColl") { S.coll = e.target.value; saveState(); render(); }
  if (e.target.id === "autoGet") { S.autoGet = e.target.checked; saveState(); }
  if (e.target.id === "newsAlerts") {
    const on = e.target.checked;
    // (the phone also switches the computer's watcher on, since that's what finds them)
    if (A && A.setNewsAlerts) A.setNewsAlerts(on);
    toast(on ? "You'll get a notification for new events" : "No more event notifications on this phone");
  }
  if (e.target.id === "themeSel") { S.themeChoice = e.target.value; saveState(); applyTheme(); render(); }
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
