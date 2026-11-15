import {readerUI,rustMethods} from './rust-ui-required.js'
import {RATE_STEPS} from './reading-preferences.js'
export class ReaderChrome{
 constructor(host){this.host=host;this.reveal=()=>readerUI().reader_reveal_field(host,document)}
 // The panel, the mini player and the return button: rust-ui reader_chrome.rs.
 create(){return readerUI().reader_chrome_create(this.host,RATE_STEPS,document)}
 resize(){if(readerUI().reader_resize_panel(this.host,window))requestAnimationFrame(this.reveal)}
}
// The audio state shown in the panel and the mini player: rust-ui reader_chrome.rs, answered by flow_methods.rs.
rustMethods(ReaderChrome,'flow_method','voiceState',{part:'chrome',get document(){return document}})
