// Dependency-free PNG writer used by the local-fallback renderer when FFmpeg
// cannot decode SVG (e.g. Homebrew builds without librsvg). Produces an 8-bit
// RGBA PNG with raw pixel data that FFmpeg can ingest on any platform.
import { deflateSync } from 'node:zlib'

type Pixel = [number, number, number, number]

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = (CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

function pngSignature(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

export type PngOptions = {
  width: number
  height: number
  gradient: { from: Pixel; to: Pixel }
  accent?: Pixel
  text?: string
}

/**
 * Generates an 8-bit RGBA PNG with a vertical gradient, a soft accent circle,
 * and an optional centered overlay rendered from a built-in 5x7 bitmap font.
 * This keeps the local-fallback video pipeline dependency-free.
 */
export function buildGradientPng({ width, height, gradient, accent, text }: PngOptions): Buffer {
  const lines: Buffer[] = []
  for (let y = 0; y < height; y += 1) {
    const t = y / Math.max(1, height - 1)
    const r = Math.round(gradient.from[0] + (gradient.to[0] - gradient.from[0]) * t)
    const g = Math.round(gradient.from[1] + (gradient.to[1] - gradient.from[1]) * t)
    const b = Math.round(gradient.from[2] + (gradient.to[2] - gradient.from[2]) * t)
    const alpha = gradient.from[3] + (gradient.to[3] - gradient.from[3]) * t
    const row = Buffer.alloc(width * 4 + 1)
    row[0] = 0 // filter: None
    for (let x = 0; x < width; x += 1) {
      let cr = r, cg = g, cb = b, ca = alpha
      if (accent) {
        const dx = x - width * 0.72
        const dy = y - height * 0.28
        const radius = Math.min(width, height) * 0.22
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < radius) {
          const opacity = smoothstep(radius - 22, radius, distance)
          cr = mix(cr, accent[0], opacity * 0.18)
          cg = mix(cg, accent[1], opacity * 0.18)
          cb = mix(cb, accent[2], opacity * 0.18)
          ca = 255
        }
      }
      row[1 + x * 4] = cr
      row[2 + x * 4] = cg
      row[3 + x * 4] = cb
      row[4 + x * 4] = ca
    }
    if (text) {
      paintText(row, width, text, y)
    }
    lines.push(row)
  }
  const raw = Buffer.concat(lines)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([pngSignature(), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function mix(a: number, b: number, t: number) { return Math.round(a + (b - a) * t) }
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// Minimal 5x7 bitmapped glyphs for the chars we expect in titles. Anything
// outside the supported set falls back to a blank tile to keep the layout safe.
const GLYPHS: Record<string, number[]> = {
  ' ': [0,0,0,0,0,0,0],
  'A': [0x0e,0x11,0x11,0x1f,0x11,0x11,0x11],
  'B': [0x1e,0x11,0x11,0x1e,0x11,0x11,0x1e],
  'C': [0x0e,0x11,0x10,0x10,0x10,0x11,0x0e],
  'D': [0x1e,0x11,0x11,0x11,0x11,0x11,0x1e],
  'E': [0x1f,0x10,0x10,0x1e,0x10,0x10,0x1f],
  'F': [0x1f,0x10,0x10,0x1e,0x10,0x10,0x10],
  'G': [0x0e,0x11,0x10,0x17,0x11,0x11,0x0e],
  'H': [0x11,0x11,0x11,0x1f,0x11,0x11,0x11],
  'I': [0x0e,0x04,0x04,0x04,0x04,0x04,0x0e],
  'J': [0x07,0x02,0x02,0x02,0x02,0x12,0x0c],
  'K': [0x11,0x12,0x14,0x18,0x14,0x12,0x11],
  'L': [0x10,0x10,0x10,0x10,0x10,0x10,0x1f],
  'M': [0x11,0x1b,0x15,0x15,0x11,0x11,0x11],
  'N': [0x11,0x11,0x19,0x15,0x13,0x11,0x11],
  'O': [0x0e,0x11,0x11,0x11,0x11,0x11,0x0e],
  'P': [0x1e,0x11,0x11,0x1e,0x10,0x10,0x10],
  'Q': [0x0e,0x11,0x11,0x11,0x15,0x12,0x0d],
  'R': [0x1e,0x11,0x11,0x1e,0x14,0x12,0x11],
  'S': [0x0f,0x10,0x10,0x0e,0x01,0x01,0x1e],
  'T': [0x1f,0x04,0x04,0x04,0x04,0x04,0x04],
  'U': [0x11,0x11,0x11,0x11,0x11,0x11,0x0e],
  'V': [0x11,0x11,0x11,0x11,0x11,0x0a,0x04],
  'W': [0x11,0x11,0x11,0x15,0x15,0x15,0x0a],
  'X': [0x11,0x11,0x0a,0x04,0x0a,0x11,0x11],
  'Y': [0x11,0x11,0x11,0x0a,0x04,0x04,0x04],
  'Z': [0x1f,0x01,0x02,0x04,0x08,0x10,0x1f],
  '0': [0x0e,0x11,0x13,0x15,0x19,0x11,0x0e],
  '1': [0x04,0x0c,0x04,0x04,0x04,0x04,0x0e],
  '2': [0x0e,0x11,0x01,0x02,0x04,0x08,0x1f],
  '3': [0x1e,0x01,0x01,0x0e,0x01,0x01,0x1e],
  '4': [0x02,0x06,0x0a,0x12,0x1f,0x02,0x02],
  '5': [0x1f,0x10,0x1e,0x01,0x01,0x11,0x0e],
  '6': [0x06,0x08,0x10,0x1e,0x11,0x11,0x0e],
  '7': [0x1f,0x01,0x02,0x04,0x04,0x04,0x04],
  '8': [0x0e,0x11,0x11,0x0e,0x11,0x11,0x0e],
  '9': [0x0e,0x11,0x11,0x0f,0x01,0x02,0x0c],
  ':': [0x00,0x04,0x04,0x00,0x04,0x04,0x00],
  '.': [0x00,0x00,0x00,0x00,0x00,0x04,0x04],
  '?': [0x0e,0x11,0x01,0x02,0x04,0x00,0x04],
  '!': [0x04,0x04,0x04,0x04,0x04,0x00,0x04],
  '-': [0x00,0x00,0x00,0x1f,0x00,0x00,0x00],
  '_': [0x00,0x00,0x00,0x00,0x00,0x00,0x1f],
  "'": [0x04,0x04,0x04,0x00,0x00,0x00,0x00],
  ',': [0x00,0x00,0x00,0x00,0x04,0x04,0x08],
  '#': [0x0a,0x0a,0x1f,0x0a,0x1f,0x0a,0x0a],
  '&': [0x0c,0x12,0x14,0x08,0x15,0x12,0x0d],
}

function paintText(row: Buffer, width: number, text: string, y: number) {
  // Each glyph is 5px wide + 1px gap = 6px stride. Render at scale 6 at y-pitch 7.
  const textHeight = 7
  const textTop = 36 // text band starts ~36px down (within current row applies each scanline)
  if (y < textTop || y >= textTop + textHeight * 6) return
  const localY = Math.floor((y - textTop) / 6)
  const upper = text.toUpperCase().slice(0, 18)
  const totalWidth = upper.length * 6 * 6
  const startX = Math.max(0, Math.floor((width - totalWidth) / 2))
  for (let i = 0; i < upper.length; i += 1) {
    const glyph = GLYPHS[upper[i]] || GLYPHS[' ']
    for (let rowIndex = 0; rowIndex < 7; rowIndex += 1) {
      const bit = glyph[rowIndex]
      if (rowIndex !== localY) continue
      const xInGlyph = startX + i * 6 * 6
      for (let col = 0; col < 5; col += 1) {
        if ((bit >> (4 - col)) & 1) {
          for (let sx = 0; sx < 6; sx += 1) {
            const x = xInGlyph + col * 6 + sx
            if (x < 0 || x >= width) continue
            const offset = 1 + x * 4
            row[offset] = 245
            row[offset + 1] = 245
            row[offset + 2] = 250
            row[offset + 3] = 255
          }
        }
      }
    }
  }
}
