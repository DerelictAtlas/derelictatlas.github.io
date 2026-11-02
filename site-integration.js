// SITE integration layer for the public GitHub Pages site (SITE agent, 2026-10-30).
// Classic script, loaded in <head> after config.js, gate.js, names.js and credits.js and before the app modules.
// It adds what the published site needs on top of the Derelict Atlas redesign, without changing its look:
//   1. System names: the original procedural name computed from the address (names.js + names-data.json.gz, a port of
//      hadsh/nms_namegen, MIT). system-identity.js asks window.dvSystemName(address) when the row has no system_name.
//      Names are computed on demand (one per viewed system), never for the whole atlas at once.
//   2. "About and credits" section in the Info dialog (credits.js: DV_CREDITS, DV_LINKS_TO, DV_DISCLAIMER). The MIT
//      projects the atlas is built on must stay credited.
//   3. Visitor counter (GoatCounter, cookie-less, no third-party script: a counting pixel). OFF until config.js
//      DV_CONFIG.goatcounter holds the GoatCounter site code (https://<code>.goatcounter.com). Counts the front page
//      ("/") and each system page ("/d/<ADDRESS16>") once per page load, after the password gate. The Info dialog
//      shows the site total (needs "Allow adding visitor counts on your website" in the GoatCounter settings).
(function () {
  "use strict";
  let namesReady = false;
  window.dvSystemName = function (address) {
    try {
      if (!namesReady || !window.NMSNames) return "";
      const a = String(address || "").toUpperCase();
      return /^[0-9A-F]{16}$/.test(a) ? NMSNames.name(a) || "" : "";
    } catch (_) { return ""; }
  };

  async function gzipText(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    if (b[0] !== 0x1f || b[1] !== 0x8b) return new TextDecoder().decode(b);
    return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }

  // The viewer header may render before the names table has loaded: fill the placeholder in afterwards.
  function fixShownName() {
    const el = document.getElementById("system-name");
    if (!el || el.textContent.trim() !== "system_name") return;
    const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash);
    const name = m ? window.dvSystemName(m[1]) : "";
    if (!name) return;
    el.textContent = name;
    const box = document.getElementById("system-identity"), gal = document.getElementById("system-galaxy");
    if (box) box.title = name + " - " + (gal ? gal.textContent : "");
  }

  window.dvNamesReady = (async () => {
    try {
      if (!window.NMSNames) return false;
      const t = await gzipText(new URL("names-data.json.gz", document.baseURI).href);
      if (!t) return false;
      NMSNames.init(JSON.parse(t));
      namesReady = true;
      fixShownName();
      return true;
    } catch (_) { return false; }
  })();

  // Visitor counter. cfg.goatcounterEndpoint overrides the URL (tests only).
  const cfg = window.DV_CONFIG || {};
  const gcCode = String(cfg.goatcounter || "").trim().toLowerCase();
  const gcBase = cfg.goatcounterEndpoint || (/^[a-z0-9-]{2,50}$/.test(gcCode) ? `https://${gcCode}.goatcounter.com` : "");
  const gcLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !cfg.goatcounterEndpoint;
  const counted = new Set();
  function countView() {
    const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash);
    const path = m ? "/d/" + m[1].toUpperCase() : "/";
    if (counted.has(path)) return;
    counted.add(path);
    const q = new URLSearchParams({ p: path, t: m ? "System " + m[1].toUpperCase() : "Derelict Atlas",
      r: counted.size === 1 ? document.referrer : "", s: `${screen.width},${screen.height},${window.devicePixelRatio || 1}`,
      rnd: Math.random().toString(36).slice(2) });
    new Image().src = `${gcBase}/count?${q}`;
  }
  if (gcBase && !gcLocal) {
    (window.dvGateReady || Promise.resolve()).then(() => { countView(); window.addEventListener("hashchange", countView); });
  }
  window.dvVisitors = () => (gcBase && !gcLocal
    ? fetch(`${gcBase}/counter/TOTAL.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    : Promise.resolve(null));

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function aboutSection() {
    const credits = (window.DV_CREDITS || []).map((c) =>
      `<li><b><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a></b> by ${esc(c.by)} <span class="site-muted">(${esc(c.license)})</span><br>${esc(c.what)}</li>`).join("");
    const links = (window.DV_LINKS_TO || []).map((c) =>
      `<li><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(c.name)}</a> by ${esc(c.by)} <span class="site-muted">(${esc(c.note)}; external, not affiliated)</span></li>`).join("");
    const s = document.createElement("section");
    s.id = "site-about";
    s.setAttribute("aria-labelledby", "site-about-title");
    s.innerHTML = `<h3 id="site-about-title">About and credits</h3>
      <p>Predicted derelict-freighter layouts for No Man's Sky, generated offline by running the game's own layout code. The data is the public atlas
        <a href="https://github.com/DerelictAtlas/derelictatlas.github.io" target="_blank" rel="noopener">DerelictAtlas/derelictatlas.github.io</a>.</p>
      <details class="site-credits"><summary>Credits</summary><ul>${credits}</ul>${links ? `<p>Links to</p><ul>${links}</ul>` : ""}</details>
      <p><button id="site-welcome-again" type="button" class="inline-link">Show the welcome again</button></p>
      <div class="site-facsimile"><b>Facsimiles, not game files</b>
        <p>Unofficial fan project, not affiliated with or endorsed by Hello Games; No Man’s Sky is their trademark.
        No images, 3D models, textures, icons, sounds or other game files are on this site: every map, 3D view, portal glyph,
        icon and the logo is our own facsimile.</p></div>
      ${gcBase ? `<p class="site-muted">Page views are counted anonymously with <a href="https://www.goatcounter.com" target="_blank" rel="noopener">GoatCounter</a> (no cookies, no personal data).</p>` : ""}`;
    if (gcBase && !cfg.goatcounterToken && !cfg.goatcounterTokenSealed) {  // with a token, site-stats.js shows the full statistics (owner only)
      const v = document.createElement("p");
      v.id = "site-visitors";
      v.hidden = true;
      s.insertBefore(v, s.children[1] || null);
      window.dvVisitors().then((d) => {
        if (!d || d.count === undefined) return;
        v.innerHTML = `<b>${esc(d.count)}</b> page views` + (d.count_unique !== undefined ? ` · <b>${esc(d.count_unique)}</b> visitors` : "");
        v.hidden = false;
      });
    }
    return s;
  }

  function mountAbout() {
    const dialog = document.getElementById("info-dialog");
    if (!dialog || document.getElementById("site-about")) return;
    const version = dialog.querySelector(".info-version");
    dialog.insertBefore(aboutSection(), version || null);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAbout); else mountAbout();


  // "Open in" (user 2026-10-31): the two sites listed under "Links to", for the system on screen. Plain links, nothing
  // fetched. Almanac website = galaxy slug (only galaxies listed here, never guessed); NMS Hub map = 0-based galaxy index.
  const OPEN_IN = [
    { name: "NMS Almanac", url: "https://nmsalmanac.com/system/{slug}/{glyphs}", slugs: { 0: "euclid" } },
    { name: "NMS Hub galactic map", url: "https://map.nomansskyhub.app/?arrival=1&addr={glyphs}&galaxy={galaxy}" },
  ];
  function openInHtml(address) {
    const glyphs = "0" + address.slice(3, 6) + address.slice(8), galaxy = parseInt(address.slice(6, 8), 16);
    const links = OPEN_IN.filter((e) => !e.slugs || e.slugs[galaxy]).map((e) => `<a href="${esc(e.url.replace("{glyphs}", glyphs)
      .replace("{galaxy}", galaxy).replace("{slug}", (e.slugs || {})[galaxy] || ""))}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"
      title="External site, not affiliated">${esc(e.name)} ↗</a>`);
    return links.length ? `<span>Open in</span>${links.join("")}` : "";
  }
  function mountOpenIn() {
    const strip = document.querySelector("#viewer-content .identity-strip .glyph-address");
    const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash);
    if (!strip || !m) return;
    const html = openInHtml(m[1].toUpperCase());
    let box = strip.querySelector(".site-open-in");
    if (!html) { if (box) box.remove(); return; }
    if (box && box.dataset.address === m[1].toUpperCase()) return;
    if (!box) { box = document.createElement("div"); box.className = "site-open-in"; strip.appendChild(box); }
    box.dataset.address = m[1].toUpperCase();
    box.innerHTML = html;
  }

  // Status near the list (user 2026-10-31): the first-load placeholder in the systems list repeats the header status
  // ("Loading atlas…", "Preparing atlas…"), and "Sorting systems…" also shows under Filters / sort while a sort runs.
  function syncStatus() {
    const st = document.getElementById("atlas-status"), results = document.getElementById("results");
    if (!st || !results) return;
    const text = st.textContent.trim();
    const loading = results.querySelector(".loading");
    if (loading && text && text !== "systems") {
      const node = [...loading.childNodes].reverse().find((n) => n.nodeType === 3);
      if (node && node.textContent !== text) node.textContent = text;
    }
    // one loading circle (user 2026-11-01: "keep the top one since the other one keeps popping up and moving the
    // systems up and down"): the header's circle + status text show sorting too, so no extra line above the list.
    document.getElementById("site-busy")?.remove();
  }
  // Best overall (user 2026-10-31): cards show their rank (#1, #2, #3 ...) while that sort is chosen. The windowed list
  // gives every card its position (data-list-index); filters apply first, so the rank is within the shown systems.
  function syncRanks() {
    const results = document.getElementById("results"), sort = document.getElementById("sort");
    if (!results || !sort) return;
    const on = sort.value === "overall";
    for (const card of results.querySelectorAll(".system-card")) {
      let badge = card.querySelector(":scope > .site-rank");
      const i = Number(card.dataset.listIndex);
      if (!on || !Number.isFinite(i)) { if (badge) badge.remove(); continue; }
      const text = "#" + (i + 1);
      if (!badge) { badge = document.createElement("span"); badge.className = "site-rank"; badge.setAttribute("aria-hidden", "true"); card.appendChild(badge); }
      if (badge.textContent !== text) { badge.textContent = text; badge.classList.toggle("top3", i < 3); }
    }
  }
  // Quick Run (user 2026-10-31): its options open as a small window on the right of the controls bar; when the bar has
  // no room beside the buttons, the window opens just below the bar instead (over the views, which keep their size).
  function fitQuickRun() {
    const p = document.getElementById("route-panel"), row = document.querySelector(".viewer-controls .viewer-control-row");
    if (!p || p.hidden || !row || !row.lastElementChild) return;
    p.classList.remove("qr-below");
    p.style.left = p.style.right = "";
    const bar = p.parentElement.getBoundingClientRect(), b = row.lastElementChild.getBoundingClientRect();
    const left = b.right - bar.left + 8;  // right next to the Quick Run button
    if (left + p.offsetWidth <= bar.width - 9) { p.style.left = left + "px"; p.style.right = "auto"; } else p.classList.add("qr-below");
  }

  // Deck spacing (user 2026-10-31): the button sits in the 3D view heading next to "... DECKS"; its slider opens inside
  // that heading (the heading keeps its height). The page's own handlers stay bound (same elements, moved).
  function moveSpacing() {
    const btn = document.getElementById("toggle-spacing"), panel = document.getElementById("spacing-panel");
    const head = document.querySelector("#viewer-content .visuals .visual-panel .visual-heading");  // the first panel = 3D
    if (!btn || !panel || !head || head.contains(btn)) return;
    const h3 = head.querySelector("h3");
    if (!h3) return;
    const box = document.createElement("div");
    box.className = "site-spacing";
    box.append(btn, panel);
    h3.after(box);
  }
  // "Contribute!" (user 2026-10-31): header button next to the coffee button, to contribute.html (scan systems for the atlas with this device)
  // header (user 2026-10-31): the road to 1,000,000 in the middle with the current number inside the bar and Contribute!
  // beside it; the atlas count and its loading status move next to the Systems heading (they belong to the list)
  function mountContribute() {
    const tools = document.querySelector(".app-header .header-tools");
    if (!tools || document.getElementById("contribute-link")) return;
    const goal = document.createElement("div");
    goal.id = "site-goal";
    goal.className = "site-goal";
    goal.innerHTML = `<a class="site-goal-bar" href="contribute.html" title="Systems in the atlas, on the way to 1,000,000"><i></i><span><b>—</b><span class="long"> / 1,000,000 systems</span><span class="short"> / 1M</span></span></a>`;
    const link = document.createElement("a");
    link.id = "contribute-link";
    link.className = "header-contribute";
    link.href = "contribute.html";
    link.title = "Contribute: scan systems for the atlas with this device";
    link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.5 5.5"/><circle cx="12" cy="12" r="1.2"/></svg><span>Contribute!</span>';
    goal.appendChild(link);
    tools.before(goal);
    const count = tools.querySelector(".header-count"), heading = document.querySelector("#systems .section-heading");
    if (count && heading) { count.classList.add("site-list-count"); heading.appendChild(count); }
    Promise.all([fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      window.dvSinglesCount ? window.dvSinglesCount() : 0]).then(([s, singles]) => {
      if (!s || !Number(s.total_systems)) return;
      const cap = Number(s.rules && s.rules.atlas_cap) || 1000000, n = Number(s.total_systems) + (singles || 0), pct = Math.min(100, n / cap * 100);
      goal.querySelector("i").style.width = pct.toFixed(2) + "%";
      goal.querySelector("b").textContent = n.toLocaleString("en-US");
      goal.querySelector(".long").textContent = ` / ${cap.toLocaleString("en-US")} systems`;
      goal.querySelector(".short").textContent = cap === 1000000 ? " / 1M" : ` / ${cap.toLocaleString("en-US")}`;
      goal.querySelector("a").title = `${n.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")} systems in the atlas (${pct.toFixed(1)} %). Help it get there: Contribute!`;
    });
  }

  function watch() {
    const content = document.getElementById("viewer-content"), st = document.getElementById("atlas-status"), results = document.getElementById("results");
    if (content) new MutationObserver(() => { mountOpenIn(); moveSpacing(); }).observe(content, { childList: true });
    window.addEventListener("hashchange", mountOpenIn);
    if (st) new MutationObserver(syncStatus).observe(st, { childList: true, characterData: true, subtree: true });
    if (results) new MutationObserver(syncStatus).observe(results, { attributes: true, attributeFilter: ["aria-busy"], childList: true });
    if (results) new MutationObserver(syncRanks).observe(results, { childList: true, subtree: true });
    const sortSel = document.getElementById("sort");
    if (sortSel) sortSel.addEventListener("change", syncRanks);
    document.addEventListener("click", (e) => { if (e.target instanceof Element && e.target.closest("#toggle-quick")) setTimeout(fitQuickRun, 0); });
    window.addEventListener("resize", fitQuickRun);
    mountOpenIn();
    moveSpacing();
    mountContribute();
    syncStatus();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

  // Hidden owner menu (user 2026-10-31): 10 clicks on the version number in the Info dialog open "Owner tools"
  // (site-stats.js: statistics unlock + Developer mode); without statistics configured they open Developer mode.
  let devClicks = 0, devTimer = 0;
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("#info-dialog .info-version")) return;
    clearTimeout(devTimer);
    devTimer = setTimeout(() => { devClicks = 0; }, 4000);
    if (++devClicks < 10) return;
    devClicks = 0;
    if (window.dvOwnerTools && window.dvOwnerTools()) return;
    const b = document.getElementById("diagnostics");
    if (b) b.click();
  });
})();
