// Keep visible row nodes stable while the browser performs native scrolling.
export function createWindowedList(host,createRow,{rowHeight=132,overscan=3,isFocused=()=>false}={}){
  const spacer=host.ownerDocument.createElement('div');spacer.className='list-spacer';
  const cache=new Map();let signature='',height=-1,revision=-1;
  const stats={updates:0,skipped:0,created:0,removed:0,lastCreated:0,lastMs:0,maxMs:0};
  function render(rows,count,version=0){
    count=Math.min(count,rows.length);
    const start=Math.max(0,Math.min(count,Math.floor(host.scrollTop/rowHeight)-overscan));
    const end=Math.min(count,start+Math.ceil(host.clientHeight/rowHeight)+overscan*2+1);
    const next=`${start}:${end}:${count}:${version}`;
    if(signature===next){stats.skipped++;return false;}
    const begin=performance.now();stats.lastCreated=0;
    if(spacer.parentNode!==host)host.replaceChildren(spacer);
    if(revision!==version){for(const el of cache.values())el.remove();cache.clear();revision=version;}
    if(height!==count*rowHeight){height=count*rowHeight;spacer.style.height=height+'px';}
    const wanted=new Set(rows.slice(start,end).map(r=>r.address));
    for(const [key,el] of cache)if(!wanted.has(key)&&!isFocused(el)){el.remove();cache.delete(key);stats.removed++;}
    // Inserting only missing nodes retains image decoding, focus and native scrolling.
    for(let i=start;i<end;i++){
      const row=rows[i];let el=cache.get(row.address);
      if(!el){el=createRow(row);el.style.top=i*rowHeight+'px';cache.set(row.address,el);stats.created++;stats.lastCreated++;
        const before=[...spacer.children].find(child=>Number(child.dataset.listIndex)>i);
        el.dataset.listIndex=String(i);spacer.insertBefore(el,before||null);
      }
    }
    signature=next;stats.updates++;stats.lastMs=performance.now()-begin;stats.maxMs=Math.max(stats.maxMs,stats.lastMs);
    return true;
  }
  function clear(){for(const el of cache.values())el.remove();cache.clear();signature='';height=-1;revision=-1;}
  return {render,clear,stats};
}
