import * as P from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverAnchor = P.Anchor

export function PopoverContent({ children, className, align = 'start' }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end' }) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn('z-50 rounded-xl border bg-surface p-3 shadow-[var(--shadow)] outline-none data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in', className)}
      >
        {children}
      </P.Content>
    </P.Portal>
  )
}
