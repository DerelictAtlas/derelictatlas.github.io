import {mapListName} from './atlas-features.js';
import {glyphsOf,known,totalOf} from './core.js';
import {derelictName} from './derelict-identity.js';
import {systemIdentity} from './system-identity.js';
import {rewardType} from './rewards.js';
export const SHARE_SITE=globalThis.DV_CONFIG?.siteBase||'https://derelictatlas.github.io/';  // SITE integration
export function systemShareLink(address,showReward,base=SHARE_SITE){
  if(!/^[0-9A-F]{16}$/i.test(address))throw new Error('A complete system address is required.');
  const url=new URL(base);url.search='';url.hash='/d/'+address.toUpperCase();url.searchParams.set('reward',showReward?'1':'0');return url.href;
}
export function sharePlan(row,groups,showReward,base=SHARE_SITE,layoutData={}){
  const freighterName=derelictName(row,layoutData),identity=systemIdentity(row),systemName=identity.name==='system_name'?'':identity.name;
  const address=row.address.toUpperCase(),glyphs=glyphsOf(address),url=systemShareLink(address,showReward,base),total=totalOf(row,groups).text;
  const modules=String(known(row.frigate_modules))+(row.frigate_modules_ambiguous?'?':'');
  const galaxy=row.galaxy===0?'Euclid':Number.isInteger(row.galaxy)?'Galaxy '+(row.galaxy+1):'Galaxy unknown';
  const groupLabels=groups.frigate&&groups.briefcases&&groups.tall?'All containers':[groups.frigate?'Crates + footlockers':'',groups.briefcases?'briefcases':'',groups.tall?'tall lockers':''].filter(Boolean).join(' + ')||'No container groups selected';
  let reward=null;
  if(showReward){const cls=/^[CBAS]$/.test(row.reward_class)?row.reward_class:'unknown',type=rewardType(row.reward_name);reward={computed:Boolean(row.reward_name),name:row.reward_name||'Not computed',cls,ambiguous:Boolean(row.reward_ambiguous),icon:'reward-icons/'+type+(cls!=='unknown'&&type!=='unknown'?'-'+cls:'')+'.svg'};}
  const title=(freighterName?'NMS Derelict · '+freighterName:'NMS Derelict · '+glyphs);
  const mapName=mapListName(row.map);
  const lines=[title,`${total} total (${groupLabels}) · ${modules} predicted Salvaged Frigate Modules`,`${known(row.rooms)} rooms · ${known(row.floors)} decks · ${galaxy}`,`Portal glyphs (hex): ${glyphs}`];
  if(systemName)lines.splice(1,0,'System: '+systemName+' · '+galaxy);
  if(reward)lines.push(`${reward.computed?'Predicted end reward':'End reward'}: ${reward.name} (${reward.cls==='unknown'?'—':reward.cls})${reward.ambiguous?' · uncertain':''}`);
  return {address,glyphs,url,title,mapName,total,modules,galaxy,derelictName:freighterName,systemName,groups:groupLabels,rooms:String(known(row.rooms)),decks:String(known(row.floors)),reward,caption:lines.join('\n')+'\n'+url,filename:'NMS-Derelict-'+glyphs+'.png'};
}
function xDraft(plan){
  const facts=`${plan.glyphs} · ${plan.total} loot · ${plan.modules} SFM (predicted)\n${plan.rooms} rooms · ${plan.decks} decks${plan.reward?'\n'+plan.reward.name+' ('+(plan.reward.cls==='unknown'?'—':plan.reward.cls)+')':''}\n${plan.url}`;
  const names=[plan.derelictName,plan.systemName].filter(Boolean).join(' · '),budget=Math.max(0,280-'NMS Derelict\n'.length-facts.length-3);
  const identity=names.length>budget?names.slice(0,Math.max(0,budget-1))+'…':names;
  return 'NMS Derelict'+(identity&&budget>1?' · '+identity:'')+'\n'+facts;
}
export function socialDrafts(plan){
  return [
    {name:'WhatsApp',url:'https://wa.me/?'+new URLSearchParams({text:plan.caption})},
    {name:'Reddit',url:'https://www.reddit.com/submit?'+new URLSearchParams({url:plan.url,title:plan.title})},
    {name:'X',url:'https://x.com/intent/post?'+new URLSearchParams({text:xDraft(plan)})}
  ];
}
export function sharePayload(plan,file,navigator_){
  const payload={title:plan.title,text:plan.caption,url:plan.url};
  try{if(file&&navigator_.canShare?.({files:[file]}))payload.files=[file];}catch{ /* Blocked file sharing still permits link/copy fallbacks. */ }
  return payload;
}
