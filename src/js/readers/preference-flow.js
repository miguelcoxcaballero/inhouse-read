import {readerUI} from './rust-ui-required.js'
import {notifyCloudSettingsChanged} from '../cloud-settings.js'
import {normalizeReadingPreferences,READING_THEMES} from './reading-preferences.js'
const KEY='inhouse-read-reading-preferences'
const normalize=(preferences,key,value)=>normalizeReadingPreferences({...preferences,[key]:value})
const notify=()=>notifyCloudSettingsChanged(KEY)
const store=preferences=>localStorage.setItem(KEY,JSON.stringify(preferences))
export class PreferenceFlow{
 constructor(host){this.host=host}
 set(key,value,restart){return readerUI().reader_set_preference(this.host,key,value,restart,normalize,notify)}
 async apply(updateBook){return readerUI().reader_apply_preferences(this.host,updateBook,READING_THEMES,store)}
}
