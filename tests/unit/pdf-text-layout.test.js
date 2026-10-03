import { describe, expect, it } from 'vitest'
import { extractPDFText, mapPDFTextLayer } from '../../src/js/readers/pdf-text.js'
import { planSpeech } from '../../src/js/readers/speech-text.js'

const view = { width:600, height:800, transform:[1, 0, 0, -1, 0, 800] }
const item = (str, x, y, width = str.length * 6, size = 12, extra = {}) => ({
  str, width, height:size, transform:[size, 0, 0, size, x, 800 - y], dir:'ltr', hasEOL:true, ...extra
})
const layout = items => extractPDFText({ items }, view)
const layerFor = result => {
  const layer = document.createElement('div')
  for (const entry of result.items) {
    const span = document.createElement('span'); span.textContent = entry.str; layer.append(span)
    if (entry.hasEOL) layer.append(document.createElement('br'))
  }
  return layer
}

describe('geometry-based PDF page text', () => {
  it('preserves the stream byte for byte when geometry is absent or only partly supplied', () => {
    const raw = [{ str:'First line.', hasEOL:true }, { str:'Next fragment', hasEOL:false }]
    expect(layout(raw)).toMatchObject({ geometric:false, text:'First line.\nNext fragment ' })
    expect(layout([item('First', 40, 50), raw[1]]).text).toBe('First\nNext fragment ')
  })
  it('keeps every letter from repeated genuine sentences instead of filtering them as running headers', () => {
    const values = [item('No.', 40, 100), item('No.', 40, 118), item('No.', 40, 136)]
    const result = layout(values)
    expect(result.text).toBe('No. No. No.')
    expect(result.items).toHaveLength(3)
    expect(planSpeech(result.text).map(value => value.text)).toEqual(['No.', 'No.', 'No.'])
  })
  it('sorts painting-order fragments into physical lines and joins touching styled runs without spaces', () => {
    const values = [item('able.', 106, 118, 30), item('la historia ', 40, 100, 66),
      item('es memor', 40, 118, 66), item('completa', 106, 100, 48)]
    const result = layout(values)
    expect(result.text).toBe('la historia completa es memorable.')
    expect(result.lines.map(line => line.sourceIndices)).toEqual([[1, 3], [2, 0]])
    expect(result.spans.map(span => result.text.slice(span.start, span.end))).toEqual(result.items.map(value => value.str))
  })
  it('joins an indented continuation without inventing a new paragraph', () => {
    const result = layout([item('Primera línea que continúa', 40, 100, 200), item('aunque se indenta un poco.', 64, 118, 200), item('y termina en la tercera.', 40, 136, 200)])
    expect(result.paragraphs).toHaveLength(1)
    expect(result.text).toBe('Primera línea que continúa aunque se indenta un poco. y termina en la tercera.')
  })
  it('finds the normal leading on a short page rather than calling every line a paragraph', () => {
    const result = layout([item('One', 40, 100), item('two.', 40, 118), item('Three', 40, 152), item('four.', 40, 170)])
    expect(result.text).toBe('One two.\n\nThree four.')
    expect(result.paragraphs.map(paragraph => paragraph.text)).toEqual(['One two.', 'Three four.'])
  })
  it('recognizes a modest extra paragraph gap above the normal baseline spacing', () => {
    const result = layout([item('One', 40, 100), item('two.', 40, 118), item('Three', 40, 142), item('four.', 40, 160)])
    expect(result.text).toBe('One two.\n\nThree four.')
    expect(result.paragraphs).toHaveLength(2)
  })
  it('adapts to 24-point ordinary leading on a larger body font without adding paragraphs', () => {
    const result = layout([item('One', 40, 100, 30, 16), item('two', 40, 124, 30, 16), item('three.', 40, 148, 60, 16)])
    expect(result.text).toBe('One two three.')
    expect(result.paragraphs).toHaveLength(1)
  })
  it('allows small positioning jitter within normal line leading', () => {
    const result = layout([item('One', 40, 100), item('two', 40, 118), item('three', 40, 137.5), item('four.', 40, 155.5)])
    expect(result.text).toBe('One two three four.')
    expect(result.paragraphs).toHaveLength(1)
  })
  it('does not turn a large word space into a column without repeated lines on both sides', () => {
    const result = layout([item('Una frase', 40, 100, 80), item('justificada.', 152, 100, 90), item('sigue en una línea ancha.', 40, 118, 440)])
    expect(result.text).toBe('Una frase justificada. sigue en una línea ancha.')
    expect(result.paragraphs).toHaveLength(1)
  })
  it('reads three columns completely, including a full-width heading', () => {
    const result = layout([item('C2.', 390, 136, 130), item('B1.', 215, 118, 130), item('A2.', 40, 136, 130),
      item('Título', 40, 60, 490, 24), item('C1.', 390, 118, 130), item('A1.', 40, 118, 130), item('B2.', 215, 136, 130)])
    expect(result.text).toBe('Título\n\nA1. A2.\n\nB1. B2.\n\nC1. C2.')
    expect(result.items.map(value => value.str)).toEqual(['Título', 'A1.', 'A2.', 'B1.', 'B2.', 'C1.', 'C2.'])
  })
  it('reads complete columns in each band around an intervening full-width heading', () => {
    const result = layout([
      item('R2.', 330, 118, 210), item('L1.', 40, 100, 210), item('R1.', 330, 100, 210), item('L2.', 40, 118, 210),
      item('Sección dos', 40, 160, 500, 20), item('L3.', 40, 200, 210), item('R4.', 330, 218, 210),
      item('R3.', 330, 200, 210), item('L4.', 40, 218, 210)
    ])
    expect(result.items.map(value => value.str)).toEqual(['L1.', 'L2.', 'R1.', 'R2.', 'Sección dos', 'L3.', 'L4.', 'R3.', 'R4.'])
  })
  it('can find a local column section after a longer block of full-width text', () => {
    const wide = Array.from({ length:8 }, (_, index) => item(`Introducción ${index}.`, 40, 50 + index * 18, 500))
    const result = layout([...wide, item('R1.', 330, 245, 210), item('L2.', 40, 263, 210), item('L1.', 40, 245, 210), item('R2.', 330, 263, 210)])
    expect(result.items.map(value => value.str)).toEqual([...wide.map(value => value.str), 'L1.', 'L2.', 'R1.', 'R2.'])
  })
  it('keeps a left-aligned page counter after both columns without omitting it', () => {
    const result = layout([item('R2.', 330, 118, 210), item('23', 40, 760, 12, 9), item('L1.', 40, 100, 210),
      item('R1.', 330, 100, 210), item('L2.', 40, 118, 210)])
    expect(result.items.map(value => value.str)).toEqual(['L1.', 'L2.', 'R1.', 'R2.', '23'])
  })
  it('does not read short, tightly aligned table cells as newspaper columns', () => {
    const result = layout([item('France', 40, 100, 36), item('Paris', 330, 100, 30), item('Spain', 40, 118, 30),
      item('Madrid', 330, 118, 36), item('Italy', 40, 136, 30), item('Rome', 330, 136, 24)])
    expect(result.items.map(value => value.str)).toEqual(['France', 'Paris', 'Spain', 'Madrid', 'Italy', 'Rome'])
  })
  it('keeps small superscript note markers within their baseline line', () => {
    const result = layout([item('continúa aquí.', 40, 118, 170), item('1', 151, 94, 4, 7), item('La frase', 40, 100, 106), item(' sin perder notas', 159, 100, 110)])
    expect(result.lines).toHaveLength(2)
    expect(result.text).toBe('La frase 1 sin perder notas continúa aquí.')
  })
  it('does not let a drop cap make the next regular text line into another paragraph', () => {
    const result = layout([item('L', 40, 100, 20, 36), item('a historia comienza', 60, 100, 200), item('y continúa aquí.', 60, 118, 200), item('en la misma narración.', 40, 136, 200)])
    expect(result.text).toBe('La historia comienza y continúa aquí. en la misma narración.')
    expect(result.paragraphs).toHaveLength(1)
  })
  it('preserves hard hyphens in ambiguous wrapped compounds without inserting a space', () => {
    const result = layout([item('Tiene un largo-', 40, 100, 130), item('plazo y no inventa palabras.', 40, 118, 250)])
    expect(result.text).toBe('Tiene un largo-plazo y no inventa palabras.')
  })
  it('removes only a discretionary soft hyphen and keeps its character mapping accurate', () => {
    const result = layout([item('Una informa\u00ad', 40, 100, 130), item('ción completa.', 40, 118, 130)])
    expect(result.text).toBe('Una información completa.')
    const map = mapPDFTextLayer(layerFor(result), result)
    const second = result.text.indexOf('ción')
    expect(map.rangeFor(second, second + 4).toString()).toBe('ción')
    expect(map.offsetOf(map.spans[1].node, 2)).toBe(second + 2)
  })
  it('does not introduce Latin spaces between successive CJK characters or wrapped lines', () => {
    expect(layout([item('日本語の', 40, 100, 80), item('文章', 120, 100, 40), item('続きです。', 40, 118, 120)]).text).toBe('日本語の文章続きです。')
  })
  it('orders RTL columns from right to left but keeps each line in its recorded direction', () => {
    const result = layout([item('يسار أول.', 40, 100, 200, 12, { dir:'rtl' }), item('يمين ثان.', 330, 118, 200, 12, { dir:'rtl' }),
      item('يمين أول.', 330, 100, 200, 12, { dir:'rtl' }), item('يسار ثان.', 40, 118, 200, 12, { dir:'rtl' })])
    expect(result.items.map(value => value.str)).toEqual(['يمين أول.', 'يمين ثان.', 'يسار أول.', 'يسار ثان.'])
  })
  it('sorts RTL fragments right to left and preserves the words in each fragment', () => {
    const result = layout([item('العالم.', 40, 100, 60, 12, { dir:'rtl' }), item('مرحبا', 108, 100, 45, 12, { dir:'rtl' }), item('نص آخر.', 40, 118, 120, 12, { dir:'rtl' })])
    expect(result.text).toBe('مرحبا العالم. نص آخر.')
  })
  it('keeps an English line in left-to-right order inside a predominantly Arabic page', () => {
    const result = layout([item('هذا نص عربي طويل جدا في هذه الصفحة.', 40, 100, 490, 12, { dir:'rtl' }),
      item('English ', 40, 132, 60), item('translation.', 100, 132, 70)])
    expect(result.items.map(value => value.str)).toEqual(['هذا نص عربي طويل جدا في هذه الصفحة.', 'English ', 'translation.'])
  })
  it.each([90, 180, 270])('preserves physical order when the viewport rotates the complete page %s degrees', degrees => {
    const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
    const rotated = { transform:[cos, sin, sin, -cos, 0, 0] }
    const result = extractPDFText({ items:[item('Second.', 40, 118), item('First.', 40, 100)] }, rotated)
    expect(result.text).toBe('First. Second.')
    expect(result.geometric).toBe(true)
  })
  it('preserves all text conservatively when independent side text is rotated or vertical', () => {
    const rotated = item('Side note.', 40, 100, 100); rotated.transform = [0, 12, -12, 0, 50, 50]
    const result = layout([item('Main text.', 40, 100), rotated])
    expect(result.geometric).toBe(false)
    expect(result.text).toBe('Main text.\nSide note.\n')
    expect(layout([item('縦書き', 40, 100, 100, 12, { dir:'ttb' })]).geometric).toBe(false)
  })
  it('does not mutate original item coordinates or line-end metadata', () => {
    const input = [item('Second.', 40, 118), item('First.', 40, 100)]
    const before = structuredClone(input), result = layout(input)
    expect(input).toEqual(before)
    expect(result.items[0]).not.toBe(input[1])
    expect(result.items[0].transform).toEqual(input[1].transform)
  })
  it('preserves every source item exactly once in a densely fragmented page', () => {
    const input = []
    for (let line = 0; line < 80; line++) for (let word = 0; word < 16; word++) input.push(item(`${line}:${word}`, 20 + word * 34, 20 + line * 18, 30))
    const shuffled = input.filter((_, index) => index % 2).concat(input.filter((_, index) => !(index % 2)).reverse())
    const result = layout(shuffled)
    expect(result.items).toHaveLength(input.length)
    expect(new Set(result.spans.map(span => span.rawIndex)).size).toBe(input.length)
    expect(result.lines).toHaveLength(80)
    expect(result.items.map(value => value.str)).toEqual(input.map(value => value.str))
  })
})

describe('corrected PDF speech offsets over the original text layer', () => {
  it('maps complete sentences over joined lines and includes only the correct source nodes', () => {
    const result = layout([item('otra.', 40, 118, 30), item('Una frase y', 40, 100, 70), item(' después.', 78, 118, 70)])
    const layer = layerFor(result), before = layer.innerHTML, map = mapPDFTextLayer(layer, result)
    expect(map.text).toBe('Una frase y otra. después.')
    const first = planSpeech(map.text)[0]
    expect(first.text).toBe('Una frase y otra.')
    const range = map.rangeFor(first.start, first.end)
    expect(range.startContainer.nodeValue).toBe('Una frase y')
    expect(range.endContainer.nodeValue).toBe('otra.')
    expect(range.startOffset).toBe(0); expect(range.endOffset).toBe(5)
    expect(layer.innerHTML).toBe(before)
  })
  it('skips synthetic spaces and paragraph separators without offset drift', () => {
    const result = layout([item('First.', 40, 100), item('Next.', 40, 118), item('New paragraph.', 40, 154)])
    const map = mapPDFTextLayer(layerFor(result), result), start = map.text.indexOf('New')
    expect(map.rangeFor(start - 2, start + 3).toString()).toBe('New')
    expect(map.rangeFor(start - 2, start)).toBeNull()
    expect(map.rangeFor(-20, 3).toString()).toBe('Fir')
    expect(map.rangeFor(map.text.length + 5, map.text.length + 10)).toBeNull()
  })
  it('refuses to attach stale offsets to an unrelated or modified text layer', () => {
    const result = layout([item('First.', 40, 100), item('Next.', 40, 118)])
    const layer = layerFor(result); layer.firstChild.textContent = 'Different text.'
    expect(mapPDFTextLayer(layer, result)).toBeNull()
    expect(mapPDFTextLayer(document.createElement('div'), result)).toBeNull()
  })
})
