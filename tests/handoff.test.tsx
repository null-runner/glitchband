import { expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { readOptions } from '../src/options'
import { answerSession } from './answers'
import { testEn as test } from './lang'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: new Date(NOW + (4 * 60 + 41) * 60_000).toISOString() },
  { kind: 'seven_day', percentUsed: 1, resetsAt: new Date(NOW + (16 * 60 + 41) * 60_000).toISOString() },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const HANDOFF = '# Handoff: the port\n\nGoal: ship it.'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const pad = (n: number): string => String(n).padStart(2, '0')
const d = new Date(NOW)
const STAMP = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
const PATH = `/home/u/.claude/handoffs/${STAMP}-S1.md`

// A resumed session with `tokens` of context; every engine call the handoff makes is recorded in `log`.
const setup = async ($: Engine, on: On, tokens = 612000, fork: () => unknown = () => ({ isAnswered: true, text: HANDOFF, usage: { input_tokens: 1, output_tokens: 1 } }), fail: { clear?: boolean; write?: boolean } = {}) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  answerSession(on)
  const log: string[] = []
  const toasts: string[] = []
  const writes: Array<{ path: string; text: string }> = []
  const sent: string[] = []
  const filled: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('env.get', () => ({ value: '/home/u' }))
  on('model.fork', async () => {
    log.push('fork')
    return { value: (await fork()) as never }
  })
  on('fs.write', (_, e) => { if (fail.write) throw new Error('disk full'); log.push('write'); writes.push(e); return { value: undefined } })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('command.run', { command: 'clear' }, () => { if (fail.clear) throw new Error('no clear'); log.push('clear'); return { text: '' } })
  on('prompt.submit', (_, e) => { log.push('submit'); sent.push(e.text); return { text: e.text } })
  on('prompt.fill', (_, e) => { log.push('fill'); filled.push(e.text); return { isFilled: true } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 18 * 60, context_tokens: tokens, model: 'claude-opus-5-5' })
  return { log, toasts, writes, sent, filled }
}

const mount = ($: Engine, bodyColumns = 140, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: 'glitchband', surface, component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })

test('the handoff option is read like the others: 0 is off, a bad value falls back to 600000', () => {
  expect(readOptions({}).handoffAt).toBe(600000)
  expect(readOptions({ handoffAt: 0 }).handoffAt).toBe(0)
  expect(readOptions({ handoffAt: 250000 }).handoffAt).toBe(250000)
  expect(readOptions({ handoffAt: 3000000 }).handoffAt).toBe(600000)
  expect(readOptions({ handoffAt: -1 }).handoffAt).toBe(600000)
  expect(readOptions({ handoffAt: 'big' }).handoffAt).toBe(600000)
})

test('below the threshold there is no Refresh button', async ($, on) => {
  await setup($, on, 599999)
  const below = await mount($)
  expect(await below.find({ key: 'handoff' })).toBeUndefined()
  await below.unmount()
})

test('at the threshold the button shows, as Refresh and the count when the row has room', async ($, on) => {
  await setup($, on, 600000)
  const band = await mount($)
  expect((await band.find({ key: 'handoff' }))?.props.label).toMatch(/^Refresh( 600k)?$/)
  await band.unmount()
})

test('handoffAt 0 never shows the button', { options: { handoffAt: 0 } }, async ($, on) => {
  await setup($, on, 900000)
  const band = await mount($)
  expect(await band.find({ key: 'handoff' })).toBeUndefined()
  await band.unmount()
})

test('the narrow layouts and the terminal carry a short Refresh', async ($, on) => {
  await setup($, on)
  for (const [columns, surface] of [[53, 'desktop'], [36, 'desktop'], [140, 'terminal']] as const) {
    const band = await mount($, columns, surface)
    expect((await band.find({ key: 'handoff' }))?.props.label, `${columns} ${surface}`).toBe('Refresh')
    await band.unmount()
  }
})

test('the reset times are always on the row, with the handoff button, Show and the select too', async ($, on) => {
  await setup($, on)
  for (const [columns, surface] of [[100, 'desktop'], [110, 'desktop'], [140, 'desktop'], [100, 'terminal'], [110, 'terminal'], [140, 'terminal']] as const) {
    const band = await mount($, columns, surface)
    const where = `${columns} ${surface}`
    expect(await band.find({ text: /· 16h/ }), `${where}: 7D reset`).toBeDefined()
    expect(await band.find({ text: /· 4h/ }), `${where}: 5H reset`).toBeDefined()
    expect(await band.find({ key: 'cache-fold' }), `${where}: Show`)[surface === 'desktop' ? 'toBeDefined' : 'toBeUndefined']()
    // The button gives way last, after the reset times shorten; a compact desktop row has no room left for it.
    if (!(surface === 'desktop' && columns < 110)) expect(await band.find({ key: 'handoff' }), `${where}: Refresh`).toBeDefined()
    expect(await band.find({ key: 'keepwarm-select' }), `${where}: select`).toBeDefined()
    await band.unmount()
  }
})

test('as the row narrows the handoff count goes first, the handoff button before Show, and the reset times stay', async ($, on) => {
  await setup($, on)
  const seen: Array<{ columns: number; label: unknown; word: boolean; reset: boolean }> = []
  for (const columns of [200, 160, 140, 120, 100, 90, 82]) {
    const band = await mount($, columns)
    const row = JSON.stringify(await band.find({ key: 'row' }))
    seen.push({ columns, label: (await band.find({ key: 'handoff' }))?.props.label, word: row.includes('USAGE'), reset: row.includes('· 16h') && row.includes('· 4h') })
    expect(await band.find({ key: 'cache-fold' }), `${columns}: Show`).toBeDefined()
    expect(await band.find({ key: 'keepwarm-select' }), `${columns}: select`).toBeDefined()
    await band.unmount()
  }
  expect(seen.every(s => s.reset)).toBe(true)
  // The USAGE word never goes while the button still has its count, and the button never goes while the word stays.
  for (const s of seen) {
    if (s.label === 'Refresh 612k') expect(s.word, `${s.columns}`).toBe(true)
    if (s.label === undefined) expect(s.word, `${s.columns}: button dropped last`).toBe(false)
  }
})

test('pressing writes the file first, then clears the chat and sends the handoff as the first message', async ($, on) => {
  const r = await setup($, on)
  const band = await mount($)
  await band.press({ key: 'handoff' })
  expect(r.log).toEqual(['fork', 'write', 'clear', 'submit'])
  expect(r.writes).toEqual([{ path: PATH, text: HANDOFF }])
  expect(r.sent).toEqual([`Continue from this handoff (saved at ${PATH}):\n\n${HANDOFF}`])
  expect(r.toasts.length).toBe(1)
  expect(r.toasts[0]).toContain(PATH)
  expect((await band.find({ key: 'handoff' }))?.props.label).not.toBe('Writing handoff…')
  await band.unmount()
})

test('when the chat cannot be cleared the handoff is filled into the prompt instead', async ($, on) => {
  const r = await setup($, on, 612000, undefined, { clear: true })
  const band = await mount($)
  await band.press({ key: 'handoff' })
  expect(r.sent).toEqual([])
  expect(r.filled).toEqual([`Continue from this handoff (saved at ${PATH}):\n\n${HANDOFF}`])
  expect(r.writes.length).toBe(1)
  expect(r.toasts[0]).toContain(PATH)
  await band.unmount()
})

test('a failing completion toasts why, writes nothing, clears nothing and can be pressed again', async ($, on) => {
  let n = 0
  const r = await setup($, on, 612000, () => (n++ === 0 ? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' } : { isAnswered: true, text: HANDOFF, usage: { input_tokens: 1, output_tokens: 1 } }))
  const band = await mount($)
  await band.press({ key: 'handoff' })
  expect(r.log).toEqual(['fork'])
  expect(r.writes).toEqual([])
  expect(r.toasts.length).toBe(1)
  expect(r.toasts[0]).toMatch(/api-error|overloaded/)
  expect((await band.find({ key: 'handoff' }))?.props.label).toMatch(/^Refresh/)

  await band.press({ key: 'handoff' })
  expect(r.log).toEqual(['fork', 'fork', 'write', 'clear', 'submit'])
  await band.unmount()
})

test('a write that fails stops before clearing', async ($, on) => {
  const r = await setup($, on, 612000, undefined, { write: true })
  const band = await mount($)
  await band.press({ key: 'handoff' })
  expect(r.log).toEqual(['fork'])
  expect(r.toasts[0]).toMatch(/^Handoff failed: /)
  expect(r.toasts[0]).not.toContain(PATH)
  await band.unmount()
})

test('a second press while the handoff is writing does nothing', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(res => { release = res })
  const r = await setup($, on, 612000, async () => {
    await gate
    return { isAnswered: true, text: HANDOFF, usage: { input_tokens: 1, output_tokens: 1 } }
  })
  const band = await mount($)
  const first = band.press({ key: 'handoff' })
  await new Promise(res => setTimeout(res, 20))
  expect((await band.find({ key: 'handoff' }))?.props.label).toBe('Writing handoff…')
  await band.press({ key: 'handoff' })
  release()
  await first
  expect(r.log.filter(x => x === 'fork').length).toBe(1)
  expect(r.log.filter(x => x === 'write').length).toBe(1)
  await band.unmount()
})

test('/glitchband says the handoff threshold, or off', async ($, on) => {
  await setup($, on)
  const run = () => $.command.run({ command: 'glitchband', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((await run()).text).toMatch(/handoff {5}at 600,000 tokens/)
})

test('/glitchband says handoff off when the option is 0', { options: { handoffAt: 0 } }, async ($, on) => {
  await setup($, on)
  const r = await $.command.run({ command: 'glitchband', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toMatch(/handoff {5}off \(handoffAt option\)/)
})
