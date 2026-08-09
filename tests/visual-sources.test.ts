import { describe, expect, it } from 'vitest'
import { parseMixkitVideoPreviews, hasMixkitFreeLicense, isValidMp4Buffer, isValidImageBuffer } from '../server/visual-sources.js'

describe('visual-sources', () => {
  it('parses mixkit preview URLs and page URLs from HTML', () => {
    const html = `
      <a href="/free-stock-video/jellyfish-1234/">Jellyfish</a>
      <a href="/free-stock-video/ocean-waves-5678/">Waves</a>
      <img src="https://assets.mixkit.co/videos/preview/mixkit-jellyfish-1234-hd.mp4">
      <img src="https://assets.mixkit.co/videos/preview/mixkit-ocean-waves-5678-large.mp4">
      <img src="https://assets.mixkit.co/videos/preview/mixkit-ocean-waves-5678-hd.mp4">`
    const results = parseMixkitVideoPreviews(html)
    expect(results).toHaveLength(2)
    expect(results[0].previewUrl).toContain('jellyfish')
    expect(results[0].pageUrl).toBe('https://mixkit.co/free-stock-video/jellyfish-1234/')
    expect(results[1].pageUrl).toBe('https://mixkit.co/free-stock-video/ocean-waves-5678/')
  })

  it('detects Mixkit Free License marker', () => {
    expect(hasMixkitFreeLicense('<p>Free License</p>')).toBe(true)
    expect(hasMixkitFreeLicense('<p>Standard License</p>')).toBe(false)
    expect(hasMixkitFreeLicense('<p>Free License — premium upgrades available</p>')).toBe(true)
  })

  it('validates MP4 and image buffers', () => {
    const mp4 = Buffer.from('ftypmp42header')
    expect(isValidMp4Buffer(mp4)).toBe(true)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(isValidImageBuffer(png)).toBe(true)
    expect(isValidMp4Buffer(Buffer.from('notmp4'))).toBe(false)
  })
})
