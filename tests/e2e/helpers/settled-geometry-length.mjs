import { completeWordCount } from '../../../src/js/book-length.js';

/** Scene/lighting/motion fixtures define an already measured paper volume.
 * Their tiny real PDFs supply reader/cover content, not that synthetic volume.
 * Real PDF/EPUB extraction and pending migration are tested separately. */
export function settledGeometryLength(words, revision = 'settled-geometry-fixture') {
  return { ...completeWordCount(words), contentRevision:revision,
    wordCountContentRevision:revision };
}
