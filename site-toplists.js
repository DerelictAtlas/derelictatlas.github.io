/* site-toplists.js (SITE integration, user 2026-10-31): "does this scanned system break into a top-100 list?"
 * The same rule as the scanner (pruning.py enters_top_lists) and the GitHub Action, from stats/systems.json map_lists:
 * per list, the system must qualify (value known; > 0 for a "highest" list) and either the list has room (cut_key
 * null) or its list key is STRICTLY smaller than cut_key (tuple order; a tie keeps the incumbent). List key = for the
 * list value and every "then" key: (1, 0) when unknown, else (0, -v) for "highest" / (0, v) for "lowest".
 * dvTopLists.load() -> lists (cached); dvTopLists.breaks(row, extras, lists) -> [{name, label}] (empty = none). */
(function () {
  "use strict";
  const REWARD_RANK = { C: 1, B: 2, A: 3, S: 4 };
  let cache = null;
  function load() {
    if (!cache) cache = fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))
      .then((s) => (s && Array.isArray(s.map_lists) ? s.map_lists : null)).catch(() => { cache = null; return null; });
    return cache;
  }
  function value(key, r) {
    const num = (k) => (r[k] == null || r[k] === "" || !Number.isFinite(Number(r[k])) ? null : Math.trunc(Number(r[k])));
    if (key === "total") { const c = num("crates"), f = num("footlockers"); return c === null || f === null ? null : c + f; }
    if (key === "hangar") { const h = num("hangars"); return h === null ? null : h > 0 ? 1 : 0; }
    if (key === "reward") return REWARD_RANK[String(r.reward_class || "").toUpperCase()] || null;
    return num(key);
  }
  function key(l, r) {
    const out = [];
    for (const [k, d] of [[l.value, l.direction], ...(l.then || [])]) {
      const v = value(k, r);
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
  globalThis.dvTopLists = { load, breaks };
})();
