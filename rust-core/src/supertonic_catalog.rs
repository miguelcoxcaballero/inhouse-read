//! Supertone Supertonic 3. Model: OpenRAIL-M; SDK inference recipe: MIT. The immutable upstream revision, the individual
//! file sizes and SHA-256 digests, the languages and speaker profiles, and the names each profile is shown with. Pure data:
//! the app core hands it to the page in the voice catalogue (voice_catalogue.rs) and the voice module of rust-ui compiles
//! this same file for the languages and profiles the synthesis worker accepts.
#![allow(dead_code)]

pub const MODEL_ID: &str = "supertonic3";
pub const REVISION: &str = "3cadd1ee6394adea1bd021217a0e650ede09a323";
pub const BASE_PREFIX: &str = "https://huggingface.co/Supertone/supertonic-3/resolve/";
/// Only the vector estimator is quantized. Duration, text encoder and vocoder remain the original FP32 graphs. This
/// derivative retains OpenRAIL-M.
pub const QUANT_REVISION: &str = "95618f5d61cef4923c3b802a332fd603723718f7";
pub const VECTOR_PREFIX: &str = "https://huggingface.co/askurios8/supertonic-3-int8/resolve/";
pub const VECTOR_SUFFIX: &str = "/variants/mixed-fast/onnx/vector_estimator.onnx";
pub const LICENSE_NAME: &str = "OpenRAIL-M";
pub const ATTRIBUTION: &str = "Copyright (c) 2026 Supertone Inc.";
pub const LICENSE_FILE: &str = "licenses/supertonic3-OpenRAIL-M.txt";

/// One file of the pack; `quantized` files come from the quantized derivative instead of the upstream revision.
pub struct Asset { pub path: &'static str, pub quantized: bool, pub bytes: u64, pub sha256: &'static str }
pub const ASSETS: &[Asset] = &[
    Asset { path: "onnx/duration_predictor.onnx", quantized: false, bytes: 3700147, sha256: "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db" },
    Asset { path: "onnx/text_encoder.onnx", quantized: false, bytes: 36416150, sha256: "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff" },
    Asset { path: "onnx/vector_estimator.onnx", quantized: true, bytes: 65447164, sha256: "073575704bf0b6ca0714eb6509029f324b794d5bd6dbdb27dccbbc5939abc167" },
    Asset { path: "onnx/vocoder.onnx", quantized: false, bytes: 101424195, sha256: "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba" },
    Asset { path: "onnx/tts.json", quantized: false, bytes: 8253, sha256: "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09" },
    Asset { path: "onnx/unicode_indexer.json", quantized: false, bytes: 277676, sha256: "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f" },
    Asset { path: "voice_styles/F1.json", quantized: false, bytes: 292046, sha256: "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2" },
    Asset { path: "voice_styles/M1.json", quantized: false, bytes: 291748, sha256: "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b" },
    Asset { path: "voice_styles/F2.json", quantized: false, bytes: 292423, sha256: "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6" },
    Asset { path: "LICENSE", quantized: false, bytes: 15007, sha256: "0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f" },
    Asset { path: "voice_styles/F3.json", quantized: false, bytes: 290794, sha256: "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab" },
    Asset { path: "voice_styles/F4.json", quantized: false, bytes: 291808, sha256: "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b" },
    Asset { path: "voice_styles/F5.json", quantized: false, bytes: 291479, sha256: "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d" },
    Asset { path: "voice_styles/M2.json", quantized: false, bytes: 292055, sha256: "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50" },
    Asset { path: "voice_styles/M3.json", quantized: false, bytes: 290198, sha256: "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b" },
    Asset { path: "voice_styles/M4.json", quantized: false, bytes: 291522, sha256: "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303" },
    Asset { path: "voice_styles/M5.json", quantized: false, bytes: 291469, sha256: "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2" },
];
pub const LANGUAGES: &[&str] = &["en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it",
    "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi"];
/// The profiles of the previous pack: only this complete, verified pack can migrate offline.
pub const LEGACY_STYLES: &[&str] = &["F1", "M1", "F2"];
pub const STYLES: &[&str] = &["F1", "M1", "F2", "F3", "F4", "F5", "M2", "M3", "M4", "M5"];
/// Each profile (F1-F5 women, M1-M5 men) is shown with a name of its language and the standard accent of that language;
/// the voice id and the language code given to the model stay as they were. (language, dialect, women, men)
pub const NAMES: &[(&str, &str, [&str; 5], [&str; 5])] = &[
    ("en", "en-US", ["Emma", "Olivia", "Grace", "Hannah", "Lucy"], ["James", "Daniel", "Henry", "Samuel", "Thomas"]),
    ("ko", "ko-KR", ["Ji-woo", "Seo-yeon", "Min-ji", "Ha-eun", "Soo-ah"], ["Min-jun", "Seo-jun", "Do-hyun", "Ji-ho", "Hyun-woo"]),
    ("ja", "ja-JP", ["Yui", "Haruka", "Sakura", "Aoi", "Mei"], ["Haruto", "Sota", "Ren", "Yuto", "Kaito"]),
    ("ar", "ar-SA", ["Layla", "Mariam", "Noor", "Salma", "Huda"], ["Omar", "Karim", "Youssef", "Tariq", "Samir"]),
    ("bg", "bg-BG", ["Maria", "Elena", "Desislava", "Ivana", "Radka"], ["Georgi", "Ivan", "Dimitar", "Nikolay", "Stoyan"]),
    ("cs", "cs-CZ", ["Tereza", "Eliška", "Klára", "Jana", "Lucie"], ["Jakub", "Tomáš", "Ondřej", "Petr", "Martin"]),
    ("da", "da-DK", ["Freja", "Ida", "Clara", "Karen", "Sofie"], ["Mads", "Frederik", "Lars", "Emil", "Rasmus"]),
    ("de", "de-DE", ["Anna", "Lena", "Marie", "Sophie", "Greta"], ["Lukas", "Jonas", "Felix", "Paul", "Matthias"]),
    ("el", "el-GR", ["Eleni", "Maria", "Sofia", "Katerina", "Anna"], ["Giorgos", "Nikos", "Dimitris", "Kostas", "Yannis"]),
    ("es", "es-ES", ["Lucía", "Carmen", "Elena", "Sofía", "Paula"], ["Javier", "Pablo", "Diego", "Andrés", "Mateo"]),
    ("et", "et-EE", ["Liis", "Kadri", "Maarja", "Triin", "Kristiina"], ["Martin", "Rasmus", "Andres", "Siim", "Karl"]),
    ("fi", "fi-FI", ["Aino", "Helmi", "Elina", "Saara", "Kaisa"], ["Eino", "Mikko", "Juhani", "Ville", "Antti"]),
    ("fr", "fr-FR", ["Camille", "Léa", "Chloé", "Manon", "Juliette"], ["Louis", "Hugo", "Julien", "Antoine", "Mathieu"]),
    ("hi", "hi-IN", ["Ananya", "Priya", "Kavya", "Meera", "Diya"], ["Arjun", "Rohan", "Vikram", "Aarav", "Kabir"]),
    ("hr", "hr-HR", ["Ana", "Petra", "Ivana", "Lucija", "Maja"], ["Luka", "Ivan", "Marko", "Petar", "Josip"]),
    ("hu", "hu-HU", ["Anna", "Eszter", "Zsófia", "Réka", "Katalin"], ["Bence", "Máté", "Levente", "Gábor", "Dániel"]),
    ("id", "id-ID", ["Putri", "Ayu", "Dewi", "Sari", "Nadia"], ["Budi", "Rizky", "Adi", "Bayu", "Dimas"]),
    ("it", "it-IT", ["Giulia", "Chiara", "Francesca", "Sara", "Elena"], ["Marco", "Luca", "Matteo", "Giovanni", "Andrea"]),
    ("lt", "lt-LT", ["Ieva", "Gabija", "Austėja", "Rūta", "Eglė"], ["Lukas", "Jonas", "Matas", "Tomas", "Mantas"]),
    ("lv", "lv-LV", ["Anna", "Laura", "Elīza", "Marta", "Kristīne"], ["Jānis", "Mārtiņš", "Roberts", "Kārlis", "Edgars"]),
    ("nl", "nl-NL", ["Emma", "Sanne", "Lotte", "Fleur", "Anouk"], ["Daan", "Sem", "Lucas", "Bram", "Thijs"]),
    ("pl", "pl-PL", ["Zofia", "Julia", "Maja", "Hanna", "Natalia"], ["Jakub", "Antoni", "Szymon", "Mateusz", "Piotr"]),
    ("pt", "pt-BR", ["Ana", "Beatriz", "Mariana", "Júlia", "Larissa"], ["João", "Pedro", "Gabriel", "Rafael", "Thiago"]),
    ("ro", "ro-RO", ["Maria", "Ioana", "Elena", "Andreea", "Ana"], ["Andrei", "Alexandru", "Mihai", "Ștefan", "Radu"]),
    ("ru", "ru-RU", ["Anna", "Olga", "Natalia", "Yelena", "Irina"], ["Alexei", "Dmitri", "Ivan", "Sergei", "Mikhail"]),
    ("sk", "sk-SK", ["Zuzana", "Lucia", "Katarína", "Petra", "Mária"], ["Peter", "Martin", "Tomáš", "Jakub", "Lukáš"]),
    ("sl", "sl-SI", ["Nika", "Eva", "Maja", "Ana", "Lara"], ["Luka", "Jan", "Žiga", "Matej", "Nejc"]),
    ("sv", "sv-SE", ["Elsa", "Maja", "Ebba", "Astrid", "Linnea"], ["Erik", "Oskar", "Lars", "Axel", "Gustav"]),
    ("tr", "tr-TR", ["Elif", "Zeynep", "Ayşe", "Defne", "Ece"], ["Mehmet", "Emre", "Can", "Burak", "Mert"]),
    ("uk", "uk-UA", ["Oksana", "Olena", "Iryna", "Sofiia", "Kateryna"], ["Taras", "Andrii", "Dmytro", "Oleksandr", "Bohdan"]),
    ("vi", "vi-VN", ["Linh", "Mai", "Lan", "Hoa", "Thảo"], ["Minh", "Anh", "Huy", "Tuấn", "Nam"]),
];

/// `https://huggingface.co/Supertone/supertonic-3/resolve/<revision>/`.
pub fn base() -> String { format!("{BASE_PREFIX}{REVISION}/") }
/// The download URL of an asset: the quantized derivative's own, or the upstream revision's.
pub fn asset_url(asset: &Asset) -> String {
    if asset.quantized { format!("{VECTOR_PREFIX}{QUANT_REVISION}{VECTOR_SUFFIX}") } else { format!("{}{}", base(), asset.path) }
}
/// Every asset that is not a voice style, and the styles of the previous pack.
pub fn is_legacy(asset: &Asset) -> bool {
    if !asset.path.starts_with("voice_styles/") { return true; }
    let file = asset.path.rsplit('/').next().unwrap_or("");
    LEGACY_STYLES.contains(&file.replacen(".json", "", 1).as_str())
}
pub fn total_bytes() -> u64 { ASSETS.iter().map(|asset| asset.bytes).sum() }
pub fn legacy_bytes() -> u64 { ASSETS.iter().filter(|asset| is_legacy(asset)).map(|asset| asset.bytes).sum() }
pub fn is_language(lang: &str) -> bool { LANGUAGES.contains(&lang) }
pub fn names_of(lang: &str) -> Option<&'static (&'static str, &'static str, [&'static str; 5], [&'static str; 5])> {
    NAMES.iter().find(|entry| entry.0 == lang)
}
/// 'Lucía' for es F1, 'Javier' for es M1; `Supertonic <style>` when unknown.
pub fn voice_name(lang: &str, style: &str) -> String {
    let index = style.get(1..).and_then(|digits| digits.parse::<usize>().ok()).filter(|&n| (1..=5).contains(&n) && style.len() == 2);
    let found = match (names_of(lang), style.as_bytes().first(), index) {
        (Some(entry), Some(b'F'), Some(n)) => Some(entry.2[n - 1]),
        (Some(entry), Some(b'M'), Some(n)) => Some(entry.3[n - 1]),
        _ => None,
    };
    found.map_or_else(|| format!("Supertonic {style}"), str::to_string)
}
