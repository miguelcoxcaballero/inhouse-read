import * as THREE from 'three';
import {lampGeometrySpec} from './decor-geometry-spec.js';
import {rustLampSurface} from './lamp-surface-wasm.js';
import { needRustShelf } from './rust-shelf.js';
import { geometryOf, openPacket } from './geo-packet.js';
import { lampTint, normalizeLampKelvin, tintColor } from './lamp-kelvin.js';
import { addShelfBakeSource, savedSurface, scheduleShelfBakeWrite } from './shelf-bake-cache.js';

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
    // The decor core paints the three lamp surfaces; its refusal is an error, there is no second painter.
    bytes = rustLampSurface(kind,width,height);
    if (!bytes) throw new Error('Las texturas de la lámpara no se pudieron calcular. Recarga la página.');
    imageCache.set(key,bytes);
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

/** The geometry of a lamp. The Rust shelf module draws every part, bakes the parts of one material into one geometry
 * (the tripod's feet and cord trimmed to the shelf) and fits the lamp by `scale`, so the vertices arrive fitted
 * (rust-ui/src/lamp_model.rs); the emitter arrives fitted too. The host adds the materials. */
function lampGeometry(kind,segments,scale) {
  const packet = openPacket(needRustShelf().lamp_geometry(kind,segments,scale));
  const geometries = new Map(packet.header.batches.map(batch => {
    const geometry = geometryOf(packet,batch);
    if (batch.bounds) geometry.computeBoundingBox();
    return [batch.name,geometry];
  }));
  return { geometries,emitter:packet.header.emitter };
}

/** One mesh of the lamp: the named geometry with its material. */
function addBatch(group,name,material,lamp,{castShadow=true,receiveShadow=true}={}) {
  const mesh = new THREE.Mesh(lamp.geometries.get(name),material); mesh.name = name;
  mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
  group.add(mesh); return mesh;
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

function puck(group,quality,lamp) {
  const metal = new THREE.MeshPhysicalMaterial({ color:0xc8cbcd,metalness:.91,roughness:.3,
    clearcoat:.15,clearcoatRoughness:.3 });
  addBatch(group,'lamp-housing',metal,lamp);
  const opal = new THREE.MeshPhysicalMaterial({color:0xffe7ca,roughness:.72,metalness:0,
    emissive:0xffd3a0,emissiveIntensity:2.3,clearcoat:.12,side:THREE.DoubleSide});
  addBatch(group,'warm-opal-diffuser',opal,lamp,{castShadow:false});
  const cable = new THREE.MeshStandardMaterial({color:0xd4d0c7,roughness:.85});
  addBatch(group,'puck-power-lead',cable,lamp);
}

function lantern(group,quality,lamp) {
  const black = materialWithSurface('black',quality,{color:0xffffff,metalness:.68,roughness:1,
    clearcoat:.28,clearcoatRoughness:.35});
  addBatch(group,'lamp-base',black,lamp);
  const brass = new THREE.MeshPhysicalMaterial({color:0xbca170,metalness:1,roughness:.27,
    clearcoat:.2,clearcoatRoughness:.25});
  addBatch(group,'brass-collar-and-machined-dimmer',brass,lamp);
  // Thin clear walls need slightly more absorption at a grazing angle, where
  // the optical path is longer. This also retains the rolled silhouette on
  // the catalogue's white background without drawing an artificial outline.
  const chimneyMaterial = glass(0xeaf0f1,{grazing:true,key:'shelf-chimney-optical-path'});
  addBatch(group,'clear-glass-chimney',chimneyMaterial,lamp,{castShadow:false});
  const rimMaterial = glass(0xe2e8e8,{roughness:.03,clearcoatRoughness:0,envMapIntensity:1,key:'shelf-glass-rim'});
  addBatch(group,'rolled-glass-rim',rimMaterial,lamp,{castShadow:false});
  // A second transmissive volume inside the chimney samples Three's same
  // opaque buffer, which erases the coloured bulb. Composite its thin amber
  // coating after the refractive chimney instead; the front wall keeps real
  // physical reflections while the four filaments remain visible behind it.
  const amber = new THREE.MeshPhysicalMaterial({color:0xc48330,roughness:.095,metalness:0,
    transparent:true,opacity:.3,transmission:0,depthWrite:false,side:THREE.FrontSide,
    clearcoat:.8,clearcoatRoughness:.08,ior:1.46,envMapIntensity:.6});
  const bulb = addBatch(group,'amber-candle-led-bulb',amber,lamp,{castShadow:false});
  bulb.renderOrder = 2;
  const support = new THREE.MeshBasicMaterial({color:0x514b39,toneMapped:true});
  addBatch(group,'led-filament-support',support,lamp,{castShadow:false});
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
  addBatch(group,'glowing-retro-led-filaments',filament,lamp,{castShadow:false});
  const cord = new THREE.MeshStandardMaterial({color:0x242626,roughness:.97});
  addBatch(group,'black-braided-power-cord',cord,lamp);
}

function tripod(group,quality,lamp) {
  const wood = materialWithSurface('wood',quality,{color:0xffffff,metalness:0,roughness:1,
    clearcoat:.12,clearcoatRoughness:.65});
  addBatch(group,'lamp-base',wood,lamp);
  const fitting = new THREE.MeshStandardMaterial({color:0xd2c9b8,metalness:.65,roughness:.39});
  addBatch(group,'shade-support-and-rims',fitting,lamp);
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
  addBatch(group,'woven-linen-drum-shade',linen,lamp);
  const binding = new THREE.MeshStandardMaterial({color:0xded4bf,roughness:.92,
    emissive:0xffd7ac,emissiveIntensity:.12});
  addBatch(group,'linen-bound-shade-edges',binding,lamp);
  const bulb = new THREE.MeshStandardMaterial({color:0xffead2,roughness:.55,
    emissive:0xffd39b,emissiveIntensity:1.8});
  addBatch(group,'warm-shaded-led-bulb',bulb,lamp,{castShadow:false});
  const cable = new THREE.MeshStandardMaterial({color:0xe3ddce,roughness:.83});
  addBatch(group,'ivory-fabric-power-cord',cable,lamp);
}

/**
 * Centred x/z. Standing fixtures start at y=0 and extend up; the puck's
 * mounting face is y=0 and its body extends down. Width and optional maximum
 * height fit uniformly, preserving the shape instead of stretching it.
 * Emissive meshes belong here; budgeted real lights belong to the scene.
 */
export function createShelfLamp({lampId='tarnaby',width=null,height=null,quality='high',isOn=true,persist=false,kelvin}={}) {
  const {lamp,native,scale,kind}=lampGeometrySpec({lampId,width,height});
  const group = new THREE.Group(); group.name = `shelf-lamp-${lamp.id}`;
  const geometry = lampGeometry(kind,quality === 'low' ? 40 : 72,scale);
  const used = building = persist ? new Set() : null;
  try { (kind === 0 ? puck : kind === 1 ? tripod : lantern)(group,quality,geometry); }
  finally { building = null; }
  if (used?.size) { for (const key of used) shelfSurfaces.add(key); scheduleShelfBakeWrite(); }
  // The uniform fit is already in the vertices and in the emitter, which is genuinely local to the
  // returned root: localToWorld must not apply the size twice.
  const fittedMaterials = new Set();
  group.traverse(object => { if (object.material) fittedMaterials.add(object.material); });
  for (const material of fittedMaterials) {
    if (material.bumpScale) material.bumpScale *= scale;
    if (material.thickness) material.thickness *= scale;
    if (Number.isFinite(material.attenuationDistance)) material.attenuationDistance *= scale;
  }
  const emitter = geometry.emitter;
  group.userData = {
    lampId:lamp.id,mount:lamp.mount,width:native.width * scale,
    height:native.height * scale,depth:native.depth * scale,warmKelvin:lamp.warmKelvin,
    // World units are millimetres before fitting. Inverse-square lights
    // need intensity to follow the same squared fit, preserving their
    // irradiance on books and boards when the screen or zoom changes.
    lightEmitter:{ position:emitter.position,color:emitter.color,
      ...(emitter.filaments ? { filaments:emitter.filaments } : {}),
      intensity:emitter.intensity,distance:emitter.distance,decay:2,power:1,
      ...(emitter.direction ? { direction:emitter.direction,angle:emitter.angle,penumbra:emitter.penumbra } : {}) }
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
