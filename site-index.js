// SITE integration: atlas index format 7 (IDX7, scanner REQUEST 2026-10-31). Classic script, loaded in <head> of both
// index.html and legacy.html before the app code.
//   index/manifest.json  {"format":7,"rows":N,"generated":...,"shards":[{"path":"index/systems/00.csv","rows","bytes","sha256"}]}
//   index/systems/NN.csv each shard starts with the same header (and the same "#" lines); every system is in one shard.
// The shards are plain CSV in git (they delta, unlike .gz); GitHub Pages still sends them gzip-compressed.
// window.dvIndexText(base, loadText) returns the whole index as ONE CSV text, exactly like index/systems.csv.gz did, so
// the viewers parse it unchanged. Shards are fetched as path?v=<sha256 prefix>: a new manifest never mixes with old
// cached shards. If the manifest is missing, odd, or the rows do not add up, it falls back to index/systems.csv.gz
// while that file still exists. A shard or manifest that fails is fetched once more first (the .gz is being removed,
// so a passing network blip must not end the load). window.dvViewsText does the same for views/top100.json (falls back to the .gz).
// loadText(url) is the page's own loader (plain or gzip -> text).
(function () {
  "use strict";
  const isRow = (line) => line && !line.startsWith("#");

  // the first page of the Systems list (user 2026-11-01): index/first.csv, the top rows under the default sort, written
  // with every atlas publish. Fetched right away, in parallel with the page's own scripts; data.js firstRows() reads it.
  const cfg = window.DV_CONFIG || {};
  const base = cfg.staticSite ? new URL("./", location.href).href : "https://raw.githubusercontent.com/DerelictAtlas/derelictatlas.github.io/main/";
  const first = /legacy\.html$/.test(location.pathname) ? Promise.resolve(null)
    : fetch(base + "index/first.csv", { cache: "no-cache" }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  window.dvFirstText = () => first;

  function merge(texts) {
    let head = null, out = [], rows = 0;
    texts.forEach((text, i) => {
      const lines = text.split(/\r?\n/);
      let seenHead = false;
      for (const line of lines) {
        if (!isRow(line)) { if (i === 0 && line) out.push(line); continue; }  // "#" lines: from the first shard only
        if (!seenHead) {
          seenHead = true;
          if (head === null) { head = line; out.push(line); } else if (line !== head) throw new Error("index shard header differs");
          continue;
        }
        out.push(line);
        rows++;
      }
    });
    return { text: out.join("\n") + "\n", rows };
  }

  async function manifest(base) {
    try {
      const r = await fetch(base + "index/manifest.json", { cache: "no-cache" });
      if (!r.ok) return null;
      const m = await r.json();
      return m && m.format === 7 && Array.isArray(m.shards) && m.shards.length && m.shards.every((s) => s && typeof s.path === "string") ? m : null;
    } catch (_) { return null; }
  }

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  async function shard(base, s, loadText) {
    const url = base + s.path + (s.sha256 ? "?v=" + String(s.sha256).slice(0, 8) : "");
    try { const t = await loadText(url); if (typeof t === "string") return t; } catch (_) { /* retried below */ }
    await pause(1500);
    return loadText(url + (url.includes("?") ? "&" : "?") + "r=" + Date.now());
  }

  window.dvIndexText = async function (base, loadText) {
    const old = () => loadText(base + "index/systems.csv.gz");
    let m = await manifest(base);
    if (!m) { await pause(1500); m = await manifest(base); }
    if (!m) return old();
    let merged;
    try {
      const texts = await Promise.all(m.shards.map((s) => shard(base, s, loadText)));
      if (texts.some((t) => typeof t !== "string")) throw new Error("index shard missing");
      merged = merge(texts);
    } catch (e) {
      console.warn("atlas index shards unusable, using index/systems.csv.gz:", e.message);
      return old();
    }
    if (typeof m.rows === "number" && merged.rows !== m.rows) {
      console.warn(`atlas index shards have ${merged.rows} rows, manifest says ${m.rows}: trying index/systems.csv.gz`);
      try { const t = await old(); if (typeof t === "string" && t) return t; } catch (_) { /* .gz already gone */ }
    }
    return merged.text;
  };

  window.dvViewsText = async function (base, loadText) {
    try { const t = await loadText(base + "views/top100.json"); if (typeof t === "string" && t) return t; } catch (_) { /* not published yet */ }
    return loadText(base + "views/top100.json.gz");
  };
})();
