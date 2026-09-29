import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PDF_FIXTURE = path.join(__dirname, 'fixtures', 'tiny.pdf')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('carga el home con la marca y las acciones de cabecera', async ({ page }) => {
  await expect(page.locator('.app-header .logo')).toContainText('inhouse read')
  await expect(page.getByRole('button', { name: 'Elegir archivo del dispositivo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir desde Google Drive' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Conectar cuenta de Google' })).toBeVisible()
})

test('conecta Google sin redirección y muestra la foto en la esquina derecha', async ({ page }) => {
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: ''
  }))
  await page.addInitScript(() => {
    window.google = { accounts: { oauth2: { initTokenClient: options => {
      window.__oauthOptions = options
      return { requestAccessToken: () => options.callback({
        access_token: 'web-token', expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.file'
      }) }
    } } } }
  })
  await page.route('https://www.googleapis.com/drive/v3/about?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { permissionId: 'account-1', displayName: 'Miguel Caballero',
      emailAddress: 'miguel@example.com', photoLink: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==' } })
  }))
  await page.route('https://www.googleapis.com/drive/v3/files?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(route.request().url().includes('name+%3D+%27inhouse+read%27')
      ? { files: [{ id: 'root', name: 'inhouse read' }] } : { files: [] })
  }))
  await page.reload()
  await page.getByRole('button', { name: 'Conectar cuenta de Google' }).click()
  const button = page.getByRole('button', { name: 'Cuenta de Google: miguel@example.com' })
  await expect(button).toBeVisible()
  await expect(button.locator('img')).toBeVisible()
  // A display:grid fallback used to ignore hidden and push the photo below
  // the clipped avatar button, so the letter G remained visible after login.
  await expect(page.locator('#drive-profile-initial')).toBeHidden()
  const avatarBox = await button.locator('img').boundingBox()
  const buttonBox = await button.boundingBox()
  expect(Math.abs(avatarBox.y - buttonBox.y)).toBeLessThan(2)
  await expect(page.locator('#theme-toggle')).toBeHidden()
  await expect(page.locator('.app-header .logo')).toContainText('inhouse read')
  expect(await page.evaluate(() => window.__oauthOptions.redirect_uri)).toBeUndefined()
  await button.click()
  await expect(page.locator('#app-version')).toHaveText('Inhouse Read · v1.0.25')
  await expect(page.locator('#drive-theme-toggle')).toBeVisible()
  await expect(page.locator('#drive-profile-initial-menu')).toBeHidden()
  await page.locator('#drive-theme-toggle').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('Escape')
  await expect(page.locator('#drive-profile-menu')).toBeHidden()
  await expect(button).toBeFocused()
})

test('un error de Google permite reintentar sin alertas nativas', async ({ page }) => {
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ status:200, contentType:'text/javascript', body:'' }))
  await page.addInitScript(() => {
    window.google = { accounts: { oauth2: { initTokenClient: options => ({
      requestAccessToken: () => options.error_callback({ type:'popup_closed', message:'Se cerró la ventana de Google.' })
    }) } } }
  })
  await page.reload()
  await page.getByRole('button', { name:'Conectar cuenta de Google' }).click()
  await expect(page.locator('#drive-auth-notice')).toContainText('Se cerró la ventana de Google')
  await expect(page.getByRole('button', { name:'Reintentar' })).toBeVisible()
  await page.getByRole('button', { name:'Reintentar' }).click()
  await expect(page.getByRole('button', { name:'Conectar cuenta de Google' })).toBeEnabled()
})

test('muestra la cuenta de Google con su perfil y acciones de sincronización', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ihn_drive_tokens', JSON.stringify({
      accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresAt: Date.now() + 3600_000
    }))
  })
  await page.route('https://www.googleapis.com/drive/v3/about?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { displayName: 'Miguel Caballero', emailAddress: 'miguel@example.com', photoLink: '' } })
  }))
  await page.reload()
  const accountButton = page.getByRole('button', { name: 'Cuenta de Google: miguel@example.com' })
  await expect(accountButton).toBeVisible()
  await accountButton.click()
  await expect(page.locator('#drive-profile-menu')).toBeVisible()
  await expect(page.locator('#drive-profile-name')).toHaveText('Miguel Caballero')
  await expect(page.locator('#drive-profile-email')).toHaveText('miguel@example.com')
  await expect(page.getByRole('menuitem', { name: 'Sincronizar ahora' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeVisible()
})

test('una sesión caducada vuelve a mostrar Conectar y oculta el perfil', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ihr_drive_session_v2', JSON.stringify({
    accessToken: 'expired-server-token', expiresAt: Date.now() + 3600_000
  })))
  await page.route('https://www.googleapis.com/drive/v3/about?**', route => route.fulfill({
    status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid Credentials' } })
  }))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Conectar cuenta de Google' })).toBeVisible()
  await expect(page.locator('#drive-profile')).toBeHidden()
})

test('muestra el estado vacío cuando no hay libros recientes', async ({ page }) => {
  await expect(page.getByText('Tu estantería está vacía')).toBeVisible()
})

test('el botón de tema alterna data-theme en <html>', async ({ page }) => {
  const html = page.locator('html')
  const initial = await html.getAttribute('data-theme')
  await page.getByRole('button', { name: 'Cambiar tema' }).click()
  await expect(html).not.toHaveAttribute('data-theme', initial ?? '')
})

test('abre un PDF local y navega al visor de lectura', async ({ page }) => {
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)

  const readerScreen = page.locator('#reader-screen')
  await expect(readerScreen).toBeVisible()
  await expect(page.locator('#reader-format-badge')).toHaveText('PDF')

  // PDF.js debe haber renderizado un <canvas> con contenido real.
  const canvas = page.locator('.pdf-page-canvas')
  await expect(canvas).toBeVisible()
  const canvasSize = await canvas.evaluate(el => ({ w: el.width, h: el.height }))
  expect(canvasSize.w).toBeGreaterThan(0)
  expect(canvasSize.h).toBeGreaterThan(0)
})

test('edita y conserva el color, fuente, tamaño y texto del lomo', async ({ page }) => {
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()

  const spine = page.locator('.ihr-spine').first()
  await expect(spine).toBeVisible()
  const original = await spine.evaluate(node => getComputedStyle(node).getPropertyValue('--ihr-spine-base').trim())
  await spine.click()
  const dialog = page.locator('.ihr-flyout')
  await expect(dialog).toHaveClass(/is-ready/)
  await dialog.getByRole('button', { name:'Editar' }).click()
  const swatches = dialog.locator('.ihr-flyout__swatch')
  await expect(swatches).toHaveCount(3)
  const chosen = await swatches.nth(1).getAttribute('data-color')
  await swatches.nth(1).click()
  await expect(swatches.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => spine.evaluate(node => getComputedStyle(node).getPropertyValue('--ihr-spine-base').trim()))
    .not.toBe(original)
  const custom = '#3b72a5'
  await dialog.locator('input[type="color"]').evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, custom)
  await expect.poll(() => spine.evaluate(node => getComputedStyle(node).getPropertyValue('--ihr-spine-base').trim())).toBe(custom)
  await expect(dialog.locator('.ihr-flyout__custom-color')).toHaveClass(/is-selected/)
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const request = db.transaction('books', 'readonly').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result[0])
      request.onerror = () => reject(request.error)
    })
  })).toMatchObject({ spineColorOverride: custom })

  await dialog.getByLabel('Fuente del lomo', { exact:true }).selectOption('Lora')
  await dialog.getByLabel('Tamaño de fuente del lomo').evaluate(input => {
    input.value = '14'
    input.dispatchEvent(new Event('input', { bubbles:true }))
  })
  await dialog.getByLabel('Texto del lomo').fill('Mi título personalizado')
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const request = db.transaction('books', 'readonly').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result[0])
      request.onerror = () => reject(request.error)
    })
  })).toMatchObject({
    spineColorOverride: custom,
    spineFontFamily: 'Lora',
    spineFontSize: 14,
    spineTitleOverride: 'Mi título personalizado'
  })

  await dialog.getByRole('button', { name:'Listo' }).click()
  await dialog.locator('.ihr-flyout__close').click()
  await expect(dialog).toBeHidden()
  await page.reload()
  const reopenedSpine = page.locator('.ihr-spine').first()
  await expect(reopenedSpine).toBeVisible()
  await expect.poll(() => reopenedSpine.evaluate(node => getComputedStyle(node).getPropertyValue('--ihr-spine-base').trim())).toBe(custom)
  await reopenedSpine.click()
  const reopenedDialog = page.locator('.ihr-flyout')
  await expect(reopenedDialog).toHaveClass(/is-ready/)
  await reopenedDialog.getByRole('button', { name:'Editar' }).click()
  await expect(reopenedDialog.locator('.ihr-flyout__custom-color')).toHaveClass(/is-selected/)
  await expect(reopenedDialog.locator('input[type="color"]')).toHaveValue(custom)
  await expect(reopenedDialog.getByLabel('Fuente del lomo', { exact:true })).toHaveValue('Lora')
  await expect(reopenedDialog.getByLabel('Tamaño de fuente del lomo')).toHaveValue('14')
  await expect(reopenedDialog.getByLabel('Texto del lomo')).toHaveValue('Mi título personalizado')
})

test('organiza los libros con teclado, animación 3D y orden persistente', async ({ page }) => {
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('books', 'readwrite')
    const store = transaction.objectStore('books')
    const now = Date.now()
    store.put({ id:'shelf:alpha', title:'Alpha', author:'Autor', format:'PDF', sourceType:'local', addedAt:now, lastOpenedAt:now, progressFraction:0 })
    store.put({ id:'shelf:bravo', title:'Bravo', author:'Autor', format:'PDF', sourceType:'local', addedAt:now, lastOpenedAt:now - 1, progressFraction:0 })
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
  })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(2)
  const original = await page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId))
  await page.getByRole('button', { name:'Organizar' }).click()
  const firstSpine = page.locator('.ihr-spine').first()
  await firstSpine.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId)))
    .toEqual([...original].reverse())
  await page.waitForTimeout(560)
  const from = await page.locator('.ihr-spine[data-book-id="shelf:bravo"]').boundingBox()
  const to = await page.locator('.ihr-spine[data-book-id="shelf:alpha"]').boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width * .82, to.y + to.height / 2, { steps:8 })
  await page.mouse.up()
  await expect.poll(() => page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId)))
    .toEqual(original)
  const animated = await page.locator('.ihr-spine').first().evaluate(node =>
    node.getAnimations().some(animation => animation.effect?.getKeyframes().some(frame => /rotateY/.test(frame.transform || '')))
  )
  expect(animated).toBe(true)
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const request = db.transaction('books', 'readonly').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result.sort((a, b) => a.shelfOrder - b.shelfOrder).map(book => book.id))
      request.onerror = () => reject(request.error)
    })
  })).toEqual(original)
  await page.reload()
  await expect.poll(() => page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId)))
    .toEqual(original)
})

test('el libro abierto reaparece en la estantería al volver', async ({ page }) => {
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)

  await expect(page.locator('.pdf-page-canvas')).toBeVisible()

  // El registro en IndexedDB se guarda de forma asíncrona después de que el
  // PDF termina de renderizarse. Esperamos a que exista de verdad antes de
  // pulsar "volver", en vez de asumir un orden de timing concreto.
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('inhouse-read')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const count = await new Promise((resolve, reject) => {
      const req = db.transaction('books', 'readonly').objectStore('books').count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return count > 0
  })

  await page.getByRole('button', { name: 'Volver a la estantería' }).click()

  await expect(page.locator('#home-screen')).toBeVisible()
  await expect(page.getByRole('button', { name: /Abrir tiny/i })).toBeVisible()
})
