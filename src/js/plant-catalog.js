import {getRustUI} from './rust-ui.js'
import {createPlantCatalogNative} from './plant-catalog-native.js'
export {plantCatalogIllustration} from './plant-catalog-art.js'
let sequence=0
// The catalogue is built by the Rust view only. plant-catalog-lazy.js waits for
// the module before it creates one, so a missing module is a real failure.
export function createPlantCatalog(options={}){
 const ui=getRustUI(),View=ui?.RustCatalogView
 if(!View||!['render','connect','syncColors'].every(name=>typeof View.prototype[name]==='function')||typeof ui.catalog_build!=='function'||typeof ui.catalog_colors!=='function')
  throw new Error('El catálogo necesita el módulo Rust de interfaz')
 return createPlantCatalogNative(options,'ihr-plant-catalog-'+(++sequence),ui)
}
