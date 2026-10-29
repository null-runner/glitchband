import { expect, mock, test as kitTest } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { en } from '../src/i18n/en'
import { it } from '../src/i18n/it'
import { fmtInt, fmtMinutes, resolveLanguage, setLanguage, t } from '../src/i18n'
import { answerSession } from './answers'
import { testEn as test, testIt } from './lang'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 58, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 12.5 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 36,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? '').sort()

const engineWith = (settings: Record<string, unknown> | 'throws', env: Record<string, string> = {}): EngineInterface =>
  ({
    settings: { read: async () => { if (settings === 'throws') throw new Error('no settings'); return settings } },
    env: { get: async (name: string) => env[name] },
  }) as unknown as EngineInterface

test('both languages carry every key, each with the same parameters', () => {
  expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort())
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    expect(placeholders(it[key])).toEqual(placeholders(en[key]))
    expect(it[key].trim()).not.toBe('')
  }
})

test('t fills parameters in the language in use and formats numbers with its separator', () => {
  setLanguage('en')
  expect(t('kw.until', { time: '18:30' })).toBe('until 18:30')
  expect(fmtInt(200502)).toBe('200,502')
  expect(fmtMinutes((3 * 24 + 9) * 60)).toBe('3d 9h')
  setLanguage('it')
  expect(t('kw.until', { time: '18:30' })).toBe('fino 18:30')
  expect(fmtInt(200502)).toBe('200.502')
  expect(fmtMinutes((3 * 24 + 9) * 60)).toBe('3g 9h')
  setLanguage('en')
})

test('an explicit language is taken as given', async () => {
  const $ = engineWith({ language: 'italiano' })
  expect(await resolveLanguage($, 'en')).toBe('en')
  expect(await resolveLanguage($, 'it')).toBe('it')
})

test('auto follows the Claude Code language setting, then the system locale, then English', async () => {
  expect(await resolveLanguage(engineWith({ language: 'Italian' }, { LANG: 'en_US.UTF-8' }), 'auto')).toBe('it')
  expect(await resolveLanguage(engineWith({ language: 'english' }, { LANG: 'it_IT.UTF-8' }), 'auto')).toBe('en')
  expect(await resolveLanguage(engineWith({}, { LANG: 'it_IT.UTF-8' }), 'auto')).toBe('it')
  expect(await resolveLanguage(engineWith({}, { LC_ALL: 'de_DE.UTF-8', LANG: 'it_IT.UTF-8' }), 'auto')).toBe('en')
  expect(await resolveLanguage(engineWith({}), 'auto')).toBe('en')
  expect(await resolveLanguage(engineWith('throws'), 'auto')).toBe('en')
})

test('the band follows the language option', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '42% left' })).toBeDefined()
  expect(await band.find({ text: 'resets 2h 0m' })).toBeDefined()
  await band.unmount()
})

testIt('in Italian the band, its reset line and the command text are Italian', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '42% rimasti' })).toBeDefined()
  expect(await band.find({ text: 'reset tra 2h 0m' })).toBeDefined()
  await band.unmount()
  const r = await $.command.run({ command: 'keepwarm', args: 'boh', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toBe('keepwarm vuole una finestra come 6h o 90m, oppure always, off o status')
})

kitTest('auto reads the language from the Claude Code setting when the session starts', { options: { language: 'auto' } }, async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('settings.read', () => ({ value: { language: 'it' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const r = await $.command.run({ command: 'keepwarm', args: 'boh', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toMatch(/^keepwarm vuole una finestra/)
})
