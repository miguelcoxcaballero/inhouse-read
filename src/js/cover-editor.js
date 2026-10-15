// Lógica pura del editor de la portada: pestañas, pose del libro y balanceo.
// Sin DOM ni Three: las decisiones corren en Rust (rust-ui/src/cover_editor.rs, el módulo
// `shelf` que espera el primer render de la estantería) y las usa bookshelf.js.
import { needRustShelf } from './rust-shelf.js'

export const EDITOR_TABS = Object.freeze([
  Object.freeze({ id: 'spine', label: 'Lomo', heading: 'Lomo' }),
  Object.freeze({ id: 'cover', label: 'Portada', heading: 'Portada' })
])

export const editorTabId = value => needRustShelf().editor_tab_id(value)

/** Teclado de una lista de pestañas: devuelve la pestaña destino o null. */
export const nextEditorTab = (current, key) => needRustShelf().next_editor_tab(current, key)

/** Pose de la portada de frente para la hoja del editor (misma convención que view.animate). */
export const coverEditorPose = options => needRustShelf().cover_editor_pose(options)

/** Balanceo alrededor de la pose de portada, en cuadratura y con envolvente suave. */
export const coverTiltFrames = (base, options) => needRustShelf().cover_tilt_frames(base, options)
