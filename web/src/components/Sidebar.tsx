import { Lock, Moon, Plus, Search, Settings, Sun, Unplug } from 'lucide-react'
import { prefersDark, type Mode } from '@/themes'
import type { Session } from '@/lib/api'
import { modKey } from '@/lib/hooks'
import { Button } from './ui/Button'
import { Kbd } from './ui/Kbd'
import { Tooltip } from './ui/Tooltip'
import { Logo } from './Logo'

type Props = {
  session: Session
  mode: Mode
  onModeChange: (m: Mode) => void
  onNewConnection: () => void
  onOpenSettings: () => void
  onLock?: () => void
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

export function Sidebar({ session, mode, onModeChange, onNewConnection, onOpenSettings, onLock }: Props) {
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark())

  return (
    <aside aria-label="Connections" className="flex w-[264px] shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">KarotX</div>
          <Tooltip content={session.statePath} side="bottom">
            <div className="truncate text-xs text-muted-foreground">{fileName(session.statePath)}</div>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-2 px-3">
        <Button className="w-full" onClick={onNewConnection}>
          <Plus size={16} aria-hidden /> New connection
        </Button>
        <label className="relative block">
          <span className="sr-only">Search connections</span>
          <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search connections"
            className="h-8 w-full rounded-lg border bg-surface pr-2 pl-8 text-[13px] outline-none transition placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 focus-visible:outline-none"
          />
        </label>
      </div>

      <nav className="mt-5 flex-1 overflow-y-auto px-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Connections</h2>
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">0</span>
        </div>
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed px-4 py-7 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Unplug size={18} aria-hidden />
          </span>
          <div>
            <p className="font-medium">No connections yet</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Connect a database and it will show up here.</p>
          </div>
        </div>
      </nav>

      <div className="flex items-center gap-1 border-t p-2">
        <button
          onClick={onOpenSettings}
          className="flex h-8 flex-1 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Settings size={15} aria-hidden /> Settings
          <Kbd className="ml-auto">{modKey} ,</Kbd>
        </button>
        <Tooltip content={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          <button
            onClick={() => onModeChange(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </Tooltip>
        {onLock && (
          <Tooltip content="Lock KarotX">
            <button
              onClick={onLock}
              aria-label="Lock KarotX"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Lock size={15} />
            </button>
          </Tooltip>
        )}
      </div>
    </aside>
  )
}
