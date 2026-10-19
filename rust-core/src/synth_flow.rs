//! What the synthesis worker (and the Android client) do with the model's output, and the
//! Piper phoneme-id bookkeeping that precedes it. One call finishes a chunk of audio:
//! clean it (peak normalisation, silence trimming, fades: pcm.rs), place the page boundaries
//! from the model's own frame durations (duration_marks.rs), speed it up without changing
//! its pitch (speech_tempo.rs) and add the rests between sentences and after the fragment.
//! The frozen JavaScript originals are tests/unit/helpers/reference-pcm-timing.js,
//! reference-piper-alignment.js, reference-speech-tempo.js and reference-pcm.js.

use crate::voice_math::{js_max,js_min,round_half_up};
/// `Number(rate) || 1`, then `Math.min(3, Math.max(0.5, x))`.
fn clamp_rate(rate: f64) -> f64 { (if rate.is_nan() || rate == 0.0 { 1.0 } else { rate }).max(0.5).min(3.0) }
/// `Math.round(sampleRate * ms / 1000)` samples of silence, never negative.
fn silence_len(sample_rate: f64, ms: f64) -> usize { let n = round_half_up(sample_rate * ms / 1000.0); if n > 0.0 { n as usize } else { 0 } }
/// How much of the pause after a fragment is kept at `rate`: slower speech keeps longer rests,
/// faster speech shortens them less than its own speed-up (2x keeps ~70%).
fn rest_scale(rate: f64) -> f64 { let speed = clamp_rate(rate); if speed > 1.0 { 1.0 / speed.sqrt() } else { 1.0 / speed } }

/// JavaScript `\s` (no `u` flag).
fn space(c: u16) -> bool { matches!(c, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff) }
fn closer(c: u16) -> bool { matches!(c, 0x22 | 0x27 | 0x201d | 0x2019 | 0xbb | 0x203a | 0x29 | 0x5d | 0x7d | 0x300d | 0x300f) }
fn sentence_end(c: u16) -> bool { matches!(c, 0x2e | 0x21 | 0x3f | 0x2026 | 0x3002 | 0xff01 | 0xff1f) }
fn clause_end(c: u16) -> bool { matches!(c, 0x2c | 0x3b | 0x3a | 0xff0c | 0xff1b | 0xff1a | 0x2014 | 0x2013 | 0x2d) }
/// How long the voice rests when a fragment ends: a full stop is a real pause, a fragment cut at
/// a comma a short one, and one cut in the middle of a clause (long sentences are split at
/// <=180 characters) hardly any. The text ends with: a mark, closing quotes/brackets, spaces.
fn pause_after(text: &[u16]) -> f64 {
    let mut end = text.len();
    while end > 0 && space(text[end - 1]) { end -= 1; }
    while end > 0 && closer(text[end - 1]) { end -= 1; }
    if end > 0 && sentence_end(text[end - 1]) { 240.0 } else if end > 0 && clause_end(text[end - 1]) { 140.0 } else { 60.0 }
}

/// `Math.min(1, Math.max(.5, Number(rate) || 1))`: the rate the model itself is asked for.
#[no_mangle]
pub extern "C" fn voice_synthesis_rate(rate: f64) -> f64 { clamp_rate(rate).min(1.0) }
/// `Math.max(1, Math.min(3, Number(rate) || 1))`: how much faster than the model's own speed the audio is played.
#[no_mangle]
pub extern "C" fn voice_tempo_speed(rate: f64) -> f64 { clamp_rate(rate).max(1.0) }
/// Piper stretches time, so a faster voice is a smaller length scale.
#[no_mangle]
pub extern "C" fn voice_length_scale(base: f64, rate: f64) -> f64 { base / clamp_rate(rate) }

/// The `scales` tensor of one Piper run: `[noise_scale ?? 0.667, length_scale ?? 1 stretched for
/// the model's rate, noise_w ?? 0.8]` as float32. `missing_*` is 1 for a null/undefined field
/// (its value is then ignored); a present one arrives as its ToNumber.
/// # Safety: `output` holds three float32.
#[no_mangle]
pub unsafe extern "C" fn voice_piper_scales(noise: f64, missing_noise: u32, length: f64, missing_length: u32,
    width: f64, missing_width: u32, rate: f64, output: *mut f32) -> i32 {
    if output.is_null() { return -1; }
    let pick = |value: f64, missing: u32, default: f64| if missing != 0 { default } else { value };
    let scale = voice_length_scale(pick(length, missing_length, 1.0), voice_synthesis_rate(rate));
    *output = pick(noise, missing_noise, 0.667) as f32;
    *output.add(1) = scale as f32;
    *output.add(2) = pick(width, missing_width, 0.8) as f32;
    1
}

/// Piper numbers phonemes with its default table (154 symbols); some voices were trained with a few
/// less or more. An id the voice does not know would make the model fail, so it is dropped together
/// with its pad. `num_symbols` 0 or NaN keeps everything. Returns the number of ids written.
/// # Safety: live disjoint buffers of `count` ids each.
#[no_mangle]
pub unsafe extern "C" fn voice_limit_ids(ids: *const u32, count: usize, num_symbols: f64, output: *mut u32) -> i32 {
    if (count > 0 && (ids.is_null() || output.is_null())) || count > 16_777_216 { return -1; }
    let source = if count == 0 { &[][..] } else { std::slice::from_raw_parts(ids, count) };
    let keep_all = num_symbols == 0.0 || num_symbols.is_nan();
    let mut written = 0usize;
    for &id in source {
        if !keep_all {
            if id as f64 >= num_symbols { continue; }
            if id == 0 && written > 0 && *output.add(written - 1) == 0 { continue; }
        }
        *output.add(written) = id; written += 1;
    }
    written as i32
}

/// What piper_phonemize returns when the text holds '.', '?' or '!' inside is several '^...$'
/// sentences concatenated; this splits it into one id sequence per sentence (each ends with the
/// end marker 2), dropping the empty ones ('^_$': three ids or fewer). `ids` come back concatenated
/// in `output` (as many as went in, at most) and the length of each sentence in `lengths`.
/// Returns the number of sentences.
/// # Safety: `output` holds `count` ids, `lengths` holds `count / 4 + 1`.
#[no_mangle]
pub unsafe extern "C" fn voice_split_segments(ids: *const u32, count: usize, output: *mut u32, lengths: *mut u32) -> i32 {
    if (count > 0 && ids.is_null()) || output.is_null() || lengths.is_null() || count > 16_777_216 { return -1; }
    let source = if count == 0 { &[][..] } else { std::slice::from_raw_parts(ids, count) };
    let (mut written, mut segments, mut start) = (0usize, 0usize, 0usize);
    let mut close = |end: usize, written: &mut usize| {
        if end - start > 3 {
            std::ptr::copy_nonoverlapping(source.as_ptr().add(start), output.add(*written), end - start);
            *written += end - start; *lengths.add(segments) = (end - start) as u32; segments += 1;
        }
        start = end;
    };
    for (index, &id) in source.iter().enumerate() { if id == 2 { close(index + 1, &mut written); } }
    close(source.len(), &mut written);
    segments as i32
}

/// Speeds a cleaned chunk up by `rate` (pitch unchanged) and carries its boundaries along.
/// `marks` are `(index, sample)` records. At normal speed (or without audio) both come back
/// untouched; otherwise the boundaries that do not name a sample of the audio are dropped and the
/// rest are put in order of sample. Err: -2 input the tempo cannot take, -3 too many boundaries.
fn tempo_stage(speech: &[f32], sample_rate: f64, rate: f64, marks: Vec<(usize, f64)>) -> Result<(Vec<f32>, Vec<(usize, f64)>), i32> {
    let speed = clamp_rate(rate).max(1.0);
    if speed == 1.0 || speech.is_empty() { return Ok((speech.to_vec(), marks)); }
    if speech.len() > 4_194_304 || sample_rate.fract() != 0.0 || !(8000.0..=96000.0).contains(&sample_rate) || speech.iter().any(|x| !x.is_finite()) { return Err(-2); }
    let mut sorted: Vec<(usize, f64)> = marks.into_iter().filter(|m| m.1.fract() == 0.0 && m.1 >= 0.0 && m.1 < speech.len() as f64).collect();
    sorted.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    if sorted.len() > 128 { return Err(-3); }
    let mut positions: Vec<f64> = sorted.iter().map(|m| m.1).collect();
    let mut out = vec![0f32; speech.len()];
    let written = unsafe { crate::speech_tempo::speech_tempo(speech.as_ptr(), out.as_mut_ptr(), speech.len(), sample_rate as u32, speed, positions.as_mut_ptr(), positions.len()) };
    if written == 0 { return Err(-2); }
    out.truncate(written);
    Ok((out, sorted.iter().zip(positions).map(|(m, p)| (m.0, p)).collect()))
}

unsafe fn text_of<'a>(text: *const u16, len: usize) -> &'a [u16] { if len == 0 { &[] } else { std::slice::from_raw_parts(text, len) } }

/// Finishes one sentence of Piper audio. `raw` (cleaned in place, so a copy of the model's output)
/// and `durations` are the model's outputs; `phonemes` are the phoneme index of every page
/// boundary of the fragment. `config`: `[sample rate, 1 for the NVCC voice, rate, first phoneme
/// of this sentence in the fragment, its phoneme count, 1 for the fragment's last sentence,
/// 1 when a rest comes first (not the first sentence)]`. The cleaned, sped up audio with its
/// rests is written to `out_pcm` and the boundaries `(index into phonemes, sample)` to `out_marks`
/// (two f64 per boundary); `meta` receives `[samples, boundaries]`. Returns 1, or -1 misuse,
/// -2 input the tempo cannot take, -3 too many boundaries, -4 `out_pcm` too small.
/// # Safety: live disjoint buffers of the declared sizes; `out_marks` holds two f64 per phoneme entry.
#[no_mangle]
pub unsafe extern "C" fn voice_finish_piper(raw: *mut f32, raw_len: usize, durations: *const f32, duration_count: usize,
    phonemes: *const f64, mark_count: usize, text: *const u16, text_len: usize, config: *const f64,
    out_pcm: *mut f32, out_capacity: usize, out_marks: *mut f64, meta: *mut f64) -> i32 {
    if raw.is_null() || config.is_null() || out_pcm.is_null() || meta.is_null() || (mark_count > 0 && (phonemes.is_null() || out_marks.is_null()))
        || (duration_count > 0 && durations.is_null()) || (text_len > 0 && text.is_null()) { return -1; }
    let cfg = std::slice::from_raw_parts(config, 7);
    let (sample_rate, rate, base, count) = (cfg[0], cfg[2], cfg[3], cfg[4]);
    let mut prepared = [0f64; 4];
    if raw_len > 0 && crate::pcm::pcm_prepare(raw, prepared.as_mut_ptr(), raw_len, sample_rate, if cfg[1] != 0.0 { 1 } else { 0 }) != 1 { return -1; }
    let (from, to) = if raw_len > 0 { (prepared[1] as usize, prepared[2] as usize) } else { (0, 0) };
    let speech = std::slice::from_raw_parts(raw.add(from) as *const f32, to - from);
    // Where each page boundary falls: the phoneme durations are summed once, left to right.
    let mut timeline = Vec::new();
    if mark_count > 0 {
        let phonemes = std::slice::from_raw_parts(phonemes, mark_count);
        let durations: Vec<f64> = if duration_count == 0 { Vec::new() } else { std::slice::from_raw_parts(durations, duration_count).iter().map(|&d| d as f64).collect() };
        match crate::duration_marks::map_marks(&durations, phonemes, [base, count, raw_len as f64, from as f64, 0.0, speech.len() as f64]) {
            Ok(found) => timeline = found,
            Err(_) => return -1,
        }
    }
    let (fast, marks) = match tempo_stage(speech, sample_rate, rate, timeline) { Ok(done) => done, Err(code) => return code };
    let rest = rest_scale(rate);
    let lead = if cfg[6] != 0.0 { silence_len(sample_rate, 240.0 * rest) } else { 0 };
    let tail = if cfg[5] != 0.0 { silence_len(sample_rate, pause_after(text_of(text, text_len)) * rest) } else { 0 };
    let total = lead + fast.len() + tail;
    if total > out_capacity { return -4; }
    let out = std::slice::from_raw_parts_mut(out_pcm, total);
    out[..lead].fill(0.0); out[lead..lead + fast.len()].copy_from_slice(&fast); out[lead + fast.len()..].fill(0.0);
    for (i, m) in marks.iter().enumerate() { *out_marks.add(i * 2) = m.0 as f64; *out_marks.add(i * 2 + 1) = m.1 + lead as f64; }
    let summary = std::slice::from_raw_parts_mut(meta, 2);
    summary[0] = total as f64; summary[1] = marks.len() as f64;
    1
}

/// Finishes the audio of one Supertonic fragment (which is already at its final speed): clean it,
/// move the boundaries (`marks`: their samples in the raw audio) by what the cleaning cut from
/// the front, and add the rest after the fragment. `config`: `[sample rate, rate]`. Same outputs
/// and codes as `voice_finish_piper`; -2 also for a sample that is not a number.
/// # Safety: live disjoint buffers of the declared sizes; `out_marks` holds two f64 per boundary.
#[no_mangle]
pub unsafe extern "C" fn voice_finish_supertonic(raw: *mut f32, raw_len: usize, text: *const u16, text_len: usize,
    marks: *const f64, mark_count: usize, config: *const f64, out_pcm: *mut f32, out_capacity: usize,
    out_marks: *mut f64, meta: *mut f64) -> i32 {
    if raw.is_null() || config.is_null() || out_pcm.is_null() || meta.is_null() || (mark_count > 0 && (marks.is_null() || out_marks.is_null())) || (text_len > 0 && text.is_null()) { return -1; }
    let cfg = std::slice::from_raw_parts(config, 2);
    let (sample_rate, rate) = (cfg[0], cfg[1]);
    if raw_len > 0 && std::slice::from_raw_parts(raw, raw_len).iter().any(|x| !x.is_finite()) { return -2; }
    let mut prepared = [0f64; 4];
    if raw_len > 0 && crate::pcm::pcm_prepare(raw, prepared.as_mut_ptr(), raw_len, sample_rate, 0) != 1 { return -1; }
    let (from, to) = if raw_len > 0 { (prepared[1] as usize, prepared[2] as usize) } else { (0, 0) };
    let speech = std::slice::from_raw_parts(raw.add(from) as *const f32, to - from);
    let tail = silence_len(sample_rate, pause_after(text_of(text, text_len)) * rest_scale(rate));
    let total = speech.len() + tail;
    if total > out_capacity { return -4; }
    let out = std::slice::from_raw_parts_mut(out_pcm, total);
    out[..speech.len()].copy_from_slice(speech); out[speech.len()..].fill(0.0);
    let last = speech.len() as f64 - 1.0;
    if mark_count > 0 {
        let samples = std::slice::from_raw_parts(marks, mark_count);
        let records = std::slice::from_raw_parts_mut(out_marks, mark_count * 2);
        for (i, &sample) in samples.iter().enumerate() {
            let clamped = js_max(0.0, js_min(last, sample - from as f64));
            records[i * 2] = i as f64; records[i * 2 + 1] = clamped;
        }
    }
    let summary = std::slice::from_raw_parts_mut(meta, 2);
    summary[0] = total as f64; summary[1] = mark_count as f64;
    1
}

/// Speeds a whole utterance up by `rate` for the Supertonic runtime (the model does not speed
/// up; see `tempo_stage`). `config`: `[sample rate, rate]`; `out_pcm` holds `raw_len` samples.
/// Returns the number of samples written (at least 1) with the boundaries `(index, sample)` in
/// `out_marks` (two f64 per input boundary) and their count in `meta[0]`; -2 / -3 as above.
/// # Safety: live disjoint buffers of the declared sizes.
#[no_mangle]
pub unsafe extern "C" fn voice_speed_up(raw: *const f32, raw_len: usize, marks: *const f64, mark_count: usize, config: *const f64,
    out_pcm: *mut f32, out_marks: *mut f64, meta: *mut f64) -> i32 {
    if raw_len == 0 || raw.is_null() || config.is_null() || out_pcm.is_null() || meta.is_null() || (mark_count > 0 && (marks.is_null() || out_marks.is_null())) { return -1; }
    let cfg = std::slice::from_raw_parts(config, 2);
    let timeline: Vec<(usize, f64)> = if mark_count == 0 { Vec::new() } else { std::slice::from_raw_parts(marks, mark_count).iter().copied().enumerate().collect() };
    let (fast, found) = match tempo_stage(std::slice::from_raw_parts(raw, raw_len), cfg[0], cfg[1], timeline) { Ok(done) => done, Err(code) => return code };
    std::ptr::copy_nonoverlapping(fast.as_ptr(), out_pcm, fast.len());
    for (i, m) in found.iter().enumerate() { *out_marks.add(i * 2) = m.0 as f64; *out_marks.add(i * 2 + 1) = m.1; }
    *meta = found.len() as f64;
    fast.len() as i32
}
