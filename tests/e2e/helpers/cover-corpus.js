// Twelve covers drawn with canvas for the relief analysis and rendering proofs:
// ornate classic, minimalist, illustrated, photo-like, children's, non-fiction
// with a band, black-and-white scan, no text, very dark, very light, landscape
// and a tiny low-resolution thumbnail. Browser only. Explicit fixture fonts
// prevent Windows' missing DejaVu fallback from changing the input artwork.
let fontsReady;
export function prepareCoverCorpusFonts() {
  return fontsReady ??= Promise.all([
    ['Relief Fixture Sans', 'DejaVuSans.ttf', {}],
    ['Relief Fixture Sans', 'DejaVuSans-Bold.ttf', { weight:'700' }],
    ['Relief Fixture Serif', 'DejaVuSerif.ttf', {}],
    ['Relief Fixture Serif', 'DejaVuSerif-Bold.ttf', { weight:'700' }],
    ['Relief Fixture Serif', 'DejaVuSerif-Italic.ttf', { style:'italic' }]
  ].map(async ([family, file, descriptors]) => {
    const url = new URL('../fixtures/cover-fonts/' + file, import.meta.url);
    const face = await new FontFace(family, `url("${url}")`, descriptors).load();
    document.fonts.add(face);
  }));
}

// PNG inputs also pin rasterisation/antialiasing: DirectWrite and FreeType can
// paint different pixels from the same font. Regeneration is explicit below.
const names = ['01-ornate-classic', '02-minimalist', '03-illustrated', '04-photo', '05-children',
  '06-nonfiction-band', '07-bw-scan', '08-no-text', '09-very-dark', '10-very-light', '11-landscape', '12-tiny-lowres'];
export async function loadCoverCorpus() {
  return Object.fromEntries(await Promise.all(names.map(async name => {
    const image = new Image();
    image.src = new URL('../fixtures/cover-corpus/' + name + '.png', import.meta.url).href;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return [name, canvas];
  })));
}

export function drawCoverCorpus() {
  const out = {}
  function make(name, w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'); draw(g, w, h)
    out[name] = c
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const centered = (g, text, x, y, font, fill) => { g.font = font; g.fillStyle = fill; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y) }
  make('01-ornate-classic', 660, 1000, (g, w, h) => {
    g.fillStyle = '#143a2a'; g.fillRect(0, 0, w, h)
    const gold = '#d4a93c'
    g.strokeStyle = gold; g.lineWidth = 6; g.strokeRect(34, 34, w - 68, h - 68)
    g.lineWidth = 2; g.strokeRect(50, 50, w - 100, h - 100)
    for (const [x, y] of [[70, 70], [w - 70, 70], [70, h - 70], [w - 70, h - 70]]) { g.beginPath(); g.arc(x, y, 14, 0, 7); g.stroke() }
    centered(g, 'LA ISLA', w / 2, 230, 'bold 92px "Relief Fixture Serif"', gold)
    centered(g, 'DEL TESORO', w / 2, 330, 'bold 78px "Relief Fixture Serif"', gold)
    g.fillStyle = gold; g.beginPath(); g.arc(w / 2, 560, 100, 0, 7); g.fill()
    g.fillStyle = '#143a2a'; g.beginPath(); g.arc(w / 2, 560, 80, 0, 7); g.fill()
    g.fillStyle = gold; g.beginPath(); g.moveTo(w / 2, 490); g.lineTo(w / 2 + 40, 560); g.lineTo(w / 2, 630); g.lineTo(w / 2 - 40, 560); g.fill()
    centered(g, 'Robert Louis Stevenson', w / 2, 800, 'italic 46px "Relief Fixture Serif"', gold)
  })
  make('02-minimalist', 660, 1000, (g, w, h) => {
    g.fillStyle = '#e8e2d6'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#c8452d'; g.fillRect(0, 0, w, 560)
    centered(g, 'Habitar', 330, 720, 'bold 110px "Relief Fixture Sans"', '#1d1d1d')
    centered(g, 'ensayos sobre el hogar', 330, 810, '40px "Relief Fixture Sans"', '#1d1d1d')
  })
  make('03-illustrated', 660, 1000, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f6b26b'); gr.addColorStop(1, '#6a3d8f'); g.fillStyle = gr; g.fillRect(0, 0, w, h)
    g.fillStyle = '#1b1530'; g.beginPath(); g.ellipse(330, 560, 130, 200, 0, 0, 7); g.fill()
    g.beginPath(); g.arc(330, 330, 80, 0, 7); g.fill()
    g.fillStyle = '#fff3c9'; g.beginPath(); g.arc(330, 330, 20, 0, 7); g.fill()
    centered(g, 'EL VIAJERO', 330, 130, 'bold 70px "Relief Fixture Sans"', '#fff')
  })
  make('04-photo', 660, 1000, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#4a6a8a'); gr.addColorStop(.5, '#9ab0a0'); gr.addColorStop(1, '#3a4a30'); g.fillStyle = gr; g.fillRect(0, 0, w, h)
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${rnd() * 255 | 0},${rnd() * 255 | 0},${rnd() * 255 | 0},.18)`; const s = 4 + rnd() * 26; g.fillRect(rnd() * w, rnd() * h, s, s * (.5 + rnd())) }
    g.fillStyle = 'rgba(20,30,20,.6)'; g.beginPath(); g.moveTo(0, 700); for (let x = 0; x <= w; x += 30) g.lineTo(x, 640 + Math.sin(x / 60) * 50 + rnd() * 30); g.lineTo(w, h); g.lineTo(0, h); g.fill()
    centered(g, 'Costa norte', 330, 900, '36px "Relief Fixture Sans"', '#ffffff')
  })
  make('05-children', 660, 1000, (g, w, h) => {
    g.fillStyle = '#fde7ef'; g.fillRect(0, 0, w, h)
    for (const [x, y, r, c] of [[130, 700, 90, '#ffd27d'], [520, 760, 70, '#9ad6c8'], [330, 820, 100, '#b9a8f0']]) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill() }
    g.lineJoin = 'round'; g.lineWidth = 22; g.strokeStyle = '#ef6f9f'; g.font = 'bold 130px "Relief Fixture Sans"'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.strokeText('Pipo', 330, 200); g.fillStyle = '#ef6f9f'; g.fillText('Pipo', 330, 200)
    g.strokeStyle = '#4aa3df'; g.strokeText('y la luna', 330, 360); g.fillStyle = '#4aa3df'; g.fillText('y la luna', 330, 360)
  })
  make('06-nonfiction-band', 660, 1000, (g, w, h) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#1f3a5f'; g.fillRect(0, 380, w, 230)
    centered(g, 'ECONOMÍA', 330, 120, 'bold 70px "Relief Fixture Sans"', '#1f3a5f')
    centered(g, 'del comportamiento', 330, 200, '44px "Relief Fixture Sans"', '#333')
    centered(g, 'Una guía práctica para decidir mejor', 330, 275, '28px "Relief Fixture Sans"', '#555')
    centered(g, 'EDICIÓN REVISADA', 330, 495, 'bold 52px "Relief Fixture Sans"', '#ffffff')
    centered(g, 'María Delgado Ruiz', 330, 860, 'bold 46px "Relief Fixture Sans"', '#1f3a5f')
    centered(g, 'Con prólogo de J. Ortega', 330, 925, '26px "Relief Fixture Sans"', '#555')
  })
  make('07-bw-scan', 640, 960, (g, w, h) => {
    g.fillStyle = '#ecebe6'; g.fillRect(0, 0, w, h)
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * .05})`; g.fillRect(rnd() * w, rnd() * h, 2, 2) }
    g.strokeStyle = '#222'; g.lineWidth = 8; g.strokeRect(40, 40, w - 80, h - 80); g.lineWidth = 2; g.strokeRect(58, 58, w - 116, h - 116)
    centered(g, 'DON QUIJOTE', 320, 230, 'bold 70px "Relief Fixture Serif"', '#1a1a1a')
    centered(g, 'DE LA MANCHA', 320, 320, 'bold 56px "Relief Fixture Serif"', '#1a1a1a')
    g.fillStyle = '#1a1a1a'; g.fillRect(200, 400, 240, 4)
    centered(g, 'Miguel de Cervantes', 320, 770, 'italic 38px "Relief Fixture Serif"', '#1a1a1a')
  })
  make('08-no-text', 660, 1000, (g, w, h) => {
    g.fillStyle = '#2d6a6a'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#e9c46a'; g.beginPath(); g.arc(330, 380, 150, 0, 7); g.fill()
    g.fillStyle = '#264653'; g.beginPath(); g.moveTo(0, 760); g.lineTo(220, 560); g.lineTo(420, 740); g.lineTo(560, 620); g.lineTo(660, 780); g.lineTo(660, 1000); g.lineTo(0, 1000); g.fill()
  })
  make('09-very-dark', 660, 1000, (g, w, h) => {
    g.fillStyle = '#0b0b10'; g.fillRect(0, 0, w, h)
    centered(g, 'NOCTURNO', 330, 300, 'bold 84px "Relief Fixture Sans"', '#3c3c52')
    centered(g, 'A. Vidal', 330, 880, '40px "Relief Fixture Sans"', '#3c3c52')
  })
  make('10-very-light', 660, 1000, (g, w, h) => {
    g.fillStyle = '#faf8f2'; g.fillRect(0, 0, w, h)
    centered(g, 'Aire', 330, 420, '120px "Relief Fixture Serif"', '#cfc8b8')
    centered(g, 'poemas', 330, 520, '40px "Relief Fixture Serif"', '#cfc8b8')
  })
  make('11-landscape', 1000, 700, (g, w, h) => {
    g.fillStyle = '#3a2a58'; g.fillRect(0, 0, w, h)
    g.strokeStyle = '#d8c079'; g.lineWidth = 4; g.strokeRect(30, 30, w - 60, h - 60)
    centered(g, 'ATLAS CELESTE', 500, 300, 'bold 90px "Relief Fixture Serif"', '#d8c079')
    centered(g, 'Observaciones del cielo austral', 500, 420, '38px "Relief Fixture Serif"', '#d8c079')
  })
  make('12-tiny-lowres', 72, 108, (g, w, h) => {
    g.fillStyle = '#7a1f2b'; g.fillRect(0, 0, w, h)
    g.fillStyle = '#e8c872'; g.font = 'bold 12px "Relief Fixture Serif"'; g.textAlign = 'center'; g.fillText('SOMBRAS', 36, 40); g.fillRect(14, 50, 44, 2); g.font = '8px "Relief Fixture Serif"'; g.fillText('E. Mora', 36, 92)
  })
  return out
}
