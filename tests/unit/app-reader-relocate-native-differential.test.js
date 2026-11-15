import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {onReaderRelocate as reference} from './helpers/reference-app-reader-relocate.js';
import {persistableRelocation} from './helpers/reference-persistable-position.js';
const source=readFileSync('src/js/app.js','utf8'),start=source.indexOf('function onReaderRelocate('),actual=source.slice(start,source.indexOf('\nconst readerRuntimeHost',start));
const scope=(env,fn)=>new Function('env',`with(env){return (${typeof fn==='string'?fn:fn.toString()})}`)(env);
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve()};
async function run(native,event,options={},module=rustShelf){
 const events=[],env={currentBookId:options.noBook?null:'book:📖:\ud800',restoringProgress:!!options.restoring,closingReader:!!options.closing,
  els:{readerProgressFill:{style:{}}},reader:{format:options.noFormat?null:{engine:options.engine||'foliate'}},persistableRelocation,
  console:{warn:(label,error)=>events.push(['warning',label,error.message])},
  readingExperience:{relocate(){events.push(['relocate',this===env.readingExperience]);if(options.clearOnRelocate)env.currentBookId=null}},
  progressWrites:{updateProgress(...args){events.push(['write',...args,this===env.progressWrites]);if(options.throwWrite)throw Error('write');return options.rejectWrite?Promise.reject(Error('write')):Promise.resolve()}}
 };
 env.readerRuntimeHost={...env,state:env,warnReaderProgress:error=>env.console.warn('No se pudo guardar el progreso:',error)};env.bookDataModule=()=>module;
 let value,error;try{value=scope(env,native?actual:reference)(event)}catch(e){error=e.message}await flush();
 return{events,width:env.els.readerProgressFill.style.width,current:env.currentBookId,value,error};
}
const payloads=[{}, {fraction:0,cfi:null,index:0},{fraction:.6,cfi:'epubcfi(/6/8!/4/2)'},{fraction:.7,index:3,textOffset:212},
 {fraction:-0.005,index:0},{fraction:NaN,index:1},{fraction:Infinity,index:1},{fraction:null,index:0},{fraction:'0.333',index:0},
 {fraction:1.2,cfi:' \ufeffcfi:📖:\ud800 ',index:4}];
for(const options of [{},{engine:'pdf'},{noBook:true},{restoring:true},{closing:true},{clearOnRelocate:true},{noFormat:true},{throwWrite:true},{rejectWrite:true}])
 it(`matches relocation writes and UI notifications ${JSON.stringify(options)}`,async()=>{
  for(const payload of payloads)expect(await run(true,payload,options)).toEqual(await run(false,payload,options));
 });
it('supports the UI-only reader and preserves the CFI without a Shelf dependency',async()=>{
 const{rustUI}=await import('./helpers/rust-ui-ready.js');expect(await run(true,{fraction:.4,cfi:'cfi:📖:\ud800'}, {},rustUI)).toEqual(await run(false,{fraction:.4,cfi:'cfi:📖:\ud800'}));
});
it('releases native handles after successful, rejected and suppressed progress writes',async()=>{
 await run(true,payloads[2]);const before=rustShelf.shelf_live_handles();for(let n=0;n<60;n++)await run(true,payloads[2],[{}, {rejectWrite:true},{restoring:true}][n%3]);await flush();expect(rustShelf.shelf_live_handles()).toBe(before);
});
