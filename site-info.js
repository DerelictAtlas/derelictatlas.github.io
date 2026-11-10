/* site-info.js (SITE integration, user 2026-10-31: "the info button on the top right needs a little bit of rework, i dont
 * want to scroll and the style of the info is not matching anymore, change it with a nice ui and no scrolling").
 * Rebuilds the ⓘ dialog into tabs that each fit without scrolling: Overview (atlas status + Tutorial, Contribute!,
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
    privacy: ico("M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5Z M8.5 12l2.5 2.5 4.5-5"),
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
  const TABS = [["overview", "Overview"], ["use", "Using the viewer"], ["scan", "Scanning"], ["stats", "Statistics"], ["about", "About"], ["privacy", "Privacy"]];
  const SHORT = { overview: "Overview", use: "Viewer", scan: "Scanning", stats: "Stats", about: "About", privacy: "Privacy" };

  const nearOn = () => !!document.getElementById("near-main");   // the Near me button exists in this build
  function panelHtml(name) {
    if (name === "privacy") return privacyHtml();
    if (name === "overview") return `<div class="si-hero"><img src="brand/logo-256.webp" alt=""><div><h3>Derelict Atlas</h3>
<p>Derelict freighter layouts for No Man’s Sky, rebuilt from the game’s own generation: every deck and container, the predicted Salvaged Frigate Modules, end reward and loot.</p></div></div>
<div class="si-status-slot"></div>
<div class="si-tiles${nearOn() ? " si-tiles-4" : ""}">
<div class="si-tile" data-si="welcome"><span class="si-tile-icon">✦</span><b><button type="button" class="si-linkbtn" data-si="welcome">Tutorial</button></b><small>A five-step tour on the page. <button type="button" class="si-linkbtn" data-si="guide">Photo guide</button></small><button type="button" class="si-tut-btn" data-si="welcome">Start the tour</button></div>
${nearOn() ? `<button type="button" class="si-tile" data-si="near"><span class="si-tile-icon">⌖</span><b>Near me</b><small>Find a derelict close to you.</small></button>\n` : ""}<a class="si-tile gold" href="contribute.html"><span class="si-tile-icon">◎</span><b>Contribute!</b><small>Scan systems for the atlas with this device.</small></a>
<button type="button" class="si-tile" data-si="coffee"><span class="si-tile-icon">☕</span><b>Buy me a coffee</b><small data-si-coffee>Enjoy the Atlas? A coffee keeps it free, ad-free and the scanners running.</small></button>
</div>`;
    if (name === "use") return `<div class="si-cards">${card(I.find, "Find", "Systems start with the most Salvaged Frigate Modules. Sort by Best overall, loot value or nanites; Filters narrow the list (maps only, end reward, hide done).")}
${card(I.read, "Read the numbers", "Totals count every container: crates, footlockers, briefcases and tall lockers. <b>?</b> uncertain prediction, <b>—</b> unknown, <b>+</b> at least this many.")}
${card(I.map, "Explore the maps", "3D and all-deck 2D maps: drag or pinch, expand either view, tap a ladder to follow it. Quick Run plans a route through the loot.")}
${card(I.check, "Track your runs", "Finished Run greys a system out (press again to undo); Filters → Hide done hides them.")}</div>`;
    if (name === "scan") return `<div class="si-cards">${card(I.rules, "Built from the game’s rules", "The scanner runs the game’s own derelict generation from the system address alone: the same layout, containers and loot tables as in NMS 7.10. Something looks wrong? Use “Report this system” on its page; no account needed.")}
${card(I.device, "On your device", "Opening a system runs the scanner in your browser: it draws the 3D and 2D map and works out the loot in a few seconds. The scanner (about 120 KB) comes from this site on your first scan; your browser keeps a copy and only fetches it again after a site update. Nothing is installed.")}
${card(I.search, "Not in the atlas yet?", "Search its glyphs or hex address and it is scanned on the spot, on your device. If it breaks into a top-100 list it is added to the atlas automatically.")}
${card(I.save, "Kept to save space", "The atlas keeps every number of every system for everyone; the 3D and 2D maps are kept only for the top-100 lists.")}</div>
<div class="si-cards si-cards-more">${card(I.scan, "Contribute scanner", "Scans systems the atlas does not have yet, in your browser, at the speed you choose. Your results are checked and added to the atlas automatically, about every hour. <a href=\"contribute.html\">Open the scanner</a>")}
${card(I.check, "Your uploads", "The scanner page shows how many of your scans are in the atlas, still waiting or missing, and the map state of your top-100 finds.")}</div>`;
    if (name === "stats") return `<div class="si-stats" aria-live="polite"><p class="site-muted">${window.dvLoading ? window.dvLoading.html("Loading atlas statistics") : "Loading atlas statistics…"}</p></div><div class="si-speed" aria-live="polite"></div><div class="si-owner-stats"></div>`;
    return `<div class="si-about-layout">
<div class="si-about-main"><div class="si-about-slot"></div>${creditsHtml()}<div class="si-owner-slot"></div></div>
<aside class="si-about-embed" aria-label="Embed preview">
<div class="si-about-embed-head"><div><span class="si-about-kicker">LIVE WIDGET</span><h4>What visitors see</h4></div><a href="embed-setup.html" target="_blank" rel="noopener">Customize ↗</a></div>
<p>It scans in their browser.</p>
<iframe class="si-about-preview" data-src="embed.html?glyphs=00970A60CCAB&amp;show_glyphs=1&amp;fields=modules,reward,containers" title="Live Derelict Atlas embed preview" loading="lazy"></iframe>
</aside></div>
<div class="si-foot"><span class="si-version-slot"></span><span class="si-actions-slot"></span></div>`;
  }

  // everything about privacy lives here (user 2026-11-06); checked against the code and relay.py, keep it that way
  function privacyHtml() {
    const items = [
      ["In your browser", "No accounts or cookies. Scans, scout name, upload log, settings and Near me position stay in this browser until you clear its data."],
      ["Uploads", "Contribute and Near me upload every system they scan; the viewer only top-100 systems; the embed widget nothing. Uploads hold system numbers, loot values, scan times, speed setting and device type, never your Near me position or check-ins."],
      ["Public on GitHub", "Uploads, your optional scout name and reports, including your note, are published on GitHub. Keep personal details out."],
      ["The relay", "Uploads and reports pass through a relay run by the atlas. It uses your IP address only for rate limits, never stores it and keeps no request logs."],
    ];
    // v157: shown only while the browser really sends scan marks (DV_CONFIG.relayScanned), so the text is never ahead of the code
    if ((window.DV_CONFIG || {}).relayScanned === true) {
      items[1][1] = items[1][1].replace("upload every system they scan", "upload the systems they scan");
      items.splice(2, 0, ["Scan marks", "When upload is on, which systems you scanned goes out as a mark with one module letter each, also for systems whose full result is not kept."]);
    }
    if ((window.DV_CONFIG || {}).goatcounter) items.push(["Visitor count", "GoatCounter counts page views anonymously, without cookies, from the page address, referring page and screen size. A test password adds its own label to these counts, so its use can be told apart."]);
    items.push(["Other sites", "GitHub Pages and Google Fonts can see your IP address when your browser loads from them. Outside links and buttons contact those sites only when clicked. NMS Hub links include glyphs, also your Near me position."]);
    return `<div class="si-privacy" id="si-privacy"><div class="si-privacy-list">${items.map(([t, d]) => `<div><h5>${t}</h5><p>${d}</p></div>`).join("")}</div></div>`;
  }

  // credits out in the open (user 2026-10-31): cards, each description two lines until it is clicked
  function creditsHtml() {
    const credits = (window.DV_CREDITS || []).map((c) => `<li class="si-credit" tabindex="0" title="Click to read all"><b>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</b>`
      + `<small>by ${esc(c.by)} · ${esc(c.license)}</small><p>${esc(c.what)}</p></li>`).join("");
    const links = (window.DV_LINKS_TO || []).map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(c.name)}</a> by ${esc(c.by)}`).join(" · ");
    return credits ? `<h4 class="si-credits-title">Credits</h4><ul class="si-credits">${credits}</ul>${links ? `<p class="si-links">Links to (external, not affiliated): ${links}</p>` : ""}` : "";
  }

  let statsLoaded = false;
  function loadStats(box) {
    if (statsLoaded) return;
    statsLoaded = true;
    let settled = false;
    const tmo = setTimeout(() => {
      if (settled) return;
      box.innerHTML = '<p class="site-muted">Could not load the statistics. <button type="button" class="dv-retry">Retry</button></p>'; statsLoaded = false;
      const b = box.querySelector(".dv-retry");
      if (b) b.addEventListener("click", () => { box.innerHTML = `<p class="site-muted">${window.dvLoading ? window.dvLoading.html("Loading atlas statistics") : "Loading..."}</p>`; loadStats(box); });
    }, (window.dvLoading && window.dvLoading.MS) || 30000);
    Promise.all([fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      window.dvSinglesCount ? window.dvSinglesCount() : 0,
      fetch("stats/speed.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      window.dvSinglesHist ? window.dvSinglesHist() : [],
      fetch("stats/scanned.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]).then(([s, singles, speed, singlesHist, scanned]) => {
      settled = true; clearTimeout(tmo);   // v157: stats/scanned.json (absent = nothing extra is shown)
      if (!s) { box.innerHTML = `<p class="site-muted">Atlas statistics are not available right now.</p>`; statsLoaded = false; return; }
      // v157: stats/systems.json "community" = regions + singles + scanned systems with no row = the one number toward the cap (older files: the sum the page always used)
      const com = s.community && Number(s.community.total) > 0 ? s.community : null, only = com ? Number(com.scanned_no_row) || 0 : 0;
      const cap = Number(s.rules && s.rules.atlas_cap) || (com && Number(com.atlas_cap)) || 1e6, total = com ? Number(com.total) : (Number(s.total_systems) || 0) + (singles || 0), pct = Math.min(100, total / cap * 100);
      const regions = Object.values(s.galaxies || {}).reduce((a, g) => a + (g.regions || 0), 0);
      // snapshot histogram + the published singles (stats/systems.json counts no singles, and no single is in the snapshot's index shards)
      const h = (Array.isArray(s.modules && s.modules.histogram) ? s.modules.histogram : []).map(Number), max0 = Math.max(1, ...h);
      (singlesHist || []).forEach((n, m) => { while (h.length <= m) h.push(0); h[m] += Number(n) || 0; });
      // v157: scanned systems counted without a stored row, by module count (stats/scanned.json); their unknown / no-derelict counts stay out of the modules table
      const scHist = scanned && Array.isArray(scanned.histogram) ? scanned.histogram : [];
      scHist.forEach((n, m) => { while (h.length <= m) h.push(0); h[m] += Number(n) || 0; });
      const max = Math.max(1, ...h, max0);
      // RE W29d sampled 6,116 random regions across 256 galaxy IDs. Scale to one average galaxy only;
      // the sample does not prove equal galaxy totals. Purple systems follow a separate rule and are excluded.
      // Euclid (Galaxy 0) first/last possible systems: static text below, from the W29d region rules (same two as the home trivia), 2026-11-06
      const SAMPLE_VALID = 2897728, SAMPLE_REGIONS = 6116, scaleDenom = SAMPLE_VALID / SAMPLE_REGIONS * 2 ** 32;
      const sig2 = (v) => { const n = Number(Number(v).toPrecision(2)), unit = (x, suffix) => `${x >= 100 ? Math.round(x) : x.toPrecision(2)}${suffix}`; return n >= 1e12 ? unit(n / 1e12, "T") : n >= 1e9 ? unit(n / 1e9, "B") : n >= 1e6 ? unit(n / 1e6, "M") : n >= 1e4 ? unit(n / 1e3, "K") : fmt(n); };
      const pctSig = (p) => (p >= 1 ? Number(p.toPrecision(2)).toString() : p.toFixed(Math.ceil(-Math.log10(p)) + 1)) + "%";
      const moduleMax = h.length - 1, histTotal = h.reduce((a, n) => a + Number(n || 0), 0);
      const moduleDenom = histTotal;
      const moduleUnknown = s.modules && s.modules.unknown != null ? fmt(Number(s.modules.unknown) + Math.max(0, (singles || 0) - (singlesHist || []).reduce((a, n) => a + (Number(n) || 0), 0)) + (scanned ? Number(scanned.unknown) || 0 : 0)) : "unavailable";
      const tailStart = Math.max(0, moduleMax - 3), tailSpan = moduleMax - tailStart;
      const tailRate = tailSpan > 0 && Number(h[tailStart]) > 0 ? Math.pow(Number(h[moduleMax]) / Number(h[tailStart]), 1 / tailSpan) : 0;
      const tailWeight = tailRate > 0 && tailRate < 1 ? Number(h[moduleMax]) * tailRate / (1 - tailRate) : 0;
      const modelWeight = histTotal + tailWeight, modelScale = modelWeight > 0 ? scaleDenom / modelWeight : 0;
      const distRows = h.map((n, m) => `<div class="${m >= 5 ? "rare" : ""}" title="${fmt(n)} atlas systems with ${m} module${m === 1 ? "" : "s"}"><span>${fmt(m)}</span><i style="width:${Math.max(n ? 0.8 : 0, n / max * 100).toFixed(2)}%"></i><b>${fmt(n)}</b><em>&asymp; ${sig2(Number(n || 0) * modelScale)}</em><strong>${(moduleDenom ? Number(n) / moduleDenom * 100 : 0).toFixed(4)}%</strong></div>`);
      if (tailRate > 0 && tailRate < 1 && modelWeight > 0) {
        distRows.push(`<div class="si-dist-sep"><span>Predicted by the model, never observed</span></div>`);
        let weight = Number(h[moduleMax]) * tailRate;
        for (let m = moduleMax + 1; m < 100; m++) {
          if (weight * modelScale < 1) { distRows.push(`<div class="predicted last" title="Where the model runs out, not a maximum"><span>${fmt(m)}+</span><i></i><b>Below 1 expected per galaxy</b></div>`); break; }
          distRows.push(`<div class="predicted" title="Predicted by the model, not observed"><span>${fmt(m)}</span><i></i><b>&mdash;</b><em>&asymp; ${sig2(weight * modelScale)}</em><strong>${pctSig(weight / modelWeight * 100)}</strong></div>`);
          weight *= tailRate;
        }
      }
      const lastRate = moduleMax > 0 && Number(h[moduleMax - 1]) > 0 ? Number(h[moduleMax]) / Number(h[moduleMax - 1]) : 0;
      const lastTailWeight = lastRate > 0 && lastRate < 1 ? Number(h[moduleMax]) * lastRate / (1 - lastRate) : 0;
      const lastNext = histTotal + lastTailWeight > 0 ? scaleDenom * Number(h[moduleMax]) * lastRate / (histTotal + lastTailWeight) : 0;
      const speedAvg = Number(speed && speed.overall && speed.overall.avg), speedN = Number(speed && speed.overall && speed.overall.n);
      const scanYears = speedAvg > 0 ? scaleDenom * speedAvg / 1000 / 31557600 : 0;
      const scanDuration = scanYears >= 1e6 ? `${Number((scanYears / 1e6).toPrecision(2)).toFixed(1)} million years` : scanYears >= 1000 ? `${fmt(Number((scanYears / 1000).toPrecision(2)) * 1000)} years` : `${fmt(Math.round(scanYears))} years`;
      const scanText = scanYears ? `<h3>Time to scan one average galaxy</h3><p>At the recorded scanner average of ${fmt(speedAvg)} ms per system, one scanner thread working without a break would need about <b>${scanDuration}</b> for the ~${sig2(scaleDenom)} per-galaxy estimate. That average comes from only ${fmt(speedN)} recorded systems on few devices and times only the scan step, not downloads or uploads, so treat it as a rough scale.</p>` : "";
      const fg = globalThis.dvCull && globalThis.dvCull.figures ? globalThis.dvCull.figures(s) : { com: false };   // v160: two figures when the stats have a community block
      box.innerHTML = `${fg.com ? `<div class="si-tiles4 si-two"><div title="Kept rows: regions and visitor scans"><b>${fg.atlasText}</b><span>Systems in the atlas</span></div><div title="Everything counted, kept or not. Next goal ${fg.goalText}"><b>${fg.scannedText}</b><span>Scanned (goal ${fg.goalText})</span></div></div>${fg.over ? `<p class="site-muted si-counted">Past one million: only top-100 finds are kept as full results; every scan is still counted.</p>` : ""}` : ""}<div class="si-tiles4">
${fg.com ? "" : `<div><b>${fmt(total)}</b><span>Systems</span></div>`}<div><b>${fmt(regions)}</b><span>Regions</span></div>
<div><b>${fmt(s.maps && s.maps.total)}</b><span>Systems with a map</span></div><div><b>${fmt(s.tiers && s.tiers.full)}</b><span>With all numbers</span></div></div>
<div class="si-progress"><div class="si-progress-label"><span>Road to ${fmt(cap)}</span><b>${pct.toFixed(1)} %</b></div><div class="si-bar"><i style="width:${pct.toFixed(2)}%"></i></div></div>${only ? `<p class="site-muted si-counted">${fmt(only)} of these systems were scanned and counted without a stored row (only the module count is kept).</p>` : ""}
<div class="si-hist-title">Systems by Salvaged Frigate Modules</div>
<div class="si-hist si-dist"><div class="si-dist-head"><span>Mod.</span><i></i><b>Atlas</b><em>Per galaxy</em><strong>Share</strong></div>${distRows.join("")}</div>
<p>The top rows rest on very few systems, so these estimates will change.</p>
<section class="si-module-stats"><p>Atlas: the systems actually in the Galaxy 0 atlas, from the snapshot (<code>stats/systems.json</code>) plus the published single scans${scHist.length ? " and the scanned systems counted without a stored row" : ""} (${fmt(moduleDenom)} systems with a known module count; unknown: ${moduleUnknown}). Per galaxy: the atlas share applied to the estimate for one average galaxy. Share: of the atlas for 0&ndash;${fmt(moduleMax)}, of the model for predicted rows.</p>
<p>The highest counts seen so far are ${fmt(moduleMax)} definite and 5 ambiguous modules. The true maximum is not established; nothing here says higher counts are impossible.</p>
<h3>Per-galaxy system estimate</h3><p>The reverse-engineered sample covered ${fmt(SAMPLE_REGIONS)} random regions across 256 galaxy IDs, with ${fmt(SAMPLE_VALID)} normal valid system indices after excluding index 000. Scaling its average of ${(SAMPLE_VALID / SAMPLE_REGIONS).toFixed(1)} per region to 2<sup>32</sup> regions gives about <b>${sig2(scaleDenom)} normal systems per galaxy on average</b>. This does not verify that galaxies have equal totals; the all-galaxy total remains unknown. Purple systems are separate and excluded.</p>
<p>Euclid (Galaxy 0): first possible system <a href="#/d/0000010000000008" data-address="0000010000000008"><b>000100000008</b></a>, 8 regions from the centre. Last possible system <a href="#/d/000428007F7FF7FF" data-address="000428007F7FF7FF"><b>04287F7FF7FF</b></a>, a purple system in the far corner. Computed from the game's code.</p>
<h3>Are derelicts the same in each galaxy?</h3><p><b>No. The same coordinates give a different derelict in each galaxy.</b> We scanned 500 random regions in each of 8 galaxies (3,966 systems): none of the 13,777 same-coordinate pairs matched. The one exception is the system's trade good, which almost never changes with the galaxy. How many systems a region holds also differs between galaxies.</p>
<p>The odds showed no measurable difference between those galaxies, but that does not prove they are equal. With about 495 systems per galaxy, a shift of under about 6 points would not show, and only 4 systems had 5 or more modules, so the rarest counts are untested across galaxies. The Per galaxy column above is an estimate on that basis.</p>
<p>The scanner matched the game's own code on every field compared outside Galaxy 0, on game version 7.05. One derelict outside Galaxy 0, in Eissentam, was also checked in-game on the current build: its map, the box counts in its first two rooms, one salvaged module's crate, its end reward and its haunted crate matched the prediction. Only 1 of its 72 ordinary boxes was compared, so ordinary loot is still barely tested. This is one system, so it does not show the scanner is right in every galaxy, and it says nothing about the odds.</p>
<h3>How the module model works</h3><p>These are model values, not counts. Modules 0&ndash;${fmt(moduleMax)} scale the Galaxy 0 atlas shares. Above ${fmt(moduleMax)} nothing has been measured, so the tail continues the decline over modules ${fmt(tailStart)}&ndash;${fmt(moduleMax)}: each extra module keeps r = (${fmt(h[moduleMax])} / ${fmt(h[tailStart])})<sup>1/${fmt(tailSpan)}</sup> = ${(tailRate * 100).toFixed(1)}% of the previous count. The fit uses the latest four observed bins, so a new highest bin updates r and all tail values on the next stats refresh. Values are rounded to 2 significant figures.</p>
<p>Limits: Galaxy 0 module shares are extrapolated to an average-per-galaxy denominator, an unverified assumption. The atlas is not a random sample of regions, and the sampled valid indices are not each confirmed to hold a derelict. &ldquo;Below 1 expected&rdquo; is where the model runs out, not a maximum. Sensitivity: using only the last observed step (${(lastRate * 100).toFixed(1)}%) gives about ${sig2(lastNext)} systems at ${fmt(moduleMax + 1)} modules per average galaxy.</p>
${scanText}</section>`;
    });
  }

  let dialog = null, legacy = null;
  // the Privacy tab never scrolls (user 2026-11-06): two columns where there is room, then slightly smaller text.
  // Scrolling comes back only where even that cannot fit, so no text is ever cut off.
  function fitPrivacy() {
    const pan = dialog && dialog.querySelector(".si-panels"), box = dialog && dialog.querySelector("#si-privacy");
    if (!pan || !box) return;
    pan.classList.remove("si-noscroll");
    if (box.closest(".si-panel").hidden || !pan.clientHeight) return;
    const set = (cols, scale) => { box.classList.toggle("two", cols === 2); box.style.setProperty("--si-pv", scale); };
    for (const scale of [1, .95, .9, .85, .8]) for (const cols of box.clientWidth >= 520 ? [1, 2] : [1]) {
      set(cols, scale);
      if (pan.scrollHeight <= pan.clientHeight) { pan.classList.add("si-noscroll"); return; }
    }
    set(1, 1);
  }
  function show(name) {
    if (!dialog) return;
    for (const b of dialog.querySelectorAll(".si-tab")) { const on = b.dataset.tab === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
    for (const p of dialog.querySelectorAll(".si-panel")) p.hidden = p.dataset.tab !== name;
    if (name === "about") {
      const preview = dialog.querySelector(".si-about-preview");
      if (preview && !preview.dataset.loaded) { preview.src = preview.dataset.src; preview.dataset.loaded = "true"; }
    }
    if (name === "stats") { loadStats(dialog.querySelector(".si-stats")); if (window.dvPerf) window.dvPerf.speedCard(dialog.querySelector(".si-speed")); }
    fitPrivacy();
    try { sessionStorage.setItem(TAB_KEY, name); } catch (_) {}
  }
  function openInfoTab(name) {
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    show(name);
    dialog.querySelector(".si-panels")?.scrollTo({ top: 0 });
  }
  window.dvOpenInfoTab = openInfoTab;
  function openPrivacy() { openInfoTab("privacy"); }
  window.addEventListener("hashchange", () => {
    if (location.hash === "#/stats") openInfoTab("stats");
    else if (location.hash === "#/privacy") openPrivacy();
    else if (location.hash.startsWith("#/d/") && dialog && dialog.open) dialog.close();   // "Open" in the scanner shows that system
  });
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
      else if (si.dataset.si === "near") { dialog.close(); setTimeout(() => { if (location.hash === "#/near") window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = "#/near"; }, 0); }
      else if (si.dataset.si === "guide") { dialog.close(); if (globalThis.dvOpenGuide) setTimeout(() => globalThis.dvOpenGuide(), 0); }
      else if (si.dataset.si === "coffee") { const c = $("support-link"); if (c && !c.hidden && c.href) window.open(c.href, "_blank", "noopener"); }
    });
    window.addEventListener("message", (e) => {
      const f = dialog && dialog.querySelector(".si-about-preview");
      if (!f || e.origin !== location.origin || e.source !== f.contentWindow || !e.data || e.data.type !== "derelict-atlas:size") return;
      f.style.height = Math.max(106, Math.min(760, (Number(e.data.height) || 0) + 2)) + "px";
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
    if (location.hash === "#/stats") openInfoTab("stats");
    else if (location.hash === "#/privacy") openPrivacy();
    // the coffee tile says when the support link is not connected yet
    new MutationObserver(syncCoffee).observe(dialog, { attributes: true, attributeFilter: ["open"] });
    new MutationObserver(fitPrivacy).observe(dialog, { attributes: true, attributeFilter: ["open"] });
    window.addEventListener("resize", fitPrivacy);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPrivacy);
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
