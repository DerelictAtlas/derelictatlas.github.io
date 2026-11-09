/* site-home.js (SITE integration, user 2026-11-01, v148 2026-11-08): the home screen ("main menu").
 * v148 (user 2026-11-08, mockup near-mockups/7-home.png): live cards, no picture slot. A top strip (the first and the last
 * possible system in Euclid), four big cards (2 by 2: Most frigate modules, Most nanites, Highest loot value, Most SpookBox
 * packages, each with the user's own picture home/<cat>-1.webp) and 12 small cards (4 per row, top 3 each): Most containers,
 * Most crates + footlockers, Most crates, Most footlockers, Most briefcases, Most tall lockers, Most rooms, Most stairs,
 * Most ships, Best end reward, Fewest frigate modules, Fewest crates. Every card has "Top 100 ↗" = dvShowList(name)
 * (modern.js: the Systems list with that list chosen in the sort dropdown). "Worst of the worst" is gone (the Fewest cards
 * replace it), and so are the picture slot and hotspots (site-home-lists.js is not built any more).
 * On a PC the whole screen fits the window without scrolling (cards are size containers; type scales with them); on a phone
 * it is one column and scrolls.
 * The Systems panel on the left can be minimized to a narrow strip (button in its heading, remembered in localStorage
 * dv.sysmin.v1; window.dvSysMin.set(false) expands it, dvShowList does that). Not on a phone (tabs).
 *
 * The home screen lives in the viewer panel (#viewer-empty, the redesign's "no system open" state): on a PC beside the
 * Systems list, on a phone in the Viewer tab. #/ (no system) shows it; the logo opens it. modern.js calls
 *   dvHome.show()          route() / openFirst() when no system is open (modern.js has just closed the viewer)
 *   dvHome.takeTab()       the tab route() switches to: "viewer" after a logo tap on a phone, else "systems"
 *   dvHome.setRows(rows,x) the full atlas rows (x = true once the loot values from views/extras are in the rows)
 *   dvHome.rows()          -> {rows, loot} (or null before they arrive), for the rank of a top-100 lookup scan
 * Rankings use only data the site already loaded (the rows of the Systems list).
 *
 * The four big cards (old data sources, device-scanned rows left out):
 *   Most modules       = the Systems list's "Best overall" order (core.js systemQuery)
 *   Most nanites       = items_nanites then items_value, address. Only the systems with loot values (views/extras).
 *   Highest loot value = items_value (Units) then nanites, address. Same systems.
 *   Most SpookBox packages = the amount n of the SpookBox, certain before "≈", then sale value, loot value, address
 * The small cards use the published top-100 lists (rows' map bit + stats/systems.json map_lists, key = core.js topKey),
 * so a card equals the number 1 to 3 of its list in the Systems sort dropdown. Two lists are not published yet and are
 * worked out here from the rows (CLIENT_LISTS below, one function per list; deleting a line, or the scanner publishing the
 * same name in map_lists, switches that list to the published data):
 *   containers (bit 262144) = crates + footlockers + briefcases + tall lockers, only systems with all four counts, most
 *                first, ties by crates, then crates + footlockers, then address
 * The hangar-pieces list (bit 131072) was dropped (user 2026-11-09). "Most ships" (bit 524288) is published only (no client
 * list): the rows get r.ships from views/ships.csv.gz (modern.js); until stats/systems.json lists "ships" the card says
 * "Not available yet".
 * Best end reward never shows a grade or a reward: "Hidden", click opens the system, the reward stays hidden there.
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
  const glyphRow = (g) => [...String(g || "")].map((c) => `<img src="glyphs-svg/${c.toLowerCase()}.svg" alt="">`).join("");

  const CATS = [
    { id: "modules", title: "Most frigate modules", text: "Systems with the most upgrade modules.", use: (r) => r.frigate_modules != null, cmp: overall,
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
  // the first and the last possible system address (W29d region rules, site agent 2026-11-01); atlas address =
  // "000" + system + galaxy + YY ZZZ XXX (the planet glyph is not part of it)
  const TRIVIA = [
    { tag: "First possible system in Euclid", glyphs: "000100000008", address: "0000010000000008", short: "System 001, first region outside the core",
      text: "In Euclid: system 001 in the first region outside the galaxy core, 8 regions from the centre (the core reaches 7 regions out; system 000 never exists)." },
    { tag: "Last possible system in Euclid", glyphs: "04287F7FF7FF", address: "000428007F7FF7FF", short: "Purple system 428, the galaxy's far corner",
      text: "In Euclid: purple system 428, the last of the purple systems 3E8–428 every region has, in the far corner of the galaxy (X +2047, Y +127, Z +2047)." },
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

  const pluralize = (n, one, many) => (n === 1 ? one : many);
  const sum4 = (r) => (r.salvage_crates || 0) + (r.footlockers || 0) + (r.briefcases || 0) + (r.tall_lockers || 0);
  const has4 = (r) => [r.salvage_crates, r.footlockers, r.briefcases, r.tall_lockers].every((v) => v != null && Number.isFinite(Number(v)));
  // ---- the two lists the scanner does not publish yet: ONE function per list (delete a line = use the published list) ----
  // bit = the map bit the scanner will publish the list under (same rules, so switching to the published data changes nothing)
  const cf = (r) => (r.salvage_crates || 0) + (r.footlockers || 0);  // the scanner's "total" = crates + footlockers
  const CLIENT_LISTS = {
    containers: { bit: 262144, use: has4, cmp: (a, b) => sum4(b) - sum4(a) || b.salvage_crates - a.salvage_crates || cf(b) - cf(a) || byAddr(a, b) },
  };
  let clientCache = null;
  const publishedSpec = (name) => (window.dvTopSpecs && window.dvTopSpecs[name]) || null;
  function clientTop(name) {  // the top 100 rows of a client list, cached per rows array; null = published instead / no rows
    const L = CLIENT_LISTS[name];
    if (!L || publishedSpec(name) || !rows) return null;
    if (!clientCache || clientCache.rows !== rows) clientCache = { rows };
    if (!clientCache[name]) clientCache[name] = topK(rows, L.use, L.cmp, 100);
    return clientCache[name];
  }
  // modern.js dvTopSpecOf: address -> position, for the Systems list's own order
  window.dvClientRank = (name) => { const t = clientTop(name); return t ? new Map(t.map((r, i) => [r.address, i])) : null; };

  const ICON2 = {  // small card icons (stroke = currentColor, 24x24)
    containers: '<path d="M4 9 12 5l8 4v8l-8 4-8-4Z M4 9l8 4 8-4 M12 13v8"/>',
    total: '<path d="M4 8 12 4l8 4v9l-8 4-8-4Z M4 8l8 4 8-4 M12 12v9"/>',
    crates: '<path d="M4 7h16v13H4Z M4 11h16 M9 7v4 M15 7v4"/>',
    footlockers: '<path d="M7 5h10v15H7Z M7 10h10 M10 13h4"/>',
    briefcases: '<path d="M3 8h18v12H3Z M9 8V5h6v3 M3 13h18 M11 13v2h2v-2"/>',
    tall_lockers: '<path d="M8 3h8v18H8Z M12 3v18 M10 11v2 M14 11v2"/>',
    rooms: '<path d="M4 20V9l8-5 8 5v11Z M10 20v-6h4v6"/>',
    stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
    ships: '<path d="M3 15 12 4l9 11-9 5Z M7 15h10 M12 4v16"/>',
    reward: '<path d="M12 3 20 9l-8 12L4 9Z M4 9h16 M9 9l3 12 3-12"/>',
    frigate_modules_lowest: '<path d="M6 7h12v4H6Z M6 13h12v4H6Z M9 9h2 M9 15h2"/>',
    crates_lowest: '<path d="M4 7h16v13H4Z M4 11h16 M9 7v4 M15 7v4"/>',
  };
  const ico2 = (id) => `<svg class="sh-ico2" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${ICON2[id] || ""}</svg>`;
  const num0 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  // the 12 small cards in order (a list in CLIENT_LISTS and not published is worked out here, the others use the published top 100)
  const SMALL = [
    { id: "containers", title: "Most containers", tip: "Crates, footlockers, briefcases and tall lockers together (systems with all four counts)", val: sum4, unit: (n) => pluralize(n, "container", "containers") },
    { id: "total", title: "Most crates + footlockers", val: (r) => (r.salvage_crates || 0) + (r.footlockers || 0), unit: () => "total" },
    { id: "crates", title: "Most crates", val: (r) => num0(r.salvage_crates), unit: (n) => pluralize(n, "crate", "crates") },
    { id: "footlockers", title: "Most footlockers", val: (r) => num0(r.footlockers), unit: (n) => pluralize(n, "footlocker", "footlockers") },
    { id: "briefcases", title: "Most briefcases", val: (r) => num0(r.briefcases), unit: (n) => pluralize(n, "briefcase", "briefcases") },
    { id: "tall_lockers", title: "Most tall lockers", val: (r) => num0(r.tall_lockers), unit: (n) => pluralize(n, "tall locker", "tall lockers") },
    { id: "rooms", title: "Most rooms", val: (r) => num0(r.rooms), unit: (n) => pluralize(n, "room", "rooms") },
    { id: "stairs", title: "Most stairs", val: (r) => num0(r.stair_pieces), unit: (n) => pluralize(n, "stair", "stairs") },
    { id: "ships", title: "Most ships", published: true, tip: "Ships in the hangar room (one per salvage ship piece). Systems without a ship count are not counted.", val: (r) => num0(r.ships), unit: (n) => pluralize(n, "ship", "ships") },
    { id: "reward", title: "Best end reward", hidden: true, note: "click to reveal", tip: "The end reward stays hidden until you reveal it in the viewer" },
    { id: "frigate_modules_lowest", title: "Fewest frigate modules", val: (r) => num0(r.frigate_modules), unit: (n) => pluralize(n, "module", "modules") },
    { id: "crates_lowest", title: "Fewest crates", val: (r) => num0(r.salvage_crates), unit: (n) => pluralize(n, "crate", "crates") },
  ];
  // the Top 100 list each big card opens (spookbox: the plain sort, there is no top 100 list for it)
  const BIG_LIST = { modules: "frigate_modules", nanites: "items_nanites", value: "items_value", spookbox: "spookbox" };

  // published lists: rows with a map bit are the few hundred top-100 members; the key is core.js topKey
  let mapCache = null;
  function top3Published(name) {
    const specs = window.dvTopSpecs, key = window.dvTopKey, spec = specs && specs[name];
    if (!rows || !spec || typeof key !== "function") return null;
    if (!mapCache || mapCache.rows !== rows) mapCache = { rows, list: rows.filter((r) => r && r.map && atlasRow(r)), done: {} };
    if (mapCache.done[name]) return mapCache.done[name];
    const less = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
    const scored = [];
    for (const r of mapCache.list) if (Math.floor(Number(r.map) / spec.bit) % 2 === 1) scored.push([key(spec, r), r]);
    scored.sort((x, y) => (less(x[0], y[0]) ? -1 : less(y[0], x[0]) ? 1 : x[1].address < y[1].address ? -1 : 1));
    return (mapCache.done[name] = scored.slice(0, 3).map((x) => x[1]));
  }
  const smallPicks = (c) => { const t = clientTop(c.id); return t ? t.slice(0, 3) : top3Published(c.id); };

  let root = null, rows = null, withLoot = false, wantViewer = false, pending = 0, retry = 0;
  const phone = () => matchMedia("(max-width:700px)").matches;
  const tname = (r) => (window.dvSystemName && window.dvSystemName(r.address)) || "";
  const t100 = (id, title) => `<a class="sh-t100" href="#/" data-list="${esc(id)}" aria-label="Top 100: ${esc(title)}">Top 100 <span aria-hidden="true">↗</span></a>`;

  function bigRow(cat, i, r) {
    const rank = `<span class="sh-rank">${i + 1}</span>`;
    if (!r) return `<span class="sh-ent sh-wait" aria-hidden="true">${rank}<span class="sh-id"><span class="sh-glyphs"></span></span><span class="sh-val"><b>…</b></span></span>`;
    const [big, unit] = cat.big(r), nm = tname(r), tip = [nm, cat.tip(r)].filter(Boolean).join(" · ");
    return `<a class="sh-ent" href="#/d/${r.address}" data-address="${r.address}" aria-label="${esc(cat.title)} number ${i + 1}: ${esc(big + " " + unit)}, ${esc(nm ? nm + ", " + r.glyphs : r.glyphs)}" title="${esc([r.glyphs, tip].filter(Boolean).join(" · "))}">${rank}`
      + `<span class="sh-id"><span class="sh-glyphs">${glyphRow(r.glyphs)}</span></span><span class="sh-val"><b>${esc(big)}</b><small>${esc(unit)}</small></span></a>`;
  }
  function bigCard(cat, picks) {
    return `<section class="sh-card sh-big sh-c-${cat.id}" data-cat="${cat.id}" aria-label="${esc(cat.title)}"><div class="sh-in"><header>${icon(cat.id)}<h2>${esc(cat.title)}</h2>`
      + (cat.id === "value" ? '<span class="sh-note"><i aria-hidden="true">i</i>Known loot</span>' : "") + t100(BIG_LIST[cat.id], cat.title) + `</header>`
      + `<img class="sh-img" src="home/${cat.id}-1.webp" alt="" decoding="async"><div class="sh-ents">${[0, 1, 2].map((i) => bigRow(cat, i, picks[i])).join("")}</div></div></section>`;
  }
  function smallRow(c, i, r) {
    const rank = `<span class="sh-rank">${i + 1}</span>`;
    if (!r) return `<span class="sh-ent sh-wait" aria-hidden="true">${rank}<span class="sh-id"><span class="sh-glyphs"></span></span><span class="sh-val"><b>…</b></span></span>`;
    const nm = tname(r);
    if (c.hidden) return `<a class="sh-ent" href="#/d/${r.address}" data-address="${r.address}" aria-label="${esc(c.title)} number ${i + 1}: hidden, click to reveal, ${esc(nm ? nm + ", " + r.glyphs : r.glyphs)}" title="${esc([nm, r.glyphs, c.tip].filter(Boolean).join(" · "))}">${rank}<span class="sh-id"><span class="sh-glyphs">${glyphRow(r.glyphs)}</span></span><span class="sh-val sh-hid"><b>Hidden</b></span></a>`;
    const v = c.val(r);
    if (v == null) return `<a class="sh-ent" href="#/d/${r.address}" data-address="${r.address}" aria-label="${esc(c.title)} number ${i + 1}: not counted, ${esc(nm ? nm + ", " + r.glyphs : r.glyphs)}" title="${esc([nm, r.glyphs].filter(Boolean).join(" · "))}">${rank}<span class="sh-id"><span class="sh-glyphs">${glyphRow(r.glyphs)}</span></span><span class="sh-val"><b>–</b><small>not counted</small></span></a>`;
    return `<a class="sh-ent" href="#/d/${r.address}" data-address="${r.address}" aria-label="${esc(c.title)} number ${i + 1}: ${v} ${c.unit(v)}, ${esc(nm ? nm + ", " + r.glyphs : r.glyphs)}" title="${esc([nm, r.glyphs].filter(Boolean).join(" · "))}">${rank}`
      + `<span class="sh-id"><span class="sh-glyphs">${glyphRow(r.glyphs)}</span></span><span class="sh-val"><b>${fmt(v)}</b><small>${esc(c.unit(v))}</small></span></a>`;
  }
  function smallCard(c, picks, off) {
    if (off) return `<section class="sh-card sh-sm sh-off" data-cat="${c.id}" aria-label="${esc(c.title)}"><div class="sh-in"><header>${ico2(c.id)}<h2>${esc(c.title)}</h2></header><div class="sh-ents"><span class="sh-ent sh-wait"><span class="sh-id"></span><span class="sh-val"><small>Not available yet</small></span></span></div></div></section>`;
    return `<section class="sh-card sh-sm" data-cat="${c.id}" aria-label="${esc(c.title)}"${c.tip && !c.hidden ? ` title="${esc(c.tip)}"` : ""}><div class="sh-in"><header>${ico2(c.id)}<h2>${esc(c.title)}</h2>`
      + (c.note ? `<span class="sh-note">${esc(c.note)}</span>` : "") + t100(c.id, c.title) + `</header><div class="sh-ents">${[0, 1, 2].map((i) => smallRow(c, i, picks[i])).join("")}</div></div></section>`;
  }

  function render() {
    if (!root) return;
    root.querySelector(".sh-big4").innerHTML = CATS.map((cat) => bigCard(cat, !rows || (cat.loot && !withLoot) ? [] : topK(rows, cat.use, cat.cmp, 3))).join("");
    let waiting = false;
    root.querySelector(".sh-small12").innerHTML = SMALL.map((c) => {
      // a published-only list that stats/systems.json does not have (specs are in, name missing) = "Not available yet", no waiting
      if (c.published && rows && window.dvTopSpecs && !window.dvTopSpecs[c.id]) return smallCard(c, [], true);
      const p = rows ? smallPicks(c) : null; if (rows && !p) waiting = true; return smallCard(c, p || []);
    }).join("");
    if (waiting && retry++ < 60) setTimeout(schedule, 500);  // the list specs (stats/systems.json) are not in yet
  }

  // ---- the Systems panel can be minimized to a strip (PC only) ----
  const KEY = "dv.sysmin.v1";
  function sysMinGet() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function sysMin(on, quiet) {
    document.documentElement.classList.toggle("dv-sysmin", !!on);
    const b = document.getElementById("sys-min");
    if (b) { const t = on ? "Expand the Systems list" : "Minimize the Systems list"; b.setAttribute("aria-expanded", on ? "false" : "true"); b.setAttribute("aria-label", t); b.title = t; b.querySelector(".sm-txt").textContent = on ? "Expand" : "Minimize"; b.querySelector(".sm-ch").textContent = on ? "»" : "«"; }
    if (!quiet) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {} setTimeout(() => window.dispatchEvent(new Event("resize")), 30); }
  }
  window.dvSysMin = { set: (on) => sysMin(on), get: () => document.documentElement.classList.contains("dv-sysmin") };
  function initSysMin() {
    const h = document.querySelector("#systems .section-heading");
    if (!h || document.getElementById("sys-min")) return;
    const b = document.createElement("button"); b.type = "button"; b.id = "sys-min"; b.className = "sys-min"; b.setAttribute("aria-controls", "results");
    b.innerHTML = '<span class="sm-ch" aria-hidden="true">«</span><span class="sm-txt">Minimize</span>';
    b.addEventListener("click", () => sysMin(!window.dvSysMin.get()));
    h.appendChild(b); sysMin(sysMinGet(), true);
  }
  try { if (localStorage.getItem(KEY) === "1") document.documentElement.classList.add("dv-sysmin"); } catch (e) {}

  function init() {
    if (root) return root;
    const empty = document.getElementById("viewer-empty");
    if (!empty) return null;
    const btn = document.getElementById("choose-system");  // modern.js's handler stays on the moved button
    empty.className = "site-home";
    const trivia = TRIVIA.map((t) => `<a class="sh-fact" href="#/d/${t.address}" data-address="${t.address}" title="${esc(t.text)}"><small>${esc(t.tag)}</small><span class="sh-glyphs">${glyphRow(t.glyphs)}</span><span class="sh-hex">${t.glyphs}</span></a>`).join('<span class="sh-vsep" aria-hidden="true"></span>');
    empty.innerHTML = `<div class="sh-trivia" aria-label="Trivia">${trivia}</div><div class="sh-big4"></div><div class="sh-small12"></div><span class="sh-act" hidden></span>`;
    if (btn) empty.querySelector(".sh-act").appendChild(btn);
    empty.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a.sh-t100");
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (typeof window.dvShowList === "function" && window.dvShowList(a.dataset.list)) return;
      const first = empty.querySelector(`[data-cat="${a.dataset.list}"] a.sh-ent`) || empty.querySelector("a.sh-ent");
      if (first) location.hash = "#/d/" + first.dataset.address;
    });
    root = empty;
    initSysMin();
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
    setRows(next, loot) { if (!Array.isArray(next) || !next.length) return; rows = next; mapCache = null; clientCache = null; if (loot) withLoot = true; retry = 0; init(); schedule(); },
    // the atlas rows for the top-100 rank of a system scanned here (site-scan.js / site-toplists.js rank)
    rows() { return rows ? { rows, loot: withLoot } : null; },
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
