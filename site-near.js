/* site-near.js (SITE integration 2026-11-06, user: "we build the pathfinder on the website and the user checks in with each
 * jump, either via glyphs or name"): the "Near me" page (#/near) and its check-in panel. Preview build work-v145-map (adds the star map, site-nearmap.js).
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
 * Distance = 400 ly * |signed region difference| (Y included, like NMS Hub). Position inside a region is not known.
 * The page keeps its state in localStorage "dv.near.v1" (every access in try/catch).
 *
 * v146 (SITE 2026-11-07, stage 1 of the redesign in redesign/near-mockups): the window is three panels (position and keypad | star map with the
 * scan progress | scan options and matching systems) and, on a phone, one thing at a time (data-step on the dialog). Scan is one press: atlas
 * list, speed measurement, then the scan itself. The radius is an upper limit (regions farther than it are not scanned). The map is
 * site-nearmap.js in scan mode: stars grey, each takes its colour when its system is scanned or already known, matches get a gold ring.
 * Every map call is guarded, so a failing star port leaves the scan working. Navigate opens the old Heading there panel (stage 2 replaces it).
 * The old "hyperdrive range" box became the scan radius; the jump estimate keeps its own Drive range box inside Heading there (S.drive). */
(function () {
  "use strict";
  const KEY = "dv.near.v1";
  const W29D_V = "fb03172ebf393002";   // same as site-scan.js (integrate.py checks that the two agree)
  const LY = 400, SAFE = 0.85, MAX_MATCH = 20, RECYCLE = 300, RMAX = 40, NAME_MAX_LY = 2500, PURPLE_LO = 0x3E8, PURPLE_HI = 0x428;
  const NEAR_TITLE = "Near me";   // the title in the window's top bar: one constant, so a different title (for example "06 · Triangulation") is a one-line change
  // (no route links to outside maps in Near me: the Navigate button opens the Heading there view)   // arrival = the position you are at (tested 2026-11-06)
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
  const driveOf = () => (S.drive >= 50 ? S.drive : 1000);
  const modsKey = (r) => (r.row && r.row.frigate_modules != null ? Number(r.row.frigate_modules) : -1);
  const resCmp = (a, b) => modsKey(b) - modsKey(a) || a.d - b.d || (a.address < b.address ? -1 : 1);   // most predicted modules first, then nearest
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
  const DEF = { v: 1, pos: "", gal: null, range: 1000, drive: 1000, speed: "", wants: { mods: "4", reward: "", rewardModule: "", maxRooms: "", minCrates: "", minBriefcases: "", minTall: "", hasMap: false, purple: false }, trip: null };
  let S = JSON.parse(JSON.stringify(DEF));
  let storeOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (!j || j.v !== 1) return;
      S = Object.assign({}, DEF, j, { wants: Object.assign({}, DEF.wants, j.wants || {}) });
      if (j.drive == null) S.drive = S.range >= 50 ? S.range : 1000;   // v146: the old "hyperdrive range" field became the scan radius; the jump estimate keeps the old number
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
  function showPosNote() { showPosNote0(); syncState(); }
  function showPosNote0() {
    const p = curPos(), box = $("nr-pos-note");
    if (!box) return;
    if (p.empty) { box.innerHTML = ""; box.className = "nr-note"; return; }
    if (!p.ok) { box.textContent = p.error; box.className = p.partial ? "nr-note" : "nr-note bad"; return; }
    if (p.ownGal) setGalaxy(p.gal);
    const how = p.kind === "booster" ? "Booster read as" : p.kind === "address" ? "Address read as" : "Glyphs read as";
    box.className = "nr-note ok";
    box.innerHTML = `${how} region ${p.x}, ${p.y}, ${p.z}, system ${hex(p.sys, 3)}${isPurple(p.sys) ? " (purple star)" : ""}. ${num(coreDist(p))} ly from the galaxy core.` + (p.kind === "booster" ? ` Glyphs: <code>${glyphsOf(p.address)}</code> (${esc(gname(p.gal))})` : "");
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
    ? (d.v3 && d.v3.row && d.v3.extras ? { a, ver: String(d.version || ""), row: d.v3.row, ext: d.v3.extras, ms: d.ms, p: (d.row && d.row.preset) || "", w: size, sp: speedKey(), mt: globalThis.dvCull && globalThis.dvCull.on() ? globalThis.dvCull.metaOf(d.row) : undefined } : null)
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
          if (full && full.ok && full.status === 0) { const r = await dvUploadFind(a, full); if (r && (r.queued || r.sent || r.held)) { sent = true; if (r.queued) upStats.found++; } }
        } catch (e) { try { console.warn("[near me] top-100 upload", a, e); } catch (_) {} }
        if (!sent) { upStats.failed++; const it = batchItem(a, d, size); if (it) { it.cl = true; globalThis.dvNearQueue(it); } }   // the full scan failed: still sent once, from the batch
        paintScan();
      }
    } finally { upStats.busy = false; }
  }
  // every finished system, match or not
  function releaseHeld(r) { if (r.late || r.atlasWait || r.stop && false) return; const h = r.held.splice(0); for (const x of h) finished(r, x[0], x[1]); }
  function finished(r, address, d) {
    try {
      rowsPut(address, d.status === 0 ? d.row : null);
      if (r.late || r.atlasWait) { r.held.push([address, d]); return; }   // the skip lists or the atlas list are still loading: the upload decision waits for them, nothing is lost
      if (r.gal !== 0 || !relayOn() || r.atlasAny.has(address) || r.noUp.has(address)) return;   // another galaxy, no relay, or the atlas has it: no upload
      if (d.status === 0 && !(d.v3 && d.v3.row && d.v3.extras)) return;   // no valid upload line: not sent, so not marked
      // v145b: not marked done here. site-scan.js marks a system done (Contribute skips it) only once the relay has answered OK for it.
      const top = d.status === 0 && r.lists && !upSeen.has(address) && r.up < MAX_UP && globalThis.dvTopLists.breaks(d.row, d.row, r.lists).length > 0;   // Contribute's call
      if (top) { if (globalThis.dvNearBits) globalThis.dvNearBits(address, d); upSeen.add(address); r.up++; upQ.push({ a: address, d, size: r.size }); drainUp(); return; }
      upStats.queued++;
      const it = batchItem(address, d, r.size);
      if (it && it.row && !r.lists && globalThis.dvNearBits) { globalThis.dvNearBits(address, d); it.cl = true; }   // v154: no top-100 lists loaded = nothing can be culled safely
      globalThis.dvNearQueue(it);
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
  // v145b: the number is what the relay has accepted (a 2xx answer), not what was queued. Accepted is not "in the atlas": the update job runs later.
  const upLine = () => {
    const S = globalThis.dvNearStats ? dvNearStats() : { accepted: 0, waiting: 0 };
    return (upStats.queued || upStats.found || upStats.failed || upQ.length || upStats.busy || S.accepted || S.waiting)
      ? `<p class="nr-prog" role="status">Accepted by the relay: <b>${num(S.accepted)}</b> systems${S.waiting ? `, ${num(S.waiting)} waiting to be sent${(globalThis.dvNearWhy && dvNearWhy()) ? ` (${dvNearWhy()})` : ""}` : ""}${upStats.found ? `, ${upStats.found} found in a top 100` : ""}${upQ.length || upStats.busy ? " (checking more top-100 finds)" : ""}${upStats.failed ? `, ${upStats.failed} top-100 finds sent without loot` : ""}. The atlas adds them at its next update.</p>` : "";
  };

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
  function startScan(arg) {
    if (run) return;
    const q = arg || lastEst;
    if (!q) return;
    const pos = q.pos, w = q.w;   // the question the list on screen answers
    run = { late: true, atlasWait: false, held: [], stop: false, queue: [], workers: [], idle: [], busy: new Map(), scanned: 0, matches: 0, regions: 0, fails: 0, t0: performance.now(), R: -1, cur: [], k: 0, work: 0, refilling: false, exhausted: false, reach: 0,
      pos, gal: pos.gal, limit: S.range, w, f: filterOf(w), purple: !!w.purple, curRegion: null, err: "", up: 0, lists: null, rec: new Set(), noUp: new Set(), judged: 0, recRows: new Map(), atlasAny: atlasAny || new Set(), none: new Set() };
    (async () => {
      try {
        const [rc, v, c] = await Promise.all([rcLoad(), version(), core()]);
        if (!run || run.stop) return;
        run.rc = rc; run.q = c.systemQuery(run.f); run.v = v;
        const r0 = run;
        // rec = addresses judged from values this browser actually holds (a saved row, a viewer scan, or "no derelict"): not scanned again,
        // still listed when they match. noUp = addresses already uploaded or finished (Contribute's done list, the viewer's record, saved rows):
        // when no row is held they ARE scanned (so a changed want never loses a match) but never uploaded again.
        // The local records (a few milliseconds) are read before the first system is queued; only the two downloads wait in the background.
        try {
          const gh = hex(r0.gal, 2);
          if (r0.gal === 0) {
            if (globalThis.dvFindRecord) for (const a of dvFindRecord()) r0.noUp.add(a);
            for (const a of jget(DONE_KEY, [])) r0.noUp.add(a);
            if (globalThis.dvDeviceScans) for (const x of dvDeviceScans()) if (x.row) { r0.recRows.set(x.address, x.row); r0.rec.add(x.address); }
          }
          for (const [a, arr] of rowsMap()) if (a.slice(6, 8) === gh) { r0.rec.add(a); r0.noUp.add(a); }   // [] = finished with no derelict: it can match no want
        } catch (_) {}
        (async () => {   // the published none-list and the top lists download while the first systems scan; uploads wait for them (releaseHeld)
          try {
            if (r0.gal === 0 && relayOn()) { r0.none = await knownNone(); for (const a of r0.none) { r0.rec.add(a); r0.noUp.add(a); } if (globalThis.dvTopLists) r0.lists = await dvTopLists.load(); }
          } catch (_) {}
          if (run !== r0 || r0.stop) return;
          r0.late = false; lastRec = r0.rec; mapReset(true, true); releaseHeld(r0);
        })();
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
      if (r.k >= r.cur.length) { r.R++; if (r.R > RMAX || (r.R - 1) * LY >= r.limit) return null; r.cur = shell(r.R); r.k = 0; continue; }
      const o = r.cur[r.k++], x = r.pos.x + o[0], y = r.pos.y + o[1], z = r.pos.z + o[2];
      if (!inGalaxy(x, y, z)) continue;
      if (r.R > 0 && LY * Math.sqrt(o[3]) > r.limit) continue;   // the radius is an upper limit
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
    if (r.exhausted && !r.queue.length && !r.busy.size) stopScan("Searched every region within " + num(Math.min(RMAX * LY, r.limit)) + " ly.");
  }
  function done(wk, d) {
    const r = run;
    if (!r || r.stop || !r.busy.has(wk)) return;
    const it = r.busy.get(wk); r.busy.delete(wk);
    wk.count++;
    if (d.ok) {
      r.fails = 0; r.scanned++; mapMark(it.a);
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
    lastRec = r.rec; run = null;
    paintScan(); paintResults();
  }
  let lastRun = null;
  function addResult(res) {
    if (results.some((x) => x.address === res.address)) return;
    results.push(res);
    results.sort(resCmp);
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
      prev.hidden = false; prev.style.visibility = glyphs ? "visible" : "hidden";   // the slots keep their place when a 16-digit address or a booster is typed
      prev.innerHTML = Array.from({ length: 12 }, (_, i) => glyphs && hex[i] ? `<img src="glyphs-svg/${hex[i].toLowerCase()}.svg" alt="">` : '<span aria-hidden="true">·</span>').join("");
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
  // ---- dropdowns (v146 round 2): a button opens a floating panel over the content. The panel is moved to the dialog while open (so no clipped
  // panel or scroll box can cut it), and goes back to its place when it closes. Closes on Esc, a click outside, Tab out of it, or a second press.
  let ddOpen = null, ddEscAt = 0;
  const ddHtml = (key, label, body, cls) => `<span class="nr-dd ${cls || ""}" data-dd="${esc(key)}"><button type="button" class="nr-ddb" aria-expanded="false" aria-haspopup="true">${label}<i class="nr-chev" aria-hidden="true"></i></button><div class="nr-ddp" role="region" aria-label="${esc(String(label).replace(/<[^>]*>/g, ""))}" tabindex="-1" hidden>${body}</div></span>`;
  function ddClose(refocus) {
    if (!ddOpen) return;
    const o = ddOpen; ddOpen = null;
    o.panel.hidden = true; o.panel.style.cssText = "";
    if (o.dd.isConnected) o.dd.appendChild(o.panel); else o.panel.remove();
    o.btn.setAttribute("aria-expanded", "false");
    if (refocus && o.btn.isConnected) o.btn.focus();
  }
  function ddPlace() {   // inside the window: the panel is as wide as the room allows, wraps its text, opens left or up when needed, scrolls when taller
    const o = ddOpen; if (!o) return;
    const p = o.panel, b = o.btn.getBoundingClientRect(), D = dlg.getBoundingClientRect(), m = 14;
    const A = { l: Math.max(D.left, 0) + m, r: Math.min(D.right, innerWidth) - m, t: Math.max(D.top, 0) + m, b: Math.min(D.bottom, innerHeight) - m };
    const aw = Math.max(120, A.r - A.l), ah = Math.max(80, A.b - A.t);
    p.style.cssText = `position:fixed;left:0;top:0;width:max-content;max-width:${aw}px;min-width:${Math.min(240, aw)}px;max-height:${ah}px;overflow-wrap:anywhere`;
    const pw = p.offsetWidth, ph = Math.min(p.offsetHeight, ah), below = A.b - b.bottom - 4, above = b.top - A.t - 4;
    const up = ph > below && above > below, room = Math.max(60, Math.min(ah, up ? above : below));
    const h = Math.min(ph, room);
    p.style.maxHeight = room + "px";
    p.style.left = Math.max(A.l, Math.min(b.left, A.r - pw)) + "px";
    p.style.top = Math.max(A.t, Math.min(A.b - h, up ? b.top - 4 - h : b.bottom + 4)) + "px";
  }
  function ddToggle(btn, viaKey) {
    const dd = btn.closest(".nr-dd"); if (!dd || !dlg) return;
    if (ddOpen && ddOpen.dd === dd) { ddClose(true); return; }
    ddClose(false);
    const panel = dd.querySelector(":scope > .nr-ddp"); if (!panel) return;
    panel.hidden = false; dlg.appendChild(panel); btn.setAttribute("aria-expanded", "true");
    ddOpen = { dd, btn, panel, key: dd.dataset.dd };
    ddPlace();
    if (viaKey) { const f = panel.querySelector("input,select,button,a[href],summary"); try { (f || panel).focus({ preventScroll: true }); } catch (_) {} }
  }
  // repaint a box that holds a dropdown without losing it when it was open
  function ddKeep(box, fn) {
    const k = ddOpen && box.contains(ddOpen.dd) ? ddOpen.key : null;
    if (k) ddClose(false);
    fn();
    if (k) { const b = box.querySelector(`[data-dd="${k}"] .nr-ddb`); if (b) ddToggle(b, false); }
  }
  function ddWire(d) {
    d.addEventListener("pointerdown", (e) => { if (ddOpen && e.target instanceof Node && !ddOpen.panel.contains(e.target) && !ddOpen.btn.contains(e.target)) ddClose(false); }, true);
    d.addEventListener("keydown", (e) => {
      if (!ddOpen) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ddEscAt = Date.now(); ddClose(true); return; }
      if (e.key === "Tab" && ddOpen.panel.contains(document.activeElement)) {
        const f = [...ddOpen.panel.querySelectorAll("input:not([disabled]),select:not([disabled]),button:not([disabled]),a[href],summary")].filter((x) => x.offsetParent !== null);
        if (f.length && ((!e.shiftKey && document.activeElement === f[f.length - 1]) || (e.shiftKey && document.activeElement === f[0]))) { e.preventDefault(); ddClose(true); }
      }
    }, true);
    d.addEventListener("cancel", (e) => { if (ddOpen || Date.now() - ddEscAt < 400) e.preventDefault(); });
    addEventListener("resize", () => { if (ddOpen) ddPlace(); });
    d.addEventListener("scroll", () => { if (ddOpen) ddPlace(); }, true);
  }
  function field(id, label, html) { return `<div class="nr-f"><label for="${id}">${label}</label>${html}</div>`; }
  const ICON_CROSS = '<svg class="nr-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>';
  function build() {
    if (dlg || !document.body) return;
    dlg = document.createElement("dialog");
    dlg.id = "near-dialog"; dlg.className = "sheet nr-dialog"; dlg.setAttribute("aria-labelledby", "nr-title");
    dlg.dataset.step = "enter"; dlg.dataset.run = "0"; dlg.dataset.view = "scan";
    const modsOpt = ['<option value="">Any</option>'].concat([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}">${n}+</option>`)).join("");
    dlg.innerHTML = `<div class="nr-top">${ICON_CROSS}<h2 id="nr-title">${esc(NEAR_TITLE)}</h2><button type="button" class="nr-mini nr-heading-btn" id="nr-trip-show" hidden>Heading there</button><button type="button" class="icon-button" data-nr-close aria-label="Close ${esc(NEAR_TITLE)}">×</button></div>
<div class="nr-body" id="nr-body">
<section class="nr-trip" id="nr-trip" hidden aria-live="polite"></section>
<div class="nr-view" id="nr-view">
<section class="nr-panel nr-p-pos" aria-labelledby="nr-h1">
<div class="nr-chip"><span class="nr-chip-i">${ICON_CROSS}</span><h3 id="nr-h1">You are here</h3></div>
<label class="nr-sr" for="nr-pos">Where are you? Glyphs, address or signal booster</label>
<div class="nr-posrow"><div class="nr-inwrap"><input id="nr-pos" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Glyphs or address" aria-describedby="nr-pos-note"><button type="button" class="nr-x" id="nr-pos-x" aria-label="Clear the position" hidden>×</button></div><select id="nr-gal" aria-label="Galaxy"></select></div>
<div class="nr-posstat"><p class="nr-note" id="nr-pos-note" role="status"></p><p class="nr-note" id="nr-gal-note"></p></div>
<div class="nr-padwrap" id="nr-padwrap" data-open="1"><button type="button" class="nr-padtoggle" id="nr-padtoggle" aria-expanded="true" aria-controls="nr-padbody"><span id="nr-padlabel">Glyphs</span><span class="nr-chev" aria-hidden="true"></span></button><div id="nr-padbody">${padHtml("nr-pos")}</div></div>
${ddHtml("help", "Where do I find these?", `<ul>
<li><b>Glyphs:</b> the 12-digit portal address of a planet in your system, typed as hex (0 to 9, A to F). The first digit is the planet and is ignored here.</li>
<li><b>Address:</b> the 16-digit address this site uses. It includes the galaxy.</li>
<li><b>Signal booster:</b> the four groups of galactic coordinates a signal booster shows, like 0DEC:007D:06C0:0139. The conversion follows the community formula on glyphs.had.sh. It has not been checked in-game by this project yet, so compare the result with your glyphs if you can.</li></ul>`, "nr-help")}
</section>
<section class="nr-panel nr-p-map nr-flip" aria-label="Star map and scan progress">
<div class="nr-maphead"><b id="nr-mapgal">${esc(gname(0))}</b><span class="nr-mapinfo" id="nr-mapinfo"></span></div>
<div class="nr-scanmap" id="nr-scanmap"><p class="nr-mapempty" id="nr-mapempty">Enter where you are to see the stars around you.</p><p class="nr-note nr-mapnote" id="nr-mapnote"></p></div>
<div class="nr-scan" id="nr-scan" hidden></div>
${ddHtml("map", "About the map", `<p class="nr-note">Star positions are worked out from the game's code. They were checked against one Euclid and one Galaxy 9 system on game build 7.10 (25 of 25 distances matched). Names are generated guesses. Markers: a ring with a dark centre is a black hole (index 121, from game data), a diamond is an Atlas station (index 122, from game data, not visited); nothing else is claimed about them. Grey stars are not scanned yet, or are skipped: the scan leaves out the last systems of each region, which may not exist. A star turns to its own colour once its system is scanned or already known. Positions never leave this page.</p>`, "nr-help nr-aboutmap")}
</section>
<div class="nr-col3">
<section class="nr-panel nr-p-res" aria-labelledby="nr-h3">
<header class="nr-ph"><h3 id="nr-h3">Matching systems</h3></header>
<div class="nr-resbox" id="nr-out" aria-live="polite"><p class="nr-note" id="nr-status" role="status"></p><ol class="nr-list" id="nr-list"></ol><p class="nr-empty" id="nr-empty">No matches yet.</p></div>
</section>
<section class="nr-panel nr-p-opt" aria-labelledby="nr-h2">
<header class="nr-ph"><h3 id="nr-h2">Scan options</h3></header>
<div class="nr-orow"><label for="nr-range">Scan radius (ly)</label><input id="nr-range" type="number" inputmode="numeric" min="50" max="9999" step="50"></div>
<div class="nr-orow"><label for="nr-mods">Min. predicted modules</label><select id="nr-mods">${modsOpt}</select></div>
<div class="nr-ddrow">${ddHtml("more", "More", `<div class="nr-grid">
${field("nr-rmod", "End reward module", `<select id="nr-rmod"><option value="">Any</option>${Object.entries(REWARDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>`)}
${field("nr-rcls", "End reward class", '<select id="nr-rcls"><option value="">Any</option><option>S</option><option>A</option><option>B</option><option>C</option></select>')}
${field("nr-rooms", "Most rooms", '<input id="nr-rooms" type="number" inputmode="numeric" min="1" max="99">')}
${field("nr-crates", "Salvage crates, at least", '<input id="nr-crates" type="number" inputmode="numeric" min="0" max="99">')}
${field("nr-brief", "Briefcases, at least", '<input id="nr-brief" type="number" inputmode="numeric" min="0" max="99">')}
${field("nr-tall", "Tall lockers, at least", '<input id="nr-tall" type="number" inputmode="numeric" min="0" max="99">')}</div>
<label class="nr-check"><input type="checkbox" id="nr-map"> Only systems with a published map (atlas list only, no scanning)</label>
<label class="nr-check"><input type="checkbox" id="nr-purple"> Also scan purple-star systems (they need the purple-star unlock in game)</label>
<div class="nr-orow nr-speedrow"><label for="nr-speed">Scan speed</label><select id="nr-speed"><option value="gentle">Gentle (1 worker)</option><option value="balanced">Balanced (${SPEEDS.balanced})</option><option value="max">Maximum (${SPEEDS.max})</option></select></div>
<p class="nr-note">SpookBox contents are not searched here: they need a slower loot scan.</p>`, "nr-more")}${ddHtml("how", "How the scan works and what is shared", `
<p class="nr-note">Find a derelict close to where you are, then check in after each jump to see how far is left. Systems you scan here are added to the atlas, the same as Contribute, so nobody has to scan them again. Your position, check-ins and scout name stay here.</p>
<p class="nr-note">The scan works outward from your region, nearest first, in this browser. The radius is an upper limit: it stops at ${MAX_MATCH} matches, at the radius, or when you press Stop. Every Galaxy 0 system it finishes is added to the atlas, the same as Contribute. Other galaxies are never uploaded. Your position, check-ins and scout name are never sent. Systems already in the atlas, or scanned in this browser with their numbers saved, are not scanned again but still count as matches. A system whose numbers are no longer saved is scanned again on this device and not uploaded again. Neither are the last 8 below each region's star count, which may not exist.</p></details>
`, "nr-help nr-about")}</div>
</section>
<div class="nr-actbar"><button type="button" class="nr-gold" id="nr-find">${ICON_CROSS}<span>Scan</span></button></div>
</div>
</div>
</div>`;
    document.body.appendChild(dlg);
    const sel = $("nr-gal");
    sel.innerHTML = Array.from({ length: 256 }, (_, b) => `<option value="${b}">${esc(gname(b))}</option>`).join("");
    fill();
    dlg.addEventListener("click", onClick); ddWire(dlg);
    dlg.addEventListener("input", onInput);
    dlg.addEventListener("change", onInput);
    dlg.addEventListener("close", onClose);
    dlg.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") { e.preventDefault(); const f = e.target.closest("[data-enter]"); if (f) { const b = $(f.dataset.enter); if (b) b.click(); } else if (e.target.id === "nr-pos" || e.target.closest(".nr-view")) { if (!run) $("nr-find").click(); } } });
    paintTrip(); paintResults(); syncState();
  }
  function fill() {
    $("nr-pos").value = S.pos || ""; syncPad($("nr-pos"));
    const gal = S.gal != null ? S.gal : globalThis.dvGalaxy ? dvGalaxy.selected() : 0;
    setGalaxy(gal);
    $("nr-range").value = S.range; $("nr-mods").value = S.wants.mods;
    $("nr-rmod").value = S.wants.rewardModule; $("nr-rcls").value = S.wants.reward; $("nr-rooms").value = S.wants.maxRooms;
    $("nr-crates").value = S.wants.minCrates; $("nr-brief").value = S.wants.minBriefcases; $("nr-tall").value = S.wants.minTall;
    $("nr-map").checked = !!S.wants.hasMap; $("nr-purple").checked = !!S.wants.purple;
    $("nr-speed").value = speedKey();
    showPosNote(); galNote();
  }
  function readForm() {
    S.pos = $("nr-pos").value; S.gal = Number($("nr-gal").value) || 0;
    const r = Math.round(Number($("nr-range").value)); S.range = r >= 1 && r <= 99999 ? r : 1000;
    Object.assign(S.wants, { mods: $("nr-mods").value, rewardModule: $("nr-rmod").value, reward: $("nr-rcls").value, maxRooms: $("nr-rooms").value, minCrates: $("nr-crates").value,
      minBriefcases: $("nr-brief").value, minTall: $("nr-tall").value, hasMap: $("nr-map").checked, purple: $("nr-purple").checked });
    save();
  }
  // ---- what the screen shows, from the state: data-step on the dialog drives the phone layout (one thing at a time), data-run the Scan / Stop swap
  let padTouched = false, padPos = null;
  function setPadOpen(open) {
    const w = $("nr-padwrap"), b = $("nr-padtoggle"); if (!w) return;
    w.dataset.open = open ? "1" : "0"; if (b) b.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function syncState() {
    if (!dlg) return;
    const p = curPos();
    dlg.dataset.run = run ? "1" : "0";
    dlg.dataset.step = run ? "scan" : !p.ok ? "enter" : results.length ? "done" : "ready";
    dlg.dataset.view = tripOpen && S.trip ? "trip" : "scan";
    const h2 = $("nr-title"); if (h2) h2.textContent = dlg.dataset.view === "trip" ? NEAR_TITLE + " · Heading there" : NEAR_TITLE;   // the full-screen Heading there view names itself in the title bar
    const sh = $("nr-trip-show"); if (sh) sh.hidden = !(S.trip && !(tripOpen && S.trip));
    // the keypad folds away once the position is complete, and opens again when it is not (the person can still open or close it)
    const lab = $("nr-padlabel"); if (lab) { const n = String($("nr-pos").value || "").replace(/[^0-9A-Fa-f]/g, "").length; lab.textContent = p.ok ? "Glyphs (" + 12 + ")" : n && n < 12 && !/[:]/.test($("nr-pos").value) ? "Glyphs (" + n + " of 12)" : "Glyphs"; }
    const x = $("nr-pos-x"); if (x) x.hidden = !$("nr-pos").value;
    const g = $("nr-mapgal"); if (g) g.textContent = gname(p.ok ? p.gal : (S.gal != null ? S.gal : 0));
  }
  function onInput(e) {
    const t = e.target;
    if (!(t instanceof Element) || !dlg.contains(t)) return;
    if (t.id === "nr-gal") { setGalaxy(Number(t.value)); galNote(); }
    if (t.closest(".nr-view") && t.id) { readForm(); }
    if (t.id === "nr-pos" || t.id === "nr-ci") syncPad(t);
    if (t.id === "nr-pos" || t.id === "nr-gal") { showPosNote(); if (t.id === "nr-gal") { stale(); } }
    if (t.id === "nr-range") { paintResults(); }
    if (t.id === "nr-drive" && e.type === "change") { const v = Math.round(Number(t.value)); S.drive = v >= 50 && v <= 99999 ? v : 1000; save(); paintResults(); paintTrip(); }
    if (t.id === "nr-speed") { S.speed = t.value; save(); if (manualStart()) recalibrate(); else msPer = 0; }
    if (t.id && /^nr-(pos|mods|rmod|rcls|rooms|crates|brief|tall|map|purple|range)$/.test(t.id)) stale();
    try { if (t.id && /^nr-(pos|gal|range)$/.test(t.id)) scanMapSoon(); syncState(); } catch (e) { try { console.warn("[near me]", e); } catch (_) {} }
  }
  // wants or position changed: the list on screen is from the earlier question
  function stale() { if (!run && results.length && !$("nr-status").dataset.stale) { $("nr-status").dataset.stale = "1"; msg("nr-status", "The list below is for the earlier position or wants. Press Scan to update it."); } }
  function onClose() {
    clearTimeout(mapTimer); ddClose(false); stopMap();   // the worker holds 133 MB of memory: stopped whenever the window closes
    if (run) stopScan("Stopped: the page was closed.");
    if (nameRun) nameRun.stop = true;
    if (location.hash === "#/near") history.replaceState(null, "", "#/");
  }
  function openDlg() {
    build();
    if (!dlg.open) { dlg.showModal(); }
    if (isTouch()) { const ae = document.activeElement; if (ae && dlg.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { ae.blur(); dlg.setAttribute("tabindex", "-1"); try { dlg.focus({ preventScroll: true }); } catch (_) {} } }
    if (globalThis.dvGalaxy && S.gal == null) setGalaxy(dvGalaxy.selected());
    try { dlg.setAttribute("tabindex", "-1"); if (!isTouch() && !S.trip) $("nr-pos").focus({ preventScroll: true }); else dlg.focus({ preventScroll: true }); } catch (_) {}   // the first focus is not the close button
    if (S.trip && !tripShown) { tripShown = true; tripOpen = true; }   // a trip in progress opens on its panel, like before
    showPosNote();
    syncState(); mapSync();
  }
  function closeDlg() { if (dlg && dlg.open) dlg.close(); }

  function onClick(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const b = t.closest("button,a");
    if (!b) { const li = t.closest(".nr-res"); if (li && li.dataset.address) { selAddr = li.dataset.address; paintResults(); } return; }
    if (b.classList.contains("nr-ddb")) { ddToggle(b, e.detail === 0); return; }
    if (b.hasAttribute("data-nr-close")) { closeDlg(); return; }
    if (b.closest(".nr-glyphs") && !b.closest(".nr-res")) { padClick(b); return; }
    const id = b.id, d = b.dataset;
    if (id === "nr-find") { find(); return; }
    if (id === "nr-scan-stop") { stopScan("Stopped."); return; }
    if (id === "nr-padtoggle") { padTouched = true; setPadOpen($("nr-padwrap").dataset.open !== "1"); return; }
    if (id === "nr-pos-x") { const i = $("nr-pos"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); focusIn(i); return; }
    if (id === "nr-tpadtoggle") { tpadOpen = !tpadOpen; const w = $("nr-tpad"); if (w) w.dataset.open = tpadOpen ? "1" : "0"; b.setAttribute("aria-expanded", String(tpadOpen)); return; }
    if (id === "nr-trip-back") { tripOpen = false; syncState(); mapSync(); return; }
    if (id === "nr-trip-show") { tripOpen = true; syncState(); paintTrip(); return; }
    if (d.nrReward !== undefined) { revealReward(d.nrReward, b); return; }
    if (d.nrOpen !== undefined) { globalThis.dvSearchedAddress = d.nrOpen; closeDlg(); return; }   // the anchor then goes to #/d/..., the viewer's own rule
    if (d.nrStart !== undefined) { startTrip(d.nrStart); return; }
    if (d.nrCopy !== undefined) { copy(d.nrCopy, b); return; }
    if (id === "nr-ci-go") { checkIn(); return; }
    if (id === "nr-ci-name") { checkInName(); return; }
    if (id === "nr-name-stop") { if (nameRun) nameRun.stop = true; return; }
    if (d.nrPick !== undefined) { applyCheckIn(d.nrPick, "name", true); return; }
    if (id === "nr-trip-clear") { S.trip = null; tripOpen = false; save(); paintTrip(); syncState(); mapSync(); return; }
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

  // ---------------------------------------------------------------- the scan map (site-nearmap.js scan mode; every call is guarded: no map never stops the scan)
  // test seam (site12/near_check.mjs): sessionStorage dv.near.manual = 1 stops Scan after the estimate, dvNear.scanNow() then starts the scan
  const manualStart = () => { try { return sessionStorage.getItem("dv.near.manual") === "1"; } catch (_) { return false; } };
  let mapState = { ok: null, drawn: 0, skipped: 0, ringLy: 0 }, mapTimer = 0, tripOpen = false, tripShown = false;
  const NM = () => (globalThis.dvNearMap && typeof dvNearMap.scanMark === "function" ? dvNearMap : null);
  const mapKnown = (a) => !!((atlasSet && atlasSet.has(a)) || (run && run.rec && run.rec.has(a)) || (!run && lastRec && lastRec.has(a)));
  let lastRec = null;
  const modsLabel = (r) => { const m = r.row && r.row.frigate_modules; return m == null ? "match" : m + (r.row.frigate_modules_ambiguous ? "?" : "") + " modules"; };
  // only the selected match (the first by default) gets a text label; the others get the gold ring
  let selAddr = null;
  function mapMatches() {
    const m = NM(); if (!m) return;
    try {
      for (const r of results) m.scanMatch(r.address, modsLabel(r));
      const s = results.find((r) => r.address === selAddr) || results[0];
      if (s) m.scanSelect(s.address, modsLabel(s)); else m.scanSelect(null);
    } catch (_) {}
  }
  function mapReset(withKnown, keep) { const m = NM(); if (!m) return; try { m.scanReset(withKnown ? mapKnown : null, !!keep); mapMatches(); } catch (_) {} }
  function mapMark(a) { const m = NM(); if (!m) return; try { m.scanMark(a); } catch (_) {} }
  function mapNote() {
    const n = $("nr-mapnote"), i = $("nr-mapinfo"); if (!n) return;
    if (!mapState.ok) { n.textContent = mapState.msg || ""; if (i) i.textContent = ""; return; }
    n.textContent = S.range > mapState.mapLy ? `Map shows the nearest ${num(mapState.mapLy)} ly.` : "";
    if (i) i.textContent = num(mapState.drawn) + " systems drawn";
  }
  function scanMapSoon() { clearTimeout(mapTimer); mapTimer = setTimeout(scanMapSync, 350); }
  function scanMapSync() {
    const slot = $("nr-scanmap");
    if (!slot || !dlg || !dlg.open || tripOpen || run) return;
    const p = curPos();
    const empty = (msg) => { try { if (globalThis.dvNearMap && dvNearMap.hold) dvNearMap.hold(); } catch (_) {} mapState = { ok: msg ? false : null, msg: msg || "" }; const e = $("nr-mapempty"); if (e) { e.textContent = msg || "Enter where you are to see the stars around you."; e.hidden = false; slot.appendChild(e); } mapNote(); };
    if (!p.ok) { empty(""); return; }
    const gal0 = p.gal;
    rcLoad().then((rc) => {
      if (!dlg.open || tripOpen || run || curPos().address !== p.address) return;
      const code = rc.validSystemUA(gal0 | (p.sys << 8), (parseInt(p.address.slice(8), 16)) >>> 0, true);
      if (code === 1 || code === 2) { empty(code === 2 ? "No map: this region is in the galaxy core, there are no systems here." : "No map: these coordinates are outside the galaxy."); return; }
      scanMapGo(slot, p);
    }, () => scanMapGo(slot, p));
  }
  function scanMapGo(slot, p) {
    const e = $("nr-mapempty"); if (e) e.hidden = true;
    const gal = p.gal, rad = Math.max(25, Math.min(9999, Math.round(Number($("nr-range").value)) || S.range || 1000));
    const req = { gal, start: { x: p.x, y: p.y, z: p.z, sys: p.sys }, radius: rad, addr: (sys, x, y, z) => addrOf(sys, gal, x, y, z), name: (a) => sysName(a), known: mapKnown,
      onState: (info) => { mapState = Object.assign({}, info); mapNote(); if (info.ok) mapMatches(); } };
    mapState = { ok: null, msg: "" };
    loadMapScript().then(() => { if (!dlg.open || tripOpen) return; const s2 = $("nr-scanmap"); if (s2 === slot && NM()) dvNearMap.scanShow(slot, req); },
      () => { mapState = { ok: false, msg: "The star map file did not load. The scan still works." }; mapNote(); });
  }

  async function find() {
    readForm();
    const pos = curPos();
    if (!pos.ok) { msg("nr-status", `<span class="bad">${esc(pos.empty ? "Enter where you are first (glyphs, address or booster)." : pos.error)}</span>`); focusIn($("nr-pos")); setPadOpen(true); return; }
    try { const rc = await rcLoad(), code = rc.validSystemUA(pos.gal | (pos.sys << 8), (parseInt(pos.address.slice(8), 16)) >>> 0, true); if (code === 1 || code === 2) { msg("nr-status", `<span class="bad">${code === 2 ? "This region is in the galaxy core, there are no systems here." : "These coordinates are outside the galaxy."} Check the glyphs.</span>`); return; } } catch (_) {}
    setPadOpen(false);   // a phone shows the map and the matches once Scan is pressed; the keypad never moves by itself
    if (run) stopScan("Stopped.");
    const token = ++runToken, w = Object.assign({}, S.wants);
    results = []; atlasInfo = null; lastRun = null; lastEst = null; findPos = pos; lastRec = null;
    resultFilter = wantsText(w); resultFilterObj = Object.assign({}, w);
    $("nr-status").dataset.stale = "";
    const old = $("nr-scan"); if (old) { old.hidden = true; old.innerHTML = ""; }   // nothing from the earlier question while this one is worked out
    scanMapSync(); mapReset(false, false);
    const manual = manualStart();
    msg("nr-status", pos.gal === 0 ? "Checking the atlas near you..." : "The atlas lists Galaxy 0 only, so this galaxy is searched by scanning.");
    // v146 round 2: scanning starts the moment Scan is pressed (nothing is measured or looked up first). The atlas list runs alongside, and
    // the time estimate comes from the live speed after the first few systems. (manual = the test seam: the old estimate-first order.)
    if (!manual && !w.hasMap) { $("nr-scan").hidden = false; startScan({ pos, w }); if (run) run.atlasWait = true; }
    paintResults();
    let info;
    try { info = await atlasPass(w, pos, token); } catch (err) { info = { skipped: "error", error: String(err && err.message || err) }; }
    if (token !== runToken || info.cancelled) return;
    atlasInfo = info;
    if (info.found) for (const f of info.found) if (!results.some((x) => x.address === f.address)) results.push(f);
    results.sort(resCmp);
    const parts = [];
    if (info.skipped === "gal") parts.push("The atlas lists Galaxy 0 only, so this galaxy is searched by scanning.");
    else if (info.skipped === "rows") parts.push("The atlas list did not load, so only scanning is available.");
    else if (info.skipped === "error") parts.push("The atlas check failed: " + esc(info.error));
    else if (info.found) parts.push(info.found.length ? `${info.found.length} nearest of ${num(info.hits)} atlas matches.` : "No atlas system matches.");
    msg("nr-status", parts.join(" "));
    paintResults(); mapReset(true);
    if (run && token === runToken) { run.atlasWait = false; run.atlasAny = atlasAny || run.atlasAny; releaseHeld(run); }
    if (w.hasMap) { $("nr-scan").hidden = true; msg("nr-status", parts.join(" ") + " Published maps exist only for atlas systems, so nothing is scanned for this want."); return; }
    if (!manual) {
      lastEst = await estimate(w, pos);
      if (token !== runToken) return;
      lastEst.pos = pos; lastEst.w = w; paintScan();
      return;
    }
    $("nr-scan").hidden = false;
    msg("nr-scan", `<p class="nr-note">Measuring how fast this device scans...</p>`);
    try { await calibrate(pos); } catch (err) { msPer = 0; }
    if (token !== runToken) return;
    lastEst = await estimate(w, pos);
    lastEst.pos = pos; lastEst.w = w;
    paintScan();
  }
  function recalibrate() {
    if (!lastEst) return;
    const pos = lastEst.pos;
    calibBusy = true; paintScan();
    calibrate(pos).catch(() => { msPer = 0; }).then(() => { calibBusy = false; paintScan(); });
  }
  // the time estimate, short: the measured speed with the atlas hit rate (the long version is under "How this is estimated")
  function estShort(e, pos) {
    const n = workerCount(), rate = msPer && msN === n ? 1000 / msPer : 0;
    if (e.share == null) return "No atlas numbers for this want, so no time estimate.";
    if (e.share === 0) return "None of this kind in the atlas, so a match may never turn up.";
    const base = `About 1 system in ${num(e.perMatch)} matches.`;
    if (!rate) return base + " The time estimate comes after the first few systems.";
    return rate ? `${base} At ${rate.toFixed(1)} systems per second: first match ${fmtTime(e.perMatch / rate)}, ${MAX_MATCH} matches ${fmtTime(e.perMatch * MAX_MATCH / rate)} (a guess).` : base;
  }
  function paintScan() {
    syncState();
    const box = $("nr-scan");
    if (!box || box.hidden) return;
    const ready = !!lastEst && !calibBusy;
    const estP = ready ? `<p class="nr-est">${esc(estShort(lastEst, lastEst.pos))}${Number(lastEst.w.mods || 0) >= 7 && lastEst.share !== 0 ? ' <b class="warn">7+ modules is very rare. This can take hours.</b>' : ""}</p>` : '<p class="nr-note">Time estimate after the first few systems.</p>';
    if (run) {
      if (box.dataset.mode !== "run") {   // built once while the scan runs, so the Stop button is never replaced under the pointer
        box.dataset.mode = "run";
        box.innerHTML = '<div class="nr-prow"><div class="nr-pinfo"><div class="nr-ptitle" id="nr-ptitle"></div><div class="nr-bar" id="nr-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div></div><button type="button" class="nr-stop" id="nr-scan-stop">Stop</button></div><p class="nr-prog" id="nr-prog" role="status"></p><div id="nr-estl"></div>' + ddHtml("est", "How this is estimated", '<div class="nr-estfull" id="nr-estfull"></div>', "nr-help nr-estmore") + '<div id="nr-upl"></div>';
      }
      const secs = (performance.now() - run.t0) / 1000, rate = run.scanned / Math.max(1, secs), lim = Math.max(1, run.limit || S.range);
      if (run.scanned >= 5) { msPer = Math.max(1, Math.round(secs * 1000 / run.scanned)); msN = workerCount(); }   // live speed (start-up included), after the first few systems
      const pct = Math.min(100, Math.round(100 * run.reach / lim));
      $("nr-ptitle").innerHTML = `Scanning · <b>${num(run.scanned)}</b> systems <span>· ${run.reach > 0 ? "out to " + num(run.reach) + " of " + num(lim) + " ly" : "your own region first, radius " + num(lim) + " ly"}</span>`;
      const pb = $("nr-pbar"); pb.setAttribute("aria-valuenow", String(pct)); pb.firstChild.style.width = pct + "%";
      $("nr-prog").innerHTML = `<b>${num(run.scanned)}</b> systems scanned, <b>${run.regions}</b> regions reached, ${run.reach > 0 ? `searched out to <b>${num(run.reach)}</b> ly` : "searched your own region"}, <b>${run.matches}</b> of ${MAX_MATCH} matches, ${rate.toFixed(1)} systems per second, ${Math.round(secs)} s.${run.judged ? ` ${num(run.judged)} more known systems were judged from saved values without scanning.` : ""}`;
      $("nr-estl").innerHTML = estP; $("nr-upl").innerHTML = upLine();
      const ef = $("nr-estfull"), est2 = lastEst ? estHtml(lastEst, lastEst.w, lastEst.pos) : ""; if (ef.dataset.s !== est2) { ef.dataset.s = est2; ef.innerHTML = est2; }
      return;
    }
    box.dataset.mode = "idle";
    const est = lastEst ? estHtml(lastEst, lastEst.w, lastEst.pos) : "";
    const end = lastRun ? `<p class="nr-prog"><b>${esc(lastRun.text)}</b> ${num(lastRun.scanned)} systems scanned in ${Math.round(lastRun.secs)} s, ${lastRun.matches} match${lastRun.matches === 1 ? "" : "es"}${lastRun.reach > 0 ? ", searched out to " + num(lastRun.reach) + " ly" : ", searched your own region"}.</p>` : "";
    ddKeep(box, () => { box.innerHTML = `${end}${estP}${ready ? ddHtml("est", "How this is estimated", `<div class="nr-estfull">${est}</div>`, "nr-help nr-estmore") : ""}${upLine()}`; });
  }
  function revealReward(address, btn) {
    const r = results.find((x) => x.address === address);
    if (!r) return;
    const row = r.row, txt = row.reward_class || row.reward_name ? `${row.reward_class ? "Class " + row.reward_class + " " : ""}${row.reward_name || ""}` : "no end reward listed";
    btn.replaceWith(Object.assign(document.createElement("span"), { className: "nr-reward", textContent: "End reward (predicted): " + txt }));
  }
  function resultHtml(r, showRew) {
    const range = driveOf(), jumps = jumpsFor(r.d, range), name = sysName(r.address), row = r.row, mods = row.frigate_modules;
    const modsT = mods == null ? "unknown" : mods + (row.frigate_modules_ambiguous ? "?" : "");
    const rew = showRew ? `<span class="nr-reward">End reward (predicted): ${esc((row.reward_class ? "Class " + row.reward_class + " " : "") + (row.reward_name || "none listed"))}</span>` : `<button type="button" class="nr-link" data-nr-reward="${r.address}">Show end reward</button>`;
    return `<li class="nr-res" data-address="${r.address}"><div class="nr-res-row"><i class="nr-dot" aria-hidden="true"></i><div class="nr-res-t"><b class="nr-name">${esc(name || "System " + hex(r.sys, 3))}</b>${name ? ' <span class="nr-guess" title="Generated name, a best guess">best guess</span>' : ""}<div class="nr-res-sub"><span class="nr-mod">${esc(modsT === "unknown" ? "modules unknown" : modsT + " modules")}</span> · <b class="nr-dist">${r.d === 0 ? "Same region" : num(r.d) + " ly"}</b><span class="nr-src">${r.src === "atlas" ? "In the atlas" : "Scanned here"}</span></div>${showRew ? rew : `<button type="button" class="nr-link" data-nr-reward="${r.address}">Show end reward</button>`}</div></div>
<div class="nr-res-acts"><a class="nr-btn" href="#/d/${r.address}" data-nr-open="${r.address}">View derelict</a><button type="button" class="nr-btn nr-go" data-nr-start="${r.address}">Navigate <span aria-hidden="true">→</span></button></div>
${ddHtml("row:" + r.address, "Details", `<div class="nr-line"><code class="nr-glyphs">${glyphsOf(r.address)}</code><button type="button" class="nr-mini" data-nr-copy="${glyphsOf(r.address)}">Copy</button> <span class="nr-guess">${name ? "(generated name, a best guess)" : ""}</span> <span class="nr-gal">${esc(gname(r.gal))}</span>${isPurple(r.sys) ? ' <span class="nr-tag">Purple star: needs the purple-star unlock</span>' : ""}</div>
<div class="nr-line nr-facts">Predicted modules: <b>${esc(modsT)}</b> · crates ${row.salvage_crates ?? "?"} · rooms ${row.rooms ?? "?"}</div>
<div class="nr-line nr-facts">${r.d === 0 ? "" : "About " + jumps + " jump" + (jumps === 1 ? "" : "s") + " (estimate, at " + num(range) + " ly drive range)"}</div>`, "nr-rd")}</li>`;
  }
  function paintResults() {
    const list = $("nr-list");
    if (!list) return;
    const byReward = !!(resultFilterObj && (resultFilterObj.rewardModule || resultFilterObj.reward));
    const head = resultFilter ? `<li class="nr-head">${ddHtml("head", "Looking for: " + esc(resultFilter) + ". Sorted by modules, then distance. Predicted by the scanner.", "<p>Looking for: " + esc(resultFilter) + ". Sorted by modules, then distance. Predicted by the scanner.</p><p>Distances are from region to region, so each can be off by a few hundred light years.</p>", "nr-headdd")}</li>` : "";
    ddKeep(list, () => { list.innerHTML = results.length ? head + results.map((r) => resultHtml(r, byReward)).join("") : (resultFilter ? head : ""); });
    if (!results.some((r) => r.address === selAddr)) selAddr = results.length ? results[0].address : null;
    list.querySelectorAll(".nr-res").forEach((li) => li.classList.toggle("sel", li.dataset.address === selAddr));
    mapMatches();
    const em = $("nr-empty"); if (em) em.hidden = !!(results.length || resultFilter && run);
    syncState();
  }

  // ---------------------------------------------------------------- the trip (check-in)
  const hist = () => (S.trip && S.trip.hist) || [];
  function startTrip(address) {
    const res = results.find((x) => x.address === address), pos = findPos || curPos();
    if (!res || !pos.ok) return;
    S.trip = { target: { address, gal: res.gal }, hist: [{ address: pos.address, gal: pos.gal, via: pos.kind, t: Date.now() }] };
    tripOpen = true; save(); paintTrip(); syncState();
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
  // The Heading there view (v146 round 4, mockup near-mockups/6-heading-there.png): full screen, no scrolling. Top bar with the target and the numbers,
  // the star map over the full width, the check-in panel below (input, 12 slots, 16-glyph pad, name check-in, change target).
  let tpadOpen = false;
  function tripHtml() {
    const t = S.trip;
    if (!t) return "";
    const rp = tripReport(), g = t.target, range = driveOf(), name = sysName(g.address), sys = hex(rp.tg.sys, 3);
    const last = hist()[hist().length - 1];
    const jumps = jumpsFor(rp.d, range);
    const stats = rp.arrived ? "" : `<div class="nr-stats"><div><small>Distance left</small><b>${rp.same ? "0 ly" : num(rp.d) + " ly"}</b></div>` +
      `<div><small>Since last check-in</small><b>${rp.change == null ? "first position" : Math.abs(rp.change) < 1 ? "no change" : num(Math.abs(rp.change)) + " ly " + (rp.change < 0 ? "closer" : "farther")}</b></div>` +
      `<div><small>Jumps left (estimate)</small><b>${rp.same ? "in this region" : "about " + jumps}</b></div></div>`;
    const how = `<ul><li>Drag to turn the view; the stars follow the pointer. On a phone, drag with a finger. Scroll or pinch, or use + and &minus;, to zoom. Tap a star for its name.</li>
<li>The faint rings are distances from you.</li>
<li>The pink arrow points toward the galaxy core. The direction is worked out from the game's code, so it may be a few degrees off the glow you see in game, and the distance is only about. It is not an exact direction.</li>
<li>The dashed line is the straight line between you and the target. The Distance left figure counts whole regions, so the two numbers differ.</li></ul>
<p class="nr-note">Star positions are worked out from the game's code. They were checked against one Euclid and one Galaxy 9 system on game build 7.10 (25 of 25 distances matched). Names are generated guesses. <span class="nm-sw"><i style="background:#ffcf10"></i>yellow <i style="background:#f20b39"></i>red <i style="background:#3eef12"></i>green <i style="background:#4b85ff"></i>blue <i style="background:#903fff"></i>purple</span></p>
<p class="nr-note">Left, right, up and down on your galaxy map are not tested in-game, so none are given. Star positions inside a region are unknown, so no single next star is named.</p>`;
    let msgs = "";
    if (!rp.arrived) {
      if (rp.same) msgs = `<p class="nr-region" id="nr-hover"><b>Right region.</b> The target is system ${sys}${name ? ", generated name <b>" + esc(name) + "</b> (a best guess)" : ""}. You are in system ${hex(rp.cur.sys, 3)}.${name ? " On the galaxy map in the game, hover over stars until you see that name. It may show a different name, for example a name a player uploaded or a renamed system. In that case go by the portal glyphs, or try system number " + sys + "." : ""}</p>`;
      else {
        msgs = `<p class="nr-dir">The target is <b>${rp.coreDiff > 0 ? "toward" : "away from"}</b> the galaxy core from you (${num(Math.abs(rp.coreDiff))} ly ${rp.coreDiff > 0 ? "nearer" : "farther"}; you are ${num(coreDist(rp.cur))} ly from the core).</p>`;
        if (rp.off != null) msgs += `<p class="nr-dir">Your last jump was <b>${Math.round(rp.off)} degrees</b> off the straight line to the target${rp.off <= 15 ? " (close to on line)" : rp.off >= 90 ? " (you moved away from it)" : ""}.</p>`;
        else if (rp.moved === 0) msgs += `<p class="nr-dir">You are in the same region as your last check-in.</p>`;
      }
    }
    const lastNote = `<b>Last check-in:</b> <code>${glyphsOf(last.address)}</code> <span class="nr-lastn">${esc(gname(last.gal != null ? last.gal : tripGal()))} (${esc(last.via)}), region ${rp.cur.x}, ${rp.cur.y}, ${rp.cur.z}.${hist().length > 1 ? " Check-ins so far: " + hist().length + "." : ""}</span>`;
    return `<div class="nr-tbar"><button type="button" class="nr-mini nr-back" id="nr-trip-back">← Back to scan</button>
<p class="nr-target">Target: <b>${esc(name || "system " + sys)}</b>${name ? " <small>(generated name, a best guess)</small>" : ""} · ${esc(gname(g.gal))} · system ${sys} · <code>${glyphsOf(g.address)}</code>${isPurple(rp.tg.sys) ? ' <span class="nr-tag">Purple star: needs the purple-star unlock</span>' : ""}</p>
<div class="nr-orow nr-driverow"><label for="nr-drive">Drive range</label><span class="nr-drivebox"><input id="nr-drive" type="number" inputmode="numeric" min="50" max="99999" step="50" value="${driveOf()}" aria-label="Drive range for the jump estimate, in light years"><i>ly</i></span></div>
${stats}<div class="nr-tact">${rp.arrived || rp.same || !globalThis.dvNearRoute ? "" : dvNearRoute.hookHtml(rp.d, range) /* SITE v150 route hook */}<button type="button" class="nr-mini" id="nr-trip-undo"${hist().length > 1 ? "" : " disabled"}>Undo last check-in</button><button type="button" class="nr-mini" id="nr-trip-clear">Clear</button></div></div>
<div class="nr-tmap">${rp.arrived ? '<div class="nr-tarr"><p class="nr-arrived"><b>Arrived.</b> You are at the target system.</p></div>' : '<div id="nr-mapslot"></div>'}<div class="nr-tmapui">${ddHtml("maphow", "How to read this map", how, "nr-help")}</div>${msgs ? `<div class="nr-tmsg">${msgs}</div>` : ""}</div>
<div class="nr-tbot"><div class="nr-tleft"><div class="nr-ciline"><p class="nr-note nr-lastnote">${lastNote}</p><div class="nr-inline" data-enter="nr-ci-go"><label class="nr-sr" for="nr-ci">After your jump, where are you now? Glyphs, address or booster</label><input id="nr-ci" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Glyphs, address or booster"><button type="button" class="primary" id="nr-ci-go">Check in</button></div></div>
<p class="nr-note" id="nr-ci-msg" role="status"></p>
<div class="nr-padwrap nr-tpad" id="nr-tpad" data-open="${tpadOpen ? 1 : 0}"><button type="button" class="nr-padtoggle" id="nr-tpadtoggle" aria-expanded="${tpadOpen}"><span>Glyphs (12)</span><span class="nr-chev" aria-hidden="true"></span></button><div class="nr-tpadbody">${padHtml("nr-ci")}</div></div></div>
<div class="nr-tright"><div class="nr-inline" data-enter="nr-ci-name"><label class="nr-sr" for="nr-ci-n">No glyphs? Type the name of the system you are in (best guess)</label><input id="nr-ci-n" type="text" autocomplete="off" spellcheck="false" maxlength="60" placeholder="Current system name"><button type="button" id="nr-ci-name">Find by name</button></div>
<div id="nr-name-out" class="nr-note nr-nameout" role="status"></div>
<div class="nr-ddrow">${ddHtml("tgt", "Change target", `<div class="nr-inline" data-enter="nr-tgt-go"><input id="nr-tgt" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="Glyphs, address or booster of the new target"><button type="button" id="nr-tgt-go">Set target</button></div><p class="nr-note" id="nr-tgt-msg" role="status"></p>`, "nr-help")}${ddHtml("names", "About names", `<p class="nr-note">Names usually match, but a renamed system will not, so use glyphs then. Read the name as soon as you arrive. After a short wait the game can replace it with a name a player uploaded, and the atlas can't match those. Glyphs are the first choice, especially for the system you are in right now.</p>`, "nr-help")}</div></div></div>`;
  }
  function paintTrip() {
    const box = $("nr-trip");
    if (!box) return;
    const keep = {}; for (const id of ["nr-ci", "nr-ci-n", "nr-tgt"]) { const e = $(id); if (e) keep[id] = e.value; }
    const had = document.activeElement && document.activeElement.id;
    if (S.trip && !hist().length) S.trip = null;
    box.hidden = !S.trip;
    ddKeep(box, () => { box.innerHTML = S.trip ? tripHtml() : ""; });
    for (const id in keep) { const e = $(id); if (e) e.value = keep[id]; }
    syncPad($("nr-ci"));
    if (had && $(had)) $(had).focus();
    syncState(); mapSync();
  }
  // ---------------------------------------------------------------- star map (site-nearmap.js, loaded when first needed)
  // Shown once there is a start (the latest check-in) and a target. Nothing is sent: star positions are worked out in this browser.
  let mapLoad = null;
  function loadMapScript() {
    if (globalThis.dvNearMap) return Promise.resolve();
    if (!mapLoad) mapLoad = new Promise((ok, no) => { const s = document.createElement("script"); s.src = "site-nearmap.js"; s.onload = ok; s.onerror = () => { mapLoad = null; no(new Error("load")); }; document.head.appendChild(s); });
    return mapLoad;
  }
  function stopMap() { if (globalThis.dvNearMap) dvNearMap.stop(); }
  function mapSync() {
    if (!tripOpen || !S.trip) { scanMapSync(); return; }   // the scan map and the route map share one canvas: whichever view is showing gets it
    const slot = $("nr-mapslot");
    if (!slot || !dlg || !dlg.open) { stopMap(); return; }
    const rp = tripReport();
    if (!rp || rp.arrived) { stopMap(); return; }
    const gal = tripGal(), cur = rp.cur, tg = rp.tg;
    const req = { gal, start: { x: cur.x, y: cur.y, z: cur.z, sys: cur.sys }, target: { x: tg.x, y: tg.y, z: tg.z, sys: tg.sys },
      addr: (sys, x, y, z) => addrOf(sys, gal, x, y, z), name: (a) => sysName(a) };
    loadMapScript().then(() => { const s2 = $("nr-mapslot"); if (s2 === slot && S.trip && dlg.open) dvNearMap.show(slot, req); },
      () => { slot.innerHTML = '<p class="nr-note bad">The star map file did not load. Near me still works.</p>'; });
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
    const h = hist(), from = coordsOf(h[h.length - 1].address), gal = tripGal(), limit = Math.min(Math.max(100, driveOf()), NAME_MAX_LY);
    const rn = nameRun = { stop: false, total: 0, done: 0, hits: 0, q, limit };
    out.className = "nr-note"; paintNameProgress(rn);
    let hits = [];
    try { hits = await nameSearch(q, from, gal, limit, rn); } catch (e) { out.className = "nr-note bad"; out.textContent = "The name search could not start: " + String((e && e.message) || e); nameRun = null; return; }
    if (nameRun !== rn) return;
    nameRun = null;
    hits.sort((a, b) => a.d - b.d || (a.address < b.address ? -1 : 1));
    const stopped = rn.stop, within = `within ${num(limit)} ly of your last position`;
    if (!hits.length) {
      out.className = "nr-note bad";
      out.innerHTML = stopped ? "Stopped before a match was found." : `No system called <b>${esc(q)}</b> was found ${within}. The system may be renamed, it may be a name a player uploaded, or it is farther away. Names usually match, but those will not. Check in with glyphs instead. If you noted the first name the game showed on arrival, try that name.`;
      return;
    }
    if (hits.length === 1 && !stopped) { out.className = "nr-note ok"; applyCheckIn(hits[0].address, "name", false); return; }
    out.className = "nr-note";
    out.innerHTML = `<p>${stopped ? "Stopped. Found so far: " : ""}${hits.length} systems are called <b>${esc(q)}</b> ${within}. Pick yours (best guess):</p><ul class="nr-picks">${hits.slice(0, 12).map((x) => `<li><code>${glyphsOf(x.address)}</code> ${esc(gname(gal))} ${num(x.d)} ly from your last position, system ${hex(x.sys, 3)} <button type="button" class="nr-mini" data-nr-pick="${x.address}">Use this</button></li>`).join("")}</ul>`;
  }
  function paintNameProgress(rn) {
    const out = $("nr-name-out");
    if (!out || nameRun !== rn) return;
    const pct = rn.total ? Math.round(rn.done * 100 / rn.total) : 0;
    out.innerHTML = `Searching regions within ${num(rn.limit)} ly of your last position, nearest first: ${rn.done} of ${rn.total} (${pct}%), ${rn.hits} match${rn.hits === 1 ? "" : "es"} so far. <button type="button" class="nr-mini" id="nr-name-stop">Stop</button><div class="nr-bar"><span style="width:${pct}%"></span></div>`;
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
  globalThis.dvNear = { parsePos, boosterOf, addrOf, coordsOf, dist, coreDist, jumpsFor, offLine, shell, glyphsOf, hubGlyphs, isPurple, normName,
    inSet: (a) => !!(atlasSet && atlasSet.has(a)),
    up: () => ({ found: upStats.found, failed: upStats.failed, queued: upStats.queued, topQueue: upQ.length, busy: upStats.busy, seen: [...upSeen], pending: globalThis.dvNearPending ? dvNearPending() : 0 }),
    state: () => ({ S, results, run: run ? { workers: run.workers.length, scanned: run.scanned, matches: run.matches, regions: run.regions, reach: run.reach, stop: run.stop, judged: run.judged } : null, nameRun: !!nameRun, msPer, lastRun, lastEst, atlasInfo, storeOk, workerCount, speed: speedKey() }),
    scanNow: () => startScan(), mapState: () => mapState, view: () => ({ tripOpen }), title: NEAR_TITLE,
    open: openDlg, close: closeDlg };
})();
