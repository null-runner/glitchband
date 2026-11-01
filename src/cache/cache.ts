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

// $ per million tokens: input, and the cache read. The cache write is 2 times input
// for 1 hour and 1.25 times for 5 minutes. Haiku 5.5 is $0.10 up to 100K tokens and $0.50 above; long sessions use the
// higher rate.
export type Model = { id: string; NAME: string; input: number; read: number }
export const MODELS: Model[] = [
  { id: 'fable', NAME: 'FABLE', input: 10, read: 0.25 },
  { id: 'opus', NAME: 'OPUS', input: 4, read: 0.2 },
  { id: 'sonnet', NAME: 'SONNET', input: 2, read: 0.2 },
  { id: 'haiku', NAME: 'HAIKU', input: 0.5, read: 0.05 },
]

/** Which row of MODELS a model id belongs to, or null for one the card doesn't price. */
export const familyOf = (model: string | null | undefined): string | null => {
  const m = (model ?? '').toLowerCase()
  return MODELS.find(x => m.includes(x.id))?.id ?? null
}

export const coldCost = (m: Model, tokens: number, ttlMs = TTL_MS): number => (tokens / 1e6) * m.input * writeMultiple(ttlMs)
export const warmCost = (m: Model, tokens: number): number => (tokens / 1e6) * m.read
export const costOf = (m: Model, mode: Mode, tokens: number, ttlMs = TTL_MS): number => (mode === 'cold' ? coldCost(m, tokens, ttlMs) : warmCost(m, tokens))
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
