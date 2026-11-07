// SITE integration: share banner (user 2026-11-03: "can we do embedding when sharing with system glyphs totals, boxes,
// nanitens value etc, all in a relatively small banner, all custimizable ofc with checkboxes"; the user chose a banner
// image, no server). Adds Photo | Banner to the "Photo & share" dialog (#share-dialog, share-ui.js). Banner draws a
// 1200 x 300 banner (2x pixels) on this device with a canvas from the open system (window.dvShareCurrent, modern.js
// REWARD_EDITS): the site's own glyph facsimiles (glyphs-svg/), our reward card recreations, the user's logo. Copy image /
// Download PNG / Copy link. Ticked items are remembered in localStorage dv.banner.v1. Nothing is sent anywhere.
(function () {
  "use strict";
  const KEY = "dv.banner.v1", W = 1200, H = 300, S = 2;
  const ITEMS = [
    ["glyphs", "Glyphs + address", true],
    ["name", "System name", false],
    ["total", "Total containers", true],
    ["boxes", "Boxes (crates, footlockers, briefcases, tall lockers)", false],
    ["modules", "Salvaged Frigate Modules", true],
    ["nanites", "Nanites", true],
    ["value", "Loot value (Units)", true],
    ["spookbox", "SpookBox contents", true],   // sharespook 2026-11-06: contents shown by default (the viewer shows them without a click)
    ["rooms", "Rooms · decks", false],
    ["reward", "End reward", false],
    ["finder", "Atlas scout", true],       // SITE12 2026-11-03: the published scout (views/finders.csv, site-finder.js); never "Found by"
    ["credit", "Atlas logo + link", true],
  ];
  let chosen = {};
  ITEMS.forEach(([k, , on]) => { chosen[k] = on; });
  try { const saved = JSON.parse(localStorage.getItem(KEY) || "null"); if (saved && typeof saved === "object") for (const [k] of ITEMS) if (typeof saved[k] === "boolean") chosen[k] = saved[k]; } catch (_) {}
  const saveChoice = () => { try { localStorage.setItem(KEY, JSON.stringify(chosen)); } catch (_) {} };

  const num = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : fmt(n));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const base = () => String((window.DV_CONFIG || {}).siteBase || "https://derelictatlas.github.io/");
  const SPOOK = ["", "Preserved Brain", "Preserved Grub", "Preserved Sample", "Preserved Eyeball", "Preserved Egg", "Preserved Horror"];

  // the galaxy text: its byte from the row, else from the address (digits 7-8); same names as the viewer (dvGalaxy.label)
  const galaxyText = (b) => (b === null ? "" : window.dvGalaxy ? window.dvGalaxy.label(b) : b === 0 ? "Euclid" : "Galaxy " + (b + 1));
  // what the open system has; null = not computed (that checkbox is disabled)
  function facts() {
    const cur = typeof window.dvShareCurrent === "function" ? window.dvShareCurrent() : null;
    if (!cur || !cur.row) return null;
    const r = cur.row, e = cur.extras || {}, address = String(r.address || "").toUpperCase();
    // same wording as the viewer (atlas-features spookboxText): "Preserved Grub ×3", "Hazard refresh only", ambiguous = "≈" + could-also-be list; unknown text = null (never an empty box)
    const spookText = (c) => { const s = String(c || "").trim(), m = /^(\d+)x(\d+)$/i.exec(s); return m ? (Number(m[1]) ? (SPOOK[Number(m[1])] || "Package " + m[1]) + " ×" + m[2] : "Hazard refresh only") : s === "0" ? "Hazard refresh only" : null; };
    const spookTxt = spookText(e.spookbox), spookUnsure = spookTxt !== null && (e.spookbox_ambiguous === "1" || e.spookbox_ambiguous === "true");
    const spook = spookTxt === null ? null : { text: spookTxt, unsure: spookUnsure, alts: spookUnsure ? String(e.spookbox_alt || "").split("|").map(spookText).filter(Boolean) : [] };
    const reward = r.reward_name ? { name: r.reward_name, cls: /^[CBAS]$/.test(r.reward_class) ? r.reward_class : "", icon: cur.rewardIcon || "reward-icons/unknown.svg", hidden: !cur.showReward } : null;
    return {
      address, glyphs: cur.glyphs || "", name: cur.name && cur.name !== "system_name" ? cur.name : "", galaxy: galaxyText(Number.isInteger(r.galaxy) ? r.galaxy : /^[0-9A-F]{16}$/.test(address) ? parseInt(address.slice(6, 8), 16) : null),
      total: cur.total && cur.total !== "—" ? cur.total : null,
      boxes: [r.salvage_crates, r.footlockers, r.briefcases, r.tall_lockers].some((v) => num(v) !== null) ? [r.salvage_crates, r.footlockers, r.briefcases, r.tall_lockers].map(num) : null,
      modules: num(r.frigate_modules) === null ? null : { n: num(r.frigate_modules), unsure: !!Number(r.frigate_modules_ambiguous) },
      nanites: num(e.items_nanites ?? r.items_nanites), value: num(e.items_value ?? r.items_value), spookbox: spook,
      rooms: num(r.rooms) === null ? null : { rooms: num(r.rooms), decks: num(r.floors) },
      reward, revealed: !!cur.showReward,
      finder: (window.dvFinder && window.dvFinder.foundBy(address)) || null,
    };
  }
  function link(address, showReward) {
    try { const u = new URL(base()); u.search = ""; u.hash = "/d/" + address; u.searchParams.set("reward", showReward ? "1" : "0"); return u.href; } catch (_) { return base(); }
  }
  const available = (f, k) => !f ? false : k === "glyphs" ? !!f.glyphs : k === "name" ? !!f.name : k === "finder" ? !!f.finder : k === "credit" ? true : f[k] !== null && f[k] !== undefined;

  // images (same origin, so the canvas stays exportable)
  const imgCache = new Map();
  const img = (src) => {
    if (!imgCache.has(src)) imgCache.set(src, new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
    return imgCache.get(src);
  };
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const fit = (c, text, max) => { let t = String(text); while (t.length > 1 && c.measureText(t).width > max) t = t.slice(0, -2) + "…"; return t; };

  const COLOR = { total: "#edf3f4", boxes: "#c89b50", modules: "#f4cd54", nanites: "#4fc3ff", value: "#f6b24a", spookbox: "#b98cff", rooms: "#94a9bc", reward: "#b2c5d1" };
  const RCOLOR = { C: "#94cd79", B: "#80b9ef", A: "#f09ba8", S: "#f0cf67" };
  let drawTicket = 0;
  async function draw(canvas, f) {
    const ticket = ++drawTicket;
    try { await Promise.all(['600 52px "Barlow Condensed"', '500 18px "Barlow"', '700 15px "Barlow"'].map((x) => document.fonts.load(x))); } catch (_) {}
    const glyphImgs = chosen.glyphs && f.glyphs ? await Promise.all([...f.glyphs].map((ch) => img("glyphs-svg/" + ch.toLowerCase() + ".svg"))) : [];
    const logo = chosen.credit ? await img("brand/logo-128.webp") : null;
    const rewardImg = chosen.reward && f.reward ? await img(f.reward.hidden ? "reward-icons/hidden.svg" : f.reward.icon) : null;
    if (ticket !== drawTicket) return;
    const c = canvas.getContext("2d");
    c.setTransform(S, 0, 0, S, 0, 0); c.clearRect(0, 0, W, H);
    // panel
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#07131e"); g.addColorStop(0.55, "#0b1d2c"); g.addColorStop(1, "#102a3c");
    rr(c, 0, 0, W, H, 22); c.fillStyle = g; c.fill();
    c.save(); rr(c, 0, 0, W, H, 22); c.clip();
    const glow = c.createRadialGradient(W * 0.85, -40, 10, W * 0.85, -40, 520); glow.addColorStop(0, "#55d9dc33"); glow.addColorStop(1, "#55d9dc00");
    c.fillStyle = glow; c.fillRect(0, 0, W, H); c.restore();
    rr(c, 1, 1, W - 2, H - 2, 21); c.strokeStyle = "#55d9dc55"; c.lineWidth = 2; c.stroke();

    let x0 = 32;
    if (chosen.credit) {
      if (logo) c.drawImage(logo, 30, 30, 76, 76);
      c.fillStyle = "#94a9bc"; c.font = '700 13px "Barlow", system-ui, sans-serif'; c.textAlign = "center";
      c.fillText("DERELICT", 68, 128); c.fillText("ATLAS", 68, 145); c.textAlign = "left";
      x0 = 136;
    }
    const url = base().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const stats = ["total", "modules", "nanites", "value", "spookbox", "rooms", "boxes", "reward"].filter((k) => chosen[k] && available(f, k));
    // header (user 2026-11-04 "glyphs tiny, hex huge, make the glyphs stretch the whole length"): the glyph row takes the
    // full width; the link and "Atlas scout" move to the right end of the address line under it (top right without glyphs)
    let y = stats.length ? 30 : 74;
    const glyphRow = glyphImgs.length > 0;
    let hexY = 0;
    if (glyphRow) {
      const gap = 8, size = Math.min(76, (W - 32 - x0 - gap * 11) / 12);
      glyphImgs.forEach((im, i) => { if (im) c.drawImage(im, x0 + i * (size + gap), y, size, size); });
      hexY = y + size + 30;
    }
    let rx = W - 32;
    if (chosen.credit) {
      c.font = '600 17px "Barlow", system-ui, sans-serif'; c.fillStyle = "#55d9dc"; c.textAlign = "right";
      c.fillText(url, W - 32, glyphRow ? hexY : 50); c.textAlign = "left"; rx = W - 32 - c.measureText(url).width - 24;
    }
    // "Atlas scout: NAME" with a radar badge; canvas text, never HTML
    if (chosen.finder && f.finder) {
      const fy = glyphRow ? hexY : chosen.credit ? 80 : 50, fx = glyphRow ? rx : W - 32;
      c.textAlign = "right";
      c.font = '700 17px "Barlow", system-ui, sans-serif';
      const name = fit(c, f.finder, 300), nw = c.measureText(name).width;
      c.fillStyle = "#edf3f4"; c.fillText(name, fx, fy);
      c.font = '600 17px "Barlow", system-ui, sans-serif'; c.fillStyle = "#55d9dc";
      const lw = c.measureText("Atlas scout: ").width;
      c.fillText("Atlas scout: ", fx - nw, fy);
      c.textAlign = "left";
      const cx = fx - nw - lw - 12, cy = fy - 6;    // the radar badge
      c.strokeStyle = "#55d9dc"; c.lineWidth = 1.6;
      c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(cx, cy, 4, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 6.5, cy - 5); c.stroke();
      rx = glyphRow ? cx - 8 - 24 : Math.min(rx, cx - 8 - 24);
    }
    const headRight = rx;
    // the galaxy is on every banner (user 2026-11-06 "banner is missing galaxy"): after the glyphs, or under the name when there is
    // no glyph row, whether or not the name is ticked. The name gives way first when a line is long, never the galaxy.
    const SMALL = '500 18px "Barlow", system-ui, sans-serif';
    if (glyphRow) {
      c.fillStyle = "#edf3f4"; c.font = '600 18px ui-monospace, "Cascadia Mono", Consolas, monospace';
      c.fillText(f.glyphs, x0, hexY);
      let px = x0 + c.measureText(f.glyphs).width + 14;
      c.font = SMALL; c.fillStyle = "#94a9bc";
      const gal = f.galaxy ? "· " + f.galaxy : "", galW = gal ? c.measureText(gal).width : 0;
      if (chosen.name && f.name) {
        const nm = fit(c, "· " + f.name, Math.max(60, headRight - px - galW - 14));
        c.fillText(nm, px, hexY); px += c.measureText(nm).width + 14;
      }
      if (gal) c.fillText(gal, px, hexY);
    } else if (chosen.name && f.name) {
      c.fillStyle = "#edf3f4"; c.font = '600 42px "Barlow Condensed", "Barlow", sans-serif';
      c.fillText(fit(c, f.name, headRight - x0), x0, y + 42);
      c.fillStyle = "#94a9bc"; c.font = SMALL;
      c.fillText((f.galaxy ? f.galaxy + " · " : "") + f.glyphs, x0, y + 74);
    } else if (f.galaxy) {
      c.fillStyle = "#94a9bc"; c.font = SMALL;
      c.fillText(f.galaxy, x0, y + 42);
    }
    // stat tiles: each as wide as its content; when many are ticked the type gets smaller (down to 58 %)
    if (stats.length) {
      const top = 158, h = 114, gap = 12, avail = W - x0 - 32;
      const BIG = (z) => `600 ${Math.round(54 * z)}px "Barlow Condensed", "Barlow", sans-serif`;
      const UNIT = (z) => `500 ${Math.round(22 * z)}px "Barlow Condensed", "Barlow", sans-serif`;
      const LAB = (z) => `500 ${Math.round(16 * Math.max(z, .8))}px "Barlow", system-ui, sans-serif`;
      const LINE = (z) => `600 ${Math.round(21 * Math.max(z, .78))}px "Barlow Condensed", "Barlow", sans-serif`;
      const NAME = (z) => `600 ${Math.round(23 * Math.max(z, .78))}px "Barlow Condensed", "Barlow", sans-serif`;
      const tiles = stats.map((k) => {
        const t = { k, big: "", unit: "", label: "", col: COLOR[k] };
        if (k === "total") { t.big = f.total; t.label = "containers"; }
        if (k === "modules") { t.big = f.modules.n + (f.modules.unsure ? "?" : ""); t.label = stats.length > 5 ? "frigate modules" : "Salvaged Frigate Modules"; }
        if (k === "nanites") { t.big = fmt(f.nanites); t.label = "nanites"; }
        if (k === "value") { t.big = short(f.value); t.unit = "Units"; t.label = "loot value"; }
        if (k === "spookbox") { t.name = (f.spookbox.unsure ? "≈ " : "") + f.spookbox.text; t.sub = f.spookbox.unsure ? "SpookBox · uncertain" : "SpookBox"; }
        if (k === "rooms") { t.big = f.rooms.rooms + " · " + (f.rooms.decks ?? "—"); t.label = "rooms · decks"; }
        if (k === "boxes") { const [cr, fo, br, tl] = f.boxes, part = (v, n) => (v === null ? "—" : v) + " " + n; t.lines = [part(cr, "crates"), part(fo, "footlockers"), part(br, "briefcases"), part(tl, "tall lockers")]; }
        if (k === "reward") {
          if (f.reward && !f.reward.hidden && RCOLOR[f.reward.cls]) t.col = RCOLOR[f.reward.cls];
          t.name = f.reward.hidden ? "Hidden" : f.reward.name; t.sub = f.reward.hidden ? "end reward" : "end reward" + (f.reward.cls ? " · " + f.reward.cls + " class" : "");
        }
        return t;
      });
      const natural = (t, z) => {
        if (t.lines) { c.font = LINE(z); return Math.max(...t.lines.map((l) => c.measureText(l).width)) + 30; }
        if (t.name) { c.font = NAME(z); const a = c.measureText(t.name).width; c.font = LAB(z); return (t.k === "reward" ? Math.round(66 * Math.max(z, .8)) + 34 : 30) + Math.max(a, Math.min(c.measureText(t.sub).width, t.k === "reward" ? 1e9 : 150)); }
        c.font = BIG(z); let bw = c.measureText(t.big).width; if (t.unit) { c.font = UNIT(z); bw += 6 + c.measureText(t.unit).width; }
        c.font = LAB(z); return Math.max(bw, c.measureText(t.label).width) + 30;
      };
      let z = 1, widths;
      for (; ; z -= 0.04) { widths = tiles.map((t) => natural(t, z)); if (widths.reduce((a, b) => a + b, 0) + gap * (tiles.length - 1) <= avail || z <= 0.58) break; }
      const used = widths.reduce((a, b) => a + b, 0) + gap * (tiles.length - 1);
      if (used > avail) { const k = (avail - gap * (tiles.length - 1)) / (used - gap * (tiles.length - 1)); widths = widths.map((w) => w * k); }
      else { const extra = (avail - used) / tiles.length; widths = widths.map((w) => Math.min(w + extra, Math.max(w, 250))); }
      let x = x0;
      tiles.forEach((t, i) => {
        const w = widths[i], col = t.col;
        rr(c, x, top, w, h, 14); c.fillStyle = "#ffffff0a"; c.fill(); c.strokeStyle = col + "66"; c.lineWidth = 1.5; c.stroke();
        if (t.lines) {
          c.fillStyle = col; c.font = LINE(z); const lh = Math.round(24 * Math.max(z, .78));
          t.lines.forEach((l, j) => c.fillText(fit(c, l, w - 26), x + 15, top + (h - lh * 4) / 2 + lh * (j + 0.8)));
        } else if (t.name) {
          const s2 = t.k === "reward" ? Math.round(66 * Math.max(z, .8)) : 0;
          if (rewardImg && s2) c.drawImage(rewardImg, x + 12, top + (h - s2) / 2, s2, s2);
          const tx = s2 ? x + 12 + s2 + 12 : x + 15, tw = w - (tx - x) - 10;
          c.fillStyle = col; c.font = NAME(z); c.fillText(fit(c, t.name, tw), tx, top + h / 2 - 2);
          c.fillStyle = "#94a9bc"; c.font = LAB(z); c.fillText(fit(c, t.sub, tw), tx, top + h / 2 + 22);
        } else {
          c.fillStyle = col; c.font = BIG(z);
          const bigT = fit(c, t.big, w - 28); c.fillText(bigT, x + 15, top + 62);
          if (t.unit) { const bw = c.measureText(bigT).width; c.font = UNIT(z); c.fillText(t.unit, x + 21 + bw, top + 62); }
          c.fillStyle = "#94a9bc"; c.font = LAB(z); c.fillText(fit(c, t.label, w - 28), x + 15, top + 93);
        }
        x += w + gap;
      });
    }
    canvas.dataset.drawn = String(ticket);
  }

  const blobOf = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));

  function mount(dialog) {
    if (dialog.querySelector(".dvb-tabs")) return;
    const head = dialog.querySelector(".dialog-heading");
    const tabs = document.createElement("div");
    tabs.className = "dvb-tabs"; tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", "Share as");
    tabs.innerHTML = '<button type="button" data-mode="photo" aria-pressed="true">Photo</button><button type="button" data-mode="banner" aria-pressed="false">Banner</button>';
    const panel = document.createElement("div");
    panel.className = "dvb-panel"; panel.hidden = true;
    panel.innerHTML = `<div class="dvb-preview"><canvas id="dvb-canvas" width="${W * S}" height="${H * S}" role="img" aria-label="Share banner preview"></canvas></div>
      <fieldset class="dvb-options"><legend>Show on the banner</legend>${ITEMS.map(([k, label]) => `<label data-k="${k}"><input type="checkbox" data-k="${k}"><span>${esc(label)}</span><small class="dvb-na">${k === "spookbox" ? "not known" : "not computed"}</small></label>`).join("")}</fieldset>
      <div class="dvb-actions"><button type="button" id="dvb-copy" class="primary">Copy image</button><button type="button" id="dvb-download">Download PNG</button><button type="button" id="dvb-link">Copy link</button></div>
      <p class="dvb-status" id="dvb-status" role="status"></p>`;
    (head || dialog.firstChild).after(tabs);
    tabs.after(panel);
    const canvas = panel.querySelector("#dvb-canvas"), status = (t) => { panel.querySelector("#dvb-status").textContent = t; };
    let f = null;
    const refresh = () => {
      f = facts();
      panel.querySelectorAll("input[data-k]").forEach((box) => {
        const k = box.dataset.k, ok = available(f, k);
        box.disabled = !ok; box.checked = ok && !!chosen[k];
        box.closest("label").classList.toggle("is-na", !ok);
        if (k === "finder") box.closest("label").hidden = !ok;   // only for a system with a published finder
      });
      if (f) draw(canvas, f); else status("Open a system first.");
    };
    const setMode = (mode) => {
      const banner = mode === "banner";
      dialog.classList.toggle("dvb-banner-mode", banner);
      panel.hidden = !banner;
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      if (banner) { status(""); refresh(); }
    };
    tabs.addEventListener("click", (e) => { const b = e.target.closest("button[data-mode]"); if (b) setMode(b.dataset.mode); });
    panel.addEventListener("change", (e) => {
      const box = e.target.closest("input[data-k]"); if (!box) return;
      chosen[box.dataset.k] = box.checked; saveChoice(); status(""); if (f) draw(canvas, f);
    });
    panel.querySelector("#dvb-download").addEventListener("click", async () => {
      if (!f) return;
      const b = await blobOf(canvas); if (!b) { status("The banner could not be made on this device."); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `derelict-atlas-${f.glyphs || f.address}.png`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      status("Saved the banner as a PNG.");
    });
    panel.querySelector("#dvb-copy").addEventListener("click", async () => {
      if (!f) return;
      try {
        if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("no clipboard");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blobOf(canvas) })]);
        status("Banner copied. Paste it into Discord, Reddit or anywhere.");
      } catch (_) { status("This browser does not allow copying images here. Use Download PNG and attach the file."); }
    });
    panel.querySelector("#dvb-link").addEventListener("click", async () => {
      if (!f) return;
      const url = link(f.address, chosen.reward && f.reward && !f.reward.hidden);
      try { await navigator.clipboard.writeText(url); status("Link copied: " + url); }
      catch (_) { status("Copy the link: " + url); }
    });
    // each time the dialog opens: back to Photo (the dialog's own flow), banner redrawn when chosen
    new MutationObserver(() => { if (dialog.open) { if (dialog.classList.contains("dvb-banner-mode")) refresh(); } else setMode("photo"); })
      .observe(dialog, { attributes: true, attributeFilter: ["open"] });
    window.dvBannerFacts = () => f;
    const sig = (x) => JSON.stringify(x);
    setInterval(() => {
      if (!dialog.open || panel.hidden) return;
      const n = facts();
      if (sig(n) !== sig(f)) refresh();
    }, 1200);
  }
  const tryMount = () => { const d = document.getElementById("share-dialog"); if (d) { mount(d); return true; } return false; };
  if (!tryMount()) {
    const mo = new MutationObserver(() => { if (tryMount()) mo.disconnect(); });
    const start = () => mo.observe(document.body, { childList: true });
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", () => { if (!tryMount()) start(); });
  }
})();
