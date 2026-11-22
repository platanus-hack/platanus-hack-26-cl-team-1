import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const publicFile = (path: string) => readFileSync(new URL(`../public/${path}`, import.meta.url))

function pngSize(path: string) {
  const png = publicFile(path)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
}

describe('Cortafuego app identity', () => {
  it('keeps the favicon geometry in sync with the canonical project logo', () => {
    const master = readFileSync(new URL('../../project-logo.svg', import.meta.url), 'utf8')
    expect(master).toContain('viewBox="0 0 1000 1000"')
    expect(publicFile('favicon.svg').toString()).toBe(
      master.replace('viewBox="0 0 1000 1000"', 'viewBox="150 120 700 700"'),
    )
    const geometry = JSON.parse(readFileSync(new URL('./ui/logoGeometry.generated.json', import.meta.url), 'utf8'))
    expect(master).toContain(`d="${geometry.flamePath}"`)
    expect(master).toContain(`d="${geometry.cutPath}"`)
    expect(master).toContain(`stroke-width="${geometry.cutWidth}"`)
    expect(master).toContain(`transform="${geometry.symbolTransform}"`)
    expect(master).toContain(`fill="${geometry.color}"`)
    expect(geometry.viewBox).toBe('150 120 700 700')
  })

  it('provides app and Apple icons at their declared dimensions', () => {
    const manifest = JSON.parse(publicFile('site.webmanifest').toString())
    expect(manifest.name).toBe('Cortafuego')
    expect(manifest.start_url).toBe('/')
    expect(manifest.icons).toHaveLength(3)
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(pngSize(icon.src.slice(1))).toBe(icon.sizes)
    }
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true)
    expect(pngSize('apple-touch-icon.png')).toBe('180x180')
  })

  it('wires the HTML and includes legacy 16/32/48 px favicon sizes', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    for (const path of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest']) {
      expect(html).toContain(`href="/${path}"`)
      expect(publicFile(path).length).toBeGreaterThan(0)
    }
    const ico = publicFile('favicon.ico')
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(3)
    expect([0, 1, 2].map((i) => [ico[6 + i * 16], ico[7 + i * 16]])).toEqual([
      [16, 16], [32, 32], [48, 48],
    ])
  })
})
