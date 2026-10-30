import { expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { readOptions } from '../src/options'
import { answerSession } from './answers'
import { testEn as test } from './lang'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const HOUR = 60 * 60 * 1000
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const COLD_IDLE = (3 * 24 + 9) * 3600

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// A resumed session with a cold cache of 770k tokens.
const resumedCold = async ($: Engine, on: On) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  answerSession(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5', prompt_cache_likely_expired: true })
}

const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

test('the defaults keep the behaviour the band has always had', () => {
  expect(readOptions({})).toEqual({
    language: 'en',
    compactBelow: 110,
    cardScale: 1,
    keepwarmWindow: { text: '6h', ms: 6 * HOUR },
    coldGuard: true,
    handoffAt: 600000,
  })
})

test('valid values are taken, a duration is normalised', () => {
  expect(readOptions({ language: 'it', compactBelow: 90, cardScale: 2, keepwarmWindow: ' 2H30m ', coldGuard: false })).toEqual({
    language: 'it',
    compactBelow: 90,
    cardScale: 2,
    keepwarmWindow: { text: '2h30m', ms: 150 * 60 * 1000 },
    coldGuard: false,
    handoffAt: 600000,
  })
})

test('auto is kept, anything else but it falls back to en', () => {
  expect(readOptions({ language: 'auto' }).language).toBe('auto')
  expect(readOptions({ language: 'it' }).language).toBe('it')
  expect(readOptions({ language: 'fr' }).language).toBe('en')
})

test('an invalid value falls back to its default', () => {
  const bad = readOptions({ language: 'fr', compactBelow: 5, cardScale: Number.NaN, keepwarmWindow: 'soon', coldGuard: 'no' })
  expect(bad).toEqual(readOptions({}))
  expect(readOptions({ compactBelow: 'wide', cardScale: 99, keepwarmWindow: '100h' })).toEqual(readOptions({}))
  expect(readOptions({ keepwarmWindow: '0m' }).keepwarmWindow.ms).toBe(6 * HOUR)
})

test('keepwarmWindow is the configured entry of the select, once, and a pick arms it', { options: { keepwarmWindow: '90m' } }, async ($, on) => {
  await resumedCold($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 160 } })
  const select = await band.find({ key: 'keepwarm-select' })
  expect((select?.props.options as Array<{ value: string }>).map(o => o.value)).toEqual(['off', '90m', '12h', 'always'])
  await band.select({ key: 'keepwarm-select', value: '90m' })
  const until = new Date(NOW + 1.5 * HOUR)
  const hm = `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`
  // The long form or the short one, whichever the row has room for.
  expect((await band.find({ text: `until ${hm}` })) ?? (await band.find({ text: new RegExp(`${hm}`) }))).toBeDefined()
  await band.unmount()
})

test('an invalid keepwarmWindow puts the 6h default in the select', { options: { keepwarmWindow: 'soon' } }, async ($, on) => {
  await resumedCold($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 160 } })
  const select = await band.find({ key: 'keepwarm-select' })
  expect((select?.props.options as Array<{ value: string }>).map(o => o.value)).toEqual(['off', '90m', '6h', '12h', 'always'])
  await band.unmount()
})

test('compactBelow moves the column where the wide row drops "left"', { options: { compactBelow: 90 } }, async ($, on) => {
  await resumedCold($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: /% left/ })).toBeDefined()
  await band.unmount()
})

test('by default 100 columns is compact', async ($, on) => {
  await resumedCold($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: /% left/ })).toBeUndefined()
  await band.unmount()
})

test('cardScale sets how much narrower the card is laid out', { options: { cardScale: 2 } }, async ($, on) => {
  await resumedCold($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, maxRows: 40, bodyColumns: 80 } })
  // 80 columns is a 1020 px band, capped at 950 px; at scale 2 the card is laid out 475 px wide.
  expect(JSON.stringify(await band.find({ key: 'card' }))).toContain('viewBox=\\"0 0 475 ')
  await band.unmount()
})

test('the guard holds a cold send once by default', async ($, on) => {
  await resumedCold($, on)
  expect((await submit($, 'hi')).drop).toMatch(/^glitchband: the prompt cache went cold/)
})

test('coldGuard off lets the cold send through untouched', { options: { coldGuard: false } }, async ($, on) => {
  await resumedCold($, on)
  expect((await submit($, 'hi')).drop).toBe(undefined)
})

test('coldGuard off says so in /glitchband and in the guard command', { options: { coldGuard: false } }, async ($, on) => {
  await resumedCold($, on)
  const run = (args: string) => $.command.run({ command: 'glitchband', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((await run('')).text).toMatch(/guard       off \(coldGuard option\)/)
  expect((await run('guard refuse')).text).toMatch(/coldGuard option is off/)
})
