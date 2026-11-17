import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, KeyRound, Link2, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { api, ApiError, type Connection, type ConnView, type HostKeyPrompt, type Info, type SSHAuth, type SSHHop, type TLSMode } from '@/lib/api'
import { track } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { databases, kindOf, parseConnectionUrl, type DbKind } from '@/lib/databases'
import { useWorkspace } from '@/lib/workspace'
import { BrandIcon } from '../BrandIcon'
import { Button } from '../ui/Button'
import { Collapsible } from '../ui/Collapsible'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Segmented } from '../ui/Segmented'
import { Switch } from '../ui/Switch'

export type ConnectionDialogTarget = { kind?: DbKind; edit?: ConnView } | null

const colors = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

const tlsHelp: Record<TLSMode, string> = {
  off: 'No encryption. Only for local databases.',
  prefer: 'Encrypt when the server supports it.',
  require: 'Always encrypt, without checking the certificate.',
  verify: 'Always encrypt and verify the server certificate. Safest.',
}

function draftFor(kind: DbKind): Connection {
  const { tlsMode, hostHint: _, ...d } = kind.defaults ?? {}
  return {
    id: '',
    name: '',
    driver: kind.driver!,
    preset: kind.id === kind.driver ? undefined : kind.id,
    host: '',
    ...d,
    tls: { mode: tlsMode ?? 'prefer' },
  }
}

const newHop = (): SSHHop => ({ host: '', port: 22, user: '', auth: 'key', keyFile: '~/.ssh/id_ed25519' })

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string; info?: Info; ms?: number; hostKey?: HostKeyPrompt }

export function ConnectionDialog({ target, onClose }: { target: ConnectionDialogTarget; onClose: () => void }) {
  const open = target !== null
  const editing = target?.edit
  const [kind, setKind] = useState<DbKind | undefined>()
  const [c, setC] = useState<Connection>()
  const [password, setPassword] = useState<string | null>(null)
  const [sshSecrets, setSshSecrets] = useState<(string | null)[]>([])
  const [urlNote, setUrlNote] = useState('')
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { refresh, openConnection } = useWorkspace()

  // Reset the form whenever the dialog opens.
  useEffect(() => {
    if (!target) return
    const k = target.edit ? kindOf(target.edit) : target.kind
    setKind(k)
    if (target.edit) {
      const { status: _s, error: _e, info: _i, hasPassword: _h, ...conn } = target.edit
      setC(structuredClone(conn))
      setSshSecrets((conn.ssh?.hops ?? []).map(() => null))
    } else {
      setC(k ? draftFor(k) : undefined)
      setSshSecrets([])
    }
    setPassword(target.edit ? null : '')
    setUrlNote('')
    setTest({ status: 'idle' })
    setError('')
  }, [target])

  const set = (patch: Partial<Connection>) => {
    setC((p) => p && { ...p, ...patch })
    setTest((t) => (t.status === 'testing' ? t : { status: 'idle' }))
  }
  const setHop = (i: number, patch: Partial<SSHHop>) =>
    set({ ssh: { hops: c!.ssh!.hops.map((h, j) => (j === i ? { ...h, ...patch } : h)) } })
  const setSecret = (i: number, v: string) => setSshSecrets((s) => s.map((x, j) => (j === i ? v : x)))

  function choose(k: DbKind) {
    setKind(k)
    setC(draftFor(k))
    setPassword('')
  }

  function pasteUrl(raw: string) {
    const parsed = parseConnectionUrl(raw)
    if (!parsed) return setUrlNote(raw.trim() ? 'This does not look like a postgres:// or mysql:// URL.' : '')
    set({ ...parsed.conn, tls: { ...c!.tls, ...parsed.conn.tls } })
    if (parsed.password !== undefined) setPassword(parsed.password)
    setUrlNote('Filled in from the URL. Check the fields below.')
  }

  const secrets = () => ({ password, ssh: sshSecrets })
  const finalName = () => c!.name.trim() || (c!.driver === 'sqlite' ? (c!.file?.split(/[\\/]/).pop() ?? 'SQLite') : `${kind?.name ?? ''} ${c!.host ?? ''}`.trim())

  async function runTest(conn = c!) {
    setTest({ status: 'testing' })
    const start = performance.now()
    try {
      const info = await track('Testing connection', api.testConnection({ ...conn, name: finalName() }, secrets()))
      setTest({ status: 'ok', info, ms: Math.round(performance.now() - start) })
    } catch (e) {
      const err = e as ApiError
      setTest({ status: 'error', message: err.message, hostKey: err.data?.hostKey })
    }
  }

  function trustHostKey(p: HostKeyPrompt) {
    const hops = c!.ssh!.hops.map((h, i) => (i === p.hop ? { ...h, hostKey: p.fingerprint } : h))
    const next = { ...c!, ssh: { hops } }
    setC(next)
    runTest(next)
  }

  async function save(andConnect: boolean) {
    setError('')
    setSaving(true)
    try {
      const saved = await track('Saving connection', api.saveConnection({ ...c!, name: finalName() }, secrets()))
      await refresh()
      toast.success(editing ? 'Connection updated' : 'Connection saved', { description: saved.name })
      onClose()
      if (andConnect) openConnection(saved.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const network = c && c.driver !== 'sqlite'
  const hops = c?.ssh?.hops ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={editing ? 'Edit connection' : 'New connection'} className="max-w-2xl">
      <div className="flex max-h-[min(760px,90vh)] flex-col">
        <header className="flex items-center gap-3 border-b px-6 py-4 pr-14">
          {kind && !editing && (
            <button onClick={() => (setKind(undefined), setC(undefined))} aria-label="Choose another database" className="-ml-2 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <ArrowLeft size={17} />
            </button>
          )}
          {kind && <BrandIcon db={kind} size={36} />}
          <div>
            <h2 className="text-[15px] font-semibold">{editing ? `Edit ${editing.name}` : kind ? `New ${kind.name} connection` : 'New connection'}</h2>
            <p className="text-[13px] text-muted-foreground">{kind ? 'Fill in the details, test, then save.' : 'Which database do you want to connect to?'}</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait" initial={false}>
            {!kind || !c ? (
              <motion.ul key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {databases.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => choose(d)}
                      disabled={d.status === 'soon'}
                      className="flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition hover:border-primary/40 hover:bg-muted/40 disabled:opacity-50"
                    >
                      <BrandIcon db={d} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{d.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{d.status === 'soon' ? 'Coming soon' : d.detail}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </motion.ul>
            ) : (
              <motion.form
                key="form"
                id="conn-form"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onSubmit={(e) => (e.preventDefault(), save(!editing))}
                className="space-y-5"
              >
                {network && (
                  <div className="rounded-xl bg-muted/50 p-3.5">
                    <Input
                      label="Have a connection URL? Paste it here"
                      placeholder={c.driver === 'postgres' ? 'postgres://user:password@host:5432/database' : 'mysql://user:password@host:3306/database'}
                      onChange={(e) => pasteUrl(e.target.value)}
                      hint={urlNote || 'Optional. Fills in the fields below for you.'}
                      autoComplete="off"
                    />
                  </div>
                )}

                <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                  <Input label="Name" placeholder={finalName() || 'My database'} value={c.name} onChange={(e) => set({ name: e.target.value })} />
                  <fieldset>
                    <legend className="mb-1.5 text-[13px] font-medium">Color</legend>
                    <div className="flex h-10 items-center gap-1">
                      {colors.map((col) => (
                        <button
                          key={col || 'none'}
                          type="button"
                          aria-label={col ? `Color ${col}` : 'No color'}
                          aria-pressed={(c.color ?? '') === col}
                          onClick={() => set({ color: col || undefined })}
                          className={cn('size-5 rounded-full border transition hover:scale-110', (c.color ?? '') === col && 'ring-2 ring-ring ring-offset-2 ring-offset-surface')}
                          style={{ background: col || 'transparent' }}
                        />
                      ))}
                    </div>
                  </fieldset>
                </div>

                {c.driver === 'sqlite' ? (
                  <Input label="Database file" placeholder="C:\data\app.db" value={c.file ?? ''} onChange={(e) => set({ file: e.target.value })} hint="Full path to an existing .db / .sqlite file on the computer running KarotX." required />
                ) : (
                  <>
                    <div className="grid grid-cols-[1fr_110px] gap-3">
                      <Input label="Host" placeholder={kind.defaults?.hostHint ?? 'localhost'} value={c.host ?? ''} onChange={(e) => set({ host: e.target.value })} required />
                      <Input label="Port" inputMode="numeric" value={c.port ?? ''} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || undefined })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input label="User" value={c.user ?? ''} onChange={(e) => set({ user: e.target.value })} autoComplete="off" />
                      <Input
                        label="Password"
                        type="password"
                        autoComplete="new-password"
                        value={password ?? ''}
                        placeholder={editing?.hasPassword && password === null ? 'Saved in keychain' : ''}
                        onChange={(e) => setPassword(e.target.value)}
                        hint={editing?.hasPassword && password === null ? 'Leave empty to keep the saved password.' : undefined}
                      />
                    </div>
                    <Input label="Database" placeholder={c.driver === 'mysql' ? 'Optional. Browse all databases' : 'postgres'} value={c.database ?? ''} onChange={(e) => set({ database: e.target.value })} />

                    <Collapsible title="Encryption (TLS)" badge={<Badge>{c.tls.mode ?? 'prefer'}</Badge>}>
                      <Segmented
                        label="TLS mode"
                        value={c.tls.mode ?? 'prefer'}
                        onChange={(mode) => set({ tls: { ...c.tls, mode } })}
                        options={[{ value: 'off', label: 'Off' }, { value: 'prefer', label: 'Prefer' }, { value: 'require', label: 'Require' }, { value: 'verify', label: 'Verify' }]}
                        className="w-full"
                      />
                      <p className="text-[13px] text-muted-foreground">{tlsHelp[c.tls.mode ?? 'prefer']}</p>
                      {(c.tls.mode === 'require' || c.tls.mode === 'verify') && (
                        <div className="grid gap-3">
                          <Input label="CA certificate file" placeholder="Optional" value={c.tls.caFile ?? ''} onChange={(e) => set({ tls: { ...c.tls, caFile: e.target.value } })} />
                          <div className="grid grid-cols-2 gap-3">
                            <Input label="Client certificate" placeholder="Optional" value={c.tls.certFile ?? ''} onChange={(e) => set({ tls: { ...c.tls, certFile: e.target.value } })} />
                            <Input label="Client key" placeholder="Optional" value={c.tls.keyFile ?? ''} onChange={(e) => set({ tls: { ...c.tls, keyFile: e.target.value } })} />
                          </div>
                        </div>
                      )}
                    </Collapsible>

                    <Collapsible title="SSH tunnel" defaultOpen={hops.length > 0} badge={<Badge on={hops.length > 0}>{hops.length === 0 ? 'off' : hops.length === 1 ? 'on' : `${hops.length} hops`}</Badge>}>
                      <Switch
                        checked={hops.length > 0}
                        onChange={(on) => {
                          set({ ssh: on ? { hops: [newHop()] } : undefined })
                          setSshSecrets(on ? [''] : [])
                        }}
                        label="Connect through SSH"
                        description="For databases that are only reachable from a server you can SSH into."
                      />
                      {hops.map((h, i) => (
                        <HopFields
                          key={i}
                          hop={h}
                          index={i}
                          total={hops.length}
                          secret={sshSecrets[i]}
                          saved={!!editing && sshSecrets[i] === null}
                          onChange={(p) => setHop(i, p)}
                          onSecret={(v) => setSecret(i, v)}
                          onRemove={() => {
                            set({ ssh: hops.length === 1 ? undefined : { hops: hops.filter((_, j) => j !== i) } })
                            setSshSecrets((s) => s.filter((_, j) => j !== i))
                          }}
                        />
                      ))}
                      {hops.length > 0 && (
                        <Button type="button" variant="secondary" size="sm" onClick={() => (set({ ssh: { hops: [...hops, newHop()] } }), setSshSecrets((s) => [...s, '']))}>
                          <Plus size={14} aria-hidden /> Add another hop
                        </Button>
                      )}
                    </Collapsible>
                  </>
                )}

                <Collapsible title="Safety" defaultOpen={!!c.production} badge={c.production ? <Badge danger>production</Badge> : c.readOnly ? <Badge>read-only</Badge> : null}>
                  <Switch
                    tone="danger"
                    checked={!!c.production}
                    onChange={(production) => set({ production, readOnly: production ? true : c.readOnly })}
                    label="This is a production database"
                    description="KarotX marks it clearly and asks before running anything that changes or deletes data."
                  />
                  <Switch
                    checked={!!c.readOnly}
                    onChange={(readOnly) => set({ readOnly })}
                    label="Read-only"
                    description="The database itself rejects every write from this connection."
                  />
                </Collapsible>

                {error && (
                  <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-[13px] text-destructive">
                    <XCircle size={16} className="mt-px shrink-0" aria-hidden /> {error}
                  </p>
                )}
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {kind && c && (
          <footer className="space-y-3 border-t bg-sidebar/60 px-6 py-4">
            <TestResult test={test} onTrust={trustHostKey} />
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" loading={test.status === 'testing'} onClick={() => runTest()}>
                {test.status === 'testing' ? 'Testing…' : 'Test connection'}
              </Button>
              <div className="ml-auto flex gap-2">
                {editing ? (
                  <Button type="submit" form="conn-form" loading={saving}>Save changes</Button>
                ) : (
                  <>
                    <Button type="button" variant="ghost" disabled={saving} onClick={() => save(false)}>Save only</Button>
                    <Button type="submit" form="conn-form" loading={saving}>Save &amp; connect</Button>
                  </>
                )}
              </div>
            </div>
          </footer>
        )}
      </div>
    </Dialog>
  )
}

function Badge({ children, on, danger }: { children: React.ReactNode; on?: boolean; danger?: boolean }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', danger ? 'bg-destructive/10 text-destructive' : on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
      {children}
    </span>
  )
}

function HopFields(p: {
  hop: SSHHop; index: number; total: number; secret: string | null | undefined; saved: boolean
  onChange: (patch: Partial<SSHHop>) => void; onSecret: (v: string) => void; onRemove: () => void
}) {
  const { hop, index, total } = p
  const title = total === 1 ? 'SSH server' : index === total - 1 ? `Hop ${index + 1} · reaches the database` : `Hop ${index + 1}${index === 0 ? ' · first jump host' : ''}`
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2">
        <KeyRound size={15} className="text-muted-foreground" aria-hidden />
        <h4 className="text-[13px] font-semibold">{title}</h4>
        {hop.hostKey && <span className="truncate text-[11px] text-success" title={hop.hostKey}>trusted</span>}
        <button type="button" onClick={p.onRemove} aria-label={`Remove ${title}`} className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_90px] gap-3">
        <Input label="SSH host" placeholder="bastion.example.com" value={hop.host} onChange={(e) => p.onChange({ host: e.target.value, hostKey: undefined })} required />
        <Input label="Port" inputMode="numeric" value={hop.port ?? 22} onChange={(e) => p.onChange({ port: Number(e.target.value.replace(/\D/g, '')) || 22 })} />
      </div>
      <Input label="SSH user" value={hop.user} onChange={(e) => p.onChange({ user: e.target.value })} required />
      <Segmented<SSHAuth>
        label="SSH authentication"
        value={hop.auth}
        onChange={(auth) => p.onChange({ auth })}
        options={[{ value: 'key', label: 'Private key' }, { value: 'password', label: 'Password' }, { value: 'agent', label: 'SSH agent' }]}
        className="w-full"
      />
      {hop.auth === 'key' && (
        <div className="grid grid-cols-2 gap-3">
          <Input label="Private key file" value={hop.keyFile ?? ''} onChange={(e) => p.onChange({ keyFile: e.target.value })} required />
          <Input label="Passphrase" type="password" autoComplete="new-password" placeholder={p.saved ? 'Saved in keychain' : 'If the key has one'} value={p.secret ?? ''} onChange={(e) => p.onSecret(e.target.value)} />
        </div>
      )}
      {hop.auth === 'password' && (
        <Input label="SSH password" type="password" autoComplete="new-password" placeholder={p.saved ? 'Saved in keychain' : ''} value={p.secret ?? ''} onChange={(e) => p.onSecret(e.target.value)} />
      )}
      {hop.auth === 'agent' && <p className="text-[13px] text-muted-foreground">Uses keys loaded in your running SSH agent (OpenSSH agent on Windows, or SSH_AUTH_SOCK).</p>}
    </motion.div>
  )
}

function TestResult({ test, onTrust }: { test: TestState; onTrust: (p: HostKeyPrompt) => void }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {test.hostKey ? (
        <motion.div key="hk" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className={cn('rounded-lg border p-3 text-[13px]', test.hostKey.changed ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10')}>
          <p className="flex items-center gap-2 font-medium">
            {test.hostKey.changed ? <ShieldAlert size={16} className="text-destructive" /> : <AlertTriangle size={16} className="text-warning" />}
            {test.hostKey.changed ? `The SSH host key for ${test.hostKey.host} has changed` : `First time connecting to ${test.hostKey.host}`}
          </p>
          <p className="mt-1 text-muted-foreground">
            {test.hostKey.changed
              ? 'This can mean the server was reinstalled, or that someone is intercepting the connection. Only continue if you know why it changed.'
              : 'Check that this fingerprint matches the server, then trust it. KarotX will remember it.'}
          </p>
          <code className="mt-2 block rounded bg-background px-2 py-1 font-mono text-xs break-all">{test.hostKey.fingerprint}</code>
          <Button type="button" size="sm" variant={test.hostKey.changed ? 'danger' : 'primary'} className="mt-2" onClick={() => onTrust(test.hostKey!)}>
            {test.hostKey.changed ? 'Trust the new key' : 'Trust and continue'}
          </Button>
        </motion.div>
      ) : test.status === 'ok' ? (
        <motion.p key="ok" role="status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-[13px] text-success">
          <CheckCircle2 size={16} aria-hidden /> Connected to {test.info?.serverVersion} in {test.ms} ms
        </motion.p>
      ) : test.status === 'error' ? (
        <motion.p key="err" role="alert" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-2 text-[13px] text-destructive">
          <XCircle size={16} className="mt-px shrink-0" aria-hidden /> <span className="break-words">{test.message}</span>
        </motion.p>
      ) : test.status === 'testing' ? (
        <motion.p key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Link2 size={15} aria-hidden /> Reaching the server…
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}
