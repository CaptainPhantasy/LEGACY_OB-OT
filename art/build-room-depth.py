"""Cycles lighting delivery for the existing shop; run with Blender 4.5.

blender -b --python art/build-room-depth.py -- --root /absolute/project --stage prepare
Stages: prepare, atlas-shelf, repair-atlas, repair-normals, preview, bake, export-only, reencode-only, review, beauty. Originals are never overwritten.
The exported bake review intentionally isolates diffuse lighting; it is not a
claim that the browser's reflections, postprocessing or interaction were tested.
"""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import runpy
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
    parser.add_argument('--stage', choices=['prepare', 'atlas-shelf', 'repair-atlas', 'repair-normals', 'preview', 'bake', 'export-only', 'reencode-only', 'review', 'beauty'], required=True)
    parser.add_argument('--native-file', type=Path, help='Native checkpoint relative to --root, or an absolute path')
    parser.add_argument('--shelf-resolution', type=int, choices=[2048, 4096], default=2048)
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
NATIVE = (ROOT / ARGS.native_file).resolve() if ARGS.native_file else ART / 'room-depth.blend'
EXPORT = ART / 'bookstore-depth.glb'
LIGHTMAP = ASSETS / 'room-lightmap.png'
MANIFEST = ASSETS / 'room-lightmap.json'
REPORT = ART / 'room-depth-report.json'
BAKE_UV = 'RoomLightmapUV'
DETAIL_UV = 'RoomSurfaceUV'
SCALE = 8.0
SHELF_NODE = 'CenterCuriosityShelf'
VIEWS = {
    'entrance': ((0, -6.60, 1.60), (0, 5.4, 1.25), 36.9),
    'table': ((.35, 3.48, 1.82), (0, 4.92, 1.06), 34),
    'close': ((.55, 4.00, 1.68), (0, 4.92, 1.07), 40),
    'open': ((.35, 3.48, 1.82), (0, 4.92, 1.06), 34),
    'shelf-west': ((-1.17, -2.50, 1.62), (-.12, -1.50, 1.08), 22),
    'shelf-east': ((1.17, -2.50, 1.62), (.12, -1.50, 1.08), 22),
    'shelf-west-front': ((-1.45, -4.90, 1.85), (0, -1.40, .80), 22),
    'shelf-east-front': ((1.05, -5.20, 1.72), (0, -1.40, .80), 22),
    'aisle': ((1.05, -4.50, 1.60), (0, -1, .90), 36.9),
    'bottles-west': ((-1.40, -1.25, 1.64), (-2.60, -.80, 1.33), 32),
    'bottles-east': ((1.30, -2.05, 1.67), (2.55, -.85, 1.32), 32),
    'maps': ((1.05, -3.25, 1.50), (1.64, -1.48, .95), 36),
    'globe': ((1.05, -.70, 1.55), (2.05, .82, 1.18), 36),
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
    edges, cuboids, inward_corrected = set(), 0, 0
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
                volume, tolerance = component_signed_volume(component)
                if volume < -tolerance:
                    bmesh.ops.reverse_faces(bm, faces=list(component))
                    inward_corrected += 1
                edges.update(component_edges)
                cuboids += 1
    before = len(bm.verts)
    if edges:
        bm.normal_update()
        bmesh.ops.bevel(bm, geom=list(edges), offset=.0015, segments=3,
                        affect='EDGES', profile=.5, clamp_overlap=True,
                        loop_slide=True, harden_normals=True)
        bm.normal_update()
        bm.to_mesh(shop.data)
        shop.data.update()
    after = len(bm.verts)
    bm.free()
    return {'cuboids': cuboids, 'edges': len(edges), 'vertices_before': before, 'vertices_after': after,
            'width_metres': .0015, 'segments': 3, 'inward_cuboids_corrected_before_bevel': inward_corrected}


def atlas(shop, resolution=None):
    resolution = resolution or ARGS.resolution
    bpy.ops.object.select_all(action='DESELECT')
    shop.hide_set(False)
    shop.select_set(True)
    bpy.context.view_layer.objects.active = shop
    shop.data.uv_layers.active_index = 2
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0,
                             area_weight=0, correct_aspect=True, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    pack_all_lightmap_uvs(shop, resolution)
    bounds = atlas_uv_bounds(shop)
    if bounds['nonfinite_uv_loops'] or bounds['out_of_bounds_uv_loops']:
        raise RuntimeError('The unique lightmap UVs are not finite and bounded: ' + json.dumps(bounds))
    shop.data.uv_layers[0].active_render = True
    note('Unique lightmap atlas prepared', loops=len(shop.data.loops), padding_pixels=8)


def pack_all_lightmap_uvs(shop, resolution=None):
    """Pack every unpinned UV2 loop into tile 1001, independent of saved UI selection."""
    resolution = resolution or ARGS.resolution
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    shop.hide_set(False)
    shop.select_set(True)
    bpy.context.view_layer.objects.active = shop
    shop.data.uv_layers.active_index = 2
    settings = bpy.context.scene.tool_settings
    previous_sync, previous_mode = settings.use_uv_select_sync, settings.uv_select_mode
    editors = []
    # ACTIVE_UDIM uses the image tile or UV cursor. Clear any saved tiled image
    # and put every image-editor cursor inside tile 1001 for deterministic packing.
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == 'IMAGE_EDITOR':
                    editors.append((space, space.image, tuple(space.cursor_location)))
                    space.image = None
                    space.cursor_location = (.5, .5)
    settings.use_uv_select_sync = False
    settings.uv_select_mode = 'VERTEX'
    try:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.reveal(select=True)
        bpy.ops.mesh.select_all(action='SELECT')
        bm = bmesh.from_edit_mesh(shop.data)
        uv = bm.loops.layers.uv.get(BAKE_UV)
        if uv is None:
            raise RuntimeError('Unique lightmap layer missing during packing')
        for face in bm.faces:
            face.hide_set(False)
            face.select_set(True)
            for loop in face.loops:
                loop[uv].select = True
                loop[uv].select_edge = True
                loop[uv].pin_uv = False
        bmesh.update_edit_mesh(shop.data, loop_triangles=False, destructive=False)
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(udim_source='ACTIVE_UDIM', rotate=True, scale=True,
                               merge_overlap=False, pin=False,
                               margin_method='FRACTION', margin=8 / resolution)
    finally:
        if shop.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        settings.use_uv_select_sync, settings.uv_select_mode = previous_sync, previous_mode
        for space, image, cursor in editors:
            space.image = image
            space.cursor_location = cursor
    shop.data.update()


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
    orientation = repair_closed_component_normals(shop)
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
    report_update(prepare={'blender': bpy.app.version_string, 'bevel': bevel, 'orientation': orientation,
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


def atlas_uv_bounds(shop):
    """Inspect every UV2 loop before raster clipping can hide invalid islands."""
    mesh = shop.data
    values = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers[2].data.foreach_get('uv', values)
    values = values.reshape(-1, 2)
    finite = np.isfinite(values).all(axis=1)
    outside = finite & ((values < 0).any(axis=1) | (values > 1).any(axis=1))
    invalid = ~finite | outside
    invalid_faces, nonfinite_faces, outside_faces, examples = [], [], [], []
    for face in mesh.polygons:
        indices = list(face.loop_indices)
        if invalid[indices].any():
            invalid_faces.append(face.index)
            if (~finite[indices]).any():
                nonfinite_faces.append(face.index)
            if outside[indices].any():
                outside_faces.append(face.index)
            if len(examples) < 20:
                examples.append({'face': face.index, 'material': mesh.materials[face.material_index].name,
                                 'invalid_loops': [{'loop': index,
                                                    'uv': [float(value) if math.isfinite(value) else None
                                                           for value in values[index]]}
                                                   for index in indices if invalid[index]][:6]})
    valid_values = values[finite]
    return {'uv_loops_checked': len(values), 'nonfinite_uv_loops': int((~finite).sum()),
            'out_of_bounds_uv_loops': int(outside.sum()), 'invalid_uv_faces': invalid_faces,
            'nonfinite_uv_faces': nonfinite_faces, 'out_of_bounds_uv_faces': outside_faces,
            'uv_min': valid_values.min(axis=0).tolist() if len(valid_values) else None,
            'uv_max': valid_values.max(axis=0).tolist() if len(valid_values) else None,
            'invalid_uv_examples': examples}


def atlas_coverage(shop, resolution, strict=True):
    """Validate all loops, then measure interior overlaps without silently clipping defects."""
    mesh = shop.data
    bounds = atlas_uv_bounds(shop)
    invalid_faces = set(bounds['invalid_uv_faces'])
    if strict and invalid_faces:
        raise RuntimeError('Unique UV atlas contains nonfinite or out-of-bounds loops: ' + json.dumps(bounds))
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers[2].data
    coverage = np.zeros((resolution, resolution), dtype=np.uint16)
    owners = np.full((resolution, resolution), -1, dtype=np.int32)
    degenerate = 0
    degenerate_positive_area_faces = set()
    conflict_faces, collision_pairs = set(), {}
    for triangle_index, triangle in enumerate(mesh.loop_triangles):
        if triangle.polygon_index in invalid_faces:
            continue  # Diagnostic mode reports these explicitly; strict mode rejects them above.
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
    stats.update(bounds)
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
    if strict and not stats['occupied_texels']:
        raise RuntimeError('UV atlas has no measurable texel coverage')
    return occupied, stats


def layer_bytes(mesh, index):
    values = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers[index].data.foreach_get('uv', values)
    return values.tobytes()


def shelf_texel_density(shelf, resolution):
    """Measure the visible-size wood surfaces independently of microscopic bevels."""
    mesh = shelf.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers[2].data
    densities, areas = [], []
    for tri in mesh.loop_triangles:
        if family(mesh.materials[tri.material_index].name) != 'wood':
            continue
        points = [shelf.matrix_world @ mesh.vertices[index].co for index in tri.vertices]
        area = (points[1] - points[0]).cross(points[2] - points[0]).length * .5
        longest = max((points[(i + 1) % 3] - points[i]).length for i in range(3))
        if area < .02 or longest == 0 or 2 * area / longest < .03:
            continue
        a, b, c = [uv[index].uv for index in tri.loops]
        uv_area = abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * .5
        densities.append(math.sqrt(uv_area * resolution * resolution / area))
        areas.append(area)
    if not densities:
        raise RuntimeError('No major wood surface was available for shelf texel-density validation')
    return {'major_wood_triangles': len(densities), 'major_wood_area_m2': sum(areas),
            'texels_per_metre_min': min(densities), 'texels_per_metre_p10': float(np.percentile(densities, 10)),
            'texels_per_metre_median': float(np.median(densities)), 'required_p10': 256,
            'measurement': 'Wood triangles >=0.02m2 with minimum altitude >=0.03m; UV area / world area'}


def atlas_shelf():
    import shutil
    backup = NATIVE.with_name(NATIVE.stem + '-before-shelf-atlas.blend')
    if not backup.exists():
        shutil.copy2(NATIVE, backup)
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    room = bpy.data.objects['OldCuriosityShop']
    shelf = bpy.data.objects[SHELF_NODE]
    old_uv = {index: layer_bytes(room.data, index) for index in (0, 2)}
    old_positions = mesh_positions(room.data)
    shelf_positions = mesh_positions(shelf.data)
    ensure_uvs(shelf)
    shelf_correspondence = face_uv_material_fingerprint(shelf.data)
    orientation = repair_closed_component_normals(shelf)
    if face_uv_material_fingerprint(shelf.data) != shelf_correspondence:
        raise RuntimeError('New shelf normal repair changed material/UV corner correspondence')
    shelf_uv0 = layer_bytes(shelf.data, 0)
    attempts = []
    for resolution in ([2048, 4096] if ARGS.shelf_resolution == 2048 else [4096]):
        atlas(shelf, resolution)
        for repair_attempt in range(3):
            occupied, stats = atlas_coverage(shelf, resolution, strict=False)
            targets = (set(stats['conflicting_faces']) | set(stats['positive_area_degenerate_uv_faces'])
                       | set(stats['invalid_uv_faces']))
            if not targets:
                break
            if repair_attempt == 2:
                raise RuntimeError('New shelf atlas needs further repair: ' + json.dumps(stats))
            allocate_repaired_uv_triangles(shelf, targets, occupied, resolution)
        _, stats = atlas_coverage(shelf, resolution)
        density = shelf_texel_density(shelf, resolution)
        attempts.append({'resolution': resolution, 'atlas': stats, 'density': density})
        note('Shelf atlas measured', resolution=resolution, coverage=stats['atlas_coverage_fraction'], density=density)
        if density['texels_per_metre_p10'] >= 256:
            break
    if density['texels_per_metre_p10'] < 256:
        raise RuntimeError('Shelf atlas cannot meet the visible wood density gate: ' + json.dumps(density))
    if any(layer_bytes(room.data, index) != value for index, value in old_uv.items()) or mesh_positions(room.data) != old_positions:
        raise RuntimeError('Shelf atlas preparation changed the existing room')
    if layer_bytes(shelf.data, 0) != shelf_uv0 or mesh_positions(shelf.data) != shelf_positions:
        raise RuntimeError('Shelf atlas preparation changed shelf geometry or UV0')
    shelf.data.uv_layers.active_index = 0
    shelf.data.uv_layers[0].active_render = True
    bpy.context.scene['room_depth_shelf_resolution'] = resolution
    bpy.context.scene['room_depth_lightmap_needs_rebake'] = True
    shelf['lightmap_atlas_pending'] = False
    bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
    report_update(shelf_atlas={'attempts': attempts, 'resolution': resolution, 'density': density,
                               'orientation': orientation,
                               'existing_room_uv0_uv2_unchanged': True, 'existing_room_positions_unchanged': True,
                               'existing_room_uv_sha256': {str(index): hashlib.sha256(value).hexdigest()
                                                          for index, value in old_uv.items()},
                               'shelf_uv0_and_positions_unchanged': True, 'requires_rebake': True,
                               'backup': str(backup)})


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


def component_signed_volume(faces):
    """Translation-stable signed volume and a scale-relative zero tolerance."""
    vertices = {vertex for face in faces for vertex in face.verts}
    origin = tuple(next(iter(vertices)).co)
    bounds = [(min(vertex.co[i] for vertex in vertices), max(vertex.co[i] for vertex in vertices)) for i in range(3)]
    terms = []
    for face in faces:
        coordinates = [tuple(float(vertex.co[i]) - origin[i] for i in range(3)) for vertex in face.verts]
        a = coordinates[0]
        for i in range(1, len(coordinates) - 1):
            b, c = coordinates[i], coordinates[i + 1]
            cross = (b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0])
            terms.append((a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2]) / 6)
    bound_volume = math.prod(high - low for low, high in bounds)
    return math.fsum(terms), max(1e-18, bound_volume * 1e-8)


def face_uv_material_fingerprint(mesh):
    """Orientation-independent hash of each face's material and corner-to-UV mapping."""
    layers = list(mesh.uv_layers)
    corner_format = '<I' + 'f' * (len(layers) * 2)
    fingerprints = []
    for polygon in mesh.polygons:
        corners = []
        for loop_index in polygon.loop_indices:
            values = [mesh.loops[loop_index].vertex_index]
            for layer in layers:
                values.extend(layer.data[loop_index].uv)
            corners.append(tuple(values))
        payload = struct.pack('<II', polygon.material_index, len(corners))
        payload += b''.join(struct.pack(corner_format, *corner) for corner in sorted(corners))
        fingerprints.append(hashlib.sha256(payload).digest())
    result = hashlib.sha256()
    for digest in sorted(fingerprints):
        result.update(digest)
    return result.hexdigest()


def repair_closed_component_normals(shop):
    """Reverse only genuinely inward, closed manifold components; leave open sheets alone."""
    bm = bmesh.new()
    bm.from_mesh(shop.data)
    pending = set(bm.faces)
    stats = {'components': 0, 'closed_components': 0, 'positive_components': 0,
             'negative_components_reversed': 0, 'near_zero_closed_components': 0,
             'open_or_nonmanifold_components_unchanged': 0, 'inconsistent_closed_components_unchanged': 0,
             'faces_reversed': 0, 'verified_negative_components_remaining': 0,
             'reversed_material_face_counts': {}, 'component_examples': []}
    while pending:
        first = pending.pop()
        queue, faces = [first], {first}
        while queue:
            face = queue.pop()
            for edge in face.edges:
                for neighbor in edge.link_faces:
                    if neighbor in pending:
                        pending.remove(neighbor)
                        faces.add(neighbor)
                        queue.append(neighbor)
        stats['components'] += 1
        edges = {edge for face in faces for edge in face.edges}
        if not all(len(edge.link_faces) == 2 for edge in edges):
            stats['open_or_nonmanifold_components_unchanged'] += 1
            continue
        stats['closed_components'] += 1
        # A signed volume establishes inside/outside only for consistently
        # wound closed shells. Mixed winding requires a separate diagnosis.
        if not all(edge.is_contiguous for edge in edges):
            stats['inconsistent_closed_components_unchanged'] += 1
            continue
        volume, tolerance = component_signed_volume(faces)
        if abs(volume) <= tolerance:
            stats['near_zero_closed_components'] += 1
            continue
        if volume > 0:
            stats['positive_components'] += 1
            continue
        materials = {}
        for face in faces:
            name = shop.data.materials[face.material_index].name
            materials[name] = materials.get(name, 0) + 1
            stats['reversed_material_face_counts'][name] = stats['reversed_material_face_counts'].get(name, 0) + 1
        bmesh.ops.reverse_faces(bm, faces=list(faces))
        repaired_volume, repaired_tolerance = component_signed_volume(faces)
        if repaired_volume <= repaired_tolerance:
            stats['verified_negative_components_remaining'] += 1
            bm.free()
            raise RuntimeError('Closed component did not become outward after reversing its face winding')
        stats['negative_components_reversed'] += 1
        stats['faces_reversed'] += len(faces)
        if len(stats['component_examples']) < 30:
            stats['component_examples'].append({'faces': len(faces), 'materials': materials,
                                                'signed_volume_before_m3': volume, 'signed_volume_after_m3': repaired_volume})
    if stats['negative_components_reversed']:
        bm.normal_update()
        bm.to_mesh(shop.data)
        shop.data.update()
    bm.free()
    return stats


def repair_normals():
    """Correct saved mesh orientation without rebuilding geometry or repacking its atlas."""
    import shutil
    backup = ART / 'room-depth-before-normal-repair.blend'
    if not backup.exists():
        shutil.copy2(NATIVE, backup)
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    shop = bpy.data.objects['OldCuriosityShop']
    positions_before = mesh_positions(shop.data)
    uv_material_before = face_uv_material_fingerprint(shop.data)
    hinge = bpy.data.objects['BookCoverHinge']
    hinge_before = [tuple(hinge.location), tuple(hinge.rotation_euler), tuple(hinge.scale)]
    stats = repair_closed_component_normals(shop)
    if mesh_positions(shop.data) != positions_before:
        raise RuntimeError('Normal repair changed vertex positions')
    if face_uv_material_fingerprint(shop.data) != uv_material_before:
        raise RuntimeError('Normal repair changed a face material or its corner UV correspondence')
    if [tuple(hinge.location), tuple(hinge.rotation_euler), tuple(hinge.scale)] != hinge_before:
        raise RuntimeError('Normal repair changed the book hinge')
    _, atlas_stats = atlas_coverage(shop, ARGS.resolution)
    if stats['negative_components_reversed']:
        bpy.context.scene['room_depth_lightmap_needs_rebake'] = True
    bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
    result = {'orientation': stats, 'atlas': atlas_stats, 'vertex_positions_unchanged': True,
              'face_uv_and_material_correspondence_unchanged': True, 'hinge_unchanged': True,
              'backup': str(backup.relative_to(ROOT)), 'requires_rebake': bool(stats['negative_components_reversed'])}
    report_update(normal_repair=result)
    note('Normal repair verified and saved', orientation=stats, atlas_overlap_texels=atlas_stats['interior_overlap_texels'],
         requires_rebake=result['requires_rebake'])


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
    pack_all_lightmap_uvs(shop)
    return {'target_faces': len(targets), 'triangulated_ngons': len(ngons), 'isolated_triangles': repaired}


def allocate_repaired_uv_triangles(shop, face_indices, occupied, resolution):
    """Put only defective triangles into unused tiles; retain the existing dense atlas."""
    mesh = shop.data
    targets = [mesh.polygons[index] for index in sorted(face_indices)]
    if any(len(face.loop_indices) != 3 for face in targets):
        raise RuntimeError('Reserved-tile repair requires already triangulated target faces')
    layer = mesh.uv_layers[2].data
    before = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    layer.foreach_get('uv', before)
    before = before.reshape(-1, 2)
    target_loops = np.array([index for face in targets for index in face.loop_indices], dtype=np.int64)
    protected = np.ones(len(mesh.loops), dtype=bool)
    protected[target_loops] = False
    reserved = occupied.copy()
    finite_bounded = np.isfinite(before).all(axis=1) & (before >= 0).all(axis=1) & (before <= 1).all(axis=1)
    target_set = set(face_indices)
    if not finite_bounded[protected].all():
        raise RuntimeError('Protected lightmap UV loops are not finite and bounded')
    # Thin triangles may have substantial area but no interior texel centers.
    # Reserve every protected edge conservatively, not just small-area boxes.
    clearance = runpy.run_path(str(ROOT / 'scripts' / 'validate-room-atlas-clearance.py'))
    edge_mask, edge_stats = clearance['conservative_uv_edge_mask'](mesh, before, target_set, resolution)
    reserved |= edge_mask
    expanded = clearance['dilate_square'](reserved, 8)
    integral = np.pad(expanded.cumsum(axis=0, dtype=np.int32).cumsum(axis=1, dtype=np.int32), ((1, 0), (1, 0)))
    chosen = None
    availability = []
    for size in (24, 16, 12):
        sums = integral[size:, size:] - integral[:-size, size:] - integral[size:, :-size] + integral[:-size, :-size]
        available = sums == 0
        best_count, best_phase = 0, (0, 0)
        # A shared grid guarantees disjoint tiles. Try all phase offsets to avoid
        # wasting free strips just because their origin misses the first grid.
        for y_phase in range(size):
            for x_phase in range(size):
                count = int(available[y_phase::size, x_phase::size].sum())
                if count > best_count:
                    best_count, best_phase = count, (y_phase, x_phase)
        availability.append({'tile_pixels': size, 'free_tiles': best_count})
        if best_count >= len(targets):
            y_phase, x_phase = best_phase
            grid = np.argwhere(available[y_phase::size, x_phase::size])[:len(targets)]
            chosen = (size, [(int(x * size + x_phase), int(y * size + y_phase)) for y, x in grid])
            break
    if chosen is None:
        raise RuntimeError('Not enough unused atlas tiles with eight-pixel separation: ' + json.dumps(availability))
    size, origins = chosen
    # Defective faces are microscopic rope/leather triangles. A regular triangle
    # provides finite texel coverage instead of allowing razor-thin UV collapse.
    # This changes only lightmap parameterization; the original material UV0 stays intact.
    corner_offsets = ((3.5, 3.5), (size - 3.5, 3.5), (3.5, size - 3.5))
    for face, (x, y) in zip(targets, origins):
        for index, (u, v) in zip(face.loop_indices, corner_offsets):
            layer[index].uv = ((x + u) / resolution, (y + v) / resolution)
    after = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    layer.foreach_get('uv', after)
    after = after.reshape(-1, 2)
    if not np.array_equal(before[protected], after[protected]):
        raise RuntimeError('Reserved-tile allocation changed an existing protected UV loop')
    mesh.update()
    return {'target_faces': len(targets), 'isolated_triangles': len(targets), 'triangulated_ngons': 0,
            'tile_pixels': size, 'bake_padding_pixels': 3, 'existing_footprint_separation_pixels': 8,
            'protected_uv_loops_unchanged': int(protected.sum()), 'tile_availability': availability,
            'global_repacking': False, 'protected_edge_reservation': edge_stats}


def repair_atlas():
    """Repair the existing checkpoint without repeating bevels or lighting edits."""
    import shutil
    backup = ART / 'room-depth-before-atlas-bounds-repair.blend'
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
        occupied, stats = atlas_coverage(shop, ARGS.resolution, strict=False)
        history.append({'inspection': stats})
        (ART / 'room-atlas-repair-diagnostics.json').write_text(json.dumps(history, indent=2) + '\n')
        note('Targeted atlas inspection', attempt=attempt, overlap_texels=stats['interior_overlap_texels'],
             conflicting_faces=len(stats['conflicting_faces']), collapsed_positive_area_faces=len(stats['positive_area_degenerate_uv_faces']),
             out_of_bounds_uv_loops=stats['out_of_bounds_uv_loops'], nonfinite_uv_loops=stats['nonfinite_uv_loops'],
             coverage=stats['atlas_coverage_fraction'], collision_examples=stats['collision_examples'][:8])
        targets = (set(stats['conflicting_faces']) | set(stats['positive_area_degenerate_uv_faces'])
                   | set(stats['nonfinite_uv_faces']))
        requires_repack = bool(stats['out_of_bounds_uv_loops'])
        if not targets and not requires_repack:
            if mesh_positions(shop.data) != positions_before:
                raise RuntimeError('Atlas repair changed vertex positions')
            if uv0_signature(shop.data) != uv0_before:
                raise RuntimeError('Atlas repair changed original material UV0 coordinates')
            if [tuple(hinge.location), tuple(hinge.rotation_euler), tuple(hinge.scale)] != hinge_before:
                raise RuntimeError('Atlas repair changed the book hinge')
            # Repeat the unchanged strict gate used by the actual bake.
            _, verified = atlas_coverage(shop, ARGS.resolution)
            if verified['occupied_texels'] < history[0]['inspection']['occupied_texels']:
                raise RuntimeError('Atlas repair reduced existing measurable texel coverage')
            shop.data.uv_layers.active_index = 0
            shop.data.uv_layers[0].active_render = True
            if any('repair' in item for item in history):
                bpy.context.scene['room_depth_lightmap_needs_rebake'] = True
            bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
            report_update(atlas_repair={'attempts': history, 'verified': verified,
                                       'vertex_positions_unchanged': True, 'uv0_unchanged': True,
                                       'hinge_unchanged': True, 'backup': str(backup.relative_to(ROOT)),
                                       'requires_rebake': any('repair' in item for item in history)})
            note('Atlas repair verified and saved', overlap_texels=verified['interior_overlap_texels'],
                 occupied_texels=verified['occupied_texels'], path=str(NATIVE))
            return
        if attempt == 3:
            break
        targets.update(stats['out_of_bounds_uv_faces'])
        history[-1]['repair'] = allocate_repaired_uv_triangles(shop, targets, occupied, ARGS.resolution)
        note('Targeted UV islands repaired and repacked', **history[-1]['repair'])
    raise RuntimeError('Targeted atlas repair did not converge; original native checkpoint remains unchanged. Inspect room-atlas-repair-diagnostics.json')


def filtered_png_row(rgba, previous=None):
    """Choose a reversible PNG filter; all four numeric RGBA channels stay exact."""
    row = np.asarray(rgba, dtype=np.uint8).reshape(-1).astype(np.int16)
    above = np.zeros_like(row) if previous is None else np.asarray(previous, dtype=np.uint8).reshape(-1).astype(np.int16)
    if row.size % 4 or above.size != row.size:
        raise ValueError('PNG filter rows must have equal RGBA8 dimensions')
    left = np.zeros_like(row)
    left[4:] = row[:-4]
    upper_left = np.zeros_like(row)
    upper_left[4:] = above[:-4]
    estimate = left + above - upper_left
    pa, pb, pc = np.abs(estimate - left), np.abs(estimate - above), np.abs(estimate - upper_left)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, above, upper_left))
    predictors = (np.zeros_like(row), left, above, (left + above) // 2, paeth)
    best, best_score = None, None
    for tag, predictor in enumerate(predictors):
        residual = ((row - predictor) & 255).astype(np.uint8)
        # PNG's signed-residual heuristic selects the most compressible row.
        signed = residual.astype(np.int16)
        score = int(np.minimum(signed, 256 - signed).sum())
        if best_score is None or score < best_score:
            best, best_score = bytes((tag,)) + residual.tobytes(), score
    return best


def save_lightmap(image, path, occupied):
    """Encode linear illumination as square-root RGBM data, without color transforms."""
    width, height = image.size
    pixels = array.array('f', [0.0]) * (width * height * 4)
    image.pixels.foreach_get(pixels)
    rgb = np.frombuffer(pixels, dtype=np.float32).reshape(height, width, 4)[..., :3]
    measured = rgb[occupied]
    nonfinite = int((~np.isfinite(rgb)).sum())
    if nonfinite:
        raise RuntimeError('Bake contains non-finite values')
    maximum = float(measured.max())
    maximum_all = float(rgb.max())
    scale = float(max(SCALE, 2 ** math.ceil(math.log2(max(maximum_all, 1e-6)))))
    compressor = zlib.compressobj(9)
    compressed = []
    previous_rgba = None
    clipped = int((rgb > scale).sum())
    if clipped:
        raise RuntimeError('RGBM scale does not cover the source illumination range')
    maximum_error, error_sum, channel_count = 0.0, 0.0, 0
    shadow_error, shadow_count = 0.0, 0
    minimum_positive = float('inf')
    for y in range(height - 1, -1, -1):
        linear = np.maximum(rgb[y].astype(np.float64), 0.0)
        roots = np.sqrt(linear / scale)
        # Alpha is a shared numeric multiplier, never opacity. Quantizing it
        # upward ensures each encoded RGB component remains in [0, 1].
        multiplier_byte = np.clip(np.ceil(roots.max(axis=1) * 255.0), 1, 255).astype(np.uint8)
        multiplier = multiplier_byte.astype(np.float64) / 255.0
        rgba = np.empty((width, 4), dtype=np.uint8)
        rgba[:, :3] = np.rint(np.clip(roots / multiplier[:, None], 0, 1) * 255.0).astype(np.uint8)
        rgba[:, 3] = multiplier_byte
        decoded = np.square((rgba[:, :3].astype(np.float64) / 255.0) * multiplier[:, None]) * scale
        row_occupied = occupied[y]
        difference = np.abs(decoded[row_occupied] - linear[row_occupied])
        if difference.size:
            maximum_error = max(maximum_error, float(difference.max()))
            error_sum += float(difference.sum())
            channel_count += int(difference.size)
            shadow = (linear[row_occupied] > 0) & (linear[row_occupied] < .05)
            shadow_error += float(difference[shadow].sum())
            shadow_count += int(shadow.sum())
            positive_decoded = decoded[row_occupied][decoded[row_occupied] > 0]
            if positive_decoded.size:
                minimum_positive = min(minimum_positive, float(positive_decoded.min()))
        compressed.append(compressor.compress(filtered_png_row(rgba, previous_rgba)))
        previous_rgba = rgba
    compressed.append(compressor.flush())
    png = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    # No sRGB/gAMA chunk: all four channels store non-color numeric data.
    png += png_chunk(b'IDAT', b''.join(compressed)) + png_chunk(b'IEND', b'')
    path.write_bytes(png)
    stats = {'max_linear_occupied': maximum, 'mean_linear_occupied': float(measured.mean()),
             'linear_percentiles_occupied': dict(zip(['p01', 'p50', 'p95', 'p9999'], [float(v) for v in np.percentile(measured, [1, 50, 95, 99.99])])),
             'channels_clipped': clipped, 'fraction_occupied_channels_clipped': float((measured > scale).mean()),
             'nonfinite_channels': nonfinite, 'negative_channels_clamped': int((rgb < 0).sum()),
             'black_pixels_including_unused_atlas': int((rgb.sum(axis=2) < 1e-7).sum()),
             'max_abs_decode_error_occupied': maximum_error,
             'mean_abs_decode_error_occupied': error_sum / max(1, channel_count),
             'mean_abs_decode_error_shadow_channels': shadow_error / max(1, shadow_count),
             'minimum_positive_decoded_occupied': minimum_positive if math.isfinite(minimum_positive) else 0,
             'total_pixels': width * height, 'bytes': len(png)}
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
    if bpy.context.scene.get('room_depth_lightmap_needs_rebake', False):
        raise RuntimeError('Room geometry or UVs changed; rebake illumination before exporting')
    static_names = ['OldCuriosityShop'] + ([SHELF_NODE] if bpy.data.objects.get(SHELF_NODE) else [])
    for name in static_names:
        bounds = atlas_uv_bounds(bpy.data.objects[name])
        if bounds['nonfinite_uv_loops'] or bounds['out_of_bounds_uv_loops']:
            raise RuntimeError('Refusing to export invalid lightmap UVs for ' + name + ': ' + json.dumps(bounds))
    originals, export_cache = {}, {}
    excluded = set(volume_objects())
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and obj not in excluded:
            ensure_uvs(obj)
            project_delivery_detail_uv(obj)
            originals[obj.name] = list(obj.data.materials)
            for i, material in enumerate(list(obj.data.materials)):
                key = (material.name, obj.name in static_names)
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
    static_counts = {}
    for name in static_names:
        static_nodes = [node for node in doc['nodes'] if node.get('name') == name]
        if len(static_nodes) != 1 or 'mesh' not in static_nodes[0]:
            raise RuntimeError('Expected one intact exported static node: ' + name)
        primitives = doc['meshes'][static_nodes[0]['mesh']]['primitives']
        for primitive in primitives:
            if not all('TEXCOORD_' + str(i) in primitive['attributes'] for i in range(3)):
                raise RuntimeError('Exporter omitted a required UV channel on ' + name + ': ' + str(primitive['attributes']))
        static_counts[name] = len(primitives)
    if not any(node.get('name') == 'BookCoverHinge' for node in doc['nodes']):
        raise RuntimeError('The export lost the book hinge')
    note('Portable GLB verified', primitives_by_static_node=static_counts, texcoords=[0, 1, 2])
    splitter = runpy.run_path(str(ROOT / 'scripts' / 'split-room-glb.py'))['split_glb']
    delivery = splitter(EXPORT, ASSETS / 'bookstore-depth.gltf')
    delivery['path'] = str((ASSETS / delivery['path']).relative_to(ROOT))
    for item in delivery['files']:
        item['path'] = str((ASSETS / item['path']).relative_to(ROOT))
    delivery['source_glb']['path'] = str(EXPORT.relative_to(ROOT))
    delivery.update(static_primitives=static_counts['OldCuriosityShop'], static_nodes=static_counts, required_texcoords=[0, 1, 2],
                    hinge_preserved=True, explicit_base_color_factors=color_factors)
    note('Portable glTF verified', parts=delivery['buffer_parts'],
         bytes=delivery['total_bytes'], source_glb_sha256=delivery['source_glb']['sha256'])
    return delivery


def export_only():
    """Re-export the checked native geometry without recalculating illumination."""
    import shutil
    if not MANIFEST.exists() or not LIGHTMAP.exists():
        raise RuntimeError('A completed lightmap and manifest are required for export-only')
    manifests = saved_lightmap_manifests()
    before_lightmaps = {item['file']: hashlib.sha256((ASSETS / item['file']).read_bytes()).hexdigest() for item in manifests}
    if EXPORT.exists():
        quarantine = ART / 'rendering.quarantine' / 'bookstore-depth-before-color-factor-fix.glb'
        quarantine.parent.mkdir(parents=True, exist_ok=True)
        if not quarantine.exists():
            shutil.copy2(EXPORT, quarantine)
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    if bpy.context.scene.get('room_depth_lightmap_needs_rebake', False):
        raise RuntimeError('Mesh normals were repaired; rebake lighting before export-only')
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
    if any(hashlib.sha256((ASSETS / name).read_bytes()).hexdigest() != value for name, value in before_lightmaps.items()):
        raise RuntimeError('Export-only changed a completed illumination map')
    if hashlib.sha256(NATIVE.read_bytes()).hexdigest() != before_native:
        raise RuntimeError('Export-only changed the native checkpoint')
    for manifest in manifests:
        manifest['export'] = exported
        (ASSETS / (Path(manifest['file']).stem + '.json')).write_text(json.dumps(manifest, indent=2) + '\n')
    report_update(bake=manifests[0], additional_bakes=manifests[1:],
                  export_only={'lightmap_unchanged': True, 'native_unchanged_during_export': True,
                                           'native_lightmap_retention_repaired': retention_repaired, 'export': exported})
    note('Delivery export refreshed without rebaking', path=str(EXPORT), sha256=exported['sha256'])


def reencode_only():
    """Improve PNG precision from the existing float bake; leave geometry and lighting untouched."""
    import shutil
    if not MANIFEST.exists():
        raise RuntimeError('An existing float lightmap and manifest are required for reencoding')
    manifests = saved_lightmap_manifests()
    native_hash = hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    export_hash = hashlib.sha256(EXPORT.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    if bpy.context.scene.get('room_depth_lightmap_needs_rebake', False):
        raise RuntimeError('Geometry has changed; reencoding cannot replace the required lighting bake')
    for manifest in manifests:
        png = ASSETS / manifest['file']
        stem = png.stem
        manifest_path = ASSETS / (stem + '.json')
        exr = ART / (stem + '-linear.exr')
        if not exr.exists():
            raise RuntimeError('Missing source illumination image: ' + str(exr))
        for source in [png, manifest_path]:
            if source.exists():
                backup = ART / 'rendering.quarantine' / (stem + '-before-rgbm-square' + source.suffix)
                backup.parent.mkdir(parents=True, exist_ok=True)
                if not backup.exists():
                    shutil.copy2(source, backup)
        image = bpy.data.images.load(str(exr), check_existing=False)
        image.colorspace_settings.name = 'Linear Rec.709'
        width, height = image.size
        if width != height or width != manifest['resolution']:
            raise RuntimeError('Float lightmap dimensions disagree with the saved manifest')
        occupied, uv_stats = atlas_coverage(bpy.data.objects[manifest['node']], width)
        stats, scale = save_lightmap(image, png, occupied)
        stats.update(uv_stats)
        manifest.update({'encoding': 'RGBM_SQRT', 'scale': scale, 'illuminationScale': scale,
                         'decode': '(rgb * alpha)^2 * illuminationScale; all channels are non-color data',
                         'statistics': stats, 'sha256': hashlib.sha256(png.read_bytes()).hexdigest()})
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        note('Lightmap reencoded without rebaking', node=manifest['node'], illumination_scale=scale, statistics=stats)
    if hashlib.sha256(NATIVE.read_bytes()).hexdigest() != native_hash or hashlib.sha256(EXPORT.read_bytes()).hexdigest() != export_hash:
        raise RuntimeError('Reencoding changed the native checkpoint or exported geometry')
    report_update(bake=manifests[0], additional_bakes=manifests[1:],
                  reencode_only={'native_unchanged': True, 'export_unchanged': True,
                                 'encoding': 'RGBM_SQRT', 'nodes': [manifest['node'] for manifest in manifests]})


def lightmap_specifications():
    specs = [{'node': 'OldCuriosityShop', 'stem': 'room-lightmap', 'resolution': ARGS.resolution,
              'image_name': 'Room diffuse irradiance linear'}]
    if bpy.data.objects.get(SHELF_NODE):
        specs.append({'node': SHELF_NODE, 'stem': 'curiosity-lightmap',
                      'resolution': int(bpy.context.scene.get('room_depth_shelf_resolution', ARGS.shelf_resolution)),
                      'image_name': 'Curiosity diffuse irradiance linear'})
    return specs


def bake_atlas(spec):
    scene = bpy.context.scene
    shop = bpy.data.objects[spec['node']]
    resolution, stem = spec['resolution'], spec['stem']
    png = ASSETS / (stem + '.png')
    occupied, uv_stats = atlas_coverage(shop, resolution)
    note('UV atlas measured before baking', node=shop.name, **uv_stats)
    image = bpy.data.images.get(spec['image_name'])
    previous_image = None
    if image is None or tuple(image.size) != (resolution, resolution) or not image.is_float:
        if image is not None:
            previous_image = image
            previous_image.name = spec['image_name'] + ' / prior resolution'
        image = bpy.data.images.new(spec['image_name'], width=resolution, height=resolution,
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
    note('Starting texture-space Cycles bake', node=shop.name, resolution=resolution, samples=scene.cycles.samples,
         complete_static_scene_visible=True)
    try:
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, uv_layer=BAKE_UV)
        stats, scale = save_lightmap(image, png, occupied)
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
    image.filepath_raw = str(ART / (stem + '-linear.exr'))
    image.file_format = 'OPEN_EXR'
    image.save()
    image.pack()
    if previous_image is not None:
        # Prior native checkpoints already retain the old image; keep only the
        # current packed lightmap alive in this next saved source revision.
        previous_image.use_fake_user = False
    manifest = {'version': 1, 'node': shop.name, 'uv_channel': 2, 'scale': scale, 'illuminationScale': scale,
                'resolution': resolution, 'encoding': 'RGBM_SQRT',
                'decode': '(rgb * alpha)^2 * illuminationScale; all channels are non-color data',
                'file': png.name, 'source': 'Cycles diffuse direct + indirect, color disabled',
                'samples': scene.cycles.samples, 'dynamic_cover_excluded': True, 'volume_excluded': True,
                'complete_static_scene_visible': True,
                'atlas_inter_island_gap_pixels': 8, 'bake_extension_pixels': 3,
                'static_runtime_diffuse_lights_must_be_disabled': True, 'statistics': stats,
                'sha256': hashlib.sha256(png.read_bytes()).hexdigest()}
    if shop.name == SHELF_NODE:
        manifest['texel_density'] = shelf_texel_density(shop, resolution)
    note('Static atlas baked', node=shop.name, statistics=stats, image=str(png))
    return manifest


def bake():
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
    scene = configure(ARGS.samples or 1024)
    specs = lightmap_specifications()
    if len(specs) > 1 and (not scene.get('room_depth_shelf_resolution') or bpy.data.objects[SHELF_NODE].get('lightmap_atlas_pending', False)):
        raise RuntimeError('Prepare the separate shelf atlas before baking the complete scene')
    manifests = [bake_atlas(spec) for spec in specs]
    scene.cycles.samples = 1024
    scene['room_depth_lightmap_needs_rebake'] = False
    bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
    exported = export_delivery()
    if len(manifests) > 1:
        manifests[0]['additionalLightmaps'] = [spec['stem'] + '.json' for spec in specs[1:]]
    for spec, manifest in zip(specs, manifests):
        manifest['export'] = exported
        (ASSETS / (spec['stem'] + '.json')).write_text(json.dumps(manifest, indent=2) + '\n')
    report_update(bake=manifests[0], additional_bakes=manifests[1:])
    note('All baked atlases and portable asset saved', nodes=[spec['node'] for spec in specs], export=exported)


def camera_view(name, dof=False):
    scene = bpy.context.scene
    hinge = bpy.data.objects.get('BookCoverHinge')
    if hinge is not None:
        hinge.rotation_mode = 'XYZ'
        hinge.rotation_euler[1] = 2.75 if name == 'open' else 0
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
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.data.sensor_width = 36
    # The web camera's 52 degrees are vertical. Use its framing for the
    # exported room/table diagnostics; beauty/close views remain photographic.
    if ARGS.stage == 'review' and name in ('entrance', 'aisle', 'table', 'open'):
        camera.data.sensor_fit = 'VERTICAL'
        camera.data.sensor_height = 24
        camera.data.lens = 24 / (2 * math.tan(math.radians(52) / 2))
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
    import shutil
    paths = []
    quarantined = []
    poster = None
    def retain_previous(path):
        if path.exists():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
            backup = ART / 'rendering.quarantine' / (path.stem + '-' + digest + path.suffix)
            backup.parent.mkdir(parents=True, exist_ok=True)
            if not backup.exists():
                shutil.copy2(path, backup)
            quarantined.append(str(backup.relative_to(ROOT)))
    for name in ARGS.views.split(','):
        if name not in VIEWS:
            raise ValueError('Unknown review view: ' + name)
        camera_view(name, dof=dof)
        path = ART / (prefix + '-' + name + '.png')
        retain_previous(path)
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        if ARGS.stage == 'beauty' and name == 'entrance':
            poster = ASSETS / 'poster-depth.png'
            retain_previous(poster)
            shutil.copy2(path, poster)
            note('Native entrance beauty copied to simple-view poster', path=str(poster))
        paths.append(str(path.relative_to(ROOT)))
        note('Render saved for inspection', path=str(path))
    report_update(**{prefix: {'images': paths, 'samples_ceiling': bpy.context.scene.cycles.samples,
                             'depth_of_field': dof, 'viewed_by_agent': False,
                             'previous_images_retained': quarantined,
                             'poster': str(poster.relative_to(ROOT)) if poster else None}})


def apply_review_lightmap(manifest):
    scale = manifest['illuminationScale']
    lightmap = bpy.data.images.load(str(ASSETS / manifest['file']), check_existing=True)
    rgbm_sqrt = manifest.get('encoding') == 'RGBM_SQRT'
    lightmap.colorspace_settings.name = 'Non-Color' if rgbm_sqrt else 'sRGB'
    if rgbm_sqrt:
        lightmap.alpha_mode = 'CHANNEL_PACKED'
    # glTF import reconstructs Blender coordinates; the same native cameras apply.
    static = bpy.data.objects.get(manifest['node'])
    if static is None:
        raise RuntimeError('Static node missing after clean reimport: ' + manifest['node'])
    meshes = ([static] if static.type == 'MESH' else []) + [obj for obj in static.children_recursive if obj.type == 'MESH']
    copies = {}
    for obj in meshes:
        if len(obj.data.uv_layers) < 3:
            raise RuntimeError('Clean import did not preserve three UV sets')
        for slot_index, original in enumerate(list(obj.data.materials)):
            if original in copies:
                obj.data.materials[slot_index] = copies[original]
                continue
            # glTF intentionally shares the original materials across atlas nodes.
            # Isolate each node's review graph so its lighting texture cannot leak.
            source = original.copy()
            source.name = original.name + ' / review ' + manifest['node']
            copies[original] = source
            obj.data.materials[slot_index] = source
            p = principal(source)
            nodes, links = source.node_tree.nodes, source.node_tree.links
            output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
            base = p.inputs['Base Color']
            color_source = base.links[0].from_socket if base.is_linked else None
            if source.get('room_depth_placeholder_color', False):
                kind = family(source.get('original_material_name', source.name))
                family_color_path = ASSETS / 'surfaces' / ((kind or '') + '-color.webp')
                if kind and family_color_path.exists():
                    family_uv = nodes.new('ShaderNodeUVMap')
                    family_uv.uv_map = obj.data.uv_layers[1].name
                    family_tex = nodes.new('ShaderNodeTexImage')
                    family_tex.image = bpy.data.images.load(str(family_color_path), check_existing=True)
                    family_tex.image.colorspace_settings.name = 'sRGB'
                    family_tex.extension = 'REPEAT'
                    links.new(family_uv.outputs[0], family_tex.inputs['Vector'])
                    family_multiply = nodes.new('ShaderNodeMixRGB')
                    family_multiply.blend_type = 'MULTIPLY'
                    family_multiply.inputs[0].default_value = 1
                    # The imported base graph already contains the original
                    # scalar/color factor. Multiply it once by the detail map.
                    family_multiply.inputs[1].default_value = base.default_value
                    if color_source:
                        links.new(color_source, family_multiply.inputs[1])
                    links.new(family_tex.outputs['Color'], family_multiply.inputs[2])
                    color_source = family_multiply.outputs[0]
            uv = nodes.new('ShaderNodeUVMap')
            uv.uv_map = obj.data.uv_layers[2].name
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = lightmap
            tex.extension = 'EXTEND'
            links.new(uv.outputs[0], tex.inputs['Vector'])
            decoded_color = tex.outputs['Color']
            if rgbm_sqrt:
                root_value = nodes.new('ShaderNodeVectorMath')
                root_value.operation = 'MULTIPLY'
                links.new(tex.outputs['Color'], root_value.inputs[0])
                links.new(tex.outputs['Alpha'], root_value.inputs[1])
                square = nodes.new('ShaderNodeVectorMath')
                square.operation = 'MULTIPLY'
                links.new(root_value.outputs['Vector'], square.inputs[0])
                links.new(root_value.outputs['Vector'], square.inputs[1])
                decoded_color = square.outputs['Vector']
            multiply = nodes.new('ShaderNodeMixRGB')
            multiply.blend_type = 'MULTIPLY'
            multiply.inputs[0].default_value = 1
            multiply.inputs[1].default_value = base.default_value
            if color_source:
                links.new(color_source, multiply.inputs[1])
            links.new(decoded_color, multiply.inputs[2])
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
    note('Clean export review atlas assigned', node=manifest['node'], materials=len(copies), resolution=manifest['resolution'])


def saved_lightmap_manifests():
    primary = json.loads(MANIFEST.read_text())
    result = [primary]
    for name in primary.get('additionalLightmaps', []):
        if name != 'curiosity-lightmap.json':
            raise RuntimeError('Unknown additional atlas manifest: ' + name)
        result.append(json.loads((ASSETS / name).read_text()))
    return result


def review():
    if not MANIFEST.exists():
        raise RuntimeError('Bake and export must complete before exported review')
    manifests = saved_lightmap_manifests()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    configure(ARGS.samples or 64)
    bpy.ops.import_scene.gltf(filepath=str(EXPORT))
    if bpy.data.objects.get(SHELF_NODE) and not any(item['node'] == SHELF_NODE for item in manifests):
        raise RuntimeError('The exported shelf is missing its baked-lighting manifest')
    for manifest in manifests:
        apply_review_lightmap(manifest)
    new_lighting(quarantine_existing=False)
    render_views('room-depth-export-review', dof=False)
    report_update(export_review_mode='Clean GLB reimport; static base color multiplied by decoded baked illumination. Moving cover uses native direct lights. Runtime specular/reflections and browser shaders are not tested by this image.')


if __name__ == '__main__':
    ART.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    if ARGS.stage == 'prepare':
        prepare()
    elif ARGS.stage == 'atlas-shelf':
        atlas_shelf()
    elif ARGS.stage == 'repair-atlas':
        repair_atlas()
    elif ARGS.stage == 'repair-normals':
        repair_normals()
    elif ARGS.stage == 'bake':
        bake()
    elif ARGS.stage == 'export-only':
        export_only()
    elif ARGS.stage == 'reencode-only':
        reencode_only()
    elif ARGS.stage == 'review':
        review()
    else:
        bpy.ops.wm.open_mainfile(filepath=str(NATIVE), load_ui=False)
        configure(ARGS.samples or (1024 if ARGS.stage == 'beauty' else 64))
        render_views('room-depth-' + ARGS.stage, dof=ARGS.stage == 'beauty')
