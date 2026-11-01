import {esc} from './core.js';
import {rewardType} from './reward-types.js';
export {rewardType} from './reward-types.js';
export function rewardMarkup(r,compact=false){
  const name=r.reward_name||'Not computed',cls=/^[CBAS]$/.test(r.reward_class)?r.reward_class:'unknown',type=rewardType(r.reward_name);
  const icon=type+(cls!=='unknown'&&type!=='unknown'?'-'+cls:'');
  const description=(r.reward_name?`Predicted end reward of this system’s own derelict: ${r.reward_name} ${cls==='unknown'?'':cls}.`:'End reward not computed.')+(r.reward_ambiguous?` Ambiguous prediction${r.reward_alt?': could also be '+r.reward_alt.split('|').join(', '):''}.`:'')+' Beacon-summoned derelicts can differ.';
  return `<div class="${compact?'':'summary-metric '}end-reward reward reward-${cls}" data-reward-type="${type}" title="${esc(description)}"><span class="reward-art" aria-hidden="true"><img src="reward-icons/${icon}.svg" alt=""></span><span class="reward-copy"><span class="reward-label">End reward${r.reward_ambiguous?' ≈':''}</span><span class="sr-only">${cls==='unknown'?'Unknown class':cls+' class'}. </span><small class="reward-name">${esc(name)} <span class="reward-class-inline">(${cls==='unknown'?'—':cls})</span></small>${compact?'':`<small class="reward-prediction">${r.reward_name?'Predicted'+(r.reward_ambiguous?' · ambiguous':''):'Unknown'}</small>`}</span></div>`;
}
