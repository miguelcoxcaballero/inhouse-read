/** One shared word-count convention for physical book volume. Neither the
 * publisher's page breaks nor compression/image bytes determine thickness. */
export const WORDS_PER_PRINT_PAGE = 300;
export const DEFAULT_PRINT_PAGES = 320;
export const WORD_COUNT_VERSION = 2;

const validCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const hasCompleteWordCount = book => validCount(book?.wordCount)
  && book.wordCountVersion === WORD_COUNT_VERSION && book.wordCountComplete === true;

export function completeWordCount(wordCount) {
  if (!validCount(wordCount)) return null;
  return { wordCount, wordCountVersion:WORD_COUNT_VERSION, wordCountComplete:true,
    estimatedPageCount:Math.ceil(wordCount / WORDS_PER_PRINT_PAGE), lengthSource:'text' };
}

/** This is an equivalent paper volume, not the document's page counter. */
export function printedPageCount(book) {
  const words = typeof book?.wordCount === 'number' && Number.isFinite(book.wordCount) && book.wordCount >= 0
    ? book.wordCount : null;
  return words == null ? DEFAULT_PRINT_PAGES : words / WORDS_PER_PRINT_PAGE;
}

const excluded = new Set(['script','style','head','template']);
const blocks = new Set(['address','article','aside','blockquote','dd','div','dl','dt','figcaption','figure',
  'footer','form','h1','h2','h3','h4','h5','h6','header','hr','li','main','nav','ol','p','pre','section',
  'table','tbody','td','tfoot','th','thead','tr','ul']);
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

/** Inline fragments stay together (hel<strong>lo</strong> is one word).
 * Yield between bounded slices and carry the final token into the next slice. */
export function createWordCounter(language, { isActive = () => true, yieldTask = pause,
  maxCharacters = 16_000_000 } = {}) {
  let segmenter, count = 0, characters = 0, buffer = '', cancelled = false, continuingToken = null;
  try { segmenter = new Intl.Segmenter(language || undefined, { granularity:'word' }); }
  catch { /* Unicode fallback on older WebViews or malformed publisher metadata. */ }
  const countSlice = text => {
    if (segmenter) {
      for (const part of segmenter.segment(text)) if (part.isWordLike) count++;
    } else count += (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu) || []).length;
  };
  const partsFor = text => segmenter ? segmenter.segment(text)
    : [...text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu)]
      .map(match => ({index:match.index,segment:match[0],isWordLike:true}));
  const dictionaryScripts = ['Han','Hiragana','Katakana','Thai','Lao','Khmer','Myanmar','Hangul'];
  const scriptPatterns = dictionaryScripts.map(script => new RegExp(`\\p{Script=${script}}`, 'u'));
  function continuationFor(text) {
    const first = [...text][0] || '';
    const index = scriptPatterns.findIndex(pattern => pattern.test(first));
    if (index >= 0) return new RegExp(`^[\\p{Script=${dictionaryScripts[index]}}\\p{M}]+`, 'u');
    const dictionary = dictionaryScripts.map(script => `\\p{Script=${script}}`).join('');
    return new RegExp(`^(?:(?![${dictionary}])[\\p{L}\\p{N}\\p{M}_'’])+`, 'u');
  }
  function flushBounded() {
    const prefix = buffer.slice(0,16_384);
    let boundary = -1;
    for (let index = prefix.length - 1; index >= 0; index--) {
      if (/\s/u.test(prefix[index])) { boundary = index + 1; break; }
    }
    if (boundary > 0) { countSlice(buffer.slice(0,boundary)); buffer = buffer.slice(boundary); return; }
    // CJK/Thai paragraphs need no spaces. Segment a bounded window and retain
    // its final context plus every token crossing that context boundary.
    let to = 0, words = 0, finalPart;
    for (const part of partsFor(prefix)) {
      finalPart = part;
      if (part.index + part.segment.length > prefix.length - 512) break;
      to = part.index + part.segment.length;
      if (part.isWordLike) words++;
    }
    if (to) { count += words; buffer = buffer.slice(to); return; }
    if (!finalPart || finalPart.index === 0 && finalPart.segment.length === prefix.length && !finalPart.isWordLike) {
      buffer = buffer.slice(prefix.length); return;
    }
    // An artificial, tens-of-thousands-character single word must not grow
    // into a multi-megabyte buffer either. Count its first segment once and
    // consume the rest of the same script/token until punctuation/whitespace.
    if (buffer.length >= 32_768 && finalPart?.isWordLike && finalPart.index === 0
      && finalPart.segment.length === prefix.length) {
      count++; continuingToken = continuationFor(prefix); buffer = buffer.slice(prefix.length);
      const consumed = buffer.match(continuingToken)?.[0]?.length || 0;
      buffer = buffer.slice(consumed);
      if (buffer.length) continuingToken = null;
    }
  }
  return {
    async add(text) {
      text = String(text || '');
      characters += text.length;
      if (!isActive() || characters > maxCharacters || cancelled) { cancelled = true; return false; }
      for (let from = 0; from < text.length; from += 16_384) {
        let chunk = text.slice(from, from + 16_384);
        if (continuingToken) {
          const consumed = chunk.match(continuingToken)?.[0]?.length || 0;
          chunk = chunk.slice(consumed);
          if (chunk.length) continuingToken = null;
        }
        buffer += chunk;
        if (buffer.length >= 16_384) {
          flushBounded();
          await yieldTask();
          if (!isActive()) { cancelled = true; return false; }
        } else if (continuingToken) {
          await yieldTask();
          if (!isActive()) { cancelled = true; return false; }
        }
      }
      return true;
    },
    finish() { if (cancelled || !isActive()) return null; countSlice(buffer); buffer = ''; return count; }
  };
}

export async function countTextWords(text, options = {}) {
  const counter = createWordCounter(options.language, options);
  return await counter.add(text) ? counter.finish() : null;
}

function blockFor(node, root) {
  for (let element = node.parentElement; element && element !== root; element = element.parentElement) {
    if (blocks.has(element.localName?.toLowerCase())) return element;
  }
  return root;
}

// Foliate's comic parser has validated the archive and exposes image entries
// without a detached document extractor. Recognize only that fixed-layout
// shape; an unknown/broken document must never become a completed zero count.
const imageSection = section => section?.createDocument === undefined
  && typeof section.id === 'string' && !section.id.includes('\0')
  && /\.(?:jpe?g|png|gif|bmp|webp|svg|jxl|avif)$/i.test(section.id)
  && typeof section.load === 'function' && typeof section.unload === 'function'
  && Number.isSafeInteger(section.size) && section.size > 0;

/** All detached spine sections, including fixed-layout EPUB text. No images,
 * pagination or active-reader navigation. Zero means textless; null means an
 * incomplete/unreadable/cancelled source. Never publish a partial count. */
export async function measureBookLength(book, { isActive = () => true, yieldTask = pause,
  maxCharacters = 16_000_000, maxSections = 2048 } = {}) {
  const sections = book?.sections;
  if (!sections?.length || sections.length > maxSections || !isActive()) return null;
  const language = Array.isArray(book.metadata?.language) ? book.metadata.language[0] : book.metadata?.language;
  const counter = createWordCounter(language, { isActive, yieldTask, maxCharacters });
  try {
    if (book.rendition?.layout === 'pre-paginated') {
      let imageOnly = true;
      for (let index=0; index<sections.length; index++) {
        if (!isActive()) return null;
        if (!imageSection(sections[index])) { imageOnly = false; break; }
        if ((index + 1) % 128 === 0 || index === sections.length - 1) {
          await yieldTask();
          if (!isActive()) return null;
        }
      }
      // No OCR, image decompression or fictional printed pages. The same
      // complete text-count contract also represents textless PDF/EPUB pages.
      if (imageOnly) return completeWordCount(0);
    }
    for (const section of sections) {
      if (!isActive() || typeof section.createDocument !== 'function') return null;
      const doc = await section.createDocument();
      if (!isActive() || !doc?.documentElement) return null;
      const root = doc.body || doc.querySelector('body') || doc.documentElement;
      const walker = doc.createTreeWalker(root, 5, { acceptNode(node) {
        if (node.nodeType !== 1) return 1;
        return excluded.has(node.localName?.toLowerCase()) || node.hasAttribute('hidden')
          || node.getAttribute('aria-hidden') === 'true' ? 2 : 1;
      } });
      let nodes = 0, lastBlock = root;
      for (let node; (node = walker.nextNode());) {
        if (++nodes % 128 === 0) { await yieldTask(); if (!isActive()) return null; }
        if (node.nodeType === 1) {
          if ((node.localName?.toLowerCase() === 'br' || blocks.has(node.localName?.toLowerCase()))
            && !await counter.add(' ')) return null;
          continue;
        }
        const block = blockFor(node, root);
        if (block !== lastBlock && !await counter.add(' ')) return null;
        lastBlock = block;
        if (!await counter.add(node.textContent || '')) return null;
      }
      if (!await counter.add(' ')) return null;
      await yieldTask();
      if (!isActive()) return null;
    }
  } catch { return null; }
  return completeWordCount(counter.finish());
}
