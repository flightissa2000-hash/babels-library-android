/* The iPhone app's storage (IndexedDB), shared by the page and its service worker:
     kv      the app's state files (state.json, library.json, …), as text
     files   a file kept on the phone: {name, size, type, pieces, done}
     pieces  the file itself, in 8 MB pieces (key "name#n"): downloads resume piece by piece, and nothing ever has to
             hold a whole film in memory */
const PIECE = 8 * 1024 * 1024;
const DB = {
  _db: null,
  open() {
    if (this._db) return this._db;
    return (this._db = new Promise((ok, no) => {
      const q = indexedDB.open("babel", 1);
      q.onupgradeneeded = () => {
        const d = q.result;
        for (const s of ["kv", "files", "pieces"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      q.onsuccess = () => ok(q.result);
      q.onerror = () => no(q.error);
    }));
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((ok, no) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => { out = v; });
      t.oncomplete = () => ok(out);
      t.onerror = t.onabort = () => no(t.error);
    });
  },
  req: (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }),
  get(store, key) { return this.tx(store, "readonly", (s) => this.req(s.get(key))); },
  put(store, key, val) { return this.tx(store, "readwrite", (s) => { s.put(val, key); }); },
  /* a piece of a file: kept as a Blob (on disk, never all in memory); where Blobs can't be stored (Safari's private
     browsing refuses them) as plain bytes instead */
  async putPiece(key, blob) {
    if (!this.rawPieces) {
      try { return await this.put("pieces", key, blob); } catch (e) { this.rawPieces = true; }
    }
    return this.put("pieces", key, await blob.arrayBuffer());
  },
  async piece(key) {
    const p = await this.get("pieces", key);
    return p instanceof ArrayBuffer ? new Blob([p]) : p;
  },
  del(store, key) { return this.tx(store, "readwrite", (s) => { s.delete(key); }); },
  all(store) {
    return this.tx(store, "readonly", async (s) => {
      const [keys, vals] = await Promise.all([this.req(s.getAllKeys()), this.req(s.getAll())]);
      return keys.map((k, i) => [k, vals[i]]);
    });
  },

  /* a kept file as one Blob made of its pieces (the pieces stay on disk; nothing is read until it's used) */
  async blob(name) {
    const f = await this.get("files", name);
    if (!f || !f.done) return null;
    const parts = [];
    for (let i = 0; i < f.pieces; i++) {
      const p = await this.piece(name + "#" + i);
      if (!p) return null;
      parts.push(p);
    }
    return new Blob(parts, { type: f.type || "" });
  },
  /* bytes s..e-1 of a kept file, reading only the pieces they're in */
  async range(name, s, e) {
    const f = await this.get("files", name);
    if (!f || !f.done) return null;
    s = Math.max(0, s); e = Math.min(f.size, e);
    const parts = [];
    for (let i = Math.floor(s / PIECE); i * PIECE < e; i++) {
      const p = await this.piece(name + "#" + i);
      if (!p) return null;
      const a = i * PIECE;
      parts.push(p.slice(Math.max(0, s - a), Math.min(p.size, e - a)));
    }
    return { blob: new Blob(parts, { type: f.type || "" }), size: f.size, type: f.type || "" };
  },
  async removeFile(name) {
    const f = await this.get("files", name);
    const n = f ? Math.ceil((f.size || 0) / PIECE) + 1 : 0;
    await this.tx("pieces", "readwrite", (s) => { for (let i = 0; i < n; i++) s.delete(name + "#" + i); });
    await this.del("files", name);
  },
};
const MIME = { pdf: "application/pdf", epub: "application/epub+zip", cbz: "application/zip", mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4",
  aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska" };
const mimeOf = (name) => MIME[String(name).split(".").pop().toLowerCase()] || "application/octet-stream";
