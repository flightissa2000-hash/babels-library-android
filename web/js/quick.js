/* The quick panel (Android): the face in the top bar opens Wi-Fi, volume, brightness and battery, and your other apps'
   notifications, in the same pop-up the profile picker used. (Switching profiles is in Settings → Profiles now.)
   The iPhone web app keeps the face as the profile picker. */
(() => {
  if (typeof A === "undefined" || !A || !A.quickStatus || (typeof WEB !== "undefined" && WEB)) return;
  let box = null, timer = null, st = {};
  const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 60 ? "now" : s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " d"; };
  const read = () => { try { st = JSON.parse(A.quickStatus()); } catch (e) { st = {}; } return st; };

  function tiles() {
    const w = st.wifi || {}, b = st.battery || {}, br = st.bright || {}, r = st.ring || {};
    const bars = w.connected ? "▂▄▆█".slice(0, Math.max(1, w.bars)) : "";
    return `<div class="qp-tiles">
      <button class="qp-tile ${w.connected ? "on" : ""}" data-qp-sys="wifi"><i>📶</i><b>Wi-Fi</b><small>${w.connected ? `Connected ${bars}` : w.on ? "Not connected" : "Off"}</small></button>
      <button class="qp-tile ${st.cell && !w.connected ? "on" : ""}" data-qp-sys="internet"><i>🌐</i><b>Internet</b><small>${w.connected ? "Over Wi-Fi" : st.cell ? "Mobile data" : st.online ? "Online" : "Offline"}</small></button>
      <button class="qp-tile ${b.charging ? "on" : ""}" data-qp-sys="battery"><i>${b.charging ? "⚡" : "🔋"}</i><b>${b.level >= 0 ? b.level + "%" : "Battery"}</b><small>${b.charging ? "Charging" : "On battery"}</small></button>
      <button class="qp-tile ${br.auto ? "on" : ""}" data-qp-auto><i>🔆</i><b>Auto</b><small>${br.auto ? "Brightness auto" : "Brightness manual"}</small></button>
    </div>`;
  }
  function sliders() {
    const m = st.music || { v: 0, max: 15 }, r = st.ring || { v: 0, max: 7 }, br = st.bright || { v: .5 };
    return `<div class="qp-sliders">
      <label class="qp-sl"><i>🔊</i><span>Media</span><input type="range" min="0" max="${m.max}" value="${m.v}" data-qp-vol="music"></label>
      <label class="qp-sl"><i>${r.mode === "silent" ? "🔕" : r.mode === "vibrate" ? "📳" : "🔔"}</i><span>Ringer</span><input type="range" min="0" max="${r.max}" value="${r.v}" data-qp-vol="ring"></label>
      <label class="qp-sl"><i>☀</i><span>Brightness</span><input type="range" min="2" max="100" value="${Math.round((br.v || .5) * 100)}" data-qp-bright></label>
      ${br.system === false ? `<p class="qp-note">This changes Babel's screen only. <button class="linkish" data-qp-sys="write" type="button">Let it change the whole phone…</button></p>` : ""}
    </div>`;
  }
  function notifsHtml() {
    if (!st.notifAccess) return `<div class="qp-nacc"><b>Your notifications, here</b><small>Android needs you to switch this on for Babel (Notification access). Nothing is kept or sent anywhere.</small><button class="btn sm primary" data-qp-sys="notif" type="button">Allow notification access…</button></div>`;
    let list = []; try { list = JSON.parse(A.notifs()); } catch (e) {}
    if (!list.length) return `<p class="qp-none">No notifications.</p>`;
    return `${list.some((n) => n.clear) ? `<button class="linkish qp-clearall" data-qp-clearall type="button">Clear all</button>` : ""}<div class="qp-list">${list.map((n) => `<div class="qp-n">
        <button class="qp-nb" data-qp-open="${esc(n.key)}" type="button"><img alt="" src="/pkgicon?p=${encodeURIComponent(n.pkg)}" onerror="this.remove()"><span><small>${esc(n.app)} · ${esc(ago(n.when))}</small><b>${esc(n.title)}</b>${n.text ? `<em>${esc(n.text.slice(0, 160))}</em>` : ""}</span></button>
        ${n.clear ? `<button class="qp-x" data-qp-clear="${esc(n.key)}" type="button" aria-label="Clear">✕</button>` : ""}</div>`).join("")}</div>`;
  }
  function paint(full) {
    if (!box) return;
    read();
    const me = typeof Prof !== "undefined" && Prof.me ? Prof.me() : null;
    if (full) {
      box.querySelector(".ka-card").innerHTML = `<div class="qp-head"><span class="qp-face">${esc(me ? me.face : "☺")}</span><span><b>${esc(me ? me.name : "Quick settings")}</b><small>${esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</small></span><button class="qp-close" data-qp-close type="button" aria-label="Close">✕</button></div>
        <div id="qpTiles">${tiles()}</div><div id="qpSliders">${sliders()}</div>
        <h4 class="qp-h">Notifications</h4><div id="qpNotifs">${notifsHtml()}</div>`;
    } else {
      // (while it's open: the tiles and the list kept fresh; the sliders left alone while one is being dragged)
      box.querySelector("#qpTiles").innerHTML = tiles();
      if (!box.querySelector("#qpSliders input:active")) box.querySelector("#qpSliders").innerHTML = sliders();
      box.querySelector("#qpNotifs").innerHTML = notifsHtml();
    }
  }
  function openPanel() {
    if (box) return close();
    box = document.createElement("div");
    box.className = "keep-ask qp";
    box.innerHTML = `<div class="ka-card" role="dialog" aria-label="Quick settings"></div>`;
    document.body.append(box);
    paint(true);
    timer = setInterval(() => { if (box && !document.hidden) paint(false); }, 4000);
  }
  function close() { clearInterval(timer); if (box) box.remove(); box = null; }

  // the face: this panel (capture: before the old profile picker's handler)
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest?.("#profChip")) { e.stopImmediatePropagation(); e.preventDefault(); return openPanel(); }
    if (!box || !box.contains(t)) return;
    if (t === box || t.closest("[data-qp-close]")) return close();
    const sys = t.closest("[data-qp-sys]"); if (sys) return A.openSystem(sys.dataset.qpSys);
    if (t.closest("[data-qp-auto]")) { if (!A.setAutoBrightness(!(st.bright || {}).auto)) A.openSystem("write"); return paint(false); }
    const o = t.closest("[data-qp-open]"); if (o) { if (A.openNotif(o.dataset.qpOpen)) close(); else toast("That one can't be opened from here"); return; }
    const c = t.closest("[data-qp-clear]"); if (c) { A.clearNotif(c.dataset.qpClear); return setTimeout(() => paint(false), 200); }
    if (t.closest("[data-qp-clearall]")) { let l = []; try { l = JSON.parse(A.notifs()); } catch (err) {} l.filter((n) => n.clear).forEach((n) => A.clearNotif(n.key)); return setTimeout(() => paint(false), 300); }
  }, true);
  let bT = 0;
  document.addEventListener("input", (e) => {
    if (!box || !box.contains(e.target)) return;
    const v = e.target.closest("[data-qp-vol]"); if (v) { if (!A.setVolume(v.dataset.qpVol, Number(v.value))) toast("Android won't change the ringer right now (Do Not Disturb?)"); return; }
    const b = e.target.closest("[data-qp-bright]"); if (b) { clearTimeout(bT); bT = setTimeout(() => A.setBrightness(Number(b.value) / 100), 40); }
  });
  window.Native.notifsChanged = () => { if (box) box.querySelector("#qpNotifs").innerHTML = (read(), notifsHtml()); };
  // Back closes it
  const back0 = window.Native.onBack;
  window.Native.onBack = () => { if (box) { close(); return true; } return back0 ? back0() : false; };
  const resume0 = window.Native.onResume;
  window.Native.onResume = () => { if (resume0) resume0(); if (box) paint(false); };      // (back from Android's own page: show what changed)
  // the face is always there on the phone (it's the quick panel now, not only for switching profiles)
  const show = () => { const c = $("#profChip"); if (c) { c.hidden = false; c.title = "Quick settings"; } };
  show();
  new MutationObserver(show).observe($("#profChip"), { attributes: true, attributeFilter: ["hidden"] });
  window.QuickPanel = { open: openPanel, close };
})();
