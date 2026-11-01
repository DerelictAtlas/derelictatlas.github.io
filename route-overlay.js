// Render the same immutable navigation result in packed 2D and projected SVG 3D.
export function compactRoute(points){
  return points.filter((p,i)=>{if(!i||i===points.length-1)return true;const a=points[i-1],b=points[i+1];return a.level!==p.level||b.level!==p.level||Math.abs((p.u-a.u)*(b.v-p.v)-(p.v-a.v)*(b.u-p.u))>1e-8;});
}
export function routeSvgParts(route,step,project,{sampled=false}={}){
  if(route?.status!=='ready')return [];
  const parts=[],add=(html,d,source,anchors)=>parts.push({html:`<g class="navigation-route" pointer-events="none" aria-hidden="true">${html}</g>`,d,source,anchors});
  route.legs.forEach((leg,index)=>{
    const color=index===step?'#ffdb65':'#62f4df',points=sampled?leg.points:compactRoute(leg.points);
    for(let i=1;i<points.length;i++){
      const a=project(points[i-1]),b=project(points[i]);if(!a||!b)continue;
      const d=`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`,dash=points[i-1].level!==points[i].level?' stroke-dasharray=".16 .1"':'';
      add(`<path d="${d}" fill="none" stroke="#03131e" stroke-width=".16"/><path data-route-leg="${index}" d="${d}" fill="none" stroke="${color}" stroke-width=".075" stroke-linecap="round" opacity="${index===step?1:.65}"${dash}/>`,((a[2]||0)+(b[2]||0))/2,[points[i-1],points[i]],[a,b]);
    }
  });
  route.stops.forEach((stop,index)=>{const p=project(stop);if(!p)return;const end=stop.targets[0]?.kind==='end_room',color=index===step?'#ffdb65':'#62f4df';
    add(`<circle data-route-stop="${index}" cx="${p[0]}" cy="${p[1]}" r=".23" fill="#07131e" stroke="${color}" stroke-width=".055"/><text x="${p[0]}" y="${p[1]+.08}" text-anchor="middle" fill="${color}" font-size=".23" font-weight="700">${end?'E':index+1}</text>`,p[2]||0,[stop],[p]);
  });return parts;
}
export function routeSvg(route,step,project){
  return routeSvgParts(route,step,project).map(part=>part.html).join('');
}
export function createRouteOverlay3D(THREE,labelSprite){
  const group=new THREE.Group();
  const clear=()=>{group.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});group.clear();};
  return {group,dispose:clear,set(route,step,spread){
    clear();if(route?.status!=='ready')return;
    const point=p=>new THREE.Vector3(p.u-6.5,p.level*spread+.08,p.v-6.5);
    route.legs.forEach((leg,index)=>{
      const geometry=new THREE.BufferGeometry().setFromPoints(compactRoute(leg.points).map(point)),material=new THREE.LineBasicMaterial({color:index===step?0xffdb65:0x62f4df,depthTest:true,depthWrite:false,transparent:true,opacity:index===step?1:.65});
      const line=new THREE.Line(geometry,material);line.renderOrder=120;group.add(line);
    });
    route.stops.forEach((stop,index)=>{const sprite=labelSprite(stop.targets[0]?.kind==='end_room'?'E':String(index+1));sprite.position.copy(point(stop));sprite.position.y+=.12;sprite.material.depthTest=true;sprite.material.depthWrite=false;sprite.renderOrder=121;group.add(sprite);});
  }};
}
