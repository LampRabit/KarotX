import { FileCode2, House, Plus, Table2, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { kindOf } from '@/lib/databases'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { BrandIcon } from './BrandIcon'
import { QueryTab } from './query/QueryTab'
import { TableTab } from './table/TableTab'
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/Menu'
import { Tooltip } from './ui/Tooltip'

function TabButton({ tab }: { tab: Tab }) {
  const { activeTab, setActive, closeTab } = useWorkspace()
  const conn = useWorkspace((s) => s.connections.find((c) => c.id === tab.connId))
  const active = activeTab === tab.id
  const Icon = tab.kind === 'table' ? Table2 : FileCode2
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      role="tab"
      aria-selected={active}
      className={cn(
        'group relative flex h-full max-w-56 min-w-0 shrink-0 items-center border-r',
        active ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeTab(tab.id))}
    >
      {active && <motion.span layoutId="active-tab" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
      <button onClick={() => setActive(tab.id)} className="flex h-full min-w-0 items-center gap-2 pr-1 pl-3 text-[13px]" title={`${tab.title} · ${conn?.name ?? ''}`}>
        <Icon size={14} aria-hidden className={cn('shrink-0', active && 'text-primary')} />
        <span className="truncate">{tab.title}</span>
        {conn?.color && <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: conn.color }} />}
      </button>
      <button
        onClick={() => closeTab(tab.id)}
        aria-label={`Close ${tab.title}`}
        className="mr-1.5 flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 aria-[current]:opacity-100"
        aria-current={active || undefined}
      >
        <X size={13} />
      </button>
    </motion.div>
  )
}

function NewQueryButton() {
  const connections = useWorkspace((s) => s.connections)
  const openQuery = useWorkspace((s) => s.openQuery)
  const trigger = (
    <MenuTrigger disabled={connections.length === 0} aria-label="New query" className="flex size-9 shrink-0 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40">
      <Plus size={16} />
    </MenuTrigger>
  )
  return (
    <Menu>
      <Tooltip content={connections.length ? 'New query' : 'Add a connection first'}>{trigger}</Tooltip>
      <MenuContent>
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">New query on…</p>
        {connections.map((c) => (
          <MenuItem key={c.id} icon={<BrandIcon db={kindOf(c)} size={16} className="rounded" />} onSelect={() => openQuery(c.id)}>
            {c.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

/** Tab strip + the active tab's content. Opened tabs stay mounted so their state survives switching. */
export function Workspace({ home }: { home: ReactNode }) {
  const { tabs, activeTab, setActive, connections } = useWorkspace()
  // Mount a tab only once it has been shown, so restored tabs don't all query at startup.
  const [seen, setSeen] = useState(() => new Set([activeTab]))
  useEffect(() => setSeen((s) => (s.has(activeTab) ? s : new Set(s).add(activeTab))), [activeTab])
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Open tabs" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-sidebar [scrollbar-width:none]">
        <Tooltip content="Home">
          <button
            role="tab"
            aria-selected={activeTab === ''}
            aria-label="Home"
            onClick={() => setActive('')}
            className={cn('relative flex w-10 shrink-0 items-center justify-center border-r transition', activeTab === '' ? 'bg-background text-primary' : 'text-muted-foreground hover:bg-muted/60')}
          >
            {activeTab === '' && <motion.span layoutId="active-tab" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
            <House size={15} />
          </button>
        </Tooltip>
        {tabs.map((t) => <TabButton key={t.id} tab={t} />)}
        <NewQueryButton />
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0 overflow-y-auto', activeTab !== '' && 'hidden')}>{home}</div>
        {tabs.map((t) => {
          const conn = connections.find((c) => c.id === t.connId)
          if (!conn || !seen.has(t.id)) return null
          return (
            <div key={t.id} role="tabpanel" className={cn('absolute inset-0', activeTab !== t.id && 'hidden')}>
              {t.kind === 'table' ? <TableTab tab={t} conn={conn} /> : <QueryTab tab={t} conn={conn} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
