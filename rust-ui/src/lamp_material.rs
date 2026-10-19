//! Lamp appearance policy. Immutable material/shader descriptors are loaded once;
//! only fitted numeric layout and emission buffers cross the boundary per model.
//! Three.js remains responsible for resource creation, shader compilation and disposal.
use wasm_bindgen::prelude::*;

const MODELS: &str = r####"[
[
{"name":"lamp-housing","class":"MeshPhysicalMaterial","options":{"color":13159373,"metalness":0.91,"roughness":0.3,"clearcoat":0.15,"clearcoatRoughness":0.3},"castShadow":true,"receiveShadow":true,"renderOrder":0},
{"name":"warm-opal-diffuser","class":"MeshPhysicalMaterial","options":{"color":16771018,"roughness":0.72,"metalness":0,"emissive":16765856,"emissiveIntensity":2.3,"clearcoat":0.12,"side":2},"castShadow":false,"receiveShadow":true,"renderOrder":0},
{"name":"puck-power-lead","class":"MeshStandardMaterial","options":{"color":13947079,"roughness":0.85},"castShadow":true,"receiveShadow":true,"renderOrder":0}
],
[
{"name":"lamp-base","class":"MeshPhysicalMaterial","options":{"color":16777215,"metalness":0,"roughness":1,"clearcoat":0.12,"clearcoatRoughness":0.65},"surface":"wood","castShadow":true,"receiveShadow":true,"renderOrder":0},
{"name":"shade-support-and-rims","class":"MeshStandardMaterial","options":{"color":13814200,"metalness":0.65,"roughness":0.39},"castShadow":true,"receiveShadow":true,"renderOrder":0},
{"name":"woven-linen-drum-shade","class":"MeshPhysicalMaterial","options":{"color":16777215,"roughness":1,"metalness":0,"side":2,"emissive":16763266,"emissiveIntensity":1},"surface":"linen","castShadow":true,"receiveShadow":true,"renderOrder":0,"emissiveMap":true,"patches":[["#include <emissivemap_fragment>","\n      #include <emissivemap_fragment>\n      float clothBounce = pow(max(0.0,sin(vMapUv.y * 3.14159265359)),.65);\n      totalEmissiveRadiance *= .28 + .72 * clothBounce;"]],"key":"shelf-linen-warm-centre"},
{"name":"linen-bound-shade-edges","class":"MeshStandardMaterial","options":{"color":14603455,"roughness":0.92,"emissive":16766892,"emissiveIntensity":0.12},"castShadow":true,"receiveShadow":true,"renderOrder":0},
{"name":"warm-shaded-led-bulb","class":"MeshStandardMaterial","options":{"color":16771794,"roughness":0.55,"emissive":16765851,"emissiveIntensity":1.8},"castShadow":false,"receiveShadow":true,"renderOrder":0},
{"name":"ivory-fabric-power-cord","class":"MeshStandardMaterial","options":{"color":14933454,"roughness":0.83},"castShadow":true,"receiveShadow":true,"renderOrder":0}
],
[
{"name":"lamp-base","class":"MeshPhysicalMaterial","options":{"color":16777215,"metalness":0.68,"roughness":1,"clearcoat":0.28,"clearcoatRoughness":0.35},"surface":"black","castShadow":true,"receiveShadow":true,"renderOrder":0},
{"name":"brass-collar-and-machined-dimmer","class":"MeshPhysicalMaterial","options":{"color":12362096,"metalness":1,"roughness":0.27,"clearcoat":0.2,"clearcoatRoughness":0.25},"castShadow":true,"receiveShadow":true,"renderOrder":0},
{"name":"clear-glass-chimney","class":"MeshPhysicalMaterial","options":{"color":15397105,"roughness":0.055,"metalness":0,"ior":1.46,"clearcoat":1,"clearcoatRoughness":0.025,"envMapIntensity":1.15,"side":2,"depthWrite":false,"transparent":true,"blending":5,"blendSrc":201,"blendDst":205},"castShadow":false,"receiveShadow":true,"renderOrder":0,"patches":[["#include <lights_fragment_end>","\n      #include <lights_fragment_end>\n      reflectedLight.directDiffuse = vec3(0.0);\n      reflectedLight.indirectDiffuse = vec3(0.0);"],["#include <opaque_fragment>","\n      vec3 glassView = normalize(vViewPosition);\n      vec3 glassFresnel = EnvironmentBRDF(normal,glassView,material.specularColor,material.specularF90,material.roughness);\n      float glassSeen = 0.8579 * (1.0 - (glassFresnel.r + glassFresnel.g + glassFresnel.b) / 3.0) * (1.0 - Fcc.r);\n      vec3 glassPath = mix(vec3(1.0),vec3(.74,.80,.82),pow(1.0 - abs(dot(normal,glassView)),2.5));\n      outgoingLight *= glassPath;\n      glassSeen *= (glassPath.r + glassPath.g + glassPath.b) / 3.0;\n      diffuseColor.a = 1.0 - sqrt(glassSeen);\n      #include <opaque_fragment>"]],"key":"shelf-chimney-optical-path"},
{"name":"rolled-glass-rim","class":"MeshPhysicalMaterial","options":{"color":14870760,"roughness":0.03,"metalness":0,"ior":1.46,"clearcoat":1,"clearcoatRoughness":0,"envMapIntensity":1,"side":2,"depthWrite":false,"transparent":true,"blending":5,"blendSrc":201,"blendDst":205},"castShadow":false,"receiveShadow":true,"renderOrder":0,"patches":[["#include <lights_fragment_end>","\n      #include <lights_fragment_end>\n      reflectedLight.directDiffuse = vec3(0.0);\n      reflectedLight.indirectDiffuse = vec3(0.0);"],["#include <opaque_fragment>","\n      vec3 glassView = normalize(vViewPosition);\n      vec3 glassFresnel = EnvironmentBRDF(normal,glassView,material.specularColor,material.specularF90,material.roughness);\n      float glassSeen = 0.7915 * (1.0 - (glassFresnel.r + glassFresnel.g + glassFresnel.b) / 3.0) * (1.0 - Fcc.r);\n      \n      diffuseColor.a = 1.0 - sqrt(glassSeen);\n      #include <opaque_fragment>"]],"key":"shelf-glass-rim"},
{"name":"amber-candle-led-bulb","class":"MeshPhysicalMaterial","options":{"color":12878640,"roughness":0.095,"metalness":0,"transparent":true,"opacity":0.3,"transmission":0,"depthWrite":false,"side":0,"clearcoat":0.8,"clearcoatRoughness":0.08,"ior":1.46,"envMapIntensity":0.6},"castShadow":false,"receiveShadow":true,"renderOrder":2},
{"name":"led-filament-support","class":"MeshBasicMaterial","options":{"color":5327673,"toneMapped":true},"castShadow":false,"receiveShadow":true,"renderOrder":0},
{"name":"glowing-retro-led-filaments","class":"MeshStandardMaterial","options":{"color":7426079,"roughness":0.78,"emissive":16766626,"emissiveIntensity":4.5,"toneMapped":true},"castShadow":false,"receiveShadow":true,"renderOrder":0,"patches":[["#include <emissivemap_fragment>","\n      #include <emissivemap_fragment>\n      float filamentFacing = clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0);\n      float filamentCore = pow(filamentFacing,4.0);\n      totalEmissiveRadiance *= mix(vec3(.65,.37,.09),vec3(1.2,1.16,1.07),filamentCore);\n    "],["#include <lights_fragment_end>","\n      #include <lights_fragment_end>\n      reflectedLight.directDiffuse = vec3(0.0);\n      reflectedLight.directSpecular = vec3(0.0);"]],"key":"shelf-phosphor-filament-core"},
{"name":"black-braided-power-cord","class":"MeshStandardMaterial","options":{"color":2369062,"roughness":0.97},"castShadow":true,"receiveShadow":true,"renderOrder":0}
]
]"####;

#[wasm_bindgen]
pub fn lamp_material_definitions() -> String {
    let mut sets = Vec::new();
    for detail in [1, 2] {
        let mut surfaces = Vec::new();
        for kind in ["wood", "linen", "black"] {
            let width = if kind == "wood" { 128 * detail } else { 256 * detail };
            let height = if kind == "wood" { 512 * detail } else { width };
            surfaces.push(format!(r#""{kind}":{{"kind":"{kind}","key":"{kind}:{detail}","width":{width},"height":{height}}}"#));
        }
        sets.push(format!("{{{}}}", surfaces.join(",")));
    }
    format!(r#"{{"models":{MODELS},"surfaces":[{}]}}"#, sets.join(","))
}

/// Segment count, surface-quality index, then fitted bump scale for every mesh.
#[wasm_bindgen]
pub fn lamp_material_layout(kind: u32, low: bool, scale: f64) -> Vec<f64> {
    let bumps: &[f64] = match kind {
        0 => &[1.0, 1.0, 1.0],
        1 => &[0.16, 1.0, 0.22, 1.0, 1.0, 1.0],
        _ => &[0.045, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0],
    };
    let mut result = Vec::with_capacity(2 + bumps.len());
    result.push(if low { 40.0 } else { 72.0 }); result.push(if low { 0.0 } else { 1.0 });
    result.extend(bumps.iter().map(|value| value * scale)); result
}

