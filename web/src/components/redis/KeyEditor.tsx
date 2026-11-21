import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Clock, Pencil, Plus, RefreshCw, Trash2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, type ConnView, type RedisKeyData, type StreamEntry, type ZMember } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { Button } from '../ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover'
import { Skeleton } from '../ui/Skeleton'
import { Tooltip } from '../ui/Tooltip'
import { CopyButton, DeleteButton, TypeBadge, type RunCommand } from './RedisTab'

type Props = {
  conn: ConnView
  db: number
  keyName: string
  run: RunCommand
  onDeleted: () => void
  onRenamed: (to: string) => void
  onChanged: () => void
  askDelete: () => void
}

const field = 'h-8 min-w-0 rounded-md border bg-background px-2 font-mono text-[12.5px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'

function useCountdown(ttl: number, loadedAt: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (ttl < 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ttl])
  if (ttl < 0) return -1
  return Math.max(0, ttl - (now - loadedAt))
}

function fmtRemaining(ms: number) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(' ')
}

/** Shows a key's value with an editor that fits its type. */
export function KeyEditor({ conn, db, keyName, run, onRenamed, onChanged, askDelete }: Props) {
  const [data, setData] = useState<RedisKeyData>()
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(Date.now())
  const [renaming, setRenaming] = useState<string>()
  const ro = conn.readOnly || !!data?.binary

  const load = useCallback(async () => {
    setError('')
    try {
      const d = await track('Reading key', api.redis.key(conn.id, db, keyName))
      setData(d)
      setLoadedAt(Date.now())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [conn.id, db, keyName])

  useEffect(() => void load(), [load])
  const remaining = useCountdown(data?.ttl ?? -1, loadedAt)

  /** Runs a command, then re-reads the key. */
  const exec = async (args: string[], label: string) => {
    const ok = await run(args, label)
    if (ok) {
      await load()
      onChanged()
    }
    return ok
  }

  async function rename() {
    const to = renaming?.trim()
    setRenaming(undefined)
    if (!to || to === keyName) return
    if (await run(['RENAME', keyName, to], 'Rename key')) {
      toast.success(`Renamed to ${to}`)
      onRenamed(to)
    }
  }

  if (error) return <p role="alert" className="m-4 rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>
  if (!data) return <div className="space-y-2 p-4" role="status" aria-label="Loading key">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7" />)}</div>

  const unit = data.type === 'string' ? 'byte' : data.type === 'hash' ? 'field' : data.type === 'stream' ? 'entr' : 'item'
  const items = `${data.length.toLocaleString()} ${unit}${unit === 'entr' ? (data.length === 1 ? 'y' : 'ies') : data.length === 1 ? '' : 's'}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <TypeBadge type={data.type} />
        {renaming !== undefined ? (
          <form onSubmit={(e) => (e.preventDefault(), rename())} className="flex min-w-0 flex-1 items-center gap-1">
            <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(undefined)}
              aria-label="New key name" className={cn(field, 'h-8 flex-1')} />
            <Button size="sm" type="submit">Rename</Button>
          </form>
        ) : (
          <button onClick={() => !conn.readOnly && setRenaming(keyName)} disabled={conn.readOnly} title={conn.readOnly ? keyName : 'Click to rename'}
            className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 text-left font-mono text-[14px] font-semibold hover:bg-muted disabled:hover:bg-transparent">
            <span className="truncate">{keyName}</span>
            {!conn.readOnly && <Pencil size={12} className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden />}
          </button>
        )}
        <span className="text-xs text-muted-foreground">{items}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <TtlControl remaining={remaining} disabled={conn.readOnly}
            onSet={(sec) => exec(['EXPIRE', keyName, String(sec)], 'Set expiry')} onPersist={() => exec(['PERSIST', keyName], 'Remove expiry')} />
          <CopyButton text={keyName} label="Copy key name" />
          <Tooltip content="Reload"><button aria-label="Reload key" onClick={load} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"><RefreshCw size={14} /></button></Tooltip>
          {!conn.readOnly && <DeleteButton onClick={askDelete} />}
        </div>
      </div>

      {data.binary && <p className="mx-4 mt-3 rounded-lg bg-warning/10 p-2.5 text-[13px]">This value contains binary data, so it's shown read-only. Use the console below to work with it.</p>}
      {data.truncated && <p className="mx-4 mt-3 rounded-lg bg-muted p-2.5 text-[13px] text-muted-foreground">Showing the first part of a large value ({items} in total). Use the console for the rest.</p>}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {data.type === 'string' && <StringEditor value={data.value as string} readOnly={ro} onSave={(v) => exec(['SET', keyName, v, 'KEEPTTL'], 'Save value')} />}
        {data.type === 'hash' && (
          <Rows readOnly={ro} cols={['Field', 'Value']} rows={(data.value as [string, string][]).map(([f, v]) => ({ id: f, cells: [f, v], edit: 1 }))}
            onEdit={(r, v) => exec(['HSET', keyName, r.id, v], 'Save field')} onDelete={(r) => exec(['HDEL', keyName, r.id], 'Delete field')}
            add={{ fields: ['Field', 'Value'], label: 'Add field', run: ([f, v]) => exec(['HSET', keyName, f, v], 'Add field') }} />
        )}
        {data.type === 'list' && (
          <Rows readOnly={ro} cols={['#', 'Value']} rows={(data.value as string[]).map((v, i) => ({ id: String(i), cells: [String(i), v], edit: 1 }))}
            onEdit={(r, v) => exec(['LSET', keyName, r.id, v], 'Save item')}
            onDelete={async (r) => {
              // Lists delete by value: mark the index with a unique value, then remove that value once.
              const mark = `__karotx_delete_${Date.now()}__`
              if (await run(['LSET', keyName, r.id, mark], 'Delete item')) await exec(['LREM', keyName, '1', mark], 'Delete item')
            }}
            add={{ fields: ['Value'], label: 'Append', alt: { label: 'Prepend', run: ([v]) => exec(['LPUSH', keyName, v], 'Prepend item') }, run: ([v]) => exec(['RPUSH', keyName, v], 'Append item') }} />
        )}
        {data.type === 'set' && (
          <Rows readOnly={ro} cols={['Member']} rows={(data.value as string[]).map((m) => ({ id: m, cells: [m] }))}
            onDelete={(r) => exec(['SREM', keyName, r.id], 'Remove member')}
            add={{ fields: ['Member'], label: 'Add member', run: ([m]) => exec(['SADD', keyName, m], 'Add member') }} />
        )}
        {data.type === 'zset' && (
          <Rows readOnly={ro} cols={['Member', 'Score']} rows={(data.value as ZMember[]).map((z) => ({ id: z.member, cells: [z.member, String(z.score)], edit: 1, numeric: true }))}
            onEdit={(r, v) => exec(['ZADD', keyName, v, r.id], 'Save score')} onDelete={(r) => exec(['ZREM', keyName, r.id], 'Remove member')}
            add={{ fields: ['Member', 'Score'], label: 'Add member', run: ([m, s]) => exec(['ZADD', keyName, s || '0', m], 'Add member') }} />
        )}
        {data.type === 'stream' && (
          <Rows readOnly={ro} cols={['Entry ID', 'Fields']}
            rows={(data.value as StreamEntry[]).map((e) => ({ id: e.id, cells: [e.id, Object.entries(e.fields).map(([k, v]) => `${k}=${v}`).join('  ')] }))}
            onDelete={(r) => exec(['XDEL', keyName, r.id], 'Delete entry')}
            add={{ fields: ['Field', 'Value'], label: 'Add entry', run: ([f, v]) => exec(['XADD', keyName, '*', f, v], 'Add entry') }} />
        )}
        {!['string', 'hash', 'list', 'set', 'zset', 'stream'].includes(data.type) && (
          <p className="text-[13px] text-muted-foreground">“{data.type}” values (from a Redis module) aren't shown here yet. Use the console below.</p>
        )}
      </div>
    </div>
  )
}

function TtlControl({ remaining, disabled, onSet, onPersist }: { remaining: number; disabled?: boolean; onSet: (sec: number) => void; onPersist: () => void }) {
  const [open, setOpen] = useState(false)
  const [sec, setSec] = useState('3600')
  const presets: [string, number][] = [['1 minute', 60], ['1 hour', 3600], ['1 day', 86400], ['1 week', 604800]]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} className={cn('flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition hover:bg-muted disabled:hover:bg-transparent', remaining >= 0 ? 'text-warning' : 'text-muted-foreground')}>
        <Clock size={13} aria-hidden /> {remaining >= 0 ? `Expires in ${fmtRemaining(remaining)}` : 'No expiry'}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2.5">
        <p className="text-[13px] font-medium">Expire this key after…</p>
        <div className="flex flex-wrap gap-1">
          {presets.map(([label, s]) => (
            <button key={s} onClick={() => (onSet(s), setOpen(false))} className="h-7 rounded-md bg-muted px-2 text-xs hover:bg-accent hover:text-accent-foreground">{label}</button>
          ))}
        </div>
        <form onSubmit={(e) => (e.preventDefault(), Number(sec) > 0 && (onSet(Number(sec)), setOpen(false)))} className="flex items-center gap-1.5">
          <input value={sec} onChange={(e) => setSec(e.target.value.replace(/\D/g, ''))} aria-label="Seconds" className={cn(field, 'w-24')} />
          <span className="text-xs text-muted-foreground">seconds</span>
          <Button size="sm" type="submit" className="ml-auto">Set</Button>
        </form>
        {remaining >= 0 && <Button size="sm" variant="secondary" className="w-full" onClick={() => (onPersist(), setOpen(false))}>Remove expiry (keep forever)</Button>}
      </PopoverContent>
    </Popover>
  )
}

function StringEditor({ value, readOnly, onSave }: { value: string; readOnly: boolean; onSave: (v: string) => Promise<boolean> }) {
  const [text, setText] = useState(value)
  const [busy, setBusy] = useState(false)
  useEffect(() => setText(value), [value])
  const json = useMemo(() => {
    try {
      const v = JSON.parse(text)
      return typeof v === 'object' && v !== null
    } catch {
      return false
    }
  }, [text])
  const dirty = text !== value
  return (
    <div className="flex h-full min-h-48 flex-col gap-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={readOnly} spellCheck={false} aria-label="Value"
        onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 's' && (e.preventDefault(), dirty && !readOnly && onSave(text))}
        className="min-h-40 flex-1 resize-none rounded-lg border bg-background p-3 font-mono text-[13px] leading-relaxed outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
      <div className="flex items-center gap-2">
        {json && <Button size="sm" variant="ghost" onClick={() => setText(JSON.stringify(JSON.parse(text), null, 2))}><Wand2 size={13} aria-hidden /> Format JSON</Button>}
        <span className="text-xs text-muted-foreground">{json ? 'JSON' : 'Text'} · {text.length.toLocaleString()} characters</span>
        {!readOnly && (
          <div className="ml-auto flex gap-2">
            {dirty && <Button size="sm" variant="ghost" onClick={() => setText(value)}>Discard</Button>}
            <Button size="sm" disabled={!dirty} loading={busy} onClick={async () => { setBusy(true); try { await onSave(text) } finally { setBusy(false) } }}>Save (Ctrl S)</Button>
          </div>
        )}
      </div>
    </div>
  )
}

type Row = { id: string; cells: string[]; edit?: number; numeric?: boolean }

/** A simple editable table for hash/list/set/zset/stream items, with an "add" form. */
function Rows({ cols, rows, readOnly, onEdit, onDelete, add }: {
  cols: string[]
  rows: Row[]
  readOnly: boolean
  onEdit?: (r: Row, value: string) => Promise<boolean>
  onDelete: (r: Row) => Promise<unknown>
  add: { fields: string[]; label: string; run: (values: string[]) => Promise<boolean>; alt?: { label: string; run: (values: string[]) => Promise<boolean> } }
}) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{ id: string; value: string }>()
  const [values, setValues] = useState<string[]>(add.fields.map(() => ''))
  const shown = filter ? rows.filter((r) => r.cells.some((c) => c.toLowerCase().includes(filter.toLowerCase()))) : rows

  async function submit(runner: (v: string[]) => Promise<boolean>) {
    if (!values[0].trim() && add.fields[0] !== 'Value') return
    if (await runner(values)) setValues(add.fields.map(() => ''))
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <form onSubmit={(e) => (e.preventDefault(), submit(add.run))} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed p-2">
          {add.fields.map((f, i) => (
            <input key={f} value={values[i]} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))} placeholder={f} aria-label={f}
              className={cn(field, f === 'Score' ? 'w-24' : 'min-w-28 flex-1')} />
          ))}
          <Button size="sm" type="submit"><Plus size={13} aria-hidden /> {add.label}</Button>
          {add.alt && <Button size="sm" type="button" variant="secondary" onClick={() => submit(add.alt!.run)}>{add.alt.label}</Button>}
        </form>
      )}
      {rows.length > 15 && (
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${rows.length} items…`} aria-label="Filter items" className={cn(field, 'w-full')} />
      )}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full table-fixed text-left text-[13px]">
          <thead className="bg-sidebar text-xs text-muted-foreground">
            <tr>
              {cols.map((c, i) => <th key={c} className={cn('px-3 py-2 font-medium', i === 0 && cols.length > 1 && (c === '#' ? 'w-14' : 'w-[38%]'))}>{c}</th>)}
              {!readOnly && <th className="w-20" />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={cols.length + 1} className="px-3 py-6 text-center text-muted-foreground">{filter ? 'No matches' : 'Empty'}</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="group border-t align-top hover:bg-muted/40">
                {r.cells.map((c, i) => (
                  <td key={i} className="px-3 py-1.5 font-mono text-[12.5px] break-all">
                    {editing?.id === r.id && i === r.edit ? (
                      <form onSubmit={async (e) => { e.preventDefault(); if (await onEdit!(r, editing.value)) setEditing(undefined) }} className="flex gap-1">
                        <input autoFocus value={editing.value} onChange={(e) => setEditing({ id: r.id, value: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditing(undefined)}
                          aria-label="New value" inputMode={r.numeric ? 'decimal' : undefined} className={cn(field, 'flex-1')} />
                        <button type="submit" aria-label="Save" className="flex size-8 items-center justify-center rounded-md text-success hover:bg-muted"><Check size={14} /></button>
                        <button type="button" aria-label="Cancel" onClick={() => setEditing(undefined)} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X size={14} /></button>
                      </form>
                    ) : (
                      <span className={cn(i === 0 && cols[0] === '#' && 'text-muted-foreground')} onDoubleClick={() => !readOnly && r.edit === i && setEditing({ id: r.id, value: c })}>{c}</span>
                    )}
                  </td>
                ))}
                {!readOnly && (
                  <td className="px-1 py-1 text-right">
                    <span className="inline-flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      {r.edit !== undefined && onEdit && <IconBtn label="Edit" onClick={() => setEditing({ id: r.id, value: r.cells[r.edit!] })}><Pencil size={13} /></IconBtn>}
                      <IconBtn label="Delete" danger onClick={() => onDelete(r)}><Trash2 size={13} /></IconBtn>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function IconBtn({ children, label, onClick, danger }: { children: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cn('flex size-7 items-center justify-center rounded-md text-muted-foreground transition', danger ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-muted hover:text-foreground')}>
      {children}
    </button>
  )
}
