/* Comics (CBZ) on the iPhone: the zip's table of contents is read from its end, and each page is read and unpacked on
   its own, so a 300 MB comic never has to be opened whole (the Android app reads them the same way). */
const Zip = (() => {
  const toc = new Map();          // name -> sorted image entries
  const IMG = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
  const u16 = (v, o) => v.getUint16(o, true), u32 = (v, o) => v.getUint32(o, true);
  const u64 = (v, o) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 4294967296;
  const view = async (name, s, e) => { const r = await DB.range(name, s, e); return r && new DataView(await r.blob.arrayBuffer()); };

  function natural(a, b) {
    const re = /(\d+)|(\D+)/g, x = a.match(re) || [], y = b.match(re) || [];
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const p = x[i], q = y[i];
      if (/^\d/.test(p) && /^\d/.test(q)) { const d = Number(p) - Number(q); if (d) return d; }
      else { const c = p.toLowerCase().localeCompare(q.toLowerCase()); if (c) return c; }
    }
    return x.length - y.length;
  }

  async function entries(name) {
    if (toc.has(name)) return toc.get(name);
    const f = await DB.get("files", name);
    if (!f) throw new Error("not on the phone");
    const tailLen = Math.min(f.size, 65557 + 20);
    const tail = await view(name, f.size - tailLen, f.size);
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip");
    let cdSize = u32(tail, eocd + 12), cdOff = u32(tail, eocd + 16);
    if (cdOff === 0xffffffff || cdSize === 0xffffffff) {          // a ZIP64 archive: the real numbers are further back
      const loc = eocd - 20;
      if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
        const z = await view(name, u64(tail, loc + 8), u64(tail, loc + 8) + 56);
        cdSize = u64(z, 40); cdOff = u64(z, 48);
      }
    }
    const cd = await view(name, cdOff, cdOff + cdSize);
    const dec = new TextDecoder();
    const list = [];
    for (let p = 0; p + 46 <= cd.byteLength && u32(cd, p) === 0x02014b50;) {
      const method = u16(cd, p + 10), nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
      let csize = u32(cd, p + 20), usize = u32(cd, p + 24), off = u32(cd, p + 42);
      const nm = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
      for (let q = p + 46 + nl; q < p + 46 + nl + xl;) {           // ZIP64 sizes and offsets
        const id = u16(cd, q), len = u16(cd, q + 2);
        if (id === 1) {
          let k = q + 4;
          if (usize === 0xffffffff) { usize = u64(cd, k); k += 8; }
          if (csize === 0xffffffff) { csize = u64(cd, k); k += 8; }
          if (off === 0xffffffff) { off = u64(cd, k); }
        }
        q += 4 + len;
      }
      const leaf = nm.split("/").pop();
      if (!nm.endsWith("/") && IMG.test(nm) && !nm.startsWith("__MACOSX") && !leaf.startsWith(".")) list.push({ nm, method, csize, usize, off });
      p += 46 + nl + xl + cl;
    }
    list.sort((a, b) => natural(a.nm, b.nm));
    toc.set(name, list);
    return list;
  }

  async function page(name, n) {
    const e = (await entries(name))[n];
    if (!e) return null;
    const lh = await view(name, e.off, e.off + 30);
    const start = e.off + 30 + u16(lh, 26) + u16(lh, 28);
    const r = await DB.range(name, start, start + e.csize);
    const type = mimeOf(e.nm).startsWith("application") ? "image/" + e.nm.split(".").pop().toLowerCase().replace("jpg", "jpeg") : mimeOf(e.nm);
    if (e.method === 0) return new Blob([r.blob], { type });
    if (e.method !== 8) throw new Error("unsupported compression");
    const out = r.blob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Blob([await new Response(out).arrayBuffer()], { type });
  }
  return { entries, page, forget: (name) => toc.delete(name) };
})();
