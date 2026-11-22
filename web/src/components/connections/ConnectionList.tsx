import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronRight, Columns3, Copy, Database, Download, Eraser, Eye, FileCode2, Folder, KeyRound, LayoutGrid, MoreHorizontal,
  Pencil, Plug, Plus, RefreshCw, Table2, Trash2, Unplug, Upload, Wand2,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { isSql, type ConnView, type TreeNode } from '@/lib/api'
import { cn } from '@/lib/cn'
import { kindOf } from '@/lib/databases'
import { selectSql } from '@/lib/ddl'
import { emptyCommander } from '@/lib/commander'
import { openDialog } from '@/lib/dialogs'
import type { TransferTarget } from '@/lib/exporter'
import { containerOf, isServerDatabase, tableRefOf, treeKey, useWorkspace } from '@/lib/workspace'
import { BrandIcon } from '../BrandIcon'
import { Confirm } from '../ui/Confirm'
import { ContextMenu, CtxItem, CtxLabel, CtxSeparator } from '../ui/ContextMenu'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { Tooltip } from '../ui/Tooltip'

const statusLabel = { idle: 'Not connected', connecting: 'Connecting…', connected: 'Connected', error: 'Connection failed' }

const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Copied', { description: text, duration: 1400 }))

function StatusDot({ c }: { c: ConnView }) {
  if (c.status === 'connecting') return <Spinner size={12} className="text-primary" label="Connecting" />
  return (
    <span role="img" aria-label={statusLabel[c.status]}
      className={cn('size-2 rounded-full', c.status === 'connected' ? 'bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_20%,transparent)]' : c.status === 'error' ? 'bg-destructive' : 'bg-foreground/20')} />
  )
}

const nodeIcon = (n: TreeNode) =>
  n.kind === 'table' ? Table2 : n.kind === 'view' ? Eye : n.kind === 'column' ? (n.primaryKey ? KeyRound : Columns3) : n.kind === 'database' ? Database : Folder

/**
 * Keyboard navigation for the whole tree: ↑/↓ move between visible rows,
 * → expands (or moves into) a node, ← collapses (or moves to the parent),
 * Home/End jump to the first/last row.
 */
function onTreeKey(e: React.KeyboardEvent<HTMLUListElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tree-item]')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  const focus = (n: number) => items[Math.max(0, Math.min(items.length - 1, n))]?.focus()
  const el = items[i]
  const expanded = el.getAttribute('aria-expanded')
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); focus(i + 1); break
    case 'ArrowUp': e.preventDefault(); focus(i - 1); break
    case 'Home': e.preventDefault(); focus(0); break
    case 'End': e.preventDefault(); focus(items.length - 1); break
    case 'ArrowRight':
      e.preventDefault()
      if (expanded === 'false') el.click()
      else if (expanded === 'true') focus(i + 1)
      break
    case 'ArrowLeft': {
      e.preventDefault()
      if (expanded === 'true') { el.click(); break }
      const depth = Number(el.dataset.depth)
      for (let j = i - 1; j >= 0; j--) if (Number(items[j].dataset.depth) < depth) { focus(j); break }
      break
    }
  }
}

function TreeLevel({ conn, path, depth }: { conn: ConnView; path: string[]; depth: number }) {
  const key = treeKey(conn.id, path)
  const entry = useWorkspace((s) => s.trees[key])
  const { loadTree } = useWorkspace()
  const pad = { paddingLeft: depth * 14 + 26 }
  // Expanded nodes restored from the workspace file load their children on first render.
  useEffect(() => {
    if (!entry) loadTree(conn.id, path)
  }, [entry, conn.id, path, loadTree])

  if (!entry || (entry.loading && !entry.nodes)) {
    return (
      <div className="space-y-1.5 py-1" style={pad} aria-label="Loading" role="status">
        {[70, 55, 62].map((w) => <div key={w} style={{ width: `${w}%` }}><Skeleton className="h-3.5" /></div>)}
      </div>
    )
  }
  if (entry.error) {
    return (
      <div className="flex items-start gap-1.5 py-1 pr-2 text-xs text-destructive" style={pad}>
        <span className="min-w-0 flex-1 break-words">{entry.error}</span>
        <button onClick={() => loadTree(conn.id, path, true)} className="shrink-0 underline-offset-2 hover:underline">Retry</button>
      </div>
    )
  }
  if (entry.nodes!.length === 0) return <p className="py-1 text-xs text-muted-foreground" style={pad}>Empty</p>
  return (
    <ul role="group">
      {entry.nodes!.map((n) => <TreeRow key={n.path.join('/')} conn={conn} node={n} depth={depth} />)}
    </ul>
  )
}

/** Export… / Import… menu items (import hidden on read-only connections). */
function transferItems(target: TransferTarget, readOnly?: boolean, Item: typeof CtxItem | typeof MenuItem = CtxItem) {
  return (
    <>
      <Item icon={<Download />} onSelect={() => openDialog({ kind: 'export', target })}>Export…</Item>
      {!readOnly && <Item icon={<Upload />} onSelect={() => openDialog({ kind: 'import', target })}>Import…</Item>}
    </>
  )
}

function nodeMenu(conn: ConnView, node: TreeNode, ws: ReturnType<typeof useWorkspace.getState>): ReactNode {
  const ro = conn.readOnly
  if ((node.kind === 'table' || node.kind === 'view') && conn.driver === 'mongodb') {
    const ref = tableRefOf(node)
    return (
      <>
        <CtxLabel>{node.name}</CtxLabel>
        <CtxItem icon={<Table2 />} shortcut="Enter" onSelect={() => ws.openTable(conn.id, ref)}>Open collection</CtxItem>
        <CtxItem icon={<Copy />} onSelect={() => copy(node.name)}>Copy name</CtxItem>
        <CtxSeparator />
        {transferItems({ kind: 'collection', connId: conn.id, db: ref.schema, collection: node.name }, ro)}
        {!ro && (
          <>
            <CtxSeparator />
            <CtxItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'mongo-drop', connId: conn.id, db: ref.schema, collection: node.name })}>Drop collection…</CtxItem>
          </>
        )}
      </>
    )
  }
  if (node.kind === 'table' || node.kind === 'view') {
    const ref = tableRefOf(node)
    const { schema, database } = ref
    return (
      <>
        <CtxLabel>{node.name}</CtxLabel>
        <CtxItem icon={<Table2 />} shortcut="Enter" onSelect={() => ws.openTable(conn.id, ref)}>Open data</CtxItem>
        <CtxItem icon={<Wand2 />} onSelect={() => ws.openQuery(conn.id, '', schema, database, emptyCommander(node.name))}>Build a query</CtxItem>
        <CtxItem icon={<FileCode2 />} onSelect={() => ws.openQuery(conn.id, selectSql(conn.driver, schema, node.name), schema, database)}>Query in SQL editor</CtxItem>
        <CtxItem icon={<Copy />} onSelect={() => copy(node.name)}>Copy name</CtxItem>
        <CtxSeparator />
        {transferItems({ kind: 'table', connId: conn.id, ref }, ro || node.kind === 'view')}
        {!ro && node.kind === 'table' && (
          <>
            <CtxSeparator />
            <CtxItem icon={<Pencil />} onSelect={() => openDialog({ kind: 'table-designer', connId: conn.id, schema, table: node.name, database })}>Edit structure…</CtxItem>
            <CtxItem icon={<Eraser />} danger onSelect={() => openDialog({ kind: 'empty-table', connId: conn.id, ref })}>Empty table…</CtxItem>
          </>
        )}
        {!ro && <CtxItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'drop', connId: conn.id, what: node.kind as 'table' | 'view', schema, table: node.name, database })}>Delete {node.kind}…</CtxItem>}
      </>
    )
  }
  if (isServerDatabase(conn, node)) {
    // A whole database on a Postgres server (above its schemas).
    const db = node.name
    return (
      <>
        <CtxLabel>{db}</CtxLabel>
        <CtxItem icon={<LayoutGrid />} shortcut="Enter" onSelect={() => ws.openDatabase(conn.id, undefined, db)}>Open database</CtxItem>
        <CtxItem icon={<FileCode2 />} onSelect={() => ws.openQuery(conn.id, '', undefined, db)}>New query here</CtxItem>
        <CtxItem icon={<RefreshCw />} onSelect={() => ws.loadTree(conn.id, node.path, true)}>Refresh</CtxItem>
        <CtxItem icon={<Copy />} onSelect={() => copy(db)}>Copy name</CtxItem>
        {!ro && (
          <>
            <CtxSeparator />
            <CtxItem icon={<Plus />} onSelect={() => openDialog({ kind: 'create-database', connId: conn.id, database: db })}>New schema…</CtxItem>
            <CtxItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'drop', connId: conn.id, what: 'database', schema: db })}>Delete database…</CtxItem>
          </>
        )}
      </>
    )
  }
  if (conn.driver === 'redis') {
    return (
      <>
        <CtxLabel>{node.name}</CtxLabel>
        <CtxItem icon={<LayoutGrid />} shortcut="Enter" onSelect={() => ws.openDatabase(conn.id, node.path[0])}>Browse keys</CtxItem>
        <CtxItem icon={<RefreshCw />} onSelect={() => ws.loadTree(conn.id, [], true)}>Refresh</CtxItem>
        <CtxSeparator />
        {transferItems({ kind: 'redis', connId: conn.id, db: Number(node.path[0]) }, ro)}
      </>
    )
  }
  if (conn.driver === 'mongodb' && node.kind === 'database') {
    return (
      <>
        <CtxLabel>{node.name}</CtxLabel>
        <CtxItem icon={<LayoutGrid />} shortcut="Enter" onSelect={() => ws.openDatabase(conn.id, node.name)}>Open database</CtxItem>
        <CtxItem icon={<RefreshCw />} onSelect={() => ws.loadTree(conn.id, node.path, true)}>Refresh</CtxItem>
        <CtxItem icon={<Copy />} onSelect={() => copy(node.name)}>Copy name</CtxItem>
        <CtxSeparator />
        {transferItems({ kind: 'mongo-db', connId: conn.id, db: node.name }, ro)}
        {!ro && (
          <>
            <CtxSeparator />
            <CtxItem icon={<Plus />} onSelect={() => openDialog({ kind: 'mongo-create', connId: conn.id, db: node.name })}>New collection…</CtxItem>
            <CtxItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'mongo-drop', connId: conn.id, db: node.name })}>Drop database…</CtxItem>
          </>
        )}
      </>
    )
  }
  if (node.kind === 'schema' || node.kind === 'database') {
    const { schema, database } = containerOf(node)
    return (
      <>
        <CtxLabel>{node.name}</CtxLabel>
        <CtxItem icon={<LayoutGrid />} shortcut="Enter" onSelect={() => ws.openDatabase(conn.id, schema, database)}>Open {node.kind}</CtxItem>
        <CtxItem icon={<FileCode2 />} onSelect={() => ws.openQuery(conn.id, '', schema, database)}>New query here</CtxItem>
        <CtxItem icon={<RefreshCw />} onSelect={() => ws.loadTree(conn.id, node.path, true)}>Refresh</CtxItem>
        <CtxItem icon={<Copy />} onSelect={() => copy(node.name)}>Copy name</CtxItem>
        <CtxSeparator />
        {transferItems({ kind: 'database', connId: conn.id, schema, database }, ro)}
        {!ro && (
          <>
            <CtxSeparator />
            <CtxItem icon={<Plus />} onSelect={() => openDialog({ kind: 'table-designer', connId: conn.id, schema, database })}>New table…</CtxItem>
            <CtxItem icon={<Trash2 />} danger onSelect={() => openDialog({ kind: 'drop', connId: conn.id, what: node.kind as 'schema' | 'database', schema, database })}>Delete {node.kind}…</CtxItem>
          </>
        )}
      </>
    )
  }
  return (
    <>
      <CtxLabel>{node.name}</CtxLabel>
      <CtxItem icon={<Copy />} onSelect={() => copy(node.name)}>Copy name</CtxItem>
      {node.detail && <CtxItem icon={<Copy />} onSelect={() => copy(`${node.name} ${node.detail}`)}>Copy with type</CtxItem>}
    </>
  )
}

function TreeRow({ conn, node, depth }: { conn: ConnView; node: TreeNode; depth: number }) {
  const key = treeKey(conn.id, node.path)
  const open = useWorkspace((s) => !!s.expanded[key])
  const ws = useWorkspace()
  const Icon = nodeIcon(node)
  const isTable = node.kind === 'table' || node.kind === 'view'
  const serverDb = isServerDatabase(conn, node)
  const isContainer = node.kind === 'schema' || node.kind === 'database'
  // Opens the database view for this node (a tab, or the one already open).
  const openView = () => {
    if (conn.driver === 'redis') return ws.openDatabase(conn.id, node.path[0])
    if (serverDb) return ws.openDatabase(conn.id, undefined, node.name)
    const { schema, database } = containerOf(node)
    ws.openDatabase(conn.id, schema, database)
  }

  const toggle = () => {
    if (!node.hasChildren) return
    if (!open) ws.loadTree(conn.id, node.path)
    ws.toggle(key)
  }

  return (
    <li role="none">
      <ContextMenu content={nodeMenu(conn, node, ws)}>
        <div className="group flex h-7 items-center rounded-md pr-1 hover:bg-muted" style={{ paddingLeft: depth * 14 }}>
          <button onClick={toggle} tabIndex={-1} aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center text-muted-foreground', !node.hasChildren && 'invisible')}>
            <ChevronRight size={13} className={cn('transition-transform duration-150', open && 'rotate-90')} />
          </button>
          <button
            data-tree-item
            data-depth={depth}
            role="treeitem"
            aria-expanded={node.hasChildren ? open : undefined}
            onClick={() => (isTable ? ws.openTable(conn.id, tableRefOf(node)) : conn.driver === 'redis' ? openView() : toggle())}
            onDoubleClick={() => {
              if (!isContainer) return
              ws.toggle(key, true) // the two single clicks toggled it; keep it open
              openView()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isContainer) (e.preventDefault(), openView())
              // For tables, → expands columns instead of opening the table.
              if (isTable && e.key === 'ArrowRight' && !open) (e.preventDefault(), e.stopPropagation(), toggle())
              if (isTable && e.key === 'ArrowLeft' && open) (e.preventDefault(), e.stopPropagation(), toggle())
            }}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded text-left text-[13px]"
          >
            <Icon size={14} aria-hidden className={cn('shrink-0', node.primaryKey ? 'text-warning' : isTable ? 'text-primary' : serverDb ? 'text-accent-foreground' : 'text-muted-foreground')} />
            <span className="truncate">{node.name}</span>
            {node.detail && <span className="ml-auto truncate pl-2 font-mono text-[11px] text-muted-foreground">{node.detail}</span>}
          </button>
          {isContainer && (
            <Tooltip content={`Open ${node.kind}`} side="right">
              <button tabIndex={-1} onClick={openView} aria-label={`Open ${node.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-background hover:text-foreground">
                <LayoutGrid size={13} />
              </button>
            </Tooltip>
          )}
        </div>
      </ContextMenu>
      {open && <TreeLevel conn={conn} path={node.path} depth={depth + 1} />}
    </li>
  )
}

function ConnectionActions({ conn, onEdit, onDelete, Item, Sep }: {
  conn: ConnView; onEdit: (c: ConnView) => void; onDelete: () => void
  Item: typeof MenuItem | typeof CtxItem; Sep: () => ReactNode
}) {
  const ws = useWorkspace()
  const copyAddress = <Item icon={<Copy />} onSelect={() => copy(conn.driver === 'sqlite' ? conn.file ?? '' : `${conn.host}:${conn.port ?? ''}`)}>Copy address</Item>
  if (conn.unavailable) return copyAddress
  return (
    <>
      <Item icon={<LayoutGrid />} onSelect={() => ws.openDatabase(conn.id)}>Open database</Item>
      {isSql(conn.driver) && <Item icon={<FileCode2 />} onSelect={() => ws.openQuery(conn.id)}>New query</Item>}
      {conn.status === 'connected' ? (
        <>
          <Item icon={<RefreshCw />} onSelect={() => ws.loadTree(conn.id, [], true)}>Refresh schema</Item>
          <Item icon={<Unplug />} onSelect={() => ws.disconnect(conn.id)}>Disconnect</Item>
        </>
      ) : (
        <Item icon={<Plug />} onSelect={() => ws.openConnection(conn.id)}>Connect</Item>
      )}
      {(conn.driver === 'postgres' || conn.driver === 'mysql') && !conn.readOnly && (
        // Postgres: a new database on the server; MySQL: a new database (schema).
        <Item icon={<Plus />} onSelect={() => openDialog({ kind: 'create-database', connId: conn.id, server: conn.driver === 'postgres' })}>New database…</Item>
      )}
      {conn.driver === 'mongodb' && !conn.readOnly && (
        <Item icon={<Plus />} onSelect={() => openDialog({ kind: 'mongo-create', connId: conn.id })}>New database…</Item>
      )}
      {conn.driver === 'sqlite' && transferItems({ kind: 'database', connId: conn.id, schema: 'main' }, conn.readOnly, Item)}
      {!conn.managed && <Item icon={<Pencil />} onSelect={() => onEdit(conn)}>Edit connection…</Item>}
      {copyAddress}
      {!conn.managed && (
        <>
          <Sep />
          <Item icon={<Trash2 />} danger onSelect={onDelete}>Delete connection…</Item>
        </>
      )}
    </>
  )
}

function ConnectionItem({ conn, onEdit }: { conn: ConnView; onEdit: (c: ConnView) => void }) {
  const open = useWorkspace((s) => !!s.expanded[conn.id])
  const { toggle, openConnection, openDatabase, remove } = useWorkspace()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const expand = () =>
    conn.unavailable ? toast.info(conn.name, { description: conn.unavailable }) : open ? toggle(conn.id, false) : openConnection(conn.id)

  return (
    // LampRabit databases fade in when the services file adds them.
    <motion.li role="none" initial={conn.managed ? { opacity: 0, y: -4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <ContextMenu content={<ConnectionActions conn={conn} onEdit={onEdit} onDelete={() => setConfirmDelete(true)} Item={CtxItem} Sep={CtxSeparator} />}>
        <div className={cn('group relative flex h-9 items-center gap-1 rounded-lg pr-1 hover:bg-muted', conn.unavailable && 'text-muted-foreground')}>
          {conn.color && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full" style={{ background: conn.color }} />}
          <button
            data-tree-item
            data-depth={0}
            role="treeitem"
            aria-expanded={open}
            onClick={expand}
            aria-disabled={conn.unavailable ? true : undefined}
            onDoubleClick={() => {
              if (conn.unavailable) return
              // Double-click: open (or switch to) this connection's database tab, keeping the tree expanded.
              openConnection(conn.id)
              openDatabase(conn.id)
            }}
            title={conn.unavailable ?? 'Double-click to open the database'}
            onKeyDown={(e) => e.key === 'Enter' && e.shiftKey && (e.preventDefault(), openDatabase(conn.id))}
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-1.5 text-left"
          >
            <ChevronRight size={13} aria-hidden className={cn('shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-90')} />
            <BrandIcon db={kindOf(conn)} size={22} className={cn('rounded-md', conn.unavailable && 'opacity-50 grayscale')} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium">{conn.name}</span>
              {conn.unavailable && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{conn.unavailable.includes('coming soon') ? 'Soon' : 'Stopped'}</span>}
              {conn.production && <span className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] font-semibold tracking-wide text-destructive">PROD</span>}
            </span>
          </button>
          <Tooltip content={conn.unavailable ?? (conn.status === 'error' ? conn.error : conn.info?.serverVersion ?? statusLabel[conn.status])} side="right">
            <span className="flex size-6 items-center justify-center"><StatusDot c={conn} /></span>
          </Tooltip>
          <Menu>
            <MenuTrigger tabIndex={-1} aria-label={`Actions for ${conn.name}`} className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={15} />
            </MenuTrigger>
            <MenuContent>
              <ConnectionActions conn={conn} onEdit={onEdit} onDelete={() => setConfirmDelete(true)} Item={MenuItem} Sep={MenuSeparator} />
            </MenuContent>
          </Menu>
        </div>
      </ContextMenu>
      <AnimatePresence initial={false}>
        {open && conn.status !== 'connecting' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <TreeLevel conn={conn} path={[]} depth={1} />
          </motion.div>
        )}
      </AnimatePresence>
      <Confirm open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${conn.name}?`} confirmLabel="Delete connection" danger onConfirm={() => remove(conn.id)}>
        This removes the saved connection and its passwords from your keychain. Your database itself is not touched.
      </Confirm>
    </motion.li>
  )
}

export function ConnectionList({ filter, onEdit }: { filter: string; onEdit: (c: ConnView) => void }) {
  const connections = useWorkspace((s) => s.connections)
  const q = filter.trim().toLowerCase()
  const shown = q ? connections.filter((c) => c.name.toLowerCase().includes(q) || (c.host ?? '').toLowerCase().includes(q)) : connections
  if (q && shown.length === 0) return <p className="px-2 py-3 text-[13px] text-muted-foreground">No connections match “{filter}”.</p>
  const lamprabit = shown.filter((c) => c.managed)
  return (
    <ul id="kx-tree" role="tree" aria-label="Connections" className="space-y-0.5" onKeyDown={onTreeKey}>
      {shown.filter((c) => !c.managed).map((c) => <ConnectionItem key={c.id} conn={c} onEdit={onEdit} />)}
      {lamprabit.length > 0 && (
        <li role="none" className="pt-2">
          <Tooltip content="Added automatically from LampRabit. Manage them in LampRabit." side="right">
            <div id="kx-lamprabit" className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              LampRabit
              <span className="rounded bg-muted px-1 font-mono text-[10px] font-normal normal-case">{lamprabit.length}</span>
            </div>
          </Tooltip>
          <ul role="group" aria-labelledby="kx-lamprabit" className="space-y-0.5">
            {lamprabit.map((c) => <ConnectionItem key={c.id} conn={c} onEdit={onEdit} />)}
          </ul>
        </li>
      )}
    </ul>
  )
}
