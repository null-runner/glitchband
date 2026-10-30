import type { EngineInterface } from 'claude-code'

import type { Ttl } from '../../types'
import { setTtl as setEngineTtl } from '../keepwarm/engine'
import type { State } from '../keepwarm/engine'
import { setTtl, ttlMsOf } from './cache'

// The transcript's last two megabytes: a long tool result can fill a lot of lines, and the newest main-thread reply is near the end.
const TAIL_BYTES = '2000000'

type Written = { type?: string; isSidechain?: boolean; message?: { usage?: { cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } } } }

/** The lifetime the newest main-thread reply wrote its cache with, or null when no line in the tail says. */
export function ttlFromTail(tail: string): Ttl | null {
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let line: Written
    try { line = JSON.parse(lines[i] ?? '') } catch { continue }
    if (line?.type !== 'assistant' || line.isSidechain) continue
    const made = line.message?.usage?.cache_creation
    if ((made?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
    if ((made?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  }
  return null
}

// Where each session's transcript was found, so the directory scan runs once.
const found = new Map<string, string>()

async function transcriptOf($: EngineInterface, sid: string): Promise<string | null> {
  const known = found.get(sid)
  if (known) return known
  const root = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
  for (const dir of await $.fs.list(`${root}/projects`)) {
    const path = `${root}/projects/${dir.name}/${sid}.jsonl`
    if (dir.kind === 'dir' && (await $.fs.exists(path))) {
      found.set(sid, path)
      return path
    }
  }
  return null
}

/** Reads the lifetime from the chat's transcript and tells the cache facts and keepwarm. Any failure keeps what was known (1 hour if nothing was). */
export async function trackTtl($: EngineInterface, s: State): Promise<void> {
  try {
    const path = await transcriptOf($, s.sid || (await $.session.id()))
    if (!path) return
    // tail, not $.fs.read: the file is over its 4 MiB cap. Where tail is missing the run fails and the default stands.
    const { exitCode, stdout } = await $.process.run(['tail', '-c', TAIL_BYTES, path])
    const ttl = exitCode === 0 ? ttlFromTail(stdout) : null
    if (!ttl) return
    await setTtl($, ttl)
    await setEngineTtl($, s, ttlMsOf(ttl))
  } catch {
    // an unreadable transcript is not worth a failed turn
  }
}
