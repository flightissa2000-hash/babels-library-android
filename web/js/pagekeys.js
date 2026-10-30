/* Page-turn buttons: while a book, comic or PDF is open, buttons you choose move through it (a page at a time, or a
   screenful when it's scrolling). The phone's volume buttons and e-reader page buttons are caught by the app itself
   ("a:" + Android's key code); keyboards and Bluetooth page turners arrive as ordinary keys ("k:" + the key's code). */
const PageKeys = window.PageKeys = (() => {
  const DEFAULT = { on: true, next: ["a:25", "a:93", "k:PageDown", "k:ArrowRight", "k:ArrowDown", "k:Space"], prev: ["a:24", "a:92", "k:PageUp", "k:ArrowLeft", "k:ArrowUp"] };
  const P = { ...DEFAULT, ...load("pagekeys.json", {}) };
  let capturing = false, learning = null;          // learning: "next" or "prev" while waiting for a button to be pressed
  const keep = () => store("pagekeys.json", { on: P.on, next: P.next, prev: P.prev });
  const NAMES = { "a:24": "Volume up", "a:25": "Volume down", "a:92": "Page up button", "a:93": "Page down button", "a:21": "Left", "a:22": "Right",
    "a:19": "Up", "a:20": "Down", "a:62": "Space", "a:66": "Enter", "a:87": "Media next", "a:88": "Media previous",
    "k:PageDown": "Page Down", "k:PageUp": "Page Up", "k:ArrowRight": "→", "k:ArrowLeft": "←", "k:ArrowDown": "↓", "k:ArrowUp": "↑", "k:Space": "Space" };
  const name = (c) => NAMES[c] || (c.startsWith("a:") ? (P.labels || {})[c] || `Button ${c.slice(2)}` : c.slice(2).replace(/^Key|^Digit/, ""));

  /* tells the phone which of its buttons to keep from their usual job (volume) while reading, or to report the next one */
  function tellPhone() {
    if (!A || !A.pageKeys) return;
    const codes = capturing && P.on ? [...P.next, ...P.prev].filter((c) => c.startsWith("a:")).map((c) => Number(c.slice(2))) : [];
    A.pageKeys(JSON.stringify({ codes, learn: !!learning }));
  }
  function capture(on) { capturing = !!on; tellPhone(); }

  function press(code) {
    if (learning) return learned(code);
    if (!P.on || !capturing || !window.Reader || !Reader.open) return false;
    const d = P.next.includes(code) ? 1 : P.prev.includes(code) ? -1 : 0;
    if (!d) return false;
    Reader.pageKey(d);
    return true;
  }
  function learned(code, label) {
    const which = learning;
    learning = null; tellPhone();
    if (label && code.startsWith("a:")) { P.labels = { ...(P.labels || {}), [code]: label }; }
    P.next = P.next.filter((c) => c !== code); P.prev = P.prev.filter((c) => c !== code);     // (one job per button)
    P[which].push(code);
    keep();
    toast(`${name(code)} → ${which === "next" ? "next page" : "previous page"}`);
    paint();
    return true;
  }

  window.Native.pageKey = (code) => press(code);
  window.Native.keyLearned = (code, label) => { if (learning) learned(code, String(label || "").replace(/^KEYCODE_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (x) => x.toUpperCase())); };
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    const code = "k:" + (e.code || e.key);
    if (learning && e.key !== "Escape") { e.preventDefault(); learned(code); return; }
    if (learning) { learning = null; tellPhone(); paint(); return; }
    if (press(code)) e.preventDefault();
  }, true);

  /* Settings → Reading: the panel */
  const chips = (which) => P[which].map((c) => `<span class="pk-chip">${esc(name(c))}<button data-pk-del="${which}|${esc(c)}" aria-label="Remove">✕</button></span>`).join("") || `<small class="hint">none</small>`;
  function panel() {
    return `<div class="panel" id="pkPanel"><h3>Page-turn buttons</h3>
      <label class="check"><input type="checkbox" id="pkOn" ${P.on ? "checked" : ""}> Turn pages with buttons while reading <small class="hint">(volume buttons, an e-reader's page buttons, a keyboard or a Bluetooth page turner; scrolling books move a screenful)</small></label>
      <div class="pk-row"><b>Next page</b><span>${chips("next")}</span><button class="btn sm" data-pk-learn="next">${learning === "next" ? "Press a button…" : "＋ Add a button"}</button></div>
      <div class="pk-row"><b>Previous page</b><span>${chips("prev")}</span><button class="btn sm" data-pk-learn="prev">${learning === "prev" ? "Press a button…" : "＋ Add a button"}</button></div>
      <p class="hint">Outside a book the volume buttons work as usual.${WEB ? " (On iPhone the volume buttons can't be used by a web app; keyboards and page turners can.)" : ""} <button class="linkish" data-pk-reset>Back to the usual buttons</button></p></div>`;
  }
  function paint() { const p = $("#pkPanel"); if (p) p.outerHTML = panel(); }
  document.addEventListener("click", (e) => {
    const l = e.target.closest("[data-pk-learn]");
    if (l) { learning = learning === l.dataset.pkLearn ? null : l.dataset.pkLearn; tellPhone(); if (learning) toast("Press the button you want to use (Back cancels)"); return paint(); }
    const d = e.target.closest("[data-pk-del]");
    if (d) { const [w, c] = d.dataset.pkDel.split("|"); P[w] = P[w].filter((x) => x !== c); keep(); return paint(); }
    if (e.target.closest("[data-pk-reset]")) { P.next = [...DEFAULT.next]; P.prev = [...DEFAULT.prev]; P.on = true; keep(); return paint(); }
  });
  document.addEventListener("change", (e) => { if (e.target.id === "pkOn") { P.on = e.target.checked; keep(); tellPhone(); } });
  // leaving Settings while waiting for a button: stop waiting
  const cancel = () => { if (!learning) return false; learning = null; tellPhone(); paint(); return true; };
  return { capture, panel, cancel };
})();
