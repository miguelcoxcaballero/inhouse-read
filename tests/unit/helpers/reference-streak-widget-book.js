// El último libro para el widget de la racha: minutos que quedan y una
// miniatura PNG de la portada (la guardada, o una hecha con el título).

const WORDS_PER_MINUTE = 230
// Hasta 52×78 dp en el widget: 3× para que se vea nítida en pantallas densas.
const COVER_WIDTH = 156
const COVER_HEIGHT = 234

/** Minutos de lectura que quedan, o -1 si no se conoce la longitud del libro. */
export function minutesLeft(record) {
  const words = Number(record?.wordCount)
  if (!(words > 0)) return -1
  const fraction = Math.min(1, Math.max(0, Number(record.progressFraction) || 0))
  return Math.round(words * (1 - fraction) / WORDS_PER_MINUTE)
}

/** Redondea para no reescribir el widget por cada página: de 5 en 5 min y de 10 en 10 por encima de 1 h. */
export function roundedMinutes(minutes) {
  if (minutes < 0) return -1
  if (minutes < 60) return Math.ceil(minutes / 5) * 5
  return Math.round(minutes / 10) * 10
}

function hue(text) {
  let hash = 0
  for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) | 0
  return Math.abs(hash) % 360
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

function drawTitleCover(context, title) {
  const base = hue(title)
  const gradient = context.createLinearGradient(0, 0, 0, COVER_HEIGHT)
  gradient.addColorStop(0, `hsl(${base} 42% 42%)`)
  gradient.addColorStop(1, `hsl(${base} 46% 30%)`)
  context.fillStyle = gradient
  context.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
  context.fillStyle = 'rgba(255,255,255,.18)'
  context.fillRect(12, 0, 4, COVER_HEIGHT)
  context.fillStyle = '#fff'
  context.textAlign = 'center'
  context.font = '600 22px Georgia, serif'
  const words = String(title).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (context.measureText(next).width > COVER_WIDTH - 32 && line) { lines.push(line); line = word } else line = next
    if (lines.length === 4) break
  }
  if (line && lines.length < 4) lines.push(line)
  const top = COVER_HEIGHT / 2 - (lines.length - 1) * 13
  lines.forEach((text, index) => context.fillText(text, COVER_WIDTH / 2 + 4, top + index * 26, COVER_WIDTH - 28))
}

/** PNG en base64 (sin prefijo) de la portada con esquinas redondeadas. */
export async function coverPng(record, title) {
  const canvas = document.createElement('canvas')
  canvas.width = COVER_WIDTH
  canvas.height = COVER_HEIGHT
  const context = canvas.getContext('2d')
  roundedRect(context, 0, 0, COVER_WIDTH, COVER_HEIGHT, 12)
  context.clip()
  let drawn = false
  if (record?.cover instanceof Blob && typeof createImageBitmap === 'function') {
    try {
      const image = await createImageBitmap(record.cover)
      // Rellena el hueco recortando lo que sobre, como una portada impresa.
      const scale = Math.max(COVER_WIDTH / image.width, COVER_HEIGHT / image.height)
      const width = image.width * scale, height = image.height * scale
      context.drawImage(image, (COVER_WIDTH - width) / 2, (COVER_HEIGHT - height) / 2, width, height)
      image.close?.()
      drawn = true
    } catch {}
  }
  if (!drawn) drawTitleCover(context, title)
  context.strokeStyle = 'rgba(0,0,0,.14)'
  context.lineWidth = 3
  roundedRect(context, 1, 1, COVER_WIDTH - 2, COVER_HEIGHT - 2, 11)
  context.stroke()
  return canvas.toDataURL('image/png').split(',')[1] || ''
}
