// Run by a plain Node child, never by the Playwright ESM transform loader.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { url as inspectorUrl } from 'node:inspector';

const root=resolve(process.cwd());
const fixtureRoot=process.env.IHR_COLD_FIXTURE_ROOT;
if (!fixtureRoot || !isAbsolute(fixtureRoot)) throw new Error('IHR_COLD_FIXTURE_ROOT must be the fresh absolute directory owned by this test.');
const outDir=join(fixtureRoot,'dist');
const signature="export async function analyzeCoverAppearance(url, title = '', { matchFont = true } = {}) {";
const lengthImport="import { createBookLengthQueue, isBookLengthReady } from './book-length-queue.js'";
let previewServer=null, stopping=false, startBuild;
const buildRequested=new Promise(resolve => { startBuild=resolve; });
const transforms={ analysis:0,readiness:0 };
const send=message => { if (process.connected) process.send(message); };
async function shutdown(code=0) {
  if (stopping) return;
  stopping=true;
  if (previewServer?.httpServer) {
    previewServer.httpServer.closeAllConnections?.();
    await new Promise(resolve => previewServer.httpServer.close(resolve));
  }
  send({ type:'stopped',code });
  process.exit(code);
}
process.on('message',message => {
  if (message?.type==='shutdown') void shutdown();
  if (message?.type==='build') startBuild();
});
process.on('disconnect',() => void shutdown());
process.on('SIGTERM',() => void shutdown());
process.on('SIGINT',() => void shutdown());

try {
  await mkdir(outDir,{ recursive:true });
  const sources={};
  for (const path of ['vite.config.js','src/js/app.js','src/js/bookshelf.js','src/js/bookshelf-scene.js',
    'src/js/cover-appearance.js','src/js/book-length-queue.js','src/wasm/inhouse_read_core.wasm']) {
    const bytes=await readFile(join(root,path));
    sources[path]={ bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex') };
  }
  await writeFile(join(fixtureRoot,'source-fingerprints.json'),JSON.stringify(sources,null,2));
  send({ type:'building',pid:process.pid,fixtureRoot,outDir,inspectorUrl:inspectorUrl(),sources });
  await buildRequested; // parent attached the external profiler before any Vite work
  if (stopping) process.exit(0);
  const { build, preview }=await import('vite');
  await build({ root,base:'/inhouse-read/',
    build:{ outDir,emptyOutDir:false },
    plugins:[{ name:'cold-return-analysis-gate',enforce:'pre',transform(code,id) {
      const path=id.replaceAll('\\','/').split('?')[0];
      if (path.endsWith('/src/js/cover-appearance.js')) {
        if (code.split(signature).length!==2) throw new Error('The actual cover-analysis entry changed; update the causal probe explicitly.');
        transforms.analysis++;
        return { code:code.replace(signature,signature+'\n  if (!matchFont && globalThis.__coldReturnProbe?.armed) await globalThis.__coldReturnProbe.holdAnalysis(url);'),map:null };
      }
      if (path.endsWith('/src/js/app.js')) {
        if (code.split(lengthImport).length!==2) throw new Error('The actual imported length predicate changed; update the causal probe explicitly.');
        transforms.readiness++;
        return { code:code.replace(lengthImport,lengthImport+'\nObject.defineProperty(globalThis, "__coldReturnIsBookLengthReady", { value:isBookLengthReady });'),map:null };
      }
      return null;
    } }] });
  if (transforms.analysis!==1 || transforms.readiness!==1) throw new Error(`Fixture transforms did not cover the actual production entrypoints exactly once: ${JSON.stringify(transforms)}`);
  previewServer=await preview({ root,base:'/inhouse-read/',build:{ outDir },preview:{ host:'127.0.0.1',port:0,strictPort:true } });
  const address=previewServer.httpServer.address();
  if (!address || typeof address==='string') throw new Error('The static fixture preview did not expose a TCP port.');
  const appUrl=`http://127.0.0.1:${address.port}/inhouse-read/`;
  const metadata={ fixtureRoot,outDir,appUrl,transforms,sources,pid:process.pid,inspectorUrl:inspectorUrl(),
    scope:'Actual Vite production build and plugins, with only an analysis-entry barrier and exposure of the exact imported production readiness predicate. No application quality or reading behavior substituted.' };
  await writeFile(join(fixtureRoot,'fixture.json'),JSON.stringify(metadata,null,2));
  send({ type:'ready',...metadata });
} catch (error) {
  console.error(error);
  send({ type:'failed',error:error.stack || String(error),fixtureRoot });
  await shutdown(1);
}
