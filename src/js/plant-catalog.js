import {getRustUI} from './rust-ui.js'
import {createPlantCatalogNative} from './plant-catalog-native.js'
export {plantCatalogIllustration} from './plant-catalog-art.js'
// The catalogue is built by the Rust view only. plant-catalog-lazy.js waits for
// the module before it creates one, so a missing module is a real failure.
export function createPlantCatalog(options={}){
 const ui=getRustUI(),View=ui?.RustCatalogView
 if(!View||!['render','connect','syncColors'].every(name=>typeof View.prototype[name]==='function')||!['catalog_build','catalog_colors','catalog_dialog','catalog_begin_flight'].every(name=>typeof ui[name]==='function'))
  throw new Error('El catálogo necesita el módulo Rust de interfaz')
 return createPlantCatalogNative(options,undefined,ui)
}
