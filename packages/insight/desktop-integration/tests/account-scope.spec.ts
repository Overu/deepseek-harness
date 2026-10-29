import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { accountPaths, accountScopeKey } from '../src/desktop/account-scope.ts'

describe('Insight account scope', () => {
  it('keeps the existing opaque scope algorithm and separates environments', () => {
    const testScope = accountScopeKey('test', '12345')
    expect(testScope).toBe('8d06315cacce40d597274ece7d84d554')
    expect(accountScopeKey('test', '12345')).toBe(testScope)
    expect(accountScopeKey('production', '12345')).not.toBe(testScope)
    expect(testScope).not.toContain('12345')
  })

  it('retains the legacy harness directory while reserving a native runtime directory', () => {
    const scope = accountScopeKey('test', '12345')
    expect(accountPaths('/data/insight', scope)).toEqual({
      root: join('/data/insight', 'accounts', scope),
      shell: join('/data/insight', 'accounts', scope, 'shell'),
      harness: join('/data/insight', 'accounts', scope, 'harness'),
      harnessNative: join('/data/insight', 'accounts', scope, 'harness-native'),
      cache: join('/data/insight', 'accounts', scope, 'cache'),
      launchRoot: join('/data/insight', 'accounts', scope, 'launch-root'),
    })
  })

  it('rejects a scope that could escape the accounts root', () => {
    expect(() => accountPaths('/data/insight', '../legacy')).toThrow('account scope')
  })
})
