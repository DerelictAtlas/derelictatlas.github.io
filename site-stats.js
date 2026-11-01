// SITE integration: "Visitor statistics" in the Info dialog, read live from the GoatCounter API (SITE agent, 2026-10-30).
// For the site owner only (user 2026-10-31). config.js DV_CONFIG.goatcounterTokenSealed holds the read-only API token
// encrypted with the owner's password (PBKDF2-SHA256 -> AES-256-GCM, made by G:/NMS-Work/sv1/site11/seal_token.mjs).
// "Owner tools" (hidden; 10 clicks on the version number in the Info dialog) unlocks it; "Remember on this device"
// keeps the token in this browser's localStorage, otherwise only for this tab. Visitors see no statistics.
// DV_CONFIG.goatcounterToken (plain) is still read, for tests only.
// Loads only when the Info dialog opens (or #/stats), one request at a time (GoatCounter allows a few per second),
// cached per range for 10 minutes in sessionStorage.
(function () {
  "use strict";
  const cfg = window.DV_CONFIG || {};
  const code = String(cfg.goatcounter || "").trim().toLowerCase();
  const base = cfg.goatcounterEndpoint || (/^[a-z0-9-]{2,50}$/.test(code) ? `https://${code}.goatcounter.com` : "");
  const sealed = cfg.goatcounterTokenSealed && cfg.goatcounterTokenSealed.ct ? cfg.goatcounterTokenSealed : null;
  const KEY = "dv.gc.owner";  // the unlocked token, only in the owner's browser
  const store = (fn) => { try { return fn(); } catch (_) { return ""; } };  // storage can be blocked
  let token = String(cfg.goatcounterToken || "").trim() || store(() => localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || "");
  if (!base || (!token && !sealed)) return;
  const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"]];
  const LISTS = [["toprefs", "Where visitors come from"], ["locations", "Countries"], ["browsers", "Browsers"],
    ["systems", "Operating systems"], ["sizes", "Screen sizes"]];
  const BAR = "#1ea6ab", BAR_HOVER = "#55d9dc";  // validated against the dark surface #07131e (dataviz validator)
  let range = 30, busy = false, again = false;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hour = (d) => { const x = new Date(d); x.setUTCMinutes(0, 0, 0); return x.toISOString().replace(/\.\d{3}Z$/, "Z"); };

  async function api(path, params) {
    const key = `dv.gc.${path}?${new URLSearchParams(params)}`;
    try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.at < 600000) return c.data; } catch (_) { /* no storage */ }
    const get = () => fetch(`${base}/api/v0/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-cache" });
    let r;
    try { r = await get(); } catch (_) {  // network error: retry once, then it is most likely blocked in this browser
      await sleep(1500);
      try { r = await get(); } catch (_) { throw new Error("blocked"); }
    }
    if (r.status === 429) { await sleep(1500); return api(path, params); }
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    const data = await r.json();
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (_) { /* full or blocked */ }
    await sleep(300);
    return data;
  }

  function dayChart(days) {
    const n = days.length, max = Math.max(1, ...days.map((d) => d.daily || 0));
    const W = 640, H = 150, L = 34, B = 20, T = 8, step = (W - L) / Math.max(1, n), bw = Math.max(2, step - 2);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
    const grid = ticks.map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".14"/>`
      + `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="gc-axis">${fmt(v)}</text>`).join("");
    const bars = days.map((d, i) => {
      const v = d.daily || 0, x = L + i * step + 1, top = y(v), h = Math.max(0, H - B - top), r = Math.min(4, bw / 2, h);
      const path = h <= 0 ? "" : `M${x},${H - B}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${H - B}Z`;
      return `<g class="gc-col" data-tip="${esc(new Date(d.day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }))}: ${fmt(v)} visitor${v === 1 ? "" : "s"}">`
        + `<rect x="${x - 1}" y="${T}" width="${step}" height="${H - B - T}" fill="transparent"/>${path ? `<path d="${path}" fill="${BAR}"/>` : ""}</g>`;
    }).join("");
    const lbl = (i, a) => `<text x="${L + i * step + step / 2}" y="${H - 5}" text-anchor="${a}" class="gc-axis">${esc(new Date(days[i].day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }))}</text>`;
    return `<div class="gc-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitors per day">${grid}${bars}${n ? lbl(0, "start") + lbl(n - 1, "end") : ""}</svg><div class="gc-tip" hidden></div></div>
      <details class="gc-table"><summary>Show as table</summary><table><thead><tr><th>Day</th><th>Visitors</th></tr></thead><tbody>${days.slice().reverse().map((d) => `<tr><td>${esc(d.day)}</td><td>${fmt(d.daily)}</td></tr>`).join("")}</tbody></table></details>`;
  }

  function barList(rows, total, label) {
    if (!rows.length) return `<p class="site-muted">No data yet.</p>`;
    const max = Math.max(1, ...rows.map((r) => r.count));
    return `<ol class="gc-list" aria-label="${esc(label)}">${rows.map((r) => `<li title="${esc(r.name)}: ${fmt(r.count)} visitors${total ? ` (${Math.round(100 * r.count / total)}%)` : ""}">`
      + `<span class="gc-name">${r.html || esc(r.name || "(unknown)")}</span><span class="gc-val">${fmt(r.count)}</span>`
      + `<span class="gc-bar"><i style="width:${(100 * r.count / max).toFixed(1)}%"></i></span></li>`).join("")}</ol>`;
  }

  function systemRow(h) {
    const a = h.path.slice(3).toUpperCase(), name = typeof window.dvSystemName === "function" ? window.dvSystemName(a) : "";
    return { count: h.count, name: name || a, html: `<a href="#/d/${esc(a)}" data-gc-system>${esc(name || a)}</a> <small class="site-muted">${esc(a.slice(4))}</small>` };
  }

  async function render(section) {
    if (busy) { again = true; return; }  // a range clicked while loading: render it when this one is done
    busy = true;
    const body = section.querySelector(".gc-body");
    body.innerHTML = `<p class="site-muted">Loading visitor statistics…</p>`;
    try {
      const now = new Date(), start = hour(now.getTime() - range * 86400000), end = hour(now.getTime() + 3600000);
      const p = { start, end };
      const total = await api("stats/total", p);
      const hits = await api("stats/hits", { ...p, limit: 100 });
      const days = total.stats || [], list = (hits.hits || []).filter((h) => !h.event);
      const systems = list.filter((h) => /^\/d\/[0-9A-F]{16}$/i.test(h.path)).sort((a, b) => b.count - a.count);
      const busiest = days.reduce((m, d) => ((d.daily || 0) > (m ? m.daily || 0 : -1) ? d : m), null);
      const tile = (v, k, note) => `<div class="gc-tile"><b>${v}</b><span>${k}</span>${note ? `<small>${note}</small>` : ""}</div>`;
      body.innerHTML = `<div class="gc-tiles">${tile(fmt(total.total), `Visitors · ${range} days`)}${tile(fmt(days.length ? days[days.length - 1].daily : 0), "Today", "UTC day")}`
        + `${tile(fmt(systems.length), "Systems viewed", hits.more ? "top 100 pages" : "")}${tile(busiest && busiest.daily ? fmt(busiest.daily) : "—", "Busiest day", busiest && busiest.daily ? esc(busiest.day) : "")}</div>`
        + `<h4>Visitors per day</h4>${dayChart(days)}`
        + `<h4>Most viewed systems</h4>${barList(systems.slice(0, 10).map(systemRow), total.total, "Most viewed systems")}`
        + `<div class="gc-grid"></div><p class="site-muted gc-note">Unique visitors per day, counted anonymously by GoatCounter (no cookies). Updated live; cached here for 10 minutes.</p>`;
      const grid = body.querySelector(".gc-grid");
      for (const [page, title] of LISTS) {
        const box = document.createElement("div");
        box.innerHTML = `<h4>${esc(title)}</h4><p class="site-muted">Loading…</p>`;
        grid.appendChild(box);
        try {
          const d = await api(`stats/${page}`, { ...p, limit: 6 });
          box.innerHTML = `<h4>${esc(title)}</h4>${barList((d.stats || []).map((s) => ({ name: s.name || "(direct / unknown)", count: s.count })), total.total, title)}`;
        } catch (e) { box.innerHTML = `<h4>${esc(title)}</h4><p class="site-muted">Not available.</p>`; }
      }
    } catch (e) {
      body.innerHTML = e.message === "blocked"
        ? `<p class="site-muted">Could not reach GoatCounter (goatcounter.com). An ad blocker or a privacy setting in this browser is probably blocking it: allow goatcounter.com on this site, then reload.</p>`
        : `<p class="site-muted">Visitor statistics are not available right now (${esc(e.message)}).</p>`;
    } finally {
      busy = false;
      if (again) { again = false; render(section); }
    }
  }

  function mount() {
    const dialog = document.getElementById("info-dialog");
    if (!dialog || document.getElementById("site-visitor-stats")) return;
    const s = document.createElement("section");
    s.id = "site-visitor-stats";
    s.setAttribute("aria-labelledby", "gc-title");
    s.innerHTML = `<h3 id="gc-title">Visitor statistics</h3><div class="gc-ranges" role="group" aria-label="Time range">${RANGES.map(([d, l]) =>
      `<button type="button" data-gc-range="${d}" aria-pressed="${d === range}">${l}</button>`).join("")}</div><div class="gc-body"></div>`;
    const about = document.getElementById("site-about"), version = dialog.querySelector(".info-version");
    dialog.insertBefore(s, about || version || null);
    let loaded = false;
    const open = () => { if (dialog.open && !loaded) { loaded = true; render(s); } };
    new MutationObserver(open).observe(dialog, { attributes: true, attributeFilter: ["open"] });
    s.addEventListener("click", (e) => {
      const b = e.target.closest("[data-gc-range]");
      if (b) { range = Number(b.dataset.gcRange); s.querySelectorAll("[data-gc-range]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(s); return; }
      if (e.target.closest("[data-gc-system]")) dialog.close();
    });
    s.addEventListener("pointermove", (e) => {
      const tip = s.querySelector(".gc-tip"), col = e.target.closest(".gc-col");
      s.querySelectorAll(".gc-col path").forEach((p) => p.setAttribute("fill", BAR));
      if (!tip) return;
      if (!col) { tip.hidden = true; return; }
      const p = col.querySelector("path"); if (p) p.setAttribute("fill", BAR_HOVER);
      const box = tip.parentElement.getBoundingClientRect();
      tip.textContent = col.dataset.tip;
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(0, e.clientX - box.left - tip.offsetWidth / 2), box.width - tip.offsetWidth) + "px";
      tip.style.top = Math.max(0, e.clientY - box.top - 34) + "px";
    });
    s.addEventListener("pointerleave", () => { const tip = s.querySelector(".gc-tip"); if (tip) tip.hidden = true; s.querySelectorAll(".gc-col path").forEach((p) => p.setAttribute("fill", BAR)); });
    const route = () => {
      if (location.hash !== "#/stats") return;
      if (!dialog.open) dialog.showModal();
      open();
      s.scrollIntoView({ block: "start" });
    };
    window.addEventListener("hashchange", route);
    (window.dvGateReady || Promise.resolve()).then(route);
    open();
  }

  // Owner tools: unlock (or lock) the statistics, and the Developer mode button that the Info dialog no longer shows.
  const unb64 = (t) => Uint8Array.from(atob(t), (ch) => ch.charCodeAt(0));
  async function unseal(password) {
    const pwKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(sealed.salt), iterations: sealed.iter },
      pwKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.ct)));
  }
  function mountOwner() {
    const dialog = document.getElementById("info-dialog");
    if (!dialog || document.getElementById("site-owner")) return;
    const o = document.createElement("section");
    o.id = "site-owner";
    o.hidden = true;
    o.setAttribute("aria-labelledby", "site-owner-title");
    o.innerHTML = `<h3 id="site-owner-title">Owner tools</h3>${token
      ? `<p class="site-muted">Visitor statistics are unlocked in this browser.</p><button type="button" data-owner-lock>Lock statistics</button>`
      : `<form class="owner-unlock"><label>Statistics password<input type="password" autocomplete="current-password" required></label>
        <label class="owner-check"><input type="checkbox" checked> Remember on this device</label>
        <button type="submit">Unlock statistics</button><p class="site-muted owner-msg" role="status"></p></form>`}
      <button type="button" data-owner-dev>Developer mode</button>`;
    dialog.appendChild(o);
    o.addEventListener("click", (e) => {
      if (e.target.closest("[data-owner-dev]")) { const b = document.getElementById("diagnostics"); if (b) b.click(); }
      if (e.target.closest("[data-owner-lock]")) {
        store(() => { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); });
        location.reload();
      }
    });
    const form = o.querySelector(".owner-unlock");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = form.querySelector(".owner-msg"), btn = form.querySelector("button[type=submit]");
      if (!(window.crypto && crypto.subtle)) { msg.textContent = "This browser cannot unlock here (needs https)."; return; }
      btn.disabled = true;
      msg.textContent = "Checking…";
      let t = "";
      try { t = (await unseal(form.querySelector("input[type=password]").value)).trim(); } catch (_) { /* wrong password */ }
      btn.disabled = false;
      if (!t) { msg.textContent = "Wrong password."; return; }
      token = t;
      const keep = form.querySelector(".owner-check input").checked;
      store(() => (keep ? localStorage : sessionStorage).setItem(KEY, token));
      o.remove();
      mountOwner();
      mount();
      document.getElementById("site-visitor-stats")?.scrollIntoView({ block: "start" });
    });
  }
  window.dvOwnerTools = () => {
    const o = document.getElementById("site-owner");
    if (!o) return false;
    o.hidden = false;
    o.scrollIntoView({ block: "nearest" });
    o.querySelector("input[type=password]")?.focus();
    return true;
  };
  function start() { mountOwner(); if (token) mount(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
