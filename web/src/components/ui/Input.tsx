import { useId, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }

/** Labelled text input with hint/error text; password inputs get a show/hide toggle. */
export function Input({ label, hint, error, type = 'text', className, ...props }: Props) {
  const id = useId()
  const [reveal, setReveal] = useState(false)
  const isPassword = type === 'password'
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-10 w-full rounded-lg border bg-background px-3 transition-[border-color,box-shadow] outline-none',
            'placeholder:text-muted-foreground/70 hover:border-foreground/20',
            'focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 focus-visible:outline-none',
            error && 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20',
            isPassword && 'pr-10',
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
