import { describe, it, expect } from 'vitest'
import {
  hashString,
  unit,
  seedFor,
  spineStyleFor,
  layoutShelves,
  buildSections,
  planBookshelf,
  progressOf,
  isInProgress,
  SPINE_PALETTE,
  SPINE_TEXTURES,
  DEFAULT_LAYOUT
} from '../../src/js/bookshelf-layout.js'

/** Biblioteca sintética con ids estables. */
function makeBooks(count, overrides = () => ({})) {
  return Array.from({ length: count }, (_, i) => ({
    id: `local:libro-${i}.epub:${1000 + i}`,
    title: `Título número ${i}`,
    author: `Autor ${i % 7}`,
    format: 'EPUB',
    sourceType: 'local',
    addedAt: 1_700_000_000_000 + i,
    lastOpenedAt: 1_700_000_000_000 + i,
    progressFraction: 0,
    ...overrides(i)
  }))
}

/** Ancho real ocupado por una balda, recalculado desde sus items. */
function measureShelf(shelf, gap = DEFAULT_LAYOUT.gap) {
  return shelf.items.reduce(
    (total, item, index) => total + item.width + (index === 0 ? 0 : gap),
    0
  )
}

describe('hashString / unit', () => {
  it('es determinista y estable entre llamadas', () => {
    expect(hashString('Los detectives salvajes')).toBe(hashString('Los detectives salvajes'))
    expect(unit('abc', 'palette')).toBe(unit('abc', 'palette'))
  })

  it('separa flujos por sal', () => {
    expect(unit('abc', 'palette')).not.toBe(unit('abc', 'width'))
  })

  it('devuelve un entero sin signo de 32 bits', () => {
    for (const value of ['', 'a', 'ñ', 'Título con acentos áéí', '🙂']) {
      const hash = hashString(value)
      expect(Number.isInteger(hash)).toBe(true)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('unit siempre cae en [0, 1)', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = unit(`libro-${i}`, 'height')
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('reparte razonablemente: ningún color de la paleta se lleva más del 25%', () => {
    const counts = new Map()
    for (const book of makeBooks(400)) {
      const { palette } = spineStyleFor(book)
      counts.set(palette.name, (counts.get(palette.name) ?? 0) + 1)
    }
    expect(counts.size).toBe(SPINE_PALETTE.length)
    for (const count of counts.values()) expect(count).toBeLessThan(100)
  })
})

describe('seedFor', () => {
  it('prefiere el id del store', () => {
    expect(seedFor({ id: 'drive:abc', title: 'T', author: 'A' })).toBe('drive:abc')
  })

  it('cae a título + autor cuando no hay id ni ruta', () => {
    expect(seedFor({ title: 'T', author: 'A' })).toBe('T|A')
  })

  it('no explota con entradas vacías', () => {
    expect(seedFor(null)).toBe('')
    expect(seedFor({})).toBe('|')
  })
})

describe('spineStyleFor', () => {
  const book = { id: 'local:kafka.epub:4242', title: 'El proceso', author: 'Kafka' }

  it('es determinista', () => {
    expect(spineStyleFor(book)).toEqual(spineStyleFor({ ...book }))
  })

  it('devuelve color y acabado de los catálogos, y medidas dentro de rango', () => {
    for (const candidate of makeBooks(200)) {
      const style = spineStyleFor(candidate)
      expect(SPINE_PALETTE).toContainEqual(style.palette)
      expect(SPINE_TEXTURES).toContain(style.texture)
      expect(style.width).toBeGreaterThanOrEqual(28)
      expect(style.width).toBeLessThanOrEqual(54)
      expect(style.heightRatio).toBeGreaterThanOrEqual(0.8)
      expect(style.heightRatio).toBeLessThanOrEqual(1)
    }
  })

  it('respeta los límites que se le pasen (escalado móvil)', () => {
    for (const candidate of makeBooks(120)) {
      const style = spineStyleFor(candidate, { minWidth: 26, maxWidth: 44 })
      expect(style.width).toBeGreaterThanOrEqual(26)
      expect(style.width).toBeLessThanOrEqual(44)
    }
  })

  it('a igualdad de semilla, más páginas = lomo más gordo', () => {
    const widths = [50, 120, 300, 600, 900].map(
      (pageCount) => spineStyleFor({ ...book, pageCount }).width
    )
    const sorted = [...widths].sort((a, b) => a - b)
    expect(widths).toEqual(sorted)
    expect(widths.at(-1)).toBeGreaterThan(widths[0])
  })

  it('usa el tamaño del fichero cuando no hay número de páginas', () => {
    const small = spineStyleFor({ ...book, sizeBytes: 300 * 1024 }).width
    const big = spineStyleFor({ ...book, sizeBytes: 11 * 1024 * 1024 }).width
    expect(big).toBeGreaterThan(small)
  })

  it('sin metadatos de tamaño sigue dando un lomo válido', () => {
    const style = spineStyleFor({ id: 'x' })
    expect(style.width).toBeGreaterThanOrEqual(28)
    expect(style.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

describe('layoutShelves', () => {
  it('sin libros no hay baldas', () => {
    expect(layoutShelves([])).toEqual([])
    expect(layoutShelves(null)).toEqual([])
  })

  it('con ancho inservible devuelve vacío en vez de colgarse', () => {
    expect(layoutShelves(makeBooks(5), { shelfWidth: 20, padding: 16 })).toEqual([])
  })

  it('conserva todos los libros, una sola vez y en orden', () => {
    const books = makeBooks(40)
    const shelves = layoutShelves(books, { shelfWidth: 390 })
    const placed = shelves
      .flatMap((shelf) => shelf.items)
      .filter((item) => item.kind === 'book')
      .map((item) => item.book.id)
    expect(placed).toEqual(books.map((book) => book.id))
  })

  it('ninguna balda se desborda', () => {
    for (const width of [320, 360, 414, 600, 900]) {
      const shelves = layoutShelves(makeBooks(60), { shelfWidth: width })
      const available = width - DEFAULT_LAYOUT.padding * 2
      for (const shelf of shelves) {
        expect(measureShelf(shelf)).toBeLessThanOrEqual(available)
        expect(shelf.usedWidth).toBeLessThanOrEqual(available)
        expect(shelf.freeWidth).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('es determinista: dos llamadas dan el mismo plano', () => {
    const books = makeBooks(25)
    const a = layoutShelves(books, { shelfWidth: 390 })
    const b = layoutShelves(books, { shelfWidth: 390 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('intercala macetas y las reparte entre baldas', () => {
    const shelves = layoutShelves(makeBooks(60), { shelfWidth: 414 })
    const plants = shelves.flatMap((shelf) =>
      shelf.items.filter((item) => item.kind === 'plant')
    )
    expect(plants.length).toBeGreaterThan(2)
    for (const plant of plants) {
      expect(DEFAULT_LAYOUT.plantVariants).toContain(plant.variant)
      expect(plant.width).toBe(DEFAULT_LAYOUT.plantWidth)
    }
    // Y no todas iguales: la variedad visual es el objetivo de la pieza.
    expect(new Set(plants.map((plant) => plant.variant)).size).toBeGreaterThan(1)
  })

  it('ninguna maceta empuja un libro a la balda siguiente', () => {
    const shelves = layoutShelves(makeBooks(60), { shelfWidth: 414 })
    const available = 414 - DEFAULT_LAYOUT.padding * 2
    shelves.forEach((shelf, index) => {
      const next = shelves[index + 1]
      if (!next) return
      // Ancho de la balda si se quitaran las macetas de remate: lo que había
      // cuando el empaquetador decidió que el libro siguiente ya no cabía.
      let used = shelf.usedWidth
      for (let i = shelf.items.length - 1; i >= 0; i -= 1) {
        if (shelf.items[i].kind !== 'plant') break
        used -= shelf.items[i].width + DEFAULT_LAYOUT.gap
      }
      const firstOfNext = next.items.find((item) => item.kind === 'book')
      expect(used + DEFAULT_LAYOUT.gap + firstOfNext.width).toBeGreaterThan(available)
    })
  })

  it('no amontona macetas: como mucho dos de remate', () => {
    const shelves = layoutShelves(makeBooks(37), { shelfWidth: 414 })
    for (const shelf of shelves) {
      let tail = 0
      for (let i = shelf.items.length - 1; i >= 0; i -= 1) {
        if (shelf.items[i].kind !== 'plant') break
        tail += 1
      }
      expect(tail).toBeLessThanOrEqual(DEFAULT_LAYOUT.maxTailPlants)
    }
  })

  it('la balda que queda a medias se remata con una maceta', () => {
    const shelves = layoutShelves(makeBooks(12), { shelfWidth: 414 })
    expect(shelves.length).toBeGreaterThan(1)
    const last = shelves.at(-1)
    // Queda media balda libre: ahí va la maceta, no un hueco pelado.
    expect(last.items.at(-1).kind).toBe('plant')
  })

  it('un solo libro cabe aunque la balda sea justa', () => {
    const shelves = layoutShelves(makeBooks(3), { shelfWidth: 90, padding: 8 })
    expect(shelves.length).toBeGreaterThan(0)
    const books = shelves.flatMap((s) => s.items).filter((i) => i.kind === 'book')
    expect(books).toHaveLength(3)
  })

  it('sólo se inclina el último libro de una balda, y dentro del máximo', () => {
    const shelves = layoutShelves(makeBooks(80), { shelfWidth: 375 })
    for (const shelf of shelves) {
      shelf.items.forEach((item, index) => {
        if (!item.tilt) return
        expect(index).toBe(shelf.items.length - 1)
        expect(item.tilt).toBeGreaterThan(0)
        expect(item.tilt).toBeLessThanOrEqual(DEFAULT_LAYOUT.maxTilt)
      })
    }
  })
})

describe('progressOf / isInProgress', () => {
  it('acepta progressFraction y progress, y recorta a 0..1', () => {
    expect(progressOf({ progressFraction: 0.42 })).toBe(0.42)
    expect(progressOf({ progress: 0.5 })).toBe(0.5)
    expect(progressOf({ progressFraction: 5 })).toBe(1)
    expect(progressOf({ progressFraction: -2 })).toBe(0)
    expect(progressOf({})).toBe(0)
  })

  it('en curso = empezado y sin terminar', () => {
    expect(isInProgress({ progressFraction: 0.3 })).toBe(true)
    expect(isInProgress({ progressFraction: 0 })).toBe(false)
    expect(isInProgress({ progressFraction: 1 })).toBe(false)
  })
})

describe('buildSections', () => {
  const books = [
    { id: 'a', title: 'Ana', author: 'Zola', progressFraction: 0.4, lastOpenedAt: 300 },
    { id: 'b', title: 'Beto', author: 'Alas', progressFraction: 0, lastOpenedAt: 200 },
    { id: 'c', title: 'Caro', author: 'Mann', progressFraction: 0.9, lastOpenedAt: 500 },
    { id: 'd', title: 'Dani', author: 'borges', progressFraction: 1, lastOpenedAt: 100 }
  ]

  it('separa "seguir leyendo" del resto sin duplicar ningún libro', () => {
    const sections = buildSections(books)
    const ids = sections.flatMap((section) => section.books.map((book) => book.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ordena los recientes por última apertura', () => {
    const [recent] = buildSections(books)
    expect(recent.id).toBe('recent')
    expect(recent.books.map((book) => book.id)).toEqual(['c', 'a'])
  })

  it('ordena la biblioteca por autor, ignorando mayúsculas y acentos', () => {
    const library = buildSections(books).find((section) => section.id === 'library')
    expect(library.books.map((book) => book.author)).toEqual(['Alas', 'borges'])
  })

  it('respeta el límite de recientes', () => {
    const many = makeBooks(12, (i) => ({ progressFraction: 0.5, lastOpenedAt: i }))
    const [recent] = buildSections(many, { recentLimit: 4 })
    expect(recent.books).toHaveLength(4)
  })

  it('si sólo hay una sección, no la titula', () => {
    const sections = buildSections([{ id: 'x', title: 'Solo', progressFraction: 0 }])
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe('')
  })

  it('biblioteca vacía = ninguna sección', () => {
    expect(buildSections([])).toEqual([])
    expect(buildSections(null)).toEqual([])
  })
})

describe('planBookshelf', () => {
  it('devuelve secciones ya empaquetadas y cuadra el recuento', () => {
    const books = makeBooks(30, (i) => ({ progressFraction: i < 3 ? 0.5 : 0 }))
    const plan = planBookshelf(books, { shelfWidth: 390 })
    const total = plan.reduce((sum, section) => sum + section.count, 0)
    expect(total).toBe(books.length)
    for (const section of plan) {
      const placed = section.shelves
        .flatMap((shelf) => shelf.items)
        .filter((item) => item.kind === 'book')
      expect(placed).toHaveLength(section.count)
    }
  })
})
