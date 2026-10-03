// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { measurePDFBookLength } from '../../src/js/pdf-book-length.js';
import { completeWordCount } from '../../src/js/book-length.js';
import { spineStyleFor } from '../../src/js/bookshelf-layout.js';
import { bookSpineOptions } from '../../src/js/plant-dimensions.js';
import { wordVolumePDF } from './fixtures/book-length-fixtures.mjs';

async function actualBook(words, pages) {
  const task=getDocument({data:new Uint8Array(wordVolumePDF({words,pages})),useSystemFonts:true});
  try {
    const pdf=await task.promise;
    const length=await measurePDFBookLength(pdf,{yieldTask:async()=>{}});
    return {...length,pageCount:pdf.numPages};
  } finally { await task.destroy(); }
}

describe('all-page PDF word volume with the actual PDF.js parser',()=>{
  it('two PDFs with the same pages and different word totals have different physical thickness',async()=>{
    const short=await actualBook(30_000,3),long=await actualBook(120_000,3);
    expect(short).toEqual({...completeWordCount(30_000),pageCount:3});
    expect(long).toEqual({...completeWordCount(120_000),pageCount:3});
    expect(spineStyleFor(short,bookSpineOptions(600)).width).toBe(11);
    expect(spineStyleFor(long,bookSpineOptions(600)).width).toBe(32);
  },20_000);
  it('the same words spread across different PDF page counts produce exactly the same physical thickness',async()=>{
    const a=await actualBook(90_000,3),b=await actualBook(90_000,12);
    expect(a.wordCount).toBe(90_000);expect(b.wordCount).toBe(90_000);
    expect(a.pageCount).not.toBe(b.pageCount);
    expect(spineStyleFor(a,bookSpineOptions(390)).width).toBe(spineStyleFor(b,bookSpineOptions(390)).width);
  },20_000);
  it('an unreadable final page never publishes the preceding pages as a complete count',async()=>{
    const pdf={numPages:2,getPage:vi.fn().mockResolvedValueOnce({getTextContent:async()=>({items:[{str:'one two three'}]}),getViewport:()=>({transform:[1,0,0,-1,0,800]})})
      .mockRejectedValueOnce(Error('damaged page'))};
    expect(await measurePDFBookLength(pdf,{yieldTask:async()=>{}})).toBeNull();
    expect(pdf.getPage).toHaveBeenCalledTimes(2);
  });
  it('cancels after page extraction without reading another page',async()=>{
    let active=true;
    const pdf={numPages:3,getPage:vi.fn(async()=>({getTextContent:async()=>{active=false;return{items:[]};}}))};
    expect(await measurePDFBookLength(pdf,{isActive:()=>active})).toBeNull();
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
  });
});
