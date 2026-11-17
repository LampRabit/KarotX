import { Monitor, Moon, Sun } from 'lucide-react'
import type { Mode } from '@/themes'
import { cn } from '@/lib/cn'

const options = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const

export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="radiogroup" aria-label="Color mode" className="flex rounded-md border bg-surface p-0.5">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={mode === value}
          title={label}
          onClick={() => onChange(value)}
          className={cn(
            'flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-xs transition',
            mode === value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon size={14} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}
