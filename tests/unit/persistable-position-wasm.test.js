// @vitest-environment node
import './helpers/rust-ui-ready.js'
import {describe,expect,it} from 'vitest'
import {persistablePosition,persistableRelocation} from '../../src/js/readers/persistable-position.js'
import * as original from './helpers/reference-persistable-position.js'

// The compiled rule is compared with the frozen original on every kind of value the browser can hand it, and the
// properties it reads are traced: a record with accessors must observe the same reads in the same order.
let seed=20261014
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
const pick=list=>list[Math.floor(random()*list.length)]
const FRACTIONS=[0,-0,.25,.5,1,-.1,1.1,1e-300,Number.MAX_VALUE,-Infinity,Infinity,NaN,'0.5','',null,undefined,true,{},[],[.5],1n,Symbol.iterator]
const VALUES=[0,1,2,3,41,-1,-0,.5,1e21,2**53,NaN,Infinity,'3','',' ','\t\n',' ','﻿',' epubcfi(/6/2) ','epubcfi(/6/8!/4/2)',null,undefined,true,[],{},1n]
const KINDS=['cfi','pdf-page','CFI','pdf','','section',null,undefined,1,{},['cfi']]
const OFFSETS=[undefined,null,0,-0,1,2,212,-5,1.5,NaN,Infinity,'7',2**40,{}]
const ENGINES=['pdf','foliate','PDF','',undefined,null,1]
const INDEXES=[0,-0,1,3,-1,1.5,NaN,Infinity,2**31,'2',null,undefined]

const GOOD_FRACTIONS=[0,-0,.25,.5,1,-.1,1.1,1e-300]
function locator(){
  if(random()<.1)return pick([null,undefined,0,'',[],'cfi',7,true])
  // Half of the records are the shapes an engine really reports, the rest are wrong in some way.
  if(random()<.5)return random()<.5?{kind:'cfi',value:pick(['epubcfi(/6/8!/4/2)',' x ','epubcfi(/6/2)'])}:{kind:'pdf-page',value:pick([1,2,41,2**40]),textOffset:pick(OFFSETS)}
  return{kind:pick(KINDS),value:pick(VALUES),textOffset:pick(OFFSETS)}
}
function location(){return random()<.05?pick([null,undefined,0,'',false,NaN,'text',7,true,[],()=>{}]):{fraction:random()<.5?pick(GOOD_FRACTIONS):pick(FRACTIONS),locator:locator()}}

// An accessor-backed copy of a record, logging every read.
function traced(record,log,path=''){
  if(record===null||typeof record!=='object')return record
  return new Proxy(record,{get(target,key,receiver){
    const value=Reflect.get(target,key,receiver)
    if(typeof key==='string')log.push(path+'.'+key)
    return key==='locator'?traced(value,log,path+'.locator'):value
  }})
}
const outcome=(run)=>{try{return{value:run()}}catch(error){return{error:error?.constructor?.name}}}

describe('persistablePosition',()=>{
  it('matches the original on a large corpus, including accessors read in the same order',()=>{
    let kept=0,dropped=0
    for(let round=0;round<20000;round++){
      const source=location(),actualLog=[],expectedLog=[]
      const actual=outcome(()=>persistablePosition(traced(source,actualLog)))
      const expected=outcome(()=>original.persistablePosition(traced(source,expectedLog)))
      expect(actual,`round ${round}`).toEqual(expected)
      expect(actualLog,`reads of round ${round}`).toEqual(expectedLog)
      if(actual.value)kept++;else dropped++
    }
    expect(kept).toBeGreaterThan(500);expect(dropped).toBeGreaterThan(500)
  })
  it('returns fresh plain objects with the original key order and no extra keys',()=>{
    for(const source of [{fraction:.5,locator:{kind:'cfi',value:'epubcfi(/6/2)',extra:1}},{fraction:.5,locator:{kind:'pdf-page',value:3,textOffset:9,extra:1}},{fraction:.5,locator:{kind:'pdf-page',value:3}}]){
      const actual=persistablePosition(source),expected=original.persistablePosition(source)
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
      expect(Object.keys(actual)).toEqual(Object.keys(expected));expect(Object.keys(actual.locator)).toEqual(Object.keys(expected.locator))
      expect(actual.locator).not.toBe(source.locator)
    }
  })
  it('keeps the sign of a zero fraction like Math.max/Math.min',()=>{
    for(const fraction of [0,-0,-1e-320]){
      const actual=persistablePosition({fraction,locator:{kind:'cfi',value:'x'}}).fraction,expected=original.persistablePosition({fraction,locator:{kind:'cfi',value:'x'}}).fraction
      expect(Object.is(actual,expected)).toBe(true)
    }
  })
})

describe('persistableRelocation',()=>{
  it('matches the original on a large corpus',()=>{
    let kept=0
    for(let round=0;round<20000;round++){
      const notice={fraction:pick(FRACTIONS),cfi:pick(VALUES),index:pick(INDEXES),textOffset:pick(OFFSETS)}
      if(random()<.1)delete notice.cfi
      const engine=pick(ENGINES),actualLog=[],expectedLog=[]
      const actual=outcome(()=>persistableRelocation(traced(notice,actualLog),engine))
      const expected=outcome(()=>original.persistableRelocation(traced(notice,expectedLog),engine))
      expect(actual,`round ${round}`).toEqual(expected)
      expect(actualLog,`reads of round ${round}`).toEqual(expectedLog)
      if(actual.value)kept++
    }
    expect(kept).toBeGreaterThan(300)
  })
  it('refuses a missing notice like the destructuring parameter it replaces',()=>{
    for(const notice of [undefined,null]){
      expect(()=>original.persistableRelocation(notice,'pdf')).toThrow(TypeError)
      expect(()=>persistableRelocation(notice,'pdf')).toThrow(TypeError)
    }
  })
})
