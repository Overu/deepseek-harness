import { randomUUID } from 'node:crypto'

type Reply = { type?: unknown; id?: unknown; token?: unknown; error?: unknown }
type ParentPort = {
  on(event: 'message', listener: (event: { data: Reply }) => void): void
  off(event: 'message', listener: (event: { data: Reply }) => void): void
  postMessage(value: object): void
}

export class LoginRequiredError extends Error {}

/** Ask the desktop parent for its current validated Token; never cache it. */
export async function desktopToken(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const port = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
  if (!port && (!process.connected || !process.send)) {
    return Promise.reject(new LoginRequiredError('请在已登录的桌面客户端中操作'))
  }
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (port) port.off('message', onPortMessage)
      else process.off('message', onProcessMessage)
    }
    const finish = (reply: Reply): void => {
      if (reply.type !== 'insight:model-token:response' || reply.id !== id) return
      cleanup()
      if (typeof reply.token === 'string' && reply.token) resolve(reply.token)
      else if (reply.error === 'LOGIN_REQUIRED') reject(new LoginRequiredError('登录已失效，请重新登录'))
      else reject(new Error('暂时无法验证客户端登录'))
    }
    const onPortMessage = (event: { data: Reply }): void => finish(event.data)
    const onProcessMessage = (reply: Reply): void => finish(reply)
    const onAbort = (): void => {
      cleanup()
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('获取客户端登录态超时'))
    }, 35000)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (port) port.on('message', onPortMessage)
    else process.on('message', onProcessMessage)
    try {
      if (port) port.postMessage({ type: 'insight:model-token:request', id })
      else process.send?.({ type: 'insight:model-token:request', id })
    } catch {
      cleanup()
      reject(new Error('客户端登录通道不可用'))
    }
  })
}
