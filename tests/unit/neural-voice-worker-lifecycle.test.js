// @vitest-environment node
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
const mocks=vi.hoisted(()=>({phon:vi.fn(),runtime:vi.fn()}))
vi.mock('../../src/js/readers/neural-voice/phonemizer.js',()=>({createPhonemizer:mocks.phon}))
vi.mock('../../src/js/readers/neural-voice/supertonic-runtime.js',()=>({createSupertonicRuntime:mocks.runtime}))
const base=pathToFileURL(resolve('tests/unit/fixtures/neural-ort')+'/').href
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
let messages,scope,session
const send=data=>scope.onmessage({data})
beforeEach(async()=>{
 vi.resetModules();messages=[];mocks.phon.mockReset();mocks.runtime.mockReset()
 mocks.phon.mockResolvedValue({phonemize:vi.fn(async()=>[1,3,4,2]),destroy:vi.fn()})
 session={release:vi.fn(async()=>{}),inputNames:['input'],outputNames:['output'],run:vi.fn(async()=>({output:{data:new Float32Array(500),dispose:vi.fn()}}))}
 scope={postMessage:message=>messages.push(message)};vi.stubGlobal('self',scope);vi.stubGlobal('__neuralOrt',{create:vi.fn(async()=>session)})
 await import('../../src/js/readers/neural-voice/worker.js')
})
afterEach(async()=>{await send({type:'free',id:999});vi.unstubAllGlobals()})
const init=()=>send({type:'init',id:1,ortBase:base,phonBase:'https://test/phon/'})
const load=()=>send({type:'load',id:2,voice:'piper',config:{audio:{sample_rate:22050},espeak:{voice:'en'}},model:new ArrayBuffer(8)})
it('releases an initializer completed after free and allows a clean reinitialization',async()=>{
 const gate=deferred(),late={phonemize:vi.fn(),destroy:vi.fn()};mocks.phon.mockReturnValueOnce(gate.promise)
 const starting=init();await send({type:'free',id:8});gate.resolve(late);await starting
 expect(late.destroy).toHaveBeenCalledOnce();expect(messages.some(m=>m.id===1&&m.type==='ready')).toBe(false)
 expect(messages.some(m=>m.id===8&&m.type==='freed')).toBe(true)
 await send({type:'init',id:9,ortBase:base,phonBase:'https://test/phon/'})
 expect(messages.at(-1)).toMatchObject({type:'ready',id:9})
})
it('releases a phonemizer arriving after import failure and retries initialization',async()=>{
 const gate=deferred(),late={destroy:vi.fn()};mocks.phon.mockReturnValueOnce(gate.promise)
 await send({type:'init',id:1,ortBase:'file:///missing-worker-fixture/',phonBase:'https://test/phon/'})
 expect(messages.at(-1)).toMatchObject({type:'error',id:1});gate.resolve(late);await flush();expect(late.destroy).toHaveBeenCalledOnce()
 await init();expect(messages.at(-1)).toMatchObject({type:'ready',id:1})
})
it('does not emit a short-rest chunk after cancellation while phonemizing',async()=>{
 const gate=deferred();mocks.phon.mockResolvedValue({phonemize:vi.fn(()=>gate.promise),destroy:vi.fn()})
 await init();await load();await send({type:'synth',id:3,text:'...',rate:1});await flush();await send({type:'cancel',id:3})
 gate.resolve([]);await send({type:'free',id:4})
 expect(messages.filter(m=>m.id===3)).toEqual([]);expect(session.run).not.toHaveBeenCalled();expect(session.release).toHaveBeenCalledOnce()
})
it('does not infer a duplicate active request and retains strict cancellation IDs',async()=>{
 const gate=deferred();session.run.mockReturnValue(gate.promise)
 await init();await load();await send({type:'synth',id:3,text:'Text.',rate:1});await send({type:'synth',id:3,text:'Duplicate.',rate:1});await flush()
 await send({type:'cancel',id:'3'});gate.resolve({output:{data:new Float32Array(500),dispose:vi.fn()}})
 await send({type:'free',id:4});expect(session.run).toHaveBeenCalledOnce()
 expect(messages.filter(m=>m.id===3&&m.type==='end')).toHaveLength(1)
 expect(messages.filter(m=>m.id===3&&m.type==='chunk')).toHaveLength(1)
})
it('serializes a late model creation before free and releases it exactly once',async()=>{
 const gate=deferred(),runtime={dispose:vi.fn(async()=>{})};mocks.runtime.mockReturnValueOnce(gate.promise)
 await init();const loading=send({type:'load',id:2,voice:'supertonic3',config:{runtime:'supertonic3'},buffers:{}});await flush()
 const freeing=send({type:'free',id:3});await flush();expect(runtime.dispose).not.toHaveBeenCalled()
 gate.resolve(runtime);await loading;await freeing
 expect(runtime.dispose).toHaveBeenCalledOnce();expect(messages.at(-1)).toMatchObject({type:'freed',id:3})
})
