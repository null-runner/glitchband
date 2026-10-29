import type { EngineInterface } from 'claude-code'

import { en } from './en'
import type { Key } from './en'
import { it } from './it'

export type Lang = 'en' | 'it'
export type { Key }
type Params = Readonly<Record<string, string | number>>

const DICTIONARIES: Record<Lang, Record<Key, string>> = { en, it }

// Module scope is fine: register sets it again on every (re)load, and session.start resolves `auto`.
let lang: Lang = 'en'

export const setLanguage = (next: Lang): void => {
  lang = next
}

export const t = (key: Key, params: Params = {}): string =>
  DICTIONARIES[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))

/** An integer with this language's thousands separator. */
export const fmtInt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, t('number.group'))

const langOf = (v: unknown): Lang => (typeof v === 'string' && /^(it|ital)/i.test(v.trim()) ? 'it' : 'en')

/** The `language` option: en or it as given; auto follows Claude Code's `language` setting, then the system locale, then English. */
export async function resolveLanguage($: EngineInterface, option: string): Promise<Lang> {
  if (option === 'en' || option === 'it') return option
  try {
    const settings = (await $.settings.read()) as Record<string, unknown>
    if (typeof settings.language === 'string' && settings.language.trim()) return langOf(settings.language)
    const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
    return langOf(locale)
  } catch {
    return 'en'
  }
}

/** Whole minutes the way the band writes them: 18m, 2h 5m, 3d 9h. */
export const fmtMinutes = (mins: number): string => {
  const [m, h, d] = [t('unit.m'), t('unit.h'), t('unit.d')]
  if (mins < 60) return `${mins}${m}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}${h} ${mins % 60}${m}`
  return `${Math.floor(hours / 24)}${d} ${hours % 24}${h}`
}
