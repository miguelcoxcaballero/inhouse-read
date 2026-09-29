import { describe, expect, it } from 'vitest'
import { bookColorOptions, spineColorStyle, spineCustomization, surfaceFinish, normalizeShelfPosition } from '../../src/js/book-colors.js'

describe('book spine colors', () => {
  it('derives three distinct choices from the cover color', () => {
    const options = bookColorOptions('#a64235')
    expect(options).toHaveLength(3)
    expect(options[0]).toBe('#a64235')
    expect(new Set(options).size).toBe(3)
  })

  it('offers useful tones for grayscale covers too', () => {
    for (const cover of ['#808080', '#000000', '#ffffff']) {
      const options = bookColorOptions(cover)
      expect(options[0]).toBe(cover)
      expect(new Set(options).size).toBe(3)
    }
  })

  it('normalizes custom colors and chooses readable ink', () => {
    expect(spineColorStyle('#abc')).toEqual({ color: '#aabbcc', shade: '#818e9b', ink: '#171512' })
    expect(spineColorStyle('#102030').ink).toBe('#fffaf0')
  })

  it('limits editable surface finishes to glossy, satin and matte', () => {
    expect(surfaceFinish('glossy')).toBe('glossy')
    expect(surfaceFinish('unknown')).toBe('satin')
    expect(surfaceFinish('unknown','matte')).toBe('matte')
  })
})


describe('distinct palette and saved finishes', () => {
  it('serializes portable shelf coordinates and an explicit placement reset', () => {
    expect(spineCustomization({ shelfPosition:{ shelf:2, x:.375, extra:'ignored' } })).toEqual({
      shelfPosition:{ shelf:2, x:.375 }
    })
    expect(spineCustomization({ shelfPosition:null })).toEqual({ shelfPosition:null })
    expect(normalizeShelfPosition({ shelf:0, x:1.4 })).toEqual({ shelf:0, x:1 })
    expect(normalizeShelfPosition({ shelf:3, x:-.2 })).toEqual({ shelf:3, x:0 })
  })
  it('ignores malformed cloud shelf coordinates', () => {
    for (const shelfPosition of [undefined, {}, { shelf:-1, x:.5 }, { shelf:1.5, x:.5 },
      { shelf:1, x:Infinity }, { shelf:1, x:'0.5' }, { shelf:'2', x:.5 }]) {
      expect(spineCustomization({ shelfPosition })).toEqual({})
    }
  })
  it('never offers three greys or nearly identical hues', () => {
    for (const cover of ['#808080','#000000','#ffffff','#f3eeed','#8a2626','#0a7cff']) {
      const colors = bookColorOptions(cover).map(hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)))
      for (let i=0;i<3;i++) for (let j=i+1;j<3;j++) expect(Math.hypot(...colors[i].map((v,k)=>v-colors[j][k]))).toBeGreaterThan(70)
      expect(colors.slice(1).every(rgb=>Math.max(...rgb)-Math.min(...rgb)>40)).toBe(true)
    }
  })
  it('keeps valid colors, finishes, engraving and explicit automatic reset', () => {
    expect(spineCustomization({spineTextColor:null,spineColorOverride:'#abc',spineFinish:'gold',spineTextFinish:'silver',coverFinish:'glossy',pageEdgeFinish:'matte',spineSurfaceFinish:'satin',spineEngraved:true,author:{name:'Ursula Le Guin'},spineFontSize:44,spineAuthorFontSize:30,evil:'ignored'})).toEqual({
      spineTextColor:null,spineColorOverride:'#aabbcc',spineFinish:'gold',spineTextFinish:'silver',coverFinish:'glossy',pageEdgeFinish:'matte',spineSurfaceFinish:'satin',spineEngraved:true,author:'Ursula Le Guin',spineFontSize:44,spineAuthorFontSize:30
    })
    expect(spineCustomization({spineFontSize:99,spineAuthorFontSize:2})).toEqual({spineFontSize:48,spineAuthorFontSize:6})
    expect(spineCustomization({spineTextColor:'url(bad)',spineFinish:'bad',spineEngraved:'true'})).toEqual({spineFinish:'matte'})
  })
})
