import {lootPanelHtml,lootBadgeHtml,lootDetailsHtml} from './loot-ui.js';
import {atlasSlim,atlasDeferred,regionText,atlasStats,atlasStatsHtml,atlasMapLists,mapRows,mapBitsOf,mapChips,mapListName,mapBitInfo,mapListBit,atlasExtras,applyExtras,extrasCardsHtml,resetAtlasFeatures,slimMessage as slimText} from './atlas-features.js';
import {VIEW_PRESETS} from './view-framing.js';
import {VERSION,nextSystemLimit,esc,known,glyphsOf,addressOf,totalOf,totalSortIncludes,family,COLORS,LINK_COLORS,parseCsv} from './core.js';
import {filterSortAtlas} from './atlas-processing.js';
import {initData,refreshData,layoutSignature,loadLayout,dataState,ATLAS,firstRows} from './data.js';
import {createMap} from './maps.js';
import {mountIsometric} from './isometric.js';
import {createWindowedList} from './windowed-list.js';
import {createSharing} from './share-ui.js';
import {createAutoRefresh} from './auto-refresh.js';
import {searchInput,appendGlyph,detectSearchFormat} from './search-input.js';
import {rewardMarkup} from './rewards.js';
import {REWARD_TYPES} from './reward-types.js';
import {MODULE_HELP,totalHelp} from './summary-help.js';
import {BACKGROUNDS,backgroundOption,nextBackground} from './backgrounds.js';
import {systemIdentity,SYSTEM_NAME_HELP} from './system-identity.js';
import {createQuickRunPlanner} from './quick-run-client.js';
import {createCompletion} from './completion.js';
import {derelictName} from './derelict-identity.js';
import {mountSupport} from './support.js';
const $=id=>document.getElementById(id);
$('support-unconfigured').hidden=mountSupport($('support-link'),$('support-link'));
const ICONS={reset:'<path d="M4 9a8 8 0 1 1-.3 6 M4 3v6h6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v7 M12 6v1"/>',search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',cube:'<path d="m12 2 9 5v10l-9 5-9-5V7Z M3 7l9 5 9-5 M12 12v10 M7 5l9 5v10"/>',list:'<path d="M9 5h12 M9 12h12 M9 19h12"/><path d="M3 4h2v2H3z M3 11h2v2H3z M3 18h2v2H3z"/>',copy:'<rect x="7" y="7" width="13" height="14" rx="2"/><path d="M16 7V3H3v13h4"/>',expand:'<path d="M14 3h7v7 M21 3l-8 8 M3 14v7h7 M3 21l8-8"/>'};
const icon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]||''}</svg>`;
for(const [id,k] of [['info-button','info'],['search-icon','search'],['viewer-icon','cube'],['systems-icon','list']]) $(id).innerHTML=icon(k);
const glyphNames=['Sunset','Bird','Face','Diplo','Eclipse','Balloon','Boat','Bug','Dragonfly','Galaxy','Voxel','Fish','Tent','Rocket','Tree','Atlas'];
function glyphs(address){return `<div class="glyphs" aria-label="Portal glyphs ${glyphsOf(address)}">${[...glyphsOf(address)].map(c=>`<img src="glyphs-svg/${c.toLowerCase()}.svg" alt="${glyphNames[parseInt(c,16)]}" title="${glyphNames[parseInt(c,16)]} · ${c}">`).join('')}</div>`;}
const responsiveness={longTasks:0,longestMs:0};
try{new PerformanceObserver(list=>{for(const entry of list.getEntries()){responsiveness.longTasks++;responsiveness.longestMs=Math.max(responsiveness.longestMs,Math.round(entry.duration));}}).observe({type:'longtask'});}catch{}
const log=[];
function record(message){log.unshift(new Date().toLocaleTimeString()+' · '+message);log.length=Math.min(log.length,30);}
function read(key,fallback){try{return JSON.parse(localStorage.getItem('dv.modern.'+key))??fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem('dv.modern.'+key,JSON.stringify(value));}catch{}}
let background;
function setBackground(id){
  const option=backgroundOption(id),root=document.documentElement;background=option.id;root.dataset.background=background;
  for(const [key,value] of Object.entries({fill:option.fill,texture:option.texture,size:option.size,opacity:option.opacity}))root.style.setProperty('--atlas-background-'+key,value);
}
setBackground(nextBackground(read('background',null)).id);save('background',background);
const defaults={mapList:'',q:'',galaxy:'',hasMap:false,hideDone:false,region:'',preset:'',reward:'',rewardModule:'',maxRooms:'',maxFloors:'',noStairs:false,noHangar:false,minTotal:'',minModules:'',minCrates:'',minBriefcases:'',minTall:'',sort:'modules',groups:{frigate:true,briefcases:true,tall:true}};  // SITE integration (user 2026-10-31): totals count every container
const filters={...defaults,...read('filters',{}),groups:{...defaults.groups}};
filters.region='';filters.galaxy='';filters.mapList=mapListBit(filters.mapList)||'';
// Retire the old Best Derelicts shortcut's coupled map/sort preference once.
if(!read('moduleDefaultV111',false)){filters.hasMap=false;filters.sort='modules';save('filters',filters);save('moduleDefaultV111',true);}
let showLootBadges=read('lootBadges',true);
let extrasAvailable=false,featureTicket=0,stats=null;
let rows=[],shown=[],current=null,view3d=null,map=null,loadId=0,tab='systems',toastTimer,expandedRestore=null,threeModule=null;
let queryTicket=0,computedRows=null,computedKey='',queryBusy=false;
let completionRevision=0;
const completion=createCompletion({initial:read('done',{}),persist:value=>save('done',value),updateRemote:async(address,done)=>{
  if(!dataState.local)return;
  const response=await fetch('/api/done',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,done})});
  if(!response.ok)throw new Error('Could not update local completion status');
},onChange:changed=>{syncDoneButtons();if(changed){completionRevision++;renderSystems();}}});
function syncDoneButtons(){
  if(!current)return;const address=current.row.address,done=completion.isDone(address);
  for(const id of ['viewer-done','mark-done']){const button=$(id);if(!button)continue;button.textContent=done?'✓ Finished Run':'Finished Run';button.setAttribute('aria-pressed',String(done));button.disabled=completion.isPending(address);button.title=done?'You have run this system. Click to mark as not done.':'Mark this system as run';}
}
async function toggleDone(address){try{if(await completion.toggle(address))toast(dataState.local?'Run history saved on your local server':'Run history saved in this browser');}catch(error){toast(error.message);}}
let atlasProgress={busy:true,phase:'Loading atlas…'};
function showAtlasProgress(update){
  if(update)atlasProgress=update;
  const busy=atlasProgress.busy||queryBusy,phase=firstMode?`Top ${rows.length} · loading…`:atlasProgress.busy?atlasProgress.phase:queryBusy?'Sorting systems…':'systems';
  $('atlas-spinner').hidden=!busy;$('atlas-status').textContent=phase||'systems';$('atlas-status').title=phase||'systems';
  $('results').setAttribute('aria-busy',String(queryBusy));
  $('refresh-atlas').disabled=atlasProgress.busy||!atlasReady;
  if(!rows.length&&Number.isSafeInteger(update?.count))$('system-count').textContent=update.count.toLocaleString();
}
let framing=Object.hasOwn(VIEW_PRESETS,read('framing','photo'))?read('framing','photo'):'photo';
let lookSensitivity=Math.min(1.5,Math.max(.3,Number(read('lookSensitivity',1))||1));
const layoutNames=new Map();
const layers={walls:true,floors:true,fixtures:true,doors:true,ladders:true,crates:true,footlockers:true,modules:true,briefcases:true,tallLockers:true,hazards:true,barrel:true,labels:true,entrance:true,hangarDetails:true,ship:true,...read('layers',{})};
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function setTab(next){tab=next;document.body.dataset.tab=tab;for(const k of ['viewer','systems']){$('nav-'+k).classList.toggle('active',k===tab);$('nav-'+k).setAttribute('aria-current',k===tab?'page':'false');}if(tab==='viewer')requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));}
$('nav-viewer').onclick=()=>{setTab('viewer');if(current)history.replaceState(null,'','#/d/'+current.row.address);};
$('nav-systems').onclick=()=>{setTab('systems');history.replaceState(null,'','#/');};
$('choose-system').onclick=()=>setTab('systems');
function openDialog(id){$(id).showModal();}
for(const d of document.querySelectorAll('dialog')) {
  d.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>d.close());
  d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
}

const linkedReward=new URLSearchParams(location.search).get('reward');
let showReward=linkedReward==='1'?true:linkedReward==='0'?false:read('showReward',false)===true;
function syncQuickToggles(){
  $('toggle-reward').setAttribute('aria-pressed',String(showReward));
  $('reward-toggle-label').textContent=showReward?'Hide End Reward':'Show End Reward';
  const viewerButton=$('viewer-toggle-reward');if(viewerButton){viewerButton.textContent=showReward?'Hide End Reward':'Show End Reward';viewerButton.setAttribute('aria-pressed',String(showReward));}
  document.body.classList.toggle('show-reward',showReward);
}
function setRewardVisibility(value){showReward=Boolean(value);save('showReward',showReward);syncQuickToggles();listRevision++;renderRows();updateSummary();}
$('toggle-reward').onclick=()=>setRewardVisibility(!showReward);
syncQuickToggles();
$('viewer-content').addEventListener('click',e=>{
  if(e.target.closest('[data-loot-info]'))showDetails('Loot details',lootDetailsHtml(current?.row.extras)+(globalThis.dvLootList?.(current?.row.address,current?.row.extras)||''));
  else if(e.target.closest('[data-loot-toggle]')){const drawer=$('loot-drawer');if(drawer){drawer.open=!drawer.open;e.target.closest('[data-loot-toggle]').setAttribute('aria-expanded',String(drawer.open));}}
  else if(e.target.closest('.uncertain'))showDetails('Module prediction uncertainty',`<p>${esc(MODULE_HELP)}</p>`);
  else if(e.target.closest('#system-name-info'))showDetails('Original procedural name',`<p>${esc(SYSTEM_NAME_HELP)}</p>`);
});
const ROW_HEIGHT=89;
let listFrame=0,listLimit=100,listRevision=0;
function createSystemCard(r){
  const t=totalOf(r,filters.groups),selected=current?.row.address===r.address;
  const done=completion.isDone(r.address),name=derelictName(r)||layoutNames.get(r.address)||'';
  const card=document.createElement('article');card.className='system-card'+(selected?' selected':'')+(done?' is-done':'')+(name?' has-name':'');card.dataset.address=r.address;card.setAttribute('role','button');card.tabIndex=0;
  card.setAttribute('aria-label',`Open ${name?name+', ':''}system ${glyphsOf(r.address)}, total ${t.text}, ${known(r.frigate_modules)} predicted modules${done?', Done — already run':''}`);card.setAttribute('aria-pressed',String(selected));
  if(r.device)card.classList.add('is-device');card.innerHTML=`${r.device?`<span class="site-device-tag" title="${r.device==='Local only'?'Scanned on this device; not added to the atlas':r.device==='Uploaded'?'Scanned on this device and sent to the atlas; it shows up in the atlas after the next update':'Scanned on this device; it will be sent to the atlas'}">${esc(r.device)}</span>`:''}<div class="card-main"><div class="glyph-address">${glyphs(r.address)}<span class="hex">${esc(glyphsOf(r.address))}</span></div><div class="quick-metrics"><div title="${esc(totalHelp(r,filters.groups))}"><b>${t.text}</b><span class="total-card-label">Total boxes</span></div><div class="module-value" title="${r.frigate_modules==null?'Modules not computed':'Predicted Salvaged Frigate Modules'}"><b>${known(r.frigate_modules)}${r.frigate_modules_ambiguous?' <button class="uncertain" type="button" title="'+esc(MODULE_HELP)+'" aria-label="Explain uncertain module prediction">?</button>':''}</b><span>Modules${r.frigate_modules==null?' <small>Not computed</small>':''}</span></div><div class="card-extra">${name?`<span class="card-derelict-name" title="${esc(name)}">${esc(name)}</span>`:''}<div class="substats">${done?'<span class="done-badge" title="You marked this system as run">✓ Done</span>':''}<span>${known(r.rooms)} rooms · ${known(r.floors)} decks</span></div>${showLootBadges||['items_value','items_nanites','spookbox'].includes(filters.sort)?lootBadgeHtml(r.extras,filters.sort):''}${showReward?rewardMarkup(r,true):''}</div></div></div>`;
  return card;
}
const systemList=createWindowedList($('results'),createSystemCard,{rowHeight:ROW_HEIGHT,isFocused:el=>el.contains(document.activeElement)});
$('results').addEventListener('click',e=>{
  if(e.target.closest('[data-loot-info]')){const a=e.target.closest('[data-address]')?.dataset.address,r=rows.find(r=>r.address===a)||shown.find(r=>r.address===a);showDetails('Loot details',lootDetailsHtml(r?.extras)+(globalThis.dvLootList?.(a,r?.extras)||''));return;}
  if(e.target.closest('.uncertain')){showDetails('Module prediction uncertainty',`<p>${esc(MODULE_HELP)}</p>`);return;}
  if(e.target.closest('#empty-reset')){resetFilters();return;}
  const card=e.target.closest('[data-address]');if(card)navigate(card.dataset.address);
});
$('results').addEventListener('keydown',e=>{const card=e.target.closest('[data-address]');if(card&&e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();navigate(card.dataset.address);}});
function renderRows(){
  const focused=document.activeElement,focusedAddress=focused?.closest?.('[data-address]')?.dataset.address;
  const loadedCount=Math.min(shown.length,listLimit),host=$('results');
  if(shown.length)systemList.render(shown,loadedCount,listRevision);
  else if(firstMode){systemList.clear();host.innerHTML='<div class="no-results site-first-wait">Not in the top '+rows.length+' systems.<br>The full list is still loading…</div>';}
  else if(!host.querySelector('.no-results:not(.site-first-wait)')){systemList.clear();host.innerHTML='<div class="no-results">No matching systems.<br>Try fewer filters or a different glyph address.<br><button id="empty-reset" class="primary">Reset filters</button></div>';{let a=null;try{a=addressOf(filters.q,filters.galaxy||0);}catch(_){}if(a&&!rows.some(r=>r.address===a)&&!globalThis.dvScannedHere?.(a))globalThis.dvNoResultsAddress?.(host.querySelector('.no-results'),a,()=>{globalThis.dvSearchedAddress=a;navigate(a);});}}
  if(focusedAddress&&!focused.isConnected)host.querySelector('[data-address="'+focusedAddress+'"]')?.focus({preventScroll:true});
  const status=firstMode?`${shown.length.toLocaleString()} of the top ${rows.length.toLocaleString()} · loading the full list…`:loadedCount<shown.length?`${loadedCount.toLocaleString()} of ${shown.length.toLocaleString()} systems loaded · scroll for more`:shown.length.toLocaleString()+' matching systems';
  if($('page-info').textContent!==status)$('page-info').textContent=status;
}
function scheduleList(){
  if(!rows.length||listFrame)return;listFrame=requestAnimationFrame(()=>{
    listFrame=0;
    const host=$('results'),nearEnd=host.scrollTop+host.clientHeight>=listLimit*ROW_HEIGHT-ROW_HEIGHT*3;
    listLimit=nextSystemLimit(listLimit,shown.partial||shown.length,nearEnd);renderRows();
  });
}
$('results').addEventListener('scroll',scheduleList,{passive:true});
const filterKeys=['mapList','hasMap','hideDone','preset','reward','rewardModule','maxRooms','maxFloors','noStairs','noHangar','minTotal','minModules','minCrates','minBriefcases','minTall'];
// SITE integration (user 2026-10-31): systems scanned on this device (site-scan.js) that are not in the atlas join the
// Systems list like any other row, tagged Local only / Not uploaded yet / Uploaded (this browser only)
let firstMode=false;  // SITE integration (fast first page): rows = index/first.csv while the full index loads
let deviceBase=null,deviceRev=-1,deviceSource=null;
function withDeviceRows(base){const rev=globalThis.dvDeviceRevision||0;if(base===deviceBase&&rev===deviceRev)return deviceSource;
  const add=[];for(const s of (globalThis.dvDeviceScans?.()||[])){if(!s.row||base.some(r=>r.address===s.address))continue;
    const cols=Object.keys(s.row),cell=v=>{const t=v==null?'':String(v);return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
    const parsed=parseCsv(cols.join(',')+'\n'+cols.map(c=>cell(s.row[c])).join(','))[0];if(!parsed)continue;
    const row={...parsed,address:s.address,galaxy:parseInt(s.address.slice(6,8),16),region:s.address.slice(8),map:0,device:s.tag};
    applyExtras(row,s.extras?Object.fromEntries(Object.entries(s.extras).map(([k,v])=>[k,v==null?'':String(v)])):null);add.push(row);}
  deviceBase=base;deviceRev=rev;deviceSource=add.length?base.concat(add):base;return deviceSource;}
globalThis.dvDeviceChanged=()=>{globalThis.dvDeviceRevision=(globalThis.dvDeviceRevision||0)+1;if(rows.length)renderSystems();};
async function renderSystems(reset=false){
  const ticket=++queryTicket,source=withDeviceRows(rows),settings={...filters,groups:{...filters.groups}},key=JSON.stringify(settings)+(settings.hideDone?':'+completionRevision:'');
  syncQuickToggles();syncSortLabel();
  queryBusy=!(source===computedRows&&key===computedKey);showAtlasProgress();
  const result=queryBusy?await filterSortAtlas(source,settings,{isCurrent:()=>ticket===queryTicket,isDone:completion.isDone,firstK:Math.max(400,listLimit+300),isFullCurrent:()=>computedRows===source&&computedKey===key}):shown;
  if(ticket!==queryTicket||!result)return false;
  queryBusy=false;showAtlasProgress();computedRows=source;computedKey=key;shown=result;listRevision++;
  // SITE integration (fast first page): the first rows show at once; the fully sorted list replaces them (same order)
  if(result.full)result.full.then(all=>{if(all&&shown===result){shown=all;renderRows();}});
  if(reset){$('results').scrollTop=0;listLimit=0;}
  listLimit=nextSystemLimit(listLimit,shown.partial||shown.length);
  renderRows();
  if($('address-dialog').open)$('search-matches').textContent=shown.length.toLocaleString()+' matches · current filters';
  const names={mapList:mapBitInfo(mapListBit(filters.mapList)).label,hasMap:'Has map',hideDone:'Hide done systems',region:filters.region,preset:filters.preset,reward:filters.reward+'-class reward',rewardModule:REWARD_TYPES[filters.rewardModule]||filters.rewardModule,maxRooms:'≤ '+filters.maxRooms+' rooms',maxFloors:'≤ '+filters.maxFloors+' decks',noStairs:'No ladders',noHangar:'No hangar',minTotal:'Total ≥ '+filters.minTotal,minModules:'Modules ≥ '+filters.minModules,minCrates:'Crates ≥ '+filters.minCrates,minBriefcases:'Briefcases ≥ '+filters.minBriefcases,minTall:'Tall lockers ≥ '+filters.minTall};
  const active=filterKeys.filter(k=>Boolean(filters[k]));
  $('filter-count').hidden=!active.length;$('filter-count').textContent=active.length;
  const visibleChips=matchMedia('(min-width:701px)').matches?active.slice(0,2):active;
  $('filter-chips').innerHTML=visibleChips.map(k=>`<button class="chip" data-clear="${k}"><span class="chip-label">${esc(names[k])}</span> <span aria-hidden="true">×</span><span class="sr-only">Remove filter</span></button>`).join('')+(visibleChips.length<active.length?`<button class="chip" id="more-filter-chips">+${active.length-visibleChips.length}</button>`:'');
  $('more-filter-chips')?.addEventListener('click',()=>{buildFilterFields();openDialog('filter-dialog');});
  $('filter-chips').querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>{filters[b.dataset.clear]=typeof defaults[b.dataset.clear]==='boolean'?false:'';renderSystems(true);});
  $('source-status').textContent=`${dataState.source} · ${rows.length.toLocaleString()} systems`;
  if(!firstMode||stats?.total_systems!=null)$('system-count').textContent=Number(stats?.total_systems??rows.length).toLocaleString();
  save('filters',filters);
  return true;
}
function syncSortLabel(){
  const includes=totalSortIncludes(filters.groups);
  $('sort').querySelector('option[value="total"]').textContent=`Highest total (${includes}) ↓`;
  $('sort-control').dataset.total=String(filters.sort==='total');
  $('sort-total-detail').textContent=`(${includes})`;
  $('sort').title=filters.sort==='total'?`Highest total (${totalDescription()})`:'';
}
function totalDescription(){if(filters.groups.frigate&&filters.groups.briefcases&&filters.groups.tall)return 'All containers';return [filters.groups.frigate?'Crates + footlockers':'',filters.groups.briefcases?'Briefcases':'',filters.groups.tall?'Tall lockers':''].filter(Boolean).join(' + ')||'No groups selected';}
function syncSearchLabel(){$('search-label').textContent=filters.q||'Search names, glyphs or address';$('search').classList.toggle('has-query',Boolean(filters.q));$('clear-search').hidden=!filters.q;}
syncSearchLabel();$('sort').value=filters.sort;syncSortLabel();
$('search').onclick=()=>openSearch();
$('clear-search').onclick=()=>{clearTimeout(searchTimer);filters.q='';$('address-input').value='';updateSearchEntry(false);syncSearchLabel();renderSystems(true);$('search').focus();};
$('sort').onchange=e=>{filters.sort=e.target.value;renderSystems(true);};
function resetFilters(){Object.assign(filters,structuredClone(defaults));syncSearchLabel();$('sort').value='modules';renderSystems(true);if(current)updateSummary();if($('filter-dialog').open)buildFilterFields();}
$('reset-filters').onclick=resetFilters;
function buildFilterFields(){
  const select=(k,label,options)=>`<label>${label}<select name="${k}" aria-label="${esc(label)}"><option value="">All</option>${options.map(option=>{const [v,label]=Array.isArray(option)?option:[option,option];return `<option value="${esc(v)}"${String(filters[k])===String(v)?' selected':''}>${esc(label)}</option>`;}).join('')}</select></label>`;
  const number=(k,label)=>`<label>${label}<input type="number" min="0" name="${k}" value="${esc(filters[k])}" placeholder="Any"></label>`;
  const checkbox=(k,label)=>`<label class="check"><input name="${k}" type="checkbox"${filters[k]?' checked':''}>${label}</label>`;
  const listBits=[...new Set(rows.filter(r=>r.map).flatMap(r=>mapBitsOf(r.map)))].sort((a,b)=>a-b);
  $('filter-fields').innerHTML=select('mapList','Map list',listBits.map(b=>[b,mapBitInfo(b).label]))+select('preset','Derelict type',[...new Set(rows.map(r=>r.preset))].sort())+select('reward','End reward class',['S','A','B','C'])+select('rewardModule','End reward module',Object.entries(REWARD_TYPES))+number('maxRooms','Maximum rooms')+number('maxFloors','Maximum decks')+number('minTotal','Minimum total')+number('minModules','Minimum predicted modules')+number('minCrates','Minimum salvage crates')+number('minBriefcases','Minimum briefcases')+number('minTall','Minimum tall lockers')+checkbox('hideDone','Hide done systems')+checkbox('hasMap','Published map available')+checkbox('noStairs','No ladders')+checkbox('noHangar','No hangar');
  if(extrasAvailable){$('filter-fields').insertAdjacentHTML('beforeend',`<label class="check"><input id="loot-badges" type="checkbox"${showLootBadges?' checked':''}>Show loot badges</label>`);$('loot-badges').onchange=e=>{showLootBadges=e.target.checked;save('lootBadges',showLootBadges);listRevision++;renderRows();};}
  function example(){const names=[['frigate','31 crates + 4 footlockers',35],['briefcases','3 briefcases',3],['tall','2 tall lockers',2]],enabled=names.filter(([k])=>$('filters-form').elements['group-'+k].checked);$('total-example').textContent='Example: '+(enabled.length?enabled.map(x=>x[1]).join(' + ')+' = '+enabled.reduce((n,x)=>n+x[2],0)+' total.':'no groups selected = 0 total.')+' Unknown counts display a lower bound, such as 35+.';}
  
}
$('filters-button').onclick=()=>{buildFilterFields();openDialog('filter-dialog');};
$('filters-form').onsubmit=e=>{e.preventDefault();const values=new FormData(e.target);for(const k of filterKeys)filters[k]=typeof defaults[k]==='boolean'?values.has(k):String(values.get(k)||'');renderSystems(true);if(current)updateSummary();$('filter-dialog').close();};
let searchTimer;
function applySearch(){
  clearTimeout(searchTimer);const value=searchInput($('address-input').value,'auto'),format=detectSearchFormat(value);filters.q=(format==='text'?value:searchInput(value,format)).trim();syncSearchLabel();return renderSystems(true);
}
function updateSearchEntry(search=true){
  const input=$('address-input');input.value=searchInput(input.value,'auto');
  const format=detectSearchFormat(input.value),hex=searchInput(input.value,format==='address'?'address':'glyphs'),length=format==='text'?input.value.length:hex.length,limit=format==='address'?16:format==='text'?80:12;
  $('address-label').textContent='Name, glyphs, address or preset';
  $('address-count').textContent=format==='text'?input.value.length+' characters':`${length} / ${limit}`;
  $('glyph-keypad').hidden=format!=='glyphs';$('glyph-preview').hidden=format!=='glyphs';
  $('glyph-preview').innerHTML=format==='glyphs'?Array.from({length:12},(_,i)=>hex[i]?`<img src="glyphs-svg/${hex[i].toLowerCase()}.svg" alt="${glyphNames[parseInt(hex[i],16)]}">`:'<span aria-hidden="true">·</span>').join(''):'';
  const full=format==='glyphs'&&length===12;
  $('glyph-keypad').querySelectorAll('button').forEach(b=>b.disabled=full);
  $('address-hint').textContent=full?'All 12 glyphs entered.':format==='glyphs'?'Choose glyphs or type any search.':format==='address'?'Universe address detected.':'Searching all available text fields.';
  $('open-search-viewer').disabled=!((format==='glyphs'&&length===12)||(format==='address'&&length===16));
  $('address-error').textContent='';
  if(search){clearTimeout(searchTimer);$('search-matches').textContent='Searching…';searchTimer=setTimeout(applySearch,250);}
}
function openSearch(){
  $('address-input').value=filters.q;updateSearchEntry(false);$('search-matches').textContent=shown.length.toLocaleString()+' matches · current filters';openDialog('address-dialog');if(matchMedia('(pointer: coarse)').matches)document.activeElement?.blur?.();else $('address-input').focus();
}
$('glyph-keypad').innerHTML=glyphNames.map((name,i)=>`<button type="button" data-glyph="${i.toString(16).toUpperCase()}" aria-label="Add ${name} glyph"><img src="glyphs-svg/${i.toString(16)}.svg" alt="${name}"></button>`).join('');
$('glyph-keypad').querySelectorAll('[data-glyph]').forEach(b=>b.onclick=()=>{$('address-input').value=appendGlyph($('address-input').value,b.dataset.glyph);updateSearchEntry();});
$('address-input').oninput=()=>updateSearchEntry();
$('clear-address').onclick=()=>{$('address-input').value='';updateSearchEntry();if(!matchMedia('(pointer: coarse)').matches)$('address-input').focus();};
$('address-form').onsubmit=e=>{e.preventDefault();if(!$('open-search-viewer').disabled){try{const address=addressOf($('address-input').value,filters.galaxy||0);if(!rows.some(r=>r.address===address)){$('open-search-viewer').click();return;}}catch(_){}}applySearch();$('address-dialog').close();history.replaceState(null,'','#/');setTab('systems');};
$('open-search-viewer').onclick=()=>{clearTimeout(searchTimer);try{const address=addressOf($('address-input').value,filters.galaxy||0);$('address-dialog').close();globalThis.dvSearchedAddress=address;navigate(address);}catch(error){$('address-error').textContent=error.message;}};

function navigate(address){if(location.hash===`#/d/${address}`)openViewer(address);else location.hash=`#/d/${address}`;setTab('viewer');}
// SITE integration (user 2026-10-31): show a system scanned in this browser (site-scan.js): the scanner's row has the
// index columns, so it goes through the same CSV parser as the atlas rows.
globalThis.dvShowScanned=(address,scanRow,extras,derelict)=>{if(!current||current.row.address!==address||!scanRow)return;
  const cols=Object.keys(scanRow),cell=v=>{const s=v==null?'':String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const parsed=parseCsv(cols.join(',')+'\n'+cols.map(c=>cell(scanRow[c])).join(','))[0];if(!parsed)return;
  const ex=extras?Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v==null?'':String(v)])):current.row.extras;
  current={...current,row:{...current.row,...parsed,address,galaxy:parseInt(address.slice(6,8),16),extras:ex},scanned:true,slim:null,deferred:false};
  renderViewer();
  // W29c: the derelict.json from the scanner -> the map, built like an imported file (this browser only)
  return derelict?globalThis.dvShowMap(address,derelict,'Scanned on this device'):Promise.resolve(false);};
// Show map: the derelict.json from the scanner -> the map of a system already in the atlas (this browser only)
// loot numbers computed on this device for an atlas system without them (this page only; the atlas list is not changed)
globalThis.dvFillExtras=(address,extras)=>{if(!current||current.row.address!==address||!extras||current.row.items_value!=null)return false;const row={...current.row};applyExtras(row,Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v==null?'':String(v)])));current={...current,row,lootOnDevice:true};renderViewer();return true;};
function keepDeviceLoot(r){const c=current&&current.row;return current&&current.lootOnDevice&&c&&c.address===r.address&&r.items_value==null?{...r,extras:c.extras,items_value:c.items_value,items_nanites:c.items_nanites,spookbox:c.spookbox}:r;}
globalThis.dvShowMap=(address,derelict,source)=>{if(!current||current.row.address!==address||!derelict||current.layout)return Promise.resolve(false);return import('./data.js').then(async m=>{const [b,p]=await Promise.all([m.bundle().catch(()=>null),m.props()]);const q=b?.t,index={};if(q?.n)q.n.forEach((name,k)=>{const w=[],f=[];for(let j=0;j<q.w[k].length;j+=5)w.push([...q.w[k].slice(j,j+4).map(x=>x/q.q),q.w[k][j+4]]);for(let j=0;j<q.f[k].length;j+=6)f.push(q.f[k].slice(j,j+6).map(x=>x/q.q));index[name]={walls:w,fixtures:f};});const d={...derelict,address},pieceIndex=q?.n?index:null;return {m:window.DerelictModel.build(d,pieceIndex,p),d,pieceIndex};}).then(layout=>{if(!current||current.row.address!==address)return false;current={...current,layout:{...layout,source:source||'Drawn on this device'}};renderViewer();return true;}).catch(e=>{record('map: '+e.message);return false;});};
function summaryData(){
  const row={...current.row};
  if(current.layout){const m=current.layout.m;row.salvage_crates=m.containers.filter(c=>c.container_kind==='salvage_crate').length;row.footlockers=m.containers.length-row.salvage_crates;row.briefcases=m.extras?m.extras.filter(c=>c.container_kind==='briefcase').length:null;row.tall_lockers=m.extras?m.extras.filter(c=>c.container_kind==='tall_locker').length:null;row.rooms=m.rooms.length;row.floors=new Set(m.rooms.flatMap(r=>r.levels)).size;}
  return row;
}
function summaryMarkup(r){if(current?.slim)return `<div class="summary-metric gold"><strong>${current.slim.modules}</strong><span>Salvaged Frigate Modules</span></div>`;return `<div class="summary-metric" title="${esc(totalHelp(r,filters.groups))}"><strong>${totalOf(r,filters.groups).text}</strong><span>Total<small>${esc(totalDescription())}</small></span></div><div class="summary-metric gold" title="${esc(MODULE_HELP)}"><strong>${known(r.frigate_modules)}${r.frigate_modules_ambiguous?'<button class="uncertain" type="button" aria-label="Explain uncertain module prediction" title="'+esc(MODULE_HELP)+'">?</button>':''}</strong><span>Salvaged Frigate Modules<small>${r.frigate_modules==null?'Not computed':'Predicted'}</small></span></div><div class="summary-reward-slot">${showReward?rewardMarkup(r):''}</div><div class="summary-minor"><span title="Every lootable container, counted separately.">${known(r.salvage_crates)} crates · ${known(r.footlockers)} footlockers · ${known(r.briefcases)} briefcases · ${known(r.tall_lockers)} tall lockers</span><span title="Total rooms, including entrance and end rooms, and occupied deck levels in this derelict.">${known(r.rooms)} rooms · ${known(r.floors)} decks</span></div>`;}
function updateSummary(){if(current&&$('view-summary')){
  $('view-summary').innerHTML=summaryMarkup(summaryData());
  const identity=systemIdentity(current.row);
  syncDerelictName();syncExtras();
  if($('viewer-map-lists'))$('viewer-map-lists').innerHTML=mapChips(current.row.map);
  $('system-name').textContent=identity.name;$('system-galaxy').textContent=identity.galaxy;$('system-identity').title=identity.label;
}}
function syncDerelictName(){
  const name=derelictName(current.row,current.layout?.d),heading=$('derelict-name');
  if(heading){heading.textContent=name;heading.title=name;$('derelict-heading').hidden=!name;}
}
function ids(str){return new Set(String(str||'').split('.').filter(Boolean).map(Number));}
async function openViewer(address){
  const ticket=++loadId;
  if($('expand-dialog').open)$('expand-dialog').close();
  view3d?.dispose();view3d=null;map?.dispose();map=null;
  $('viewer-empty').hidden=true;$('viewer-content').hidden=false;
  $('viewer-content').innerHTML='<div class="loading"><span></span>Loading derelict layout…</div>';
  let row=rows.find(r=>r.address===address)||{address,glyphs:glyphsOf(address),galaxy:parseInt(address.slice(6,8),16),region:address.slice(8),frigate_modules:null};
  try{
    const layout=await loadLayout(address);
    let slim=null,deferred=false;
    if(!rows.some(r=>r.address===address)){
      const text=await regionText(address).catch(()=>null),full=text?parseCsv(text).find(r=>r.glyphs===glyphsOf(address)):null;
      if(full)row={...full,address,galaxy:parseInt(address.slice(6,8),16)};
      else{slim=await atlasSlim(address).catch(()=>null);if(!slim)deferred=await atlasDeferred(address).catch(()=>false);if(slim)row={...row,frigate_modules:slim.modules};}
    }
    if(ticket!==loadId)return;
    const name=derelictName(row,layout?.d);if(name)layoutNames.set(address,name);
    current={row,layout,slim,deferred};save('selected',address);record(`${address}: ${layout?layout.source:'summary only'}`);
    renderViewer();renderSystems();
    globalThis.dvSystemOpened?.({address,unscanned:!layout&&row.rooms==null&&!slim,nomap:!layout&&row.rooms!=null&&!slim,noloot:row.rooms!=null&&!slim&&row.items_value==null,slim:!!slim,deferred});
  }catch(error){if(ticket!==loadId)return;record(error.message);$('viewer-content').innerHTML=`<div class="notice"><h2>Layout could not load</h2><p>${esc(error.message)}</p><button id="retry-layout" class="primary">Try again</button></div>`;$('retry-layout').onclick=()=>openViewer(address);}
}
const sharing=createSharing({getSelection:()=>{
  if(!current)return null;
  const engine=view3d;
  return {row:{...summaryData()},groups:{...filters.groups},showReward,model:current.layout?.m,layoutData:current.layout?.d,
    moduleIds:ids(current.row.frigate_module_ids),possibleIds:ids(current.row.frigate_module_alt_ids),layers:{...layers},spread:read('spread',1.6),framing,
    capture3D:engine?.captureDefault&&!engine.firstPerson?.().active?(w,h)=>engine.captureDefault(w,h):null};
},onRewardChange:setRewardVisibility,onFramingChange:value=>{framing=value;save('framing',framing);map?.setFraming(framing);view3d?.setOptions({framing});record('Default + photo framing: '+framing);},onLog:record});
const viewerPanels={layers:false,spacing:false,quick:false};
const routePlanner=createQuickRunPlanner(),quickSettings={includePossible:false,finishAtEnd:false};
let routeResult=null,routeStep=0,routeTicket=0;
window.addEventListener('pagehide',event=>{if(!event.persisted)routePlanner.dispose();});
const ROUTE_HELP='Routes start at the entrance and use mapped floor space, doors, fixture footprints and ladder links. Distances are in 8m grid tiles; one deck climb counts as one tile. Pickup approaches use a sampled grid. Hazards and combat time are not scored. Module locations are predictions.';
function setRouteStatus(text,problem=false){
  const status=$('route-status'),info=$('route-info');if(status)status.textContent=text;
  if(info){info.title=text+'\n'+ROUTE_HELP;info.classList.toggle('route-problem',problem);}
}
function paintRoute(){
  const shown=viewerPanels.quick&&routeResult?.status==='ready';map?.setRoute(shown?routeResult:null,routeStep);view3d?.setRoute?.(shown?routeResult:null,routeStep);
  if(!$('route-status'))return;
  {const l=$('route-loot');if(l){const t=shown&&routeResult.lootSummary||'';l.textContent=t;l.hidden=!t;}}
  const label=$('route-stop');
  $('route-prev').disabled=!shown||routeStep===0;$('route-next').disabled=!shown||routeStep>=routeResult.stops.length-1;
  if(!routeResult)return;
  if(!shown){const reason=routeResult.reason||'Route hidden.';setRouteStatus(reason,routeResult.status!=='ready');label.textContent=reason;label.title=reason;return;}
  const stop=routeResult.stops[routeStep],levels=[...new Set(current.layout.m.rooms.flatMap(r=>r.levels))].sort((a,b)=>b-a),end=stop.targets[0]?.kind==='end_room',deck=levels.indexOf(stop.level)+1;
  const kind=end?'End room':stop.targets.length>1?stop.targets.length+(routeResult.lootSummary?' containers':' modules'):({salvage_crate:'Crate',briefcase:'Briefcase',tall_locker:'Tall locker'})[stop.targets[0].kind]||'Footlocker';
  label.textContent=`${routeStep+1}/${routeResult.stops.length} · D${deck} · R${stop.room} · ${kind}`;
  label.title=`Stop ${routeStep+1} of ${routeResult.stops.length} · Deck ${deck} · Room ${stop.room} · ${end?'End room':stop.targets.length>1?stop.targets.length+(routeResult.lootSummary?' loot containers':' module containers'):({salvage_crate:'Salvage crate',briefcase:'Briefcase',tall_locker:'Tall locker'})[stop.targets[0].kind]||'Crew footlocker'}`;
  setRouteStatus(`${routeResult.exact?'Shortest mapped-grid route':'Suggested route (large target set)'} · ${routeResult.lootSummary||routeResult.modules+' module container'+(routeResult.modules===1?'':'s')} · ${routeResult.total.toFixed(1)} tiles · ${routeResult.ladderClimbs} ladder climb${routeResult.ladderClimbs===1?'':'s'}${routeResult.unreachable.length?' · '+routeResult.unreachable.length+' not routed':''}${routeResult.invalid.length?' · '+routeResult.invalid.length+' invalid locations':''}`,Boolean(routeResult.unreachable.length||routeResult.invalid.length));
}
async function calculateRoute(){
  if(!current?.layout||!viewerPanels.quick)return;
  const ticket=++routeTicket,selection=current;routeResult=null;paintRoute();setRouteStatus('Planning route…');$('route-stop').textContent='Planning…';$('route-stop').title='Planning route…';$('route-panel').setAttribute('aria-busy','true');
  const start=performance.now();
  try{
    const result=await routePlanner.plan(selection.layout.m,{moduleIds:ids(selection.row.frigate_module_ids),possibleIds:ids(selection.row.frigate_module_alt_ids),...quickSettings,loot:quickSettings.mode&&quickSettings.mode!=='modules'?quickLootOf(selection):null});
    if(ticket!==routeTicket||selection!==current||!viewerPanels.quick)return;
    routeResult=result;routeStep=0;paintRoute();record(`Quick Run: ${result.status}, ${result.modules||0} targets, ${Math.round(performance.now()-start)}ms`);
  }catch(error){if(ticket===routeTicket&&$('route-status')){setRouteStatus(error.message,true);$('route-stop').textContent='Route unavailable';$('route-stop').title=error.message;}}
  finally{if(ticket===routeTicket)$('route-panel')?.setAttribute('aria-busy','false');}
}
// SITE integration (user 2026-10-31): Quick Run loot targets from per-container loot (site-quickloot.js). Enabled only
// when this system has {cv,xv} and the arrays line up with its map's containers / extra containers.
function quickLootOf(sel=current){const l=globalThis.dvQuickLoot?.get(sel?.row.address),m=sel?.layout?.m;
  return l&&m&&Array.isArray(l.cv?.[0])&&l.cv[0].length===m.containers.length&&(!l.xv||(Array.isArray(m.extras)&&l.xv[0]?.length===m.extras.length))?l:null;}
function syncRouteTargets(){const s=$('route-target');if(!s)return;const ok=Boolean(quickLootOf());
  for(const o of s.querySelectorAll('option[value="value"],option[value="nanites"]')){o.disabled=!ok;o.textContent=(o.value==='value'?'Most valuable loot':'Most nanites (after refining)')+(ok?'':' · Loot values: top-100 systems only for now');}
  if(!ok&&quickSettings.mode&&quickSettings.mode!=='modules')quickSettings.mode='modules';
  s.value=quickSettings.mode||'modules';const p=$('route-possible');if(p)p.disabled=s.value!=='modules';}
function quickRunMarkup(){return `<div id="route-panel" class="viewer-control-panel quick-run-panel" hidden aria-busy="false"><div class="route-options"><label><span class="sr-only">Targets</span><select id="route-target" aria-label="Quick Run targets"><option value="modules">Predicted modules</option><option value="value" disabled>Most valuable loot · Loot values: top-100 systems only for now</option><option value="nanites" disabled title="Nanites per container after refining (direct + refiner).">Most nanites (after refining) · Loot values: top-100 systems only for now</option></select></label><label title="Include possible module containers"><input id="route-possible" aria-label="Include possible modules" type="checkbox"${quickSettings.includePossible?' checked':''}>Possible</label><label title="Finish the route at the end room"><input id="route-end" aria-label="Finish at end room" type="checkbox"${quickSettings.finishAtEnd?' checked':''}>End room</label></div><div class="route-progress"><button id="route-prev" type="button" aria-label="Previous route stop" title="Previous route stop" disabled>‹</button><span id="route-stop" title="Start at the entrance">Start at entrance</span><button id="route-next" type="button" aria-label="Next route stop" title="Next route stop" disabled>›</button><button id="route-info" type="button" class="icon-button" aria-label="Quick Run information" aria-haspopup="dialog" title="${esc(ROUTE_HELP)}">${icon('info')}</button></div><p id="route-loot" class="route-loot" hidden></p><p id="route-status" class="sr-only" role="status">Starts at the entrance. Module locations are predictions.</p></div>`;}
const layerDefinitions=[['walls','Walls','Walls'],['floors','Floors','Floor panels'],['fixtures','Fixtures','Fixtures & pillars'],['doors','Doors','Doors'],['ladders','Ladders','Ladder links'],['modules','Modules','Predicted module rings'],['crates','Crates','Salvage crates'],['footlockers','Footlockers','Crew footlockers'],['briefcases','Briefcases','Briefcases'],['tallLockers','Tall lockers','Tall lockers'],['hazards','Hazards','Enemies & turrets'],['barrel','Barrels','Barrels'],['labels','3D labels','3D room labels'],['entrance','Entrance','Entrance'],['hangarDetails','Hangar details','Hangar props at their recorded game positions'],['ship','Hangar ships','Recorded hangar ship geometry']];
function viewerControlsMarkup(hasLayout){
  const spread=read('spread',1.6);
  return `<section class="viewer-controls" aria-label="Viewer display controls"><div class="viewer-control-row"><button id="viewer-done" type="button" aria-pressed="false">Finished Run</button><button id="viewer-toggle-reward" type="button" aria-pressed="${showReward}" aria-controls="view-summary">${showReward?'Hide End Reward':'Show End Reward'}</button>${hasLayout?`<button id="toggle-layers" type="button" aria-expanded="${viewerPanels.layers}" aria-controls="layer-fields">Layers</button><button id="toggle-spacing" type="button" aria-expanded="${viewerPanels.spacing}" aria-controls="spacing-panel">Deck spacing</button><button id="toggle-quick" type="button" aria-expanded="false" aria-pressed="false" aria-controls="route-panel">Quick Run</button>`:''}</div>${hasLayout?`<div id="spacing-panel" class="viewer-control-panel"${viewerPanels.spacing?'':' hidden'}><label class="spacing-control" for="spacing"><span>Deck spacing</span><input id="spacing" type="range" min="1" max="4" step=".1" value="${spread}"><output id="spacing-value" for="spacing">${Number(spread).toFixed(1)}×</output></label></div><fieldset id="layer-fields" class="inline-layers viewer-control-panel"${viewerPanels.layers?'':' hidden'}><legend>Layers</legend><div>${layerDefinitions.map(([key,label,title])=>`<label class="layer-chip" title="${title}"><input type="checkbox" data-layer="${key}"${layers[key]?' checked':''}><span>${label}</span></label>`).join('')}</div></fieldset>${quickRunMarkup()}`:''}</section>`;
}
function bindViewerControls(){
  $('route-info')?.addEventListener('click',()=>showDetails('Quick Run information',`<p>${esc($('route-status').textContent)}</p><p>${esc($('route-stop').title)}</p><p>${esc(ROUTE_HELP)}</p>`));
  syncDoneButtons();$('viewer-done').onclick=()=>toggleDone(current.row.address);
  $('viewer-toggle-reward').onclick=()=>setRewardVisibility(!showReward);
  $('toggle-quick')?.addEventListener('click',()=>{
    viewerPanels.quick=!viewerPanels.quick;$('route-panel').hidden=!viewerPanels.quick;$('toggle-quick').setAttribute('aria-expanded',String(viewerPanels.quick));$('toggle-quick').setAttribute('aria-pressed',String(viewerPanels.quick));
    if(viewerPanels.quick){if(routeResult)paintRoute();else calculateRoute();}else{routeTicket++;$('route-panel').setAttribute('aria-busy','false');paintRoute();}
  });
  for(const [id,key] of [['route-possible','includePossible'],['route-end','finishAtEnd']])$(id)?.addEventListener('change',e=>{quickSettings[key]=e.target.checked;calculateRoute();});
  $('route-target')?.addEventListener('change',e=>{quickSettings.mode=e.target.value;syncRouteTargets();routeResult=null;calculateRoute();});syncRouteTargets();
  if(current?.layout&&globalThis.dvQuickLoot&&!globalThis.dvQuickLoot.loaded())globalThis.dvQuickLoot.load().then(()=>syncRouteTargets());
  for(const [id,delta] of [['route-prev',-1],['route-next',1]])$(id)?.addEventListener('click',()=>{routeStep=Math.max(0,Math.min(routeResult.stops.length-1,routeStep+delta));paintRoute();});
  for(const [key,panel] of [['layers','layer-fields'],['spacing','spacing-panel']]){
    const button=$('toggle-'+key);if(!button)continue;
    button.onclick=()=>{viewerPanels[key]=!viewerPanels[key];$(panel).hidden=!viewerPanels[key];button.setAttribute('aria-expanded',String(viewerPanels[key]));};
  }
  $('spacing')?.addEventListener('input',e=>{const value=Number(e.target.value);save('spread',value);$('spacing-value').textContent=value.toFixed(1)+'×';view3d?.setOptions({spread:value});});
  $('layer-fields')?.addEventListener('change',e=>{const key=e.target.dataset.layer;if(!key)return;layers[key]=e.target.checked;save('layers',layers);map?.refresh();view3d?.setOptions({layers:engineLayers()});});
}
function setMapStatus(text){
  if($('map-status'))$('map-status').textContent=text;
  if($('map-info'))$('map-info').title=`${current.layout.m.links.length} ladder connection${current.layout.m.links.length===1?'':'s'} · ${text}`;
}
function renderViewer(){
  routeTicket++;routePlanner.dispose();routeResult=null;routeStep=0;viewerPanels.quick=false;
  const {row,layout}=current,r=summaryData(),identityData=systemIdentity(row);
  const name=derelictName(row,layout?.d);
  const identity=`<div class="identity-strip"><div class="glyph-address"><div id="derelict-heading" class="derelict-heading"${name?'':' hidden'}><span>DERELICT FREIGHTER</span><h2 id="derelict-name" data-field="derelict_name" title="${esc(name)}">${esc(name)}</h2></div><div class="eyebrow" id="system-identity" title="${esc(identityData.label)}"><span id="system-name" data-field="system_name">${esc(identityData.name)}</span><button id="system-name-info" type="button" title="${esc(SYSTEM_NAME_HELP)}" aria-label="About the original procedural name" aria-haspopup="dialog">${icon('info')}</button> - <span id="system-galaxy">${esc(identityData.galaxy)}</span><span class="hex">· ${esc(glyphsOf(row.address))}</span></div>${glyphs(row.address)}<div id="viewer-map-lists" class="viewer-map-lists">${mapChips(row.map)}</div></div><button id="viewer-copy" class="copy-button" aria-haspopup="dialog" aria-controls="share-dialog">${icon('copy')}Copy</button></div><div class="view-summary" id="view-summary">${summaryMarkup(r)}</div>`;
  const tools=`<div class="map-tools" id="map-tools"><button id="map-fit">⊡ Fit all</button><button id="map-minus" aria-label="Zoom floor maps out">−</button><button id="map-plus" aria-label="Zoom floor maps in">+</button><span class="map-hint">All decks · two-finger pan / pinch / twist</span></div>`;
  $('viewer-content').innerHTML=identity+'<div id="system-extras" class="loot-panel" hidden></div>'+viewerControlsMarkup(Boolean(layout))+(layout?`<p class="touch-map-hint">One finger scrolls · two fingers pan / pinch / twist · Tilt for above/below</p><div class="visuals"><section class="visual-panel"><div class="visual-heading"><h3>3D VIEW · ALL ${r.floors} DECKS</h3><div><button id="reset-view" class="icon-button" aria-label="Reset 3D view" title="Reset 3D view">${icon('reset')}</button><button id="tilt-view" class="touch-mode-btn" aria-pressed="false" title="Enable two-finger tilt and orbit; turn off to pan" disabled>Tilt</button><button id="walk-view" class="walk-btn" disabled>Walk</button><button id="expand-3d" class="icon-button" aria-label="Expand 3D view">${icon('expand')}</button></div></div><div id="scene-host" class="viewport3d"></div></section><section class="visual-panel"><div class="visual-heading"><h3>2D FLOOR MAP · ALL DECKS</h3><div>${tools}<button id="map-info" class="icon-button" aria-label="Map information" aria-haspopup="dialog" aria-describedby="map-status" title="${layout.m.links.length} ladder connection${layout.m.links.length===1?'':'s'}">${icon('info')}</button><button id="expand-map" class="icon-button" aria-label="Expand all floor maps">${icon('expand')}</button></div></div><span id="map-status" class="sr-only" role="status">All decks visible.</span><div id="map-host" class="map-viewport"></div></section></div><div class="viewer-actions"><button id="details-open">ⓘ System details</button><button id="share-open">Photo &amp; Share ↗</button></div>`:`<div class="notice"><h2>${current.scanned?'Scanned on this device':current.slim?'Module count only':current.deferred?'Not yet scanned':'System summary'}</h2><p>${current.scanned?'Computed in your browser by the atlas scanner. The 3D and 2D maps are kept only for the top-100 lists.':current.slim?esc(slimText(current.slim)):current.deferred?'This system is not scanned yet. It can be scanned on demand.':'This system has no published full layout. Its known counts are shown above.'}</p>${dataState.local?'<button id="generate-local" class="primary">Generate locally</button>':''}<p><button id="find-map" class="inline-link">Browse systems with maps →</button></p></div><div class="viewer-actions"><button id="details-open">ⓘ System details</button><button id="share-open">Photo &amp; Share ↗</button></div>`);
  $('viewer-copy').onclick=()=>sharing.open('copy');
  syncDeveloperSelection();syncExtras();
  bindViewerControls();
  $('details-open').onclick=showSystemDetails;
  $('share-open').onclick=()=>sharing.open();
  if(!layout){$('find-map').onclick=()=>{filters.hasMap=true;renderSystems(true);setTab('systems');};$('generate-local')?.addEventListener('click',async e=>{e.target.disabled=true;try{const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:row.address,glyphs:false,galaxy:row.galaxy})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Generation failed');await openViewer(data.address);}catch(error){toast(error.message);e.target.disabled=false;}});return;}
  const m=layout.m;
  $('map-info').onclick=()=>showDetails('Map information',`<p><b>${m.links.length} ladder connection${m.links.length===1?'':'s'}</b> across ${r.floors} decks.</p><p>${esc($('map-status').textContent)}</p><p>Layout source: ${esc(layout.source)}.</p><p>Select a ladder marker to follow its connection between decks.</p><p>Hangar ships are fixed ship hulls at their recorded game position and rotation; they block walking.</p>`);
  setMapStatus($('map-status').textContent);
  map=createMap($('map-host'),m,{framing,moduleIds:ids(row.frigate_module_ids),possibleIds:ids(row.frigate_module_alt_ids),layers,onSelect:id=>{setMapStatus(`Room ${id} · ${m.byIndex.get(id)?.template_name||''}`);},onLink:l=>{const levels=[...new Set(m.rooms.flatMap(r=>r.levels))].sort((a,b)=>b-a);setMapStatus(`Ladder ${String.fromCharCode(65+l.id)} · Deck ${levels.indexOf(l.upper)+1} ↔ Deck ${levels.indexOf(l.lower)+1} · room ${l.room}`);}});
  map.setExpanded(matchMedia('(min-width:701px)').matches);
  $('map-fit').onclick=()=>map.fit();$('map-minus').onclick=()=>map.zoom(1/1.3);$('map-plus').onclick=()=>map.zoom(1.3);
  $('expand-map').onclick=()=>expand('map');$('expand-3d').onclick=()=>expand('3d');

  mountThree(current,loadId);
}
async function mountThree(selection,ticket){
  try{
    threeModule ||= await import('./view3d.js');if(ticket!==loadId)return;
    const {m,d}=selection.layout;
    m.rooms.forEach(r=>r.info={fam:family(r.template_name),label:family(r.template_name),color:COLORS[family(r.template_name)]});
    const moduleIds=ids(selection.row.frigate_module_ids),possibleIds=ids(selection.row.frigate_module_alt_ids);
    const mapped={ships:(m.ships||[]).map(s=>({...s,room:s.room_index})),details:(m.details||[]).map(s=>({...s,room:s.room_index})),rooms:m.rooms,links:m.links,entrance:m.e,doors:m.doors,fixtures:m.fixtures||[],walls:m.walls||undefined,
      instances:(d.instances||[]).map(i=>({scene:i.scene_resource.toUpperCase(),axes:i.source_axes,t:i.translation,room:i.room_index,level:Math.round(i.translation[1]/8)+m.e[1]})),
      containers:m.containers.map((c,id)=>({id,kind:c.container_kind,module:moduleIds.has(id),modulePossible:possibleIds.has(id),u:c.g.u,v:c.g.v,level:c.g.level,room:c.room_index,h:Math.max(0,c.layout_local_xyz[1]/8+m.e[1]-c.g.level),rot:c.orientation||null})),
      extras:(m.extras||[]).map(c=>({kind:c.container_kind,u:c.g.u,v:c.g.v,level:c.g.level,room:c.room_index,h:Math.max(0,c.layout_local_xyz[1]/8+m.e[1]-c.g.level),rot:c.orientation||null})),
      hazards:(m.hazards||[]).map(c=>({code:c.code,kind:c.kind,group:c.group,mount:c.mount,room:c.room_index,u:c.g.u,v:c.g.v,level:c.g.level,h:Math.max(0,c.xyz[1]/8+m.e[1]-c.g.level)}))};
    view3d=threeModule.mount($('scene-host'),mapped,{twoFingerTouch:true,onHover:(hit)=>{let el=$('scene-tooltip');if(!hit){el?.remove();return;}const room=hit.marker?.room??hit.room;const r=m.byIndex.get(room);if(!r)return;if(!el){el=document.createElement('div');el.id='scene-tooltip';el.className='room-tooltip';$('scene-host').append(el);}el.textContent=`Room ${room} · ${r.crates} crates · ${r.lockers} footlockers`;},onFirstPerson:on=>{if($('walk-view'))$('walk-view').textContent=on?'Leave':'Walk';if($('tilt-view'))$('tilt-view').disabled=on;}});
    view3d.setOptions({framing,lookSensitivity,materialStyle:'metal',spread:read('spread',1.6),layers:engineLayers()});
    $('reset-view').onclick=()=>view3d.resetView();$('walk-view').disabled=false;$('walk-view').onclick=()=>view3d.firstPerson().active?view3d.exitFirstPerson():view3d.enterFirstPerson();
    record(`3D mounted: ${m.rooms.length} rooms, ${m.links.length} ladders`);
  }catch(error){
    record('WebGL unavailable; using SVG isometric renderer: '+error.message);
    if(ticket===loadId){
      view3d=mountIsometric($('scene-host'),selection.layout.m,{framing,moduleIds:ids(selection.row.frigate_module_ids),possibleIds:ids(selection.row.frigate_module_alt_ids),layers,spread:read('spread',1.6),onSelect:id=>{setMapStatus('Room '+id);}});
      $('reset-view').onclick=()=>view3d.resetView();$('walk-view').title='First-person walking requires WebGL on this device';
    }
  }
  if(ticket===loadId&&view3d){
    paintRoute();
    const button=$('tilt-view');button.disabled=false;
    button.onclick=()=>{const active=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(active));view3d.setOptions({touchMode:active?'orbit':'pan'});view3d.showTouchHint?.(2200);};
  }
}
function engineLayers(){const result={...layers,frigateModules:layers.modules};for(const k of ['turret','floater','fastFloater','drone','bugSpawner','hangSac','pillarSac','egg'])result[k]=layers.hazards;return result;}

function expand(kind){
  if(!current?.layout)return;
  const host=$(kind==='map'?'map-host':'scene-host'),parent=host.parentNode,tools=kind==='map'?$('map-tools'):null,toolsParent=tools?.parentNode;
  const hostAnchor=document.createComment('map expansion anchor');parent.insertBefore(hostAnchor,host);
  const toolsAnchor=tools?document.createComment('map toolbar anchor'):null;if(tools)toolsParent.insertBefore(toolsAnchor,tools);
  $('expand-title').textContent=kind==='map'?'ALL DECKS · 2D MAP':'3D VIEW · ALL DECKS';
  $('expanded-summary').textContent=`${glyphsOf(current.row.address)} · Total ${totalOf(summaryData(),filters.groups).text} · ${known(current.row.frigate_modules)} modules (predicted)`;
  $('expanded-host').append(host);if(tools)$('expanded-tools').append(tools);
  expandedRestore=()=>{parent.insertBefore(host,hostAnchor);hostAnchor.remove();if(tools){toolsParent.insertBefore(tools,toolsAnchor);toolsAnchor.remove();}map?.setExpanded(matchMedia('(min-width:701px)').matches);window.dispatchEvent(new Event('resize'));};
  $('expand-dialog').showModal();if(kind==='map')map.setExpanded(true);window.dispatchEvent(new Event('resize'));
}
$('expand-dialog').addEventListener('close',()=>{expandedRestore?.();expandedRestore=null;});
function showDetails(title,body){$('details-title').textContent=title;$('details-body').innerHTML=body;openDialog('details-dialog');}
function showSystemDetails(){
  const r=summaryData(),m=current.layout?.m;
  const stats=[['Salvage crates',r.salvage_crates],['Footlockers',r.footlockers],['Briefcases',r.briefcases],['Tall lockers',r.tall_lockers],['Rooms',r.rooms],['Decks',r.floors]];
  showDetails('System details',`<p class="derelict-detail-name"><b>Derelict freighter:</b> ${esc(derelictName(current.row,current.layout?.d)||'Name not recorded in this scan')}</p><p class="hex">${esc(r.address)} · ${esc(r.preset||'No preset supplied')}</p><div class="detail-stats">${stats.map(([k,v])=>`<div><b>${known(v)}</b><span>${k}</span></div>`).join('')}</div><p>Predicted end reward: <b>${esc(r.reward_name||'Not computed')} ${esc(r.reward_class||'')}${r.reward_ambiguous?' · ambiguous':''}</b>. This applies to the system’s own derelict; beacon-summoned derelicts can differ.</p><p>Module counts are predictions. “?” marks uncertainty, a dash means not computed, and “+” marks a lower-bound total.</p>${m?`<div class="table-scroll"><table><thead><tr><th>Room</th><th>Type</th><th>Crates</th><th>Footlockers</th><th>Decks</th></tr></thead><tbody>${m.rooms.map(room=>`<tr><td>${room.room_index}</td><td>${esc(room.template_name)}</td><td>${room.crates}</td><td>${room.lockers}</td><td>${room.levels.map(y=>[...new Set(m.rooms.flatMap(r=>r.levels))].sort((a,b)=>b-a).indexOf(y)+1).join(', ')}</td></tr>`).join('')}</tbody></table></div>`:''}<div class="sheet-actions"><button id="mark-done">Finished Run</button></div>`);
  syncDoneButtons();$('mark-done').onclick=()=>toggleDone(r.address);
}
function download(content,name,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportCurrentLayout(){
  if(!current?.layout)return;
  const {d,pieceIndex}=current.layout;
  download(JSON.stringify({...d,...(pieceIndex?{viewer_meta:{v:1,piece_index:pieceIndex}}:{})},null,2),`${current.row.address}-derelict.json`,'application/json');
}
function syncDeveloperSelection(){
  const link=$('dev-original'),button=$('dev-export-layout');
  if(link)link.href='legacy.html'+(current?'#/d/'+current.row.address:'');
  if(button)button.disabled=!current?.layout;
}
function syncExtras(){
  const target=$('system-extras');if(!target||!current)return;
  const open=$('loot-drawer')?.open||false;
  target.innerHTML=extrasAvailable?(lootPanelHtml(current.row.extras)||globalThis.dvLootButton?.(current.row)||''):'';target.hidden=!target.innerHTML;
  const drawer=$('loot-drawer');if(drawer){drawer.open=open;target.querySelector('[data-loot-toggle]')?.setAttribute('aria-expanded',String(open));drawer.addEventListener('toggle',()=>target.querySelector('[data-loot-toggle]')?.setAttribute('aria-expanded',String(drawer.open)));}
}
async function loadFeatureUI(refresh=false){
  const ticket=++featureTicket,source=rows;if(refresh)resetAtlasFeatures();
  const [s,lists,extras]=await Promise.all([atlasStats(),atlasMapLists(),atlasExtras()]);if(ticket!==featureTicket||source!==rows)return;
  stats=s;extrasAvailable=Boolean(extras);mapRows(source,lists,await import('./data.js').then(m=>m.bundle()));
  for(let i=0;i<source.length;i++){applyExtras(source[i],extras?.get(source[i].address));if(i%4096===4095)await new Promise(r=>setTimeout(r,0));if(ticket!==featureTicket||source!==rows)return;}
  for(const [value,label] of [['items_value','Loot value (Units / credits) ↓'],['items_nanites','Nanites ↓'],['spookbox','SpookBox (7.10+) ↓']]){
    let option=$('sort').querySelector(`option[value="${value}"]`);if(extrasAvailable&&!option){option=document.createElement('option');option.value=value;option.textContent=label;$('sort').append(option);}if(option)option.hidden=!extrasAvailable;
  }
  if(!extrasAvailable&&['items_value','items_nanites','spookbox'].includes(filters.sort)){filters.sort='modules';$('sort').value='modules';}
  $('atlas-stats-body').innerHTML=atlasStatsHtml(stats);$('atlas-stats').hidden=!$('atlas-stats-body').innerHTML;
  computedRows=null;await renderSystems();if(current){const r=rows.find(r=>r.address===current.row.address);if(r)current.row=keepDeviceLoot(r);updateSummary();}
  if($('filter-dialog').open)buildFilterFields();
}
async function updateAtlas(){
  const selected=current?.row.address,signature=selected?layoutSignature(selected):null;
  const next=await refreshData();
  record(`Atlas check: ${next.length} systems`);
  updateRefreshInfo();
  if(next===rows){await loadFeatureUI(true);return;}
  const host=$('results'),anchor=shown[Math.floor(host.scrollTop/ROW_HEIGHT)]?.address,offset=host.scrollTop%ROW_HEIGHT;
  rows=next;
  // Keep the current range, filters and scroll anchor; never navigate on a background check.
  const applied=await renderSystems();
  const index=applied&&anchor?shown.findIndex(r=>r.address===anchor):-1;
  if(index>=0){listLimit=Math.min(shown.length,Math.max(listLimit,Math.ceil((index+1)/100)*100));host.scrollTop=index*ROW_HEIGHT+offset;renderRows();}
  if(current){
    const row=rows.find(r=>r.address===current.row.address);
    if(row){
      if((selected===row.address&&signature!==layoutSignature(row.address))||row.frigate_module_ids!==current.row.frigate_module_ids||row.frigate_module_alt_ids!==current.row.frigate_module_alt_ids)await openViewer(row.address);
      else{current.row=keepDeviceLoot(row);updateSummary();}
    }
  }
  await loadFeatureUI(true);
}
let atlasReady=false;
const autoRefresh=createAutoRefresh(updateAtlas,{onError:error=>record('Atlas refresh unavailable; kept current data: '+error.message)});
window.addEventListener('pageshow',e=>{if(e.persisted&&atlasReady)autoRefresh.check(true);});
// Merely returning focus to an open tab is not a new visit.
let glyphFill=Math.min(100,Math.max(40,Number(read('glyphFill',100))||100));
document.documentElement.style.setProperty('--glyph-fill',glyphFill/100);
function showDiagnostics(){
  const panel=$('dev-panel');panel.hidden=false;document.body.classList.add('dev-open');
  panel.innerHTML=`<div class="dev-heading"><h2>Developer mode <small>v${VERSION}</small></h2><button id="close-dev" aria-label="Close developer mode">×</button><div class="dev-layout-tools"><a id="dev-original" href="legacy.html" target="_blank" rel="noopener">Open original viewer ↗</a><button id="dev-export-layout" type="button" disabled>Export layout JSON</button></div></div><div class="dev-controls"><label for="glyph-scale">Viewer glyph size <output id="glyph-scale-value">${glyphFill}%</output></label><input id="glyph-scale" type="range" min="40" max="100" step="1" value="${glyphFill}"><p>100% fills the row width. Size keeps the same rows.</p><label for="look-sensitivity">Walking look speed <output id="look-sensitivity-value">${lookSensitivity.toFixed(1)}×</output></label><input id="look-sensitivity" type="range" min=".3" max="1.5" step=".1" value="${lookSensitivity}"><label class="background-label" for="dev-background">Background · next theme on refresh</label><select id="dev-background">${BACKGROUNDS.map(option=>`<option value="${option.id}"${background===option.id?' selected':''}>${option.name}</option>`).join('')}</select></div><div class="dev-status"><p>${rows.length.toLocaleString()} systems · ${esc(dataState.source)} · Decoder ${current?.layout?'ready':'waiting'}</p><p id="list-performance">List: ${systemList.stats.created} cards created · last update ${systemList.stats.lastMs.toFixed(2)} ms · ${systemList.stats.skipped} unchanged frames skipped.</p><p>Responsiveness: ${responsiveness.longTasks} long tasks · longest ${responsiveness.longestMs} ms.</p><p>Local generator: ${dataState.local?'reachable':'not connected'}. Geometry and ladder links use the original decoder.</p><button id="preview-touch-hint">Preview two-finger hint</button> <button id="export-csv">Export filtered CSV</button> <button id="export-diagnostics">Export diagnostics</button> <a href="reward-preview.html" target="_blank" rel="noopener">Reward icons ↗</a></div>`;
  syncDeveloperSelection();$('dev-export-layout').onclick=exportCurrentLayout;
  $('close-dev').onclick=()=>{panel.hidden=true;document.body.classList.remove('dev-open');};

  $('dev-background').onchange=e=>{setBackground(e.target.value);save('background',background);record('Background: '+backgroundOption(background).name);};
  $('look-sensitivity').oninput=e=>{lookSensitivity=Number(e.target.value);save('lookSensitivity',lookSensitivity);$('look-sensitivity-value').textContent=lookSensitivity.toFixed(1)+'×';view3d?.setOptions({lookSensitivity});};
  $('glyph-scale').oninput=e=>{glyphFill=Number(e.target.value);save('glyphFill',glyphFill);document.documentElement.style.setProperty('--glyph-fill',glyphFill/100);$('glyph-scale-value').textContent=glyphFill+'%';};
  $('export-csv').onclick=()=>{const keys=['address','glyphs','rooms','floors','salvage_crates','footlockers','frigate_modules','frigate_modules_ambiguous'];download([keys.join(','),...shown.map(r=>keys.map(k=>r[k]??'').join(','))].join('\n'),'derelict-systems.csv','text/csv');};
  $('preview-touch-hint').onclick=()=>{map?.showTouchHint(5000);view3d?.showTouchHint?.(5000);};
  $('export-diagnostics').onclick=()=>download(JSON.stringify({version:VERSION,source:dataState,current:current?.row.address,glyphScale:read('glyphScale',2),glyphFill,framing,lookSensitivity,background,listPerformance:systemList.stats,responsiveness,events:log},null,2),'derelict-diagnostics.json','application/json');
}
$('diagnostics').onclick=()=>{$('info-dialog').close();showDiagnostics();};
function updateRefreshInfo(){
  $('refresh-info').textContent='Updates on each visit and manual refresh.'+(dataState.at?' Last successful check: '+new Date(dataState.at).toLocaleTimeString()+'.':'');
  $('source-status').textContent=`${dataState.source} · ${rows.length.toLocaleString()} systems`;
}
$('refresh-atlas').onclick=async()=>{
  $('refresh-atlas').disabled=true;
  try{const ok=await autoRefresh.check(true);updateRefreshInfo();toast(ok?'Atlas checked · '+rows.length.toLocaleString()+' systems':'Could not refresh the atlas. Kept the current data.');}
  finally{$('refresh-atlas').disabled=!atlasReady||atlasProgress.busy;}
};
$('info-button').onclick=()=>{
  $('source-status').textContent=`${dataState.source} · ${rows.length.toLocaleString()} systems`;
  updateRefreshInfo();
  $('info-version').textContent='v'+VERSION;
  openDialog('info-dialog');
};
async function route(){const match=location.hash.match(/^#\/d\/([a-fA-F0-9]{16})$/);if(match){setTab('viewer');await openViewer(match[1].toUpperCase());}else setTab('systems');}
window.addEventListener('hashchange',route);
let lastMobile=matchMedia('(max-width:700px)').matches;window.addEventListener('resize',()=>{const mobile=matchMedia('(max-width:700px)').matches;if(mobile!==lastMobile){lastMobile=mobile;renderSystems(true);if(!$('expand-dialog').open)map?.setExpanded(!mobile);}});
new ResizeObserver(scheduleList).observe($('results'));
window.addEventListener('error',e=>record('Error: '+e.message));window.addEventListener('unhandledrejection',e=>record('Promise: '+(e.reason?.message||e.reason)));
// SITE integration (fast first page): open the linked system, else the saved one, else the first mapped one
async function openFirst(){
  const match=location.hash.match(/^#\/d\/([a-fA-F0-9]{16})$/);if(match){await route();return true;}
  const saved=read('selected',null);if(firstMode&&saved&&!rows.some(r=>r.address===saved))return false;
  const first=rows.find(r=>r.address===saved&&r.map)||(await filterSortAtlas(rows,{...defaults,hasMap:true}))[0];if(first)await openViewer(first.address);setTab('systems');return true;
}
async function start(){
  try{
    // SITE integration (user 2026-11-01): the first page (index/first.csv) shows at once; the full index loads behind it
    let arrived=false,opened=false,firstShown=Promise.resolve(),swapped=Promise.resolve();
    const swap=async all=>{await firstShown;rows=all;firstMode=false;record(`Atlas loaded: ${rows.length} systems`);computedRows=null;showAtlasProgress();await renderSystems();
      if(opened&&current){const r=rows.find(r=>r.address===current.row.address);if(r){current.row=keepDeviceLoot(r);updateSummary();}}
      if(!opened)opened=await openFirst();};
    const full=initData({onStatus:showAtlasProgress,onRows:all=>{arrived=true;swapped=swap(all);}});
    const fp=await firstRows().catch(()=>null);
    if(fp&&!arrived){rows=fp.rows;firstMode=true;record(`First page: ${rows.length} systems`);showAtlasProgress();
      firstShown=(async()=>{await renderSystems();opened=await openFirst();})();
      fp.floors.then(()=>{if(firstMode){computedRows=null;renderSystems();}},()=>{});}
    rows=await full;await swapped;if(new URLSearchParams(location.search).get('dev')==='1')showDiagnostics();atlasReady=true;$('refresh-atlas').disabled=false;loadFeatureUI().catch(error=>record('Optional atlas data: '+error.message));autoRefresh.start({immediate:dataState.source!=='Live GitHub atlas'});}
  catch(error){record(error.message);$('results').innerHTML=`<div class="notice"><h2>Atlas unavailable</h2><p>${esc(error.message)}</p><button id="retry-data">Try again</button></div>`;$('retry-data').onclick=start;}
}
start();
