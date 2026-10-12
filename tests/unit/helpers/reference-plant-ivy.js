import * as THREE from 'three';
export function ivyLeafGeometry(length,width,curve,random) {
  // Five broad lobes with shallow sinuses and a notched, cordate base form the
  // real silhouette rather than an alpha card. A centre fan and one middle
  // ring cup the thin blade; it is a single double-sided sheet, which reads
  // the same on the shelf and leaves budget for a much fuller plant.
  const outline = [[0,.05],[-.14,-.01],[-.30,.10],[-.50,.30],[-.37,.43],[-.45,.63],[-.19,.66],[0,1],[.19,.66],[.45,.63],[.37,.43],[.50,.30],[.30,.10],[.14,-.01]];
  const positions = [], uv = [], colors = [], indices = [], segments = outline.length;
  const center = new THREE.Vector3(0,length*.44,length*curve*.75), tint = random()*.045, asymmetry = (random()-.5)*.12, hue = (random()-.5)*.08;
  const vertex = (x, y, f) => {
    const px = x*width*f*(1+asymmetry*Math.sign(x)), py = center.y + (y*length-center.y)*f;
    positions.push(px,py,center.z + Math.abs(x)*width*.055*f + Math.sin(y*Math.PI)*length*curve*.2*f);
    uv.push(.5+px/width,Math.max(0,py/length)); colors.push(.86+tint+hue*.8,.92+tint+hue*.15,.83+tint-hue*.5);
  };
  vertex(0, .44, 0);
  for (const f of [.5, 1]) for (const [x,y] of outline) vertex(x, y, f);
  for (let j = 0; j < segments; j++) {
    const next = (j+1)%segments, a = 1+j, b = 1+next, c = a+segments, d = b+segments;
    indices.push(0,b,a, a,b,d, a,d,c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
