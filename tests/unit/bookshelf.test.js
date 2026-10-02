/**
 * Tests de integración ligera del renderizador. La lógica de verdad vive en
 * bookshelf-layout.js (testeada aparte, sin DOM); aquí sólo se comprueba el
 * contrato con app.js y lo que no puede romperse en silencio: que el tap abra
 * el libro, que el estado vacío invite a añadir uno, y que destroy() limpie.
 *
 * jsdom no implementa Element.animate ni ResizeObserver: el componente tiene
 * caminos de reserva para los dos, y estos tests los recorren.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'
import { readCoverAspectRatio } from '../../src/js/cover-appearance.js'

vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(),
  readCoverAspectRatio: vi.fn(async () => null)
}))

const SHELF_WIDTH = 390

function makeBooks(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `local:libro-${i}.epub:${2000 + i}`,
    title: `Libro ${i}`,
    author: `Autor ${i}`,
    format: 'EPUB',
    sourceType: 'local',
    addedAt: 1_700_000_000_000,
    lastOpenedAt: 1_700_000_000_000 + i,
    progressFraction: i === 0 ? 0.4 : 0
  }))
}

let container
let shelf

beforeEach(() => {
  localStorage.removeItem('inhouse-read-shelf-plants')
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  shelf?.destroy()
  shelf = null
  container.remove()
  document.body.innerHTML = ''
})

/** Espera a que se resuelvan las promesas y timers pendientes del flyout. */
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

describe('renderBookshelf', () => {
  it('exige un contenedor', () => {
    expect(() => renderBookshelf(null, [])).toThrow(/contenedor/i)
  })

  it('pinta un lomo por libro, con su título accesible', () => {
    const books = makeBooks(6)
    shelf = renderBookshelf(container, books, { shelfWidth: SHELF_WIDTH })
    const spines = container.querySelectorAll('.ihr-spine')
    expect(spines).toHaveLength(6)
    expect(spines[0].getAttribute('aria-label')).toMatch(/^Abrir Libro/)
    expect(container.textContent).toContain('Libro 3')
  })

  it('reparte los libros en baldas con macetas', () => {
    shelf = renderBookshelf(container, makeBooks(24), { shelfWidth: SHELF_WIDTH })
    expect(container.querySelectorAll('.ihr-shelf').length).toBeGreaterThan(1)
    expect(container.querySelectorAll('.ihr-plant').length).toBeGreaterThan(0)
    // Cada balda lleva su tablero de madera y su fondo.
    for (const unit of container.querySelectorAll('.ihr-shelf')) {
      expect(unit.querySelector('.ihr-shelf__board')).not.toBeNull()
      expect(unit.querySelector('.ihr-shelf__back')).not.toBeNull()
    }
  })

  it('separa "seguir leyendo" cuando hay libros a medias', () => {
    shelf = renderBookshelf(container, makeBooks(8), { shelfWidth: SHELF_WIDTH, sections: true })
    const titles = [...container.querySelectorAll('.ihr-section__title')].map(
      (node) => node.textContent
    )
    expect(titles).toContain('Seguir leyendo')
    expect(titles).toContain('Biblioteca')
    expect(container.querySelector('.ihr-spine__bookmark')).not.toBeNull()
  })

  it('marcapáginas: sólo en libros empezados, con lo que asoma según el progreso', () => {
    const books = makeBooks(4).map((book, i) => ({
      ...book,
      progressFraction: [0, 0.2, 0.8, 1][i]
    }))
    shelf = renderBookshelf(container, books, { shelfWidth: SHELF_WIDTH, sections: false })
    const byId = (id) => container.querySelector(`.ihr-spine[data-book-id="${id}"]`)
    const peekOf = (spine) =>
      parseFloat(
        spine.querySelector('.ihr-spine__bookmark').style.getPropertyValue('--ihr-bookmark-peek')
      )

    const [unread, started, advanced, finished] = books.map((book) => byId(book.id))
    expect(unread.querySelector('.ihr-spine__bookmark')).toBeNull()
    expect(unread.classList.contains('has-bookmark')).toBe(false)
    expect(peekOf(started)).toBeLessThan(peekOf(advanced))
    expect(peekOf(advanced)).toBeLessThan(peekOf(finished))
    expect(finished.classList.contains('is-finished')).toBe(true)
    expect(started.classList.contains('is-finished')).toBe(false)
    // El marcapáginas va dentro del propio botón: no hay envoltorio que
    // cambie el nodo medido ni el ancho que ocupa el libro en la balda.
    expect(started.querySelector('.ihr-spine__bookmark').parentElement).toBe(started)
    expect(started.parentElement.classList.contains('ihr-shelf__row')).toBe(true)
    // Ya no convive con la barrita antigua.
    expect(container.querySelector('.ihr-spine__progress')).toBeNull()
    // El progreso también se anuncia al lector de pantalla.
    expect(started.getAttribute('aria-label')).toMatch(/leído al 20 %$/)
    expect(finished.getAttribute('aria-label')).toMatch(/terminado$/)
    expect(unread.getAttribute('aria-label')).toBe('Abrir Libro 0, de Autor 0')
  })

  it('el marcapáginas no altera el ancho del lomo en la balda', () => {
    const plain = makeBooks(3).map((book) => ({ ...book, progressFraction: 0 }))
    const marked = plain.map((book) => ({ ...book, progressFraction: 0.6 }))
    shelf = renderBookshelf(container, plain, { shelfWidth: SHELF_WIDTH, sections: false })
    const widths = () =>
      [...container.querySelectorAll('.ihr-spine')].map((node) =>
        node.style.getPropertyValue('--ihr-spine-w')
      )
    const before = widths()
    shelf.update(marked)
    expect(container.querySelectorAll('.ihr-spine__bookmark')).toHaveLength(3)
    expect(widths()).toEqual(before)
  })

  it('sin WebGL, abre la portada accesible y conserva el marcapáginas en la balda', async () => {
    const books = makeBooks(2).map((book) => ({ ...book, progressFraction: 0.5 }))
    shelf = renderBookshelf(container, books, {
      shelfWidth: SHELF_WIDTH,
      sections: false,
      revealDuration: 0,
      holdMs: 0
    })
    const spine = container.querySelector('.ihr-spine')
    const measured = vi.spyOn(spine, 'getBoundingClientRect')
    spine.click()
    await settle()
    expect(measured).toHaveBeenCalled()
    expect(spine.classList.contains('is-away')).toBe(true)
    const fallback = document.querySelector('.ihr-flyout__book--fallback')
    expect(fallback).not.toBeNull()
    expect(fallback.querySelector('.ihr-spine__bookmark')).toBeNull()
    // jsdom has no GPU: the accessible cover fallback must still open.
    expect(spine.querySelector('.ihr-spine__bookmark')).not.toBeNull()
    expect(document.querySelector('.ihr-flyout__cover-target').hidden).toBe(false)
  })

  it('con sections:false monta una sola estantería continua', () => {
    shelf = renderBookshelf(container, makeBooks(8), {
      shelfWidth: SHELF_WIDTH,
      sections: false
    })
    expect(container.querySelectorAll('.ihr-section')).toHaveLength(1)
    expect(container.querySelectorAll('.ihr-section__title')).toHaveLength(0)
  })

  it('mantiene una estantería única y tres baldas iniciales con orden manual', () => {
    const books = [makeBooks(3)[2], makeBooks(3)[0], makeBooks(3)[1]]
    shelf = renderBookshelf(container, books, { shelfWidth: SHELF_WIDTH, sections: false, sort: 'none' })
    expect(container.querySelectorAll('.ihr-section')).toHaveLength(1)
    expect(container.querySelectorAll('.ihr-section__title')).toHaveLength(0)
    expect(container.querySelectorAll('.ihr-shelf')).toHaveLength(3)
    expect([...container.querySelectorAll('.ihr-spine')].map(node => node.dataset.bookId))
      .toEqual(books.map(book => book.id))
  })

  it('estado vacío: mensaje acogedor, plantas y CTA (nunca una pantalla en blanco)', () => {
    const onAddBooks = vi.fn()
    shelf = renderBookshelf(container, [], { shelfWidth: SHELF_WIDTH, onAddBooks })
    const empty = container.querySelector('.ihr-empty')
    expect(empty).not.toBeNull()
    expect(empty.textContent).toContain('Sin libros')
    expect(container.querySelectorAll('.ihr-plant').length).toBe(3)
    expect(container.querySelectorAll('.ihr-shelf')).toHaveLength(3)
    empty.querySelector('.ihr-empty__action').click()
    expect(onAddBooks).toHaveBeenCalledOnce()
  })

  it('al tocar un lomo gira la portada y luego avisa a la app', async () => {
    const onBookOpen = vi.fn()
    const books = makeBooks(4)
    shelf = renderBookshelf(container, books, {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0,
      onBookOpen
    })

    const spine = container.querySelector('.ihr-spine')
    spine.click()
    // El flyout aparece con las dos caras del libro: lomo y portada.
    await settle()
    const flyout = document.querySelector('.ihr-flyout')
    expect(flyout).not.toBeNull()
    expect(flyout.querySelector('.ihr-flyout__book--fallback')).not.toBeNull()
    expect(flyout.querySelector('.ihr-flyout__face--cover')).not.toBeNull()
    expect(flyout.getAttribute('role')).toBe('dialog')
    expect(spine.classList.contains('is-away')).toBe(true)

    expect(onBookOpen).not.toHaveBeenCalled()
    document.querySelector('.ihr-flyout__cover-target').click()
    await vi.waitFor(() => expect(onBookOpen).toHaveBeenCalledOnce())
    const [book, ctx] = onBookOpen.mock.calls[0]
    expect(book.id).toBe(spine.dataset.bookId)
    expect(books.map((candidate) => candidate.id)).toContain(book.id)
    expect(typeof ctx.close).toBe('function')
    expect(typeof ctx.finish).toBe('function')
    await ctx.finish()
    expect(document.querySelector('.ihr-flyout')).toBeNull()
    vi.spyOn(spine, 'getBoundingClientRect').mockReturnValue({ left:40, top:100, width:34, height:150 })
    expect(await shelf.returnToShelf(book.id)).toBe(true)
    expect(document.querySelector('.ihr-flyout--return')).toBeNull()
    expect(spine.classList.contains('is-away')).toBe(false)
  })

  it('sin portada usa un placeholder con el título, no un icono roto', async () => {
    shelf = renderBookshelf(container, makeBooks(2), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    const placeholder = document.querySelector('.ihr-cover-placeholder')
    expect(placeholder).not.toBeNull()
    expect(placeholder.textContent).toMatch(/Libro \d/)
    expect(placeholder.textContent).toContain('EPUB')
    expect(document.querySelector('.ihr-flyout__img')).toBeNull()
  })

  it('cancela la apertura pendiente antes de devolver el libro y descarta un lector que termina tarde', async () => {
    const onBookOpen = vi.fn()
    shelf = renderBookshelf(container, makeBooks(1), { shelfWidth:SHELF_WIDTH, revealDuration:0, returnDuration:0, onBookOpen })
    const spine = container.querySelector('.ihr-spine')
    spine.click()
    await settle()
    document.querySelector('.ihr-flyout__cover-target').click()
    await vi.waitFor(() => expect(onBookOpen).toHaveBeenCalledOnce())
    const context = onBookOpen.mock.calls[0][1]
    const cancelled = vi.fn()
    context.onCancel(cancelled)
    expect(context.isActive()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))
    await vi.waitFor(() => expect(document.querySelector('.ihr-flyout')).toBeNull())
    expect(cancelled).toHaveBeenCalledOnce()
    expect(context.isActive()).toBe(false)
    expect(await context.finish()).toBe(false)
    expect(spine.classList.contains('is-away')).toBe(false)
  })

  it('usa coverSrcFor cuando hay portada', async () => {
    const coverSrcFor = vi.fn(() => 'blob:portada-falsa')
    shelf = renderBookshelf(container, makeBooks(2), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0,
      coverSrcFor
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    expect(coverSrcFor).toHaveBeenCalled()
    await vi.waitFor(() => expect(document.querySelector('.ihr-flyout__img')?.getAttribute('src')).toBe('blob:portada-falsa'))
    expect(document.querySelector('.ihr-cover-placeholder')).toBeNull()
  })

  it('una portada que falla no impide abrir el libro', async () => {
    const onBookOpen = vi.fn()
    shelf = renderBookshelf(container, makeBooks(2), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0,
      onBookOpen,
      coverSrcFor: () => {
        throw new Error('portada corrupta')
      }
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    expect(document.querySelector('.ihr-cover-placeholder')).not.toBeNull()
    expect(onBookOpen).not.toHaveBeenCalled()
    document.querySelector('.ihr-flyout__cover-target').click()
    await vi.waitFor(() => expect(onBookOpen).toHaveBeenCalledOnce())
  })

  it('Escape y el fondo repliegan la portada y devuelven el foco', async () => {
    shelf = renderBookshelf(container, makeBooks(3), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      returnDuration: 0,
      holdMs: 0,
      autoOpen: false
    })
    const spine = container.querySelector('.ihr-spine')
    spine.focus()
    spine.click()
    await settle()
    expect(document.querySelector('.ihr-flyout')).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(document.querySelector('.ihr-flyout')).toBeNull()
    expect(spine.classList.contains('is-away')).toBe(false)
    expect(document.activeElement).toBe(spine)

    // Y se puede volver a abrir: el componente no se queda bloqueado.
    spine.click()
    await settle()
    expect(document.querySelector('.ihr-flyout')).not.toBeNull()
    document.querySelector('.ihr-flyout__scrim').click()
    await settle()
    expect(document.querySelector('.ihr-flyout')).toBeNull()
  })

  it('Escape cancela la selección mientras los datos de portada siguen pendientes', async () => {
    let resolveDimensions
    vi.mocked(readCoverAspectRatio).mockImplementationOnce(() => new Promise(resolve => { resolveDimensions = resolve }))
    shelf = renderBookshelf(container, makeBooks(2), {
      shelfWidth:SHELF_WIDTH, revealDuration:0, returnDuration:0
    })
    container.querySelector('.ihr-spine').click()
    await vi.waitFor(() => expect(resolveDimensions).toBeTypeOf('function'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' }))
    resolveDimensions(null)
    await settle()
    expect(document.querySelector('.ihr-flyout')).toBeNull()
    container.querySelector('.ihr-spine').click()
    await settle()
    expect(document.querySelector('.ihr-flyout')).not.toBeNull()
  })

  it('con autoOpen:false ofrece botones y no abre por su cuenta', async () => {
    const onBookOpen = vi.fn()
    shelf = renderBookshelf(container, makeBooks(2), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0,
      autoOpen: false,
      onBookOpen
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    expect(onBookOpen).not.toHaveBeenCalled()
    const [open] = document.querySelectorAll('.ihr-flyout__actions .ihr-btn')
    open.click()
    await vi.waitFor(() => expect(onBookOpen).toHaveBeenCalledOnce())
    expect(onBookOpen).toHaveBeenCalledOnce()
  })

  it('el editor elige acabados con muestras que gobiernan la select nativa accesible', async () => {
    const onBookCustomizationChange = vi.fn()
    shelf = renderBookshelf(container, makeBooks(1), {
      shelfWidth: SHELF_WIDTH, revealDuration: 0, holdMs: 0, autoOpen: false, onBookCustomizationChange
    })
    container.querySelector('.ihr-spine').click()
    const edit = await vi.waitFor(() => {
      const button = document.querySelector('.ihr-flyout__edit-button')
      expect(button.disabled).toBe(false)
      return button
    })
    edit.click()
    const editor = document.querySelector('.ihr-spine-editor')
    expect(editor.hidden).toBe(false)
    // Without a saved override the spine follows the cover: first sample, not "+".
    expect(editor.querySelector('.ihr-flyout__swatch').getAttribute('aria-pressed')).toBe('true')
    expect(editor.querySelector('.ihr-flyout__custom-color').classList.contains('is-selected')).toBe(false)

    const select = editor.querySelector('select[aria-label="Brillo de la portada"]')
    const picker = select.closest('.ihr-spine-editor__materials')
    expect(picker.querySelector('.ihr-spine-editor__materials-track').getAttribute('aria-hidden')).toBe('true')
    expect([...select.options].map(option => option.value)).toEqual(['matte', 'satin', 'glossy'])
    picker.querySelector('.ihr-spine-editor__material[data-value="glossy"]').click()
    expect(select.value).toBe('glossy')
    expect(picker.dataset.value).toBe('glossy')
    expect(picker.querySelector('.is-active').dataset.value).toBe('glossy')

    const foil = editor.querySelector('select[aria-label="Acabado del texto"]')
    foil.value = 'silver'
    foil.dispatchEvent(new Event('change', { bubbles: true }))
    expect(foil.closest('.ihr-spine-editor__materials').querySelector('.is-active').dataset.value).toBe('silver')
    await vi.waitFor(() => expect(onBookCustomizationChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: makeBooks(1)[0].id }),
      expect.objectContaining({ coverFinish: 'glossy', spineTextFinish: 'silver' })
    ))
  })

  it('permite descargar un libro de Drive que todavía no está guardado offline', async () => {
    const onBookAction = vi.fn()
    shelf = renderBookshelf(container, [{ ...makeBooks(1)[0], sourceType:'drive', driveFileId:'remote-1' }], {
      shelfWidth:SHELF_WIDTH, revealDuration:0, onBookAction
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    const download = document.querySelector('[aria-label="Descargar para usar sin conexión"]')
    expect(download.disabled).toBe(false)
    expect(download.querySelector('svg')).not.toBeNull()
    download.click()
    expect(onBookAction).toHaveBeenCalledWith('offline', expect.objectContaining({ driveFileId:'remote-1' }), download)
  })

  it('mantiene el foco dentro de la portada y muestra un cierre accesible', async () => {
    shelf = renderBookshelf(container, makeBooks(1), { shelfWidth:SHELF_WIDTH, revealDuration:0 })
    container.querySelector('.ihr-spine').click()
    await settle()
    const flyout = document.querySelector('.ihr-flyout')
    const close = flyout.querySelector('.ihr-flyout__close')
    expect(close.getAttribute('aria-label')).toBe('Cerrar')
    close.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', cancelable:true }))
    expect(document.activeElement).toBe(flyout.querySelector('.ihr-flyout__actions .ihr-btn'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', shiftKey:true, cancelable:true }))
    expect(document.activeElement).toBe(close)
  })

  it('un arrastre (scroll) cancela la presión y no abre nada', () => {
    const onBookOpen = vi.fn()
    shelf = renderBookshelf(container, makeBooks(4), { shelfWidth: SHELF_WIDTH, onBookOpen })
    const spine = container.querySelector('.ihr-spine')
    // jsdom no trae PointerEvent; MouseEvent lleva los mismos clientX/clientY.
    spine.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 200, bubbles: true }))
    expect(spine.classList.contains('is-pressed')).toBe(true)
    spine.dispatchEvent(new MouseEvent('pointermove', { clientX: 42, clientY: 260, bubbles: true }))
    expect(spine.classList.contains('is-pressed')).toBe(false)
    expect(onBookOpen).not.toHaveBeenCalled()
  })

  it('update/refresh vuelven a pintar la biblioteca nueva', () => {
    shelf = renderBookshelf(container, makeBooks(4), { shelfWidth: SHELF_WIDTH })
    expect(container.querySelectorAll('.ihr-spine')).toHaveLength(4)
    shelf.update(makeBooks(9))
    expect(container.querySelectorAll('.ihr-spine')).toHaveLength(9)
    shelf.refresh([])
    expect(container.querySelector('.ihr-empty')).not.toBeNull()
  })

  it('refresh mantiene la portada abierta y aplica los cambios al cerrarla', async () => {
    shelf = renderBookshelf(container, makeBooks(4), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      returnDuration: 0,
      holdMs: 0
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    expect(document.querySelector('.ihr-flyout')).not.toBeNull()
    shelf.refresh(makeBooks(5))
    await settle()
    expect(document.querySelector('.ihr-flyout')).not.toBeNull()
    expect(container.querySelectorAll('.ihr-spine')).toHaveLength(4)
    await shelf.close()
    expect(document.querySelector('.ihr-flyout')).toBeNull()
    await vi.waitFor(() => expect(container.querySelectorAll('.ihr-spine')).toHaveLength(5))
  })

  it('destroy desmonta todo y revoca los object URLs de las portadas', async () => {
    // jsdom no implementa la API de object URLs: se instala un doble.
    const revoke = vi.fn()
    URL.createObjectURL = vi.fn(() => 'blob:falso')
    URL.revokeObjectURL = revoke
    const books = makeBooks(2).map((book) => ({ ...book, cover: new Blob(['x']) }))
    shelf = renderBookshelf(container, books, {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0
    })
    container.querySelector('.ihr-spine').click()
    await settle()

    shelf.destroy()
    shelf = null
    expect(container.querySelector('.ihr-bookshelf')).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:falso')
    delete URL.createObjectURL
    delete URL.revokeObjectURL
  })

  it('el mismo libro siempre sale con el mismo lomo (nada de barajar al repintar)', () => {
    const books = makeBooks(5)
    shelf = renderBookshelf(container, books, { shelfWidth: SHELF_WIDTH })
    const before = [...container.querySelectorAll('.ihr-spine')].map((node) =>
      node.getAttribute('style')
    )
    shelf.update(books)
    const after = [...container.querySelectorAll('.ihr-spine')].map((node) =>
      node.getAttribute('style')
    )
    expect(after).toEqual(before)
  })
})
