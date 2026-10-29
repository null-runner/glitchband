import type { PluginOptions } from 'claude-code'

import { parseDuration } from './keepwarm/engine'
import { DEFAULT_CARD_SCALE, DEFAULT_COMPACT_BELOW } from './ui/theme'

export type Options = {
  language: 'auto' | 'en' | 'it'
  compactBelow: number
  cardScale: number
  /** The window the button and a bare /keepwarm arm, as written ("6h") and in milliseconds. */
  keepwarmWindow: { text: string; ms: number }
  coldGuard: boolean
}

const COMPACT_RANGE = [40, 400] as const
const SCALE_RANGE = [0.5, 3] as const
const WINDOW_RANGE_MS = [60_000, 48 * 60 * 60_000] as const
const DEFAULT_WINDOW = '6h'

const inRange = (v: unknown, [min, max]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

const windowOf = (v: unknown): Options['keepwarmWindow'] => {
  const text = typeof v === 'string' ? v.trim().toLowerCase() : ''
  const ms = parseDuration(text)
  return ms !== null && inRange(ms, WINDOW_RANGE_MS) ? { text, ms } : { text: DEFAULT_WINDOW, ms: parseDuration(DEFAULT_WINDOW) ?? 0 }
}

/** The plugin's options with each value checked; one outside its range or of the wrong type falls back to its default. */
export const readOptions = (raw: PluginOptions): Options => ({
  language: raw.language === 'en' || raw.language === 'it' ? raw.language : 'auto',
  compactBelow: inRange(raw.compactBelow, COMPACT_RANGE) ? raw.compactBelow : DEFAULT_COMPACT_BELOW,
  cardScale: inRange(raw.cardScale, SCALE_RANGE) ? raw.cardScale : DEFAULT_CARD_SCALE,
  keepwarmWindow: windowOf(raw.keepwarmWindow),
  coldGuard: raw.coldGuard !== false,
})
