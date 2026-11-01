/* site-quickloot.js (SITE integration, user 2026-10-31): per-container loot for the Quick Run loot targets.
 * Source 1: views/top100-loot.json(.gz) (scanner W30, Fable): {"format":1,"views":{"<ADDRESS16>":{"cv":[[units...],
 *   [nanites...]],"xv":[[...],[...]]}}}; cv lines up index for index with the view's `c` containers (model.containers),
 *   xv with `x` (model.extras); nanites = direct + refiner, already summed. Loaded once per page, lazily (the first time a
 *   mapped system is shown). No file = Quick Run keeps its loot targets disabled.
 * Source 2 (RE W29g): a browser scan's result.loot = {cv, xv} in the same shape. site-loot.js keeps
 *   it with the "Scan loot" result (dv.loot.v1[address].loot); get() reads it, so device-scanned systems work as soon
 *   as the scanner hands it out (note: W29g gives result.loot only with options.derelict on).
 * dvQuickLoot.get(address) -> {cv, xv} | null;  .load() -> Promise (resolves when the file is read or known missing). */
(function () {
  "use strict";
  let views = null, loading = null;
  const FILES = ["views/top100-loot.json.gz", "views/top100-loot.json"];
  async function readText(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + ": " + r.status);
    const b = new Uint8Array(await r.arrayBuffer());
    if (b[0] === 31 && b[1] === 139) return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return new TextDecoder().decode(b);
  }
  function load() {
    if (!loading) loading = (async () => {
      for (const f of FILES) {
        try {
          const j = JSON.parse(await readText(f));
          if (j && j.views && typeof j.views === "object") { views = j.views; return true; }
        } catch (_) { /* not published (yet) or not this form: try the next */ }
      }
      views = {};
      return false;
    })();
    return loading;
  }
  function fromDevice(address) {
    try { const s = (JSON.parse(localStorage.getItem("dv.loot.v1")) || {})[address]; return s && s.loot && Array.isArray(s.loot.cv) ? s.loot : null; } catch (_) { return null; }
  }
  globalThis.dvQuickLoot = {
    load,
    loaded: () => views !== null,
    get(address) { return (views && views[address]) || fromDevice(address) || null; },
  };
})();
