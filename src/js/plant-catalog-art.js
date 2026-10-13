import {getRustUI} from './rust-ui.js'
const plants=new Set(['sansevieria','monstera','chamaedorea','nephrolepis','hedera','zamioculcas','succulent','cactus']),pots=new Set(['muskot','akerbar','muskotblomma','gradvis'])
export function nativeIllustration(ui,plant,pot,options={}){
 plant=plants.has(plant)?plant:'monstera';pot=pots.has(pot)?pot:'muskot';const compact=!!options.compact,potOnly=!!options.potOnly
 if(!potOnly&&(plant==='chamaedorea'||plant==='nephrolepis')){
  const fern=plant==='nephrolepis',sizes=Array.from(ui.catalog_frond_fractions(fern,compact),fraction=>Math.sin(fraction*Math.PI)**.7*(fern?15:23)),numbers=ui.catalog_frond_numbers(sizes)
  return numbers&&ui.catalog_frond_illustration(plant,pot,compact,Array.from(numbers,String).join('\0'))
 }
 return ui.catalog_illustration(plant,pot,potOnly,compact)
}

// Only the catalogue (which exists once the Rust module is loaded) draws these.
export function plantCatalogIllustration(plant,pot='muskot',{potOnly=false,compact=false}={}){
 const ui=getRustUI()
 if(!ui||!['catalog_illustration','catalog_frond_fractions','catalog_frond_numbers','catalog_frond_illustration'].every(name=>typeof ui[name]==='function'))throw new Error('Las ilustraciones del catálogo necesitan el módulo Rust de interfaz')
 const result=nativeIllustration(ui,plant,pot,{potOnly,compact})
 if(typeof result!=='string')throw new Error('El módulo Rust de interfaz no pudo dibujar la ilustración del catálogo')
 return result
}
