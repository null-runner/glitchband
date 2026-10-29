import { test as kitTest } from 'claude-code/testing'
import type { TestBody, TestOptions, TestRest } from 'claude-code/testing'

import { setLanguage } from '../src/i18n'
import type { Lang } from '../src/i18n'

// A test with the language option fixed. The test's own copy of the language is set too,
// for the tests that call a formatter directly.
const inLanguage = (language: Lang) => (name: string, ...rest: TestRest): void => {
  const body = rest[rest.length - 1] as TestBody
  const given: TestOptions = rest.length === 2 ? (rest[0] as TestOptions) : {}
  kitTest(name, { ...given, options: { ...given.options, language } }, ($, on) => {
    setLanguage(language)
    return body($, on)
  })
}

export const testEn = inLanguage('en')
export const testIt = inLanguage('it')
