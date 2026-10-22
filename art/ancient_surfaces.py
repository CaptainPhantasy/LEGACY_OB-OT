# Layered procedural surfaces are baked by Blender and packed into the source and GLB.
def bake_ancient_surface(name,kind):
    m=mat(name,(.045,.025,.012) if kind=='leather' else ((.40,.32,.19) if kind=='paper' else (.10,.105,.075)),rough=.96)
    ns=m.node_tree.nodes;lk=m.node_tree.links;p=ns.get('Principled BSDF');out=ns.get('Material Output')
    uv=ns.new('ShaderNodeTexCoord')
    coarse=ns.new('ShaderNodeTexNoise');coarse.inputs['Scale'].default_value=7;coarse.inputs['Detail'].default_value=5;coarse.inputs['Roughness'].default_value=.78;lk.new(uv.outputs['UV'],coarse.inputs['Vector'])
    fine=ns.new('ShaderNodeTexNoise');fine.inputs['Scale'].default_value=150 if kind=='leather' else 95;fine.inputs['Detail'].default_value=3;lk.new(uv.outputs['UV'],fine.inputs['Vector'])
    ramp=ns.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.20;ramp.color_ramp.elements[1].position=.82
    if kind=='leather':
        ramp.color_ramp.elements[0].color=(.010,.006,.003,1);ramp.color_ramp.elements[1].color=(.105,.055,.021,1)
    elif kind=='paper':
        ramp.color_ramp.elements[0].color=(.15,.10,.045,1);ramp.color_ramp.elements[1].color=(.62,.51,.31,1)
    else:
        ramp.color_ramp.elements[0].color=(.023,.030,.017,1);ramp.color_ramp.elements[1].color=(.16,.155,.11,1)
    lk.new(coarse.outputs['Fac'],ramp.inputs['Fac']);color=ramp.outputs['Color'];height=fine.outputs['Fac']
    if kind=='leather':
        warp=ns.new('ShaderNodeVectorMath');warp.operation='SCALE';warp.inputs[3].default_value=.085;lk.new(coarse.outputs['Color'],warp.inputs[0])
        add=ns.new('ShaderNodeVectorMath');add.operation='ADD';lk.new(uv.outputs['UV'],add.inputs[0]);lk.new(warp.outputs['Vector'],add.inputs[1])
        vor=ns.new('ShaderNodeTexVoronoi');vor.feature='DISTANCE_TO_EDGE';vor.inputs['Scale'].default_value=43;lk.new(add.outputs['Vector'],vor.inputs['Vector'])
        cracks=ns.new('ShaderNodeMapRange');cracks.clamp=True;cracks.inputs['From Min'].default_value=.003;cracks.inputs['From Max'].default_value=.026;lk.new(vor.outputs['Distance'],cracks.inputs['Value'])
        mix=ns.new('ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[1].default_value=(.004,.003,.002,1);lk.new(cracks.outputs['Result'],mix.inputs[0]);lk.new(color,mix.inputs[2]);color=mix.outputs[0];height=cracks.outputs['Result']
        sep=ns.new('ShaderNodeSeparateXYZ');lk.new(uv.outputs['UV'],sep.inputs[0]);mins=[]
        for ch in ['X','Y']:
            inv=ns.new('ShaderNodeMath');inv.operation='SUBTRACT';inv.inputs[0].default_value=1;lk.new(sep.outputs[ch],inv.inputs[1])
            mn=ns.new('ShaderNodeMath');mn.operation='MINIMUM';lk.new(sep.outputs[ch],mn.inputs[0]);lk.new(inv.outputs[0],mn.inputs[1]);mins.append(mn.outputs[0])
        mn=ns.new('ShaderNodeMath');mn.operation='MINIMUM';lk.new(mins[0],mn.inputs[0]);lk.new(mins[1],mn.inputs[1])
        edge=ns.new('ShaderNodeMapRange');edge.clamp=True;edge.inputs['From Min'].default_value=.008;edge.inputs['From Max'].default_value=.105;edge.inputs['To Min'].default_value=.9;edge.inputs['To Max'].default_value=0;lk.new(mn.outputs[0],edge.inputs['Value'])
        factor=ns.new('ShaderNodeMath');factor.operation='MULTIPLY';lk.new(edge.outputs[0],factor.inputs[0]);lk.new(coarse.outputs['Fac'],factor.inputs[1])
        worn=ns.new('ShaderNodeMixRGB');worn.blend_type='MIX';lk.new(factor.outputs[0],worn.inputs[0]);lk.new(color,worn.inputs[1]);worn.inputs[2].default_value=(.19,.105,.043,1);color=worn.outputs[0]
    bump=ns.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.72;bump.inputs['Distance'].default_value=.012 if kind=='leather' else .007;lk.new(height,bump.inputs['Height']);lk.new(bump.outputs[0],p.inputs['Normal'])
    emit=ns.new('ShaderNodeEmission');lk.new(color,emit.inputs['Color']);lk.new(emit.outputs[0],out.inputs['Surface'])
    size=1024 if kind=='leather' else 512
    colorImg=bpy.data.images.new(name+' / baked color',width=size,height=size);colorImg.colorspace_settings.name='sRGB'
    tex=ns.new('ShaderNodeTexImage');tex.image=colorImg;ns.active=tex
    bpy.ops.mesh.primitive_plane_add(size=2,location=(1000,1000,1000));pl=bpy.context.object;pl.data.materials.append(m)
    bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=1;bpy.ops.object.bake(type='EMIT',margin=8);colorImg.pack()
    lk.new(p.outputs['BSDF'],out.inputs['Surface'])
    normalImg=bpy.data.images.new(name+' / baked worn relief',width=size,height=size);normalImg.colorspace_settings.name='Non-Color'
    nt=ns.new('ShaderNodeTexImage');nt.image=normalImg;ns.active=nt;bpy.ops.object.bake(type='NORMAL',margin=8);normalImg.pack()
    keep={p,out,tex,nt}
    for node in list(ns):
        if node not in keep:ns.remove(node)
    normal=ns.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.80;lk.new(nt.outputs['Color'],normal.inputs['Color']);lk.new(normal.outputs[0],p.inputs['Normal']);lk.new(tex.outputs['Color'],p.inputs['Base Color'])
    bpy.data.objects.remove(pl,do_unlink=True)
    return m
ancientLeather=bake_ancient_surface('Desiccated cracked leather','leather')
foxedPaper=bake_ancient_surface('Centuries of foxing in rag paper','paper')
cellarStone=bake_ancient_surface('Damp soot-blackened cellar stone','stone')
rawhide=mat('Exposed abraded rawhide',(.115,.070,.030),rough=.99)
oldGilt=mat('Almost vanished gilt',(.105,.065,.022),metal=.21,rough=.90)
stitchMat=mat('Blackened repair thread',(.15,.123,.071),rough=1)
pageEdgeMats=[mat('Uneven darkened leaf %02d'%i,(.28+i*.024,.215+i*.020,.115+i*.014),rough=1) for i in range(9)]
print('Ancient leather, paper and masonry surfaces baked',flush=True)
