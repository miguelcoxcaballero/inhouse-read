//! Exact 12x12 paper-margin sampler; no retained buffers or browser imports.
const SIZE: usize = 12;
fn sample(data: &[u8]) -> i32 {
    if data.len() != SIZE * SIZE * 4 { return -1; }
    let mut channels = [[0u8; 44]; 3];
    let mut count = 0;
    for i in 0..SIZE - 1 {
        for (x,y) in [(i,0),(SIZE-1,i),(SIZE-1-i,SIZE-1),(0,SIZE-1-i)] {
            let offset = (y*SIZE+x)*4;
            if data[offset+3] > 200 {
                for channel in 0..3 { channels[channel][count] = data[offset+channel]; }
                count += 1;
            }
        }
    }
    if count < 16 { return -1; }
    let mut packed = 0;
    for values in &mut channels {
        let values = &mut values[..count]; values.sort_unstable();
        if values[(count-1)*3/4] - values[(count-1)/4] > 20 { return -1; }
        packed = (packed << 8) | i32::from(values[(count-1)/2]);
    }
    packed
}

/// Caller owns exactly 576 readable bytes for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn page_paper_tone(data: *const u8, length: u32) -> i32 {
    if data.is_null() || length != 576 { return -1; }
    sample(std::slice::from_raw_parts(data, length as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn thresholds_and_full_bleed() {
        let mut pixels = [0u8;576];
        for pixel in pixels.chunks_exact_mut(4) { pixel.copy_from_slice(&[237,225,201,201]); }
        assert_eq!(sample(&pixels),0xede1c9);
        for pixel in pixels.chunks_exact_mut(4) { pixel[3]=200; }
        assert_eq!(sample(&pixels),-1);
        assert_eq!(sample(&[]),-1);
    }
}
