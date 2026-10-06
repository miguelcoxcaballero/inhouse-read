import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { lampTint, normalizeLampKelvin, tintColor } from './lamp-kelvin.js';
import { addShelfBakeSource, savedSurface, scheduleShelfBakeWrite } from './shelf-bake-cache.js';

const UP = new THREE.Vector3(0,1,0);
const clamp = value => Math.min(1,Math.max(0,value));
const imageCache = new Map();
// Surfaces of this session's shelf lamps are saved for the next launch.
const shelfSurfaces = new Set();
let building = null;
addShelfBakeSource({ settled:() => Promise.resolve(), collect:() => ({ surfaces:[...shelfSurfaces]
  .filter(key => imageCache.has(key)).map(key => [`lamp:${key}`, imageCache.get(key)]) }) });

// Surfaces remain sharp at finger-zoom distances. Only immutable CPU texels
// are cached: a fixture owns, and releases, all of its GPU textures.
function surface(kind, quality) {
  const detail = quality === 'low' ? 1 : 2;
  const width = kind === 'wood' ? 128 * detail : 256 * detail;
  const height = kind === 'wood' ? 512 * detail : width;
  const key = `${kind}:${detail}`;
  building?.add(key);
  let bytes = imageCache.get(key);
  if (!bytes && (bytes = savedSurface(`lamp:${key}`, width, height))) imageCache.set(key, bytes);
  if (!bytes) {
    const pigment = new Uint8Array(width * height * 4), data = new Uint8Array(pigment.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height, index = (y * width + x) * 4;
      const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1;
      let colour, relief, roughness;
      if (kind === 'wood') {
        const warp = Math.sin(v * 13 + u * 7) * .013 + Math.sin(v * 47) * .004;
        const fibre = Math.sin((u + warp) * Math.PI * 72);
        const grain = Math.sin((u + warp) * Math.PI * 17) * .045 + fibre * .025 + noise * .012;
        const pore = Math.max(0,fibre - .87) * .13;
        colour = [.73 + grain - pore,.55 + grain * .84 - pore,.34 + grain * .62 - pore];
        relief = .5 + fibre * .17; roughness = .63 + noise * .045;
      } else if (kind === 'linen') {
        const threadX = Math.cos(u * Math.PI * 160), threadY = Math.cos(v * Math.PI * 160);
        const weave = threadX * threadY * .025 + (threadX + threadY) * .012;
        const slub = Math.sin(u * 105 + Math.sin(v * 19)) * .01;
        colour = [.92 + weave + slub,.862 + weave + slub,.745 + weave + slub];
        relief = .5 + (threadX + threadY) * .18 + noise * .025;
        roughness = .9 + noise * .025;
      } else {
        const grain = noise * .012;
        colour = [.087 + grain,.091 + grain,.09 + grain];
        relief = .5 + noise * .035; roughness = .42 + noise * .055;
      }
      for (let channel = 0; channel < 3; channel++) pigment[index + channel] = Math.round(clamp(colour[channel]) * 255);
      pigment[index + 3] = data[index + 3] = 255;
      data[index] = Math.round(clamp(relief) * 255); data[index + 1] = Math.round(clamp(roughness) * 255);
    }
    bytes = { width,height,pigment,data }; imageCache.set(key,bytes);
  }
  const texture = (data,colorSpace) => {
    const map = new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
    map.colorSpace = colorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter; map.anisotropy = 4; map.needsUpdate = true;
    return map;
  };
  return { map:texture(bytes.pigment,THREE.SRGBColorSpace),data:texture(bytes.data,THREE.NoColorSpace) };
}

function materialWithSurface(kind,quality,options) {
  const maps = surface(kind,quality);
  return new THREE.MeshPhysicalMaterial({ ...options,map:maps.map,bumpMap:maps.data,
    roughnessMap:maps.data,bumpScale:kind === 'wood' ? .16 : kind === 'linen' ? .22 : .045 });
}

function lathe(profile,segments) {
  return new THREE.LatheGeometry(profile.map(([radius,y]) => new THREE.Vector2(radius,y)),segments);
}

/** Bake transforms and combine parts that use one material into one draw. */
function addBatch(group,name,material,parts,{castShadow=true,receiveShadow=true}={}) {
  const geometries = parts.map(({geometry,position=[0,0,0],rotation=[0,0,0]}) => {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1));
    geometry.applyMatrix4(matrix); return geometry;
  });
  const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries,false);
  if (geometries.length > 1) for (const source of geometries) source.dispose();
  const mesh = new THREE.Mesh(geometry,material); mesh.name = name;
  mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
  group.add(mesh); return mesh;
}

function tube(points,radius,segments=36,radialSegments=6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))),segments,radius,radialSegments,false);
}

// Clear glass is composited, not refracted. three's transmission re-renders
// the whole opaque room into a second buffer, with a second set of shader
// programs, on every frame the lamp is in view. A thin wall refracts almost
// nothing, so the same look is a blend over the room already drawn:
// reflections (specular, clearcoat, environment) added at full strength
// and the room behind seen through the glass's tint and Fresnel loss, as
// transmission computes them. Both faces are drawn: a closed body shows two
// walls (near and far), so each layer passes the square root of the light
// that the pair lets through, the two layers transmission also gave.
// `grazing` darkens the longer optical path at a grazing angle.
function glass(colour,{roughness=.055,clearcoatRoughness=.025,envMapIntensity=1.15,grazing=false,key}) {
  const material = new THREE.MeshPhysicalMaterial({ color:colour,roughness,metalness:0,ior:1.46,
    clearcoat:1,clearcoatRoughness,envMapIntensity,side:THREE.DoubleSide,depthWrite:false,transparent:true,
    blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor });
  const tint = (material.color.r + material.color.g + material.color.b) / 3;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',`
      #include <lights_fragment_end>
      reflectedLight.directDiffuse = vec3(0.0);
      reflectedLight.indirectDiffuse = vec3(0.0);`).replace('#include <opaque_fragment>',`
      vec3 glassView = normalize(vViewPosition);
      vec3 glassFresnel = EnvironmentBRDF(normal,glassView,material.specularColor,material.specularF90,material.roughness);
      float glassSeen = ${tint.toFixed(4)} * (1.0 - (glassFresnel.r + glassFresnel.g + glassFresnel.b) / 3.0) * (1.0 - Fcc.r);
      ${grazing ? `vec3 glassPath = mix(vec3(1.0),vec3(.74,.80,.82),pow(1.0 - abs(dot(normal,glassView)),2.5));
      outgoingLight *= glassPath;
      glassSeen *= (glassPath.r + glassPath.g + glassPath.b) / 3.0;` : ''}
      diffuseColor.a = 1.0 - sqrt(glassSeen);
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

function puck(group,quality,segments) {
  const metal = new THREE.MeshPhysicalMaterial({ color:0xc8cbcd,metalness:.91,roughness:.3,
    clearcoat:.15,clearcoatRoughness:.3 });
  addBatch(group,'lamp-housing',metal,[{geometry:lathe([
    [0,0],[30.5,0],[32.8,-.6],[34,-2],[34,-8],[33.2,-10.3],[31.8,-11],
    [28.4,-11],[27.5,-10.1],[27.5,-8.8],[29.2,-8.8],[30,-1.8],[0,-1.8]
  ],segments)}]);
  const opal = new THREE.MeshPhysicalMaterial({color:0xffe7ca,roughness:.72,metalness:0,
    emissive:0xffd3a0,emissiveIntensity:2.3,clearcoat:.12,side:THREE.DoubleSide});
  addBatch(group,'warm-opal-diffuser',opal,[{geometry:lathe([[0,-10.5],[25.8,-10.5],[27.5,-10.1],[27.5,-9.2],[0,-9.2]],segments)}],{castShadow:false});
  const cable = new THREE.MeshStandardMaterial({color:0xd4d0c7,roughness:.85});
  addBatch(group,'puck-power-lead',cable,[{geometry:tube([[0,-2,-30],[0,-2,-33],[0,-1.5,-33.2]],.6,8)}]);
  // The cut-off must extend beyond the adjacent board: Three's smooth
  // distance window otherwise nearly extinguishes a 440 mm cone before it
  // reaches a BAGGEBO shelf, even though the diffuser itself looks bright.
  return {position:[0,-12,0],colour:0xffd3a0,range:700,intensity:392000,
    direction:[0,-1,0],angle:Math.PI * .38,penumbra:.65};
}

function lantern(group,quality,segments) {
  const black = materialWithSurface('black',quality,{color:0xffffff,metalness:.68,roughness:1,
    clearcoat:.28,clearcoatRoughness:.35});
  addBatch(group,'lamp-base',black,[{geometry:lathe([
    [0,0],[58,0],[67,1.5],[72,5],[74.5,10],[75,18],[75,43],[74,48],
    [70,54],[59,61],[43,72],[35,78],[34,84],[34,91],[31,93],[0,93]
  ],segments)}]);
  const brass = new THREE.MeshPhysicalMaterial({color:0xbca170,metalness:1,roughness:.27,
    clearcoat:.2,clearcoatRoughness:.25});
  const brassParts = [
    {geometry:lathe([[30,88],[38,88],[40,90],[40,93],[37,95],[30,95],[30,88]],segments)},
    {geometry:lathe([[0,92],[11,92],[12,94],[12,104],[10.7,106],[0,106]],32)},
    {geometry:new THREE.CylinderGeometry(3.6,3.6,14,20),position:[20,80,34],rotation:[Math.PI / 2,0,0]},
    {geometry:new THREE.CylinderGeometry(8.2,8.2,5,40),position:[20,80,42],rotation:[Math.PI / 2,0,0]},
    {geometry:new THREE.TorusGeometry(7.85,.6,6,48),position:[20,80,44.8]},
    {geometry:new THREE.CylinderGeometry(1.3,1.3,1,12),position:[20,80,45],rotation:[Math.PI / 2,0,0]}
  ];
  for (let notch = 0; notch < 48; notch++) {
    const angle = notch / 48 * Math.PI * 2;
    brassParts.push({geometry:new THREE.BoxGeometry(.28,.65,2.9),
      position:[20 + Math.cos(angle) * 8.16,80 + Math.sin(angle) * 8.16,43],rotation:[0,0,angle]});
  }
  addBatch(group,'brass-collar-and-machined-dimmer',brass,brassParts);
  const chimney = [
    [37,94],[43,96],[49,103],[52.5,116],[54,135],[54,185],[53,204],[50,215],
    [43,227],[33,238],[29,243],[29,248],[30,250],[28.2,250],[27.2,248],[27.3,243],
    [31.3,237],[41.5,226],[48.5,214],[51.3,203],[52.3,185],[52.3,135],
    [50.8,117],[47.4,104],[41.5,98],[37,96],[37,94]
  ];
  // Thin clear walls need slightly more absorption at a grazing angle, where
  // the optical path is longer. This also retains the rolled silhouette on
  // the catalogue's white background without drawing an artificial outline.
  const chimneyMaterial = glass(0xeaf0f1,{grazing:true,key:'shelf-chimney-optical-path'});
  addBatch(group,'clear-glass-chimney',chimneyMaterial,[{geometry:lathe(chimney,segments)}],{castShadow:false});
  const rimMaterial = glass(0xe2e8e8,{roughness:.03,clearcoatRoughness:0,envMapIntensity:1,key:'shelf-glass-rim'});
  addBatch(group,'rolled-glass-rim',rimMaterial,[{geometry:new THREE.TorusGeometry(28.7,.9,6,segments),
    position:[0,249,0],rotation:[Math.PI / 2,0,0]}],{castShadow:false});
  // A second transmissive volume inside the chimney samples Three's same
  // opaque buffer, which erases the coloured bulb. Composite its thin amber
  // coating after the refractive chimney instead; the front wall keeps real
  // physical reflections while the four filaments remain visible behind it.
  const amber = new THREE.MeshPhysicalMaterial({color:0xc48330,roughness:.095,metalness:0,
    transparent:true,opacity:.3,transmission:0,depthWrite:false,side:THREE.FrontSide,
    clearcoat:.8,clearcoatRoughness:.08,ior:1.46,envMapIntensity:.6});
  const bulb = addBatch(group,'amber-candle-led-bulb',amber,[{geometry:lathe([
    [0,105],[9,105],[12,109],[15.5,122],[17,135],[15.7,149],[12.5,166],
    [8,180],[3.5,188],[0,191]
  ],48)}],{castShadow:false});
  bulb.renderOrder = 2;
  const support = new THREE.MeshBasicMaterial({color:0x514b39,toneMapped:true});
  const supportParts = [{geometry:new THREE.CylinderGeometry(.55,.55,57,6),position:[0,138,0]}];
  for (let index = 0; index < 4; index++) {
    const angle = index / 4 * Math.PI * 2 + Math.PI / 8;
    supportParts.push({geometry:tube([[0,109,0],[Math.cos(angle) * 7,114,Math.sin(angle) * 7],
      [Math.cos(angle) * 7,161,Math.sin(angle) * 7],[0,163,0]],.3,16,4)});
  }
  addBatch(group,'led-filament-support',support,supportParts,{castShadow:false});
  const filament = new THREE.MeshStandardMaterial({color:0x71501f,roughness:.78,
    emissive:0xffd6a2,emissiveIntensity:4.5,toneMapped:true});
  // The scene's filament surfaces illuminate the room. They must not
  // illuminate its own microscopic emitters a second time at zero distance.
  filament.onBeforeCompile = shader => {
    // A phosphor strand has a bright warm centre and an amber round edge.
    // The normal gives that profile around each of the four tubes without
    // another translucent shell or a fullscreen glow pass. Keeping the
    // centre narrow makes the individual fibres legible through the glass.
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',`
      #include <emissivemap_fragment>
      float filamentFacing = clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0);
      float filamentCore = pow(filamentFacing,4.0);
      totalEmissiveRadiance *= mix(vec3(.65,.37,.09),vec3(1.2,1.16,1.07),filamentCore);
    `).replace('#include <lights_fragment_end>',`
      #include <lights_fragment_end>
      reflectedLight.directDiffuse = vec3(0.0);
      reflectedLight.directSpecular = vec3(0.0);`);
  };
  filament.customProgramCacheKey = () => 'shelf-phosphor-filament-core';
  const filaments = [], emitters = [];
  for (let index = 0; index < 4; index++) {
    const angle = index / 4 * Math.PI * 2 + Math.PI / 8;
    const path = [[Math.cos(angle) * 7,116,Math.sin(angle) * 7],
      [Math.cos(angle) * 7.8,140,Math.sin(angle) * 7.8],[Math.cos(angle) * 6.8,161,Math.sin(angle) * 6.8]];
    filaments.push({geometry:tube(path,1.05,16,6)});
    emitters.push({ start:path[0], end:path[2], width:2.1,
      normal:[Math.cos(angle),0,Math.sin(angle)] });
  }
  addBatch(group,'glowing-retro-led-filaments',filament,filaments,{castShadow:false});
  const cord = new THREE.MeshStandardMaterial({color:0x242626,roughness:.97});
  addBatch(group,'black-braided-power-cord',cord,[{geometry:tube([[0,10,-68],[0,7,-71],
    [5,3,-73],[12,1.8,-73.1],[20,1.8,-71]],1.4,24)}]);
  // These emitting strips occupy the actual phosphor tubes. Their length
  // supplies continuous illumination and elongated specular reflections,
  // rather than a bright point floating in the empty centre of the bulb.
  return {position:[0,143,0],colour:0xffc889,range:700,intensity:196000,filaments:emitters};
}

function tripod(group,quality,segments) {
  const wood = materialWithSurface('wood',quality,{color:0xffffff,metalness:0,roughness:1,
    clearcoat:.12,clearcoatRoughness:.65});
  const legParts = [];
  for (let index = 0; index < 3; index++) {
    const angle = index / 3 * Math.PI * 2 + Math.PI / 6;
    const foot = new THREE.Vector3(Math.cos(angle) * 66,4,Math.sin(angle) * 66);
    const shoulder = new THREE.Vector3(Math.cos(angle) * 22,177,Math.sin(angle) * 22);
    const geometry = new RoundedBoxGeometry(13,foot.distanceTo(shoulder),9,2,1.1);
    const orientation = new THREE.Quaternion().setFromUnitVectors(UP,shoulder.clone().sub(foot).normalize());
    // Width runs tangentially, so each leg reads as a flat plank, as in the photo.
    orientation.multiply(new THREE.Quaternion().setFromAxisAngle(UP,-angle));
    geometry.applyQuaternion(orientation); geometry.translate(...foot.clone().add(shoulder).multiplyScalar(.5).toArray());
    legParts.push({geometry});
  }
  legParts.push({geometry:new RoundedBoxGeometry(36,12,36,2,2),position:[0,167,0]});
  const feet = addBatch(group,'lamp-base',wood,legParts);
  feet.geometry.computeBoundingBox();
  // Trim the tiny rounded toe below the support plane, avoiding a floating
  // lamp or legs that protrude through the thin BAGGEBO mesh shelf.
  const vertices = feet.geometry.attributes.position;
  for (let index = 0; index < vertices.count; index++)
    if (vertices.getY(index) < 0) vertices.setY(index,0);
  vertices.needsUpdate = true; feet.geometry.computeVertexNormals();
  feet.geometry.computeBoundingBox();
  feet.geometry.translate(0,-feet.geometry.boundingBox.min.y,0);
  const fitting = new THREE.MeshStandardMaterial({color:0xd2c9b8,metalness:.65,roughness:.39});
  const fittingParts = [
    {geometry:new THREE.CylinderGeometry(8,8,27,20),position:[0,182,0]},
    {geometry:new THREE.TorusGeometry(87.8,.9,6,segments),position:[0,175,0],rotation:[Math.PI / 2,0,0]},
    {geometry:new THREE.TorusGeometry(87.8,.9,6,segments),position:[0,279,0],rotation:[Math.PI / 2,0,0]}
  ];
  for (let index = 0; index < 3; index++) {
    const angle = index / 3 * Math.PI * 2;
    fittingParts.push({geometry:tube([[0,193,0],[Math.cos(angle) * 40,185,Math.sin(angle) * 40],
      [Math.cos(angle) * 87,177,Math.sin(angle) * 87]],.55,12,4)});
  }
  addBatch(group,'shade-support-and-rims',fitting,fittingParts);
  const linen = materialWithSurface('linen',quality,{color:0xffffff,roughness:1,metalness:0,
    side:THREE.DoubleSide,emissive:0xffc982,emissiveIntensity:1});
  linen.emissiveMap = linen.map;
  linen.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',`
      #include <emissivemap_fragment>
      float clothBounce = pow(max(0.0,sin(vMapUv.y * 3.14159265359)),.65);
      totalEmissiveRadiance *= .28 + .72 * clothBounce;`);
  };
  linen.customProgramCacheKey = () => 'shelf-linen-warm-centre';
  addBatch(group,'woven-linen-drum-shade',linen,[{geometry:new THREE.CylinderGeometry(90,90,105,segments,1,true),
    position:[0,227.5,0]}]);
  const binding = new THREE.MeshStandardMaterial({color:0xded4bf,roughness:.92,
    emissive:0xffd7ac,emissiveIntensity:.12});
  addBatch(group,'linen-bound-shade-edges',binding,[
    {geometry:lathe([[88.6,175],[90,175],[90,177],[88.6,177],[88.6,175]],segments)},
    {geometry:lathe([[88.6,278],[90,278],[90,280],[88.6,280],[88.6,278]],segments)},
    {geometry:new THREE.CylinderGeometry(87.8,87.8,.5,segments,1,true),position:[0,228,0]}
  ]);
  const bulb = new THREE.MeshStandardMaterial({color:0xffead2,roughness:.55,
    emissive:0xffd39b,emissiveIntensity:1.8});
  addBatch(group,'warm-shaded-led-bulb',bulb,[{geometry:lathe([
    [0,195],[7,195],[7,201],[13,205],[19,215],[21,227],[17,239],[9,246],[0,249]
  ],32)}],{castShadow:false});
  const cable = new THREE.MeshStandardMaterial({color:0xe3ddce,roughness:.83});
  const cord = addBatch(group,'ivory-fabric-power-cord',cable,[{geometry:tube([[0,170,0],[0,150,-6],
    [8,91,-27],[13,56,-37],[15,34,-48],[21,13,-55],[32,1.4,-53],[44,1.4,-45]],1.1,48)}]);
  cord.geometry.computeBoundingBox();
  if (cord.geometry.boundingBox.min.y < 0) cord.geometry.translate(0,.2 - cord.geometry.boundingBox.min.y,0);
  // Approximate the shade's lower aperture with a virtual downward emitter
  // below the opaque central support. Putting it at the physical bulb made
  // the support shadow extinguish the centre of the entire light pool.
  // The three legs still cast their proper shadows around the warm pool.
  return {position:[0,158,0],colour:0xffd4a5,range:750,intensity:281250,
    direction:[0,-1,0],angle:Math.PI * .43,penumbra:.75};
}

/**
 * Centred x/z. Standing fixtures start at y=0 and extend up; the puck's
 * mounting face is y=0 and its body extends down. Width and optional maximum
 * height fit uniformly, preserving the shape instead of stretching it.
 * Emissive meshes belong here; budgeted real lights belong to the scene.
 */
export function createShelfLamp({lampId='tarnaby',width=null,height=null,quality='high',isOn=true,persist=false,kelvin}={}) {
  const lamp = getCatalogLamp(lampId) || getCatalogLamp('tarnaby');
  const native = lamp.dimensions;
  const widthScale = Number.isFinite(width) && width > 0 ? width / native.width : 1;
  const heightScale = Number.isFinite(height) && height > 0 ? height / native.height : Infinity;
  const scale = Math.min(widthScale,heightScale);
  const group = new THREE.Group(); group.name = `shelf-lamp-${lamp.id}`;
  const segments = quality === 'low' ? 40 : 72;
  const used = building = persist ? new Set() : null;
  let emitter;
  try { emitter = (lamp.id === 'mittled' ? puck : lamp.id === 'tripod' ? tripod : lantern)(group,quality,segments); }
  finally { building = null; }
  if (used?.size) { for (const key of used) shelfSurfaces.add(key); scheduleShelfBakeWrite(); }
  // Bake the uniform fit into vertices. Emitter metadata is genuinely local
  // to the returned root; localToWorld must not apply the size twice.
  const fittedMaterials = new Set();
  group.traverse(object => {
    if (object.geometry) object.geometry.scale(scale,scale,scale);
    if (object.material) fittedMaterials.add(object.material);
  });
  for (const material of fittedMaterials) {
    if (material.bumpScale) material.bumpScale *= scale;
    if (material.thickness) material.thickness *= scale;
    if (Number.isFinite(material.attenuationDistance)) material.attenuationDistance *= scale;
  }
  const range = emitter.range * scale;
  group.userData = {
    lampId:lamp.id,mount:lamp.mount,width:native.width * scale,
    height:native.height * scale,depth:native.depth * scale,warmKelvin:lamp.warmKelvin,
    lightEmitter:{ position:emitter.position.map(value => value * scale),color:emitter.colour,
      ...(emitter.filaments ? { filaments:emitter.filaments.map(strip => ({
        start:strip.start.map(value => value * scale), end:strip.end.map(value => value * scale),
        width:strip.width * scale, normal:strip.normal })) } : {}),
      // World units are millimetres before fitting. Inverse-square lights
      // need intensity to follow the same squared fit, preserving their
      // irradiance on books and boards when the screen or zoom changes.
      intensity:emitter.intensity * scale * scale,distance:range,decay:2,power:1,
      ...(emitter.direction ? {direction:emitter.direction,angle:emitter.angle,penumbra:emitter.penumbra} : {}) }
  };
  // Store the original radiance once. Animation scales it absolutely rather
  // than multiplying the previous frame, and never allocates GPU resources.
  // Non-emitting physical materials, maps and refraction stay unchanged.
  const emittingMaterials = [...fittedMaterials]
    .filter(material => material.emissive?.getHex() && Number.isFinite(material.emissiveIntensity))
    .map(material => ({material,intensity:material.emissiveIntensity}));
  group.userData.setPower = power => {
    const value = clamp(Number.isFinite(power) ? power : 0);
    for (const {material,intensity} of emittingMaterials) material.emissiveIntensity = intensity * value;
    group.userData.lightEmitter.power = value;
    return value;
  };
  group.userData.setPower(isOn === false ? 0 : 1);
  // Colour temperature: the emitting materials' and the light's own colours
  // are multiplied by a tint (1 at the default). Only uniforms change.
  const glowing = emittingMaterials.map(({material}) => ({material,base:material.emissive.clone()}));
  group.userData.setTint = tint => {
    for (const {material,base} of glowing) tintColor(material.emissive.copy(base),tint);
    group.userData.lightEmitter.tint = tint[0] === 1 && tint[1] === 1 && tint[2] === 1 ? undefined : [...tint];
  };
  group.userData.setKelvin = value => { group.userData.kelvin = normalizeLampKelvin(value); group.userData.setTint(lampTint(value)); };
  group.userData.setKelvin(kelvin);
  let disposed = false;
  group.dispose = group.userData.dispose = () => {
    if (disposed) return; disposed = true;
    const geometries = new Set(),materials = new Set(),textures = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const resource of [...geometries,...materials,...textures]) resource.dispose();
  };
  return group;
}
