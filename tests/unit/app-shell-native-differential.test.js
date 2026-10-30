// Differential test: the application shell of app.js (rust-ui/src/app_shell.rs) against the frozen
// JavaScript it replaced (helpers/reference-app-shell.js). Each case builds the same page in its own
// document, runs the same operations on both and compares every host call, the page's markup, the
// shell state and the saved theme.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as reference from './helpers/reference-app-shell.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'

const scope = (env, fn) => new Function('env', `with(env){return (${fn.toString()})}`)(env)
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const settle = async (ms = 0) => { await flush(); if (ms) { vi.advanceTimersByTime(ms); await flush() } }
const ZONE = { PREV:'prev', NEXT:'next', CENTER:'center' }
const MARKUP = `<meta name="theme-color" content="#f5f5f0"><header class="app-header" style="color-scheme: dark" data-reading-theme="sepia"><b class="inner">x</b></header>
<section id="home-screen"></section><section id="reader-screen" hidden><div id="reader-viewport" tabindex="-1"></div><div id="reader-loading" hidden></div><div class="reader-heading-actions"></div></section>
<nav id="reader-toolbar"><i class="inner"></i></nav><button id="reader-focus"></button><input id="drive-theme-toggle" type="checkbox"><small id="app-version"></small><button id="add-drive-btn" title="Abrir desde Google Drive"></button>
<input id="file-picker"><div id="drive-modal" hidden><div id="drive-status"></div><div id="drive-list"></div></div>
<div id="drive-auth-notice" hidden><span id="drive-auth-message"></span><button id="drive-auth-retry"></button><button id="drive-auth-cancel"></button></div>
<div class="reading-panel"><input data-pref="x"><button data-theme="sepia"></button><button data-size-step="1"></button><button data-reset></button><span class="other"></span></div>`
const STATE = ['appDisposed', 'closingReader', 'shelf', 'shelfRefreshDeferred', 'lengthStatusVersion', 'shelfLengthStatusVersion',
  'lengthRefreshTimer', 'roomRefreshRetry', 'shelfRefreshQueued', 'readerLoadGeneration', 'cloudRoomChanged',
  'pendingLocalReopenId', 'pendingReaderTransition', 'driveProfile']
const resizeObservers = []
class FakeResizeObserver { constructor(callback) { this.callback = callback; resizeObservers.push(this) } observe(node) { this.node = node } disconnect() {} }

beforeEach(() => { vi.useFakeTimers(); globalThis.ResizeObserver = FakeResizeObserver })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.ResizeObserver; delete globalThis.matchMedia; delete globalThis.alert; localStorage.clear() })

function page(native, o = {}) {
  const doc = document.implementation.createHTMLDocument('shell')
  doc.body.innerHTML = MARKUP
  if (o.bodyClass) doc.body.className = o.bodyClass
  if (o.theme !== null) doc.documentElement.setAttribute('data-theme', o.theme ?? 'light')
  let hidden = Boolean(o.documentHidden)
  Object.defineProperty(doc, 'hidden', { configurable:true, get:() => hidden })
  const $ = id => doc.getElementById(id)
  const els = { homeScreen:$('home-screen'), readerScreen:$('reader-screen'), readerViewport:$('reader-viewport'), readerToolbar:$('reader-toolbar'),
    readerFocus:$('reader-focus'), driveThemeToggle:$('drive-theme-toggle'), appVersion:$('app-version'), addDriveBtn:$('add-drive-btn'),
    filePicker:$('file-picker'), driveModal:$('drive-modal'), driveStatus:$('drive-status'), driveList:$('drive-list') }
  if (o.readerVisible) els.readerScreen.hidden = false
  if (o.readerClass) els.readerScreen.classList.add(o.readerClass)
  if (o.checked) els.driveThemeToggle.checked = true
  if (o.noSwitch) els.driveThemeToggle = null
  const log = []
  const record = (...entry) => { log.push(entry) }
  const result = (name, value, ...args) => { record(name, ...args); if (o.fail?.includes(name)) return Promise.reject(Object.assign(new Error(`${name} failed`), o.code?.[name] ? { code:o.code[name] } : {})); return Promise.resolve(value) }
  localStorage.clear()
  if (o.saved != null) localStorage.setItem('inhouse-read-theme', o.saved)
  globalThis.matchMedia = query => { record('matchMedia', query); return { matches:Boolean(o.prefersDark) } }
  globalThis.alert = message => record('alert', message)
  vi.spyOn(console, 'warn').mockImplementation((label, error) => record('warn', label, error?.message ?? error))
  const state = { appDisposed:false, closingReader:false, shelf:null, shelfRefreshDeferred:false, lengthStatusVersion:0, shelfLengthStatusVersion:0,
    lengthRefreshTimer:null, roomRefreshRetry:null, shelfRefreshQueued:false, readerLoadGeneration:0, cloudRoomChanged:false,
    pendingLocalReopenId:null, pendingReaderTransition:null, driveProfile:null, ...o.state }
  if (o.shelf === 'presenting') state.shelf = { setPresentationActive:value => record('presentation', value) }
  else if (o.shelf === 'bare') state.shelf = {}
  const books = o.books ?? [{ id:'local', driveFileId:'other' }, { id:'known', driveFileId:'drive-2' }]
  const env = {
    els, document:doc, ZONE, STREAK_KEY:'streak-key', APP_VERSION:'9.9.9',
    reader:{ rtl:o.rtl },
    readingExperience:{ step:value => record('step', value), panel:{ open:Boolean(o.panelOpen) }, reloadPreferences:() => record('reload-preferences') },
    readingStreak:{ reconcile:() => record('reconcile') },
    preparedPages:{ invalidate:reason => record('invalidate', reason) },
    notifyCloudSettingsChanged:key => record('notify', key),
    setShelfWorkActive:value => record('shelf-work', value),
    refreshShelf:() => result('refresh'),
    classifyTapZone:(x, width) => { record('zone', x, width); return width <= 0 ? 'center' : x / width <= 0.28 ? 'prev' : x / width >= 0.72 ? 'next' : 'center' },
    isDriveConfigured:() => { record('configured'); return !o.unconfigured },
    hasDriveSession:() => { record('session'); return Boolean(o.session) },
    requestDriveAccess:() => result('access'),
    loadDriveAccountProfile:() => result('profile'),
    listAllDriveBooks:() => result('list', o.files ?? []),
    syncLibraryToDrive:options => result('sync', undefined, options),
    setDriveSyncStatus:message => record('status', message),
    offerAvailableAndroidUpdate:() => result('offer', Boolean(o.offer)),
    normalizeBookTitle:name => { record('title', name); return `T:${name}` },
    openFile:(file, options) => result('open', true, file?.name ?? file, options),
    library:{
      listAll:() => result('list-all', books),
      addOrTouch:(fields, options) => result('add', { id:'added', ...fields }, fields, options),
      get:id => result('get', o.noLatest ? null : { id, latest:true }, id)
    },
    cloudSync:{
      downloadForOffline:book => result('download', o.noDownload ? null : { name:`file-of-${book.id}` }, book.id),
      syncBookProgress:id => result('progress', undefined, id)
    }
  }
  for (const key of STATE) Object.defineProperty(env, key, { get:() => state[key], set:value => { state[key] = value }, enumerable:true, configurable:true })
  for (const id of ['authNotice', 'authMessage', 'authRetry', 'authCancel']) env[id] = $(`drive-auth-${id.slice(4).toLowerCase()}`)
  let ops
  if (native) {
    const host = { ...env, state }
    for (const key of STATE) delete host[key]
    Object.defineProperty(host, 'readingExperience', { get:() => env.readingExperience })
    const m = rustShelf
    ops = { startShell:() => m.app_start_shell(host), initTheme:() => m.app_init_theme(host), toggle:() => m.app_set_theme(host, 'toggle'),
      switch:() => m.app_set_theme(host, 'switch'), show:name => m.app_show_screen(host, name), length:() => m.app_schedule_length_refresh(host),
      retry:() => m.app_retry_room_refresh(host),
      // app.js calls the shell only while a cover is open, as the original branch did.
      flyout:() => { if (doc.querySelector('.ihr-flyout')) m.app_refresh_after_flyout(host) }, cloud:keys => m.app_apply_cloud_settings(host, keys),
      chrome:value => m.app_set_reader_chrome_hidden(host, value), watchControls:() => m.app_watch_reader_controls(host),
      picked:() => m.app_file_picked(host), watchPrepared:() => m.app_watch_prepared_pages(host),
      auth:(message, options) => m.app_show_auth_notice(host, message, options), drive:() => m.app_open_drive_modal(host) }
  } else {
    const fn = name => scope(env, reference[name])
    for (const name of ['syncThemeColor', 'initTheme', 'scheduleLengthRefresh', 'showScreen', 'setReaderChromeHidden', 'loadDriveFiles']) env[name] = fn(name)
    ops = { startShell:fn('startShell'), initTheme:env.initTheme, toggle:fn('themeToggleClick'), switch:fn('driveThemeChange'), show:env.showScreen,
      length:env.scheduleLengthRefresh, retry:fn('retryRoomRefresh'), flyout:fn('refreshAfterFlyout'), cloud:fn('applyCloudSettings'),
      chrome:env.setReaderChromeHidden, watchControls:fn('watchReaderControls'), picked:fn('filePicked'), watchPrepared:fn('watchPreparedPages'),
      auth:fn('showAuthNotice'), drive:fn('openDriveModal') }
  }
  const snapshot = () => ({ log:log.map(entry => JSON.parse(JSON.stringify(entry))), markup:doc.documentElement.outerHTML,
    checked:els.driveThemeToggle?.checked, focused:doc.activeElement?.id ?? null, saved:localStorage.getItem('inhouse-read-theme'),
    state:Object.fromEntries(STATE.map(key => [key, key === 'shelf' ? Boolean(state.shelf) : key.endsWith('Timer') || key === 'roomRefreshRetry' ? state[key] != null : state[key]])) })
  return { ops, doc, els, state, record, snapshot, setHidden:value => { hidden = value } }
}

// Runs the same script on both shells; `script(page)` may be async and settle timers itself.
async function compare(options, script) {
  const outcome = async native => {
    resizeObservers.length = 0
    const p = page(native, options)
    let error
    try { await script(p) } catch (caught) { error = caught?.message ?? String(caught) }
    await settle(500)
    return { ...p.snapshot(), error }
  }
  const expected = await outcome(false), actual = await outcome(true)
  expect(actual).toEqual(expected)
  return expected
}

describe('Rust application shell matches the frozen app.js shell', () => {
  it('starts the header: theme, switch, version, Drive button and home screen', async () => {
    for (const saved of [null, 'dark', 'light', 'sepia'])
      for (const prefersDark of [false, true])
        for (const unconfigured of [false, true])
          for (const state of [{ shelfLengthStatusVersion:-1 }, {}, { shelfRefreshDeferred:true }])
            await compare({ saved, prefersDark, unconfigured, state, theme:null }, async p => { p.ops.startShell(); await settle(100) })
  })

  it('switches the theme from the header and from the settings switch', async () => {
    for (const theme of ['dark', 'light', null, 'sepia'])
      for (const checked of [false, true])
        for (const noSwitch of [false, true]) {
          await compare({ theme, checked, noSwitch }, p => { p.ops.toggle(); p.ops.toggle() })
          if (!noSwitch) await compare({ theme, checked }, p => { p.ops.switch(); p.els.driveThemeToggle.checked = !checked; p.ops.switch() })
          await compare({ theme, saved:theme === 'sepia' ? 'dark' : null, prefersDark:checked, noSwitch }, p => p.ops.initTheme())
        }
  })

  it('shows screens with deferred refreshes, presentation and length refreshes', async () => {
    for (const name of ['home', 'reader', 'other', undefined])
      for (const shelf of [null, 'presenting', 'bare'])
        for (const state of [{}, { shelfRefreshDeferred:true }, { shelfRefreshDeferred:true, closingReader:true }, { shelfLengthStatusVersion:-1 },
          { shelfLengthStatusVersion:-1, appDisposed:true }])
          for (const fail of [[], ['refresh']])
            await compare({ shelf, state, fail, bodyClass:'is-reader-focus is-reading other' }, async p => { p.ops.show(name); await settle(100) })
    await compare({ state:{ shelfLengthStatusVersion:-1 }, documentHidden:true }, async p => { p.ops.show('home'); await settle(100) })
  })

  it('schedules length refreshes and room retries like the original timers', async () => {
    for (const op of ['length', 'retry'])
      for (const state of [{}, { appDisposed:true }, { lengthRefreshTimer:1, roomRefreshRetry:1 }])
        for (const readerVisible of [false, true])
          // A failed retry refresh was never caught by the original either: only the length refresh fails here.
          for (const fail of op === 'length' ? [[], ['refresh']] : [[]]) {
            await compare({ state, readerVisible, fail }, async p => { p.ops[op](); p.ops[op](); await settle(40); p.ops[op](); await settle(200); p.ops[op](); await settle(200) })
            await compare({ state, readerVisible, fail }, async p => { p.ops[op](); p.state.appDisposed = true; await settle(200) })
            await compare({ state, readerVisible, fail }, async p => { p.ops[op](); p.setHidden(true); await settle(200); p.setHidden(false); p.ops[op](); await settle(200) })
          }
  })

  it('waits for an open cover to close before refreshing', async () => {
    for (const queued of [false, true])
      await compare({ state:{ shelfRefreshQueued:queued } }, async p => {
        const flyout = p.doc.createElement('div'); flyout.className = 'ihr-flyout'; p.doc.body.append(flyout)
        p.ops.flyout(); p.ops.flyout(); await settle()
        p.doc.body.append(p.doc.createElement('span')); await settle()
        flyout.remove(); await settle()
        p.doc.body.append(p.doc.createElement('span')); await settle()
        p.ops.flyout(); await settle()
      })
  })

  it('applies cloud settings', async () => {
    for (const keys of [[], ['inhouse-read-shelf-lamps'], ['inhouse-read-theme', 'x'], ['inhouse-read-reading-preferences'], ['streak-key'],
      ['inhouse-read-shelf-a', 'inhouse-read-theme', 'inhouse-read-reading-preferences', 'streak-key'], ['inhouse-read-shelf']])
      await compare({ saved:'dark', theme:'light' }, p => p.ops.cloud(keys))
  })

  it('hides and shows the reader controls', async () => {
    for (const value of [true, false, 0, 'x', undefined, null])
      for (const screen of [{ readerVisible:true }, {}, { readerVisible:true, readerClass:'is-preparing' }, { readerVisible:true, readerClass:'is-opening-from-book' }])
        await compare({ ...screen, bodyClass:value ? '' : 'is-reader-focus' }, p => { p.ops.chrome(value); p.ops.chrome(!value) })
  })

  it('takes taps on the hidden controls’ margins and Escape', async () => {
    const click = (node, target, x) => {
      node.getBoundingClientRect = () => ({ left:10, width:200, top:0, height:40 })
      const event = new MouseEvent('click', { bubbles:true, clientX:x }); target.dispatchEvent(event)
    }
    for (const rtl of [false, true, undefined, 'yes'])
      for (const focus of [true, false])
        for (const panelOpen of [false, true])
          await compare({ rtl, panelOpen, readerVisible:true, bodyClass:focus ? 'is-reader-focus' : '' }, async p => {
            p.ops.watchControls()
            const header = p.doc.querySelector('.app-header'), toolbar = p.els.readerToolbar
            for (const x of [12, 100, 205, 66, 154]) { click(header, header, x); click(toolbar, toolbar, x) }
            click(header, header.querySelector('.inner'), 12); click(toolbar, toolbar.querySelector('.inner'), 205)
            for (const key of ['Enter', 'Escape']) {
              const event = new KeyboardEvent('keydown', { key, cancelable:true }); p.doc.dispatchEvent(event); p.record('prevented', event.defaultPrevented)
            }
            p.els.readerFocus.click()
            const event = new KeyboardEvent('keydown', { key:'Escape', cancelable:true }); p.doc.dispatchEvent(event); p.record('prevented', event.defaultPrevented)
          })
  })

  it('opens the picked file: a known book under its own id or a new one', async () => {
    const file = { name:'book.epub' }
    for (const files of [[], [file], null])
      for (const state of [{}, { pendingLocalReopenId:'id-1', pendingReaderTransition:{ flight:1 } }, { pendingLocalReopenId:'', pendingReaderTransition:'t' }])
        for (const fail of [[], ['open']])
          await compare({ state, fail }, async p => {
            Object.defineProperty(p.els.filePicker, 'files', { configurable:true, get:() => files })
            p.els.filePicker.setAttribute('value', 'chosen')
            await p.ops.picked(); p.record('value', p.els.filePicker.value)
          })
  })

  it('invalidates the prepared page on resize, reading settings, theme and viewport changes', async () => {
    await compare({}, async p => {
      p.ops.watchPrepared()
      globalThis.dispatchEvent(new Event('resize'))
      const panel = p.doc.querySelector('.reading-panel')
      for (const selector of ['[data-pref]', '.other']) panel.querySelector(selector).dispatchEvent(new Event('change', { bubbles:true }))
      for (const selector of ['[data-theme]', '[data-size-step]', '[data-reset]', '.other']) panel.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles:true }))
      p.doc.body.dispatchEvent(new MouseEvent('click', { bubbles:true }))
      p.doc.dispatchEvent(new Event('change'))
      p.doc.documentElement.setAttribute('data-theme', 'dark'); await settle()
      p.doc.documentElement.setAttribute('data-other', '1'); await settle()
      const observer = resizeObservers.at(-1)
      p.record('observed', observer?.node === p.els.readerViewport)
      for (const [width, height] of [[100, 50], [100, 50], [120.5, 50], [120.5, 50], [0, 0]]) {
        p.els.readerViewport.getBoundingClientRect = () => ({ width, height }); observer.callback([])
      }
    })
  })

  it('shows the sign-in notice', async () => {
    for (const message of ['', 'Conectando…', null, undefined])
      for (const options of [undefined, {}, { retry:true }, { pending:true }, { retry:1, pending:0 }, { retry:true, pending:true }])
        await compare({}, p => p.ops.auth(message, options))
  })

  it('lists Drive books and opens the chosen one', async () => {
    const files = [{ id:'drive-1', name:'Uno.pdf', mimeType:'application/pdf', size:'12', md5Checksum:'abc' },
      { id:'drive-2', name:'Dos.epub', mimeType:'application/epub+zip', size:'x', md5Checksum:'' }, { id:'drive-3', name:'Tres', size:-0 }]
    const cases = [{}, { session:true }, { fail:['access'] }, { fail:['profile'], code:{ profile:'ANDROID_SHELL_OUTDATED' } },
      { fail:['profile'], code:{ profile:'ANDROID_SHELL_OUTDATED' }, offer:true }, { fail:['list'] }, { files:[] }, { fail:['sync'] },
      { fail:['sync', 'progress'] }, { noDownload:true }, { noLatest:true }, { fail:['open'] }, { fail:['list-all'] }, { fail:['add'] },
      { fail:['download'] }, { state:{ driveProfile:{ id:'account' } } }, { books:[] }]
    for (const options of cases)
      await compare({ files, ...options }, async p => {
        await p.ops.drive(); await settle()
        for (const item of p.els.driveList.querySelectorAll('.drive-item')) { item.click(); await settle() }
        await p.ops.drive(); await settle()
        p.els.driveList.querySelector('.drive-item')?.click(); await settle()
      })
  })
})
