//! Key-light shadow fit for the visible part of the cabinet. The host owns the Three
//! light and camera; this decides when the shadow window is re-fitted, when a pure
//! similarity of the view can move the existing map instead, and the new frustum.
//! Everything keeps Three's f64 operation order, so the numbers are the original ones.
use crate::jsmath::{clamp, distance, jmax, jmin, length, Box3, Mat4, Vec3};

const SHADOW_SIZE: f64 = 1024.0;
// Soft edge of every shelf shadow, in shelf pixels, whatever window it covers.
const PENUMBRA: f64 = 9.0;
// The fitted window reaches this share of a screen beyond each edge.
const SLACK: f64 = 0.25;
// Nearly square texels keep the blur round on tall, narrow phone screens.
const MAX_ASPECT: f64 = 1.5;
const PANEL_REACH: f64 = 3.6;
const UP: Vec3 = [0.0, 1.0, 0.0];

/// One component of the layout key: what `Number#toFixed(2)` prints, compared as text.
#[derive(Clone, Copy, PartialEq)]
enum Part { Fixed { negative: bool, hundredths: u128 }, Other(u64) }
fn fixed2(value: f64) -> Part {
    if value.is_nan() { return Part::Other(f64::NAN.to_bits()); }
    if value.is_infinite() || value.abs() >= 1e21 { return Part::Other(value.to_bits()); }
    // The integer n that makes n/100 closest to the exact binary value; the larger on a tie.
    let bits = value.abs().to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1u64 << 52) - 1);
    let (mantissa, shift) = if exponent == 0 { (fraction, -1074) } else { (fraction | (1u64 << 52), exponent - 1075) };
    let scaled = (mantissa as u128) * 100;
    let hundredths = if shift >= 0 { scaled << shift as u32 } else {
        let down = (-shift) as u32;
        if down >= 127 { 0 } else { (scaled + (1u128 << (down - 1))) >> down }
    };
    Part::Fixed { negative: value < 0.0, hundredths }
}
#[derive(Clone, Copy, PartialEq)]
struct Key { parts: [Part; 9], count: usize }

pub struct Light {
    view: Mat4,
    previous_transform: Mat4,
    previous_bounds: Box3,
    fitted: Box3,
    layout_inputs: [f64; 9],
    layout_key: Option<Key>,
    layout_bounded: bool,
    has_transform: bool,
    frame: Option<Key>,
    coarse: bool,
}

/// Parameters, in order: width, viewportHeight, depth, scroll, hasBounds, bounds min xyz,
/// bounds max xyz, hasTransform, transform[16], moving, forceRefit, dirty (already
/// truthy-tested), toLight xyz, key position xyz, target position xyz, normalBias,
/// camera left, right, top, bottom, near, far.
const PARAMS: usize = 47;
/// Output: dirty, assignedDirty, fitted, transported, coarse, key position xyz,
/// target position xyz, normalBias, camera left, right, top, bottom, near, far, radius.
const OUTPUT: usize = 19;

fn window(box3: &mut Box3, width: f64, viewport: f64, scroll: f64, depth: f64, bounds: Option<&Box3>, slack: f64) {
    box3.min = [0.0, -scroll - viewport - slack, -depth - 24.0];
    box3.max = [width, -scroll + slack, 24.0];
    if let Some(bounds) = bounds.filter(|bounds| !bounds.is_empty()) {
        box3.min = [jmax(box3.min[0], bounds.min[0]), jmax(box3.min[1], bounds.min[1]), bounds.min[2]];
        box3.max = [jmin(box3.max[0], bounds.max[0]), jmin(box3.max[1], bounds.max[1]), bounds.max[2]];
        if box3.is_empty() { box3.min = box3.max; }
    }
}

impl Light {
    fn new() -> Light {
        Light { view: Mat4::identity(), previous_transform: Mat4::identity(), previous_bounds: Box3::empty(), fitted: Box3::empty(),
            layout_inputs: [0.0; 9], layout_key: None, layout_bounded: false, has_transform: false, frame: None, coarse: false }
    }
    /// The key is only rebuilt when a raw number differs from the previous frame's.
    fn layout(&mut self, width: f64, viewport: f64, depth: f64, bounds: Option<&Box3>) -> Key {
        let mut stale = self.layout_key.is_none() || bounds.is_some() != self.layout_bounded
            || self.layout_inputs[0] != width || self.layout_inputs[1] != viewport || self.layout_inputs[2] != depth;
        if let Some(bounds) = bounds {
            for axis in 0..3 {
                if stale { break; }
                stale = self.layout_inputs[3 + axis] != bounds.min[axis] || self.layout_inputs[6 + axis] != bounds.max[axis];
            }
        }
        if stale {
            self.layout_inputs[0] = width; self.layout_inputs[1] = viewport; self.layout_inputs[2] = depth;
            if let Some(bounds) = bounds {
                for axis in 0..3 { self.layout_inputs[3 + axis] = bounds.min[axis]; self.layout_inputs[6 + axis] = bounds.max[axis]; }
            }
            self.layout_bounded = bounds.is_some();
            let mut parts = [Part::Other(0); 9];
            parts[0] = fixed2(width); parts[1] = fixed2(viewport); parts[2] = fixed2(depth);
            let mut count = 3;
            if let Some(bounds) = bounds {
                for axis in 0..3 { parts[3 + axis] = fixed2(bounds.min[axis]); parts[6 + axis] = fixed2(bounds.max[axis]); }
                count = 9;
            }
            self.layout_key = Some(Key { parts, count });
        }
        self.layout_key.expect("layout key was just built")
    }
}

/// The new shadow frustum around `window` seen from the light, and the texel-based blur radius.
struct Fit { position: Vec3, target: Vec3, left: f64, right: f64, top: f64, bottom: f64, far: f64, radius: f64 }
fn fit(light: &mut Light, to_light: Vec3, window: &Box3) -> Fit {
    let centre = window.center();
    let reach = length(window.size()) / 2.0 + 400.0;
    let target = centre;
    let mut position = centre;
    position[0] += to_light[0] * reach; position[1] += to_light[1] * reach; position[2] += to_light[2] * reach;
    light.view.look_at(position, centre, UP);
    light.view.set_position(position);
    light.view.invert();
    let (mut left, mut right, mut bottom, mut top, mut far) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY, 0.0);
    for corner in 0..8 {
        let point = light.view.apply([
            if corner & 1 != 0 { window.max[0] } else { window.min[0] },
            if corner & 2 != 0 { window.max[1] } else { window.min[1] },
            if corner & 4 != 0 { window.max[2] } else { window.min[2] }]);
        left = jmin(left, point[0]); right = jmax(right, point[0]);
        bottom = jmin(bottom, point[1]); top = jmax(top, point[1]); far = jmax(far, -point[2]);
    }
    // Widen the narrow side, then leave room at every edge for the blur and the back
    // panel's wider disk, whose outer taps must stay in the map.
    let margin = PENUMBRA * (PANEL_REACH + 1.0) + 8.0;
    let width = right - left;
    let height = top - bottom;
    let span = jmax(width, height) / MAX_ASPECT;
    let pad_x = jmax(0.0, span - width) / 2.0 + margin;
    let pad_y = jmax(0.0, span - height) / 2.0 + margin;
    let (left, right, top, bottom, far) = (left - pad_x, right + pad_x, top + pad_y, bottom - pad_y, far + 60.0);
    // The blur is measured in texels: keep its width constant on the shelf.
    let texel = jmax(right - left, top - bottom) / SHADOW_SIZE;
    Fit { position, target, left, right, top, bottom, far, radius: clamp(PENUMBRA / texel, 2.0, 16.0) }
}

/// Creates the persistent state of one shadow rig.
#[no_mangle]
pub extern "C" fn shelf_light_new() -> *mut Light { Box::into_raw(Box::new(Light::new())) }

/// # Safety
/// `light` must come from `shelf_light_new` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn shelf_light_free(light: *mut Light) { if !light.is_null() { drop(Box::from_raw(light)); } }

/// Parameter and output lengths, so the host and the kernel cannot drift apart.
#[no_mangle]
pub extern "C" fn shelf_light_params() -> usize { PARAMS }
#[no_mangle]
pub extern "C" fn shelf_light_output() -> usize { OUTPUT }

/// # Safety
/// `light` is a live handle; `params` has PARAMS f64 and `output` OUTPUT f64, disjoint.
#[no_mangle]
pub unsafe extern "C" fn shelf_light_update(light: *mut Light, params: *const f64, output: *mut f64) -> u32 {
    let light = &mut *light;
    let p = std::slice::from_raw_parts(params, PARAMS);
    let out = std::slice::from_raw_parts_mut(output, OUTPUT);
    let (width, viewport, depth, scroll) = (p[0], p[1], p[2], p[3]);
    let bounds = if p[4] != 0.0 { Some(Box3 { min: [p[5], p[6], p[7]], max: [p[8], p[9], p[10]] }) } else { None };
    let transform = if p[11] != 0.0 { let mut e = [0.0; 16]; e.copy_from_slice(&p[12..28]); Some(Mat4(e)) } else { None };
    let (moving, force_refit) = (p[28] != 0.0, p[29] != 0.0);
    let mut dirty = p[30] != 0.0;
    let to_light = [p[31], p[32], p[33]];
    let (mut key_position, mut target_position) = ([p[34], p[35], p[36]], [p[37], p[38], p[39]]);
    let mut normal_bias = p[40];
    let mut camera = [p[41], p[42], p[43], p[44], p[45], p[46]];
    let mut assigned = false;
    let mut want = Box3::empty();
    window(&mut want, width, viewport, scroll, depth, bounds.as_ref(), 0.0);
    // Anything but a scroll (resize, depth, a turning or rebuilt cabinet) refits at once;
    // a scroll only once the view leaves the fitted slack.
    let layout = light.layout(width, viewport, depth, bounds.as_ref());
    let mut transform_changed = false;
    if let (Some(transform), true) = (transform.as_ref(), light.has_transform) {
        for index in 0..16 {
            if transform_changed { break; }
            transform_changed = (transform.0[index] - light.previous_transform.0[index]).abs() > 1e-7;
        }
    }
    let mut transported = false;
    if let (Some(transform), true, Some(bounds)) = (transform.as_ref(), light.has_transform, bounds.as_ref()) {
        if !dirty && !force_refit && !light.previous_bounds.is_empty() {
            let mut inverse = light.previous_transform;
            inverse.invert();
            let delta = Mat4::multiply(transform, &inverse);
            let e = &delta.0;
            let scale = e[0];
            let tolerance = jmax(1.0, scale.abs()) * 1e-7;
            // A finger zoom/pan changes every caster, receiver and fixture together. Moving
            // the existing light camera by that same similarity leaves every texel and its
            // stored depth identical. A cabinet turn relative to the daylight does change
            // its shadows, and deliberately takes the fit path.
            let similarity = scale.is_finite() && scale > 0.0 && [e[5] - scale, e[10] - scale, e[1], e[2], e[3], e[4], e[6], e[7], e[8], e[9], e[11], e[15] - 1.0]
                .iter().all(|value| value.abs() <= tolerance);
            let mut carried = light.previous_bounds;
            carried.apply(&delta);
            let unchanged = distance(carried.min, bounds.min) < 1e-4 && distance(carried.max, bounds.max) < 1e-4;
            let same_dimensions = light.frame.is_some_and(|frame| frame.count > 3 && frame.parts[..3] == [fixed2(width), fixed2(viewport), fixed2(depth)]);
            if similarity && unchanged && same_dimensions {
                key_position = delta.apply(key_position);
                target_position = delta.apply(target_position);
                for value in camera.iter_mut() { *value *= scale; }
                normal_bias *= scale;
                light.fitted.apply(&delta);
                transported = true;
            }
        }
    }
    // Transported boundaries accumulate harmless floating-point roundoff. Treat a fraction
    // of a physical millimetre as the same fitted edge.
    let fitted = &light.fitted;
    let covers = !fitted.is_empty()
        && fitted.min[0] <= want.min[0] + 1e-4 && fitted.max[0] >= want.max[0] - 1e-4
        && fitted.min[1] <= want.min[1] + 1e-4 && fitted.max[1] >= want.max[1] - 1e-4
        && fitted.min[2] <= want.min[2] + 1e-4 && fitted.max[2] >= want.max[2] - 1e-4;
    let mut refit = false;
    if force_refit || (!transported && (Some(layout) != light.frame || transform_changed)) || !covers {
        let mut region = light.fitted;
        window(&mut region, width, viewport, scroll, depth, bounds.as_ref(), viewport * SLACK);
        light.fitted = region;
        // A new fit uses the original screen-space contact offset.
        normal_bias = 0.45;
        let result = fit(light, to_light, &region);
        key_position = result.position; target_position = result.target;
        camera = [result.left, result.right, result.top, result.bottom, 1.0, result.far];
        out[18] = result.radius;
        dirty = true; assigned = true; refit = true;
    }
    light.frame = Some(layout);
    if let Some(transform) = transform {
        light.previous_transform = transform;
        light.has_transform = true;
        light.previous_bounds = bounds.unwrap_or_else(Box3::empty);
    } else { light.has_transform = false; }
    if light.coarse && !moving { dirty = true; assigned = true; }
    if dirty { light.coarse = moving && !force_refit; }
    out[0] = dirty as u8 as f64; out[1] = assigned as u8 as f64; out[2] = refit as u8 as f64; out[3] = transported as u8 as f64; out[4] = light.coarse as u8 as f64;
    out[5..8].copy_from_slice(&key_position); out[8..11].copy_from_slice(&target_position); out[11] = normal_bias;
    out[12..18].copy_from_slice(&camera);
    1
}
