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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--resolution', default=4096, type=int)
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
    path = root / 'art' / 'room-atlas-edge-clearance.json'
    path.write_text(json.dumps(result, indent=2) + '\n')
    print('ROOM_ATLAS_EDGE_CLEARANCE ' + json.dumps(result), flush=True)
    if collisions:
        raise RuntimeError('Allocated tiles intersect conservative protected-edge exclusion; see ' + str(path))


if __name__ == '__main__':
    main()
