import {afterEach,beforeAll,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {readerPanelMarkup} from '../../src/js/readers/reader-interface.js'
import {LegacyReaderView} from '../../src/js/readers/reader-view-legacy.js'
import {ReaderView} from '../../src/js/readers/reader-view.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
afterEach(()=>{document.body.innerHTML='';runtime.ui=null})
function setup(native){
 document.body.innerHTML='<section id="reader-screen"><button id="reader-location"><span class="reader-location-label"></span></button><b id="reader-top-title"></b><i id="reader-top-byline"></i></section>'
 const screen=document.querySelector('section'),panel=document.createElement('dialog'),mini=document.createElement('div'),back=document.createElement('button');panel.innerHTML=readerPanelMarkup;document.body.append(panel);mini.innerHTML='<span data-mini-title></span>';screen.append(mini,back)
 const view=native?new ui.RustReaderView(screen,panel,mini,back):new LegacyReaderView(screen,panel,mini,back)
 return {view,screen,panel,mini,back,range:panel.querySelector('[data-progress]'),page:panel.querySelector('input[type="number"]')}
}
it('preserves document information, format controls, Unicode and in-progress edits exactly',()=>{
 for(let trial=0;trial<200;trial++){
  const output=[]
  for(const native of [false,true]){
   const {view,range,page}=setup(native),title=['Libro','<img onerror=x>','字 📖','العَرَبِيَّة','\ud800'][trial%5],label=`Page ${trial}`
   view.setDocumentInfo(title,'Author','About '+title,trial%2===0);view.configureFormat(trial%2===0,10)
   range.value='13';page.value='9';if(trial%3===0)range.focus();if(trial%3===1)page.focus()
   view.relocate(label,'short '+title,trial%100,trial%2===0,3)
   output.push({html:document.body.innerHTML,range:range.value,page:page.value});view.free?.()
  }
  expect(output[1]).toEqual(output[0])
 }
})
it('rebinds a replaced location button and header without writing into detached nodes',()=>{
 const {view}=setup(true);view.relocate('One','1',0,true,1)
 const old=document.querySelector('#reader-location'),replacement=old.cloneNode(true);old.replaceWith(replacement)
 const title=document.querySelector('#reader-top-title'),newTitle=title.cloneNode(true);title.replaceWith(newTitle)
 view.relocate('Two','2',50,true,2);view.setDocumentInfo('New','Author','About',true)
 expect(old.title).toBe('One');expect(replacement.title).toBe('Two');expect(replacement.textContent).toBe('2');expect(newTitle.textContent).toBe('New');expect(title.textContent).toBe('');view.free()
})
it('restores location text even if the location itself did not change',()=>{
 const {view,panel}=setup(true);view.relocate('Page 2','2',25,true,2)
 panel.querySelector('.reading-position').textContent='90%';view.relocate('Page 2','2',25,true,2)
 expect(panel.querySelector('.reading-position').textContent).toBe('Page 2');view.free()
})
it('allows an absent mini title and does not overwrite it during initial document setup',()=>{
 const {view,mini}=setup(true);view.setDocumentInfo('Initial','Author','About',false);expect(mini.textContent).toBe('')
 mini.innerHTML='';expect(()=>view.setDocumentInfo('Updated','Author','About',true)).not.toThrow();view.free()
})
it('uses the compatible view when an older module lacks the new methods',()=>{
 const {view,screen,panel,mini,back}=setup(false)
 runtime.ui={RustReaderView:class OldView{}};expect(new ReaderView(screen,panel,mini,back)).toBeInstanceOf(LegacyReaderView)
 runtime.ui=ui;const next=new ReaderView(screen,panel,mini,back);expect(next).toBeInstanceOf(ui.RustReaderView);next.free()
})
it('keeps WASM memory bounded while changing titles and positions repeatedly',()=>{
 for(let round=0;round<2;round++){
  const before=core.memory.buffer.byteLength,{view}=setup(true)
  for(let i=0;i<1000;i++){view.setDocumentInfo('Title '+i,'Author '+i,'About '+i,true);view.configureFormat(Boolean(i%2),100);view.relocate('Page '+i,''+i,i%100,true,i+1)}
  view.free();if(round)expect(core.memory.buffer.byteLength).toBe(before)
 }
})
