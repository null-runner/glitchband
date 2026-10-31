import { expect } from 'claude-code/testing'

import { clean } from '../src/usage/usage'
import { testEn as test } from './lang'

test('a 5-hour window missing after its reset shows as a fresh one, 0% used, no reset time', () => {
  expect(clean([{ kind: 'seven_day', percentUsed: 38, resetsAt: '2099-01-01T00:00:00Z' }])).toEqual([
    { kind: 'seven_day', percentUsed: 38, resetsAt: '2099-01-01T00:00:00Z' },
    { kind: 'five_hour', percentUsed: 0, resetsAt: undefined },
  ])
  // No readings at all (an API key, no plan limits): nothing is made up.
  expect(clean([])).toEqual([])
})
