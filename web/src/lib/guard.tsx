import { useCallback, useRef, useState } from 'react'
import { ApiError } from './api'
import { Confirm } from '@/components/ui/Confirm'

/**
 * Runs a change through the production guard: the action is tried first;
 * if the server answers "needs confirmation", the exact command is shown and
 * the action is retried with confirmed=true once the user agrees.
 * Render `dialog` somewhere in the component.
 */
export function useGuard(connName: string) {
  const [pending, setPending] = useState<{ statements: string[] }>()
  const resolver = useRef<(ok: boolean) => void>(undefined)

  const guard = useCallback(async <T,>(action: (confirmed: boolean) => Promise<T>): Promise<T | undefined> => {
    try {
      return await action(false)
    } catch (e) {
      const err = e as ApiError
      if (!err.data?.needsConfirmation) throw e
      const ok = await new Promise<boolean>((resolve) => {
        resolver.current = resolve
        setPending({ statements: err.data.statements ?? [] })
      })
      if (!ok) return undefined
      return action(true)
    }
  }, [])

  const close = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = undefined
    setPending(undefined)
  }

  const dialog = (
    <Confirm
      open={!!pending}
      onOpenChange={(o) => !o && close(false)}
      title="Change production data?"
      confirmLabel="Yes, run it"
      danger
      onConfirm={() => close(true)}
    >
      <p>{connName} is marked as production. This will run:</p>
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">{pending?.statements.join('\n')}</pre>
    </Confirm>
  )
  return { guard, dialog }
}
