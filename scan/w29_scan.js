/* w29_scan.js -- RE_FULL W29b + W29c + W29e: JavaScript wrapper of scan_w29e.wasm (one derelict system per call, in the
 * browser or under Node). No network access of its own: the caller hands it the wasm bytes (or a URL it fetches itself).
 * W29e: the W28 engine (extras gain items_units, items_units_min, items_units_max), the hotfix build stamp and check
 * fingerprint (GAME_BUILD / CHECK_FINGERPRINT below), and progress (options.onProgress / create(src, {onProgress})).
 * W29f (scan_w29f.wasm): version() is static (never changes after create); checkFingerprint() is new.
 * W29g (scan_w29g.wasm): the version label says "tables fingerprint"; extras gains the TEXT column items_all (every
 *   item counted in items_value, not only the top 3; format below); W29Scan.parseItemList(text) parses it (and
 *   items_top). Every other result byte (csv, row, every other extras column, derelict) is W29f's.
 *
 * items_all format (W29g; the same entry format and order as items_top, which is its first 3 entries without "~"):
 *   ""                         no item with a value (or the items columns are empty: no layout / no POI / ERR)
 *   ENTRY|ENTRY|...            every item whose summed value is > 0, sorted by value descending, then by label
 *                              ascending (byte order, as items_top)
 *   ENTRY = LABEL xAMOUNT=VALUE[~]
 *     LABEL   the items_top label (items_values.h; never contains "|", "=", ",", "~" or " x"; split an entry at its
 *             LAST " x"), e.g. "Storm Crystal", "Units", "Bio sample (procedural)"
 *     AMOUNT  summed base amount over the containers whose base loot is this item (Units: the money amount, so
 *             "Units xN=N" as in items_top; procedural items: 1 each)
 *     VALUE   summed base value in units (amount x BaseValue; Units = amount; procedural = nominal value); the VALUEs
 *             sum to items_value exactly (integers, no rounding)
 *     "~"     at least one container counted in this entry has a rounding alternative (W9's band, the containers
 *             behind items_value_min / _max) that gives another item, another value or other nanites: AMOUNT and
 *             VALUE are the base pick and can differ in game. Without "~" every counted container has one outcome.
 *   Not listed (as items_top): upgrade modules (items_tech), Nanites (items_nanites*), blueprints, the end reward
 *   (end_reward_value) and the SpookBox (spookbox_value). No per-item min / max: an alternative can swap one item for
 *   another, so per-item ranges would not add up to items_value_min / _max.
 *
 * result.loot (W29g, SITE Quick Run "Most valuable loot" / "Most nanites"): per-container loot in exactly the W30
 *   shape (fast/w30/w30_cv.py, views/top100-loot.json.gz): {cv: [value_units[], nanites[]], xv: [value_units[],
 *   nanites[]]}, cv index-aligned with result.derelict.containers (= the map view's "c" columns), xv with
 *   result.derelict.extra_containers (= "x"; xv is left out only if derelict has no extra_containers, which the wasm
 *   always writes). Integers; value = the container's base-pick units, nanites = direct + refiner (the definitions
 *   of extras items_value / items_nanites, so sum(cv[0]) + sum(xv[0]) == items_value and sum(cv[1]) + sum(xv[1]) ==
 *   items_nanites). Built in the wrapper by lootFromDump() from the engine's items.tsv text (export w29_items_dump,
 *   the bytes of scan.exe --items-dump), with w30_cv's checks on every pair: kind code, room_index and
 *   floor(layout_local_xyz * 100 + 0.5) cm must match, else every entry is null and sc.lootError() says why.
 *   null when options.loot / items / derelict is false or no layout was written (result.derelict null). Every entry
 *   null (arrays still aligned) when the layout has no item values (no abandoned-freighter POI: no dump).
 *
 *   const sc = await W29Scan.create(src [, {onProgress}])   src: URL string | ArrayBuffer | Uint8Array | Response |
 *                                                           WebAssembly.Module; onProgress = the default callback
 *   sc.scan("00009F0002609CAA" | {address} | {glyphs, galaxy}, options) -> result object (below)
 *   sc.scanJSON('{"address":"00009F0002609CAA","options":{...}}') -> JSON string of the result (string in, string out)
 *   sc.scanRaw(address16, options) -> {header, row}: exactly the CSV header line and row scan.exe writes for the same
 *                                     flags (no trailing newline)
 *   sc.version() -> string (static; W29g: "w29g scan wasm; tables 179082 bytes; map 83742 bytes; tables fingerprint
 *                    b93f4648ae1ce158", the compiled-in tables' fingerprint, NOT the check fingerprint);
 *                    sc.memoryBytes() -> current linear memory size (bytes)
 *   sc.checkFingerprint() -> W29f: the 64-hex fingerprint the engine's `check` uses now (set by the last scan's
 *                    options.checkFingerprint; before any scan the engine tables' b93f4648...)
 *   sc.derelictJSON() -> the raw derelict JSON text of the last scan / scanRaw (or null)
 *   sc.itemsDump() -> W29g: the items.tsv text of the last scan / scanRaw (options.loot + items), or null
 *   sc.lootError() -> W29g: why the last scan's loot is all null after a mapping check failed, else null
 * options (defaults = the scanner's call: --extra --poi-mode game --opt 0xBF01 --spook --items):
 *   poiMode "game" | "emulator" | "none", spook true, items true, extra true, opt 0xBF01, gameBuild GAME_BUILD,
 *   derelict true (W29c: also build result.derelict; false skips it and result.derelict is null),
 *   loot true (W29g: also build result.loot; needs items and derelict),
 *   checkFingerprint CHECK_FINGERPRINT (W29e: the 64-hex atlas fingerprint the row's `check` uses; null = the engine
 *     tables' own 7.05 fingerprint b93f4648..., byte-identical to scan.exe),
 *   onProgress null (W29e: function (stage, done, total), called synchronously from inside the scan; stage ids in
 *     STAGES, bar mapping in progressFraction(); exceptions it throws are caught and dropped; null = the create()
 *     default, or none)
 * result (W29_FORMAT_MAPPING.md section 5): {address, row, room_detail, extras, view, derelict, loot (W29g), status,
 *   seed, csv, ms}
 *   row     = the index/systems.csv.gz columns in their order (glyphs, galaxy, preset, rooms, crates, footlockers,
 *             floors, stairs, hangars, map, briefcases, tall_lockers, reward_name, reward_class, reward_ambiguous,
 *             reward_alt, frigate_modules, frigate_modules_ambiguous, frigate_module_rooms, frigate_module_ids,
 *             frigate_module_alt_ids, game_build); integer columns as numbers, "" = not computed; map = 0 (no list).
 *   room_detail = the region-row column (string) or null when not computed
 *   extras  = every --spook / --items column by its header name (views/extras.csv.gz names; integer cells as numbers,
 *             other cells as strings, "" = not computed, "ERR" kept as the string); W29e: + items_units,
 *             items_units_min, items_units_max (W28: money Units per system, base / min / max); W29g: + items_all
 *             (string, last key, present exactly when options.items is true; not a CSV column)
 *   view    = null (no compact v3/v4 view; the map is drawn from derelict)
 *   derelict = W29c: the derelict object of this layout (the generator's derelict.json fields the site reads, +
 *             extra_containers), for DerelictModel.build(derelict, null, props); null when options.derelict is false
 *             or no layout was written (status 1). Field list: notes/W29c_report.md
 *   status  = scan.h status (0 ok, 1 writer error, 2 loot error, 4 no abandoned-freighter POI, 5 POI error)
 *   seed    = writer seed (16 hex, from the --extra block) or "" without extra
 *   csv     = {header, row} raw;  ms = wall time of this call */
(function (root) {
  "use strict";
  const INT_ROW = new Set(["rooms", "crates", "footlockers", "floors", "stairs", "hangars", "briefcases", "tall_lockers",
    "reward_ambiguous", "frigate_modules", "frigate_modules_ambiguous"]);
  const ROW_COLS = ["glyphs", "galaxy", "preset", "rooms", "crates", "footlockers", "floors", "stairs", "hangars", "map",
    "briefcases", "tall_lockers", "reward_name", "reward_class", "reward_ambiguous", "reward_alt", "frigate_modules",
    "frigate_modules_ambiguous", "frigate_module_rooms", "frigate_module_ids", "frigate_module_alt_ids", "game_build"];
  const TEXT_EXTRAS = new Set(["spookbox", "spookbox_alt", "items_tech", "items_top", "items_all"]);
  const EXTRA_BLOCK = ["address", "seed", "preset_index", "status", "placements", "a2780_calls", "plans", "attempts",
    "writer_us", "search_us", "loot_us", "poi_us"];
  const ATLAS = ["glyphs", "preset", "rooms", "crates", "footlockers", "floors", "stairs", "hangars", "briefcases",
    "tall_lockers", "reward_name", "reward_class", "reward_ambiguous", "reward_alt", "frigate_modules",
    "frigate_modules_ambiguous", "frigate_module_rooms", "frigate_module_ids", "frigate_module_alt_ids", "room_detail",
    "check"];
  /* W29e build stamp: change these two together for another game build. GAME_BUILD fills row.game_build;
   * CHECK_FINGERPRINT is app/atlas.py inputs_fingerprint(4, build) for that build's NMS.exe SHA-256 (here
   * 7.10-b26295378, D393C6782D29E1915854C0D5CF42505C8093740C05DC53705DBED7E0D1D4AC37), used for row.check
   * (fast/w29e/w29e_fingerprint.py computes it). */
  const GAME_BUILD = "7.10-b26295378 D393C678";
  const CHECK_FINGERPRINT = "c00eb4b1874fb5fe553aff0c39279f6dbcb2cb04fdd08510fe347a98502bacf7";
  const DEFAULTS = { poiMode: "game", spook: true, items: true, extra: true, opt: 0xBF01, gameBuild: GAME_BUILD,
    derelict: true, checkFingerprint: CHECK_FINGERPRINT, onProgress: null, loot: true };
  /* W29e progress stage ids (fast/w29e/src/w29_progress.h). 1-3 alternate inside the writer and share one estimate:
   * done = plans so far, total = done + 110 (monotone, never 1 before the writer ends). Every other stage: 0/1 on entry;
   * "done" is 1/1. */
  const STAGES = ["start", "rooms", "grid", "search", "poi", "containers", "loot_modules", "loot_extra", "reward",
    "spookbox", "items", "derelict", "done"];
  /* suggested bar: segment start (fraction of the scan) per stage. Measured, wasm under Node, 966 systems with
   * spook + items + derelict: setup 0.2 %, writer (rooms 0.3 + grid 79.6 + search 13.9) 93.8 %, POI .. items 0.03 %,
   * derelict JSON 5.8 %, after "done" 0.2 % (notes/W29e_report.md). Writer: 0 .. 0.94 by its estimate. */
  const STAGE_START = [0, 0, 0, 0, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 1];
  const WRITER_END = 0.94;
  function progressFraction(stage, done, total) {
    if (stage >= 1 && stage <= 3) return STAGE_START[1] + (WRITER_END - STAGE_START[1]) * (total ? done / total : 0);
    if (stage >= STAGES.length - 1) return 1;
    return STAGE_START[stage] !== undefined ? STAGE_START[stage] : 0;
  }

  /* W29g: "LABEL xAMOUNT=VALUE[~]|..." (items_all or items_top) -> [{label, amount, value, ambiguous}] in text order */
  function parseItemList(text) {
    if (!text) return [];
    return String(text).split("|").map((e) => {
      const ambiguous = e.endsWith("~");
      const s = ambiguous ? e.slice(0, -1) : e;
      const i = s.lastIndexOf(" x"), j = s.indexOf("=", i);
      if (i < 0 || j < 0) throw new Error("bad item entry: " + e);
      return { label: s.slice(0, i), amount: Number(s.slice(i + 2, j)), value: Number(s.slice(j + 1)), ambiguous };
    });
  }

  /* W29g: port of fast/w30/w30_cv.py cv_xv / null_cv, checked against the derelict object instead of the packed view
   * (pack() takes the same containers / extra_containers in the same order, kind code 0 crate / 1 otherwise for "c"
   * and KIND_CODES 2 / 3 for "x", cm = Math.round(layout_local_xyz * 100) = floor(x * 100 + 0.5)). */
  class LootMappingError extends Error {}
  const KIND_CODES = { salvage_crate: 0, crew_footlocker: 1, briefcase: 2, tall_locker: 3 };
  const f32 = (() => { const dv = new DataView(new ArrayBuffer(4));
    return (hex) => { dv.setUint32(0, parseInt(hex, 16) >>> 0, true); return dv.getFloat32(0, true); }; })();
  const cm = (x) => Math.floor(x * 100 + 0.5);
  function nullLoot(d) {
    const nul = (n) => [new Array(n).fill(null), new Array(n).fill(null)];
    const out = { cv: nul(d.containers.length) };
    if (d.extra_containers !== undefined && d.extra_containers !== null) out.xv = nul(d.extra_containers.length);
    return out;
  }
  function lootFromDump(text, d) {
    if (text === null || text === undefined) return nullLoot(d);
    const L = { m: [], e: [] };
    let poi = false;
    String(text).split(/\r?\n/).forEach((ln, n) => {
      if (!ln) return;
      const f = ln.split("\t");
      if (f[0] === "poi") { if (n !== 0) throw new LootMappingError(`line ${n + 1}: poi line not first`); poi = true; return; }
      if (f[0] !== "m" && f[0] !== "e") throw new LootMappingError(`line ${n + 1}: unknown line kind ${f[0]}`);
      if (f.length < 21) throw new LootMappingError(`line ${n + 1}: ${f.length} fields, need at least 21`);
      const lst = L[f[0]];
      if (Number(f[1]) !== lst.length) throw new LootMappingError(`line ${n + 1}: ${f[0]} index ${f[1]}, expected ${lst.length}`);
      lst.push({ kind: Number(f[2]), room: Number(f[3]), cm: [cm(f32(f[4])), cm(f32(f[5])), cm(f32(f[6]))],
        value: Number(f[13]), nanites: Number(f[14]) + Number(f[15]) });
    });
    if (!poi) throw new LootMappingError("no poi line");
    const match = (lines, cs, code, label) => {
      if (cs.length !== lines.length) throw new LootMappingError(`${label}: view has ${cs.length} containers, dump has ${lines.length} lines`);
      lines.forEach((r, i) => {
        const c = cs[i], k = code(c), p = c.layout_local_xyz.map(cm);
        if (r.kind !== k || r.room !== c.room_index || r.cm[0] !== p[0] || r.cm[1] !== p[1] || r.cm[2] !== p[2])
          throw new LootMappingError(`${label}[${i}]: dump kind ${r.kind} room ${r.room} cm ${r.cm} != view kind ${k} room ${c.room_index} cm ${p}`);
      });
      return [lines.map((r) => r.value), lines.map((r) => r.nanites)];
    };
    const out = { cv: match(L.m, d.containers, (c) => (c.container_kind === "salvage_crate" ? 0 : 1), "c") };
    if (d.extra_containers !== undefined && d.extra_containers !== null) {
      out.xv = match(L.e, d.extra_containers, (c) => {
        const k = KIND_CODES[c.container_kind];
        if (k !== 2 && k !== 3) throw new LootMappingError(`not an extra container kind: ${c.container_kind}`);
        return k;
      }, "x");
    } else if (L.e.length) throw new LootMappingError(`view has no x but the dump has ${L.e.length} extra lines`);
    return out;
  }

  class W29Exit extends Error { constructor(code, text) { super(`scan engine stopped (exit ${code})${text ? ": " + text : ""}`); this.code = code; } }

  function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  /* minimal WASI preview1 for a reactor that never opens files: clock, stdout/stderr capture, exit, random */
  function makeWasi(state) {
    const mem = () => new DataView(state.memory.buffer);
    const u8 = () => new Uint8Array(state.memory.buffer);
    const EBADF = 8, ENOSYS = 52, ENOTCAPABLE = 76;
    return {
      clock_time_get(id, precision, out) {
        const ns = BigInt(Math.round(now() * 1e6));
        mem().setBigUint64(out, ns, true);
        return 0;
      },
      fd_write(fd, iovs, n, nwritten) {
        const dv = mem(); let total = 0;
        for (let i = 0; i < n; i++) {
          const p = dv.getUint32(iovs + 8 * i, true), l = dv.getUint32(iovs + 8 * i + 4, true);
          if (fd === 1 || fd === 2) state.log += new TextDecoder().decode(u8().subarray(p, p + l));
          total += l;
        }
        if (state.log.length > 4096) state.log = state.log.slice(-4096);
        dv.setUint32(nwritten, total, true);
        return fd === 1 || fd === 2 ? 0 : EBADF;
      },
      fd_fdstat_get(fd, out) {
        if (fd > 2) return EBADF;
        const b = u8(); b.fill(0, out, out + 24); b[out] = 2;    /* character device */
        return 0;
      },
      fd_close() { return 0; },
      fd_prestat_get() { return EBADF; },                       /* no preopened directories */
      fd_prestat_dir_name() { return EBADF; },
      fd_read() { return EBADF; },
      fd_seek() { return EBADF; },
      path_open() { return ENOTCAPABLE; },
      proc_exit(code) { throw new W29Exit(code, state.log.trim().slice(-300)); },
      random_get(p, l) {
        const b = u8().subarray(p, p + l);
        if (root.crypto && root.crypto.getRandomValues) for (let o = 0; o < l; o += 65536) root.crypto.getRandomValues(b.subarray(o, Math.min(l, o + 65536)));
        else b.fill(0);
        return 0;
      },
      args_get() { return 0; }, args_sizes_get(c, s) { mem().setUint32(c, 0, true); mem().setUint32(s, 0, true); return 0; },
      environ_get() { return 0; }, environ_sizes_get(c, s) { mem().setUint32(c, 0, true); mem().setUint32(s, 0, true); return 0; },
      sched_yield() { return 0; }, poll_oneoff() { return ENOSYS; },
    };
  }

  function normAddress(input) {
    let a = input;
    if (a && typeof a === "object") {
      if (a.address) a = a.address;
      else if (a.glyphs !== undefined) {
        const g = String(a.glyphs).toUpperCase(), gal = Number(a.galaxy || 0);
        if (!/^[0-9A-F]{12}$/.test(g) || !(gal >= 0 && gal <= 255)) throw new Error("bad glyphs/galaxy");
        a = "000" + g.slice(1, 4) + gal.toString(16).toUpperCase().padStart(2, "0") + g.slice(4);
      }
    }
    a = String(a).trim().toUpperCase().replace(/^0X/, "");
    if (!/^[0-9A-F]{16}$/.test(a)) throw new Error("address must be 16 hex digits (ADDRESS16)");
    return a;
  }

  function cell(name, v, ints) {
    if (v === "" || v === undefined) return "";
    if (ints(name) && /^-?\d+$/.test(v)) return Number(v);
    return v;
  }

  class Scanner {
    constructor(instance, state) { this.inst = instance; this.x = instance.exports; this.state = state; }
    version() { return this._str(this.x.w29_version()); }
    checkFingerprint() { return this._str(this.x.w29_check_fingerprint()); }   /* W29f */
    derelictJSON() { return this._der ? this._str(this._der) : null; }
    itemsDump() { return this._dump === undefined ? null : this._dump; }        /* W29g */
    lootError() { return this._lootErr === undefined ? null : this._lootErr; }  /* W29g */
    memoryBytes() { return this.state.memory.buffer.byteLength; }
    _str(p) {
      if (!p) throw new Error("scan engine returned no result" + (this.state.log ? ": " + this.state.log.trim().slice(-300) : ""));
      const b = new Uint8Array(this.state.memory.buffer); let e = p;
      while (b[e]) e++;
      return new TextDecoder().decode(b.subarray(p, e));
    }
    _fingerprint(fp) {                  /* W29e: set the check fingerprint in the engine when it changes */
      const want = fp ? String(fp) : null;
      if (want === this._fp) return;
      if (want !== null && !/^[0-9a-f]{64}$/.test(want)) throw new Error("checkFingerprint must be 64 lowercase hex digits or null");
      if (want !== null) {
        const p = this.x.w29_fp_buf();
        new Uint8Array(this.state.memory.buffer).set(new TextEncoder().encode(want), p);
      }
      if (this.x.w29_set_fingerprint(want === null ? 0 : 1) !== 0) throw new Error("w29_set_fingerprint failed");
      this._fp = want;
    }
    scanRaw(address, options) {
      const o = Object.assign({}, DEFAULTS, options || {});
      const a = normAddress(address);
      const pm = { none: 0, game: 1, emulator: 2 }[o.poiMode];
      if (pm === undefined) throw new Error("poiMode must be game, emulator or none");
      const flags = (o.spook ? 1 : 0) | (o.items ? 2 : 0) | (o.extra ? 4 : 0) | (pm << 4) | (o.derelict ? 256 : 0) |
        (o.loot && o.items ? 512 : 0);                              /* W29g: bit 9 = keep the items.tsv text */
      this._fingerprint(o.checkFingerprint);
      this.state.log = "";
      this.state.onProgress = typeof o.onProgress === "function" ? o.onProgress : this.state.defaultProgress;
      let p;
      try {
        p = this.x.w29_scan(parseInt(a.slice(0, 8), 16) >>> 0, parseInt(a.slice(8), 16) >>> 0, flags >>> 0, o.opt | 0);
      } finally {
        this.state.onProgress = null;
      }
      const s = this._str(p);
      this._der = o.derelict ? this.x.w29_derelict() : 0;
      const ia = o.items ? this.x.w29_items_all() : 0;           /* W29g: read now (valid until the next scan) */
      this._itemsAll = o.items ? (ia ? this._str(ia) : "") : null;
      const dp = o.loot && o.items ? this.x.w29_items_dump() : 0;  /* W29g loot */
      this._dump = dp ? this._str(dp) : null;
      const nl = s.indexOf("\n");
      return { header: s.slice(0, nl), row: s.slice(nl + 1).replace(/\n$/, "") };
    }
    scan(input, options) {
      const o = Object.assign({}, DEFAULTS, options || {});
      const t0 = now();
      const address = normAddress(input);
      const csv = this.scanRaw(address, o);
      const derelict = this._der ? JSON.parse(this._str(this._der)) : null;
      const h = csv.header.split(","), v = csv.row.split(",");
      if (h.length !== v.length) throw new Error("row/header column count differs");
      const c = {};
      h.forEach((k, i) => { if (!(k in c)) c[k] = v[i]; });
      const row = {};
      for (const k of ROW_COLS) {
        if (k === "galaxy") row[k] = parseInt(address.slice(6, 8), 16);
        else if (k === "map") row[k] = 0;
        else if (k === "game_build") row[k] = o.gameBuild;
        else row[k] = cell(k, c[k], (n) => INT_ROW.has(n));
      }
      const extras = {};
      const skip = new Set(ATLAS.concat(EXTRA_BLOCK));
      h.forEach((k, i) => { if (!skip.has(k)) extras[k] = cell(k, v[i], (n) => !TEXT_EXTRAS.has(n)); });
      if (this._itemsAll !== null) extras.items_all = this._itemsAll;   /* W29g: last key, only with options.items */
      let loot = null;                                                  /* W29g */
      this._lootErr = null;
      if (o.loot && o.items && derelict) {
        try { loot = lootFromDump(this._dump, derelict); } catch (e) {
          if (!(e instanceof LootMappingError)) throw e;
          this._lootErr = e.message; loot = nullLoot(derelict);
        }
      }
      return {
        address, row, room_detail: c.room_detail ? c.room_detail : null, extras, view: null, derelict, loot,
        status: c.status !== undefined ? Number(c.status) : this.x.w29_status(), seed: c.seed || "",
        csv, ms: Math.round((now() - t0) * 10) / 10,
      };
    }
    scanJSON(json) {
      const q = typeof json === "string" ? JSON.parse(json) : json;
      return JSON.stringify(this.scan(q.address !== undefined ? q.address : q, q.options));
    }
  }

  async function create(src, createOptions) {
    let mod;
    if (src instanceof WebAssembly.Module) mod = src;
    else {
      let bytes = src;
      if (typeof src === "string") bytes = await (await fetch(src)).arrayBuffer();
      else if (typeof Response !== "undefined" && src instanceof Response) bytes = await src.arrayBuffer();
      mod = await WebAssembly.compile(bytes);
    }
    const co = createOptions || {};
    const state = { memory: null, log: "", onProgress: null,
      defaultProgress: typeof co.onProgress === "function" ? co.onProgress : null };
    /* W29e: env.w29_progress is always supplied (wasm needs every import); without a callback it does nothing. A
     * callback's exception is dropped here so it can never unwind through the engine. */
    const env = { w29_progress(stage, done, total) {
      const f = state.onProgress;
      if (f) { try { f(stage >>> 0, done >>> 0, total >>> 0); } catch (e) { /* ignored */ } }
    } };
    const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: makeWasi(state), env });
    state.memory = inst.exports.memory;
    if (inst.exports._initialize) inst.exports._initialize();
    const rc = inst.exports.w29_init();
    if (rc !== 0) throw new Error("w29_init failed: " + rc + " " + state.log);
    return new Scanner(inst, state);
  }

  const api = { create, normAddress, DEFAULTS, ROW_COLS, W29Exit, GAME_BUILD, CHECK_FINGERPRINT, STAGES,
    progressFraction, parseItemList, lootFromDump, LootMappingError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.W29Scan = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
