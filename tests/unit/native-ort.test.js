import {describe,it,expect,vi} from 'vitest'
import {createNativeOrt,NativeTensor,encodeTensor,decodeTensor} from '../../src/js/readers/neural-voice/native-ort.js'
const environment=()=>Object.assign(new EventTarget(),{btoa,atob})
const event=(env,detail)=>env.dispatchEvent(new CustomEvent('inhouse-inference',{detail}))
describe('native ONNX tensor transport',()=>{
  it.each([['float32',Float32Array.of(.25,-.5,3.125)],['int64',BigInt64Array.of(0n,123456789123n,-99n)]])('preserves every %s bit and dimension',(type,data)=>{
    const tensor=decodeTensor({type,dims:[1,3],data:encodeTensor(data)})
    expect(tensor.data).toEqual(data);expect(tensor.dims).toEqual([1,3])
  })
  it('validates dimensions and types',()=>{
    expect(()=>new NativeTensor('float32',Float32Array.of(1),[2])).toThrow()
    expect(()=>new NativeTensor('int64',Float32Array.of(1),[1])).toThrow()
    expect(()=>decodeTensor({type:'float32',dims:[2],data:encodeTensor(Float32Array.of(1))})).toThrow()
  })
  it('uploads bounded ordered model slices and returns real request outputs',async()=>{
    const env=environment(),parts=[];let token
    const bridge={getProtocol:()=>1,begin:value=>token=value,startModel:vi.fn(),modelChunk:(_token,id,offset,data)=>parts.push({id,offset,data:atob(data)}),finishModel:(_token,id)=>event(env,{token,id,value:{session:id,inputNames:['input'],outputNames:['out']}}),run:(_token,id,key,encoded)=>{
      const input=JSON.parse(encoded).input
      expect(key).toBe(1);expect(decodeTensor(input).data).toEqual(BigInt64Array.of(9n))
      event(env,{token,id,value:{out:{type:'float32',dims:[1,2],data:encodeTensor(Float32Array.of(.3,-.7))}}})
    },release:(_token,id)=>event(env,{token,id,value:null}),dispose:vi.fn()}
    const ort=createNativeOrt({env,bridge}),model=Uint8Array.from({length:300001},(_,i)=>i%251)
    const session=await ort.InferenceSession.create(model)
    expect(parts.map(p=>p.offset)).toEqual([0,131072,262144])
    expect(parts.every(p=>p.data.length<=131072)).toBe(true)
    expect(parts.flatMap(p=>Array.from(p.data,c=>c.charCodeAt(0)))).toEqual([...model])
    expect(bridge.startModel).toHaveBeenCalledWith(token,1,300001)
    const out=await session.run({input:new ort.Tensor('int64',BigInt64Array.of(9n),[1])})
    expect(out.out.data).toEqual(Float32Array.of(.3,-.7))
    await session.release();await session.release()
    await expect(session.run({})).rejects.toThrow('released')
    ort.dispose();expect(bridge.dispose).toHaveBeenCalledWith(token)
  })
  it('rejects native failures and ignores callbacks from another generation',async()=>{
    const env=environment();let token,id
    const bridge={getProtocol:()=>1,begin:value=>token=value,startModel:(_token,key)=>id=key,modelChunk:vi.fn(),finishModel:vi.fn(),dispose:vi.fn()}
    const ort=createNativeOrt({env,bridge}),pending=ort.InferenceSession.create(Uint8Array.of(1))
    let settled=false;pending.then(()=>settled=true,()=>settled=true)
    event(env,{token:'other',id,value:{}});await Promise.resolve();expect(settled).toBe(false)
    event(env,{token,id,error:'bad model'});await expect(pending).rejects.toThrow('bad model')
    const next=ort.InferenceSession.create(Uint8Array.of(1));ort.dispose()
    await expect(next).rejects.toThrow('released')
    await expect(ort.InferenceSession.create(Uint8Array.of(1))).rejects.toThrow('released')
  })
  it('requires the exact native protocol',()=>{
    expect(()=>createNativeOrt({bridge:{getProtocol:()=>0}})).toThrow('unavailable')
  })
})
