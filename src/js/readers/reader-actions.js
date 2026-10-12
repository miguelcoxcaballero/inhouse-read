import {getRustUI} from '../rust-ui.js'
import {clonePlace,cleanPlaces,cleanQuotes} from './reading-state.js'
import {legacyReaderActions} from './reader-actions-legacy.js'

export class ReaderActions{
 constructor(host){
  this.host=host
  this.place=()=>({...clonePlace(host.location),label:host.label(host.location),createdAt:Date.now()})
  this.fields=()=>({readingHistory:cleanPlaces(host.history),bookmarks:cleanPlaces(host.bookmarks,100),quotes:cleanQuotes(host.quotes)})
  this.quote=(text,locator)=>({id:globalThis.crypto?.randomUUID?.()||`${Date.now()}`,text,locator,fraction:host.location.fraction,label:host.label(host.location),color:host.quoteColor,createdAt:Date.now()})
 }
 savePlaces(){const ui=getRustUI();return ui?.reader_save_places?ui.reader_save_places(this.host,this.fields):legacyReaderActions.savePlaces.call(this.host)}
 jump(place,target,current){const ui=getRustUI();return ui?.reader_jump?ui.reader_jump(this.host,place,target,current,this.place):legacyReaderActions.jump.call(this.host,place,target,current)}
 returnToReading(place,current){const ui=getRustUI();return ui?.reader_return?ui.reader_return(this.host,place,current):legacyReaderActions.returnToReading.call(this.host,place,current)}
 addBookmark(){const ui=getRustUI();return ui?.reader_bookmark?ui.reader_bookmark(this.host,this.place):legacyReaderActions.addBookmark.call(this.host)}
 addQuote(){const ui=getRustUI();return ui?.reader_quote?ui.reader_quote(this.host,this.quote,cleanQuotes):legacyReaderActions.addQuote.call(this.host)}
 search(query){const ui=getRustUI();return ui?.reader_search?ui.reader_search(this.host,query,result=>{this.host.keepSearchHits=true;this.host.jump({fraction:result.fraction??this.host.location.fraction,locator:result.locator})}):legacyReaderActions.search.call(this.host,query)}
 endSearch(){const ui=getRustUI();return ui?.reader_end_search?ui.reader_end_search(this.host):legacyReaderActions.endSearch.call(this.host)}
}
