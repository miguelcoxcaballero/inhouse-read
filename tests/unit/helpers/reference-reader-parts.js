// FROZEN copies of the five parts of the reading experience as they were before rust-ui built them
// (experience_parts.rs `reader_part`): src/js/readers/reader-chrome.js, reader-lifecycle.js, voice-flow.js,
// preference-flow.js and reader-actions.js. They are the reference of reader-parts.test.js and of the frozen
// experience (reference-reader-experience-shell.js): do not edit them to follow production.
//
// One thing is not the original text: the dispatcher's doorway. `rustMethods(Class,'flow_method',names,kit)` called
// `ui.flow_method(part, name, args, kit, ui)`, which handed the call to the export named beside each method below
// (rust-ui flow_methods.rs, now gone); `methods` gives the class the same members (same descriptors, same
// `async function` wrapper for a `~` name) calling those exports directly, with the kits the modules had.
// reader_jump and reader_search take the callback they were given last as their second argument.
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'
import {RATE_STEPS} from '../../../src/js/readers/reading-preferences.js'
import {notifyCloudSettingsChanged} from '../../../src/js/cloud-settings.js'
import * as preferences from '../../../src/js/readers/reading-preferences.js'
import * as catalog from './live-voice-catalog.js'
import * as runtime from '../../../src/js/readers/neural-runtime.js'
import * as state from '../../../src/js/readers/reading-state.js'
import {clonePlace,cleanPlaces,cleanQuotes} from '../../../src/js/readers/reading-state.js'

// What the production experience hands to rust-ui for its parts (reader-experience.js `kit`).
export const partsKit={runtime,preferences,state,catalog,notify:notifyCloudSettingsChanged}
const KEY='inhouse-read-reading-preferences'
// The kits of preference-flow.js and voice-flow.js.
const normalize=(current,key,value)=>preferences.normalizeReadingPreferences({...current,[key]:value}),notify=()=>notifyCloudSettingsChanged(KEY)
const store=value=>localStorage.setItem(KEY,JSON.stringify(value)),device=()=>navigator.language
function methods(Class,table){
 for(const [entry,answer] of Object.entries(table)){
  const name=entry.replace(/^~/,''),call=(part,args)=>answer(readerUI(),part.host,...args)
  const descriptor={value:entry[0]==='~'?async function(...args){return call(this,args)}:function(...args){return call(this,args)},writable:true}
  Object.defineProperty(Class.prototype,name,{...descriptor,configurable:true})
 }
}
// Results the dispatcher answered `undefined` for (its `done`).
const done=()=>undefined

export class ReaderChrome{
 constructor(host){this.host=host;this.reveal=()=>readerUI().reader_reveal_field(host,document)}
 // The panel, the mini player and the return button: rust-ui reader_chrome.rs.
 create(){return readerUI().reader_chrome_create(this.host,RATE_STEPS,document)}
 resize(){if(readerUI().reader_resize_panel(this.host,window))requestAnimationFrame(this.reveal)}
}
// The audio state shown in the panel and the mini player: rust-ui reader_chrome.rs, answered by flow_methods.rs.
methods(ReaderChrome,{voiceState:(ui,host,a,b)=>done(ui.reader_voice_state(host,a,b,document))})

// Opening a book into the panel, refreshing its names, closing its voice, resetting and showing a tab:
// rust-ui reader_lifecycle.rs, answered by flow_methods.rs over the experience this part belongs to.
export class ReaderLifecycle{constructor(host){this.host=host}}
methods(ReaderLifecycle,{refreshNames:(ui,host,a,b)=>done(ui.reader_refresh_names(host,a,b)),'~open':(ui,host,a)=>ui.reader_open(host,a,state.cleanPlaces,state.cleanQuotes),
 closeVoice:(ui,host)=>done(ui.reader_close_voice(host,runtime.neuralEngine)),reset:(ui,host)=>done(ui.reader_reset(host)),show:(ui,host,a)=>done(ui.reader_show(host,a))})

// The book's language and the language and voice menus: rust-ui voice_flow.rs, answered by flow_methods.rs.
export class VoiceFlow{constructor(host){this.host=host}}
methods(VoiceFlow,{bookLanguage:(ui,host)=>ui.reader_book_language(host,device),chooseLanguage:(ui,host,a)=>done(ui.reader_choose_language(host,a,catalog.langBase)),
 voiceBase:(ui,host,a)=>ui.reader_voice_base(host,a,catalog.langBase,catalog.declaredLanguage),
 populateVoices:(ui,host)=>done(ui.reader_populate_voices_catalog(host,runtime.neuralVoiceList,device,catalog))})

// Setting and applying a reading preference: rust-ui preference_flow.rs, answered by flow_methods.rs.
export class PreferenceFlow{constructor(host){this.host=host}}
methods(PreferenceFlow,{set:(ui,host,key,value,restart)=>done(ui.reader_set_preference(host,String(key),value,restart,normalize,notify)),
 '~apply':(ui,host,update)=>ui.reader_apply_preferences(host,update,preferences.READING_THEMES,store)})

export class ReaderActions{
 constructor(host){
  this.host=host
  this.place=()=>readerUI().reader_action_place(host,clonePlace)
  this.fields=()=>readerUI().reader_action_fields(host,cleanPlaces,cleanQuotes)
  this.quote=(text,locator)=>readerUI().reader_action_quote(host,text,locator)
 }
 savePlaces(){return readerUI().reader_save_places(this.host,this.fields)}
 jump(place,target,current){return readerUI().reader_jump(this.host,this.place,place,target,current)}
 returnToReading(place,current){return readerUI().reader_return(this.host,place,current)}
 addBookmark(){return readerUI().reader_bookmark(this.host,this.place)}
 addQuote(){return readerUI().reader_quote(this.host,this.quote,cleanQuotes)}
 search(query){return readerUI().reader_search(this.host,result=>readerUI().reader_search_activate(this.host,result),query)}
 endSearch(){return readerUI().reader_end_search(this.host)}
}
export const referenceParts={chrome:ReaderChrome,lifecycle:ReaderLifecycle,voices:VoiceFlow,preferences:PreferenceFlow,actions:ReaderActions}
