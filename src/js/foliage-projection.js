import {projectPlantFoliage as legacy} from './foliage-projection-legacy.js'
import {getRustUI} from './rust-ui.js'
import {getRustShelf} from './rust-shelf.js'
const matches=/^(leaf(?:-\d+|-batch)|cactus(?:-column-\d+|-batch))$/;
export function projectPlantFoliage(model){
 const ui=getRustUI(),runtime=ui?.foliage_path?ui:getRustShelf();
 if(!runtime?.foliage_path)return legacy(model);
 const paths=[];let triangles=0;
 model.traverse(mesh=>{
  if(!mesh.isMesh||!matches.test(mesh.name))return;
  const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index;
  let result;
  if(!['getX','getY','getZ'].some(key=>Object.hasOwn(positions,key))&&positions.itemSize===3&&!positions.normalized&&!positions.isInterleavedBufferAttribute&&positions.array instanceof Float32Array&&Number.isSafeInteger(positions.count)&&(!indices||!Object.hasOwn(indices,'getX')&&indices.itemSize===1&&!indices.normalized&&!indices.isInterleavedBufferAttribute&&Number.isSafeInteger(indices.count)&&(indices.array instanceof Uint16Array||indices.array instanceof Uint32Array||indices.array instanceof Uint8Array))){
   try{result=runtime.foliage_path(positions.array.subarray(0,positions.count*3),indices?new Uint32Array(indices.array.subarray(0,indices.count)):new Uint32Array(),new Float64Array(mesh.matrixWorld.elements),!!indices)}catch{}
  }
  // Rust returns the finished SVG path text and its triangle count; anything else keeps the original projection for this mesh.
  const part=Array.isArray(result)&&typeof result[0]==='string'&&Number.isSafeInteger(result[1])&&result[1]>=0?{path:result[0],triangles:result[1]}:legacy({traverse:visit=>visit(mesh)});
  paths.push(part.path);triangles+=part.triangles;
 });return{path:paths.join(''),triangles};
}
