"""Rebuild only the center furnishing as twenty grounded curiosity replicas.

The original v8 checkpoint remains immutable. All room surfaces, book objects,
wall supports, nineteen repaired bottles and their UV correspondence are retained.
Canonical display objects face local -Y and are rotated toward their aisle.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import sys
import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
ROOT=args.root; ART=ROOT/'art'; SOURCE=ART/'room-curiosities.blend'; OUTPUT=ART/'room-rabbit-holes.blend'
if OUTPUT.exists(): raise RuntimeError('Preserve the existing v9 checkpoint before a deliberate rebuild.')
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False)
print('RABBIT_BUILD phase=loaded-v8',flush=True)
scene=bpy.context.scene; shop=bpy.data.objects['OldCuriosityShop']; shelf=bpy.data.objects['CenterCuriosityShelf']

def fingerprint(obj):
    h=hashlib.sha256(); mesh=obj.data
    for row in obj.matrix_world: h.update(struct.pack('<4f',*row))
    for v in mesh.vertices: h.update(struct.pack('<3f',*v.co))
    for p in mesh.polygons:
        h.update(struct.pack('<I',p.material_index));h.update(struct.pack('<%dI'%len(p.vertices),*p.vertices))
    for uv in mesh.uv_layers:
        for item in uv.data: h.update(struct.pack('<2f',*item.uv))
    return h.hexdigest()
protected={o.name:fingerprint(o) for o in scene.objects if o.type=='MESH' and o!=shelf}
oldmatnames=sorted(m.name for m in bpy.data.materials)
# Determine components rather than selecting a bounding box through unrelated mesh faces.
me=shelf.data; world=[shelf.matrix_world@v.co for v in me.vertices]; parent=list(range(len(world)))
def root(i):
    while parent[i]!=i: parent[i]=parent[parent[i]];i=parent[i]
    return i
for edge in me.edges:
    a,b=map(root,edge.vertices)
    if a!=b: parent[b]=a
parts={}
for i in range(len(world)):parts.setdefault(root(i),[]).append(i)
removed=set(); kept_components=0
for indices in parts.values():
    low=[min(world[i][a] for i in indices) for a in range(3)]
    high=[max(world[i][a] for i in indices) for a in range(3)]
    central=low[0]>-.405 and high[0]<.405 and low[1]>-3.53 and high[1]<.53
    if central:removed.update(indices)
    else:kept_components+=1
assert len(removed)>10000, 'Expected substantial original shelf geometry.'
# Include positions, materials and the original first two UV channels in retained proof.
def signatures(mesh,skip=set()):
    records=[]
    for face in mesh.polygons:
        if any(v in skip for v in face.vertices):continue
        corners=[]
        for li in face.loop_indices:
            v=shelf.matrix_world@mesh.vertices[mesh.loops[li].vertex_index].co
            corners.append(tuple(round(x,7) for x in v)+tuple(round(x,7) for uv in list(mesh.uv_layers)[:2] for x in uv.data[li].uv))
        records.append((mesh.materials[face.material_index].name,tuple(sorted(corners))))
    return hashlib.sha256(repr(sorted(records)).encode()).hexdigest()
retained_signature=signatures(me,removed); kept_faces=sum(not any(v in removed for v in p.vertices) for p in me.polygons)
bm=bmesh.new();bm.from_mesh(me);bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm,geom=[bm.verts[i] for i in removed],context='VERTS');bm.to_mesh(me);bm.free();me.update()
assert retained_signature==signatures(me), 'Wall-prop UV or geometry changed during center removal.'
assert len(me.polygons)==kept_faces
kept_vertex_count=len(me.vertices)
print('RABBIT_BUILD phase=retained-wall-proof faces='+str(kept_faces),flush=True)
new_objects=[]; group='shelf'; allgroups=[]; contacts=[]

def material(name):
    m=bpy.data.materials.get(name)
    if not m:raise RuntimeError('Missing retained material: '+name)
    return m
wood=material('Walnut • patina 03');wood_light=material('Walnut • patina 06');dark=material('Old ebony joinery')
brass=material('Tarnished old brass');bronze=material('Oxidized bronze');paper=material('Antique paper')
foxed=material('Centuries of foxing in rag paper');cloth=material('Book cloth 01');leather=material('Ox-blood leather');stone=material('Damp soot-blackened cellar stone')

def patina(name,color,rough=.65,metal=0,transmission=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;p.inputs['Transmission Weight'].default_value=transmission
    p.inputs['IOR'].default_value=1.45
    tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=235;tex.inputs['Detail'].default_value=3
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(max(.025,rough*.7),)*3+(1,);ramp.color_ramp.elements[1].color=(min(.95,rough*1.25),)*3+(1,)
    l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs['Color'],p.inputs['Roughness'])
    if not transmission:
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.10;bump.inputs['Distance'].default_value=.00015
        l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
    return m
silver=patina('Brushed silver display metal',(.48,.51,.54),.32,.8)
beige=patina('Aged ivory appliance shell',(.58,.51,.37),.58)
clay=patina('Terracotta replica pottery',(.35,.115,.048),.86)
blue=patina('Indigo painted display enamel',(.025,.085,.14),.45)
green=patina('Verdigris botanical enamel',(.08,.19,.105),.69)
red=patina('Faded red display enamel',(.31,.035,.022),.63)
glass=patina('Clear display glass',(.88,.97,.98),.10,0,.95)
water=patina('Vortex pale water',(.26,.57,.63),.22,.12)
black_steel=patina('Black steel archive case',(.025,.030,.035),.55,.7)

# Every helper makes real beveled geometry, retaining the original material system.
def finish(obj,name,mat,bevel=0):
    obj.name=name;obj.data.materials.append(mat);obj['curiosity_group']=group;obj['curiosity_original_name']=name
    bpy.context.view_layer.objects.active=obj
    if bevel:
        mod=obj.modifiers.new('Handled edge highlights','BEVEL');mod.width=bevel;mod.segments=3;mod.harden_normals=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    new_objects.append(obj);return obj

def box(name,loc,size,mat=wood,bevel=.003,rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler.z=rotation
    return finish(o,name,mat,min(bevel,min(size)*.22))
def cylinder(name,loc,radius,height,mat=brass,rotation=None,vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=height,location=loc);o=bpy.context.object
    if rotation:o.rotation_euler=rotation
    for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
    return finish(o,name,mat,min(.0012,height*.12,radius*.1))
def rod(name,start,end,radius=.004,mat=brass):
    d=Vector(end)-Vector(start);o=cylinder(name,(Vector(start)+Vector(end))/2,radius,d.length,mat,vertices=12)
    o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def ring(name,loc,radius,thickness=.004,mat=brass,rotation=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=40,minor_segments=8,major_radius=radius,minor_radius=thickness,location=loc,rotation=rotation)
    o=bpy.context.object
    for f in o.data.polygons:f.use_smooth=True
    return finish(o,name,mat)
def orb(name,loc,scale,mat=stone):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=loc);o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for f in o.data.polygons:f.use_smooth=True
    return finish(o,name,mat)
def lettering(name,text,loc,size,mat=dark,rotation=(0,0,0)):
    curve=bpy.data.curves.new(name,'FONT');curve.body=text;curve.size=size;curve.align_x='CENTER';curve.align_y='CENTER';curve.extrude=.0001;curve.resolution_u=1
    o=bpy.data.objects.new(name,curve);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=rotation
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
    return finish(o,name,mat)
def mesh_obj(name,verts,faces,mat):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o)
    return finish(o,name,mat)
def front_text(name,text,x,y,z,size,mat=dark):return lettering(name,text,(x,y,z),size,mat,(math.pi/2,0,0))
def base(name,w=.30,d=.23,h=.018,mat=wood_light):return box(name,(0,0,h/2),(w,d,h),mat,.003)

# Preserve the room's fitted floor support, including any local floorboard slope.
room_world=[shop.matrix_world@v.co for v in shop.data.vertices]
tree=BVHTree.FromPolygons(room_world,[list(p.vertices) for p in shop.data.polygons],all_triangles=False)
def floor_at(x,y):
    hit,normal,face,dist=tree.ray_cast(Vector((x,y,.16)),Vector((0,0,-1)),1)
    if hit is None:raise RuntimeError('Shelf foot has no floor support.')
    return hit.z
for top,thick in ((.22,.045),(.62,.045),(1.18,.045)):
    box('Continuous rounded display board',(0,-1.5,top-thick/2),(.76,4,thick),wood,.006)
box('Slim two sided walnut spine',(0,-1.5,.872),(.03,3.98,1.306),wood,.004)
box('Rounded spine cap',(0,-1.5,1.54),(.06,4,.03),wood_light,.005)
for y in (-3.465,-2.685,-1.895,-1.105,-.315,.465):
    for s in (-1,1):box('Rounded shelf upright',(s*.351,y,.873),(.052,.043,1.366),wood_light,.004)
for x in (-.292,.292):
    for y in (-3.36,-1.5,.36):
        floor=floor_at(x,y);bottom=floor+.0005;top=.202
        box('Foot fitted to floor',(x,y,(top+bottom)/2),(.072,.09,top-bottom),dark,.003)
        contacts.append({'id':'shelf-foot','x':x,'y':y,'gap_m':bottom-floor})

# All objects in this file use the same front-facing local coordinate system.
def build_west(index):
    if index==1:
        for x in (-.12,.12):box('Radio rubber foot',(x,0,.007),(.045,.09,.014),dark,.003)
        box('Shortwave radio rounded cabinet',(0,0,.112),(.35,.135,.205),dark,.012)
        box('Radio inset speaker cloth',(-.075,-.069,.12),(.15,.006,.15),cloth,.002)
        for i in range(11):rod('Speaker grille wire',(-.139+i*.013,-.075,.052),(-.139+i*.013,-.075,.187),.0013,bronze)
        box('Shortwave tuning scale',(.088,-.071,.171),(.12,.006,.034),paper,.002)
        for i in range(13):box('Tuning scale etched tick',(.037+i*.008,-.075,.172),(.001,.001,.013 if i%3 else .022),dark,.0001)
        for x,z,r in ((.083,.092,.039),(.137,.052,.014)):
            cylinder('Radio tuning dial',(x,-.083,z),r,.024,brass,(math.pi/2,0,0));cylinder('Radio dark dial center',(x,-.097,z),r*.6,.005,dark,(math.pi/2,0,0))
        front_text('Radio shortwave lettering','SHORTWAVE',.075,-.076,.139,.010,paper)
        for x in (-.11,.11):rod('Radio handle mount',(x,0,.211),(x,0,.245),.007,bronze)
        rod('Radio curved carrying handle',(-.11,0,.245),(.11,0,.245),.009,dark)
        rod('Telescopic antenna lower',(-.14,.035,.20),(-.152,.035,.275),.004,silver)
        rod('Telescopic antenna upper',(-.152,.035,.275),(-.164,.035,.342),.002,silver)
        orb('Antenna cap',(-.164,.035,.342),(.003,.003,.003),silver)
    elif index==2:
        base('Envelope easel base',.31,.18,.018)
        for x in (-.115,.115):rod('Envelope stand upright',(x,.035,.015),(x,.035,.255),.006,brass)
        box('Envelope sealed cream paper',(0,.004,.154),(.31,.011,.207),paper,.0015)
        # Fold edges and wax closure make the envelope distinct from a loose page.
        for a,b in [((-.15,-.002,.253),(0,-.003,.158)),((.15,-.002,.253),(0,-.003,.158)),((-.15,-.002,.054),(0,-.003,.158)),((.15,-.002,.054),(0,-.003,.158))]:rod('Envelope fold seam',a,b,.00065,foxed)
        cylinder('Envelope wax seal',(.10,-.006,.084),.017,.006,red,(math.pi/2,0,0),24)
        front_text('Target unknown stamp','TARGET\nUNKNOWN',0,-.0055,.183,.027,dark)
        front_text('Envelope replica note','REPLICA',0,-.006,.079,.008,bronze)
        box('Envelope easel ledge',(0,-.005,.047),(.32,.055,.012),wood_light,.002)
    elif index==3:
        base('File box bottom',.32,.23,.018,black_steel)
        box('Black steel case front',(0,-.11,.107),(.32,.012,.178),black_steel,.004)
        box('Black steel case back',(0,.105,.108),(.32,.012,.18),black_steel,.004)
        for x in (-.154,.154):box('Black steel side',(x,0,.108),(.012,.21,.18),black_steel,.003)
        for j in range(5):
            y=-.072+j*.034
            box('Aged case file',(0,y,.124),(.285,.012,.212),foxed,.0008)
            box('Folder tab',(-.092+j*.046,y,.240),(.055,.012,.028),paper,.001)
        box('Case file white label',(0,-.117,.139),(.23,.003,.058),paper,.001)
        front_text('UFO case files title','UFO CASE FILES',0,-.120,.139,.018,dark)
        for x in (-.055,.055):rod('File box handle attachment',(x,-.117,.073),(x,-.14,.073),.004,brass)
        rod('File box carry handle',(-.055,-.14,.073),(.055,-.14,.073),.005,brass)
        box('Case box small lock',(0,-.121,.042),(.025,.012,.024),brass,.002)
        front_text('Case replica mark','RECORDS / REPLICA',0,-.119,.182,.008,bronze)
    elif index==4:
        base('Cipher wheel wooden plinth',.30,.19,.018)
        rod('Cipher pedestal',(0,.025,.018),(0,.025,.158),.014,bronze)
        rot=(math.pi/2,0,0)
        cylinder('Cipher wheel backing',(0,.018,.177),.133,.018,dark,rot,64)
        for r,w in ((.127,.005),(.104,.003),(.084,.003),(.054,.003)):ring('Brass alphabet ring',(0,-.002,.177),r,w,brass,rot)
        for radius,offset in ((.116,0),(.071,5)):
            for j in range(26):
                a=j*math.tau/26;x=radius*math.sin(a);z=.177+radius*math.cos(a)
                front_text('Cipher alphabet '+str(radius)+' '+str(j),chr(65+(j+offset)%26),x,-.008,z,.014,brass)
        cylinder('Cipher wheel hub',(0,-.011,.177),.023,.016,brass,rot,24)
        rod('Cipher wheel pointer',(0,-.025,.177),(.042,-.025,.240),.003,red)
    elif index==5:
        # A four-legged cargo robot, with separate foot pads, knees and actuators.
        for x in (-.105,.105):
            for y in (-.071,.071):
                box('Robot planted foot',(x,y,.010),(.048,.052,.020),dark,.004)
                knee=(x+(.020 if x<0 else -.020),y*1.1,.102);hip=(x*.79,y*.72,.192)
                rod('Robot shin',(x,y,.02),knee,.012,silver);orb('Robot knee joint',knee,(.019,.019,.019),brass)
                rod('Robot upper leg',knee,hip,.017,bronze);orb('Robot articulated hip',hip,(.022,.018,.022),silver)
                rod('Robot exposed piston',(x,y+.012,.03),(knee[0],knee[1]+.012,.09),.004,brass)
        box('Robot cargo chassis',(0,0,.203),(.245,.125,.066),silver,.011)
        box('Robot canvas cargo pack',(0,.006,.265),(.175,.12,.075),cloth,.008)
        for x in (-.055,.055):
            box('Cargo strap top',(x,.006,.305),(.013,.123,.008),leather,.001)
            box('Cargo strap front',(x,-.057,.267),(.013,.008,.077),leather,.001)
        box('Robot sensor head',(.145,-.004,.207),(.055,.077,.049),dark,.008)
        cylinder('Robot sensor lens',(.176,-.004,.210),.014,.008,blue,(0,math.pi/2,0),24)
    elif index==6:
        base('Battered compass travel case',.30,.245,.028,leather)
        box('Travel case raised lid',(0,.11,.108),(.30,.018,.18),leather,.005)
        box('Travel case ivory lining',(0,.098,.111),(.266,.004,.145),foxed,.002)
        for x in (-.128,.128):box('Travel case corner reinforcement',(x,-.108,.024),(.035,.027,.014),brass,.002)
        cylinder('Compass fitted felt support',(0,-.018,.0335),.104,.011,dark,vertices=48)
        cylinder('Explorer compass round case',(0,-.018,.066),.105,.054,brass,vertices=48)
        cylinder('Compass ivory dial',(0,-.018,.095),.094,.007,paper,vertices=48)
        ring('Compass glass rim',(0,-.018,.101),.097,.004,brass)
        for j in range(32):
            a=j*math.tau/32;r1=.075 if j%4==0 else .082;r2=.09
            rod('Compass degree tick',(r1*math.sin(a),-.018+r1*math.cos(a),.102),(r2*math.sin(a),-.018+r2*math.cos(a),.102),.001,dark)
        for text,x,y in [('N',0,.044),('S',0,-.080),('E',.064,-.018),('W',-.064,-.018)]:lettering('Compass '+text,text,(x,y,.103),.017,dark)
        mesh_obj('Compass red needle',[(-.009,-.018,.105),(0,.054,.105),(.009,-.018,.105)],[(0,1,2)],red)
        mesh_obj('Compass steel needle',[(-.009,-.018,.105),(0,-.090,.105),(.009,-.018,.105)],[(2,1,0)],silver)
        cylinder('Compass needle axle',(0,-.018,.107),.006,.005,brass,vertices=16)
        front_text('Compass inner-lid map','N\nW   +   E\nS',0,.094,.112,.025,bronze)
    elif index==7:
        cylinder('Miners lamp brass foot',(0,0,.020),.077,.040,brass,vertices=40)
        cylinder('Miners lamp glass chimney',(0,0,.122),.054,.164,glass,vertices=48)
        for j in range(4):
            a=j*math.tau/4+math.pi/4;rod('Lamp protective brass bar',(.062*math.cos(a),.062*math.sin(a),.035),(.062*math.cos(a),.062*math.sin(a),.218),.004,brass)
        cylinder('Miners lamp hood',(0,0,.216),.075,.035,brass,vertices=40)
        cylinder('Lamp cap',(0,0,.241),.035,.018,bronze,vertices=32)
        cylinder('Lamp wick holder',(0,0,.064),.018,.045,bronze)
        orb('Lamp warm wick',(0,0,.094),(.009,.009,.024),paper)
        ring('Miners lamp carrying loop',(0,0,.288),.041,.005,bronze,(math.pi/2,0,0))
        for j in range(12):
            a=j*math.tau/12;box('Lamp top vent',(.041*math.cos(a),.041*math.sin(a),.238),(.009,.006,.006),dark,.001,a)
    elif index==8:
        base('Cracked old runway base',.41,.265,.020,stone)
        for x in (-.14,-.07,0,.07,.14):box('Weathered runway stripe',(x,0,.0207),(.035,.008,.0014),paper,.0002)
        for points in [[(-.18,-.09),(-.12,-.04),(-.13,.02),(-.08,.08)],[(.19,.1),(.12,.06),(.14,-.02),(.09,-.08)]]:
            for a,b in zip(points,points[1:]):rod('Runway fissure',(a[0],a[1],.021),(b[0],b[1],.021),.0017,dark)
            x,y=points[1]
            for j in range(4):rod('Weed through tarmac',(x,y,.021),(x+(j-1.5)*.007,y+.006,.048+(j%2)*.007),.001,green)
        # Nose points to the left, wings extend across the little runway.
        orb('Weathered airplane fuselage',(0,0,.090),(.15,.023,.024),silver)
        box('Airplane main wing',(.015,0,.090),(.065,.24,.008),silver,.003,-.07)
        box('Airplane tailplane',(.114,0,.100),(.04,.10,.006),blue,.002)
        mesh_obj('Airplane upright tailfin',[(.10,0,.10),(.142,0,.102),(.13,0,.153),(.10,0,.13)],[(0,1,2,3)],blue)
        orb('Airplane cockpit',(-.015,0,.111),(.031,.018,.014),blue)
        for y in (-.042,.042):
            rod('Airplane landing gear',(-.035,0,.080),(-.041,y,.035),.003,bronze)
            cylinder('Airplane grounded wheel',(-.041,y,.035),.014,.009,dark,(math.pi/2,0,0),20)
        rod('Airplane rear wheel leg',(.111,0,.076),(.12,0,.031),.003,bronze)
        cylinder('Airplane tail wheel',(.12,0,.030),.009,.008,dark,(math.pi/2,0,0),16)
        rod('Airplane propeller',(-.151,0,.057),(-.151,0,.127),.003,wood_light)
        orb('Airplane propeller spinner',(-.154,0,.090),(.009,.008,.008),brass)
    elif index==9:
        # Curved parchment sheet in a low inclined cradle with two curled ends.
        base('Map scroll display cradle',.38,.24,.016)
        verts=[];faces=[];nx,ny=22,12
        for j in range(ny+1):
            y=-.105+j*.21/ny
            for i in range(nx+1):
                x=-.175+i*.35/nx;z=.035+.31*(y+.105)+.012*math.sin(x*18)
                verts.append((x,y,z))
        for j in range(ny):
            for i in range(nx):
                a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
        mesh_obj('Partly unrolled parchment map',verts,faces,paper)
        for x in (-.177,.177):
            box('Map scroll fitted cradle',(x,0,.032),(.034,.185,.032),wood_light,.003)
            cylinder('Curled parchment scroll end',(x,0,.070),.022,.223,foxed,(math.pi/2,0,0),32)
        for j in range(5):
            y=-.075+j*.035;last=None
            for k in range(18):
                x=-.15+k*.30/17;yy=y+.007*math.sin(k*.8+j);z=.035+.31*(yy+.105)+.012*math.sin(x*18)+.0008
                if last:rod('Engraved map latitude',last,(x,yy,z),.00055,bronze)
                last=(x,yy,z)
        # A hand-drawn closed coastline and three smaller islands, above the sheet.
        coast=[(-.12,-.05),(-.10,.015),(-.075,.07),(-.03,.078),(-.005,.035),(.025,.056),(.067,.018),(.06,-.018),(.095,-.047),(.044,-.07),(.01,-.05),(-.025,-.07),(-.073,-.06),(-.12,-.05)]
        for a,b in zip(coast,coast[1:]):
            def cp(p):return (p[0],p[1],.035+.31*(p[1]+.105)+.012*math.sin(p[0]*18)+.0016)
            rod('Map illustrated coastline',cp(a),cp(b),.0012,green)
        ring('Map scroll ribbon tie',(.177,.045,.070),.024,.0024,red,(math.pi/2,0,0))
        rod('Loose map ribbon',(.177,.045,.045),(.145,.075,.025),.0024,red)
    elif index==10:
        base('Terracotta replica stand',.29,.19,.018)
        for x in (-.072,.072):rod('Disc display cradle',(x,-.012,.018),(x,.012,.091),.005,bronze)
        rot=(math.pi/2,0,0);cylinder('Phaistos terracotta replica disc',(0,.018,.170),.126,.024,clay,rot,64)
        # A raised spiral and distinct stamped pictograms, rather than flat dots.
        for i in range(170):
            a=i*.14;r=.015+.0019*a;p=(r*math.cos(a),.00525,.170+r*math.sin(a));a2=a+.14;r2=.015+.0019*a2
            rod('Phaistos spiral ridge',p,(r2*math.cos(a2),.00525,.170+r2*math.sin(a2)),.00075,bronze)
        for j in range(43):
            a=j*.55;r=.025+.0032*a;x=r*math.cos(a);z=.170+r*math.sin(a)
            if j%3==0:
                ring('Phaistos stamped circle',(x,.0053,z),.0036,.00065,bronze,rot)
                rod('Phaistos circle stem',(x,.0053,z-.003),(x,.0053,z-.009),.0007,bronze)
            elif j%3==1:
                for dx in (-.003,.003):rod('Phaistos forked symbol',(x,.0053,z-.005),(x+dx,.0053,z+.005),.0007,bronze)
            else:
                rod('Phaistos barred glyph',(x-.004,.0053,z-.004),(x+.004,.0053,z+.004),.0008,bronze)
                rod('Phaistos cross glyph',(x-.004,.0053,z+.004),(x+.004,.0053,z-.004),.0008,bronze)

# Subtle, physically mounted downward strips keep the lower displays readable.
strip=patina('Warm ivory shelf diffuser',(.58,.43,.26),.7)
sp=strip.node_tree.nodes.get('Principled BSDF');sp.inputs['Emission Color'].default_value=(1,.69,.39,1);sp.inputs['Emission Strength'].default_value=.7
for side in (-1,1):
    box('Undershelf brass light channel',(side*.285,-1.5,1.145),(.025,3.8,.013),brass,.002)
    box('Recessed warm shelf diffuser',(side*.285,-1.5,1.136),(.018,3.75,.004),strip,.0005)
    for y in (-2.82,-1.5,-.18):
        data=bpy.data.lights.new('Lower display warm wash','AREA');data.energy=4;data.shape='RECTANGLE';data.size=.13;data.size_y=1.15
        data.use_nodes=True;bb=data.node_tree.nodes.new('ShaderNodeBlackbody');bb.inputs['Temperature'].default_value=3000
        emission=next(n for n in data.node_tree.nodes if n.type=='EMISSION');data.node_tree.links.new(bb.outputs['Color'],emission.inputs['Color'])
        light=bpy.data.objects.new('Lower display warm wash',data);scene.collection.objects.link(light);light.location=(side*.28,y,1.124)
        light.rotation_euler=(Vector((side*.24,y,.67))-light.location).to_track_quat('-Z','Y').to_euler()

exec((ART/'rabbit-hole-east-props.py').read_text(),globals())
ids='priyom stargate black-vault crypto-museum darpa atlas-obscura subbrit airfields rumsey phaistos babel internet-artifacts optical-illusions unworkable-devices long-now apollo ancient-earth onezoom earth-nullschool zooniverse'.split()
labels=['PRIYOM','STARGATE','BLACK VAULT','CRYPTO MUSEUM','DARPA','ATLAS OBSCURA','SUBTERRANEA','AIRFIELDS','DAVID RUMSEY','PHAISTOS DISC','LIBRARY OF BABEL','INTERNET ARTIFACTS','OPTICAL ILLUSIONS','UNWORKABLE DEVICES','LONG NOW','APOLLO IN REAL TIME','ANCIENT EARTH','ONEZOOM','EARTH NULLSCHOOL','ZOONIVERSE']
bay_y=(-3.08,-2.29,-1.50,-.71,.08)
items=[]
def bounds_for(objects):
    bpy.context.view_layer.update();pts=[o.matrix_world@Vector(corner) for o in objects for corner in o.bound_box]
    return [[min(p[a] for p in pts) for a in range(3)],[max(p[a] for p in pts) for a in range(3)]]
def web_bounds(bounds):
    lo,hi=bounds;return [[lo[0],lo[2],-hi[1]],[hi[0],hi[2],-lo[1]]]
for i,id in enumerate(ids):
    print('RABBIT_BUILD item='+id,flush=True)
    group=id;start=len(new_objects);number=i+1;side=-1 if i<10 else 1;bay=i%5;tier=1 if i%10<5 else 0
    y=bay_y[bay];base_z=1.18 if tier else .62
    if number<=10:build_west(number)
    else:build_east(number)
    objects=new_objects[start:];local_bounds=bounds_for(objects)
    # Every assembly meets its shelf; intentional tiny seating tolerance is <1mm.
    gap=local_bounds[0][2]
    assert -.001<=gap<=.0015,(id,'Object is unsupported',gap)
    assert local_bounds[0][0]>-.225 and local_bounds[1][0]<.225,(id,'Object extends into neighbor bay',local_bounds)
    assert local_bounds[0][1]>-.155 and local_bounds[1][1]<.155,(id,'Object extends past its shelf',local_bounds)
    assert local_bounds[1][2]<.365,(id,'Object taller than intended silhouette',local_bounds)
    transform=Matrix.Translation((side*.205,y,base_z))@Matrix.Rotation(side*math.pi/2,4,'Z')
    for o in objects:o.matrix_world=transform@o.matrix_world
    object_bounds=bounds_for(objects)
    label_start=len(new_objects)
    box('Small brass '+id+' shelf label',(side*.384,y,base_z-.024),(.008,.31,.036),brass,.001)
    lettering('Engraved '+id+' website',labels[i],(side*.389,y,base_z-.024),.0115 if len(labels[i])<17 else .0097,dark,(math.pi/2,0,side*math.pi/2))
    label_bounds=bounds_for(new_objects[label_start:])
    pos=[side*.205,1.34 if tier else .77,-y];pose=[[side*1.10,1.48 if tier else 1.12,-y],pos]
    item={'id':id,'number':number,'side':side,'bay':bay,'tier':tier,'position':pos,'pose':pose,
          'bounds':dict(zip(('min','max'),web_bounds(object_bounds))),'pickBounds':web_bounds(object_bounds),'labelBounds':web_bounds(label_bounds),
          'blender_bounds':object_bounds,'base_height_m':base_z,'contact_gap_m':gap,'component_count':len(objects)}
    items.append(item);contacts.append({'id':id,'gap_m':gap,'base_height_m':base_z})

# Reject any overlap between neighboring miniature assemblies and the opposite face.
for a in items:
    for b in items:
        if a['number']>=b['number']:continue
        al,ah=a['blender_bounds'];bl,bh=b['blender_bounds']
        overlap=all(min(ah[k],bh[k])-max(al[k],bl[k])>1e-4 for k in range(3))
        assert not overlap,('Display assemblies overlap',a['id'],b['id'])

# Preserve portable UV0, physical surface UV1, and an explicit pending atlas UV2.
parts_report=[]
print('RABBIT_BUILD phase=uv-and-triangulation parts='+str(len(new_objects)),flush=True)
bpy.context.view_layer.update()
for o in new_objects:
    data=o.data
    while len(data.uv_layers)<3:data.uv_layers.new(name=('UVMap','RoomSurfaceUV','RoomLightmapUV')[len(data.uv_layers)])
    for idx,name in enumerate(('UVMap','RoomSurfaceUV','RoomLightmapUV')):data.uv_layers[idx].name=name
    bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Delivery triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=mod.name)
    data=o.data;normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
    for face in data.polygons:
        normal=normal_matrix@face.normal;dominant=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=dominant]
        for li in face.loop_indices:
            point=o.matrix_world@data.vertices[data.loops[li].vertex_index].co;u,v=point[axes[0]],point[axes[1]]
            data.uv_layers[0].data[li].uv=(u,v);data.uv_layers[1].data[li].uv=(u/.24,v/1.60);data.uv_layers[2].data[li].uv=(0,0)
    data.uv_layers[0].active_render=True
    parts_report.append({'name':o.name,'id':o['curiosity_group'],'faces':len(data.polygons),'material':data.materials[0].name})
print('RABBIT_BUILD phase=join',flush=True)
bpy.ops.object.select_all(action='DESELECT');shelf.select_set(True)
for o in new_objects:o.select_set(True)
bpy.context.view_layer.objects.active=shelf;bpy.ops.object.join()
assert retained_signature==signatures(shelf.data,set(range(kept_vertex_count,len(shelf.data.vertices)))), 'Joining new displays changed retained wall geometry or UVs.'
shelf['curiosity_groups']=json.dumps(items);shelf['lightmap_atlas_pending']=True
shelf['center_shelf_physical_bounds']=json.dumps([[-.393,-3.5,0],[.393,.5,1.56]])
assert all(protected[name]==fingerprint(bpy.data.objects[name]) for name in protected),'Protected room/book geometry changed.'
scene['room_depth_lightmap_needs_rebake']=True;scene['curiosity_geometry_version']=2
layout={'schema':1,'measured':True,'items':items,'shelf_footprint':{'minX':-.393,'maxX':.393,'minZ':-.5,'maxZ':3.5}}
(ROOT/'dist/assets/rabbit-hole-layout.json').write_text(json.dumps(layout,indent=2)+'\n')
report={'source':str(SOURCE),'output':str(OUTPUT),'removed_center_vertices':len(removed),'retained_wall_components':kept_components,
        'retained_wall_faces':kept_faces,'retained_wall_signature':retained_signature,'protected_mesh_fingerprints':protected,
        'all_protected_meshes_unchanged':True,'all_contacts_within_1_5mm':True,'all_assemblies_disjoint':True,
        'shelf_vertices':len(shelf.data.vertices),'shelf_triangles':len(shelf.data.polygons),'materials_added':sorted(set(m.name for m in bpy.data.materials)-set(oldmatnames)),
        'contacts':contacts,'items':items,'parts':parts_report,'lower_display_lights':6,'lower_display_light_watts_each':4}
(ART/'rabbit-hole-geometry-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('RABBIT_BUILD phase=save',flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT),compress=True)
print('RABBIT_HOLE_GEOMETRY_READY '+json.dumps({k:report[k] for k in ('output','removed_center_vertices','retained_wall_components','shelf_vertices','shelf_triangles','materials_added','all_protected_meshes_unchanged')}),flush=True)
