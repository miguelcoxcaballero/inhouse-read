// @vitest-environment node
// Lathes, tori, Catmull-Rom curves (arc-length parametrisation, Frenet frames) and tubes swept along them, and the
// quaternion and rotation-matrix arithmetic they need, from the Rust shelf module against three.js itself on large
// pseudo-random corpora: every attribute byte, the index type, the order of attributes, and every number.
import * as THREE from 'three';
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
 expect(actual.index,label+' index').not.toBeNull();
 expect(actual.index.constructor,label+' index type').toBe(geometry.index.array.constructor);
 expect(bytes(actual.index).equals(bytes(geometry.index.array)),label+' index bytes').toBe(true);
}
function sameNumbers(actual,expected,label){
 expect(actual.length,label+' length').toBe(expected.length);
 for(let i=0;i<expected.length;i++)if(!Object.is(actual[i],expected[i]))throw Error(`${label}[${i}] ${actual[i]} / ${expected[i]}`);
}
const flat=vectors=>vectors.flatMap(v=>[v.x,v.y,v.z]);
function profile(r,count){
 const points=[];let radius=r()*40+1;
 for(let i=0;i<count;i++){
  radius=Math.max(0,radius+(r()-.5)*30);
  points.push([i%9===8?0:radius,i*(r()*12+.5)+(r()-.5)*20]);
  if(i%11===5)points.push(points[points.length-1].slice()); // a repeated point: a zero-length segment
  if(i%13===7)points.push([points[points.length-1][0],points[points.length-1][1]+(r()-.5)*8]); // a vertical wall
 }
 return points;
}
function path(r,count,kind){
 const points=[];
 for(let i=0;i<count;i++){
  const x=kind===0?i*10:(r()-.5)*200,y=kind===1?i*4:(r()-.5)*200,z=kind===2?0:(r()-.5)*200;
  points.push([x,y,z]);
  if(kind===3&&i%2===1)points.push(points[points.length-1].slice()); // repeated points: the 1e-4 safety checks
  if(kind===4&&i%3===2)points.push([points[points.length-1][0]+1e-6,points[points.length-1][1],points[points.length-1][2]]);
 }
 return points;
}
const vectors=points=>points.map(p=>new THREE.Vector3(...p));

it('lathes profiles like LatheGeometry, with its normals (the last point keeps the raw previous normal)',()=>{
 const r=random(11);
 for(let trial=0;trial<300;trial++){
  const points=profile(r,2+Math.floor(r()*18)),segments=1+Math.floor(r()*(trial%10===0?120:48));
  const reference=new THREE.LatheGeometry(points.map(([x,y])=>new THREE.Vector2(x,y)),segments);
  expectSame(shelf.probe_geometry('lathe',[segments,points.length,...points.flat()]),reference,['position','uv','normal'],`lathe ${trial}`);
 }
 const production=[[[0,0],[30.5,0],[32.8,-.6],[34,-2],[34,-8],[33.2,-10.3],[31.8,-11],[28.4,-11],[27.5,-10.1],[27.5,-8.8],[29.2,-8.8],[30,-1.8],[0,-1.8]],
  [[88.6,175],[90,175],[90,177],[88.6,177],[88.6,175]],[[0,195],[7,195],[7,201],[13,205],[19,215],[21,227],[17,239],[9,246],[0,249]]];
 for(const points of production)for(const segments of [32,40,48,72])
  expectSame(shelf.probe_geometry('lathe',[segments,points.length,...points.flat()]),new THREE.LatheGeometry(points.map(([x,y])=>new THREE.Vector2(x,y)),segments),['position','uv','normal'],`production lathe ${segments}`);
});
it('draws tori like TorusGeometry',()=>{
 const r=random(12);
 for(let trial=0;trial<250;trial++){
  const p=[r()*100+.01,r()*(trial%5?4:60)+.001,3+Math.floor(r()*12),3+Math.floor(r()*90)];
  expectSame(shelf.probe_geometry('torus',p),new THREE.TorusGeometry(...p),['position','normal','uv'],`torus ${p}`);
 }
 for(const p of [[7.85,.6,6,48],[28.7,.9,6,72],[28.7,.9,6,40],[87.8,.9,6,72],[87.8,.9,6,40]])
  expectSame(shelf.probe_geometry('torus',p),new THREE.TorusGeometry(...p),['position','normal','uv'],`production torus ${p}`);
});
it('evaluates CatmullRomCurve3 points, tangents and arc-length mappings exactly',()=>{
 const r=random(13);
 for(let trial=0;trial<200;trial++){
  const points=path(r,2+Math.floor(r()*7),trial%5),curve=new THREE.CatmullRomCurve3(vectors(points));
  const parameters=[0,1,.5,1e-9,1-1e-9,...Array.from({length:30},()=>r())];
  const flatPoints=points.flat();
  sameNumbers(shelf.probe_curve('point',flatPoints,parameters),flat(parameters.map(t=>curve.getPoint(t))),`point ${trial}`);
  sameNumbers(shelf.probe_curve('u_to_t',flatPoints,parameters),parameters.map(u=>curve.getUtoTmapping(u)),`u_to_t ${trial}`);
  sameNumbers(shelf.probe_curve('point_at',flatPoints,parameters),flat(parameters.map(u=>curve.getPointAt(u))),`point_at ${trial}`);
  sameNumbers(shelf.probe_curve('tangent',flatPoints,parameters),flat(parameters.map(t=>curve.getTangent(t))),`tangent ${trial}`);
  sameNumbers(shelf.probe_curve('tangent_at',flatPoints,parameters),flat(parameters.map(u=>curve.getTangentAt(u))),`tangent_at ${trial}`);
 }
});
it('computes Frenet frames like Curve#computeFrenetFrames, including straight and repeated-point paths',()=>{
 const r=random(14);
 for(let trial=0;trial<200;trial++){
  const points=path(r,2+Math.floor(r()*7),trial%5),segments=1+Math.floor(r()*40),curve=new THREE.CatmullRomCurve3(vectors(points));
  const frames=curve.computeFrenetFrames(segments,false),expected=[];
  for(let i=0;i<=segments;i++)expected.push(frames.tangents[i],frames.normals[i],frames.binormals[i]);
  sameNumbers(shelf.probe_curve('frames',points.flat(),[segments]),flat(expected),`frames ${trial}`);
 }
});
it('sweeps tubes like TubeGeometry (positions, normals, uvs and index, bit for bit)',()=>{
 const r=random(15);
 for(let trial=0;trial<300;trial++){
  const points=path(r,2+Math.floor(r()*7),trial%5),tubular=1+Math.floor(r()*(trial%10===0?60:30)),radial=3+Math.floor(r()*10),radius=r()*(trial%4?5:40)+.001;
  const reference=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vectors(points)),tubular,radius,radial,false);
  expectSame(shelf.probe_geometry('tube',[tubular,radius,radial,points.length,...points.flat()]),reference,['position','normal','uv'],`tube ${trial}`);
 }
 const production=[[[0,-2,-30],[0,-2,-33],[0,-1.5,-33.2]],[[0,10,-68],[0,7,-71],[5,3,-73],[12,1.8,-73.1],[20,1.8,-71]],
  [[0,170,0],[0,150,-6],[8,91,-27],[13,56,-37],[15,34,-48],[21,13,-55],[32,1.4,-53],[44,1.4,-45]],[[0,193,0],[40,185,0],[87,177,0]]];
 for(const points of production)for(const [tubular,radius,radial] of [[8,.6,6],[24,1.4,6],[48,1.1,6],[12,.55,4],[16,.3,4]])
  expectSame(shelf.probe_geometry('tube',[tubular,radius,radial,points.length,...points.flat()]),new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vectors(points)),tubular,radius,radial,false),['position','normal','uv'],`production tube ${tubular}`);
});
it('keeps the two-point Catmull-Rom curve quirk (both ends reflect through one shared scratch vector)',()=>{
 const points=[[0,0,0],[10,20,30]],curve=new THREE.CatmullRomCurve3(vectors(points)),parameters=[0,.1,.5,.9,1];
 sameNumbers(shelf.probe_curve('point',points.flat(),parameters),flat(parameters.map(t=>curve.getPoint(t))),'two points');
 const bent=[[3,-2,9],[-4,7,1]],other=new THREE.CatmullRomCurve3(vectors(bent));
 sameNumbers(shelf.probe_curve('point',bent.flat(),parameters),flat(parameters.map(t=>other.getPoint(t))),'two bent points');
});
it('multiplies quaternions and builds rotations like three',()=>{
 const r=random(16),angle=()=>(r()-.5)*(r()<.2?100:14);
 for(let trial=0;trial<400;trial++){
  const [x,y,z]=[angle(),angle(),angle()];
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z));
  sameNumbers(shelf.probe_quaternion('euler',[x,y,z]),[q.x,q.y,q.z,q.w],`euler ${trial}`);
  const axis=new THREE.Vector3(r()-.5,r()-.5,r()-.5).normalize(),theta=angle();
  const turned=new THREE.Quaternion().setFromAxisAngle(axis,theta);
  sameNumbers(shelf.probe_quaternion('axis_angle',[axis.x,axis.y,axis.z,theta]),[turned.x,turned.y,turned.z,turned.w],`axis angle ${trial}`);
  const product=q.clone().multiply(turned);
  sameNumbers(shelf.probe_quaternion('multiply',[q.x,q.y,q.z,q.w,turned.x,turned.y,turned.z,turned.w]),[product.x,product.y,product.z,product.w],`multiply ${trial}`);
  sameNumbers(shelf.probe_quaternion('rotation_axis',[axis.x,axis.y,axis.z,theta]),new THREE.Matrix4().makeRotationAxis(axis,theta).elements,`rotation ${trial}`);
 }
 for(const [x,y,z] of [[0,0,0],[Math.PI/2,0,0],[0,0,Math.PI/8],[0,0,0.3]])
  sameNumbers(shelf.probe_quaternion('euler',[x,y,z]),(q=>[q.x,q.y,q.z,q.w])(new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z))),`euler ${x}/${y}/${z}`);
});
