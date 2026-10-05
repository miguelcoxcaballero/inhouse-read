// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scoreFontMask, glyphMask, nearEdgeMap } from '../../src/js/cover-appearance.js'
import { scoreFontMask as workerScore } from '../../src/js/font-score-core.js'

const appearanceUrl=new URL('../../src/js/cover-appearance.js',import.meta.url)
const coreUrl=new URL('../../src/js/font-score-core.js',import.meta.url)
const referenceUrl=new URL('./helpers/reference-cover-appearance.js',import.meta.url)
// The real Node ESM loader imports the untransformed bytes, just as the original Playwright data URL.
const nativeImport=url=>import(/* @vite-ignore */ url)
let instance=0, phase, rasters, fontLoads, workerConstructs
async function rawModule(url=appearanceUrl) {
  const bytes=await readFile(url)
  return nativeImport(`data:text/javascript;base64,${bytes.toString('base64')}#compat-${++instance}`)
}
function trace(task) {
  const steps=[]
  for(let step=task.next();;step=task.next()) {
    steps.push({done:step.done,value:step.value})
    if(step.done)return steps
  }
}
function canvas() {
  const node={width:0,height:0},context={
    image:false,drawImage(){this.image=true},clearRect(){},
    measureText(text){return {width:String(text).length*3}},
    fillText(text,x,y,width){rasters[phase].push({text,font:this.font,align:this.textAlign,x,y,maxWidth:width,canvasWidth:node.width,canvasHeight:node.height})},
    getImageData(_x,_y,width,height){
      const data=new Uint8ClampedArray(width*height*4)
      if(this.image)for(let i=0;i<data.length;i+=4){data[i]=80;data[i+1]=120;data[i+2]=200;data[i+3]=255}
      else for(let y=3;y<17;y++)for(let x=3;x<15;x++)if(x<7||y<7||((x+y)%4===0))data[(y*width+x)*4+3]=255
      return {data}
    }
  }
  node.getContext=()=>context
  return node
}
beforeEach(()=>{
  phase='reference';rasters={reference:[],raw:[]};fontLoads=[];workerConstructs=0
  vi.stubGlobal('Worker',class {constructor(){workerConstructs++;throw new Error('A raw data module must use its local scorer')}})
  vi.stubGlobal('Image',class {naturalWidth=64;naturalHeight=80;decode(){return Promise.resolve()}set src(value){this.url=value}})
  vi.stubGlobal('document',{createElement:tag=>{if(tag!=='canvas')throw new Error('Unexpected node');return canvas()},
    fonts:{load:font=>{fontLoads.push({phase,font});return Promise.resolve([])}}})
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('self-contained cover analyzer keeps Worker and raw data imports compatible',()=>{
  it('keeps every local scoring helper byte identical to the independent Worker core and original reference',async()=>{
    const [appearance,core,reference]=await Promise.all([appearanceUrl,coreUrl,referenceUrl].map(url=>readFile(url,'utf8')))
    const lf=s=>s.replace(/\r\n/g,'\n')
    const local=lf(appearance).slice(lf(appearance).indexOf('function meanAt('),lf(appearance).indexOf('function* scoreFamily('))
    const worker=lf(core).slice(lf(core).indexOf('function meanAt('))
    const original=lf(reference).slice(lf(reference).indexOf('function meanAt('),lf(reference).indexOf('function* scoreFamily('))
    expect(local).toBe(worker);expect(local).toBe(original)
    expect(appearance).not.toMatch(/^\s*(?:import\s+[^(']|export\s+\{[^\n]*\}\s+from\s)/m)
  })
  for(const [width,height] of [[64,80],[192,128],[192,288]]) {
    it(`keeps every generator yield and final numerical score identical at ${width}x${height}`,()=>{
      const raw=new Uint8ClampedArray(30*22*4)
      for(let y=2;y<20;y++)for(let x=2;x<28;x++)if(x<8||y<8||((x+2*y)%7===0))raw[(y*30+x)*4+3]=255
      const mask=glyphMask(raw,30,22,width);expect(mask).not.toBeNull()
      for(const seed of [0,1,17,255]) {
        const gray=Uint8Array.from({length:width*height},(_,i)=>(i*37+seed)%256)
        const near=nearEdgeMap(Float32Array.from({length:gray.length},(_,i)=>(i*13+seed)%255),width)
        const before={gray:gray.slice(),near:near.slice(),mask:mask.mask.slice(),perimeter:mask.perimeter.slice(),foreground:mask.foreground.slice(),background:mask.background.slice()}
        const args=[gray,near,width,height,Math.floor(height*.82),mask]
        expect(trace(scoreFontMask(...args))).toEqual(trace(workerScore(...args)))
        expect(gray).toEqual(before.gray);expect(near).toEqual(before.near)
        for(const key of ['mask','perimeter','foreground','background'])expect(mask[key]).toEqual(before[key])
      }
    })
  }
  it('imports the exact raw data module and its public helpers without linking or eagerly creating a Worker',async()=>{
    const module=await rawModule()
    expect(Object.keys(module).sort()).toEqual(['analyzeCoverAppearance','coverAspectRatio','coverColorFromPixels','glyphMask','nearEdgeMap','readCoverAspectRatio','runInSlices','scoreFontMask','withCoverAppearance'].sort())
    expect(module.coverAspectRatio(900,1200)).toBe(.75)
    expect(workerConstructs).toBe(0);expect(fontLoads).toHaveLength(0)
  })
  for(const [title,masks] of [['Alpha beta',144],['ALPHA BETA',72]]) {
    it(`uses the exact local sliced analyzer after a failed relative client import for ${masks} ordered masks`,async()=>{
      const reference=await rawModule(referenceUrl)
      phase='reference';const expected=await reference.analyzeCoverAppearance('blob:reference',title)
      const module=await rawModule()
      phase='raw';const actual=await module.analyzeCoverAppearance('blob:raw',title)
      expect(actual).toEqual(expected);expect(rasters.raw).toEqual(rasters.reference)
      expect(rasters.raw).toHaveLength(masks)
      expect(fontLoads.filter(x=>x.phase==='raw').map(x=>x.font)).toEqual(fontLoads.filter(x=>x.phase==='reference').map(x=>x.font))
      expect(workerConstructs).toBe(0)
      // A second match in the same data module retains its cached unavailable-client fallback.
      phase='raw';const second=await module.analyzeCoverAppearance('blob:raw-again',title)
      expect(second).toEqual(expected);expect(rasters.raw).toEqual([...rasters.reference,...rasters.reference])
      expect(workerConstructs).toBe(0)
    })
  }
})
