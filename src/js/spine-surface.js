import * as THREE from 'three'
import { spineFinish } from './book-colors.js'

// Colour and PBR channels share exactly the same glyph raster. Text never
// becomes a floating decal: it follows the continuous curved binding UVs.
export function spineSurface(book, style, physicalHeight = 200, thickness = 32) {
  const width = 512, height = 2048
  const canvas = () => Object.assign(document.createElement('canvas'), { width, height })
  const mask = canvas(), c = mask.getContext('2d')
  const designWidth = Math.max(80, thickness / physicalHeight * 1024 * Math.PI / 2)
  c.scale(width / designWidth, 2); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.save(); c.translate(designWidth / 2, 512); c.rotate(Math.PI / 2)
  const family = `"${style.fontCanvasFamily || style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`
  let size = Math.min(designWidth * .64, 64 * (Number(style.spineFontSize) || 10) / 10)
  let title = String(book.spineTitleOverride || book.title || 'Sin título')
  const setFont = () => { c.font = `${style.fontWeight || 700} ${size}px ${family}` }
  setFont()
  // Fit by font size, never by non-uniform fillText(maxWidth) compression.
  while (c.measureText(title).width > 820 && size > 44) { size -= 1; setFont() }
  if (c.measureText(title).width > 820) {
    while (title.length > 1 && c.measureText(title + '…').width > 820) title = title.slice(0, -1)
    title = title.trimEnd() + '…'
  }
  const author = Number(style.width) >= 32 && book.author
  c.fillText(title, 0, author ? -17 : 0)
  if (author) {
    c.font = '500 28px "DM Sans", sans-serif'
    let name = String(book.author)
    while (name.length > 1 && c.measureText(name).width > 760) name = name.slice(0, -1)
    c.fillText(name, 0, 43)
  }
  c.restore()
  c.strokeStyle = '#fff'; c.lineWidth = 1.5
  for (const y of [55, 65, 959, 969]) { c.beginPath(); c.moveTo(designWidth * .16, y); c.lineTo(designWidth * .84, y); c.stroke() }

  const color = canvas(), ctx = color.getContext('2d')
  ctx.fillStyle = style.color; ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = .025
  for (let y = 0; y < height; y += 6) { ctx.fillStyle = '#fff'; ctx.fillRect(0, y, width, 1) }
  ctx.globalAlpha = 1
  const ink = canvas(), ic = ink.getContext('2d')
  ic.drawImage(mask, 0, 0); ic.globalCompositeOperation = 'source-in'; ic.fillStyle = style.ink; ic.fillRect(0, 0, width, height)
  ctx.drawImage(ink, 0, 0)

  const metalBinding = spineFinish(book.spineFinish) !== 'matte'
  const metalText = spineFinish(book.spineTextFinish) !== 'matte'
  const engraved = book.spineEngraved === true
  // R = surface height, G = roughness, B = metalness. Linear, never sRGB.
  const packed = canvas(), pc = packed.getContext('2d')
  pc.fillStyle = `rgb(255,${metalBinding ? 85 : 220},${metalBinding ? 255 : 0})`
  pc.fillRect(0, 0, width, height)
  ic.clearRect(0, 0, width, height); ic.globalCompositeOperation = 'source-over'
  ic.drawImage(mask, 0, 0); ic.globalCompositeOperation = 'source-in'
  ic.fillStyle = `rgb(${engraved ? 0 : 255},${metalText ? 62 : 230},${metalText ? 255 : 0})`
  ic.fillRect(0, 0, width, height); pc.drawImage(ink, 0, 0)
  const map = new THREE.CanvasTexture(color); map.colorSpace = THREE.SRGBColorSpace
  const channels = new THREE.CanvasTexture(packed)
  let relief = null
  if (engraved) {
    const sample = document.createElement('canvas'); sample.width = 256; sample.height = 1024
    const sc = sample.getContext('2d', { willReadFrequently:true }); sc.filter = 'blur(1.2px)'; sc.drawImage(mask, 0, 0, 256, 1024)
    const pixels = sc.getImageData(0, 0, 256, 1024).data
    relief = (u,v) => pixels[(Math.min(1023, Math.floor((1-v)*1024))*256 + Math.min(255, Math.floor(u*256)))*4+3]/255
  }
  return { map, channels, relief, material:{
    map, roughness:1, metalness:1, roughnessMap:channels, metalnessMap:channels,
    bumpMap:engraved ? channels : null, bumpScale:engraved ? .035 : 0,
    envMapIntensity:1.15
  } }
}

export function releaseSurface(surface) { surface.map.dispose(); surface.channels.dispose() }
