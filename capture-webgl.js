import {fitOverviewCamera} from './view-framing.js';
// Re-render at export resolution, copy immediately, then restore the live renderer/camera.
export function captureWebGL(renderer,scene,camera,width,height,makeCanvas=()=>document.createElement('canvas')){
  const ratio=renderer.getPixelRatio(),size=renderer.getSize({set(x,y){this.x=x;this.y=y;return this;}}),aspect=camera.aspect;
  const output=makeCanvas();output.width=width;output.height=height;
  try{
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    renderer.render(scene,camera);output.getContext('2d').drawImage(renderer.domElement,0,0);return output;
  }finally{
    renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y,false);camera.aspect=aspect;camera.updateProjectionMatrix();renderer.render(scene,camera);
  }
}

// A canonical overview export uses a separate camera and redraws the user's live view afterward.
export function captureOverviewWebGL(renderer,scene,camera,target,bounds,framing,width,height,makeCanvas){
  const exportCamera=camera.clone();exportCamera.aspect=width/height;
  fitOverviewCamera(exportCamera,target.clone(),bounds,framing);
  try{return captureWebGL(renderer,scene,exportCamera,width,height,makeCanvas);}finally{renderer.render(scene,camera);}
}
