import {esc} from './core.js';
import {extraNum,spookboxCell,extrasCardsHtml} from './atlas-features.js';

const format=n=>n.toLocaleString();
export function lootSummaryHtml(e){
  if(!e)return '';
  const value=extraNum(e,'items_value'),nanites=extraNum(e,'items_nanites');
  const box=spookboxCell(e);
  if(value===null&&nanites===null&&!box)return '';
  return `<div class="loot-summary" aria-label="Loot overview">${box?`<button type="button" data-loot-info class="spook-chip" aria-haspopup="dialog">◇ <span>Loot · SpookBox ${box}</span></button>`:`<button type="button" data-loot-info class="spook-chip" aria-haspopup="dialog">◇ <span>Loot details</span></button>`}${value!==null?`<span class="loot-number" title="Estimated resale value of container loot, in Units (credits). Excludes SpookBox, end reward and upgrade modules."><strong>${format(value)}</strong> <small>Units · loot value</small></span>`:''}${nanites!==null?`<span class="loot-number" title="Total direct nanites plus nanites obtainable by refining the recorded container loot."><strong>${format(nanites)}</strong> <small>Nanites</small></span>`:''}</div>`;
}
export function lootBadgeHtml(e,sort=''){
  if(!e)return '';
  const value=extraNum(e,'items_value'),nanites=extraNum(e,'items_nanites');
  const box=spookboxCell(e),text=[box?`◇ ${box}`:'',value!==null?`${format(value)} U`:'',nanites!==null?`${format(nanites)} N`:''].filter(Boolean).join(' · ');
  return text?`<button type="button" class="loot-list-badge" data-loot-info aria-label="Loot details" title="${esc(text.replace(/<[^>]*>/g,''))} · U = Units (credits); N = nanites including refining">◇ ${sort==='items_value'&&value!==null?format(value)+' units':sort==='items_nanites'&&nanites!==null?format(nanites)+' nanites':sort==='spookbox'&&box?box:'Loot'}</button>`:'';
}
export function lootDetailsHtml(e){
  return `<p class="loot-explainer">Loot value estimates the sale value of recorded container loot; it is not a separate cash payout. Nanites include direct rewards and refining. SpookBox and end reward values are separate comparisons and are not added to loot value. Unknown values remain uncomputed.</p>${extrasCardsHtml(e||{})||'<p>Loot details not computed for this system.</p>'}`;
}
export function lootPanelHtml(e){
  const summary=lootSummaryHtml(e);if(!summary)return '';
  return summary;  // SITE integration (user 2026-10-31): no 'Loot details' drawer; the ⓘ button opens the same details
}
