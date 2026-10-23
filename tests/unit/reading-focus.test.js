import { beforeEach, describe, expect, it } from 'vitest'
import { bindReadingFocus } from '../../src/js/reading-focus.js'

const markup = `
  <label data-reading-focus-setting hidden><input id="reading-focus-toggle" type="checkbox" /></label>
  <p id="reading-focus-hint" hidden></p>`

function fakeBridge({ supported = true, enabled = true, access = false } = {}) {
  const bridge = {
    calls: [],
    state() { return JSON.stringify(bridge.current) },
    setEnabled(value) { bridge.calls.push(['setEnabled', value]); bridge.current.enabled = value },
    openAccess() { bridge.calls.push(['openAccess']) }
  }
  bridge.current = { supported, enabled, access }
  return bridge
}

const toggle = () => document.getElementById('reading-focus-toggle')
const row = () => document.querySelector('[data-reading-focus-setting]')
const hint = () => document.getElementById('reading-focus-hint')
const click = () => { toggle().click() }

describe('Sin avisos al leer', () => {
  beforeEach(() => { document.body.innerHTML = markup; delete window.InhouseReadingFocus })

  it('se queda oculto fuera de la app Android o sin soporte', () => {
    bindReadingFocus(document)
    expect(row().hidden).toBe(true)
    window.InhouseReadingFocus = fakeBridge({ supported: false })
    bindReadingFocus(document)
    expect(row().hidden).toBe(true)
  })

  it('pide el permiso de No molestar y explica dónde darlo', () => {
    const bridge = window.InhouseReadingFocus = fakeBridge()
    const release = bindReadingFocus(document)
    expect(row().hidden).toBe(false)
    expect(toggle().checked).toBe(false)
    expect(hint().hidden).toBe(true)
    click()
    expect(bridge.calls).toEqual([['setEnabled', true], ['openAccess']])
    expect(toggle().checked).toBe(false)
    expect(hint().hidden).toBe(false)
    // Vuelve de Ajustes con el permiso concedido.
    bridge.current.access = true
    window.dispatchEvent(new Event('focus'))
    expect(toggle().checked).toBe(true)
    expect(hint().hidden).toBe(true)
    release()
  })

  it('con permiso se enciende y se apaga sin abrir Ajustes', () => {
    const bridge = window.InhouseReadingFocus = fakeBridge({ enabled: false, access: true })
    bindReadingFocus(document)
    expect(toggle().checked).toBe(false)
    click()
    expect(toggle().checked).toBe(true)
    click()
    expect(toggle().checked).toBe(false)
    expect(bridge.calls).toEqual([['setEnabled', true], ['setEnabled', false]])
  })
})
