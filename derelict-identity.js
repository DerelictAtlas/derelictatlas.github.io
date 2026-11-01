// Recorded freighter identity is separate from the original procedural system name.
// Populate derelict_name in the atlas CSV or in an original derelict.json scan.
export function derelictName(row={},layout={}){
  for(const source of [row,layout])for(const key of ['derelict_name','derelictName','freighter_name','freighterName']){
    const value=source?.[key];if(typeof value==='string'&&value.trim())return value.trim();
  }
  return '';
}
