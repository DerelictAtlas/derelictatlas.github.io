/* embed.js (SITE integration, EMBED1 2026-11-04): the iframe widget. Scans ONE system with our own scanner (scan/w29.json +
 * scan/bulk-worker.js, as the Contribute page) in the visitor's browser and shows the numbers the site owner picked.
 * Nothing is uploaded (partner visitors never consented). Result and height go to the parent page by postMessage:
 *   {type:"derelict-atlas:result", v:1, glyphs, address, galaxy, data:{...}}  {type:"derelict-atlas:size", v:1, height} */
(function () {
  "use strict";
  const SITE = "https://derelictatlas.github.io/";
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const FIELDS = { modules: "Frigate modules", containers: "Containers", crates: "Crates", footlockers: "Footlockers", briefcases: "Briefcases", tall_lockers: "Tall lockers",
    rooms: "Rooms", decks: "Decks", reward: "End reward", loot: "Loot value (units)", nanites: "Nanites", galaxy: "Galaxy", hex: "Hex code" };
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, "0");

  // ---- parameters ----
  let address = "", glyphs = "", galaxy = Math.max(0, Math.min(255, parseInt(q.get("galaxy") || "0", 10) || 0));
  const a16 = (q.get("address") || "").trim().toUpperCase(), g12 = (q.get("glyphs") || "").trim().toUpperCase();
  if (/^[0-9A-F]{16}$/.test(a16)) { address = a16; galaxy = parseInt(a16.slice(6, 8), 16); glyphs = "0" + a16.slice(3, 6) + a16.slice(8); }
  else if (/^[0-9A-F]{12}$/.test(g12)) { glyphs = g12; address = "000" + g12.slice(1, 4) + hex(galaxy, 2) + g12.slice(4); }
  let fields = (q.get("fields") || Object.keys(FIELDS).join()).toLowerCase().split(",").map((s) => s.trim()).filter((s) => FIELDS[s]);
  fields = fields.filter((f, i) => fields.indexOf(f) === i);
  if (!fields.length) fields = Object.keys(FIELDS);
  const theme = q.get("theme") === "light" ? "light" : q.get("theme") !== "auto" ? "dark"
    : (matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  // wallpaper = one of the site's own page backgrounds (backgrounds.js). They are all dark, so the card text stays dark-themed.
  const wallpaper = (q.get("wallpaper") || "").trim().toLowerCase();
  document.documentElement.dataset.theme = /^[a-z]+$/.test(wallpaper) ? "dark" : theme;
  if (/^[a-z]+$/.test(wallpaper)) import("./backgrounds.js").then((m) => {
    const o = m.BACKGROUNDS.find((b) => b.id === wallpaper);
    if (!o) { document.documentElement.dataset.theme = theme; return; }
    const card = $("ea-card"), st = card.style;
    st.setProperty("--wp-fill", o.fill); st.setProperty("--wp-texture", o.texture); st.setProperty("--wp-size", o.size); st.setProperty("--wp-opacity", o.opacity);
    card.classList.add("has-wallpaper");
  }).catch(() => { document.documentElement.dataset.theme = theme; });
  const accent = (q.get("accent") || "").replace(/^#/, "");
  if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) {
    document.documentElement.style.setProperty("--accent", "#" + accent);
    const full = accent.length === 3 ? accent.replace(/./g, "$&$&") : accent, l = [0, 2, 4].map((i) => parseInt(full.substr(i, 2), 16));
    document.documentElement.style.setProperty("--on-accent", (0.299 * l[0] + 0.587 * l[1] + 0.114 * l[2]) > 150 ? "#07131e" : "#ffffff");
  }
  if (q.get("compact") === "1") document.body.classList.add("compact");
  // layout: feature (default) | tiles | rows | inline | cards. raw=1: no card, the data as JSON, for sites that build their own display
  const layout = ["feature", "tiles", "rows", "inline", "cards"].includes(q.get("layout")) ? q.get("layout") : "feature";
  document.body.classList.add("layout-" + layout);
  document.documentElement.style.scrollbarWidth = "none"; // a scrollbar would narrow the card and make the frame height flip-flop
  const RAW = q.get("raw") === "1";
  // preview=1 is only set by the builder's own preview: changing a setting there reuses the scan and keeps the reward open.
  // The snippet for other sites never has it, so their visitors always get a fresh scan and nothing is stored.
  const PREVIEW = q.get("preview") === "1";
  const remember = (k, v) => { if (PREVIEW) try { sessionStorage.setItem(k + address, v); } catch (_) {} };
  const recall = (k) => { if (PREVIEW) try { return sessionStorage.getItem(k + address); } catch (_) {} return null; };
  if (RAW) { $("ea-card").hidden = true; $("ea-raw").hidden = false; }
  const label = (q.get("button") || "").trim().slice(0, 40) || "Open in Derelict Atlas";
  const open = $("ea-open");
  open.textContent = label + " ↗";
  if (address) open.href = SITE + "#/d/" + address;
  // show_glyphs=1: the portal glyphs as pictures (the site's own glyphs-svg set); off = no glyphs at all
  const row = $("ea-glyphs");
  if (q.get("show_glyphs") === "1" && glyphs) {
    row.hidden = false; row.setAttribute("aria-label", "Portal glyphs " + glyphs); $("ea-card").classList.add("has-glyphs");
    for (const ch of glyphs) { const i = document.createElement("img"); i.src = "glyphs-svg/" + ch.toLowerCase() + ".svg"; i.alt = ""; row.appendChild(i); }
  }

  // ---- messages to the parent ----
  const post = (m) => { try { if (parent !== window) parent.postMessage(m, "*"); } catch (_) {} };
  let lastH = 0;
  const size = () => { const h = Math.ceil(document.documentElement.getBoundingClientRect().height); if (h !== lastH) { lastH = h; post({ type: "derelict-atlas:size", v: 1, height: h }); } };
  if (window.ResizeObserver) new ResizeObserver(size).observe(document.body);
  addEventListener("load", size);

  // ---- result ----
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // the reward's own icon, as on the atlas (reward-icons/<type>-<class>.svg). Icon and class stay out of the page until the visitor clicks.
  function reveal(r, dd, box, bigIcon) {
    remember("ea-open:", "1");
    const cls = /^[CBAS]$/.test(r.class) ? r.class : "";
    import("./reward-types.js").then((m) => m.rewardType(r.name)).catch(() => "unknown").then((type) => {
      const src = "reward-icons/" + type + (cls && type !== "unknown" ? "-" + cls : "") + ".svg";
      dd.textContent = ""; box.dataset.cls = cls || "none";
      if (bigIcon) bigIcon.src = src;
      else { const i = el("img", "ea-mini-icon"); i.src = src; i.alt = ""; dd.appendChild(i); }
      if (cls) dd.append(el("span", "ea-badge", cls), el("span", "ea-dot", "·"));
      dd.append(el("span", "ea-reward-name", r.name));
      size();
    });
  }
  const galaxyName = () => window.dvGalaxy ? window.dvGalaxy.label(galaxy) : galaxy === 0 ? "Euclid" : "Galaxy " + (galaxy + 1); // the game counts from 1; names from site-galaxy.js (byte 255 unnamed)
  const value = (d, f) => f === "galaxy" ? galaxyName() : f === "hex" ? glyphs : d[f] == null ? "–" : (f === "modules" && d.modules_ambiguous ? "≈ " : "") + fmt(d[f]);
  // layout=feature: modules and reward up top, the other numbers in two lists
  function showFeature(d) {
    const out = $("ea-feature"); out.hidden = false; out.textContent = "";
    const ids = ["galaxy", "hex"].filter((f) => fields.includes(f));
    if (ids.length) {
      const meta = el("dl", "ea-meta");
      for (const f of ids) { const r = el("div"), v = el("dd", "", value(d, f)); v.dataset.field = f; r.append(el("dt", "", FIELDS[f]), v); meta.appendChild(r); }
      out.appendChild(meta);
    }
    if (fields.includes("modules") || fields.includes("reward")) {
      const top = el("dl", "ea-heroes");
      if (fields.includes("modules")) {
        const b = el("div", "ea-hero ea-hero-modules");
        b.append(el("dt", "", d.modules === 1 ? "Frigate module" : "Frigate modules"), el("dd", "", value(d, "modules")));
        top.appendChild(b);
      }
      if (fields.includes("reward")) {
        const b = el("div", "ea-hero ea-hero-reward"), i = el("img", "ea-reward-icon"), dd = el("dd");
        i.alt = ""; i.src = "reward-icons/" + (d.reward ? "hidden" : "unknown") + ".svg"; dd.dataset.field = "reward";
        if (!d.reward) dd.textContent = "not available";
        else { const c = el("button", "ea-reveal", "Click to reveal"); c.type = "button"; c.addEventListener("click", () => reveal(d.reward, dd, b, i)); dd.appendChild(c); }
        b.append(i, el("dt", "", "End reward"), dd); top.appendChild(b);
      }
      out.appendChild(top);
    }
    const lists = el("div", "ea-lists");
    for (const group of [["containers", "crates", "footlockers", "briefcases", "tall_lockers"], ["rooms", "decks", "loot", "nanites"]]) {
      const use = group.filter((f) => fields.includes(f));
      if (!use.length) continue;
      const list = el("dl", "ea-list");
      for (const f of use) {
        const r = el("div", "ea-row" + (f === "containers" ? " ea-gold" : ""));
        const v = value(d, f);
        r.append(el("dt", "", f === "loot" ? "Loot value" : FIELDS[f]), el("dd", "", f === "loot" && d[f] != null ? v + " units" : v));
        r.lastChild.dataset.field = f; list.appendChild(r);
      }
      lists.appendChild(list);
    }
    if (lists.children.length) out.appendChild(lists);
  }
  function show(d) {
    const grid = $("ea-grid"), msg = $("ea-msg");
    msg.hidden = true;
    if (layout === "feature") { showFeature(d); size(); return; }
    grid.hidden = false; grid.textContent = "";
    for (const f of fields) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"), box = document.createElement("div");
      box.className = "ea-stat"; dt.textContent = FIELDS[f]; dd.dataset.field = f;
      if (f === "hex") box.classList.add("wide");
      if (f === "reward") {
        box.classList.add("wide");
        if (!d.reward) dd.textContent = "not available";
        else {
          const b = el("button", "ea-reveal", "Click to reveal"); b.type = "button";
          b.addEventListener("click", () => reveal(d.reward, dd, box)); dd.appendChild(b);
        }
      } else dd.textContent = value(d, f);
      box.append(dt, dd); grid.appendChild(box);
    }
    size();
  }
  function fail(text) { const m = $("ea-msg"); m.textContent = text; m.classList.add("err"); m.hidden = false; $("ea-grid").hidden = true; $("ea-feature").hidden = true; size(); }
  function emit(data, error, raw) {
    const m = { type: "derelict-atlas:result", v: 1, glyphs, address, galaxy, url: address ? SITE + "#/d/" + address : SITE, data, error: error || undefined };
    if (RAW) { if (raw) m.raw = raw; $("ea-raw").textContent = JSON.stringify(m, null, 2); size(); }
    post(m);
  }

  if (!address) { fail("Missing or invalid system: pass glyphs (12 hex digits) or address (16 hex digits)."); emit(null, "invalid system"); return; }
  function scanned(d) {
      if (!d.ok) { fail("The scanner could not run: " + (d.error || "unknown error")); emit(null, d.error || "scanner error"); return; }
      if (d.status !== 0 || !d.row) { fail("No derelict freighter in this system."); emit(null, "no derelict"); return; }
      const r = d.row, n = (x) => (x == null || x === "" ? null : Number(x));
      const data = { modules: n(r.frigate_modules), modules_ambiguous: !!r.frigate_modules_ambiguous,
        crates: n(r.crates) || 0, footlockers: n(r.footlockers) || 0, briefcases: n(r.briefcases) || 0, tall_lockers: n(r.tall_lockers) || 0,
        rooms: n(r.rooms), decks: n(r.floors), loot: n(r.items_value), nanites: n(r.items_nanites),
        reward: r.reward_name ? { name: r.reward_name, class: r.reward_class || "" } : null };
      data.containers = data.crates + data.footlockers + data.briefcases + data.tall_lockers;
      // the end reward is only passed on when the site owner asked for it (hidden by default, like the atlas)
      const wantReward = fields.indexOf("reward") >= 0;
      if (!wantReward) delete data.reward;
      show(data);
      if (recall("ea-open:")) { const b = document.querySelector(".ea-reveal"); if (b) b.click(); }
      if (!RAW) { emit(data); return; }
      const raw = {};
      for (const k of Object.keys(r)) if (wantReward || !/reward/i.test(k)) raw[k] = r[k];
      emit(data, null, raw);
  }
  try { const c = recall("ea-scan:"); if (c) { scanned(JSON.parse(c)); return; } } catch (_) {}
  fetch("scan/w29.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then((m) => {
    const ver = String(m.js_sha256 || "").slice(0, 8) + String(m.wasm_sha256 || "").slice(0, 8);
    const w = new Worker("scan/bulk-worker.js?v=" + encodeURIComponent(ver));
    w.onmessage = (e) => {
      const d = e.data || {}; w.terminate();
      if (d.ok) remember("ea-scan:", JSON.stringify(d));
      scanned(d);
    };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); fail("The scanner could not be loaded."); emit(null, "scanner load"); };
    w.postMessage({ address });
  }).catch((e) => { fail("The scanner could not start (network problem)."); emit(null, String(e && e.message || e)); });
})();
