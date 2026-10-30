//! The shader text of a book's materials, applied to the program sources three hands to
//! `onBeforeCompile`: the reflection layer every outer material carries (a covered board is slightly
//! uneven beneath its laminate; the shape lives in the reflection only), the spine's grazing fade and
//! the cover's relief. Each patch is the chain of `String.prototype.replace`/`replaceAll` calls of the
//! original, in its order and with JavaScript's replacement rules, so the programs are byte for byte
//! the ones the page compiled before (tests/unit/helpers/reference-book-shaders.js). The host remembers
//! each result per distinct source, so a shelf of books patches each program variant once.
use js_sys::Array;
use wasm_bindgen::prelude::*;

/// `GetSubstitution` for a literal pattern (no capture groups): `$$`, `$&`, `` $` `` and `$'` are
/// replaced; every other `$` stays as it is.
fn substitute(out: &mut String, replacement: &str, source: &str, at: usize, matched: &str) {
    let bytes = replacement.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'$' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'$' => { out.push('$'); i += 2; continue; }
                b'&' => { out.push_str(matched); i += 2; continue; }
                b'`' => { out.push_str(&source[..at]); i += 2; continue; }
                b'\'' => { out.push_str(&source[at + matched.len()..]); i += 2; continue; }
                _ => {}
            }
        }
        // Copy up to the next `$` (always a char boundary: `$` is ASCII).
        let next = replacement[i + 1..].find('$').map_or(bytes.len(), |n| i + 1 + n);
        out.push_str(&replacement[i..next]);
        i = next;
    }
}
/// `source.replace(pattern, replacement)`: the first occurrence.
fn replace(source: &str, pattern: &str, replacement: &str) -> String {
    let Some(at) = source.find(pattern) else { return source.to_string() };
    let mut out = String::with_capacity(source.len() + replacement.len());
    out.push_str(&source[..at]);
    substitute(&mut out, replacement, source, at, pattern);
    out.push_str(&source[at + pattern.len()..]);
    out
}
/// `source.replaceAll(pattern, replacement)`: every occurrence, left to right, without overlaps.
fn replace_all(source: &str, pattern: &str, replacement: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut last = 0;
    for (at, matched) in source.match_indices(pattern) {
        out.push_str(&source[last..at]);
        substitute(&mut out, replacement, source, at, matched);
        last = at + matched.len();
    }
    out.push_str(&source[last..]);
    out
}

const DECLARATIONS: &str = "
varying vec2 vBookReflectionUv;
uniform vec3 bookReflectionPhase;
uniform float bookReflectionStrength;
uniform float bookEnvironmentReflection;
vec3 bookReflectionNormal;
vec3 bookReflectionClearcoatNormal;
#ifdef USE_ANISOTROPY
  vec3 bookReflectionAnisotropyT;
  vec3 bookReflectionAnisotropyB;
#endif
";

// Analytic slopes of three broad, nonparallel height waves (roughly one or two waves per cover),
// rather than a tiled/noisy normal texture. At .018 the maximum tilt is about two degrees. Raw
// geometry UVs make each book's shape identical in the shelf, enlarged view and lifted copy,
// independent of the resolution/repeat of its existing paper or cloth texture.
const NORMAL_SETUP: &str = "
  vec3 bookWaveAngle = vec3(
    dot(vBookReflectionUv, vec2(5.2, 1.7)),
    dot(vBookReflectionUv, vec2(-2.4, 9.0)),
    dot(vBookReflectionUv, vec2(10.9, 5.1))
  ) + bookReflectionPhase;
  vec3 bookWaveCos = cos(bookWaveAngle);
  vec2 bookSlope = bookReflectionStrength * (
    vec2(.72, .2353846154) * bookWaveCos.x +
    vec2(-.2, .75) * bookWaveCos.y +
    vec2(.19, .0888990826) * bookWaveCos.z
  );

  // Recover the UV directions in view space, including curved bindings and
  // mirrored/back faces. Normalize the directions separately so the slope
  // remains small on thin spines as well as broad cover boards. A degenerate
  // UV face contributes zero tilt; guarded lengths cannot introduce NaNs.
  vec3 bookDx = dFdx(-vViewPosition);
  vec3 bookDy = dFdy(-vViewPosition);
  vec2 bookUvDx = dFdx(vBookReflectionUv);
  vec2 bookUvDy = dFdy(vBookReflectionUv);
  vec3 bookDyPerp = cross(bookDy, nonPerturbedNormal);
  vec3 bookDxPerp = cross(nonPerturbedNormal, bookDx);
  vec3 bookT = bookDyPerp * bookUvDx.x + bookDxPerp * bookUvDy.x;
  vec3 bookB = bookDyPerp * bookUvDx.y + bookDxPerp * bookUvDy.y;
  bookT *= inversesqrt(max(dot(bookT, bookT), 1e-20));
  bookB *= inversesqrt(max(dot(bookB, bookB), 1e-20));
  vec3 bookReflectionTilt = bookT * bookSlope.x + bookB * bookSlope.y;
  bookReflectionNormal = normalize(normal - bookReflectionTilt);
  bookReflectionClearcoatNormal = bookReflectionNormal;
  #ifdef USE_CLEARCOAT
    bookReflectionClearcoatNormal = normalize(clearcoatNormal - bookReflectionTilt);
  #endif
";

const ANISOTROPY_SETUP: &str = "
  #ifdef USE_ANISOTROPY
    // Foil keeps its grain aligned with the tilted reflection surface. The
    // unmodified material frame remains available to all diffuse operations.
    bookReflectionAnisotropyT = normalize(material.anisotropyT - bookReflectionNormal *
      dot(bookReflectionNormal, material.anisotropyT));
    bookReflectionAnisotropyB = normalize(cross(bookReflectionNormal, bookReflectionAnisotropyT));
    bookReflectionAnisotropyB *= dot(bookReflectionAnisotropyB, material.anisotropyB) < 0.0 ? -1.0 : 1.0;
  #endif
";

/// three r180's physical chunk mixes direct Lambert and GGX in one function. Override only the specular
/// terms; keep the original diffuse irradiance, indirect multiscattering energy compensation and coat
/// attenuation. Local to these materials; the global chunks stay untouched.
fn physical_pars(chunk: &str) -> String {
    let text = replace_all(chunk, "dot( material.anisotropyT,", "dot( bookReflectionAnisotropyT,");
    let text = replace_all(&text, "dot( material.anisotropyB,", "dot( bookReflectionAnisotropyB,");
    let text = replace(&text, "float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );",
        "float dotNLcc = saturate( dot( bookReflectionClearcoatNormal, directLight.direction ) );");
    let text = replace(&text, "BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material )",
        "BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, bookReflectionClearcoatNormal, material )");
    let text = replace(&text, "reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );",
        "vec3 bookSpecularIrradiance = saturate(dot(bookReflectionNormal, directLight.direction)) * directLight.color;
  reflectedLight.directSpecular += bookSpecularIrradiance * BRDF_GGX( directLight.direction, geometryViewDir, bookReflectionNormal, material );");
    let text = replace(&text, "clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal,", "clearcoatRadiance * EnvironmentBRDF( bookReflectionClearcoatNormal,");
    // The app uses point/spot/directional sources. Keep area-light reflections coherent too without
    // changing their diffuse LTC evaluation.
    let text = replace(&text, "vec3 normal = geometryNormal;", "vec3 normal = bookReflectionNormal;");
    replace(&text, "lightColor * material.diffuseColor * LTC_Evaluate( normal,", "lightColor * material.diffuseColor * LTC_Evaluate( geometryNormal,")
}

fn environment_maps(chunk: &str) -> String {
    let text = replace_all(chunk, "\tradiance += getIBL", "\tradiance += bookEnvironmentReflection * getIBL");
    let text = replace(&text, "clearcoatRadiance += getIBL", "clearcoatRadiance += bookEnvironmentReflection * getIBL");
    let text = replace(&text, "getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB,",
        "getIBLAnisotropyRadiance( geometryViewDir, bookReflectionNormal, material.roughness, bookReflectionAnisotropyB,");
    let text = replace(&text, "getIBLRadiance( geometryViewDir, geometryNormal,", "getIBLRadiance( geometryViewDir, bookReflectionNormal,");
    replace(&text, "getIBLRadiance( geometryViewDir, geometryClearcoatNormal,", "getIBLRadiance( geometryViewDir, bookReflectionClearcoatNormal,")
}

fn pair(vertex: String, fragment: String) -> Array { Array::of2(&JsValue::from_str(&vertex), &JsValue::from_str(&fragment)) }

/// The reflection layer of one material: `[vertex, fragment]` from three's sources and the
/// `lights_physical_pars_fragment` and `lights_fragment_maps` chunks the module read when it loaded.
#[wasm_bindgen]
pub fn book_reflection_shaders(vertex: &str, fragment: &str, physical_chunk: &str, maps_chunk: &str) -> Array {
    let vertex = replace(vertex, "void main() {", "varying vec2 vBookReflectionUv;\nuniform vec2 bookReflectionUvScale;\nvoid main() {");
    let vertex = replace(&vertex, "#include <uv_vertex>", "#include <uv_vertex>\n  vBookReflectionUv = uv * bookReflectionUvScale;");
    let pars = DECLARATIONS.to_string() + &physical_pars(physical_chunk);
    let fragment = replace(fragment, "#include <lights_physical_pars_fragment>", &pars);
    let fragment = replace(&fragment, "#include <clearcoat_normal_fragment_maps>", &("#include <clearcoat_normal_fragment_maps>\n".to_string() + NORMAL_SETUP));
    let fragment = replace(&fragment, "#include <lights_physical_fragment>", &("#include <lights_physical_fragment>\n".to_string() + ANISOTROPY_SETUP));
    let fragment = replace(&fragment, "#include <lights_fragment_maps>", &environment_maps(maps_chunk));
    pair(vertex, fragment)
}

/// Seen almost edge-on (the lifted book's front view), spine lettering shrinks into bright slivers along
/// the rolled edge. Only while the spine as a whole faces away, the surface that turns from the viewer
/// shows plain cloth; the rules near the joint, which still face the viewer, keep their ink.
#[wasm_bindgen]
pub fn book_spine_fade_shaders(vertex: &str, fragment: &str) -> Array {
    let vertex = replace(vertex, "void main() {", "varying float vSpineFacing;\nvoid main() {");
    let vertex = replace(&vertex, "#include <project_vertex>",
        "#include <project_vertex>\n\tvSpineFacing = abs(normalize((modelViewMatrix * vec4(-1., 0., 0., 0.)).xyz).z);");
    let fragment = replace(fragment, "void main() {",
        "varying float vSpineFacing;\nuniform vec3 spineCloth;\nuniform float spineClothMetal, spineClothRough;\nvoid main() {");
    let fragment = replace(&fragment, "#include <normal_fragment_maps>", "#include <normal_fragment_maps>
\tfloat spineEdge = .62 * (1. - smoothstep(.35, .6, vSpineFacing));
\tfloat spineKeep = smoothstep(spineEdge - .16, spineEdge,
\t\tabs(dot(nonPerturbedNormal, isOrthographic ? vec3(0., 0., 1.) : normalize(vViewPosition))));
\tdiffuseColor.rgb = mix(spineCloth, diffuseColor.rgb, spineKeep);
\tmetalnessFactor = mix(spineClothMetal, metalnessFactor, spineKeep);
\troughnessFactor = mix(spineClothRough, roughnessFactor, spineKeep);
\tnormal = normalize(mix(nonPerturbedNormal, normal, spineKeep));");
    pair(vertex, fragment)
}

/// The physical chunk of a cover that can carry relief: the clearcoat roughness from the map's alpha,
/// and the base finish restored outside the selection (`installCoverRelief`, at install time).
#[wasm_bindgen]
pub fn book_relief_physical(chunk: &str) -> String {
    let text = replace(chunk, "material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;",
        "material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).a;");
    let text = replace(&text, "PhysicalMaterial material;", "roughnessFactor = mix( bookReliefBaseFinish.y, roughnessFactor, bookReliefAmount );
PhysicalMaterial material;");
    replace(&text, "material.clearcoat = saturate( material.clearcoat );", "material.clearcoat = mix( bookReliefBaseFinish.x, material.clearcoat, bookReliefAmount );
  material.clearcoatRoughness = mix( bookReliefBaseFinish.z, material.clearcoatRoughness, bookReliefAmount );
  material.clearcoat = saturate( material.clearcoat );")
}

/// Relief reaches the shader through the clearcoat normal map. The same tangent-space normal also bends
/// the base layer's normal, so the raised zones read under a matte, satin or glossy laminate alike.
/// Neutral placeholder maps leave every pixel unchanged. `physical` is `book_relief_physical`'s chunk,
/// `clearcoat_maps` three's `clearcoat_normal_fragment_maps` at compile time.
#[wasm_bindgen]
pub fn book_cover_relief_fragment(fragment: &str, physical: &str, clearcoat_maps: &str) -> String {
    let text = replace(fragment, "void main() {", "uniform vec3 bookReliefBaseFinish;
uniform float bookReliefStrength;
float bookReliefAmount = 0.0;
void main() {");
    let text = replace(&text, "#include <normal_fragment_maps>", "#include <normal_fragment_maps>
\t#ifdef USE_CLEARCOAT_NORMALMAP
\t\tvec4 reliefSample = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv );
\t\tbookReliefAmount = step( 0.5 / 255.0, reliefSample.a ) * bookReliefStrength;
\t\tvec3 reliefN = vec3( ( reliefSample.xy * 255.0 - 128.0 ) / 127.0, reliefSample.z * 2.0 - 1.0 );
\t\treliefN.xy *= clearcoatNormalScale;
\t\treliefN.z = mix( 1.0, reliefN.z, bookReliefStrength );
\t\tnormal = normalize( normal + tbn2 * reliefN - tbn2[ 2 ] );
\t#endif");
    let maps = replace(clearcoat_maps, "texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0",
        "vec3( ( reliefSample.xy * 255.0 - 128.0 ) / 127.0, reliefSample.z * 2.0 - 1.0 )");
    let text = replace(&text, "#include <clearcoat_normal_fragment_maps>", &maps);
    replace(&text, "#include <lights_physical_fragment>", physical)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacement_rules_follow_javascript() {
        assert_eq!(replace("a-b-b", "b", "[$&|$`|$'|$$|$1]"), "a-[b|a-|-b|$|$1]-b");
        assert_eq!(replace_all("xbxbx", "b", "($&)"), "x(b)x(b)x");
        assert_eq!(replace("abc", "z", "y"), "abc");
        assert_eq!(replace("ends$", "s", "$"), "end$$");
    }
}
