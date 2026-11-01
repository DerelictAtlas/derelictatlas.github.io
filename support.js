// Set only to a public support-page URL supplied by the recipient/owner.
// An empty URL keeps the entire support card hidden; never guess a handle.
export const SUPPORT_URL='';
export function supportDestination(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{const url=new URL(value.trim());return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function mountSupport(section,link,url=SUPPORT_URL){
  const destination=supportDestination(url);
  section.hidden=!destination;
  if(!destination){link.removeAttribute('href');return false;}
  link.href=destination;link.target='_blank';link.rel='noopener noreferrer';return true;
}
