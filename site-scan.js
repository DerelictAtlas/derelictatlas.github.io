/* site-scan.js (SITE integration, user 2026-10-31): scan a system in the visitor's browser.
 * - A searched address that is not in the atlas is scanned at once; a direct link gets a "Scan this system" button.
 * - The W29 scanner (scan/scan_w29.wasm, the same engine as the atlas scanner) runs in a fresh Web Worker per scan;
 *   after 120 s the page asks whether to keep waiting (the scan keeps running), Cancel stops the worker.
 * - A looked-up system is sent to the atlas ONLY when it breaks into a top-100 list (user 2026-11-03: "all scans that
 *   are done on anyone else's device to be not uploaded unless they are top 100 ... when they are looking for a system
 *   not when they're using the contribute ... I don't want the uploading to be optional it will just say this system
 *   broke top 100 it will be listed soon"). No choice, no checkbox: a top-100 system is sent at once and the view says
 *   "This system broke the top 100 — it will be listed soon." with its lists (and rank when the atlas rows are loaded);
 *   any other lookup is not sent and the view says nothing about sending. (Contribute still sends every scan.)
 *   With the "Atlas scout" names on (DV_CONFIG.relayFinder, site-finder.js) the notice first asks once for an optional
 *   scout name ("Atlas scout", not the in-game discoverer); the upload goes either way, once: after Add / No thanks, 20 s after the last key, or on leaving.
 *   The body is upload format v3 (2026-11-02, scanner -cc): the saved scan's index + extras lines (scan/v3-lines.js),
 *   no map, to DV_CONFIG.scanRelay; the GitHub Action verifies them before publishing. Without a relay nothing is sent.
 * - An atlas system with numbers but no published map draws its map on opening (user 2026-10-31: no button): the same
 *   scanner runs on the device only to draw the map (the atlas numbers stay, nothing is stored or sent).
 * - An atlas system without loot numbers gets them the same way on opening (user 2026-10-31), shown with a small
 *   progress line on the "Open in" row; a system without a map gets both from one scan. */
(function () {
  "use strict";
  const maps = new Map();       // address -> derelict.json from the scanner (W29c), this page only (maps are not stored)
  // the automatic map draw computes no loot (loot only on request, user 2026-10-31): same row and map, a bit faster
  const MAP_ONLY = { items: false, spook: false };
  const BASE = "scan/", LIMIT_MS = 120000, CACHE_KEY = "dv.scan.v1", SENT_KEY = "dv.scan.sent", MAX_CACHE = 40;
  const cfg = () => globalThis.DV_CONFIG || {};
  const relay = () => String(cfg().scanRelay || "");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const jsonGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const jsonSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  // error log (user 2026-10-31 "needs a log if it fails"): last 50 failures on this device; preview servers also get them
  const LOG_KEY = "dv.scan.log", MAX_LOG = 50;
  function logFailure(entry) {
    const e = Object.assign({ t: new Date().toISOString(), page: location.pathname.split("/").pop() || "index.html", online: navigator.onLine,
      ua: navigator.userAgent.slice(0, 160) }, entry);
    let all = [];
    try { all = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (_) {}
    all.push(e);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(all.slice(-MAX_LOG))); } catch (_) {}
    try { console.warn("[atlas scanner]", e); } catch (_) {}
    const url = (window.DV_CONFIG || {}).scanLogUrl;
    if (url) try { navigator.sendBeacon(url, new Blob([JSON.stringify(e)], { type: "text/plain" })); } catch (_) {}
    return e;
  }
  function logText(n) {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (_) {}
    return all.slice(-(n || MAX_LOG)).map((e) => `${e.t} ${e.page} ${e.address || ""} ${e.step || ""}: ${e.error}${e.online === false ? " (offline)" : ""}${e.attempt ? " [attempt " + e.attempt + "]" : ""}`).join("\n");
  }
  const isNetwork = (msg) => /fetch|network|download|load|HTTP 5|timed? ?out/i.test(String(msg || ""));

  const states = new Map();      // address -> {phase, startedAt, limitAt, asking, error, ms, send, askName}
  const pending = new Map();     // address -> timer id (send after the grace period)
  let open = null;               // {address, unscanned, slim, nomap, noloot}
  let worker = null, ticker = null, manifest = null;

  function loadManifest() {
    if (!manifest) manifest = fetch(BASE + "w29.json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error("scanner not found (" + r.status + ")");
      return r.json();
    }).then((m) => ({ v: String(m.js_sha256 || "").slice(0, 8) + String(m.wasm_sha256 || "").slice(0, 8), version: m.version, wasmBytes: Number(m.wasm_bytes) || 0 }))
      .catch((e) => { manifest = null; throw e; });
    return manifest;
  }
  function cached(address) { return jsonGet(CACHE_KEY, {})[address] || null; }
  function remember(address, data) {
    const all = jsonGet(CACHE_KEY, {});
    all[address] = data;
    const keys = Object.keys(all).sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
    while (keys.length > MAX_CACHE) delete all[keys.shift()];
    jsonSet(CACHE_KEY, all);
  }
  const wasSent = (address) => jsonGet(SENT_KEY, []).includes(address);
  // ---- address check (user 2026-11-01, via scanner -cc: "make a fix so the website tell this to the user, that they
  // looked up an invalid system or a system that doesnt exist in game with some error numbers or words"). RE's proven
  // W29d module (region system count + valid system, 496/496 game cases) runs before any scan, "Scan this system"
  // offer, list card or send. Loaded at the first check, then cached. If it cannot load: today's behaviour (E5, never
  // fail closed). The planet digit is not checked (any 0-F is fine in game).
  const W29D_V = "fb03172ebf393002";   // sha256 prefixes of scan/w29d_rc.js + scan/w29d_rc.wasm (integrate.py checks)
  let rcPromise = null;
  function rcLoad() {
    if (!rcPromise) rcPromise = new Promise((ok, bad) => {
      if (globalThis.W29dRC) return ok(globalThis.W29dRC);
      const s = document.createElement("script");
      s.src = BASE + "w29d_rc.js?v=" + W29D_V;
      s.onload = () => (globalThis.W29dRC ? ok(globalThis.W29dRC) : bad(new Error("W29dRC missing")));
      s.onerror = () => bad(new Error("scan/w29d_rc.js did not load"));
      document.head.appendChild(s);
    }).then((W) => fetch(BASE + "w29d_rc.wasm?v=" + W29D_V).then((r) => {
      if (!r.ok) throw new Error("scan/w29d_rc.wasm " + r.status);
      return r.arrayBuffer();
    }).then((b) => W.load(b)))
      .catch((e) => { logFailure({ what: "address check", error: String((e && e.message) || e) }); return null; });
    return rcPromise;
  }
  const verdicts = new Map();
  // ADDRESS16 = 0 0 P SSS GG YY ZZZ XXX -> {code: 0 valid, 1 bad_coord, 2 core, 3 index_zero, 4 index_range, 5 fault}
  function verdictOf(address) {
    const a = String(address || "").toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(a)) return Promise.resolve({ code: 0 });
    if (!verdicts.has(a)) verdicts.set(a, rcLoad().then((rc) => {
      if (!rc) return { code: 5 };
      const sys = parseInt(a.slice(3, 6), 16), g = parseInt(a.slice(6, 8), 16), lo = parseInt(a.slice(8), 16) >>> 0;
      const code = rc.validSystemUA(g | (sys << 8), lo, true);
      return { code, sys: a.slice(3, 6), n: code === 4 ? rc.regionCountUA(g, lo) : 0 };
    }).catch(() => ({ code: 5 })));
    return verdicts.get(a);
  }
  const isBad = (v) => !!v && v.code >= 1 && v.code <= 4;
  const hex3 = (n) => Math.max(0, n).toString(16).toUpperCase().padStart(3, "0");
  function invalidText(v) {
    if (v.code === 1) return ["E1", "outside the galaxy", "Invalid address: these coordinates are outside the galaxy (portal glyphs can't reach them)."];
    if (v.code === 2) return ["E2", "galaxy core", "No systems here: this region is in the galaxy core."];
    if (v.code === 3) return ["E3", "system 000", "System 000 doesn't exist in-game."];
    return ["E4", "system number too high", `System ${v.sys} doesn't exist: this region's systems are 001–${hex3(v.n - 1)}, plus purple systems 3E8–428.`];
  }
  function invalidHtml(address, v) {
    const [code, word, text] = invalidText(v);
    return `<div class="site-scan-invalid" role="alert"><p class="site-scan-invalid-code"><b>Error ${code}</b> · ${esc(word)}</p>`
      + `<p>${esc(text)}</p><p class="site-scan-note">Nothing was scanned or sent. Check the glyphs for a typo (${esc(address)}).</p></div>`;
  }
  // a system saved on this device before the check existed: checked once; an invalid one is kept out of the list and
  // never sent (its saved numbers are not shown again)
  function markChecked(address, v) {
    if (!v || v.code === 5) return;
    const all = jsonGet(CACHE_KEY, {});
    if (!all[address]) return;
    if (all[address].valid === !isBad(v)) return;
    all[address].valid = !isBad(v);
    if (isBad(v)) all[address].invalid = { code: v.code, sys: v.sys, n: v.n }; else delete all[address].invalid;
    jsonSet(CACHE_KEY, all);
    if (isBad(v)) changed();
  }
  function sweep() {
    const all = jsonGet(CACHE_KEY, {});
    for (const a of Object.keys(all)) if (all[a] && all[a].status === 0 && all[a].valid === undefined) verdictOf(a).then((v) => markChecked(a, v));
  }
  const savedInvalid = (address) => { const c = cached(address); return !!(c && c.valid === false); };
  // galaxy search (user 2026-11-06): the atlas, its top-100 lists and the counts are Galaxy 0 only (address digits 7-8 = 00).
  // A system of another galaxy is scanned and shown here but never sent, never a top-100 break and never in the Systems list.
  const isEuclid = (a) => String(a || "").slice(6, 8) === "00";

  // ---- already in the atlas (v145b, user 2026-11-07: a top-100 system the atlas already lists asked for a scout name and was sent again) ----
  // Two sources, both loaded by the site anyway. (1) The rows it loads at start (dvHome.rows(): the 16 region index shards plus
  // index/singles.csv, so the region files and the visitor scanned singles both count; a pruned row is still a row). (2) What opening
  // the system found (modern.js: a published map, a full row of its region file, or the module count of a slim system, but not a
  // "deferred" system, which the atlas still lacks): the address goes into ATLAS_KNOWN in dvSystemOpened. true = in the atlas,
  // false = not, null = the rows have not arrived yet: then nothing is asked or sent until they have (atlasKnown waits).
  const ATLAS_KNOWN = new Set();
  function atlasHas(address) {
    if (ATLAS_KNOWN.has(address)) return true;
    try {
      const h = globalThis.dvHome && globalThis.dvHome.rows && globalThis.dvHome.rows(), rows = h && h.rows;
      if (!rows || !rows.length) return null;
      for (let i = 0; i < rows.length; i++) if (rows[i].address === address) return true;
      return false;
    } catch (_) { return null; }
  }
  async function atlasKnown(address, ms) {
    const end = Date.now() + ms;
    for (;;) { const k = atlasHas(address); if (k !== null) return k; if (Date.now() > end) return null; await new Promise((x) => setTimeout(x, 300)); }
  }
  const ATLAS_WAIT_MS = 45000;

  // ---- systems scanned on this device in the Systems list (user 2026-10-31) ----
  // tag: "Uploaded" once the address was sent, "Not uploaded yet" while a top-100 system waits to be sent, otherwise
  // "Local only" (only top-100 lookups are sent). modern.js turns the cached rows into list cards (withDeviceRows).
  function tagOf(address, c) { return wasSent(address) ? "Uploaded" : (c.top || []).length && atlasHas(address) === false ? "Not uploaded yet" : "Local only"; }
  const changed = () => { try { if (globalThis.dvDeviceChanged) globalThis.dvDeviceChanged(); } catch (_) {} };
  globalThis.dvDeviceScans = () => Object.entries(jsonGet(CACHE_KEY, {})).filter(([a, c]) => isEuclid(a) && c && c.status === 0 && c.row && c.valid !== false)
    .map(([address, c]) => ({ address, row: c.row, extras: lootShown(address, c) ? c.extras : null, tag: tagOf(address, c) }));
  // loot on request (user 2026-10-31): a top-100 system shows it by default, any other after "Scan loot" (site-loot.js)
  function lootShown(address, c) { return (c.top || []).length > 0 || !!(globalThis.dvLootSaved && globalThis.dvLootSaved(address)); }
  globalThis.dvScannedHere = (address) => { const c = cached(address); return !!(c && c.status === 0 && c.valid !== false); };
  // Near me: the addresses this device already sent, or holds as a top-100 find waiting to be sent (Near me does not scan them again)
  // Near me, every finished Galaxy 0 scan (user 2026-11-07, "the systems get marked ... thusly not wasting a contributors time"): the same
  // upload as Contribute. Queue item {a, ver, row, ext, ms, p, w, sp} (a found system) or {a, ver, ms, w, sp} (no derelict). Batches of
  // up to 60 / 200 KB, one POST at a time, every 15 s and when the scan stops, 429/503 wait Retry-After, 413 halves the batch,
  // the page closing hands the rest to sendBeacon: as in contribute.js. Without a relay nothing is queued.
  // v145b (closing a tab delivered only about 58 KB, so 82 of 143 waiting systems arrived): a system is marked done (Contribute does not
  // scan it) only when the relay has ANSWERED OK for it. What is not confirmed stays in the queue, is saved on this device
  // (dv.near.outbox, newest 1500) and sent again on the next visit; a batch the relay refuses is tried 3 times, then dropped and logged.
  // v149u (a Near me scan at 9 systems/s showed 329, later about 800, systems waiting; cause unknown): every request is timed and logged (see nbInfo),
  // a request with no answer for 30 s is stopped and tried again, a batch holds up to 200 systems (the relay's limit; about 135 KB, under the 200 KB cap)
  // and goes out every 20 s or at 200 waiting, not at every 60: the relay allows 300 requests and 15,000 systems per hour per client (relay.py defaults),
  // and 60 per request at 9/s is about 545 requests an hour. dvNearWhy() gives the panel a plain reason when the queue is long or old.
  const NB = { out: [], inFlight: null, retryAt: 0, maxBytes: 200 * 1024, timer: 0, accepted: 0, handed: [], saveT: 0, stallRun: 0, errRun: 0, durs: [], lastSt: 0, lastErr: false, bgAt: 0, bgBack: 0, t0: 0, by: 0, q0: 0 };
  const NB_BATCH = 60, NB_BATCH_MAX = 200, NB_WATCH = 30000, NB_MAXQ = 5000, NB_KEEPALIVE = 60000, NB_EVERY = 20000, NB_TRIES = 3, NB_REFUSED_WAIT = 300, NB_SAVE_MAX = 1500, NB_KEY = "dv.near.outbox";
  // the saved queue (what the relay has not confirmed): written a moment after every change and at once when the page goes away
  function nbSaveNow() {
    if (NB.saveT) { clearTimeout(NB.saveT); NB.saveT = 0; }
    try {
      const all = [...NB.handed, ...(NB.inFlight || []), ...NB.out].slice(-NB_SAVE_MAX);
      if (all.length) localStorage.setItem(NB_KEY, JSON.stringify(all)); else localStorage.removeItem(NB_KEY);
    } catch (_) {}
  }
  const nbSave = () => { if (!NB.saveT) NB.saveT = setTimeout(() => nbSaveNow(), 1500); };
  // confirmed by the relay: now (and only now) Contribute may skip these systems
  function nbDone(list) {
    const done = jsonGet(DONE_KEY, []), have = new Set(done);
    for (const e of list) if (!have.has(e.a)) done.push(e.a);
    jsonSet(DONE_KEY, done.slice(-40000));
  }
  // a refused batch: tried again NB_TRIES times in all (counted per system, also across visits), then dropped
  function nbRefused(b, status) {
    const keep = [], drop = [];
    for (const e of b) { e.r = (e.r || 0) + 1; (e.r < NB_TRIES ? keep : drop).push(e); }
    if (keep.length) {
      NB.out.unshift(...keep); NB.retryAt = Date.now() + NB_REFUSED_WAIT * 1000; setTimeout(nbFlush, NB_REFUSED_WAIT * 1000 + 50);
      nbLog(keep, 0, "retry", `the relay refused them, HTTP ${status}, try ${keep[0].r} of ${NB_TRIES}`, nbInfo(NB.t0, NB.by, NB.q0, status, NB_REFUSED_WAIT, "refused, tried again later"));
    }
    if (drop.length) nbLog(drop, 3, "refused", `HTTP ${status}, tried ${NB_TRIES} times`, nbInfo(NB.t0, NB.by, NB.q0, status, 0, "dropped, not sent again"));
    nbSave();
  }
  const fpOf = (ver) => (/tables fingerprint ([0-9a-f]{16})\b/.exec(ver) || [])[1] || "";
  // one request, as the log keeps it (v149u): t0 start, ms duration, by bytes, q0 / q1 systems waiting before / after, st HTTP status or "err" or "stall",
  // wt seconds until the next send, wr the reason for that wait. The fields are added to the log line (the old lines have none and stay readable).
  const nbInfo = (t0, by, q0, st, wt, wr) => ({ t0, ms: Date.now() - t0, by, q0, q1: globalThis.dvNearPending(), st, wt, wr });
  function nbLog(list, code, kind, why, info) {
    const pend = jsonGet(PEND_KEY, {}), now = Math.floor(Date.now() / 60000);
    if (code) { for (const e of list) { const had = pend[e.a]; if (code === 2 && had && had[1] === 1) continue; pend[e.a] = [now, code]; } jsonSet(PEND_KEY, pend); }
    const log = jsonGet(UPLOG_KEY, []), last = log[log.length - 1];
    if (last && kind === "retry" && last.k === kind && last.why === (why || "")) { last.n += list.length; last.c = (last.c || 1) + 1; last.t = Date.now(); if (info) Object.assign(last, info, { t0: last.t0 || info.t0 }); }
    else log.push(Object.assign({ t: Date.now(), k: kind, n: list.length, why: why || "" }, info || {}));
    jsonSet(UPLOG_KEY, log.slice(-200));
  }
  function nbTake(limit) {
    const ver = NB.out[0].ver, out = [];
    let bytes = 400 + ver.length + (globalThis.dvPerf && globalThis.dvPerf.on() ? 2048 : 0);
    while (out.length < NB_BATCH_MAX && NB.out.length && NB.out[0].ver === ver) {
      const e = NB.out[0], add = e.row ? e.row.length + e.ext.length + 8 : 21;
      if (out.length && bytes + add > limit) break;
      out.push(NB.out.shift()); bytes += add;
    }
    return out;
  }
  function nbBody(b) {
    const ver = b[0].ver, rows = [], extras = [], none = [];
    for (const e of b) if (e.row) { rows.push(e.row); extras.push(e.ext); } else none.push(e.a);
    let body = JSON.stringify({ v: 3, scanner: ver, fp: fpOf(ver), rows, extras, none });
    const P = globalThis.dvPerf, last = b[b.length - 1];
    if (P && P.on()) body = P.add(body, P.summary(b.map((e) => ({ ms: e.ms, p: e.p })), { workers: last.w || 1, speed: last.sp, src: "contribute" }));
    return body;   // user 2026-11-07 "leave the names out of it": Near me uploads carry no scout name
  }
  function nbDropUnsendable() {
    while (NB.out.length && !fpOf(NB.out[0].ver)) {
      const ver = NB.out[0].ver, gone = [];
      while (NB.out.length && NB.out[0].ver === ver) gone.push(NB.out.shift());
      logFailure({ what: "relay", error: `not sent: scanner version "${ver.slice(0, 80)}" has no tables fingerprint`, n: gone.length });
      nbLog(gone, 4, "notsent", "this scanner version cannot be verified");
    }
  }
  function nbFlush() {
    const url = relay();
    nbDropUnsendable();
    if (!url || NB.inFlight || Date.now() < NB.retryAt || !NB.out.length) return;
    const t0 = Date.now(), q0 = globalThis.dvNearPending();
    const b = NB.inFlight = nbTake(NB.maxBytes), n = b.length, body = nbBody(b), by = body.length;
    Object.assign(NB, { t0, by, q0 });   // for nbRefused
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const watch = ac ? setTimeout(() => ac.abort(), NB_WATCH) : 0;
    const durOf = () => { NB.durs.push(Date.now() - t0); if (NB.durs.length > 5) NB.durs.shift(); };
    // after a failed request: the batch goes back to the front, the next send waits sec seconds, the log says why
    const retry = (sec, st, wr, why) => {
      NB.out.unshift(...b); NB.retryAt = Date.now() + sec * 1000; setTimeout(nbFlush, sec * 1000 + 50);
      nbLog(b, 0, "retry", why, nbInfo(t0, by, q0, st, sec, wr));
    };
    // no keepalive here (v149u): Chrome counts keepalive bodies against a 64 KB quota per page and fails the NEXT request at once ("Failed to fetch" after 20 ms,
    // measured: a 60-system body is about 42 KB and the one sent right after a 2xx failed, then waited 60 s as "no connection"); a closing page is handled by nbLast (sendBeacon)
    fetch(url, { method: "POST", body, mode: "cors", headers: { "Content-Type": "text/plain" }, signal: ac ? ac.signal : undefined })
      .then((r) => {
        clearTimeout(watch); NB.inFlight = null; NB.stallRun = 0; NB.errRun = 0; NB.lastSt = r.status; NB.lastErr = false; durOf();
        if (r.ok) {
          NB.accepted += n; nbDone(b); nbSave(); changed();
          nbLog(b, 1, "sent", "", nbInfo(t0, by, q0, r.status, 0, NB.out.length >= NB_BATCH ? "more waiting, sent at once" : "next batch at 200 waiting or after 20 s"));
          if (NB.out.length >= NB_BATCH) nbFlush();   // a long queue goes out back to back; a short one waits for the timer (fewer requests)
          return;
        }
        if (r.status === 429 || r.status === 503) { const sec = Math.min(3600, Math.max(5, parseInt(r.headers.get("Retry-After"), 10) || 60)); retry(sec, r.status, "the relay asked for it (Retry-After)", "the relay is busy, HTTP " + r.status); return; }
        if (r.status === 413 && NB.maxBytes > 16384) { NB.maxBytes = Math.max(16384, NB.maxBytes >> 1); retry(0, r.status, `too big: batch limit halved to ${NB.maxBytes >> 10} KB`, "the relay said the batch was too big, HTTP 413"); return; }
        nbRefused(b, r.status);
        r.text().catch(() => "").then((why) => logFailure({ what: "relay", status: r.status, n, error: String(why || "").slice(0, 300) }));
      })
      .catch((err) => {
        clearTimeout(watch); NB.inFlight = null; durOf();
        if (ac && ac.signal.aborted) {   // no answer for 30 s: stopped; tried again at once the first time, after 60 s if it happens again
          NB.stallRun++; NB.lastErr = true; NB.lastSt = 0;
          const sec = NB.stallRun >= 2 ? 60 : 0;
          retry(sec, "stall", sec ? "no answer again, waiting" : "no answer in 30 s, trying again at once", "no answer from the relay in 30 s");
          logFailure({ what: "relay", error: "no answer in 30 s", n });
          return;
        }
        NB.lastErr = true; NB.lastSt = 0; NB.errRun++;
        const wait = NB.errRun >= 2 ? 60 : 10;   // the first failure is tried again after 10 s, repeated ones after 60 s
        retry(wait, "err", "no connection, waiting", "no connection to the relay");
        logFailure({ what: "relay", error: String(err && err.message || err), n });
      });
  }
  function nbLast() {
    const url = relay();
    if (!url) return;
    if (NB.inFlight) { NB.out.unshift(...NB.inFlight); NB.inFlight = null; }
    nbDropUnsendable();
    nbSaveNow();   // the page is going: everything the relay has not confirmed is kept for the next visit, whatever the beacon does
    while (NB.out.length) {
      const b = nbTake(NB_KEEPALIVE - 2000);
      let handed = false;
      try { handed = navigator.sendBeacon && navigator.sendBeacon(url, new Blob([nbBody(b)], { type: "text/plain" })); } catch (_) {}
      NB.handed.push(...b);   // not confirmed: still saved, and queued again if the page comes back
      nbLog(b, handed ? 2 : 4, handed ? "handed" : "notsent", handed ? "" : "the browser would not send them as the page closed");
      nbDropUnsendable();
    }
  }
  addEventListener("pagehide", nbLast);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { NB.bgAt = Date.now(); nbLast(); }
    else if (NB.bgAt && (NB.bgBack = Date.now()) && NB.handed.length) { NB.out.unshift(...NB.handed); NB.handed = []; nbFlush(); }   // the page was only hidden: send what was handed over again
  });
  globalThis.dvNearQueue = (item) => {
    if (!relay() || !isEuclid(item && item.a) || !item.ver) return false;
    if (NB.out.length >= NB_MAXQ) NB.out.shift();
    if (!item.q) item.q = Date.now();
    NB.out.push(item);
    if (!NB.timer) NB.timer = setInterval(nbFlush, NB_EVERY);
    nbSave();
    if (NB.out.length >= NB_BATCH_MAX) nbFlush();
    return true;
  };
  globalThis.dvNearFlush = () => nbFlush();
  globalThis.dvNearPending = () => NB.out.length + NB.handed.length + (NB.inFlight ? NB.inFlight.length : 0);
  // what the relay has really accepted since this page opened (a 2xx answer), and what still waits; accepted is not "in the atlas": the update job runs later
  // a plain reason for a long or old queue (more than 300 waiting, or the oldest has waited over 60 s); "" when all is well
  globalThis.dvNearWhy = () => {
    const now = Date.now(), first = NB.handed[0] || (NB.inFlight || [])[0] || NB.out[0];
    if (!first || (globalThis.dvNearPending() <= 300 && !(first.q && now - first.q > 60000))) return "";
    if (now < NB.retryAt && (NB.lastSt === 429 || NB.lastSt === 503)) return `the relay is busy, waiting ${Math.ceil((NB.retryAt - now) / 1000)} s`;
    if (NB.lastErr && (now < NB.retryAt || NB.inFlight)) return "no connection to the relay";
    if (document.visibilityState === "hidden" || (NB.bgBack && now - NB.bgBack < 90000)) return "the tab was in the background";
    const d = NB.durs.slice(-3), run = NB.inFlight ? (now - NB.t0) : 0, avg = d.length ? d.reduce((x, y) => x + y, 0) / d.length : 0, top = Math.max(avg, run);
    if (top > 6000) return `slow answers from the relay (${Math.round(top / 1000)} s per request)`;
    return "sending is catching up";
  };
  globalThis.dvNearStats = () => ({ accepted: NB.accepted, waiting: globalThis.dvNearPending() });
  globalThis.dvFindRecord = () => {
    const out = new Set(jsonGet(SENT_KEY, []));
    for (const [a, c] of Object.entries(jsonGet(CACHE_KEY, {}))) if (isEuclid(a) && c && c.status === 0 && c.valid !== false && (c.top || []).length) out.add(a);
    return out;
  };
  // Near me: data = the full scan of one system (scan/scan-worker.js, loot included, like a lookup). Returns {top: [labels], queued: bool}.
  // Galaxy 0 only; a system that breaks no list, or was sent already, is neither saved nor sent. Needs the relay, else nothing happens.
  globalThis.dvUploadFind = async (address, data) => {
    address = String(address || "").toUpperCase();
    if (!relay() || !isEuclid(address) || !data || data.status !== 0 || !data.row) return { top: [], queued: false };
    if (wasSent(address)) return { top: [], queued: false, sent: true };
    const known = await atlasKnown(address, ATLAS_WAIT_MS);   // v145b: the atlas has it already, or its rows are not here: no upload
    if (known === true) return { top: [], queued: false, sent: true };
    if (known === null) return { top: [], queued: false, held: true };
    const T = globalThis.dvTopLists, lists = T ? await T.load().catch(() => null) : null;
    const top = lists ? T.breaks(data.row, data.extras, lists) : [];
    if (!top.length) return { top: [], queued: false };
    const v = await verdictOf(address);
    if (isBad(v)) return { top: [], queued: false };
    const entry = { status: 0, row: data.row, extras: data.extras, loot: data.loot || null, version: data.version, top, ms: Math.round(Number(data.ms)) || null, at: Date.now(), valid: true, asked: true };
    remember(address, entry);
    changed();
    NEAR_UP.add(address);
    states.set(address, Object.assign(states.get(address) || { phase: "done" }, { send: true }));
    schedule(address);
    return { top: top.map((t) => t.label), queued: true };
  };

  // ---- sending (address only, once, at once; user 2026-11-01 "i'd like this to be instant") ----
  // a CORS fetch (text/plain = no preflight) so the relay's answer is readable: "Sent" only after a 2xx
  function markSent(address, handed) {
    const sent = jsonGet(SENT_KEY, []);
    if (!sent.includes(address)) { sent.push(address); jsonSet(SENT_KEY, sent.slice(-500)); }
    if (NEAR_UP.has(address)) nearRecord(address, handed);
    changed();
  }
  // ---- Near me finds (site-near.js, user 2026-11-07: "i want the top 100 to be uploaded and every system that is uploaded to be marked
  // as scanned so its not rescanned") ----
  // A system the Near me scan finds in a top-100 list is saved and sent exactly like a lookup that breaks a top 100: same rule
  // (site-toplists.js), same saved scan (dv.scan.v1), same sent record (dv.scan.sent), same body (upload format v3) and same retry.
  // No name prompt and no scout name (user 2026-11-07 "leave the names out of it"); the saved name is left alone and the viewer still uses it for lookups.
  // Once the relay has answered, the address also goes into Contribute's records (done, send record, upload log) so Contribute
  // does not scan it again and its "Your uploads" card counts it. No source label: the upload log has none.
  const NEAR_UP = new Set(), DONE_KEY = "dv.contrib.done", PEND_KEY = "dv.contrib.pending", UPLOG_KEY = "dv.contrib.uplog";
  function nearRecord(address, handed) {
    NEAR_UP.delete(address);
    if (!handed) NB.accepted++;
    const done = jsonGet(DONE_KEY, []);
    if (!done.includes(address)) { done.push(address); jsonSet(DONE_KEY, done.slice(-40000)); }
    const pend = jsonGet(PEND_KEY, {});
    pend[address] = [Math.floor(Date.now() / 60000), handed ? 2 : 1];   // Contribute's codes: 1 sent (relay answered), 2 handed to the browser
    jsonSet(PEND_KEY, pend);
    const log = jsonGet(UPLOG_KEY, []);
    log.push({ t: Date.now(), k: handed ? "handed" : "sent", n: 1, why: "" });
    jsonSet(UPLOG_KEY, log.slice(-200));
  }
  // earlier visit(s): systems the relay never confirmed are queued again (Euclid only, not done meanwhile, refused fewer than NB_TRIES times)
  (function nbRestore() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(NB_KEY)) || []; } catch (_) {}
    if (!Array.isArray(saved) || !saved.length) return;
    const done = new Set(jsonGet(DONE_KEY, [])), seen = new Set();
    for (const e of saved) {
      if (!e || typeof e.a !== "string" || !/^[0-9A-F]{16}$/.test(e.a) || !isEuclid(e.a) || typeof e.ver !== "string" || !fpOf(e.ver)) continue;
      if (e.row !== undefined && (typeof e.row !== "string" || typeof e.ext !== "string")) continue;
      if (done.has(e.a) || seen.has(e.a) || (e.r || 0) >= NB_TRIES) continue;
      seen.add(e.a); NB.out.push(e);
    }
    if (!NB.out.length) { nbSaveNow(); return; }
    NB.timer = setInterval(nbFlush, NB_EVERY);
    setTimeout(nbFlush, 4000);
  })();
  // v3 upload (2026-11-02): scan/v3-lines.js builds the lines; the body names the scanner version the scan was made with
  let v3lib = null;
  function v3Load() {
    if (!v3lib) v3lib = loadManifest().then((m) => new Promise((ok, bad) => {
      if (globalThis.DvV3) return ok(globalThis.DvV3);
      const s = document.createElement("script");
      s.src = BASE + "v3-lines.js?v=" + encodeURIComponent(m.v);
      s.onload = () => (globalThis.DvV3 ? ok(globalThis.DvV3) : bad(new Error("DvV3 missing")));
      s.onerror = () => bad(new Error("loading scan/v3-lines.js failed"));
      document.head.appendChild(s);
    })).catch((e) => { v3lib = null; throw e; });
    return v3lib;
  }
  // the relay body for one saved scan (throws when it cannot be built: never an invalid row)
  function v3Body(address) {
    const V = globalThis.DvV3, c = cached(address);
    if (!V) throw new Error("upload format not loaded");
    if (!c || c.status !== 0 || !c.row) throw new Error("this scan is no longer saved on this device");
    if (!V.fingerprint(c.version)) throw new Error("scanner version without a tables fingerprint");
    const l = V.lines(address, c.row, c.extras);
    let body = V.body(c.version, [l.row], [l.extras], []);
    // the scan speed (site-perf.js, DV_CONFIG.relayPerf): the scanner's own time for this one system
    const P = globalThis.dvPerf;
    if (P && P.on() && c.ms) body = P.add(body, P.summary([{ ms: c.ms, p: c.row.preset }], { workers: 1, src: "lookup" }));
    return c.finder && globalThis.dvFinder ? globalThis.dvFinder.add(body, c.finder) : body;
  }
  // ---- the optional finder name of a top-100 lookup (asked once; never blocks or doubles the upload) ----
  const ASK_MS = 20000;
  const asks = new Map();        // address -> timer: the name prompt is open, the upload waits for it (20 s at most)
  const finderOn = () => !!(globalThis.dvFinder && globalThis.dvFinder.on() && relay());
  function ask(address) {
    const st = states.get(address);
    if (!st || wasSent(address) || asks.has(address) || !isEuclid(address) || atlasHas(address) !== false) return;
    v3Load().catch(() => {});
    st.askName = true;
    asks.set(address, setTimeout(() => release(address, ""), ASK_MS));
  }
  function release(address, name) {
    if (!asks.has(address)) return;
    clearTimeout(asks.get(address)); asks.delete(address);
    const st = states.get(address);
    if (st) st.askName = false;
    const all = jsonGet(CACHE_KEY, {});
    if (all[address]) { all[address].asked = true; if (name) all[address].finder = name; else delete all[address].finder; jsonSet(CACHE_KEY, all); }
    schedule(address);
    render();
  }
  function send(address) {
    clearTimeout(pending.get(address));
    pending.delete(address);
    const url = relay(), st = states.get(address);
    if (!url || !isEuclid(address) || !(st && st.send) || wasSent(address) || st.sending || savedInvalid(address)) return;
    const known = atlasHas(address);
    if (known === true) { st.send = false; return; }
    if (known === null) { atlasKnown(address, ATLAS_WAIT_MS).then((k) => { if (k === false) send(address); }); return; }   // wait for the rows, never send blind
    st.sending = true; st.sendError = "";
    v3Load().then(() => v3Body(address)).catch((e) => {
      st.sending = false; st.sendError = "could not prepare the upload";
      logFailure({ what: "relay", address, step: "upload", error: String(e && e.message || e) }); render();
      return null;
    }).then((body) => body && fetch(url, { method: "POST", body, keepalive: body.length < 60000, mode: "cors", headers: { "Content-Type": "text/plain" } })
      .then((r) => {
        st.sending = false;
        if (r.ok) { markSent(address); render(); return; }
        if (r.status === 429 || r.status === 503) { const s = Math.min(3600, Math.max(5, parseInt(r.headers.get("Retry-After"), 10) || 60)); st.sendError = "busy"; pending.set(address, setTimeout(() => send(address), s * 1000)); render(); return; }
        st.sendError = `the atlas relay answered ${r.status}`; render();
        r.text().catch(() => "").then((why) => logFailure({ what: "relay", address, status: r.status, error: String(why || "").slice(0, 300) }));
      })
      .catch((err) => { st.sending = false; st.sendError = "could not reach the atlas relay"; logFailure({ what: "relay", address, error: String(err && err.message || err) }); render(); }));
    render();
  }
  // a top-100 system found earlier and not sent yet (never one the atlas has)
  function sendTop(address, c) {
    const s = Object.assign(states.get(address) || { phase: "done" }, { send: true }); states.set(address, s);
    if (finderOn() && !c.asked) ask(address); else schedule(address);
  }
  function dropTop(address) {
    const all = jsonGet(CACHE_KEY, {});
    if (all[address]) { all[address].top = []; jsonSet(CACHE_KEY, all); }
    const s = states.get(address); if (s) s.send = false;
    changed();
  }
  function schedule(address) {
    if (!relay() || !isEuclid(address) || wasSent(address) || pending.has(address) || asks.has(address) || savedInvalid(address)) return;
    v3Load().catch(() => {});   // ready for a last-chance sendBeacon too
    verdictOf(address).then((v) => { if (!isBad(v)) send(address); else markChecked(address, v); });
  }
  // leaving the page while a retry waits: last chance by sendBeacon (its answer cannot be read)
  function flushAll() {
    const url = relay();
    // a name prompt still open: the upload goes now, without a name
    for (const a of [...asks.keys()]) { clearTimeout(asks.get(a)); asks.delete(a); const s = states.get(a); if (s) s.askName = false; if (!wasSent(a)) pending.set(a, 0); }
    for (const a of [...pending.keys()]) {
      clearTimeout(pending.get(a)); pending.delete(a);
      if (savedInvalid(a) || !isEuclid(a) || atlasHas(a) !== false) continue;
      let body = null;
      try { body = v3Body(a); } catch (e) { logFailure({ what: "relay", address: a, step: "upload", error: String(e && e.message || e) }); continue; }
      try { if (url && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) markSent(a, true); } catch (_) {}
    }
  }
  addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });

  // ---- scanning ----
  function stopWorker() {
    if (worker) { worker.terminate(); worker = null; }
    clearInterval(ticker); ticker = null;
  }
  function start(address, attempt) {
    stopWorker();
    const prev = states.get(address);
    const now = Date.now(), st = { phase: "scanning", mode: open && (open.nomap || open.redraw) ? "map" : "scan", attempt: attempt || 1, startedAt: now, limitAt: now + LIMIT_MS, asking: false };
    if (prev) for (const k of ["send", "sending", "sendError", "askName"]) if (prev[k] !== undefined) st[k] = prev[k];
    states.set(address, st);
    st.step = "download"; st.loaded = 0; st.total = 0; st.stepAt = now;
    ticker = setInterval(() => {
      if (st.phase !== "scanning" && st.phase !== "drawing") return;
      if (!st.asking && Date.now() > st.limitAt) st.asking = true;
      render();
    }, 200);
    render();
    loadManifest().then((m) => {
      if (states.get(address) !== st || st.phase !== "scanning") return;
      worker = new Worker(BASE + "scan-worker.js?v=" + encodeURIComponent(m.v));
      st.total = m.wasmBytes;
      worker.onmessage = (e) => (e.data && e.data.type === "progress" ? progress(address, st, e.data) : finish(address, st, e.data));
      worker.onerror = (e) => { e.preventDefault(); finish(address, st, { ok: false, step: "worker", error: "loading the scanner (scan-worker.js, w29_scan.js): " + (e.message || "failed") }); };
      worker.postMessage({ address, retry: st.attempt > 1, wasmBytes: m.wasmBytes, options: st.mode === "map" ? MAP_ONLY : undefined });
    }).catch((e) => finish(address, st, { ok: false, step: "manifest", error: "downloading the scanner info (scan/w29.json): " + e.message }));
  }
  function progress(address, st, d) {
    if (states.get(address) !== st || st.phase !== "scanning") return;
    if (d.step !== st.step) { st.step = d.step; st.stepAt = Date.now(); }
    if (d.step === "download") { st.loaded = d.loaded || 0; if (d.total) st.total = d.total; }
    render();
  }
  // the map step: shown until the viewer has drawn the map (or failed)
  function drawing(address, st, data, run) {
    st.phase = "drawing"; st.step = "map"; st.stepAt = Date.now(); st.summary = data.row || null;
    render();
    // half a second to read what was found, then the map is built
    new Promise((ok) => setTimeout(ok, 500)).then(() => (states.get(address) === st ? run() : false)).then((ok) => {
      if (states.get(address) !== st || st.phase !== "drawing") return;
      stopWorker();
      if (ok || st.mode !== "map") st.phase = "done"; else { st.phase = "error"; st.error = "the map could not be drawn"; }
      render();
    });
  }
  function cancel(address) {
    const st = states.get(address);
    stopWorker();
    if (st && st.phase === "scanning") st.phase = "cancelled";
    render();
  }
  async function finish(address, st, data) {
    if (states.get(address) !== st || st.phase !== "scanning") return;
    if (worker) { worker.terminate(); worker = null; }
    st.ms = Date.now() - st.startedAt;
    if (!data.ok) {
      logFailure({ address, mode: st.mode, step: data.step || "", error: data.error || "unknown error", attempt: st.attempt });
      // network trouble: try twice more (fresh download), then show the error with the log
      if (isNetwork(data.error) && st.attempt < 3) {
        st.retrying = true;
        render();
        setTimeout(() => { if (states.get(address) === st && open && open.address === address) start(address, st.attempt + 1); }, 1500 * st.attempt);
        return;
      }
      stopWorker();
      st.phase = "error"; st.error = data.error; render(); return;
    }
    if (st.mode === "map") {
      if (data.status !== 0 || !data.derelict) { stopWorker(); st.phase = "error"; st.error = data.status === 4 ? "unexpected" : "no map came back"; if (data.status === 4) logFailure({ address, mode: st.mode, step: "scan", error: "status 4 (no abandoned freighter): unexpected, every real system has one (RE W31)" }); render(); return; }
      maps.set(address, data.derelict);
      drawing(address, st, data, () => (open && open.address === address && open.redraw ? show(address) : showMap(address)));
      return;
    }
    // status 4 never happens for a real system (RE W31): an unexpected result, logged, not "no freighter"
    if (data.status === 4) { stopWorker(); logFailure({ address, mode: st.mode, step: "scan", error: "status 4 (no abandoned freighter): unexpected, every real system has one (RE W31)" }); st.phase = "error"; st.error = "unexpected"; render(); return; }
    if (data.status !== 0) { stopWorker(); st.phase = "error"; st.error = "scanner status " + data.status; render(); return; }
    if (data.derelict) maps.set(address, data.derelict);
    // the top-100 rule (site-toplists.js, the same as the Action): only a system that breaks into a list is sent
    const T = globalThis.dvTopLists, lists = T ? await T.load().catch(() => null) : null;
    let top = lists && isEuclid(address) ? T.breaks(data.row, data.extras, lists) : [];
    if (top.length && T.rank) try { top = T.rank(data.row, data.extras, lists, top, globalThis.dvHome && globalThis.dvHome.rows ? globalThis.dvHome.rows() : null); } catch (_) {}
    // v145b: a system the atlas already has is not "new to the atlas": no "broke the top 100" box, no scout name, no upload. Rows not loaded
    // yet: wait for them; if they never arrive nothing is asked or sent for this system (a missing list must not cause a send).
    if (top.length) { const known = await atlasKnown(address, ATLAS_WAIT_MS); if (known !== false) top = []; }
    if (states.get(address) !== st) return;
    remember(address, { status: 0, row: data.row, extras: data.extras, loot: data.loot || null, version: data.version, top, ms: Math.round(Number(data.ms)) || null, at: Date.now(), valid: true });
    changed();
    if (top.length) { st.send = true; if (finderOn()) ask(address); else schedule(address); }
    if (data.derelict) drawing(address, st, data, () => show(address));
    else { stopWorker(); st.phase = "done"; show(address); }
  }
  function show(address) {
    const c = cached(address);
    if (c && c.status === 0 && globalThis.dvShowScanned) return globalThis.dvShowScanned(address, c.row, lootShown(address, c) ? c.extras : null, maps.get(address) || null);
    render();
    return Promise.resolve(false);
  }

  function showMap(address) {
    return Promise.resolve(globalThis.dvShowMap ? globalThis.dvShowMap(address, maps.get(address)) : false);
  }

  // ---- the panel in the viewer notice ----
  function secs(ms) { return Math.max(0, Math.round(ms / 1000)) + " s"; }
  // download 0-30 % (real bytes), start 30-35 %, generate 35-90 % (time based: the engine reports nothing inside the
  // call yet), map 90-100 % (done when the viewer shows the map). Shown as scanning only (user 2026-11-02): the
  // download is not a visible step, it is part of "Starting the scanner"; the info page Scanning tab explains it.
  const STEPS = ["download", "start", "scan", "map"];
  function percent(st) {
    const now = Date.now(), i = STEPS.indexOf(st.step);
    if (st.step === "download") return st.total ? 30 * Math.min(1, st.loaded / st.total) : Math.min(25, (now - st.startedAt) / 200);
    if (st.step === "start") return 30 + 5 * Math.min(1, (now - st.stepAt) / 400);
    if (st.step === "scan") return 35 + 55 * (1 - Math.exp(-(now - st.stepAt) / 1800));
    if (st.step === "map") return 90 + 9 * (1 - Math.exp(-(now - st.stepAt) / 600));
    return i < 0 ? 0 : 100;
  }
  function stepsHtml(st, map) {
    const at = Math.max(0, STEPS.indexOf(st.step) - 1), now = Date.now(), r = st.summary;   // download + start = row 0
    const found = r ? [r.preset && String(r.preset).replace(/_/g, " ").toLowerCase(), r.rooms != null && r.rooms + " rooms",
      ((r.crates || 0) + (r.footlockers || 0) + (r.briefcases || 0) + (r.tall_lockers || 0)) + " containers",
      r.frigate_modules != null && r.frigate_modules + (r.frigate_modules_ambiguous ? "?" : "") + " Salvaged Frigate Module" + (r.frigate_modules === 1 ? "" : "s")].filter(Boolean).join(" · ") : "";
    const rows = [
      ["Starting the scanner", ""],
      [map ? "Generating the layout" : "Generating the derelict", at === 1 ? secs(now - st.stepAt) : found],
      ["Building the 3D and 2D map", ""],
    ];
    return `<ol class="site-scan-steps">${rows.map(([label, note], i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}"><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ""}</li>`).join("")}</ol>`;
  }
  function panelHtml(address, st) {
    const map = st ? st.mode === "map" : open.nomap;
    if (!st && map) return `<div class="site-scan-progress" role="status"><span class="site-scan-spin" aria-hidden="true"></span>Drawing map on your device</div>`;
    if (!st) {
      if (open.slim) return `<p>The atlas has only the module count of this system.</p><button id="site-scan-start" class="primary" type="button">Scan for full details</button><p class="site-scan-note">Runs on your device, usually in a few seconds.</p>`;
      return `<p>This system is not in the atlas yet.</p><button id="site-scan-start" class="primary" type="button">Scan this system</button><p class="site-scan-note">Runs on your device, usually in a few seconds.</p>`;
    }
    if (st.phase === "scanning" && st.retrying) return `<div class="site-scan-progress" role="status"><span class="site-scan-spin" aria-hidden="true"></span>Connection problem, trying again…</div>`;
    if (st.phase === "scanning" || st.phase === "drawing") {
      const ask = st.asking && st.phase === "scanning" ? `<p class="site-scan-ask">Still scanning. Keep waiting?</p><button id="site-scan-wait" type="button">Keep waiting</button>` : "";
      const pct = Math.floor(percent(st));
      return `<div class="site-scan-run"><div class="site-scan-progress" role="status"><span class="site-scan-spin" aria-hidden="true"></span>${map ? "Drawing map on your device" : "Scanning on your device"}<b class="site-scan-pct">${pct} %</b></div>`
        + `<div class="site-scan-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>${stepsHtml(st, map)}</div>`
        + `${ask}${st.phase === "scanning" && !map ? `<button id="site-scan-cancel" type="button">Cancel</button>` : ""}`;
    }
    if (st.phase === "error" && st.error === "unexpected") return `<p><b>Unexpected result.</b> The scanner found no abandoned freighter here, which should not happen for a real system. Please report this address (copy the error log below).</p><button id="site-scan-start" class="primary" type="button">Try again</button>`
      + `<details class="site-scan-log"><summary>Error log</summary><pre>${esc(logText(8))}</pre><button id="site-scan-copylog" type="button">Copy log</button></details>`;
    if (st.phase === "cancelled") return map ? `<p>The map was not drawn. Open the system again to draw it.</p>` : `<p>Scan cancelled.</p><button id="site-scan-start" class="primary" type="button">Scan again</button>`;
    // network trouble: a plain headline (the technical text stays in the error log below)
    if (st.phase === "error") return `<p>${isNetwork(st.error) ? (map ? "The map could not be drawn (network problem). Try again." : "The scanner couldn't start (network problem). Try again.") : `${map ? "The map could not be drawn" : "The scan did not finish"} (${esc(st.error || "unknown error")}).`}</p><button id="site-scan-start" class="primary" type="button">Try again</button>`
      + `<details class="site-scan-log"><summary>Error log</summary><pre>${esc(logText(8))}</pre><button id="site-scan-copylog" type="button">Copy log</button></details>`;
    return "";
  }
  function topNames(c) { return (c && c.top || []).map((t) => t.label); }
  const listText = (c) => (c && c.top || []).map((t) => t.label + (t.rank ? " #" + t.rank : "")).join(" · ");
  const ASK_NOTE = "Optional. Shown publicly as “Atlas scout” if this system is new to the atlas (not the in-game discoverer).";
  // a scanned system: the "Scanned on this device" tag; a top-100 one also gets the notice (nothing about sending
  // otherwise: only top-100 lookups are sent)
  function consentHtml(address) {
    const st = states.get(address) || {}, url = relay(), c = cached(address), top = atlasHas(address) === false ? topNames(c) : [], lists = listText(c);
    const tag = `<div class="site-scan-row"><span class="site-scan-tag${top.length ? " top" : ""}" title="${top.length ? esc("Top 100: " + lists) : "Scanned in your browser"}">${top.length ? "★ Top 100 · " : ""}Scanned on this device</span></div>`;
    if (!top.length) return tag;
    let ask = "";
    if (st.askName && asks.has(address)) {
      const name = globalThis.dvFinder ? globalThis.dvFinder.saved() : "";
      ask = `<div class="site-scan-finder"><label for="site-scan-finder">Add your name as the Atlas scout?</label>`
        + `<span class="site-scan-finder-row"><input id="site-scan-finder" type="text" maxlength="40" spellcheck="false" autocomplete="nickname" placeholder="Your name" value="${esc(name)}">`
        + `<button id="site-scan-finder-add" type="button" class="primary">Add</button><button id="site-scan-finder-no" type="button">No thanks</button></span>`
        + `<small id="site-scan-finder-msg" class="site-scan-finder-msg">${ASK_NOTE}</small></div>`;
    } else if (c && c.finder) ask = `<p class="site-scan-finder-done">Atlas scout: <b>${esc(c.finder)}</b></p>`;
    const problem = !wasSent(address) && st.sendError
      ? `<p class="site-scan-finder-msg">${st.sendError === "busy" ? "The atlas is busy, sending again shortly…" : `Not sent yet: ${esc(st.sendError)} <button id="site-scan-resend" type="button" class="site-scan-more">Retry</button>`}</p>` : "";
    return `${tag}<div class="site-scan-top100" role="status"><p><b>★ This system broke the top 100</b>${url ? " — it will be listed soon." : "."}</p>`
      + `<p class="site-scan-lists">${esc(lists)}</p>${ask}${problem}</div>`;
  }

  // the visitor is typing a finder name: the box is not rebuilt (it would lose the text)
  const typing = (box) => { const a = document.activeElement; return !!(a && a.id === "site-scan-finder" && box.contains(a) && open && asks.has(open.address)); };
  function render() {
    if (!open) return;
    const content = document.getElementById("viewer-content");
    const notice = content && content.querySelector(":scope .notice");
    const address = open.address, st = states.get(address), c = cached(address);
    if (!notice) {
      // scanned system shown with its map: label + consent on the "Open in" line
      const strip = content && content.querySelector(".identity-strip .glyph-address");
      if (!strip || !c || c.status !== 0) return;
      let box = strip.querySelector("#site-scan");
      if (!box) { box = document.createElement("div"); box.id = "site-scan"; box.className = "site-scan site-scan-inline"; strip.appendChild(box); }
      const html = consentHtml(address);
      if (box.innerHTML !== html && !typing(box)) box.innerHTML = html;
      return;
    }
    let html;
    if (open.invalid) {
      html = invalidHtml(address, open.invalid);
      const h2 = notice.querySelector("h2");
      if (h2 && h2.textContent !== "Invalid address") h2.textContent = "Invalid address";
      notice.querySelectorAll(":scope > p").forEach((q) => { q.hidden = true; });
    }
    else if (st && (st.mode === "map" || st.phase === "drawing")) html = panelHtml(address, st);
    else if (c && c.status === 0 && (!st || st.phase === "done")) html = consentHtml(address);
    else if (open.unscanned || open.slim || open.nomap || st) html = panelHtml(address, st);
    else return;
    let box = notice.querySelector("#site-scan");
    if (!box) {
      box = document.createElement("div");
      box.id = "site-scan";
      box.className = "site-scan";
      const p = notice.querySelector("p");
      (p || notice.querySelector("h2") || notice.firstChild) ? (p || notice.querySelector("h2")).after(box) : notice.prepend(box);
    }
    if (box.innerHTML !== html && !typing(box)) box.innerHTML = html;
    if (!c || c.status !== 0) notice.querySelectorAll(":scope > p:not(.site-scan p)").forEach((p) => {
      if (/not scanned yet|no published full layout/i.test(p.textContent)) p.hidden = true;
    });
  }
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("button, input") : null;
    if (!t || !open || !t.closest("#site-scan")) return;
    const address = open.address, st = states.get(address);
    if (t.id === "site-scan-start") start(address);
    else if (t.id === "site-scan-copylog") { try { navigator.clipboard.writeText(logText()).then(() => { t.textContent = "Copied"; }); } catch (_) {} }
    else if (t.id === "site-scan-cancel") cancel(address);
    else if (t.id === "site-scan-wait" && st) { st.asking = false; st.limitAt = Date.now() + LIMIT_MS; render(); }
    else if (t.id === "site-scan-resend") { if (st) send(address); }
    else if (t.id === "site-scan-finder-add") addName(address);
    else if (t.id === "site-scan-finder-no") release(address, "");
  });
  function addName(address) {
    const input = document.getElementById("site-scan-finder"), msg = document.getElementById("site-scan-finder-msg");
    if (!input || !globalThis.dvFinder) return release(address, "");
    const v = globalThis.dvFinder.check(input.value);
    if (!v.ok) { if (msg) { msg.textContent = v.error; msg.classList.add("bad"); } input.focus(); return; }
    if (v.value) globalThis.dvFinder.save(v.value);
    release(address, v.value);
  }
  // typing a name: checked as you type; the 20 s start again (the upload never waits more than 20 s after the last
  // key); Enter = Add
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || t.id !== "site-scan-finder" || !open || !asks.has(open.address)) return;
    const address = open.address, msg = document.getElementById("site-scan-finder-msg");
    clearTimeout(asks.get(address)); asks.set(address, setTimeout(() => release(address, ""), ASK_MS));
    const v = globalThis.dvFinder ? globalThis.dvFinder.check(t.value) : { ok: true };
    if (msg) { msg.textContent = v.ok ? ASK_NOTE : v.error; msg.classList.toggle("bad", !v.ok); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target && e.target.id === "site-scan-finder" && open) { e.preventDefault(); addName(open.address); } });

  // modern.js calls this after a system is opened (before the scanned data, if any, is shown)
  globalThis.dvSystemOpened = (info) => {
    const address = info.address;
    if (!open || open.address !== address) {
      for (const a of [...asks.keys()]) if (a !== address) release(a, "");   // left the system: sent without a name
      for (const a of [...pending.keys()]) if (a !== address) send(a);
      if (open && states.get(open.address)?.phase === "scanning") cancel(open.address);
    }
    let auto = null;
    try { auto = sessionStorage.getItem("dv.scan.auto"); if (auto === address) sessionStorage.removeItem("dv.scan.auto"); } catch (_) {}
    const searched = globalThis.dvSearchedAddress === address || auto === address;   // auto: "Open" on the Contribute page
    globalThis.dvSearchedAddress = null;
    if (!info.unscanned) ATLAS_KNOWN.add(address);
    open = { address, unscanned: !!info.unscanned, slim: !!info.slim, nomap: !!info.nomap, noloot: !!info.noloot };
    const go = () => {
      { const c0 = cached(address); if (c0 && c0.status === 0 && (c0.top || []).length && !wasSent(address) && atlasHas(address) === true) dropTop(address); }   // v145b: an old top-100 mark on a system the atlas has
      // no loot numbers in the atlas: only on request ("Scan loot", site-loot.js); a loot scan made here earlier shows at once
      const lootHere = open.noloot && globalThis.dvLootSaved ? globalThis.dvLootSaved(address) : null;
      if (lootHere && globalThis.dvFillExtras) setTimeout(() => { if (open && open.address === address) globalThis.dvFillExtras(address, lootHere); }, 0);
      if (open.nomap && maps.has(address)) { setTimeout(() => showMap(address), 0); return; }
      // no published map: draw it on this device straight away (opening the system is the consent)
      if (open.nomap && !["scanning", "drawing", "done"].includes(states.get(address)?.phase)) { setTimeout(() => { if (open && open.address === address) start(address); }, 0); return; }
      const c = cached(address);
      if (c && c.status === 0) {
        // a top-100 system found earlier and not sent yet: it is always added
        if (topNames(c).length && !wasSent(address) && !asks.has(address)) {
          const known = atlasHas(address);
          if (known === true) dropTop(address);   // the atlas has it: normal view, nothing asked or sent
          else if (known === false) sendTop(address, c);
          else atlasKnown(address, ATLAS_WAIT_MS).then((k) => {   // rows not loaded yet: decide when they are
            if (k === true) { dropTop(address); if (open && open.address === address) show(address); }
            else if (k === false && !wasSent(address) && !asks.has(address) && topNames(cached(address)).length) { sendTop(address, cached(address) || c); render(); }
          });
        }
        setTimeout(() => show(address), 0);
        // the map is never saved (only the numbers): draw it again on this device, like an atlas system without a map
        // (user 2026-11-01: "the scanner should keep it's 3d-2d for a system that should be local")
        if (!maps.has(address) && !["scanning", "drawing"].includes(states.get(address)?.phase)) {
          open.redraw = true;
          setTimeout(() => { if (open && open.address === address) start(address); }, 0);
        }
        return;
      }
      const st = states.get(address);
      if (info.unscanned && searched && !(c && c.status === 0) && (!st || st.phase !== "scanning")) setTimeout(() => start(address), 0);
      else setTimeout(render, 0);
    };
    // not in the atlas (unknown, or only saved on this device): the address is checked before anything else
    if (!info.unscanned && !cached(address)) return go();
    verdictOf(address).then((v) => {
      if (!open || open.address !== address) return;
      if (isBad(v)) { open.invalid = v; markChecked(address, v); render(); return; }
      if (v.code === 0) markChecked(address, v);
      go();
    });
  };
  // the Systems list found nothing for a complete address that is not in the atlas: offer to scan it
  globalThis.dvNoResultsAddress = (box, address, openIt) => {
    if (!box) return;
    // one offer per searched address: a new search replaces the box of the one before (it kept the old address)
    const before = box.querySelector(".site-scan-offer");
    if (before && before.dataset.offerAddress === address) return;
    if (before) before.remove();
    const p = document.createElement("div");
    p.className = "site-scan-offer";
    p.dataset.offerAddress = address;
    p.innerHTML = `<p>${esc(address)} is not in the atlas yet.</p><button type="button" class="primary" disabled>Checking the address…</button>`;
    const b = p.querySelector("button");
    b.addEventListener("click", openIt);
    box.prepend(p);
    verdictOf(address).then((v) => {
      if (isBad(v)) { p.classList.add("site-scan-offer-invalid"); p.innerHTML = invalidHtml(address, v); return; }
      b.disabled = false; b.textContent = "Scan this system";
    });
  };
  function watch() {
    const content = document.getElementById("viewer-content");
    if (content) new MutationObserver(render).observe(content, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  setTimeout(sweep, 3000);   // saved systems from before the address check
  document.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest("#search")) rcLoad(); }, true);
})();
