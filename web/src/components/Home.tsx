import { ArrowRight, FileCode2, KeyRound, Layers, LayoutGrid, RotateCcw, ShieldAlert } from 'lucide-react'
import { isSql } from '@/lib/api'
import { motion } from 'motion/react'
import { databases, kindOf, type DbKind } from '@/lib/databases'
import { useWorkspace } from '@/lib/workspace'
import { cn } from '@/lib/cn'
import { BrandIcon } from './BrandIcon'
import { Button } from './ui/Button'

type Props = { protectedByPassword: boolean; onPick: (db: DbKind) => void; onSetPassword: () => void }

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const list = { show: { transition: { staggerChildren: 0.03 } } }
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } } }

function Tile({ db, onPick }: { db: DbKind; onPick: (db: DbKind) => void }) {
  const soon = db.status === 'soon'
  return (
    <motion.li variants={item}>
      <button
        onClick={() => onPick(db)}
        disabled={soon}
        className="group flex w-full items-center gap-3 rounded-xl border bg-surface p-3 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow)] disabled:pointer-events-none"
      >
        <BrandIcon db={db} className={soon ? 'opacity-50 grayscale' : undefined} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{db.name}</span>
          <span className="block truncate text-[13px] text-muted-foreground">{db.detail}</span>
        </span>
        {soon ? (
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Soon</span>
        ) : (
          <ArrowRight size={16} aria-hidden className="-translate-x-1 text-primary opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        )}
      </button>
    </motion.li>
  )
}

function Section({ title, items, onPick }: { title: string; items: DbKind[]; onPick: (db: DbKind) => void }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-semibold text-muted-foreground">{title}</h2>
      <motion.ul variants={list} initial="hidden" animate="show" className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
        {items.map((db) => <Tile key={db.id} db={db} onPick={onPick} />)}
      </motion.ul>
    </section>
  )
}

const features = [
  { Icon: Layers, title: 'Many at once', text: 'Every connection runs on its own. A slow query never freezes the rest.' },
  { Icon: KeyRound, title: 'Keychain secured', text: 'Passwords live in your OS keychain. Your workspace file is encrypted.' },
  { Icon: RotateCcw, title: 'Resume anytime', text: 'Connections and open tabs come back exactly as you left them.' },
]

function YourConnections() {
  const { connections, openConnection, openQuery, openDatabase } = useWorkspace()
  if (connections.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-semibold text-muted-foreground">Your connections</h2>
      <motion.ul variants={list} initial="hidden" animate="show" className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
        {connections.map((c) => (
          <motion.li key={c.id} variants={item} className="group relative">
            <button
              onClick={() => openConnection(c.id)}
              className="flex w-full items-center gap-3 rounded-xl border bg-surface p-3 pr-12 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow)]"
            >
              <BrandIcon db={kindOf(c)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{c.name}</span>
                  {c.production && <span className="rounded bg-destructive/10 px-1 text-[10px] font-semibold text-destructive">PROD</span>}
                </span>
                <span className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                  <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', c.status === 'connected' ? 'bg-success' : c.status === 'error' ? 'bg-destructive' : 'bg-foreground/25')} />
                  {c.status === 'connected' ? c.info?.serverVersion : c.driver === 'sqlite' ? c.file : c.host}
                </span>
              </span>
            </button>
            <button
              onClick={() => (isSql(c.driver) ? openQuery(c.id) : openDatabase(c.id))}
              aria-label={isSql(c.driver) ? `New query on ${c.name}` : `Browse ${c.name}`}
              title={isSql(c.driver) ? 'New query' : 'Browse'}
              className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {isSql(c.driver) ? <FileCode2 size={16} /> : <LayoutGrid size={16} />}
            </button>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  )
}

export function Home({ protectedByPassword, onPick, onSetPassword }: Props) {
  const ready = databases.filter((d) => d.status === 'ready')
  const hasConnections = useWorkspace((s) => s.connections.length > 0)
  return (
    <div className="relative min-h-full">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_30%_0%,var(--glow),transparent)]" />
      <div className="relative mx-auto max-w-5xl space-y-10 px-8 py-12">
        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
          <p className="text-[13px] font-medium text-primary">{greeting()}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{hasConnections ? 'Pick up where you left off' : 'What would you like to connect today?'}</h1>
          <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
            {hasConnections ? 'Open a connection, or add a new one below. Keep as many open as you like.' : 'Pick a database to start. You can keep as many connections open as you like.'}
          </p>
        </motion.header>

        {!protectedByPassword && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/[0.07] p-3.5"
          >
            <ShieldAlert size={18} aria-hidden className="shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-[13px]">
              <span className="font-medium">KarotX is reachable from your network without a password.</span>{' '}
              <span className="text-muted-foreground">Set one so only you can open your databases.</span>
            </p>
            <Button size="sm" variant="secondary" onClick={onSetPassword}>Set a password</Button>
          </motion.div>
        )}

        <YourConnections />
        <Section title={hasConnections ? 'Add a database' : 'Databases'} items={ready.filter((d) => d.group === 'database')} onPick={onPick} />
        <Section title="Cloud services" items={ready.filter((d) => d.group === 'cloud')} onPick={onPick} />
        <Section title="Coming soon" items={databases.filter((d) => d.status === 'soon')} onPick={onPick} />

        <ul className="grid gap-3 border-t pt-8 sm:grid-cols-3">
          {features.map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon size={16} aria-hidden />
              </span>
              <div>
                <h3 className="font-medium">{title}</h3>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
