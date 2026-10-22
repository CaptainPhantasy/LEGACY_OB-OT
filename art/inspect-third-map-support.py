"""Read-only support audit for the original elevated rolled-map bundle."""
import json
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root = Path('/Volumes/Storage/LAI-BookOfTruths/sites/legacy-depth-v7')
bpy.ops.wm.open_mainfile(filepath=str(root / 'art/room-curiosities.blend'), load_ui=False)
obj = bpy.data.objects['OldCuriosityShop']
mesh = obj.data
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
groups, mats = {}, {}
for i in range(len(world)):
    groups.setdefault(find(i), []).append(i)
for face in mesh.polygons:
    mats.setdefault(find(face.vertices[0]), set()).add(mesh.materials[face.material_index].name)
parts = []
for key, ids in groups.items():
    low = Vector([min(world[i][a] for i in ids) for a in range(3)])
    high = Vector([max(world[i][a] for i in ids) for a in range(3)])
    parts.append({'ids': ids, 'center': (low + high) / 2, 'low': low, 'high': high, 'materials': sorted(mats.get(key, set()))})
selected = [p for p in parts if (p['center'] - Vector((-2.04, 5.8, .65))).length < .08
            and any(m in ('Antique paper', 'Dusty canvas') for m in p['materials'])]
assert len(selected) == 4, [(list(p['center']), p['materials']) for p in selected]
excluded = {i for p in selected for i in p['ids']}
faces = [face for face in mesh.polygons if not any(i in excluded for i in face.vertices)]
tree = BVHTree.FromPolygons(world, [list(face.vertices) for face in faces], all_triangles=False)
def ray(x, y, above):
    hit, normal, index, distance = tree.ray_cast(Vector((x, y, above)), Vector((0, 0, -1)), 3)
    return None if hit is None else {'point': list(hit), 'distance': distance,
        'material': mesh.materials[faces[index].material_index].name, 'normal': list(normal)}
records = []
for p in selected:
    center = p['center']
    support = ray(center.x, center.y, p['low'].z - .00001)
    closest, normal, face, distance = tree.find_nearest(Vector((center.x, center.y, p['low'].z)))
    records.append({'center': list(center), 'bounds': [list(p['low']), list(p['high'])],
                    'materials': p['materials'], 'vertices': len(p['ids']), 'support': support,
                    'vertical_gap_m': None if support is None else p['low'].z - support['point'][2],
                    'nearest_other_surface': {'point': list(closest), 'distance': distance,
                        'material': mesh.materials[faces[face].material_index].name}})
candidates = []
for x in (-2.8, -2.6, -2.4, -2.2, -2.04, -1.8, -1.6):
    for y in (5.4, 5.6, 5.8, 6, 6.2):
        hit = ray(x, y, .64)
        if hit and hit['point'][2] > .15:
            candidates.append({'xy': [x, y], **hit})
report = {'bundle_parts': records, 'nearby_supports_below_64cm': candidates}
(root / 'art/third-map-support-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print('THIRD_MAP_SUPPORT ' + json.dumps(report), flush=True)
