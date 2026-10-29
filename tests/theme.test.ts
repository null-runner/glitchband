import { expect, test } from 'claude-code/testing'

import { barSvg, chipShapes, mascotSvg } from '../src/ui/art'
import * as theme from '../src/ui/theme'
import { AMBER, BG, CARD_BG, FIVE_HOUR, HUE, INK, LOW_COLOR, MUTED, SEVEN_DAY, TEXT } from '../src/ui/theme'

const lum = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

const MIN = 4.5

test('every text colour reads at WCAG AA (4.5:1) on the band and on the card', () => {
  const texts = { TEXT, MUTED, SEVEN_DAY, FIVE_HOUR, WARM: HUE.warm, COLD: HUE.cold, AMBER, LOW_COLOR }
  for (const [bgName, bg] of Object.entries({ BG, CARD_BG }))
    for (const [name, fg] of Object.entries(texts)) expect(contrast(fg, bg), `${name} on ${bgName}`).toBeGreaterThanOrEqual(MIN)
})

test('the dark ink on a filled chip reads at 4.5:1 on both chip colours', () => {
  expect(contrast(INK, HUE.warm), 'INK on WARM').toBeGreaterThanOrEqual(MIN)
  expect(contrast(INK, HUE.cold), 'INK on COLD').toBeGreaterThanOrEqual(MIN)
})

test('every colour a drawing uses comes from theme.ts', () => {
  const palette = new Set<string>()
  const collect = (v: unknown): void => {
    if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) palette.add(v.toLowerCase())
    else if (v && typeof v === 'object') Object.values(v).forEach(collect)
  }
  collect(theme)
  const drawings = [mascotSvg('warm'), mascotSvg('cold', true), barSvg(60, SEVEN_DAY), chipShapes(0, 0, 'WARM', 'warm', 13, 1, true).svg, chipShapes(0, 0, 'COLD', 'cold', 13, 1).svg]
  for (const svg of drawings) for (const hex of svg.match(/#[0-9a-f]{3,8}\b/gi) ?? []) expect(palette.has(hex.toLowerCase()), hex).toBe(true)
})

test('the palette has no magenta, pink or lilac: no saturated colour sits between violet and red', () => {
  const hex: string[] = []
  const collect = (v: unknown): void => {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) hex.push(v)
    else if (v && typeof v === 'object') Object.values(v).forEach(collect)
  }
  collect(theme)
  for (const h of hex) {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)]
    if (max - min < 0.15) continue
    const d = max - min
    const hue = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360
    expect(hue < 265 || hue > 345, `${h} has hue ${Math.round(hue)}`).toBe(true)
  }
})
