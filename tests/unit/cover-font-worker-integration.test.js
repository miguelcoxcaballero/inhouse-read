// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scoreFontMask } from '../../src/js/font-score-core.js'

const drain=task=>{let step=task.next();while(!step.done)step=task.next();return step.value}
let phase, rasters, workers, failAt, fontLoads
class MatchingWorker {
  constructor() { this.sent=[];this.scores=0;this.terminated=0;this.context=null;workers.push(this) }
  postMessage(message) {
    const data=structuredClone(message);this.sent.push(data)
    if(data.type==='begin') {
      this.context=data
      Promise.resolve().then(()=>this.onmessage?.({data:{type:'begin',job:data.job,request:data.request,accepted:true}}))
    } else if(data.type==='score') {
      this.scores++
      const {gray,near,width,height,rows}=this.context
      const score=drain(scoreFontMask(gray,near,width,height,rows,data.mask))
      Promise.resolve().then(()=>this.onmessage?.({data:this.scores===failAt?
        {type:'error',job:data.job,request:data.request}:{type:'score',job:data.job,request:data.request,score}}))
    } else if(data.type==='end' && data.job===this.context?.job) this.context=null
  }
  terminate() { this.terminated++;this.context=null }
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
  vi.resetModules();phase='original';rasters={original:[],candidate:[]};workers=[];failAt=Infinity;fontLoads=[]
  const lifecycle = new EventTarget()
  vi.stubGlobal('addEventListener', lifecycle.addEventListener.bind(lifecycle))
  vi.stubGlobal('removeEventListener', lifecycle.removeEventListener.bind(lifecycle))
  vi.stubGlobal('dispatchEvent', lifecycle.dispatchEvent.bind(lifecycle))
  vi.stubGlobal('Worker',MatchingWorker)
  vi.stubGlobal('Image',class { naturalWidth=64;naturalHeight=80;decode(){return Promise.resolve()}set src(value){this.url=value} })
  vi.stubGlobal('document',{createElement:tag=>{if(tag!=='canvas')throw new Error('Unexpected node');return canvas()},
    fonts:{load:font=>{fontLoads.push({phase,font});return Promise.resolve([])}}})
})
afterEach(()=>{
  globalThis.dispatchEvent?.(new Event('pagehide'))
  vi.unstubAllGlobals();vi.restoreAllMocks()
})
async function compare(title) {
  const original=await import('./helpers/reference-cover-appearance.js')
  phase='original';const expected=await original.analyzeCoverAppearance('blob:original',title)
  const candidate=await import('../../src/js/cover-appearance.js')
  phase='candidate';const actual=await candidate.analyzeCoverAppearance('blob:candidate',title)
  expect(actual).toEqual(expected)
  expect(rasters.candidate).toEqual(rasters.original)
  expect(fontLoads.filter(item=>item.phase==='candidate').map(item=>item.font))
    .toEqual(fontLoads.filter(item=>item.phase==='original').map(item=>item.font))
  return {actual,expected}
}

describe('main fonts and Worker scores preserve the original analyzer',()=>{
  it('keeps the 144 valid mixed-case masks, their raster order and final appearance identical',async()=>{
    await compare('Alpha beta')
    expect(rasters.original).toHaveLength(144);expect(workers).toHaveLength(1)
    const begin=workers[0].sent.filter(message=>message.type==='begin'),scores=workers[0].sent.filter(message=>message.type==='score')
    expect(begin).toHaveLength(1);expect(scores).toHaveLength(144)
    expect(begin[0].gray).toBeInstanceOf(Uint8Array);expect(begin[0].near).toBeInstanceOf(Float32Array)
    expect(scores.every(message=>message.mask.perimeter instanceof Int32Array&&message.mask.mask instanceof Uint8Array)).toBe(true)
    expect(workers[0].sent.at(-1).type).toBe('end');expect(workers[0].context).toBeNull()
  })
  it('does not invent a second case for an already-uppercase title',async()=>{
    await compare('ALPHA BETA')
    expect(rasters.original).toHaveLength(72);expect(workers[0].sent.filter(message=>message.type==='score')).toHaveLength(72)
  })
  it('falls back on the same current mask and remaining masks after a Worker score failure',async()=>{
    failAt=7;await compare('Alpha beta')
    expect(rasters.original).toHaveLength(144);expect(workers).toHaveLength(1)
    expect(workers[0].sent.filter(message=>message.type==='score')).toHaveLength(7)
    expect(workers[0].terminated).toBe(1);expect(workers[0].context).toBeNull()
  })
  it('retains the original single-flight title sequence while reusing one Worker for serial jobs',async()=>{
    const titles=['Alpha beta','Delta epsilon'],original=await import('./helpers/reference-cover-appearance.js')
    phase='original';const expected=await Promise.all(titles.map(title=>original.analyzeCoverAppearance('blob:old:'+title,title)))
    const candidate=await import('../../src/js/cover-appearance.js')
    phase='candidate';const actual=await Promise.all(titles.map(title=>candidate.analyzeCoverAppearance('blob:new:'+title,title)))
    expect(actual).toEqual(expected);expect(rasters.candidate).toEqual(rasters.original);expect(workers).toHaveLength(1)
    const starts=workers[0].sent.filter(message=>message.type==='begin'),ends=workers[0].sent.filter(message=>message.type==='end')
    expect(starts).toHaveLength(2);expect(ends).toHaveLength(2);expect(starts[0].job).not.toBe(starts[1].job)
    const order=workers[0].sent.filter(message=>message.type==='score').map(message=>message.job)
    expect(order.filter((job,index)=>job!==order[index-1])).toHaveLength(2)
  })
  it('keeps color-only analysis out of the Worker and font loader',async()=>{
    const original=await import('./helpers/reference-cover-appearance.js')
    phase='original';const expected=await original.analyzeCoverAppearance('blob:original','Alpha beta',{matchFont:false})
    const candidate=await import('../../src/js/cover-appearance.js')
    phase='candidate';const actual=await candidate.analyzeCoverAppearance('blob:candidate','Alpha beta',{matchFont:false})
    expect(actual).toEqual(expected);expect(workers).toHaveLength(0);expect(fontLoads).toHaveLength(0)
    expect(rasters.original).toHaveLength(0);expect(rasters.candidate).toHaveLength(0)
  })
})
