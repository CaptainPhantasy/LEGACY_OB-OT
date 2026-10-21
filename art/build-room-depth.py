"""Cycles lighting delivery for the existing shop; run with Blender 4.5.

blender -b --python art/build-room-depth.py -- --root /absolute/project --stage prepare
Stages: prepare, repair-atlas, preview, bake, export-only, review, beauty. Originals are never overwritten.
The exported bake review intentionally isolates diffuse lighting; it is not a
claim that the browser's reflections, postprocessing or interaction were tested.
"""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import zlib
import numpy as np

import bpy
import bmesh
from mathutils import Vector


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--stage', choices=['prepare', 'repair-atlas', 'preview', 'bake', 'export-only', 'review', 'beauty'], required=True)
    parser.add_argument('--samples', type=int)
    parser.add_argument('--resolution', type=int, default=4096)
    parser.add_argument('--width', type=int, default=1400)
    parser.add_argument('--light-scale', type=float, default=1.0)
    parser.add_argument('--views', default='entrance,table,close')
    parser.add_argument('--device', choices=['METAL', 'CPU'], default='METAL')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


ARGS = arguments()
ROOT = ARGS.root.resolve()
ART = ROOT / 'art'
ASSETS = ROOT / 'dist' / 'assets'
NATIVE = ART / 'room-depth.blend'
EXPORT = ASSETS / 'bookstore-depth.glb'
LIGHTMAP = ASSETS / 'room-lightmap.png'
MANIFEST = ASSETS / 'room-lightmap.json'
REPORT = ART / 'room-depth-report.json'
BAKE_UV = 'RoomLightmapUV'
DETAIL_UV = 'RoomSurfaceUV'
SCALE = 8.0
VIEWS = {
    'entrance': ((0, -6.60, 1.60), (0, 5.4, 1.25), 36.9),
    'table': ((.35, 3.48, 1.82), (0, 4.92, 1.06), 34),
    'close': ((.55, 4.00, 1.68), (0, 4.92, 1.07), 40),
}


def note(message, **data):
    print('ROOM_DEPTH ' + json.dumps({'message': message, **data}), flush=True)


def report_update(**data):
    result = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    result.update(data)
    REPORT.write_text(json.dumps(result, indent=2) + '\n')


def configure(samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = .02
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 6
    scene.cycles.glossy_bounces = 6
    scene.cycles.transmission_bounces = 8
    scene.cycles.volume_bounces = 2
    scene.cycles.transparent_max_bounces = 12
    scene.cycles.device = 'CPU'
    if ARGS.device == 'METAL':
        preferences = bpy.context.preferences.addons['cycles'].preferences
        try:
            preferences.compute_device_type = 'METAL'
            preferences.get_devices()
            metal = [device for device in preferences.devices if device.type == 'METAL']
            if not metal:
                raise RuntimeError('No Metal device was enumerated')
            for device in preferences.devices:
                device.use = device.type == 'METAL'
            scene.cycles.device = 'GPU'
            note('Metal rendering enabled', devices=[device.name for device in metal])
        except (TypeError, RuntimeError) as error:
            note('Metal unavailable; CPU explicitly reported', reason=str(error))
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = .25
    scene.render.resolution_x = ARGS.width
    scene.render.resolution_y = round(ARGS.width * 10 / 16)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    return scene


def principal(material):
    if not material or not material.use_nodes:
        return None
    return next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


def family(name):
    name = name.lower()
    groups = [
        ('wood', ('walnut', 'ebony', 'joinery')),
        ('leather', ('leather', 'rawhide')),
        ('cloth', ('cloth', 'linen', 'canvas', 'rug', 'hemp', 'thread')),
        ('paper', ('paper', 'leaf', 'page edges')),
        ('metal', ('brass', 'bronze', 'iron', 'copper', 'gilt', 'gold leaf')),
        ('mineral', ('plaster', 'stone', 'brick', 'pottery')),
        ('glass', ('bottle', 'blown glass')),
    ]
    return next((kind for kind, words in groups if any(word in name for word in words)), None)


def ensure_uvs(obj):
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name='UVMap')
    mesh.uv_layers[0].name = 'UVMap'
    while len(mesh.uv_layers) < 3:
        mesh.uv_layers.new(name=DETAIL_UV if len(mesh.uv_layers) == 1 else BAKE_UV, do_init=True)
    mesh.uv_layers[1].name = DETAIL_UV
    mesh.uv_layers[2].name = BAKE_UV
    mesh.uv_layers.active_index = 0
    mesh.uv_layers[0].active_render = True


def pin_original_texture_uvs(material):
    if not material.use_nodes:
        return
    nodes, links = material.node_tree.nodes, material.node_tree.links
    uv = nodes.new('ShaderNodeUVMap')
    uv.name = 'Explicit original UV0'
    uv.uv_map = 'UVMap'
    for node in list(nodes):
        if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
            links.new(uv.outputs['UV'], node.inputs['Vector'])
        elif node.type == 'TEX_COORD':
            for link in list(node.outputs['UV'].links):
                links.new(uv.outputs['UV'], link.to_socket)
        elif node.type == 'NORMAL_MAP' and not node.uv_map:
            node.uv_map = 'UVMap'


def bevel_shelf_books(shop):
    """Only untouched, closed six-face cloth cuboids, never the hero leather."""
    bm = bmesh.new()
    bm.from_mesh(shop.data)
    cloth = {i for i, m in enumerate(shop.data.materials) if m and m.name.startswith('Book cloth ')}
    candidates = {face for face in bm.faces if face.material_index in cloth}
    edges, cuboids = set(), 0
    while candidates:
        first = candidates.pop()
        pending, component = [first], {first}
        while pending:
            face = pending.pop()
            for edge in face.edges:
                for adjacent in edge.link_faces:
                    if adjacent in candidates:
                        candidates.remove(adjacent)
                        component.add(adjacent)
                        pending.append(adjacent)
        vertices = {v for face in component for v in face.verts}
        component_edges = {edge for face in component for edge in face.edges}
        if len(component) == 6 and len(vertices) == 8 and len(component_edges) == 12:
            if all(len(e.link_faces) == 2 and all(f in component for f in e.link_faces) for e in component_edges):
                edges.update(component_edges)
                cuboids += 1
    before = len(bm.verts)
    if edges:
        bmesh.ops.bevel(bm, geom=list(edges), offset=.0015, segments=3,
                        affect='EDGES', profile=.5, clamp_overlap=True,
                        loop_slide=True, harden_normals=True)
        bm.normal_update()
        bm.to_mesh(shop.data)
        shop.data.update()
    after = len(bm.verts)
    bm.free()
    return {'cuboids': cuboids, 'edges': len(edges), 'vertices_before': before, 'vertices_after': after,
            'width_metres': .0015, 'segments': 3}


def atlas(shop):
    bpy.ops.object.select_all(action='DESELECT')
    shop.hide_set(False)
    shop.select_set(True)
    bpy.context.view_layer.objects.active = shop
    shop.data.uv_layers.active_index = 2
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0,
                             area_weight=0, correct_aspect=True, scale_to_bounds=True)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=8 / ARGS.resolution)
    bpy.ops.object.mode_set(mode='OBJECT')
    values = [value for uv in shop.data.uv_layers[2].data for value in uv.uv]
    if not values or any(not math.isfinite(x) or x < -1e-5 or x > 1.00001 for x in values):
        raise RuntimeError('The unique lightmap UVs are not finite and bounded')
    shop.data.uv_layers[0].active_render = True
    note('Unique lightmap atlas prepared', loops=len(values) // 2, padding_pixels=8)


def polish_surface_normals(shop):
    """Keep architectural corners crisp while lamps, bottles and bevels curve."""
    bm = bmesh.new()
    bm.from_mesh(shop.data)
    for face in bm.faces:
        face.smooth = True
    for edge in bm.edges:
        edge.smooth = edge.is_manifold and edge.calc_face_angle(0) < math.radians(40)
    bm.to_mesh(shop.data)
    bm.free()
    shop.data.update()
    # Large flat faces dominate their small bevels; no wavy wall shading.
    normal = shop.modifiers.new('Area weighted hard surface normals', 'WEIGHTED_NORMAL')
    normal.keep_sharp = True
    normal.weight = 50


def native_surface(material):
    p = principal(material)
    kind = family(material.name)
    if not p or not kind:
        return
    nodes, links = material.node_tree.nodes, material.node_tree.links
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeVectorMath')
    mapping.operation = 'MULTIPLY'
    mapping.inputs[1].default_value = (90, 2.0, 90) if kind == 'wood' else (12, 12, 12)
    links.new(coord.outputs['Object'], mapping.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1
    noise.inputs['Detail'].default_value = 3
    noise.inputs['Roughness'].default_value = .65
    links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    fine = nodes.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = 110
    fine.inputs['Detail'].default_value = 2
    links.new(coord.outputs['Object'], fine.inputs['Vector'])
    mix = nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = .28
    links.new(noise.outputs['Fac'], mix.inputs[1])
    links.new(fine.outputs['Fac'], mix.inputs[2])
    ramp = nodes.new('ShaderNodeValToRGB')
    low, high = {'wood': (.67, .96), 'cloth': (.78, .98), 'paper': (.79, .98),
                 'leather': (.62, .96), 'metal': (.36, .79), 'mineral': (.82, .99),
                 'glass': (.20, .43)}[kind]
    ramp.color_ramp.elements[0].color = (low, low, low, 1)
    ramp.color_ramp.elements[1].color = (high, high, high, 1)
    links.new(mix.outputs[0], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], p.inputs['Roughness'])
    if kind in ('wood', 'mineral') and not p.inputs['Normal'].is_linked:
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .23
        bump.inputs['Distance'].default_value = .0006 if kind == 'wood' else .0010
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], p.inputs['Normal'])
    if kind == 'paper':
        p.inputs['Subsurface Weight'].default_value = .08
        p.inputs['Subsurface Radius'].default_value = (.0015, .0008, .0004)
        p.inputs['Subsurface Scale'].default_value = 1


def shadow_transparent_lamps():
    for material in bpy.data.materials:
        if material.name not in ('Amber blown glass', 'Warm lamp glow') or not material.use_nodes:
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
        surface = output.inputs['Surface'].links[0].from_socket
        path = nodes.new('ShaderNodeLightPath')
        transparent = nodes.new('ShaderNodeBsdfTransparent')
        mix = nodes.new('ShaderNodeMixShader')
        links.new(path.outputs['Is Shadow Ray'], mix.inputs[0])
        links.new(surface, mix.inputs[1])
        links.new(transparent.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], output.inputs['Surface'])


def area(name, location, target, energy, size, temperature, rectangle=False):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy * ARGS.light_scale
    data.shape = 'RECTANGLE' if rectangle else 'DISK'
    data.size = size
    if rectangle:
        data.size_y = size * .7
    data.use_nodes = True
    blackbody = data.node_tree.nodes.new('ShaderNodeBlackbody')
    blackbody.inputs['Temperature'].default_value = temperature
    emission = next(node for node in data.node_tree.nodes if node.type == 'EMISSION')
    data.node_tree.links.new(blackbody.outputs['Color'], emission.inputs['Color'])
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def new_lighting(quarantine_existing=True):
    if quarantine_existing:
        for obj in list(bpy.context.scene.objects):
            if obj.type == 'LIGHT':
                obj.hide_render = True
                obj.hide_set(True)
                obj['room_depth_quarantined_original_light'] = True
    fixtures = [((-1.55, -4.47, 2.402), 100, .30), ((1.46, .63, 2.485), 90, .30),
                ((-1.30, 6.65, 2.403), 75, .28), ((-.86, 5.66, 1.31), 9, .17)]
    for i, (position, energy, size) in enumerate(fixtures):
        target = (position[0] * .25, position[1], .20)
        area('Room depth warm fixture %02d' % i, position, target, energy, size, 2700)
        if i < 3:
            area('Room depth lantern upper spill %02d' % i, position,
                 (position[0], position[1], 3.25), energy * .22, size, 2700)
    area('Room depth cool entrance', (0, -7.20, 2.25), (0, .9, 1.25), 150, 3.0, 5000, True)
    area('Room depth soft front-room lift', (0, -2.9, 2.98), (0, -.5, .9), 35, 2.0, 4300)
    area('Room depth soft back-room lift', (.25, 4.5, 2.98), (0, 5.0, .85), 32, 1.8, 3900)
    world = bpy.context.scene.world or bpy.data.worlds.new('Room depth world')
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (.55, .65, .80, 1)
    background.inputs['Strength'].default_value = .045
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'PRINCIPLED_VOLUME':
                node.inputs['Density'].default_value = .009
                node.inputs['Anisotropy'].default_value = .55


def prepare():
    bpy.ops.wm.open_mainfile(filepath=str(ART / 'antique-bookstore.blend'), load_ui=False)
    scene = configure(1024)
    shop = bpy.data.objects['OldCuriosityShop']
    hinge = bpy.data.objects['BookCoverHinge']
    hinge_state = [list(hinge.location), list(hinge.rotation_euler), list(hinge.scale)]
    for obj in scene.objects:
        if obj.type == 'MESH' and obj.name != 'Render-only dust':
            ensure_uvs(obj)
    bevel = bevel_shelf_books(shop)
    polish_surface_normals(shop)
    for material in list(bpy.data.materials):
        pin_original_texture_uvs(material)
        native_surface(material)
    shadow_transparent_lamps()
    new_lighting()
    atlas(shop)
    scene['room_depth_version'] = 1
    scene['room_depth_source'] = 'antique-bookstore.blend preserved without modification'
    scene['room_depth_light_scale'] = ARGS.light_scale
    bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
    report_update(prepare={'blender': bpy.app.version_string, 'bevel': bevel,
                          'hinge_transform': hinge_state, 'static_vertices': len(shop.data.vertices),
                          'uv_layers': [uv.name for uv in shop.data.uv_layers],
                          'light_scale': ARGS.light_scale, 'samples_ceiling': 1024,
                          'native': str(NATIVE.relative_to(ROOT)),
                          'native_only': ['procedural roughness/bump', 'paper subsurface', 'volume', 'AgX display transform']})
    note('Prepared native checkpoint saved', path=str(NATIVE), bevel=bevel)


def volume_objects():
    result = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        if any(material and material.use_nodes and any(node.type == 'PRINCIPLED_VOLUME' for node in material.node_tree.nodes)
               for material in obj.data.materials):
            result.append(obj)
    return result


def is_hinge_child(obj):
    parent = obj.parent
    while parent:
        if parent.name.startswith('BookCoverHinge'):
            return True
        parent = parent.parent
    return False


def png_chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)


def atlas_coverage(shop, resolution, strict=True):
    """Measure interior overlaps and their owners without weakening the bake gate."""
    mesh = shop.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers[2].data
    coverage = np.zeros((resolution, resolution), dtype=np.uint16)
    owners = np.full((resolution, resolution), -1, dtype=np.int32)
    degenerate = 0
    degenerate_positive_area_faces = set()
    conflict_faces, collision_pairs = set(), {}
    for triangle_index, triangle in enumerate(mesh.loop_triangles):
        a, b, c = [(uv[index].uv.x * resolution - .5, uv[index].uv.y * resolution - .5) for index in triangle.loops]
        x0 = max(0, math.ceil(min(a[0], b[0], c[0])))
        x1 = min(resolution - 1, math.floor(max(a[0], b[0], c[0])))
        y0 = max(0, math.ceil(min(a[1], b[1], c[1])))
        y1 = min(resolution - 1, math.floor(max(a[1], b[1], c[1])))
        denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(denominator) < 1e-9:
            degenerate += 1
            if triangle.area > 1e-12:
                degenerate_positive_area_faces.add(triangle.polygon_index)
            continue
        if x1 < x0 or y1 < y0:
            continue
        yy, xx = np.ogrid[y0:y1 + 1, x0:x1 + 1]
        wa = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / denominator
        wb = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / denominator
        # Exclude shared triangle edges from overlap accounting.
        inside = (wa > 1e-6) & (wb > 1e-6) & ((wa + wb) < 1 - 1e-6)
        region = coverage[y0:y1 + 1, x0:x1 + 1]
        owner_region = owners[y0:y1 + 1, x0:x1 + 1]
        collision = inside & (region > 0)
        if collision.any():
            conflict_faces.add(triangle.polygon_index)
            previous, counts = np.unique(owner_region[collision], return_counts=True)
            for previous_index, count in zip(previous, counts):
                previous_triangle = mesh.loop_triangles[int(previous_index)]
                conflict_faces.add(previous_triangle.polygon_index)
                key = (int(previous_index), triangle_index)
                collision_pairs[key] = collision_pairs.get(key, 0) + int(count)
        owner_region[inside & (owner_region < 0)] = triangle_index
        region += inside.astype(np.uint16)
    occupied = coverage > 0
    stats = {'occupied_texels': int(occupied.sum()), 'atlas_coverage_fraction': float(occupied.mean()),
             'interior_overlap_texels': int((coverage > 1).sum()), 'degenerate_uv_triangles': degenerate,
             'positive_area_degenerate_uv_faces': sorted(degenerate_positive_area_faces),
             'conflicting_faces': sorted(conflict_faces), 'collision_triangle_pair_count': len(collision_pairs)}
    details = []
    for (first, second), count in sorted(collision_pairs.items(), key=lambda item: item[1], reverse=True)[:40]:
        pair = [mesh.loop_triangles[first], mesh.loop_triangles[second]]
        areas_uv = []
        for tri in pair:
            a, b, c = [uv[index].uv for index in tri.loops]
            areas_uv.append(abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * .5)
        details.append({'triangle_indices': [first, second], 'face_indices': [t.polygon_index for t in pair],
                        'overlap_texels': count, 'shared_vertices': len(set(pair[0].vertices) & set(pair[1].vertices)),
                        'world_area_m2': [float(t.area) for t in pair], 'uv_area': areas_uv,
                        'materials': [mesh.materials[t.material_index].name for t in pair]})
    stats['collision_examples'] = details
    if strict and stats['interior_overlap_texels']:
        raise RuntimeError('Unique UV atlas contains overlapping triangle interiors: ' + json.dumps(stats))
    if not stats['occupied_texels']:
        raise RuntimeError('UV atlas has no measurable texel coverage')
    return occupied, stats


def uv0_signature(mesh):
    """UV0 coordinates may be repeated by triangulation, but never relocated."""
    values = {}
    uv = mesh.uv_layers[0].data
    for loop in mesh.loops:
        coordinate = tuple(round(float(value), 7) for value in uv[loop.index].uv)
        values.setdefault(loop.vertex_index, set()).add(coordinate)
    return values


def mesh_positions(mesh):
    values = array.array('f', [0.0]) * (len(mesh.vertices) * 3)
    mesh.vertices.foreach_get('co', values)
    return values.tobytes()


def isolate_conflicting_uv_faces(shop, face_indices):
    """Triangulate only specified faces; retain topology, UV0 and materials elsewhere."""
    bm = bmesh.new()
    bm.from_mesh(shop.data)
    bm.faces.ensure_lookup_table()
    targets = [bm.faces[index] for index in sorted(face_indices)]
    original_triangles = [face for face in targets if len(face.verts) == 3]
    ngons = [face for face in targets if len(face.verts) > 3]
    created = bmesh.ops.triangulate(bm, faces=ngons, quad_method='BEAUTY', ngon_method='BEAUTY')['faces'] if ngons else []
    # BMesh can reuse an original face for one output triangle. Include both
    # returned faces and surviving targets instead of depending on reuse details.
    surviving = [face for face in targets if face.is_valid and len(face.verts) == 3]
    isolated = list(set(original_triangles + list(created) + surviving))
    uv = bm.loops.layers.uv.get(BAKE_UV)
    if uv is None:
        bm.free()
        raise RuntimeError('Unique lightmap layer missing during targeted repair')
    repaired = 0
    for ordinal, face in enumerate(isolated):
        if not face.is_valid or len(face.verts) != 3:
            continue
        vertices = [loop.vert.co for loop in face.loops]
        # Put the longest edge on the horizontal axis for a stable planar triangle.
        first, second = max([(0, 1), (1, 2), (2, 0)], key=lambda pair: (vertices[pair[1]] - vertices[pair[0]]).length_squared)
        third = 3 - first - second
        origin = vertices[first]
        tangent = vertices[second] - origin
        normal = tangent.cross(vertices[third] - origin)
        if tangent.length_squared < 1e-24 or normal.length_squared < 4e-24:
            continue  # Existing zero-area geometry cannot acquire a physical lightmap surface.
        tangent.normalize()
        normal.normalize()
        bitangent = normal.cross(tangent)
        # Unique remote offsets prevent neighboring repaired faces from becoming
        # a shared island before the global density normalization and packing.
        # Keep offsets small: huge UV coordinates lose tiny bevel-triangle
        # precision because Blender stores UV coordinates as float32.
        offset = Vector((2.0 + (ordinal % 31) * .0311, 2.0 + (ordinal // 31) * .0297))
        for loop in face.loops:
            delta = loop.vert.co - origin
            loop[uv].uv = (delta.dot(tangent) + offset.x, delta.dot(bitangent) + offset.y)
        repaired += 1
    bm.normal_update()
    bm.to_mesh(shop.data)
    bm.free()
    shop.data.update()
    bpy.ops.object.select_all(action='DESELECT')
    shop.hide_set(False)
    shop.select_set(True)
    bpy.context.view_layer.objects.active = shop
    shop.data.uv_layers.active_index = 2
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=8 / ARGS.resolution)
    bpy.ops.object.mode_set(mode='OBJECT')
    return {'target_faces': len(targets), 'triangulated_ngons': len(ngons), 'isolated_triangles': repaired}


def repair_atlas():
    """Repair the existing checkpoint without repeating bevels or lighting edits."""
    import shutil
    backup = ART / 'room-depth-before-atlas-repair.blend'
    if not backup.exists():
        shutil.copy2(NATIVE, backup)
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    shop = bpy.data.objects['OldCuriosityShop']
    positions_before = mesh_positions(shop.data)
    uv0_before = uv0_signature(shop.data)
    hinge = bpy.data.objects['BookCoverHinge']
    hinge_before = [tuple(hinge.location), tuple(hinge.rotation_euler), tuple(hinge.scale)]
    history = []
    for attempt in range(4):
        _, stats = atlas_coverage(shop, ARGS.resolution, strict=False)
        history.append({'inspection': stats})
        (ART / 'room-atlas-repair-diagnostics.json').write_text(json.dumps(history, indent=2) + '\n')
        note('Targeted atlas inspection', attempt=attempt, overlap_texels=stats['interior_overlap_texels'],
             conflicting_faces=len(stats['conflicting_faces']), collapsed_positive_area_faces=len(stats['positive_area_degenerate_uv_faces']),
             coverage=stats['atlas_coverage_fraction'], collision_examples=stats['collision_examples'][:8])
        targets = set(stats['conflicting_faces']) | set(stats['positive_area_degenerate_uv_faces'])
        if not targets:
            if mesh_positions(shop.data) != positions_before:
                raise RuntimeError('Atlas repair changed vertex positions')
            if uv0_signature(shop.data) != uv0_before:
                raise RuntimeError('Atlas repair changed original material UV0 coordinates')
            if [tuple(hinge.location), tuple(hinge.rotation_euler), tuple(hinge.scale)] != hinge_before:
                raise RuntimeError('Atlas repair changed the book hinge')
            # Repeat the unchanged strict gate used by the actual bake.
            _, verified = atlas_coverage(shop, ARGS.resolution)
            shop.data.uv_layers.active_index = 0
            shop.data.uv_layers[0].active_render = True
            bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
            report_update(atlas_repair={'attempts': history, 'verified': verified,
                                       'vertex_positions_unchanged': True, 'uv0_unchanged': True,
                                       'hinge_unchanged': True, 'backup': str(backup.relative_to(ROOT))})
            note('Atlas repair verified and saved', overlap_texels=verified['interior_overlap_texels'],
                 occupied_texels=verified['occupied_texels'], path=str(NATIVE))
            return
        if attempt == 3:
            break
        history[-1]['repair'] = isolate_conflicting_uv_faces(shop, targets)
        note('Targeted UV islands repaired and repacked', **history[-1]['repair'])
    raise RuntimeError('Targeted atlas repair did not converge; original native checkpoint remains unchanged. Inspect room-atlas-repair-diagnostics.json')


def save_lightmap(image, path, occupied):
    """Encode float scene-linear / SCALE with the sRGB transfer only, no view transform."""
    width, height = image.size
    pixels = array.array('f', [0.0]) * (width * height * 4)
    image.pixels.foreach_get(pixels)
    rgb = np.frombuffer(pixels, dtype=np.float32).reshape(height, width, 4)[..., :3]
    measured = rgb[occupied]
    nonfinite = int((~np.isfinite(measured)).sum())
    if nonfinite:
        raise RuntimeError('Bake contains non-finite values on occupied texels')
    maximum = float(measured.max())
    scale = min(64.0, max(SCALE, 2 ** math.ceil(math.log2(max(maximum, 1e-6)))))
    compressor = zlib.compressobj(6)
    compressed = []
    clipped, all_nonfinite = 0, 0
    black = 0
    for y in range(height - 1, -1, -1):
        row = bytearray(1 + width * 3)
        for x in range(width):
            base = (y * width + x) * 4
            if pixels[base] + pixels[base + 1] + pixels[base + 2] < 1e-7:
                black += 1
            for channel in range(3):
                value = pixels[base + channel]
                if not math.isfinite(value):
                    all_nonfinite += 1
                    value = 0.0
                if value > scale:
                    clipped += 1
                value = max(0.0, min(1.0, value / scale))
                encoded = 12.92 * value if value <= .0031308 else 1.055 * value ** (1 / 2.4) - .055
                row[1 + x * 3 + channel] = round(255 * encoded)
        compressed.append(compressor.compress(row))
    compressed.append(compressor.flush())
    png = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += png_chunk(b'sRGB', b'\0') + png_chunk(b'IDAT', b''.join(compressed)) + png_chunk(b'IEND', b'')
    path.write_bytes(png)
    stats = {'max_linear_occupied': maximum, 'mean_linear_occupied': float(measured.mean()),
             'linear_percentiles_occupied': dict(zip(['p01', 'p50', 'p95', 'p9999'], [float(v) for v in np.percentile(measured, [1, 50, 95, 99.99])])),
             'channels_clipped': clipped, 'fraction_occupied_channels_clipped': float((measured > scale).mean()),
             'nonfinite_channels': all_nonfinite, 'black_pixels_including_unused_atlas': black,
             'total_pixels': width * height, 'bytes': len(png)}
    if all_nonfinite:
        raise RuntimeError('Bake contains non-finite values; output is not accepted')
    return stats, scale


def solid_image():
    image = bpy.data.images.get('Room UV export white') or bpy.data.images.new('Room UV export white', width=1, height=1)
    image.pixels = (1, 1, 1, 1)
    image.pack()
    return image


def connected_image(socket):
    if not socket or not socket.is_linked:
        return None
    node = socket.links[0].from_node
    if node.type == 'TEX_IMAGE':
        return node.image
    return None


def export_material(source, static):
    """Explicit portable graph and all three referenced UV channels for glTF."""
    original = principal(source)
    result = bpy.data.materials.new(source.name + ' / delivery')
    result.use_nodes = True
    result.diffuse_color = source.diffuse_color
    result['original_material_name'] = source.name
    nodes, links = result.node_tree.nodes, result.node_tree.links
    p = nodes.get('Principled BSDF')
    if original:
        for key in ['Base Color', 'Metallic', 'Roughness', 'IOR', 'Alpha', 'Emission Color', 'Emission Strength',
                    'Coat Weight', 'Coat Roughness', 'Transmission Weight']:
            p.inputs[key].default_value = original.inputs[key].default_value
    coords = []
    for name in ['UVMap', DETAIL_UV, BAKE_UV]:
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = name
        coords.append(uv)
    color = nodes.new('ShaderNodeTexImage')
    color.image = connected_image(original.inputs['Base Color']) if original else None
    # The white image keeps UV0 in glTF; it is not an authored surface image.
    # Runtime may replace this placeholder with the existing family color map.
    result['room_depth_placeholder_color'] = color.image is None
    alpha = float(p.inputs['Alpha'].default_value)
    factor = list(p.inputs['Base Color'].default_value[:3]) if color.image is None else [1.0, 1.0, 1.0]
    factor.append(alpha)
    result['room_depth_base_color_factor'] = factor
    color.image = color.image or solid_image()
    links.new(coords[0].outputs[0], color.inputs['Vector'])
    # Keep image pixels untouched. Blender can flatten a MixRGB constant into
    # the exported image, which loses that factor when runtime replaces a white
    # placeholder. The exact linear factor is installed into glTF JSON below.
    p.inputs['Base Color'].default_value = (1, 1, 1, 1)
    links.new(color.outputs['Color'], p.inputs['Base Color'])
    kind = family(source.name)
    rough_path = ASSETS / 'surfaces' / ((kind or '') + '-roughness.png')
    rough = nodes.new('ShaderNodeTexImage')
    rough.image = bpy.data.images.load(str(rough_path), check_existing=True) if kind and rough_path.exists() else solid_image()
    rough.image.colorspace_settings.name = 'Non-Color' if rough.image.name != 'Room UV export white' else 'sRGB'
    separate = nodes.new('ShaderNodeSeparateColor')
    links.new(coords[1].outputs[0], rough.inputs['Vector'])
    links.new(rough.outputs['Color'], separate.inputs[0])
    if kind and rough_path.exists():
        links.new(separate.outputs['Green'], p.inputs['Roughness'])
    else:
        multiplier = nodes.new('ShaderNodeMath')
        multiplier.operation = 'MULTIPLY'
        multiplier.inputs[1].default_value = float(p.inputs['Roughness'].default_value)
        links.new(separate.outputs['Green'], multiplier.inputs[0])
        links.new(multiplier.outputs[0], p.inputs['Roughness'])
    if original and original.inputs['Normal'].is_linked:
        old_normal = original.inputs['Normal'].links[0].from_node
        if old_normal.type == 'NORMAL_MAP':
            normal_image = connected_image(old_normal.inputs['Color'])
            if normal_image:
                tex = nodes.new('ShaderNodeTexImage')
                tex.image = normal_image
                normal = nodes.new('ShaderNodeNormalMap')
                normal.uv_map = 'UVMap'
                normal.inputs['Strength'].default_value = old_normal.inputs['Strength'].default_value
                links.new(coords[0].outputs[0], tex.inputs['Vector'])
                links.new(tex.outputs['Color'], normal.inputs['Color'])
                links.new(normal.outputs[0], p.inputs['Normal'])
    # A neutral occlusion reference forces the unique UV layer to survive export.
    # Runtime replaces this neutral image with the separate irradiance lightMap.
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    occlusion = nodes.new('ShaderNodeGroup')
    occlusion.node_tree = group
    occtex = nodes.new('ShaderNodeTexImage')
    occtex.image = solid_image()
    links.new(coords[2].outputs[0], occtex.inputs['Vector'])
    links.new(occtex.outputs['Color'], occlusion.inputs['Occlusion'])
    result['room_depth_static'] = bool(static)
    return result


def project_delivery_detail_uv(obj):
    tiles = {'wood': (.24, 1.6), 'mineral': (.6, .6), 'cloth': (.08, .08), 'paper': (.18, .18),
             'leather': (.18, .18), 'metal': (.24, .24), 'glass': (.3, .3)}
    uv = obj.data.uv_layers[1]
    for polygon in obj.data.polygons:
        material = obj.data.materials[polygon.material_index]
        kind = family(material.name)
        tile = tiles.get(kind, (1, 1))
        normal = polygon.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for loop_index in polygon.loop_indices:
            point = obj.matrix_world @ obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            a, b = (point.x, point.y) if axis == 2 else ((point.y, point.z) if axis == 0 else (point.x, point.z))
            uv.data[loop_index].uv = (a / tile[0], b / tile[1])


def glb_document(path):
    content = path.read_bytes()
    if content[:4] != b'glTF':
        raise RuntimeError('Exporter did not produce a GLB')
    length, kind = struct.unpack_from('<II', content, 12)
    return json.loads(content[20:20 + length].decode('utf-8'))


def enforce_export_color_factors(path):
    """Write explicit linear material factors, preserving every binary payload byte."""
    content = path.read_bytes()
    magic, version, declared_length = struct.unpack_from('<4sII', content, 0)
    if magic != b'glTF' or version != 2 or declared_length != len(content):
        raise RuntimeError('Invalid GLB header before color-factor preservation')
    chunks, offset, document = [], 12, None
    while offset < len(content):
        length, kind = struct.unpack_from('<II', content, offset)
        payload = content[offset + 8:offset + 8 + length]
        if len(payload) != length:
            raise RuntimeError('Truncated GLB chunk')
        if kind == 0x4e4f534a:
            if document is not None:
                raise RuntimeError('Multiple GLB JSON chunks are not supported')
            document = json.loads(payload.decode('utf-8'))
        chunks.append((kind, payload))
        offset += 8 + length
    if document is None:
        raise RuntimeError('GLB contains no material document')
    factors = {}
    for material in document.get('materials', []):
        factor = material.get('extras', {}).get('room_depth_base_color_factor')
        if not isinstance(factor, list) or len(factor) != 4 or any(not math.isfinite(value) or value < 0 or value > 1 for value in factor):
            raise RuntimeError('Missing or invalid preserved base color factor: ' + material.get('name', '?'))
        pbr = material.setdefault('pbrMetallicRoughness', {})
        if 'baseColorTexture' not in pbr:
            raise RuntimeError('Delivery base texture reference was omitted: ' + material.get('name', '?'))
        pbr['baseColorFactor'] = factor
        factors[material.get('name', str(len(factors)))] = factor
    json_bytes = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * (-len(json_bytes) % 4)
    rebuilt = bytearray()
    for kind, payload in chunks:
        if kind == 0x4e4f534a:
            payload = json_bytes
        rebuilt.extend(struct.pack('<II', len(payload), kind))
        rebuilt.extend(payload)
    path.write_bytes(struct.pack('<4sII', b'glTF', 2, 12 + len(rebuilt)) + rebuilt)
    verified = glb_document(path)
    if any(material['pbrMetallicRoughness']['baseColorFactor'] != material['extras']['room_depth_base_color_factor']
           for material in verified['materials']):
        raise RuntimeError('Explicit color-factor verification failed after writing GLB')
    note('Explicit linear material color factors preserved', count=len(factors))
    return factors


def export_delivery():
    originals, export_cache = {}, {}
    excluded = set(volume_objects())
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and obj not in excluded:
            ensure_uvs(obj)
            project_delivery_detail_uv(obj)
            originals[obj.name] = list(obj.data.materials)
            for i, material in enumerate(list(obj.data.materials)):
                key = (material.name, obj.name == 'OldCuriosityShop')
                if key not in export_cache:
                    export_cache[key] = export_material(material, key[1])
                obj.data.materials[i] = export_cache[key]
            obj.select_set(True)
        elif obj.name == 'BookCoverHinge':
            obj.select_set(True)
    try:
        bpy.ops.export_scene.gltf(filepath=str(EXPORT), export_format='GLB', use_selection=True,
                                  export_apply=True, export_yup=True, export_lights=False,
                                  export_cameras=False, export_materials='EXPORT', export_texcoords=True,
                                  export_normals=True, export_extras=True)
    finally:
        for name, materials in originals.items():
            for i, material in enumerate(materials):
                bpy.data.objects[name].data.materials[i] = material
    color_factors = enforce_export_color_factors(EXPORT)
    doc = glb_document(EXPORT)
    static_nodes = [node for node in doc['nodes'] if node.get('name') == 'OldCuriosityShop']
    if len(static_nodes) != 1 or 'mesh' not in static_nodes[0]:
        raise RuntimeError('Expected one intact exported static room node')
    primitives = doc['meshes'][static_nodes[0]['mesh']]['primitives']
    for primitive in primitives:
        if not all('TEXCOORD_' + str(i) in primitive['attributes'] for i in range(3)):
            raise RuntimeError('Exporter omitted a required UV channel: ' + str(primitive['attributes']))
    if not any(node.get('name') == 'BookCoverHinge' for node in doc['nodes']):
        raise RuntimeError('The export lost the book hinge')
    note('Portable GLB verified', primitives=len(primitives), texcoords=[0, 1, 2])
    return {'path': str(EXPORT.relative_to(ROOT)), 'bytes': EXPORT.stat().st_size,
            'sha256': hashlib.sha256(EXPORT.read_bytes()).hexdigest(), 'static_primitives': len(primitives),
            'required_texcoords': [0, 1, 2], 'hinge_preserved': True,
            'explicit_base_color_factors': color_factors}


def export_only():
    """Re-export the checked native geometry without recalculating illumination."""
    import shutil
    if not MANIFEST.exists() or not LIGHTMAP.exists():
        raise RuntimeError('A completed lightmap and manifest are required for export-only')
    before_lightmap = hashlib.sha256(LIGHTMAP.read_bytes()).hexdigest()
    if EXPORT.exists():
        quarantine = ART / 'rendering.quarantine' / 'bookstore-depth-before-color-factor-fix.glb'
        quarantine.parent.mkdir(parents=True, exist_ok=True)
        if not quarantine.exists():
            shutil.copy2(EXPORT, quarantine)
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    retained_image = bpy.data.images.get('Room diffuse irradiance linear')
    retention_repaired = retained_image is None or not retained_image.use_fake_user
    if retained_image is None:
        exr = ART / 'room-lightmap-linear.exr'
        if not exr.exists():
            raise RuntimeError('The native scene lost its baked image and the recovery EXR is missing')
        retained_image = bpy.data.images.load(str(exr), check_existing=True)
        retained_image.name = 'Room diffuse irradiance linear'
        retained_image.colorspace_settings.name = 'Linear Rec.709'
    if retention_repaired:
        backup = ART / 'rendering.quarantine' / 'room-depth-before-lightmap-retention.blend'
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(NATIVE, backup)
        retained_image.use_fake_user = True
        retained_image.pack()
        bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
        note('Recovered and retained the native float illumination image', image=retained_image.name)
    before_native = hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    exported = export_delivery()
    if hashlib.sha256(LIGHTMAP.read_bytes()).hexdigest() != before_lightmap:
        raise RuntimeError('Export-only changed the completed illumination map')
    if hashlib.sha256(NATIVE.read_bytes()).hexdigest() != before_native:
        raise RuntimeError('Export-only changed the native checkpoint')
    manifest = json.loads(MANIFEST.read_text())
    manifest['export'] = exported
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    report_update(bake=manifest, export_only={'lightmap_unchanged': True, 'native_unchanged_during_export': True,
                                           'native_lightmap_retention_repaired': retention_repaired, 'export': exported})
    note('Delivery export refreshed without rebaking', path=str(EXPORT), sha256=exported['sha256'])


def bake():
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    scene = configure(ARGS.samples or 256)
    shop = bpy.data.objects['OldCuriosityShop']
    occupied, uv_stats = atlas_coverage(shop, ARGS.resolution)
    note('UV atlas measured before baking', **uv_stats)
    image = bpy.data.images.new('Room diffuse irradiance linear', width=ARGS.resolution, height=ARGS.resolution,
                                alpha=False, float_buffer=True)
    # Temporary bake-target nodes are removed after baking. Keep the packed
    # source image alive when this native checkpoint is reopened later.
    image.use_fake_user = True
    image.colorspace_settings.name = 'Linear Rec.709'
    hidden, metallic, temporary_nodes = {}, [], []
    for obj in scene.objects:
        if obj in volume_objects() or is_hinge_child(obj):
            hidden[obj.name] = obj.hide_render
            obj.hide_render = True
    for material in dict.fromkeys(shop.data.materials):
        target = material.node_tree.nodes.new('ShaderNodeTexImage')
        target.image = image
        target.name = 'Room lighting bake target'
        material.node_tree.nodes.active = target
        temporary_nodes.append((material, target))
        p = principal(material)
        if p:
            metallic.append((p, p.inputs['Metallic'].default_value))
            p.inputs['Metallic'].default_value = 0
    bpy.ops.object.select_all(action='DESELECT')
    shop.select_set(True)
    bpy.context.view_layer.objects.active = shop
    shop.data.uv_layers.active_index = 2
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    # pack_islands reserved an eight-pixel inter-island gap. Three-pixel
    # extension on either side leaves two pixels of filter separation.
    scene.render.bake.margin = 3
    scene.render.bake.margin_type = 'EXTEND'
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.target = 'IMAGE_TEXTURES'
    note('Starting texture-space Cycles bake', resolution=ARGS.resolution, samples=scene.cycles.samples)
    try:
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, uv_layer=BAKE_UV)
        stats, scale = save_lightmap(image, LIGHTMAP, occupied)
        stats.update(uv_stats)
    finally:
        for name, visible in hidden.items():
            bpy.data.objects[name].hide_render = visible
        for p, value in metallic:
            p.inputs['Metallic'].default_value = value
        for material, node in temporary_nodes:
            material.node_tree.nodes.remove(node)
        shop.data.uv_layers.active_index = 0
        shop.data.uv_layers[0].active_render = True
    scene.cycles.samples = 1024
    image.filepath_raw = str(ART / 'room-lightmap-linear.exr')
    image.file_format = 'OPEN_EXR'
    image.save()
    image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
    export = export_delivery()
    manifest = {'version': 1, 'node': 'OldCuriosityShop', 'uv_channel': 2, 'scale': scale, 'illuminationScale': scale,
                'resolution': ARGS.resolution, 'encoding': 'sRGB transfer of linear diffuse irradiance / scale; no AgX',
                'file': 'room-lightmap.png', 'source': 'Cycles diffuse direct + indirect, color disabled',
                'samples': ARGS.samples or 256, 'dynamic_cover_excluded': True, 'volume_excluded': True,
                'atlas_inter_island_gap_pixels': 8, 'bake_extension_pixels': 3,
                'static_runtime_diffuse_lights_must_be_disabled': True, 'statistics': stats,
                'sha256': hashlib.sha256(LIGHTMAP.read_bytes()).hexdigest(), 'export': export}
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    report_update(bake=manifest)
    note('Baked illumination and portable asset saved', statistics=stats, export=export)


def camera_view(name, dof=False):
    scene = bpy.context.scene
    camera = scene.camera
    if camera is None:
        data = bpy.data.cameras.new('Room verification camera')
        camera = bpy.data.objects.new('Room verification camera', data)
        scene.collection.objects.link(camera)
        scene.camera = camera
    location, target, lens = VIEWS[name]
    camera.location = location
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = lens
    camera.data.dof.use_dof = dof
    if dof:
        focus = bpy.data.objects.get('Room depth focus')
        if focus is None:
            focus = bpy.data.objects.new('Room depth focus', None)
            scene.collection.objects.link(focus)
        focus.location = (0, 2.82, 1.15) if name == 'entrance' else target
        camera.data.dof.focus_object = focus
        camera.data.dof.aperture_fstop = 4.0


def render_views(prefix, dof=False):
    paths = []
    for name in ARGS.views.split(','):
        if name not in VIEWS:
            raise ValueError('Unknown review view: ' + name)
        camera_view(name, dof=dof)
        path = ART / (prefix + '-' + name + '.png')
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(str(path.relative_to(ROOT)))
        note('Render saved for inspection', path=str(path))
    report_update(**{prefix: {'images': paths, 'samples_ceiling': bpy.context.scene.cycles.samples,
                             'depth_of_field': dof, 'viewed_by_agent': False}})


def review():
    if not MANIFEST.exists():
        raise RuntimeError('Bake and export must complete before exported review')
    manifest = json.loads(MANIFEST.read_text())
    scale = manifest['illuminationScale']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    configure(ARGS.samples or 64)
    bpy.ops.import_scene.gltf(filepath=str(EXPORT))
    lightmap = bpy.data.images.load(str(LIGHTMAP), check_existing=True)
    lightmap.colorspace_settings.name = 'sRGB'
    # glTF import reconstructs Blender coordinates; the same native cameras apply.
    static = bpy.data.objects.get('OldCuriosityShop')
    if static is None:
        raise RuntimeError('Static room missing after clean reimport')
    meshes = ([static] if static.type == 'MESH' else []) + [obj for obj in static.children_recursive if obj.type == 'MESH']
    seen = set()
    for obj in meshes:
        if len(obj.data.uv_layers) < 3:
            raise RuntimeError('Clean import did not preserve three UV sets')
        for source in obj.data.materials:
            if source.name in seen:
                continue
            seen.add(source.name)
            p = principal(source)
            nodes, links = source.node_tree.nodes, source.node_tree.links
            output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
            base = p.inputs['Base Color']
            color_source = base.links[0].from_socket if base.is_linked else None
            uv = nodes.new('ShaderNodeUVMap')
            uv.uv_map = obj.data.uv_layers[2].name
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = lightmap
            tex.extension = 'EXTEND'
            links.new(uv.outputs[0], tex.inputs['Vector'])
            multiply = nodes.new('ShaderNodeMixRGB')
            multiply.blend_type = 'MULTIPLY'
            multiply.inputs[0].default_value = 1
            multiply.inputs[1].default_value = base.default_value
            if color_source:
                links.new(color_source, multiply.inputs[1])
            links.new(tex.outputs['Color'], multiply.inputs[2])
            emission = nodes.new('ShaderNodeEmission')
            nonmetal = nodes.new('ShaderNodeMath')
            nonmetal.operation = 'SUBTRACT'
            nonmetal.inputs[0].default_value = 1
            nonmetal.inputs[1].default_value = p.inputs['Metallic'].default_value
            if p.inputs['Metallic'].is_linked:
                links.new(p.inputs['Metallic'].links[0].from_socket, nonmetal.inputs[1])
            decoded_strength = nodes.new('ShaderNodeMath')
            decoded_strength.operation = 'MULTIPLY'
            decoded_strength.inputs[1].default_value = scale
            links.new(nonmetal.outputs[0], decoded_strength.inputs[0])
            links.new(decoded_strength.outputs[0], emission.inputs['Strength'])
            links.new(multiply.outputs[0], emission.inputs['Color'])
            original_emission = nodes.new('ShaderNodeEmission')
            original_emission.inputs['Color'].default_value = p.inputs['Emission Color'].default_value
            original_emission.inputs['Strength'].default_value = p.inputs['Emission Strength'].default_value
            if p.inputs['Emission Color'].is_linked:
                links.new(p.inputs['Emission Color'].links[0].from_socket, original_emission.inputs['Color'])
            if p.inputs['Emission Strength'].is_linked:
                links.new(p.inputs['Emission Strength'].links[0].from_socket, original_emission.inputs['Strength'])
            add = nodes.new('ShaderNodeAddShader')
            links.new(emission.outputs[0], add.inputs[0])
            links.new(original_emission.outputs[0], add.inputs[1])
            links.new(add.outputs[0], output.inputs['Surface'])
    new_lighting(quarantine_existing=False)
    render_views('room-depth-export-review', dof=False)
    report_update(export_review_mode='Clean GLB reimport; static base color multiplied by decoded baked illumination. Moving cover uses native direct lights. Runtime specular/reflections and browser shaders are not tested by this image.')


if __name__ == '__main__':
    ART.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    if ARGS.stage == 'prepare':
        prepare()
    elif ARGS.stage == 'repair-atlas':
        repair_atlas()
    elif ARGS.stage == 'bake':
        bake()
    elif ARGS.stage == 'export-only':
        export_only()
    elif ARGS.stage == 'review':
        review()
    else:
        bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
        configure(ARGS.samples or (1024 if ARGS.stage == 'beauty' else 64))
        render_views('room-depth-' + ARGS.stage, dof=ARGS.stage == 'beauty')
