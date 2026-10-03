// Real shared Supertonic 3 weights, production worker/ORT WASM and Web Audio.
// One pack/session is reused across all 22 app languages and ten profiles.
// This measures the current Chromium machine; it makes no phone speed claim.
import { test,expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream,existsSync,mkdirSync,readFileSync,statSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { extname,join,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { SUPERTONIC_ASSETS,SUPERTONIC_BYTES,SUPERTONIC_REVISION,SUPERTONIC_STYLES } from '../../src/js/readers/neural-voice/supertonic-catalog.js';
import { verifyAsset } from '../../scripts/prepare-supertonic-fixtures.mjs';

const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const FIXTURES=resolve(process.env.SUPERTONIC_FIXTURES||'.supertonic-fixtures.local');
const EVIDENCE=resolve(process.env.SUPERTONIC_EVIDENCE||join(tmpdir(),'supertonic-voice-evidence'));
const SENTENCES={
  en:'The rain tapped softly against the library windows.',
  es:'La lluvia caía sobre las ventanas de la biblioteca.',
  fr:'La pluie tombait doucement sur les fenêtres de la bibliothèque.',
  de:'Der Regen klopfte leise an die Fenster der Bibliothek.',
  it:'La pioggia cadeva sulle finestre della biblioteca.',
  pt:'A chuva batia suavemente nas janelas da biblioteca antiga.',
  nl:'De regen tikte zachtjes tegen de ramen van de bibliotheek.',
  pl:'Deszcz cicho stukał w okna starej biblioteki.',
  ru:'Дождь тихо стучал в окна старой библиотеки.',
  uk:'Дощ тихо стукав у вікна старої бібліотеки.',
  tr:'Yağmur eski kütüphanenin pencerelerine usulca vuruyordu.',
  sv:'Regnet knackade försiktigt på fönstren i det gamla biblioteket.',
  da:'Regnen bankede sagte på vinduerne i det gamle bibliotek.',
  fi:'Sade ropisi hiljaa vanhan kirjaston ikkunoihin.',
  cs:'Déšť tiše klepal na okna staré knihovny.',
  el:'Η βροχή χτυπούσε απαλά τα παράθυρα της παλιάς βιβλιοθήκης.',
  hu:'Az eső halkan kopogott a régi könyvtár ablakán.',
  ro:'Ploaia bătea încet în ferestrele vechii biblioteci.',
  ar:'كانت الأمطار تطرق نوافذ المكتبة القديمة بهدوء.',
  vi:'Mưa nhẹ nhàng gõ vào cửa sổ của thư viện cũ.',
  bg:'Дъждът тихо почукваше по прозорците на старата библиотека.',
  hi:'बारिश पुरानी पुस्तकालय की खिड़कियों पर धीरे धीरे गिर रही थी।'
};
const IDS=Object.keys(SENTENCES).flatMap(lang=>SUPERTONIC_STYLES.map(style=>`supertonic3:${style}:${lang}`));
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};

function sendFile(request,response,file) {
  response.writeHead(200,{'content-type':MIME[extname(file)]||'application/octet-stream','content-length':statSync(file).size,'cache-control':'no-store'});
  const stream=createReadStream(file);request.on('close',()=>stream.destroy());stream.pipe(response);
}
function startServer(dist,hits) {
  const files=new Map(SUPERTONIC_ASSETS.map(a=>[`/supertonic/${a.path}`,join(FIXTURES,a.path)]));
  const server=createServer((request,response)=>{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(request.method!=='GET'){response.writeHead(405);response.end('GET only');return;}
    if(files.has(pathname)){hits.push(pathname.slice('/supertonic/'.length));return sendFile(request,response,files.get(pathname));}
    if(pathname.startsWith('/inhouse-read/')) {
      const file=resolve(dist,pathname.slice('/inhouse-read/'.length));
      if(file.startsWith(dist+sep)&&existsSync(file)&&statSync(file).isFile())return sendFile(request,response,file);
    }
    response.writeHead(404);response.end('not found');
  });
  return new Promise(resolveServer=>server.listen(0,'127.0.0.1',()=>resolveServer({server,port:server.address().port})));
}
function stats(pcm,sampleRate) {
  let peak=0,sum=0,finite=true;
  for(const x of pcm){finite&&=Number.isFinite(x);peak=Math.max(peak,Math.abs(x));sum+=x*x;}
  return {samples:pcm.length,seconds:pcm.length/sampleRate,finite,peak,rms:Math.sqrt(sum/pcm.length)};
}
function wavOf(pcm,sampleRate) {
  const b=Buffer.alloc(44+pcm.length*2);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);
  pcm.forEach((x,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),44+i*2));return b;
}

test.describe.configure({mode:'serial'});
test.describe('Supertonic 3: 22 app languages × ten real offline profiles',()=>{
  test.setTimeout(180_000);
  let page,context,server,port,dist,installedHits;
  const hits=[],outside=[],pageErrors=[],numbers={revision:SUPERTONIC_REVISION,packBytes:SUPERTONIC_BYTES,assetSources:SUPERTONIC_ASSETS,scope:'Chromium WASM on this machine; fully offline playback after the installed worker is warmed',cases:{}};
  test.beforeAll(async({browser})=>{
    // Required for every run, including local: missing weights can never skip this matrix.
    for(const asset of SUPERTONIC_ASSETS)await verifyAsset(join(FIXTURES,asset.path),asset);
    const manifest=JSON.parse(readFileSync(join(FIXTURES,'fixtures-manifest.json'),'utf8'));
    expect(manifest.revision).toBe(SUPERTONIC_REVISION);expect(manifest.totalBytes).toBe(SUPERTONIC_BYTES);
    mkdirSync(EVIDENCE,{recursive:true});dist=join(tmpdir(),`supertonic-harness-${process.pid}`);
    await build({root:ROOT,configFile:join(ROOT,'vite.config.js'),logLevel:'warn',build:{outDir:dist,emptyOutDir:true,sourcemap:false,rollupOptions:{input:join(ROOT,'tests/e2e/fixtures/supertonic-voice-harness.html')}}});
    ({server,port}=await startServer(dist,hits));context=await browser.newContext();page=await context.newPage();
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(['http:','https:'].includes(url.protocol)&&url.origin!==`http://127.0.0.1:${port}`){outside.push(url.href);return route.abort('blockedbyclient');}
      return route.continue();
    });
    await page.addInitScript(base=>{window.INHOUSE_SUPERTONIC_BASE=base;},`http://127.0.0.1:${port}/supertonic/`);
    page.on('pageerror',error=>pageErrors.push(error.message));
    const url=`http://127.0.0.1:${port}/inhouse-read/tests/e2e/fixtures/supertonic-voice-harness.html`;
    await page.goto(url);await page.waitForFunction(()=>window.supertonic);
    const catalogue=await page.evaluate(()=>window.supertonic.voices.filter(v=>v.id.startsWith('supertonic3:')).map(v=>v.id));
    expect(catalogue.sort()).toEqual([...IDS].sort());
    await page.evaluate(()=>{
      window.__supertonicProgress=[];
      window.supertonic.engine.addEventListener('change',()=>{const d=window.supertonic.engine.downloads.get('supertonic3:F1:en');if(d)window.__supertonicProgress.push({...d});});
    });
    const started=Date.now();await page.evaluate(()=>window.supertonic.engine.install('supertonic3:F1:en'));
    const progress=await page.evaluate(()=>window.__supertonicProgress);
    const fractions=progress.filter(d=>d.state==='downloading').map(d=>d.fraction);
    expect(fractions.length).toBeGreaterThan(2);expect(fractions).toEqual([...fractions].sort((a,b)=>a-b));
    expect(progress.some(d=>d.total===SUPERTONIC_BYTES)).toBe(true);
    expect([...hits].sort()).toEqual(SUPERTONIC_ASSETS.map(a=>a.path).sort());
    installedHits=hits.length;
    await page.reload();await page.waitForFunction(()=>window.supertonic);await page.evaluate(()=>window.supertonic.engine.refresh());
    expect((await page.evaluate(()=>[...window.supertonic.engine.installed])).sort()).toEqual([...IDS].sort());
    expect(hits).toHaveLength(installedHits);
    await page.click('#unlock');
    const warm=await page.evaluate(()=>window.supertonic.read('supertonic3:F1:en','A quiet voice began the next chapter.'));
    expect(warm.log.map(e=>e.type)).toEqual(['start','done']);expect(warm.workers).toBe(1);
    expect(warm.requests.filter(r=>r.type==='load')).toHaveLength(1);
    await context.setOffline(true);
    numbers.install={ms:Date.now()-started,assets:[...hits],progressSamples:progress.length,sharedVoices:IDS.length,warmWorkers:warm.workers};
  });
  test.afterAll(async()=>{
    numbers.modelRequests=[...hits];numbers.externalRequests=[...outside];numbers.pageErrors=[...pageErrors];
    mkdirSync(EVIDENCE,{recursive:true});writeFileSync(join(EVIDENCE,'numbers-supertonic.json'),JSON.stringify(numbers,null,2)+'\n');
    await context?.close();server?.close();
  });
  for(const [lang,text] of Object.entries(SENTENCES))for(const style of SUPERTONIC_STYLES){
    const voiceId=`supertonic3:${style}:${lang}`;
    test(`${lang} ${style}: real PCM and audible start from the shared offline pack`,async({},testInfo)=>{
      const rate=style==='M1'?1.25:1;
      const result=await page.evaluate(({voiceId,text,rate})=>window.supertonic.read(voiceId,text,rate),{voiceId,text,rate});
      expect(result.log.map(e=>e.type),JSON.stringify(result.log)).toEqual(['start','done']);
      expect(result.audioState).toBe('running');expect(result.deviceCalls).toBe(0);expect(result.workers).toBe(1);
      expect(result.requests.filter(r=>r.type==='load')).toHaveLength(0);
      expect(result.requests.filter(r=>r.type==='synth').map(({lang,style,text,rate})=>({lang,style,text,rate}))).toEqual([{lang,style,text,rate}]);
      expect(result.messages.some(m=>m.type==='error'),JSON.stringify(result.messages)).toBe(false);
      expect(result.starts.length).toBeGreaterThan(0);
      const sampleRate=result.starts[0].sampleRate,pcm=Float32Array.from(result.starts.flatMap(s=>s.data)),audio=stats(pcm,sampleRate);
      expect(audio.finite).toBe(true);expect(audio.seconds).toBeGreaterThan(0.5);expect(audio.seconds).toBeLessThan(40);
      expect(sampleRate).toBeGreaterThanOrEqual(16000);expect(audio.peak).toBeGreaterThan(0.3);expect(audio.peak).toBeLessThanOrEqual(0.9001);expect(audio.rms).toBeGreaterThan(0.001);
      const first=result.log[0];expect(first.ctxTime-first.latency-result.starts[0].when).toBeGreaterThanOrEqual(-0.01);
      expect(hits).toHaveLength(installedHits);expect(outside).toEqual([]);expect(pageErrors).toEqual([]);
      const wav=wavOf(pcm,sampleRate),sha256=createHash('sha256').update(wav).digest('hex');
      const file=join(EVIDENCE,`${lang}-${style}.wav`);writeFileSync(file,wav);
      const metrics={voiceId,lang,style,rate,sampleRate,...audio,sha256,firstAudioAt:first.at,firstAudioClock:first.ctxTime,rtf:result.stats.rtf,workers:result.workers,modelRequestsAfterInstall:hits.length-installedHits};
      numbers.cases[voiceId]=metrics;
      if(style===SUPERTONIC_STYLES.at(-1))expect(new Set(SUPERTONIC_STYLES.map(s=>numbers.cases[`supertonic3:${s}:${lang}`].sha256)).size).toBe(SUPERTONIC_STYLES.length);
      await testInfo.attach('supertonic-real-audio',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
      await testInfo.attach('supertonic-wav',{path:file,contentType:'audio/wav'});
    });
  }
});
