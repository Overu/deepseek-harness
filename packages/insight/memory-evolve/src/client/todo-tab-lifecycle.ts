export const RUNTIME_CONFIG_CHANGED = 'dsh-memory-evolve:runtime-config-changed'

/** Framework-free lifecycle for a conditional conversation tab. */
export function createTodoTabLifecycle(register: () => () => void): {
  setEnabled(next: boolean): void
  refresh(): void
  dispose(): void
  enabled(): boolean
} {
  let enabled = false
  let disposer: (() => void) | undefined
  const mount = (): void => {
    disposer?.()
    disposer = register()
  }
  return {
    setEnabled(next) {
      enabled = next
      if (!enabled) {
        disposer?.()
        disposer = undefined
      } else if (disposer === undefined) {
        mount()
      }
    },
    refresh() {
      if (enabled && disposer !== undefined) mount()
    },
    dispose() {
      enabled = false
      disposer?.()
      disposer = undefined
    },
    enabled: () => enabled,
  }
}
