import {readerUI} from './rust-ui-required.js'
import {cleanPlaces,cleanQuotes} from './reading-state.js'
import {neuralEngine} from './neural-runtime.js'
export function closeReaderVoice(host){return readerUI().reader_close_voice(host,neuralEngine)}
export class ReaderLifecycle{
 constructor(host){this.host=host}
 refreshNames(id,fields){return readerUI().reader_refresh_names(this.host,id,fields)}
 async open(record){return readerUI().reader_open(this.host,record,cleanPlaces,cleanQuotes)}
 closeVoice(){return closeReaderVoice(this.host)}
 reset(){return readerUI().reader_reset(this.host)}
 show(tab){return readerUI().reader_show(this.host,tab)}
}
