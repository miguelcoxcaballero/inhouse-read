import { describe, expect, it } from 'vitest';
import { configureShaderDiagnostics } from '../../src/js/shader-diagnostics.js';

describe('production shader diagnostics', () => {
  it('disables synchronous shader logs only in production', () => {
    const renderer={debug:{checkShaderErrors:true,onShaderError:null},toneMapping:5,outputColorSpace:'srgb'};
    expect(configureShaderDiagnostics(renderer,true)).toBe(renderer);
    expect(renderer).toEqual({debug:{checkShaderErrors:false,onShaderError:null},toneMapping:5,outputColorSpace:'srgb'});
  });
  it('keeps development diagnostics enabled', () => {
    const renderer={debug:{checkShaderErrors:true,onShaderError:null}};
    configureShaderDiagnostics(renderer,false);expect(renderer.debug.checkShaderErrors).toBe(true);
  });
  it('preserves an installed shader error handler', () => {
    const onShaderError=()=>{};const renderer={debug:{checkShaderErrors:true,onShaderError}};
    configureShaderDiagnostics(renderer,true);expect(renderer.debug).toEqual({checkShaderErrors:true,onShaderError});
  });
  it('keeps an existing disabled setting in development', () => {
    const renderer={debug:{checkShaderErrors:false}};
    configureShaderDiagnostics(renderer,false);expect(renderer.debug.checkShaderErrors).toBe(false);
  });
  it('accepts renderers without the diagnostics interface', () => {
    const renderer={toneMapping:5};expect(configureShaderDiagnostics(renderer,true)).toBe(renderer);
    expect(renderer).toEqual({toneMapping:5});expect(configureShaderDiagnostics(null,true)).toBeNull();
  });
  it('requires the explicit production boolean', () => {
    for(const value of [0,1,'true',null]){
      const renderer={debug:{checkShaderErrors:true}};configureShaderDiagnostics(renderer,value);
      expect(renderer.debug.checkShaderErrors).toBe(true);
    }
  });
});
