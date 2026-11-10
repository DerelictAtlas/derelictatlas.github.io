import {esc} from './core.js';
import {sharePlan,socialDrafts,sharePayload,lootInfo} from './share-data.js';
import {createShareImage} from './share-image.js';
import {createPhotoCache} from './photo-cache.js';
import {VIEW_PRESETS} from './view-framing.js';
export function createSharing({getSelection,onRewardChange=()=>{},onFramingChange=()=>{},onLog=()=>{},renderImage=createShareImage}){
  const dialog=document.createElement('dialog');dialog.id='share-dialog';dialog.className='sheet share-sheet';dialog.setAttribute('aria-labelledby','share-title');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="share-title">Photo &amp; share</h2><button id="share-close" type="button" class="icon-button" aria-label="Close photo and share">×</button></div><button id="share-toggle-reward" class="share-reward-toggle" type="button" aria-pressed="false" aria-controls="share-preview">Show End Reward</button><div id="share-views" class="share-views" role="group" aria-label="Photo and viewer angle">${Object.entries(VIEW_PRESETS).map(([id,p])=>`<button type="button" data-framing="${id}" aria-pressed="false">${p.label}</button>`).join('')}</div><fieldset id="share-opts" class="dvb-options share-opts"><legend>Show in the photo</legend><label data-opt="loot"><input type="checkbox" data-opt="loot"><span>Loot (value, nanites)</span><small class="dvb-na">not known</small></label><label data-opt="spook"><input type="checkbox" data-opt="spook"><span>SpookBox contents</span><small class="dvb-na">not known</small></label></fieldset><p id="share-status" class="share-status" role="status">Preparing image…</p><div class="share-preview-frame"><img id="share-preview" class="share-preview" alt="Share card with portal glyphs, loot totals, predicted modules and available maps" hidden></div><div class="share-primary"><button id="share-save" class="primary" disabled>Save image</button><button id="share-native" disabled>Share image + link</button></div><div><details id="share-copy-menu" class="share-copy-menu"><summary>Copy…</summary><div class="share-copy-buttons"><button id="share-copy-link" type="button">Link</button><button id="share-copy-code" type="button">Glyph code (hex)</button><button id="share-copy-text" type="button">Post text</button><button id="share-copy-image" type="button" disabled>Image (PNG)</button></div></details><details id="share-embed" class="share-copy-menu share-embed"><summary>Embed</summary><div class="share-embed-body"><p class="share-help">Put this system on your own page. The end reward stays hidden until a visitor clicks it.</p><label for="share-embed-code" class="sr-only">Embed code for this system</label><textarea id="share-embed-code" class="share-copy-field" rows="5" readonly></textarea><button id="share-embed-copy" type="button">Copy code</button><iframe id="share-embed-preview" class="share-embed-preview" title="Embed preview" loading="lazy"></iframe></div></details><div id="share-toast" class="share-toast" role="status" aria-live="polite"></div><label for="share-copy-field" class="sr-only">Link or text to copy</label><textarea id="share-copy-field" class="share-copy-field" rows="2" readonly></textarea><div id="share-socials" class="share-socials" aria-label="Open a social sharing draft"></div><p class="share-help">Social shortcuts open a link draft. Attach the saved PNG in the composer. Device sharing can attach the image and link together where supported.</p><p class="share-help">This site is private. Link recipients need access; sharing a link does not grant it.</p></div><p id="share-local-note" class="share-help">Image generation happens entirely in your browser.</p>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id);
  const images=createPhotoCache();
  window.addEventListener('pagehide',event=>{if(!event.persisted)images.clear();});
  let generation=0,previewUrl=null,file=null,plan=null;
  const OPT_KEY='dv.photo.v1',opts={loot:true,spook:true};
  try{const s=JSON.parse(localStorage.getItem(OPT_KEY)||'null');if(s&&typeof s==='object')for(const k of Object.keys(opts))if(typeof s[k]==='boolean')opts[k]=s[k];}catch{}
  function photoOptions(selection){
    const info=lootInfo(selection.row,selection.extras),has={loot:info.value!==null||info.nanites!==null,spook:Boolean(info.spook)};
    dialog.querySelectorAll('#share-opts input[data-opt]').forEach(box=>{const k=box.dataset.opt;box.disabled=!has[k];box.checked=has[k]&&opts[k];box.closest('label').classList.toggle('is-na',!has[k]);});
    return {loot:opts.loot&&has.loot?{value:info.value,nanites:info.nanites}:null,spook:opts.spook&&has.spook?info.spook:null};
  }
  dialog.querySelectorAll('#share-opts input[data-opt]').forEach(box=>box.addEventListener('change',()=>{opts[box.dataset.opt]=box.checked;try{localStorage.setItem(OPT_KEY,JSON.stringify(opts));}catch{}open(dialog.dataset.mode||'share');}));
  function status(text){$('share-status').textContent=text;}
  function release(){generation++;previewUrl=null;file=null;$('share-preview').removeAttribute('src');$('share-preview').hidden=true;}
  const endHint=()=>$('share-copy-menu').classList.remove('copy-hint');dialog.addEventListener('pointerdown',endHint);dialog.addEventListener('keydown',endHint);dialog.addEventListener('close',endHint);dialog.addEventListener('close',release);$('share-close').onclick=()=>dialog.close();
  dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  let toastTimer=0;
  function toast(anchor,text,bad){
    const t=$('share-toast'),r=anchor.getBoundingClientRect();
    t.textContent=text;t.classList.toggle('bad',Boolean(bad));t.classList.add('show');
    const tw=t.offsetWidth||120,th=t.offsetHeight||32;
    let x=Math.max(8,Math.min(innerWidth-tw-8,r.left+r.width/2-tw/2)),y=r.top-th-8;
    if(y<8)y=Math.min(innerHeight-th-8,r.bottom+8);
    t.style.left=x+'px';t.style.top=y+'px';
    anchor.classList.toggle('copied',!bad);clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{t.classList.remove('show');anchor.classList.remove('copied');},1500);
  }
  dialog.addEventListener('close',()=>{$('share-toast').classList.remove('show');});
  const EMBED_HOST='https://derelictatlas.github.io/';
  function embedParams(){const g=plan&&plan.glyphs,gal=plan?parseInt(plan.address.slice(6,8),16)||0:0;const p=new URLSearchParams();p.set('glyphs',g);if(gal)p.set('galaxy',String(gal));return p.toString();}
  function embedCode(){
    const src=EMBED_HOST+'embed.html?'+embedParams().replace(/&/g,'&amp;');
    return '<iframe id="derelict-atlas" src="'+src+'" width="100%" height="420" style="border:0;max-width:640px" loading="lazy" title="Derelict Atlas"></iframe>\n<script>\naddEventListener("message", function (e) {\n  if (e.origin !== "https://derelictatlas.github.io") return;\n  var d = e.data;\n  if (d && d.type === "derelict-atlas:size") document.getElementById("derelict-atlas").style.height = d.height + "px";\n});\n<\/script>';
  }
  function embedUpdate(){
    if(!plan||!/^[0-9A-F]{12}$/.test(plan.glyphs))return;
    $('share-embed-code').value=embedCode();
    const want='embed.html?'+embedParams()+'&preview=1',f=$('share-embed-preview');
    f.dataset.want=want;if($('share-embed').open&&f.getAttribute('src')!==want)f.src=want;
  }
  $('share-embed').addEventListener('toggle',()=>{if($('share-embed').open)embedUpdate();});
  addEventListener('message',e=>{if(e.origin!==location.origin||!e.data||e.source!==$('share-embed-preview').contentWindow)return;if(e.data.type==='derelict-atlas:size')$('share-embed-preview').style.height=Math.max(120,e.data.height+4)+'px';});
  $('share-embed-copy').onclick=()=>{
    const t=$('share-embed-code'),b=$('share-embed-copy');t.select();
    const ok=()=>toast(b,'Copied!'),bad=()=>toast(b,'Could not copy',true);
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(t.value).then(ok,()=>{try{document.execCommand('copy')?ok():bad();}catch{bad();}});
    else{try{document.execCommand('copy')?ok():bad();}catch{bad();}}
  };
  function copy(text,btn){
    $('share-copy-field').value=text;
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>{toast(btn,'Copied!');}).catch(()=>{toast(btn,'Could not copy',true);$('share-copy-field').hidden=false;status('Select and copy the text below.');$('share-copy-field').focus();$('share-copy-field').select();});
    else{toast(btn,'Could not copy',true);$('share-copy-field').hidden=false;status('Select and copy the text below.');$('share-copy-field').focus();$('share-copy-field').select();}
  }
  $('share-copy-link').onclick=()=>copy(plan.url,$('share-copy-link'));$('share-copy-code').onclick=()=>copy(plan.glyphs,$('share-copy-code'));$('share-copy-text').onclick=()=>copy(plan.caption,$('share-copy-text'));
  $('share-save').onclick=()=>{if(!file||!previewUrl)return;const a=document.createElement('a'),url=URL.createObjectURL(file);a.href=url;a.download=plan.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Image saved or opened for download.');toast($('share-save'),'Saved!');};
  $('share-copy-image').onclick=()=>{if(!file)return;navigator.clipboard.write([new ClipboardItem({'image/png':file})]).then(()=>{toast($('share-copy-image'),'Copied!');}).catch(()=>{toast($('share-copy-image'),'Could not copy',true);status('Image copying was blocked. Use Save image instead.');});};
  $('share-native').onclick=()=>{
    if(!plan||!file||!navigator.share)return;
    const ticket=generation,payload=sharePayload(plan,file,navigator);$('share-native').disabled=true;
    // Call directly from this click: image creation has already completed.
    let task;try{task=navigator.share(payload);}catch(error){status('Device sharing is unavailable here. Save the image and copy the link.');$('share-native').disabled=false;onLog('Share: '+error.message);return;}
    Promise.resolve(task).then(()=>{if(ticket===generation){status('Passed to your sharing app.');toast($('share-native'),'Shared!');}}).catch(error=>{if(ticket!==generation)return;if(error.name==='AbortError')status('Sharing canceled.');else{status('Device sharing is unavailable here. Save the image and copy the link.');onLog('Share: '+error.message);}}).finally(()=>{if(ticket===generation)$('share-native').disabled=false;});
  };
  $('share-toggle-reward').onclick=()=>{const selection=getSelection();if(!selection)return;onRewardChange(!selection.showReward);return open(dialog.dataset.mode||'share');};
  $('share-views').querySelectorAll('[data-framing]').forEach(button=>button.onclick=()=>{onFramingChange(button.dataset.framing);return open(dialog.dataset.mode||'share');});
  async function open(mode='share'){
    const selection=getSelection();if(!selection)return;
    release();const ticket=generation,currentPlan=sharePlan(selection.row,selection.groups,selection.showReward,undefined,selection.layoutData);Object.assign(currentPlan,photoOptions(selection));plan=currentPlan;dialog.dataset.mode='share';
    const key=images.key(currentPlan,selection),cached=images.peek(key);dialog.dataset.imageCache=cached?'hit':images.has(key)?'pending':'miss';
    $('share-views').querySelectorAll('[data-framing]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.framing===(selection.framing||'photo'))));
    $('share-toggle-reward').textContent=selection.showReward?'Hide End Reward':'Show End Reward';$('share-toggle-reward').setAttribute('aria-pressed',String(selection.showReward));
    $('share-title').textContent='Photo & share';status('Preparing your image locally…');
    if(!dialog.open)$('share-copy-menu').open=mode==='copy';else if(mode==='copy')$('share-copy-menu').open=true;
    $('share-copy-field').hidden=true;
    $('share-copy-field').value=plan.url;embedUpdate();$('share-socials').innerHTML=socialDrafts(plan).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join('');
    $('share-local-note').textContent='Image generation happens entirely in your browser.'+(selection.imported?' Your imported file is not included in the link.':'');
    for(const id of ['share-save','share-copy-image','share-native'])$(id).disabled=true;
    if(!dialog.open)dialog.showModal();
    const copyBar=$('share-copy-menu');copyBar.classList.remove('copy-hint');if(mode==='copy'){copyBar.classList.add('copy-hint');copyBar.scrollIntoView({block:'nearest'});$('share-copy-link').focus();}
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
