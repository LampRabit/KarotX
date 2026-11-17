import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Button } from './Button'
import { Logo } from './Logo'

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border bg-surface p-7 shadow-sm">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 className="text-lg font-semibold">KarotX is locked</h1>
            <p className="text-muted-foreground">Enter the password set when KarotX was started.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="font-medium">Password</label>
          <input
            id="password"
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'login-error' : undefined}
            className="h-10 w-full rounded-md border bg-background px-3 outline-none focus-visible:outline-2 focus-visible:outline-ring"
          />
          {error && (
            <p id="login-error" role="alert" className="text-destructive">{error}</p>
          )}
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
    </main>
  )
}
