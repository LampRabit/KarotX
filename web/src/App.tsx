import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Toaster, toast } from 'sonner'
import { CommandPalette, ShortcutsDialog, useGlobalShortcuts } from '@/components/Palette'
import { SchemaDialogs } from '@/components/schema/SchemaDialogs'
import { useWorkspace } from '@/lib/workspace'
import { Workspace } from '@/components/Workspace'
import { ConnectionDialog, type ConnectionDialogTarget } from '@/components/connections/ConnectionDialog'
import { api, ApiError, type AppState, type Session } from '@/lib/api'
import { track } from '@/lib/activity'
import { useHotkey } from '@/lib/hooks'
import type { DbKind } from '@/lib/databases'
import { applyTheme, prefersDark, type Mode } from '@/themes'
import { Boot } from '@/components/Boot'
import { Home } from '@/components/Home'
import { Login } from '@/components/Login'
import { Sidebar } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { TopProgress } from '@/components/TopProgress'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { SettingsDialog, type SettingsSection } from '@/components/settings/SettingsDialog'

applyTheme('karot', 'system')

const toastStyle = {
  '--normal-bg': 'var(--surface)',
  '--normal-text': 'var(--foreground)',
  '--normal-border': 'var(--border)',
} as CSSProperties

export function App() {
  const [session, setSession] = useState<Session>()
  const [state, setState] = useState<AppState>()
  const [error, setError] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [dialog, setDialog] = useState<ConnectionDialogTarget>(null)
  const connectionCount = useWorkspace((s) => s.connections.length)

  const load = useCallback(async () => {
    setError(undefined)
    try {
      const s = await api.session()
      if (s.authenticated) {
        const st = await api.state()
        applyTheme(st.settings.theme, st.settings.mode) // before first paint, avoids a color flash
        setState(st)
        const ws = useWorkspace.getState()
        ws.init(st.tabs, st.activeTab)
        ws.refresh().catch(() => {})
      }
      setSession(s)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong while starting.')
    }
  }, [])

  useEffect(() => void load(), [load])

  const theme = state?.settings.theme ?? 'karot'
  const mode = state?.settings.mode ?? 'system'

  // Follow OS light/dark changes while in system mode.
  useEffect(() => {
    if (mode !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(theme, mode, true)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, mode])

  const openSettings = useCallback((s: SettingsSection = 'appearance') => {
    setSection(s)
    setSettingsOpen(true)
  }, [])
  useHotkey('mod+,', useCallback(() => openSettings(), [openSettings]))

  function changeAppearance(t: string, m: Mode) {
    applyTheme(t, m, true)
    setState((s) => s && { ...s, settings: { theme: t, mode: m } })
    track('Saving appearance', api.saveSettings({ theme: t, mode: m })).catch((e) =>
      toast.error('Could not save appearance', { description: (e as Error).message }),
    )
  }

  async function lock() {
    await track('Locking', api.logout())
    toast.dismiss()
    setState(undefined)
    setSettingsOpen(false)
    load()
  }

  const pickDatabase = (db?: DbKind) => setDialog({ kind: db })

  const dark = mode === 'dark' || (mode === 'system' && prefersDark())

  // Stable actions for the palette and global shortcuts; read the latest theme via a ref.
  const latest = useRef({ theme, dark, changeAppearance })
  latest.current = { theme, dark, changeAppearance }
  const actions = useMemo(() => ({
    newConnection: () => setDialog({}),
    openSettings: () => openSettings(),
    toggleMode: () => latest.current.changeAppearance(latest.current.theme, latest.current.dark ? 'light' : 'dark'),
  }), [openSettings])
  useGlobalShortcuts(actions)

  let content
  if (!session) content = <Boot error={error} onRetry={load} />
  else if (!session.authenticated) content = <Login onSuccess={load} />
  else if (!state) content = <Boot error={error} onRetry={load} />
  else
    content = (
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1">
          <Sidebar
            session={session}
            mode={mode}
            onModeChange={(m) => changeAppearance(theme, m)}
            onNewConnection={() => pickDatabase()}
            onEditConnection={(c) => setDialog({ edit: c })}
            onOpenSettings={() => openSettings()}
            onLock={session.authRequired ? lock : undefined}
          />
          <main className="min-w-0 flex-1">
            <Workspace home={<Home protectedByPassword={session.authRequired} onPick={pickDatabase} onSetPassword={() => openSettings('security')} />} />
          </main>
        </div>
        <StatusBar session={session} connections={connectionCount} onOpenSecurity={() => openSettings('security')} />
        <ConnectionDialog target={dialog} onClose={() => setDialog(null)} />
        <SchemaDialogs />
        <CommandPalette actions={actions} />
        <ShortcutsDialog />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          section={section}
          onSectionChange={setSection}
          session={session}
          theme={theme}
          mode={mode}
          onAppearance={changeAppearance}
          onSessionChanged={load}
        />
      </div>
    )

  return (
    <TooltipProvider>
      <TopProgress />
      {content}
      {/* Top-centre keeps toasts clear of the query box, save bar and dialog buttons. Alt+J focuses them (Alt+T is "new tab"). */}
      <Toaster position="top-center" offset={14} hotkey={['altKey', 'KeyJ']} theme={dark ? 'dark' : 'light'} style={toastStyle} closeButton />
    </TooltipProvider>
  )
}
