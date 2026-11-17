import * as C from '@radix-ui/react-context-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from './Kbd'

/** Right-click menu. Wrap the target with <ContextMenu content={...}>. */
export function ContextMenu({ children, content, disabled }: { children: ReactNode; content: ReactNode; disabled?: boolean }) {
  if (disabled) return <>{children}</>
  return (
    <C.Root>
      <C.Trigger asChild>{children}</C.Trigger>
      <C.Portal>
        <C.Content className="z-50 min-w-48 rounded-xl border bg-surface p-1 shadow-[var(--shadow)] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in">
          {content}
        </C.Content>
      </C.Portal>
    </C.Root>
  )
}

export function CtxItem({ children, onSelect, icon, danger, shortcut, disabled }: {
  children: ReactNode; onSelect: () => void; icon?: ReactNode; danger?: boolean; shortcut?: string; disabled?: boolean
}) {
  return (
    <C.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] outline-none select-none data-[disabled]:opacity-45',
        danger ? 'text-destructive data-[highlighted]:bg-destructive/10' : 'data-[highlighted]:bg-muted',
      )}
    >
      <span className="flex w-4 justify-center text-muted-foreground [&>svg]:size-[15px]" aria-hidden>{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <Kbd className="ml-4">{shortcut}</Kbd>}
    </C.Item>
  )
}

export const CtxSeparator = () => <C.Separator className="my-1 h-px bg-border" />
export const CtxLabel = ({ children }: { children: ReactNode }) => (
  <C.Label className="truncate px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</C.Label>
)
