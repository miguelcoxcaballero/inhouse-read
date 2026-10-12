import {getRustUI} from '../rust-ui.js'
import {notifyCloudSettingsChanged} from '../cloud-settings.js'
import {normalizeReadingPreferences,READING_THEMES} from './reading-preferences.js'
import {legacyPreferenceFlow} from './preference-flow-legacy.js'
const KEY='inhouse-read-reading-preferences'
const normalize=(preferences,key,value)=>normalizeReadingPreferences({...preferences,[key]:value})
const notify=()=>notifyCloudSettingsChanged(KEY)
const store=preferences=>localStorage.setItem(KEY,JSON.stringify(preferences))
export class PreferenceFlow{
 constructor(host){this.host=host}
 set(key,value,restart){const ui=getRustUI();return ui?.reader_set_preference?ui.reader_set_preference(this.host,key,value,restart,normalize,notify):legacyPreferenceFlow.setPreference.call(this.host,key,value,{restart})}
 async apply(updateBook){const ui=getRustUI();return ui?.reader_apply_preferences?ui.reader_apply_preferences(this.host,updateBook,READING_THEMES,store):legacyPreferenceFlow.applyPreferences.call(this.host,updateBook)}
}
