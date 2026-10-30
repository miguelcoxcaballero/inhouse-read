//! The catalogue of natural voices the picker offers: the curated Piper voices (rhasspy/piper-voices, VITS models) and the
//! Supertonic 3 profiles (supertonic_catalog.rs), with where to download them from. Only voices that were proven end to
//! end with their real weights are listed; adding one is a line in MODELS (plus its speakers, if it has several). The page
//! receives the whole catalogue once as one JSON document (`voice_catalogue_json`, written at build time by build.rs),
//! awaited at start-up like the core itself; the frozen JavaScript originals are tests/unit/helpers/reference-neural-catalog.js and
//! reference-supertonic-catalog.js.
use crate::json::{n, obj, s, V};
use crate::supertonic_catalog as supertonic;

/// Voice ids are namespaced so they never collide with Android/browser voice ids.
const PREFIX: &str = "piper:";
/// Where the Piper models live (a mirror set before the app starts may replace it on the page).
const PIPER_BASE: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
const EXTRA_LICENSES: &str = "licenses/piper-extra-voices.txt";

/// One downloadable model. `size_mb` is the .onnx download (63 MB for a 'medium' voice, 77 for sharvard and
/// ukrainian_tts); the name and the speakers come from each voice's .onnx.json (dataset, speaker_id_map). `recommended`
/// is the one the picker offers first for its language. A speaker is (name, speaker id inside the model).
struct Model { piper: &'static str, lang: &'static str, quality: &'static str, size_mb: u32, recommended: bool,
    license: Option<&'static str>, speakers: &'static [(&'static str, u32)] }
const fn model(piper: &'static str, lang: &'static str, quality: &'static str, size_mb: u32, recommended: bool, speakers: &'static [(&'static str, u32)]) -> Model {
    Model { piper, lang, quality, size_mb, recommended, license: None, speakers }
}
const fn licensed(piper: &'static str, lang: &'static str, quality: &'static str, size_mb: u32, license: &'static str, speakers: &'static [(&'static str, u32)]) -> Model {
    Model { piper, lang, quality, size_mb, recommended: false, license: Some(license), speakers }
}
// Spanish is first (the app's own language).
const MODELS: &[Model] = &[
    model("es_MX-claude-high", "es-MX", "high", 63, true, &[("Claude", 0)]),
    model("es_ES-davefx-medium", "es-ES", "medium", 63, false, &[("Davefx", 0)]),
    model("es_ES-sharvard-medium", "es-ES", "medium", 77, false, &[("Sharvard (hombre)", 0), ("Sharvard (mujer)", 1)]),
    model("en_US-lessac-medium", "en-US", "medium", 63, true, &[("Lessac", 0)]),
    model("en_GB-alba-medium", "en-GB", "medium", 63, false, &[("Alba", 0)]),
    model("fr_FR-siwis-medium", "fr-FR", "medium", 63, true, &[("Siwis", 0)]),
    model("de_DE-thorsten-medium", "de-DE", "medium", 63, true, &[("Thorsten", 0)]),
    model("it_IT-paola-medium", "it-IT", "medium", 63, true, &[("Paola", 0)]),
    model("pt_BR-faber-medium", "pt-BR", "medium", 63, true, &[("Faber", 0)]),
    model("pt_PT-tugão-medium", "pt-PT", "medium", 63, false, &[("Tugão", 0)]),
    model("ca_ES-upc_ona-medium", "ca-ES", "medium", 63, true, &[("Ona", 0)]),
    licensed("ca_ES-upc_pau-x_low", "ca-ES", "low", 28, "CC BY-SA 3.0 ES", &[("Pau", 0)]),
    // Other regions of the first languages.
    model("es_AR-daniela-high", "es-AR", "high", 114, false, &[("Daniela", 0)]),
    model("en_GB-cori-high", "en-GB", "high", 114, false, &[("Cori", 0)]),
    // More languages. Installation retains required external dictionaries for cold offline playback.
    model("nl_NL-pim-medium", "nl-NL", "medium", 64, true, &[("Pim", 0)]),
    model("pl_PL-gosia-medium", "pl-PL", "medium", 63, true, &[("Gosia", 0)]),
    model("ru_RU-irina-medium", "ru-RU", "medium", 63, true, &[("Irina", 0)]),
    model("uk_UA-ukrainian_tts-medium", "uk-UA", "medium", 77, true, &[("Lada", 0), ("Mykyta", 1), ("Tetiana", 2)]),
    model("tr_TR-dfki-medium", "tr-TR", "medium", 63, true, &[("DFKI", 0)]),
    model("sv_SE-nst-medium", "sv-SE", "medium", 63, true, &[("NST", 0)]),
    model("da_DK-talesyntese-medium", "da-DK", "medium", 63, true, &[("Talesyntese", 0)]),
    model("no_NO-talesyntese-medium", "nb-NO", "medium", 63, true, &[("Talesyntese", 0)]),
    // NVCC's source speaker map and Table 2 identify KON and MON as distinct Oslo speakers. Both share the same
    // downloaded model, not a pitch preset.
    licensed("no_NO-nvcc-medium", "nb-NO", "medium", 77, "CC0", &[("NVCC KON", 3), ("NVCC MON", 6)]),
    model("fi_FI-harri-medium", "fi-FI", "medium", 63, true, &[("Harri", 0)]),
    model("cs_CZ-jirka-medium", "cs-CZ", "medium", 63, true, &[("Jirka", 0)]),
    model("el_GR-rapunzelina-low", "el-GR", "low", 63, true, &[("Rapunzelina", 0)]),
    model("hu_HU-anna-medium", "hu-HU", "medium", 63, true, &[("Anna", 0)]),
    model("ro_RO-mihai-medium", "ro-RO", "medium", 63, true, &[("Mihai", 0)]),
    model("ar_JO-kareem-medium", "ar-JO", "medium", 63, true, &[("Kareem", 0)]),
    model("zh_CN-huayan-medium", "zh-CN", "medium", 63, true, &[("Huayan", 0)]),
    model("vi_VN-vais1000-medium", "vi-VN", "medium", 63, true, &[("Vais1000", 0)]),
    model("bg_BG-dimitar-medium", "bg-BG", "medium", 63, true, &[("Dimitar", 0)]),
    // Author-trained Serbian model; the similarly named rhasspy model is actually Sorbian.
    model("sr_RS-marko-medium", "sr-RS", "medium", 64, true, &[("Marko", 0)]),
    model("hi_IN-pratham-medium", "hi-IN", "medium", 64, true, &[("Pratham", 0)]),
    // Includes Nakdimon, required for real Hebrew phonemization and offline playback.
    model("he_IL-saspeech-medium", "he-IL", "medium", 85, true, &[("Saspeech", 0)]),
];

/// One entry per voice a person can pick: a model with several speakers gives one entry per speaker (they share the one
/// downloaded model). The id of speaker 0 is 'piper:<piperId>', the others 'piper:<piperId>#<speaker>'.
fn piper_voices() -> V {
    let mut voices = Vec::new();
    for model in MODELS {
        for (index, &(name, speaker)) in model.speakers.iter().enumerate() {
            let id = if speaker != 0 { format!("{PREFIX}{}#{speaker}", model.piper) } else { format!("{PREFIX}{}", model.piper) };
            let mut fields = vec![("id", V::S(id)), ("piperId", s(model.piper)), ("lang", s(model.lang)), ("name", s(name)),
                ("quality", s(model.quality)), ("sizeMB", n(f64::from(model.size_mb))), ("speaker", n(f64::from(speaker)))];
            if let Some(license) = model.license { fields.push(("licenseUrl", s(EXTRA_LICENSES))); fields.push(("licenseName", s(license))); }
            if model.recommended && index == 0 { fields.push(("recommended", V::B(true))); }
            voices.push(obj(fields));
        }
    }
    V::A(voices)
}

/// Every Supertonic profile of every language it speaks, in language then profile order, as rows
/// `[id, lang, dialect, style, name]`; the fields every profile shares are `supertonic_voice()`. Multilingual profiles
/// use generic language tags: they do not claim an Argentine, Mexican, Portuguese or other regional accent.
fn supertonic_voices() -> V {
    let mut voices = Vec::new();
    for &lang in supertonic::LANGUAGES {
        let dialect = supertonic::names_of(lang).map_or("", |entry| entry.1);
        for &style in supertonic::STYLES {
            voices.push(V::A(vec![V::S(format!("{}:{style}:{lang}", supertonic::MODEL_ID)), s(lang), s(dialect), s(style),
                V::S(supertonic::voice_name(lang, style))]));
        }
    }
    V::A(voices)
}
/// What a Supertonic voice record holds before its own fields (`head`) and after them (`tail`): one pack, one size.
fn supertonic_voice() -> V {
    let bytes = supertonic::total_bytes() as f64;
    let upgrade = (supertonic::total_bytes() - supertonic::legacy_bytes()) as f64;
    obj(vec![
        ("head", obj(vec![("modelId", s(supertonic::MODEL_ID)), ("modelKey", s(supertonic::MODEL_ID)), ("piperId", s(supertonic::MODEL_ID)),
            ("runtime", s("supertonic3")), ("provider", s("supertonic"))])),
        ("tail", obj(vec![("quality", s("natural")), ("sizeMB", n((bytes / 1e6).ceil())), ("downloadBytes", n(bytes)), ("upgradeBytes", n(upgrade)),
            ("licenseUrl", s(supertonic::LICENSE_FILE)), ("sharedPack", V::B(true))])),
    ])
}

/// The manifest of the pack, each file with the URL it is downloaded from (the quantized graph keeps its own URL in
/// second place, as the upstream manifest lists it).
fn supertonic_assets() -> V {
    V::A(supertonic::ASSETS.iter().map(|asset| {
        let url = V::S(supertonic::asset_url(asset));
        let (bytes, sha) = (n(asset.bytes as f64), s(asset.sha256));
        if asset.quantized { obj(vec![("path", s(asset.path)), ("url", url), ("bytes", bytes), ("sha256", sha)]) }
        else { obj(vec![("path", s(asset.path)), ("bytes", bytes), ("sha256", sha), ("url", url)]) }
    }).collect())
}
fn strings(list: &[&str]) -> V { V::A(list.iter().map(|&text| s(text)).collect()) }

/// The whole document: the Piper voices, then the Supertonic pack.
pub fn catalogue() -> V {
    let base = supertonic::base();
    let legacy = supertonic::ASSETS.iter().enumerate().filter(|(_, asset)| supertonic::is_legacy(asset)).map(|(index, _)| n(index as f64)).collect();
    let names = supertonic::NAMES.iter().map(|(lang, dialect, women, men)| {
        ((*lang).to_string(), obj(vec![("dialect", s(dialect)), ("F", strings(women)), ("M", strings(men))]))
    }).collect();
    obj(vec![
        ("prefix", s(PREFIX)),
        ("piperBase", s(PIPER_BASE)),
        ("piperVoices", piper_voices()),
        ("supertonic", obj(vec![
            ("modelId", s(supertonic::MODEL_ID)), ("revision", s(supertonic::REVISION)), ("base", V::S(base.clone())),
            ("quantRevision", s(supertonic::QUANT_REVISION)),
            ("vectorUrl", V::S(format!("{}{}{}", supertonic::VECTOR_PREFIX, supertonic::QUANT_REVISION, supertonic::VECTOR_SUFFIX))),
            ("assets", supertonic_assets()), ("legacyAssets", V::A(legacy)), ("bytes", n(supertonic::total_bytes() as f64)),
            ("languages", strings(supertonic::LANGUAGES)), ("legacyStyles", strings(supertonic::LEGACY_STYLES)), ("styles", strings(supertonic::STYLES)),
            ("license", obj(vec![("name", s(supertonic::LICENSE_NAME)), ("url", V::S(format!("{base}LICENSE"))), ("attribution", s(supertonic::ATTRIBUTION))])),
            ("names", V::O(names)),
            ("voice", supertonic_voice()),
            ("voices", supertonic_voices()),
        ])),
    ])
}

/// The catalogue as the page receives it, written once by build.rs (which compiles this very file for the build host):
/// the start-up only copies these bytes instead of formatting the whole document in the core.
#[cfg(target_arch = "wasm32")]
static DOCUMENT: &str = include_str!(concat!(env!("OUT_DIR"), "/voice_catalogue.json"));
/// Writes the catalogue as UTF-8 into `out` when `capacity` allows and returns its length in bytes.
/// # Safety
/// `out` is null or points to `capacity` writable bytes.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn voice_catalogue_json(out: *mut u8, capacity: usize) -> usize {
    if !out.is_null() && capacity >= DOCUMENT.len() { std::ptr::copy_nonoverlapping(DOCUMENT.as_ptr(), out, DOCUMENT.len()); }
    DOCUMENT.len()
}
