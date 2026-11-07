/* site-guide.js: the photo guide (user 2026-11-06). Five steps on the main path, one zoomed picture each, plus a "More topics"
 * screen: the visitor clicks only a topic they want. window.dvOpenGuide() opens it; the tour (site-tour.js) offers
 * window.dvStartTour(): when it exists the guide shows "Show me on the page". Pictures in guide/ are crops of the public
 * site taken with the game files blocked (no game artwork), see publish.py. A -m picture is used on phones. */
(function () {
  "use strict";
  const STEPS = [
    { id: "find", t: "Find a good system", p: "The list starts with the most Salvaged Frigate Modules. Use the sort menu for Best overall, loot value or nanites, or search a name, glyphs or address.<span class=\"dvg-ph\"> On a phone, Systems (left) is this list and Viewer (right) shows the open system.</span>", alt: "The Systems list with the sort menu highlighted", m: 1 },
    { id: "numbers", t: "Read the numbers", p: "Total counts every container. The gold number is the predicted Salvaged Frigate Modules; ? means unsure. The end reward stays hidden until you click it.", alt: "The system summary: total containers, the predicted modules in a gold ring, and the hidden end reward", m: 1 },
    { id: "maps", t: "Explore the maps", p: "The 3D view and the 2D floor map show every deck. Drag or pinch, tap a ladder to follow it, and use the expand buttons for a bigger view.", alt: "The 3D view and the 2D floor map with the expand buttons highlighted", m: 1 },
    { id: "glyphs", t: "Get there in the game", p: "Enter the twelve glyphs at a portal. Copy takes the address, and the NMS Almanac and NMS Hub links open it on outside maps.", alt: "The twelve portal glyphs of a system with the Copy button highlighted", m: 1 },
    { id: "done", t: "Mark it done", p: "Finished Run greys the system out in the list; press it again to undo. Filters, then Hide done systems, hides finished ones.", alt: "The Finished Run button highlighted in the row of system buttons", m: 1 },
  ];
  const TOPICS = [
    { id: "filters", t: "Filters", p: "Narrow the list by map list, derelict type, end reward, rooms, decks and container counts. Hide done systems is in there too.", alt: "The Filters window with its fields" },
    { id: "top", t: "Top lists", p: "The home screen ranks the best systems: most modules, nanites, loot value and SpookBox packages, and the worst of the worst.", alt: "Home screen top lists with the three best systems in each" },
    { id: "quick", t: "Quick Run and loot", p: "The loot bar shows the loot value in Units and nanites. Quick Run plans a route through the loot and draws it on both maps.", alt: "Quick Run highlighted, with its route drawn on the maps" },
    { id: "search", t: "Search any system", p: "Search names, glyphs or a hex address. A system the atlas does not have yet is scanned on your device in a few seconds.", alt: "The search box above the Systems list" },
    { id: "near", t: "Near me", p: "Near me finds a derelict close to where you are in the game. Enter your glyphs, address or signal booster, say what you want, and check in after each jump to see the distance left.", alt: "The Near me window with its Where are you and What do you want boxes", m: 1 },
    { id: "share", t: "Photo and share", p: "Photo & Share makes a picture or a banner of the system to save or send. You choose whether it shows the end reward.", alt: "The Photo and share window with Photo and Banner options" },
    { id: "report", t: "Report a wrong system", p: "Report this system, tick what looks wrong and send. No account needed. Reports are public on GitHub, so keep personal details out.", alt: "The Report this system window with its checkboxes" },
    { id: "uploads", t: "Contribute and uploads", p: "Contribute! scans new systems in your browser. Your uploads shows how many are in the atlas, waiting or missing, plus your upload log.", alt: "The Your uploads panel on the Contribute page" },
    { id: "info", t: "Information and statistics", p: "The i button has how to use the viewer, how scanning works, atlas statistics, credits and privacy.", alt: "The Information window with its tabs" },
  ];
  let root = null, mode = "step", idx = 0, topic = null, opener = null, mq = null;
  const tourOk = () => typeof window.dvStartTour === "function";
  // "Show me on the page": only where this page's own item exists on the site (the tour knows the selectors)
  const canShow = (o) => tourOk() && typeof window.dvTourCan === "function" && window.dvTourCan(o.id);
  const showBtn = (o) => canShow(o) ? `<button type="button" class="dvg-btn gold" data-g="show" aria-label="Show me on the page"><span class="dvg-full">Show me on the page</span><span class="dvg-short" aria-hidden="true">On the page</span></button>` : "";
  const src = (o) => `guide/${o.id}.webp`;
  const pic = (o) => `<picture>${o.m ? `<source media="(max-width: 700px)" srcset="guide/${o.id}-m.webp">` : ""}<img src="${src(o)}" alt="${o.alt}" decoding="async"></picture>`;

  function head(title, extra, short) {
    return `<div class="dvg-head"><span class="dvg-kicker"><span class="dvg-full">${title}</span><span class="dvg-short">${short || title}</span></span><span class="dvg-grow"></span>${extra || ""}<button type="button" class="dvg-x" data-g="close" aria-label="Close the guide">×</button></div>`;
  }
  function render() {
    let html;
    if (mode === "step") {
      const s = STEPS[idx], last = idx === STEPS.length - 1;
      html = head(`Guide · ${idx + 1} of ${STEPS.length}`, `${showBtn(s)}<button type="button" class="dvg-btn" data-g="more" aria-label="More topics"><span class="dvg-full">More topics</span><span class="dvg-short" aria-hidden="true">More</span></button>`, `${idx + 1} of ${STEPS.length}`)
        + `<div class="dvg-body"><figure class="dvg-fig">${pic(s)}</figure><div class="dvg-text"><h2 id="dvg-title" tabindex="-1">${s.t}</h2><p>${s.p}</p></div></div>
<div class="dvg-nav"><button type="button" class="dvg-btn" data-g="back" ${idx ? "" : "disabled"}>← Back</button>
<div class="dvg-dots" role="group" aria-label="Steps">${STEPS.map((x, i) => `<button type="button" data-g="go" data-i="${i}" aria-label="Step ${i + 1}: ${x.t}"${i === idx ? ' aria-current="step" class="on"' : ""}></button>`).join("")}</div>
<button type="button" class="dvg-btn primary" data-g="${last ? "close" : "next"}">${last ? "Done" : "Next →"}</button></div>`;
    } else if (mode === "more") {
      html = head("More topics") + `<div class="dvg-text"><h2 id="dvg-title" tabindex="-1">Pick what you want to see</h2></div>
<div class="dvg-topics">${TOPICS.map((x, i) => `<button type="button" data-g="topic" data-i="${i}"><b>${x.t}</b><small>${x.p.split(/(?<=[.?])\s/)[0]}</small></button>`).join("")}</div>
<div class="dvg-nav"><button type="button" class="dvg-btn" data-g="steps">← The five steps</button><span class="dvg-grow"></span><button type="button" class="dvg-btn primary" data-g="close">Close</button></div>`;
    } else {
      const x = TOPICS[topic];
      html = head(`More · ${x.t}`, showBtn(x), x.t) + `<div class="dvg-body"><figure class="dvg-fig">${pic(x)}</figure><div class="dvg-text"><h2 id="dvg-title" tabindex="-1">${x.t}</h2><p>${x.p}</p></div></div>
<div class="dvg-nav"><button type="button" class="dvg-btn primary" data-g="more">← More topics</button><span class="dvg-grow"></span><button type="button" class="dvg-btn" data-g="close">Close</button></div>`;
    }
    root.querySelector(".dvg-card").innerHTML = html;
    const t = root.querySelector("#dvg-title");
    root.querySelector(".dvg-card").setAttribute("aria-labelledby", "dvg-title");
    if (t) t.focus({ preventScroll: true });
    // the next picture loads in the background
    const nx = mode === "step" && STEPS[idx + 1];
    if (nx) { const im = new Image(); im.src = (matchMedia("(max-width: 700px)").matches && nx.m) ? `guide/${nx.id}-m.webp` : src(nx); }
  }
  function open(at) {
    if (root) return;
    opener = document.activeElement;
    mode = "step"; idx = 0;
    // a way back from "Show me on the page": the same page again
    if (at && at.mode === "step" && at.idx >= 0 && at.idx < STEPS.length) idx = at.idx;
    else if (at && at.mode === "topic" && TOPICS[at.topic]) { mode = "topic"; topic = at.topic; }
    else if (at && at.mode === "more") mode = "more";
    root = document.createElement("div");
    root.className = "dvg";
    root.innerHTML = `<div class="dvg-card" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(root);
    document.documentElement.classList.add("dvg-open");
    render();
  }
  function close() {
    if (!root) return;
    root.remove(); root = null;
    document.documentElement.classList.remove("dvg-open");
    document.dispatchEvent(new CustomEvent("dv-guide-closed"));
    if (opener && opener.focus && document.contains(opener)) opener.focus();
    // closing marks the guide as seen, which hides the header cap: move focus to the visible one instead
    if (document.activeElement === document.body || !document.activeElement) { const alt = [...document.querySelectorAll("[data-tutorial]")].find((e) => e.getClientRects().length); if (alt) alt.focus(); }
    opener = null;
  }
  document.addEventListener("click", (e) => {
    if (!root || !(e.target instanceof Element)) return;
    if (e.target === root) { close(); return; }
    const b = e.target.closest("[data-g]");
    if (!b || !root.contains(b)) return;
    const g = b.dataset.g, i = Number(b.dataset.i);
    if (g === "close") close();
    else if (g === "show") {
      const o = mode === "step" ? STEPS[idx] : mode === "topic" ? TOPICS[topic] : null;
      if (!o) return;
      const back = mode === "step" ? { mode, idx } : { mode, topic }, text = o.p.replace(/<[^>]*>/g, "").split(/(?<=[.?])\s/)[0];
      close(); if (canShow(o)) window.dvStartTour({ show: o.id, title: o.t, text, back });
    }
    else if (g === "next") { idx = Math.min(STEPS.length - 1, idx + 1); render(); }
    else if (g === "back") { idx = Math.max(0, idx - 1); render(); }
    else if (g === "go") { idx = i; render(); }
    else if (g === "more") { mode = "more"; render(); }
    else if (g === "steps") { mode = "step"; render(); }
    else if (g === "topic") { topic = i; mode = "topic"; render(); }
  });
  document.addEventListener("keydown", (e) => {
    if (!root) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "ArrowRight" && mode === "step") { if (idx < STEPS.length - 1) { idx++; render(); } }
    else if (e.key === "ArrowLeft") { if (mode === "step") { if (idx) { idx--; render(); } } else if (mode === "topic") { mode = "more"; render(); } else if (mode === "more") { mode = "step"; render(); } }
    else if (e.key === "Tab") {   // keep focus inside the guide
      const f = [...root.querySelectorAll("button:not([disabled])")];
      if (!f.length) return;
      const a = document.activeElement;
      if (e.shiftKey && (a === f[0] || !root.contains(a) || a.id === "dvg-title")) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (a === f[f.length - 1] || !root.contains(a))) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
  window.dvOpenGuide = open;
})();
