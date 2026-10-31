import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Window } from '../../types'
import { fmtMinutes, t } from '../i18n'
import { TEXT, WINDOW_COLORS } from '../ui/theme'

const windows = atom({ plugin: 'glitchband', key: 'windows' } as const, [] as Window[])

const NAME_KEYS = { seven_day: 'window.sevenDay', five_hour: 'window.fiveHour', spend_limit: 'window.spend' } as const
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }

/** Windows in the order the band draws them: 7-day first, then 5-hour. */
export const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

/** `left` percent as lit and unlit dots out of `cells`. */
export const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

/** Time to a reset the way the band writes it: 18m, 2h 5m, 3d 9h; empty when unknown. */
export const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return t('band.resetting')
  return fmtMinutes(Math.round(ms / 60000))
}

/** A kind the band has no name for, made readable: seven_day_fable → 7D FABLE. */
const nameOf = (kind: string): string =>
  kind.replace(/^seven_day/, t('window.sevenDay')).replace(/^five_hour/, t('window.fiveHour')).replace(/_/g, ' ').trim().toUpperCase()

/** What the band draws for one window. */
export const windowParts = (w: Window, cells: number, now: number) => {
  const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
  const nameKey = NAME_KEYS[w.kind as keyof typeof NAME_KEYS]
  return {
    left,
    col: WINDOW_COLORS[w.kind] ?? TEXT,
    name: nameKey ? t(nameKey) : nameOf(w.kind),
    d: dots(left, cells),
    reset: fmtReset(w.resetsAt, now),
  }
}

export async function readWindows($: EngineInterface): Promise<Window[]> {
  return read($, windows)
}

export async function setWindows($: EngineInterface, list: readonly Window[]): Promise<void> {
  await update($, windows, () => clean(list))
}

export async function pull($: EngineInterface): Promise<void> {
  await setWindows($, (await $.session.usage()).rateLimits)
}
