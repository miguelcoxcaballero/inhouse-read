import { describe, expect, it } from 'vitest';
import { canAdoptShelfMetadata } from '../../src/js/shelf-metadata-records.js';
import { sameBookRecords } from '../../src/js/library-store.js';
import { bookmarkFor } from '../../src/js/bookshelf-layout.js';
import { bookCloudState, isBookVisible } from '../../src/js/book-storage-policy.js';

const book = () => ({ id:'metadata:a', title:'Same physical book', author:'Reader', format:'PDF',
  sourceType:'drive', driveFileId:'drive-a', cloudAccountId:'account-a', content:new Blob(['pdf']),
  cover:new Blob(['cover']), wordCount:78000, progressFraction:.37, locator:{ page:4 }, lastOpenedAt:11,
  progressUpdatedAt:11, progressDirty:true, lengthDirty:true, progressStateFileId:'state-a',
  readingHistory:[], bookmarks:[], quotes:[] });

describe('explicit nonvisual shelf record changes', () => {
  it('permits only declared sync/history changes and leaves the whole-record predicate unchanged', () => {
    const previous = book();
    const changes = { progressUpdatedAt:12, progressDirty:false, progressStateFileId:'state-b', lengthDirty:false,
      readingHistory:[{ locator:{ page:4 }, fraction:.37 }], bookmarks:[{ locator:{ page:4 } }],
      quotes:[{ text:'A saved passage', locator:{ page:4 } }], locator:{ page:5 } };
    for (const [field, value] of Object.entries(changes)) {
      const next = { ...previous, [field]:value };
      expect(sameBookRecords([previous], [next]), field).toBe(false);
      expect(canAdoptShelfMetadata([previous], [next]), field).toBe(true);
      expect(bookmarkFor(next), field).toEqual(bookmarkFor(previous));
      expect(bookCloudState(next, { connected:true }), field).toEqual(bookCloudState(previous, { connected:true }));
      expect(isBookVisible(next, 'account-a'), field).toBe(isBookVisible(previous, 'account-a'));
      expect(previous[field], field).not.toBe(value);
    }
  });
  it('requires the complete bookmark result to stay exactly equal, including its presence', () => {
    const previous = book();
    expect(canAdoptShelfMetadata([previous], [{ ...previous, locator:{ page:90 } }])).toBe(true);
    expect(canAdoptShelfMetadata([previous], [{ ...previous, progressFraction:.370001, progressDirty:false }])).toBe(false);
    const unopened = { ...previous, progressFraction:0, locator:null };
    expect(bookmarkFor(unopened)).toBeNull();
    expect(canAdoptShelfMetadata([unopened], [{ ...unopened, locator:{ page:1 } }])).toBe(false);
  });
  it('rejects every visual, content, availability, geometry, order and unknown field change', () => {
    const previous = book();
    const changes = { title:'New title', author:'New author', format:'EPUB', cover:new Blob(['new cover']),
      coverUpdatedAt:50, coverAppearance:{ color:'#337744' }, coverAppearanceKey:'new-key',
      content:new Blob(['new pdf']), contentRevision:'new-revision', driveFileId:'other-drive',
      cloudAccountId:'other-account', sourceType:'local', lastOpenedAt:12, progressFraction:.8,
      wordCount:80000, wordCountStatus:'pending', pageCount:100, size:500, coverRatio:.8,
      spineFinish:'gold', shelfOrder:2, shelfPosition:{ shelf:1, x:.3 }, futureUnknownField:true };
    for (const [field, value] of Object.entries(changes)) {
      expect(canAdoptShelfMetadata([previous], [{ ...previous, progressDirty:false, [field]:value }]), field).toBe(false);
    }
    const other = { ...previous, id:'metadata:b' };
    expect(canAdoptShelfMetadata([previous, other], [{ ...other, progressDirty:false }, previous])).toBe(false);
  });
  it('keeps identical, empty, malformed, duplicate and stale membership lists on the original path', () => {
    const previous = book(), next = { ...previous, progressDirty:false };
    expect(canAdoptShelfMetadata([previous], [{ ...previous }])).toBe(false);
    for (const [before, after] of [[[], []], [[previous], []], [[previous], null],
      [[previous, previous], [next, next]], [[previous], [{ ...next, id:undefined }]],
      [[previous], [Object.assign(Object.create({}), next)]], [[previous], [{ ...next, id:'new-id' }]]]) {
      expect(canAdoptShelfMetadata(before, after)).toBe(false);
    }
  });
  it('requires exact Blob identity or the production committed-byte stamp instead of size-only equality', () => {
    const previous = book();
    const fresh = { ...previous, progressDirty:false, content:new Blob(['pdf']), cover:new Blob(['cover']) };
    expect(sameBookRecords([previous], [{ ...fresh, progressDirty:true }])).toBe(true);
    expect(canAdoptShelfMetadata([previous], [fresh])).toBe(false);
    const committed = { ...previous, contentRevision:'committed-original-pdf', coverUpdatedAt:123 };
    const reread = { ...committed, progressDirty:false, content:new Blob(['pdf']), cover:new Blob(['cover']) };
    expect(canAdoptShelfMetadata([committed], [reread])).toBe(true);
    for (const changes of [{ contentRevision:'new-content' }, { contentRevision:'' }, { coverUpdatedAt:124 },
      { coverUpdatedAt:0 }, { coverUpdatedAt:undefined }]) {
      expect(canAdoptShelfMetadata([committed], [{ ...reread, ...changes }])).toBe(false);
    }
    const unknown = { ...committed, futureAsset:{ bytes:new Blob(['asset']) } };
    expect(canAdoptShelfMetadata([unknown], [{ ...unknown, progressDirty:false, futureAsset:{ bytes:new Blob(['asset']) } }])).toBe(false);
    const exact = { ...previous, progressDirty:false };
    expect(canAdoptShelfMetadata([previous], [exact])).toBe(true);
  });
});
