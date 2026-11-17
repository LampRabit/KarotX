import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AppState, type Session } from '@/lib/api'
import { applyTheme, type Mode } from '@/themes'
import { Login } from '@/components/Login'
import { Sidebar } from '@/components/Sidebar'
import { Welcome } from '@/components/Welcome'

applyTheme('karot', 'system')

export function App() {
  const [session, setSession] = useState<Session>()
  const [state, setState] = useState<AppState>()
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const s = await api.session()
      setSession(s)
      if (s.authenticated) {
        const st = await api.state()
        applyTheme(st.settings.theme, st.settings.mode) // before first paint, avoids a color flash
        setState(st)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cannot reach the KarotX server.')
    }
  }, [])

  useEffect(() => void load(), [load])

  const theme = state?.settings.theme ?? 'karot'
  const mode = state?.settings.mode ?? 'system'

  // Apply theme and follow OS changes while in system mode.
  useEffect(() => {
    applyTheme(theme, mode)
    if (mode !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(theme, mode)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, mode])

  function changeMode(m: Mode) {
    setState((s) => s && { ...s, settings: { ...s.settings, mode: m } })
    api.saveSettings({ mode: m }).catch(() => {})
  }

  async function logout() {
    await api.logout()
    setState(undefined)
    load()
  }

  if (error) return <p role="alert" className="p-6 text-destructive">{error}</p>
  if (!session) return null
  if (!session.authenticated) return <Login onSuccess={load} />
  if (!state) return null

  return (
    <div className="flex h-full">
      <Sidebar
        version={session.version}
        mode={mode}
        onModeChange={changeMode}
        onLogout={session.authRequired ? logout : undefined}
      />
      <main className="flex-1 overflow-y-auto">
        <Welcome />
      </main>
    </div>
  )
}
