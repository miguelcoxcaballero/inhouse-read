import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';

const scene = vi.hoisted(() => ({ hitTrash:vi.fn(), animateObjectToTrash:vi.fn() }));
vi.mock('../../src/js/book-model.js',async importOriginal => ({
  ...await importOriginal(), getBookRenderer:() => ({})
}));
vi.mock('../../src/js/bookshelf-scene.js',() => ({ createBookshelfScene:() => ({
  ...scene, dispose:vi.fn(), updateLayout:vi.fn(), flush:vi.fn(),
  getObjectAtPoint:() => document.querySelector('[data-object-id="plant:held"]'),
  getDropPosition:() => null, setTrashHover:vi.fn(), setDropPosition:vi.fn(), previewPlacements:vi.fn()
}) }));

const KEY='inhouse-read-shelf-plants';
let container,shelf;
function pointer(node,type,x=330,y=720) {
  const event=new MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true});
  Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'touch'}});
  node.dispatchEvent(event);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('WebGLRenderingContext',function WebGLRenderingContext() {});
  localStorage.setItem(KEY,JSON.stringify([
    {key:'plant:held',seed:'held',variant:'monstera',catalogId:'monstera',potId:'muskot',width:86,height:110,shelf:0,x:.45}
  ]));
  scene.animateObjectToTrash.mockImplementation(() => ({finished:Promise.resolve(true),cancel:vi.fn()}));
  container=document.createElement('div'); document.body.append(container);
  shelf=renderBookshelf(container,[],{shelfWidth:390,viewMode:'isometric'});
});
afterEach(() => {
  shelf?.destroy(); container.remove(); localStorage.clear();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('plant release at the physical floor',() => {
  it('lets the scene refresh a stale hidden bin before testing the touch release',async () => {
    const plant=container.querySelector('.ihr-plant'),bin=container.querySelector('.ihr-shelf-trash');
    scene.hitTrash.mockImplementation(() => {bin.hidden=false;return true});
    pointer(plant,'pointerdown',150,400);
    await vi.advanceTimersByTimeAsync(450);
    bin.hidden=true;
    pointer(plant,'pointermove');
    expect(scene.hitTrash).toHaveBeenCalledOnce();
    bin.hidden=true; // pointerup arrives before the queued scroll frame paints
    pointer(plant,'pointerup');
    await vi.advanceTimersByTimeAsync(30);
    expect(scene.hitTrash).toHaveBeenCalledTimes(2);
    expect(scene.animateObjectToTrash).toHaveBeenCalledWith(plant,expect.any(Object));
    expect(container.querySelector('.ihr-plant')).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([]);
    expect(container.querySelector('.ihr-bookshelf').classList.contains('is-arranging')).toBe(false);
  });
  it('keeps the plant when the scene confirms the release is outside the bin',async () => {
    const plant=container.querySelector('.ihr-plant'),bin=container.querySelector('.ihr-shelf-trash');
    scene.hitTrash.mockReturnValue(false); bin.hidden=false;
    pointer(plant,'pointerdown',150,400);
    await vi.advanceTimersByTimeAsync(450);
    pointer(plant,'pointermove'); pointer(plant,'pointerup');
    await vi.advanceTimersByTimeAsync(30);
    expect(scene.hitTrash).toHaveBeenCalledTimes(2);
    expect(scene.animateObjectToTrash).not.toHaveBeenCalled();
    expect(container.querySelector('.ihr-plant')).toBe(plant);
    expect(JSON.parse(localStorage.getItem(KEY))).toHaveLength(1);
  });
});
