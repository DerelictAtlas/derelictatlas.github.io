"use strict";
// EXPERIMENTAL, local only: compact map view (VIEW_FORMAT 4) -> the published view (format 3) that model.js unpack()
// reads. Encoder and format notes: tools/derelict_view_compact.py (its decode() is the Python mirror of expand()).
//
//   table3(t4)        format-4 piece table (format 3 + "k": each scene's container nodes) -> format-3 piece table
//   expand(view4, t4) -> format-3 view (rooms as stored; pieces from room cells + exceptions; "c"/"x" rebuilt from the
//                        pieces with the generator's float32 arithmetic, then cm corrections "cc"/"xc" if any)
(function (root) {
  const VIEW_FORMAT = 4;
  const STEP = 4, CM = 100;
  const ROTS = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]];
  const PIVOT = [[0, -2], [-2, 0], [0, 2], [2, 0]];  // R(rot) * (0, 0, -8) in 4-unit steps (x, z)
  const f32 = Math.fround;
  const delta = (a) => a.map((v, k) => (k ? v - a[k - 1] : v));
  const undelta = (a) => { let s = 0; return a.map((v) => (s += v)); };

  // model.js roomCells() order, from a format-3 room row [template, x0, y0, z0, x1, y1, z1, m0, m1, m2, m3]
  function roomCells(r) {
    const [x0, y0, z0, x1, y1, z1] = r.slice(1, 7);
    const X = x1 - x0 + 1, Y = y1 - y0 + 1, Z = z1 - z0 + 1, out = [];
    for (let x = 0; x < X; x++) for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) {
      const i = z + Z * (y + Y * x);
      if (i < 64 && (r[7 + (i >> 4)] >> (i & 15)) & 1) out.push([x0 + x, y0 + y, z0 + z]);
    }
    return out;
  }

  function table3(t4) {
    if (t4.v !== VIEW_FORMAT) throw new Error(`piece table format ${t4.v}, expected ${VIEW_FORMAT}`);
    const t = { ...t4, v: 3 };
    delete t.k;
    return t;
  }

  // absolute columns [kinds, rooms, x cm, y cm, z cm] of the crates/footlockers and of the extra containers
  function derivedContainers(ids, rots, xs, ys, zs, room, k) {
    const main = [[], [], [], [], []], extra = [[], [], [], [], []];
    ids.forEach((id, j) => {
      const rows = k[id];
      if (!rows || !rows.length) return;
      const A = ROTS[rots[j]], T = [xs[j] * STEP, ys[j] * STEP, zs[j] * STEP];
      for (let q = 0; q < rows.length; q += 4) {
        const x = f32(rows[q + 1]), y = f32(rows[q + 2]), z = f32(rows[q + 3]);
        const dst = rows[q] < 2 ? main : extra;
        dst[0].push(rows[q]);
        dst[1].push(room[j]);
        for (let c = 0; c < 3; c++) {
          let v = f32(f32(y * A[1][c]) + f32(x * A[0][c]));
          v = f32(v + f32(z * A[2][c]));
          dst[2 + c].push(Math.round(f32(v + f32(T[c])) * CM));
        }
      }
    });
    return [main, extra];
  }
  function applyFix(col, fix) {
    for (const [j, dx, dy, dz] of fix || []) { col[2][j] += dx; col[3][j] += dy; col[4][j] += dz; }
    return [col[0], col[1], delta(col[2]), delta(col[3]), delta(col[4])];
  }

  function expand(V, t4) {
    if (V.v !== VIEW_FORMAT) throw new Error(`view format ${V.v}, expected ${VIEW_FORMAT}`);
    const e = V.e, cells = V.r.map(roomCells);
    const [ids, rots, code, room, ex] = V.i, [exx, exy, exz] = ex.map(undelta);
    const xs = [], ys = [], zs = [], last = new Map();
    let q = 0;
    code.forEach((d, j) => {
      if (d === null) { xs.push(exx[q]); ys.push(exy[q]); zs.push(exz[q]); q++; return; }
      const kk = (last.has(room[j]) ? last.get(room[j]) : -1) + d;
      last.set(room[j], kk);
      const g = cells[room[j]][kk];
      if (!g) throw new Error(`piece ${j}: cell ${kk} is not in room ${room[j]}`);
      xs.push((g[0] - e[0]) * 2 + PIVOT[rots[j]][0]);
      ys.push((g[1] - e[1]) * 2);
      zs.push((g[2] - e[2]) * 2 + PIVOT[rots[j]][1]);
    });
    const [main, extra] = derivedContainers(ids, rots, xs, ys, zs, room, t4.k);
    const v3 = { v: 3, a: V.a, s: V.s, p: V.p, e, r: V.r, c: V.c3 || applyFix(main, V.cc),
      i: [ids, rots, delta(xs), delta(ys), delta(zs), room] };
    if (V.x) v3.x = V.x3 || applyFix(extra, V.xc);
    return v3;
  }

  const api = { VIEW_FORMAT, expand, table3, roomCells };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DerelictCompact = api;
})(typeof window !== "undefined" ? window : globalThis);
