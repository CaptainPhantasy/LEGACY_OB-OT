// Recorded Foley is bundled with the site. Sources/licenses: assets/audio/credits.html.
// Room air, clock, bell, music-box notes and revelation harmony are synthesized.
const FILES={page:'page-turn.mp3',steps:'footsteps-wood.mp3',leather:'leather-creak.mp3',bus:'bus-horn.mp3'};
const BOOK=[0,1.05,-4.92], STEP_OFFSETS=[2.11,3.33,3.99,4.63,5.25,5.85];
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

export class ShopSound {
  constructor(){
    this.enabled=false;this.context=null;this.buffers={};this.loading=false;this.loadPromise=null;
    this.active=new Map();this.stepTimers=new Set();this.busTimer=null;this.tickCount=0;this.epoch=0;
    this.position=[0,1.6,6.6];this.forward=[0,0,-1];
    this.visibilityChanged=()=>this.onVisibilityChanged();
    document.addEventListener('visibilitychange',this.visibilityChanged);
  }
  get status(){
    const missing=Object.keys(FILES).filter(key=>!this.buffers[key]);
    return {enabled:this.enabled,running:this.context?.state==='running',recordedReady:missing.length===0,
      loading:this.loading,missing,loaded:Object.keys(this.buffers)};
  }
  async setEnabled(value){
    this.enabled=Boolean(value);const epoch=++this.epoch;this.clearBus();
    if(!this.enabled){this.stopFootsteps();this.stopActive();if(this.context)await this.context.suspend();return this.status;}
    if(!this.context)this.init();if(!this.context)return this.status;
    // Resume in the user gesture before awaiting the recording downloads.
    const resume=this.context.resume().catch(()=>undefined);
    await Promise.all([resume,this.loadRecordings()]);
    if(epoch!==this.epoch||!this.enabled||document.hidden)return this.status;
    this.scheduleBus(10+Math.random()*4);return this.status;
  }
  init(){
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
    const c=this.context=new Audio();this.master=c.createGain();this.master.gain.value=.64;
    const limiter=c.createDynamicsCompressor();limiter.threshold.value=-16;limiter.knee.value=18;
    limiter.ratio.value=3;limiter.attack.value=.006;limiter.release.value=.24;
    this.master.connect(limiter).connect(c.destination);
    // A short dark room response keeps the dry recording prominent.
    this.reverb=c.createConvolver();const impulse=c.createBuffer(2,Math.floor(c.sampleRate*1.45),c.sampleRate);
    for(let ch=0;ch<2;ch++){
      const data=impulse.getChannelData(ch);let smooth=0;
      for(let i=0;i<data.length;i++){smooth=smooth*.62+(Math.random()*2-1)*.38;data[i]=smooth*Math.pow(1-i/data.length,3.7);}
    }
    this.reverb.buffer=impulse;const roomTone=c.createBiquadFilter();roomTone.type='lowpass';roomTone.frequency.value=2400;
    this.reverb.connect(roomTone).connect(this.master);
    const air=c.createBuffer(1,c.sampleRate*7,c.sampleRate),data=air.getChannelData(0);let last=0;
    for(let i=0;i<data.length;i++){last=(last+Math.random()*.04-.02)/1.02;data[i]=last*.5;}
    this.air=c.createBufferSource();this.air.buffer=air;this.air.loop=true;
    const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=310;
    const g=c.createGain();g.gain.value=.04;this.air.connect(f).connect(g).connect(this.master);this.air.start();
    this.clockTimer=setInterval(()=>{if(this.canPlay())this.tick();},1000);
    this.setPosition(this.position,this.forward);
  }
  async loadRecordings(){
    if(this.loadPromise)return this.loadPromise;
    if(Object.keys(this.buffers).length===Object.keys(FILES).length)return;
    this.loading=true;
    this.loadPromise=Promise.all(Object.entries(FILES).map(async([key,file])=>{
      if(this.buffers[key])return;
      try{
        const response=await fetch(new URL(`./assets/audio/${file}`,import.meta.url));
        if(!response.ok)throw new Error(`Audio ${response.status}`);
        this.buffers[key]=await this.context.decodeAudioData(await response.arrayBuffer());
      }catch{delete this.buffers[key];}
    })).finally(()=>{this.loading=false;this.loadPromise=null;});
    return this.loadPromise;
  }
  canPlay(){return this.enabled&&!document.hidden&&this.context?.state==='running';}
  setPosition(position,forward=this.forward){
    const xyz=v=>Array.isArray(v)?v:[v.x,v.y,v.z];this.position=xyz(position);this.forward=xyz(forward);
    if(!this.context)return;
    const l=this.context.listener,t=this.context.currentTime,[x,y,z]=this.position,[fx,fy,fz]=this.forward;
    if(l.positionX){
      l.positionX.setValueAtTime(x,t);l.positionY.setValueAtTime(y,t);l.positionZ.setValueAtTime(z,t);
      l.forwardX.setValueAtTime(fx,t);l.forwardY.setValueAtTime(fy,t);l.forwardZ.setValueAtTime(fz,t);
      l.upX.setValueAtTime(0,t);l.upY.setValueAtTime(1,t);l.upZ.setValueAtTime(0,t);
    }else{l.setPosition(x,y,z);l.setOrientation(fx,fy,fz,0,1,0);}
  }
  spatial(position,options={}){
    const p=this.context.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';
    p.refDistance=options.refDistance??1;p.maxDistance=100;p.rolloffFactor=options.rolloff??.55;
    p.setPosition(...position);return p;
  }
  track(source,nodes,category){
    this.active.set(source,{nodes,category});source.onended=()=>{this.active.delete(source);for(const n of nodes)n.disconnect();};
  }
  play(key,o={}){
    if(!this.canPlay()||!this.buffers[key])return false;
    const c=this.context,b=this.buffers[key],offset=clamp(o.offset??0,0,Math.max(0,b.duration-.01));
    const segment=Math.min(o.duration??b.duration,b.duration-offset),rate=clamp(o.rate??1,.5,1.5);
    const length=segment/rate,t=c.currentTime+(o.delay??0),source=c.createBufferSource();
    source.buffer=b;source.playbackRate.value=rate;
    const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=o.lowpass??11000;
    const g=c.createGain(),volume=o.gain??.4;g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(volume,t+Math.min(.018,length/4));
    g.gain.setValueAtTime(volume,t+Math.max(.018,length-.09));g.gain.linearRampToValueAtTime(0,t+length);
    const p=this.spatial(o.position??this.position,o),send=c.createGain();send.gain.value=o.wet??.12;
    source.connect(f).connect(g).connect(p);p.connect(this.master);p.connect(send).connect(this.reverb);
    if(o.endPosition&&p.positionX){['X','Y','Z'].forEach((axis,i)=>{
      p[`position${axis}`].setValueAtTime((o.position??this.position)[i],t);
      p[`position${axis}`].linearRampToValueAtTime(o.endPosition[i],t+length);
    });}
    this.track(source,[source,f,g,p,send],o.category??key);source.start(t,offset,segment);source.stop(t+length+.03);
    document.dispatchEvent(new CustomEvent('shop-sound',{detail:{name:key,category:o.category??key,duration:length}}));return true;
  }
  // The scene calls this for each visible footfall, rather than running a loop.
  step(index=0){
    const i=Math.abs(Math.floor(index))%STEP_OFFSETS.length,side=index%2?.15:-.15;
    const[x,y,z]=this.position,[fx,,fz]=this.forward,norm=Math.hypot(fx,fz)||1;
    return this.play('steps',{offset:STEP_OFFSETS[i],duration:.48,rate:.95+(i%3)*.025,
      gain:[.25,.28,.25,.28,.29,.26][i],lowpass:6500,wet:.1,
      position:[x-fz/norm*side,Math.max(.12,y-1.4),z+fx/norm*side],category:'footstep'});
  }
  footsteps(durationMs=2600){
    this.stopFootsteps();if(!this.canPlay())return;const duration=clamp(Number(durationMs)||2600,0,30000);
    for(let i=0;i*620<duration;i++){
      const timer=setTimeout(()=>{this.stepTimers.delete(timer);this.step(i);},i*620);this.stepTimers.add(timer);
    }
  }
  stopFootsteps(){for(const timer of this.stepTimers)clearTimeout(timer);this.stepTimers.clear();this.stopActive('footstep');}
  stopActive(category){
    for(const[source,record]of this.active){
      if(category&&record.category!==category)continue;
      try{source.stop();}catch{/* Already ended. */}
      for(const node of record.nodes)node.disconnect();this.active.delete(source);
    }
  }
  page(options={}){
    const duration=clamp(Number(options.duration)||2.6,1.5,3.6),direction=options.direction===-1?-1:1;
    return this.play('page',{rate:(this.buffers.page?.duration??1.975)/duration,gain:.53,lowpass:8500,wet:.08,
      position:[BOOK[0]+.24*direction,BOOK[1]+.1,BOOK[2]],endPosition:[BOOK[0]-.24*direction,BOOK[1]+.1,BOOK[2]]});
  }
  open(){
    this.play('leather',{offset:.32,duration:2.65,rate:.79,gain:1.3,lowpass:5200,position:BOOK,wet:.1,category:'book-open'});
    this.play('leather',{offset:6.25,duration:2.35,rate:.83,gain:.95,delay:2.2,lowpass:4600,position:BOOK,wet:.14,category:'book-open'});
    this.play('page',{rate:.83,gain:.32,delay:2.6,lowpass:7000,position:BOOK,wet:.14,category:'book-open'});
    [130.81,196,261.63,329.63,392].forEach((f,i)=>this.tone(f,5,.018/(1+i*.5),2+i*.15));
  }
  close(){
    this.stopActive('book-open');this.stopActive('page');
    this.play('leather',{offset:4.1,duration:1.7,rate:.88,gain:.82,lowpass:4700,position:BOOK,wet:.1,category:'book-close'});
    this.play('page',{offset:.5,duration:.65,rate:.76,gain:.2,delay:1.3,position:BOOK,category:'book-close'});
  }
  busHorn(){return this.play('bus',{gain:.46,lowpass:820,position:[8,1.5,22],refDistance:3,rolloff:.85,wet:.24,category:'street'});}
  clearBus(){if(this.busTimer!==null)clearTimeout(this.busTimer);this.busTimer=null;}
  scheduleBus(seconds){
    this.clearBus();if(!this.canPlay())return;
    this.busTimer=setTimeout(()=>{this.busTimer=null;if(!this.canPlay())return;this.busHorn();this.scheduleBus(75+Math.random()*45);},seconds*1000);
  }
  async onVisibilityChanged(){
    if(!this.context)return;
    if(document.hidden){this.clearBus();this.stopFootsteps();this.stopActive();await this.context.suspend();}
    else if(this.enabled){await this.context.resume().catch(()=>undefined);this.scheduleBus(18+Math.random()*15);}
  }
  noise(duration,freq,volume,delay=0,type='bandpass',q=.7){
    if(!this.canPlay())return;const c=this.context,t=c.currentTime+delay;
    const b=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),a=b.getChannelData(0);
    for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1;
    const source=c.createBufferSource();source.buffer=b;const f=c.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;
    const g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+Math.min(.015,duration/3));g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    source.connect(f).connect(g).connect(this.master);this.track(source,[source,f,g],'synth');source.start(t);source.stop(t+duration+.05);
  }
  tone(freq,duration,volume,delay=0,slide=0){
    if(!this.canPlay())return;const c=this.context,t=c.currentTime+delay,source=c.createOscillator(),g=c.createGain();
    source.type='sine';source.frequency.setValueAtTime(freq,t);if(slide)source.frequency.exponentialRampToValueAtTime(freq+slide,t+duration);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+Math.min(.02,duration/2));g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    source.connect(g).connect(this.master);this.track(source,[source,g],'synth');source.start(t);source.stop(t+duration+.1);
  }
  tick(){this.noise(.025,this.tickCount++%2?1250:1600,.009);this.tone(this.tickCount%2?790:950,.025,.002);}
  bell(){[1130,1711,2302].forEach((f,i)=>this.tone(f,1.8,.025/(i+1),i*.03));}
  async dispose(){
    this.enabled=false;this.epoch++;this.clearBus();this.stopFootsteps();this.stopActive();clearInterval(this.clockTimer);
    document.removeEventListener('visibilitychange',this.visibilityChanged);if(this.air)this.air.stop();if(this.context)await this.context.close();
  }
}
