//! Expose a VITS model's existing phoneme durations as a second ONNX output, and the page
//! boundaries the alignment asks the phonemizer for. Weights, operators and the audio output are
//! untouched; a graph that is not the expected Piper export is left exactly as it is.
//!
//! The ~63 MB protobuf stays in the worker's own buffer: copying it into this core's memory would
//! keep a second model resident (WebAssembly memory never shrinks). The scan pulls windows of it
//! instead. Every step needs one contiguous range from the start of the field it reads; when the
//! range is not in the window, the host copies a new window starting there and the step runs
//! again. Large payloads (initializers) are skipped by their length and never copied.
//!
//! The decisions are the frozen JavaScript original's (tests/unit/helpers/reference-piper-alignment.js):
//! any malformed field anywhere in the model, its graph, a node or a value name leaves the model
//! untouched, as its catch-all did.

const WINDOW: u64 = 65536;
const MAX_FIELDS: usize = 100_000;
const SAFE: u64 = (1 << 53) - 1;

#[derive(Clone, Copy)]
struct Field { number: u64, wire: u64, begin: u64, data: u64, end: u64 }

struct Node { op: String, inputs: Vec<String>, outputs: Vec<String> }

#[derive(Clone, Copy, PartialEq)]
enum Level { Top, Graph, Node, Input, Output }

pub struct Scan {
    total: u64,
    window: Vec<u8>,
    start: u64,
    want: (u64, u64),
    level: Level,
    // ModelProto fields, then the GraphProto entries, then one entry's own fields.
    top: (u64, usize), graphs: usize, graph: Option<Field>,
    entries: (u64, usize),
    sub: (u64, u64, usize),
    op: Option<String>, ins: Vec<String>, outs: Vec<String>, value: Option<String>,
    nodes: Vec<Node>, inputs: Vec<String>, outputs: Vec<String>,
    mode: i32,
    name: Vec<u16>, header: Vec<u8>, output: Vec<u8>,
}

enum Read<T> { Done(T), Need, Bad }

impl Scan {
    fn byte(&self, at: u64) -> Option<u8> {
        if at < self.start || at - self.start >= self.window.len() as u64 { None } else { Some(self.window[(at - self.start) as usize]) }
    }
    /// `varint` of the original: at most eight bytes, a safe integer, never past `end`.
    fn varint(&self, mut at: u64, end: u64) -> Read<(u64, u64)> {
        let (mut value, mut shift) = (0u64, 0u32);
        loop {
            if at >= end || shift > 49 { return Read::Bad; }
            let Some(byte) = self.byte(at) else { return Read::Need };
            at += 1;
            value += u64::from(byte & 127) << shift;
            shift += 7;
            if byte & 128 == 0 { break; }
        }
        if value > SAFE { Read::Bad } else { Read::Done((value, at)) }
    }
    /// One field of `fields`: its number, wire type and the range of its value.
    fn field(&self, at: u64, end: u64) -> Read<Field> {
        let (tag, mut next) = match self.varint(at, end) { Read::Done(v) => v, Read::Need => return Read::Need, Read::Bad => return Read::Bad };
        let (wire, number) = (tag % 8, tag / 8);
        if number == 0 { return Read::Bad; }
        let mut data = next;
        let stop = match wire {
            2 => match self.varint(next, end) { Read::Done((length, after)) => { next = after; data = next; next + length } Read::Need => return Read::Need, Read::Bad => return Read::Bad },
            0 => match self.varint(next, end) { Read::Done((_, after)) => after, Read::Need => return Read::Need, Read::Bad => return Read::Bad },
            1 => next + 8,
            5 => next + 4,
            _ => return Read::Bad,
        };
        if stop > end { return Read::Bad; }
        Read::Done(Field { number, wire, begin: at, data, end: stop })
    }
    /// The bytes of a value as `TextDecoder` reads them (UTF-8 with replacement, a leading BOM dropped).
    fn text(&self, field: &Field) -> Option<String> {
        if field.data < self.start || field.end - self.start > self.window.len() as u64 { return None; }
        let bytes = &self.window[(field.data - self.start) as usize..(field.end - self.start) as usize];
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
        Some(String::from_utf8_lossy(bytes).into_owned())
    }
    fn request(&mut self, at: u64, through: u64) -> i32 {
        let length = through.max(at + WINDOW).min(self.total) - at;
        self.want = (at, length);
        1
    }
    fn fail(&mut self) -> i32 { self.mode = 0; 0 }

    /// Runs until it needs bytes (1) or knows the answer (0).
    fn run(&mut self) -> i32 {
        loop {
            match self.level {
                Level::Top => {
                    let (at, count) = self.top;
                    if at >= self.total {
                        if self.graphs != 1 { return self.fail(); }
                        let graph = self.graph.unwrap();
                        self.entries = (graph.data, 0);
                        self.level = Level::Graph;
                        continue;
                    }
                    match self.field(at, self.total) {
                        Read::Need => return self.request(at, at),
                        Read::Bad => return self.fail(),
                        Read::Done(field) => {
                            if count > MAX_FIELDS { return self.fail(); }
                            if field.number == 7 && field.wire == 2 { self.graphs += 1; self.graph = Some(field); }
                            self.top = (field.end, count + 1);
                        }
                    }
                }
                Level::Graph => {
                    let graph = self.graph.unwrap();
                    let (at, count) = self.entries;
                    if at >= graph.end { return self.finish(); }
                    match self.field(at, graph.end) {
                        Read::Need => return self.request(at, at),
                        Read::Bad => return self.fail(),
                        Read::Done(field) => {
                            if count > MAX_FIELDS { return self.fail(); }
                            self.entries = (field.end, count + 1);
                            let level = match field.number { 1 => Level::Node, 11 => Level::Input, 12 => Level::Output, _ => continue };
                            self.level = level;
                            self.sub = (field.data, field.end, 0);
                            self.op = None; self.ins.clear(); self.outs.clear(); self.value = None;
                        }
                    }
                }
                level => {
                    let (at, end, count) = self.sub;
                    if at >= end {
                        if level == Level::Node {
                            // `str(values.find(v => v.number === 4))` threw without an op type.
                            let Some(op) = self.op.take() else { return self.fail() };
                            self.nodes.push(Node { op, inputs: std::mem::take(&mut self.ins), outputs: std::mem::take(&mut self.outs) });
                        } else if let Some(name) = self.value.take() {
                            if level == Level::Input { self.inputs.push(name) } else { self.outputs.push(name) }
                        }
                        self.level = Level::Graph;
                        continue;
                    }
                    match self.field(at, end) {
                        Read::Need => return self.request(at, at),
                        Read::Bad => return self.fail(),
                        Read::Done(field) => {
                            if count > MAX_FIELDS { return self.fail(); }
                            let wanted = match level {
                                Level::Node => matches!(field.number, 1 | 2) || field.number == 4 && self.op.is_none(),
                                _ => field.number == 1 && self.value.is_none(),
                            };
                            if wanted {
                                let Some(text) = self.text(&field) else { return self.request(at, field.end) };
                                match (level, field.number) {
                                    (Level::Node, 1) => self.ins.push(text),
                                    (Level::Node, 2) => self.outs.push(text),
                                    (Level::Node, _) => self.op = Some(text),
                                    _ => self.value = Some(text),
                                }
                            }
                            self.sub = (field.end, end, count + 1);
                        }
                    }
                }
            }
        }
    }

    fn finish(&mut self) -> i32 {
        if !["input", "input_lengths", "scales"].iter().all(|name| self.inputs.iter().any(|value| value == name)) { return self.fail(); }
        let candidates: Vec<&Node> = self.nodes.iter().filter(|node| node.op == "Ceil" && node.outputs.len() == 1
            && self.nodes.iter().any(|next| next.op == "CumSum" && next.inputs.first() == Some(&node.outputs[0]))).collect();
        if candidates.len() != 1 { return self.fail(); }
        let name = candidates[0].outputs[0].clone();
        self.name = name.encode_utf16().collect();
        if self.outputs.iter().any(|value| *value == name) { self.mode = 1; return 0; }
        let shape = [field(1, &[8, 1]), field(1, &[8, 1]), field(1, &string(2, "phonemes"))].concat();
        let kind = field(2, &field(1, &[&[8u8, 1][..], &field(2, &shape)].concat()));
        self.output = field(12, &[string(1, &name), kind].concat());
        let graph = self.graph.unwrap();
        self.header = [vint(7 * 8 + 2), vint(graph.end - graph.data + self.output.len() as u64)].concat();
        self.mode = 2;
        0
    }
}

fn vint(mut value: u64) -> Vec<u8> {
    let mut result = Vec::new();
    loop {
        let part = (value % 128) as u8;
        value /= 128;
        result.push(part | if value != 0 { 128 } else { 0 });
        if value == 0 { return result; }
    }
}
fn field(number: u64, bytes: &[u8]) -> Vec<u8> { [vint(number * 8 + 2), vint(bytes.len() as u64), bytes.to_vec()].concat() }
fn string(number: u64, value: &str) -> Vec<u8> { field(number, value.as_bytes()) }

/// A scan of a model of `total` bytes, or null.
#[no_mangle]
pub extern "C" fn onnx_scan_new(total: f64) -> *mut Scan {
    if !(total >= 0.0 && total <= SAFE as f64) || total.fract() != 0.0 { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(Scan {
        total: total as u64, window: Vec::new(), start: 0, want: (0, 0), level: Level::Top,
        top: (0, 0), graphs: 0, graph: None, entries: (0, 0), sub: (0, 0, 0),
        op: None, ins: Vec::new(), outs: Vec::new(), value: None, nodes: Vec::new(), inputs: Vec::new(), outputs: Vec::new(),
        mode: 0, name: Vec::new(), header: Vec::new(), output: Vec::new(),
    }))
}
/// # Safety
/// `scan` is null or a live scan; it is not used afterwards.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_free(scan: *mut Scan) { if !scan.is_null() { drop(Box::from_raw(scan)); } }
/// 1: the host must copy the wanted range (onnx_scan_want) into onnx_scan_window; 0: finished; -1: invalid.
/// # Safety
/// `scan` is null or a live scan.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_step(scan: *mut Scan) -> i32 { match scan.as_mut() { Some(scan) => scan.run(), None => -1 } }
/// Writes the wanted (start, length).
/// # Safety
/// `scan` live, `output` holds two numbers.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_want(scan: *const Scan, output: *mut f64) {
    let (Some(scan), false) = (scan.as_ref(), output.is_null()) else { return };
    *output = scan.want.0 as f64; *output.add(1) = scan.want.1 as f64;
}
/// The window for the wanted range, `length` bytes from its start, for the host to fill.
/// # Safety
/// `scan` live; the pointer is valid until the next call into this core.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_window(scan: *mut Scan, length: f64) -> *mut u8 {
    let Some(scan) = scan.as_mut() else { return std::ptr::null_mut() };
    if length != scan.want.1 as f64 { return std::ptr::null_mut(); }
    scan.start = scan.want.0;
    scan.window.clear();
    scan.window.resize(scan.want.1 as usize, 0);
    scan.window.as_mut_ptr()
}
/// 0 untouched, 1 the durations are already an output, 2 rewrite. Writes the graph field's
/// (begin, data, end), the name's UTF-16 length, then the header and output byte lengths.
/// # Safety
/// `scan` live, `output` holds six numbers.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_result(scan: *const Scan, output: *mut f64) -> i32 {
    let (Some(scan), false) = (scan.as_ref(), output.is_null()) else { return -1 };
    let graph = scan.graph.unwrap_or(Field { number: 0, wire: 0, begin: 0, data: 0, end: 0 });
    let values = [graph.begin as f64, graph.data as f64, graph.end as f64, scan.name.len() as f64, scan.header.len() as f64, scan.output.len() as f64];
    std::ptr::copy_nonoverlapping(values.as_ptr(), output, 6);
    scan.mode
}
/// # Safety
/// `scan` live; valid until the next call into this core.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_name(scan: *const Scan) -> *const u16 { scan.as_ref().map_or(std::ptr::null(), |scan| scan.name.as_ptr()) }
/// # Safety
/// As onnx_scan_name.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_header(scan: *const Scan) -> *const u8 { scan.as_ref().map_or(std::ptr::null(), |scan| scan.header.as_ptr()) }
/// # Safety
/// As onnx_scan_name.
#[no_mangle]
pub unsafe extern "C" fn onnx_scan_output(scan: *const Scan) -> *const u8 { scan.as_ref().map_or(std::ptr::null(), |scan| scan.output.as_ptr()) }

/// The page boundaries the alignment phonemizes: distinct integers strictly inside the text, ascending.
/// # Safety
/// `marks` holds `count` numbers (NaN for a non-number), `output` as many.
#[no_mangle]
pub unsafe extern "C" fn voice_mark_offsets(marks: *const f64, count: usize, length: f64, output: *mut f64) -> i32 {
    if (count > 0 && (marks.is_null() || output.is_null())) || count > 16_777_216 { return -1; }
    let source = if count == 0 { &[][..] } else { std::slice::from_raw_parts(marks, count) };
    let mut offsets: Vec<f64> = source.iter().copied().filter(|n| n.is_finite() && n.fract() == 0.0 && *n > 0.0 && *n < length).collect();
    offsets.sort_by(|a, b| a.partial_cmp(b).unwrap());
    offsets.dedup();
    std::ptr::copy_nonoverlapping(offsets.as_ptr(), output, offsets.len());
    offsets.len() as i32
}
/// How many leading phonemes of a prefix agree with the whole text's, stopping at the end marker 2.
/// # Safety
/// `prefix` holds `prefix_count` numbers and `ids` `id_count`.
#[no_mangle]
pub unsafe extern "C" fn voice_prefix_phonemes(prefix: *const f64, prefix_count: usize, ids: *const f64, id_count: usize) -> i32 {
    if (prefix_count > 0 && prefix.is_null()) || (id_count > 0 && ids.is_null()) { return -1; }
    let prefix = if prefix_count == 0 { &[][..] } else { std::slice::from_raw_parts(prefix, prefix_count) };
    let ids = if id_count == 0 { &[][..] } else { std::slice::from_raw_parts(ids, id_count) };
    prefix.iter().zip(ids).take_while(|(a, b)| a == b && **a != 2.0).count() as i32
}
