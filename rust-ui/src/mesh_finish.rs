//! Physical paint coordinates and continuous rounded-post wall normals.
use crate::three_geo::Geo;
use std::collections::HashMap;

fn key(x: f32, z: f32) -> (u32, u32) { (if x == 0.0 { 0 } else { x.to_bits() }, if z == 0.0 { 0 } else { z.to_bits() }) }

/// `physicalPaintUVs`: the powder-coat grain stays sub-millimetre on short rails and long posts, so the
/// texture follows the face's dominant axis (x/y/z of the normal) in 8 mm tiles.
pub fn physical_paint_uvs(geo: &mut Geo) {
    let (p, n) = (&geo.position, &geo.normal);
    for vertex in 0..p.len() / 3 {
        let at = vertex * 3;
        let (x, y, z) = (n[at].abs(), n[at + 1].abs(), n[at + 2].abs());
        let (u, v) = if x >= y && x >= z { (p[at + 2], p[at + 1]) } else if y >= z { (p[at], p[at + 2]) } else { (p[at], p[at + 1]) };
        geo.uv[vertex * 2] = (f64::from(u) / 8.0) as f32;
        geo.uv[vertex * 2 + 1] = (f64::from(v) / 8.0) as f32;
    }
}

/// `smoothPostNormals`: average only the long wall normals of the rounded post, so its small rounded
/// corners catch continuous highlights; the caps stay separate and flat.
pub fn smooth_post_normals(geo: &mut Geo) {
    let (p, n) = (&geo.position, &mut geo.normal);
    let mut sums: HashMap<(u32, u32), [f64; 2]> = HashMap::new();
    for vertex in 0..p.len() / 3 {
        let at = vertex * 3;
        if f64::from(n[at + 1]).abs() > 0.5 { continue; }
        let sum = sums.entry(key(p[at], p[at + 2])).or_insert([0.0; 2]);
        sum[0] += f64::from(n[at]);
        sum[1] += f64::from(n[at + 2]);
    }
    for vertex in 0..p.len() / 3 {
        let at = vertex * 3;
        if f64::from(n[at + 1]).abs() > 0.5 { continue; }
        let [x, z] = sums[&key(p[at], p[at + 2])];
        let r = crate::jsmath::normalize([x, 0.0, z]);
        n[at] = r[0] as f32;
        n[at + 1] = 0.0;
        n[at + 2] = r[2] as f32;
    }
}
