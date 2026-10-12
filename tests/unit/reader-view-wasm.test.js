import {beforeAll,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {initSync,RustReaderView} from '../../src/wasm/ui/inhouse_read_ui.js'
import {readerPanelMarkup,readerIcon} from '../../src/js/readers/reader-interface.js'
import {DEFAULT_READING_PREFERENCES,READING_THEMES} from '../../src/js/readers/reading-preferences.js'
let core,views=[]
beforeAll(()=>{core=initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
afterEach(()=>{const owned=views.splice(0);try{for(const view of owned)view.free()}finally{vi.restoreAllMocks();document.body.replaceChildren()}})
function make(){
 document.body.innerHTML='<header class="app-header"></header><main><div id="screen"></div></main><button id="reader-settings"></button><button id="reader-location"></button><button id="reader-audio"></button><button id="reader-save-bookmark"></button>'
 const screen=document.querySelector('#screen'),panel=document.createElement('dialog'),mini=document.createElement('div'),back=document.createElement('button')
 panel.innerHTML=readerPanelMarkup;mini.innerHTML='<span data-mini-title></span><span data-mini-status></span><button data-mini-play></button>';document.body.append(panel);screen.append(mini,back)
 const view=new RustReaderView(screen,panel,mini,back);return{view,screen,panel,mini,back}
}
it('only rewrites changed preferences and restores the shared header when reopening the same theme',()=>{
 const {view,panel}=make();views.push(view);const p={...DEFAULT_READING_PREFERENCES,theme:'night'}
 const size=panel.querySelector('[data-pref=fontSize]'),font=panel.querySelector('[data-pref=font]')
 const sizeWrites=vi.spyOn(HTMLInputElement.prototype,'value','set'),fontWrites=vi.spyOn(HTMLSelectElement.prototype,'value','set')
 const writes=(spy,node)=>spy.mock.contexts.filter(target=>target===node).length
 view.applyPreferences(p,READING_THEMES.night,false);expect(writes(sizeWrites,size)).toBe(1);expect(writes(fontWrites,font)).toBe(1)
 delete document.querySelector('.app-header').dataset.readingTheme
 view.applyPreferences(p,READING_THEMES.night,false);expect(writes(sizeWrites,size)).toBe(1);expect(writes(fontWrites,font)).toBe(1);expect(document.querySelector('.app-header').dataset.readingTheme).toBe('night')
 view.applyPreferences({...p,fontSize:26},READING_THEMES.night,false);expect(writes(sizeWrites,size)).toBe(2);expect(writes(fontWrites,font)).toBe(1);expect(size.value).toBe('26')
})
it('updates format-specific visibility even when every saved preference stays the same',()=>{
 const {view,panel}=make();views.push(view);const p={...DEFAULT_READING_PREFERENCES}
 view.applyPreferences(p,READING_THEMES.paper,true);expect(panel.querySelector('[data-typography]').hidden).toBe(true)
 view.applyPreferences(p,READING_THEMES.paper,false);expect(panel.querySelector('[data-typography]').hidden).toBe(false);expect(panel.querySelector('[data-pdf-zoom]').hidden).toBe(true)
})
it('releases cached nodes and preferences without permanently interning book text',()=>{
 const cycle=i=>{const {view}=make();view.applyPreferences(DEFAULT_READING_PREFERENCES,READING_THEMES.paper,false);view.showTab('audio');view.showPlaceTab('bookmarks');view.updateMiniPlayer('playing','Unique message '+i,'Unique title '+i,'1×',true,readerIcon('pause'));view.free()}
 for(let i=0;i<30;i++)cycle(i);const memory=core.memory.buffer.byteLength
 for(let i=30;i<230;i++)cycle(i)
 expect(core.memory.buffer.byteLength).toBe(memory)
 // This is a disposal stress test (230 complete dialogs in jsdom), not an
 // interaction-latency assertion. Keep every cycle and exact memory comparison.
},15000)
it('propagates a host setter error without leaving the Rust view borrowed or unusable',()=>{
 const {view,panel}=make();views.push(view);const failure=new Error('Host refused control write'),button=panel.querySelector('[data-size-step="-1"]')
 Object.defineProperty(button,'disabled',{configurable:true,set(){throw failure}})
 expect(()=>view.applyPreferences(DEFAULT_READING_PREFERENCES,READING_THEMES.paper,false)).toThrow(failure)
 delete button.disabled;view.applyPreferences(DEFAULT_READING_PREFERENCES,READING_THEMES.paper,false)
 expect(panel.querySelector('[data-pref=fontSize]').value).toBe('20')
})
