"use strict";
// Sharing helpers for a system page: Copy link, Share (Web Share API with a copy fallback) and Save image (a PNG drawn in
// this browser: floor maps or the current 3D view, lookalike glyph SVGs, counts, preset, site link). Uses DV_CONFIG.siteBase.
window.DvShare = (function () {
  const cfg = () => window.DV_CONFIG || {};
  const base = () => cfg().siteBase || location.href.split("#")[0];
  const directUrl = (a) => `${base()}#/d/${a}`;
  const cardUrl = (a) => `${base()}s/${a}.html`;   // link-preview card (tools/build_share_cards.py); only for systems with a map
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAP_NAMES = { 1: "Top 100 by crates", 2: "Top 100 by frigate modules", 3: "Top 100 by crates and by frigate modules" };

  // "Open in..." plain text links to outside sites. One entry per site; add more here. {glyphs} = 12 hex digits, {galaxy} = 0-based
  // galaxy index, {slug} = galaxy slug (an entry with `slugs` is hidden for galaxies not listed, never guessed). No fetching, no logos.
  // Galaxy numbering differs per site, keep them apart: Almanac WEBSITE = slug (euclid); NMS Hub map = 0-based index (Euclid 0, {galaxy});
  // the Almanac API (1-256, Euclid = 1) is not used: this page makes no API calls and fetches nothing from these sites.
  const EXTERNAL = [
    { name: "NMS Almanac", url: "https://nmsalmanac.com/system/{slug}/{glyphs}", slugs: { 0: "euclid" } },
    { name: "NMS Hub galactic map", url: "https://map.nomansskyhub.app/?arrival=1&addr={glyphs}&galaxy={galaxy}" },
  ];
  function externalLinks(address) {
    const glyphs = "0" + address.slice(3, 6) + address.slice(8), galaxy = parseInt(address.slice(6, 8), 16);
    return EXTERNAL.filter((e) => !e.slugs || e.slugs[galaxy]).map((e) => ({
      name: e.name, url: e.url.replace("{glyphs}", glyphs).replace("{galaxy}", galaxy).replace("{slug}", (e.slugs || {})[galaxy] || "") }));
  }
  function openInHtml(address) {
    const links = externalLinks(address);
    if (!links.length) return "";
    return `<details class="open-in"><summary>Open in…</summary>${links.map((l) =>
      `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(l.name)}</a>`).join("")}
      <span class="muted">External sites, not affiliated.</span></details>`;
  }

  function html(ctx) {
    return `<div class="share-bar" role="group" aria-label="Share">
      <button type="button" id="sh-copy" title="Copy the link to this system (${esc(directUrl(ctx.address))})">Copy link</button>
      <button type="button" id="sh-share" title="Share this system${ctx.map ? " (link with a preview card)" : ""}">Share</button>
      <button type="button" id="sh-img" title="Save a PNG of this system to keep or send">Save image</button>
      <select id="sh-what" title="What the image shows"><option value="map">Floor maps</option>${ctx.getView3d ? `<option value="3d">3D view</option>` : ""}<option value="none">Counts only</option></select>
      ${openInHtml(ctx.address)}
      <span id="sh-note" class="muted" aria-live="polite"></span></div>`;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* fall back */ }
    try {
      const t = document.createElement("textarea");
      t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select();
      const ok = document.execCommand("copy"); t.remove(); return ok;
    } catch (_) { return false; }
  }

  function shareText(ctx) {
    const c = ctx.counts;
    return `Derelict ${ctx.glyphs}${ctx.name ? ` (${ctx.name})` : ""}: ${c.preset}, ${c.crates} crates, ${c.footlockers} footlockers${c.modules != null ? `, ${c.modules} frigate modules` : ""}, ${c.rooms} rooms`;
  }

  function wire(ctx) {
    const note = document.getElementById("sh-note");
    const say = (t) => { note.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { note.textContent = ""; }, 6000); };
    document.getElementById("sh-copy").onclick = async () => say((await copyText(directUrl(ctx.address))) ? "Link copied" : "Could not copy; the link is " + directUrl(ctx.address));
    document.getElementById("sh-share").onclick = async () => {
      const url = ctx.map ? cardUrl(ctx.address) : directUrl(ctx.address);
      const data = { title: `Derelict ${ctx.glyphs}`, text: shareText(ctx), url };
      if (navigator.share) { try { await navigator.share(data); } catch (e) { if (e && e.name !== "AbortError") say("Share failed"); } return; }
      say((await copyText(url)) ? "Sharing is not available here; link copied" : "Sharing is not available here; link: " + url);
    };
    document.getElementById("sh-img").onclick = async () => {
      const btn = document.getElementById("sh-img"); btn.disabled = true; say("Drawing…");
      try { say(await saveImage(ctx, document.getElementById("sh-what").value)); }
      catch (e) { say("Could not make the image: " + (e && e.message || e)); }
      finally { btn.disabled = false; }
    };
  }

  // ---- image
  const PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
    "opacity", "display", "visibility", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline", "paint-order"];
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image load failed")); i.src = src; });
  }
  async function svgElementImage(svg) {
    const clone = svg.cloneNode(true);
    const a = [svg, ...svg.querySelectorAll("*")], b = [clone, ...clone.querySelectorAll("*")];
    a.forEach((el, k) => {
      const cs = getComputedStyle(el);
      b[k].setAttribute("style", PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
      b[k].removeAttribute("class");
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "720"); clone.setAttribute("height", "720");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
  async function glyphImage(c) {
    const text = await (await fetch(`glyphs-svg/${c.toLowerCase()}.svg`)).text();
    const fixed = text.replace("<svg ", '<svg width="128" height="128" ');
    const url = URL.createObjectURL(new Blob([fixed], { type: "image/svg+xml" }));
    try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }

  async function saveImage(ctx, what) {
    const W = 1200, P = 40, FONT = 'system-ui, "Segoe UI", Arial, sans-serif';
    const glyphImgs = await Promise.all([...ctx.glyphs].map(glyphImage));
    // visual: floor maps (cloned from the page with their computed styles) or the 3D canvas
    let tiles = [];
    if (what === "map") {
      const root = document.querySelector(".maps");
      const maps = root ? [...root.querySelectorAll(".map")] : [];
      tiles = await Promise.all(maps.map(async (m) => ({ title: (m.querySelector("h3") || {}).textContent || "", img: await svgElementImage(m.querySelector("svg")) })));
    }
    const cols = Math.min(Math.max(tiles.length, 1), 4), tile = Math.floor(Math.min(360, (W - 2 * P - (cols - 1) * 16) / cols));
    const rowsN = Math.ceil(tiles.length / cols);
    const visualH = what === "map" ? rowsN * (tile + 40) : what === "3d" ? Math.round((W - 2 * P) * 0.55) : 0;
    const H = 330 + visualH + 90;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = "#0e1116"; g.fillRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    g.fillStyle = "#8b98a8"; g.font = `600 22px ${FONT}`; g.fillText("NMS Derelict Atlas · No Man's Sky 7.05", P, 46);
    if (ctx.mapName) { g.textAlign = "right"; g.fillStyle = "#3fd0c9"; g.fillText(ctx.mapName, W - P, 46); g.textAlign = "left"; }
    glyphImgs.forEach((im, k) => g.drawImage(im, P + k * 68, 70, 62, 62));
    g.fillStyle = "#e6edf3"; g.font = "600 26px ui-monospace, Consolas, monospace"; g.fillText(ctx.pretty, P, 168);
    g.fillStyle = "#8b98a8"; g.font = `20px ${FONT}`; g.fillText(`${ctx.counts.preset} · address ${ctx.address}`, P, 198);
    const c = ctx.counts, items = [["Salvage crates", c.crates], ["Footlockers", c.footlockers], ["Frigate modules", c.modules == null ? "–" : c.modules],
      ["Rooms", c.rooms], ["Floors", c.floors ?? "–"], ["Briefcases", c.briefcases ?? "–"]];
    const tw = (W - 2 * P - 5 * 14) / 6;
    items.forEach(([k, v], i) => {
      const x = P + i * (tw + 14);
      g.fillStyle = "#161b22"; g.strokeStyle = "#2a3340"; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x, 222, tw, 84, 8); g.fill(); g.stroke();
      g.fillStyle = "#e6edf3"; g.font = `700 36px ${FONT}`; g.fillText(String(v), x + 14, 266);
      g.fillStyle = "#8b98a8"; g.font = `16px ${FONT}`; g.fillText(k, x + 14, 292);
    });
    const y = 330;
    if (what === "map") {
      tiles.forEach((t, k) => {
        const x = P + (k % cols) * (tile + 16), yy = y + Math.floor(k / cols) * (tile + 40);
        g.fillStyle = "#e6edf3"; g.font = `600 18px ${FONT}`; g.fillText(t.title, x, yy + 22);
        g.fillStyle = "#12161c"; g.fillRect(x, yy + 30, tile, tile); g.drawImage(t.img, x, yy + 30, tile, tile);
      });
      if (!tiles.length) { g.fillStyle = "#8b98a8"; g.font = `18px ${FONT}`; g.fillText("No map is published for this system.", P, y + 30); }
    } else if (what === "3d") {
      const v = ctx.getView3d && ctx.getView3d();
      if (v && v.snapshot) {      // render and copy in the same task, so the canvas still holds the frame
        const src = v.snapshot(), w = W - 2 * P, h = visualH, s = Math.min(w / src.width, h / src.height);
        const dw = src.width * s, dh = src.height * s;
        g.fillStyle = "#0b0e12"; g.fillRect(P, y, w, h); g.drawImage(src, P + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else { g.fillStyle = "#8b98a8"; g.font = `18px ${FONT}`; g.fillText("The 3D view is not ready.", P, y + 30); }
    }
    const fy = H - 60;
    g.fillStyle = "#3fd0c9"; g.font = `600 22px ${FONT}`; g.fillText(directUrl(ctx.address).replace(/^https?:\/\//, ""), P, fy);
    g.fillStyle = "#8b98a8"; g.font = `15px ${FONT}`; g.fillText("Unofficial fan project, not affiliated with Hello Games. Glyphs are lookalike drawings.", P, fy + 28);

    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!blob) throw new Error("PNG export failed");
    const name = `derelict-${ctx.glyphs}.png`;
    const file = new File([blob], name, { type: "image/png" });
    const phone = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    if (phone && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Derelict ${ctx.glyphs}`, text: shareText(ctx), url: directUrl(ctx.address) }); return "Image shared"; }
      catch (e) { if (e && e.name === "AbortError") return "Cancelled"; /* else download */ }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return `Saved ${name} (${Math.round(blob.size / 1024)} KB)`;
  }

  return { html, wire, directUrl, cardUrl, MAP_NAMES, externalLinks, EXTERNAL };
})();
