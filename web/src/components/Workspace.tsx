import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Database, FileCode2, House, Plus, Table2, X } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { kindOf } from '@/lib/databases'
import { useWorkspace, type Tab } from '@/lib/workspace'
import { BrandIcon } from './BrandIcon'
import { DatabaseTab } from './database/DatabaseTab'
import { QueryTab } from './query/QueryTab'
import { TableTab } from './table/TableTab'
import { ContextMenu, CtxItem, CtxSeparator } from './ui/ContextMenu'
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/Menu'
import { Tooltip } from './ui/Tooltip'

const tabIcon = { table: Table2, query: FileCode2, database: Database }

function subtitle(t: Tab, connName?: string) {
  if (t.kind === 'table') return t.table.schema === 'main' ? connName : [t.table.database, t.table.schema].filter(Boolean).join('.')
  if (t.kind === 'query') return [t.database, t.schema].filter(Boolean).join('.') || connName
  if (t.title === connName) return 'Database'
  return t.database && t.schema ? `${t.database} · ${connName}` : connName
}

function TabButton({ tab, index }: { tab: Tab; index: number }) {
  const { activeTab, setActive, closeTab, closeTabs, tabs, openQuery } = useWorkspace()
  const conn = useWorkspace((s) => s.connections.find((c) => c.id === tab.connId))
  const active = activeTab === tab.id
  const Icon = tabIcon[tab.kind]
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <ContextMenu
      content={
        <>
          <CtxItem icon={<X />} shortcut="Alt W" onSelect={() => closeTab(tab.id)}>Close</CtxItem>
          <CtxItem onSelect={() => closeTabs(tabs.filter((t) => t.id !== tab.id).map((t) => t.id))}>Close others</CtxItem>
          <CtxItem onSelect={() => closeTabs(tabs.slice(index + 1).map((t) => t.id))} disabled={index === tabs.length - 1}>Close tabs to the right</CtxItem>
          <CtxItem onSelect={() => closeTabs(tabs.map((t) => t.id))}>Close all</CtxItem>
          {tab.kind === 'query' && (
            <>
              <CtxSeparator />
              <CtxItem icon={<Copy />} onSelect={() => openQuery(tab.connId, tab.sql, tab.schema)}>Duplicate</CtxItem>
            </>
          )}
        </>
      }
    >
      <motion.div
        layout="position"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'group relative flex h-full max-w-60 min-w-0 shrink-0 items-center rounded-t-lg border-x border-t transition-colors',
          active ? 'z-10 -mb-px border-border bg-background text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        )}
        onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeTab(tab.id))}
      >
        {active && <motion.span layoutId="active-tab" className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary" />}
        <button
          ref={ref}
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          onClick={() => setActive(tab.id)}
          className="flex h-full min-w-0 items-center gap-2 pr-1 pl-3 text-left"
          title={`${tab.title}${conn ? ` · ${conn.name}` : ''}`}
        >
          {conn ? (
            <span className="relative shrink-0">
              <BrandIcon db={kindOf(conn)} size={18} className="rounded-[5px]" />
              <Icon size={10} strokeWidth={2.5} aria-hidden className="absolute -right-1 -bottom-1 rounded-sm bg-background p-px text-foreground" />
            </span>
          ) : (
            <Icon size={15} aria-hidden />
          )}
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-medium">{tab.title}</span>
            <span className="block truncate text-[10.5px] text-muted-foreground">{subtitle(tab, conn?.name)}</span>
          </span>
          {conn?.color && <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: conn.color }} />}
        </button>
        <button
          onClick={() => closeTab(tab.id)}
          tabIndex={-1}
          aria-label={`Close ${tab.title}`}
          className={cn('mr-1.5 flex size-5 shrink-0 items-center justify-center rounded transition hover:bg-muted', active ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70')}
        >
          <X size={13} />
        </button>
      </motion.div>
    </ContextMenu>
  )
}

function NewTabButton() {
  const connections = useWorkspace((s) => s.connections)
  const openDatabase = useWorkspace((s) => s.openDatabase)
  const [open, setOpen] = useState(false)
  // Alt+T (global shortcut) opens this menu.
  useEffect(() => {
    const show = () => connections.length && setOpen(true)
    window.addEventListener('kx:new-tab', show)
    return () => window.removeEventListener('kx:new-tab', show)
  }, [connections.length])
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip content={connections.length ? 'New tab (Alt+T)' : 'Add a connection first'}>
        <MenuTrigger id="kx-new-tab" disabled={connections.length === 0} aria-label="New tab" className="ml-1 flex size-8 shrink-0 items-center justify-center self-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40">
          <Plus size={16} />
        </MenuTrigger>
      </Tooltip>
      <MenuContent>
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Open a database</p>
        {connections.map((c) => (
          <MenuItem key={c.id} icon={<BrandIcon db={kindOf(c)} size={16} className="rounded" />} onSelect={() => openDatabase(c.id)}>
            <span className="flex-1 truncate">{c.name}</span>
            {c.status === 'connected' && <span className="ml-3 size-1.5 rounded-full bg-success" aria-label="connected" />}
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

  // Arrow keys move between tabs inside the tab strip.
  function onStripKey(e: React.KeyboardEvent) {
    const ids = ['', ...tabs.map((t) => t.id)]
    const i = ids.indexOf(activeTab)
    const next = e.key === 'ArrowRight' ? ids[(i + 1) % ids.length] : e.key === 'ArrowLeft' ? ids[(i - 1 + ids.length) % ids.length] : e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : undefined
    if (next === undefined) return
    e.preventDefault()
    setActive(next)
    requestAnimationFrame(() => document.getElementById(next ? `tab-${next}` : 'tab-home')?.focus())
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="Open tabs"
        onKeyDown={onStripKey}
        onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}
        className="flex h-11 shrink-0 items-end gap-0.5 overflow-x-auto border-b bg-sidebar px-1.5 pt-1.5 [scrollbar-width:none]"
      >
        <Tooltip content="Home (Alt+H)">
          <button
            id="tab-home"
            role="tab"
            aria-selected={activeTab === ''}
            tabIndex={activeTab === '' ? 0 : -1}
            aria-label="Home"
            onClick={() => setActive('')}
            className={cn(
              'relative -mb-px flex h-full w-10 shrink-0 items-center justify-center rounded-t-lg border-x border-t transition',
              activeTab === '' ? 'border-border bg-background text-primary' : 'border-transparent text-muted-foreground hover:bg-muted/70',
            )}
          >
            {activeTab === '' && <motion.span layoutId="active-tab" className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary" />}
            <House size={15} />
          </button>
        </Tooltip>
        {tabs.map((t, i) => <TabButton key={t.id} tab={t} index={i} />)}
        <NewTabButton />
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0 overflow-y-auto', activeTab !== '' && 'hidden')}>{home}</div>
        {tabs.map((t) => {
          const conn = connections.find((c) => c.id === t.connId)
          if (!conn || !seen.has(t.id)) return null
          return (
            <div key={t.id} role="tabpanel" aria-labelledby={`tab-${t.id}`} className={cn('absolute inset-0', activeTab !== t.id && 'hidden')}>
              {t.kind === 'table' ? <TableTab tab={t} conn={conn} /> : t.kind === 'query' ? <QueryTab tab={t} conn={conn} /> : <DatabaseTab tab={t} conn={conn} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
