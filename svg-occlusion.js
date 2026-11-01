// Clip projected solid faces against an annotation's depth plane, masking
// only nearer portions: the orthographic SVG equivalent of a depth test.
export function depthPlane([a,b,c]){
  const x=b.x-a.x,y=b.y-a.y,u=c.x-a.x,v=c.y-a.y,det=x*v-u*y;
  if(Math.abs(det)<1e-10)return {x:0,y:0,c:a.d};
  const dx=b.d-a.d,dy=c.d-a.d,X=(dx*v-dy*y)/det,Y=(x*dy-u*dx)/det;
  return {x:X,y:Y,c:a.d-X*a.x-Y*a.y};
}
export function nearerFace(face,plane){
  const distance=p=>p.d-(plane.x*p.x+plane.y*p.y+plane.c)-.002,clipped=[];
  for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length],da=distance(a),db=distance(b);
    if(da>0)clipped.push(a);
    if((da>0)!==(db>0)){const t=da/(da-db);clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
  }
  return clipped.length>=3?clipped:[];
}
export function occludedOverlays(parts,faces,bounds){
  if(!parts.length)return '';
  const extent=ps=>({x0:Math.min(...ps.map(p=>p.x)),x1:Math.max(...ps.map(p=>p.x)),y0:Math.min(...ps.map(p=>p.y)),y1:Math.max(...ps.map(p=>p.y))});
  const projected=faces.map(face=>({face,...extent(face)}));
  const groups=new Map(),key=p=>[p.x,p.y,p.c].map(n=>n.toFixed(7)).join(',');
  for(const part of parts){const k=key(part.plane);if(!groups.has(k))groups.set(k,{plane:part.plane,html:[],anchors:[]});const group=groups.get(k);group.html.push(part.html);group.anchors.push(...(part.anchors||[[bounds.x,bounds.y],[bounds.x+bounds.width,bounds.y+bounds.height]]).map(p=>({x:p[0],y:p[1]})));}
  const {x,y,width,height}=bounds;let defs='',html='',id=0;
  for(const group of groups.values()){
    const name='iso-depth-'+id++,box=extent(group.anchors);let path='';
    for(const face of projected){
      if(face.x1<box.x0-.4||face.x0>box.x1+.4||face.y1<box.y0-.4||face.y0>box.y1+.4)continue;
      const ps=nearerFace(face.face,group.plane);if(!ps.length)continue;
      // Consistent winding makes overlapping subpaths a union, without holes.
      if(ps.reduce((sum,p,i)=>{const q=ps[(i+1)%ps.length];return sum+p.x*q.y-q.x*p.y;},0)<0)ps.reverse();
      path+='M'+ps.map(p=>`${p.x.toFixed(4)},${p.y.toFixed(4)}`).join('L')+'Z';
    }
    defs+=`<mask id="${name}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}" style="mask-type:luminance"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/>${path?`<path d="${path}" fill="black" stroke="black" stroke-width=".012"/>`:''}</mask>`;
    html+=`<g mask="url(#${name})">${group.html.join('')}</g>`;
  }
  return `<defs>${defs}</defs>${html}`;
}
