# Reward-card SVG recreations

The original references chosen by the user are the **reward product** cards, not the installed freighter technology illustrations. These new native SVGs reproduce the glowing tilted-card frame, diagonal hatching, sparks and white reward emblems. C/B/A/S use green/blue/pink/gold card backgrounds, with neutral files for unknown classes. There are 41 SVGs: eight types × four classes, plus nine neutral fallbacks.

Original NMS icon designs and artwork: Hello Games. References: NMS Depot v4.4 archive. The white symbol outlines were digitized into vector paths from the reward references; the card background, frame and palette are reconstructed SVG geometry and gradients. These are close recreations, not a claim of pixel-identical game assets. No installed-tech artwork or raster image is embedded.

Mappings (reference filenames under https://www.nmsdepot.com/icons/):
- Hyperdrive: PROCTECH.S.HYPERDRIVE.png
- Fuel efficiency: PROCTECH.S.JETPACK.png
- Fleet beacon / speed: PROCTECH.S.VEHICLEBOOST.png
- Combat: PROCTECH.S.SHIPGUN.png
- Exploration: PROCTECH.S.BINOCS.png
- Mining: PROCTECH.S.LASER.png
- Trade: PROCTECH.S.RAILGUN.png
- Reactor: hyperdrive spiral, as in the supplied original-reactor reference.

Reference page: https://www.nmsdepot.com/Salvaged-Hyperdrive-Upgrade-4/

Rebuild with Node 22+: `node tools/build-reward-icons.mjs`.
The editable outlines live in `tools/reward-icon-design.json`; the palettes and card construction live in the build script. No image generator, API key, raster processing library or network access is needed to rebuild. View the full sheet at `reward-preview.html`.

Alignment: white outlines normally use their visible bounding-box center, matched to the diamond center (77,76 in the 128-unit viewBox). Mining uses a crystal-body optical anchor, excluding its thin beam (see below). Bounds, optical exceptions and common targets live in tools/reward-icon-design.json; each family uses the same correction across every class.

Canvas placement: the frame and aligned emblem are translated together by (−13,−12) to center the full reward card on (64,64). The emblem-to-frame position is preserved.

## Header item artwork

The header uses the original 128×128 Salvaged Frigate Module item artwork, stored locally as `../salvaged-frigate-module.png`, rather than the older SVG approximation (retained for compatibility). Artwork: Hello Games. Reference/download: https://www.nmsdepot.com/icons/PRODUCT.FRIGATETOKEN.png; item page: https://www.nmsdepot.com/Salvaged-Frigate-Module/. The PNG is bundled unchanged; the site's CSS adds only a subtle border and corner radius.

Mining optical alignment: the crystal body spans x43.5–92.5, y53.5–103.5 in the original outline. Its center (68,78.5) is the alignment anchor; the thin beam extending to x109.5 is excluded from the anchor. This shifts the mining emblem 8.5 units right compared with whole-outline bounding-box centering. Original symbol paths, beam shape, frame, colors and vertical placement are unchanged. The builder uses alignment.anchors for asymmetric exceptions and the existing full bounds for every other family.
