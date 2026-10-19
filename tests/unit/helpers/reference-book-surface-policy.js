// Frozen dye and paper blend from d80acb4c; Three conversions stay unchanged.
import * as THREE from "three";
function lattice(i,j,salt) {
 let h=Math.imul((i*374761393+j*668265263+salt*1442695041)>>>0,1274126177);
 h=Math.imul(h^(h>>>13),1103515245);
 return ((h^(h>>>16))>>>0)/4294967296;
}
const RIBBON_SILKS = ['#7c1c26', '#7c1c26', '#7c1c26', '#1d4030', '#22305a', '#4c2244', '#823a1f', '#a8322b'];
export function ribbonSilk(seed, cloth, finished = false) {
  if (finished) return '#c29a4c';
  const hex = new THREE.Color(cloth ?? '#555').getHex(), rgb = [hex >> 16, hex >> 8 & 255, hex & 255];
  // Weighted sRGB distance: green differences read strongest, then blue.
  const apart = silk => {
    const s = parseInt(silk.slice(1), 16), d = [s >> 16, s >> 8 & 255, s & 255].map((v, i) => (v - rgb[i]) / 255);
    return Math.sqrt(2 * d[0] ** 2 + 4 * d[1] ** 2 + 3 * d[2] ** 2);
  };
  const clear = RIBBON_SILKS.filter(silk => apart(silk) > .55);
  // A cloth close to every dye still gets the one that differs most.
  if (!clear.length) return RIBBON_SILKS.reduce((best, silk) => apart(silk) > apart(best) ? silk : best);
  return clear[Math.floor(lattice(seed % 65521, 9, 23) * clear.length)];
}

const toneScratch={a:{},b:{}};
export function mixPaperTone(target, stock, theme, mix) {
  const k = Math.max(0, Math.min(1, Number(mix)));
  if (!stock && !theme) return null;
  if (!stock) return target.copy(theme);
  if (!theme) return target.copy(stock);
  if (!(k > 0)) return target.copy(stock);
  if (!(k < 1)) return target.copy(theme);
  const a = stock.getRGB(toneScratch.a, THREE.SRGBColorSpace), b = theme.getRGB(toneScratch.b, THREE.SRGBColorSpace);
  return target.setRGB(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, THREE.SRGBColorSpace);
}
