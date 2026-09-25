import { describe, it, expect } from 'vitest'
import {
  PLANT_VARIANTS,
  PLANT_TONES,
  POT_TONES,
  plantSvg,
  plantMeta,
  tonesFor
} from '../../src/js/plants.js'

describe('plantMeta', () => {
  it('describe cada variante con un viewBox usable', () => {
    for (const variant of PLANT_VARIANTS) {
      const meta = plantMeta(variant)
      expect(meta.variant).toBe(variant)
      expect(meta.viewBox).toMatch(/^0 0 100 \d+$/)
      expect(meta.aspect).toBeGreaterThan(0)
      expect(meta.overhangRatio).toBeGreaterThanOrEqual(0)
      expect(meta.overhangRatio).toBeLessThan(1)
    }
  })

  it('sólo la colgante sobresale por debajo de la balda', () => {
    expect(plantMeta('pothos').overhangRatio).toBeGreaterThan(0)
    for (const variant of PLANT_VARIANTS.filter((name) => name !== 'pothos')) {
      expect(plantMeta(variant).overhangRatio).toBe(0)
    }
  })

  it('una variante desconocida cae en la primera en vez de romper', () => {
    expect(plantMeta('ficus-inventado').variant).toBe(PLANT_VARIANTS[0])
  })
})

describe('plantSvg', () => {
  it('genera SVG bien formado para todas las variantes', () => {
    for (const variant of PLANT_VARIANTS) {
      const markup = plantSvg(variant, { seed: 'balda-1' })
      expect(markup.startsWith('<svg')).toBe(true)
      expect(markup.trimEnd().endsWith('</svg>')).toBe(true)
      expect(markup).toContain(`viewBox="${plantMeta(variant).viewBox}"`)
      expect(markup).toContain('aria-hidden="true"')
      // Dibujo propio: nada de imágenes externas ni scripts.
      expect(markup).not.toContain('<script')
      expect(markup).not.toContain('<image')
      expect(markup).not.toContain('http://')
    }
  })

  it('el navegador lo parsea sin errores', () => {
    for (const variant of PLANT_VARIANTS) {
      const doc = new DOMParser().parseFromString(
        plantSvg(variant, { seed: 'x', standalone: true }),
        'image/svg+xml'
      )
      expect(doc.querySelector('parsererror')).toBeNull()
      expect(doc.documentElement.tagName).toBe('svg')
      expect(doc.querySelectorAll('path, rect, circle, ellipse').length).toBeGreaterThan(3)
    }
  })

  it('es determinista por semilla y cambia con ella', () => {
    expect(plantSvg('monstera', { seed: 'a' })).toBe(plantSvg('monstera', { seed: 'a' }))
    expect(plantSvg('monstera', { seed: 'a' })).not.toBe(plantSvg('monstera', { seed: 'b' }))
  })

  it('usa custom properties para el color, con literal de reserva', () => {
    const markup = plantSvg('monstera', { seed: 'a' })
    expect(markup).toMatch(/var\(--ihr-leaf-[abc], #[0-9A-Fa-f]{6}\)/)
    expect(markup).toMatch(/var\(--ihr-pot, #[0-9A-Fa-f]{6}\)/)
  })

  it('sólo añade xmlns cuando se pide suelto (para escribir un .svg)', () => {
    expect(plantSvg('cactus', { standalone: true })).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(plantSvg('cactus')).not.toContain('xmlns=')
  })

  it('con tones:false no fija tonos y deja mandar al CSS de la página', () => {
    expect(plantSvg('cactus', { tones: false })).not.toContain('--ihr-leaf-a:')
  })
})

describe('tonesFor', () => {
  it('es determinista y siempre devuelve un juego completo', () => {
    const tones = tonesFor('semilla')
    expect(tonesFor('semilla')).toEqual(tones)
    for (const key of ['--ihr-leaf-a', '--ihr-leaf-b', '--ihr-leaf-c', '--ihr-stem', '--ihr-pot']) {
      expect(tones[key]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('reparte entre todas las paletas disponibles', () => {
    const leaves = new Set()
    const pots = new Set()
    for (let i = 0; i < 60; i += 1) {
      const tones = tonesFor(`balda-${i}`)
      leaves.add(tones.name)
      pots.add(tones['--ihr-pot'])
    }
    expect(leaves.size).toBe(PLANT_TONES.length)
    expect(pots.size).toBe(POT_TONES.length)
  })
})
