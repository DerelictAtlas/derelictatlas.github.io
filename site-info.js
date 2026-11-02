/* site-info.js (SITE integration, user 2026-10-31: "the info button on the top right needs a little bit of rework, i dont
 * want to scroll and the style of the info is not matching anymore, change it with a nice ui and no scrolling").
 * Rebuilds the ⓘ dialog into tabs that each fit without scrolling: Overview (atlas status + Welcome tour, Contribute!,
 * coffee), Using the viewer, Scanning, Statistics, About. The redesign's elements keep their ids (modern.js still fills
 * #page-info, #source-status, #refresh-info, #refresh-atlas, #info-version, #diagnostics); its old long texts move into a
 * hidden holder. Sections added later (site-stats.js visitor statistics / owner tools) go into their tabs. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const TAB_KEY = "dv.info.tab";
  const ico = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const I = {
    overview: ico("M12 2l8 4.5v11L12 22l-8-4.5v-11Z M12 22V12 M20 6.5 12 12 4 6.5"),
    use: ico("M4 6h16M4 12h16M4 18h10"),
    scan: ico("M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"),
    stats: ico("M4 20V10M10 20V4M16 20v-7M22 20H2"),
    about: ico("M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z M12 11v6 M12 7.5v.5"),
    find: ico("M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z M21 21l-5-5"),
    read: ico("M4 5h16v14H4Z M8 9h8M8 13h5"),
    map: ico("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2Z M9 4v14M15 6v14"),
    check: ico("M4 12l5 5L20 6"),
    rules: ico("M5 4h14v16H5Z M9 8h6M9 12h6M9 16h3"),
    device: ico("M7 2h10v20H7Z M11 18h2"),
    search: ico("M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z M21 21l-5-5 M11 8v6M8 11h6"),
    save: ico("M5 3h11l3 3v15H5Z M8 3v6h8 M8 21v-7h8v7"),
  };
  const card = (icon, title, text) => `<div class="si-card"><span class="si-card-icon">${icon}</span><div><b>${title}</b><p>${text}</p></div></div>`;
  const TABS = [["overview", "Overview"], ["use", "Using the viewer"], ["scan", "Scanning"], ["stats", "Statistics"], ["about", "About"]];
  const SHORT = { overview: "Overview", use: "Viewer", scan: "Scanning", stats: "Stats", about: "About" };

  function panelHtml(name) {
    if (name === "overview") return `<div class="si-hero"><img src="brand/logo-256.webp" alt=""><div><h3>Derelict Atlas</h3>
<p>Derelict freighter layouts for No Man’s Sky, rebuilt from the game’s own generation: every deck and container, the predicted Salvaged Frigate Modules, end reward and loot.</p></div></div>
<div class="si-status-slot"></div>
<div class="si-tiles">
<button type="button" class="si-tile" data-si="welcome"><span class="si-tile-icon">✦</span><b>Welcome tour</b><small>What the atlas is and how it scans, in five steps.</small></button>
<a class="si-tile gold" href="contribute.html"><span class="si-tile-icon">◎</span><b>Contribute!</b><small>Scan systems for the atlas with this device.</small></a>
<button type="button" class="si-tile" data-si="coffee"><span class="si-tile-icon">☕</span><b>Buy me a coffee</b><small data-si-coffee>Enjoy the Atlas? A coffee keeps it free, ad-free and the scanners running.</small></button>
</div>`;
    if (name === "use") return `<div class="si-cards">${card(I.find, "Find", "Systems start with the most Salvaged Frigate Modules. Sort by Best overall, loot value or nanites; Filters narrow the list (maps only, end reward, hide done).")}
${card(I.read, "Read the numbers", "Totals count every container: crates, footlockers, briefcases and tall lockers. <b>?</b> uncertain prediction, <b>—</b> unknown, <b>+</b> at least this many.")}
${card(I.map, "Explore the maps", "3D and all-deck 2D maps: drag or pinch, expand either view, tap a ladder to follow it. Quick Run plans a route through the loot.")}
${card(I.check, "Track your runs", "Finished Run greys a system out (press again to undo); Filters → Hide done hides them. Saved in this browser only.")}</div>`;
    if (name === "scan") return `<div class="si-cards">${card(I.rules, "Built from the game’s rules", "The scanner runs the game’s own derelict generation from the system address alone: the same layout, containers and loot tables as in NMS 7.10.")}
${card(I.device, "On your device", "Opening a system runs the scanner in your browser: it draws the 3D and 2D map and works out the loot in a few seconds.")}
${card(I.search, "Not in the atlas yet?", "Search its glyphs or hex address and it is scanned on the spot. Adding it to the atlas is up to you, unless it breaks into a top-100 list.")}
${card(I.save, "Kept to save space", "The atlas keeps every number of every system for everyone; the 3D and 2D maps are kept only for the top-100 lists.")}</div>`;
    if (name === "stats") return `<div class="si-stats" aria-live="polite"><p class="site-muted">Loading atlas statistics…</p></div><div class="si-owner-stats"></div>`;
    return `<div class="si-about-slot"></div>${creditsHtml()}<div class="si-owner-slot"></div><div class="si-foot"><span class="si-version-slot"></span><span class="si-actions-slot"></span></div>`;
  }

  // credits out in the open (user 2026-10-31): cards, each description two lines until it is clicked
  function creditsHtml() {
    const credits = (window.DV_CREDITS || []).map((c) => `<li class="si-credit" tabindex="0" title="Click to read all"><b><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a></b>`
      + `<small>by ${esc(c.by)} · ${esc(c.license)}</small><p>${esc(c.what)}</p></li>`).join("");
    const links = (window.DV_LINKS_TO || []).map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(c.name)}</a> by ${esc(c.by)}`).join(" · ");
    return credits ? `<h4 class="si-credits-title">Credits</h4><ul class="si-credits">${credits}</ul>${links ? `<p class="si-links">Links to (external, not affiliated): ${links}</p>` : ""}` : "";
  }

  let statsLoaded = false;
  function loadStats(box) {
    if (statsLoaded) return;
    statsLoaded = true;
    Promise.all([fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      window.dvSinglesCount ? window.dvSinglesCount() : 0]).then(([s, singles]) => {
      if (!s) { box.innerHTML = `<p class="site-muted">Atlas statistics are not available right now.</p>`; statsLoaded = false; return; }
      const cap = Number(s.rules && s.rules.atlas_cap) || 1e6, total = (Number(s.total_systems) || 0) + (singles || 0), pct = Math.min(100, total / cap * 100);
      const regions = Object.values(s.galaxies || {}).reduce((a, g) => a + (g.regions || 0), 0);
      const h = (s.modules && s.modules.histogram) || [], max = Math.max(1, ...h);
      box.innerHTML = `<div class="si-tiles4">
<div><b>${fmt(total)}</b><span>Systems</span></div><div><b>${fmt(regions)}</b><span>Regions</span></div>
<div><b>${fmt(s.maps && s.maps.total)}</b><span>Systems with a map</span></div><div><b>${fmt(s.tiers && s.tiers.full)}</b><span>With all numbers</span></div></div>
<div class="si-progress"><div class="si-progress-label"><span>Road to ${fmt(cap)}</span><b>${pct.toFixed(1)} %</b></div><div class="si-bar"><i style="width:${pct.toFixed(2)}%"></i></div></div>
<div class="si-hist-title">Systems by Salvaged Frigate Modules</div>
<div class="si-hist">${h.map((n, m) => `<div class="${m >= 5 ? "rare" : ""}" title="${fmt(n)} systems with ${m} module${m === 1 ? "" : "s"}"><span>${m}</span><i style="width:${Math.max(n ? 0.8 : 0, n / max * 100).toFixed(2)}%"></i><b>${fmt(n)}</b></div>`).join("")}</div>`;
    });
  }

  let dialog = null, legacy = null;
  function show(name) {
    if (!dialog) return;
    for (const b of dialog.querySelectorAll(".si-tab")) { const on = b.dataset.tab === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
    for (const p of dialog.querySelectorAll(".si-panel")) p.hidden = p.dataset.tab !== name;
    if (name === "stats") loadStats(dialog.querySelector(".si-stats"));
    try { sessionStorage.setItem(TAB_KEY, name); } catch (_) {}
  }
  // late sections from site-stats.js go into their tabs
  function place(el) {
    if (!dialog || !el || el.parentElement !== dialog) return;
    if (el.id === "site-visitor-stats") dialog.querySelector(".si-owner-stats").appendChild(el);
    else if (el.id === "site-owner") {
      dialog.querySelector(".si-owner-slot").appendChild(el);
      // owner tools opened with the hidden gesture: show the About tab
      new MutationObserver(() => { if (!el.hidden) show("about"); }).observe(el, { attributes: true, attributeFilter: ["hidden"] });
    }
    else if (el.id === "site-about") dialog.querySelector(".si-about-slot").appendChild(el);
    else if (!el.classList.contains("si-head") && !el.classList.contains("si-body") && el !== legacy) legacy.appendChild(el);
  }
  function build() {
    dialog = $("info-dialog");
    if (!dialog || dialog.classList.contains("si-info")) return;
    dialog.classList.add("si-info");
    const heading = dialog.querySelector(".dialog-heading"), close = heading && heading.querySelector("[data-close]");
    const head = document.createElement("div");
    head.className = "si-head";
    head.innerHTML = `<img src="brand/logo-128.webp" alt=""><div><div class="eyebrow">DERELICT ATLAS</div><h2 id="si-title">Information</h2></div>`;
    if (close) head.appendChild(close);
    dialog.setAttribute("aria-labelledby", "si-title");
    const body = document.createElement("div");
    body.className = "si-body";
    body.innerHTML = `<nav class="si-tabs" role="tablist" aria-label="Information">${TABS.map(([k, l]) =>
      `<button type="button" class="si-tab" role="tab" data-tab="${k}" aria-controls="si-panel-${k}">${I[k]}<span class="si-long">${l}</span><span class="si-short">${SHORT[k]}</span></button>`).join("")}</nav>
<div class="si-panels">${TABS.map(([k]) => `<section class="si-panel" role="tabpanel" id="si-panel-${k}" data-tab="${k}" hidden>${panelHtml(k)}</section>`).join("")}</div>`;
    legacy = document.createElement("div");
    legacy.className = "si-legacy";
    legacy.hidden = true;
    const kids = [...dialog.children];
    dialog.append(head, body, legacy);
    const status = dialog.querySelector(".atlas-info");
    if (status) body.querySelector(".si-status-slot").appendChild(status);
    const version = kids.find((e) => e.classList && e.classList.contains("info-version")), actions = kids.find((e) => e.classList && e.classList.contains("info-actions"));
    if (version) body.querySelector(".si-version-slot").appendChild(version);
    if (actions) body.querySelector(".si-actions-slot").appendChild(actions);
    for (const el of kids) if (el !== heading && el !== status && el !== version && el !== actions) place(el);
    if (heading) heading.remove();
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) place(n); }).observe(dialog, { childList: true });
    body.addEventListener("click", (e) => {
      const t = e.target instanceof Element ? e.target : null;
      const tab = t && t.closest(".si-tab");
      if (tab) { show(tab.dataset.tab); return; }
      const cr = t && !t.closest("a") && t.closest(".si-credit");
      if (cr) { cr.classList.toggle("open"); return; }
      const si = t && t.closest("[data-si]");
      if (!si) return;
      if (si.dataset.si === "welcome") { dialog.close(); if (globalThis.dvShowWelcome) globalThis.dvShowWelcome(); }
      else if (si.dataset.si === "coffee") { const c = $("support-link"); if (c && !c.hidden && c.href) window.open(c.href, "_blank", "noopener"); }
    });
    body.querySelector(".si-tabs").addEventListener("keydown", (e) => {
      const keys = TABS.map(([k]) => k), cur = keys.indexOf((dialog.querySelector(".si-tab.on") || {}).dataset?.tab);
      const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? cur + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? cur - 1 : null;
      if (next === null) return;
      e.preventDefault();
      const k = keys[(next + keys.length) % keys.length];
      show(k);
      dialog.querySelector(`.si-tab[data-tab="${k}"]`).focus();
    });
    let first = "overview";
    try { first = sessionStorage.getItem(TAB_KEY) || first; } catch (_) {}
    show(TABS.some(([k]) => k === first) ? first : "overview");
    // the coffee tile says when the support link is not connected yet
    new MutationObserver(syncCoffee).observe(dialog, { attributes: true, attributeFilter: ["open"] });
    syncCoffee();
  }
  function syncCoffee() {
    const c = $("support-link"), note = dialog && dialog.querySelector("[data-si-coffee]");
    if (note) note.textContent = c && !c.hidden && c.href ? "Enjoy the Atlas? A coffee keeps it free, ad-free and the scanners running." : "Coming soon: the support link is not connected yet.";
  }
  // after site-integration.js (About) and site-stats.js (owner tools) have added their sections
  function start() { setTimeout(build, 0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
