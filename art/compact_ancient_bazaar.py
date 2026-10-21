import bpy,json,os
from mathutils import Vector
ROOT='/Volumes/Storage/LAI-BookOfTruths/sites/immutable-truths'
scene=bpy.context.scene
# Keep the border largely erased but make the surviving title readable at arm's length.
title=bpy.data.materials.new('Surviving worn title impression');title.use_nodes=True
title.diffuse_color=(.30,.21,.10,1)
p=title.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.30,.21,.10,1);p.inputs['Metallic'].default_value=.12;p.inputs['Roughness'].default_value=.96
o=bpy.data.objects['AncientBookCoverDetails'];o.data.materials.append(title);titleIndex=len(o.data.materials)-1
for face in o.data.polygons:
    center=o.matrix_world@face.center
    if o.data.materials[face.material_index].name=='Almost vanished gilt' and abs(center.x)<.33 and 4.70<center.y<5.23:
        face.material_index=titleIndex
# Joining meshes preserves named UV layers. Every original object has one authored map;
# restore those nonzero per-face coordinates into a single shared map after the join.
for o in scene.objects:
    if o.type!='MESH' or len(o.data.uv_layers)<2:continue
    mesh=o.data;layers=list(mesh.uv_layers);base=layers[0]
    for p in mesh.polygons:
        source=max(layers,key=lambda layer:sum(abs(layer.data[i].uv.x)+abs(layer.data[i].uv.y) for i in p.loop_indices))
        if source!=base:
            for i in p.loop_indices:base.data[i].uv=source.data[i].uv.copy()
    while len(mesh.uv_layers)>1:mesh.uv_layers.remove(mesh.uv_layers[-1])
    mesh.uv_layers[0].name='UVMap';mesh.uv_layers.active_index=0
    print('Consolidated authored surface maps',o.name,len(layers),'to',len(mesh.uv_layers),flush=True)
# Keep the saved source closed and the poster camera at the entrance.
hinge=bpy.data.objects['BookCoverHinge'];hinge.rotation_mode='XYZ';hinge.rotation_euler[1]=0
camera=scene.camera;camera.location=(0,-6.75,1.60);camera.rotation_euler=(Vector((.04,3.3,1.40))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=27
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.filepath=ROOT+'/dist/assets/poster.png'
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/art/antique-bookstore.blend',compress=True)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if (o.type=='MESH' and o.name!='Render-only dust') or o==hinge:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=ROOT+'/dist/assets/bookstore.glb',export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_lights=False,export_cameras=False,export_materials='EXPORT',export_texcoords=True,export_normals=True)
print('COMPACT_ANCIENT_EXPORTED',os.path.getsize(ROOT+'/dist/assets/bookstore.glb'),flush=True)
bpy.ops.render.render(write_still=True)
camera.location=(.95,3.49,2.27);camera.rotation_euler=(Vector((-.13,4.92,1.06))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=43
scene.render.resolution_x=1300;scene.render.resolution_y=1000;scene.render.filepath=ROOT+'/art/ancient-book-closed.png';bpy.ops.render.render(write_still=True)
hinge.rotation_euler[1]=-2.75
scene.render.filepath=ROOT+'/art/book-open.png';bpy.ops.render.render(write_still=True)
print('COMPACT_ANCIENT_COMPLETE',flush=True)
