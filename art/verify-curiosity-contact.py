"""Read-only native geometry checks; updates only the contact evidence JSON."""
import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = args.root
bpy.ops.wm.open_mainfile(filepath=str(root / 'art/room-curiosities.blend'), load_ui=False)
report_path = root / 'art/curiosity-geometry-report.json'
report = json.loads(report_path.read_text())
points, faces = [], []
for obj in [bpy.data.objects['OldCuriosityShop'], bpy.data.objects['CenterCuriosityShelf']]:
    offset = len(points)
    points.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
    for face in obj.data.polygons:
        name = obj.data.materials[face.material_index].name.lower()
        if any(term in name for term in ('walnut', 'ebony', 'stone', 'bronze')):
            faces.append([offset + index for index in face.vertices])
tree = BVHTree.FromPolygons(points, faces, all_triangles=False)
shop = bpy.data.objects['OldCuriosityShop']
mesh = shop.data


def vertices_for(predicate):
    indices = set()
    for face in mesh.polygons:
        if predicate(mesh.materials[face.material_index].name):
            indices.update(face.vertices)
    return [shop.matrix_world @ mesh.vertices[index].co for index in indices]


def measured_support(x, y, bottom):
    hit, _, _, _ = tree.ray_cast(Vector((x, y, bottom + .003)), Vector((0, 0, -1)), 2)
    assert hit is not None, ('No fitted support', x, y)
    return float(hit.z), float(bottom - hit.z)


bodies = vertices_for(lambda name: name.startswith('Dusty bottle '))
maximum = 0
for item in report['bottles']:
    x, y = item['new_xy']
    matches = [point for point in bodies if abs(point.x - x) < .070 and abs(point.y - y) < .070]
    bottom = min(point.z for point in matches)
    support, gap = measured_support(x, y, bottom)
    item.update(measured_bottom_m=bottom, measured_support_m=support, measured_after_gap_m=gap)
    assert -.00001 <= gap <= .0015, ('Bottle support gap', x, y, gap)
    maximum = max(maximum, gap)

maps = vertices_for(lambda name: name == 'Centuries of foxing in rag paper')
maps = [p for p in maps if 1.25 < p.x < 2.02 and -1.85 < p.y < -1.10 and .75 < p.z < 1.0]
map_bottom = min(p.z for p in maps)
map_support, map_gap = measured_support(1.64, -1.48, map_bottom)
assert -.00001 <= map_gap <= .0015, ('Map stack support gap', map_gap)
book_indices = set()
for face in mesh.polygons:
    name = mesh.materials[face.material_index].name
    center = shop.matrix_world @ face.center
    # Use face centers to separate the globe stack from the adjacent taller
    # floor stack, whose overhanging corners reach this stack's broad bounds.
    if (name.startswith('Book cloth ') or name == 'Antique paper') and \
            1.90 < center.x < 2.20 and .55 < center.y < 1.10 and .55 < center.z < .90:
        book_indices.update(face.vertices)
book_points = [shop.matrix_world @ mesh.vertices[index].co for index in book_indices]
globe_stack_bottom = min(p.z for p in book_points)
globe_support, globe_gap = measured_support(2.05, .82, globe_stack_bottom)
assert -.00001 <= globe_gap <= .0015, ('Globe stack support gap', globe_gap)
for item in report['contacts']:
    if item['assembly'] == 'center shelf foot':
        x, y = item['xy']
        bottom = item['bottom_m']
        # Begin just below the foot, so its own closed volume is excluded.
        hit, _, _, _ = tree.ray_cast(Vector((x, y, bottom - .0001)), Vector((0, 0, -1)), 1)
        item['measured_after_gap_m'] = float(bottom - hit.z)
        assert abs(item['measured_after_gap_m'] - .0005) < .0001
    elif item['assembly'] == 'loose map stack':
        item.update(measured_bottom_m=map_bottom, measured_support_m=map_support, measured_after_gap_m=map_gap)
    elif item['assembly'] == 'globe and book stack':
        item.update(measured_bottom_m=globe_stack_bottom, measured_support_m=globe_support, measured_after_gap_m=globe_gap)

base_names = ('Creased archive folder', 'Experimental instrument enclosure', 'Mantel clock foot',
              'Sky observations folder', 'Manuscript leather slipcase', 'Curious artifact fitted timber base')
tray_checks = []
for name in base_names:
    matching = [part for part in report['parts'] if part['name'].startswith(name)]
    assert len(matching) == 1, (name, len(matching))
    part = matching[0]
    bottom = part['bounds'][0][2]
    gap = bottom - 1.044
    assert -.00001 <= gap <= .001, ('Curiosity tray gap', name, gap)
    tray_checks.append({'group': part['group'], 'base': name, 'gap_m': gap})
report['contact_verification'] = {
    'bottles_checked': len(report['bottles']), 'caps_moved': sum(b['caps_moved'] for b in report['bottles']),
    'labels_moved': sum(b['labels_moved'] for b in report['bottles']), 'maximum_bottle_gap_m': maximum,
    'shelf_feet_checked': 6, 'map_stack_gap_m': map_gap, 'globe_stack_gap_m': globe_gap,
    'new_curiosity_base_checks': tray_checks,
}
report_path.write_text(json.dumps(report, indent=2) + '\n')
print('CONTACT_VERIFICATION ' + json.dumps(report['contact_verification']), flush=True)
