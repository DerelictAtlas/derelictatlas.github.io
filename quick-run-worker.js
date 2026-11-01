import {planQuickRun} from './quick-run.js';
let model;
self.onmessage=({data})=>{
  if(data.type==='model'){model=data.model;return;}
  try{self.postMessage({id:data.id,result:planQuickRun(model,data.options)});}
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
