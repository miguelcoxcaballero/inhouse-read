import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { neuralVoices } from '../src/js/readers/neural-voice/catalog.js'

export const MINIMUM_TESTS = Object.freeze({ engine:9, reading:12, languages:neuralVoices.length + 1 })

/** Every required real test must execute, even when Playwright itself exits successfully. */
export function validateNeuralResults(suite, report) {
  if (!Object.hasOwn(MINIMUM_TESTS, suite)) throw new Error(`Unknown neural suite: ${suite}`)
  const minimum = MINIMUM_TESTS[suite]
  const stats = report?.stats
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) throw new Error('Neural report is missing stats')
  const counts = { suite, minimum }
  for (const name of ['expected', 'flaky', 'skipped', 'unexpected']) {
    const value = stats[name]
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid neural count: ${name}`)
    counts[name] = value
  }
  counts.passed = counts.expected + counts.flaky
  const failures = []
  if (counts.skipped) failures.push(`${counts.skipped} skipped tests`)
  if (counts.unexpected) failures.push(`${counts.unexpected} unexpected tests`)
  if (counts.passed < minimum) failures.push(`only ${counts.passed} passed tests; require at least ${minimum}`)
  if (failures.length) throw Object.assign(new Error(`Incomplete real neural suite ${suite}: ${failures.join('; ')}`), { counts })
  return counts
}

export async function checkNeuralResultsFile(suite, path) {
  if (!path) throw new Error('A neural results JSON path is required')
  return validateNeuralResults(suite, JSON.parse(await readFile(path, 'utf8')))
}

async function main(args) {
  const [suite, path, ...extra] = args
  try {
    if (extra.length) throw new Error('Usage: node scripts/check-neural-results.mjs <engine|reading|languages> <results.json>')
    const counts = await checkNeuralResultsFile(suite, path)
    console.log(JSON.stringify({ ok:true, ...counts }))
  } catch (error) {
    console.log(JSON.stringify({ ok:false, ...(error.counts || { suite }), error:error.message }))
    console.error(error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2))
