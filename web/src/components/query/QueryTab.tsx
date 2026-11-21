import { useMemo } from 'react'
import { FileCode2 } from 'lucide-react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import type { ConnView } from '@/lib/api'
import { kindOf } from '@/lib/databases'
import { modKey } from '@/lib/hooks'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { BrandIcon } from '../BrandIcon'
import { QueryComposer } from '../database/QueryComposer'
import { QueryCommander } from '../builder/QueryCommander'
import { Segmented } from '../ui/Segmented'
import { Kbd } from '../ui/Kbd'
import { Results } from './Results'
import { useElapsed, useQueryRunner } from './useQueryRunner'

export { ErrorPanel } from './Results'

type QTab = Extract<Tab, { kind: 'query' }>

/** Table → columns from whatever the sidebar has loaded (for this schema/database), for autocomplete. */
export function useSchema(connId: string, schema?: string, database?: string) {
  const trees = useWorkspace((s) => s.trees)
  return useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const [key, entry] of Object.entries(trees)) {
      if (!key.startsWith(connId) || !entry.nodes) continue
      for (const n of entry.nodes) {
        if (n.kind !== 'table' && n.kind !== 'view' && n.kind !== 'column') continue
        // Paths end with …, schema, table[, column]; Postgres paths start with the database.
        const tableIdx = n.kind === 'column' ? n.path.length - 2 : n.path.length - 1
        const nodeSchema = n.path[tableIdx - 1]
        const nodeDb = tableIdx === 2 ? n.path[0] : undefined
        if (schema && nodeSchema !== schema) continue
        if (database && nodeDb && nodeDb !== database) continue
        if (n.kind === 'column') (out[n.path[tableIdx]] ??= []).push(n.name)
        else out[n.name] ??= []
      }
    }
    return out
  }, [trees, connId, schema, database])
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
  const runner = useQueryRunner(conn, tab.schema, tab.database)
  const elapsed = useElapsed(!!runner.running)
  const schema = useSchema(conn.id, tab.schema, tab.database)
  const scope = [tab.database, tab.schema].filter(Boolean).join('.') || conn.info?.database || conn.database || conn.name
  // UI first: new tabs open in the visual builder; SQL is the second view.
  const mode = tab.mode ?? (tab.sql.trim() ? 'sql' : 'builder')

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
          <span className="truncate text-xs text-muted-foreground">{conn.name}{tab.database ? ` · ${tab.database}` : ''}{tab.schema ? ` · ${tab.schema}` : ''}</span>
        </div>
        <Segmented
          label="Query mode"
          value={mode}
          onChange={(m) => updateTab(tab.id, { mode: m })}
          options={[{ value: 'builder', label: 'Builder' }, { value: 'sql', label: 'SQL' }]}
          className="ml-auto shrink-0"
        />
        {conn.production && (
          <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">PRODUCTION{conn.readOnly ? ' · READ-ONLY' : ''}</span>
        )}
      </div>

      {mode === 'builder' ? (
        <div className="min-h-0 flex-1">
          <QueryCommander conn={conn} tab={tab} runner={runner} onEditSql={(sql) => updateTab(tab.id, { mode: 'sql', sql })} />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <Results results={runner.results} active={runner.active} setActive={runner.setActive} error={runner.error} running={!!runner.running} empty={empty}
              exportScope={{ connId: conn.id, schema: tab.schema, database: tab.database }} />
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
        </>
      )}
      {runner.confirmDialog}
    </div>
  )
}
