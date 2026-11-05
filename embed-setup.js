/* embed-setup.js (SITE integration, EMBED1 2026-11-04): builder for site owners. Builds the embed.html URL from the form,
 * shows a live preview iframe and the copy-paste snippet. */
(function () {
  "use strict";
  const HOST = "https://derelictatlas.github.io/";
  const $ = (id) => document.getElementById(id);
  const FIELDS = [["modules", "Frigate modules"], ["containers", "Containers (total)"], ["crates", "Crates"], ["footlockers", "Footlockers"], ["briefcases", "Briefcases"],
    ["tall_lockers", "Tall lockers"], ["rooms", "Rooms"], ["decks", "Decks"], ["reward", "End reward (hidden until clicked)"], ["loot", "Loot value (units)"], ["nanites", "Nanites"], ["galaxy", "Galaxy"], ["hex", "Hex code"]];
  const DEFAULT = FIELDS.map((f) => f[0]);
  const box = $("es-fields");
  for (const [k, t] of FIELDS) {
    const l = document.createElement("label"), c = document.createElement("input");
    c.type = "checkbox"; c.value = k; c.checked = DEFAULT.includes(k); c.addEventListener("change", update);
    l.append(c, document.createTextNode(" " + t)); box.appendChild(l);
  }
  // every choice is a row of boxes (real radio buttons, so the keyboard works): one click changes the preview
  const pick = (id) => { const c = document.querySelector("#" + id + " input:checked"); return c ? c.value : ""; };
  function addChoice(id, value, text, wall) {
    const l = document.createElement("label"), i = document.createElement("input"), b = document.createElement("span");
    l.className = "es-choice"; i.type = "radio"; i.name = id; i.value = value; i.checked = !$(id).querySelector("input"); b.className = "es-box";
    if (wall) {
      const w = document.createElement("span"); w.className = "es-swatch";
      if (wall.id) { w.style.setProperty("--wp-fill", wall.fill); w.style.setProperty("--wp-texture", wall.texture); w.style.setProperty("--wp-size", wall.size); w.style.setProperty("--wp-opacity", wall.opacity); }
      b.appendChild(w);
    }
    b.appendChild(document.createTextNode(text)); l.append(i, b); $(id).appendChild(l);
  }
  for (const [id, list] of [["es-output", [["widget", "Ready-made widget"], ["raw", "Raw data"]]],
    ["es-layout", [["feature", "Featured"], ["tiles", "Small tiles"], ["rows", "Rows"], ["inline", "One line"], ["cards", "Large cards"]]],
    ["es-theme", [["dark", "Dark"], ["light", "Light"], ["auto", "Match the visitor"]]]])
    for (const [v, t] of list) addChoice(id, v, t);
  addChoice("es-wallpaper", "", "None", {});
  import("./backgrounds.js").then((m) => {
    for (const b of m.BACKGROUNDS) addChoice("es-wallpaper", b.id, b.name.replace(/^\d+\s*·\s*/, ""), b);
  }).catch(() => {});
  const isRaw = () => pick("es-output") === "raw";
  function params() {
    const p = new URLSearchParams(), g = $("es-glyphs").value.trim().toUpperCase();
    p.set("glyphs", g);
    const gal = parseInt($("es-galaxy").value, 10) || 0;
    if (gal) p.set("galaxy", String(gal));
    const f = [...box.querySelectorAll("input:checked")].map((c) => c.value);
    if (f.join() !== DEFAULT.join()) p.set("fields", f.length ? f.join(",") : DEFAULT.join(","));
    if (isRaw()) { p.set("raw", "1"); return p; }
    if (pick("es-layout") !== "feature") p.set("layout", pick("es-layout"));
    if (pick("es-theme") !== "dark") p.set("theme", pick("es-theme"));
    const a = $("es-accent").value.trim().replace(/^#/, "");
    if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a)) p.set("accent", a);
    if ($("es-compact").checked) p.set("compact", "1");
    if ($("es-showglyphs").checked) p.set("show_glyphs", "1");
    if (pick("es-wallpaper")) p.set("wallpaper", pick("es-wallpaper"));
    const b = $("es-button").value.trim();
    if (b) p.set("button", b);
    return p;
  }
  let timer = 0;
  function update(e) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const p = params(), g = p.get("glyphs");
      const ok = /^[0-9A-F]{12}$/.test(g);
      $("es-status").textContent = ok ? "" : "Enter 12 hex digits (0-9, A-F).";
      const prev = "embed.html?" + p.toString() + "&preview=1"; // preview=1 reuses the scan; it never goes into the snippet
      if ($("es-preview").getAttribute("src") !== prev) $("es-preview").src = prev;
      const src = HOST + "embed.html?" + p.toString().replace(/&/g, "&amp;");
      for (const r of document.querySelectorAll(".es-look")) r.style.display = isRaw() ? "none" : "";
      $("es-fields-lbl").textContent = isRaw() ? "All numbers, the galaxy and the hex code are always sent. Tick End reward to send the reward too." : "What to show";
      $("es-code-note").textContent = isRaw() ? "Change the line that fills my-derelict to show the numbers your own way. Every field is listed under Developer notes." : "The small script is optional: it makes the frame as tall as its content.";
      if (isRaw()) {
        $("es-code").value = '<div id="my-derelict">Scanning...</div>\n<iframe src="' + src + '" hidden title="Derelict Atlas data"></iframe>\n'
          + '<script>\naddEventListener("message", function (e) {\n  if (e.origin !== "https://derelictatlas.github.io") return;\n  var d = e.data;\n  if (!d || d.type !== "derelict-atlas:result") return;\n'
          + '  var box = document.getElementById("my-derelict");\n  if (d.error) { box.textContent = "No data: " + d.error; return; }\n'
          + '  box.innerHTML = d.data.modules + " frigate modules, " + d.data.containers + " containers. <a href=\\"" + d.url + "\\">Open in Derelict Atlas</a>";\n});\n<\/script>';
        return;
      }
      $("es-code").value = '<iframe id="derelict-atlas" src="' + src + '" width="100%" height="420" style="border:0;max-width:640px" loading="lazy" title="Derelict Atlas"></iframe>\n'
        + '<script>\naddEventListener("message", function (e) {\n  if (e.origin !== "https://derelictatlas.github.io") return;\n  var d = e.data;\n'
        + '  if (d && d.type === "derelict-atlas:size") document.getElementById("derelict-atlas").style.height = d.height + "px";\n});\n<\/script>';
    }, e && e.target && e.target.type === "text" ? 250 : 0); // boxes apply at once, typing waits for a pause
  }
  for (const id of ["es-output", "es-layout", "es-glyphs", "es-galaxy", "es-theme", "es-wallpaper", "es-accent", "es-button", "es-compact", "es-showglyphs"]) { $(id).addEventListener("input", update); $(id).addEventListener("change", update); }
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "derelict-atlas:size") $("es-preview").style.height = Math.max(120, e.data.height + 4) + "px";
    if (e.data.type === "derelict-atlas:result" && e.data.error) $("es-status").textContent = e.data.error === "no derelict" ? "That system has no derelict freighter." : "Preview: " + e.data.error;
  });
  $("es-copy").addEventListener("click", () => {
    const t = $("es-code"); t.select();
    const done = () => { $("es-copied").textContent = "Copied."; setTimeout(() => { $("es-copied").textContent = ""; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(done, () => { document.execCommand("copy"); done(); });
    else { document.execCommand("copy"); done(); }
  });
  update();
})();
