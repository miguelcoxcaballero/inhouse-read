import {projectPlantFoliage as legacy} from './foliage-projection-legacy.js'
import {getRustUI} from './rust-ui.js'
const matches=/^(leaf(?:-\d+|-batch)|cactus(?:-column-\d+|-batch))$/;
export function projectPlantFoliage(model){
 const ui=getRustUI();
 if(!ui?.foliage_plan)return legacy(model);
 const paths=[];let triangles=0;
 model.traverse(mesh=>{
  if(!mesh.isMesh||!matches.test(mesh.name))return;
  const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index;
  let plan;
  if(!['getX','getY','getZ'].some(key=>Object.hasOwn(positions,key))&&positions.itemSize===3&&!positions.normalized&&!positions.isInterleavedBufferAttribute&&positions.array instanceof Float32Array&&Number.isSafeInteger(positions.count)&&(!indices||!Object.hasOwn(indices,'getX')&&indices.itemSize===1&&!indices.normalized&&!indices.isInterleavedBufferAttribute&&Number.isSafeInteger(indices.count)&&(indices.array instanceof Uint16Array||indices.array instanceof Uint32Array||indices.array instanceof Uint8Array))){
   try{plan=ui.foliage_plan(positions.array.subarray(0,positions.count*3),indices?new Uint32Array(indices.array.subarray(0,indices.count)):new Uint32Array(),new Float64Array(mesh.matrixWorld.elements),!!indices)}catch{}
  }
  if(plan&&(!Number.isSafeInteger(plan[0])||plan[0]!==positions.count||!Number.isSafeInteger(plan[1])||plan[1]<0||plan.length!==2+plan[0]*2+plan[1]*3))plan=null;
  if(!plan){const result=legacy({traverse:visit=>visit(mesh)});paths.push(result.path);triangles+=result.triangles;return;}
  const vertices=plan[0],count=plan[1],labels=[],from=2+vertices*2;
  const label=index=>labels[index]??=(plan[2+index*2].toFixed(2)+','+(-plan[3+index*2]).toFixed(2));
  for(let index=0;index<count;index++){const at=from+index*3;paths.push('M'+label(plan[at])+'L'+label(plan[at+1])+'L'+label(plan[at+2])+'Z');}
  triangles+=count;
 });return{path:paths.join(''),triangles};
}
