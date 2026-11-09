/* site-tour.js: interactive spotlight tour (owned by the tour build).
 * window.dvStartTour() starts it. Plain JS, no libraries. Never changes user data: the highlighted hole is
 * shielded (clicks swallowed) except on the "open a system" step, where the click is the step's click. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const MAIN = [
    { tab: "systems", sel: ["#search", "#sort-control"], union: true, title: "Find a system",
      text: "The list is sorted best first. Above it you can change the order, or search by name, portal glyphs or hex address, once the tour is done." },
    { tab: "systems", sel: ["#results .system-card"], click: true, wait: true, title: "Open one",
      text: "Tap a system to open it. That tap is your click for this step." },
    { tab: "viewer", sel: ["#view-summary"], wait: true, title: "Read the numbers",
      text: "Totals count every container. ? means uncertain, a dash means unknown, + means at least this many." },
    { tab: "viewer", sel: ["#scene-host", "#map-host"], union: true, apart: true, free: true, wait: true, title: "Explore the maps",
      text: "Try it now: drag to turn the 3D map, scroll or pinch to zoom. The 2D map shows every deck; tap a ladder to follow it. Press Next when you are done." },
    { tab: "viewer", sel: [".identity-strip .glyphs", ".viewer-control-row"], union: true, apart: true, choice: true, title: "Get there, mark it done",
      text: "Enter these portal glyphs in the game to get there. Finished Run greys the system out in your list; press it yourself once the tour is done." },
  ];
  // phone layouts (bottom bar showing): step 1 explains the two tabs, step 2 merges "Find a system" and "Open one"; still 5 clicks
  const MAIN_PHONE = [
    { tab: "systems", sel: [".bottom-nav"], title: "Two tabs",
      text: "Systems is the list of derelicts. Viewer shows the open system's numbers and maps." },
    { tab: "systems", sel: ["#results .system-card"], click: true, wait: true, title: "Find and open one",
      text: "The list is sorted best first; search and sort are above it. Tap a system to open it. That tap is your click for this step." },
    MAIN[2], MAIN[3], MAIN[4],
  ];
  let MAINL = MAIN;
  const MORE = [
    { tab: "systems", sel: [".filter-toolbar"], title: "Filters",
      text: "Filters narrow the list: maps only, end reward, room and deck limits, minimum crates, hide done." },
    { tab: "systems", sel: ["#near-main"], title: "Near me",
      text: "Near me finds a derelict close to where you are in the game, then tracks the distance as you jump. Open it yourself once the tour is done." },
    { tab: "viewer", sel: [".viewer-controls"], title: "Map tools",
      text: "Quick Run plans a route through the loot. Layers and Deck spacing change what the maps show." },
    { tab: "viewer", sel: ["#details-open", "#share-open", ".site-report"], union: true, apart: true, title: "Details, photo, reports",
      alt: { sel: ["#details-open", "#share-open"], text: "System details and Photo & Share sit here. Report is the flag under Copy, near the top. A report is published on GitHub, so keep personal details out." },
      text: "System details, Photo & Share and Report sit here. A report is published on GitHub, so keep personal details out." },
    { tab: null, sel: [".site-goal-bar", "#contribute-link"], union: true, title: "Atlas and Contribute",
      text: "The counter shows how many systems the atlas holds. Contribute! scans new ones on your device; results are checked and added about every hour." },
    { tab: null, sel: [".si-tabs"], dialog: true, last: true, title: "Information",
      text: "The Information button holds the overview, viewer help, scanning, statistics, About and Privacy." },
  ];

  // "Show me on the page" (user 2026-11-07): one spotlight step for a photo-guide page, same spotlight as the tour.
  // sys: needs a system open (the tour's own "open one" setup opens the first in the list; end() puts the old one back).
  // home: needs the home screen. A page with none of its elements on the site gets no button (dvTourCan).
  const SHOW = {
    find: { tab: "systems", sel: ["#search", "#sort-control"], union: true },
    numbers: { tab: "viewer", sel: ["#view-summary"], sys: true },
    maps: { tab: "viewer", sel: ["#scene-host", "#map-host"], union: true, apart: true, free: true, sys: true },
    glyphs: { tab: "viewer", sel: [".identity-strip"], sys: true },
    done: { tab: "viewer", sel: ["#viewer-done"], sys: true },
    filters: { tab: "systems", sel: [".filter-toolbar"] },
    top: { tab: "viewer", sel: [".sh-trivia", ".sh-big4", ".sh-small12"], union: true, home: true },
    quick: { tab: "viewer", sel: [".viewer-controls"], sys: true },
    search: { tab: "systems", sel: ["#search"] },
    near: { tab: "systems", sel: ["#near-main"] },
    share: { tab: "viewer", sel: ["#share-open"], sys: true },
    report: { tab: "viewer", sel: [".site-report"], sys: true },
    uploads: { tab: null, sel: [".site-goal-bar", "#contribute-link"], union: true },
    info: { tab: null, sel: ["#info-button"] },
  };
  // no tab = always on screen, so it must be visible now (the header buttons hide on some phones); a tab step only has to exist (the tab is switched)
  window.dvTourCan = (id) => { const sp = SHOW[id]; return !!sp && (sp.sel.some((q) => (sp.tab ? !!$(q) : vis($(q)))) || (!!sp.sys && !!$("#results .system-card"))); };

  let S = null;

  function allSteps() { return S && S.showStep ? [S.showStep] : MAINL.concat(MORE); }

  function end(withGuide) {
    if (!S) return;
    const s = S; S = null;
    clearInterval(s.timer);
    window.removeEventListener("resize", s.onResize);
    window.removeEventListener("scroll", s.onScroll, true);
    document.removeEventListener("click", freeBlock, true);
    window.removeEventListener("keydown", s.onKey, true);
    if (s.clickEl) s.clickEl.removeEventListener("click", s.onClick, true);
    if (s.root) s.root.remove();
    const d = $("#info-dialog");
    if (s.opened && d && d.open) { try { d.close(); } catch (e) {} }
    try {
      const nav = $("#nav-" + s.origTab);
      if (s.origTab && nav && vis(nav) && !nav.classList.contains("active")) nav.click();
      if (location.hash !== s.origHash) location.hash = s.origHash;
      const res = $("#results"); if (res) res.scrollTop = s.resScroll;
      window.scrollTo(s.sx, s.sy);
    } catch (e) {}
    const rs = () => { try { if (s.sel0 === null) localStorage.removeItem(s.selKey); else localStorage.setItem(s.selKey, s.sel0); } catch (e) {} };
    rs(); setTimeout(rs, 400);
    try { if (s.prevFocus && document.contains(s.prevFocus)) s.prevFocus.focus({ preventScroll: true }); } catch (e) {}
    // Done closes everything. The guide opens only from the "Photo guide" button (withGuide === "guide"), once the restore above has settled.
    if (withGuide === "guide" && typeof window.dvOpenGuide === "function") setTimeout(() => { try { window.dvOpenGuide(s.back); } catch (e) {} }, 250);
    // the header cap hides once the tour has started (seen): focus a visible tutorial button instead
    const fixFocus = () => { try { const ae = document.activeElement; if (!ae || ae === document.body || !ae.getClientRects().length || (s.opened && ae !== s.prevFocus)) { const alt = [...document.querySelectorAll("[data-tutorial]")].find((e) => e.getClientRects().length); if (alt) alt.focus({ preventScroll: true }); } } catch (e) {} };
    fixFocus(); if (s.opened) setTimeout(() => { if (!S) fixFocus(); }, 150);   // closing the Information window restores focus a moment later
  }

  function build() {
    const root = document.createElement("div");
    root.id = "dvt-root";
    root.innerHTML = '<div class="dvt-b" data-b="t"></div><div class="dvt-b" data-b="b"></div><div class="dvt-b" data-b="l"></div><div class="dvt-b" data-b="r"></div>' +
      '<div class="dvt-dim"></div><div class="dvt-shield"></div><div class="dvt-hole"></div>' +
      '<div class="dvt-pop" role="dialog" aria-label="Tour" tabindex="-1"><div class="dvt-count"></div><h3 class="dvt-title"></h3><p class="dvt-text"></p>' +
      '<div class="dvt-btns"><button type="button" class="dvt-skip">Skip</button><span class="dvt-gap"></span><button type="button" class="dvt-back">Back</button>' +
      '<button type="button" class="dvt-next dvt-primary">Next</button></div></div>';
    return root;
  }

  async function ensureTab(tab) {
    if (!tab) return;
    const nav = $("#nav-" + tab);
    if (nav && vis(nav) && !nav.classList.contains("active")) { nav.click(); await sleep(120); }
  }

  function find(st, alt) {
    const els = (alt && st.alt ? st.alt.sel : st.sel).map((q) => $(q)).filter(vis);
    if (!els.length) return [];
    return st.union ? els : [els[0]];
  }

  // viewport-clipped, padded rectangle around the elements; a huge union falls back to the first element
  function rectOf(els) {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const box = (list) => {
      let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
      list.forEach((e) => { const q = e.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
      return { l: Math.max(4, l - 6), t: Math.max(4, t - 6), r: Math.min(vw - 4, r + 6), b: Math.min(vh - 4, b + 6) };
    };
    let q = box(els);
    if (els.length > 1 && (q.r - q.l) * (q.b - q.t) > 0.7 * vw * vh) q = box([els[0]]);
    return q;
  }

  // one padded box per element; boxes closer than 24px merge (so adjacent parts stay one hole)
  function holesOf(els) {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    let list = els.map((e) => { const q = e.getBoundingClientRect(); return { l: Math.max(4, q.left - 6), t: Math.max(4, q.top - 6), r: Math.min(vw - 4, q.right + 6), b: Math.min(vh - 4, q.bottom + 6) }; });
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < list.length && !again; i++) for (let k = i + 1; k < list.length && !again; k++) {
        const a = list[i], b = list[k];
        if ((a.l - 24 < b.r && b.l - 24 < a.r && a.t - 24 < b.b && b.t - 24 < a.b) || (a.t < b.b && b.t < a.b)) {
          list.splice(k, 1); list[i] = { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) }; again = true;
        }
      }
    }
    return list.sort((a, b) => a.t - b.t);
  }

  function bottomLimit() {
    const nav = $(".bottom-nav"), vh = document.documentElement.clientHeight;
    return nav && vis(nav) ? Math.min(vh, nav.getBoundingClientRect().top) : vh;
  }
  function roomOutside(Q, pw, ph) {
    const vw = document.documentElement.clientWidth, m = 8, g = 12, lim = bottomLimit();
    return Q.t - m - g >= ph || lim - m - g - Q.b >= ph || Q.l - m - g >= pw || vw - m - g - Q.r >= pw;
  }

  // the nearest scrolling ancestor (or the page)
  function scroller(e) {
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  function place(s) {
    if (!S || S !== s || !s.els) return;
    if (s.host && s.root.parentNode !== s.host && document.contains(s.host)) s.host.appendChild(s.root);
    const root = s.root, pop = $(".dvt-pop", root), hole = $(".dvt-hole", root), sh = $(".dvt-shield", root);
    const base = root.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const bounds = (l) => ({ l: Math.min(...l.map((r) => r.l)), t: Math.min(...l.map((r) => r.t)), r: Math.max(...l.map((r) => r.r)), b: Math.max(...l.map((r) => r.b)) });
    let holes;
    if (s.step.apart) { const hs = holesOf(s.els); holes = hs.length > 1 && !roomOutside(bounds(hs), pw, ph) ? hs : [bounds(hs)]; }
    else holes = [rectOf(s.els)];
    const multi = holes.length > 1;
    const q = holes[0], w = Math.max(0, q.r - q.l), h = Math.max(0, q.b - q.t);
    const Q = bounds(holes);
    s.rect = q;
    root.classList.toggle("dvt-multi", multi);
    root.querySelectorAll(".dvt-hx, .dvt-bx, .dvt-sx").forEach((e) => e.remove());
    const dim = $(".dvt-dim", root);
    const box = (r) => `left:${r.l - base.left}px;top:${r.t - base.top}px;width:${Math.max(0, r.r - r.l)}px;height:${Math.max(0, r.b - r.t)}px`;
    const extra = (cls, css) => { const d = document.createElement("div"); d.className = cls; d.style.cssText = css; root.insertBefore(d, pop); };
    hole.style.cssText = box(q);
    const set = (k, css) => { $(`.dvt-b[data-b=${k}]`, root).style.cssText = css; };
    const L = q.l - base.left, T = q.t - base.top;
    if (multi) {
      // separate holes (stacked bands): one dim layer with the holes cut out; click blockers fill the space around and between them
      holes.slice(1).forEach((r) => extra("dvt-hole dvt-hx", box(r)));
      dim.style.clipPath = 'path(evenodd, "M0 0H' + base.width + "V" + base.height + "H0Z" + holes.map((r) => { const l = r.l - base.left, t = r.t - base.top, rr = r.r - base.left, b = r.b - base.top; return `M${l} ${t}H${rr}V${b}H${l}Z`; }).join("") + '")';
      ["t", "b", "l", "r"].forEach((k) => set(k, "display:none"));
      let y = 0;
      const blk = (l, t, w2, h2) => { if (w2 > 0 && h2 > 0) extra("dvt-b dvt-bx", `left:${l}px;top:${t}px;width:${w2}px;height:${h2}px`); };
      holes.forEach((r) => { const l = r.l - base.left, t = r.t - base.top, rr = r.r - base.left, b = r.b - base.top; blk(0, y, base.width, t - y); blk(0, t, l, b - t); blk(rr, t, base.width - rr, b - t); y = b; });
      blk(0, y, base.width, base.height - y);
      if (s.step.click || s.step.free) sh.style.cssText = "display:none";
      else { sh.style.cssText = box(q); holes.slice(1).forEach((r) => extra("dvt-shield dvt-sx", box(r))); }
    } else {
      dim.style.clipPath = "";
      sh.style.cssText = (s.step.click || s.step.free) ? "display:none" : box(q);
      set("t", `left:0;top:0;right:0;height:${Math.max(0, T)}px`);
      set("b", `left:0;bottom:0;right:0;top:${T + h}px`);
      set("l", `left:0;top:${T}px;width:${Math.max(0, L)}px;height:${h}px`);
      set("r", `left:${L + w}px;top:${T}px;right:0;height:${h}px`);
    }
    const m = 8, g = 12;
    const cl = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    const Qw = Q.r - Q.l, Qh = Q.b - Q.t;
    const cx = cl(Q.l + Qw / 2 - pw / 2, m, vw - pw - m), cy = cl(Q.t + Qh / 2 - ph / 2, m, vh - ph - m);
    const list = [[cx, Q.b + g], [cx, Q.t - g - ph], [Q.r + g, cy], [Q.l - g - pw, cy], [cx, vh - ph - m], [cx, m]];
    if (multi) holes.forEach((r) => { list.push([cx, r.b + g], [cx, r.t - g - ph]); });
    const cands = list.map(([x, y]) => [cl(x, m, vw - pw - m), cl(y, m, vh - ph - m)]);
    let best = null, bo = 1e12;
    cands.forEach(([x, y]) => {
      let o = 0;
      holes.forEach((r) => { o += Math.max(0, Math.min(x + pw, r.r) - Math.max(x, r.l)) * Math.max(0, Math.min(y + ph, r.b) - Math.max(y, r.t)); });
      if (o < bo - 1) { bo = o; best = [x, y]; }
    });
    pop.style.left = best[0] - base.left + "px"; pop.style.top = best[1] - base.top + "px";
  }

  function fill(s) {
    const st = s.step, pop = $(".dvt-pop", s.root);
    const main = MAINL.indexOf(st) >= 0, list = main ? MAINL : MORE, n = list.indexOf(st) + 1;
    const label = s.showStep ? "On the page" : (main ? "Step " : "Extra ") + n + " of " + list.length;
    $(".dvt-count", pop).textContent = label;
    $(".dvt-title", pop).textContent = st.title;
    $(".dvt-text", pop).textContent = s.alt && st.alt ? st.alt.text : st.text;
    pop.setAttribute("aria-label", "Tour, " + label + ": " + st.title);
    const btns = $(".dvt-btns", pop);
    btns.querySelectorAll(".dvt-x").forEach((b) => b.remove());
    const next = $(".dvt-next", pop), back = $(".dvt-back", pop);
    back.hidden = s.idx === 0;
    next.hidden = false; next.textContent = "Next";
    const add = (text, fn, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = "dvt-x " + (cls || ""); b.textContent = text; b.addEventListener("click", fn); btns.appendChild(b); };
    const guideBtn = () => { if (typeof window.dvOpenGuide === "function") add("Photo guide", () => end("guide"), "dvt-guide"); };
    if (s.showStep) {
      // a guide page shown on the real site: a way back to the guide, and a close
      next.hidden = true; back.hidden = true; $(".dvt-skip", pop).hidden = true;
      if (s.back && typeof window.dvOpenGuide === "function") add("Back to the guide", () => end("guide"), "dvt-primary dvt-guide");
      add("Close", () => end());
    } else if (st.choice) {
      next.textContent = "Done"; next.hidden = false; next.dataset.act = "done";
      guideBtn();
      add("Show the rest", () => go(1, true), "dvt-primary");
    } else if (st.last) {
      next.textContent = "Done"; next.dataset.act = "done";
      guideBtn();
    } else next.dataset.act = "";
  }

  async function show(idx, dir) {
    try { await show2(idx, dir); } finally { if (S) { S.busy = false; if (S.queued) { S.queued = false; go(1); } } }
  }

  async function show2(idx, dir) {
    const s = S; if (!s) return;
    s.busy = true;
    const steps = allSteps();
    const token = ++s.token;
    s.want = idx;   // the step being opened: a resize while it loads must re-show this one, not the old s.idx
    // leave the previous step
    if (s.clickEl) { s.clickEl.removeEventListener("click", s.onClick, true); s.clickEl = null; }
    for (; idx >= 0 && idx < steps.length; idx += dir) {
      const st = steps[idx];
      if (!st.dialog && s.opened) { const d = $("#info-dialog"); if (d && d.open) d.close(); s.opened = false; }
      await ensureTab(st.tab);
      if (st.dialog) {
        const d = $("#info-dialog");
        if (d && !d.open && $("#info-button")) { $("#info-button").click(); s.opened = true; await sleep(200); }
      }
      let els = [];
      for (let i = 0; i < (st.wait ? 30 : 4); i++) { els = find(st); if (els.length) break; await sleep(200); if (S !== s || token !== s.token) return; }
      if (S !== s || token !== s.token) return;
      if (!els.length) { if (st.dialog && s.opened) { const d = $("#info-dialog"); if (d && d.open) d.close(); s.opened = false; } continue; }
      s.idx = idx; s.step = st; s.els = els;
      const first = els[0], dlg = first.closest("dialog[open]") ? (first.closest(".si-body") || first.closest("dialog[open]")) : document.body;
      s.host = dlg; if (s.root.parentNode !== dlg) dlg.appendChild(s.root);
      const q = first.getBoundingClientRect(), vh = document.documentElement.clientHeight;
      if (q.top < 0 || q.bottom > vh || q.left < 0 || q.right > document.documentElement.clientWidth) {
        try { first.scrollIntoView({ block: q.height > vh * 0.8 ? "start" : "center", inline: "nearest", behavior: "auto" }); } catch (e) {}
      }
      s.alt = false;
      if (st.apart) {
        // parts far apart (glyphs, then the buttons below): bring them all on screen, with room for the card in the gap, beside them or above/below
        s.alt = false; fill(s); s.root.hidden = false;
        const pop0 = $(".dvt-pop", s.root), pw0 = pop0.offsetWidth, ph0 = pop0.offsetHeight, vw2 = document.documentElement.clientWidth;
        const sc = scroller(first), lim = bottomLimit(), page = sc === document.scrollingElement || sc === document.documentElement, bt = (page ? 0 : sc.getBoundingClientRect().top) + 8, bb = Math.min(lim, page ? lim : sc.getBoundingClientRect().bottom) - 8;
        const measure = (list) => {
          const rs = list.map((e) => e.getBoundingClientRect());
          const top = Math.min(...rs.map((r) => r.top)), bot = Math.max(...rs.map((r) => r.bottom));
          const U = { l: Math.min(...rs.map((r) => r.left)), t: top, r: Math.max(...rs.map((r) => r.right)), b: bot };
          const hs = holesOf(list); let gap = 0; for (let i = 1; i < hs.length; i++) gap = Math.max(gap, hs[i].t - hs[i - 1].b);
          const span = bot - top, below = bb - (bt + span);
          const fits = span <= bb - bt && (gap >= ph0 + 24 || below >= ph0 + 12 || ph0 + 20 + span <= bb || U.l - 20 >= pw0 || vw2 - U.r - 20 >= pw0);
          return { top, bot, U, gap, fits };
        };
        let m = measure(els);
        if (!m.fits && st.alt) {
          const alt = find(st, true);
          if (alt.length) { els = alt; s.els = alt; s.alt = true; fill(s); m = measure(els); }
        }
        if (m.top < bt || m.bot > bb || (!roomOutside(m.U, pw0, ph0) && m.gap < ph0 + 24)) {
          // card in the gap or beside: parts at the top edge of the page area. Otherwise the card goes above them (it may cover the header), if they still fit under it.
          const side = m.U.l - 20 >= pw0 || vw2 - m.U.r - 20 >= pw0, T = m.gap >= ph0 + 24 || side || ph0 + 20 + (m.bot - m.top) > bb ? bt : Math.max(bt, ph0 + 20);
          sc.scrollTop += m.top - T;
        }
      }
      fill(s);
      if (st.click) { s.clickEl = first; first.addEventListener("click", s.onClick, true); }
      s.root.hidden = false;
      place(s);
      const pop = $(".dvt-pop", s.root);
      pop.focus({ preventScroll: true });
      requestAnimationFrame(() => place(s));
      return;
    }
    if (dir < 0) return show2(0, 1);
    end();
  }

  function go(d, forceMore, fromTap) {
    if (!S || S.showStep) return;
    // a tap on the highlighted card (or Next) that arrives while a step is still being shown (a resize, a re-render) is kept, not lost
    if (S.busy) { if (fromTap) S.queued = true; return; }
    const st = S.step;
    if (d > 0 && st && st.click && S.clickEl && !S.clicked) {
      // Next on the "open one" step: open the system for them
      S.clicked = true; S.clickEl.removeEventListener("click", S.onClick, true);
      try { const f = find(st, S.alt)[0] || S.clickEl; f.click(); } catch (e) {}
    }
    if (d > 0 && st && st.choice && !forceMore) return end();
    if (d > 0 && st && st.last) return end();
    show(S.idx + d, d);
  }

  // "free" steps (the maps) let drag, wheel and pinch through to the maps. Buttons that change the layout or open windows stay blocked.
  const FREE_BLOCK = "#expand-3d, #expand-map, #map-info, #walk-view, #toggle-spacing";
  function freeBlock(e) {
    if (!S || !S.step || !S.step.free || !(e.target instanceof Element)) return;
    const b = e.target.closest("button");
    if (!b || !(b.matches(FREE_BLOCK) || /deck spacing/i.test(b.textContent))) return;
    if (b.closest("#dvt-root")) return;
    e.preventDefault(); e.stopImmediatePropagation();
  }
  window.dvStartTour = function (opts) {
    end();
    const sp = opts && opts.show ? SHOW[opts.show] : null;
    MAINL = vis($(".bottom-nav")) ? MAIN_PHONE : MAIN;
    const root = build(); root.hidden = true;
    document.body.appendChild(root);
    const s = S = { root, idx: 0, token: 0, step: null, els: null, timer: 0, opened: false, clickEl: null, clicked: false,
      origHash: location.hash || "#/", selKey: "dv.modern.selected", sel0: (function () { try { return localStorage.getItem("dv.modern.selected"); } catch (e) { return null; } })(), origTab: (($(".bottom-nav .active") || {}).dataset || {}).tab || "",
      resScroll: ($("#results") || {}).scrollTop || 0, sx: window.scrollX, sy: window.scrollY,
      prevFocus: document.activeElement,
      showStep: sp ? Object.assign({ wait: true, title: opts.title || "On the page", text: opts.text || "" }, sp) : null, back: sp && opts.back ? opts.back : null };
    s.onClick = () => { if (S !== s || s.clicked) return; s.clicked = true; setTimeout(() => { if (S === s) go(1, false, true); }, 60); };
    let raf = 0;
    s.onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(s); }); };
    let rt = 0;
    s.onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (S === s) show(s.want != null ? s.want : s.idx, 1); }, 150); };
    s.onKey = (e) => {
      if (S !== s) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); }
      else if (s.showStep && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); e.stopPropagation(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); if (s.idx > 0) go(-1); }
      else if (e.key === "Tab") {
        const b = [...s.root.querySelectorAll(".dvt-pop button")].filter((x) => !x.hidden);
        if (!b.length) return;
        const i = b.indexOf(document.activeElement);
        e.preventDefault();
        b[(i + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus();
      }
    };
    root.addEventListener("click", (e) => {
      // a click or tap on the dimmed area (outside the card and outside the highlighted part) ends the tour, like Esc.
      // The card, the shielded highlight and the highlighted part itself (it is not under the root) keep their behaviour.
      if (e.target instanceof Element && e.target.closest(".dvt-b, .dvt-bx, .dvt-dim") && !e.target.closest(".dvt-pop")) { end(); return; }
      const t = e.target.closest("button"); if (!t) return;
      if (t.classList.contains("dvt-skip")) end();
      else if (t.classList.contains("dvt-back")) go(-1);
      else if (t.classList.contains("dvt-next")) { if (t.dataset.act === "done") end(); else go(1); }
    });
    window.addEventListener("resize", s.onResize);
    document.addEventListener("click", freeBlock, true);
    window.addEventListener("scroll", s.onScroll, true);
    window.addEventListener("keydown", s.onKey, true);
    s.timer = setInterval(() => {
      if (S !== s || !s.step || s.busy) return;
      if (!s.els.every((e) => document.contains(e) && vis(e))) {
        const again = find(s.step, s.alt);
        if (again.length) { s.els = again; if (s.step.click && !s.clicked) { s.clickEl.removeEventListener("click", s.onClick, true); s.clickEl = again[0]; s.clickEl.addEventListener("click", s.onClick, true); } place(s); } else show(s.idx, 1);
      } else place(s);
    }, 500);
    if (sp) prepShow(s, sp).then(() => { if (S === s) show(0, 1); }); else show(0, 1);
  };
  // state setup for "Show me on the page": the same moves the tour makes (open the first system in the list, or the home screen)
  async function prepShow(s, sp) {
    try {
      if (sp.home && /^#\/d\//.test(location.hash)) { location.hash = "#/"; await sleep(300); }
      else if (sp.sys && !/^#\/d\//.test(location.hash)) {
        await ensureTab("systems");
        let card = null;
        for (let i = 0; i < 30 && !card; i++) { card = $("#results .system-card"); if (!card) await sleep(200); if (S !== s) return; }
        if (card) { s.clicked = true; card.click(); await sleep(300); }
      }
    } catch (e) {}
  }
  window.dvTourActive = () => !!S;
})();
