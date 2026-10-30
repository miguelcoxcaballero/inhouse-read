// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The font-score Worker's client is in the shelf module (rust-ui/src/font_score_client.rs): hand it the real one.
vi.mock('../../src/js/rust-shelf.js', async () => (await import('./helpers/rust-shelf-real.js')).rustShelfMock())

const referenceUrl=new URL('./helpers/reference-cover-appearance.js',import.meta.url)
// Only the frozen pre-migration reference is self-contained. Production links
// actual ESM dependencies and awaits the real compiled Rust module.
const nativeImport=url=>import(/* @vite-ignore */ url)
let instance=0, phase, rasters, fontLoads, workerConstructs, appearance, workerScore, reference
async function rawReference(url=referenceUrl) {
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
beforeEach(async()=>{
  vi.resetModules()
  phase='reference';rasters={reference:[],production:[]};fontLoads=[];workerConstructs=0
  vi.stubGlobal('Worker',class {constructor(){workerConstructs++;throw new Error('Worker creation blocked: use the main-thread Rust scorer')}})
  vi.stubGlobal('Image',class {naturalWidth=64;naturalHeight=80;decode(){return Promise.resolve()}set src(value){this.url=value}})
  vi.stubGlobal('document',{createElement:tag=>{if(tag!=='canvas')throw new Error('Unexpected node');return canvas()},
    fonts:{load:font=>{fontLoads.push({phase,font});return Promise.resolve([])}}})
  const {requireRustCore,getRustCoreModule}=await import('../../src/js/rust-core.js')
  await requireRustCore({bytes:await readFile(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))})
  expect(getRustCoreModule()).toBeInstanceOf(WebAssembly.Module)
  appearance=await import('../../src/js/cover-appearance.js')
  ;({scoreFontMask:workerScore}=await import('../../src/js/font-score-core.js'))
  reference=await rawReference()
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('ESM cover analyzer preserves its independent reference with Rust and Worker fallback',()=>{
  it('shares the public Rust scorer with the Worker module after loading compiled WASM',()=>{
    expect(appearance.scoreFontMask).toBe(workerScore)
    expect(workerConstructs).toBe(0)
    expect(fontLoads).toHaveLength(0)
  })
  for(const [width,height] of [[64,80],[192,128],[192,288]]) {
    it(`keeps every generator yield and final numerical score identical at ${width}x${height}`,()=>{
      const raw=new Uint8ClampedArray(30*22*4)
      for(let y=2;y<20;y++)for(let x=2;x<28;x++)if(x<8||y<8||((x+2*y)%7===0))raw[(y*30+x)*4+3]=255
      const mask=appearance.glyphMask(raw,30,22,width);expect(mask).not.toBeNull()
      expect(mask).toEqual(reference.glyphMask(raw,30,22,width))
      for(const seed of [0,1,17,255]) {
        const gray=Uint8Array.from({length:width*height},(_,i)=>(i*37+seed)%256)
        const near=appearance.nearEdgeMap(Float32Array.from({length:gray.length},(_,i)=>(i*13+seed)%255),width)
        const before={gray:gray.slice(),near:near.slice(),mask:mask.mask.slice(),perimeter:mask.perimeter.slice(),foreground:mask.foreground.slice(),background:mask.background.slice()}
        const args=[gray,near,width,height,Math.floor(height*.82),mask]
        const expected=trace(reference.scoreFontMask(...args))
        expect(trace(appearance.scoreFontMask(...args))).toEqual(expected)
        expect(trace(workerScore(...args))).toEqual(expected)
        expect(gray).toEqual(before.gray);expect(near).toEqual(before.near)
        for(const key of ['mask','perimeter','foreground','background'])expect(mask[key]).toEqual(before[key])
      }
    })
  }
  it('imports production ESM and its public helpers without eagerly creating a Worker or requesting fonts',()=>{
    const module=appearance
    expect(Object.keys(module).sort()).toEqual(['analyzeCoverAppearance','coverAspectRatio','coverColorFromPixels','glyphMask','nearEdgeMap','readCoverAspectRatio','runInSlices','scoreFontMask','withCoverAppearance'].sort())
    expect(module.coverAspectRatio(900,1200)).toBe(.75)
    expect(workerConstructs).toBe(0);expect(fontLoads).toHaveLength(0)
  })
  for(const blocked of [true,false])for(const [title,masks] of [['Alpha beta',144],['ALPHA BETA',72]]) {
    it(`preserves ${masks} ordered rasters with ${blocked?'blocked':'missing'} Worker and main-thread Rust`,async()=>{
      if(!blocked)vi.stubGlobal('Worker',undefined)
      phase='reference';const expected=await reference.analyzeCoverAppearance('blob:reference',title)
      const module=appearance
      phase='production';const actual=await module.analyzeCoverAppearance('blob:production',title)
      expect(actual).toEqual(expected);expect(rasters.production).toEqual(rasters.reference)
      expect(rasters.production).toHaveLength(masks)
      expect(fontLoads.filter(x=>x.phase==='production').map(x=>x.font)).toEqual(fontLoads.filter(x=>x.phase==='reference').map(x=>x.font))
      expect(workerConstructs).toBe(blocked?1:0)
      // A second serial match still uses the same exact Rust scoring behavior.
      phase='production';const second=await module.analyzeCoverAppearance('blob:production-again',title)
      expect(second).toEqual(expected);expect(rasters.production).toEqual([...rasters.reference,...rasters.reference])
      expect(workerConstructs).toBe(blocked?2:0)
    })
  }
})
