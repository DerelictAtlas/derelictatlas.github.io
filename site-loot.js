/* site-loot.js (SITE integration, user 2026-10-31): loot on request.
 * Top-100 systems (atlas extras) show their loot by default. Every other system gets a compact "Scan loot" button where
 * the loot summary sits, and the loot details window ends with "All loot · estimated value": every item with its amount
 * and value in two aligned columns (name left, units right). Nothing is computed on its own: "Scan loot" runs the
 * scanner on this device for that one system (or reuses a scan this device already made of it), fills the totals
 * (value, nanites, SpookBox) and the list, and keeps the result in this browser (dv.loot.v1). The list comes from the
 * scanner extra `items_all` (RE W29g: "Name xN=value[~]|...", value descending, "~" = the amount can differ). A loot
 * scan also keeps the scanner's per-container loot (result.loot {cv, xv}) for the Quick Run loot targets. A loot scan
 * saved before W29g (top items only) shows those with a "Scan loot" button that gets the full list. */
(function () {
  "use strict";
  const KEY = "dv.loot.v1", SCAN_KEY = "dv.scan.v1", MAX = 60, BASE = "scan/";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const jsonGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const jsonSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const isAddress = (a) => /^[0-9A-F]{16}$/i.test(String(a || ""));
  const runs = new Map();   // address -> {step, loaded, total, startedAt, stepAt, error}
  let ticker = null;

  // the extras of a loot scan made on this device ({items_value, items_nanites, spookbox, items_top, items_all, ...})
  function saved(address) { const s = jsonGet(KEY, {})[address]; return s && s.extras ? s.extras : s || null; }
  // loot = per-container {cv, xv} (RE W29g result.loot; null before W29g): Quick Run loot targets (site-quickloot.js)
  function keep(address, extras, loot) {
    const all = jsonGet(KEY, {});
    all[address] = { extras, loot: loot || null, at: Date.now() };
    const keys = Object.keys(all).sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
    while (keys.length > MAX) delete all[keys.shift()];
    jsonSet(KEY, all);
  }
  globalThis.dvLootSaved = (address) => saved(address);
  // "Hadal Core x2=195000|Tainted Metal x250=95000~" -> [{name, n, value, varies}]; RE W29g: split at the LAST " x"
  // (greedy name); "~" after the value = the amount can differ (anything else there is read the same way)
  function parse(txt) {
    return String(txt || "").split("|").map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^(.*) x(\d+)([^=]*)=(\d+)(.*)$/.exec(x);
      return m ? { name: m[1], n: Number(m[2]), value: Number(m[4]), varies: Boolean((m[3] + m[5]).trim()) } : { name: x, n: null, value: null, varies: false };
    });
  }
  function table(items, total) {
    const row = (it) => `<div class="site-loot-row" role="row"><span role="cell" class="site-loot-name">${esc(it.name)}${it.n != null ? ` <small>×${fmt(it.n)}</small>` : ""}</span>`
      + `<span role="cell" class="site-loot-value"${it.varies ? ` title="Amount can differ"` : ""}>${it.value == null ? "—" : (it.varies ? "≈ " : "") + fmt(it.value)}</span></div>`;
    const sum = total !== "" && total != null && !Number.isNaN(Number(total))
      ? `<div class="site-loot-row site-loot-total" role="row"><span role="cell" class="site-loot-name">Total item value</span><span role="cell" class="site-loot-value">${fmt(total)}</span></div>` : "";
    return `<div class="site-loot-table" role="table" aria-label="Loot items and estimated value in units"><div class="site-loot-row site-loot-head" role="row"><span role="columnheader" class="site-loot-name">Item</span><span role="columnheader" class="site-loot-value">Units</span></div>${items.map(row).join("")}${sum}</div>`;
  }
  function percent(r) {
    const now = Date.now();
    if (r.step === "download") return r.total ? 30 * Math.min(1, r.loaded / r.total) : Math.min(25, (now - r.startedAt) / 200);
    if (r.step === "start") return 30 + 5 * Math.min(1, (now - r.stepAt) / 400);
    return 35 + 60 * (1 - Math.exp(-(now - r.stepAt) / 1800));
  }
  const progressHtml = (r, label) => { const pct = Math.floor(percent(r)); return `<div class="site-scan-progress" role="status"><span class="site-scan-spin" aria-hidden="true"></span>${label}<b class="site-scan-pct">${pct} %</b></div><div class="site-scan-meter" aria-hidden="true"><span style="width:${pct}%"></span></div>`; };
  // the loot details window: last section
  function inner(address, extras) {
    const e = extras || {}, s = saved(address), r = runs.get(address);
    const all = e.items_all || (s && s.items_all), total = e.items_all ? e.items_value : s ? s.items_value : "";
    if (all) return `<h3>All loot · estimated value</h3>${table(parse(all), total)}`;
    if (r && !r.error) return `<h3>All loot · estimated value</h3>${progressHtml(r, "Scanning loot on your device")}`;
    const top = s ? parse(s.items_top) : [];
    if (s) return `<h3>Top items · estimated value</h3>${top.length ? table(top, "") : "<p>No items found.</p>"}`
      + `<button type="button" class="primary site-loot-scan">Scan loot</button><p class="site-scan-note">Saved by an older scanner: scan again for every item with its value.</p>`;
    return `<h3>All loot · estimated value</h3>${r && r.error ? `<p class="site-loot-error">The loot scan did not finish (${esc(r.error)}).</p>` : ""}`
      + `<button type="button" class="primary site-loot-scan">Scan loot</button><p class="site-scan-note">Lists every item with its value. Runs the scanner on this device for this system; it takes a few seconds.</p>`;
  }
  // the compact button where the loot summary sits (systems without loot numbers)
  function inline(address) {
    const r = runs.get(address);
    if (r && !r.error) return progressHtml(r, "Scanning loot on your device");
    return `<button type="button" class="spook-chip site-loot-scan">◇ <span>Scan loot</span></button>`
      + `<span class="site-loot-hint">${r && r.error ? `<span class="site-loot-error">Loot scan failed (${esc(r.error)}).</span> ` : ""}Loot value, nanites and items, worked out on this device in a few seconds.</span>`;
  }
  const boxes = () => document.querySelectorAll(".site-loot-all[data-loot-address], .site-loot-inline[data-loot-address]");
  function paint() {
    boxes().forEach((box) => {
      const a = box.dataset.lootAddress, html = box.classList.contains("site-loot-inline") ? inline(a) : inner(a, box._extras);
      if (box.innerHTML !== html) box.innerHTML = html;
    });
    if (![...runs.values()].some((r) => !r.error)) { clearInterval(ticker); ticker = null; }
  }
  // loot is in: the viewer gets the totals, the list card its badge
  function reveal(address, extras, loot) {
    keep(address, extras, loot);
    try { if (globalThis.dvFillExtras) globalThis.dvFillExtras(address, extras); } catch (_) {}
    try { if (globalThis.dvDeviceChanged) globalThis.dvDeviceChanged(); } catch (_) {}
    paint();
  }
  function scan(address) {
    if (runs.has(address) && !runs.get(address).error) return;
    // scanned on this device already (a system not in the atlas): its loot came with that scan
    const c = jsonGet(SCAN_KEY, {})[address];
    if (c && c.status === 0 && c.extras && c.extras.items_all !== undefined && c.extras.items_value !== undefined && c.extras.items_value !== "") { runs.delete(address); reveal(address, c.extras, c.loot || null); return; }
    const now = Date.now(), r = { step: "download", loaded: 0, total: 0, startedAt: now, stepAt: now };
    runs.set(address, r);
    if (!ticker) ticker = setInterval(paint, 200);
    paint();
    let w = null;
    const end = (error, extras, loot) => { if (w) w.terminate(); w = null; if (error) { r.error = error; paint(); } else { runs.delete(address); reveal(address, extras, loot); } };
    fetch(BASE + "w29.json", { cache: "no-cache" }).then((x) => { if (!x.ok) throw new Error("scanner not found (" + x.status + ")"); return x.json(); }).then((m) => {
      r.total = Number(m.wasm_bytes) || 0;
      w = new Worker(BASE + "scan-worker.js?v=" + encodeURIComponent(String(m.js_sha256 || "").slice(0, 8) + String(m.wasm_sha256 || "").slice(0, 8)));
      w.onmessage = (ev) => {
        const d = ev.data || {};
        if (d.type === "progress") { if (d.step !== r.step) { r.step = d.step; r.stepAt = Date.now(); } if (d.step === "download") { r.loaded = d.loaded || 0; if (d.total) r.total = d.total; } return; }
        if (!d.ok) return end(d.error || "unknown error");
        if (d.status !== 0 || !d.extras) return end("scanner status " + d.status);
        end(null, d.extras, d.loot);
      };
      w.onerror = (ev) => { ev.preventDefault(); end("loading the scanner: " + (ev.message || "failed")); };
      w.postMessage({ address, wasmBytes: r.total, options: { derelict: true, loot: true } });   // W29g: result.loot needs the layout
    }).catch((e) => end(e.message));
  }
  // modern.js: the compact button in the loot summary row (no loot numbers yet, a known layout)
  globalThis.dvLootButton = (row) => (row && isAddress(row.address) && row.rooms != null && row.items_value == null && !saved(row.address)
    ? `<div class="loot-summary site-loot-inline" data-loot-address="${esc(row.address)}">${inline(row.address)}</div>` : "");
  // modern.js appends this to the loot details window (list badge and viewer); the box keeps the extras it was opened with
  const opened = new Map();
  globalThis.dvLootList = (address, extras) => {
    if (!isAddress(address)) return "";
    opened.set(address, extras || null);
    setTimeout(() => boxes().forEach((box) => { if (opened.has(box.dataset.lootAddress)) box._extras = opened.get(box.dataset.lootAddress); }), 0);
    return `<section class="site-loot-all" data-loot-address="${esc(address)}" aria-live="polite">${inner(address, extras)}</section>`;
  };
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest(".site-loot-scan") : null;
    if (b) { e.stopPropagation(); scan(b.closest("[data-loot-address]").dataset.lootAddress); }
  }, true);
})();
