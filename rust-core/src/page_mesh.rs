//! Exact page-block and turned-leaf meshes. The host supplies pow/hypot
//! coefficients using the same browser Math implementation as the old mesh.
//! All remaining arithmetic stays f64 until each original Float32 write.

struct Mesh<'a> {
    positions: &'a mut [f32], normals: &'a mut [f32], uvs: &'a mut [f32],
    colors: &'a mut [f32], indices: &'a mut [u16], vertex_count: usize, index_count: usize,
}

impl<'a> Mesh<'a> {
    unsafe fn new(vertices: usize, count: usize, positions: *mut f32, normals: *mut f32,
        uvs: *mut f32, colors: *mut f32, indices: *mut u16) -> Self {
        Self {
            positions: std::slice::from_raw_parts_mut(positions, vertices * 3),
            normals: std::slice::from_raw_parts_mut(normals, vertices * 3),
            uvs: std::slice::from_raw_parts_mut(uvs, vertices * 2),
            colors: std::slice::from_raw_parts_mut(colors, vertices * 3),
            indices: std::slice::from_raw_parts_mut(indices, count), vertex_count: 0, index_count: 0,
        }
    }
    fn vertex(&mut self, x: f64, y: f64, z: f64, normal: [f64; 3], u: f64, v: f64, shade: f64) -> u16 {
        let at = self.vertex_count;
        self.positions[at * 3..at * 3 + 3].copy_from_slice(&[x as f32, y as f32, z as f32]);
        self.normals[at * 3..at * 3 + 3].copy_from_slice(&[normal[0] as f32, normal[1] as f32, normal[2] as f32]);
        self.uvs[at * 2..at * 2 + 2].copy_from_slice(&[u as f32, v as f32]);
        self.colors[at * 3..at * 3 + 3].fill(shade as f32);
        self.vertex_count += 1;
        at as u16
    }
    fn triangles(&mut self, values: [u16; 6]) {
        self.indices[self.index_count..self.index_count + 6].copy_from_slice(&values);
        self.index_count += 6;
    }
    fn quad(&mut self, a: u16, b: u16, c: u16, d: u16) { self.triangles([a, b, d, b, c, d]); }
}

fn spine_x(width: f64, back: f64, z_back: f64, z: f64) -> f64 {
    let ratio = z / z_back;
    -width / 2.0 - back * (1.0 - ratio * ratio).max(0.0).sqrt()
}
fn fore_x(fore: f64, bend: f64, half: f64, z: f64) -> f64 {
    let ratio = z / half;
    fore - bend * (1.0 - ratio * ratio)
}

/// # Safety
/// Host validates counts (8/3 or 16/6), finite physical dimensions and arenas.
/// Coefficients: [pressed shade, fore normal x, fore normal z] per column;
/// row_fractions has rows+1 browser-computed (row/rows)**1.7 values.
#[no_mangle]
pub unsafe extern "C" fn page_block_mesh(
    coefficients: *const f64, row_fractions: *const f64,
    width: f64, height: f64, thickness: f64, board: f64, inset: f64, columns: usize, rows: usize,
    positions: *mut f32, normals: *mut f32, uvs: *mut f32, colors: *mut f32, indices: *mut u16,
) {
    let coefficients = std::slice::from_raw_parts(coefficients, (columns + 1) * 3);
    let fractions = std::slice::from_raw_parts(row_fractions, rows + 1);
    let vertices = 2 * (columns + 1) * (rows + 1) + 2 * (columns + 1) + 8;
    let index_count = columns * rows * 12 + columns * 6 + 12;
    let mut mesh = Mesh::new(vertices, index_count, positions, normals, uvs, colors, indices);
    let half = (thickness - board * 2.4) / 2.0;
    let top = height / 2.0 - inset;
    let rim = board * 1.1;
    let back = (thickness * 0.38 - rim - board * 0.15).max(0.0);
    let z_back = thickness / 2.0 - rim;
    let bend = (thickness * 0.09).min(width * 0.025);
    let fore = width / 2.0 - inset * 0.7;
    let tile = height * 0.2;
    for side in [1.0, -1.0] {
        let start = mesh.vertex_count;
        for i in 0..=columns {
            let z = -half + i as f64 / columns as f64 * half * 2.0;
            let x0 = spine_x(width, back, z_back, z);
            let x1 = fore_x(fore, bend, half, z);
            let pressed = coefficients[i * 3];
            for &t in fractions {
                // MathUtils.lerp: (1-t)*x0 + t*x1, never x0+(x1-x0)*t.
                mesh.vertex((1.0 - t) * x0 + t * x1, side * top, z, [0.0, side, 0.0],
                    (z + half) / tile, 0.98 - 0.44 * t, pressed * (0.82 + 0.18 * (t * 5.0).min(1.0)));
            }
        }
        for i in 0..columns { for k in 0..rows {
            let a = (start + i * (rows + 1) + k) as u16;
            let b = a + (rows + 1) as u16;
            if side > 0.0 { mesh.quad(a, b, b + 1, a + 1); }
            else { mesh.quad(a, a + 1, b + 1, b); }
        }}
    }
    let start = mesh.vertex_count;
    for i in 0..=columns {
        let z = -half + i as f64 / columns as f64 * half * 2.0;
        let c = &coefficients[i * 3..i * 3 + 3];
        for y in [-top, top] {
            mesh.vertex(fore_x(fore, bend, half, z), y, z, [c[1], 0.0, c[2]],
                (z + half) / tile, 0.24 + 0.22 * y / top, c[0]);
        }
    }
    for i in 0..columns { let a = (start + i * 2) as u16; mesh.quad(a, a + 1, a + 3, a + 2); }
    for side in [1.0, -1.0] {
        let z = side * half;
        let x0 = spine_x(width, back, z_back, z);
        let x1 = fore_x(fore, bend, half, z);
        let a = mesh.vertex(x0, -top, z, [0.0, 0.0, side], 0.5, 0.5, 1.0);
        mesh.vertex(x1, -top, z, [0.0, 0.0, side], 0.5, 0.5, 1.0);
        mesh.vertex(x1, top, z, [0.0, 0.0, side], 0.5, 0.5, 1.0);
        mesh.vertex(x0, top, z, [0.0, 0.0, side], 0.5, 0.5, 1.0);
        if side > 0.0 { mesh.quad(a, a + 1, a + 2, a + 3); }
        else { mesh.quad(a, a + 3, a + 2, a + 1); }
    }
}

fn rise(x: f64, gutter: f64) -> f64 {
    let t = (x / gutter).min(1.0);
    0.16 + (1.0 - 0.16) * t * (2.0 - t)
}
fn shade(x: f64, gutter: f64) -> f64 {
    let amount = (1.0 - x / (gutter * 1.7)).max(0.0);
    1.0 - 0.34 * (amount * amount)
}

/// # Safety
/// Host validates columns 1..512 and all finite physical dimensions/arenas.
/// Coefficients contain [x, face normal x, face normal z] per column. x uses
/// the browser's (column/columns)**1.7 and normal lengths its Math.hypot.
#[no_mangle]
pub unsafe extern "C" fn leaf_stack_mesh(
    coefficients: *const f64, width: f64, height: f64, depth: f64, board: f64, inset: f64, columns: usize,
    positions: *mut f32, normals: *mut f32, uvs: *mut f32, colors: *mut f32, indices: *mut u16,
) {
    let coefficients = std::slice::from_raw_parts(coefficients, (columns + 1) * 3);
    let vertices = 6 * (columns + 1) + 4;
    let index_count = columns * 18 + 6;
    let mut mesh = Mesh::new(vertices, index_count, positions, normals, uvs, colors, indices);
    let top = height / 2.0 - inset - height * 0.0012;
    let fore = width - inset * 0.7 - height * 0.0015;
    let base = -board / 2.0 - height * 0.0003;
    let tile = height * 0.2;
    let gutter = (fore * 0.2).min(height * 0.075);
    for c in coefficients.chunks_exact(3) {
        let x = c[0];
        for y in [-top, top] {
            mesh.vertex(x, y, base - depth * rise(x, gutter), [c[1], 0.0, c[2]],
                x / fore, y / top / 2.0 + 0.5, shade(x, gutter));
        }
    }
    for i in 0..columns { let a = (i * 2) as u16; mesh.triangles([a, a + 1, a + 2, a + 1, a + 3, a + 2]); }
    let edge = mesh.vertex_count as u16;
    for y in [-top, top] { for k in [0.0, 1.0] {
        mesh.vertex(fore, y, if k != 0.0 { base - depth * rise(fore, gutter) } else { base }, [1.0, 0.0, 0.0],
            k * depth * rise(fore, gutter) / tile, 0.24 + 0.22 * y / top, 0.94);
    }}
    mesh.triangles([edge, edge + 1, edge + 3, edge, edge + 3, edge + 2]);
    for side in [1.0, -1.0] {
        let start = mesh.vertex_count;
        for c in coefficients.chunks_exact(3) { for k in [0.0, 1.0] {
            let x = c[0];
            mesh.vertex(x, side * top, if k != 0.0 { base - depth * rise(x, gutter) } else { base }, [0.0, side, 0.0],
                k * depth * rise(x, gutter) / tile, 0.98 - 0.44 * x / fore, 0.9 * shade(x, gutter));
        }}
        for i in 0..columns {
            let a = (start + i * 2) as u16;
            let b = a + 1; let c = a + 3; let d = a + 2;
            if side > 0.0 { mesh.triangles([a, d, c, a, c, b]); }
            else { mesh.triangles([a, c, d, a, b, c]); }
        }
    }
}
