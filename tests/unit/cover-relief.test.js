import { afterEach, expect, it, vi } from 'vitest';
import { analyzeCoverRelief, analyzePixels, buildMapsFromPixels, composeMaterialMap, drain,
  fitDimensions, heightToNormals, internals, MAX_RELIEF_MM, normalizeCoverRelief, seedOf } from '../../src/js/cover-relief.js';

const image = (width=64,height=96,color=[240,240,240]) => {
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4) data.set([...color,255],i);
  return {width,height,data};
};
afterEach(()=>vi.restoreAllMocks());

it('validates portable choices without persisting maps or touching old records',()=>{
  expect(normalizeCoverRelief({id:'foil',strength:.755,pixels:'discard'})).toEqual({id:'foil',strength:.76});
  expect(normalizeCoverRelief({id:'foil',strength:-2})).toEqual({id:'foil',strength:0});
  expect(normalizeCoverRelief({id:'grain',strength:NaN})).toEqual({id:'grain',strength:.75});
  expect(normalizeCoverRelief({id:'unknown'})).toBeNull();
  expect(normalizeCoverRelief(null)).toBeNull();
});
it.each([[600,900],[900,600],[20,30]])('bounds portrait, landscape and tiny rasters (%s × %s)',(w,h)=>{
  const size=fitDimensions(w,h,512);
  expect(Math.max(size.width,size.height)).toBeLessThanOrEqual(512);
  expect(size.width/size.height).toBeCloseTo(w/h,2);
  expect(size.width).toBeLessThanOrEqual(w);
});
it('returns one deterministic real color for an image with no printed features',()=>{
  const raster=image(),a=drain(analyzePixels(raster)),b=drain(analyzePixels(raster));
  expect(a.chosen.map(x=>x.id)).toEqual(b.chosen.map(x=>x.id));
  expect(a.chosen).toHaveLength(1);
  expect(a.chosen[0]).toMatchObject({id:'color-1',color:'#f0f0f0',detected:true});
  expect(a.chosen.map(x=>x.confidence)).toEqual([...a.chosen.map(x=>x.confidence)].sort((a,b)=>b-a));
  expect(seedOf(raster)).toBe(seedOf(raster));
  expect(seedOf(image(64,96,[20,30,40]))).not.toBe(seedOf(raster));
});
it('detects actual gold-coloured pixels without painting metal onto the surrounding background',()=>{
  const raster=image(64,96,[20,35,30]);
  for(let y=20;y<50;y++)for(let x=18;x<38;x++)raster.data.set([212,169,60,255],(y*64+x)*4);
  const {mask}=drain(internals.metalMask(raster));
  expect(mask[30*64+30]).toBe(1);
  expect(mask[0]).toBe(0);
  expect(mask.reduce((n,v)=>n+v,0)).toBeGreaterThan(500);
});
it('builds a deterministic flat single-color zone with bounded physical height and no invented foil',()=>{
  const raster=image(),found=drain(analyzePixels(raster)),choice=found.chosen[0];
  const a=drain(buildMapsFromPixels(raster,raster,choice,found.seed));
  const b=drain(buildMapsFromPixels(raster,raster,choice,found.seed));
  expect(a.heightMap).toEqual(b.heightMap);
  expect(new Set(a.heightMap).size).toBe(1);
  expect(Math.max(...a.heightMap)/255*MAX_RELIEF_MM).toBeLessThanOrEqual(.303);
  expect(a.foil.every(x=>x===0)).toBe(true);
});
it('keeps a flat height map neutral and produces unit normals at an actual height edge',()=>{
  const flat={width:64,height:64,heightMap:new Uint8Array(4096)};
  const zero=drain(heightToNormals(flat));
  expect([...zero.slice(0,4)]).toEqual([128,128,255,255]);
  flat.heightMap.fill(200,2048);
  const edge=drain(heightToNormals(flat));
  expect(edge).not.toEqual(zero);
  for(let i=0;i<edge.length;i+=4)expect(Math.hypot(...[0,1,2].map(c=>edge[i+c]/255*2-1))).toBeCloseTo(1,2);
});
it('packs metal and gloss only where detected, with sharp spot varnish on matte stock',()=>{
  const maps={width:3,height:1,foil:new Uint8Array([0,255,0]),gloss:new Uint8Array([0,0,255])};
  const rgba=drain(composeMaterialMap(maps,{clearcoat:0,roughness:.94}));
  expect([...rgba.slice(0,4)]).toEqual([0,255,0,255]);
  expect(rgba[6]).toBe(255); // only the foil pixel is metallic
  expect(rgba[8]).toBe(255); expect(rgba[10]).toBe(0); // varnish is clear, not metal
  expect(rgba[9]).toBeLessThan(40); // a polished local finish, not matte roughness
});
it('does no raster work for an already cancelled request',async()=>{
  const signal=AbortSignal.abort(),create=vi.spyOn(document,'createElement');
  await expect(analyzeCoverRelief(null,{signal})).rejects.toMatchObject({name:'AbortError'});
  expect(create).not.toHaveBeenCalled();
});

it('preserves a thin printed frame when light and dark stroke edges touch',()=>{
  const width=64,height=96,count=width*height,light=new Uint8Array(count),shade=new Uint8Array(count).fill(1);
  for(let y=5;y<91;y++)for(let x=5;x<59;x++)if(x===5||x===58||y===5||y===90){light[y*width+x]=1;shade[y*width+x]=0;}
  const feats={strokes:new Uint8Array(count).fill(1),light,shade};
  const mask=drain(internals.recipeMask({width,height},{kind:'frame',inset:5/64,half:2/64},feats));
  expect(mask[40*width+5]).toBe(1);
  expect(mask[40*width+30]).toBe(0);
  expect(mask.reduce((n,v)=>n+v,0)).toBeGreaterThan(200);
});
