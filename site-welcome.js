/* site-welcome.js (SITE integration, user 2026-10-31): on the first visit a welcome window takes the place of the empty
 * system viewer. It explains what the Derelict Atlas is and how it is scanned, step by step, and ends by pointing at the
 * header's ⓘ information, Contribute! and coffee buttons. Seen = localStorage dv.welcome.v1 (finish or skip). The ⓘ
 * dialog's About section gets a "Show the welcome again" button. On phones the Viewer tab opens for it. */
(function () {
  "use strict";
  const KEY = "dv.welcome.v1";
  const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return false; } };
  const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch (_) {} };
  const $ = (id) => document.getElementById(id);
  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const count = () => { const t = ($("system-count") || {}).textContent || ""; return /\d/.test(t) ? t.trim() : "hundreds of thousands of"; };

  const STEPS = [
    () => ({ art: "module", eyebrow: "WELCOME, TRAVELLER", title: "The Derelict Atlas", shot: ["welcome/atlas.webp", "The Systems list and a derelict opened in the viewer"],
      body: `<p>A map of the abandoned freighters of No Man’s Sky. For <b>${count()}</b> systems you can see every deck, room and container of the derelict before you jump in, with the predicted Salvaged Frigate Modules, end reward and loot value.</p>`
        + `<p>Find the derelict worth your time, then fly there with its glyphs.</p>` }),
    () => ({ art: icon("M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"),
      eyebrow: "HOW IT IS SCANNED", title: "Built from the game’s own rules", shot: ["welcome/layout.webp", "Every deck, room and container of the freighter, in 3D"],
      body: `<p>Nobody has to visit these systems. The atlas scanner runs the game’s own derelict generation from the system address alone and rebuilds the freighter: the same layout, the same containers and the same loot tables as in the game (NMS 7.10).</p>`
        + `<p>Community PCs scan whole regions and publish them here, a few hundred systems a minute.</p>` }),
    () => ({ art: icon("M4 5h16v11H4Z M8 20h8 M12 16v4 M9 9l2 2 4-4"),
      eyebrow: "ON YOUR DEVICE", title: "Your browser scans too", shot: ["welcome/scan.webp", "A system scanned in the browser, step by step"],
      body: `<p>The same scanner runs right in this page. Open any system and your phone or PC draws its 3D and 2D map and calculates its loot in a few seconds. Search a glyph address that is not in the atlas yet and it is scanned on the spot.</p>`
        + `<p>To save space the atlas keeps every number of a system, but maps only for the top-100 lists; your device draws the rest.</p>` }),
    () => ({ art: icon("M12 2l2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 16.6 6.1 20l1.4-6.6-5-4.5 6.6-.7Z"),
      eyebrow: "FIND THE BEST", title: "Sort, filter, plan", shot: ["welcome/plan.webp", "All decks in 2D: every container, ladder and room"],
      body: `<p>Sort the Systems list by Salvaged Frigate Modules, <b>Best overall #1 #2 #3</b>, loot value or nanites, filter by end reward, and browse the top-100 lists. In a system, <b>Quick Run</b> plans a route through the loot and <b>Show End Reward</b> tells you what waits at the end.</p>` }),
    () => ({ art: icon("M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"), eyebrow: "WHERE TO NEXT", title: "Up there, at the top",
      body: `<div class="site-welcome-tiles">
<button type="button" class="site-welcome-tile" data-go="info"><span class="tile-icon">ⓘ</span><b>Information</b><small>How to read the viewer, what the numbers mean, credits.</small></button>
<button type="button" class="site-welcome-tile gold" data-go="contribute"><span class="tile-icon">◎</span><b>Contribute!</b><small>Scan systems for the atlas with any device. Help it reach a million.</small></button>
<button type="button" class="site-welcome-tile" data-go="coffee"><span class="tile-icon">☕</span><b>Buy me a coffee</b><small>Enjoy the Atlas? A coffee keeps it free, ad-free and the scanners running.</small></button>
</div>`, spot: true }),
  ];

  let box = null, step = 0;
  function spots(on) {
    for (const el of [$("info-button"), $("contribute-link"), document.querySelector(".coffee-slot > :not([hidden])")])
      if (el) el.classList.toggle("site-welcome-spot", on);
  }
  function render() {
    const s = STEPS[step](), last = step === STEPS.length - 1;
    const art = s.art === "module" ? `<img src="brand/logo-256.webp" alt="">` : s.art;
    box.innerHTML = `<div class="site-welcome-card" role="dialog" aria-modal="false" aria-labelledby="site-welcome-title">
<button type="button" class="site-welcome-x" data-act="skip" aria-label="Close the welcome" title="Close">×</button>
${s.shot ? `<figure class="site-welcome-shot"><img src="${s.shot[0]}" alt="${s.shot[1]}" width="1200" height="675" decoding="async" onerror="this.closest('figure').remove()"><figcaption>${s.shot[1]}</figcaption></figure>`
  : `<div class="site-welcome-art" aria-hidden="true"><span class="orbit"></span>${art}</div>`}
<div class="eyebrow">${s.eyebrow}</div>
<h2 id="site-welcome-title">${s.title}</h2>
<div class="site-welcome-body">${s.body}</div>
<div class="site-welcome-nav">
  ${step ? `<button type="button" data-act="back">← Back</button>` : `<button type="button" class="quiet" data-act="skip">Skip</button>`}
  <span class="site-welcome-dots" aria-label="Step ${step + 1} of ${STEPS.length}">${STEPS.map((_, i) => `<i${i === step ? ' class="on"' : ""}></i>`).join("")}</span>
  <button type="button" class="primary" data-act="${last ? "done" : "next"}">${last ? "Start exploring" : "Next →"}</button>
</div></div>`;
    spots(Boolean(s.spot));
    // the next step's screenshot loads in the background
    const nx = STEPS[step + 1] && STEPS[step + 1]();
    if (nx && nx.shot) { const im = new Image(); im.src = nx.shot[0]; }
    const focus = box.querySelector(`[data-act="${last ? "done" : "next"}"]`);
    if (focus && box.contains(document.activeElement)) focus.focus();
  }
  function close(markAsSeen) {
    if (markAsSeen) markSeen();
    spots(false);
    if (box) { box.remove(); box = null; }
    const viewer = $("viewer");
    if (viewer) viewer.classList.remove("site-welcome-on");
    const empty = $("viewer-empty"), content = $("viewer-content");
    if (empty && content && content.hidden) empty.hidden = false;
  }
  let tabTouched = false, navWatch = null;
  document.addEventListener("pointerdown", (e) => { if (e.target instanceof Element && e.target.closest(".bottom-nav")) tabTouched = true; }, true);
  function showViewerTab() {
    const nav = $("nav-viewer");
    if (box && !tabTouched && nav && getComputedStyle(nav.parentElement).display !== "none" && !nav.classList.contains("active")) nav.click();
  }
  function open(force) {
    const viewer = $("viewer"), content = $("viewer-content"), empty = $("viewer-empty");
    if (!viewer || box) return;
    if (!force && (seen() || /^#\/d\//.test(location.hash))) return;
    step = 0;
    box = document.createElement("div");
    box.id = "site-welcome";
    box.className = "site-welcome";
    viewer.prepend(box);
    viewer.classList.add("site-welcome-on");   // covers the system the viewer opens by itself
    if (empty) empty.hidden = true;
    render();
    // phones: the viewer is a tab; show it for the welcome. The app picks the Systems tab when the atlas is in, so the
    // Viewer tab follows any tab change the visitor did not make while the welcome is open
    showViewerTab();
    const navBar = document.querySelector(".bottom-nav");
    if (navBar && !navWatch) { navWatch = new MutationObserver(() => setTimeout(showViewerTab, 0)); navWatch.observe(navBar, { attributes: true, subtree: true, attributeFilter: ["class"] }); }
  }
  globalThis.dvShowWelcome = () => { if (box) { step = 0; render(); } else open(true); };
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-act], [data-go], #site-welcome-again") : null;
    if (!t) return;
    if (t.id === "site-welcome-again") { const d = t.closest("dialog"); if (d && d.open) d.close(); globalThis.dvShowWelcome(); return; }
    if (!box || !box.contains(t)) return;
    const act = t.dataset.act, go = t.dataset.go;
    if (act === "next") { step = Math.min(STEPS.length - 1, step + 1); render(); }
    else if (act === "back") { step = Math.max(0, step - 1); render(); }
    else if (act === "skip" || act === "done") {
      close(true);
      const nav = $("nav-systems");   // phones: on to the Systems list
      if (act === "done" && nav && getComputedStyle(nav.parentElement).display !== "none") nav.click();
    } else if (go) {
      // the welcome stays open: only ×, Skip and Start exploring close it (user 2026-10-31)
      if (go === "info") ($("info-button") || {}).click?.();
      else if (go === "contribute") location.href = "contribute.html";
      else if (go === "coffee") { const c = $("support-link"); if (c && !c.hidden && c.href) window.open(c.href, "_blank", "noopener"); else ($("info-button") || {}).click?.(); }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!box || !box.contains(document.activeElement)) return;
    if (e.key === "ArrowRight") box.querySelector('[data-act="next"]')?.click();
    else if (e.key === "ArrowLeft") box.querySelector('[data-act="back"]:not([hidden])')?.click();
    else if (e.key === "Escape") box.querySelector('[data-act="skip"]')?.click();
  });
  // the visitor opens a system (#/d/...): the welcome steps aside; back on #/ it returns until finished or skipped
  function watch() {
    const sc = $("system-count");
    if (sc) new MutationObserver(() => { if (box && step === 0) render(); }).observe(sc, { childList: true, characterData: true, subtree: true });
    // a system opened from the list must be visible: the welcome steps aside (not marked as seen) and returns on #/
    addEventListener("hashchange", () => { if (/^#\/d\//.test(location.hash)) { if (box) close(false); } else if (!seen()) open(false); });
    (window.dvGateReady || Promise.resolve()).then(() => setTimeout(() => open(false), 0));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})();
