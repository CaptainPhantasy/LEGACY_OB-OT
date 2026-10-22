// The original shop is merged by material, not by prop. Match a real struck
// surface using both its material and the small assembly's world-space bounds.
// Never turn an empty hotspot box, a wall, or an intervening shelf into a hit.
const paper = /^(Antique paper|Centuries of foxing in rag paper|Book cloth \d+)/;
const bottleParts = /^(Dusty bottle \d+|Antique paper|Walnut • patina 02)/;
const bottlePositions = [
  [-2.73,.50,.0584,1.523],[-2.73,.15,.0544,1.5648],[-2.44,.52,.065,1.5752],
  [-2.43,1.90,.0399,1.5434],[-2.43,1.55,.0587,1.5986],[-2.43,1.20,.0428,1.5722],
  [-2.43,.85,.0595,1.6203],[-2.43,-.20,.0496,1.5399],[-2.34,.10,.065,1.6114],
  [-2.20,.35,.065,1.6926],[-2.01,.10,.065,1.6294],[-1.95,.52,.065,1.5482],
  [2.43,1.90,.0494,1.5355],[2.43,1.55,.0587,1.503],[2.43,1.20,.0588,1.4988],
  [2.43,.85,.0543,1.5026],[2.43,.50,.0399,1.546],[2.43,.15,.0434,1.549],
  [2.43,-.20,.0395,1.5388],
];

export const WALL_CURIOSITY_TARGETS = [
  {id:'maps',bounds:[[1.30,.823,1.15],[1.98,.87,1.82]],materials:/^Centuries of foxing in rag paper/},
  ...bottlePositions.map(([x,z,r,top])=>({id:'bottles',
    bounds:[[x-r-.004,1.3003,z-r-.004],[x+r+.004,top,z+r+.004]],materials:bottleParts})),
  {id:'sounds',bounds:[[1.25,.885,4.25],[2.15,1.97,5.02]],materials:/^(Copper green patina|Old ebony joinery|Walnut • patina|Oxidized bronze)/},
  {id:'sky',bounds:[[1.745,.835,-1.09],[2.275,1.445,-.55]],materials:/^(Dust-darkened globe|Oxidized bronze|Walnut • patina 01)/},
  {id:'paper',bounds:[[-2.20,.692,3.08],[-1.48,.91,3.88]],materials:paper},
  {id:'time',bounds:[[.98,1.38,-2.585],[1.39,1.81,-2.49]],materials:/^(Oxidized bronze|Rusted iron|Stained hemp rope)/},
];

export function wallCuriosityAtHit(items, hit) {
  const point=hit?.point,object=hit?.object;
  if(!object?.isMesh||!point||![point.x,point.y,point.z].every(Number.isFinite))return null;
  let belongsToRoom=false;
  for(let node=object;node;node=node.parent){
    if(node.visible===false)return null;
    if(node.name==='OldCuriosityShop'||node.name==='CenterCuriosityShelf')belongsToRoom=true;
    if(node.name==='BookCoverHinge')return null;
  }
  if(!belongsToRoom)return null;
  const material=Array.isArray(object.material)?object.material[hit.face?.materialIndex??0]:object.material;
  if(!material||material.visible===false)return null;
  const coordinates=[point.x,point.y,point.z];
  const target=WALL_CURIOSITY_TARGETS.find(({bounds,materials})=>materials.test(material.name||'')&&
    coordinates.every((value,axis)=>value>=bounds[0][axis]&&value<=bounds[1][axis]));
  return target?items.find(item=>!item.shelf&&item.id===target.id)||null:null;
}
