import { expect, it } from 'vitest';
import { analyzePixels, buildMapsFromPixels, composeMaterialMap, drain, heightToNormals, internals,
  MAP_SIZE, normalizeCoverRelief, shadePreview, WORK_SIZE } from '../../src/js/cover-relief.js';

function raster(width=60, height=90, colors=[[192,32,48],[24,88,192],[244,224,160]]) {
  const data = new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...colors[Math.min(colors.length-1,Math.floor(x*colors.length/width))],255],(y*width+x)*4);
  return {width,height,data};
}
const hex = rgb => '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');

it('offers exactly three actual distinct colors instead of detected or invented family zones',()=>{
  const colors=[[192,32,48],[24,88,192],[244,224,160]], image=raster(60,90,colors);
  const found=drain(analyzePixels(image));
  expect(found.chosen.map(c=>c.id)).toEqual(['color-1','color-2','color-3']);
  expect(new Set(found.chosen.map(c=>c.color))).toEqual(new Set(colors.map(hex)));
  expect(found.chosen.every(c=>c.detected&&c.tolerance>=1&&c.tolerance<=6)).toBe(true);
});

it('returns one actual color for a uniform cover without inventing grain, frame or repeated masks',()=>{
  const image=raster(60,90,[[32,48,64]]), found=drain(analyzePixels(image));
  expect(found.chosen).toHaveLength(1);
  expect(found.chosen[0]).toMatchObject({id:'color-1',color:'#203040',detected:true});
  const maps=drain(buildMapsFromPixels(image,image,found.chosen[0],found.seed));
  expect(new Set(maps.heightMap).size).toBe(1);
  expect(maps.foil.every(v=>v===0)).toBe(true);
});

it('returns two distinct colors for a bicolor cover and never repeats the same zones',()=>{
  const image=raster(60,90,[[0,0,0],[255,255,255]]), found=drain(analyzePixels(image));
  expect(found.chosen).toHaveLength(2);
  expect(new Set(found.chosen.map(c=>c.color))).toEqual(new Set(['#000000','#ffffff']));
});

it('preserves portable color/tolerance/strength with a canonical lowercase HEX',()=>{
  expect(normalizeCoverRelief({id:'color-2',color:'#AbC123',tolerance:4.5,strength:.755,pixels:[1]}))
    .toEqual({id:'color-2',color:'#abc123',tolerance:4.5,strength:.76});
});

it('affects only the matching printed color and keeps all three masks disjoint',()=>{
  const image=raster(), found=drain(analyzePixels(image));
  const maps=found.chosen.map(c=>drain(buildMapsFromPixels(image,image,c,found.seed)));
  for(let i=0;i<image.width*image.height;i++) {
    expect(maps.filter(m=>m.heightMap[i]>0||m.gloss[i]>0||m.foil[i]>0)).toHaveLength(1);
    for(let n=0;n<found.chosen.length;n++)if(found.chosen[n].color!==hex([...image.data.slice(i*4,i*4+3)])) {
      expect(maps[n].heightMap[i]).toBe(0); expect(maps[n].gloss[i]).toBe(0); expect(maps[n].foil[i]).toBe(0);
    }
  }
});

it('classifies high-resolution pixels again instead of expanding a thumbnail mask across fine ink',()=>{
  const work=raster(12,18,[[200,32,48]]), hires=raster(60,90,[[200,32,48]]);
  for(let y=0;y<90;y++)hires.data.set([24,88,192,255],(y*60+30)*4);
  const chosen=drain(analyzePixels(work)).chosen[0];
  const maps=drain(buildMapsFromPixels(work,hires,chosen,0));
  for(let y=0;y<90;y++){expect(maps.heightMap[y*60+30]).toBe(0);expect(maps.gloss[y*60+30]).toBe(0);}
  expect(maps.heightMap[45*60+10]).toBeGreaterThan(0);
});

it('does not split small encode variation of one color into three options',()=>{
  const image=raster(60,90,[[60,100,160]]);
  for(let i=0;i<image.data.length;i+=4){const jitter=(i/4)%5-2;image.data[i]+=jitter;image.data[i+1]-=jitter;}
  expect(drain(analyzePixels(image)).chosen).toHaveLength(1);
});

it.each([1,12])('accepts the documented tolerance endpoint %s without changing the color',tolerance=>{
  expect(normalizeCoverRelief({id:'color-1',color:'#000000',tolerance,strength:2}))
    .toEqual({id:'color-1',color:'#000000',tolerance,strength:1});
});

it.each([undefined,null,'6',[],NaN,Infinity,-1,0,.99,12.01])('rejects invalid portable tolerance (%s)',tolerance=>{
  expect(normalizeCoverRelief({id:'color-1',color:'#c02030',tolerance})).toBeNull();
});

it('rejects missing or malformed colors and unknown color slots',()=>{
  for(const color of [undefined,null,123,'red','#fff','#12ff00aa','#zz0000',' #c02030']) {
    expect(normalizeCoverRelief({id:'color-1',color,tolerance:6})).toBeNull();
  }
  expect(normalizeCoverRelief({id:'color-4',color:'#c02030',tolerance:6})).toBeNull();
});

it('uses the published OKLab transform on a scale of 100, including exact black',()=>{
  expect(internals.rgbToOklab(0,0,0)).toEqual([0,0,0]);
  const white=internals.rgbToOklab(255,255,255),red=internals.rgbToOklab(255,0,0);
  expect(white[0]).toBeCloseTo(100,5);expect(white[1]).toBeCloseTo(0,4);expect(white[2]).toBeCloseTo(0,4);
  expect(red[0]).toBeCloseTo(62.795536,5);expect(red[1]).toBeCloseTo(22.486306,5);expect(red[2]).toBeCloseTo(12.584630,5);
});

it('keeps generated color balls below half the center separation and uses real RGB pixels',()=>{
  const image=raster(),chosen=drain(analyzePixels(image)).chosen;
  for(let i=0;i<chosen.length;i++)for(let j=i+1;j<chosen.length;j++) {
    const lab=color=>internals.rgbToOklab(...[1,3,5].map(at=>parseInt(color.slice(at,at+2),16)));
    const a=lab(chosen[i].color),b=lab(chosen[j].color),distance=Math.hypot(...a.map((n,k)=>n-b[k]));
    expect(chosen[i].tolerance+chosen[j].tolerance).toBeLessThan(distance);
    expect(chosen[i].tolerance).toBeLessThanOrEqual(distance*.45);
    expect(chosen[j].tolerance).toBeLessThanOrEqual(distance*.45);
  }
});

it('excludes transparent fitted-board padding from proposals, maps, normals and previews',()=>{
  const image=raster(60,90,[[255,255,255]]);
  for(let i=0;i<60*90;i++)image.data[i*4+3]=0;
  for(let y=10;y<80;y++)for(let x=10;x<50;x++)image.data.set([24,88,192,255],(y*60+x)*4);
  const before=image.data.slice(),chosen=drain(analyzePixels(image)).chosen;
  expect(chosen.map(c=>c.color)).toEqual(['#1858c0']);
  const maps=drain(buildMapsFromPixels(image,image,chosen[0])),normals=drain(heightToNormals(maps)),preview=drain(shadePreview(image,maps));
  for(let i=0;i<60*90;i++)if(!image.data[i*4+3]) {
    expect(maps.mask[i]).toBe(0);expect(maps.gloss[i]).toBe(0);expect(maps.heightMap[i]).toBe(0);
    expect([...normals.slice(i*4,i*4+4)]).toEqual([128,128,255,255]);
    expect([...preview.slice(i*4,i*4+4)]).toEqual([...image.data.slice(i*4,i*4+4)]);
  }
  expect(image.data).toEqual(before);
});

it('returns no color for an entirely transparent cover and renders a legacy record flat',()=>{
  const image=raster();for(let i=3;i<image.data.length;i+=4)image.data[i]=0;
  const found=drain(analyzePixels(image));expect(found.chosen).toEqual([]);expect(found.opaquePixels).toBe(0);
  const maps=drain(buildMapsFromPixels(image,image,{id:'grain',strength:.7}));
  expect(maps.heightMap.every(v=>v===0)).toBe(true);expect(maps.foil.every(v=>v===0)).toBe(true);expect(maps.gloss.every(v=>v===0)).toBe(true);
});

it('never changes excluded fine ink in the preview or slopes its flat normal',()=>{
  const image=raster(60,90,[[200,32,48]]),before=image.data.slice();
  for(let y=0;y<90;y++)image.data.set([0,0,0,255],(y*60+30)*4);
  const maps=drain(buildMapsFromPixels(image,image,{id:'color-1',color:'#c82030',tolerance:6,strength:.75}));
  const normals=drain(heightToNormals(maps)),preview=drain(shadePreview(image,maps));
  for(let y=0;y<90;y++) {
    const at=(y*60+30)*4;
    expect([...normals.slice(at,at+4)]).toEqual([128,128,255,255]);
    expect([...preview.slice(at,at+4)]).toEqual([0,0,0,255]);
  }
  expect(maps.heightMap[45*60+29]).toBeLessThan(maps.heightMap[45*60+10]);
  // The effect consumes a separate map, never mutates printed RGBA.
  for(let y=0;y<90;y++)before.set([0,0,0,255],(y*60+30)*4);
  expect(image.data).toEqual(before);
});

it('does not recenter a persisted color when it is absent from a new map source',()=>{
  const image=raster(60,90,[[24,88,192]]);
  const maps=drain(buildMapsFromPixels(image,image,{id:'color-1',color:'#c82030',tolerance:6,strength:.75}));
  expect(maps.color).toBe('#c82030');expect(maps.mask.every(v=>v===0)).toBe(true);
  expect(maps.heightMap.every(v=>v===0)).toBe(true);expect(maps.gloss.every(v=>v===0)).toBe(true);
});

it('leaves strength to renderer uniforms rather than regenerating a different mask',()=>{
  const image=raster(),choice=drain(analyzePixels(image)).chosen[0];
  const a=drain(buildMapsFromPixels(image,image,{...choice,strength:.1})),b=drain(buildMapsFromPixels(image,image,{...choice,strength:.9}));
  expect(a).toEqual(b);
});

it('renders legacy selections as the stable first actual color without rewriting the record',()=>{
  const image=raster(),record={id:'frame',strength:.55},before={...record};
  const chosen=drain(analyzePixels(image)).chosen[0],colorMaps=drain(buildMapsFromPixels(image,image,chosen));
  expect(drain(buildMapsFromPixels(image,image,record))).toEqual(colorMaps);
  expect(drain(buildMapsFromPixels(image,image,{id:'grain',strength:.2}))).toEqual(colorMaps);
  expect(record).toEqual(before);
});

it('keeps metalness zero and controls clearcoat roughness separately inside color masks',()=>{
  const maps={width:2,height:1,preserveInk:true,foil:new Uint8Array([255,255]),gloss:new Uint8Array([0,255])};
  const packed=drain(composeMaterialMap(maps,{clearcoat:.2,roughness:.8,clearcoatRoughness:.4}));
  expect([...packed.slice(0,4)]).toEqual([51,255,0,255]);
  expect([...packed.slice(4,8)]).toEqual([255,16,0,32]);
});

it('uses simple color labels without technical HEX or delta-E wording',()=>{
  expect(internals.colorName('#ffffff')).toBe('Blanco');expect(internals.colorName('#000000')).toBe('Negro');
  expect(internals.colorName('#1858c0')).toMatch(/^Azul/);expect(internals.colorName('#c02030')).toMatch(/^Rojo/);
  expect(internals.colorName('#f4e0a0')).toMatch(/^(Crema|Amarillo)/);
});

it('yields while finding colors and creating maps at the bounded working sizes',()=>{
  const image=raster(WORK_SIZE,WORK_SIZE),task=analyzePixels(image);let yields=0,step;
  do{step=task.next();if(!step.done)yields++;}while(!step.done);
  expect(yields).toBeGreaterThan(100);expect(step.value.chosen).toHaveLength(3);
  const hires=raster(MAP_SIZE,MAP_SIZE),build=buildMapsFromPixels(image,hires,step.value.chosen[0]);let mapYields=0;
  do{step=build.next();if(!step.done)mapYields++;}while(!step.done);
  expect(mapYields).toBeGreaterThan(400);expect(step.value.width).toBe(512);expect(step.value.height).toBe(512);
});

it('rejects malformed raster data without interpreting missing pixels as colors',()=>{
  for(const image of [{width:0,height:1,data:new Uint8Array(0)},{width:1.5,height:2,data:new Uint8Array(12)},{width:1,height:1,data:new Uint8Array(3)}]) {
    expect(()=>drain(analyzePixels(image))).toThrow(/RGBA/);
  }
});

it('selects the flat printed modes instead of rare antialias colors borrowing their support',()=>{
  const palette=[[35,80,181],[212,169,60],[255,250,240]],image=raster(60,90,palette);
  // Subpixel circle edges contain each mixture only a handful of times. These
  // two ramps reproduce the real canvas AA failure without a browser/font.
  for(let edge=0;edge<2;edge++)for(let step=1;step<255;step++) {
    const rgb=palette[0].map((byte,c)=>Math.round(byte+(palette[edge+1][c]-byte)*step/255));
    image.data.set([...rgb,255],(edge*255+step)*4);
  }
  const found=drain(analyzePixels(image));
  expect(new Set(found.chosen.map(c=>c.color))).toEqual(new Set(palette.map(hex)));
  for(const choice of found.chosen) {
    let exact=0;for(let at=0;at<image.data.length;at+=4)if(hex([...image.data.slice(at,at+3)])===choice.color)exact++;
    expect(exact).toBeGreaterThan(1500);
  }
});

it('chooses the exact RGB mode within a histogram bin rather than a single pixel near its center',()=>{
  const image=raster(60,90,[[32,80,176]]);
  // Both values belong to the same RGB5 bin. The rare one is nearer its center.
  image.data.set([35,83,179,255],0);
  expect(drain(analyzePixels(image)).chosen.map(c=>c.color)).toEqual(['#2050b0']);
});

it('breaks exact RGB frequency ties deterministically regardless of scan order',()=>{
  const a=raster(60,90,[[32,80,176],[35,83,179]]),b=raster(60,90,[[35,83,179],[32,80,176]]);
  expect(drain(analyzePixels(a)).chosen.map(c=>c.color)).toEqual(drain(analyzePixels(b)).chosen.map(c=>c.color));
});

it('covers a one-pixel printed stroke with varnish even when its height is beveled',()=>{
  const image=raster(60,90,[[255,255,255]]),before=image.data.slice();
  for(let y=5;y<85;y++) {
    image.data.set([85,85,85,255],(y*60+30)*4);
    // A wider region of the same pigment is a physical-height reference.
    for(let x=8;x<18;x++)image.data.set([85,85,85,255],(y*60+x)*4);
  }
  const maps=drain(buildMapsFromPixels(image,image,{id:'color-1',color:'#555555',tolerance:6,strength:.75}));
  const thin=45*60+30,wide=45*60+12;
  expect(maps.gloss[thin]).toBe(255);expect(maps.mask[thin]).toBe(255);
  expect(maps.gloss[thin]).toBe(maps.gloss[wide]);
  expect(maps.heightMap[thin]).toBeGreaterThan(0);expect(maps.heightMap[thin]).toBeLessThan(maps.heightMap[wide]);
  expect(maps.heightMap[wide]).toBe(128);
  expect(maps.gloss[thin-1]).toBe(0);expect(maps.heightMap[thin-1]).toBe(0);
  for(let y=5;y<85;y++) {
    before.set([85,85,85,255],(y*60+30)*4);
    for(let x=8;x<18;x++)before.set([85,85,85,255],(y*60+x)*4);
  }
  expect(image.data).toEqual(before);
});

it('feathers varnish by color membership independently of geometric height and never extends outside the radius',()=>{
  const image=raster(60,90,[[255,255,255]]);
  for(let y=5;y<85;y++) {
    image.data.set([85,85,85,255],(y*60+30)*4);
    image.data.set([98,98,98,255],(y*60+29)*4);
    image.data.set([110,110,110,255],(y*60+28)*4);
  }
  const original=image.data.slice(),membership=drain(internals.colorMask(image,'#555555',6));
  const maps=drain(buildMapsFromPixels(image,image,{id:'color-1',color:'#555555',tolerance:6,strength:.75}));
  const inside=45*60+30,feather=inside-1,outside=inside-2;
  expect(membership[feather]).toBeGreaterThan(0);expect(membership[feather]).toBeLessThan(1);
  expect(maps.mask[feather]).toBe(Math.round(membership[feather]*255));
  expect(maps.gloss[feather]).toBe(maps.mask[feather]);
  expect(maps.gloss[inside]).toBe(255);
  expect(membership[outside]).toBe(0);expect(maps.mask[outside]).toBe(0);
  expect(maps.gloss[outside]).toBe(0);expect(maps.heightMap[outside]).toBe(0);expect(maps.foil[outside]).toBe(0);
  const normal=drain(heightToNormals(maps)),preview=drain(shadePreview(image,maps));
  expect([...normal.slice(outside*4,outside*4+4)]).toEqual([128,128,255,255]);
  expect([...preview.slice(outside*4,outside*4+4)]).toEqual([110,110,110,255]);
  expect(image.data).toEqual(original);
});
