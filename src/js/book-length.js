/** A printed-length estimate, independent of ZIP size, font and viewport. */
export const WORDS_PER_PRINT_PAGE = 300;
export const DEFAULT_PRINT_PAGES = 320;

const positive = value => typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) > 0
  ? Number(value) : null;

export function printedPageCount(book) {
  const pages = positive(book?.pageCount);
  if (pages != null) return Math.ceil(pages);
  const words = positive(book?.wordCount);
  if (words != null) return Math.ceil(words / WORDS_PER_PRINT_PAGE);
  return positive(book?.estimatedPageCount) ?? DEFAULT_PRINT_PAGES;
}

/** Read detached section documents one at a time, without loading images or
 * moving the reader. A cancelled/oversized/partly unreadable book returns null:
 * a partial count must never make a long book look like a pamphlet. */
export async function measureBookLength(book, { isActive = () => true,
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)),
  maxCharacters = 16_000_000, maxSections = 2048 } = {}) {
  const sections = book?.sections?.filter(section => section.linear !== 'no' && section.linear !== false);
  if (!sections?.length || sections.length > maxSections || !isActive()) return null;
  if (book.rendition?.layout === 'pre-paginated') return { pageCount:sections.length, lengthSource:'pages' };
  let wordCount = 0, characters = 0;
  const language = Array.isArray(book.metadata?.language) ? book.metadata.language[0] : book.metadata?.language;
  let segmenter;
  try { segmenter = new Intl.Segmenter(language || undefined, { granularity:'word' }); }
  catch { /* Unicode fallback on older WebViews or malformed language metadata. */ }
  try {
    for (const section of sections) {
      if (!isActive() || typeof section.createDocument !== 'function') return null;
      const doc = await section.createDocument();
      if (!isActive() || !doc?.documentElement) return null;
      const root = doc.body || doc.documentElement;
      const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT, also in detached XML documents.
      let nodes = 0;
      for (let node; (node = walker.nextNode());) {
        if (++nodes % 128 === 0) { await yieldTask(); if (!isActive()) return null; }
        if (node.parentElement?.closest('script,style,head,template,[hidden],[aria-hidden="true"]')) continue;
        const text = node.textContent || '';
        characters += text.length;
        if (characters > maxCharacters) return null;
        // Segment small slices so one unusually large text node cannot monopolise
        // the mobile main thread. Keep ordinary words whole at slice boundaries.
        for (let from = 0; from < text.length;) {
          let to = Math.min(text.length, from + 16_384);
          if (to < text.length) {
            const space = text.lastIndexOf(' ', to);
            if (space > from) to = space + 1;
          }
          const chunk = text.slice(from, to);
          if (segmenter) {
            for (const part of segmenter.segment(chunk)) if (part.isWordLike) wordCount++;
          } else wordCount += (chunk.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu) || []).length;
          from = to;
          if (from < text.length) { await yieldTask(); if (!isActive()) return null; }
        }
      }
      await yieldTask();
      if (!isActive()) return null;
    }
  } catch { return null; }
  return wordCount ? { wordCount, estimatedPageCount:Math.ceil(wordCount / WORDS_PER_PRINT_PAGE), lengthSource:'text' } : null;
}
