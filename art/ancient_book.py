# A volume that has survived centuries of handling, damp, repair and neglect.
BX,BY,BZ=0,4.92,1.052
bw,bl=.86,1.11

def cover_warp(x,y):
    u=x/(bw/2);v=(y-BY)/(bl/2)
    return .0035*sin(u*8+v*3)+.0028*sin(v*13-u*4)+.010*(abs(u)**9)*(.4+.6*sin(v*4+1))+.006*(abs(v)**10)*sin(u*5-.4)
def cover_top(x,y):return BZ+.081+cover_warp(x,y)
def warped_cover(name,z,m,parent=None):
    nx,ny=25,33;verts=[];faces=[]
    for layer in [0,1]:
        for j in range(ny+1):
            v=j/ny;yy=BY+(v-.5)*(bl+.035)
            for i in range(nx+1):
                u=i/nx;xx=BX+(u-.5)*(bw+.035)
                # Corners are rounded away and nibbled into by worn rawhide.
                corner=max(0,(abs(u-.5)-.39)/.11)*max(0,(abs(v-.5)-.39)/.11)
                xx-=math.copysign(.014*corner,xx if xx else 1);yy-=math.copysign(.017*corner,yy-BY if yy!=BY else 1)
                zz=z+(.016 if layer else -.016)+cover_warp(xx,yy)
                verts.append((xx-BX,yy-BY,zz-z))
    stride=(nx+1)*(ny+1)
    for layer in [0,1]:
        for j in range(ny):
            for i in range(nx):
                a=layer*stride+j*(nx+1)+i;quad=(a,a+1,a+nx+2,a+nx+1);faces.append(quad if layer else quad[::-1])
    boundary=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,ny+1)]+[ny*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1) for j in range(ny-1,0,-1)]
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):faces.append((a,b,b+stride,a+stride))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new(name='Leather UV')
    for p in mesh.polygons:
        for li in p.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(v.x/(bw+.035)+.5,v.y/(bl+.035)+.5)
        p.use_smooth=True
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.location=(BX,BY,z);return finish(o,name,m,parent)
warped_cover('Book lower warped leather board',BZ-.072,ancientLeather)
# Each leaf has its own offset and ragged edge; the top remains readable.
for layer in range(34):
    z=BZ-.058+layer*.00287;w=bw-.047+random.uniform(-.009,.009);l=bl-.047+random.uniform(-.010,.010)
    pts=[]
    for edge in range(4):
        for k in range(12):
            t=k/12;jitter=random.uniform(-.004,.004)
            if edge==0:x=-w/2+t*w;y=-l/2+jitter
            elif edge==1:x=w/2+jitter;y=-l/2+t*l
            elif edge==2:x=w/2-t*w;y=l/2+jitter
            else:x=-w/2+jitter;y=l/2-t*l
            pts.append((BX+.015+x,BY+y,z))
    vertices=pts+[(x,y,zz+.0025) for x,y,zz in pts];n=len(pts);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new('Deckled rag paper leaf');mesh.from_pydata(vertices,[],faces);uv=mesh.uv_layers.new(name='Paper UV')
    for p in mesh.polygons:
        for li in p.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=((co.x-BX)/bw+.5,(co.y-BY)/bl+.5)
    o=bpy.data.objects.new('Irregular darkened page',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,foxedPaper if layer==33 else random.choice(pageEdgeMats))
# A softened, cracked spine retains a few uneven raised cords.
spine=cube('Ancient collapsed leather spine',(BX-bw/2-.012,BY,BZ-.006),(.066,bl+.012,.165),ancientLeather,.023)
for i,y in enumerate([-.43,-.23,.19,.40]):
    o=cube('Frayed spine binding cord',(BX-bw/2-.040,BY+y,BZ-.008),(.019,.022+random.uniform(-.005,.007),.145),rawhide,.006);o.rotation_euler[0]=.035*(-1 if i%2 else 1)
hinge=bpy.data.objects.new('BookCoverHinge',None);bpy.context.collection.objects.link(hinge);hinge.location=(BX-bw/2,BY,BZ+.056)
hinge['purpose']='glTF local Z rotation 0 to +2.75 radians opens the ancient leather cover.'
bpy.context.view_layer.update()
cover=warped_cover('Book front leather cover',BZ+.065,ancientLeather,parent=hinge)
# Only fragments remain of one thin gilt border. No polished studs or metal corner pieces.
for edge in range(4):
    for k in range(10):
        if random.random()<.42:continue
        t0=k/10+.015;t1=(k+1)/10-.012;points=[]
        for t in [t0,(t0+t1)/2,t1]:
            if edge==0:x=-bw/2+.060+t*(bw-.120);y=BY-bl/2+.060
            elif edge==1:x=bw/2-.060;y=BY-bl/2+.060+t*(bl-.120)
            elif edge==2:x=bw/2-.060-t*(bw-.120);y=BY+bl/2-.060
            else:x=-bw/2+.060;y=BY+bl/2-.060-t*(bl-.120)
            points.append((x,y,cover_top(x,y)+.0009))
        curve('Surviving fragment of gilt tooling',points,.0011,oldGilt,parent=hinge)
# The same title survives as very faint, partly rubbed lettering.
for name,body,y,size in [('Cover publisher','LEGACY AI SOLUTIONS',.25,.034),('Cover title line one','BOOK OF',.08,.047),('Cover title line two','IMMUTABLE',-.04,.055),('Cover title line three','TRUTHS',-.16,.062)]:
    o=text(name,body,(BX,BY+y,BZ+.085),size,oldGilt,parent=hinge)
    bpy.context.view_layer.update();mw=o.matrix_world.copy();inv=mw.inverted()
    for v in o.data.vertices:
        co=mw@v.co;co.z=cover_top(co.x,co.y)+.0007;v.co=inv@co
# Deep fissures run inward from the dried edges, alongside baked fine cracking.
for i in range(19):
    side=random.choice([-1,1]);x=side*(bw/2-.021);y=BY+random.uniform(-.48,.48);pts=[]
    for j in range(random.randint(3,6)):
        x-=side*random.uniform(.013,.035);y+=random.uniform(-.018,.018);pts.append((x,y,cover_top(x,y)+.0010))
    curve('Desiccated leather fissure',pts,.0008,dark,parent=hinge)
# A small hand-sewn repair, with uneven thread loops and raw exposed corners.
patch=[(.19,BY-.40),(.33,BY-.41),(.36,BY-.29),(.29,BY-.245),(.17,BY-.29)]
verts=[(x,y,cover_top(x,y)+.002) for x,y in patch];mesh=bpy.data.meshes.new('Irregular old leather repair');mesh.from_pydata(verts,[],[tuple(range(len(verts)))]);o=bpy.data.objects.new('Hand-sewn rawhide repair',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,rawhide,hinge)
for a,b in zip(patch,patch[1:]+patch[:1]):
    for t in [.15,.4,.68,.88]:
        x=a[0]*(1-t)+b[0]*t;y=a[1]*(1-t)+b[1]*t;dx=b[0]-a[0];dy=b[1]-a[1];norm=max(.001,(dx*dx+dy*dy)**.5);ox=-dy/norm*.004;oy=dx/norm*.004
        curve('Uneven old repair stitch',[(x-ox,y-oy,cover_top(x-ox,y-oy)+.002),(x,y,cover_top(x,y)+.004),(x+ox,y+oy,cover_top(x+ox,y+oy)+.002)],.0009,stitchMat,parent=hinge)
for i in range(27):
    x=random.uniform(-.37,.38);y=BY-bl/2+random.uniform(-.008,.008)
    curve('Frayed leather fiber',[(x,y,cover_top(x,y)),(x+random.uniform(-.008,.008),y-random.uniform(.008,.018),cover_top(x,y)-random.uniform(.002,.007))],.00055,rawhide,parent=hinge)
# Physical Chapter One. The supplied opening text is preserved exactly.
text('Physical chapter number','CHAPTER ONE',(BX+.025,BY+.385,BZ+.041),.019,leather)
text('Opening page publisher','LEGACY AI SOLUTIONS',(BX+.025,BY+.28,BZ+.041),.022,leather)
text('Opening page heading','WHAT SOFTWARE',(BX+.025,BY+.13,BZ+.041),.034,leather)
text('Opening page heading two','OWES YOU',(BX+.025,BY+.06,BZ+.041),.038,leather)
text('Opening page byline',"Douglas’s Oath To This Work",(BX+.025,BY-.04,BZ+.041),.019,leather)
text('Opening page invitation','Everyone. Because everyone',(BX+.025,BY-.19,BZ+.041),.019,leather)
text('Opening page invitation two','is a beginner somewhere.',(BX+.025,BY-.235,BZ+.041),.019,leather)
for y in [-.31,-.33]:cube('Opening page worn rule',(BX+.025,BY+y,BZ+.041),(.36,.0007,.0007),oldGilt)
cube('Frayed burgundy bookmark',(BX+.22,BY-.43,BZ-.078),(.029,.53,.003),rug)
for i in range(8):curve('Bookmark frayed end',[(BX+.207+i*.0036,BY-.695,BZ-.078),(BX+.207+i*.0036+random.uniform(-.003,.003),BY-.715-random.random()*.013,BZ-.08)],.0006,rug)
print('Ancient articulated book built',flush=True)
