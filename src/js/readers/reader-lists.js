import {getRustUI} from '../rust-ui.js'
import {LegacyReaderLists} from './reader-lists-legacy.js'
const methods=['renderToc','renderPlaces','clearSearch','renderSearch']
const compatible=()=>{const Lists=getRustUI()?.RustReaderLists;return Lists&&methods.every(name=>typeof Lists.prototype[name]==='function')?Lists:null}

// Adopt on the next requested list update. Existing rows, focus and scroll stay
// untouched while WASM arrives; each list keeps working until it is replaced.
export class ReaderLists {
 constructor(panel){
  const Lists=compatible();if(Lists)return new Lists(panel)
  const fallback=new LegacyReaderLists(panel),owned=new Map()
  let native=null,disposed=false
  const release=key=>{for(const[node,handler]of owned.get(key)||[])if(node.onclick===handler)node.onclick=null;owned.delete(key)}
  for(const name of methods)Object.defineProperty(fallback,name,{value:(...args)=>{
   if(disposed)throw new Error('Reader lists were disposed')
   const Candidate=!native&&compatible()
   if(Candidate)try{native=new Candidate(panel)}catch{/* Keep the existing list usable; retry on its next update. */}
   const key=name==='renderToc'?'toc':name==='renderPlaces'?args[0]:'search-results'
   release(key)
   const result=native?native[name](...args):LegacyReaderLists.prototype[name].apply(fallback,args)
   if(!native)owned.set(key,[...panel.querySelectorAll('[data-'+key+'] button')].filter(node=>typeof node.onclick==='function').map(node=>[node,node.onclick]))
   return result
  }})
  Object.defineProperty(fallback,'free',{value:()=>{if(disposed)return;disposed=true;for(const key of owned.keys())release(key);native?.free();native=null}})
  return fallback
 }
}
