import {viewPreset} from './view-framing.js';
import {esc,family,COLORS,LINK_COLORS} from './core.js';
import {createTouchHint} from './touch-hint.js';
import {bindTwoFingerGestures} from './touch-gestures.js';
import {layoutDecks,projectDeck} from './deck-layout.js';
import {routeSvg} from './route-overlay.js';
const NS='http://www.w3.org/2000/svg';
export function createMap(host, model, {moduleIds=new Set(),possibleIds=new Set(),layers={},framing=null,onSelect=()=>{},onLink=()=>{}}={}) {
  const svg=document.createElementNS(NS,'svg');
  svg.classList.add('floor-canvas'); svg.setAttribute('role','img'); svg.setAttribute('aria-label','All floor plans, with ladder endpoints connected between decks');
  host.replaceChildren(svg);
  const touchHint=createTouchHint(host);
  const levels=[...new Set(model.rooms.flatMap(r=>r.levels))].sort((a,b)=>b-a);
  let rotation=0,zoom=1,pan={x:0,y:0},selected=null,width=1,height=1;
  const activeLayer=k=>layers[k]!==false;
  let packing;
  let route=null,routeStep=0;
  function draw() {
    packing=layoutDecks(model,framing?viewPreset(framing).mapAspect:(host.clientWidth||1)/(host.clientHeight||1));
    width=packing.width;height=packing.height;
    let html=`<defs><pattern id="deck-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 H 0 V 1" fill="none" stroke="#8da7be" stroke-opacity=".10" stroke-width=".025"/></pattern><pattern id="steel" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="#29394a"/><path d="M 0 0 H 1 V 1 H 0 Z M .08 .08 H .92 V .92 H .08 Z" stroke="#9caebf" stroke-opacity=".18" stroke-width=".02" fill="none"/><path d="M .18 .26 H .82 M .18 .36 H .82" stroke="#0d1822" stroke-width=".025"/></pattern></defs>`;
    levels.forEach((y,i)=>{
      const deck=packing.decks[i],ox=deck.x,oy=deck.y,pos=(u,v)=>projectDeck(deck,u,v);
      html+=`<g class="deck" data-level="${y}"><text x="${ox}" y="${oy-.4}" class="deck-label">DECK ${i+1}${y===model.e[1]?' · ENTRANCE':''}</text><rect x="${ox}" y="${oy}" width="${deck.width}" height="${deck.height-1}" fill="url(#deck-grid)"/>`;
      for(const r of model.rooms) {
        const color=COLORS[family(r.template_name)];
        for(const c of r.cells.filter(c=>c.y===y)) {
          const [x,z]=pos(c.x+1,c.z+1);
          if(activeLayer('floors')) html+=`<rect class="floor-cell" data-room="${r.room_index}" x="${x}" y="${z}" width="1" height="1" fill="url(#steel)"/><rect data-room="${r.room_index}" x="${x}" y="${z}" width="1" height="1" fill="${color}" fill-opacity="${selected===r.room_index?.4:.10}"/>`;
          if(activeLayer('walls') && !model.walls?.length) for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if(r.cellSet.has(`${c.x+dx},${y},${c.z+dz}`)) continue;
            const a=dx===1?[x,z,x,z+1]:dx===-1?[x+1,z,x+1,z+1]:dz===1?[x,z,x+1,z]:[x,z+1,x+1,z+1];
            html+=`<line x1="${a[0]}" y1="${a[1]}" x2="${a[2]}" y2="${a[3]}" stroke="${color}" stroke-width=".09"/>`;
          }
        }
      }
      if(activeLayer('fixtures')) for(const f of (model.fixtures||[]).filter(w=>w.level===y)) {
        const [x,z]=pos(f.u1,f.v1);
        html+=`<rect x="${x}" y="${z}" width="${f.u1-f.u0}" height="${f.v1-f.v0}" fill="#101d29" stroke="#728298" stroke-width=".025"/>`;
      }
      if(activeLayer('walls')) for(const w of (model.walls||[]).filter(w=>w.level===y)) {
        const [x,z]=pos(w.u1,w.v1),color=COLORS[family(model.byIndex.get(w.room)?.template_name)];
        html+=`<rect x="${x}" y="${z}" width="${w.u1-w.u0}" height="${w.v1-w.v0}" fill="#1a2733" stroke="${color}" stroke-opacity=".75" stroke-width=".035"/>`;
      }
      if(activeLayer('doors')) for(const d of model.doors.filter(d=>d.level===y)) {
        const [x,z]=pos((d.a.x+d.b.x+1)/2,(d.a.z+d.b.z+1)/2);
        html+=`<circle cx="${x}" cy="${z}" r=".07" fill="${d.slime?'#8ccf74':d.kind==='branch'?'#ffc16f':'#4ce1df'}"/>`;
      }
      model.containers.forEach((c,id)=>{
        if(c.g.level!==y) return;
        const crate=c.container_kind==='salvage_crate';
        if(!activeLayer(crate?'crates':'footlockers')) return;
        const [x,z]=pos(c.g.u,c.g.v),title=`Room ${c.room_index} · ${crate?'Salvage crate':'Footlocker'}${moduleIds.has(id)?' · Predicted module':possibleIds.has(id)?' · Possible module':''}`;
        html+=`<rect x="${x-.075}" y="${z-.06}" width=".15" height="${crate?.14:.08}" fill="${crate?'#4ba8df':'#a8b4be'}" stroke="#dcf4ff" stroke-width=".02"><title>${esc(title)}</title></rect>`;
        if(activeLayer('modules') && (moduleIds.has(id)||possibleIds.has(id))) html+=`<circle cx="${x}" cy="${z}" r=".23" fill="none" stroke="${moduleIds.has(id)?'#ffd24e':'#ff9f53'}" stroke-width=".07" ${possibleIds.has(id)?'stroke-dasharray=".09 .06"':''}><title>${esc(title)}</title></circle>`;
      });
      for(const c of model.extras||[]) {
        const tall=c.container_kind==='tall_locker';
        if(c.g.level!==y || !activeLayer(tall?'tallLockers':'briefcases')) continue;
        const [x,z]=pos(c.g.u,c.g.v);
        html+=`<rect x="${x-.045}" y="${z-.05}" width=".09" height=".1" fill="${tall?'#65d6c4':'#d2a3e9'}"><title>${tall?'Tall locker':'Briefcase'} · room ${c.room_index}</title></rect>`;
      }
      if(activeLayer('hazards')) for(const h of model.hazards||[]) {
        if(h.g.level!==y || h.code==='X' && !activeLayer('barrel')) continue;
        const [x,z]=pos(h.g.u,h.g.v);
        html+=`<circle cx="${x}" cy="${z}" r=".07" fill="#c094e8"><title>${esc(h.kind)} · room ${h.room_index}</title></circle>`;
      }
      if(activeLayer('entrance') && y===model.e[1]) {
        const [x,z]=pos(model.e[0]+.5,model.e[2]);
        html+=`<path d="M ${x} ${z-.1} l -.24 .38 h .48 Z" fill="#49ede6"><title>Entrance</title></path>`;
      }
      html+='</g>';
    });
    if(activeLayer('ladders')) for(const l of model.links) {
      const i=levels.indexOf(l.upper),j=levels.indexOf(l.lower),color=LINK_COLORS[l.id%LINK_COLORS.length],label=String.fromCharCode(65+l.id);
      const points=[i,j].map(k=>projectDeck(packing.decks[k],l.mark.x+.5,l.mark.z+.5));
      const [[ax,ay],[bx,by]]=points;
      const bend=Math.min(1,Math.abs(bx-ax)/3),path=`M ${ax} ${ay} C ${ax+bend} ${ay}, ${bx-bend} ${by}, ${bx} ${by}`;
      html+=`<g class="ladder-link" data-link="${l.id}" role="button" tabindex="0" aria-label="Ladder ${label}, Deck ${i+1} to Deck ${j+1}"><path d="${path}" fill="none" stroke="${color}" stroke-width=".06" stroke-dasharray=".18 .13"/>`;
      points.forEach(([x,y],k)=>html+=`<circle cx="${x}" cy="${y}" r=".31" fill="#0b1c2d" stroke="${color}" stroke-width=".065"/><text x="${x}" y="${y+.12}" text-anchor="middle" fill="${color}" font-size=".36" font-weight="700">${label}</text><title>Ladder ${label}: Deck ${k?j+1:i+1} ${k?'↑':'↓'} Deck ${k?i+1:j+1}</title>`);
      html+='</g>';
    }
    html+=routeSvg(route,routeStep,p=>{const deck=packing.decks.find(d=>d.level===p.level);return deck?projectDeck(deck,p.u,p.v):null;});
    svg.innerHTML=`<g class="floor-scene">${html}</g>`; update();
  }
  function viewSize(){const a=rotation*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));return {w:width*c+height*s,h:width*s+height*c};}
  function update() { const {w,h}=viewSize();svg.querySelector('.floor-scene')?.setAttribute('transform',`rotate(${rotation} ${width/2} ${height/2})`); svg.setAttribute('viewBox',`${pan.x} ${pan.y} ${w/zoom} ${h/zoom}`); }
  function setZoom(n,center) {
    n=Math.min(8,Math.max(1,n));
    const {w,h}=viewSize(),cx=pan.x+w/zoom*(center?.x??.5),cy=pan.y+h/zoom*(center?.y??.5);
    zoom=n; pan={x:cx-w/zoom*(center?.x??.5),y:cy-h/zoom*(center?.y??.5)};update();
  }
  const touch=bindTwoFingerGestures(svg,{onSingleStart(){moved=false;downTarget=null;touchHint.show();},onSingleMove(){touchHint.show();},onStart(){moved=true;downTarget=null;touchHint.hide();},onGesture(g){
    const matrix=svg.getScreenCTM()?.inverse();if(!matrix)return;
    const a=svg.createSVGPoint(),b=svg.createSVGPoint();a.x=g.x-g.dx;a.y=g.y-g.dy;b.x=g.x;b.y=g.y;
    const p=a.matrixTransform(matrix),q=b.matrixTransform(matrix);
    const before=viewSize();pan.x+=p.x-q.x;pan.y+=p.y-q.y;rotation+=g.rotation*180/Math.PI;
    const after=viewSize();pan.x+=(before.w-after.w)/(2*zoom);pan.y+=(before.h-after.h)/(2*zoom);
    setZoom(zoom*g.scale);
  }});
  const pointers=new Map(); let last=null,pinch=null,moved=false,downTarget=null;
  svg.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;downTarget=e.target;svg.setPointerCapture(e.pointerId); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});last={x:e.clientX,y:e.clientY};moved=false;});
  svg.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2) {
      const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);
      if(pinch) setZoom(zoom*d/pinch); pinch=d;moved=true;
    } else if(last) {
      const a=svg.createSVGPoint(),b=svg.createSVGPoint(),matrix=svg.getScreenCTM()?.inverse();
      if(!matrix)return; a.x=last.x;a.y=last.y;b.x=e.clientX;b.y=e.clientY;
      const p=a.matrixTransform(matrix),q=b.matrixTransform(matrix);
      if(Math.hypot(e.clientX-last.x,e.clientY-last.y)>2)moved=true;
      pan.x+=p.x-q.x;pan.y+=p.y-q.y;update();
    }
    last={x:e.clientX,y:e.clientY};
  });
  const release=e=>{pointers.delete(e.pointerId);last=pointers.size?[...pointers.values()][0]:null;pinch=null;};
  svg.addEventListener('pointerup',release);svg.addEventListener('pointercancel',release);
  svg.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom*(e.deltaY<0?1.13:1/1.13));},{passive:false});
  const activate=e=>{
    const link=e.target.closest('[data-link]'); if(link) {svg.querySelectorAll('.ladder-link').forEach(x=>x.classList.toggle('highlight',x===link));onLink(model.links[Number(link.dataset.link)]);return;}
    const room=e.target.closest('[data-room]');if(room){selected=Number(room.dataset.room);onSelect(selected);draw();}
  };
  svg.addEventListener('click',e=>{if(!moved)activate({target:downTarget||e.target});downTarget=null;});
  svg.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(e);}});
  const observer=new ResizeObserver(()=>{zoom=1;pan={x:0,y:0};draw();});observer.observe(host);
  draw();
  return {setRoute(value,step=0){route=value;routeStep=step;draw();},setFraming(id){framing=id;rotation=0;zoom=1;pan={x:0,y:0};draw();},fit(){rotation=0;zoom=1;pan={x:0,y:0};update();},zoom(n){setZoom(zoom*n);},setExpanded(v){zoom=1;pan={x:0,y:0};draw();},refresh(){draw();},showTouchHint(duration){touchHint.show(duration);},dispose(){touchHint.dispose();touch.dispose();observer.disconnect();host.replaceChildren();}};
}
