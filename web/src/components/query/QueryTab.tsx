import { useMemo } from 'react'
import { FileCode2 } from 'lucide-react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { ConnView } from '@/lib/api'
import { kindOf } from '@/lib/databases'
import { modKey } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { BrandIcon } from '../BrandIcon'
import { QueryComposer } from '../database/QueryComposer'
import { Kbd } from '../ui/Kbd'
import { Results } from './Results'
import { useElapsed, useQueryRunner } from './useQueryRunner'

export { ErrorPanel } from './Results'

type QTab = Extract<Tab, { kind: 'query' }>

/** Table → columns from whatever schema the sidebar has loaded, for autocomplete. */
export function useSchema(connId: string, schema?: string) {
  const trees = useWorkspace((s) => s.trees)
  return useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const [key, entry] of Object.entries(trees)) {
      if (!key.startsWith(connId) || !entry.nodes) continue
      for (const n of entry.nodes) {
        if (schema && n.path[0] !== schema && n.path.length > 1) continue
        if (n.kind === 'table' || n.kind === 'view') out[n.name] ??= []
        if (n.kind === 'column') (out[n.path[n.path.length - 2]] ??= []).push(n.name)
      }
    }
    return out
  }, [trees, connId, schema])
}

/** Run the editor's selection, or the whole text. */
export function selectionOr(ref: React.RefObject<ReactCodeMirrorRef | null>, all: string) {
  const view = ref.current?.view
  const sel = view?.state.selection.main
  return sel && !sel.empty ? view!.state.sliceDoc(sel.from, sel.to) : all
}

/** A query tab: results fill the space, the query box sits at the bottom (like database and table tabs). */
export function QueryTab({ tab, conn }: { tab: QTab; conn: ConnView }) {
  const updateTab = useWorkspace((s) => s.updateTab)
  const runner = useQueryRunner(conn, tab.schema)
  const elapsed = useElapsed(!!runner.running)
  const schema = useSchema(conn.id, tab.schema)
  const scope = tab.schema || conn.info?.database || conn.database || conn.name

  const empty = (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground"><FileCode2 size={22} aria-hidden /></span>
      <div>
        <p className="font-medium">Write SQL in the box below</p>
        <p className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[13px] text-muted-foreground">
          <Kbd>{modKey}</Kbd><Kbd>Enter</Kbd> runs it. Select part of it to run only that. Several statements each get their own result.
        </p>
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b px-4">
        <BrandIcon db={kindOf(conn)} size={22} className="rounded-md" />
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate font-semibold">{tab.title}</h2>
          <span className="truncate text-xs text-muted-foreground">{conn.name}{tab.schema ? ` · ${tab.schema}` : ''}</span>
        </div>
        {conn.production && (
          <span className="ml-auto shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">PRODUCTION{conn.readOnly ? ' · READ-ONLY' : ''}</span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <Results results={runner.results} active={runner.active} setActive={runner.setActive} error={runner.error} running={!!runner.running} empty={empty} />
      </div>

      <QueryComposer
        value={tab.sql}
        onChange={(sql) => updateTab(tab.id, { sql })}
        onRun={runner.run}
        onStop={runner.stop}
        running={!!runner.running}
        dialect={conn.driver}
        schema={schema}
        scopeLabel={scope}
        elapsed={elapsed}
        initialMaxHeight={320}
        autoFocus={!tab.sql}
        placeholder="Write SQL… e.g. SELECT * FROM customers LIMIT 50"
      />
      {runner.confirmDialog}
    </div>
  )
}
