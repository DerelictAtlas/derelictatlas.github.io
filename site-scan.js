/* site-scan.js (SITE integration, user 2026-10-31): scan a system in the visitor's browser.
 * - A searched address that is not in the atlas is scanned at once; a direct link gets a "Scan this system" button.
 * - The W29 scanner (scan/scan_w29.wasm, the same engine as the atlas scanner) runs in a fresh Web Worker per scan;
 *   after 120 s the page asks whether to keep waiting (the scan keeps running), Cancel stops the worker.
 * - Adding a scan to the atlas is opt-in (user 2026-10-31): the "Scanned on this device" button opens the explanation
 *   and an "Add this system to the atlas" box. Ticked, only the address is sent to the atlas relay
 *   (DV_CONFIG.scanRelay), once, as soon as it is ticked (a top-100 system as soon as it is found).
 *   Without a relay in the config nothing is sent and the page says so.
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

  const states = new Map();      // address -> {phase, startedAt, limitAt, asking, error, ms, send, infoOpen}
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

  // "Remember my choice" (user 2026-11-01): add every system scanned in this browser, at once
  const ALWAYS_KEY = "dv.scan.always", always = () => jsonGet(ALWAYS_KEY, false) === true;

  // ---- systems scanned on this device in the Systems list (user 2026-10-31) ----
  // tag: "Uploaded" once the address was sent, "Not uploaded yet" while it is queued for the atlas (opted in or top 100),
  // otherwise "Local only". modern.js turns the cached rows into list cards (withDeviceRows).
  function tagOf(address, c) { return wasSent(address) ? "Uploaded" : (c.queued || (c.top || []).length) ? "Not uploaded yet" : "Local only"; }
  const changed = () => { try { if (globalThis.dvDeviceChanged) globalThis.dvDeviceChanged(); } catch (_) {} };
  globalThis.dvDeviceScans = () => Object.entries(jsonGet(CACHE_KEY, {})).filter(([, c]) => c && c.status === 0 && c.row && c.valid !== false)
    .map(([address, c]) => ({ address, row: c.row, extras: lootShown(address, c) ? c.extras : null, tag: tagOf(address, c) }));
  // loot on request (user 2026-10-31): a top-100 system shows it by default, any other after "Scan loot" (site-loot.js)
  function lootShown(address, c) { return (c.top || []).length > 0 || !!(globalThis.dvLootSaved && globalThis.dvLootSaved(address)); }
  globalThis.dvScannedHere = (address) => { const c = cached(address); return !!(c && c.status === 0 && c.valid !== false); };
  function setQueued(address, on) {
    const all = jsonGet(CACHE_KEY, {});
    if (!all[address]) return;
    all[address].queued = !!on;
    jsonSet(CACHE_KEY, all);
    changed();
  }

  // ---- sending (address only, once, at once; user 2026-11-01 "i'd like this to be instant") ----
  // a CORS fetch (text/plain = no preflight) so the relay's answer is readable: "Sent" only after a 2xx
  function markSent(address) {
    const sent = jsonGet(SENT_KEY, []);
    if (!sent.includes(address)) { sent.push(address); jsonSet(SENT_KEY, sent.slice(-500)); }
    changed();
  }
  function send(address) {
    clearTimeout(pending.get(address));
    pending.delete(address);
    const url = relay(), st = states.get(address);
    if (!url || !(st && st.send) || wasSent(address) || st.sending || savedInvalid(address)) return;
    st.sending = true; st.sendError = "";
    fetch(url, { method: "POST", body: JSON.stringify({ address }), keepalive: true, mode: "cors", headers: { "Content-Type": "text/plain" } })
      .then((r) => {
        st.sending = false;
        if (r.ok) { markSent(address); render(); return; }
        if (r.status === 429 || r.status === 503) { const s = Math.min(3600, Math.max(5, parseInt(r.headers.get("Retry-After"), 10) || 60)); st.sendError = "busy"; pending.set(address, setTimeout(() => send(address), s * 1000)); render(); return; }
        st.sendError = `the atlas relay answered ${r.status}`; logFailure({ what: "relay", address, status: r.status }); render();
      })
      .catch((err) => { st.sending = false; st.sendError = "could not reach the atlas relay"; logFailure({ what: "relay", address, error: String(err && err.message || err) }); render(); });
    render();
  }
  function schedule(address) {
    if (!relay() || wasSent(address) || pending.has(address) || savedInvalid(address)) return;
    verdictOf(address).then((v) => { if (!isBad(v)) send(address); else markChecked(address, v); });
  }
  // leaving the page while a retry waits: last chance by sendBeacon (its answer cannot be read)
  function flushAll() {
    const url = relay();
    for (const a of [...pending.keys()]) {
      clearTimeout(pending.get(a)); pending.delete(a);
      if (savedInvalid(a)) continue;
      try { if (url && navigator.sendBeacon(url, new Blob([JSON.stringify({ address: a })], { type: "text/plain" }))) markSent(a); } catch (_) {}
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
    if (prev) for (const k of ["send", "sending", "sendError", "callout"]) if (prev[k] !== undefined) st[k] = prev[k];
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
    const top = globalThis.dvTopLists ? await globalThis.dvTopLists.load().then((l) => globalThis.dvTopLists.breaks(data.row, data.extras, l)).catch(() => []) : [];
    if (states.get(address) !== st) return;
    remember(address, { status: 0, row: data.row, extras: data.extras, loot: data.loot || null, version: data.version, top, at: Date.now(), valid: true });
    changed();
    if (top.length) { st.send = true; st.callout = true; schedule(address); setTimeout(() => { st.callout = false; render(); }, 9000); }
    else if (always() && relay()) { st.send = true; setQueued(address, true); schedule(address); }
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
  const kb = (n) => Math.round((n || 0) / 1024).toLocaleString("en-US") + " KB";
  // download 0-30 % (real bytes), start 30-35 %, generate 35-90 % (time based: the engine reports nothing inside the
  // call yet), map 90-100 % (done when the viewer shows the map)
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
    const at = STEPS.indexOf(st.step), now = Date.now(), r = st.summary;
    const found = r ? [r.preset && String(r.preset).replace(/_/g, " ").toLowerCase(), r.rooms != null && r.rooms + " rooms",
      ((r.crates || 0) + (r.footlockers || 0) + (r.briefcases || 0) + (r.tall_lockers || 0)) + " containers",
      r.frigate_modules != null && r.frigate_modules + (r.frigate_modules_ambiguous ? "?" : "") + " Salvaged Frigate Module" + (r.frigate_modules === 1 ? "" : "s")].filter(Boolean).join(" · ") : "";
    const rows = [
      ["Downloading the scanner", st.total ? `${kb(Math.min(st.loaded, st.total))} of ${kb(st.total)}` : st.loaded ? kb(st.loaded) : ""],
      ["Starting the scanner", ""],
      [map ? "Generating the layout" : "Generating the derelict", at === 2 ? secs(now - st.stepAt) : found],
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
    if (st.phase === "error") return `<p>${map ? "The map could not be drawn" : "The scan did not finish"} (${esc(st.error || "unknown error")}).</p><button id="site-scan-start" class="primary" type="button">Try again</button>`
      + `<details class="site-scan-log"><summary>Error log</summary><pre>${esc(logText(8))}</pre><button id="site-scan-copylog" type="button">Copy log</button></details>`;
    return "";
  }
  const KEPT = `If it is added, the atlas keeps every number of this system for everyone: rooms, containers, Salvaged Frigate Modules, end reward and loot. Only its 3D and 2D map is not kept (a map takes about 24 times the space), unless the system is in a top-100 list.`;
  const SENT = `Your device sends just the address (galaxy and glyphs); the atlas scans the system again itself before publishing it. Nothing about you is sent.`;
  function topNames(c) { return (c && c.top || []).map((t) => t.label); }
  function consentHtml(address) {
    const rememberHtml = `<label class="site-scan-optin site-scan-remember" title="Add every system you scan in this browser to the atlas, at once. Untick to stop."><input id="site-scan-always" type="checkbox"${always() ? " checked" : ""}> Remember my choice</label>`;
    const st = states.get(address) || {}, url = relay(), sent = wasSent(address), c = cached(address), top = topNames(c);
    const choice = top.length
      ? `<span class="site-scan-state">${!url ? "Added to the atlas once sending is switched on" : sent ? "Added to the atlas ✓" : "Will be added to the atlas"}</span>`
      : !url ? `<span class="site-scan-state">Adding to the atlas is not switched on yet</span>`
      : sent ? `<span class="site-scan-state">Sent to the atlas ✓ Thank you!</span>${always() ? rememberHtml : ""}`
      : `<label class="site-scan-optin"><input id="site-scan-send" type="checkbox"${st.send ? " checked" : ""}> Add this system to the atlas</label>${rememberHtml}`
        + (st.send ? `<span class="site-scan-state">${st.sendError === "busy" ? "the atlas is busy, sending again shortly…" : st.sendError ? `Not sent: ${esc(st.sendError)} <button id="site-scan-resend" type="button" class="site-scan-more">Retry</button>` : "sending…"}</span>` : "");
    const callout = top.length && st.callout ? `<div class="site-scan-callout" role="status"><b>★ Top 100!</b> This system will be added to the atlas: ${esc(top.join(", "))}.<button id="site-scan-callout-x" type="button" aria-label="Close">×</button></div>` : "";
    return `<div class="site-scan-row"><span class="site-scan-tag${top.length ? " top" : ""}"${top.length ? ` title="Top 100: ${esc(top.join(", "))}"` : ""}>${top.length ? "★ Top 100 · " : ""}Scanned on this device</span>${choice}<button id="site-scan-tag" class="site-scan-more" type="button" aria-expanded="${st.infoOpen ? "true" : "false"}" aria-controls="site-scan-info">What is sent? <span aria-hidden="true">▾</span></button></div>${callout}
<div id="site-scan-info" class="site-scan-info"${st.infoOpen ? "" : " hidden"}>
<p>This system was scanned in your browser by the atlas scanner, the same engine that builds the atlas.${sent || (top.length && url) ? "" : " Nothing has left your device."}</p>
${top.length ? `<p class="site-scan-top">★ This system breaks into the top 100: <b>${esc(top.join(", "))}</b>. Systems in a top-100 list are always added; adding any other system is up to you.</p>` : ""}
<p>${KEPT}</p>
<p>Remember my choice: every system you scan in this browser is added at once. Untick it to stop.</p>
<p>${SENT}${cfg().scanRelayNote ? " " + esc(cfg().scanRelayNote) : ""}</p>
<p><a href="contribute.html">Scan more systems with this device: Contribute →</a></p>
</div>`;
  }

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
      if (box.innerHTML !== html) box.innerHTML = html;
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
    if (box.innerHTML !== html) box.innerHTML = html;
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
    else if (t.id === "site-scan-callout-x") { if (st) { st.callout = false; render(); } }
    else if (t.id === "site-scan-resend") { if (st) send(address); }
    else if (t.id === "site-scan-tag") { const s = states.get(address) || {}; s.infoOpen = !s.infoOpen; states.set(address, Object.assign(states.get(address) || {}, s)); render(); }
    else if (t.id === "site-scan-always") {
      jsonSet(ALWAYS_KEY, t.checked);
      const s = states.get(address) || { phase: "done" };
      if (t.checked && !s.send && !wasSent(address)) { s.send = true; states.set(address, s); setQueued(address, true); schedule(address); }
      render();
    }
    else if (t.id === "site-scan-send") {
      const s = states.get(address) || { phase: "done" };
      s.send = t.checked;
      states.set(address, s);
      setQueued(address, s.send);
      if (s.send) schedule(address); else { clearTimeout(pending.get(address)); pending.delete(address); }
      render();
    }
  });

  // modern.js calls this after a system is opened (before the scanned data, if any, is shown)
  globalThis.dvSystemOpened = (info) => {
    const address = info.address;
    if (!open || open.address !== address) {
      for (const a of [...pending.keys()]) if (a !== address) send(a);
      if (open && states.get(open.address)?.phase === "scanning") cancel(open.address);
    }
    let auto = null;
    try { auto = sessionStorage.getItem("dv.scan.auto"); if (auto === address) sessionStorage.removeItem("dv.scan.auto"); } catch (_) {}
    const searched = globalThis.dvSearchedAddress === address || auto === address;   // auto: "Open" on the Contribute page
    globalThis.dvSearchedAddress = null;
    open = { address, unscanned: !!info.unscanned, slim: !!info.slim, nomap: !!info.nomap, noloot: !!info.noloot };
    const go = () => {
      // no loot numbers in the atlas: only on request ("Scan loot", site-loot.js); a loot scan made here earlier shows at once
      const lootHere = open.noloot && globalThis.dvLootSaved ? globalThis.dvLootSaved(address) : null;
      if (lootHere && globalThis.dvFillExtras) setTimeout(() => { if (open && open.address === address) globalThis.dvFillExtras(address, lootHere); }, 0);
      if (open.nomap && maps.has(address)) { setTimeout(() => showMap(address), 0); return; }
      // no published map: draw it on this device straight away (opening the system is the consent)
      if (open.nomap && !["scanning", "drawing", "done"].includes(states.get(address)?.phase)) { setTimeout(() => { if (open && open.address === address) start(address); }, 0); return; }
      const c = cached(address);
      if (c && c.status === 0) {
        // a top-100 system found earlier and not sent yet: it is always added
        if (topNames(c).length && !wasSent(address)) { const s = Object.assign(states.get(address) || { phase: "done" }, { send: true }); states.set(address, s); schedule(address); }
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
  // (the explanation is part of the page now and stays open until "What is sent?" is pressed again)
  function watch() {
    const content = document.getElementById("viewer-content");
    if (content) new MutationObserver(render).observe(content, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  setTimeout(sweep, 3000);   // saved systems from before the address check
  document.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest("#search")) rcLoad(); }, true);
})();
