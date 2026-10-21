import bpy, math, random, os, json
from mathutils import Vector
from math import pi, sin, cos
random.seed(445)
ROOT='/Volumes/Storage/LAI-BookOfTruths/sites/immutable-truths'
ART=ROOT+'/art'; ASSET=ROOT+'/dist/assets'
os.makedirs(ART,exist_ok=True); os.makedirs(ASSET,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)

# All geometry is authored in Blender. glTF carries the carefully chosen PBR materials.
def mat(name,c,metal=0,rough=.65,emission=None):
    m=bpy.data.materials.new(name); m.diffuse_color=(*c,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    if emission:
        p.inputs['Emission Color'].default_value=(*c,1); p.inputs['Emission Strength'].default_value=emission
    return m
wood=[mat('Walnut • patina %02d'%i,(.095+i*.008,.039+i*.004,.020+i*.003),rough=.74) for i in range(9)]
dark=mat('Old ebony joinery',(.032,.021,.017),rough=.82)
wall=mat('Umber plaster',(.10,.074,.047),rough=.97)
gold=mat('Worn brass',(.43,.26,.075),metal=.73,rough=.36)
goldbright=mat('Gold leaf lettering',(.72,.48,.15),metal=.69,rough=.30)
bronze=mat('Oxidized bronze',(.12,.105,.055),metal=.65,rough=.58)
cream=mat('Faded linen',(.56,.45,.29),rough=.94)
paper=mat('Antique paper',(.51,.40,.255),rough=.94)
pageLight=mat('Ivory page edges',(.67,.56,.37),rough=.86)
pageDark=mat('Page shadows',(.30,.23,.13),rough=1)
leather=mat('Ox-blood leather',(.105,.026,.019),rough=.57)
leatherTop=mat('Leather raised tooling',(.17,.052,.024),rough=.59)
rug=mat('Threadbare burgundy rug',(.115,.022,.027),rough=1)
rugGold=mat('Rug ochre weave',(.245,.137,.055),rough=1)
shade=mat('Amber blown glass',(.85,.47,.16),rough=.28,emission=.5)
lightMat=mat('Warm lamp glow',(1,.68,.28),rough=.3,emission=2.6)
bookcolors=[(.16,.032,.025),(.09,.105,.072),(.065,.12,.11),(.12,.10,.06),(.055,.065,.09),(.22,.11,.055),(.11,.04,.044),(.22,.18,.13),(.065,.04,.035),(.14,.12,.095)]
bookmats=[mat('Book cloth %02d'%i,c,rough=.8) for i,c in enumerate(bookcolors)]
# Bake Blender procedural grain into portable PBR textures for the real-time site.
def bake_surface(m,kind):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1
    nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF');out=nodes.get('Material Output')
    uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value=(42,1.8,1) if kind=='wood' else (110,110,1)
    links.new(uv.outputs['UV'],mapping.inputs[0])
    noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=5;noise.inputs['Roughness'].default_value=.72
    links.new(mapping.outputs['Vector'],noise.inputs['Vector'])
    ramp=nodes.new('ShaderNodeValToRGB');c=m.diffuse_color[:3]
    ramp.color_ramp.elements[0].position=.17;ramp.color_ramp.elements[0].color=tuple(v*.42 for v in c)+(1,)
    ramp.color_ramp.elements[1].position=.82;ramp.color_ramp.elements[1].color=tuple(min(.95,v*1.55) for v in c)+(1,)
    links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
    emit=nodes.new('ShaderNodeEmission');links.new(ramp.outputs['Color'],emit.inputs['Color']);links.new(emit.outputs[0],out.inputs['Surface'])
    image=bpy.data.images.new(m.name+' — Blender baked surface',width=256,height=256);image.colorspace_settings.name='sRGB'
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;nodes.active=tex
    bpy.ops.mesh.primitive_plane_add(size=2,location=(1000,1000,1000));plane=bpy.context.object;plane.data.materials.append(m)
    bpy.ops.object.bake(type='EMIT',margin=4)
    image.pack();links.new(p.outputs['BSDF'],out.inputs['Surface']);links.new(tex.outputs['Color'],p.inputs['Base Color'])
    for n in [uv,mapping,noise,ramp,emit]:nodes.remove(n)
    bpy.data.objects.remove(plane,do_unlink=True)
for material in wood:bake_surface(material,'wood')
bake_surface(leather,'leather');bake_surface(leatherTop,'leather')
print('Portable Blender surface textures baked',flush=True)
static=[]
def finish(o,name,m,parent=None,join=True):
    o.name=name
    if m:o.data.materials.append(m)
    if parent:
        o.parent=parent; o.matrix_parent_inverse=parent.matrix_world.inverted()
    elif join: static.append(o)
    return o
def cube(name,loc,scale,m,bevel=0,parent=None,join=True):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Soft worn edges','BEVEL');b.width=bevel;b.segments=2
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
    return finish(o,name,m,parent,join)
def cyl(name,loc,r,depth,m,verts=20,parent=None,rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=loc);o=bpy.context.object
    if rot:o.rotation_euler=rot
    return finish(o,name,m,parent)
def sphere(name,loc,scale,m,parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=loc);o=bpy.context.object;o.scale=scale
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,m,parent)
def torus(name,loc,major,minor,m,rot=None,parent=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=36,minor_segments=8,location=loc,major_radius=major,minor_radius=minor);o=bpy.context.object
    if rot:o.rotation_euler=rot
    return finish(o,name,m,parent)
def rod(name,a,b,r,m,parent=None):
    mid=(Vector(a)+Vector(b))/2;vec=Vector(b)-Vector(a)
    o=cyl(name,mid,r,vec.length,m,12,parent);o.rotation_euler=vec.to_track_quat('Z','Y').to_euler();return o
def curve(name,points,r,m,parent=None,cyclic=False):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=1;data.bevel_depth=r;data.bevel_resolution=2
    poly=data.splines.new('POLY');poly.points.add(len(points)-1)
    for p,co in zip(poly.points,points):p.co=(*co,1)
    poly.use_cyclic_u=cyclic;o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);finish(o,name,m,parent)
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
    return o
FONT='/System/Library/Fonts/Supplemental/Georgia.ttf'
if os.path.exists(FONT): font=bpy.data.fonts.load(FONT)
else: font=None
def text(name,body,loc,size,m,rotation=(0,0,0),parent=None,align='CENTER'):
    data=bpy.data.curves.new(name,'FONT');data.body=body;data.size=size;data.resolution_u=2;data.extrude=.0004;data.bevel_depth=0;data.bevel_resolution=0;data.align_x=align;data.align_y='CENTER';data.space_character=1.15
    if font:data.font=font
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=rotation;finish(o,name,m,parent)
    bpy.context.view_layer.objects.active=o;bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);return o

# Floor: individually laid, irregularly aged wide walnut boards.
cube('Continuous dark subfloor',(0,.5,-.14),(10.2,15.8,.10),wood[0])
for ix in range(25):
    x=-4.8+ix*.4
    for iy in range(7):
        y=-6.65+iy*2.2+(1.1 if ix%2 else 0)
        if y>8:continue
        o=cube('Wide walnut floorboard',(x,y,-.055),(.396,2.185,.11),random.choice(wood),.007)
        # Fine, restrained geometric grain, with a few old nail heads.
        for n in range(2):
            gx=x+random.uniform(-.16,.16);gy=y+random.uniform(-.85,.85)
            cube('Dark wood grain',(gx,gy,.002),(.004,random.uniform(.25,.85),.002),dark)
        if (ix+iy)%3==0:
            for sy in [-.93,.93]:cyl('Iron floor nail',(x-.14,y+sy,.003),.008,.003,bronze,8)
cube('Left plaster wall',(-5,0.5,2.25),(.18,15.6,4.5),wall)
cube('Right plaster wall',(5,.5,2.25),(.18,15.6,4.5),wall)
cube('Rear plaster wall',(0,8.3,2.25),(10.2,.18,4.5),wall)
cube('Shadowed ceiling',(0,.5,4.58),(10.2,15.6,.14),dark)
for side in [-1,1]:
    for z in [.14,.40,3.75,4.15]:cube('Continuous architectural moulding',(side*4.81,.5,z),(.16,15.6,.09),wood[3],.012)
for y in [-6.5,-3.5,-.5,2.5,5.5,8.1]:
    cube('Hand-hewn ceiling beam',(0,y,4.26),(9.8,.23,.35),wood[0],.035)
    for side in [-1,1]:
        cube('Beam corbel',(side*4.7,y,4.04),(.35,.32,.34),wood[3],.03)

# Shelves along both walls, each with hundreds of individually varied book spines.
book_vertices=[];book_faces=[];book_materials=[];book_material_index=[]
def book_spine(x,y,z,w,h,d,rotation=0):
    col=random.choice(bookmats)
    def part(n,l,s,m):
        if m not in book_materials:book_materials.append(m)
        mi=book_materials.index(m);vstart=len(book_vertices)
        for dx,dy,dz in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]:
            lx=l[0]+dx*s[0]/2;ly=l[1]+dy*s[1]/2;lz=l[2]+dz*s[2]/2
            book_vertices.append((x+lx*cos(rotation)-ly*sin(rotation),y+lx*sin(rotation)+ly*cos(rotation),z+lz))
        for face in [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]:
            book_faces.append(tuple(vstart+i for i in face));book_material_index.append(mi)
    part('Book spine',(0,-d/2,h/2),(w,.028,h),col)
    part('Upper book cover',(0,0,h-.008),(w,d,.016),col)
    part('Lower book cover',(0,0,.008),(w,d,.016),col)
    part('Book page block',(0,.006,h/2),(max(.025,w-.015),d-.025,h-.036),paper)
    for zz in [.07,h-.065]:part('Spine gilt band',(0,-d/2-.016,zz),(w*.88,.005,.009),gold)
    if w>.075:
        part('Faded spine label',(0,-d/2-.017,h*.64),(w*.67,.006,min(.10,h*.2)),random.choice([cream,gold,leather]))
        if random.random()>.5:part('Spine label rule',(0,-d/2-.021,h*.63),(w*.48,.002,.003),dark)

def shelf_bay(center,angle,width=2.4):
    origin=Vector(center)
    def tr(p):return (origin.x+p[0]*cos(angle)-p[1]*sin(angle),origin.y+p[0]*sin(angle)+p[1]*cos(angle),p[2])
    def box(n,p,s,m,bev=0):
        o=cube(n,tr(p),s,m,bev);o.rotation_euler[2]=angle;return o
    box('Bookcase dark back',(0,.30,1.9),(width,.08,3.5),wood[0])
    for x in [-width/2,width/2]:
        box('Fluted shelf upright',(x,0,1.95),(.13,.68,3.7),wood[4],.016)
        for xx in [-.032,.032]:box('Upright carved flute',(x+xx,-.354,1.95),(.012,.02,3.2),dark,.003)
        box('Column foot',(x,-.03,.19),(.23,.75,.25),wood[2],.015)
        box('Column capital',(x,-.03,3.73),(.25,.76,.16),wood[5],.013)
    for z in [.34,.88,1.42,1.96,2.50,3.04,3.58]:
        box('Solid walnut shelf',(0,0,z),(width,.68,.075),wood[4],.012)
        box('Shelf brass front lip',(0,-.351,z+.015),(width,.018,.018),gold)
    box('Pediment lower trim',(0,-.01,3.83),(width+.35,.82,.12),wood[1],.015)
    box('Pediment upper trim',(0,0,3.95),(width+.46,.88,.08),wood[5],.014)
    for row,base in enumerate([.385,.925,1.465,2.005,2.545,3.085]):
        p=-width/2+.11
        while p<width/2-.16:
            w=random.uniform(.065,.145)
            if random.random()<.045:p+=.13;continue
            h=random.uniform(.31,.45); d=random.uniform(.24,.36)
            bx,by,bz=tr((p+w/2,-.12,base))
            book_spine(bx,by,bz,w,h,d,angle)
            p+=w+.009
for side in [-1,1]:
    for y in [-5.35,-2.85,-.35,2.15,4.65,7.15]:
        # shelf faces inward; local negative-Y front points toward the center
        shelf_bay((side*4.52,y,0),pi/2 if side==-1 else -pi/2,2.26)
# Back bookcases frame a central dark niche, far table visible between them.
for x in [-3.7,-1.55,1.55,3.7]:shelf_bay((x,7.82,0),0,1.95)

book_mesh=bpy.data.meshes.new('Hundreds of individual antique books');book_mesh.from_pydata(book_vertices,[],book_faces);book_mesh.update()
for m in book_materials:book_mesh.materials.append(m)
for face,mi in zip(book_mesh.polygons,book_material_index):face.material_index=mi
book_obj=bpy.data.objects.new('Hundreds of individual antique books',book_mesh);bpy.context.collection.objects.link(book_obj);static.append(book_obj)

# Two airy arches connect the deep bookstore, with turned columns and keystone.
for y in [-.1,3.25]:
    for x in [-2.2,2.2]:
        cube('Arch square base',(x,y,.19),(.36,.38,.38),wood[3],.02)
        cyl('Arch carved column',(x,y,1.64),.115,2.65,wood[4],16)
        for z in [.43,2.93]:
            cyl('Column turned collar',(x,y,z),.17,.11,wood[6],20)
            cube('Arch capital',(x,y,3.05),(.34,.38,.16),wood[3],.015)
    pts=[(2.2*cos(t),y,3.08+.83*sin(t)) for t in [pi*i/40 for i in range(41)]]
    curve('Bookstore low vaulted arch',pts,.13,wood[3])
    curve('Arch brass inset',[(p[0],p[1]-.13,p[2]) for p in pts],.013,gold)
    cube('Arch keystone',(0,y,3.98),(.25,.3,.31),wood[5],.03)

# Runner: frayed, quietly patterned, following the invitation toward the back.
cube('Long burgundy runner',(0,-.5,.016),(2.55,10.3,.024),rug,.01)
for x in [-1.19,1.19]:
    cube('Runner outer border',(x,-.5,.031),(.055,10.15,.004),rugGold)
    cube('Runner inner border',(x*.9,-.5,.032),(.018,10.05,.004),rugGold)
for y in [-5.55,4.55]:
    cube('Runner end border',(0,y,.032),(2.38,.06,.004),rugGold)
    for x in [-1.2+i*.045 for i in range(54)]:rod('Runner fringe',(x,y,.022),(x+random.uniform(-.01,.01),y+(-.12 if y<0 else .12),.018),.006,cream)
for y in [-4.6,-3.1,-1.6,-.1,1.4,2.9,4.0]:
    pts=[(0,y-.48,.034),(.48,y,.034),(0,y+.48,.034),(-.48,y,.034)]
    curve('Woven diamond medallion',pts,.018,rugGold,cyclic=True)
    curve('Woven diamond heart',[(0,y-.3,.035),(.27,y,.035),(0,y+.3,.035),(-.27,y,.035)],.012,rugGold,cyclic=True)

# Central table: old library writing table with turned legs and drawer.
TX,TY=0,5
cube('The far table top',(TX,TY,.89),(2.25,1.6,.115),wood[5],.035)
cube('Table top darker inset',(TX,TY,.951),(2.10,1.45,.012),wood[2],.02)
for x in [-.92,.92]:
    for y in [4.4,5.6]:
        cyl('Table turned leg',(x,y,.43),.067,.79,wood[3],16)
        sphere('Table leg turning',(x,y,.64),(.10,.10,.13),wood[3])
        sphere('Table ball foot',(x,y,.09),(.09,.09,.06),wood[1])
for y in [4.35,5.65]:cube('Table apron',(0,y,.76),(1.96,.085,.24),wood[3],.012)
for x in [-1.0,1.0]:cube('Table side apron',(x,5,.76),(.085,1.3,.24),wood[3],.012)
cube('Writing table drawer',(0,4.298,.77),(.77,.032,.16),wood[2],.008)
for x in [-.26,.26]:
    sphere('Drawer handle rosette',(x,4.267,.77),(.029,.012,.029),gold)
    torus('Drawer ring pull',(x,4.245,.745),.025,.005,gold,rot=(pi/2,0,0))
# Tucked stool, a small well-used human detail.
cyl('Stool seat',(.9,6.25,.50),.34,.09,wood[4],24)
for a in [0,2*pi/3,4*pi/3]:rod('Stool splayed leg',(.9+.20*cos(a),6.25+.20*sin(a),.47),(.9+.28*cos(a),6.25+.28*sin(a),.06),.035,wood[2])

# Signature volume. The hinge remains an independent glTF node for animation.
BX,BY,BZ=0,4.92,1.052
bw,bl=.86,1.11
cube('Book lower leather cover',(BX,BY,BZ-.072),(bw+.035,bl+.035,.032),leather,.014)
cube('Book gilded page block',(BX+.018,BY,BZ-.013),(bw-.047,bl-.045,.102),pageLight,.01)
for i in range(17):
    z=BZ-.057+i*.0052
    cube('Individual aged page edge',(BX+.041,BY-bl/2+.021,z),(bw-.09,.006,.0014),pageDark)
    cube('Fore-edge page strata',(BX+bw/2-.008,BY,z),(.004,bl-.06,.0014),pageDark)
# closed volume spine held to the lower body
cube('Leather rounded book spine',(BX-bw/2-.01,BY,BZ-.005),(.054,bl+.018,.17),leather,.025)
for y in [-.41,-.24,.24,.41]:cube('Raised book spine rib',(BX-bw/2-.036,BY+y,BZ-.005),(.018,.028,.162),leatherTop,.009)
hinge=bpy.data.objects.new('BookCoverHinge',None);bpy.context.collection.objects.link(hinge);hinge.location=(BX-bw/2,BY,BZ+.056)
hinge['purpose']='Animate local Y rotation from 0 to -2.75 radians in Blender; in glTF rotate local Z from 0 to +2.75. Spine pivot at left edge.'
bpy.context.view_layer.update()
cover=cube('Book front leather cover',(BX,BY,BZ+.065),(bw+.035,bl+.035,.032),leather,.014,parent=hinge)
# Leather inset rectangles and gold tooling lie above the cover plane.
for inset,thick,mm in [(.035,.006,gold),(.058,.003,goldbright),(.10,.003,leatherTop)]:
    x0=BX-bw/2+inset;x1=BX+bw/2-inset;y0=BY-bl/2+inset;y1=BY+bl/2-inset
    curve('Gilt rectangular cover tooling',[(x0,y0,BZ+.083),(x1,y0,BZ+.083),(x1,y1,BZ+.083),(x0,y1,BZ+.083)],thick,mm,parent=hinge,cyclic=True)
for sx in [-1,1]:
    for sy in [-1,1]:
        cx=BX+sx*(bw/2-.10);cy=BY+sy*(bl/2-.10)
        for r in [.026,.05]:
            pts=[(cx+sx*r*cos(t),cy+sy*r*sin(t),BZ+.085) for t in [i*pi/2/12 for i in range(13)]]
            curve('Gilded corner flourish',pts,.004,goldbright,parent=hinge)
        sphere('Cover corner brass stud',(BX+sx*(bw/2-.035),BY+sy*(bl/2-.035),BZ+.085),(.012,.012,.004),goldbright,parent=hinge)
# Embossed title faces the visitor at the entrance (Blender negative Y).
text('Cover publisher','LEGACY AI SOLUTIONS',(BX,BY+.25,BZ+.085),.041,goldbright,parent=hinge)
text('Cover title line one','BOOK OF',(BX,BY+.08,BZ+.085),.060,goldbright,parent=hinge)
text('Cover title line two','IMMUTABLE',(BX,BY-.04,BZ+.085),.068,goldbright,parent=hinge)
text('Cover title line three','TRUTHS',(BX,BY-.16,BZ+.085),.082,goldbright,parent=hinge)
# Small gilt compass star as a discovery emblem.
for a in range(8):
    t=a*pi/4;r=.065 if a%2==0 else .04
    rod('Cover star ray',(BX,BY-.34,BZ+.085),(BX+r*cos(t),BY-.34+r*sin(t),BZ+.085),.0026,goldbright,parent=hinge)
torus('Cover star ring',(BX,BY-.34,BZ+.085),.026,.0027,goldbright,parent=hinge)
# First page is legible in the close-up before the reading interface takes over.
text('Opening page publisher','LEGACY AI SOLUTIONS',(BX+.025,BY+.28,BZ+.041),.022,leather)
text('Opening page heading','WHAT SOFTWARE',(BX+.025,BY+.13,BZ+.041),.034,leather)
text('Opening page heading two','OWES YOU',(BX+.025,BY+.06,BZ+.041),.038,leather)
text('Opening page byline',"Douglas’s Oath To This Work",(BX+.025,BY-.04,BZ+.041),.019,leather)
text('Opening page invitation','Everyone. Because everyone',(BX+.025,BY-.19,BZ+.041),.019,leather)
text('Opening page invitation two','is a beginner somewhere.',(BX+.025,BY-.235,BZ+.041),.019,leather)
for y in [-.31,-.33]:cube('Opening page rule',(BX+.025,BY+y,BZ+.041),(.36,.001,.001),gold)
# Loose ribbon extends from the antique page block.
cube('Burgundy bookmark',(BX+.22,BY-.43,BZ-.078),(.034,.53,.004),rug)

# Lamps: modeled shades and authored lighting positions for the live renderer.
light_positions=[]
def table_lamp(x,y,z,scale=1):
    cyl('Library lamp weighted base',(x,y,z+.025),.16*scale,.045,gold,24)
    cyl('Library lamp stem',(x,y,z+.24*scale),.025*scale,.43*scale,gold,16)
    sphere('Lamp stem pear',(x,y,z+.24*scale),(.055*scale,.055*scale,.09*scale),bronze)
    bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=.25*scale,radius2=.12*scale,depth=.26*scale,location=(x,y,z+.54*scale));finish(bpy.context.object,'Amber linen lampshade',shade)
    torus('Lampshade lower brass trim',(x,y,z+.41*scale),.25*scale,.009*scale,gold)
    torus('Lampshade upper brass trim',(x,y,z+.67*scale),.12*scale,.008*scale,gold)
    sphere('Warm lamp bulb',(x,y,z+.43*scale),(.065*scale,.065*scale,.05*scale),lightMat)
    light_positions.append((x,y,z+.45*scale))
table_lamp(-.81,5.26,.96,.74)
# A few slender book stacks beside the invitation.
for i in range(3):
    o=cube('Table stack antique folio',(.76,5.43,.99+i*.055),(.43,.57,.045),bookmats[2+i],.01);o.rotation_euler[2]=.06-i*.04
# Side lamp consoles and wall sconces.
for side in [-1,1]:
    for y in [-4.1,1.05,6.25]:
        x=side*3.86
        cyl('Wall sconce backplate',(side*4.11,y,2.22),.12,.035,gold,24,rot=(0,pi/2,0))
        rod('Wall sconce arm',(side*4.1,y,2.16),(x,y,2.02),.025,gold)
        cyl('Sconce brass bowl',(x,y,2.12),.115,.09,gold,24)
        sphere('Sconce amber glass',(x,y,2.32),(.11,.11,.20),shade)
        sphere('Sconce inner flame',(x,y,2.31),(.035,.035,.09),lightMat)
        light_positions.append((x,y,2.33))
# Three hanging brass pendants.
for y in [-4,1.1,6.5]:
    rod('Pendant chain',(0,y,4.4),(0,y,3.45),.008,gold)
    torus('Pendant upper ring',(0,y,3.44),.13,.012,gold)
    bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=.33,radius2=.08,depth=.16,location=(0,y,3.38));finish(bpy.context.object,'Pendant brass shade',gold)
    sphere('Pendant warm globe',(0,y,3.24),(.13,.13,.16),lightMat)
    light_positions.append((0,y,3.16))

# Exploratory left alcove: green leather reading chair, ottoman, side table.
chair=mat('Reading chair green leather',(.048,.09,.062),rough=.65)
for x in [-3.35,-2.65]:
    for y in [.62,1.34]:cube('Chair carved feet',(x,y,.17),(.08,.08,.32),wood[3],.016)
cube('Reading chair seat',(-3,1.0,.54),(.84,.85,.22),chair,.09)
cube('Reading chair back',(-3,1.4,1.12),(.88,.20,1.00),chair,.09)
for x in [-3.43,-2.57]:
    cube('Chair padded arm',(x,1,.79),(.15,.96,.17),chair,.06)
    cube('Chair arm support',(x,1,.60),(.075,.68,.28),wood[3],.02)
for x in [-3.25,-3,-2.75]:
    for z in [.95,1.25]:sphere('Chair upholstery button',(x,1.292,z),(.018,.009,.018),gold)
cube('Reading chair ottoman',(-3,.04,.39),(.76,.48,.22),chair,.07)
for x in [-3.27,-2.73]:
    for y in [-.10,.18]:cube('Ottoman feet',(x,y,.18),(.06,.06,.25),wood[3],.008)
cyl('Reading side table',(-2.4,1.9,.70),.42,.07,wood[4],32)
cyl('Side table pedestal',(-2.4,1.9,.36),.065,.65,wood[2],16)
cyl('Side table base',(-2.4,1.9,.06),.30,.09,wood[3],24)
table_lamp(-2.4,1.9,.75,.7)
text('Left alcove plaque','THE READING NOOK',(-3.6,2.68,1.7),.075,gold,rotation=(pi/2,0,0))

# Right alcove: old globe and atlas chest offer another path.
GX,GY,GZ=3.15,1.75,1.36
sea=mat('Antique globe parchment sea',(.22,.23,.16),rough=.83)
land=mat('Globe ink land',(.11,.14,.085),rough=.9)
sphere('Antique terrestrial globe',(GX,GY,GZ),(.39,.39,.39),sea)
for lat in [-60,-30,0,30,60]:
    z=GZ+.392*sin(math.radians(lat));r=.392*cos(math.radians(lat))
    torus('Globe latitude',(GX,GY,z),r,.0018,gold)
for lon in range(0,180,30):
    o=torus('Globe longitude',(GX,GY,GZ),.394,.0016,gold,rot=(pi/2,0,math.radians(lon)))
# Stylized land regions are small irregular patches on the sphere, not a modern map.
for lon0,lat0,extent in [(-70,35,.19),(20,15,.21),(90,35,.20),(130,-27,.10),(-55,-25,.13)]:
    v=[]
    for i in range(25):
        t=i*2*pi/24;lon=math.radians(lon0)+extent*cos(t)*(1+.18*sin(5*t));lat=math.radians(lat0)+extent*sin(t)*(1+.15*cos(4*t))
        v.append((GX+.397*cos(lat)*sin(lon),GY-.397*cos(lat)*cos(lon),GZ+.397*sin(lat)))
    mesh=bpy.data.meshes.new('Globe old world silhouette');mesh.from_pydata(v,[],[list(range(len(v)))]);o=bpy.data.objects.new('Faded globe landmass',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,land)
torus('Globe meridian brass ring',(GX,GY,GZ),.44,.018,gold,rot=(pi/2,.18,.12))
cyl('Globe pedestal',(GX,GY,.75),.06,.53,wood[4],20)
cyl('Globe table top',(GX,GY,.93),.56,.09,wood[4],32)
for a in range(3):rod('Globe table legs',(GX+.35*cos(a*2*pi/3),GY+.35*sin(a*2*pi/3),.91),(GX+.44*cos(a*2*pi/3),GY+.44*sin(a*2*pi/3),.08),.045,wood[2])
cube('Atlas chest',(3.15,3.0,.40),(1.3,.66,.72),wood[3],.04)
for x in [2.65,3.65]:cube('Atlas chest brass strap',(x,3,.40),(.045,.68,.73),gold,.005)
for i in range(3):cube('Oversized atlas',(3.15,3,.81+i*.065),(1.03,.70,.06),bookmats[i+3],.014)
text('Right alcove plaque','ATLAS OF ELSEWHERE',(3.45,3.37,1.55),.072,gold,rotation=(pi/2,0,0))

# Rolling ladder on the left, a vase, and desk detritus make the room lived in.
for y in [-3.1,-2.6]:rod('Library ladder rail',(-3.93,y,.08),(-4.32,y,3.25),.028,wood[5])
for z in [.3,.64,.98,1.32,1.66,2.0,2.34,2.68,3.02]:
    x=-3.93-(z/3.25)*.39;rod('Library ladder rung',(x,-3.1,z),(x,-2.6,z),.024,wood[3])
for y in [-3.13,-2.57]:cyl('Ladder wheel',(-3.9,y,.08),.07,.025,bronze,16,rot=(pi/2,0,0))
# Clock reads Sunday at 4:45, close to closing time.
CX,CY,CZ=0,8.16,3.25
cyl('Old wall clock walnut case',(CX,CY,CZ),.44,.12,wood[4],48,rot=(pi/2,0,0))
cyl('Old clock ivory face',(CX,CY-.075,CZ),.375,.012,cream,48,rot=(pi/2,0,0))
torus('Clock brass bezel',(CX,CY-.092,CZ),.386,.012,gold,rot=(pi/2,0,0))
for i,roman in enumerate(['XII','I','II','III','IV','V','VI','VII','VIII','IX','X','XI']):
    a=i*2*pi/12;text('Roman clock numeral',roman,(CX+.308*sin(a),CY-.092,CZ+.308*cos(a)),.038,dark,rotation=(pi/2,0,0))
# Face normal points toward negative Blender Y.
rod('Clock minute hand',(CX,CY-.104,CZ),(CX-.275,CY-.104,CZ),.007,dark)
a=2*pi*(4.75/12);rod('Clock hour hand',(CX,CY-.108,CZ),(CX+.19*sin(a),CY-.108,CZ+.19*cos(a)),.010,dark)
sphere('Clock pin',(CX,CY-.12,CZ),(.023,.008,.023),gold)
text('Clock Sunday label','SUNDAY',(CX,CY-.09,CZ-.14),.025,dark,rotation=(pi/2,0,0))
# A subtly welcoming inscription above the near threshold.
text('Welcome shop inscription',"SUNDAY’S",(0,-6.2,3.76),.16,gold,rotation=(pi/2,0,0))
text('Welcome shop description','SECONDHAND BOOKS & OTHER THINGS',(0,-6.2,3.53),.052,gold,rotation=(pi/2,0,0))

# Blender authoring lights are excluded from glTF; the website supplies real-time lights.
for i,p in enumerate(light_positions):
    data=bpy.data.lights.new('Practical lamp %02d'%i,'POINT');data.energy=75 if p[2]>2 else 35;data.color=(1,.69,.42);data.shadow_soft_size=.55
    o=bpy.data.objects.new(data.name,data);bpy.context.collection.objects.link(o);o.location=p
# Broad invisible bounce cards establish readable shadows in the authored render.
for loc,energy,size,target in [((0,-3,3.8),110,6,(0,2,1)),((0,4.8,3.9),170,3,(0,5,1)),((-1,5.8,2.7),80,2,(0,4.8,1))]:
    d=bpy.data.lights.new('Warm room bounce','AREA');d.energy=energy;d.shape='DISK';d.size=size;d.color=(1,.78,.56)
    o=bpy.data.objects.new(d.name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
# Ordinary warm dusty air; supernatural light is reserved for the site opening interaction.
vol=bpy.data.materials.new('Floating old paper dust atmosphere');vol.use_nodes=True;n=vol.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');v=n.new('ShaderNodeVolumePrincipled');v.inputs['Density'].default_value=.010;v.inputs['Color'].default_value=(.55,.48,.38,1);v.inputs['Anisotropy'].default_value=.3;vol.node_tree.links.new(v.outputs['Volume'],out.inputs['Volume'])
atm=cube('Render-only dusty atmosphere',(0,.5,2.2),(9.6,15,4.3),vol,join=False)
atm.hide_viewport=True
# Camera and room feel.
bpy.ops.object.camera_add(location=(0,-6.75,1.72));camera=bpy.context.object;camera.name='Entry view';camera.rotation_euler=(Vector((0,4.8,1.65))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=24
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.color=(.035,.022,.013)
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.10
scene.render.image_settings.file_format='PNG';scene.render.filepath=ART+'/bookstore-poster.png'
scene['asset_story']='Sunday 4:45. A warm antique bookstore, its far table waiting for the reader. Blender-authored room and articulated leather volume.'
scene['runtime_coordinates']='glTF conversion: Blender (x,y,z) -> Three.js (x,z,-y). Entry [0,1.72,6.75], book [0,1.052,-4.92].'
# Merge static mesh geometry by material to keep web draw calls controlled.
# Cover stays articulated, text stays real geometry, all lamps remain bright materials.
bpy.ops.object.select_all(action='DESELECT')
for o in static:
    if o and o.name in bpy.data.objects and o.type=='MESH':o.select_set(True)
if bpy.context.selected_objects:
    bpy.context.view_layer.objects.active=bpy.context.selected_objects[0];bpy.ops.object.join();merged=bpy.context.object;merged.name='AntiqueBookstoreArchitecture'
    # Merge material slots used repeatedly by the generated books.
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00005);bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_as_mainfile(filepath=ART+'/antique-bookstore.blend',compress=True)
# Export only geometry; atmospheric fog, lighting and camera are website-controlled.
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if o.type=='MESH' and o!=atm:o.select_set(True)
    if o==hinge:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=ASSET+'/bookstore.glb',export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_lights=False,export_cameras=False,export_materials='EXPORT',export_texcoords=True,export_normals=True)
meta={'blender_version':bpy.app.version_string,'coordinate_conversion':'Blender x,y,z → glTF x,z,-y','entrance':[0,1.72,6.75],'book_center':[BX,BZ,-BY],'table_center':[0,.89,-5],'book_cover_hinge':{'node':'BookCoverHinge','position':[BX-bw/2,BZ+.056,-BY],'blender_axis':'Y','gltf_axis':'Z','open_rotation_radians':2.75,'closed_rotation_radians':0},'lamp_positions_gltf':[[x,z,-y] for x,y,z in light_positions],'alcoves':{'reading_nook':[-3,1,-1],'atlas':[3.15,1.36,-1.75]},'book_dimensions':{'width':bw,'length':bl,'thickness':.17},'render':'bookstore-poster.png'}
with open(ART+'/scene-metadata.json','w') as f:json.dump(meta,f,indent=2)
print('ASSET_EXPORT_DONE',json.dumps(meta),flush=True)
# Poster and close-up are actual Blender renders, never substituted generated imagery.
bpy.ops.render.render(write_still=True)
camera.location=(1.28,3.23,2.42);camera.rotation_euler=(Vector((0,4.92,1.05))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=46
scene.render.resolution_x=1300;scene.render.resolution_y=1000;scene.render.filepath=ART+'/book-closeup.png';bpy.ops.render.render(write_still=True)
print('BLENDER_ASSETS_COMPLETE',flush=True)
