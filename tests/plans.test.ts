import { expect, mock } from 'claude-code/testing'

import { windowParts } from '../src/usage/usage'
import { BAR_W_SOLO } from '../src/ui/theme'
import { answerSession } from './answers'
import { testEn as test } from './lang'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} } as const

// Plans with weekly limits only (no 5-hour window), as the 20x tier reports them since October 2026.
test('a weekly-only plan draws the one 7-day window, with its reset time, wider on the desktop', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 39, resetsAt: '2099-01-01T03:00:00Z' }] } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['desktop', 'terminal'] as const) {
    const band = await $.ui.mount({ plugin: 'glitchband', surface, component: 'AbovePrompt', props: PROPS })
    const row = JSON.stringify(await band.find({ type: 'Box' }))
    expect(row, surface).toContain('7D')
    expect(row, surface).not.toContain('5H')
    expect(await band.find({ text: / · 5h/ }), `${surface}: reset`).toBeDefined()
    if (surface === 'desktop') expect((await band.findAll({ type: 'Svg' }))[0]?.props.width).toBe(BAR_W_SOLO)
    await band.unmount()
  }
})

test('a window kind the band does not know gets a readable name', () => {
  const now = Date.parse('2098-12-31T22:00:00Z')
  expect(windowParts({ kind: 'seven_day_fable', percentUsed: 10 }, 10, now).name).toBe('7D FABLE')
  expect(windowParts({ kind: 'five_hour_opus', percentUsed: 10 }, 10, now).name).toBe('5H OPUS')
  expect(windowParts({ kind: 'monthly', percentUsed: 10 }, 10, now).name).toBe('MONTHLY')
})
