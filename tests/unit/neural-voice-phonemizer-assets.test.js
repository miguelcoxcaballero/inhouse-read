// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {loadPhonemizerFactory} from '../../src/js/readers/neural-voice/phonemizer-assets.js'
import {createPhonemizer} from '../../src/js/readers/neural-voice/phonemizer.js'

const url='https://site/inhouse-read/neural-voice/phon/piper_phonemize.mjs?v=revision'
function setup() {
  const compiled={},exports={test:true},instance={exports},packs=[]
  const factory=vi.fn(async hooks=>{
    const pack=hooks.getPreloadedPackage('unused',3);packs.push([...new Uint8Array(pack)]);new Uint8Array(pack)[0]=99
    const receive=vi.fn();expect(hooks.instantiateWasm({a:1},receive)).toBe(exports);expect(receive).toHaveBeenCalledWith(instance,compiled)
    return {callMain:()=>hooks.print?.(JSON.stringify({phoneme_ids:[1,0,2]}))}
  })
  const fetchFile=vi.fn(async()=>new Response(new Uint8Array([1,2,3])))
  const compile=vi.fn(async()=>compiled),instantiate=vi.fn(()=>instance),importModule=vi.fn(async()=>({default:factory}))
  return {factory,fetchFile,compile,instantiate,importModule,packs}
}
describe('phonemizer immutable assets',()=>{
  it('loads and compiles once, then creates fresh heaps without further fetches',async()=>{
    const deps=setup(),loaded=await loadPhonemizerFactory(url,deps)
    for(let i=0;i<5;i++)await loaded.default({print:()=>{}})
    expect(deps.fetchFile.mock.calls.map(([path])=>path)).toEqual([
      'https://site/inhouse-read/neural-voice/phon/piper_phonemize.wasm?v=revision',
      'https://site/inhouse-read/neural-voice/phon/piper_phonemize.data?v=revision'])
    expect(deps.compile).toHaveBeenCalledTimes(1);expect(deps.instantiate).toHaveBeenCalledTimes(5)
    expect(deps.packs).toEqual(Array.from({length:5},()=>[1,2,3]))
  })
  it('retains the forty-call heap lifetime across more than 120 real wrapper calls',async()=>{
    const deps=setup(),loaded=await loadPhonemizerFactory(url,deps)
    deps.fetchFile.mockImplementation(()=>{throw new Error('background HTTP suspended')})
    const phon=await createPhonemizer({base:'https://site/phon/',importModule:async()=>loaded})
    for(let i=0;i<161;i++)expect(await phon.phonemize('The quiet reader.','en-us')).toEqual([1,0,2])
    expect(deps.factory).toHaveBeenCalledTimes(5);expect(deps.fetchFile).toHaveBeenCalledTimes(2)
    expect(deps.compile).toHaveBeenCalledTimes(1)
  })
  it('propagates HTTP failures before allocating a heap',async()=>{
    const deps=setup();deps.fetchFile.mockResolvedValue(new Response('',{status:503}))
    await expect(loadPhonemizerFactory(url,deps)).rejects.toThrow(/HTTP 503/)
    expect(deps.factory).not.toHaveBeenCalled();expect(deps.compile).not.toHaveBeenCalled()
  })
  it('rejects an empty asset before compiling',async()=>{
    const deps=setup();deps.fetchFile.mockImplementation(async()=>new Response(new Uint8Array()))
    await expect(loadPhonemizerFactory(url,deps)).rejects.toThrow(/empty asset/)
    expect(deps.factory).not.toHaveBeenCalled();expect(deps.compile).not.toHaveBeenCalled()
  })
  it('preserves a compile failure instead of re-fetching or retrying it',async()=>{
    const deps=setup();deps.compile.mockRejectedValue(new Error('invalid wasm'))
    await expect(loadPhonemizerFactory(url,deps)).rejects.toThrow('invalid wasm')
    expect(deps.fetchFile).toHaveBeenCalledTimes(2);expect(deps.factory).not.toHaveBeenCalled()
  })
})
