// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {rustShelf} from './helpers/rust-shelf-ready.js'
import {persistablePosition,persistableRelocation} from '../../src/js/readers/persistable-position.js'

describe('committed reading anchors survive incomplete layout notifications',()=>{
  it('keeps a real EPUB anchor and fraction',()=>{
    expect(persistableRelocation({fraction:.6,cfi:'epubcfi(/6/8!/4/2)'},'foliate')).toEqual({fraction:.6,locator:{kind:'cfi',value:'epubcfi(/6/8!/4/2)'}})
  })
  it.each([undefined,null,'',{},'   '])('does not commit an incomplete CFI %j',cfi=>{
    expect(persistableRelocation({fraction:0,cfi,index:0},'foliate')).toBeNull()
  })
  it('keeps PDF page and adaptive text offset without confusing a Foliate section for a PDF page',()=>{
    expect(persistableRelocation({fraction:.7,index:3,textOffset:212},'pdf')).toEqual({fraction:.7,locator:{kind:'pdf-page',value:4,textOffset:212}})
    expect(persistableRelocation({fraction:.7,index:3,textOffset:212},'foliate')).toBeNull()
  })
  it('rejects an incomplete snapshot instead of erasing the current saved page',()=>{
    let saved={fraction:.6,locator:{kind:'cfi',value:'epubcfi(/6/8!/4/2)'}}
    const original=saved
    const position=persistablePosition({fraction:0,locator:null})
    if(position)saved=position
    expect(saved).toBe(original)
    expect(persistablePosition({fraction:NaN,locator:original.locator})).toBeNull()
  })
  it('retains valid page one and bounds the fraction',()=>{
    expect(persistablePosition({fraction:-.1,locator:{kind:'pdf-page',value:1,textOffset:0}})).toEqual({fraction:0,locator:{kind:'pdf-page',value:1}})
    expect(persistablePosition({fraction:1.1,locator:{kind:'pdf-page',value:1}}).fraction).toBe(1)
    expect(persistablePosition({fraction:0,locator:{kind:'pdf-page',value:0}})).toBeNull()
  })
  it('guards actual relocation writes while keeping reader notifications',async()=>{
    const source=readFileSync('src/js/app.js','utf8'),start=source.indexOf('function onReaderRelocate(')
    const code=source.slice(start,source.indexOf('\nconst readerRuntimeHost',start))
    const writes=[];let notices=0
    const env={els:{readerProgressFill:{style:{}}},readingExperience:{relocate:()=>notices++},currentBookId:'book',restoringProgress:false,closingReader:false,reader:{format:{engine:'foliate'}},persistableRelocation,progressWrites:{updateProgress:(...args)=>{writes.push(args);return Promise.resolve()}},console}
    env.bookDataModule=()=>rustShelf;env.readerRuntimeHost={...env,state:env,warnReaderProgress:error=>env.console.warn('No se pudo guardar el progreso:',error)}
    const relocate=new Function('env',`with(env){return (${code})}`)(env)
    relocate({fraction:0,cfi:null,index:0});relocate({fraction:.6,cfi:'epubcfi(/6/8!/4/2)'})
    await Promise.resolve();expect(notices).toBe(2);expect(writes).toEqual([['book',.6,{kind:'cfi',value:'epubcfi(/6/8!/4/2)'}]])
  })
  it('guards real native closing writes and never waits for a pending cloud request',async()=>{
    const committed={fraction:.6,locator:{kind:'cfi',value:'epubcfi(/6/8!/4/2)'}}
    for(const location of [{fraction:0,locator:null},{fraction:NaN,locator:committed.locator},committed]){
      const writes=[],scheduled=[],flushes=[]
      const host={state:{currentBookId:'book',closingReader:false,shelf:null,cloudRoomChanged:false},coverUpgrades:new Map(),preparedBooks:new Map(),progressWrites:new Map(),
        reader:{getPageSnapshot:async()=>({location}),close(){}},readingExperience:{closeVoice(){},panel:{close(){}},reset(){}},
        library:{updateProgress:async(...args)=>writes.push(args),get:async()=>({id:'book'})},
        cloudSync:{scheduleProgress:id=>scheduled.push(id),flushProgress:id=>{flushes.push(id);return new Promise(()=>{})}},
        document:{body:{classList:{add(){},remove(){}}}},els:{readerToolbar:{hidden:false}},
        persistablePosition,hasDriveSession:()=>true,isBookLengthReady:()=>false,supersedePreparation(){},showScreen(){},refreshShelf:async()=>{},ignoreCloseError(){},
        closeProgressFlush:id=>()=>rustShelf.app_flush_closed_progress(host,id),warnClosedProgress:error=>{throw error},console}
      await rustShelf.app_close_reader(host)
      expect(writes).toEqual(location===committed?[['book',.6,committed.locator]]:[])
      expect(scheduled).toEqual(location===committed?['book']:[]);expect(flushes).toEqual(['book'])
      expect(host.state.currentBookId).toBeNull();expect(host.state.closingReader).toBe(false)
    }
  })
})
