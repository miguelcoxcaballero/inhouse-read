const clamp=value=>Math.min(1,Math.max(0,value));
export function lampSurface(kind,width,height) {
    const pigment = new Uint8Array(width * height * 4), data = new Uint8Array(pigment.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height, index = (y * width + x) * 4;
      const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1;
      let colour, relief, roughness;
      if (kind === 'wood') {
        const warp = Math.sin(v * 13 + u * 7) * .013 + Math.sin(v * 47) * .004;
        const fibre = Math.sin((u + warp) * Math.PI * 72);
        const grain = Math.sin((u + warp) * Math.PI * 17) * .045 + fibre * .025 + noise * .012;
        const pore = Math.max(0,fibre - .87) * .13;
        colour = [.73 + grain - pore,.55 + grain * .84 - pore,.34 + grain * .62 - pore];
        relief = .5 + fibre * .17; roughness = .63 + noise * .045;
      } else if (kind === 'linen') {
        const threadX = Math.cos(u * Math.PI * 160), threadY = Math.cos(v * Math.PI * 160);
        const weave = threadX * threadY * .025 + (threadX + threadY) * .012;
        const slub = Math.sin(u * 105 + Math.sin(v * 19)) * .01;
        colour = [.92 + weave + slub,.862 + weave + slub,.745 + weave + slub];
        relief = .5 + (threadX + threadY) * .18 + noise * .025;
        roughness = .9 + noise * .025;
      } else {
        const grain = noise * .012;
        colour = [.087 + grain,.091 + grain,.09 + grain];
        relief = .5 + noise * .035; roughness = .42 + noise * .055;
      }
      for (let channel = 0; channel < 3; channel++) pigment[index + channel] = Math.round(clamp(colour[channel]) * 255);
      pigment[index + 3] = data[index + 3] = 255;
      data[index] = Math.round(clamp(relief) * 255); data[index + 1] = Math.round(clamp(roughness) * 255);
    }

return {width,height,pigment,data};
}
