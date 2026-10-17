// Fetch the interface faces alongside WASM/storage. Rust supplies only the
// actual spine styles needed by this library; cold matching loads its own candidates.
export function prepareShelfFonts(lettering = []) {
  const fonts = globalThis.document?.fonts;
  if (!fonts?.load) return;
  const requests = new Map([
    ['400 16px "DM Sans"', ' '],
    ['700 20px "Comfortaa"', ' '],
    ['700 20px "Playfair Display"', ' ']
  ]);
  for (const {font, text} of lettering) requests.set(font, `${requests.get(font) || ''} ${text || ''}`);
  return Promise.allSettled([...requests].map(async ([font, text]) => fonts.load(font, text)));
}
