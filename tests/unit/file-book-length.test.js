import { describe, expect, it, vi } from 'vitest';
import { File as NativeFile } from 'node:buffer';
import { measureFileBookLength } from '../../src/js/file-book-length.js';
import { completeWordCount } from '../../src/js/book-length.js';
import { wordVolumeEPUB } from './fixtures/book-length-fixtures.mjs';

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
});
