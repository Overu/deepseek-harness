const WEB_ORIGINS = new Set([
  'https://dynsight-test.insight-aigc.com',
  'https://dynsight.insight-aigc.com',
])

export function buildCanvasShareLink(origin: string | undefined, code: unknown): string {
  if (!origin || !WEB_ORIGINS.has(origin)) throw new Error('分享域名不可用')
  if (typeof code !== 'string' || !code.trim()) throw new Error('分享码无效')
  return new URL(`/share/${encodeURIComponent(code)}`, origin).toString()
}

export async function copyCanvasShareLink(link: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link)
      return true
    }
  } catch {
    // An iframe can lose clipboard permission while the share request is in flight.
  }

  let textarea: HTMLTextAreaElement | undefined
  const activeElement = document.activeElement as HTMLElement | null
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    event.clipboardData?.setData('text/plain', link)
  }
  try {
    textarea = document.createElement('textarea')
    textarea.value = link
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.addEventListener('copy', onCopy)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', onCopy)
    textarea?.remove()
    activeElement?.focus()
  }
}
