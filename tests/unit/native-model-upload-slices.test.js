// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest'
import {createNativeOrt} from '../../src/js/readers/neural-voice/native-ort.js'

const CHUNK=131072,fixtures=[]
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()}
function fixture() {
  const env=Object.assign(new EventTarget(),{
    btoa:text=>Buffer.from(text,'latin1').toString('base64'),
    atob:text=>Buffer.from(text,'base64').toString('latin1'),
    performance:{now:()=>state.clock},document:{visibilityState:'visible'},
    requestAnimationFrame:vi.fn(()=>{throw new Error('RAF must not drive native uploads')}),
    setTimeout:vi.fn(()=>{throw new Error('Timers must not drive native uploads')}),
    MessageChannel:vi.fn(()=>{throw new Error('MessageChannel must not drive native uploads')})
  })
  const state={clock:0,token:null,parts:[],events:[],fences:[],nativeJobs:[],promises:[],onChunk:null,onStart:null}
  const reply=(id,value,error,token=state.token)=>env.dispatchEvent(new CustomEvent('inhouse-inference',{detail:{token,id,value,error}}))
  const bridge={
    getProtocol:()=>1,begin:token=>state.token=token,
    startModel:vi.fn((token,id,bytes)=>{state.events.push({type:'start',token,id,bytes});state.onStart?.()}),
    modelChunk:vi.fn((token,id,offset,data)=>{state.parts.push({token,id,offset,data});state.events.push({type:'chunk',id,offset});state.onChunk?.()}),
    finishModel:vi.fn((token,id)=>{state.events.push({type:'finish',id});reply(id,{session:id,inputNames:['input'],outputNames:['out']})}),
    release:vi.fn((token,id,key)=>{state.fences.push({token,id,key});state.events.push({type:'fence',id,key});state.nativeJobs.push(()=>reply(id,null))}),
    dispose:vi.fn(token=>state.events.push({type:'dispose',token}))
  }
  const ort=createNativeOrt({env,bridge})
  const f={env,bridge,ort,state,reply,
    create(model){const pending=ort.InferenceSession.create(model);pending.catch(()=>{});state.promises.push(pending);return pending},
    async next(){const job=state.nativeJobs.shift();if(job)job();await flush()},
    async drain(){let limit=0;while(state.nativeJobs.length){if(++limit>50)throw new Error('Unexpected upload callback loop');await f.next()}await flush()},
    model(length){return Uint8Array.from({length},(_,index)=>(index*17+31)%256)}
  }
  fixtures.push(f);return f
}
afterEach(async()=>{
  for(const f of fixtures.splice(0)){f.ort.dispose();await f.drain();await Promise.allSettled(f.state.promises)}
})

describe('native model upload executor fences',()=>{
  it('preserves exact sliced-view bytes, original chunk boundaries, offsets and finish order',async()=>{
    const f=fixture(),storage=f.model(6*CHUNK+37),model=storage.subarray(11,storage.length-19)
    const pending=f.create(model);await f.drain();const session=await pending
    expect(f.bridge.startModel).toHaveBeenCalledWith(f.state.token,1,model.length)
    expect(f.state.parts.map(part=>part.offset)).toEqual([0,CHUNK,2*CHUNK,3*CHUNK,4*CHUNK,5*CHUNK,6*CHUNK])
    expect(f.state.parts.every(part=>part.token===f.state.token&&part.id===1&&Buffer.from(part.data,'base64').length<=CHUNK)).toBe(true)
    expect(Buffer.concat(f.state.parts.map(part=>Buffer.from(part.data,'base64'))).equals(Buffer.from(model))).toBe(true)
    expect(f.state.fences).toHaveLength(1);expect(f.state.fences.every(fence=>fence.id>1&&fence.key===0)).toBe(true)
    expect(f.state.events.at(-1)).toEqual({type:'finish',id:1})
    expect(session.inputNames).toEqual(['input']);expect(session.outputNames).toEqual(['out'])
  })
  it('does not add a callback or delay to a one-chunk cold upload',async()=>{
    const f=fixture(),model=f.model(CHUNK),session=await f.create(model)
    expect(f.state.parts).toHaveLength(1);expect(f.state.fences).toHaveLength(0)
    expect(f.bridge.finishModel).toHaveBeenCalledTimes(1);expect(session.inputNames).toEqual(['input'])
  })
  it('returns to its caller after at most four chunks even with a stationary clock',async()=>{
    const f=fixture(),model=f.model(9*CHUNK+1),pending=f.create(model)
    expect(f.state.parts).toHaveLength(4);expect(f.bridge.finishModel).not.toHaveBeenCalled()
    let uiObserved=false;const uiTask=()=>{uiObserved=true;expect(f.state.parts).toHaveLength(4)}
    uiTask();expect(uiObserved).toBe(true)
    await f.next();expect(f.state.parts).toHaveLength(8);expect(f.bridge.finishModel).not.toHaveBeenCalled()
    await f.drain();await pending;expect(f.state.parts).toHaveLength(10);expect(f.state.fences).toHaveLength(2)
  })
  it('uses the elapsed four-millisecond budget before the four-chunk hard bound',async()=>{
    const f=fixture();f.state.onChunk=()=>f.state.clock+=5
    const pending=f.create(f.model(3*CHUNK))
    expect(f.state.parts).toHaveLength(1);expect(f.state.fences).toHaveLength(1)
    await f.next();expect(f.state.parts).toHaveLength(2);expect(f.state.fences).toHaveLength(2)
    await f.drain();await pending;expect(f.bridge.finishModel).toHaveBeenCalledTimes(1)
  })
  it('continues through native callbacks while hidden without RAF, timers or MessageChannel',async()=>{
    const f=fixture();f.env.document.visibilityState='hidden'
    const pending=f.create(f.model(8*CHUNK+1));expect(f.state.parts).toHaveLength(4)
    await f.drain();await pending
    expect(f.state.parts).toHaveLength(9);expect(f.bridge.finishModel).toHaveBeenCalledTimes(1)
    for(const name of ['requestAnimationFrame','setTimeout','MessageChannel'])expect(f.env[name]).not.toHaveBeenCalled()
  })
  it('disposal rejects the model and the pending fence without sending stale chunks or finish',async()=>{
    const f=fixture(),pending=f.create(f.model(8*CHUNK+1));expect(f.state.parts).toHaveLength(4)
    const rejection=expect(pending).rejects.toThrow('released');f.ort.dispose();await rejection
    await f.drain();expect(f.state.parts).toHaveLength(4);expect(f.bridge.finishModel).not.toHaveBeenCalled()
    expect(f.bridge.dispose).toHaveBeenCalledTimes(1)
    await expect(f.create(f.model(1))).rejects.toThrow('released')
  })
  it('does not send a chunk or finish if disposal occurs inside startModel',async()=>{
    const f=fixture();f.state.onStart=()=>f.ort.dispose()
    await expect(f.create(f.model(8*CHUNK+1))).rejects.toThrow('released')
    expect(f.bridge.modelChunk).not.toHaveBeenCalled();expect(f.bridge.finishModel).not.toHaveBeenCalled()
    expect(f.bridge.dispose).toHaveBeenCalledTimes(1)
  })
  it('ignores a foreign token for the native fence and resumes only its exact callback',async()=>{
    const f=fixture(),pending=f.create(f.model(5*CHUNK));expect(f.state.fences).toHaveLength(1)
    f.reply(f.state.fences[0].id,null,undefined,'other-generation');await flush()
    expect(f.state.parts).toHaveLength(4);expect(f.bridge.finishModel).not.toHaveBeenCalled()
    await f.drain();await pending;expect(f.bridge.finishModel).toHaveBeenCalledTimes(1)
  })
  it('rejects a failed native fence and disposes the partial native upload',async()=>{
    const f=fixture(),pending=f.create(f.model(5*CHUNK));expect(f.state.fences).toHaveLength(1)
    const rejection=expect(pending).rejects.toThrow('fence failed')
    f.reply(f.state.fences[0].id,undefined,'fence failed');await rejection;await f.drain()
    expect(f.state.parts).toHaveLength(4);expect(f.bridge.finishModel).not.toHaveBeenCalled();expect(f.bridge.dispose).toHaveBeenCalledTimes(1)
  })
  it.each(['encode','send'])('cleans an interrupted model when %s throws without losing the original error',async kind=>{
    const f=fixture(),failure=new Error('exact upload failure');let calls=0
    if(kind==='encode'){const btoa=f.env.btoa;f.env.btoa=text=>{if(++calls===2)throw failure;return btoa(text)}}
    else f.bridge.modelChunk.mockImplementation((token,id,offset,data)=>{if(++calls===2)throw failure;f.state.parts.push({token,id,offset,data})})
    await expect(f.create(f.model(5*CHUNK))).rejects.toBe(failure)
    expect(f.bridge.finishModel).not.toHaveBeenCalled();expect(f.bridge.dispose).toHaveBeenCalledTimes(1)
  })
  it('does not silently upload a large model without the protocol release endpoint',async()=>{
    const f=fixture();f.bridge.release=undefined
    await expect(f.create(f.model(4*CHUNK+1))).rejects.toThrow('fence unavailable')
    expect(f.bridge.startModel).not.toHaveBeenCalled();expect(f.bridge.modelChunk).not.toHaveBeenCalled()
    // A deliberately incomplete small legacy fixture remains bounded, not an
    // unlimited synchronous fallback. Production protocol1 has this endpoint.
    await f.create(f.model(4*CHUNK));expect(f.state.parts).toHaveLength(4)
  })
  it('rejects a non-null no-op acknowledgement and cleans the interrupted upload',async()=>{
    const f=fixture(),pending=f.create(f.model(5*CHUNK));expect(f.state.fences).toHaveLength(1)
    const rejection=expect(pending).rejects.toThrow('Invalid native upload fence')
    f.reply(f.state.fences[0].id,{unexpected:true});await rejection;await f.drain()
    expect(f.bridge.finishModel).not.toHaveBeenCalled();expect(f.bridge.dispose).toHaveBeenCalledTimes(1)
  })
})
