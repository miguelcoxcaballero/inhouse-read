import { describe, it, expect } from 'vitest'
import { extractModuleScriptSrc } from '../../src/js/content-freshness.js'

describe('extractModuleScriptSrc', () => {
  const baseUrl = 'https://miguelcoxcaballero.github.io/inhouse-read/'

  it('extrae el src del script module, con crossorigin de por medio', () => {
    const html = '<script type="module" crossorigin src="/inhouse-read/assets/main-DyFkh1KR.js"></script>'
    expect(extractModuleScriptSrc(html, baseUrl)).toBe(
      'https://miguelcoxcaballero.github.io/inhouse-read/assets/main-DyFkh1KR.js'
    )
  })

  it('funciona con el orden de atributos invertido (src antes que type)', () => {
    const html = '<script src="/inhouse-read/assets/main-ABC123.js" type="module"></script>'
    expect(extractModuleScriptSrc(html, baseUrl)).toBe(
      'https://miguelcoxcaballero.github.io/inhouse-read/assets/main-ABC123.js'
    )
  })

  it('detecta un hash de bundle distinto entre dos versiones del HTML', () => {
    const before = extractModuleScriptSrc(
      '<script type="module" src="/inhouse-read/assets/main-AAA.js"></script>', baseUrl
    )
    const after = extractModuleScriptSrc(
      '<script type="module" src="/inhouse-read/assets/main-BBB.js"></script>', baseUrl
    )
    expect(before).not.toBe(after)
  })

  it('devuelve null si no hay script type=module', () => {
    expect(extractModuleScriptSrc('<script src="legacy.js"></script>', baseUrl)).toBeNull()
  })

  it('devuelve null con HTML vacío', () => {
    expect(extractModuleScriptSrc('', baseUrl)).toBeNull()
  })
})
