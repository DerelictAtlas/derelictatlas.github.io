import {known} from './core.js';
import {createMap} from './maps.js';
import {mountIsometric} from './isometric.js';
const W=1600;
function loadImage(src){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('An image asset could not load.'));image.src=src;});}
async function svgImage(svg,width,height){
  const clone=svg.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',width);clone.setAttribute('height',height);
  const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent='text{font-family:Arial,sans-serif}.deck-label{fill:#bdd1dc;font-size:.31px;letter-spacing:.05px}';clone.prepend(style);
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
  try{return await loadImage(url);}finally{URL.revokeObjectURL(url);}
}
function host(width,height){const el=document.createElement('div');Object.assign(el.style,{position:'fixed',left:'-20000px',top:'0',width:width+'px',height:height+'px',visibility:'hidden',pointerEvents:'none'});document.body.append(el);return el;}
async function layoutImages(selection){
  const width=1200,height=820,mapHost=host(width,height),isoHost=host(width,height),controls=[];
  try{
    const options={moduleIds:selection.moduleIds,possibleIds:selection.possibleIds,layers:selection.layers,spread:selection.spread,framing:selection.framing||'photo'};
    controls.push(createMap(mapHost,selection.model,options));
    let scene;
    try{scene=selection.capture3D?.(width,height);}catch{scene=null;}
    if(!scene){controls.push(mountIsometric(isoHost,selection.model,options));scene=await svgImage(isoHost.querySelector('svg'),width,height);}
    return {scene,map:await svgImage(mapHost.querySelector('svg'),width,height)};
  }finally{controls.forEach(c=>c.dispose());mapHost.remove();isoHost.remove();}
}
function fit(ctx,image,x,y,w,h){const scale=Math.min(w/image.width,h/image.height),iw=image.width*scale,ih=image.height*scale;ctx.drawImage(image,x+(w-iw)/2,y+(h-ih)/2,iw,ih);}
function label(ctx,text,x,y,size=22,color='#9bb4c5',weight=400){ctx.font=`${weight} ${size}px Arial,sans-serif`;ctx.fillStyle=color;ctx.fillText(String(text),x,y);}
function wrap(ctx,text,x,y,maxWidth,size=26,lineHeight=34,maxLines=2,color='#eef3f4'){
  ctx.font=`400 ${size}px Arial,sans-serif`;const words=String(text).split(/\s+/),lines=[];let line='';
  for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
  lines.slice(0,maxLines).forEach((v,i)=>label(ctx,v+(i===maxLines-1&&lines.length>maxLines?'…':''),x,y+i*lineHeight,size,color));
}
function fittedLabel(ctx,text,x,y,width,size=34,color='#eef3f4'){
  let font=size;ctx.font=`500 ${font}px Arial,sans-serif`;
  while(font>24&&ctx.measureText(text).width>width){font--;ctx.font=`500 ${font}px Arial,sans-serif`;}
  let display=String(text);while(display.length&&ctx.measureText(display).width>width)display=display.slice(0,-1);
  if(display!==String(text))display=display.slice(0,-1)+'…';
  label(ctx,display,x,y,font,color,500);
}
function panel(ctx,x,y,w,h){ctx.fillStyle='#0a1c2a';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#416174';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);}
export async function createShareImage(plan,selection){
  const hasMap=Boolean(selection.model),panelY=490,H=hasMap?panelY+650:panelY+180;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Image export is unavailable in this browser.');
  const glyphImages=await Promise.all([...plan.glyphs].map(g=>loadImage('glyphs-svg/'+g.toLowerCase()+'.svg')));
  const rewardImage=plan.reward?await loadImage(plan.reward.icon):null;
  const layouts=hasMap?await layoutImages(selection):null;
  const gradient=ctx.createLinearGradient(0,0,W,H);gradient.addColorStop(0,'#0d2835');gradient.addColorStop(.55,'#081723');gradient.addColorStop(1,'#241b2d');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#466175';ctx.lineWidth=2;ctx.strokeRect(30,30,W-60,H-60);
  label(ctx,plan.derelictName?'NO MAN’S SKY · DERELICT ATLAS':'NO MAN’S SKY',64,76,19,'#9bb4c5');fittedLabel(ctx,plan.derelictName||'DERELICT ATLAS',64,119,1050);
  if(plan.systemName){ctx.textAlign='right';fittedLabel(ctx,plan.systemName,W-64,76,380,24,'#bdd1dc');ctx.textAlign='left';}
  ctx.textAlign='right';label(ctx,plan.galaxy,W-64,107,24);ctx.textAlign='left';
  glyphImages.forEach((image,i)=>fit(ctx,image,64+i*123,141,116,142));
  label(ctx,plan.glyphs,64,292,19,'#bdd1dc');
  panel(ctx,64,303,1472,166);
  label(ctx,plan.total,88,377,62,'#eef3f4',600);label(ctx,'TOTAL BOXES',200,341,22,'#eef3f4');wrap(ctx,plan.groups,200,376,275,19,22,2,'#9bb4c5');
  label(ctx,plan.modules,500,377,62,'#f3d06a',600);fittedLabel(ctx,'SALVAGED FRIGATE MODULES',612,341,355,22,'#f3d06a');label(ctx,'Predicted',612,376,19,'#9bb4c5');
  if(plan.reward){
    const color={C:'#94cd79',B:'#80b9ef',A:'#f09ba8',S:'#f0cf67'}[plan.reward.cls]||'#b2c5d1';
    fit(ctx,rewardImage,980,326,92,92);label(ctx,'End reward',1090,334,20,color);
    wrap(ctx,plan.reward.name+' ('+(plan.reward.cls==='unknown'?'—':plan.reward.cls)+')',1090,365,420,24,27,2);
    label(ctx,plan.reward.computed?'Predicted'+(plan.reward.ambiguous?' · uncertain':''):'Unknown',1090,416,18,color);
  }
  ctx.strokeStyle='#416174';ctx.beginPath();ctx.moveTo(88,431);ctx.lineTo(1512,431);ctx.stroke();
  label(ctx,`${known(selection.row.salvage_crates)} crates · ${known(selection.row.footlockers)} footlockers · ${known(selection.row.briefcases)} briefcases · ${known(selection.row.tall_lockers)} tall lockers`,88,454,20);
  ctx.textAlign='right';label(ctx,plan.rooms+' rooms · '+plan.decks+' decks',1512,454,22);ctx.textAlign='left';
  if(layouts){
    for(const [x,title,image] of [[64,'3D DERELICT',layouts.scene],[812,'2D MAP · ALL DECKS',layouts.map]]){panel(ctx,x,panelY,724,552);label(ctx,title,x+22,panelY+38,21,'#c6d6e0');ctx.fillStyle='#09131d';ctx.fillRect(x+2,panelY+54,720,496);fit(ctx,image,x+14,panelY+66,696,472);}
  }else{label(ctx,'SUMMARY ONLY · No published layout available',64,panelY+49,25);}
  label(ctx,'Module counts and end rewards are predictions. Beacon-summoned derelicts can differ.',64,H-68,19);
  label(ctx,plan.url,64,H-37,16,'#85a7bb');
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error('PNG export failed.')),'image/png'));
  return {blob,width:W,height:H};
}
