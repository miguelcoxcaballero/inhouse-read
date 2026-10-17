import {afterEach, expect, it, vi} from 'vitest';
import {prepareShelfFonts} from '../../src/js/shelf-startup-resources.js';

afterEach(() => vi.unstubAllGlobals());

it('loads only the native styles and interface fonts, grouping actual Unicode lettering by face', async () => {
  const load = vi.fn(async () => []);
  vi.stubGlobal('document', {fonts:{load}});
  await prepareShelfFonts([
    {font:'700 20px "Lora"', text:'Τίτλος'},
    {font:'700 20px "Lora"', text:'Автор'},
    {font:'600 20px "Oswald"', text:'Another book'}
  ]);
  expect(load).toHaveBeenCalledTimes(5);
  expect(load).toHaveBeenCalledWith('700 20px "Lora"', expect.stringContaining('Τίτλος'));
  expect(load).toHaveBeenCalledWith('700 20px "Lora"', expect.stringContaining('Автор'));
  expect(load).not.toHaveBeenCalledWith(expect.stringContaining('Montserrat'), expect.anything());
  expect(load).not.toHaveBeenCalledWith(expect.stringContaining('Cormorant'), expect.anything());
});

it('keeps the first-paint task pending for the actual face and settles failed requests', async () => {
  let release, complete = false;
  const pending = new Promise(resolve => { release = resolve; });
  vi.stubGlobal('document', {fonts:{load:font => {
    if (font.includes('Lora')) return pending;
    if (font.includes('Comfortaa')) throw new Error('Unavailable face');
    return Promise.resolve([]);
  }}});
  const task = prepareShelfFonts([{font:'700 20px "Lora"', text:'Letters'}]).then(() => { complete = true; });
  await Promise.resolve(); await Promise.resolve();
  expect(complete).toBe(false);
  release([]); await task;
  expect(complete).toBe(true);
});
