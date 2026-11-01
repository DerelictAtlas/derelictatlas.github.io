import {known,totalOf} from './core.js';
export const MODULE_HELP="Predicted from salvage crates and crew footlockers. ? means at least one container’s prediction is ambiguous; yellow map markers are predicted modules, orange dashed markers are possible modules.";
export function totalHelp(row,groups){
  const counts=[...(groups.frigate?[['salvage_crates','salvage crates'],['footlockers','crew footlockers']]:[]),...(groups.briefcases?[['briefcases','briefcases']]:[]),...(groups.tall?[['tall_lockers','tall lockers']]:[])];
  const breakdown=counts.map(([key,name])=>`${name}: ${row[key]==null?'not computed':known(row[key])}`).join('; ');
  return `Total loot containers: ${totalOf(row,groups).text}. ${breakdown||'No container groups selected'}. “+” means a lower bound because some counts are unknown; “—” means not computed. Salvaged Frigate Modules and the end reward are separate from this total.`;
}
