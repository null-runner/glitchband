import { expect, mock } from 'claude-code/testing'

import { answerSession } from './answers'
import { testEn as test } from './lang'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 8,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 8 },
  view: {},
} as const

test("another mod's band stays drawn beneath this one", async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 12.5 }] },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'glitchband', surface, component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ text: ' 87.5%' })).toBeDefined()
    expect(await band.find({ text: 'other band' })).toBeDefined()
    await band.unmount()
  }
})
