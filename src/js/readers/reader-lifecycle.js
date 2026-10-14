import {readerUI} from './rust-ui-required.js'
import {cleanPlaces,cleanQuotes} from './reading-state.js'
import {displayBookTitle,normalizeBookAuthor} from '../book-title.js'
import {neuralEngine} from './neural-runtime.js'
export function closeReaderVoice(host){return readerUI().reader_close_voice(host,neuralEngine)}
export class ReaderLifecycle{
 constructor(host){
  this.host=host
  this.describe=record=>{const title=displayBookTitle(record),author=normalizeBookAuthor(record.author)||normalizeBookAuthor(record.metadata?.creator);return [title,author,`${title}${author?` · ${author}`:''}\n${record.format||'Documento'} · ${host.formatSize(record.sizeBytes)}`]}
 }
 refreshNames(id,fields){return readerUI().reader_refresh_names(this.host,id,fields,this.describe)}
 async open(record){return readerUI().reader_open(this.host,record,cleanPlaces,cleanQuotes,this.describe)}
 closeVoice(){return closeReaderVoice(this.host)}
 reset(){return readerUI().reader_reset(this.host)}
 show(tab){return readerUI().reader_show(this.host,tab)}
}
