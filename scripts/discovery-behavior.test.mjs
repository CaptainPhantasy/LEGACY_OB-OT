import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import { curiosities } from '../dist/curiosities.js';
import { shelfNavigation } from '../dist/shelf-navigation.js';
import { escapeHTML } from '../dist/book-content.js';

const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const originals=curiosities.filter(item=>!item.shelf);
function section(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from);
  assert.ok(from>=0&&to>from);return app.slice(from,to);
}
function node(){
  const classes=new Set();
  return {hidden:true,open:false,scrollTop:0,children:[],dataset:{},style:{},attributes:{},
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}},
    replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    setAttribute(name,value){this.attributes[name]=value;},focus(){this.focused=true;}};
}
function cardHarness(){
  const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const labels=curiosities.filter(item=>item.shelf).map(item=>({...node(),dataset:{place:item.id}}));
  const calls={routes:[],announcements:[],framing:0};
  const context=vm.createContext({curiosities,currentCuriosity:null,shelfNavigation,escapeHTML,URL,
    location:{href:'https://example.test/shop/'},$:el,$$:()=>labels,
    document:{body:node(),createElement:()=>node()},
    glide(id,route){calls.routes.push([id,route]);return true;},
    updateShelfFraming(){calls.framing++;},announce(message){calls.announcements.push(message);},
  });
  vm.runInContext(section('function showCuriosity(', 'function updateShelfFraming('),context);
  return {context,el,labels,calls};
}

test('all six original discoveries retain their complete eighteen named destinations',()=>{
  assert.deepEqual(originals.map(item=>item.id),['maps','bottles','sounds','sky','paper','time']);
  assert.equal(originals.reduce((count,item)=>count+item.links.length,0),18);
  // Pinned before this regression repair; these titles, descriptions and URLs
  // also match the catalog before the twenty-exhibit middle rack was added.
  const digest=createHash('sha256').update(JSON.stringify(originals.map(item=>[item.id,item.links]))).digest('hex');
  assert.equal(digest,'94a8848bdbbee0582270ecd3cdcc41682b46adc9545ca943e6b4aa1d0bd08354');
  assert.equal(curiosities.filter(item=>item.shelf).length,20);
});

test('every discovery renders its complete description and destinations, then starts reading at the top',()=>{
  const {context:c,el,labels,calls}=cardHarness();
  // Alternate originals with rack items to catch state leaking between card types.
  const ordered=curiosities.filter(item=>item.shelf).flatMap((item,index)=>originals[index]?[item,originals[index]]:[item]);
  for(const item of ordered){
    el('#shelf-panel').scrollTop=500;el('#shelf-panel').focused=false;
    c.showCuriosity(item.id,'checked-route');
    assert.equal(c.currentCuriosity,item.id);
    assert.equal(el('#shelf-panel').hidden,false);
    assert.equal(el('#shelf-panel').scrollTop,0);
    assert.equal(el('#shelf-panel').focused,true,`${item.id}: arrow keys need a focused scroll region`);
    assert.equal(el('#shelf-title').textContent,item.title);
    assert.equal(el('#curiosity-description').textContent,item.description);
    assert.equal(el('#shelf-panel').classList.contains('shelf-inspection'),!!item.shelf);
    assert.equal(el('#shelf-details').hidden,!item.shelf);
    assert.equal(el('#shelf-details').open,!!item.shelf,`${item.id}: the trail must not be collapsed to one sentence`);
    assert.equal(el('#shelf-navigation').hidden,!item.shelf);
    const links=el('#curiosity-links').children;
    assert.equal(links.length,item.links.length);
    for(const [index,link] of links.entries()){
      const [title,description,url]=item.links[index];
      assert.equal(link.href,url);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
      assert.ok(link.attributes['aria-label'].includes(title));
      assert.ok(link.attributes['aria-label'].includes('opens in a new tab'));
      if(!item.shelf){assert.ok(link.innerHTML.includes(escapeHTML(title)));assert.ok(link.innerHTML.includes(escapeHTML(description)));}
    }
    const related=el('#shelf-related-links').children;
    assert.equal(related.length,item.relatedLinks?.length||0);
    assert.equal(el('#shelf-related').hidden,!item.shelf||!related.length);
    for(const [index,li] of related.entries()){
      const link=li.children[0],[title,description,url]=item.relatedLinks[index];
      assert.equal(link.href,url);assert.equal(link.textContent,`${title} ↗`);assert.equal(link.title,description);
      assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
    }
    if(item.shelf){
      assert.equal(el('#shelf-trail').textContent,item.trail);
      assert.equal(el('#shelf-evidence').textContent,item.evidence);
      const nav=shelfNavigation(curiosities,item.id);
      for(const [button,next] of [['previous',nav.previous],['next',nav.next],['opposite',nav.opposite]]){
        assert.equal(el(`#shelf-${button}`).disabled,!next);
        assert.equal(el(`#shelf-${button}`).dataset.destination,next?.id||'');
      }
      assert.deepEqual(labels.filter(label=>label.classList.contains('selected')).map(label=>label.dataset.place),[item.id]);
    }else assert.equal(labels.filter(label=>label.classList.contains('selected')).length,0);
  }
  assert.equal(calls.routes.length,26);assert.equal(calls.framing,26);assert.equal(calls.announcements.length,26);
});

function waypointHarness(camera,width,height,items,spots){
  const buttons=items.map(item=>({...node(),dataset:{place:item.id}}));
  const context=vm.createContext({camera,innerWidth:width,innerHeight:height,curiosities:items,spots,place:'free',
    $:selector=>selector==='#waypoints'?{hidden:false}:{hidden:true},$$:()=>buttons,
  });
  vm.runInContext(section('function updateWaypoints(){','function settleBookForStory(){'),context);
  context.updateWaypoints();return buttons.filter(button=>button.attributes['aria-hidden']==='false');
}
test('each original wall marker remains reachable when looking directly at its object on phone and desktop',()=>{
  for(const [width,height] of [[390,844],[1440,900]])for(const item of originals){
    const camera=new THREE.PerspectiveCamera(width<600?58:52,width/height,.04,60);
    camera.position.fromArray(item.pose[0]);camera.lookAt(new THREE.Vector3(...item.pose[1]));camera.updateMatrixWorld();
    const spots=Object.fromEntries(curiosities.map(value=>[value.id,new THREE.Vector3(...value.position)]));
    const visible=waypointHarness(camera,width,height,curiosities,spots);
    const marker=visible.find(button=>button.dataset.place===item.id);
    assert.ok(marker,`${width}px: ${item.id} must not disappear behind nearer rack labels`);
    assert.equal(marker.tabIndex,0);assert.equal(marker.style.pointerEvents,'auto');
  }
});

test('nearer rack markers cannot consume every discovery slot before an original wall marker',()=>{
  for(const [width,height] of [[390,844],[1440,900]])for(const original of originals){
    const camera=new THREE.PerspectiveCamera(58,width/height,.04,60);
    camera.position.set(1.1,1.6,0);camera.lookAt(1.1,1.6,-1);camera.updateMatrixWorld();
    const items=[original,...curiosities.filter(item=>item.shelf).map(item=>({...item,side:1,labelBounds:undefined}))];
    const spot=(x,y,distance)=>new THREE.Vector3(x,y,.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(distance).add(camera.position);
    const spots={[original.id]:spot(0,-.05,8)};
    for(const [index,item] of items.slice(1).entries())spots[item.id]=spot([-.6,0,.6][index%3],.4,2+index*.03);
    const visible=waypointHarness(camera,width,height,items,spots);
    assert.ok(visible.some(button=>button.dataset.place===original.id),`${width}px: ${original.id} is farther away but still discoverable`);
    assert.ok(visible.length<=(width<600?2:3));
  }
});
