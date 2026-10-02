// Prepare REAL Piper weights for the neural Playwright suites. The default is
// every model in the application catalogue; a missing or corrupt model fails
// preparation, so CI cannot turn missing weights into a passing skipped suite.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { DEFAULT_VOICE_BASE, neuralVoices, piperPath, voiceUrls } from '../src/js/readers/neural-voice/catalog.js'

// The catalogue may pin a newer revision explicitly. A /main/ default is
// resolved to this audited commit for fixtures, never to moving model bytes.
const REVISION = /\/resolve\/([a-f0-9]{40})\//.exec(DEFAULT_VOICE_BASE)?.[1] || 'c10ece1aade47bb51c153c893d14e5bf8e5b7117'
const BASE = DEFAULT_VOICE_BASE.replace('/resolve/main/', `/resolve/${REVISION}/`)
const allModels = [...new Set(neuralVoices.map(voice => voice.piperId))]

function options(args) {
  let output = process.env.NEURAL_VOICE_FIXTURES || '.neural-fixtures.local', voices = allModels
  for (let i = 0; i < args.length; i++) {
    const argument = args[i]
    if (argument === '--help') {
      console.log('Usage: node scripts/prepare-neural-fixtures.mjs [--voices id,id] [--output directory]')
      process.exit(0)
    }
    if (argument === '--list') { console.log(allModels.join(',')); process.exit(0) }
    if (['--output', '--output-dir', '--outputdir', '--voices'].includes(argument)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value`)
      if (argument === '--voices') voices = [...new Set(value.split(',').map(id => id.trim().replace(/^piper:/, '').replace(/#\d+$/, '')).filter(Boolean))]
      else output = value
    } else if (!argument.startsWith('-')) output = argument
    else throw new Error(`Unknown option: ${argument}`)
  }
  if (!voices.length) throw new Error('At least one voice is required')
  for (const id of voices) if (!allModels.includes(id)) throw new Error(`Voice is absent from the application catalogue: ${id}`)
  return { output: resolve(output), voices }
}

function pinnedUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error(`Fixture source must use HTTPS: ${url}`)
  if (url.hostname === 'huggingface.co' && /\/resolve\/(main|master)\//.test(url.pathname)) {
    throw new Error(`Fixture source must pin a revision: ${url}`)
  }
  return url.href
}

async function digest(file, algorithm) {
  const hash = createHash(algorithm)
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}

async function validate(file, expected = {}) {
  const { size } = await stat(file)
  if (size < (expected.json ? 2 : 1024)) throw new Error(`Empty or truncated fixture: ${file}`)
  if (expected.size && size !== Number(expected.size)) throw new Error(`${file}: ${size} bytes, expected ${expected.size}`)
  for (const algorithm of ['md5', 'sha256']) {
    if (expected[algorithm] && await digest(file, algorithm) !== expected[algorithm].toLowerCase()) throw new Error(`${file}: ${algorithm} mismatch`)
  }
  if (expected.json) {
    const config = JSON.parse(await readFile(file, 'utf8'))
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`Invalid JSON fixture: ${file}`)
    if (expected.config && (!(Number(config.audio?.sample_rate) > 0) || typeof config.phoneme_id_map !== 'object')) throw new Error(`Invalid Piper configuration: ${file}`)
  }
  return { bytes: size, sha256: await digest(file, 'sha256') }
}

async function download(url, file, expected) {
  pinnedUrl(url)
  try {
    if (!expected.json && !expected.md5 && !expected.sha256) throw new Error('Cached model has no verified fingerprint yet')
    const verified = await validate(file, expected)
    console.log(`Verified cached ${file} (${verified.bytes} bytes)`)
    return verified
  } catch { /* Missing or invalid cached file: replace it with verified bytes. */ }
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.part`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(180_000) })
      if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`)
      const declaredSize = Number(response.headers.get('content-length')) || 0
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
      const verified = await validate(temporary, { ...expected, size: expected.size || declaredSize })
      await rename(temporary, file)
      console.log(`Downloaded ${file} (${verified.bytes} bytes)`)
      return verified
    } catch (error) {
      await rm(temporary, { force: true })
      if (attempt === 3) throw new Error(`Cannot prepare ${file}: ${error.message}`, { cause: error })
      console.log(`Retry ${attempt}/3: ${error.message}`)
      await delay(attempt * 1000)
    }
  }
}

function catalogueExpectation(entry, key, id) {
  const file = entry?.files?.[key]
  if (!(Number(file?.size_bytes) > 0)) throw new Error(`Pinned upstream catalogue has no file ${key} for ${id}`)
  return { size: Number(file.size_bytes), ...(file.md5_digest ? { md5: file.md5_digest } : {}) }
}

function fixtureSources(id) {
  // Ask for the production sources first: passing a different base asks the
  // catalogue for test-mirror paths, including custom authors and auxiliaries.
  const source = voiceUrls(id, DEFAULT_VOICE_BASE)
  for (const name of ['model', 'config', 'catalogue']) {
    if (source[name]?.startsWith(DEFAULT_VOICE_BASE)) source[name] = BASE + source[name].slice(DEFAULT_VOICE_BASE.length)
  }
  return source
}

async function main() {
  const { output, voices } = options(process.argv.slice(2))
  await mkdir(output, { recursive: true })
  const urls = new Map(voices.map(id => [id, fixtureSources(id)]))
  let previous = {}
  try { previous = JSON.parse(await readFile(join(output, 'fixtures-manifest.json'), 'utf8')).voices || {} } catch { /* First preparation. */ }
  let catalogue = null
  if ([...urls.values()].some(source => source.model.startsWith(BASE))) {
    const metadata = join(output, `voices-${REVISION}.json`)
    await download(`${BASE}voices.json`, metadata, { json: true })
    catalogue = JSON.parse(await readFile(metadata, 'utf8'))
  }
  const verified = {}
  for (const id of voices) {
    const source = urls.get(id), standard = source.model.startsWith(BASE)
    const prior = previous[id]
    const priorModel = prior?.modelUrl === source.model ? prior.model : null
    const priorConfig = prior?.configUrl === source.config ? prior.config : null
    const model = standard ? catalogueExpectation(catalogue?.[id], `${piperPath(id)}.onnx`, id) : {
      size: source.modelSize || source.modelBytes || priorModel?.bytes, sha256: source.modelSha256 || priorModel?.sha256
    }
    const config = standard ? catalogueExpectation(catalogue?.[id], `${piperPath(id)}.onnx.json`, id) : {
      size: source.configSize || priorConfig?.bytes, sha256: source.configSha256 || priorConfig?.sha256
    }
    verified[id] = {
      modelUrl: source.model,
      configUrl: source.config,
      config: await download(source.config, join(output, `${id}.onnx.json`), { ...config, json: true, config: true }),
      model: await download(source.model, join(output, `${id}.onnx`), model)
    }
    if (source.phonemizerModel) {
      if (!(Number(source.phonemizerSize) > 0) || !/^[a-f0-9]{64}$/i.test(source.phonemizerSha256 || '')) throw new Error(`${id}: auxiliary phonemizer needs its size and SHA256`)
      verified[id].phonemizer = await download(source.phonemizerModel, join(output, 'nakdimon.onnx'), {
        size: source.phonemizerSize, sha256: source.phonemizerSha256
      })
      verified[id].phonemizerUrl = source.phonemizerModel
    }
  }
  await writeFile(join(output, 'fixtures-manifest.json'), JSON.stringify({ revision: REVISION, voices: verified }, null, 2) + '\n')
  console.log(`Prepared and verified ${voices.length} real models in ${output}`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
