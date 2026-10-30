import {rustMethods} from './rust-ui-required.js'
import * as runtime from './neural-runtime.js'
import * as state from './reading-state.js'
// Opening a book into the panel, refreshing its names, closing its voice, resetting and showing a tab:
// rust-ui reader_lifecycle.rs, answered by flow_methods.rs over the experience this part belongs to.
export class ReaderLifecycle{constructor(host){this.host=host}}
rustMethods(ReaderLifecycle,'flow_method','refreshNames ~open closeVoice reset show',{part:'lifecycle',runtime,state})
