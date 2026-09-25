import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { LibraryStore, idForSource } from '../../src/js/library-store.js'

describe('idForSource', () => {
  it('genera un id estable para archivos locales basado en nombre+tamaño', () => {
    const a = idForSource({ sourceType: 'local', name: 'dune.epub', size: 12345 })
    const b = idForSource({ sourceType: 'local', name: 'dune.epub', size: 12345 })
    expect(a).toBe(b)
    expect(a).toBe('local:dune.epub:12345')
  })

  it('usa el driveFileId como id para libros de Drive', () => {
    expect(idForSource({ sourceType: 'drive', driveFileId: 'abc123' })).toBe('drive:abc123')
  })
})

describe('LibraryStore', () => {
  let store
  let dbCounter = 0

  beforeEach(() => {
    // Cada test recibe su propia base de datos IndexedDB (nombre único) para
    // quedar completamente aislado del resto, sin depender de borrar y
    // esperar el cierre de conexiones previas.
    store = new LibraryStore(`inhouse-read-test-${dbCounter++}`)
  })

  it('empieza vacía', async () => {
    expect(await store.listRecents()).toEqual([])
  })

  it('añade un libro nuevo con addOrTouch', async () => {
    const record = await store.addOrTouch({
      sourceType: 'local', name: 'dune.epub', size: 100, title: 'Dune', format: 'EPUB'
    })
    expect(record.id).toBe('local:dune.epub:100')
    expect(record.progressFraction).toBe(0)
    expect(record.addedAt).toBeTypeOf('number')

    const recents = await store.listRecents()
    expect(recents).toHaveLength(1)
    expect(recents[0].title).toBe('Dune')
  })

  it('vuelve a tocar un libro existente en vez de duplicarlo', async () => {
    const first = await store.addOrTouch({
      sourceType: 'local', name: 'dune.epub', size: 100, title: 'Dune', format: 'EPUB'
    })
    await new Promise(r => setTimeout(r, 5))
    const second = await store.addOrTouch({
      sourceType: 'local', name: 'dune.epub', size: 100, title: 'Dune', format: 'EPUB'
    })

    const recents = await store.listRecents()
    expect(recents).toHaveLength(1)
    expect(second.addedAt).toBe(first.addedAt)
    expect(second.lastOpenedAt).toBeGreaterThanOrEqual(first.lastOpenedAt)
  })

  it('ordena listRecents por apertura más reciente primero', async () => {
    await store.addOrTouch({ sourceType: 'local', name: 'a.pdf', size: 1, title: 'A', format: 'PDF' })
    await new Promise(r => setTimeout(r, 5))
    await store.addOrTouch({ sourceType: 'local', name: 'b.pdf', size: 1, title: 'B', format: 'PDF' })
    await new Promise(r => setTimeout(r, 5))
    // Reabrir "A" debe subirlo al principio de nuevo.
    await store.addOrTouch({ sourceType: 'local', name: 'a.pdf', size: 1, title: 'A', format: 'PDF' })

    const recents = await store.listRecents()
    expect(recents.map(r => r.title)).toEqual(['A', 'B'])
  })

  it('actualiza el progreso de lectura de un libro', async () => {
    const record = await store.addOrTouch({
      sourceType: 'local', name: 'dune.epub', size: 100, title: 'Dune', format: 'EPUB'
    })
    const updated = await store.updateProgress(record.id, 0.42, { cfi: 'epubcfi(/6/4)' })
    expect(updated.progressFraction).toBe(0.42)
    expect(updated.locator).toEqual({ cfi: 'epubcfi(/6/4)' })
  })

  it('setCover guarda la portada sin tocar lastOpenedAt', async () => {
    const record = await store.addOrTouch({
      sourceType: 'local', name: 'dune.epub', size: 100, title: 'Dune', format: 'EPUB'
    })
    const blob = new Blob(['fake-cover-bytes'], { type: 'image/webp' })
    const updated = await store.setCover(record.id, blob)
    expect(updated.cover).toBe(blob)
    expect(updated.lastOpenedAt).toBe(record.lastOpenedAt)
  })

  it('setCover no crea un registro si el id no existe', async () => {
    expect(await store.setCover('local:no-existe:1', new Blob())).toBeNull()
  })

  it('updateProgress no crea un registro si el id no existe', async () => {
    const result = await store.updateProgress('local:no-existe:1', 0.5)
    expect(result).toBeNull()
  })

  it('elimina un libro de la biblioteca', async () => {
    const record = await store.addOrTouch({
      sourceType: 'local', name: 'dune.epub', size: 100, title: 'Dune', format: 'EPUB'
    })
    await store.remove(record.id)
    expect(await store.listRecents()).toEqual([])
  })

  it('respeta el límite pasado a listRecents', async () => {
    for (let i = 0; i < 5; i++) {
      await store.addOrTouch({ sourceType: 'local', name: `b${i}.pdf`, size: 1, title: `B${i}`, format: 'PDF' })
    }
    expect(await store.listRecents(2)).toHaveLength(2)
  })
})
