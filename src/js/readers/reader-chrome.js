import {getRustUI} from '../rust-ui.js'
import {readerPanelMarkup,readerIcon} from './reader-interface.js'
import {LegacyReaderChrome} from './reader-chrome-legacy.js'
const legacy=LegacyReaderChrome.prototype
export class ReaderChrome{
 constructor(host){this.host=host;this.reveal=()=>{const ui=getRustUI();return ui?.reader_reveal_field?ui.reader_reveal_field(host,document):legacy.revealField.call(host)}}
 create(){
  const host=this.host,ui=getRustUI(),onReturn=()=>host.voice.browsing?host.voice.returnToAudio():host.returnToReading()
  const miniMarkup=`<button type="button" data-mini-open><span data-mini-title></span><small data-mini-status></small></button><button type="button" class="reading-icon-button" data-mini-play aria-label="Pausar lectura">${readerIcon('pause')}</button><button type="button" class="reading-icon-button" data-mini-stop aria-label="Detener lectura">${readerIcon('stop')}</button>`
  return ui?.reader_create_chrome?ui.reader_create_chrome(host,readerPanelMarkup,miniMarkup,onReturn,document):legacy.create.call(host,readerPanelMarkup,miniMarkup,onReturn)
 }
 voiceState(state,message){const ui=getRustUI();return ui?.reader_voice_state?ui.reader_voice_state(this.host,state,message,readerIcon,document):legacy.voiceState.call(this.host,state,message,readerIcon)}
 resize(){const ui=getRustUI();if(ui?.reader_resize_panel?ui.reader_resize_panel(this.host,window):legacy.resize.call(this.host))requestAnimationFrame(this.reveal)}
}
