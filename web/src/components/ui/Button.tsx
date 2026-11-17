import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-sm hover:brightness-110 active:brightness-95',
  secondary: 'border bg-surface hover:bg-muted active:bg-muted/70',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'bg-destructive text-white shadow-sm hover:brightness-110',
}
const sizes: Record<Size, string> = { sm: 'h-8 px-2.5 text-[13px]', md: 'h-9 px-3.5', lg: 'h-10 px-4 text-[15px]' }

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }

/** Button with a built-in loading state: shows a spinner and blocks repeat clicks. */
export function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, ...props }: Props) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap',
        'transition-[background,filter,transform,color] duration-150 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={15} />}
      {children}
    </button>
  )
}
