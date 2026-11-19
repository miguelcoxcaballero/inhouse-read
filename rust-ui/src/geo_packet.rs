//! The packet the shelf module hands to the host for a finished model: a JSON header (what each array is
//! and where it lives) followed by the typed data, `[u32 header length][header][padding][data]`. The host
//! copies the arrays out of it into three's attributes.
use crate::mesh_compact::{Attr, Packed};
use crate::three_geo::{needs_uint32, Geo};

/// Number as JSON text: the shortest digits that read back as the same f64.
pub fn num(v: f64) -> String { format!("{v}") }
pub fn nums(v: &[f64]) -> String { format!("[{}]", v.iter().map(|&x| num(x)).collect::<Vec<_>>().join(",")) }

pub struct Packet { pub json: String, pub blob: Vec<u8> }

impl Packet {
    pub fn new() -> Packet { Packet { json: String::new(), blob: Vec::new() } }
    fn align(&mut self) { while self.blob.len() % 4 != 0 { self.blob.push(0); } }
    /// `"attributes":[[name,size,type,byteOffset,length],...],"index":[type,byteOffset,length]` of one geometry.
    pub fn packed(&mut self, packed: &Packed) { self.packed_parts(std::slice::from_ref(packed)); }
    /// The bytes `packed_parts` can write for `parts` (with at most 3 of padding before each array).
    pub fn packed_size(parts: &[Packed]) -> usize {
        let wide = Self::wide(parts);
        parts.iter().map(|p| p.attributes.iter().map(|(_, _, attr)| match attr { Attr::F32(a) => a.len() * 4, Attr::I16(a) => a.len() * 2, Attr::U8(a) => a.len() }).sum::<usize>()
            + p.index.len() * if wide { 4 } else { 2 }).sum::<usize>() + 3 * (parts[0].attributes.len() + 1)
    }
    /// Whether the merged index of `parts` (each offset by the vertices before it) needs 32 bits.
    fn wide(parts: &[Packed]) -> bool {
        let mut offset = 0u32;
        parts.iter().any(|p| { let wide = p.index.iter().any(|&i| i + offset >= 65535); offset += (p.attributes[0].2.len() / p.attributes[0].1) as u32; wide })
    }
    /// `packed` of the geometry merging `parts` in order (`mergeGeometries`: attributes appended, indices offset by
    /// the vertices before them), written straight from the parts: the merged arrays are never built, and the
    /// data is reserved once at its exact size. Both would otherwise strand copies in the module's memory, which
    /// never shrinks.
    pub fn packed_parts(&mut self, parts: &[Packed]) {
        let wide = Self::wide(parts);
        self.blob.reserve_exact(Self::packed_size(parts));
        self.json.push_str("\"attributes\":[");
        for (k, &(name, size, ref first)) in parts[0].attributes.iter().enumerate() {
            self.align();
            let at = self.blob.len();
            let mut len = 0;
            for part in parts {
                let attr = &part.attributes[k].2;
                len += attr.len();
                match attr {
                    Attr::F32(a) => for v in a { self.blob.extend(v.to_le_bytes()); },
                    Attr::I16(a) => for v in a { self.blob.extend(v.to_le_bytes()); },
                    Attr::U8(a) => self.blob.extend(a),
                }
            }
            let kind = match first { Attr::F32(_) => "f32", Attr::I16(_) => "i16", Attr::U8(_) => "u8" };
            if k > 0 { self.json.push(','); }
            self.json.push_str(&format!("[\"{name}\",{size},\"{kind}\",{at},{len}]"));
        }
        self.align();
        let at = self.blob.len();
        let (mut offset, mut count) = (0u32, 0);
        for part in parts {
            if wide { for v in &part.index { self.blob.extend((v + offset).to_le_bytes()); } } else { for v in &part.index { self.blob.extend(((v + offset) as u16).to_le_bytes()); } }
            offset += (part.attributes[0].2.len() / part.attributes[0].1) as u32;
            count += part.index.len();
        }
        self.json.push_str(&format!("],\"index\":[\"{}\",{at},{count}]", if wide { "u32" } else { "u16" }));
    }
    /// Reserve exactly `bytes` more data (see `packed_size`) and room for a header of up to `header` bytes, which
    /// `seal` then puts in front of the data without moving it to a new allocation.
    pub fn reserve(&mut self, bytes: usize, header: usize) { self.blob.reserve_exact(bytes + header + 8); }
    /// One geometry as three built it: Float32 attributes in `order` (`position`, `normal`, `uv`, `color`) and
    /// its index, or `"index":null` when it has none.
    pub fn plain(&mut self, geo: &Geo, order: &[&str]) {
        self.json.push_str("\"attributes\":[");
        for (k, &name) in order.iter().enumerate() {
            let (size, data) = match name { "position" => (3, &geo.position), "normal" => (3, &geo.normal), "uv" => (2, &geo.uv), _ => (3, &geo.color) };
            self.align();
            let at = self.blob.len();
            for v in data { self.blob.extend(v.to_le_bytes()); }
            if k > 0 { self.json.push(','); }
            self.json.push_str(&format!("[\"{name}\",{size},\"f32\",{at},{}]", data.len()));
        }
        match &geo.index {
            None => self.json.push_str("],\"index\":null"),
            Some(index) => {
                self.align();
                let at = self.blob.len();
                let wide = needs_uint32(index);
                if wide { for v in index { self.blob.extend(v.to_le_bytes()); } } else { for v in index { self.blob.extend((*v as u16).to_le_bytes()); } }
                self.json.push_str(&format!("],\"index\":[\"{}\",{at},{}]", if wide { "u32" } else { "u16" }, index.len()));
            }
        }
    }
    /// `"name":[type,byteOffset,length]` of exact f64 values (transforms, sizes), which JSON cannot carry when they
    /// are not finite. The host copies them out with the packet's `copy`.
    pub fn f64s(&mut self, name: &str, values: &[f64]) {
        while self.blob.len() % 8 != 0 { self.blob.push(0); }
        let at = self.blob.len();
        for v in values { self.blob.extend(v.to_le_bytes()); }
        self.json.push_str(&format!("\"{name}\":[\"f64\",{at},{}]", values.len()));
    }
    pub fn seal(self) -> Vec<u8> {
        let Packet { json, mut blob } = self;
        let mut head = Vec::with_capacity(json.len() + 8);
        head.extend((json.len() as u32).to_le_bytes());
        head.extend(json.as_bytes());
        while head.len() % 4 != 0 { head.push(0); }
        // With room reserved (see `reserve`) the header goes in front of the data in place: a second whole copy
        // of the data would raise the module's memory, which never shrinks, by the packet's size.
        if blob.capacity() - blob.len() < head.len() {
            head.reserve_exact(blob.len());
            head.extend(blob);
            return head;
        }
        blob.splice(0..0, head);
        blob
    }
}
