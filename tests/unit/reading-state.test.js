import { describe, expect, it } from 'vitest'
import { cleanPlaces, cleanQuotes } from '../../src/js/readers/reading-state.js'

describe('reading state', () => {
  it('sanitizes quotes and preserves EPUB locators and chosen highlight colors', () => {
    expect(cleanQuotes([{id:'q1',text:'  A useful passage  ',fraction:.4,locator:{kind:'cfi',value:'epubcfi(/6/4)'},color:'blue',createdAt:12}])).toEqual([
      {id:'q1',text:'A useful passage',fraction:.4,locator:{kind:'cfi',value:'epubcfi(/6/4)'},label:'',color:'blue',createdAt:12}
    ])
  })
  it('drops invalid quote records and caps user supplied text', () => {
    expect(cleanQuotes([null,{text:' '},{text:'x'.repeat(1300),fraction:2,locator:{kind:'unknown',value:'x'},color:'red'}])[0]).toMatchObject({text:'x'.repeat(1200),fraction:1,locator:null,color:'yellow'})
    expect(cleanPlaces([{fraction:.3,locator:{kind:'pdf-page',value:5}}])).toHaveLength(1)
  })
})
