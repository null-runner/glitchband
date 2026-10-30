import { expect } from 'claude-code/testing'

import { cardSvg } from '../src/ui/card'
import { testEn as test } from './lang'

const KW = { state: 'off', tone: 'off', pings: '0 · ~$0.00', cold: '0 · $0.00', note: '' } as const
// Outfit digits run about 0.58 em; a bold price at its size, plus a little air.
const widthOf = (s: string, size: number) => s.length * size * 0.58 + 4

for (const tokens of [230000, 1000000]) test(`each price (${tokens} tokens) in next-message costs ends before the next model's dots`, () => {
  for (const W of [950, 1000]) {
    const view = { mode: 'cold', idle: '1h 54m', idleMin: 114, tokens, window: 1000000, mine: 'opus', ttlMin: 60 } as const
    const svg = cardSvg(view, 'wide', W, KW as never).source
    const prices = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="(\d+)"[^>]*>(\$[\d.]+)<\/text>/g)]
      .map(m => ({ x: Number(m[1]), size: Number(m[2]), s: m[3]! }))
    const dots = [...svg.matchAll(/<circle cx="([\d.]+)" cy="[\d.]+" r="2.8"/g)].map(m => Number(m[1]))
    expect(prices.length, `four prices at ${W}`).toBe(4)
    for (const p of prices.slice(0, -1)) {
      const nextDot = Math.min(...dots.filter(d => d > p.x))
      expect(p.x + widthOf(p.s, p.size), `${p.s} at ${W}px`).toBeLessThan(nextDot - 2.8)
    }
    const last = prices.at(-1)!
    expect(last.x + widthOf(last.s, last.size), `last price inside ${W}px`).toBeLessThan(W)
  }
})
