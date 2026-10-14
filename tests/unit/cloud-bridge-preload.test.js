import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// What the JavaScript side of the cloud code does while the Rust UI module is still on its way: the
// trash gesture and the sign-out act at once, a progress request is held (and dropped by a reset),
// a callback from the Android shell is answered immediately and handled when the module arrives.
const runtime = vi.hoisted(() => ({ ui: null, gate: null }))
vi.mock('../../src/js/rust-ui.js', () => ({ getRustUI: () => runtime.ui, requireRustUI: () => runtime.gate }))
vi.mock('../../src/js/idle-startup.js', () => ({ shelfPresented: async () => true }))

let ui
beforeEach(async () => {
  vi.resetModules()
  ui = await import('../../src/wasm/ui/inhouse_read_ui.js')
  ui.initSync({ module: readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') })
  localStorage.clear()
  let release
  runtime.ui = null
  runtime.gate = new Promise(resolve => { release = () => resolve(ui) })
  runtime.release = release
})
afterEach(() => { vi.unstubAllGlobals(); delete globalThis.handleInhouseNativeOAuth })

describe('before the module is in memory', () => {
  it('trashing a book does not wait for the module', async () => {
    const { CloudSync } = await import('../../src/js/cloud-sync.js')
    const removed = []
    const library = { removeFromShelf: vi.fn(async (book, options) => { removed.push([book.id, options]); return { id: book.id } }) }
    const sync = new CloudSync(library)
    expect(await sync.removeFromShelf({ id: 'book-1' }, { removedAt: 5 })).toEqual({ id: 'book-1' })
    expect(await sync.removeFromShelf(null)).toBeNull()
    expect(await sync.removeFromShelf({})).toBeNull()
    expect(removed).toEqual([['book-1', { removedAt: 5 }]])
  })

  it('a progress request waits for the module, and a reset drops it', async () => {
    const { CloudSync } = await import('../../src/js/cloud-sync.js')
    const library = { get: vi.fn(async () => null) }
    const sync = new CloudSync(library)
    sync.scheduleProgress('kept'); sync.scheduleProgress('dropped')
    sync.reset()
    sync.scheduleProgress('after-reset')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      runtime.ui = ui; runtime.release()
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(1800)
      await vi.advanceTimersByTimeAsync(10)
    } finally { vi.useRealTimers() }
    // Only the request made after the reset reaches the library (the earlier two were dropped).
    expect(library.get.mock.calls.map(call => call[0])).toEqual(['after-reset'])
  })

  it('signing out clears the stored session at once, before any module', async () => {
    localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken: 't', expiresAt: Date.now() + 3_600_000 }))
    localStorage.setItem('ihr_drive_refresh_token_v1', 'r')
    localStorage.setItem('ihr_drive_profile_v2', '{}')
    localStorage.setItem('ihr_drive_pkce_verifier_v1', 'v')
    localStorage.setItem('ihr_drive_pkce_transaction_v1', '{}')
    const drive = await import('../../src/js/drive-client.js')
    expect(drive.hasDriveSession()).toBe(true)
    drive.signOutDrive()
    expect(drive.hasDriveSession()).toBe(false)
    expect(localStorage.length).toBe(0)
    drive.cancelDriveConnection()
  })

  it('answers the Android callback at once and handles it when the module arrives', async () => {
    const drive = await import('../../src/js/drive-client.js')
    localStorage.setItem('ihr_drive_pkce_verifier_v1', 'saved-verifier')
    localStorage.setItem('ihr_drive_pkce_transaction_v1', JSON.stringify({ state: 'saved-state', createdAt: Date.now() }))
    const events = []
    globalThis.addEventListener('inhouse-drive-auth', event => events.push(event.detail))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' }))))
    expect(globalThis.handleInhouseNativeOAuth('state=saved-state&code=c')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    runtime.ui = ui; runtime.release()
    await vi.waitFor(() => expect(events).toEqual([{ connected: true }]))
    expect(drive.hasDriveSession()).toBe(true)
  })

  it('the library backup stores its device id when its Rust object is made, and a sync waits for it', async () => {
    const { LibraryBackup } = await import('../../src/js/library-backup.js')
    const values = new Map()
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
    const backup = new LibraryBackup({}, {}, { storage })
    backup.reset()
    expect(backup.task).toBeNull()
    expect(values.size).toBe(0)
    const pending = backup.sync('').catch(error => error.message)
    runtime.ui = ui; runtime.release()
    expect(await pending).toBe('Conecta tu cuenta de Google para guardar la biblioteca.')
    expect(values.get('inhouse-read-backup-device')).toBeTruthy()
  })
})
