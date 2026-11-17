import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Props = { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; tone?: 'primary' | 'danger' }

/** Toggle with label and description; the whole row is clickable. */
export function Switch({ checked, onChange, label, description, tone = 'primary' }: Props) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
          checked ? (tone === 'danger' ? 'bg-destructive' : 'bg-primary') : 'bg-foreground/15',
        )}
      >
        <span className={cn('size-4 rounded-full bg-white shadow transition-transform duration-200 ease-out', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block font-medium">{label}</span>
        {description && <span id={`${id}-d`} className="block text-[13px] text-muted-foreground">{description}</span>}
      </label>
    </div>
  )
}
