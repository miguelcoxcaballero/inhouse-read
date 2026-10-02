import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { Blob as NativeBlob } from 'node:buffer'
import { LibraryStore, idForSource, sameBookRecords } from '../../src/js/library-store.js'

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
  let dbName
  let dbCounter = 0

  beforeEach(() => {
    // Cada test recibe su propia base de datos IndexedDB (nombre único) para
    // quedar completamente aislado del resto, sin depender de borrar y
    // esperar el cierre de conexiones previas.
    dbName = `inhouse-read-test-${dbCounter++}`
    store = new LibraryStore(dbName)
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

  it('conserva la posición libre en la estantería al reabrir y actualizar el progreso', async () => {
    const book = await store.addOrTouch({ sourceType:'local', name:'placed.pdf', size:100, title:'Placed' })
    const shelfPosition = { shelf:2, x:.65 }
    await store.patch(book.id, { shelfPosition, progressDirty:true, progressUpdatedAt:100 })
    await store.addOrTouch({ id:book.id, sourceType:'local', name:'placed.pdf', size:100 })
    await store.updateProgress(book.id, .5, { kind:'pdf-page', value:2 })
    await store.close()
    const reopened = new LibraryStore(dbName)
    expect((await reopened.get(book.id)).shelfPosition).toEqual(shelfPosition)
    await reopened.close()
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

  it('guarda los bytes del propio libro (content), no solo sus metadatos', async () => {
    // Sin esto, reabrir un libro local no tiene de dónde sacar el fichero:
    // app.js cae al selector de archivos del sistema en cada toque.
    const content = new Blob(['contenido-del-libro'], { type: 'application/epub+zip' })
    const record = await store.addOrTouch({
      sourceType: 'local', name: 'dune.epub', size: 100, title: 'Dune', format: 'EPUB', content
    })
    expect(record.content).toBe(content)
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

  it('retira el libro, sus bytes y portada, dejando solo su identidad persistente', async () => {
    const original = new Blob(['original-file'], { type:'application/pdf' })
    const book = await store.addOrTouch({ sourceType:'local', name:'removed.pdf', size:original.size,
      title:'Removed', author:'Someone', content:original, cover:new Blob(['cover']),
      locator:{ kind:'pdf-page', value:3 }, driveFileId:'drive-removed', cloudAccountId:'account-1' })
    await store.removeFromShelf(book)
    expect(await store.listAll()).toEqual([])
    expect(await store.get(book.id)).toBeNull()
    expect(original.size).toBe(13)
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const removals = await new Promise(resolve => {
      const request = db.transaction('removed-books').objectStore('removed-books').getAll()
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    expect(removals).toEqual([{ id:book.id, name:'removed.pdf', size:13,
      driveFileId:'drive-removed', cloudAccountId:'account-1', removedAt:expect.any(Number) }])
    await store.close()
    store = new LibraryStore(dbName)
    expect(await store.isRemovedFromShelf(book)).toBe(true)
    expect(await store.listAll()).toEqual([])
  })

  it('no permite que un guardado o una importación automática resucite un libro retirado', async () => {
    const book = await store.addOrTouch({ sourceType:'local', name:'late.pdf', size:10, content:new Blob(['pdf']) })
    await store.removeFromShelf(book.id)
    expect(await store.addOrTouch(book)).toBeNull()
    expect(await store.patch(book.id, { content:new Blob(['late-bytes']) })).toBeNull()
    expect(await store.setCover(book.id, new Blob(['late-cover']))).toBeNull()
    expect(await store.updateProgress(book.id, .8, { kind:'pdf-page', value:8 })).toBeNull()
    expect(await store.listAll()).toEqual([])
  })

  it('permite reimportar explícitamente el archivo local después de retirarlo', async () => {
    const book = await store.addOrTouch({ sourceType:'local', name:'again.pdf', size:10 })
    await store.removeFromShelf(book)
    const imported = await store.addOrTouch({ ...book, content:new Blob(['new-copy']) }, { restoreRemoved:true })
    expect(imported.id).toBe(book.id)
    expect(imported.content.size).toBe(8)
    expect(await store.isRemovedFromShelf(book)).toBe(false)
    expect(await store.listAll()).toHaveLength(1)
  })

  it('bloquea el alias de Drive del libro local y lo restaura desde el selector de Drive', async () => {
    const local = await store.addOrTouch({ sourceType:'local', name:'linked.epub', size:12,
      driveFileId:'linked-drive', cloudAccountId:'account-1' })
    await store.removeFromShelf(local)
    const remote = { sourceType:'drive', name:'linked.epub', size:12, driveFileId:'linked-drive', cloudAccountId:'account-1' }
    expect(await store.isRemovedFromShelf(remote)).toBe(true)
    expect(await store.addOrTouch(remote)).toBeNull()
    expect(await store.addOrTouch(remote, { restoreRemoved:true })).toMatchObject({ id:'drive:linked-drive' })
    expect(await store.isRemovedFromShelf(remote)).toBe(false)
    expect(await store.isRemovedFromShelf(local.id)).toBe(false)
  })

  it('no oculta otro archivo de nombre idéntico en una cuenta de Drive distinta', async () => {
    const book = await store.addOrTouch({ sourceType:'drive', name:'same.pdf', size:12,
      driveFileId:'drive-a', cloudAccountId:'account-a' })
    await store.removeFromShelf(book)
    const other = { sourceType:'drive', name:'same.pdf', size:12, driveFileId:'drive-b', cloudAccountId:'account-b' }
    expect(await store.isRemovedFromShelf(other)).toBe(false)
    expect(await store.addOrTouch(other)).toMatchObject({ id:'drive:drive-b' })
  })

  it('recuerda el ID de una subida tardía sin volver a guardar el archivo', async () => {
    const book = await store.addOrTouch({ sourceType:'local', name:'upload.pdf', size:5, content:new Blob(['bytes']) })
    await store.removeFromShelf(book)
    await store.rememberRemovedDriveLink(book, 'late-drive', 'account-1')
    expect(await store.isRemovedFromShelf({ driveFileId:'late-drive', cloudAccountId:'account-1' })).toBe(true)
    expect(await store.get(book.id)).toBeNull()
    await store.addOrTouch(book, { restoreRemoved:true })
    await store.rememberRemovedDriveLink(book, 'even-later-drive', 'account-1')
    expect(await store.isRemovedFromShelf(book)).toBe(false)
    expect(await store.get(book.id)).not.toBeNull()
  })

  it('clear limpia también los marcadores de retirada', async () => {
    const book = await store.addOrTouch({ sourceType:'local', name:'clear.pdf', size:1 })
    await store.removeFromShelf(book)
    await store.clear()
    expect(await store.isRemovedFromShelf(book)).toBe(false)
    expect(await store.addOrTouch(book)).not.toBeNull()
  })

  it('migra la biblioteca anterior conservando los archivos y el progreso', async () => {
    const previousName = `${dbName}-schema-1`
    const db = await new Promise(resolve => {
      const request = indexedDB.open(previousName, 1)
      request.onupgradeneeded = () => {
        const books = request.result.createObjectStore('books', { keyPath:'id' })
        books.createIndex('lastOpenedAt', 'lastOpenedAt')
      }
      request.onsuccess = () => resolve(request.result)
    })
    const oldBook = { id:'local:old.pdf:3', name:'old.pdf', content:new NativeBlob(['pdf']),
      progressFraction:.7, locator:{ kind:'pdf-page', value:7 }, lastOpenedAt:100 }
    await new Promise(resolve => {
      const transaction = db.transaction('books', 'readwrite')
      transaction.objectStore('books').put(oldBook)
      transaction.oncomplete = resolve
    })
    db.close()
    const migrated = new LibraryStore(previousName)
    expect(await migrated.get(oldBook.id)).toMatchObject({ progressFraction:.7, locator:oldBook.locator })
    expect((await migrated.get(oldBook.id)).content.size).toBe(3)
    await migrated.removeFromShelf(oldBook.id)
    expect(await migrated.get(oldBook.id)).toBeNull()
    await migrated.close()
  })

  it('respeta el límite pasado a listRecents', async () => {
    for (let i = 0; i < 5; i++) {
      await store.addOrTouch({ sourceType: 'local', name: `b${i}.pdf`, size: 1, title: `B${i}`, format: 'PDF' })
    }
    expect(await store.listRecents(2)).toHaveLength(2)
  })
})

describe('sameBookRecords', () => {
  const record = (extra = {}) => ({
    id: 'local:dune.epub:1', title: 'Dune', progressFraction: .25, locator: { cfi: 'epubcfi(/6/4)', path: [1, 2] },
    cover: new Blob(['cover'], { type: 'image/png' }), content: new Blob(['0123456789'], { type: 'application/epub+zip' }),
    shelfPosition: { shelf: 1, x: .4 }, ...extra
  })

  it('treats a fresh read of identical records as the same shelf, comparing Blobs by type and size', () => {
    expect(sameBookRecords([record(), record({ id: 'b' })], [record(), record({ id: 'b' })])).toBe(true)
    expect(sameBookRecords([], [])).toBe(true)
  })

  it('notices any field a shelf could draw changing', () => {
    expect(sameBookRecords([record()], [record({ progressFraction: .5 })])).toBe(false)
    expect(sameBookRecords([record()], [record({ locator: { cfi: 'epubcfi(/6/4)', path: [1, 3] } })])).toBe(false)
    expect(sameBookRecords([record()], [record({ shelfPosition: { shelf: 2, x: .4 } })])).toBe(false)
    expect(sameBookRecords([record()], [record({ coverUpdatedAt: 5 })])).toBe(false)
    expect(sameBookRecords([record()], [record({ title: 'Dune Messiah' })])).toBe(false)
  })

  it('notices a replaced or missing Blob and a different list', () => {
    expect(sameBookRecords([record()], [record({ cover: new Blob(['a larger cover'], { type: 'image/png' }) })])).toBe(false)
    expect(sameBookRecords([record()], [record({ cover: new Blob(['cover'], { type: 'image/jpeg' }) })])).toBe(false)
    expect(sameBookRecords([record()], [record({ cover: undefined })])).toBe(false)
    expect(sameBookRecords([record()], [record({ content: 'text' })])).toBe(false)
    expect(sameBookRecords([record()], [record(), record({ id: 'b' })])).toBe(false)
    expect(sameBookRecords([record(), record({ id: 'b' })], [record({ id: 'b' }), record()])).toBe(false)
  })

  it('never claims equality for values it cannot compare', () => {
    expect(sameBookRecords([record({ stamp: new Date(1) })], [record({ stamp: new Date(1) })])).toBe(true)
    expect(sameBookRecords([record({ stamp: new Date(1) })], [record({ stamp: new Date(2) })])).toBe(false)
    expect(sameBookRecords([record({ map: new Map([[1, 2]]) })], [record({ map: new Map([[1, 2]]) })])).toBe(false)
    expect(sameBookRecords([record({ list: [1] })], [record({ list: { 0: 1 } })])).toBe(false)
  })
})
