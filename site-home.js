/* site-home.js (SITE integration, user 2026-11-01): the home screen ("main menu").
 * User: "when pressing the logo it currently only wipes the system address in the browser bar, i want a main menu
 * screen, this will display top 1-3 systems in each category with some nice numbers, and then it will display the
 * worst of the worst as well, but fewer, give all some nice coloring so people can see that some are good and some
 * are bad".
 * v2 (user 2026-11-01): the layout of the user's mockup "Color-coded Derelict Atlas ranking dashboard" (HOME | WHAT ARE
 * YOU HUNTING?, a coloured band per category with 3 cards, WORST OF THE WORST at the bottom), the pictures are the
 * user's own (home/*.webp), and above the bands two trivia facts (user: "add those two as interesting trivia to the
 * home page"): the first and the last possible system address (worked out with the W29d region rules). On a PC the
 * whole screen fits the window without scrolling (user requirement); on a phone it scrolls.
 * The home screen lives in the viewer panel (#viewer-empty, the redesign's "no system open" state): on a PC beside the
 * Systems list, on a phone in the Viewer tab. #/ (no system) shows it; the logo opens it. modern.js calls
 *   dvHome.show()          route() / openFirst() when no system is open (modern.js has just closed the viewer)
 *   dvHome.takeTab()       the tab route() switches to: "viewer" after a logo tap on a phone, else "systems"
 *   dvHome.setRows(rows,x) the full atlas rows (x = true once the loot values from views/extras are in the rows)
 * Rankings use only data the site already loaded (the rows of the Systems list). Placeholder cards keep their size
 * until the rows arrive, so nothing moves when the numbers fill in.
 *
 * Best (top 3 each; device-scanned rows are not in the atlas and are left out):
 *   Most modules       = the Systems list's "Best overall" order (core.js systemQuery: modules, certain before "?",
 *                        then all containers, loot value, nanites, fewer rooms, fewer decks, address)
 *   Most nanites       = items_nanites then items_value, address. Only the systems with loot values (views/extras).
 *   Highest loot value = items_value (Units) then nanites, address. Same systems.
 *   Most SpookBox packages = the amount n of the SpookBox ("<package>x<n>" in views/extras), certain before "≈",
 *                        then the SpookBox sale value, loot value, address
 * Worst (two; only systems with known modules, rooms and all four container groups, modules certain):
 *   Lowest yield       = fewest modules, then fewest containers, most rooms, most decks, address
 */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : fmt(n));
  const byAddr = (a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  // the Systems list's total (core.js totalOf with all four container groups: the known ones summed)
  const total = (r) => (r.salvage_crates || 0) + (r.footlockers || 0) + (r.briefcases || 0) + (r.tall_lockers || 0);
  // known = every container group counted (user 2026-11-01: "the one on the right and left DO have containers, they have
  // tall lockers and briefcases"): 55,762 older systems have no briefcase/tall-locker count yet, which is not 0
  const partial = (r) => r.briefcases == null || r.tall_lockers == null;
  const known = (r) => r.rooms != null && r.salvage_crates != null && r.footlockers != null && r.frigate_modules != null && !partial(r);
  const atlasRow = (r) => r && !r.device && /^[0-9A-F]{16}$/.test(r.address || "");
  const amb = (r) => (r.frigate_modules_ambiguous ? 1 : 0);
  // SpookBox "<k>x<n>" (atlas-features.js parseSpookbox): n = how many packages
  const spook = (r) => { const m = /^(\d+)x(\d+)$/i.exec(String((r.extras && r.extras.spookbox) || "").trim()); return m ? Number(m[2]) : null; };
  const spookAmb = (r) => !!r.extras && (r.extras.spookbox_ambiguous === "1" || r.extras.spookbox_ambiguous === "true");
  const spookValue = (r) => { const v = r.extras && r.extras.spookbox_value; return v === undefined || v === "" || !Number.isFinite(Number(v)) ? -1 : Number(v); };
  const SPOOK_ITEMS = ["", "Preserved Brain", "Preserved Grub", "Preserved Sample", "Preserved Eyeball", "Preserved Egg", "Preserved Horror"];

  const overall = (a, b) => {
    const ma = a.frigate_modules, mb = b.frigate_modules;
    if (ma == null || mb == null) { if (ma != null) return -1; if (mb != null) return 1; } else if (mb !== ma) return mb - ma;
    return amb(a) - amb(b) || total(b) - total(a)
      || (b.items_value ?? -1) - (a.items_value ?? -1) || (b.items_nanites ?? -1) - (a.items_nanites ?? -1)
      || (a.rooms ?? 1e9) - (b.rooms ?? 1e9) || (a.floors ?? 1e9) - (b.floors ?? 1e9) || byAddr(a, b);
  };

  // inline icons (stroke = currentColor)
  const HEX = '<path d="M32 3 57 17.5v29L32 61 7 46.5v-29Z" fill="none" stroke="currentColor" stroke-width="2.6"/>';
  const ICON = {
    modules: '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M20 22h24v7H20zM20 31h24v7H20zM20 40h24v7H20z"/><path d="M24 25.5h4M24 34.5h4M24 43.5h4M36 25.5h4M36 34.5h4M36 43.5h4"/><path d="M28 18v4M36 18v4"/></g>',
    nanites: '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M32 16 47 24 32 32 17 24Z"/><path d="M17 31l15 8 15-8M17 38l15 8 15-8"/></g>',
    value: '<g fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="32" cy="32" r="13"/><path d="M24 28h16M24 36h16M32 21v22"/></g>',
    spookbox: '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M32 17 45 24v15L32 46 19 39V24Z"/><path d="M19 24l13 7 13-7M32 31v15"/></g>',
  };
  const icon = (id) => `<svg class="sh-hexico" viewBox="0 0 64 64" aria-hidden="true">${HEX}${ICON[id]}</svg>`;
  const SKULL = '<svg class="sh-skull" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M32 5C18 5 9 14.5 9 27c0 7.5 3.4 13 8.5 16.3V51a4 4 0 0 0 4 4h3v-6h4v6h7v-6h4v6h3a4 4 0 0 0 4-4v-7.7C51.6 40 55 34.5 55 27 55 14.5 46 5 32 5Zm-9.5 19.5a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4Zm19 0a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4ZM32 38.5l3.8 6.5h-7.6Z"/></svg>';
  const HOUSE = '<svg class="sh-house" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3Z"/></svg>';
  const MAPICO = '<svg viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="4.5" width="15" height="11" rx="1"/><path d="M2.5 9.5h15M9 4.5v11M13 9.5v6"/></g></svg>';
  const glyphRow = (g) => [...String(g || "")].map((c) => `<img src="glyphs-svg/${c.toLowerCase()}.svg" alt="">`).join("");

  const CATS = [
    { id: "modules", title: "Most modules", text: "Systems with the most upgrade modules.", use: (r) => r.frigate_modules != null, cmp: overall,
      big: (r) => [String(r.frigate_modules) + (amb(r) ? "?" : ""), r.frigate_modules === 1 ? "module" : "modules"],
      tip: (r) => (amb(r) ? "The module count is a prediction that could be lower (?)" : "") },
    { id: "nanites", title: "Most nanites", text: "Systems with the highest nanite rewards.", loot: true, use: (r) => r.items_nanites != null,
      cmp: (a, b) => b.items_nanites - a.items_nanites || (b.items_value ?? -1) - (a.items_value ?? -1) || byAddr(a, b),
      big: (r) => [fmt(r.items_nanites), "nanites"], tip: () => "Nanites from the loot, after refining" },
    { id: "value", title: "Highest loot value", text: "Systems with the highest total loot value.", loot: true, use: (r) => r.items_value != null,
      cmp: (a, b) => b.items_value - a.items_value || (b.items_nanites ?? -1) - (a.items_nanites ?? -1) || byAddr(a, b),
      big: (r) => [compact(r.items_value), "Units"], tip: (r) => fmt(r.items_value) + " Units (estimated value of all loot)" },
    { id: "spookbox", title: "Most SpookBox packages", text: "Systems with the most SpookBox packages.", loot: true, use: (r) => (spook(r) || 0) > 0,
      cmp: (a, b) => spook(b) - spook(a) || (spookAmb(a) ? 1 : 0) - (spookAmb(b) ? 1 : 0) || spookValue(b) - spookValue(a) || (b.items_value ?? -1) - (a.items_value ?? -1) || byAddr(a, b),
      big: (r) => [(spookAmb(r) ? "≈" : "") + spook(r), spook(r) === 1 ? "package" : "packages"],
      tip: (r) => { const m = /^(\d+)x/.exec(r.extras.spookbox); const it = m ? SPOOK_ITEMS[Number(m[1])] : ""; const v = spookValue(r);
        return `SpookBox (NMS 7.10+): ${it ? it + " " : ""}×${spook(r)}${v >= 0 ? ", sells for " + fmt(v) + " Units" : ""}${spookAmb(r) ? " (prediction could differ)" : ""}`; } },
  ];
  const WORST = { id: "worst", use: (r) => known(r) && !amb(r),
    cmp: (a, b) => a.frigate_modules - b.frigate_modules || total(a) - total(b) || b.rooms - a.rooms || (b.floors ?? 0) - (a.floors ?? 0) || byAddr(a, b) };
  // the first and the last possible system address (W29d region rules, site agent 2026-11-01); atlas address =
  // "000" + system + galaxy + YY ZZZ XXX (the planet glyph is not part of it)
  const TRIVIA = [
    { tag: "First possible system", glyphs: "000100000008", address: "0000010000000008", short: "System 001, first region outside the core",
      text: "System 001 in the first region outside the galaxy core, 8 regions from the centre (the core reaches 7 regions out; system 000 never exists)." },
    { tag: "Last possible system", glyphs: "04287F7FF7FF", address: "000428007F7FF7FF", short: "Purple system 428, the galaxy's far corner",
      text: "Purple system 428, the last of the purple systems 3E8–428 every region has, in the far corner of the galaxy (X +2047, Y +127, Z +2047)." },
  ];

  // top k under cmp, one pass (no full sort of 300k rows)
  function topK(rows, use, cmp, k) {
    const out = [];
    for (const r of rows) {
      if (!atlasRow(r) || !use(r)) continue;
      if (out.length === k && cmp(r, out[k - 1]) >= 0) continue;
      let i = out.length; while (i > 0 && cmp(r, out[i - 1]) < 0) i--;
      out.splice(i, 0, r); if (out.length > k) out.pop();
    }
    return out;
  }

  let root = null, rows = null, withLoot = false, wantViewer = false, pending = 0;
  const phone = () => matchMedia("(max-width:700px)").matches;
  const roomsText = (r) => `${r.rooms ?? "–"} ${r.rooms === 1 ? "room" : "rooms"} · ${r.floors ?? "–"} ${r.floors === 1 ? "deck" : "decks"}`;

  function cardHtml(cat, i, r) {
    const img = `<img class="sh-img" src="home/${cat.id}-${i + 1}.webp" alt="" decoding="async">`;
    const rank = `<span class="sh-rank">${i + 1}</span>${i === 0 ? '<span class="sh-top">Top pick</span>' : ""}`;
    const cls = `sh-card sh-r${i + 1}`;
    if (!r) return `<div class="${cls} sh-wait" aria-hidden="true">${rank}${img}<span class="sh-body"><span class="sh-hex">&nbsp;</span><span class="sh-glyphs"></span><span class="sh-foot"><span class="sh-big"><b>…</b><small>ranking</small></span><span class="sh-rooms">&nbsp;</span></span></span></div>`;
    const [big, unit] = cat.big(r);
    const name = (window.dvSystemName && window.dvSystemName(r.address)) || "";
    const tip = [name, cat.tip(r)].filter(Boolean).join(" · ");
    return `<a class="${cls}" href="#/d/${r.address}" data-address="${r.address}" aria-label="${esc(cat.title)} number ${i + 1}: ${esc(big + " " + unit)}, ${esc(name || r.glyphs)}"${tip ? ` title="${esc(tip)}"` : ""}>`
      + rank + img
      + `<span class="sh-body"><span class="sh-hex">${esc(r.glyphs)}</span><span class="sh-glyphs">${glyphRow(r.glyphs)}</span>`
      + `<span class="sh-foot"><span class="sh-big"><b>${esc(big)}</b><small>${esc(unit)}</small></span><span class="sh-rooms">${esc(roomsText(r))}</span></span></span>`
      + `<span class="sh-chev" aria-hidden="true">»</span><span class="sh-mapico" aria-hidden="true">${MAPICO}</span></a>`;
  }

  function worstHtml(i, r) {
    const img = `<img class="sh-img" src="home/worst-${i + 1}.webp" alt="" decoding="async">`;
    if (!r) return `<div class="sh-card sh-bad sh-wait" aria-hidden="true">${img}<span class="sh-body"><span class="sh-hex">&nbsp;</span><span class="sh-glyphs"></span><span class="sh-big"><b>…</b><small>ranking</small></span></span></div>`;
    const m = r.frigate_modules, t = total(r);
    const name = (window.dvSystemName && window.dvSystemName(r.address)) || "";
    return `<a class="sh-card sh-bad" href="#/d/${r.address}" data-address="${r.address}" aria-label="Worst of the worst: ${m} modules, ${t} boxes, ${esc(name || r.glyphs)}" title="${esc([name, roomsText(r), "boxes = crates, footlockers, briefcases and tall lockers"].filter(Boolean).join(" · "))}">`
      + img + `<span class="sh-body"><span class="sh-low">Low yield</span><span class="sh-hex">${esc(r.glyphs)}</span><span class="sh-glyphs">${glyphRow(r.glyphs)}</span>`
      + `<span class="sh-big"><b>${m}</b><small>${m === 1 ? "module" : "modules"}</small><i>/</i><b>${fmt(t)}</b><small>${t === 1 ? "box" : "boxes"}</small></span></span>`
      + `<span class="sh-chev" aria-hidden="true">›</span><span class="sh-mapico" aria-hidden="true">${MAPICO}</span></a>`;
  }

  function render() {
    if (!root) return;
    for (const cat of CATS) {
      const picks = !rows || (cat.loot && !withLoot) ? [] : topK(rows, cat.use, cat.cmp, 3);
      const box = root.querySelector(`.sh-row[data-cat="${cat.id}"] .sh-cards`);
      box.innerHTML = [0, 1, 2].map((i) => cardHtml(cat, i, picks[i])).join("");
    }
    const worst = rows ? topK(rows, WORST.use, WORST.cmp, 2) : [];
    root.querySelector('.sh-row[data-cat="worst"] .sh-cards').innerHTML = [0, 1].map((i) => worstHtml(i, worst[i])).join("");
  }

  function init() {
    if (root) return root;
    const empty = document.getElementById("viewer-empty");
    if (!empty) return null;
    const btn = document.getElementById("choose-system");  // modern.js's handler stays on the moved button (phone: to the Systems list)
    empty.className = "site-home";
    const rowsHtml = CATS.map((c) => `<section class="sh-row sh-c-${c.id}" data-cat="${c.id}" aria-label="${esc(c.title)}"><div class="sh-lead">${icon(c.id)}<div><h2>${esc(c.title)}</h2><p>${esc(c.text)}</p></div></div><div class="sh-cards"></div></section>`).join("")
      + `<section class="sh-row sh-c-worst" data-cat="worst" aria-label="Worst of the worst"><div class="sh-lead">${SKULL}<div><h2>Worst of the worst</h2><p>Lowest yield derelicts in our database.</p></div></div><div class="sh-cards"></div></section>`;
    const trivia = TRIVIA.map((t) => `<a class="sh-fact" href="#/d/${t.address}" data-address="${t.address}" title="${esc(t.text)}"><small>${esc(t.tag)}</small><span class="sh-hex">${t.glyphs}</span><span class="sh-glyphs">${glyphRow(t.glyphs)}</span><span class="sh-fact-text">${esc(t.short)}</span></a>`).join("");
    empty.innerHTML = `<div class="sh-head">${HOUSE}<b>Home</b><span class="sh-sep" aria-hidden="true"></span><h1>What are you hunting?</h1><span class="sh-act"></span></div>`
      + `<div class="sh-trivia" aria-label="Trivia"><span class="sh-trivia-tag">Did you know?</span>${trivia}</div>`
      + `<div class="sh-rows">${rowsHtml}</div>`;
    if (btn) empty.querySelector(".sh-act").appendChild(btn);
    root = empty;
    render();
    if (window.dvNamesReady) Promise.resolve(window.dvNamesReady).then(() => { if (rows) render(); }, () => {});
    return root;
  }

  function schedule() {
    const id = ++pending;
    setTimeout(() => { if (id === pending) render(); }, 0);
  }

  window.dvHome = {
    show() { init(); const e = document.getElementById("viewer-empty"); if (e) { e.hidden = false; e.scrollTop = 0; } },
    showing() { const e = document.getElementById("viewer-empty"); return !!(e && !e.hidden); },
    takeTab() { const t = wantViewer ? "viewer" : "systems"; wantViewer = false; return t; },
    setRows(next, loot) { if (!Array.isArray(next) || !next.length) return; rows = next; if (loot) withLoot = true; init(); schedule(); },
  };

  // the logo opens the home screen (also when the address bar already says #/)
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.brand");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!document.getElementById("viewer")) return;  // not the main page
    e.preventDefault();
    wantViewer = phone();
    if (location.hash && location.hash !== "#/" && location.hash !== "#") location.hash = "#/";
    else window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo(0, 0);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
