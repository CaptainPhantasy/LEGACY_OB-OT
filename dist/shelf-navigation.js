// Shared by pointer selection, accessible controls, and the geometric QA checks.
// A visitor moves bay by bay, inspecting the upper and lower objects in turn.
export function shelfNavigation(items, id) {
  const current = items.find(item => item.shelf && item.id === id);
  if (!current) return null;
  const side = items.filter(item => item.shelf && item.side === current.side)
    .sort((a, b) => a.bay - b.bay || b.tier - a.tier);
  const index = side.findIndex(item => item.id === id);
  const opposite = items.find(item => item.shelf && item.side === -current.side &&
    item.bay === current.bay && item.tier === current.tier);
  return { previous: side[index - 1] || null, next: side[index + 1] || null,
    opposite: opposite || null, index, count: side.length, side: current.side };
}

function contains(bounds, point, tolerance = .003) {
  return Array.isArray(bounds) && bounds.length === 2 && point.every((value, axis) =>
    value >= bounds[0][axis] - tolerance && value <= bounds[1][axis] + tolerance);
}

// The caller supplies the closest *real scene surface* struck by the pointer.
// Empty air, intervening furniture, and objects on the far face cannot be picked.
export function shelfItemAtHit(items, point, cameraX) {
  if (!point?.every(Number.isFinite) || !Number.isFinite(cameraX)) return null;
  return items.find(item => item.shelf && cameraX * item.side > .52 &&
    (contains(item.pickBounds, point) || contains(item.labelBounds, point))) || null;
}

// Shift the optical center above the inspection card. Fit the real assembly
// bounds on narrow screens without moving the camera into either aisle's props.
export function shelfFraming(item, { width, height, top = 112, bottom = height - 300, left = 20, right = width - 20 }) {
  const baseFov = width < 600 ? 58 : 52;
  const safeTop = Math.max(0, Math.min(top, height - 1));
  const safeBottom = Math.max(safeTop + 1, Math.min(bottom, height));
  // The compact website tag is at the physical plaque; reserve its lower half.
  const fittingBottom = Math.max(safeTop + 1, safeBottom - (item.labelBounds ? 24 : 0));
  const centerY = (safeTop + fittingBottom) / 2;
  const centerX = (left + right) / 2;
  let tangent = Math.tan(baseFov * Math.PI / 360), middleX = 0, middleY = 0;
  if (item.pickBounds) {
    const [eye, target] = item.pose;
    const forward = target.map((value, axis) => value - eye[axis]);
    const length = Math.hypot(...forward);
    for (let axis = 0; axis < 3; axis++) forward[axis] /= length;
    const horizontal = Math.hypot(forward[0], forward[2]);
    const rightVector = [-forward[2] / horizontal, 0, forward[0] / horizontal];
    const up = [rightVector[1] * forward[2] - rightVector[2] * forward[1],
      rightVector[2] * forward[0] - rightVector[0] * forward[2],
      rightVector[0] * forward[1] - rightVector[1] * forward[0]];
    const aspect = width / height;
    const verticalFraction = Math.max(.01, (fittingBottom - safeTop) / height);
    const horizontalFraction = Math.max(.01, (right - left) / width);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    // Include the actual plaque, not only the miniature, in the fitted view.
    for (const bounds of [item.pickBounds, item.labelBounds].filter(Boolean)) for (let corner = 0; corner < 8; corner++) {
      const point = [0, 1, 2].map(axis => bounds[(corner >> axis) & 1][axis] - eye[axis]);
      const depth = point.reduce((sum, value, axis) => sum + value * forward[axis], 0);
      if (depth <= .01) continue;
      const x = point.reduce((sum, value, axis) => sum + value * rightVector[axis], 0) / depth;
      const y = point.reduce((sum, value, axis) => sum + value * up[axis], 0) / depth;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
    if(Number.isFinite(minX)){
      middleX=(minX+maxX)/2;middleY=(minY+maxY)/2;
      tangent=Math.max(tangent,(maxX-minX)*.56/(aspect*horizontalFraction),(maxY-minY)*.56/verticalFraction);
    }
  }
  const fov = Math.min(135, 2 * Math.atan(tangent) * 180 / Math.PI);
  const pixelsPerSlope = height / (2 * Math.tan(fov * Math.PI / 360));
  return { fov, offsetX: width / 2 - centerX + middleX * pixelsPerSlope,
    offsetY: height / 2 - centerY - middleY * pixelsPerSlope, top: safeTop, bottom: safeBottom, left, right };
}
