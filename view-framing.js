// Shared framing for the initial viewers, Reset, and local Share/Photo exports.
export const VIEW_PRESETS={
  photo:{label:'Photo overview',azimuth:-.55,elevation:Math.atan2(.72,.85),mapAspect:1200/820,margin:1.035},
  high:{label:'High overview',azimuth:-.55,elevation:1.18,mapAspect:1.0,margin:1.035},
  corner:{label:'Corner overview',azimuth:-.95,elevation:.54,mapAspect:1.8,margin:1.035},
  wide:{label:'Wide decks',azimuth:1.1,elevation:.8,mapAspect:2.7,margin:1.035}
};
export function entranceAzimuth(model){
  const e=model.entrance||model.e;if(!e)return VIEW_PRESETS.photo.azimuth;
  const other=(model.rooms||[]).filter(r=>r.room_index!==0),rooms=other.length?other:model.rooms||[];
  let x=0,z=0,n=0;for(const room of rooms)for(const c of room.cells||[]){x+=c.x+.5;z+=c.z+.5;n++;}
  if(!n)return VIEW_PRESETS.photo.azimuth;
  const dx=e[0]+.5-x/n,dz=e[2]+.5-z/n;
  return Math.hypot(dx,dz)<1e-6?VIEW_PRESETS.photo.azimuth:Math.atan2(dx,dz);
}
export function viewPreset(id,entrance){
  const p=VIEW_PRESETS[id]||VIEW_PRESETS.photo;
  if(!Number.isFinite(entrance))return p;
  return {...p,azimuth:entrance+({photo:0,high:0,corner:-.4,wide:.8}[id]||0)};
}
// Keep the occupied pieces separate: one global box includes empty corners between decks.
// Uses the scene's own vector/matrix types, without a second Three dependency.
export function collectOverviewBounds(root){
  root.updateWorldMatrix(true,true);
  const points=[],min=root.position.clone().set(Infinity,Infinity,Infinity),max=min.clone().negate();
  const local=root.matrixWorld.clone(),world=local.clone();
  root.traverseVisible(object=>{
    const geometry=object.geometry;if(!geometry)return;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    const box=geometry.boundingBox;if(!box||box.isEmpty())return;
    const add=matrix=>{for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=box.min.clone().set(x,y,z).applyMatrix4(matrix);points.push(point);min.min(point);max.max(point);
    }};
    if(object.isInstancedMesh){for(let i=0;i<object.count;i++){object.getMatrixAt(i,local);world.multiplyMatrices(object.matrixWorld,local);add(world);}}
    else add(object.matrixWorld);
  });
  return {min,max,points,isEmpty:()=>!points.length};
}
// Fit the occupied geometry to both frustum axes and center its projected silhouette.
// Plain Box3 callers retain support; detailed bounds avoid fitting empty inter-deck space.
export function fitOverviewCamera(camera,target,bounds,id='photo'){
  const p=viewPreset(id,bounds.entranceAzimuth),center=bounds.min.clone().add(bounds.max).multiplyScalar(.5);
  const direction=center.clone().set(Math.sin(p.azimuth)*Math.cos(p.elevation),Math.sin(p.elevation),Math.cos(p.azimuth)*Math.cos(p.elevation));
  const right=center.clone().set(Math.cos(p.azimuth),0,-Math.sin(p.azimuth));
  const up=center.clone().crossVectors(direction,right).normalize();
  const ky=Math.tan(camera.fov*Math.PI/360)/p.margin,kx=ky*Math.max(.01,camera.aspect);
  let loX=Infinity,hiX=-Infinity,loY=Infinity,hiY=-Infinity,distance=.1;
  const include=point=>{
    const v=point.clone().sub(center),depth=v.dot(direction),x=v.dot(right),y=v.dot(up);
    loX=Math.min(loX,x-kx*depth);hiX=Math.max(hiX,x+kx*depth);
    loY=Math.min(loY,y-ky*depth);hiY=Math.max(hiY,y+ky*depth);
    distance=Math.max(distance,depth+camera.near*2);
  };
  if(bounds.points?.length)for(const point of bounds.points)include(point);
  else for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])include(center.clone().set(x,y,z));
  distance=Math.max(distance,(hiX-loX)/(2*kx),(hiY-loY)/(2*ky));
  target.copy(center).addScaledVector(right,(hiX+loX)/2).addScaledVector(up,(hiY+loY)/2);
  camera.position.copy(target).addScaledVector(direction,distance);
  camera.up.set(0,1,0);camera.far=Math.max(200,distance+bounds.max.distanceTo(bounds.min)*2);camera.updateProjectionMatrix();camera.lookAt(target);camera.updateMatrixWorld();
  return distance;
}
