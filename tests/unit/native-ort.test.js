import {describe,it,expect,vi} from 'vitest'
// The runtime's requests, upload fences and release are rust-ui (native_ort.rs): the module is loaded as the reader loads it.
import './helpers/rust-ui-ready.js'
import {createNativeOrt,NativeTensor,encodeTensor,decodeTensor} from '../../src/js/readers/neural-voice/native-ort.js'
const environment=()=>Object.assign(new EventTarget(),{btoa,atob})
const event=(env,detail)=>env.dispatchEvent(new CustomEvent('inhouse-inference',{detail}))
describe('native ONNX tensor transport',()=>{
  it.each([['float32',Float32Array.of(.25,-.5,3.125)],['int64',BigInt64Array.of(0n,123456789123n,-99n)]])('preserves every %s bit and dimension',(type,data)=>{
    const tensor=decodeTensor({type,dims:[1,3],data:encodeTensor(data)})
    expect(tensor.data).toEqual(data);expect(tensor.dims).toEqual([1,3])
  })
  it('uses direct byte codecs when available and preserves typed-array subviews',()=>{
    const to=Object.getOwnPropertyDescriptor(Uint8Array.prototype,'toBase64'),from=Object.getOwnPropertyDescriptor(Uint8Array,'fromBase64')
    const directEncode=vi.fn(function(){return btoa(String.fromCharCode(...this))})
    const directDecode=vi.fn(value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0)))
    Object.defineProperty(Uint8Array.prototype,'toBase64',{configurable:true,value:directEncode})
    Object.defineProperty(Uint8Array,'fromBase64',{configurable:true,value:directDecode})
    try {
      const source=Float32Array.of(99,.25,-.5,3.125,99),view=source.subarray(1,4)
      const env={btoa:()=>{throw Error('legacy encode used')},atob:()=>{throw Error('legacy decode used')}}
      const encoded=encodeTensor(view,env)
      expect(decodeTensor({type:'float32',dims:[3],data:encoded},env).data).toEqual(view)
      expect(directEncode).toHaveBeenCalledOnce();expect(directDecode).toHaveBeenCalledOnce()
      expect(()=>decodeTensor({type:'float32',dims:[2],data:encoded},env)).toThrow('length')
    } finally {
      if(to)Object.defineProperty(Uint8Array.prototype,'toBase64',to);else delete Uint8Array.prototype.toBase64
      if(from)Object.defineProperty(Uint8Array,'fromBase64',from);else delete Uint8Array.fromBase64
    }
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
