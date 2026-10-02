import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { baggeboLayout } from '../../src/js/shelf-model-layout.js';
import { projectShelfDropPosition } from '../../src/js/bookshelf-scene.js';
import { shelfBookSlot } from '../../src/js/bookshelf-return.js';

function layout(count = 3, width = 600) {
  return { width, sceneWidth:width, rows:Array.from({ length:count }, () => ({ top:0, bottom:200 })),
    entries:Array.from({ length:count }, (_, shelf) => ({ shelf, key:`book:${shelf}`, x:60,
      height:172, width:110, thickness:24, style:{ heightRatio:1 } })) };
}

describe('BAGGEBO physical shelf layout', () => {
  it('uses the three measured internal shelves and uniformly scales the entire furniture', () => {
    const full = baggeboLayout(layout());
    expect(full.height).toBe(1160); expect(full.depth).toBe(250);
    expect(full.rows.map(row => row.bottom)).toEqual([360, 682.5, 1005]);
    for (const entry of full.entries) expect(entry.y + entry.height / 2).toBe(full.rows[entry.shelf].bottom);
    const mobile = baggeboLayout(layout(3, 300));
    expect(mobile.height).toBe(580); expect(mobile.depth).toBe(125);
    expect(mobile.rows.map(row => row.bottom)).toEqual([180, 341.25, 502.5]);
  });

  it('retains every object in additional exact units instead of stretching the product', () => {
    const result = baggeboLayout(layout(7));
    expect(result.unitCount).toBe(3); expect(result.height).toBe(1160);
    expect(result.rows).toHaveLength(9); expect(result.entries).toHaveLength(7);
    expect(result.entries[3].x).toBe(684); expect(result.entries[6].x).toBe(1308);
    expect(result.entries[3].y).toBe(result.entries[0].y);
    expect(result.sceneWidth).toBe(600);
  });

  it('fits landscape covers and tall plants within the real shelf depth and clearance', () => {
    const input = layout(); input.entries[1].width = 360;
    input.entries.push({ kind:'plant', shelf:2, x:120, height:500, width:80 });
    const result = baggeboLayout(input);
    const book = result.entries[1]; expect(book.width).toBeCloseTo(220);
    expect(book.width / book.height).toBeCloseTo(360 / 172);
    const plant = result.entries.at(-1), row = result.rows[2];
    expect(plant.rooftop).toBe(true);
    expect(plant.height).toBe(500);
    expect(plant.y + plant.height / 2).toBe(0);
    const slot = shelfBookSlot(book, result.width);
    expect(slot.elements[14] + book.width / 2).toBe(-15);
    expect(slot.elements[14] - book.width / 2).toBe(-235);
  });

  it('projects drops onto the selected unit and stores a centre relative to its own usable width', () => {
    const result = baggeboLayout(layout(6));
    const second = result.rows[4];
    const ray = new THREE.Ray(new THREE.Vector3(second.left + 300 - result.width / 2, -600, 100), new THREE.Vector3(0, 0, -1));
    expect(projectShelfDropPosition(ray, new THREE.Matrix4(), result.rows, result.width)).toEqual({ shelf:4, x:.5 });
  });

  it('seats table lamps on the mesh and attaches circular lights to its underside in every unit', () => {
    const input = layout(6, 300);
    input.entries = [
      { kind:'lamp', lampId:'tarnaby', mount:'standing', shelf:0, x:80, width:75, height:125, depth:75 },
      { kind:'lamp', lampId:'mittled', mount:'undershelf', shelf:4, x:150, width:34, height:5.5, depth:34 }
    ];
    const result = baggeboLayout(input);
    const [table, puck] = result.entries;
    expect(table.y + table.height / 2).toBe(result.rows[0].bottom);
    expect(puck.y).toBe(result.rows[4].ceiling);
    expect(puck.y).toBe((360 + 3.75) * .5);
    expect(puck.x).toBe(462);
    expect(table.width / table.height).toBeCloseTo(150 / 250);
  });
});
