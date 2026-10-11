// Exact whole-model descriptor and shared benchmark. The timed operation is
// createShelfPlant + disposal, with all preparation, copies and Three work.
const digest = async array => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new Uint8Array(array.buffer,array.byteOffset,array.byteLength)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function plantModelDescriptor(model) {
  const objects=[];model.traverse(object=>objects.push(object));
  return Promise.all(objects.map(async object=>({
    name:object.name,type:object.type,parent:objects.indexOf(object.parent),children:object.children.map(child=>objects.indexOf(child)),
    position:object.position.toArray(),quaternion:object.quaternion.toArray(),rotation:object.rotation.toArray(),
    scale:object.scale.toArray(),matrix:object.matrix.toArray(),matrixWorld:object.matrixWorld.toArray(),
    castShadow:object.castShadow,receiveShadow:object.receiveShadow,renderOrder:object.renderOrder,visible:object.visible,
    geometry:object.geometry?{type:object.geometry.type,groups:object.geometry.groups,userData:object.geometry.userData,
      fields:Object.fromEntries(await Promise.all(Object.entries({...object.geometry.attributes,index:object.geometry.index}).map(async([name,attribute])=>[name,
        attribute?{type:attribute.constructor.name,array:attribute.array.constructor.name,itemSize:attribute.itemSize,
          normalized:attribute.normalized,count:attribute.count,version:attribute.version,bytes:attribute.array.byteLength,sha256:await digest(attribute.array)}:null])))}:null,
    material:object.material?Object.fromEntries(['type','roughness','metalness','clearcoat','clearcoatRoughness','side','alphaTest','bumpScale','vertexColors','specularIntensity'].map(key=>[key,object.material[key]])):null,
  })));
}
const assertEqual=(a,b,message)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(message);};
const checksum=model=>{
  let sum=0;model.traverse(object=>{const p=object.geometry?.attributes.position?.array;
    if(p)sum+=p.length+p[0]+p[Math.floor(p.length/2)]+p[p.length-1];});return sum;
};
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
export async function benchmarkPlantModel({original,candidate,originalReady,candidateReady,entry,stats,expectedCalls}) {
  const samples={javascript:[],rust:[]},cold={},coldSettled={},coldCalls={},orders=[];
  let expectedDescriptor=null;
  // Each species' first build is measured honestly with the module's current
  // surface cache. Some pots are shared with earlier species. This is not a
  // fresh-process cold-launch claim; the report preserves those timings.
  for(const kind of ['javascript','rust']) {
    const create=kind==='rust'?candidate:original,ready=kind==='rust'?candidateReady:originalReady;
    const callsBefore=stats.calls,start=performance.now(),model=create(entry);
    cold[kind]=performance.now()-start;coldCalls[kind]=stats.calls-callsBefore;
    try {
      await ready();coldSettled[kind]=performance.now()-start;
      const descriptor=await plantModelDescriptor(model);
      if(expectedDescriptor)assertEqual(descriptor,expectedDescriptor,'Whole plant geometry or transform changed');
      else expectedDescriptor=descriptor;
    }finally{model.userData.dispose();}
  }
  assertEqual(coldCalls.javascript,0,'Frozen model unexpectedly called Rust');
  assertEqual(coldCalls.rust,expectedCalls,'Production model did not call the expected Rust leaf engine');
  if(stats.live!==0||stats.allocations!==stats.releases)throw new Error('Leaf arena leaked');
  const repetitions=2,warmups=2,rounds=9;
  const run=(kind,persist=false)=>{
    let sum=0;const create=kind==='rust'?candidate:original;
    for(let n=0;n<repetitions;n++){const model=create(entry,{persist});try{sum+=checksum(model);}finally{model.userData.dispose();}}
    return sum;
  };
  const expected=run('javascript');assertEqual(run('rust'),expected,'Whole plant checksum mismatch');
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  for(let index=0;index<warmups;index++) {assertEqual(run('javascript'),expected,'JS warmup mismatch');assertEqual(run('rust'),expected,'Rust warmup mismatch');await pause();}
  for(let round=0;round<rounds;round++) {
    const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order) {
      const start=performance.now(),sum=run(kind);samples[kind].push(performance.now()-start);
      assertEqual(sum,expected,'Timed whole model mismatch');await pause();
    }
  }
  // A real saved-bake control: only the seed build runs geometry. Every
  // timed restore must execute zero Rust kernels and retain exact arrays.
  for(const create of [original,candidate]){const model=create(entry,{persist:true});model.userData.dispose();}
  await Promise.all([originalReady(),candidateReady()]);
  const bakedSamples={javascript:[],rust:[]},bakedCallsBefore=stats.calls;
  for(let round=0;round<rounds;round++)for(const kind of round%2?['rust','javascript']:['javascript','rust']) {
    const start=performance.now(),sum=run(kind,true);bakedSamples[kind].push(performance.now()-start);
    assertEqual(sum,expected,'Baked whole model mismatch');await pause();
  }
  const restoredCalls=stats.calls-bakedCallsBefore;
  assertEqual(restoredCalls,0,'A restored bake reran leaf geometry');
  const final=candidate(entry);
  try{assertEqual(await plantModelDescriptor(final),expectedDescriptor,'Final plant descriptor changed');}finally{final.userData.dispose();}
  return {entry,expectedCalls,coldFirstSpeciesInSession:{synchronousMs:cold,settledSurfacesMs:coldSettled,calls:coldCalls},
    proof:expectedDescriptor,methodology:{repetitions,warmups,rounds,preparationIncluded:true,disposalIncluded:true,
      wholeCreateShelfPlant:true,surfacePainting:'Same original painter; awaited before warm rounds',restoreControl:true},
    samples,orders,javascriptPerModelMedianMs:median(samples.javascript)/repetitions,rustPerModelMedianMs:median(samples.rust)/repetitions,
    baked:{samples:bakedSamples,rustCalls:restoredCalls,javascriptPerModelMedianMs:median(bakedSamples.javascript)/repetitions,
      rustPerModelMedianMs:median(bakedSamples.rust)/repetitions},memory:{...stats}};
}
