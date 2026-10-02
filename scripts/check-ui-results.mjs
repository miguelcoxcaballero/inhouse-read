import { readFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim().length > 0
const invalid = message => { throw new Error(`Invalid UI report: ${message}`) }

function shardOf(report, label) {
  const shard = report?.config?.shard
  if (!object(shard) || !Number.isSafeInteger(shard.current) || !Number.isSafeInteger(shard.total) ||
    shard.current < 1 || shard.current > shard.total) invalid(`${label} shard`)
  return `${shard.current}/${shard.total}`
}

function relativeFile(value, rootDir) {
  if (!text(value)) invalid('missing file')
  const file = posix.normalize(value.replaceAll('\\', '/'))
  const root = posix.normalize(rootDir.replaceAll('\\', '/')).replace(/\/$/, '')
  const absolute = file.startsWith('/') || /^[a-z]:/i.test(file)
  const relative = absolute && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
  if (!relative || relative === '.' || relative === '..' || relative.startsWith('../') ||
    relative.startsWith('/') || /^[a-z]:/i.test(relative)) invalid(`file outside root: ${value}`)
  return relative
}

function casesOf(report, label, listing) {
  if (!object(report) || !object(report.config) || !text(report.config.rootDir) ||
    !Array.isArray(report.config.argv) || report.config.argv.some(arg => typeof arg !== 'string')) invalid(`${label} config`)
  if (report.config.argv.includes('--list') !== listing) invalid(`${label} must ${listing ? '' : 'not '}be a --list report`)
  if (!Array.isArray(report.errors)) invalid(`${label} errors`)
  if (report.errors.length) invalid(`${label} has global errors`)
  if (!Array.isArray(report.suites)) invalid(`${label} suites`)
  const records = []
  const visit = (suites, parents = [], depth = 0) => {
    for (const suite of suites) {
      if (!object(suite) || typeof suite.title !== 'string' || !Array.isArray(suite.specs) ||
        (suite.suites !== undefined && !Array.isArray(suite.suites))) invalid(`${label} suite`)
      const file = relativeFile(suite.file, report.config.rootDir)
      const fileTitle = depth === 0 && [file, suite.file.replaceAll('\\', '/')].includes(suite.title.replaceAll('\\', '/'))
      const titles = suite.title && !fileTitle ? [...parents, suite.title] : parents
      for (const spec of suite.specs) {
        if (!object(spec) || !text(spec.title) || !Array.isArray(spec.tests) || !spec.tests.length || typeof spec.ok !== 'boolean')
          invalid(`${label} spec`)
        const specFile = relativeFile(spec.file, report.config.rootDir)
        for (const test of spec.tests) {
          if (!object(test) || !text(test.projectName ?? test.projectId) || !Array.isArray(test.results)) invalid(`${label} test`)
          const identity = { project:test.projectName ?? test.projectId, file:specFile, titlePath:[...titles, spec.title] }
          records.push({ identity, key:JSON.stringify([identity.project, identity.file, identity.titlePath]), test, ok:spec.ok })
        }
      }
      if (suite.suites) visit(suite.suites, titles, depth + 1)
    }
  }
  visit(report.suites)
  if (!records.length) invalid(`${label} is empty`)
  const stats = report.stats
  if (!object(stats)) invalid(`${label} stats`)
  const counts = ['expected', 'skipped', 'unexpected', 'flaky'].map(name => {
    if (!Number.isSafeInteger(stats[name]) || stats[name] < 0) invalid(`${label} count: ${name}`)
    return stats[name]
  })
  if (counts.reduce((sum, count) => sum + count, 0) !== records.length) invalid(`${label} stats do not match its cases`)
  return records
}

const duplicates = records => {
  const seen = new Set(), repeated = []
  for (const record of records) {
    if (seen.has(record.key)) repeated.push(record.identity)
    seen.add(record.key)
  }
  return repeated
}

function outcomeProblem(test, listing) {
  if (test.expectedStatus !== 'passed') return `expectedStatus ${test.expectedStatus}`
  if (listing) return test.status !== 'skipped' || test.results.length ? 'not an unexecuted --list case' : null
  if (test.status !== 'expected') return `outcome ${test.status}`
  if (test.results.length !== 1) return test.results.length ? 'multiple attempts' : 'unexecuted'
  const result = test.results[0]
  if (!object(result) || result.status !== 'passed' || result.retry !== 0) return 'attempt did not pass without retry'
  if (!Array.isArray(result.errors) || result.errors.length || result.error != null) return 'attempt errors'
  for (const annotations of [test.annotations, result.annotations]) {
    if (annotations !== undefined && (!Array.isArray(annotations) || annotations.some(annotation => !object(annotation) || !text(annotation.type))))
      return 'malformed annotations'
    if (annotations?.some(annotation => annotation.type === 'unobserved-frame')) return 'unobserved-frame'
  }
  return null
}

/** Compare actual case identities with the --list report from this same shard. */
export function validateUIResults(manifest, report, expectedShard) {
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(expectedShard || '')) invalid('an expected shard current/total is required')
  const shard = shardOf(manifest, 'manifest')
  if (shard !== expectedShard || shardOf(report, 'results') !== expectedShard) invalid(`shard mismatch; require ${expectedShard}`)
  const expected = casesOf(manifest, 'manifest', true), actual = casesOf(report, 'results', false)
  const wanted = new Set(expected.map(record => record.key)), observed = new Set(actual.map(record => record.key))
  const details = {
    shard, expected:expected.length, observed:actual.length,
    missing:expected.filter(record => !observed.has(record.key)).map(record => record.identity),
    extra:actual.filter(record => !wanted.has(record.key)).map(record => record.identity),
    duplicateExpected:duplicates(expected), duplicateActual:duplicates(actual),
    invalidCases:[...expected.map(record => ({ ...record, listing:true })), ...actual.map(record => ({ ...record, listing:false }))]
      .flatMap(record => {
        const reason = !record.ok ? 'unsuccessful spec' : outcomeProblem(record.test, record.listing)
        return reason ? [{ ...record.identity, source:record.listing ? 'manifest' : 'results', reason }] : []
      })
  }
  const problems = ['missing', 'extra', 'duplicateExpected', 'duplicateActual', 'invalidCases'].filter(name => details[name].length)
  if (report.stats.expected !== actual.length || report.stats.skipped || report.stats.flaky || report.stats.unexpected) problems.push('unsuccessful stats')
  if (manifest.stats.skipped !== expected.length || manifest.stats.expected || manifest.stats.flaky || manifest.stats.unexpected) problems.push('non-listing stats')
  if (problems.length) throw Object.assign(new Error(`Incomplete UI shard ${shard}: ${problems.join(', ')}`), { details })
  return { shard, expected:expected.length, passed:actual.length }
}

export async function checkUIResultsFiles(manifestPath, reportPath, expectedShard) {
  if (!manifestPath || !reportPath) throw new Error('UI manifest and results JSON paths are required')
  const [manifest, report] = await Promise.all([manifestPath, reportPath].map(async path => JSON.parse(await readFile(path, 'utf8'))))
  return validateUIResults(manifest, report, expectedShard)
}

async function main(args) {
  const [manifestPath, reportPath, shard, ...extra] = args
  try {
    if (extra.length) throw new Error('Usage: node scripts/check-ui-results.mjs <manifest.json> <results.json> <current/total>')
    console.log(JSON.stringify({ ok:true, ...await checkUIResultsFiles(manifestPath, reportPath, shard) }))
  } catch (error) {
    console.log(JSON.stringify({ ok:false, ...(error.details || { shard }), error:error.message }))
    console.error(error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2))
