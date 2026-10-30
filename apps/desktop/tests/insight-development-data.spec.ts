/** Source Insight launches reuse the Shell appData location on each platform. */
import { describe, expect, it } from 'vitest'
import { insightDevelopmentUserData } from '../scripts/insight-development-data.ts'

describe('Insight development default data', () => {
  it.each([
    { platform: 'darwin' as const, home: '/Users/test', environment: {}, expected: '/Users/test/Library/Application Support/insight-desktop-dev' },
    { platform: 'linux' as const, home: '/home/test', environment: {}, expected: '/home/test/.config/insight-desktop-dev' },
    { platform: 'linux' as const, home: '/home/test', environment: { XDG_CONFIG_HOME: '/config' }, expected: '/config/insight-desktop-dev' },
    { platform: 'win32' as const, home: 'C:\\Users\\test', environment: {}, expected: 'C:\\Users\\test\\AppData\\Roaming\\insight-desktop-dev' },
    { platform: 'win32' as const, home: 'C:\\Users\\test', environment: { APPDATA: 'D:\\Roaming' }, expected: 'D:\\Roaming\\insight-desktop-dev' },
  ])('uses the historical location for $platform', ({ platform, home, environment, expected }) => {
    expect(insightDevelopmentUserData({ platform, home, environment, directoryName: 'insight-desktop-dev' })).toBe(expected)
  })

  it('rejects a relative appData environment rather than selecting another account root', () => {
    expect(() => insightDevelopmentUserData({ platform: 'linux', home: '/home/test',
      environment: { XDG_CONFIG_HOME: 'relative' }, directoryName: 'insight-desktop-dev' })).toThrow('must be absolute')
  })
})
