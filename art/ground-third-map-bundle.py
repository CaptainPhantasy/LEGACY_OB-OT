"""Bounded delta repair for the rear rolled maps; no topology or atlas changes."""
import hashlib
import json
import math
from pathlib import Path
import shutil

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root = Path('/Volumes/Storage/LAI-BookOfTruths/sites/legacy-depth-v7')
native = root / 'art/room-curiosities.blend'
backup = root / 'art/rendering.quarantine/room-curiosities-before-third-map-grounding.blend'
if backup.exists():
    assert hashlib.sha256(native.read_bytes()).digest() == hashlib.sha256(backup.read_bytes()).digest(), 'Changed checkpoint; preserve existing backup.'
else:
    shutil.copy2(native, backup)
bpy.ops.wm.open_mainfile(filepath=str(native), load_ui=False)
obj = bpy.data.objects['OldCuriosityShop']
mesh = obj.data

def positions(data):
    array = np.empty(len(data.vertices) * 3, dtype=np.float32)
    data.vertices.foreach_get('co', array)
    return array.reshape((-1, 3))

def uv_hashes(data):
    result = {}
    for layer in data.uv_layers:
        array = np.empty(len(layer.data) * 2, dtype=np.float32)
        layer.data.foreach_get('uv', array)
        result[layer.name] = hashlib.sha256(array.tobytes()).hexdigest()
    return result

def protected_signature():
    result = {}
    for other in bpy.data.objects:
        if other == obj:
            continue
        digest = hashlib.sha256(np.array(other.matrix_world, dtype=np.float32).tobytes())
        if other.type == 'MESH':
            digest.update(positions(other.data).tobytes())
            digest.update(json.dumps(uv_hashes(other.data), sort_keys=True).encode())
        result[other.name] = digest.hexdigest()
    return result

original_positions = positions(mesh)
original_uv = uv_hashes(mesh)
protected_before = protected_signature()
topology_before = [(tuple(p.vertices), p.material_index) for p in mesh.polygons]
world = [obj.matrix_world @ v.co for v in mesh.vertices]
parent = list(range(len(world)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i
for edge in mesh.edges:
    a, b = map(find, edge.vertices)
    if a != b:
        parent[b] = a
groups, materials = {}, {}
for i in range(len(world)):
    groups.setdefault(find(i), []).append(i)
for face in mesh.polygons:
    materials.setdefault(find(face.vertices[0]), set()).add(mesh.materials[face.material_index].name)
parts = []
for key, ids in groups.items():
    low = Vector([min(world[i][a] for i in ids) for a in range(3)])
    high = Vector([max(world[i][a] for i in ids) for a in range(3)])
    parts.append({'ids': ids, 'center': (low + high) / 2, 'low': low, 'high': high, 'materials': materials.get(key, set())})
x, y, source_z = -2.1, 5.8, .65
rolls = []
for i in range(3):
    matches = [p for p in parts if 'Antique paper' in p['materials'] and
               (p['center'] - Vector((x + i * .06, y, source_z))).length < .003]
    assert len(matches) == 1
    rolls.append(matches[0])
ties = [p for p in parts if 'Dusty canvas' in p['materials'] and
        (p['center'] - Vector((x + .06, y, source_z))).length < .003]
assert len(ties) == 1
tie = ties[0]
changed = {i for p in rolls + [tie] for i in p['ids']}
assert len(changed) == 360
faces = [list(p.vertices) for p in mesh.polygons if any(
    term in mesh.materials[p.material_index].name.lower() for term in ('walnut', 'ebony', 'stone', 'bronze'))]
tree = BVHTree.FromPolygons(world, faces, all_triangles=False)
samples = []
for i in range(3):
    for dx in (-.02, 0, .02):
        for dy in (-.19, 0, .19):
            hit, _, _, _ = tree.ray_cast(Vector((x + i * .06 + dx, y + dy, .065)), Vector((0, 0, -1)), 1)
            assert hit is not None
            samples.append(float(hit.z))
support = max(samples)
center_z = support + .028 + .0004
delta = center_z - source_z
inverse = obj.matrix_world.inverted()
for part in rolls:
    for index in part['ids']:
        point = world[index].copy()
        point.z += delta
        mesh.vertices[index].co = inverse @ point
for index in tie['ids']:
    rel = world[index] - Vector((x + .06, y, source_z))
    theta = math.atan2(rel.z, rel.x)
    fitted_radius = .0265 + (math.hypot(rel.x, rel.z) - .07) * .375
    c, s = math.cos(theta), math.sin(theta)
    half = -.06 if c < -1e-6 else .06
    point = Vector((x + .06 + half + fitted_radius * c, y + rel.y * .375,
                    center_z + fitted_radius * s))
    mesh.vertices[index].co = inverse @ point
mesh.update()
after_positions = positions(mesh)
actual_changed = set(np.flatnonzero(np.any(original_positions != after_positions, axis=1)).tolist())
assert actual_changed == changed, 'Changes exceeded the exact third bundle vertex set.'
assert original_uv == uv_hashes(mesh), 'An original UV changed.'
assert topology_before == [(tuple(p.vertices), p.material_index) for p in mesh.polygons], 'Topology/material correspondence changed.'
assert protected_before == protected_signature(), 'Another scene object changed.'
tie_bottom = min((obj.matrix_world @ mesh.vertices[i].co).z for i in tie['ids'])
paper_bottom = min((obj.matrix_world @ mesh.vertices[i].co).z for part in rolls for i in part['ids'])
assert -.00001 <= tie_bottom - support <= .001
assert .0025 <= paper_bottom - support <= .004
report = {'source_backup': str(backup), 'xy': [x, y], 'rolls_grounded': 3, 'ties_fitted': 1,
          'exact_changed_vertices': sorted(actual_changed), 'changed_vertex_count': len(actual_changed),
          'before_paper_bottom_m': min(p['low'].z for p in rolls), 'support_m': support,
          'before_paper_floor_gap_m': min(p['low'].z for p in rolls) - support,
          'after_paper_bottom_m': paper_bottom, 'after_tie_bottom_m': tie_bottom,
          'after_tie_floor_gap_m': tie_bottom - support,
          'after_paper_floor_clearance_m': paper_bottom - support,
          'paper_rests_on_thin_tie': True, 'translation_z_m': delta,
          'original_uv_hashes_before': original_uv, 'original_uv_hashes_after': uv_hashes(mesh),
          'topology_and_material_correspondence_unchanged': True,
          'all_other_vertices_and_objects_unchanged': True,
          'atlas_repack_required': False, 'both_static_bakes_required': True}
(root / 'art/third-map-grounding-report.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.context.scene['room_depth_lightmap_needs_rebake'] = True
bpy.ops.wm.save_as_mainfile(filepath=str(native), compress=True)
print('THIRD_MAP_GROUNDED ' + json.dumps({k: report[k] for k in (
    'changed_vertex_count', 'before_paper_floor_gap_m', 'after_tie_floor_gap_m',
    'after_paper_floor_clearance_m', 'topology_and_material_correspondence_unchanged',
    'all_other_vertices_and_objects_unchanged')}), flush=True)
