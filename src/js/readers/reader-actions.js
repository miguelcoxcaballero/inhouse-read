import {readerUI} from './rust-ui-required.js'
import {clonePlace,cleanPlaces,cleanQuotes} from './reading-state.js'

export class ReaderActions{
 constructor(host){
  this.host=host
  this.place=()=>readerUI().reader_action_place(host,clonePlace)
  this.fields=()=>readerUI().reader_action_fields(host,cleanPlaces,cleanQuotes)
  this.quote=(text,locator)=>readerUI().reader_action_quote(host,text,locator)
 }
 savePlaces(){return readerUI().reader_save_places(this.host,this.fields)}
 jump(place,target,current){return readerUI().reader_jump(this.host,place,target,current,this.place)}
 returnToReading(place,current){return readerUI().reader_return(this.host,place,current)}
 addBookmark(){return readerUI().reader_bookmark(this.host,this.place)}
 addQuote(){return readerUI().reader_quote(this.host,this.quote,cleanQuotes)}
 search(query){return readerUI().reader_search(this.host,query,result=>{this.host.keepSearchHits=true;this.host.jump({fraction:result.fraction??this.host.location.fraction,locator:result.locator})})}
 endSearch(){return readerUI().reader_end_search(this.host)}
}
