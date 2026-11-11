import { expect, it } from 'vitest'
import { resolveAuthEnvironment } from '../src/desktop/auth-environment.ts'

it('uses isolated authentication partitions for packaged test and production clients', () => {
  expect(resolveAuthEnvironment({ packaged: true, serviceEnvironment: 'test' })).toEqual({
    name: 'test', baseUrl: 'https://gapi-test.insight-aigc.com', partition: 'persist:insight-auth-test',
  })
  expect(resolveAuthEnvironment({ packaged: true })).toEqual({
    name: 'production', baseUrl: 'https://gapi.insight-aigc.com', partition: 'persist:insight-auth-production',
  })
})
