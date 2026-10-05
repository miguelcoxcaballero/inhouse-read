import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
const read=p=>fs.readFileSync(p),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const css=read('src/css/fonts.css').toString(),html=read('index.html').toString();
const manifest=JSON.parse(read('public/licenses/fonts/manifest.json'));
const families=['Comfortaa','Cormorant Garamond','DM Sans','Lora','Montserrat','Oswald','Playfair Display'];

describe('original typography hosted with the offline app',()=>{
  it('preserves every original face, weight, unicode range and display declaration byte exactly',()=>{
    let original=css;
    for(const font of manifest.fonts)original=original.replaceAll(font.cssPath,font.url);
    expect(Buffer.byteLength(original)).toBe(41041);
    expect(hash(Buffer.from(original))).toBe('d0217f68ee0dbb009c25d037d4cc4c1a4701f386911f526dca90bc1e62173e4c');
    expect((css.match(/@font-face\s*\{/g)||[]).length).toBe(93);
    expect(manifest.families).toEqual(families);
  });
  it('retains all 34 unmodified WOFF2 payloads and their original subsets',()=>{
    expect(manifest.fonts).toHaveLength(34);expect(new Set(manifest.fonts.map(f=>f.file)).size).toBe(34);
    let total=0;
    for(const font of manifest.fonts){
      expect(font.file).toMatch(/^[a-z0-9-]+\.woff2$/);expect(font.url).toMatch(/^https:\/\/fonts\.gstatic\.com\/s\//);
      const bytes=read('src/assets/fonts/'+font.file);total+=bytes.length;
      expect(bytes.subarray(0,4).toString()).toBe('wOF2');expect(bytes.readUInt32BE(8)).toBe(bytes.length);
      expect(bytes.readUInt16BE(12)).toBeGreaterThan(0);expect(bytes.length).toBe(font.bytes);expect(hash(bytes)).toBe(font.sha256);
      expect(css).toContain('url('+font.cssPath+')');expect(font.weights.length).toBeGreaterThan(0);
    }
    expect(total).toBe(759412);
  });
  it('preloads the exact Playfair Latin body used by the stylesheet',()=>{
    const hint=html.match(/<link\s+rel="preload"\s+as="font"[^>]*>/)?.[0];
    const font=manifest.fonts.find(f=>f.family==='Playfair Display'&&f.subset==='latin'&&f.weights.includes('700'));
    expect(font).toBeTruthy();expect(hint).toContain('crossorigin');expect(hint).toContain('type="font/woff2"');
    expect(hint).toContain('href="./src/assets/fonts/'+font.file+'"');expect(css).toContain('url('+font.cssPath+')');
  });
  it('removes the external font dependency and preserves the two existing wood preloads',()=>{
    expect(html).toContain('href="./src/css/fonts.css"');expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    expect(css).not.toMatch(/https?:\/\//);
    for(const name of ['walnut-pbr','walnut-surface'])expect(html).toContain('href="/src/assets/library/'+name+'.webp" crossorigin="anonymous"');
  });
  it('includes all seven official OFL licenses with the distribution',()=>{
    expect(manifest.licenseCommit).toBe('9710da1eacb3be272583c3224dcb70f9da6eadbb');
    for(const family of families){
      const text=read('public/licenses/fonts/'+family.toLowerCase().replaceAll(' ','')+'-OFL.txt').toString();
      expect(text).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);expect(text).toMatch(/Copyright/i);
    }
    expect(read('public/licenses/fonts/README.txt').toString()).toContain('copied without modification');
  });
});
