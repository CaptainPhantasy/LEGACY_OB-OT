"""Replace intersecting bottle shells with continuous profiles and fitted paper labels.

Run after ground-and-add-curiosities.py and before atlas-shelf/bake. The complete
input checkpoint is preserved in rendering.quarantine. Only the nineteen glass
assemblies and fourteen flat labels are replaced. Two floor map bundles are
grounded and their existing ties fitted without changing topology or UVs.
Corks and unrelated geometry retain their positions and UV correspondence.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
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
native = root / 'art/room-curiosities.blend'
backup = root / 'art/rendering.quarantine/room-curiosities-before-continuous-bottles.blend'
if backup.exists():
    assert hashlib.sha256(native.read_bytes()).digest() == hashlib.sha256(backup.read_bytes()).digest(), \
        'Backup exists and native has changed; do not replace the preserved checkpoint.'
backup.parent.mkdir(parents=True, exist_ok=True)
if not backup.exists():
    shutil.copy2(native, backup)
bpy.ops.wm.open_mainfile(filepath=str(native), load_ui=False)
scene = bpy.context.scene
shop = bpy.data.objects['OldCuriosityShop']
shelf = bpy.data.objects['CenterCuriosityShelf']
mesh = shop.data
hinge = bpy.data.objects['BookCoverHinge']
hinge_before = [list(row) for row in hinge.matrix_world]
world = [shop.matrix_world @ vertex.co for vertex in mesh.vertices]
parents = list(range(len(world)))


def find(index):
    while parents[index] != index:
        parents[index] = parents[parents[index]]
        index = parents[index]
    return index


for edge in mesh.edges:
    a, b = map(find, edge.vertices)
    if a != b:
        parents[b] = a
parts = {}
for index in range(len(world)):
    parts.setdefault(find(index), []).append(index)
materials = {}
for face in mesh.polygons:
    materials.setdefault(find(face.vertices[0]), set()).add(face.material_index)
components = []
for key, indices in parts.items():
    low = Vector(tuple(min(world[index][a] for index in indices) for a in range(3)))
    high = Vector(tuple(max(world[index][a] for index in indices) for a in range(3)))
    components.append({'indices': indices, 'low': low, 'high': high, 'center': (low + high) / 2,
                       'materials': materials.get(key, set())})
groups = {}
for part in components:
    if any(mesh.materials[index].name.startswith('Dusty bottle ') for index in part['materials']):
        key = tuple(round(part['center'][a], 3) for a in (0, 1))
        groups.setdefault(key, []).append(part)
assert len(groups) == 19, 'Expected the original nineteen bottle assemblies.'
inventory, removed_vertices, cork_vertices = [], set(), set()
for (x, y), bodies in sorted(groups.items()):
    main = max(bodies, key=lambda part: part['high'].z - part['low'].z)
    height = (main['high'].z - main['low'].z) / .60
    radius = (main['high'].x - main['low'].x) / 2
    bottom = min(part['low'].z for part in bodies)
    nominal = bottom - .03 * height
    corks = [part for part in components if
             (part['center'] - Vector((x, y, nominal + height * .96))).length < .003 and
             any('Walnut' in mesh.materials[index].name for index in part['materials'])]
    assert len(corks) == 1, ('Stopper identity changed', x, y)
    cork = corks[0]
    labels = [part for part in components if
              (part['center'] - Vector((x, y - radius - .001, nominal + height * .36))).length < .003 and
              any(mesh.materials[index].name == 'Antique paper' for index in part['materials'])]
    assert len(labels) <= 1, ('Ambiguous old label', x, y)
    for part in bodies + labels:
        removed_vertices.update(part['indices'])
    cork_vertices.update(cork['indices'])
    inventory.append({'xy': [x, y], 'height': height, 'radius': radius, 'bottom': bottom,
                      'cork_bottom': cork['low'].z, 'cork_vertices': cork['indices'],
                      'material': mesh.materials[next(iter(main['materials']))],
                      'label': labels[0] if labels else None})
assert sum(item['label'] is not None for item in inventory) == 14, 'Expected fourteen existing paper labels.'
cork_positions = {index: tuple(mesh.vertices[index].co) for index in cork_vertices}

# The two source floor bundles originally floated by about six centimeters.
# Ground all three rolls together and fit the existing circular tie to a snug
# capsule around them. Its 1.5 mm string radius then physically supports paper.
floor_faces = [list(face.vertices) for face in mesh.polygons
               if any(term in mesh.materials[face.material_index].name.lower()
                      for term in ('walnut', 'ebony', 'stone', 'bronze'))]
floor_tree = BVHTree.FromPolygons(world, floor_faces, all_triangles=False)
inverse = shop.matrix_world.inverted()
floor_updates, floor_evidence = {}, []
for x, y in ((-1.75, -4.6), (1.55, -2.7)):
    rolls = []
    for i in range(3):
        matches = [part for part in components if
                   (part['center'] - Vector((x + i * .06, y, .10))).length < .003 and
                   any(mesh.materials[index].name == 'Antique paper' for index in part['materials'])]
        assert len(matches) == 1, ('Floor roll identity changed', x, y, i)
        rolls.append(matches[0])
    ties = [part for part in components if
            (part['center'] - Vector((x + .06, y, .10))).length < .003 and
            any(mesh.materials[index].name == 'Dusty canvas' for index in part['materials'])]
    assert len(ties) == 1, ('Floor bundle tie identity changed', x, y)
    tie = ties[0]
    support_samples = []
    for i in range(3):
        for dx in (-.02, 0, .02):
            for dy in (-.19, 0, .19):
                hit, _, _, _ = floor_tree.ray_cast(Vector((x + i * .06 + dx, y + dy, .065)),
                                                  Vector((0, 0, -1)), 1)
                assert hit is not None, ('No floor below rolled maps', x, y)
                support_samples.append(float(hit.z))
    support = max(support_samples)
    center_z = support + .028 + .0004
    delta_z = center_z - .10
    for part in rolls:
        for index in part['indices']:
            point = world[index].copy()
            point.z += delta_z
            floor_updates[index] = inverse @ point
    for index in tie['indices']:
        rel = world[index] - Vector((x + .06, y, .10))
        theta = math.atan2(rel.z, rel.x)
        radius = math.hypot(rel.x, rel.z)
        fitted_radius = .0265 + (radius - .07) * .375
        c, s = math.cos(theta), math.sin(theta)
        half = -.06 if c < -1e-6 else .06
        point = Vector((x + .06 + half + fitted_radius * c,
                        y + rel.y * .375, center_z + fitted_radius * s))
        floor_updates[index] = inverse @ point
    tie_min = min((shop.matrix_world @ floor_updates[index]).z for index in tie['indices'])
    roll_min = min((shop.matrix_world @ floor_updates[index]).z
                   for part in rolls for index in part['indices'])
    assert -.00001 <= tie_min - support <= .001, ('Map tie support gap', tie_min - support)
    assert .0025 <= roll_min - support <= .004, ('Map paper/string contact gap', roll_min - support)
    floor_evidence.append({'source_xy': [x, y], 'rolls': 3, 'ties': 1,
                           'support_sample_count': len(support_samples), 'support_m': support,
                           'before_roll_floor_gap_m': min(p['low'].z for p in rolls) - support,
                           'after_roll_floor_clearance_m': roll_min - support,
                           'after_tie_floor_gap_m': tie_min - support,
                           'translation_z_m': delta_z, 'tie_tube_radius_m': .0015,
                           'rolls_rest_on_tie': True,
                           'topology_and_uvs_unchanged': True,
                           'modified_vertices': sum(len(p['indices']) for p in rolls) + len(tie['indices'])})
assert not (set(floor_updates) & (removed_vertices | cork_vertices))

# Stable pre-edit vertex IDs let us prove that every retained material/UV pair
# remains on the same face corner, even when removed vertices are renumbered.
bm = bmesh.new()
bm.from_mesh(mesh)
bm.verts.ensure_lookup_table()
original_id = bm.verts.layers.int.new('BottleRepairOriginalVertex')
for vertex in bm.verts:
    vertex[original_id] = vertex.index
    if vertex.index in floor_updates:
        vertex.co = floor_updates[vertex.index]
uv_names = ('UVMap', 'RoomLightmapUV')
uv_layers = [bm.loops.layers.uv[name] for name in uv_names]
targets = [face for face in bm.faces if all(vertex[original_id] in removed_vertices for vertex in face.verts)]
target_set = set(targets)
assert targets and all(all(vertex[original_id] in removed_vertices for vertex in face.verts) for face in targets)


def retained_signature(faces):
    hashes = []
    for face in faces:
        records = []
        for loop in face.loops:
            values = [loop[uv].uv[a] for uv in uv_layers for a in (0, 1)]
            records.append(struct.pack('<I4f', loop.vert[original_id], *values))
        hashes.append(hashlib.sha256(mesh.materials[face.material_index].name.encode() + b'\0' +
                                     b''.join(sorted(records))).digest())
    return hashlib.sha256(b''.join(sorted(hashes))).hexdigest(), len(hashes)


before, retained_count = retained_signature(face for face in bm.faces if face not in target_set)
retained_positions = {vertex[original_id]: tuple(vertex.co) for vertex in bm.verts
                      if vertex[original_id] not in removed_vertices}
removed_face_count = len(targets)
bmesh.ops.delete(bm, geom=targets, context='FACES')
after, after_count = retained_signature(bm.faces)
assert (before, retained_count) == (after, after_count), 'A retained face changed its original UV/material correspondence.'
for vertex in bm.verts:
    key = vertex[original_id]
    if key in retained_positions:
        assert tuple(vertex.co) == retained_positions[key], 'A retained source vertex moved.'
    if key in cork_positions:
        assert tuple(vertex.co) == cork_positions[key], 'A stopper moved.'
bm.verts.layers.int.remove(original_id)
bm.to_mesh(mesh)
bm.free()
mesh.update()
new_objects, evidence = [], []


def new_object(name, vertices, faces, uv_faces, material, smooth_faces):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    data.materials.append(material)
    for uv_name in ('UVMap', 'RoomSurfaceUV', 'RoomLightmapUV'):
        data.uv_layers.new(name=uv_name)
    for face, uvs in zip(data.polygons, uv_faces):
        face.use_smooth = face.index in smooth_faces
        for loop_index, uv in zip(face.loop_indices, uvs):
            data.uv_layers[0].data[loop_index].uv = uv
            data.uv_layers[1].data[loop_index].uv = uv
            data.uv_layers[2].data[loop_index].uv = (0, 0)
    data.uv_layers[0].active_render = True
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj['curiosity_group'] = 'bottle repair'
    new_objects.append(obj)
    return obj


for ordinal, item in enumerate(inventory):
    x, y = item['xy']
    height, radius, bottom = item['height'], item['radius'], item['bottom']
    neck_height = item['cork_bottom'] - bottom
    profile = [(0, .84), (.008, .94), (.020, .99), (.040, 1), (.25, 1), (.50, 1),
               (.54, .997), (.58, .98), (.62, .93), (.66, .84), (.70, .69),
               (.735, .52), (.76, .445), (.78, .43), (.86, .43), (.895, .43)]
    rings = [(z * height, r * radius) for z, r in profile] + [(neck_height, .43 * radius)]
    assert all(rings[i][0] < rings[i + 1][0] for i in range(len(rings) - 1))
    segments = 48
    vertices = [(x + r * math.cos(i * math.tau / segments),
                 y + r * math.sin(i * math.tau / segments), bottom + z)
                for z, r in rings for i in range(segments)]
    faces, uvs = [], []
    for row in range(len(rings) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((row * segments + i, row * segments + j,
                          (row + 1) * segments + j, (row + 1) * segments + i))
            uvs.append(((i / segments, rings[row][0] / neck_height), ((i + 1) / segments, rings[row][0] / neck_height),
                        ((i + 1) / segments, rings[row + 1][0] / neck_height), (i / segments, rings[row + 1][0] / neck_height)))
    smooth = set(range(len(faces)))
    for ids in (tuple(reversed(range(segments))), tuple((len(rings) - 1) * segments + i for i in range(segments))):
        faces.append(ids)
        uvs.append(tuple((.5 + .5 * math.cos(i * math.tau / segments), .5 + .5 * math.sin(i * math.tau / segments))
                         for i in (reversed(range(segments)) if ids[0] == segments - 1 else range(segments))))
    obj = new_object('Continuous old bottle %02d' % ordinal, vertices, faces, uvs, item['material'], smooth)
    check = bmesh.new()
    check.from_mesh(obj.data)
    assert all(edge.is_manifold for edge in check.edges), 'New bottle is not a closed manifold.'
    volume = check.calc_volume(signed=True)
    assert volume > 0, 'New bottle has reversed winding.'
    check.free()
    record = {'xy': [x, y], 'radius_m': radius, 'height_parameter_m': height,
              'base_m': bottom, 'neck_top_m': bottom + neck_height, 'cork_bottom_m': item['cork_bottom'],
              'cork_contact_gap_m': item['cork_bottom'] - (bottom + neck_height),
              'segments': segments, 'profile_rings': len(rings), 'closed_manifold': True,
              'positive_volume_m3': volume, 'material': item['material'].name}
    label = item['label']
    if label:
        width = label['high'].x - label['low'].x
        low, high = label['low'].z, label['high'].z
        inner, outer = radius + .00025, radius + .00070
        angle = math.asin(min(.95, width / (2 * outer)))
        count = 16
        verts = []
        for r in (outer, inner):
            for z in (low, high):
                for i in range(count + 1):
                    theta = -angle + 2 * angle * i / count
                    verts.append((x + r * math.sin(theta), y - r * math.cos(theta), z))
        n = count + 1
        lf, lu, smooth = [], [], set()
        for i in range(count):
            lf.append((i, i + 1, n + i + 1, n + i))
            lu.append(((i / count, 0), ((i + 1) / count, 0), ((i + 1) / count, 1), (i / count, 1)))
            smooth.add(len(lf) - 1)
            lf.append((2 * n + i + 1, 2 * n + i, 3 * n + i, 3 * n + i + 1))
            lu.append((((i + 1) / count, 0), (i / count, 0), (i / count, 1), ((i + 1) / count, 1)))
            smooth.add(len(lf) - 1)
            lf.extend(((i + 1, i, 2 * n + i, 2 * n + i + 1),
                       (n + i, n + i + 1, 3 * n + i + 1, 3 * n + i)))
            lu.extend((((0, 0), (1, 0), (1, 1), (0, 1)),) * 2)
        lf.extend(((0, n, 3 * n, 2 * n), (count, 2 * n + count, 3 * n + count, n + count)))
        lu.extend((((0, 0), (1, 0), (1, 1), (0, 1)),) * 2)
        label_obj = new_object('Conforming old paper label %02d' % ordinal, verts, lf, lu,
                               bpy.data.materials['Antique paper'], smooth)
        check = bmesh.new()
        check.from_mesh(label_obj.data)
        assert all(edge.is_manifold for edge in check.edges)
        assert check.calc_volume(signed=True) > 0, 'Paper strip winding is reversed.'
        check.free()
        record['label'] = {'segments': count, 'thickness_m': outer - inner, 'inner_radial_clearance_m': inner - radius,
                           'original_width_m': width, 'original_vertical_bounds': [low, high]}
    evidence.append(record)

for obj in new_objects:
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Profile delivery triangles', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.ops.object.select_all(action='DESELECT')
for obj in new_objects + [shelf]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = shelf
bpy.ops.object.join()
shelf['lightmap_atlas_pending'] = True
scene['room_depth_lightmap_needs_rebake'] = True
scene['curiosity_continuous_bottles'] = 1
assert hinge_before == [list(row) for row in hinge.matrix_world]
report = {'source_backup': str(backup), 'bottles_replaced': 19, 'labels_replaced': 14,
          'corks_preserved': 19, 'removed_old_faces': removed_face_count,
          'retained_old_faces': retained_count, 'retained_uv0_uv2_material_signature_before': before,
          'retained_uv0_uv2_material_signature_after': after,
          'retained_source_positions_unchanged_except_floor_bundles': True,
          'authorized_floor_bundle_vertices_modified': len(floor_updates), 'floor_bundles': floor_evidence,
          'hero_hinge_unchanged': True, 'new_shelf_vertices': len(shelf.data.vertices),
          'new_shelf_triangles': len(shelf.data.polygons), 'bottles': evidence,
          'atlas_action_required': 'Repack only CenterCuriosityShelf and rebake both static atlases.',
          'scope': 'Old body/shoulder/neck and label UV loops removed with their replaced faces. All remaining original face-corner UV0/UV2 and material associations are unchanged.'}
(root / 'art/bottle-profile-repair-report.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(native), compress=True)
print('BOTTLE_PROFILE_REPAIR ' + json.dumps({key: report[key] for key in (
    'bottles_replaced', 'labels_replaced', 'corks_preserved', 'removed_old_faces', 'retained_old_faces',
    'new_shelf_vertices', 'new_shelf_triangles', 'retained_source_positions_unchanged_except_floor_bundles',
    'authorized_floor_bundle_vertices_modified', 'hero_hinge_unchanged')}), flush=True)
