// The center shelf stays solid while the visitor chooses another part of the room.
// Extra clearance includes the small walking sway applied by the camera.
export const CENTER_SHELF = Object.freeze({ minX: -.38, maxX: .38, minZ: -.5, maxZ: 3.5 });
export const WALK_CLEARANCE = .32;
export const ROOM_POSES = Object.freeze({
  entrance: [[0, 1.6, 6.6], [0, 1.25, -5.4]],
  aisle: [[1.05, 1.6, 4.5], [0, .9, 1]],
  table: [[.35, 1.82, -3.48], [0, 1.06, -4.92]],
  shelves: [[1.05, 1.55, .6], [2.01, 1.18, -.82]],
  chair: [[-1.05, 1.5, 1], [-2.17, 1, -.1]],
  leave: [[0, 1.6, 6.6], [0, 1.35, -3]],
});

const EPSILON = 1e-10;
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

function position(value) {
  if (!value || value.length !== 3 || !Array.from(value).every(Number.isFinite)) {
    throw new TypeError('A walking position must contain three finite coordinates.');
  }
  return Array.from(value);
}

function bounds(clearance) {
  if (!Number.isFinite(clearance) || clearance < 0) throw new RangeError('Walking clearance must be nonnegative.');
  return { minX: CENTER_SHELF.minX - clearance, maxX: CENTER_SHELF.maxX + clearance,
    minZ: CENTER_SHELF.minZ - clearance, maxZ: CENTER_SHELF.maxZ + clearance };
}

function inside(point, box) {
  return point[0] > box.minX + EPSILON && point[0] < box.maxX - EPSILON &&
    point[2] > box.minZ + EPSILON && point[2] < box.maxZ - EPSILON;
}

// Intersect the segment's parameter intervals with the rectangle's open interior.
// Touching a corner or following an inflated edge is safe; cutting across is not.
function crosses(a, b, box) {
  let enter = 0, leave = 1;
  for (const [axis, low, high] of [[0, box.minX, box.maxX], [2, box.minZ, box.maxZ]]) {
    const change = b[axis] - a[axis];
    if (Math.abs(change) < EPSILON) {
      if (a[axis] <= low + EPSILON || a[axis] >= high - EPSILON) return false;
    } else {
      const first = (low - a[axis]) / change, second = (high - a[axis]) / change;
      enter = Math.max(enter, Math.min(first, second));
      leave = Math.min(leave, Math.max(first, second));
      if (leave - enter <= EPSILON) return false;
    }
  }
  return leave - enter > EPSILON;
}

export function planRoomPath(from, to, { clearance = WALK_CLEARANCE } = {}) {
  const start = position(from), end = position(to), box = bounds(clearance);
  if (inside(start, box) || inside(end, box)) {
    throw new RangeError('A walking destination is inside the center shelf clearance.');
  }
  const vertices = [start, end,
    [box.minX, 0, box.minZ], [box.maxX, 0, box.minZ],
    [box.maxX, 0, box.maxZ], [box.minX, 0, box.maxZ]];
  const costs = vertices.map(() => Infinity), previous = vertices.map(() => -1), visited = new Set();
  costs[0] = 0;
  // A shortest path around a rectangle can only turn at its corners. Dijkstra
  // on this visibility graph finds the shorter side for every pair of stops.
  while (visited.size < vertices.length) {
    let next = -1;
    for (let i = 0; i < vertices.length; i++) {
      if (!visited.has(i) && (next < 0 || costs[i] < costs[next])) next = i;
    }
    if (next < 0 || !Number.isFinite(costs[next])) throw new Error('No clear walking route is available.');
    if (next === 1) break;
    visited.add(next);
    for (let i = 0; i < vertices.length; i++) {
      if (visited.has(i) || crosses(vertices[next], vertices[i], box)) continue;
      const candidate = costs[next] + Math.hypot(vertices[i][0] - vertices[next][0], vertices[i][2] - vertices[next][2]);
      if (candidate < costs[i]) { costs[i] = candidate; previous[i] = next; }
    }
  }
  const indices = [1];
  while (indices[0] !== 0) indices.unshift(previous[indices[0]]);
  let horizontal = 0;
  const points = indices.map((index, i) => {
    const point = vertices[index].slice();
    if (i) horizontal += Math.hypot(point[0] - vertices[indices[i - 1]][0], point[2] - vertices[indices[i - 1]][2]);
    point[1] = costs[1] > EPSILON ? start[1] + (end[1] - start[1]) * horizontal / costs[1] : end[1];
    return point;
  });
  points[0] = start;
  points[points.length - 1] = end;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
  return { points, lengths, length: lengths.at(-1) };
}

// Progress is measured along the complete route, so corners do not restart
// easing or footsteps. Interruption can plan a new route from this exact point.
export function sampleRoomPath(path, progress, target = [0, 0, 0]) {
  if (!Number.isFinite(progress)) throw new TypeError('Walking progress must be finite.');
  const p = Math.max(0, Math.min(1, progress)), travelled = path.length * p;
  if (p === 1 || path.length === 0) {
    const end = path.points.at(-1);
    for (let axis = 0; axis < 3; axis++) target[axis] = end[axis];
    return target;
  }
  let segment = 1;
  while (segment < path.lengths.length - 1 && travelled > path.lengths[segment]) segment++;
  const start = path.points[segment - 1], end = path.points[segment];
  const span = path.lengths[segment] - path.lengths[segment - 1];
  const fraction = span > 0 ? (travelled - path.lengths[segment - 1]) / span : 0;
  for (let axis = 0; axis < 3; axis++) target[axis] = start[axis] + (end[axis] - start[axis]) * fraction;
  return target;
}
