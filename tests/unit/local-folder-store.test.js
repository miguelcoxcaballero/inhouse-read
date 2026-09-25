import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isFolderApiSupported, sanitizeFileName, resolveNonCollidingName, saveFileIntoFolder,
  readFileFromFolder, ensureFolderPermission
} from '../../src/js/local-folder-store.js'

/** Directorio falso mínimo, suficiente para probar la lógica sin un navegador real. */
class FakeDirHandle {
  constructor() {
    this.files = new Map() // name -> { size }
  }

  async getFileHandle(name, opts = {}) {
    if (this.files.has(name)) {
      const entry = this.files.get(name)
      return {
        getFile: async () => ({ size: entry.size }),
        createWritable: async () => ({
          write: async file => { entry.size = file.size },
          close: async () => {}
        })
      }
    }
    if (opts.create) {
      const entry = { size: 0 }
      this.files.set(name, entry)
      return {
        getFile: async () => ({ size: entry.size }),
        createWritable: async () => ({
          write: async file => { entry.size = file.size },
          close: async () => {}
        })
      }
    }
    const err = new Error('not found')
    err.name = 'NotFoundError'
    throw err
  }
}

describe('isFolderApiSupported', () => {
  afterEach(() => {
    delete window.showDirectoryPicker
  })

  it('es false cuando el navegador no expone showDirectoryPicker (jsdom, Android WebView, Safari...)', () => {
    expect(isFolderApiSupported()).toBe(false)
  })

  it('es true cuando showDirectoryPicker existe', () => {
    window.showDirectoryPicker = () => {}
    expect(isFolderApiSupported()).toBe(true)
  })
})

describe('sanitizeFileName', () => {
  it('sustituye caracteres no válidos en nombres de archivo', () => {
    expect(sanitizeFileName('mi libro: parte 1/2?.pdf')).toBe('mi libro_ parte 1_2_.pdf')
  })

  it('nunca devuelve una cadena vacía', () => {
    expect(sanitizeFileName('   ')).toBe('libro')
    expect(sanitizeFileName('')).toBe('libro')
  })
})

describe('resolveNonCollidingName', () => {
  let handle

  beforeEach(() => {
    handle = new FakeDirHandle()
  })

  it('devuelve el nombre tal cual si la carpeta está vacía', async () => {
    expect(await resolveNonCollidingName(handle, 'dune.epub', 100)).toBe('dune.epub')
  })

  it('reutiliza el nombre si ya existe un archivo del mismo tamaño (mismo libro)', async () => {
    handle.files.set('dune.epub', { size: 100 })
    expect(await resolveNonCollidingName(handle, 'dune.epub', 100)).toBe('dune.epub')
  })

  it('añade un sufijo si existe un archivo distinto con el mismo nombre', async () => {
    handle.files.set('dune.epub', { size: 999 })
    expect(await resolveNonCollidingName(handle, 'dune.epub', 100)).toBe('dune-2.epub')
  })

  it('sigue incrementando el sufijo si también colisiona', async () => {
    handle.files.set('dune.epub', { size: 999 })
    handle.files.set('dune-2.epub', { size: 888 })
    expect(await resolveNonCollidingName(handle, 'dune.epub', 100)).toBe('dune-3.epub')
  })
})

describe('saveFileIntoFolder / readFileFromFolder', () => {
  it('guarda un archivo y lo puede volver a leer', async () => {
    const handle = new FakeDirHandle()
    const file = new File([new Uint8Array(50)], 'libro.pdf')

    const savedName = await saveFileIntoFolder(handle, file)
    expect(savedName).toBe('libro.pdf')

    const readBack = await readFileFromFolder(handle, savedName)
    expect(readBack).not.toBeNull()
    expect(readBack.size).toBe(50)
  })

  it('readFileFromFolder devuelve null si el archivo ya no existe', async () => {
    const handle = new FakeDirHandle()
    expect(await readFileFromFolder(handle, 'no-existe.pdf')).toBeNull()
  })
})

describe('ensureFolderPermission', () => {
  it('devuelve false sin handle', async () => {
    expect(await ensureFolderPermission(null)).toBe(false)
  })

  it('devuelve true si el permiso ya está concedido', async () => {
    const handle = { queryPermission: async () => 'granted' }
    expect(await ensureFolderPermission(handle)).toBe(true)
  })

  it('pide el permiso si no estaba concedido, y respeta el resultado', async () => {
    const handle = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'granted'
    }
    expect(await ensureFolderPermission(handle)).toBe(true)
  })

  it('devuelve false si el usuario deniega el permiso', async () => {
    const handle = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'denied'
    }
    expect(await ensureFolderPermission(handle)).toBe(false)
  })

  it('devuelve false (no lanza) si requestPermission lanza por falta de gesto de usuario', async () => {
    const handle = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => { throw new Error('no user gesture') }
    }
    expect(await ensureFolderPermission(handle)).toBe(false)
  })
})
