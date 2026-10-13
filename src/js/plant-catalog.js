import {getRustUI,loadRustUI} from './rust-ui.js'
import {createPlantCatalogLegacy} from './plant-catalog-legacy.js'
import {createPlantCatalogNative} from './plant-catalog-native.js'
export {plantCatalogIllustration} from './plant-catalog-legacy.js'
let sequence=0
export function createPlantCatalog(options={}){
 void loadRustUI()
 const ui=getRustUI(),id='ihr-plant-catalog-'+(++sequence),View=ui?.RustCatalogView
 if(View&&['render','connect','syncColors'].every(name=>typeof View.prototype[name]==='function')&&typeof ui.catalog_build==='function'&&typeof ui.catalog_colors==='function'){
  try{return createPlantCatalogNative(options,id,ui)}catch{/* A failed constructor has no mounted DOM or retained view. */}
 }
 return createPlantCatalogLegacy(options,id)
}
