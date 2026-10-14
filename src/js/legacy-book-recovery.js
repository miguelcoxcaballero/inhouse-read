import {
  getSavedFolderHandle, isFolderApiSupported, readFileFromFolder
} from './local-folder-store.js'
import { newContentRevision, clearBookLength } from './book-length-queue.js'
import { withCloudModule } from './cloud-native.js'

/** Restores old local imports from the already-authorized library folder
 * (rust-ui/src/legacy_recovery.rs). */
export function restoreLegacyBookBytes(library, {
  supported = isFolderApiSupported,
  getHandle = getSavedFolderHandle,
  readFile = readFileFromFolder
} = {}) {
  return withCloudModule(ui => ui.restoreLegacyBookBytes(library, { supported, getHandle, readFile, clearBookLength, newContentRevision }))
}
