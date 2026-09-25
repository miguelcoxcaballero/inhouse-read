import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  compareSemanticVersions, detectInhouseApp, getInstalledAndroidAppVersion,
  validateManifest, shouldOfferUpdate
} from '../../src/js/android-update.js'

describe('compareSemanticVersions', () => {
  it('detecta que la derecha es mayor', () => {
    expect(compareSemanticVersions('1.0.0', '1.0.1')).toBeLessThan(0)
  })

  it('detecta que la izquierda es mayor', () => {
    expect(compareSemanticVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
  })

  it('detecta igualdad', () => {
    expect(compareSemanticVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('compara numéricamente, no como texto (1.10.0 > 1.9.0)', () => {
    expect(compareSemanticVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  it('trata partes que faltan como 0', () => {
    expect(compareSemanticVersions('1.2', '1.2.0')).toBe(0)
    expect(compareSemanticVersions('1.2.1', '1.2')).toBeGreaterThan(0)
  })

  it('trata valores vacíos/inválidos como 0.0.0', () => {
    expect(compareSemanticVersions('', '')).toBe(0)
    expect(compareSemanticVersions('x.y.z', '')).toBe(0)
  })
})

describe('shouldOfferUpdate', () => {
  it('ofrece actualizar si la versión del manifiesto es más nueva', () => {
    expect(shouldOfferUpdate({ version: '1.0.2' }, '1.0.1')).toBe(true)
  })

  it('no ofrece nada si ya está en la última versión', () => {
    expect(shouldOfferUpdate({ version: '1.0.1' }, '1.0.1')).toBe(false)
  })

  it('no ofrece nada si la instalada es más nueva que el manifiesto', () => {
    expect(shouldOfferUpdate({ version: '1.0.0' }, '1.0.1')).toBe(false)
  })

  it('required:false desactiva el aviso aunque haya versión nueva', () => {
    expect(shouldOfferUpdate({ version: '1.0.2', required: false }, '1.0.1')).toBe(false)
  })

  it('required ausente se trata como true (igual que en Notes)', () => {
    expect(shouldOfferUpdate({ version: '1.0.2' }, '1.0.1')).toBe(true)
  })
})

describe('validateManifest', () => {
  it('acepta un manifiesto válido con host permitido', () => {
    const result = validateManifest({
      version: '1.0.2',
      apkUrl: 'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/android-v1.0.2/x.apk'
    })
    expect(result.version).toBe('1.0.2')
  })

  it('rechaza un formato de versión inválido', () => {
    expect(() => validateManifest({ version: '1.0', apkUrl: 'https://github.com/x' })).toThrow()
  })

  it('rechaza un host no permitido', () => {
    expect(() => validateManifest({
      version: '1.0.2',
      apkUrl: 'https://evil.example.com/x.apk'
    })).toThrow(/no permitido/)
  })

  it('rechaza http (no https)', () => {
    expect(() => validateManifest({
      version: '1.0.2',
      apkUrl: 'http://github.com/x.apk'
    })).toThrow()
  })

  it('rechaza un manifiesto vacío', () => {
    expect(() => validateManifest(null)).toThrow()
  })
})

describe('detectInhouseApp', () => {
  const originalUA = navigator.userAgent

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true })
    window.history.replaceState(null, '', '/')
    localStorage.clear()
  })

  it('es false por defecto (navegador normal)', () => {
    expect(detectInhouseApp()).toBe(false)
  })

  it('detecta la app por el parámetro ?inhouse_app=1', () => {
    window.history.replaceState(null, '', '/?inhouse_app=1')
    expect(detectInhouseApp()).toBe(true)
  })

  it('detecta la app por el user-agent que fija MainActivity', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 InhouseReadApp/1.0.2',
      configurable: true
    })
    expect(detectInhouseApp()).toBe(true)
  })

  it('recuerda la detección en localStorage entre navegaciones', () => {
    window.history.replaceState(null, '', '/?inhouse_app=1')
    expect(detectInhouseApp()).toBe(true)
    window.history.replaceState(null, '', '/otra-pagina')
    expect(detectInhouseApp()).toBe(true)
  })

  it('?inhouse_app=0 limpia la detección recordada', () => {
    window.history.replaceState(null, '', '/?inhouse_app=1')
    expect(detectInhouseApp()).toBe(true)
    window.history.replaceState(null, '', '/?inhouse_app=0')
    expect(detectInhouseApp()).toBe(false)
  })
})

describe('getInstalledAndroidAppVersion', () => {
  afterEach(() => {
    delete globalThis.InhouseNative
  })

  it('usa el puente nativo cuando existe y devuelve un formato válido', () => {
    globalThis.InhouseNative = { getAppVersion: () => '1.0.2' }
    expect(getInstalledAndroidAppVersion()).toBe('1.0.2')
  })

  it('ignora el puente nativo si devuelve un formato raro', () => {
    globalThis.InhouseNative = { getAppVersion: () => 'not-a-version' }
    expect(getInstalledAndroidAppVersion()).not.toBe('not-a-version')
  })

  it('cae a la versión legado si no hay puente nativo ni pista en el user-agent', () => {
    expect(getInstalledAndroidAppVersion()).toBe('1.0.0')
  })
})
