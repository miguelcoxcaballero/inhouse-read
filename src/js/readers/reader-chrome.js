import {readerUI} from './rust-ui-required.js'
import {readerPanelMarkup,readerIcon} from './reader-interface.js'
export class ReaderChrome{
 constructor(host){this.host=host;this.reveal=()=>readerUI().reader_reveal_field(host,document)}
 create(){
  const host=this.host,onReturn=()=>host.voice.browsing?host.voice.returnToAudio():host.returnToReading()
  const miniMarkup=`<button type="button" data-mini-open><span data-mini-title></span><small data-mini-status></small></button><button type="button" class="reading-icon-button" data-mini-play aria-label="Pausar lectura">${readerIcon('pause')}</button><button type="button" class="reading-icon-button" data-mini-stop aria-label="Detener lectura">${readerIcon('stop')}</button>`
  return readerUI().reader_create_chrome(host,readerPanelMarkup(),miniMarkup,onReturn,document)
 }
 voiceState(state,message){return readerUI().reader_voice_state(this.host,state,message,document)}
 resize(){if(readerUI().reader_resize_panel(this.host,window))requestAnimationFrame(this.reveal)}
}
