/* A thin sheet solved with Verlet inertia and position-based distance constraints.
   Spine and fingertips are boundary conditions; interior vertices are never posed. */
export class PaperDynamics {
  constructor({width=1,height=1.4,direction=1,columns=26,rows=12,duration=3.1}={}) {
    Object.assign(this,{width,height,direction,columns,rows,duration});
    this.elapsed=0;this.count=(columns+1)*(rows+1);
    this.positions=new Float32Array(this.count*3);this.previous=new Float32Array(this.count*3);this.weights=new Float32Array(this.count);this.constraints=[];
    const id=(x,y)=>y*(columns+1)+x;
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
      const i=id(x,y),p=i*3;this.positions[p]=direction*x/columns*width;this.positions[p+1]=(.5-y/rows)*height;this.positions[p+2]=.012;
      this.weights[i]=x===0||x===columns?0:1;
    }
    this.previous.set(this.positions);
    const link=(a,b,stiffness)=>{const p=this.positions;this.constraints.push([a,b,Math.hypot(p[a*3]-p[b*3],p[a*3+1]-p[b*3+1],p[a*3+2]-p[b*3+2]),stiffness]);};
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
      if(x<columns)link(id(x,y),id(x+1,y),1);
      if(y<rows)link(id(x,y),id(x,y+1),1);
      if(x<columns&&y<rows){link(id(x,y),id(x+1,y+1),.7);link(id(x+1,y),id(x,y+1),.7);}
      if(x+2<=columns)link(id(x,y),id(x+2,y),.19);
      if(y+2<=rows)link(id(x,y),id(x,y+2),.13);
    }
  }
  pin(progress) {
    const p=this.positions,c=this.columns,r=this.rows;
    const smooth=progress*progress*(3-2*progress);
    for(let y=0;y<=r;y++){
      const spine=y*(c+1)*3,edge=spine+c*3;
      p[spine]=0;p[spine+1]=(.5-y/r)*this.height;p[spine+2]=.012;
      // The lower corner leads the fingertips; this twist is transmitted through
      // stretch and bending constraints, rather than applied to the whole page.
      const twist=.11*Math.sin(Math.PI*progress)*(y/r-.3);
      const angle=Math.PI*Math.max(0,Math.min(1,smooth+twist));
      p[edge]=this.direction*Math.cos(angle)*this.width;
      p[edge+1]=(.5-y/r)*this.height+.035*Math.sin(angle)*(y/r-.5);
      p[edge+2]=Math.sin(angle)*this.width+.012;
    }
  }
  step(dt) {
    const h=Math.min(1/90,Math.max(0,dt));if(!h)return;
    this.elapsed+=h;const progress=Math.min(this.elapsed/this.duration,1),p=this.positions,prev=this.previous;
    const damping=Math.exp(-3.4*h);
    for(let i=0;i<this.count;i++)if(this.weights[i]){
      const k=i*3;for(let a=0;a<3;a++){const v=(p[k+a]-prev[k+a])*damping;prev[k+a]=p[k+a];p[k+a]+=v;}
      p[k+2]-=1.5*h*h;
    }
    this.pin(progress);
    for(let iteration=0;iteration<9;iteration++){
      for(const [a,b,length,stiffness] of this.constraints){
        const ai=a*3,bi=b*3,wa=this.weights[a],wb=this.weights[b],sum=wa+wb;if(!sum)continue;
        const dx=p[bi]-p[ai],dy=p[bi+1]-p[ai+1],dz=p[bi+2]-p[ai+2],d=Math.hypot(dx,dy,dz)||1;
        const correction=(d-length)/d*stiffness/sum;
        p[ai]+=dx*correction*wa;p[ai+1]+=dy*correction*wa;p[ai+2]+=dz*correction*wa;
        p[bi]-=dx*correction*wb;p[bi+1]-=dy*correction*wb;p[bi+2]-=dz*correction*wb;
      }
      // Contact against the book stops paper passing through the pages beneath it.
      for(let i=0;i<this.count;i++)if(p[i*3+2]<.009)p[i*3+2]=.009;
      this.pin(progress);
    }
  }
  get done(){return this.elapsed>=this.duration+.42;}
}
