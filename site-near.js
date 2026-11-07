/* site-near.js (SITE integration 2026-11-06, user: "we build the pathfinder on the website and the user checks in with each
 * jump, either via glyphs or name"): the "Near me" page (#/near) and its check-in panel. Preview build work-v144-near.
 *
 *   Where you are  -> 12 glyphs, 16-digit address or signal booster XXXX:YYYY:ZZZZ:SSSS (galaxy = the Search dialog's choice)
 *   What you want  -> the viewer's own filter meanings (core.js systemQuery: modules, reward, rooms, crates, containers)
 *   Search         -> atlas rows first (instant), then scan outward region by region in this browser (scan/bulk-worker.js,
 *                     scan/w29d_rc.js). SpookBox contents are not searched (bulk-worker.js scans with loot:false; a loot scan is far
 *                     slower and the atlas has few values to estimate from).
 *   Upload (user 2026-11-07, "the systems get marked and because the dont break a top 100, they dont get rescanned, thusly not wasting a
 *                     contributors time"): every Galaxy 0 system the scan finishes goes to the atlas like a Contribute scan (site-scan.js
 *                     dvNearQueue, no loot); one that reaches a top-100 list is scanned once more with the viewer's scan and sent through the
 *                     viewer's upload instead (dvUploadFind, loot included), one upload per system. Never sent: position, target, range, wants, scout name (user 2026-11-07),
 *                     check-ins. The scan skips systems in the atlas, in this browser's records and in Contribute's done list, but still lists
 *                     their matches (dv.near.rows keeps the last 3000 finished rows).
 *   Check-in       -> after each jump: glyphs, address, booster or system name -> distance left, change, jumps left, direction.
 * Conversions (NEAR_FACTS.md): booster X=(XXXX+0x801)&0xFFF, Z likewise, Y=(YYYY+0x81)&0xFF, SSS=SSSS&0xFFF; reverse +0x7FF/+0x7F.
 * Distance = 400 LY * |signed region difference| (Y included, like NMS Hub). Position inside a region is not known.
 * The page keeps its state in localStorage "dv.near.v1" (every access in try/catch). */
(function () {
  "use strict";
  const KEY = "dv.near.v1";
  const W29D_V = "fb03172ebf393002";   // same as site-scan.js (integrate.py checks that the two agree)
  const LY = 400, SAFE = 0.85, MAX_MATCH = 20, RECYCLE = 300, RMAX = 40, NAME_MAX_LY = 2500, PURPLE_LO = 0x3E8, PURPLE_HI = 0x428;
  const HUB = "https://map.nomansskyhub.app/?arrival=1&addr={glyphs}&galaxy={galaxy}";   // arrival = the position you are at (tested 2026-11-06)
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hex = (n, w) => (n >>> 0).toString(16).toUpperCase().padStart(w, "0");
  const num = (n) => Math.round(n).toLocaleString("en-US");
  const gname = (b) => (globalThis.dvGalaxy ? dvGalaxy.label(b) : b === 0 ? "Euclid" : "Galaxy " + (b + 1));

  // ---------------------------------------------------------------- pure helpers (tested by site12/near_check.mjs)
  const signed = (v, bits) => (v >= (1 << (bits - 1)) ? v - (1 << bits) : v);
  const addrOf = (sys, gal, x, y, z) => "000" + hex(sys, 3) + hex(gal, 2) + hex(y & 255, 2) + hex(z & 4095, 3) + hex(x & 4095, 3);
  function coordsOf(a) {
    const lo = parseInt(a.slice(8), 16) >>> 0;
    return { x: signed(lo & 0xfff, 12), z: signed((lo >>> 12) & 0xfff, 12), y: signed(lo >>> 24, 8), sys: parseInt(a.slice(3, 6), 16), gal: parseInt(a.slice(6, 8), 16) };
  }
  const isPurple = (sys) => sys >= PURPLE_LO && sys <= PURPLE_HI;
  const glyphsOf = (a) => "0" + a.slice(3, 6) + a.slice(8);                 // as the viewer shows them (planet digit 0)
  const hubGlyphs = (a) => "0" + a.slice(3, 6) + a.slice(8);                 // the normal 12 hex code (user 2026-11-07); same as glyphsOf
  function boosterOf(a) {
    const lo = parseInt(a.slice(8), 16) >>> 0, X = lo & 0xfff, Z = (lo >>> 12) & 0xfff, Y = lo >>> 24;
    return hex((X + 0x7FF) & 0xfff, 4) + ":" + hex((Y + 0x7F) & 0xff, 4) + ":" + hex((Z + 0x7FF) & 0xfff, 4) + ":" + hex(parseInt(a.slice(3, 6), 16), 4);
  }
  // text -> {ok, kind, address (planet digit 0), gal, x, y, z, sys, ownGal} or {ok:false, error}
  function parsePos(text, defGal) {
    const t = String(text || "").trim().toUpperCase();
    if (!t) return { ok: false, empty: true, error: "" };
    const m = /^([0-9A-F]{4})\s*:\s*([0-9A-F]{4})\s*:\s*([0-9A-F]{4})\s*:\s*([0-9A-F]{4})$/.exec(t);
    if (m) {
      const [X, Y, Z, S] = m.slice(1).map((h) => parseInt(h, 16));
      if (X > 0xfff || Z > 0xfff || S > 0xfff) return { ok: false, error: "A booster group is above 0FFF (X, Z and the last group go from 0000 to 0FFF)." };
      if (Y > 0xff) return { ok: false, error: "The second booster group (height) goes from 0000 to 00FF." };
      const g = Number.isInteger(defGal) ? defGal : 0;
      const a = addrOf(S, g, (X + 0x801) & 0xfff, (Y + 0x81) & 0xff, (Z + 0x801) & 0xfff);
      return Object.assign({ ok: true, kind: "booster", address: a, gal: g, ownGal: false }, coordsOf(a));
    }
    const h = t.replace(/[\s-]/g, "");
    if (/^[0-9A-F]{12}$/.test(h)) {
      const g = Number.isInteger(defGal) ? defGal : 0;
      const a = "000" + h.slice(1, 4) + hex(g, 2) + h.slice(4);
      return Object.assign({ ok: true, kind: "glyphs", address: a, gal: g, ownGal: false }, coordsOf(a));
    }
    if (/^[0-9A-F]{16}$/.test(h)) {
      if (h.slice(0, 2) !== "00") return { ok: false, error: "A 16-digit address starts with 00." };
      const a = "000" + h.slice(3);
      return Object.assign({ ok: true, kind: "address", address: a, gal: parseInt(h.slice(6, 8), 16), ownGal: true }, coordsOf(a));
    }
    if (/^[0-9A-F:]+$/.test(h) && h.includes(":")) return { ok: false, error: "A booster has four groups of four digits, like 0DEC:007D:06C0:0139." };
    if (/^[0-9A-F]{1,11}$/.test(h)) return { ok: false, partial: true, error: `${h.length} of 12 glyphs entered. Add ${12 - h.length} more.` };
    return { ok: false, error: "Type 12 glyph digits, a 16-digit address or a booster like 0DEC:007D:06C0:0139." };
  }
  const dist = (a, b) => LY * Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const coreDist = (a) => LY * Math.hypot(a.x, a.y, a.z);
  const jumpsFor = (d, range) => (d <= 0 ? 0 : Math.max(1, Math.ceil(d / (SAFE * Math.max(1, range)))));
  const sameRegion = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
  // angle in degrees between the jump you made (from -> to) and the straight line from -> target; null when undefined
  function offLine(from, to, target) {
    const m = [to.x - from.x, to.y - from.y, to.z - from.z], l = [target.x - from.x, target.y - from.y, target.z - from.z];
    const lm = Math.hypot(...m), ll = Math.hypot(...l);
    if (!lm || !ll) return null;
    const c = (m[0] * l[0] + m[1] * l[1] + m[2] * l[2]) / (lm * ll);
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  // region offsets of one shell (integer distance R, (R-1)^2 < d^2 <= R^2), nearest first
  function shell(R) {
    if (R === 0) return [[0, 0, 0, 0]];
    const lo = (R - 1) * (R - 1), hi = R * R, out = [];
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > lo && d2 <= hi) out.push([dx, dy, dz, d2]);
    }
    return out.sort((p, q) => p[3] - q[3] || p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  }
  const inGalaxy = (x, y, z) => x >= -2048 && x <= 2047 && z >= -2048 && z <= 2047 && y >= -128 && y <= 127;
  const fmtTime = (s) => {
    if (!isFinite(s)) return "a very long time";
    if (s < 90) return "about " + Math.max(1, Math.round(s)) + " s";
    if (s < 5400) return "about " + Math.round(s / 60) + " min";
    if (s < 172800) return "about " + (Math.round(s / 360) / 10) + " hours";
    return "about " + Math.round(s / 86400) + " days";
  };

  // ---------------------------------------------------------------- state
  const DEF = { v: 1, pos: "", gal: null, range: 1000, speed: "", wants: { mods: "4", reward: "", rewardModule: "", maxRooms: "", minCrates: "", minBriefcases: "", minTall: "", hasMap: false, purple: false }, trip: null };
  let S = JSON.parse(JSON.stringify(DEF));
  let storeOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (!j || j.v !== 1) return;
      S = Object.assign({}, DEF, j, { wants: Object.assign({}, DEF.wants, j.wants || {}) });
    } catch (_) { storeOk = false; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); storeOk = true; } catch (_) { storeOk = false; }
  }
  const cores = Math.max(1, navigator.hardwareConcurrency || 2);
  const phone = (() => { try { return matchMedia("(pointer: coarse)").matches; } catch (_) { return false; } })();
  const SPEEDS = { gentle: 1, balanced: Math.max(1, Math.floor(cores / 2)), max: Math.max(1, cores - 1) };
  const speedKey = () => (SPEEDS[S.speed] ? S.speed : phone ? "gentle" : "balanced");
  function workerCount() {
    let n = SPEEDS[speedKey()];
    try { const cap = Number(sessionStorage.getItem("dv.near.cap")); if (cap >= 1) n = Math.min(n, cap); } catch (_) {}   // test hook: caps the workers
    return Math.max(1, n);
  }

  // ---------------------------------------------------------------- loaders
  const mc = new MessageChannel(), yq = [];
  mc.port1.onmessage = () => { const f = yq.shift(); if (f) f(); };
  const yieldMain = () => new Promise((r) => { yq.push(r); mc.port2.postMessage(0); });
  let rcP = null, verP = null, coreP = null, statsP = null;
  function rcLoad() {
    if (!rcP) rcP = new Promise((ok, bad) => {
      if (globalThis.W29dRC) return ok(globalThis.W29dRC);
      const s = document.createElement("script");
      s.src = "scan/w29d_rc.js?v=" + W29D_V;
      s.onload = () => (globalThis.W29dRC ? ok(globalThis.W29dRC) : bad(new Error("W29dRC missing")));
      s.onerror = () => bad(new Error("scan/w29d_rc.js did not load"));
      document.head.appendChild(s);
    }).then((W) => fetch("scan/w29d_rc.wasm?v=" + W29D_V).then((r) => { if (!r.ok) throw new Error("scan/w29d_rc.wasm " + r.status); return r.arrayBuffer(); }).then((b) => W.load(b)))
      .catch((e) => { rcP = null; throw e; });
    return rcP;
  }
  function version() {
    if (!verP) verP = fetch("scan/w29.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("scan/w29.json " + r.status); return r.json(); })
      .then((m) => String(m.js_sha256 || "").slice(0, 8) + String(m.wasm_sha256 || "").slice(0, 8)).catch((e) => { verP = null; throw e; });
    return verP;
  }
  const core = () => coreP || (coreP = import("./core.js"));
  function stats() {
    if (!statsP) statsP = fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return statsP;
  }
  const sysName = (a) => { try { return (globalThis.dvSystemName && dvSystemName(a)) || ""; } catch (_) { return ""; } };

  // ---------------------------------------------------------------- the filter (the viewer's meanings)
  function filterOf(w) {
    return { q: "", galaxy: "", hasMap: !!w.hasMap, hideDone: false, region: "", preset: "", reward: w.reward || "", rewardModule: w.rewardModule || "", spookbox: "",
      maxRooms: w.maxRooms || "", maxFloors: "", noStairs: false, noHangar: false, minTotal: "", minModules: w.mods || "", minCrates: w.minCrates || "", minBriefcases: w.minBriefcases || "",
      minTall: w.minTall || "", sort: "modules", groups: { frigate: true, briefcases: true, tall: true } };
  }
  // a worker row (bulk-worker.js) in the shape of an atlas row, so the viewer's own matcher judges both
  function viewerRow(address, r) {
    return { address, galaxy: parseInt(address.slice(6, 8), 16), frigate_modules: r.frigate_modules, frigate_modules_ambiguous: r.frigate_modules_ambiguous, salvage_crates: r.crates, footlockers: r.footlockers,
      briefcases: r.briefcases, tall_lockers: r.tall_lockers, rooms: r.rooms, floors: r.floors, stair_pieces: r.stairs, hangar_pieces: r.hangars, reward_name: r.reward_name, reward_class: r.reward_class, preset: r.preset,
      items_value: r.items_value, items_nanites: r.items_nanites };
  }
  const wantsText = (w) => {
    const l = [];
    if (w.mods) l.push(w.mods + "+ predicted modules");
    if (w.rewardModule || w.reward) l.push("end reward " + [w.reward && "class " + w.reward, w.rewardModule].filter(Boolean).join(", "));
    if (w.maxRooms) l.push("at most " + w.maxRooms + " rooms");
    if (w.minCrates) l.push(w.minCrates + "+ salvage crates");
    if (w.minBriefcases) l.push(w.minBriefcases + "+ briefcases");
    if (w.minTall) l.push(w.minTall + "+ tall lockers");
    if (w.hasMap) l.push("published map");
    return l.join(", ") || "any derelict";
  };

  // ---------------------------------------------------------------- run state
  let atlasAny = null, calibBusy = false, findPos = null, dlg = null, run = null, nameRun = null, results = [], atlasInfo = null, msPer = 0, msN = 0, calibN = 0, calibrating = null, lastEst = null, atlasSet = null, resultFilter = null, resultFilterObj = null;
  const rowsNow = () => { try { const h = globalThis.dvHome && dvHome.rows && dvHome.rows(); return h && h.rows && h.rows.length ? h.rows : null; } catch (_) { return null; } };
  const msg = (id, html) => { const e = $(id); if (e) e.innerHTML = html; };

  // ---- where you are
  function curPos() {
    const gal = S.gal != null ? S.gal : globalThis.dvGalaxy ? dvGalaxy.selected() : 0;
    const p = parsePos($("nr-pos") ? $("nr-pos").value : S.pos, gal);
    if (p.ok && p.ownGal) p.gal = parseInt(p.address.slice(6, 8), 16);
    return p;
  }
  function setGalaxy(b) {
    S.gal = b;
    const sel = $("nr-gal"); if (sel && sel.value !== String(b)) sel.value = String(b);
    const s2 = $("gal-select"); if (s2 && s2.value !== String(b)) s2.value = String(b);   // the Search dialog's choice stays the same one
    galNote();
  }
  function showPosNote() {
    const p = curPos(), box = $("nr-pos-note");
    if (!box) return;
    if (p.empty) { box.innerHTML = ""; box.className = "nr-note"; return; }
    if (!p.ok) { box.textContent = p.error; box.className = p.partial ? "nr-note" : "nr-note bad"; return; }
    if (p.ownGal) setGalaxy(p.gal);
    const how = p.kind === "booster" ? "Booster read as" : p.kind === "address" ? "Address read as" : "Glyphs read as";
    box.className = "nr-note ok";
    box.innerHTML = `${how} region ${p.x}, ${p.y}, ${p.z}, system ${hex(p.sys, 3)}${isPurple(p.sys) ? " (purple star)" : ""}. ${num(coreDist(p))} LY from the galaxy core.` + (p.kind === "booster" ? ` Glyphs: <code>${glyphsOf(p.address)}</code> (${esc(gname(p.gal))})` : "");
    rcLoad().then((rc) => {
      if (curPos().address !== p.address) return;
      const code = rc.validSystemUA(p.gal | (p.sys << 8), (parseInt(p.address.slice(8), 16)) >>> 0, true);
      if (code === 1 || code === 2) { box.className = "nr-note bad"; box.textContent = code === 2 ? "This region is in the galaxy core, there are no systems here." : "These coordinates are outside the galaxy."; }
      else if (code === 3 || code === 4) box.innerHTML += `<br><span class="bad">System ${hex(p.sys, 3)} does not exist in this region. Check the last glyphs. Region and distance still work.</span>`;
    }).catch(() => {});
  }
  const galNote = () => {
    const b = $("nr-gal") ? Number($("nr-gal").value) : 0, n = $("nr-gal-note");
    if (n) n.innerHTML = globalThis.dvGalaxy ? dvGalaxy.notes(b).map(esc).join(" ") : "";
  };

  // ---------------------------------------------------------------- atlas pass
  async function waitRows(ms) {
    const end = Date.now() + ms;
    for (;;) { const r = rowsNow(); if (r) return r; if (Date.now() > end) return null; await new Promise((x) => setTimeout(x, 300)); }
  }
  async function atlasPass(w, pos, token) {
    atlasSet = new Set(); atlasAny = new Set();
    if (pos.gal !== 0) return { skipped: "gal" };
    const rows = await waitRows(60000);
    if (!rows) return { skipped: "rows" };
    const { systemQuery } = await core();
    const f = filterOf(w), q = systemQuery(f), found = [];
    let full = 0, hits = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.galaxy !== 0) continue;
      atlasAny.add(r.address);
      if (!r.slim && !r.pruned && !r.deferred) { full++; atlasSet.add(r.address); }
      if (q.matches(r)) {
        hits++;
        const c = coordsOf(r.address);
        found.push({ address: r.address, gal: 0, x: c.x, y: c.y, z: c.z, sys: c.sys, d: dist(pos, c), row: r, src: "atlas" });
      }
      if ((i & 16383) === 16383) { await yieldMain(); if (token !== runToken) return { cancelled: true }; }
    }
    found.sort((a, b) => a.d - b.d || (a.address < b.address ? -1 : 1));
    return { found: found.slice(0, MAX_MATCH), hits, full, total: rows.length };
  }
  let runToken = 0;

  // ---------------------------------------------------------------- upload and the "scanned" record
  // user 2026-11-07: "the systems get marked and because they dont break a top 100, they dont get rescanned, thusly not wasting a contributors
  // time". Every system this scan finishes in Galaxy 0 goes to the atlas the way Contribute sends its scans (site-scan.js dvNearQueue: the same
  // v3 body, batches, retry and sent record, no loot). A system that reaches a top-100 list is scanned once more with the viewer's scan
  // (loot included) and sent through the viewer's upload (dvUploadFind) INSTEAD of the batch: one upload per system. Stopping keeps what was
  // finished. Other galaxies are never sent: this browser only remembers them. Never sent: position, target, range, wants, check-ins.
  const MAX_UP = 25, DONE_KEY = "dv.contrib.done", ROWS_KEY = "dv.near.rows", ROWS_MAX = 3000;
  const upQ = [], upSeen = new Set(), upStats = { found: 0, failed: 0, busy: false, queued: 0 };
  const relayOn = () => !!((globalThis.DV_CONFIG || {}).scanRelay) && typeof globalThis.dvNearQueue === "function";
  const KEYS = ["frigate_modules", "frigate_modules_ambiguous", "crates", "footlockers", "briefcases", "tall_lockers", "rooms", "floors", "stairs", "hangars", "reward_name", "reward_class", "preset"];
  const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  // what this browser finished (any galaxy): compact rows, newest last, so a rerun can skip them and still judge them against new wants
  let nearRows = null, rowsDirty = 0, doneAdd = [];
  const rowsMap = () => nearRows || (nearRows = new Map(Object.entries(jget(ROWS_KEY, {}))));
  const rowFromArr = (arr) => { const o = {}; KEYS.forEach((k, i) => { if (arr[i] != null) o[k] = arr[i]; }); return o; };
  function rowsFlush() {
    if (!nearRows) return;
    rowsDirty = 0;
    while (nearRows.size > ROWS_MAX) nearRows.delete(nearRows.keys().next().value);
    jset(ROWS_KEY, Object.fromEntries(nearRows));
    if (doneAdd.length) {
      const done = jget(DONE_KEY, []), have = new Set(done);
      for (const a of doneAdd) if (!have.has(a)) done.push(a);
      doneAdd = [];
      jset(DONE_KEY, done.slice(-40000));
    }
  }
  function rowsPut(address, row) {
    const m = rowsMap();
    m.delete(address);
    m.set(address, row ? KEYS.map((k) => (row[k] === undefined ? null : row[k])) : []);
    if (++rowsDirty >= 200) rowsFlush();
  }
  addEventListener("pagehide", () => { try { rowsFlush(); } catch (_) {} });
  // the published list of systems without a derelict (Contribute's known set; singles with a derelict are already atlas rows)
  let knownP = null;
  function knownNone() {
    if (!knownP) knownP = (async () => {
      const get = (p) => fetch(p, { cache: "no-cache" }).then((r) => (r.ok ? r : null)).catch(() => null);
      let r = await get("singles/none.csv"), text = "";
      if (r) text = await r.text();
      else if ((r = await get("singles/none.csv.gz"))) { try { text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text(); } catch (_) { text = ""; } }
      const out = new Set();
      for (const m of text.matchAll(/^(?:([0-9A-Fa-f]{16})(?=[,\s]|$)|([0-9A-Fa-f]{12}),(\d{1,3})(?=,))/gm)) out.add(m[1] ? m[1].toUpperCase() : ("000" + m[2].slice(1, 4) + Number(m[3]).toString(16).padStart(2, "0") + m[2].slice(4)).toUpperCase());
      return out;
    })();
    return knownP;
  }
  function fullScan(address, v) {
    return new Promise((ok) => {
      let w = null, t = 0;
      const end = (x) => { clearTimeout(t); try { w && w.terminate(); } catch (_) {} ok(x); };
      t = setTimeout(() => end(null), 120000);
      try { w = new Worker("scan/scan-worker.js?v=" + encodeURIComponent(v)); } catch (_) { return end(null); }
      w.onmessage = (e) => { if (e.data && e.data.type === "progress") return; end(e.data); };
      w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); end(null); };
      w.postMessage({ address });
    });
  }
  const batchItem = (a, d, size) => d.status === 0
    ? (d.v3 && d.v3.row && d.v3.extras ? { a, ver: String(d.version || ""), row: d.v3.row, ext: d.v3.extras, ms: d.ms, p: (d.row && d.row.preset) || "", w: size, sp: speedKey() } : null)
    : { a, ver: String(d.version || ""), ms: d.ms, w: size, sp: speedKey() };
  async function drainUp() {
    if (upStats.busy) return;
    upStats.busy = true;
    try {
      while (upQ.length) {
        const { a, d, size } = upQ.shift();
        let sent = false;
        try {
          const full = await fullScan(a, await version());
          if (full && full.ok && full.status === 0) { const r = await dvUploadFind(a, full); if (r && (r.queued || r.sent)) { sent = true; if (r.queued) upStats.found++; } }
        } catch (e) { try { console.warn("[near me] top-100 upload", a, e); } catch (_) {} }
        if (!sent) { upStats.failed++; const it = batchItem(a, d, size); if (it) globalThis.dvNearQueue(it); }   // the full scan failed: still sent once, from the batch
        paintScan();
      }
    } finally { upStats.busy = false; }
  }
  // every finished system, match or not
  function finished(r, address, d) {
    try {
      rowsPut(address, d.status === 0 ? d.row : null);
      if (r.gal !== 0 || !relayOn() || r.atlasAny.has(address) || r.noUp.has(address)) return;   // another galaxy, no relay, or the atlas has it: no upload
      if (d.status === 0 && !(d.v3 && d.v3.row && d.v3.extras)) return;   // no valid upload line: not sent, so not marked
      doneAdd.push(address);
      const top = d.status === 0 && r.lists && !upSeen.has(address) && r.up < MAX_UP && globalThis.dvTopLists.breaks(d.row, d.row, r.lists).length > 0;   // Contribute's call
      if (top) { upSeen.add(address); r.up++; upQ.push({ a: address, d, size: r.size }); drainUp(); return; }
      upStats.queued++;
      globalThis.dvNearQueue(batchItem(address, d, r.size));
    } catch (_) {}
  }
  // a skipped address this browser holds a row of: still listed when it matches
  function recMatch(r, address) {
    r.judged++;
    const arr = rowsMap().get(address);
    let row = arr && arr.length ? rowFromArr(arr) : r.recRows.get(address);
    if (!row || !r.q.matches(viewerRow(address, row))) return;   // [] (no derelict) has no row: no want can match it
    const c = coordsOf(address);
    addResult({ address, gal: r.gal, x: c.x, y: c.y, z: c.z, sys: c.sys, d: dist(r.pos, c), row: viewerRow(address, row), src: "scan", purple: isPurple(c.sys) });
    if (++r.matches >= MAX_MATCH) stopScan(`Stopped: ${MAX_MATCH} matches found.`);
  }
  const upLine = () => (upStats.queued || upStats.found || upStats.failed || upQ.length || upStats.busy)
    ? `<p class="nr-prog" role="status">Added to the atlas: <b>${num(upStats.queued + upStats.found)}</b> systems${upStats.found ? `, ${upStats.found} in a top 100` : ""}${upQ.length || upStats.busy ? " (checking more top-100 finds)" : ""}${upStats.failed ? `, ${upStats.failed} top-100 finds sent without loot` : ""}.</p>` : "";

  // ---------------------------------------------------------------- scan
  function spawn(v) {
    const w = new Worker("scan/bulk-worker.js?v=" + encodeURIComponent(v));
    w.count = 0;
    return w;
  }
  const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : 0; };
  // real speed of this device with the workers the speed setting will use: every worker scans a few systems spread over a region;
  // the first one of each only loads the scanner and is dropped; msPer = wall milliseconds per system for all workers together
  function calibrate(pos) {
    const n = workerCount();
    if (msPer && msN === n) return Promise.resolve(msPer);
    if (calibrating && calibN === n) return calibrating;
    calibN = n; msPer = 0;
    const mine = calibrating = (async () => {
      const [rc, v] = await Promise.all([rcLoad(), version()]);
      let x = pos.x, y = pos.y, z = pos.z, cnt = rc.regionCount(pos.gal, x, y, z);
      if (!(cnt >= 60)) { x = -994; y = -50; z = 1417; cnt = rc.regionCount(pos.gal, x, y, z); }
      const K = 6, step = Math.max(1, Math.floor((cnt - 9) / (n * K))), ws = Array.from({ length: n }, () => spawn(v));
      const one = (w, sys) => new Promise((ok, bad) => { w.onmessage = (e) => (e.data.ok ? ok(e.data) : bad(new Error(e.data.error))); w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); bad(new Error("scanner did not load")); }; w.postMessage({ address: addrOf(sys, pos.gal, x, y, z) }); });
      try {
        await Promise.all(ws.map((w, i) => one(w, 1 + i * K * step)));   // warm-up
        const t0 = performance.now();
        await Promise.all(ws.map(async (w, i) => { for (let j = 1; j < K; j++) await one(w, 1 + (i * K + j) * step); }));
        const ms = (performance.now() - t0) / (n * (K - 1));
        if (mine === calibrating) { msPer = Math.max(1, Math.round(ms)); msN = n; }
      } finally { for (const w of ws) w.terminate(); }
      return msPer;
    })().catch((e) => { if (mine === calibrating) calibrating = null; throw e; });
    return calibrating;
  }
  // how likely a system matches, from the atlas (the site's own counts), and the wait that means
  async function estimate(w, pos) {
    const f = filterOf(w);
    const onlyMods = !w.rewardModule && !w.reward && !w.maxRooms && !w.minCrates && !w.minBriefcases && !w.minTall;
    let share = null, basis = "", total = 0;
    if (onlyMods) {
      const st = await stats(), h = st && st.galaxies && st.galaxies["0"] && st.galaxies["0"].histogram;
      if (h) { total = h.reduce((a, b) => a + b, 0); const m = Number(w.mods || 0); share = h.slice(m).reduce((a, b) => a + b, 0) / total; basis = "the atlas module counts"; }
    }
    if (share == null && atlasInfo && atlasInfo.full) { share = atlasInfo.hits / atlasInfo.full; total = atlasInfo.full; basis = "the atlas rows"; }
    return { share, total, basis, perMatch: share > 0 ? 1 / share : Infinity };
  }
  function estHtml(e, w, pos) {
    const n = workerCount();
    const rate = msPer && msN === n ? 1000 / msPer : 0;
    const mods = Number(w.mods || 0);
    const l = [];
    if (e.share == null) l.push("No atlas numbers for this want, so there is no estimate. The scan still works.");
    else if (e.share === 0) l.push(`None were seen in the atlas (${num(e.total)} systems), so the search may never find one. You can still start it.`);
    else {
      l.push(`In the atlas about 1 system in ${num(e.perMatch)} matches (from ${e.basis}${pos.gal !== 0 ? "; Galaxy 0 numbers, other galaxies are not measured" : ""}). The scan is likely to need about ${num(e.perMatch)} systems for the first match.`);
      if (rate) l.push(`Measured on this device with ${n} worker${n === 1 ? "" : "s"}: about ${rate.toFixed(1)} systems per second. First match ${fmtTime(e.perMatch / rate)}, ${MAX_MATCH} matches ${fmtTime(e.perMatch * MAX_MATCH / rate)}. A guess: real times vary a lot.`);
    }
    const hours = e.share != null && e.share > 0 && rate && e.perMatch / rate > 3600;
    if (mods >= 7 && e.share !== 0) l.push(`<b class="warn">7+ modules is very rare. This can take hours.</b>`);
    else if (hours) l.push(`<b class="warn">This can take hours.</b>`);
    return l.map((t) => `<p>${t}</p>`).join("");
  }
  function startScan() {
    if (run) return;
    if (!lastEst) return;
    const pos = lastEst.pos, w = lastEst.w;   // the question the list on screen answers
    run = { stop: false, queue: [], workers: [], idle: [], busy: new Map(), scanned: 0, matches: 0, regions: 0, fails: 0, t0: performance.now(), R: -1, cur: [], k: 0, work: 0, refilling: false, exhausted: false, reach: 0,
      pos, gal: pos.gal, w, f: filterOf(w), purple: !!w.purple, curRegion: null, err: "", up: 0, lists: null, rec: new Set(), noUp: new Set(), judged: 0, recRows: new Map(), atlasAny: atlasAny || new Set(), none: new Set() };
    (async () => {
      try {
        const [rc, v, c] = await Promise.all([rcLoad(), version(), core()]);
        if (!run || run.stop) return;
        run.rc = rc; run.q = c.systemQuery(run.f); run.v = v;
        try {
          // rec = addresses judged from values this browser actually holds (a saved row, a viewer scan, or "no derelict"): not scanned again,
          // still listed when they match. noUp = addresses already uploaded or finished (Contribute's done list, the viewer's record, saved rows):
          // when no row is held they ARE scanned (so a changed want never loses a match) but never uploaded again.
          const gh = hex(run.gal, 2);
          if (run.gal === 0) {
            if (globalThis.dvFindRecord) for (const a of dvFindRecord()) run.noUp.add(a);
            for (const a of jget(DONE_KEY, [])) run.noUp.add(a);
            if (globalThis.dvDeviceScans) for (const x of dvDeviceScans()) if (x.row) { run.recRows.set(x.address, x.row); run.rec.add(x.address); }
            if (relayOn()) { run.none = await knownNone(); for (const a of run.none) { run.rec.add(a); run.noUp.add(a); } if (globalThis.dvTopLists) run.lists = await dvTopLists.load(); }
          }
          for (const [a, arr] of rowsMap()) if (a.slice(6, 8) === gh) { run.rec.add(a); run.noUp.add(a); }   // [] = finished with no derelict: it can match no want
        } catch (_) {}
        if (!run || run.stop) return;
        const n = workerCount(); run.size = n;
        for (let i = 0; i < n; i++) { const wk = spawn(v); wire(wk); run.workers.push(wk); run.idle.push(wk); }
        paintScan();
        run.timer = setInterval(paintScan, 500);
        await refill(); pump();
      } catch (e) { stopScan("The scanner did not load: " + String((e && e.message) || e)); }
    })();
    paintScan();
  }
  function wire(wk) {
    wk.onmessage = (e) => done(wk, e.data);
    wk.onerror = (e) => { if (e.preventDefault) e.preventDefault(); done(wk, { ok: false, error: "loading the scanner: " + (e.message || "failed") }); };
  }
  async function refill() {
    const r = run;
    if (!r || r.refilling || r.exhausted || r.stop) return;
    r.refilling = true;
    try {
      while (!r.stop && r.queue.length < workerCount() * 3 + 8) {
        const reg = await nextRegion(r);
        if (r.stop) return;
        if (!reg) { r.exhausted = true; break; }
        const last = reg.n - 9, skip = (a) => { if (atlasSet && atlasSet.has(a)) return true; if (r.rec.has(a)) { recMatch(r, a); return true; } return false; };   // the atlas rule: the last 8 systems below the star count are not sure to exist; r.rec = already uploaded from this browser
        for (let s = 1; s <= last; s++) { const a = addrOf(s, r.gal, reg.x, reg.y, reg.z); if (!skip(a)) r.queue.push({ a, x: reg.x, y: reg.y, z: reg.z, sys: s, d: reg.d }); }
        if (r.purple) for (let s = PURPLE_LO; s <= PURPLE_HI; s++) {   // all 65 purple numbers are valid in any real region (checked with W29d)
          if (s < reg.n) continue;
          r.queue.push({ a: addrOf(s, r.gal, reg.x, reg.y, reg.z), x: reg.x, y: reg.y, z: reg.z, sys: s, d: reg.d });
        }
        r.regions++;
        if (!r.queue.length) continue;
      }
    } finally { r.refilling = false; }
    pump();
  }
  async function nextRegion(r) {
    for (;;) {
      if (r.stop) return null;
      if (r.k >= r.cur.length) { r.R++; if (r.R > RMAX) return null; r.cur = shell(r.R); r.k = 0; continue; }
      const o = r.cur[r.k++], x = r.pos.x + o[0], y = r.pos.y + o[1], z = r.pos.z + o[2];
      if (!inGalaxy(x, y, z)) continue;
      const n = r.rc.regionCount(r.gal, x, y, z);
      if (++r.work % 3 === 0) await yieldMain();
      if (n >= 9) return { x, y, z, n, d: LY * Math.sqrt(o[3]) };
    }
  }
  function pump() {
    const r = run;
    if (!r || r.stop) return;
    while (r.idle.length && r.queue.length) {
      const wk = r.idle.pop(), it = r.queue.shift();
      if (wk.count >= RECYCLE) { wk.terminate(); const i = r.workers.indexOf(wk), nw = spawn(r.v); wire(nw); r.workers[i] = nw; r.busy.set(nw, it); r.reach = Math.max(r.reach, it.d); nw.postMessage({ address: it.a }); continue; }
      r.busy.set(wk, it); r.reach = Math.max(r.reach, it.d);
      wk.postMessage({ address: it.a });
    }
    if (r.queue.length < workerCount() * 2) refill();
    if (r.exhausted && !r.queue.length && !r.busy.size) stopScan("Searched every region within " + num(RMAX * LY) + " LY.");
  }
  function done(wk, d) {
    const r = run;
    if (!r || r.stop || !r.busy.has(wk)) return;
    const it = r.busy.get(wk); r.busy.delete(wk);
    wk.count++;
    if (d.ok) {
      r.fails = 0; r.scanned++;
      if (d.status === 0 || d.status === 4) finished(r, it.a, d);
      if (d.status === 0 && d.row) {
        const vr = viewerRow(it.a, d.row);
        if (r.q.matches(vr)) {
          const c = coordsOf(it.a);
          addResult({ address: it.a, gal: r.gal, x: c.x, y: c.y, z: c.z, sys: c.sys, d: dist(r.pos, c), row: vr, src: "scan", purple: isPurple(c.sys) });
          if (++r.matches >= MAX_MATCH) { stopScan(`Stopped: ${MAX_MATCH} matches found.`); return; }
        }
      }
    } else {
      wk.terminate();
      const nw = spawn(r.v); wire(nw); r.workers[r.workers.indexOf(wk)] = nw; wk = nw;
      r.queue.unshift(it);
      if (++r.fails >= 6) { stopScan("The scanner keeps failing (" + String(d.error || "unknown") + "). Check the connection and try again."); return; }
    }
    r.idle.push(wk);
    pump();
  }
  function stopScan(why) {
    const r = run;
    if (!r) return;
    r.stop = true; clearInterval(r.timer);
    try { rowsFlush(); if (globalThis.dvNearFlush) dvNearFlush(); } catch (_) {}   // what was finished stays marked and goes out now; unfinished systems are not marked
    for (const wk of r.workers) { try { wk.terminate(); } catch (_) {} }
    r.workers = []; r.idle = []; r.busy.clear(); r.queue = [];
    r.endText = why || "Stopped.";
    if (r.scanned >= 30) { msPer = Math.max(1, Math.round((performance.now() - r.t0) / r.scanned)); msN = r.size || 1; }   // this device's real rate, with start-up included
    lastRun = { scanned: r.scanned, matches: r.matches, reach: r.reach, secs: (performance.now() - r.t0) / 1000, text: r.endText };
    run = null;
    paintScan(); paintResults();
  }
  let lastRun = null;
  function addResult(res) {
    if (results.some((x) => x.address === res.address)) return;
    results.push(res);
    results.sort((a, b) => a.d - b.d || (a.address < b.address ? -1 : 1));
    paintResults();
  }

  // ---------------------------------------------------------------- name check-in (nearest regions first)
  const normName = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
  async function nameSearch(query, from, gal, limitLY, rn) {
    const [rc, ready] = await Promise.all([rcLoad(), globalThis.dvNamesReady || Promise.resolve(false)]);
    if (!ready || !globalThis.NMSNames) throw new Error("the system name list did not load");
    const q = normName(query), R = Math.max(0, Math.ceil(limitLY / LY)), offs = [];
    for (let r = 0; r <= R; r++) for (const o of shell(r)) if (LY * Math.sqrt(o[3]) <= limitLY) offs.push(o);
    rn.total = offs.length;
    const hits = [];
    for (let i = 0; i < offs.length; i++) {
      if (rn.stop) break;
      const o = offs[i], x = from.x + o[0], y = from.y + o[1], z = from.z + o[2];
      rn.done = i + 1;
      if (inGalaxy(x, y, z)) {
        const n = rc.regionCount(gal, x, y, z);
        if (n >= 2) {
          for (let s = 1; s < n; s++) { const a = addrOf(s, gal, x, y, z); if (normName(NMSNames.name(a)) === q) hits.push({ address: a, x, y, z, sys: s, d: LY * Math.sqrt(o[3]) }); }
          for (let s = PURPLE_LO; s <= PURPLE_HI; s++) {
            if (s < n) continue;
            const a = addrOf(s, gal, x, y, z); if (normName(NMSNames.name(a)) === q) hits.push({ address: a, x, y, z, sys: s, d: LY * Math.sqrt(o[3]) });
          }
        }
      }
      rn.hits = hits.length;
      if (i % 4 === 0) paintNameProgress(rn);
      await yieldMain();
    }
    return hits;
  }

  // ---------------------------------------------------------------- UI
  const REWARDS = { hyperdrive: "Hyperdrive", fuel: "Fleet fuel", speed: "Fleet speed / beacon", combat: "Fleet combat", exploration: "Fleet exploration", mining: "Fleet mining", trade: "Fleet trade", reactor: "Freighter reactor" };
  // ---- glyph selector: the same keypad, preview row and look as the main search. The 16 buttons are copied from the main search dialog
  // (names, pictures and styling match); the rules come from search-input.js, which the main search uses too. Typing stays possible.
  let siP = null;
  const si = () => siP || (siP = import("./search-input.js"));
  const isTouch = () => { try { return matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0; } catch (_) { return false; } };
  const focusIn = (el) => { if (el && !isTouch()) el.focus(); };   // a phone keyboard must not pop up by itself
  function padHtml(forId) {
    const src = document.getElementById("glyph-keypad");
    let keys = "";
    if (src && src.children.length) { const c = src.cloneNode(true); c.querySelectorAll("button").forEach((b) => { b.disabled = false; b.removeAttribute("disabled"); }); keys = c.innerHTML; }
    else keys = Array.from({ length: 16 }, (_, i) => { const h = i.toString(16); return `<button type="button" data-glyph="${h.toUpperCase()}" aria-label="Add glyph ${h.toUpperCase()}"><img src="glyphs-svg/${h}.svg" alt=""></button>`; }).join("");
    return `<div class="nr-glyphs" data-for="${forId}"><div class="glyph-preview" aria-label="Glyphs entered so far" hidden></div><div class="glyph-keypad" role="group" aria-label="Tap the glyphs you see in the game">${keys}</div><div class="nr-kact"><button type="button" data-nr-del>Delete last</button><button type="button" data-nr-clr>Clear</button></div></div>`;
  }
  function syncPad(input) {
    const pad = input && dlg && dlg.querySelector(`.nr-glyphs[data-for="${input.id}"]`);
    if (!pad) return;
    si().then((m) => {
      const fmt = m.detectSearchFormat(input.value), hex = m.searchInput(input.value, "glyphs"), glyphs = fmt === "glyphs";
      const prev = pad.querySelector(".glyph-preview");
      prev.hidden = !glyphs;
      prev.innerHTML = glyphs ? Array.from({ length: 12 }, (_, i) => hex[i] ? `<img src="glyphs-svg/${hex[i].toLowerCase()}.svg" alt="">` : '<span aria-hidden="true">·</span>').join("") : "";
      const off = !glyphs || hex.length >= 12;
      pad.querySelectorAll(".glyph-keypad button").forEach((b) => { b.disabled = off; });
    });
  }
  function padClick(b) {
    const pad = b.closest(".nr-glyphs"), input = pad && $(pad.dataset.for);
    if (!input) return;
    si().then((m) => {
      if (b.dataset.glyph !== undefined) { if (m.detectSearchFormat(input.value) !== "glyphs") return; input.value = m.appendGlyph(input.value, b.dataset.glyph); }
      else if (b.hasAttribute("data-nr-del")) input.value = input.value.slice(0, -1);
      else if (b.hasAttribute("data-nr-clr")) input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));   // the same path as typing
    });
  }
  function field(id, label, html) { return `<div class="nr-f"><label for="${id}">${label}</label>${html}</div>`; }
  function build() {
    if (dlg || !document.body) return;
    dlg = document.createElement("dialog");
    dlg.id = "near-dialog"; dlg.className = "sheet nr-dialog"; dlg.setAttribute("aria-labelledby", "nr-title");
    const modsOpt = ['<option value="">Any</option>'].concat([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}">${n}+</option>`)).join("");
    dlg.innerHTML = `<div class="si-head"><img src="brand/logo-128.webp" alt=""><div><div class="eyebrow">DERELICT ATLAS</div><h2 id="nr-title">Near me</h2></div><button type="button" class="icon-button" data-nr-close aria-label="Close Near me">×</button></div>
<div class="nr-body" id="nr-body">
<p class="nr-lead">Find a derelict close to where you are, then check in after each jump to see how far is left. Systems you scan here are added to the atlas, the same as Contribute, so nobody has to scan them again. Your position, check-ins and scout name stay here.</p>
<section class="nr-trip" id="nr-trip" hidden aria-live="polite"></section>
<section class="nr-card" aria-labelledby="nr-h1"><h3 id="nr-h1">1. Where are you?</h3>
<label for="nr-pos">Glyphs, address or signal booster</label>
<input id="nr-pos" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Tap glyphs below, or type here" aria-describedby="nr-pos-note">${padHtml("nr-pos")}
<p class="nr-note" id="nr-pos-note" role="status"></p>
<div class="nr-row"><label for="nr-gal">Galaxy</label><select id="nr-gal" aria-label="Galaxy"></select></div>
<p class="nr-note" id="nr-gal-note"></p>
<details class="nr-help"><summary>Where do I find these?</summary><ul>
<li><b>Glyphs:</b> the 12-digit portal address of a planet in your system, typed as hex (0 to 9, A to F). The first digit is the planet and is ignored here.</li>
<li><b>Address:</b> the 16-digit address this site uses. It includes the galaxy.</li>
<li><b>Signal booster:</b> the four groups of galactic coordinates a signal booster shows, like 0DEC:007D:06C0:0139. The conversion follows the community formula on glyphs.had.sh. It has not been checked in-game by this project yet, so compare the result with your glyphs if you can.</li></ul></details></section>
<section class="nr-card" aria-labelledby="nr-h2"><h3 id="nr-h2">2. What do you want?</h3>
<div class="nr-grid">${field("nr-range", "Hyperdrive range (light years)", '<input id="nr-range" type="number" inputmode="numeric" min="50" max="9999" step="50">')}
${field("nr-mods", "Predicted Salvaged Frigate Modules, at least", `<select id="nr-mods">${modsOpt}</select>`)}</div>
<details class="nr-more"><summary>More wants</summary><div class="nr-grid">
${field("nr-rmod", "End reward module", `<select id="nr-rmod"><option value="">Any</option>${Object.entries(REWARDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>`)}
${field("nr-rcls", "End reward class", '<select id="nr-rcls"><option value="">Any</option><option>S</option><option>A</option><option>B</option><option>C</option></select>')}
${field("nr-rooms", "Most rooms", '<input id="nr-rooms" type="number" inputmode="numeric" min="1" max="99">')}
${field("nr-crates", "Salvage crates, at least", '<input id="nr-crates" type="number" inputmode="numeric" min="0" max="99">')}
${field("nr-brief", "Briefcases, at least", '<input id="nr-brief" type="number" inputmode="numeric" min="0" max="99">')}
${field("nr-tall", "Tall lockers, at least", '<input id="nr-tall" type="number" inputmode="numeric" min="0" max="99">')}</div>
<label class="nr-check"><input type="checkbox" id="nr-map"> Only systems with a published map (atlas list only, no scanning)</label>
<label class="nr-check"><input type="checkbox" id="nr-purple"> Also scan purple-star systems (they need the purple-star unlock in game)</label>
<p class="nr-note">SpookBox contents are not searched here: they need a slower loot scan.</p></details>
<div class="nr-actions"><button type="button" class="primary" id="nr-find">Find derelicts</button></div></section>
<section class="nr-out" id="nr-out" aria-live="polite"><p class="nr-note" id="nr-status" role="status"></p><div id="nr-scan" class="nr-card nr-scan" hidden></div><ol class="nr-list" id="nr-list"></ol></section>
</div>`;
    document.body.appendChild(dlg);
    const sel = $("nr-gal");
    sel.innerHTML = Array.from({ length: 256 }, (_, b) => `<option value="${b}">${esc(gname(b))}</option>`).join("");
    fill();
    dlg.addEventListener("click", onClick);
    dlg.addEventListener("input", onInput);
    dlg.addEventListener("change", onInput);
    dlg.addEventListener("close", onClose);
    dlg.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") { e.preventDefault(); const f = e.target.closest("[data-enter]"); if (f) { const b = $(f.dataset.enter); if (b) b.click(); } else if (e.target.id === "nr-pos" || e.target.closest(".nr-card")) $("nr-find").click(); } });
    paintTrip(); paintResults();
  }
  function fill() {
    $("nr-pos").value = S.pos || ""; syncPad($("nr-pos"));
    const gal = S.gal != null ? S.gal : globalThis.dvGalaxy ? dvGalaxy.selected() : 0;
    setGalaxy(gal);
    $("nr-range").value = S.range; $("nr-mods").value = S.wants.mods;
    $("nr-rmod").value = S.wants.rewardModule; $("nr-rcls").value = S.wants.reward; $("nr-rooms").value = S.wants.maxRooms;
    $("nr-crates").value = S.wants.minCrates; $("nr-brief").value = S.wants.minBriefcases; $("nr-tall").value = S.wants.minTall;
    $("nr-map").checked = !!S.wants.hasMap; $("nr-purple").checked = !!S.wants.purple;
    const more = dlg.querySelector(".nr-more"); if (more) more.open = !!(S.wants.rewardModule || S.wants.reward || S.wants.maxRooms || S.wants.minCrates || S.wants.minBriefcases || S.wants.minTall || S.wants.hasMap || S.wants.purple);
    showPosNote(); galNote();
  }
  function readForm() {
    S.pos = $("nr-pos").value; S.gal = Number($("nr-gal").value) || 0;
    const r = Math.round(Number($("nr-range").value)); S.range = r >= 1 && r <= 99999 ? r : 1000;
    Object.assign(S.wants, { mods: $("nr-mods").value, rewardModule: $("nr-rmod").value, reward: $("nr-rcls").value, maxRooms: $("nr-rooms").value, minCrates: $("nr-crates").value,
      minBriefcases: $("nr-brief").value, minTall: $("nr-tall").value, hasMap: $("nr-map").checked, purple: $("nr-purple").checked });
    save();
  }
  function onInput(e) {
    const t = e.target;
    if (!(t instanceof Element) || !dlg.contains(t)) return;
    if (t.id === "nr-gal") { setGalaxy(Number(t.value)); galNote(); }
    if (t.closest(".nr-card") && t.id) { readForm(); }
    if (t.id === "nr-pos" || t.id === "nr-ci") syncPad(t);
    if (t.id === "nr-pos" || t.id === "nr-gal") { showPosNote(); if (t.id === "nr-gal") { stale(); } }
    if (t.id === "nr-range") { paintResults(); paintTrip(); }
    if (t.id === "nr-speed") { S.speed = t.value; save(); recalibrate(); }
    if (t.id && /^nr-(pos|mods|rmod|rcls|rooms|crates|brief|tall|map|purple)$/.test(t.id)) stale();
  }
  // wants or position changed: the list on screen is from the earlier question
  function stale() { if (!run && results.length && !$("nr-status").dataset.stale) { $("nr-status").dataset.stale = "1"; msg("nr-status", "The list below is for the earlier position or wants. Press Find derelicts to update it."); } }
  function onClose() {
    if (run) stopScan("Stopped: the page was closed.");
    if (nameRun) nameRun.stop = true;
    if (location.hash === "#/near") history.replaceState(null, "", "#/");
  }
  function openDlg() {
    build();
    if (!dlg.open) { dlg.showModal(); }
    if (isTouch()) { const ae = document.activeElement; if (ae && dlg.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { ae.blur(); dlg.setAttribute("tabindex", "-1"); try { dlg.focus({ preventScroll: true }); } catch (_) {} } }
    if (globalThis.dvGalaxy && S.gal == null) setGalaxy(dvGalaxy.selected());
    showPosNote();
  }
  function closeDlg() { if (dlg && dlg.open) dlg.close(); }

  function onClick(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const b = t.closest("button,a");
    if (!b) return;
    if (b.hasAttribute("data-nr-close")) { closeDlg(); return; }
    if (b.closest(".nr-glyphs")) { padClick(b); return; }
    const id = b.id, d = b.dataset;
    if (id === "nr-find") { find(); return; }
    if (id === "nr-scan-start") { readForm(); startScan(); return; }
    if (id === "nr-scan-stop") { stopScan("Stopped."); return; }
    if (d.nrReward !== undefined) { revealReward(d.nrReward, b); return; }
    if (d.nrOpen !== undefined) { globalThis.dvSearchedAddress = d.nrOpen; closeDlg(); return; }   // the anchor then goes to #/d/..., the viewer's own rule
    if (d.nrStart !== undefined) { startTrip(d.nrStart); return; }
    if (d.nrCopy !== undefined) { copy(d.nrCopy, b); return; }
    if (id === "nr-ci-go") { checkIn(); return; }
    if (id === "nr-ci-name") { checkInName(); return; }
    if (id === "nr-name-stop") { if (nameRun) nameRun.stop = true; return; }
    if (d.nrPick !== undefined) { applyCheckIn(d.nrPick, "name", true); return; }
    if (id === "nr-trip-clear") { S.trip = null; save(); paintTrip(); return; }
    if (id === "nr-trip-undo") { undoCheckIn(); return; }
    if (id === "nr-tgt-go") { changeTarget(); return; }
    if (d.nrUseHist !== undefined) return;
  }
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch (_) {
      try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } catch (_2) {}
    }
    const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = old; }, 1200);
  }

  async function find() {
    readForm();
    const pos = curPos();
    if (!pos.ok) { msg("nr-status", `<span class="bad">${esc(pos.empty ? "Enter where you are first (glyphs, address or booster)." : pos.error)}</span>`); focusIn($("nr-pos")); return; }
    if (run) stopScan("Stopped.");
    const token = ++runToken, w = Object.assign({}, S.wants);
    results = []; atlasInfo = null; lastRun = null; lastEst = null; findPos = pos;
    resultFilter = wantsText(w); resultFilterObj = Object.assign({}, w);
    $("nr-status").dataset.stale = "";
    const old = $("nr-scan"); if (old) { old.hidden = true; old.innerHTML = ""; }   // no start button from the earlier question while this one is worked out
    msg("nr-status", pos.gal === 0 ? "Checking the atlas near you..." : "The atlas lists Galaxy 0 only, so this galaxy is searched by scanning.");
    paintResults();
    let info;
    try { info = await atlasPass(w, pos, token); } catch (err) { info = { skipped: "error", error: String(err && err.message || err) }; }
    if (token !== runToken || info.cancelled) return;
    atlasInfo = info;
    if (info.found) for (const f of info.found) results.push(f);
    results.sort((a, b) => a.d - b.d || (a.address < b.address ? -1 : 1));
    const parts = [];
    if (info.skipped === "gal") parts.push("The atlas lists Galaxy 0 only, so this galaxy is searched by scanning.");
    else if (info.skipped === "rows") parts.push("The atlas list did not load, so only scanning is available.");
    else if (info.skipped === "error") parts.push("The atlas check failed: " + esc(info.error));
    else if (info.found) parts.push(info.found.length ? `${info.found.length} nearest of ${num(info.hits)} atlas matches.` : "No atlas system matches.");
    msg("nr-status", parts.join(" "));
    paintResults();
    if (w.hasMap) { $("nr-scan").hidden = true; msg("nr-status", parts.join(" ") + " Published maps exist only for atlas systems, so nothing is scanned for this want."); return; }
    $("nr-scan").hidden = false;
    msg("nr-scan", `<h3>Search beyond the atlas</h3><p class="nr-note">Measuring how fast this device scans...</p>`);
    try { await calibrate(pos); } catch (err) { msPer = 0; }
    if (token !== runToken) return;
    lastEst = await estimate(w, pos);
    lastEst.pos = pos; lastEst.w = w;
    paintScan();
    const o = $("nr-scan"); if (o && o.scrollIntoView) o.scrollIntoView({ block: "nearest" });
  }
  function recalibrate() {
    if (!lastEst) return;
    const pos = lastEst.pos;
    calibBusy = true; paintScan();
    calibrate(pos).catch(() => { msPer = 0; }).then(() => { calibBusy = false; paintScan(); });
  }
  function paintScan() {
    const box = $("nr-scan");
    if (!box || box.hidden) return;
    const n = workerCount();
    if (run) {
      const secs = (performance.now() - run.t0) / 1000, rate = run.scanned / Math.max(1, secs);
      box.innerHTML = `<h3>Scanning</h3><div class="nr-bar"><span style="width:${Math.min(100, Math.round(run.matches * 100 / MAX_MATCH))}%"></span></div>
<p class="nr-prog" role="status"><b>${num(run.scanned)}</b> systems scanned, <b>${run.regions}</b> regions reached, searched out to <b>${num(run.reach)}</b> LY, <b>${run.matches}</b> of ${MAX_MATCH} matches, ${rate.toFixed(1)} systems per second, ${Math.round(secs)} s.${run.judged ? ` ${num(run.judged)} more known systems were judged from saved values without scanning.` : ""}</p>
${upLine()}<div class="nr-actions"><button type="button" id="nr-scan-stop">Stop</button></div>`;
      return;
    }
    const speedSel = `<div class="nr-row"><label for="nr-speed">Speed</label><select id="nr-speed"><option value="gentle">Gentle (1 worker)</option><option value="balanced">Balanced (${SPEEDS.balanced})</option><option value="max">Maximum (${SPEEDS.max})</option></select></div>`;
    const est = lastEst ? estHtml(lastEst, lastEst.w, lastEst.pos) : "";
    const end = lastRun ? `<p class="nr-prog"><b>${esc(lastRun.text)}</b> ${num(lastRun.scanned)} systems scanned in ${Math.round(lastRun.secs)} s, ${lastRun.matches} match${lastRun.matches === 1 ? "" : "es"}, searched out to ${num(lastRun.reach)} LY.</p>` : "";
    box.innerHTML = `<h3>Search beyond the atlas</h3><p class="nr-note">Scans systems the atlas does not list, nearest regions first, in this browser. Stops at ${MAX_MATCH} matches or when you press Stop. Every Galaxy 0 system it finishes is added to the atlas, the same as Contribute, so nobody has to scan it again. Other galaxies are never uploaded. Your position, check-ins and scout name are never sent. Systems already in the atlas, or scanned in this browser with their numbers saved, are not scanned again but still count as matches. A system whose numbers are no longer saved is scanned again on this device and not uploaded again. Neither are the last 8 below each region's star count, which may not exist.</p>${lastEst && !calibBusy ? est : '<p class="nr-note">Measuring how fast this device scans...</p>'}${speedSel}${end}${upLine()}
<div class="nr-actions"><button type="button" class="primary" id="nr-scan-start"${lastEst && !calibBusy ? "" : " disabled"}>${lastRun ? "Scan again" : "Start scan"}</button></div>`;
    const ss = $("nr-speed"); if (ss) ss.value = speedKey();
  }
  function revealReward(address, btn) {
    const r = results.find((x) => x.address === address);
    if (!r) return;
    const row = r.row, txt = row.reward_class || row.reward_name ? `${row.reward_class ? "Class " + row.reward_class + " " : ""}${row.reward_name || ""}` : "no end reward listed";
    btn.replaceWith(Object.assign(document.createElement("span"), { className: "nr-reward", textContent: "End reward (predicted): " + txt }));
  }
  const hubHref = (a, gal) => HUB.replace("{glyphs}", hubGlyphs(a)).replace("{galaxy}", String(gal));
  function resultHtml(r, showRew) {
    const range = S.range, jumps = jumpsFor(r.d, range), name = sysName(r.address), row = r.row, mods = row.frigate_modules;
    const modsT = mods == null ? "unknown" : mods + (row.frigate_modules_ambiguous ? "?" : "");
    const pos = findPos || curPos(), start = pos.ok && pos.address;
    const hub = start ? hubHref(start, pos.gal) : hubHref(r.address, r.gal);
    const other = hubGlyphs(r.address);
    const rew = showRew ? `<span class="nr-reward">End reward (predicted): ${esc((row.reward_class ? "Class " + row.reward_class + " " : "") + (row.reward_name || "none listed"))}</span>` : `<button type="button" class="nr-link" data-nr-reward="${r.address}">Show end reward</button>`;
    return `<li class="nr-res" data-address="${r.address}"><div class="nr-res-top"><b class="nr-dist">${r.d === 0 ? "Same region" : num(r.d) + " LY"}</b><span class="nr-jumps">${r.d === 0 ? "" : "about " + jumps + " jump" + (jumps === 1 ? "" : "s") + " (estimate, at " + num(range) + " LY range)"}</span><span class="nr-src">${r.src === "atlas" ? "In the atlas" : "Scanned here"}</span></div>
<div class="nr-line"><code class="nr-glyphs">${glyphsOf(r.address)}</code><button type="button" class="nr-mini" data-nr-copy="${glyphsOf(r.address)}">Copy</button> <span class="nr-name">${esc(name)}</span> <span class="nr-guess">(generated name, a best guess)</span> <span class="nr-gal">${esc(gname(r.gal))}</span>${isPurple(r.sys) ? ' <span class="nr-tag">Purple star: needs the purple-star unlock</span>' : ""}</div>
<div class="nr-line nr-facts">Predicted modules: <b>${esc(modsT)}</b> · crates ${row.salvage_crates ?? "?"} · rooms ${row.rooms ?? "?"} · ${rew}</div>
<div class="nr-line nr-acts"><a class="nr-btn" href="#/d/${r.address}" data-nr-open="${r.address}">Open in viewer</a><button type="button" class="nr-btn" data-nr-start="${r.address}">Start here</button><a class="nr-btn" href="${esc(hub)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="External site, not affiliated. Opens NMS Hub at your position.">Route on NMS Hub ↗</a></div>
<div class="nr-line nr-hubnote">Hub opens at your position. Then paste the target there: <code>${other}</code> <button type="button" class="nr-mini" data-nr-copy="${other}">Copy</button> <span class="nr-gal">${esc(gname(r.gal))}</span></div></li>`;
  }
  function paintResults() {
    const list = $("nr-list");
    if (!list) return;
    const byReward = !!(resultFilterObj && (resultFilterObj.rewardModule || resultFilterObj.reward));
    const head = resultFilter ? `<li class="nr-head">Looking for: ${esc(resultFilter)}. Sorted nearest first. Predicted by the scanner. Distances are from region to region, so each can be off by a few hundred light years.</li>` : "";
    list.innerHTML = results.length ? head + results.map((r) => resultHtml(r, byReward)).join("") : (resultFilter ? head : "");
  }

  // ---------------------------------------------------------------- the trip (check-in)
  const hist = () => (S.trip && S.trip.hist) || [];
  function startTrip(address) {
    const res = results.find((x) => x.address === address), pos = findPos || curPos();
    if (!res || !pos.ok) return;
    S.trip = { target: { address, gal: res.gal }, hist: [{ address: pos.address, gal: pos.gal, via: pos.kind, t: Date.now() }] };
    save(); paintTrip();
    const t = $("nr-trip"); if (t) { t.scrollIntoView({ block: "start" }); focusIn($("nr-ci")); }
  }
  function tripReport() {
    const t = S.trip, h = hist();
    if (!t || !h.length) return null;
    const tg = Object.assign({ address: t.target.address }, coordsOf(t.target.address)), cur = Object.assign({ address: h[h.length - 1].address }, coordsOf(h[h.length - 1].address));
    const out = { tg, cur, d: dist(cur, tg), same: sameRegion(cur, tg), arrived: cur.address.slice(3, 6) === tg.address.slice(3, 6) && sameRegion(cur, tg) };
    if (h.length > 1) {
      const prev = Object.assign({}, coordsOf(h[h.length - 2].address)); out.prev = prev;
      out.dPrev = dist(prev, tg); out.change = out.d - out.dPrev; out.moved = dist(prev, cur);
      out.off = offLine(prev, cur, tg);
    }
    const ct = coreDist(tg), cc = coreDist(cur);
    out.coreDiff = cc - ct;   // > 0: the target is nearer the core than you
    return out;
  }
  function tripHtml() {
    const t = S.trip;
    if (!t) return "";
    const rp = tripReport(), g = t.target, range = S.range, name = sysName(g.address), sys = hex(rp.tg.sys, 3);
    const parts = [];
    parts.push(`<div class="nr-trip-head"><h3>Heading there</h3><div class="nr-actions"><button type="button" class="nr-mini" id="nr-trip-undo"${hist().length > 1 ? "" : " disabled"}>Undo last check-in</button><button type="button" class="nr-mini" id="nr-trip-clear">Clear</button></div></div>`);
    parts.push(`<p class="nr-target">Target: <b>${esc(name || "system " + sys)}</b>${name ? " <small>(generated name, a best guess)</small>" : ""} · <code>${glyphsOf(g.address)}</code> · ${esc(gname(g.gal))} · system ${sys}${isPurple(rp.tg.sys) ? ' <span class="nr-tag">Purple star: needs the purple-star unlock</span>' : ""}</p>`);
    const last = hist()[hist().length - 1];
    if (rp.arrived) parts.push(`<p class="nr-arrived"><b>Arrived.</b> You are at the target system.</p>`);
    else {
      const jumps = jumpsFor(rp.d, range);
      parts.push(`<div class="nr-stats"><div><small>Distance left</small><b>${rp.same ? "0 LY" : num(rp.d) + " LY"}</b></div>` +
        `<div><small>Since last check-in</small><b>${rp.change == null ? "first position" : Math.abs(rp.change) < 1 ? "no change" : num(Math.abs(rp.change)) + " LY " + (rp.change < 0 ? "closer" : "farther")}</b></div>` +
        `<div><small>Jumps left (estimate)</small><b>${rp.same ? "in this region" : "about " + jumps}</b></div></div>`);
      if (rp.same) parts.push(`<p class="nr-region" id="nr-hover"><b>Right region.</b> The target is system ${sys}${name ? ", generated name <b>" + esc(name) + "</b> (a best guess)" : ""}. You are in system ${hex(rp.cur.sys, 3)}.${name ? " On the galaxy map in the game, hover over stars until you see that name. It may show a different name, for example a name a player uploaded or a renamed system. In that case go by the portal glyphs, or try system number " + sys + "." : ""}</p>`);
      else {
        parts.push(`<p class="nr-dir">The target is <b>${rp.coreDiff > 0 ? "toward" : "away from"}</b> the galaxy core from you (${num(Math.abs(rp.coreDiff))} LY ${rp.coreDiff > 0 ? "nearer" : "farther"}; you are ${num(coreDist(rp.cur))} LY from the core).</p>`);
        if (rp.off != null) parts.push(`<p class="nr-dir">Your last jump was <b>${Math.round(rp.off)} degrees</b> off the straight line to the target${rp.off <= 15 ? " (close to on line)" : rp.off >= 90 ? " (you moved away from it)" : ""}.</p>`);
        else if (rp.moved === 0) parts.push(`<p class="nr-dir">You are in the same region as your last check-in.</p>`);
        parts.push(`<p class="nr-note">Left, right, up and down on your galaxy map are not tested in-game, so none are given. Star positions inside a region are unknown, so no single next star is named.</p>`);
      }
    }
    parts.push(`<p class="nr-note">Last check-in: <code>${glyphsOf(last.address)}</code> ${esc(gname(last.gal != null ? last.gal : tripGal()))} (${esc(last.via)}), region ${rp.cur.x}, ${rp.cur.y}, ${rp.cur.z}.${hist().length > 1 ? " Check-ins so far: " + hist().length + "." : ""}</p>`);
    parts.push(`<div class="nr-ci"><label for="nr-ci">After your jump, where are you now? Glyphs, address or booster</label><div class="nr-inline" data-enter="nr-ci-go"><input id="nr-ci" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Glyphs, address or booster"><button type="button" class="primary" id="nr-ci-go">Check in</button></div>${padHtml("nr-ci")}<p class="nr-note" id="nr-ci-msg" role="status"></p>`);
    parts.push(`<label for="nr-ci-n">No glyphs? Type the system name (best guess)</label><div class="nr-inline" data-enter="nr-ci-name"><input id="nr-ci-n" type="text" autocomplete="off" spellcheck="false" maxlength="60" placeholder="Name of the system you are in"><button type="button" id="nr-ci-name">Find by name</button></div><p class="nr-note">Names usually match, but a renamed system will not, so use glyphs then. Read the name as soon as you arrive. After a short wait the game can replace it with a name a player uploaded, and the atlas can't match those. Glyphs are the first choice, especially for the system you are in right now.</p><div id="nr-name-out" class="nr-note" role="status"></div></div>`);
    parts.push(`<details class="nr-help"><summary>Change target</summary><div class="nr-inline" data-enter="nr-tgt-go"><input id="nr-tgt" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Glyphs, address or booster of the new target"><button type="button" id="nr-tgt-go">Set target</button></div><p class="nr-note" id="nr-tgt-msg" role="status"></p></details>`);
    return parts.join("");
  }
  function paintTrip() {
    const box = $("nr-trip");
    if (!box) return;
    const keep = {}; for (const id of ["nr-ci", "nr-ci-n", "nr-tgt"]) { const e = $(id); if (e) keep[id] = e.value; }
    const had = document.activeElement && document.activeElement.id;
    if (S.trip && !hist().length) S.trip = null;
    box.hidden = !S.trip;
    box.innerHTML = S.trip ? tripHtml() : "";
    for (const id in keep) { const e = $(id); if (e) e.value = keep[id]; }
    syncPad($("nr-ci"));
    if (had && $(had)) $(had).focus();
  }
  function tripGal() { return S.trip ? S.trip.target.gal : 0; }
  function checkIn() {
    const p = parsePos($("nr-ci").value, tripGal()), m = $("nr-ci-msg");
    if (!p.ok) { m.className = "nr-note bad"; m.textContent = p.empty ? "Type your glyphs, address or booster first." : p.error; return; }
    if (p.gal !== tripGal()) { m.className = "nr-note bad"; m.textContent = `That address is in ${gname(p.gal)}, the target is in ${gname(tripGal())}. Check the galaxy.`; return; }
    applyCheckIn(p.address, p.kind, false);
    const ci = $("nr-ci"); if (ci) { ci.value = ""; ci.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  function applyCheckIn(address, via, picked) {
    if (!S.trip) return;
    S.trip.hist.push({ address, gal: tripGal(), via, t: Date.now() });
    if (S.trip.hist.length > 60) S.trip.hist.shift();
    save(); paintTrip();
    if (via === "name") { const o = $("nr-name-out"); if (o) o.innerHTML = `<span class="ok">Matched by name (a best guess; a renamed system will not match): <code>${glyphsOf(address)}</code> (${esc(gname(tripGal()))}). Wrong system? Press Undo, then check in with glyphs.</span>`; }
    focusIn($("nr-ci"));
  }
  function undoCheckIn() { if (S.trip && S.trip.hist.length > 1) { S.trip.hist.pop(); save(); paintTrip(); } }
  function changeTarget() {
    const p = parsePos($("nr-tgt").value, tripGal()), m = $("nr-tgt-msg");
    if (!p.ok) { m.className = "nr-note bad"; m.textContent = p.empty ? "Type the new target first." : p.error; return; }
    if (p.gal !== tripGal()) { m.className = "nr-note bad"; m.textContent = "A target in another galaxy needs a new trip: press Clear, then search again."; return; }
    S.trip.target = { address: p.address, gal: p.gal }; save(); paintTrip();
  }
  async function checkInName() {
    const q = $("nr-ci-n").value.trim(), out = $("nr-name-out");
    if (!q) { out.className = "nr-note bad"; out.textContent = "Type the system name first."; return; }
    if (nameRun) nameRun.stop = true;
    const h = hist(), from = coordsOf(h[h.length - 1].address), gal = tripGal(), limit = Math.min(Math.max(100, S.range), NAME_MAX_LY);
    const rn = nameRun = { stop: false, total: 0, done: 0, hits: 0, q, limit };
    out.className = "nr-note"; paintNameProgress(rn);
    let hits = [];
    try { hits = await nameSearch(q, from, gal, limit, rn); } catch (e) { out.className = "nr-note bad"; out.textContent = "The name search could not start: " + String((e && e.message) || e); nameRun = null; return; }
    if (nameRun !== rn) return;
    nameRun = null;
    hits.sort((a, b) => a.d - b.d || (a.address < b.address ? -1 : 1));
    const stopped = rn.stop, within = `within ${num(limit)} LY of your last position`;
    if (!hits.length) {
      out.className = "nr-note bad";
      out.innerHTML = stopped ? "Stopped before a match was found." : `No system called <b>${esc(q)}</b> was found ${within}. The system may be renamed, it may be a name a player uploaded, or it is farther away. Names usually match, but those will not. Check in with glyphs instead. If you noted the first name the game showed on arrival, try that name.`;
      return;
    }
    if (hits.length === 1 && !stopped) { out.className = "nr-note ok"; applyCheckIn(hits[0].address, "name", false); return; }
    out.className = "nr-note";
    out.innerHTML = `<p>${stopped ? "Stopped. Found so far: " : ""}${hits.length} systems are called <b>${esc(q)}</b> ${within}. Pick yours (best guess):</p><ul class="nr-picks">${hits.slice(0, 12).map((x) => `<li><code>${glyphsOf(x.address)}</code> ${esc(gname(gal))} ${num(x.d)} LY from your last position, system ${hex(x.sys, 3)} <button type="button" class="nr-mini" data-nr-pick="${x.address}">Use this</button></li>`).join("")}</ul>`;
  }
  function paintNameProgress(rn) {
    const out = $("nr-name-out");
    if (!out || nameRun !== rn) return;
    const pct = rn.total ? Math.round(rn.done * 100 / rn.total) : 0;
    out.innerHTML = `Searching regions within ${num(rn.limit)} LY of your last position, nearest first: ${rn.done} of ${rn.total} (${pct}%), ${rn.hits} match${rn.hits === 1 ? "" : "es"} so far. <button type="button" class="nr-mini" id="nr-name-stop">Stop</button><div class="nr-bar"><span style="width:${pct}%"></span></div>`;
  }

  // ---------------------------------------------------------------- route #/near and the Search button
  function route() {
    if (location.hash === "#/near") openDlg();
    else if (dlg && dlg.open) dlg.close();
  }
  function hook() {
    const search = $("address-dialog");
    // two buttons: "Near me" inside the Search window and "Near me" beside the main search bar (user 2026-11-07)
    for (const btn of [$("near-open"), $("near-main")]) {
      if (!btn || btn.dataset.nr) continue;
      btn.dataset.nr = "1";
      btn.addEventListener("click", () => {
        // what was typed in Search and the galaxy chosen there come along (one less thing to type)
        build();
        const typed = btn.id === "near-open" && $("address-input") ? parsePos($("address-input").value, globalThis.dvGalaxy ? dvGalaxy.selected() : 0) : null;
        if (globalThis.dvGalaxy) setGalaxy(dvGalaxy.selected());
        if (typed && typed.ok) { $("nr-pos").value = $("address-input").value.trim(); if (typed.ownGal) setGalaxy(typed.gal); readForm(); showPosNote(); }
        if (search && search.open) search.close();
        if (location.hash === "#/near") openDlg(); else location.hash = "#/near";
      });
    }
  }
  load();
  window.addEventListener("hashchange", route);
  const boot = () => { hook(); if (location.hash === "#/near") openDlg(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  // test and debug hooks (no network, no data)
  globalThis.dvNear = { parsePos, boosterOf, addrOf, coordsOf, dist, coreDist, jumpsFor, offLine, shell, glyphsOf, hubGlyphs, hubHref, isPurple, normName,
    inSet: (a) => !!(atlasSet && atlasSet.has(a)),
    up: () => ({ found: upStats.found, failed: upStats.failed, queued: upStats.queued, topQueue: upQ.length, busy: upStats.busy, seen: [...upSeen], pending: globalThis.dvNearPending ? dvNearPending() : 0 }),
    state: () => ({ S, results, run: run ? { workers: run.workers.length, scanned: run.scanned, matches: run.matches, regions: run.regions, reach: run.reach, stop: run.stop, judged: run.judged } : null, nameRun: !!nameRun, msPer, lastRun, lastEst, atlasInfo, storeOk, workerCount, speed: speedKey() }),
    open: openDlg, close: closeDlg };
})();
