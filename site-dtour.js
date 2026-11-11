/* site-dtour.js (SITE v166, user request 2026-11-10): "Derelict tour" in Near me. A short chain of EXISTING systems (atlas rows near the start plus
 * systems this browser's Near me scan found) for close system hopping, built in this browser. Nothing is sent anywhere (0 POSTs).
 *
 *   1. Auto tour: start, radius, minimum predicted modules, number of stops, drive range (shared with Heading there, S.drive).
 *      Method: nearest-next chain from the start, then local search: 2-opt (reverse a stretch) and swap-in (replace a stop by an unused
 *      candidate) while the total gets shorter. The result is never longer than the nearest-next chain. Runs on the page in a few
 *      milliseconds for hundreds of candidates (time budget 250 ms); only collecting the atlas rows is time-sliced.
 *   2. Your own stops: "Add to tour" on Near me results and on a system page; "Plan best order" orders them shortest-path from the start.
 *      Both modes show one list.
 *   3. Copy tour (plain text), Clear tour. Saved in the browser under dv.tour.v1 with the galaxy it was built in.
 *
 * Distance = dvNear.dist (400 ly per region, the same function as Near me). Positions and galaxy come from Near me (dvNear.tourApi).
 * Finished runs: the viewer's own run history (localStorage dv.modern.done, read only) plus this tour's "Mark done" marks.
 * v168 additions: marker reach (a hop beyond one region on any axis may not draw in game), "Total modules wanted", Reward filter and "one of each
 * variety" (opt-in; rewards stay hidden unless picked), starter routes (starter-routes.json, built offline by starter/build_starter_routes.py),
 * start fills, a Tour button on the main page, "Tour from here" on a system page.
 * Files: this file and site-dtour.css. Hooks elsewhere: site-near.js (button in the header, the tick box on result rows, tourApi),
 * integrate.py (script tags, copy list). The old guided tour is site-tour.js (a different feature). */
(function (root) {
  "use strict";
  const KEY = "dv.tour.v1", DONE_MAX = 4000, POOL_MAX = 600, BUDGET_MS = 250, STOPS_MIN = 3, STOPS_MAX = 20, STOPS_MAXG = 40, STOPS_DEF = 8, MARK_AXIS = 1, MARK_DIST = Math.SQRT2;
  const LY = 400;
  const dist0 = (a, b) => LY * Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  // ------------------------------------------------------------------ pure planner (tested in Node by tour_check.mjs)
  // v168: the in-game marker only draws when the target is inside the loaded star block (FINDINGS 10.1): at most 1 region on every axis,
  // and (margin) at most sqrt(2) regions in a straight line. p, q = {x,y,z} in regions (signed).
  function markerReach(p, q) {
    const dx = Math.abs(p.x - q.x), dy = Math.abs(p.y - q.y), dz = Math.abs(p.z - q.z);
    return Math.max(dx, dy, dz) <= MARK_AXIS && Math.hypot(dx, dy, dz) <= MARK_DIST + 1e-9;
  }
  const cmpC = (a, b) => a.d - b.d || (a.a < b.a ? -1 : a.a > b.a ? 1 : 0);
  // candidates {a,x,y,z,...} -> those inside the radius, enough modules, not excluded, not the start system; nearest first, at most POOL_MAX
  function pick(start, cands, o, dfn) {
    dfn = dfn || dist0; o = o || {};
    const seen = new Set(), out = [];
    for (const c of cands) {
      if (!c || seen.has(c.a)) continue;
      seen.add(c.a);
      if (o.exclude && o.exclude.has(c.a)) continue;
      if (o.only && !o.only.has(c.a)) continue;
      if (o.minMods && !(c.m != null && c.m >= o.minMods)) continue;
      if (o.totalMods && !(c.m != null && c.m > 0)) continue;
      if (o.rcls && c.rc !== o.rcls) continue;                 // reward filters: only systems whose reward is known and solid (rc/rt null = unknown)
      if (o.rtype && c.rt !== o.rtype) continue;
      if (o.rmod && !(c.rt && c.rt !== "unknown")) continue;
      const d = dfn(start, c);
      if (o.radius && d > o.radius) continue;
      if (start.a && c.a.slice(3, 6) === start.a.slice(3, 6) && c.a.slice(8) === start.a.slice(8) && c.a.slice(6, 8) === start.a.slice(6, 8)) continue;
      out.push(Object.assign({}, c, { d }));
    }
    out.sort(cmpC);
    return out.slice(0, o.pool || POOL_MAX);
  }
  const pathLen = (start, list, dfn) => { let t = 0, p = start; for (const s of list) { t += dfn(p, s); p = s; } return t; };
  const modsOf = (list) => list.reduce((n, s) => n + (Number(s.m) > 0 ? Number(s.m) : 0), 0);
  function nnChain(start, pool, k, dfn, goal) {
    const left = pool.slice(), out = []; let p = start, sum = 0;
    while (out.length < k && left.length && !(goal && sum >= goal)) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < left.length; i++) { const d = dfn(p, left[i]); if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && left[i].a < left[bi].a)) { bd = d; bi = i; } }
      p = left.splice(bi, 1)[0]; out.push(p); sum += Number(p.m) > 0 ? Number(p.m) : 0;
    }
    return out;
  }
  // one of each variety (reward type): nearest system with a type not yet covered, until none is left or k is reached; then, only if a total
  // modules goal is still unmet, nearest-first filler. Candidates without a solid type are never picked for variety.
  function varietyChain(start, pool, k, dfn, goal) {
    const left = pool.slice(), out = [], seen = new Set(); let p = start, sum = 0;
    const take = (i) => { p = left.splice(i, 1)[0]; out.push(p); sum += Number(p.m) > 0 ? Number(p.m) : 0; if (p.rt) seen.add(p.rt); };
    const nearest = (ok) => { let bi = -1, bd = Infinity; for (let i = 0; i < left.length; i++) { if (!ok(left[i])) continue; const d = dfn(p, left[i]); if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && bi >= 0 && left[i].a < left[bi].a)) { bd = d; bi = i; } } return bi; };
    while (out.length < k) { const i = nearest((c) => c.rt && c.rt !== "unknown" && !seen.has(c.rt)); if (i < 0) break; take(i); }
    while (goal && sum < goal && out.length < k) { const i = nearest(() => true); if (i < 0) break; take(i); }
    return out;
  }
  // improve an open path (start fixed): 2-opt and, when spare candidates are given, swap-in. Only strict improvements, so it ends.
  function improve(start, chain, spare, dfn, budgetMs) {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()), t0 = now(), EPS = 1e-7;
    const ch = chain.slice(), sp = (spare || []).slice(), n = ch.length;
    const at = (i) => (i < 0 ? start : ch[i]);
    let better = true, guard = 0;
    while (better && now() - t0 < budgetMs && guard++ < 500) {
      better = false;
      for (let i = 0; i < n - 1 && !better; i++) {                 // 2-opt: reverse ch[i..j]
        for (let j = i + 1; j < n; j++) {
          const a = at(i - 1), b = ch[i], c = ch[j], nx = j + 1 < n ? ch[j + 1] : null;
          const delta = dfn(a, c) + (nx ? dfn(b, nx) : 0) - dfn(a, b) - (nx ? dfn(c, nx) : 0);
          if (delta < -EPS) { for (let l = i, r = j; l < r; l++, r--) { const t = ch[l]; ch[l] = ch[r]; ch[r] = t; } better = true; break; }
        }
      }
      if (better) continue;
      for (let p = 0; p < n && !better; p++) {                      // swap-in: replace ch[p] by a spare candidate
        const a = at(p - 1), nx = p + 1 < n ? ch[p + 1] : null, cur = dfn(a, ch[p]) + (nx ? dfn(ch[p], nx) : 0);
        for (let s = 0; s < sp.length; s++) {
          const c = sp[s], nw = dfn(a, c) + (nx ? dfn(c, nx) : 0);
          if (nw < cur - EPS) { const old = ch[p]; ch[p] = c; sp[s] = old; better = true; break; }
        }
      }
    }
    return ch;
  }
  // legs and running totals for a start and an ordered list
  function legs(start, list, dfn) {
    dfn = dfn || dist0;
    let p = start, run = 0;
    return list.map((s) => { const leg = dfn(p, s); run += leg; p = s; return { leg, run }; });
  }
  // auto tour: nearest-next chain over the pool, then improved. {stops, total, baseline, candidates}
  function plan(start, cands, o, dfn) {
    dfn = dfn || dist0; o = o || {};
    const goal = Math.max(0, Math.floor(Number(o.totalMods) || 0)), cap = goal ? STOPS_MAXG : STOPS_MAX;
    const k = Math.max(0, Math.min(Math.floor(o.stops || STOPS_DEF), cap)), pool = pick(start, cands, o, dfn);
    const varAvail = new Set(pool.filter((c) => c.rt && c.rt !== "unknown").map((c) => c.rt)).size;
    if (!pool.length || !k) return { stops: [], total: 0, baseline: 0, candidates: pool.length, mods: 0, goal, reached: !goal, limited: goal ? "pool" : null, varieties: 0, varAvail };
    const base = o.variety ? varietyChain(start, pool, k, dfn, goal) : nnChain(start, pool, k, dfn, goal), inChain = new Set(base.map((s) => s.a));
    const stops = improve(start, base, goal || o.variety ? [] : pool.filter((c) => !inChain.has(c.a)), dfn, o.budget || BUDGET_MS);
    const mods = modsOf(stops), reached = !goal || mods >= goal;
    return { stops, total: pathLen(start, stops, dfn), baseline: pathLen(start, base, dfn), candidates: pool.length, mods, goal, reached,
      limited: reached ? null : base.length >= pool.length ? "pool" : "max", varieties: new Set(stops.filter((c) => c.rt && c.rt !== "unknown").map((c) => c.rt)).size, varAvail };
  }
  // ticked stops only: shortest-path order from the start (nearest-next, then 2-opt). Nothing is added or dropped.
  function order(start, list, dfn, budget) {
    dfn = dfn || dist0;
    const sorted = list.slice().sort((a, b) => a.a < b.a ? -1 : 1);
    const base = nnChain(start, sorted, sorted.length, dfn), stops = improve(start, base, [], dfn, budget || BUDGET_MS);
    return { stops, total: pathLen(start, stops, dfn), baseline: pathLen(start, base, dfn) };
  }
  const galWarn = (tourGal, nowGal, label) => (tourGal == null || nowGal == null || tourGal === nowGal ? null
    : `This tour was built in ${label(tourGal)}. The galaxy is now ${label(nowGal)}. Glyphs do not include the galaxy. Check it is right.`);
  const jumpsSum = (ls, range, jf) => ls.reduce((n, l) => n + jf(l.leg, range), 0);
  // mo (v168, optional): {goal, per, rlabel} adds modules per stop and in the header; rlabel(stop) is given only when a Reward filter is on
  // v170: the minimum-modules filter text is only printed when it is true for every stop; otherwise the real average per stop
  const perText = (stops, per) => { const m = stops.map((s) => Number(s.m)).filter((n) => n >= 0); if (!m.length) return ""; if (per && stops.every((s) => Number(s.m) >= per) && !stops.some((s) => s.src === "starter")) return `${per}+ per system`; if (!per && !stops.some((s) => s.src === "starter")) return ""; return `${(m.reduce((a, b) => a + b, 0) / m.length).toFixed(1)} per stop on average`; };
  const tourText = (galName, stops, ls, glyphs, fmt, mo) => {
    const total = ls.length ? ls[ls.length - 1].run : 0, mods = modsOf(stops);
    const head = `Derelict tour (${galName}): ${stops.length} stop${stops.length === 1 ? "" : "s"}, ${fmt(total)} ly`
      + (mo ? `, ${mods} predicted module${mods === 1 ? "" : "s"}${mo.goal ? ` (${mo.goal} wanted)` : ""}${perText(stops, mo.per) ? `, ${perText(stops, mo.per)}` : ""}` : "");
    return [head].concat(stops.map((s, i) => `${i + 1}. ${glyphs(s.a)}, ${fmt(ls[i].leg)} ly`
      + (mo ? `, ${s.m == null ? "modules unknown" : s.m + " predicted module" + (Number(s.m) === 1 ? "" : "s")}${mo.rlabel && mo.rlabel(s) ? ", " + mo.rlabel(s) : ""}` : ""))).join("\n");
  };
  const pure = { dist0, pick, nnChain, varietyChain, improve, legs, plan, order, pathLen, galWarn, jumpsSum, tourText, markerReach, modsOf, STOPS_MIN, STOPS_MAX, STOPS_MAXG, STOPS_DEF, POOL_MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  if (typeof document === "undefined") return;

  // ------------------------------------------------------------------ browser part
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Math.round(n).toLocaleString("en-US");
  const ADDR = /^[0-9A-F]{16}$/;
  const N = () => root.dvNear;
  let API = null;
  const api = () => API || (API = (N() && N().tourApi && N().tourApi()) || null);
  const gname = (g) => (root.dvGalaxy ? dvGalaxy.label(g) : g === 0 ? "Euclid" : "Galaxy " + (g + 1));
  const galOf = (a) => parseInt(a.slice(6, 8), 16);
  const ic = (d) => `<svg class="dt-ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    prev: '<path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/>',
    tour: '<circle cx="5" cy="18" r="2.4"/><circle cx="12" cy="6" r="2.4"/><circle cx="19" cy="15" r="2.4"/><path d="M6.4 16 10.8 8M13.6 7.6 17.8 13"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    nav: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', hops: '<circle cx="5" cy="18" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="19" cy="16" r="2"/><path d="M6.5 16.5 10.6 10.6M13.5 10.2l4 4.4"/>',
    next: '<path d="m9 5 7 7-7 7"/>', build: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>', order: '<path d="M4 7h10M4 12h14M4 17h8"/><path d="m17 5 3 3-3 3"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', me: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8"/>',
  };

  const TYPE_LABEL = { hyperdrive: "Hyperdrive", fuel: "Fleet fuel", speed: "Fleet speed / beacon", combat: "Fleet combat", exploration: "Fleet exploration", mining: "Fleet mining", trade: "Fleet trade", reactor: "Freighter reactor" };
  const rewardOn = () => !!(T.opts.reward || T.opts.variety);   // rewards are shown only when the user picked a Reward filter
  const rewardArgs = () => { const r = T.opts.reward || ""; return { rcls: r.startsWith("cls:") ? r.slice(4) : "", rtype: r.startsWith("type:") ? r.slice(5) : "", rmod: r === "mod", variety: !!T.opts.variety }; };
  const rlabel = (s) => { if (!rewardOn()) return ""; if (!s.rc && !s.rt) return "reward unknown"; return (s.rc ? s.rc + " class module" : "module") + (s.rt && TYPE_LABEL[s.rt] ? " · " + TYPE_LABEL[s.rt] : ""); };
  const markFar = (p, q) => !markerReach(p, q);
  const MARK_NOTE = "The in-game marker may not draw this far, fly closer first";

  // ---- state (browser only, key dv.tour.v1)
  const DEF = { v: 1, gal: null, start: "", opts: { radius: 1000, mods: "4", stops: STOPS_DEF, total: 0, reward: "", variety: false, touched: false }, stops: [], cur: 0, done: [] };
  let T = JSON.parse(JSON.stringify(DEF)), storeOk = true;
  (function load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!j || j.v !== 1) return;
      T = Object.assign({}, DEF, j, { opts: Object.assign({}, DEF.opts, j.opts || {}) });
      T.stops = Array.isArray(T.stops) ? T.stops.filter((s) => s && ADDR.test(String(s.a))) : [];
      T.done = Array.isArray(T.done) ? T.done.filter((a) => ADDR.test(String(a))) : [];
      if (!(T.cur >= 0 && T.cur < T.stops.length)) T.cur = 0;
    } catch (_) { storeOk = false; }
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(T)); storeOk = true; } catch (_) { storeOk = false; } };
  const viewerDone = () => { try { const o = JSON.parse(localStorage.getItem("dv.modern.done") || "{}"); return o && typeof o === "object" ? new Set(Object.keys(o).map((k) => k.toUpperCase())) : new Set(); } catch (_) { return new Set(); } };
  const doneSet = () => { const s = viewerDone(); for (const a of T.done) s.add(a); return s; };
  const isDone = (a) => T.done.includes(a);

  // ---- dvNear helpers (same functions as Near me)
  const co = (a) => Object.assign({ a }, N().coordsOf(a));
  const D = (p, q) => N().dist(p, q);
  const glyphs = (a) => N().glyphsOf(a);
  const sysName = (a) => { const A = api(); return A ? A.sysName(a) : ""; };
  const tourGalNow = () => { const A = api(); return A ? A.galNow() : 0; };
  const rangeNow = () => { const A = api(); const d = A && A.S().drive; return d >= 50 ? d : 1000; };

  // ---- start position: the last Heading there check-in (same galaxy), else the Near me position
  function defaultStart() {
    const A = api(); if (!A) return "";
    const gal = A.galNow(), h = A.hist(), last = h.length ? h[h.length - 1] : null;
    if (last && N().coordsOf(last.address).gal === gal) return N().glyphsOf(last.address);
    const p = A.curPos();
    return p && p.ok && p.gal === gal ? N().glyphsOf(p.address) : "";
  }
  function startPoint() {
    const text = ($("dt-start") ? $("dt-start").value : T.start) || "";
    const gal = T.stops.length && T.gal != null ? T.gal : tourGalNow();
    const p = N().parsePos(text, gal);
    if (!p.ok) return { ok: false, empty: !!p.empty, error: p.error || "" };
    return { ok: true, p, a: p.address, x: p.x, y: p.y, z: p.z, gal: p.gal };
  }

  // ---- candidates: atlas rows + this browser's scan results + saved scan rows
  const yieldMain = () => new Promise((r) => setTimeout(r, 0));
  let busy = 0, lastMs = 0, lastInfo = null;
  async function waitAtlas(token, ms) {
    const A = api(), end = Date.now() + ms;
    for (;;) { const r = A.rowsNow(); if (r) return r; if (token !== busy || Date.now() > end) return null; await new Promise((x) => setTimeout(x, 250)); }
  }
  async function collect(start, gal, mods, radius, token) {
    const A = api(), out = new Map(); let atlas = null;
    const { systemQuery } = await A.core();
    let RT = null; try { RT = await import("./reward-types.js"); } catch (_) { RT = null; }
    const q = systemQuery(A.filterOf({ mods: mods || "" }));
    const add = (address, row, src) => {
      if (!row || out.has(address) || galOf(address) !== gal) return;
      let ok = false; try { ok = q.matches(row); } catch (_) { ok = false; }
      if (!ok) return;
      const m = row.frigate_modules != null ? Number(row.frigate_modules) : null;
      const amb = !!row.reward_ambiguous, known = !amb && row.reward_name;
      out.set(address, Object.assign(co(address), { m, q: !!row.frigate_modules_ambiguous, src, rc: known && row.reward_class ? row.reward_class : null, rt: known && RT ? RT.rewardType(row.reward_name) : null }));
    };
    if (gal === 0) {
      atlas = await waitAtlas(token, 20000);
      if (token !== busy) return null;
      if (atlas) {
        for (let i = 0; i < atlas.length; i++) {
          const r = atlas[i];
          if (r.galaxy === 0) {
            const c = N().coordsOf(r.address);
            if (D(start, c) <= radius) add(r.address, r, "atlas");
          }
          if ((i & 8191) === 8191) { await yieldMain(); if (token !== busy) return null; }
        }
      }
    }
    for (const r of A.results()) add(r.address, r.row, r.src === "atlas" ? "atlas" : "scan");
    for (const [a, row] of A.scanned()) add(a, row, "scan");
    return { list: [...out.values()], atlas: !!atlas, atlasRows: atlas ? atlas.length : 0 };
  }

  // ---- building and editing the tour
  function setStops(list, why) {
    T.stops = list.map((s) => ({ a: s.a, m: s.m == null ? null : s.m, q: !!s.q, src: s.src || "pick", rc: s.rc || null, rt: s.rt || null }));
    if (!(T.cur >= 0 && T.cur < T.stops.length)) T.cur = 0;
    skipDoneCur(); save();
  }
  function skipDoneCur() { let i = T.cur; while (i < T.stops.length && isDone(T.stops[i].a)) i++; if (i < T.stops.length) T.cur = i; }
  async function build() {
    const A = api(); if (!A) return;
    readOpts();
    const s = startPoint();
    if (!s.ok) { setStatus(s.empty ? "Type where you start (glyphs), or press Use my position." : esc(s.error), "bad"); return; }
    const token = ++busy, t0 = performance.now();
    paintBusy(true);
    setStatus(root.dvLoading ? dvLoading.html("Looking for systems") : "Looking for systems...", "");
    try {
      const c = await collect(s, s.gal, T.opts.mods, T.opts.radius, token);
      if (token !== busy || !c) return;
      const skip = doneSet();
      const mm = T.opts.mods ? Number(T.opts.mods) : 0;
      const ra = rewardArgs(), res = plan(s, c.list, Object.assign({ radius: T.opts.radius, minMods: mm, exclude: skip, stops: T.opts.stops, totalMods: T.opts.total }, ra), D);
      const inR = c.list.filter((x) => D(s, x) <= T.opts.radius), rKnown = inR.filter((x) => x.rc).length;
      lastMs = Math.round(performance.now() - t0);
      lastInfo = { candidates: res.candidates, total: res.total, baseline: res.baseline, ms: lastMs, atlasRows: c.atlasRows };
      T.gal = s.gal; T.start = N().glyphsOf(s.a);
      if (!res.stops.length) {
        setStops([]); T.cur = 0; save();
        const why = s.gal !== 0 && !c.list.length
          ? `The atlas has no rows for ${esc(gname(s.gal))}. Run a Near me scan here first, then build the tour.`
          : !c.atlas && s.gal === 0 ? "The atlas list did not load. Check the connection and try again."
          : `No systems with ${mm ? mm + "+" : "any"} predicted modules${rewardOn() ? " and that reward" : ""} within ${num(T.opts.radius)} ly of the start. Try a bigger radius or fewer modules, or run a Near me scan.${rewardOn() ? ` Reward info is known for ${num(rKnown)} of ${num(inR.length)} systems in range.` : ""}`;
        paintBusy(false); paint(); setStatus(why, "bad"); return;
      }
      setStops(res.stops.map((x) => Object.assign({}, x, { src: x.src || "atlas" })));
      T.cur = 0; skipDoneCur(); save();
      paintBusy(false); paint();
      const short = !T.opts.total && !ra.variety && res.stops.length < T.opts.stops ? ` Only ${res.stops.length} matching system${res.stops.length === 1 ? "" : "s"} found.` : "";
      let extra = "";
      if (T.opts.total && !res.reached) extra += res.limited === "max" ? ` The stop limit (${res.stops.length}) was reached with ${num(res.mods)} of ${num(T.opts.total)} predicted modules. Raise the stop limit or lower the minimum modules.` : ` Only ${num(res.mods)} predicted modules found within the radius.`;
      if (ra.variety) extra += ` ${res.varieties} of ${res.varAvail} varieties found in range.`;
      if (rewardOn()) extra += ` Reward info is known for ${num(rKnown)} of ${num(inR.length)} systems in range.`;
      setStatus(`Tour built from ${num(res.candidates)} candidate${res.candidates === 1 ? "" : "s"}.${short}${extra}`, T.opts.total && !res.reached ? "bad" : "ok");
    } catch (e) {
      paintBusy(false); paint(); setStatus("Could not build the tour: " + esc(e && e.message || e), "bad");
    }
  }
  function planOrder() {
    if (T.stops.length < 2) { setStatus(T.stops.length ? "One stop needs no ordering." : "Add stops first (tick Add to tour on a result or a system page).", ""); return; }
    const s = startPoint();
    if (!s.ok) { setStatus(s.empty ? "Type where you start (glyphs), or press Use my position." : esc(s.error), "bad"); return; }
    const t0 = performance.now(), cur = T.stops[T.cur] && T.stops[T.cur].a;
    const res = order(s, T.stops.map((x) => Object.assign(co(x.a), x)), D);
    setStops(res.stops);
    T.cur = Math.max(0, T.stops.findIndex((x) => x.a === cur)); skipDoneCur(); save();
    lastMs = Math.round(performance.now() - t0); paint();
    setStatus(`Ordered ${T.stops.length} stops, shortest path from the start.`, "ok");
  }
  function addStop(address, mods) {
    const a = String(address || "").toUpperCase();
    if (!ADDR.test(a)) return { ok: false, text: "That is not a system address." };
    if (T.stops.some((s) => s.a === a)) return { ok: true, already: true };
    const g = galOf(a);
    if (T.stops.length && T.gal != null && g !== T.gal) return { ok: false, text: `This tour is in ${gname(T.gal)}. Clear it to add a system from ${gname(g)}.` };
    let m = mods == null ? null : mods, q = false, rc = null, rn = null;
    const rw = (r) => { if (r && !r.reward_ambiguous && r.reward_name) { rc = r.reward_class || null; rn = r.reward_name; } };
    if (m == null) { const A = api(), r = A && A.results().find((x) => x.address === a); if (r && r.row) { m = r.row.frigate_modules != null ? Number(r.row.frigate_modules) : null; q = !!r.row.frigate_modules_ambiguous; rw(r.row); } }
    if (m == null) { const A = api(), rows = A && A.rowsNow(); if (rows) for (let i = 0; i < rows.length; i++) if (rows[i].address === a) { m = rows[i].frigate_modules != null ? Number(rows[i].frigate_modules) : null; q = !!rows[i].frigate_modules_ambiguous; rw(rows[i]); break; } }
    if (!T.stops.length) T.gal = g;
    T.stops.push({ a, m, q, src: "pick", rc, rt: rn ? rewardTypeOf(rn) : null }); skipDoneCur(); save(); sync();
    return { ok: true };
  }
  const RT_PAT = [["hyperdrive", /hyperdrive/i], ["fuel", /fuel/i], ["speed", /beacon|expedition speed|coordinator/i], ["combat", /combat|battle/i], ["exploration", /explor|scientific|biological/i], ["mining", /mining|industrial|geo.scanner/i], ["trade", /trade|economy/i], ["reactor", /reactor/i]];
  const rewardTypeOf = (n) => { for (const [t, p] of RT_PAT) if (p.test(n)) return t; return "unknown"; };   // same table as reward-types.js
  function removeStop(a) {
    const i = T.stops.findIndex((s) => s.a === a); if (i < 0) return;
    T.stops.splice(i, 1);
    if (T.cur > i || T.cur >= T.stops.length) T.cur = Math.max(0, Math.min(T.cur - (T.cur > i ? 1 : 0), T.stops.length - 1));
    save(); sync();
  }
  function move(a, dir) {
    const i = T.stops.findIndex((s) => s.a === a), j = i + dir; if (i < 0 || j < 0 || j >= T.stops.length) return;
    const cur = T.stops[T.cur] && T.stops[T.cur].a;
    [T.stops[i], T.stops[j]] = [T.stops[j], T.stops[i]];
    T.cur = Math.max(0, T.stops.findIndex((s) => s.a === cur)); save(); paint();
    const b = dlg && dlg.querySelector(`[data-dt-act="${dir < 0 ? "up" : "down"}"][data-dt-a="${a}"]`); if (b && !b.disabled) b.focus({ preventScroll: true });
  }
  function toggleDone(a) {
    const i = T.done.indexOf(a);
    if (i >= 0) T.done.splice(i, 1); else { T.done.push(a); if (T.done.length > DONE_MAX) T.done.shift(); }
    if (isDone(a)) { const k = T.stops.findIndex((s) => s.a === a); if (k === T.cur) nextStop(true); }
    save(); paint();
  }
  function nextStop(quiet) {
    let i = T.cur + 1; while (i < T.stops.length && isDone(T.stops[i].a)) i++;
    if (i < T.stops.length) { T.cur = i; if (!quiet) { save(); paint(); } }
    else if (!quiet) setStatus("That is the last stop.", "");
    save();
  }
  function clearTour() { busy++; T.stops = []; T.cur = 0; save(); paintBusy(false); paint(); setStatus("Tour cleared.", ""); sync(); }

  // ---- starter routes (starter-routes.json, built offline from the atlas index; every hop inside marker reach)
  let STARTERS = null, starterFail = false;
  async function loadStarters() {
    if (!STARTERS && !starterFail) { try { const r = await fetch("starter-routes.json", { cache: "no-cache" }); if (!r.ok) throw new Error("http"); STARTERS = await r.json(); } catch (_) { starterFail = true; } }
    paintStarters();
  }
  const starterGroups = () => {
    if (!STARTERS) return [];
    const g = [];
    for (const t of STARTERS.tiers || []) if (t.routes && t.routes.length) g.push({ key: "t" + t.tier, label: `Starter route: ${t.tier} modules`, routes: t.routes });
    for (const t of STARTERS.special || []) if (t.routes && t.routes.length) g.push({ key: "s" + t.id, label: `Starter route: ${t.label}`, routes: t.routes, special: t });
    return g;
  };
  function paintStarters() {
    const box = $("dt-starterlist"); if (!box) return;
    if (starterFail || !STARTERS) { box.innerHTML = '<p class="dt-note">Starter routes could not be loaded. Build a tour below instead.</p>'; return; }
    const groups = starterGroups();
    box.innerHTML = '<p class="dt-note">Ready-made tours from the atlas (Galaxy 0, Euclid only). Predicted modules. Every hop is close enough for the in-game marker to draw. Portal to the first stop, then press Next stop.</p>'
      + groups.map((g) => `<div class="dt-tier"><b class="dt-tierh">${esc(g.label)}</b>${g.special && g.special.note ? `<p class="dt-note">${esc(g.special.note)}</p>` : ""}` + g.routes.map((r, i) => {
        const f = r.stops[0][0], nm = sysName(f);
        return `<div class="dt-srow"><span class="dt-stxt"><b>${num(r.mods)} predicted modules</b> · ${r.stops.length} stops · ${(r.mods / r.stops.length).toFixed(1).replace(/\.0$/, "")} per stop · ${num(r.ly)} ly${r.max_hop ? ` · longest hop ${num(r.max_hop)} ly` : ""}${g.special && g.special.target && r.mods < g.special.target ? ` · ${g.special.target - r.mods} short of ${g.special.target}` : ""}<br><span class="dt-note">Starts at ${esc(nm || "System " + f.slice(3, 6))} <code class="dt-gl">${glyphs(f)}</code></span></span><button type="button" class="dt-b dt-small" data-dt-act="starter" data-dt-g="${g.key}" data-dt-i="${i}">${ic(ICON.next)}Load route</button></div>`;
      }).join("") + "</div>").join("");
  }
  function loadStarter(key, i) {
    const g = starterGroups().find((x) => x.key === key), r = g && g.routes[i]; if (!r) return;
    busy++; paintBusy(false);
    const A = api(); if (A && tourGalNow() !== 0) A.setGalaxy(0);
    T.gal = 0;
    T.stops = r.stops.map((x) => ({ a: x[0], m: x[1], q: false, src: "starter", rc: x[2] || null, rt: x[3] || null }));
    if (g.special && g.special.cls) { T.opts.reward = "cls:" + g.special.cls; if ($("dt-reward")) $("dt-reward").value = T.opts.reward; }   // picking the S class route is picking a Reward filter
    T.cur = 0; T.start = glyphs(r.stops[0][0]); if ($("dt-start")) $("dt-start").value = T.start;
    skipDoneCur(); save(); showStartNote(); paint(); sync();
    const d = $("dt-starter"); if (d) d.open = false;
    setStatus(`Loaded: ${num(r.mods)} predicted modules in ${r.stops.length} stops. Portal to the first stop, then press Next stop.`, "ok");
  }

  // ---- window
  let dlg = null, nearDlg = null, returnToTour = false, returnPage = false, gKeep = null;
  const ICON_HEAD = ic(ICON.tour);
  function readOpts() {
    if (!dlg) return;
    const r = Math.round(Number($("dt-radius").value)); T.opts.radius = r >= 50 && r <= 99999 ? r : 1000;
    T.opts.mods = $("dt-mods").value;
    const tt = Math.round(Number($("dt-total").value)); T.opts.total = tt >= 1 ? Math.min(tt, 9999) : 0;
    const cap = T.opts.total ? STOPS_MAXG : STOPS_MAX;
    const k = Math.round(Number($("dt-stops").value)); T.opts.stops = k >= STOPS_MIN ? Math.min(k, cap) : k >= 1 ? STOPS_MIN : STOPS_DEF;
    T.opts.reward = $("dt-reward").value; T.opts.variety = $("dt-variety").checked;
    const d = Math.round(Number($("dt-range").value)); if (d >= 50 && d <= 99999 && api() && d !== rangeNow()) api().setDrive(d);
    T.start = $("dt-start").value; save();
  }
  function make() {
    if (dlg || !document.body) return;
    dlg = document.createElement("dialog");
    dlg.id = "dtour-dialog"; dlg.className = "sheet dt-dialog"; dlg.setAttribute("aria-labelledby", "dt-title");
    const rewardOpts = '<option value="">Any</option><option value="mod">Modules only</option>' + ['S', 'A', 'B', 'C'].map((c) => `<option value="cls:${c}">${c} class</option>`).join('') + Object.keys(TYPE_LABEL).map((t) => `<option value="type:${t}">${TYPE_LABEL[t]}</option>`).join('');
    const modsOpt = ['<option value="">Any</option>'].concat([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}">${n}+</option>`)).join("");
    dlg.innerHTML = `<div class="dt-top">${ICON_HEAD}<h2 id="dt-title">Derelict tour</h2><button type="button" class="dt-x" data-dt-act="close" aria-label="Close Derelict tour">×</button></div>
<div class="dt-body" id="dt-body">
<p class="dt-lead">A short chain of systems close to each other, for hopping between derelicts. Built here from the atlas and your Near me scan. Nothing leaves this browser.</p>
<details class="dt-starter" id="dt-starter" open><summary>Starter routes (Euclid, Galaxy 0)</summary><div id="dt-starterlist" class="dt-slist"><p class="dt-note">Loading starter routes...</p></div></details>
<section class="dt-set" aria-label="Tour settings">
<div class="dt-f dt-fstart"><label for="dt-start">Start (glyphs)</label><div class="dt-row"><input id="dt-start" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="12 glyph digits"></div><div class="dt-quick"><button type="button" class="dt-b dt-small" data-dt-act="mypos">${ic(ICON.me)}Use my position</button><button type="button" class="dt-b dt-small" data-dt-act="lastopen">${ic(ICON.tour)}Last system I opened</button><select id="dt-startstop" class="dt-selsmall" aria-label="Start at a stop in my tour"><option value="">A stop in my tour</option></select></div><p class="dt-note" id="dt-startnote"></p></div>
<div class="dt-f"><label for="dt-radius">Radius (ly)</label><input id="dt-radius" type="number" inputmode="numeric" min="50" max="99999" step="50"></div>
<div class="dt-f"><label for="dt-mods">Min. predicted modules</label><select id="dt-mods">${modsOpt}</select></div>
<div class="dt-f"><label for="dt-stops" id="dt-stopslab">Stops (${STOPS_MIN} to ${STOPS_MAX})</label><input id="dt-stops" type="number" inputmode="numeric" min="${STOPS_MIN}" max="${STOPS_MAX}" step="1"></div>
<div class="dt-f"><label for="dt-range">Drive range (ly)</label><input id="dt-range" type="number" inputmode="numeric" min="50" max="99999" step="50"></div>
<div class="dt-f"><label for="dt-total">Total modules wanted</label><input id="dt-total" type="number" inputmode="numeric" min="0" max="9999" step="1" placeholder="off"></div>
<div class="dt-f"><label for="dt-reward">Reward filter</label><select id="dt-reward">${rewardOpts}</select></div>
<div class="dt-f dt-fchk"><label class="dt-chk"><input id="dt-variety" type="checkbox"> Collect one of each variety</label></div>
</section>
<div class="dt-acts"><button type="button" class="dt-b dt-gold" id="dt-build" data-dt-act="build">${ic(ICON.build)}Build tour</button><button type="button" class="dt-b" data-dt-act="order">${ic(ICON.order)}Plan best order</button><button type="button" class="dt-b" data-dt-act="copytour">${ic(ICON.copy)}Copy tour</button><button type="button" class="dt-b" id="dt-prevbtn" data-dt-act="preview">${ic(ICON.prev)}Preview route</button><button type="button" class="dt-b" data-dt-act="clear">${ic(ICON.trash)}Clear tour</button></div>
<p class="dt-note" id="dt-prevhint" hidden>Preview route needs 2 or more stops.</p>
<p class="dt-help">Build tour picks stops for you and replaces the list. Or tick Add to tour on Near me results and system pages, then Plan best order.</p>
<p class="dt-status" id="dt-status" role="status" aria-live="polite"></p>
<div class="dt-gal" id="dt-gal" role="status" hidden></div>
<div class="dt-sum" id="dt-sum"></div>
<ol class="dt-list" id="dt-list"></ol>
<p class="dt-empty" id="dt-empty">No stops yet. Press Build tour, or add systems from Near me results.</p>
</div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", onClick);
    dlg.addEventListener("change", (e) => {
      const id = e.target.id;
      if (id === "dt-startstop") { const a = e.target.value; e.target.value = ""; if (a) setStartFrom(a, "A stop in your tour"); return; }
      if (id === "dt-reward" || id === "dt-variety") setStatus("", "");   // an old status line may name rewards
      if (id === "dt-stops") T.opts.touched = true;
      if (id === "dt-total") { const t = Math.round(Number(e.target.value)) >= 1; if (!T.opts.touched) $("dt-stops").value = t ? STOPS_MAXG : STOPS_DEF; }
      if (e.target.closest && e.target.closest(".dt-set")) { readOpts(); labelStops(); paint(); }
    });
    dlg.addEventListener("input", (e) => { if (e.target.id === "dt-start") { T.start = e.target.value; save(); showStartNote(); paint(true); } });
    dlg.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); build(); } });
    dlg.addEventListener("close", () => { busy++; paintBusy(false); if (returnPage && !returnToTour && openFrom === "page") { returnPage = false; try { N().close(); } catch (_) {} } });
  }
  function fillForm() {
    $("dt-radius").value = T.opts.radius; $("dt-mods").value = T.opts.mods; $("dt-stops").value = T.opts.stops; $("dt-range").value = rangeNow();
    $("dt-total").value = T.opts.total || ""; $("dt-reward").value = T.opts.reward || ""; $("dt-variety").checked = !!T.opts.variety; labelStops();
    if (!T.start && !T.stops.length) T.start = defaultStart();
    $("dt-start").value = T.start || defaultStart();
    showStartNote();
  }
  function labelStops() {
    const cap = T.opts.total ? STOPS_MAXG : STOPS_MAX, l = $("dt-stopslab"), i = $("dt-stops");
    if (l) l.textContent = T.opts.total ? `Max stops (${STOPS_MIN} to ${cap})` : `Stops (${STOPS_MIN} to ${cap})`;
    if (i) i.max = cap;
  }
  function stopPicker() {
    const sel = $("dt-startstop"); if (!sel) return;
    const key = T.stops.map((x) => x.a).join();
    if (sel.dataset.k === key) return;
    sel.dataset.k = key;
    sel.innerHTML = '<option value="">A stop in my tour</option>' + T.stops.map((x, i) => `<option value="${x.a}">${i + 1}. ${esc(sysName(x.a) || glyphs(x.a))} ${glyphs(x.a)}</option>`).join("");
    sel.disabled = !T.stops.length;
  }
  // a start from an address: the galaxy of that address is used (a tour keeps one galaxy)
  function setStartFrom(a, what) {
    const A = api(), g = galOf(a);
    if (A && g !== tourGalNow() && (!T.stops.length || T.gal === g)) A.setGalaxy(g);
    const t = glyphs(a); $("dt-start").value = t; T.start = t; save(); showStartNote(); paint(true);
    setStatus(`${esc(what)}: start set to ${t}.`, "");
  }
  function showStartNote() {
    const n = $("dt-startnote"); if (!n) return;
    const s = startPoint();
    n.className = "dt-note" + (s.ok ? "" : s.empty ? "" : " bad");
    n.textContent = s.ok ? `Read as region ${s.x}, ${s.y}, ${s.z} in ${gname(s.gal)}.` : s.empty ? "The last Heading there check-in or your Near me position is used when you press Use my position." : s.error;
  }
  let openFrom = "near";
  function open(o) {
    make(); if (!dlg) return;
    openFrom = o && o.from ? o.from : (nearDlg && nearDlg.open ? "near" : "page");
    if (!dlg.open) dlg.showModal();
    fillForm(); paint(); gKeep = null; stopPicker(); loadStarters();
    if (o && o.startAddr) setStartFrom(o.startAddr, "Tour from here");
    if (!(o && o.startAddr)) setStatus("", "");
    try { dlg.setAttribute("tabindex", "-1"); dlg.focus({ preventScroll: true }); } catch (_) {}
  }
  const close = () => { if (dlg && dlg.open) dlg.close(); };
  function setStatus(html, cls) { const s = $("dt-status"); if (!s) return; s.className = "dt-status" + (cls ? " " + cls : ""); s.innerHTML = html; }
  function paintBusy(on) { const b = $("dt-build"); if (b) { b.disabled = !!on; b.setAttribute("aria-busy", on ? "true" : "false"); } if (dlg) dlg.dataset.busy = on ? "1" : "0"; }
  function stopHtml(s, i, ls, range, start) {
    const name = sysName(s.a), cur = i === T.cur, dn = isDone(s.a), leg = ls[i].leg, far = leg > range, mods = s.m == null ? "modules unknown" : s.m + (s.q ? "?" : "") + " predicted modules";
    const prev = i === 0 ? start.a : T.stops[i - 1].a;
    return `<li class="dt-stop${cur ? " cur" : ""}${dn ? " done" : ""}" data-dt-a="${s.a}"${cur ? ' aria-current="step"' : ""}>
<div class="dt-s1"><span class="dt-n" aria-hidden="true">${i + 1}</span><div class="dt-st"><b class="dt-name">${esc(name || "System " + s.a.slice(3, 6))}</b>${name ? ' <span class="dt-guess" title="Generated name, a best guess">generated name, a best guess</span>' : ""}${cur ? ' <span class="dt-tag">Next</span>' : ""}${dn ? ' <span class="dt-tag dt-tagd">Done</span>' : ""}
<div class="dt-sub"><span>${esc(mods)}</span>${rewardOn() ? ` · <span class="dt-rw">${esc(rlabel(s))}</span>` : ""} · <b>${leg < 1 && i === 0 ? "start here" : (i === 0 ? "from start " : "leg ") + num(leg) + " ly"}</b> · total ${num(ls[i].run)} ly · ${num(ls[i].runM || 0)} module${(ls[i].runM || 0) === 1 ? "" : "s"} so far${far ? ` · <span class="dt-far">needs a stop-over</span>` : ""}${ls[i].mf ? ` · <span class="dt-far dt-mfar">${MARK_NOTE}</span>` : ""}</div>
<code class="dt-gl">${glyphs(s.a)}</code></div></div>
<div class="dt-s2"><button type="button" class="dt-b dt-small" data-dt-act="copy" data-dt-a="${s.a}">${ic(ICON.copy)}Copy glyphs</button><button type="button" class="dt-b dt-small dt-nav" data-dt-act="nav" data-dt-a="${s.a}">${ic(ICON.nav)}Navigate</button><button type="button" class="dt-b dt-small" data-dt-act="done" data-dt-a="${s.a}" aria-pressed="${dn}">${ic(ICON.check)}${dn ? "Done, undo" : "Mark done"}</button>${far ? `<button type="button" class="dt-b dt-small" data-dt-act="hops" data-dt-a="${s.a}" data-dt-from="${prev}">${ic(ICON.hops)}Plan route in hops</button>` : ""}<span class="dt-mv"><button type="button" class="dt-b dt-small dt-ico" data-dt-act="up" data-dt-a="${s.a}" aria-label="Move stop ${i + 1} up"${i === 0 ? " disabled" : ""}>${ic(ICON.up)}</button><button type="button" class="dt-b dt-small dt-ico" data-dt-act="down" data-dt-a="${s.a}" aria-label="Move stop ${i + 1} down"${i === T.stops.length - 1 ? " disabled" : ""}>${ic(ICON.down)}</button><button type="button" class="dt-b dt-small dt-ico" data-dt-act="remove" data-dt-a="${s.a}" aria-label="Remove stop ${i + 1}">${ic(ICON.x)}</button></span></div></li>`;
  }
  function paint(soft) {
    if (!dlg) return;
    stopPicker();
    const list = $("dt-list"), sum = $("dt-sum"), empty = $("dt-empty"), gw = $("dt-gal");
    { const pb = $("dt-prevbtn"), ph = $("dt-prevhint"), few = T.stops.length < 2; if (pb) { pb.disabled = few; pb.title = few ? "Add 2 or more stops to preview the route" : "Show every stop and the route from first to last"; } if (ph) ph.hidden = !few; }
    const s = startPoint(), range = rangeNow();
    // galaxy warning: same wording as the Near me galaxy warning (v164)
    const w = galWarn(T.stops.length ? T.gal : null, tourGalNow(), gname);
    if (w && gKeep !== tourGalNow()) { gw.hidden = false; gw.innerHTML = `<span>${esc(w)}</span><span class="dt-gacts"><button type="button" class="dt-b dt-small" data-dt-act="galuse">Use ${esc(gname(T.gal))}</button><button type="button" class="dt-b dt-small" data-dt-act="galkeep">Keep ${esc(gname(tourGalNow()))}</button></span>`; }
    else { gw.hidden = true; gw.innerHTML = ""; }
    if (!T.stops.length) { list.innerHTML = ""; sum.innerHTML = ""; empty.hidden = false; return; }
    empty.hidden = true;
    if (!s.ok) { list.innerHTML = ""; sum.innerHTML = `<p class="dt-note bad">Set a start position to see leg distances.${s.error ? " " + esc(s.error) : ""}</p>`; return; }
    const stops = T.stops.map((x) => Object.assign(co(x.a), x)), ls = legs(s, stops, D);
    const total = ls[ls.length - 1].run, jumps = jumpsSum(ls, range, N().jumpsFor), far = ls.filter((l) => l.leg > range).length, doneN = T.stops.filter((x) => isDone(x.a)).length;
    { let rm = 0, prev = s; ls.forEach((l, i) => { rm += Number(stops[i].m) > 0 ? Number(stops[i].m) : 0; l.runM = rm; l.mf = markFar(prev, stops[i]); prev = stops[i]; }); }
    const modsTot = modsOf(stops), mfN = ls.filter((l) => l.mf).length, per = T.opts.mods ? Number(T.opts.mods) : 0, goalN = T.opts.total || 0;
    const varN = new Set(stops.filter((x) => x.rt && x.rt !== "unknown").map((x) => x.rt)).size;
    const modsSum = ` · <b>${num(modsTot)} predicted module${modsTot === 1 ? "" : "s"}</b>${perText(stops, per) ? ` · ${perText(stops, per)}` : ""}${rewardOn() ? ` · ${varN} variet${varN === 1 ? "y" : "ies"}` : ""}${mfN ? ` · <span class="dt-far">${mfN} leg${mfN === 1 ? "" : "s"} beyond marker reach</span>` : ""}`;
    const goalLine = goalN ? `<div class="dt-goal${modsTot >= goalN ? " ok" : ""}">Modules in this tour: <b>${num(modsTot)} of ${num(goalN)} wanted</b> <span class="dt-note">(predicted, at least)</span></div>` : "";
    const left = T.stops.some((x, i) => i > T.cur && !isDone(x.a));
    sum.innerHTML = `<div class="dt-tot"><b>${T.stops.length} stop${T.stops.length === 1 ? "" : "s"}</b> · total <b>${num(total)} ly</b> · about <b>${num(jumps)} jump${jumps === 1 ? "" : "s"}</b> at ${num(range)} ly range${far ? ` · <span class="dt-far">${far} leg${far === 1 ? "" : "s"} need${far === 1 ? "s" : ""} a stop-over</span>` : ""}${modsSum}${doneN ? ` · ${doneN} done` : ""}</div>${goalLine}<div class="dt-next"><button type="button" class="dt-b dt-gold" data-dt-act="next"${left ? "" : " disabled"}>${ic(ICON.next)}Next stop</button><span class="dt-note">Distances are region to region, so each can be off by a few hundred light years. Jumps are an estimate.</span></div>`;
    const keep = list.scrollTop; list.innerHTML = stops.map((x, i) => stopHtml(x, i, ls, range, s)).join(""); void keep;
    if (!soft) { const c = list.querySelector(".dt-stop.cur"); if (c && dlg.open) c.scrollIntoView({ block: "nearest" }); }
  }
  async function copyText(t, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(t); ok = true; } catch (_) {
      try { const ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0"; (dlg && dlg.open ? dlg : document.body).appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch (_2) { ok = false; }
    }
    lastCopy = t;
    if (btn) { const o = btn.dataset.l || btn.innerHTML; btn.dataset.l = o; btn.innerHTML = ic(ICON.check) + (ok ? "Copied" : "Could not copy"); setTimeout(() => { btn.innerHTML = o; }, 1400); }
    return ok;
  }
  let lastCopy = "";
  function tourPlain() {
    const s = startPoint(); if (!s.ok || !T.stops.length) return "";
    const stops = T.stops.map((x) => Object.assign(co(x.a), x)), ls = legs(s, stops, D);
    return tourText(gname(T.gal != null ? T.gal : s.gal), stops, ls, glyphs, num, { goal: T.opts.total || 0, per: T.opts.mods ? Number(T.opts.mods) : 0, rlabel: rewardOn() ? rlabel : null });
  }
  function onClick(e) {
    const b = e.target instanceof Element ? e.target.closest("[data-dt-act]") : null;
    if (!b || b.disabled) return;
    const act = b.dataset.dtAct, a = b.dataset.dtA;
    if (act === "close") close();
    else if (act === "build") build();
    else if (act === "order") { readOpts(); planOrder(); }
    else if (act === "clear") clearTour();
    else if (act === "preview") openPrev();
    else if (act === "mypos") { const s = defaultStart(); $("dt-start").value = s; T.start = s; save(); showStartNote(); paint(true); if (!s) setStatus("No position known yet. Type your glyphs, or set them in Near me first.", "bad"); }
    else if (act === "lastopen") { let a = ""; try { a = String(JSON.parse(localStorage.getItem("dv.modern.selected") || "null") || "").toUpperCase(); } catch (_) { a = ""; } if (ADDR.test(a)) setStartFrom(a, "Last system you opened"); else setStatus("No system opened yet in this browser.", "bad"); }
    else if (act === "starter") loadStarter(b.dataset.dtG, Number(b.dataset.dtI));
    else if (act === "copytour") { const t = tourPlain(); if (!t) setStatus("Nothing to copy yet.", ""); else copyText(t, b); }
    else if (act === "copy") copyText(glyphs(a), b);
    else if (act === "next") nextStop();
    else if (act === "done") toggleDone(a);
    else if (act === "remove") removeStop(a);
    else if (act === "up") move(a, -1);
    else if (act === "down") move(a, 1);
    else if (act === "nav") navigate(a);
    else if (act === "hops") hops(a, b.dataset.dtFrom);
    else if (act === "galuse") { const A = api(); if (A && T.gal != null) { A.setGalaxy(T.gal); gKeep = null; paint(); showStartNote(); } }
    else if (act === "galkeep") { gKeep = tourGalNow(); paint(); }
  }
  function hops(target, from) {
    if (!root.dvNearRoute || !dvNearRoute.open) { setStatus("The route planner is not available.", "bad"); return; }
    const gal = galOf(target);
    dvNearRoute.open({ start: from, target, gal, range: rangeNow() });   // the existing hop planner (site-nearroute.js), stacked over this window
  }
  function navigate(a) {
    const k = T.stops.findIndex((s) => s.a === a); if (k >= 0) { T.cur = k; save(); }
    returnToTour = true; returnPage = openFrom === "page"; close();
    if (!N().navigateTo(a)) { returnToTour = false; returnPage = false; open({ from: openFrom }); }
  }
  // Back (or Clear) in Heading there returns to the tour
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("#nr-trip-back, #nr-trip-clear") : null;
    if (!b || !returnToTour) return;
    returnToTour = false; setTimeout(() => open({ from: returnPage ? "page" : "near" }), 0);
  });

  // ---- v170: Preview route. A second window over the tour: every stop in order, a top-down SVG map (plus a small side view), tap a stop to highlight it in both.
  // Back button: opening adds #/tour-preview to the history (like Near me's #/near); Back or the X closes it and returns to the tour.
  const PH = "#/tour-preview";
  let pdlg = null, pSel = -1, pPushed = false, pData = null;
  const SVGNS = "http://www.w3.org/2000/svg";
  const niceLy = (ly) => { const e = Math.pow(10, Math.floor(Math.log10(ly))); for (const m of [1, 2, 5, 10]) if (m * e >= ly) return m * e; return 10 * e; };
  function prevData() {
    const s = startPoint(); if (!s.ok || T.stops.length < 2) return null;
    const stops = T.stops.map((x) => Object.assign(co(x.a), x)), ls = legs(s, stops, D);
    let rm = 0, prev = s;
    ls.forEach((l, i) => { rm += Number(stops[i].m) > 0 ? Number(stops[i].m) : 0; l.runM = rm; l.mf = markFar(prev, stops[i]); l.px = prev.x; l.py = prev.y; l.pz = prev.z; prev = stops[i]; });
    return { s, stops, ls, far: ls.filter((l) => l.mf).length, mods: modsOf(stops), total: ls[ls.length - 1].run };
  }
  function makePrev() {
    if (pdlg || !document.body) return;
    pdlg = document.createElement("dialog");
    pdlg.id = "dtprev-dialog"; pdlg.className = "sheet dt-dialog dt-pdialog"; pdlg.setAttribute("aria-labelledby", "dp-title");
    pdlg.innerHTML = `<div class="dt-top">${ic(ICON.prev)}<h2 id="dp-title">Route preview</h2><button type="button" class="dt-x" data-dp-act="close" aria-label="Close route preview">×</button></div>
<div class="dt-body dp-body" id="dp-body">
<p class="dt-tot" id="dp-sum"></p>
<div class="dp-mapbox" id="dp-mapbox"></div>
<p class="dt-note" id="dp-legend"></p>
<ol class="dt-list dp-list" id="dp-list"></ol>
</div>`;
    document.body.appendChild(pdlg);
    pdlg.addEventListener("click", (e) => {
      const el = e.target instanceof Element ? e.target : null; if (!el) return;
      if (el.closest("[data-dp-act=close]")) { closePrev(); return; }
      const hit = el.closest("[data-dp-i]"); if (hit) selStop(Number(hit.dataset.dpI), hit.tagName.toLowerCase() !== "li");
    });
    pdlg.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target instanceof Element && e.target.matches("[data-dp-i]")) { e.preventDefault(); selStop(Number(e.target.dataset.dpI), !e.target.matches("li")); } });
    pdlg.addEventListener("close", () => {
      const pushed = pPushed; pPushed = false;
      if (pushed && location.hash === PH) history.back(); else if (location.hash === PH) { try { history.replaceState(null, "", "#/"); } catch (_) {} }
      const b = $("dt-prevbtn"); if (b && dlg && dlg.open) { try { b.focus({ preventScroll: true }); } catch (_) {} }
    });
    window.addEventListener("resize", () => { if (pdlg.open) drawMap(); });
  }
  const legendText = () => `Top view, north up. Dots are stops in order, A is the first and Z the last. Solid lines are inside marker reach${pData && pData.far ? ", dashed lines are legs off marker reach" : ""}. Tap a dot or a row to highlight it.`;
  function selStop(i, scroll) {
    pSel = (i === pSel) ? -1 : i;
    if (!pdlg) return;
    pdlg.querySelectorAll("[data-dp-i]").forEach((e) => {
      const on = Number(e.dataset.dpI) === pSel; e.classList.toggle("sel", on);
      if (e.tagName.toLowerCase() === "li") { if (on) e.setAttribute("aria-current", "true"); else e.removeAttribute("aria-current"); }
      else if (e.getAttribute("role") === "button") e.setAttribute("aria-pressed", String(on));
    });
    if (pSel >= 0 && scroll) { const li = pdlg.querySelector(`li[data-dp-i="${pSel}"]`); if (li) li.scrollIntoView({ block: "nearest" }); }
    const lg = $("dp-legend"); if (lg && pData) lg.textContent = pSel >= 0 ? `Stop ${pSel + 1} selected.` : legendText();
  }
  function mk(tag, attrs, txt) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt != null) e.textContent = txt; return e; }
  function drawMap() {
    const box = $("dp-mapbox"); if (!box || !pData) return;
    const { s, stops, ls } = pData, n = stops.length;
    const W = Math.max(240, Math.min(820, Math.floor(box.clientWidth || 340))), r = n > 30 ? 6 : n > 18 ? 8 : n > 10 ? 10 : 12;
    // systems in the same region share one point (distances are region to region): spread them on a small ring so every stop has its own dot
    const grp = new Map(); stops.forEach((p, i) => { const key = p.x + "," + p.y + "," + p.z; if (!grp.has(key)) grp.set(key, []); grp.get(key).push(i); });
    const off = stops.map(() => [0, 0]), offX = stops.map(() => 0); let ringMax = 0;
    grp.forEach((ix) => { const g = ix.length; if (g < 2) return; const rr = r * (0.9 + g * 0.45); ringMax = Math.max(ringMax, rr); ix.forEach((i, j) => { const ang = -Math.PI / 2 + 2 * Math.PI * j / g; off[i] = [rr * Math.cos(ang), rr * Math.sin(ang)]; offX[i] = (j - (g - 1) / 2) * 9; }); });
    const pad = r + 14 + ringMax;
    const pts = [{ x: s.x, y: s.y, z: s.z }].concat(stops);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    const sx = Math.max(x1 - x0, 2), sz = Math.max(z1 - z0, 2);
    const H = Math.round(Math.max(190, Math.min(W * 0.95, W * (sz / sx) + 2 * pad + 18)));
    const k = Math.min((W - 2 * pad) / sx, (H - 2 * pad - 18) / sz);
    const cx = (W - sx * k) / 2, cz = (H - 18 - sz * k) / 2;
    const X = (p) => cx + (p.x - x0) * k, Z = (p) => cz + (z1 - p.z) * k;   // north (higher z) is up
    const PX = (i) => X(stops[i]) + off[i][0], PZ = (i) => Z(stops[i]) + off[i][1];
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "dp-svg dp-top", role: "img", "aria-label": `Top view of the route: ${n} stops` });
    svg.appendChild(mk("rect", { x: 0.5, y: 0.5, width: W - 1, height: H - 1, class: "dp-frame" }));
    const g = mk("g", { class: "dp-legs" });
    ls.forEach((l, i) => {
      if (i === 0 && s.a === stops[0].a) return;
      const ax = i === 0 ? X(s) : PX(i - 1), az = i === 0 ? Z(s) : PZ(i - 1);
      const at = { x1: ax.toFixed(1), y1: az.toFixed(1), x2: PX(i).toFixed(1), y2: PZ(i).toFixed(1), class: "dp-leg" + (l.mf ? " dp-far" : ""), "data-leg": i };
      if (l.mf) at["stroke-dasharray"] = "6 5";
      g.appendChild(mk("line", at));
    });
    svg.appendChild(g);
    if (Math.hypot(s.x - stops[0].x, s.y - stops[0].y, s.z - stops[0].z) > 1e-9) {
      svg.appendChild(mk("circle", { cx: X(s).toFixed(1), cy: Z(s).toFixed(1), r: r - 2, class: "dp-start" }));
      svg.appendChild(mk("text", { x: X(s).toFixed(1), y: (Z(s) + r + 11).toFixed(1), class: "dp-lab", "text-anchor": "middle" }, "start"));
    }
    const labels = mk("g", {}), dots = mk("g", {});
    stops.forEach((p, i) => {
      const gx = PX(i).toFixed(1), gy = PZ(i).toFixed(1), end = i === 0 ? "a" : i === n - 1 ? "z" : "";
      const d = mk("g", { class: "dp-dot" + (end ? " dp-" + end : ""), "data-dp-i": i, tabindex: 0, role: "button", "aria-pressed": "false", "aria-label": `Stop ${i + 1}${i === 0 ? ", first (A)" : i === n - 1 ? ", last (Z)" : ""}` });
      d.appendChild(mk("circle", { cx: gx, cy: gy, r: Math.max(r + 5, 12), class: "dp-hit" }));
      d.appendChild(mk("circle", { cx: gx, cy: gy, r, class: "dp-c" }));
      if (r >= 8) d.appendChild(mk("text", { x: gx, y: (Number(gy) + 4).toFixed(1), class: "dp-num", "text-anchor": "middle", "font-size": r >= 10 ? 12 : 10 }, String(i + 1)));
      dots.appendChild(d);
      if (end) labels.appendChild(mk("text", { x: gx, y: (Number(gy) - r - 4).toFixed(1), class: "dp-end", "text-anchor": "middle" }, end.toUpperCase()));
    });
    svg.appendChild(dots); svg.appendChild(labels);
    const barLy = niceLy(Math.max(sx, sz) * LY / 4), barPx = barLy / LY * k;
    svg.appendChild(mk("line", { x1: pad, y1: H - 9, x2: (pad + barPx).toFixed(1), y2: H - 9, class: "dp-bar" }));
    svg.appendChild(mk("text", { x: pad, y: H - 12, class: "dp-lab" }, `${num(barLy)} ly`));
    box.replaceChildren(svg);
    // side view: east-west across, height up; at least 3 regions tall so a flat route looks flat
    const sy = Math.max(y1 - y0, 3), SH = 64, ky = Math.min(k, (SH - 16) / sy), Y = (p) => 8 + (SH - 16 - sy * ky) / 2 + (y1 - p.y) * ky;
    const sv = mk("svg", { viewBox: `0 0 ${W} ${SH}`, width: W, height: SH, class: "dp-svg dp-side", role: "img", "aria-label": "Side view of the route, height against east-west" });
    sv.appendChild(mk("rect", { x: 0.5, y: 0.5, width: W - 1, height: SH - 1, class: "dp-frame" }));
    const pl = [`${X(s).toFixed(1)},${Y(s).toFixed(1)}`].concat(stops.map((p, i) => `${(X(p) + offX[i]).toFixed(1)},${Y(p).toFixed(1)}`));
    sv.appendChild(mk("polyline", { points: pl.join(" "), class: "dp-leg dp-sideline", fill: "none" }));
    stops.forEach((p, i) => { const d = mk("g", { class: "dp-sdot", "data-dp-i": i }); d.appendChild(mk("circle", { cx: (X(p) + offX[i]).toFixed(1), cy: Y(p).toFixed(1), r: 4.5, class: "dp-c" })); sv.appendChild(d); });
    sv.appendChild(mk("text", { x: W - 6, y: 12, class: "dp-lab", "text-anchor": "end" }, "side view (height)"));
    box.appendChild(sv);
    if (pSel >= 0) { const keep = pSel; pSel = -1; selStop(keep, false); }
  }
  function paintPrev() {
    pData = prevData(); const sum = $("dp-sum"), list = $("dp-list");
    if (!pData) { sum.textContent = "Add 2 or more stops, and set a start, to preview the route."; list.innerHTML = ""; $("dp-mapbox").replaceChildren(); $("dp-legend").textContent = ""; return; }
    const { stops, ls, far, mods, total } = pData, n = stops.length;
    sum.innerHTML = `<b>${n} stops</b> · total <b>${num(total)} ly</b> · <b>${num(mods)} predicted module${mods === 1 ? "" : "s"}</b>${far ? ` · <span class="dt-far">${far} leg${far === 1 ? "" : "s"} off marker reach</span>` : ""}`;
    list.innerHTML = stops.map((x, i) => {
      const name = sysName(x.a), leg = ls[i].leg, mods1 = x.m == null ? "modules unknown" : x.m + (x.q ? "?" : "") + " predicted modules";
      return `<li class="dt-stop dp-item" data-dp-i="${i}" tabindex="0"><div class="dt-s1"><span class="dt-n" aria-hidden="true">${i === 0 ? "A" : i === n - 1 ? "Z" : ""}${i + 1}</span><div class="dt-st"><b class="dt-name">${esc(name || "System " + x.a.slice(3, 6))}</b>${name ? ' <span class="dt-guess">generated name, a best guess</span>' : ""}
<div class="dt-sub"><span>${esc(mods1)}</span>${rewardOn() ? ` · <span class="dt-rw">${esc(rlabel(x))}</span>` : ""} · <b>${leg < 1 && i === 0 ? "start here" : (i === 0 ? "from start " : "leg ") + num(leg) + " ly"}</b> · total ${num(ls[i].run)} ly${ls[i].mf ? ` · <span class="dt-far dp-flag">off marker reach</span>` : ""}</div></div></div></li>`;
    }).join("");
    $("dp-legend").textContent = legendText();
  }
  function openPrev() {
    if (T.stops.length < 2) return;
    makePrev(); if (!pdlg) return;
    pSel = -1; paintPrev();
    if (!pdlg.open) pdlg.showModal();
    drawMap();
    if (location.hash !== PH) { try { location.hash = PH; pPushed = true; } catch (_) { pPushed = false; } } else pPushed = false;
    try { pdlg.setAttribute("tabindex", "-1"); pdlg.focus({ preventScroll: true }); } catch (_) {}
  }
  function closePrev() { if (pdlg && pdlg.open) pdlg.close(); }
  window.addEventListener("hashchange", () => {
    if (pdlg && pdlg.open && location.hash !== PH) { pPushed = false; pdlg.close(); return; }
    if (dlg && dlg.open && openFrom === "near" && location.hash !== "#/near" && location.hash !== PH) close();
  });

  // ---- Near me hooks
  function attach(near) {
    nearDlg = near;
    const top = near.querySelector(".nr-top"), h = top && top.querySelector("#nr-trip-show");
    if (top && !$("nr-tour-show")) {
      const b = document.createElement("button"); b.type = "button"; b.className = "nr-mini nr-heading-btn dt-tourbtn"; b.id = "nr-tour-show";
      b.title = "Derelict tour: plan a short chain of derelict systems"; b.innerHTML = ic(ICON.tour) + "Tour";
      top.insertBefore(b, h || top.querySelector("[data-nr-close]"));
      b.addEventListener("click", open);
    }
    near.addEventListener("close", () => { returnToTour = false; returnPage = false; close(); });
  }
  // the Add to tour toggle on a Near me result row (a button, so Near me's row click handler leaves it alone)
  const tickHtml = (on) => ic(ICON.plus) + (on ? "In tour" : "Add to tour");
  const rowBtn = (address) => { const on = T.stops.some((s) => s.a === address); return `<button type="button" class="nr-btn dt-tick" data-dt-tick="${address}" aria-pressed="${on}" title="Add this system to your Derelict tour">${tickHtml(on)}</button>`; };
  function toast(msg, host) {
    const t = document.createElement("div"); t.className = "dt-toast"; t.setAttribute("role", "status"); t.textContent = msg;
    (host && host.isConnected ? host : document.body).appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  document.addEventListener("click", (e) => {
    const c = e.target instanceof Element ? e.target.closest("[data-dt-tick]") : null;
    if (!c) return;
    e.stopPropagation();
    const a = c.dataset.dtTick, host = c.closest("dialog") || document.body;
    if (T.stops.some((s) => s.a === a)) removeStop(a);
    else { const r = addStop(a); if (!r.ok) toast(r.text, host); }
  }, true);
  // the system page: an "Add to tour" button next to Navigate
  const routeAddr = () => { const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash); return m ? m[1].toUpperCase() : null; };
  function pageBtn() {
    const nav = document.getElementById("viewer-navigate"), a = routeAddr();
    let b = document.getElementById("viewer-addtour");
    let f = document.getElementById("viewer-tourfrom");
    if (!nav || !a) { if (b && !a) b.remove(); if (f && !a) f.remove(); return; }
    const on = T.stops.some((s) => s.a === a), html = ic(ICON.tour) + (on ? "In your tour" : "Add to tour");
    if (!b) { b = document.createElement("button"); b.type = "button"; b.id = "viewer-addtour"; b.className = nav.className; nav.insertAdjacentElement("afterend", b); }
    if (!f) { f = document.createElement("button"); f.type = "button"; f.id = "viewer-tourfrom"; f.className = nav.className; f.title = "Open the Derelict tour with this system as the start"; f.innerHTML = ic(ICON.tour) + "Tour from here"; b.insertAdjacentElement("afterend", f); }
    if (b.dataset.a !== a || b.dataset.on !== String(on)) { b.dataset.a = a; b.dataset.on = String(on); b.setAttribute("aria-pressed", String(on)); b.title = on ? "Remove this system from your Derelict tour" : "Add this system to your Derelict tour (Near me, Tour)"; b.innerHTML = html; }
  }
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("#viewer-addtour") : null;
    if (!b) return;
    const a = routeAddr(); if (!a) return;
    if (T.stops.some((s) => s.a === a)) removeStop(a);
    else { const r = addStop(a); if (!r.ok) toast(r.text, document.body); else toast("Added to your tour. Open Near me, then Tour.", document.body); }
    pageBtn();
  });
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("#viewer-tourfrom") : null;
    if (!b) return;
    const a = routeAddr(); if (a) open({ from: "page", startAddr: a });
  });
  // the main page: a full-width Tour button above the Near me / search row (works without Near me being open)
  function mainBtn() {
    const sec = document.getElementById("systems"); if (!sec || document.getElementById("systems-tour")) return;
    const sc = sec.querySelector(".search-control"); if (!sc) return;
    const b = document.createElement("button"); b.type = "button"; b.id = "systems-tour"; b.className = "dt-maintour";
    b.title = "Derelict tour: plan a short chain of derelict systems"; b.innerHTML = ic(ICON.tour) + "Tour";
    sc.insertAdjacentElement("beforebegin", b);
    b.addEventListener("click", () => open({ from: "page" }));
  }
  // keep every tick box and the page button in step with the tour
  function sync() {
    document.querySelectorAll("[data-dt-tick]").forEach((c) => { const on = T.stops.some((s) => s.a === c.dataset.dtTick); c.setAttribute("aria-pressed", String(on)); c.innerHTML = tickHtml(on); });
    pageBtn(); if (dlg && dlg.open) paint(true);
  }
  function watch() {
    mainBtn();
    const vc = document.getElementById("viewer-content");
    if (vc) new MutationObserver(pageBtn).observe(vc, { childList: true, subtree: true });
    window.addEventListener("hashchange", () => setTimeout(pageBtn, 50));
    pageBtn();
    if (root.dvNamesReady && dvNamesReady.then) dvNamesReady.then(() => { if (dlg && dlg.open) { paint(true); paintStarters(); } }).catch(() => {});
    window.addEventListener("storage", (e) => { if (e.key === KEY) { try { const j = JSON.parse(e.newValue || "null"); if (j && j.v === 1) { T = Object.assign({}, DEF, j); sync(); } } catch (_) {} } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  root.dvTour = { attach, rowBtn, open, close, active: () => !!(dlg && dlg.open), addStop, removeStop, pure,
    _test: { openPrev, closePrev, perText, state: () => T, setState: (x) => { T = Object.assign({}, DEF, x); save(); sync(); }, lastMs: () => lastMs, lastInfo: () => lastInfo, lastCopy: () => lastCopy, build, planOrder, tourPlain, returning: () => returnToTour, storeOk: () => storeOk } };
})(typeof globalThis !== "undefined" ? globalThis : this);
