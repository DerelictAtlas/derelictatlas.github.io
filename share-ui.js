import {esc} from './core.js';
import {sharePlan,socialDrafts,sharePayload} from './share-data.js';
import {createShareImage} from './share-image.js';
import {createPhotoCache} from './photo-cache.js';
import {VIEW_PRESETS} from './view-framing.js';
export function createSharing({getSelection,onRewardChange=()=>{},onFramingChange=()=>{},onLog=()=>{},renderImage=createShareImage}){
  const dialog=document.createElement('dialog');dialog.id='share-dialog';dialog.className='sheet share-sheet';dialog.setAttribute('aria-labelledby','share-title');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="share-title">Photo &amp; share</h2><button id="share-close" type="button" class="icon-button" aria-label="Close photo and share">×</button></div><button id="share-toggle-reward" class="share-reward-toggle" type="button" aria-pressed="false" aria-controls="share-preview">Show End Reward</button><div id="share-views" class="share-views" role="group" aria-label="Photo and viewer angle">${Object.entries(VIEW_PRESETS).map(([id,p])=>`<button type="button" data-framing="${id}" aria-pressed="false">${p.label}</button>`).join('')}</div><p id="share-status" class="share-status" role="status">Preparing image…</p><div class="share-preview-frame"><img id="share-preview" class="share-preview" alt="Share card with portal glyphs, loot totals, predicted modules and available maps" hidden></div><div class="share-primary"><button id="share-save" class="primary" disabled>Save image</button><button id="share-native" disabled>Share image + link</button></div><div><details id="share-copy-menu" class="share-copy-menu"><summary>Copy…</summary><div class="share-copy-buttons"><button id="share-copy-link" type="button">Link</button><button id="share-copy-code" type="button">Glyph code (hex)</button><button id="share-copy-text" type="button">Post text</button><button id="share-copy-image" type="button" disabled>Image (PNG)</button></div></details><label for="share-copy-field" class="sr-only">Link or text to copy</label><textarea id="share-copy-field" class="share-copy-field" rows="2" readonly></textarea><div id="share-socials" class="share-socials" aria-label="Open a social sharing draft"></div><p class="share-help">Social shortcuts open a link draft. Attach the saved PNG in the composer. Device sharing can attach the image and link together where supported.</p><p class="share-help">This site is private. Link recipients need access; sharing a link does not grant it.</p></div><p id="share-local-note" class="share-help">Image generation happens entirely in your browser.</p>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id);
  const images=createPhotoCache();
  window.addEventListener('pagehide',event=>{if(!event.persisted)images.clear();});
  let generation=0,previewUrl=null,file=null,plan=null;
  function status(text){$('share-status').textContent=text;}
  function release(){generation++;previewUrl=null;file=null;$('share-preview').removeAttribute('src');$('share-preview').hidden=true;}
  dialog.addEventListener('close',release);$('share-close').onclick=()=>dialog.close();
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  function copy(text){
    $('share-copy-field').value=text;
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>{$('share-copy-menu').open=false;status('Copied.');}).catch(()=>{$('share-copy-field').hidden=false;status('Select and copy the text below.');$('share-copy-field').focus();$('share-copy-field').select();});
    else{$('share-copy-field').hidden=false;status('Select and copy the text below.');$('share-copy-field').focus();$('share-copy-field').select();}
  }
  $('share-copy-link').onclick=()=>copy(plan.url);$('share-copy-code').onclick=()=>copy(plan.glyphs);$('share-copy-text').onclick=()=>copy(plan.caption);
  $('share-save').onclick=()=>{if(!file||!previewUrl)return;const a=document.createElement('a'),url=URL.createObjectURL(file);a.href=url;a.download=plan.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Image saved or opened for download.');};
  $('share-copy-image').onclick=()=>{if(!file)return;navigator.clipboard.write([new ClipboardItem({'image/png':file})]).then(()=>{$('share-copy-menu').open=false;status('Image copied.');}).catch(()=>status('Image copying was blocked. Use Save image instead.'));};
  $('share-native').onclick=()=>{
    if(!plan||!file||!navigator.share)return;
    const ticket=generation,payload=sharePayload(plan,file,navigator);$('share-native').disabled=true;
    // Call directly from this click: image creation has already completed.
    let task;try{task=navigator.share(payload);}catch(error){status('Device sharing is unavailable here. Save the image and copy the link.');$('share-native').disabled=false;onLog('Share: '+error.message);return;}
    Promise.resolve(task).then(()=>{if(ticket===generation)status('Passed to your sharing app.');}).catch(error=>{if(ticket!==generation)return;if(error.name==='AbortError')status('Sharing canceled.');else{status('Device sharing is unavailable here. Save the image and copy the link.');onLog('Share: '+error.message);}}).finally(()=>{if(ticket===generation)$('share-native').disabled=false;});
  };
  $('share-toggle-reward').onclick=()=>{const selection=getSelection();if(!selection)return;onRewardChange(!selection.showReward);return open(dialog.dataset.mode||'share');};
  $('share-views').querySelectorAll('[data-framing]').forEach(button=>button.onclick=()=>{onFramingChange(button.dataset.framing);return open(dialog.dataset.mode||'share');});
  async function open(mode='share'){
    const selection=getSelection();if(!selection)return;
    release();const ticket=generation,currentPlan=sharePlan(selection.row,selection.groups,selection.showReward,undefined,selection.layoutData);plan=currentPlan;dialog.dataset.mode='share';
    const key=images.key(currentPlan,selection),cached=images.peek(key);dialog.dataset.imageCache=cached?'hit':images.has(key)?'pending':'miss';
    $('share-views').querySelectorAll('[data-framing]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.framing===(selection.framing||'photo'))));
    $('share-toggle-reward').textContent=selection.showReward?'Hide End Reward':'Show End Reward';$('share-toggle-reward').setAttribute('aria-pressed',String(selection.showReward));
    $('share-title').textContent='Photo & share';status('Preparing your image locally…');
    if(!dialog.open)$('share-copy-menu').open=mode==='copy';else if(mode==='copy')$('share-copy-menu').open=true;
    $('share-copy-field').hidden=true;
    $('share-copy-field').value=plan.url;$('share-socials').innerHTML=socialDrafts(plan).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join('');
    $('share-local-note').textContent='Image generation happens entirely in your browser.'+(selection.imported?' Your imported file is not included in the link.':'');
    for(const id of ['share-save','share-copy-image','share-native'])$(id).disabled=true;
    if(!dialog.open)dialog.showModal();
    if(mode==='copy')$('share-copy-link').focus();
    try{
      const result=cached||await images.get(key,()=>renderImage(currentPlan,selection));if(ticket!==generation||!dialog.open)return;
      file=new File([result.blob],plan.filename,{type:'image/png'});previewUrl=result.url;$('share-preview').src=previewUrl;$('share-preview').hidden=false;
      $('share-save').disabled=false;$('share-copy-image').disabled=!(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined');
      const payload=sharePayload(plan,file,navigator);$('share-native').textContent=payload.files?'Share image + link':'Share link';$('share-native').disabled=!navigator.share;
      status(`${result.width} × ${result.height} PNG · ${plan.reward?'End reward included':'End reward hidden'}`);
      onLog(`Share image ${cached?'reused':'ready'}: ${plan.address}, ${result.width}×${result.height}, reward ${Boolean(plan.reward)}`);
    }catch(error){if(ticket===generation){status('Image could not be created. You can still copy the link or glyph code.');onLog('Share image: '+error.message);}}
  }
  return {open};
}
