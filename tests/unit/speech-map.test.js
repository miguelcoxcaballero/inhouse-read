import { describe, it, expect } from 'vitest'
import { mapSpeechText, mapTextLayer, mapTextNode } from '../../src/js/readers/speech-map.js'
import { normalizeSpeech, planSpeech, speechChunks, speechSentences } from '../../src/js/readers/speech-text.js'
import { installSpeechStyle, paintSpeechRange, clearSpeechRange, SPEECH_HIGHLIGHT, speechCSS } from '../../src/js/readers/speech-highlight.js'

const html = markup => { const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html'); return doc }
const spoken = (map, start, end) => map.rangeFor(start, end).toString()

describe('speech text mapping over the DOM', () => {
  it('maps offsets onto text nodes that span inline elements, without touching them', () => {
    const doc = html('<p>It was <em>the best</em> of times, <b>it</b>was.</p>')
    const before = doc.body.innerHTML
    const map = mapSpeechText(doc.body)
    expect(map.text).toBe('It was the best of times, itwas.')
    const start = map.text.indexOf('the best'), end = start + 'the best of times'.length
    const range = map.rangeFor(start, end)
    expect(range.toString()).toBe('the best of times')
    expect(range.startContainer.parentElement.localName).toBe('em')
    expect(range.endContainer.parentElement.localName).toBe('p')
    expect(doc.body.innerHTML).toBe(before)
  })
  it('puts a separator between blocks and <br>, and ranges skip it', () => {
    const doc = html('<h1>Title</h1><p>First.</p><p>Line one<br>line two</p><ul><li>a</li><li>b</li></ul>')
    const map = mapSpeechText(doc.body)
    // Headings and list items are hard breaks (their own sentences); paragraphs and <br> are soft line breaks.
    expect(map.text).toBe('Title\u2029First.\nLine one\nline two\u2029a\u2029b')
    expect(spoken(map, 0, map.text.length)).toBe('TitleFirst.Line oneline twoab')
    const from = map.text.indexOf('First'), to = map.text.indexOf('line two') + 4
    expect(spoken(map, from - 1, to)).toBe('First.Line oneline')
    // A range that starts inside a separator begins at the next text.
    expect(spoken(map, 5, 12)).toBe('First.')
  })
  it('a heading without a full stop becomes its own sentence, a wrapped paragraph line does not', () => {
    const doc = html('<h2>The quiet room</h2><p>It was late and the</p><p>light was low.</p><ul><li>Eggs</li><li>Milk.</li></ul>')
    const map = mapSpeechText(doc.body)
    const { text } = normalizeSpeech(map.text)
    expect(text).toBe('The quiet room. It was late and the light was low. Eggs. Milk.')
    const items = planSpeech(map.text)
    expect(items.map(item => item.text)).toEqual(['The quiet room.', 'It was late and the light was low.', 'Eggs.', 'Milk.'])
    expect(items.map(item => spoken(map, item.sentence.start, item.sentence.end))).toEqual(['The quiet room', 'It was late and thelight was low.', 'Eggs', 'Milk.'])
  })
  it('does not add a stray full stop after a closing quote or bracket that already ends the sentence', () => {
    const doc = html('<ul><li>Dijo: "Voy."</li><li>Otro</li></ul><h2>«Fin»</h2><p>Texto.</p><ul><li>(Ver nota.)</li><li>Él gritó: «¡Corre!»</li></ul>')
    const map = mapSpeechText(doc.body)
    expect(planSpeech(map.text).map(item => item.text)).toEqual(['Dijo: "Voy."', 'Otro.', '«Fin».', 'Texto.', '(Ver nota.)', 'Él gritó: «¡Corre!»'])
    expect(normalizeSpeech('Dijo: "Voy."\u2029Otro').text).toBe('Dijo: "Voy." Otro')
  })
  it('skips scripts, styles, ruby annotations and svg text', () => {
    const doc = html('<style>p{}</style><script>var x</script><p>Hello <ruby>漢<rt>kan</rt></ruby> world</p><svg><text>ignored</text></svg>')
    expect(mapSpeechText(doc.body).text).toBe('Hello 漢 world')
  })
  it('does not read text that is not rendered: display:none asides, [hidden], aria-hidden and visibility:hidden', () => {
    const doc = html('<p>Visible end of chapter.</p><aside style="display:none"><p>1. Hidden endnote text.</p></aside><p hidden>Hidden para.</p><span aria-hidden="true">decor</span><div style="visibility:hidden">Ghost</div><p>The real next.</p>')
    const map = mapSpeechText(doc.body)
    expect(map.text).toBe('Visible end of chapter.\nThe real next.')
    expect(planSpeech(map.text).map(item => item.text)).toEqual(['Visible end of chapter.', 'The real next.'])
  })
  it('uses the computed style of a real page (stylesheet rules), not only inline styles', () => {
    document.body.innerHTML = '<style>.note{display:none}</style><p>Shown.</p><aside class="note"><p>Footnote text.</p></aside><p>Also shown.</p>'
    expect(mapSpeechText(document.body).text).toBe('Shown.\nAlso shown.')
    document.body.innerHTML = ''
  })
  it('keeps the hard break when a list item or cell wraps its text in a paragraph', () => {
    const doc = html('<ul><li><p>Uno</p></li><li><p>Dos</p></li></ul><table><tr><td><p>A</p></td><td><p>B</p></td></tr></table><ul><li><p>Dos parrafos.</p><p>Mismo item.</p></li></ul>')
    const map = mapSpeechText(doc.body)
    expect(map.text).toBe('Uno\u2029Dos\u2029A\u2029B\u2029Dos parrafos.\nMismo item.')
    expect(planSpeech(map.text).map(item => item.text)).toEqual(['Uno.', 'Dos.', 'A.', 'B.', 'Dos parrafos.', 'Mismo item.'])
  })
  it('offsetOf finds the first character of a visible range, whatever its container', () => {
    const doc = html('<p>One two.</p><p>Three four.</p>')
    const map = mapSpeechText(doc.body)
    const second = doc.body.children[1]
    expect(map.offsetOf(second.firstChild, 6)).toBe(map.text.indexOf('four'))
    expect(map.offsetOf(second, 0)).toBe(map.text.indexOf('Three'))
    expect(map.offsetOf(doc.body, 0)).toBe(0)
    expect(map.offsetOf(doc.body, 2)).toBe(map.text.length)
  })
  it('maps a PDF text layer: one node per item, space between items, newline at line ends', () => {
    const doc = html('<div class="pdf-text-layer"><span>Reading</span><span>journey.</span><br><span>Page 1.</span><span></span></div>')
    const map = mapTextLayer(doc.querySelector('.pdf-text-layer'))
    expect(map.text).toBe('Reading journey.\nPage 1.')
    expect(spoken(map, 8, 24)).toBe('journey.Page 1.')
  })
  it('maps a reflowed PDF page text node to itself', () => {
    const doc = html('<article>Alpha. Beta.</article>')
    const map = mapTextNode(doc.querySelector('article').firstChild)
    expect(spoken(map, 7, 12)).toBe('Beta.')
    expect(mapTextNode(null).rangeFor(0, 3)).toBeNull()
  })
})

describe('normalising speech without losing offsets', () => {
  it('collapses whitespace and keeps a raw offset for every spoken character', () => {
    const raw = '  One   two\n\n three  '
    const { text, map } = normalizeSpeech(raw)
    expect(text).toBe('One two three')
    expect(text.split('').every((ch, i) => ch === ' ' ? /\s/.test(raw[map[i]]) : raw[map[i]] === ch)).toBe(true)
  })
  it('removes footnote markers in place, like the old text pass, but keeps later offsets right', () => {
    const raw = 'Claim.[12] Next (nota 3) point [*] ends[†].'
    const { text, map } = normalizeSpeech(raw, { footnotes:false })
    expect(text).toBe('Claim. Next point ends.')
    expect(raw.slice(map[text.indexOf('Next')], map[text.indexOf('Next')] + 4)).toBe('Next')
    expect(raw[map[text.indexOf('ends')]]).toBe('e')
    expect(normalizeSpeech(raw, { footnotes:true }).text).toContain('[12]')
  })
  it('drops soft hyphens, zero-width spaces and line-end hyphenation between letters', () => {
    const { text } = normalizeSpeech('co\u00adoper\u00adation inter\u200bnational informa-\ntion well-\nKnown')
    expect(text).toBe('cooperation international information well- Known')
  })
  it('skipHeaders drops lines repeated close together, never a repeat far away in a chapter', () => {
    const body = Array.from({ length: 120 }, (_, i) => `Body line ${i}.`)
    const near = ['Running header', 'Alpha.', 'Running header', 'Beta.'].join('\n')
    expect(normalizeSpeech(near, { skipHeaders:true }).text).toBe('Alpha. Beta.')
    const far = ['Yes.', ...body, 'Yes.'].join('\n')
    expect(normalizeSpeech(far, { skipHeaders:true }).text.match(/Yes\./g)).toHaveLength(2)
  })
})

describe('sentences and spoken fragments', () => {
  it('keeps the old chunking: sentences, long ones cut at 180 characters', () => {
    const long = `${'word '.repeat(60)}end.`
    const chunks = speechChunks(`First one. Second one?  Third!\n${long}`)
    expect(chunks.slice(0, 3)).toEqual(['First one.', 'Second one?', 'Third!'])
    expect(chunks.length).toBeGreaterThan(4)
    expect(chunks.every(chunk => chunk.length <= 180)).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(`First one. Second one? Third! ${long}`.trim())
    expect(speechChunks('')).toEqual([])
  })
  it('planSpeech reports raw ranges per fragment and the whole sentence a fragment belongs to', () => {
    const long = `${'lorem '.repeat(50)}done.`
    const raw = `Short one.[1]  ${long}   Last   words`
    const items = planSpeech(raw, { footnotes:false })
    expect(items[0]).toMatchObject({ text:'Short one.', start:0, end:10 })
    const fragments = items.filter(item => item.sentence.start === items[1].sentence.start)
    expect(fragments.length).toBeGreaterThan(1)
    expect(raw.slice(fragments[0].sentence.start, fragments[0].sentence.end)).toBe(long)
    for (const item of fragments) expect(raw.slice(item.start, item.end).replace(/\s+/g, ' ')).toBe(item.text)
    const last = items.at(-1)
    expect(raw.slice(last.start, last.end)).toBe('Last   words')
    expect(last.text).toBe('Last words')
  })
  it('planSpeech starts at the first character of the visible page, even mid-sentence', () => {
    const raw = 'Before the break. The sentence that crosses. Whole one.'
    const from = raw.indexOf('crosses')
    const items = planSpeech(raw, {}, from)
    expect(items.map(item => item.text)).toEqual(['crosses.', 'Whole one.'])
    expect(items[0].start).toBe(from)
  })
  it('speechSentences ignores empty input', () => { expect(speechSentences('')).toEqual([]) })
  it('a range for a planned sentence selects exactly its words in the DOM', () => {
    const doc = html('<p>Dear <i>reader</i>, hello.[3] The next <b>one</b> is here. Done</p>')
    const map = mapSpeechText(doc.body)
    const items = planSpeech(map.text, { footnotes:false })
    expect(items.map(item => spoken(map, item.sentence.start, item.sentence.end))).toEqual(['Dear reader, hello.', 'The next one is here.', 'Done'])
  })
})

describe('highlight painting', () => {
  it('uses the CSS Custom Highlight API when the window has it, and clears it', () => {
    const doc = html('<p>Hello world.</p>')
    const registry = new Map()
    class FakeHighlight { constructor(range) { this.range = range } }
    const window = { CSS:{ highlights:registry }, Highlight:FakeHighlight }
    Object.defineProperty(doc, 'defaultView', { value:window })
    const range = mapSpeechText(doc.body).rangeFor(0, 5)
    expect(paintSpeechRange(range)).toBe(true)
    expect(registry.get(SPEECH_HIGHLIGHT).range).toBe(range)
    clearSpeechRange(doc)
    expect(registry.size).toBe(0)
  })
  it('reports unavailability so the reader can use its own painter', () => {
    const doc = html('<p>Hello world.</p>')
    expect(paintSpeechRange(mapSpeechText(doc.body).rangeFor(0, 5))).toBe(false)
  })
  it('installs one theme-aware style per document and restyles it on theme change', () => {
    const doc = html('<p>x</p>')
    installSpeechStyle(doc, 'paper'); installSpeechStyle(doc, 'paper')
    expect(doc.querySelectorAll('style[data-inhouse-speech]')).toHaveLength(1)
    const paper = doc.querySelector('style[data-inhouse-speech]').textContent
    installSpeechStyle(doc, 'night')
    expect(doc.querySelector('style[data-inhouse-speech]').textContent).not.toBe(paper)
    expect(doc.querySelector('style[data-inhouse-speech]').textContent).toBe(speechCSS('night'))
    expect(speechCSS('unknown')).toBe(speechCSS('paper'))
  })
})
