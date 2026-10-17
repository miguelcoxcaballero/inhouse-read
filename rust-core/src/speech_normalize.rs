//! UTF-16 cleanup and exact source offsets for narration. Unicode/locale
//! header classification remains with the browser's existing Unicode engine.
fn invisible(c: u16) -> bool { matches!(c, 0x00ad | 0x200b | 0x2060 | 0xfeff) }
pub(crate) fn whitespace(c: u16) -> bool {
    matches!(c, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
// List/section ornaments and a failed font/extraction glyph are visual markers,
// not words. Treat them as spaces so adjacent words never run together. The
// original UTF-16 index is retained by the same whitespace path below.
fn ornament(c: u16) -> bool {
    matches!(c, 0x00a7 | 0x00b6 | 0x2022 | 0x2023 | 0x2043 | 0x204c | 0x204d | 0x2766 | 0x2767 | 0xfffd)
}
fn line_end(c:u16)->bool{matches!(c,10|13|0x2028)}
fn horizontal(c:u16)->bool{whitespace(c)&&!line_end(c)&&c!=0x2029}
// A blank line in extracted PDF/plain text is a paragraph. A single wrapped
// line and the two units of CRLF are not. Mark only the start of each run.
fn blank_paragraph(raw:&[u16],at:usize)->bool{
 let c=raw[at];if !line_end(c)||(c==13&&raw.get(at+1)==Some(&10)){return false;}
 let mut before=if c==10&&at>0&&raw[at-1]==13{at-1}else{at};while before>0&&horizontal(raw[before-1]){before-=1;}
 if before>0&&line_end(raw[before-1]){return false;}
 let mut after=at+1;
 while after<raw.len()&&horizontal(raw[after]){after+=1;}
 after<raw.len()&&line_end(raw[after])
}
fn terminator(c: u16) -> bool { matches!(c, 33 | 46 | 63 | 0x3002 | 0xff01 | 0xff1f | 0x2026 | 58 | 59) }
fn closer(c: u16) -> bool { matches!(c, 34 | 39 | 0x201d | 0x2019 | 0xbb | 0x203a | 41 | 93 | 125 | 0x300d | 0x300f) }

/// # Safety
/// All slabs are disjoint and live: input len u16, removed len u8,
/// output 2*len u16, map 2*len u32, breaks len u32, counts 2 u32.
#[no_mangle]
pub unsafe extern "C" fn speech_normalize(input: *const u16, removed: *const u8,
    len: usize, output: *mut u16, map: *mut u32, breaks: *mut u32, counts: *mut u32) -> u32 {
    let raw = std::slice::from_raw_parts(input, len);
    let removed = std::slice::from_raw_parts(removed, len);
    let out = std::slice::from_raw_parts_mut(output, len * 2);
    let map = std::slice::from_raw_parts_mut(map, len * 2);
    let breaks = std::slice::from_raw_parts_mut(breaks, len);
    let (mut size, mut boundaries) = (0, 0);
    for (i, &c) in raw.iter().enumerate() {
        if removed[i] != 0 || invisible(c) { continue; }
        if c == 0x2029 || blank_paragraph(raw,i) {
            if size > 0 && out[size - 1] == 32 { size -= 1; }
            let mut last = size;
            while last > 0 && closer(out[last - 1]) { last -= 1; }
            if size > 0 && !terminator(out[last.saturating_sub(1)]) && !terminator(out[size - 1]) {
                out[size] = 46; map[size] = i as u32; size += 1;
            }
            if size > 0 { breaks[boundaries] = size as u32; boundaries += 1; }
        }
        if whitespace(c) || ornament(c) {
            if size > 0 && out[size - 1] != 32 { out[size] = 32; map[size] = i as u32; size += 1; }
        } else { out[size] = c; map[size] = i as u32; size += 1; }
    }
    if size > 0 && out[size - 1] == 32 { size -= 1; }
    let mut kept = 0;
    for i in 0..boundaries { if (breaks[i] as usize) < size { breaks[kept] = breaks[i]; kept += 1; } }
    *counts = size as u32; *counts.add(1) = kept as u32;
    1
}
