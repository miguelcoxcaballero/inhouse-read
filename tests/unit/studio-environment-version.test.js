import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { studioEnvironmentHash, studioEnvironmentVersion, STUDIO_INPUTS, THREE_INPUTS } from '../../scripts/studio-environment-version.mjs';

let root;
function write(name, content) {
  const path = join(root, name); mkdirSync(dirname(path), { recursive:true }); writeFileSync(path, content);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'inhouse-studio-version-'));
  for (const input of [...STUDIO_INPUTS, ...THREE_INPUTS]) write(input, `// ${input}\n`);
  write('src/js/book-model.js', "import { light } from './light.js'\nexport const renderer = light\n");
  write('src/js/light.js', 'export const light = 1\n');
});
afterEach(() => {
  const target = resolve(root), parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.includes('inhouse-studio-version-')) throw new Error('Unsafe fixture cleanup');
  rmSync(target, { recursive:true, force:true });
});

describe('automatic studio environment build revision', () => {
  it('is deterministic and accepts the real installed Three and renderer graph', () => {
    expect(studioEnvironmentHash(root)).toMatch(/^[a-f0-9]{20}$/);
    expect(studioEnvironmentHash(root)).toBe(studioEnvironmentHash(root));
    expect(studioEnvironmentHash(resolve('.'))).toMatch(/^[a-f0-9]{20}$/);
  });
  it('keeps the revision when unrelated entry, PDF or version metadata changes', () => {
    const before = studioEnvironmentHash(root);
    write('src/js/app.js', "export const version = 'different-app-entry'\n");
    write('src/js/readers/pdf-reader.js', 'export class PdfReader {}\n');
    write('package.json', '{"version":"9.9.9"}\n');
    expect(studioEnvironmentHash(root)).toBe(before);
  });
  it.each(['src/js/book-model.js', 'src/js/studio-environment-cache.js', 'src/js/light.js'])('invalidates changes to %s', input => {
    const before = studioEnvironmentHash(root);
    write(input, readFileSync(join(root,input),'utf8') + '// changed generator or contract\n');
    expect(studioEnvironmentHash(root)).not.toBe(before);
  });
  it.each(THREE_INPUTS)('invalidates changes to actual engine input %s', input => {
    const before = studioEnvironmentHash(root);
    write(input, readFileSync(join(root,input),'utf8') + '// changed engine\n');
    expect(studioEnvironmentHash(root)).not.toBe(before);
  });
  it('treats platform line endings as the same generating code', () => {
    const before = studioEnvironmentHash(root);
    for (const input of [...STUDIO_INPUTS, ...THREE_INPUTS, 'src/js/light.js']) {
      write(input, readFileSync(join(root,input),'utf8').replaceAll('\n','\r\n'));
    }
    expect(studioEnvironmentHash(root)).toBe(before);
  });
  it('defines the generated revision only for a production build', () => {
    const plugin = studioEnvironmentVersion(root);
    expect(plugin.config({}, { command:'serve' }).define.__STUDIO_ENVIRONMENT_VERSION__).toBe('null');
    expect(plugin.config({}, { command:'build' }).define.__STUDIO_ENVIRONMENT_VERSION__).toBe(JSON.stringify(studioEnvironmentHash(root)));
  });
});
