"""Read-only checkpoint comparison and native bottle contact verification."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = args.root
report_path = root / 'art/bottle-profile-repair-report.json'
report = json.loads(report_path.read_text())


def protected_fingerprints():
    result = {}
    for obj in bpy.data.objects:
        if obj.name in ('OldCuriosityShop', 'CenterCuriosityShelf'):
            continue
        digest = hashlib.sha256()
        digest.update(obj.type.encode())
        digest.update(struct.pack('<16f', *(v for row in obj.matrix_world for v in row)))
        digest.update((obj.parent.name if obj.parent else '').encode())
        if obj.type == 'MESH':
            for vertex in obj.data.vertices:
                digest.update(struct.pack('<3f', *vertex.co))
            for face in obj.data.polygons:
                digest.update(struct.pack('<2I', face.material_index, len(face.vertices)))
                digest.update(struct.pack('<%dI' % len(face.vertices), *face.vertices))
            for uv in obj.data.uv_layers:
                digest.update(uv.name.encode())
                for loop in uv.data:
                    digest.update(struct.pack('<2f', *loop.uv))
            for material in obj.data.materials:
                digest.update((material.name if material else '').encode())
        result[obj.name] = digest.hexdigest()
    return result


bpy.ops.wm.open_mainfile(filepath=report['source_backup'], load_ui=False)
before = protected_fingerprints()
bpy.ops.wm.open_mainfile(filepath=str(root / 'art/room-curiosities.blend'), load_ui=False)
after = protected_fingerprints()
assert before == after, 'A protected object changed between the original and repaired checkpoints.'
shop = bpy.data.objects['OldCuriosityShop']
shelf = bpy.data.objects['CenterCuriosityShelf']
points, faces = [], []
for obj in (shop, shelf):
    offset = len(points)
    points.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
    for face in obj.data.polygons:
        name = obj.data.materials[face.material_index].name.lower()
        if any(term in name for term in ('walnut', 'ebony', 'stone', 'bronze')):
            faces.append([offset + i for i in face.vertices])
tree = BVHTree.FromPolygons(points, faces, all_triangles=False)

assert not any(shop.data.materials[p.material_index].name.startswith('Dusty bottle ')
               for p in shop.data.polygons), 'An old intersecting bottle face remains in the room.'
mesh = shelf.data
parents = list(range(len(mesh.vertices)))


def find(index):
    while parents[index] != index:
        parents[index] = parents[parents[index]]
        index = parents[index]
    return index


for edge in mesh.edges:
    a, b = map(find, edge.vertices)
    if a != b:
        parents[b] = a
groups = {}
for face in mesh.polygons:
    if mesh.materials[face.material_index].name.startswith('Dusty bottle '):
        groups.setdefault(find(face.vertices[0]), []).append(face)
assert len(groups) == 19, ('Wrong continuous bottle count', len(groups))
contacts = []
for polygons in groups.values():
    ids = sorted({i for face in polygons for i in face.vertices})
    positions = [shelf.matrix_world @ mesh.vertices[i].co for i in ids]
    x = (min(p.x for p in positions) + max(p.x for p in positions)) / 2
    y = (min(p.y for p in positions) + max(p.y for p in positions)) / 2
    bottom = min(p.z for p in positions)
    top = max(p.z for p in positions)
    hit, _, _, _ = tree.ray_cast(Vector((x, y, bottom + .0001)), Vector((0, 0, -1)), 2)
    assert hit is not None
    gap = bottom - hit.z
    assert -.00001 <= gap <= .001, ('Continuous bottle support gap', x, y, gap)
    source = min(report['bottles'], key=lambda item: (item['xy'][0] - x) ** 2 + (item['xy'][1] - y) ** 2)
    assert abs(source['cork_bottom_m'] - top) < .000001, 'Bottle neck is detached from original cork.'
    index_map = {old: new for new, old in enumerate(ids)}
    temp = bpy.data.meshes.new('Read-only bottle manifold check')
    temp.from_pydata([mesh.vertices[i].co for i in ids], [],
                     [[index_map[i] for i in face.vertices] for face in polygons])
    bm = bmesh.new()
    bm.from_mesh(temp)
    assert all(edge.is_manifold for edge in bm.edges), 'Delivered bottle is not closed manifold.'
    assert bm.calc_volume(signed=True) > 0, 'Delivered bottle winding is inward.'
    bm.free()
    bpy.data.meshes.remove(temp)
    contacts.append({'xy': [x, y], 'base_m': bottom, 'support_m': hit.z,
                     'support_gap_m': gap, 'cork_gap_m': source['cork_bottom_m'] - top,
                     'closed_manifold_positive_volume': True})
result = {'protected_object_count': len(before), 'protected_objects_unchanged': True,
          'protected_objects': before, 'old_intersecting_glass_faces_remaining': 0,
          'continuous_bottles': len(groups), 'native_bottle_contacts': contacts,
          'maximum_bottle_support_gap_m': max(item['support_gap_m'] for item in contacts),
          'floor_bundles': report['floor_bundles'],
          'remaining_old_face_uv0_uv2_material_signature': report['retained_uv0_uv2_material_signature_after'],
          'removed_old_faces': report['removed_old_faces'], 'retained_old_faces': report['retained_old_faces']}
output = root / 'art/bottle-profile-verification.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print('BOTTLE_VERIFICATION ' + json.dumps({key: result[key] for key in (
    'protected_object_count', 'protected_objects_unchanged', 'old_intersecting_glass_faces_remaining',
    'continuous_bottles', 'maximum_bottle_support_gap_m', 'removed_old_faces', 'retained_old_faces')}), flush=True)
