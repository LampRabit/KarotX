import { cn } from '@/lib/cn'

/** Progress bar. Omit `value` for indeterminate work of unknown length. */
export function Progress({ value, className, label }: { value?: number; className?: string; label?: string }) {
  const indeterminate = value === undefined
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full bg-primary',
          indeterminate ? 'w-full origin-left animate-indeterminate' : 'transition-[width] duration-300 ease-out',
        )}
        style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
