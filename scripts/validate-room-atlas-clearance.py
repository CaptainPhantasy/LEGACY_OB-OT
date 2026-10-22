"""Read-only Blender proof of allocated lightmap tiles versus protected UV edges."""
import argparse
import json
from pathlib import Path
import sys

import bpy
import numpy as np


def dilate_square(mask, pixels):
    horizontal = mask.copy()
    for distance in range(1, pixels + 1):
        horizontal[:, distance:] |= mask[:, :-distance]
        horizontal[:, :-distance] |= mask[:, distance:]
    expanded = horizontal.copy()
    for distance in range(1, pixels + 1):
        expanded[distance:, :] |= horizontal[:-distance, :]
        expanded[:-distance, :] |= horizontal[distance:, :]
    return expanded


def conservative_uv_edge_mask(mesh, values, excluded_faces, resolution):
    """Cover every protected edge, including thin faces with no interior samples.

    Half-pixel samples plus a one-pixel expansion conservatively cover every
    touched pixel, even when a segment passes arbitrarily close to a pixel corner.
    """
    mesh.calc_loop_triangles()
    loops = np.asarray([tuple(triangle.loops) for triangle in mesh.loop_triangles
                        if triangle.polygon_index not in excluded_faces], dtype=np.int32)
    vertices = values[loops].astype(np.float64) * resolution
    if not np.isfinite(vertices).all() or (vertices < 0).any() or (vertices > resolution).any():
        raise RuntimeError('Protected UV edges are not finite and bounded')
    starts = vertices.reshape(-1, 2)
    ends = vertices[:, [1, 2, 0], :].reshape(-1, 2)
    mask = np.zeros((resolution, resolution), dtype=bool)
    sample_count = 0
    for first in range(0, len(starts), 2048):
        a = starts[first:first + 2048]
        delta = ends[first:first + 2048] - a
        steps = np.maximum(1, np.ceil(np.abs(delta).max(axis=1) * 2).astype(np.int64))
        counts = steps + 1
        edge = np.repeat(np.arange(len(a)), counts)
        offsets = np.cumsum(counts) - counts
        t = (np.arange(int(counts.sum())) - np.repeat(offsets, counts)) / steps[edge]
        pixels = np.floor(a[edge] + delta[edge] * t[:, None]).astype(np.int32)
        pixels = np.clip(pixels, 0, resolution - 1)
        mask[pixels[:, 1], pixels[:, 0]] = True
        sample_count += len(pixels)
    return dilate_square(mask, 1), {'protected_triangles': len(loops), 'edge_samples': sample_count,
                                  'conservative_edge_pixels': int(mask.sum()), 'sampling_guard_pixels': 1}


def cross2(a, b):
    return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]


def point_segment_distance_squared(point, start, end):
    delta = end - start
    denominator = np.sum(delta * delta, axis=-1)
    numerator, denominator = np.broadcast_arrays(np.sum((point - start) * delta, axis=-1), denominator)
    factor = np.divide(numerator, denominator, out=np.zeros_like(numerator), where=denominator > 0)
    closest = start + np.clip(factor, 0, 1)[..., None] * delta
    return np.sum((point - closest) ** 2, axis=-1)


def triangle_distances_squared(target, triangles):
    """Exact 2D triangle distances using endpoint projections, crossings and containment."""
    starts, ends = triangles, triangles[:, [1, 2, 0], :]
    result = np.full(len(triangles), np.inf)
    for vertex in target:
        result = np.minimum(result, point_segment_distance_squared(vertex, starts, ends).min(axis=1))
        signed = cross2(ends - starts, vertex - starts)
        nondegenerate = np.abs(cross2(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])) > 1e-12
        inside = ((signed >= -1e-10).all(axis=1) | (signed <= 1e-10).all(axis=1)) & nondegenerate
        result[inside] = 0
    for index in range(3):
        a, b = target[index], target[(index + 1) % 3]
        result = np.minimum(result, point_segment_distance_squared(triangles, a, b).min(axis=1))
        r, s, offset = b - a, ends - starts, starts - a
        denominator = cross2(r, s)
        valid = np.abs(denominator) > 1e-12
        t = np.divide(cross2(offset, s), denominator, out=np.zeros_like(denominator), where=valid)
        u = np.divide(cross2(offset, r), denominator, out=np.zeros_like(denominator), where=valid)
        crossing = valid & (t >= 0) & (t <= 1) & (u >= 0) & (u <= 1)
        result[crossing.any(axis=1)] = 0
    target_edges = target[[1, 2, 0]] - target
    signed = cross2(target_edges[None, None, :, :], triangles[:, :, None, :] - target[None, None, :, :])
    inside_target = (signed >= -1e-10).all(axis=2) | (signed <= 1e-10).all(axis=2)
    result[inside_target.any(axis=1)] = 0
    return result


def refine_clearance(mesh, values, targets, previous, resolution):
    mesh.calc_loop_triangles()
    protected = [triangle for triangle in mesh.loop_triangles if triangle.polygon_index not in targets]
    loops = np.asarray([tuple(triangle.loops) for triangle in protected], dtype=np.int32)
    triangles = values[loops].astype(np.float64) * resolution
    low, high = triangles.min(axis=1), triangles.max(axis=1)
    details = []
    for face_index in previous['all_colliding_faces']:
        face = mesh.polygons[face_index]
        target = values[list(face.loop_indices)].astype(np.float64) * resolution
        # Any pair closer than 16px must have bounding boxes within that radius.
        # AABB distance is a lower bound, so rejecting farther boxes is exact.
        gap = np.maximum(np.maximum(low - target.max(axis=0), target.min(axis=0) - high), 0)
        candidates = np.flatnonzero(np.sum(gap * gap, axis=1) <= 16 ** 2)
        detail = {'face': face_index, 'candidate_triangles': len(candidates)}
        if len(candidates):
            distances = triangle_distances_squared(target, triangles[candidates])
            nearest = int(np.argmin(distances))
            distance = float(np.sqrt(max(0, distances[nearest])))
            other = protected[int(candidates[nearest])]
            detail.update(minimum_distance_pixels=distance, protected_face=other.polygon_index,
                          protected_material=mesh.materials[other.material_index].name,
                          target_triangle_pixels=target.tolist(),
                          protected_triangle_pixels=triangles[candidates[nearest]].tolist(),
                          safe=distance >= 8 - 1e-7)
        else:
            detail.update(minimum_distance_pixels_lower_bound=16, safe=True)
        details.append(detail)
    safe = all(detail['safe'] for detail in details)
    return {'required_geometric_separation_pixels': 8, 'bake_extension_pixels_each': 3,
            'remaining_filter_gap_pixels': 2, 'refined_tiles': len(details),
            'mask_proven_tiles': previous['allocated_faces_checked'] - len(details),
            'safe': safe, 'tiles': details}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--resolution', default=4096, type=int)
    parser.add_argument('--refine', action='store_true', help='Refine previous conservative hits with exact triangle distances')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    root, resolution = args.root.resolve(), args.resolution
    report = json.loads((root / 'art' / 'room-depth-report.json').read_text())
    repair = report['atlas_repair']
    targets = set(repair['attempts'][0]['inspection']['out_of_bounds_uv_faces'])
    tile_size = repair['attempts'][0]['repair']['tile_pixels']
    bpy.ops.wm.open_mainfile(filepath=str(root / 'art' / 'room-depth.blend'), load_ui=False)
    mesh = bpy.data.objects['OldCuriosityShop'].data
    values = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers[2].data.foreach_get('uv', values)
    values = values.reshape(-1, 2)
    path = root / 'art' / 'room-atlas-edge-clearance.json'
    if args.refine:
        previous = json.loads(path.read_text())
        if previous['allocated_faces_checked'] != len(targets):
            raise RuntimeError('Prior proof does not match the current allocation')
        refinement = refine_clearance(mesh, values, targets, previous, resolution)
        previous['exact_refinement'] = refinement
        previous['safe'] = refinement['safe']
        path.write_text(json.dumps(previous, indent=2) + '\n')
        print('ROOM_ATLAS_EXACT_CLEARANCE ' + json.dumps(refinement), flush=True)
        if not refinement['safe']:
            raise RuntimeError('Exact triangle separation is less than eight pixels')
        return
    edge_mask, stats = conservative_uv_edge_mask(mesh, values, targets, resolution)
    excluded = dilate_square(edge_mask, 8)
    collisions = []
    total_intersection_pixels = 0
    for face_index in sorted(targets):
        face = mesh.polygons[face_index]
        triangle = values[list(face.loop_indices)].astype(np.float64) * resolution
        origin = triangle.min(axis=0) - 3.5
        if not np.allclose(origin, np.rint(origin), atol=1e-5):
            raise RuntimeError('Allocated face does not match a reserved integer tile: ' + str(face_index))
        x, y = map(int, np.rint(origin))
        if x < 0 or y < 0 or x + tile_size > resolution or y + tile_size > resolution:
            raise RuntimeError('Allocated tile lies outside the atlas')
        overlap = int(excluded[y:y + tile_size, x:x + tile_size].sum())
        if overlap:
            total_intersection_pixels += overlap
            collisions.append({'face': face_index, 'tile_origin': [x, y], 'intersection_pixels': overlap,
                               'material': mesh.materials[face.material_index].name})
    result = dict(stats, allocated_faces_checked=len(targets), tile_pixels=tile_size,
                  protected_edge_exclusion_pixels=8, conservative_guard_pixels=1,
                  colliding_tile_count=len(collisions), intersection_pixels=total_intersection_pixels,
                  safe=len(collisions) == 0, collision_examples=collisions[:100],
                  all_colliding_faces=[item['face'] for item in collisions], native_file_unchanged=True)
    path.write_text(json.dumps(result, indent=2) + '\n')
    print('ROOM_ATLAS_EDGE_CLEARANCE ' + json.dumps(result), flush=True)
    if collisions:
        raise RuntimeError('Allocated tiles intersect conservative protected-edge exclusion; see ' + str(path))


if __name__ == '__main__':
    main()
