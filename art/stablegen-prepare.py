"""Prepare actual Legacy actors with StableGen's camera-placement operator.

Run inside Blender 4.2+ with the official addon and its dependencies on sys.path.
This prepares a reviewable texturing job; it never pretends to run AI inference.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix

parser = argparse.ArgumentParser()
parser.add_argument('--scene', required=True)
parser.add_argument('--addon', required=True)
parser.add_argument('--dependencies', action='append', default=[])
parser.add_argument('--target', choices=['car', 'pedestrian'], required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--server', default='127.0.0.1:8188')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
for directory in args.dependencies:
    sys.path.insert(0, str(Path(directory).resolve()))
sys.path.insert(0, str(Path(args.addon).resolve()))
import addon_utils
addon_utils.enable('stablegen', default_set=True, persistent=False)
import stablegen

output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
source_path = Path(args.scene).resolve()
source = json.loads(source_path.read_text())
scene = bpy.context.scene
for obj in list(scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

prefs = bpy.context.preferences.addons['stablegen'].preferences
prefs.output_dir = str(output)
prefs.server_address = args.server
axis = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

def selected(description):
    if not description.get('actor'):
        return False
    x, _, z = description['matrixWorld'][12:15]
    if args.target == 'car':
        return -4.6 < x < .6 and 12.6 < z < 14.8
    return -.8 < x < .8 and 9.7 < z < 11.2

meshes = [item for item in source['meshes'] if selected(item)]
if not meshes:
    raise RuntimeError('The exported inspection actor could not be found.')
material_cache = {}
for description in meshes:
    geometry = source['geometries'][description['geometry']]
    positions = np.asarray(geometry['positions']).reshape(-1, 3)
    indices = np.asarray(geometry.get('indices') or list(range(len(positions)))).reshape(-1, 3)
    mesh = bpy.data.meshes.new(description['name'])
    mesh.from_pydata(positions.tolist(), [], indices.tolist())
    mesh.update()
    material_ids = description['material'] if isinstance(description['material'], list) else [description['material']]
    for material_id in material_ids:
        if material_id not in material_cache:
            item = source['materials'][material_id]
            material = bpy.data.materials.new(item['name']); material.use_nodes = True
            shader = material.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value = (*item['color'], 1)
            shader.inputs['Roughness'].default_value = item['roughness']
            shader.inputs['Metallic'].default_value = item['metalness']
            shader.inputs['Coat Weight'].default_value = item.get('clearcoat', 0)
            shader.inputs['Transmission Weight'].default_value = item.get('transmission', 0)
            shader.inputs['IOR'].default_value = item.get('ior', 1.5)
            material_cache[material_id] = material
        mesh.materials.append(material_cache[material_id])
    for group in geometry.get('groups', []):
        for polygon in mesh.polygons[group['start'] // 3:(group['start'] + group['count']) // 3]:
            polygon.material_index = group['materialIndex']
    loop_vertices = np.asarray([loop.vertex_index for loop in mesh.loops])
    for key in ['uv', 'uv1', 'uv2']:
        if geometry.get(key):
            uv = np.asarray(geometry[key], dtype=np.float32).reshape(-1, 2)
            mesh.uv_layers.new(name=key).data.foreach_set('uv', uv[loop_vertices].ravel())
    if geometry.get('normals'):
        mesh.normals_split_custom_set_from_vertices(np.asarray(geometry['normals']).reshape(-1, 3).tolist())
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(description['name'], mesh)
    scene.collection.objects.link(obj)
    obj.matrix_world = axis @ Matrix(np.asarray(description['matrixWorld']).reshape(4, 4).T.tolist())
    obj['legacy_source_mesh'] = description['name']
    allowed = 'car clearcoat' in description['name'].lower() if args.target == 'car' else any(
        description['name'].startswith(prefix) for prefix in [
            'Walker / skin', 'Walker / woven outerwear', 'Walker / twill trousers',
            'Walker / layered shirt', 'Walker / worn canvas satchel', 'Walker / shoes',
        ]
    )
    obj['stablegen_surface_role'] = 'refine' if allowed else 'preserve'
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
result = bpy.ops.object.add_cameras(
    placement_mode='normal_weighted', num_cameras=6, center_type='object',
    purge_others=False, consider_existing=False, occlusion_mode='none',
    auto_aspect='per_camera', auto_prompts=True, review_placement=False,
)
if result != {'FINISHED'}:
    raise RuntimeError('StableGen camera placement did not finish: ' + str(result))

prompts = {
    'car': 'Photorealistic everyday Indiana city sedan, burgundy automotive clearcoat, subtle orange-peel paint, fine restrained dust at lower panels, realistic rubber tires and machined alloy wheels, clean glazing, preserve every body panel, window and existing geometry, unbranded, neutral diffuse illumination, relightable albedo, no painted shadows or reflections.',
    'pedestrian': 'Photorealistic adult pedestrian wearing an ordinary muted olive cotton jacket and dark trousers, natural skin variation and subtle pores, realistic cloth weave, sewn seams and restrained everyday wear, preserve anatomy, clothing silhouette and face placement, neutral diffuse illumination, relightable albedo, no painted shadows or highlights.',
}
scene.comfyui_prompt = prompts[args.target]
scene.refine_prompt = prompts[args.target]
scene.comfyui_negative_prompt = 'cartoon, toy, plastic skin, exaggerated face, glowing surfaces, logos, text, extra limbs, extra face, fake seams, strong directional lighting, baked cast shadow, photorealism watermark'
scene.generation_method = 'refine'
scene.denoise = .32
scene.steps = 30
scene.cfg = 5
scene.seed = 74210 if args.target == 'car' else 74211
scene['legacy_inference_status'] = 'PENDING_COMFYUI_BACKEND'
scene['legacy_source'] = str(source_path)
scene['legacy_preserve_uv0_uv2_and_rig'] = True
for obj in scene.objects:
    obj.select_set(obj.type == 'MESH' and obj.get('stablegen_surface_role') == 'refine')
if bpy.context.selected_objects:
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
bpy.ops.wm.save_as_mainfile(filepath=str(output / (args.target + '-stablegen.blend')), compress=True)

cameras = [{
    'name': camera.name, 'matrix_world': [list(row) for row in camera.matrix_world],
    'resolution': [int(camera.get('sg_res_x', 1024)), int(camera.get('sg_res_y', 1024))],
    'view_label': camera.get('sg_view_label', ''),
} for camera in scene.objects if camera.type == 'CAMERA']
report = {
    'tool': 'https://github.com/sakalond/StableGen', 'version': list(stablegen.bl_info['version']),
    'source_commit': '1d6e83fc966afc8b2c196c011b75ce7cdaa07c83', 'blender_version': bpy.app.version_string,
    'source_scene_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
    'target': args.target, 'source_meshes': len(meshes),
    'selected_surface_meshes': [obj.name for obj in bpy.context.selected_objects if obj.type == 'MESH'],
    'triangles': sum(len(obj.data.polygons) for obj in scene.objects if obj.type == 'MESH'),
    'executed_operation': 'bpy.ops.object.add_cameras: normal_weighted, per-camera aspect',
    'cameras': cameras, 'prompt': prompts[args.target], 'denoise': .32, 'steps': 30,
    'inference_status': 'NOT_RUN_NO_COMFYUI_BACKEND', 'generated_texture_count': 0,
    'material_note': 'Actual geometry, UVs and base PBR values. Runtime microdetail maps are not copied; their originals must remain when merging generated albedo into the site.',
}
(output / (args.target + '-preparation.json')).write_text(json.dumps(report, indent=2) + '\n')
print('STABLEGEN_PREPARED', json.dumps({'target': args.target, 'meshes': len(meshes), 'cameras': len(cameras), 'inference': report['inference_status']}), flush=True)
