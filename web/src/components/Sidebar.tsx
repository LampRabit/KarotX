import { Plus, LogOut, Database } from 'lucide-react'
import type { Mode } from '@/themes'
import { Button } from './Button'
import { Logo } from './Logo'
import { ModeSwitch } from './ModeSwitch'

type Props = {
  version: string
  mode: Mode
  onModeChange: (m: Mode) => void
  onLogout?: () => void
}

export function Sidebar({ version, mode, onModeChange, onLogout }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar" aria-label="Connections">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <span className="text-base font-semibold tracking-tight">KarotX</span>
      </div>

      <div className="px-3">
        {/* Wired up in Phase 1 (connection wizard). */}
        <Button className="w-full" disabled title="Available in the next build">
          <Plus size={16} aria-hidden /> New connection
        </Button>
      </div>

      <nav className="mt-5 flex-1 overflow-y-auto px-3">
        <h2 className="px-1 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Connections</h2>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
          <Database size={20} aria-hidden />
          <p>No connections yet. Saved connections will appear here.</p>
        </div>
      </nav>

      <div className="space-y-3 border-t p-3">
        <ModeSwitch mode={mode} onChange={onModeChange} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{version === 'dev' ? 'dev build' : `v${version}`}</span>
          {onLogout && (
            <button onClick={onLogout} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted hover:text-foreground">
              <LogOut size={13} aria-hidden /> Lock
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
