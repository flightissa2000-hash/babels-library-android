/* The iPhone app's service worker. It answers the same addresses the Android app serves from Java:
     /local/<name>        a file kept on the phone (with Range, so video and audio can seek)
     /part/<name>?s=&e=   bytes s..e-1 of one (the PDF reader asks for pieces)
     /comic/<name>/count  and /comic/<name>/<n>: a CBZ's page count and its pages
     /cover/<id>?v=       an item's cover, fetched from the computer once and kept
     /catcover?…          a catalogue cover, through the computer
   It also keeps the app itself for offline use, and shows the News notifications the computer sends. */
const VERSION = "__VERSION__";
const SHELL = "shell-" + VERSION;
importScripts("ios/net.js", "ios/store.js", "ios/zip.js");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(__SHELL_FILES__)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

let connAt = 0;
async function conn() {            // the pairing, from the page's saved state (re-read now and then)
  if (Date.now() - connAt < 20000 && Net.token) return;
  connAt = Date.now();
  try { const st = JSON.parse((await DB.get("kv", "state.json")) || "{}"); if (st.conn) Net.set(st.conn); } catch (e) {}
}
const notFound = () => new Response("", { status: 404 });

async function local(req, name) {
  const f = await DB.get("files", name);
  if (!f || !f.done) return notFound();
  const m = /^bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  const h = { "Accept-Ranges": "bytes", "Content-Type": f.type || mimeOf(name), "Cache-Control": "no-store" };
  if (!m) { const b = await DB.blob(name); return new Response(b, { status: 200, headers: { ...h, "Content-Length": String(f.size) } }); }
  let s, e;
  if (m[1] === "") { s = Math.max(0, f.size - Number(m[2] || 0)); e = f.size - 1; }
  else { s = Number(m[1]); e = m[2] === "" ? f.size - 1 : Math.min(Number(m[2]), f.size - 1); }
  if (m[1] !== "" && m[2] === "") e = Math.min(f.size - 1, s + 4 * PIECE - 1);      // (open-ended: a few pieces at a time)
  if (s >= f.size) return new Response("", { status: 416, headers: { "Content-Range": `bytes */${f.size}` } });
  const r = await DB.range(name, s, e + 1);
  return new Response(r.blob, { status: 206, headers: { ...h, "Content-Length": String(e - s + 1), "Content-Range": `bytes ${s}-${e}/${f.size}` } });
}
async function part(url, name) {
  const f = await DB.get("files", name);
  if (!f || !f.done) return notFound();
  const r = await DB.range(name, Number(url.searchParams.get("s")), Number(url.searchParams.get("e")));
  return new Response(r.blob, { headers: { "X-File-Size": String(f.size), "Cache-Control": "no-store" } });
}
async function comic(rest) {
  const i = rest.indexOf("/");
  const name = decodeURIComponent(rest.slice(0, i)), what = rest.slice(i + 1);
  try {
    if (what === "count") return new Response(JSON.stringify({ count: (await Zip.entries(name)).length }), { headers: { "Content-Type": "application/json" } });
    const b = await Zip.page(name, Number(what));
    return b ? new Response(b, { headers: { "Cache-Control": "max-age=86400" } }) : notFound();
  } catch (e) { return notFound(); }
}
/* from the computer, kept in a cache of its own: covers don't change unless their ?v= does */
async function viaComputer(req, cacheName, path) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req.url);
  if (hit) return hit;
  await conn();
  if (!Net.token) return notFound();
  const r = await Net.call("GET", path, null, 30000);
  if (r.status !== 200) return notFound();
  const b = await r.res.blob();
  if (!b.size) return notFound();
  const res = new Response(b, { headers: { "Content-Type": r.res.headers.get("content-type") || "image/jpeg", "Cache-Control": "max-age=31536000" } });
  c.put(req.url, res.clone()).catch(() => {});
  return res;
}

/* a catalogue cover while the computer is off: straight from the picture's address (or Open Library, by ISBN).
   The answer is opaque (no CORS), which an <img> shows all the same. */
async function direct(url) {
  const q = url.searchParams, isbn = q.get("isbn") || "";
  let u = /^https:\/\//.test(q.get("u") || "") ? q.get("u") : /^[0-9Xx]{10,13}$/.test(isbn) ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : "";
  if (!u) return notFound();
  try { return await fetch(u, { mode: "no-cors" }); } catch (err) { return notFound(); }
}

/* /net/<path>: a GET from the computer with the pairing token (subtitles and audiobook chapters; Range passes through) */
async function net(req, path) {
  await conn();
  const range = req.headers.get("range");
  const r = await Net.call("GET", path, null, 60000, range ? { Range: range } : {});
  if (!r.status) return new Response("", { status: 503 });
  const h = new Headers();
  for (const k of ["content-type", "content-range", "content-length", "accept-ranges"]) if (r.res.headers.get(k)) h.set(k, r.res.headers.get(k));
  return new Response(r.res.body, { status: r.res.status, headers: h });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  const p = url.pathname;
  if (p.startsWith("/local/")) return e.respondWith(local(e.request, decodeURIComponent(p.slice(7))));
  if (p.startsWith("/part/")) return e.respondWith(part(url, decodeURIComponent(p.slice(6))));
  if (p.startsWith("/comic/")) return e.respondWith(comic(p.slice(7)));
  if (p.startsWith("/cover/")) {
    const id = p.slice(7);
    if (!/^\d{1,9}$/.test(id)) return e.respondWith(notFound());
    return e.respondWith(viaComputer(e.request, "covers", "/sync/cover/" + id));
  }
  if (p === "/catcover") return e.respondWith(viaComputer(e.request, "catcovers", "/sync/cat/cover" + url.search).then((r) => r.ok ? r : direct(url)));
  if (p.startsWith("/net/sync/")) return e.respondWith(net(e.request, p.slice(4) + url.search));
  // the app itself: from the phone first (it works offline), refreshed when a new version is published
  e.respondWith(caches.open(SHELL).then(async (c) => (await c.match(e.request, { ignoreSearch: true })) || fetch(e.request)));
});

self.addEventListener("message", (e) => { if (e.data && e.data.forget) Zip.forget(e.data.forget); });

/* News: the computer found new events (Web Push; works when the app is on the Home Screen) */
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) {}
  const items = m.items || [];
  e.waitUntil(self.registration.showNotification(m.title || "Babel's Library", {
    body: m.body || "", tag: "news-" + Date.now(), icon: "ios/icon-192.png", badge: "ios/icon-192.png",
    data: { kind: m.kind || "news", items },
  }));
});
/* tapping it opens the app on that event, with Share and Open */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (list.length) { list[0].postMessage({ news: data.items || [] }); return list[0].focus(); }
    return self.clients.openWindow(self.registration.scope + "#news=" + encodeURIComponent(JSON.stringify((data.items || []).slice(0, 8))));
  })());
});
