import {getRustUI} from '../rust-ui.js'
import {cleanPlaces,cleanQuotes} from './reading-state.js'
import {displayBookTitle,normalizeBookAuthor} from '../book-title.js'
import {neuralEngine} from './neural-runtime.js'
import {LegacyReaderLifecycle} from './reader-lifecycle-legacy.js'
const legacy=LegacyReaderLifecycle.prototype
export function closeReaderVoice(host){const ui=getRustUI();return ui?.reader_close_voice?ui.reader_close_voice(host,neuralEngine):legacy.closeVoice.call(host)}
export class ReaderLifecycle{
 constructor(host){
  this.host=host
  this.describe=record=>{const title=displayBookTitle(record),author=normalizeBookAuthor(record.author)||normalizeBookAuthor(record.metadata?.creator);return [title,author,`${title}${author?` · ${author}`:''}\n${record.format||'Documento'} · ${host.formatSize(record.sizeBytes)}`]}
 }
 refreshNames(id,fields){const ui=getRustUI();return ui?.reader_refresh_names?ui.reader_refresh_names(this.host,id,fields,this.describe):legacy.refreshNames.call(this.host,id,fields)}
 async open(record){const ui=getRustUI();return ui?.reader_open?ui.reader_open(this.host,record,cleanPlaces,cleanQuotes,this.describe):legacy.open.call(this.host,record)}
 closeVoice(){return closeReaderVoice(this.host)}
 reset(){const ui=getRustUI();return ui?.reader_reset?ui.reader_reset(this.host):legacy.reset.call(this.host)}
 show(tab){const ui=getRustUI();return ui?.reader_show?ui.reader_show(this.host,tab):legacy.show.call(this.host,tab)}
}
