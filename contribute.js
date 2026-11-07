/* contribute.js (SITE integration, user 2026-10-31): the "Contribute!" page, laid out like the Derelict Scanner app
 * (big SCAN button, Pause / Stop, Gentle / Balanced / Maximum, live counters + feed, best finds, toast on a new best).
 * Scans systems from the atlas work list (stats/work.txt: "GG REGION8 001 007 00D-00E ..." = hex system indexes still to
 * scan, written with the index) in this browser with the W29 scanner (scan/bulk-worker.js, one per scanner).
 * Scanning here is the contribution (user: "its implied consent if they're contributing"): with DV_CONFIG.scanRelay
 * set, the scan results go to the relay in batches (upload format v3, 2026-11-02, user: "they upload automatically their
 * scanned data via relay"): per system the index line + extras line the scanner wrote (scan/v3-lines.js, no map), plus the
 * addresses without a derelict; the GitHub Action verifies them and publishes. Without a relay nothing is sent and the
 * page says so. Device counts live in localStorage only. */
(function () {
  "use strict";
  const cfg = () => window.DV_CONFIG || {};
  const relay = () => String(cfg().scanRelay || "");
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const jsonGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const jsonSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const SESSION_KEY = "dv.contrib.session", LOCK = "dv-contribute-scan";
  const STATS_KEY = "dv.contrib.v1", DONE_KEY = "dv.contrib.done", SPEED_KEY = "dv.contrib.speed", SORT_KEY = "dv.contrib.sort";
  const RECYCLE = 300, FLUSH_MS = 60000, BATCH = 200, MAX_DONE = 40000, CAP = 1000000, FEED_MAX = 60;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    const url = cfg().scanLogUrl;
    if (url) try { navigator.sendBeacon(url, new Blob([JSON.stringify(e)], { type: "text/plain" })); } catch (_) {}
    return e;
  }
  function logText(n) {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (_) {}
    return all.slice(-(n || MAX_LOG)).map((e) => `${e.t} ${e.page} ${e.address || ""} ${e.step || ""}: ${e.error}${e.online === false ? " (offline)" : ""}${e.attempt ? " [attempt " + e.attempt + "]" : ""}`).join("\n");
  }
  const isNetwork = (msg) => /fetch|network|download|load|HTTP 5|timed? ?out/i.test(String(msg || ""));

  const dev = Object.assign({ scanned: 0, found: 0, none: 0, errors: 0, sent: 0, ms: 0, top: 0, best: [] }, jsonGet(STATS_KEY, {}));
  let lists = null;               // stats map_lists for the top-100 rule (site-toplists.js)
  const done = new Set(jsonGet(DONE_KEY, []));
  const taken = new Set();       // addresses a scanner is working on right now
  const known = new Set();       // published since work.txt was written: index/singles.csv + singles/none.csv
  const outbox = [];             // v3 upload queue: {a, ver, row, ext} (a found system) or {a, ver} (no derelict)
  let work = [], state = "loading", pool = [], version = "", wakeLock = null, dirty = 0, failStreak = 0, lastError = "";
  let session = null;            // {scanned, found, mods, ms, startedAt|0, feed[]}
  const newSession = () => ({ scanned: 0, found: 0, mods: 0, ms: 0, startedAt: 0, feed: [] });
  session = newSession();
  const running = () => state === "scanning";
  let owner = false, releaseLock = null;
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("dv-contribute") : null;
  // one scanning tab per browser: the Web Lock is held while this tab scans or is paused
  function acquire() {
    return new Promise((resolve) => {
      if (!navigator.locks) { resolve(true); return; }
      navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return null; }
        resolve(true);
        return new Promise((r) => { releaseLock = r; });
      }).catch(() => resolve(true));
    });
  }
  function release() { if (releaseLock) { releaseLock(); releaseLock = null; } }
  if (channel) channel.onmessage = (e) => { if (e.data && e.data.type === "takeover" && owner && (running() || state === "paused")) { halt("elsewhere", "Scanning moved to another tab of this browser."); release(); } };
  // the latest counters from this browser's storage (another tab may have scanned)
  function reload() {
    Object.assign(dev, jsonGet(STATS_KEY, {}));
    for (const a of jsonGet(DONE_KEY, [])) done.add(a);
    const s = jsonGet(SESSION_KEY, null);
    if (s) { session = Object.assign(newSession(), s, { startedAt: 0 }); feedRestore(); }
    return s;
  }
  addEventListener("storage", (e) => { if (!owner && (e.key === STATS_KEY || e.key === SESSION_KEY)) { reload(); render(); } });

  // ---- speed: like the scanner app ----
  const cores = Math.max(1, navigator.hardwareConcurrency || 2), phone = matchMedia("(pointer: coarse)").matches;
  const SPEEDS = { gentle: 1, balanced: Math.max(1, Math.floor(cores / 2)), max: Math.max(1, cores - 1) };
  let speed = jsonGet(SPEED_KEY, phone ? "gentle" : "balanced");
  if (!SPEEDS[speed]) speed = "balanced";
  let sortBy = jsonGet(SORT_KEY, "modules");
  const SPEED_NAME = { gentle: "Gentle", balanced: "Balanced", max: "Maximum" };
  const SPEED_NOTE = { gentle: "Gentle: light on the battery, your device stays quick for other things.",
    balanced: "Balanced: uses about half of your device's power.",
    max: "Maximum: uses nearly all of your device's power. It may get warm and the battery drains faster." };

  // ---- atlas statistics ----
  function showStats(s) {
    if (!s) { $("cb-togo").textContent = "Atlas statistics are not available right now."; return; }
    const total = (Number(s.total_systems) || 0) + (Number(s.singles) || 0), cap = Number(s.rules && s.rules.atlas_cap) || CAP, pct = Math.min(100, total / cap * 100);
    $("cb-total").textContent = fmt(total);
    if ($("cs-total")) { $("cs-total").textContent = fmt(total); $("cs-singles").textContent = fmt(Number(s.singles) || 0); }
    $("cb-bar-fill").style.width = pct.toFixed(2) + "%";
    $("cb-bar").setAttribute("aria-valuenow", pct.toFixed(1));
    $("cb-togo").textContent = s.rules && s.rules.cap_reached
      ? "The atlas has reached a million systems: from now on only systems that break into a top-100 list are saved."
      : `${pct.toFixed(1)} % of the way. ${fmt(Math.max(0, cap - total))} systems to go.`;
    const g = Object.values(s.galaxies || {});
    $("cb-regions").textContent = fmt(g.reduce((a, x) => a + (x.regions || 0), 0));
    $("cb-full").textContent = s.tiers ? fmt(s.tiers.full) : "—";
    $("cb-maps").textContent = s.maps && s.maps.total != null ? fmt(s.maps.total) : "—";
    // snapshot histogram + the published singles (stats/systems.json counts none of them), as the Statistics tab shows it
    const h = ((s.modules && Array.isArray(s.modules.histogram)) ? s.modules.histogram : []).map(Number);
    (s.singlesHist || []).forEach((n, m) => { while (h.length <= m) h.push(0); h[m] += Number(n) || 0; });
    const max = Math.max(1, ...h);
    $("cb-hist").innerHTML = h.map((n, m) => `<div class="cb-hrow${m >= 5 ? " rare" : ""}" role="row" title="${fmt(n)} systems with ${m} Salvaged Frigate Module${m === 1 ? "" : "s"}">`
      + `<span role="rowheader">${m}</span><span class="cb-htrack" role="cell"><i style="width:${Math.max(n ? 0.8 : 0, n / max * 100).toFixed(2)}%"></i></span><b role="cell">${fmt(n)}</b></div>`).join("");
  }

  // ---- work list ----
  function parseWork(text) {
    const out = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [g, region, ...ranges] = line.trim().split(/\s+/);
      if (!/^[0-9A-Fa-f]{2}$/.test(g) || !/^[0-9A-Fa-f]{8}$/.test(region)) continue;
      const idx = [];
      for (const r of ranges) {
        const [a, b] = r.split("-").map((x) => parseInt(x, 16));
        if (!(a >= 1) || a > 0xfff) continue;
        for (let i = a; i <= Math.min(b || a, 0xfff); i++) idx.push(i);
      }
      if (idx.length) out.push({ prefix: g.toUpperCase() + region.toUpperCase(), idx });
    }
    return out;
  }
  const addressOf = (line, i) => "000" + i.toString(16).toUpperCase().padStart(3, "0") + line.prefix;
  const free = (a) => !done.has(a) && !taken.has(a) && !known.has(a);
  function countWaiting() {
    let n = 0;
    for (const l of work) for (const i of l.idx) { const a = addressOf(l, i); if (!done.has(a) && !known.has(a)) n++; }
    return n;
  }
  // a random region, then its systems in order from a random start: contributors spread out, one region at a time
  let cursor = null, stopAfter = false;   // stopAfter: finish the current region, then stop (user 2026-10-31)
  function nextAddress() {
    for (let tries = 0; tries < 50; tries++) {
      if (!cursor || cursor.left <= 0) {
        if (stopAfter) return null;
        const open = work.filter((l) => l.idx.some((i) => free(addressOf(l, i))));
        if (!open.length) return null;
        const line = open[Math.floor(Math.random() * open.length)];
        cursor = { line, pos: Math.floor(Math.random() * line.idx.length), left: line.idx.length };
      }
      while (cursor.left > 0) {
        const a = addressOf(cursor.line, cursor.line.idx[cursor.pos % cursor.line.idx.length]);
        cursor.pos++; cursor.left--;
        if (free(a)) return a;
      }
    }
    return null;
  }

  // ---- scanning ----
  function manifest() {
    return fetch("scan/w29.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((m) => { version = String(m.js_sha256 || "").slice(0, 8) + String(m.wasm_sha256 || "").slice(0, 8); });
  }
  function spawn(s) {
    const w = new Worker("scan/bulk-worker.js?v=" + encodeURIComponent(version));
    w.onmessage = (e) => finish(s, e.data);
    w.onerror = (e) => { e.preventDefault(); finish(s, { ok: false, address: s.busy, error: "loading the scanner (bulk-worker.js, w29_scan.js): " + (e.message || "failed") }); };
    s.w = w; s.count = 0;
    return s;
  }
  function feed(s) {
    if (!running() || !pool.includes(s)) return;
    if (s.count >= RECYCLE) { s.w.terminate(); spawn(s); }
    const a = nextAddress();
    if (!a) {
      s.busy = null;
      if (pool.every((p) => !p.busy)) {
        if (stopAfter) halt("stopped", cursor ? `Stopped after finishing region ${cursor.line.prefix.slice(2)} (galaxy ${parseInt(cursor.line.prefix.slice(0, 2), 16) + 1}).` : "Stopped.");
        else halt("done");
      }
      return;
    }
    s.busy = a; taken.add(a); s.count++;
    s.w.postMessage({ address: a });
  }
  const bestKey = {
    modules: (x, y) => (y.m ?? -1) - (x.m ?? -1) || x.amb - y.amb || y.t - x.t || (y.v ?? -1) - (x.v ?? -1),
    total: (x, y) => y.t - x.t || (y.m ?? -1) - (x.m ?? -1),
    value: (x, y) => (y.v ?? -1) - (x.v ?? -1) || (y.m ?? -1) - (x.m ?? -1),
  };
  function keepBest(entry) {
    const all = [...dev.best, entry], keep = new Set();
    for (const k of Object.keys(bestKey)) [...all].sort(bestKey[k]).slice(0, 15).forEach((b) => keep.add(b));
    dev.best = all.filter((b) => keep.has(b));
  }
  function finish(s, d) {
    if (!running() || !pool.includes(s)) return;
    const a = d.address || s.busy;
    taken.delete(a); s.busy = null;
    if (d.ok && (d.status === 0 || d.status === 4)) {
      failStreak = 0;
      if (Number(d.ms) > 0) { scanMs.push(Number(d.ms)); if (scanMs.length > 300) scanMs.shift(); }
      done.add(a); dev.scanned++; session.scanned++; dirty++;
      let item;
      if (d.status === 0) {
        const r = d.row || {}, m = r.frigate_modules, t = (r.crates || 0) + (r.footlockers || 0) + (r.briefcases || 0) + (r.tall_lockers || 0);
        const prevBest = Math.max(-1, ...dev.best.map((b) => b.m ?? -1));
        dev.found++; session.found++; session.mods += Number(m) || 0;
        if (relay()) {
          if (d.v3 && d.v3.row && d.v3.extras) outbox.push({ a, ver: String(d.version || ""), row: d.v3.row, ext: d.v3.extras, ms: d.ms, p: r.preset || "", sp: speed });
          else { logFailure({ address: a, mode: "contribute", step: "upload", error: "not sent: " + (d.v3err || "no upload lines") }); upMark([a], CODE.notSent); upEvent("notsent", 1, "the scanner gave no upload lines"); }
        }
        const entry = { a, m, amb: r.frigate_modules_ambiguous ? 1 : 0, t, v: r.items_value == null || r.items_value === "" ? null : Number(r.items_value),
          rw: r.reward_class ? `${r.reward_class} · ${r.reward_name || ""}` : "", p: r.preset || "" };
        keepBest(entry);
        item = { a, m, amb: entry.amb, t, rw: entry.rw, p: entry.p, rooms: r.rooms, floors: r.floors };
        const top = globalThis.dvTopLists ? globalThis.dvTopLists.breaks(r, r, lists) : [];
        item.top = top.map((x) => x.label);
        if (top.length) { dev.top++; keepTop(a, item.top); celebrate(`★ Top 100! ${item.top.join(", ")}`, true); }
        else if (m != null && m > prevBest && m >= 2) celebrate(`New best: ${m}${entry.amb ? "?" : ""} Salvaged Frigate Module${m === 1 ? "" : "s"}!`, m >= 5);
      } else {
        // status 4 never happens for a real system (RE W31): logged as unexpected; still reported to the atlas
        dev.none++;
        logFailure({ address: a, mode: "contribute", step: "scan", error: "status 4 (no abandoned freighter): unexpected, every real system has one (RE W31)" });
        if (relay()) outbox.push({ a, ver: String(d.version || ""), ms: d.ms, sp: speed });
        item = { a, none: true };
      }
      session.feed.unshift(item);
      if (session.feed.length > FEED_MAX) session.feed.length = FEED_MAX;
      feedAdd(item);
    } else {
      dev.errors++;
      lastError = d.ok ? "scanner status " + d.status : String(d.error || "unknown error");
      logFailure({ address: a, mode: "contribute", step: d.ok ? "scan" : "", error: lastError });
      if (!d.ok) { s.w.terminate(); spawn(s); }
      // a system that failed is tried again later; many failures in a row (no connection?) pause the scanning
      if (++failStreak >= 6) { halt("paused", `The scanner keeps failing (${lastError}). Check the connection and press ▶ SCAN. Error log below.`); return; }
      if (isNetwork(lastError)) { render(); setTimeout(() => feed(s), 2000 * failStreak); return; }
    }
    if (dirty >= 20) save();
    if (outbox.length >= BATCH) flush();
    render();
    feed(s);
  }
  function startPool() {
    pool = [];
    for (let i = 0; i < SPEEDS[speed]; i++) pool.push(spawn({ busy: null }));
    pool.forEach(feed);
  }
  function stopPool() {
    for (const s of pool) { s.w.terminate(); if (s.busy) taken.delete(s.busy); }
    pool = [];
  }
  async function scan(resumed) {
    if (running() || !work.length || scan.busy) return;
    scan.busy = true;
    const ok = releaseLock ? true : await acquire();   // paused here: this tab still holds the lock
    scan.busy = false;
    if (!ok) { state = "elsewhere"; note = ""; render(); return; }
    if (!owner) { owner = true; const s = reload(); if (s && (s.state === "paused" || s.state === "scanning")) state = "paused"; }
    if (state !== "paused") { session = newSession(); feedReset(); }
    state = "scanning"; failStreak = 0; note = resumed ? "Resumed where you left off." : "";
    if (resumed) setTimeout(() => { if (note === "Resumed where you left off.") { note = ""; render(); } }, 6000);
    session.startedAt = Date.now();
    startPool();
    lockScreen();
    render();
  }
  let note = "";
  function halt(next, message) {
    if (running()) { const ms = Date.now() - session.startedAt; session.ms += ms; dev.ms += ms; session.startedAt = 0; }
    stopPool();
    stopAfter = false;
    state = next; note = message || "";
    save(); flush();
    if (next === "stopped" || next === "done") release();
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    render();
  }
  async function lockScreen() {
    try {
      if (running() && navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (_) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") lockScreen(); else { save(); flush(); } });
  addEventListener("pagehide", () => { save(); lastChance(); });

  // ---- adding to the atlas (scanning here is the contribution) ----
  // one batch at a time by a CORS fetch (text/plain = no preflight) so the answer is readable: 202 queued / 200 duplicate
  // = sent; 429/503 = wait Retry-After and resend the same batch (the relay takes a whole body or none of it)
  // v3 body (scanner -cc, 2026-11-02): {"v":3,"scanner":<w29.json version>,"fp":<tables fingerprint>,"rows","extras","none"};
  // at most BATCH (200) systems and 256 KB per POST (kept under ~200 KB here; UTF-8 margin). One scanner version per body.
  // keepalive / sendBeacon bodies must stay under 64 KB (browser limit), so those use smaller batches.
  let inFlight = null, retryAt = 0, maxBytes = 200 * 1024;
  // the scanner's own time per system on this device (scan step only), for the Live card and the "perf" numbers
  const scanMs = [];
  const KEEPALIVE_MAX = 60000;
  const fpOf = (ver) => (/tables fingerprint ([0-9a-f]{16})\b/.exec(ver) || [])[1] || "";
  function takeBatch(limit) {
    const ver = outbox[0].ver, out = [];
    let bytes = 400 + ver.length + (globalThis.dvPerf && globalThis.dvPerf.on() ? 2048 : 0);   // room for "perf"
    while (out.length < BATCH && outbox.length && outbox[0].ver === ver) {
      const e = outbox[0], add = e.row ? e.row.length + e.ext.length + 8 : 21;
      if (out.length && bytes + add > limit) break;
      out.push(outbox.shift()); bytes += add;
    }
    return out;
  }
  function putBack(b) { outbox.unshift(...b); }
  function bodyOf(b) {
    const ver = b[0].ver, rows = [], extras = [], none = [];
    for (const e of b) if (e.row) { rows.push(e.row); extras.push(e.ext); } else none.push(e.a);
    let body = JSON.stringify({ v: 3, scanner: ver, fp: fpOf(ver), rows, extras, none });
    // the scan speed of this batch (site-perf.js; only when the relay takes it: DV_CONFIG.relayPerf)
    const P = globalThis.dvPerf;
    if (P && P.on()) { const sp = b[b.length - 1].sp || speed; body = P.add(body, P.summary(b.map((e) => ({ ms: e.ms, p: e.p })), { workers: SPEEDS[sp] || 1, speed: sp, src: "contribute" })); }
    // the optional scout name (site-finder.js; only when the relay takes it: DV_CONFIG.relayFinder)
    return globalThis.dvFinder ? globalThis.dvFinder.add(body, finderName()) : body;
  }
  // the name in the field when it is valid, else the one saved before (never an invalid name)
  function finderName() {
    const F = globalThis.dvFinder, input = document.getElementById("cb-finder-name");
    if (!F || !F.on()) return "";
    const v = input ? F.check(input.value) : { ok: false };
    return v.ok ? v.value : F.saved();
  }
  function finderSetup() {
    const F = globalThis.dvFinder, box = $("cb-finder"), input = $("cb-finder-name"), msg = $("cb-finder-msg");
    if (!F || !F.on() || !relay() || !box) return;
    box.hidden = false;
    input.value = F.saved();
    const note = "Optional. Shown publicly as “Atlas scout” on the systems you find first.";
    msg.textContent = note;
    input.addEventListener("input", () => {
      const v = F.check(input.value);
      input.setAttribute("aria-invalid", v.ok ? "false" : "true");
      msg.textContent = v.ok ? note : v.error;
      msg.classList.toggle("bad", !v.ok);
      if (v.ok) F.save(v.value);
    });
  }
  // a scanner version without a tables fingerprint cannot be verified by the relay: such results are not sent
  function dropUnsendable() {
    while (outbox.length && !fpOf(outbox[0].ver)) {
      const ver = outbox[0].ver;
      let n = 0;
      const gone = [];
      while (outbox.length && outbox[0].ver === ver) { gone.push(outbox.shift()); n++; }
      logFailure({ what: "relay", error: `not sent: scanner version "${ver.slice(0, 80)}" has no tables fingerprint`, n });
      upMark(gone, CODE.notSent); upEvent("notsent", n, "this scanner version cannot be verified");
    }
  }
  function flush() {
    const url = relay();
    dropUnsendable();
    if (!url || inFlight || Date.now() < retryAt || !outbox.length) return;
    const b = inFlight = takeBatch(maxBytes), n = b.length, body = bodyOf(b);
    const retry = (s) => { putBack(b); retryAt = Date.now() + s * 1000; setTimeout(flush, s * 1000 + 50); };
    fetch(url, { method: "POST", body, keepalive: body.length < KEEPALIVE_MAX, mode: "cors", headers: { "Content-Type": "text/plain" } })
      .then((r) => {
        inFlight = null;
        if (r.ok) { dev.sent += n; upMark(b, CODE.sent); upEvent("sent", n); save(); render(); flush(); return; }
        if (r.status === 429 || r.status === 503) { upEvent("retry", n, "the relay is busy, HTTP " + r.status); retry(Math.min(3600, Math.max(5, parseInt(r.headers.get("Retry-After"), 10) || 60))); return; }
        if (r.status === 413 && maxBytes > 16384) { maxBytes = Math.max(16384, maxBytes >> 1); putBack(b); setTimeout(flush, 50); return; }
        // a body the relay refuses would be refused again: dropped, with the relay's reason in the log
        upMark(b, CODE.refused);
        r.text().catch(() => "").then((why) => { logFailure({ what: "relay", status: r.status, n, error: String(why || "").slice(0, 300) }); upEvent("refused", n, "HTTP " + r.status + (why ? ": " + String(why).slice(0, 120) : "")); });
      })
      .catch((err) => { inFlight = null; retry(60); logFailure({ what: "relay", error: String(err && err.message || err), n }); upEvent("retry", n, "no connection to the relay"); });
  }
  // leaving the page: whatever is not sent yet (and the batch in flight; a duplicate answers 200) goes by sendBeacon
  function lastChance() {
    const url = relay();
    if (!url) return;
    if (inFlight) { putBack(inFlight); inFlight = null; }
    dropUnsendable();
    while (outbox.length) {
      const b = takeBatch(KEEPALIVE_MAX - 2000);
      let handed = false;
      try { handed = navigator.sendBeacon && navigator.sendBeacon(url, new Blob([bodyOf(b)], { type: "text/plain" })); } catch (_) {}
      upMark(b, handed ? CODE.handed : CODE.notSent);
      upEvent(handed ? "handed" : "notsent", b.length, handed ? "" : "the browser would not send them as the page closed");
      dropUnsendable();
    }
  }
  setInterval(flush, FLUSH_MS);

  // ---- "Your uploads" (user 2026-11-06: "it needs a log in it where it shows the state of uploads and state of published maps") ----
  // What was published is read from the atlas's own lists (index/singles.csv, singles/none.csv, views/map-lists.txt,
  // views/top100.json; the index shards for addresses that are not on the work list). What was sent is recorded per address
  // from 2026-11-06 on (dv.contrib.pending). Older scans have no such record, and none is made up for them: they count as
  // "no send record" until they appear in the atlas. Pruned rows after the 1,000,000 cap are not in index/singles.csv.
  const PEND_KEY = "dv.contrib.pending", UPLOG_KEY = "dv.contrib.uplog", TOPS_KEY = "dv.contrib.tops", ATLAS_KEY = "dv.contrib.inatlas", LOOK_KEY = "dv.scan.sent";
  const MAX_PEND = 20000, MAX_UPLOG = 200, MAX_TOPS = 200, MAX_ROWS = 50, FRESH_MIN = 360, CLASSIFY_MS = 30000;
  const CODE = { sent: 1, handed: 2, refused: 3, notSent: 4 };
  const minuteNow = () => Math.floor(Date.now() / 60000);
  const keyOf = (a) => "000" + String(a).slice(3).toUpperCase();
  // one ADDRESS16 from a line of a published list: "ADDRESS16..." or "GLYPHS12,GALAXY,..." (galaxy in decimal)
  function listAddresses(text) {
    const out = [];
    for (const m of String(text || "").matchAll(/^(?:([0-9A-Fa-f]{16})(?=[,\s]|$)|([0-9A-Fa-f]{12}),(\d{1,3})(?=,))/gm)) {
      if (m[1]) out.push(m[1].toUpperCase());
      else out.push(("000" + m[2].slice(1, 4) + Number(m[3]).toString(16).padStart(2, "0") + m[2].slice(4)).toUpperCase());
    }
    return out;
  }
  function upMark(list, code) {
    if (!list.length) return;
    const pend = jsonGet(PEND_KEY, {}), now = minuteNow();
    for (const x of list) {
      const a = typeof x === "string" ? x : x.a, had = pend[a];
      if (code === CODE.handed && had && had[1] === CODE.sent) continue;   // already confirmed: the page close only re-sent it
      pend[a] = [now, code];
    }
    let keys = Object.keys(pend);
    if (keys.length > MAX_PEND) {
      keys = keys.sort((x, y) => pend[x][0] - pend[y][0]).slice(0, keys.length - MAX_PEND);
      for (const a of keys) delete pend[a];
    }
    jsonSet(PEND_KEY, pend);
  }
  function upEvent(k, n, why) {
    const all = jsonGet(UPLOG_KEY, []), last = all[all.length - 1];
    if (last && (k === "retry" || k === "notsent") && last.k === k && last.why === (why || "")) { last.n += n; last.c = (last.c || 1) + 1; last.t = Date.now(); }
    else all.push({ t: Date.now(), k, n, why: why || "" });
    jsonSet(UPLOG_KEY, all.slice(-MAX_UPLOG));
    upLogShow();
    upSoon();
  }
  function keepTop(a, labels) {
    const all = jsonGet(TOPS_KEY, []).filter((x) => x.a !== a);
    all.push({ a, l: labels });
    jsonSet(TOPS_KEY, all.slice(-MAX_TOPS));
  }
  const when = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many || one + "s"}`;
  function upLine(e) {
    const n = plural(e.n, "system"), why = e.why ? ` (${e.why})` : "";
    const text = { sent: `Sent ${n}. The relay confirmed them.`,
      retry: `Could not send ${n}${why}. They stay in the queue and are tried again${e.c > 1 ? `; happened ${fmt(e.c)} times` : ""}.`,
      refused: `The relay refused ${n}${why}. They were dropped.`,
      notsent: `${n[0].toUpperCase() + n.slice(1)} not sent${why}.`,
      handed: `Page closed: ${n} handed to the browser to send. Whether they arrived is not confirmed.`,
      published: `${fmt(e.n)} more of your ${e.n === 1 ? "systems is" : "systems are"} now in the atlas.`,
      baseline: `First check: ${fmt(e.n)} of your systems ${e.n === 1 ? "is" : "are"} in the atlas. Uploads before this log started were not recorded.` }[e.k] || `${e.k} ${n}`;
    return `${when(e.t)}  ${text}`;
  }
  const upLogText = () => jsonGet(UPLOG_KEY, []).slice().reverse().map(upLine).join("\n");
  function upLogShow() {
    const box = $("cu-log"); if (!box) return;
    const all = jsonGet(UPLOG_KEY, []);
    box.querySelector("summary").textContent = `Upload log (${fmt(all.length)})`;
    box.querySelector("pre").textContent = upLogText() || "Nothing logged yet.";
  }

  // where each system stands: is it on the work list?
  let workIdx = null, siteUpdated = "", listsFailed = false, classifying = false, classifyAgain = false, lastClassify = 0, classifyTimer = 0;
  function onWork(a) {
    if (!workIdx) { workIdx = new Map(); for (const l of work) workIdx.set(l.prefix, new Set(l.idx)); }
    const s = workIdx.get(a.slice(6));
    return !!s && s.has(parseInt(a.slice(3, 6), 16));
  }
  // the main index is 16 shards: crc32("<galaxy>:<REGION>") % 16 (build_atlas_index.py IDX7). Only the shards needed are read.
  let crcTable = null;
  function crc32(text) {
    if (!crcTable) { crcTable = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[i] = c; } }
    let crc = -1;
    for (let i = 0; i < text.length; i++) crc = crcTable[(crc ^ text.charCodeAt(i)) & 255] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }
  const mainIn = new Set(), mainNo = new Set();
  async function lookupMain(list) {
    const m = await fetch("index/manifest.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!m || !Array.isArray(m.shards)) return;
    const by = new Map();
    for (const a of list) {
      const n = (crc32(parseInt(a.slice(6, 8), 16) + ":" + a.slice(8)) % 16).toString(16).padStart(2, "0");
      if (!by.has(n)) by.set(n, []);
      by.get(n).push(a);
    }
    for (const [n, want] of by) {
      const s = m.shards.find((x) => x && typeof x.path === "string" && x.path.endsWith("/" + n + ".csv"));
      if (!s) continue;
      const url = s.path + (s.sha256 ? "?v=" + String(s.sha256).slice(0, 8) : "");
      const text = await fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null);
      if (text == null) continue;
      const rows = new Set(listAddresses(text));
      for (const a of want) { (rows.has(a) ? mainIn : mainNo).add(a); }
    }
  }
  let mapLists = null, mapKeys = null, mapKeysFailed = false, mapKeysAsked = false;
  async function loadMapLists() {
    const text = await fetch("views/map-lists.txt", { cache: "no-cache" }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    if (text == null) return;
    const out = new Map();
    for (const m of text.matchAll(/^([0-9A-Fa-f]{16})\s+(\d+)/gm)) out.set(m[1].toUpperCase(), Number(m[2]));
    mapLists = out;
  }
  async function loadMapKeys() {
    mapKeysAsked = true;
    const d = await fetch("views/top100.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d && d.k) { mapKeys = new Set(Object.keys(d.k).map((a) => a.toUpperCase())); mapKeysFailed = false; } else mapKeysFailed = !mapKeys;
    upMaps();
  }
  async function refreshLists() {
    const sources = await Promise.all([addressList("index/singles.csv"), addressList("singles/none.csv"), loadMapLists()]);
    listsFailed = !sources[0].length;
    for (const list of sources.slice(0, 2)) for (const a of list) known.add(a);
  }
  // A session left open for hours (user 2026-11-07, Near me uploads): the published lists are read again every hour (the same two files, the same
  // loader, "no-cache" so an unchanged file costs a 304 from GitHub Pages; nothing touches the relay). A failed or empty answer changes nothing and
  // says nothing; the scan is not restarted, a system already handed to a worker just finishes, and only new addresses are added to the known set.
  const KNOWN_MS = (() => { try { const n = Number(sessionStorage.getItem("dv.contrib.knownms")); if (n >= 1000) return n; } catch (_) {} return 3600000; })();
  async function refreshKnownQuiet() {
    try {
      const [a, b] = await Promise.all([addressList("index/singles.csv"), addressList("singles/none.csv")]);
      if (!a.length) return;   // the main list did not come: keep what is known
      let added = 0;
      for (const list of [a, b]) for (const x of list) if (!known.has(x)) { known.add(x); added++; }
      if (added) { waitingAt = 0; upSoon(); }
    } catch (_) {}
  }
  setInterval(() => { if (workReady) refreshKnownQuiet(); }, KNOWN_MS);
  window.dvContribKnown = (x) => known.has(String(x).toUpperCase());   // test hook
  function upSoon() {
    if (!$("cu-scanned") || !workReady) return;
    const wait = lastClassify + CLASSIFY_MS - Date.now();
    if (wait <= 0) { classify(); return; }
    if (!classifyTimer) classifyTimer = setTimeout(() => { classifyTimer = 0; classify(); }, wait);
  }
  let workReady = false, upLast = null;
  async function classify() {
    if (classifying) { classifyAgain = true; return; }
    classifying = true; lastClassify = Date.now();
    try {
      const looks = jsonGet(LOOK_KEY, []).map(keyOf);
      const needs = [];
      if (work.length) for (const a of new Set([...done, ...looks])) if (!known.has(a) && !mainIn.has(a) && !mainNo.has(a) && !onWork(a)) needs.push(a);
      if (needs.length) {
        if ($("cu-note")) $("cu-note").textContent = `Checking ${plural(needs.length, "older system")} against the full atlas…`;
        await lookupMain(needs);
      }
      const inAtlas = (a) => known.has(a) || mainIn.has(a);
      const queued = new Set(outbox.map((e) => e.a));
      if (inFlight) for (const e of inFlight) queued.add(e.a);
      const pend = jsonGet(PEND_KEY, {}), now = minuteNow();
      const c = { scanned: 0, atlas: 0, waiting: 0, queue: 0, noRecord: 0, stale: 0, refused: 0, notSent: 0, odd: 0, unchecked: 0 };
      let changed = false;
      for (const a of done) {
        c.scanned++;
        const p = pend[a];
        if (inAtlas(a)) { c.atlas++; if (p) { delete pend[a]; changed = true; } continue; }
        if (queued.has(a)) { c.queue++; continue; }
        if (p) {
          if (p[1] === CODE.refused) c.refused++;
          else if (p[1] === CODE.notSent) c.notSent++;
          else if (now - p[0] < FRESH_MIN) c.waiting++;
          else c.stale++;
          continue;
        }
        if (!work.length) c.unchecked++;
        else if (onWork(a)) c.noRecord++;
        else if (mainNo.has(a)) c.odd++;
        else c.unchecked++;
      }
      if (changed) jsonSet(PEND_KEY, pend);
      // the log line: how many more are in the atlas than at the last check
      const seen = jsonGet(ATLAS_KEY, null), before = seen ? seen.n : null;
      if (!listsFailed && c.scanned) {
        if (before == null) upEventQuiet("baseline", c.atlas);
        else if (c.atlas > before) upEventQuiet("published", c.atlas - before);
        jsonSet(ATLAS_KEY, { n: c.atlas });
      }
      upLast = { c, looks };
      upShow();
    } finally {
      classifying = false;
      if (classifyAgain) { classifyAgain = false; upSoon(); }
    }
  }
  function upEventQuiet(k, n) { const all = jsonGet(UPLOG_KEY, []); all.push({ t: Date.now(), k, n, why: "" }); jsonSet(UPLOG_KEY, all.slice(-MAX_UPLOG)); upLogShow(); }
  function upShow() {
    if (!upLast) return;
    const { c, looks } = upLast, missing = c.noRecord + c.stale + c.refused + c.notSent + c.odd + c.unchecked;
    const put = (id, v) => { const e = $(id); if (e) e.textContent = fmt(v); };
    put("cu-scanned", c.scanned); put("cu-atlas", c.atlas); put("cu-waiting", c.waiting); put("cu-queue", c.queue); put("cu-missing", missing); put("cu-sent", dev.sent);
    const parts = [[c.noRecord, "with no send record (older scans, or the page closed before sending)"], [c.stale, "sent 6 or more hours ago and still not listed"], [c.refused, "refused by the relay"],
      [c.notSent, "not sent"], [c.odd, "neither on the work list nor in the atlas"], [c.unchecked, "could not be checked just now"]].filter((p) => p[0]);
    $("cu-why").textContent = parts.length ? "Not in the atlas: " + parts.map((p) => `${fmt(p[0])} ${p[1]}`).join(" · ") + "."
      : c.scanned ? "Nothing is missing: everything scanned here is in the atlas or on its way." : "Nothing scanned on this browser yet.";
    const inLook = looks.filter((a) => known.has(a) || mainIn.has(a)).length;
    $("cu-look").textContent = looks.length ? `Looked-up systems sent because they broke into a top 100: ${fmt(looks.length)}, ${fmt(inLook)} in the atlas now.` : "";
    $("cu-look").hidden = !looks.length;
    $("cu-note").textContent = (listsFailed ? "The atlas's lists could not be loaded, so these counts may be too low. " : "")
      + "Counted for this browser only, by comparing your scans with the atlas's published lists. The atlas publishes about hourly."
      + (siteUpdated ? ` Site last updated ${when(siteUpdated)}.` : "");
    upMaps();
    upLogShow();
  }
  function upMaps() {
    if (!$("cu-lists") || !upLast) return;
    const known2 = (a) => known.has(a) || mainIn.has(a);
    const put = (id, v) => { const e = $(id); if (e) e.textContent = v == null ? "—" : fmt(v); };
    put("cu-lists", mapLists ? mapLists.size : null);
    put("cu-maps", mapKeys ? mapKeys.size : null);
    let wait = null, gone = 0;
    if (mapLists && mapKeys) { wait = 0; for (const a of mapLists.keys()) if (!mapKeys.has(a)) wait++; for (const a of mapKeys) if (!mapLists.has(a)) gone++; }
    put("cu-mapwait", wait);
    $("cu-mapnote").textContent = mapKeysFailed ? "The list of published maps could not be loaded." : gone ? `${plural(gone, "published map")} ${gone === 1 ? "belongs to a system that has" : "belong to systems that have"} since left the top-100 lists.` : "";
    const tops = jsonGet(TOPS_KEY, []), labels = new Map(tops.map((x) => [x.a, x.l]));
    const rows = new Set(tops.map((x) => x.a));
    for (const a of upLast.looks) rows.add(a);
    if (mapLists) for (const a of mapLists.keys()) if (done.has(a)) rows.add(a);
    const STATE = ["Waiting to publish", "In a top-100 list, map comes with the next atlas publish, drawn on your device until then", "Map published", "In the atlas, not in a top-100 list now", "Checking…", "In a top-100 list, map not checked"];
    const stateOf = (a) => {
      if (mapLists && mapLists.has(a)) return mapKeys ? (mapKeys.has(a) ? 2 : 1) : mapKeysFailed ? 5 : 4;
      if (!mapLists) return 4;
      return known2(a) ? 3 : 0;
    };
    const nameOf = (a) => {
      const l = labels.get(a);
      if (l && l.length) return l.join(", ");
      const bits = mapLists ? mapLists.get(a) : 0;
      return bits && Array.isArray(lists) ? lists.filter((x) => bits & x.bit).map((x) => String(x.label || x.name)).join(", ") : "";
    };
    const list = [...rows].map((a) => ({ a, s: stateOf(a) })).sort((x, y) => x.s - y.s || (x.a < y.a ? -1 : 1));
    const box = $("cu-finds");
    const html = !list.length ? `<p class="cb-muted">None of your systems has reached a top-100 list yet. Maps are kept only for the top-100 lists.</p>`
      : `<table><thead><tr><th>Address</th><th>State</th><th class="cb-hide-s">Lists</th><th></th></tr></thead><tbody>${list.slice(0, MAX_ROWS).map((r) =>
        `<tr data-a="${esc(r.a)}"><td class="cb-addr">${esc(r.a)}</td><td class="cu-state">${esc(STATE[r.s])}</td><td class="cb-hide-s cu-lists-cell">${esc(nameOf(r.a))}</td><td><a href="./#/d/${esc(r.a)}" data-open="${esc(r.a)}">Open</a></td></tr>`).join("")}</tbody></table>`
        + (list.length > MAX_ROWS ? `<p class="cb-small">and ${fmt(list.length - MAX_ROWS)} more</p>` : "");
    if (box.innerHTML !== html) box.innerHTML = html;
    $("cu-topnote").textContent = dev.top !== list.length && (dev.top || list.length) ? `Top 100 finds counted when they were scanned: ${fmt(dev.top)}. The lists change as others scan, so this table shows where each system stands now.` : "";
  }
  function upSetup() {
    const check = $("cu-check"); if (!check) return;
    upLogShow();
    check.addEventListener("click", async () => {
      check.disabled = true; check.textContent = "Checking…";
      mainNo.clear();
      await refreshLists();
      await Promise.all([classify(), mapKeysAsked ? loadMapKeys() : null]);
      check.disabled = false; check.textContent = "Check now";
    });
    $("cu-copy").addEventListener("click", (e) => { try { navigator.clipboard.writeText(upLogText()).then(() => { e.target.textContent = "Copied"; }); } catch (_) {} });
    const card = $("cb-uploads");
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((list) => { if (list.some((x) => x.isIntersecting)) { io.disconnect(); loadMapKeys(); } });
      io.observe(card);
    } else loadMapKeys();
  }

  function save() {
    dirty = 0;
    if (!owner) return;   // only the scanning tab writes
    const ms = session.ms + (running() ? Date.now() - session.startedAt : 0);
    jsonSet(SESSION_KEY, { scanned: session.scanned, found: session.found, mods: session.mods, ms, feed: session.feed.slice(0, FEED_MAX), state: running() ? "scanning" : state, at: Date.now() });
    jsonSet(STATS_KEY, dev);
    jsonSet(DONE_KEY, [...done].slice(-MAX_DONE));
  }

  // ---- toast + confetti on a new best ----
  let toastTimer = 0;
  function celebrate(text, big) {
    const t = $("cb-toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
    if (big && !reduced) confetti();
  }
  function confetti() {
    const c = $("cb-confetti"), ctx = c.getContext("2d");
    c.hidden = false; c.width = innerWidth; c.height = innerHeight;
    const colors = ["#55d9dc", "#f4cd54", "#edf3f4", "#b990d9", "#cf8076"];
    const bits = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.4, vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, w: 5 + Math.random() * 6, col: colors[Math.floor(Math.random() * colors.length)] }));
    const end = performance.now() + 2600;
    (function frame(now) {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.vy += 0.05; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.col; ctx.fillRect(-b.w / 2, -b.w / 4, b.w, b.w / 2); ctx.restore();
      }
      if (now < end) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, c.width, c.height); c.hidden = true; }
    })(performance.now());
  }

  // ---- live feed ----
  function feedHtml(it) {
    if (it.none) return `<li class="none"><span class="g">${esc(it.a)}</span><span class="n">unexpected result (logged)</span></li>`;
    const mods = it.m == null ? "—" : esc(it.m) + (it.amb ? "?" : "");
    return `<li${it.top && it.top.length ? ' class="rare top"' : it.m >= 5 ? ' class="rare"' : ""}><span class="g">${esc(it.a)}${it.top && it.top.length ? ` <em class="cb-top" title="${esc(it.top.join(", "))}">★ Top 100</em>` : ""}</span><span class="n"><b>${mods}</b> module${it.m === 1 ? "" : "s"} · ${fmt(it.t)} containers</span>`
      + `<span class="p">${esc([it.p && it.p.replace(/_/g, " ").toLowerCase(), it.rooms != null && `${it.rooms} rooms`, it.rw].filter(Boolean).join(" · "))} <a href="./#/d/${esc(it.a)}" data-open="${esc(it.a)}">Open ↗</a></span></li>`;
  }
  function feedRestore() {
    feedReset();
    for (const it of [...session.feed].reverse()) feedAdd(it);
  }
  function feedReset() { $("cb-feed").innerHTML = `<li class="cb-feed-empty">Press ▶ SCAN and the systems you scan appear here.</li>`; }
  function feedAdd(it) { return anchored(() => feedAddNow(it)); }
  function feedAddNow(it) {
    const ul = $("cb-feed");
    const empty = ul.querySelector(".cb-feed-empty");
    if (empty) empty.remove();
    // user 2026-11-04: scrolled down in the live list -> new rows must not push the view; keep the reading position
    const top0 = ul.scrollTop, h0 = ul.scrollHeight;
    ul.insertAdjacentHTML("afterbegin", feedHtml(it));
    while (ul.children.length > FEED_MAX) ul.lastElementChild.remove();
    if (top0 > 2) { ul.firstElementChild.style.animation = "none"; ul.scrollTop = top0 + (ul.scrollHeight - h0); }
  }

  // ---- page ----
  const dur = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m` : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : s ? `${s}s` : "—"; };
  let waitingAt = 0, waitingVal = 0;
  function waitingCached() { if (Date.now() - waitingAt > 3000) { waitingVal = countWaiting(); waitingAt = Date.now(); } return waitingVal; }
  const STATE = { elsewhere: "Scanning in another tab", loading: "Getting ready…", ready: "Ready", scanning: "Scanning", paused: "Paused", stopped: "Stopped", done: "Finished", nowork: "Nothing to scan right now", error: "The scanner could not start" };
  // user 2026-11-04 "while scanning and i scroll below the live list, it pushes me down": keep the card at the top of the
  // screen still while the page updates (manual anchoring; Safari has none; native anchoring is off in contribute.css)
  function anchored(fn) {
    const y = window.scrollY;
    if (y < 8) return fn();
    const cards = document.querySelectorAll(".cb-card, .cb-side-card");
    let a = null;
    for (const c of cards) { if (c.getBoundingClientRect().bottom > 0) { a = c; break; } }
    const t0 = a ? a.getBoundingClientRect().top : 0;
    const r = fn();
    if (a && a.isConnected) { const d = a.getBoundingClientRect().top - t0; if (Math.abs(d) >= 1) window.scrollBy(0, d); }
    return r;
  }
  function render() { return anchored(renderNow); }
  function renderNow() {
    const liveMs = running() ? Date.now() - session.startedAt : 0, ms = session.ms + liveMs, rate = session.scanned / Math.max(1, ms) * 60000;
    $("cb-state").textContent = STATE[state] || state;
    const csr = $("cs-rate"); if (csr) csr.textContent = running() && session.scanned ? `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)} / min` : "—";
    const n = pool.length;
    $("cb-detail").textContent = note || (state === "scanning" ? `${SPEED_NAME[speed]} speed · ${fmt(waitingCached())} systems waiting in ${fmt(work.length)} regions`
      : state === "done" ? "Every system in the work list has been scanned on this device. Thank you! New systems are added with each atlas update."
      : state === "nowork" ? "New systems are added to the work list with each atlas update."
      : work.length ? `${fmt(waitingCached())} systems waiting in ${fmt(work.length)} regions` : "");
    $("cb-radar").classList.toggle("on", running());
    $("cb-live-dot").classList.toggle("on", running());
    const scanBtn = $("cb-scan");
    scanBtn.disabled = running() || !work.length;
    scanBtn.textContent = state === "paused" ? "▶ RESUME" : "▶ SCAN";
    $("cb-pause").disabled = !running();
    $("cb-stop").disabled = !(running() || state === "paused");
    const left = cursor && running() ? Math.max(0, cursor.left) : 0;
    $("cb-region").disabled = !running();
    $("cb-region").setAttribute("aria-pressed", String(stopAfter));
    $("cb-region").textContent = stopAfter ? `⏭ Stopping after this region${left ? ` · ${fmt(left)} left` : ""} (undo)` : `⏭ Stop after region${left ? ` · ${fmt(left)} left` : ""}`;
    document.querySelectorAll("#cb-speed button").forEach((b) => b.classList.toggle("on", b.dataset.s === speed));
    $("cb-speed-note").textContent = SPEED_NOTE[speed];
    $("cb-elsewhere").hidden = state !== "elsewhere";
    $("cb-lsys").textContent = fmt(session.scanned);
    $("cb-lfound").textContent = fmt(session.found);
    $("cb-lmods").textContent = fmt(session.mods);
    const med = scanMs.length && globalThis.dvPerf ? globalThis.dvPerf.median(scanMs) : null;
    $("cb-rate").textContent = session.scanned && ms > 5000 ? `${rate.toFixed(rate < 10 ? 1 : 0)} systems / min${med ? ` · ${(med / 1000).toFixed(med < 10000 ? 2 : 0)} s per system` : ""} · ${dur(ms)}` : "";
    $("cb-scanned").textContent = fmt(dev.scanned);
    $("cb-found").textContent = fmt(dev.found);
    $("cb-top").textContent = fmt(dev.top || 0);
    $("cb-sent").textContent = fmt(dev.sent);
    const cuSent = $("cu-sent"); if (cuSent) cuSent.textContent = fmt(dev.sent);
    const top = Math.max(-1, ...dev.best.map((b) => b.m ?? -1));
    $("cb-best").textContent = top >= 0 ? String(top) : "—";
    $("cb-time").textContent = dur(dev.ms + liveMs);
    document.querySelectorAll("#cb-sort button").forEach((b) => b.classList.toggle("on", b.dataset.v === sortBy));
    const list = [...dev.best].sort(bestKey[sortBy] || bestKey.modules).slice(0, 10);
    const finds = list.length ? `<table><thead><tr><th>#</th><th>Address</th><th>Modules</th><th>Containers</th><th class="cb-hide-s">Value</th><th class="cb-hide-s">End reward</th><th></th></tr></thead><tbody>${
      list.map((b, i) => `<tr${i < 3 ? ` class="top${i + 1}"` : ""}><td><span class="cb-rank">${i + 1}</span></td><td class="cb-addr">${esc(b.a)}</td><td class="gold">${b.m == null ? "—" : esc(b.m) + (b.amb ? "?" : "")}</td><td>${fmt(b.t)}</td>`
        + `<td class="cb-hide-s">${b.v == null ? "—" : fmt(b.v)}</td><td class="cb-hide-s">${esc(b.rw || "—")}</td><td><a href="./#/d/${esc(b.a)}" data-open="${esc(b.a)}">Open</a></td></tr>`).join("")
    }</tbody></table>` : `<p class="cb-muted">Nothing found yet. Your best derelicts appear here.</p>`;
    if ($("cb-finds").innerHTML !== finds) $("cb-finds").innerHTML = finds;
    const log = logText(10), box = $("cb-log");
    box.hidden = !log;
    const pre = box.querySelector("pre");
    if (pre.textContent !== log) pre.textContent = log;
  }

  function setup() {
    const url = relay();
    $("cb-consent").innerHTML = url
      ? `Scanning here adds the systems you scan to the atlas with all their numbers (maps only for the top 100). Your device sends what it found (numbers and loot values, no map); the atlas checks it before publishing. <a href="#cb-what">What is sent</a>`
      : `Sending to the atlas switches on soon. Until then your scans stay on this device. <a href="#cb-what">What is sent</a>`;
    $("cb-relay-note").textContent = url ? "" : "Sending is not switched on yet: right now nothing leaves your device.";
    $("cb-relay-note").hidden = !!url;
    // the preview's stand-in relay keeps nothing: say so on the page (user 2026-11-03)
    if (url === "relay-test" && $("cb-preview")) $("cb-preview").hidden = false;
    finderSetup();
    upSetup();
    $("cb-scan").addEventListener("click", () => scan());
    $("cb-pause").addEventListener("click", () => halt("paused"));
    $("cb-takeover").addEventListener("click", () => { if (channel) channel.postMessage({ type: "takeover" }); state = "ready"; setTimeout(() => scan(), 400); });
    $("cb-stop").addEventListener("click", () => halt("stopped"));
    $("cb-region").addEventListener("click", () => { if (running()) { stopAfter = !stopAfter; render(); } });
    document.querySelectorAll("#cb-speed button").forEach((b) => b.addEventListener("click", () => {
      speed = b.dataset.s; jsonSet(SPEED_KEY, speed);
      if (running()) { stopPool(); startPool(); }
      render();
    }));
    document.querySelectorAll("#cb-sort button").forEach((b) => b.addEventListener("click", () => { sortBy = b.dataset.v; jsonSet(SORT_KEY, sortBy); render(); }));
    $("cb-copylog").addEventListener("click", (e) => { try { navigator.clipboard.writeText(logText()).then(() => { e.target.textContent = "Copied"; }); } catch (_) {} });
    // "Open" scans the system in the viewer at once (site-scan.js reads this flag)
    document.addEventListener("click", (e) => {
      const a = e.target instanceof Element && e.target.closest("[data-open]");
      if (a) try { sessionStorage.setItem("dv.scan.auto", a.dataset.open); } catch (_) {}
    });
    setInterval(() => { if (running()) render(); }, 1000);
  }

  // the addresses of a published list (listAddresses: ADDRESS16 or GLYPHS12,GALAXY at the start of each line; header and comment lines are skipped); .csv, else .csv.gz
  async function addressList(path) {
    const get = (p) => fetch(p, { cache: "no-cache" }).then((r) => (r.ok ? r : null)).catch(() => null);
    let r = await get(path), text = "";
    if (r) text = await r.text();
    else if ((r = await get(path + ".gz"))) {
      try { text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text(); } catch (_) { text = ""; }
    }
    if (r && path.endsWith("singles.csv")) siteUpdated = r.headers.get("Last-Modified") || siteUpdated;
    return listAddresses(text);
  }

  // side panel "Atlas scanning" (user 2026-11-04 "add stats of scanning to the contribute scanner site on the side"):
  // atlas totals (from showStats), scanner speed by device (stats/speed.json, ms per system -> systems/min), top Atlas scouts
  // (views/finders.csv through dvFinder.load, which already drops blocked names), and this session's own rate (renderNow)
  function sideStats() {
    const devName = { phone: "Phone", tablet: "Tablet", pc: "PC" };
    const per = (ms) => (Number(ms) > 0 ? 60000 / Number(ms) : null), pm = (v) => (v == null ? "—" : `${v >= 10 ? Math.round(v) : v.toFixed(1)} / min`);
    fetch("stats/speed.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((s) => {
      const box = $("cs-speed"); if (!box) return;
      const rows = Object.keys((s && s.by_dev) || {}).filter((k) => s.by_dev[k] && per(s.by_dev[k].avg ?? s.by_dev[k].p50) !== null)
        .sort((a, b) => ["phone", "tablet", "pc"].indexOf(a) - ["phone", "tablet", "pc"].indexOf(b))
        .map((k) => `<div><dt>${esc(devName[k] || k)}</dt><dd>${pm(per(s.by_dev[k].avg ?? s.by_dev[k].p50))}</dd></div>`);
      box.innerHTML = rows.length ? rows.join("") : `<div><dt>No speed data yet</dt><dd></dd></div>`;
      const n = s && Number(s.systems), note = $("cs-speed-note");
      if (note) note.textContent = n ? `Average per device, from ${fmt(n)} timed scans.` : "";
    });
    const F = window.dvFinder;
    if (F && F.on && F.on()) F.load().then((m) => {
      if (!m || !m.size) return;
      const c = new Map(); for (const v of m.values()) c.set(v, (c.get(v) || 0) + 1);
      const top = [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
      $("cs-scouts").innerHTML = top.map(([name, k]) => `<li><span>${esc(name)}</span><b>${fmt(k)}</b></li>`).join("");
      $("cs-scouts").hidden = $("cs-scouts-title").hidden = false;
    }).catch(() => {});
  }

  async function init() {
    await (window.dvGateReady || Promise.resolve());
    setup();
    render();
    // + the visitor-scanned singles (index/singles.csv data rows), as on the main page
    const singles = fetch("index/singles.csv", { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).catch(() => "").then((t) => {
      const rows = t.split(/\r?\n/).filter((l) => l && !l.startsWith("#")), hist = [];
      const col = rows.length ? rows[0].split(",").indexOf("frigate_modules") : -1;
      if (col >= 0) for (const line of rows.slice(1)) { const v = line.split(",")[col]; if (/^\d+$/.test(v)) { const m = Number(v); while (hist.length <= m) hist.push(0); hist[m]++; } }
      return { n: Math.max(0, rows.length - 1), hist };
    }).catch(() => ({ n: 0, hist: [] }));
    Promise.all([fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null), singles])
      .then(([s, g]) => { lists = s && s.map_lists || null; if (s) { s.singles = g.n; s.singlesHist = g.hist; } showStats(s); });
    sideStats();
    const [text] = await Promise.all([
      fetch("stats/work.txt", { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).catch(() => ""),
      manifest().catch((e) => { logFailure({ step: "manifest", error: "downloading the scanner info (scan/w29.json): " + e.message }); note = "The scanner could not start (network problem). Reload the page to try again."; }),
    ]);
    work = version ? parseWork(text) : [];
    await refreshLists();
    workReady = true;
    classify();
    let total = 0;
    for (const l of work) for (const i of l.idx) if (!known.has(addressOf(l, i))) total++;
    $("cb-waiting").textContent = work.length ? fmt(total) : "—";
    const csw = $("cs-waiting"); if (csw) csw.textContent = work.length ? fmt(total) : "—";
    state = !version ? "error" : work.length ? "ready" : "nowork";
    // persistent on this browser: show the last session; resume when it was scanning when the page was left
    const saved = jsonGet(SESSION_KEY, null);
    if (saved && state === "ready") {
      session = Object.assign(newSession(), saved, { startedAt: 0 }); feedRestore();
      if (saved.state === "paused" || saved.state === "scanning") state = "paused";
      if (saved.state === "scanning") { render(); scan(true); return; }
    }
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
