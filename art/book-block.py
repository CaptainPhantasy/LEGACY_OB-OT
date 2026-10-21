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

