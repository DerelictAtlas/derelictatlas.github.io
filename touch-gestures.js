import {createOrbitDragLock} from './view-controls.js';
// Cooperative touch controls: let one finger scroll; claim only a local two-finger gesture.
export function bindTwoFingerGestures(element,{onGesture,onStart=()=>{},onSingleStart=()=>{},onSingleMove=()=>{},onEnd=()=>{},enabled=()=>true,axisLock=false}={}){
  const orbitLock=createOrbitDragLock();
  const ids=new Set(),oldAction=element.style.touchAction;
  let previous=null,claimed=false,suppressUntil=0,start=null,lockPair=false;
  element.style.touchAction='pan-x pan-y';
  const points=e=>Array.from(e.touches).filter(t=>ids.has(t.identifier)).sort((a,b)=>a.identifier-b.identifier);
  const snapshot=p=>({ids:p.map(t=>t.identifier).join(','),x:(p[0].clientX+p[1].clientX)/2,y:(p[0].clientY+p[1].clientY)/2,d:Math.hypot(p[1].clientX-p[0].clientX,p[1].clientY-p[0].clientY),a:Math.atan2(p[1].clientY-p[0].clientY,p[1].clientX-p[0].clientX)});
  const consume=e=>{if(e.cancelable)e.preventDefault();};
  function reset(){if(claimed)onEnd();ids.clear();previous=null;claimed=false;start=null;orbitLock.reset();}
  function claim(e){consume(e);suppressUntil=Date.now()+700;if(!claimed){claimed=true;onStart();}}
  function down(e){
    if(!enabled()){reset();return;}
    if(!ids.size){suppressUntil=0;start=null;}
    for(const t of e.changedTouches)if(!t.target||element.contains(t.target))ids.add(t.identifier);
    const p=points(e);
    if(p.length>=2){orbitLock.reset();lockPair=typeof axisLock==='function'?axisLock():axisLock;claim(e);previous=p.length===2&&e.cancelable?snapshot(p):null;}
    else if(p.length===1&&!claimed){start={x:p[0].clientX,y:p[0].clientY};onSingleStart();}
  }
  function move(e){
    if(!enabled()){reset();return;}
    const p=points(e);
    if(p.length<2&&!claimed){if(start&&p[0]&&Math.hypot(p[0].clientX-start.x,p[0].clientY-start.y)>8){suppressUntil=Date.now()+700;onSingleMove();}return;}
    claim(e);
    // A browser-owned scroll cannot be taken over after its noncancelable moves begin.
    if(p.length!==2||!e.cancelable){previous=null;return;}
    const next=snapshot(p);
    if(previous&&next.ids===previous.ids){
      let rotation=next.a-previous.a;rotation=Math.atan2(Math.sin(rotation),Math.cos(rotation));
      const raw={dx:next.x-previous.x,dy:next.y-previous.y,scale:previous.d>1&&next.d>1?next.d/previous.d:1,rotation,x:next.x,y:next.y},gesture=lockPair?orbitLock.filter(raw):raw;
      if(gesture)onGesture(gesture);
    }
    previous=next;
  }
  function up(e){
    if(claimed){consume(e);suppressUntil=Date.now()+700;}
    for(const t of e.changedTouches)ids.delete(t.identifier);
    const p=points(e);orbitLock.reset();previous=p.length===2?snapshot(p):null;
    if(!ids.size)reset();
  }
  function blockTouchPointer(e){if(enabled()&&e.pointerType==='touch')e.stopImmediatePropagation();}
  function click(e){if(e.detail!==0&&e.pointerType!=='mouse'&&Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}}
  const handlers={touchstart:down,touchmove:move,touchend:up,touchcancel:up};
  for(const [name,fn] of Object.entries(handlers))element.addEventListener(name,fn,{passive:false});
  // OrbitControls and SVG mouse handlers must not capture the first touch pointer.
  const pointerEvents=['pointerdown','pointermove','pointerup','pointercancel'];
  for(const name of pointerEvents)element.addEventListener(name,blockTouchPointer,true);
  element.addEventListener('click',click,true);
  return {dispose(){reset();for(const [name,fn] of Object.entries(handlers))element.removeEventListener(name,fn);for(const name of pointerEvents)element.removeEventListener(name,blockTouchPointer,true);element.removeEventListener('click',click,true);element.style.touchAction=oldAction;}};
}

// Uses the camera's own vector type, so this adapter has no WebGL or vendor dependency.
export function orbitTouchGesture(camera,controls,element,{dx,dy,scale,rotation,mode}){
  if(!controls.enabled)return;
  camera.updateMatrixWorld();
  const offset=camera.position.clone().sub(controls.target),distance=offset.length();
  if(mode==='tilt'||mode==='rotate'){
    let azimuth=Math.atan2(offset.x,offset.z),elevation=Math.atan2(offset.y,Math.hypot(offset.x,offset.z));
    if(mode==='tilt')elevation=Math.max(-1.48,Math.min(1.48,elevation-dy*.006));
    else azimuth-=dx*.008;
    offset.set(distance*Math.cos(elevation)*Math.sin(azimuth),distance*Math.sin(elevation),distance*Math.cos(elevation)*Math.cos(azimuth));
    camera.position.copy(controls.target).add(offset);controls.update();return;
  }
  const units=2*distance*Math.tan(camera.fov*Math.PI/360)/Math.max(1,element.clientHeight);
  const pan=offset.clone().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(-dx*units);
  pan.add(offset.clone().setFromMatrixColumn(camera.matrixWorld,1).multiplyScalar(dy*units));
  controls.target.add(pan);
  const nextDistance=Math.min(controls.maxDistance??Infinity,Math.max(controls.minDistance??0,distance/scale));
  offset.applyAxisAngle(camera.up,rotation).setLength(nextDistance);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}
