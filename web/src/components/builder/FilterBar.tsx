import { useState } from 'react'
import { Filter as FilterIcon, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { newId } from '@/lib/api'
import { categoryOf, filterReady, ops, opsFor, type ColRef, type Filter, type Op } from '@/lib/commander'
import { cn } from '@/lib/cn'
import { Button } from '../ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover'
import { Select, type Option } from '../ui/Select'

export type Field = { ref: ColRef; type: string; label: string; group?: string }

const keyOf = (c: ColRef) => `${c.table}.${c.column}`

/** Text shown on a chip, e.g. "status is paid". */
function chipText(f: Filter, fields: Field[]) {
  const field = fields.find((x) => keyOf(x.ref) === keyOf(f.col))
  const name = field?.label ?? f.col.column
  const op = ops[f.op]
  if (op.values === 0) return { name, op: op.label, value: '' }
  if (op.values === 2) return { name, op: op.label, value: `${f.value || '…'} and ${f.value2 || '…'}` }
  return { name, op: op.label, value: f.value || '…' }
}

export const defaultOp = (type: string): Op => {
  const c = categoryOf(type)
  return c === 'text' ? 'contains' : c === 'bool' ? 'true' : 'eq'
}

function FilterEditor({ filter, fields, onChange, onRemove, onDone }: {
  filter: Filter; fields: Field[]; onChange: (f: Filter) => void; onRemove: () => void; onDone: () => void
}) {
  const field = fields.find((x) => keyOf(x.ref) === keyOf(filter.col))
  const cat = categoryOf(field?.type ?? 'text')
  const op = ops[filter.op]
  const inputType = cat === 'number' ? 'text' : cat === 'date' ? (field?.type.toLowerCase().includes('time') ? 'datetime-local' : 'date') : 'text'
  const fieldOptions: Option[] = fields.map((x) => ({ value: keyOf(x.ref), label: x.label, hint: x.type, group: x.group }))
  const opOptions: Option<Op>[] = opsFor(cat).map((o) => ({ value: o, label: ops[o].label }))
  const input = 'h-9 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'

  return (
    <form onSubmit={(e) => (e.preventDefault(), onDone())} className="w-72 space-y-2.5">
      <Select label="Column" value={keyOf(filter.col)} options={fieldOptions} searchable
        onChange={(k) => {
          const f = fields.find((x) => keyOf(x.ref) === k)!
          const keepOp = opsFor(categoryOf(f.type)).includes(filter.op)
          onChange({ ...filter, col: f.ref, op: keepOp ? filter.op : defaultOp(f.type) })
        }} />
      <Select label="Condition" value={filter.op} options={opOptions} onChange={(o) => onChange({ ...filter, op: o })} />
      {op.values >= 1 && (
        <input autoFocus type={inputType} value={filter.value} onChange={(e) => onChange({ ...filter, value: e.target.value })}
          placeholder={filter.op === 'in' ? 'Values, separated by commas' : cat === 'number' ? 'Number' : 'Value'} aria-label="Value" className={input} />
      )}
      {op.values === 2 && (
        <input type={inputType} value={filter.value2 ?? ''} onChange={(e) => onChange({ ...filter, value2: e.target.value })}
          placeholder="and…" aria-label="Second value" className={input} />
      )}
      <div className="flex items-center justify-between pt-0.5">
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}><Trash2 size={13} aria-hidden /> Remove</Button>
        <Button type="submit" size="sm" disabled={!filterReady(filter)}>Done</Button>
      </div>
    </form>
  )
}

type Props = {
  fields: Field[]
  filters: Filter[]
  match: 'all' | 'any'
  onChange: (filters: Filter[], match: 'all' | 'any') => void
  /** Smaller chips for toolbars. */
  dense?: boolean
  addLabel?: string
}

/**
 * Visual filters as chips ("status contains paid"). Click a chip to edit it;
 * "+ Filter" picks a column first, then asks for the value.
 */
export function FilterBar({ fields, filters, match, onChange, dense, addLabel = 'Filter' }: Props) {
  const [editing, setEditing] = useState<string>()
  const [picking, setPicking] = useState(false)

  const update = (f: Filter) => onChange(filters.map((x) => (x.id === f.id ? f : x)), match)
  const remove = (id: string) => (onChange(filters.filter((x) => x.id !== id), match), setEditing(undefined))
  const add = (k: string) => {
    const field = fields.find((x) => keyOf(x.ref) === k)!
    const f: Filter = { id: newId(), col: field.ref, op: defaultOp(field.type), value: '' }
    onChange([...filters, f], match)
    setPicking(false)
    setEditing(f.id)
  }
  // Closing an editor on a filter that still has no value removes it.
  const close = (f: Filter) => {
    setEditing(undefined)
    if (!filterReady(f)) remove(f.id)
  }

  const h = dense ? 'h-7' : 'h-8'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
      {filters.length > 1 && (
        <button type="button" onClick={() => onChange(filters, match === 'all' ? 'any' : 'all')}
          title="Rows must match all filters, or any one of them"
          className={cn(h, 'rounded-md px-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground')}>
          Match <span className="text-foreground">{match}</span>
        </button>
      )}
      <AnimatePresence initial={false}>
        {filters.map((f) => {
          const t = chipText(f, fields)
          const ready = filterReady(f)
          return (
            <motion.span key={f.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className={cn(h, 'inline-flex max-w-72 items-center rounded-lg border text-[13px] transition', ready ? 'border-primary/30 bg-primary/[0.07]' : 'border-dashed border-foreground/30')}>
              <Popover open={editing === f.id} onOpenChange={(o) => (o ? setEditing(f.id) : close(f))}>
                <PopoverTrigger className="flex h-full min-w-0 items-center gap-1 rounded-l-lg pr-1 pl-2 outline-none focus-visible:ring-3 focus-visible:ring-primary/25" aria-label={`Edit filter: ${t.name} ${t.op} ${t.value}`}>
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="shrink-0 text-muted-foreground">{t.op}</span>
                  {t.value && <span className="truncate font-medium text-primary">{t.value}</span>}
                </PopoverTrigger>
                <PopoverContent>
                  <FilterEditor filter={f} fields={fields} onChange={update} onRemove={() => remove(f.id)} onDone={() => close(f)} />
                </PopoverContent>
              </Popover>
              <button type="button" onClick={() => remove(f.id)} aria-label={`Remove filter ${t.name}`}
                className="mr-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                <X size={12} />
              </button>
            </motion.span>
          )
        })}
      </AnimatePresence>
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger className={cn(h, 'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 text-[13px] text-muted-foreground transition outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-primary/25')}
          data-add-filter>
          {filters.length ? <Plus size={13} aria-hidden /> : <FilterIcon size={13} aria-hidden />}
          {filters.length ? '' : addLabel}
          <span className="sr-only">Add filter</span>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-1.5">
          <ColumnList fields={fields} onPick={add} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Searchable column list used to start a new filter. */
function ColumnList({ fields, onPick }: { fields: Field[]; onPick: (key: string) => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const shown = fields.filter((f) => `${f.label} ${f.group ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  let lastGroup: string | undefined
  return (
    <div onKeyDown={(e) => {
      if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(shown.length - 1, i + 1)))
      else if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)))
      else if (e.key === 'Enter' && shown[index]) (e.preventDefault(), onPick(keyOf(shown[index].ref)))
    }}>
      <input autoFocus value={query} onChange={(e) => (setQuery(e.target.value), setIndex(0))} placeholder="Filter by column…" aria-label="Find a column"
        className="mb-1 h-8 w-full rounded-md bg-muted/70 px-2.5 text-[13px] outline-none" />
      <div role="listbox" aria-label="Columns" className="max-h-64 overflow-y-auto">
        {shown.length === 0 && <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">No matching columns</p>}
        {shown.map((f, i) => {
          const header = f.group && f.group !== lastGroup
          lastGroup = f.group
          return (
            <div key={keyOf(f.ref)}>
              {header && <p className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{f.group}</p>}
              <button type="button" role="option" aria-selected={i === index} onMouseMove={() => setIndex(i)} onClick={() => onPick(keyOf(f.ref))}
                className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]', i === index && 'bg-accent text-accent-foreground')}>
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{f.type}</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
