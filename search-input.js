// Portal input and chooser share the same bound: never clear or wrap at glyph 13.
export function searchInput(value,format='glyphs'){
  if(format==='auto'){const text=String(value).slice(0,80);return /^[0-9a-f]+$/i.test(text)&&text.length<=16?text.toUpperCase():text;}
  if(format==='text')return String(value).slice(0,80);
  return String(value).toUpperCase().replace(/[^0-9A-F]/g,'').slice(0,format==='address'?16:12);
}
export function appendGlyph(value,glyph){
  const current=searchInput(value);
  return current.length>=12||!/^[0-9A-F]$/i.test(glyph)?current:searchInput(current+glyph);
}

export function detectSearchFormat(value){
  const text=String(value).trim().replace(/[\s-]/g,'');
  return /^[0-9a-f]*$/i.test(text)&&text.length<=16?text.length>12?'address':'glyphs':'text';
}
