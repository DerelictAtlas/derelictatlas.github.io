// SVG compatibility renderer: the same decoded geometry, no dependency on a GPU context.
import {viewPreset,entranceAzimuth} from './view-framing.js';
import {createTouchHint} from './touch-hint.js';
import {bindTwoFingerGestures} from './touch-gestures.js';
import {COLORS,family,esc} from './core.js';
import {routeSvgParts} from './route-overlay.js';
import {depthPlane,occludedOverlays} from './svg-occlusion.js';
const NS='http://www.w3.org/2000/svg';
export function mountIsometric(host,model,{moduleIds=new Set(),possibleIds=new Set(),layers={},spread=1.6,framing='photo',touchMode='pan',onSelect=()=>{}}={}) {
  const entranceAngle=entranceAzimuth(model);
  let route=null,routeStep=0;
  const svg=document.createElementNS(NS,'svg');svg.classList.add('isometric-canvas');svg.setAttribute('role','img');svg.setAttribute('aria-label','Interactive isometric derelict; mouse drag to rotate; two-finger drag to pan, pinch to zoom, twist to rotate; Tilt button for vertical tilt and horizontal orbit');
  host.replaceChildren(svg);
  const touchHint=createTouchHint(host,{message:()=>touchMode==='orbit'?'Use two fingers: drag up/down to tilt, sideways to orbit':'Use two fingers: drag to pan, pinch to zoom, twist to rotate · Tilt button for above/below'});
  let pan={x:0,y:0},viewWidth=1,viewHeight=1,angle=viewPreset(framing,entranceAngle).azimuth,elevation=viewPreset(framing,entranceAngle).elevation,zoom=1,disposed=false,frame=0;
  const project=(x,z,h)=>{const u=x-6.5,v=z-6.5,depth=u*Math.sin(angle)+v*Math.cos(angle);return {x:u*Math.cos(angle)-v*Math.sin(angle),y:(depth*Math.sin(elevation)-h*Math.cos(elevation))*1.114,d:depth*Math.cos(elevation)+h*Math.sin(elevation)};};
  const active=k=>layers[k]!==false;
  const points=p=>p.map(q=>`${q.x.toFixed(3)},${q.y.toFixed(3)}`).join(' ');
  const tint=c=>COLORS[family(c)]||COLORS.other;
  function render(){
    if(disposed)return;
    const shapes=[],bounds=[],faces=[],overlays=[];
    const push=(points_,html,d)=>{bounds.push(...points_);shapes.push({html,d});};
    const polygon=(ps,fill,stroke,d,attrs='')=>{faces.push(ps);push(ps,`<polygon points="${points(ps)}" fill="${fill}" stroke="${stroke}" stroke-width=".022" ${attrs}/>`,d);};
    function box(x0,z0,x1,z1,bottom,top,color,room,kind='wall'){
      const b=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]].map(([x,z])=>project(x,z,bottom));
      const t=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]].map(([x,z])=>project(x,z,top));
      const d=project((x0+x1)/2,(z0+z1)/2,(bottom+top)/2).d;
      const attrs=room==null?'':`data-room="${room}"`,endSurface=room!=null&&color===COLORS.end&&(kind==='wall'||kind==='floor');
      for(let i=0;i<4;i++){
        const j=(i+1)%4;
        const visible=(t[j].x-t[i].x)>0;
        if(!visible)continue;
        polygon([b[i],b[j],t[j],t[i]],kind==='crate'?'#286f9e':endSurface?(i%2?'#703c6d':'#96518c'):i%2?'#223645':'#314957',color,d+Math.max(b[i].d,b[j].d)*.0001,attrs);
      }
      polygon(elevation<0?b:t,kind==='crate'?'#92b5c6':endSurface?(kind==='floor'?'url(#iso-end-panels)':'#c470b3'):kind==='floor'?'url(#iso-panels)':'#536879',color,d+.001,attrs);
    }
    const levels=[...new Set(model.rooms.flatMap(r=>r.levels))];
    const holes=new Set(model.links.flatMap(l=>l.cells.map(c=>`${c.x},${l.upper},${c.z}`)));
    for(const r of model.rooms){
      const color=tint(r.template_name);
      for(const c of r.cells){
        const h=c.y*spread;
        if(active('floors') && !holes.has(`${c.x},${c.y},${c.z}`))box(c.x,c.z,c.x+1,c.z+1,h-.04,h,color,r.room_index,'floor');
        if(active('walls') && !model.walls?.length){
          const has=(dx,dz)=>r.cellSet.has(`${c.x+dx},${c.y},${c.z+dz}`);
          if(!has(1,0))box(c.x+.94,c.z,c.x+1,c.z+1,h,h+.5,color,r.room_index);
          if(!has(-1,0))box(c.x,c.z,c.x+.06,c.z+1,h,h+.5,color,r.room_index);
          if(!has(0,1))box(c.x,c.z+.94,c.x+1,c.z+1,h,h+.5,color,r.room_index);
          if(!has(0,-1))box(c.x,c.z,c.x+1,c.z+.06,h,h+.5,color,r.room_index);
        }
      }
    }
    if(active('walls'))for(const w of model.walls||[])box(w.u0,w.v0,w.u1,w.v1,w.level*spread,w.level*spread+.5,tint(model.byIndex.get(w.room)?.template_name),w.room);
    if(active('fixtures'))for(const f of model.fixtures||[]) {if(f.prop||(f.detail&&active('hangarDetails')))continue;box(f.u0,f.v0,f.u1,f.v1,f.level*spread,f.level*spread+Math.min(.38,f.h||.28),'#6a8090',f.room);}
    // Same piece-local placement as the GPU renderer; never a guessed room-center ship.
    const hangarProject=(s,p)=>{
      let [x,y,z]=p;
      if(s.rot){const [rx,ry,rz]=s.rot.map(a=>a*Math.PI/180),c=Math.cos,t=Math.sin;
        [x,y]=[c(rz)*x-t(rz)*y,t(rz)*x+c(rz)*y];[y,z]=[c(rx)*y-t(rx)*z,t(rx)*y+c(rx)*z];[x,z]=[c(ry)*x+t(ry)*z,-t(ry)*x+c(ry)*z];}
      if(s.pos){x+=s.pos[0];y+=s.pos[1];z+=s.pos[2];}
      const q=[0,1,2].map(k=>x*s.axes[0][k]+y*s.axes[1][k]+z*s.axes[2][k]+s.t[k]);
      return project(q[0]/8+model.e[0]+.5,q[2]/8+model.e[2]+.5,q[1]/8+model.e[1]+(spread-1)*s.level);
    };
    if(active('ship'))for(const ship of model.ships||[]){
      const [x0,y0,z0,x1,y1,z1]=ship.box,cx=(x0+x1)/2,w=x1-x0,d=z1-z0;
      const outline=[[cx,z0],[cx+w*.2,z0+d*.35],[x1,z0+d*.6],[x1,z1],[x0,z1],[x0,z0+d*.6],[cx-w*.2,z0+d*.35]];
      const bottom=outline.map(([x,z])=>hangarProject(ship,[x,y0,z])),top=outline.map(([x,z])=>hangarProject(ship,[x,y1*.72+y0*.28,z]));
      for(let i=0;i<top.length;i++){const j=(i+1)%top.length,ps=[bottom[i],bottom[j],top[j],top[i]];polygon(ps,'#697b86','#bfd4df',ps.reduce((n,p)=>n+p.d,0)/4,'data-hangar-ship="true"');}
      polygon(top,'#c9ced4','#75d8da',top.reduce((n,p)=>n+p.d,0)/top.length,'data-hangar-ship="true"');
    }
    if(active('hangarDetails'))for(const detail of model.details||[]){
      const [x0,y0,z0,x1,y1,z1]=detail.box,b=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]].map(([x,z])=>hangarProject(detail,[x,y0,z])),t=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]].map(([x,z])=>hangarProject(detail,[x,y1,z]));
      for(const ps of [t,[b[0],b[1],t[1],t[0]],[b[1],b[2],t[2],t[1]],[b[2],b[3],t[3],t[2]],[b[3],b[0],t[0],t[3]]])polygon(ps,'#7d858d','#a9bcc8',ps.reduce((n,p)=>n+p.d,0)/ps.length,'data-hangar-detail="true"');
    }
    model.containers.forEach((c,id)=>{
      if(!active(c.container_kind==='salvage_crate'?'crates':'footlockers'))return;
      const h=c.g.level*spread+Math.max(0,c.layout_local_xyz[1]/8+model.e[1]-c.g.level),p=c.g;
      box(p.u-.06,p.v-.06,p.u+.06,p.v+.06,h,h+.13,'#6eb5dd',c.room_index,'crate');
      if(active('modules')&&(moduleIds.has(id)||possibleIds.has(id))){const a=project(p.u,p.v,h+.18);bounds.push({x:a.x-.3,y:a.y-.2},{x:a.x+.3,y:a.y+.2});overlays.push({html:`<ellipse cx="${a.x}" cy="${a.y}" rx=".26" ry=".16" fill="none" stroke="${moduleIds.has(id)?'#ffd45e':'#ffa04e'}" stroke-width=".065" ${possibleIds.has(id)?'stroke-dasharray=".1 .07"':''}/>`,plane:{x:0,y:0,c:a.d},anchors:[[a.x,a.y]]});}
    });
    for(const c of model.extras||[]){const tall=c.container_kind==='tall_locker';if(!active(tall?'tallLockers':'briefcases'))continue;const p=c.g,h=p.level*spread+Math.max(0,c.layout_local_xyz[1]/8+model.e[1]-p.level);box(p.u-.045,p.v-.045,p.u+.045,p.v+.045,h,h+(tall?.3:.05),tall?'#65d6c4':'#c7a0da',c.room_index,'crate');}
    if(active('hazards'))for(const c of model.hazards||[]){if(c.code==='X'&&!active('barrel'))continue;const p=project(c.g.u,c.g.v,c.g.level*spread+.15);push([{x:p.x-.075,y:p.y-.075},{x:p.x+.075,y:p.y+.075}],`<circle cx="${p.x}" cy="${p.y}" r=".065" fill="#c995e8"/>`,p.d+.02);}
    if(active('labels'))for(const r of model.rooms)for(const y of r.levels){const c=r.cells.find(c=>c.y===y),p=project(c.x+.5,c.z+.5,y*spread+.6);push([{x:p.x-.02,y:p.y-.26},{x:p.x+String(r.room_index).length*.16,y:p.y+.04}],`<text x="${p.x}" y="${p.y}" fill="#f5f8fc" font-size=".24" stroke="#0b1722" stroke-width=".02" paint-order="stroke">${r.room_index}</text>`,p.d+.03);}
    if(active('ladders'))for(const l of model.links){const x=l.mark.x+.7,z=l.mark.z+.75,h0=l.lower*spread,h1=l.upper*spread;
      const a=project(x,z,h0),b=project(x,z,h1),d=project(x,z,0).d;
      let html=`<path d="M ${a.x-.09} ${a.y} L ${b.x-.09} ${b.y} M ${a.x+.09} ${a.y} L ${b.x+.09} ${b.y}" stroke="#b3cbd9" stroke-width=".025"/>`;
      for(let h=h0;h<h1;h+=.13){const p=project(x,z,h);html+=`<path d="M ${p.x-.09} ${p.y} h .18" stroke="#b3cbd9" stroke-width=".025"/>`;}
      push([{x:a.x-.11,y:a.y},{x:b.x+.11,y:b.y}],html,d+.01);
    }
    if(active('doors'))for(const d of model.doors){const x=(d.a.x+d.b.x+1)/2,z=(d.a.z+d.b.z+1)/2,a=project(x,z,d.level*spread+.1);push([{x:a.x-.06,y:a.y-.06},{x:a.x+.06,y:a.y+.06}],`<circle cx="${a.x}" cy="${a.y}" r=".045" fill="#5ce0e0"/>`,a.d+.01);}
    const routeParts=routeSvgParts(route,routeStep,p=>{const q=project(p.u,p.v,p.level*spread+.08);return [q.x,q.y,q.d];});
    for(const part of routeParts){
      const [p,next]=part.source,h=p.level*spread+.08;
      if(!next)part.plane={x:0,y:0,c:part.d};
      else if(p.level===next.level)part.plane=depthPlane([project(p.u,p.v,h),project(p.u+1,p.v,h),project(p.u,p.v+1,h)]);
      else {const [a,b]=part.anchors.map(q=>({x:q[0],y:q[1],d:q[2]}));part.plane=depthPlane([a,b,{x:a.x+b.y-a.y,y:a.y-b.x+a.x,d:a.d}]);}
      overlays.push(part);
    }
    if(active('entrance')){const a=project(model.e[0]+.5,model.e[2],model.e[1]*spread+.3);push([{x:a.x-.6,y:a.y-.5},{x:a.x+.6,y:a.y+.12}],`<text x="${a.x}" y="${a.y-.3}" text-anchor="middle" fill="#83fff1" stroke="#07131e" stroke-width=".06" paint-order="stroke" font-size=".2">ENTRANCE</text><path d="M ${a.x} ${a.y-.2} l -.15 .3 h .3 Z" fill="#59e8de"/>`,Infinity);}
    if(!bounds.length)return;
    const x0=Math.min(...bounds.map(p=>p.x)),x1=Math.max(...bounds.map(p=>p.x)),y0=Math.min(...bounds.map(p=>p.y)),y1=Math.max(...bounds.map(p=>p.y));
    const padding=.16,w=(x1-x0+padding)*viewPreset(framing,entranceAngle).margin/zoom,h=(y1-y0+padding)*viewPreset(framing,entranceAngle).margin/zoom;
    viewWidth=w;viewHeight=h;svg.setAttribute('viewBox',`${(x0+x1-w)/2+pan.x} ${(y0+y1-h)/2+pan.y} ${w} ${h}`);
    svg.innerHTML=`<defs><pattern id="iso-panels" width=".5" height=".5" patternUnits="userSpaceOnUse"><rect width=".5" height=".5" fill="#8399a7"/><path d="M .02 .02 H .48 V .48 H .02 Z M .08 .08 H .42" fill="none" stroke="#344d60" stroke-width=".015"/></pattern><pattern id="iso-end-panels" width=".5" height=".5" patternUnits="userSpaceOnUse"><rect width=".5" height=".5" fill="${COLORS.end}"/><path d="M .02 .02 H .48 V .48 H .02 Z M .08 .08 H .42" fill="none" stroke="#773a70" stroke-width=".015"/></pattern></defs>`+shapes.filter(s=>s.d!==Infinity).sort((a,b)=>a.d-b.d).map(s=>s.html).join('')+occludedOverlays(overlays,faces,{x:x0-1,y:y0-1,width:x1-x0+2,height:y1-y0+2})+shapes.filter(s=>s.d===Infinity).map(s=>s.html).join('');
  }
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(render);};
  const touch=bindTwoFingerGestures(svg,{axisLock:()=>touchMode==='orbit',onSingleStart(){moved=false;downTarget=null;touchHint.show();},onSingleMove(){touchHint.show();},onStart(){moved=true;downTarget=null;touchHint.hide();},onGesture(g){
    const rect=svg.getBoundingClientRect(),unitScale=Math.min(rect.width/viewWidth,rect.height/viewHeight)||1;
    if(g.mode==='tilt')elevation=Math.max(-1.48,Math.min(1.48,elevation-g.dy*.006));
    else if(g.mode==='rotate')angle-=g.dx*.008;
    else if(!g.mode){pan.x-=g.dx/unitScale;pan.y-=g.dy/unitScale;}
    zoom=Math.min(4,Math.max(.6,zoom*g.scale));angle+=g.rotation;schedule();
  }});
  const pointers=new Map();let last=null,pinch=0,moved=false,downTarget=null;
  svg.onpointerdown=e=>{if(e.pointerType==='touch')return;downTarget=e.target;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});last={x:e.clientX,y:e.clientY};moved=false;svg.setPointerCapture(e.pointerId);};
  svg.onpointermove=e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch)zoom=Math.min(4,Math.max(.6,zoom*d/pinch));pinch=d;moved=true;}else if(last){const dx=e.clientX-last.x,dy=e.clientY-last.y;angle+=dx*.008;elevation=Math.max(-1.48,Math.min(1.48,elevation-dy*.006));if(Math.abs(dx)+Math.abs(dy)>2)moved=true;}last={x:e.clientX,y:e.clientY};schedule();};
  const release=e=>{pointers.delete(e.pointerId);last=null;pinch=0;};svg.onpointerup=release;svg.onpointercancel=release;
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.min(4,Math.max(.6,zoom*(e.deltaY<0?1.12:1/1.12)));schedule();},{passive:false});
  svg.onclick=e=>{if(!moved){const r=(downTarget||e.target).closest('[data-room]');if(r)onSelect(Number(r.dataset.room));}downTarget=null;};
  render();return {setRoute(value,step=0){route=value;routeStep=step;schedule();},setOptions(next){if(next.touchMode)touchMode=next.touchMode;if(next.layers)layers=next.layers;if(next.spread)spread=next.spread;if(next.framing){framing=next.framing;angle=viewPreset(framing,entranceAngle).azimuth;elevation=viewPreset(framing,entranceAngle).elevation;pan={x:0,y:0};zoom=1;}schedule();},resetView(){pan={x:0,y:0};angle=viewPreset(framing,entranceAngle).azimuth;elevation=viewPreset(framing,entranceAngle).elevation;zoom=1;schedule();},firstPerson(){return {active:false};},showTouchHint(duration){touchHint.show(duration);},dispose(){touchHint.dispose();touch.dispose();disposed=true;cancelAnimationFrame(frame);host.replaceChildren();}};
}
