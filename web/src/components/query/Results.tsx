import { AlertCircle, CheckCircle2, TerminalSquare } from 'lucide-react'
import type { Result } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DataGrid } from '../grid/DataGrid'
import { Skeleton } from '../ui/Skeleton'

type Props = {
  results?: Result[]
  active: number
  setActive: (i: number) => void
  error: string
  running: boolean
  empty?: React.ReactNode
}

/** Result tabs (one per statement), grid / message / error, and a status footer. */
export function Results({ results, active, setActive, error, running, empty }: Props) {
  const r = results?.[active]
  return (
    <div className="flex h-full min-h-0 flex-col">
      {results && results.length > 1 && (
        <div role="tablist" aria-label="Statement results" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
          {results.map((res, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn('flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap transition', i === active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')}
            >
              {res.error ? <AlertCircle size={13} className="text-destructive" /> : <CheckCircle2 size={13} className="text-success" />}
              {res.columns ? `Result ${i + 1}` : `Statement ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {running && !results ? (
          <div className="space-y-2 p-4" aria-label="Running query" role="status">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-5" />)}
          </div>
        ) : error ? (
          <ErrorPanel message={error} />
        ) : !r ? (
          empty ?? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <TerminalSquare size={28} aria-hidden />
              <p>Results will appear here.</p>
            </div>
          )
        ) : r.error ? (
          <ErrorPanel message={r.error} statement={r.statement} />
        ) : r.columns ? (
          <div className={cn('h-full transition-opacity', running && 'opacity-50')}>
            <DataGrid columns={r.columns} rows={r.rows ?? []} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-success">
            <CheckCircle2 size={18} aria-hidden />
            <span>{r.rowsAffected !== undefined ? `${r.rowsAffected.toLocaleString()} ${r.rowsAffected === 1 ? 'row' : 'rows'} affected` : 'Done'}</span>
          </div>
        )}
      </div>
      {r && !r.error && !error && (
        <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
          {r.columns && <span>{(r.rows?.length ?? 0).toLocaleString()} rows{r.truncated ? ' (first 1,000 shown)' : ''}</span>}
          <span>{r.durationMs.toFixed(1)} ms</span>
          <span className="ml-auto truncate font-mono" title={r.statement}>{r.statement.split('\n')[0]}</span>
        </footer>
      )}
    </div>
  )
}

export function ErrorPanel({ message, statement }: { message: string; statement?: string }) {
  return (
    <div role="alert" className="m-4 rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4">
      <p className="flex items-center gap-2 font-medium text-destructive"><AlertCircle size={16} aria-hidden /> The query failed</p>
      <p className="mt-1.5 font-mono text-[13px] break-words whitespace-pre-wrap">{message}</p>
      {statement && <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-background p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{statement}</pre>}
    </div>
  )
}
