// Frozen app cloud flow before the Rust account/actions migration (test-only).
export function referenceAppCloudActions(host) {
 const {state,els,cloudSync,library,liveRoom,libraryBackup,profileView,hasDriveSession,
 requestDriveAccess,getDriveProfile,getRememberedDriveProfile,isAndroidShell,
 restoreLegacyBookBytes,showAuthNotice,closeProfileMenu,offerAvailableAndroidUpdate,
 document,console}=host
async function handleCoverAction(action, book, button) {
  button.disabled = true
  // The shelf renders a long and a short (narrow screens) label; keep both in
  // step, each with its own wording so the short one never truncates. An
  // icon-only button keeps its icon and says it in its accessible name.
  const labels = button.classList.contains('ihr-btn--icon') ? []
    : button.querySelectorAll('span').length ? [...button.querySelectorAll('span')] : [button]
  const originals = labels.map(label => label.textContent)
  const originalAria = button.getAttribute('aria-label')
  const setLabel = (text, short = text) => {
    labels.forEach(label => { label.textContent = label.classList.contains('ihr-btn__label--short') ? short : text })
    button.setAttribute('aria-label', text)
    if (button.classList.contains('ihr-btn--icon')) button.title = text
  }
  const restoreLabel = () => {
    labels.forEach((label, index) => { label.textContent = originals[index] })
    if (originalAria) button.setAttribute('aria-label', originalAria)
    else button.removeAttribute('aria-label')
    if (originalAria && button.classList.contains('ihr-btn--icon')) button.title = originalAria
  }
  let saved = false
  setLabel(action === 'offline' ? 'Descargando…' : 'Guardando…', action === 'offline' ? 'Offline…' : 'Drive…')
  button.setAttribute('aria-busy', 'true')
  try {
    if (action === 'offline') {
      if (book.content) {
        setLabel('Disponible offline', 'Offline')
        saved = true
        return
      }
      if (!hasDriveSession()) await requestDriveAccess()
      if (book.driveFileId) {
        await cloudSync.downloadForOffline(book)
      } else throw new Error('Este libro ya tiene su copia en el dispositivo.')
      setLabel('Disponible offline', 'Offline')
      saved = true
    } else if (action === 'drive') {
      if (!hasDriveSession()) throw new Error('Conecta tu cuenta de Google para subir este libro.')
      const updated = await uploadBookToDrive(book)
      if (!updated) return
      Object.assign(book, updated)
      // The same discreet Drive mark, with a small tick.
      const status = document.createElement('span')
      status.className = 'ihr-btn ihr-btn--quiet ihr-btn--icon ihr-flyout__cloud-saved'
      status.setAttribute('role', 'status')
      status.setAttribute('aria-label', 'Guardado en Google Drive')
      status.title = 'Guardado en Google Drive'
      const icon = button.querySelector('svg')?.cloneNode(true)
      if (icon) status.append(icon)
      const check = document.createElement('span')
      check.className = 'ihr-flyout__cloud-check'
      check.setAttribute('aria-hidden', 'true')
      check.innerHTML = '<svg class="ihr-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>'
      status.append(check)
      button.replaceWith(status)
      saved = true
    }
  } catch (error) {
    restoreLabel()
    await reportDriveConnectionError(error)
  } finally {
    button.disabled = saved
    button.removeAttribute('aria-busy')
  }
}

async function uploadBookToDrive(book) {
  state.driveUploadsInFlight += 1
  try {
    const updated = await cloudSync.uploadBook(book)
    if (!updated) return null
    // The file is saved already. Its progress update stays asynchronous so a
    // slow network cannot hold up opening the cover or returning to the shelf.
    cloudSync.flushProgress(updated.id)
      .catch(error => setDriveSyncStatus(`Progreso pendiente: ${error.message}`))
    setDriveSyncStatus('Guardado en Google Drive')
    return updated
  } finally {
    state.driveUploadsInFlight = Math.max(0, state.driveUploadsInFlight - 1)
    if (!state.driveUploadsInFlight) {
      els.driveUploadScreen.hidden = true
      els.driveUploadScreen.setAttribute('aria-busy', 'false')
    }
  }
}

function setDriveSyncStatus(message, syncing = false) {
  profileView.syncStatus(message, syncing)
}

async function loadDriveAccountProfile() {
  if (!hasDriveSession()) {
    state.driveProfile = null
    cloudSync.reset()
    liveRoom.pause()
    libraryBackup.reset()
    profileView.visibility(false)
    profileView.localAccount()
    return null
  }
  profileView.visibility(true)
  const previousAccount = state.driveProfile?.id
  try {
    state.driveProfile = await getDriveProfile()
  } catch (error) {
    console.warn('No se pudo cargar el perfil de Google:', error)
    if (!hasDriveSession()) return loadDriveAccountProfile()
    state.driveProfile = getRememberedDriveProfile()
    if (!state.driveProfile?.id) throw new Error('No se pudo identificar la cuenta de Google. Vuelve a conectar.')
    setDriveSyncStatus(`Perfil guardado · ${error.message}`)
  }
  if (previousAccount && previousAccount !== state.driveProfile?.id) { liveRoom.pause(); libraryBackup.reset(); cloudSync.reset() }
  cloudSync.setProfile(state.driveProfile)
  profileView.account(state.driveProfile)
  return state.driveProfile
}

async function syncLibraryToDrive({ silent = false, poll = false } = {}) {
  if (!hasDriveSession()) {
    if (silent) {
      // Android uses the same PKCE refresh-token flow as Inhouse Notes.
      const nativeShell = isAndroidShell()
      if (!nativeShell || !getRememberedDriveProfile()) return
      try { await requestDriveAccess({ interactive: false }) } catch { return }
    } else await requestDriveAccess()
  }
  const profile = state.driveProfile || await loadDriveAccountProfile()
  if (!profile) {
    if (silent) return
    throw new Error('Sesión caducada. Pulsa Conectar.')
  }
  try { if (!poll) await restoreLegacyBookBytes(library) }
  catch (error) { console.warn('No se pudieron recuperar libros antiguos de la carpeta local:', error) }
  return poll ? libraryBackup.poll(profile.id) : libraryBackup.sync(profile.id)
}

async function connectGoogleAccount() {
  closeProfileMenu()
  els.driveConnectBtn.disabled = true
  showAuthNotice('Completa el acceso en Google.', { pending: true })
  try {
    await requestDriveAccess()
    showAuthNotice('')
    await syncLibraryToDrive()
  }
  catch (error) { await reportDriveConnectionError(error) }
  finally { els.driveConnectBtn.disabled = false }
}
async function reportDriveConnectionError(error) {
  if (error?.code === 'ANDROID_SHELL_OUTDATED') {
    if (await offerAvailableAndroidUpdate()) return
    showAuthNotice('Actualiza la app para conectar Drive.', { retry: true })
    return
  }
  showAuthNotice(error.message === 'Conexión cancelada.' ? '' : `No se pudo conectar. ${error.message}`, { retry: true })
}

 return {handleCoverAction,uploadBookToDrive,loadDriveAccountProfile,syncLibraryToDrive,connectGoogleAccount,reportDriveConnectionError}
}
