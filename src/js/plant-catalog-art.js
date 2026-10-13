import {getRustUI} from './rust-ui.js'
import {plantCatalogIllustration as legacy} from './plant-catalog-art-legacy.js'
const plants=new Set(['sansevieria','monstera','chamaedorea','nephrolepis','hedera','zamioculcas','succulent','cactus']),pots=new Set(['muskot','akerbar','muskotblomma','gradvis'])
export function nativeIllustration(ui,plant,pot,options={}){
 plant=plants.has(plant)?plant:'monstera';pot=pots.has(pot)?pot:'muskot';const compact=!!options.compact,potOnly=!!options.potOnly
 if(!potOnly&&(plant==='chamaedorea'||plant==='nephrolepis')){
  const fern=plant==='nephrolepis',sizes=Array.from(ui.catalog_frond_fractions(fern,compact),fraction=>Math.sin(fraction*Math.PI)**.7*(fern?15:23)),numbers=ui.catalog_frond_numbers(sizes)
  return numbers&&ui.catalog_frond_illustration(plant,pot,compact,Array.from(numbers,String).join('\0'))
 }
 return ui.catalog_illustration(plant,pot,potOnly,compact)
}

export function plantCatalogIllustration(plant,pot='muskot',{potOnly=false,compact=false}={}){
 const ui=getRustUI(),options={potOnly,compact}
 if(ui&&['catalog_illustration','catalog_frond_fractions','catalog_frond_numbers','catalog_frond_illustration'].every(name=>typeof ui[name]==='function'))try{const result=nativeIllustration(ui,plant,pot,options);if(typeof result==='string')return result}catch{/* Keep the original art if the module cannot render this input. */}
 return legacy(plant,pot,options)
}
