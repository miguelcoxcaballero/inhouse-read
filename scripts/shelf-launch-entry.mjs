// Keep the local first paint in its own module graph. Vite normally combines
// all HTML module scripts into main, whose mandatory WASM imports would make
// the preview wait behind the very initialization it is meant to cover.
export function shelfLaunchEntry(entry) {
  let production = false, base;
  return {
    name:'inhouse-shelf-launch-entry',
    configResolved(config) { production = config.command === 'build'; base = config.base; },
    buildStart() { if (production) this.emitFile({ type:'chunk', id:entry, name:'shelf-launch' }); },
    transformIndexHtml: {
      order:'post',
      handler(_html, context) {
        if (!context.filename.endsWith('/index.html')) return;
        const chunk = production && Object.values(context.bundle || {}).find(file => file.type === 'chunk' && file.facadeModuleId === entry);
        if (production && !chunk) throw new Error('Missing independent shelf launch module');
        return [{ tag:'script', attrs:{ type:'module', crossorigin:true,
          src:production ? `${base}${chunk.fileName}` : '/src/js/shelf-launch-preview.js' }, injectTo:'head' }];
      }
    }
  };
}
