export const REWARD_TYPES={hyperdrive:'Hyperdrive',fuel:'Fleet fuel',speed:'Fleet speed / beacon',combat:'Fleet combat',exploration:'Fleet exploration',mining:'Fleet mining',trade:'Fleet trade',reactor:'Freighter reactor'};
export function rewardType(name=''){
  for(const [type,pattern] of [['hyperdrive',/hyperdrive/i],['fuel',/fuel/i],['speed',/beacon|expedition speed|coordinator/i],['combat',/combat|battle/i],['exploration',/explor|scientific|biological/i],['mining',/mining|industrial|geo.scanner/i],['trade',/trade|economy/i],['reactor',/reactor/i]])if(pattern.test(name))return type;
  return 'unknown';
}
export function matchesReward(row,moduleType,cls){
  if(!moduleType&&!cls)return true;
  const candidates=[{name:row.reward_name,cls:row.reward_class}];
  if(row.reward_ambiguous)for(const name of (row.reward_alt||'').split('|'))candidates.push({name,cls:name.trim().match(/ ([CBAS])$/)?.[1]});
  return candidates.some(candidate=>(!moduleType||rewardType(candidate.name)===moduleType)&&(!cls||candidate.cls===cls));
}
