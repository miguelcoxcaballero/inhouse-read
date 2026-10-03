import { describe, expect, it } from 'vitest';
import { analyzePixels, buildMapsFromPixels, colorReliefProfile, composeMaterialMap,
  composeReliefLayerPixels, coverReliefLayers, drain, heightToNormals, normalizeCoverRelief } from '../../src/js/cover-relief.js';
import { spineCustomization } from '../../src/js/book-colors.js';

const colors=['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#ff8000','#646464'];
const choice=(index,strength=.75)=>({id:`color-${index+1}`,color:colors[index],tolerance:4,strength});
function stripes(palette=colors,width=160,height=80) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const color=palette[Math.floor(x/width*palette.length)];
    data.set([1,3,5].map(at=>parseInt(color.slice(at,at+2),16)).concat(255),(y*width+x)*4);
  }
  return {width,height,data};
}
const select=(...layers)=>({layers});
const build=(image,selection)=>drain(buildMapsFromPixels(image,image,selection));
const normals=maps=>drain(heightToNormals(maps));
const material=maps=>drain(composeMaterialMap(maps,{clearcoat:.35,roughness:.48,clearcoatRoughness:.28}));
const rgbAt=(image,i)=>'#'+[...image.data.slice(i*4,i*4+3)].map(byte=>byte.toString(16).padStart(2,'0')).join('');

describe('portable multicolour relief',()=>{
  it('keeps single colour and legacy family records unchanged and independent of input objects',()=>{
    const single=choice(0),legacy={id:'frame',strength:.55};
    expect(normalizeCoverRelief(single)).toEqual(single);expect(normalizeCoverRelief(legacy)).toEqual(legacy);
    expect(normalizeCoverRelief(single)).not.toBe(single);
    expect(coverReliefLayers(legacy)).toEqual([]);expect(coverReliefLayers(single)).toEqual([single]);
  });
  it('validates, deduplicates and bounds layers while discarding decoded map data',()=>{
    const raw=select({...choice(0),mask:new Uint8Array([1])},choice(0),choice(1),{...choice(2),color:'red'},...colors.slice(3).map((_c,i)=>choice(i+3)));
    const result=normalizeCoverRelief(raw);
    expect(result.layers).toHaveLength(8);
    expect(new Set(result.layers.map(layer=>layer.id)).size).toBe(8);
    expect(result.layers.every(layer=>Object.keys(layer).sort().join(',')==='color,id,strength,tolerance')).toBe(true);
    expect(normalizeCoverRelief(select(...colors.map((_color,index)=>choice(index)),choice(0)))).toEqual(select(...colors.map((_color,index)=>choice(index))));
    expect(raw.layers[0].mask).toBeInstanceOf(Uint8Array);
  });
  it('rejects empty, nested and legacy-only collections without recursively interpreting them',()=>{
    for(const value of [select(),select({id:'grain',strength:.7}),select(select(choice(0))),{layers:[null,{},[]]}]) expect(normalizeCoverRelief(value)).toBeNull();
    const cyclic={layers:[]};cyclic.layers.push(cyclic);expect(normalizeCoverRelief(cyclic)).toBeNull();
  });
  it('returns fresh colour-only layers and round-trips the portable profile through book persistence sanitization',()=>{
    const selection=select({...choice(2),strength:.2},{...choice(4),strength:.8});
    const saved=spineCustomization({coverRelief:selection});
    expect(JSON.parse(JSON.stringify(saved))).toEqual({coverRelief:selection});
    const fresh=coverReliefLayers(saved.coverRelief);fresh[0].strength=1;
    expect(saved.coverRelief.layers[0].strength).toBe(.2);
  });
  it('retains a restored colour and a different newly selected colour even when their proposal slots match',()=>{
    const gold={id:'color-1',color:'#d4a93c',tolerance:4,strength:.4};
    const blue={id:'color-1',color:'#2350b5',tolerance:4,strength:.8};
    expect(normalizeCoverRelief(select(gold,blue))).toEqual(select(gold,blue));
    expect(colorReliefProfile(gold)).toEqual(colorReliefProfile({...gold,id:'color-3'}));
    expect(colorReliefProfile(blue)).toEqual(colorReliefProfile({...blue,id:'color-10'}));
  });
});

describe('independent bounded colour surfaces',()=>{
  it('composes ten supported real colours with distinct heights and no invented pigment or metal',()=>{
    const image=stripes(),before=image.data.slice(),selection=select(...colors.map((_color,index)=>choice(index)));
    const maps=build(image,selection),centerHeights=[];
    for(let index=0;index<10;index++) {
      const pixel=40*160+index*16+8;centerHeights.push(maps.heightMap[pixel]);
      expect(maps.layers[maps.owners[pixel]-1].color).toBe(colors[index]);
      expect(maps.mask[pixel]).toBe(255);expect(maps.gloss[pixel]).toBe(191);
    }
    expect(new Set(centerHeights).size).toBe(10);
    expect(maps.foil.every(byte=>byte===0)).toBe(true);expect(image.data).toEqual(before);
    expect(new Set(colors.map((_color,index)=>colorReliefProfile(choice(index)).roughness)).size).toBe(10);
  });
  it('attenuates one layer without changing any other layer or excluded pixel, including their boundary normals',()=>{
    const image=stripes(colors.slice(2,5),90,60),selection=select(choice(2),choice(3));
    const a=build(image,selection),b=drain(composeReliefLayerPixels(a,select({...choice(2),strength:0},choice(3))));
    const an=normals(a),bn=normals(b),am=material(a),bm=material(b);
    for(let i=0;i<a.mask.length;i++) {
      if(rgbAt(image,i)===colors[2]) {
        expect(b.mask[i]).toBe(0);expect(b.gloss[i]).toBe(0);expect(b.heightMap[i]).toBe(0);
        expect([...bn.slice(i*4,i*4+4)]).toEqual([128,128,255,255]);
      } else {
        for(const key of ['mask','heightMap','gloss','foil'])expect(b[key][i]).toBe(a[key][i]);
        expect([...bn.slice(i*4,i*4+4)]).toEqual([...an.slice(i*4,i*4+4)]);
        expect([...bm.slice(i*4,i*4+4)]).toEqual([...am.slice(i*4,i*4+4)]);
      }
    }
    expect(b.owners).toBe(a.owners);expect(b.baseMask).toBe(a.baseMask);expect(b.baseHeight).toBe(a.baseHeight);
  });
  it('gives selected layers sharper dielectric reflections without changing original colour pixels',()=>{
    const image=stripes(colors.slice(2,4),60,60),selection=select(choice(2,1),choice(3,1));
    const multi=material(build(image,selection)),single=material(build(image,choice(2,1)));
    const first=(30*60+15)*4,second=(30*60+45)*4;
    expect(multi[first+1]).toBeLessThan(single[first+1]);expect(multi[first+3]).toBeLessThan(single[first+3]);
    expect(multi[first+1]).not.toBe(multi[second+1]);expect(multi[first+3]).not.toBe(multi[second+3]);
    for(let i=2;i<multi.length;i+=4)expect(multi[i]).toBe(0);
  });
  it('changes reflectance independently when one intensity is lowered rather than applying a global gain',()=>{
    const image=stripes(colors.slice(2,4),60,60),a=build(image,select(choice(2,1),choice(3,.8)));
    const b=drain(composeReliefLayerPixels(a,select(choice(2,.1),choice(3,.8)))),am=material(a),bm=material(b);
    const first=(30*60+15)*4,second=(30*60+45)*4;
    expect(bm[first]).toBeLessThan(am[first]);expect(bm[first+1]).toBeGreaterThan(am[first+1]);expect(bm[first+3]).toBeGreaterThan(am[first+3]);
    expect([...bm.slice(second,second+4)]).toEqual([...am.slice(second,second+4)]);
    expect(b.heightMap[30*60+15]).toBeLessThan(a.heightMap[30*60+15]);
  });
  it('is independent of the order in which selections were checked',()=>{
    const image=stripes(),selection=colors.map((_color,index)=>choice(index));
    expect(build(image,select(...selection))).toEqual(build(image,select(...selection.reverse())));
  });
  it('resolves overlapping imported tolerances exclusively instead of adding their relief or brightness',()=>{
    const image=stripes(['#203040','#213141'],60,60),layers=[{id:'color-1',color:'#203040',tolerance:12,strength:1},
      {id:'color-2',color:'#213141',tolerance:12,strength:1}];
    const a=build(image,select(...layers)),b=build(image,select(...layers.reverse()));
    expect(a).toEqual(b);expect(a.owners.every(owner=>owner===1||owner===2)).toBe(true);
    expect(Math.max(...a.heightMap)).toBeLessThanOrEqual(Math.round(Math.max(...layers.map(layer=>colorReliefProfile(layer).heightMM))/.6*255));
    expect(a.gloss.every(byte=>byte<=255)).toBe(true);
  });
  it('does not recenter absent persisted colours onto other pigments',()=>{
    const image=stripes([colors[2],colors[3]],60,60),maps=build(image,select(choice(4),choice(3)));
    for(let i=0;i<maps.mask.length;i++)if(rgbAt(image,i)===colors[2])expect(maps.mask[i]).toBe(0);
    expect(maps.layers.map(layer=>layer.color)).toContain(colors[4]);
  });
  it('excludes transparent board padding and unselected one-pixel strokes from all relief channels',()=>{
    const image=stripes(colors.slice(2,4),60,60),before=image.data.slice();
    for(let y=0;y<60;y++) {image.data.set([0,0,255,255],(y*60+15)*4);image.data[(y*60+59)*4+3]=0;}
    const maps=build(image,select(choice(2),choice(3))),normal=normals(maps);
    for(let y=0;y<60;y++)for(const x of [15,59]) {
      const index=y*60+x;
      for(const key of ['heightMap','gloss','foil','mask'])expect(maps[key][index]).toBe(0);
      expect([...normal.slice(index*4,index*4+4)]).toEqual([128,128,255,255]);
    }
    for(let y=0;y<60;y++){before.set([0,0,255,255],(y*60+15)*4);before[(y*60+59)*4+3]=0;}
    expect(image.data).toEqual(before);
  });
  it('refuses to reuse cached ownership after a selected colour or tolerance changes',()=>{
    const image=stripes(),maps=build(image,select(choice(0),choice(1)));
    expect(()=>drain(composeReliefLayerPixels(maps,select(choice(0),choice(2))))).toThrow(/zonas/);
    expect(()=>drain(composeReliefLayerPixels(maps,select({...choice(0),tolerance:2},choice(1))))).toThrow(/zonas/);
  });
  it('yields during classification and strength composition without growing a plane per selected colour',()=>{
    const image=stripes(colors,160,128),task=buildMapsFromPixels(image,image,select(...colors.map((_color,index)=>choice(index))));
    let step,yields=0;do{step=task.next();if(!step.done)yields++;}while(!step.done);
    expect(yields).toBeGreaterThan(200);
    const maps=step.value,planes=Object.values(maps).filter(value=>ArrayBuffer.isView(value));
    expect(planes).toHaveLength(7);expect(planes.every(plane=>plane.length===160*128)).toBe(true);
    const update=composeReliefLayerPixels(maps,select(...colors.map((_color,index)=>choice(index,.2))));
    let updateYields=0;do{step=update.next();if(!step.done)updateYields++;}while(!step.done);
    expect(updateYields).toBeGreaterThan(10);expect(step.value.owners).toBe(maps.owners);
  });
});
