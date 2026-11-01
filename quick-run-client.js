import {planQuickRun} from './quick-run.js';
export function createQuickRunPlanner(){
  let worker,model,last=0,unavailable=false;const pending=new Map();
  function dispose(){worker?.terminate();worker=null;model=null;for(const task of pending.values())task.reject(new Error('Route planning canceled.'));pending.clear();}
  return {dispose,async plan(next,options){
    if(!worker&&!unavailable)try{
      worker=new Worker(new URL('./quick-run-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);data.error?task.reject(new Error(data.error)):task.resolve(data.result);};
      worker.onerror=()=>{unavailable=true;worker?.terminate();worker=null;model=null;for(const task of pending.values())task.reject(new Error('Route worker unavailable. Try Quick Run again.'));pending.clear();};
    }catch{unavailable=true;}
    if(!worker){await new Promise(resolve=>setTimeout(resolve,0));return planQuickRun(next,options);}
    if(model!==next){worker.postMessage({type:'model',model:next});model=next;}
    const id=++last;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{worker.postMessage({type:'plan',id,options});}catch(error){pending.delete(id);reject(error);}});
  }};
}
