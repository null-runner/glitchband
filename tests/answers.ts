import type { On } from 'claude-code'

/** What keepwarm reads when a session starts, for the tests that only look at the band. */
export const answerSession = (on: On): void => {
  on('session.id', () => ({ value: 'S1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
}
