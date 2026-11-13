//! The shelf key light's fixed rig: its variance shadow map (size, biases, blur radius and samples at rest and
//! in motion, how dark a shelf shadow may get), the firmer light-bleed floor the variance shadows use, and the
//! back panel's wide penumbra (its Vogel disk, evaluated here so every pixel reads the taps as constants).
//! Phones shade many more device pixels: a compact screen takes fewer taps and samples for the session.
use wasm_bindgen::prelude::*;
use crate::host::{get, global, jmin, num, truthy};

/// `Math.min(innerWidth || 1024, innerHeight || 1024) < 600`.
fn compact() -> bool {
    let side = |key: &str| { let value = get(&global(), key); if truthy(&value) { num(&value) } else { 1024.0 } };
    jmin(side("innerWidth"), side("innerHeight")) < 600.0
}

/// `[map size, bias, normal bias, blur radius, samples at rest, samples in motion, intensity]`. Variance maps
/// need only a small constant bias; a modest normal offset keeps grazing boards free of acne without detaching
/// books. A window is an area light: wide, even penumbrae under every shelf. While anything moves the map is
/// redrawn every frame with half the samples, and once at full quality when the scene settles. Room bounce
/// never lets a shelf shadow go fully black.
#[wasm_bindgen]
pub fn shelf_light_rig() -> Vec<f64> {
    let rest = if compact() { 8.0 } else { 12.0 };
    vec![1024.0, -0.0004, 0.45, 9.0, rest, rest / 2.0, 0.84]
}

/// three's variance shadows keep a 0.3 light-bleed floor. Books standing a finger's width from the back panel,
/// under a shelf far above them, need a firmer one or a lit halo opens between the two shadows. `None` keeps a
/// later three's chunk as it is.
#[wasm_bindgen]
pub fn shelf_firm_bleed(chunk: &str) -> Option<String> {
    const BLEED: &str = "( softness_probability - 0.3 ) / ( 0.95 - 0.3 )";
    chunk.contains(BLEED).then(|| chunk.replacen(BLEED, "( softness_probability - 0.62 ) / ( 0.97 - 0.62 )", 1))
}

/// How many taps the back panel's shadow takes for this screen.
#[wasm_bindgen]
pub fn shelf_panel_taps() -> u32 { if compact() { 9 } else { 12 } }

/// The back panel's shadow: the (already blurred) map averaged over a Vogel disk 3.6 blur radii across, its taps
/// sliding along the panel itself, so a wide disk never compares against the panel's own slope.
#[wasm_bindgen]
pub fn shelf_panel_shadow(taps: u32) -> Result<String, JsValue> {
    let fixed = |value: f64, digits: u8| -> Result<String, JsValue> { Ok(js_sys::Number::from(value).to_fixed(digits)?.as_string().unwrap_or_default()) };
    let mut lines = Vec::with_capacity(taps as usize);
    for k in 0..taps {
        let r = js_sys::Math::sqrt((f64::from(k) + 0.5) / f64::from(taps));
        let a = f64::from(k) * 2.39996 + 0.4;
        lines.push(format!("  sum += getShadow( map, size, intensity, bias, radius, coord + vec4( {} * du + {} * dv, 0.0 ) );",
            fixed(r * js_sys::Math::cos(a), 8)?, fixed(r * js_sys::Math::sin(a), 8)?));
    }
    Ok(format!("
#ifdef USE_SHADOWMAP
float getPanelShadow( sampler2D map, vec2 size, float intensity, float bias, float radius, vec4 coord ) {{
  // Taps slide along the panel itself (screen derivatives of the shadow
  // coordinate), so a wide disk never compares against the panel's own slope.
  float reach = radius * {} / size.x;
  vec3 du = dFdx( coord.xyz ), dv = dFdy( coord.xyz );
  du *= reach / max( length( du.xy ), 1e-7 ); dv *= reach / max( length( dv.xy ), 1e-7 );
  float sum = 0.0;
{}
  return sum / float( PANEL_TAPS );
}}
#endif", fixed(3.6, 2)?, lines.join("\n")))
}

/// `String.prototype.replace(needle, replacement)` with a string pattern: the first occurrence only, and the
/// replacement's `$$`, `$&`, `` $` `` and `$'` patterns expanded (a string pattern has no captures, so `$1` and
/// `$<name>` stay as written). The text is returned unchanged when the needle is absent.
fn js_replace(text: &str, needle: &str, replacement: &str) -> String {
    let Some(at) = text.find(needle) else { return text.to_owned() };
    let (before, after) = (&text[..at], &text[at + needle.len()..]);
    let mut out = String::with_capacity(text.len() + replacement.len());
    out.push_str(before);
    let mut rest = replacement;
    while let Some(dollar) = rest.find('$') {
        out.push_str(&rest[..dollar]);
        let tail = &rest[dollar + 1..];
        let (expanded, used) = match tail.as_bytes().first() {
            Some(b'$') => ("$", 1), Some(b'&') => (needle, 1), Some(b'`') => (before, 1), Some(b'\'') => (after, 1),
            _ => ("$", 0),
        };
        out.push_str(expanded);
        rest = &tail[used..];
    }
    out.push_str(rest);
    out.push_str(after);
    out
}

/// The back panel's fragment shader: its wide shadow after three's shadow chunk, the light loop inlined with
/// the key light's shadow read through it, and the room's bounce and reflections dimmed (deep inside the
/// carcass, sides and shelves hide much of the room). Guarded string patches: a later three without these
/// lines compiles its stock shader. `lights_begin` is three's `lights_fragment_begin` chunk as it is now.
#[wasm_bindgen]
pub fn shelf_panel_fragment(fragment: &str, lights_begin: &str, taps: u32) -> Result<String, JsValue> {
    const SHADOW: &str = "#include <shadowmap_pars_fragment>";
    const AO: &str = "#include <aomap_fragment>";
    let fragment = js_replace(fragment, SHADOW, &format!("{SHADOW}\n{}", shelf_panel_shadow(taps)?));
    let lights = js_replace(lights_begin, "getShadow( directionalShadowMap[ i ]", "getPanelShadow( directionalShadowMap[ i ]");
    let fragment = js_replace(&fragment, "#include <lights_fragment_begin>", &lights);
    Ok(js_replace(&fragment, AO, &format!("{AO}
        reflectedLight.indirectDiffuse *= .8; reflectedLight.indirectSpecular *= .72;")))
}

/// The back panel's program cache key.
#[wasm_bindgen]
pub fn shelf_panel_key() -> String { "walnut-panel-penumbra".into() }

/// The lamp occlusion test added to three's light declarations. Loop-free and without indexed uniforms: the
/// lamp's compartment lies between the nearest boards below and above it. `1000000.0` is the height given to an
/// unused board (shelf-light-occlusion.js fills the uniform with it).
const LAMP_OCCLUSION_PARS: &str = "
uniform vec4 shelfLampCabinet[ 5 ];
uniform vec4 shelfLampBoards[ 2 ];
vec3 shelfLampLocal( const in vec3 position ) {
	vec3 offset = position - shelfLampCabinet[ 3 ].xyz;
	return vec3( dot( offset, shelfLampCabinet[ 0 ].xyz ), dot( offset, shelfLampCabinet[ 1 ].xyz ), dot( offset, shelfLampCabinet[ 2 ].xyz ) );
}
// point: the surface in the cabinet's frame, computed once per pixel.
float shelfLampOcclusion( const in vec3 point, const in vec3 lampPosition ) {
	if ( shelfLampCabinet[ 0 ].w < 0.5 ) return 1.0;
	vec3 lamp = shelfLampLocal( lampPosition );
	if ( any( greaterThan( abs( lamp ), shelfLampCabinet[ 4 ].xyz ) ) ) return 1.0;
	vec4 lowA = step( shelfLampBoards[ 0 ], vec4( lamp.y ) ), lowB = step( shelfLampBoards[ 1 ], vec4( lamp.y ) );
	vec4 belowA = mix( vec4( -1000000.0 ), shelfLampBoards[ 0 ], lowA ), belowB = mix( vec4( -1000000.0 ), shelfLampBoards[ 1 ], lowB );
	vec4 aboveA = mix( shelfLampBoards[ 0 ], vec4( 1000000.0 ), lowA ), aboveB = mix( shelfLampBoards[ 1 ], vec4( 1000000.0 ), lowB );
	vec4 belowAll = max( belowA, belowB ), aboveAll = min( aboveA, aboveB );
	float below = max( max( belowAll.x, belowAll.y ), max( belowAll.z, belowAll.w ) );
	float above = min( min( aboveAll.x, aboveAll.y ), min( aboveAll.z, aboveAll.w ) );
	float through = shelfLampCabinet[ 4 ].w, inner = shelfLampCabinet[ 1 ].w, front = shelfLampCabinet[ 2 ].w;
	if ( point.y > below && point.y < above ) {
		// A walnut cabinet's solid sides and back.
		return shelfLampCabinet[ 3 ].w > 0.5 && ( abs( point.x ) > inner && point.z < front || point.z < - shelfLampCabinet[ 4 ].z ) ? through : 1.0;
	}
	if ( point.z <= front || lamp.z >= front ) return through;
	vec2 crossing = mix( lamp.xy, point.xy, ( front - lamp.z ) / ( point.z - lamp.z ) );
	return crossing.y > below && crossing.y < above && abs( crossing.x ) < inner ? 1.0 : through;
}
";

/// three's two light chunks with the lamp occlusion test added: `[lights_pars_begin, lights_fragment_begin]`.
/// `None` when a later three renamed a light's line (its own lighting stays unchanged); the second entry is
/// undefined when only the surface position's line is missing (the declarations were already added then, and
/// the uniforms are not installed).
#[wasm_bindgen]
pub fn shelf_lamp_occlusion_patch(pars_begin: &str, fragment_begin: &str) -> Option<js_sys::Array> {
    const POINT: &str = "getPointLightInfo( pointLight, geometryPosition, directLight );";
    const SPOT: &str = "getSpotLightInfo( spotLight, geometryPosition, directLight );";
    const AREA: &str = "rectAreaLight = rectAreaLights[ i ];";
    const POSITION: &str = "vec3 geometryPosition = - vViewPosition;";
    if ![POINT, SPOT, AREA].iter().all(|part| fragment_begin.contains(part)) { return None; }
    let patched = js_sys::Array::new();
    patched.push(&JsValue::from_str(&format!("{pars_begin}{LAMP_OCCLUSION_PARS}")));
    if !fragment_begin.contains(POSITION) { patched.push(&JsValue::UNDEFINED); return Some(patched); }
    let begin = js_replace(fragment_begin, POSITION, &format!("{POSITION}\nvec3 shelfLampSurface = shelfLampLocal( geometryPosition );"));
    let begin = js_replace(&begin, POINT, &format!("{POINT}\n\t\tdirectLight.color *= shelfLampOcclusion( shelfLampSurface, pointLight.position );"));
    let begin = js_replace(&begin, SPOT, &format!("{SPOT}\n\t\tdirectLight.color *= shelfLampOcclusion( shelfLampSurface, spotLight.position );"));
    let begin = js_replace(&begin, AREA, &format!("{AREA}\n\t\trectAreaLight.color *= shelfLampOcclusion( shelfLampSurface, rectAreaLight.position );"));
    patched.push(&JsValue::from_str(&begin));
    Some(patched)
}

/// The occluding role of a cabinet part by its name: 1 a solid board (`shelf-<n>-board`, `top-cap`), 2 an
/// expanded-metal shelf (`shelf-<n>-mesh`, `top-mesh`), 3 an upright (`left-upright`, `right-upright`), else 0.
fn part_kind(name: &str) -> f64 {
    let numbered = |suffix: &str| name.strip_prefix("shelf-").and_then(|rest| rest.strip_suffix(suffix))
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()));
    if numbered("-board") || name == "top-cap" { 1.0 }
    else if numbered("-mesh") || name == "top-mesh" { 2.0 }
    else if name == "left-upright" || name == "right-upright" { 3.0 }
    else { 0.0 }
}

/// The records `shelf_occluders_describe` reads, eight per part with bounds: the unit's index, the part's role
/// and its box (min, max), from each unit's `userData.parts` (iterated) in order.
#[wasm_bindgen]
pub fn occluder_records(units: &js_sys::Array) -> Result<Vec<f64>, JsValue> {
    use crate::host::{absent, read, text_of};
    let mut out = Vec::new();
    for (index, parts) in units.iter().enumerate() {
        for part in js_sys::try_iter(&parts)?.ok_or_else(|| JsValue::from(js_sys::TypeError::new("parts is not iterable")))? {
            let part = part?;
            if absent(&part) || !truthy(&read(&part, "bounds")?) { continue; }
            let bounds = read(&part, "bounds")?;
            let (min, max) = (read(&bounds, "min")?, read(&bounds, "max")?);
            out.push(index as f64);
            out.push(part_kind(&text_of(&read(&part, "name")?)));
            for corner in [&min, &max] { for axis in ["x", "y", "z"] { out.push(num(&read(corner, axis)?)); } }
        }
    }
    Ok(out)
}
