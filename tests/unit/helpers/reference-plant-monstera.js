import * as THREE from 'three';
import {subdivideSurface} from './reference-plant-subdivide.js';
export function monsteraBase() {
  // Cordate base, rounded lobes and deep curved slits. Two pairs of closed
  // fenestrations are actual holes through both surfaces of the lamina.
  const shape = new THREE.Shape();
  shape.moveTo(0,.12);
  shape.bezierCurveTo(-.14,-.02,-.45,.005,-.50,.19);
  shape.quadraticCurveTo(-.55,.28,-.50,.37);
  shape.bezierCurveTo(-.43,.37,-.30,.31,-.22,.33);
  shape.quadraticCurveTo(-.27,.40,-.46,.45);
  shape.quadraticCurveTo(-.47,.50,-.42,.57);
  shape.bezierCurveTo(-.32,.57,-.18,.49,-.13,.53);
  shape.quadraticCurveTo(-.22,.63,-.35,.66);
  shape.quadraticCurveTo(-.31,.72,-.27,.78);
  shape.quadraticCurveTo(-.17,.70,-.10,.66);
  shape.quadraticCurveTo(-.14,.78,-.22,.85);
  shape.quadraticCurveTo(-.10,.94,0,1);
  shape.quadraticCurveTo(.10,.94,.22,.85);
  shape.quadraticCurveTo(.14,.78,.10,.66);
  shape.quadraticCurveTo(.17,.70,.27,.78);
  shape.quadraticCurveTo(.31,.72,.35,.66);
  shape.quadraticCurveTo(.22,.63,.13,.53);
  shape.bezierCurveTo(.18,.49,.32,.57,.42,.57);
  shape.quadraticCurveTo(.47,.50,.46,.45);
  shape.quadraticCurveTo(.27,.40,.22,.33);
  shape.bezierCurveTo(.30,.31,.43,.37,.50,.37);
  shape.quadraticCurveTo(.55,.28,.50,.19);
  shape.bezierCurveTo(.45,.005,.14,-.02,0,.12);
  for (const side of [-1,1]) for (const [x,y,rx,ry] of [[.19,.24,.042,.065],[.095,.43,.030,.062]]) {
    const hole = new THREE.Path(); hole.absellipse(side*x,y,rx,ry,0,Math.PI*2,true,side*-.30); shape.holes.push(hole);
  }
  return subdivideSurface(new THREE.ShapeGeometry(shape,5));
}
export function monsteraLeafGeometry(length,width,curve,random) {
  // Cordate base, rounded lobes and deep curved slits. Two pairs of closed
  // fenestrations are actual holes through both surfaces of the lamina.
  const shape = new THREE.Shape();
  shape.moveTo(0,.12);
  shape.bezierCurveTo(-.14,-.02,-.45,.005,-.50,.19);
  shape.quadraticCurveTo(-.55,.28,-.50,.37);
  shape.bezierCurveTo(-.43,.37,-.30,.31,-.22,.33);
  shape.quadraticCurveTo(-.27,.40,-.46,.45);
  shape.quadraticCurveTo(-.47,.50,-.42,.57);
  shape.bezierCurveTo(-.32,.57,-.18,.49,-.13,.53);
  shape.quadraticCurveTo(-.22,.63,-.35,.66);
  shape.quadraticCurveTo(-.31,.72,-.27,.78);
  shape.quadraticCurveTo(-.17,.70,-.10,.66);
  shape.quadraticCurveTo(-.14,.78,-.22,.85);
  shape.quadraticCurveTo(-.10,.94,0,1);
  shape.quadraticCurveTo(.10,.94,.22,.85);
  shape.quadraticCurveTo(.14,.78,.10,.66);
  shape.quadraticCurveTo(.17,.70,.27,.78);
  shape.quadraticCurveTo(.31,.72,.35,.66);
  shape.quadraticCurveTo(.22,.63,.13,.53);
  shape.bezierCurveTo(.18,.49,.32,.57,.42,.57);
  shape.quadraticCurveTo(.47,.50,.46,.45);
  shape.quadraticCurveTo(.27,.40,.22,.33);
  shape.bezierCurveTo(.30,.31,.43,.37,.50,.37);
  shape.quadraticCurveTo(.55,.28,.50,.19);
  shape.bezierCurveTo(.45,.005,.14,-.02,0,.12);
  for (const side of [-1,1]) for (const [x,y,rx,ry] of [[.19,.24,.042,.065],[.095,.43,.030,.062]]) {
    const hole = new THREE.Path(); hole.absellipse(side*x,y,rx,ry,0,Math.PI*2,true,side*-.30); shape.holes.push(hole);
  }
  const surface = subdivideSurface(new THREE.ShapeGeometry(shape,5)), source = surface.attributes.position, count = source.count;
  const positions = [], uv = [], colors = [], indices = [], edges = new Map(), tint = random()*.035, twist = (random()-.5)*.16, hue = (random()-.5)*.07;
  for (let side = 0; side < 2; side++) for (let i = 0; i < count; i++) {
    const x = source.getX(i), y = source.getY(i);
    positions.push(x*width*(1+twist*Math.sign(x)),(y-.12)*length,Math.sin(y*Math.PI)*length*curve + x*x*width*.15 + x*width*twist*y - side*width*.009);
    uv.push(.5+x,y); colors.push(.85+tint+side*.04+hue*.8,.93+tint+side*.025+hue*.15,.81+tint+side*.055-hue*.5);
  }
  const edge = (a,b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edges.has(key)) edges.delete(key); else edges.set(key,[a,b]);
  };
  const src = surface.index.array;
  for (let i = 0; i < src.length; i += 3) {
    const a = src[i],b = src[i+1],c = src[i+2];
    indices.push(a,b,c,a+count,c+count,b+count); edge(a,b); edge(b,c); edge(c,a);
  }
  for (const [a,b] of edges.values()) indices.push(a,a+count,b+count,a,b+count,b);
  surface.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.userData.fenestrations = 4;
  return geometry;
}
