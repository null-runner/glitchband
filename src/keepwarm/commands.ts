import type { EngineInterface, Events } from 'claude-code'

import { TTL_MS } from '../cache/cache'
import { fmtInt, t } from '../i18n'
import {
  DEFAULT_WINDOW_MS, KEY_ALWAYS, KEY_GUARD, MIN_PING_MS, PING_AFTER_MS, armedText, breakEvenPings, coldUsd, fmtDuration, fmtUsd,
  isCold, leftText, mayBeCold, parseDuration, reseat, startWindow, statusText, stop, warmUsd,
} from './engine'
import type { State } from './engine'

type RunEvent = Parameters<Events['command.run']>[1]

/** Another plugin's command that also guards a cold send; both installed means two guards. */
const OTHER_GUARD_COMMAND = 'cache-tax:status'

const wordsOf = (e: RunEvent): string[] => String(e.args ?? '').trim().split(/\s+/).filter(Boolean)

/** Registers /keepwarm and /glitchband, and says so when another cache guard is installed beside them. */
export async function registerCommands($: EngineInterface, s: State): Promise<void> {
  await $.command.register({
    name: 'keepwarm',
    description: t('cmd.keepwarm.description', { window: fmtDuration(s.window) }),
    argumentHint: '[6h | always | off | status]',
    immediate: true,
  })
  await $.command.register({
    name: 'glitchband',
    description: t('cmd.glitchband.description'),
    argumentHint: '[status | guard warn | guard refuse]',
    immediate: true,
  })
  const commands = await $.command.list()
  if (commands.some(c => c.name === OTHER_GUARD_COMMAND)) $.ui.log(t('log.otherGuard', { other: `/${OTHER_GUARD_COMMAND}` }))
}

export async function keepwarmCommand(s: State, $: EngineInterface, e: RunEvent) {
  await reseat($, s)
  const words = wordsOf(e)
  const now = await $.clock.now()
  if (words[0] === 'off') {
    const wasAlways = s.always
    await stop($, s, null, true)
    return { text: t(wasAlways ? 'cmd.keepwarm.offAlways' : 'cmd.keepwarm.off') }
  }
  if (words[0] === 'always') {
    s.always = true
    await $.store.set(KEY_ALWAYS, true)
    await startWindow($, s, DEFAULT_WINDOW_MS, PING_AFTER_MS)
    const cold = isCold(s, now) ? t('cmd.keepwarm.coldSuffix', { every: fmtDuration(s.every) }) : ''
    return { text: t('cmd.keepwarm.always', { hold: fmtDuration(DEFAULT_WINDOW_MS), cold }) }
  }
  if (!words.length) {
    await startWindow($, s, s.window, PING_AFTER_MS)
    return { text: armedText(s, now, s.window) }
  }
  if (words[0] !== 'status') {
    const window = parseDuration(words[0] ?? '')
    if (!window) return { text: t('cmd.keepwarm.usage') }
    // "every 2m" is a testing knob and lasts only for the window it was given with.
    let every = PING_AFTER_MS
    if (words[1] === 'every') {
      const period = parseDuration(words[2] ?? '')
      // A period of the cache's whole hour or more would fire only once the cache is already cold.
      if (period == null || period < MIN_PING_MS || period >= TTL_MS) return { text: t('cmd.keepwarm.everyRange') }
      every = period
    }
    await startWindow($, s, window, every)
    const rolls = s.always && (window < DEFAULT_WINDOW_MS || every !== PING_AFTER_MS)
    return { text: armedText(s, now, window) + (rolls ? t('cmd.keepwarm.rolls', { hold: fmtDuration(DEFAULT_WINDOW_MS), every: fmtDuration(PING_AFTER_MS) }) : '') }
  }
  return { text: statusText(s, now) ?? t('cmd.keepwarm.off') }
}

/** The cache estimate, the keepwarm window and this session's cold writes, one line each. */
function card(s: State, now: number): string {
  const lines: string[] = []
  lines.push(s.lastModel ?? t('cmd.noModel'))
  if (s.compacted) lines.push(t('cmd.state.compacted'))
  else if (s.resumedAt) lines.push(mayBeCold(s, now) ? t('cmd.state.unknown') : t('cmd.state.resumed', { time: fmtDuration(s.resumedAt + TTL_MS - now) }))
  else if (!s.lastRequestAt) lines.push(t('cmd.state.none'))
  else if (isCold(s, now)) lines.push(t('cmd.state.cold', { ago: fmtDuration(now - s.lastRequestAt) }))
  else lines.push(t('cmd.state.warm', { time: fmtDuration(s.lastRequestAt + TTL_MS - now) }))
  lines.push(t('cmd.context', { tokens: fmtInt(s.ctx) }))
  lines.push(t('cmd.coldCost', { cold: fmtUsd(coldUsd(s)), warm: fmtUsd(warmUsd(s)) }))
  const always = s.always ? t('cmd.always') : ''
  lines.push(
    s.deadline ? t('cmd.keepwarm.on', { body: leftText(s, now), always })
      : s.stopped ? t('cmd.keepwarm.stopped', { why: s.stopped, always })
      : s.always ? t('cmd.keepwarm.idleAlways', { window: fmtDuration(DEFAULT_WINDOW_MS) })
      : t('cmd.keepwarm.idle', { window: fmtDuration(s.window) }),
  )
  const pings = breakEvenPings(s)
  if (pings != null) lines.push(t('cmd.breakEven', { n: pings, time: fmtDuration(pings * s.every), every: fmtDuration(s.every) }))
  lines.push(t(!s.guardOn ? 'cmd.guard.offLine' : s.guard === 'refuse' ? 'cmd.guard.refuseLine' : 'cmd.guard.warnLine'))
  const paid = s.misses.reduce((a, m) => a + (m.usd ?? 0), 0)
  lines.push(t(s.misses.length === 1 ? 'cmd.session.one' : 'cmd.session.many', { n: s.misses.length, usd: fmtUsd(paid) }))
  return lines.join('\n')
}

export async function glitchbandCommand(s: State, $: EngineInterface, e: RunEvent) {
  await reseat($, s)
  const words = wordsOf(e)
  const now = await $.clock.now()
  if (words[0] === 'guard') {
    if (words[1] !== 'warn' && words[1] !== 'refuse') return { text: t('cmd.guard.usage') }
    s.guard = words[1]
    await $.store.set(KEY_GUARD, s.guard)
    return { text: t(!s.guardOn ? 'cmd.guard.disabled' : s.guard === 'refuse' ? 'cmd.guard.refuse' : 'cmd.guard.warn') }
  }
  return { text: card(s, now) }
}
