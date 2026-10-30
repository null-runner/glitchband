import type { Register } from 'claude-code'

import { clearCache, finishTurn, seedCache, setContext, stampRequest } from '../src/cache/cache'
import { resolveLanguage, setLanguage } from '../src/i18n'
import { glitchbandCommand, keepwarmCommand, registerCommands } from '../src/keepwarm/commands'
import {
  classicStart, freshState, promptSubmit, sessionCompact, sessionEnd, sessionStart, turnComplete, turnStep,
} from '../src/keepwarm/engine'
import { readOptions } from '../src/options'
import { renderBand } from '../src/ui/band'
import { TICK_MS } from '../src/ui/theme'
import { pull, setWindows } from '../src/usage/usage'

export const register: Register = (on, raw) => {
  const options = readOptions(raw)
  const kwState = freshState({ window: options.keepwarmWindow.ms, guardOn: options.coldGuard })
  // An explicit language holds from the first draw; auto is resolved once the session starts.
  setLanguage(options.language === 'auto' ? 'en' : options.language)

  on('session.start', async ($, e, next) => {
    setLanguage(await resolveLanguage($, options.language))
    await pull($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    const r = await sessionStart(kwState, $, e, next)
    await registerCommands($, kwState)
    return r
  })

  on('session.end', ($, e, next) => sessionEnd(kwState, $, e, next))
  on('command.run', { command: 'keepwarm' }, ($, e) => keepwarmCommand(kwState, $, e))
  on('command.run', { command: 'glitchband' }, ($, e) => glitchbandCommand(kwState, $, e))
  on('prompt.submit', ($, e, next) => promptSubmit(kwState, $, e, next))
  on('session.compact', ($, e, next) => sessionCompact(kwState, $, e, next))

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await setWindows($, e.rateLimits)
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) await setContext($, e.context.tokens, e.context.window)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const r = await classicStart(kwState, $, e, next)
    if (e.source === 'clear' || e.source === 'compact') {
      await clearCache($)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await seedCache($, now - e.seconds_since_last_response * 1000, tokens, window, model)
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await stampRequest($, await $.clock.now())
    return yield* turnStep(kwState, $, e, next)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await turnComplete(kwState, $, e, next)
    if (!e.agentId) await finishTurn($, e.durationMs, e.usage?.model ?? null)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Other mods' bands draw beneath this one. Claude Code's own placeholder ({ type: 'engine' }) is never
    // nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const band = await renderBand($, e, next, kwState, options)
    if (!below) return band
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {band}
        {below}
      </Box>
    )
  })
}
