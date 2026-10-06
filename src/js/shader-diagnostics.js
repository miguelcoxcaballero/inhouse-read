/** Shader logs are synchronous driver queries on first use. Production
 * rendering keeps the exact same programs and uniforms without fetching
 * development logs. An installed error hook retains its diagnostics. */
export function configureShaderDiagnostics(renderer, production = import.meta.env?.PROD) {
  if (production === true && renderer?.debug && typeof renderer.debug.onShaderError !== 'function')
    renderer.debug.checkShaderErrors = false;
  return renderer;
}

