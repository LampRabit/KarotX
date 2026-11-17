import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Database, File, FilePlus2, Folder, HardDrive, House, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, type FsEntry, type FsListing } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'
import { Skeleton } from './ui/Skeleton'

const dbExt = /\.(db|sqlite|sqlite3|db3|s3db|sl3)$/i

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`)

/** Browse folders on the computer running KarotX and pick a file. */
export function FileBrowser({ open, start, onClose, onPick }: { open: boolean; start?: string; onClose: () => void; onPick: (path: string) => void }) {
  const [listing, setListing] = useState<FsListing>()
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string>()
  const [onlyDb, setOnlyDb] = useState(true)
  const [creating, setCreating] = useState<string | null>(null) // file name being typed
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  async function createFile() {
    if (!listing || !creating?.trim()) return
    setCreateBusy(true)
    setCreateError('')
    try {
      const { path: file } = await api.createSqlite(listing.path, creating.trim())
      toast.success('Created a new SQLite database', { description: file })
      setCreating(null)
      onPick(file)
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }

  const go = useCallback(async (p: string) => {
    setLoading(true)
    setError('')
    try {
      const l = await api.fs(p)
      setListing(l)
      setPath(l.path)
      setSelected(undefined)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) (go(start ?? ''), setCreating(null))
  }, [open, start, go])

  const entries = (listing?.entries ?? []).filter((e) => e.dir || !onlyDb || dbExt.test(e.name))

  function activate(e: FsEntry) {
    if (e.dir) go(e.path)
    else onPick(e.path)
  }

  // Arrow keys move through the list; Enter opens a folder or picks a file; Backspace goes up.
  function onKey(ev: React.KeyboardEvent) {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-entry]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      items[Math.max(0, Math.min(items.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    } else if (ev.key === 'Backspace' && listing?.parent && (ev.target as HTMLElement).tagName !== 'INPUT') {
      ev.preventDefault()
      go(listing.parent)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Choose a file" className="max-w-2xl">
      <div className="flex h-[min(620px,85vh)] flex-col" onKeyDown={onKey}>
        <header className="space-y-3 border-b px-5 py-4 pr-14">
          <h2 className="text-[15px] font-semibold">Choose a database file</h2>
          <form onSubmit={(e) => (e.preventDefault(), go(path))} className="flex gap-2">
            <button type="button" onClick={() => listing?.parent && go(listing.parent)} disabled={!listing?.parent} aria-label="Up one folder" className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted disabled:opacity-40"><ArrowUp size={16} /></button>
            <button type="button" onClick={() => go(listing?.home ?? '')} aria-label="Home folder" className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted"><House size={16} /></button>
            <input value={path} onChange={(e) => setPath(e.target.value)} aria-label="Folder path" spellCheck={false}
              className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 font-mono text-[13px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
          </form>
          {listing && listing.roots.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {listing.roots.map((r) => (
                <button key={r} onClick={() => go(r)} className={cn('flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition hover:bg-muted', path.toUpperCase().startsWith(r.toUpperCase()) && 'border-primary/50 bg-primary/5 text-primary')}>
                  <HardDrive size={13} aria-hidden /> {r.replace('\\', '')}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {error ? (
            <p role="alert" className="m-3 rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">{error}</p>
          ) : !listing ? (
            <div className="space-y-1.5 p-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : entries.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-muted-foreground">{onlyDb ? 'No folders or database files here.' : 'This folder is empty.'}</p>
          ) : (
            <ul ref={listRef} className={cn('transition-opacity', loading && 'opacity-50')}>
              {entries.map((e) => {
                const isDb = !e.dir && dbExt.test(e.name)
                const Icon = e.dir ? Folder : isDb ? Database : File
                return (
                  <li key={e.path}>
                    <button
                      data-entry
                      onClick={() => (e.dir ? go(e.path) : setSelected(e.path))}
                      onDoubleClick={() => activate(e)}
                      onKeyDown={(ev) => ev.key === 'Enter' && (ev.preventDefault(), activate(e))}
                      aria-selected={selected === e.path}
                      className={cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition hover:bg-muted', selected === e.path && 'bg-primary/10 text-foreground')}
                    >
                      <Icon size={16} aria-hidden className={cn('shrink-0', e.dir ? 'text-warning' : isDb ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      {!e.dir && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{size(e.size)}</span>}
                      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">{new Date(e.modified).toLocaleDateString()}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {loading && listing && <Loader2 size={18} className="absolute top-3 right-4 animate-spin text-primary" aria-label="Loading" />}
        </div>

        {creating !== null ? (
          <form onSubmit={(e) => (e.preventDefault(), createFile())} className="space-y-2 border-t bg-sidebar/60 px-5 py-3">
            <div className="flex items-center gap-2">
              <FilePlus2 size={16} className="shrink-0 text-primary" aria-hidden />
              <label htmlFor="kx-new-db" className="shrink-0 text-[13px] font-medium">New database in this folder</label>
              <input
                id="kx-new-db"
                autoFocus
                value={creating}
                onChange={(e) => setCreating(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setCreating(null))}
                spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 font-mono text-[13px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
              />
              <Button type="button" variant="ghost" onClick={() => setCreating(null)}>Cancel</Button>
              <Button type="submit" loading={createBusy} disabled={!creating.trim()}>Create</Button>
            </div>
            {createError && <p role="alert" className="text-[13px] text-destructive">{createError}</p>}
          </form>
        ) : (
          <footer className="flex items-center gap-3 border-t bg-sidebar/60 px-5 py-3">
            <Button variant="secondary" size="sm" disabled={!listing} onClick={() => (setCreating('new.db'), setCreateError(''))}>
              <FilePlus2 size={14} aria-hidden /> New database file
            </Button>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={onlyDb} onChange={(e) => setOnlyDb(e.target.checked)} className="accent-[var(--primary)]" />
              Only database files
            </label>
            <span className="ml-auto truncate text-xs text-muted-foreground" title={selected}>{selected ? selected.split(/[\\/]/).pop() : 'Double-click a file to choose it'}</span>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!selected} onClick={() => selected && onPick(selected)}>Choose</Button>
          </footer>
        )}
      </div>
    </Dialog>
  )
}
