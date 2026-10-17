// @vitest-environment node
import {expect,it} from 'vitest'
import * as THREE from 'three'
import {rustShelf as rust} from './helpers/rust-shelf-ready.js'
const polygon=text=>text.slice(8,-1).split(',').map(p=>p.match(/-?\d+(?:\.\d+)?/g).map(Number))
function inside(points,x,y){let result=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
 const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result
}return result}
function lamp(){const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.CylinderGeometry(40,40,120,32),new THREE.MeshBasicMaterial());group.add(mesh);group.position.set(200,-200,0);group.rotation.set(.24,-.5,0);group.updateMatrixWorld(true);return group}
it('keeps the round lamp clickable and releases the empty corner over a neighbouring cover',()=>{
 const group=lamp(),points=polygon(rust.scene_lamp_hit_hull(group,0,0));
 expect(inside(points,200,200)).toBe(true)
 const minX=Math.min(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1]));
 expect(inside(points,minX+1,minY+1)).toBe(false)
 expect(inside(points,200,minY+3)).toBe(true)
 const local=polygon(rust.scene_lamp_hit_hull(group,200,200));expect(inside(local,0,0)).toBe(true)
 group.children[0].geometry.dispose();group.children[0].material.dispose()
})
it('ignores hidden geometry, returns an empty fallback for missing meshes, and releases all handles',()=>{
 const group=lamp(),hidden=new THREE.Mesh(new THREE.BoxGeometry(10000,10000,10000));hidden.visible=false;group.add(hidden);group.updateMatrixWorld(true)
 const before=rust.shelf_live_handles()
 for(let i=0;i<200;i++){
  const points=polygon(rust.scene_lamp_hit_hull(group,0,0));expect(Math.max(...points.map(p=>p[0]))).toBeLessThan(250)
 }
 expect(rust.shelf_live_handles()).toBe(before)
 expect(rust.scene_lamp_hit_hull({},0,0)).toBe('');expect(rust.scene_lamp_hit_hull(group,NaN,0)).toBe('')
 for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose()}
})
