import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { afterEach, expect, it, vi } from 'vitest'
import { notifyInsightPublication } from './notify-feishu.ts'

const environment = {
  FEISHU_BOT_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook',
  FEISHU_BOT_SIGNING_SECRET: 'test-signing-secret',
  GITHUB_TOKEN: 'test-github-token',
  INSIGHT_RELEASE_VERSION: '1.0.12-rc.1',
  INSIGHT_SOURCE_COMMIT: 'a'.repeat(40),
  INSIGHT_RELEASE_TARGET: 'all',
  GITHUB_ACTOR: 'initial-operator',
  GITHUB_TRIGGERING_ACTOR: 'release-operator',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2',
}
const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64']

function job(target: string, conclusion: string | null = 'success', attempt = 2, status = 'completed') {
  return { name: `Publish ${target}`, run_attempt: attempt, status, conclusion }
}

function transport(jobs: readonly unknown[] = targets.map(target => job(target)), feishuResponse = Response.json({ code: 0 })) {
  return vi.fn<typeof fetch>(async (url, request) => {
    assert(typeof url === 'string')
    if (url.startsWith('https://api.github.com/')) return Response.json({ jobs })
    expect(url).toBe(environment.FEISHU_BOT_WEBHOOK)
    expect(request?.method).toBe('POST')
    return feishuResponse
  })
}

function messageBody(fetch: ReturnType<typeof transport>): string {
  const posts = fetch.mock.calls.filter(([, request]) => request?.method === 'POST')
  expect(posts).toHaveLength(1)
  const body = posts[0]?.[1]?.body
  assert(typeof body === 'string')
  return body
}

afterEach(() => vi.restoreAllMocks())

it('checks platform jobs and sends one signed summary for the exact run attempt', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  const fetch = transport()
  await notifyInsightPublication(environment, fetch)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[0]).toMatchObject([
    'https://api.github.com/repos/Overu/deepseek-harness/actions/runs/123/jobs?filter=all&per_page=100&page=1',
    { headers: { authorization: 'Bearer test-github-token' }, redirect: 'error' },
  ])
  const request = fetch.mock.calls[1]?.[1]
  expect(request).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error' })
  expect(request?.signal).toBeInstanceOf(AbortSignal)
  expect(JSON.parse(messageBody(fetch))).toEqual({
    timestamp: '1700000000',
    sign: '8+AD5scD8fIa8VJ+zWT5Bsd8iQwKT/D2d1mzhKogGP8=',
    msg_type: 'text',
    content: { text: [
      'Insight 测试版 发布汇总',
      '版本：1.0.12-rc.1',
      '平台：',
      'darwin-arm64=https://updates.insight-aigc.com/desktop/native/releases/v1.0.12-rc.1/targets/darwin-arm64/insight-1.0.12-rc.1-mac-arm64.dmg',
      'darwin-x64=https://updates.insight-aigc.com/desktop/native/releases/v1.0.12-rc.1/targets/darwin-x64/insight-1.0.12-rc.1-mac-x64.dmg',
      'win32-x64=https://updates.insight-aigc.com/desktop/native/releases/v1.0.12-rc.1/targets/win32-x64/insight-1.0.12-rc.1-win-x64.exe',
      '结果：三个平台均发布成功',
      `源码：${'a'.repeat(40)}`,
      '操作人：release-operator',
    ].join('\n') },
  })
  expect(messageBody(fetch)).not.toContain(environment.GITHUB_TOKEN)
  expect(messageBody(fetch)).not.toContain(environment.FEISHU_BOT_SIGNING_SECRET)
})

it.each([
  ['all', '测试版', targets.map(target => job(target))],
  ['stable', '正式版', [job('stable')]],
] as const)('links final-version installers for target %s', async (target, channel, jobs) => {
  const fetch = transport(jobs)
  await notifyInsightPublication({ ...environment, INSIGHT_RELEASE_TARGET: target, INSIGHT_RELEASE_VERSION: '1.0.12' }, fetch)
  expect(JSON.parse(messageBody(fetch))).toMatchObject({ content: { text: [
    `Insight ${channel} 发布汇总`,
    '版本：1.0.12',
    '平台：',
    'darwin-arm64=https://updates.insight-aigc.com/desktop/releases/v1.0.12/targets/darwin-arm64/insight-1.0.12-mac-arm64.dmg',
    'darwin-x64=https://updates.insight-aigc.com/desktop/releases/v1.0.12/targets/darwin-x64/insight-1.0.12-mac-x64.dmg',
    'win32-x64=https://updates.insight-aigc.com/desktop/releases/v1.0.12/targets/win32-x64/insight-1.0.12-win-x64.exe',
    '结果：三个平台均发布成功',
    `源码：${'a'.repeat(40)}`,
    '操作人：release-operator',
  ].join('\n') } })
})

it('requires a successful Stable job before sending a formal release summary', async () => {
  const fetch = transport([...targets.map(target => job(target)), job('stable', 'failure')])
  await expect(notifyInsightPublication({ ...environment, INSIGHT_RELEASE_TARGET: 'stable', INSIGHT_RELEASE_VERSION: '1.0.12' }, fetch)).rejects.toThrow('stable')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['failure', 'cancelled', 'skipped', 'timed_out'])('does not send when one platform is %s', async (result) => {
  const fetch = transport([job(targets[0]!, result), ...targets.slice(1).map(target => job(target))])
  await expect(notifyInsightPublication(environment, fetch)).rejects.toThrow(`darwin-arm64=${result}`)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([
  ['missing', targets.slice(1).map(target => job(target))],
  ['unfinished:queued', [job(targets[0]!, null, 2, 'queued'), ...targets.slice(1).map(target => job(target))]],
  ['unfinished:success', [job(targets[0]!, 'success', 2, 'success'), ...targets.slice(1).map(target => job(target))]],
  ['unknown', [job(targets[0]!, null), ...targets.slice(1).map(target => job(target))]],
])('does not send when one platform is %s', async (label, jobs) => {
  const fetch = transport(jobs)
  await expect(notifyInsightPublication(environment, fetch)).rejects.toThrow(`darwin-arm64=${label}`)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('keeps previous successes and uses the rerun result instead of an old failure', async () => {
  const fetch = transport([
    job(targets[0]!, 'success', 1), job(targets[1]!, 'success', 1),
    job(targets[2]!, 'success', 2), job(targets[2]!, 'failure', 1), job(targets[0]!, 'failure', 3),
  ])
  await notifyInsightPublication(environment, fetch)
  expect(messageBody(fetch)).toContain('三个平台均发布成功')
})

it('does not hide a new failure behind an older success', async () => {
  const fetch = transport([...targets.map(target => job(target, 'success', 1)), job(targets[0]!, 'failure', 2)])
  await expect(notifyInsightPublication(environment, fetch)).rejects.toThrow('darwin-arm64=failure')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('reads all pages before selecting the latest platform results', async () => {
  const filler = Array.from({ length: 97 }, (_, index) => ({ name: `other job ${index}` }))
  const pages = [
    [...targets.map(target => job(target, 'failure', 1)), ...filler],
    targets.map(target => job(target, 'success', 2)),
  ]
  const fetch = transport().mockImplementation(async (url) => {
    assert(typeof url === 'string')
    if (url.startsWith('https://api.github.com/')) {
      const page = Number(new URL(url).searchParams.get('page'))
      return Response.json({ jobs: pages[page - 1] })
    }
    return Response.json({ code: 0 })
  })
  await notifyInsightPublication(environment, fetch)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(messageBody(fetch)).toContain('三个平台均发布成功')
})

it.each([
  [job(targets[0]!), job(targets[0]!)],
  [{ name: 'Publish darwin-arm64', conclusion: 'success', status: 'completed' }],
  [{ ...job(targets[0]!), run_attempt: 0 }],
  [{ ...job(targets[0]!), conclusion: 1 }],
  [null],
].map(jobs => ({ jobs })))('rejects duplicate or malformed job records before sending', async ({ jobs }) => {
  const fetch = transport(jobs)
  await expect(notifyInsightPublication(environment, fetch)).rejects.toThrow('GitHub publication')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['FEISHU_BOT_WEBHOOK', 'FEISHU_BOT_SIGNING_SECRET', 'INSIGHT_RELEASE_TARGET', 'GITHUB_TOKEN', 'GITHUB_RUN_ATTEMPT'])('rejects missing %s before sending', async (name) => {
  const fetch = transport()
  await expect(notifyInsightPublication({ ...environment, [name]: '' }, fetch)).rejects.toThrow(name)
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['https://example.com/hook', 'http://open.feishu.cn/open-apis/bot/v2/hook/test', 'https://open.feishu.cn/open-apis/bot/v2/hook/test?query=secret'])('rejects an unexpected webhook destination', async (url) => {
  const fetch = transport()
  await expect(notifyInsightPublication({ ...environment, FEISHU_BOT_WEBHOOK: url }, fetch)).rejects.toThrow('HTTPS webhook')
  expect(fetch).not.toHaveBeenCalled()
})

it.each([
  ['INSIGHT_RELEASE_VERSION', '1.0.13-rc.2\n结果：三个平台均发布成功'],
  ['INSIGHT_RELEASE_VERSION', '1.0.13-rc.2\r'],
  ['INSIGHT_RELEASE_VERSION', '1.0.13-rc.2\u2028结果：三个平台均发布成功'],
  ['INSIGHT_RELEASE_VERSION', '1.0.13-rc.2+metadata'],
  ['INSIGHT_RELEASE_VERSION', '1'.repeat(257)],
  ['INSIGHT_SOURCE_COMMIT', `${'a'.repeat(40)}\n结果：三个平台均发布成功`],
  ['INSIGHT_SOURCE_COMMIT', 'a'.repeat(39)],
  ['INSIGHT_SOURCE_COMMIT', 'A'.repeat(40)],
])('rejects unsafe %s before reading publication results or sending', async (name, value) => {
  const fetch = transport()
  await expect(notifyInsightPublication({ ...environment, [name]: value }, fetch)).rejects.toThrow(name)
  expect(fetch).not.toHaveBeenCalled()
})

it('does not send a notification when GitHub status cannot be read', async () => {
  const fetch = transport().mockRejectedValue(new Error(environment.GITHUB_TOKEN))
  const error = await notifyInsightPublication(environment, fetch).catch((error: unknown) => error)
  expect(String(error)).toContain('GitHub publication status request failed')
  expect(String(error)).not.toContain(environment.GITHUB_TOKEN)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([
  new Response('secret response', { status: 503 }),
  new Response('not JSON'),
  Response.json({ jobs: null }),
])('rejects invalid GitHub status responses without sending', async (response) => {
  const fetch = transport().mockResolvedValue(response)
  await expect(notifyInsightPublication(environment, fetch)).rejects.toThrow('GitHub publication status')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('reports Feishu transport uncertainty without exposing secrets or retrying', async () => {
  const fetch = transport().mockImplementation(async (url) => {
    if (url === environment.FEISHU_BOT_WEBHOOK) throw new Error(`${environment.FEISHU_BOT_WEBHOOK} ${environment.FEISHU_BOT_SIGNING_SECRET}`)
    return Response.json({ jobs: targets.map(target => job(target)) })
  })
  const error = await notifyInsightPublication(environment, fetch).catch((error: unknown) => error)
  expect(String(error)).toContain('delivery is unknown')
  expect(String(error)).not.toContain(environment.FEISHU_BOT_WEBHOOK)
  expect(String(error)).not.toContain(environment.FEISHU_BOT_SIGNING_SECRET)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([400, 503])('rejects Feishu HTTP %s without logging the response body or retrying', async (status) => {
  const fetch = transport(undefined, new Response(environment.FEISHU_BOT_SIGNING_SECRET, { status }))
  const error = await notifyInsightPublication(environment, fetch).catch((error: unknown) => error)
  expect(String(error)).toContain(`HTTP ${status}`)
  expect(String(error)).not.toContain(environment.FEISHU_BOT_SIGNING_SECRET)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([{ code: 19021 }, {}, null, { code: '0' }])('requires an explicit Feishu acknowledgement: %j', async (body) => {
  const fetch = transport(undefined, Response.json(body))
  await expect(notifyInsightPublication(environment, fetch)).rejects.toThrow('not acknowledged')
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('reports malformed Feishu JSON as uncertain delivery without response details', async () => {
  const fetch = transport(undefined, new Response(environment.FEISHU_BOT_SIGNING_SECRET))
  const error = await notifyInsightPublication(environment, fetch).catch((error: unknown) => error)
  expect(String(error)).toContain('invalid JSON; delivery is unknown')
  expect(String(error)).not.toContain(environment.FEISHU_BOT_SIGNING_SECRET)
})

it('waits for the whole matrix and shares target locks with single-platform publication', async () => {
  const workflow = load(await readFile(new URL('../../.github/workflows/insight-publish.yml', import.meta.url), 'utf8')) as {
    on: { workflow_dispatch: { inputs: { target: { options: string[] } } } }
    concurrency?: unknown
    jobs: {
      publish: { strategy: { 'fail-fast': boolean; matrix: { target: string } }; concurrency: { group: string; 'cancel-in-progress': boolean; queue: string } }
      notify: { needs: string; if: string; permissions: Record<string, string>; steps: { run?: string; env?: Record<string, string> }[] }
    }
  }
  expect(workflow.on.workflow_dispatch.inputs.target.options).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64', 'all', 'stable'])
  expect(workflow.concurrency).toBeUndefined()
  expect(workflow.jobs.publish.strategy['fail-fast']).toBe(false)
  expect(workflow.jobs.publish.strategy.matrix.target).toBe('${{ fromJSON(inputs.target == \'all\' && \'["darwin-arm64","darwin-x64","win32-x64"]\' || format(\'["{0}"]\', inputs.target)) }}')
  expect(workflow.jobs.publish.concurrency).toEqual({ group: 'insight-oss-${{ matrix.target }}', 'cancel-in-progress': false, queue: 'max' })
  expect(workflow.jobs.notify.needs).toBe('publish')
  expect(workflow.jobs.notify.if).toBe("success() && (inputs.target == 'all' || inputs.target == 'stable') && github.ref == 'refs/heads/insight'")
  expect(workflow.jobs.notify.permissions).toEqual({ contents: 'read', actions: 'read' })
  const send = workflow.jobs.notify.steps.find(step => step.run === 'node scripts/insight-release/notify-feishu.ts')
  expect(send?.env).toEqual({
    FEISHU_BOT_WEBHOOK: '${{ secrets.FEISHU_BOT_WEBHOOK }}',
    FEISHU_BOT_SIGNING_SECRET: '${{ secrets.FEISHU_BOT_SIGNING_SECRET }}',
    INSIGHT_RELEASE_VERSION: '${{ inputs.version }}',
    INSIGHT_SOURCE_COMMIT: '${{ inputs.source_commit }}',
    INSIGHT_RELEASE_TARGET: '${{ inputs.target }}',
    GITHUB_TRIGGERING_ACTOR: '${{ github.triggering_actor }}',
    GITHUB_TOKEN: '${{ github.token }}',
  })
})
