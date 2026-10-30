import {rustMethods} from './rust-ui-required.js'
import {notifyCloudSettingsChanged} from '../cloud-settings.js'
import * as preferences from './reading-preferences.js'
// Setting and applying a reading preference: rust-ui preference_flow.rs, answered by flow_methods.rs.
const KEY='inhouse-read-reading-preferences'
export class PreferenceFlow{constructor(host){this.host=host}}
rustMethods(PreferenceFlow,'flow_method','set ~apply',{part:'preferences',preferences,
 normalize:(current,key,value)=>preferences.normalizeReadingPreferences({...current,[key]:value}),notify:()=>notifyCloudSettingsChanged(KEY),
 store:value=>localStorage.setItem(KEY,JSON.stringify(value))})
