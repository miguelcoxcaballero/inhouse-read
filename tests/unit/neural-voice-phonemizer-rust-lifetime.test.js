// @vitest-environment node
import {expect,it,vi} from 'vitest'
import {createPhonemizer} from '../../src/js/readers/neural-voice/phonemizer.js'
import {createPhonemizer as original} from './helpers/reference-phonemizer.js'
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
const fixture=()=>{
 const calls=[],files=[],modules=[],requests=[]
 const factory=vi.fn(async hooks=>{
  let count=0
  const module={PThread:{terminateAllThreads:vi.fn()},FS_createDataFile:(...args)=>files.push(args),callMain:args=>{
   calls.push(args);if(++count>13)throw new Error('old heap failed')
   const text=JSON.parse(args[3])[0].text
   hooks.print(JSON.stringify({phoneme_ids:[1,0,...Array.from(text,letter=>letter.codePointAt(0)),0,2]}))
  }}
  modules.push(module);return module
 })
 return{calls,files,modules,requests,factory,options:{base:'https://voice/phon/',rebuildEvery:40,
  importModule:async()=>({default:factory}),fetchFile:async url=>{requests.push(url);return new Response(Uint8Array.of(1,2,3))}}}
}

it('preserves complete phoneme IDs, factory rebuilds, dictionary reuse and call arguments',async()=>{
 const left=fixture(),right=fixture(),expected=await original(left.options),actual=await createPhonemizer(right.options)
 try {
  for(let index=0;index<240;index++){
   const voice=['es-419','en-us','ru','pl','zh','nl'][index%6],text=`Título ${index}: “árboles”, עברית, 世界.`
   expect(await actual.phonemize(text,voice)).toEqual(await expected.phonemize(text,voice))
  }
  expect(right.calls).toEqual(left.calls);expect(right.requests).toEqual(left.requests);expect(right.files).toEqual(left.files)
  expect(right.factory).toHaveBeenCalledTimes(left.factory.mock.calls.length)
 }finally{expected.destroy();actual.destroy()}
})

it('serializes concurrent texts and shares one pending dictionary without mixing output',async()=>{
 const setup=fixture(),gate=deferred(),fetchFile=vi.fn(()=>gate.promise)
 const phon=await createPhonemizer({...setup.options,fetchFile,rebuildEvery:1})
 const first=phon.phonemize('First','ru'),second=phon.phonemize('Second','ru');await flush()
 expect(fetchFile).toHaveBeenCalledOnce();expect(setup.calls).toHaveLength(0)
 gate.resolve(new Response(Uint8Array.of(1,2)))
 const results=await Promise.all([first,second]);expect(results[0]).not.toEqual(results[1])
 expect(setup.calls.map(args=>JSON.parse(args[3])[0].text)).toEqual(['First','Second'])
 expect(fetchFile).toHaveBeenCalledOnce();expect(setup.factory).toHaveBeenCalledTimes(2)
 phon.destroy();for(const module of setup.modules)expect(module.PThread.terminateAllThreads).toHaveBeenCalledOnce()
})

it('drops a late rebuilt module and queued jobs after destroy',async()=>{
 const setup=fixture(),gate=deferred(),phon=await createPhonemizer({...setup.options,rebuildEvery:1})
 await phon.phonemize('First','en');setup.factory.mockImplementationOnce(()=>gate.promise)
 const pending=phon.phonemize('Late','en'),queued=phon.phonemize('Queued','en')
 const pendingFailure=expect(pending).rejects.toThrow(/released/),queuedFailure=expect(queued).rejects.toThrow(/released/)
 await flush();phon.destroy()
 const late={callMain:vi.fn(),PThread:{terminateAllThreads:vi.fn()}};gate.resolve(late)
 await pendingFailure;await queuedFailure;expect(late.PThread.terminateAllThreads).toHaveBeenCalledOnce();expect(late.callMain).not.toHaveBeenCalled()
 phon.destroy();expect(setup.modules[0].PThread.terminateAllThreads).toHaveBeenCalledOnce()
 await expect(phon.phonemize('Closed','en')).rejects.toThrow(/released/)
})

it('does not install bytes or invoke espeak after a dictionary arrives on a destroyed instance',async()=>{
 const setup=fixture(),gate=deferred(),phon=await createPhonemizer({...setup.options,fetchFile:()=>gate.promise})
 const pending=phon.phonemize('Late','ru'),failure=expect(pending).rejects.toThrow(/released/)
 await flush();phon.destroy();const body=vi.fn(async()=>new ArrayBuffer(8));gate.resolve({ok:true,arrayBuffer:body})
 await failure;expect(body).not.toHaveBeenCalled();expect(setup.files).toEqual([]);expect(setup.calls).toEqual([])
})

it('aborts the production dictionary download promptly even if the network ignores cancellation',async()=>{
 const setup=fixture(),phon=await createPhonemizer({...setup.options,fetchFile:undefined}),gate=deferred()
 const fetch=vi.fn(()=>gate.promise)
 vi.stubGlobal('fetch',fetch);vi.stubGlobal('caches',{open:async()=>({match:async()=>null})})
 try {
  const pending=phon.phonemize('Late','ru'),failure=expect(pending).rejects.toMatchObject({code:'aborted'})
  await flush();expect(fetch).toHaveBeenCalledOnce();phon.destroy();await failure
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);expect(setup.calls).toEqual([])
  gate.resolve(new Response(Uint8Array.of(1,2)));await flush();expect(setup.files).toEqual([])
 }finally{phon.destroy();vi.unstubAllGlobals()}
})

it('ignores old module callbacks after a successful rebuild',async()=>{
 const setup=fixture(),phon=await createPhonemizer({...setup.options,rebuildEvery:1})
 await phon.phonemize('First','en');const oldHooks=setup.factory.mock.calls[0][0]
 const factory=setup.factory.getMockImplementation()
 setup.factory.mockImplementation(async hooks=>{
  const module=await factory(hooks),run=module.callMain
  module.callMain=args=>{run(args);oldHooks.print('{"phoneme_ids":[999]}');oldHooks.printErr('stale')};return module
 })
 expect(await phon.phonemize('Second','en')).toEqual([1,0,...Array.from('Second',c=>c.codePointAt(0)),0,2]);phon.destroy()
})
