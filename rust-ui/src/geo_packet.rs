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
    pub fn packed(&mut self, packed: &Packed) {
        self.json.push_str("\"attributes\":[");
        for (k, (name, size, attr)) in packed.attributes.iter().enumerate() {
            self.align();
            let at = self.blob.len();
            let (kind, len) = match attr {
                Attr::F32(a) => { for v in a { self.blob.extend(v.to_le_bytes()); } ("f32", a.len()) }
                Attr::I16(a) => { for v in a { self.blob.extend(v.to_le_bytes()); } ("i16", a.len()) }
                Attr::U8(a) => { self.blob.extend(a); ("u8", a.len()) }
            };
            if k > 0 { self.json.push(','); }
            self.json.push_str(&format!("[\"{name}\",{size},\"{kind}\",{at},{len}]"));
        }
        self.align();
        let at = self.blob.len();
        let wide = needs_uint32(&packed.index);
        if wide { for v in &packed.index { self.blob.extend(v.to_le_bytes()); } } else { for v in &packed.index { self.blob.extend((*v as u16).to_le_bytes()); } }
        self.json.push_str(&format!("],\"index\":[\"{}\",{at},{}]", if wide { "u32" } else { "u16" }, packed.index.len()));
    }
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
    pub fn seal(self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.json.len() + self.blob.len() + 8);
        out.extend((self.json.len() as u32).to_le_bytes());
        out.extend(self.json.as_bytes());
        while out.len() % 4 != 0 { out.push(0); }
        out.extend(self.blob);
        out
    }
}
