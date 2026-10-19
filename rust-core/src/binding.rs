//! Curved binding mesh. The profile's sines, cosines and normal lengths come from the host's
//! Math (see host_math.rs) so the existing browser's exact silhouette and IEEE rounding remain
//! unchanged; the plan derives the mesh's coefficients from them.
use crate::host_math::{put, COS, HYPOT, SIN};

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

// ---- Plan: the sines, cosines and lengths of the profile come from the host's Math (host_math.rs).

/// First stage: the sine and cosine of every column's angle. `params`: width, height, thickness,
/// segments, rows. Returns the number of requests (2 per column).
/// # Safety
/// `params` holds 5 f64, `requests` room for 3 f64 per request; segments is 1..=512.
#[no_mangle]
pub unsafe extern "C" fn binding_plan_a(params: *const f64, requests: *mut f64) -> u32 {
    let segments = std::slice::from_raw_parts(params, 5)[3] as usize;
    if !(1..=512).contains(&segments) { return 0; }
    let out = std::slice::from_raw_parts_mut(requests, (segments + 1) * 2 * 3);
    for i in 0..=segments {
        let angle = i as f64 / segments as f64 * std::f64::consts::PI;
        put(out, i * 2, SIN, angle, 0.0);
        put(out, i * 2 + 1, COS, angle, 0.0);
    }
    ((segments + 1) * 2) as u32
}

/// Second stage: each column's u, sine, cosine and the unnormalised normal (5 f64 per column in
/// `coefficients`) and the normal's length (`HYPOT(nx, nz)`, one request per column).
/// # Safety
/// As `binding_plan_a`; `answers` holds its results, `coefficients` (segments + 1) * 5 f64.
#[no_mangle]
pub unsafe extern "C" fn binding_plan_b(params: *const f64, answers: *const f64, coefficients: *mut f64, requests: *mut f64) -> u32 {
    let p = std::slice::from_raw_parts(params, 5);
    let (thickness, segments) = (p[2], p[3] as usize);
    if !(1..=512).contains(&segments) { return 0; }
    let answers = std::slice::from_raw_parts(answers, (segments + 1) * 2);
    let data = std::slice::from_raw_parts_mut(coefficients, (segments + 1) * 5);
    let out = std::slice::from_raw_parts_mut(requests, (segments + 1) * 3);
    let bulge = thickness * 0.38;
    for i in 0..=segments {
        let (sine, cosine) = (answers[i * 2], answers[i * 2 + 1]);
        let nx = -sine / bulge;
        let nz = -cosine / (thickness / 2.0);
        data[i * 5..i * 5 + 5].copy_from_slice(&[i as f64 / segments as f64, sine, cosine, nx, nz]);
        put(out, i, HYPOT, nx, nz);
    }
    (segments + 1) as u32
}

/// Last stage: unit normals from their lengths, then the mesh. `relief` is null or one f64 per vertex.
/// # Safety
/// As `binding_mesh`; `lengths` holds one f64 per column.
#[no_mangle]
pub unsafe extern "C" fn binding_finish(params: *const f64, lengths: *const f64, coefficients: *mut f64, relief: *const f64,
    positions: *mut f32, normals: *mut f32, uvs: *mut f32, indices: *mut u32) {
    let p = std::slice::from_raw_parts(params, 5);
    let (segments, rows) = (p[3] as usize, p[4] as usize);
    let lengths = std::slice::from_raw_parts(lengths, segments + 1);
    let data = std::slice::from_raw_parts_mut(coefficients, (segments + 1) * 5);
    for i in 0..=segments {
        data[i * 5 + 3] /= lengths[i];
        data[i * 5 + 4] /= lengths[i];
    }
    binding_mesh(coefficients, relief, p[0], p[1], p[2], segments, rows, positions, normals, uvs, indices);
}

/// Exact sampling of the generated RGBA spine relief, in mesh vertex order.
/// The host copies the bitmap once, instead of calling JS for every vertex.
#[no_mangle]
pub extern "C" fn binding_relief_index(u:f64,v:f64,width:u32,height:u32)->f64{
 (crate::jsnum::min(height as f64-1.0,((1.0-v)*height as f64).floor())*width as f64
  +crate::jsnum::min(width as f64-1.0,(u*width as f64).floor()))*4.0+3.0
}
#[no_mangle]
pub extern "C" fn binding_relief_alpha(alpha:f64)->f64{alpha/255.0}
#[no_mangle]
pub unsafe extern "C" fn binding_sample_relief(raw:*const u8,width:u32,height:u32,segments:u32,rows:u32,out:*mut f64)->u32{
 if width==0||height==0||width>2048||height>2048||width as usize*height as usize>1048576
  ||segments==0||segments>512||rows==0||rows>1024||(segments+1)*(rows+1)>200000{return 0;}
 let pixels=std::slice::from_raw_parts(raw,width as usize*height as usize*4);
 let output=std::slice::from_raw_parts_mut(out,(segments as usize+1)*(rows as usize+1));
 for i in 0..=segments{for j in 0..=rows{
  let at=binding_relief_index(i as f64/segments as f64,j as f64/rows as f64,width,height) as usize;
  output[i as usize*(rows as usize+1)+j as usize]=pixels[at] as f64/255.0;
 }}
 1
}
