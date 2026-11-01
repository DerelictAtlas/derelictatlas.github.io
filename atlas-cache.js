// One IndexedDB record commits index + map bundle + count atomically. Quota/private-mode failures are optional.
async function database(){
  if(!globalThis.indexedDB)return null;
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('derelict-atlas-cache',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Atlas cache is blocked.'));
  });
}
async function transaction(mode,work){
  const db=await database();if(!db)return null;
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('snapshots',mode);let result;
    const request=work(tx.objectStore('snapshots'));request.onsuccess=()=>{result=request.result;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Atlas cache write aborted.'));
  });}finally{db.close();}
}
export const atlasCache={
  read:()=>transaction('readonly',store=>store.get('current')),
  write:value=>transaction('readwrite',store=>store.put(value,'current')),
  clear:()=>transaction('readwrite',store=>store.delete('current'))
};
