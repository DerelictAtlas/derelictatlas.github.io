import {mapRows,configureAtlasFeatures} from './atlas-features.js';
import {parseAtlas,validateAtlas,yieldToBrowser} from './atlas-processing.js';
import {reconcileMapFloors} from './core.js';
import {atlasCache} from './atlas-cache.js';
// SITE integration: the published site (config.js staticSite) reads the atlas same-origin from GitHub Pages, like the
// previous site did (fresh after every push, no raw.githubusercontent cache lag); elsewhere the raw GitHub URL.
export const ATLAS=globalThis.DV_CONFIG?.staticSite&&globalThis.location?new URL('./',location.href).href:'https://raw.githubusercontent.com/DerelictAtlas/derelictatlas.github.io/main/';
configureAtlasFeatures(ATLAS);
export const dataState={local:false,source:'Loading atlas',at:null,errors:[],busy:true,phase:'Loading atlas…'};
let rowsCache,bundleCache,propsCache,indexKey,bundleKey,cache=atlasCache,notify=()=>{};
// SITE integration (fast first page): the map bundle is usable as soon as it is parsed, before the index is ready;
// the rows go to the page (onRows) before the fingerprints (only refreshData needs them) and the saved copy are made;
// initData itself still resolves after both, as before
let bundleOpen,onRows=()=>{},lastCommit=null;const bundleGate=new Promise(resolve=>bundleOpen=resolve);
function earlyBundle(maps){if(!bundleCache&&maps?.s&&maps.t){bundleCache=maps;bundleOpen(maps);}return maps;}
async function settle(){const next=lastCommit;try{onRows(rowsCache);}catch(_){}status('Finishing up…');if(next?.texts){const [i,b]=next.texts;const k=await Promise.all([fingerprint(i),fingerprint(b)]);if(rowsCache===next.rows){indexKey=k[0];bundleKey=k[1];}next.texts=null;}}
function status(phase,busy=true,count){dataState.busy=busy;dataState.phase=phase;notify({phase,busy,count});}
async function fingerprint(text){
  if(globalThis.crypto?.subtle)return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;if(i%262144===262143)await yieldToBrowser();}
  return `${text.length}:${a>>>0}:${b>>>0}`;
}
export function layoutSignature(address){return JSON.stringify(bundleCache?.s?.[address]);}
export async function gzipText(url){
  const response=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(`${url}: ${response.status}`);
  const b=new Uint8Array(await response.arrayBuffer());
  if(b[0]===31&&b[1]===139)return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return new TextDecoder().decode(b);
}
async function prepare(indexText,bundleText,keys,parsed){
  status('Preparing atlas…');await yieldToBrowser();
  const maps=parsed||JSON.parse(bundleText);earlyBundle(maps);
  const rows=await parseAtlas(indexText);
  mapRows(rows,null,maps);
  const corrected=await validateAtlas(rows,maps,window.DerelictModel);
  return {rows,maps,corrected,iKey:keys?.[0]??null,bKey:keys?.[1]??null,texts:keys?null:[indexText,bundleText]};
}
function commit(next,source){rowsCache=next.rows;bundleCache=next.maps;indexKey=next.iKey;bundleKey=next.bKey;dataState.correctedFloors=next.corrected;dataState.source=source;
  lastCommit=next;}
async function persist(indexText,bundleText){
  try{await cache.write({v:1,indexText,bundleText,count:rowsCache.length,at:dataState.at});}catch(error){dataState.errors.push('Atlas cache: '+error.message);}
}
export async function initData({snapshotCache=atlasCache,onStatus=()=>{},onRows:rowsReady=()=>{}}={}){
  cache=snapshotCache;notify=onStatus;onRows=rowsReady;status('Loading saved atlas…');
  // Hosted static visits do not need to wait for an unavailable local-generator endpoint.
  const localProbe=(globalThis.DV_CONFIG?.staticSite||globalThis.location?.hostname?.endsWith('.chatgpt.site'))?Promise.resolve():fetch('/api/regions',{signal:AbortSignal.timeout(2000)}).then(async r=>{if(r.ok)dataState.local=Array.isArray(await r.json());}).catch(()=>{});
  try{
    const saved=await cache.read().catch(error=>{dataState.errors.push('Atlas cache: '+error.message);return null;});
    if(saved?.v===1&&typeof saved.indexText==='string'&&typeof saved.bundleText==='string'){
      status('Loading saved atlas…',true,saved.count);
      try{commit(await prepare(saved.indexText,saved.bundleText),'Saved live atlas');dataState.at=saved.at;await settle();await localProbe;return rowsCache;}
      catch(error){dataState.errors.push('Saved atlas: '+error.message);await cache.clear?.().catch(()=>{});}
    }
    await localProbe;
    if(dataState.local){
      const [indexText,bundleText]=await Promise.all([gzipText('data/systems.csv.gz'),gzipText('data/top100.json.gz')]);
      commit(await prepare(indexText,bundleText),'Local atlas snapshot');await settle();return rowsCache;
    }
    status('Fetching latest atlas…');
    try{
      const viewsText=(globalThis.dvViewsText?globalThis.dvViewsText(ATLAS,gzipText):gzipText(ATLAS+'views/top100.json.gz')),parsedViews=viewsText.then(t=>earlyBundle(JSON.parse(t))).catch(()=>null);
      const [indexText,bundleText]=await Promise.all([(globalThis.dvIndexText?globalThis.dvIndexText(ATLAS,gzipText):gzipText(ATLAS+'index/systems.csv.gz')),viewsText]);
      commit(await prepare(indexText,bundleText,null,await parsedViews),'Live GitHub atlas');dataState.at=new Date().toISOString();await settle();await persist(indexText,bundleText);
    }catch(error){
      dataState.errors.push('Live atlas: '+error.message);status('Loading offline snapshot…');
      const [indexText,bundleText]=await Promise.all([gzipText('data/systems.csv.gz'),gzipText('data/top100.json.gz')]);
      commit(await prepare(indexText,bundleText),'Bundled offline snapshot');await settle();
    }
    await localProbe;return rowsCache;
  }finally{status('',false);}
}
export async function refreshData(){
  status('Fetching latest atlas…');
  try{
    const [indexText,bundleText]=await Promise.all([(globalThis.dvIndexText?globalThis.dvIndexText(ATLAS,gzipText):gzipText(ATLAS+'index/systems.csv.gz')),(globalThis.dvViewsText?globalThis.dvViewsText(ATLAS,gzipText):gzipText(ATLAS+'views/top100.json.gz'))]);
    const keys=await Promise.all([fingerprint(indexText),fingerprint(bundleText)]),checkedAt=new Date().toISOString();
    if(keys[0]===indexKey&&keys[1]===bundleKey){dataState.at=checkedAt;dataState.source='Live GitHub atlas';return rowsCache;}
    const next=await prepare(indexText,bundleText,keys);
    commit(next,'Live GitHub atlas');dataState.at=checkedAt;await persist(indexText,bundleText);return rowsCache;
  }finally{status('',false);}
}
export async function bundle(){if(!bundleCache)await Promise.race([bundleGate,new Promise(resolve=>setTimeout(resolve,60000))]);if(!bundleCache)throw new Error('Atlas is not ready.');return bundleCache;}
// SITE integration (user 2026-11-01): the first page of the Systems list = index/first.csv (the top rows under the
// default sort, written with every atlas publish; site-index.js fetches it early). null when it is missing.
// Deck counts of mapped rows are corrected from the map bundle as soon as it is here (like validateAtlas does).
export async function firstRows(){
  const text=await (globalThis.dvFirstText?globalThis.dvFirstText():Promise.resolve(null)).catch(()=>null);
  if(typeof text!=='string'||!text)return null;
  const rows=await parseAtlas(text).catch(()=>null);
  if(!rows?.length)return null;
  mapRows(rows,null,null);
  const floors=bundleGate.then(maps=>{const s={};for(const r of rows)if(maps.s[r.address])s[r.address]=maps.s[r.address];reconcileMapFloors(rows,{s,t:maps.t},window.DerelictModel);return rows;});
  return {rows,floors};
}
export async function props() { return propsCache ||= await fetch('piece_props.json').then(r=>r.json()).then(v=>v.scenes).catch(()=>null); }
export async function loadLayout(address) {
  const p=await props();
  if (dataState.local) {
    const response=await fetch('/api/derelict/'+address);
    if (response.ok) {
      const d=await response.json();
      const index=await fetch('/api/meshes/index').then(r=>r.ok?r.json():null).catch(()=>null);
      return {m:window.DerelictModel.build(d,index,p),d,pieceIndex:index,source:'Local generator'};
    }
    if (response.status!==404) throw new Error('Local layout request failed: '+response.status);
  }
  const b=await bundle();
  if (!b.s[address]) return null;
  const u=window.DerelictModel.unpack(b.s[address],b.t);
  return {m:window.DerelictModel.build(u.d,u.index,p),d:u.d,pieceIndex:u.index,source:'Published atlas layout'};
}
export async function importLayout(data) {
  if (!data || !/^[0-9A-Fa-f]{16}$/.test(data.address) || !Array.isArray(data.rooms) || !Array.isArray(data.containers) || !Array.isArray(data.instances)) throw new Error('Choose an original derelict.json with address, rooms, containers and instances.');
  if (!data.rooms.length || data.rooms.some(r=>!Array.isArray(r.raw_u16_0x00_0x1F) || r.raw_u16_0x00_0x1F.length<16)) throw new Error('The imported room cell masks are missing or invalid.');
  data.address=data.address.toUpperCase();
  const pieceIndex=data.viewer_meta?.v===1 && typeof data.viewer_meta.piece_index==='object' ? data.viewer_meta.piece_index : null;
  return {m:window.DerelictModel.build(data,pieceIndex,await props()),d:data,pieceIndex,source:'Imported file · this browser session'};
}
