/* site-finder.js (SITE integration, user 2026-11-03: "a name list or a field where when you upload your scans through
 * the contribute scanner or when a scan breaks the top 100 it will ask you if you want to add the name so it can ...
 * show who found the system"). Shared by the main page and Contribute:
 *   dvFinder.on()           the feature is switched on (DV_CONFIG.relayFinder === true: the relay must accept the v3
 *                           key "finder" first; relay v1.2 refuses any unknown key with 400, so it stays off until then)
 *   dvFinder.check(text)    -> {ok, value, error}: value = the cleaned name ("" = no name). The relay v1.3 rules
 *                           (relay.py v3_finder, checked 2026-11-03): 1-24 characters (code points) after trimming;
 *                           Unicode letters (L*), decimal digits (Nd), space _ . - only; not digits only; no "@",
 *                           "://" or "www.". The site adds (never looser): runs of spaces become one, NFC, no other
 *                           link-like text (http, .com ...) and the blocklist (finder-blocklist.js)
 *   dvFinder.saved() / save(value)   the name remembered on this device (localStorage dv.finder.v1; "" forgets it)
 *   dvFinder.add(bodyJson, value)    the v3 relay body with "finder" added (unchanged when the value is empty/invalid)
 *   dvFinder.foundBy(address)        the published finder of an atlas system, from views/finders.csv
 *                           (address,finder,found_utc; written by the singles Action), or "" (also when there is no file)
 * The system view shows "Atlas scout: NAME" under the glyphs (text only), with a radar badge in the site accent and the
 * tooltip below (user 2026-11-03: "this has to be distinct enough that this in not the same one as the ingame system
 * finder": never "Found by" / "Discovered"). The data field stays "finder". */
(function () {
  "use strict";
  const KEY = "dv.finder.v1", MAX = 24;
  const cfg = () => globalThis.DV_CONFIG || {};
  const on = () => cfg().relayFinder === true;
  const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", 9: "g" };
  const URLISH = /(^|[^\p{L}])(https?|www)([^\p{L}]|$)|\.(com|net|org|io|gg|tv|me|co|uk|de|ru|xyz|app|dev|info|link|ly|be|to|live|stream|shop|site|online|cc|fr|es|it|nl|eu|us)([^\p{L}]|$)/iu;
  function fold(s) { return String(s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[0-9]/g, (d) => LEET[d] || d); }
  function blocked(name) {
    const B = globalThis.DV_FINDER_BLOCK || { anywhere: [], words: [] };
    const f = fold(name), compact = f.replace(/[^\p{L}]/gu, ""), words = f.split(/[^\p{L}]+/u).filter(Boolean);
    if ((B.anywhere || []).some((w) => compact.includes(w))) return true;
    return (B.words || []).some((w) => compact === w || compact === w + "s" || words.some((t) => t === w || t === w + "s"));
  }
  function check(text) {
    const s = String(text == null ? "" : text).normalize("NFC").replace(/\s+/gu, " ").trim();
    const no = (error) => ({ ok: false, value: s, error });
    if (!s) return { ok: true, value: "", error: "" };
    if ([...s].length > MAX) return no(`At most ${MAX} characters.`);
    if (s.includes("@")) return no("No e-mail addresses or @ handles.");
    if (URLISH.test(s)) return no("No links, please.");
    if (!/^[\p{L}\p{Nd} _.\-]+$/u.test(s)) return no("Only letters, digits, spaces and _ . -");   // the relay's set: no marks (M*)
    if (/^\p{Nd}+$/u.test(s)) return no("Not digits only, please.");
    if (blocked(s)) return no("Please choose another name.");
    return { ok: true, value: s, error: "" };
  }
  function saved() { try { const v = check(localStorage.getItem(KEY) || ""); return v.ok ? v.value : ""; } catch (_) { return ""; } }
  function save(value) {
    const v = check(value);
    if (!v.ok) return false;
    try { if (v.value) localStorage.setItem(KEY, v.value); else localStorage.removeItem(KEY); } catch (_) {}
    return true;
  }
  function add(body, value) {
    const v = check(value);
    if (!on() || !v.ok || !v.value) return body;
    try { const b = JSON.parse(body); b.finder = v.value; return JSON.stringify(b); } catch (_) { return body; }
  }

  // ---- "Atlas scout" (views/finders.csv, only fetched with the feature on: no request, no error without it) ----
  let finders = null, loading = null;
  function load() {
    if (!on()) return Promise.resolve(null);
    if (!loading) loading = fetch("views/finders.csv", { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).catch(() => "").then((t) => {
      const m = new Map();
      for (const line of String(t || "").split(/\r?\n/)) {
        const i = line.indexOf(","), j = line.lastIndexOf(",");
        if (i !== 16 || j <= i) continue;          // header and broken lines
        const a = line.slice(0, 16).toUpperCase(), v = check(line.slice(i + 1, j).replace(/^"|"$/g, ""));
        if (/^[0-9A-F]{16}$/.test(a) && v.ok && v.value && !m.has(a)) m.set(a, v.value);
      }
      finders = m;
      paint();
      return m;
    });
    return loading;
  }
  const TIP = "Scanned this derelict into the Derelict Atlas first. Not the in-game system discoverer.";
  const BADGE = '<svg class="site-scout-badge" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 19 6"/></svg>';
  const foundBy = (address) => (finders && finders.get(String(address || "").toUpperCase())) || "";

  function current() { try { const c = globalThis.dvShareCurrent && globalThis.dvShareCurrent(); return c && c.row ? String(c.row.address || "").toUpperCase() : ""; } catch (_) { return ""; } }
  function paint() {
    const strip = document.querySelector("#viewer-content .identity-strip .glyph-address");
    if (!strip) return;
    const name = foundBy(current());
    let p = strip.querySelector(".site-scout");
    if (!name) { if (p) p.remove(); return; }
    if (!p) { p = document.createElement("p"); p.className = "site-scout"; p.title = TIP; strip.appendChild(p); }
    if (p.dataset.name === name) return;
    p.dataset.name = name;
    p.innerHTML = BADGE;                       // a fixed icon; the name below is text only
    p.append("Atlas scout: ");
    const b = document.createElement("b"); b.textContent = name; p.append(b);
  }
  function watch() {
    const content = document.getElementById("viewer-content");
    if (!content || !on()) return;
    new MutationObserver(paint).observe(content, { childList: true, subtree: true });
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

  globalThis.dvFinder = { on, check, saved, save, add, load, foundBy, MAX, TIP };
})();
