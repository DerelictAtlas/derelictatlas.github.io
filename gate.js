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
  if (!window.dvGateOn || get() === cfg.hash) { window.dvGateReady = Promise.resolve(); return; }
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
        if (h === cfg.hash) { set(h); document.documentElement.classList.remove("gated"); box.remove(); resolve(); }
        else { msg.textContent = "Wrong password."; }
      };
    };
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  });
})();
