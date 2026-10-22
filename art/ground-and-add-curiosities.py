"""Seat existing props and add a double-sided curiosity shelf without rebuilding the room.

Run using Blender 4.5: --python this.py -- --root /absolute/site
The original room-depth.blend remains unchanged. The new checkpoint requires a
fresh diffuse bake of both OldCuriosityShop and CenterCuriosityShelf.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
ROOT = args.root
ART = ROOT / 'art'
SOURCE = ART / 'room-depth.blend'
OUTPUT = ART / 'room-curiosities.blend'
if OUTPUT.exists():
    raise RuntimeError('New checkpoint already exists; preserve it before a deliberate rerun.')
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False)
scene = bpy.context.scene
shop = bpy.data.objects['OldCuriosityShop']
mesh = shop.data
hinge = bpy.data.objects['BookCoverHinge']
hinge_before = [list(row) for row in hinge.matrix_world]
rng = random.Random(7122)
new_objects = []
contacts = []
group = 'support'


def digest_uv(layer):
    values = np.empty(len(layer.data) * 2, dtype=np.float32)
    layer.data.foreach_get('uv', values)
    return hashlib.sha256(values.tobytes()).hexdigest()


protected_uv = [digest_uv(layer) for layer in mesh.uv_layers]
original_positions = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
mesh.vertices.foreach_get('co', original_positions)
world = [shop.matrix_world @ vertex.co for vertex in mesh.vertices]
parents = list(range(len(world)))


def root(index):
    while parents[index] != index:
        parents[index] = parents[parents[index]]
        index = parents[index]
    return index


for edge in mesh.edges:
    a, b = map(root, edge.vertices)
    if a != b:
        parents[b] = a
parts = {}
for index in range(len(world)):
    parts.setdefault(root(index), []).append(index)
part_materials = {}
for face in mesh.polygons:
    part_materials.setdefault(root(face.vertices[0]), set()).add(mesh.materials[face.material_index].name)
components = []
for key, indices in parts.items():
    low = Vector(tuple(min(world[index][axis] for index in indices) for axis in range(3)))
    high = Vector(tuple(max(world[index][axis] for index in indices) for axis in range(3)))
    components.append({'indices': indices, 'low': low, 'high': high, 'center': (low + high) / 2,
                       'materials': part_materials.get(key, set())})
tree = BVHTree.FromPolygons(world, [list(face.vertices) for face in mesh.polygons], all_triangles=False)


def support_at(x, y, above):
    hit, normal, face, distance = tree.ray_cast(Vector((x, y, above)), Vector((0, 0, -1)), 4)
    if hit is None:
        raise RuntimeError('No original supporting surface below ' + str((x, y, above)))
    return float(hit.z)


def material(prefix):
    exact = bpy.data.materials.get(prefix)
    if exact:
        return exact
    matches = [m for m in bpy.data.materials if m.name.startswith(prefix)]
    if not matches:
        raise RuntimeError('Required original material missing: ' + prefix)
    return matches[0]


wood = material('Walnut • patina 03')
wood_light = material('Walnut • patina 06')
dark = material('Old ebony joinery')
brass = material('Tarnished old brass')
bronze = material('Oxidized bronze')
paper = material('Antique paper')
foxed = material('Centuries of foxing in rag paper')
cloth = material('Book cloth 01')
leather = material('Ox-blood leather')
stone = material('Damp soot-blackened cellar stone')


def finish(obj, name, mat, bevel=0):
    obj.name = name
    obj.data.materials.append(mat)
    obj['curiosity_group'] = group
    obj['curiosity_original_name'] = name
    bpy.context.view_layer.objects.active = obj
    if bevel:
        modifier = obj.modifiers.new('Soft handled edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3
        modifier.harden_normals = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    new_objects.append(obj)
    return obj


def box(name, location, size, mat=wood, bevel=.003, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = rotation
    return finish(obj, name, mat, min(bevel, min(size) * .22))


def cylinder(name, location, radius, height, mat=brass, rotation=None, vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=location)
    obj = bpy.context.object
    if rotation:
        obj.rotation_euler = rotation
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return finish(obj, name, mat, min(.0015, height * .12, radius * .1))


def rod(name, start, end, radius=.005, mat=brass):
    direction = Vector(end) - Vector(start)
    obj = cylinder(name, (Vector(start) + Vector(end)) / 2, radius, direction.length, mat, vertices=12)
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return obj


def ring(name, location, radius, thickness=.004, mat=brass, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=32, minor_segments=6, major_radius=radius,
                                   minor_radius=thickness, location=location, rotation=rotation)
    obj = bpy.context.object
    for face in obj.data.polygons:
        face.use_smooth = True
    return finish(obj, name, mat)


def orb(name, location, scale, mat=stone):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, location=location)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for face in obj.data.polygons:
        face.use_smooth = True
    return finish(obj, name, mat)


def lettering(name, text, location, size, mat=dark, rotation=(0, 0, 0)):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = text
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = .00015
    curve.resolution_u = 1
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(obj, name, mat)


def move_components(items, offset):
    delta = shop.matrix_world.inverted().to_3x3() @ Vector(offset)
    indices = sorted({index for item in items for index in item['indices']})
    for index in indices:
        mesh.vertices[index].co += delta
    return len(indices)


# The old bottle rows were placed in front of their shelf edges, leaving a
# 1.3 m gap in several places. These ledges are tied back to the actual wall.
for side in (-1, 1):
    box('Fitted apothecary bottle ledge', (side * 2.72, -.85, 1.276), (.76, 2.5, .048), wood)
    for y in (-1.88, -.90, .22):
        box('Bottle ledge wall fixing', (side * 3.085, y, 1.10), (.035, .045, .34), bronze, .002)
        rod('Bottle ledge diagonal bracket', (side * 3.075, y, .98), (side * 2.40, y, 1.25), .012, bronze)
        box('Bottle ledge bracket seat', (side * 2.72, y, 1.241), (.70, .035, .018), bronze, .002)

bottles = {}
for item in components:
    if any(name.startswith('Dusty bottle ') for name in item['materials']):
        key = tuple(round(item['center'][axis], 3) for axis in (0, 1))
        bottles.setdefault(key, []).append(item)
assert len(bottles) == 19, 'The bottle inventory changed; inspect before relocating.'
bottle_report = []
claimed = set()
for (x, y), body_parts in sorted(bottles.items()):
    body = max(body_parts, key=lambda item: item['high'].z - item['low'].z)
    height = (body['high'].z - body['low'].z) / .60
    radius = (body['high'].x - body['low'].x) / 2
    nominal = body['low'].z - height * .03
    attachments = []
    caps, labels = 0, 0
    for item in components:
        center = item['center']
        if (center - Vector((x, y, nominal + height * .96))).length < .003 and any('Walnut' in n for n in item['materials']):
            attachments.append(item)
            caps += 1
        if (center - Vector((x, y - radius - .001, nominal + height * .36))).length < .003 and 'Antique paper' in item['materials']:
            attachments.append(item)
            labels += 1
    if caps != 1:
        raise RuntimeError('Bottle stopper was not uniquely identified: ' + str((x, y, caps)))
    assembly = body_parts + attachments
    ids = {index for part in assembly for index in part['indices']}
    if ids & claimed:
        raise RuntimeError('Bottle assembly assignment overlapped.')
    claimed |= ids
    old_bottom = min(part['low'].z for part in body_parts)
    before_support = support_at(x, y, old_bottom - .001)
    # Two original row bottles overlapped the cabinet bottles. Seat these at
    # the back of the new ledge as complete assemblies, including their labels.
    dx = -.30 if x == -2.43 and y in (-.50, -.15) else 0
    target_bottom = 1.3006
    vertices = move_components(assembly, (dx, 0, target_bottom - old_bottom))
    bottle_report.append({'original_xy': [x, y], 'new_xy': [x + dx, y], 'vertices': vertices,
                          'body_parts': len(body_parts), 'caps_moved': caps, 'labels_moved': labels,
                          'before_gap_m': old_bottom - before_support, 'after_gap_m': .0006,
                          'support_height_m': 1.30})

# Give the loose map stack a real lid, and lower the whole stack to it.
box('Loose-map crate fitted lid', (1.69, -1.50, .812), (.635, .585, .024), wood_light)
maps = [item for item in components if 'Centuries of foxing in rag paper' in item['materials']
        and 1.25 < item['center'].x < 2.02 and -1.85 < item['center'].y < -1.10
        and .85 < item['center'].z < 1.0]
assert len(maps) == 5, 'Expected the five original loose map sheets.'
map_bottom = min(item['low'].z for item in maps)
map_support = support_at(1.64, -1.48, map_bottom - .002)
move_components(maps, (0, 0, .8245 - map_bottom))
contacts.append({'assembly': 'loose map stack', 'parts': 5,
                 'before_gap_m': map_bottom - map_support, 'after_gap_m': .0005})

# The globe and four-book stack began .594 m above an empty floor. A narrow
# battered stand supports its existing lowest cover without moving the globe.
box('Globe stack support top', (2.05, .82, .5765), (.56, .64, .035), wood)
for x in (1.84, 2.26):
    for y in (.58, 1.06):
        floor = support_at(x, y, .15)
        bottom, top = floor + .0004, .559
        box('Globe stand fitted leg', (x, y, (bottom + top) / 2), (.045, .045, top - bottom), wood, .003)
for y in (.58, 1.06):
    box('Globe stand braced apron', (2.05, y, .49), (.45, .028, .12), wood, .003)
contacts.append({'assembly': 'globe and book stack', 'before_gap_m': .594 - support_at(2.05, .82, .59),
                 'after_gap_m': 0, 'new_support_top_m': .594})

# The low, two-sided shelf leaves a clear route on both sides and a view over
# the central spine. The upper surfaces carry six separate artifact clusters.
group = 'shelf'
for level, thickness in ((.205, .055), (.51, .042), (1.009, .042)):
    box('Continuous rounded display shelf', (0, -1.5, level), (.76, 4.0, thickness), wood, .006)
box('Two-sided shelf central spine', (0, -1.5, .745), (.035, 3.98, 1.06), wood, .004)
box('Rounded central spine cap', (0, -1.5, 1.285), (.065, 4.0, .030), wood_light, .006)
for y in (-3.465, -2.17, -.83, .465):
    for side in (-1, 1):
        box('Shelf bay rounded end post', (side * .3475, y, .744), (.055, .055, 1.112), wood_light, .005)
    box('Shelf bay lower divider', (0, y, .755), (.70, .032, .49), wood, .003)
for x in (-.292, .292):
    for y in (-3.36, -1.50, .36):
        floor = support_at(x, y, .12)
        bottom, top = floor + .0005, .195
        box('Shelf foot fitted to actual floor', (x, y, (top + bottom) / 2), (.072, .09, top - bottom), dark, .004)
        contacts.append({'assembly': 'center shelf foot', 'xy': [x, y], 'floor_m': floor,
                         'bottom_m': bottom, 'after_gap_m': bottom - floor})


def tray(x, y):
    box('Artifact felt-lined tray', (x, y, 1.037), (.285, .52, .014), dark, .003)
    for dy in (-.25, .25):
        box('Tray fine timber lip', (x, y + dy, 1.047), (.284, .012, .024), wood_light, .002)
    for dx in (-.136, .136):
        box('Tray fine side lip', (x + dx, y, 1.047), (.012, .49, .024), wood_light, .002)


def plaque(side, y, text):
    box('Curiosity label brass mount', (side * .384, y, .934), (.009, .28, .060), brass, .002)
    # Text local +Z faces outward; readable while standing alongside the shelf.
    lettering('Curiosity engraved label ' + text, text, (side * .390, y, .934), .018, dark,
              (math.pi / 2, 0, side * math.pi / 2))


bay_y = (-2.83, -1.50, -.17)
groups = [('cia', -1, 0, 'DECLASSIFIED'), ('darpa', -1, 1, 'PROTOTYPES'),
          ('time-slips', -1, 2, 'TIME'), ('ufo', 1, 0, 'SKY FILES'),
          ('ciphers', 1, 1, 'MANUSCRIPTS'), ('artifacts', 1, 2, 'ODDITIES')]
hotspots = []
for group_name, side, bay, label in groups:
    group = group_name
    x, y = side * .205, bay_y[bay]
    tray(x, y)
    plaque(side, y, label)
    hotspots.append({'id': group, 'blender': [x, y, 1.13], 'web': [x, 1.13, -y], 'facing': side})
    # Small mismatched volumes beneath each display ground the shelf as an
    # ordinary curiosity shop furnishing rather than a polished exhibition case.
    for j in range(3):
        width, length = .245 - j * .008, .34 + j * .012
        z = .550 + j * .0375
        angle = (-.035 + j * .024) * side
        for dz in (-.016, .016):
            box('Lower shelf cloth book cover', (x, y + .035 * (j % 2), z + dz), (width, length, .005), cloth, .001, angle)
        box('Lower volume warm page block', (x, y + .035 * (j % 2), z), (width - .012, length - .010, .027), paper, .001, angle)
    if group == 'cia':
        box('Creased archive folder', (x, y, 1.053), (.247, .42, .018), paper, .002, -.025)
        for j in range(3):
            yy = y + j * .012
            box('Declassified typed page', (x, yy, 1.063 + j * .0018), (.218, .345, .0015), foxed, .0002, -.025)
        for j in range(7):
            box('Black archival redaction', (x + (.018 if j % 2 else -.009), y - .125 + j * .032, 1.068),
                (.15 if j % 3 else .095, .009, .0007), dark, .0001, -.025)
        lettering('Archive folder heading', 'ARCHIVE', (x, y + .128, 1.0685), .024, dark)
        rod('Folder brass clasp', (x - .07, y + .19, 1.0645), (x + .07, y + .19, 1.0645), .0025, brass)
    elif group == 'darpa':
        box('Experimental instrument enclosure', (x, y, 1.084), (.238, .31, .080), dark, .009)
        box('Instrument engraved control plate', (x, y, 1.129), (.21, .276, .010), bronze, .003)
        for dy in (-.08, .075):
            ring('Instrument induction coil', (x, y + dy, 1.140), .045, .006, brass)
            cylinder('Instrument coil core', (x, y + dy, 1.149), .025, .030, bronze)
        for dx in (-.073, .073):
            cylinder('Instrument slotted fastener', (x + dx, y - .11, 1.138), .009, .008, brass, vertices=12)
        rod('Instrument signal loop', (x - .075, y + .10, 1.134), (x - .075, y + .10, 1.27), .0035, bronze)
        ring('Instrument upper aerial loop', (x - .075, y + .10, 1.25), .038, .003, brass, (math.pi / 2, 0, 0))
    elif group == 'time-slips':
        box('Mantel clock foot', (x, y, 1.0575), (.252, .32, .027), wood_light, .004)
        center = Vector((x, y, 1.176))
        rot = (0, math.pi / 2, 0)
        cylinder('Time cabinet round body', center, .112, .092, wood, rot, 32)
        face_x = x + side * .050
        cylinder('Time cabinet ivory dial', (face_x, y, 1.176), .097, .006, paper, rot, 32)
        ring('Time cabinet brass bezel', (face_x + side * .004, y, 1.176), .100, .005, brass, rot)
        for tick in range(12):
            a = tick * math.tau / 12
            rod('Clock engraved hour mark', (face_x + side * .005, y + .079 * math.sin(a), 1.176 + .079 * math.cos(a)),
                (face_x + side * .005, y + .088 * math.sin(a), 1.176 + .088 * math.cos(a)), .0017, dark)
        rod('Clock minute hand', (face_x + side * .009, y, 1.176), (face_x + side * .009, y - .052, 1.223), .002, dark)
        rod('Clock hour hand', (face_x + side * .012, y, 1.176), (face_x + side * .012, y + .032, 1.196), .003, dark)
        cylinder('Clock hand pivot', (face_x + side * .014, y, 1.176), .007, .006, brass, rot, 12)
    elif group == 'ufo':
        box('Sky observations folder', (x, y, 1.054), (.25, .43, .020), cloth, .002, .025)
        for j in range(3):
            box('Aged sky-observation card', (x, y - .13 + j * .11, 1.065), (.20, .093, .0015), paper, .0002, .025)
            ring('Observation card sighting diagram', (x, y - .13 + j * .11, 1.067), .025, .0012, dark)
        box('Small aerial model stand', (x, y + .115, 1.07825), (.11, .11, .025), wood, .002)
        rod('Aerial model display pin', (x, y + .115, 1.09075), (x, y + .115, 1.185), .003, bronze)
        orb('Archived unidentified craft model', (x, y + .115, 1.19), (.081, .081, .020), bronze)
        orb('Craft model raised dome', (x, y + .115, 1.205), (.034, .034, .019), brass)
    elif group == 'ciphers':
        box('Manuscript leather slipcase', (x, y, 1.0615), (.245, .39, .035), leather, .005, -.03)
        for j in range(5):
            box('Mysterious manuscript loose leaf', (x, y + j * .003, 1.080 + j * .0015),
                (.221, .35, .0012), foxed, .0002, -.03)
        for j in range(8):
            lettering('Manuscript indecipherable figure', 'X  O  V  :  X' if j % 2 else ':  V  O  X  :',
                      (x, y - .12 + j * .032, 1.0872), .014, dark, (0, 0, -.03))
        cylinder('Manuscript wax seal', (x + .055, y + .132, 1.091), .021, .008, leather, vertices=20)
        rod('Manuscript seal cord', (x + .055, y + .132, 1.091), (x - .06, y + .18, 1.088), .0015, brass)
    else:
        box('Curious artifact fitted timber base', (x, y, 1.058), (.23, .28, .028), wood_light, .004)
        cylinder('Artifact central pedestal', (x, y, 1.097), .055, .050, bronze)
        orb('Timeworn stone fragment', (x, y, 1.166), (.062, .075, .071), stone)
        ring('Artifact brass meridian', (x, y, 1.168), .104, .0045, brass, (0, math.pi / 2, .15))
        ring('Artifact oblique brass orbit', (x, y, 1.168), .097, .0035, bronze, (.80, .22, 0))
        for dy in (-.105, .105):
            rod('Artifact anchored cradle', (x, y + dy, 1.072), (x, y + dy * .35, 1.135), .004, bronze)

# Give the new geometry portable UV0 and physical repeating UV1. A separate
# atlas stage will unwrap UV2 without ever repacking the original room atlas.
parts_report = []
bpy.context.view_layer.update()
for obj in new_objects:
    data = obj.data
    while len(data.uv_layers) < 3:
        data.uv_layers.new(name=('UVMap', 'RoomSurfaceUV', 'RoomLightmapUV')[len(data.uv_layers)])
    for index, name in enumerate(('UVMap', 'RoomSurfaceUV', 'RoomLightmapUV')):
        data.uv_layers[index].name = name
    bpy.context.view_layer.objects.active = obj
    triangulate = obj.modifiers.new('Delivery triangles', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    data = obj.data
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    for face in data.polygons:
        normal = normal_matrix @ face.normal
        dominant = max(range(3), key=lambda a: abs(normal[a]))
        axes = [a for a in range(3) if a != dominant]
        for loop_index in face.loop_indices:
            point = obj.matrix_world @ data.vertices[data.loops[loop_index].vertex_index].co
            # UV0 is adequate for the shared material tiles; UV1 uses metres.
            u, v = point[axes[0]], point[axes[1]]
            data.uv_layers[0].data[loop_index].uv = (u, v)
            data.uv_layers[1].data[loop_index].uv = (u / .24, v / 1.60)
            data.uv_layers[2].data[loop_index].uv = (0, 0)
    data.uv_layers[0].active_render = True
    parts_report.append({'name': obj.name, 'group': obj['curiosity_group'], 'faces': len(data.polygons),
                         'material': data.materials[0].name,
                         'bounds': [[min((obj.matrix_world @ Vector(corner))[a] for corner in obj.bound_box) for a in range(3)],
                                    [max((obj.matrix_world @ Vector(corner))[a] for corner in obj.bound_box) for a in range(3)]]})
bpy.ops.object.select_all(action='DESELECT')
for obj in new_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = new_objects[0]
bpy.ops.object.join()
shelf = bpy.context.object
shelf.name = 'CenterCuriosityShelf'
shelf['curiosity_groups'] = json.dumps(hotspots)
shelf['lightmap_atlas_pending'] = True
shelf['center_shelf_physical_bounds'] = json.dumps([[-.38, -3.5, 0], [.38, .5, 1.30]])
mesh.update()
assert protected_uv == [digest_uv(layer) for layer in mesh.uv_layers], 'Original room UVs changed.'
assert hinge_before == [list(row) for row in hinge.matrix_world], 'Hero book hinge changed.'
scene['room_depth_lightmap_needs_rebake'] = True
scene['curiosity_geometry_version'] = 1
report = {'source': str(SOURCE), 'output': str(OUTPUT), 'bottles': bottle_report,
          'contacts': contacts, 'hotspots': hotspots, 'parts': parts_report,
          'new_static_mesh': shelf.name, 'new_vertices': len(shelf.data.vertices),
          'new_triangles': len(shelf.data.polygons), 'original_uv_hashes': protected_uv,
          'old_uvs_preserved': True, 'hero_hinge_preserved': True,
          'shelf_footprint_blender': [[-.38, -3.5], [.38, .5]],
          'review_cameras': {'west': [[-1.17, -2.50, 1.62], [-.12, -1.50, 1.08]],
                             'east': [[1.17, -2.50, 1.62], [.12, -1.50, 1.08]],
                             'bottles_west': [[-1.40, -1.25, 1.64], [-2.60, -.8, 1.33]],
                             'bottles_east': [[1.30, -2.05, 1.67], [2.55, -.85, 1.32]]}}
(ART / 'curiosity-geometry-report.json').write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT), compress=True)
print('CURIOSITY_GEOMETRY ' + json.dumps({key: report[key] for key in ('output', 'new_vertices', 'new_triangles',
    'old_uvs_preserved', 'hero_hinge_preserved', 'hotspots')}), flush=True)
