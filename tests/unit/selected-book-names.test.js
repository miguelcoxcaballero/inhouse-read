// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {refreshSelectedBookNames} from '../../src/js/selected-book-names.js';
import {displayBookTitle} from '../../src/js/book-title.js';
describe('names at the prepared reader handoff',()=>{
 it('copies the latest edited names without replacing bytes or progress',()=>{
  const record={id:'book',title:'Tiny',author:'Old',content:new Blob(['bytes']),locator:{kind:'pdf-page',value:4}};
  const original={content:record.content,locator:record.locator};
  const experience={refreshNames:vi.fn((id,fields)=>{if(id===record.id)Object.assign(record,fields)})};
  const selected={id:'book',title:'Old title',spineTitleOverride:'Claros del bosque',author:'Maria Zambrano',locator:{value:1},content:null};
  refreshSelectedBookNames(experience,selected);
  expect(displayBookTitle(record)).toBe('Claros del bosque');expect(record.author).toBe('Maria Zambrano');
  expect(record.content).toBe(original.content);expect(record.locator).toBe(original.locator);
  expect(experience.refreshNames).toHaveBeenCalledWith('book',{spineTitleOverride:'Claros del bosque',author:'Maria Zambrano'});
 });
 it('retains explicit clearing and does not erase new document names with undefined fields',()=>{
  const refreshNames=vi.fn();refreshSelectedBookNames({refreshNames},{id:'book',spineTitleOverride:null,author:''});
  expect(refreshNames).toHaveBeenLastCalledWith('book',{spineTitleOverride:null,author:''});
  refreshSelectedBookNames({refreshNames},{id:'book',spineTitleOverride:undefined,author:undefined,title:'stale'});
  expect(refreshNames).toHaveBeenLastCalledWith('book',{});
 });
 it('does not read names from another book or from inherited fields',()=>{
  const refreshNames=vi.fn();const selected=Object.assign(Object.create({author:'Other'}),{id:'selected',spineTitleOverride:'Current'});
  refreshSelectedBookNames({refreshNames},selected);expect(refreshNames).toHaveBeenCalledWith('selected',{spineTitleOverride:'Current'});
  refreshSelectedBookNames({refreshNames},null);expect(refreshNames).toHaveBeenCalledTimes(1);
 });
 it('the production handoff refreshes names before revealing the prepared reader',async()=>{
  const source=readFileSync(new URL('../../src/js/app.js',import.meta.url),'utf8');
  const fragment=source.match(/onReaderReady: async \(\) => \{[\s\S]*?try \{([\s\S]*?)markTiming\('reveal-done'\)/)?.[1];
  expect(fragment).toBeTruthy();const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const handoff=new AsyncFunction('book','readingExperience','revealPreparedReader','refreshSelectedBookNames',fragment);
  const prepared={id:'book',title:'Tiny',author:'Old'};
  const experience={refreshNames:(id,fields)=>{if(id===prepared.id)Object.assign(prepared,fields)}};
  let visible;
  await handoff({id:'book',spineTitleOverride:'Claros del bosque',author:'Maria Zambrano'},experience,async()=>{visible={title:displayBookTitle(prepared),author:prepared.author}},refreshSelectedBookNames);
  expect(visible).toEqual({title:'Claros del bosque',author:'Maria Zambrano'});
 });
});
