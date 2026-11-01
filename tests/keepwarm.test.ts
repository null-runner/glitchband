import { describe, expect, mock, tier } from 'claude-code/testing'
import type { MockClock, Plugin, TestBody } from 'claude-code/testing'
import type { CommandRunInput, EngineInterface, ModelForkResult, On, PromptSubmitInput, SessionStartInput, TurnCompleteInput, TurnUsage } from 'claude-code'

import { keepwarmCommand } from '../src/keepwarm/commands'
import { fmtDuration, freshState, pingAfterMs, parseDuration, readKeepwarm, resetForClear, seedFromResume, sessionStart, statusText, turnComplete } from '../src/keepwarm/engine'
import type { State } from '../src/keepwarm/engine'
import { testEn as test } from './lang'

tier('user')

const MIN = 60 * 1000
const HOUR = 60 * MIN
const START = 1_000_000

// The clock the test just mocked: the world reads its time where a hook beneath the plugin cannot call $.clock.
let lastClock: MockClock
const mockClock = (on: On, options: { now: number }): MockClock => (lastClock = mock.clock(on, options))

// The band redraws every 30 s, one wait each: a long jump goes a day at a time, under the kit's cap for one advance.
const jump = async (clock: MockClock, ms: number): Promise<void> => {
  for (let left = ms; left > 0; left -= 24 * HOUR) await clock.advance(Math.min(left, 24 * HOUR))
}

const session: SessionStartInput = { surface: null, isInteractive: false, cwd: '/work' }

const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({
  input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 200000, cache_creation_input_tokens: 500, model: 'claude-fable-5-1', ...over,
})

// TurnCompleteInput is a union on `reason`; the tests only drive the answered arm.
type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>
let turns = 0
const turn = (over: Partial<AnsweredTurn> = {}): TurnCompleteInput => ({
  answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' + ++turns, reason: 'answer', usage: usage(), ...over,
})

const run = (command: 'keepwarm' | 'glitchband', args: string): CommandRunInput => ({
  command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const prompt = (text: string): PromptSubmitInput => ({ text, wait: false, origin: { kind: 'composer' } })

type ForkAnswer = null | ModelForkResult | { read: number; write: number; out?: number; input?: number }

// The world beneath the mod: its store, the engine's answers, and a fork that
// replies from a script so each test decides what the cache looked like.
function world(on: On, forkAnswers: ForkAnswer[], opts: { now?: () => number; store?: Map<string, unknown>; commands?: string[]; live?: { tokens?: number }; startedAt?: () => number; sid?: string | (() => string); model?: string | (() => string); gate?: () => Promise<void>; steps?: TurnUsage[]; storeGate?: (op: 'get' | 'set' | 'delete', key: string) => Promise<void> } = {}) {
  if (opts.store) {
    const store = opts.store
    // A read takes its value first and is delivered after the gate, as a reply can arrive late.
    on('store.get', async ($, e) => { const value = store.get(e.key); await opts.storeGate?.('get', e.key); return { value } })
    on('store.set', async ($, e) => { await opts.storeGate?.('set', e.key); store.set(e.key, e.value); return { value: undefined } })
    on('store.delete', async ($, e) => { await opts.storeGate?.('delete', e.key); store.delete(e.key); return { value: undefined } })
    on('store.keys', () => ({ value: [...store.keys()] }))
  } else mock.store(on, {})
  const forks: number[] = []
  // What /keepwarm used to put on the status line: the text of the facts the band draws from, at each publish.
  const clock = lastClock
  const nowMs = opts.now ?? (() => clock.now())
  const status: Array<string | undefined> = []
  on('state.set', { plugin: 'glitchband', key: 'keepwarm' }, ($, e, next) => {
    status.push(e.value ? statusText(e.value, nowMs()) : undefined)
    return next(e)
  })
  const logs: string[] = []
  const entered: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: typeof opts.sid === 'function' ? opts.sid() : opts.sid ?? 'S1' }))
  on('session.model', () => ({ value: (typeof opts.model === 'function' ? opts.model() : opts.model) ?? 'claude-fable-5-1' }))
  on('session.usage', () => ({ value: { startedAt: opts.startedAt?.() ?? START, context: { window: 1000000, tokens: opts.live?.tokens }, rateLimits: [] } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: (opts.commands ?? []).map(name => ({ name, description: '', source: 'plugin' as const })) }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    const u = opts.steps?.shift() ?? null
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: u }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: u }
  })
  on('prompt.submit', ($, e) => { entered.push(e.text); return { text: e.text } })
  on('session.compact', ($, e) => ({ messages: e.messages }))
  on('classic.SessionStart', () => ({}))
  on('ui.log', ($, e) => { logs.push(e.text); return { value: undefined } })
  on('model.fork', async () => {
    forks.push(forks.length)
    if (opts.gate) await opts.gate()
    const a = forkAnswers.shift()
    // Older Claude Code releases returned null instead of a failure object.
    if (a === null || a === undefined) return { value: null as unknown as ModelForkResult }
    if ('isAnswered' in a) return { value: a }
    const value: ModelForkResult = { isAnswered: true, text: 'warm', usage: { input_tokens: a.input ?? 2, output_tokens: a.out ?? 1, cache_read_input_tokens: a.read, cache_creation_input_tokens: a.write } }
    return { value }
  })
  return { forks, status, logs, entered }
}

const warm: ForkAnswer = { read: 200000, write: 0 }
// A ping that finds nothing to fork leaves the window waiting, with a wake at the cold mark and no further fork.
const nothing: ForkAnswer = { isAnswered: false, reason: 'nothing-to-fork' }
const busy: ForkAnswer = { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: usage() }

describe('window and pings', () => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile', null] as const) {
    test(`${surface ?? 'headless'}: the window's state reads the same on every surface`, async ($, on) => {
      mockClock(on, { now: START })
      const w = world(on, [])
      await $.session.start({ ...session, surface })
      await $.turn.complete(turn())
      await $.command.run(run('keepwarm', '90m'))
      expect(w.status.at(-1)).toBe('keepwarm 1h30m left · ping in 30m')
      expect(w.forks.length).toBe(0)
    })
  }

  test('cold resume, compaction and clear reset the window without a ping', async ($, on) => {
    const clock = mockClock(on, { now: 10 * HOUR })
    const w = world(on, [], { store: new Map([['glitchband.deadline:S1', 13 * HOUR]]) })
    await $.session.start({ ...session, surface: 'terminal', isInteractive: true })
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 7200, context_tokens: 200000, prompt_cache_likely_expired: true })
    expect(w.status.at(-1)).toMatch(/cold now/)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    expect(w.status.at(-1)).toMatch(/waiting for the first turn after compaction/)
    await clock.advance(HOUR)
    expect(w.forks.length).toBe(0)
    await $.turn.complete(turn())
    expect(w.status.at(-1)).toMatch(/ping in 30m/)
    await $.classic.SessionStart({ source: 'clear' })
    expect(w.status.at(-1)).toBe(undefined)
    await clock.advance(HOUR)
    expect(w.forks.length).toBe(0)
  })

  test('window expiry ends the window without a ping', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [])
    await $.session.start({ ...session, surface: 'terminal', isInteractive: true })
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '10m'))
    await clock.advance(10 * MIN)
    expect(w.status.at(-1)).toBe(undefined)
    expect(w.forks.length).toBe(0)
  })

  test('a warm resume restores the window and ignores subagent cache activity', async ($, on) => {
    const clock = mockClock(on, { now: 10 * HOUR })
    const w = world(on, [nothing], { store: new Map<string, unknown>([['glitchband.deadline:S1', 13 * HOUR]]) })
    await $.session.start({ ...session, surface: 'terminal', isInteractive: true })
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 30 * 60, context_tokens: 200000 })
    await $.turn.complete(turn({ agentId: 'worker' }))
    await $.session.compact({ trigger: 'manual', agentId: 'worker', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    await clock.advance(30 * MIN)
    expect(w.status.at(-1)).toMatch(/cold now/)
    expect(w.forks.length).toBe(1)
  })

  test('a warm ping keeps the window and a cold read stops it', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm, { read: 0, write: 200000 }])
    await $.session.start({ ...session, surface: 'terminal', isInteractive: true })
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    expect(w.status.at(-1)).toMatch(/last ping read 200k/)
    await clock.advance(30 * MIN)
    expect(w.status.at(-1)).toMatch(/stopped.*cache was already gone/)
    await clock.advance(HOUR)
    expect(w.forks.length).toBe(2)
  })

  for (const failure of [
    { isAnswered: false, reason: 'api-error', status: 400, error: 'invalid_request', usage: usage() },
    { isAnswered: false, reason: 'empty-reply', usage: usage() },
    { isAnswered: false, reason: 'aborted', usage: usage() },
  ] satisfies ModelForkResult[]) {
    test(`structured fork failure ${failure.reason} stops without retrying`, async ($, on) => {
      const clock = mockClock(on, { now: START })
      const w = world(on, [failure])
      await $.session.start({ ...session, surface: 'terminal', isInteractive: true })
      await $.turn.complete(turn())
      await $.command.run(run('keepwarm', '3h every 1m'))
      await clock.advance(MIN)
      expect(w.status.at(-1)).toMatch(/stopped/)
      await clock.advance(2 * HOUR)
      expect(w.forks.length).toBe(1)
    })
  }
})
describe('parse and format', () => {
  test('durations', async () => {
    expect(parseDuration('6h')).toBe(6 * HOUR)
    expect(parseDuration('90m')).toBe(90 * MIN)
    expect(parseDuration('2h30m')).toBe(150 * MIN)
    expect(parseDuration('soon')).toBe(null)
    expect(fmtDuration(150 * MIN)).toBe('2h30m')
    expect(fmtDuration(7 * MIN)).toBe('7m')
    expect(fmtDuration((15 * 24 + 9) * 60 * MIN)).toBe('15d 9h')
  })
})

describe('guard', () => {
  test('refuses a cold send once with the price, then lets the resend through', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(3 * HOUR)
    const first = await $.prompt.submit(prompt('hi'))
    expect(first.drop).toMatch(/glitchband: the prompt cache went cold 2h00m ago\. Sending this re-writes up to 200,502 tokens at \$20\/MTok = \$4\.01/)
    expect(w.entered).toEqual([])
    const second = await $.prompt.submit(prompt('hi'))
    expect(second.drop).toBe(undefined)
    expect(w.entered).toEqual(['hi'])
  })

  test('lets slash commands, warm sends and small contexts through', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    await $.prompt.submit(prompt('warm one'))
    await clock.advance(3 * HOUR)
    await $.prompt.submit(prompt('/clear'))
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 20000 }) }))
    await clock.advance(3 * HOUR)
    await $.prompt.submit(prompt('small one'))
    expect(w.entered).toEqual(['warm one', '/clear', 'small one'])
  })

  test('warn mode shows the price and sends', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [])
    await $.session.start(session)
    const r = await $.command.run(run('glitchband', 'guard warn'))
    expect(r.text).toMatch(/guard set to warn/)
    await $.turn.complete(turn())
    await clock.advance(3 * HOUR)
    await $.prompt.submit(prompt('hi'))
    expect(w.entered).toEqual(['hi'])
    expect(w.logs.at(-1)).toMatch(/Sending anyway/)
  })

  test('a paid cold write is scored and arms keepwarm for three hours', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm, warm, warm, warm])
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(3 * HOUR)
    await $.prompt.submit(prompt('hi'))
    await $.prompt.submit(prompt('hi'))
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200502 }) }))
    expect(w.logs.at(-1)).toMatch(/cold write of 201k tokens paid \(\$4\.01\)\. Keeping the cache warm for 3h00m/)
    expect(w.status.at(-1)).toMatch(/^keepwarm 3h00m left · ping in 30m/)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    const card = await $.command.run(run('glitchband', 'status'))
    expect(card.text).toMatch(/session     1 cold write paid, \$4\.01/)
    expect(card.text).toMatch(/keepwarm    on, 2h30m left/)
  })

  test('context comes from the live window, not the turn\'s summed usage', async ($, on) => {
    mockClock(on, { now: START })
    const live: { tokens?: number } = {}
    const w = world(on, [], { live })
    await $.session.start(session)
    await $.turn.complete(turn())
    live.tokens = 100000
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 500000, cache_creation_input_tokens: 2000 }) }))
    const card = await $.command.run(run('glitchband', 'status'))
    expect(card.text).toMatch(/context     100,000 tokens/)
    expect(card.text).toMatch(/0 cold writes paid/)
    expect(w.status.at(-1)).toBe(undefined)
  })

  test('/clear forgets the context, the clock and the tally', async () => {
    const s = freshState()
    s.ctx = 200000
    s.lastRequestAt = START - 2 * HOUR
    s.ackedAt = s.lastRequestAt
    s.misses = [{ at: START, tokens: 200000, usd: 4 }]
    let cancelled = false
    s.pending = { cancel: () => { cancelled = true } }
    resetForClear(s)
    expect(s.ctx).toBe(0)
    expect(s.lastRequestAt).toBe(0)
    expect(s.ackedAt).toBe(0)
    expect(s.misses).toEqual([])
    expect(s.pending).toBe(null)
    expect(cancelled).toBe(true)
  })

  test('an unguarded full miss is scored too', async ($, on) => {
    mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200502 }) }))
    const card = await $.command.run(run('glitchband', 'status'))
    expect(card.text).toMatch(/1 cold write paid/)
    expect(w.status.at(-1)).toMatch(/^keepwarm 3h00m left/)
  })

  test('stays quiet after a compaction until the first new turn', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(3 * HOUR)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'old', toolUses: [] }] })
    await $.prompt.submit(prompt('after compact'))
    expect(w.entered).toEqual(['after compact'])
    const card = await $.command.run(run('glitchband', 'status'))
    expect(card.text).toMatch(/reset by compaction/)
  })

  test('a cold resume seeds the guard before any turn and returns the estimate line', async () => {
    const s = freshState()
    const now = START
    const line = seedFromResume(s, { source: 'resume', model: 'claude-fable-5-1', context_tokens: 396113, seconds_since_last_response: 3 * 3600, prompt_cache_likely_expired: true, estimated_cache_write_usd: 7.92 }, now)
    expect(line).toMatch(/resuming cold\. The first message re-writes 396,113 tokens, about \$7\.92/)
    expect(s.ctx).toBe(396113)
    expect(s.lastRequestAt).toBe(now - 3 * HOUR)
    expect(seedFromResume(freshState(), { source: 'startup' }, now)).toBe(null)
    expect(seedFromResume(freshState(), { source: 'resume', context_tokens: 20000, prompt_cache_likely_expired: true }, now)).toBe(null)
  })

  test('warns once when the hook form is installed beside it', async ($, on) => {
    mockClock(on, { now: START })
    const w = world(on, [], { commands: ['cache-tax:status'] })
    await $.session.start(session)
    expect(w.logs.at(-1)).toMatch(/another cache guard \(\/cache-tax:status\) is also installed/)
  })
})

describe('keepwarm', () => {
  test('pings 30 minutes after the last request, then again, and reports the read', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm, warm])
    await $.session.start(session)
    const r = await $.command.run(run('keepwarm', '6h'))
    expect(r.text).toMatch(/keepwarm on for 6h00m/)
    await $.turn.complete(turn())
    await clock.advance(29 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/keepwarm 5h30m left · ping in 30m · last ping read 200k \$0\.05/)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
  })

  test('a new turn resets the countdown', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn())
    await clock.advance(20 * MIN)
    await $.turn.complete(turn())
    await clock.advance(20 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('stops when a ping reads cold', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [{ read: 0, write: 180000 }, warm])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/keepwarm stopped: the ping read 0 and wrote 180k tokens \(\$3\.60\)/)
    await clock.advance(120 * MIN)
    expect(w.forks.length).toBe(1)
    const s = await $.command.run(run('keepwarm', 'status'))
    expect(s.text).toMatch(/stopped/)
  })

  test('stops when the engine returns null, a cold snapshot or an API error', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [null])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '1h'))
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/either the snapshot was cold or the API call failed/)
  })

  test('the window ends on its own, forgetting the every knob, and off cancels', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    const w = world(on, [warm, warm, warm], { store })
    await $.session.start(session)
    await $.command.run(run('keepwarm', '3m every 1m'))
    await $.turn.complete(turn())
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(1)
    await clock.advance(5 * MIN)
    expect(w.forks.length).toBe(2)
    expect(w.status.at(-1)).toBe(undefined)
    expect(store.has('glitchband.every:S1')).toBe(false)
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn())
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(2)
    const off = await $.command.run(run('keepwarm', 'off'))
    expect(off.text).toBe('keepwarm is off')
    await clock.advance(60 * MIN)
    expect(w.forks.length).toBe(2)
  })

  test('the every knob lasts one window only', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm, warm, warm, warm])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '1h every 1m'))
    await $.turn.complete(turn())
    await clock.advance(2 * MIN)
    expect(w.forks.length).toBe(2)
    await $.command.run(run('keepwarm', 'off'))
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn())
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(2)
    await $.command.run(run('keepwarm', '1h every 1m'))
    await $.turn.complete(turn())
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(3)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn())
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(3)
  })

  test('a bare /keepwarm arms six hours', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    const r = await $.command.run(run('keepwarm', ''))
    expect(r.text).toMatch(/^keepwarm on for 6h00m, a ping 30m after each idle stretch/)
    await $.turn.complete(turn())
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · ping in 30m')
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('a warm ping keeps the band WARM past the hour, not just the keepwarm clock', async ($, on) => {
    const clock = mockClock(on, { now: START })
    world(on, [warm, warm], { live: { tokens: 200000 } })
    await $.session.start(session)
    await $.command.run(run('keepwarm', ''))
    await $.turn.complete(turn())
    await clock.advance(70 * MIN)
    const band = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 140, scroll: { offset: 0, bodyRows: 14 }, view: {} } as never })
    const alts = (await band.findAll({ type: 'Svg' })).map(x => String(x.props.alt))
    expect(alts).toContain('WARM')
    expect(alts).not.toContain('COLD')
    await band.unmount()
  })

  test('always is remembered, arms every session start, and off ends it for good', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true], ['glitchband.deadline:S1', START - MIN], ['glitchband.every:S1', MIN]])
    const w = world(on, [warm], { store })
    await $.session.start(session)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · waiting for the first turn')
    expect(store.get('glitchband.deadline:S1')).toBe(START + 6 * HOUR)
    expect(store.has('glitchband.every:S1')).toBe(false)
    await $.turn.complete(turn())
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(29 * MIN)
    expect(w.forks.length).toBe(1)
    const card = await $.command.run(run('glitchband', ''))
    expect(card.text).toMatch(/keepwarm    on, 5h30m left · ping in 30m · last ping read 200k \$0\.05 \(always\)/)
    const off = await $.command.run(run('keepwarm', 'off'))
    expect(off.text).toBe('keepwarm is off, and always is off for every session from its next turn')
    expect(store.has('glitchband.always')).toBe(false)
    expect(w.status.at(-1)).toBe(undefined)
  })

  test('/keepwarm always sets the switch and arms now', async ($, on) => {
    mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    const w = world(on, [], { store })
    await $.session.start(session)
    const r = await $.command.run(run('keepwarm', 'always'))
    expect(r.text).toMatch(/^keepwarm always on: every session stays warm until 6h00m after its last turn/)
    expect(store.get('glitchband.always')).toBe(true)
    expect(store.get('glitchband.deadline:S1')).toBe(START + 6 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · waiting for the first turn')
  })

  test('always rolls the window forward with each turn, so a long session never outlives it', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    const w = world(on, [warm, warm], { store })
    await $.session.start(session)
    expect(store.get('glitchband.deadline:S1')).toBe(START + 6 * HOUR)
    // A turn five and a half hours in: a fixed window would end 30m later, before the first ping.
    await clock.advance(5 * HOUR + 30 * MIN)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 11 * HOUR + 30 * MIN)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
  })

  test('the ping figure counts output tokens at the model\'s rate, Sonnet 5 priced as itself', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [{ read: 200000, write: 0, out: 1000 }])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn({ usage: usage({ model: 'claude-sonnet-5' }) }))
    await clock.advance(30 * MIN)
    expect(w.status.at(-1)).toBe('keepwarm 5h30m left · ping in 30m · last ping read 200k $0.05')
    const card = await $.command.run(run('glitchband', ''))
    expect(card.text).toMatch(/cold cost   \$0\.80 to re-write it \(warm turn \$0\.04\)/)
    expect(card.text).toMatch(/break-even  up to 20 pings at the read rate cost one cold write, about 10h00m of idle at one ping per 30m/)
  })

  test('a partial write, a zero read, or a full write stops the loop; a ping\'s own few tokens do not', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [{ read: 200000, write: 500 }, { read: 75000, write: 70000 }, warm])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '6h every 1m'))
    await $.turn.complete(turn())
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/^keepwarm 5h59m left · ping in 1m · last ping read 200k/)
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(2)
    expect(w.status.at(-1)).toMatch(/^keepwarm stopped: the ping read 75k and wrote 70k tokens/)
    await clock.advance(5 * MIN)
    expect(w.forks.length).toBe(2)
  })

  test('a ping that reads nothing stops the loop too', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [{ read: 0, write: 0 }, warm])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.status.at(-1)).toMatch(/^keepwarm stopped: the ping read 0 and wrote 0 tokens/)
    await clock.advance(60 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('the ping figure counts uncached input at the base rate', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [{ read: 200000, write: 0, input: 50000, out: 1000 }])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn({ usage: usage({ model: 'claude-sonnet-5' }) }))
    await clock.advance(30 * MIN)
    expect(w.status.at(-1)).toBe('keepwarm 5h30m left · ping in 30m · last ping read 200k $0.15')
  })

  test('the card states the break-even for Fable 5.1', async ($, on) => {
    mockClock(on, { now: START })
    world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    const card = await $.command.run(run('glitchband', ''))
    expect(card.text).toMatch(/break-even  up to 80 pings at the read rate cost one cold write, about 40h00m of idle at one ping per 30m/)
  })

  test('/keepwarm on a cold session schedules no fork before a turn, and does after one', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    await $.turn.complete(turn())
    await jump(clock, 2 * 24 * HOUR)
    const r = await $.command.run(run('keepwarm', ''))
    expect(r.text).toBe('keepwarm on for 6h00m. The cache is cold now, so the first ping comes 30m after the next turn')
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · cold now, first ping 30m after the next turn')
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(60 * MIN)
    expect(w.forks.length).toBe(0)
    const card = await $.command.run(run('glitchband', ''))
    expect(card.text).toMatch(/keepwarm    on, 4h59m left · cold now, first ping 30m after the next turn/)
    await $.turn.complete(turn())
    expect(w.status.at(-1)).toBe('keepwarm 4h59m left · ping in 30m')
    await clock.advance(29 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('the always switch on a cold resume schedules no fork before a turn, and does after one', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    const w = world(on, [warm], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', 'off'))
    await jump(clock, 2 * 24 * HOUR)
    // The test kit cannot raise classic.SessionStart, so the cold state comes from the turn above and a second start arms the switch over it.
    store.set('glitchband.always', true)
    await $.session.start(session)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · cold now, first ping 30m after the next turn')
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(0)
    const r = await $.command.run(run('keepwarm', 'always'))
    expect(r.text).toBe('keepwarm always on: every session stays warm until 6h00m after its last turn; /keepwarm off turns it off for good. The cache is cold now, so the first ping comes 30m after the next turn')
    await clock.advance(60 * MIN)
    expect(w.forks.length).toBe(0)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('a cold window expires and its testing period does not reach the next auto-window', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    const w = world(on, [warm], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    await $.command.run(run('keepwarm', '90m every 1m'))
    await clock.advance(90 * MIN)
    expect(w.forks.length).toBe(0)
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect(store.has('glitchband.every:S1')).toBe(false)
    expect(w.status.at(-1)).toBe(undefined)
    expect((await $.command.run(run('keepwarm', 'status'))).text).toBe('keepwarm is off')
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    await clock.advance(29 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(MIN)
    expect(w.forks.length).toBe(1)
  })

  test('a turn after sleep clears the expired period before the overdue timer runs', async ($, on) => {
    let now = START
    on('clock.now', () => ({ value: now }))
    on('clock.after', () => new Promise<{ value: void }>(() => {}))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    const store = new Map<string, unknown>()
    const w = world(on, [], { now: () => now, store })
    await $.session.start(session)
    await $.turn.complete(turn())
    now += 2 * HOUR
    await $.command.run(run('keepwarm', '90m every 1m'))
    now += 91 * MIN
    expect(store.get('glitchband.every:S1')).toBe(MIN)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    expect(store.has('glitchband.every:S1')).toBe(false)
    expect(store.get('glitchband.deadline:S1')).toBe(now + 3 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 3h00m left · ping in 30m')
    expect(w.forks.length).toBe(0)
  })

  test('subagent turns do not touch the timer', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '6h'))
    await $.turn.complete(turn())
    await clock.advance(40 * MIN)
    await $.turn.complete(turn({ agentId: 'a1' }))
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(1)
  })
})

describe('store per session', () => {
  test('another session\'s window does not arm this one', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.deadline:other', START + HOUR], ['glitchband.every:other', MIN]])
    const w = world(on, [warm], { store, sid: 'mine' })
    await $.session.start(session)
    expect(w.status.at(-1)).toBe(undefined)
    const r = await $.command.run(run('keepwarm', 'status'))
    expect(r.text).toBe('keepwarm is off')
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(0)
    expect(store.get('glitchband.deadline:other')).toBe(START + HOUR)
    expect(store.get('glitchband.every:other')).toBe(MIN)
  })

  test('this session\'s own window is restored on start', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.deadline:mine', START + 2 * HOUR], ['glitchband.every:mine', MIN]])
    const w = world(on, [warm], { store, sid: 'mine' })
    await $.session.start(session)
    expect(w.status.at(-1)).toBe('keepwarm 2h00m left · waiting for the first turn')
    await $.turn.complete(turn())
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('a window that lapsed less than a week ago is left for its own session', async ($, on) => {
    const now = START + 30 * 24 * HOUR
    mockClock(on, { now })
    const store = new Map<string, unknown>([['glitchband.deadline:recent', now - HOUR], ['glitchband.every:recent', MIN]])
    world(on, [], { store, sid: 'mine' })
    await $.session.start(session)
    expect([...store.keys()]).toEqual(['glitchband.deadline:recent', 'glitchband.every:recent'])
  })

  test('/keepwarm off deletes only this session\'s keys', async ($, on) => {
    mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.deadline:other', START + HOUR], ['glitchband.every:other', MIN], ['glitchband.always', true], ['glitchband.guard', 'warn']])
    world(on, [], { store, sid: 'mine' })
    await $.session.start(session)
    await $.command.run(run('keepwarm', '1h every 1m'))
    expect(store.get('glitchband.deadline:mine')).toBe(START + HOUR)
    expect(store.get('glitchband.every:mine')).toBe(MIN)
    await $.command.run(run('keepwarm', 'off'))
    expect(store.has('glitchband.deadline:mine')).toBe(false)
    expect(store.has('glitchband.every:mine')).toBe(false)
    expect(store.has('glitchband.always')).toBe(false)
    expect(store.get('glitchband.deadline:other')).toBe(START + HOUR)
    expect(store.get('glitchband.every:other')).toBe(MIN)
    expect(store.get('glitchband.guard')).toBe('warn')
  })

  test('other sessions\' keys, live or dead, and the global switches stay on start', async ($, on) => {
    mockClock(on, { now: START })
    const store = new Map<string, unknown>([
      ['glitchband.deadline:old1', START - 8 * 24 * HOUR], ['glitchband.every:old1', MIN],
      ['glitchband.deadline:old2', 0],
      ['glitchband.deadline:live', START + HOUR], ['glitchband.every:live', 2 * MIN],
      ['glitchband.guard', 'warn'],
    ])
    world(on, [], { store, sid: 'mine' })
    await $.session.start(session)
    expect([...store.keys()]).toEqual(['glitchband.deadline:old1', 'glitchband.every:old1', 'glitchband.deadline:old2', 'glitchband.deadline:live', 'glitchband.every:live', 'glitchband.guard'])
  })

  test('this session\'s own dead window is cleared on start', async ($, on) => {
    mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.deadline:mine', START - MIN], ['glitchband.every:mine', MIN], ['glitchband.deadline:other', START - MIN], ['glitchband.every:other', MIN]])
    world(on, [], { store, sid: 'mine' })
    await $.session.start(session)
    expect([...store.keys()]).toEqual(['glitchband.deadline:other', 'glitchband.every:other'])
  })
})

describe('prices', () => {
  for (const [model, cold, warmTurn, pings] of [
    ['claude-opus-5-5', '1.60', '0.04', 40],
    ['claude-opus-5', '2.00', '0.10', 20],
    ['claude-sonnet-5-5', '0.80', '0.02', 40],
    ['claude-haiku-5-5', '0.20', '0.01', 20],
    ['claude-mythos-5-1', '4.00', '0.05', 80],
    ['claude-opus-4-1-20250805', '6.00', '0.30', 20],
    ['claude-opus-4-20250514', '6.00', '0.30', 20],
    ['claude-opus-4@20250514', '6.00', '0.30', 20],
    ['claude-opus-4-1@20250805', '6.00', '0.30', 20],
    ['anthropic.claude-opus-4-1-20250805-v1:0', '6.00', '0.30', 20],
    ['claude-opus-4-1', '6.00', '0.30', 20],
    ['claude-opus-4-5-20251101', '2.00', '0.10', 20],
    ['claude-opus-4-5@20251101', '2.00', '0.10', 20],
    ['anthropic.claude-opus-4-5-20251101-v1:0', '2.00', '0.10', 20],
    ['claude-opus-4-8', '2.00', '0.10', 20],
    ['claude-3-5-haiku-20241022', '0.32', '0.02', 20],
  ] as const) {
    test(`${model} at 200k tokens is priced from its own row`, async ($, on) => {
      mockClock(on, { now: START })
      world(on, [], { live: { tokens: 200000 } })
      await $.session.start(session)
      await $.turn.complete(turn({ usage: usage({ model }) }))
      const card = await $.command.run(run('glitchband', ''))
      expect(card.text).toMatch(`cold cost   $${cold} to re-write it (warm turn $${warmTurn})`)
      expect(card.text).toMatch(`break-even  up to ${pings} pings`)
    })
  }

  test('Haiku 5.5 up to 100k tokens takes the short-prompt row', async ($, on) => {
    mockClock(on, { now: START })
    world(on, [], { live: { tokens: 100000 } })
    await $.session.start(session)
    await $.turn.complete(turn({ usage: usage({ model: 'claude-haiku-5-5' }) }))
    const card = await $.command.run(run('glitchband', ''))
    expect(card.text).toMatch('cold cost   $0.02 to re-write it (warm turn $0.00)')
  })
})

describe('keepwarm input', () => {
  for (const args of ['3h every 60m', '3h every 90m', '3h every 2h']) {
    test(`${args} is refused, since it would only fire on a cold cache`, async ($, on) => {
      mockClock(on, { now: START })
      world(on, [])
      await $.session.start(session)
      const r = await $.command.run(run('keepwarm', args))
      expect(r.text).toBe('every takes a period from 1m to 59m')
      expect((await $.command.run(run('keepwarm', 'status'))).text).toBe('keepwarm is off')
    })
  }

  test('every 59m pings before the cache goes cold', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h every 59m'))
    await clock.advance(59 * MIN)
    expect(w.forks.length).toBe(1)
  })

  for (const args of ['0m', '0h', '0h0m']) {
    test(`a ${args} window is refused`, async ($, on) => {
      mockClock(on, { now: START })
      world(on, [])
      await $.session.start(session)
      const r = await $.command.run(run('keepwarm', args))
      expect(r.text).toBe('keepwarm takes a window such as 6h or 90m, or always, off, or status')
    })
  }

  test('a stored period of an hour or more falls back to 50m', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm], { store: new Map<string, unknown>([['glitchband.deadline:S1', START + 3 * HOUR], ['glitchband.every:S1', 90 * MIN]]) })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
  })
})

describe('always after /clear', () => {
  test('arms a fresh window under the new session id', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    let sid = 'S1'
    const w = world(on, [warm], { store, sid: () => sid })
    await $.session.start(session)
    await $.turn.complete(turn())
    sid = 'S2'
    await $.classic.SessionStart({ source: 'clear' })
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect(store.get('glitchband.deadline:S2')).toBe(START + 6 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · waiting for the first turn')
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('without always, /clear leaves keepwarm off', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('keepwarm', '3h'))
    await $.turn.complete(turn())
    await $.classic.SessionStart({ source: 'clear' })
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(0)
  })
})

describe('guard by origin', () => {
  for (const kind of ['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'observer'] as const) {
    test(`a cold ${kind} prompt is sent and scored, and the next typed prompt is still refused`, async ($, on) => {
      const clock = mockClock(on, { now: START })
      const w = world(on, [])
      await $.session.start(session)
      await $.turn.complete(turn())
      await clock.advance(3 * HOUR)
      const r = await $.prompt.submit({ text: 'agent finished', wait: false, origin: { kind } })
      expect(r.drop).toBe(undefined)
      expect(w.entered).toEqual(['agent finished'])
      expect(w.logs.at(-1)).toMatch(new RegExp(`Sending anyway, since this ${kind} prompt cannot be sent again`))
      await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
      expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     1 cold write paid/)
      await $.command.run(run('keepwarm', 'off'))
      await clock.advance(3 * HOUR)
      expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/^glitchband: the prompt cache went cold/)
    })
  }

  for (const origin of [
    { kind: 'bridge' }, { kind: 'sdk' }, { kind: 'unclassified' }, { kind: 'slack-ping' },
    { kind: 'channel', server: 'telegram' }, { kind: 'auto-continuation' },
  ] satisfies PromptSubmitInput['origin'][]) {
    test(`a cold ${origin.kind} prompt, which a person may have sent, is refused like a typed one`, async ($, on) => {
      const clock = mockClock(on, { now: START })
      world(on, [])
      await $.session.start(session)
      await $.turn.complete(turn())
      await clock.advance(3 * HOUR)
      expect((await $.prompt.submit({ text: 'hi', wait: false, origin })).drop).toMatch(/^glitchband:/)
    })
  }
})

describe('ping failures', () => {
  test('after a restart with nothing to fork, the window waits for the next turn instead of stopping', async ($, on) => {
    const clock = mockClock(on, { now: 10 * HOUR })
    const store = new Map<string, unknown>([['glitchband.deadline:S1', 13 * HOUR]])
    const w = world(on, [{ isAnswered: false, reason: 'nothing-to-fork' }, warm], { store })
    await $.session.start(session)
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 20 * 60, context_tokens: 200000 })
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toBe('keepwarm 2h50m left · nothing to fork yet, first ping after the next turn')
    expect(store.get('glitchband.deadline:S1')).toBe(13 * HOUR)
    await clock.advance(HOUR)
    expect(w.forks.length).toBe(1)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
    expect(w.status.at(-1)).toMatch(/ping in 30m · last ping read 200k/)
  })

  for (const status of [429, 529, 500, null]) {
    test(`an API error ${status} is retried and the loop goes on once a ping lands`, async ($, on) => {
      const clock = mockClock(on, { now: START })
      const w = world(on, [{ isAnswered: false, reason: 'api-error', status, error: 'rate_limit', usage: usage() }, warm, warm])
      await $.session.start(session)
      await $.turn.complete(turn())
      await $.command.run(run('keepwarm', '3h'))
      await clock.advance(30 * MIN)
      expect(w.forks.length).toBe(1)
      expect(w.status.at(-1)).toBe('keepwarm 2h30m left · API busy, ping retry 1 of 3')
      await clock.advance(MIN)
      expect(w.forks.length).toBe(2)
      expect(w.status.at(-1)).toMatch(/ping in 30m · last ping read 200k/)
      await clock.advance(30 * MIN)
      expect(w.forks.length).toBe(3)
    })
  }

  test('a lasting 429 stops after three retries, before the cache goes cold', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [busy, busy, busy, busy])
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(57 * MIN)
    expect(w.forks.length).toBe(4)
    expect(w.status.at(-1)).toBe('keepwarm stopped: the API call failed (429) after 3 retries')
    await clock.advance(2 * HOUR)
    expect(w.forks.length).toBe(4)
  })

  test('a retry that would land within a minute of the cache going cold is not tried', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [busy])
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h every 58m'))
    await clock.advance(58 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toBe('keepwarm stopped: the API call failed (429)')
  })
})

describe('stale and late ping results', () => {
  // The tsconfig loads no DOM or Node types; the runtime has a real setTimeout to let a released fork finish.
  const realTimer = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }
  const settle = () => new Promise<void>(r => { realTimer.setTimeout(r, 20) })
  const gated = () => {
    let release = () => {}
    return { gate: () => new Promise<void>(r => { release = r }), release: () => release() }
  }

  test('a 429 that lands after a compaction schedules no retry', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const g = gated()
    const w = world(on, [busy], { gate: g.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    g.release()
    await settle()
    await clock.advance(5 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toBe('keepwarm 2h30m left · waiting for the first turn after compaction')
  })

  test('a 429 that lands after /clear with always on leaves the new window alone', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    let sid = 'S1'
    const g = gated()
    const w = world(on, [busy], { store, sid: () => sid, gate: g.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    sid = 'S2'
    await $.classic.SessionStart({ source: 'clear' })
    g.release()
    await settle()
    expect(store.get('glitchband.deadline:S2')).toBe(START + 30 * MIN + 6 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · waiting for the first turn')
  })

  test('nothing to fork that lands after a turn does not hold the next ping', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const g = gated()
    const w = world(on, [nothing, warm], { gate: async () => { if (w.forks.length === 1) await g.gate() } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    await $.turn.complete(turn())
    g.release()
    await settle()
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
    expect(w.status.at(-1)).toMatch(/ping in 30m · last ping read 200k/)
  })

  test('a retry whose timer fires inside the last minute is not sent', async ($, on) => {
    let now = START
    const timers: Array<() => void> = []
    on('clock.now', () => ({ value: now }))
    on('clock.after', () => new Promise<{ value: void }>(r => { timers.push(() => r({ value: undefined })) }))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    const w = world(on, [busy, warm], { now: () => now })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    now += 30 * MIN
    timers.at(-1)?.()
    await settle()
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toBe('keepwarm 2h30m left · API busy, ping retry 1 of 3')
    // The host slept through the retry's one-minute slot and wakes 30 seconds before the cache goes cold.
    now += 29.5 * 60 * 1000
    timers.at(-1)?.()
    await settle()
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toBe('keepwarm stopped: the API call failed (429) after 1 retry')
  })
})

describe('price edge cases', () => {
  test('Claude Haiku 3.5 by display name takes the Haiku 3.5 row', async ($, on) => {
    mockClock(on, { now: START })
    world(on, [], { live: { tokens: 200000 } })
    await $.session.start(session)
    await $.turn.complete(turn({ usage: usage({ model: 'Claude Haiku 3.5' }) }))
    expect((await $.command.run(run('glitchband', ''))).text).toMatch('cold cost   $0.32 to re-write it (warm turn $0.02)')
  })

  test('without step usage, a Haiku 5.5 comeback is priced at the tier of the context it re-sent', async ($, on) => {
    const clock = mockClock(on, { now: START })
    world(on, [])
    await $.session.start(session)
    await $.command.run(run('glitchband', 'guard warn'))
    await $.turn.complete(turn({ usage: usage({ model: 'claude-haiku-5-5', cache_read_input_tokens: 0, cache_creation_input_tokens: 99000 }) }))
    await clock.advance(2 * HOUR)
    // Two requests summed: the 99k comeback write under 100k, then a step that crossed it.
    await $.turn.complete(turn({ usage: usage({ model: 'claude-haiku-5-5', cache_read_input_tokens: 0, cache_creation_input_tokens: 100500 }) }))
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     1 cold write paid, \$0\.02/)
  })
})

describe('per-request pricing and window extension', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })
  const haiku = (read: number, write: number) => usage({ model: 'claude-haiku-5-5', cache_read_input_tokens: read, cache_creation_input_tokens: write })
  const step = async ($: Parameters<TestBody>[0], index: number) => {
    for await (const c of $.turn.step({ turnId: 'comeback', index, model: 'claude-haiku-5-5', messageCount: 2 })) void c
  }

  test('a Haiku 5.5 comeback request over 100k is priced at the long tier though the context before was under it', async ($, on) => {
    const clock = mockClock(on, { now: START })
    world(on, [], { steps: [haiku(0, 101000)] })
    await $.session.start(session)
    await $.command.run(run('glitchband', 'guard warn'))
    await $.turn.complete(turn({ usage: haiku(0, 99000) }))
    await clock.advance(2 * HOUR)
    await step($, 0)
    await $.turn.complete(turn({ usage: haiku(0, 101000) }))
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     1 cold write paid, \$0\.10/)
  })

  test('a Haiku 5.5 turn whose requests straddle 100k prices each write at its own tier', async ($, on) => {
    const clock = mockClock(on, { now: START })
    world(on, [], { steps: [haiku(0, 99000), haiku(99000, 60000)] })
    await $.session.start(session)
    await $.command.run(run('glitchband', 'guard warn'))
    await $.turn.complete(turn({ usage: haiku(0, 99000) }))
    await clock.advance(2 * HOUR)
    await step($, 0)
    await step($, 1)
    // 99,000 at $0.20 plus 60,000 at $1, against $0.16 for all at $1 or $0.03 for all at $0.20.
    await $.turn.complete(turn({ usage: haiku(99000, 159000) }))
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     1 cold write paid, \$0\.08/)
  })

  test('a ping out when /keepwarm extends the window still counts', async ($, on) => {
    const clock = mockClock(on, { now: START })
    let release = () => {}
    const w = world(on, [warm, warm], { gate: async () => { if (w.forks.length === 1) await new Promise<void>(r => { release = r }) } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    await $.command.run(run('keepwarm', '6h'))
    release()
    await settle()
    expect(w.status.at(-1)).toMatch(/ping in 30m · last ping read 200k/)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
  })
})

describe('pings in flight', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })
  // Holds the first fork until released; later forks answer at once.
  const holdFirst = (w: () => { forks: number[] }) => {
    let release = () => {}
    const gate = async () => { if (w().forks.length === 1) await new Promise<void>(r => { release = r }) }
    return { gate, release: () => release() }
  }

  test('extending the window while a ping is out sends no second ping, and a cold reply then stops it', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const h = holdFirst(() => w)
    const w = world(on, [{ read: 0, write: 200000 }, warm], { gate: h.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    await $.command.run(run('keepwarm', '6h'))
    await clock.advance(5 * 1000)
    expect(w.forks.length).toBe(1)
    h.release()
    await settle()
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/keepwarm stopped: the ping read 0 and wrote 200k/)
  })

  test('a main request while a ping is out supersedes its cold reply', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const h = holdFirst(() => w)
    const w = world(on, [{ read: 0, write: 200000 }, warm], { gate: h.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    await clock.advance(MIN)
    for await (const c of $.turn.step({ turnId: 'next', index: 0, model: 'claude-fable-5-1', messageCount: 3 })) void c
    h.release()
    await settle()
    expect(w.status.at(-1)).not.toMatch(/stopped/)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
    expect(w.status.at(-1)).toMatch(/ping in 30m · last ping read 200k/)
  })

  test('a turn aborted before any request keeps the reply of a ping that was out', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const h = holdFirst(() => w)
    const w = world(on, [warm, warm], { gate: h.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    await clock.advance(MIN)
    await $.turn.complete(turn({ isAborted: true, usage: undefined }))
    h.release()
    await settle()
    expect(w.status.at(-1)).toMatch(/last ping read 200k/)
    // The next ping counts from the ping's own read, not from the aborted turn.
    await clock.advance(29 * MIN)
    expect(w.forks.length).toBe(2)
  })
})

describe('ping timing races', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })

  test('a timer that fires while another ping waits on the clock never sends a second fork', async ($, on) => {
    let now = START
    let hold: Promise<void> | null = null
    let releaseClock = () => {}
    const timers: Array<() => void> = []
    on('clock.now', async () => {
      const h = hold
      hold = null
      if (h) await h
      return { value: now }
    })
    on('clock.after', () => new Promise<{ value: void }>(r => { timers.push(() => r({ value: undefined })) }))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    // Ping B's fork stays out until released, so it is in flight when A resumes.
    let releaseFork = () => {}
    const w = world(on, [warm, warm], { now: () => now, gate: async () => { if (w.forks.length === 1) await new Promise<void>(r => { releaseFork = r }) } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    now += 30 * MIN
    // Ping A's clock read is held; the extension's own reads go through.
    hold = new Promise<void>(r => { releaseClock = r })
    timers.at(-1)?.()
    await settle()
    await $.command.run(run('keepwarm', '6h'))
    now += 1000
    timers.at(-1)?.()
    await settle()
    expect(w.forks.length).toBe(1)
    releaseClock()
    await settle()
    expect(w.forks.length).toBe(1)
    releaseFork()
    await settle()
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/last ping read 200k/)
  })

  test('a superseded reply followed by an early timer still leaves the window armed', async ($, on) => {
    const clock = mockClock(on, { now: START })
    let release = () => {}
    const w = world(on, [warm, warm], { gate: async () => { if (w.forks.length === 1) await new Promise<void>(r => { release = r }) } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    await $.command.run(run('keepwarm', '6h'))
    // A long tool call: the turn's first request lands, and the turn does not complete.
    for await (const c of $.turn.step({ turnId: 'long', index: 0, model: 'claude-fable-5-1', messageCount: 3 })) void c
    release()
    await settle()
    await clock.advance(2 * 1000)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
  })
})

describe('retry after a window extension', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })

  test('a 429 that lands after /keepwarm extends the window waits the full retry delay', async ($, on) => {
    const clock = mockClock(on, { now: START })
    let release = () => {}
    const w = world(on, [busy, warm], { gate: async () => { if (w.forks.length === 1) await new Promise<void>(r => { release = r }) } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    await clock.advance(30 * MIN)
    await $.command.run(run('keepwarm', '6h'))
    release()
    await settle()
    expect(w.status.at(-1)).toMatch(/API busy, ping retry 1 of 3/)
    // The extension's one-second timer is gone; only the one-minute retry remains.
    await clock.advance(30 * 1000)
    expect(w.forks.length).toBe(1)
    await clock.advance(30 * 1000)
    expect(w.forks.length).toBe(2)
    expect(w.status.at(-1)).toMatch(/last ping read 200k/)
  })
})

describe('one timer at a time', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })

  test('a 429 that lands while /keepwarm is reading the clock leaves one live timer', async ($, on) => {
    let now = START
    let holdNext = false
    let releaseClock = () => {}
    const timers: Array<() => void> = []
    on('clock.now', async () => {
      if (holdNext) {
        holdNext = false
        await new Promise<void>(r => { releaseClock = r })
      }
      return { value: now }
    })
    on('clock.after', () => new Promise<{ value: void }>(r => { timers.push(() => r({ value: undefined })) }))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    // The extension writes its deadline, then arms; holding the next clock read pauses it inside arm().
    let watch = false
    class Store extends Map<string, unknown> {
      override set(key: string, value: unknown) {
        if (watch && key === 'glitchband.deadline:S1') holdNext = true
        return super.set(key, value)
      }
    }
    let releaseFork = () => {}
    const w = world(on, [busy, busy, busy, warm], { now: () => now, store: new Store(), gate: async () => { if (w.forks.length === 1) await new Promise<void>(r => { releaseFork = r }) } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    now += 30 * MIN
    timers.at(-1)?.()
    await settle()
    expect(w.forks.length).toBe(1)
    const before = timers.length
    watch = true
    const extension = $.command.run(run('keepwarm', '6h'))
    await settle()
    releaseFork()
    await settle()
    releaseClock()
    await extension
    await settle()
    // Two timers were set since the first ping: the retry's, then the extension's. Fire the extension's at
    // one second and the retry's at its minute, a beat apart, as the host would; only a live timer may send.
    expect(timers.length - before).toBe(2)
    now += 1000
    timers[before + 1]?.()
    await settle()
    expect(w.forks.length).toBe(2)
    now += MIN
    timers[before]?.()
    await settle()
    expect(w.forks.length).toBe(2)
  })
})

describe('a paused ping yields to a newer schedule', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })

  test('a ping paused on the clock does not send after a newer ping set a retry', async ($, on) => {
    let now = START
    let holdNext = false
    let releaseClock = () => {}
    const timers: Array<() => void> = []
    on('clock.now', async () => {
      if (holdNext) {
        holdNext = false
        await new Promise<void>(r => { releaseClock = r })
      }
      return { value: now }
    })
    on('clock.after', () => new Promise<{ value: void }>(r => { timers.push(() => r({ value: undefined })) }))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    const w = world(on, [busy, busy, busy, busy], { now: () => now })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    now += 30 * MIN
    // Ping A pauses on its clock read.
    holdNext = true
    timers.at(-1)?.()
    await settle()
    // The extension sets timer B; B pings, gets a 429 and schedules a one-minute retry.
    await $.command.run(run('keepwarm', '6h'))
    now += 1000
    timers.at(-1)?.()
    await settle()
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/API busy, ping retry 1 of 3/)
    releaseClock()
    await settle()
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/API busy, ping retry 1 of 3/)
  })
})

describe('/clear overlapping /keepwarm', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })

  test('a window armed while /clear is still running keeps a timer', async ($, on) => {
    let now = START
    let hold: Promise<void> | null = null
    const holdNextRead = () => {
      let release = () => {}
      hold = new Promise<void>(r => { release = r })
      return () => release()
    }
    const timers: Array<() => void> = []
    const waits: number[] = []
    on('clock.now', async () => {
      const h = hold
      hold = null
      if (h) await h
      return { value: now }
    })
    on('clock.after', ($, e) => new Promise<{ value: void }>(r => { waits.push(e.ms); timers.push(() => r({ value: undefined })) }))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    const w = world(on, [warm, warm], { now: () => now })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    now += 30 * MIN
    // Ping A fires and pauses on its clock read.
    const releaseA = holdNextRead()
    timers.at(-1)?.()
    await settle()
    // /clear stops the old window and pauses on its last clock read.
    const releaseClear = holdNextRead()
    const clearing = $.classic.SessionStart({ source: 'clear' })
    await settle()
    // /keepwarm arms a new window meanwhile; then /clear finishes.
    await $.command.run(run('keepwarm', '6h'))
    const beforeClearEnds = timers.length
    releaseClear()
    await clearing
    await settle()
    // /clear reset the state before it first awaited, so the window armed meanwhile kept its timer: the wake at the
    // deadline, since the new conversation has no request yet. Nothing is cancelled or set again when /clear ends.
    expect(timers.length).toBe(beforeClearEnds)
    expect(waits.at(-1)).toBe(6 * HOUR)
    // A wakes, finds the schedule changed and a timer in place, and sends nothing.
    releaseA()
    await settle()
    expect(w.forks.length).toBe(0)
    expect(timers.length).toBe(beforeClearEnds)
    // The first turn of the new conversation starts the pings as usual.
    await $.turn.complete(turn())
    now += 30 * MIN
    timers.at(-1)?.()
    await settle()
    expect(w.forks.length).toBe(1)
  })
})

describe('always covers any break up to six hours', () => {
  const alwaysOn = () => new Map<string, unknown>([['glitchband.always', true]])

  test('a window that stopped comes back on the next turn', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = alwaysOn()
    const w = world(on, [{ read: 0, write: 200000 }, warm], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.status.at(-1)).toMatch(/^keepwarm stopped: the ping read 0/)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 30 * MIN + 6 * HOUR)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
    expect(w.status.at(-1)).toMatch(/ping in 30m · last ping read 200k/)
  })

  test('a shorter window and a testing period give way to six hours at 30m on the next turn', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = alwaysOn()
    const w = world(on, [warm], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '90m every 2m'))
    expect(store.get('glitchband.every:S1')).toBe(2 * MIN)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 6 * HOUR)
    expect(store.has('glitchband.every:S1')).toBe(false)
    await clock.advance(29 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(MIN)
    expect(w.forks.length).toBe(1)
  })

  test('an expired window with a testing period rolls at 30m, not at its old period', async ($, on) => {
    let now = START
    on('clock.now', () => ({ value: now }))
    on('clock.after', () => new Promise<{ value: void }>(() => {}))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    const store = alwaysOn()
    const w = world(on, [], { now: () => now, store })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '90m every 1m'))
    now += 91 * MIN
    await $.turn.complete(turn())
    expect(store.has('glitchband.every:S1')).toBe(false)
    expect(store.get('glitchband.deadline:S1')).toBe(now + 6 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · ping in 30m')
  })

  test('the window rolls in the conversation after /clear too', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = alwaysOn()
    let sid = 'S1'
    world(on, [], { store, sid: () => sid })
    await $.session.start(session)
    sid = 'S2'
    await $.classic.SessionStart({ source: 'clear' })
    await clock.advance(5 * HOUR)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S2')).toBe(START + 11 * HOUR)
  })

  test('without always a turn never moves the deadline', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    const w = world(on, [], { store })
    await $.session.start(session)
    await $.command.run(run('keepwarm', '90m'))
    await clock.advance(80 * MIN)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 90 * MIN)
    await clock.advance(10 * MIN)
    expect((await $.command.run(run('keepwarm', 'status'))).text).toBe('keepwarm is off')
    expect(w.forks.length).toBe(0)
  })
})

describe('/keepwarm off during a rolling turn', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })

  test('off wins over the window a finishing turn was opening', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    let holdEveryDelete = false
    let release = () => {}
    const storeGate = async (op: 'get' | 'set' | 'delete', key: string) => {
      if (holdEveryDelete && op === 'delete' && key === 'glitchband.every:S1') {
        holdEveryDelete = false
        await new Promise<void>(r => { release = r })
      }
    }
    const w = world(on, [warm, warm], { store, storeGate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(10 * MIN)
    // The next turn's roll pauses while saving its window; /keepwarm off runs to the end meanwhile.
    holdEveryDelete = true
    const finishing = $.turn.complete(turn())
    await settle()
    expect((await $.command.run(run('keepwarm', 'off'))).text).toMatch(/^keepwarm is off/)
    release()
    await finishing
    await settle()
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect(store.has('glitchband.always')).toBe(false)
    expect((await $.command.run(run('keepwarm', 'status'))).text).toBe('keepwarm is off')
    await clock.advance(2 * HOUR)
    expect(w.forks.length).toBe(0)
  })
})

describe('always, from the PR review', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })
  const alwaysOn = () => new Map<string, unknown>([['glitchband.always', true]])

  test('a longer window is kept, with its testing period reset to 50m', async ($, on) => {
    mockClock(on, { now: START })
    const store = alwaysOn()
    world(on, [], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    const r = await $.command.run(run('keepwarm', '48h every 2m'))
    expect(r.text).toMatch(/Always is on, so your next turn makes it at least 6h00m at one ping per 30m$/)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 48 * HOUR)
    expect(store.has('glitchband.every:S1')).toBe(false)
  })

  test('a 48h window without a testing period is untouched by a turn', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = alwaysOn()
    world(on, [], { store })
    await $.session.start(session)
    await $.command.run(run('keepwarm', '48h'))
    await clock.advance(HOUR)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 48 * HOUR)
  })

  test('a turn that failed before any response does not open a window over a cold cache', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = alwaysOn()
    const w = world(on, [warm], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    // Back after the six-hour window ended; the first request fails for good, with no usage.
    await clock.advance(7 * HOUR)
    const before = w.forks.length
    await $.turn.complete(turn({ usage: undefined }))
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(before)
  })

  test('the cold-write receipt prints with always on, and the guard promises six hours', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [], { store: alwaysOn() })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/keepwarm will then hold the cache for 6h00m\./)
    await $.prompt.submit(prompt('hi'))
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    expect(w.logs.at(-1)).toBe('cold write of 200k tokens paid ($4.00).')
  })

  test('without always the receipt still offers three hours', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/keepwarm will then hold the cache for 3h00m\./)
    await $.prompt.submit(prompt('hi'))
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    expect(w.logs.at(-1)).toMatch(/^cold write of 200k tokens paid \(\$4\.00\)\. Keeping the cache warm for 3h00m/)
  })

  test('/keepwarm off in another session stops this one rolling at its next turn', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = alwaysOn()
    world(on, [], { store })
    await $.session.start(session)
    // Another session ran /keepwarm off: the shared switch is gone from the store.
    store.delete('glitchband.always')
    await clock.advance(5 * HOUR)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 6 * HOUR)
  })

  test('/keepwarm off that lands while the roll reads the clock wins', async ($, on) => {
    let now = START
    let skip = -1
    let release = () => {}
    on('clock.now', async () => {
      if (skip === 0) {
        skip = -1
        await new Promise<void>(r => { release = r })
      } else if (skip > 0) skip--
      return { value: now }
    })
    on('clock.after', () => new Promise<{ value: void }>(() => {}))
    on('clock.every', () => ({ value: undefined })) // the band's redraw tick
    const store = alwaysOn()
    const w = world(on, [warm], { now: () => now, store })
    await $.session.start(session)
    await $.turn.complete(turn())
    now += 10 * MIN
    // The finishing turn reads the clock once, then the roll reads it again: hold that second read.
    skip = 1
    const finishing = $.turn.complete(turn())
    await settle()
    expect((await $.command.run(run('keepwarm', 'off'))).text).toMatch(/^keepwarm is off/)
    release()
    await finishing
    await settle()
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect((await $.command.run(run('keepwarm', 'status'))).text).toBe('keepwarm is off')
    expect(w.forks.length).toBe(0)
  })
})

describe('the shared always switch across a turn', () => {
  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })
  const holdOnce = (op: 'get' | 'set' | 'delete', key: string) => {
    let armed = false
    let release = () => {}
    const gate = async (o: 'get' | 'set' | 'delete', k: string) => {
      if (armed && o === op && k === key) {
        armed = false
        await new Promise<void>(r => { release = r })
      }
    }
    return { gate, arm: () => { armed = true }, release: () => release() }
  }

  test('/keepwarm off while the turn reads the switch is not undone by the old value', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    const h = holdOnce('get', 'glitchband.always')
    const w = world(on, [warm], { store, storeGate: h.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(10 * MIN)
    h.arm()
    const finishing = $.turn.complete(turn())
    await settle()
    await $.command.run(run('keepwarm', 'off'))
    h.release()
    await finishing
    await settle()
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect((await $.command.run(run('keepwarm', 'status'))).text).toBe('keepwarm is off')
    await clock.advance(2 * HOUR)
    expect(w.forks.length).toBe(0)
  })

  test('/keepwarm off during a cold-writing turn also stops its three-hour auto-warm', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    const h = holdOnce('get', 'glitchband.always')
    const w = world(on, [warm], { store, storeGate: h.gate })
    await $.session.start(session)
    await $.command.run(run('glitchband', 'guard warn'))
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    const before = w.forks.length
    h.arm()
    const finishing = $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    await settle()
    await $.command.run(run('keepwarm', 'off'))
    h.release()
    await finishing
    await settle()
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect(w.logs.at(-1)).toBe('cold write of 200k tokens paid ($4.00).')
    await clock.advance(2 * HOUR)
    expect(w.forks.length).toBe(before)
  })

  test('always turned back on in another session reaches a session that saw it off', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    world(on, [], { store })
    await $.session.start(session)
    store.delete('glitchband.always')
    await clock.advance(HOUR)
    await $.turn.complete(turn())
    expect((await $.command.run(run('glitchband', ''))).text).not.toMatch(/\(always\)/)
    store.set('glitchband.always', true)
    await clock.advance(HOUR)
    await $.turn.complete(turn())
    expect(store.get('glitchband.deadline:S1')).toBe(START + 8 * HOUR)
  })
})

describe('/keepwarm off while a turn is running', () => {
  test('a cold write landing after the off does not reopen three hours', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    const w = world(on, [warm], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/^glitchband:/)
    await $.prompt.submit(prompt('hi'))
    // The paid resend's request is out when /keepwarm off runs, and its turn finishes after.
    for await (const c of $.turn.step({ turnId: 'comeback', index: 0, model: 'claude-fable-5-1', messageCount: 3 })) void c
    await $.command.run(run('keepwarm', 'off'))
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect(w.logs.at(-1)).toBe('cold write of 200k tokens paid ($4.00).')
    await clock.advance(2 * HOUR)
    expect(w.forks.length).toBe(0)
  })

  test('without an off the same cold write still arms three hours', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    world(on, [], { store })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    await $.prompt.submit(prompt('hi'))
    await $.prompt.submit(prompt('hi'))
    for await (const c of $.turn.step({ turnId: 'comeback', index: 0, model: 'claude-fable-5-1', messageCount: 3 })) void c
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    expect(store.get('glitchband.deadline:S1')).toBe(START + 2 * HOUR + 3 * HOUR)
  })
})

describe('a managed plugin above the user tier', () => {
  // Team and Enterprise accounts seat a builtin plugin at the prepend tier whose classic.* and session.compact hooks
  // continue beneath the user tier, so the mod's own hooks on those events never run.
  const managed: Plugin = {
    name: 'managed-sec',
    tier: 'prepend',
    register(on) {
      on('classic.SessionStart', ($, e, next) => next.to(e, 'append'))
      on('session.compact', ($, e, next) => next.to(e, 'append'))
    },
  }
  const end = ($: Parameters<TestBody>[0], sessionId: string, reason: 'clear' | 'resume' = 'clear') => $.session.end({ reason, sessionId, resume: { id: sessionId } })
  const step = async ($: Parameters<TestBody>[0], turnId: string, index: number, messageCount: number) => {
    for await (const c of $.turn.step({ turnId, index, model: 'claude-fable-5-1', messageCount })) void c
  }

  test('/clear reaches the mod through session.end: keepwarm stops, the tally empties and the new id is used', { plugins: [managed] }, async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    let sid = 'S1'
    let started = START
    const w = world(on, [warm], { store, sid: () => sid, startedAt: () => started })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    await $.prompt.submit(prompt('hi'))
    await $.prompt.submit(prompt('hi'))
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    expect(store.get('glitchband.deadline:S1')).toBe(START + 5 * HOUR)
    await end($, 'S1')
    sid = 'S2'
    started = clock.now()
    await $.classic.SessionStart({ source: 'clear' })
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect(w.status.at(-1)).toBe(undefined)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(0)
    const card = (await $.command.run(run('glitchband', ''))).text
    expect(card).toMatch(/state       no request yet this session/)
    expect(card).toMatch(/session     0 cold writes paid/)
    await $.command.run(run('keepwarm', '2h'))
    expect(store.get('glitchband.deadline:S2')).toBe(START + 4 * HOUR + 30 * MIN)
    expect(store.has('glitchband.deadline:S1')).toBe(false)
  })

  test('always after /clear arms the new conversation under its own id', { plugins: [managed] }, async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    let sid = 'S1'
    let started = START
    const w = world(on, [warm], { store, sid: () => sid, startedAt: () => started })
    await $.session.start(session)
    await $.turn.complete(turn())
    await end($, 'S1')
    sid = 'S2'
    started = clock.now()
    await $.classic.SessionStart({ source: 'clear' })
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    await $.prompt.submit(prompt('hello'))
    expect(store.get('glitchband.deadline:S2')).toBe(START + 6 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · waiting for the first turn')
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    expect(store.has('glitchband.deadline:S1')).toBe(false)
  })

  test('a /clear delivered twice, through session.end and the classic start, arms always once', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    let sid = 'S1'
    let started = START
    let sets = 0
    const w = world(on, [warm], { store, sid: () => sid, startedAt: () => started, storeGate: async (op, key) => { if (op === 'set' && key === 'glitchband.deadline:S2') sets++ } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await end($, 'S1')
    sid = 'S2'
    started = clock.now()
    await $.classic.SessionStart({ source: 'clear' })
    expect(sets).toBe(1)
    expect(store.has('glitchband.deadline:S1')).toBe(false)
    expect(store.get('glitchband.deadline:S2')).toBe(START + 6 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 6h00m left · waiting for the first turn')
    await $.prompt.submit(prompt('hi'))
    expect(sets).toBe(1)
    // The end of a conversation already left changes nothing.
    await end($, 'S1')
    expect(store.get('glitchband.deadline:S2')).toBe(START + 6 * HOUR)
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('a resumed session whose fields never arrive warns once with the price instead of refusing', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START + 3 * HOUR })
    const w = world(on, [], { live: { tokens: 200000 } })
    await $.session.start(session)
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 7200, context_tokens: 200000, prompt_cache_likely_expired: true })
    expect(w.logs).toEqual([])
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/state       unknown, resumed without the time of its last response/)
    expect((await $.prompt.submit(prompt('hi'))).drop).toBe(undefined)
    expect(w.entered).toEqual(['hi'])
    expect(w.logs).toEqual(['resumed with up to 200,000 tokens of context and no time of its last response, so the cache may be cold. If it is, this message re-writes them at $20/MTok = $4.00.'])
    await $.prompt.submit(prompt('again'))
    expect(w.logs.length).toBe(1)
    // The write it paid is still scored off the context the engine reported.
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }) }))
    expect(w.logs.at(-1)).toMatch(/^cold write of 200k tokens paid \(\$4\.00\)/)
  })

  test('a session first launched under an hour ago cannot be cold, so nothing is said', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START + 30 * MIN })
    const w = world(on, [], { live: { tokens: 200000 } })
    await $.session.start(session)
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 1800, context_tokens: 200000 })
    await $.prompt.submit(prompt('hi'))
    expect(w.logs).toEqual([])
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/state       no request yet this session/)
  })

  test('a resumed transcript too young to be cold is warned about once it is old enough', { plugins: [managed] }, async ($, on) => {
    const clock = mockClock(on, { now: START + 30 * MIN })
    const w = world(on, [], { live: { tokens: 200000 } })
    await $.session.start(session)
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 1800, context_tokens: 200000 })
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/state       resumed without the time of its last response, warm for up to 30m more/)
    await clock.advance(HOUR)
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/state       unknown, resumed without the time of its last response/)
    await $.prompt.submit(prompt('hi'))
    expect(w.logs.length).toBe(1)
    expect(w.logs[0]).toMatch(/^resumed with up to 200,000 tokens/)
  })

  test('with the resume fields delivered the guard prices the cold send and nothing is said twice', async ($, on) => {
    mockClock(on, { now: START + 3 * HOUR })
    const w = world(on, [], { live: { tokens: 200000 } })
    await $.session.start(session)
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 7200, context_tokens: 200000, prompt_cache_likely_expired: true })
    expect(w.logs.length).toBe(1)
    expect(w.logs[0]).toMatch(/^resuming cold/)
    expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/went cold 1h00m ago/)
    expect(w.logs.length).toBe(1)
  })

  test('an in-process resume moves the guard to the new transcript and keeps the window', { plugins: [managed] }, async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    let sid = 'S1'
    let started = START
    const live = { tokens: 200000 }
    const w = world(on, [], { store, sid: () => sid, startedAt: () => started, live })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    await $.command.run(run('keepwarm', '3h'))
    await end($, 'S1', 'resume')
    sid = 'S2'
    started = clock.now() - 30 * MIN
    live.tokens = 80000
    await $.classic.SessionStart({ session_id: 'S2', source: 'resume', seconds_since_last_response: 1800, context_tokens: 80000 })
    expect((await $.prompt.submit(prompt('hi'))).drop).toBe(undefined)
    expect(w.logs).toEqual([])
    expect(w.status.at(-1)).toBe('keepwarm 3h00m left · waiting for the first turn')
    const card = (await $.command.run(run('glitchband', ''))).text
    expect(card).toMatch(/context     80,000 tokens/)
    expect(card).toMatch(/session     0 cold writes paid/)
  })

  test('a restored window arms at session.start without the classic event', { plugins: [managed] }, async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.deadline:S1', START + 10 * MIN]])
    const w = world(on, [], { store })
    await $.session.start(session)
    await $.classic.SessionStart({ session_id: 'S1', source: 'startup' })
    expect(w.status.at(-1)).toBe('keepwarm 10m left · waiting for the first turn')
    await clock.advance(10 * MIN)
    expect(w.status.at(-1)).toBe(undefined)
    expect(store.has('glitchband.deadline:S1')).toBe(false)
  })

  test('the classic start arriving after session.start leaves one timer and one ping', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.deadline:S1', START + 3 * HOUR]])
    const w = world(on, [warm, warm], { store })
    await $.session.start(session)
    await $.classic.SessionStart({ session_id: 'S1', source: 'startup' })
    await $.turn.complete(turn())
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(1)
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(2)
  })

  test('a compaction that never reaches the mod is read off the next request\'s shorter transcript', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START })
    const w = world(on, [])
    await $.session.start(session)
    await step($, 'first', 0, 40)
    await $.turn.complete(turn())
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    await step($, 'after', 0, 3)
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/state       reset by compaction/)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 150000 }) }))
    expect(w.logs).toEqual([])
    expect(w.status.at(-1)).toBe(undefined)
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     0 cold writes paid/)
  })

  test('a summary written after a warm request in the same turn is no cold write', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START })
    const w = world(on, [], { steps: [usage(), usage(), usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 150000 })] })
    await $.session.start(session)
    await step($, 'first', 0, 40)
    await $.turn.complete(turn())
    await step($, 'long', 0, 42)
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    await step($, 'long', 1, 3)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 200000, cache_creation_input_tokens: 150500 }) }))
    expect(w.logs).toEqual([])
    expect(w.status.at(-1)).toBe(undefined)
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     0 cold writes paid/)
  })

  test('a rewind of a few messages is not a compaction', async ($, on) => {
    mockClock(on, { now: START })
    world(on, [])
    await $.session.start(session)
    await step($, 'first', 0, 40)
    await $.turn.complete(turn())
    await step($, 'rewound', 0, 38)
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/state       warm/)
  })

  test('a cold write and a compaction in the same turn still score the write', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [], { steps: [usage(), usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200000 }), usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 10000 })] })
    await $.session.start(session)
    await step($, 'first', 0, 40)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    await step($, 'comeback', 0, 42)
    await step($, 'comeback', 1, 3)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 210000 }) }))
    expect(w.logs.at(-1)).toMatch(/^cold write of 200k tokens paid \(\$4\.00\)/)
  })

  test('a classic clear after a command already seated the new conversation leaves its window alone', async ($, on) => {
    mockClock(on, { now: START })
    const store = new Map<string, unknown>([['glitchband.always', true]])
    let sid = 'S1'
    const w = world(on, [], { store, sid: () => sid })
    await $.session.start(session)
    await $.turn.complete(turn())
    await end($, 'S1')
    sid = 'S2'
    await $.command.run(run('keepwarm', '2h'))
    expect(store.get('glitchband.deadline:S2')).toBe(START + 2 * HOUR)
    await $.classic.SessionStart({ session_id: 'S2', source: 'clear' })
    expect(store.get('glitchband.deadline:S2')).toBe(START + 2 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 2h00m left · waiting for the first turn')
  })

  test('a model switched at an in-process resume prices the new transcript', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START + 3 * HOUR })
    let sid = 'S1'
    let model = 'claude-fable-5-1'
    const w = world(on, [], { sid: () => sid, model: () => model, live: { tokens: 200000 } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await end($, 'S1', 'resume')
    sid = 'S2'
    model = 'claude-haiku-5-5'
    await $.classic.SessionStart({ session_id: 'S2', source: 'resume', seconds_since_last_response: 7200, context_tokens: 200000, prompt_cache_likely_expired: true })
    await $.prompt.submit(prompt('hi'))
    expect(w.logs.at(-1)).toBe('resumed with up to 200,000 tokens of context and no time of its last response, so the cache may be cold. If it is, this message re-writes them at $1/MTok = $0.20.')
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/^claude-haiku-5-5\n/)
  })

  test('a classic resume ahead of the old conversation\'s end keeps the seeded clock', async ($, on) => {
    const clock = mockClock(on, { now: START })
    let sid = 'S1'
    const w = world(on, [], { sid: () => sid, live: { tokens: 200000 } })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(3 * HOUR)
    sid = 'S2'
    await $.classic.SessionStart({ session_id: 'S2', source: 'resume', seconds_since_last_response: 7200, context_tokens: 200000, prompt_cache_likely_expired: true })
    expect(w.logs.at(-1)).toMatch(/^resuming cold/)
    await end($, 'S1', 'resume')
    expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/went cold 1h00m ago/)
    expect(w.logs.length).toBe(1)
  })

  test('a window carried through a resume moves to the new id, so off and the old session find the right keys', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    let sid = 'S1'
    world(on, [], { store, sid: () => sid })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h every 2m'))
    expect(store.get('glitchband.deadline:S1')).toBe(START + 3 * HOUR)
    await end($, 'S1', 'resume')
    sid = 'S2'
    await $.prompt.submit(prompt('hi'))
    expect([...store.keys()].sort()).toEqual(['glitchband.deadline:S2', 'glitchband.every:S2'])
    expect(store.get('glitchband.deadline:S2')).toBe(START + 3 * HOUR)
    expect(store.get('glitchband.every:S2')).toBe(2 * MIN)
    await $.command.run(run('keepwarm', 'off'))
    expect([...store.keys()]).toEqual([])
  })

  const settle = () => new Promise<void>(r => { (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 20) })
  // Holds every delete of one key until released, in order, so two ends of the same conversation can be interleaved.
  const holdDeletes = (key: string) => {
    const waiting: Array<() => void> = []
    return {
      gate: async (op: 'get' | 'set' | 'delete', k: string) => { if (op === 'delete' && k === key) await new Promise<void>(r => { waiting.push(r) }) },
      release: () => waiting.shift()?.(),
      held: () => waiting.length,
    }
  }

  test('a session.end that lands while the classic resume is still deleting the old keys cannot wipe the seeded clock', async ($, on) => {
    const clock = mockClock(on, { now: START })
    let sid = 'S1'
    const held = holdDeletes('glitchband.deadline:S1')
    const w = world(on, [], { store: new Map<string, unknown>(), sid: () => sid, live: { tokens: 200000 }, storeGate: held.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await clock.advance(3 * HOUR)
    sid = 'S2'
    const resuming = $.classic.SessionStart({ session_id: 'S2', source: 'resume', seconds_since_last_response: 7200, context_tokens: 200000, prompt_cache_likely_expired: true })
    await settle()
    expect(held.held()).toBe(1)
    const ending = end($, 'S1', 'resume')
    await settle()
    held.release()
    await resuming
    held.release()
    await ending
    expect(w.logs.length).toBe(1)
    expect(w.logs[0]).toMatch(/^resuming cold/)
    expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/went cold 1h00m ago/)
    expect(w.logs.length).toBe(1)
  })

  test('an end cut short in its store cleanup has already dropped the old timer and id', { plugins: [managed] }, async ($, on) => {
    const clock = mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    let sid = 'S1'
    const held = holdDeletes('glitchband.deadline:S1')
    const w = world(on, [warm], { store, sid: () => sid, storeGate: held.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '3h'))
    const ending = end($, 'S1', 'resume')
    await settle()
    expect(held.held()).toBe(1)
    sid = 'S2'
    // The old conversation's ping is due while its end is still waiting on the store; the transcript it would fork is gone.
    await clock.advance(30 * MIN)
    expect(w.forks.length).toBe(0)
    await $.prompt.submit(prompt('hi'))
    expect(store.get('glitchband.deadline:S2')).toBe(START + 3 * HOUR)
    held.release()
    await ending
    expect(store.has('glitchband.deadline:S1')).toBe(false)
  })

  test('a /keepwarm while the old conversation is still ending waits for the host to report the next id', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START })
    const store = new Map<string, unknown>()
    let sid = 'S1'
    let model = 'claude-fable-5-1'
    const held = holdDeletes('glitchband.deadline:S1')
    const w = world(on, [], { store, sid: () => sid, model: () => model, storeGate: held.gate })
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '1h'))
    const ending = end($, 'S1')
    await settle()
    expect(held.held()).toBe(1)
    // The host still answers the old id: the window waits in memory, nothing is written under that id.
    expect((await $.command.run(run('keepwarm', '2h'))).text).toMatch(/^keepwarm on for 2h00m/)
    expect(store.get('glitchband.deadline:S1')).toBe(START + HOUR)
    held.release()
    await ending
    expect(store.size).toBe(0)
    sid = 'S2'
    model = 'claude-haiku-5-5'
    await $.prompt.submit(prompt('hi'))
    expect([...store.keys()]).toEqual(['glitchband.deadline:S2'])
    expect(store.get('glitchband.deadline:S2')).toBe(START + 2 * HOUR)
    expect(w.status.at(-1)).toBe('keepwarm 2h00m left · waiting for the first turn')
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/^claude-haiku-5-5\n/)
  })

  test('a guarded cold send compacted before its first request pays the summary, not a cold write', { plugins: [managed] }, async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [], { steps: [usage(), usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 150000 })] })
    await $.session.start(session)
    await step($, 'first', 0, 40)
    await $.turn.complete(turn())
    await clock.advance(2 * HOUR)
    expect((await $.prompt.submit(prompt('hi'))).drop).toMatch(/^glitchband:/)
    await $.prompt.submit(prompt('hi'))
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })
    await step($, 'comeback', 0, 3)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 150000 }) }))
    expect(w.logs).toEqual([])
    expect(w.status.at(-1)).toBe(undefined)
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     0 cold writes paid/)
  })

  test('a second compaction in one turn does not turn the first summary into a cold write', { plugins: [managed] }, async ($, on) => {
    mockClock(on, { now: START })
    const summary = usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 120000 })
    const w = world(on, [], { steps: [usage(), usage(), summary, usage(), summary] })
    await $.session.start(session)
    await step($, 'first', 0, 40)
    await $.turn.complete(turn())
    await step($, 'long', 0, 42)
    await step($, 'long', 1, 3)
    await step($, 'long', 2, 15)
    await step($, 'long', 3, 3)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 200000, cache_creation_input_tokens: 241000 }) }))
    expect(w.logs).toEqual([])
    expect(w.status.at(-1)).toBe(undefined)
    expect((await $.command.run(run('glitchband', ''))).text).toMatch(/session     0 cold writes paid/)
  })
})

describe('a 5-minute cache', () => {
  const tail = JSON.stringify({ type: 'assistant', message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 900 } } } })

  test('pings halfway through its life, not after 30 minutes', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
    on('fs.list', () => ({ value: [{ name: '-work', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }))
    on('fs.exists', (_, e) => ({ value: e.path === '/home/u/.claude/projects/-work/S1.jsonl' }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: tail, stderr: '' } }))
    await $.session.start({ ...session, surface: 'terminal', isInteractive: true })
    await $.turn.complete(turn())
    await $.command.run(run('keepwarm', '1h'))
    await clock.advance(2 * MIN + 29 * 1000)
    expect(w.forks.length).toBe(0)
    await clock.advance(1000)
    expect(w.forks.length).toBe(1)
    expect((await $.command.run(run('keepwarm', '2h every 5m'))).text).toBe('every takes a period from 1m to 4m')
  })
})

// A /reload-plugins or a worker respawn starts the module's state over while the store and the atoms survive. This engine
// keeps both in plain maps and runs timers by hand, so a test can start a second state over the first one's leftovers.
function survivors(o: { sid?: () => string } = {}) {
  let now = START
  const store = new Map<string, unknown>()
  const atoms = new Map<string, { value: unknown; version: number }>()
  const timers: Array<{ at: number; fn: () => void; dead: boolean }> = []
  const answers: ModelForkResult[] = []
  const at = (ref: { plugin: string; key: string }) => atoms.get(`${ref.plugin}/${ref.key}`) ?? { value: undefined, version: 0 }
  const engine = {
    session: {
      id: async () => o.sid?.() ?? 'S1',
      model: async () => 'claude-fable-5-1',
      usage: async () => ({ startedAt: START, context: { window: 1000000, tokens: undefined }, rateLimits: [] }),
    },
    clock: {
      now: async () => now,
      after: (ms: number, fn: () => void) => {
        const timer = { at: now + ms, fn, dead: false }
        timers.push(timer)
        return { cancel: () => { timer.dead = true } }
      },
    },
    store: {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => { store.set(k, v) },
      delete: async (k: string) => { store.delete(k) },
    },
    state: {
      get: async (ref: { plugin: string; key: string }) => at(ref),
      set: async (ref: { plugin: string; key: string }, value: unknown, opt?: { ifVersion?: number }) => {
        const cur = at(ref)
        if (opt?.ifVersion !== undefined && opt.ifVersion !== cur.version) return { isSet: false, version: cur.version }
        atoms.set(`${ref.plugin}/${ref.key}`, { value, version: cur.version + 1 })
        return { isSet: true, version: cur.version + 1 }
      },
    },
    ui: { log: () => undefined },
    model: { fork: async () => answers.shift() ?? null },
  } as unknown as EngineInterface
  const advance = async (ms: number) => {
    const target = now + ms
    for (;;) {
      const due = timers.filter(t => !t.dead && t.at <= target).sort((x, y) => x.at - y.at)[0]
      if (!due) break
      due.dead = true
      now = Math.max(now, due.at)
      due.fn()
      await new Promise(r => setTimeout(r, 0))
    }
    now = target
  }
  const answer = (read: number, write: number) => answers.push({ isAnswered: true, text: 'warm', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: write } })
  return { $: engine, advance, answer, store }
}

const startOver = async ($: EngineInterface, options?: { window?: number }): Promise<State> => {
  const fresh = freshState(options)
  await sessionStart(fresh, $, session, async e => ({ cwd: e.cwd }))
  return fresh
}

describe('a bare /keepwarm always arms the window', () => {
  const ARMED = /^keepwarm on for 6h00m/

  test('after a resume, with always on and a cache seen as 1h', async ($, on) => {
    mockClock(on, { now: START })
    world(on, [], { store: new Map<string, unknown>([['glitchband.always', true]]) })
    await $.session.start({ ...session, surface: 'desktop', isInteractive: true })
    await $.classic.SessionStart({ session_id: 'S1', source: 'resume', seconds_since_last_response: 600, context_tokens: 200000 })
    expect((await $.command.run(run('keepwarm', ''))).text).toMatch(ARMED)
    await $.turn.complete(turn())
    expect((await $.command.run(run('keepwarm', ''))).text).toMatch(ARMED)
  })

  test('after a reload that restarts the module state over the surviving store', async () => {
    const w = survivors()
    const first = await startOver(w.$)
    expect((await keepwarmCommand(first, w.$, run('keepwarm', 'always'))).text).toMatch(/^keepwarm always on/)
    const fresh = await startOver(w.$)
    expect(fresh.always).toBe(true)
    expect((await keepwarmCommand(fresh, w.$, run('keepwarm', ''))).text).toMatch(ARMED)
    expect((await keepwarmCommand(fresh, w.$, { ...run('keepwarm', ''), args: undefined })).text).toMatch(ARMED)
    expect((await keepwarmCommand(fresh, w.$, { ...run('keepwarm', ''), args: ['  '] as unknown as string })).text).toMatch(ARMED)
  })

  test('a window or a cache lifetime that is not a positive number falls back to the defaults', async () => {
    const w = survivors()
    const bad = freshState({ window: Number.NaN })
    bad.ttlMs = Number.NaN
    expect((await keepwarmCommand(bad, w.$, run('keepwarm', ''))).text).toMatch(ARMED)
    expect(bad.ttlMs).toBe(HOUR)
    expect(bad.every).toBeGreaterThanOrEqual(MIN)
    const zero = freshState({ window: 0 })
    zero.ttlMs = 0
    expect((await keepwarmCommand(zero, w.$, run('keepwarm', ''))).text).toMatch(ARMED)
  })
})

describe('the ping period is half the cache lifetime', () => {
  test('30 minutes for the 1-hour cache, 2m30s for the 5-minute one', () => {
    expect(pingAfterMs(HOUR)).toBe(30 * MIN)
    expect(pingAfterMs(5 * MIN)).toBe(2.5 * MIN)
    expect(freshState().every).toBe(30 * MIN)
  })

  test('the first ping goes out 30 minutes after the last request, and says so', async ($, on) => {
    const clock = mockClock(on, { now: START })
    const w = world(on, [warm])
    await $.session.start(session)
    await $.turn.complete(turn())
    expect((await $.command.run(run('keepwarm', ''))).text).toMatch(/a ping 30m after each idle stretch/)
    await clock.advance(30 * MIN - 1000)
    expect(w.forks.length).toBe(0)
    await clock.advance(1000)
    expect(w.forks.length).toBe(1)
  })
})

describe('a reload keeps what the session has paid', () => {
  const next = async () => ({ text: 'ok' })
  const paid = turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200500 }) })

  test('the ping tally, the last ping and the cold writes come back from the facts of the same session', async () => {
    let sid = 'S1'
    const w = survivors({ sid: () => sid })
    const first = await startOver(w.$)
    await turnComplete(first, w.$, turn(), next)
    await turnComplete(first, w.$, paid, next)
    expect(first.misses.length).toBe(1)
    await keepwarmCommand(first, w.$, run('keepwarm', '6h'))
    w.answer(200000, 0)
    await w.advance(first.every)
    expect(first.pings).toBe(1)

    const fresh = await startOver(w.$)
    expect(fresh.pings).toBe(1)
    expect(fresh.pingUsd).toBe(first.pingUsd)
    expect(fresh.last?.read).toBe(200000)
    expect(fresh.misses.length).toBe(1)
    const facts = await readKeepwarm(w.$)
    expect(facts?.pings).toBe(1)
    expect(facts?.coldWrites).toBe(1)
    expect(Math.round((facts?.coldUsd ?? 0) * 100)).toBe(401)
    expect(facts?.last?.read).toBe(200000)

    sid = 'S2'
    const other = await startOver(w.$)
    expect(other.pings).toBe(0)
    expect(other.last).toBe(null)
    expect(other.misses.length).toBe(0)
  })
})
