/** Real Electron probe for the update-fetch URL normalization adapter. */
import { app, net } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function run() {
  let exitCode = 0
  try {
    const [fetchModule, userData, origin] = process.argv.slice(2)
    if (fetchModule === undefined || userData === undefined || origin === undefined) {
      throw new Error('expected <built-insight-update-fetch.js> <userDataDir> <origin>')
    }
    const base = new URL(origin).origin
    app.setPath('userData', userData)
    app.setPath('sessionData', join(userData, 'cache'))
    await app.whenReady()
    const { fetchInsightUpdate } = await import(pathToFileURL(fetchModule).href)
    const directUrl = new URL('/direct', base).href
    const missingUrl = new URL('/missing', base).href
    const raw = await net.fetch(directUrl, { redirect: 'error' })
    if (raw.body !== null) await raw.body.cancel()
    const direct = await fetchInsightUpdate(directUrl, { redirect: 'error' })
    let redirectRejected = false
    try {
      await fetchInsightUpdate(new URL('/redirect', base).href, { redirect: 'error' })
    } catch {
      redirectRejected = true
    }
    const missing = await fetchInsightUpdate(missingUrl, { redirect: 'error' })
    if (missing.body !== null) await missing.body.cancel()
    const result = {
      rawUrl: raw.url,
      direct: { url: direct.url, status: direct.status, redirected: direct.redirected, body: await direct.text() },
      redirect: { rejected: redirectRejected },
      missing: { url: missing.url, status: missing.status, redirected: missing.redirected },
    }
    await new Promise((resolve, reject) => process.stdout.write(`INSIGHT_UPDATE_FETCH_RESULT ${JSON.stringify(result)}\n`, error => error ? reject(error) : resolve()))
  } catch (error) {
    console.error(`INSIGHT_UPDATE_FETCH_ERROR ${error instanceof Error ? error.message : String(error)}`)
    exitCode = 1
  } finally {
    app.exit(exitCode)
  }
}

void run()
