// @vitest-environment node
// The generators a plant is made of, each on its own, from the Rust shelf module against the frozen three.js original: the
// leaf blades of every variety, the ivy and Monstera leaves, the cactus column, the pot (every model, any size) and the
// midpoint subdivision of a surface. The corpora are those of the kernel tests of the decor core that these generators
// replace (they ran the same cases through the core's pointer interface); the whole plants are in plant-model-wasm.test.js.
import * as THREE from 'three';
import {expect,it} from 'vitest';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import {readGeometry,readPacket} from './helpers/geo-packet.js';
import {referencePlantLeafGeometry,referencePlantRandom} from './helpers/reference-shelf-plants.js';
import {cactusGeometry} from './helpers/reference-plant-cactus.js';
import {ivyLeafGeometry} from './helpers/reference-plant-ivy.js';
import {monsteraLeafGeometry} from './helpers/reference-plant-monstera.js';
import {potGeometry} from './helpers/reference-plant-pot.js';
import {subdivideSurface} from './helpers/reference-plant-subdivide.js';
import {plantLeafCases} from '../helpers/plant-leaf-cases.mjs';
const shelf=needRustShelf();
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function exact(packet,expected,label){
 const {header}=readPacket(packet),actual=readGeometry(packet);
 expect(header.type,`${label} type`).toBe(expected.type);
 expect(Object.keys(actual.attributes),`${label} attribute order`).toEqual(Object.keys(expected.attributes));
 for(const name of Object.keys(expected.attributes)){
  const a=actual.attributes[name],b=expected.attributes[name];
  expect(a.itemSize,`${label} ${name}`).toBe(b.itemSize);expect(a.array.length,`${label} ${name} length`).toBe(b.array.length);
  if(!bytes(a.array).equals(bytes(b.array))){for(let i=0;i<b.array.length;i++)if(!Object.is(a.array[i],b.array[i]))throw Error(`${label} ${name}[${i}] ${a.array[i]} / ${b.array[i]}`);}
 }
 if(expected.index){
  expect(actual.index,`${label} index`).not.toBeNull();expect(actual.index.constructor,`${label} index type`).toBe(expected.index.array.constructor);
  expect(bytes(actual.index).equals(bytes(expected.index.array)),`${label} index bytes`).toBe(true);
 }else expect(actual.index,`${label} no index`).toBeNull();
 expect(expected.groups,label).toEqual([]);
 return header;
}
const sampler=values=>{let at=0;return()=>values[at++];};

// leaf blades
const leaf=(input,label)=>{
 const samples=[input.tint/.08,input.hue/.1+.5];
 const expected=referencePlantLeafGeometry({...input,random:sampler(samples)});
 try{exact(shelf.probe_plant_part('leaf',input.variant,Float64Array.of(input.length,input.width,input.curve,input.twist,input.detailed?1:0),Float64Array.from(samples)),expected,label);}finally{expected.dispose();}
};
for(const input of plantLeafCases)it(`keeps ${input.name} positions, normals, colors, UV and topology byte exact`,()=>leaf(input,input.name));
it('preserves detailed and simple surfaces, neutral twist and tiny/larger dimensions',()=>{
 for(const input of plantLeafCases)for(const detailed of [false,true])for(const scale of [.00001,1,337.123])
  leaf({...input,length:input.length*scale,width:input.width*scale,twist:-0,curve:0,detailed},`${input.name} ${detailed} ${scale}`);
});
it('matches a deterministic parameter corpus without losing f32 storage or normal accumulation order',()=>{
 const random=referencePlantRandom('rust:leaves:random');
 for(let n=0;n<256;n++)leaf({...plantLeafCases[n%plantLeafCases.length],length:.01+random()*600,width:.001+random()*80,twist:(random()-.5)*2,curve:(random()-.2)*.8,
  tint:random()*.08,hue:(random()-.5)*.1,detailed:n%3!==0},`corpus ${n}`);
});
it('draws every variety with the sample numbers it is given, whatever they are',()=>{
 const random=referencePlantRandom('rust:leaves:samples');
 for(const input of plantLeafCases)for(const samples of [[0,0],[.999999,.999999],[random(),random()],[.5,.5]]){
  const expected=referencePlantLeafGeometry({...input,random:sampler(samples)});
  try{exact(shelf.probe_plant_part('leaf',input.variant,Float64Array.of(input.length,input.width,input.curve,input.twist,input.detailed?1:0),Float64Array.from(samples)),expected,`${input.name} ${samples}`);}finally{expected.dispose();}
 }
});

// ivy
const ivy=(length,width,curve,samples,label)=>{
 const expected=ivyLeafGeometry(length,width,curve,sampler(samples));
 try{exact(shelf.probe_plant_part('ivy','',Float64Array.of(length,width,curve),Float64Array.from(samples)),expected,label);}finally{expected.dispose();}
};
for(const length of [.00001,10,128.375,9812])for(const curve of [-.5,-0,0,.75])it(`ivy attributes exact ${length}/${Object.is(curve,-0)?'-0':curve}`,()=>{
 const random=referencePlantRandom('ivy-f32/'+length+'/'+curve);ivy(length,length*.29,curve,[random(),random(),random()],`ivy ${length}/${curve}`);
});
it('keeps a seeded ivy corpus exact',()=>{
 const random=referencePlantRandom('ivy-corpus');
 for(let n=0;n<100;n++)ivy(.01+random()*800,.001+random()*60,(random()-.5)*.8,[random(),random(),random()],`ivy corpus ${n}`);
});

// cactus
const cactus=(length,radius,bend,samples,label)=>{
 const expected=cactusGeometry(length,radius,bend,sampler(samples));
 try{exact(shelf.probe_plant_part('cactus','',Float64Array.of(length,radius,bend),Float64Array.from(samples)),expected,label);}finally{expected.dispose();}
};
for(const length of [.00001,10,128.375,9812])for(const bend of [-71.4,-0,0,25.1])it(`cactus attributes exact: ${length}/${Object.is(bend,-0)?'-0':bend}`,()=>{
 const random=referencePlantRandom('cactus-f32/'+length+'/'+bend);cactus(length,length*.092,bend,Array.from({length:627},random),`cactus ${length}/${bend}`);
});
it('keeps a seeded cactus corpus exact',()=>{
 const random=referencePlantRandom('cactus-corpus');
 for(let n=0;n<64;n++)cactus(.01+random()*800,.001+random()*60,(random()-.5)*80,Array.from({length:627},random),`cactus corpus ${n}`);
 cactus(150,12,-20,new Array(627).fill(.5),'cactus flat samples');
});

// Monstera
const monstera=(length,width,curve,samples,label)=>{
 const expected=monsteraLeafGeometry(length,width,curve,sampler(samples));
 try{const header=exact(shelf.probe_plant_part('monstera','',Float64Array.of(length,width,curve),Float64Array.from(samples)),expected,label);
  expect(header.fenestrations,label).toBe(expected.userData.fenestrations===4);}finally{expected.dispose();}
};
for(const length of [.00001,10,128.375,9812])for(const curve of [-.5,-0,0,.75])it(`monstera attributes exact ${length}/${Object.is(curve,-0)?'-0':curve}`,()=>{
 const random=referencePlantRandom('monstera-f32/'+length+'/'+curve);monstera(length,length*.29,curve,[random(),random(),random()],`monstera ${length}/${curve}`);
});
it('keeps a seeded Monstera corpus exact',()=>{
 const random=referencePlantRandom('monstera-corpus');
 for(let n=0;n<32;n++)monstera(.01+random()*800,.001+random()*60,(random()-.5)*.8,[random(),random(),random()],`monstera corpus ${n}`);
});

// pots
for(const pot of ['muskot','gradvis','akerbar','terracotta','unknown'])for(const [r,h,soil] of [[.01,.013,.84],[12,15,.84],[57.3,81.9,.77],[1200,980,.93]])it(`pot exact ${pot}/${r}/${h}/${soil}`,()=>{
 const ref=potGeometry(pot,r,h,soil),packet=shelf.probe_plant_part('pot',pot,Float64Array.of(r,h,soil),new Float64Array());
 try{const header=exact(packet,ref.geometry,`pot ${pot}`);expect(header.soilRadius).toBe(ref.soilRadius);expect(header.radius).toBe(ref.radius);}finally{ref.geometry.dispose();}
});

// midpoint subdivision
const subdivision=(source,label)=>{
 const positions=Float32Array.from(source.attributes.position.array),index=Uint32Array.from(source.index.array),ref=source.clone();
 try{
  subdivideSurface(ref);
  const actual=readGeometry(shelf.probe_subdivide(positions,index));
  expect(bytes(actual.attributes.position.array).equals(bytes(ref.attributes.position.array)),`${label} positions`).toBe(true);
  expect(actual.index.constructor,`${label} index type`).toBe(ref.index.array.constructor);expect(bytes(actual.index).equals(bytes(ref.index.array)),`${label} index`).toBe(true);
 }finally{ref.dispose();source.dispose();}
};
const triangle=(positions,indices)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);return g;};
for(const size of [1,2,6,16,48])it(`subdivision exact for ${size}x${size} faces`,()=>subdivision(new THREE.PlaneGeometry(10.37,19.27,size,size),`plane ${size}`));
it('keeps shared and degenerate edge insertion order and signed zeros',()=>subdivision(triangle([-0,0,-0,1.3,-2,3,4,5.1,6,-8,2.7,1],[0,1,2,2,1,3,0,0,1,3,2,1]),'degenerate'));
it('keeps curved holed shape vertices identical',()=>{
 const shape=new THREE.Shape();shape.moveTo(0,0);shape.bezierCurveTo(-4,1,-4,8,0,10);shape.quadraticCurveTo(8,6,0,0);
 const hole=new THREE.Path();hole.absellipse(0,5,1,2,0,Math.PI*2,true,.3);shape.holes.push(hole);
 for(const segments of [2,5,12,32])subdivision(new THREE.ShapeGeometry(shape,segments),`shape ${segments}`);
});
