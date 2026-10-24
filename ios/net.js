/* Talking to the computer from the iPhone app (the page and its service worker both use this).
   The app is an https page, so it can't reach the computer's plain-http address on the Wi-Fi: it always goes through
   the computer's away-from-home address (a Cloudflare tunnel), which the computer posts to its private ntfy.sh
   topic whenever it changes (the same way the Android app finds it from away). */
const Net = {
  remote: "", topic: "", token: "", via: "",

  set(conn) {
    if (!conn) return;
    this.remote = conn.remote || this.remote || "";
    this.topic = conn.topic || "";
    this.token = conn.token || "";
  },

  /* one request to one address; {status, res, error}: status 0 = couldn't reach it */
  async once(base, method, path, body, ms = 90000, extra = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const h = { ...extra };
      // the pairing token goes to the computer only, never to ntfy.sh
      if (this.token && !base.startsWith("https://ntfy.sh")) h.Authorization = "Bearer " + this.token;
      if (body != null && !(body instanceof Blob)) h["Content-Type"] = "application/json";
      const res = await fetch(base + path, { method, headers: h, body: body == null ? undefined : body, signal: ctl.signal, cache: "no-store" });
      return { status: res.status, res };
    } catch (e) {
      return { status: 0, error: ctl.signal.aborted ? "timeout" : String(e.message || e) };
    } finally { clearTimeout(t); }
  },

  /* the computer's latest away-from-home address, from an ntfy.sh topic (kept there for 12 hours) */
  async lookup(topic) {
    if (!topic) return "";
    const r = await this.once("https://ntfy.sh", "GET", `/${topic}/json?poll=1&since=12h`, null, 15000);
    if (r.status !== 200) return "";
    let found = "";
    for (const line of (await r.res.text()).split("\n")) {
      try { const o = JSON.parse(line); if (o.event === "message" && /^https:\/\//.test(o.message || "")) found = o.message.trim(); } catch (e) {}
    }
    return found;
  },

  /* a request by whichever address works now (a dead tunnel answers 502/530: look up the new one) */
  async call(method, path, body, ms, extra) {
    let r = null;
    if (this.remote) {
      r = await this.once(this.remote, method, path, body, ms, extra);
      if (r.status > 0 && r.status !== 530 && r.status !== 502) { this.via = "remote"; return r; }
    }
    const fresh = await this.lookup(this.topic);
    if (fresh && fresh !== this.remote) {
      this.remote = fresh;
      if (typeof Net.onMoved === "function") Net.onMoved(fresh);
      r = await this.once(this.remote, method, path, body, ms, extra);
      if (r.status > 0 && r.status !== 530 && r.status !== 502) { this.via = "remote"; return r; }
    }
    this.via = "";
    if (!r) r = { status: 0, error: "not paired" };
    if (r.status === 530 || r.status === 502) r.status = 0;
    return r;
  },

  /* where an unpaired iPhone finds the computer from the pairing code alone (the computer posts its away-from-home
     address to a topic made from the code while the code is good) */
  async pairTopic(code) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("babel-pair:" + code)));
    return "babel-pair-" + [...h].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
  },
};
