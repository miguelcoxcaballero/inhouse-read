import { createPhonemizer } from '../../../src/js/readers/neural-voice/phonemizer.js'

const BOOK = 'Nadie en el pueblo recordaba cuándo había llegado el forastero, pero todos coincidían en que traía consigo una maleta de cuero gastada. Cuando el reloj marcó la medianoche, el viejo bibliotecario cerró el último libro, apagó la lámpara y salió despacio. La lluvia golpeaba suavemente los cristales de la vieja biblioteca, y nadie en la sala se atrevía a romper el silencio. Después de un largo día, Ana volvió a casa y abrió el libro que su abuelo le había regalado cuando era pequeña. Al otro lado del río, las luces del pueblo se encendían una a una, como si alguien contara despacio las estrellas.'
// 180 characters, a different window of the book every time: nothing is ever served from a cache of the module.
const fragment = i => { const at = (i * 37) % (BOOK.length - 180); return BOOK.slice(at, at + 180) }

onmessage = async ({ data }) => {
  const { id, count, base, rebuildEvery } = data
  try {
    let builds = 0
    const importModule = async url => { const module = await import(/* @vite-ignore */ url); const factory = module.default; return { default: async hooks => { builds++; return factory(hooks) } } }
    const phonemizer = await createPhonemizer({ base, importModule, ...(rebuildEvery ? { rebuildEvery } : {}) })
    const ids = [], firstIds = []
    let failed = null
    for (let i = 0; i < count; i++) {
      try {
        const result = await phonemizer.phonemize(fragment(i), 'es-419')
        ids.push(result.length)
        if (i === 0) firstIds.push(result.join(','))
      } catch (error) { failed = { at: i, error: String(error.message || error).slice(0, 200) }; break }
    }
    // after every rebuild the same text must still give the same ids
    const again = failed ? null : (await phonemizer.phonemize(fragment(0), 'es-419')).join(',')
    if (!failed && again !== firstIds[0]) failed = { at: count, error: 'the first text gave different ids after the modules were replaced' }
    postMessage({ id, ok: ids.length, failed, ids, builds })
  } catch (error) { postMessage({ id, error: String(error.message || error) }) }
}
