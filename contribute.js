/* contribute.js (SITE integration, user 2026-10-31): the "Contribute!" page, laid out like the Derelict Scanner app
 * (big SCAN button, Pause / Stop, Gentle / Balanced / Maximum, live counters + feed, best finds, toast on a new best).
 * Scans systems from the atlas work list (stats/work.txt: "GG REGION8 001 007 00D-00E ..." = hex system indexes still to
 * scan, written with the index) in this browser with the W29 scanner (scan/bulk-worker.js, one per scanner).
 * Scanning here is the contribution (user: "its implied consent if they're contributing"): with DV_CONFIG.scanRelay
 * set, the addresses scanned (found / no derelict) go to the relay in batches, nothing else. Without a relay nothing is
 * sent and the page says so. Device counts live in localStorage only. */
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
  const outbox = { found: [], none: [] };
  let work = [], state = "loading", pool = [], version = "", wakeLock = null, dirty = 0, failStreak = 0, lastError = "";
  let session = null;            // {scanned, found, mods, ms, startedAt|0, feed[]}
  const newSession = () => ({ scanned: 0, found: 0, mods: 0, ms: 0, startedAt: 0, feed: [] });
  session = newSession();
  const running = () => state === "scanning";
  let owner = false, releaseLock = null, cpuSamples = [];
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
  // CPU use: share of time the scanners are busy, as a share of this device's cores (sampled twice a second)
  setInterval(() => { cpuSamples.push(running() ? pool.filter((p) => p.busy).length : 0); if (cpuSamples.length > 10) cpuSamples.shift(); }, 500);
  const cpuPercent = () => (cpuSamples.length ? Math.min(100, Math.round(cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length / cores * 100)) : 0);

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
    $("cb-bar-fill").style.width = pct.toFixed(2) + "%";
    $("cb-bar").setAttribute("aria-valuenow", pct.toFixed(1));
    $("cb-togo").textContent = s.rules && s.rules.cap_reached
      ? "The atlas has reached a million systems: from now on only systems that break into a top-100 list are saved."
      : `${pct.toFixed(1)} % of the way. ${fmt(Math.max(0, cap - total))} systems to go.`;
    const g = Object.values(s.galaxies || {});
    $("cb-regions").textContent = fmt(g.reduce((a, x) => a + (x.regions || 0), 0));
    $("cb-full").textContent = s.tiers ? fmt(s.tiers.full) : "—";
    $("cb-maps").textContent = s.maps && s.maps.total != null ? fmt(s.maps.total) : "—";
    const h = (s.modules && s.modules.histogram) || [], max = Math.max(1, ...h);
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
      done.add(a); dev.scanned++; session.scanned++; dirty++;
      let item;
      if (d.status === 0) {
        const r = d.row || {}, m = r.frigate_modules, t = (r.crates || 0) + (r.footlockers || 0) + (r.briefcases || 0) + (r.tall_lockers || 0);
        const prevBest = Math.max(-1, ...dev.best.map((b) => b.m ?? -1));
        dev.found++; session.found++; session.mods += Number(m) || 0;
        if (relay()) outbox.found.push(a);
        const entry = { a, m, amb: r.frigate_modules_ambiguous ? 1 : 0, t, v: r.items_value == null || r.items_value === "" ? null : Number(r.items_value),
          rw: r.reward_class ? `${r.reward_class} · ${r.reward_name || ""}` : "", p: r.preset || "" };
        keepBest(entry);
        item = { a, m, amb: entry.amb, t, rw: entry.rw, p: entry.p, rooms: r.rooms, floors: r.floors };
        const top = globalThis.dvTopLists ? globalThis.dvTopLists.breaks(r, r, lists) : [];
        item.top = top.map((x) => x.label);
        if (top.length) { dev.top++; celebrate(`★ Top 100! ${item.top.join(", ")}`, true); }
        else if (m != null && m > prevBest && m >= 2) celebrate(`New best: ${m}${entry.amb ? "?" : ""} Salvaged Frigate Module${m === 1 ? "" : "s"}!`, m >= 5);
      } else {
        // status 4 never happens for a real system (RE W31): logged as unexpected; still reported to the atlas
        dev.none++;
        logFailure({ address: a, mode: "contribute", step: "scan", error: "status 4 (no abandoned freighter): unexpected, every real system has one (RE W31)" });
        if (relay()) outbox.none.push(a);
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
    if (outbox.found.length + outbox.none.length >= BATCH) flush();
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
    const ok = await acquire();
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
  let inFlight = null, retryAt = 0;
  function takeBatch() {
    const found = outbox.found.splice(0, BATCH), none = outbox.none.splice(0, BATCH - found.length);
    return { found, none };
  }
  function putBack(b) { outbox.found.unshift(...b.found); outbox.none.unshift(...b.none); }
  function flush() {
    const url = relay();
    if (!url || inFlight || Date.now() < retryAt || !(outbox.found.length + outbox.none.length)) return;
    const b = inFlight = takeBatch(), n = b.found.length + b.none.length;
    const retry = (s) => { putBack(b); retryAt = Date.now() + s * 1000; setTimeout(flush, s * 1000 + 50); };
    fetch(url, { method: "POST", body: JSON.stringify({ found: b.found, none: b.none, scanner: version }), keepalive: true,
      mode: "cors", headers: { "Content-Type": "text/plain" } })
      .then((r) => {
        inFlight = null;
        if (r.ok) { dev.sent += n; save(); render(); flush(); return; }
        if (r.status === 429 || r.status === 503) { retry(Math.min(3600, Math.max(5, parseInt(r.headers.get("Retry-After"), 10) || 60))); return; }
        logFailure({ what: "relay", status: r.status, n });   // a body the relay refuses would be refused again: dropped
      })
      .catch((err) => { inFlight = null; retry(60); logFailure({ what: "relay", error: String(err && err.message || err), n }); });
  }
  // leaving the page: whatever is not sent yet (and the batch in flight; a duplicate answers 200) goes by sendBeacon
  function lastChance() {
    const url = relay();
    if (!url) return;
    if (inFlight) { putBack(inFlight); inFlight = null; }
    while (outbox.found.length + outbox.none.length) {
      const b = takeBatch();
      try { navigator.sendBeacon && navigator.sendBeacon(url, new Blob([JSON.stringify({ found: b.found, none: b.none, scanner: version })], { type: "text/plain" })); } catch (_) {}
    }
  }
  setInterval(flush, FLUSH_MS);

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
  function feedAdd(it) {
    const ul = $("cb-feed");
    const empty = ul.querySelector(".cb-feed-empty");
    if (empty) empty.remove();
    ul.insertAdjacentHTML("afterbegin", feedHtml(it));
    while (ul.children.length > FEED_MAX) ul.lastElementChild.remove();
  }

  // ---- page ----
  const dur = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m` : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : s ? `${s}s` : "—"; };
  let waitingAt = 0, waitingVal = 0;
  function waitingCached() { if (Date.now() - waitingAt > 3000) { waitingVal = countWaiting(); waitingAt = Date.now(); } return waitingVal; }
  const STATE = { elsewhere: "Scanning in another tab", loading: "Loading the scanner…", ready: "Ready", scanning: "Scanning", paused: "Paused", stopped: "Stopped", done: "Finished", nowork: "Nothing to scan right now", error: "The scanner could not load" };
  function render() {
    const liveMs = running() ? Date.now() - session.startedAt : 0, ms = session.ms + liveMs, rate = session.scanned / Math.max(1, ms) * 60000;
    $("cb-state").textContent = STATE[state] || state;
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
    const cpu = cpuPercent();
    $("cb-cpu").textContent = running() ? cpu + " %" : "idle";
    $("cb-cpu-bar").style.width = (running() ? cpu : 0) + "%";
    $("cb-cpu-bar").className = cpu >= 80 ? "hot" : cpu >= 50 ? "warm" : "";
    $("cb-elsewhere").hidden = state !== "elsewhere";
    $("cb-lsys").textContent = fmt(session.scanned);
    $("cb-lfound").textContent = fmt(session.found);
    $("cb-lmods").textContent = fmt(session.mods);
    $("cb-rate").textContent = session.scanned && ms > 5000 ? `${rate.toFixed(rate < 10 ? 1 : 0)} systems / min · ${dur(ms)}` : "";
    $("cb-scanned").textContent = fmt(dev.scanned);
    $("cb-found").textContent = fmt(dev.found);
    $("cb-top").textContent = fmt(dev.top || 0);
    $("cb-sent").textContent = fmt(dev.sent);
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
      ? `Scanning here adds the systems you scan to the atlas with all their numbers (maps only for the top 100). Your device just sends the addresses. <a href="#cb-what">What is sent</a>`
      : `Sending to the atlas switches on soon. Until then your scans stay on this device. <a href="#cb-what">What is sent</a>`;
    $("cb-relay-note").textContent = url ? cfg().scanRelayNote || "" : "Sending is not switched on yet: right now nothing leaves your device.";
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

  // ADDRESS16 at the start of each line (header and comment lines are skipped); .csv, else .csv.gz
  async function addressList(path) {
    const get = (p) => fetch(p, { cache: "no-cache" }).then((r) => (r.ok ? r : null)).catch(() => null);
    let r = await get(path), text = "";
    if (r) text = await r.text();
    else if ((r = await get(path + ".gz"))) {
      try { text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text(); } catch (_) { text = ""; }
    }
    return (text.match(/^[0-9A-Fa-f]{16}(?=[,\s]|$)/gm) || []).map((a) => a.toUpperCase());
  }

  async function init() {
    await (window.dvGateReady || Promise.resolve());
    setup();
    render();
    // + the visitor-scanned singles (index/singles.csv data rows), as on the main page
    const singles = fetch("index/singles.csv", { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).then((t) => Math.max(0, t.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).length - 1)).catch(() => 0);
    Promise.all([fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null), singles])
      .then(([s, n]) => { lists = s && s.map_lists || null; if (s) s.singles = n; showStats(s); });
    const [text] = await Promise.all([
      fetch("stats/work.txt", { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).catch(() => ""),
      manifest().catch((e) => { logFailure({ step: "manifest", error: "downloading the scanner info (scan/w29.json): " + e.message }); note = "Downloading the scanner failed (" + e.message + "). Reload the page to try again."; }),
    ]);
    work = version ? parseWork(text) : [];
    const sources = await Promise.all([addressList("index/singles.csv"), addressList("singles/none.csv")]);
    for (const list of sources) for (const a of list) known.add(a);
    let total = 0;
    for (const l of work) for (const i of l.idx) if (!known.has(addressOf(l, i))) total++;
    $("cb-waiting").textContent = work.length ? fmt(total) : "—";
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
