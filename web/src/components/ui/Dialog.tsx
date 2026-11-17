import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  className?: string
}

/** Accessible modal (focus trap, Esc to close) with enter/exit animation. */
export function Dialog({ open, onOpenChange, title, children, className }: Props) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <D.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
            'overflow-hidden rounded-2xl border bg-surface shadow-[var(--shadow)] outline-none',
            'data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
            className,
          )}
        >
          <D.Title className="sr-only">{title}</D.Title>
          {children}
          <D.Close
            aria-label="Close"
            className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X size={17} />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
