import { expect, mock } from 'claude-code/testing'

import { HEAD_ROWS, ROW_PX } from '../src/ui/theme'
import { answerSession } from './answers'
import { testEn as test } from './lang'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_IDLE = 18 * 60 // 18 minutes: warm, cold in 42m
const COLD_IDLE = (3 * 24 + 9) * 3600 // 3d 9h: cold

test('a warm cache shows the mascot, the WARM chip and the minutes left, folded', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Drawings keep no key in the kit, so they are found by what they say.
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(alts).toEqual(['7D 99%', '5H 82%', 'Netrunner online', 'WARM'])
  expect(await band.find({ text: ' 42m' })).toBeDefined()
  expect(await band.find({ text: / left/ })).toBeUndefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Hide')
  await band.unmount()
})

test('a cold cache opens the card with the re-cache price, and Hide folds it to one row', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const card = await band.find({ key: 'card' })
  expect(card).toBeDefined()
  expect(JSON.stringify(card)).toContain('Cache cold. Idle 3d 9h. Next message re-caches 770k tokens.')
  // 80 columns is a 1020 px band; the card stops at the desktop panel's 950 px.
  expect(JSON.stringify(card)).toContain('"width":950')
  // Width and height go together, in the drawing's own ratio, so the rows it takes are known.
  const svg = (await band.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('Cache cold'))
  const [vw, vh] = String(svg?.props.source).match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)?.slice(1).map(Number) ?? []
  expect(svg?.props.height).toBe(Math.round(((vh ?? 0) * 950) / (vw ?? 1)))

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect(await band.find({ text: ' 3d 9h' })).toBeDefined()
  // Opus 5.5: 770k tokens at the 1-hour write price, 2 x $4 per million.
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  await band.unmount()
})

test('squeezed, the folded cache stacks as a third block, then takes its own row', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const half = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 53 } })
  expect(await half.find({ key: 'block' })).toBeDefined()
  expect(await half.find({ text: '42m left' })).toBeDefined()
  expect(await half.find({ text: '$0.15' })).toBeDefined()
  await half.unmount()

  const narrow = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, maxRows: 40, bodyColumns: 33 } })
  expect(await narrow.find({ key: 'cache' })).toBeDefined()
  await narrow.press({ key: 'cache-fold' })
  // Narrow's card is the compact one, drawn at 38 columns: a 456 px band.
  expect(JSON.stringify(await narrow.find({ key: 'card' }))).toContain('"width":456')
  await narrow.unmount()
})

test('the terminal draws the cache as text, with no drawings and no fold button', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' COLD ' })).toBeDefined()
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ key: 'cache-fold' })).toBeUndefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  await band.unmount()
})

test('a cleared session drops the cache until the next reply', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  await $.classic.SessionStart({ source: 'clear' })

  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Only the usage bars: no mascot, no chip, no card.
  expect((await band.findAll({ type: 'Svg' })).map(s => s.props.alt)).toEqual(['7D 99%', '5H 82%'])
  expect(await band.find({ text: ' 99%' })).toBeDefined()
  await band.unmount()
})

// What the band draws, in the rows it asks for: its own lines plus the card at ROW_PX a row.
const rowsOf = async (band: { findAll: (q: { type: 'Svg' }) => Promise<Array<{ props: Record<string, unknown> }>> }) => {
  const card = (await band.findAll({ type: 'Svg' })).find(s => String(s.props.alt).startsWith('Cache'))
  return { card, rows: card ? HEAD_ROWS.wide + Math.ceil(Number(card.props.height) / ROW_PX) : 0 }
}

test('an open card stays inside maxRows with the one-line strip, else no card and no Show button', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const draw = (maxRows: number) =>
    $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 140, maxRows, scroll: { offset: 0, bodyRows: maxRows } } })
  const full = await draw(12)
  const { card: c12, rows: r12 } = await rowsOf(full)
  expect(c12).toBeDefined()
  expect(r12).toBeLessThanOrEqual(12)
  // Always the one-line strip: the full one ran a hair past the desktop's window and scrolled.
  expect(Number(c12?.props.height)).toBe(200)
  expect(String(c12?.props.source)).toContain('width="950" height="200"')
  await full.unmount()

  const ten = await draw(10)
  const { card: c10, rows: r10 } = await rowsOf(ten)
  expect(r10).toBeLessThanOrEqual(10)
  expect(Number(c10?.props.height)).toBe(200)
  await ten.unmount()

  const none = await draw(5)
  expect((await rowsOf(none)).card).toBeUndefined()
  expect(await none.find({ key: 'cache-fold' })).toBeUndefined()
  expect(await none.find({ key: 'card' })).toBeUndefined()
  await none.unmount()
})

test("with another mod's band beneath, the card leaves it room instead of making the band scroll", async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 140, maxRows: 10, scroll: { offset: 0, bodyRows: 10 } } })
  expect(await band.find({ text: 'other band' })).toBeDefined()
  expect((await rowsOf(band)).card).toBeUndefined()
  await band.unmount()
})
