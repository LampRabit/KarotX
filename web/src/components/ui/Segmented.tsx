import { useId } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

type Option<T extends string> = { value: T; label: string }

/** Single-choice pill control (radio group) with a sliding highlight. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  label: string
  className?: string
}) {
  const id = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-lg border bg-muted/60 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative h-7 flex-1 rounded-md px-3 text-[13px] whitespace-nowrap transition-colors',
            value === o.value ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {value === o.value && (
            <motion.span layoutId={id} className="absolute inset-0 rounded-md bg-surface shadow-sm" transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
