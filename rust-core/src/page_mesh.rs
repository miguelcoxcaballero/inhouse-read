//! Exact page-block and turned-leaf meshes. The plans ask the host for the pow/hypot values
//! (see host_math.rs) that the same browser Math implementation gave the old mesh, and derive
//! the coefficients from them. All remaining arithmetic stays f64 until each original Float32 write.
use crate::host_math::{put, HYPOT, POW};

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

// ---- Plans: what the meshes above need from the browser's Math, and the coefficients they take.

fn positive(value: f64) -> bool { value.is_finite() && value > 0.0 }
fn nonnegative(value: f64) -> bool { value.is_finite() && value >= 0.0 }

/// Both visible endpaper planes in one batch. Positions are rounded to f32 before
/// joint shading, exactly as Three.PlaneGeometry's BufferAttribute was read back.
/// # Safety
/// Host allocates 2*(columns+1)+6 vertices and columns*6+12 indices, where
/// columns is 3 for overview and 10 otherwise. The second plane's indices are local.
#[no_mangle]
pub unsafe extern "C" fn book_paper_planes(
    paste_width: f64, paste_height: f64, page_width: f64, page_height: f64,
    inset: f64, overview: u32, positions: *mut f32, normals: *mut f32,
    uvs: *mut f32, colors: *mut f32, indices: *mut u16,
) -> u32 {
    if ![paste_width, paste_height, page_width, page_height].iter().all(|&v| positive(v))
        || !nonnegative(inset) { return 0; }
    let columns = if overview != 0 { 3 } else { 10 };
    let paste_vertices = (columns + 1) * 2;
    let mut mesh = Mesh::new(paste_vertices + 6, columns * 6 + 12,
        positions, normals, uvs, colors, indices);
    for (kind, width, height, cols) in [(0, paste_width, paste_height, columns),
        (1, page_width + inset, page_height, 2)] {
        let segment_width = width / cols as f64;
        for iy in 0..2 { for ix in 0..=cols {
            let mut x = (ix as f64 * segment_width - width / 2.0) as f32;
            let shade = if kind == 0 {
                let from_joint = (paste_width / 2.0 - x as f64) / paste_width;
                let joint = (1.0 - from_joint / 0.14).max(0.0);
                1.0 - 0.3 * (joint * joint) - 0.06 * (from_joint - 0.88).max(0.0) / 0.12
            } else {
                if (x as f64).abs() < 1e-6 { x = (-page_width / 2.0 + inset / 2.0) as f32; }
                if (x as f64) < -page_width / 2.0 { 0.74 } else { 1.0 }
            };
            mesh.vertex(x as f64, -(iy as f64 * height - height / 2.0), 0.0,
                [0.0, 0.0, 1.0], ix as f64 / cols as f64, 1.0 - iy as f64, shade);
        }}
        for ix in 0..cols {
            let a = ix as u16; let b = (ix + cols + 1) as u16;
            mesh.triangles([a, b, a + 1, b, b + 1, a + 1]);
        }
    }
    1
}

/// The sizes a page block is built from, or None when they cannot make one.
struct Block { half: f64, bend: f64, columns: usize, rows: usize }
impl Block {
    /// `p`: width, height, thickness, board, inset, detail (0/1).
    fn new(p: &[f64]) -> Option<Block> {
        let (width, height, thickness, board, inset) = (p[0], p[1], p[2], p[3], p[4]);
        if !(positive(width) && positive(height) && positive(thickness) && nonnegative(board) && nonnegative(inset)) { return None; }
        let half = (thickness - board * 2.4) / 2.0;
        let top = height / 2.0 - inset;
        let z_back = thickness / 2.0 - board * 1.1;
        if ![half, top, z_back, height * 0.2, half * half].iter().all(|&v| positive(v)) { return None; }
        let detail = p[5] != 0.0;
        Some(Block { half, bend: (thickness * 0.09).min(width * 0.025), columns: if detail { 16 } else { 8 }, rows: if detail { 6 } else { 3 } })
    }
    fn z(&self, i: usize) -> f64 { -self.half + i as f64 / self.columns as f64 * self.half * 2.0 }
}

/// First stage of a page block: slot 0 is `half ** 2`, then `|z / half| ** 6` for each column and
/// `(row / rows) ** 1.7` for each row. Returns how many requests were written (0: not a block).
/// # Safety
/// `params` holds 6 f64; `requests` room for 3 f64 per request.
#[no_mangle]
pub unsafe extern "C" fn page_block_plan_a(params: *const f64, requests: *mut f64) -> u32 {
    let Some(b) = Block::new(std::slice::from_raw_parts(params, 6)) else { return 0 };
    let count = 1 + (b.columns + 1) + (b.rows + 1);
    let out = std::slice::from_raw_parts_mut(requests, count * 3);
    put(out, 0, POW, b.half, 2.0);
    for i in 0..=b.columns { put(out, 1 + i, POW, (b.z(i) / b.half).abs(), 6.0); }
    for row in 0..=b.rows { put(out, 2 + b.columns + row, POW, row as f64 / b.rows as f64, 1.7); }
    count as u32
}

/// Second stage: the shade of every column pressed against the boards and the slope of its fore
/// edge (`coefficients`: 3 f64 per column, then the row fractions), and the fore edge's length
/// (`HYPOT(1, slope)`, one request per column).
/// # Safety
/// As `page_block_plan_a`; `results` holds its answers, `coefficients` (columns + 1) * 3 + rows + 1 f64.
#[no_mangle]
pub unsafe extern "C" fn page_block_plan_b(params: *const f64, results: *const f64, coefficients: *mut f64, requests: *mut f64) -> u32 {
    let Some(b) = Block::new(std::slice::from_raw_parts(params, 6)) else { return 0 };
    let results = std::slice::from_raw_parts(results, 1 + (b.columns + 1) + (b.rows + 1));
    let data = std::slice::from_raw_parts_mut(coefficients, (b.columns + 1) * 3 + b.rows + 1);
    let out = std::slice::from_raw_parts_mut(requests, (b.columns + 1) * 3);
    for i in 0..=b.columns {
        let slope = 2.0 * b.bend * b.z(i) / results[0];
        data[i * 3] = 1.0 - 0.18 * results[1 + i];
        data[i * 3 + 1] = slope;
        put(out, i, HYPOT, 1.0, slope);
    }
    for row in 0..=b.rows { data[(b.columns + 1) * 3 + row] = results[2 + b.columns + row]; }
    b.columns as u32 + 1
}

/// Last stage: the fore edge's normals from its lengths, then the mesh.
/// # Safety
/// As `page_block_mesh`; `lengths` holds one f64 per column.
#[no_mangle]
pub unsafe extern "C" fn page_block_finish(params: *const f64, lengths: *const f64, coefficients: *mut f64,
    positions: *mut f32, normals: *mut f32, uvs: *mut f32, colors: *mut f32, indices: *mut u16) {
    let p = std::slice::from_raw_parts(params, 6);
    let Some(b) = Block::new(p) else { return };
    let lengths = std::slice::from_raw_parts(lengths, b.columns + 1);
    let data = std::slice::from_raw_parts_mut(coefficients, (b.columns + 1) * 3 + b.rows + 1);
    for i in 0..=b.columns {
        let slope = data[i * 3 + 1];
        data[i * 3 + 1] = 1.0 / lengths[i];
        data[i * 3 + 2] = -slope / lengths[i];
    }
    let rows_at = (b.columns + 1) * 3;
    page_block_mesh(coefficients, coefficients.add(rows_at), p[0], p[1], p[2], p[3], p[4], b.columns, b.rows,
        positions, normals, uvs, colors, indices);
}

/// The sizes a stack of read leaves is built from.
struct Stack { fore: f64, gutter: f64, columns: usize }
impl Stack {
    /// `p`: width, height, depth, board, inset, columns.
    fn new(p: &[f64]) -> Option<Stack> {
        let (width, height, depth, board, inset, columns) = (p[0], p[1], p[2], p[3], p[4], p[5]);
        if !(positive(width) && positive(height) && nonnegative(depth) && nonnegative(board) && nonnegative(inset)) { return None; }
        if !(columns.fract() == 0.0 && (1.0..=512.0).contains(&columns)) { return None; }
        let top = height / 2.0 - inset - height * 0.0012;
        let fore = width - inset * 0.7 - height * 0.0015;
        let gutter = (fore * 0.2).min(height * 0.075);
        if ![top, fore, gutter, height * 0.2].iter().all(|&v| positive(v)) { return None; }
        Some(Stack { fore, gutter, columns: columns as usize })
    }
}

/// First stage of a leaf stack: the crowding power `(i / columns) ** 1.7` of every column.
/// # Safety
/// `params` holds 6 f64; `requests` room for 3 f64 per request.
#[no_mangle]
pub unsafe extern "C" fn leaf_stack_plan_a(params: *const f64, requests: *mut f64) -> u32 {
    let Some(s) = Stack::new(std::slice::from_raw_parts(params, 6)) else { return 0 };
    let out = std::slice::from_raw_parts_mut(requests, (s.columns + 1) * 3);
    for i in 0..=s.columns { put(out, i, POW, i as f64 / s.columns as f64, 1.7); }
    (s.columns + 1) as u32
}

/// Second stage: where each column stands and the slope of the leaves there (`coefficients`: 3 f64
/// per column), and the length of the slope's normal (`HYPOT(slope, 1)`).
/// # Safety
/// As `leaf_stack_plan_a`; `powers` holds its answers, `coefficients` (columns + 1) * 3 f64.
#[no_mangle]
pub unsafe extern "C" fn leaf_stack_plan_b(params: *const f64, powers: *const f64, coefficients: *mut f64, requests: *mut f64) -> u32 {
    let p = std::slice::from_raw_parts(params, 6);
    let Some(s) = Stack::new(p) else { return 0 };
    let depth = p[2];
    let powers = std::slice::from_raw_parts(powers, s.columns + 1);
    let data = std::slice::from_raw_parts_mut(coefficients, (s.columns + 1) * 3);
    let out = std::slice::from_raw_parts_mut(requests, (s.columns + 1) * 3);
    for i in 0..=s.columns {
        // Columns crowd toward the gutter, where the leaves curl.
        let x = s.fore * powers[i];
        let slope = -depth * if x < s.gutter { (1.0 - 0.16) * (2.0 - 2.0 * x / s.gutter) / s.gutter } else { 0.0 };
        data[i * 3] = x;
        data[i * 3 + 1] = slope;
        put(out, i, HYPOT, slope, 1.0);
    }
    (s.columns + 1) as u32
}

/// Last stage: the face normals from their lengths, then the mesh.
/// # Safety
/// As `leaf_stack_mesh`; `lengths` holds one f64 per column.
#[no_mangle]
pub unsafe extern "C" fn leaf_stack_finish(params: *const f64, lengths: *const f64, coefficients: *mut f64,
    positions: *mut f32, normals: *mut f32, uvs: *mut f32, colors: *mut f32, indices: *mut u16) {
    let p = std::slice::from_raw_parts(params, 6);
    let Some(s) = Stack::new(p) else { return };
    let lengths = std::slice::from_raw_parts(lengths, s.columns + 1);
    let data = std::slice::from_raw_parts_mut(coefficients, (s.columns + 1) * 3);
    for i in 0..=s.columns {
        let slope = data[i * 3 + 1];
        data[i * 3 + 1] = slope / lengths[i];
        data[i * 3 + 2] = -1.0 / lengths[i];
    }
    leaf_stack_mesh(coefficients, p[0], p[1], p[2], p[3], p[4], s.columns, positions, normals, uvs, colors, indices);
}
