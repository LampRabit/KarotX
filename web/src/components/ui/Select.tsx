import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Popover, PopoverContent, PopoverTrigger } from './Popover'

export type Option<T extends string = string> = { value: T; label: string; hint?: string; group?: string; icon?: ReactNode }

type Props<T extends string> = {
  value?: T
  onChange: (v: T) => void
  options: Option<T>[]
  placeholder?: string
  label: string // accessible name
  className?: string
  /** Show a search box (defaults to on for more than 8 options). */
  searchable?: boolean
  /** Render as a compact inline token (used inside builder sentences). */
  variant?: 'field' | 'token'
  autoOpen?: boolean
}

/**
 * Searchable single-choice picker. Keyboard: type to filter, ↑/↓ to move,
 * Enter to choose, Esc to close.
 */
export function Select<T extends string>({ value, onChange, options, placeholder = 'Choose…', label, className, searchable, variant = 'field', autoOpen }: Props<T>) {
  const [open, setOpen] = useState(!!autoOpen)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)
  const withSearch = searchable ?? options.length > 8

  const shown = useMemo(() => {
    const ql = query.trim().toLowerCase()
    return ql ? options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(ql)) : options
  }, [options, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(Math.max(0, options.findIndex((o) => o.value === value)))
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function pick(o?: Option<T>) {
    if (!o) return
    onChange(o.value)
    setOpen(false)
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(shown.length - 1, i + 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)))
    else if (e.key === 'Enter') (e.preventDefault(), pick(shown[index]))
  }

  let lastGroup: string | undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 text-left transition outline-none focus-visible:ring-3 focus-visible:ring-primary/25',
          variant === 'field'
            ? 'h-9 w-full rounded-lg border bg-background px-2.5 text-[13px] hover:border-foreground/25'
            : 'h-7 rounded-md bg-muted px-2 text-[13px] font-medium hover:bg-accent hover:text-accent-foreground',
          !current && 'text-muted-foreground',
          className,
        )}
      >
        {current?.icon && <span className="shrink-0 text-muted-foreground [&>svg]:size-3.5">{current.icon}</span>}
        <span className="min-w-0 flex-1 truncate">{current ? current.label : placeholder}</span>
        <ChevronDown size={13} className="shrink-0 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5">
        <div onKeyDown={onKey}>
          {withSearch && (
            <div className="relative mb-1">
              <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label={`Search ${label}`}
                className="h-8 w-full rounded-md bg-muted/70 pr-2 pl-8 text-[13px] outline-none" />
            </div>
          )}
          <div ref={listRef} role="listbox" aria-label={label} tabIndex={withSearch ? -1 : 0} autoFocus={!withSearch} className="max-h-64 overflow-y-auto outline-none">
            {shown.length === 0 && <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">No matches</p>}
            {shown.map((o, i) => {
              const header = o.group && o.group !== lastGroup
              lastGroup = o.group
              return (
                <div key={o.value}>
                  {header && <p className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{o.group}</p>}
                  <button
                    type="button"
                    role="option"
                    data-i={i}
                    aria-selected={o.value === value}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => pick(o)}
                    className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]', i === index && 'bg-accent text-accent-foreground')}
                  >
                    {o.icon && <span className="shrink-0 text-muted-foreground [&>svg]:size-3.5" aria-hidden>{o.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 truncate font-mono text-[11px] text-muted-foreground">{o.hint}</span>}
                    {o.value === value && <Check size={13} className="shrink-0 text-primary" aria-hidden />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
