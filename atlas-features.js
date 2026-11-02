// Atlas contracts introduced upstream on 2026-10-29. Function names are retained for integrations.
let ATLAS_RAW='https://raw.githubusercontent.com/vikkitor93-coder/nms-derelict-atlas/main/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function fetchGzipText(url){
  try{const r=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(25000)});if(!r.ok)return null;
  const bytes=new Uint8Array(await r.arrayBuffer());return bytes[0]===31&&bytes[1]===139?new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);}catch{return null;}
}
const MAP_BITS = new Map([[1, { label: "Most crates + footlockers", chip: "Top crates" }], [2, { label: "Most frigate modules", chip: "Top modules" }],
  [4, { label: "Map kept: S-class end reward", chip: "S reward map", kept: true }], [8, { label: "Most crates" }], [16, { label: "Most footlockers" }],
  [32, { label: "Most briefcases" }], [64, { label: "Most tall lockers" }], [128, { label: "Most rooms" }], [256, { label: "Most floors" }],
  [512, { label: "Most stairs" }], [1024, { label: "Hangar" }], [2048, { label: "Best end reward" }], [4096, { label: "Fewest frigate modules" }],
  [8192, { label: "Fewest crates" }], [16384, { label: "Map kept from the first atlas", chip: "Kept map", kept: true }],
  [32768, { label: "Most value" }], [65536, { label: "Most nanites" }]]);
// stats/systems.json map_lists [{bit, label, size, chip?}] -> labels and list sizes (the chip text stays the short one above)
function setMapLists(lists) {
  for (const l of Array.isArray(lists) ? lists : []) {
    const bit = Number(l.bit);
    if (!(bit > 0) || !l.label) continue;
    MAP_BITS.set(bit, { ...(MAP_BITS.get(bit) || {}), label: String(l.label), size: Number(l.size) || undefined, ...(l.chip ? { chip: String(l.chip) } : {}) });
  }
}
const hasBit = (m, b) => Math.floor(Number(m) / b) % 2 === 1;   // bits above 2^30 stay exact (no 32-bit "&")
function mapBitsOf(m) {
  const out = [];
  for (let b = 1, rest = Number(m) || 0; rest > 0 && b <= 2 ** 52; b *= 2) if (hasBit(rest, b)) { out.push(b); rest -= b; }
  return out;
}
const mapBitInfo = (b) => MAP_BITS.get(b) || { label: `List ${b}` };
const mapBitTitle = (b) => { const i = mapBitInfo(b); return i.kept ? i.label : `Top ${i.size || 100}: ${i.label}`; };
const mapListName = (m) => mapBitsOf(m).map(mapBitTitle).join("; ");
function mapChips(m) {
  return mapBitsOf(m).map((b) => ` <span class="chip map${b === 2 ? " mod" : ""}" title="${esc(`${mapBitTitle(b)}: full map and 3D view`)}">${esc(mapBitInfo(b).chip || mapBitInfo(b).label)}</span>`).join("");
}

const regionTextCache = new Map();
function regionText(address) {
  const path = `regions/g${address.slice(6, 8).toLowerCase()}/${address.slice(8, 10)}/${address.slice(10, 13)}/${address.slice(8)}.csv`;
  if (!regionTextCache.has(path)) {
    regionTextCache.set(path, fetch(ATLAS_RAW + path,{cache:'no-cache',signal:AbortSignal.timeout(25000)}).then((res) => (res.ok ? res.text() : null))
      .catch((e) => { regionTextCache.delete(path); throw e; }));
  }
  return regionTextCache.get(path);
}

// FF1 (fast-first scan): a region published with deferred systems lists them in "# deferred_systems: 001-019 01B ..."
// (hex system indexes). Those systems are absent from the rows but NOT without a derelict: they are scanned later.
async function atlasDeferred(address) {
  const text = await regionText(address);
  const line = text && text.split(/\r?\n/).find((l) => l.startsWith("# deferred_systems:"));
  if (!line) return false;
  const idx = parseInt(address.slice(3, 6), 16);
  return line.slice(19).trim().split(/\s+/).some((p) => { const [a, b] = p.split("-").map((x) => parseInt(x, 16)); return idx >= a && idx <= (b ?? a); });
}

// PR1 (to save space): systems scanned after the slim rule with few Salvaged Frigate Modules have no row; their module
// count is one character of "# slim_modules 001-0F3: <chars> <check>" ('.' none, 0-9 a-z slim count, A-Z pruned count).
async function atlasSlim(address) {
  const text = await regionText(address);
  if (!text) return null;
  const idx = parseInt(address.slice(3, 6), 16), D = "0123456789abcdefghijklmnopqrstuvwxyz", U = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const line of text.split(/\r?\n/)) {
    const m = /^# slim_modules ([0-9A-Fa-f]+)-([0-9A-Fa-f]+): (\S+)/.exec(line);
    if (!m || idx < parseInt(m[1], 16) || idx > parseInt(m[2], 16)) continue;
    const ch = m[3][idx - parseInt(m[1], 16)];
    if (ch && D.includes(ch)) return { modules: D.indexOf(ch), pruned: false };
    if (ch && U.includes(ch)) return { modules: U.indexOf(ch), pruned: true };
  }
  return null;
}

// PR1: stats/systems.json (written with the index) and views/map-lists.txt ("ADDRESS16 bits" per system with a full map).
// Both are optional: an atlas published before PR1 has neither, and everything falls back to the index / bundle.
let featureEpoch=0;
let atlasStatsCache = null;
function atlasStats() {
  const epoch=featureEpoch;
  if (!atlasStatsCache) atlasStatsCache = fetch(ATLAS_RAW + 'stats/systems.json',{cache:'no-cache',signal:AbortSignal.timeout(8000)}).then((r) => (r.ok ? r.json() : null))
    .then((s) => { if (epoch===featureEpoch && s && s.map_lists) setMapLists(s.map_lists); return s; })
    .catch((e) => {  return null; });
  return atlasStatsCache;
}
let mapListsCache = null;
function atlasMapLists() {
  if (!mapListsCache) mapListsCache = fetch(ATLAS_RAW + 'views/map-lists.txt',{cache:'no-cache',signal:AbortSignal.timeout(8000)}).then((r) => (r.ok ? r.text() : null)).then((t) => {
    if (!t) return null;
    const out = new Map();
    for (const line of t.split(/\r?\n/)) {
      const m = /^([0-9A-Fa-f]{16})\s+(\d+)/.exec(line);
      if (m) out.set(m[1].toUpperCase(), Number(m[2]));
    }
    return out;
  }).catch((e) => {  return null; });
  return mapListsCache;
}
// map bits of one system: map-lists.txt when published, else the bundle's "k" / the row's map column
async function mapBitsFor(address, fallback) {
  const [lists] = await Promise.all([atlasMapLists(), atlasStats()]);
  return lists ? (lists.get(address) || 0) : fallback;
}

let extrasCache = null;
function atlasExtras() {
  // + the visitor-scanned singles' extras (views/singles-extras.csv, scanner -cc singles Action; the main extras win)
  if (!extrasCache) extrasCache = Promise.all([fetchGzipText(ATLAS_RAW + "views/extras.csv.gz").then((t) => (t ? parseExtrasCsv(t) : null)),
    fetchGzipText(ATLAS_RAW + "views/singles-extras.csv").then((t) => (t ? parseExtrasCsv(t) : null)).catch(() => null)])
    .then(([main, singles]) => { if (!singles) return main; const out = main || new Map(); for (const [a, e] of singles) if (!out.has(a)) out.set(a, e); return out; })
    .catch((e) => {  return null; });
  return extrasCache;
}
// one CSV line -> cells (Python csv quoting: "a,b" and "" inside quotes)
function splitCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) { if (ch !== '"') cur += ch; else if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
// text -> Map ADDRESS16 -> { column: string } (or null when there is no usable row)
function parseExtrasCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return null;
  const head = splitCsvLine(lines.shift()).map((h) => h.trim());
  const out = new Map();
  for (const line of lines) {
    const v = splitCsvLine(line), e = Object.fromEntries(head.map((h, k) => [h, (v[k] ?? "").trim()]));
    const a = (e.address || "").toUpperCase();
    if (/^[0-9A-F]{16}$/.test(a)) out.set(a, e);
  }
  return out.size ? out : null;
}
const extraNum = (e, k) => (!e || e[k] === undefined || e[k] === "" || !Number.isFinite(Number(e[k])) ? null : Number(e[k]));
const fmtUnits = (n) => Number(n).toLocaleString();
// spookbox "<k>x<n>" -> { pkg: k, n }; "0" -> { pkg: 0, n: 0 } (hazard refresh only); "" or unknown text -> null
function parseSpookbox(code) {
  const s = String(code || "").trim();
  if (s === "0") return { pkg: 0, n: 0 };
  const m = /^(\d+)x(\d+)$/i.exec(s);
  return m ? { pkg: Number(m[1]), n: Number(m[2]) } : null;
}
// SITE integration: package k -> the preserved specimen it gives (W25, NMS 7.10 product table)
const SPOOKBOX_ITEMS = ["", "Preserved Brain", "Preserved Grub", "Preserved Sample", "Preserved Eyeball", "Preserved Egg", "Preserved Horror"];
const spookboxText = (code) => { const p = parseSpookbox(code); return !p ? String(code || "") : p.pkg ? `${SPOOKBOX_ITEMS[p.pkg] || `Package ${p.pkg}`} ×${p.n}` : "Hazard refresh only"; };
const spookboxSortKey = (code) => { const p = parseSpookbox(code); return p ? p.n * 100 + p.pkg : null; };  // amount first, then package
const spookboxAmbiguous = (e) => Boolean(e) && (e.spookbox_ambiguous === "1" || e.spookbox_ambiguous === "true");
// items_top "Hadal Core x2=195000|Units x151104=151104" -> ["Hadal Core ×2: 195,000 units", ...]
const itemsTopList = (txt) => String(txt || "").split("|").map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = /^(.*) x(\d+)=(\d+)$/.exec(x);
  return m ? `${m[1]} ×${fmtUnits(m[2])}: ${fmtUnits(m[3])} units` : x;
});
const rangeText = (lo, hi) => (lo !== null && hi !== null && lo !== hi ? `${fmtUnits(lo)}–${fmtUnits(hi)}` : "");
// hover texts (also used by the system page cards)
function itemValueTip(e) {
  const r = rangeText(extraNum(e, "items_value_min"), extraNum(e, "items_value_max")), amb = extraNum(e, "items_ambiguous"), top = itemsTopList(e.items_top);
  return [r ? `Range ${r} units${amb ? ` (${amb} container${amb === 1 ? "" : "s"} could differ)` : ""}` : "", top.length ? `Top items: ${top.join("; ")}` : ""].filter(Boolean).join(". ");
}
function nanitesTip(e) {
  const d = extraNum(e, "items_nanites_direct"), f = extraNum(e, "items_nanites_refiner"), r = rangeText(extraNum(e, "items_nanites_min"), extraNum(e, "items_nanites_max"));
  return [d !== null || f !== null ? `${d === null ? "?" : fmtUnits(d)} direct + ${f === null ? "?" : fmtUnits(f)} from a refiner` : "", r ? `range ${r}` : ""].filter(Boolean).join("; ");
}
function spookboxTip(e) {
  const alts = spookboxAmbiguous(e) ? String(e.spookbox_alt || "").split("|").map((x) => x.trim()).filter(Boolean).map(spookboxText) : [];
  return [spookboxAmbiguous(e) ? `Ambiguous prediction${alts.length ? ": could also be " + alts.join(", ") : ""}` : "", extraNum(e, "spookbox_value") !== null ? `Sells for ${fmtUnits(extraNum(e, "spookbox_value"))} units in total` : "", "Every SpookBox also refreshes hazard protection (NMS 7.10+)"].filter(Boolean).join(". ");
}
// table cells: empty when not computed
function itemValueCell(e) {
  const v = extraNum(e, "items_value");
  if (v === null) return "";
  const tip = itemValueTip(e);
  return `<span${tip ? ` title="${esc(tip)}"` : ""}>${fmtUnits(v)}</span>`;
}
function nanitesCell(e) {
  const v = extraNum(e, "items_nanites");
  if (v === null) return "";
  const tip = nanitesTip(e);
  return `<span${tip ? ` title="${esc(tip)}"` : ""}>${fmtUnits(v)}</span>`;
}
function spookboxCell(e) {
  if (!e || !e.spookbox) return "";
  return `<span title="${esc(spookboxTip(e))}">${spookboxAmbiguous(e) ? "≈ " : ""}${esc(spookboxText(e.spookbox))}</span>`;
}
// row fields of the extras columns (each column key is also its sort value; unknown = null, sorted last)
function applyExtras(r, e) {
  r.extras = e || null;
  r.items_value = extraNum(e, "items_value");
  r.items_nanites = extraNum(e, "items_nanites");
  r.spookbox = e ? spookboxSortKey(e.spookbox) : null;
}
// System page: the extras as cards after the "Predicted end reward" card (only the values that are present)
function extrasCardsHtml(e) {
  const card = (v, k, title, note, wide) => `<div data-extra-label="${esc(k)}" class="card${wide ? " reward-card" : ""}"${title ? ` title="${esc(title)}"` : ""}><div class="v">${v}</div><div class="k">${k}</div>${note ? `<div class="rw-note">${note}</div>` : ""}</div>`;
  const value = extraNum(e, "items_value"), nanites = extraNum(e, "items_nanites"), endValue = extraNum(e, "end_reward_value"), boxValue = extraNum(e, "spookbox_value");
  const valueRange = rangeText(extraNum(e, "items_value_min"), extraNum(e, "items_value_max")), top = itemsTopList(e.items_top);
  const out = [];
  if (value !== null) out.push(card(fmtUnits(value), "Item value (units)", "Units the loot of the crates, footlockers, briefcases and tall lockers is worth (NMS 7.10 values); the end reward and the SpookBox are not included.",
    [valueRange ? `Range ${esc(valueRange)}.` : "", top.length ? `Top items: ${top.map(esc).join("; ")}` : ""].filter(Boolean).join(" "), Boolean(valueRange || top.length)));
  if (nanites !== null) out.push(card(fmtUnits(nanites), "Nanites", `Nanites from the same containers: ${nanitesTip(e)}.`));
  if (e.spookbox) out.push(card(`${spookboxAmbiguous(e) ? "≈ " : ""}${esc(spookboxText(e.spookbox))}`, "SpookBox (7.10+)", "The SpookBox in this derelict (NMS 7.10 and later): which preserved specimen it gives and how many (each sells for 140,000 units).", esc(spookboxTip(e)) + ".", true));
  if (e.items_tech) out.push(card(esc(e.items_tech), "Upgrade modules C/B/A/S", "Upgrade modules in the containers by class C/B/A/S (not part of the item value)."));
  if (endValue !== null) out.push(card(fmtUnits(endValue), "End reward value (units)", "Value of the predicted end reward's base item, for comparison; not part of the item value."));
  if (boxValue !== null) out.push(card(fmtUnits(boxValue), "SpookBox value (units)", "Package amount × 140,000 units, for comparison; not part of the item value."));
  return out.join("");
}

export function configureAtlasFeatures(base){if(base&&base!==ATLAS_RAW){ATLAS_RAW=base.endsWith('/')?base:base+'/';resetAtlasFeatures();}}
const DEFAULT_MAP_BITS=new Map([...MAP_BITS].map(([b,v])=>[b,{...v}]));
export function resetAtlasFeatures(){featureEpoch++;regionTextCache.clear();atlasStatsCache=null;mapListsCache=null;extrasCache=null;MAP_BITS.clear();for(const [b,v] of DEFAULT_MAP_BITS)MAP_BITS.set(b,{...v});}
export const mapListBit=v=>v==='crates'?1:v==='modules'?2:Number(v)||0;
export function mapRows(rows,lists,bundle){for(const r of rows){r.map=lists?(lists.get(r.address)||0):r.map_column_present===false?Number(bundle?.k?.[r.address]||0):Number(r.map)||0;}return rows;}
export function slimMessage(s){return `${s.modules} Salvaged Frigate Modules. To save space, the atlas keeps only the module count for this system; full details are kept for systems with more modules.${s.pruned?' (recorded after the atlas reached its size limit)':''}`;}
export function fillExtras(address,target=globalThis.document?.querySelector('#system-extras'),isCurrent=()=>true){
  return atlasExtras().then(x=>{if(!target||!isCurrent())return;const e=x?.get(address),html=e?extrasCardsHtml(e):'';target.innerHTML=html;target.hidden=!html;});
}
export const COLUMNS=[
 {key:'items_value',extras:true,label:'Item value',num:true,cell:r=>itemValueCell(r.extras)},
 {key:'items_nanites',extras:true,label:'Nanites',num:true,cell:r=>nanitesCell(r.extras)},
 {key:'spookbox',extras:true,label:'SpookBox (7.10+)',cell:r=>spookboxCell(r.extras)}
];
export function atlasStatsHtml(s){
 if(!s?.tiers)return '';
 const fmt=n=>Number(n||0).toLocaleString(),ru=s.rules||{},mp=s.maps||{},cap=ru.atlas_cap||1000000,h=s.modules?.histogram||[];
 const capText=ru.cap_reached?`${ru.demo_cap?'DEMO cap: ':''}The atlas reached ${fmt(cap)} systems: ${ru.post_cap_rule==='top_lists'?'only systems that break into a top-100 list in any category are still added in full':`only systems with ${esc(ru.post_cap_min_modules??7)}+ Salvaged Frigate Modules (or in a top list) are still added in full`}; the others keep only their module count.`:`${ru.demo_cap?'DEMO cap: ':''}Atlas: ${fmt(s.total_systems)} of ${fmt(cap)} systems`;
 return `<p><b>${capText}</b></p><p>${fmt(s.total_systems)} systems: ${fmt(s.tiers.full)} full, ${fmt(s.tiers.slim)} slim, ${fmt(s.tiers.pruned)} pruned.</p><p>New systems with fewer than ${esc(ru.detail_min_modules??5)} Salvaged Frigate Modules keep only their module count unless they are in a top list. Slim and pruned systems are counted here but do not appear as table rows.</p>${mp.total!==undefined?`<p>${fmt(mp.total)} full maps. Lists: ${esc((s.map_lists||[]).map(l=>l.label).filter(Boolean).join(', '))||'Not listed'}. ${fmt(mp.kept_old)} kept old maps; ${fmt(mp.kept_s_reward)} S-class reward maps.</p>`:''}<div class="stats-table"><table><thead><tr><th>Modules</th><th>Systems</th></tr></thead><tbody>${Object.entries(h).map(([m,n])=>`<tr><td>${esc(m)}</td><td>${fmt(n)}</td></tr>`).join('')}</tbody></table></div>${Object.keys(s.galaxies||{}).length>1?`<div class="stats-table"><table><thead><tr><th>Galaxy</th><th>Systems</th><th>Regions</th></tr></thead><tbody>${Object.entries(s.galaxies).map(([g,v])=>`<tr><td>${esc(g)}</td><td>${fmt(v.systems)}</td><td>${fmt(v.regions)}</td></tr>`).join('')}</tbody></table></div>`:''}`;
}
export {MAP_BITS,setMapLists,hasBit,mapBitsOf,mapBitInfo,mapListName,mapChips,regionText,atlasSlim,atlasDeferred,atlasStats,atlasMapLists,mapBitsFor,atlasExtras,parseExtrasCsv,applyExtras,itemValueCell,nanitesCell,spookboxCell,extrasCardsHtml,extraNum,spookboxSortKey};
// Compatibility entry points for data hooks used by the original classic-script viewer.
if(typeof window!=='undefined')Object.assign(window,{atlasSlim,regionText,atlasDeferred,atlasStats,atlasMapLists,setMapLists,mapBitsOf,mapBitsFor,mapListName,hasBit,atlasExtras,parseExtrasCsv,applyExtras,itemValueCell,nanitesCell,spookboxCell,extrasCardsHtml,fillExtras});
