//! Ribbon mesh construction from exact host-computed trigonometric samples.
//! Position/normal arithmetic follows Three's operation and f32 write order.

fn normalized(v: [f64; 3]) -> [f64; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let inverse = 1.0 / if length == 0.0 { 1.0 } else { length };
    [v[0] * inverse, v[1] * inverse, v[2] * inverse]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// # Safety
/// `indices` has room for steps * 24 + 12 u16 entries. Steps is bounded by
/// the host, so four vertices per section fit the original u16 index buffer.
#[no_mangle]
pub unsafe extern "C" fn bookmark_topology(indices: *mut u16, steps: usize) {
    let output = std::slice::from_raw_parts_mut(indices, steps * 24 + 12);
    for i in 0..steps {
        let k = (i * 4) as u16;
        let n = k + 4;
        output[i * 24..i * 24 + 24].copy_from_slice(&[
            k, k + 1, n, k + 1, n + 1, n,
            k + 2, n + 2, k + 3, k + 3, n + 2, n + 3,
            k, n, k + 2, k + 2, n, n + 2,
            k + 1, k + 3, n + 1, k + 3, n + 3, n + 1,
        ]);
    }
    let end = (steps * 4) as u16;
    output[steps * 24..].copy_from_slice(&[0, 2, 1, 1, 2, 3, end, end + 1, end + 2, end + 1, end + 3, end + 2]);
}

/// # Safety
/// Host arenas contain (steps+1)*7 f64 centreline coefficients (xyz, cos,
/// sin, tuck, on-page), steps+1 f64 distances, 12/8/12 f32 output components
/// per section, and a topology produced by bookmark_topology for these steps.
#[no_mangle]
pub unsafe extern "C" fn bookmark_mesh(
    coefficients: *const f64, distances: *mut f64, steps: usize,
    ribbon_width: f64, fabric_depth: f64, lay: f64,
    positions: *mut f32, uvs: *mut f32, normals: *mut f32, indices: *const u16,
) {
    let count = steps + 1;
    let coefficients = std::slice::from_raw_parts(coefficients, count * 7);
    let distances = std::slice::from_raw_parts_mut(distances, count);
    let positions = std::slice::from_raw_parts_mut(positions, count * 12);
    let uvs = std::slice::from_raw_parts_mut(uvs, count * 8);
    let normals = std::slice::from_raw_parts_mut(normals, count * 12);
    let indices = std::slice::from_raw_parts(indices, steps * 24 + 12);
    distances[steps] = 0.0;
    for i in (1..=steps).rev() {
        let at = i * 7;
        let previous = at - 7;
        let dx = coefficients[at] - coefficients[previous];
        let dy = coefficients[at + 1] - coefficients[previous + 1];
        let dz = coefficients[at + 2] - coefficients[previous + 2];
        distances[i - 1] = distances[i] + (dx * dx + dy * dy + dz * dz).sqrt();
    }
    for i in 0..count {
        let at = i * 7;
        let previous = i.saturating_sub(1) * 7;
        let next = (i + 1).min(steps) * 7;
        let mut tangent = [
            coefficients[next] - coefficients[previous],
            coefficients[next + 1] - coefficients[previous + 1],
            coefficients[next + 2] - coefficients[previous + 2],
        ];
        if tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2] < 1e-12 {
            tangent = [0.0, 0.0, -1.0];
        } else { tangent = normalized(tangent); }
        let across = normalized([
            1.0 + tangent[0] * -tangent[0],
            0.0 + tangent[1] * -tangent[0],
            0.0 + tangent[2] * -tangent[0],
        ]);
        let face = cross(across, tangent);
        let cosine = coefficients[at + 3];
        let sine = coefficients[at + 4];
        let mut side = [0.0; 3];
        let mut normal = [0.0; 3];
        for channel in 0..3 {
            side[channel] = (across[channel] * cosine + face[channel] * sine) * (ribbon_width / 2.0);
            normal[channel] = (across[channel] * -sine + face[channel] * cosine) * (fabric_depth / 2.0);
        }
        let x = coefficients[at];
        let y = coefficients[at + 1];
        let z = coefficients[at + 2] + coefficients[at + 5]
            + if coefficients[at + 6] != 0.0 { lay * side[2].abs() } else { 0.0 };
        let vertices = [
            x - side[0] + normal[0], y - side[1] + normal[1], z - side[2] + normal[2],
            x + side[0] + normal[0], y + side[1] + normal[1], z + side[2] + normal[2],
            x - side[0] - normal[0], y - side[1] - normal[1], z - side[2] - normal[2],
            x + side[0] - normal[0], y + side[1] - normal[1], z + side[2] - normal[2],
        ];
        for channel in 0..12 { positions[i * 12 + channel] = vertices[channel] as f32; }
        let v = (distances[i] / ribbon_width) as f32;
        uvs[i * 8..i * 8 + 8].copy_from_slice(&[0.0, v, 1.0, v, 0.0, v, 1.0, v]);
    }
    // Match BufferGeometry.computeVertexNormals: read f32 positions, form
    // each face in f64, and round each accumulated vertex after every face.
    normals.fill(0.0);
    for triangle in indices.chunks_exact(3) {
        let a = triangle[0] as usize * 3;
        let b = triangle[1] as usize * 3;
        let c = triangle[2] as usize * 3;
        let cb = [f64::from(positions[c]) - f64::from(positions[b]), f64::from(positions[c + 1]) - f64::from(positions[b + 1]), f64::from(positions[c + 2]) - f64::from(positions[b + 2])];
        let ab = [f64::from(positions[a]) - f64::from(positions[b]), f64::from(positions[a + 1]) - f64::from(positions[b + 1]), f64::from(positions[a + 2]) - f64::from(positions[b + 2])];
        let face = cross(cb, ab);
        for vertex in [a, b, c] {
            for channel in 0..3 { normals[vertex + channel] = (f64::from(normals[vertex + channel]) + face[channel]) as f32; }
        }
    }
    for vertex in normals.chunks_exact_mut(3) {
        let normal = normalized([f64::from(vertex[0]), f64::from(vertex[1]), f64::from(vertex[2])]);
        for channel in 0..3 { vertex[channel] = normal[channel] as f32; }
    }
}
