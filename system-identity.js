// Upstream integration: publish the calculated name in the optional system_name CSV column.
// The literal placeholder is intentional; never generate or guess a system name here.
export const SYSTEM_NAME_HELP='Original procedural name. Players can rename systems in-game, so the calculated original name may differ from the name shown in their game.';
export function systemIdentity(row={}){
  const name=[row.system_name,row.systemName,row.name].find(value=>typeof value==='string'&&value.trim())?.trim()||(typeof globalThis.dvSystemName==='function'&&row.address?globalThis.dvSystemName(row.address):'')||'system_name';  // SITE integration: computed name (names.js) when the published row has none
  const galaxy=row.galaxy===0?'Euclid':Number.isInteger(row.galaxy)&&row.galaxy>=0?'Galaxy '+(row.galaxy+1):'Galaxy unknown';
  return {name,galaxy,label:name+' - '+galaxy};
}
