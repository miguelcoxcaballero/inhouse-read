// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MINIMUM_TESTS, checkNeuralResultsFile, validateNeuralResults } from '../../scripts/check-neural-results.mjs'
import { neuralVoices } from '../../src/js/readers/neural-voice/catalog.js'

const report = stats => ({ stats:{ expected:9, flaky:0, skipped:0, unexpected:0, ...stats } })
const temporary = []
function fixture(contents) {
  const directory = mkdtempSync(join(tmpdir(), 'inhouse-neural-results-'))
  const path = join(directory, 'results.json')
  writeFileSync(path, contents)
  temporary.push({ directory, path })
  return path
}
afterEach(() => {
  for (const { directory, path } of temporary.splice(0)) {
    unlinkSync(path)
    rmdirSync(directory)
  }
})

describe('complete real neural results guard', () => {
  it.each(['engine', 'reading', 'languages'])('accepts every required %s test', suite => {
    const counts = validateNeuralResults(suite, report({ expected:MINIMUM_TESTS[suite] }))
    expect(counts).toMatchObject({ suite, passed:MINIMUM_TESTS[suite], skipped:0, unexpected:0 })
  })

  it('derives the language minimum from every selectable voice plus the dictionary check', () => {
    expect(MINIMUM_TESTS).toEqual({ engine:9, reading:10, languages:neuralVoices.length + 1 })
  })

  it('counts successful retried tests without accepting omissions', () => {
    expect(validateNeuralResults('engine', report({ expected:8, flaky:1 })).passed).toBe(9)
  })

  it('rejects a missing report file', async () => {
    const missing = join(tmpdir(), `inhouse-neural-report-missing-${process.pid}-${Date.now()}.json`)
    await expect(checkNeuralResultsFile('engine', missing)).rejects.toMatchObject({ code:'ENOENT' })
  })

  it('rejects an empty JSON file', async () => {
    await expect(checkNeuralResultsFile('engine', fixture(''))).rejects.toBeInstanceOf(SyntaxError)
  })

  it('rejects a report with no stats', () => {
    expect(() => validateNeuralResults('engine', {})).toThrow('missing stats')
  })

  it('rejects an empty test run', () => {
    expect(() => validateNeuralResults('engine', report({ expected:0 }))).toThrow('only 0 passed')
  })

  it('rejects skipped tests even with enough passing tests', () => {
    expect(() => validateNeuralResults('engine', report({ skipped:1 }))).toThrow('1 skipped tests')
  })

  it('rejects unexpected failures even with enough passing tests', () => {
    expect(() => validateNeuralResults('engine', report({ unexpected:1 }))).toThrow('1 unexpected tests')
  })

  it.each(['engine', 'reading', 'languages'])('rejects a short %s run', suite => {
    expect(() => validateNeuralResults(suite, report({ expected:MINIMUM_TESTS[suite] - 1 }))).toThrow(`require at least ${MINIMUM_TESTS[suite]}`)
  })

  it('rejects malformed counts instead of treating them as zero', () => {
    expect(() => validateNeuralResults('engine', report({ skipped:undefined }))).toThrow('Invalid neural count: skipped')
  })

  it.each(['unknown', 'toString', '__proto__'])('rejects an unknown suite %s', suite => {
    expect(() => validateNeuralResults(suite, report())).toThrow('Unknown neural suite')
  })

  it('reads a complete JSON result file', async () => {
    await expect(checkNeuralResultsFile('reading', fixture(JSON.stringify(report({ expected:10 }))))).resolves.toMatchObject({ suite:'reading', passed:10 })
  })
})
