import { createWordCounter, completeWordCount } from './book-length.js';
import { extractPDFText } from './readers/pdf-text.js';

/** All pages' text only: no canvas, image decoding, navigation or speech
 * filtering. Callers may share an active document; this never cleans its pages. */
export async function measurePDFBookLength(pdf, { isActive = () => true,
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)),
  maxCharacters = 16_000_000, maxPages = 10_000, language } = {}) {
  if (!Number.isSafeInteger(pdf?.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages || !isActive()) return null;
  const counter = createWordCounter(language, { isActive, yieldTask, maxCharacters });
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      if (!isActive()) return null;
      const page = await pdf.getPage(number);
      if (!isActive()) return null;
      const content = await page.getTextContent();
      if (!isActive()) return null;
      const text = extractPDFText(content, page.getViewport({ scale:1 })).text;
      if (!await counter.add(text) || !await counter.add(' ')) return null;
      await yieldTask();
      if (!isActive()) return null;
    }
  } catch { return null; }
  return completeWordCount(counter.finish());
}
