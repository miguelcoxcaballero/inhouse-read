import assert from 'node:assert/strict'
import {it,vi,expect,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {displayBookTitle,normalizeBookAuthor} from '../../src/js/book-title.js'
import {cleanPlaces,cleanQuotes} from '../../src/js/readers/reading-state.js'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {LegacyReaderLifecycle} from './helpers/reference-reader-lifecycle.js'
const fixture=vi.hoisted(()=>({engine:null}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralEngine:()=>fixture.engine}))
afterEach(()=>{document.body.innerHTML=''})
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
function setup(native,trial){
 document.body.innerHTML='<section class="reader-kids-mode"><button id="return"></button></section><dialog><button data-kids></button><button data-close></button></dialog>'
 const host=new LegacyReaderLifecycle(),events=[],engine={release:()=>{events.push(['release']);if(trial%5===0)throw Error('release failed')}};fixture.engine=engine
 host.formatSize=(bytes=0)=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`
 host.screen=document.querySelector('section');host.returnButton=document.querySelector('#return');host.panel=document.querySelector('dialog')
 host.panel.close=()=>{events.push(['close',host.book?.id]);host.panel.open=false};host.panel.showModal=()=>{events.push(['modal']);host.panel.open=true}
 host.voice={stop:()=>events.push(['stop'])};host.neuralPicker={cancelWarm:()=>events.push(['cancelWarm']),warm:()=>events.push(['warm']),refresh:()=>events.push(['refresh'])}
 host.view={setDocumentInfo:(...args)=>events.push(['document',...args]),configureFormat:(...args)=>events.push(['format',...args])}
 host.reader={format:trial%2?{engine:'pdf'}:null,pageCount:trial%3?4:0,addQuoteAnnotation:quote=>events.push(['quote',quote])}
 for(const name of ['cancelNavigation','renderPlaces','renderToc','relocate','endSearch','syncReturnLayout','updateMiniPlayer','resizePanel','populateVoices'])host[name]=()=>events.push([name])
 host.showTab=tab=>events.push(['tab',tab]);host.keepSearchHits=true
 let complete;host.applyPreferences=()=>{events.push(['preferences']);return new Promise((resolve,reject)=>{complete=()=>trial%7===0?reject(Error('apply failed')):resolve()})}
 if(native){
  const describe=record=>{const title=displayBookTitle(record),author=normalizeBookAuthor(record.author)||normalizeBookAuthor(record.metadata?.creator);return [title,author,`${title}${author?` · ${author}`:''}\n${record.format||'Documento'} · ${host.formatSize(record.sizeBytes)}`]}
  host.open=async record=>ui.reader_open(host,record,cleanPlaces,cleanQuotes,describe)
  host.refreshNames=(id,fields)=>ui.reader_refresh_names(host,id,fields,describe)
  host.closeVoice=()=>ui.reader_close_voice(host,()=>engine);host.reset=()=>ui.reader_reset(host);host.show=tab=>ui.reader_show(host,tab)
 }
 return {host,events,complete:()=>complete()}
}
it('preserves synchronous preparation, completed effects and DOM through 200 reader lifecycles',async()=>{
let checks=0
for(let trial=0;trial<200;trial++){
 const outputs=[]
 for(const native of [false,true]){
  const {host,events,complete}=setup(native,trial)
  const record={id:trial%2?`${trial}`:trial,title:['A book','字 📖','العَرَبِيَّة','<img onerror=x>'][trial%4],author:trial%2?{name:'Author'}:undefined,metadata:{creator:[{name:'Writer'}]},format:'PDF',sizeBytes:trial*12500,readingHistory:[{fraction:.2,locator:{kind:'pdf-page',value:2}}],bookmarks:[],quotes:[{id:'quote',text:'Some text',fraction:.3}]}
  const opening=host.open(record);const synchronous=structuredClone(events);assert.equal(host.book,record);complete();let error='';try{await opening}catch(e){error=e.message}
  host.refreshNames('wrong',{title:'Wrong'});host.refreshNames(String(trial),{title:'Updated',author:'Other author'})
  host.show(trial%2?'audio':'appearance');host.screen.setAttribute('aria-busy','true');host.show('audio');host.screen.removeAttribute('aria-busy')
  host.closeVoice();host.reset()
  outputs.push({synchronous,error,events,html:document.body.innerHTML,book:host.book,history:host.history,bookmarks:host.bookmarks,quotes:host.quotes,keep:host.keepSearchHits})
 }
 assert.deepEqual(outputs[1],outputs[0]);checks++
}
})
it('releases book preparation handles through repeated open and close cycles',async()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let i=0;i<100;i++){const {host,complete}=setup(true,1),pending=host.open({id:i,title:'Book',quotes:[]});complete();await pending;host.closeVoice();host.reset()}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}
})
it('compares identifiers with their exact UTF-16 string values',()=>{
 const {host,events}=setup(true,1);host.book={id:'\ud800',title:'Original'}
 host.refreshNames('\ud801',{title:'Wrong'});expect(events).toEqual([]);expect(host.book.title).toBe('Original')
 host.refreshNames('\ud800',{title:'Correct'});expect(host.book.title).toBe('Correct');expect(events[0][0]).toBe('document')
})
it('preserves partial assignment and the exact error when a metadata getter fails',()=>{
 const {host,events}=setup(true,1);host.book={id:'1',title:'Original'};const failure=Error('metadata')
 const fields={title:'Changed',get author(){throw failure}}
 expect(()=>host.refreshNames(1,fields)).toThrow(failure);expect(host.book.title).toBe('Changed');expect(events).toEqual([])
})
it('releases the voice engine only on explicit voice close, after stopping playback',()=>{
 const {host,events}=setup(true,1);host.book={id:'book'};host.reset();expect(events.some(row=>row[0]==='release')).toBe(false)
 events.length=0;host.closeVoice();expect(events).toEqual([['cancelWarm'],['stop'],['release']])
})
