import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { bindingGeometry, boardGeometry, bookmarkGeometry, pageBlockGeometry, leafStackGeometry, ribbonSilk, sampleBookMotion, fitCoverImage, createBookModel, projectBookPageBounds, planBookPageZoom, planReadingBookPose } from '../../src/js/book-model.js';
import { spineLayout, spineSurface, releaseSurface } from '../../src/js/spine-surface.js';

describe('whole reading spread framing',() => {
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]) {
    it(`keeps both boards inside ${viewport.width}×${viewport.height} while matching the same centred spread`,() => {
      const width=290,height=440,centerX=viewport.width*.26,centerY=viewport.height*.42;
      const pose=planReadingBookPose({width,height,thickness:48,viewportWidth:viewport.width,
        viewportHeight:viewport.height,centerX,centerY});
      const left=centerX+pose.x-width*1.5*pose.scale,right=centerX+pose.x+width*.5*pose.scale;
      expect(left).toBeGreaterThanOrEqual(0);expect(right).toBeLessThanOrEqual(viewport.width);
      expect((left+right)/2).toBeCloseTo(viewport.width/2);
      expect(centerY+pose.y-height*.5*pose.scale).toBeGreaterThanOrEqual(0);
      expect(centerY+pose.y+height*.5*pose.scale).toBeLessThanOrEqual(viewport.height);
      expect(pose).toMatchObject({coverOpen:1,bookmarkWithdraw:0,angle:0,pitch:0,roll:0});
    });
  }
});

describe('purpose-built rounded binding mesh', () => {
  it('joins both cover boards and protrudes beyond the left edge head-on', () => {
    const g = bindingGeometry(200, 300, 52);
    const p = g.getAttribute('position');
    expect(p.count).toBe(194);
    expect(p.getX(0)).toBe(-100);
    expect(p.getZ(0)).toBe(-26);
    expect(p.getX(192)).toBeCloseTo(-100);
    expect(p.getZ(192)).toBe(26);
    expect(p.getX(96)).toBeCloseTo(-119.76);
    expect(p.getY(96)).toBe(-150);
    expect(p.getY(97)).toBe(150);
    g.dispose();
  });
  it('every cross-section vertex lies on the ellipse, with continuous outward unit normals', () => {
    const g = bindingGeometry(200, 300, 52);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i += 2) {
      expect(((p.getX(i) + 100) / 19.76) ** 2 + (p.getZ(i) / 26) ** 2).toBeCloseTo(1, 5);
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      expect(n.getX(i)).toBeLessThanOrEqual(0);
      if (i) expect(n.getX(i) * n.getX(i - 2) + n.getZ(i) * n.getZ(i - 2)).toBeGreaterThan(.998);
    }
    g.dispose();
  });
  it('wraps one texture continuously over shared vertices instead of detached text planes', () => {
    const g = bindingGeometry(200, 300, 52), uv = g.getAttribute('uv');
    expect(g.index.count).toBe(96 * 6);
    for (let i = 0; i < uv.count; i += 2) {
      expect(uv.getX(i)).toBeCloseTo(i / 192);
      expect(uv.getY(i)).toBe(0);
      expect(uv.getY(i + 1)).toBe(1);
    }
    g.dispose();
  });
});

describe('3D reading ribbon', () => {
  it('reaches from the current page depth through the head edge', () => {
    const geometry = bookmarkGeometry(200, 300, 48, .7, 16)
    const positions = geometry.getAttribute('position')
    const ys = Array.from({ length:positions.count }, (_, i) => positions.getY(i))
    const zs = Array.from({ length:positions.count }, (_, i) => positions.getZ(i))
    expect(Math.max(...ys)).toBeGreaterThan(150)
    expect(Math.min(...ys)).toBeLessThan(150)
    expect((positions.getZ(0) + positions.getZ(2)) / 2).toBeCloseTo(-9.6, 1)
    expect(geometry.index.count).toBeGreaterThan(0)
    geometry.dispose()
  })
  it('has fabric thickness and a broad upward tip visible from the spine', () => {
    const geometry = bookmarkGeometry(132, 200, 40, .8, 17);
    const positions = geometry.getAttribute('position');
    const tip = positions.count - 4;
    expect(positions.getY(tip) - 100).toBeGreaterThan(25);
    expect(Math.abs(positions.getZ(tip + 1) - positions.getZ(tip))).toBeGreaterThan(10);
    expect(positions.getZ(0) - positions.getZ(2)).toBeCloseTo(.36);
    expect(geometry.index.count).toBeGreaterThan(500);
    geometry.dispose();
  });
  it('keeps the same physical silhouette when the lifted book is enlarged', () => {
    const shelf = bookmarkGeometry(132, 200, 40, .8, 17);
    const lifted = bookmarkGeometry(264, 400, 80, .8, 17);
    const a = shelf.getAttribute('position'), b = lifted.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      expect(b.getX(i)).toBeCloseTo(a.getX(i) * 2, 4);
      expect(b.getY(i)).toBeCloseTo(a.getY(i) * 2, 4);
      expect(b.getZ(i)).toBeCloseTo(a.getZ(i) * 2, 4);
    }
    shelf.dispose(); lifted.dispose();
  });
  // Centre of every cross-section (four vertices each), tail to tip.
  const sections = geometry => {
    const p = geometry.getAttribute('position'), out = [];
    for (let i = 0; i < p.count; i += 4) {
      const c = new THREE.Vector3();
      for (let k = 0; k < 4; k++) c.add(new THREE.Vector3().fromBufferAttribute(p, i + k));
      out.push(c.multiplyScalar(.25));
    }
    return out;
  };
  const ribbonWidth = (width, height, thickness) => Math.min(width * .09, Math.max(height * .035, Math.min(height * .055, thickness * .42)));
  it('lies above the exposed reading page, folds over the head and never stands past it', () => {
    const open = bookmarkGeometry(132, 200, 40, .8, 17, { open:1 }), a = open.getAttribute('position');
    for (let i = 0; i < a.count / 2; i++) expect(a.getZ(i)).toBeGreaterThan(20 - 200 * .0083);
    const ys = Array.from({ length:a.count }, (_, i) => a.getY(i));
    // It runs the full leaf, then goes over the head instead of up into the air.
    expect(Math.min(...ys)).toBeLessThan(-100 + 200 * .05);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100 + 200 * .04);
    // Past the fold the end runs back along the head, behind the page.
    const tip = sections(open).at(-1);
    expect(tip.z).toBeLessThan(20 - 200 * .03);
    open.dispose();
  });
  it('is one continuous strip on the page, over the head and while closing', () => {
    for (const seed of [0, 4242, 91813]) for (const open of [.6, .8, 1]) {
      const geometry = bookmarkGeometry(264, 400, 80, .45, 16, { open, seed }), c = sections(geometry);
      // Adjacent cross-sections never jump sideways: no pasted-on tip piece.
      for (let i = 1; i < c.length; i++) expect(Math.abs(c[i].x - c[i - 1].x)).toBeLessThanOrEqual(ribbonWidth(264, 400, 80) * .1);
      geometry.dispose();
    }
  });
  it('withdraws along its own path, up the page and over the head, without scaling', () => {
    let previous = -Infinity;
    for (const withdraw of [0, .15, .3, .5, .75, 1]) {
      const geometry = bookmarkGeometry(132, 200, 40, .8, 17, { open:1, withdraw, seed:4242 }), p = geometry.getAttribute('position');
      const ys = Array.from({ length:p.count }, (_, i) => p.getY(i)), low = Math.min(...ys);
      expect(Math.max(...ys)).toBeLessThanOrEqual(100 + 200 * .04);
      expect(low).toBeGreaterThan(previous); previous = low;
      // The width never changes while it slides.
      const q = new THREE.Vector3(), r = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 4) expect(q.fromBufferAttribute(p, i).distanceTo(r.fromBufferAttribute(p, i + 1))).toBeCloseTo(ribbonWidth(132, 200, 40), 4);
      // Wherever it is over the page, no segment of the sliding strip cuts under the paper.
      const c = sections(geometry);
      for (let i = 1; i < c.length; i++) {
        const mid = c[i].clone().add(c[i - 1]).multiplyScalar(.5);
        if (mid.y < 100 - 200 * .009) expect(mid.z).toBeGreaterThan(20 - 200 * .0083);
      }
      geometry.dispose();
    }
    // Fully withdrawn, nothing is left lying on the page.
    expect(previous).toBeGreaterThan(100 - 200 * .03);
  });
  it('keeps an unread ribbon between the leaves instead of over the front board', () => {
    for (const progress of [0, .001, 1]) {
      const geometry = bookmarkGeometry(132, 200, 40, progress, 10), p = geometry.getAttribute('position');
      // Everything below the head lies inside the text block, behind both boards.
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 100) {
        expect(p.getZ(i)).toBeLessThan(20 - 200 * .007);
        expect(p.getZ(i)).toBeGreaterThan(-20 + 200 * .007);
      }
      geometry.dispose();
    }
  });
  it('gives each book its own fall, identical for its shelf and lifted copies', () => {
    const shelf = bookmarkGeometry(132, 200, 40, .6, 14, { seed:12345 }).getAttribute('position');
    const lifted = bookmarkGeometry(264, 400, 80, .6, 14, { seed:12345 }).getAttribute('position');
    const other = bookmarkGeometry(132, 200, 40, .6, 14, { seed:67890 }).getAttribute('position');
    const tip = shelf.count - 4;
    for (let i = 0; i < shelf.count; i++) expect(lifted.getX(i)).toBeCloseTo(shelf.getX(i) * 2, 4);
    expect(Math.abs(other.getX(tip) - shelf.getX(tip)) + Math.abs(other.getZ(tip) - shelf.getZ(tip))).toBeGreaterThan(.5);
    // Whatever the fall, the cut end still stands clear of the head.
    for (const p of [shelf, other]) expect(p.getY(p.count - 4) - 100).toBeGreaterThan(20);
  });
  it('draws a silk per book that stands clear of its cloth, and old gold once finished', () => {
    const silks = new Set();
    const rgb = hex => [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
    const apart = (a, b) => {
      const x = rgb(new THREE.Color(a).getHex()), y = rgb(new THREE.Color(b).getHex()), d = x.map((v, i) => (v - y[i]) / 255);
      return Math.sqrt(2 * d[0] ** 2 + 4 * d[1] ** 2 + 3 * d[2] ** 2);
    };
    for (const cloth of ['#7a1f2b', '#2c5f3f', '#1f2f52', '#e3d7bd', '#5d6f35', '#5a2a50', '#8a2233', '#111111']) {
      for (let seed = 1; seed < 60; seed++) {
        const silk = ribbonSilk(seed * 7919, cloth);
        expect(ribbonSilk(seed * 7919, cloth)).toBe(silk);
        // Never a ribbon that disappears against its own cloth.
        expect(apart(silk, cloth)).toBeGreaterThan(.45);
        silks.add(silk);
      }
    }
    expect(silks.size).toBeGreaterThan(3);
    expect(ribbonSilk(5, '#7a1f2b', true)).toBe('#c29a4c');
  });
  it('measures ribbon uv from the cut tip so the swallowtail keeps its shape', () => {
    const geometry = bookmarkGeometry(132, 200, 40, .5, 17), uv = geometry.getAttribute('uv');
    expect(uv.getY(uv.count - 1)).toBe(0);
    for (let i = 4; i < uv.count; i += 4) expect(uv.getY(i)).toBeLessThan(uv.getY(i - 4));
    geometry.dispose();
  });
})

describe('rounded-and-backed text block', () => {
  it('winds every face outward and stays inside the case with a concave fore-edge', () => {
    for (const detail of [false, true]) {
      const g = pageBlockGeometry(132, 200, 40, { detail }), p = g.getAttribute('position'), n = g.getAttribute('normal');
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), index = g.index.array;
      for (let i = 0; i < index.length; i += 3) {
        a.fromBufferAttribute(p, index[i]); b.fromBufferAttribute(p, index[i + 1]); c.fromBufferAttribute(p, index[i + 2]);
        const face = b.sub(a).cross(c.sub(a));
        if (face.length() < 1e-9) continue;
        expect(face.normalize().dot(new THREE.Vector3().fromBufferAttribute(n, index[i]))).toBeGreaterThan(.5);
      }
      g.computeBoundingBox();
      expect(g.boundingBox.min.x).toBeGreaterThan(-66 - 40 * .38);
      expect(g.boundingBox.max.x).toBeLessThan(66);
      expect(g.boundingBox.max.y).toBeLessThan(100); expect(g.boundingBox.max.z).toBeLessThan(20 - 200 * .007);
      expect(g.groups).toEqual([{ start:0, count:index.length, materialIndex:0 }]);
      g.dispose();
    }
  });
});

describe('leaves turned over with the front board', () => {
  it('winds every face outward, sits on the board and curls into the gutter', () => {
    const board = 200 * .007, g = leafStackGeometry(132, 200, 8, { board }), p = g.getAttribute('position'), n = g.getAttribute('normal');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), index = g.index.array;
    for (let i = 0; i < index.length; i += 3) {
      a.fromBufferAttribute(p, index[i]); b.fromBufferAttribute(p, index[i + 1]); c.fromBufferAttribute(p, index[i + 2]);
      const face = b.sub(a).cross(c.sub(a));
      if (face.length() < 1e-9) continue;
      expect(face.normalize().dot(new THREE.Vector3().fromBufferAttribute(n, index[i]))).toBeGreaterThan(.5);
    }
    g.computeBoundingBox();
    // Never inside the board, never past the text block it came from.
    expect(g.boundingBox.max.z).toBeLessThan(-board / 2);
    expect(g.boundingBox.min.z).toBeCloseTo(-board / 2 - 200 * .0003 - 8, 4);
    expect(g.boundingBox.min.x).toBeGreaterThanOrEqual(0); expect(g.boundingBox.max.x).toBeLessThan(132);
    expect(g.boundingBox.max.y).toBeLessThan(100 - 200 * .009);
    // The open face dips toward the joint: shallow at the gutter, full depth beyond it.
    const face = Array.from({ length:p.count }, (_, i) => i).filter(i => n.getZ(i) < -.5);
    const atGutter = face.filter(i => p.getX(i) === 0).map(i => p.getZ(i));
    expect(Math.min(...atGutter)).toBeGreaterThan(g.boundingBox.min.z + 8 * .8);
    expect(g.groups.map(group => group.materialIndex)).toEqual([0, 1]);
    g.dispose();
  });
});

describe('beveled hardcover boards', () => {
  it('fits landscape and portrait covers without cropping or stretching', () => {
    for (const [width, height] of [[600, 300], [600, 900], [300, 1200]]) {
      const fit = fitCoverImage(width, height, 676, 1024);
      expect(fit.width / fit.height).toBeCloseTo(width / height);
      expect(fit.x).toBeGreaterThanOrEqual(0); expect(fit.y).toBeGreaterThanOrEqual(0);
      expect(fit.x + fit.width).toBeLessThanOrEqual(676);
      expect(fit.y + fit.height).toBeLessThanOrEqual(1024);
    }
  });
  it('keeps every bevel inside the shared book dimensions', () => {
    const g = boardGeometry(200, 300, 2.1);
    g.computeBoundingBox();
    const { min, max } = g.boundingBox;
    expect(min.x).toBeCloseTo(-100); expect(max.x).toBeCloseTo(100);
    expect(min.y).toBeCloseTo(-150); expect(max.y).toBeCloseTo(150);
    expect(min.z).toBeCloseTo(-1.05); expect(max.z).toBeCloseTo(1.05);
    expect(g.getAttribute('position').count).toBeGreaterThan(100);
    g.dispose();
  });
  it('maps the cover image within 0–1 and gives the bevel its own material', () => {
    const g = boardGeometry(200, 300, 2.1), uv = g.getAttribute('uv');
    expect(g.groups.some(group => group.materialIndex === 1)).toBe(true);
    for (const face of g.groups.filter(group => group.materialIndex === 0)) {
      for (let i = face.start; i < face.start + face.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0); expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0); expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
    }
    g.dispose();
  });
});

describe('book motion with continuous velocity', () => {
  const frames = [
    { transform:{ x:100, y:150, angle:90, scale:.4 } },
    { offset:.26, transform:{ x:90, y:20, angle:80, scale:.49 } },
    { offset:.7, transform:{ x:18, y:-12, angle:16, scale:.91 } },
    { transform:{ x:0, y:0, angle:0, scale:1 } }
  ];
  it('lands exactly on both ends, with no rotation or scale overshoot', () => {
    expect(sampleBookMotion(frames, 0)).toMatchObject(frames[0].transform);
    expect(sampleBookMotion(frames, 1)).toMatchObject(frames.at(-1).transform);
    let previous = sampleBookMotion(frames, 0);
    for (let i = 1; i <= 1000; i++) {
      const pose = sampleBookMotion(frames, i / 1000);
      expect(pose.angle).toBeLessThanOrEqual(previous.angle);
      expect(pose.angle).toBeGreaterThanOrEqual(0);
      expect(pose.scale).toBeGreaterThanOrEqual(previous.scale);
      expect(pose.scale).toBeLessThanOrEqual(1);
      expect(pose.y).toBeGreaterThanOrEqual(-12);
      previous = pose;
    }
  });
  it('preserves velocity across every internal keyframe', () => {
    const dt = .000001;
    for (const t of [.26, .7]) for (const key of ['x', 'y', 'angle', 'scale']) {
      const mid = sampleBookMotion(frames, t)[key];
      const left = (mid - sampleBookMotion(frames, t - dt)[key]) / dt;
      const right = (sampleBookMotion(frames, t + dt)[key] - mid) / dt;
      expect(Math.abs(left - right)).toBeLessThan(.02);
    }
  });
  it('closes a cancelled opening continuously before the book rejoins the shelf', () => {
    const cancelledPose = { x:24, y:0, angle:0, pitch:0, roll:0, scale:1, coverOpen:.68, bookmarkWithdraw:0 };
    const returning = [
      { transform:cancelledPose },
      { offset:.45, transform:{ x:48, y:18, angle:62, pitch:0, scale:.6 } },
      { transform:{ x:100, y:60, angle:90, pitch:0, scale:.3 } }
    ];
    expect(sampleBookMotion(returning, 0)).toEqual(cancelledPose);
    let previous = cancelledPose.coverOpen;
    for (let step = 1; step <= 100; step++) {
      const pose = sampleBookMotion(returning, step / 100);
      expect(pose.coverOpen).toBeLessThanOrEqual(previous);
      expect(pose.coverOpen).toBeGreaterThanOrEqual(0);
      previous = pose.coverOpen;
    }
    expect(sampleBookMotion(returning, .2).coverOpen).toBeGreaterThan(0);
    expect(sampleBookMotion(returning, .45).coverOpen).toBe(0);
    expect(sampleBookMotion(returning, 1)).toMatchObject({ angle:90, coverOpen:0 });
  });
  it('inserts the ribbon before closing, with continuous poses and no scale or hinge overshoot', () => {
    const opened={x:24,y:0,angle:0,pitch:0,roll:0,scale:1,coverOpen:1,bookmarkWithdraw:1};
    const marked={...opened,bookmarkWithdraw:0},closed={...marked,x:0,coverOpen:0};
    const marking=[{transform:opened},{transform:marked}],closing=[{transform:marked},{transform:closed}];
    for (let step=0;step<=100;step++) {
      const ribbon=sampleBookMotion(marking,step/100),cover=sampleBookMotion(closing,step/100);
      expect(ribbon.coverOpen).toBe(1); expect(ribbon.scale).toBe(1);
      expect(ribbon.bookmarkWithdraw).toBeGreaterThanOrEqual(0);
      expect(ribbon.bookmarkWithdraw).toBeLessThanOrEqual(1);
      expect(cover.bookmarkWithdraw).toBe(0); expect(cover.scale).toBe(1);
      expect(cover.coverOpen).toBeGreaterThanOrEqual(0); expect(cover.coverOpen).toBeLessThanOrEqual(1);
    }
    expect(sampleBookMotion(marking,1)).toEqual(sampleBookMotion(closing,0));
    expect(sampleBookMotion(closing,1)).toEqual(closed);
  });
  it('retains the shelf world rotation through a docking handoff', () => {
    const dock = { x:-38, y:86, angle:60, pitch:14, roll:-3, scale:.42 };
    const moving = [{ transform:{ x:0, y:0, angle:0, pitch:0, roll:0, scale:1 } }, { transform:dock }];
    expect(sampleBookMotion(moving, 1)).toMatchObject(dock);
    const mid = sampleBookMotion(moving, .5);
    expect(mid.roll).toBeCloseTo(-1.5);
    expect(mid.pitch).toBeCloseTo(7);
  });
});


describe('engraved binding geometry', () => {
  it('recesses the real surface while keeping the cover joins untouched', () => {
    const g=bindingGeometry(200,300,52,96,(u,v)=>u>.4&&u<.6&&v>.4&&v<.6?1:0)
    const p=g.getAttribute('position'), n=g.getAttribute('normal')
    const center=48*385+192
    expect(p.count).toBe(97*385)
    expect(p.getX(center)).toBeCloseTo(-119.76+300*.0007,4)
    expect(p.getX(48*385)).toBeCloseTo(-119.76,4)
    expect(p.getX(0)).toBe(-100)
    for(let i=0;i<n.count;i+=317) expect(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))).toBeCloseTo(1,4)
    g.dispose()
  })
})

describe('real shelf book materials', () => {
  const book = { title:'A printed cover', author:'An author', format:'EPUB' };
  const style = { color:'#42604b', shade:'#324c3a', ink:'#ffffff', coverRatio:.66, width:40 };
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  function canvasContext() {
    const context = new Proxy({
      measureText: text => ({ width:String(text).length * 16 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillText:vi.fn(), drawImage:vi.fn(),
      getImageData:vi.fn((_x, _y, width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }))
    }, { get: (target, key) => target[key] ?? (() => {}) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    return context;
  }

  it('keeps glossy lamp reflections sharp, satin broad and matte uncoated at every shelf detail level', () => {
    canvasContext();
    for (const options of [{ shelf:true, overview:true }, { shelf:true }, { shelf:true, inspectionResolution:1024 }, {}]) {
      const models = ['matte', 'satin', 'glossy'].map(finish => createBookModel({ ...book,
        coverFinish:finish, spineSurfaceFinish:finish }, style, 132, 200, 40, null, options));
      const materials = models.map(model => {
        const front = model.getObjectByName('front-cover').material;
        return Array.isArray(front) ? front[0] : front;
      });
      const [matte, satin, glossy] = materials;
      // A nearly smooth laminate resolves a small lamp reflection; satin
      // spreads the same energy and matte cannot acquire a varnish hotspot.
      expect(glossy.clearcoat).toBe(1); expect(glossy.clearcoatRoughness).toBeLessThan(.09);
      expect(glossy.clearcoatRoughness).toBeGreaterThanOrEqual(.06);
      expect(satin.clearcoatRoughness).toBeGreaterThan(.2);
      expect(satin.clearcoat).toBeLessThan(glossy.clearcoat / 2);
      expect(matte.clearcoat).toBe(0); expect(matte.roughness).toBeGreaterThan(.9);
      expect(satin.roughness - glossy.roughness).toBeGreaterThan(.25);
      expect(matte.roughness - satin.roughness).toBeGreaterThan(.4);
      for (let i = 0; i < models.length; i++) {
        expect(materials[i].metalness).toBe(0); expect(materials[i].specularIntensity).toBe(1);
        expect(materials[i].color.getHex()).toBe(0xffffff);
        // Spine roughness lives in packed green, so a second multiplication
        // by the finish roughness would accidentally square it.
        expect(models[i].getObjectByName('binding').material.roughness).toBe(1);
        models[i].userData.dispose();
      }
    }
  });

  it('keeps the reflection imperfections on every outer book surface at all detail levels', () => {
    canvasContext();
    const keys = new Set();
    for (const options of [{ shelf:true, overview:true }, { shelf:true }, { shelf:true, inspectionResolution:1024 }, {}]) {
      const model = createBookModel({ ...book, coverFinish:'glossy' }, style, 132, 200, 40, null, options);
      const front = model.getObjectByName('front-cover').material;
      const cover = Array.isArray(front) ? front[0] : front;
      for (const name of ['binding', 'back-cover', 'binding-head-cap', 'binding-tail-cap'])
        expect(model.getObjectByName(name).material.userData.bookReflectionSurface).toBeTruthy();
      expect(cover.userData.bookReflectionSurface).toBeTruthy();
      keys.add(cover.customProgramCacheKey());
      const edges = [].concat(model.getObjectByName('page-block').material);
      expect(edges.every(material => !material.userData.bookReflectionSurface)).toBe(true);
      model.userData.dispose();
    }
    expect(keys.size).toBe(1);
  });

  it('changes only reflection uniforms while keeping cover pixels, geometry and GPU resources intact', () => {
    const context = canvasContext();
    const model = createBookModel({ ...book, coverFinish:'glossy' }, style, 132, 200, 40, null,
      { shelf:true, inspectionResolution:1024 });
    const front = model.getObjectByName('front-cover'), cover = front.material[0];
    const geometry = front.geometry, vertices = [...geometry.attributes.position.array];
    const map = cover.map, normal = cover.normalMap, version = cover.version;
    const key = cover.customProgramCacheKey();
    context.drawImage.mockClear(); context.fillText.mockClear();
    const disposeMap = vi.spyOn(map, 'dispose');
    cover.userData.bookReflectionSurface.setStrength(0);
    cover.userData.bookReflectionSurface.setStrength(.018);
    expect(front.geometry).toBe(geometry); expect([...geometry.attributes.position.array]).toEqual(vertices);
    expect(cover.map).toBe(map); expect(cover.normalMap).toBe(normal);
    expect(cover.version).toBe(version); expect(cover.customProgramCacheKey()).toBe(key);
    expect(context.drawImage).not.toHaveBeenCalled(); expect(context.fillText).not.toHaveBeenCalled();
    expect(disposeMap).not.toHaveBeenCalled();
    model.userData.dispose(); expect(disposeMap).toHaveBeenCalledOnce();
  });

  it('smooths the existing printed grain when laminating without repainting or reallocating the cover', () => {
    const context = canvasContext();
    let completeLoad;
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { completeLoad = ready; });
    const model = createBookModel({ ...book, coverFinish:'matte' }, style, 132, 200, 40,
      'blob:laminate-grain', { shelf:true, inspectionResolution:1024 });
    completeLoad(new THREE.Texture({ width:660, height:1000 }));
    const front = model.getObjectByName('front-cover'), cover = front.material[0];
    const map = cover.map, normal = cover.normalMap, geometry = front.geometry;
    const source = normal.source, matteGrain = cover.normalScale.x;
    const disposeNormal = vi.spyOn(normal, 'dispose');
    context.drawImage.mockClear(); context.fillText.mockClear();
    model.userData.updateCoverAppearance({ coverFinish:'satin' });
    const satinGrain = cover.normalScale.x;
    model.userData.updateCoverAppearance({ coverFinish:'glossy' });
    expect(cover.normalScale.x).toBeLessThan(satinGrain / 2);
    expect(satinGrain).toBeLessThan(matteGrain);
    expect(front.material[0]).toBe(cover); expect(front.geometry).toBe(geometry);
    expect(cover.map).toBe(map); expect(cover.normalMap).toBe(normal); expect(normal.source).toBe(source);
    expect(context.drawImage).not.toHaveBeenCalled(); expect(context.fillText).not.toHaveBeenCalled();
    expect(disposeNormal).not.toHaveBeenCalled();
    model.userData.updateCoverAppearance({ coverFinish:'matte' });
    expect(cover.normalScale.x).toBe(matteGrain);
    model.userData.dispose(); expect(disposeNormal).toHaveBeenCalledOnce();
  });

  it('continues the selected spine finish over its visible head and tail while preserving metallic foil', () => {
    canvasContext();
    const model = createBookModel({ ...book, spineSurfaceFinish:'matte' }, style, 132, 200, 40, null,
      { shelf:true, overview:true });
    const caps = ['binding-head-cap', 'binding-tail-cap'].map(name => model.getObjectByName(name));
    const resources = caps.map(mesh => ({ material:mesh.material, geometry:mesh.geometry }));
    expect(caps.every(mesh => mesh.material.clearcoat === 0 && mesh.material.roughness > .9)).toBe(true);
    model.userData.updateSpineAppearance({ ...book, spineSurfaceFinish:'glossy' }, style);
    for (const [i, cap] of caps.entries()) {
      expect(cap.material).toBe(resources[i].material); expect(cap.geometry).toBe(resources[i].geometry);
      expect(cap.material.clearcoat).toBe(1); expect(cap.material.roughness).toBeLessThan(.2);
    }
    model.userData.updateSpineAppearance({ ...book, spineFinish:'gold', spineSurfaceFinish:'glossy' }, style);
    const foil = caps.map(mesh => ({ roughness:mesh.material.roughness, clearcoat:mesh.material.clearcoat,
      clearcoatRoughness:mesh.material.clearcoatRoughness, envMapIntensity:mesh.material.envMapIntensity }));
    model.userData.updateSpineAppearance({ ...book, spineFinish:'gold', spineSurfaceFinish:'matte' }, style);
    for (const [i, cap] of caps.entries()) {
      expect(cap.material.metalness).toBe(1);
      for (const [key, value] of Object.entries(foil[i])) expect(cap.material[key]).toBe(value);
    }
    model.userData.updateSpineAppearance({ ...book, spineSurfaceFinish:'matte' }, style);
    expect(caps.every(mesh => mesh.material.metalness === 0 && mesh.material.clearcoat === 0)).toBe(true);
    model.userData.dispose();
  });

  it('builds a small overview directly without allocating full text or relief canvases', () => {
    const context = canvasContext(), canvases = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, ...args) => {
      const node = createElement(tag, ...args); if (tag === 'canvas') canvases.push(node); return node;
    });
    const overview = createBookModel({ ...book, spineEngraved:true }, style, 132, 200, 40, null,
      { shelf:true, overview:true });
    expect(overview.userData).toMatchObject({ overview:true, isOverview:true, detailLevel:'overview' });
    expect(canvases.length).toBeGreaterThan(4);
    for (const canvas of canvases) {
      expect(canvas.width).toBeLessThanOrEqual(256); expect(canvas.height).toBeLessThanOrEqual(256);
    }
    const binding = overview.getObjectByName('binding');
    expect(binding.geometry.attributes.position.count).toBe(34);
    expect(binding.material.map.image.width).toBe(64); expect(binding.material.map.image.height).toBe(256);
    expect(binding.material.roughnessMap.image.width).toBe(64);
    expect(binding.material.roughnessMap.image.height).toBe(256);
    expect(binding.material.bumpMap).toBeNull(); expect(context.getImageData).not.toHaveBeenCalled();
    overview.userData.dispose();
  });

  it('retains the physical curve, boards, pages, bookmark and finishes in the overview', async () => {
    canvasContext();
    const nextBook = { ...book, progressFraction:.4, spineFinish:'gold', spineTextFinish:'silver',
      spineSurfaceFinish:'glossy', coverFinish:'glossy', pageEdgeFinish:'glossy' };
    const overview = createBookModel(nextBook, style, 132, 200, 40, null, { shelf:true, overview:true });
    const detail = createBookModel(nextBook, style, 132, 200, 40, null, { shelf:true });
    await expect(overview.userData.ready).resolves.toBe(true);
    const binding = overview.getObjectByName('binding'), detailedBinding = detail.getObjectByName('binding');
    binding.geometry.computeBoundingBox(); detailedBinding.geometry.computeBoundingBox();
    expect(binding.geometry.boundingBox).toEqual(detailedBinding.geometry.boundingBox);
    const positions = binding.geometry.attributes.position;
    expect(positions.getX(16)).toBeCloseTo(-66 - 40 * .38);
    expect(positions.getZ(0)).toBe(-20); expect(positions.getZ(32)).toBe(20);
    expect(overview.getObjectByName('front-cover').geometry.type).toBe('ExtrudeGeometry');
    expect(overview.getObjectByName('back-cover').geometry.type).toBe('ExtrudeGeometry');
    expect(overview.getObjectByName('page-block').geometry.parameters.depth).toBeGreaterThan(30);
    expect(overview.getObjectByName('reading-bookmark').geometry.attributes.position.count).toBe(36);
    expect(overview.getObjectByName('reading-bookmark').geometry.attributes.position.count)
      .toBeLessThan(detail.getObjectByName('reading-bookmark').geometry.attributes.position.count);
    let drawCalls = 0;
    overview.traverseVisible(object => {
      if (!object.isMesh) return;
      drawCalls += Array.isArray(object.material)
        ? object.geometry.groups.filter(group => object.material[group.materialIndex]?.visible).length
        : Number(object.material.visible);
    });
    expect(drawCalls).toBe(7);
    expect(binding.material.roughnessMap).toBe(binding.material.metalnessMap);
    for (const property of ['roughness','clearcoat','clearcoatRoughness','envMapIntensity']) {
      expect(binding.material[property]).toBe(detailedBinding.material[property]);
      expect(overview.getObjectByName('front-cover').material[property])
        .toBe(detail.getObjectByName('front-cover').material[0][property]);
    }
    overview.userData.dispose(); detail.userData.dispose();
  });

  it('shares one owned paper material across overview edges and releases it exactly once', () => {
    canvasContext();
    const canvases = [], createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, ...args) => {
      const node = createElement(tag, ...args); if (tag === 'canvas') canvases.push(node); return node;
    });
    const overview = createBookModel(book, style, 132, 200, 40, null, { shelf:true, overview:true });
    // There is no unmounted second fore-edge texture to leak: both edges use
    // this one page-block material and one 32 px raster from construction.
    expect(canvases.filter(canvas => canvas.width === 32 && canvas.height === 32)).toHaveLength(1);
    const material = overview.getObjectByName('page-block').material, map = material.map;
    const releaseMaterial = vi.spyOn(material, 'dispose'), releaseMap = vi.spyOn(map, 'dispose');
    const originalRoughness = material.roughness;
    overview.userData.updateEdgeAppearance({ pageEdgeFinish:'glossy' });
    expect(overview.getObjectByName('page-block').material).toBe(material); expect(material.map).toBe(map);
    expect(material.roughness).toBeLessThan(originalRoughness);
    overview.userData.dispose(); overview.userData.dispose();
    expect(releaseMaterial).toHaveBeenCalledOnce(); expect(releaseMap).toHaveBeenCalledOnce();
  });

  it('keeps overview titles and authors correct after live appearance updates', () => {
    const context = canvasContext();
    const overview = createBookModel({ ...book, spineTitleOverride:'Correct title', author:'Correct author' },
      style, 132, 200, 40, null, { shelf:true, overview:true });
    expect(context.fillText.mock.calls.some(([text]) => text === 'Correct title')).toBe(true);
    expect(context.fillText.mock.calls.some(([text]) => text === 'Correct author')).toBe(true);
    const original = overview.getObjectByName('binding').material.map, release = vi.spyOn(original, 'dispose');
    overview.userData.updateSpineAppearance({ ...book, spineTitleOverride:'Updated title', author:'Updated author',
      spineEngraved:true, spineTextFinish:'gold' }, { ...style, color:'#936536' });
    expect(release).toHaveBeenCalledOnce();
    expect(context.fillText.mock.calls.some(([text]) => text === 'Updated title')).toBe(true);
    expect(context.fillText.mock.calls.some(([text]) => text === 'Updated author')).toBe(true);
    const binding = overview.getObjectByName('binding');
    expect(binding.material.map.image.height).toBe(256); expect(binding.material.bumpMap).toBeNull();
    expect(binding.geometry.attributes.position.count).toBe(34);
    expect(overview.getObjectByName('back-cover').material.color.getHexString()).toBe('936536');
    overview.userData.dispose();
  });

  it('caps landscape covers and promotes using the same decoded image without a second download', async () => {
    canvasContext();
    let completeLoad;
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { completeLoad = ready; });
    const landscape = { ...style, coverRatio:2.5 };
    const overview = createBookModel(book, landscape, 500, 200, 40, 'blob:overview-promotion',
      { shelf:true, overview:true });
    const cover = overview.getObjectByName('front-cover').material;
    expect(cover.map.image.width).toBe(256); expect(cover.map.image.height).toBe(102);
    completeLoad(new THREE.Texture({ width:1500, height:600 }));
    await expect(overview.userData.ready).resolves.toBe(true);
    expect(cover.map.image.width).toBe(256); expect(cover.map.image.height).toBe(102);
    const detail = createBookModel(book, landscape, 500, 200, 40, 'blob:overview-promotion', { shelf:true });
    await expect(detail.userData.ready).resolves.toBe(true);
    expect(detail.userData.overview).toBe(false);
    expect(detail.getObjectByName('front-cover').material[0].map.image.height).toBe(512);
    expect(loader).toHaveBeenCalledOnce();
    overview.userData.dispose(); detail.userData.dispose();
  });

  it('preserves bookmark updates, opening, page handoff and single resource disposal in overview', () => {
    canvasContext();
    const overview = createBookModel(book, style, 132, 200, 40, null, { shelf:true, overview:true });
    for (const name of ['updateCoverSource','updateSpineAppearance','updateCoverAppearance','updateEdgeAppearance',
      'updateBookmark','setCoverOpen','setBookmarkWithdraw','setPageSnapshot','dispose']) {
      expect(overview.userData[name]).toBeTypeOf('function');
    }
    expect(overview.userData.hasBookmark).toBe(false);
    overview.userData.updateBookmark({ ...book, progressFraction:.8 });
    expect(overview.userData.hasBookmark).toBe(true);
    expect(overview.getObjectByName('reading-bookmark').geometry.attributes.position.count).toBe(36);
    overview.userData.setCoverOpen(1);
    expect(overview.getObjectByName('front-cover-hinge').rotation.y).toBeCloseTo(-Math.PI * .94);
    expect(overview.getObjectByName('reading-page-paper').visible).toBe(true);
    const interior = overview.getObjectByName('front-cover').material[2];
    const releaseInterior = vi.spyOn(interior, 'dispose');
    overview.userData.setCoverOpen(0);
    expect(Array.isArray(overview.getObjectByName('front-cover').material)).toBe(false);
    const source = document.createElement('canvas'); source.width = 256; source.height = 256;
    expect(overview.userData.setPageSnapshot({ source, width:256, height:256 })).toBe(true);
    overview.userData.setBookmarkWithdraw(1);
    expect(overview.getObjectByName('reading-bookmark').visible).toBe(false);
    const materials = new Set(), textures = new Set(), geometries = new Set();
    overview.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) materials.add(material);
    });
    for (const material of materials) for (const key of ['map','roughnessMap','metalnessMap','bumpMap']) {
      if (material[key]) textures.add(material[key]);
    }
    const disposals = [...geometries, ...materials, ...textures].map(resource => vi.spyOn(resource, 'dispose'));
    overview.userData.dispose(); overview.userData.dispose();
    for (const release of disposals) expect(release).toHaveBeenCalledOnce();
    expect(releaseInterior).toHaveBeenCalledOnce();
  });

  it('opens the front board about its binding edge without cutting through the saved page', () => {
    canvasContext();
    const model = createBookModel(book, style, 132, 200, 40, null);
    const front = model.getObjectByName('front-cover'), hinge = model.getObjectByName('front-cover-hinge');
    const page = model.getObjectByName('reading-page-paper');
    expect(page.visible).toBe(false);
    expect(front.material[2].visible).toBe(false);
    expect(hinge.position.z).toBeCloseTo(40 / 2 - 200 * .007 / 2);
    expect(front.position.z).toBe(0);
    const p = front.geometry.getAttribute('position');
    for (let step = 0; step <= 20; step++) {
      model.userData.setCoverOpen(step / 20); model.updateMatrixWorld(true);
      expect(page.visible).toBe(step > 0);
      expect(front.material[2].visible).toBe(step > 0);
      for (let i = 0; i < p.count; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(front.matrixWorld);
        expect(vertex.z).toBeGreaterThan(page.position.z);
      }
    }
    expect(front.material[2].map).toBeNull();
    expect(front.geometry.groups.some(face => face.materialIndex === 2)).toBe(true);
    model.userData.setCoverOpen(0);
    expect(page.visible).toBe(false);
    expect(front.material[2].visible).toBe(false);
    model.userData.dispose();
  });

  it('uses the real saved page without text fabrication, colour lighting or image stretching', () => {
    canvasContext();
    const model = createBookModel(book, style, 132, 200, 40, null);
    const source = document.createElement('canvas'); source.width = 800; source.height = 600;
    const snapshot = { source, width:800, height:600, sourceType:'pdf-canvas',
      location:{ locator:{ page:31 } }, text:'Exact text from the saved page' };
    const page = model.getObjectByName('reading-page');
    expect(page.visible).toBe(false);
    expect(model.userData.setPageSnapshot(snapshot)).toBe(true);
    expect(page.visible).toBe(true);
    expect(page.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(page.material.toneMapped).toBe(false);
    expect(page.material.color.getHex()).toBe(0xffffff);
    expect(page.material.map.image).toBe(source);
    expect(page.material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(page.geometry.parameters.width / page.geometry.parameters.height).toBeCloseTo(800 / 600);
    expect(model.userData.pageSnapshot.location.locator.page).toBe(31);
    const previous = page.material.map, release = vi.spyOn(previous, 'dispose');
    model.userData.setPageSnapshot({ ...snapshot, location:{ locator:{ page:32 } } });
    expect(release).toHaveBeenCalledOnce();
    const current = page.material.map, releaseCurrent = vi.spyOn(current, 'dispose');
    model.userData.dispose();
    expect(releaseCurrent).toHaveBeenCalledOnce();
    expect(model.userData.setPageSnapshot(snapshot)).toBe(false);
  });

  it('projects the fitted saved image bounds instead of the outer cover with its paper margins', () => {
    canvasContext();
    const model = createBookModel(book, style, 132, 200, 40, null);
    const source = document.createElement('canvas'); source.width = 400; source.height = 400;
    model.userData.setPageSnapshot({ source, width:400, height:400 });
    model.position.set(40, -60, 0); model.scale.setScalar(2);
    const camera = new THREE.OrthographicCamera(-200, 200, 400, -400, .1, 1000); camera.position.z = 800;
    const result = projectBookPageBounds(model.userData.pageSurface, camera, 400, 800, { left:10, top:20 });
    expect(result.width).toBeCloseTo(256.8);
    expect(result.height).toBeCloseTo(256.8);
    expect(result.left + result.width / 2).toBeCloseTo(251.08);
    expect(result.top + result.height / 2).toBeCloseTo(480);
    expect(result.height).toBeLessThan(400);
    model.userData.dispose();
  });

  it('ends the zoom flat and exactly aligned with the reader without changing the starting pose', () => {
    canvasContext();
    const model = createBookModel(book, style, 132, 200, 40, null);
    const source = document.createElement('canvas'); source.width = 400; source.height = 600;
    model.userData.setPageSnapshot({ source, width:400, height:600 });
    const viewportWidth = 400, viewportHeight = 800, centerX = 206, centerY = 360;
    const origin = { x:40, y:60, scale:2, angle:0, pitch:7, roll:-3, coverOpen:1, bookmarkWithdraw:0 };
    const applyPose = pose => {
      model.position.set(centerX - viewportWidth / 2 + pose.x, viewportHeight / 2 - centerY - pose.y, 0);
      model.rotation.set(pose.pitch * Math.PI / 180, pose.angle * Math.PI / 180, pose.roll * Math.PI / 180);
      model.scale.setScalar(pose.scale); model.updateMatrixWorld(true);
    };
    applyPose(origin);
    const startingRotation = model.rotation.clone(), startingPosition = model.position.clone(), startingScale = model.scale.clone();
    const camera = new THREE.OrthographicCamera(-200, 200, 400, -400, .1, 1000); camera.position.z = 800;
    const target = { left:8, top:24, width:360, height:540 }, offset = { left:10, top:20 };
    const destination = planBookPageZoom(model, camera, {
      viewportWidth, viewportHeight, centerX, centerY, origin, offset, target
    });
    expect(model.rotation.toArray()).toEqual(startingRotation.toArray());
    expect(model.position).toEqual(startingPosition);
    expect(model.scale).toEqual(startingScale);
    expect(destination).toMatchObject({ pitch:0, roll:0, angle:0, coverOpen:1, bookmarkWithdraw:1 });
    applyPose(destination);
    const actual = projectBookPageBounds(model.userData.pageSurface, camera, viewportWidth, viewportHeight, offset);
    for (const key of ['left', 'top', 'width', 'height']) expect(actual[key]).toBeCloseTo(target[key], 4);
    const mid = sampleBookMotion([{ transform:origin }, { transform:destination }], .5);
    expect(mid.pitch).toBeCloseTo(3.5);
    expect(mid.roll).toBeCloseTo(-1.5);
    model.userData.dispose();
  });

  it('renders enlarged shelf covers at 1024 or 2048 pixels with surface grain', () => {
    canvasContext();
    for (const resolution of [1024,2048]) {
      const model = createBookModel(book, style, 132, 200, 40, null, {shelf:true,inspectionResolution:resolution});
      const cover = model.getObjectByName('front-cover').material[0];
      expect(cover.map.image.height).toBe(resolution);
      expect(cover.normalMap).toBeTruthy();
      expect(model.userData.inspectionResolution).toBe(resolution);
      model.userData.dispose();
    }
  });

  it('keeps the loaded cover separate from cloth and gives the shelf visible paper edges', () => {
    canvasContext();
    let completeLoad;
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { completeLoad = ready; });
    const model = createBookModel(book, style, 132, 200, 40, 'blob:cover', { shelf:true });
    const cover = model.getObjectByName('front-cover').material[0];
    const cloth = model.getObjectByName('front-cover').material[1];
    const page = model.getObjectByName('page-block').material[0];
    const fallback = cover.map, releaseFallback = vi.spyOn(fallback, 'dispose');
    model.userData.invalidate = vi.fn();
    expect(cover).not.toBe(cloth);
    expect(page).not.toBe(cloth);
    expect(page.map).toBeInstanceOf(THREE.CanvasTexture);
    const downloaded = new THREE.Texture({ width:660, height:1000 });
    const releaseDownloaded = vi.spyOn(downloaded, 'dispose');
    expect(() => completeLoad(downloaded)).not.toThrow();
    expect(cover.map).not.toBe(fallback);
    expect(cover.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(cover.map.image.height).toBe(512);
    expect(cloth.map).toBeNull();
    expect(releaseFallback).toHaveBeenCalledOnce();
    expect(releaseDownloaded).toHaveBeenCalledOnce();
    expect(model.userData.invalidate).toHaveBeenCalledOnce();
    const satinRoughness = cover.roughness;
    model.userData.updateCoverAppearance({ coverFinish:'glossy' });
    expect(cover.roughness).toBeLessThan(satinRoughness);
    model.userData.dispose();
  });

  it('releases a late image without resurrecting a disposed shelf book', () => {
    canvasContext();
    let completeLoad;
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { completeLoad = ready; });
    const model = createBookModel(book, style, 132, 200, 40, 'blob:cover', { shelf:true });
    model.userData.invalidate = vi.fn();
    model.userData.dispose();
    const downloaded = new THREE.Texture({ width:660, height:1000 });
    const releaseDownloaded = vi.spyOn(downloaded, 'dispose');
    completeLoad(downloaded);
    expect(releaseDownloaded).toHaveBeenCalledOnce();
    expect(model.userData.invalidate).not.toHaveBeenCalled();
  });

  it('retains the same curved silhouette with fewer shelf vertices and texture pixels', () => {
    canvasContext();
    const shelf = createBookModel({ ...book, spineEngraved:true }, style, 132, 200, 40, null, { shelf:true });
    const detail = createBookModel({ ...book, spineEngraved:true }, style, 132, 200, 40, null);
    const shelfBinding = shelf.getObjectByName('binding'), detailBinding = detail.getObjectByName('binding');
    shelfBinding.geometry.computeBoundingBox(); detailBinding.geometry.computeBoundingBox();
    expect(shelfBinding.geometry.boundingBox).toEqual(detailBinding.geometry.boundingBox);
    expect(shelfBinding.geometry.attributes.position.count).toBeLessThan(detailBinding.geometry.attributes.position.count / 8);
    expect(shelfBinding.material.map.image.width * shelfBinding.material.map.image.height)
      .toBeLessThan(detailBinding.material.map.image.width * detailBinding.material.map.image.height);
    shelf.userData.dispose(); detail.userData.dispose();
  });

  it('starts a lifted copy with the already decoded shelf cover and releases the cache after both copies close', async () => {
    canvasContext();
    let completeLoad;
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { completeLoad = ready; });
    const shelf = createBookModel(book, style, 132, 200, 40, 'blob:shared-cover', { shelf:true });
    completeLoad(new THREE.Texture({ width:660, height:1000 }));
    await expect(shelf.userData.ready).resolves.toBe(true);
    const lifted = createBookModel(book, style, 264, 400, 80, 'blob:shared-cover');
    expect(lifted.userData.coverLoaded).toBe(true);
    // Lifted copies re-raster above the shelf's 512: 1024 covers a 440 px board at 2x.
    expect(lifted.getObjectByName('front-cover').material[0].map.image.height).toBe(1024);
    expect(loader).toHaveBeenCalledOnce();
    shelf.userData.dispose();
    const replacement = createBookModel(book, style, 264, 400, 80, 'blob:shared-cover');
    expect(replacement.userData.coverLoaded).toBe(true);
    expect(loader).toHaveBeenCalledOnce();
    lifted.userData.dispose(); replacement.userData.dispose();
    const later = createBookModel(book, style, 132, 200, 40, 'blob:shared-cover', { shelf:true });
    expect(loader).toHaveBeenCalledTimes(2);
    later.userData.dispose();
    await expect(later.userData.ready).resolves.toBe(false);
  });

  it('keeps the real cover visible during source replacement and rejects a stale decode', async () => {
    canvasContext();
    const callbacks = new Map();
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, ready) => { callbacks.set(url, ready); });
    const model = createBookModel(book, style, 132, 200, 40, 'blob:first-cover', { shelf:true });
    callbacks.get('blob:first-cover')(new THREE.Texture({ width:660, height:1000 }));
    const material = model.getObjectByName('front-cover').material[0];
    const firstMap = material.map;
    const waiting = model.userData.updateCoverSource('blob:slow-cover');
    expect(material.map).toBe(firstMap);
    const newest = model.userData.updateCoverSource('blob:latest-cover');
    await expect(waiting).resolves.toBe(false);
    callbacks.get('blob:slow-cover')(new THREE.Texture({ width:660, height:1000 }));
    expect(material.map).toBe(firstMap);
    callbacks.get('blob:latest-cover')(new THREE.Texture({ width:660, height:1000 }));
    await expect(newest).resolves.toBe(true);
    expect(material.map).not.toBe(firstMap);
    model.userData.dispose();
  });

  it('times out an external cover, ignores its late image and allows a fresh retry', async () => {
    canvasContext(); vi.useFakeTimers();
    const callbacks = [];
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => callbacks.push(ready));
    const model = createBookModel(book, style, 132, 200, 40, 'https://example.test/slow-cover.jpg');
    const material = model.getObjectByName('front-cover').material[0], fallback = material.map;
    await vi.advanceTimersByTimeAsync(6000);
    await expect(model.userData.ready).resolves.toBe(false);
    const late = new THREE.Texture({ width:660, height:1000 }), dispose = vi.spyOn(late, 'dispose');
    callbacks[0](late);
    expect(dispose).toHaveBeenCalledOnce();
    expect(material.map).toBe(fallback);
    const retry = createBookModel(book, style, 132, 200, 40, 'https://example.test/slow-cover.jpg');
    expect(loader).toHaveBeenCalledTimes(2);
    model.userData.dispose(); retry.userData.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await expect(retry.userData.ready).resolves.toBe(false);
  });

  it('draws a closed shelf book with a bookmark in at most eight calls', () => {
    canvasContext();
    const model = createBookModel({ ...book, progressFraction:.4 }, style, 132, 200, 40, null, { shelf:true });
    let drawCalls = 0;
    model.traverseVisible(object => {
      if (!object.isMesh) return;
      drawCalls += Array.isArray(object.material)
        ? object.geometry.groups.filter(group => object.material[group.materialIndex]?.visible).length
        : Number(object.material.visible);
    });
    expect(drawCalls).toBeLessThanOrEqual(8);
    expect(model.getObjectByName('page-block').material[0].vertexColors).toBe(true);
    model.userData.dispose();
  });

  it('reuses the uploaded pixels of shared detail when another book is built', () => {
    canvasContext();
    const first = createBookModel({ ...book, progressFraction:.5 }, style, 132, 200, 40, null);
    const maps = model => [model.getObjectByName('page-block').material[0].map,
      model.getObjectByName('reading-bookmark').material.alphaMap, model.getObjectByName('back-cover').material.normalMap];
    const versions = maps(first).map(texture => texture.source.version);
    const second = createBookModel({ ...book, progressFraction:.5 }, style, 132, 200, 40, null);
    expect(maps(second).map(texture => texture.source.version)).toEqual(versions);
    first.userData.dispose(); second.userData.dispose();
  });

  it('paints a generated or placeholder cover once per book, and none when the image is decoded', async () => {
    canvasContext();
    let completeLoad;
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { completeLoad = ready; });
    const canvases = [], createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, ...args) => {
      const node = createElement(tag, ...args); if (tag === 'canvas') canvases.push(node); return node;
    });
    const covers = () => canvases.filter(canvas => canvas.height === 512).length;
    const generated = createBookModel(book, style, 132, 200, 40, null, { shelf:true });
    expect(covers()).toBe(1);
    const pending = createBookModel(book, style, 132, 200, 40, 'blob:paint-once', { shelf:true });
    expect(covers()).toBe(2);
    completeLoad(new THREE.Texture({ width:660, height:1000 }));
    await pending.userData.ready;
    expect(covers()).toBe(3);
    // A second copy of the same decoded image draws it straight away.
    const decoded = createBookModel(book, style, 132, 200, 40, 'blob:paint-once', { shelf:true });
    expect(covers()).toBe(4);
    for (const model of [generated, pending, decoded]) model.userData.dispose();
  });

  it('shows a pasted-down endpaper inside the cloth turn-ins only while the board is open', () => {
    canvasContext();
    const model = createBookModel(book, style, 132, 200, 40, null);
    const endpaper = model.getObjectByName('endpaper'), front = model.getObjectByName('front-cover');
    expect(endpaper.visible).toBe(false);
    expect(front.material[2].color.getHexString()).toBe(new THREE.Color(style.color).getHexString());
    model.userData.setCoverOpen(1); model.updateMatrixWorld(true);
    expect(endpaper.visible).toBe(true);
    endpaper.geometry.computeBoundingBox(); front.geometry.computeBoundingBox();
    const paper = endpaper.geometry.boundingBox.clone().applyMatrix4(endpaper.matrixWorld);
    const board = front.geometry.boundingBox.clone().applyMatrix4(front.matrixWorld);
    expect(paper.min.y).toBeGreaterThan(board.min.y); expect(paper.max.y).toBeLessThan(board.max.y);
    expect(paper.min.x).toBeGreaterThan(board.min.x - 1e-6); expect(paper.max.x).toBeLessThan(board.max.x + 1e-6);
    model.userData.setCoverOpen(0);
    expect(endpaper.visible).toBe(false);
    model.userData.dispose();
  });

  it('turns the read leaves over with the board of a lifted book only, and rebuilds them with the bookmark', () => {
    canvasContext();
    const shelf = createBookModel({ ...book, progressFraction:.4 }, style, 132, 200, 40, null, { shelf:true });
    expect(shelf.getObjectByName('read-leaves')).toBeUndefined();
    const model = createBookModel({ ...book, progressFraction:.4 }, style, 132, 200, 40, null);
    const leaves = model.getObjectByName('read-leaves'), hinge = model.getObjectByName('front-cover-hinge');
    expect(leaves.parent).toBe(hinge); expect(leaves.visible).toBe(false);
    model.userData.setCoverOpen(.4); expect(leaves.visible).toBe(true);
    model.userData.setCoverOpen(0); expect(leaves.visible).toBe(false);
    // Fully open, even the thickest gathering leaves the saved page uncovered.
    const thick = createBookModel({ ...book, progressFraction:.9 }, style, 132, 200, 40, null);
    thick.userData.setCoverOpen(1); thick.updateMatrixWorld(true);
    const turned = thick.getObjectByName('read-leaves'), paper = thick.getObjectByName('reading-page');
    const points = turned.geometry.getAttribute('position'), vertex = new THREE.Vector3();
    let right = -Infinity;
    for (let i = 0; i < points.count; i++) right = Math.max(right, vertex.fromBufferAttribute(points, i).applyMatrix4(turned.matrixWorld).x);
    expect(right).toBeLessThan(paper.position.x - paper.geometry.parameters.width / 2);
    thick.userData.dispose();
    const depth = () => { leaves.geometry.computeBoundingBox(); return leaves.geometry.boundingBox.max.z - leaves.geometry.boundingBox.min.z; };
    const before = depth(), geometry = leaves.geometry, release = vi.spyOn(geometry, 'dispose');
    model.userData.updateBookmark({ ...book, progressFraction:.1 });
    expect(release).toHaveBeenCalledOnce(); expect(depth()).toBeLessThan(before);
    const disposals = [leaves.geometry, ...leaves.material, leaves.material[0].map].map(resource => vi.spyOn(resource, 'dispose'));
    model.userData.dispose(); shelf.userData.dispose();
    for (const spy of disposals) expect(spy).toHaveBeenCalledOnce();
  });

  it('keeps the grazing sheen and satin anisotropy for the lifted book, never for shelf copies', () => {
    canvasContext();
    const shelfCopy = createBookModel({ ...book, progressFraction:.4 }, style, 132, 200, 40, null, { shelf:true });
    const lifted = createBookModel({ ...book, progressFraction:.4 }, style, 132, 200, 40, null);
    const ribbon = model => model.getObjectByName('reading-bookmark').material;
    expect(shelfCopy.getObjectByName('binding').material.sheen).toBe(0);
    expect(ribbon(shelfCopy).sheen).toBe(0); expect(ribbon(shelfCopy).anisotropy).toBe(0);
    expect(lifted.getObjectByName('binding').material.sheen).toBeGreaterThan(0);
    expect(ribbon(lifted).sheen).toBeGreaterThan(0); expect(ribbon(lifted).anisotropy).toBeGreaterThan(0);
    shelfCopy.userData.dispose(); lifted.userData.dispose();
  });

  it('gives the turned leaves and the page margin the paper of the saved page', () => {
    const context = canvasContext();
    const model = createBookModel({ ...book, progressFraction:.4 }, style, 132, 200, 40, null);
    const leaves = model.getObjectByName('read-leaves').material[0], margin = model.getObjectByName('reading-page-paper').material;
    const cream = leaves.color.clone(), creamMargin = margin.color.clone();
    const ring = rgb => (_x, _y, w, h) => ({ data:Uint8ClampedArray.from({ length:w * h * 4 }, (_, i) => i % 4 === 3 ? 255 : rgb(i >> 2)[i % 4]) });
    const page = () => Object.assign(document.createElement('canvas'), { width:400, height:600 });
    // A full-bleed picture has no paper margin: the default paper stays.
    context.getImageData.mockImplementation(ring(p => p % 2 ? [20, 30, 200] : [240, 220, 40]));
    model.userData.setPageSnapshot({ source:page(), width:400, height:600 });
    expect(leaves.color.equals(cream)).toBe(true); expect(margin.color.equals(creamMargin)).toBe(true);
    // A white PDF page: the margin is exactly white, the lit leaf is lifted to match it.
    context.getImageData.mockImplementation(ring(() => [255, 255, 255]));
    model.userData.setPageSnapshot({ source:page(), width:400, height:600 });
    expect(margin.color.getHexString()).toBe('ffffff');
    expect(leaves.color.g).toBeGreaterThan(cream.g); expect(leaves.toneMapped).toBe(false);
    model.userData.dispose();
  });

  it('lays out each spine per book, never per colour, with every kind of case in a library', () => {
    const kinds = new Set();
    for (let i = 0; i < 40; i++) {
      const layout = spineLayout({ id:`b${i}`, title:`Libro ${i}` });
      expect(spineLayout({ id:`b${i}`, title:`Libro ${i}` })).toEqual(layout);
      kinds.add(layout.kind);
      for (const [y] of layout.rules) { expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(1024); }
      expect(layout.span[0]).toBeLessThan(layout.span[1]);
    }
    expect([...kinds].sort()).toEqual(['banded', 'panel', 'plain', 'ruled']);
  });

  it('gives each model its own clone of shared procedural detail and releases only that clone', () => {
    canvasContext();
    const first = createBookModel({ ...book, progressFraction:.5 }, style, 132, 200, 40, null);
    const second = createBookModel({ ...book, progressFraction:.5 }, style, 132, 200, 40, null);
    const pages = model => model.getObjectByName('page-block').material[0].map;
    const ribbon = model => model.getObjectByName('reading-bookmark').material.alphaMap;
    const cloth = model => model.getObjectByName('back-cover').material.normalMap;
    for (const texture of [pages, ribbon, cloth]) {
      expect(texture(first)).not.toBe(texture(second));
      expect(texture(first).source).toBe(texture(second).source);
    }
    const kept = [pages, ribbon, cloth].map(texture => vi.spyOn(texture(second), 'dispose'));
    const released = [pages, ribbon, cloth].map(texture => vi.spyOn(texture(first), 'dispose'));
    first.userData.dispose();
    for (const spy of released) expect(spy).toHaveBeenCalledOnce();
    for (const spy of kept) expect(spy).not.toHaveBeenCalled();
    second.userData.dispose();
  });
});

describe('spine surface scratch rasters', () => {
  const book = { id:'scratch-1', title:'Scratch', author:'Author' };
  const style = { color:'#42604b', ink:'#ffffff', width:40 };
  const shelf = { textureWidth:256, textureHeight:1024, level:'shelf' };
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  function recordingCanvases() {
    const log = [], attributes = [];
    const context = new Proxy({
      measureText: text => ({ width:String(text).length * 16 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      reset: vi.fn(() => log.push('reset')), fillText: vi.fn(() => log.push('fillText')),
      getImageData: vi.fn((_x, _y, width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }))
    }, { get: (target, key) => target[key] ?? (() => {}) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((_type, options) => { attributes.push(options); return context; });
    const make = document.createElement.bind(document), created = [];
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      const element = make(tag);
      if (tag === 'canvas') created.push(element);
      return element;
    });
    const bigCanvases = () => created.filter(canvas => canvas.width === 256 && canvas.height === 1024).length;
    return { context, log, attributes, bigCanvases };
  }

  it('reuses the glyph mask and ink rasters instead of allocating two full-size canvases per spine', () => {
    const { context, bigCanvases } = recordingCanvases();
    releaseSurface(spineSurface(book, style, 200, 32, shelf));
    // mask, colour, ink, packed
    expect(bigCanvases()).toBe(4);
    releaseSurface(spineSurface({ ...book, id:'scratch-2' }, style, 200, 32, shelf));
    expect(bigCanvases()).toBe(6);
    expect(context.reset).toHaveBeenCalledTimes(2);
    // another size is a different raster
    releaseSurface(spineSurface(book, style, 200, 32, { ...shelf, textureHeight:512 }));
    expect(context.reset).toHaveBeenCalledTimes(2);
  });

  it('wipes the reused canvases before the next book is lettered', () => {
    const { log } = recordingCanvases();
    releaseSurface(spineSurface(book, style, 200, 32, shelf));
    log.length = 0;
    releaseSurface(spineSurface({ ...book, id:'scratch-2', title:'Another' }, style, 200, 32, shelf));
    expect(log.indexOf('reset')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('reset')).toBeLessThan(log.indexOf('fillText'));
  });

  it('keeps relief rasters on the CPU and apart from the plain mask', () => {
    const { attributes, bigCanvases } = recordingCanvases();
    releaseSurface(spineSurface({ ...book, spineEngraved:true }, style, 200, 32, shelf));
    expect(attributes.filter(options => options?.willReadFrequently).length).toBe(2);
    releaseSurface(spineSurface(book, style, 200, 32, shelf));
    const before = bigCanvases();
    releaseSurface(spineSurface({ ...book, spineEngraved:true }, style, 200, 32, shelf));
    // engraved again: its CPU mask and sample are held, only colour and packed are new
    expect(bigCanvases() - before).toBe(2);
  });

  it('lets the scratch rasters go when the task that built the spines ends', async () => {
    const { bigCanvases } = recordingCanvases();
    releaseSurface(spineSurface(book, style, 200, 32, shelf));
    await Promise.resolve();
    const before = bigCanvases();
    releaseSurface(spineSurface(book, style, 200, 32, shelf));
    expect(bigCanvases() - before).toBe(4);
  });
});
