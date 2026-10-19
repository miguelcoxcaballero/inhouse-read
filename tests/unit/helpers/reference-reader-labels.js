// Frozen from 0a4d84ea (1.7.309): the reader's place label, file size, panel description and shared
// file name before they moved to rust-ui reader_labels.rs.
import { displayBookTitle, normalizeBookAuthor } from '../../../src/js/book-title.js'

export function label(place, reader) { return place.locator?.kind === 'pdf-page' ? `Página ${place.locator.value}${reader.pageCount ? ` de ${reader.pageCount}` : ''}` : place.section ? `${place.section}${place.page ? ` · Página ${place.page}` : ''}` : `${Math.round(place.fraction * 100)} % del libro` }
export function formatSize(bytes = 0) { return bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB` }
export const describe = record => { const title = displayBookTitle(record), author = normalizeBookAuthor(record.author) || normalizeBookAuthor(record.metadata?.creator); return [title, author, `${title}${author ? ` · ${author}` : ''}\n${record.format || 'Documento'} · ${formatSize(record.sizeBytes)}`] }
export const shareFile = (book, content) => [book.fileName || `${book.title}.${String(book.format||'pdf').toLowerCase()}`, book.mimeType || content.type || 'application/octet-stream']
