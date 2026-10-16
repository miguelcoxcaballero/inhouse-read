// Frozen verbatim from src/js/book-model.js at 67e091dc2245d7655c82df310ada7f6624ec0c11 (1.7.245),
// before these textures were painted by the shelf module (rust-ui/src/book_paint.rs). The canvas
// and the Three texture around each painter are not part of the subject: each takes the 2D
// context (and, for the cloth case, the pieces the host computed) instead.
const seededRandom = seed => {
  let s = seed >>> 0 || 1;
  return () => {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};
function withStops(gradient, stops) {
  for (const [at, value] of stops) gradient?.addColorStop?.(at, value);
  return gradient;
}

export function referencePageEdges(c, size) {
  const random = seededRandom(size * 131 + 7), unit = size / 256;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, size, size);
  const leaf = (x, style, weight) => {
    const phase = random() * Math.PI * 2, amplitude = (.25 + random() * .55) * unit;
    c.strokeStyle = style; c.lineWidth = weight;
    for (const offset of [0, -size]) {
      c.beginPath();
      for (let y = 0; y <= size; y += 8 * unit) {
        const px = x + offset + Math.sin(y / size * Math.PI * 5 + phase) * amplitude;
        if (y) c.lineTo(px, y); else c.moveTo(px, y);
      }
      c.stroke();
    }
  };
  for (let x = 0; x < size; x += (1.1 + random() * 1.5) * unit) {
    const tone = random();
    leaf(x, tone > .74 ? `rgba(108,108,108,${.08 + random() * .12})`
      : tone > .32 ? `rgba(255,255,255,${.22 + random() * .34})` : `rgba(150,150,150,${.05 + random() * .08})`,
    (.45 + random() * .6) * unit);
  }
  for (let x = random() * 18 * unit; x < size; x += (20 + random() * 18) * unit) {
    leaf(x, `rgba(88,88,88,${.16 + random() * .14})`, 1.15 * unit);
  }
  // Head/tail: the gutter falls into shadow where the leaves bend into the spine.
  c.fillStyle = withStops(c.createLinearGradient(0, size * .02, 0, size * .2),
    [[0, 'rgba(64,64,64,.34)'], [.45, 'rgba(64,64,64,.1)'], [1, 'rgba(64,64,64,0)']]);
  c.fillRect(0, 0, size, size * .2);
  // Dust settles on both ends of the fore-edge first.
  for (const [from, to] of [[size * .54, size * .6], [size * .98, size * .92]]) {
    c.fillStyle = withStops(c.createLinearGradient(0, from, 0, to), [[0, 'rgba(100,100,100,.16)'], [1, 'rgba(100,100,100,0)']]);
    c.fillRect(0, Math.min(from, to), size, Math.abs(to - from));
  }
  c.fillStyle = '#ffffff'; c.fillRect(0, size * .47, size, size * .06);
  // Headband: two-tone silk wound over a cord, rounded by its own shading.
  const band = size * .016, stripe = 4 * unit;
  for (let x = 0, i = 0; x < size; x += stripe, i++) {
    c.fillStyle = i % 2 ? '#f6f6f6' : '#7b1f28';
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + stripe, 0); c.lineTo(x + stripe * 1.6, size * .02 + band);
    c.lineTo(x + stripe * .6, size * .02 + band); c.closePath(); c.fill();
  }
  c.fillStyle = withStops(c.createLinearGradient(0, size * .02, 0, size * .02 + band),
    [[0, 'rgba(0,0,0,.35)'], [.45, 'rgba(255,255,255,.12)'], [1, 'rgba(0,0,0,.45)']]);
  c.fillRect(0, size * .02, size, band);
}

export function referenceEndpaper(c) {
  const size = 256, random = seededRandom(90127);
  c.fillStyle = '#fff'; c.fillRect(0, 0, size, size);
  for (let i = 0; i < 2400; i++) {
    c.fillStyle = random() > .55 ? `rgba(86,86,86,${.035 + random() * .05})` : `rgba(255,255,255,${.3 + random() * .4})`;
    c.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 1);
  }
  c.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = random() * size, y = random() * size, a = random() * Math.PI, length = 6 + random() * 22;
    const bend = (random() - .5) * length * .5, dx = Math.cos(a) * length, dy = Math.sin(a) * length;
    c.strokeStyle = `rgba(112,112,112,${.05 + random() * .07})`; c.lineWidth = .5 + random() * .5;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      c.beginPath(); c.moveTo(x + ox, y + oy);
      c.quadraticCurveTo(x + ox + dx / 2 - dy / length * bend, y + oy + dy / 2 + dx / length * bend, x + ox + dx, y + oy + dy);
      c.stroke();
    }
  }
}

export function referenceThumbnailPages(c) {
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 32, 32);
  for (let i = 1; i < 32; i += 3) {
    c.fillStyle = i % 9 === 1 ? 'rgba(112,112,112,.18)' : 'rgba(255,255,255,.4)'; c.fillRect(0, i, 32, 1);
  }
}

// Joint groove distance from the spine edge, as a fraction of board height.
const HINGE_GROOVE = .026;

export function referenceFinishBoard(c, designWidth, random, { wear = true } = {}) {
  const hinge = HINGE_GROOVE * 1024, edge = 14;
  c.globalAlpha = 1;
  // The strip beside the spine flexes at every opening and dulls first.
  c.fillStyle = 'rgba(0,0,0,.05)'; c.fillRect(0, 0, hinge - 9, 1024);
  // Pressed joint groove: shadowed spine-side wall, lit far wall.
  c.fillStyle = withStops(c.createLinearGradient(hinge - 11, 0, hinge + 11, 0), [[0, 'rgba(0,0,0,0)'],
    [.3, 'rgba(0,0,0,.26)'], [.5, 'rgba(0,0,0,.12)'], [.7, 'rgba(255,248,236,.11)'], [1, 'rgba(255,248,236,0)']]);
  c.fillRect(hinge - 11, 0, 22, 1024);
  // The covering turns over the board edges here.
  for (const [x0, y0, x1, y1] of [[0, 0, 0, edge], [0, 1024, 0, 1024 - edge], [designWidth, 0, designWidth - edge, 0]]) {
    c.fillStyle = withStops(c.createLinearGradient(x0, y0, x1, y1), [[0, 'rgba(0,0,0,.16)'], [1, 'rgba(0,0,0,0)']]);
    if (x0 === x1) c.fillRect(0, Math.min(y0, y1), designWidth, edge); else c.fillRect(designWidth - edge, 0, edge, 1024);
  }
  // A thumbnail cannot show single fibres or rubbed corners.
  if (!wear) return;
  // Rubbed fibres: short paler runs along the edges that meet the shelf.
  c.fillStyle = '#fff6e6';
  for (const [length, vertical, at] of [[designWidth, false, 0], [designWidth, false, 1021.6], [1024, true, designWidth - 2.4]]) {
    for (let p = 0; p < length;) {
      const run = 6 + random() * 42;
      c.globalAlpha = random() < .45 ? random() * .24 : 0;
      if (vertical) c.fillRect(at, p, 2.4, run); else c.fillRect(p, at, run, 2.4);
      p += run;
    }
  }
  c.globalAlpha = 1;
  // Corners at the fore-edge take the knocks.
  for (const y of [0, 1024]) {
    c.fillStyle = withStops(c.createRadialGradient(designWidth, y, 0, designWidth, y, 30),
      [[0, 'rgba(255,244,226,.3)'], [1, 'rgba(255,244,226,0)']]);
    c.fillRect(designWidth - 30, y ? 994 : 0, 30, 30);
  }
}

/** coverTexture() after the dyed cloth and the weave: `title` is displayBookTitle(book) || 'Sin título',
 * `author` normalizeBookAuthor(book.author), `kind` the device's number (computed only for a full-size case). */
export function referenceCoverCase(c, designWidth, { title, author, style, thumb, kind, drawDevice, random }) {
  // Design in physical cover proportions so lettering is never stretched,
  // centred on the board beyond the joint as a real case is.
  const hinge = HINGE_GROOVE * 1024, center = (hinge + designWidth) / 2;
  const coverScale = designWidth / 676;
  const titleSize = Math.max(36, Math.min(82, 54 * coverScale));
  const titleWidth = Math.min(480 * coverScale, designWidth - hinge - 110);
  // Blind-stamped panel: pressed into the cloth, no ink.
  c.lineWidth = 2.4;
  c.strokeStyle = 'rgba(0,0,0,.26)'; c.strokeRect(hinge + 34, 42, designWidth - hinge - 76, 940);
  c.strokeStyle = 'rgba(255,248,236,.1)'; c.strokeRect(hinge + 36, 44, designWidth - hinge - 76, 940);
  const family = `"${style.fontCanvasFamily || style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`;
  c.fillStyle = c.strokeStyle = style.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `${style.fontWeight || 700} ${titleSize}px ${family}`;
  const words = title.split(' '); let line = ''; const lines = [];
  for (const word of words) {
    if (c.measureText(line + word).width > titleWidth && line) { lines.push(line.trim()); line = ''; }
    line += word + ' ';
  }
  lines.push(line.trim());
  const visible = lines.slice(0, 6), spacing = titleSize * 1.2, top = 400 - (visible.length - 1) * spacing / 2;
  visible.forEach((text, i) => c.fillText(text + (i === 5 && lines.length > 6 ? '…' : ''), center, top + i * spacing, titleWidth));
  // A small fleuron rule, then the author in the text face's italic.
  const ornament = top + (visible.length - 1) * spacing + titleSize * .6 + 56;
  c.globalAlpha = .75; c.fillRect(center - 66, ornament - .75, 50, 1.5); c.fillRect(center + 16, ornament - .75, 50, 1.5);
  c.save(); c.translate(center, ornament); c.rotate(Math.PI / 4); c.fillRect(-4.5, -4.5, 9, 9); c.restore();
  if (author) {
    c.globalAlpha = .92; c.font = `italic 400 ${Math.round(Math.max(24, Math.min(40, 30 * coverScale)))}px ${family}`;
    c.fillText(author, center, ornament + 56, titleWidth);
  }
  // Publisher's device at the foot, blind-stamped like the panel: pressed in,
  // no ink, so it never reads as a printed arrow.
  if (!thumb) {
    c.save(); c.globalAlpha = 1; c.translate(center, 904);
    c.fillStyle = 'rgba(0,0,0,.24)'; drawDevice(c, kind, 24);
    c.translate(1.8, 1.8); c.fillStyle = 'rgba(255,248,236,.1)'; drawDevice(c, kind, 24);
    c.restore();
  }
  referenceFinishBoard(c, designWidth, random, { wear:!thumb });
}

export { seededRandom as referenceSeededRandom };
