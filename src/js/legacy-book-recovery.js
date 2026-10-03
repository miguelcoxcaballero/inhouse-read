import {
  getSavedFolderHandle, isFolderApiSupported, readFileFromFolder
} from './local-folder-store.js'
import { newContentRevision, clearBookLength } from './book-length-queue.js'

/** Restores old local imports from the already-authorized library folder. */
export async function restoreLegacyBookBytes(library, {
  supported = isFolderApiSupported,
  getHandle = getSavedFolderHandle,
  readFile = readFileFromFolder
} = {}) {
  if (!supported()) return 0
  const handle = await getHandle()
  if (!handle || await handle.queryPermission({ mode: 'read' }) !== 'granted') return 0

  const books = (await library.listAll()).filter(book =>
    book.sourceType === 'local' && !book.driveFileId && !book.content && book.folderFileName
  )
  let restored = 0
  for (const book of books) {
    const file = await readFile(handle, book.folderFileName)
    if (!file || Number(file.size) !== Number(book.size)) continue
    const mimeType = file.type || book.mimeType || 'application/octet-stream'
    await library.patch(book.id, { content: new Blob([file], { type: mimeType }), mimeType,
      ...clearBookLength(), contentRevision:newContentRevision() })
    restored += 1
  }
  return restored
}
