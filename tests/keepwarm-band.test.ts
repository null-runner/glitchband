import { expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { setLanguage } from '../src/i18n'
import { kwCard } from '../src/keepwarm/view'
import { cardSvg } from '../src/ui/card'
import { AMBER, HUE, BTN_CHROME, SAFETY_PX, SELECT_CHROME, CELL_PX, CHAR_PX, CHIP_EDGE, PAD_PX } from '../src/ui/theme'
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

const kwValueOf = async (band: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
  (await band.find({ key: 'keepwarm-select' }))?.props.value

const keepwarm = ($: Engine, args: string) =>
  $.command.run({ command: 'keepwarm', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

test('the band says until when keepwarm holds the cache, and keepwarm off when it is not armed', async ($, on) => {
  await resumed($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'keepwarm off' })).toBeDefined()
  expect(await kwValueOf(band)).toBe('off')

  await keepwarm($, '')
  expect(await band.find({ text: `fino ${clock(NOW + 6 * HOUR)}` })).toBeDefined()
  expect(await band.find({ text: 'KEEPWARM ' })).toBeDefined()
  expect(await band.find({ text: 'keepwarm off' })).toBeUndefined()

  expect(await kwValueOf(band)).toBe('6h')
  await keepwarm($, 'always')
  expect(await band.find({ text: 'sempre' })).toBeDefined()
  expect(await kwValueOf(band)).toBe('always')
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
  expect(await kwValueOf(band)).toBe('off')
  await band.unmount()
})

test('each choice of the keepwarm select does what its /keepwarm command does, on every surface', async ($, on) => {
  await resumed($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'glitchband', surface, component: 'AbovePrompt', props: PROPS })
    const short = surface === 'terminal'
    expect((await band.find({ key: 'keepwarm-select' }))?.props.label).toBe('KW')
    expect(((await band.find({ key: 'keepwarm-select' }))?.props.options as Array<{ value: string }>).map(o => o.value)).toEqual(['off', '90m', '6h', '12h', 'always'])

    await band.select({ key: 'keepwarm-select', value: '6h' })
    expect(await band.find({ text: short ? clock(NOW + 6 * HOUR) : `fino ${clock(NOW + 6 * HOUR)}` })).toBeDefined()
    expect(await kwValueOf(band)).toBe('6h')

    await band.select({ key: 'keepwarm-select', value: '90m' })
    expect(await band.find({ text: short ? clock(NOW + 1.5 * HOUR) : `fino ${clock(NOW + 1.5 * HOUR)}` })).toBeDefined()
    expect(await kwValueOf(band)).toBe('90m')

    await band.select({ key: 'keepwarm-select', value: '12h' })
    expect(await kwValueOf(band)).toBe('12h')

    await band.select({ key: 'keepwarm-select', value: 'always' })
    expect(await kwValueOf(band)).toBe('always')

    await band.select({ key: 'keepwarm-select', value: 'off' })
    expect(await band.find({ text: short ? 'KW off' : 'keepwarm off' })).toBeDefined()
    expect(await kwValueOf(band)).toBe('off')
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
  expect((await medium.find({ key: 'keepwarm-select' }))?.props.label).toBe('KW')
  expect(await medium.find({ key: 'kw' })).toBeUndefined()
  expect(await medium.find({ key: 'cache-fold' })).toBeDefined()
  expect(await medium.find({ text: / rimasti/ })).toBeUndefined()
  await medium.select({ key: 'keepwarm-select', value: '6h' })
  expect(await kwValueOf(medium)).toBe('6h')
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
  expect(JSON.stringify(await band.find({ key: 'card' }))).toContain(`Keepwarm attivo fino ${clock(NOW + 6 * HOUR)}.`)
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

// The hover override rides on the Button node of the tree, under the keyed Box that scopes it.
const hoverOf = async (band: { find: (q: { key: string }) => Promise<unknown> }, box: string) =>
  ((await band.find({ key: box })) as { children?: Array<{ hover?: unknown }> } | undefined)?.children?.[0]?.hover

test('Show / Hide is a secondary button that lights in the cache colour; the keepwarm control is a Select', async ($, on) => {
  await resumed($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const fold = await band.find({ key: 'cache-fold' })
  expect(fold?.props.variant).toBe('secondary')
  expect(await hoverOf(band, 'fold')).toEqual({ color: CHIP_EDGE.warm })
  expect(await band.find({ key: 'keepwarm-toggle' })).toBeUndefined()
  await band.unmount()
})

test('the select value follows /keepwarm: a window not in the list falls to the nearest above, a longer one to On', async ($, on) => {
  await resumed($, on)
  const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await keepwarm($, '2h')
  expect(await kwValueOf(band)).toBe('6h')
  await keepwarm($, '20h')
  expect(await kwValueOf(band)).toBe('on')
  expect(((await band.find({ key: 'keepwarm-select' }))?.props.options as Array<{ value: string }>).map(o => o.value)).toContain('on')
  await band.unmount()
})

// What the wide row is estimated to take, in pixels, from its parts: text by characters, drawings by their width, buttons and the select with their chrome.
type Node = { type: string; props?: Record<string, unknown>; children?: Array<Node | string> }
const cells = (v: unknown): number => (typeof v === 'number' ? v : v === 'md' ? 1 : 0)
const px = (n: Node | string): number => {
  if (typeof n === 'string') return n.length * CHAR_PX
  const props = n.props ?? {}
  if (n.type === 'Svg') return Number(props.width)
  if (n.type === 'Button') return String(props.label).length * CHAR_PX + BTN_CHROME
  if (n.type === 'Select') return `${String(props.label)} ${String((props.options as Array<{ label: string }>).reduce((a, o) => (o.label.length > a.length ? o.label : a), ''))}`.length * CHAR_PX + SELECT_CHROME
  const kids = (n.children ?? []).map(px)
  const inner = props.flexDirection === 'column' ? Math.max(0, ...kids) : kids.reduce((a, b) => a + b, 0)
  return n.type === 'Text' ? inner : inner + (cells(props.marginLeft) + cells(props.marginRight)) * CELL_PX
}

test('at 82 and 100 columns with keepwarm armed, the wide row fits its width and the select keeps its whole label', async ($, on) => {
  await resumed($, on)
  await keepwarm($, '')
  for (const columns of [82, 100]) {
    const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: columns } })
    const row = (await band.find({ key: 'row' })) as Node
    const flexible = (row.children ?? []).filter(c => typeof c !== 'string' && c.props?.flexGrow !== 1)
    expect(flexible.map(px).reduce((a, b) => a + b, 0), `${columns} columns`).toBeLessThanOrEqual(columns * CELL_PX - 2 * PAD_PX)
    const select = await band.find({ key: 'keepwarm-select' })
    expect(select?.props.label).toBe('KW')
    expect(await kwValueOf(band)).toBe('6h')
    expect(await band.find({ key: 'cache-fold' })).toBeDefined()
    // The reset times never go: they are on the row at every width.
    expect(JSON.stringify(row).includes(' · '), `${columns} columns: the reset times stayed`).toBe(true)
    await band.unmount()
  }
})

test('the card says the state in colour: on in coral with the next ping, stopped in amber with its reason, off quiet', () => {
  setLanguage('en')
  const now = Date.parse('2098-12-31T22:00:00Z')
  const base = { deadline: 0, every: 50 * 60_000, always: false, lastRequestAt: now - 10 * 60_000, compacted: false, waitForTurn: false, retries: 0, stopped: null, last: null, pings: 2, pingUsd: 0.1, coldWrites: 0, coldUsd: 0 }
  const on = kwCard({ ...base, deadline: now + 5 * HOUR }, now)
  expect(on.tone).toBe('on')
  expect(on.state).toMatch(/^on until \d\d:\d\d$/)
  expect(on.note).toMatch(/^next ping ~\d\d:\d\d$/)
  expect(kwCard({ ...base, always: true }, now).state).toBe('always on')
  const stopped = kwCard({ ...base, stopped: 'it read nothing' }, now)
  expect(stopped).toMatchObject({ tone: 'stopped', state: 'stopped: it read nothing', note: '' })
  expect(kwCard(null, now)).toMatchObject({ tone: 'off', state: 'off' })
  const svg = cardSvg({ mode: 'warm', idle: '18m', idleMin: 18, tokens: 770000, window: 1000000, mine: 'opus' }, 'wide', 1000, on).source
  expect(svg).toMatch(new RegExp(`fill="${HUE.warm}"[^>]*>on until`))
  expect(cardSvg({ mode: 'warm', idle: '18m', idleMin: 18, tokens: 770000, window: 1000000, mine: 'opus' }, 'wide', 1000, stopped).source).toMatch(new RegExp(`fill="${AMBER}"[^>]*>stopped:`))
})
