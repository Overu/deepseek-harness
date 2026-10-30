import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { bindOpenDialog } from './dialogService'
import type { OpenDialogInjectedProps, OpenDialogRequest } from './types'

type ActiveDialog = {
  id: number
  render: () => ReactNode
  settled: boolean
}

function createActiveDialog<TProps extends object, TResult, TReject>(
  id: number,
  request: OpenDialogRequest<TProps, TResult, TReject>,
  settle: (id: number, commit: () => void) => void,
): ActiveDialog {
  const { Component, props } = request
  return { id, settled: false, render: () => {
    const injected: OpenDialogInjectedProps<TResult, TReject> = {
      resolve: value => settle(id, () => request.resolve(value)),
      reject: reason => settle(id, () => request.reject(reason)),
    }
    return <Component key={id} {...props} {...injected} />
  } }
}

export function GlobalDialogProvider() {
  const [dialogs, setDialogs] = useState<ActiveDialog[]>([])
  const dialogsRef = useRef<ActiveDialog[]>([])
  const dialogIdRef = useRef(0)

  useEffect(() => {
    dialogsRef.current = dialogs
  }, [dialogs])

  const removeDialog = useCallback((dialogId: number) => {
    dialogsRef.current = dialogsRef.current.filter(dialog => dialog.id !== dialogId)
    setDialogs(prev => prev.filter(dialog => dialog.id !== dialogId))
  }, [])

  const settleDialog = useCallback(
    (dialogId: number, commit: () => void) => {
      const currentDialog = dialogsRef.current.find(dialog => dialog.id === dialogId)
      if (!currentDialog || currentDialog.settled) return

      commit()

      dialogsRef.current = dialogsRef.current.map(dialog => (dialog.id === dialogId ? { ...dialog, settled: true } : dialog))
      setDialogs(prev => prev.map(dialog => (dialog.id === dialogId ? { ...dialog, settled: true } : dialog)))
      window.setTimeout(() => removeDialog(dialogId), 200)
    },
    [removeDialog],
  )

  useEffect(() => {
    return bindOpenDialog((request) => {
      const nextDialog = createActiveDialog(dialogIdRef.current + 1, request, settleDialog)

      dialogIdRef.current = nextDialog.id
      dialogsRef.current = [...dialogsRef.current, nextDialog]
      setDialogs(prev => [...prev, nextDialog])
    })
  }, [settleDialog])

  return (
    <>
      {dialogs.map(dialog => dialog.render())}
    </>
  )
}
