import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Toaster, toast } from 'sonner'
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

  const load = useCallback(async () => {
    setError(undefined)
    try {
      const s = await api.session()
      if (s.authenticated) {
        const st = await api.state()
        applyTheme(st.settings.theme, st.settings.mode) // before first paint, avoids a color flash
        setState(st)
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

  function pickDatabase(db?: DbKind) {
    toast.info(db ? `${db.name} connections are coming next` : 'New connections are coming next', {
      description: 'The connection wizard ships in the next build.',
    })
  }

  const dark = mode === 'dark' || (mode === 'system' && prefersDark())

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
            onOpenSettings={() => openSettings()}
            onLock={session.authRequired ? lock : undefined}
          />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Home protectedByPassword={session.authRequired} onPick={pickDatabase} onSetPassword={() => openSettings('security')} />
          </main>
        </div>
        <StatusBar session={session} connections={state.connections.length} onOpenSecurity={() => openSettings('security')} />
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
      <Toaster position="bottom-right" offset={40} theme={dark ? 'dark' : 'light'} style={toastStyle} closeButton />
    </TooltipProvider>
  )
}
