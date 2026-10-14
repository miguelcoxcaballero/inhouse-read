import assert from 'node:assert/strict'
import {afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {readerPanelMarkup,readerIcon} from '../../src/js/readers/reader-interface.js'
import {LegacyReaderChrome} from './helpers/reference-reader-chrome.js'
import {ReaderChrome} from '../../src/js/readers/reader-chrome.js'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const initialViewport=window.visualViewport,initialHeight=window.innerHeight,initialWidth=window.innerWidth
afterEach(()=>{runtime.ui=null;document.body.innerHTML='';Object.defineProperty(window,'visualViewport',{value:initialViewport,configurable:true});window.innerHeight=initialHeight;window.innerWidth=initialWidth;vi.restoreAllMocks()})
const mini=`<button type="button" data-mini-open><span data-mini-title></span><small data-mini-status></small></button><button type="button" class="reading-icon-button" data-mini-play aria-label="Pausar lectura">${readerIcon('pause')}</button><button type="button" class="reading-icon-button" data-mini-stop aria-label="Detener lectura">${readerIcon('stop')}</button>`
const legacy=LegacyReaderChrome.prototype
function setup(native,trial=0,markup='<button data-play></button><p class="reading-audio-status"></p><input><select><option>A</option></select>'){
 document.body.innerHTML='<section id="reader-screen"><header id="reader-toolbar"><button id="reader-settings"></button><button id="reader-location"></button><button id="reader-audio"></button></header></section>'
 const host={},events=[]
 const create=native?()=>ui.reader_create_chrome(host,markup,mini,()=>events.push(['return']),document):()=>legacy.create.call(host,markup,mini,()=>events.push(['return']))
 create();host.voice={neuralOff:trial%3?'':'failed'}
 host.neuralPicker=trial%5?{warmUp:()=>events.push(['warmUp']),render:()=>events.push(['render'])}:null
 host.setSleepChoice=value=>events.push(['sleep',value]);host.updateMiniPlayer=(...args)=>events.push(['mini',...args]);host.updateReturnButton=()=>events.push(['back'])
 host.voiceState=(state,message)=>native?ui.reader_voice_state(host,state,message,readerIcon,document):legacy.voiceState.call(host,state,message,readerIcon)
 host.resize=()=>native?ui.reader_resize_panel(host,window):Boolean(legacy.resize.call(host))
 host.reveal=()=>native?ui.reader_reveal_field(host,document):legacy.revealField.call(host)
 return {host,events}
}
it('constructs the same full reader DOM and return button',()=>{
for(let trial=0;trial<10;trial++){
 const results=[]
 for(const native of [false,true]){const {host,events}=setup(native,trial,readerPanelMarkup);host.returnButton.click();results.push({html:document.body.innerHTML,panel:host.panel.outerHTML,events,hidden:host.miniPlayer.hidden,back:host.returnButton.hidden})}
 assert.deepEqual(results[1],results[0])
}

})
it('preserves audiobook states, Unicode and synchronous callback order',()=>{
for(let trial=0;trial<200;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events}=setup(native,trial)
  for(const state of ['stopped','loading','playing','paused','failed'])host.voiceState(state,['','Preparing','字 📖','\ud800',null,false][trial%6])
  results.push({panel:host.panel.outerHTML,screen:host.screen.outerHTML,events})
 }
 assert.deepEqual(results[1],results[0])
}

})
it('keeps keyboard insets and focused fields visible with identical scrolling',()=>{
for(let trial=0;trial<200;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host}=setup(native,trial);document.body.append(host.panel)
  host.panel.open=trial%7!==0;host.panel.scrollTop=trial
  const height=[800,600.25,500,0][trial%4],width=[390,759,760,1200][trial%4]
  const viewport=trial%5===0?null:{height:trial%2?height:height/2,offsetTop:trial%3?0:12.5}
  Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true})
  window.innerHeight=globalThis.innerHeight=height;window.innerWidth=globalThis.innerWidth=width
  host.toolbar.getBoundingClientRect=()=>({height:trial%3?56:72.25})
  host.panel.getBoundingClientRect=()=>({top:100.5,bottom:400.25})
  const field=host.panel.querySelector(trial%2?'input':'select')
  field.getBoundingClientRect=()=>trial%3===0?{top:90.25,bottom:100.25}:trial%3===1?{top:330.25,bottom:390.5}:{top:250,bottom:300}
  if(trial%5)field.focus()
  const result=host.resize();host.reveal()
  results.push({result,style:host.panel.style.cssText,scroll:host.panel.scrollTop,active:document.activeElement.tagName})
 }
 assert.deepEqual(results[1],results[0])
}

})
it('keeps WASM allocations bounded while updating audio state',()=>{
const {host}=setup(true,1)
for(let round=0;round<2;round++){const before=core.memory.buffer.byteLength;for(let i=0;i<2000;i++)host.voiceState('playing','Text');if(round)assert.equal(core.memory.buffer.byteLength,before)}

})

it('delegates every voice state to the Rust function without recreating the open reader',()=>{
 const {host}=setup(false,1),chrome=new ReaderChrome(host),panel=host.panel
 const native={reader_voice_state:vi.fn(ui.reader_voice_state)};runtime.ui=native
 chrome.voiceState('playing','First');chrome.voiceState('paused','Second')
 expect(native.reader_voice_state).toHaveBeenCalledTimes(2);expect(host.panel).toBe(panel)
 expect(panel.querySelector('.reading-audio-status').textContent).toBe('Second')
})
it('schedules no focus scrolling for closed panels and ignores closure before a pending frame',()=>{
 const {host}=setup(true,1),chrome=new ReaderChrome(host);runtime.ui=ui
 let callback;const raf=vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(fn=>{callback=fn;return 1})
 chrome.resize();expect(raf).not.toHaveBeenCalled()
 host.panel.open=true;chrome.resize();expect(raf).toHaveBeenCalledOnce()
 host.panel.open=false;host.panel.scrollTop=7;callback();expect(host.panel.scrollTop).toBe(7)
})
it('does not hide callback errors or skip the remaining state notifications',()=>{
 const {host,events}=setup(true,1),error=Error('warm failed');host.neuralPicker.warmUp=()=>{throw error}
 expect(()=>host.voiceState('paused','Paused')).toThrow(error)
 expect(events).toEqual([['mini','paused','Paused'],['back']]);expect(host.panel.querySelector('[data-play]').getAttribute('aria-label')).toBe('Continuar')
})
it('fails with a clear error instead of working around a missing core',()=>{
 const {host}=setup(false,1),chrome=new ReaderChrome(host);runtime.ui=null
 expect(()=>chrome.voiceState('playing','x')).toThrow('Rust UI is not loaded')
})
