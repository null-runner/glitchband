import { expect, mock } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'

import { MODELS, TTL_MS, coldCost, viewOf } from '../src/cache/cache'
import { ttlFromTail } from '../src/cache/ttl'
import { answerSession } from './answers'
import { testEn as test } from './lang'

const MIN = 60 * 1000
const NOW = 5_000_000

const assistant = (h: number, m: number, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'assistant', ...extra, message: { usage: { cache_creation: { ephemeral_1h_input_tokens: h, ephemeral_5m_input_tokens: m } } } })

test('the newest main-thread assistant line decides, a newer sidechain line is ignored', async () => {
  const tail = [assistant(900, 0), assistant(0, 700), assistant(800, 0, { isSidechain: true })].join('\n')
  expect(ttlFromTail(tail)).toBe('5m')
})

test('a 1-hour write reads as 1h', async () => {
  expect(ttlFromTail([assistant(0, 700), assistant(1200, 0)].join('\n'))).toBe('1h')
})

test('unparsable lines, user lines and empty writes are skipped; nothing found is null', async () => {
  const cut = '{"type":"assistant","message":{"usage":{"cache_cre'
  const tail = [cut, assistant(0, 40), 'not json', JSON.stringify({ type: 'user' }), assistant(0, 0)].join('\n')
  expect(ttlFromTail(tail)).toBe('5m')
  expect(ttlFromTail([cut, 'x', assistant(0, 0)].join('\n'))).toBe(null)
})

const facts = (ttl?: '1h' | '5m') => ({ lastAt: NOW, tokens: 100000, window: 1000000, model: 'claude-opus-5-5', ...(ttl && { ttl }) })

test('a 5-minute cache goes COLD after 5 minutes idle', async () => {
  expect(viewOf(facts('5m'), NOW + 4 * MIN)?.mode).toBe('warm')
  const v = viewOf(facts('5m'), NOW + 5 * MIN)
  expect(v?.mode).toBe('cold')
  expect(v?.ttlMin).toBe(5)
})

test('a 1-hour or undetected cache is still WARM at 30 minutes and COLD at 60', async () => {
  for (const ttl of ['1h', undefined] as const) {
    expect(viewOf(facts(ttl), NOW + 30 * MIN)?.mode).toBe('warm')
    expect(viewOf(facts(ttl), NOW + 60 * MIN)?.mode).toBe('cold')
    expect(viewOf(facts(ttl), NOW)?.ttlMin).toBe(60)
  }
})

test('the re-cache price is 2x input for 1h and 1.25x for 5m', async () => {
  const opus = MODELS.find(m => m.id === 'opus')!
  const cents = (n: number) => Math.round(n * 100)
  expect(cents(coldCost(opus, 1e6))).toBe(800)
  expect(cents(coldCost(opus, 1e6, TTL_MS))).toBe(800)
  expect(cents(coldCost(opus, 1e6, 5 * MIN))).toBe(500)
})

// A session whose transcript is where the mod looks: HOME/.claude/projects/-work/S1.jsonl.
const world = (on: On, run: () => { exitCode: number; stdout: string; stderr: string }): { argv: string[][] } => {
  const argv: string[][] = []
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000, tokens: 100000 }, rateLimits: [] } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.list', () => ({ value: [{ name: '-other', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }, { name: '-work', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.exists', (_, e) => ({ value: e.path === '/home/u/.claude/projects/-work/S1.jsonl' }))
  on('process.run', (_, e) => { argv.push([...e.argv]); return { value: { ...run() } } })
  return { argv }
}

const turn: TurnCompleteInput = {
  answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer',
  usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 90000, cache_creation_input_tokens: 500, model: 'claude-opus-5-5' },
}
const status = ($: { command: { run: (c: never) => Promise<{ text?: string }> } }) =>
  $.command.run({ command: 'glitchband', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)

test('/glitchband says the lifetime was read from the transcript, reading its tail once found', async ($, on) => {
  const w = world(on, () => ({ exitCode: 0, stdout: [assistant(0, 700), assistant(1, 0, { isSidechain: true })].join('\n'), stderr: '' }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.turn.complete(turn)
  expect(w.argv).toEqual([['tail', '-c', '2000000', '/home/u/.claude/projects/-work/S1.jsonl']])
  expect((await status($ as never)).text).toMatch(/cache life  5m \(from this chat's transcript\)/)
})

test('/glitchband says 1h is assumed when the transcript cannot be read', async ($, on) => {
  world(on, () => ({ exitCode: 1, stdout: '', stderr: 'tail: not found' }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.turn.complete(turn)
  expect((await status($ as never)).text).toMatch(/cache life  1h \(assumed\)/)
})
