// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NeuralPackageStore } from '../../src/js/readers/neural-voice/package-store.js'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { piperVoices, supertonicVoices, isNeuralVoiceId, recommendedVoice } from '../../src/js/readers/neural-voice/catalog.js'
import { normalizeReadingPreferences } from '../../src/js/readers/reading-preferences.js'
import { isNeuralId, normalizeNeuralVoice } from '../../src/js/readers/voice-catalog.js'
import { advance, fakeAudioContext, fakeClients, feedJob, flush, recordEvents } from './neural-fakes.js'

function stores() {
  const piper={list:vi.fn(async()=>new Set(['es_MX-claude-high'])),has:vi.fn(async()=>true),download:vi.fn(),remove:vi.fn(),readConfig:vi.fn(async()=>({phoneme_type:'espeak'})),readModel:vi.fn(),readPhonemizerModel:vi.fn()}
  const supertonic={availableStyles:vi.fn(async()=>new Set(['F1','M1','F2','F3','F4','F5','M2','M3','M4','M5'])),installed:vi.fn(async()=>true),install:vi.fn(),remove:vi.fn(),readAssets:vi.fn(async()=>({vocoder:new ArrayBuffer(8)})),readConfig:vi.fn(async()=>({config:{},indexer:[],styles:{F1:{}}}))}
  return {piper,supertonic,store:new NeuralPackageStore({piper,supertonic})}
}
let engine
afterEach(()=>{engine?.stop();engine=null;vi.clearAllTimers();vi.useRealTimers()})
async function reading() {
  vi.useFakeTimers()
  const ctx=fakeAudioContext(),clients=fakeClients(),env=new EventTarget(),store=stores().store
  Object.assign(env,{Worker(){},WebAssembly:{},AudioContext(){},caches:{}})
  engine=new NeuralEngine({store,env,createClient:clients.createClient,audio:{context:()=>ctx,unlock:()=>ctx}})
  await engine.refresh()
  return {ctx,clients,events:recordEvents(env),store}
}

describe('natural voice runtime packages',()=>{
  it('keeps every existing Piper voice and adds ten genuine generic-language profiles per supported language',()=>{
    expect(piperVoices).toHaveLength(39)
    expect(supertonicVoices).toHaveLength(220)
    const languages=[...new Set(supertonicVoices.map(voice=>voice.lang))]
    expect(languages).toHaveLength(22)
    expect(languages.some(lang=>['ca','nb','zh','sr','he'].includes(lang))).toBe(false)
    for(const lang of languages)expect(supertonicVoices.filter(voice=>voice.lang===lang).map(voice=>voice.style)).toEqual(['F1','M1','F2','F3','F4','F5','M2','M3','M4','M5'])
    expect(supertonicVoices.every(voice=>voice.lang.length===2 && voice.piperId==='supertonic3' && voice.sharedPack)).toBe(true)
    for(const lang of languages)expect(recommendedVoice(lang).runtime).not.toBe('supertonic3')
  })
  it('accepts valid profile IDs consistently in preferences and normalized natural menus',()=>{
    const voice=supertonicVoices.find(voice=>voice.lang==='es')
    expect(isNeuralVoiceId(voice.id)).toBe(true);expect(isNeuralId(voice.id)).toBe(true)
    expect(normalizeReadingPreferences({voice:voice.id}).voice).toBe(voice.id)
    expect(normalizeNeuralVoice(voice,new Set([voice.id]))).toMatchObject({neural:true,installed:true,sharedPack:true,modelKey:'supertonic3',licenseUrl:voice.licenseUrl})
    for(const voice of supertonicVoices) {
      expect(isNeuralVoiceId(voice.id)).toBe(true);expect(isNeuralId(voice.id)).toBe(true);
      expect(normalizeReadingPreferences({voice:voice.id}).voice).toBe(voice.id);
      expect(normalizeNeuralVoice(voice,new Set([voice.id]))).toMatchObject({installed:true,upgradeBytes:2039325});
    }
    for(const id of ['supertonic3:F9:es','supertonic3:F1:es-AR','supertonic3:F1:xx'])expect(normalizeReadingPreferences({voice:id}).voice).toBe('')
  })
  it('routes shared installation, assets and deletion without treating the pack as Piper',async()=>{
    const {store,piper,supertonic}=stores(),options={signal:new AbortController().signal,onProgress:vi.fn()}
    expect(await store.list()).toEqual(new Set(['es_MX-claude-high','supertonic3']))
    await store.download('supertonic3',options);await store.remove('supertonic3')
    expect(supertonic.install).toHaveBeenCalledWith(options);expect(supertonic.remove).toHaveBeenCalledOnce()
    expect(await store.readConfig('supertonic3')).toMatchObject({runtime:'supertonic3',styles:{F1:{}}})
    expect(await store.readRuntimeAssets('supertonic3')).toHaveProperty('vocoder')
    expect(piper.download).not.toHaveBeenCalled();expect(piper.remove).not.toHaveBeenCalled();expect(piper.readModel).not.toHaveBeenCalled()
    await store.download('es_MX-claude-high',options);expect(piper.download).toHaveBeenCalledWith('es_MX-claude-high',options)
  })
  it('does not hide an installed runtime when the other cache cannot be read',async()=>{
    const {store,piper,supertonic}=stores()
    supertonic.installed.mockRejectedValueOnce(new Error('unavailable'))
    expect(await store.list()).toEqual(new Set(['es_MX-claude-high']))
    piper.list.mockRejectedValueOnce(new Error('unavailable'))
    expect(await store.list()).toEqual(new Set(['supertonic3']))
  })
  it('marks all profiles installed from one pack and sends the actual language/profile to synthesis',async()=>{
    const {clients}=await reading()
    expect(supertonicVoices.every(voice=>engine.installed.has(voice.id))).toBe(true)
    engine.speak({text:'Hola.',voiceId:'supertonic3:F1:es',rate:1.25,id:'first'});await flush()
    expect(clients.last().prepared).toContain('supertonic3')
    expect(clients.last().jobs[0].request).toMatchObject({text:'Hola.',lang:'es',style:'F1',rate:1.25})
  })
  it('never reuses PCM across language or profile even when their text is identical',async()=>{
    const {clients}=await reading()
    for(const [index,id] of ['supertonic3:F1:es','supertonic3:M1:es','supertonic3:F1:en'].entries()){
      engine.speak({text:'No.',voiceId:id,id:String(index)});await flush()
      feedJob(clients.last().jobs.at(-1),2)
    }
    expect(clients.last().jobs).toHaveLength(3)
    expect(engine.cache.size).toBe(3)
    engine.speak({text:'No.',voiceId:'supertonic3:F1:es',id:'replay'});await flush()
    expect(clients.last().jobs).toHaveLength(3)
    expect(engine.stats.cacheHits).toBe(1)
  })
  it('deleting any profile cancels an active sibling and removes the whole pack but retains Piper',async()=>{
    const {ctx,clients,events,store}=await reading()
    engine.speak({text:'Hello.',voiceId:'supertonic3:M1:en',id:'current'});await flush()
    feedJob(clients.last().jobs[0],3);advance(ctx,.1);await flush()
    await engine.remove('supertonic3:F1:es');await flush()
    expect(store.supertonic.remove).toHaveBeenCalledOnce()
    expect(engine.run).toBe(null);expect(ctx.sources[0].stopped).toBe(true)
    expect(events.at(-1)).toMatchObject({type:'error',id:'current',reason:'not-installed'})
    expect(supertonicVoices.some(voice=>engine.installed.has(voice.id))).toBe(false)
    expect(engine.installed.has('piper:es_MX-claude-high')).toBe(true)
    expect([...engine.cache.map.keys()].some(key=>key.startsWith('supertonic3#'))).toBe(false)
  })
})
