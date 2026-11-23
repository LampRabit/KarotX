import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { api, ApiError, type ConnView } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { useGuard } from '@/lib/guard'

type Entry = { cmd: string; out?: unknown; error?: string }

function format(v: unknown, indent = ''): string {
  if (v === null || v === undefined) return '(nil)'
  if (Array.isArray(v)) return v.length === 0 ? '(empty list)' : v.map((x, i) => `${indent}${i + 1}) ${format(x, indent + '   ').trimStart()}`).join('\n')
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  if (typeof v === 'number') return `(integer) ${v}`
  return typeof v === 'string' ? `"${v}"` : String(v)
}

/**
 * Redis command console: the second choice next to the key browser. Enter
 * runs, ↑/↓ walk through history. Writes still pass the read-only and
 * production guards.
 */
export function RedisConsole({ conn, db, onWrite }: { conn: ConnView; db: number; onWrite: () => void }) {
  const [open, setOpen] = useState(false)
  const [line, setLine] = useState('')
  const [log, setLog] = useState<Entry[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [pos, setPos] = useState(-1)
  const [busy, setBusy] = useState(false)
  const outRef = useRef<HTMLDivElement>(null)
  const { guard, dialog } = useGuard(conn.name)

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight })
  }, [log, open])

  async function run() {
    const cmd = line.trim()
    if (!cmd || busy) return
    setOpen(true)
    setBusy(true)
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 100))
    setPos(-1)
    setLine('')
    try {
      const r = await guard((confirmed) => track('Running command', api.redis.command(conn.id, db, { line: cmd }, confirmed)))
      if (r === undefined) setLog((l) => [...l, { cmd, error: 'Cancelled' }])
      else {
        setLog((l) => [...l, { cmd, out: r.result }])
        onWrite()
      }
    } catch (e) {
      setLog((l) => [...l, { cmd, error: (e as ApiError).message }])
    } finally {
      setBusy(false)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const p = Math.min(history.length - 1, pos + 1)
      setPos(p)
      setLine(history[p])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const p = pos - 1
      setPos(p)
      setLine(p >= 0 ? history[p] : '')
    }
  }

  return (
    <div className="shrink-0 border-t bg-sidebar/50">
      {open && (
        <div ref={outRef} className="max-h-56 overflow-y-auto border-b px-4 py-2 font-mono text-[12.5px]" aria-live="polite">
          {log.length === 0 && (conn.driver === 'memcached'
            ? <p className="text-muted-foreground">Run a command, e.g. <span className="text-foreground">STATS</span>, <span className="text-foreground">GET user:1</span> or <span className="text-foreground">SET user:1 Ann EX 60</span>.</p>
            : <p className="text-muted-foreground">Run any Redis command, e.g. <span className="text-foreground">INFO memory</span> or <span className="text-foreground">HGETALL user:1</span>.</p>)}
          {log.map((e, i) => (
            <div key={i} className="py-1">
              <p className="text-primary">db{db}&gt; {e.cmd}</p>
              <pre className={cn('whitespace-pre-wrap break-all', e.error ? 'text-destructive' : 'text-foreground')}>{e.error ? `(error) ${e.error}` : format(e.out)}</pre>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={(e) => (e.preventDefault(), run())} className="flex items-center gap-2 px-3 py-2">
        <Terminal size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        <input value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={onKey} spellCheck={false} aria-label="Command"
          placeholder={conn.driver === 'memcached' ? 'Type a command (GET, SET, DEL, TTL, INCR, STATS …) and press Enter' : 'Type a Redis command and press Enter  (↑ for history)'}
          className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 font-mono text-[12.5px] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20" />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Hide console output' : 'Show console output'}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </form>
      {dialog}
    </div>
  )
}
