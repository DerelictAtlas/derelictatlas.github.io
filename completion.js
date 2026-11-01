// Browser-owned run history; retain the original address -> ISO time contract.
export function createCompletion({initial={},persist=()=>{},updateRemote=async()=>{},onChange=()=>{}}={}){
  let entries=Object.fromEntries(Object.entries(initial&&typeof initial==='object'&&!Array.isArray(initial)?initial:{}).filter(([key,value])=>/^[0-9A-F]{16}$/i.test(key)&&Boolean(value)).map(([key,value])=>[key.toUpperCase(),value]));
  const pending=new Set();
  const isDone=address=>Object.hasOwn(entries,address);
  async function toggle(address){
    if(!/^[0-9A-F]{16}$/.test(address))throw new Error('Invalid system address');
    if(pending.has(address))return false;
    const value=!isDone(address);pending.add(address);onChange(false);
    try{
      await updateRemote(address,value);
      const next={...entries};if(value)next[address]=new Date().toISOString();else delete next[address];
      persist(next);entries=next;onChange(true);return true;
    }finally{pending.delete(address);onChange(false);}
  }
  return {isDone,isPending:address=>pending.has(address),snapshot:()=>({...entries}),toggle};
}
