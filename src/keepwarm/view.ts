import type { KeepwarmFacts } from '../../types'
import { t } from '../i18n'
import type { KeepwarmCard } from '../ui/card'
import { fmtUsd } from './engine'

export type Tone = 'on' | 'off' | 'stopped'

const DAY_MS = 24 * 60 * 60 * 1000

const pad = (n: number): string => String(n).padStart(2, '0')

/** The time a window ends, with the day when it is a day or more away. */
const until = (ms: number, now: number): string => {
  const d = new Date(ms)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return ms - now >= DAY_MS ? `${d.getDate()}/${d.getMonth() + 1} ${hm}` : hm
}

/** Whether keepwarm is armed: a window is open, or always will open one with the next turn. */
export const isArmed = (f: Pick<KeepwarmFacts, 'always' | 'deadline'> | null, now: number): boolean => f !== null && (f.always || f.deadline > now)

/** What the band says beside KEEPWARM, in full and in the short form of a narrow band or the terminal. */
export const kwValue = (f: KeepwarmFacts | null, now: number): { text: string; short: string; tone: Tone } => {
  if (f && f.always) return { text: t('kw.always'), short: t('kw.always'), tone: 'on' }
  if (f && f.deadline > now) {
    const time = until(f.deadline, now)
    return { text: t('kw.until', { time }), short: time, tone: 'on' }
  }
  if (f && f.stopped) return { text: t('kw.stopped'), short: t('kw.stopped'), tone: 'stopped' }
  return { text: t('kw.valueOff'), short: t('kw.valueOff'), tone: 'off' }
}

/** The card's keepwarm strip: state, why it stopped, pings sent and their estimated cost, cold writes paid. */
export const kwCard = (f: KeepwarmFacts | null, now: number): KeepwarmCard => {
  const v = kwValue(f, now)
  return {
    state: v.text,
    note: v.tone === 'stopped' ? (f?.stopped ?? '') : '',
    pings: `${f?.pings ?? 0} · ~${fmtUsd(f?.pingUsd ?? 0)}`,
    cold: `${f?.coldWrites ?? 0} · ${fmtUsd(f?.coldUsd ?? 0)}`,
  }
}
