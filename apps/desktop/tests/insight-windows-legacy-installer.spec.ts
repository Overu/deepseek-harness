/** Verifies that the Insight installer accepts its legacy executable only for the registered user installation. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const installer = readFileSync(new URL('../scripts/installer.nsh', import.meta.url), 'utf8')
const path = readFileSync(new URL('../installer/path.nsh', import.meta.url), 'utf8')
const appId = 'com.insight-aigc.desktop'
const legacyExecutable = '因赛AI.exe'

it('gates the legacy executable name to the Insight app id', () => {
  expect(installer).toContain('!ifdef APP_ID')
  expect(installer).toContain(`!if "\${APP_ID}" == "${appId}"`)
  expect(installer).toContain(`!define INSIGHT_LEGACY_APP_EXECUTABLE_FILENAME "${legacyExecutable}"`)
})

it('guards running legacy Insight before each update retry only in the registered directory', () => {
  expect(installer.indexOf('!macro InstallerFindAppProcess')).toBeLessThan(installer.indexOf('!macro customCheckAppRunning'))
  const finder = installer.slice(installer.indexOf('!macro InstallerFindAppProcess'), installer.indexOf('!macroend', installer.indexOf('!macro InstallerFindAppProcess')))
  expect(finder.indexOf('${APP_EXECUTABLE_FILENAME}')).toBeLessThan(finder.indexOf('ReadRegStr $0 HKCU'))
  expect(finder).toContain('${If} $R0 > 0')
  expect(finder.indexOf('ReadRegStr $0 HKCU')).toBeLessThan(finder.indexOf('${If} $0 == $INSTDIR'))
  expect(finder.indexOf('${If} $0 == $INSTDIR')).toBeLessThan(finder.indexOf('${INSIGHT_LEGACY_APP_EXECUTABLE_FILENAME}'))
  const check = installer.slice(installer.indexOf('!macro customCheckAppRunning'), installer.indexOf('!macroend', installer.indexOf('!macro customCheckAppRunning')))
  expect(check.match(/!insertmacro InstallerFindAppProcess/gu)).toHaveLength(2)
})

it('accepts a registered directory with either Insight executable and rejects other nonempty directories', () => {
  const preflight = path.slice(path.indexOf('Function InstallerPreflight'), path.indexOf('FunctionEnd', path.indexOf('Function InstallerPreflight')))
  expect(preflight.indexOf('ReadRegStr $0 HKCU')).toBeLessThan(preflight.indexOf('${If} $0 == $INSTDIR'))
  expect(preflight).toContain('${FileExists} "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"')
  expect(preflight).toContain('${ElseIf} ${FileExists} "$INSTDIR\\${INSIGHT_LEGACY_APP_EXECUTABLE_FILENAME}"')
  expect(preflight.indexOf('${If} $2 == 0')).toBeLessThan(preflight.indexOf('FindFirst $0 $1 "$INSTDIR\\*.*"'))
})
