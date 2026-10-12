//! Complete botanical leaf surface: both faces, edge walls, color, UV,
//! topology and accumulated vertex normals. Host Math coefficients preserve
//! the exact browser's transcendental rounding; no PRNG runs in this module.

fn smoothstep(a: f64, b: f64, value: f64) -> f64 {
    let t = ((value - a) / (b - a)).max(0.0).min(1.0);
    t * t * (3.0 - 2.0 * t)
}

pub(crate) fn indexed_normals(positions: &[f32], normals: &mut [f32], indices: &[u16]) {
    normals.fill(0.0);
    for triangle in indices.chunks_exact(3) {
        let a = triangle[0] as usize * 3;
        let b = triangle[1] as usize * 3;
        let c = triangle[2] as usize * 3;
        let cb = [f64::from(positions[c]) - f64::from(positions[b]),
            f64::from(positions[c + 1]) - f64::from(positions[b + 1]),
            f64::from(positions[c + 2]) - f64::from(positions[b + 2])];
        let ab = [f64::from(positions[a]) - f64::from(positions[b]),
            f64::from(positions[a + 1]) - f64::from(positions[b + 1]),
            f64::from(positions[a + 2]) - f64::from(positions[b + 2])];
        let face = [cb[1] * ab[2] - cb[2] * ab[1],
            cb[2] * ab[0] - cb[0] * ab[2], cb[0] * ab[1] - cb[1] * ab[0]];
        // Topology has three distinct vertex indices per triangle. Three
        // stores f32 after each face, not just after the whole accumulation.
        for vertex in [a, b, c] { for channel in 0..3 {
            normals[vertex + channel] = (f64::from(normals[vertex + channel]) + face[channel]) as f32;
        }}
    }
    for normal in normals.chunks_exact_mut(3) {
        let x = f64::from(normal[0]); let y = f64::from(normal[1]); let z = f64::from(normal[2]);
        let length = (x * x + y * y + z * z).sqrt();
        let inverse = 1.0 / if length == 0.0 || length.is_nan() { 1.0 } else { length };
        normal[0] = (x * inverse) as f32; normal[1] = (y * inverse) as f32; normal[2] = (z * inverse) as f32;
    }
}

/// Host validates rows/columns and arena lengths. Variant codes: upright=1,
/// succulent=2, monstera=3, palm=4, fern=5; other silhouettes are in host coefficients.
/// Row coefficients: profile, lobes, sin(f*7+twist*4), sin(f*pi*.85),
/// sin(f*19+twist*9), sin(f*pi), cos(twist*f), sin(twist*f), pow(sin(f*pi),.65).
/// Column coefficients: pow(abs(u), ridgeExponent), pow(abs(u),3), pow(abs(u),2).
/// Returns the written index count, allowing true Monstera gaps without
/// filling skipped faces. Each output array has its original Three type.
#[no_mangle]
pub unsafe extern "C" fn plant_leaf_mesh(
    row_coefficients: *const f64, column_coefficients: *const f64,
    length: f64, width: f64, curve: f64, tint: f64, hue: f64,
    rows: usize, columns: usize, variant: u32, detailed: u32,
    positions: *mut f32, normals: *mut f32, colors: *mut f32, uvs: *mut f32, indices: *mut u16,
) -> usize {
    let succulent = variant == 2;
    let upright = variant == 1;
    let thick = succulent || (detailed != 0 && variant != 4 && variant != 5);
    let count = (rows + 1) * (columns + 1);
    let vertices = count * if thick { 2 } else { 1 };
    let max_indices = rows * columns * (if thick { 12 } else { 6 })
        + (if thick { (rows + columns) * 12 } else { 0 });
    let row_coefficients = std::slice::from_raw_parts(row_coefficients, (rows + 1) * 9);
    let column_coefficients = std::slice::from_raw_parts(column_coefficients, (columns + 1) * 3);
    let positions = std::slice::from_raw_parts_mut(positions, vertices * 3);
    let normals = std::slice::from_raw_parts_mut(normals, vertices * 3);
    let colors = std::slice::from_raw_parts_mut(colors, vertices * 3);
    let uvs = std::slice::from_raw_parts_mut(uvs, vertices * 2);
    let indices = std::slice::from_raw_parts_mut(indices, max_indices);
    let thickness = if thick { width * (if succulent { if detailed != 0 { 0.15 } else { 0.07 } } else { 0.008 }) } else { 0.0 };
    let strip = (tint / 0.08 * 4.0).floor().min(3.0);
    let sides = if thick { 2 } else { 1 };
    for side in 0..sides { for row in 0..=rows { for col in 0..=columns {
        let f = row as f64 / rows as f64;
        let u = col as f64 / columns as f64 * 2.0 - 1.0;
        let rc = &row_coefficients[row * 9..row * 9 + 9];
        let cc = &column_coefficients[col * 3..col * 3 + 3];
        let sign = if u < 0.0 { -1.0 } else if u > 0.0 { 1.0 } else { u };
        let asymmetry = 1.0 + 0.055 * rc[2] * sign;
        let x = width * 0.5 * rc[0] * rc[1] * u * asymmetry;
        let bow = rc[3] * length * curve;
        let ridge = if upright { width * 0.15 * (1.0 - f * 0.6) * u * u }
            else { width * (if succulent { 0.075 } else { 0.065 }) * cc[0] };
        let edge_curl = if succulent || upright { 0.0 } else { width * 0.022 * cc[1] * rc[4] * rc[5] };
        let z = bow + ridge + edge_curl;
        let flesh = if succulent { thickness * rc[8] * (1.0 - u * u).max(0.0).sqrt() * (1.25 - f * 0.45) } else { thickness };
        let at = side * count + row * (columns + 1) + col;
        positions[at * 3] = (x * rc[6] + z * rc[7]) as f32;
        positions[at * 3 + 1] = (f * length) as f32;
        positions[at * 3 + 2] = (z * rc[6] - x * rc[7] + if succulent {
            (if side != 0 { -1.0 } else { 1.0 }) * flesh
        } else { -(side as f64) * flesh }) as f32;
        uvs[at * 2] = if upright {
            ((strip + 0.04 + col as f64 / columns as f64 * (1.0 - 0.04 * 2.0)) / 4.0) as f32
        } else { (0.012 + col as f64 / columns as f64 * (1.0 - 0.012 * 2.0)) as f32 };
        uvs[at * 2 + 1] = (0.012 + f * (1.0 - 0.012 * 2.0)) as f32;
        let edge = cc[2];
        let ridge = 1.0 - u.abs();
        let blush = if succulent { smoothstep(0.78, 1.0, f) * (0.6 + edge * 0.4) } else { 0.0 };
        let side = side as f64;
        if detailed != 0 {
            colors[at * 3] = (0.78 + ridge * 0.12 + tint + side * 0.04 + hue * 0.8 + blush * 0.34) as f32;
            colors[at * 3 + 1] = (0.85 + ridge * 0.10 + tint + side * 0.025 + hue * 0.15 - blush * 0.12) as f32;
            colors[at * 3 + 2] = (0.73 + ridge * 0.12 + tint + side * 0.055 - hue * 0.5 + blush * 0.04) as f32;
        } else {
            colors[at * 3] = (0.23 + ridge * 0.11 + tint + edge * 0.04) as f32;
            colors[at * 3 + 1] = (0.36 + ridge * 0.15 + tint) as f32;
            colors[at * 3 + 2] = (0.16 + ridge * 0.075 + tint * 0.5) as f32;
        }
    }}}
    let mut next = 0;
    for row in 0..rows { for col in 0..columns {
        let f = (row as f64 + 0.5) / rows as f64;
        let u = ((col as f64 + 0.5) / columns as f64 * 2.0 - 1.0).abs();
        if variant == 3 && u > 0.15 && u < 0.48 && [0.32, 0.54, 0.74].iter().any(|center| (f - center).abs() < 0.045) { continue; }
        let a = (row * (columns + 1) + col) as u16;
        let b = a + 1; let c = a + columns as u16 + 1; let d = c + 1;
        indices[next..next + 6].copy_from_slice(&[a, b, d, a, d, c]); next += 6;
        if thick {
            let n = count as u16;
            indices[next..next + 6].copy_from_slice(&[a + n, d + n, b + n, a + n, c + n, d + n]); next += 6;
        }
    }}
    if thick {
        let n = count as u16;
        let mut edge = |a: usize, b: usize| {
            let a = a as u16; let b = b as u16;
            indices[next..next + 6].copy_from_slice(&[a, a + n, b + n, a, b + n, b]); next += 6;
        };
        for row in 0..rows {
            edge(row * (columns + 1), (row + 1) * (columns + 1));
            edge((row + 1) * (columns + 1) + columns, row * (columns + 1) + columns);
        }
        for col in 0..columns {
            edge(col + 1, col); edge(rows * (columns + 1) + col, rows * (columns + 1) + col + 1);
        }
    }
    indexed_normals(positions, normals, &indices[..next]);
    next
}
