// @vitest-environment node
// The generators and operations the Rust shelf module builds its models from, compared with three.js itself
// on large pseudo-random corpora: every attribute byte, the index type, and the order of attributes.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {expect,it} from 'vitest';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import {readGeometry} from './helpers/geo-packet.js';
const shelf=needRustShelf();
function random(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function expectSame(packet,geometry,order,label){
 const actual=readGeometry(packet);
 expect(Object.keys(actual.attributes),label+' attribute order').toEqual(order);
 expect(Object.keys(geometry.attributes),label+' three attribute order').toEqual(order);
 for(const name of order){
  const left=actual.attributes[name].array,right=geometry.attributes[name].array;
  expect(left.length,`${label} ${name} length`).toBe(right.length);
  if(!bytes(left).equals(bytes(right))){
   for(let i=0;i<left.length;i++)if(!Object.is(left[i],right[i]))throw Error(`${label} ${name}[${i}] ${left[i]} / ${right[i]}`);
  }
 }
 if(geometry.index&&geometry.index.array.length===0)expect(actual.index,label+' empty index').toBeNull();
 else if(geometry.index){
  expect(actual.index,label+' index').not.toBeNull();
  expect(actual.index.constructor,label+' index type').toBe(geometry.index.array.constructor);
  expect(bytes(actual.index).equals(bytes(geometry.index.array)),label+' index bytes').toBe(true);
 }else expect(actual.index,label+' no index').toBeNull();
}
const ORDER=['position','normal','uv'];

it('draws boxes of any size and segmentation like BoxGeometry',()=>{
 const r=random(1);
 for(let trial=0;trial<250;trial++){
  const p=[r()*400+.001,r()*400+.001,r()*400+.001,1+Math.floor(r()*5),1+Math.floor(r()*5),1+Math.floor(r()*5)];
  if(trial%7===0)p[trial%3]*=-1;if(trial%11===0)p[trial%3]=0;if(trial%13===0)p[3]=p[4]=p[5]=9;
  expectSame(shelf.probe_geometry('box',p),new THREE.BoxGeometry(...p),ORDER,'box '+p);
 }
});
it('draws rounded boxes of any size, radius and segmentation like RoundedBoxGeometry',()=>{
 const r=random(2);
 for(let trial=0;trial<250;trial++){
  const p=[r()*300+.05,r()*300+.05,r()*300+.05,1+Math.floor(r()*3),r()*(trial%4?20:400)+.001];
  const reference=new RoundedBoxGeometry(...p);
  expectSame(shelf.probe_geometry('rounded_box',p),reference,ORDER,'rounded box '+p);
 }
 for(const p of [[600,15,230,1,.6],[216,2,2,1,.3],[9,14,1.2,1,.25],[3.5,3,216,1,.3],[10,20,1.2,1,.35],[2.2,320,2,1,.3],[36,12,36,2,2],[13,150,9,2,1.1]])
  expectSame(shelf.probe_geometry('rounded_box',p),new RoundedBoxGeometry(...p),ORDER,'rounded box '+p);
});
it('draws cylinders, cones and half cylinders like CylinderGeometry',()=>{
 const r=random(3);
 for(let trial=0;trial<300;trial++){
  const top=trial%5===0?0:r()*100+.01,bottom=trial%6===0?0:r()*100+.01,p=[top,bottom,r()*200+.01,3+Math.floor(r()*90),1+Math.floor(r()*4),trial%3===0?1:0,
   trial%4===0?r()*7-3:0,trial%8===0?Math.PI:trial%4===0?r()*7:Math.PI*2];
  expectSame(shelf.probe_geometry('cylinder',p),new THREE.CylinderGeometry(p[0],p[1],p[2],p[3],p[4],p[5]===1,p[6],p[7]),ORDER,'cylinder '+p);
 }
 for(const p of [[2.55*.88,2.55,1.1,20,1,0,0,Math.PI*2],[5.35,5.6,4.8,24,1,0,0,Math.PI*2],[2.8,2.8,2.2,8,1,0,0,Math.PI*2],[1.15,1.15,3,8,1,0,0,Math.PI*2]])
  expectSame(shelf.probe_geometry('cylinder',p),new THREE.CylinderGeometry(p[0],p[1],p[2],p[3],p[4],false,p[6],p[7]),ORDER,'cylinder '+p);
});
function polygon(r,kind,center,scale){
 const count=kind==='many'?90+Math.floor(r()*40):kind==='star'?6+Math.floor(r()*30):kind==='tiny'?3:kind==='collinear'?8:4+Math.floor(r()*20),points=[];
 for(let i=0;i<count;i++){
  const angle=i/count*Math.PI*2*(kind==='cw'?-1:1),radius=scale*(kind==='star'?(i%2?.45:1):1+(kind==='ragged'?(r()-.5)*.3:0));
  points.push([center[0]+Math.cos(angle)*radius,center[1]+Math.sin(angle)*radius]);
 }
 if(kind==='collinear'){for(let i=0;i<4;i++)points.splice(1+i*2,0,[(points[i*2][0]+points[i*2+1][0])/2,(points[i*2][1]+points[i*2+1][1])/2]);}
 return points;
}
function shapeOf(points,holes){
 const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(...p)));
 for(const hole of holes)shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(...p))));
 return shape;
}
function polygonCase(r,trial){
 const kinds=['convex','star','ragged','cw','collinear','tiny','many'],kind=kinds[trial%kinds.length],scale=20+r()*80;
 const outer=polygon(r,kind,[r()*10,r()*10],scale);
 if(trial%5===0)outer.push([...outer[0]]); // a repeated end point
 if(trial%9===0)outer.splice(2,0,[...outer[1]]); // a repeated point
 const holes=[];
 if(kind!=='tiny'&&trial%3!==0)for(let h=0;h<1+trial%3;h++)holes.push(polygon(r,trial%2?'convex':'cw',[outer[0][0]*.0+r()*20-10+h*scale*.0,r()*20-10+(h-1)*scale*.35],scale*.12*(1+r())));
 return{outer,holes};
}
it('extrudes outlines with holes, repeated points and either winding like ExtrudeGeometry',()=>{
 const r=random(4);let done=0;
 for(let trial=0;trial<260;trial++){
  const {outer,holes}=polygonCase(r,trial),depth=r()*30+.1;
  const flat=[depth,outer.length,...outer.flat(),holes.length,...holes.flatMap(h=>[h.length,...h.flat()])];
  const reference=new THREE.ExtrudeGeometry(shapeOf(outer,holes),{depth,bevelEnabled:false,steps:1,curveSegments:1});
  expectSame(shelf.probe_geometry('extrude',flat),reference,['position','uv','normal'],`extrude ${trial}`);done++;
 }
 expect(done).toBe(260);
});
it('cuts polygons into the same triangles as three.js earcut (also past 80 points, with holes)',()=>{
 const r=random(5);
 for(let trial=0;trial<400;trial++){
  const {outer,holes}=polygonCase(r,trial);
  if(outer.length>2&&outer.at(-1)[0]===outer[0][0]&&outer.at(-1)[1]===outer[0][1])outer.pop(); // triangulateShape drops a repeated end point itself
  const data=[...outer.flat()],indices=[];
  for(const hole of holes){indices.push(data.length/2);data.push(...hole.flat());}
  const expected=THREE.ShapeUtils.triangulateShape(outer.map(p=>new THREE.Vector2(...p)),holes.map(h=>h.map(p=>new THREE.Vector2(...p)))).flat();
  expect([...shelf.probe_earcut(Float64Array.from(data),Uint32Array.from(indices))],`earcut ${trial}`).toEqual(expected);
 }
});
function soup(r,triangles){
 const position=new Float32Array(triangles*9),normal=new Float32Array(triangles*9);
 for(let i=0;i<position.length;i++){position[i]=Math.fround((r()-.5)*100);normal[i]=Math.fround(r()*2-1);}
 return{position,normal};
}
it('applies matrices, rotations, quaternions, scaling and vertex normals like BufferGeometry',()=>{
 const r=random(6);
 for(let trial=0;trial<150;trial++){
  const {position,normal}=soup(r,1+Math.floor(r()*30)),make=()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(position.slice(),3));g.setAttribute('normal',new THREE.BufferAttribute(normal.slice(),3));return g;};
  const kind=trial%5,args=[r()*200-100,r()*200-100,r()*200-100,r()*4-2];
  const q=new THREE.Quaternion(args[0],args[1],args[2],args[3]).normalize(),g=make();
  if(kind===0)g.computeVertexNormals();
  else if(kind===1)g.translate(args[0],args[1],args[2]);
  else if(kind===2)g.rotateY(args[3]);
  else if(kind===3)g.applyQuaternion(q);
  else g.scale(args[0]/50,args[1]/50,args[2]/50);
  const input=kind===3?[q.x,q.y,q.z,q.w]:kind===4?[args[0]/50,args[1]/50,args[2]/50]:kind===2?[args[3]]:args;
  const out=shelf.probe_transform(kind,Float64Array.from(input),position,normal),n=position.length;
  expect(bytes(out.subarray(0,n)).equals(bytes(g.attributes.position.array)),`position ${kind}/${trial}`).toBe(true);
  expect(bytes(out.subarray(n)).equals(bytes(g.attributes.normal.array)),`normal ${kind}/${trial}`).toBe(true);
 }
});
