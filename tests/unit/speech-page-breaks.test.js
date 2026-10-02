import { describe, it, expect, vi } from 'vitest'
import { speechPageBreaks } from '../../src/js/readers/speech-page-breaks.js'
import { planSpeech } from '../../src/js/readers/speech-text.js'

function layout(text, cuts, { rtl = false, vertical = false, spans = [[0, text.length]] } = {}) {
  const doc = { body:{ dir:rtl ? 'rtl' : '' }, documentElement:{},
    defaultView:{ getComputedStyle:() => ({ direction:rtl ? 'rtl' : 'ltr', writingMode:vertical ? 'vertical-rl' : 'horizontal-tb' }) } }
  const pageAt = offset => cuts.filter(cut => cut <= offset).length
  const rectAt = offset => {
    const page = pageAt(offset), position = page * 100 + 10
    return { left:rtl ? 1000 - position - 8 : position, right:rtl ? 1000 - position : position + 8,
      top:vertical ? position : 10, bottom:vertical ? position + 12 : 22, width:8, height:12 }
  }
  const rangeFor = vi.fn((start, end) => ({ getClientRects:() => {
    const offsets = [start, ...cuts.filter(cut => cut > start && cut < end)]
    return offsets.map(rectAt)
  } }))
  return { text, spans:spans.map(([start, end]) => ({ start, end, node:{ownerDocument:doc} })), rangeFor }
}
const renderer = { size:100, pages:10, scrolled:false }

describe('speech cuts at actual laid-out pages', () => {
  it.each([{}, {rtl:true}, {vertical:true}])('finds exact glyph boundaries in %j', async options => {
    const map = layout('abcdefghijklmnopqrstuvwxyz', [7, 19], options)
    expect(await speechPageBreaks(map, renderer)).toEqual([7, 19])
    expect(map.rangeFor.mock.calls.length).toBeLessThan(16)
  })
  it('finds transitions between nodes without a glyph scan', async () => {
    const map = layout('abcdefghij', [5], {spans:[[0, 5], [5, 10]]})
    expect(await speechPageBreaks(map, renderer)).toEqual([5])
    expect(map.rangeFor).toHaveBeenCalledTimes(2)
  })
  it('does not cut scrolled flow or fixed layout without a page size', async () => {
    const map = layout('abcdefghij', [5])
    expect(await speechPageBreaks(map, {...renderer, scrolled:true})).toEqual([])
    expect(await speechPageBreaks(map, {})).toEqual([])
    expect(map.rangeFor).not.toHaveBeenCalled()
  })
  it('drops work when the document closes', async () => {
    const map = layout('abcdefghij', [5])
    expect(await speechPageBreaks(map, renderer, {isCurrent:() => false})).toEqual([])
    expect(map.rangeFor).not.toHaveBeenCalled()
  })
  it('ignores zero-sized trailing column boxes', async () => {
    const map = layout('abc', [])
    map.rangeFor = () => ({getClientRects:() => [{left:10,right:18,top:0,width:8,height:12}, {left:200,top:0,right:200,width:0,height:12}]})
    expect(await speechPageBreaks(map, renderer)).toEqual([])
  })
  it('never divides a surrogate pair', async () => {
    const map = layout('ab😀cdef', [3])
    expect(await speechPageBreaks(map, renderer)).toEqual([2])
  })
})

describe('page-aware spoken fragments', () => {
  it('cuts a short sentence at the page while preserving one sentence highlight', () => {
    const raw = 'Esta frase empieza aquí y continúa en la página siguiente.'
    const cut = raw.indexOf('continúa')
    const items = planSpeech(raw, {pageBreaks:[cut]})
    expect(items.map(item => item.text)).toEqual(['Esta frase empieza aquí y', 'continúa en la página siguiente.'])
    expect(items.map(item => item.sentence)).toEqual([{start:0,end:raw.length}, {start:0,end:raw.length}])
    expect(items[1].start).toBe(cut)
  })
  it('maps page offsets through footnotes, invisible characters and collapsed spaces', () => {
    const raw = 'Lee [12] esta\n\n información y con\u00adtinúa aquí.'
    const cut = raw.indexOf('y con')
    const items = planSpeech(raw, {footnotes:false, pageBreaks:[cut, cut, -1, NaN, 9999]})
    expect(items.map(item => item.text)).toEqual(['Lee esta información', 'y continúa aquí.'])
    expect(items[1].start).toBe(cut)
    expect(items[0].sentence).toEqual(items[1].sentence)
  })
  it('resumes inside the current page without repeating previous text', () => {
    const raw = 'Una frase que sigue aquí y acaba allá.'
    const from = raw.indexOf('sigue'), cut = raw.indexOf('acaba')
    const items = planSpeech(raw, {pageBreaks:[0, cut]}, from)
    expect(items.map(item => item.text)).toEqual(['sigue aquí y', 'acaba allá.'])
    expect(items[0].start).toBe(from)
  })
  it('retains every character across multiple pages in scripts without spaces', () => {
    const raw = 'これは長い文章の最初の部分から次のページまで続いています。'
    const items = planSpeech(raw, {pageBreaks:[8, 17]})
    expect(items.map(item => item.text).join('')).toBe(raw)
    expect(items.map(item => item.start)).toEqual([0, 8, 17])
    expect(items.every(item => item.sentence.start === 0 && item.sentence.end === raw.length)).toBe(true)
  })
})
