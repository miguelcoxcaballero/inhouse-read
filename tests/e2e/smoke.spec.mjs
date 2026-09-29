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
  await expect(page.locator('#app-version')).toHaveText('Inhouse Read · v1.5.2')
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
  await expect(page.locator('.ihr-empty .ihr-shelf')).toHaveCount(3)
  await expect(page.locator('.ihr-section__title')).toHaveCount(0)
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
  await page.setViewportSize({ width:390, height:844 })
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
  await expect.poll(() => dialog.locator('.ihr-flyout__colors').evaluate(row => row.scrollWidth <= row.clientWidth + 1)).toBe(true)
  const pipette = dialog.getByRole('button', { name:'Elegir color de la portada' })
  await pipette.click()
  await expect(dialog).toHaveClass(/is-picking-color/)
  const colorHandle = dialog.locator('.ihr-color-pick__handle')
  const handleBox = await colorHandle.boundingBox()
  const coverBox = await dialog.locator('.ihr-book-canvas').boundingBox()
  expect(handleBox).not.toBeNull()
  expect(coverBox).not.toBeNull()
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(coverBox.x + coverBox.width * .35, coverBox.y + coverBox.height * .35, { steps:8 })
  await page.mouse.up()
  await expect(dialog).not.toHaveClass(/is-picking-color/)
  const pipetteColor = await colorHandle.getAttribute('data-color')
  expect(pipetteColor).toMatch(/^#[\da-f]{6}$/i)
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const request = db.transaction('books', 'readonly').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result[0]?.spineColorOverride)
      request.onerror = () => reject(request.error)
    })
  })).toBe(pipetteColor)
  const swatches = dialog.locator('.ihr-flyout__swatch')
  await expect(swatches).toHaveCount(3)
  const chosen = await swatches.nth(1).getAttribute('data-color')
  await swatches.nth(1).click()
  await expect(swatches.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => spine.evaluate(node => getComputedStyle(node).getPropertyValue('--ihr-spine-base').trim()))
    .not.toBe(original)
  const custom = '#3b72a5'
  await dialog.getByLabel('Elegir otro color para el lomo').evaluate((input, value) => {
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
  await dialog.getByLabel('Tamaño del título del lomo').evaluate(input => {
    input.value = '42'
    input.dispatchEvent(new Event('input', { bubbles:true }))
  })
  await dialog.getByLabel('Tamaño del autor del lomo').evaluate(input => {
    input.value = '30'
    input.dispatchEvent(new Event('input', { bubbles:true }))
  })
  await dialog.getByLabel('Texto del lomo').fill('Mi título personalizado')
  await dialog.getByLabel('Autor del libro').fill('Ursula Le Guin')
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
    spineFontSize: 42,
    spineAuthorFontSize: 30,
    spineTitleOverride: 'Mi título personalizado',
    author: 'Ursula Le Guin'
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
  await expect(reopenedDialog.getByLabel('Elegir otro color para el lomo')).toHaveValue(custom)
  await expect(reopenedDialog.getByLabel('Fuente del lomo', { exact:true })).toHaveValue('Lora')
  await expect(reopenedDialog.getByLabel('Tamaño del título del lomo')).toHaveValue('42')
  await expect(reopenedDialog.getByLabel('Tamaño del autor del lomo')).toHaveValue('30')
  await expect(reopenedDialog.getByLabel('Texto del lomo')).toHaveValue('Mi título personalizado')
  await expect(reopenedDialog.getByLabel('Autor del libro')).toHaveValue('Ursula Le Guin')
})

test('mueve un libro al mantenerlo pulsado con animación 3D y conserva el orden', async ({ page }) => {
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
  await expect(page.getByRole('button', { name:'Organizar' })).toHaveCount(0)
  const original = await page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId))
  const firstSpine = page.locator('.ihr-spine').first()
  await firstSpine.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId)))
    .toEqual([...original].reverse())
  await page.waitForTimeout(560)
  const from = await page.locator('.ihr-spine[data-book-id="shelf:bravo"]').boundingBox()
  const to = await page.locator('.ihr-spine[data-book-id="shelf:alpha"]').boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(500)
  await expect(page.locator('.ihr-spine[data-book-id="shelf:bravo"]')).toHaveClass(/is-lifted/)
  await page.mouse.move(to.x + to.width * .82, to.y + to.height / 2, { steps:8 })
  // Observe before release: storage refreshes may replace the canvas after the
  // short return animation, before a later locator assertion reaches it.
  await page.evaluate(() => {
    const sample = document.createElement('canvas')
    sample.width = sample.height = 32
    const context = sample.getContext('2d')
    window.__reorderFrames = { count:0, first:null, changed:false }
    window.__reorderObserver = new MutationObserver(records => {
      const canvases = new Set(records.map(record => record.target)
        .filter(node => node.matches?.('.ihr-bookshelf-scene')))
      for (const canvas of canvases) {
        if (canvas.dataset.animating !== 'true') continue
        context.clearRect(0, 0, 32, 32)
        context.drawImage(canvas, 0, 0, 32, 32)
        const pixels = context.getImageData(0, 0, 32, 32).data
        let hash = 0
        for (let index = 0; index < pixels.length; index++) hash = (hash * 31 + pixels[index]) | 0
        const frames = window.__reorderFrames
        frames.count++
        if (frames.first === null) frames.first = hash
        else if (hash !== frames.first) frames.changed = true
      }
    })
    window.__reorderObserver.observe(document.documentElement, {
      subtree:true, attributes:true, attributeFilter:['data-render-count', 'data-animating']
    })
  })
  await page.mouse.up()
  await expect.poll(() => page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId)))
    .toEqual(original)
  // The visible mesh must move; animating its invisible hit target is insufficient.
  await expect.poll(() => page.evaluate(() => window.__reorderFrames.count)).toBeGreaterThan(1)
  await expect.poll(() => page.evaluate(() => window.__reorderFrames.changed)).toBe(true)
  await page.evaluate(() => window.__reorderObserver.disconnect())
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

test('aleja y gira toda la estantería en 3D, permite abrir libros y recuerda la vista', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()

  const shelf = page.locator('[data-ihr-bookshelf]')
  const canvas = page.locator('.ihr-bookshelf-scene')
  const isometric = page.getByRole('button', { name:'Vista isométrica, libros de lado' })
  const frontal = page.getByRole('button', { name:'Vista de canto', exact:true })
  const bookOrder = () => page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(node => node.dataset.bookId))
  const initialOrder = await bookOrder()
  const initialRows = await page.locator('.ihr-shelf').count()
  await expect(canvas).toHaveCount(1)
  await expect(canvas).toHaveAttribute('data-shelf-view', 'spine')
  const initialZoom = Number(await canvas.getAttribute('data-zoom'))
  await canvas.evaluate(element => {
    window.__shelfViewFrames = []
    window.__shelfViewObserver = new MutationObserver(() => {
      if (element.dataset.animating === 'true') window.__shelfViewFrames.push(Number(element.dataset.viewProgress))
    })
    window.__shelfViewObserver.observe(element, {
      attributes:true, attributeFilter:['data-view-progress', 'data-animating']
    })
  })

  await isometric.click()
  await expect(shelf).toHaveAttribute('data-view-mode', 'isometric')
  await expect(isometric).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__shelfViewFrames.some(value => value > 0 && value < 1))).toBe(true)
  await expect(canvas).toHaveAttribute('data-view-progress', '1')
  expect(Math.abs(Number(await canvas.getAttribute('data-yaw')))).toBeGreaterThan(15)
  expect(Math.abs(Number(await canvas.getAttribute('data-pitch')))).toBeGreaterThan(5)
  expect(Number(await canvas.getAttribute('data-zoom'))).toBeLessThan(initialZoom)
  expect(await bookOrder()).toEqual(initialOrder)
  expect(await page.locator('.ihr-shelf').count()).toBe(initialRows)
  await page.screenshot({ path:'test-results/whole-shelf-isometric-mobile.png' })

  // Interrupted transitions finish in the last requested view without rebuilding the layout.
  await page.evaluate(() => { window.__shelfViewFrames = [] })
  await frontal.click()
  await expect.poll(() => page.evaluate(() => window.__shelfViewFrames.some(value => value > 0 && value < 1))).toBe(true)
  await isometric.click()
  await expect(canvas).toHaveAttribute('data-view-progress', '1')
  await expect(canvas).toHaveAttribute('data-animating', 'false')
  await page.evaluate(() => window.__shelfViewObserver.disconnect())
  expect(await bookOrder()).toEqual(initialOrder)

  // A settled shelf must stop consuming animation frames once textures have arrived.
  await expect.poll(async () => {
    const before = Number(await canvas.getAttribute('data-render-count'))
    await page.waitForTimeout(250)
    return Number(await canvas.getAttribute('data-render-count')) - before
  }).toBe(0)

  await page.reload()
  await expect(shelf).toHaveAttribute('data-view-mode', 'isometric')
  await expect(canvas).toHaveAttribute('data-shelf-view', 'isometric')
  const spine = page.locator('.ihr-spine').first()
  await spine.click()
  await expect(page.getByRole('button', { name:/Toca para leer/ })).toBeVisible()
  await page.getByRole('button', { name:'Cerrar', exact:true }).click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(spine).toBeFocused()
  await expect(canvas).toHaveAttribute('data-shelf-view', 'isometric')
  await spine.click()
  await page.getByRole('button', { name:/Toca para leer/ }).click()
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(canvas).toBeVisible()
  await expect(spine).toBeFocused()
  expect(await bookOrder()).toEqual(initialOrder)
})

test('la estantería isométrica larga limita los modelos activos y deja alcanzar la última balda', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('books', 'readwrite')
    for (let index = 0; index < 80; index++) {
      transaction.objectStore('books').put({
        id:`long-shelf:${index}`, title:`Libro ${index + 1}`, author:'Autor',
        format:'PDF', sourceType:'local', addedAt:Date.now(), shelfOrder:index,
        pageCount:400, progressFraction:0
      })
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(80)
  const canvas = page.locator('.ihr-bookshelf-scene')
  await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
  await expect(canvas).toHaveAttribute('data-view-progress', '1')
  await expect.poll(async () => Number(await canvas.getAttribute('data-active-books'))).toBeGreaterThan(0)
  expect(Number(await canvas.getAttribute('data-active-books'))).toBeLessThan(80)
  const scroller = page.locator('.ihr-bookshelf__scroll')
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(page.locator('.ihr-spine[data-book-id="long-shelf:79"]')).toBeInViewport()
  await expect.poll(async () => Number(await canvas.getAttribute('data-active-books'))).toBeGreaterThan(0)
  expect(Number(await canvas.getAttribute('data-active-books'))).toBeLessThan(80)
  await expect(canvas).toHaveCount(1)
  await page.evaluate(() => { window.__longShelfCanvas = document.querySelector('.ihr-bookshelf-scene') })
  await page.setViewportSize({ width:414, height:844 })
  await expect(page.locator('.ihr-spine[data-book-id="long-shelf:79"]')).toBeInViewport()
  expect(await page.evaluate(() => window.__longShelfCanvas === document.querySelector('.ihr-bookshelf-scene'))).toBe(true)
  await expect(canvas).toHaveAttribute('data-view-progress', '1')
  await page.screenshot({ path:'test-results/whole-shelf-isometric-last-row.png' })
})
