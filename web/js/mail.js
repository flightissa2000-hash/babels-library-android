/* The Mail tab (Android): Gmail's own home-screen widget (or any other app's), hosted right here. They're the real
   widgets, drawn by Gmail itself, so your inbox shows in the tab and tapping an email opens it in the Gmail app.
   Add one for each of your accounts (Gmail asks which account and folder). The phone draws them over the framed space
   below the header (Widgets.java); the page only says where. The iPhone web app has no Mail tab. */
(() => {
  if (typeof A === "undefined" || !A || !A.widgetsShow || (typeof WEB !== "undefined" && WEB)) {
    window.MailTab = null;
    const t = document.querySelector('#tabs [data-tab="mail"]'); if (t) t.remove();
    return;
  }
  const GMAIL = "com.google.android.gm";
  const M = { picking: false, arranging: false, others: false };
  const mine = () => { try { return JSON.parse(A.widgetList()); } catch (e) { return []; } };
  const gmailApp = () => { try { return (window.AddOns ? AddOns.apps() : JSON.parse(A.apps())).find((a) => a.pkg === GMAIL); } catch (e) { return null; } };

  // where the widgets go: the framed space under the header, down to the bottom of the room
  function place() {
    const dock = $("#mlDock");
    if (S.tab !== "mail" || !dock || M.picking || M.arranging || document.body.classList.contains("nav-open") || Reader.open || (window.Sleep && Sleep.up) || !$("#sheet").hidden) { A.widgetsHide(); return; }
    const room = browserRect(), r = dock.getBoundingClientRect();
    const h = Math.max(120, room.y + room.h - r.top - 10);
    dock.style.height = h + "px";
    const pad = 4;       // (the theme's frame shows around them)
    A.widgetsShow(JSON.stringify({ x: r.left + pad, y: r.top + pad, w: r.width - pad * 2, h: h - pad * 2, radius: 12 }));
  }
  addEventListener("resize", () => { if (S.tab === "mail") place(); });

  function render(v) {
    const list = mine(), g = gmailApp();
    $("#view").scrollTop = 0;
    const top = `<header class="ml-top"><span class="ml-env" aria-hidden="true">✉</span><div><h2>Mail</h2><small>${list.length ? "Tap an email to open it in Gmail" : "Your inbox, right on this tab"}</small></div>
      <span class="ml-acts">${g ? `<button class="btn sm" data-ml-gmail type="button">Open Gmail</button>` : ""}${list.length ? `<button class="btn sm" data-ml-arrange type="button" aria-label="Arrange">${M.arranging ? "Done" : "✎"}</button>` : ""}</span></header>`;
    if (M.picking) { v.innerHTML = `<div class="ml">${top}${pickerHtml()}</div>`; return A.widgetsHide(); }
    if (M.arranging) {
      v.innerHTML = `<div class="ml">${top}<div class="ml-arr">${list.map((w, i) => `<div class="ml-arow"><span class="ml-stamp">${esc((w.app || "?")[0])}</span><span class="ml-t"><b>${esc(w.label)}</b><small>${esc(w.app)}</small></span>
          ${i ? `<button class="ml-small" data-ml-up="${w.id}" type="button" aria-label="Move up">↑</button>` : ""}<button class="ml-small" data-ml-drop="${w.id}" type="button" aria-label="Remove">✕</button></div>`).join("")}</div>
        <button class="btn ml-add" data-ml-pick type="button">＋ Add another widget</button><p class="hint ml-tip">Each widget gets an equal share of the tab. Removing one here doesn't touch your email.</p></div>`;
      return A.widgetsHide();
    }
    if (!list.length) {
      v.innerHTML = `<div class="ml">${top}<div class="ml-empty"><span class="ml-big">✉</span><p>Put Gmail's inbox widget here: your emails show on this tab, and tapping one opens it in the Gmail app.</p>
        <button class="btn primary" data-ml-pick type="button">＋ Add the Gmail widget</button>
        <p class="hint">Got more than one account? Add the widget once for each: Gmail asks which account (and folder) each time.</p>${g ? "" : `<p class="hint">The Gmail app isn't on this phone; other apps' widgets work too.</p>`}</div></div>`;
      return A.widgetsHide();
    }
    v.innerHTML = `<div class="ml">${top}<div class="ml-dock" id="mlDock"></div></div>`;
    requestAnimationFrame(place);
  }

  function pickerHtml() {
    let all = []; try { all = JSON.parse(A.widgetProviders()); } catch (e) {}
    const gm = all.filter((p) => p.pkg === GMAIL), rest = all.filter((p) => p.pkg !== GMAIL);
    const row = (p) => `<button class="ml-prov" data-ml-add="${esc(p.pkg)}|${esc(p.cls)}" type="button"><span class="ml-prev"><img alt="" loading="lazy" src="/widgetpreview?${new URLSearchParams({ p: p.pkg, c: p.cls })}" onerror="this.remove()"></span><span class="ml-t"><b>${esc(p.label)}</b><small>${esc(p.app)}</small></span></button>`;
    return `<div class="ml-pick"><div class="ml-pickh"><b>Add a widget</b><button class="btn sm" data-ml-cancel type="button">Cancel</button></div>
      ${gm.length ? `<h3 class="ao-h">Gmail</h3>${gm.map(row).join("")}` : `<p class="hint">Gmail has no widgets on this phone (is the Gmail app installed?).</p>`}
      ${rest.length ? `<button class="linkish ml-others" data-ml-others type="button">${M.others ? "Hide" : "Show"} other apps' widgets (${rest.length})</button>${M.others ? rest.map(row).join("") : ""}` : ""}
      <p class="hint ml-tip">The first time, Android asks you to let Babel show widgets: tap Create (or Allow). Then Gmail asks which account and folder.</p></div>`;
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest?.("[data-ml-pick]")) { M.picking = true; M.arranging = false; return render($("#view")); }
    if (t.closest?.("[data-ml-cancel]")) { M.picking = false; return render($("#view")); }
    if (t.closest?.("[data-ml-others]")) { M.others = !M.others; return render($("#view")); }
    const ad = t.closest?.("[data-ml-add]");
    if (ad) { const [pkg, cls] = ad.dataset.mlAdd.split("|"); M.picking = false; render($("#view")); A.widgetAdd(pkg, cls); return; }
    if (t.closest?.("[data-ml-arrange]")) { M.arranging = !M.arranging; M.picking = false; return render($("#view")); }
    const up = t.closest?.("[data-ml-up]"); if (up) { A.widgetUp(Number(up.dataset.mlUp)); return setTimeout(() => render($("#view")), 80); }
    const dr = t.closest?.("[data-ml-drop]");
    if (dr) { if (confirm("Take this widget off the Mail tab? Your email isn't touched.")) { A.widgetRemove(Number(dr.dataset.mlDrop)); setTimeout(() => { if (!mine().length) M.arranging = false; render($("#view")); }, 80); } return; }
    if (t.closest?.("[data-ml-gmail]")) { const g = gmailApp(); if (g) A.launchApp(g.pkg, g.cls); }
  });
  // a widget added (or Android's question answered "no"): the tab shows what there is now
  window.Native.widgetsChanged = () => { if (S.tab === "mail") render($("#view")); };
  window.MailTab = { render, place };
})();
