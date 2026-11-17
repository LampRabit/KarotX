import { useState, type FormEvent } from 'react'
import { Check, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Session } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { SectionHeader } from './SectionHeader'

const MIN = 8

function StatusCard({ on }: { on: boolean }) {
  const Icon = on ? ShieldCheck : ShieldAlert
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4', on ? 'border-success/30 bg-success/[0.07]' : 'border-warning/30 bg-warning/[0.07]')}>
      <Icon size={20} aria-hidden className={cn('mt-0.5 shrink-0', on ? 'text-success' : 'text-warning')} />
      <div>
        <p className="font-medium">{on ? 'Password protection is on' : 'Password protection is off'}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {on
            ? 'Anyone opening KarotX must enter the password. It is stored securely in your OS keychain.'
            : 'Anyone who can reach this computer on your network can open KarotX and your databases.'}
        </p>
      </div>
    </div>
  )
}

function PasswordForm({ hasPassword, onDone }: { hasPassword: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<{ field: 'current' | 'next' | 'confirm'; msg: string }>()
  const [busy, setBusy] = useState(false)

  const longEnough = next.length >= MIN
  const matches = next !== '' && next === confirm

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!longEnough) return setError({ field: 'next', msg: `Use at least ${MIN} characters.` })
    if (!matches) return setError({ field: 'confirm', msg: 'The passwords do not match.' })
    setError(undefined)
    setBusy(true)
    try {
      await track('Saving password', api.setPassword(current, next))
      toast.success(hasPassword ? 'Password changed' : 'Password protection turned on', {
        description: 'Other open sessions were signed out.',
      })
      setCurrent(''), setNext(''), setConfirm('')
      onDone()
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'wrong password') setError({ field: 'current', msg: 'Your current password is not right.' })
      else toast.error('Could not save the password', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h4 className="font-semibold">{hasPassword ? 'Change password' : 'Set a password'}</h4>
      {hasPassword && (
        <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={error?.field === 'current' ? error.msg : undefined} required />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={error?.field === 'next' ? error.msg : undefined} required />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={error?.field === 'confirm' ? error.msg : undefined} required />
      </div>
      <ul className="space-y-1 text-[13px]" aria-label="Password requirements">
        {[
          [longEnough, `At least ${MIN} characters`],
          [matches, 'Both passwords match'],
        ].map(([ok, label]) => (
          <li key={label as string} className={cn('flex items-center gap-1.5 transition-colors', ok ? 'text-success' : 'text-muted-foreground')}>
            <Check size={14} aria-hidden className={cn('transition', ok ? 'opacity-100' : 'opacity-30')} />
            {label}
          </li>
        ))}
      </ul>
      <Button type="submit" loading={busy}>{hasPassword ? 'Change password' : 'Turn on password protection'}</Button>
    </form>
  )
}

function RemoveForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await track('Removing password', api.removePassword(current))
      toast.success('Password protection turned off')
      onDone()
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'wrong password') setError('Your current password is not right.')
      else toast.error('Could not remove the password', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-destructive/25 p-4">
      <div>
        <h4 className="font-semibold">Turn off password protection</h4>
        <p className="mt-0.5 text-[13px] text-muted-foreground">KarotX will open without asking for a password.</p>
      </div>
      <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={error} required />
      <Button type="submit" variant="danger" loading={busy}>Turn off protection</Button>
    </form>
  )
}

export function Security({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const on = session.authRequired
  return (
    <div className="space-y-6">
      <SectionHeader title="Security" text="Protect KarotX with a password. You only need to set it once." />
      <StatusCard on={on} />
      {session.local ? (
        <>
          <PasswordForm hasPassword={on} onDone={onChanged} />
          {on && <RemoveForm onDone={onChanged} />}
        </>
      ) : (
        <div className="flex gap-3 rounded-xl border bg-muted/50 p-4 text-[13px]">
          <Info size={18} aria-hidden className="shrink-0 text-muted-foreground" />
          <p>For safety, the password can only be set or changed on the computer that is running KarotX.</p>
        </div>
      )}
    </div>
  )
}
