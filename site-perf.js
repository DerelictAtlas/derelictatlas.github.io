/* site-perf.js (SITE integration, user 2026-11-03: "i want there to be a global scanner speed, so if many are scanning
 * then we can get an average, fastest and slowest scanning speed, with the averages per systems and types, this will
 * be in stats"). Shared by the main page and Contribute:
 *   dvPerf.on()                      sending speed numbers is switched on (DV_CONFIG.relayPerf === true: relay v1.2
 *                                    refuses any unknown v3 key with 400, so it stays off until the relay takes "perf")
 *   dvPerf.summary(samples, opts)    -> the v3 "perf" object for one upload, or null. samples = [{ms, p}] = the scanner's
 *                                    own time for the scan step of each system (W29 generation + loot; not the
 *                                    download, the upload or the drawing) and its derelict type (preset).
 *                                    opts = {workers, speed, src}. Anonymous: whole ms, a coarse device type
 *                                    (phone / tablet / pc), never the browser string, model or core count.
 *   dvPerf.add(bodyJson, perf)       the v3 relay body with "perf" added (unchanged when off or null)
 *   dvPerf.median(list)              the median of a list of numbers
 *   dvPerf.speedCard(box)            the "Scanner speed" card of the Stats tab, from stats/speed.json (written by the
 *                                    singles Action from the perf numbers); "No speed data yet" without the file */
(function () {
  "use strict";
  const cfg = () => globalThis.DV_CONFIG || {};
  const on = () => cfg().relayPerf === true;
  const PRESETS = ["CARGO_BUGS", "MEDI_BUGS", "CARGO_TURRETS", "MEDI_TURRETS", "CARGO_FLOATERS", "MEDI_FLOATERS", "CARGO_SLIME", "MEDI_SLIME", "CARGO_MAZE", "MEDI_MAZE"];
  const SPEEDS = ["gentle", "balanced", "max"];
  const MIN_MS = 20, MAX_MS = 120000, MAX_WORKERS = 64, MAX_N = 200;   // relay v1.3 v3_perf ranges (a value outside = 400)
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // phone / tablet / pc from the pointer and the screen (and the UA-CH "mobile" flag when the browser has it)
  function dev() {
    try {
      const small = Math.min(screen.width || 0, screen.height || 0);
      const mobile = navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean" ? navigator.userAgentData.mobile : null;
      const touchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
      if (mobile === true || touchOnly) return small >= 600 ? "tablet" : "phone";
      return "pc";
    } catch (_) { return "pc"; }
  }
  // whole ms, held to the relay's 20-120000 (a scan under 20 ms counts as 20, a stuck one as 120000)
  const clean = (ms) => { const v = Math.round(Number(ms)); return Number.isFinite(v) && v > 0 ? Math.min(MAX_MS, Math.max(MIN_MS, v)) : null; };
  function pick(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]; }
  function median(list) { const s = list.map(Number).filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null; }
  function summary(samples, opts) {
    const o = opts || {}, all = (samples || []).map((x) => ({ ms: clean(x && x.ms), p: x && x.p })).filter((x) => x.ms !== null);
    if (!all.length) return null;
    const ms = all.map((x) => x.ms).sort((a, b) => a - b);
    const perf = { ms: median(ms), p10: pick(ms, 0.1), p90: pick(ms, 0.9), n: Math.min(MAX_N, ms.length) };
    perf.workers = Math.min(MAX_WORKERS, Math.max(1, Math.round(Number(o.workers) || 1)));
    if (SPEEDS.includes(o.speed)) perf.speed = o.speed;
    perf.dev = dev();
    perf.src = o.src === "contribute" ? "contribute" : "lookup";
    const by = {};
    for (const p of PRESETS) { const list = all.filter((x) => x.p === p).map((x) => x.ms); if (list.length) by[p] = median(list); }
    perf.by_preset = by;
    return perf;
  }
  function add(body, perf) {
    if (!on() || !perf) return body;
    try { const b = JSON.parse(body); b.perf = perf; return JSON.stringify(b); } catch (_) { return body; }
  }

  // ---- the Stats tab card ----
  const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const msText = (v) => (num(v) === null ? "—" : v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " s" : fmt(v) + " ms");
  const spmOf = (ms) => (num(ms) && ms > 0 ? 60000 / ms : null);
  const spmText = (v) => (num(v) === null ? "—" : v >= 100 ? fmt(v) : v.toFixed(v >= 10 ? 0 : 1));
  const NICE = { phone: "Phone", tablet: "Tablet", pc: "PC", gentle: "Gentle", balanced: "Balanced", max: "Maximum" };
  const presetName = (p) => String(p).split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" · ");
  const avgOf = (x) => num(x && typeof x === "object" ? (x.avg ?? x.p50) : x);
  function table(title, obj, keyName, order, counts) {
    counts = counts !== false;
    const keys = Object.keys(obj || {}).filter((k) => avgOf(obj[k]) !== null).sort((a, b) => (order ? order.indexOf(a) - order.indexOf(b) : avgOf(obj[a]) - avgOf(obj[b])));
    if (!keys.length) return "";
    const rows = keys.map((k) => { const x = obj[k] || {}, o = typeof x === "object";
      return `<tr><th scope="row">${esc(keyName(k))}</th>${counts ? `<td>${o && num(x.systems) !== null ? fmt(x.systems) : "—"}</td>` : ""}<td>${msText(avgOf(x))}</td><td>${o ? msText(x.min) : "—"}</td><td>${o ? msText(x.max) : "—"}</td></tr>`; }).join("");
    return `<table class="si-speed-table"><caption>${esc(title)}</caption><thead><tr><th scope="col"></th>${counts ? `<th scope="col">Systems</th>` : ""}<th scope="col">Average</th><th scope="col">Fastest</th><th scope="col">Slowest</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function speedCard(box) {
    if (!box || box.dataset.loaded === "1") return;
    box.dataset.loaded = "1";
    box.innerHTML = `<div class="si-hist-title">Scanner speed</div><p class="site-muted">Loading…</p>`;
    fetch("stats/speed.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((s) => {
      const o = s && s.overall;
      if (!o || avgOf(o) === null) { box.innerHTML = `<div class="si-hist-title">Scanner speed</div><p class="site-muted">No speed data yet.</p>`; return; }
      // systems per minute: from the batches' own throughput when the Action gives it (workers × 60000 / ms), else per scanner
      const spm = s.spm && num(s.spm.avg) !== null ? s.spm : { avg: spmOf(avgOf(o)), max: spmOf(o.min), min: spmOf(o.max) };
      box.innerHTML = `<div class="si-hist-title">Scanner speed</div>
<p class="site-muted si-speed-note">Measured on the devices that scan: ${fmt(num(s.systems) || 0)} systems in ${fmt(num(s.batches) || 0)} uploads${s.updated ? `, updated ${esc(String(s.updated).slice(0, 10))}` : ""}. Only the scan itself is timed; nothing about the device is kept but its type.</p>
<div class="si-tiles4 si-speed-tiles">
<div><b>${spmText(spm.avg)}</b><span>Systems / min, average</span></div><div><b>${spmText(spm.max)}</b><span>Fastest</span></div><div><b>${spmText(spm.min)}</b><span>Slowest</span></div><div><b>${msText(avgOf(o))}</b><span>Per system, average</span></div></div>
<p class="site-muted si-speed-note">Per system: fastest ${msText(o.min)}, slowest ${msText(o.max)}${num(o.p10) !== null ? ` · 10 % of scans under ${msText(o.p10)}, 90 % under ${msText(o.p90)}` : ""}.</p>
${table("By device", s.by_dev, (k) => NICE[k] || k, ["phone", "tablet", "pc"])}
${table("By speed setting", s.by_speed, (k) => NICE[k] || k, ["gentle", "balanced", "max"])}
${table("Average per system by derelict type", s.by_preset, presetName, null, false)}`;
    });
  }

  globalThis.dvPerf = { on, dev, summary, add, median, speedCard, PRESETS };
})();
