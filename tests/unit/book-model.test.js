import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { bindingGeometry, boardGeometry, bookmarkGeometry, sampleBookMotion, fitCoverImage, createBookModel, projectBookPageBounds, planBookPageZoom } from '../../src/js/book-model.js';

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
  it('lies above the exposed reading page and withdraws upward without scaling', () => {
    const open = bookmarkGeometry(132, 200, 40, .8, 17, { open:1 });
    const removed = bookmarkGeometry(132, 200, 40, .8, 17, { open:1, withdraw:1 });
    const a = open.getAttribute('position'), b = removed.getAttribute('position');
    for (let i = 0; i < a.count / 2; i++) expect(a.getZ(i)).toBeGreaterThan(20 - 200 * .0083);
    for (let i = 0; i < a.count; i++) {
      expect(b.getY(i) - a.getY(i)).toBeCloseTo(250);
      expect(b.getX(i)).toBeCloseTo(a.getX(i));
      expect(b.getZ(i)).toBeCloseTo(a.getZ(i));
    }
    open.dispose(); removed.dispose();
  });
})

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
    expect(lifted.getObjectByName('front-cover').material[0].map.image.height).toBe(2048);
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
});
