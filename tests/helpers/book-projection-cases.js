export function makeCases(THREE){
 let seed=221;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),cases=[]
 for(let i=0;i<800;i++){
  const width=[390,393,844,1280][i%4],height=[844,845,390,900][i%4]
  const camera=i%3===0?new THREE.PerspectiveCamera(40+i%25,width/height,.1,10000):new THREE.OrthographicCamera(-width/2,width/2,height/2,-height/2,.1,10000)
  camera.position.set((random()-.5)*20,(random()-.5)*20,500+random()*2500);camera.rotation.set((random()-.5)*.3,(random()-.5)*.3,(random()-.5)*.1);camera.updateMatrixWorld(true)
  const model=new THREE.Group();model.position.set((random()-.5)*600,(random()-.5)*700,(random()-.5)*500);model.rotation.set(random(),random()*3,random()*.2);model.scale.set(0.1+random()*5,0.1+random()*3,0.1+random()*2)
  for(let j=0;j<i%25;j++){
   const geometry=new THREE.BoxGeometry(3+random()*40,40+random()*240,1+random()*10),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material)
   mesh.position.set((random()-.5)*200,(random()-.5)*100,(random()-.5)*30);mesh.rotation.set(random()*.2,random()*2,random()*.2)
   if(j%9===0&&i%5===0)mesh.visible=false
   if(j%7===0&&i%6===0)material.visible=false
   if(j%6===0&&i%7===0)mesh.material=[null,material]
   model.add(mesh)
  }
  model.updateMatrixWorld(true);cases.push({model,camera,width,height})
 }
 // Every IEEE exceptional value follows the original renderer's full-frame
 // fallback, including signed zero and singular perspective matrices.
 for(const value of [NaN,Infinity,-Infinity,0,-0]){
  const model=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);geometry.computeBoundingBox();geometry.boundingBox.min.x=value;model.add(mesh);model.updateMatrixWorld(true)
  const camera=new THREE.OrthographicCamera(-195,195,422,-422,.1,10000);camera.position.z=3000;camera.updateMatrixWorld(true);cases.push({model,camera,width:390,height:844})
 }
 const last=cases.at(-1),large=new THREE.Group()
 for(let i=0;i<512;i++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,200,4),new THREE.MeshBasicMaterial());mesh.position.x=i;large.add(mesh)}
 large.updateMatrixWorld(true);cases.push({...last,model:large})
 return cases
}
