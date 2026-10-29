/** Client label generation preserves the synchronized directory and native skill names. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { generateSkillPresentations } from './generate-skill-presentations.mjs'

it('uses the invocation name while retaining the source directory for loading', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'insight-skill-labels-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  const entry = join(directory, 'source-directory')
  mkdirSync(entry)
  const source = '---\nname: native-invocation\ndescription: Synthetic fixture\n---\nFixture body\n'
  writeFileSync(join(entry, 'SKILL.md'), source)
  writeFileSync(join(entry, 'ui.json'), JSON.stringify({ displayName: 'Fixture label', shortDescription: 'Fixture summary' }))
  writeFileSync(join(directory, 'README.md'), 'Not a skill directory\n')

  expect(await generateSkillPresentations(directory)).toEqual({
    'native-invocation': { displayName: 'Fixture label', shortDescription: 'Fixture summary', entryPath: 'source-directory/SKILL.md' },
  })
  expect(readFileSync(join(entry, 'SKILL.md'), 'utf8')).toBe(source)
})
