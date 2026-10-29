import { expect, mock } from 'claude-code/testing'

import { BAR_H, BAR_W, FIVE_HOUR, LOW_COLOR, SEVEN_DAY } from '../src/ui/theme'
import { answerSession } from './answers'
import { testEn as test } from './lang'

const WINDOWS = [
  { kind: 'five_hour', percentUsed: 58, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 12.5 },
]

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

test('the band shows percent left for each window once a reading lands', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'glitchband',
      surface,
      component: 'AbovePrompt',
      props: PROPS,
    })
    expect(await band.find({ text: ' 42%' })).toBeDefined()
    expect(await band.find({ text: ' 87.5%' })).toBeDefined()
    expect(await band.find({ text: / left/ })).toBeUndefined()
    // 7D (87.5% left) draws before 5H (42% left)
    const all = JSON.stringify(await band.find({ type: 'Box' }))
    expect(all.indexOf('7D')).toBeLessThan(all.indexOf('5H'))
    await band.unmount()
  }
})

test('in a narrow band each window stacks, with percent left and reset time on their own lines', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({
    plugin: 'glitchband',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { ...PROPS, bodyColumns: 36 },
  })
  expect(await band.find({ text: '42% left' })).toBeDefined()
  expect(await band.find({ text: 'resets 2h 0m' })).toBeDefined()
  await band.unmount()
})

test('the desktop draws a bar of what is left for each window, the terminal keeps its dots', async ($, on) => {
  mock.store(on)
  answerSession(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [...WINDOWS, { kind: 'five_hour', percentUsed: 93 }] } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const desktop = await $.ui.mount({ plugin: 'glitchband', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const bars = await desktop.findAll({ type: 'Svg' })
  expect(bars.map(b => b.props.alt)).toEqual(['7D 87.5%', '5H 42%', '5H 7%'])
  for (const b of bars) {
    expect(b.props.width).toBe(BAR_W)
    expect(b.props.height).toBe(BAR_H)
    expect(b.props.isInteractive).toBe(true)
  }
  expect(String(bars[0]?.props.source)).toContain(`fill="${SEVEN_DAY}"`)
  expect(String(bars[1]?.props.source)).toContain(`fill="${FIVE_HOUR}"`)
  // Under LOW the bar turns red.
  expect(String(bars[2]?.props.source)).toContain(`fill="${LOW_COLOR}"`)
  expect(await desktop.find({ text: '●' })).toBeUndefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ plugin: 'glitchband', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await terminal.findAll({ type: 'Svg' })).toEqual([])
  expect(JSON.stringify(await terminal.find({ type: 'Box' }))).toContain('●')
  await terminal.unmount()
})
