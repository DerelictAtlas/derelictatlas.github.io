/* v3-lines.js (SITE integration, 2026-11-02; upload format v3 agreed with scanner -cc, user decision "they upload
 * automatically their scanned data via relay ... github actions would then take the region data > verify it > publish"):
 * the two lines the relay takes for one scanned system, built from the W29 scanner's result.row / result.extras.
 *   row    = the index line, exactly the shard header columns (index/systems/NN.csv line 2), game_build last; map = 0
 *   extras = the extras format 3 line, exactly EXTRAS_COLUMNS (build_atlas_index.py), items_all last; "" = not computed
 * Never an invalid line: a cell with , " CR LF or a control character, a line over 4,000 characters, a non-integer in an
 * integer column or glyphs that do not match the address throw. Loot cells the scanner marks as errors ("ERR") are sent
 * as not computed (the whole loot part empty), so the row itself still goes.
 * Classic script: self.DvV3 (the Contribute worker loads it with importScripts, the viewer with a script tag). */
(function (root) {
  "use strict";
  const ROW_HEADER = "glyphs,galaxy,preset,rooms,crates,footlockers,floors,stairs,hangars,map,briefcases,tall_lockers," +
    "reward_name,reward_class,reward_ambiguous,reward_alt,frigate_modules,frigate_modules_ambiguous,frigate_module_rooms," +
    "frigate_module_ids,frigate_module_alt_ids,game_build";
  const EXTRAS_HEADER = "address,spookbox,spookbox_ambiguous,spookbox_alt,items_value,items_value_min,items_value_max," +
    "items_nanites,items_nanites_direct,items_nanites_refiner,items_nanites_min,items_nanites_max,items_ambiguous,items_tech," +
    "items_top,end_reward_value,spookbox_value,items_units,items_units_min,items_units_max,items_all";
  const ROW_COLS = ROW_HEADER.split(","), EXTRAS_COLS = EXTRAS_HEADER.split(",");
  const ROW_INT = new Set(["galaxy", "rooms", "crates", "footlockers", "floors", "stairs", "hangars", "map", "briefcases",
    "tall_lockers", "reward_ambiguous", "frigate_modules", "frigate_modules_ambiguous"]);
  const EXTRAS_TEXT = new Set(["address", "spookbox", "spookbox_alt", "items_tech", "items_top", "items_all"]);
  const MAX_LINE = 4000, MAX_SYSTEMS = 200, MAX_BYTES = 256 * 1024;
  const BAD = /[,"\u0000-\u001f\u007f]/;

  const text = (v) => (v === null || v === undefined ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NaN") : String(v));
  const isInt = (s) => /^-?\d+$/.test(s);

  function lines(address, row, extras) {
    const a = String(address || "").toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(a)) throw new Error("address is not 16 hex digits");
    if (!row) throw new Error("no row");
    const glyphs = "0" + a.slice(3, 6) + a.slice(8), galaxy = parseInt(a.slice(6, 8), 16);
    const cells = ROW_COLS.map((k) => k === "map" ? "0" : k === "glyphs" ? text(row.glyphs).toUpperCase() : text(row[k]));
    if (cells[0] !== glyphs) throw new Error(`glyphs ${cells[0]} do not match the address (${glyphs})`);
    if (cells[1] !== String(galaxy)) throw new Error(`galaxy ${cells[1]} does not match the address (${galaxy})`);
    if (!cells[2]) throw new Error("no preset");
    ROW_COLS.forEach((k, i) => {
      if (BAD.test(cells[i])) throw new Error(`row cell ${k} has a forbidden character`);
      if (ROW_INT.has(k) && cells[i] !== "" && !isInt(cells[i])) throw new Error(`row cell ${k} is not an integer (${cells[i].slice(0, 20)})`);
    });
    if (!cells[ROW_COLS.length - 1]) throw new Error("no game_build");
    const ex = extras || {};
    let xs = EXTRAS_COLS.map((k) => k === "address" ? a : text(ex[k]));
    // a loot error ("ERR") or any other non-integer in an integer column: the loot part goes as not computed
    if (EXTRAS_COLS.some((k, i) => !EXTRAS_TEXT.has(k) && xs[i] !== "" && !isInt(xs[i])) || xs.some((c, i) => i > 0 && BAD.test(c)))
      xs = [a].concat(EXTRAS_COLS.slice(1).map(() => ""));
    const rowLine = cells.join(","), extrasLine = xs.join(",");
    if (rowLine.length > MAX_LINE) throw new Error("row line over " + MAX_LINE + " characters");
    if (extrasLine.length > MAX_LINE) {
      // items_all is the only long cell: without it the line still carries the values (it is checked when present)
      xs[xs.length - 1] = "";
      const short = xs.join(",");
      if (short.length > MAX_LINE) throw new Error("extras line over " + MAX_LINE + " characters");
      return { row: rowLine, extras: short };
    }
    return { row: rowLine, extras: extrasLine };
  }
  // the 16-hex tables fingerprint in the scanner's version string ("... tables fingerprint b93f4648ae1ce158")
  function fingerprint(version) {
    const m = /tables fingerprint ([0-9a-f]{16})\b/.exec(String(version || ""));
    return m ? m[1] : "";
  }
  // one relay body: {"v":3,"scanner","fp","rows","extras","none"}
  function body(version, rows, extras, none) {
    return JSON.stringify({ v: 3, scanner: String(version), fp: fingerprint(version), rows, extras, none });
  }
  root.DvV3 = { ROW_HEADER, EXTRAS_HEADER, MAX_LINE, MAX_SYSTEMS, MAX_BYTES, lines, fingerprint, body };
})(typeof self !== "undefined" ? self : globalThis);
