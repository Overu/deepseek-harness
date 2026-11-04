/** Candidate publication can finalize an existing Windows artifact without rebuilding it. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'

interface WorkflowStep {
  readonly name?: string
  readonly uses?: string
  readonly run?: string
  readonly env?: Record<string, string>
  readonly with?: Record<string, string>
}

const workflow = load(await readFile(resolve(import.meta.dirname, '../.github/workflows/insight-publish.yml'), 'utf8')) as {
  readonly on: { readonly workflow_dispatch: { readonly inputs: Record<string, {
    readonly required: boolean
    readonly type: string
    readonly default?: string
  }> } }
  readonly permissions: Record<string, string>
  readonly jobs: Record<'finalize-release' | 'publish', {
    readonly if: string
    readonly needs?: string
    readonly environment?: string
    readonly permissions?: Record<string, string>
    readonly steps: readonly WorkflowStep[]
  }>
}

it('limits Release write permission to the optional artifact finalizer', () => {
  expect(workflow.on.workflow_dispatch.inputs.package_run_id).toEqual({
    description: 'Optional successful Windows-only package run to finalize before Candidate publication',
    required: false, type: 'string', default: '',
  })
  expect(workflow.permissions.contents).toBe('read')
  expect(workflow.jobs['finalize-release'].permissions).toEqual({ contents: 'write', actions: 'read' })
  expect(workflow.jobs['finalize-release'].environment).toBe('desktop-release')
  expect(workflow.jobs['finalize-release'].if).toBe("github.ref == 'refs/heads/insight' && inputs.package_run_id != ''")
  expect(workflow.jobs.publish.permissions).toBeUndefined()
})

it('binds the downloaded Windows artifact to the original package run and application commit', () => {
  const steps = workflow.jobs['finalize-release'].steps
  expect(steps.find(step => step.name === 'Download the original Windows package')?.with).toEqual({
    'github-token': '${{ github.token }}',
    'repository': '${{ github.repository }}',
    'run-id': '${{ inputs.package_run_id }}',
    'name': 'insight-package-win32-x64-${{ inputs.version }}',
    'path': 'release/win32-x64',
  })
  expect(steps.find(step => step.name === 'Verify the package run and finalize its Windows prerelease')?.env).toEqual({
    GITHUB_TOKEN: '${{ github.token }}',
    INSIGHT_RELEASE_MODE: 'finalize-package-run',
    INSIGHT_PACKAGE_RUN_ID: '${{ inputs.package_run_id }}',
    INSIGHT_SOURCE_COMMIT: '${{ inputs.source_commit }}',
    INSIGHT_DESKTOP_VERSION: '${{ inputs.version }}',
    INSIGHT_RELEASE_TARGETS: '${{ inputs.target }}',
    INSIGHT_RELEASE_DIRECTORIES: 'release/win32-x64',
  })
  expect(steps.some(step => step.uses?.startsWith('pnpm/action-setup@'))).toBe(false)
  expect(steps.find(step => step.name === 'Install isolated release runtime')?.run)
    .toBe('npm ci --prefix scripts/insight-release/runtime --ignore-scripts --no-audit --no-fund')
  expect(steps.find(step => step.name === 'Prepare immutable Release helper')?.run)
    .toBe('node scripts/insight-release/runtime/prepare-github-release-runtime.mjs')
  expect(steps.some(step => step.env?.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY !== undefined)).toBe(false)
})

it('blocks OSS publication after failed or cancelled finalization and retains the existing Release-only path', () => {
  expect(workflow.jobs.publish.needs).toBe('finalize-release')
  expect(workflow.jobs.publish.if).toBe("always() && !cancelled() && github.ref == 'refs/heads/insight' && (needs.finalize-release.result == 'success' || needs.finalize-release.result == 'skipped')")
  expect(workflow.jobs.publish.steps.find(step => step.name === 'Publish verified GitHub Release bytes to OSS')?.env)
    .toMatchObject({ INSIGHT_SOURCE_COMMIT: '${{ inputs.source_commit }}', INSIGHT_RELEASE_TARGET: '${{ inputs.target }}' })
})
