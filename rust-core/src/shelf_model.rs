//! Physical cabinet dimensions and every fitted book, plant and lamp.
//! The host keeps DOM/metadata ownership. No drawing quality is changed.
const INPUT: usize = 8;
const ROW: usize = 7;
const ENTRY: usize = 7;

/// # Safety
/// Live, disjoint arenas: spec has 9 + spec[8] values, input count*8,
/// output output_length. The host owns and releases the enclosing allocation.
#[no_mangle]
pub unsafe extern "C" fn shelf_model(
    width: f64, source_rows: usize, count: usize, spec: *const f64,
    input: *const f64, output: *mut f64, output_length: usize,
) -> u32 {
    if count > 8192 || source_rows > 3000 || !width.is_finite() || width <= 0.0 { return 0; }
    let cfg = std::slice::from_raw_parts(spec, 9);
    if cfg.iter().any(|n| !n.is_finite() || *n <= 0.0)
        || cfg[8].fract() != 0.0 || cfg[8] > 64.0 { return 0; }
    let slots = cfg[8] as usize;
    let bottoms = std::slice::from_raw_parts(spec.add(9), slots);
    if bottoms.iter().any(|n| !n.is_finite() || *n <= 0.0) { return 0; }
    let units = source_rows.div_ceil(slots).max(1);
    let rows = units * slots;
    let length = 4 + rows * ROW + count * ENTRY;
    if output_length < length { return 0; }
    let input = std::slice::from_raw_parts(input, count * INPUT);
    for e in input.chunks_exact(INPUT) {
        if e.iter().any(|n| !n.is_finite()) || e[0].fract() != 0.0
            || e[2] <= 0.0 || e[3] <= 0.0 || e[4] < 0.0 || e[5] <= 0.0
            || ![0.0, 1.0, 2.0].contains(&e[6]) || ![0.0, 1.0].contains(&e[7])
            || (e[6] == 2.0 && e[4] == 0.0) { return 0; }
    }
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
            16.0_f64.max((cfg[3] + 4.0) * scale), top * scale, ceiling * scale, bottoms[slot] * scale]);
    }
    for (index, e) in input.chunks_exact(INPUT).enumerate() {
        let row = e[0].max(0.0).min((rows - 1) as f64) as usize;
        let at = 4 + row * ROW;
        let left = out[at]; let top = out[at + 4];
        let ceiling = out[at + 5]; let bottom = out[at + 6];
        let clearance = bottom - top - 4.0 * scale;
        let (height, breadth, depth, y, rooftop) = if e[6] == 2.0 {
            let fit = 1.0_f64.min(clearance / e[2]).min(cfg[6] * scale / e[4]);
            (e[2] * fit, e[3] * fit, e[4] * fit,
                if e[7] == 1.0 { ceiling } else { bottom - e[2] * fit / 2.0 }, false)
        } else {
            let plant = e[6] == 1.0;
            let h = if plant { e[2] } else { cfg[7] * scale * e[5] };
            let w = if plant { e[3] } else { h * e[3] / e[2] };
            let roof = plant && h > clearance;
            let fit = if plant { 1.0 } else { 1.0_f64.min(clearance / h).min(cfg[6] * scale / w) };
            (h * fit, w * fit, e[4] * fit,
                (if roof { 0.0 } else { bottom }) - h * fit / 2.0, roof)
        };
        let at = 4 + rows * ROW + index * ENTRY;
        out[at..at + ENTRY].copy_from_slice(&[left + e[1], height, breadth, depth,
            y, if rooftop { 1.0 } else { 0.0 }, 15.0 * scale]);
    }
    if out.iter().all(|n| n.is_finite()) { 1 } else { 0 }
}
