//! Physical cabinet dimensions and every fitted book, plant and lamp.
//! The host keeps DOM/metadata ownership. No drawing quality is changed.
//!
//! This is the only implementation of the layout (the JavaScript twin is a frozen test
//! reference), so it is total: measured geometry of a hidden or collapsed shelf is zero, negative
//! or NaN, and every such value flows through exactly as the original JavaScript arithmetic
//! produced it (`Math.min/max` NaN and signed-zero rules, IEEE division, no early rejection).
use crate::jsmath::{jmax, jmin};

const INPUT: usize = 8;
const ROW: usize = 7;
const ENTRY: usize = 7;
/// Memory guard only: a cabinet this large is already far beyond any library.
const LIMIT: usize = 1 << 17;

/// Returns 1 when `output` is filled, 2 when an entry's bay is not a whole row number
/// (the original read a property of `undefined` there), 0 when the arguments are structurally
/// unusable (limits, a bay count outside 1..=64, an output buffer that is too short).
///
/// # Safety
/// Live, disjoint arenas: spec has 9 + spec[8] values, input count*8,
/// output output_length. The host owns and releases the enclosing allocation.
#[no_mangle]
pub unsafe extern "C" fn shelf_model(
    width: f64, source_rows: usize, count: usize, spec: *const f64,
    input: *const f64, output: *mut f64, output_length: usize,
) -> u32 {
    if count > LIMIT || source_rows > LIMIT { return 0; }
    let cfg = std::slice::from_raw_parts(spec, 9);
    if cfg[8].fract() != 0.0 || !(1.0..=64.0).contains(&cfg[8]) { return 0; }
    let slots = cfg[8] as usize;
    let bottoms = std::slice::from_raw_parts(spec.add(9), slots);
    let units = source_rows.div_ceil(slots).max(1);
    let rows = units * slots;
    let length = 4 + rows * ROW + count * ENTRY;
    if output_length < length { return 0; }
    let input = std::slice::from_raw_parts(input, count * INPUT);
    let scale = width / cfg[0];
    let gap = 24.0 * scale;
    let out = std::slice::from_raw_parts_mut(output, length);
    out[..4].copy_from_slice(&[width * units as f64 + gap * (units - 1) as f64,
        cfg[1] * scale, cfg[2] * scale, units as f64]);
    for index in 0..rows {
        let slot = index % slots;
        let unit = index / slots;
        let left = unit as f64 * (width + gap);
        let top = if slot > 0 { bottoms[slot - 1] + cfg[4] } else { cfg[3] };
        let ceiling = if slot > 0 { bottoms[slot - 1] + cfg[5] } else { cfg[5] };
        let at = 4 + index * ROW;
        out[at..at + ROW].copy_from_slice(&[left, left + width, unit as f64,
            jmax(16.0, (cfg[3] + 4.0) * scale), top * scale, ceiling * scale, bottoms[slot] * scale]);
    }
    for (index, e) in input.chunks_exact(INPUT).enumerate() {
        // Math.max(0, Math.min(rows.length - 1, shelf)): +-Infinity clamps, NaN stays NaN.
        let at_row = jmax(0.0, jmin((rows - 1) as f64, e[0]));
        if at_row.fract() != 0.0 || at_row.is_nan() { return 2; }
        let at = 4 + at_row as usize * ROW;
        let left = out[at]; let top = out[at + 4];
        let ceiling = out[at + 5]; let bottom = out[at + 6];
        let clearance = bottom - top - 4.0 * scale;
        let (height, breadth, depth, y, rooftop) = if e[6] == 2.0 {
            let fit = jmin(jmin(1.0, clearance / e[2]), cfg[6] * scale / e[4]);
            (e[2] * fit, e[3] * fit, e[4] * fit,
                if e[7] == 1.0 { ceiling } else { bottom - e[2] * fit / 2.0 }, false)
        } else {
            let plant = e[6] == 1.0;
            let h = if plant { e[2] } else { cfg[7] * scale * e[5] };
            let w = if plant { e[3] } else { h * e[3] / e[2] };
            let valid_plant = plant && h.is_finite() && h > 0.0 && clearance.is_finite() && clearance > 0.0;
            let roof = plant && !valid_plant && h > clearance;
            // Fit the complete plant uniformly inside its saved bay; foliage and pot
            // keep their proportions and never jump onto the cabinet roof.
            let fit = if valid_plant {
                jmin(1.0, clearance / h)
            } else if plant { 1.0 } else { jmin(jmin(1.0, clearance / h), cfg[6] * scale / w) };
            (h * fit, w * fit, e[4] * fit,
                (if roof { 0.0 } else { bottom }) - h * fit / 2.0, roof)
        };
        let at = 4 + rows * ROW + index * ENTRY;
        out[at..at + ENTRY].copy_from_slice(&[left + e[1], height, breadth, depth,
            y, if rooftop { 1.0 } else { 0.0 }, 15.0 * scale]);
    }
    1
}
