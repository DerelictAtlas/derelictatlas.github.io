export function createTouchHint(host,{setTimer=setTimeout,clearTimer=clearTimeout,message=()=>'Use two fingers to move, zoom or rotate'}={}){
  const doc=host?.ownerDocument||globalThis.document;
  if(!host?.append||!doc?.createElement)return {show(){},hide(){},dispose(){}};
  const node=doc.createElement('div');node.className='gesture-hint';node.hidden=true;node.setAttribute('role','status');node.textContent=message();host.append(node);
  let timer;
  function hide(){clearTimer(timer);node.hidden=true;}
  return {show(duration=1200){node.textContent=message();clearTimer(timer);node.hidden=false;timer=setTimer(hide,duration);},hide,dispose(){hide();node.remove();}};
}
