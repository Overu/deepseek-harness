#!/usr/bin/env node
/** Canonical client, distributed as skills/scripts/enterprise_proxy.mjs.
 * Node built-ins only; no user tokens/provider keys and no network retries.
 */
import { readFile, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const MAX_RESULT = 9 * 1024 * 1024;
export class ProxyError extends Error {
  constructor(code, status = 502, body = null) {
    super(`${code} (HTTP ${status}); 不要自动重试付费请求，超时不代表上游未执行`);
    this.name = 'ProxyError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

async function descriptor() {
  if (!process.env.DSH_HOME) throw new ProxyError('DSH_HOME_MISSING', 503);
  try {
    const path = join(process.env.DSH_HOME, 'skill-proxy', 'connection.json');
    const info = await stat(path);
    if (process.platform !== 'win32' && ((info.mode & 0o077) || info.uid !== process.getuid())) {
      throw new ProxyError('UNSAFE_LOCAL_PROXY_DESCRIPTOR', 403);
    }
    const value = JSON.parse(await readFile(path, 'utf8'));
    // Exact literal loopback authority only (no credentials, path, query or redirects).
    if (value.version !== 1 || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value.url)
        || !/^[a-f0-9]{64}$/.test(value.capability) || !new URL(value.url).port) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    throw new ProxyError('LOCAL_PROXY_UNAVAILABLE', 503);
  }
}

export async function request(connection, method, path, { query = {}, body = null, timeout = 1250 } = {}) {
  if (typeof connection !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(connection)) {
    throw new ProxyError('INVALID_CONNECTION', 400);
  }
  if (!['GET', 'POST'].includes(String(method).toUpperCase()) || typeof path !== 'string'
      || !Number.isFinite(timeout) || timeout <= 0 || timeout > 1250) {
    throw new ProxyError('INVALID_REQUEST', 400);
  }
  const data = JSON.stringify({ method: method.toUpperCase(), path, query, body });
  if (Buffer.byteLength(data) > 2 * 1024 * 1024) throw new ProxyError('PROXY_REQUEST_TOO_LARGE', 413);
  const { url, capability } = await descriptor();
  return new Promise((resolveResult, reject) => {
    let done = false;
    let response;
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let total = 0;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      response?.destroy();
      req.destroy();
      if (error) reject(error); else resolveResult(value);
    };
    const eventLine = (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (!event || typeof event !== 'object') throw new Error();
        if (event.type === 'error') {
          finish(new ProxyError(typeof event.code === 'string' ? event.code : 'PROXY_FAILED', event.status || 502));
        } else if (event.type === 'result') {
          if (!Number.isInteger(event.status) || event.status < 100 || event.status > 599) throw new Error();
          if (event.status < 200 || event.status >= 300) finish(new ProxyError('UPSTREAM_HTTP_ERROR', event.status, event.body));
          else finish(null, event.body);
        } else if (!['accepted', 'heartbeat'].includes(event.type)) throw new Error();
      } catch { finish(new ProxyError('INVALID_PROXY_RESPONSE')); }
    };
    // Direct loopback HTTP: does not consult HTTP(S)_PROXY, never follows Location.
    const req = httpRequest(`${url}/proxy/${connection}`, {
      method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${capability}`,
        'content-length': Buffer.byteLength(data) },
    }, (res) => {
      response = res;
      const success = res.statusCode >= 200 && res.statusCode < 300;
      if (success && !String(res.headers['content-type']).startsWith('application/x-ndjson')) {
        finish(new ProxyError('INVALID_PROXY_RESPONSE')); return;
      }
      res.on('data', (chunk) => {
        if (done) return;
        total += chunk.length;
        if (total > (success ? MAX_RESULT : 16384)) {
          finish(new ProxyError('PROXY_RESPONSE_TOO_LARGE')); return;
        }
        pending += decoder.write(chunk);
        if (!success) return;
        let end;
        while (!done && (end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          eventLine(line);
        }
      });
      res.on('end', () => {
        if (done) return;
        pending += decoder.end();
        if (!success) {
          let code = 'PROXY_HTTP_ERROR';
          try {
            const value = JSON.parse(pending);
            const candidate = (value?.error ?? value?.detail)?.code;
            if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(candidate)) code = candidate;
          } catch { /* Never print arbitrary HTML, headers or secrets. */ }
          finish(new ProxyError(code, res.statusCode));
        } else {
          if (pending.trim()) eventLine(pending);
          if (!done) finish(new ProxyError('PROXY_DISCONNECTED_OUTCOME_UNKNOWN'));
        }
      });
      res.on('error', () => finish(new ProxyError('PROXY_DISCONNECTED_OUTCOME_UNKNOWN')));
      res.on('aborted', () => finish(new ProxyError('PROXY_DISCONNECTED_OUTCOME_UNKNOWN')));
    });
    const deadline = setTimeout(() => finish(new ProxyError('PROXY_TIMEOUT_OUTCOME_UNKNOWN', 504)), timeout * 1000);
    req.setTimeout(Math.min(timeout * 1000, 60_000), () => finish(new ProxyError('PROXY_TIMEOUT_OUTCOME_UNKNOWN', 504)));
    req.on('error', () => finish(new ProxyError('PROXY_UNAVAILABLE_OUTCOME_UNKNOWN')));
    req.end(data);
  });
}

async function cli(args) {
  if (args[0] === '--help') {
    console.log('enterprise_proxy.mjs CONNECTION GET|POST PATH [--query JSON] [--body JSON | --body-file FILE] [--timeout SECONDS]\n--stdin: JSON {connection,method,path,query,body,timeout} via stdin');
    return;
  }
  let input;
  if (args.length === 1 && args[0] === '--stdin') {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024 + 4096) throw new ProxyError('PROXY_REQUEST_TOO_LARGE', 413);
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } else {
    const [connection, method, path, ...options] = args;
    if (!connection || !method || !path) throw new ProxyError('CLI_ARGUMENTS_REQUIRED', 400);
    const values = {};
    for (let i = 0; i < options.length; i += 2) {
      const key = options[i];
      if (!['--query', '--body', '--body-file', '--timeout'].includes(key)
          || options[i + 1] === undefined || Object.hasOwn(values, key)) throw new ProxyError('INVALID_CLI_ARGUMENTS', 400);
      values[key] = options[i + 1];
    }
    if (values['--body'] !== undefined && values['--body-file'] !== undefined) throw new ProxyError('INVALID_CLI_ARGUMENTS', 400);
    const rawBody = values['--body-file'] !== undefined ? await readFile(values['--body-file'], 'utf8') : values['--body'];
    input = { connection, method, path, query: JSON.parse(values['--query'] ?? '{}'),
      body: rawBody === undefined ? null : JSON.parse(rawBody), timeout: Number(values['--timeout'] ?? 1250) };
  }
  const { connection, method, path, ...options } = input;
  console.log(JSON.stringify(await request(connection, method, path, options)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await cli(process.argv.slice(2)); }
  catch (error) {
    const safe = error instanceof ProxyError ? error : new ProxyError('INVALID_CLIENT_INPUT', 400);
    console.error(JSON.stringify({ error: { code: safe.code, status: safe.status, message: safe.message, body: safe.body } }));
    process.exitCode = 1;
  }
}
