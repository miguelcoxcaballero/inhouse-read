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
