import {notifyRustUIReady} from '../../src/js/rust-ui-readiness.js'
import {afterEach,beforeAll,describe,it,expect,vi} from 'vitest'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {ReaderControls} from '../../src/js/readers/reader-controls.js'
import {LegacyReaderControls} from '../../src/js/readers/reader-controls-legacy.js'
import {readerPanelMarkup} from '../../src/js/readers/reader-interface.js'
import {normalizeReadingPreferences} from '../../src/js/readers/reading-preferences.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core,panelTemplate
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});panelTemplate=document.createElement('template');panelTemplate.innerHTML=readerPanelMarkup})
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML=''})
function setup(native){
 document.body.innerHTML='<section id="reader-screen"></section>'
 const screen=document.querySelector('section');for(const id of ['reader-settings','reader-audio','reader-location','reader-save-bookmark','reader-search-shortcut','reader-more-shortcut']){const b=document.createElement('button');b.id=id;screen.append(b)}
 const panel=document.createElement('dialog');panel.append(panelTemplate.content.cloneNode(true));document.body.append(panel)
 const mini=document.createElement('div');mini.innerHTML='<button data-mini-open></button><button data-mini-play></button><button data-mini-stop></button>';screen.append(mini)
 const events=[],host={screen,panel,miniPlayer:mini,locationButton:document.querySelector('#reader-location'),reader:{pageCount:4},preferences:normalizeReadingPreferences(),quoteColor:'yellow',keepSearchHits:false}
 for(const name of ['jump','show','showPlaceTab','addBookmark','step','setSleepChoice','search','endSearch','addQuote','shareBook','updateMiniPlayer','applyPreferences','error'])host[name]=(...args)=>events.push([name,...args])
 host.setPreference=(key,value)=>{events.push(['setPreference',key,value]);host.preferences=normalizeReadingPreferences({...host.preferences,[key]:value})}
 host.voice={state:'paused',pause:()=>{events.push(['pause']);host.voice.state='paused'},play:()=>{events.push(['play']);host.voice.state='playing'},stop:()=>events.push(['stop']),setSleep:x=>events.push(['setSleep',x])}
 host.resetAppearance=()=>{host.preferences=normalizeReadingPreferences({rate:host.preferences.rate,voice:host.preferences.voice,voiceLang:host.preferences.voiceLang});host.applyPreferences()}
 vi.stubGlobal('screen',{orientation:{type:'portrait-primary',lock:async value=>events.push(['lock',value])}})
 host.rotateReading=async()=>{try{if(globalThis.screen.orientation?.lock){await globalThis.screen.orientation.lock(globalThis.screen.orientation.type.startsWith('portrait')?'landscape':'portrait');host.error('')}else host.error('No se puede girar.')}catch{host.error('Gira el dispositivo.')}}
 panel.close=()=>{events.push(['close']);panel.removeAttribute('open');panel.dispatchEvent(new Event('close'))}
 panel.getBoundingClientRect=()=>({left:10,top:10,right:300,bottom:600})
 runtime.ui=native?ui:null;const controls=new ReaderControls(host)
 const find=q=>document.querySelector(q),click=q=>find(q).click(),change=(q,value,kind='change')=>{const e=find(q);if(e.type==='checkbox'||e.type==='radio')e.checked=value;else e.value=value;e.dispatchEvent(new Event(kind,{bubbles:true}))}
 return{host,panel,events,controls,find,click,change}
}
it('preserves each effect, label, focus target and call count across all reader controls',async()=>{
 const errors=[],onError=event=>errors.push(event.error?.message||event.message);window.addEventListener('error',onError)
 try{
const outputs=[]
for(const native of [false,true]){
 const {host,panel,events,controls,find,click,change}=setup(native)
 for(const selector of ['#reader-settings','#reader-audio','#reader-location','#reader-search-shortcut','#reader-toc-shortcut','#reader-more-shortcut','[data-mini-open]','[data-about]','[data-share]','[data-bookmark]','#reader-save-bookmark','[data-save-quote]','[data-audio-prev]','[data-audio-next]','[data-play]','[data-mini-play]','[data-stop]','[data-mini-stop]','[data-kids]','[data-kids]','[data-size-step="1"]','[data-theme="sepia"]','[data-sleep-value="15"]','[data-quote-color="green"]'])click(selector)
 change('[data-pref="fontSize"]',24);change('[data-pref="font"]','sans');change('[data-rate][value="1.5"]',true);change('[data-rate][value="2"]',false)
 change('[data-voice-option="footnotes"]',true);change('[data-progress]',72.6,'input');const progressLabel=find('.reading-position').textContent;change('[data-progress]',50)
 find('input[type="number"]').value='3';find('.reading-page-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
 find('[data-search-query]').value='needle';find('[data-search-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));change('[data-search-query]','   ','input')
 const tabs=[...panel.querySelectorAll('[data-place-tab]')];tabs[0].hidden=true;const tab=tabs[1];tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));const focus=document.activeElement.getAttribute('data-place-tab')
 click('[data-reset]');click('#reader-rotate');await Promise.resolve();await Promise.resolve()
 panel.dispatchEvent(new MouseEvent('click',{clientX:5,clientY:5,bubbles:true}));panel.setAttribute('open','');panel.dispatchEvent(new Event('close'));panel.removeAttribute('open');host.keepSearchHits=true;panel.dispatchEvent(new Event('close'))
 outputs.push({events,progressLabel,focus,preferences:host.preferences,quoteColor:host.quoteColor,keep:host.keepSearchHits,pressed:[...panel.querySelectorAll('[data-quote-color]')].map(x=>x.getAttribute('aria-pressed')),kids:host.screen.className})
 if(native){const before=events.length;controls.free();click('#reader-settings');click('[data-play]');assert.equal(events.length,before);}
}
assert.deepEqual(outputs[1],outputs[0]);

 expect(errors).toEqual([])
 }finally{window.removeEventListener('error',onError)}
})
it('ignores an event once its weak host getter no longer resolves',()=>{
 const fixture=setup(true);fixture.controls.free();const native=new ui.RustReaderControls(()=>undefined,fixture.panel,fixture.host.miniPlayer)
 fixture.click('#reader-settings');fixture.click('[data-play]');expect(fixture.events).toEqual([]);native.free()
})
it('falls back without retaining a host strongly through an unsupported WeakRef',()=>{
 vi.stubGlobal('WeakRef',undefined);const fixture=setup(true);expect(fixture.controls).toBeInstanceOf(LegacyReaderControls)
 fixture.click('[data-play]');expect(fixture.events).toEqual([['play']])
})
it('removes partial listeners if construction fails before reaching the last shortcut',()=>{
 const fixture=setup(true);fixture.controls.free();document.querySelector('#reader-more-shortcut').remove()
 expect(()=>new ui.RustReaderControls(()=>fixture.host,fixture.panel,fixture.host.miniPlayer)).toThrow()
 fixture.click('[data-play]');fixture.click('#reader-settings');expect(fixture.events).toEqual([])
})
it('keeps keyboard navigation inside visible tabs and ignores unrelated keys',()=>{
 const {host,controls,panel}=setup(true),tabs=[...panel.querySelectorAll('[data-place-tab]')];tabs[0].hidden=true
 tabs[1].focus();tabs[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(tabs[1])
 tabs[1].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(tabs.at(-1))
 tabs.at(-1).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(tabs[1])
 tabs[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(tabs.at(-1))
 const unrelated=new KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true});tabs.at(-1).dispatchEvent(unrelated);expect(unrelated.defaultPrevented).toBe(false);controls.free()
})
it('does not close for a child click or an inside-panel click',()=>{
 const {panel,events,controls}=setup(true);panel.dispatchEvent(new MouseEvent('click',{clientX:20,clientY:20,bubbles:true}))
 panel.querySelector('h2').dispatchEvent(new MouseEvent('click',{clientX:5,clientY:5,bubbles:true}));expect(events).toEqual([]);controls.free()
})
it('returns WASM listener allocations on repeated creation and disposal',()=>{
 for(let round=0;round<2;round++){
  const before=core.memory.buffer.byteLength
  for(let i=0;i<100;i++){const {controls,click}=setup(true);click('[data-play]');controls.free()}
  if(round)expect(core.memory.buffer.byteLength).toBe(before)
 }
})

it('keeps onclick properties and leaves a later replacement intact on disposal',()=>{
 const {controls,find,events}=setup(true),button=find('#reader-toc-shortcut')
 expect(button.onclick).toBeTypeOf('function');button.onclick(new MouseEvent('click'));expect(events).toContainEqual(['show','navigation'])
 const replacement=vi.fn();button.onclick=replacement;controls.free();expect(button.onclick).toBe(replacement);button.click();expect(replacement).toHaveBeenCalledOnce()
})

it('cloned panel fixture keeps the original HTML and default control state',()=>{
 const parsed=document.createElement('dialog'),cloned=document.createElement('dialog')
 parsed.innerHTML=readerPanelMarkup;cloned.append(panelTemplate.content.cloneNode(true))
 expect(cloned.innerHTML).toBe(parsed.innerHTML)
 const values=panel=>[...panel.querySelectorAll('input,select,button,textarea')].map(node=>({tag:node.tagName,type:node.type,value:node.value,checked:node.checked,disabled:node.disabled,selectedIndex:node.selectedIndex}))
 expect(values(cloned)).toEqual(values(parsed))
})

it('adopts late Rust controls without replacing nodes, focus or selection or duplicating actions',()=>{
 const {controls,host,panel,find,click,change,events}=setup(false)
 const input=find('[data-search-query]');input.value='Keep this text';input.focus();input.setSelectionRange(2,6)
 runtime.ui=ui;notifyRustUIReady(ui)
 expect(controls.native).toBeInstanceOf(ui.RustReaderControls)
 expect(host.panel).toBe(panel);expect(document.activeElement).toBe(input);expect([input.selectionStart,input.selectionEnd]).toEqual([2,6])
 events.length=0;click('#reader-settings');change('[data-rate][value="1.5"]',true);change('[data-progress]',50)
 expect(events).toEqual([['show','appearance'],['setPreference','rate','1.5'],['jump',{fraction:0.5,locator:null}]])
 controls.free();controls.free();events.length=0;click('#reader-settings');change('[data-rate][value="2"]',true);expect(events).toEqual([])
})
it('never resurrects a disposed fallback when the module becomes available',()=>{
 const {controls,events,click,change}=setup(false);controls.free()
 runtime.ui=ui;notifyRustUIReady(ui);expect(controls.native).toBeNull()
 click('[data-play]');change('[data-rate][value="2"]',true);expect(events).toEqual([])
})
it('does not let a detached old reader bind shortcuts belonging to a new book',()=>{
 const old=setup(false);const current=setup(true)
 runtime.ui=ui;notifyRustUIReady(ui);current.click('[data-play]')
 expect(old.events).toEqual([]);expect(current.events).toEqual([['play']]);expect(old.controls.native).toBeNull();current.controls.free()
})
it('restores working legacy handlers after partial native adoption fails',()=>{
 const {controls,events,click,change,find}=setup(false)
 notifyRustUIReady({RustReaderControls:class{constructor(){find('[data-play]').onclick=()=>{throw Error('partial')};throw Error('unavailable')}}})
 click('[data-play]');change('[data-rate][value="2"]',true)
 expect(events).toEqual([['play'],['setPreference','rate','2']]);controls.free()
})
it('releases every native callback after 25 late adoptions and disposals',()=>{
 const first=setup(false);notifyRustUIReady(ui);first.click('[data-play]');first.controls.free()
 const baseline=ui.ui_live_handles()
 for(let i=0;i<25;i++){const {controls,click}=setup(false);notifyRustUIReady(ui);click('[data-play]');controls.free()}
 expect(ui.ui_live_handles()).toBe(baseline)
})
