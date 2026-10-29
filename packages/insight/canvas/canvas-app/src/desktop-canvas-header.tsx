import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { shareCanvas } from '../legacy/src/api/workflow'
import { useFlowStore } from '../legacy/src/store/flowStore'
import { buildCanvasShareLink, copyCanvasShareLink } from './share-link'

interface Props {
  id: string
  name: string
  thumbnailUrl: string
  ready: boolean
}

export default function DesktopCanvasHeader({ id, name, thumbnailUrl, ready }: Props) {
  const [sharing, setSharing] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const shareInput = useRef<HTMLInputElement>(null)

  const copyLink = async (link: string) => {
    if (await copyCanvasShareLink(link)) {
      toast.success('分享链接已复制到剪贴板')
    } else {
      shareInput.current?.select()
      toast.error('自动复制不可用，请手动复制下方链接')
    }
  }

  const handleShare = async () => {
    if (sharing || !ready) return
    const { canvasId, nodes, edges } = useFlowStore.getState()
    if (canvasId !== id) return

    setSharing(true)
    setShareLink(null)
    try {
      const canvasData = {
        nodes: nodes.map(item => {
          const nextData = { ...item.data }
          if (item.data.taskInfo) nextData.taskInfo = { ...item.data.taskInfo, status: 'success' }
          if (item.data.storyboardInfo) nextData.storyboardInfo = { ...item.data.storyboardInfo, status: 'success' }
          return item.data.taskInfo || item.data.storyboardInfo ? { ...item, data: nextData } : item
        }),
        edges,
      }
      const response = await shareCanvas({
        canvasId: id,
        canvasData: JSON.stringify(canvasData),
        canvasName: name,
        thumbnailUrl,
      })
      if (response.code !== 'SUCCESS') throw new Error('生成分享链接失败')
      const origin = document.querySelector<HTMLMetaElement>('meta[name="desktop-canvas-web-origin"]')?.content
      const link = buildCanvasShareLink(origin, response.data?.code)
      setShareLink(link)
      await copyLink(link)
    } catch {
      toast.error('分享失败，请重试')
    } finally {
      setSharing(false)
    }
  }

  return <div className="absolute left-0 top-0 z-[10] max-w-full p-4">
    <div className="flex min-w-0 items-center" style={{ gap: 12 }}>
      <button type="button" onClick={handleShare} disabled={!ready || sharing}
        className="h-8 shrink-0 rounded-lg bg-white/25 px-4 text-sm text-white backdrop-blur-md hover:bg-white/45 disabled:cursor-not-allowed disabled:opacity-50">
        {sharing ? '分享中…' : '分享'}
      </button>
      <span className="min-w-0 truncate text-sm text-white" title={name}>{name || '未命名画布'}</span>
    </div>
    {shareLink && <div className="mt-2 flex max-w-[min(28rem,calc(100vw-2rem))] items-center gap-2 rounded-lg bg-zinc-900/95 p-2 text-white shadow-lg nodrag">
      <input ref={shareInput} aria-label="画布分享链接" readOnly value={shareLink}
        onFocus={event => event.currentTarget.select()}
        onKeyDown={event => event.stopPropagation()}
        className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-white" />
      <button type="button" onClick={() => void copyLink(shareLink)}
        className="shrink-0 rounded bg-blue-600 px-2 py-1 text-xs hover:bg-blue-500">复制链接</button>
      <button type="button" aria-label="关闭分享链接" onClick={() => setShareLink(null)}
        className="shrink-0 px-1 text-sm text-white/70 hover:text-white">×</button>
    </div>}
  </div>
}
