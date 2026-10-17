const BOOK_EXTENSION = /\.(?:pdf|epub|mobi|azw|azw3|fb2|cbz)$/i
const ACRONYMS = new Set(['AI', 'API', 'CBZ', 'DNA', 'EPUB', 'FBI', 'HTML', 'MOBI', 'NASA', 'PDF', 'UK', 'UN', 'USA', 'USB', 'US'])
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'on', 'onto', 'or', 'over', 'per', 'the', 'to', 'up', 'via',
  'with', 'yet', 'that', 'this', 'these', 'those', 'which', 'who', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos',
  'unas', 'y', 'e', 'o', 'u', 'en', 'por', 'para', 'con', 'sin', 'sobre',
  'entre', 'al', 'lo'
])

/** Read author metadata without ever coercing a metadata object to "[object Object]". */
export function normalizeBookAuthor(value) {
  if (Array.isArray(value)) {
    const names = value.map(normalizeBookAuthor).filter(Boolean)
    return [...new Set(names)].join(', ').slice(0, 120)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const name = String(value).normalize('NFKC').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
    return /^\[object\s+object\]$/i.test(name) ? '' : name.slice(0, 120)
  }
  if (!value || typeof value !== 'object') return ''
  for (const key of ['name', 'displayName', 'value', 'text', 'creator', 'author']) {
    const name = normalizeBookAuthor(value[key])
    if (name) return name
  }
  const first = normalizeBookAuthor(value.givenName ?? value.firstName)
  const last = normalizeBookAuthor(value.familyName ?? value.lastName)
  return [first, last].filter(Boolean).join(' ').slice(0, 120)
}

/** Produce a readable, consistent title from ebook metadata or its filename. */
export function normalizeBookTitle(value, fallback = '') {
  let title = String(value ?? '').trim() || String(fallback ?? '').trim()
  if (!title) return 'Sin título'

  title = title.normalize('NFKC').replace(BOOK_EXTENSION, '')
    .replace(/[\\/\u0000-\u001f]/g, ' ')
    .replace(/[_\s]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;])(?=\S)/g, '$1 ')
    .trim()

  let wasTruncated = false
  const truncation = title.match(/(?:\.{2,}|…+)\s*$/)
  if (truncation) {
    wasTruncated = true
    title = title.slice(0, truncation.index).trim()
    const words = title.split(/\s+/)
    const last = words.at(-1) ?? ''
    // Filenames often end with a partial word before the ellipsis (e.g. Ke...).
    if (last.length <= 3 && words.length > 1) words.pop()
    while (words.length > 1 && SMALL_WORDS.has(words.at(-1).toLowerCase())) words.pop()
    title = words.join(' ')
  }

  title = title.replace(/\s+/g, ' ').trim()
  if (!title) return 'Sin título'

  // For unusually long subtitles, retain the main title before the colon.
  if (title.length > 88) {
    const colon = title.indexOf(':')
    if (colon >= 12 && colon <= 62) title = title.slice(0, colon).trim()
  }

  title = toTitleCase(title)
  if (title.length > 88) {
    const cutoff = title.lastIndexOf(' ', 85)
    title = `${title.slice(0, cutoff > 0 ? cutoff : 85).trimEnd()}…`
  } else if (wasTruncated) {
    title += '…'
  }
  return title
}

function toTitleCase(value) {
  let wordIndex = 0
  let capitalizeNext = true
  return value.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part
    const chars = [...part.matchAll(/[\p{L}\p{N}]/gu)]
    if (!chars.length) return part
    const first = chars[0].index
    const last = chars.at(-1)
    const end = last.index + last[0].length
    const leading = part.slice(0, first)
    const core = part.slice(first, end)
    const trailing = part.slice(end)
    const lower = core.toLowerCase()
    const keepLower = wordIndex > 0 && !capitalizeNext && SMALL_WORDS.has(lower) && core[0] === core[0]?.toLowerCase()
    const isAcronym = ACRONYMS.has(core.toUpperCase()) && core === core.toUpperCase()
    const formatted = isAcronym ? core : keepLower ? lower : capitalizeWord(core)
    wordIndex++
    capitalizeNext = /[:.!?]$/.test(trailing)
    return `${leading}${formatted}${trailing}`
  }).join('')
}

function capitalizeWord(word) {
  if (!word) return word
  // Preserve intentional internal capitals such as iPhone and eBook.
  if (/[a-z].*[A-Z]/.test(word)) return word
  return word[0].toUpperCase() + word.slice(1).toLowerCase()
}

/** The title the whole interface shows: the one written on the spine when
 * the reader edited it, otherwise the book's own. */
export function displayBookTitle(book) {
  const written = typeof book?.spineTitleOverride === 'string' ? book.spineTitleOverride.replace(/\s+/g, ' ').trim() : ''
  return written || String(book?.title ?? '')
}
