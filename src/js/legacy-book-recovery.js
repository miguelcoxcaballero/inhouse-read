import {
  getSavedFolderHandle, isFolderApiSupported, readFileFromFolder
} from './local-folder-store.js'
import { newContentRevision, clearBookLength } from './book-length-queue.js'
import { cloudModule } from './cloud-native.js'

/** Restores old local imports from the already-authorized library folder
 * (rust-ui/src/legacy_recovery.rs). */
export async function restoreLegacyBookBytes(library, {
  supported = isFolderApiSupported,
  getHandle = getSavedFolderHandle,
  readFile = readFileFromFolder
} = {}) {
  const ui = await cloudModule()
  return ui.restoreLegacyBookBytes(library, { supported, getHandle, readFile, clearBookLength, newContentRevision })
}
