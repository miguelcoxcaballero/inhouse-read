import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initReadingDisplay } from '../../src/js/reading-display.js'

// A shell that draws the page behind its status bar (getSafeTopInset): hiding
// the bar resizes nothing, so it follows the book's own motion.
let policy, calls, request, visibility, screen
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const classes = async value => { document.body.className = value; await settle() }
const owned = () => calls.filter(([name]) => name === 'owner').map(([, value]) => value)
const icons = () => calls.filter(([name]) => name === 'light').map(([, value]) => value)
const shell = (extra = {}) => ({
  getSafeTopInset:() => 32,
  setReaderOwnership:value => calls.push(['owner', value, document.body.className]),
  setReadingMode:value => calls.push(['legacy', value]),
  setStatusBarAppearance:value => calls.push(['light', value, document.body.className]),
  ...extra
})

beforeEach(() => {
  document.body.className = ''; calls = []; visibility = 'visible'
  document.documentElement.setAttribute('data-theme', 'light')
  screen = document.createElement('div'); screen.id = 'reader-screen'
  screen.dataset.readingTheme = 'night'; screen.style.colorScheme = 'dark'
  document.body.append(screen)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  request = vi.fn(async () => { const lock = new EventTarget(); lock.release = vi.fn(async () => {}); return lock })
  window.InhouseNative = shell()
})
afterEach(async () => {
  policy?.dispose(); policy = null; await settle()
  delete window.InhouseNative; document.body.className = ''
  document.getElementById('android-update-gate')?.remove(); screen.remove()
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})
const start = () => { policy = initReadingDisplay({ navigator:{ wakeLock:{ request } } }) }

describe('stable top inset shells', () => {
  it('hide the bar when the page starts zooming in, not before, and keep it hidden after the opening', async () => {
    start()
    await classes('is-reading is-opening-reader')
    expect(owned()).toEqual([false])
    await classes('is-reading is-opening-reader is-reader-page-arriving')
    expect(owned()).toEqual([false, true])
    expect(calls.find(([name, value]) => name === 'owner' && value)[2]).toContain('is-opening-reader')
    await classes('is-reading')
    expect(owned()).toEqual([false, true])
    // The browser wake lock keeps its own policy: it starts once reading.
    expect(request).toHaveBeenCalledTimes(1)
    expect(calls.some(([name]) => name === 'legacy')).toBe(false)
  })

  it('show the bar again as the 3D book takes the page back, before the flight ends', async () => {
    start(); await classes('is-reading')
    await classes('is-reading is-closing-reader')
    await classes('is-closing-reader')
    expect(owned()).toEqual([false, true])
    await classes('is-closing-reader is-reader-page-leaving')
    expect(owned()).toEqual([false, true, false])
    await classes('')
    expect(owned()).toEqual([false, true, false])
  })

  it('show the bar again when an opening is cancelled after the zoom began', async () => {
    start()
    await classes('is-reading is-opening-reader is-reader-page-arriving')
    await classes('')
    expect(owned()).toEqual([false, true, false])
    expect(request).not.toHaveBeenCalled()
  })

  it('ignore stray motion classes outside their own transition', async () => {
    start()
    await classes('is-reader-page-arriving')
    await classes('is-reading is-reader-page-leaving')
    expect(owned()).toEqual([false, true])
    await classes('is-reader-page-leaving')
    expect(owned()).toEqual([false, true, false])
  })

  it('older shells keep the old timing: only after the opening and after the return', async () => {
    window.InhouseNative = shell({ getSafeTopInset:undefined, setStatusBarAppearance:undefined })
    start()
    await classes('is-reading is-opening-reader is-reader-page-arriving')
    expect(owned()).toEqual([false])
    await classes('is-reading')
    await classes('is-closing-reader is-reader-page-leaving')
    expect(owned()).toEqual([false, true])
    await classes('')
    expect(owned()).toEqual([false, true, false])
    expect(icons()).toEqual([])
  })

  it('match the icons to the app theme, then to the reading paper while the book owns the display', async () => {
    start()
    expect(icons()).toEqual([true])
    await classes('is-reading is-opening-reader is-reader-page-arriving')
    // Still the shelf's flyout under the fading bar.
    expect(icons()).toEqual([true])
    await classes('is-reading')
    expect(icons()).toEqual([true, false])
    await classes('is-closing-reader is-reader-page-leaving')
    expect(icons()).toEqual([true, false, true])
    // The icons change before the bar comes back.
    const order = calls.slice(-2).map(([name, value]) => [name, value])
    expect(order).toEqual([['light', true], ['owner', false]])
  })

  it('follow theme switches, reading-theme switches and the update notice', async () => {
    start(); await classes('is-reading')
    expect(icons()).toEqual([true, false])
    screen.style.colorScheme = 'light'; screen.dataset.readingTheme = 'sepia'; await settle()
    expect(icons()).toEqual([true, false, true])
    await classes('')
    document.documentElement.setAttribute('data-theme', 'dark'); await settle()
    expect(icons()).toEqual([true, false, true, false])
    document.documentElement.setAttribute('data-theme', 'light'); await settle()
    const gate = document.createElement('div'); gate.id = 'android-update-gate'
    document.body.append(gate); await settle()
    expect(icons()).toEqual([true, false, true, false, true, false])
    gate.remove(); await settle()
    expect(icons().at(-1)).toBe(true)
  })

  it('match the icons to the catalogue backdrop over the strip: paper when flown into, dimmed room otherwise', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    start()
    expect(icons()).toEqual([false])
    const catalog = document.createElement('dialog'); catalog.className = 'ihr-plant-catalog'
    document.body.append(catalog); await settle()
    expect(icons()).toEqual([false])
    // showModal and the camera flight start in the same task.
    catalog.setAttribute('open', ''); catalog.dataset.catalogCamera = 'opening'; await settle()
    expect(icons()).toEqual([false, true])
    catalog.dataset.catalogCamera = 'in'; await settle()
    expect(icons()).toEqual([false, true])
    delete catalog.dataset.catalogCamera; catalog.removeAttribute('open'); await settle()
    expect(icons()).toEqual([false, true, false])
    document.documentElement.setAttribute('data-theme', 'light'); await settle()
    expect(icons().at(-1)).toBe(true)
    // Without the flight (reduced motion) the room is dimmed: light icons.
    catalog.setAttribute('open', ''); await settle()
    expect(icons().at(-1)).toBe(false)
    catalog.removeAttribute('open'); await settle()
    expect(icons().at(-1)).toBe(true)
    catalog.remove()
  })

  it('use the app theme when the reader has no reading scheme yet', async () => {
    screen.style.colorScheme = ''
    document.documentElement.setAttribute('data-theme', 'dark')
    start(); await classes('is-reading')
    expect(icons()).toEqual([false])
  })

  it('release ownership on pagehide and resend both states after a cached pageshow', async () => {
    start(); await classes('is-reading')
    window.dispatchEvent(new Event('pagehide')); await settle()
    expect(owned().at(-1)).toBe(false)
    const before = icons().length
    window.dispatchEvent(new Event('pageshow')); await settle()
    expect(owned().at(-1)).toBe(true)
    expect(icons().length).toBe(before + 1)
  })
})
