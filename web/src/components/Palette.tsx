import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, CornerDownLeft, DatabaseZap, FileCode2, House, Keyboard, LayoutGrid, Moon, Search, Settings, Table2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { kindOf } from '@/lib/databases'
import { useDialogs } from '@/lib/dialogs'
import { modKey } from '@/lib/hooks'
import { tableRefOf, useWorkspace } from '@/lib/workspace'
import { BrandIcon } from './BrandIcon'
import { Dialog } from './ui/Dialog'
import { Kbd } from './ui/Kbd'

type Item = { id: string; group: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; keywords?: string }

/** Fuzzy subsequence score; higher is better, -1 = no match. */
function score(text: string, query: string) {
  if (!query) return 0
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const direct = t.indexOf(q)
  if (direct >= 0) return 100 - direct
  let ti = 0, s = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    s += found === ti ? 3 : 1
    ti = found + 1
  }
  return s
}

type Actions = { newConnection: () => void; openSettings: () => void; toggleMode: () => void }

export function CommandPalette({ actions }: { actions: Actions }) {
  const { dialog, close, open: openD } = useDialogs()
  const open = dialog?.kind === 'palette'
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const { connections, trees, tabs, setActive, openDatabase, openQuery, openTable, openConnection } = useWorkspace()

  useEffect(() => {
    if (open) (setQuery(''), setIndex(0))
  }, [open])

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      { id: 'new-conn', group: 'Actions', label: 'New connection', hint: 'Alt N', icon: <DatabaseZap />, run: actions.newConnection },
      { id: 'home', group: 'Actions', label: 'Go to Home', hint: 'Alt H', icon: <House />, run: () => setActive('') },
      { id: 'settings', group: 'Actions', label: 'Open settings', hint: `${modKey} ,`, icon: <Settings />, run: actions.openSettings },
      { id: 'mode', group: 'Actions', label: 'Toggle light / dark mode', icon: <Moon />, run: actions.toggleMode },
      { id: 'keys', group: 'Actions', label: 'Keyboard shortcuts', hint: '?', icon: <Keyboard />, run: () => openD({ kind: 'shortcuts' }) },
    ]
    for (const t of tabs) {
      list.push({ id: `tab-${t.id}`, group: 'Open tabs', label: t.title, hint: connections.find((c) => c.id === t.connId)?.name, icon: t.kind === 'table' ? <Table2 /> : t.kind === 'query' ? <FileCode2 /> : <LayoutGrid />, run: () => setActive(t.id) })
    }
    for (const c of connections) {
      const icon = <BrandIcon db={kindOf(c)} size={16} className="rounded" />
      list.push({ id: `db-${c.id}`, group: 'Connections', label: `Open ${c.name}`, hint: c.status === 'connected' ? 'connected' : undefined, icon, run: () => (openConnection(c.id), openDatabase(c.id)), keywords: c.host })
      list.push({ id: `q-${c.id}`, group: 'Connections', label: `New query on ${c.name}`, icon: <FileCode2 />, run: () => openQuery(c.id) })
    }
    const seen = new Set<string>()
    for (const [key, entry] of Object.entries(trees)) {
      const connId = key.split('\u0000')[0]
      const conn = connections.find((c) => c.id === connId)
      if (!conn) continue
      for (const n of entry.nodes ?? []) {
        if (n.kind !== 'table' && n.kind !== 'view') continue
        const id = `t-${connId}-${n.path.join('.')}`
        if (seen.has(id)) continue
        seen.add(id)
        const ref = tableRefOf(n)
        const where = [ref.database, ref.schema === 'main' ? '' : ref.schema].filter(Boolean).join('.')
        list.push({ id, group: 'Tables', label: n.name, hint: `${where ? where + ' · ' : ''}${conn.name}`, icon: <Table2 />, run: () => openTable(connId, ref) })
      }
    }
    return list
  }, [actions, tabs, connections, trees, setActive, openDatabase, openQuery, openTable, openConnection, openD])

  const results = useMemo(() => {
    if (!query.trim()) return items.filter((i) => i.group !== 'Tables').slice(0, 40)
    return items
      .map((i) => ({ i, s: Math.max(score(i.label, query), score(`${i.hint ?? ''} ${i.keywords ?? ''}`, query) - 20) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.i)
  }, [items, query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function run(item?: Item) {
    if (!item) return
    close()
    item.run()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)))
    else if (e.key === 'Enter') (e.preventDefault(), run(results[index]))
  }

  let lastGroup = ''
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title="Command palette" className="top-[18%] max-w-xl translate-y-0">
      <div onKeyDown={onKey}>
        <div className="flex items-center gap-2.5 border-b px-4 pr-12">
          <Search size={17} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tables, connections, tabs and actions…"
            aria-label="Search commands"
            aria-controls="kx-palette-list"
            aria-activedescendant={results[index] ? `pal-${results[index].id}` : undefined}
            className="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/80"
          />
        </div>
        <div ref={listRef} id="kx-palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="p-6 text-center text-[13px] text-muted-foreground">Nothing found. Open a connection to search its tables.</p>}
          {results.map((item, i) => {
            const header = item.group !== lastGroup
            lastGroup = item.group
            return (
              <div key={item.id}>
                {header && <p className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{item.group}</p>}
                <button
                  id={`pal-${item.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(item)}
                  className={cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px]', i === index && 'bg-accent text-accent-foreground')}
                >
                  <span className="flex w-4 shrink-0 justify-center text-muted-foreground [&>svg]:size-4" aria-hidden>{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 truncate text-xs text-muted-foreground">{item.hint}</span>}
                  {i === index && <CornerDownLeft size={13} className="shrink-0 text-muted-foreground" aria-hidden />}
                </button>
              </div>
            )
          })}
        </div>
        <footer className="flex items-center gap-3 border-t bg-sidebar/60 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
          <span className="ml-auto flex items-center gap-1"><Command size={12} /> {modKey}+K anywhere</span>
        </footer>
      </div>
    </Dialog>
  )
}

const shortcutGroups: { title: string; keys: [string, string][] }[] = [
  { title: 'Anywhere', keys: [
    [`${modKey} K`, 'Command palette: search tables, connections, actions'],
    ['Alt N', 'New connection'],
    ['Alt T', 'New tab (open a database)'],
    ['Alt W', 'Close the current tab'],
    ['Alt 1 … 9', 'Go to tab 1 … 9'],
    ['Alt [  /  Alt ]', 'Previous / next tab'],
    ['Alt H', 'Go to Home'],
    ['/', 'Search connections in the sidebar'],
    ['Alt E', 'Focus the connection tree'],
    [`${modKey} ,`, 'Settings'],
    ['?', 'This list'],
  ] },
  { title: 'Connection tree', keys: [
    ['↑ ↓', 'Move between items'],
    ['→ ←', 'Expand / collapse (or go to parent)'],
    ['Enter', 'Open table, or open a database'],
    ['Shift Enter', 'Open the connection’s database view'],
    ['Double-click', 'Open a connection or database in a tab (or switch to it)'],
    ['Right-click', 'More actions'],
  ] },
  { title: 'Data grid', keys: [
    ['Arrows · Tab', 'Move between cells'],
    [`${modKey} Arrows · Home · End`, 'Jump to edges'],
    ['PgUp · PgDn', 'Page up / down'],
    ['Enter · F2', 'Edit cell (Enter saves, Esc cancels)'],
    ['Space', 'Select / unselect row'],
    [`${modKey} A`, 'Select all rows'],
    ['Delete', 'Mark selected rows for deletion'],
    [`${modKey} C`, 'Copy cell'],
    [`${modKey} F`, 'Focus the WHERE filter'],
    [`${modKey} S`, 'Review & save changes'],
    ['Alt R', 'Reload rows'],
  ] },
  { title: 'Editor', keys: [
    [`${modKey} Enter`, 'Run the selection, or everything'],
    [`${modKey} Space`, 'Show completions'],
  ] },
]

export function ShortcutsDialog() {
  const { dialog, close } = useDialogs()
  return (
    <Dialog open={dialog?.kind === 'shortcuts'} onOpenChange={(o) => !o && close()} title="Keyboard shortcuts" className="max-w-3xl">
      <div className="max-h-[80vh] overflow-y-auto p-6">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold"><Keyboard size={17} /> Keyboard shortcuts</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {shortcutGroups.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h3>
              <dl className="space-y-1.5">
                {g.keys.map(([k, d]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <dt className="text-muted-foreground">{d}</dt>
                    <dd className="shrink-0"><Kbd className="h-auto px-1.5 py-0.5 font-mono">{k}</Kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.cm-editor'))

/** App-wide keyboard shortcuts and the custom right-click policy. */
export function useGlobalShortcuts(actions: Actions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ws = useWorkspace.getState()
      const dialogs = useDialogs.getState()
      const mod = e.ctrlKey || e.metaKey
      const ids = ['', ...ws.tabs.map((t) => t.id)]
      const cycle = (by: number) => ws.setActive(ids[(ids.indexOf(ws.activeTab) + by + ids.length) % ids.length])

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        return dialogs.dialog?.kind === 'palette' ? dialogs.close() : dialogs.open({ kind: 'palette' })
      }
      if (e.altKey && !mod) {
        const digit = /^Digit([1-9])$/.exec(e.code)
        const handled = (() => {
          if (digit) return ws.setActive(ws.tabs[Number(digit[1]) - 1]?.id ?? ws.activeTab), true
          switch (e.code) {
            case 'KeyN': return actions.newConnection(), true
            case 'KeyT': return window.dispatchEvent(new Event('kx:new-tab')), true
            case 'KeyW': return ws.activeTab && ws.closeTab(ws.activeTab), true
            case 'KeyH': return ws.setActive(''), true
            case 'BracketLeft': return cycle(-1), true
            case 'BracketRight': return cycle(1), true
            case 'KeyE': return document.querySelector<HTMLElement>('#kx-tree [data-tree-item]')?.focus(), true
          }
          return false
        })()
        if (handled) e.preventDefault()
        return
      }
      if (isTyping(e.target) || mod || dialogs.dialog) return
      if (e.key === '/') (e.preventDefault(), document.getElementById('kx-sidebar-search')?.focus())
      else if (e.key === '?') (e.preventDefault(), dialogs.open({ kind: 'shortcuts' }))
    }
    // Replace the browser's context menu with ours; keep it in text fields so copy/paste still work.
    const onContext = (e: MouseEvent) => {
      if (!isTyping(e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onContext)
    return () => (window.removeEventListener('keydown', onKey), window.removeEventListener('contextmenu', onContext))
  }, [actions])
}
