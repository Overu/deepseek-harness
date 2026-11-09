/** Send one signed Feishu summary after an all-platform Insight Candidate publication. */
import { createHmac } from 'node:crypto'

/**
 * Send one request without retries; transport failures leave delivery unknown.
 * @param environment - Workflow metadata, read-only GitHub token, and Feishu repository secrets.
 * @param fetchImplementation - HTTP transport; defaults to the global fetch implementation.
 * @returns Resolves only when Feishu acknowledges the message with code zero.
 * @throws If configuration is missing, the request fails, or Feishu rejects the message.
 */
export async function notifyInsightPublication(
  environment: NodeJS.ProcessEnv,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const webhook = required(environment, 'FEISHU_BOT_WEBHOOK')
  if (!/^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+$/u.test(webhook)) {
    throw new Error('FEISHU_BOT_WEBHOOK must be a Feishu custom bot HTTPS webhook.')
  }
  const secret = required(environment, 'FEISHU_BOT_SIGNING_SECRET')
  const version = required(environment, 'INSIGHT_RELEASE_VERSION')
  if (version.length > 256 || /[^0-9A-Za-z.-]/u.test(version)) {
    throw new Error('INSIGHT_RELEASE_VERSION must be a single-line version token without build metadata.')
  }
  const sourceCommit = required(environment, 'INSIGHT_SOURCE_COMMIT')
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('INSIGHT_SOURCE_COMMIT must be a full lowercase commit ID.')
  const results = await publicationResults(environment, fetchImplementation)
  const summary = [...results.values()].every(result => result === 'success')
    ? '三个平台均发布成功' : '三个平台未全部发布成功，请查看运行详情'
  const text = [
    'Insight Candidate 发布汇总',
    `版本：${version}`,
    `平台：${[...results].map(([target, result]) => `${target}=${result}`).join('、')}`,
    `结果：${summary}`,
    `源码：${sourceCommit}`,
    `操作人：${required(environment, 'GITHUB_TRIGGERING_ACTOR')}`,
    `运行：${required(environment, 'GITHUB_SERVER_URL')}/${required(environment, 'GITHUB_REPOSITORY')}/actions/runs/${required(environment, 'GITHUB_RUN_ID')}/attempts/${required(environment, 'GITHUB_RUN_ATTEMPT')}`,
  ].join('\n')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const sign = createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
  let response: Response
  try {
    response = await fetchImplementation(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timestamp, sign, msg_type: 'text', content: { text } }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    // Transport errors can contain the secret webhook URL.
    void error
    throw new Error('Feishu notification delivery is unknown. Check the group before rerunning the notification job.')
  }
  if (!response.ok) throw new Error(`Feishu notification returned HTTP ${String(response.status)}. Check the bot configuration before rerunning the notification job.`)
  let result: unknown
  try {
    result = await response.json()
  } catch (error) {
    // Response bodies may contain sensitive request details.
    void error
    throw new Error('Feishu notification returned invalid JSON; delivery is unknown. Check the group before rerunning the notification job.')
  }
  if (result === null || typeof result !== 'object' || !('code' in result) || result.code !== 0) {
    const code = result !== null && typeof result === 'object' && 'code' in result && typeof result.code === 'number'
      ? String(result.code) : 'unknown'
    throw new Error(`Feishu notification was not acknowledged (code ${code}). Check the bot configuration and group before rerunning the notification job.`)
  }
}

async function publicationResults(environment: NodeJS.ProcessEnv, fetchImplementation: typeof fetch): Promise<Map<string, string>> {
  const run = required(environment, 'GITHUB_RUN_ID')
  const attempt = Number(required(environment, 'GITHUB_RUN_ATTEMPT'))
  if (!/^[1-9][0-9]*$/u.test(run) || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error('GitHub run ID and attempt must be positive integers.')
  const token = required(environment, 'GITHUB_TOKEN')
  const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64']
  const latest = new Map<string, { attempt: number; result: string }>()
  // All attempts preserve successful platforms when only failed jobs are rerun.
  for (let page = 1; ; page += 1) {
    const response = await fetchImplementation(`https://api.github.com/repos/Overu/deepseek-harness/actions/runs/${run}/jobs?filter=all&per_page=100&page=${page}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      void error
      throw new Error('GitHub publication status request failed. Check Actions before rerunning the notification job.')
    })
    if (!response.ok) throw new Error(`GitHub publication status returned HTTP ${String(response.status)}. Check Actions before rerunning the notification job.`)
    const value: unknown = await response.json().catch((error: unknown) => {
      void error
      throw new Error('GitHub publication status returned invalid JSON.')
    })
    if (value === null || typeof value !== 'object' || !('jobs' in value) || !Array.isArray(value.jobs)) throw new Error('GitHub publication status is missing jobs.')
    const jobs: readonly unknown[] = value.jobs
    for (const job of jobs) {
      if (job === null || typeof job !== 'object' || !('name' in job) || typeof job.name !== 'string') throw new Error('GitHub publication job is missing its name.')
      const target = targets.find(target => job.name === `Publish ${target}`)
      if (target === undefined) continue
      if (!('run_attempt' in job) || typeof job.run_attempt !== 'number' || !Number.isSafeInteger(job.run_attempt) || job.run_attempt < 1
        || !('status' in job) || typeof job.status !== 'string' || !('conclusion' in job) || (job.conclusion !== null && typeof job.conclusion !== 'string')) {
        throw new Error('GitHub publication job has invalid attempt or result fields.')
      }
      const previous = latest.get(target)
      if (job.run_attempt > attempt || job.run_attempt < (previous?.attempt ?? 0)) continue
      if (job.run_attempt === previous?.attempt) throw new Error('GitHub publication has duplicate platform jobs in one attempt.')
      latest.set(target, { attempt: job.run_attempt, result: job.status === 'completed' ? job.conclusion ?? 'unknown' : `unfinished:${job.status}` })
    }
    if (jobs.length < 100) break
  }
  return new Map(targets.map(target => [target, latest.get(target)?.result ?? 'missing']))
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]
  if (value === undefined || value === '') throw new Error(`${name} is required for the Feishu publication summary.`)
  return value
}

if (import.meta.main) {
  try {
    await notifyInsightPublication(process.env)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Feishu publication notification failed.')
    process.exitCode = 1
  }
}
