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
    shelf = renderBookshelf(container, makeBooks(8), { shelfWidth: SHELF_WIDTH })
    const titles = [...container.querySelectorAll('.ihr-section__title')].map(
      (node) => node.textContent
    )
    expect(titles).toContain('Seguir leyendo')
    expect(titles).toContain('Biblioteca')
    expect(container.querySelector('.ihr-spine__progress')).not.toBeNull()
  })

  it('con sections:false monta una sola estantería continua', () => {
    shelf = renderBookshelf(container, makeBooks(8), {
      shelfWidth: SHELF_WIDTH,
      sections: false
    })
    expect(container.querySelectorAll('.ihr-section')).toHaveLength(1)
    expect(container.querySelectorAll('.ihr-section__title')).toHaveLength(0)
  })

  it('estado vacío: mensaje acogedor, plantas y CTA (nunca una pantalla en blanco)', () => {
    const onAddBooks = vi.fn()
    shelf = renderBookshelf(container, [], { shelfWidth: SHELF_WIDTH, onAddBooks })
    const empty = container.querySelector('.ihr-empty')
    expect(empty).not.toBeNull()
    expect(empty.textContent).toContain('Tu estantería está vacía')
    expect(empty.querySelectorAll('.ihr-plant').length).toBe(3)
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
    const flyout = container.querySelector('.ihr-flyout')
    expect(flyout).not.toBeNull()
    expect(flyout.querySelector('.ihr-flyout__face--spine')).not.toBeNull()
    expect(flyout.querySelector('.ihr-flyout__face--cover')).not.toBeNull()
    expect(flyout.getAttribute('role')).toBe('dialog')
    expect(spine.classList.contains('is-away')).toBe(true)

    expect(onBookOpen).toHaveBeenCalledOnce()
    const [book, ctx] = onBookOpen.mock.calls[0]
    expect(book.id).toBe(spine.dataset.bookId)
    expect(books.map((candidate) => candidate.id)).toContain(book.id)
    expect(typeof ctx.close).toBe('function')
  })

  it('sin portada usa un placeholder con el título, no un icono roto', async () => {
    shelf = renderBookshelf(container, makeBooks(2), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    const placeholder = container.querySelector('.ihr-cover-placeholder')
    expect(placeholder).not.toBeNull()
    expect(placeholder.textContent).toMatch(/Libro \d/)
    expect(placeholder.textContent).toContain('EPUB')
    expect(container.querySelector('.ihr-flyout__img')).toBeNull()
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
    expect(container.querySelector('.ihr-flyout__img').getAttribute('src')).toBe(
      'blob:portada-falsa'
    )
    expect(container.querySelector('.ihr-cover-placeholder')).toBeNull()
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
    expect(container.querySelector('.ihr-cover-placeholder')).not.toBeNull()
    expect(onBookOpen).toHaveBeenCalledOnce()
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
    expect(container.querySelector('.ihr-flyout')).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(container.querySelector('.ihr-flyout')).toBeNull()
    expect(spine.classList.contains('is-away')).toBe(false)
    expect(document.activeElement).toBe(spine)

    // Y se puede volver a abrir: el componente no se queda bloqueado.
    spine.click()
    await settle()
    expect(container.querySelector('.ihr-flyout')).not.toBeNull()
    container.querySelector('.ihr-flyout__scrim').click()
    await settle()
    expect(container.querySelector('.ihr-flyout')).toBeNull()
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
    const [open] = container.querySelectorAll('.ihr-flyout__actions .ihr-btn')
    open.click()
    expect(onBookOpen).toHaveBeenCalledOnce()
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

  it('refresh cierra la portada que hubiera abierta', async () => {
    shelf = renderBookshelf(container, makeBooks(4), {
      shelfWidth: SHELF_WIDTH,
      revealDuration: 0,
      holdMs: 0
    })
    container.querySelector('.ihr-spine').click()
    await settle()
    expect(container.querySelector('.ihr-flyout')).not.toBeNull()
    shelf.refresh(makeBooks(5))
    await settle()
    expect(container.querySelector('.ihr-flyout')).toBeNull()
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
