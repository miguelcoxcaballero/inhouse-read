// Guarda los libros importados dentro de una carpeta real del dispositivo,
// elegida una vez por el usuario, usando la File System Access API
// (`showDirectoryPicker`).
//
// LIMITACIÓN REAL — léase antes de asumir que esto funciona en todas partes:
// `showDirectoryPicker` solo existe en navegadores Chromium de escritorio
// (Chrome/Edge en Windows/Mac/Linux). NO está disponible en:
//   - Chrome para Android (ni ningún navegador móvil, de hecho)
//   - Ningún WebView embebido, incluido el de la app Android empaquetada
//     con Capacitor (android/html_to_apk_builder.py)
//   - Safari (de escritorio o iOS)
// `isFolderApiSupported()` detecta esto y el resto de la app debe comportarse
// como hasta ahora (biblioteca solo en IndexedDB, hay que volver a
// seleccionar el archivo al reabrir) cuando devuelve false. No hay ningún
// polyfill razonable: la alternativa nativa real para la app Android sería
// un plugin de Capacitor a medida invocando Storage Access Framework, que no
// está implementado (ver android/README.md).

import { withCloudModule } from './cloud-native.js'

// Everything but the test below is rust-ui/src/folder_store.rs (the names are cleaned by
// rust-core/src/file_name.rs, compiled into it): the copy, the read-back, the permission, the directory
// handle remembered in IndexedDB and the call of the browser's picker.

export function isFolderApiSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/** Handle guardado de una sesión anterior, o null si nunca se eligió carpeta. */
export async function getSavedFolderHandle() {
  return isFolderApiSupported() ? withCloudModule(ui => ui.folderSavedHandle()) : null
}

/** Pide al usuario que elija una carpeta y la recuerda para la próxima vez. */
export const chooseFolder = () => withCloudModule(ui => ui.chooseFolder())

/** The permission of a stored directory may have lapsed: it is asked for again before reading or writing. */
export const ensureFolderPermission = handle => withCloudModule(ui => ui.ensureFolderPermission(handle))

/** Handle ya guardado y con permiso vigente, o pide elegir uno nuevo si hace falta. */
export const getOrChooseFolder = () => withCloudModule(ui => ui.getOrChooseFolder(isFolderApiSupported()))

/** `String(name)` with every run of reserved characters replaced by one underscore, trimmed; "libro" when nothing is left. */
export const sanitizeFileName = name => withCloudModule(ui => ui.sanitizeFileName(name))

/** Evita pisar un archivo distinto con el mismo nombre; el mismo tamaño se toma por el mismo libro. */
export const resolveNonCollidingName = (handle, name, size) => withCloudModule(ui => ui.resolveNonCollidingName(handle, name, size))

/** Copia el archivo dentro de la carpeta elegida. Devuelve el nombre final usado. */
export const saveFileIntoFolder = (handle, file) => withCloudModule(ui => ui.saveFileIntoFolder(handle, file))

/** Lee de vuelta un libro ya guardado, o null si ya no está (borrado, etc.). */
export const readFileFromFolder = (handle, name) => withCloudModule(ui => ui.readFileFromFolder(handle, name))
