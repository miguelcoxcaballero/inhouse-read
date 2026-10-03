import { describe, expect, it, vi } from 'vitest';
import { File as NativeFile } from 'node:buffer';
import { measureFileBookLength } from '../../src/js/file-book-length.js';
import { completeWordCount } from '../../src/js/book-length.js';
import { wordVolumeEPUB } from './fixtures/book-length-fixtures.mjs';
import { imageOnlyCBZ } from './fixtures/image-only-cbz.mjs';

describe('detached original-file measurement',()=>{
  it('parses a real EPUB and counts every chapter plus the non-linear final supplement',async()=>{
    const file=new NativeFile([wordVolumeEPUB()],'all-chapters.epub',{type:'application/epub+zip'});
    expect(await measureFileBookLength(file,{yieldTask:async()=>{}})).toEqual(completeWordCount(23));
  });
  it('a cancelled input never loads an engine or reads original bytes',async()=>{
    const file={size:8,arrayBuffer:vi.fn()};
    expect(await measureFileBookLength(file,{isActive:()=>false})).toBeNull();
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
  it('parses a real CBZ through Foliate and completes its image-only text count without loading pages',async()=>{
    const previous=Object.getOwnPropertyDescriptor(URL,'createObjectURL');
    const createURL=vi.fn(() => { throw new Error('Word count must not load comic images'); });
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:createURL});
    try {
      const file=new NativeFile([imageOnlyCBZ()],'two-image-pages.cbz',{type:'application/vnd.comicbook+zip'});
      expect(await measureFileBookLength(file,{yieldTask:async()=>{}})).toEqual(completeWordCount(0));
      expect(createURL).not.toHaveBeenCalled();
    } finally {
      if(previous) Object.defineProperty(URL,'createObjectURL',previous);
      else delete URL.createObjectURL;
    }
  });
  it('does not certify zero text for a CBZ whose parser found no supported image pages',async()=>{
    const file=new NativeFile([imageOnlyCBZ({images:false})],'invalid-comic.cbz',{type:'application/vnd.comicbook+zip'});
    await expect(measureFileBookLength(file,{yieldTask:async()=>{}})).rejects.toThrow('No supported image files');
  });
  it('retains the section bound after parsing an actual CBZ',async()=>{
    const file=new NativeFile([imageOnlyCBZ()],'two-image-pages.cbz',{type:'application/vnd.comicbook+zip'});
    expect(await measureFileBookLength(file,{maxSections:1,yieldTask:async()=>{}})).toBeNull();
  });
});
