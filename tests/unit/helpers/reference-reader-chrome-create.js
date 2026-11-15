// FROZEN copy of ReaderChrome.prototype.create (src/js/readers/reader-chrome.js) as it was before it moved to rust-ui
// reader_chrome.rs `reader_chrome_create`. `ui` (it was readerUI()) and RATE_STEPS (it was imported) are passed in;
// nothing else differs. It is the reference of reader-chrome-wasm.test.js: do not edit it to follow production.
export function referenceChromeCreate(ui,RATE_STEPS){
  const host=this.host,onReturn=()=>host.voice.browsing?host.voice.returnToAudio():host.returnToReading()
  const miniMarkup=`<button type="button" data-mini-open><span data-mini-title></span><small data-mini-status></small></button><span class="reading-audio-remaining" data-audio-remaining title="Tiempo restante estimado">—h —min</span><button type="button" class="reading-icon-button" data-mini-play aria-label="Pausar lectura">${ui.reader_icon('pause')}</button><button type="button" class="reading-icon-button" data-mini-stop aria-label="Detener lectura">${ui.reader_icon('stop')}</button>`
  return ui.reader_create_chrome(host,ui.reader_panel_markup(RATE_STEPS),miniMarkup,onReturn,document)
 }
