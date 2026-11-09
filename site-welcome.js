/* site-welcome.js (SITE integration): the tutorial button and "seen" state. Since 2026-11-06 the tutorial is the photo guide
 * (site-guide.js, window.dvOpenGuide). A glowing orange tutorial button (graduation cap) sits in the header middle until the
 * guide has been seen (closed once), then a smaller one at the top right of the home screen (html.dv-tut-seen). Any
 * [data-tutorial] element opens the tutorial window (v145b: three picture cards; the tour sets seen at its start; Done closes everything, the photo guide opens only from its own button, and is the fallback); the information dialog's About section has "Show the welcome again". */
(function () {
  "use strict";
  const KEY = "dv.welcome.v1";
  const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return false; } };
  const syncSeen = () => document.documentElement.classList.toggle("dv-tut-seen", seen());
  const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch (_) {} syncSeen(); };
  syncSeen();
  globalThis.dvShowWelcome = () => {
    if (typeof globalThis.dvStartTour === "function") { markSeen(); globalThis.dvStartTour(); }
    else if (typeof globalThis.dvOpenGuide === "function") globalThis.dvOpenGuide();
  };
  document.addEventListener("dv-guide-closed", markSeen);
  /* Tutorial window (user 2026-11-07, replaces the small text menu): every press of a [data-tutorial] button opens a window with one
   * picture card per mode: Interactive tutorial, Photo guide, More topics. One click on a card starts that mode. Esc and a click or tap
   * outside the window close it, and nothing is stored by opening or closing it (the seen flag is set only when the tour starts or the
   * guide is closed, as before). "Show the welcome again" in About still starts the tour. Pictures: guide/tutwin-*.webp, crops of the
   * public site with models/, glyph PNGs and the module PNG blocked: no system, no reward, no names. Styles are injected here. */
  const WIN_CSS = `#dv-tutwin{width:min(880px,calc(100vw - 24px));max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);box-sizing:border-box;padding:16px 18px 18px;overflow:hidden;border-radius:14px}
#dv-tutwin .dialog-heading{margin-bottom:10px}
#dv-tutwin h2{margin:0;font-size:20px}
#dv-tutwin .dv-tw-x{width:44px;height:44px;min-height:44px;font-size:26px;margin:-8px -10px -8px 0;cursor:pointer}
#dv-tutwin .dv-tw-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
#dv-tutwin .dv-tw-card{display:flex;flex-direction:column;align-items:stretch;text-align:left;min-width:0;padding:0;margin:0;border:1px solid var(--line,rgba(255,255,255,.18));border-radius:12px;background:var(--panel-2,#121c27);color:inherit;font:inherit;cursor:pointer;overflow:hidden}
#dv-tutwin .dv-tw-card:hover{border-color:var(--accent,#55d9dc)}
#dv-tutwin .dv-tw-card:focus-visible{outline:2px solid var(--accent,#55d9dc);outline-offset:2px}
#dv-tutwin .dv-tw-pic{display:block;width:100%;aspect-ratio:2/1;object-fit:cover;background:#0b121a}
#dv-tutwin .dv-tw-txt{display:block;padding:10px 12px 12px;min-width:0}
#dv-tutwin .dv-tw-txt b{display:block;font-size:16px;margin-bottom:3px}
#dv-tutwin .dv-tw-txt small{display:block;font-size:13px;line-height:1.35;color:var(--muted,#9fb0c0)}
#dv-tutwin[open]{animation:dvtw-in .16s ease-out}
@keyframes dvtw-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#dv-tutwin[open]{animation:none}}
@media (max-width:639px){
#dv-tutwin{padding:12px 12px 12px}
#dv-tutwin .dialog-heading{margin-bottom:6px}
#dv-tutwin .dv-tw-cards{grid-template-columns:1fr;gap:8px}
#dv-tutwin .dv-tw-card{flex-direction:row;align-items:center}
#dv-tutwin .dv-tw-pic{width:42%;flex:0 0 42%;aspect-ratio:2/1}
#dv-tutwin .dv-tw-txt{padding:6px 10px}
#dv-tutwin .dv-tw-txt b{font-size:15px;margin-bottom:2px}
#dv-tutwin .dv-tw-txt small{font-size:12px;line-height:1.3}}
@media (max-width:360px){#dv-tutwin .dv-tw-pic{width:36%;flex-basis:36%}#dv-tutwin .dv-tw-txt{padding:4px 8px}#dv-tutwin .dv-tw-txt small{font-size:11.5px}}
@media (min-width:640px) and (max-height:520px){#dv-tutwin{padding:10px 14px 12px}#dv-tutwin .dialog-heading{margin-bottom:4px}#dv-tutwin h2{font-size:18px}#dv-tutwin .dv-tw-x{margin-top:-10px;margin-bottom:-10px}#dv-tutwin .dv-tw-txt{padding:6px 10px 8px}#dv-tutwin .dv-tw-txt b{font-size:15px}#dv-tutwin .dv-tw-txt small{font-size:12px}}`;
  const WIN_CARDS = [
    { id: "tour", pic: "guide/tutwin-tour.webp", t: "Interactive tutorial", s: "A guided tour on the page itself. Click along.", alt: "The tour pointing at the search box on the atlas page", go: () => { markSeen(); if (typeof globalThis.dvStartTour === "function") globalThis.dvStartTour(); else if (typeof globalThis.dvOpenGuide === "function") globalThis.dvOpenGuide(); } },
    { id: "guide", pic: "guide/tutwin-guide.webp", t: "Photo guide", s: "Five steps with a picture each. Read at your pace.", alt: "A step of the photo guide with its picture and Next button", go: () => { if (typeof globalThis.dvOpenGuide === "function") globalThis.dvOpenGuide(); } },
    { id: "more", pic: "guide/tutwin-more.webp", t: "More topics", s: "Pick one thing to learn: filters, Near me, Quick Run and more.", alt: "The list of more topics in the photo guide", go: () => { if (typeof globalThis.dvOpenGuide === "function") globalThis.dvOpenGuide({ mode: "more" }); } },
  ];
  let win = null, winFor = null;
  const outsideOf = (d, e) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  function openWindow(btn) {
    if (win) return;
    if (!document.getElementById("dv-tutwin-css")) { const st = document.createElement("style"); st.id = "dv-tutwin-css"; st.textContent = WIN_CSS; document.head.appendChild(st); }
    const d = document.createElement("dialog");
    d.id = "dv-tutwin"; d.className = "sheet"; d.setAttribute("aria-labelledby", "dv-tutwin-title");
    d.innerHTML = `<div class="dialog-heading"><h2 id="dv-tutwin-title">Tutorial</h2><button type="button" class="icon-button dv-tw-x" aria-label="Close">×</button></div>
<div class="dv-tw-cards">${WIN_CARDS.map((c) => `<button type="button" class="dv-tw-card" data-card="${c.id}"><img class="dv-tw-pic" src="${c.pic}" alt="${c.alt}" decoding="async"><span class="dv-tw-txt"><b>${c.t}</b><small>${c.s}</small></span></button>`).join("")}</div>`;
    document.body.appendChild(d);
    let downOutside = false;
    d.addEventListener("pointerdown", (e) => { downOutside = e.target === d && outsideOf(d, e); });
    d.addEventListener("click", (e) => {
      if (e.target === d && downOutside && outsideOf(d, e)) { downOutside = false; d.close(); return; }
      downOutside = false;
      const card = e.target instanceof Element ? e.target.closest(".dv-tw-card") : null;
      if (card) { const c = WIN_CARDS.find((x) => x.id === card.dataset.card); winFor = null; d.close(); if (c) c.go(); }
    });
    d.querySelector(".dv-tw-x").addEventListener("click", () => d.close());
    d.addEventListener("close", () => {
      const f = winFor; win = null; winFor = null; d.remove();
      if (f && document.contains(f) && f.getClientRects().length) try { f.focus({ preventScroll: true }); } catch (_) {}
    });
    win = d; winFor = btn;
    d.showModal();
    const first = d.querySelector(".dv-tw-card"); if (first) first.focus({ preventScroll: true });
  }
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-tutorial], #site-welcome-again") : null;
    if (!t) return;
    if (t.id === "site-welcome-again") { const d = t.closest("dialog"); if (d && d.open) d.close(); }
    else { openWindow(t); return; }
    globalThis.dvShowWelcome();
  });
  /* First-visit prompt (user 2026-11-06): a modal over the dimmed page offering the tour. Closes on X, Esc or a click/tap outside;
   * closing opens nothing. Shown once per browser (KEY is set when it shows). Not shown on deep links (any hash but #/), nor
   * while the gate, a dialog, the guide or the tour is up. Styles are injected here so no shared stylesheet is touched. */
  (function () {
    const css = `#dv-first{width:min(400px,calc(100vw - 24px));box-sizing:border-box;padding:20px 22px 20px;overflow:auto}
#dv-first .dialog-heading{margin-bottom:6px}
#dv-first h2{margin:0;font-size:20px}
#dv-first .dv-first-x{width:44px;height:44px;min-height:44px;font-size:26px;margin:-8px -10px -8px 0;cursor:pointer}
#dv-first p{margin:0 0 16px;font-size:14px;line-height:1.5}
#dv-first .dv-first-go{width:100%;min-height:46px;font-size:15px;cursor:pointer}
#dv-first .dv-first-guide{display:block;margin:10px auto 0;min-height:40px;padding:0 14px;font-size:12px;cursor:pointer}
#dv-first[open]{animation:dvfirst-in .18s ease-out}
@keyframes dvfirst-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#dv-first[open]{animation:none}}
@media (max-height:480px){#dv-first{padding:12px 18px}#dv-first p{margin-bottom:10px}#dv-first .dv-first-guide{margin-top:4px}}`;
    let shown = false, tries = 0, dlg = null;
    const off = () => { try { return sessionStorage.getItem("dv.first.off") === "1"; } catch (_) { return false; } };   // test hook: keeps the prompt away without touching the seen flag
    const plain = () => { const h = location.hash; return h === "" || h === "#" || h === "#/"; };
    const blocked = () => document.documentElement.classList.contains("gated") || document.getElementById("gate")
      || document.querySelector("dialog[open], .dvg")
      || (typeof globalThis.dvTourActive === "function" && globalThis.dvTourActive());
    function build() {
      const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
      const d = document.createElement("dialog");
      d.id = "dv-first"; d.className = "sheet"; d.setAttribute("aria-labelledby", "dv-first-title");
      d.innerHTML = `<div class="dialog-heading"><h2 id="dv-first-title">New here?</h2>
<button type="button" class="icon-button dv-first-x" aria-label="Close">\u00d7</button></div>
<p>A short tour shows how the atlas works.</p>
<button type="button" class="primary dv-first-go">Start the tour</button>
<button type="button" class="quiet dv-first-guide">Photo guide</button>`;
      document.body.appendChild(d);
      let downOutside = false;
      d.addEventListener("pointerdown", (e) => { downOutside = e.target === d && outside(d, e); });
      d.addEventListener("click", (e) => {
        if (e.target === d && downOutside !== false && outside(d, e)) { downOutside = false; d.close(); }
        downOutside = false;
      });
      d.addEventListener("keydown", (e) => {   // keep Tab inside the prompt
        if (e.key !== "Tab") return;
        const f = [...d.querySelectorAll("button")], i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      });
      d.querySelector(".dv-first-x").addEventListener("click", () => d.close());
      d.querySelector(".dv-first-go").addEventListener("click", () => { d.close(); if (typeof globalThis.dvStartTour === "function") globalThis.dvStartTour(); });
      d.querySelector(".dv-first-guide").addEventListener("click", () => { d.close(); if (typeof globalThis.dvOpenGuide === "function") globalThis.dvOpenGuide(); });
      d.addEventListener("close", () => {
        d.remove(); st.remove(); dlg = null;
        if (!document.activeElement || document.activeElement === document.body) {
          const alt = [...document.querySelectorAll("[data-tutorial]")].find((el) => el.getClientRects().length);
          if (alt) try { alt.focus({ preventScroll: true }); } catch (_) {}
        }
      });
      return d;
    }
    function outside(d, e) { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; }
    function attempt() {
      if (shown || seen() || !plain() || off()) return;
      if (blocked()) { if (++tries < 15) setTimeout(attempt, 1000); return; }
      shown = true; markSeen();
      dlg = build(); dlg.showModal();
      const go = dlg.querySelector(".dv-first-go"); if (go) go.focus();
    }
    globalThis.dvFirstPrompt = attempt;
    const start = () => (globalThis.dvGateReady || Promise.resolve()).then(() => setTimeout(attempt, 1200));
    if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
  })();
})();
