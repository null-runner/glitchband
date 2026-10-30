/** One usage window: which one, how much is used (0 to 100), when it resets. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** How long the prompt cache lives after a request: read from the chat's transcript. */
export type Ttl = '1h' | '5m'

/**
 * The prompt cache as the band last saw it: when the main thread last sent a
 * request (clock milliseconds), how much context the next request re-sends,
 * the model's context window, the model, and its lifetime once the transcript has said (absent: 1 hour).
 */
export type CacheFacts = { lastAt: number; tokens: number; window: number; model: string | null; ttl?: Ttl }

/** Whether the cache card is open, remembered only for the state it was set in. */
export type Fold = { mode: 'warm' | 'cold'; open: boolean }

/** What a keepwarm ping read back: tokens read and written, its estimated cost, and whether the cache was warm. */
export type Ping = { at: number; read: number; write: number; usd: number | null; warm: boolean }

/**
 * Keepwarm as the band reads it. Times are clock milliseconds. The window and
 * the always switch persist in $.store; the tallies live in memory for the
 * conversation.
 */
export type KeepwarmFacts = {
  /** When the open window ends; 0 when none is open. */
  deadline: number
  /** The ping period in milliseconds (50 minutes for a 1-hour cache, shortly before expiry for a 5-minute one, unless /keepwarm ... every was used). */
  every: number
  always: boolean
  /** How long the cache lives in milliseconds; absent means the 1 hour default. */
  ttlMs?: number
  /** When the main thread last sent a request; 0 before the first one. */
  lastRequestAt: number
  compacted: boolean
  waitForTurn: boolean
  /** Retries of the ping in flight (a busy API), 0 when none. */
  retries: number
  /** Why the window was stopped, or null. */
  stopped: string | null
  last: Ping | null
  /** Pings answered this conversation, and what they are estimated to have cost. */
  pings: number
  pingUsd: number
  /** Cold cache writes paid this conversation, and what they are estimated to have cost. */
  coldWrites: number
  coldUsd: number
}

declare module 'claude-code' {
  interface PluginState {
    glitchband: { windows: Window[]; cache: CacheFacts | null; fold: Fold | null; keepwarm: KeepwarmFacts | null }
  }
}
