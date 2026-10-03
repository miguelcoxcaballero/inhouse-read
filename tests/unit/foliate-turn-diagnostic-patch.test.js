import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {patchFoliateBackground} from '../../scripts/foliate-background-patch.mjs';
import {patchFoliateTurnDiagnostics} from '../../scripts/foliate-turn-diagnostic-patch.mjs';
const before=patchFoliateBackground(readFileSync('node_modules/foliate-js/paginator.js','utf8')).replaceAll('\r\n','\n');
const after=patchFoliateTurnDiagnostics(before);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const method=(name,next)=>{const start=after.indexOf(`    ${name}`),end=after.indexOf(`    ${next}`,start);if(start<0||end<0)throw new Error('Missing real paginator method');return after.slice(start,end)};
function displayProbe(){
  const section=deferred(),frame=deferred(),anchor=deferred(),doc={readyState:'loading',head:null,hasFocus:()=>false};
  const view={document:doc,load:vi.fn(async(src,onLoad)=>{await frame.promise;doc.readyState='complete';onLoad(doc)})};
  const Probe=new Function('view','section','anchor',`return class extends EventTarget{
    #index=0;#view=view;#styleMap=new Map();#styles='';sections=[{unload(){}},{load:()=>section.promise}];
    #createView(){return this.#view=view}#beforeRender(){}setStyles(){}focusView(){}
    scrollToAnchor(){return anchor.promise}
    ${method('get inhouseReadTurnDiagnostic()','getContents()')}
    ${method('async #display(promise)','#canGoToIndex(index)')}
    ${method('async #goTo({ index, anchor, select })','async goTo(target)')}
    display(value){return this.#display(value)}go(){return this.#goTo({index:1,anchor:0})}
  }`)(view,section,anchor);
  return {paginator:new Probe(),section,frame,anchor,view};
}
describe('passive Foliate navigation stage observation',()=>{
  it('preserves all await/task/animation scheduling statements and rejects unknown or duplicate signatures',()=>{
    for(const token of [/\bawait\b/g,/setTimeout\(/g,/queueMicrotask\(/g,/requestAnimationFrame\(/g,/\.then\(/g])expect([...after.matchAll(token)].length).toBe([...before.matchAll(token)].length);
    expect(()=>patchFoliateTurnDiagnostics(before.replace('await view.load(src, afterLoad, beforeRender)','await changed()'))).toThrow(/Unexpected/);
    expect(()=>patchFoliateTurnDiagnostics(before+before)).toThrow(/Unexpected/);
    expect(()=>patchFoliateTurnDiagnostics(after)).toThrow(/Unexpected/);
  });
  it('distinguishes the actual section promise from frame loading and anchor completion',async()=>{
    const h=displayProbe(),done=vi.fn();h.paginator.go().then(done);await drain();
    expect(h.paginator.inhouseReadTurnDiagnostic).toMatchObject({displayStage:1,sectionLoadPending:true,viewLoadPending:false});expect(h.view.load).not.toHaveBeenCalled();
    h.section.resolve('blob:real-section');await drain();
    expect(h.paginator.inhouseReadTurnDiagnostic).toMatchObject({displayStage:3,sectionLoadPending:false,viewLoadPending:true,viewReady:1});expect(done).not.toHaveBeenCalled();expect(h.view.load).toHaveBeenCalledOnce();
    h.frame.resolve();await drain();
    expect(h.paginator.inhouseReadTurnDiagnostic).toMatchObject({displayStage:5,viewLoadPending:false,viewReady:3});expect(done).not.toHaveBeenCalled();
    h.anchor.resolve();await drain();expect(done).toHaveBeenCalledOnce();expect(h.paginator.inhouseReadTurnDiagnostic.displayStage).toBe(0);
  });
  it('reading the diagnostic getter neither settles nor invokes the pending section or frame',async()=>{
    const h=displayProbe(),done=vi.fn();h.paginator.go().then(done);await drain();
    const first=h.paginator.inhouseReadTurnDiagnostic;
    for(let i=0;i<20;i++)expect(h.paginator.inhouseReadTurnDiagnostic).toEqual(first);
    expect(done).not.toHaveBeenCalled();expect(h.view.load).not.toHaveBeenCalled();
    h.section.resolve('blob:real-section');await drain();
    for(let i=0;i<20;i++)expect(h.paginator.inhouseReadTurnDiagnostic.displayStage).toBe(3);
    expect(done).not.toHaveBeenCalled();expect(h.view.load).toHaveBeenCalledOnce();
    h.frame.resolve();h.anchor.resolve();await drain();expect(done).toHaveBeenCalledOnce();
  });
  it('marks the existing scroll and chapter await without releasing the navigation lock early',async()=>{
    const scroll=deferred(),chapter=deferred();
    const turn=method('async #turnPage(dir, distance)','async prev(distance)');
    const Probe=new Function('scroll','chapter',`const waitForPageCooldown=()=>Promise.resolve();return class{
      #locked=false;#scrollNext(){return scroll.promise}#scrollPrev(){return scroll.promise}
      #adjacentIndex(){return 1}#goTo(){return chapter.promise}hasAttribute(){return false}
      ${turn}next(){return this.#turnPage(1)}get locked(){return this.#locked}
    }`)(scroll,chapter),p=new Probe(),done=vi.fn();
    p.next().then(done);await drain();expect(p.inhouseReadTurnStage).toBe(1);expect(p.locked).toBe(true);
    scroll.resolve(true);await drain();expect(p.inhouseReadTurnStage).toBe(2);expect(p.locked).toBe(true);expect(done).not.toHaveBeenCalled();
    chapter.resolve();await drain();expect(p.inhouseReadTurnStage).toBe(0);expect(p.locked).toBe(false);expect(done).toHaveBeenCalledOnce();
  });
  it('limits the public getter to numeric stages and boolean pending flags',()=>{
    const getter=method('get inhouseReadTurnDiagnostic()','getContents()');
    expect(getter).not.toMatch(/await|dispatchEvent|setTimeout|requestAnimationFrame|\.then\(|load\(/);
    for(const secret of ['textContent','outerHTML','location','src','getCFI','metadata'])expect(getter).not.toContain(secret);
  });
});
