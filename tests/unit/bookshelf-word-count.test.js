import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const models=vi.hoisted(()=>({bookView:vi.fn(()=>null)}));
vi.mock('../../src/js/book-model.js',()=>({getBookRenderer:()=>null,bookView:models.bookView,fitCoverImage:vi.fn(),planReadingBookPose:vi.fn()}));
vi.mock('../../src/js/bookshelf-scene.js',()=>({createBookshelfScene:()=>null}));
vi.mock('../../src/js/cover-appearance.js',async original=>({...await original(),readCoverAspectRatio:vi.fn(async()=>null)}));
import { renderBookshelf } from '../../src/js/bookshelf.js';
import { isBookLengthReady } from '../../src/js/book-length-queue.js';
import { completeWordCount } from '../../src/js/book-length.js';

let container,shelf;
beforeEach(()=>{localStorage.clear();models.bookView.mockClear();container=document.createElement('main');document.body.append(container);});
afterEach(()=>{shelf?.destroy();shelf=null;container.remove();document.body.innerHTML='';});
const base=id=>({id,title:id,sourceType:'local',format:'EPUB',content:new Blob(['book']),contentRevision:id});
const counted=(id,words)=>({...base(id),...completeWordCount(words),wordCountContentRevision:id});
const options=()=>({shelfWidth:600,sections:false,minimumShelves:3,
  getBookGeometryState:book=>isBookLengthReady(book)?'ready':'pending'});

describe('word-count geometry is ready before its first painted book',()=>{
  it('keeps measured books visible and never creates a 3D model from unknown/legacy page estimates',()=>{
    const known=counted('ready',120000),unknown={...base('pending'),pageCount:1000,wordCount:90000};
    shelf=renderBookshelf(container,[known,unknown],options());
    expect([...container.querySelectorAll('.ihr-spine')].map(node=>node.dataset.bookId)).toEqual(['ready']);
    expect(models.bookView).toHaveBeenCalledTimes(1);
    expect(models.bookView.mock.calls[0][3].thickness).toBe(32);
    expect(container.querySelector('.ihr-library-loading--books').textContent).toContain('Preparando pending');
    expect(container.textContent).not.toContain('Tu estantería está vacía');
    const final=counted('pending',90000);shelf.update([known,final]);
    const thickness=models.bookView.mock.calls.filter(call=>call[1].id==='pending').map(call=>call[3].thickness);
    expect(thickness).toEqual([25]);
  });
  it('uses the same saved final physical geometry on the first frame of a cold render',()=>{
    const book=counted('stable',270000);shelf=renderBookshelf(container,[book],options());
    const first=models.bookView.mock.calls.at(-1)[3].thickness;
    expect(first).toBe(67);shelf.destroy();models.bookView.mockClear();
    shelf=renderBookshelf(container,[structuredClone({...book,content:null})],options());
    expect(models.bookView.mock.calls[0][3].thickness).toBe(first);
    expect(container.querySelector('.ihr-library-loading--books')).toBeNull();
  });
  it('keeps incomplete books openable and retryable without drawing a guessed shape',()=>{
    const book=base('broken'),open=vi.fn(),retry=vi.fn();
    shelf=renderBookshelf(container,[book],{...options(),onBookOpen:open});
    container.querySelector('.ihr-library-loading__book button').click();expect(open).toHaveBeenCalledWith(book);
    expect(models.bookView).not.toHaveBeenCalled();shelf.destroy();
    shelf=renderBookshelf(container,[book],{...options(),getBookGeometryState:()=> 'failed',onBookGeometryRetry:retry});
    container.querySelector('.ihr-library-loading__book button').click();expect(retry).toHaveBeenCalledWith(book);
    expect(models.bookView).not.toHaveBeenCalled();
  });
});
