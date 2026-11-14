// src/js/local-folder-store.js plus the doorways into the Rust cloud module that only tests went through: nothing in
// the app picks a folder, cleans a name or copies a file into the folder by these names (the Rust flows call
// rust-ui/src/folder_store.rs themselves), so they left the app's source. The Rust functions are production's.
export * from '../../../src/js/local-folder-store.js'
import { isFolderApiSupported } from '../../../src/js/local-folder-store.js'
import { withCloudModule } from '../../../src/js/cloud-native.js'

/** Pide al usuario que elija una carpeta y la recuerda para la próxima vez. */
export const chooseFolder = () => withCloudModule(ui => ui.chooseFolder())
/** Handle ya guardado y con permiso vigente, o pide elegir uno nuevo si hace falta. */
export const getOrChooseFolder = () => withCloudModule(ui => ui.getOrChooseFolder(isFolderApiSupported()))
/** `String(name)` with every run of reserved characters replaced by one underscore, trimmed; "libro" when nothing is left. */
export const sanitizeFileName = name => withCloudModule(ui => ui.sanitizeFileName(name))
/** Evita pisar un archivo distinto con el mismo nombre; el mismo tamaño se toma por el mismo libro. */
export const resolveNonCollidingName = (handle, name, size) => withCloudModule(ui => ui.resolveNonCollidingName(handle, name, size))
/** Copia el archivo dentro de la carpeta elegida. Devuelve el nombre final usado. */
export const saveFileIntoFolder = (handle, file) => withCloudModule(ui => ui.saveFileIntoFolder(handle, file))
