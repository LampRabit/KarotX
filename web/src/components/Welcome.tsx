import { KeyRound, Network, Save } from 'lucide-react'

const ready = ['PostgreSQL', 'MySQL', 'MariaDB', 'SQLite', 'Redis', 'MongoDB']
const cloud = ['Supabase', 'Neon', 'CockroachDB', 'PlanetScale', 'TiDB']
const later = ['ClickHouse', 'Neo4j', 'Memcached', 'DynamoDB']

const points = [
  { Icon: Network, title: 'Many databases at once', text: 'Each connection runs on its own, so a slow query never freezes the rest.' },
  { Icon: KeyRound, title: 'Secrets stay in your keychain', text: 'Passwords and SSH keys are kept by your operating system, never in files.' },
  { Icon: Save, title: 'Picks up where you left off', text: 'Connections and open tabs are restored the next time you start KarotX.' },
]

function Chips({ items, muted }: { items: string[]; muted?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((name) => (
        <li
          key={name}
          className={muted ? 'rounded-full border px-2.5 py-0.5 text-muted-foreground' : 'rounded-full bg-accent px-2.5 py-0.5 text-accent-foreground'}
        >
          {name}
        </li>
      ))}
    </ul>
  )
}

export function Welcome() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to KarotX</h1>
      <p className="mt-2 text-base text-muted-foreground">
        A friendly client for all your databases. Add a connection from the sidebar to get started.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-3">
        {points.map(({ Icon, title, text }) => (
          <li key={title} className="rounded-lg border bg-surface p-4">
            <Icon size={18} className="text-primary" aria-hidden />
            <h2 className="mt-2 font-medium">{title}</h2>
            <p className="mt-1 text-muted-foreground">{text}</p>
          </li>
        ))}
      </ul>

      <section className="mt-10 space-y-4">
        <div className="space-y-2">
          <h2 className="font-medium">Supported databases</h2>
          <Chips items={ready} />
        </div>
        <div className="space-y-2">
          <h2 className="font-medium">Cloud services</h2>
          <Chips items={cloud} />
        </div>
        <div className="space-y-2">
          <h2 className="font-medium">Coming soon</h2>
          <Chips items={later} muted />
        </div>
      </section>
    </div>
  )
}
