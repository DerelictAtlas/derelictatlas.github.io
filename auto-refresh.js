// Visit/manual atlas checks only. No interval or focus-triggered background polling.
// Retain the public controller API and share one in-flight request across callers.
export function createAutoRefresh(update,{onError=()=>{}}={}){
  let pending=null,started=false;
  function check(){
    if(pending)return pending;
    pending=Promise.resolve().then(update).then(()=>true).catch(error=>{onError(error);return false;}).finally(()=>{pending=null;});
    return pending;
  }
  return {
    check,
    start({immediate=true}={}){if(started)return pending||Promise.resolve(false);started=true;return immediate?check():Promise.resolve(false);},
    stop(){started=false;}
  };
}
