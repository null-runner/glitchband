import { expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { answerSession } from './answers'
import { testIt as test } from './lang'

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
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_IDLE = 18 * 60
const COLD_IDLE = (3 * 24 + 9) * 3600

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const pad = (n: number): string => String(n).padStart(2, '0')
const clock = (ms: number): string => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

// A resumed session with a warm (or cold) cache and no keepwarm window yet.
const resumed = async ($: Engine, on: On, idle = WARM_IDLE) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  answerSession(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: idle, context_tokens: 770000, model: 'claude-opus-5-5' })
}

const keepwarm = ($: Engine, args: string) =>
  $.command.run({ command: 'keepwarm', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

test('the band says until when keepwarm holds the cache, and keepwarm off when it is not armed', async ($, on) => {
  await resumed($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'keepwarm off' })).toBeDefined()
  expect((await band.find({ key: 'keepwarm-toggle' }))?.props.label).toBe('Arma 6h')

  await keepwarm($, '')
  expect(await band.find({ text: `fino ${clock(NOW + 6 * HOUR)}` })).toBeDefined()
  expect(await band.find({ text: 'KEEPWARM ' })).toBeDefined()
  expect(await band.find({ text: 'keepwarm off' })).toBeUndefined()

  await keepwarm($, 'always')
  expect(await band.find({ text: 'sempre' })).toBeDefined()
  await band.unmount()
})

test('/keepwarm off disarms and the band follows', async ($, on) => {
  await resumed($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await keepwarm($, '90m')
  expect(await band.find({ text: `fino ${clock(NOW + 1.5 * HOUR)}` })).toBeDefined()

  await keepwarm($, 'off')
  expect(await band.find({ text: 'keepwarm off' })).toBeDefined()
  expect(await band.find({ text: /^fino / })).toBeUndefined()
  expect((await band.find({ key: 'keepwarm-toggle' }))?.props.label).toBe('Arma 6h')
  await band.unmount()
})

test('the keepwarm button arms for 6h and disarms, on every surface', async ($, on) => {
  await resumed($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'glitchband', surface, component: 'AbovePrompt', props: PROPS })
    const short = surface === 'terminal'

    await band.press({ key: 'keepwarm-toggle' })
    expect(await band.find({ text: short ? clock(NOW + 6 * HOUR) : `fino ${clock(NOW + 6 * HOUR)}` })).toBeDefined()
    expect((await band.find({ key: 'keepwarm-toggle' }))?.props.label).toBe(short ? 'Off' : 'Disarma')

    await band.press({ key: 'keepwarm-toggle' })
    expect(await band.find({ text: short ? 'KW off' : 'keepwarm off' })).toBeDefined()
    expect((await band.find({ key: 'keepwarm-toggle' }))?.props.label).toBe(short ? 'On' : 'Arma 6h')
    await band.unmount()
  }
})

test('a narrow band and the terminal say keepwarm in short form', async ($, on) => {
  await resumed($, on)
  await keepwarm($, '')
  const tight = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 36 } })
  expect(await tight.find({ text: 'KW ' })).toBeDefined()
  expect(await tight.find({ text: clock(NOW + 6 * HOUR) })).toBeDefined()
  expect(await tight.find({ text: 'KEEPWARM ' })).toBeUndefined()
  await tight.unmount()

  const stacked = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 53 } })
  expect(await stacked.find({ text: `fino ${clock(NOW + 6 * HOUR)}` })).toBeDefined()
  await stacked.unmount()
})

test('a wide band keeps keepwarm on the cache row: in full from 150 columns, short under, folded into its button under 110', async ($, on) => {
  await resumed($, on)
  const wide = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await wide.find({ key: 'kw' })).toBeDefined()
  expect(await wide.find({ key: 'kwrow' })).toBeUndefined()
  expect(await wide.find({ text: 'keepwarm off' })).toBeDefined()
  await wide.unmount()

  const medium = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 100 } })
  expect(await medium.find({ key: 'kwrow' })).toBeUndefined()
  expect((await medium.find({ key: 'keepwarm-toggle' }))?.props.label).toBe('KW off')
  expect(await medium.find({ key: 'cache-fold' })).toBeDefined()
  expect(await medium.find({ text: / rimasti/ })).toBeUndefined()
  await medium.press({ key: 'keepwarm-toggle' })
  expect((await medium.find({ key: 'keepwarm-toggle' }))?.props.label).toBe(`KW ${clock(NOW + 6 * HOUR)}`)
  await medium.unmount()

  const roomy = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 120 } })
  expect(await roomy.find({ text: /% rimasti/ })).toBeDefined()
  expect(await roomy.find({ key: 'kw' })).toBeDefined()
  await roomy.unmount()
})

test('the card lists the keepwarm state, the pings and the cold writes', async ($, on) => {
  await resumed($, on, COLD_IDLE)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const off = JSON.stringify(await band.find({ key: 'card' }))
  for (const row of ['KEEPWARM', 'PING INVIATI', 'SCRITTURE A FREDDO', 'Keepwarm off.']) expect(off).toContain(row)
  expect(off).toContain('0 · ~$0.00')

  await keepwarm($, '')
  expect(JSON.stringify(await band.find({ key: 'card' }))).toContain(`Keepwarm fino ${clock(NOW + 6 * HOUR)}.`)
  await band.unmount()
})

test('before the first reply the band shows keepwarm only once it is armed', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  answerSession(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ key: 'kwrow' })).toBeUndefined()
  await keepwarm($, '')
  expect(await band.find({ text: `fino ${clock(NOW + 6 * HOUR)}` })).toBeDefined()
  await band.unmount()
})
