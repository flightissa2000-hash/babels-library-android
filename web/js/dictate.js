/* Dictation for phone notes. The words come from Android's speech recognition (Dictation.java): the app listens from
   Dictate.begin() until Dictate.end(), restarting itself through pauses, and passes along what it hears (partial while
   you speak, final once a phrase is done).

   Any 🎙 button: hold it to talk and let go to stop, or tap it once to keep listening and tap again to stop.
   A target says what happens with the words: onText(all so far, isFinal) while listening, onEnd(all) at the end. */
const Dictate = (() => {
  let cur = null, pill = null, endTimer = 0;
  const join = (a, b) => (a && b ? a + " " + b : a || b);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function showPill(text) {
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "dict-pill";
      pill.innerHTML = `<i class="dict-dot"></i><span></span>`;
      document.body.append(pill);
    }
    pill.querySelector("span").textContent = text;
    pill.hidden = !text;
  }

  function begin(target) {
    if (!A || !A.dictateStart) { toast("Dictation works in the phone app."); return false; }
    if (cur) finish();
    cur = { heard: "", ...target };
    cur.btn?.classList.add("rec");
    showPill(cur.hold ? "Listening… let go to stop" : "Listening… tap 🎙 to stop");
    A.dictateStart();
    return true;
  }
  function end() {
    if (!cur || cur.stopping) return;
    cur.stopping = true;
    showPill("Finishing…");
    A.dictateStop();
    clearTimeout(endTimer);
    endTimer = setTimeout(finish, 4000);          // (in case the last words never come)
  }
  function finish() {
    clearTimeout(endTimer);
    const c = cur;
    cur = null;
    showPill("");
    if (!c) return;
    c.btn?.classList.remove("rec");
    c.onEnd && c.onEnd(c.heard.trim());
  }

  function handle(m) {
    if (!cur) return;
    if (m.type === "partial") cur.onText && cur.onText(join(cur.heard, m.text), false);
    else if (m.type === "final") { cur.heard = join(cur.heard, cur.heard || cur.capFirst === false ? m.text : cap(m.text)); cur.onText && cur.onText(cur.heard, true); }
    else if (m.type === "level") pill && pill.style.setProperty("--lv", m.text);
    else if (m.type === "state") {
      if (m.text === "off") finish();
      else if (m.text === "asking") showPill("Allow the microphone to dictate…");
      else if (m.text === "allowed") { toast("Microphone allowed: hold 🎙 again to talk"); finish(); }
      else if (m.text === "listening" && !cur.stopping) showPill(cur.hold ? "Listening… let go to stop" : "Listening… tap 🎙 to stop");
    } else if (m.type === "error") { toast(m.text); finish(); }
  }

  /* hold-to-talk or tap-to-toggle on a button; make() builds the target when it starts */
  function press(btn, make, e) {
    if (cur && cur.btn === btn) { end(); return; }          // tapped again: stop
    const t = make();
    if (!t) return;
    const down = Date.now();
    if (!begin({ ...t, btn, hold: true })) return;
    const up = () => {
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      if (!cur || cur.btn !== btn) return;
      if (Date.now() - down > 450) end();                     // held: let go to stop
      else { cur.hold = false; showPill("Listening… tap 🎙 to stop"); }   // a tap: keep going until tapped again
    };
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
  }

  /* 🎙 beside a text box: the words go in at its end, as you speak */
  function intoBox(ta) {
    const base = ta.value.replace(/\s+$/, "");
    return {
      capFirst: !base || /[.!?]$/.test(base),        // (carrying on a sentence: no capital)
      onText: (t) => { ta.value = join(base, t); ta.scrollTop = ta.scrollHeight; },
      onEnd: () => {},
    };
  }

  window.Native.dictation = handle;
  // no long-press menus or text selection on the dictation buttons
  document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(".mic, #qNote")) e.preventDefault(); });
  return { begin, end, press, intoBox, get active() { return !!cur; } };
})();
