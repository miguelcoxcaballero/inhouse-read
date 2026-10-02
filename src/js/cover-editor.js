// Lógica pura del editor de la portada: pestañas, pose del libro y balanceo.
// Sin DOM ni Three: se prueba aparte y la usa bookshelf.js.

export const EDITOR_TABS = Object.freeze([
  Object.freeze({ id: 'spine', label: 'Lomo', heading: 'Lomo' }),
  Object.freeze({ id: 'cover', label: 'Portada', heading: 'Portada' })
])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function editorTabId(value) {
  return EDITOR_TABS.some(tab => tab.id === value) ? value : EDITOR_TABS[0].id
}

/** Teclado de una lista de pestañas: devuelve la pestaña destino o null. */
export function nextEditorTab(current, key) {
  const index = Math.max(0, EDITOR_TABS.findIndex(tab => tab.id === current))
  const last = EDITOR_TABS.length - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return EDITOR_TABS[index === last ? 0 : index + 1].id
  if (key === 'ArrowLeft' || key === 'ArrowUp') return EDITOR_TABS[index === 0 ? last : index - 1].id
  if (key === 'Home') return EDITOR_TABS[0].id
  if (key === 'End') return EDITOR_TABS[last].id
  return null
}

/**
 * Pose de la portada de frente para la hoja del editor: cabe en la franja
 * libre sobre la hoja (móvil y bandeja ancha) o, con la hoja a un lado
 * (horizontal bajo), se queda donde vuela el libro. Misma convención que
 * view.animate: y positivo baja el modelo, x/y relativos al centro de vuelo.
 */
export function coverEditorPose({
  viewportWidth, viewportHeight, landscape = false, coverW, coverH, centerY, thickness = 0, sheetTop
}) {
  if (landscape) return { x: 0, y: 0, scale: 1, angle: 0, pitch: 0 }
  const wide = viewportWidth >= 760
  const top = wide ? 36 : 56, gap = wide ? 22 : 18
  const measured = Number.isFinite(sheetTop) && sheetTop > top + 120
  const bottom = (measured ? sheetTop : viewportHeight * .56) - gap
  const band = Math.max(80, bottom - top)
  const fitWidth = (viewportWidth - 32) / Math.max(1, coverW + thickness)
  const scale = clamp(Math.min(band / Math.max(1, coverH), fitWidth), .01, wide ? 1.2 : 1)
  // La franja y la anchura limitan la escala, incluso para portadas muy altas.
  return { x: 0, y: top + band / 2 - centerY, scale, angle: 0, pitch: 0 }
}

/**
 * Balanceo alrededor de la pose de portada: guiñada y cabeceo en cuadratura
 * (la luz recorre la superficie en elipse, no en línea), con una envolvente
 * que entra y sale suave. Empieza y acaba exactamente en la pose base.
 */
export function coverTiltFrames(base, {
  cycles = 3, yaw = 12, pitch = 7, duration = 2400, stepsPerCycle = 8
} = {}) {
  const steps = Math.max(2, Math.round(cycles * stepsPerCycle))
  const frames = []
  for (let index = 0; index <= steps; index++) {
    const t = index / steps
    const edge = index === 0 || index === steps
    const envelope = edge ? 0 : Math.min(1, Math.sin(Math.PI * t) * 1.7)
    const phase = 2 * Math.PI * cycles * t
    frames.push({ transform: {
      ...base,
      angle: base.angle + (edge ? 0 : yaw * envelope * Math.sin(phase)),
      pitch: (base.pitch ?? 0) + (edge ? 0 : pitch * envelope * Math.cos(phase))
    } })
  }
  return { frames, duration }
}
