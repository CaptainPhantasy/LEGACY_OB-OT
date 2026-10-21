// Quiet, locally synthesized room and material sounds. No audio leaves the browser.
export class ShopSound {
  constructor(){this.enabled=false;this.context=null;this.tickCount=0;this.timers=[];}
  async setEnabled(value){
    this.enabled=value;
    if(!value){if(this.context)await this.context.suspend();return;}
    if(!this.context)this.init();
    if(this.context)await this.context.resume();
  }
  init(){
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
    this.context=new C();const c=this.context;
    this.master=c.createGain();this.master.gain.value=.5;this.master.connect(c.destination);
    const n=c.createBuffer(1,c.sampleRate*5,c.sampleRate),d=n.getChannelData(0);let last=0;
    for(let i=0;i<d.length;i++){last=(last+Math.random()*.04-.02)/1.02;d[i]=last*.5;}
    const room=c.createBufferSource();room.buffer=n;room.loop=true;
    const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=350;
    const g=c.createGain();g.gain.value=.065;room.connect(f).connect(g).connect(this.master);room.start();
    this.timers.push(setInterval(()=>{if(this.enabled&&!document.hidden)this.tick();},1000));
  }
  noise(duration,freq,gain,start=0,type='bandpass',q=.7){
    if(!this.enabled||!this.context)return;const c=this.context,t=c.currentTime+start;
    const b=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),a=b.getChannelData(0);
    for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1;
    const source=c.createBufferSource();source.buffer=b;const f=c.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;
    const g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+Math.min(.015,duration/3));g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    source.connect(f).connect(g).connect(this.master);source.start(t);source.stop(t+duration+.05);
  }
  tone(freq,duration,gain,start=0,slide=0){
    if(!this.enabled||!this.context)return;const c=this.context,t=c.currentTime+start,o=c.createOscillator(),g=c.createGain();
    o.type='sine';o.frequency.setValueAtTime(freq,t);if(slide)o.frequency.exponentialRampToValueAtTime(freq+slide,t+duration);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g).connect(this.master);o.start(t);o.stop(t+duration+.1);
  }
  tick(){this.noise(.025,this.tickCount++%2?1250:1600,.022);this.tone(this.tickCount%2?790:950,.025,.005);}
  footsteps(){for(let i=0;i<5;i++){const t=i*.48;this.noise(.17,150+i%2*50,.08,t,'lowpass');this.tone(110+i*7,.35,.018,t,.8);if(i===2)this.noise(.55,410,.017,t,'bandpass',8);}}
  bell(){[1130,1711,2302].forEach((f,i)=>this.tone(f,1.8,.035/(i+1),i*.03));}
  page(){this.noise(.65,2300,.08,0,'highpass');this.noise(.24,700,.07,.37);}
  open(){
    this.noise(1.7,380,.1,0,'bandpass',2.7);
    [0,.14,.28,.61,.83,1.04].forEach((t,i)=>this.noise(.035,650+i*130,.17-i*.017,t));
    this.tone(92,1.8,.045,0,50);this.noise(2,2100,.07,.9,'highpass');
    [130.81,196,261.63,329.63,392].forEach((f,i)=>this.tone(f,5,.028/(1+i*.5),1.4+i*.15));
  }
}
