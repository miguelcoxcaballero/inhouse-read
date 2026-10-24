import {readFileSync} from 'node:fs'
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {rustShelf} from './helpers/rust-shelf-ready.js'
const runtime=vi.hoisted(()=>({ui:null,shelf:null,core:null,gate:null,loads:0,built:0,constructorError:null,events:[]}))
vi.mock('../../src/js/rust-ui.js',()=>({
 getRustUI:()=>runtime.ui,
 requireRustUI:()=>{runtime.loads++;return runtime.gate?runtime.gate.then(()=>runtime.core):Promise.resolve(runtime.core)},
 loadRustUI:()=>Promise.resolve(runtime.core)
}))
vi.mock('../../src/js/rust-shelf.js',async original=>({...await original(),getRustShelf:()=>runtime.shelf}))
vi.mock('../../src/js/readers/reader-experience.js',()=>({ReaderExperience:class{
 constructor(reader,options){
  runtime.built++;if(runtime.constructorError)throw runtime.constructorError
  this.reader=reader;this.options=options;this.preferences={theme:'sepia'}
  this.panel={open:false,close:()=>runtime.events.push(['panel-close'])}
  this.voice={stop:()=>runtime.events.push(['voice-stop'])}
 }
 closeVoice(){runtime.events.push(['close-voice'])}
 reset(){runtime.events.push(['reset']);return 'discarded'}
 relocate(){runtime.events.push(['relocate']);return 'discarded'}
 step(direction){runtime.events.push(['step',direction]);return direction}
 jump(place,target){runtime.events.push(['jump',place,target]);return target}
 refreshNames(id,fields){runtime.events.push(['names',id,fields]);return 'discarded'}
 open(record){runtime.events.push(['open',record.id]);return Promise.resolve(record)}
}}))
import {ReaderExperience} from '../../src/js/readers/reader-experience.js'
import {createLazyReaderExperience} from '../../src/js/readers/reader-experience-lazy.js'
import {normalizeReadingPreferences} from '../../src/js/readers/reading-preferences.js'
import {requireRustUI} from '../../src/js/rust-ui.js'
import {reloadOnceAfterChunkFailure} from '../../src/js/chunk-recovery.js'
import {referenceLazyExperience} from './helpers/reference-reader-experience-lazy.js'
const legacy=referenceLazyExperience({normalizeReadingPreferences,requireRustUI,reloadOnceAfterChunkFailure,loadReader:()=>Promise.resolve({ReaderExperience})})
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve()}
let reload
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}))
beforeEach(()=>{
 Object.assign(runtime,{ui:null,shelf:null,core:ui,gate:null,loads:0,built:0,constructorError:null,events:[]})
 localStorage.clear();sessionStorage.clear();reload=vi.fn();vi.stubGlobal('location',{...window.location,reload})
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
describe.each(['bootstrap','shelf','ui'])('lazy reader from %s',start=>{
 const begin=()=>{runtime.shelf=start==='shelf'?rustShelf:null;runtime.ui=start==='ui'?ui:null}
 it('does no load, constructor or voice work for idle controls and preferences',()=>{
  begin();localStorage.setItem('inhouse-read-reading-preferences','{"theme":"amoled","fontSize":25}')
  const lazy=createLazyReaderExperience({},{}),panel=lazy.panel,voice=lazy.voice
  expect(lazy.loaded).toBe(false);expect(lazy.panel).toBe(panel);expect(lazy.voice).toBe(voice);expect(lazy.preferences).toMatchObject({theme:'amoled',fontSize:25})
  lazy.closeVoice();lazy.reset();lazy.relocate();lazy.reloadPreferences();lazy.refreshNames('a',{});expect(lazy.step(1)).toBeUndefined();expect(lazy.jump(null,'x')).toBeUndefined()
  panel.close();voice.stop();expect(runtime.loads).toBe(0);expect(runtime.built).toBe(0);expect(runtime.events).toEqual([]);expect(reload).not.toHaveBeenCalled()
 })
 it('adopts the same in-flight Promise without constructing a reader early',async()=>{
  begin();const gate=deferred();runtime.gate=gate.promise
  const reader={},options={},lazy=createLazyReaderExperience(reader,options),first=lazy.ready()
  expect(lazy.ready()).toBe(first);lazy.closeVoice();expect(runtime.loads).toBe(1);expect(runtime.built).toBe(0)
  runtime.shelf=rustShelf;expect(lazy.ready()).toBe(first);runtime.ui=ui;expect(lazy.ready()).toBe(first)
  gate.resolve();const experience=await first
  expect(experience.reader).toBe(reader);expect(experience.options).toBe(options);expect(lazy.loaded).toBe(true)
  expect(lazy.ready()).toBe(first);expect(await lazy.prefetch()).toBe(experience);expect(runtime.loads).toBe(1);expect(runtime.built).toBe(1)
  expect(lazy.panel).toBe(experience.panel);expect(lazy.voice).toBe(experience.voice)
 })
 it('preserves exact delegation results and method ownership after readiness',async()=>{
  begin();const lazy=createLazyReaderExperience({},{}),experience=await lazy.ready(),record={id:'a'},place={fraction:.4}
  expect(await lazy.open(record)).toBe(record);expect(lazy.reset()).toBeUndefined();expect(lazy.relocate()).toBeUndefined()
  expect(lazy.step(-1)).toBe(-1);expect(lazy.jump(place,'chapter')).toBe('chapter');expect(lazy.refreshNames('a',{title:'Updated'})).toBeUndefined()
  lazy.closeVoice();experience.closeVoice=null;lazy.closeVoice();experience.voice=null;lazy.closeVoice();experience.refreshNames=null;lazy.refreshNames('a',{})
  expect(runtime.events).toEqual([['open','a'],['reset'],['relocate'],['step',-1],['jump',place,'chapter'],['names','a',{title:'Updated'}],['close-voice'],['voice-stop']])
 })
 it('retains saved preference recovery and refresh after readiness',async()=>{
  begin();localStorage.setItem('inhouse-read-reading-preferences','invalid')
  const lazy=createLazyReaderExperience({},{});expect(lazy.preferences).toEqual(normalizeReadingPreferences())
  const experience=await lazy.ready();expect(lazy.preferences).toBe(experience.preferences)
  localStorage.setItem('inhouse-read-reading-preferences','{"theme":"night","rate":1.6}')
  lazy.reloadPreferences();expect(lazy.preferences).toMatchObject({theme:'night',rate:1.5})
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked')});lazy.reloadPreferences();expect(lazy.preferences).toEqual(normalizeReadingPreferences())
 })
 it('preserves missing-core failure and a successful retry without creating twice',async()=>{
  begin();runtime.core=null;const lazy=createLazyReaderExperience({},{}),first=lazy.ready()
  await expect(first).rejects.toThrow('Rust UI is unavailable');expect(lazy.loaded).toBe(false);expect(runtime.built).toBe(0);expect(reload).toHaveBeenCalledOnce()
  runtime.core=ui;const retry=lazy.ready();expect(retry).not.toBe(first);await retry;expect(runtime.loads).toBe(2);expect(runtime.built).toBe(1)
 })
 it('keeps constructor failures visible and can retry after one-time recovery',async()=>{
  begin();const failure=Error('constructor failed');runtime.constructorError=failure;const lazy=createLazyReaderExperience({},{})
  await expect(lazy.ready()).rejects.toBe(failure);expect(lazy.loaded).toBe(false);expect(reload).toHaveBeenCalledOnce()
  runtime.constructorError=null;await lazy.ready();expect(runtime.built).toBe(2);expect(lazy.loaded).toBe(true)
 })
 it.each(['prefetch','ready'])('retains the first caller’s reload policy while %s is in flight',async first=>{
  begin();const gate=deferred();runtime.gate=gate.promise;const failure=Error('network'),lazy=createLazyReaderExperience({},{})
  const prefetch=first==='prefetch'?lazy.prefetch():null,ready=lazy.ready(),second=prefetch||lazy.prefetch()
  const rejected=expect(ready).rejects.toBe(failure);runtime.ui=ui;gate.reject(failure)
  await rejected;expect(await second).toBeNull();expect(runtime.loads).toBe(1);expect(runtime.built).toBe(0)
  expect(reload).toHaveBeenCalledTimes(first==='ready'?1:0)
 })
})
it('matches the frozen facade through opening, preference refresh and delegation',async()=>{
 const outputs=[]
 for(const create of [legacy,createLazyReaderExperience]){
  Object.assign(runtime,{ui:ui,shelf:rustShelf,loads:0,built:0,events:[]})
  const lazy=create({},{}),before={loaded:lazy.loaded,preferences:lazy.preferences,panel:lazy.panel.open},experience=await lazy.ready()
  await lazy.open({id:'book'});lazy.reset();lazy.relocate();const step=lazy.step(1),jump=lazy.jump({fraction:.2},'next');lazy.closeVoice()
  experience.closeVoice=null;lazy.closeVoice();localStorage.setItem('inhouse-read-reading-preferences','{"theme":"amoled"}');lazy.reloadPreferences()
  outputs.push({before,step,jump,events:runtime.events,preferences:lazy.preferences,loads:runtime.loads,built:runtime.built})
  localStorage.clear()
 }
 expect(outputs[1]).toEqual(outputs[0])
})
it('preserves host-only recovery when every native module is unavailable',async()=>{
 runtime.core=null;runtime.ui=null;runtime.shelf=null
 const lazy=createLazyReaderExperience({},{})
 expect(await lazy.prefetch()).toBeNull();expect(reload).not.toHaveBeenCalled()
 await expect(lazy.ready()).rejects.toThrow('Rust UI is unavailable');expect(reload).toHaveBeenCalledOnce()
})
it('retains no native callbacks or handles through completed and rejected loads',async()=>{
 runtime.ui=ui;runtime.shelf=rustShelf
 async function cycle(){
  const lazy=createLazyReaderExperience({},{});await lazy.ready();lazy.closeVoice();lazy.reset();lazy.reloadPreferences()
  runtime.constructorError=Error('closed');const failed=createLazyReaderExperience({},{});await failed.prefetch();runtime.constructorError=null;await failed.ready();await flush()
 }
 await cycle();const handles=ui.ui_live_handles(),shelfHandles=rustShelf.shelf_live_handles()
 for(let n=0;n<100;n++)await cycle()
 expect(ui.ui_live_handles()).toBe(handles);expect(rustShelf.shelf_live_handles()).toBe(shelfHandles)
})
