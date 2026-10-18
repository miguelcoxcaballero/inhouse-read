// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';
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
 it('the compiled production handoff refreshes names before revealing the prepared reader',async()=>{
  const prepared={id:'book',title:'Tiny',author:'Old'};
  const experience={refreshNames:(id,fields)=>{if(id===prepared.id)Object.assign(prepared,fields)}};
  let visible;const classList={add(){},remove(){}};
  const screen={hidden:false,classList,dataset:{}},toolbar={hidden:true,classList,offsetWidth:0};
  const book={id:'book',spineTitleOverride:'Claros del bosque',author:'Maria Zambrano'};
  const ctx={isActive:()=>true,finish:async()=>true};
  const host={state:{currentBookId:'book',activeOpeningContext:ctx},els:{readerScreen:screen,readerToolbar:toolbar},document:{body:{classList}},
   readingExperience:experience,refreshSelectedBookNames,revealPreparedReader:async()=>{visible={title:displayBookTitle(prepared),author:prepared.author}},
   markTiming(){},library:{get:async()=>prepared},openingPageSnapshot:async()=>({sourceType:'pdf-canvas'}),animateReaderPageFromBook(){},
   requestAnimationFrame:callback=>callback(),setTimeout:()=>0,revealReaderToolbar(){},settleReaderToolbar(){}};
  await rustShelf.app_reader_ready(host,{book,ctx});
  expect(visible).toEqual({title:'Claros del bosque',author:'Maria Zambrano'});
  expect(host.state.activeOpeningContext).toBeNull();expect(toolbar.hidden).toBe(false);
 });
});
