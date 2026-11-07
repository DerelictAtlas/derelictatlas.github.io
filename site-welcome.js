/* site-welcome.js (SITE integration): the tutorial button and "seen" state. Since 2026-11-06 the tutorial is the photo guide
 * (site-guide.js, window.dvOpenGuide). A glowing orange tutorial button (graduation cap) sits in the header middle until the
 * guide has been seen (closed once), then a smaller one at the top right of the home screen (html.dv-tut-seen). Any
 * [data-tutorial] element starts the tour (seen is set at start; Done closes everything, the photo guide opens only from its own button, and is the fallback); the information dialog's About section has "Show the welcome again". */
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
  /* Tutorial menu (user 2026-11-07): the first press starts the tour as before. Once the tutorial has been seen (same KEY, nothing
   * else is stored), a press on a [data-tutorial] button opens a small menu: Interactive tutorial, Photo guide, More topics. It closes
   * on Esc, on a click or tap outside, or when a choice is made. "Show the welcome again" in About still starts the tour. */
  const MENU_CSS = `#dv-tutmenu{position:fixed;z-index:2147482000;box-sizing:border-box;width:min(240px,calc(100vw - 16px));padding:6px;border-radius:12px;background:var(--panel-2,#121c27);color:var(--text,#e6edf3);border:1px solid var(--accent,#55d9dc);box-shadow:0 8px 28px rgba(0,0,0,.55)}
#dv-tutmenu button{display:block;width:100%;min-height:44px;padding:0 12px;margin:0;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:14px;text-align:left;cursor:pointer}
#dv-tutmenu button:hover,#dv-tutmenu button:focus-visible{background:rgba(85,217,220,.16);outline:none}
#dv-tutmenu button:focus-visible{box-shadow:inset 0 0 0 2px var(--accent,#55d9dc)}`;
  let menu = null, menuFor = null;
  function closeMenu(refocus) {
    if (!menu) return;
    const f = menuFor; menu.remove(); menu = null; menuFor = null;
    document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onMenuKey, true);
    window.removeEventListener("resize", closeMenu);
    if (refocus && f && document.contains(f)) try { f.focus({ preventScroll: true }); } catch (_) {}
  }
  function onDown(e) { if (menu && e.target instanceof Element && !menu.contains(e.target) && !(menuFor && menuFor.contains(e.target))) closeMenu(false); }
  function onMenuKey(e) {
    if (!menu) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
    const b = [...menu.querySelectorAll("button")], i = b.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); b[(i + (e.key === "ArrowDown" ? 1 : -1) + b.length) % b.length].focus(); }
    else if (e.key === "Tab") { e.preventDefault(); b[(i + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus(); }
  }
  function openMenu(btn) {
    closeMenu(false);
    if (!document.getElementById("dv-tutmenu-css")) { const st = document.createElement("style"); st.id = "dv-tutmenu-css"; st.textContent = MENU_CSS; document.head.appendChild(st); }
    const m = document.createElement("div");
    m.id = "dv-tutmenu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Tutorial");
    const items = [["Interactive tutorial", () => { markSeen(); if (typeof globalThis.dvStartTour === "function") globalThis.dvStartTour(); }],
      ["Photo guide", () => { if (typeof globalThis.dvOpenGuide === "function") globalThis.dvOpenGuide(); }],
      ["More topics", () => { if (typeof globalThis.dvOpenGuide === "function") globalThis.dvOpenGuide({ mode: "more" }); }]];
    for (const [label, fn] of items) {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem"); b.textContent = label;
      b.addEventListener("click", () => { closeMenu(false); fn(); });
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, w = m.offsetWidth, h = m.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, vw - w - 8)), top = r.bottom + 6 + h <= vh - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
    m.style.left = left + "px"; m.style.top = top + "px";
    menu = m; menuFor = btn;
    document.addEventListener("pointerdown", onDown, true); document.addEventListener("keydown", onMenuKey, true);
    window.addEventListener("resize", closeMenu);
    m.querySelector("button").focus({ preventScroll: true });
  }
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-tutorial], #site-welcome-again") : null;
    if (!t) return;
    if (t.id === "site-welcome-again") { const d = t.closest("dialog"); if (d && d.open) d.close(); }
    else if (seen()) { if (menu && menuFor === t) closeMenu(true); else openMenu(t); return; }
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
