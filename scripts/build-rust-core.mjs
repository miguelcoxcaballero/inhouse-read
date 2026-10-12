import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cargo = process.env.CARGO || 'cargo'
const target = resolve(process.env.CARGO_TARGET_DIR || resolve(root, 'rust-core/target'))
// Panic locations are part of the WASM data segment even with symbols stripped.
// Cargo uses src\\file.rs on Windows and src/file.rs on Linux. Give each source
// the same platform-independent label without changing numerical calculations.
const sourceFiles = (await readdir(resolve(root, 'rust-core/src'), { withFileTypes:true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.rs')).map(entry => entry.name).sort()
const remapFlags = sourceFiles.flatMap(name => [
  `--remap-path-prefix=src\\${name}=${name}`,
  `--remap-path-prefix=src/${name}=${name}`
])
// Preserve the caller's environment flags in Cargo's priority order. Encoded
// flags retain embedded spaces and empty arguments; ordinary RUSTFLAGS use
// Cargo's whitespace-separated argument convention. An explicit empty override
// remains an override rather than falling through to a lower-priority source.
const encoded = process.env.CARGO_ENCODED_RUSTFLAGS
const inheritedFlags = encoded !== undefined ? (encoded === '' ? [] : encoded.split('\x1f'))
  : (process.env.RUSTFLAGS ?? process.env.CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS
    ?? process.env.CARGO_BUILD_RUSTFLAGS ?? '').split(/\s+/).filter(Boolean)
const rustFlags = [...inheritedFlags, ...remapFlags].join('\x1f')
for (const domain of ['app', 'decor']) {
  const built = spawnSync(cargo, ['build', '--manifest-path', resolve(root, 'rust-core/Cargo.toml'),
    '--release', '--target', 'wasm32-unknown-unknown', '--locked', '--no-default-features', '--features', domain], {
    cwd:root, stdio:'inherit', env:{ ...process.env, CARGO_TARGET_DIR:target, CARGO_ENCODED_RUSTFLAGS:rustFlags }
  })
  if (built.error) throw new Error('Rust is required: install rustup and the toolchain in rust-toolchain.toml.', { cause:built.error })
  if (built.status !== 0) process.exit(built.status || 1)
  const bytes = await readFile(resolve(target, 'wasm32-unknown-unknown/release/inhouse_read_core.wasm'))
  const module = await WebAssembly.compile(bytes)
  if (WebAssembly.Module.imports(module).length) throw new Error('Rust core must not import host functions')
  const { exports } = await WebAssembly.instantiate(module)
  if (exports.core_abi_version?.() !== 1) throw new Error('Unexpected Rust core ABI')
  if (exports.core_domain?.() !== (domain === 'decor' ? 1 : 0)) throw new Error('Wrong Rust domain')
  const output = resolve(root, `src/wasm/inhouse_read_${domain === 'app' ? 'core' : 'decor'}.wasm`)
  await mkdir(dirname(output), { recursive:true })
  // Avoid touching an unchanged binary so Vite does not restart live sessions.
  const previous = await readFile(output).catch(() => null)
  if (!previous?.equals(bytes)) await writeFile(output, bytes)
  console.log(`Rust ${domain}: ${bytes.length} bytes; SHA256 ${createHash('sha256').update(bytes).digest('hex')}`)
}
