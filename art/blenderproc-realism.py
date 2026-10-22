import blenderproc as bproc
"""Cycles review and deployable static contact occlusion from the actual web scene.

Run with BlenderProc 2.8: blenderproc run art/blenderproc-realism.py --scene /absolute/scene.json
Export input with scripts/export-blenderproc-scene.mjs. Dependencies and temporary
outputs live outside the repository. Nothing in this pipeline changes the book.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument('--scene', required=True)
parser.add_argument('--output', default=str(Path(__file__).resolve().parents[2] / 'blenderproc-review-work'))
parser.add_argument('--ao-output', default=str(Path(__file__).resolve().parents[1] / 'dist/assets/street-surfaces/ground-ao.webp'))
parser.add_argument('--mode', choices=['all', 'ao', 'review'], default='all')
parser.add_argument('--samples', type=int, default=32)
parser.add_argument('--review-width', type=int, default=960)
parser.add_argument('--views', nargs='*', help='Optional exported/review camera names to render')
args = parser.parse_args()
source_path = Path(args.scene).resolve()
out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
source = json.loads(source_path.read_text())
started = time.time()
bproc.init()
scene = bpy.context.scene
scene.cycles.device = 'CPU'
scene.render.threads_mode = 'FIXED'; scene.render.threads = 8
bproc.renderer.set_max_amount_of_samples(args.samples)
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.transparent_max_bounces = 8
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.world.use_nodes = True
world_background = scene.world.node_tree.nodes.get('Background')
# Three.js east/up/south -> Blender east/north/up: a proper rotation, no mirroring.
axis = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
def xyz(v): return Vector((v[0], -v[2], v[1]))

materials = {}
images = {}
def flipped_image(description):
    # Older exports lacked this property; embedded glTF maps were the only
    # textures emitted into the export's textures folder and have flipY=false.
    default = not Path(description['path']).resolve().is_relative_to(source_path.parent / 'textures')
    return not description.get('flipY', default)

def image_node(material, description, color=False):
    path = str(Path(description['path']).resolve())
    key = (path, color)
    if key not in images:
        image = bpy.data.images.load(path, check_existing=False)
        image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        images[key] = image
    nodes, links = material.node_tree.nodes, material.node_tree.links
    image = nodes.new('ShaderNodeTexImage'); image.image = images[key]; image.extension = 'REPEAT'
    uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'uv' if description.get('channel', 0) == 0 else 'uv' + str(description['channel'])
    vector = uv.outputs['UV']
    center = description.get('center', [0, 0]); repeat = description.get('repeat', [1, 1]); offset = description.get('offset', [0, 0])
    if description.get('rotation', 0) or repeat != [1, 1] or center != [0, 0] or offset != [0, 0]:
        subtract = nodes.new('ShaderNodeVectorMath'); subtract.operation = 'SUBTRACT'; subtract.inputs[1].default_value = (*center, 0)
        links.new(vector, subtract.inputs[0]); vector = subtract.outputs['Vector']
        rotate = nodes.new('ShaderNodeVectorRotate'); rotate.rotation_type = 'AXIS_ANGLE'; rotate.inputs['Axis'].default_value = (0, 0, 1); rotate.inputs['Angle'].default_value = -description.get('rotation', 0)
        links.new(vector, rotate.inputs['Vector']); vector = rotate.outputs['Vector']
        scale = nodes.new('ShaderNodeVectorMath'); scale.operation = 'MULTIPLY'; scale.inputs[1].default_value = (*repeat, 1)
        links.new(vector, scale.inputs[0]); vector = scale.outputs['Vector']
        add = nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'; add.inputs[1].default_value = (center[0] + offset[0], center[1] + offset[1], 0)
        links.new(vector, add.inputs[0]); vector = add.outputs['Vector']
    if flipped_image(description):
        flip = nodes.new('ShaderNodeVectorMath'); flip.operation = 'MULTIPLY'; flip.inputs[1].default_value = (1, -1, 1)
        links.new(vector, flip.inputs[0])
        offset = nodes.new('ShaderNodeVectorMath'); offset.operation = 'ADD'; offset.inputs[1].default_value = (0, 1, 0)
        links.new(flip.outputs['Vector'], offset.inputs[0]); vector = offset.outputs['Vector']
    links.new(vector, image.inputs['Vector'])
    return image

for key, description in source['materials'].items():
    m = bpy.data.materials.new(description['name']); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF'); links = m.node_tree.links
    color = description.get('color', [1, 1, 1]); p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = description.get('roughness', .7)
    p.inputs['Metallic'].default_value = description.get('metalness', 0)
    p.inputs['IOR'].default_value = description.get('ior', 1.5)
    p.inputs['Coat Weight'].default_value = description.get('clearcoat', 0)
    p.inputs['Coat Roughness'].default_value = .2
    p.inputs['Emission Color'].default_value = (*description.get('emissive', [0, 0, 0]), 1)
    p.inputs['Emission Strength'].default_value = description.get('emissiveIntensity', 1)
    p.inputs['Transmission Weight'].default_value = description.get('transmission', 0)
    opacity = description.get('opacity', 1)
    if description.get('transparent') and opacity < 1:
        p.inputs['Alpha'].default_value = opacity
    maps = description.get('maps', {})
    if 'map' in maps:
        tex = image_node(m, maps['map'], True)
        tint = m.node_tree.nodes.new('ShaderNodeMixRGB'); tint.blend_type = 'MULTIPLY'; tint.inputs[0].default_value = 1; tint.inputs[2].default_value = (*color, 1)
        links.new(tex.outputs['Color'], tint.inputs[1]); links.new(tint.outputs[0], p.inputs['Base Color'])
    if 'roughnessMap' in maps:
        tex = image_node(m, maps['roughnessMap'])
        channel = m.node_tree.nodes.new('ShaderNodeSeparateColor'); links.new(tex.outputs['Color'], channel.inputs[0])
        multiply = m.node_tree.nodes.new('ShaderNodeMath'); multiply.operation = 'MULTIPLY'; multiply.inputs[1].default_value = description.get('roughness', 1)
        links.new(channel.outputs['Green'], multiply.inputs[0]); links.new(multiply.outputs[0], p.inputs['Roughness'])
    if 'metalnessMap' in maps:
        tex = image_node(m, maps['metalnessMap'])
        channel = m.node_tree.nodes.new('ShaderNodeSeparateColor'); links.new(tex.outputs['Color'], channel.inputs[0])
        multiply = m.node_tree.nodes.new('ShaderNodeMath'); multiply.operation = 'MULTIPLY'; multiply.inputs[1].default_value = description.get('metalness', 0)
        links.new(channel.outputs['Blue'], multiply.inputs[0]); links.new(multiply.outputs[0], p.inputs['Metallic'])
    if 'emissiveMap' in maps:
        tex = image_node(m, maps['emissiveMap'], True)
        tint = m.node_tree.nodes.new('ShaderNodeMixRGB'); tint.blend_type = 'MULTIPLY'; tint.inputs[0].default_value = 1; tint.inputs[2].default_value = (*description.get('emissive', [0, 0, 0]), 1)
        links.new(tex.outputs['Color'], tint.inputs[1]); links.new(tint.outputs[0], p.inputs['Emission Color'])
    if 'normalMap' in maps:
        tex = image_node(m, maps['normalMap']); normal = m.node_tree.nodes.new('ShaderNodeNormalMap')
        normal.uv_map = 'uv' if maps['normalMap'].get('channel', 0) == 0 else 'uv' + str(maps['normalMap']['channel'])
        if flipped_image(maps['normalMap']): normal.uv_map += '-image-down'
        normal.inputs['Strength'].default_value = description.get('normalScale', [1, 1])[0]
        links.new(tex.outputs['Color'], normal.inputs['Color']); links.new(normal.outputs['Normal'], p.inputs['Normal'])
    elif 'bumpMap' in maps:
        tex = image_node(m, maps['bumpMap']); bump = m.node_tree.nodes.new('ShaderNodeBump')
        bump.inputs['Distance'].default_value = description.get('bumpScale', .001)
        links.new(tex.outputs['Color'], bump.inputs['Height']); links.new(bump.outputs['Normal'], p.inputs['Normal'])
    materials[key] = m

geometry_cache = {}
objects = []
for i, description in enumerate(source['meshes']):
    if not description.get('visible', True): continue
    gkey = description['geometry']; material_ids = description['material']; material_ids = material_ids if isinstance(material_ids, list) else [material_ids]
    cache_key = (gkey, tuple(material_ids))
    if cache_key not in geometry_cache:
        g = source['geometries'][gkey]; positions = np.asarray(g['positions'], dtype=np.float32).reshape(-1, 3)
        indices = np.asarray(g.get('indices') or list(range(len(positions))), dtype=np.int32).reshape(-1, 3)
        mesh = bpy.data.meshes.new(description['name'] or 'Runtime geometry')
        mesh.from_pydata(positions.tolist(), [], indices.tolist()); mesh.update()
        for mat in material_ids: mesh.materials.append(materials[mat])
        for group in g.get('groups', []):
            if len(material_ids) > 1:
                for face in mesh.polygons[group['start'] // 3:(group['start'] + group['count']) // 3]: face.material_index = min(group.get('materialIndex', 0), len(material_ids) - 1)
        loop_vertices = np.asarray([loop.vertex_index for loop in mesh.loops])
        for uvkey in ['uv', 'uv1', 'uv2']:
            if g.get(uvkey):
                uv = np.asarray(g[uvkey], dtype=np.float32).reshape(-1, 2)
                layer = mesh.uv_layers.new(name=uvkey); layer.data.foreach_set('uv', uv[loop_vertices].ravel())
                if any(flipped_image(t) for mid in material_ids for t in source['materials'][mid].get('maps', {}).values()):
                    uv = uv.copy(); uv[:, 1] = 1 - uv[:, 1]
                    layer = mesh.uv_layers.new(name=uvkey + '-image-down'); layer.data.foreach_set('uv', uv[loop_vertices].ravel())
        if g.get('normals'):
            normals = np.asarray(g['normals'], dtype=np.float32).reshape(-1, 3)
            mesh.normals_split_custom_set_from_vertices(normals.tolist())
        for face in mesh.polygons: face.use_smooth = True
        geometry_cache[cache_key] = mesh
    obj = bpy.data.objects.new(description['name'] or f'Runtime mesh {i}', geometry_cache[cache_key]); scene.collection.objects.link(obj)
    obj.matrix_world = axis @ Matrix(np.asarray(description['matrixWorld']).reshape(4, 4).T.tolist())
    obj['runtime_actor'] = description.get('actor', False); obj['runtime_material_ids'] = json.dumps(material_ids)
    objects.append(obj)
    if i % 500 == 0: print('IMPORTED', i, flush=True)

# Reconstruct actual runtime light positions; radiometric values remain review
# approximations between the two engines, while geometry and maps are identical.
lights = []
for description in source.get('lights', []):
    if description['type'] in ['HemisphereLight', 'AmbientLight']: continue
    light = bproc.types.Light()
    light.set_type('SUN' if description['type'] == 'DirectionalLight' else 'SPOT' if description['type'] == 'SpotLight' else 'POINT')
    light.set_location(xyz(description['position']))
    light.set_color(description.get('color', [1, 1, 1]))
    # Three.js intensity is inverse-square on-axis radiance; Cycles point power
    # is integrated over the sphere. 4pi preserves that renderer normalization.
    # This is an engine calibration, not a measured lamp efficiency conversion.
    scale = 1 if description['type'] == 'DirectionalLight' else 4 * math.pi
    light.set_energy(description.get('intensity', 1) * scale)
    if description['type'] in ['DirectionalLight', 'SpotLight']:
        direction = xyz(description.get('target', [0, 0, 0])) - xyz(description['position'])
        light.set_rotation_euler(direction.to_track_quat('-Z', 'Y').to_euler())
    if description['type'] == 'DirectionalLight':
        light.blender_obj.data.angle = math.radians(.53)
    else:
        light.blender_obj.data.shadow_soft_size = .12
        if description['type'] == 'SpotLight':
            light.blender_obj.data.spot_size = 2 * description.get('angle', math.pi / 3)
            light.blender_obj.data.spot_blend = description.get('penumbra', 0)
    lights.append((light, description))

camera = scene.camera
report = {'tool': 'DLR-RM/BlenderProc', 'blenderproc_version': '2.8.0', 'blender_version': bpy.app.version_string,
          'source_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'meshes': len(objects),
          'geometry_count': len(geometry_cache), 'materials': len(materials), 'samples': args.samples,
          'engine': 'Cycles CPU', 'review_images': [], 'limitations': 'Offline Cycles evidence, not live browser screenshots. Runtime geometry/maps preserved; engine lighting and transparency response differ.'}
report['pipeline_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
report['camera_exposure_stops'] = {}
report['light_transport'] = {'day_sky': 'Nishita atmosphere, exported sun direction, sun disc disabled to avoid double direct sun', 'sky_strength': .35, 'local_light_power_factor': '4*pi engine normalization', 'hemisphere_and_ambient_lights': 'replaced by Cycles sky and traced bounce', 'spots': 'actual direction, twice runtime half-angle, actual penumbra'}
print('SCENE_IMPORTED', len(objects), len(geometry_cache), flush=True)

def camera_pose(position, target):
    location = xyz(position); direction = xyz(target) - location
    pose = bproc.math.build_transformation_mat(location, direction.to_track_quat('-Z', 'Y').to_euler())
    bproc.camera.add_camera_pose(pose, frame=0)

def render_png(path, samples):
    bproc.renderer.set_max_amount_of_samples(samples)
    scene.frame_start = 0; scene.frame_end = 0; scene.frame_set(0)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)

if args.mode in ['all', 'review']:
    bproc.camera.set_resolution(args.review_width, round(args.review_width * 2 / 3))
    camera.data.type = 'PERSP'; camera.data.lens = 27; camera.data.clip_end = 250
    sky = scene.world.node_tree.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_disc = False
    direction = xyz(source['sunDirection']).normalized()
    sky.sun_elevation = math.asin(direction.z); sky.sun_rotation = math.atan2(direction.y, direction.x)
    sky.air_density = 1; sky.dust_density = 1; sky.ozone_density = 1
    for time_of_day in ['day', 'night']:
        night = time_of_day == 'night'
        if night:
            for link in list(world_background.inputs['Color'].links): scene.world.node_tree.links.remove(link)
        else: scene.world.node_tree.links.new(sky.outputs['Color'], world_background.inputs['Color'])
        world_background.inputs['Color'].default_value = (.075, .105, .17, 1) if night else (.62, .74, .9, 1)
        world_background.inputs['Strength'].default_value = .07 if night else .35
        for light, description in lights:
            if description['type'] == 'DirectionalLight': light.set_energy(.025 if night else description.get('intensity', 2.8))
            elif description.get('exterior') or 'street practical' in description.get('name', '').lower():
                light.set_energy(4 * math.pi * description.get('nightIntensity', 14) if night else 0)
            else: light.set_energy(0 if night else 4 * math.pi * description.get('intensity', 1))
        # Exact day/night endpoint values from ShopStorefront.update. A window
        # must never inherit a headlamp's much brighter emission strength.
        emission_states = {
            'Street / building windows': (.025, .675),
            'Street / occupied window interior': (.025, .725),
            'Street / headlamps': (.3, 2.5),
            'Street / brake lenses': (.25, 1.05),
            'Street / lamp glass': (.1, 2.5),
        }
        for key, material in materials.items():
            name = source['materials'][key]['name']
            p = material.node_tree.nodes.get('Principled BSDF')
            if name in emission_states: p.inputs['Emission Strength'].default_value = emission_states[name][1 if night else 0]
        views = source.get('cameras', [])[:1]
        if not night:
            views = views + [{'name': 'vehicle-and-pedestrian', 'position': [-5, 1.7, 8.6], 'target': [-1.1, 1.1, 12]}]
            if source.get('includeRoom'):
                views = views + [{'name': 'shop-interior', 'position': [0, 1.65, 5.5], 'target': [0, 1.8, -2]}]
        for view in views:
            if args.views is not None and view['name'] not in args.views: continue
            # Equivalent to changing camera exposure between a bright street
            # and a dim interior. Fixture powers and transport remain intact.
            scene.view_settings.exposure = 2 if view['name'] == 'shop-interior' else 0
            camera_pose(view['position'], view['target'])
            path = out / f"{view['name']}-{time_of_day}.png"
            render_png(path, args.samples)
            report['review_images'].append(path.name)
            report['camera_exposure_stops'][path.name] = scene.view_settings.exposure
            print('REVIEW_RENDERED', path, flush=True)

if args.mode in ['all', 'ao']:
    # Extract only the actual top-facing low ground polygons. Tall pieces sharing
    # a batched concrete material are occluders, not camera-visible receivers.
    ao = bpy.data.materials.new('Static world ground contact occlusion'); ao.use_nodes = True
    nodes, links = ao.node_tree.nodes, ao.node_tree.links; nodes.clear()
    ambient = nodes.new('ShaderNodeAmbientOcclusion'); ambient.inputs['Distance'].default_value = 1.1; ambient.samples = 16
    emission = nodes.new('ShaderNodeEmission'); output = nodes.new('ShaderNodeOutputMaterial')
    links.new(ambient.outputs['AO'], emission.inputs['Color']); links.new(emission.outputs[0], output.inputs['Surface'])
    receiver_vertices = []; receiver_faces = []
    for obj in objects:
        obj.visible_camera = False
        if obj['runtime_actor']:
            obj.hide_render = True; continue
        ids = json.loads(obj['runtime_material_ids'])
        for polygon in obj.data.polygons:
            mid = ids[min(polygon.material_index, len(ids) - 1)]
            family = source['materials'][mid].get('userData', {}).get('streetSurface')
            if family not in ['asphalt', 'concrete']: continue
            pts = [obj.matrix_world @ obj.data.vertices[index].co for index in polygon.vertices]
            normal = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            if normal.length < 1e-9 or normal.normalized().z < .7 or max(p.z for p in pts) > .4: continue
            first = len(receiver_vertices); receiver_vertices.extend(tuple(p + Vector((0, 0, .0004))) for p in pts)
            receiver_faces.append(tuple(range(first, first + len(pts))))
    receiver = bpy.data.meshes.new('Exact static ground AO receivers'); receiver.from_pydata(receiver_vertices, [], receiver_faces); receiver.update(); receiver.materials.append(ao)
    obj = bpy.data.objects.new('Static ground AO camera surface', receiver); scene.collection.objects.link(obj)
    # Receivers are shifted 0.4mm upward to prevent self-hit at coincident faces.
    camera.data.type = 'ORTHO'; camera.data.ortho_scale = 80; camera.data.sensor_fit = 'HORIZONTAL'
    bproc.camera.set_resolution(2048, 512); scene.render.pixel_aspect_x = 1.25; scene.render.pixel_aspect_y = 1
    # Camera up is +BlenderY = -runtimeZ, so first image row is runtimeZ=7.5.
    camera_pose([0, 40, 15.5], [0, 0, 15.5]); camera.rotation_euler = (0, 0, 0)
    scene.view_settings.view_transform = 'Raw'; scene.view_settings.look = 'None'; scene.view_settings.exposure = 0
    world_background.inputs['Color'].default_value = (1, 1, 1, 1); world_background.inputs['Strength'].default_value = 1
    scene.cycles.use_denoising = False
    raw_path = out / 'ground-ao-linear.png'; render_png(raw_path, max(32, args.samples))
    from PIL import Image, ImageDraw
    image = Image.open(raw_path).convert('RGB'); ImageDraw.Draw(image).rectangle((0, 0, image.width - 1, image.height - 1), outline='white', width=2)
    ao_path = Path(args.ao_output).resolve(); ao_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(ao_path, format='WEBP', lossless=True, method=6)
    report['ground_ao'] = {'file': str(ao_path), 'size': list(image.size), 'bounds': {'x': [-40, 40], 'z': [7.5, 23.5]}, 'row0_world_z': 7.5, 'white_border_pixels': 2, 'receiver_triangles': len(receiver_faces), 'distance_m': 1.1, 'color_space': 'linear grayscale', 'sha256': hashlib.sha256(ao_path.read_bytes()).hexdigest()}
    sidecar = {key: value for key, value in report['ground_ao'].items() if key != 'file'}
    sidecar.update({'file': ao_path.name, 'generator': 'https://github.com/DLR-RM/BlenderProc', 'blenderproc_version': report['blenderproc_version'], 'blender_version': report['blender_version'], 'engine': report['engine'], 'samples': max(32, args.samples), 'source_geometry_sha256': report['source_sha256'], 'pipeline_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'membership': {'static_meshes': sum(not obj['runtime_actor'] for obj in objects), 'excluded_actor_meshes': sum(bool(obj['runtime_actor']) for obj in objects), 'receiver_material_families': ['asphalt', 'concrete'], 'receiver_maximum_world_height': .4, 'receiver_minimum_up_normal': .7}, 'sun_shadows_baked': False})
    ao_path.with_name('ground-ao-source.json').write_text(json.dumps(sidecar, indent=2) + '\n')
    print('AO_BAKED', ao_path, flush=True)
report['seconds'] = round(time.time() - started, 2)
(out / f'provenance-{args.mode}.json').write_text(json.dumps(report, indent=2) + '\n')
print('BLENDERPROC_REALISM_COMPLETE', json.dumps(report), flush=True)
