// The crouching place is behind the rear reading table. The actual delivered
// table conceals the head and shoulders from the doorway and both front corners;
// the open-ended center display does not provide that cover.
export const SHOP_HIDE_POSITION=Object.freeze([0,.82,-6.35]);

// The interior collision map deliberately ends at the shop. After its verified
// threshold route, append the separately verified open-door/sidewalk segment.
// Rebuild cumulative distance so sampleRoomPath uses one continuous journey.
export function appendPath(path,...positions){
  if(!path?.points?.length)throw new TypeError('A route needs at least one position.');
  const points=[...path.points,...positions].map(point=>{
    if(!point||point.length!==3||!Array.from(point).every(Number.isFinite))throw new TypeError('A route position needs three finite coordinates.');
    return Array.from(point);
  });
  const lengths=[0];
  for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(...points[i].map((value,axis)=>value-points[i-1][axis])));
  return {points,lengths,length:lengths.at(-1)};
}
