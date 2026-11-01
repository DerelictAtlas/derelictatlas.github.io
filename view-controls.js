// A gesture commits to its strongest intent and stays there until the contact pair ends.
export function createOrbitDragLock(){
  let mode=null,dx=0,dy=0,scale=1,rotation=0;
  return {reset(){mode=null;dx=dy=rotation=0;scale=1;},filter(g){
    let movement=g;
    if(!mode){
      dx+=g.dx;dy+=g.dy;scale*=g.scale;rotation+=g.rotation;
      const scores=[['rotate',Math.abs(dx)/8],['tilt',Math.abs(dy)/8],['zoom',Math.abs(Math.log(scale))/.06],['twist',Math.abs(rotation)/.12]].sort((a,b)=>b[1]-a[1]);
      if(scores[0][1]<1)return null;mode=scores[0][0];movement={...g,dx,dy,scale,rotation};
    }
    return {...movement,mode,dx:mode==='rotate'?movement.dx:0,dy:mode==='tilt'?movement.dy:0,scale:mode==='zoom'?movement.scale:1,rotation:mode==='twist'?movement.rotation:0};
  }};
}
// Slower full deflection, a larger dead zone and a gentle response near the center.
export function walkingLookRate(value,sensitivity=1){
  const a=Math.min(1,Math.abs(value)),dead=.22;
  return a<=dead?0:Math.sign(value)*((a-dead)/(1-dead))**2.2*1.05*sensitivity;
}
