import { atom, read, update } from 'claude-code'
import type { EngineInterface, Events } from 'claude-code'

import type { KeepwarmFacts, Ping } from '../../types'
import { TTL_MS, writeMultiple } from '../cache/cache'
import { fmtInt, t } from '../i18n'

// Ported from cache-tax 2.3.1 (Karan Bansal, MIT). The behaviour is the original's; what changed is where it
// shows: the facts below are published for the band instead of a status line.

export const PING_AFTER_MS = 50 * 60 * 1000
// A 5-minute cache is pinged 75 s before it expires: late enough to add almost nothing to the idle time it
// holds, early enough that a slow fork still lands inside the cache's life.
const PING_LEAD_MS = 75 * 1000

/** How long after a request the default ping goes out, for a cache that lives this long. */
export const pingAfterMs = (ttlMs: number): number => (ttlMs < TTL_MS ? ttlMs - PING_LEAD_MS : PING_AFTER_MS)
export const MIN_PING_MS = 60 * 1000
const MAX_RETRIES = 3
const AUTO_WARM_MS = 3 * 60 * 60 * 1000
export const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000
const BIG_TOKENS = 50000
const PING_PROMPT = 'Reply with the single word: warm'
const KEY_DEADLINE = 'glitchband.deadline'
const KEY_EVERY = 'glitchband.every'
export const KEY_GUARD = 'glitchband.guard'
export const KEY_ALWAYS = 'glitchband.always'

// Prompts no person sent, so nobody could send them again after a refusal. Every
// other origin, including sdk, unclassified and the owner's own Slack or channel
// messages, may carry a person's words and keeps the guard.
const UNATTENDED = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity'])

const LONG_PROMPT_TOKENS = 100000

// $ per million tokens, [cache read, 1h cache write, output], list prices October 2026.
// More specific families first: a model id takes the first row it matches.
const PRICES: Array<[string | RegExp, number, number, number]> = [
  ['fable-5-1', 0.25, 20, 50],
  ['mythos-5-1', 0.25, 20, 50],
  ['fable-5', 1, 20, 50],
  ['mythos-5', 1, 20, 50],
  ['opus-5-5', 0.2, 8, 20],
  ['opus-5', 0.5, 10, 25],
  // Opus 4 and 4.1 in every spelling (claude-opus-4-1-20250805, claude-opus-4@20250514, the -0 and -1 aliases), never Opus 4.5 and later.
  [/opus-4(?:-[01])?(?:$|[^-\d]|-20\d{6})/, 1.5, 30, 75],
  ['opus-4', 0.5, 10, 25],
  ['sonnet-5-5', 0.1, 4, 10],
  ['sonnet-5', 0.2, 4, 10],
  ['sonnet', 0.3, 6, 15],
  ['haiku-5-5', 0.01, 0.2, 0.5],
  ['3-5-haiku', 0.08, 1.6, 4],
  ['haiku-3-5', 0.08, 1.6, 4],
  ['haiku', 0.1, 2, 5],
]

// A request whose prompt, cache reads and writes included, is over 100k tokens pays these instead.
const LONG_PRICES: Array<[string, number, number, number]> = [
  ['haiku-5-5', 0.05, 1, 2.5],
]

type Miss = { at: number; tokens: number; usd: number | null }
type GuardMode = 'refuse' | 'warn'

export type State = {
  sid: string
  deadline: number
  every: number
  always: boolean
  lastRequestAt: number
  lastModel: string | null
  ctx: number
  compacted: boolean
  resumedAt: number
  transcript: number
  guard: GuardMode
  ackedAt: number
  coldWritePending: boolean
  misses: Miss[]
  pending: { cancel: () => void } | null
  last: Ping | null
  pings: number
  pingUsd: number
  stopped: string | null
  waitForTurn: boolean
  retries: number
  retryReason: string
  gen: number
  tick: number
  offs: number
  turnOffs: number | null
  inFlight: boolean
  stepWrites: StepWrites | null
  steps: number
  endingSid: string
  /** How long the cache lives; 1 hour until the transcript says otherwise. */
  ttlMs: number
  /** Whether ttlMs was read from the transcript rather than assumed. */
  ttlSeen: boolean
  /** What the button and a bare /keepwarm arm, from the keepwarmWindow option. */
  window: number
  /** Whether the cold-send guard is on, from the coldGuard option. */
  guardOn: boolean
}

/** What this turn's main requests wrote before any compaction it saw, priced per request where the steps reported usage. */
type StepWrites = { tokens: number; usd: number; priced: boolean }

// The table's write column is the 1-hour rate; a 5-minute write is cheaper, so its column is scaled to 1.25x input.
function priceOf(model: string | null, promptTokens: number, ttlMs = TTL_MS): [number, number, number] | null {
  const scale = writeMultiple(ttlMs) / 2
  const row = ([read, write, output]: [number, number, number]): [number, number, number] => [read, write * scale, output]
  const m = (model ?? '').toLowerCase().replace(/[\s.]+/g, '-')
  if (promptTokens > LONG_PROMPT_TOKENS) {
    for (const [family, read, write, output] of LONG_PRICES) if (m.includes(family)) return row([read, write, output])
  }
  for (const [family, read, write, output] of PRICES) {
    if (typeof family === 'string' ? m.includes(family) : family.test(m)) return row([read, write, output])
  }
  return null
}

export function parseDuration(text: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text.trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 * 1000
}

export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(total / 60)
  const m = total % 60
  const [um, uh, ud] = [t('unit.m'), t('unit.h'), t('unit.d')]
  if (h >= 48) return `${Math.floor(h / 24)}${ud} ${h % 24}${uh}`
  return h > 0 ? `${h}${uh}${String(m).padStart(2, '0')}${um}` : `${m}${um}`
}

export function fmtUsd(usd: number | null): string {
  return usd == null ? t('fmt.na') : '$' + (usd >= 100 ? usd.toFixed(0) : usd.toFixed(2))
}

function fmtTok(n: number): string {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

export function coldUsd(s: State): number | null {
  const price = priceOf(s.lastModel, s.ctx, s.ttlMs)
  return price ? s.ctx * price[1] / 1e6 : null
}

export function warmUsd(s: State): number | null {
  const price = priceOf(s.lastModel, s.ctx, s.ttlMs)
  return price ? s.ctx * price[0] / 1e6 : null
}

/** Everything a fork bills: the cache read, any cache write, uncached input at the base rate (the write rate over its multiple), and the output. */
function pingUsd(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }, price: [number, number, number], ttlMs: number): number {
  return (u.cache_read_input_tokens * price[0] + u.cache_creation_input_tokens * price[1] + u.input_tokens * price[1] / writeMultiple(ttlMs) + u.output_tokens * price[2]) / 1e6
}

/** The read-only upper bound: pings at the cache-read rate that cost as much as one cold write of the same context. */
export function breakEvenPings(s: State): number | null {
  const price = priceOf(s.lastModel, s.ctx, s.ttlMs)
  if (!price || s.ctx <= 0) return null
  return Math.floor(price[1] / price[0])
}

type StatusFacts = Pick<KeepwarmFacts, 'deadline' | 'every' | 'lastRequestAt' | 'compacted' | 'waitForTurn' | 'retries' | 'stopped' | 'last'>

export function isCold(s: Pick<KeepwarmFacts, 'lastRequestAt' | 'compacted'>, now: number): boolean {
  return s.lastRequestAt > 0 && !s.compacted && now - s.lastRequestAt >= (s.ttlMs ?? TTL_MS)
}

/** The cache-write rate as the messages quote it: $20/MTok, or words when the model is not priced. */
export function rateText(s: State): string {
  const price = priceOf(s.lastModel, s.ctx, s.ttlMs)
  return price ? `$${price[1]}/MTok` : t('guard.rate')
}

function guardText(s: State, now: number): string {
  const warm = warmUsd(s)
  return t('guard.text', {
    ago: fmtDuration(now - s.lastRequestAt - s.ttlMs),
    tokens: fmtInt(s.ctx),
    rate: rateText(s),
    cost: fmtUsd(coldUsd(s)),
    warm: warm == null ? '' : t('guard.warm', { usd: fmtUsd(warm) }),
  })
}

export type ResumeFields = {
  source: string
  model?: string
  context_tokens?: number
  seconds_since_last_response?: number
  prompt_cache_likely_expired?: boolean
  estimated_cache_write_usd?: number
}

/** /clear starts a new conversation in the same process; nothing priced before it still exists. */
export function resetForClear(s: State) {
  s.ctx = 0
  s.lastRequestAt = 0
  s.compacted = false
  s.resumedAt = 0
  s.transcript = 0
  s.ackedAt = 0
  s.coldWritePending = false
  s.misses = []
  s.pings = 0
  s.pingUsd = 0
  s.waitForTurn = false
  s.stepWrites = null
  s.steps = 0
  outdate(s)
  disarm(s)
}

/** Applies a resumed session's fields to the state; returns the line to log, if any. */
export function seedFromResume(s: State, e: ResumeFields, now: number): string | null {
  if (e.source !== 'resume' && e.source !== 'fork') return null
  if (typeof e.context_tokens === 'number' && e.context_tokens > 0) s.ctx = e.context_tokens
  if (typeof e.seconds_since_last_response === 'number') {
    s.lastRequestAt = now - e.seconds_since_last_response * 1000
    s.resumedAt = 0
  }
  if (typeof e.model === 'string') s.lastModel = e.model
  s.compacted = false
  if (e.prompt_cache_likely_expired !== true || s.ctx < BIG_TOKENS) return null
  const usd = typeof e.estimated_cache_write_usd === 'number' ? fmtUsd(e.estimated_cache_write_usd) : fmtUsd(coldUsd(s))
  return t('resume.cold', { tokens: fmtInt(s.ctx), usd })
}

/** A transcript resumed without the time of its last response: that response came after its first launch, so an hour after that launch the cache may be cold. */
export function mayBeCold(s: State, now: number): boolean {
  return s.resumedAt > 0 && !s.lastRequestAt && now - s.resumedAt >= s.ttlMs
}

/** The line for a resumed session whose last response time never arrived: the cache may be cold, and this is what that would cost. */
function unknownText(s: State): string {
  return t('resume.unknown', { tokens: fmtInt(s.ctx), rate: rateText(s), cost: fmtUsd(coldUsd(s)) })
}

/** The conversation was summarized: the next request is the first over the new prefix, and a ping out for the old one is dropped. */
function markCompacted(s: State) {
  s.compacted = true
  s.transcript = 0
  s.ackedAt = 0
  outdate(s)
}

/** What the window's status says after the word keepwarm: the time left, when the next ping is due and the last ping's read. */
export function leftText(s: StatusFacts, now: number): string {
  const ping = s.last ? t('status.ping', { read: fmtTok(s.last.read), usd: fmtUsd(s.last.usd) }) : ''
  const next = !s.lastRequestAt ? t('status.waitFirst')
    : s.compacted ? t('status.waitCompact')
    : isCold(s, now) ? t('status.coldNow', { every: fmtDuration(s.every) })
    : s.waitForTurn ? t('status.nothingToFork')
    : s.retries ? t('status.busy', { n: s.retries, max: MAX_RETRIES })
    : t('status.pingIn', { time: fmtDuration(s.lastRequestAt + s.every - now) })
  return t('status.left', { time: fmtDuration(s.deadline - now), next, ping })
}

export function statusText(s: StatusFacts, now: number): string | undefined {
  if (s.stopped) return t('status.stopped', { why: s.stopped })
  if (!s.deadline) return undefined
  return t('status.line', { body: leftText(s, now) })
}

const keepwarm = atom({ plugin: 'glitchband', key: 'keepwarm' } as const, null as KeepwarmFacts | null)

export async function readKeepwarm($: EngineInterface): Promise<KeepwarmFacts | null> {
  return read($, keepwarm)
}

/** What the band reads: the window, the ping tally and the cold-write tally. */
function factsOf(s: State): KeepwarmFacts {
  return {
    deadline: s.deadline, every: s.every, ttlMs: s.ttlMs, always: s.always, lastRequestAt: s.lastRequestAt, compacted: s.compacted,
    waitForTurn: s.waitForTurn, retries: s.retries, stopped: s.stopped, last: s.last, pings: s.pings, pingUsd: s.pingUsd,
    coldWrites: s.misses.length, coldUsd: s.misses.reduce((a, m) => a + (m.usd ?? 0), 0),
  }
}

/** The clock read the status line took at a stop and at a clear. The tests for /clear and /keepwarm off racing each other order their pauses around it, so it stays. */
async function clockTurn($: EngineInterface) {
  await $.clock.now()
}

/** Hands the band the state as it stands; every change of the window or the tallies ends here. */
async function publish($: EngineInterface, s: State) {
  await update($, keepwarm, () => factsOf(s))
}

/** The transcript said how long the cache lives: the default ping period follows it, and a window already armed is re-timed. */
export async function setTtl($: EngineInterface, s: State, ttlMs: number) {
  const changed = s.ttlMs !== ttlMs
  const wasDefault = s.every === pingAfterMs(s.ttlMs)
  s.ttlMs = ttlMs
  s.ttlSeen = true
  if (!changed) return
  // A custom period that no longer fits inside the cache's life goes back to the default too.
  if (wasDefault || s.every >= ttlMs) {
    s.every = pingAfterMs(ttlMs)
    if (s.sid) await $.store.delete(everyKey(s))
  }
  if (s.deadline) await arm($, s)
  else await publish($, s)
}

/** Cancels the timer. Every new timer is set right after this, so the tick also says the schedule changed. */
function disarm(s: State) {
  if (s.pending) s.pending.cancel()
  s.pending = null
  s.tick++
}

/** Outdates any ping in flight: /clear, a resume, compaction or stop replaced the state it was sent for. Re-arming or extending the window does not, so a ping out at that moment still counts; a main request outdates it through the request clock. */
function outdate(s: State) {
  s.gen++
}

// The window and its ping period belong to the session that armed them, so a
// second session, or one resumed from another transcript, never inherits them
// and cannot turn them off. The always switch and the guard mode stay global.
function deadlineKey(s: State): string {
  return `${KEY_DEADLINE}:${s.sid}`
}

function everyKey(s: State): string {
  return `${KEY_EVERY}:${s.sid}`
}

/** Clears this session's own dead window. Other sessions' keys are never touched: a read followed by a delete cannot be made atomic against their renewal. */
async function prune($: EngineInterface, s: State, now: number) {
  const deadline = await $.store.get(deadlineKey(s))
  if (deadline === undefined || (typeof deadline === 'number' && deadline > now)) return
  await $.store.delete(deadlineKey(s))
  await $.store.delete(everyKey(s))
}

export async function stop($: EngineInterface, s: State, why: string | null, forgetAlways = false) {
  // Set before any await, so a window being opened at the same moment sees the off and does not write itself back.
  if (forgetAlways) {
    s.always = false
    s.offs++
  }
  s.deadline = 0
  s.every = pingAfterMs(s.ttlMs)
  s.stopped = why
  s.retries = 0
  outdate(s)
  disarm(s)
  await $.store.delete(deadlineKey(s))
  await $.store.delete(everyKey(s))
  if (forgetAlways) await $.store.delete(KEY_ALWAYS)
  await clockTurn($)
  await publish($, s)
}

/** The conversation ended under /clear or an in-process resume. The next one's id cannot be read until the engine has switched, so the state is left unseated. */
async function endConversation($: EngineInterface, s: State, reason: 'clear' | 'resume') {
  // Claimed before any await: a second end or a classic start for the same conversation finds it already gone, and an
  // end cut short by its budget leaves no timer and no old id behind, only the keys below.
  const keys = [deadlineKey(s), everyKey(s)]
  const ending = s.sid
  resetForClear(s)
  s.sid = ''
  s.endingSid = ending
  // /clear ends the conversation the window was armed for. A resume carries the window on to the next one, under its
  // id: the old id's keys go here, or a /keepwarm off there could never find them and the old session would re-arm them.
  if (reason === 'clear') {
    s.deadline = 0
    s.every = pingAfterMs(s.ttlMs)
    s.stopped = null
    s.retries = 0
  }
  for (const key of keys) await $.store.delete(key)
  if (reason === 'clear') {
    await clockTurn($)
    await publish($, s)
  }
}

/** Reads the session the process runs now: its id, its model and the engine's figures for its context. Returns the time read with them. */
async function seat($: EngineInterface, s: State, id?: string): Promise<number> {
  s.sid = id ?? await $.session.id()
  s.endingSid = ''
  s.lastModel = await $.session.model()
  const usage = await $.session.usage()
  const now = await $.clock.now()
  if (usage.context.tokens) s.ctx = usage.context.tokens
  // A resumed transcript's last response came somewhere between its first launch and now; only the resume fields say where.
  s.resumedAt = !s.lastRequestAt && usage.context.tokens ? usage.startedAt : 0
  return now
}

/** Seats the state in the conversation that followed a /clear or a resume, once, and arms what always or a window opened meanwhile asks for. */
export async function reseat($: EngineInterface, s: State) {
  if (s.sid) return
  const id = await $.session.id()
  // The host still answers with the conversation being ended: the next one is not there to seat yet, so nothing is
  // seated under the old id, and a window opened meanwhile waits in memory for the id it belongs to.
  if (id === s.endingSid) return
  const now = await seat($, s, id)
  if (s.always) await startWindow($, s, DEFAULT_WINDOW_MS, pingAfterMs(s.ttlMs))
  // A window carried over, or armed while the conversation was ending, is written under this id.
  else if (s.deadline) await startWindow($, s, s.deadline - now, s.every)
  else await publish($, s)
}

async function arm($: EngineInterface, s: State) {
  disarm(s)
  s.retries = 0
  if (!s.deadline) return
  const now = await $.clock.now()
  // A timer set while the clock was read, such as a retry, is replaced here, never left running beside this one;
  // from this line to the assignment below nothing awaits.
  disarm(s)
  s.retries = 0
  if (now >= s.deadline) return stop($, s, null)
  // A cold window still needs expiry cleanup, but must not send a model request.
  if (s.lastRequestAt && !s.compacted && !isCold(s, now)) {
    const untilCold = s.lastRequestAt + s.ttlMs - now
    // Waiting for a turn sends nothing, but wakes when the cache goes cold so the row says so.
    if (s.waitForTurn) s.pending = $.clock.after(Math.min(s.deadline - now, untilCold), () => { void arm($, s) })
    else {
      const delay = Math.min(s.deadline - now, untilCold, Math.max(1000, s.lastRequestAt + s.every - now))
      s.pending = $.clock.after(delay, () => { void ping($, s) })
    }
  } else {
    s.pending = $.clock.after(s.deadline - now, () => { void arm($, s) })
  }
  await publish($, s)
}

async function ping($: EngineInterface, s: State) {
  s.pending = null
  if (!s.deadline) return
  const tick = s.tick
  const now = await $.clock.now()
  // A timer set or cancelled while the clock was read (an extension, a retry, a turn) owns the window now;
  // if that left no timer, a window still open is armed again rather than left without one.
  if (s.tick !== tick) return s.pending || s.inFlight ? undefined : arm($, s)
  // One fork at a time: the one already out re-arms when it settles. Checked after the await, and set
  // below with no await in between, so two timers can never both send.
  if (s.inFlight) return
  if (now >= s.deadline) return arm($, s)
  if (isCold(s, now)) return arm($, s)
  if (s.compacted || s.waitForTurn || !s.lastRequestAt) return arm($, s)
  // A request since this timer was set moved the clock; schedule from it.
  if (now - s.lastRequestAt < s.every - 1000) return arm($, s)
  // A host that slept past a retry's slot must not send it inside the last minute.
  if (s.retries && now >= s.lastRequestAt + s.ttlMs - MIN_PING_MS) return stop($, s, s.retryReason + afterRetries(s.retries))
  const gen = s.gen
  const sentAt = s.lastRequestAt
  s.inFlight = true
  const sent = await $.model.fork({ prompt: PING_PROMPT }).then(reply => ({ reply }), (err: unknown) => ({ err }))
  const at = await $.clock.now()
  s.inFlight = false
  // Checked after the last await. A stop, /clear, resume or compaction, or a main request that moved the
  // cache clock, replaced what this fork was sent for: its reply is dropped and the window armed afresh.
  if (gen !== s.gen || s.lastRequestAt !== sentAt) return s.pending ? undefined : arm($, s)
  if ('err' in sent) return stop($, s, t('stop.failed', { message: sent.err instanceof Error ? sent.err.message : String(sent.err) }))
  const reply = sent.reply
  if (reply === null) return stop($, s, t('stop.notSent'))
  if (reply.isAnswered === false) {
    // A restarted process has no conversation to fork until its first turn; the window waits for one instead of ending.
    if (reply.reason === 'nothing-to-fork') {
      s.waitForTurn = true
      return arm($, s)
    }
    const reason = reply.reason === 'api-error' ? (reply.status === null ? t('stop.apiFailed') : t('stop.apiFailedStatus', { status: reply.status }))
      : reply.reason === 'aborted' ? t('stop.interrupted')
      : t('stop.noText')
    // A busy or failing API is usually brief; retry while a ping can still land a minute before the cache goes cold.
    if (reply.reason === 'api-error' && (reply.status === null || reply.status === 429 || reply.status >= 500)) {
      const wait = MIN_PING_MS * 2 ** s.retries
      if (s.retries < MAX_RETRIES && at + wait < Math.min(s.deadline, s.lastRequestAt + s.ttlMs - MIN_PING_MS)) {
        s.retries++
        s.retryReason = reason
        // Replaces any timer set while the fork was out, such as a window extension's, so only the retry fires.
        disarm(s)
        s.pending = $.clock.after(wait, () => { void ping($, s) })
        await publish($, s)
        return
      }
    }
    return stop($, s, reason + afterRetries(s.retries))
  }
  const u = reply.usage
  const price = priceOf(s.lastModel, u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, s.ttlMs)
  // A warm ping reads the prefix and writes only its own message; a write of a tenth of the read or more means the prefix broke.
  const warm = u.cache_read_input_tokens > 0 && u.cache_creation_input_tokens < 0.1 * u.cache_read_input_tokens
  const usd = price ? pingUsd(u, price, s.ttlMs) : null
  s.last = { at: now, read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, usd, warm }
  s.pings++
  s.pingUsd += usd ?? 0
  if (!warm) return stop($, s, t('stop.gone', { read: fmtTok(u.cache_read_input_tokens), write: fmtTok(u.cache_creation_input_tokens), usd: fmtUsd(usd) }))
  s.lastRequestAt = now
  await arm($, s)
}

function afterRetries(n: number): string {
  return n ? t(n === 1 ? 'stop.retryOne' : 'stop.retryMany', { n }) : ''
}

/** How long keepwarm holds the cache after a paid cold write: the rolling window when always is on. */
function holdMs(s: State): number {
  return s.always ? DEFAULT_WINDOW_MS : AUTO_WARM_MS
}

/** The reply to an arming command; on a cold cache it says when the first ping can come. */
export function armedText(s: State, now: number, windowMs: number): string {
  return t(isCold(s, now) ? 'arm.cold' : 'arm.warm', { window: fmtDuration(windowMs), every: fmtDuration(s.every) })
}

// A /keepwarm off after `offs` was read wins: the window it cancelled is not written back. A caller that awaited
// before deciding to open a window passes the count it read first.
export async function startWindow($: EngineInterface, s: State, windowMs: number, every: number, offs = s.offs) {
  if (s.offs !== offs) return
  const now = await $.clock.now()
  if (s.offs !== offs) return
  const deadline = now + windowMs
  s.every = every
  s.deadline = deadline
  s.stopped = null
  // Unseated, between a conversation's end and the host reporting the next, the window has no id to be written under; the seat writes it.
  if (!s.sid) return arm($, s)
  if (every === pingAfterMs(s.ttlMs)) await $.store.delete(everyKey(s))
  else await $.store.set(everyKey(s), every)
  await $.store.set(deadlineKey(s), deadline)
  if (s.offs !== offs) {
    // Remove only what this call wrote; a window armed after the off is left alone.
    if ((await $.store.get(deadlineKey(s))) === deadline) {
      await $.store.delete(deadlineKey(s))
      if (!s.deadline) await $.store.delete(everyKey(s))
    }
    return
  }
  await arm($, s)
}

export function freshState(options: { window?: number; guardOn?: boolean } = {}): State {
  return {
    window: options.window ?? DEFAULT_WINDOW_MS, guardOn: options.guardOn ?? true,
    sid: '', deadline: 0, every: PING_AFTER_MS, ttlMs: TTL_MS, ttlSeen: false, always: false, lastRequestAt: 0, lastModel: null, ctx: 0, compacted: false,
    resumedAt: 0, transcript: 0, guard: 'refuse', ackedAt: 0, coldWritePending: false, misses: [], pending: null, last: null, stopped: null,
    waitForTurn: false, retries: 0, retryReason: '', gen: 0, tick: 0, offs: 0, turnOffs: null, inFlight: false, stepWrites: null, steps: 0, endingSid: '', pings: 0, pingUsd: 0,
  }
}

type Ev<N extends keyof Events> = Parameters<Events[N]>[1]
type Nx<N extends keyof Events> = Parameters<Events[N]>[2]

export async function sessionStart(s: State, $: EngineInterface, e: Ev<'session.start'>, next: Nx<'session.start'>) {
  const r = await next(e)
  const now = await seat($, s)
  await prune($, s, now)
  const saved = await $.store.get(deadlineKey(s))
  const savedEvery = await $.store.get(everyKey(s))
  const savedGuard = await $.store.get(KEY_GUARD)
  s.deadline = typeof saved === 'number' && saved > now ? saved : 0
  s.every = typeof savedEvery === 'number' && savedEvery >= MIN_PING_MS && savedEvery < s.ttlMs ? savedEvery : pingAfterMs(s.ttlMs)
  s.guard = savedGuard === 'warn' ? 'warn' : 'refuse'
  s.always = (await $.store.get(KEY_ALWAYS)) === true
  // Always means a fresh default window every session, whatever the last one left behind.
  if (s.always) await startWindow($, s, DEFAULT_WINDOW_MS, pingAfterMs(s.ttlMs))
  // The classic start arms a restored window too, but a managed plugin above this tier may continue beneath it; arming twice leaves one timer.
  else if (s.deadline) await arm($, s)
  await publish($, s)
  return r
}

// On Team and Enterprise accounts a managed plugin seated above this tier handles classic.* and continues beneath it, so
// nothing here is relied on alone: session.end carries the /clear, turn.step the compaction, and the engine's own figures
// the resumed context. What arrives here refines that, once: a clear already ended is only seated, a seat is never redone.
export async function sessionEnd(s: State, $: EngineInterface, e: Ev<'session.end'>, next: Nx<'session.end'>) {
  // Only the conversation this state sits in: after the classic start of the next one, the old id is history.
  if ((e.reason === 'clear' || e.reason === 'resume') && e.sessionId === s.sid) await endConversation($, s, e.reason)
  return next(e)
}

// Resume fields seed the guard before any turn of the resumed session has run.
export async function classicStart(s: State, $: EngineInterface, e: Ev<'classic.SessionStart'>, next: Nx<'classic.SessionStart'>) {
  const r = await next(e)
  // A resumed or cleared conversation is not the one a ping in flight was sent for.
  outdate(s)
  // The conversation moved under this state without session.end reaching it: the payload names another id, or a
  // clear names none. One that already seated the new id (a command ran first) is left as it is.
  if (s.sid && (e.session_id === undefined ? e.source === 'clear' : e.session_id !== s.sid)) await endConversation($, s, e.source === 'clear' ? 'clear' : 'resume')
  // No session.start fires after /clear, so this is where always arms the new conversation.
  await reseat($, s)
  if (e.source === 'clear') return r
  const line = seedFromResume(s, e, await $.clock.now())
  if (line) $.ui.log(line)
  // The seeded clock decides whether a restored or always window pings before the first turn: never when it is cold.
  await arm($, s)
  return r
}

// The message that pays. Only its first character is read.
export async function promptSubmit(s: State, $: EngineInterface, e: Ev<'prompt.submit'>, next: Nx<'prompt.submit'>) {
  if (e.origin.kind === 'plugin') return next(e)
  await reseat($, s)
  if (typeof e.text !== 'string' || e.text.trimStart().startsWith('/')) return next(e)
  const now = await $.clock.now()
  // Without the time of the last response nothing says whether the cache is cold: the price is shown once and the message goes through.
  if (s.resumedAt) {
    const cold = mayBeCold(s, now)
    s.resumedAt = 0
    if (cold && s.ctx >= BIG_TOKENS) $.ui.log(unknownText(s))
    return next(e)
  }
  if (!s.guardOn || !isCold(s, now) || s.ctx < BIG_TOKENS) return next(e)
  // A refused prompt that no person sent would be lost: nobody is there to send it again.
  const unattended = UNATTENDED.has(e.origin.kind)
  if (s.guard === 'warn' || unattended) {
    $.ui.log(t('guard.sendAnyway', {
      text: guardText(s, now),
      why: unattended ? t('guard.unattended', { origin: e.origin.kind }) : '',
      hold: fmtDuration(holdMs(s)),
    }))
    s.coldWritePending = true
    return next(e)
  }
  if (s.ackedAt === s.lastRequestAt) {
    s.ackedAt = 0
    s.coldWritePending = true
    return next(e)
  }
  s.ackedAt = s.lastRequestAt
  return { drop: t('guard.drop', { text: guardText(s, now), hold: fmtDuration(holdMs(s)) }) }
}

export async function* turnStep(s: State, $: EngineInterface, e: Ev<'turn.step'>, next: Nx<'turn.step'>) {
  if (!e.agentId) {
    await reseat($, s)
    // The off count when the turn's first request went out: an off after it wins over what the turn opens.
    if (e.index === 0) s.turnOffs = s.offs
    // A compaction leaves a summary where tens of messages were; a rewind takes a few off. A request over fewer than half the
    // last one's messages is read as a compaction, whether or not session.compact arrived. The context stays as it was, so
    // turn.complete still scores a cold write this turn paid against it before the live figure replaces it.
    if (e.messageCount * 2 < s.transcript) markCompacted(s)
    s.transcript = e.messageCount
    // Only a request sent before any compaction this turn saw can hold a cold write; what follows one is the summary.
    if (!s.compacted) s.steps++
    s.lastRequestAt = await $.clock.now()
  }
  const r = yield* next(e)
  // Each request's write is priced at its own prompt length's tier (Haiku 5.5 changes price at 100k), not the turn's sum.
  const u = r.usage
  if (!e.agentId && u && !s.compacted) {
    const price = priceOf(u.model || e.model, u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, s.ttlMs)
    const was = s.stepWrites ?? { tokens: 0, usd: 0, priced: true }
    s.stepWrites = { tokens: was.tokens + u.cache_creation_input_tokens, usd: was.usd + (price ? u.cache_creation_input_tokens * price[1] / 1e6 : 0), priced: was.priced && price != null }
  }
  return r
}

export async function turnComplete(s: State, $: EngineInterface, e: Ev<'turn.complete'>, next: Nx<'turn.complete'>) {
  const r = await next(e)
  if (e.agentId) return r
  // An off at any point in this turn wins over every window the turn would open; a host that raised no
  // step falls back to the count at completion.
  const offs = s.turnOffs ?? s.offs
  s.turnOffs = null
  const now = await $.clock.now()
  // A sleeping host may deliver this turn before the expired window's timer.
  if (s.deadline && now >= s.deadline) await stop($, s, null)
  // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
  // A turn aborted before it sent anything touched no cache, so it leaves the clock alone.
  if ((e.usage || !e.isAborted) && now - s.lastRequestAt > e.durationMs) s.lastRequestAt = now
  const compacted = s.compacted
  s.compacted = false
  if (s.lastRequestAt) s.resumedAt = 0
  s.waitForTurn = false
  s.ackedAt = 0
  // Always covers any break up to six hours after a turn that reached the cache (a turn that failed before any
  // response touched nothing, and its cache may be cold): a window of at least six hours at the default period,
  // which brings back a stopped window and replaces a shorter one or a testing period. Another session's
  // /keepwarm off or /keepwarm always changes the shared switch, so every such turn reads it.
  if (e.usage) {
    const shared = (await $.store.get(KEY_ALWAYS)) === true
    if (s.offs === offs) s.always = shared
    if (s.always) await startWindow($, s, Math.max(DEFAULT_WINDOW_MS, s.deadline - now), pingAfterMs(s.ttlMs), offs)
  }
  const u = e.usage
  if (u) {
    if (u.model) s.lastModel = u.model
    const prev = s.ctx
    // A turn's usage is its responses summed, so a ten-step turn reports ten
    // reads of the context. The live window is the engine's figure; the sum
    // is only the fallback for a host that reports no tokens.
    const written = u.cache_creation_input_tokens
    const live = (await $.session.usage()).context.tokens
    s.ctx = live && live > 0 ? live : u.input_tokens + u.cache_read_input_tokens + written
    // A compaction since the last complete turn: what followed it is the summary, no cold write, so the turn is scored
    // on the requests before it alone. None before it leaves nothing to score, whatever the guard saw; requests before
    // it that reported no usage leave only the turn's total, an upper bound kept for a send the guard saw go cold.
    const writes = s.stepWrites
    const write = !compacted ? written : writes ? writes.tokens : s.steps && s.coldWritePending ? written : 0
    const full = prev > 20000 && write >= 0.5 * prev
    if (full || (s.coldWritePending && write > 0)) {
      // Priced per request when the steps reported usage; otherwise at the tier of the context the comeback re-sent.
      const price = priceOf(s.lastModel, prev || s.ctx, s.ttlMs)
      const usd = writes?.priced ? writes.usd : price ? write * price[1] / 1e6 : null
      s.misses.push({ at: now, tokens: write, usd })
      const extend = s.deadline < now + AUTO_WARM_MS && s.offs === offs
      if (extend) await startWindow($, s, AUTO_WARM_MS, s.every, offs)
      $.ui.log(t('log.coldWrite', {
        tokens: fmtTok(write),
        usd: fmtUsd(usd),
        extend: extend ? t('log.coldWriteExtend', { hold: fmtDuration(AUTO_WARM_MS) }) : '',
      }))
    }
  }
  s.coldWritePending = false
  s.stepWrites = null
  s.steps = 0
  await arm($, s)
  return r
}

export async function sessionCompact(s: State, $: EngineInterface, e: Ev<'session.compact'>, next: Nx<'session.compact'>) {
  const r = await next(e)
  if (!e.agentId) {
    markCompacted(s)
    // Between turns nothing is left to score, and the next turn's summary write is not a cold write.
    s.ctx = 0
    disarm(s)
    await arm($, s)
  }
  return r
}
