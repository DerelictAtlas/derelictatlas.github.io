"use strict";
// Shared derelict model, used by the browser and by tools/build_views.js (Node).
//
//   pack(d, sceneId)      generated derelict.json -> compact "view" (one per system in views/top100.json.gz)
//   piecesTable(index, names, props)  piece index (meshcache/index.json) [+ piece_props.json "scenes"] -> compact piece
//                         table (the bundle's "t")
//   unpack(view, table)   -> { d, index } in the generator's own shapes
//   build(d, index)       -> everything the derelict page draws (rooms, containers, doors, stair links, walls, fixtures)
//
// A view keeps only what the page needs: rooms (template, grid box, cell mask), containers (cm; optional "x" = the
// extra loot containers, briefcases and tall lockers, same columns, kind codes 2/3) and the placed pieces
// (piece table id, one of the 4 yaw rotations, position in 4-unit steps; both exact for all 1,453 generated derelicts).
// Containers and pieces are stored column by column with positions as differences from the previous one, which
// gzip compresses best (format 3: 22% smaller than plain rows).
// Walls and fixtures are rebuilt from the placements and the shared piece table. The local viewer also goes through
// pack/unpack, so a published view draws exactly like a locally generated one.
// Container orientation: the piece table's optional "o" lists each piece's container nodes as [kind code, RotX, RotY,
// RotZ] (1/100 degree, the scene's own frame, generator order: tools/extra_containers_705.py authored_rotations()).
// unpack() walks the placed pieces in order, adds each piece's yaw (one of the 4 rotations) and gives every container
// orientation = [RotX, RotY, RotZ] in degrees (the game's Euler order: R = Ry * Rx * Rz, three.js "YXZ"), but only
// when the kinds and rooms line up one to one with "c" / "x". Tables without "o" (older bundles): no orientation, the
// page draws those containers upright.
(function (root) {
  const VIEW_FORMAT = 3;
  const P = 32;        // wall raster: px per grid cell
  const CM = 100;      // container positions in cm (layout units are metres)
  const STEP = 4;      // piece positions in 4-unit steps (half a grid cell)
  const SHAPE_Q = 100; // piece table shapes in 1/100 layout units
  const ROT_Q = 100;   // piece table container rotations in 1/100 degree
  // the four yaw rotations the generator uses (rows = source axes), in pack order
  const ROTS = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]];
  // Container kind codes (same in tools/derelict_view.py and tools/extra_containers_705.py). "c" holds the
  // live-validated salvage crates (0) and crew footlockers (1); the optional "x" holds the extra loot containers,
  // briefcases (2) and tall lockers (3), see research-output/CONTAINER_TYPES_20261020.md.
  const KIND_CODES = { salvage_crate: 0, crew_footlocker: 1, briefcase: 2, tall_locker: 3 };
  const KIND_NAMES = ["salvage_crate", "crew_footlocker", "briefcase", "tall_locker"];
  const EXTRA_KINDS = ["briefcase", "tall_locker"];
  // Hazards found in the placed pieces (tools/derelict_hazards_705.py; research-output/ENEMIES_TURRETS_20261020.md).
  // Letter = the research tool's symbol. lo/hi = creatures released at the Normal difficulty column (experiencespawntable):
  // a run-time range, not layout data. Sacs: FIEND_DROP 6-8 (destroyed or burst).
  const HAZARD_KINDS = {
    F: { kind: "floater_spawner", group: "enemy", lo: 1, hi: 2 }, f: { kind: "fast_floater_spawner", group: "enemy", lo: 1, hi: 2 },
    D: { kind: "drone_spawner", group: "enemy", lo: 2, hi: 3 }, B: { kind: "bug_spawner", group: "enemy", lo: 3, hi: 5 },
    S: { kind: "hanging_sac", group: "enemy", lo: 6, hi: 8 }, P: { kind: "pillar_sac", group: "enemy", lo: 6, hi: 8 },
    E: { kind: "fiend_egg", group: "enemy", lo: 1, hi: 1 }, T: { kind: "turret", group: "turret", lo: 0, hi: 0 },
    X: { kind: "explosive_barrel", group: "barrel", lo: 0, hi: 0 },
  };
  const HAZARD_LETTERS = Object.fromEntries(Object.entries(HAZARD_KINDS).map(([l, h]) => [h.kind, l]));
  const f32 = Math.fround;

  // Room records start with the room's inclusive grid box (x0, y0, z0, x1, y1, z1) on the 13 x 4 x 13 grid;
  // u16[12..15] are a 64-bit mask of the box cells the room occupies, bit index z + Z*(y + Y*x) (z fastest).
  // Layout positions map to grid units with the entrance origin E: u = x/8 + Ex + 0.5, v = z/8 + Ez + 0.5,
  // level = round(y/8) + Ey. Checked on 835 generated derelicts: all 22,565 containers lie on an occupied cell
  // of their own room, and no cell belongs to two rooms.
  function toGrid(p, e) {
    return { u: p[0] / 8 + e[0] + 0.5, v: p[2] / 8 + e[2] + 0.5, level: Math.round(p[1] / 8) + e[1] };
  }
  function roomCells(raw) {
    const [x0, y0, z0, x1, y1, z1] = raw;
    const X = x1 - x0 + 1, Y = y1 - y0 + 1, Z = z1 - z0 + 1, cells = [];
    for (let x = 0; x < X; x++) for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) {
      const i = z + Z * (y + Y * x);
      if (i < 64 && (raw[12 + (i >> 4)] >> (i & 15)) & 1) cells.push({ x: x0 + x, y: y0 + y, z: z0 + z });
    }
    return cells;
  }
  const cellKey = (x, y, z) => `${x},${y},${z}`;

  // ------------------------------------------------------------ compact forms

  function rotIndex(A) {
    for (let k = 0; k < 4; k++) {
      if (ROTS[k].every((row, i) => row.every((v, j) => Math.abs(v - A[i][j]) < 1e-4))) return k;
    }
    throw new Error("piece rotation is not one of the 4 yaw rotations: " + JSON.stringify(A));
  }
  function exact(x, q, what) {
    const v = Math.round(x * q);
    if (Math.abs(v - x * q) > 1e-3) throw new Error(`${what} ${x} is not a multiple of 1/${q}`);
    return v;
  }

  const delta = (a) => a.map((v, k) => (k ? v - a[k - 1] : v));
  const undelta = (a) => { let s = 0; return a.map((v) => (s += v)); };

  function extraCode(c) {
    const k = KIND_CODES[c.container_kind];
    if (k !== 2 && k !== 3) throw new Error("not an extra container kind: " + c.container_kind);
    return k;
  }

  function pack(d, sceneId) {
    const col = (list, f) => list.map(f);
    const view = {
      v: VIEW_FORMAT, a: d.address, s: d.seed, p: d.preset, e: d.entrance_origin || [6, 3, 0],
      // rooms in writer order: template, box x0 y0 z0 x1 y1 z1, cell mask as 4 u16
      r: d.rooms.map((r, k) => {
        if (r.room_index !== k) throw new Error(`room ${r.room_index} at position ${k}`);
        const raw = r.raw_u16_0x00_0x1F;
        return [r.template_name, ...raw.slice(0, 6), ...raw.slice(12, 16)];
      }),
      // containers, as columns: kind (0 salvage crate, 1 footlocker), room, then x, y, z in cm as differences
      c: [col(d.containers, (c) => (c.container_kind === "salvage_crate" ? 0 : 1)), col(d.containers, (c) => c.room_index),
        ...[0, 1, 2].map((k) => delta(col(d.containers, (c) => Math.round(c.layout_local_xyz[k] * CM))))],
      // placed pieces, as columns: piece table id, rotation 0-3, then x, y, z in 4-unit steps as differences, room
      i: [col(d.instances, (i) => sceneId(i.scene_resource.toUpperCase())), col(d.instances, (i) => rotIndex(i.source_axes)),
        ...[0, 1, 2].map((k) => delta(col(d.instances, (i) => exact(i.translation[k], 1 / STEP, "piece position")))),
        col(d.instances, (i) => i.room_index)],
    };
    // extra containers (only when the layout has them): kind code 2 briefcase / 3 tall locker, room, x, y, z in cm
    // as differences, like "c"
    if (d.extra_containers) {
      const xs = d.extra_containers;
      view.x = [col(xs, extraCode), col(xs, (c) => c.room_index),
        ...[0, 1, 2].map((k) => delta(col(xs, (c) => Math.round(c.layout_local_xyz[k] * CM))))];
    }
    return view;
  }

  // Piece table: scene names in id order with each piece's wall footprint and fixture boxes (see build()).
  // names: the id order to use (keep earlier tables' order and append new scenes, so published views stay valid).
  // props (optional) = piece_props.json "scenes": adds "o", each piece's container rotations (see the header).
  function piecesTable(index, names, props) {
    const q = (x) => Math.round(x * SHAPE_Q), r = (x) => Math.round(x * ROT_Q);
    const t = {
      v: VIEW_FORMAT, q: SHAPE_Q, n: names,
      w: names.map((n) => (index[n] && index[n].walls || []).flatMap(([x0, z0, x1, z1, dl = 0]) => [q(x0), q(z0), q(x1), q(z1), dl])),
      f: names.map((n) => (index[n] && index[n].fixtures || []).flatMap((b) => b.map(q))),
    };
    if (props) t.o = names.map((n) => (props[n] && props[n].o || []).flatMap(([k, rx, ry, rz]) => [k, r(rx), r(ry), r(rz)]));
    return t;
  }

  // Container orientation from each placed piece's container rotations (see the header): rowsOf(j) = flat
  // [kind, RotX, RotY, RotZ, ...] in degrees for instance j, yawOf(j) = its yaw in degrees. containers / extras (lists in
  // generator order) get `orientation` only when the pieces' container nodes match them one to one (kind and room).
  function orientContainers(instances, rowsOf, yawOf, containers, extras) {
    const main = [], extra = [];
    instances.forEach((inst, j) => {
      const rows = rowsOf(j) || [], yaw = yawOf(j);
      for (let k = 0; k + 3 < rows.length; k += 4)
        (rows[k] < 2 ? main : extra).push({ kind: rows[k], room: inst.room_index, o: [rows[k + 1], (((rows[k + 2] + yaw) % 360) + 360) % 360, rows[k + 3]] });
    });
    const put = (list, cs) => {
      if (!cs || list.length !== cs.length || !list.every((m, j) => KIND_NAMES[m.kind] === cs[j].container_kind && m.room === cs[j].room_index)) return;
      list.forEach((m, j) => { cs[j].orientation = m.o; });
    };
    put(main, containers);
    put(extra, extras);
  }
  // yaw (degrees) of a piece rotation: source_axes rows are the images of the local axes, z -> (sin yaw, 0, cos yaw)
  const yawOfAxes = (A) => Math.round(Math.atan2(A[2][0], A[2][2]) * 180 / Math.PI * 1e6) / 1e6;

  function unpack(V, table) {
    if (V.v !== VIEW_FORMAT || table.v !== VIEW_FORMAT) throw new Error(`view format ${V.v}/${table.v}, expected ${VIEW_FORMAT}`);
    const sq = table.q;
    const index = {};
    table.n.forEach((name, k) => {
      const w = [], f = [];
      for (let j = 0; j < table.w[k].length; j += 5) w.push([...table.w[k].slice(j, j + 4).map((x) => x / sq), table.w[k][j + 4]]);
      for (let j = 0; j < table.f[k].length; j += 6) f.push(table.f[k].slice(j, j + 6).map((x) => x / sq));
      index[name] = { walls: w, fixtures: f };
    });
    const [ids, rots, ix, iy, iz, iroom] = V.i, ipos = [ix, iy, iz].map(undelta);
    const instances = ids.map((id, j) => {
      const name = table.n[id];
      if (name === undefined) throw new Error(`scene id ${id} is not in the piece table`);
      return { scene_resource: name, source_axes: ROTS[rots[j]], translation: ipos.map((a) => a[j] * STEP), room_index: iroom[j] };
    });
    const [kinds, croom, cx, cy, cz] = V.c, cpos = [cx, cy, cz].map(undelta);
    const containers = kinds.map((kind, j) => ({ container_kind: kind ? "crew_footlocker" : "salvage_crate", room_index: croom[j],
      layout_local_xyz: cpos.map((a) => a[j] / CM) }));
    const rooms = V.r.map((x, k) => ({ room_index: k, template_name: x[0],
      raw_u16_0x00_0x1F: [...x.slice(1, 7), 0, 0, 0, 0, 0, 0, ...x.slice(7, 11)],
      instance_count: instances.filter((i) => i.room_index === k).length }));
    const d = { address: V.a, seed: V.s, preset: V.p, entrance_origin: V.e, rooms, containers, instances, instance_count: instances.length };
    if (V.x) {  // views made before the extra kinds have no "x": then d.extra_containers stays undefined (unknown)
      const [xk, xroom, xx, xy, xz] = V.x, xpos = [xx, xy, xz].map(undelta);
      d.extra_containers = xk.map((kind, j) => {
        if (kind !== 2 && kind !== 3) throw new Error(`extra container kind code ${kind}`);
        return { container_kind: KIND_NAMES[kind], room_index: xroom[j], layout_local_xyz: xpos.map((a) => a[j] / CM) };
      });
      d.extra_container_kinds = Object.fromEntries(EXTRA_KINDS.map((k) => [k, d.extra_containers.filter((c) => c.container_kind === k).length]));
    }
    if (table.o) orientContainers(instances, (j) => (table.o[ids[j]] || []).map((v, k) => (k % 4 ? v / ROT_Q : v)), (j) => rots[j] * 90,
      d.containers, d.extra_containers);
    return { d, index };
  }

  // ------------------------------------------------------------ what the page draws

  // Doors: a DOOR_* piece sits at its cell centre; 4 units along its local +z is the door, the midpoint of the edge
  // between two rooms (checked on 300 derelicts: every door lands exactly on an inter-room edge; doors = rooms - 1).
  function doorsOf(d, e, ownerOf) {
    const doors = [];
    for (const i of d.instances) {
      const sc = i.scene_resource.toUpperCase();
      if (!sc.includes("/DOOR_")) continue;
      const A = i.source_axes, p = [0, 1, 2].map((k) => i.translation[k] + 4 * A[2][k]);
      const g = toGrid(p, e), nx = Math.round(A[2][0]), nz = Math.round(A[2][2]);
      const a = { x: Math.floor(g.u - nx * 0.5), z: Math.floor(g.v - nz * 0.5) }, b = { x: Math.floor(g.u + nx * 0.5), z: Math.floor(g.v + nz * 0.5) };
      doors.push({ level: g.level, nx, nz, kind: sc.includes("BRANCH") ? "branch" : "path", slime: sc.includes("SLIME"), room: i.room_index, a, b,
        rooms: [ownerOf.get(cellKey(a.x, g.level, a.z)), ownerOf.get(cellKey(b.x, g.level, b.z))] });
    }
    return doors;
  }

  // Fixtures: prop bounding boxes from the piece index, placed with the instance matrix (grid units; h = height above
  // the deck floor in cells). props = piece_props.json "scenes": its "p" lists the fixture indices that are really a tall
  // locker ("t"), briefcase ("b") or explosive barrel ("X"); those get `prop` set because the page draws them as their
  // own markers (the dark fixture blocks leave them out; they stay solid for walking).
  function fixturesOf(d, e, index, props) {
    const out = [];
    for (const i of d.instances) {
      const key = i.scene_resource.toUpperCase();
      const entry = index[key];
      if (!entry || !entry.fixtures) continue;
      const tagged = new Map(((props && props[key] && props[key].p) || []));
      const detail = new Map(((props && props[key] && props[key].d) || []).filter(r=>r[7]>=0).map(r=>[r[7],r[0]]));
      const A = i.source_axes, T = i.translation, level = Math.round(T[1] / 8) + e[1], base = (level - e[1]) * 8;
      for (const [fi, b] of entry.fixtures.entries()) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
          for (let k = 0; k < 3; k++) {
            const q = x * A[0][k] + y * A[1][k] + z * A[2][k] + T[k];
            lo[k] = Math.min(lo[k], q); hi[k] = Math.max(hi[k], q);
          }
        }
        const f = { room: i.room_index, level, u0: lo[0] / 8 + e[0] + 0.5, u1: hi[0] / 8 + e[0] + 0.5, v0: lo[2] / 8 + e[2] + 0.5, v1: hi[2] / 8 + e[2] + 0.5,
          h0: (lo[1] - base) / 8, h1: (hi[1] - base) / 8 };
        if (tagged.has(fi)) f.prop = tagged.get(fi);
        if (detail.has(fi)) f.detail = detail.get(fi);
        out.push(f);
      }
    }
    return out;
  }

  // Walls: each piece's waist-height structure footprint (index "walls": piece-local rects [x0, z0, x1, z1, deck offset])
  // placed with the instance matrix, then finished per deck on a 1/32-cell raster: clipped to the rooms (plus a small
  // margin for the outer walls), small compact enclosed holes filled (pillars built from four pieces' quarters),
  // door openings cleared, and merged back into rectangles. Matches the in-game outline (alcoves, pillars, ladders).
  function wallsOf(d, e, rooms, doors, index) {
    const N = 13 * P, MARGIN = 5;  // deck raster size; outer-wall margin (px)
    const raw = new Map();  // level -> [{room, u0, u1, v0, v1}]
    for (const i of d.instances) {
      const entry = index[i.scene_resource.toUpperCase()];
      if (!entry || !entry.walls) continue;
      const A = i.source_axes, T = i.translation, base = Math.round(T[1] / 8) + e[1];
      for (const [x0, z0, x1, z1, dl = 0] of entry.walls) {
        const xs = [], zs = [];
        for (const x of [x0, x1]) for (const z of [z0, z1]) {
          xs.push(x * A[0][0] + z * A[2][0] + T[0]);
          zs.push(x * A[0][2] + z * A[2][2] + T[2]);
        }
        const level = base + dl;
        if (!raw.has(level)) raw.set(level, []);
        raw.get(level).push({ room: i.room_index, u0: Math.min(...xs) / 8 + e[0] + 0.5, u1: Math.max(...xs) / 8 + e[0] + 0.5,
          v0: Math.min(...zs) / 8 + e[2] + 0.5, v1: Math.max(...zs) / 8 + e[2] + 0.5 });
      }
    }
    const out = [];
    for (const [level, rects] of raw) {
      const wall = new Int16Array(N * N).fill(-1);  // room index of the wall pixel, -1 = free
      const allowed = new Uint8Array(N * N), inRoom = new Int16Array(N * N).fill(-1);
      for (const r of rooms) for (const c of r.cells) {
        if (c.y !== level) continue;
        for (let z = Math.max(0, c.z * P - MARGIN); z < Math.min(N, (c.z + 1) * P + MARGIN); z++)
          for (let x = Math.max(0, c.x * P - MARGIN); x < Math.min(N, (c.x + 1) * P + MARGIN); x++) allowed[z * N + x] = 1;
        for (let z = c.z * P; z < (c.z + 1) * P; z++) for (let x = c.x * P; x < (c.x + 1) * P; x++) inRoom[z * N + x] = r.room_index;
      }
      for (const w of rects) {
        for (let z = Math.max(0, Math.floor(w.v0 * P)); z < Math.min(N, Math.ceil(w.v1 * P)); z++)
          for (let x = Math.max(0, Math.floor(w.u0 * P)); x < Math.min(N, Math.ceil(w.u1 * P)); x++)
            if (allowed[z * N + x]) wall[z * N + x] = w.room;
      }
      // fill small compact free areas fully enclosed by walls inside rooms (a pillar's hollow inside)
      const seen = new Int32Array(N * N);  // 0 = unvisited, else component id
      let compId = 0;
      for (let s0 = 0; s0 < N * N; s0++) {
        if (seen[s0] || wall[s0] >= 0 || inRoom[s0] < 0) continue;
        compId++;
        const comp = [s0]; seen[s0] = compId;
        let open = false, x0 = N, x1 = 0, z0 = N, z1 = 0, owner = -1;
        for (let k = 0; k < comp.length; k++) {
          const p = comp[k], x = p % N, z = (p - x) / N;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
          for (const q of [x > 0 ? p - 1 : -1, x < N - 1 ? p + 1 : -1, z > 0 ? p - N : -1, z < N - 1 ? p + N : -1]) {
            if (q < 0) { open = true; continue; }
            if (wall[q] >= 0) { owner = wall[q]; continue; }
            if (inRoom[q] < 0) { open = true; continue; }
            if (!seen[q]) { seen[q] = compId; comp.push(q); } else if (seen[q] !== compId) open = true;  // joins a large region
          }
          if (comp.length > 16 * P * P / 64) open = true;  // > 16 sq units: walkable floor, stop growing
          if (open && comp.length > 16 * P * P / 64) break;
        }
        const wpx = (x1 - x0 + 1) / P * 8, hpx = (z1 - z0 + 1) / P * 8;  // layout units
        if (!open && wpx <= 4.5 && hpx <= 4.5) for (const p of comp) wall[p] = owner;
      }
      // door openings (0.5 cell along the wall, 0.7 cell through it)
      for (const dr of doors) {
        if (dr.level !== level) continue;
        const ex = (dr.a.x + dr.b.x) / 2 + 0.5, ez = (dr.a.z + dr.b.z) / 2 + 0.5;
        const hu = dr.nx ? 0.35 : 0.25, hv = dr.nx ? 0.25 : 0.35;
        for (let z = Math.max(0, Math.floor((ez - hv) * P)); z < Math.min(N, Math.ceil((ez + hv) * P)); z++)
          for (let x = Math.max(0, Math.floor((ex - hu) * P)); x < Math.min(N, Math.ceil((ex + hu) * P)); x++) wall[z * N + x] = -1;
      }
      // back to rectangles: runs per row (same room), stacked over identical runs in following rows
      const open = new Map();
      for (let z = 0; z <= N; z++) {
        const runs = new Map();
        if (z < N) {
          let x = 0;
          while (x < N) {
            const r = wall[z * N + x];
            if (r < 0) { x++; continue; }
            let x2 = x;
            while (x2 + 1 < N && wall[z * N + x2 + 1] === r) x2++;
            runs.set(`${x},${x2},${r}`, { x, x2, r });
            x = x2 + 1;
          }
        }
        for (const [k, o] of open) {
          if (runs.has(k)) { runs.delete(k); continue; }
          out.push({ room: o.r, level, u0: o.x / P, u1: (o.x2 + 1) / P, v0: o.z0 / P, v1: z / P });
          open.delete(k);
        }
        for (const [k, rr] of runs) open.set(k, { ...rr, z0: z });
      }
    }
    return out;
  }

  // Extra loot containers of a layout without them, from the placed pieces: the same float32 arithmetic and output order
  // as tools/extra_containers_705.py (SceneInstanceTransform.transform_point). props = piece_props.json "scenes".
  function extraContainersOf(d, props) {
    const out = [];
    for (const i of d.instances) {
      const rows = props[i.scene_resource.toUpperCase()];
      if (!rows || !rows.x) continue;
      const A = i.source_axes, T = i.translation;
      for (const [kind, lx, ly, lz] of rows.x) {
        const x = f32(lx), y = f32(ly), z = f32(lz), p = [];
        for (let c = 0; c < 3; c++) {
          let v = f32(f32(y * A[1][c]) + f32(x * A[0][c]));
          v = f32(v + f32(z * A[2][c]));
          p.push(f32(v + f32(T[c])));
        }
        out.push({ container_kind: KIND_NAMES[kind], room_index: i.room_index, layout_local_xyz: p });
      }
    }
    return out;
  }

  // Enemy spawners, turrets, bug sacs and barrels from the placed pieces (piece-local node positions in piece_props.json,
  // layout position = p * axes + translation, tools/derelict_hazards_705.py). Deck = floor((y + 1) / 8) + Ey: a hazard
  // stands 0 to 4 m above its deck, a ceiling turret hangs 4 m above it.
  function hazardsOf(d, e, props) {
    const out = [];
    for (const i of d.instances) {
      const rows = props[i.scene_resource.toUpperCase()];
      if (!rows || !rows.h) continue;
      const A = i.source_axes, T = i.translation;
      for (const [letter, lx, ly, lz, mount] of rows.h) {
        const p = [0, 1, 2].map((c) => lx * A[0][c] + ly * A[1][c] + lz * A[2][c] + T[c]);
        const h = HAZARD_KINDS[letter];
        out.push({ code: letter, kind: h.kind, group: h.group, lo: h.lo, hi: h.hi, mount, room_index: i.room_index, xyz: p,
          g: { u: p[0] / 8 + e[0] + 0.5, v: p[2] / 8 + e[2] + 0.5, level: Math.floor((p[1] + 1) / 8) + e[1] } });
      }
    }
    return out;
  }

  function hangarOf(d, e, props) {
    const ships = [], details = [];
    for (const i of d.instances) {
      const rows = props[i.scene_resource.toUpperCase()];
      if (!rows || (!rows.s && !rows.d)) continue;
      const base = { room_index: i.room_index, level: Math.round(i.translation[1] / 8) + e[1], axes: i.source_axes, t: i.translation };
      for (const b of rows.s || []) ships.push({ ...base, box: b });
      for (const [code, x, y, z, rx, ry, rz, fixture, ...box] of rows.d || []) details.push({ ...base, code, pos: [x, y, z], rot: [rx, ry, rz], fixture, box });
    }
    return { ships, details };
  }

  // derelict (generator shapes) + piece index -> what the page draws. index may be null (no walls/fixtures then).
  // props = piece_props.json "scenes" (extra containers and hazards of each piece); without it extras fall back to what
  // the layout carries (null = unknown) and hazards is null.
  function build(d, index, props) {
    const e = d.entrance_origin || [6, 3, 0];
    const rooms = d.rooms.map((r) => {
      const cells = roomCells(r.raw_u16_0x00_0x1F);
      return { room_index: r.room_index, template_name: r.template_name, instance_count: r.instance_count,
        cells, cellSet: new Set(cells.map((c) => cellKey(c.x, c.y, c.z))), levels: [...new Set(cells.map((c) => c.y))].sort((a, b) => b - a),
        crates: 0, lockers: 0, briefcases: 0, tallLockers: 0, hangarPieces: 0, hazardCounts: {}, creaturesLo: 0, creaturesHi: 0 };
    });
    const byIndex = new Map(rooms.map((r) => [r.room_index, r]));
    const containers = d.containers.map((c) => ({ ...c, g: toGrid(c.layout_local_xyz, e) }));
    for (const c of containers) {
      const r = byIndex.get(c.room_index);
      if (r) { if (c.container_kind === "salvage_crate") r.crates++; else r.lockers++; }
    }
    // extra loot containers (briefcase, tall_locker): null when the layout predates them (unknown, not zero)
    const extraList = d.extra_containers || (props ? extraContainersOf(d, props) : null);
    const extras = extraList ? extraList.map((c) => ({ ...c, g: toGrid(c.layout_local_xyz, e) })) : null;
    // containers still without orientation (no piece table "o", or extras computed from the pieces): piece_props.json "o"
    const needC = !containers.some((c) => c.orientation), needX = Boolean(extras) && !extras.some((c) => c.orientation);
    if (props && (needC || needX))
      orientContainers(d.instances, (j) => (props[d.instances[j].scene_resource.toUpperCase()] || {}).o?.flat(), (j) => yawOfAxes(d.instances[j].source_axes),
        needC ? containers : null, needX ? extras : null);
    for (const c of extras || []) {
      const r = byIndex.get(c.room_index);
      if (r) { if (c.container_kind === "briefcase") r.briefcases++; else r.tallLockers++; }
    }
    for (const i of d.instances) {
      const r = byIndex.get(i.room_index);
      if (r && i.scene_resource.toUpperCase().includes("HANGAR")) r.hangarPieces++;
    }
    // hazards: null when no piece data was given (unknown, not zero)
    const hazards = props ? hazardsOf(d, e, props) : null;
    const hazardTotals = { turrets: 0, spawners: 0, sacs: 0, barrels: 0, creaturesLo: 0, creaturesHi: 0 };
    for (const h of hazards || []) {
      const r = byIndex.get(h.room_index);
      if (r) { r.hazardCounts[h.kind] = (r.hazardCounts[h.kind] || 0) + 1; r.creaturesLo += h.lo; r.creaturesHi += h.hi; }
      if (h.kind === "turret") hazardTotals.turrets++;
      else if (h.kind.endsWith("_spawner")) hazardTotals.spawners++;
      else if (h.kind.endsWith("_sac")) hazardTotals.sacs++;
      else if (h.kind === "explosive_barrel") hazardTotals.barrels++;
      hazardTotals.creaturesLo += h.lo; hazardTotals.creaturesHi += h.hi;
    }
    const ownerOf = new Map();
    for (const r of rooms) for (const c of r.cells) ownerOf.set(cellKey(c.x, c.y, c.z), r.room_index);
    const doors = doorsOf(d, e, ownerOf);
    // Stair links: a room spanning two decks occupies the same (x, z) on both; those shared cells are its stairwell.
    // Checked on 835 derelicts: every multi-deck room has such cells and every pair of adjacent decks is linked.
    const links = [];
    for (const r of rooms) {
      for (const upper of r.levels) {
        const lower = upper - 1;
        if (!r.levels.includes(lower)) continue;
        const cells = r.cells.filter((c) => c.y === upper && r.cellSet.has(cellKey(c.x, lower, c.z))).map((c) => ({ x: c.x, z: c.z }));
        if (!cells.length) continue;
        const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length, cz = cells.reduce((a, c) => a + c.z, 0) / cells.length;
        const mark = cells.reduce((a, c) => ((c.x - cx) ** 2 + (c.z - cz) ** 2 < (a.x - cx) ** 2 + (a.z - cz) ** 2 ? c : a));
        links.push({ id: links.length, room: r.room_index, upper, lower, cells, mark });
      }
    }
    const hangar = props ? hangarOf(d, e, props) : null;
    return { address: d.address, seed: d.seed, preset: d.preset, instanceCount: d.instance_count ?? d.instances.length, e,
      ships:hangar?.ships??null,details:hangar?.details??null,
      rooms, byIndex, containers, extras, hazards, hazardTotals: hazards ? hazardTotals : null, doors, links,
      walls: index ? wallsOf(d, e, rooms, doors, index) : null, fixtures: index ? fixturesOf(d, e, index, props) : null };
  }

  const api = { VIEW_FORMAT, KIND_CODES, KIND_NAMES, EXTRA_KINDS, HAZARD_KINDS, HAZARD_LETTERS, extraContainersOf, hazardsOf, hangarOf, pack, piecesTable, unpack, build, toGrid, roomCells, cellKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DerelictModel = api;
})(typeof window !== "undefined" ? window : globalThis);
