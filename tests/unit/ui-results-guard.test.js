// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkUIResultsFiles, validateUIResults } from '../../scripts/check-ui-results.mjs'

const temporary = []
function fixture(contents) {
  const directory = mkdtempSync(join(tmpdir(), 'inhouse-ui-results-'))
  const path = join(directory, 'report.json')
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

const rows = [
  { project:'chromium', file:'reader.spec.mjs', titles:['reader', 'opens'] },
  { project:'chromium', file:'shelf.spec.mjs', titles:['shelf', 'opens'] }
]
function report(listing, cases = rows) {
  return {
    config:{ rootDir:'/repo/tests/e2e', argv:['playwright', 'test', ...(listing ? ['--list'] : [])], shard:{ current:2, total:6 } },
    errors:[], stats:{ expected:listing ? 0 : cases.length, skipped:listing ? cases.length : 0, unexpected:0, flaky:0 },
    suites:cases.map(({ project, file, titles }) => {
      const spec = { title:titles.at(-1), file, ok:true, tests:[{
        projectName:project, projectId:project, expectedStatus:'passed', status:listing ? 'skipped' : 'expected', annotations:[],
        results:listing ? [] : [{ status:'passed', retry:0, errors:[], annotations:[] }]
      }] }
      let branch = { title:file, file, specs:[spec] }
      for (const title of titles.slice(0, -1).reverse()) branch = { title, file, specs:[], suites:[branch] }
      // Only the file container is omitted from a case's title path.
      if (titles.length > 1) {
        let leaf = branch
        while (leaf.suites) leaf = leaf.suites[0]
        leaf.title = ''
        branch = { title:file, file, specs:[], suites:[branch] }
      }
      return branch
    })
  }
}
const pair = cases => ({ manifest:report(true, cases), results:report(false, cases) })
const specs = value => value.suites.flatMap(function visit(suite) { return [...suite.specs, ...(suite.suites || []).flatMap(visit)] })
const first = value => specs(value)[0].tests[0]
const check = ({ manifest, results }, shard = '2/6') => validateUIResults(manifest, results, shard)

describe('complete UI shard results guard', () => {
  it('accepts all listed nested cases across projects, including identical titles in different files', () => {
    const cases = [...rows, { ...rows[0], project:'mobile' }]
    expect(check(pair(cases))).toEqual({ shard:'2/6', expected:3, passed:3 })
  })

  it('normalizes relative and absolute Windows/Linux files against each report root', () => {
    const value = pair()
    value.manifest.config.rootDir = 'C:\\repo\\tests\\e2e'
    value.results.config.rootDir = '/checkout/tests/e2e'
    for (const spec of specs(value.manifest)) spec.file = `C:\\repo\\tests\\e2e\\${spec.file}`
    for (const spec of specs(value.results)) spec.file = `/checkout/tests/e2e/./${spec.file}`
    expect(check(value).passed).toBe(2)
  })

  it('keeps title path components distinct even when titles contain the display separator', () => {
    const value = { manifest:report(true, [{ ...rows[0], titles:['reader › shelf', 'opens'] }]),
      results:report(false, [{ ...rows[0], titles:['reader', 'shelf › opens'] }]) }
    expect(() => check(value)).toThrow('missing, extra')
  })

  it('preserves a nested describe whose title equals a file name', () => {
    const value = pair([{ ...rows[0], titles:['reader.spec.mjs', 'opens'] }])
    expect(check(value).passed).toBe(1)
    value.results.suites[0].suites[0].title = ''
    expect(() => check(value)).toThrow('missing, extra')
  })

  it('allows descriptive annotations on tests and attempts', () => {
    const value = pair()
    first(value.results).annotations = [{ type:'serial' }, { type:'measurement', description:'three observed phases' }]
    first(value.results).results[0].annotations = [{ type:'slow' }]
    expect(check(value).passed).toBe(2)
  })

  it.each(['test', 'attempt'])('rejects unobserved-frame on the %s even when passed', place => {
    const value = pair(), test = first(value.results)
    const target = place === 'test' ? test : test.results[0]
    target.annotations = [{ type:'unobserved-frame', description:'transition could not be sampled' }]
    expect(() => check(value)).toThrow('invalidCases')
    try { check(value) } catch (error) { expect(error.details.invalidCases[0].reason).toBe('unobserved-frame') }
  })

  it.each(['project', 'file', 'title'])('rejects a substituted %s despite equal passing counters', field => {
    const value = pair()
    if (field === 'project') first(value.results).projectName = 'another-project'
    if (field === 'file') specs(value.results)[0].file = 'another.spec.mjs'
    if (field === 'title') specs(value.results)[0].title = 'another case'
    expect(() => check(value)).toThrow('missing, extra')
  })

  it('rejects an omitted case even when all remaining cases pass', () => {
    const value = pair()
    value.results.suites.pop(); value.results.stats.expected--
    expect(() => check(value)).toThrow('missing')
  })

  it('rejects an extra passing case', () => {
    const value = pair()
    value.results.suites.push(report(false, [{ ...rows[0], titles:['extra'] }]).suites[0])
    value.results.stats.expected++
    expect(() => check(value)).toThrow('extra')
  })

  it.each(['manifest', 'results'])('rejects duplicate identities in the %s', role => {
    const value = pair()
    value[role].suites.push(structuredClone(value[role].suites[0]))
    value[role].stats[role === 'manifest' ? 'skipped' : 'expected']++
    expect(() => check(value)).toThrow(role === 'manifest' ? 'duplicateExpected' : 'duplicateActual')
  })

  it('rejects a declared skip in the manifest (ordinary --list statuses are permitted)', () => {
    const value = pair(); first(value.manifest).expectedStatus = 'skipped'
    expect(() => check(value)).toThrow('invalidCases')
  })

  it('rejects a real skip even when the report has enough passing cases', () => {
    const value = pair(), test = first(value.results)
    test.status = 'skipped'; test.expectedStatus = 'skipped'; test.results[0].status = 'skipped'
    value.results.stats.expected--; value.results.stats.skipped++
    expect(() => check(value)).toThrow('invalidCases')
  })

  it('rejects an unexecuted case despite passing summary counters', () => {
    const value = pair(); first(value.results).results = []
    expect(() => check(value)).toThrow('invalidCases')
  })

  it.each(['failed', 'timedOut', 'interrupted'])('rejects a %s attempt', status => {
    const value = pair(), test = first(value.results)
    test.status = 'unexpected'; test.results[0].status = status
    value.results.stats.expected--; value.results.stats.unexpected++
    expect(() => check(value)).toThrow('invalidCases')
  })

  it('rejects an expected failure that Playwright counts as expected', () => {
    const value = pair(), test = first(value.results)
    test.expectedStatus = 'failed'; test.results[0].status = 'failed'
    expect(() => check(value)).toThrow('invalidCases')
  })

  it('rejects flaky failure then success', () => {
    const value = pair(), test = first(value.results)
    test.status = 'flaky'
    test.results = [{ status:'failed', retry:0, errors:[{ message:'first attempt failed' }] }, { status:'passed', retry:1, errors:[] }]
    value.results.stats.expected--; value.results.stats.flaky++
    expect(() => check(value)).toThrow('invalidCases')
  })

  it('rejects multiple attempts even if all are marked passed', () => {
    const value = pair(), test = first(value.results)
    test.results.push({ status:'passed', retry:1, errors:[] })
    expect(() => check(value)).toThrow('invalidCases')
  })

  it('rejects a single retained attempt with retry greater than zero', () => {
    const value = pair(); first(value.results).results[0].retry = 1
    expect(() => check(value)).toThrow('invalidCases')
  })

  it.each(['error', 'errors'])('rejects %s on a passing attempt', field => {
    const value = pair()
    first(value.results).results[0][field] = field === 'error' ? { message:'hidden error' } : [{ message:'hidden error' }]
    expect(() => check(value)).toThrow('invalidCases')
  })

  it.each(['status', 'retry', 'errors'])('rejects a missing attempt %s', field => {
    const value = pair(); delete first(value.results).results[0][field]
    expect(() => check(value)).toThrow('invalidCases')
  })

  it.each(['manifest', 'results'])('rejects global errors in the %s', role => {
    const value = pair(); value[role].errors.push({ message:'worker crashed' })
    expect(() => check(value)).toThrow('global errors')
  })

  it.each(['manifest', 'results'])('rejects an empty %s', role => {
    const value = pair(); value[role] = report(role === 'manifest', [])
    expect(() => check(value)).toThrow('empty')
  })

  it('rejects using the execution report as its own manifest', () => {
    const value = pair(); value.manifest = structuredClone(value.results)
    expect(() => check(value)).toThrow('must be a --list report')
  })

  it('rejects a listing reused as the actual execution report', () => {
    const value = pair(); value.results = structuredClone(value.manifest)
    expect(() => check(value)).toThrow('must not be a --list report')
  })

  it('rejects executed results disguised as a listing', () => {
    const value = pair(); first(value.manifest).results = structuredClone(first(value.results).results)
    expect(() => check(value)).toThrow('invalidCases')
  })

  it.each(['manifest', 'results'])('rejects an inconsistent %s shard', role => {
    const value = pair(); value[role].config.shard.current = 3
    expect(() => check(value)).toThrow('shard mismatch')
  })

  it('rejects both reports from the same wrong shard', () => {
    expect(() => check(pair(), '1/6')).toThrow('shard mismatch')
  })

  it.each([undefined, '2', '0/6', '2/0', '2/7', '2/6/1'])('rejects expected shard %s', shard => {
    expect(() => validateUIResults(...Object.values(pair()), shard)).toThrow()
  })

  it.each([
    ['missing config', value => { delete value.config }],
    ['missing root', value => { delete value.config.rootDir }],
    ['invalid argv', value => { value.config.argv = null }],
    ['invalid shard', value => { value.config.shard = { current:2, total:1 } }],
    ['fractional shard', value => { value.config.shard.current = 1.5 }],
    ['missing suites', value => { delete value.suites }],
    ['invalid suites', value => { value.suites = {} }],
    ['missing specs', value => { delete value.suites[0].specs }],
    ['invalid nested suites', value => { value.suites[0].suites = {} }],
    ['missing suite title', value => { delete value.suites[0].title }],
    ['empty case title', value => { specs(value)[0].title = ' ' }],
    ['empty tests', value => { specs(value)[0].tests = [] }],
    ['missing project', value => { delete first(value).projectName; delete first(value).projectId }],
    ['invalid results', value => { first(value).results = null }],
    ['missing errors', value => { delete value.errors }],
    ['invalid stats', value => { value.stats = [] }],
    ['missing count', value => { delete value.stats.skipped }],
    ['fractional count', value => { value.stats.expected = 1.5 }],
    ['negative count', value => { value.stats.flaky = -1 }],
    ['inflated count', value => { value.stats.expected++ }],
    ['outside root file', value => { specs(value)[0].file = '/outside/reader.spec.mjs' }],
    ['traversal file', value => { specs(value)[0].file = '../reader.spec.mjs' }]
  ])('rejects malformed report: %s', (_, mutate) => {
    const value = pair(); mutate(value.results)
    expect(() => check(value)).toThrow('Invalid UI report')
  })

  it('rejects malformed manifest structure', () => {
    const value = pair(); value.manifest.suites[0].specs = null
    expect(() => check(value)).toThrow('Invalid UI report')
  })

  it('rejects malformed annotations without suppressing errors', () => {
    const value = pair(); first(value.results).annotations = { type:'measurement' }
    expect(() => check(value)).toThrow('invalidCases')
  })

  it('rejects an unsuccessful spec with its case identity instead of calling the report malformed', () => {
    const value = pair(); specs(value.results)[0].ok = false
    expect(() => check(value)).toThrow('invalidCases')
    try { check(value) } catch (error) {
      expect(error.details.invalidCases[0]).toMatchObject({ file:'reader.spec.mjs', titlePath:['reader', 'opens'], reason:'unsuccessful spec' })
    }
  })

  it('reads complete manifest and results JSON files', async () => {
    const value = pair()
    await expect(checkUIResultsFiles(fixture(JSON.stringify(value.manifest)), fixture(JSON.stringify(value.results)), '2/6'))
      .resolves.toEqual({ shard:'2/6', expected:2, passed:2 })
  })

  it('rejects a missing file', async () => {
    const value = pair(), missing = join(tmpdir(), `inhouse-ui-missing-${process.pid}-${Date.now()}.json`)
    await expect(checkUIResultsFiles(missing, fixture(JSON.stringify(value.results)), '2/6')).rejects.toMatchObject({ code:'ENOENT' })
  })

  it.each(['', '{invalid'])('rejects an invalid JSON file: %s', contents => {
    const value = pair()
    return expect(checkUIResultsFiles(fixture(contents), fixture(JSON.stringify(value.results)), '2/6')).rejects.toBeInstanceOf(SyntaxError)
  })

  it('CLI exits zero for exact passing cases and nonzero for an omission with equal counters', () => {
    const value = pair(), script = fileURLToPath(new URL('../../scripts/check-ui-results.mjs', import.meta.url))
    const manifest = fixture(JSON.stringify(value.manifest)), actual = fixture(JSON.stringify(value.results))
    expect(spawnSync(process.execPath, [script, manifest, actual, '2/6'], { encoding:'utf8' }).status).toBe(0)
    specs(value.results)[0].title = 'replacement case'; writeFileSync(actual, JSON.stringify(value.results))
    const failure = spawnSync(process.execPath, [script, manifest, actual, '2/6'], { encoding:'utf8' })
    expect(failure.status).toBe(1)
    expect(JSON.parse(failure.stdout)).toMatchObject({ ok:false, missing:[{ titlePath:['reader', 'opens'] }], extra:[{ titlePath:['reader', 'replacement case'] }] })
  })

  it('workflow records the same six shards before testing and runs the guard even after a failure', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/production-checks.yml', import.meta.url), 'utf8')
    const uiJob = workflow.split('\n  e2e:')[1].split('\n  neural:')[0]
    expect(uiJob).toContain('shard: [1, 2, 3, 4, 5, 6]')
    expect(uiJob).toContain('PLAYWRIGHT_SUITE: general')
    expect(uiJob).toContain('IHR_CONTROLS_EVIDENCE_DIR: test-results/controls')
    expect(uiJob).toContain('PLAYWRIGHT_JSON_OUTPUT_NAME: playwright-report/manifest.json')
    expect(uiJob).toContain('npx playwright test --list --workers=1 --shard=${{ matrix.shard }}/6 --reporter=json')
    expect(uiJob).toMatch(/Require every listed UI test[^\n]*\r?\n\s+if: always\(\)\r?\n\s+run: node scripts\/check-ui-results\.mjs playwright-report\/manifest\.json playwright-report\/results\.json "\$\{\{ matrix\.shard \}\}\/6"/)
    expect(uiJob.indexOf('--list')).toBeLessThan(uiJob.indexOf('npm run test:e2e'))
    expect(uiJob.indexOf('scripts/check-ui-results.mjs')).toBeGreaterThan(uiJob.indexOf('npm run test:e2e'))
    expect(uiJob).toMatch(/path: \|\r?\n\s+playwright-report/)
  })
})
