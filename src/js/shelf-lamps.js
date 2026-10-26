import * as THREE from 'three';
import {lampGeometrySpec} from './decor-geometry-spec.js';
import {rustLampSurface} from './lamp-surface-wasm.js';
import { needRustShelf } from './rust-shelf.js';
import { core, scratch, scratchPointer } from './decor-catalogue.js';
import { lampTint, normalizeLampKelvin } from './lamp-kelvin.js';
import { addShelfBakeSource, savedSurface, scheduleShelfBakeWrite } from './shelf-bake-cache.js';

let materialDefinitions = null, emissionScratch = null;
// The numeric kernel never allocates or calls out, so this view stays valid
// throughout an update; reacquire it after any other decor operation grows WASM.
const emissionBuffer = () => emissionScratch?.buffer === core.memory.buffer ? emissionScratch : (emissionScratch = scratch());
const definitions = () => materialDefinitions ||= JSON.parse(needRustShelf().lamp_material_definitions());
const imageCache = new Map();
// Surfaces of this session's shelf lamps are saved for the next launch.
const shelfSurfaces = new Set();
let building = null;
addShelfBakeSource({ settled:() => Promise.resolve(), collect:() => ({ surfaces:[...shelfSurfaces]
  .filter(key => imageCache.has(key)).map(key => [`lamp:${key}`, imageCache.get(key)]) }) });

// Surfaces remain sharp at finger-zoom distances. Only immutable CPU texels
// are cached: a fixture owns, and releases, all of its GPU textures.
function surface({ kind, key, width, height }) {
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

/** The geometry of a lamp. The Rust shelf module draws every part, bakes the parts of one material into one geometry
 * (the tripod's feet and cord trimmed to the shelf), fits the lamp by `scale` and makes three's geometries
 * (rust-ui/src/lamp_model.rs, decor_build.rs); the emitter arrives fitted too. The host adds the materials. */
const lampGeometry = (kind,segments,scale) => needRustShelf().lamp_geometry_build(THREE,kind,segments,scale);

/** Resource binding for Rust's immutable appearance descriptors. */
function installMaterials(group, kind, plan, lamp) {
  const descriptor = definitions(), surfaces = descriptor.surfaces[plan[1]];
  descriptor.models[kind].forEach((spec, index) => {
    const options = { ...spec.options };
    if (spec.surface) {
      const maps = surface(surfaces[spec.surface]);
      options.map = maps.map; options.bumpMap = maps.data; options.roughnessMap = maps.data;
    }
    const material = new THREE[spec.class](options);
    if ('bumpScale' in material) material.bumpScale = plan[2 + index];
    if (spec.emissiveMap) material.emissiveMap = material.map;
    if (spec.patches) {
      material.onBeforeCompile = shader => {
        for (const [find, replacement] of spec.patches) shader.fragmentShader = shader.fragmentShader.replace(find, replacement);
      };
      material.customProgramCacheKey = () => spec.key;
    }
    const mesh = new THREE.Mesh(lamp.geometries.get(spec.name), material);
    mesh.name = spec.name; mesh.castShadow = spec.castShadow; mesh.receiveShadow = spec.receiveShadow;
    mesh.renderOrder = spec.renderOrder; group.add(mesh);
  });
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
  const plan = needRustShelf().lamp_material_layout(kind,quality === 'low',scale);
  const geometry = lampGeometry(kind,plan[0],scale);
  const used = building = persist ? new Set() : null;
  try { installMaterials(group,kind,plan,geometry); }
  finally { building = null; }
  if (used?.size) { for (const key of used) shelfSurfaces.add(key); scheduleShelfBakeWrite(); }
  // The uniform fit is already in the vertices and in the emitter, which is genuinely local to the
  // returned root: localToWorld must not apply the size twice.
  const fittedMaterials = new Set();
  group.traverse(object => { if (object.material) fittedMaterials.add(object.material); });
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
  const emissionBases = new Float64Array(emittingMaterials.length * 4);
  emittingMaterials.forEach(({ material, intensity }, index) => {
    emissionBases.set([intensity, material.emissive.r, material.emissive.g, material.emissive.b], index * 4);
  });
  group.userData.setPower = power => {
    const words = emissionBuffer(); words.set(emissionBases);
    const value = core.lamp_emission_power(scratchPointer, emittingMaterials.length, Number.isFinite(power) ? power : NaN);
    for (let index = 0; index < emittingMaterials.length; index++) emittingMaterials[index].material.emissiveIntensity = words[index * 4];
    group.userData.lightEmitter.power = value;
    return value;
  };
  group.userData.setPower(isOn === false ? 0 : 1);
  group.userData.setTint = tint => {
    const words = emissionBuffer(); words.set(emissionBases);
    if (!core.lamp_emission_tint(scratchPointer, emittingMaterials.length, tint[0], tint[1], tint[2])) throw new Error('Tinte de lámpara no válido.');
    for (let index = 0; index < emittingMaterials.length; index++) {
      const at = index * 4, { material } = emittingMaterials[index];
      material.emissive.r = words[at + 1]; material.emissive.g = words[at + 2]; material.emissive.b = words[at + 3];
    }
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
