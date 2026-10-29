import { expect, mock } from 'claude-code/testing'

import { MODELS } from '../src/cache/cache'
import type { CacheView } from '../src/cache/cache'
import { en } from '../src/i18n/en'
import { it } from '../src/i18n/it'
import { CHIP_WIDTHS, MASCOT_PIX, REDUCED_MOTION, barSvg, chipSvg, justPinged, mascotShapes, mascotSvg } from '../src/ui/art'
import { cardSvg } from '../src/ui/card'
import { BAR_GROW_MS, BAR_H, BAR_SHINE_OPACITY, BAR_W, CARD_BAR_STAGGER_MS, CARD_SCAN_OPACITY, EMPTY, HUE, ICE, MASCOT, PING_GLITCH_WINDOW_MS, SEVEN_DAY } from '../src/ui/theme'
import { answerSession } from './answers'
import { testEn as test } from './lang'

const KW = { state: 'Keepwarm off.', note: '', pings: '0 · ~$0.00', cold: '0 · $0.00' }
const view = (mode: 'warm' | 'cold'): CacheView => ({ mode, idle: '18m', idleMin: 18, tokens: 770000, window: 1000000, mine: 'opus' })

test('the mascot is a 16 by 16 pixel grid', () => {
  expect(MASCOT_PIX).toHaveLength(16)
  for (const row of MASCOT_PIX) expect(row).toHaveLength(16)
})

test('a warm mascot is lit: coral rim, pulsing visor, a scan and three sparks, and no ice', () => {
  const warm = mascotSvg('warm')
  expect(warm).toContain('class="m-visor"')
  expect(warm).toContain('class="m-scan"')
  expect(warm.match(/class="m-sp m-sp\d"/g)).toHaveLength(3)
  expect(warm).toContain(`fill="${MASCOT.warm.rim}"`)
  expect(warm).not.toContain('gb-ice')
  expect(warm).not.toContain('class="m-glitch"')
})

test('a cold mascot is frozen: ice sheet, two icicles, a dark visor, one sheen, and its body never moves', () => {
  const cold = mascotSvg('cold')
  expect(cold).toContain('gb-ice')
  expect(cold.match(/<path d="M[\d.]+ [\d.]+h[\d.]+l/g)).toHaveLength(2)
  expect(cold).toContain(`fill="${MASCOT.cold.visor}"`)
  expect(cold.match(/class="m-sheen"/g)).toHaveLength(1)
  expect(cold).toContain('.m-sheen{opacity:0;animation:m-sheen 5s')
  for (const gone of ['class="m-visor"', 'class="m-scan"', 'class="m-sp', '<animateTransform']) expect(cold).not.toContain(gone)
})

test('warm and cold are told apart by their pixels: no coral on the cold figure, no ice on the warm one', () => {
  const [warm, cold] = [mascotShapes(0, 0, 22, 'warm'), mascotShapes(0, 0, 22, 'cold')]
  expect(warm).not.toBe(cold)
  expect(cold).not.toContain(HUE.warm)
  expect(cold).not.toContain(MASCOT.warm.rim)
  expect(warm).not.toContain(ICE.body)
  expect(warm).not.toContain(MASCOT.cold.hood)
})

test('a usage bar draws the share left on a track, grows once, and its shine stays faint', () => {
  const bar = barSvg(40, SEVEN_DAY)
  expect(bar).toContain(`<rect width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${EMPTY}"/>`)
  expect(bar).toContain(`class="b-fill" width="${(BAR_W * 40) / 100}"`)
  expect(bar).toContain(`fill="${SEVEN_DAY}"`)
  expect(bar).toContain(`animation:b-grow ${BAR_GROW_MS}ms`)
  expect(bar).toContain('class="b-shine"')
  expect(BAR_SHINE_OPACITY).toBeLessThanOrEqual(0.18)
  expect(bar).toContain(`stop-opacity="${BAR_SHINE_OPACITY}"`)
  expect(bar).toContain(REDUCED_MOTION)
  expect(barSvg(100, SEVEN_DAY)).toContain(`class="b-fill" width="${BAR_W}"`)
  expect(barSvg(2, SEVEN_DAY)).toContain(`class="b-fill" width="${BAR_H}"`)
  expect(barSvg(0, SEVEN_DAY)).not.toContain('class="b-fill"')
})

test('a ping makes the mascot glitch: RGB copies and a jitter, three times of 120ms', () => {
  const glitched = mascotSvg('warm', true)
  expect(glitched).toContain('class="m-glitch"')
  expect(glitched).toContain('class="m-gm"')
  expect(glitched).toContain('class="m-gc"')
  expect(glitched).toContain('.m-glitch{animation:m-jit .12s steps(1,end) 3}')
  expect(mascotSvg('warm')).not.toContain('class="m-gm"')
})

test('only a ping in the last 60 seconds counts', () => {
  const at = 1_000_000
  const ping = { last: { at, read: 1, write: 0, usd: 0, warm: true } }
  expect(justPinged(ping, at + 1000)).toBe(true)
  expect(justPinged(ping, at + PING_GLITCH_WINDOW_MS - 1)).toBe(true)
  expect(justPinged(ping, at + PING_GLITCH_WINDOW_MS)).toBe(false)
  expect(justPinged(ping, at - 1)).toBe(false)
  expect(justPinged({ last: null }, at)).toBe(false)
  expect(justPinged(null, at)).toBe(false)
})

test('the chip glitches once when the state changes, never on a redraw of the same state', () => {
  chipSvg('warm')
  expect(chipSvg('warm').glitch).toBe(false)
  const flip = chipSvg('cold')
  expect(flip.glitch).toBe(true)
  expect(flip.source).toContain('class="c-gm"')
  expect(flip.source).toContain('class="c-gc"')
  expect(chipSvg('cold').glitch).toBe(false)
  expect(chipSvg('cold').source).not.toContain('c-gm')
  expect(chipSvg('warm').glitch).toBe(true)
})

test('every chip word of both languages has a measured width', () => {
  for (const dict of [en, it]) {
    for (const key of ['chip.warm', 'chip.cold'] as const) for (const size of [13, 11]) expect(CHIP_WIDTHS[`${dict[key]}@${size}`], `${dict[key]}@${size}`).toBeDefined()
    expect(CHIP_WIDTHS[`${dict['card.you']}@10`], dict['card.you']).toBeDefined()
  }
})

test('every animated drawing carries the reduced-motion rule', () => {
  chipSvg('warm')
  const drawings = [
    mascotSvg('warm'), mascotSvg('cold'), mascotSvg('warm', true), chipSvg('cold').source, barSvg(50, SEVEN_DAY),
    cardSvg(view('warm'), 'wide', 800, KW).source, cardSvg(view('cold'), 'stacked', 700, KW, true).source, cardSvg(view('warm'), 'tight', 320, KW).source,
  ]
  for (const svg of drawings) {
    expect(svg).toContain('@keyframes')
    expect(svg).toContain(REDUCED_MOTION)
  }
})

test('the card has a faint scanline and fills its cost bars in turn only when it opens', () => {
  const opened = cardSvg(view('warm'), 'wide', 800, KW, true).source
  expect(opened).toContain('class="k-scan"')
  expect(CARD_SCAN_OPACITY).toBeLessThanOrEqual(0.06)
  expect(opened).toContain(`opacity:${CARD_SCAN_OPACITY}`)
  expect(opened).toContain('class="k-in k-b0"')
  expect(opened).toContain(`class="k-in k-b${MODELS.length * 3 - 1}"`)
  expect(opened).toContain(`.k-b1{animation-delay:${CARD_BAR_STAGGER_MS}ms}`)
  expect(opened).toContain('both')
  expect(cardSvg(view('warm'), 'wide', 800, KW).source).not.toContain('class="k-in')
})

test('a ping in the last minute puts the glitch on the band mascot, and it clears after the minute', async ($, on) => {
  const NOW = Date.parse('2098-12-31T22:00:00Z')
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  answerSession(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] } }))
  on('classic.SessionStart', () => ({}))
  on('model.fork', () => ({
    value: { isAnswered: true, text: 'warm', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 700000, cache_creation_input_tokens: 0 } },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 18 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })
  await $.command.run({ command: 'keepwarm', args: '6h', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const band = await $.ui.mount({
    plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const mascot = async () => ((await band.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('Netrunner'))?.props.source as string) ?? ''
  expect(await mascot()).not.toContain('class="m-glitch"')
  await clock.advance(32.5 * 60 * 1000)
  expect(await mascot()).toContain('class="m-glitch"')
  await clock.advance(PING_GLITCH_WINDOW_MS + 30_000)
  expect(await mascot()).not.toContain('class="m-glitch"')
  await band.unmount()
})
