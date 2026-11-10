/* site-cull.js (SITE integration, v154, 2026-11-09): upload culling, browser side of the scanner's CULLING_SPEC v1.
 * Policy (user, decided): every scanned system counts. Per region and per scan session the browser uploads full rows for at
 * least 1 in 10 scanned systems (ceil(n/10), best by modules) plus every system that enters a top-100 list. The others are
 * reported only as a "scanned" bit in a per-region bitmap and one module character each.
 * v158: relay 1.4 answers (scanned uploads are off, bad scanned part) handled in badRequest/answer. v157: see the "v157" notes below (400 handling, decided set, probe after switch-off, counted set).
 * Switched on only by DV_CONFIG.relayScanned === true (same pattern as relayFinder / relayPerf: relay 1.3 answers 400 to the
 * unknown key "scanned" for the WHOLE batch, so it stays false until the Pi runs relay 1.4). Off = today's behaviour, nothing changes.
 *   dvCull.on()                      culling and the "scanned" part are switched on (flag true, relay set, not switched off by an error)
 *   dvCull.reg(src, {push, busy, log})  a sender: push(items) takes the rows to upload, busy(prefix) tells whether a scan of that
 *                                    region (GG+REGION8) is still running, log(text) writes one line to the page's error log
 *   dvCull.add(src, a, o)            one finished scan: o = {ver, ch|meta, item, top}. Returns true when culling took it
 *                                    (the row is held until the region ends), false when the caller must send it as before
 *   dvCull.end(src)                  the session of src ended (stop, pause, page hidden): every open region is decided now
 *   dvCull.has(force) / take(ver, maxBytes) / giveBack(tk) / answer(tk, res, again) / body(json, tk)  the request part
 * Bit order (spec 1.1): index i is bit (i & 7) of byte (i >> 3); bits for 1..0x428; trailing zero bytes cut; standard base64. */
(function () {
  "use strict";
  const cfg = () => globalThis.DV_CONFIG || {};
  let off = false;                                     // v157: switched off (no new culling) after relay 1.3's key error; the pending bits are KEPT and one scanned-only probe is tried later
  let probeAt = 0, offStep = 0, bad400 = 0;
  const flagOk = () => cfg().relayScanned === true && !!String(cfg().scanRelay || "");
  const on = () => flagOk() && !off;
  const MAX_REG = 32, MAX_BYTES = 65536, MAX_BITS = 8192, MAX_IDX = 0x428, DIV = 10, IDLE_MS = 60000, NEAR_IDLE_MS = 15000, HOLD_MAX = 4000;
  const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyz";
  const fpOf = (ver) => (/tables fingerprint ([0-9a-f]{16})\b/.exec(ver) || [])[1] || "";
  const srcs = new Map();                              // src -> {push, busy, log}
  const held = new Map();                              // "src|GGREGION8" -> group {src, g, r, n, cells: Map idx -> {c, item, meta, top, seq}, last}
  // v157 page-level set of decided addresses: 1 = nothing more to send for it, 0 = culled (bit only). A later session that scans one of
  // them again does not count it in n or in its candidates, so the "1 in 10" share of unique systems cannot fall below 1/10 (spec 1.6).
  const decided = new Map(), DEC_MAX = 200000;
  const counted = new Set();                           // v157: addresses whose bit the relay accepted (the "counted only" state in Your uploads)
  const pend = new Map();                              // scanner version -> Map "GGREGION8" -> {g, r, cells: Map idx -> char}
  let seq = 0, heldRows = 0, pbits = 0, hold = 0;
  const stat = { again: 0, scanned: 0, kept: 0, culled: 0, top: 0, none: 0, parts: 0, bits: 0, off: "" };

  const modChar = (m) => (Number.isInteger(m) && m >= 0 && m <= 35 ? ALPHA[m] : "?");
  // the same order as Contribute's "best by modules" list: modules, fewer ambiguous, more loot, more value
  const better = (x, y) => (y.meta.m ?? -1) - (x.meta.m ?? -1) || (x.meta.amb || 0) - (y.meta.amb || 0) || (y.meta.t || 0) - (x.meta.t || 0) || (y.meta.v ?? -1) - (x.meta.v ?? -1) || x.idx - y.idx;
  // the numbers the keep rule ranks by, from a scan row
  const metaOf = (r) => {
    r = r || {};
    const m = r.frigate_modules;
    return { m: m === null || m === undefined || m === "" ? null : Number(m), amb: r.frigate_modules_ambiguous ? 1 : 0,
      t: (Number(r.crates) || 0) + (Number(r.footlockers) || 0) + (Number(r.briefcases) || 0) + (Number(r.tall_lockers) || 0),
      v: r.items_value == null || r.items_value === "" ? null : Number(r.items_value) };
  };
  const parse = (a) => {
    if (!/^000[0-9A-F]{13}$/.test(String(a || ""))) return null;
    const idx = parseInt(a.slice(3, 6), 16);
    return idx >= 1 && idx <= MAX_IDX ? { idx, g: parseInt(a.slice(6, 8), 16), r: a.slice(8, 16) } : null;
  };
  const addrOf = (idx, g, r) => "000" + idx.toString(16).toUpperCase().padStart(3, "0") + g.toString(16).toUpperCase().padStart(2, "0") + r;

  // ---- the request part ----
  function enc(e, idxs) {
    const bytes = new Uint8Array((idxs[idxs.length - 1] >> 3) + 1);
    let m = "";
    for (const i of idxs) { bytes[i >> 3] |= 1 << (i & 7); m += e.cells.get(i); }
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return { g: e.g, r: e.r, b: btoa(s), m };
  }
  // v157: a part may go when the flag is on, the hold is over and, after a switch-off, the probe time has come
  const ready = () => flagOk() && Date.now() >= hold && (!off || Date.now() >= probeAt);
  const has = (force) => pbits > 0 && (force ? true : ready());
  function take(ver, maxB) {
    if (!has()) return null;
    const limit = Math.min(MAX_BYTES, maxB || MAX_BYTES);
    let v = ver || null;
    if (!v) for (const [k, m] of pend) if (m.size) { v = k; break; }
    const m = v && pend.get(v);
    if (!m || !m.size) return null;
    const part = [], taken = [], cover = [];
    let bits = 0, bytes = 2;
    for (const [key, e] of m) {
      if (part.length >= MAX_REG || bits >= MAX_BITS) break;
      let idxs = [...e.cells.keys()].sort((x, y) => x - y).slice(0, MAX_BITS - bits), ent = enc(e, idxs), sz = JSON.stringify(ent).length + 1;
      while (idxs.length > 1 && bytes + sz > limit) { idxs = idxs.slice(0, idxs.length >> 1); ent = enc(e, idxs); sz = JSON.stringify(ent).length + 1; }
      if (bytes + sz > limit) break;
      part.push(ent); bytes += sz; bits += idxs.length;
      const list = idxs.map((i) => [i, e.cells.get(i)]);
      taken.push([key, e.g, e.r, list]);
      for (const [i] of list) { e.cells.delete(i); cover.push(addrOf(i, e.g, e.r)); }
      if (!e.cells.size) m.delete(key);
    }
    if (!part.length) return null;
    if (!m.size) pend.delete(v);
    pbits -= bits;
    return { ver: v, part, bytes, bits, taken, cover };
  }
  function giveBack(tk) {
    if (!tk) return;
    let m = pend.get(tk.ver);
    if (!m) pend.set(tk.ver, (m = new Map()));
    for (const [key, g, r, list] of tk.taken) {
      let e = m.get(key);
      if (!e) m.set(key, (e = { g, r, cells: new Map() }));
      for (const [i, c] of list) e.cells.set(i, c);
    }
    pbits += tk.bits;
  }
  // the relay body with "scanned" added (unchanged when there is no part)
  function body(json, tk) {
    if (!tk) return json;
    try { const b = JSON.parse(json); b.scanned = tk.part; return JSON.stringify(b); } catch (_) { return json; }
  }
  // what the relay said about the part (res = response.scanned): ok, retry later (rate limited / queue full), or refused for good
  function answer(tk, res, again) {
    if (!tk) return false;
    if (!res || res.ok !== false) {
      stat.parts++; stat.bits += tk.bits; bad400 = 0;
      for (const a of tk.cover) counted.add(a);
      if (off) { off = false; offStep = 0; stat.off = ""; }          // v157: the relay takes the part now (relay 1.4 deployed): culling is back on
      return true;
    }
    const why = String(res.error || "unknown").slice(0, 120);
    if (/rate limited|queue full/i.test(why)) {
      const sec = Math.min(3600, Math.max(5, Math.round(Number(res.retry) || 60)));
      giveBack(tk); hold = Date.now() + sec * 1000;
      if (again) setTimeout(again, sec * 1000 + 50);
      return false;
    }
    // v158: relay 1.4 answers 200/202 with scanned.ok false for these (the rows in the body were taken, so nothing is lost)
    if (/scanned uploads are off/i.test(why)) { giveBack(tk); disable("relay has scanned uploads off"); return false; }
    if (/bad scanned part/i.test(why)) {              // same counter as a 400: give back once and hold 60 s, the second time drop the part; culling stays on
      badRequest(tk, why);
      if (again && bad400 > 0) setTimeout(again, 60050);
      return false;
    }
    disable("the relay refused the scanned part: " + why);
    return false;
  }
  // v157: a 400 for a body that carried the part. Only relay 1.3's unknown-key text switches culling off ("v3: keys must be ..."); every other 400
  // is a whole-body problem (stale fp, bad row, bad part): the part is given back ONCE, the rows go without it, culling stays on. A second 400 in a
  // row for a body with a part drops that part (it would loop for ever) and says so in the log. Returns "off", "again" or "dropped".
  function badRequest(tk, text) {
    if (!tk) return "again";
    if (/v3: keys must be/i.test(String(text || ""))) { giveBack(tk); disable("relay 1.3 does not take the scanned part (HTTP 400: v3: keys must be ...)"); return "off"; }
    if (/scanned uploads are off/i.test(String(text || ""))) { giveBack(tk); disable("relay has scanned uploads off"); return "off"; }   // v158: relay 1.4 with scanned=false: 400 "v4: scanned uploads are off"
    if (++bad400 >= 2) {
      bad400 = 0;
      for (const s of srcs.values()) { try { s.log && s.log("a scanned part was refused twice and dropped: " + String(text || "").slice(0, 120)); } catch (_) {} }
      return "dropped";
    }
    giveBack(tk); hold = Date.now() + 60000;
    return "again";
  }
  // the relay will not take the part (or answered 400 to a body with it): the rows still go, the part is switched off for this page
  function disable(why) {
    off = true; stat.off = why;
    offStep = Math.min(6, offStep + 1); probeAt = Date.now() + offStep * 600000;   // v157: one probe after 10, 20, ... 60 minutes; success turns culling back on
    for (const [k, g] of [...held]) { held.delete(k); release(g, true); }   // nothing was culled yet: every held row goes
    // v157: the pending bits are KEPT (systems already culled on this page still have to be counted): they go as a scanned-only body at the probe
    for (const s of srcs.values()) { try { s.log && s.log("scanned part switched off: " + why); } catch (_) {} }
  }

  // ---- regions and the keep rule ----
  function release(grp, all) {
    const s = srcs.get(grp.src);
    const cells = [...grp.cells.entries()].map(([idx, c]) => ({ idx, ...c })).filter((c) => c.item);
    heldRows -= cells.length;
    let keep;
    if (all || !on()) keep = cells;
    else {
      const k = Math.ceil(grp.n / DIV);                                // n = every system scanned in this region this session
      keep = cells.filter((c) => !c.top).sort(better).slice(0, k);     // top-100 entrants were sent at once and come on top of the k
      stat.culled += cells.length - keep.length;
    }
    stat.kept += keep.length;
    const keptIdx = new Set(keep.map((c) => c.idx));
    for (const [idx, cell] of grp.cells) {                               // v157: every system of this session is decided now
      if (decided.size >= DEC_MAX) break;
      decided.set(addrOf(idx, grp.g, grp.r), cell.item && !keptIdx.has(idx) ? 0 : 1);
    }
    keep.sort((x, y) => x.seq - y.seq);
    if (keep.length && s) { try { s.push(keep.map((c) => c.item)); } catch (_) {} }
  }
  function close(key) { const g = held.get(key); if (g) { held.delete(key); release(g, false); } }
  function end(src) { for (const [k, g] of [...held]) if (!src || g.src === src) close(k); }
  function sweep(now) {
    for (const [k, g] of [...held]) {
      const s = srcs.get(g.src);
      if (now - g.last > IDLE_MS && !(s && s.busy && s.busy(g.key))) close(k);
    }
  }

  function add(src, a, o) {
    if (!on() || !src || !o || !fpOf(String(o.ver || ""))) return false;
    const p = parse(a);
    if (!p) return false;
    const prev = decided.get(a);
    if (prev !== undefined) {                                          // v157: decided in an earlier session of this page: not counted in n or candidates again
      stat.again++;
      if (o.top && prev === 0) { decided.set(a, 1); stat.top++; }      // culled earlier but a top-100 entrant now: the caller sends the row
      return true;                                                      // its bit went out with the first session; a row held back stays held back, a none is sent as before
    }
    const ch = o.item ? modChar(o.meta && o.meta.m) : (o.ch || (o.top ? modChar(o.meta && o.meta.m) : "-"));
    const gkey = p.g.toString(16).toUpperCase().padStart(2, "0") + p.r, key = src + "|" + gkey, now = Date.now();
    // a new region: the earlier ones of this source are finished when no scan of them is running (Contribute) or they were quiet for a moment
    const s = srcs.get(src);
    for (const [k, g] of [...held]) {
      if (g.src !== src || k === key) continue;
      const busy = s && s.busy ? !!s.busy(g.key) : now - g.last < NEAR_IDLE_MS;
      if (!busy) close(k);
    }
    let grp = held.get(key);
    if (!grp) held.set(key, (grp = { key: gkey, src, g: p.g, r: p.r, n: 0, cells: new Map(), last: now }));
    grp.last = now;
    if (grp.cells.has(p.idx)) return true;                             // this system again in the same session: counted once
    grp.n++; stat.scanned++;
    grp.cells.set(p.idx, { c: ch, item: o.item || null, meta: o.meta || {}, top: !!o.top, seq: ++seq });
    if (o.top) { stat.top++; if (decided.size < DEC_MAX) decided.set(a, 1); }
    if (!o.item && !o.top) stat.none++;
    if (o.item) heldRows++;
    // the bit goes out at once with the next request, kept or not
    let m = pend.get(o.ver);
    if (!m) pend.set(o.ver, (m = new Map()));
    let e = m.get(gkey);
    if (!e) m.set(gkey, (e = { g: p.g, r: p.r, cells: new Map() }));
    if (!e.cells.has(p.idx)) { e.cells.set(p.idx, ch); pbits++; }
    while (heldRows > HOLD_MAX) { const first = held.keys().next().value; if (first === key && held.size === 1) break; close(first); }
    return true;                                                       // taken; a none or top-100 system (no item) is still sent by the caller itself
  }

  const reg = (src, h) => srcs.set(src, h || {});
  setInterval(() => { try { sweep(Date.now()); } catch (_) {} }, 10000);
  // the page goes to the background or closes: decide now so the kept rows join the batch the page hands over
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") end(); });
  addEventListener("pagehide", () => end());
  globalThis.dvCull = { on, ready, badRequest, counted: (a) => counted.has(String(a).toUpperCase()), culled: (a) => decided.get(String(a).toUpperCase()) === 0, decidedSize: () => decided.size, metaOf, reg, add, end, has, take, giveBack, body, answer, disable, fpOf, modChar, stats: () => Object.assign({ held: held.size, heldRows, pendingBits: pbits, hold: Math.max(0, hold - Date.now()), on: on(), flag: cfg().relayScanned }, stat), big: () => pbits >= MAX_BITS / 2 };
})();
