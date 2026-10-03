// The fixture mirror contains the exact shared pack that the application installs.
// Missing/corrupt weights fail preparation; no synthetic audio or moving revision.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { SUPERTONIC_ASSETS, SUPERTONIC_BASE, SUPERTONIC_REVISION } from '../src/js/readers/neural-voice/supertonic-catalog.js';

export async function verifyAsset(file, asset) {
  const { size } = await stat(file);
  if (size !== asset.bytes) throw new Error(`${asset.path}: ${size} bytes, expected ${asset.bytes}`);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  const sha256 = hash.digest('hex');
  if (sha256 !== asset.sha256) throw new Error(`${asset.path}: SHA-256 mismatch`);
  if (asset.path.endsWith('.json')) JSON.parse(await readFile(file, 'utf8'));
  return { bytes:size, sha256 };
}

export async function prepareSupertonicFixtures({ output, checkOnly=false, fetchFn=fetch, assets=SUPERTONIC_ASSETS, base=SUPERTONIC_BASE }={}) {
  output = resolve(output || process.env.SUPERTONIC_FIXTURES || '.supertonic-fixtures.local');
  if (!base.includes(`/resolve/${SUPERTONIC_REVISION}/`) || !base.startsWith('https://')) throw new Error('Supertonic fixture source must use the pinned HTTPS revision');
  const verified = {};
  await mkdir(output, { recursive:true });
  for (const asset of assets) {
    if (!/^(?:onnx|voice_styles)\/[a-zA-Z0-9_]+\.(?:onnx|json)$|^LICENSE$/.test(asset.path) || !(asset.bytes > 0) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid fixture descriptor');
    const file = join(output, asset.path), url = asset.url || base + asset.path;
    const source = new URL(url);
    if (source.protocol !== 'https:' || (source.hostname === 'huggingface.co' && !/\/resolve\/[a-f0-9]{40}\//.test(source.pathname))) throw new Error(`Asset source must use a pinned HTTPS revision: ${asset.path}`);
    try {
      verified[asset.path] = { url, ...await verifyAsset(file, asset) };
      console.log(`Verified ${asset.path} (${asset.bytes} bytes)`);
      continue;
    } catch (error) { if (checkOnly) throw error; }
    await mkdir(dirname(file), { recursive:true });
    const part = `${file}.part`;
    for (let attempt=1;attempt<=3;attempt++) {
      try {
        const response = await fetchFn(url, { headers:{ 'accept-encoding':'identity' },signal:AbortSignal.timeout(240_000) });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${asset.path}`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
        verified[asset.path] = { url,...await verifyAsset(part, asset) };
        await rename(part, file);
        console.log(`Downloaded ${asset.path} (${asset.bytes} bytes)`);
        break;
      } catch (error) {
        await rm(part, { force:true });
        if (attempt===3) throw new Error(`Cannot prepare ${asset.path}: ${error.message}`, { cause:error });
        console.log(`Retry ${attempt}/3 ${asset.path}: ${error.message}`);
      }
    }
  }
  const manifest = { revision:SUPERTONIC_REVISION, base, totalBytes:Object.values(verified).reduce((sum,a)=>sum+a.bytes,0),assets:verified };
  await writeFile(join(output, 'fixtures-manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
  return manifest;
}

async function main(args) {
  let output,checkOnly=false;
  for (let i=0;i<args.length;i++) {
    if (args[i]==='--check') checkOnly=true;
    else if (args[i]==='--output') { output=args[++i];if (!output || output.startsWith('--')) throw new Error('--output needs a directory'); }
    else if (args[i]==='--help') { console.log('node scripts/prepare-supertonic-fixtures.mjs [--output directory] [--check]');return; }
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const manifest=await prepareSupertonicFixtures({ output,checkOnly });
  console.log(JSON.stringify({ revision:manifest.revision,assets:Object.keys(manifest.assets).length,bytes:manifest.totalBytes }));
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
