import { describe, expect, it } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { normalizeSpeech, planSpeech } from '../../src/js/readers/speech-text.js'

const BODY = 'No.\n\nSí.\n\nNo.'
const RAW = 'Running header\nNo.\n\nYes.\n\nNo.\nRunning header'
const ranges = () => [{ start:0, end:'Running header'.length }, { start:RAW.lastIndexOf('Running header'), end:RAW.length }]

describe('PDF speech skips only confirmed running-header ranges', () => {
  it('retains real repeated paragraphs when no PDF header ranges are confirmed', () => {
    expect(normalizeSpeech(BODY, { skipHeaders:true, headerRanges:[] }).text).toBe('No. Sí. No.')
    expect(planSpeech(BODY, { skipHeaders:true, headerRanges:[] }).map(value => value.text)).toEqual(['No.', 'Sí.', 'No.'])
  })
  it('removes only confirmed headers and keeps both occurrences of a repeated body sentence', () => {
    const normalized = normalizeSpeech(RAW, { skipHeaders:true, headerRanges:ranges() })
    expect(normalized.text).toBe('No. Yes. No.')
    const plan = planSpeech(RAW, { skipHeaders:true, headerRanges:ranges() })
    expect(plan.map(value => value.text)).toEqual(['No.', 'Yes.', 'No.'])
    expect(plan.map(value => RAW.slice(value.start, value.end))).toEqual(['No.', 'Yes.', 'No.'])
    expect(normalized.map.every((offset, index) => /\s/.test(normalized.text[index]) || RAW[offset] === normalized.text[index])).toBe(true)
  })
  it('does not remove confirmed headers when header skipping is switched off', () => {
    expect(normalizeSpeech(RAW, { skipHeaders:false, headerRanges:ranges() }).text).toBe('Running header No. Yes. No. Running header')
  })
  it('keeps the existing legacy header behavior unchanged when the reader has no range metadata', () => {
    const near = ['Running header', 'Alpha.', 'Running header', 'Beta.'].join('\n')
    expect(normalizeSpeech(near, { skipHeaders:true }).text).toBe('Alpha. Beta.')
    const body = Array.from({ length:120 }, (_, index) => `Body line ${index}.`)
    const far = ['Yes.', ...body, 'Yes.'].join('\n')
    expect(normalizeSpeech(far, { skipHeaders:true }).text.match(/Yes\./g)).toHaveLength(2)
  })
  it.each([
    [{ start:-1, end:BODY.length }], [{ start:0, end:BODY.length + 1 }], [{ start:4, end:3 }],
    [{ start:0, end:2.5 }], [{ start:NaN, end:3 }], [{ start:0, end:Infinity }],
    [{ start:'0', end:3 }], [null, {}, 3], null, 'all'
  ].map(headerRanges => [headerRanges]))('does not fall back to blanket repeated-text removal for invalid supplied metadata %j', headerRanges => {
    expect(normalizeSpeech(BODY, { skipHeaders:true, headerRanges }).text).toBe('No. Sí. No.')
  })
  it('rejects a range that crosses body paragraphs rather than trimming it into a deletion', () => {
    expect(normalizeSpeech(BODY, { skipHeaders:true, headerRanges:[{ start:0, end:BODY.length }] }).text).toBe('No. Sí. No.')
  })
  it('rejects an in-bounds partial sentence masquerading as a header', () => {
    const raw = 'A body sentence must remain complete.\nNext.'
    expect(normalizeSpeech(raw, { skipHeaders:true, headerRanges:[{ start:2, end:6 }] }).text).toBe('A body sentence must remain complete. Next.')
  })
  it('rejects oversized alleged headers while preserving every source character', () => {
    const raw = `${'body '.repeat(20).trim()}\nNext.`
    expect(normalizeSpeech(raw, { skipHeaders:true, headerRanges:[{ start:0, end:raw.indexOf('\n') }] }).text).toBe(raw.replace('\n', ' '))
  })
  it('accepts a complete trimmed header line with CRLF and whitespace around it', () => {
    const raw = '  Running header  \r\nBody.'
    expect(normalizeSpeech(raw, { skipHeaders:true, headerRanges:[{ start:2, end:16 }] }).text).toBe('Body.')
  })
  it('ignores malformed ranges beside valid ones without deleting additional body text', () => {
    expect(normalizeSpeech(RAW, { skipHeaders:true, headerRanges:[...ranges(), { start:0, end:RAW.length + 100 }, { start:2, end:5 }] }).text).toBe('No. Yes. No.')
  })
  it('forwards reader-confirmed metadata through the audiobook preparation path', async () => {
    const voice = new ReadingVoice({ getSpeechSource:async () => ({ text:RAW, headerRanges:ranges() }) })
    voice.options = { footnotes:false, multilingual:false, skipHeaders:true }
    expect((await voice.prepare()).items.map(value => value.text)).toEqual(['No.', 'Yes.', 'No.'])
    voice.stop()
  })
})
