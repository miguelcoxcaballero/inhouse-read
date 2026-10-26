// Frozen 1.7.324 application shell of src/js/app.js, before it moved to rust-ui/src/app_shell.rs.
// The bodies are verbatim; top-level listener registrations are wrapped in functions so that
// tests/unit/app-shell-native-differential.test.js can evaluate them inside a scripted host (`with(env)`).

// The browser chrome (PWA/Chrome toolbar) takes the header's surface colour.
export function syncThemeColor(theme) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1c1c1c' : '#ffffff')
}

export function initTheme() {
  const saved = localStorage.getItem('inhouse-read-theme')
  const preferred = saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  document.documentElement.setAttribute('data-theme', preferred)
  syncThemeColor(preferred)
}

export function themeToggleClick() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  syncThemeColor(next)
  localStorage.setItem('inhouse-read-theme', next)
  notifyCloudSettingsChanged('inhouse-read-theme')
  if (els.driveThemeToggle) els.driveThemeToggle.checked = next === 'dark'
}

export function driveThemeChange() {
  const theme = els.driveThemeToggle.checked ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', theme)
  syncThemeColor(theme)
  localStorage.setItem('inhouse-read-theme', theme)
  notifyCloudSettingsChanged('inhouse-read-theme')
}

export function applyCloudSettings(keys) {
    const room = keys.filter(key => key.startsWith('inhouse-read-shelf-'))
    if (room.length) cloudRoomChanged = true
    if (keys.includes('inhouse-read-theme')) initTheme()
    if (keys.includes('inhouse-read-reading-preferences')) readingExperience.reloadPreferences()
    if (keys.includes(STREAK_KEY)) readingStreak.reconcile()
    refreshShelf()
}

export function scheduleLengthRefresh() {
  if (appDisposed || document.hidden || !els.readerScreen.hidden || lengthRefreshTimer != null) return
  lengthRefreshTimer = setTimeout(() => {
    lengthRefreshTimer = null
    if (!appDisposed && !document.hidden && els.readerScreen.hidden) {
      refreshShelf().catch(error => console.warn('No se pudo actualizar la estantería:', error))
    }
  }, 80)
}

export function showScreen(name) {
  if (name !== 'reader') {
    document.body.classList.remove('is-reader-focus')
    const header = document.querySelector('.app-header')
    header.style.removeProperty('color-scheme')
    delete header.dataset.readingTheme
  }
  document.body.classList.toggle('is-reading', name === 'reader')
  els.homeScreen.hidden = name !== 'home'
  els.readerScreen.hidden = name !== 'reader'
  setShelfWorkActive(name === 'home')
  shelf?.setPresentationActive?.(name === 'home')
  if (name === 'home' && shelfRefreshDeferred && !closingReader) refreshShelf().catch(error => console.warn('Estantería pendiente:', error))
  if (name === 'home' && shelfLengthStatusVersion !== lengthStatusVersion) scheduleLengthRefresh()
}

export function retryRoomRefresh() {
  if (roomRefreshRetry != null || appDisposed || document.hidden) return
  roomRefreshRetry = setTimeout(() => { roomRefreshRetry = null; refreshShelf() }, 150)
}

// The flyout branch of performShelfRefresh.
export function refreshAfterFlyout() {
  if (document.querySelector('.ihr-flyout')) {
    if (!shelfRefreshQueued) {
      shelfRefreshQueued = true
      const observer = new MutationObserver(() => {
        if (document.querySelector('.ihr-flyout')) return
        observer.disconnect()
        shelfRefreshQueued = false
        refreshShelf()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }
    return
  }
}

export function setReaderChromeHidden(hidden) {
  if (els.readerScreen.hidden || els.readerScreen.classList.contains('is-preparing') ||
      els.readerScreen.classList.contains('is-opening-from-book')) return
  const focus = Boolean(hidden)
  document.body.classList.toggle('is-reader-focus', focus)
  els.readerFocus.setAttribute('aria-pressed', String(focus))
  els.readerFocus.setAttribute('aria-label', focus ? 'Mostrar controles' : 'Ocultar controles')
  if (focus) els.readerViewport.focus({ preventScroll:true })
}

export function watchReaderControls() {
els.readerFocus.addEventListener('click', () => setReaderChromeHidden(true))
// The blank margins left by hidden controls still take taps like the page does:
// the edges turn pages and the centre brings the controls back. Their buttons
// are invisible and unreachable, so only a tap on the margin itself lands here.
for (const margin of [document.querySelector('.app-header'), els.readerToolbar]) {
  margin.addEventListener('click', event => {
    if (event.target !== margin || !document.body.classList.contains('is-reader-focus')) return
    const bounds = margin.getBoundingClientRect()
    const zone = classifyTapZone(event.clientX - bounds.left, bounds.width)
    if (zone === ZONE.CENTER) return setReaderChromeHidden(false)
    const forward = (zone === ZONE.NEXT) !== reader.rtl
    readingExperience.step(forward ? 1 : -1)
  })
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('is-reader-focus') && !readingExperience.panel.open) {
    setReaderChromeHidden(false)
    els.readerFocus.focus({ preventScroll:true })
    event.preventDefault()
  }
})
}

export async function filePicked() {
  const file = els.filePicker.files?.[0]
  els.filePicker.value = ''
  if (!file) return

  // Reabrir un libro ya conocido (el fallback de arriba): no hay que
  // volver a guardarlo en la carpeta, solo abrirlo con el mismo id.
  if (pendingLocalReopenId) {
    const forcedId = pendingLocalReopenId
    pendingLocalReopenId = null
    const transition = pendingReaderTransition
    pendingReaderTransition = null
    try { await openFile(file, { forcedId, transition }) }
    catch (error) { alert(error.message) }
    return
  }

  // IndexedDB keeps the original bytes on this device without a folder picker
  // or a Google connection. The folder path above only recovers legacy books.
  try { await openFile(file, { restoreRemoved:true }) }
  catch (error) { alert(error.message) }
}

export function watchPreparedPages() {
// A resized window or a rotated phone changes the page's pixels and layout.
globalThis.addEventListener('resize', () => preparedPages.invalidate('resize'))
// Settings can change while a lifted book still owns the hidden reader.
document.addEventListener('change', event => {
  if (event.target.closest?.('.reading-panel [data-pref]')) preparedPages.invalidate('preferences')
})
document.addEventListener('click', event => {
  if (event.target.closest?.('.reading-panel [data-theme], .reading-panel [data-size-step], .reading-panel [data-reset]')) {
    preparedPages.invalidate('preferences')
  }
})
new MutationObserver(() => preparedPages.invalidate('theme')).observe(document.documentElement,
  { attributes:true, attributeFilter:['data-theme'] })
if (typeof ResizeObserver === 'function') {
  let viewportBox = null
  new ResizeObserver(() => {
    const box = els.readerViewport.getBoundingClientRect()
    const key = `${box.width}x${box.height}`
    if (viewportBox !== null && key !== viewportBox) preparedPages.invalidate('viewport')
    viewportBox = key
  }).observe(els.readerViewport)
}
}

export function showAuthNotice(message, { retry = false, pending = false } = {}) {
  authMessage.textContent = message
  authNotice.hidden = !message
  authRetry.hidden = !retry
  authCancel.hidden = !pending
}

export function openDriveModal() {
  els.driveModal.hidden = false
  loadDriveFiles()
}

export async function loadDriveFiles() {
  els.driveStatus.textContent = 'Conectando con Drive…'
  els.driveList.innerHTML = ''
  try {
    if (!hasDriveSession()) await requestDriveAccess()
    await loadDriveAccountProfile()
    const files = await listAllDriveBooks()
    els.driveStatus.textContent = files.length ? '' : 'Sin libros en Drive.'
    for (const f of files) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'drive-item'
      item.textContent = f.name
      item.addEventListener('click', async () => {
        els.driveModal.hidden = true
        try {
          const record = (await library.listAll()).find(book => book.driveFileId === f.id)
            || await library.addOrTouch({ sourceType: 'drive', driveFileId: f.id, cloudAccountId: driveProfile?.id,
              name: f.name, title: normalizeBookTitle(f.name), mimeType: f.mimeType, size: Number(f.size) || 0,
              driveContentChecksum:f.md5Checksum || null }, { restoreRemoved:true })
          const file = await cloudSync.downloadForOffline(record)
          if (!file) return
          try { await cloudSync.syncBookProgress(record.id) }
          catch (error) { console.warn('No se pudo recuperar el progreso de Drive; se abrirá la copia descargada:', error) }
          const latest = await library.get(record.id)
          if (!latest) return
          await openFile(file, { existingRecord: latest, forcedId: latest.id, reuseStoredContent:true })
        } catch (error) { alert(`No se pudo abrir el libro: ${error.message}`) }
      })
      els.driveList.append(item)
    }
    syncLibraryToDrive({ silent: true }).catch(error => {
      setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`)
      console.warn('No se pudieron sincronizar los libros pendientes:', error)
    })
  } catch (err) {
    if (err?.code === 'ANDROID_SHELL_OUTDATED' && await offerAvailableAndroidUpdate()) {
      els.driveModal.hidden = true
    } else {
      els.driveStatus.textContent = err?.code === 'ANDROID_SHELL_OUTDATED'
        ? 'Drive aún no está disponible en Android. Usa la web.'
        : `No se pudo conectar con Drive: ${err.message}`
    }
  }
}

// The start-up of the header, before `deployCheck`.
export function startShell() {
initTheme()
els.driveThemeToggle.checked = document.documentElement.getAttribute('data-theme') === 'dark'
// The published version, from package.json: it changes with every release.
els.appVersion.textContent = `Inhouse Read · v${APP_VERSION}`
els.addDriveBtn.disabled = !isDriveConfigured()
els.addDriveBtn.title = isDriveConfigured() ? '' : 'Drive no disponible'
showScreen('home')
}
