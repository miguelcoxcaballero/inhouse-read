// STUB del motor de relieve (paquete U). El motor real lo sustituye entero:
// aquí sólo vive lo mínimo para desarrollar y probar el editor de la portada
// contra el contrato (RELIEF_IDS, normalizeCoverRelief, analyzeCoverRelief).

export const RELIEF_IDS = Object.freeze(['title-foil', 'frame-emboss', 'spot-gloss'])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** Validación de lo guardado: {id, strength:0..1} o null. */
export function normalizeCoverRelief(value) {
  if (!value || typeof value !== 'object' || !RELIEF_IDS.includes(value.id)) return null
  const strength = Number(value.strength)
  return { id: value.id, strength: Number.isFinite(strength) ? clamp(strength, 0, 1) : .7 }
}

const swatch = (a, b) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="48" height="64" fill="url(#g)"/></svg>`)

const FAKE = [
  { id: 'title-foil', label: 'Título y autor en relieve dorado', description: 'Se elevarían las letras del título y del autor con una lámina dorada.', strength: .75, confidence: .8, a: '#2c3a4a', b: '#d6ad55' },
  { id: 'frame-emboss', label: 'Marco en relieve', description: 'Se marcaría el borde de la portada como un filete grabado.', strength: .6, confidence: .55, a: '#3b2f2a', b: '#a98f6a' },
  { id: 'spot-gloss', label: 'Barniz selectivo', description: 'Las zonas oscuras más grandes llevarían un barniz brillante.', strength: .5, confidence: .35, a: '#1b1b1f', b: '#7d8791' }
]

export async function analyzeCoverRelief(coverUrl, { title, author, signal } = {}) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 220)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Cancelado', 'AbortError')) }, { once: true })
  })
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
  return {
    proposals: FAKE.map(({ a, b, ...proposal }) => ({ ...proposal, thumbnail: swatch(a, b) })),
    analysis: { stub: true, title, author }
  }
}

export async function buildReliefMaps() { return { height: null, foil: null, gloss: null } }
