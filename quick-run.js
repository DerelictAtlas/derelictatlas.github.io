// Eighth-tile navigation; independent of visibility layers and renderers.
const S=8,INF=1e15,cache=new WeakMap();
const key=(x,y,z)=>`${x},${y},${z}`;
class Heap{
  a=[];
  push(id,cost){const v={id,cost},a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].cost<=cost)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.a,out=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].cost<a[c].cost)c++;if(a[c].cost>=v.cost)break;a[i]=a[c];i=c;}a[i]=v;}return out;}
}
function crosses(a,b,r){
  // Liang–Barsky slab intersection, including a small walking clearance.
  let lo=0,hi=1;
  for(const [v,d,min,max] of [[a.u,b.u-a.u,r.u0-.02,r.u1+.02],[a.v,b.v-a.v,r.v0-.02,r.v1+.02]]){
    if(Math.abs(d)<1e-9){if(v<min||v>max)return false;}
    else{let t0=(min-v)/d,t1=(max-v)/d;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi)return false;}
  }
  return true;
}
export function navigationGraph(model){
  if(cache.has(model))return cache.get(model);
  const cells=new Map(),buckets=new Map(),nodes=[],lookup=new Map(),doors=new Set();
  for(const room of model.rooms)for(const c of room.cells)cells.set(key(c.x,c.y,c.z),room.room_index);
  for(const d of model.doors||[]){const a=key(d.a.x,d.level,d.a.z),b=key(d.b.x,d.level,d.b.z);doors.add(a+'|'+b);doors.add(b+'|'+a);}
  const containers=[...(model.containers||[]),...(model.extras||[])].map(c=>({u0:c.g.u-.08,u1:c.g.u+.08,v0:c.g.v-.08,v1:c.g.v+.08,level:c.g.level}));
  const ships=(model.ships||[]).map(ship=>{
    const xs=[],zs=[],A=ship.axes,t=ship.t,e=model.e;
    for(const x of [ship.box[0],ship.box[3]])for(const z of [ship.box[2],ship.box[5]]){xs.push((x*A[0][0]+z*A[2][0]+t[0])/8+e[0]+.5);zs.push((x*A[0][2]+z*A[2][2]+t[2])/8+e[2]+.5);}
    return {u0:Math.min(...xs),u1:Math.max(...xs),v0:Math.min(...zs),v1:Math.max(...zs),level:ship.level};
  });
  for(const r of [...(model.walls||[]),...(model.fixtures||[]),...containers,...ships]){
    if(![r.u0,r.u1,r.v0,r.v1,r.level].every(Number.isFinite))continue;
    for(let x=Math.floor(r.u0-.05);x<=Math.floor(r.u1+.05);x++)for(let z=Math.floor(r.v0-.05);z<=Math.floor(r.v1+.05);z++){
      const k=key(x,r.level,z);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);
    }
  }
  const blocked=(a,b)=>{
    const rs=new Set([...(buckets.get(key(Math.floor(a.u),a.level,Math.floor(a.v)))||[]),...(buckets.get(key(Math.floor(b.u),b.level,Math.floor(b.v)))||[])]);
    return [...rs].some(r=>crosses(a,b,r));
  };
  for(const [cell,room] of cells){const [x,level,z]=cell.split(',').map(Number);
    for(let i=0;i<S;i++)for(let j=0;j<S;j++){
      const p={u:x+(i+.5)/S,v:z+(j+.5)/S,level,room,cell};
      if(blocked(p,p))continue;
      const id=nodes.length;nodes.push({...p,id,edges:[]});lookup.set(key(x*S+i,level,z*S+j),id);
    }
  }
  for(const a of nodes){const x=Math.floor(a.u*S),z=Math.floor(a.v*S);
    for(const [dx,dz] of [[1,0],[0,1]]){
      const id=lookup.get(key(x+dx,a.level,z+dz));if(id==null)continue;const b=nodes[id];
      if(a.room!==b.room&&!doors.has(a.cell+'|'+b.cell)||blocked(a,b))continue;
      a.edges.push([id,1]);b.edges.push([a.id,1]);
    }
  }
  const nearest=(u,v,level,room,allowed,max=1.5)=>{
    let best=null,dist=max*max;
    for(const n of nodes){if(n.level!==level||room!=null&&n.room!==room||allowed&&!allowed.has(n.id))continue;
      const d=(n.u-u)**2+(n.v-v)**2;if(d<dist){dist=d;best=n;}
    }return best;
  };
  for(const link of model.links||[])for(const c of link.cells){
    const within=new Set(nodes.filter(n=>Math.floor(n.u)===c.x&&Math.floor(n.v)===c.z).map(n=>n.id));
    const a=nearest(c.x+.7,c.z+.75,link.upper,link.room,within,.8),b=nearest(c.x+.7,c.z+.75,link.lower,link.room,within,.8);
    if(a&&b){a.edges.push([b.id,S]);b.edges.push([a.id,S]);}
  }
  const start=nearest(model.e[0]+.5,model.e[2]+.5,model.e[1],null,null,1.5);
  const reachable=new Set(),stack=start?[start.id]:[];
  while(stack.length){const id=stack.pop();if(reachable.has(id))continue;reachable.add(id);for(const [n] of nodes[id].edges)if(!reachable.has(n))stack.push(n);}
  const result={nodes,start,reachable,nearest};cache.set(model,result);return result;
}
function shortest(graph,from){
  const distances=new Float64Array(graph.nodes.length).fill(INF),parents=new Int32Array(graph.nodes.length).fill(-1),heap=new Heap();distances[from]=0;heap.push(from,0);
  while(heap.a.length){const {id,cost}=heap.pop();if(cost!==distances[id])continue;
    for(const [next,w] of graph.nodes[id].edges)if(cost+w<distances[next]){distances[next]=cost+w;parents[next]=id;heap.push(next,cost+w);}
  }return {distances,parents};
}
function visitOrder(matrix,endDistances){
  const n=matrix.length-1;if(!n)return {order:[],exact:true};
  if(n>12){
    const left=new Set(Array.from({length:n},(_,i)=>i)),order=[];let from=0;
    while(left.size){const next=[...left].sort((a,b)=>matrix[from][a+1]-matrix[from][b+1]||a-b)[0];order.push(next);left.delete(next);from=next+1;}
    // Bounded 2-opt refinement; explicitly approximate for large target sets.
    const cost=o=>o.reduce((v,id,i)=>v+matrix[i?o[i-1]+1:0][id+1],0)+(endDistances?endDistances[o.at(-1)+1]:0);
    for(let pass=0;pass<3;pass++){let changed=false;
      for(let i=0;i<n-1;i++)for(let j=i+1;j<n;j++){const candidate=[...order.slice(0,i),...order.slice(i,j+1).reverse(),...order.slice(j+1)];if(cost(candidate)<cost(order)){order.splice(0,n,...candidate);changed=true;}}
      if(!changed)break;
    }return {order,exact:false};
  }
  const size=1<<n,dp=new Float64Array(size*n).fill(INF),parents=new Int8Array(size*n).fill(-1);
  for(let i=0;i<n;i++)dp[(1<<i)*n+i]=matrix[0][i+1];
  for(let mask=1;mask<size;mask++)for(let last=0;last<n;last++){
    const at=mask*n+last;if(dp[at]===INF)continue;
    for(let next=0;next<n;next++)if(!(mask&(1<<next))){const target=(mask|(1<<next))*n+next,cost=dp[at]+matrix[last+1][next+1];if(cost<dp[target]){dp[target]=cost;parents[target]=last;}}
  }
  let last=0;for(let i=1;i<n;i++)if(dp[(size-1)*n+i]+(endDistances?.[i+1]||0)<dp[(size-1)*n+last]+(endDistances?.[last+1]||0))last=i;
  const order=[];let mask=size-1;while(mask){order.push(last);const previous=parents[mask*n+last];mask^=1<<last;last=previous;}return {order:order.reverse(),exact:true};
}
// SITE integration (user 2026-10-31): loot targets from per-container loot {cv,xv} (views/top100-loot.json, W30; later
// browser scans, W29g result.loot): [units[], nanites[]] per list, cv = model.containers, xv = model.extras. Highest first,
// zeros skipped, until the picked containers hold 80 % of the system's total or 16 containers, whichever comes first.
function lootTargets(model,loot,mode){
  const k=mode==='nanites'?1:0,all=[];
  (loot?.cv?.[k]||[]).forEach((v,i)=>{if(v>0&&model.containers?.[i])all.push({c:model.containers[i],key:'c'+i,value:v});});
  (loot?.xv?.[k]||[]).forEach((v,i)=>{if(v>0&&model.extras?.[i])all.push({c:model.extras[i],key:'x'+i,value:v});});
  const total=all.reduce((s,t)=>s+t.value,0),items=[];let sum=0;all.sort((a,b)=>b.value-a.value||(a.key<b.key?-1:1));
  for(const t of all){if(items.length>=16||sum>=.8*total)break;items.push(t);sum+=t.value;}
  const f=n=>Math.round(n).toLocaleString('en-US'),unit=k?'nanites':'units';
  return {items,sum,total,summary:`${items.length} container${items.length===1?'':'s'} · ${f(sum)} of ${f(total)} ${unit} (${total?Math.round(sum/total*100):0} %)`};
}
export function planQuickRun(model,{moduleIds=new Set(),possibleIds=new Set(),includePossible=false,finishAtEnd=false,mode='modules',loot=null}={}){
  if(mode!=='modules'&&!loot)return {status:'unavailable',reason:mode==='nanites'?'Nanites after refining need scanned loot contents, quantities and verified refining yields.':'Most valuable loot needs published loot values and a value policy.',stops:[],legs:[]};
  const graph=navigationGraph(model),targets=[],unreachable=[],invalid=[];
  if(!graph.start)return {status:'unavailable',reason:'No mapped entrance approach could be found.',stops:[],legs:[]};
  const pick=mode!=='modules'?lootTargets(model,loot,mode):null;
  const wanted=pick?pick.items:new Set([...moduleIds,...(includePossible?possibleIds:[])]);
  for(const want of wanted){const id=pick?want.key:want;
    const c=pick?want.c:Number.isInteger(id)?model.containers[id]:null;if(!c){invalid.push(id);continue;}
    const node=graph.nearest(c.g.u,c.g.v,c.g.level,c.room_index,graph.reachable,.9);
    const target={id,kind:c.container_kind,room:c.room_index,u:c.g.u,v:c.g.v,level:c.g.level,possible:pick?false:!moduleIds.has(id),...(pick?{value:want.value}:{})};
    if(!node){unreachable.push(target);continue;}
    const same=targets.find(t=>t.node.id===node.id);if(same)same.targets.push(target);else targets.push({node,targets:[target]});
  }
  let end=null;
  if(finishAtEnd){
    const room=model.rooms.find(r=>r.template_name==='R_END');
    if(room){const c=room.cells[0];end=graph.nearest(c.x+.5,c.z+.5,c.y,room.room_index,graph.reachable,100);}
    if(!end)unreachable.push({kind:'end_room',room:room?.room_index});
  }
  if(!targets.length&&!end)return {status:'empty',reason:pick?(pick.items.length?'No reachable loot containers were found.':'No loot in the containers of this map.'):wanted.size?'No reachable module approaches were found.':'No published module locations for this map.',stops:[],legs:[],unreachable,invalid};
  const origins=[graph.start,...targets.map(t=>t.node)],trees=origins.map(n=>shortest(graph,n.id)),matrix=trees.map(t=>origins.map(n=>t.distances[n.id]));
  const {order,exact}=visitOrder(matrix,end?trees.map(t=>t.distances[end.id]):null),stops=order.map(i=>({...targets[i].node,targets:targets[i].targets,origin:i+1}));
  if(end)stops.push({...end,targets:[{kind:'end_room',room:end.room}],origin:null});
  const legs=[];let from=0,total=0;
  for(const stop of stops){const tree=trees[from],path=[];let at=stop.id;
    while(at!==-1){path.push(graph.nodes[at]);if(at===origins[from].id)break;at=tree.parents[at];}
    path.reverse();const cost=tree.distances[stop.id]/S;legs.push({points:path.map(({u,v,level})=>({u,v,level})),cost});total+=cost;from=stop.origin;
  }
  return {status:'ready',exact,stops,legs,total,unreachable,invalid,...(pick?{loot:mode,lootSummary:pick.summary}:{}),modules:targets.reduce((n,t)=>n+t.targets.length,0),nodeCount:graph.nodes.length,ladderClimbs:legs.reduce((n,l)=>n+l.points.filter((p,i)=>i&&p.level!==l.points[i-1].level).length,0)};
}
