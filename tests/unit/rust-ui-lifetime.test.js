import {it,expect,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
afterEach(()=>{document.body.replaceChildren()})

it('releases both JavaScript callbacks and Rust page tasks after repeated preparation',async()=>{
 const prepare=async()=>{
  const source={physicalPage:1},next={clear(){},isValid(){return true}}
  const host={state:'playing',generation:1,index:0,chunks:['First.'],source,reader:{getNextSpeechSource:async()=>next},
   prepare:async value=>({source:value,items:[{text:'Next.'}]}),joinPageSentence(){},voiceFor:()=>({voice:null})}
  host.pagePlanValid=plan=>ui.voice_page_valid(plan);host.clearAhead=()=>ui.voice_clear_ahead(host)
  ui.voice_prepare_ahead(host,(owner,request)=>()=>ui.voice_ahead_active(owner,request),()=>null)
  await host.aheadPage.promise;host.clearAhead()
 }
 for(let i=0;i<10;i++)await prepare()
 const baseline=ui.ui_live_handles()
 for(let i=0;i<1000;i++)await prepare()
 expect(ui.ui_live_handles()).toBe(baseline)
})

it('releases menu listeners across create, populate, open, close and free cycles',()=>{
 const cycle=()=>{
  const menu=new ui.RustSelectMenu('Idioma',null,()=>{})
  menu.setOptions([{value:'es',label:'Español'},{value:'en',label:'English'}],'es')
  const root=menu.root;document.body.append(root);menu.open();menu.choose('en');menu.close({focus:false});root.remove();menu.free()
 }
 for(let i=0;i<5;i++)cycle()
 const baseline=ui.ui_live_handles()
 for(let i=0;i<100;i++)cycle()
 expect(ui.ui_live_handles()).toBe(baseline)
})
