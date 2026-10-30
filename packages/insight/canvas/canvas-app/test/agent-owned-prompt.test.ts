// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
vi.mock('@/store/flowStore', () => ({ useFlowStore: (selector: (state: unknown) => unknown) => selector({ modelMaxPromptMap: {} }) }))
vi.mock('@/routes', () => ({ router: { navigate: vi.fn() } }))
vi.mock('@/hooks/useFileUpload', () => ({}))
import hooks from '../legacy/src/components/canvasFlow/hooks'
import { createAgentEditGuard } from '../src/agent-edit-guard'
import { createCanvasEditorTimers } from '../src/canvas-editor-timers'
import { bindCanvasView, type CanvasViewBinding } from '../src/canvas-service-binding'
let root: Root; let container: HTMLDivElement; let release: () => void; let timers: ReturnType<typeof createCanvasEditorTimers>
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const guard = createAgentEditGuard(); timers = createCanvasEditorTimers(guard)
  // Only the prompt hook's integration port; native Store binding is covered by runtime tests.
  release = bindCanvasView({ guard, createEditorDebounce: timers.create, onRelease: () => () => undefined,
    release: () => undefined } as CanvasViewBinding)
})
afterEach(() => { act(() => root.unmount()); release(); timers.dispose(); container.remove(); vi.useRealTimers() })
it('idle native prompt panels sync external saved changes, while a pending local draft is retained', () => {
  const commit = vi.fn()
  function Prompt({ value }: { value: string }) {
    const { prompt, setPrompt, debouncedUpdateValue } = hooks.usePromptModelCommon({ nodeId: 'n1', nodePrompt: value, status: '', onChangePrompt: commit })
    return createElement('textarea', { value: prompt, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { setPrompt(event.target.value); debouncedUpdateValue(event.target.value) } })
  }
  act(() => root.render(createElement(Prompt, { value: 'old' }))); act(() => root.render(createElement(Prompt, { value: 'agent saved' })))
  const input = container.querySelector('textarea')!; expect(input.value).toBe('agent saved')
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'user draft'); input.dispatchEvent(new Event('input',{ bubbles: true })) })
  act(() => root.render(createElement(Prompt, { value: 'external' }))); expect(input.value).toBe('user draft')
  act(() => root.render(null)); act(() => vi.advanceTimersByTime(1500)); expect(commit).toHaveBeenCalledExactlyOnceWith('user draft')
})
