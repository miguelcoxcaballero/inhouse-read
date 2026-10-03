import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('foliate-js/view.js', () => ({}))
vi.mock('foliate-js/overlayer.js', () => ({Overlayer:{}}))
vi.mock('../../src/js/gestures.js', () => ({attachSwipeNavigation:() => () => {}}))
// Progress is the actual installed dependency, not a hand-written index-shaped substitute.
import { SectionProgress } from 'foliate-js/progress.js'
import { FoliateReader } from '../../src/js/readers/foliate-reader.js'
import { ReaderController } from '../../src/js/readers/reader-controller.js'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { resetAudio, stopNativeAudio, unlockAudio } from '../../src/js/readers/neural-voice/audio.js'
import { FAKE_CATALOG, createFakeNeuralEngine } from '../helpers/fake-neural-engine.js'

const progress = new SectionProgress(Array.from({length:6}, () => ({size:100})),1500,1000)
let saved, controller, voice, view, bridge, engine
beforeAll(async () => {
  await loadNeural(); saved=[...neuralVoices]
  neuralVoices.splice(0,neuralVoices.length,...FAKE_CATALOG)
})
afterAll(() => { neuralVoices.splice(0,neuralVoices.length,...saved) })
beforeEach(async () => {
  document.body.innerHTML='<main></main>'
  view=document.createElement('div')
  Object.assign(view,{open:vi.fn(async()=>{}),init:vi.fn(async()=>{}),close:vi.fn(),
    book:{metadata:{language:'es'},toc:[]},
    renderer:{setStyles:vi.fn(),setAttribute:vi.fn(),removeAttribute:vi.fn()}})
  const create=document.createElement.bind(document)
  vi.spyOn(document,'createElement').mockImplementation(name=>name==='foliate-view'?view:create(name))
  // Only the rendered book text is fixed; the relocation adapter and controller are production code.
  vi.spyOn(FoliateReader.prototype,'getSpeechSource').mockResolvedValue(null)
  vi.spyOn(FoliateReader.prototype,'getSpeechText').mockResolvedValue('Primera frase. Segunda frase.')
  controller=new ReaderController()
  await controller.open(document.querySelector('main'),new File([new Uint8Array([0x50,0x4b,3,4,0,0,0,0])],'book.epub'))
  bridge={getProtocol:()=>1,begin:vi.fn(),stop:vi.fn(),mark:vi.fn()}
  vi.stubGlobal('InhousePcm',bridge)
  engine=createFakeNeuralEngine({voices:FAKE_CATALOG,installed:['piper:es_ES-davefx-medium'],hold:true})
  const stop=engine.stop.bind(engine)
  engine.unlock=()=>unlockAudio(); engine.stop=()=>{stop();stopNativeAudio()}
  setNeuralEngine(engine); voice=new ReadingVoice(controller)
})
afterEach(() => {
  voice?.stop(); controller?.close(); resetAudio(); setNeuralEngine(null)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML=''
})
function relocate(detail) {
  view.lastLocation=detail
  view.dispatchEvent(new CustomEvent('relocate',{detail}))
}
function actualDetail(index) {
  return {...progress.getProgress(index,.25,.1),tocItem:{label:'A chapter'},pageItem:{label:'4'},cfi:'epubcfi(/6/8!/4)'}
}
const start=id=>window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{type:'start',id}}))

describe('actual Foliate section progress reaches the native audiobook marker', () => {
  it.each([0,3])('maps real section.current %i through the controller only after the audible start',async index=>{
    const detail=actualDetail(index)
    expect(detail).not.toHaveProperty('index')
    relocate(detail)
    expect(controller.speechPosition).toEqual({kind:'chapter',index})
    expect(controller.location).toMatchObject({section:'A chapter',page:'4',locator:{kind:'cfi',value:detail.cfi}})
    await voice.play(); const id=voice.utteranceId
    expect(bridge.mark).not.toHaveBeenCalled(); start('stale')
    expect(bridge.mark).not.toHaveBeenCalled(); start(id)
    expect(bridge.mark).toHaveBeenCalledExactlyOnceWith(voice.nativeSession,id,index,'chapter')
  })
  it('preserves a valid explicit index from older adapters',()=>{
    relocate({...actualDetail(3),index:5})
    expect(controller.speechPosition).toEqual({kind:'chapter',index:5})
  })
  it.each([-1,1.5,'2'])('falls back from invalid explicit index %s to the real integer section index',index=>{
    relocate({...actualDetail(3),index})
    expect(controller.speechPosition).toEqual({kind:'chapter',index:3})
  })
  it.each([undefined,-1,1.5,'2'])('never invents chapter zero for invalid or absent section.current %s',async current=>{
    relocate({fraction:.2,section:{current,total:6},cfi:'epubcfi(/6/8)'})
    expect(controller.speechPosition).toBeNull()
    await voice.play(); start(voice.utteranceId)
    expect(bridge.mark).not.toHaveBeenCalled()
  })
})
