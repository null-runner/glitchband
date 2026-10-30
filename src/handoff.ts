import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { HandoffPhase } from '../types'
import { t } from './i18n'

const phase = atom({ plugin: 'glitchband', key: 'handoff' } as const, 'idle' as HandoffPhase)

export async function readHandoff($: EngineInterface): Promise<HandoffPhase> {
  return read($, phase)
}

// Sent to the model as the one message over the session's own transcript; the model writes it in the chat's language.
const PROMPT = [
  "Write a handoff so a fresh chat can continue this work with no other context. Write it in the language this conversation uses.",
  'Markdown only, titled `# Handoff: <topic>`, with these sections: goal, decisions taken, current state, files and paths touched, open tasks and the next step, pending questions, things not to redo.',
  'Be specific (exact paths, names, commands, values). Do not call tools. Reply with the handoff alone.',
].join('\n')

const pad = (n: number): string => String(n).padStart(2, '0')

/** `<home>/.claude/handoffs/<YYYY-MM-DD-HHmm>-<session id, 8 characters>.md`, in local time. */
const pathOf = (home: string, at: number, sessionId: string): string => {
  const d = new Date(at)
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `${home.replace(/\/$/, '')}/.claude/handoffs/${stamp}-${sessionId.slice(0, 8)}.md`
}

const whyOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The reply's text, or why there is none. */
async function write($: EngineInterface): Promise<string> {
  const r = await $.model.fork({ prompt: PROMPT })
  if (r?.isAnswered && r.text.trim()) return r.text.trim()
  if (r && !r.isAnswered) throw new Error(r.reason === 'nothing-to-fork' ? t('handoff.nothing') : `${r.reason}${'error' in r && r.error ? ` (${String(r.error)})` : ''}`)
  throw new Error('empty-reply')
}

/**
 * The press of Refresh: the model writes the handoff, it is saved first so it is never lost, then the chat is cleared
 * and the handoff sent as the first message of the new one. If the chat cannot be cleared or sent to, the handoff is put
 * in the prompt for the person to send. A failure before the clear leaves the chat as it is. A press while one runs does nothing.
 */
export async function runHandoff($: EngineInterface): Promise<void> {
  let busy = false
  await update($, phase, p => {
    busy = p === 'writing'
    return 'writing'
  })
  if (busy) return

  let path: string | null = null
  try {
    const text = await write($)
    const home = await $.env.get('HOME')
    if (!home) throw new Error(t('handoff.noHome'))
    const target = pathOf(home, await $.clock.now(), await $.session.id())
    await $.fs.write(target, text)
    path = target
    const message = `${t('handoff.intro', { path: target })}\n\n${text}`
    const toFill = async () => {
      await $.prompt.fill({ text: message })
      $.ui.toast(t('handoff.filled', { path: target }))
    }
    let cleared = true
    await $.command.run({ command: 'clear' }).catch(() => { cleared = false })
    if (cleared) {
      // Not awaited: the new chat's first turn would hold the button until it ends.
      $.prompt.submit({ text: message, asUser: true }).catch(toFill).catch(() => {})
      $.ui.toast(t('handoff.done', { path: target }))
    } else {
      await toFill()
    }
    await update($, phase, () => 'done')
  } catch (err) {
    $.ui.toast(t(path ? 'handoff.failedSaved' : 'handoff.failed', { why: whyOf(err), path: path ?? '' }))
    await update($, phase, () => 'failed')
  }
}
