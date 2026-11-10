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
      <p>Predicted derelict-freighter layouts for No Man's Sky, generated offline by running the game's own layout code.</p>
      <details class="site-credits"><summary>Credits</summary><ul>${credits}</ul>${links ? `<p>Links to</p><ul>${links}</ul>` : ""}</details>
      <p><button id="site-welcome-again" type="button" class="inline-link">Start the tour</button></p>
      <div class="site-about-cards"><div class="site-facsimile"><b>Facsimiles, not game files</b>
        <p>Unofficial fan project, not affiliated with or endorsed by Hello Games; No Man’s Sky is their trademark.
        No images, 3D models, textures, icons, sounds or other game files are on this site: every map, 3D view, portal glyph,
        icon and the logo is our own facsimile.</p></div>
      <div class="site-facsimile site-free-use"><b>Free to link and use</b>
        <p>Link to any system page and use its numbers, screenshots and maps in guides, videos, streams, wikis and your own
        tools. A credit like “Data: Derelict Atlas” with a link is appreciated; the atlas data is public on
        <a href="https://github.com/DerelictAtlas/derelictatlas.github.io" target="_blank" rel="noopener">GitHub</a>.</p></div></div>`;
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
    { name: "NMS Hub galactic map", url: "https://map.nomansskyhub.app/?arrival=1&addr={hubglyphs}&galaxy={galaxy}" },
  ];
  function openInHtml(address) {
    const glyphs = "0" + address.slice(3, 6) + address.slice(8), galaxy = parseInt(address.slice(6, 8), 16);
    const links = OPEN_IN.filter((e) => !e.slugs || e.slugs[galaxy]).map((e) => `<a href="${esc(e.url.replace("{glyphs}", glyphs)
      .replace("{hubglyphs}", glyphs).replace("{galaxy}", galaxy).replace("{slug}", (e.slugs || {})[galaxy] || ""))}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"
      title="External site, not affiliated">${esc(e.name)} ↗</a>`);
    // user 2026-11-04: the report link no longer shares this row; it is its own flag icon next to Copy (mountReport)
    return links.length ? `<span>Open in</span>${links.join("")}` : "";
  }
  // clicking the system that is already open in the Systems list shows the home screen again (user 2026-11-03: "select
  // a system twice ... it will display the main menu"). Only where the list and the viewer are side by side; on phones
  // they are separate tabs and tapping the open system still goes to its Viewer tab. Buttons inside a card keep working.
  function sideBySide() { const nav = document.querySelector(".bottom-nav"); return !nav || getComputedStyle(nav).display === "none"; }
  function deselect(e) {
    const card = e.target instanceof Element ? e.target.closest("#results [data-address]") : null;
    if (!card || !sideBySide()) return;
    if (e.type === "keydown" && (e.target !== card || (e.key !== "Enter" && e.key !== " "))) return;
    if (e.type === "click") { const inner = e.target.closest("button, a, input, select, label"); if (inner && inner !== card && card.contains(inner)) return; }
    const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash);
    if (!m || m[1].toUpperCase() !== String(card.dataset.address).toUpperCase()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.hash = "#/";
  }
  document.addEventListener("click", deselect, true);
  document.addEventListener("keydown", deselect, true);

  // "Report this system" (user 2026-11-02 GitHub issue form; user 2026-11-03: "report system needs to be sent automatically
  // without a github account, with options to report or a custom one"): a small dialog with reasons + optional text, sent
  // through the atlas relay (POST <scanRelay minus /submit>/report, relay v1.3, scanner -cc): {"v":1,"address","reasons",
  // "text"?,"scanner","fp"}; the relay files the GitHub issue (label report-system) and the singles Action rescans the
  // system. The GitHub issue form stays as a fallback link. Sent reports are remembered per address (localStorage).
  const REPORT_REASONS = [["modules", "Salvaged Frigate Modules wrong"], ["containers", "Containers wrong"],
    ["rooms", "Rooms or decks wrong"], ["loot", "Loot or SpookBox wrong"], ["reward", "End reward wrong"],
    ["nonexistent", "No derelict or the system doesn't exist"], ["name", "Offensive Atlas scout name"], ["other", "Other"]];
  // "name" (relay v1.3, FINDER1): offered only with the Atlas scout feature on and a published scout for this system
  const scoutOf = (address) => { const F = window.dvFinder; try { return F && F.on() ? F.foundBy(address) : ""; } catch (_) { return ""; } };
  const REPORTED_KEY = "dv.reported.v1", REPORT_TEXT_MAX = 300;
  const reported = () => { try { return JSON.parse(localStorage.getItem(REPORTED_KEY)) || {}; } catch (_) { return {}; } };
  function markReported(address) {
    try { const all = reported(); all[address] = Date.now(); localStorage.setItem(REPORTED_KEY, JSON.stringify(all)); } catch (_) {}
  }
  function githubReportUrl(address) {
    const glyphs = "0" + address.slice(3, 6) + address.slice(8), galaxy = parseInt(address.slice(6, 8), 16);
    const base = String((window.DV_CONFIG || {}).siteBase || "https://derelictatlas.github.io/");
    const body = "What looks wrong with this system? (for example the modules, containers, rooms, decks or loot)\n\n\n---\n" +
      `Address: ${address}\nGlyphs: ${glyphs} (galaxy ${galaxy + 1}${window.dvGalaxy && window.dvGalaxy.name(galaxy) ? ", " + window.dvGalaxy.name(galaxy) : galaxy === 0 ? ", Euclid" : ""})\nLink: ${base}#/d/${address}\n`;
    return "https://github.com/DerelictAtlas/derelictatlas.github.io/issues/new?template=report-system.md&labels=report-system&title=" +
      encodeURIComponent(address) + "&body=" + encodeURIComponent(body);
  }
  function reportHtml(address) {
    const done = !!reported()[address];
    // href = the GitHub form, so the link still works if this script's click handler is not there
    const label = done ? "Reported ✓ (send another report)" : "Report this system: tell the atlas what looks wrong; no account needed";
    return `<a class="site-report site-report-icon${done ? " is-done" : ""}" data-report="${esc(address)}" href="${esc(githubReportUrl(address))}" target="_blank"
      rel="noopener noreferrer" referrerpolicy="no-referrer" title="${esc(label)}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg><span>Report</span></a>`;
  }
  // the relay endpoint: the upload relay's URL with /submit replaced by /report ("relay-test" on the preview -> relay-test/report)
  const reportUrl = () => { const r = String((window.DV_CONFIG || {}).scanRelay || ""); return r ? (/\/submit$/.test(r) ? r.replace(/\/submit$/, "/report") : r.replace(/\/$/, "") + "/report") : ""; };
  let reportScanner = null, reportBlockedUntil = 0;
  // scanner version + tables fingerprint, the same as the v3 uploads send (read from scan/w29.json)
  const scannerInfo = () => reportScanner || (reportScanner = fetch("scan/w29.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((m) => { const version = String(m.version || ""); const fp = (/tables fingerprint ([0-9a-f]{16})\b/.exec(version) || [])[1] || "";
      if (!fp) throw new Error("scanner version without a tables fingerprint"); return { version, fp }; })
    .catch((e) => { reportScanner = null; throw e; }));
  function reportDialog() {
    let d = document.getElementById("site-report-dialog");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "site-report-dialog";
    d.className = "sheet site-report-dialog";
    d.setAttribute("aria-labelledby", "site-report-title");
    d.innerHTML = `<form id="site-report-form" novalidate>
<div class="dialog-heading"><div><div class="eyebrow" id="site-report-address"></div><h2 id="site-report-title">Report this system</h2></div>
<button type="button" class="icon-button" data-report-close aria-label="Close report">×</button></div>
<fieldset class="site-report-reasons"><legend>What looks wrong?</legend>
${REPORT_REASONS.map(([k, label]) => `<label class="check"><input type="checkbox" name="reason" value="${k}"><span>${esc(label)}</span></label>`).join("")}
</fieldset>
<label class="site-report-text"><span>Anything else? <small id="site-report-count">0 / ${REPORT_TEXT_MAX}</small></span>
<textarea id="site-report-textarea" maxlength="${REPORT_TEXT_MAX}" rows="3" placeholder="Anything else? (optional, ${REPORT_TEXT_MAX} characters)"></textarea></label>
<p class="site-report-note">No account needed. Reports are public on GitHub. The atlas rescans the system and fixes it if it was wrong. <a href="index.html#/privacy" target="_blank" rel="noopener">Privacy</a></p>
<p class="site-report-result" id="site-report-result" role="status" hidden></p>
<div class="sheet-actions"><a class="site-report-gh" id="site-report-gh" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">or report on GitHub ↗</a>
<span class="site-report-buttons"><button type="button" class="quiet" data-report-close id="site-report-cancel">Cancel</button><button type="submit" class="primary" id="site-report-send" disabled>Send report</button></span></div>
</form>`;
    document.body.appendChild(d);
    const form = d.querySelector("form"), send = d.querySelector("#site-report-send"), ta = d.querySelector("#site-report-textarea");
    const boxes = () => [...d.querySelectorAll('input[name="reason"]')];
    const sync = () => {
      send.disabled = d.dataset.state === "sending" || d.dataset.state === "done" || !boxes().some((b) => b.checked) || Date.now() < reportBlockedUntil;
      d.querySelector("#site-report-count").textContent = `${ta.value.length} / ${REPORT_TEXT_MAX}`;
    };
    d.addEventListener("change", sync);
    ta.addEventListener("input", sync);
    d.querySelectorAll("[data-report-close]").forEach((b) => b.addEventListener("click", () => d.close()));
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });   // backdrop
    d.addEventListener("close", () => document.documentElement.classList.remove("site-report-open"));
    form.addEventListener("submit", (e) => { e.preventDefault(); sendReport(d); });
    d.syncReport = sync;
    return d;
  }
  function reportResult(d, text, kind) {
    const p = d.querySelector("#site-report-result");
    p.textContent = text;
    p.className = "site-report-result" + (kind ? " " + kind : "");
    p.hidden = !text;
  }
  function openReport(address) {
    const d = reportDialog();
    d.dataset.address = address;
    d.dataset.state = "";
    d.querySelector("#site-report-address").textContent = address;
    d.querySelector("#site-report-gh").href = githubReportUrl(address);
    d.querySelectorAll('input[name="reason"]').forEach((b) => { b.checked = false; b.disabled = false; });
    const nameBox = d.querySelector('input[name="reason"][value="name"]');
    if (nameBox) nameBox.closest("label").hidden = !scoutOf(address);
    const ta = d.querySelector("#site-report-textarea");
    ta.value = ""; ta.disabled = false;
    d.querySelector("#site-report-cancel").textContent = "Cancel";
    d.classList.remove("is-done");
    if (reported()[address]) {
      d.dataset.state = "done";
      d.classList.add("is-done");
      d.querySelector("#site-report-cancel").textContent = "Close";
      reportResult(d, "You already reported this system. Thanks! The atlas will check it.", "ok");
    } else if (!reportUrl()) {
      reportResult(d, "Reports can't be sent from this page right now; please use the GitHub link.", "err");
    } else reportResult(d, "", "");
    d.syncReport();
    document.documentElement.classList.add("site-report-open");
    if (!d.open) d.showModal();
  }
  async function sendReport(d) {
    const address = d.dataset.address, url = reportUrl();
    const reasons = [...d.querySelectorAll('input[name="reason"]:checked')].filter((b) => !b.closest("label").hidden).map((b) => b.value);
    const text = d.querySelector("#site-report-textarea").value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, REPORT_TEXT_MAX);
    if (!url || !reasons.length || d.dataset.state === "sending") return;
    if (Date.now() < reportBlockedUntil) { reportResult(d, "Too many reports from this connection, please try again later.", "err"); return; }
    d.dataset.state = "sending";
    d.syncReport();
    reportResult(d, "Sending…", "");
    const done = (msg) => {
      markReported(address);
      d.dataset.state = "done";
      d.classList.add("is-done");
      d.querySelectorAll('input[name="reason"], #site-report-textarea').forEach((el) => { el.disabled = true; });
      d.querySelector("#site-report-cancel").textContent = "Close";
      reportResult(d, msg, "ok");
      document.querySelectorAll(`a.site-report[data-report="${address}"]`).forEach((a) => { const t = a.querySelector("span"); if (t) t.textContent = "Reported"; else a.textContent = "Reported ✓"; a.title = "Reported ✓"; a.classList.add("is-done"); });
      d.syncReport();
    };
    const fail = (msg) => { d.dataset.state = ""; reportResult(d, msg, "err"); d.syncReport(); };
    let info;
    try { info = await scannerInfo(); } catch (e) { fail("Couldn't send the report (the scanner info did not load). Please try again or use the GitHub link."); return; }
    const body = { v: 1, address, reasons, scanner: info.version, fp: info.fp };
    if (text) body.text = text;
    let r;
    try {
      r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer" });
    } catch (e) { fail("Couldn't reach the atlas relay. Please try again later or use the GitHub link."); return; }
    let j = null;
    try { j = await r.json(); } catch (_) { /* empty body */ }
    if (r.status === 202 || (r.ok && !(j && j.duplicate))) done("Thanks! The atlas will check this system.");
    else if (r.ok && j && j.duplicate) done("Thanks! This system was already reported and will be checked.");
    else if (r.status === 429) {
      const after = Math.min(3600, Math.max(5, Number(r.headers.get("Retry-After")) || 600));
      reportBlockedUntil = Date.now() + after * 1000;
      setTimeout(() => d.syncReport && d.syncReport(), after * 1000 + 50);
      fail("Too many reports from this connection, please try again later.");
    } else fail("Couldn't send the report" + (j && j.error ? ` (${String(j.error).slice(0, 120)})` : r.status ? ` (HTTP ${r.status})` : "") + ". Please use the GitHub link instead.");
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.site-report[data-report]");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    openReport(a.dataset.report);
  });
  // user 2026-11-04 (2nd): Report sits UNDER Copy, at the bottom of the glyph area: Copy + Report share a right column
  function mountReport(address) {
    const strip = document.querySelector("#viewer-content .identity-strip");
    const copy = document.querySelector("#viewer-content #viewer-copy");
    if (!strip || !copy) return;
    let col = strip.querySelector(".site-strip-actions");
    if (!col) { col = document.createElement("div"); col.className = "site-strip-actions"; strip.appendChild(col); }
    // v163: X (close, to the main menu) takes the top right corner; Copy moves down to the other actions
    if (!col.querySelector("#viewer-close")) {
      const x = document.createElement("button"); x.id = "viewer-close"; x.type = "button"; x.className = "site-close-x"; x.setAttribute("aria-label", "Close"); x.title = "Close";
      x.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
      col.insertBefore(x, col.firstChild);
    }
    const xb = col.querySelector("#viewer-close");
    if (copy.parentNode !== col) col.insertBefore(copy, xb.nextSibling);   // order top to bottom: X, Copy, Report
    let wrap = col.querySelector(".site-report-slot");
    if (wrap && wrap.dataset.address === address && wrap.dataset.done === String(!!reported()[address])) return;
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "site-report-slot"; col.appendChild(wrap); }
    wrap.dataset.address = address; wrap.dataset.done = String(!!reported()[address]);
    wrap.innerHTML = reportHtml(address);
  }
  // user 2026-11-04: the loot strip (#system-extras) and the viewer buttons (.viewer-controls) share ONE line (separate
  // boxes) so the 3D / 2D view gets the height back. Ids stay the same, so modern.js still finds both after the move.
  function stripRow() {
    const content = document.getElementById("viewer-content");
    const loot = content && content.querySelector(":scope > #system-extras"), ctl = content && content.querySelector(":scope > .viewer-controls");
    if (!loot || !ctl || loot.nextElementSibling !== ctl) return;
    const row = document.createElement("div");
    row.className = "site-strip-row";
    content.insertBefore(row, loot);
    row.append(loot, ctl);
  }
  function mountOpenIn() {
    const strip = document.querySelector("#viewer-content .identity-strip .glyph-address");
    const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash);
    if (!strip || !m) return;
    mountReport(m[1].toUpperCase());
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
    if (loading && !loading.querySelector(".dv-retry") && text && text !== "systems") {   // v163: the "Could not load" text with Retry is not overwritten
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
    // tutorial (user 2026-11-03, v149 2026-11-08: header top right beside the information button, always visible): glows until the welcome is seen
    // (site-welcome.js sets html.dv-tut-seen; the home screen then has a small one at its top right)
    const tut = document.createElement("button");
    tut.type = "button";
    tut.id = "site-tutorial";
    tut.className = "site-tutorial site-tutorial-head";
    tut.setAttribute("data-tutorial", "");
    tut.title = "Tutorial: how the atlas works";
    tut.setAttribute("aria-label", "Tutorial: how the atlas works");
    tut.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9.5 12 5l10 4.5L12 14Z M6 11.6V16c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.4 M22 9.5v5.5"/></svg>';
    const infoBtn = tools.querySelector("#info-button"); if (infoBtn) tools.insertBefore(tut, infoBtn); else tools.appendChild(tut);  // v149: top right of the page, next to the information button, on every page, always visible
    tools.before(goal);
    const count = tools.querySelector(".header-count"), heading = document.querySelector("#systems .section-heading");
    if (count && heading) { count.classList.add("site-list-count"); heading.appendChild(count); }
    Promise.all([fetch("stats/systems.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      window.dvSinglesCount ? window.dvSinglesCount() : 0]).then(([s, singles]) => {
      if (!s || !Number(s.total_systems)) return;
      // v157: stats/systems.json "community" (regions + singles + scanned systems with no row) when the Action has written it
      const com = s.community && Number(s.community.total) > 0 ? s.community : null;
      const cap = Number(s.rules && s.rules.atlas_cap) || (com && Number(com.atlas_cap)) || 1000000, n = com ? Number(com.total) : Number(s.total_systems) + (singles || 0), pct = Math.min(100, n / cap * 100);
      goal.querySelector("i").style.width = pct.toFixed(2) + "%";
      goal.querySelector("b").textContent = n.toLocaleString("en-US");
      goal.querySelector(".long").textContent = ` / ${cap.toLocaleString("en-US")} systems`;
      goal.querySelector(".short").textContent = cap === 1000000 ? " / 1M" : ` / ${cap.toLocaleString("en-US")}`;
      { const fg = globalThis.dvCull && globalThis.dvCull.figures ? globalThis.dvCull.figures(s) : { com: false };   // v160: two figures
        if (fg.com) {
          goal.querySelector("i").style.width = fg.pct.toFixed(2) + "%";   // v160b: toward the next goal (1M, 10M, 20M ...)
          goal.querySelector("b").textContent = fg.scannedText;
          goal.querySelector(".long").textContent = ` scanned / ${fg.goalText} goal · ${fg.atlasText} in the atlas`;
          goal.querySelector(".short").textContent = ` / ${fg.goalText}`;
          goal.querySelector("b").innerHTML = `<span class="long">${fg.scannedText}</span><span class="short">${fg.scannedShort}</span>`;   // full number on wide screens, 1.23M on phones
        }
        let note = document.getElementById("site-scanned-note");
        if (fg.com && count && heading) {
          if (!note) { note = document.createElement("div"); note.id = "site-scanned-note"; note.className = "site-scanned-note"; heading.after(note); }
          note.textContent = `Scanned ${fg.scannedText} (goal ${fg.goalText})`;
        } else if (note) note.remove(); }
      { const fg2 = globalThis.dvCull && globalThis.dvCull.figures ? globalThis.dvCull.figures(s) : { com: false };
        goal.querySelector("a").title = fg2.com ? `${fg2.scannedText} scanned of the next goal ${fg2.goalText} (${fg2.pct.toFixed(1)} %); ${fg2.atlasText} systems in the atlas. Help it get there: Contribute!`
          : `${n.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")} systems in the atlas (${pct.toFixed(1)} %). Help it get there: Contribute!`; }
    });
  }

  // v164: "Save image of this view" (camera button left of the fullscreen button of the 2D map and of the 3D view, and in the fullscreen window).
  // It saves a PNG of the view exactly as it is now (camera, zoom, pan, layers, deck spacing, what is revealed): the 3D view is drawn again in the
  // same frame by the viewer (view3d.capture), the 2D map is its live SVG. A small preview opens first; nothing is sent anywhere.
  const VS_CAM = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.6"/></svg>';
  const VS_PROPS = "fill fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-linecap stroke-linejoin opacity font-family font-size font-weight letter-spacing text-anchor dominant-baseline paint-order display visibility".split(" ");
  function vsMake(kind, id) {
    const b = document.createElement("button");
    b.type = "button"; b.id = id; b.className = "icon-button vs-save"; b.dataset.vsKind = kind;
    b.setAttribute("aria-label", "Save image of this view"); b.title = "Save image of this view"; b.innerHTML = VS_CAM;
    return b;
  }
  function ensureSave() {
    const e3 = document.getElementById("expand-3d"), e2 = document.getElementById("expand-map");
    if (e3 && !document.getElementById("save-3d")) e3.before(vsMake("3d", "save-3d"));
    if (e2 && !document.getElementById("save-2d")) e2.before(vsMake("2d", "save-2d"));
    const head = document.querySelector("#expand-dialog .dialog-heading"), close = head && head.querySelector("[data-close]");
    if (close && !document.getElementById("save-exp")) close.before(vsMake("exp", "save-exp"));
  }
  const vsGlyphs = () => { try { const c = globalThis.dvShareCurrent && dvShareCurrent(); return c && c.glyphs ? String(c.glyphs).toUpperCase() : ""; } catch (_) { return ""; } };
  function vsCaption(cv, text) {
    const g = cv.getContext("2d"), s = Math.max(11, Math.round(cv.width / 90));
    g.save(); g.font = "600 " + s + "px Arial, sans-serif"; g.textBaseline = "alphabetic";
    const w = g.measureText(text).width + s, h = s * 1.7;
    g.fillStyle = "rgba(7,19,29,.72)"; g.fillRect(0, cv.height - h, w + s * 0.5, h);
    g.fillStyle = "#cfe3ea"; g.fillText(text, s * 0.6, cv.height - h * 0.32); g.restore();
  }
  // v165: the saved picture is drawn again offscreen at a much larger size (same view, same framing and aspect ratio), not the viewed size.
  // Long side up to 8192 px on a computer, 4096 px on a phone or a low-memory device; it steps down 8192 -> 4096 -> 2048 -> normal size when
  // the browser cannot make it. Test hooks: window.__vsMax (smaller limit), window.__vsGlMax, window.__vsFail (number of large tries to fail).
  const vsSmall = () => { try { return matchMedia("(pointer:coarse)").matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 4); } catch (_) { return false; } };
  let vsGl = 0;
  function vsGlMax() {
    if (window.__vsGlMax) return window.__vsGlMax;
    if (vsGl) return vsGl;
    let m = 4096;
    try {
      const c = document.createElement("canvas"), g = c.getContext("webgl2") || c.getContext("webgl");
      if (g) { const vp = g.getParameter(g.MAX_VIEWPORT_DIMS) || [4096, 4096]; m = Math.min(g.getParameter(g.MAX_RENDERBUFFER_SIZE), g.getParameter(g.MAX_TEXTURE_SIZE), vp[0], vp[1]); const x = g.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); }
    } catch (_) { /* keep 4096 */ }
    return (vsGl = m);
  }
  // sizes to try, biggest first, all with the same aspect ratio as the view; every size is bigger than the normal one
  function vsSizes(w, h, k, glLimit) {
    const small = vsSmall(), caps = small ? [4096, 2048] : [8192, 4096, 2048], area = small ? 16e6 : 67e6, out = [];
    for (let cap of caps) {
      cap = Math.min(cap, glLimit || 1e9, window.__vsMax || 1e9);
      let sc = cap / Math.max(w, h); sc = Math.min(sc, Math.sqrt(area / (w * h)));
      const W = Math.round(w * sc), H = Math.round(h * sc);
      if (W > w * k * 1.05 && !out.some((o) => o.W === W)) out.push({ W, H });
    }
    return out;
  }
  const vsFlat = (cv) => {   // true when the picture is one single colour (blank)
    const t = document.createElement("canvas"); t.width = 48; t.height = 32; const g = t.getContext("2d"); g.drawImage(cv, 0, 0, 48, 32);
    const d = g.getImageData(0, 0, 48, 32).data; for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false; return true;
  };
  async function vsLarge(w, h, k, glLimit, draw) {
    // returns { cv, big }; draw(W, H) gives a canvas
    let tries = 0;
    for (const s of vsSizes(w, h, k, glLimit)) {
      try {
        if (window.__vsFail && tries++ < window.__vsFail) throw new Error("forced");
        const cv = await draw(s.W, s.H);
        if (cv && cv.width === s.W && !vsFlat(cv)) return { cv, big: true };
      } catch (_) { /* next smaller size */ }
      await new Promise((r) => setTimeout(r, 20));
    }
    const cv = await draw(Math.round(w * k), Math.round(h * k));
    return { cv, big: false };
  }
  async function vsDraw2d(svg, W, H) {
    const clone = svg.cloneNode(true), live = svg.querySelectorAll("*"), copy = clone.querySelectorAll("*");
    for (let i = 0; i < live.length && i < copy.length; i++) {
      const cs = getComputedStyle(live[i]); let st = "";
      for (const p of VS_PROPS) { const v = cs.getPropertyValue(p); if (v) st += p + ":" + v + ";"; }
      copy[i].setAttribute("style", st);
    }
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", W); clone.setAttribute("height", H);
    clone.removeAttribute("class");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("The 2D map could not be drawn.")); i.src = url; });
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d"); g.fillStyle = "#07131d"; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
      return cv;
    } finally { URL.revokeObjectURL(url); }
  }
  async function vsCapture2d() {
    const svg = document.querySelector("#map-host svg"); if (!svg) return null;
    const r = svg.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null;
    return vsLarge(r.width, r.height, Math.min(2, globalThis.devicePixelRatio || 1), 0, (W, H) => vsDraw2d(svg, W, H));
  }
  async function vsCapture3d() {
    const host = document.getElementById("scene-host"), H = globalThis.dvViewHandles && dvViewHandles(), v = H && H.view3d;
    if (!host) return null;
    const r = host.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null;
    const k = Math.min(2, globalThis.devicePixelRatio || 1);
    if (v && typeof v.capture === "function") return vsLarge(r.width, r.height, k, vsGlMax(), async (W, Hh) => v.capture(W, Hh));   // WebGL: drawn again in this frame from the live camera; size and camera are restored by the viewer
    const svg = host.querySelector("svg"); if (!svg) return null;     // the SVG fallback viewer
    return vsLarge(r.width, r.height, k, 0, (W, Hh) => vsDraw2d(svg, W, Hh));
  }
  function vsDialog() {
    let d = document.getElementById("vs-dialog"); if (d) return d;
    d = document.createElement("dialog"); d.id = "vs-dialog"; d.className = "vs-dialog"; d.setAttribute("aria-label", "Save image of this view");
    d.innerHTML = '<div class="vs-head"><b>Save image of this view</b></div><div class="vs-pic"><img id="vs-img" alt="Preview of the view as it is now"></div><p class="vs-note" id="vs-note"></p><div class="vs-row"><button type="button" class="vs-go" id="vs-save">Save image</button><button type="button" class="vs-share" id="vs-share" hidden>Share</button><button type="button" class="vs-close" id="vs-close">Close</button></div><div id="vs-toast" class="share-toast" role="status" aria-live="polite"></div>';
    document.body.appendChild(d);
    d.querySelector("#vs-close").addEventListener("click", () => d.close());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    d.addEventListener("close", () => { const i = d.querySelector("#vs-img"); if (i && i.dataset.url) { URL.revokeObjectURL(i.dataset.url); i.dataset.url = ""; i.removeAttribute("src"); } window.__vsBlob = null; });
    d.querySelector("#vs-save").addEventListener("click", (e) => {
      const f = window.__vsFile; if (!f) return;
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000); window.__vsSaved = (window.__vsSaved || 0) + 1; vsToast(e.currentTarget, "Saved!");
    });
    d.querySelector("#vs-share").addEventListener("click", async (e) => {
      const f = window.__vsFile; if (!f) return;
      try { await navigator.share({ files: [f], title: "Derelict view" }); } catch (_) { /* cancelled */ }
    });
    return d;
  }
  let vsTimer = 0;
  function vsToast(anchor, text) {
    const t = document.getElementById("vs-toast"); if (!t) return;
    const r = anchor.getBoundingClientRect(); t.textContent = text; t.classList.remove("bad"); t.classList.add("show");
    const tw = t.offsetWidth || 90, th = t.offsetHeight || 30;
    t.style.left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + "px"; t.style.top = Math.max(8, r.top - th - 8) + "px";
    clearTimeout(vsTimer); vsTimer = setTimeout(() => t.classList.remove("show"), 1500);
  }
  async function vsPress(kind) {
    if (kind === "exp") { const ti = document.getElementById("expand-title"); kind = ti && /3D/i.test(ti.textContent) ? "3d" : "2d"; }
    if (window.__vsBusy) return; window.__vsBusy = true;
    const d = vsDialog(), note = d.querySelector("#vs-note"), save = d.querySelector("#vs-save"), shr = d.querySelector("#vs-share");
    try {
      const host = document.getElementById(kind === "3d" ? "scene-host" : "map-host");
      note.textContent = "Rendering..."; save.disabled = true; shr.hidden = true; window.__vsFile = null;
      await new Promise((r) => setTimeout(r, 40)); if (!d.open) d.showModal();
      await new Promise((r) => setTimeout(r, 60));   // let "Rendering..." paint before the heavy work
      let res = null, err = "";
      try { res = kind === "3d" ? await vsCapture3d() : await vsCapture2d(); } catch (e) { err = e && e.message ? e.message : "The image could not be made."; }
      if (!res || !res.cv) { note.textContent = err || "There is no picture to save yet. Wait for the view to finish drawing."; d.querySelector("#vs-img").removeAttribute("src"); return; }
      const cv = res.cv, gl = vsGlyphs(); vsCaption(cv, "NMS Derelict Atlas" + (gl ? " " + gl : "") + " " + kind.toUpperCase() + " view");
      const blob = await new Promise((r) => { try { cv.toBlob(r, "image/png"); } catch (_) { r(null); } });
      if (!blob) { note.textContent = "The image could not be made."; return; }
      const name = "derelict-" + (gl || "view").toLowerCase() + "-" + kind + ".png", file = new File([blob], name, { type: "image/png" });
      const full = { w: cv.width, h: cv.height };
      const t = document.createElement("canvas"), ts = Math.min(1, 1200 / Math.max(full.w, full.h)); t.width = Math.max(1, Math.round(full.w * ts)); t.height = Math.max(1, Math.round(full.h * ts));
      t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height); cv.width = cv.height = 0;   // free the big canvas
      const tb = await new Promise((r) => t.toBlob(r, "image/png"));
      window.__vsFile = file; window.__vsMeta = { kind, w: full.w, h: full.h, name, big: res.big };
      const img = d.querySelector("#vs-img"); if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      img.dataset.url = URL.createObjectURL(tb || blob); img.src = img.dataset.url;
      note.textContent = (res.big ? "" : "Could not make a large image, saved at normal size. ") + "Saves at " + full.w + " x " + full.h + " px. File: " + name;
      save.disabled = false;
      let can = false; try { can = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) { /* no file sharing */ }
      shr.hidden = !can;
    } finally { window.__vsBusy = false; }
  }
  document.addEventListener("click", (e) => { const b = e.target instanceof Element && e.target.closest(".vs-save"); if (b) { e.preventDefault(); vsPress(b.dataset.vsKind); } });
  function watch() {
    ensureSave();
    const content = document.getElementById("viewer-content"), st = document.getElementById("atlas-status"), results = document.getElementById("results");
    if (content) new MutationObserver(() => { mountOpenIn(); moveSpacing(); stripRow(); ensureSave(); }).observe(content, { childList: true });
    window.addEventListener("hashchange", () => { mountOpenIn(); });
    if (st) new MutationObserver(syncStatus).observe(st, { childList: true, characterData: true, subtree: true });
    if (results) new MutationObserver(syncStatus).observe(results, { attributes: true, attributeFilter: ["aria-busy"], childList: true });
    if (results) new MutationObserver(syncRanks).observe(results, { childList: true, subtree: true });
    const sortSel = document.getElementById("sort");
    if (sortSel) sortSel.addEventListener("change", syncRanks);
    document.addEventListener("click", (e) => { if (e.target instanceof Element && e.target.closest("#toggle-quick")) setTimeout(fitQuickRun, 0); });
    window.addEventListener("resize", fitQuickRun);
    // v161: "Navigate to derelict" on a system page: Near me, Heading there, this system as the target (nothing is sent anywhere)
    document.addEventListener("click", (e) => {
      const b = e.target instanceof Element && e.target.closest("#viewer-navigate");
      if (!b) return;
      const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash);
      if (m && globalThis.dvNear && dvNear.navigateTo) dvNear.navigateTo(m[1].toUpperCase());
    });
    document.addEventListener("click", (e) => {   // v163: the X on a system page goes to the main menu (same as unselecting the card; Back returns to the system)
      if (!(e.target instanceof Element) || !e.target.closest("#viewer-close")) return;
      e.preventDefault();
      const logo = document.querySelector("a.brand");   // the logo already opens the main menu (on a phone it also switches to the Viewer tab, where the home cards are)
      if (logo) logo.click(); else location.hash = "#/";
    });
    mountOpenIn(); stripRow();
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
