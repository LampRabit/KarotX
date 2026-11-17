import * as M from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Menu = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={4}
        className="z-50 min-w-44 rounded-xl border bg-surface p-1 shadow-[var(--shadow)] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
      >
        {children}
      </M.Content>
    </M.Portal>
  )
}

export function MenuItem({ children, onSelect, danger, icon }: { children: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode }) {
  return (
    <M.Item
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] outline-none select-none',
        danger ? 'text-destructive data-[highlighted]:bg-destructive/10' : 'data-[highlighted]:bg-muted',
      )}
    >
      <span className="flex w-4 justify-center text-muted-foreground [&>svg]:size-[15px]" aria-hidden>{icon}</span>
      {children}
    </M.Item>
  )
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />
