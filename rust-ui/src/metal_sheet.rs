//! Real expanded-metal apertures and pressed facets; no alpha-mask substitute.
use crate::three_geo::Geo;
use std::collections::HashMap;

fn key(value: f64) -> i64 { let v = value * 1000.0; let base = v.floor(); (base + if v - base >= 0.5 { 1.0 } else { 0.0 }) as i64 }
fn add(segments: &mut Vec<[f64; 4]>, indices: &mut HashMap<[(i64, i64); 2], usize>, s: [f64; 4]) {
    let a = (key(s[0]), key(s[1]));
    let b = (key(s[2]), key(s[3]));
    let k = if a < b { [a, b] } else { [b, a] };
    if let Some(&index) = indices.get(&k) { segments[index] = s; } else { indices.insert(k, segments.len()); segments.push(s); }
}
fn point(u: f64, v: f64, n: f64, p: &[f64]) -> [f64; 3] {
    [crate::jsmath::jmin(crate::jsmath::jmax(u, p[0]), p[1]), crate::jsmath::jmin(crate::jsmath::jmax(v, p[2]), p[3]), n]
}
fn triangle(sheet: &mut Geo, points: [[f64; 3]; 3], kind: u32, z: f64) {
    for [u, v, n] in points {
        let pos = if kind == 0 { [u, n, -v] } else { [v, -u, z + n] };
        sheet.position.extend(pos.map(|x| x as f32));
        sheet.uv.extend([(u / 8.0) as f32, (v / 8.0) as f32]);
    }
}

/// An expanded-metal sheet: strands of hexagonal cells clipped to `[u_min, u_max] x [v_min, v_max]`, each a
/// ridge of two facets (one for the flattened bonds). `kind` 0 is a horizontal shelf (u, n, -v), 1 the rear
/// brace (v, -u, z + n). `p` holds uMin, uMax, vMin, vMax, pitch, periodY, strand width, thickness, z.
/// Vertex normals are three's flat face normals, rounded to f32 before normalising.
pub fn expanded_metal(p: &[f64; 9], kind: u32) -> Geo {
    let px = p[4] * 2.0;
    let py = p[5];
    let hh = py / 2.0;
    let outer = p[4] * 0.6;
    let shoulder = p[4] * 0.4;
    let rows = ((p[2] / py).floor() - 1.0, (p[3] / py).ceil() + 1.0);
    let columns = ((p[0] / px).floor() - 1.0, (p[1] / px).ceil() + 1.0);
    let corners = [[-outer, 0.0], [-shoulder, -hh], [shoulder, -hh], [outer, 0.0], [shoulder, hh], [-shoulder, hh]];
    let mut segments = Vec::new();
    let mut indices = HashMap::new();
    for row in rows.0 as i32..=rows.1 as i32 {
        for col in columns.0 as i32..=columns.1 as i32 {
            for [ou, ov] in [[0.0, 0.0], [p[4], hh]] {
                let u = col as f64 * px + ou;
                let v = row as f64 * py + ov;
                for edge in 0..6 {
                    let a = corners[edge];
                    let b = corners[(edge + 1) % 6];
                    add(&mut segments, &mut indices, [u + a[0], v + a[1], u + b[0], v + b[1]]);
                }
            }
        }
    }
    // the cut edge sits inside the folded perimeter
    for s in [[p[0], p[2], p[1], p[2]], [p[1], p[2], p[1], p[3]], [p[1], p[3], p[0], p[3]], [p[0], p[3], p[0], p[2]]] {
        add(&mut segments, &mut indices, s);
    }
    drop(indices);
    let mut sheet = Geo::default();
    for [au, av, bu, bv] in segments {
        let du = bu - au;
        let dv = bv - av;
        let mut from = 0.0f64;
        let mut to = 1.0f64;
        let mut clipped = false;
        // Liang-Barsky clips strands at the cut sheet boundary
        for [direction, distance] in [[-du, au - p[0]], [du, p[1] - au], [-dv, av - p[2]], [dv, p[3] - av]] {
            if direction.abs() < 1e-9 { if distance < 0.0 { clipped = true; break; } continue; }
            let ratio = distance / direction;
            if direction < 0.0 { from = from.max(ratio); } else { to = to.min(ratio); }
            if from >= to { clipped = true; break; }
        }
        if clipped { continue; }
        // Math.hypot(du, dv): scaled by the larger magnitude
        let max = du.abs().max(dv.abs());
        let a = du / max;
        let b = dv / max;
        let length = max * (a * a + b * b).sqrt();
        let nu = -dv / length * p[6] / 2.0;
        let nv = du / length * p[6] / 2.0;
        let u0 = au + du * from;
        let v0 = av + dv * from;
        let u1 = au + du * to;
        let v1 = av + dv * to;
        let mut la = point(u0 + nu, v0 + nv, -p[7], p);
        let ra = point(u0, v0, 0.0, p);
        let xa = point(u0 - nu, v0 - nv, -p[7], p);
        let mut lb = point(u1 + nu, v1 + nv, -p[7], p);
        let rb = point(u1, v1, 0.0, p);
        let xb = point(u1 - nu, v1 - nv, -p[7], p);
        if dv.abs() < 1e-7 {
            // the short connecting bonds are flattened by the expanding process: one inclined face
            la[2] = 0.0; lb[2] = 0.0;
            triangle(&mut sheet, [la, xa, xb], kind, p[8]);
            triangle(&mut sheet, [la, xb, lb], kind, p[8]);
        } else {
            triangle(&mut sheet, [la, ra, rb], kind, p[8]);
            triangle(&mut sheet, [la, rb, lb], kind, p[8]);
            triangle(&mut sheet, [ra, xa, xb], kind, p[8]);
            triangle(&mut sheet, [ra, xb, rb], kind, p[8]);
        }
    }
    // Match Three: cross products are rounded to f32 before normalisation. Each unindexed face has
    // three identical normals, including signed zero.
    sheet.normal = vec![0.0; sheet.position.len()];
    for (index, t) in sheet.position.chunks_exact(9).enumerate() {
        let cb = [f64::from(t[6]) - f64::from(t[3]), f64::from(t[7]) - f64::from(t[4]), f64::from(t[8]) - f64::from(t[5])];
        let ab = [f64::from(t[0]) - f64::from(t[3]), f64::from(t[1]) - f64::from(t[4]), f64::from(t[2]) - f64::from(t[5])];
        let n = [(cb[1] * ab[2] - cb[2] * ab[1]) as f32, (cb[2] * ab[0] - cb[0] * ab[2]) as f32, (cb[0] * ab[1] - cb[1] * ab[0]) as f32].map(f64::from);
        let n = crate::jsmath::normalize(n).map(|v| v as f32);
        for vertex in 0..3 { sheet.normal[index * 9 + vertex * 3..index * 9 + vertex * 3 + 3].copy_from_slice(&n); }
    }
    sheet
}
