import {getRustUI} from '../rust-ui.js'
import {LegacyVoiceNavigation} from './voice-navigation-legacy.js'
const legacy=LegacyVoiceNavigation.prototype,add=(a,b)=>a+b
export function browseVoice(host){const ui=getRustUI();return ui?.voice_browse?ui.voice_browse(host,add):legacy.browse.call(host)}
export async function returnVoiceAudio(host){const ui=getRustUI();return ui?.voice_return_audio?ui.voice_return_audio(host):legacy.returnToAudio.call(host)}
export async function continueVoicePage(host,navigate){const ui=getRustUI();return ui?.voice_continue_page?ui.voice_continue_page(host,navigate):legacy.continueFromPage.call(host,navigate)}
export function jumpVoicePoint(host,{doc,x,y}={}){const ui=getRustUI();return ui?.voice_jump_point?ui.voice_jump_point(host,doc,x,y):legacy.jumpToPoint.call(host,{doc,x,y})}
export async function seekVoicePoint(host,{doc,x,y}){const ui=getRustUI();return ui?.voice_seek_point?ui.voice_seek_point(host,doc,x,y):legacy.seekToPoint.call(host,{doc,x,y})}
