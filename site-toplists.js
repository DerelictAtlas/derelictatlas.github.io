/* site-toplists.js (SITE integration, user 2026-10-31): "does this scanned system break into a top-100 list?"
 * The same rule as the scanner (pruning.py enters_top_lists) and the GitHub Action, from stats/systems.json map_lists:
 * per list, the system must qualify (value known; > 0 for a "highest" list) and either the list has room (cut_key
 * null) or its list key is STRICTLY smaller than cut_key (tuple order; a tie keeps the incumbent). List key = for the
 * list value and every "then" key: (1, 0) when unknown, else (0, -v) for "highest" / (0, v) for "lowest".
 * dvTopLists.load() -> lists (cached); dvTopLists.breaks(row, extras, lists) -> [{name, label}] (empty = none).
 * dvTopLists.rank(row, extras, lists, top, atlas) -> top with "rank" (1-100) added where it can be worked out from the
 * atlas rows the page has loaded (atlas = dvHome.rows(): {rows, loot}; core.js row names; device rows left out): rank
 * = 1 + the published systems whose list key is <= the system's (on a tie the incumbent keeps its place). */
(function () {
  "use strict";
  const REWARD_RANK = { C: 1, B: 2, A: 3, S: 4 };
  let cache = null;
  function load() {
    if (!cache) cache = fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))
      .then((s) => (s && Array.isArray(s.map_lists) ? s.map_lists : null)).catch(() => { cache = null; return null; });
    return cache;
  }
  const plain = (r, k) => r[k];
  // the atlas rows (core.js parseCsvRow) name three index columns differently
  const ALIAS = { crates: "salvage_crates", stairs: "stair_pieces", hangars: "hangar_pieces" };
  const atlasGet = (r, k) => r[ALIAS[k] || k];
  function value(key, r, get) {
    get = get || plain;
    const num = (k) => { const x = get(r, k); return x == null || x === "" || !Number.isFinite(Number(x)) ? null : Math.trunc(Number(x)); };
    if (key === "total") { const c = num("crates"), f = num("footlockers"); return c === null || f === null ? null : c + f; }
    if (key === "hangar") { const h = num("hangars"); return h === null ? null : h > 0 ? 1 : 0; }
    if (key === "reward") return REWARD_RANK[String(get(r, "reward_class") || "").toUpperCase()] || null;
    return num(key);
  }
  function key(l, r, get) {
    const out = [];
    for (const [k, d] of [[l.value, l.direction], ...(l.then || [])]) {
      const v = value(k, r, get);
      out.push(...(v === null ? [1, 0] : [0, d === "highest" ? -v : v]));
    }
    return out;
  }
  const less = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i]; return a.length < b.length; };
  function breaks(row, extras, lists) {
    if (!row || !Array.isArray(lists)) return [];
    const r = Object.assign({}, row, extras || {});
    const out = [];
    for (const l of lists) {
      if (!l || !l.value || !("cut_key" in l)) continue;
      const v = value(l.value, r);
      if (v === null || (l.direction === "highest" && !(v > 0))) continue;
      if (l.cut_key == null || less(key(l, r), l.cut_key)) out.push({ name: l.name, label: String(l.label || l.name).replace(/\s*\(systems with loot values\)/, "") });
    }
    return out;
  }
  function rank(row, extras, lists, top, atlas) {
    if (!row || !Array.isArray(top) || !Array.isArray(lists) || !atlas || !Array.isArray(atlas.rows) || !atlas.rows.length) return top || [];
    const r = Object.assign({}, row, extras || {});
    return top.map((t) => {
      const l = lists.find((x) => x && x.name === t.name);
      if (!l || (/^items_/.test(l.value) && !atlas.loot)) return t;   // loot lists: only once the atlas loot values are in
      const mine = key(l, r), v0 = value(l.value, r), hi = l.direction === "highest";
      let ahead = 0;
      for (const a of atlas.rows) {
        if (!a || a.device) continue;
        const v = value(l.value, a, atlasGet);
        if (v === null || (hi && !(v > 0)) || (hi ? v < v0 : v > v0)) continue;
        if (v !== v0 || !less(mine, key(l, a, atlasGet))) ahead++;
      }
      return Object.assign({}, t, { rank: Math.min(100, ahead + 1) });
    });
  }
  globalThis.dvTopLists = { load, breaks, rank, key, less };
})();
