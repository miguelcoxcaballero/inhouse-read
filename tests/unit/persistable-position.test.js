// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
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
  it('guards both application writes without changing reader relocation or waiting for cloud requests',()=>{
    const source=readFileSync(new URL('../../src/js/app.js',import.meta.url),'utf8')
    expect(source).toContain('persistableRelocation({ fraction, cfi, index, textOffset }, reader.format?.engine)')
    expect(source).toContain('persistablePosition(pageSnapshot?.location)')
    expect(source).toContain('library.updateProgress(bookId,position.fraction,position.locator)')
    expect(source).toContain('readingExperience.relocate()')
  })
})
