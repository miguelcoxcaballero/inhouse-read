import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {pdfImageRects,preparePDFReflow} from '../../src/js/readers/pdf-reflow.js'

let root,source,old,drawn,channelDescriptor
const viewport={width:600,height:800,transform:[1,0,0,-1,0,800]}
const layout={geometric:false,lines:[],text:'Before. After.'}
const rects=Array.from({length:32},(_,i)=>({x0:i*10,y0:100,x1:i*10+8,y1:120}))

beforeEach(()=>{
  document.body.innerHTML='<article>Previous complete page.</article>'
  root=document.querySelector('article');source=document.createElement('canvas')
  channelDescriptor=Object.getOwnPropertyDescriptor(window,'MessageChannel')
  source.width=600;source.height=800
  old=document.createElement('canvas');old.width=80;old.height=120;root.append(old)
  drawn=[]
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){
    return {drawImage:vi.fn(()=>drawn.push(this))}
  })
  vi.useFakeTimers()
  let tick=0
  vi.spyOn(performance,'now').mockImplementation(()=>tick+=5)
})
afterEach(()=>{
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML=''
  if(channelDescriptor)Object.defineProperty(window,'MessageChannel',channelDescriptor)
  else delete window.MessageChannel
})

describe('cooperative preparation of complete PDF reflow pages',()=>{
  it('keeps the previous text and pixels until every detached illustration is ready',async()=>{
    const ready=preparePDFReflow(root,layout,source,rects,viewport)
    expect(drawn).toHaveLength(1)
    expect(root.textContent).toBe('Previous complete page.')
    expect(root.querySelector('canvas')).toBe(old)
    expect(old.width).toBe(80)
    expect(drawn.every(canvas=>!canvas.isConnected)).toBe(true)
    await vi.runAllTimersAsync()
    expect(await ready).toBe(true)
    expect(root.textContent).toBe(layout.text)
    expect(root.querySelectorAll('canvas')).toHaveLength(32)
    expect(drawn.every(canvas=>canvas.isConnected && canvas.width===8 && canvas.height===20)).toBe(true)
    expect(old.width).toBe(0);expect(old.height).toBe(0)
  })

  it('releases cancelled detached canvases while preserving the previous page',async()=>{
    let active=true
    const ready=preparePDFReflow(root,layout,source,rects,viewport,()=>active)
    expect(drawn).toHaveLength(1)
    active=false
    await vi.runAllTimersAsync()
    expect(await ready).toBe(false)
    expect(root.textContent).toBe('Previous complete page.')
    expect(root.querySelector('canvas')).toBe(old)
    expect(old.width).toBe(80);expect(old.height).toBe(120)
    expect(drawn.every(canvas=>!canvas.isConnected && canvas.width===0 && canvas.height===0)).toBe(true)
  })

  it('retains the previous page after a detached crop fails',async()=>{
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){return{
      drawImage:()=>{drawn.push(this);throw new Error('Crop failed')}
    }})
    await expect(preparePDFReflow(root,layout,source,rects,viewport)).rejects.toThrow('Crop failed')
    expect(root.textContent).toBe('Previous complete page.')
    expect(root.querySelector('canvas')).toBe(old);expect(old.width).toBe(80)
    expect(drawn).toHaveLength(1);expect(drawn[0].width).toBe(0);expect(drawn[0].height).toBe(0)
  })

  it('closes posted message ports before releasing a cancelled preparation',async()=>{
    const channels=[]
    class PostedChannel{
      constructor(){
        this.port1={onmessage:null,close:vi.fn()}
        this.port2={close:vi.fn(),postMessage:()=>setTimeout(()=>this.port1.onmessage(),0)}
        channels.push(this)
      }
    }
    Object.defineProperty(window,'MessageChannel',{configurable:true,value:PostedChannel})
    let active=true
    const ready=preparePDFReflow(root,layout,source,rects,viewport,()=>active)
    expect(channels).toHaveLength(1)
    expect(root.textContent).toBe('Previous complete page.')
    active=false
    await vi.runAllTimersAsync()
    expect(await ready).toBe(false)
    expect(channels[0].port1.close).toHaveBeenCalledTimes(1)
    expect(channels[0].port2.close).toHaveBeenCalledTimes(1)
    expect(drawn.every(canvas=>canvas.width===0 && canvas.height===0)).toBe(true)
    expect(old.width).toBe(80)
  })
})

describe('image bounds on pages with many original illustrations',()=>{
  it('revisits earlier images when a composite grows across a previously empty gap',()=>{
    expect(pdfImageRects([0,0,.1,0,0,.3, .2,.1,.3,.1,.2,.2, .05,.2,.25,.2,.05,.4],100,100))
      .toEqual([{x0:0,y0:0,x1:30,y1:40}])
  })

  it('preserves each disconnected image in physical order despite reverse painting order',()=>{
    const count=2000,coordinates=Array.from({length:count},(_,i)=>{
      const y=i/count
      return [0,y,.5,y,0,y+.5/count]
    }).reverse().flat()
    const result=pdfImageRects(coordinates,100,count*2)
    expect(result).toHaveLength(count)
    expect(result[0]).toEqual({x0:0,y0:0,x1:50,y1:1})
    expect(result.at(-1)).toEqual({x0:0,y0:count*2-2,x1:50,y1:count*2-1})
  })
})
