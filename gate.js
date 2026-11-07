// Soft password gate for the private test site (NOT security: anyone can read the page source or the data files).
// Config in config.js: DV_CONFIG.gate = { enabled, salt, hash } where hash = SHA-256 hex of salt + ":" + password.
// The password itself is never stored. Switch the gate off by setting gate.enabled to false. window.dvGateReady
// resolves when the page may load data; a successful entry is remembered in localStorage (dv.gate = the hash).
(function () {
  const cfg = (window.DV_CONFIG && window.DV_CONFIG.gate) || {};
  const KEY = "dv.gate";
  const get = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
  const set = (v) => { try { v === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch (_) { /* no storage */ } };
  window.dvLock = () => { set(null); location.reload(); };
  window.dvGateOn = Boolean(cfg.enabled && cfg.hash);
  // Tester passwords: gate.testers = [{id, hash}], same salt and method as the shared password. A tester is whoever's remembered
  // hash matches an entry that is still in the list, so deleting the entry ends access and logging on the next load, and the
  // shared password never makes a tester. The pass is logged with GoatCounter pixels (paths /tester/<id>/first-use and /load).
  const testers = Array.isArray(cfg.testers) ? cfg.testers.filter((x) => x && /^[A-Za-z0-9_-]{1,30}$/.test(x.id || "") && x.hash) : [];
  const testerFor = (h) => (h ? testers.find((x) => x.hash === h) || null : null);
  const MARK = "dv.tester", FIRST = "dv.tester.first";
  const getK = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const setK = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) { /* no storage */ } };
  const stored = get();
  const tester = window.dvGateOn && stored !== cfg.hash ? testerFor(stored) : null;
  if (!tester && getK(MARK)) setK(MARK, null);
  window.dvTester = tester ? tester.id : null;
  function toast(lines) {
    const go = () => {
      let el = document.getElementById("dv-tester-note");
      if (!el) {
        el = document.createElement("div"); el.id = "dv-tester-note"; el.setAttribute("role", "status");
        el.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;pointer-events:none;text-align:center;"
          + "font:12px/1.4 system-ui,sans-serif;color:#dff6f7;background:rgba(7,19,30,.92);border:1px solid rgba(85,217,220,.4);"
          + "border-radius:8px;padding:6px 10px;max-width:420px;margin:0 auto;box-sizing:border-box";
        document.body.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.remove(); }, 9000);
      }
      for (const l of lines) { const d = document.createElement("div"); d.textContent = l; el.appendChild(d); }
    };
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  }
  function testerLog(id, first) {
    const all = window.DV_CONFIG || {};
    const code = String(all.goatcounter || "").trim().toLowerCase();
    const base = all.goatcounterEndpoint || (/^[a-z0-9-]{2,50}$/.test(code) ? `https://${code}.goatcounter.com` : "");
    if (!base || (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !all.goatcounterEndpoint)) return;
    const page = /contribute/i.test(location.pathname) ? "load-contribute" : /legacy/i.test(location.pathname) ? "load-legacy" : "load";
    let warned = false;
    const send = (name) => {
      const img = new Image();
      img.onerror = () => { if (!warned) { warned = true; toast(["A blocker stopped the test log. Please allow GoatCounter."]); } };
      // ns=1: no session merging, so every hit is also a visit in GoatCounter and each load can be counted.
      img.src = `${base}/count?` + new URLSearchParams({ p: `/tester/${id}/${name}`, t: "Tester " + id, ns: "1", rnd: Math.random().toString(36).slice(2) });
    };
    if (first) send("first-use");
    send(page);
  }
  if (!window.dvGateOn || stored === cfg.hash || tester) {
    window.dvGateReady = Promise.resolve();
    if (tester) testerLog(tester.id, false);
    return;
  }
  document.documentElement.classList.add("gated");
  window.dvGateReady = new Promise((resolve) => {
    const sha = async (text) => {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    const show = () => {
      const box = document.createElement("div");
      box.id = "gate";
      box.innerHTML = `<form><h1>Derelict Atlas</h1><p>Private test site. Enter the password.</p>
        <input type="password" id="gate-pw" autocomplete="current-password" autofocus aria-label="Password">
        <button type="submit">Enter</button><p id="gate-msg" class="muted"></p></form>`;
      document.body.appendChild(box);
      const msg = box.querySelector("#gate-msg");
      box.querySelector("form").onsubmit = async (ev) => {
        ev.preventDefault();
        if (!(window.crypto && crypto.subtle)) { msg.textContent = "This browser cannot check the password here (needs https)."; return; }
        const h = await sha(cfg.salt + ":" + box.querySelector("#gate-pw").value);
        const tm = h === cfg.hash ? null : testerFor(h);
        if (h === cfg.hash || tm) {
          set(h);
          let first = false;
          if (tm) {
            setK(MARK, tm.id); window.dvTester = tm.id;
            if (getK(FIRST) !== tm.id) { first = true; setK(FIRST, tm.id); }
          } else { setK(MARK, null); window.dvTester = null; }
          document.documentElement.classList.remove("gated"); box.remove(); resolve();
          if (tm) { toast(["Test password. Page loads are counted with GoatCounter."]); testerLog(tm.id, first); }
        }
        else { msg.textContent = "Wrong password."; }
      };
    };
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  });
})();
