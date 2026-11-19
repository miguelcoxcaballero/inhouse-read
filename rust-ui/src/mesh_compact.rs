//! Index only the corners whose complete attributes match within each original pair of triangles.
//! Normals become signed-normalised 16-bit integers and colours unsigned-normalised bytes; positions
//! and UVs keep their f32 values. Vertex order and facets are unchanged.
use crate::three_geo::Geo;

/// One compacted attribute.
pub enum Attr { F32(Vec<f32>), I16(Vec<i16>), U8(Vec<u8>) }
impl Attr {
    pub fn len(&self) -> usize { match self { Attr::F32(a) => a.len(), Attr::I16(a) => a.len(), Attr::U8(a) => a.len() } }
}

/// An indexed geometry whose attributes keep their original order and use their stored types.
pub struct Packed { pub attributes: Vec<(&'static str, usize, Attr)>, pub index: Vec<u32> }

/// `Math.round` of a number (half up).
pub fn js_round(value: f64) -> f64 { let base = value.floor(); base + if value - base >= 0.5 { 1.0 } else { 0.0 } }
/// The integer a typed array stores for a number (`ToUint32`, modulo 2^32; the narrower types keep the low bits).
pub fn js_to_u32(value: f64) -> u32 { if value.is_finite() { value.trunc().rem_euclid(4294967296.0) as u64 as u32 } else { 0 } }

/// Compact a non-indexed geometry (`compactGeometry`).
pub fn compact(geo: &Geo, order: &[&'static str]) -> Packed {
    let sources: Vec<(&'static str, usize, &Vec<f32>)> = order.iter().map(|&name| match name {
        "position" => (name, 3, &geo.position),
        "normal" => (name, 3, &geo.normal),
        "uv" => (name, 2, &geo.uv),
        _ => (name, 3, &geo.color),
    }).collect();
    let count = geo.count();
    // comparison words: the rounded integers for normals and colours; positions and UVs compare their
    // raw f32 bits in place (no copy of them, which only raised the module's never-shrinking memory)
    let words: Vec<Vec<u32>> = sources.iter().map(|&(name, _, a)| match name {
        "normal" => a.iter().map(|&v| js_to_u32(js_round(f64::from(v) * 32767.0))).collect(),
        "color" => a.iter().map(|&v| js_to_u32(js_round(f64::from(v) * 255.0))).collect(),
        _ => Vec::new(),
    }).collect();
    let word = |k: usize, i: usize| -> u32 { if words[k].is_empty() { sources[k].2[i].to_bits() } else { words[k][i] } };
    let mut original = vec![0u32; count];
    let mut index = vec![0u32; count];
    let (mut unique, mut first_in_pair) = (0usize, 0usize);
    for vertex in 0..count {
        // every pressed facet is two adjacent triangles: compare only their six corners
        if vertex % 6 == 0 { first_in_pair = unique; }
        let mut matched = first_in_pair;
        while matched < unique {
            let mut equal = true;
            'attributes: for (k, &(_, size, _)) in sources.iter().enumerate() {
                for component in 0..size {
                    if word(k, vertex * size + component) != word(k, original[matched] as usize * size + component) { equal = false; break 'attributes; }
                }
            }
            if equal { break; }
            matched += 1;
        }
        if matched == unique { original[unique] = vertex as u32; unique += 1; }
        index[vertex] = matched as u32;
    }
    let attributes = sources.iter().enumerate().map(|(k, &(name, size, a))| {
        // each kept vertex's components, read where they are (exactly sized, no list of positions)
        fn pick<T>(unique: usize, size: usize, original: &[u32], f: impl Fn(usize) -> T) -> Vec<T> {
            let mut out = Vec::with_capacity(unique * size);
            for &v in &original[..unique] { for c in 0..size { out.push(f(v as usize * size + c)); } }
            out
        }
        let attr = match name {
            "normal" => Attr::I16(pick(unique, size, &original, |i| words[k][i] as i16)),
            "color" => Attr::U8(pick(unique, size, &original, |i| words[k][i] as u8)),
            _ => Attr::F32(pick(unique, size, &original, |i| a[i])),
        };
        (name, size, attr)
    }).collect();
    Packed { attributes, index: index.into_iter().take(count).collect() }
}

impl Packed {
    /// `BufferGeometry#translate(x, y, z)` on the packed attributes: positions through the matrix; normals
    /// read back from their integers, normalised and stored again, which can move a value by one step.
    pub fn translate(&mut self, x: f64, y: f64, z: f64) {
        let mut m = crate::jsmath::Mat4::identity();
        m.set_position([x, y, z]);
        let n = crate::three_geo::normal_matrix(&m);
        for (name, _, attr) in self.attributes.iter_mut() {
            match (*name, attr) {
                ("position", Attr::F32(a)) => for v in a.chunks_exact_mut(3) {
                    let q = m.apply([f64::from(v[0]), f64::from(v[1]), f64::from(v[2])]);
                    v[0] = q[0] as f32; v[1] = q[1] as f32; v[2] = q[2] as f32;
                },
                ("normal", Attr::I16(a)) => for v in a.chunks_exact_mut(3) {
                    // getX: denormalize(value, Int16Array) = max(value / 32767, -1)
                    let d = |i: i16| crate::jsmath::jmax(f64::from(i) / 32767.0, -1.0);
                    let (px, py, pz) = (d(v[0]), d(v[1]), d(v[2]));
                    let r = crate::jsmath::normalize([n[0] * px + n[3] * py + n[6] * pz, n[1] * px + n[4] * py + n[7] * pz, n[2] * px + n[5] * py + n[8] * pz]);
                    // setXYZ: normalize(value, Int16Array) = round(value * 32767)
                    for k in 0..3 { v[k] = js_to_u32(js_round(r[k] * 32767.0)) as i16; }
                },
                _ => {}
            }
        }
    }
}
