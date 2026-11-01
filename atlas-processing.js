import {parseCsvRow,systemQuery,reconcileMapFloors} from './core.js';
// Task boundaries keep input, scrolling and the fetching spinner alive on large atlases.
export function yieldToBrowser(){
  if(globalThis.scheduler?.yield)return globalThis.scheduler.yield();
  return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
}
export async function parseAtlas(text,{yieldTask=yieldToBrowser}={}){
  const rows=[];let keys,start=0,processed=0;
  while(start<text.length){
    let end=text.indexOf('\n',start);if(end<0)end=text.length;
    const line=text.slice(start,end).replace(/\r$/,'');start=end+1;
    if(!line||line.startsWith('#'))continue;
    if(!keys){keys=line.split(',');continue;}
    rows.push(parseCsvRow(keys,line));
    if(++processed%512===0)await yieldTask();
  }
  if(!keys)throw new Error('Atlas index is empty.');
  return rows;
}
// SITE integration (fast first page): with firstK, a long list returns at once with its first firstK rows picked in
// one pass and sorted (result.partial = how many are in order); result.full resolves to the fully sorted list (the
// same stable order) or null when isFullCurrent() turns false. Without firstK: as before.
export async function filterSortAtlas(rows,filters,{yieldTask=yieldToBrowser,isCurrent=()=>true,isDone=()=>false,firstK=0,isFullCurrent=isCurrent}={}){
  const {matches,compare}=systemQuery(filters),result=[];
  for(let i=0;i<rows.length;i++){
    if(!(filters.hideDone&&isDone(rows[i].address))&&matches(rows[i]))result.push(rows[i]);
    if(i%2048===2047){await yieldTask();if(!isCurrent())return null;}
  }
  if(firstK>0&&result.length>firstK*4){
    const top=[];
    for(let i=0;i<result.length;i++){
      const r=result[i];
      if(top.length<firstK||compare(r,top[firstK-1])<0){let lo=0,hi=top.length;while(lo<hi){const mid=(lo+hi)>>1;if(compare(top[mid],r)<=0)lo=mid+1;else hi=mid;}top.splice(lo,0,r);if(top.length>firstK)top.pop();}
      if(i%8192===8191){await yieldTask();if(!isCurrent())return null;}
    }
    if(!isCurrent())return null;
    const picked=new Set(top),out=top.concat(result.filter(r=>!picked.has(r)));
    out.partial=top.length;out.full=sortAll(result,compare,yieldTask,isFullCurrent);
    return out;
  }
  return sortAll(result,compare,yieldTask,isCurrent);
}
async function sortAll(result,compare,yieldTask,isCurrent){
  // Stable bottom-up merge sort; never hand hundreds of thousands of rows to blocking Array.sort.
  let source=result,target=new Array(result.length),operations=0;
  for(let run=1;run<result.length;run*=2){
    for(let start=0;start<result.length;start+=run*2){
      const middle=Math.min(start+run,result.length),end=Math.min(start+run*2,result.length);let a=start,b=middle;
      for(let out=start;out<end;out++){
        target[out]=a<middle&&(b>=end||compare(source[a],source[b])<=0)?source[a++]:source[b++];
        if(++operations%2048===0){await yieldTask();if(!isCurrent())return null;}
      }
    }
    [source,target]=[target,source];
  }
  return isCurrent()?source:null;
}
export async function validateAtlas(rows,bundle,model,{yieldTask=yieldToBrowser}={}){
  if(!rows.length||!bundle?.s||!bundle.t||typeof bundle.t!=='object')throw new Error('Atlas update has an invalid index or map bundle.');
  const addresses=new Set(Object.keys(bundle.s)),mapped=[];
  for(let i=0;i<rows.length;i++){
    if(!/^[0-9A-F]{16}$/.test(rows[i].address))throw new Error('Atlas update has an invalid index or map bundle.');
    if(addresses.has(rows[i].address))mapped.push(rows[i]);
    if(i%2048===2047)await yieldTask();
  }
  let corrected=0,count=0;
  for(const [address,packed] of Object.entries(bundle.s)){
    corrected+=reconcileMapFloors(mapped,{s:{[address]:packed},t:bundle.t},model);
    if(++count%4===0)await yieldTask();
  }
  return corrected;
}
