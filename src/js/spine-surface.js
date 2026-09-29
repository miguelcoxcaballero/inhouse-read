import * as THREE from 'three'
import { spineFinish, surfaceFinish, SURFACE_FINISHES } from './book-colors.js'
import { normalizeBookAuthor } from './book-title.js'

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
  let size = Math.min(designWidth * .9, 64 * (Number(style.spineFontSize) || 10) / 10)
  let title = String(book.spineTitleOverride || book.title || 'Sin título')
  const author = Number(style.width) >= 32 && normalizeBookAuthor(book.author)
  const authorSize = author
    ? Math.min(designWidth * .82, 28 * (Number(style.spineAuthorFontSize) || 12) / 12)
    : 0
  const labelGap = author ? Math.max(1.5, Math.min(3, size * .045)) : 0
  const setFont = () => { c.font = `${style.fontWeight || 700} ${size}px ${family}` }
  setFont()
  // Fit by font size, never by non-uniform fillText(maxWidth) compression.
  while (c.measureText(title).width > 820 && size > 44) { size -= 1; setFont() }
  if (c.measureText(title).width > 820) {
    while (title.length > 1 && c.measureText(title + '…').width > 820) title = title.slice(0, -1)
    title = title.trimEnd() + '…'
  }
  // Title and author are parallel on the curved spine. Position them as one
  // compact group, centered across its width, instead of pinning them to
  // opposite edges and leaving a large empty band between the two.
  c.fillText(title, 0, author ? -(authorSize + labelGap) / 2 : 0)
  if (author) {
    c.font = `500 ${authorSize}px "DM Sans", sans-serif`
    let name = author
    while (name.length > 1 && c.measureText(name).width > 760) name = name.slice(0, -1)
    c.fillText(name, 0, (size + labelGap) / 2)
  }
  c.restore()
  c.strokeStyle = '#fff'; c.lineWidth = 1.5
  for (const y of [55, 65, 959, 969]) { c.beginPath(); c.moveTo(designWidth * .16, y); c.lineTo(designWidth * .84, y); c.stroke() }

  const color = canvas(), ctx = color.getContext('2d')
  ctx.fillStyle = style.color; ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = .025
  for (let y = 0; y < height; y += 6) { ctx.fillStyle = '#fff'; ctx.fillRect(0, y, width, 1) }
  ctx.globalAlpha = 1
  const metalBinding = spineFinish(book.spineFinish) !== 'matte'
  const metalText = spineFinish(book.spineTextFinish) !== 'matte'
  const engraved = book.spineEngraved === true
  const foil = finish => {
    const gradient = ctx.createLinearGradient(0, 0, width, 0)
    const stops = finish === 'gold'
      ? [[0,'#b58b35'],[.12,'#e0bd62'],[.25,'#fff1b0'],[.34,'#c79838'],[.43,'#fff7cf'],[.51,'#f5d77a'],[.61,'#ba8c35'],[.72,'#ffedaa'],[.86,'#d6ad4d'],[1,'#a77a2b']]
      : [[0,'#9ca4ad'],[.12,'#d7dce0'],[.25,'#ffffff'],[.34,'#aeb5bd'],[.43,'#f9fbff'],[.51,'#dfe4ea'],[.61,'#9ba3ac'],[.72,'#ffffff'],[.86,'#c7cdd4'],[1,'#939ba5']]
    for (const [at, value] of stops) gradient.addColorStop(at, value)
    return gradient
  }
  // Foil is given a broad, studio-like reflection band across the curved
  // surface. The environment map then moves the real specular highlight as
  // the 3D spine turns, instead of reading as a flat yellow/grey ink.
  if (metalBinding) { ctx.fillStyle = foil(spineFinish(book.spineFinish)); ctx.fillRect(0, 0, width, height) }
  const ink = canvas(), ic = ink.getContext('2d')
  ic.drawImage(mask, 0, 0); ic.globalCompositeOperation = 'source-in'
  ic.fillStyle = metalText ? foil(spineFinish(book.spineTextFinish)) : style.ink
  ic.fillRect(0, 0, width, height); ctx.drawImage(ink, 0, 0)

  // R = surface height, G = roughness, B = metalness. Linear, never sRGB.
  const packed = canvas(), pc = packed.getContext('2d')
  const surface = SURFACE_FINISHES[surfaceFinish(book.spineSurfaceFinish, 'matte')]
  const bindingRoughness = Math.round(surface.roughness * 255)
  pc.fillStyle = `rgb(255,${bindingRoughness},${metalBinding ? 255 : 0})`
  pc.fillRect(0, 0, width, height)
  ic.clearRect(0, 0, width, height); ic.globalCompositeOperation = 'source-over'
  ic.drawImage(mask, 0, 0); ic.globalCompositeOperation = 'source-in'
  ic.fillStyle = `rgb(${engraved ? 0 : 255},${metalText ? 66 : 230},${metalText ? 255 : 0})`
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
  const metallic = metalBinding || metalText
  return { map, channels, relief, material:{
    map, roughness:1, metalness:1, roughnessMap:channels, metalnessMap:channels,
    bumpMap:engraved ? channels : null, bumpScale:engraved ? .035 : 0,
    envMapIntensity:surface.envMapIntensity * (metallic ? 1.2 : .9),
    anisotropy:metallic ? .35 : 0,
    clearcoat:surface.clearcoat,
    clearcoatRoughness:surface.clearcoatRoughness
  } }
}

export function releaseSurface(surface) { surface.map.dispose(); surface.channels.dispose() }
