/* site-loading.js (SITE v161): one small loading circle for every place that waits for data, and the "Could not load, retry" fallback
 * (no endless spinner). dvLoading.html(label) -> markup; dvLoading.MS = how long to wait; dvLoading.retry() = refresh the atlas (or reload).
 * The Systems list's own "Loading atlas..." box gets the same fallback here after MS. Respects reduced motion (the circle stops, the word stays). */
(function (root) {
  "use strict";
  let MS = 30000;
  try { const t = Number(sessionStorage.getItem("dv.loading.ms")); if (t >= 500) MS = t; } catch (_) {}   // test hook: a short wait
  const html = (label) => `<span class="dv-load" role="status" aria-label="Loading"><i class="dv-spin" aria-hidden="true"></i><span class="dv-load-t">${label || "Loading"}</span></span>`;
  function retry() { const b = document.getElementById("refresh-atlas"); if (b && !b.disabled) { b.click(); return true; } location.reload(); return false; }
  root.dvLoading = { MS, html, retry };
  // the Systems list: modern.js shows <div class="loading"> until the atlas rows arrive
  function watchResults() {
    const res = document.getElementById("results");
    if (!res) return;
    let t = 0;
    const check = () => {
      const l = res.querySelector(".loading");
      if (l && !l.dataset.dvw) {
        l.dataset.dvw = "1"; res.setAttribute("aria-busy", "true");
        t = setTimeout(() => { const x = res.querySelector(".loading"); if (!x) return; x.innerHTML = 'Could not load the atlas. <button type="button" class="dv-retry">Retry</button>'; res.removeAttribute("aria-busy"); }, MS);
      } else if (!l) { clearTimeout(t); res.removeAttribute("aria-busy"); }
    };
    new MutationObserver(check).observe(res, { childList: true });
    res.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".dv-retry")) { const l = res.querySelector(".loading"); if (l) { l.innerHTML = "<span></span>Loading atlas…"; delete l.dataset.dvw; } retry(); check(); } });   // v163: back to the loading text, the timer starts again
    check();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchResults); else watchResults();
})(typeof globalThis !== "undefined" ? globalThis : this);
