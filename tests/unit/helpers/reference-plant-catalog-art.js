// Frozen reference of the pre-Rust catalogue illustrations (removed from src in 1.7.237). Tests only.
const SVG_NS = 'http://www.w3.org/2000/svg';
// After the next frame has painted: the frame's rAF callbacks run before it, a timer after.

// Keep closed white silhouettes separate from open detail strokes: filling an
// open vein or rib makes SVG close it with an unintended diagonal edge.
const detail = d => `<path fill="none" stroke-width="1" d="${d}"/>`;
const outline = d => `<path fill="white" d="${d}"/>`;

function leaf(x, y, width, height, angle = 0, veins = true) {
  return `<g transform="translate(${x} ${y}) rotate(${angle})">${outline(`M0 0C${-width*.85} ${-height*.22} ${-width*.75} ${-height*.73} 0 ${-height}C${width*.66} ${-height*.76} ${width*.8} ${-height*.24} 0 0Z`)}${veins ? detail(`M0 -2Q${width*.06} ${-height*.48} 0 ${-height*.86}`) : ''}</g>`;
}

function potDrawing(id = 'muskot', { compact = false } = {}) {
  let body, lines;
  if (id === 'akerbar') {
    body = 'M55 146L61 177Q80 184 99 177L105 146Z';
    lines = 'M61 174Q80 181 99 174M99 151L95 173';
  } else if (id === 'muskotblomma') {
    body = 'M54 146L63 177Q80 184 97 177L106 146Z';
    lines = 'M56 152Q80 160 104 152';
  } else if (id === 'gradvis') {
    body = 'M56 146C56 160 57 174 64 179Q80 188 96 179C103 174 104 160 104 146Z';
    lines = 'M61 152Q61 170 67 179M68 154Q68 174 73 182M76 155L77 183M84 155L83 183M92 154Q92 174 87 182M99 152Q99 170 93 179';
  } else {
    body = 'M54 146L60 175Q61 181 80 183Q99 181 100 175L106 146Z';
    lines = compact ? 'M58 163Q80 173 102 163M60 172Q80 182 100 172'
      : 'M58 161Q80 171 102 161M59 166Q80 176 101 166M60 171Q80 181 100 171M61 176Q80 185 99 176';
  }
  const saucer = id === 'muskotblomma' ? `${outline('M50 183Q80 174 110 183L109 187Q80 196 51 187Z')}${detail('M51 183Q80 191 109 183')}` : '';
  // The front lip uses its own lower arc, never two competing ellipses.
  return `${saucer}${outline(body)}${detail(lines)}<ellipse fill="white" cx="80" cy="146" rx="${id === 'gradvis' ? 24 : id === 'akerbar' ? 25 : 26}" ry="5"/>${detail('M58 146Q80 152 102 146')}`;
}

function plantDrawing(id, { compact = false } = {}) {
  if (id === 'sansevieria') {
    return [[64,66,-18],[93,62,17],[71,37,-10],[87,30,9],[78,18,-2]].map(([x,tip,bend]) => {
      const contour = `M${x-4} 147C${x-7} 117 ${x+bend-6} ${tip+30} ${x+bend} ${tip}C${x+bend+5} ${tip+26} ${x+5} 116 ${x+4} 147Z`;
      return `${outline(contour)}${detail(`M${x} 142Q${x+bend-2} 82 ${x+bend} ${tip+13}`)}`;
    }).join('');
  }
  if (id === 'monstera') {
    const stems = detail('M78 147Q72 123 58 109M80 147Q94 128 106 117M79 146Q74 108 66 78M81 146Q87 107 94 80');
    const contour = 'M0 0C-9 7-28 0-29-14Q-31-23-26-30C-23-30-15-23-13-27Q-17-33-25-36Q-26-42-21-46C-17-46-12-38-9-40Q-12-49-17-51Q-10-60 0-64Q10-60 17-51Q12-49 9-40C12-38 17-46 21-46Q26-42 25-36Q17-33 13-27C15-23 23-30 26-30Q31-23 29-14C28 0 9 7 0 0Z';
    return stems + [[58,109,28,58,-33],[106,117,28,62,35],[66,78,24,56,-22],[94,80,27,65,25]].map(([x,y,w,h,a]) =>
      `<g transform="translate(${x} ${y}) rotate(${a}) scale(${w/30} ${h/64})">${outline(contour)}${detail('M0 0Q-1-29 0-55')}${compact ? '' : '<ellipse fill="none" stroke-width="1" cx="-7" cy="-19" rx="2.5" ry="4.5"/><ellipse fill="none" stroke-width="1" cx="7" cy="-19" rx="2.5" ry="4.5"/>'}</g>`).join('');
  }
  if (id === 'chamaedorea' || id === 'nephrolepis') {
    const fern = id === 'nephrolepis';
    // Fewer fronds at thumbnail scale, with separated, tapering leaflets.
    const fronds = fern ? [[-66,77],[-39,95],[-12,107],[17,102],[46,88],[70,71]] : [[-55,86],[-29,111],[0,126],[30,108],[57,83]];
    return fronds.map(([angle,length]) => {
      const pairs = fern ? (compact ? 7 : 10) : (compact ? 6 : 8);
      const foliage = Array.from({length:pairs},(_,j) => {
        const f = (j+1)/(pairs+1), y = -length*f;
        const size = Math.sin(f*Math.PI)**.7*(fern ? 15 : 23);
        return leaf(0,y,size*.23,size, -62,false)+leaf(0,y-2,size*.23,size,62,false);
      }).join('');
      return `<g transform="translate(80 146) rotate(${angle})">${detail(`M0 0Q-3 ${-length*.55} 0 ${-length}`)}${foliage}${leaf(0,-length+10,2.5,13,0,false)}</g>`;
    }).join('');
  }
  if (id === 'hedera') {
    const vines = [[68,142,-28,-56],[78,142,-7,-111],[88,142,36,-69],[99,140,32,22],[60,140,-31,25]];
    const silhouette = 'M0 0Q-5-3-12-4L-8-12L-13-18L-4-17L0-28L5-17L13-18L9-11L12-4Q5-3 0 0Z';
    return vines.map(([x,y,dx,dy],index) => detail(`M${x} ${y}Q${x+dx*.55} ${y+dy*.5} ${x+dx} ${y+dy}`) + Array.from({length:compact ? 3 : 4},(_,j) => {
      const f = (j+1)/(compact ? 3 : 4), lx=x+dx*f, ly=y+dy*f;
      return `<g transform="translate(${lx} ${ly}) rotate(${(j%2 ? 30 : -28)+index*4})">${outline(silhouette)}${detail(compact ? 'M0-2V-23' : 'M0-2V-23M0-12L-8-17M0-12L8-17')}</g>`;
    }).join('')).join('');
  }
  if (id === 'zamioculcas') {
    return [[64,144,-25,86],[79,145,-7,116],[90,144,17,106],[101,143,32,78]].map(([x,y,angle,length]) => {
      const pairs = compact ? 4 : 5;
      return `<g transform="translate(${x} ${y}) rotate(${angle})">${detail(`M0 0Q-2 ${-length*.55} 0 ${-length}`)}${Array.from({length:pairs},(_,j) => {
        const yy=-length*(j+1)/(pairs+1), size=1-j*.075;
        return leaf(0,yy,9*size,22*size,-57,!compact)+leaf(0,yy-3,9*size,22*size,57,!compact);
      }).join('')}${leaf(0,-length+8,6,17,0,!compact)}</g>`;
    }).join('');
  }
  if (id === 'succulent') {
    // A rosette seen from the front: layered fleshy leaves, no wheel of
    // superimposed radial outlines that turns into a dark knot at icon size.
    const layers = [[[-48,38,16],[-25,48,16],[0,53,15],[27,48,16],[51,37,16]],
      [[-65,26,17],[-34,35,17],[0,38,16],[35,34,17],[65,25,17]],
      [[-52,19,15],[0,24,14],[51,19,15]]];
    return layers.map((row,tier) => row.map(([a,h,w])=>leaf(80,145-tier*2,w,h,a,!compact)).join('')).join('');
  }
  if (id === 'cactus') {
    return [[59,147,11,55],[100,147,11,47],[80,147,14,105]].map(([x,y,r,h]) => {
      const body = `M${-r} 0V${-h+r}A${r} ${r} 0 0 1 ${r} ${-h+r}V0Z`;
      const ribs = `M${-r*.45} -3V${-h+r+2}M0 -3V${-h+7}M${r*.45} -3V${-h+r+2}`;
      const spines = Array.from({length:compact ? 4 : 6},(_,i) => {
        const yy=-12-i*(h-28)/(compact ? 4 : 6);
        return detail(`M${-r-1} ${yy}l-3-2M${r+1} ${yy-3}l3-2`);
      }).join('');
      return `<g transform="translate(${x} ${y})">${outline(body)}${detail(ribs)}${spines}</g>`;
    }).join('');
  }
  return plantDrawing('monstera',{compact});
}

/** Opaque silhouettes hide rear stems; fine open strokes describe the surface. */
export function plantCatalogIllustration(catalogId, potId = 'muskot', { potOnly = false, compact = false } = {}) {
  const viewBox = potOnly ? '42 136 76 62' : '0 0 160 200';
  return `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="${compact ? 1.65 : 1.3}" stroke-linecap="round" stroke-linejoin="round">${potOnly ? '' : plantDrawing(catalogId,{compact})}${potDrawing(potId,{compact})}</svg>`;
}
