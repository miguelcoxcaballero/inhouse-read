// The reader classes whose members are answered by Rust dispatchers (rustMethods in
// readers/rust-ui-required.js): every member that reaches its dispatcher must be one the
// dispatcher knows, keep the class-member shape (non-enumerable, async ones rejecting), and a
// missing module must still fail clearly.
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({ui:null}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',()=>({default:'worker.mjs'}))
vi.mock('foliate-js/view.js',()=>({}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui,requireRustUI:async()=>fixture.ui,loadRustUI:async()=>fixture.ui,waitForRustUI:async()=>fixture.ui}))
import {ReadingVoice} from '../../src/js/readers/reading-voice.js'
import {NeuralVoicePicker} from '../../src/js/readers/neural-picker.js'
import {ReaderController} from '../../src/js/readers/reader-controller.js'
import {PdfReader} from '../../src/js/readers/pdf-reader.js'
import {ReaderExperience} from '../../src/js/readers/reader-experience.js'
import {ReaderLifecycle} from '../../src/js/readers/reader-lifecycle.js'
import {PreferenceFlow} from '../../src/js/readers/preference-flow.js'
import {VoiceFlow} from '../../src/js/readers/voice-flow.js'
import {ReaderChrome} from '../../src/js/readers/reader-chrome.js'
import {FoliateReader} from '../../src/js/readers/foliate-reader.js'
import {FoliateSpeechCursor} from '../../src/js/readers/foliate-speech-cursor.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
afterEach(()=>{fixture.ui=null})
const classes=[[ReadingVoice,'voice_method',40],[NeuralVoicePicker,'picker_method',20],[ReaderController,'controller_method',27],[PdfReader,'pdf_method',17],[ReaderExperience,'experience_method',36],
 [ReaderLifecycle,'flow_method',5],[PreferenceFlow,'flow_method',2],[VoiceFlow,'flow_method',4],[ReaderChrome,'flow_method',1],
 [FoliateReader,'foliate_method',4],[FoliateSpeechCursor,'foliate_method',3]]
it('dispatches only members its Rust dispatcher knows',async()=>{
 // Timers a member might start on the fixture host never run.
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame']})
 for(const [Class,dispatch,count] of classes){
  // The dispatcher is asked again with a null host, so a known member fails on its first host
  // read before any timer or listener exists, and an unknown one answers that it has no such member.
  const seen=new Map(),spy=vi.fn((host,name,args,kit,module)=>{
   let message=null
   try{const value=ui[dispatch](null,name,args,kit,module);if(value&&typeof value.then==='function')value.catch(()=>{})}catch(error){message=String(error?.message)}
   seen.set(name,message)
  })
  fixture.ui={...ui,[dispatch]:spy}
  for(const name of Object.getOwnPropertyNames(Class.prototype)){
   const descriptor=Object.getOwnPropertyDescriptor(Class.prototype,name)
   if(name==='constructor')continue
   const host={s:{}}
   try{const value=descriptor.get?descriptor.get.call(host):descriptor.value.call(host);if(value&&typeof value.then==='function')await value.catch(()=>{})}catch{}
  }
  expect(seen.size,Class.name).toBe(count)
  for(const [name,message] of seen)expect(message??'',`${Class.name}.${name}`).not.toMatch(/has no (method|member)/)
  expect(()=>ui[dispatch]({host:{}},'missing',[],{part:'x'},ui)).toThrow(/has no (method|member) missing/)
 }
 vi.clearAllTimers();vi.useRealTimers()
})
it('keeps class-member shape and fails clearly without the module',async()=>{
 for(const [Class] of classes){
  for(const name of Object.getOwnPropertyNames(Class.prototype))expect(Object.getOwnPropertyDescriptor(Class.prototype,name).enumerable).toBe(false)
 }
 expect(()=>ReadingVoice.prototype.pause.call({})).toThrow('Rust UI is not loaded')
 await expect(ReadingVoice.prototype.play.call({})).rejects.toThrow('Rust UI is not loaded')
 expect(()=>Object.getOwnPropertyDescriptor(ReaderController.prototype,'pageCount').get.call({s:{}})).toThrow('Rust UI is not loaded')
})
