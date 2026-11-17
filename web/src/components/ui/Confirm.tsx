import { useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { Dialog } from './Dialog'

type Props = {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<unknown> | void
}

/** Confirmation dialog whose confirm button shows progress until the action finishes. */
export function Confirm({ open, onOpenChange, title, children, confirmLabel, danger, onConfirm }: Props) {
  const [busy, setBusy] = useState(false)
  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title={title} className="max-w-md">
      <div className="space-y-4 p-6">
        <div className="flex gap-3">
          {danger && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle size={18} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            <div className="mt-1 text-[13px] text-muted-foreground">{children}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={confirm} autoFocus>{confirmLabel}</Button>
        </div>
      </div>
    </Dialog>
  )
}
