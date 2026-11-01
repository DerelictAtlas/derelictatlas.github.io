// Translate each intact deck into a packed row. Never compress space within a deck.
export function layoutDecks(model,aspect=1){
  const levels=[...new Set(model.rooms.flatMap(r=>r.levels))].sort((a,b)=>b-a);
  const decks=levels.map(level=>{
    const cells=model.rooms.flatMap(r=>r.cells.filter(c=>c.y===level));
    const xs=cells.map(c=>12-c.x),zs=cells.map(c=>12-c.z);
    const minX=Math.min(...xs)-.4,minZ=Math.min(...zs)-.4;
    const maxX=Math.max(...xs)+1.4,maxZ=Math.max(...zs)+1.4;
    return {level,minX,minZ,width:maxX-minX,height:maxZ-minZ+1};
  });
  let best=null;
  for(let columns=Math.min(2,decks.length);columns<=decks.length;columns++){
    let x=0,y=.4,rowHeight=0,width=0;
    const placed=decks.map((d,i)=>{
      if(i&&i%columns===0){y+=rowHeight+1;x=0;rowHeight=0;}
      const result={...d,x:x+.4,y:y+1};x+=d.width+1;rowHeight=Math.max(rowHeight,d.height);width=Math.max(width,x-.6);return result;
    });
    const height=y+rowHeight+.4,score=Math.min(aspect/width,1/height);
    if(!best||score>best.score)best={decks:placed,width,height,score};
  }
  return best||{decks:[],width:1,height:1};
}
export function projectDeck(deck,u,v){return [deck.x+13-u-deck.minX,deck.y+13-v-deck.minZ];}
