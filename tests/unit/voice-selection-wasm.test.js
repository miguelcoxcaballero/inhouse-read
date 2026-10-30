import assert from 'node:assert/strict'
import {it,expect,vi,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {LegacyVoiceSelection} from './helpers/reference-voice-selection.js'
// The session's methods (reading-voice.js) called on the fixture host, as the former wrapper modules did.
import {ReadingVoice} from '../../src/js/readers/reading-voice.js'
const method=name=>(host,...args)=>ReadingVoice.prototype[name].call(host,...args)
const selectReadingVoice=method('voiceFor')
import {declaredLanguage,isNeuralId,langBase,resolveVoice} from '../../src/js/readers/voice-catalog.js'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
const fixture=vi.hoisted(()=>({catalog:()=>[],ui:null}))
vi.mock('../../src/js/readers/neural-runtime.js',()=>({neuralVoiceList:()=>fixture.catalog()}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
const configure=catalog=>{fixture.catalog=catalog}
const core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
afterEach(()=>{fixture.ui=null;fixture.catalog=()=>[];vi.unstubAllGlobals()})
function setup(native,trial){
 fixture.ui=ui // the catalogue's own voice records and choice of voice are Rust too
 const host=new LegacyVoiceSelection(),events=[]
 const voices=[['es-ES','davefx'],['en-US','lessac'],['en-GB','alba'],['fr-FR','siwis']].map(([lang,name],i)=>({id:'piper:'+name,name,lang,base:lang.split('-')[0],region:lang.split('-')[1],installed:trial%5!==i,neural:true,tier:'medium',recommended:true}))
 const device=()=>{events.push(['device']);return trial%2?'en-US':''}
 vi.stubGlobal('navigator',{get language(){return device()}})
 Object.assign(host,{options:{multilingual:trial%3===0},languageOverride:trial%5===0?'fr-FR':'',reader:{language:trial%7===0?'':'en-GB',metadata:{language:trial%2?'es-ES':''}},voice:['','piper:lessac','piper:missing','piper:davefx','system'][trial%5],missing:new Set(trial%11===0?['piper:lessac']:[]),source:{physicalPage:trial%2===0},items:[],chunks:[],index:trial%3})
 const catalog=()=>{events.push(['catalog']);return voices}
 host.detectLanguage=text=>{events.push(['detect',text]);return String(text).includes('Bonjour')?'fr-FR':'es-ES'}
 const forVoice=native?text=>ui.voice_for(host,text,catalog,isNeuralId,declaredLanguage,langBase,resolveVoice,device):text=>LegacyVoiceSelection.prototype.voiceFor.call(host,text)
 host.voiceFor=text=>{events.push(['select',text]);return forVoice(text)}
 if(native){host.audioItem=item=>ui.voice_audio_item(item);host.needsPageJoin=(item,index)=>ui.voice_needs_join(host,item,index);host.upcomingFor=voice=>ui.voice_upcoming(host,voice)}else configure(catalog)
 return {host,events,voices}
}
it('preserves 500 voice selections, reference identities and bounded lookahead packets',()=>{
for(let trial=0;trial<500;trial++){
 const results=[]
 for(const native of [false,true]){
  const {host,events,voices}=setup(native,trial),text=trial%2?'Bonjour le monde.':'Hello world.'
  const selected=host.voiceFor(text);if(selected.voice)assert.ok(voices.includes(selected.voice))
  const items=Array.from({length:trial%7+1},(_,i)=>({text:i%2?'Bonjour.':'Hello.',marks:i%3===0?[{offset:2},{offset:5}]:undefined,joinChecked:trial%5===0}))
  if(trial%4===0)items.at(-1).text='Incomplete sentence'
  host.items=items;host.chunks=items.map(item=>item.text)
  host.aheadPage=trial%2?{plan:{items:[{text:'Bonjour.'},{text:'Hello.'}]}}:null
  const upcoming=host.upcomingFor(selected.voice||{id:'piper:missing'})
  results.push({selected,upcoming,events,items})
 }
 assert.deepEqual(results[1],results[0],'scenario '+trial)
}

})
it('matches sentence-end detection for 1210 punctuation combinations and preserves sparse marks',()=>{
const endings=['.','!','?','。','！','？','…','',',',';','x'],quotes=['',"'",'”','’','»','›',')',']','}','\"]}'],spaces=['',' ','\n','\r\n','\t','\u0085','\ufeff','\u2028','\u2003','\u3000','\ud800']
let punctuationCases=0
for(const ending of endings)for(const quote of quotes)for(const space of spaces){
 const text='Text'+ending+quote+space,item={text},host={source:{physicalPage:true},items:[item]}
 assert.equal(ui.voice_needs_join(host,item,0),LegacyVoiceSelection.prototype.needsPageJoin.call(host,item,0));punctuationCases++
}
for(const text of ['',null,undefined,false,0,42,Symbol('text'),{toString(){return 'Text. '}}]){
 const item={text},host={source:{physicalPage:true},items:[item]},results=[]
 for(const native of [false,true])try{results.push({value:native?ui.voice_needs_join(host,item,0):LegacyVoiceSelection.prototype.needsPageJoin.call(host,item,0)})}catch(error){results.push({error:error.name})}
 assert.deepEqual(results[1],results[0])
}
const sparse={text:'Text',marks:[{offset:0},,{offset:7}]};assert.deepEqual(ui.voice_audio_item(sparse),LegacyVoiceSelection.prototype.audioItem(sparse))

})
it('keeps selection and packet allocations bounded over repeated use',()=>{
for(let round=0;round<2;round++){
 const before=core.memory.buffer.byteLength
 for(let trial=0;trial<1000;trial++){const {host}=setup(true,trial);host.voiceFor('Hello');host.audioItem({text:'Text',marks:[{offset:0}]});host.upcomingFor({id:'piper:lessac'})}
 if(round)assert.equal(core.memory.buffer.byteLength,before)
}

})

it('does not consult the device language for a missing explicit voice',()=>{
 const {host,events}=setup(true,2);host.voiceFor('Hello')
 expect(events.some(row=>row[0]==='device')).toBe(false)
})
it('preserves exact UTF-16 packet text and propagates a mark getter error unchanged',()=>{
 const text='\ud800',packet=ui.voice_audio_item({text,marks:[{offset:0}]});expect(packet.text).toBe(text)
 const failure=Error('mark');try{ui.voice_audio_item({text:'Text',marks:[{get offset(){throw failure}}]});throw Error('Expected failure')}catch(error){expect(error).toBe(failure)}
})
it('selects through the Rust function while retaining the same installed voice records',()=>{
 const {host,voices}=setup(false,7);const before=host.voiceFor('Hello')
 const native={voice_method:vi.fn(ui.voice_method)};fixture.ui=native;const after=selectReadingVoice(host,'Hello')
 expect(native.voice_method).toHaveBeenCalledOnce();expect(native.voice_method.mock.calls[0].slice(0,3)).toEqual([host,'voiceFor',['Hello']]);expect(after).toEqual(before)
 if(after.voice)expect(voices).toContain(after.voice)
})
it('fails clearly without the core instead of choosing a voice another way',()=>{
 const {host}=setup(false,7);fixture.ui=null;expect(()=>selectReadingVoice(host,'Hello')).toThrow('Rust UI is not loaded')
})
