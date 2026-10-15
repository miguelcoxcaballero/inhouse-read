// Compare actual compiled Rust exports with the pre-migration palette logic.
import {beforeAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {rustReliefPalette} from './helpers/reference-palette-bridge.js';

const original=readFileSync(resolve(process.cwd(),'tests/unit/helpers/reference-relief-palette.js'),'utf8');
const coefficients=original.slice(original.indexOf('const LINEAR_RGB ='),original.indexOf('function colorName('));
const palette=original.slice(original.indexOf('function* colorHistogram('),original.indexOf('/** Membership is recalculated'));
const {rgbToOklab,colorHistogram,colorCandidates}=new Function(`
const CELL_SIZE=3,DEFAULT_COLOR_TOLERANCE=6,DISTINCT_COLOR_DISTANCE=12;
const COLOR_RELIEF_IDS=Array.from({length:10},(_,i)=>'color-'+(i+1));
${coefficients}\n${palette}\nreturn {rgbToOklab,colorHistogram,colorCandidates};`)();
const drain=task=>{let step,yields=0;do{step=task.next();if(!step.done)yields++;}while(!step.done);return {value:step.value,yields};};
function reference(image){
  const histogram=drain(colorHistogram(image));
  const selected=drain(colorCandidates(histogram.value.bins,histogram.value.opaque));
  return {value:{...histogram.value,colors:selected.value},yields:histogram.yields+selected.yields};
}
function image(width,height,sample){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++)data.set(sample(i,i%width,Math.floor(i/width)),i*4);
  return {width,height,data};
}
function rng(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};}
let core;
beforeAll(async()=>{
  const path=process.env.IHR_PALETTE_CORE || resolve(process.cwd(),'src/wasm/inhouse_read_core.wasm');
  core=(await WebAssembly.instantiate(readFileSync(path))).instance.exports;
  for(const name of ['new','free','count','pixels','bins','labs','cells','neighbors','sort','next','support','accept','finish'])
    expect(typeof core[`relief_palette_${name}`]).toBe('function');
});
const cases=[
  ['one pixel',()=>image(1,1,()=>[35,83,179,255])],
  ['all transparent',()=>image(96,144,()=>[150,50,200,127])],
  ['opacity boundary',()=>image(64,48,i=>[i%256,(i*7)%256,(i*19)%256,i%2?128:127])],
  ['single colour',()=>image(192,288,()=>[32,80,176,255])],
  ['two colours',()=>image(192,288,i=>i%2?[35,83,179,255]:[32,80,176,255])],
  ['within-bin mode tie',()=>image(64,64,i=>i%2?[35,83,179,255]:[36,84,180,255])],
  ['reversed within-bin mode tie',()=>image(64,64,i=>i%2?[36,84,180,255]:[35,83,179,255])],
  ['ten pigments',()=>image(192,288,i=>[[255,10,10],[15,150,20],[0,10,255],[245,200,0],[250,0,240],[0,235,245],[20,20,20],[255,255,255],[130,55,0],[210,155,190]][i%10].concat(255))],
  ['anti-alias fringe',()=>image(192,288,i=>{const a=[35,80,181],b=[212,169,60],t=i<255?i/255:i%2;return a.map((v,c)=>Math.round(v+(b[c]-v)*t)).concat(255);})],
  ['seeded photo',()=>{const next=rng(0x12345678);return image(192,288,()=>{const v=next();return [v&255,v>>>8&255,v>>>16&255,255];});}],
  ['max work square',()=>{const next=rng(0xbaadf00d);return image(288,288,()=>{const v=next();return [v&255,v>>>8&255,v>>>16&255,v>>>24];});}],
];
describe('exact complete palette job through real Rust',()=>{
  for(const [name,create]of cases)it(name,()=>{
    const input=create(),before=input.data.slice(),expected=reference(input),actual=drain(rustReliefPalette(core,input,rgbToOklab));
    expect(actual.value).not.toBeNull(); expect(actual).toEqual(expected); expect(input.data).toEqual(before);
  });
  it('refreshes views after memory grows between generator stages',()=>{
    const input=cases.at(-1)[1](),expected=reference(input),task=rustReliefPalette(core,input,rgbToOklab);
    let step,yields=0;do{step=task.next();if(!step.done){yields++;if(yields===1||yields===90||yields===110)core.memory.grow(1);}}while(!step.done);
    expect({value:step.value,yields}).toEqual(expected);
  });
  it('releases opaque and host allocations at every cancellation boundary',()=>{
    const input=cases[7][1](),count=reference(input).yields;
    for(const stop of [1,10,54,55,Math.max(1,count-1),count]){
      let jobs=0,arenas=0;
      const tracked={...core,
        relief_palette_new(n){const p=core.relief_palette_new(n);if(p)jobs++;return p;},
        relief_palette_free(p){core.relief_palette_free(p);jobs--;},
        alloc_f64(n){const p=core.alloc_f64(n);if(p)arenas++;return p;},
        free_f64(p,n){core.free_f64(p,n);arenas--;},
      };
      const task=rustReliefPalette(tracked,input,rgbToOklab);
      for(let i=0;i<stop;i++)if(task.next().done)break;
      task.return(); expect({jobs,arenas}).toEqual({jobs:0,arenas:0});
    }
  });
  it('cleans up an interrupted original OKLab callback',()=>{
    let jobs=0,arenas=0;
    const tracked={...core,
      relief_palette_new(n){const p=core.relief_palette_new(n);if(p)jobs++;return p;},
      relief_palette_free(p){core.relief_palette_free(p);jobs--;},
      alloc_f64(n){const p=core.alloc_f64(n);if(p)arenas++;return p;},
      free_f64(p,n){core.free_f64(p,n);arenas--;},
    };
    expect(drain(rustReliefPalette(tracked,cases[7][1](),()=>{throw new Error('cancelled callback');})).value).toBeNull();
    expect({jobs,arenas}).toEqual({jobs:0,arenas:0});
  });
});
