import { useState } from 'react'
import { ChevronRight, Eye, FileCode2, Folder, KeyRound, MoreHorizontal, Pencil, Plug, RefreshCw, Table2, Trash2, Unplug, Columns3 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ConnView, TreeNode } from '@/lib/api'
import { cn } from '@/lib/cn'
import { kindOf } from '@/lib/databases'
import { treeKey, useWorkspace } from '@/lib/workspace'
import { BrandIcon } from '../BrandIcon'
import { Confirm } from '../ui/Confirm'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/Menu'
import { Skeleton } from '../ui/Skeleton'
import { Spinner } from '../ui/Spinner'
import { Tooltip } from '../ui/Tooltip'

const statusLabel = { idle: 'Not connected', connecting: 'Connecting…', connected: 'Connected', error: 'Connection failed' }

function StatusDot({ c }: { c: ConnView }) {
  if (c.status === 'connecting') return <Spinner size={12} className="text-primary" label="Connecting" />
  return (
    <span
      role="img"
      aria-label={statusLabel[c.status]}
      className={cn('size-2 rounded-full', c.status === 'connected' ? 'bg-success' : c.status === 'error' ? 'bg-destructive' : 'bg-foreground/20')}
    />
  )
}

const nodeIcon = (n: TreeNode) =>
  n.kind === 'table' ? Table2 : n.kind === 'view' ? Eye : n.kind === 'column' ? (n.primaryKey ? KeyRound : Columns3) : Folder

function TreeLevel({ conn, path, depth }: { conn: ConnView; path: string[]; depth: number }) {
  const key = treeKey(conn.id, path)
  const entry = useWorkspace((s) => s.trees[key])
  const { loadTree } = useWorkspace()

  if (!entry || (entry.loading && !entry.nodes)) {
    return (
      <div className="space-y-1.5 py-1" style={{ paddingLeft: depth * 14 + 26 }} aria-label="Loading" role="status">
        {[70, 55, 62].map((w) => (
          <div key={w} style={{ width: `${w}%` }}><Skeleton className="h-3.5" /></div>
        ))}
      </div>
    )
  }
  if (entry.error) {
    return (
      <div className="flex items-start gap-1.5 py-1 pr-2 text-xs text-destructive" style={{ paddingLeft: depth * 14 + 26 }}>
        <span className="min-w-0 flex-1 break-words">{entry.error}</span>
        <button onClick={() => loadTree(conn.id, path, true)} className="shrink-0 underline-offset-2 hover:underline">Retry</button>
      </div>
    )
  }
  if (entry.nodes!.length === 0) {
    return <p className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 14 + 26 }}>Empty</p>
  }
  return (
    <ul role="group">
      {entry.nodes!.map((n) => <TreeRow key={n.path.join('/')} conn={conn} node={n} depth={depth} />)}
    </ul>
  )
}

function TreeRow({ conn, node, depth }: { conn: ConnView; node: TreeNode; depth: number }) {
  const key = treeKey(conn.id, node.path)
  const open = useWorkspace((s) => !!s.expanded[key])
  const { toggle, loadTree, openTable } = useWorkspace()
  const Icon = nodeIcon(node)
  const isTable = node.kind === 'table' || node.kind === 'view'

  const expand = () => {
    if (!node.hasChildren) return
    if (!open) loadTree(conn.id, node.path)
    toggle(key)
  }

  return (
    <li role="treeitem" aria-expanded={node.hasChildren ? open : undefined}>
      <div className="group flex h-7 items-center rounded-md pr-1 hover:bg-muted" style={{ paddingLeft: depth * 14 }}>
        <button onClick={expand} tabIndex={-1} aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center text-muted-foreground', !node.hasChildren && 'invisible')}>
          <ChevronRight size={13} className={cn('transition-transform duration-150', open && 'rotate-90')} />
        </button>
        <button
          onClick={() => (isTable ? openTable(conn.id, { schema: node.path[0], table: node.name }) : expand())}
          onKeyDown={(e) => e.key === 'ArrowRight' && !open ? expand() : e.key === 'ArrowLeft' && open ? toggle(key, false) : undefined}
          title={isTable ? `Open ${node.name}` : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded text-left text-[13px]"
        >
          <Icon size={14} aria-hidden className={cn('shrink-0', node.primaryKey ? 'text-warning' : isTable ? 'text-primary' : 'text-muted-foreground')} />
          <span className="truncate">{node.name}</span>
          {node.detail && <span className="ml-auto truncate pl-2 font-mono text-[11px] text-muted-foreground">{node.detail}</span>}
        </button>
      </div>
      {open && <TreeLevel conn={conn} path={node.path} depth={depth + 1} />}
    </li>
  )
}

function ConnectionItem({ conn, onEdit }: { conn: ConnView; onEdit: (c: ConnView) => void }) {
  const open = useWorkspace((s) => !!s.expanded[conn.id])
  const { toggle, openConnection, disconnect, loadTree, openQuery, remove } = useWorkspace()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const kind = kindOf(conn)

  const expand = () => (open ? toggle(conn.id, false) : openConnection(conn.id))

  return (
    <li role="treeitem" aria-expanded={open}>
      <div className="group relative flex h-9 items-center gap-1 rounded-lg pr-1 hover:bg-muted">
        {conn.color && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full" style={{ background: conn.color }} />}
        <button onClick={expand} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-1.5 text-left">
          <ChevronRight size={13} aria-hidden className={cn('shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-90')} />
          <BrandIcon db={kind} size={22} className="rounded-md" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium">{conn.name}</span>
              {conn.production && <span className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] font-semibold tracking-wide text-destructive">PROD</span>}
            </span>
          </span>
        </button>
        <Tooltip content={conn.status === 'error' ? conn.error : conn.info?.serverVersion ?? statusLabel[conn.status]} side="right">
          <span className="flex size-6 items-center justify-center"><StatusDot c={conn} /></span>
        </Tooltip>
        <Menu>
          <MenuTrigger aria-label={`Actions for ${conn.name}`} className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal size={15} />
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<FileCode2 />} onSelect={() => openQuery(conn.id)}>New query</MenuItem>
            {conn.status === 'connected' ? (
              <>
                <MenuItem icon={<RefreshCw />} onSelect={() => loadTree(conn.id, [], true)}>Refresh schema</MenuItem>
                <MenuItem icon={<Unplug />} onSelect={() => disconnect(conn.id)}>Disconnect</MenuItem>
              </>
            ) : (
              <MenuItem icon={<Plug />} onSelect={expand}>Connect</MenuItem>
            )}
            <MenuItem icon={<Pencil />} onSelect={() => onEdit(conn)}>Edit connection</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete(true)}>Delete</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <AnimatePresence initial={false}>
        {open && conn.status !== 'connecting' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <TreeLevel conn={conn} path={[]} depth={1} />
          </motion.div>
        )}
      </AnimatePresence>
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${conn.name}?`}
        confirmLabel="Delete connection"
        danger
        onConfirm={() => remove(conn.id)}
      >
        This removes the saved connection and its passwords from your keychain. Your database itself is not touched.
      </Confirm>
    </li>
  )
}

export function ConnectionList({ filter, onEdit }: { filter: string; onEdit: (c: ConnView) => void }) {
  const connections = useWorkspace((s) => s.connections)
  const q = filter.trim().toLowerCase()
  const shown = q ? connections.filter((c) => c.name.toLowerCase().includes(q) || (c.host ?? '').toLowerCase().includes(q)) : connections
  if (q && shown.length === 0) return <p className="px-2 py-3 text-[13px] text-muted-foreground">No connections match “{filter}”.</p>
  return (
    <ul role="tree" aria-label="Connections" className="space-y-0.5">
      {shown.map((c) => <ConnectionItem key={c.id} conn={c} onEdit={onEdit} />)}
    </ul>
  )
}
