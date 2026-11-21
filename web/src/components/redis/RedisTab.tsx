import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Copy, Download, KeyRound, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api, type ConnView, type RedisKey, type RedisKeyData } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { kindOf } from '@/lib/databases'
import { openDialog } from '@/lib/dialogs'
import { useGuard } from '@/lib/guard'
import { useDelayed } from '@/lib/hooks'
import { treeKey, useWorkspace, type Tab } from '@/lib/workspace'
import { BrandIcon } from '../BrandIcon'
import { Button } from '../ui/Button'
import { Confirm } from '../ui/Confirm'
import { Select } from '../ui/Select'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { Tooltip } from '../ui/Tooltip'
import { KeyEditor } from './KeyEditor'
import { NewKeyDialog } from './NewKeyDialog'
import { RedisConsole } from './RedisConsole'

type RTab = Extract<Tab, { kind: 'redis' }>

export const typeStyle: Record<string, { label: string; cls: string }> = {
  string: { label: 'STR', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  hash: { label: 'HASH', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  list: { label: 'LIST', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  set: { label: 'SET', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  zset: { label: 'ZSET', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  stream: { label: 'STREAM', cls: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
}

export function TypeBadge({ type }: { type: string }) {
  const t = typeStyle[type] ?? { label: type.slice(0, 6).toUpperCase(), cls: 'bg-muted text-muted-foreground' }
  return <span className={cn('inline-flex h-5 w-12 shrink-0 items-center justify-center rounded text-[10px] font-semibold tracking-wide', t.cls)}>{t.label}</span>
}

export function ttlText(ms: number) {
  if (ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/** Plain text becomes a "contains" search; text with glob characters is used as-is. */
const toPattern = (q: string) => (!q.trim() ? '*' : /[*?[\]]/.test(q) ? q.trim() : `*${q.trim()}*`)

const typeOptions = [
  { value: '', label: 'All types' },
  ...Object.entries(typeStyle).map(([value, t]) => ({ value, label: `${t.label.charAt(0)}${t.label.slice(1).toLowerCase()}`, hint: value })),
]

export function RedisTab({ tab, conn }: { tab: RTab; conn: ConnView }) {
  const { updateTab, loadTree } = useWorkspace()
  const dbNodes = useWorkspace((s) => s.trees[treeKey(conn.id, [])]?.nodes ?? [])
  const db = tab.db
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [keys, setKeys] = useState<RedisKey[]>()
  const [cursor, setCursor] = useState('0')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState<number>()
  const [selected, setSelected] = useState<string>()
  const [newKey, setNewKey] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string>()
  const listRef = useRef<HTMLUListElement>(null)
  const showSpinner = useDelayed(loading, 150)
  const { guard, dialog } = useGuard(conn.name)

  useEffect(() => void loadTree(conn.id, []), [conn.id, loadTree])
  // Keep the sidebar's "N keys" in step with writes made here.
  const nodeDetail = dbNodes.find((n) => n.path[0] === String(db))?.detail
  useEffect(() => {
    if (total !== undefined && nodeDetail !== undefined && nodeDetail !== `${total} key${total === 1 ? '' : 's'}`) void loadTree(conn.id, [], true)
  }, [total, nodeDetail, conn.id, loadTree])

  const load = useCallback(async (more = false) => {
    setLoading(true)
    setError('')
    try {
      const page = await track('Scanning keys', api.redis.keys(conn.id, db, toPattern(query), more ? cursor : '0', type))
      setKeys((k) => (more ? [...(k ?? []), ...page.keys] : page.keys))
      setCursor(page.cursor)
      api.redis.dbsize(conn.id, db).then((r) => setTotal(r.keys)).catch(() => {})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [conn.id, db, query, type, cursor])

  // Search as you type (debounced); changing db/type reloads, and so do imports (schema version).
  const version = useWorkspace((s) => s.schemaVersion[conn.id] ?? 0)
  useEffect(() => {
    const t = setTimeout(() => load(false), 250)
    return () => clearTimeout(t)
  }, [conn.id, db, query, type, version]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs one command through the read-only/production guards; refreshes after writes. */
  const run = useCallback(async (args: string[], label: string) => {
    try {
      const r = await guard((confirmed) => track(label, api.redis.command(conn.id, db, { args }, confirmed)))
      return r !== undefined
    } catch (e) {
      toast.error(`Couldn't ${label.toLowerCase()}`, { description: (e as Error).message })
      return false
    }
  }, [conn.id, db, guard])

  async function deleteKey(key: string) {
    if (await run(['DEL', key], 'Delete key')) {
      toast.success(`Deleted ${key}`)
      setKeys((k) => k?.filter((x) => x.key !== key))
      if (selected === key) setSelected(undefined)
      setTotal((t) => (t ? t - 1 : t))
    }
  }

  function onListKey(e: React.KeyboardEvent) {
    if (!keys?.length) return
    const i = keys.findIndex((k) => k.key === selected)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = keys[Math.max(0, Math.min(keys.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      setSelected(next.key)
      listRef.current?.querySelector(`[data-key="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Delete' && selected && !conn.readOnly) {
      setConfirmDelete(selected)
    }
  }

  const dbOptions = Array.from({ length: 16 }, (_, n) => {
    const node = dbNodes.find((x) => x.path[0] === String(n))
    return { value: String(n), label: `db${n}`, hint: node?.detail ?? '' }
  })

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <BrandIcon db={kindOf(conn)} size={28} />
        <div className="w-24 shrink-0">
          <Select variant="token" label="Database" value={String(db)} options={dbOptions}
            onChange={(v) => (updateTab(tab.id, { db: Number(v), title: `${conn.name} · db${v}` } as Partial<Tab>), setSelected(undefined))} />
        </div>
        <label className="relative min-w-40 max-w-md flex-1">
          <span className="sr-only">Search keys</span>
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search keys, e.g. user or user:*:profile"
            onKeyDown={(e) => e.key === 'ArrowDown' && keys?.[0] && (e.preventDefault(), setSelected(keys[0].key), listRef.current?.focus())}
            className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 font-mono text-[12.5px] outline-none transition focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
        </label>
        <div className="w-32 shrink-0"><Select variant="token" label="Key type" value={type} options={typeOptions} onChange={setType} /></div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="hidden text-xs text-muted-foreground tabular-nums md:inline">{total !== undefined && `${total.toLocaleString()} keys`}</span>
          <Tooltip content="Reload keys">
            <button onClick={() => load(false)} aria-label="Reload keys" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
              {showSpinner ? <Spinner size={15} className="text-primary" /> : <RefreshCw size={15} />}
            </button>
          </Tooltip>
          <Tooltip content={query || type ? 'Export the matching keys' : 'Export keys'}>
            <button onClick={() => openDialog({ kind: 'export', target: { kind: 'redis', connId: conn.id, db, pattern: toPattern(query), type } })} aria-label="Export keys" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <Download size={15} />
            </button>
          </Tooltip>
          {!conn.readOnly && (
            <Tooltip content="Import keys">
              <button onClick={() => openDialog({ kind: 'import', target: { kind: 'redis', connId: conn.id, db } })} aria-label="Import keys" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <Upload size={15} />
              </button>
            </Tooltip>
          )}
          {!conn.readOnly && <Button size="sm" onClick={() => setNewKey(true)}><Plus size={14} aria-hidden /> New key</Button>}
        </div>
      </div>

      {/* Keys | editor */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[min(380px,40%)] shrink-0 flex-col border-r">
          {error ? (
            <p role="alert" className="m-3 rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>
          ) : !keys ? (
            <div className="space-y-1.5 p-2" role="status" aria-label="Loading keys">{[...Array(12)].map((_, i) => <Skeleton key={i} className="h-7" />)}</div>
          ) : keys.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <KeyRound size={22} aria-hidden />
              <p className="text-[13px]">{query || type ? 'No keys match.' : `db${db} is empty.`}</p>
              {!conn.readOnly && !query && <Button size="sm" variant="secondary" onClick={() => setNewKey(true)}><Plus size={13} aria-hidden /> Add a key</Button>}
            </div>
          ) : (
            <ul ref={listRef} role="listbox" aria-label="Keys" tabIndex={0} onKeyDown={onListKey}
              onScroll={(e) => {
                const el = e.currentTarget
                if (!loading && cursor !== '0' && el.scrollTop + el.clientHeight > el.scrollHeight - 80) load(true)
              }}
              className="min-h-0 flex-1 overflow-y-auto p-1.5 outline-none">
              {keys.map((k) => (
                <li key={k.key} data-key={k.key} role="option" aria-selected={selected === k.key}
                  onClick={() => setSelected(k.key)}
                  className={cn('group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-[13px]', selected === k.key ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}>
                  <TypeBadge type={k.type} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={k.key}>{k.key}</span>
                  {k.ttl >= 0 && <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground" title="Expires in"><Clock size={11} aria-hidden />{ttlText(k.ttl)}</span>}
                </li>
              ))}
              {cursor !== '0' && (
                <li className="p-1.5"><Button size="sm" variant="ghost" className="w-full" loading={loading} onClick={() => load(true)}>Load more</Button></li>
              )}
            </ul>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <KeyEditor key={`${db}:${selected}`} conn={conn} db={db} keyName={selected} run={run}
              onDeleted={() => deleteKey(selected)} onRenamed={(to) => { setSelected(to); load(false) }} onChanged={() => load(false)} askDelete={() => setConfirmDelete(selected)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <KeyRound size={26} aria-hidden />
              <p>Pick a key on the left to see and edit it.</p>
              <p className="text-xs">↑ ↓ to move · Delete to remove</p>
            </div>
          )}
        </div>
      </div>

      <RedisConsole conn={conn} db={db} onWrite={() => load(false)} />

      <NewKeyDialog connId={conn.id} db={db} open={newKey} onClose={() => setNewKey(false)} run={run} onCreated={(k) => { setNewKey(false); setSelected(k); load(false) }} />
      <Confirm open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(undefined)} title={`Delete ${confirmDelete}?`} confirmLabel="Delete key" danger
        onConfirm={() => deleteKey(confirmDelete!)}>
        The key and its value are removed permanently.
      </Confirm>
      {dialog}
    </div>
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Tooltip content={label}>
      <button aria-label={label} onClick={() => navigator.clipboard.writeText(text).then(() => toast.success('Copied', { duration: 1200 }))}
        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
        <Copy size={14} />
      </button>
    </Tooltip>
  )
}

export function DeleteButton({ onClick, label = 'Delete key' }: { onClick: () => void; label?: string }) {
  return (
    <Tooltip content={label}>
      <button aria-label={label} onClick={onClick} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
        <Trash2 size={14} />
      </button>
    </Tooltip>
  )
}

export type RunCommand = (args: string[], label: string) => Promise<boolean>
export type { RedisKeyData }
