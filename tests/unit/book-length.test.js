import { describe, expect, it, vi } from 'vitest';
import { completeWordCount, countTextWords, measureBookLength, printedPageCount } from '../../src/js/book-length.js';

const documentFor = html => new DOMParser().parseFromString(html, 'text/html');
const section = html => ({ createDocument:vi.fn(async () => documentFor(html)) });
const measure = (book, options = {}) => measureBookLength(book, { yieldTask:async () => {}, ...options });
const imageSection = (id = 'page.png') => ({ id, size:64, load:vi.fn(), unload:vi.fn() });

describe('printed book length', () => {
  it('uses words only, independent of page breaks or an old page estimate', () => {
    expect(printedPageCount({ pageCount:540, wordCount:30_000 })).toBe(100);
    expect(printedPageCount({ wordCount:120_001, estimatedPageCount:20 })).toBeCloseTo(120_001/300,10);
    expect(printedPageCount({ estimatedPageCount:820 })).toBe(320);
  });

  it('never uses compression, image bytes or the book ID as a paper count', () => {
    for (const sizeBytes of [1, 20_000, 100_000_000]) expect(printedPageCount({ sizeBytes })).toBe(320);
    for (const pageCount of [NaN, Infinity, -30, true, '']) expect(printedPageCount({ pageCount })).toBe(320);
  });

  it('counts the full spine including non-linear supplements, excludes hidden/program text, and does not paginate', async () => {
    const a = section('<p>Uno dos tres.</p><script>ignore all these words</script><style>also ignore</style><p hidden>not text</p>');
    const b = section('<p>Cuatro cinco seis.</p><nav aria-hidden="true">ignore here</nav>');
    const excluded = { ...section('<p>Supplementary final notes.</p>'), linear:'no' };
    const book = { sections:[a, excluded, b], metadata:{ language:'es' } };
    expect(await measure(book)).toEqual(completeWordCount(9));
    expect(a.createDocument).toHaveBeenCalledOnce(); expect(b.createDocument).toHaveBeenCalledOnce();
    expect(excluded.createDocument).toHaveBeenCalledOnce();
  });

  it('counts long text in yielding slices instead of treating a small EPUB as a short book', async () => {
    const yieldTask = vi.fn(async () => {});
    const book = { sections:[section(`<p>${'palabra '.repeat(120_000)}</p>`)] };
    expect(await measure(book, { yieldTask })).toEqual(completeWordCount(120_000));
    expect(yieldTask.mock.calls.length).toBeGreaterThan(20);
  });

  it('yields between many small paragraphs too', async () => {
    const yieldTask = vi.fn(async () => {});
    expect((await measure({ sections:[section('<p>word</p>'.repeat(1000))] }, { yieldTask })).wordCount).toBe(1000);
    expect(yieldTask.mock.calls.length).toBeGreaterThan(7);
  });

  it('counts Chinese text as words with Segmenter rather than a single no-space token', async () => {
    const result = await measure({ sections:[section('<p>这是一本关于阅读和故事的书。</p>')], metadata:{ language:'zh' } });
    expect(result.wordCount).toBeGreaterThan(4);
  });

  it('uses a Unicode fallback when a publisher supplies an invalid language', async () => {
    expect((await measure({ sections:[section('<p>Uno dos tres.</p>')], metadata:{ language:'not_a_language' } })).wordCount).toBe(3);
  });

  it('counts fixed-layout text without decompressing images or using the number of pages', async () => {
    const pages = Array.from({ length:72 }, () => section('<img src="page.jpg">'));
    pages[71] = section('<p>Text on the last page.</p><img src="never-loaded.jpg">');
    expect(await measure({ sections:pages, rendition:{ layout:'pre-paginated' } })).toEqual(completeWordCount(5));
    expect(pages.every(page => page.createDocument.mock.calls.length === 1)).toBe(true);
  });

  it('completes a recognized image-only comic with zero text without loading any image', async () => {
    const pages = ['one.png','nested/two.jpg','three.jpeg','four.gif','five.bmp','six.webp','seven.svg','eight.jxl','nine.avif'].map(imageSection);
    expect(await measure({ sections:pages, rendition:{ layout:'pre-paginated' } })).toEqual(completeWordCount(0));
    for (const page of pages) { expect(page.load).not.toHaveBeenCalled(); expect(page.unload).not.toHaveBeenCalled(); }
  });

  it.each([
    ['missing fixed-layout recognition', { sections:[imageSection()] }],
    ['unrecognized source ID', { sections:[imageSection('chapter.xhtml')], rendition:{ layout:'pre-paginated' } }],
    ['missing loader', { sections:[{ ...imageSection(), load:undefined }], rendition:{ layout:'pre-paginated' } }],
    ['missing unload lifecycle', { sections:[{ ...imageSection(), unload:undefined }], rendition:{ layout:'pre-paginated' } }],
    ['empty image entry', { sections:[{ ...imageSection(), size:0 }], rendition:{ layout:'pre-paginated' } }],
    ['non-finite image entry', { sections:[{ ...imageSection(), size:Infinity }], rendition:{ layout:'pre-paginated' } }],
    ['broken document extractor', { sections:[{ ...imageSection(), createDocument:null }], rendition:{ layout:'pre-paginated' } }],
    ['mixed text/image source', { sections:[imageSection(), section('<p>Actual text</p>')], rendition:{ layout:'pre-paginated' } }]
  ])('does not infer zero words for %s', async (_, book) => {
    expect(await measure(book)).toBeNull();
  });

  it('keeps comic validation bounded and cancels between slices without image loading', async () => {
    let active = true;
    const pages = Array.from({ length:256 }, (_, index) => imageSection(`${index}.png`));
    const book = { sections:pages, rendition:{ layout:'pre-paginated' } };
    expect(await measure(book, { maxSections:255 })).toBeNull();
    const yieldTask = vi.fn(async () => { active = false; });
    expect(await measure(book, { isActive:() => active, yieldTask })).toBeNull();
    expect(yieldTask).toHaveBeenCalledOnce();
    expect(pages.every(page => page.load.mock.calls.length === 0)).toBe(true);
  });

  it('finishes zero only after the final active check for an image-only comic', async () => {
    let active = true;
    const pages = [imageSection()];
    const yieldTask = vi.fn(async () => { active = false; });
    expect(await measure({ sections:pages, rendition:{ layout:'pre-paginated' } }, { yieldTask, isActive:() => active })).toBeNull();
    expect(yieldTask).toHaveBeenCalledOnce(); expect(pages[0].load).not.toHaveBeenCalled();
  });

  it('rejects partial results for an unreadable or over-budget book', async () => {
    const good = section('<p>One two three</p>');
    expect(await measure({ sections:[good, {createDocument:async () => { throw Error('damaged'); }}] })).toBeNull();
    expect(await measure({ sections:[good, good] }, {maxSections:1})).toBeNull();
    expect(await measure({ sections:[good] }, {maxCharacters:4})).toBeNull();
    expect(await measure({ sections:[good, {}] })).toBeNull();
  });

  it('cancels after section extraction and does not load the next chapter', async () => {
    let active = true;
    const next = section('must not load');
    const first = { createDocument:async () => { active = false; return documentFor('words'); } };
    expect(await measure({ sections:[first, next] }, {isActive:() => active})).toBeNull();
    expect(next.createDocument).not.toHaveBeenCalled();
  });

  it('returns null for an empty or unavailable text source', async () => {
    expect(await measure(null)).toBeNull();
    expect(await measure({ sections:[] })).toBeNull();
    expect(await measure({ sections:[section('<p></p>')] })).toEqual(completeWordCount(0));
  });

  it('keeps one word intact across inline nodes and introduces block/BR boundaries', async () => {
    expect(await measure({ sections:[section('<p>hel<strong>lo</strong> <span>wor</span>ld<br>third</p><div>fourth</div>fifth')] }))
      .toEqual(completeWordCount(5));
  });

  it('keeps the final token intact across yielded slices', async () => {
    const text = `${'a '.repeat(8191)}antidisestablishmentarianism tail`;
    expect(await countTextWords(text, {yieldTask:async () => {}})).toBe(8193);
  });
  it.each([['zh','这是一本关于阅读和故事的书。'],['ja','読書と物語についての本です。'],['th','หนังสือเกี่ยวกับการอ่านและเรื่องราว']])
    ('segments long %s prose without whitespace in bounded yielding windows', async (language, sentence) => {
      const text=sentence.repeat(2500),yieldTask=vi.fn(async()=>{});
      const expected=[...new Intl.Segmenter(language,{granularity:'word'}).segment(text)].filter(part=>part.isWordLike).length;
      expect(await countTextWords(text,{language,yieldTask})).toBe(expected);
      expect(yieldTask.mock.calls.length).toBeGreaterThan(1);
    });
  it('keeps a pathological single word bounded and does not double count its continuation',async()=>{
    const yieldTask=vi.fn(async()=>{});
    expect(await countTextWords('a'.repeat(100_000)+' tail',{yieldTask})).toBe(2);
    expect(yieldTask.mock.calls.length).toBeGreaterThan(4);
  });
});
