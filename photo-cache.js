// Page-lifetime PNG cache. Dialog close only detaches previews; no disk or server storage.
export function createPhotoCache({createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url)}={}){
  const entries=new Map(),layouts=new WeakMap();let epoch=0;
  const ordered=value=>Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b));
  function key(plan,selection){
    const layout=selection.layoutData||selection.model;let data=null;
    if(layout&&typeof layout==='object'){data=layouts.get(layout);if(data===undefined){data=JSON.stringify(layout);layouts.set(layout,data);}}
    return JSON.stringify([plan,[selection.row?.salvage_crates,selection.row?.footlockers],data,ordered(selection.layers),selection.spread,selection.framing||'photo',Boolean(selection.capture3D),[...(selection.moduleIds||[])].sort(),[...(selection.possibleIds||[])].sort()]);
  }
  return {key,peek:key=>entries.get(key)?.value,has:key=>entries.has(key),get(key,generate){
    if(entries.has(key))return entries.get(key).promise;
    const entry={},ticket=epoch;entries.set(key,entry);
    entry.promise=Promise.resolve().then(generate).then(result=>{
      if(ticket!==epoch)return result;
      entry.value={...result,url:createUrl(result.blob)};return entry.value;
    }).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
    return entry.promise;
  },clear(){epoch++;for(const entry of entries.values())if(entry.value?.url)revokeUrl(entry.value.url);entries.clear();}};
}
