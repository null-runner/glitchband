import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CacheFacts, Fold, Ttl } from '../../types'
import { fmtMinutes } from '../i18n'
import type { Mode } from '../ui/theme'

const cache = atom({ plugin: 'glitchband', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'glitchband', key: 'fold' } as const, null as Fold | null)

/** The prompt cache lives an hour after the last request that read or wrote it. */
export const TTL_MIN = 60
export const TTL_MS = TTL_MIN * 60 * 1000
const TTL_5M_MS = 5 * 60 * 1000

/** The cache's lifetime in milliseconds; 1 hour until the transcript says otherwise. */
export const ttlMsOf = (ttl: Ttl | null | undefined): number => (ttl === '5m' ? TTL_5M_MS : TTL_MS)

/** What a cache write costs as a multiple of input: 2 for the 1-hour cache, 1.25 for the 5-minute one. */
export const writeMultiple = (ttlMs: number): number => (ttlMs < TTL_MS ? 1.25 : 2)

// $ per million tokens, [cache read, 1h cache write, output], list prices October 2026: the one table the band, the guard,
// /glitchband and the ping receipts all read. A 5-minute write is cheaper than the table's 1-hour column and is scaled in priceOf.
// More specific families first: a model id takes the first row it matches.
const LONG_PROMPT_TOKENS = 100000
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

// The table's write column is the 1-hour rate; a 5-minute write is cheaper, so its column is scaled to 1.25x input.
export function priceOf(model: string | null, promptTokens: number, ttlMs = TTL_MS): [number, number, number] | null {
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

// The card's four comparison rows. `rep` is the model that prices a row when the session's own model is not that row.
export type Model = { id: string; NAME: string; rep: string }
export const MODELS: Model[] = [
  { id: 'fable', NAME: 'FABLE', rep: 'fable-5-1' },
  { id: 'opus', NAME: 'OPUS', rep: 'opus-5-5' },
  { id: 'sonnet', NAME: 'SONNET', rep: 'sonnet-5-5' },
  { id: 'haiku', NAME: 'HAIKU', rep: 'haiku-5-5' },
]

/** Which row of MODELS a model id belongs to, or null for one the card doesn't price. */
export const familyOf = (model: string | null | undefined): string | null => {
  const m = (model ?? '').toLowerCase()
  return MODELS.find(x => m.includes(x.id))?.id ?? null
}

/** The row's price for this prompt: the session's own model when it is the row's, the row's representative otherwise. */
const rowPrice = (m: Model, tokens: number, ttlMs: number, model?: string | null): [number, number, number] =>
  (model ? priceOf(model, tokens, ttlMs) : null) ?? priceOf(m.rep, tokens, ttlMs)!

export const coldCost = (m: Model, tokens: number, ttlMs = TTL_MS, model?: string | null): number => (tokens * rowPrice(m, tokens, ttlMs, model)[1]) / 1e6
export const warmCost = (m: Model, tokens: number, ttlMs = TTL_MS, model?: string | null): number => (tokens * rowPrice(m, tokens, ttlMs, model)[0]) / 1e6
export const costOf = (m: Model, mode: Mode, tokens: number, ttlMs = TTL_MS, model?: string | null): number => (mode === 'cold' ? coldCost(m, tokens, ttlMs, model) : warmCost(m, tokens, ttlMs, model))
export const usd = (n: number): string => '$' + n.toFixed(2)
export const tok = (n: number): string => (n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : `${Math.round(n / 1000)}k`)

/** Idle time the way the card writes it: 18m, 2h 5m, 3d 9h. */
export const fmtIdle = (ms: number): string => fmtMinutes(Math.max(0, Math.floor(ms / 60000)))

/** What every drawing of the cache reads. */
export type CacheView = {
  mode: Mode
  /** How long since the last request, written out: 3d 9h, 18m. */
  idle: string
  /** The same in whole minutes, for the warm countdown. */
  idleMin: number
  /** How long the cache lives, in minutes: 60 or 5. */
  ttlMin: number
  /** Context the next request re-sends. */
  tokens: number
  /** The model's context window. */
  window: number
  /** This session's MODELS id, or null when the model isn't priced. */
  mine: string | null
  /** The session's own model id, which prices its row. */
  model?: string | null
}

export const mineModel = (v: CacheView): Model | undefined => MODELS.find(m => m.id === v.mine)

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  const ttlMs = ttlMsOf(c.ttl)
  return {
    mode: idleMs >= ttlMs ? 'cold' : 'warm',
    idle: fmtIdle(idleMs),
    idleMin: Math.floor(idleMs / 60000),
    ttlMin: ttlMs / 60000,
    tokens: c.tokens,
    window: c.window,
    mine: familyOf(c.model),
    model: c.model,
  }
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
export async function measure($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    ...c,
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

export async function readCache($: EngineInterface): Promise<CacheFacts | null> {
  return read($, cache)
}

export async function readFold($: EngineInterface): Promise<Fold | null> {
  return read($, fold)
}

/** The fold button: opens or folds the card, remembered for this mode only. */
export async function toggleFold($: EngineInterface, mode: Mode): Promise<void> {
  await update($, fold, f => ({ mode, open: !(f && f.mode === mode ? f.open : mode === 'cold') }))
}

/** A resumed or forked session knows how long it was away and how big it is. */
export async function seedCache($: EngineInterface, lastAt: number, tokens: number, window: number, model: string | null): Promise<void> {
  await update($, cache, c => ({ ...c, lastAt, tokens, window, model }))
}

/** The lifetime the transcript showed. With no request yet, lastAt 0 keeps the band empty. */
export async function setTtl($: EngineInterface, ttl: Ttl): Promise<void> {
  await update($, cache, c => ({ lastAt: 0, tokens: 0, window: 0, model: null, ...c, ttl }))
}

/** A cleared or compacted conversation has no cache to show until its next reply; the lifetime it was seen with stays. */
export async function clearCache($: EngineInterface): Promise<void> {
  await update($, cache, c => (c?.ttl ? { lastAt: 0, tokens: 0, window: 0, model: null, ttl: c.ttl } : null))
  await update($, fold, () => null)
}

/** The engine reports a new context size. */
export async function setContext($: EngineInterface, tokens: number, window: number): Promise<void> {
  await update($, cache, c => (c ? { ...c, tokens, window: window || c.window } : c))
}

/** Each main-thread request reads or writes the cache, so its start resets the hour. */
export async function stampRequest($: EngineInterface, now: number): Promise<void> {
  await update($, cache, c => ({ ...c, lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
}

/** A main-thread turn ended: take the engine's context figures. */
export async function finishTurn($: EngineInterface, durationMs: number, model: string | null): Promise<void> {
  const now = await $.clock.now()
  const c = await read($, cache)
  // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
  const lastAt = !c || now - c.lastAt > durationMs ? now : c.lastAt
  await measure($, lastAt, model)
}
