import {hasBit,mapListBit} from './atlas-features.js';
import {matchesReward} from './reward-types.js';
export const VERSION = '1.0.41';
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const known = n => n == null ? '—' : n;
export const glyphsOf = address => '0' + address.slice(3,6) + address.slice(8);
export function addressOf(input, galaxy = 0) {
  const v = input.toUpperCase().replace(/[\s-]/g, '');
  if (/^[A-F0-9]{16}$/.test(v)) return v;
  if (/^[A-F0-9]{12}$/.test(v)) return '000' + v.slice(1,4) + Number(galaxy).toString(16).padStart(2,'0').toUpperCase() + v.slice(4);
  throw new Error('Enter 12 hex glyphs or a 16-digit address.');
}
export function totalSortIncludes(groups={frigate:true}){
  if(groups.frigate&&groups.briefcases&&groups.tall)return 'all containers';
  if(groups.frigate)return 'crates + footlockers'+(groups.briefcases?' + cases':groups.tall?' + tall':'');
  return [groups.briefcases?'briefcases':'',groups.tall?'tall lockers':''].filter(Boolean).join(' + ')||'none';
}
export function totalOf(r, groups = {frigate:true}) {
  let n=0, missing=false, knownCount=0;
  for (const k of [...(groups.frigate ? ['salvage_crates','footlockers'] : []), ...(groups.briefcases ? ['briefcases'] : []), ...(groups.tall ? ['tall_lockers'] : [])]) {
    if (r[k] == null) missing=true; else {n+=r[k];knownCount++;}
  }
  return {n, missing, text: !knownCount && missing ? '—' : n + (missing ? '+' : '')};
}
export function parseCsv(text) {
  const lines=text.split(/\r?\n/).filter(x=>x && !x.startsWith('#'));
  if(!lines.length)return [];
  const keys=lines.shift().split(',');
  return lines.map(line=>parseCsvRow(keys,line));
}
// Fast unquoted atlas rows keep split(); quoted names may contain commas or escaped quotes.
export function csvValues(line){
  if(!line.includes('"'))return line.split(',');
  const values=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){values.push(value);value='';}else value+=c;}
  values.push(value);return values;
}
// SITE integration (fast first page): the column positions are worked out once per header, not once per row
let rowKeys=null,rowPos=null,rowHasMap=false;
export function parseCsvRow(keys,line){
    if(keys!==rowKeys){rowKeys=keys;rowPos=Object.create(null);keys.forEach((k,i)=>{rowPos[k]=i;});rowHasMap=keys.includes('map');}
    const cells=csvValues(line),pos=rowPos,v=k=>{const i=pos[k];return i===undefined?undefined:cells[i];};
    const num=k=>{const x=v(k);return x==null || x==='' ? null : Number(x);};
    const g=v('glyphs').toUpperCase();
    const gal=num('galaxy') ?? 0;
    const map=Number(v('map'));
    return {address:addressOf(g,gal), glyphs:g, galaxy:gal, region:g.slice(4), preset:v('preset'),
      system_name:v('system_name')||v('systemName')||v('name')||'',derelict_name:v('derelict_name')||v('derelictName')||v('freighter_name')||v('freighterName')||'',
      rooms:num('rooms'), floors:num('floors'), stair_pieces:num('stairs'), hangar_pieces:num('hangars'), map:Number.isSafeInteger(map)&&map>=0?map:0,map_column_present:rowHasMap,
      salvage_crates:num('crates'), footlockers:num('footlockers'), briefcases:num('briefcases'), tall_lockers:num('tall_lockers'),
      reward_name:v('reward_name'), reward_class:v('reward_class'), reward_ambiguous:v('reward_ambiguous')==='1', reward_alt:v('reward_alt'),
      frigate_modules:num('frigate_modules'), frigate_modules_ambiguous:v('frigate_modules_ambiguous')==='1',
      frigate_module_ids:v('frigate_module_ids') || '', frigate_module_alt_ids:v('frigate_module_alt_ids') || ''};
}
export function systemQuery(f) {
  const totals=new WeakMap(),total=r=>{let n=totals.get(r);if(n===undefined){n=totalOf(r,f.groups).n;totals.set(r,n);}return n;};
  const normalize=value=>String(value||'').normalize('NFKC').toUpperCase().replace(/\s/g,'');
  const q=normalize(f.q);
  const rank={C:1,B:2,A:3,S:4};
  const byAddress=(a,b)=>a.address<b.address?-1:a.address>b.address?1:0;
  const num=(k,v)=>f[k]==='' || f[k]==null || (v!=null && v>=Number(f[k]));
  const matches=r=>{
    if (f.galaxy!=null && f.galaxy!=='' && r.galaxy!==Number(f.galaxy)) return false;
    if (q && ![r.address,r.glyphs,r.preset,r.system_name,r.systemName,r.name,r.derelict_name,r.freighter_name,r.reward_name,r.reward_class].some(x=>normalize(x).includes(q))) return false;
    if (r.slim||r.pruned||r.deferred) return false;
    if (f.hasMap && !r.map) return false;
    if (mapListBit(f.mapList)&&!hasBit(r.map,mapListBit(f.mapList)))return false;
    if (f.region && r.region!==f.region || f.preset && r.preset!==f.preset) return false;
    if (!matchesReward(r,f.rewardModule,f.reward)) return false;
    if (f.maxRooms && (r.rooms==null || r.rooms>Number(f.maxRooms)) || f.maxFloors && (r.floors==null || r.floors>Number(f.maxFloors))) return false;
    if (f.noStairs && r.stair_pieces || f.noHangar && r.hangar_pieces) return false;
    return num('minTotal',total(r)) && num('minModules',r.frigate_modules) && num('minCrates',r.salvage_crates) && num('minBriefcases',r.briefcases) && num('minTall',r.tall_lockers);
  };
  const field=['items_value','items_nanites','spookbox'].includes(f.sort)?f.sort:f.sort==='rooms'?'rooms':f.sort==='total'?'total':'frigate_modules';
  // SITE integration (user 2026-10-31): Best overall = modules (certain before "?"), then total, then loot value (units), then nanites (systems without values after those with), then fewer rooms, then fewer decks
  const overall=(a,b)=>{const ma=a.frigate_modules,mb=b.frigate_modules;
    if(ma==null||mb==null){if(ma!=null)return -1;if(mb!=null)return 1;}else if(mb!==ma)return mb-ma;
    return (a.frigate_modules_ambiguous?1:0)-(b.frigate_modules_ambiguous?1:0)||total(b)-total(a)||(b.items_value??-1)-(a.items_value??-1)||(b.items_nanites??-1)-(a.items_nanites??-1)||(a.rooms??1e9)-(b.rooms??1e9)||(a.floors??1e9)-(b.floors??1e9)||byAddress(a,b);};
  const compare=(a,b)=>{
    if(f.sort==='overall')return overall(a,b);
    let x=field==='total'?total(a):a[field], y=field==='total'?total(b):b[field];
    if (x==null || y==null) return x==null && y==null ? byAddress(a,b) : x==null ? 1 : -1;
    return (field==='rooms'?x-y:y-x) || (rank[b.reward_class]||0)-(rank[a.reward_class]||0) || total(b)-total(a) || byAddress(a,b);
  };
  return {matches,compare};
}
export function filterSort(rows,f){const {matches,compare}=systemQuery(f);return rows.filter(matches).sort(compare);}
export function family(t='') { return t==='R_END'?'end':t.includes('HANG')?'hangar':t.includes('CARG')?'cargo':t.includes('BARR')?'barracks':t.includes('MED')?'medical':'other'; }
export const COLORS={cargo:'#c89b50',barracks:'#7299d6',medical:'#6fa894',end:'#d978c6',hangar:'#cf8076',other:'#92a2b7'};
export const LINK_COLORS=['#44e7e0','#d09cfb','#62e6ad','#f5b66b','#8aaaff'];
// Prefer exact decoded cell levels over the older atlas floor estimate, while retaining it for diagnostics.
export function reconcileMapFloors(rows,bundle,model) {
  const byAddress=new Map(rows.map(r=>[r.address,r]));let corrected=0;
  for(const [address,packed] of Object.entries(bundle.s)){
    const row=byAddress.get(address);if(!row)continue;
    const {d}=model.unpack(packed,bundle.t);
    const count=new Set(d.rooms.flatMap(r=>model.roomCells(r.raw_u16_0x00_0x1F).map(c=>c.y))).size;
    row.atlas_floors=row.atlas_floors??row.floors;
    if(row.floors!==count)corrected++;
    row.floors=count;
  }
  return corrected;
}

// Progressive atlas browsing; each near-end scroll reveals at most one more batch.
export const SYSTEM_BATCH_SIZE=100;
export function nextSystemLimit(current,total,nearEnd=false){
  return Math.min(total,Math.max(SYSTEM_BATCH_SIZE,current+(nearEnd?SYSTEM_BATCH_SIZE:0)));
}
