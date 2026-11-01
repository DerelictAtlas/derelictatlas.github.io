/* System names (the original procedural name, as the game generates it) - JS twin of tools/system_names_705.py.
 *
 *   NMSNames.init(dataObject)            dataObject = parsed system_names_705_data.json (alphasets + letter_map)
 *   NMSNames.name(address16)             "000SSSGGYYZZZXXX" -> "Abarof-Dulin" ("" if unparsable)
 *   NMSNames.name(glyphs12, galaxy)      "PSSSYYZZZXXX" + galaxy 0-255
 *
 * Works in a browser (global NMSNames) and in node (module.exports). No dependencies. 64-bit arithmetic is done on
 * two uint32 halves, so no BigInt is needed (faster). Bit-for-bit the same results as the Python module.
 *
 * Port of the system-naming part of hadsh/nms_namegen (https://github.com/hadsh/nms_namegen, MIT; original by
 * Stuart Coyle, co-authored with GoodGuysFree). The same logic also exists in elegra1965-source/nms-galactic-map
 * nms-core (MIT), which was read as a cross-reference only.
 *
 * MIT License
 * Copyright (c) 2026 Stuart Coyle & had.sh & GGF
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */
(function (root) {
  "use strict";
  var ML = 0xF899, MH = 0x5A76, TWO32 = 4294967296, TINY = 2.3283064370807974e-10;
  var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI",
    "XVII", "XVIII", "XIX", "XX"];
  var ALPHA = null, LMAP = null;

  function init(d) {
    ALPHA = d.alphasets;
    LMAP = [];
    for (var k = 0; k < 8; k++) {
      var m = new Map(), src = d.letter_map[String(k)];
      for (var key in src) {
        var parts = src[key].split(","), arr = [];
        for (var i = 0; i < parts.length - 1; i++) arr.push([parts[i][0], Number(parts[i].slice(1))]);
        m.set(key, arr);
      }
      LMAP.push(m);
    }
  }

  // seed = (lo32 * 0x5A76F899) + hi32 as an unsigned 64-bit value kept in this.lo / this.hi
  function Rng(lo, hi, addlo) {
    this.lo = lo; this.hi = hi;
    if (addlo !== undefined) { this.step(addlo); }
  }
  Rng.prototype.step = function (add) {          // (lo*MUL) + add, add < 2^32 -> new lo/hi
    var lo = this.lo, p = lo * ML, q = lo * MH;
    var ql = q % 65536, qh = (q - ql) / 65536;
    var s = ql * 65536 + p + add;
    var nlo = s % TWO32, carry = (s - nlo) / TWO32;
    this.lo = nlo; this.hi = qh + carry;
  };
  Rng.prototype.upd = function () { this.step(this.hi); };
  Rng.prototype.random = function (n) { this.upd(); return Math.floor(this.lo * n / TWO32); };
  Rng.prototype.randi = function () { this.upd(); return this.lo; };

  function chars(rng, aset) {
    var a = ALPHA[aset & 7];
    var r = rng.random(Math.floor(a.length / 3)) * 3;
    return a.substr(r, 3);
  }
  function vowelAt(name, rng, i) { return name.slice(0, i) + "aeiou"[rng.random(5)] + name.slice(i); }
  function isV(c) { return "aeiou".indexOf(c) >= 0; }
  function inS(c, s) { return s.indexOf(c) >= 0; }
  function consecutive(name) {
    var run = 0;
    for (var i = 0; i < name.length; i++) {
      var c = name[i];
      if (run < 3) { run = isV(c) ? 0 : run + 1; }
      else { if (!inS(c, "aeiouy")) return i - 3; run = 0; }
    }
    return -1;
  }

  function generate(rng, aset, minLen, maxLen) {
    var alt = false, name = chars(rng, aset);
    if (rng.randi() & 1) alt = true;
    var reg = rng.random(maxLen - minLen + 1) + minLen - 3, add = reg;
    if (reg > 0) {
      var tries = 8, i = 0;
      while (i < reg) {
        var w = LMAP[aset].get(name.substr(i, 3));
        var target = rng.randi() * TINY;
        if (w === undefined) {
          tries -= 1; i -= 1;
          aset = (aset + 1) & 0x08000007;
          if (aset < 0) aset = -aset;
          if (tries === 0) {
            if (add < 3) break;
            var tmp = chars(rng, aset);
            if (isV(name[i + 2]) && isV(tmp[0])) name += "'";
            else if (!isV(tmp[0])) name += "aeiou"[rng.random(5) & 0xFF];
            name += tmp; tries = 1; i += 2; add -= 3;
          }
        } else {
          var index = 0;
          if (alt) { target *= w.length - 1; index = Math.floor((target > 0 ? 0.5 : 0) + target); }
          else {
            var total = 0, j = 0;
            for (j = 0; j < w.length; j++) { total += w[j][1]; if (total >= target) break; }
            if (j === w.length) j = w.length - 1;
            index = j;
          }
          name += w[index][0]; add -= 1;
        }
        if (name.length > 63) name = name.slice(0, 64);
        i += 1;
      }
    }
    var f = name[0], s = name[1];
    if (!isV(f) && !isV(s)) {
      if (f !== "s" || !inS(s, "hklmnprtwy")) {
        if (!((s === "h" && inS(f, "ctw")) || (s === "l" && inS(f, "bcfgps")) || (s === "r" && inS(f, "bcdfgkpt")) ||
              (s === "w" && inS(f, "dgt")) || (s === "y" && inS(f, "hmr")))) name = vowelAt(name, rng, 1);
      }
    }
    if (name.length > 1) {
      var u = name[name.length - 1], pn = name[name.length - 2];
      if (pn !== "g" || isV(u)) {
        if ((u === "b" && inS(pn, "gn")) || (u === "d" && inS(pn, "bdfghkmpst")) || (u === "g" && pn === "l") ||
            (u === "p" && inS(pn, "bdhkt")) || (u === "r" && inS(pn, "bfg")) || (u === "t" && pn === "g") ||
            (u === "w" && !isV(pn))) name = vowelAt(name, rng, name.length - 1);
      }
    }
    var ci = consecutive(name);
    if (ci !== -1) { ci += rng.random(3) + 1; name = vowelAt(name, rng, ci); }
    return name;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

  // coords = low 32 bits of the portal code (YYZZZXXX), sys = SSS (12 bits), galaxy 0-255
  function systemName(coords, sys, galaxy) {
    var sysidx = ((sys << 8) | galaxy) >>> 0;          // ((portal & 0x0FFF00000000) >> 24) | galaxy
    var rol = ((((coords & 0xFFFF) << 16) | (coords >>> 16)) ^ coords ^ sysidx) >>> 0;
    var rng = new Rng(coords === 0 ? 1 : coords, 0, rol);  // (coords [+1]) * MUL + rol
    // the first seed has no hi term: Rng.step(add) adds `rol`; hi starts at 0 so upd() is not used here
    var seedLo = rng.lo;
    var reg = Math.floor(seedLo * 5 / TWO32), aset;
    if (reg === 0) aset = 2; else if ((reg & 0xFF) < 4) aset = (reg & 0xFF) + 2; else aset = 7;
    var name = cap(generate(rng, aset, 6, rng.random(4) + 6));
    if (name.length < 8 && rng.random(4) < 2) {
      reg = rng.random(5);
      aset = reg === 0 ? 2 : (reg < 4 ? reg + 2 : 7);
      name = name + "-" + cap(generate(rng, aset, 3, 5));
    }
    if (rng.random(10) < 3) {
      var n = Math.min(rng.random(19) + 1, 19);
      name = name + " " + ROMAN[n - 1];
    }
    return name;
  }

  // Corrections confirmed by NMS Almanac and an own in-game capture (upstream data differs): address16 -> name.
  var OVERRIDES = { "0000760006606CAB": "Irchol-Luhimo XVII" };

  function name(address, galaxy) {
    var a = String(address).replace(/[\s:]/g, "").toUpperCase();
    var sys, coords, g;
    if (a.length === 16 && /^[0-9A-F]+$/.test(a)) {
      g = parseInt(a.substr(6, 2), 16); sys = parseInt(a.substr(3, 3), 16);
      coords = parseInt(a.substr(8, 8), 16) >>> 0;
      if (galaxy !== undefined && galaxy !== null && Number(galaxy) !== g) return "";
    } else if (a.length === 12 && /^[0-9A-F]+$/.test(a) && galaxy !== undefined && galaxy !== null) {
      g = Number(galaxy) & 0xFF; sys = parseInt(a.substr(1, 3), 16); coords = parseInt(a.substr(4, 8), 16) >>> 0;
    } else return "";
    if (!ALPHA) return "";
    var key = "000" + ("00" + sys.toString(16)).slice(-3).toUpperCase() + ("0" + g.toString(16)).slice(-2).toUpperCase() + ("0000000" + coords.toString(16)).slice(-8).toUpperCase();
    if (OVERRIDES[key]) return OVERRIDES[key];
    return systemName(coords, sys, g);
  }

  var api = { init: init, name: name, ready: function () { return !!ALPHA; }, status: "checked" };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.NMSNames = api;
})(typeof self !== "undefined" ? self : this);
