import { useState, type FormEvent } from 'react'
import { motion, useAnimationControls } from 'motion/react'
import { api } from '@/lib/api'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Logo } from './Logo'

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const shake = useAnimationControls()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError((err as Error).message === 'wrong password' ? 'That password is not right. Try again.' : (err as Error).message)
      setPassword('')
      shake.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.4 } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative flex h-full items-center justify-center overflow-hidden p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_50%_at_50%_30%,var(--glow),transparent)]" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm"
      >
        <motion.form animate={shake} onSubmit={submit} className="space-y-6 rounded-2xl border bg-surface p-8 shadow-[var(--shadow)]">
          <div className="flex flex-col items-center gap-4 text-center">
            <Logo size={48} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
              <p className="mt-1 text-muted-foreground">KarotX is locked. Enter your password to continue.</p>
            </div>
          </div>
          <Input
            label="Password"
            type="password"
            autoFocus
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
          <Button type="submit" size="lg" loading={busy} className="w-full">
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </motion.form>
      </motion.div>
    </main>
  )
}
