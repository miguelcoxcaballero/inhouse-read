export function visibleBounds(model,camera,viewportWidth,viewportHeight,compactPoint){
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
       model.traverseVisible(mesh => {
        const material=mesh.material;
        if (!mesh.isMesh || !mesh.geometry || !material || (Array.isArray(material)
          ? !material.some(each=>each && each.visible !== false) : material.visible === false)) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox;
        if (!bounds) { left=top=NaN; return; }
        for (let xi=0;xi<2;xi++) for (let yi=0;yi<2;yi++) for (let zi=0;zi<2;zi++) {
          compactPoint.set(xi?bounds.max.x:bounds.min.x,yi?bounds.max.y:bounds.min.y,zi?bounds.max.z:bounds.min.z)
            .applyMatrix4(mesh.matrixWorld).project(camera);
          const px=(compactPoint.x+1)*viewportWidth/2, py=(1-compactPoint.y)*viewportHeight/2;
          left=Math.min(left,px); right=Math.max(right,px); top=Math.min(top,py); bottom=Math.max(bottom,py);
        }
      });
 return[left,top,right,bottom]
}
