// Differential test: the shelf's lookup table of the other modules' functions and renderBookshelf's public handle,
// now listed by rust-ui/src/bookshelf/mount.rs (shelf_env_table, shelf_handle) behind src/js/bookshelf.js, against the frozen
// JavaScript (helpers/reference-bookshelf-handle.js). The table must name the same entries in the same order,
// each one the very function or value the original's wrapper, getter or own entry reached (read from the
// module the frozen file imported it from, so a wrong module or export in the Rust table is caught). The
// handles of two shelves mounted from the same books must have the same keys and accessors, draw the same DOM
// after the same calls, answer the same before and after destroy, and stay safe to call once destroyed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('../../src/js/book-model.js', async importOriginal => ({ ...await importOriginal(),
  getBookRenderer:() => null, bookView:() => null,
  planReadingBookPose:() => ({ x:0, y:0, scale:1, angle:0, pitch:0, coverOpen:1 }) }))

const { rustShelf } = await import('./helpers/rust-shelf-ready.js')
const production = await import('../../src/js/bookshelf.js')
const reference = await import('./helpers/reference-bookshelf-handle.js')
const referenceText = readFileSync('tests/unit/helpers/reference-bookshelf-handle.js', 'utf8')
const productionText = readFileSync('src/js/bookshelf.js', 'utf8')

// local binding -> [module path, export] of the frozen file's imports.
function importsOf(text, base) {
  const map = new Map()
  for (const [, names, path] of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const part of names.split(',').map(entry => entry.trim()).filter(Boolean)) {
      const [exported, local = exported] = part.split(/\s+as\s+/)
      map.set(local, [path.replace(base, '../../src/js/'), exported])
    }
  }
  return map
}

describe('the shelf lookup table in Rust against the frozen JavaScript', () => {
  it('names the same entries, in order, reaching the same functions and values', async () => {
    const imports = importsOf(referenceText, '../../../src/js/')
    const body = referenceText.slice(referenceText.indexOf('const shelfEnv = {'), referenceText.indexOf('\n};', referenceText.indexOf('const shelfEnv = {')))
    const expected = []
    for (const line of body.split('\n').slice(1)) {
      let match
      if ((match = line.match(/^\s*([A-Za-z_]+):\s*\(\.\.\.args\)\s*=>\s*([A-Za-z_]+)\(\.\.\.args\),?$/))) expected.push([match[1], 'wrapper', match[2]])
      else if ((match = line.match(/^\s*get ([A-Za-z_]+)\(\) \{ return ([A-Za-z_]+); \},?$/))) expected.push([match[1], 'getter', match[2]])
      else if ((match = line.match(/^\s*([A-Za-z_]+),$/))) expected.push([match[1], 'direct', match[1]])
      else if ((match = line.match(/^\s*([A-Za-z_]+):/))) expected.push([match[1], 'own', null])
    }
    expect(expected.length).toBeGreaterThan(60)
    expect(expected.map(([name]) => name)).toEqual(Object.keys(reference.shelfEnv))
    // The namespaces bookshelf.js hands over, from its own `import * as` lines.
    const modules = {}
    for (const [, name, path] of productionText.matchAll(/import \* as ([A-Za-z]+) from '([^']+)'/g)) modules[name] = await import(path.replace('./', '../../src/js/'))
    const own = Object.fromEntries(expected.filter(([, kind]) => kind === 'own' || kind === 'direct').map(([name]) => [name, reference.shelfEnv[name]]))
    const env = production.createShelfLookup(rustShelf.shelf_env_table(), modules, own)
    expect(Object.keys(env)).toEqual(Object.keys(reference.shelfEnv))
    for (const [name, kind, local] of expected) {
      if (kind === 'own' || kind === 'direct') { expect(env[name], name).toBe(reference.shelfEnv[name]); continue }
      const [path, exported] = imports.get(local)
      const module = await import(path)
      expect(env[name], name).toBe(module[exported])
      expect(Object.getOwnPropertyDescriptor(env, name).get, name).toBeTypeOf('function')
      if (kind === 'getter') expect(env[name], name).toBe(reference.shelfEnv[name])
      else expect(reference.shelfEnv[name], name).toBeTypeOf('function')
    }
    expect(() => production.createShelfLookup(rustShelf.shelf_env_table(), { ...modules, layout:undefined }, own)).toThrow(/renderBookshelf/)
  })
})

describe('the public handle in Rust against the frozen JavaScript', () => {
  beforeEach(() => {
    localStorage.clear(); vi.stubGlobal('WebGLRenderingContext', undefined); vi.stubGlobal('WebGL2RenderingContext', undefined)
    vi.stubGlobal('matchMedia', () => ({ matches:true, addEventListener() {}, removeEventListener() {} }))
  })
  afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

  const books = [{ id:'a', title:'Uno', author:'Ana', format:'PDF', wordCount:80000, progressFraction:0.2 },
    { id:'b', title:'Dos', format:'EPUB', wordCount:20000, progressFraction:1 }]
  const mount = implementation => {
    const container = document.createElement('div'); document.body.append(container)
    return implementation.renderBookshelf(container, books.map(book => ({ ...book })), { shelfWidth:390, sections:false, revealDuration:0, holdMs:0 })
  }
  const shape = handle => Object.keys(handle).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(handle, key)
    return [key, descriptor.get ? 'getter' : typeof descriptor.value, descriptor.enumerable, descriptor.configurable]
  })
  const answer = async run => { try { const value = run(); return ['ok', value instanceof Promise ? ['promise', await value] : value] } catch (error) { return ['threw', error.constructor.name] } }
  const script = handle => [
    () => handle.isInteracting,
    () => handle.queueRefresh([{ ...books[0], title:'Uno bis' }, books[1]]),
    () => handle.refresh([{ ...books[0], progressFraction:0.5 }, books[1]], { defer:false }),
    () => handle.refresh(books, undefined),
    () => handle.update([books[1]]),
    () => handle.hasReaderOrigin('a'),
    () => handle.setPresentationActive(true),
    () => handle.updateCloudRecord({ ...books[1], cloudFileId:'f' }),
    () => handle.applyRoomPose(),
    () => handle.clearLiveRoomMotion('peer'),
    () => handle.setReturningBook('b'),
    () => handle.prepareCloudRoom(),
    () => handle.prepareOpeningPage('a', null),
    () => handle.close(),
    () => handle.returnToShelf('missing', {}),
    () => handle.refresh(books, null),
    () => handle.isInteracting
  ]
  const run = async implementation => {
    const handle = mount(implementation), log = [shape(handle), handle.update === handle.refresh, handle.element.outerHTML]
    for (const step of script(handle)) { log.push(await answer(step)); log.push(handle.element.outerHTML) }
    log.push(await answer(() => handle.destroy()))
    for (const step of [...script(handle), () => handle.applyLiveRoomMotion({}), () => handle.destroy()]) log.push(await answer(step))
    log.push(handle.element.isConnected, handle.element.outerHTML)
    return log
  }

  it('has the same shape, draws the same DOM and answers the same before and after destroy', async () => {
    const expected = await run(reference)
    const actual = await run(production)
    expect(actual).toEqual(expected)
    expect(expected[0].map(([key]) => key)).toContain('isInteracting')
  })

  it('reports a missing container as before', () => {
    expect(() => production.renderBookshelf(null, [])).toThrow('renderBookshelf: falta el contenedor')
    expect(production.DEFAULT_TEXTS.tapCover({ title:'Uno' })).toBe(reference.DEFAULT_TEXTS.tapCover({ title:'Uno' }))
    expect(production.DEFAULT_TEXTS.openAria({ title:'Uno', author:'Ana' })).toBe(reference.DEFAULT_TEXTS.openAria({ title:'Uno', author:'Ana' }))
    expect(production.DEFAULT_TEXTS.progressAria(100)).toBe(reference.DEFAULT_TEXTS.progressAria(100))
  })
})
