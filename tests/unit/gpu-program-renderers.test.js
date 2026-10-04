import { beforeEach, describe, expect, it, vi } from 'vitest';

let retainPrograms;
beforeEach(async () => { vi.resetModules(); ({ retainPrograms } = await import('../../src/js/gpu-programs.js')); });
const renderer = count => ({ info:{ programs:Array.from({ length:count }, () => ({ usedTimes:1 })) } });

describe('shader retention cap belongs to its renderer', () => {
  it('lets shelf and presentation contexts each retain their own first 160 programs', () => {
    const shelf = renderer(170), presentation = renderer(170);
    retainPrograms(shelf); retainPrograms(presentation);
    for (const context of [shelf, presentation]) {
      expect(context.info.programs.filter(program => program.usedTimes === 2)).toHaveLength(160);
      expect(context.info.programs.slice(160).map(program => program.usedTimes)).toEqual(Array(10).fill(1));
    }
  });

  it('counts repeated scans only once and lets each renderer finish its independent remaining budget', () => {
    const shelf = renderer(159), presentation = renderer(2);
    retainPrograms(shelf); retainPrograms(shelf); retainPrograms(presentation); retainPrograms(presentation);
    shelf.info.programs.push({ usedTimes:1 }, { usedTimes:1 });
    presentation.info.programs.push(...renderer(159).info.programs);
    retainPrograms(shelf); retainPrograms(presentation);
    expect(shelf.info.programs.filter(program => program.usedTimes === 2)).toHaveLength(160);
    expect(presentation.info.programs.filter(program => program.usedTimes === 2)).toHaveLength(160);
    retainPrograms(shelf); retainPrograms(presentation);
    expect(shelf.info.programs.some(program => program.usedTimes > 2)).toBe(false);
    expect(presentation.info.programs.some(program => program.usedTimes > 2)).toBe(false);
  });
});
