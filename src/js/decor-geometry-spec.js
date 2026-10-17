// Shared fitted dimensions for rendered meshes and Rust contact shapes.
import {resolveCatalogPlant} from './plant-records.js';
import {getCatalogPot} from './plant-catalog-data.js';
import {plantDimensions} from './plant-dimensions.js';
import {getCatalogLamp} from './lamp-catalog-data.js';
export function plantGeometrySpec(entry){
 const catalogPlant=resolveCatalogPlant(entry);
 const potId=getCatalogPot(entry.potId)?.id??catalogPlant.defaultPotId??null;
 const potModelId=getCatalogPot(potId)?.modelId||potId;
 const real=plantDimensions(catalogPlant.id,potId);
 const height=Math.max(1,Number(entry.height)||real.height*.5),unit=height/real.height;
 return {catalogPlant,potId,potModelId,real,height,unit};
}
export function lampGeometrySpec({lampId='tarnaby',width=null,height=null}={}){
 const lamp=getCatalogLamp(lampId)||getCatalogLamp('tarnaby'),native=lamp.dimensions;
 const widthScale=Number.isFinite(width)&&width>0?width/native.width:1;
 const heightScale=Number.isFinite(height)&&height>0?height/native.height:Infinity;
 return {lamp,native,scale:Math.min(widthScale,heightScale),kind:lamp.id==='mittled'?0:lamp.id==='tripod'?1:2};
}
