//! Curved binding mesh. Trigonometric coefficients come from the host so the
//! existing browser's exact silhouette and IEEE rounding remain unchanged.

/// # Safety
/// Coefficients contain five f64 values per column (u, sin, cos, nx, nz).
/// Relief, if present, contains one f64 per vertex. Output capacities are
/// vertices*3/3/2 f32 and segments*rows*6 u32. The host validates all counts.
#[no_mangle]
pub unsafe extern "C" fn binding_mesh(
    coefficients: *const f64, relief: *const f64,
    width: f64, height: f64, thickness: f64, segments: usize, rows: usize,
    positions: *mut f32, normals: *mut f32, uvs: *mut f32, indices: *mut u32,
) {
    let vertices = (segments + 1) * (rows + 1);
    let coefficients = std::slice::from_raw_parts(coefficients, (segments + 1) * 5);
    let relief = if relief.is_null() { None } else { Some(std::slice::from_raw_parts(relief, vertices)) };
    let positions = std::slice::from_raw_parts_mut(positions, vertices * 3);
    let normals = std::slice::from_raw_parts_mut(normals, vertices * 3);
    let uvs = std::slice::from_raw_parts_mut(uvs, vertices * 2);
    let indices = std::slice::from_raw_parts_mut(indices, segments * rows * 6);
    let bulge = thickness * 0.38;
    for i in 0..=segments {
        let c = &coefficients[i * 5..i * 5 + 5];
        for j in 0..=rows {
            let k = i * (rows + 1) + j;
            let v = j as f64 / rows as f64;
            let depth = relief.map_or(0.0, |samples| samples[k] * height * 0.0007);
            positions[k * 3] = (-width / 2.0 - bulge * c[1] - c[3] * depth) as f32;
            positions[k * 3 + 1] = ((v - 0.5) * height) as f32;
            positions[k * 3 + 2] = (-thickness / 2.0 * c[2] - c[4] * depth) as f32;
            normals[k * 3] = c[3] as f32;
            normals[k * 3 + 1] = 0.0;
            normals[k * 3 + 2] = c[4] as f32;
            uvs[k * 2] = c[0] as f32;
            uvs[k * 2 + 1] = v as f32;
            if i < segments && j < rows {
                let n = k as u32;
                let span = (rows + 1) as u32;
                let at = (i * rows + j) * 6;
                indices[at..at + 6].copy_from_slice(&[n, n + span, n + 1, n + 1, n + span, n + span + 1]);
            }
        }
    }
    if relief.is_none() { return; }
    // Three reads f32 positions, performs each face calculation in f64 and
    // writes its accumulated normals to f32 after every triangle.
    normals.fill(0.0);
    for triangle in indices.chunks_exact(3) {
        let a = triangle[0] as usize * 3;
        let b = triangle[1] as usize * 3;
        let c = triangle[2] as usize * 3;
        let cb = [f64::from(positions[c]) - f64::from(positions[b]), f64::from(positions[c + 1]) - f64::from(positions[b + 1]), f64::from(positions[c + 2]) - f64::from(positions[b + 2])];
        let ab = [f64::from(positions[a]) - f64::from(positions[b]), f64::from(positions[a + 1]) - f64::from(positions[b + 1]), f64::from(positions[a + 2]) - f64::from(positions[b + 2])];
        let face = [cb[1] * ab[2] - cb[2] * ab[1], cb[2] * ab[0] - cb[0] * ab[2], cb[0] * ab[1] - cb[1] * ab[0]];
        for vertex in [a, b, c] {
            for channel in 0..3 { normals[vertex + channel] = (f64::from(normals[vertex + channel]) + face[channel]) as f32; }
        }
    }
    for normal in normals.chunks_exact_mut(3) {
        let x = f64::from(normal[0]); let y = f64::from(normal[1]); let z = f64::from(normal[2]);
        let length = (x * x + y * y + z * z).sqrt();
        // JS Vector3.normalize uses length || 1, including NaN.
        let inverse = 1.0 / if length == 0.0 || length.is_nan() { 1.0 } else { length };
        normal[0] = (x * inverse) as f32;
        normal[1] = (y * inverse) as f32;
        normal[2] = (z * inverse) as f32;
    }
}
