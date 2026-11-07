/* site-galaxy.js (SITE integration, user 2026-11-06: "i'd call the eissentam galaxy confirmed and add the rest to the search function")
 * One place for the galaxy names and labels, and the galaxy choice in the Search dialog.
 *   dvGalaxy.name(byte)   game name of the galaxy ("" when not named here)      dvGalaxy.short(byte)  "Eissentam" / "Galaxy 256"
 *   dvGalaxy.label(byte)  "Euclid" / "Eissentam (Galaxy 10)" / "Galaxy 256"       dvGalaxy.selected()   the Search dialog's choice (byte)
 *   dvGalaxy.confirmed(byte) true for Eissentam only (user's decision; the explanation stays honest: one derelict)
 * The galaxy byte is address digits 7-8 (ADDRESS16 = 000 SSS GG YY ZZZ XXX); the game counts galaxies from 1 (byte + 1).
 * Names: nomansskyrecipes.com galaxy guide and glyphs.had.sh/galaxy, 1-255 identical (Gfinity agrees on 1-255); byte 255 (galaxy 256)
 * is left as "Galaxy 256" because Gfinity calls #256 Yilsrussimil and #257 Odyalutai while the other two call #256 Odyalutai.
 * Only Galaxy 0 is in the atlas, the lists and the counts; a system of any other galaxy is scanned in the visitor's browser
 * only (site-scan.js never sends it). */
(function () {
  "use strict";
  const NAMES = ("Euclid,Hilbert Dimension,Calypso,Hesperius Dimension,Hyades,Ickjamatew,Budullangr,Kikolgallr,Eltiensleen,Eissentam,"
    + "Elkupalos,Aptarkaba,Ontiniangp,Odiwagiri,Ogtialabi,Muhacksonto,Hitonskyer,Rerasmutul,Isdoraijung,Doctinawyra,"
    + "Loychazinq,Zukasizawa,Ekwathore,Yeberhahne,Twerbetek,Sivarates,Eajerandal,Aldukesci,Wotyarogii,Sudzerbal,"
    + "Maupenzhay,Sugueziume,Brogoweldian,Ehbogdenbu,Ijsenufryos,Nipikulha,Autsurabin,Lusontrygiamh,Rewmanawa,Ethiophodhe,"
    + "Urastrykle,Xobeurindj,Oniijialdu,Wucetosucc,Ebyeloof,Odyavanta,Milekistri,Waferganh,Agnusopwit,Teyaypilny,"
    + "Zalienkosm,Ladgudiraf,Mushonponte,Amsentisz,Fladiselm,Laanawemb,Ilkerloor,Davanossi,Ploehrliou,Corpinyaya,"
    + "Leckandmeram,Quulngais,Nokokipsechl,Rinblodesa,Loydporpen,Ibtrevskip,Elkowaldb,Heholhofsko,Yebrilowisod,Husalvangewi,"
    + "Ovna'uesed,Bahibusey,Nuybeliaure,Doshawchuc,Ruckinarkh,Thorettac,Nuponoparau,Moglaschil,Uiweupose,Nasmilete,"
    + "Ekdaluskin,Hakapanasy,Dimonimba,Cajaccari,Olonerovo,Umlanswick,Henayliszm,Utzenmate,Umirpaiya,Paholiang,"
    + "Iaereznika,Yudukagath,Boealalosnj,Yaevarcko,Coellosipp,Wayndohalou,Smoduraykl,Apmaneessu,Hicanpaav,Akvasanta,"
    + "Tuychelisaor,Rivskimbe,Daksanquix,Kissonlin,Aediabiel,Ulosaginyik,Roclaytonycar,Kichiaroa,Irceauffey,Nudquathsenfe,"
    + "Getaizakaal,Hansolmien,Bloytisagra,Ladsenlay,Luyugoslasr,Ubredhatk,Cidoniana,Jasinessa,Torweierf,Saffneckm,"
    + "Thnistner,Dotusingg,Luleukous,Jelmandan,Otimanaso,Enjaxusanto,Sezviktorew,Zikehpm,Bephembah,Broomerrai,"
    + "Meximicka,Venessika,Gaiteseling,Zosakasiro,Drajayanes,Ooibekuar,Urckiansi,Dozivadido,Emiekereks,Meykinunukur,"
    + "Kimycuristh,Roansfien,Isgarmeso,Daitibeli,Gucuttarik,Enlaythie,Drewweste,Akbulkabi,Homskiw,Zavainlani,"
    + "Jewijkmas,Itlhotagra,Podalicess,Hiviusauer,Halsebenk,Puikitoac,Gaybakuaria,Grbodubhe,Rycempler,Indjalala,"
    + "Fontenikk,Pasycihelwhee,Ikbaksmit,Telicianses,Oyleyzhan,Uagerosat,Impoxectin,Twoodmand,Hilfsesorbs,Ezdaranit,"
    + "Wiensanshe,Ewheelonc,Litzmantufa,Emarmatosi,Mufimbomacvi,Wongquarum,Hapirajua,Igbinduina,Wepaitvas,Sthatigudi,"
    + "Yekathsebehn,Ebedeagurst,Nolisonia,Ulexovitab,Iodhinxois,Irroswitzs,Bifredait,Beiraghedwe,Yeonatlak,Cugnatachh,"
    + "Nozoryenki,Ebralduri,Evcickcandj,Ziybosswin,Heperclait,Sugiuniam,Aaseertush,Uglyestemaa,Horeroedsh,Drundemiso,"
    + "Ityanianat,Purneyrine,Dokiessmat,Nupiacheh,Dihewsonj,Rudrailhik,Tweretnort,Snatreetze,Iwundaracos,Digarlewena,"
    + "Erquagsta,Logovoloin,Boyaghosganh,Kuolungau,Pehneldept,Yevettiiqidcon,Sahliacabru,Noggalterpor,Chmageaki,Veticueca,"
    + "Vittesbursul,Nootanore,Innebdjerah,Kisvarcini,Cuzcogipper,Pamanhermonsu,Brotoghek,Mibittara,Huruahili,Raldwicarn,"
    + "Ezdartlic,Badesclema,Isenkeyan,Iadoitesu,Yagrovoisi,Ewcomechio,Inunnunnoda,Dischiutun,Yuwarugha,Ialmendra,"
    + "Reponudrle,Rinjanagrbo,Zeziceloh,Oeileutasc,Zicniijinis,Dugnowarilda,Neuxoisan,Ilmenhorn,Rukwatsuku,Nepitzaspru,"
    + "Chcehoemig,Haffneyrin,Uliciawai,Tuhgrespod,Iousongola").split(",");   // bytes 0-254; byte 255 is not named here
  const CONFIRMED = 9;   // Eissentam, galaxy 10
  const WHY = "Confirmed in-game on one derelict: map, rooms, a module crate, end reward and haunted crate matched. Ordinary loot barely tested.";
  const NOT_ATLAS = "Not in the atlas. Scanned in your browser.";
  const NOT_CHECKED = "Not checked in-game.";
  const ok = (b) => Number.isInteger(b) && b >= 0 && b <= 255;
  const name = (b) => (ok(b) ? NAMES[b] || "" : "");
  const num = (b) => "Galaxy " + (b + 1);
  const short = (b) => (!ok(b) ? "Galaxy unknown" : name(b) || num(b));
  const label = (b) => (!ok(b) ? "Galaxy unknown" : b === 0 ? "Euclid" : name(b) ? name(b) + " (" + num(b) + ")" : num(b));
  const confirmed = (b) => b === CONFIRMED;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const addrByte = (a) => { const v = String(a || "").toUpperCase().replace(/[\s-]/g, ""); return /^[0-9A-F]{16}$/.test(v) ? parseInt(v.slice(6, 8), 16) : null; };
  // lines shown for a galaxy other than Euclid
  const notes = (b) => (b === 0 ? [] : confirmed(b) ? [WHY, NOT_ATLAS] : [NOT_ATLAS, NOT_CHECKED]);
  let sel = null;
  const G = { name, short, label, confirmed, notes, WHY, NOT_ATLAS, NOT_CHECKED, addrByte, selected: () => (sel ? Number(sel.value) || 0 : 0) };
  globalThis.dvGalaxy = G;

  // ---- the Search dialog: galaxy choice (default Euclid on every open) ----
  const CSS = ".search-galaxy{display:flex;align-items:center;gap:8px;margin:6px 0}.search-galaxy label{flex:none;font-size:12px;color:var(--muted)}"
    + ".search-galaxy select{flex:1 1 auto;min-width:0;width:100%;font-size:13px;min-height:34px}"
    + ".gal-note{margin:2px 0 8px;font-size:11px;line-height:1.35;color:var(--muted)}.gal-note[hidden]{display:none}.gal-note b{color:var(--gold);font-weight:600}"
    + ".gal-viewer-note{margin:2px 0 4px;font-size:11px;line-height:1.35;color:var(--muted);white-space:normal}"
    + ".gal-badge{display:inline-block;margin-right:6px;padding:0 6px;border:1px solid var(--gold);border-radius:8px;color:var(--gold);font-size:10px;font-weight:600}";
  function noteHtml(b, inViewer) {
    const l = notes(b);
    if (!l.length) return "";
    const head = confirmed(b) ? `<span class="gal-badge" title="${esc(WHY)}">Confirmed</span>` : "";
    return (inViewer ? esc(num(b)) + " · " : "") + head + l.map(esc).join(" ");
  }
  function setNote() {
    const note = document.getElementById("gal-note"); if (!note || !sel) return;
    const b = G.selected(), html = noteHtml(b, false);
    note.innerHTML = html; note.hidden = !html;
    sel.title = confirmed(b) ? WHY : b ? NOT_ATLAS + " " + NOT_CHECKED : "";
    const m = document.getElementById("search-matches");
    if (b && m && /^(Searching|\d)/.test(m.textContent)) m.textContent = "";
  }
  function setSel(b) { if (sel && sel.value !== String(b)) sel.value = String(b); setNote(); }
  function fromInput() { const b = addrByte(document.getElementById("address-input").value); if (b !== null) setSel(b); else setNote(); }
  function initSearch() {
    sel = document.getElementById("gal-select"); const dlg = document.getElementById("address-dialog");
    if (!sel || !dlg) return;
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    sel.innerHTML = Array.from({ length: 256 }, (_, b) => `<option value="${b}">${esc(label(b) + (confirmed(b) ? " · Confirmed" : ""))}</option>`).join("");
    sel.value = "0";
    const input = document.getElementById("address-input");
    // a pasted 16-digit address brings its own galaxy; the control follows it
    input.addEventListener("input", fromInput);
    sel.addEventListener("change", () => {
      // with a full address in the box, the choice rewrites the address's own galaxy digits so the two never disagree
      const v = input.value.toUpperCase().replace(/[\s-]/g, "");
      if (/^[0-9A-F]{16}$/.test(v)) { input.value = v.slice(0, 6) + Number(sel.value).toString(16).toUpperCase().padStart(2, "0") + v.slice(8); input.dispatchEvent(new Event("input", { bubbles: true })); }
      setNote();
    });
    // every time the dialog opens: Euclid again (or the galaxy of the address still in the box)
    new MutationObserver(() => { if (dlg.hasAttribute("open")) { sel.value = "0"; fromInput(); } }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
  }

  // ---- the viewer: galaxy line under the system name for a galaxy other than Euclid ----
  function initViewer() {
    const host = document.getElementById("viewer-content"); if (!host) return;
    let queued = false;
    const run = () => {
      queued = false;
      const box = document.getElementById("system-identity"); if (!box || !box.parentNode) return;
      const m = /^#\/d\/([0-9A-Fa-f]{16})/.exec(location.hash), b = m ? addrByte(m[1]) : null;
      const old = box.parentNode.querySelector(".gal-viewer-note");
      const html = b ? noteHtml(b, true) : "";
      if (!html) { if (old) old.remove(); return; }
      if (old && old.innerHTML === html) return;
      const el = old || document.createElement("div");
      el.className = "gal-viewer-note"; el.innerHTML = html;
      if (!old) box.after(el);
    };
    const q = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
    new MutationObserver(q).observe(host, { childList: true });
    addEventListener("hashchange", q); q();
  }
  const start = () => { initSearch(); initViewer(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
