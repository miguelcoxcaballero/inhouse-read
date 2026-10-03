import { newContentRevision, clearBookLength } from './book-length-queue.js'

/** Downloaded books belong to this device even when Google is disconnected. */
export function isBookVisible(book, accountId) {
  return Boolean(book && (book.content || book.sourceType !== 'drive' ||
    (accountId && (!book.cloudAccountId || book.cloudAccountId === accountId))))
}

/** A Drive identity means that a cloud copy already exists; login never creates one. */
export function bookCloudState(book, { connected = false } = {}) {
  return { connected:Boolean(connected), saved:Boolean(book?.driveFileId) }
}

/** Resolve only after the original bytes have committed to IndexedDB. */
export async function storeBookFile(library, file, fields, { restoreRemoved = false, reuseStoredContent = false } = {}) {
  try {
    // Blob parts share bytes without converting them to text/base64. Equal
    // name and size do not prove that a reimport contains the previous book.
    const content = new Blob([file], { type:file.type })
    const preserveLength = reuseStoredContent && typeof fields.contentRevision === 'string' && fields.contentRevision
    return await library.addOrTouch({ ...fields, content,
      ...(preserveLength ? {} : clearBookLength()),
      // A new import may differ even when its name/size matches the Drive
      // original. Only an actual cached reopen retains that byte identity.
      ...(preserveLength ? {} : { contentDriveChecksum:null }),
      contentRevision:preserveLength ? fields.contentRevision : newContentRevision()
    }, { restoreRemoved })
  } catch (cause) {
    const error = new Error('No se pudo guardar el libro en este dispositivo. Libera espacio y vuelve a importarlo.', { cause })
    error.code = 'LOCAL_BOOK_STORAGE_FAILED'
    throw error
  }
}
