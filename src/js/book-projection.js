import {getRustUI} from './rust-ui.js'
import {getRustShelf} from './rust-shelf.js'
import {visibleBounds as legacyBounds} from './book-projection-legacy.js'
export const createBookProjectionPacket=()=>({data:new Float64Array(22*32)})
export function nativeBounds(ui,model,camera,width,height,packet){
 if(!ui?.book_projection_bounds)return null
 let used=0,valid=true
 model.traverseVisible(mesh=>{
  const material=mesh.material
  if(!mesh.isMesh||!mesh.geometry||!material||(Array.isArray(material)?!material.some(each=>each&&each.visible!==false):material.visible===false))return
  if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox()
  const bounds=mesh.geometry.boundingBox
  if(!bounds||used>=22*1024){valid=false;return}
  if(used+22>packet.data.length){const data=new Float64Array(Math.min(22*1024,packet.data.length*2));data.set(packet.data);packet.data=data}
  const data=packet.data;data[used]=bounds.min.x;data[used+1]=bounds.min.y;data[used+2]=bounds.min.z
  data[used+3]=bounds.max.x;data[used+4]=bounds.max.y;data[used+5]=bounds.max.z
  data.set(mesh.matrixWorld.elements,used+6);used+=22
 })
 if(!valid)return null
 const result=ui.book_projection_bounds(packet.data.subarray(0,used),camera.matrixWorldInverse.elements,camera.projectionMatrix.elements,width,height)
 return result===undefined?null:result
}

export function projectVisibleBookBounds(model,camera,width,height,point,packet){
 const ui=getRustUI(),runtime=ui?.book_projection_bounds?ui:getRustShelf()
 return nativeBounds(runtime,model,camera,width,height,packet)||legacyBounds(model,camera,width,height,point)
}
